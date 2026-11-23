// ============================================================
// SADEEM v11.34 — INTERNET / DOWNLOAD / PREVIEW TRUTH (local-only proof)
//
// Founder report: "It cannot use the internet or download from the internet,
// performance is bad, and it cannot preview." This suite proves the repaired
// paths with a LOCAL loopback HTTP server + stubbed fetch for failure classes.
// NO external network is contacted.
//
// Run: node --test --test-force-exit tests/v1134-internet.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as http from 'node:http';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

process.env.SURNIA_NO_BROWSER = '1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1134-'));
const fwd = (p) => p.replace(/\\/g, '/');

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN,
    entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron',
    '--external:@xterm/xterm',
    '--external:@xterm/addon-fit',
    '--external:monaco-editor',
    '--external:@monaco-editor/react',
    '--log-level=silent',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// Headless electron stub — the bundle must load exactly like the other audits.
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `
  const paths = { temp: ${JSON.stringify(tmp)}, userData: ${JSON.stringify(join(tmp, 'ud'))}, home: ${JSON.stringify(tmp)}, appData: ${JSON.stringify(tmp)} };
  class StubWebContents { on() {} async executeJavaScript() { return []; } }
  class StubBrowserWindow { constructor() { this.webContents = new StubWebContents(); } destroy() {} setBounds() {} getBounds() { return { x: 0, y: 0 }; } }
  module.exports = {
    app: { getPath: (k) => paths[k] ?? paths.userData, isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },
    ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
    Notification: { isSupported: () => false },
    shell: { openExternal: async () => {}, openPath: async () => '' },
    clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
    WebContents: class {},
    BrowserWindow: StubBrowserWindow,
  };`);

const entry = join(tmp, 'entry.js');
writeFileSync(entry, [
  `export { executeTool, getToolDefs, CORE_DEFS } from ${JSON.stringify(fwd(join(ROOT, 'electron/agent/tools.ts')))};`,
  `export { staticStart, staticStop, staticStatus, devStart, devStop, devStatus, waitForDevUrl, detectPythonRun, detectUrl } from ${JSON.stringify(fwd(join(ROOT, 'electron/services/previewService.ts')))};`,
].join('\n'));
const out = join(tmp, 'suite.cjs');
bundle(fwd(entry), out);
const app = require(out);

const WS = join(tmp, 'ws');
mkdirSync(WS, { recursive: true });
const INDEX = '<!doctype html><html><head><title>v1134</title></head><body><h1>V1134 PREVIEW OK</h1></body></html>';
writeFileSync(join(WS, 'index.html'), INDEX);

// A real CSS asset containing a "<arrow>" token: an HTML stripper must not
// corrupt it, and the exact bytes must land on disk via download_file.
const CSS = [
  '/* v1134 fixture */',
  '.hero > svg { width: 1.25rem; }',
  '.icon::after { content: "<arrow>"; }',
].join('\n') + '\n';
const CSS_BYTES = Buffer.from(CSS, 'utf8');

const DDG_HTML = `<!doctype html><html><body>
  <a class="result__a" href="https://example.com/a?q=1&amp;x=2">Result A</a>
  <a class="result__snippet">Snippet A</a>
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fb">Result B</a>
  <a class="result__snippet">Snippet B</a>
</body></html>`;

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  const send = (code, type, body) => {
    res.writeHead(code, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };
  if (url.startsWith('/style.css')) return send(200, 'text/css; charset=utf-8', CSS);
  if (url.startsWith('/missing')) return send(404, 'text/plain', 'not here');
  if (url.startsWith('/forbidden')) return send(403, 'text/plain', 'blocked');
  if (url.startsWith('/echo-ua')) return send(200, 'text/plain', String(req.headers['user-agent'] || ''));
  return send(404, 'text/plain', 'nope');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

function probeFreePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

after(() => {
  try { app.devStop(); app.staticStop(); } catch { /* best effort */ }
  try { server.close(); } catch { /* already closed */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

function ctx(overrides = {}) {
  const events = [];
  return {
    workspace: WS, sessionId: 'v1134', mcpServers: [], emit: (e) => events.push(e),
    approve: async () => true, fullAccess: true, events, ...overrides,
  };
}
const run = (name, args, c = ctx()) => app.executeTool(name, JSON.stringify(args ?? {}), c);

/** Temporarily replace global fetch (tools.ts uses it at call time). */
async function withFetch(fn, body) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  try { return await body(); } finally { globalThis.fetch = original; }
}
const dnsFailure = () => {
  const err = new TypeError('fetch failed');
  err.cause = Object.assign(new Error('getaddrinfo ENOTFOUND no-such-host.invalid'), { code: 'ENOTFOUND' });
  return err;
};
const timeoutFailure = () => {
  const err = new Error('The operation was aborted due to timeout');
  err.name = 'TimeoutError';
  return err;
};
const tlsFailure = () => {
  const err = new TypeError('fetch failed');
  err.cause = Object.assign(new Error('self-signed certificate'), { code: 'CERT_SELF_SIGNED_CERT' });
  return err;
};

// ------------------------------------------------------------
// 1) download_file — exact bytes + path jail
// ------------------------------------------------------------
test('v1134 download_file writes EXACT CSS bytes to a verified workspace file', async () => {
  const dest = join(WS, 'assets', 'v1134.css');
  const r = await run('download_file', { url: `${BASE}/style.css`, dest: 'assets/v1134.css' });
  assert.equal(r.ok, true, r.output);
  assert.equal(existsSync(dest), true, 'file must exist on disk');
  assert.deepEqual(readFileSync(dest), CSS_BYTES, 'bytes on disk == bytes served');
  assert.match(r.output, /content-type: text\/css/i);
  assert.match(r.output, /verified: \d+ byte\(s\) present on disk/i);
});

test('v1134 download_file refuses an escaping destination with an actionable fix', async () => {
  const r = await run('download_file',
    { url: 'https://example.com/style.css', dest: join(tmp, 'outside.css') },
    ctx({ fullAccess: false }),
  );
  assert.equal(r.ok, false);
  assert.match(r.output, /outside the workspace|PathEscapesWorkspace/i);
  assert.match(r.output, /Fix:/i);
  assert.equal(existsSync(join(tmp, 'outside.css')), false, 'nothing written outside the workspace');
});

// ------------------------------------------------------------
// 2) web_fetch — content-type aware; distinct honest errors
// ------------------------------------------------------------
test('v1134 web_fetch returns CSS verbatim (no HTML stripping) and reports real bytes', async () => {
  const r = await run('web_fetch', { url: `${BASE}/style.css` });
  assert.equal(r.ok, true, r.output);
  assert.match(r.output, /content-type: text\/css/i);
  assert.match(r.output, /bytes read: \d+/i);
  assert.match(r.output, /\.hero > svg \{ width: 1\.25rem/, 'CSS selectors survive verbatim');
  assert.match(r.output, /content: "<arrow>"/, 'non-HTML content stays verbatim');
});

test('v1134 web_fetch parses HTML (title + paragraphs, strips scripts) even when mislabeled text/plain', async () => {
  const html = '<!doctype html><html><head><title>v1134 notes</title><script>console.log("x")</script></head>' +
    '<body><nav>nav noise</nav><p>First paragraph.</p><p>Second paragraph.</p></body></html>';
  const r = await withFetch(
    async () => new Response(html, { status: 200, headers: { 'content-type': 'text/plain' } }),
    () => run('web_fetch', { url: 'https://example.test/notes' }),
  );
  assert.equal(r.ok, true, r.output);
  assert.match(r.output, /TITLE: v1134 notes/);
  assert.match(r.output, /First paragraph\.\nSecond paragraph\./);
  assert.doesNotMatch(r.output, /console\.log/);
  assert.doesNotMatch(r.output, /nav noise/);
});

test('v1134 404 / DNS / timeout / TLS are four DISTINCT actionable errors', async () => {
  const notFound = await run('web_fetch', { url: `${BASE}/missing` });
  assert.equal(notFound.ok, false);
  assert.match(notFound.output, /HTTP 404/i);
  assert.match(notFound.output, /not found/i);
  assert.match(notFound.output, /Fix:/i);

  const dns = await withFetch(async () => { throw dnsFailure(); },
    () => run('web_fetch', { url: 'https://no-such-host.invalid/x.css' }));
  assert.equal(dns.ok, false);
  assert.match(dns.output, /DNS resolution failed/i);
  assert.match(dns.output, /no-such-host\.invalid/);

  const timeout = await withFetch(async () => { throw timeoutFailure(); },
    () => run('web_fetch', { url: `${BASE}/style.css` }));
  assert.equal(timeout.ok, false);
  assert.match(timeout.output, /timed out after 15000 ms/i);

  const tls = await withFetch(async () => { throw tlsFailure(); },
    () => run('web_fetch', { url: 'https://bad-cert.example/x.css' }));
  assert.equal(tls.ok, false);
  assert.match(tls.output, /TLS certificate verification failed/i);

  const all = [notFound.output, dns.output, timeout.output, tls.output];
  assert.equal(new Set(all).size, 4, 'each failure class must have its own message');
  for (const o of all) {
    assert.match(o, /Fix:/i, 'every failure must carry a concrete next step');
    assert.doesNotMatch(o, /^Fetch failed: fetch failed/i, 'never the opaque wrapper');
    assert.doesNotMatch(o, /\bI can'?t\b/i, 'never "I can\'t"');
  }
});

// ------------------------------------------------------------
// 3) http_request — real browser UA + actionable 403
// ------------------------------------------------------------
test('v1134 http_request sends a real browser UA and explains 403/404', async () => {
  const ua = await run('http_request', { url: `${BASE}/echo-ua` });
  assert.equal(ua.ok, true, ua.output);
  assert.match(ua.output, /Mozilla\/5\.0 .*Chrome\/126/, 'a real Chrome UA reached the server');
  assert.doesNotMatch(ua.output, /SADEEM\/10\.2/, 'the bot-identifying UA is gone');

  const forbidden = await run('http_request', { url: `${BASE}/forbidden` });
  assert.equal(forbidden.ok, false);
  assert.match(forbidden.output, /HTTP 403/i);
  assert.match(forbidden.output, /access refused by the server/i);
  assert.match(forbidden.output, /Fix:/i);

  const missing = await run('http_request', { url: `${BASE}/missing` });
  assert.equal(missing.ok, false);
  assert.match(missing.output, /HTTP 404/i);
  assert.match(missing.output, /not found/i);
  assert.notEqual(forbidden.output, missing.output, '403 and 404 must be distinct');
});

// ------------------------------------------------------------
// 4) web_search — real DDG parse; honest, specific fallback
// ------------------------------------------------------------
test('v1134 web_search parses DDG HTML and never returns a silent empty result', async () => {
  const good = await withFetch(async () => new Response(DDG_HTML, {
    status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
  }), () => run('web_search', { query: 'v1134 test' }));
  assert.equal(good.ok, true, good.output);
  assert.match(good.output, /Result A/);
  assert.match(good.output, /https:\/\/example\.com\/a\?q=1&x=2/);
  assert.match(good.output, /https:\/\/example\.org\/b/, 'uddg redirect decoded');
  assert.match(good.output, /Snippet A/);

  const blocked = await withFetch(async () => { throw dnsFailure(); },
    () => run('web_search', { query: 'v1134 fail' }));
  assert.equal(blocked.ok, false);
  assert.match(blocked.output, /Web search is currently unavailable/i);
  assert.match(blocked.output, /none were fabricated/i);
  assert.match(blocked.output, /web_fetch/i);
  assert.match(blocked.output, /web_download/i);
  assert.doesNotMatch(blocked.output, /^Search failed: fetch failed/i);
});

// ------------------------------------------------------------
// 5) previewService — real port, real URL, no fabricated ready
// ------------------------------------------------------------
test('v1134 static preview starts on a REAL loopback port and serves the page', async () => {
  const preferred = await probeFreePort();
  const st = await app.staticStart(WS, preferred);
  assert.equal(st.ok, true, JSON.stringify(st));
  assert.ok(st.url && st.url.startsWith('http://127.0.0.1:'), `loopback URL returned: ${st.url}`);
  const port = Number(new URL(st.url).port);
  assert.ok(port >= preferred && port <= preferred + 40, `real port chosen: ${preferred} → ${port}`);
  const res = await fetch(st.url);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /V1134 PREVIEW OK/);
  assert.equal(app.staticStatus().running, true);
  app.staticStop();
  assert.equal(app.staticStatus().running, false);
});

test('v1134 waitForDevUrl never fabricates a URL when no dev server is running', async () => {
  app.devStop();
  const w = await app.waitForDevUrl(300);
  assert.equal(w.ok, false);
  assert.equal(w.url, undefined, 'no guessed URL');
  assert.match(w.error ?? '', /no URL|idle/i);
});

test('v1134 node dev server: waitForDevUrl returns the REAL announced URL', async () => {
  const port = await probeFreePort();
  const ws = join(tmp, 'ws-dev');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'v1134', scripts: { dev: 'node server.js' } }));
  writeFileSync(join(ws, 'server.js'), [
    'const http = require("http");',
    `const p = ${port};`,
    'http.createServer((q, r) => { r.writeHead(200, {"content-type":"text/plain"}); r.end("V1134-DEV-OK"); })',
    '  .listen(p, "127.0.0.1", () => console.log("listening on http://127.0.0.1:" + p));',
  ].join('\n'));

  const started = await app.devStart(ws, 'npm');
  assert.equal(started.ok, true, JSON.stringify(started));
  const w = await app.waitForDevUrl(9000);
  assert.equal(w.ok, true, JSON.stringify(w));
  assert.equal(w.url, `http://127.0.0.1:${port}`, 'the URL must come from the real bind announcement');
  const res = await fetch(w.url);
  assert.equal(await res.text(), 'V1134-DEV-OK', 'the announced server really serves');
  app.devStop();
});

test('v1134 python preview is detected and started with a real URL', async () => {
  const port = await probeFreePort();
  const ws = join(tmp, 'ws-python');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'app.py'), [
    'import http.server, os',
    `port = int(os.environ.get('V1134_PY_PORT', '8000'))`,
    'class H(http.server.BaseHTTPRequestHandler):',
    '  def do_GET(self):',
    '    body = b"V1134-PY-OK"',
    '    self.send_response(200); self.send_header("content-type", "text/plain")',
    '    self.send_header("content-length", str(len(body))); self.end_headers(); self.wfile.write(body)',
    '  def log_message(self, *a): pass',
    'srv = http.server.HTTPServer(("127.0.0.1", port), H)',
    'print("listening on http://127.0.0.1:" + str(port), flush=True)',
    'srv.serve_forever()',
  ].join('\n'));

  const plan = await app.detectPythonRun(ws);
  assert.ok(plan, 'a python entry is detected');
  assert.ok(plan.args.includes('-u'), 'unbuffered output (needed to see the URL)');
  assert.ok(plan.args.includes('app.py') || /app\.py/.test(plan.label));

  process.env.V1134_PY_PORT = String(port);
  try {
    const started = await app.devStart(ws, 'python');
    assert.equal(started.ok, true, JSON.stringify(started));
    const w = await app.waitForDevUrl(9000);
    assert.equal(w.ok, true, JSON.stringify(w));
    assert.equal(w.url, `http://127.0.0.1:${port}`, 'real python bind URL, not a guessed one');
    const res = await fetch(w.url);
    assert.equal(await res.text(), 'V1134-PY-OK');
  } finally {
    app.devStop();
    delete process.env.V1134_PY_PORT;
  }
});

// ------------------------------------------------------------
// 6) preview_open TOOL — the missing path from "built" to "visible"
// ------------------------------------------------------------
test('v1134 preview_open def + executor path exist, and it opens a real preview', async () => {
  // Read-only check requested by the task: executor + dispatch live in
  // tools.ts (this file's owner); the canonical def lives in tool-defs.ts.
  const toolsSrc = readFileSync(join(ROOT, 'electron', 'agent', 'tools.ts'), 'utf8');
  assert.match(toolsSrc, /async function previewOpenTool\(/, 'executor exists');
  assert.match(toolsSrc, /case 'preview_open':/, 'dispatch path exists');
  // The canonical def is owned by tool-defs.ts (inventory guard). This suite
  // accepts either state: the executor must be reachable by exact name with
  // or without an advertised def.
  const def = app.getToolDefs([]).find((d) => d.name === 'preview_open');
  if (def) {
    assert.match(def.description, /built/);
    assert.ok(def.parameters.properties.path && def.parameters.properties.url,
      'def exposes path + url parameters');
  }

  app.staticStop();
  const c = ctx();
  const r = await run('preview_open', { path: 'index.html' }, c);
  assert.equal(r.ok, true, r.output);
  assert.match(r.output, /http:\/\/127\.0\.0\.1:\d+/i, 'a real loopback URL is returned');
  const opened = c.events.filter((e) => e.type === 'preview_open');
  assert.ok(opened.length >= 1, 'a preview_open event was emitted');
  assert.ok(opened.some((e) => typeof e.url === 'string' && /^http:\/\/127\.0\.0\.1:\d+/.test(e.url)),
    'the event carries the real URL the preview panel can use');
  const url = opened.find((e) => e.url)?.url;
  const res = await fetch(url);
  assert.match(await res.text(), /V1134 PREVIEW OK/);
  app.staticStop();
});

test('v1134 preview_open rejects an outside-workspace path and handles a URL', async () => {
  const c1 = ctx({ fullAccess: false });
  const escaped = await run('preview_open', { path: join(tmp, 'outside.html') }, c1);
  assert.equal(escaped.ok, false);
  assert.match(escaped.output, /outside the workspace/i);
  assert.match(escaped.output, /Fix:/i);

  const c2 = ctx();
  const byUrl = await run('preview_open', { url: `${BASE}/style.css` }, c2);
  assert.equal(byUrl.ok, true, byUrl.output);
  const e = c2.events.find((x) => x.type === 'preview_open' && x.url);
  assert.equal(e.url, new URL(`${BASE}/style.css`).toString(), 'the event echoes the validated http URL');
});

test('v1134 preview_open with no args AUTO-OPENS a real verified preview (v1138 — never asks the founder)', async () => {
  app.devStop();
  app.staticStop();
  const c = ctx();
  const r = await run('preview_open', {}, c);
  // v1138: the old "No live preview is running yet — ask the panel" answer was
  // the founder's complaint. No-args now starts a REAL loopback server and
  // returns its verified URL without anyone asking.
  assert.equal(r.ok, true, r.output);
  assert.match(r.output, /AUTO-PREVIEW is LIVE at http:\/\/127\.0\.0\.1:\d+/i);
  assert.match(r.output, /HTTP 200/i, 'the URL was really verified, not guessed');
  const opened = c.events.find((e) => e.type === 'preview_open' && e.url);
  assert.ok(opened, 'a preview_open carrying the real URL was emitted');
  assert.equal(opened.ws, WS, 'the event is scoped to the built workspace');

  // Honest failure is preserved: a workspace with NO web entry never fakes "ready".
  const empty = join(tmp, 'v1138-empty');
  mkdirSync(empty, { recursive: true });
  const ec = ctx({ workspace: empty });
  const er = await run('preview_open', {}, ec);
  assert.equal(er.ok, false, er.output);
  assert.match(er.output, /no web entry|no preview was claimed ready/i);
  assert.equal(ec.events.some((e) => e.type === 'preview_open' && e.url), false);
});
