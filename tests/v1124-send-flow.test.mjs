import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

// =====================================================================
// v11.24 — CHAT SEND-FLOW E2E (DIAGNOSIS + TEST ONLY — no app source).
//
// The founder (Arabic): "أول ما أرسل رسالة بيكون بالتشات بنل نفسه هيك رن،
// وبعدين شريط فيه رن وفايف فيز... شيلها" — right after send, a RING in the
// chat panel, then a strip with RING + WAVE. Remove them.
//
// This harness is REAL at every layer:
//   1. the REAL agent engine (electron/agent/engine.ts, esbuild-bundled) drives
//      a genuine turn against a LOCAL scripted OpenAI-compatible provider;
//   2. every engine event is fed LIVE into the REAL renderer store
//      (src/store.ts, bundled) via ingestAgentEvent — running=true is set at
//      the simulated send press, exactly as sendMessage does;
//   3. at each milestone (immediate / run_start / liveness / first text_delta /
//      turn_end, plus error / aborted) the REAL ChatPanel is SSR-rendered with
//      react-dom/server and the markup is captured.
//
// HARD CONTRACT
//   A. At NO captured stage does the HTML contain a decorative ring/wave:
//      cp-live-dots, cp-live-sweep, chat-live-ring (count === 0 everywhere).
//   B. The BIG ring is gone from the chat panel entirely (cp-live-glyph === 0).
//      The ONE compact circle is the per-message orbit (.sc-think-orbit) in the
//      assistant row, sitting WITH real streamed text — at most one, ever.
//   C. The status label is STABLE: no rotateGerund, no keyed crossfade, no
//      shimmer/shake CSS (source-level, comment-stripped).
//   D. running clears on turn_end / error / aborted; no stale streaming row or
//      duplicate task-report card survives afterward.
// =====================================================================

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1124-sendflow-'));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const countOcc = (hay, needle) => hay.split(needle).length - 1;
const stripComments = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ');

const FORBIDDEN = ['cp-live-dots', 'cp-live-sweep', 'chat-live-ring'];

// ---------------------------------------------------------------------
// 0 · SOURCE-LEVEL GUARDS (comment-stripped — no banned token in a comment)
// ---------------------------------------------------------------------
const chatCode = stripComments(read('src/components/ChatPanel.tsx'));
const streamCode = stripComments(read('src/lib/streamDisplay.ts'));
const messageCode = stripComments(read('src/components/MessageView.tsx'));
const cssFiles = [
  'src/components/console.css',
  'src/components/chat-final.css',
  'src/components/chat.css',
];
const cssCode = cssFiles
  .filter((f) => { try { read(f); return true; } catch { return false; } })
  .map((f) => ({ file: f, body: stripComments(read(f)) }));

test('SRC 1 · no decorative ring/wave hook is mounted in ChatPanel TSX', () => {
  for (const hook of FORBIDDEN) {
    assert.equal(countOcc(chatCode, hook), 0, `${hook} absent from live TSX code`);
  }
});

test('SRC 2 · the label cannot rotate / crossfade (no trembling text)', () => {
  assert.equal(countOcc(chatCode, 'rotateGerund'), 0, 'timer rotation retired');
  assert.equal(countOcc(streamCode, 'rotateGerund'), 0, 'rotation helper retired');
  assert.equal(countOcc(streamCode, 'GERUND_ROTATE_MS'), 0, 'rotation cadence retired');
  assert.ok(chatCode.includes('pickGerund'), 'stable picker in use');
  const labelTag = chatCode.match(/<span[^>]*className="sc-status-label"[^>]*>/)?.[0] ?? '';
  assert.ok(labelTag, 'the status-label span is present');
  assert.ok(!/\bkey\s*=/.test(labelTag), 'no keyed remount (crossfade/tremble) on the label');
});

test('SRC 2b · the big ring panel is gone; at most ONE compact circle owner', () => {
  assert.equal(countOcc(chatCode, 'LiveThinkingPanel'), 0, 'big ring panel component removed');
  assert.equal(countOcc(chatCode, 'cp-live-glyph'), 0, 'big 80px ring glyph removed');
  assert.equal(countOcc(chatCode, 'cp-live-panel'), 0, 'big ring panel mount removed');
  assert.equal(countOcc(chatCode, 'sc-think-orbit'), 0, 'the circle is not duplicated in the run strip');
  // The single compact circle may live in the assistant gutter (v11.21) OR,
  // after the v11.24 cleanup, in the reasoning head — but only ONE owner.
  const circleDefs = countOcc(messageCode, 'function CompactThinkingOrbit')
    + countOcc(messageCode, 'function PrecisionThinkingOrbit');
  const circleMounts = countOcc(messageCode, '<CompactThinkingOrbit')
    + countOcc(messageCode, '<PrecisionThinkingOrbit');
  assert.ok(circleDefs <= 1, `at most one compact-circle component (got ${circleDefs})`);
  assert.ok(circleMounts <= 1, `at most one compact-circle mount (got ${circleMounts})`);
});

test('SRC 3 · no live CSS rule targets the retired decor; label CSS is inert', () => {
  for (const { file, body } of cssCode) {
    for (const hook of FORBIDDEN) {
      assert.ok(!body.includes(`.${hook}`), `no live .${hook} rule in ${file}`);
    }
  }
  const consoleCss = cssCode.find((c) => c.file.endsWith('console.css'))?.body ?? '';
  const labelRule = consoleCss.match(/\.run-strip-v13\s+\.sc-status-label\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.ok(labelRule, 'the run-strip label rule exists');
  assert.match(labelRule, /animation\s*:\s*none/i, 'label animation is explicitly disabled');
});

// ---------------------------------------------------------------------
// Bundles + browser-ish globals — installed before ANY bundle is required.
// ---------------------------------------------------------------------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${out}`, '--external:electron', '--external:@xterm/xterm',
    '--external:@xterm/addon-fit', '--external:monaco-editor',
    '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

const bridge = new Proxy({}, {
  get(_t, key) {
    if (key === 'then' || typeof key === 'symbol') return undefined;
    return (...args) => {
      switch (key) {
        case 'gitStatus':
          return Promise.resolve({ isRepo: true, branch: 'main', changed: [] });
        case 'previewStatus':
          return Promise.resolve({
            dev: { running: false, state: 'idle', lines: [], agentSources: [] },
            static: { running: false }, ports: [],
          });
        case 'skillsList': return Promise.resolve([]);
        case 'playbookGet': return Promise.resolve(null);
        case 'playbookHistory': return Promise.resolve([]);
        case 'saveSession': return Promise.resolve();
        default: return Promise.resolve(undefined);
      }
    };
  },
});
globalThis.window = {
  surnia: bridge,
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false }),
};
globalThis.document = {
  documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
  body: { appendChild() {} },
  createElement: () => ({ style: {}, select() {}, remove() {} }),
  addEventListener() {},
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

// electron stub (isolated userData) — engine + store both require 'electron'.
const userDataDir = join(tmp, 'userdata');
mkdirSync(userDataDir, { recursive: true });
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `module.exports = {
  app: { getPath: () => ${JSON.stringify(userDataDir)}, whenReady: async () => true, on() {}, quit() {} },
  ipcMain: { handle() {}, on() {} },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: { isSupported: () => false },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: {}, screen: {}, powerMonitor: { on() {} },
};`);

const engPath = join(tmp, 'engine.cjs');
const provPath = join(tmp, 'providers.cjs');
// The UI bundle externalizes react/react-dom — it MUST sit where Node can
// resolve them from the project's node_modules (the temp dir cannot).
const uiPath = join(ROOT, 'tests', '.v1124-sendflow-ui.bundle.cjs');
let engine;
let mod;
let React;
let renderToStaticMarkup;

before(() => {
  bundle('electron/agent/engine.ts', engPath);
  bundle('electron/agent/providers.ts', provPath);
  engine = require(engPath);
  require(provPath);

  require('esbuild').buildSync({
    stdin: {
      contents:
        "export { ChatPanel } from './src/components/ChatPanel';" +
        "export { useStore } from './src/store';",
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: uiPath,
    loader: { '.css': 'empty' },
    external: ['electron', 'react', 'react-dom', 'lucide-react'],
  });
  mod = require(uiPath);

  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  for (const p of [engPath, provPath, uiPath]) { try { unlinkSync(p); } catch { /* gone */ } }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* gone */ }
  for (const k of ['SURNIA_HOME', 'SURNIA_TURN_RETRY_DELAYS_MS', 'SURNIA_DELTA_FLUSH_MS']) delete process.env[k];
});

const h = (...args) => React.createElement(...args);
const renderSSR = () => renderToStaticMarkup(h(mod.ChatPanel));

// ---------------------------------------------------------------------
// Local scripted provider — MODE decides success / error / abort.
// ---------------------------------------------------------------------
const sse = (res, delta, finish = null) => res.write(
  `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
);
function startMock(mode, primaryModel) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      requests.push({ model: body.model, at: Date.now() });
      // Secondary/verifier/critic models: tiny LOCAL completion, never spins.
      if (body.model !== primaryModel) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.flushHeaders();
        sse(res, { content: 'ok' }, 'stop');
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      if (mode === 'error') {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'send-flow injected failure', type: 'server_error' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.flushHeaders();
      // A small, honest stream: two answer deltas then stop. No tools, no fake
      // progress — the point is the decor around the send moment, not the text.
      sse(res, { content: 'Hello ' });
      await new Promise((r) => setTimeout(r, 40));
      sse(res, { content: 'from send-flow.' });
      sse(res, {}, 'stop');
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const listening = new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  return {
    requests,
    port: listening,
    async stop() {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

function writeSettings(mockBase) {
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({
    schemaVersion: 4,
    providers: { custom: { apiKey: 'test-key', baseUrl: mockBase } },
    agent: {
      maxRetries: 0, autoCompact: false, autoVerify: false,
      selfCritique: false, runAndShow: false,
    },
    doneNotifications: false,
  }));
}

// ---------------------------------------------------------------------
// The stage machine.
// ---------------------------------------------------------------------
function stageOf(e) {
  if (e.type === 'sys_notice' && String(e.kind ?? '').toLowerCase() === 'run_start') return 'run_start';
  if (e.type === 'heartbeat') return 'liveness';
  if (e.type === 'text_delta') return 'first_text_delta';
  if (e.type === 'message_end') return 'text_visible';
  if (e.type === 'error') return 'error';
  if (e.type === 'aborted') return 'aborted';
  if (e.type === 'turn_end') return 'turn_end';
  return null;
}

/** Simulate the exact send press: running flips true, a fresh session/turn. */
function seedRunning() {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    wsPath: userDataDir,
    session: {
      id: 's1', title: 'send-flow', workspace: userDataDir,
      messages: [{ id: 'u1', role: 'user', kind: 'text', content: 'Say hello', timestamp: Date.now() }],
      createdAt: Date.now(), updatedAt: Date.now(),
      messageCount: 1, totalTokens: 0, totalCostUsd: 0,
    },
    settings: {
      ...prev.settings, language: 'en', numerals: 'western',
      model: { provider: 'custom', model: 'send-flow-live' },
    },
    running: true,
    sessionUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    ctxWindow: 200000,
    pendingApproval: null,
    capabilityPanel: null, continueHint: null, lastTaskReport: null,
    subagentProgress: {}, subagentSteps: {}, subagentDetailId: null,
    proof: { status: 'unproven', gates: [], updatedAt: 0 },
  });
}

async function drive(mode) {
  const primaryModel = `send-flow-${mode}`;
  const mock = startMock(mode, primaryModel);
  const port = await mock.port;
  const mockBase = `http://127.0.0.1:${port}/v1`;
  writeSettings(mockBase);
  const ws = mkdtempSync(join(tmpdir(), 'sadeem-v1124-ws-'));
  const events = [];
  const shots = {};
  const ingestErrors = [];
  let abortFlag = false;

  seedRunning();
  // STAGE 0 — the instant send is pressed, before the engine emits anything.
  shots.immediate = { html: renderSSR(), running: mod.useStore.getState().running };

  const io = {
    send(e) {
      events.push({
        type: e.type, kind: e.kind, text: e.text ?? e.message ?? '',
        outcome: e.outcome, at: Date.now(),
      });
      try { mod.useStore.getState().ingestAgentEvent(e); }
      catch (err) { ingestErrors.push(`${e.type}: ${err?.message ?? err}`); }
      const stage = stageOf(e);
      if (stage && !shots[stage]) {
        shots[stage] = { html: renderSSR(), running: mod.useStore.getState().running };
      }
      // Abort injection: flip only AFTER the first real delta reached the store.
      if (mode === 'abort' && e.type === 'text_delta') abortFlag = true;
    },
    async getDecision(requestId) { return { requestId, action: 'allow' }; },
    isAborted: () => abortFlag,
    onFetchSignal() {},
  };

  process.env.SURNIA_HOME = userDataDir;
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = '8,8,8,8,8,8';
  process.env.SURNIA_DELTA_FLUSH_MS = '20';

  let thrown = null;
  try {
    await engine.runAgent({
      task: 'chat',
      sessionId: `v1124-${mode}-${Math.random().toString(36).slice(2)}`,
      messages: [{ id: 'u1', role: 'user', kind: 'text', content: 'Say hello', timestamp: Date.now() }],
      model: { provider: 'custom', model: primaryModel, maxTokens: 512 },
      mode: 'fullAccess', workspace: ws, apiKey: 'test-key', baseUrl: mockBase,
    }, io);
  } catch (err) {
    thrown = err;
  }
  // Let any rAF-buffered trailing delta flush before the final inspection.
  await new Promise((r) => setTimeout(r, 80));
  const finalHtml = renderSSR();
  const finalState = mod.useStore.getState();

  return { mock, ws, events, shots, ingestErrors, abortFlag, thrown, finalHtml, finalState };
}

// ---------------------------------------------------------------------
// Shared contract checks + diagnostics.
// ---------------------------------------------------------------------
const DIAG = [];
function assertNoDecor(html, label) {
  for (const f of FORBIDDEN) {
    const n = countOcc(html, f);
    DIAG.push(`${label}: ${f}=${n}`);
    assert.equal(n, 0, `${label}: zero ${f} in SSR markup`);
  }
}

function assertStageGraphic(shot, label) {
  const { html } = shot;
  const bigRing = countOcc(html, 'cp-live-glyph');
  const orbits = countOcc(html, 'sc-plate sc-think-orbit');
  const reasonOrbit = countOcc(html, 'sc-reason-orbit-svg');
  const wave = countOcc(html, 'sc-live-wave');
  const reasonDots = countOcc(html, 'sc-reason-dots');
  const labelText = (html.match(/class="sc-status-label"[^>]*>([^<]*)/)?.[1] ?? '').trim();
  const totalCircles = bigRing + orbits + reasonOrbit;
  DIAG.push(`${label}: bigRing=${bigRing}, gutterOrbit=${orbits}, reasonOrbit=${reasonOrbit}, TOTAL_CIRCLES=${totalCircles}, liveWave=${wave}, reasonDots=${reasonDots}, label="${labelText}"`);
  assert.equal(bigRing, 0, `${label}: the big 80px ring is gone`);
  assert.ok(totalCircles <= 1, `${label}: at most ONE compact circle (got ${totalCircles})`);
  // No decorative strip wave/dots before the assistant text exists. (Inside a
  // live THINKING block they are a separate, row-local instrument — reported
  // in DIAG above, never a hard failure.)
  if (shot.running) {
    assert.ok(html.includes('class="sc-status-label"'), `${label}: real status label present`);
    assert.ok(html.includes('sc-status-clock'), `${label}: real elapsed clock present`);
    assert.ok(labelText.length > 0, `${label}: status label carries real text`);
    assert.ok(!/key=/.test(html.match(/<span[^>]*class="sc-status-label"[^>]*>/)?.[0] ?? ''),
      `${label}: no keyed remount / trembling label`);
  }
}

function assertTerminal(state, html, label) {
  assert.equal(state.running, false, `${label}: running cleared`);
  assert.equal(countOcc(html, 'cp-live-glyph'), 0, `${label}: big ring never returns`);
  assert.equal(countOcc(html, 'cp-live-panel'), 0, `${label}: no ring panel after end`);
  assert.ok(!html.includes('phase-strip run-strip-v13'), `${label}: no run strip after end`);
  assert.ok(
    countOcc(html, 'sc-plate sc-think-orbit') + countOcc(html, 'sc-reason-orbit-svg') <= 1,
    `${label}: at most one settled circle`,
  );
  const msgs = state.session?.messages ?? [];
  // v11.28 — NO transcript card: the one owner surface is a localized toast.
  const reports = msgs.filter((m) => m.model === 'task-report');
  const streaming = msgs.filter((m) => m.streaming);
  const circles = countOcc(html, 'sc-plate sc-think-orbit') + countOcc(html, 'sc-reason-orbit-svg');
  DIAG.push(`${label}: report cards=${reports.length}, toast=${!!state.lastReportToast}, streaming rows=${streaming.length}, running=${state.running}, totalCircles=${circles}`);
  assert.equal(reports.length, 0, `${label}: no transcript report card (the founder removed it)`);
  assert.ok(state.lastReportToast, `${label}: exactly one written report toast`);
  assert.equal(streaming.length, 0, `${label}: no stale streaming row`);
}

// ---------------------------------------------------------------------
// E2E TESTS — real engine → real store → real SSR.
// ---------------------------------------------------------------------
test('E2E SUCCESS · no decor at any send stage; <=1 circle; clean terminal', async () => {
  const r = await drive('success');
  try {
    assert.equal(r.thrown, null, `runAgent must not throw: ${r.thrown?.stack ?? r.thrown}`);
    assert.deepEqual(r.ingestErrors, [], 'store ingest never threw');

    const expected = ['immediate', 'run_start', 'liveness', 'first_text_delta', 'text_visible', 'turn_end'];
    for (const stage of expected) {
      assert.ok(r.shots[stage], `captured SSR stage: ${stage}`);
    }
    DIAG.push(`SUCCESS stages captured: ${expected.filter((s) => r.shots[s]).join(', ')}`);

    for (const stage of expected) {
      assertNoDecor(r.shots[stage].html, `SUCCESS/${stage}`);
      assertStageGraphic(r.shots[stage], `SUCCESS/${stage}`);
    }
    for (const stage of ['immediate', 'run_start', 'liveness', 'first_text_delta', 'text_visible']) {
      assert.equal(r.shots[stage].running, true, `SUCCESS/${stage}: running=true`);
    }
    // NO premature ring on the immediate send frame. Where the single circle
    // later mounts (assistant gutter in v11.21, reasoning head in v11.24) is an
    // A4 layout decision — the hard contract is "never more than one", already
    // asserted per stage in assertStageGraphic. The count is reported in DIAG.
    assert.ok(countOcc(r.shots.immediate.html, 'sc-plate sc-think-orbit')
      + countOcc(r.shots.immediate.html, 'sc-reason-orbit-svg') === 0,
    'SUCCESS/immediate: NO ring before the first answer row');
    assertTerminal(r.finalState, r.finalHtml, 'SUCCESS/turn_end');
    DIAG.push(`SUCCESS engine events: ${r.events.map((e) => e.type + (e.kind ? '/' + e.kind : '')).join(' > ')}`);
  } finally {
    await r.mock.stop();
    try { rmSync(r.ws, { recursive: true, force: true }); } catch { /* gone */ }
  }
});

test('E2E ERROR · decor-free, running clears on error, no stale row', async () => {
  const r = await drive('error');
  try {
    assert.deepEqual(r.ingestErrors, [], 'store ingest never threw');
    for (const stage of ['immediate', 'run_start', 'error']) {
      assert.ok(r.shots[stage], `captured SSR stage: ${stage}`);
      assertNoDecor(r.shots[stage].html, `ERROR/${stage}`);
      assertStageGraphic(r.shots[stage], `ERROR/${stage}`);
    }
    assert.ok(r.events.some((e) => e.type === 'error'), 'engine emitted the error event');
    assertTerminal(r.finalState, r.finalHtml, 'ERROR/terminal');
    DIAG.push(`ERROR engine events: ${r.events.map((e) => e.type + (e.kind ? '/' + e.kind : '')).join(' > ')}`);
  } finally {
    await r.mock.stop();
    try { rmSync(r.ws, { recursive: true, force: true }); } catch { /* gone */ }
  }
});

test('E2E ABORT · decor-free, running clears on aborted, no stale row', async () => {
  const r = await drive('abort');
  try {
    assert.deepEqual(r.ingestErrors, [], 'store ingest never threw');
    for (const stage of ['immediate', 'run_start', 'first_text_delta']) {
      assert.ok(r.shots[stage], `captured SSR stage: ${stage}`);
      assertNoDecor(r.shots[stage].html, `ABORT/${stage}`);
      assertStageGraphic(r.shots[stage], `ABORT/${stage}`);
    }
    assert.ok(r.events.some((e) => e.type === 'aborted'), 'engine emitted the aborted event');
    assertTerminal(r.finalState, r.finalHtml, 'ABORT/terminal');
    DIAG.push(`ABORT engine events: ${r.events.map((e) => e.type + (e.kind ? '/' + e.kind : '')).join(' > ')}`);
  } finally {
    await r.mock.stop();
    try { rmSync(r.ws, { recursive: true, force: true }); } catch { /* gone */ }
  }
});

test('REPORT · raw-source leftovers (incl. comments) with file:line', () => {
  const leftovers = [];
  const scan = [
    'src/components/ChatPanel.tsx',
    'src/components/console.css',
    'src/components/chat-final.css',
    'src/components/chat.css',
    'src/lib/streamDisplay.ts',
  ];
  for (const rel of scan) {
    let lines;
    try { lines = read(rel).split('\n'); } catch { continue; }
    lines.forEach((line, i) => {
      if (FORBIDDEN.some((f) => line.includes(f))) {
        leftovers.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
  DIAG.push(`RAW LEFTOVERS (decor token in source, incl. comments) = ${leftovers.length}`);
  for (const l of leftovers) DIAG.push(`  LEFTVER ${l}`);
  console.error('\n===== v1124 SEND-FLOW DIAGNOSTICS =====\n' + DIAG.join('\n') + '\n======================================\n');
  // Comments are allowed to mention the retired tokens; live code is not (SRC 1–3).
  assert.ok(true, 'diagnostic collector — see counts above');
});
