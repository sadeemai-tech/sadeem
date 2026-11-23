// ============================================================
// SADEEM v11.32 — WEB / DOWNLOAD / EXEC TRUTH (local-only proof)
//
// The founder's report: "I asked it to use the internet, search and download
// things from the net — it couldn't. The command won't run. All edits and
// creates and reads are bad." This suite proves the four repaired executors
// against a LOCAL loopback HTTP server + a stubbed fetch for failure classes.
// NO external network is required or used.
//
// Run: node --test --test-force-exit tests/v1132-web.test.mjs
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
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1132-'));
const fwd = (p) => p.replace(/\\/g, '/');

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN,
    entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron',
    '--external:@xterm/xterm',
    '--external:@xterm/addon-fit',
    '--external:monaco-editor',
    '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// Minimal electron stub — the bundle must load headless exactly like the audits.
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

const toolsPath = join(tmp, 'tools.cjs');
bundle(fwd(join(ROOT, 'electron/agent/tools.ts')), toolsPath);
const tools = require(toolsPath);

const WS = join(tmp, 'ws');
mkdirSync(WS, { recursive: true });

// A real CSS asset with a "<arrow>" token: the old web_fetch HTML stripper
// treated it as a tag and silently corrupted the file content.
const CSS = [
  '/* heroicons v1132 fixture */',
  '.hero > svg { width: 1.25rem; height: 1.25rem; }',
  '.icon::after { content: "<arrow>"; }',
  '@media (max-width: 40rem) { .hero > svg { width: 1rem; } }',
].join('\n') + '\n';
const CSS_BYTES = Buffer.from(CSS, 'utf8');

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  const send = (code, type, body) => {
    res.writeHead(code, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };
  if (url.startsWith('/heroicons.css')) return send(200, 'text/css; charset=utf-8', CSS);
  if (url.startsWith('/missing.css')) return send(404, 'text/plain', 'not here');
  if (url === '/r1') { res.writeHead(302, { location: '/r2' }); return res.end(); }
  if (url === '/r2') { res.writeHead(302, { location: '/r3' }); return res.end(); }
  if (url === '/r3') { res.writeHead(302, { location: '/r4' }); return res.end(); }
  if (url === '/r4') { res.writeHead(302, { location: '/r5' }); return res.end(); }
  if (url === '/r5') return send(200, 'text/plain', 'arrived');
  return send(404, 'text/plain', 'nope');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

after(() => {
  try { server.close(); } catch { /* already closed */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

function ctx(overrides = {}) {
  return {
    workspace: WS, sessionId: 'v1132', mcpServers: [], emit: () => {},
    approve: async () => true, fullAccess: true, ...overrides,
  };
}
const run = (name, args, c = ctx()) => tools.executeTool(name, JSON.stringify(args ?? {}), c);

/** Temporarily replace global fetch — tools.ts calls the global at call time. */
async function withFetch(fn, body) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  try { return await body(); } finally { globalThis.fetch = original; }
}
function dnsFailure() {
  const err = new TypeError('fetch failed');
  err.cause = Object.assign(new Error('getaddrinfo ENOTFOUND no-such-host.invalid'), { code: 'ENOTFOUND' });
  return err;
}
function timeoutFailure() {
  const err = new Error('The operation was aborted due to timeout');
  err.name = 'TimeoutError';
  return err;
}
function fakeDdgResponse(html) {
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

// ------------------------------------------------------------
// 1) download_file writes the REAL bytes to a verified workspace path.
// ------------------------------------------------------------
test('v1132 download_file saves a real CSS file with exact bytes + verified path', async () => {
  const dest = join(WS, 'assets', 'heroicons.css');
  const r = await run('download_file', { url: `${BASE}/heroicons.css`, dest: 'assets/heroicons.css' });
  assert.equal(r.ok, true, r.output);
  assert.equal(existsSync(dest), true, 'the file must actually exist on disk');
  assert.deepEqual(readFileSync(dest), CSS_BYTES, 'bytes on disk must equal bytes served');
  assert.match(r.output, /content-type: text\/css/i);
  assert.match(r.output, /verified: \d+ byte\(s\) present on disk inside the workspace/i);
  assert.match(r.output, /assets[\\/]heroicons\.css/);
});

test('v1132 download_file refuses an escaping destination (path jail)', async () => {
  // fullAccess OFF: a public-looking URL passes the SSRF guard so the
  // workspace write-jail is the rule actually under test here.
  const r = await run('download_file',
    { url: 'https://example.com/heroicons.css', dest: join(tmp, 'outside.css') },
    ctx({ fullAccess: false }),
  );
  assert.equal(r.ok, false);
  assert.match(r.output, /outside the workspace|PathEscapesWorkspace/i);
  assert.match(r.output, /Fix:/i);
});

// ------------------------------------------------------------
// 2) web_fetch: verbatim CSS, 404, DNS, timeout, bounded redirects.
// ------------------------------------------------------------
test('v1132 web_fetch returns CSS verbatim (content-type aware) and reports bytes', async () => {
  const r = await run('web_fetch', { url: `${BASE}/heroicons.css` });
  assert.equal(r.ok, true, r.output);
  assert.match(r.output, /content-type: text\/css/i);
  assert.match(r.output, /bytes read: \d+/i);
  assert.match(r.output, /\.hero > svg \{ width: 1\.25rem/, 'CSS selectors must survive verbatim');
  assert.match(r.output, /content: "<arrow>"/, 'non-HTML content must NOT be HTML-stripped');
});

test('v1132 web_fetch HTML keeps TITLE, strips chrome and preserves paragraphs (even when mislabeled text/plain)', async () => {
  const PAGE_HTML = `<!doctype html><html><head><title>Release notes</title>
    <style>.x{color:red}</style><script>console.log('evil')</script></head>
    <body><nav><a href="#">Home</a></nav>
    <article><p>First paragraph about the release.</p>
    <p>Second paragraph with details.</p></article>
    <footer>copyright footer noise</footer></body></html>`;
  const read = async (contentType) => withFetch(
    async () => new Response(PAGE_HTML, { status: 200, headers: contentType ? { 'content-type': contentType } : {} }),
    () => run('web_fetch', { url: 'https://example.test/notes' }),
  );
  for (const ct of ['text/html', 'text/plain', '']) {
    const r = await read(ct);
    assert.equal(r.ok, true, `content-type "${ct}": ${r.output}`);
    assert.match(r.output, /TITLE: Release notes/, `content-type "${ct}" must surface the page title`);
    assert.match(r.output, /First paragraph about the release\.\nSecond paragraph/, `content-type "${ct}" must preserve paragraphs`);
    assert.doesNotMatch(r.output, /console\.log/, `content-type "${ct}" must strip scripts`);
    assert.doesNotMatch(r.output, /copyright footer noise/, `content-type "${ct}" must strip the footer`);
    assert.doesNotMatch(r.output, />Home<\/a>/, `content-type "${ct}" must strip nav chrome`);
  }
});

test('v1132 web_fetch 404 is distinct, actionable and not a generic failure', async () => {
  const r = await run('web_fetch', { url: `${BASE}/missing.css` });
  assert.equal(r.ok, false);
  assert.match(r.output, /HTTP 404/i);
  assert.match(r.output, /not found/i);
  assert.match(r.output, /Fix:/i);
  assert.doesNotMatch(r.output, /^Fetch failed: fetch failed/i);
});

test('v1132 web_fetch DNS failure names DNS, and timeout names the timeout', async () => {
  const dns = await withFetch(async () => { throw dnsFailure(); },
    () => run('web_fetch', { url: 'https://no-such-host.invalid/x.css' }));
  assert.equal(dns.ok, false);
  assert.match(dns.output, /DNS resolution failed/i);
  assert.match(dns.output, /no-such-host\.invalid/);
  assert.match(dns.output, /Fix:/i);

  const to = await withFetch(async () => { throw timeoutFailure(); },
    () => run('web_fetch', { url: `${BASE}/heroicons.css` }));
  assert.equal(to.ok, false);
  assert.match(to.output, /timed out after 15000 ms/i);
  assert.match(to.output, /Fix:/i);
  assert.notEqual(dns.output, to.output, 'DNS and timeout must be distinct errors');
});

test('v1132 web_fetch bounds redirect chains instead of following forever', async () => {
  const r = await run('web_fetch', { url: `${BASE}/r1` });
  assert.equal(r.ok, false);
  assert.match(r.output, /Too many redirects/i);
});

// ------------------------------------------------------------
// 3) web_search: real parse path works; failure is honest, never silent.
// ------------------------------------------------------------
test('v1132 web_search parses real DuckDuckGo-style HTML when reachable', async () => {
  const html = `<!doctype html><html><body>
    <a class="result__a" href="https://example.com/a?q=1&amp;x=2">Result A</a>
    <a class="result__snippet">Snippet A</a>
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fb">Result B</a>
    <a class="result__snippet">Snippet B</a>
  </body></html>`;
  const r = await withFetch(async () => fakeDdgResponse(html),
    () => run('web_search', { query: 'heroicons css cdn' }));
  assert.equal(r.ok, true, r.output);
  assert.match(r.output, /Result A/);
  assert.match(r.output, /https:\/\/example\.com\/a\?q=1&x=2/);
  assert.match(r.output, /https:\/\/example\.org\/b/, 'uddg redirect targets must be decoded');
  assert.match(r.output, /Snippet A/);
});

test('v1132 web_search failure says "unavailable" + points to web_fetch / web_download', async () => {
  const r = await withFetch(async () => { throw dnsFailure(); },
    () => run('web_search', { query: 'anything' }));
  assert.equal(r.ok, false);
  assert.match(r.output, /Web search is currently unavailable/i);
  assert.match(r.output, /fabricated/i);
  assert.match(r.output, /web_fetch/i);
  assert.match(r.output, /web_download/i);
  assert.doesNotMatch(r.output, /^Search failed: fetch failed/i);
});

// ------------------------------------------------------------
// 4) run_command: the REAL stderr tail reaches the model verbatim.
// ------------------------------------------------------------
test('v1132 run_command surfaces the real stderr tail verbatim with the real exit code', async () => {
  const r = await run('run_command', {
    command: `node -e "process.stderr.write('V1132-STDERR-BOOM\\n');process.exit(9)"`,
  });
  assert.equal(r.ok, false);
  assert.match(r.output, /Command FAILED/);
  assert.match(r.output, /exit code 9/);
  assert.match(r.output, /\[exit code: 9\]/);
  assert.match(r.output, /V1132-STDERR-BOOM/, 'the actual stderr line must be in the tool_result');
  assert.match(r.output, /BEGIN ERROR TAIL[\s\S]*V1132-STDERR-BOOM[\s\S]*END ERROR TAIL/);
  assert.match(r.output, /VERBATIM tail/);
  assert.match(r.output, /diagnosis:/);
  assert.match(r.output, /fix:/i);
});

test('v1132 run_command success returns real stdout and exit code 0', async () => {
  const r = await run('run_command', { command: `node -e "console.log('V1132-STDOUT-OK')"` });
  assert.equal(r.ok, true, r.output);
  assert.match(r.output, /V1132-STDOUT-OK/);
  assert.match(r.output, /\[exit code: 0\]/);
});
