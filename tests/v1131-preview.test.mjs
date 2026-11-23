import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

// ============================================================
// v11.31 CAPABILITY AUDIT — PREVIEW / BROWSER / IMAGE / UI QUALITY
// ------------------------------------------------------------
// Headless regressions with MOCK PROCESSES / PORTS / CDP / FETCH:
//   • preview: ANSI log sanitization, chunk-split URLs, honest "ready",
//     port-flag parsing, busy-port fallback, deterministic teardown
//   • ui_quality: console-collector shapes, white-background contrast math,
//     honest unresolved-target errors, no dangling capture timers
//   • browser: load-timeout honesty, screenshot MIME correctness,
//     LRU session reaping instead of "oldest-created" eviction
//   • image: redirect refusal (SSRF), magic-byte validation, format honesty
//
// Run: node --test --test-force-exit tests/v1131-preview.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1131-capability-'));
const userData = join(tmp, 'userdata');
mkdirSync(userData, { recursive: true });

// ---------- electron stub: real BrowserWindow *class* with a scripted CDP bus ----------
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `const { EventEmitter } = require('events');
   const USER_DATA = ${JSON.stringify(userData)};
   function run(method, params, dbg, win) {
     const h = globalThis.__MOCK_CDP__ && globalThis.__MOCK_CDP__.handler;
     return h ? h(method, params, dbg, win) : Promise.resolve({});
   }
   class MockDebugger extends EventEmitter {
     constructor(win) { super(); this.win = win; this.flag = false; }
     isAttached() { return this.flag; }
     attach() { this.flag = true; }
     detach() { this.flag = false; }
     sendCommand(method, params) { return run(method, params, this, this.win); }
   }
   class MockWebContents extends EventEmitter {
     constructor(win) { super(); this.win = win; this.debugger = new MockDebugger(win); }
   }
   class BrowserWindow {
     constructor(opts) {
       this.options = opts || {};
       this.webContents = new MockWebContents(this);
       this.destroyed = false;
       (globalThis.__MOCK_WINDOWS__ || (globalThis.__MOCK_WINDOWS__ = [])).push(this);
     }
     setMenuBarVisibility() {}
     isDestroyed() { return this.destroyed; }
     destroy() { this.destroyed = true; this.webContents.debugger.flag = false; }
     getBounds() { return { x: 0, y: 0, width: this.options.width || 800, height: this.options.height || 600 }; }
     setBounds(b) { Object.assign(this.options, b); }
     loadURL(url) { this.options.loadedUrl = url; return Promise.resolve(); }
     executeJavaScript() { return Promise.resolve(undefined); }
     capturePage() { return Promise.resolve({ toPNG: () => Buffer.from([0x89, 0x50, 0x4e, 0x47]) }); }
   }
   module.exports = {
     app: { getPath: () => USER_DATA, whenReady: async () => true, on() {}, quit() {} },
     ipcMain: { handle() {}, on() {} },
     BrowserWindow,
     Notification: { isSupported: () => false },
     shell: {}, screen: {},
   };`,
);

// ---------- bundle all four services into ONE CJS module ----------
const entry = join(tmp, 'entry.js');
const src = (p) => JSON.stringify(join(ROOT, 'electron', 'services', p));
writeFileSync(
  entry,
  [
    `export { sanitizeLogLine, LineBuffer, detectUrl, parsePortFlag, staticStart, staticStop, devStart, devStop, devStatus, shutdownAll, detectTargets } from ${src('previewService.ts')};`,
    `export { makeConsoleCollector, checkUi, capturePageShot, noteTurnFileWrite, resetTurnWrites } from ${src('uiQualityService.ts')};`,
    `export { browserNavigate, browserScreenshot, browserStateFor, activeBrowserSessions, closeAllBrowsers, setBrowserEventEmitter, browserAvailable } from ${src('browserService.ts')};`,
    `export { generateImage, detectRaster } from ${src('imageGenService.ts')};`,
  ].join('\n'),
);
const out = join(tmp, 'services.cjs');

// Keep the navigation timeout tiny ONLY for this test process; production default is unchanged.
process.env.SURNIA_BROWSER_NAV_TIMEOUT_MS = '150';

let svc;
before(() => {
  execFileSync(
    ESBUILD_NODE,
    [
      ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
      '--external:electron', '--external:./libraryService',
      '--external:@xterm/xterm', '--external:@xterm/addon-fit',
      '--external:monaco-editor', '--external:@monaco-editor/react',
      '--log-level=silent',
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
  svc = require(out);
});
after(() => {
  try { svc?.closeAllBrowsers(); } catch { /* already gone */ }
  try { svc?.devStop(); svc?.staticStop(); } catch { /* already gone */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ---------- helpers ----------
function probeFreePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}
async function portRebindable(port) {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}
const waitReady = async (ms = 9000) => {
  for (let i = 0; i < Math.ceil(ms / 100); i++) {
    await new Promise((r) => setTimeout(r, 100));
    const s = svc.devStatus();
    if (s.state === 'ready' || s.state === 'error') return s;
  }
  return svc.devStatus();
};

// ============================================================
// 1 · PREVIEW — log hygiene + honest readiness + port parsing
// ============================================================
test('P1: ANSI + control chars are stripped from dev logs (no garbage in the drawer)', () => {
  assert.equal(svc.sanitizeLogLine('\u001b[32m  VITE ready  \u001b[0m'), '  VITE ready');
  assert.equal(svc.sanitizeLogLine('\u001b]0;my title\u0007hello\u0000world'), 'hello world');
  assert.equal(svc.sanitizeLogLine('plain text\t'), 'plain text');
  assert.equal(svc.sanitizeLogLine(null), '');
});

test('P1: LineBuffer reassembles URLs split across stdout chunks + flushes the tail', () => {
  const b = new svc.LineBuffer();
  assert.deepEqual(b.push('first line\nsec'), ['first line']);
  assert.deepEqual(b.push('ond line\nthird'), ['second line']);
  assert.deepEqual(b.flush(), ['third']);
  assert.deepEqual(b.flush(), []);
});

test('P1: detectUrl NEVER fabricates ready from an error/in-use line', () => {
  assert.equal(svc.detectUrl('Error: connect ECONNREFUSED 127.0.0.1:3000'), null);
  assert.equal(svc.detectUrl('Port 3000 is in use, trying another one'), null);
  assert.equal(svc.detectUrl('[vite] failed to bind 0.0.0.0:5173'), null);
  assert.equal(svc.detectUrl('some unrelated log line:3000'), null, 'bare :port without a positive signal is rejected');
  assert.equal(svc.detectUrl('listening on http://127.0.0.1:70000'), null, 'invalid port rejected');
});

test('P1: detectUrl parses real bind announcements (full URL, bare port, ANSI-wrapped)', () => {
  assert.equal(svc.detectUrl('  ➜  Local:   http://localhost:5173/'), 'http://127.0.0.1:5173/');
  assert.equal(svc.detectUrl('listening on 3000'), 'http://127.0.0.1:3000');
  assert.equal(svc.detectUrl('\u001b[32mNetwork: http://0.0.0.0:8081/\u001b[0m'), 'http://127.0.0.1:8081/');
  assert.equal(svc.detectUrl('Server running at http://192.168.1.9:4000'), 'http://127.0.0.1:4000');
  assert.equal(svc.detectUrl(':3000'), 'http://127.0.0.1:3000', 'a line that IS a bind address is accepted');
});

test('P1: parsePortFlag covers every common dev-script form', () => {
  const cases = [
    ['vite --port 5173', 5173],
    ['vite --port=3000', 3000],
    ['vite --port:4200', 4200],
    ['serve -p 8080', 8080],
    ['serve -p3000', 3000],
    ['serve -p=9000', 9000],
    ['serve -p\t9100', 9100],
    ['cross-env PORT=8000 node app.js', 8000],
    ['nuxt --port="3001"', 3001],
    ['vite --port 70000', null],
    ['echo nothing', null],
  ];
  for (const [cmd, expected] of cases) {
    assert.equal(svc.parsePortFlag(cmd), expected, `parsePortFlag(${JSON.stringify(cmd)})`);
  }
});

test('P1: staticStart falls off a busy preferred port and still serves; invalid port never crashes', async () => {
  const ws = join(tmp, 'ws-static');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'index.html'), '<h1>V1131</h1>');
  const port = await probeFreePort();
  const holder = http.createServer((_q, r) => r.end('holder'));
  await new Promise((resolve) => holder.listen(port, '127.0.0.1', resolve));
  try {
    const st = await svc.staticStart(ws, port);
    assert.ok(st.ok, `staticStart on busy port succeeded: ${JSON.stringify(st)}`);
    const chosen = Number(new URL(st.url).port);
    assert.ok(chosen > port && chosen <= port + 40, `moved off busy ${port} → ${chosen}`);
    const res = await fetch(st.url);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /V1131/);
    svc.staticStop();
    assert.ok(await portRebindable(chosen), 'chosen port released on stop');
  } finally {
    await new Promise((resolve) => holder.close(resolve));
  }
  const weird = await svc.staticStart(ws, 70000);
  assert.ok(weird.ok, `out-of-range preferred port falls back instead of throwing: ${JSON.stringify(weird)}`);
  assert.ok(Number(new URL(weird.url).port) > 0);
  svc.staticStop();
});

test('P1: dev process with ANSI + split-chunk URL reaches ready; log is clean; stop frees the port', async (t) => {
  if (process.platform !== 'win32') {
    // POSIX: detached process groups are fine; Windows shell shim is the common CI path.
  }
  const port = await probeFreePort();
  const ws = join(tmp, 'ws-dev');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'v1131', scripts: { dev: 'node server.js' } }));
  writeFileSync(join(ws, 'server.js'), [
    'const http = require("http");',
    `const p = ${port};`,
    'const s = http.createServer((q, r) => { r.writeHead(200, {"content-type":"text/plain"}); r.end("MOCK-DEV-OK"); });',
    's.listen(p, "127.0.0.1", () => {',
    '  process.stdout.write("\\u001b[32mlistening on http://127.");',
    '  setTimeout(() => process.stdout.write("0.0.1:" + p + "\\u001b[0m\\n"), 40);',
    '});',
  ].join('\n'));

  const started = await svc.devStart(ws, 'npm');
  assert.ok(started.ok, `devStart ok: ${JSON.stringify(started)}`);
  const st = await waitReady();
  assert.equal(st.state, 'ready', `dev reached ready: ${JSON.stringify(st)}`);
  assert.equal(st.url, `http://127.0.0.1:${port}`, 'URL reassembled from the two chunks');
  assert.ok(st.lines.every((l) => !l.includes('\u001b')), 'no ANSI escape leaked into the log ring');
  const res = await fetch(st.url);
  assert.equal(await res.text(), 'MOCK-DEV-OK', 'the announced server actually serves');

  svc.devStop();
  let freed = false;
  for (let i = 0; i < 20 && !freed; i++) {
    freed = await portRebindable(port);
    if (!freed) await new Promise((r) => setTimeout(r, 150));
  }
  assert.ok(freed, 'dev port released after devStop (no orphan server)');
});

// ============================================================
// 2 · UI QUALITY — console shapes, contrast floor, honest errors
// ============================================================
test('U1: console collector handles event-first, single-object and legacy-number forms', () => {
  const gather = (form) => {
    const out = [];
    const collect = svc.makeConsoleCollector((l) => out.push(l));
    form(collect);
    return out;
  };
  assert.deepEqual(gather((c) => c({}, 3, 'event-first error', 1, 'x.js')), ['event-first error']);
  assert.deepEqual(gather((c) => c({ level: 'error', message: 'object error' })), ['object error']);
  assert.deepEqual(gather((c) => c(3, 'legacy error')), ['legacy error'], 'legacy numeric form is no longer dropped');
  assert.deepEqual(gather((c) => c({}, 1, 'just info', 1, 'x.js')), [], 'info is not an error');
});

test('U1: probe computes contrast against a WHITE default background (no dark-on-black false positives)', () => {
  const source = readFileSync(join(ROOT, 'electron', 'services', 'uiQualityService.ts'), 'utf8');
  assert.match(source, /var acc = \[255,255,255,1\]/, 'opaque white baseline');
  assert.match(source, /if \(rootBg && rootBg\[3\] > 0\) acc = mix\(rootBg, acc\)/, 'html bg composited over white');
  assert.match(source, /for \(var i = stack\.length - 1; i >= 0; i--\) acc = mix\(stack\[i\], acc\)/, 'body → element order');
  assert.doesNotMatch(source, /getComputedStyle\(de\)\.backgroundColor\) \|\| \[255,255,255,1\]/, 'old transparent-as-black bug removed');
});

test('U1: capture settle uses unref-able timeouts (no 2s/1s timer leaked per screenshot)', () => {
  const source = readFileSync(join(ROOT, 'electron', 'services', 'uiQualityService.ts'), 'utf8');
  assert.match(source, /withTimeout\([\s\S]{0,120}'waiting for fonts', 2000\)/);
  assert.match(source, /withTimeout\([\s\S]{0,120}'waiting for animation frames', 1000\)/);
  assert.doesNotMatch(source, /Promise\.race\(\[wc\.executeJavaScript\(FONTS_READY_JS/, 'old bare race removed');
  assert.match(source, /width = Math\.max\(200, Math\.min\(2400/, 'screenshot viewport clamped');
});

test('U1: unresolved targets produce honest errors, never a fabricated PASS on a real build turn', async () => {
  svc.resetTurnWrites('v1131-uq');
  const skip = await svc.checkUi({ path: 'does-not-exist.html' }, tmp, false, { sessionId: 'v1131-uq' });
  assert.match(skip, /RESULT: PASS \(skipped\)/, 'zero-write Q&A turn keeps the honest skip');

  const ws = join(tmp, 'uq-ws');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'real.html'), '<!doctype html><title>t</title><h1>real</h1>');
  svc.noteTurnFileWrite(join(ws, 'real.html'), 'v1131-uq');
  const honest = await svc.checkUi({ path: 'ghost.html' }, ws, false, { sessionId: 'v1131-uq' });
  assert.match(honest, /^ERROR: could not resolve the target/);
  assert.doesNotMatch(honest, /RESULT: PASS/, 'a turn that really wrote files gets an error, not a fake pass');

  const shot = await svc.capturePageShot({ target: 'ghost.html', width: 1280, height: 900 }, ws, false);
  assert.equal(shot.ok, false);
  assert.match(shot.error ?? '', /could not resolve the target/);
  svc.resetTurnWrites('v1131-uq');
});

// ============================================================
// 3 · BROWSER — honest navigation + screenshot encoding + LRU tabs
// ============================================================
const RESULT = (url, title) => ({ result: { value: JSON.stringify({ url, title }) } });

test('B1: browserNavigate reports a load timeout instead of a fabricated clean "Loaded"', async () => {
  assert.equal(svc.browserAvailable(), true, 'mock BrowserWindow is a class');
  globalThis.__MOCK_CDP__ = {
    handler(method, _params, dbg) {
      if (method === 'Page.navigate') {
        // NO load event → exercise the honest timeout path (150ms via env).
        return Promise.resolve({});
      }
      if (method === 'Runtime.evaluate') return Promise.resolve(RESULT('http://127.0.0.1:1', 'Never Loaded'));
      return Promise.resolve({});
    },
  };
  const taint = [];
  const r = await svc.browserNavigate(
    { sessionId: 'v1131-timeout', onTaint: (url) => taint.push(url) },
    'http://127.0.0.1:1/slow',
  );
  assert.match(r.summary, /Warning: the page did not finish loading/);
  assert.match(r.summary, /may be partial/);
  assert.ok(taint.includes('http://127.0.0.1:1/slow'), 'page still taints the session');
  svc.closeAllBrowsers();
});

test('B1: a successful navigation has no warning', async () => {
  globalThis.__MOCK_CDP__ = {
    handler(method, _params, dbg) {
      if (method === 'Page.navigate') {
        setImmediate(() => dbg.emit('message', {}, 'Page.loadEventFired', {}));
        return Promise.resolve({});
      }
      if (method === 'Runtime.evaluate') return Promise.resolve(RESULT('http://example.test/', 'OK Page'));
      return Promise.resolve({});
    },
  };
  const r = await svc.browserNavigate({ sessionId: 'v1131-ok', onTaint() {} }, 'http://example.test/');
  assert.match(r.summary, /Loaded http:\/\/example\.test\//);
  assert.doesNotMatch(r.summary, /Warning:/);
  svc.closeAllBrowsers();
});

test('B1: downscaled screenshots keep the JPEG data-URL prefix (not a mislabeled PNG)', async () => {
  let shotCount = 0;
  globalThis.__MOCK_CDP__ = {
    handler(method) {
      if (method === 'Page.captureScreenshot') {
        shotCount += 1;
        return Promise.resolve({ data: shotCount === 1 ? 'A'.repeat(5_000_001) : 'SMALLJPEGBYTES' });
      }
      return Promise.resolve({});
    },
  };
  const r = await svc.browserScreenshot({ sessionId: 'v1131-shot', onTaint() {} });
  assert.equal(shotCount, 2, 'large PNG triggers the JPEG re-capture');
  assert.match(r.dataUrl, /^data:image\/jpeg;base64,SMALLJPEGBYTES$/, 'MIME matches the actual bytes');
  svc.closeAllBrowsers();
});

test('B1: MAX_WINDOWS reaping evicts the LEAST-RECENTLY-USED session, not the oldest-created', async () => {
  globalThis.__MOCK_CDP__ = {
    handler(method, _params, dbg) {
      if (method === 'Page.navigate') {
        setImmediate(() => dbg.emit('message', {}, 'Page.loadEventFired', {}));
        return Promise.resolve({});
      }
      if (method === 'Runtime.evaluate') return Promise.resolve(RESULT('http://x.test/', 'x'));
      return Promise.resolve({});
    },
  };
  const ctx = (id) => ({ sessionId: id, onTaint() {} });
  for (const id of ['lr-1', 'lr-2', 'lr-3', 'lr-4']) {
    await svc.browserNavigate(ctx(id), 'http://x.test/');
  }
  // Touch lr-1 so it becomes the newest; lr-2 is now the idlest.
  await svc.browserNavigate(ctx('lr-1'), 'http://x.test/');
  await new Promise((r) => setTimeout(r, 5));
  await svc.browserNavigate(ctx('lr-5'), 'http://x.test/');
  const live = svc.activeBrowserSessions();
  assert.ok(live.includes('lr-1'), 'actively used session survives');
  assert.ok(!live.includes('lr-2'), 'idle session reaped');
  assert.ok(live.includes('lr-3') && live.includes('lr-4') && live.includes('lr-5'));
  svc.closeAllBrowsers();
});

// ============================================================
// 4 · IMAGE — SSRF-safe redirects + real raster bytes
// ============================================================
const realFetch = globalThis.fetch;
const fakeResponse = (status, ctype, bytes) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (k) => (k.toLowerCase() === 'content-type' ? ctype : String(bytes.length)) },
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});

test('I1: detectRaster sniffs real JPEG/PNG magic bytes', () => {
  assert.equal(svc.detectRaster(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'jpeg');
  assert.equal(svc.detectRaster(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
  assert.equal(svc.detectRaster(Buffer.from('<html>not an image</html>')), null);
});

test('I1: image redirects are REFUSED (no SSRF bounce), with an honest error', async () => {
  const ws = join(tmp, 'img-ws');
  mkdirSync(ws, { recursive: true });
  const resolveWrite = (p) => join(ws, p);
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { status: 302, ok: false, headers: { get: () => '' } }; };
  try {
    const r = await svc.generateImage({ prompt: 'a hero banner', dest: 'assets/hero.jpg' }, resolveWrite);
    assert.equal(r.ok, false);
    assert.match(r.output, /redirected to another host — refused/);
    assert.equal(calls, 1, 'the redirect target was NEVER fetched');
    assert.equal(existsSync(join(ws, 'assets', 'hero.jpg')), false, 'no file written');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('I1: wrong content-type or non-image bytes are rejected before writing', async () => {
  const ws = join(tmp, 'img-ws2');
  mkdirSync(ws, { recursive: true });
  const resolveWrite = (p) => join(ws, p);
  globalThis.fetch = async () => fakeResponse(200, 'text/html', Buffer.from('<html>error</html>'));
  try {
    const a = await svc.generateImage({ prompt: 'a cat', dest: 'a.jpg' }, resolveWrite);
    assert.equal(a.ok, false);
    assert.match(a.output, /unexpected content-type/);
    globalThis.fetch = async () => fakeResponse(200, 'image/jpeg', Buffer.from('<html>lying ctype</html>'));
    const b = await svc.generateImage({ prompt: 'a cat', dest: 'b.jpg' }, resolveWrite);
    assert.equal(b.ok, false);
    assert.match(b.output, /not a valid JPEG\/PNG image/);
    assert.equal(existsSync(join(ws, 'a.jpg')), false);
    assert.equal(existsSync(join(ws, 'b.jpg')), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('I1: a valid raster image is written with the requested format', async () => {
  const ws = join(tmp, 'img-ws3');
  mkdirSync(ws, { recursive: true });
  const resolveWrite = (p) => join(ws, p);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
  let url = '';
  globalThis.fetch = async (u) => { url = u; return fakeResponse(200, 'image/jpeg', jpeg); };
  try {
    const r = await svc.generateImage({ prompt: 'flat vector logo', dest: 'assets/logo.jpg', size: 'icon' }, resolveWrite);
    assert.equal(r.ok, true, r.output);
    assert.match(url, /format=jpeg/, 'requested format matches the destination');
    assert.deepEqual(readFileSync(join(ws, 'assets', 'logo.jpg')), jpeg);
    assert.doesNotMatch(r.output, /Note: the service returned/, 'no mismatch note when formats agree');
  } finally {
    globalThis.fetch = realFetch;
  }
});
