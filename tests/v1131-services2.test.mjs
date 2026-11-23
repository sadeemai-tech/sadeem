import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.31 — CAPABILITY AGENT: API / REMOTE / DEVICE / APPROVAL / STORE
//
// Executes the REAL main-process services (esbuild bundle + isolated userData)
// to prove the hardening contract:
//   1. storeService   — failover strict-OFF (defaults/migration/profile path),
//                       remote pairing token encrypted at rest.
//   2. approvalPolicy — allow-once / always / deny / standing-deny, no silent
//                       coercion of unknown actions, no silent write failure.
//   3. deviceService  — local-account fingerprint + device registration guard.
//   4. apiServer      — sliding-window rate limit, redaction, path jail,
//                       rebinding/origin gates on a REAL loopback server.
//   5. remoteService  — one-use TTL pairing deep links, local-account guard,
//                       registered-device sender checks, strict approvals.
//
// Run: node --test --test-force-exit tests/v1131-services2.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createServer as createNetServer } from 'node:net';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1131-svc2-'));
const userData = join(tmp, 'userData');
mkdirSync(userData, { recursive: true });
process.env.SADEEM_TEST_USERDATA = userData;
process.env.SURNIA_NO_BROWSER = '1';

function bundle(entry, out) {
  execFileSync(
    ESBUILD_NODE,
    [ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
      '--log-level=error', '--external:electron', '--external:@xterm/xterm',
      '--external:@xterm/addon-fit', '--external:monaco-editor', '--external:@monaco-editor/react'],
    { cwd: ROOT, stdio: 'pipe' },
  );
  return require(out);
}

// ---------- electron stub (safeStorage keychain + all device APIs) ----------
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `const UD = ${JSON.stringify(userData)};
   class StubWC { on(){} send(){} setWindowOpenHandler(){} async printToPDF(){ return Buffer.from(''); } }
   class StubWin { constructor(){ this.webContents = new StubWC(); } }
   StubWin.getAllWindows = () => [];
   module.exports = {
     app: { getPath: (k) => (process.env.SADEEM_TEST_USERDATA || UD), whenReady: async()=>true, on(){}, quit(){}, getAppMetrics: ()=>[] },
     ipcMain: { handle(){}, on(){}, removeAllListeners(){} },
     safeStorage: {
       isEncryptionAvailable: () => true,
       encryptString: (s) => Buffer.from(Buffer.from(String(s),'utf8').toString('base64'),'utf8'),
       decryptString: (b) => Buffer.from(b.toString(),'base64').toString('utf8'),
     },
     BrowserWindow: StubWin,
     desktopCapturer: { getSources: async () => [] },
     screen: { getDisplayMatching: () => ({ id: 1 }) },
     clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
     shell: { openExternal: async()=>{}, openPath: async()=>'', showItemInFolder(){}, trashItem: async()=>{} },
     Notification: { isSupported: () => false },
   };`,
);

// ---------- real service bundles ----------
const store = bundle(join(ROOT, 'electron/services/storeService.ts'), join(tmp, 'storeService.cjs'));
const policy = bundle(join(ROOT, 'electron/services/approvalPolicyService.ts'), join(tmp, 'policy.cjs'));
const device = bundle(join(ROOT, 'electron/services/deviceService.ts'), join(tmp, 'device.cjs'));
const apiServer = bundle(join(ROOT, 'electron/services/apiServerService.ts'), join(tmp, 'apiServer.cjs'));
const remote = bundle(join(ROOT, 'electron/services/remoteService.ts'), join(tmp, 'remote.cjs'));

const settingsFile = join(userData, 'settings.json');
const readRaw = () => JSON.parse(readFileSync(settingsFile, 'utf8'));
const writeRaw = (obj) => {
  mkdirSync(userData, { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(obj, null, 2), { encoding: 'utf8' });
};

// ============================================================
// 1 · storeService — defaults / migrations / profile-import path
// ============================================================
test('store: failover default is literal false and the normalizer rejects stale truthy', () => {
  assert.equal(store.DEFAULT_SETTINGS.agent.allowModelFailover, false);
  for (const bad of [undefined, null, 'true', '1', 1, {}, []]) {
    assert.equal(store.normalizeAllowModelFailover(bad), false, `stale ${JSON.stringify(bad)} must be OFF`);
  }
  assert.equal(store.normalizeAllowModelFailover(true), true, 'explicit opt-in survives');
});

test('store: migration canonicalizes failover OFF even when the v2 file has no agent block', () => {
  writeRaw({ schemaVersion: 2, language: 'en', model: { provider: 'anthropic', model: 'claude-sonnet-4-5' } });
  store.invalidateSettingsCache();
  assert.equal(store.getSettings().agent.allowModelFailover, false);
  assert.equal(readRaw().agent.allowModelFailover, false, 'canonical value is persisted on disk');
});

test('store: profile-import path (saveSettings wholesale) cannot re-enable a stale truthy flag', () => {
  writeRaw({ schemaVersion: 4, language: 'en' });
  store.invalidateSettingsCache();
  store.saveSettings({ language: 'en', agent: { allowModelFailover: 'yes' } });
  assert.equal(readRaw().agent.allowModelFailover, false);
  assert.equal(store.getSettings().agent.allowModelFailover, false);
});

test('store: remote pairing token is encrypted at rest and decrypts main-side', () => {
  const TOKEN = 'r1234567890abcdefgh'; // 20 chars, like the real pairing token
  store.saveSettings({ remote: { enabled: true, port: 48888, token: TOKEN } });
  const disk = readFileSync(settingsFile, 'utf8');
  assert.ok(!disk.includes(TOKEN), 'raw remote token never lands in settings.json');
  assert.match(disk, /"remote"\s*:\s*\{[\s\S]*"token"\s*:\s*"enc:/);
  assert.equal(store.getSettings().remote.token, TOKEN, 'main process decrypts it');
});

// ============================================================
// 2 · approvalPolicyService — explicit decisions, no silent bypass
// ============================================================
const WS = join(tmp, 'ws');
mkdirSync(WS, { recursive: true });

test('approval: rule keys match the engine discipline (scope-broadened commands)', () => {
  assert.equal(policy.ruleKeyFor('command', 'npm install'), 'cmd:npm install');
  assert.equal(policy.ruleKeyFor('command', 'git push --force'), 'cmd:git push');
  assert.equal(policy.ruleKeyFor('mcp', 'filesystem.read'), 'mcp:filesystem.read');
  assert.equal(policy.ruleKeyFor('write', ''), 'write');
});

test('approval: once=allow (no rule), always=persisted allow, deny=one-shot, never=standing deny', () => {
  policy.clearAll();
  const key = policy.ruleKeyFor('command', 'git status');
  const once = policy.decideApproval({ requestId: 'r1', workspace: WS, key, command: 'git status', action: 'once' });
  assert.deepEqual([once.ok, once.action, once.persisted], [true, 'allow', null]);
  assert.equal(policy.ruleDecision(WS, key), null, 'allow-once is NOT remembered');

  const always = policy.decideApproval({ requestId: 'r2', workspace: WS, key, command: 'git status', action: 'always' });
  assert.deepEqual([always.ok, always.action, always.persisted], [true, 'always', 'allow']);
  assert.equal(policy.ruleDecision(WS, key), 'allow', 'always is honored on the next read');

  const deny = policy.decideApproval({ requestId: 'r3', workspace: WS, key, command: 'git status', action: 'deny' });
  assert.deepEqual([deny.ok, deny.action, deny.persisted], [true, 'deny', null]);
  assert.equal(policy.ruleDecision(WS, key), 'allow', 'one-shot deny does not create a standing rule');

  const never = policy.decideApproval({ requestId: 'r4', workspace: WS, key, command: 'git status', action: 'never', actor: 'phone' });
  assert.equal(never.persisted, 'deny');
  assert.equal(policy.ruleDecision(WS, key), 'deny', 'DENY beats an existing ALLOW');
});

test('approval: unknown/typoed action fails closed instead of silently approving', () => {
  policy.clearAll();
  const key = policy.ruleKeyFor('command', 'rm -rf /');
  const r = policy.decideApproval({ requestId: 'r5', workspace: WS, key, command: 'rm -rf /', action: 'onc' });
  assert.equal(r.ok, false);
  assert.equal(r.action, 'deny');
  assert.equal(r.error, 'UNKNOWN_APPROVAL_ACTION');
  assert.equal(policy.ruleDecision(WS, key), null, 'nothing was persisted');
});

test('approval: a failed rule write is surfaced, not silently reported as success', () => {
  const before = process.env.SADEEM_TEST_USERDATA;
  const blocked = join(tmp, 'not-a-directory');
  writeFileSync(blocked, 'x');
  process.env.SADEEM_TEST_USERDATA = blocked; // mkdirSync(dir) now fails with ENOTDIR
  try {
    assert.throws(
      () => policy.decideApproval({ requestId: 'r6', workspace: WS, key: 'write', command: 'edit', action: 'always' }),
      /ENOTDIR|EEXIST/,
    );
  } finally {
    process.env.SADEEM_TEST_USERDATA = before;
  }
});

test('approval: revoke and clearAll remove both allow and deny rules', () => {
  policy.clearAll();
  const key = policy.ruleKeyFor('command', 'npm test');
  policy.decideApproval({ requestId: 'r7', workspace: WS, key, command: 'npm test', action: 'always' });
  assert.ok(policy.list(WS).total >= 1);
  assert.ok(policy.revoke(WS, key) >= 1);
  assert.equal(policy.ruleDecision(WS, key), null);
  policy.decideApproval({ requestId: 'r8', workspace: WS, key, command: 'npm test', action: 'never' });
  assert.ok(policy.clearAll() >= 1);
  assert.equal(policy.list().total, 0);
});

// ============================================================
// 3 · deviceService — registration + local-account guard
// ============================================================
test('device: local account fingerprint is stable and account mismatches are rejected', () => {
  const fp = device.localAccountFingerprint();
  assert.match(fp, /^[0-9a-f]{16}$/);
  assert.equal(fp, device.localAccountFingerprint());
  assert.throws(
    () => device.registerDevice({ name: 'Phone', account: 'ffffffffffffffff' }),
    /DEVICE_ACCOUNT_MISMATCH/,
  );
  assert.throws(() => device.registerDevice({ name: '' }), /DEVICE_NAME_REQUIRED/);
});

test('device: registration is idempotent, listable, and revocation fails closed', () => {
  device.clearRegisteredDevices();
  const fp = device.localAccountFingerprint();
  const a = device.registerDevice({ name: 'Pixel', platform: 'android', account: fp });
  const b = device.registerDevice({ name: 'Pixel', platform: 'android', account: fp });
  assert.equal(a.id, b.id, 're-pair upserts instead of duplicating');
  assert.equal(device.isDeviceRegistered(a.id), true);
  assert.ok(device.listRegisteredDevices().some((d) => d.id === a.id));
  assert.equal(device.isDeviceRegistered('bogus-device'), false);
  assert.equal(device.revokeDevice(a.id), 1);
  assert.equal(device.isDeviceRegistered(a.id), false, 'revoked device cannot send');
  device.clearRegisteredDevices();
});

// ============================================================
// 4 · apiServerService — limits, redaction, jail, HTTP gates
// ============================================================
test('api: sliding-window rate predicate prunes stale timestamps', () => {
  const now = Date.now();
  assert.equal(apiServer.rateLimited([now - 100, now - 50], 2, now), true);
  assert.equal(apiServer.rateLimited([now - 61_000, now - 50], 2, now), false);
  assert.equal(apiServer.rateLimited([], 1, now), false);
  const st = apiServer.apiRateLimitStatus();
  assert.ok(st.windowMs === 60_000 && st.maxRequests >= 1);
  assert.equal(typeof st.requestsInWindow, 'number');
});

test('api: secrets are redacted from every error surface', () => {
  const redacted = apiServer.redactSecrets('auth failed for sk-abcdef123456 and Bearer abcdef123456');
  assert.ok(!redacted.includes('sk-abcdef123456'));
  assert.ok(!redacted.includes('Bearer abcdef123456'));
  assert.match(redacted, /sk-…3456/, 'tail 4 kept for recognition, middle gone');
  assert.match(redacted, /«redacted»/);
});

test('api: workspace path jail rejects UNC / outside roots / traversal', () => {
  const s = { recentPaths: [WS] };
  assert.equal(apiServer.assertJailedWorkspace(WS, s), resolve(WS));
  assert.throws(() => apiServer.assertJailedWorkspace('\\\\server\\share\\x', s), /UNC|outside/);
  const outside = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc';
  assert.throws(() => apiServer.assertJailedWorkspace(outside, s), /outside the allowed roots/);
  assert.throws(() => apiServer.assertJailedWorkspace(WS + '/../escape', s), /outside the allowed roots/);
});

test('api: workspace symlink escaping the jail is refused', async (t) => {
  // A fixed root OUTSIDE home/cwd/recentPaths (tmpdir on Windows is inside home).
  const outside = process.platform === 'win32' ? 'C:\\Windows' : '/etc';
  const link = join(WS, 'escape-link');
  try {
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    t.skip('symlink creation requires elevated privileges on this platform');
    return;
  }
  t.after(() => rmSync(link, { force: true }));
  // The lexical jail passes (the link lives inside WS) but realpath escapes.
  const jailed = apiServer.assertJailedWorkspace(link, { recentPaths: [WS] });
  await assert.rejects(() => apiServer.assertRealWorkspaceJailed(jailed, { recentPaths: [WS] }), /escapes|outside/);
});

async function waitHttp(call, ready, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await call();
      if (ready(r)) return r;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('test server did not become ready');
}

// v11.34 — bind to a genuinely FREE port (port 0 assigns one) instead of a
// random guess that can collide with another listener under a parallel full
// suite. This was the intermittent "test server did not become ready" cause.
async function freePort() {
  return await new Promise((res, rej) => {
    const srv = createNetServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}
let API_PORT = 55000 + Math.floor(Math.random() * 1000);
async function httpRequest(path, { headers = {}, method = 'GET', host = `127.0.0.1:${API_PORT}`, body } = {}) {
  return new Promise((resolveReq, rejectReq) => {
    const req = http.request(
      { host: '127.0.0.1', port: API_PORT, path, method, headers: { Host: host, ...headers }, timeout: 4000 },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolveReq({ status: res.statusCode, body: data }));
      },
    );
    req.on('error', rejectReq);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

test('api HTTP: rebinding Host, missing token and foreign Origin are all refused', async (t) => {
  API_PORT = await freePort();
  await apiServer.apiServerConfigure({ enabled: true, port: API_PORT });
  t.after(() => apiServer.apiServerConfigure({ enabled: false }));
  // Wait for the socket to accept connections (any HTTP response proves the
  // server is listening); the exact 401/403/200 codes are asserted below.
  await waitHttp(() => httpRequest('/health'), (r) => typeof r.status === 'number');
  const rebound = await httpRequest('/health', { host: 'attacker.evil.com' });
  assert.equal(rebound.status, 403, 'DNS-rebinding Host rejected');
  const unauth = await httpRequest('/health');
  assert.equal(unauth.status, 401, 'missing token rejected');
  const status = await apiServer.apiServerStatus();
  assert.ok(status.token, 'token exposed while enabled');
  const ok = await httpRequest('/health', { headers: { Authorization: `Bearer ${status.token}` } });
  assert.equal(ok.status, 200);
  const foreign = await httpRequest('/abort', {
    method: 'POST', headers: { Authorization: `Bearer ${status.token}`, Origin: 'https://evil.example' },
    body: '{}',
  });
  assert.equal(foreign.status, 403, 'foreign Origin cannot drive a mutating route');
});

// ============================================================
// 5 · remoteService — pairing deep link + sender checks
// ============================================================
test('remote: pairing link is one-use, TTL-bound and bound to the local account', () => {
  const t0 = 1_700_000_000_000;
  const ch = remote.issuePairingChallenge(t0);
  assert.equal(ch.expiresAt - t0, 10 * 60 * 1000, '10-minute TTL');
  assert.equal(ch.account, device.localAccountFingerprint());
  assert.equal(remote.pairingState(ch.code, t0 + 1), 'valid');
  assert.equal(remote.pairingState(ch.code, ch.expiresAt), 'expired');

  // Wrong account: rejected AND the code is still usable (not burned).
  const wrong = remote.redeemPairingChallenge(
    { code: ch.code, account: 'ffffffffffffffff', name: 'Phone', platform: 'android' }, t0 + 1000,
  );
  assert.equal(wrong.ok, false);
  assert.equal(wrong.error, 'LOCAL_ACCOUNT_MISMATCH');
  assert.equal(remote.pairingState(ch.code, t0 + 1000), 'valid');

  const good = remote.redeemPairingChallenge(
    { code: ch.code, account: ch.account, name: 'Pixel', platform: 'android' }, t0 + 2000,
  );
  assert.equal(good.ok, true, JSON.stringify(good));
  assert.ok(good.token && good.token.length >= 20, 'persistent token returned exactly once');
  assert.ok(good.deviceId, 'paired device registered');
  assert.equal(remote.pairingState(ch.code, t0 + 3000), 'used', 'consumed code is tombstoned');

  const replay = remote.redeemPairingChallenge({ code: ch.code, account: ch.account }, t0 + 4000);
  assert.equal(replay.error, 'PAIRING_CODE_ALREADY_USED', 'second use refused');
  assert.equal(replay.token, undefined, 'no token on a replay');

  const expiredCh = remote.issuePairingChallenge(t0);
  const expired = remote.redeemPairingChallenge({ code: expiredCh.code, account: expiredCh.account }, expiredCh.expiresAt + 1);
  assert.equal(expired.error, 'PAIRING_CODE_EXPIRED');
});

test('remote: sender check requires the registered device and honors revocation', () => {
  const ch = remote.issuePairingChallenge();
  const r = remote.redeemPairingChallenge({ code: ch.code, account: ch.account, name: 'Sender-Phone' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(remote.verifyRemoteSender(r.deviceId, ch.account), true);
  assert.equal(remote.verifyRemoteSender('unknown-device'), false);
  assert.equal(remote.verifyRemoteSender(r.deviceId, 'ffffffffffffffff'), false, 'account header mismatch');
  device.revokeDevice(r.deviceId);
  assert.equal(remote.verifyRemoteSender(r.deviceId, ch.account), false, 'revoked device is refused');
  device.clearRegisteredDevices();
});

test('remote: QR deep link carries a one-use code, never the raw token', async (t) => {
  const port = 56000 + Math.floor(Math.random() * 1000);
  const statusBefore = await remote.remoteStatus();
  const st = await remote.remoteConfigure({ enabled: true, port });
  t.after(() => remote.remoteConfigure({ enabled: false }));
  const status = await remote.remoteStatus();
  assert.equal(status.enabled, true);
  assert.ok(status.pairingExpiresAt > Date.now());
  assert.ok(status.qrDataUrl, 'QR produced');
  if (status.url) {
    assert.ok(status.url.includes('#p='), 'deep link carries the pairing code');
    assert.ok(!status.url.includes('#t='), 'raw token is never embedded in the QR URL');
    store.invalidateSettingsCache();
    const rawToken = store.getSettings().remote?.token ?? '';
    assert.ok(rawToken && !status.url.includes(rawToken), 'the persistent token never appears in the deep link');
  }
  assert.ok(statusBefore.tokenMasked, 'masked token always present in status');
});

test('remote: unknown approval decisions are rejected (no silent approve-once fallback)', async (t) => {
  const ch = remote.issuePairingChallenge();
  const paired = remote.redeemPairingChallenge({ code: ch.code, account: ch.account, name: 'Approve-Phone' });
  assert.equal(paired.ok, true, JSON.stringify(paired));
  const port = 57000 + Math.floor(Math.random() * 1000);
  await remote.remoteConfigure({ enabled: true, port });
  t.after(() => remote.remoteConfigure({ enabled: false }));
  // Rebound Host / foreign Origin are refused before any token handling.
  const sendRaw = (path, opts) => new Promise((resolveReq, rejectReq) => {
    const req = http.request({ host: '127.0.0.1', port, path, ...opts }, (res) => {
      res.resume();
      res.on('end', () => resolveReq(res.statusCode));
    });
    req.on('error', rejectReq);
    req.end();
  });
  await waitHttp(() => sendRaw('/api/state', { method: 'GET' }), (s) => s === 401 || s === 403);
  assert.equal(await sendRaw('/api/state', { method: 'GET', headers: { Host: 'evil.example' } }), 403);
  assert.equal(await sendRaw('/api/pair', { method: 'POST', headers: { Origin: 'https://evil.example' } }), 403);

  // A valid token must accompany the device header.
  store.invalidateSettingsCache();
  const token = store.getSettings().remote?.token ?? '';
  assert.ok(token, 'a paired remote token exists');
  const bad = await new Promise((resolveReq, rejectReq) => {
    const data = JSON.stringify({ requestId: 'req-x', decision: 'banana' });
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/approve?t=' + encodeURIComponent(token), method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data),
          'X-Sadeem-Device': paired.deviceId } },
      (res) => { let out = ''; res.on('data', (c) => (out += c)); res.on('end', () => resolveReq({ status: res.statusCode, body: out })); },
    );
    req.on('error', rejectReq);
    req.write(data); req.end();
  });
  assert.equal(bad.status, 400, 'bogus decision is refused, not coerced to allow-once');
  assert.match(bad.body, /decision must be/);
});
