import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.11.0 (wave2-A3) — UNIVERSAL LIVE PREVIEW tests.
// Covers:
//   (a) static dir → preview URL serves index.html (real HTTP 200 + body)
//       + the NEW directory-listing fallback for folders WITHOUT index.html
//   (b) node server printing "listening on 3000" → bare port parsed, served,
//       port released on stop
//   (c) python http.server fallback project → detected + served (skips
//       honestly when python3 is unavailable or the port is busy)
//   (d) single .pdf / .svg artifacts → preview routes return the file
//   (e) auto-open: REAL engine run that writes index.html emits
//       task_report then preview_open+previewHint; a pure Q&A turn does NOT;
//       the store turns the hint into a sequenced previewAuto request
//       (suppressed while the same preview is already showing)
//   (f) teardown releases the port — restart on the same port succeeds
// Run: node --test --test-force-exit tests/v1111-preview.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1111-preview-'));

// ---------- esbuild bundle (same flags as the other harnesses) ----------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, 
    entry,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${out}`,
    '--external:electron',
    '--external:@xterm/xterm',
    '--external:@xterm/addon-fit',
    '--external:monaco-editor',
    '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// ---------- electron stub with an ISOLATED userData dir ----------
const userDataDir = join(tmp, 'userdata');
mkdirSync(userDataDir, { recursive: true });
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `module.exports = {
    app: { getPath: (k) => ${JSON.stringify(userDataDir)}, whenReady: async () => true, on() {}, quit() {} },
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: { getAllWindows: () => [] },
    Notification: { isSupported: () => false },
    shell: {},
    screen: {},
  };`,
);

// ---------- bundles under test ----------
const previewPath = join(tmp, 'preview.cjs');
bundle('electron/services/previewService.ts', previewPath);
const preview = require(previewPath);

const engPath = join(tmp, 'engine.cjs');
bundle('electron/agent/engine.ts', engPath);
const engine = require(engPath);

const storePath = join(tmp, 'store.cjs');
bundle('src/store.ts', storePath);
const storeMod = require(storePath);
const useStore = storeMod.useStore;

// ---------- helpers ----------
function writeSettings(mockBase) {
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 4,
      providers: { custom: { apiKey: 'test-key', baseUrl: mockBase } },
      agent: { maxRetries: 0, autoCompact: false, autoVerify: false },
      doneNotifications: false,
    }),
  );
}

const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
function sseHeaders(res) { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.flushHeaders(); }
function finishSse(res, finish = 'stop') {
  res.write(sseChunk({}, finish));
  res.write('data: [DONE]\n\n');
  res.end();
}
function toolDeltas(name, args, id) {
  const half = Math.max(1, Math.floor(args.length / 2));
  return [
    { tool_calls: [{ index: 0, id, function: { name, arguments: '' } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(0, half) } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(half) } }] },
  ];
}

function startMock() {
  const routes = new Map(); // model → handler queue
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      const q = routes.get(body.model);
      const h = q && q.length ? q.shift() : null;
      if (!h) {
        // UNSCRIPTED (trailing housekeeping call, e.g. the ui-quality fix
        // round): answer with a no-op stop turn instead of a 500 — a 500
        // would put the run through the provider-retry backoff chain (~60s)
        // and pollute the completion-hook timings under test.
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      try { await h({ res, req, body }); } catch { try { res.destroy(); } catch { /* gone */ } }
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const listening = new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  return {
    routes,
    port: () => listening,
    async stop() {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

function makeIo() {
  const events = [];
  return {
    events,
    send(e) { events.push(e); },
    async getDecision(requestId) { return { requestId, action: 'allow' }; },
    isAborted: () => false,
    onFetchSignal() {},
  };
}

async function runEngine({ baseUrl, io, sessionId, workspace, content }) {
  await engine.runAgent(
    {
      task: 'chat',
      sessionId,
      messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Do the thing.', timestamp: Date.now() }],
      model: { provider: 'custom', model: 'mock-a', maxTokens: 2048 },
      mode: 'default',
      workspace,
      apiKey: 'test-key',
      baseUrl,
    },
    io,
  );
}

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
    s.listen(port, '127.0.0.1', () => {
      s.close(() => resolve(true));
    });
  });
}

async function waitDevReady(timeoutMs = 15000) {
  for (let i = 0; i < Math.ceil(timeoutMs / 250); i++) {
    await new Promise((r) => setTimeout(r, 250));
    const s = preview.devStatus();
    if ((s.state === 'ready' && s.url) || s.state === 'error') return s;
  }
  return preview.devStatus();
}

// ============================================================
// (a) static dir → index.html served over real HTTP
//     + directory-listing fallback when there is NO index.html
// ============================================================
test('preview/static: serves index.html with HTTP 200 + body; folders without index.html get a generated listing', async () => {
  const ws = join(tmp, 'ws-static');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'index.html'), '<!doctype html><html><body><h1>SADEEM V1111 STATIC OK</h1></body></html>');
  writeFileSync(join(ws, 'style.css'), 'body{color:#111}');

  const st = await preview.staticStart(ws, 0);
  assert.ok(st.ok, `staticStart ok: ${JSON.stringify(st)}`);
  const res = await fetch(st.url);
  assert.equal(res.status, 200, 'index.html → HTTP 200');
  assert.match(res.headers.get('content-type') ?? '', /text\/html/, 'correct content-type');
  assert.ok((await res.text()).includes('SADEEM V1111 STATIC OK'), 'workspace content actually served');
  const css = await fetch(new URL('/style.css', st.url));
  assert.equal(css.status, 200, 'css asset served');
  preview.staticStop();

  // ---- v11.11 (A3): NO index.html anywhere → universal listing fallback ----
  const raw = join(tmp, 'ws-raw');
  mkdirSync(join(raw, 'sub'), { recursive: true });
  writeFileSync(join(raw, 'out.txt'), 'generated by some python script');
  writeFileSync(join(raw, 'sub', 'note.md'), '# note');
  const lst = await preview.staticStart(raw, 0);
  assert.ok(lst.ok, `listing fallback starts: ${JSON.stringify(lst)}`);
  const page = await fetch(lst.url);
  assert.equal(page.status, 200, 'listing page → HTTP 200 (never an error card)');
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  const body = await page.text();
  assert.ok(body.includes('Index of /'), 'listing title present');
  assert.ok(body.includes('out.txt'), 'file listed');
  const subdir = await fetch(new URL('/sub/', lst.url));
  assert.equal(subdir.status, 200, 'sub-directory listing works');
  assert.ok((await subdir.text()).includes('note.md'), 'nested file listed');
  preview.staticStop();
});

// ============================================================
// (b) node server printing "listening on 3000" → bare port parsed + served
//     + port released on stop
// ============================================================
test('preview/dev: bare-port stdout ("listening on 3000") is parsed and served; stop releases the port', async (t) => {
  if (!(await portRebindable(3000))) return t.skip('port 3000 already in use in this sandbox');
  const ws = join(tmp, 'ws-node');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'server.js'), [
    'const http = require("http");',
    'const s = http.createServer((q, r) => { r.writeHead(200, { "content-type": "text/plain" }); r.end("BARE-PORT-OK"); });',
    's.listen(3000, "127.0.0.1", () => console.log("listening on 3000"));',
  ].join('\n'));
  writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'x', scripts: { dev: 'node server.js' } }));

  const dv = await preview.devStart(ws, 'npm');
  assert.ok(dv.ok, `devStart ok: ${JSON.stringify(dv)}`);
  const s = await waitDevReady();
  assert.equal(s.state, 'ready', 'dev status becomes ready');
  assert.equal(s.url, 'http://127.0.0.1:3000', 'bare "listening on 3000" print parsed into the canonical URL');
  const res = await fetch(s.url);
  assert.equal(res.status, 200, 'served over the parsed port');
  assert.equal(await res.text(), 'BARE-PORT-OK', 'dev content correct');
  preview.devStop();

  // SIGTERM → the group dies within ~ms; the service also arms a 1.5s SIGKILL
  // backstop. Poll (bounded) instead of asserting synchronously.
  let released = false;
  for (let i = 0; i < 20 && !released; i++) {
    released = await portRebindable(3000);
    if (!released) await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(released, 'port 3000 released after devStop');
});

// ============================================================
// (c) python http.server fallback project (skips honestly without python3)
// ============================================================
test('preview/python: plain .py workspace falls back to http.server and serves generated output', async (t) => {
  const probe = spawnSync('python3', ['--version'], { timeout: 5000 });
  if (probe.status !== 0) return t.skip('python3 not available in this sandbox');
  if (!(await portRebindable(8000))) return t.skip('port 8000 already in use in this sandbox');

  const ws = join(tmp, 'ws-py');
  mkdirSync(join(ws, 'out'), { recursive: true });
  writeFileSync(join(ws, 'report.py'), 'print("generates files, serves nothing itself")');
  writeFileSync(join(ws, 'out', 'index.html'), '<h1>PY-FALLBACK-OK</h1>');

  const targets = await preview.detectTargets(ws);
  const pyTarget = targets.find((x) => x.kind === 'dev' && x.runtime === 'python');
  assert.ok(pyTarget, `python http.server target detected (targets: ${JSON.stringify(targets)})`);

  const dv = await preview.devStart(ws, 'python');
  assert.ok(dv.ok, `devStart(python) ok: ${JSON.stringify(dv)}`);
  const s = await waitDevReady();
  assert.equal(s.state, 'ready', 'http.server becomes ready (expected-port poll)');
  const res = await fetch(new URL('/out/index.html', s.url));
  assert.equal(res.status, 200, 'generated output served through http.server');
  assert.ok((await res.text()).includes('PY-FALLBACK-OK'), 'content correct');
  preview.devStop();
});

// ============================================================
// (d) single .pdf / .svg artifacts → preview routes return the file
// ============================================================
test('preview/artifacts: single .pdf and .svg artifacts served (viewer page + raw bytes with correct MIME)', async () => {
  const ws = join(tmp, 'ws-art');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'report.pdf'), Buffer.from('%PDF-1.4\n% SADEEM-PDF-BYTES\n'));
  writeFileSync(join(ws, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><text>SADEEM-SVG-OK</text></svg>');

  const pdf = await preview.staticStart(join(ws, 'report.pdf'), 0);
  assert.ok(pdf.ok, `pdf staticStart ok: ${JSON.stringify(pdf)}`);
  assert.match(pdf.url ?? '', /__surnia\/view\?src=report\.pdf/, 'entry URL is the generated viewer page');
  const page = await fetch(pdf.url);
  assert.equal(page.status, 200, 'viewer page → HTTP 200');
  const pageBody = await page.text();
  assert.ok(pageBody.includes('report.pdf') && pageBody.includes('iframe'), 'viewer embeds the pdf');
  const raw = await fetch(new URL('/__surnia/raw/report.pdf', pdf.url));
  assert.equal(raw.status, 200, 'raw route → HTTP 200');
  assert.match(raw.headers.get('content-type') ?? '', /application\/pdf/, 'pdf MIME');
  assert.ok((await raw.text()).includes('%PDF-1.4'), 'pdf bytes returned');
  preview.staticStop();

  const svg = await preview.staticStart(join(ws, 'icon.svg'), 0);
  assert.ok(svg.ok, `svg staticStart ok: ${JSON.stringify(svg)}`);
  const rawSvg = await fetch(new URL('/__surnia/raw/icon.svg', svg.url));
  assert.equal(rawSvg.status, 200, 'svg raw route → HTTP 200');
  assert.match(rawSvg.headers.get('content-type') ?? '', /image\/svg/, 'svg MIME');
  assert.ok((await rawSvg.text()).includes('SADEEM-SVG-OK'), 'svg bytes returned');
  preview.staticStop();
});

// ============================================================
// (e) AUTO-OPEN: engine completion with written index.html emits
//     task_report → preview_open + previewHint; Q&A turn never does.
//     The store turns the hint into a sequenced previewAuto request.
// ============================================================
test('auto-open/engine: writing index.html → preview_open+previewHint after task_report; Q&A turn → none', async () => {
  const mock = startMock();
  const base = `http://127.0.0.1:${await mock.port()}`;
  writeSettings(base);
  const ws = join(tmp, 'ws-engine');
  mkdirSync(ws, { recursive: true });

  // ---- run 1: the agent writes index.html, then finishes ----
  mock.routes.set('mock-a', [
    async ({ res }) => {
      sseHeaders(res);
      for (const d of toolDeltas('write_file', JSON.stringify({ path: 'index.html', content: '<!doctype html><h1>V1111 AUTO OPEN</h1>' }), 'c1')) {
        res.write(sseChunk(d));
      }
      finishSse(res, 'tool_calls');
    },
    async ({ res }) => {
      sseHeaders(res);
      res.write(sseChunk({ content: 'Built the page.' }));
      finishSse(res);
    },
  ]);
  const io1 = makeIo();
  await runEngine({ baseUrl: base, io: io1, sessionId: 'sess-a', workspace: ws });

  assert.ok(io1.events.some((e) => e.type === 'task_report'), 'task_report emitted on the terminal path');
  const idxReport = io1.events.findIndex((e) => e.type === 'task_report');
  const idxOpen = io1.events.findIndex((e) => e.type === 'preview_open');
  assert.ok(idxOpen > idxReport, 'preview_open follows task_report (completion hook)');
  const hinted = io1.events.find((e) => e.type === 'preview_open' && e.previewHint);
  assert.ok(hinted, 'preview_open carries a previewHint');
  assert.equal(hinted.previewHint.kind, 'static', 'index.html → static hint');
  assert.equal(hinted.ws, ws, 'hint scoped to the run workspace');
  assert.equal(io1.events.filter((e) => e.type === 'preview_open' && e.previewHint).length, 1, 'auto-open fires at most ONCE per run');

  // ---- run 2: pure Q&A (no file writes) → NO preview_open at all ----
  mock.routes.set('mock-a', [
    async ({ res }) => {
      sseHeaders(res);
      res.write(sseChunk({ content: 'Plain answer, nothing was built on disk.' }));
      finishSse(res);
    },
  ]);
  const io2 = makeIo();
  await runEngine({ baseUrl: base, io: io2, sessionId: 'sess-b', workspace: ws });
  assert.equal(io2.events.filter((e) => e.type === 'preview_open').length, 0, 'no auto-open on a no-write chat turn');
  assert.ok(io2.events.some((e) => e.type === 'task_report'), 'task_report still emitted (completion guarantee)');

  await mock.stop();
});

test('auto-open/store: previewHint → sequenced previewAuto request; repeats suppressed; foreign ws ignored; hint-less tool opens stay intact', () => {
  const ws = join(tmp, 'ws-store');
  mkdirSync(ws, { recursive: true });
  useStore.setState({
    wsPath: ws,
    previewOpen: false,
    previewAuto: null,
    previewWs: '',
    previewUrl: '',
    previewSource: '',
    previewStatus: null,
    session: { id: 's1', title: 't', messages: [{ id: 'm0', role: 'user', kind: 'text', content: 'x', timestamp: Date.now() }], createdAt: Date.now(), updatedAt: Date.now() },
  });

  // hint → request seq 1 + panel opens
  useStore.getState().ingestAgentEvent({ type: 'preview_open', ws, previewHint: { kind: 'static', label: 'index.html' } });
  let st = useStore.getState();
  assert.equal(st.previewOpen, true, 'panel opened by the completion hook event');
  assert.equal(st.previewAuto?.seq, 1, 'previewAuto request created (seq 1)');
  assert.equal(st.previewAuto?.kind, 'static', 'kind carried');
  assert.equal(st.previewAuto?.ws, ws, 'ws scoped');

  // same preview already showing → suppressed (no restart churn)
  useStore.getState().ingestAgentEvent({ type: 'preview_open', ws, previewHint: { kind: 'static', label: 'index.html' } });
  assert.equal(useStore.getState().previewAuto?.seq, 1, 'same dir/kind while open → NO new request');

  // different target → new request
  useStore.getState().ingestAgentEvent({ type: 'preview_open', ws, previewHint: { kind: 'artifact', dir: join(ws, 'report.pdf'), label: 'report.pdf' } });
  st = useStore.getState();
  assert.equal(st.previewAuto?.seq, 2, 'different target → new request (seq 2)');
  assert.equal(st.previewAuto?.kind, 'artifact', 'artifact kind carried');

  // another workspace → ignored (preview is per-session)
  useStore.getState().ingestAgentEvent({ type: 'preview_open', ws: '/elsewhere/other', previewHint: { kind: 'static' } });
  assert.equal(useStore.getState().previewAuto?.seq, 2, 'foreign-workspace hint ignored');

  // legacy tool emission (preview_open with url, no hint) → still opens the panel, no auto request
  useStore.setState({ previewOpen: false });
  useStore.getState().ingestAgentEvent({ type: 'preview_open', url: 'http://127.0.0.1:5173', ws });
  st = useStore.getState();
  assert.equal(st.previewOpen, true, 'hint-less preview_open still opens the panel (preview tool path)');
  assert.equal(st.previewAuto?.seq, 2, 'no new auto request without a hint');
});

// ============================================================
// (f) teardown releases the port — restart on the same port succeeds
// ============================================================
test('teardown: static port released immediately — restart on the same port succeeds', async () => {
  const port = await probeFreePort();
  const ws = join(tmp, 'ws-teardown');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'index.html'), '<h1>TEARDOWN-OK</h1>');

  const first = await preview.staticStart(ws, port);
  assert.ok(first.ok, `first start ok: ${JSON.stringify(first)}`);
  assert.equal(new URL(first.url).port, String(port), 'preferred port honored');
  const r1 = await fetch(first.url);
  assert.equal(r1.status, 200);
  preview.staticStop();

  assert.ok(await portRebindable(port), 'port rebindable immediately after staticStop (keep-alives dropped)');

  const second = await preview.staticStart(ws, port);
  assert.ok(second.ok, `restart on the same port succeeds: ${JSON.stringify(second)}`);
  assert.equal(new URL(second.url).port, String(port), 'same port reused');
  const r2 = await fetch(second.url);
  assert.equal(r2.status, 200, 'restart serves again');
  preview.staticStop();
});
