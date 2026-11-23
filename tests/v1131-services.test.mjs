import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.31 — CAPABILITY SERVICE AUDIT (notify / tray / window /
// update / log / feedback), driven with REAL temp files and a mocked
// Electron module. Every module under test is bundled from the REAL
// TypeScript source with esbuild; only `electron` (and the lazily
// imported electron-updater) are stubbed.
//
//   node --test --test-force-exit tests/v1131-services.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1131-services-'));
const UD = join(tmp, 'userdata');
mkdirSync(UD, { recursive: true });

function bundle(entry, out) {
  execFileSync(
    ESBUILD_NODE,
    [
      ESBUILD_BIN, join(ROOT, entry), '--bundle', '--platform=node', '--format=cjs',
      `--outfile=${out}`, '--external:electron', '--external:electron-updater',
      '--log-level=error',
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
}

// ------------------------------------------------------------
// Electron stub — mutable state lives on globalThis so each test can
// reset it without re-bundling.
// ------------------------------------------------------------
globalThis.__svcStub = {
  notifications: [], windows: [], trays: [], ipc: {},
  displays: [{ x: 0, y: 0, width: 1920, height: 1080 }],
  supported: true, permission: 'granted',
  notificationThrow: false, trayThrow: false, traySetupThrow: false,
  quitCount: 0,
};
const STUB_DIR = join(tmp, 'node_modules', 'electron');
mkdirSync(STUB_DIR, { recursive: true });
writeFileSync(join(STUB_DIR, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(STUB_DIR, 'index.js'), `
const S = globalThis.__svcStub;
const UD = ${JSON.stringify(UD)};
class FakeNotification {
  constructor(opts) { this.opts = opts; this.handlers = {}; }
  on(ev, cb) { this.handlers[ev] = cb; return this; }
  show() { if (S.notificationThrow) throw new Error('notification boom'); S.notifications.push(this); }
  click() { if (this.handlers.click) this.handlers.click(); }
  static isSupported() { return S.supported !== false; }
  static get permission() { return S.permission; }
}
class FakeTray {
  constructor(icon) {
    if (S.trayThrow) throw new Error('tray boom');
    this.icon = icon; this.menu = null; this.tooltip = null;
    this.handlers = {}; this.destroyed = false; S.trays.push(this);
  }
  setContextMenu(m) { if (S.traySetupThrow) throw new Error('menu boom'); this.menu = m; }
  setToolTip(t) { if (S.traySetupThrow) throw new Error('tooltip boom'); this.tooltip = t; }
  on(ev, cb) { this.handlers[ev] = cb; }
  destroy() { this.destroyed = true; }
}
const app = {
  getPath: () => UD,
  getVersion: () => '11.31.0-test',
  getName: () => 'sadeem',
  getLocale: () => 'en',
  isReady: () => true,
  whenReady: async () => undefined,
  quit: () => { S.quitCount++; },
};
const screen = {
  getPrimaryDisplay: () => ({ workArea: S.displays[0] || { x: 0, y: 0, width: 1920, height: 1080 } }),
  getAllDisplays: () => S.displays.map((d) => ({ workArea: d })),
};
module.exports = {
  app, screen,
  Notification: FakeNotification,
  Tray: FakeTray,
  BrowserWindow: { getAllWindows: () => S.windows },
  Menu: { buildFromTemplate: (tpl) => tpl },
  nativeImage: { createFromPath: (p) => ({ path: p }), createEmpty: () => ({ empty: true }) },
  ipcMain: { handle: (ch, fn) => { S.ipc[ch] = fn; }, on: () => undefined },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s) => Buffer.from(String(s)),
    decryptString: (b) => String(b),
  },
};
`);

const BUNDLES = {
  notify: { src: 'notifyService.ts', out: join(tmp, 'notify.cjs') },
  tray: { src: 'trayService.ts', out: join(tmp, 'tray.cjs') },
  window: { src: 'windowStateService.ts', out: join(tmp, 'window.cjs') },
  update: { src: 'updateService.ts', out: join(tmp, 'update.cjs') },
  log: { src: 'logService.ts', out: join(tmp, 'log.cjs') },
  feedback: { src: 'feedbackService.ts', out: join(tmp, 'feedback.cjs') },
};
for (const { src, out } of Object.values(BUNDLES)) {
  bundle(`electron/services/${src}`, out);
}

function fresh(name) {
  const file = BUNDLES[name].out;
  delete require.cache[require.resolve(file)];
  return require(file);
}

function resetStub() {
  const S = globalThis.__svcStub;
  S.notifications.length = 0;
  S.windows.length = 0;
  S.trays.length = 0;
  S.ipc = {};
  S.displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];
  S.supported = true;
  S.permission = 'granted';
  S.notificationThrow = false;
  S.trayThrow = false;
  S.traySetupThrow = false;
  S.quitCount = 0;
}

/** Keep the test runner output clean while asserting on log bytes. */
function silent(fn) {
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = function (chunk) { chunks.push(String(chunk)); return true; };
  try {
    fn();
  } finally {
    process.stdout.write = orig;
  }
  return chunks.join('');
}

function liveWindow(overrides = {}) {
  const w = {
    shown: 0, focused: 0, restored: 0, hidden: 0,
    isDestroyed: () => false,
    isFocused: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    restore() { this.restored++; },
    show() { this.shown++; },
    focus() { this.focused++; },
    hide() { this.hidden++; },
    ...overrides,
  };
  return w;
}

// ============================================================
// 1. NOTIFICATIONS — dedup / permission / click
// ============================================================
test('N1 notify: fires once, dedups identical title+body, reset re-enables', () => {
  resetStub();
  const n = fresh('notify');
  n.resetNotifyState();
  assert.equal(n.notificationPermission(), 'granted');

  n.notifyAgentDone('Build done', 'All green');
  assert.equal(globalThis.__svcStub.notifications.length, 1, 'first notification shown');
  assert.equal(globalThis.__svcStub.notifications[0].opts.title, 'Build done');
  assert.equal(globalThis.__svcStub.notifications[0].opts.body, 'All green');

  n.notifyAgentDone('Build done', 'All green');
  assert.equal(globalThis.__svcStub.notifications.length, 1, 'duplicate suppressed by dedup');

  n.resetNotifyState();
  n.notifyAgentDone('Build done', 'All green');
  assert.equal(globalThis.__svcStub.notifications.length, 2, 'reset clears dedup state');
});

test('N2 notify: permission denied / unsupported is surfaced, never silent', () => {
  resetStub();
  const n = fresh('notify');
  n.resetNotifyState();
  globalThis.__svcStub.permission = 'denied';
  assert.equal(n.notificationPermission(), 'denied');
  const logs = silent(() => n.notifyError('oops', 'failed'));
  assert.equal(globalThis.__svcStub.notifications.length, 0, 'denied → no OS toast');
  assert.match(logs, /permission=denied/, 'the reason is logged');

  resetStub();
  const n2 = fresh('notify');
  n2.resetNotifyState();
  globalThis.__svcStub.supported = false;
  assert.equal(n2.notificationPermission(), 'unsupported');
  n2.notifyError('oops', 'failed');
  assert.equal(globalThis.__svcStub.notifications.length, 0, 'unsupported → no toast');
});

test('N3 notify: cooldown suppresses a burst of DIFFERENT toasts', () => {
  resetStub();
  const n = fresh('notify');
  n.resetNotifyState();
  n.notifyAgentDone('A', 'first');
  n.notifyError('B', 'second');
  assert.equal(globalThis.__svcStub.notifications.length, 1, 'global cooldown active');
});

test('N4 notify: focused app suppresses toast; click focuses a LIVE window', () => {
  resetStub();
  const n = fresh('notify');
  n.resetNotifyState();
  const focused = liveWindow({ isFocused: () => true });
  globalThis.__svcStub.windows = [focused];
  n.notifyAgentDone('Done', 'body');
  assert.equal(globalThis.__svcStub.notifications.length, 0, 'user is already in the app');

  resetStub();
  const n2 = fresh('notify');
  n2.resetNotifyState();
  const destroyed = liveWindow({ isDestroyed: () => true, show() { throw new Error('dead window touched'); } });
  const good = liveWindow();
  globalThis.__svcStub.windows = [destroyed, good];
  n2.notifyAgentDone('Done', 'body');
  assert.equal(globalThis.__svcStub.notifications.length, 1);
  globalThis.__svcStub.notifications[0].click();
  assert.equal(good.shown, 1, 'live window shown');
  assert.equal(good.focused, 1, 'live window focused');
  assert.equal(destroyed.shown, 0, 'destroyed window never touched');
});

test('N5 notify: a Notification.show() failure is logged, never thrown', () => {
  resetStub();
  const n = fresh('notify');
  n.resetNotifyState();
  globalThis.__svcStub.notificationThrow = true;
  const logs = silent(() => n.notifyApprovalNeeded('Approve me'));
  assert.match(logs, /show failed: notification boom/, 'failure is visible in logs');
  assert.equal(globalThis.__svcStub.notifications.length, 0);
});

// ============================================================
// 2. TRAY — menu actions + honest active state
// ============================================================
test('T1 tray: init builds Show/Quit menu, actions work, destroy deactivates', () => {
  resetStub();
  const tray = fresh('tray');
  const win = liveWindow();
  assert.equal(tray.isTrayActive(), false);
  tray.initTray(() => win);
  assert.equal(tray.isTrayActive(), true);
  const t = globalThis.__svcStub.trays[0];
  assert.equal(t.tooltip, 'Surnia');
  const labels = t.menu.map((i) => i.label);
  assert.deepEqual(labels, ['Show Surnia', undefined, 'Quit'], 'menu has Show / separator / Quit');

  t.menu[0].click(); // Show Surnia
  assert.equal(win.shown, 1, 'Show action focuses the window');
  assert.equal(win.focused, 1);

  t.handlers.click(); // left click while visible → hide
  assert.equal(win.hidden, 1, 'left click toggles to hidden');
  win.isVisible = () => false;
  t.handlers.click(); // hidden → show
  assert.equal(win.shown, 2, 'left click restores a hidden window');

  t.menu[2].click(); // Quit
  assert.equal(globalThis.__svcStub.quitCount, 1, 'Quit action quits the app');

  tray.destroyTray();
  assert.equal(t.destroyed, true);
  assert.equal(tray.isTrayActive(), false);
});

test('T2 tray: a failed setup destroys the partial tray and stays inactive', () => {
  resetStub();
  globalThis.__svcStub.traySetupThrow = true;
  const tray = fresh('tray');
  const win = liveWindow();
  const logs = silent(() => tray.initTray(() => win));
  assert.equal(tray.isTrayActive(), false, 'no false "active" claim');
  assert.equal(globalThis.__svcStub.trays[0].destroyed, true, 'partial tray destroyed, not leaked');
  assert.match(logs, /disabled: menu boom/, 'failure reason is logged');

  resetStub();
  globalThis.__svcStub.trayThrow = true;
  const tray2 = fresh('tray');
  silent(() => tray2.initTray(() => win));
  assert.equal(tray2.isTrayActive(), false);
  assert.equal(globalThis.__svcStub.trays.length, 0);
});

// ============================================================
// 3. WINDOW STATE — persistence / multi-monitor / validation
// ============================================================
const STATE_FILE = join(UD, 'window-state.json');

test('W1 window: atomic save, no temp leftover, clamped sizes', () => {
  resetStub();
  const w = fresh('window');
  w.saveWindowState({ x: 10, y: 20, width: 10, height: 99999 });
  assert.equal(existsSync(`${STATE_FILE}.tmp`), false, 'tmp file renamed away');
  const raw = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  assert.equal(raw.width, 400, 'width clamped to SIZE_MIN');
  assert.equal(raw.height, 16000, 'height clamped to SIZE_MAX');
  const loaded = w.loadWindowState();
  assert.equal(loaded.width, 400);
  assert.equal(loaded.height, 16000);
});

test('W2 window: position on a SECONDARY monitor is preserved (not centered)', () => {
  resetStub();
  globalThis.__svcStub.displays = [
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 1920, y: 0, width: 1920, height: 1080 },
  ];
  const w = fresh('window');
  w.saveWindowState({ x: 2000, y: 100, width: 1200, height: 800 });
  const loaded = w.loadWindowState();
  assert.equal(loaded.x, 2000, 'secondary-monitor restore works');
  assert.equal(loaded.y, 100);
});

test('W3 window: fully off-screen position drops to centered defaults', () => {
  resetStub();
  const w = fresh('window');
  w.saveWindowState({ x: 9000, y: 9000, width: 1200, height: 800 });
  const loaded = w.loadWindowState();
  assert.equal(loaded.x, undefined, 'x dropped when off-screen');
  assert.equal(loaded.y, undefined, 'y dropped when off-screen');
  assert.equal(loaded.width, 1200, 'size still restored');
});

test('W4 window: corrupt / non-finite state degrades safely', () => {
  resetStub();
  const w = fresh('window');
  writeFileSync(STATE_FILE, '{ definitely not json', 'utf8');
  assert.equal(w.loadWindowState(), null, 'corrupt JSON → null');
  writeFileSync(STATE_FILE, JSON.stringify({ x: 'NaN', y: null, width: 1000, height: 700 }), 'utf8');
  const loaded = w.loadWindowState();
  assert.equal(loaded.x, undefined, 'non-finite x dropped');
  assert.equal(loaded.y, undefined, 'non-finite y dropped');
});

// ============================================================
// 4. UPDATE — live feed / store gating / honest status / no leaks
// ============================================================
const SETTINGS_FILE = join(UD, 'settings.json');
function writeSettings(updates) {
  writeFileSync(SETTINGS_FILE, JSON.stringify({
    schemaVersion: 4, language: 'en', theme: 'obsidian',
    model: { provider: 'anthropic', model: 'claude-sonnet-5.5' },
    updates,
  }), 'utf8');
}

test('U1 update: default feed is the LIVE deployment, never the dead sadeem.app domain', () => {
  resetStub();
  writeSettings({ feedUrl: '' });
  const u = fresh('update');
  const src = readFileSync(join(ROOT, 'electron/services/updateService.ts'), 'utf8');
  assert.doesNotMatch(src, /https:\/\/sadeem\.app\/updates/, 'dead domain removed from source');
  assert.equal(u.feedUrl(), u.LIVE_UPDATE_FEED, 'live feed used by default');
  assert.match(u.LIVE_UPDATE_FEED, /^https:\/\//, 'feed is https');
  assert.equal(u.sanitizeFeedUrl(''), '', 'empty → caller default');
});

test('U2 update: sanitizer allows https + loopback http only, rejects credentials', () => {
  resetStub();
  const u = fresh('update');
  assert.equal(u.sanitizeFeedUrl('https://cdn.example.com/updates/'), 'https://cdn.example.com/updates/');
  assert.equal(u.sanitizeFeedUrl('http://localhost:8080/updates/'), 'http://localhost:8080/updates/');
  assert.equal(u.sanitizeFeedUrl('http://127.0.0.1:8080/updates/'), 'http://127.0.0.1:8080/updates/');
  assert.equal(u.sanitizeFeedUrl('http://[::1]:8080/updates/'), 'http://[::1]:8080/updates/');
  for (const bad of ['http://evil.example/updates/', 'ftp://host/x', 'javascript:alert(1)', 'file:///C:/x',
    'https://user:pass@host/updates/']) {
    assert.equal(u.sanitizeFeedUrl(bad), '', `rejected: ${bad}`);
  }
});

test('U3 update: Store/MSIX builds gate the updater and report an honest status', async () => {
  resetStub();
  writeSettings({ feedUrl: '' });
  const prev = process.env.SADEEM_STORE_BUILD;
  process.env.SADEEM_STORE_BUILD = '1';
  try {
    const u = fresh('update');
    assert.equal(u.isStoreManagedEnvironment(), true);
    const st = u.storeManagedStatus();
    assert.equal(st.state, 'error');
    assert.match(st.error, /STORE_MANAGED/);

    u.setWindowGetter(() => null);
    u.registerUpdateIpc();
    const check = await globalThis.__svcStub.ipc['kdx:update:check']();
    assert.equal(check.state, 'error', 'check does NOT silently succeed');
    assert.match(check.error, /Microsoft Store/);
    const installed = globalThis.__svcStub.ipc['kdx:update:install']();
    assert.equal(installed, false, 'Store build never self-installs');
  } finally {
    if (prev === undefined) delete process.env.SADEEM_STORE_BUILD;
    else process.env.SADEEM_STORE_BUILD = prev;
  }
});

test('U4 update: rejected feed values are explained, secrets scrubbed, no stale status', () => {
  resetStub();
  writeSettings({ feedUrl: '' });
  delete process.env.SADEEM_STORE_BUILD;
  delete process.env.SADEEM_UPDATE_FEED_URL;
  const u = fresh('update');
  u.setWindowGetter(() => null);
  u.registerUpdateIpc();

  // Plain http rejection is explained instead of silently falling back.
  const applied = globalThis.__svcStub.ipc['kdx:update:setFeedUrl'](null, 'http://cdn.example.com/updates/');
  assert.equal(applied, u.LIVE_UPDATE_FEED, 'invalid input falls back to LIVE feed');
  const status = globalThis.__svcStub.ipc['kdx:update:status']();
  assert.equal(status.state, 'error');
  assert.match(status.error, /Feed URL rejected/, 'user is told WHY');

  // Credentials in the URL never leak into status, settings or logs.
  const applied2 = globalThis.__svcStub.ipc['kdx:update:setFeedUrl'](
    null, 'https://user:supersecret@cdn.example.com/updates/',
  );
  assert.equal(applied2, u.LIVE_UPDATE_FEED);
  const status2 = globalThis.__svcStub.ipc['kdx:update:status']();
  assert.doesNotMatch(status2.error, /supersecret|user:/, 'no credential leak in status');
  assert.doesNotMatch(readFileSync(SETTINGS_FILE, 'utf8'), /supersecret/, 'no credential leak in settings');

  // A valid URL is applied and clears the stale error honestly.
  const applied3 = globalThis.__svcStub.ipc['kdx:update:setFeedUrl'](null, 'https://cdn.example.com/updates/');
  assert.equal(applied3, 'https://cdn.example.com/updates/');
  assert.equal(globalThis.__svcStub.ipc['kdx:update:status']().state, 'idle', 'stale result cleared');
});

test('U5 update: error text is scrubbed before logging/sending', () => {
  resetStub();
  writeSettings({ feedUrl: '' });
  const u = fresh('update');
  assert.equal(u.safeFeedForLog('https://u:p@host/updates/?token=abc#frag'), 'https://host/updates/');
  const scrubbed = u.scrubUpdateText('failed https://u:p@host/updates/?token=abc with sk-live-abcdefghijklmnop');
  assert.doesNotMatch(scrubbed, /p@host|token=abc|sk-live-abcdefghijklmnop/, 'no secret survives');
  assert.match(scrubbed, /redacted/, 'scrubbing is visible (honest)');
});

// ============================================================
// 5. LOG — rotation / redaction / export safety
// ============================================================
// initLog(userDataDir) appends 'logs' itself — pass a userData-like folder.
const LOG_ROOT = join(tmp, 'loghome');
const LOG_FILE = join(LOG_ROOT, 'logs', 'main.log');

test('L1 log: redacts every credential family, including the TAG', () => {
  resetStub();
  const log = fresh('log');
  log.setLogLevel('debug');
  const sample = [
    'sk-ant-abcdefghijklmnop', 'Bearer abcdefghijklmnop', 'AKIAABCDEFGHIJKLMNOP',
    'ghp_abcdefghijklmnopqrst', 'github_pat_abcdefghijklmnopqrstuv', 'AIza' + 'a'.repeat(35),
    'xoxb-abcdefghijklmnop', 'sk_live_abcdefghijklmnop',
    'Authorization: Bearer abcdefghijklmnop', 'x-api-key: abcdefghijklmnop',
    'password=hunter2', 'secret_access_key=wJalrXUtnFEMI',
  ].join(' | ');
  const red = log.redactText(sample);
  assert.ok(red.hits >= 10, `expected many redactions, got ${red.hits}`);
  assert.doesNotMatch(red.text, /sk-ant-|AKIA|ghp_|github_pat_|AIza|xoxb-|sk_live_|hunter2|wJalrXUtnFEMI/);

  log.initLog(LOG_ROOT);
  silent(() => log.logLine('info', 'sk-tag-abcdefghijklmnop', 'plain message'));
  const file = readFileSync(LOG_FILE, 'utf8');
  assert.doesNotMatch(file, /sk-tag-abcdefghijklmnop/, 'TAG is redacted on disk');
  assert.match(file, /redacted/, 'redaction is honest in the log');
  assert.ok(log.sessionRedactions() > 0, 'redactions counted');
});

test('L2 log: rotation keeps at most MAX_FILES files and never exceeds the byte cap', () => {
  resetStub();
  const log = fresh('log');
  try { rmSync(LOG_ROOT, { recursive: true, force: true }); } catch { /* fresh */ }
  log.initLog(LOG_ROOT);
  log.setLogLevel('debug');
  silent(() => {
    for (let i = 0; i < 320; i++) log.logLine('info', 'rotate-test', `line-${i} ` + 'R'.repeat(4000));
  });
  assert.ok(existsSync(LOG_FILE), 'main.log exists');
  assert.ok(existsSync(`${LOG_FILE}.1`), 'rotation happened');
  for (let i = 1; i < log.MAX_FILES; i++) {
    if (!existsSync(`${LOG_FILE}.${i}`)) continue;
    assert.ok(statSync(`${LOG_FILE}.${i}`).size <= log.MAX_FILE_BYTES, `main.log.${i} within cap`);
  }
  assert.ok(statSync(LOG_FILE).size <= log.MAX_FILE_BYTES, 'main.log within cap');
});

test('L3 log: export drops a partial boundary line, re-redacts, clearLog truncates', () => {
  resetStub();
  const log = fresh('log');
  try { rmSync(LOG_ROOT, { recursive: true, force: true }); } catch { /* fresh */ }
  log.initLog(LOG_ROOT);
  writeFileSync(LOG_FILE, [
    'first line safe',
    'sk-' + 'Z'.repeat(40) + ' MIDDLE_LINE',
    'LASTLINE_MUST_SURVIVE',
  ].join('\n') + '\n', 'utf8');
  const exp = log.getLogExport(60);
  assert.equal(exp.sanitized, true);
  assert.ok(!exp.content.includes('ZZZZ'), 'partial secret fragment is not exported');
  assert.match(exp.content, /LASTLINE_MUST_SURVIVE/, 'a complete line after the boundary survives');

  writeFileSync(LOG_FILE, 'sk-ant-abcdefghijklmnop\n', 'utf8');
  const redExp = log.getLogExport(4096);
  assert.doesNotMatch(redExp.content, /sk-ant-abcdefghijklmnop/, 'export re-redacts old lines');

  assert.equal(log.clearLog().ok, true);
  assert.equal(statSync(LOG_FILE).size, 0, 'log truncated');

  log.setLogLevel('error');
  silent(() => log.logLine('info', 'filtered', 'should not appear'));
  assert.equal(statSync(LOG_FILE).size, 0, 'level filter keeps disk clean');
});

// ============================================================
// 6. FEEDBACK — redaction + honest submission contract
// ============================================================
test('F1 feedback: secrets scrubbed before disk; submission is honest (never sent)', () => {
  resetStub();
  const fb = fresh('feedback');
  const res = fb.saveFeedback({
    kind: 'bug',
    message: 'Key leaked: sk-ant-abcdefghijklmnop — please ignore',
    contact: 'Bearer abcdefghijklmnop',
    diagnostics: { appVersion: '11.31', platform: 'win32', language: 'en', workspacesOpened: 3, sessions: 7 },
  });
  assert.equal(res.ok, true);
  assert.ok(res.entry.redacted >= 2, 'redactions counted');
  assert.equal(res.entry.sanitized, true);
  assert.doesNotMatch(res.entry.message, /sk-ant-abcdefghijklmnop/);
  const onDisk = readFileSync(join(UD, 'feedback', `${res.entry.id}.json`), 'utf8');
  assert.doesNotMatch(onDisk, /sk-ant-abcdefghijklmnop|Bearer abcdefghijklmnop/, 'no secret on disk');

  const sub = fb.submitFeedback({ kind: 'bug', message: 'Second report with no secrets' });
  assert.equal(sub.ok, true);
  assert.equal(sub.delivered, false, 'no network delivery is claimed');
  assert.match(sub.note, /Nothing is transmitted/, 'the limitation is stated plainly');
  assert.match(sub.markdown, /Bug report/);
});

test('F2 feedback: null input and corrupt dates never throw', () => {
  resetStub();
  const fb = fresh('feedback');
  assert.equal(fb.saveFeedback(null).ok, false, 'null input returns an error, not a throw');
  assert.equal(fb.saveFeedback({ kind: 'bug', message: 'ok report' }).ok, true);
  const md = fb.feedbackToMarkdown({ kind: 'bug', message: 'x', at: NaN, id: 'fb-x' });
  assert.match(md, /date: unknown/, 'corrupt timestamp rendered honestly');
});

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
