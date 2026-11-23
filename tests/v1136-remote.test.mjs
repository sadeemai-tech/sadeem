import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.36 — REMOTE / PHONE PAIRING (real main-process services)
//
// Root cause this suite pins down: the old lanAddress() ranked ONLY by the
// address prefix (192.168.* first) and returned preferred[0]. On a typical
// dev machine that is a VirtualBox host-only adapter (192.168.56.1), not the
// real Wi-Fi (192.168.1.24). The QR then pointed the phone at an address it
// has no route to — "SADEEM Remote doesn't work on the phone".
//
// Run: node --test --test-force-exit tests/v1136-remote.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createServer as createNetServer } from 'node:net';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
// The CJS module object is shared with the bundled services and is mutable
// (an ESM namespace import is read-only).
const os = require('node:os');
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1136-remote-'));
const userData = join(tmp, 'userData');
mkdirSync(userData, { recursive: true });
process.env.SADEEM_TEST_USERDATA = userData;
process.env.SURNIA_NO_BROWSER = '1';

// ---------- controlled network topology (the machine from the bug report) ----------
const NET_IFACES = {
  'Ethernet 2': [{ address: '192.168.56.1', family: 'IPv4', internal: false }], // VirtualBox host-only
  'Wi-Fi': [{ address: '192.168.1.24', family: 'IPv4', internal: false }], // the REAL phone route
  'vEthernet (WSL (Hyper-V firewall))': [{ address: '172.27.176.1', family: 'IPv4', internal: false }],
  'Loopback Pseudo-Interface 1': [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
};
let ifaceOverride = () => NET_IFACES;
os.networkInterfaces = () => JSON.parse(JSON.stringify(ifaceOverride()));

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

// ---------- electron stub (safeStorage keychain + device APIs) ----------
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `const UD = ${JSON.stringify(userData)};
   module.exports = {
     app: { getPath: (k) => (process.env.SADEEM_TEST_USERDATA || UD), whenReady: async()=>true, on(){}, quit(){}, getAppMetrics: ()=>[] },
     ipcMain: { handle(){}, on(){}, removeAllListeners(){} },
     safeStorage: {
       isEncryptionAvailable: () => true,
       encryptString: (s) => Buffer.from(Buffer.from(String(s),'utf8').toString('base64'),'utf8'),
       decryptString: (b) => Buffer.from(b.toString(),'base64').toString('utf8'),
     },
     BrowserWindow: class { constructor(){ this.webContents = { on(){}, send(){}, setWindowOpenHandler(){} }; } static getAllWindows(){ return []; } },
     desktopCapturer: { getSources: async () => [] },
     screen: { getDisplayMatching: () => ({ id: 1 }) },
     clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
     shell: { openExternal: async()=>{}, openPath: async()=>'', showItemInFolder(){}, trashItem: async()=>{} },
     Notification: { isSupported: () => false },
   };`,
);

// ---------- real service bundles ----------
const store = bundle(join(ROOT, 'electron/services/storeService.ts'), join(tmp, 'storeService.cjs'));
const device = bundle(join(ROOT, 'electron/services/deviceService.ts'), join(tmp, 'device.cjs'));
const remote = bundle(join(ROOT, 'electron/services/remoteService.ts'), join(tmp, 'remote.cjs'));

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

function httpReq(port, path, { method = 'GET', headers = {}, host, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request(
      { host: '127.0.0.1', port, path, method, timeout: 4000,
        headers: { Host: host ?? `127.0.0.1:${port}`, ...(data ? { 'content-length': Buffer.byteLength(data) } : {}), ...headers } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json;
          try { json = JSON.parse(raw); } catch { /* not json */ }
          resolve({ status: res.statusCode, body: raw, json });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}

async function waitHttp(call, ready, timeoutMs = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await call();
      if (ready(r)) return r;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('remote test server did not become ready');
}

function parsePairingUrl(u) {
  assert.equal(typeof u, 'string');
  const url = new URL(u);
  assert.equal(url.protocol, 'http:');
  const frag = new URLSearchParams(url.hash.slice(1));
  return {
    url,
    code: frag.get('p') ?? '',
    expiresAt: Number(frag.get('e') ?? 0),
    account: frag.get('a') ?? '',
    version: frag.get('v') ?? '',
  };
}

// ============================================================
// 1 · LAN selection — THE root-cause regression
// ============================================================
test('v1136: auto LAN pick prefers Wi-Fi over VirtualBox/WSL adapters', () => {
  const cands = remote.listLanCandidates();
  assert.ok(cands.some((c) => c.address === '192.168.1.24' && c.kind === 'wifi' && c.usable));
  assert.ok(cands.some((c) => c.address === '192.168.56.1' && !c.usable), 'VBox host-only is flagged unusable');
  const url = remote.buildPairingUrl();
  assert.equal(url.host, '192.168.1.24', 'the phone-reachable Wi-Fi IP, NOT 192.168.56.1');
  assert.equal(url.usable, true);
  assert.match(url.url, /^http:\/\/192\.168\.1\.24:\d+\/#p=/);
});

test('v1136: manual LAN override is honored and persisted across configure calls', async () => {
  const original = Object.assign({}, NET_IFACES);
  NET_IFACES.Ethernet = [{ address: '10.0.0.7', family: 'IPv4', internal: false }];
  try {
    const st = await remote.remoteConfigure({ host: '10.0.0.7' });
    const url1 = remote.buildPairingUrl();
    assert.equal(url1.host, '10.0.0.7');
    assert.match(url1.url, /^http:\/\/10\.0\.0\.7:/);
    // A second configure with an unrelated patch must NOT drop `host`.
    await remote.remoteConfigure({ port: st.port });
    const url2 = remote.buildPairingUrl();
    assert.equal(url2.host, '10.0.0.7', 'host survives a later configure');
    store.invalidateSettingsCache();
    assert.equal(store.getSettings().remote?.host, '10.0.0.7', 'host survives a settings round-trip');
  } finally {
    await remote.remoteConfigure({ host: '' });
    for (const k of Object.keys(NET_IFACES)) if (!(k in original)) delete NET_IFACES[k];
  }
});

test('v1136: unreachable manual IP and no-LAN topology give distinct actionable errors', async () => {
  await remote.remoteConfigure({ host: '8.8.8.8' }); // not one of our interfaces
  let st = await remote.remoteStatus();
  assert.equal(st.errorCode, 'LAN_HOST_NOT_FOUND');
  assert.ok(remote.remoteErrorText('LAN_HOST_NOT_FOUND').length > 10);

  await remote.remoteConfigure({ host: '' });
  const saved = ifaceOverride;
  ifaceOverride = () => ({ 'Loopback Pseudo-Interface 1': [{ address: '127.0.0.1', family: 'IPv4', internal: true }] });
  try {
    assert.equal(remote.listLanCandidates().length, 0);
    const url = remote.buildPairingUrl();
    assert.equal(url.usable, false, 'no silent "success" with a localhost-only URL');
    st = await remote.remoteStatus();
    assert.equal(st.errorCode, 'NO_LAN_ADDRESS');
  } finally {
    ifaceOverride = saved;
  }
});

// ============================================================
// 2 · QR payload — camera-scannable, LAN URL, code not token
// ============================================================
test('v1136: QR payload is well-formed, LAN-addressed and carries no token', async (t) => {
  const port = await freePort();
  await remote.remoteConfigure({ enabled: true, port, host: '' });
  t.after(() => remote.remoteConfigure({ enabled: false, host: '' }));
  await waitHttp(() => httpReq(port, '/api/state'), (r) => r.status === 401 || r.status === 200);

  // The phone page itself must be served with the shared error taxonomy and
  // the registered-device header (no generic "pairing failed" any more).
  const page = await httpReq(port, '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /const ERRTXT=/);
  assert.match(page.body, /X-Sadeem-Device/);
  assert.match(page.body, /NO_LAN_ADDRESS/);

  const st = await remote.remoteStatus();
  assert.equal(st.enabled, true);
  assert.ok(st.qrDataUrl && st.qrDataUrl.startsWith('data:image/png;base64,'), 'PNG QR produced');
  const png = Buffer.from(st.qrDataUrl.split(',')[1], 'base64');
  assert.ok(png.length > 500, 'larger than a tiny low-margin QR');
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', 'real PNG signature');

  const p = parsePairingUrl(st.url);
  assert.ok(p.url.hostname !== '127.0.0.1' && p.url.hostname !== 'localhost', 'LAN host, not localhost');
  assert.equal(p.url.port, String(port));
  assert.equal(p.version, '1');
  assert.match(p.code, /^[A-Za-z0-9_-]{16,64}$/, 'one-use code is URL-safe');
  assert.ok(p.expiresAt > Date.now(), 'expiry in the future');
  assert.match(p.account, /^[0-9a-f]{16}$/, 'local account fingerprint');
  assert.equal(p.url.hash.includes('#t='), false, 'no raw token in QR');
  store.invalidateSettingsCache();
  const rawToken = store.getSettings().remote?.token ?? '';
  assert.ok(rawToken && !st.url.includes(rawToken), 'persistent token never embedded');
});

// ============================================================
// 3 · Real phone redemption over HTTP + sender verification
// ============================================================
test('v1136: issue → redeem as a phone → token and registered device work', async (t) => {
  const port = await freePort();
  await remote.remoteConfigure({ enabled: true, port, host: '' });
  t.after(() => {
    device.clearRegisteredDevices();
    return remote.remoteConfigure({ enabled: false });
  });
  await waitHttp(() => httpReq(port, '/api/state'), (r) => r.status === 401 || r.status === 200);

  // Simulate the phone reading the QR fragment.
  const st = await remote.remoteStatus();
  const p = parsePairingUrl(st.url);
  assert.equal(remote.pairingState(p.code), 'valid');

  const redeem = await httpReq(port, '/api/pair', {
    method: 'POST',
    body: { code: p.code, expiresAt: p.expiresAt, account: p.account, name: 'Pixel 8', platform: 'android' },
  });
  assert.equal(redeem.status, 200, redeem.body);
  assert.equal(redeem.json.ok, true);
  assert.ok(redeem.json.token && redeem.json.token.length >= 20, 'persistent token returned');
  assert.ok(redeem.json.deviceId, 'phone registered as a device');
  assert.equal(remote.pairingState(p.code), 'used', 'code consumed');

  // Token works on the read API.
  const state = await httpReq(port, `/api/state?t=${encodeURIComponent(redeem.json.token)}`);
  assert.equal(state.status, 200);
  assert.equal(state.json.ok, true);

  // Token + registered device work on a mutating route.
  const okAbort = await httpReq(port, `/api/abort?t=${encodeURIComponent(redeem.json.token)}`, {
    method: 'POST', headers: { 'X-Sadeem-Device': redeem.json.deviceId },
  });
  assert.equal(okAbort.status, 200, okAbort.body);

  // Direct service-level sender check agrees.
  assert.equal(remote.verifyRemoteSender(redeem.json.deviceId, p.account), true);
});

test('v1136: wrong / missing device is rejected with distinct actionable errors', async (t) => {
  const port = await freePort();
  await remote.remoteConfigure({ enabled: true, port, host: '' });
  t.after(() => {
    device.clearRegisteredDevices();
    return remote.remoteConfigure({ enabled: false });
  });
  await waitHttp(() => httpReq(port, '/api/state'), (r) => r.status === 401 || r.status === 200);
  store.invalidateSettingsCache();
  const token = store.getSettings().remote?.token ?? '';
  assert.ok(token);

  const missing = await httpReq(port, `/api/abort?t=${encodeURIComponent(token)}`, { method: 'POST' });
  assert.equal(missing.status, 403);
  assert.equal(missing.json.error, 'MISSING_DEVICE_HEADER');
  assert.ok(missing.json.hint, 'actionable hint present');

  const bogus = await httpReq(port, `/api/abort?t=${encodeURIComponent(token)}`, {
    method: 'POST', headers: { 'X-Sadeem-Device': 'not-a-registered-device' },
  });
  assert.equal(bogus.status, 403);
  assert.equal(bogus.json.error, 'DEVICE_NOT_REGISTERED');

  assert.equal(remote.verifyRemoteSender('not-a-registered-device'), false);
});

test('v1136: used, expired, malformed and wrong-account codes each fail distinctly', () => {
  const fp = device.localAccountFingerprint();

  const ch = remote.issuePairingChallenge();
  const good = remote.redeemPairingChallenge({ code: ch.code, account: fp, name: 'Phone' });
  assert.equal(good.ok, true, JSON.stringify(good));
  const replay = remote.redeemPairingChallenge({ code: ch.code, account: fp });
  assert.equal(replay.error, 'PAIRING_CODE_ALREADY_USED');
  assert.equal(replay.token, undefined, 'no token on replay');

  const t0 = 1_700_000_000_000;
  const exp = remote.issuePairingChallenge(t0);
  const expired = remote.redeemPairingChallenge(
    { code: exp.code, account: exp.account }, exp.expiresAt + 1,
  );
  assert.equal(expired.error, 'PAIRING_CODE_EXPIRED');

  const wrong = remote.issuePairingChallenge();
  const mismatch = remote.redeemPairingChallenge(
    { code: wrong.code, account: 'ffffffffffffffff', name: 'Phone' },
  );
  assert.equal(mismatch.error, 'LOCAL_ACCOUNT_MISMATCH');
  assert.equal(remote.pairingState(wrong.code), 'valid', 'wrong account does not burn the code');

  const malformed = remote.redeemPairingChallenge({ code: 'short', account: fp });
  assert.equal(malformed.error, 'PAIRING_CODE_MALFORMED');
  const unknown = remote.redeemPairingChallenge({ code: 'A'.repeat(24), account: fp });
  assert.equal(unknown.error, 'INVALID_PAIRING_CODE');

  device.clearRegisteredDevices();
});

test('v1136: Host and Origin rebinding still rejected with distinct codes', async (t) => {
  const port = await freePort();
  await remote.remoteConfigure({ enabled: true, port, host: '' });
  t.after(() => remote.remoteConfigure({ enabled: false }));
  await waitHttp(() => httpReq(port, '/api/state'), (r) => typeof r.status === 'number');

  const rebound = await httpReq(port, '/api/state', { host: 'attacker.evil.example' });
  assert.equal(rebound.status, 403);
  assert.equal(rebound.json.error, 'FORBIDDEN_HOST');

  const foreign = await httpReq(port, '/api/abort', {
    method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}',
  });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.json.error, 'FORBIDDEN_ORIGIN');
});

test('v1136: every RemoteErrorCode has EN and AR actionable text', () => {
  const codes = [
    'INVALID_PAIRING_CODE', 'PAIRING_CODE_MALFORMED', 'PAIRING_CODE_EXPIRED',
    'PAIRING_CODE_ALREADY_USED', 'LOCAL_ACCOUNT_MISMATCH', 'DEVICE_REGISTRATION_FAILED',
    'MISSING_DEVICE_HEADER', 'DEVICE_NOT_REGISTERED', 'ACCOUNT_MISMATCH',
    'DEVICE_TOUCH_FAILED', 'BAD_PAIRING_TOKEN', 'FORBIDDEN_HOST', 'FORBIDDEN_ORIGIN',
    'NO_LAN_ADDRESS', 'LAN_HOST_NOT_FOUND', 'LAN_UNREACHABLE',
  ];
  for (const code of codes) {
    assert.ok(remote.REMOTE_ERROR_TEXT[code]?.en, `${code} has EN text`);
    assert.ok(remote.REMOTE_ERROR_TEXT[code]?.ar, `${code} has AR text`);
    assert.notEqual(remote.remoteErrorText(code, false), code, `${code} is humanized in EN`);
  }
});
