// ============================================================================
// SADEEM v11.34 (V5) — INTERNET / DOWNLOAD / PREVIEW VERIFICATION GUARD
//
// DIAGNOSIS + TEST ONLY. This file does NOT fix anything. It locks in the five
// post-V5 guarantees the founder asked for, and FAILS LOUDLY (file:line in the
// companion doc) if any of them regresses or was never actually delivered:
//
//   1. Real loopback HTTP: web_fetch → verbatim CSS; download_file → exact bytes
//      to a jailed path; http_request → real status + body.
//   2. Distinct honest errors (DNS vs timeout vs 403 vs 404) — no "I can't",
//      no raw JSON, no mixed EN+AR, always a next step.
//   3. web_search → parsed results OR an explicit honest fallback w/ next step.
//   4. Preview → a REAL server starts, a REAL port/URL is returned, the URL
//      actually serves the file, no fabricated "ready", failure card honest.
//   5. A preview-open capability the AI can actually call (registered tool +
//      real `preview_open` event with a live URL through the real engine).
//
// Method: a REAL loopback node:http server for the executors + stubbed global
// fetch only for DNS/timeout/DuckDuckGo failure classes + the REAL engine.ts
// (esbuild-bundled, electron stubbed) driven by a LOCAL scripted provider.
// ZERO external network, ZERO model. We assert what happened on disk, on the
// wire and in the tool dispatcher / event stream — not source strings.
//
// Run: node --test --test-force-exit tests/v1134-internet-guard.test.mjs
// ============================================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

process.env.SURNIA_NO_BROWSER = '1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1134-'));
const RESULTS = [];
const fwd = (p) => p.replace(/\\/g, '/');

const record = (id, pass, detail) => {
  RESULTS.push({ id, pass: !!pass, detail });
  console.log(`V1134_CHECK ${id} ${pass ? 'PASS' : 'FAIL'} :: ${detail}`);
};
/** Record then rethrow so node:test ALSO goes red — a guard must not self-soothe. */
async function check(id, detail, fn) {
  try {
    const info = await fn();
    record(id, true, info || detail);
  } catch (err) {
    record(id, false, `${detail} :: ${String(err?.message ?? err)}`);
    throw err;
  }
}

// ---------- bundle the REAL source headlessly ----------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN,
    entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

const userDataDir = join(tmp, 'userdata');
mkdirSync(userDataDir, { recursive: true });
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `
const paths = { temp: ${JSON.stringify(tmp)}, userData: ${JSON.stringify(userDataDir)}, home: ${JSON.stringify(tmp)}, appData: ${JSON.stringify(tmp)} };
class StubWebContents { on() {} async executeJavaScript() { return []; } }
class StubBrowserWindow { constructor(){ this.webContents = new StubWebContents(); } destroy(){} setBounds(){} getBounds(){ return { x:0, y:0 }; } }
module.exports = {
  app: { getPath: (k) => paths[k] ?? paths.userData, isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },
  ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
  Notification: { isSupported: () => false },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder() {}, trashItem: async () => {} },
  clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
  WebContents: class {}, BrowserWindow: StubBrowserWindow,
  powerMonitor: { on() {} }, screen: {},
};`);

const entry = join(tmp, 'v1134-entry.ts');
writeFileSync(entry,
  `export * from '${fwd(join(ROOT, 'electron/agent/tools.ts'))}';\n` +
  `export * from '${fwd(join(ROOT, 'electron/agent/engine.ts'))}';\n` +
  `export * as Prompt from '${fwd(join(ROOT, 'electron/agent/prompts.ts'))}';\n` +
  `export * as Preview from '${fwd(join(ROOT, 'electron/services/previewService.ts'))}';\n`);

let mod = null;
let bundleError = null;
try {
  const out = join(tmp, 'v1134.cjs');
  bundle(entry, out);
  mod = require(out);
} catch (err) {
  bundleError = String(err?.stack ?? err);
  console.error('[V1134] BUNDLE FAILED:', bundleError);
}

// ---------- real loopback HTTP fixture ----------
const CSS = [
  '/* heroicons v1134 fixture */',
  '.hero > svg { width: 1.25rem; height: 1.25rem; }',
  '.icon::after { content: "<arrow>"; }',
  '@media (max-width: 40rem) { .hero > svg { width: 1rem; } }',
].join('\n') + '\n';
const CSS_BYTES = Buffer.from(CSS, 'utf8');
const API_JSON = JSON.stringify({ ok: true, v1134: 'api-sentinel', nested: { n: 42 } });
const PAGE_SENTINEL = 'V1134_PAGE_SENTINEL_4e91';

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  const send = (code, type, body) => {
    res.writeHead(code, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };
  if (url.startsWith('/heroicons.css')) return send(200, 'text/css; charset=utf-8', CSS);
  if (url.startsWith('/missing.css')) return send(404, 'text/plain', 'not here');
  if (url.startsWith('/forbidden')) return send(403, 'text/plain', 'go away');
  if (url.startsWith('/api')) return send(200, 'application/json', API_JSON);
  if (url.startsWith('/page')) return send(200, 'text/html', `<!doctype html><title>Probe</title><p>${PAGE_SENTINEL}</p>`);
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
  try { mod?.Preview?.staticStop?.(); mod?.Preview?.devStop?.(); } catch { /* best effort */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  try {
    writeFileSync(join(ROOT, 'tests', '.v1134-internet-guard.results.json'), JSON.stringify({
      at: new Date().toISOString(), bundleError, results: RESULTS,
    }, null, 2));
  } catch { /* best effort */ }
  console.log('V1134_SUMMARY ' + JSON.stringify(RESULTS.map((r) => ({ id: r.id, pass: r.pass }))));
});

// ---------- executor helpers ----------
const WS = join(tmp, 'ws');
mkdirSync(WS, { recursive: true });
function ctx(overrides = {}) {
  return {
    workspace: WS, sessionId: 'v1134', mcpServers: [], emit: () => {},
    approve: async () => true, fullAccess: true, ...overrides,
  };
}
const run = (name, args, c = ctx()) => mod.executeTool(name, JSON.stringify(args ?? {}), c);
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
/** Honesty contract for EVERY tool error the model sees. */
function assertHonestError(out) {
  assert.doesNotMatch(out, /\bI\s+can(?:no|')t\b/i, 'defeatist "I can\'t" phrasing is forbidden');
  assert.doesNotMatch(out, /[\u0600-\u06FF]/, 'tool errors must be ONE language (English), never mixed EN+AR');
  assert.doesNotMatch(out, /\{\s*"[\w-]+"\s*:/, 'raw JSON must never leak into a tool error');
  assert.match(out, /\b(Fix|Retry|Next|Use|Check|Try)\b/i, 'every error must carry an actionable next step');
}

// ---------- engine reality helpers (real engine + local scripted provider) ----------
const MAIN_IDENTITY = 'You are SADEEM, an expert engineering agent';
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const chunk = (delta, finish = null) =>
  sse({ id: 'v1134', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] });
function sseHeaders(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  res.flushHeaders();
}
function finishSse(res, finish, usage) {
  if (usage) res.write(sse({ usage, choices: [] }));
  res.write(chunk({}, finish));
  res.write('data: [DONE]\n\n');
  res.end();
}
function toolDeltas(name, args, id) {
  const half = Math.max(1, Math.floor(args.length / 2));
  return [
    { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(0, half) } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(half) } }] },
  ];
}
function startMock(onMain, state) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep */ }
      const sys = typeof body.system === 'string'
        ? body.system
        : (body.messages ?? []).filter((m) => m?.role === 'system').map((m) => String(m.content ?? '')).join('\n');
      const isMain = sys.includes(MAIN_IDENTITY);
      const rec = { isMain, system: sys, body, msgs: body.messages ?? [] };
      requests.push(rec);
      try {
        if (!isMain || body.model !== 'v1134-model') {
          sseHeaders(res); finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 }); return;
        }
        await onMain({ res, rec, n: state.mainCount++, state });
      } catch (err) {
        try { res.destroy(); } catch { /* gone */ }
        state.handlerErrors.push(String(err?.message ?? err));
      }
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const listening = new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  return {
    requests, port: listening,
    async stop() { for (const s of sockets) s.destroy(); await new Promise((r) => server.close(r)); },
  };
}
function writeSettings(base) {
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({
    schemaVersion: 4, language: 'en', dnaEnabled: false,
    providers: { custom: { apiKey: 'test-key', baseUrl: base } },
    agent: {
      maxRetries: 0, autoCompact: false, autoVerify: false, selfCritique: false,
      criticGate: false, autoMemory: false, checkpointsEnabled: false,
      allowModelFailover: false, parallelToolCalls: false, toolProfile: 'full',
      maxTurns: 100, continueAuto: true, maxContinueRounds: 5,
    },
    doneNotifications: false,
  }));
}
function setEnv() {
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = '5,5,5,5,5,5';
  process.env.SURNIA_DELTA_FLUSH_MS = '5';
  process.env.SURNIA_SKIP_UI_GATE = '1';
  process.env.SURNIA_STREAM_CONTINUE_BUDGET = '0';
  process.env.SURNIA_ENGINE_IDLE_MS = '30_000';
  process.env.SURNIA_LIVENESS_PULSE_MS = '50';
  process.env.SURNIA_EXTENDED_REASONING_MS = '0';
  delete process.env.SURNIA_MAX_RUN_MS;
}
function makeIo() {
  const events = [];
  const io = {
    events,
    send(e) { events.push({ ...e, at: Date.now() }); },
    getDecision() { return Promise.resolve({ requestId: 'v1134', action: 'allow' }); },
    isAborted() { return false; },
    onFetchSignal() {},
  };
  return io;
}
async function drive(name, onMain, overrides = {}) {
  const state = { mainCount: 0, handlerErrors: [] };
  const mock = startMock(onMain, state);
  const port = await mock.port;
  const base = `http://127.0.0.1:${port}/v1`;
  writeSettings(base);
  setEnv();
  const io = makeIo();
  const ws = mkdtempSync(join(tmp, 'v1134-' + name.replace(/[^a-z0-9]/gi, '') + '-'));
  const params = {
    task: 'chat',
    sessionId: 'v1134-' + name + '-' + Math.random().toString(36).slice(2),
    messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Do the task.', timestamp: Date.now() }],
    model: { provider: 'custom', model: 'v1134-model', maxTokens: 2048, contextWindow: 200_000 },
    mode: 'fullAccess', workspace: ws, apiKey: 'test-key', baseUrl: base,
    taskMode: 'build', ...overrides,
  };
  let thrown = null;
  try { await mod.runAgent(params, io); } catch (err) { thrown = err; }
  return { io, ev: io.events, state, ws, mock, requests: mock.requests, thrown };
}
const byType = (ev, t) => ev.filter((e) => e.type === t);
const transcriptHas = (r, needle) => {
  const re = needle instanceof RegExp ? needle : new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return r.requests.filter((q) => q.isMain).some((q) => re.test(JSON.stringify(q.msgs)));
};

// ===========================================================================
// G0 — the AI can even SEE the tools (default profiles). A hidden tool is a
//      tool the model can never call — the classic "AI can't use internet".
// ===========================================================================
test('V1134/G0 — internet + preview tools are advertised to the model', async () => {
  await check('G0', 'advertised in full + balanced profiles', async () => {
    assert.ok(mod, 'engine/tools bundle failed: ' + bundleError);
    const need = ['web_search', 'web_fetch', 'http_request', 'download_file', 'web_download', 'preview'];
    const names = (p) => mod.getToolDefs([], p).map((d) => d.name);
    for (const profile of ['full', 'balanced']) {
      const have = names(profile);
      const missing = need.filter((n) => !have.includes(n));
      assert.equal(missing.length, 0, `profile "${profile}" hides: ${missing.join(', ')}`);
    }
    return `full+balanced expose ${need.join(', ')}`;
  });
});

// ===========================================================================
// 1 — REAL loopback HTTP through the real executors.
// ===========================================================================
test('V1134/G1a — web_fetch returns verbatim CSS from a real server', async () => {
  await check('G1a', 'web_fetch CSS verbatim', async () => {
    const r = await run('web_fetch', { url: `${BASE}/heroicons.css` });
    assert.equal(r.ok, true, r.output);
    assert.match(r.output, /content-type: text\/css/i);
    assert.match(r.output, /bytes read: \d+/i);
    assert.match(r.output, /\.hero > svg \{ width: 1\.25rem/, 'CSS selector must survive verbatim');
    assert.match(r.output, /content: "<arrow>"/, 'non-HTML must NOT be HTML-stripped');
    return `verbatim CSS + byte count from ${BASE}`;
  });
});

test('V1134/G1b — download_file writes exact bytes to a jailed path', async () => {
  await check('G1b', 'download_file exact bytes + path jail', async () => {
    const dest = join(WS, 'assets', 'heroicons.css');
    const r = await run('download_file', { url: `${BASE}/heroicons.css`, dest: 'assets/heroicons.css' });
    assert.equal(r.ok, true, r.output);
    assert.equal(existsSync(dest), true, 'file must actually exist on disk');
    assert.deepEqual(readFileSync(dest), CSS_BYTES, 'bytes on disk must equal bytes served');
    assert.match(r.output, /verified: \d+ byte\(s\) present on disk inside the workspace/i);
    // Path jail: with fullAccess OFF an escaping destination is refused.
    const esc = await run('download_file',
      { url: 'https://example.com/heroicons.css', dest: join(tmp, 'outside.css') },
      ctx({ fullAccess: false }));
    assert.equal(esc.ok, false);
    assert.match(esc.output, /outside the workspace|PathEscapesWorkspace/i);
    return `exact bytes at assets/heroicons.css; escaping dest refused`;
  });
});

test('V1134/G1c — http_request works against a real server', async () => {
  await check('G1c', 'http_request real status + body', async () => {
    const r = await run('http_request', { url: `${BASE}/api` });
    assert.equal(r.ok, true, r.output);
    assert.match(r.output, /HTTP 200/i);
    assert.match(r.output, /v1134-api-sentinel|"nested"/, 'real JSON body must reach the model');
    return `HTTP 200 + real JSON body from ${BASE}/api`;
  });
});

// ===========================================================================
// 2 — DISTINCT, HONEST errors. No "I can't", no raw JSON, no mixed EN+AR.
// ===========================================================================
test('V1134/G2a — 403 and 404 are distinct + honest (real server)', async () => {
  await check('G2a', 'distinct 403 / 404, honest contract', async () => {
    const r403 = await run('web_fetch', { url: `${BASE}/forbidden` });
    const r404 = await run('web_fetch', { url: `${BASE}/missing.css` });
    assert.equal(r403.ok, false);
    assert.equal(r404.ok, false);
    assert.match(r403.output, /HTTP 403/i);
    assert.match(r404.output, /HTTP 404/i);
    assert.match(r404.output, /not found/i);
    assert.notEqual(r403.output, r404.output, '403 and 404 must be distinct');
    for (const out of [r403.output, r404.output]) {
      assertHonestError(out);
      assert.doesNotMatch(out, /^Fetch failed: fetch failed/i);
    }
    return '403=access-refused, 404=not-found, both single-language + actionable';
  });
});

test('V1134/G2b — DNS and timeout are distinct + honest (stubbed fetch)', async () => {
  await check('G2b', 'distinct DNS / timeout, honest contract', async () => {
    const dns = await withFetch(async () => { throw dnsFailure(); },
      () => run('web_fetch', { url: 'https://no-such-host.invalid/x.css' }));
    const to = await withFetch(async () => { throw timeoutFailure(); },
      () => run('web_fetch', { url: `${BASE}/heroicons.css` }));
    assert.equal(dns.ok, false);
    assert.equal(to.ok, false);
    assert.match(dns.output, /DNS resolution failed/i);
    assert.match(dns.output, /no-such-host\.invalid/);
    assert.match(to.output, /timed out/i);
    assert.notEqual(dns.output, to.output, 'DNS and timeout must be distinct');
    for (const out of [dns.output, to.output]) {
      assertHonestError(out);
      assert.doesNotMatch(out, /^Fetch failed: fetch failed/i);
    }
    return 'DNS=named host + fix, timeout=named ms + fix, both honest';
  });
});

// ===========================================================================
// 3 — web_search: parsed results OR an explicit honest fallback.
// ===========================================================================
test('V1134/G3a — web_search parses real DuckDuckGo-style HTML', async () => {
  await check('G3a', 'web_search parse path', async () => {
    const html = `<!doctype html><html><body>
      <a class="result__a" href="https://example.com/a?q=1&amp;x=2">Result A</a>
      <a class="result__snippet">Snippet A</a>
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fb">Result B</a>
      <a class="result__snippet">Snippet B</a>
    </body></html>`;
    const r = await withFetch(async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
      () => run('web_search', { query: 'heroicons css cdn' }));
    assert.equal(r.ok, true, r.output);
    assert.match(r.output, /Result A/);
    assert.match(r.output, /https:\/\/example\.com\/a\?q=1&x=2/);
    assert.match(r.output, /https:\/\/example\.org\/b/, 'uddg redirect targets must be decoded');
    assert.match(r.output, /Snippet A/);
    return 'parsed ranked URL + snippet results';
  });
});

test('V1134/G3b — web_search failure is explicit + offers a next step', async () => {
  await check('G3b', 'web_search honest fallback', async () => {
    const r = await withFetch(async () => { throw dnsFailure(); },
      () => run('web_search', { query: 'anything' }));
    assert.equal(r.ok, false);
    assert.match(r.output, /Web search is currently unavailable/i);
    assert.match(r.output, /fabricated/i);
    assert.match(r.output, /web_fetch/i);
    assert.match(r.output, /web_download/i);
    assertHonestError(r.output);
    assert.doesNotMatch(r.output, /^Search failed: fetch failed/i);
    return 'explicit unavailable + no fabrication + web_fetch/web_download next step';
  });
});

// ===========================================================================
// 6 — ENGINE REALITY: the AI can actually dispatch the internet tools and the
//     real bytes reach the next model turn (not just a direct executor call).
// ===========================================================================
test('V1134/G6 — AI can call web_fetch + download_file + http_request through the engine', async () => {
  await check('G6', 'engine reality: internet tools dispatched + verbatim to model', async () => {
    assert.ok(mod, 'engine bundle failed: ' + bundleError);
    const WEB = 'V1134_ENGINE_WEB_8c2f';
    const DL = 'V1134_ENGINE_DL_1b7e';
    const pageServer = http.createServer((req, res) => {
      if (req.url === '/dl.css') { res.writeHead(200, { 'content-type': 'text/css' }); res.end(DL); return; }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html><head><title>P</title></head><body><p>${WEB}</p></body></html>`);
    });
    const pagePort = await new Promise((resolve) => pageServer.listen(0, '127.0.0.1', () => resolve(pageServer.address().port)));
    const base = `http://127.0.0.1:${pagePort}`;
    const r = await drive('internet', async ({ res, n }) => {
      sseHeaders(res);
      if (n === 0) {
        for (const d of toolDeltas('web_fetch', JSON.stringify({ url: `${base}/page` }), 'c_web')) res.write(chunk(d));
        finishSse(res, 'tool_calls', { prompt_tokens: 8, completion_tokens: 3 });
      } else if (n === 1) {
        for (const d of toolDeltas('download_file', JSON.stringify({ url: `${base}/dl.css`, dest: 'assets/dl.css' }), 'c_dl')) res.write(chunk(d));
        finishSse(res, 'tool_calls', { prompt_tokens: 8, completion_tokens: 3 });
      } else if (n === 2) {
        for (const d of toolDeltas('http_request', JSON.stringify({ url: `${base}/page` }), 'c_http')) res.write(chunk(d));
        finishSse(res, 'tool_calls', { prompt_tokens: 8, completion_tokens: 3 });
      } else {
        res.write(chunk({ content: 'All internet tools used.' }));
        finishSse(res, 'stop', { prompt_tokens: 8, completion_tokens: 3 });
      }
    });
    await r.mock.stop();
    await new Promise((resolve) => pageServer.close(resolve));
    const tr = byType(r.ev, 'tool_result');
    const webOk = tr.find((e) => e.toolCallId === 'c_web')?.ok === true;
    const dlOk = tr.find((e) => e.toolCallId === 'c_dl')?.ok === true;
    const httpOk = tr.find((e) => e.toolCallId === 'c_http')?.ok === true;
    assert.equal(webOk, true, 'web_fetch did not succeed in engine reality');
    assert.equal(dlOk, true, 'download_file did not succeed in engine reality');
    assert.equal(httpOk, true, 'http_request did not succeed in engine reality');
    assert.equal(existsSync(join(r.ws, 'assets', 'dl.css')), true, 'download_file wrote no real file');
    assert.match(readFileSync(join(r.ws, 'assets', 'dl.css'), 'utf8'), new RegExp(DL));
    assert.equal(transcriptHas(r, WEB), true, 'web_fetch bytes did not reach the model');
    // download_file reports the VERIFIED path + byte count (not the file bytes) —
    // that confirmation is what the model needs to know the download succeeded.
    assert.equal(transcriptHas(r, /assets[\\/]dl\.css/), true, 'download path did not reach the model');
    assert.equal(transcriptHas(r, /verified: \d+ byte/i), true, 'download verification did not reach the model');
    return `web=${webOk} dl=${dlOk} http=${httpOk} web_bytes+download_path in model=true`;
  });
});

// ===========================================================================
// 4 + 5 — PREVIEW REALITY: real server, real URL, it serves the file, no
//         fabricated "ready", and an AI-callable preview-open capability.
// ===========================================================================
let previewReality = null;

test('V1134/G4a — preview starts a REAL server with a REAL URL that serves the file', async () => {
  await check('G4a', 'preview static: real server + real URL + served bytes', async () => {
    assert.ok(mod, 'engine bundle failed: ' + bundleError);
    const SENTINEL = 'V1134_PREVIEW_SENTINEL_9a3d';
    const ws = mkdtempSync(join(tmp, 'v1134-previewok-'));
    writeFileSync(join(ws, 'index.html'), `<!doctype html><title>V1134</title><p>${SENTINEL}</p>`);
    const r = await drive('previewok', async ({ res, n }) => {
      sseHeaders(res);
      if (n === 0) {
        for (const d of toolDeltas('preview', JSON.stringify({ action: 'static' }), 'c_prev')) res.write(chunk(d));
        finishSse(res, 'tool_calls', { prompt_tokens: 8, completion_tokens: 3 });
      } else {
        res.write(chunk({ content: 'Previewed.' }));
        finishSse(res, 'stop', { prompt_tokens: 8, completion_tokens: 3 });
      }
    }, { workspace: ws });
    await r.mock.stop();
    // Find the real URL the engine emitted.
    const opens = byType(r.ev, 'preview_open').filter((e) => typeof e.url === 'string' && e.url.startsWith('http'));
    assert.ok(opens.length > 0, 'no preview_open event with a real HTTP URL was emitted');
    const url = opens[opens.length - 1].url;
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+/, `preview URL is not a real loopback port: ${url}`);
    // The tool result must claim serving at that same real URL.
    const prev = byType(r.ev, 'tool_result').find((e) => e.toolCallId === 'c_prev');
    assert.equal(prev?.ok, true, `preview tool failed: ${prev?.output}`);
    assert.match(prev.output, /http:\/\/127\.0\.0\.1:\d+/, 'preview output must carry the real URL');
    // "No fabricated ready": the URL must ACTUALLY serve the file we wrote.
    const got = await fetch(url);
    assert.equal(got.status, 200, 'preview URL did not respond 200');
    const text = await got.text();
    assert.match(text, new RegExp(SENTINEL), 'preview URL did not serve the real file bytes');
    previewReality = { url, served: true, event: opens.length };
    return `preview_open ${url} served ${SENTINEL} (200)`;
  });
});

test('V1134/G4b — preview failure is honest (no fabricated "ready")', async () => {
  await check('G4b', 'preview dev_start failure card honest', async () => {
    assert.ok(mod, 'engine bundle failed: ' + bundleError);
    // Empty workspace: no package.json ⇒ devStart must fail honestly.
    const r = await drive('previewfail', async ({ res, n }) => {
      sseHeaders(res);
      if (n === 0) {
        for (const d of toolDeltas('preview', JSON.stringify({ action: 'dev_start' }), 'c_fail')) res.write(chunk(d));
        finishSse(res, 'tool_calls', { prompt_tokens: 8, completion_tokens: 3 });
      } else {
        res.write(chunk({ content: 'Could not start preview.' }));
        finishSse(res, 'stop', { prompt_tokens: 8, completion_tokens: 3 });
      }
    });
    await r.mock.stop();
    const prev = byType(r.ev, 'tool_result').find((e) => e.toolCallId === 'c_fail');
    assert.equal(prev?.ok, false, 'dev_start with no package.json must fail, not claim success');
    assert.match(prev.output, /No package\.json|failed/i, 'failure must name the real cause');
    assert.doesNotMatch(prev.output, /ready|Serving .* at http/i, 'no fabricated "ready" / URL on failure');
    assertHonestError(prev.output);
    const bogusOpen = byType(r.ev, 'preview_open').some((e) => typeof e.url === 'string' && e.url.startsWith('http'));
    assert.equal(bogusOpen, false, 'a failed preview must not emit a live preview_open URL');
    return `honest failure: "${prev.output.slice(0, 90)}"`;
  });
});

test('V1134/G5 — an AI-callable preview-open capability exists and works', async () => {
  await check('G5', 'preview-open capability: registered + real event with URL', async () => {
    assert.ok(mod, 'engine bundle failed: ' + bundleError);
    // The capability must be a real, advertised tool the model can call...
    const defs = mod.getToolDefs([], 'balanced');
    const preview = defs.find((d) => d.name === 'preview');
    assert.ok(preview, 'no "preview" tool is advertised to the model');
    const actions = String(JSON.stringify(preview.parameters ?? ''));
    assert.match(actions, /static|dev_start/, 'preview tool must expose a server-starting action');
    // ...and calling it through the engine must emit a live preview_open URL.
    assert.ok(previewReality?.url, 'G4a did not produce a live preview URL');
    assert.equal(previewReality.served, true, 'the preview-open capability did not serve real bytes');
    return `tool "preview" advertised; preview_open(${previewReality.url}) emitted + served`;
  });
});

// ===========================================================================
// VERDICT — a guard that reports FAIL but exits 0 is just another green test.
// ===========================================================================
test('V1134/VERDICT — no internet/download/preview guarantee failed', () => {
  const failed = RESULTS.filter((r) => !r.pass);
  const msg = failed.length
    ? `V5 INCOMPLETE — ${failed.length}/${RESULTS.length} internet/download/preview checks failed: ` +
      failed.map((f) => `${f.id} (${f.detail})`).join(' | ')
    : `V5 VERIFIED — all ${RESULTS.length} internet/download/preview checks pass`;
  console.log(`V1134_VERDICT ${msg}`);
  assert.equal(failed.length, 0, msg);
});
