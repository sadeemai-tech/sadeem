// ============================================================
// SADEEM v11.13 — LAUNCH AUDIT CONTRACT (source-level invariants)
// ============================================================
// Deterministic, offline, no Electron required. These tests lock down the
// safety invariants verified by docs/LAUNCH-AUDIT.md. They FAIL loudly if a
// future edit weakens one of them. They intentionally do NOT assert the
// *absence* of known open findings (those are tracked in the report, not
// frozen into a test that would have to be deleted when they are fixed).
//
// Run: node --test --test-force-exit tests/v1113-audit.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function walk(rel) {
  const base = join(ROOT, rel);
  const out = [];
  if (!existsSync(base)) return out;
  for (const e of readdirSync(base, { withFileTypes: true })) {
    const p = join(base, e.name);
    if (e.isDirectory()) out.push(...walk(relative(ROOT, p)));
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) out.push(relative(ROOT, p));
  }
  return out;
}

// ------------------------------------------------------------
// 1. Auto-updater: HTTPS-only feed, no silent auto-download.
// ------------------------------------------------------------
test('updater feed accepts only https (plus loopback http for dev), autoDownload off', () => {
  const s = read('electron/services/updateService.ts');
  assert.match(s, /u\.protocol === 'https:'/);
  assert.ok(s.includes('localhost') && s.includes('::1'), 'loopback http dev exception must be explicit');
  assert.match(s, /autoUpdater\.autoDownload = false/);
  assert.match(s, /provider: 'generic', url: feedUrl\(\)/);
  // no ftp/file/javascript feed can be persisted — sanitizer returns '' for them
  assert.match(s, /export function sanitizeFeedUrl/);
});

// ------------------------------------------------------------
// 2. Website deep-link pairing: 15-min TTL, single-use, 6-char code.
// ------------------------------------------------------------
test('pair code has a 15-minute TTL and is consumed on first use', () => {
  const s = read('electron/services/authService.ts');
  assert.match(s, /PAIR_TTL_MS = 15 \* 60 \* 1000/);
  assert.match(s, /pendingPairs\.delete\(pair\)/);
  assert.match(s, /Date\.now\(\) - pending\.createdAt > PAIR_TTL_MS/);
  assert.match(s, /const alphabet = '[A-Z0-9]+'/);
  // plan from the deep link is allow-listed, never trusted verbatim
  assert.match(s, /VALID_PLANS as readonly string\[\]\)\.includes\(rawPlan\)/);
});

// ------------------------------------------------------------
// 3. Deep-link callback shape is validated in main before dispatch.
// ------------------------------------------------------------
test('main process only accepts sadeem://auth/callback deep links', () => {
  const s = read('electron/main.ts');
  assert.match(s, /\^sadeem:\\\/\\\/auth\\\/callback\\\?\(\.\+\)\$/i);
  assert.match(s, /completeWebAuth\(payload\)/);
});

// ------------------------------------------------------------
// 4. No eval / Function constructor / dangerouslySetInnerHTML in renderer.
// ------------------------------------------------------------
test('renderer source contains no eval, Function constructor, or dangerouslySetInnerHTML', () => {
  const files = walk('src');
  assert.ok(files.length > 50, 'expected to scan the full renderer source tree');
  const bad = [];
  for (const f of files) {
    // strip comments so documentation like "never dangerouslySetInnerHTML" is not a false positive
    const s = readFileSync(join(ROOT, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    if (/\beval\s*\(/.test(s)) bad.push(`${f}:eval`);
    if (/new\s+Function\s*\(/.test(s)) bad.push(`${f}:new Function`);
    if (/dangerouslySetInnerHTML/.test(s)) bad.push(`${f}:dangerouslySetInnerHTML`);
  }
  assert.deepEqual(bad, [], `forbidden dynamic-code/HTML sinks: ${bad.join(', ')}`);
});

// ------------------------------------------------------------
// 5. Strict renderer CSP on the packaged app.
// ------------------------------------------------------------
test('renderer CSP forbids unsafe-eval, objects, plugins and framing', () => {
  const s = read('electron/main.ts');
  assert.match(s, /script-src 'self' surnia:/);
  assert.doesNotMatch(s, /script-src[^\n]*unsafe-eval/);
  assert.match(s, /object-src 'none'/);
  assert.match(s, /frame-ancestors 'none'/);
  assert.match(s, /content-security-policy': RENDERER_CSP/);
});

// ------------------------------------------------------------
// 6. Preload bridge is a closed kdx: allowlist, no raw ipcRenderer leak.
// ------------------------------------------------------------
test('preload exposes a frozen closed allowlist and never leaks ipcRenderer', () => {
  const s = read('electron/preload.ts');
  assert.match(s, /!channel\.startsWith\('kdx:'\)/);
  assert.match(s, /CHANNEL_FORBIDDEN/);
  assert.match(s, /contextBridge\.exposeInMainWorld\('surnia', Object\.freeze\(api\)\)/);
  assert.doesNotMatch(s, /exposeInMainWorld\(\s*['"]ipcRenderer/);
});

// ------------------------------------------------------------
// 7. Filesystem path jail: absolute paths, no traversal/UNC, realpath on writes.
// ------------------------------------------------------------
test('fs path jail rejects traversal and UNC and realpaths write targets', () => {
  const s = read('electron/services/fsService.ts');
  assert.match(s, /UNC_NOT_ALLOWED/);
  assert.match(s, /_TRAVERSAL/);
  assert.match(s, /_OUTSIDE_WORKSPACE/);
  assert.match(s, /assertSafeWritePath/);
  assert.match(s, /fsp\.realpath\(probe\)/);
  assert.match(s, /_PROTECTED_DIR/);
});

// ------------------------------------------------------------
// 8. Interactive terminal commands are classified before the shell.
// ------------------------------------------------------------
test('kdx:term:exec runs the guard before spawning a shell', () => {
  const s = read('electron/services/terminalService.ts');
  assert.match(s, /guardInteractive\(terminalId, cmd\)/);
  assert.match(s, /if \(guard\.blocked\)/);
  // the guard must arm before any spawn in exec()
  const execAt = s.indexOf('export async function exec(');
  const guardAt = s.indexOf('guardInteractive(terminalId, cmd)', execAt);
  const spawnAt = s.indexOf('spawn(file, args', execAt);
  assert.ok(execAt >= 0 && guardAt > execAt && spawnAt > guardAt, 'guard must precede spawn in exec()');
});

// ------------------------------------------------------------
// 9. Secrets never cross the bridge in cleartext.
// ------------------------------------------------------------
test('settings read/save mask API keys, Stripe key and API-server token for renderer', () => {
  const s = read('electron/ipc.ts');
  assert.match(s, /function maskSettingsForRenderer/);
  assert.match(s, /maskSecret\(entry\.apiKey\)/);
  assert.match(s, /stripeSecretKey[\s\S]{0,200}maskSecret/);
  assert.match(s, /apiServerCfg\.token[\s\S]{0,200}maskSecret/);
  assert.match(s, /return maskSettingsForRenderer\(s as unknown/);
});

// ------------------------------------------------------------
// 10. Tool catalogue floor (advertised count must not silently shrink).
// ------------------------------------------------------------
test('CORE_DEFS keeps at least 118 named tools', () => {
  const s = read('electron/agent/tool-defs.ts');
  const names = [...s.matchAll(/name:\s*'([a-zA-Z0-9_]+)'/g)].map((m) => m[1]);
  assert.ok(new Set(names).size >= 118, `expected >= 118 tools, found ${new Set(names).size}`);
  assert.match(s, /export function defsForProfile/);
});

// ------------------------------------------------------------
// 11. No removed/disallowed feature resurfaces in app source.
// ------------------------------------------------------------
test('scaffold/arena features are absent from app source', () => {
  const files = [...walk('electron'), ...walk('src')];
  const hits = [];
  for (const f of files) {
    const s = readFileSync(join(ROOT, f), 'utf8');
    if (/\b(scaffold|arena)\b/i.test(s)) hits.push(f);
  }
  assert.deepEqual(hits, [], `removed feature names reappeared in: ${hits.join(', ')}`);
});

// ------------------------------------------------------------
// 12. Published release hashes match the real artifacts (when present).
// ------------------------------------------------------------
test('SHA256SUMS.txt and latest.yml match the actual release artifacts', (t) => {
  const sums = read('website/public/downloads/SHA256SUMS.txt');
  const yml = read('website/public/updates/latest.yml');
  const artifacts = ['SADEEM-Setup-11.12.0.exe', 'SADEEM-11.12.0-win.zip'];
  let checked = 0;
  for (const name of artifacts) {
    const p = join(ROOT, 'website', 'public', 'downloads', name);
    if (!existsSync(p)) continue;
    const buf = readFileSync(p);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const sha512 = createHash('sha512').update(buf).digest('base64');
    assert.ok(sums.includes(`${sha256}  ${name}`), `SHA256SUMS mismatch for ${name}`);
    assert.ok(sums.includes(`sha512:${sha512}`), `SHA256SUMS sha512 mismatch for ${name}`);
    assert.ok(yml.includes(`sha512: '${sha512}'`), `latest.yml sha512 mismatch for ${name}`);
    assert.ok(yml.includes(`size: ${statSync(p).size}`), `latest.yml size mismatch for ${name}`);
    checked++;
  }
  if (!checked) return t.skip('release artifacts not present in this checkout');
  assert.equal(checked, artifacts.length);
});
