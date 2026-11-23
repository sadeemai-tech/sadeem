import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// ============================================================
// v11.13.1 SECURITY — Electron upgrade + OAuth URL/SSRF hardening.
// Bundles mcpOAuth.ts FROM SOURCE (not the stale .bundle.mjs fixtures)
// so these checks exercise the code that actually ships.
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let mod;
{
  const dir = mkdtempSync(join(tmpdir(), 'sadeem-sec-'));
  const out = join(dir, 'mcpOAuth.mjs');
  require('esbuild').buildSync({
    entryPoints: [join(ROOT, 'electron/agent/mcpOAuth.ts')],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent',
    // mcpOAuth.ts calls require('electron') inside safeStorage helpers; those
    // are not exercised here but must still resolve in an ESM bundle.
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
  });
  mod = await import(pathToFileURL(out).href);
}

// ------------------------------------------------------------
// 1. The XSS -> RCE vector: authorization_endpoint handed to
//    shell.openExternal must be https (or loopback http) ONLY.
// ------------------------------------------------------------
test('auth URL guard: https + loopback http allowed, dangerous schemes rejected', () => {
  assert.equal(mod.assertSafeExternalUrl('https://auth.example.com/authorize').protocol, 'https:');
  assert.equal(mod.assertSafeExternalUrl('http://127.0.0.1:8080/authorize').protocol, 'http:');
  assert.equal(mod.assertSafeExternalUrl('http://localhost:3000/authorize').protocol, 'http:');
  for (const bad of [
    'javascript:alert(1)',
    'file:///C:/Windows/win.ini',
    'data:text/html,<script>alert(1)</script>',
    'ftp://evil.example/x',
    'sadeem://auth/callback',
    'http://evil.example.com/authorize', // public http is not allowed
    'not a url',
  ]) {
    assert.throws(
      () => mod.assertSafeExternalUrl(bad),
      /Blocked unsafe OAuth authorization URL|not a valid URL/,
      `must reject ${bad}`,
    );
  }
});

// ------------------------------------------------------------
// 2. SSRF guard: no private / link-local / metadata endpoints.
// ------------------------------------------------------------
test('fetch-target guard blocks private, link-local and non-http URLs', () => {
  for (const ok of ['https://auth.example.com/token', 'http://127.0.0.1:1234/token', 'http://localhost/token']) {
    assert.ok(mod.assertSafeFetchTarget(ok), `accept ${ok}`);
  }
  for (const bad of [
    'http://169.254.169.254/latest/meta-data/', // cloud metadata
    'http://10.0.0.5/internal',
    'http://192.168.1.1/admin',
    'http://172.16.0.1/admin',
    'http://100.64.0.1/', // CGNAT
    'http://0.0.0.0/',
    'file:///etc/passwd',
    'javascript:alert(1)',
  ]) {
    assert.throws(
      () => mod.assertSafeFetchTarget(bad),
      /Blocked unsafe OAuth endpoint|not a valid URL/,
      `must reject ${bad}`,
    );
  }
});

test('host classification helpers', () => {
  assert.equal(mod.isLoopbackHost('127.0.0.1'), true);
  assert.equal(mod.isLoopbackHost('localhost'), true);
  assert.equal(mod.isLoopbackHost('::1'), true);
  assert.equal(mod.isLoopbackHost('evil.example'), false);
  assert.equal(mod.isPrivateAddress('10.1.2.3'), true);
  assert.equal(mod.isPrivateAddress('169.254.169.254'), true);
  assert.equal(mod.isPrivateAddress('127.0.0.1'), false); // loopback is allowed
  assert.equal(mod.isPrivateAddress('8.8.8.8'), false);
});

// ------------------------------------------------------------
// 3. RFC 8414 discovery: reject malicious metadata before any of
//    its values can reach openExternal or fetch.
// ------------------------------------------------------------
test('discovery rejects malicious authorization_endpoint, SSRF token URL and issuer mismatch', async () => {
  const http = require('node:http');
  let meta = {};
  const srv = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(meta));
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    meta = { issuer: base, authorization_endpoint: 'javascript:alert(1)', token_endpoint: `${base}/token` };
    assert.equal(await mod.discoverAuthorizationServer(base), null, 'javascript: auth endpoint rejected');

    meta = { issuer: base, authorization_endpoint: 'file:///C:/evil', token_endpoint: `${base}/token` };
    assert.equal(await mod.discoverAuthorizationServer(base), null, 'file: auth endpoint rejected');

    meta = { issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: 'http://169.254.169.254/meta' };
    assert.equal(await mod.discoverAuthorizationServer(base), null, 'private token endpoint rejected (SSRF)');

    meta = { issuer: 'https://evil.example', authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token` };
    assert.equal(await mod.discoverAuthorizationServer(base), null, 'issuer host mismatch rejected');

    meta = { issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, scopes_supported: ['read'] };
    const ok = await mod.discoverAuthorizationServer(base);
    assert.ok(ok, 'valid metadata accepted');
    assert.equal(ok.authorizationEndpoint, `${base}/authorize`);
    assert.equal(ok.issuer, base);
  } finally {
    srv.close();
  }
});

// ------------------------------------------------------------
// 4. Source-level: validation happens before openUrl, and the
//    pre-existing platform security controls are still intact.
// ------------------------------------------------------------
test('source: auth URL is validated before it reaches openUrl', () => {
  const src = read('electron/agent/mcpOAuth.ts');
  const iGuard = src.indexOf('assertSafeExternalUrl(meta.authorizationEndpoint)');
  const iOpen = src.indexOf('opts.openUrl(authUrl.toString())');
  assert.ok(iGuard > 0, 'startOAuthFlow calls assertSafeExternalUrl');
  assert.ok(iOpen > iGuard, 'guard runs before openUrl');
});

test('Electron upgrade is real and the allowScripts pin matches', () => {
  const pkg = JSON.parse(read('package.json'));
  const pinned = String(pkg.devDependencies.electron).replace(/^\^/, '');
  assert.notEqual(pinned, '33.4.11', 'no longer pinned to the 2-year-old Electron 33');
  assert.ok(Number(pinned.split('.')[0]) >= 34, 'Electron major >= 34');
  assert.equal(pkg.allowScripts[`electron@${pinned}`], true, 'allowScripts pin tracks the installed Electron');
});

test('platform security invariants retained after the upgrade', () => {
  const yml = read('electron-builder.yml');
  assert.match(yml, /schemes:\s*\[sadeem\]/, 'sadeem:// deep link still registered');
  assert.doesNotMatch(yml, /schemes:\s*\[\s*surnia/, 'surnia:// is NOT registered with the OS');

  const main = read('electron/main.ts');
  assert.ok(main.includes("script-src 'self' surnia:"), 'CSP script-src base intact');
  assert.ok(main.includes('csp-hashes.json'), 'CSP sidecar hashes still consumed');
  assert.match(main, /surnia:\/\/bundle\/index\.html/, 'surnia://bundle/ renderer origin intact');
  assert.match(main, /BrowserWindow\.fromWebContents\(event\.sender\)/, 'IPC sender check intact');
  assert.match(main, /parsed\.protocol === 'http:' \|\| parsed\.protocol === 'https:'/, 'openExternal hop-by-hop scheme check intact');
});
