// ============================================================
// v11.38 — FLOWS PRO: the path D9 never actually exercised.
// ------------------------------------------------------------
// D9's v1136 test called engine.runAgent() and flowsMarkRun() DIRECTLY. It
// never drove the renderer's real run bridge, so it missed the actual gap:
// `kdx:agent:run` is fire-and-forget, `sendMessage()` resolves at LAUNCH, and
// the old FlowsPanel recorded the run (five green steps) before the prompt
// reached the provider. This suite drives the REAL orchestrator with a REAL
// scripted chat turn against a loopback SSE provider and local temp state:
//   create → run (real prompt turn) → record ONLY after settle → replay →
//   repetition suggestion with the EXACT typed text → honest failure paths.
// No mocks of the modules under test. Real esbuild bundles, real temp dirs.
//   node --test --test-force-exit tests/v1138-flows.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const TMP = mkdtempSync(join(tmpdir(), 'sadeem-v1138-'));
const UD = join(TMP, 'userdata');
const WS = join(TMP, 'ws');
for (const d of [UD, WS]) mkdirSync(d, { recursive: true });

// ---------- electron stub (ipcMain.handle captured so we can assert channels) ----------
globalThis.__V1138_HANDLERS = new Map();
const STUB = join(TMP, 'node_modules', 'electron');
mkdirSync(STUB, { recursive: true });
writeFileSync(join(STUB, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(STUB, 'index.js'),
  `
const H = globalThis.__V1138_HANDLERS || (globalThis.__V1138_HANDLERS = new Map());
module.exports = {
  app: {
    getPath: (k) => (k === 'userData' ? ${JSON.stringify(UD)} : ${JSON.stringify(TMP)}),
    whenReady: async () => true, on() {}, once() {}, quit() {}, isReady: () => true, setName() {}, setPath() {},
  },
  ipcMain: { handle: (c, fn) => H.set(c, fn), on() {}, removeAllListeners() {} },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  safeStorage: { isEncryptionAvailable: () => false },
  Notification: { isSupported: () => false },
  shell: {}, screen: {}, dialog: {}, powerMonitor: { on() {} },
};
module.exports.default = module.exports;
`,
);

// ---------- minimal browser stubs so the renderer bundle can load ----------
function installBrowserStubs() {
  const bridge = new Proxy({}, {
    get(_t, key) {
      if (key === 'then' || key === 'toJSON' || typeof key === 'symbol') return undefined;
      return () => Promise.resolve(undefined);
    },
  });
  const mq = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const el = () => ({
    style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    appendChild() {}, removeChild() {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {}, focus() {}, select() {}, remove() {}, click() {},
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
    querySelector: () => null, querySelectorAll: () => [], insertBefore() {}, scrollTo() {},
  });
  globalThis.self = globalThis;
  globalThis.window = {
    surnia: bridge, kodex: bridge,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    matchMedia: mq,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    location: { href: 'http://localhost/', reload() {} },
    navigator: { userAgent: 'node-v1138', clipboard: { writeText: () => Promise.resolve() } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    scrollTo() {}, alert() {}, confirm: () => true, prompt: () => null,
  };
  globalThis.document = {
    documentElement: el(), body: el(), head: el(),
    createElement: el, createElementNS: el, createTextNode: () => ({}),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, hidden: false, visibilityState: 'visible',
  };
  const def = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  def('localStorage', globalThis.window.localStorage);
  def('sessionStorage', globalThis.window.sessionStorage);
  def('matchMedia', mq);
  def('navigator', globalThis.window.navigator);
  def('location', globalThis.window.location);
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
}
installBrowserStubs();

const stubPlugin = {
  name: 'v1138-stubs',
  setup(build) {
    build.onResolve({ filter: /\?worker$/ }, () => ({ path: 'worker', namespace: 'ssm' }));
    build.onResolve({ filter: /(^|\/)lib\/monaco$/ }, () => ({ path: 'lib-monaco', namespace: 'ssm' }));
    build.onResolve({ filter: /^@monaco-editor\/react$/ }, () => ({ path: 'monaco-react', namespace: 'ssm' }));
    build.onResolve({ filter: /^lottie-web$/ }, () => ({ path: 'lottie', namespace: 'ssm' }));
    build.onResolve({ filter: /^qrcode$/ }, () => ({ path: 'qrcode', namespace: 'ssm' }));
    build.onLoad({ filter: /.*/, namespace: 'ssm' }, ({ path: p }) => {
      let contents = 'export default null;';
      if (p === 'worker') contents = 'export default class SSMWorker {}';
      else if (p === 'lib-monaco') contents = "export const monaco = { editor: { defineTheme(){}, createModel(){}, createDiffEditor(){} } }; export const monacoThemeFor = () => 'dark'; export const languageForPath = () => 'plaintext';";
      return { contents, loader: 'js' };
    });
  },
};
const EXTERNALS = ['electron', 'react', 'react-dom', 'zustand', 'lucide-react', '@xterm/xterm', '@xterm/addon-fit'];
const LOADERS = { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.jpg': 'empty', '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' };
async function bundleEntry(entry, outfile) {
  await esbuild.build({
    entryPoints: [join(ROOT, entry)], bundle: true, platform: 'node', format: 'cjs', outfile,
    external: EXTERNALS, loader: LOADERS, plugins: [stubPlugin], logLevel: 'silent',
  });
  return require(outfile);
}
async function bundleExport(contents, outfile) {
  await esbuild.build({
    stdin: { contents, resolveDir: ROOT, loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', outfile,
    external: EXTERNALS, loader: LOADERS, plugins: [stubPlugin], logLevel: 'silent',
  });
  return require(outfile);
}

const flows = await bundleEntry('electron/services/flowsService.ts', join(TMP, 'flows.cjs'));
const engine = await bundleEntry('electron/agent/engine.ts', join(TMP, 'engine.cjs'));
const flowUi = await bundleExport(
  "export { flowRunSteps, flowRunGate, executeFlowRun } from './src/components/panels/FlowsPanel';",
  join(ROOT, 'tests', '.v1138-flowui.cjs'),
);

// ---------- a tiny scripted "store" that mimics the real running edge ----------
function makeRunState(initial = false) {
  const listeners = new Set();
  const state = { running: initial };
  return {
    state,
    isRunning: () => state.running,
    set(v) {
      state.running = v;
      for (const l of listeners) l(v);
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    listenerCount: () => listeners.size,
  };
}

let providerServer;
after(() => {
  try { providerServer?.close(); } catch { /* already closed */ }
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
  try { rmSync(join(ROOT, 'tests', '.v1138-flowui.cjs'), { force: true }); } catch { /* best effort */ }
});

// ============================================================
// 1. THE REAL PATH: create → scripted real turn → record after settle
// ============================================================
test('FLOWS PRO: exact prompt runs a real chat turn; runCount bumps once AFTER message_end, replay bumps again', async () => {
  // loopback OpenAI-compatible provider (the same transport store.sendMessage uses)
  const routes = [];
  providerServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      routes.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.flushHeaders();
      const chunk = (delta, finish) =>
        `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      res.write(chunk({ content: 'FLOW COMPLETED' }, null));
      res.write(`data: ${JSON.stringify({ usage: { prompt_tokens: 128, completion_tokens: 24 }, choices: [] })}\n\n`);
      res.write(chunk({}, 'stop'));
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  const port = await new Promise((r) => providerServer.listen(0, '127.0.0.1', () => r(providerServer.address().port)));
  const base = `http://127.0.0.1:${port}/v1`;
  writeFileSync(join(UD, 'settings.json'), JSON.stringify({
    schemaVersion: 4,
    model: { provider: 'custom', model: 'flow-model' },
    providers: { custom: { apiKey: 'test-key', baseUrl: base } },
    agent: { maxRetries: 0, autoCompact: false, autoVerify: false, autoMemory: false, criticGate: false },
    dnaEnabled: false, doneNotifications: false,
  }));

  // CREATE through the real service.
  const saved = await flows.flowsSave({ name: 'v1138 real flow', prompt: 'Say FLOW COMPLETED and stop.' });
  const flow = saved.find((f) => f.name === 'v1138 real flow');
  assert.ok(flow?.id, 'flow created with a persisted id');
  assert.equal(flows.flowsList().find((f) => f.id === flow.id)?.runCount, 0, 'fresh flow has runCount 0');

  // Drive the REAL orchestrator. `send` mimics store.sendMessage's observable
  // contract: running:true at launch, running:false at turn_end.
  const drive = async (f) => {
    const rs = makeRunState(false);
    const events = [];
    let endSeenCountAtMessageEnd = -1;
    const io = {
      send: (e) => {
        events.push(e);
        if (e.type === 'message_end') endSeenCountAtMessageEnd = flows.flowsList().find((x) => x.id === f.id).runCount;
      },
      getDecision: async (requestId) => ({ requestId, action: 'allow' }),
      isAborted: () => false,
      onFetchSignal() {},
    };
    return {
      outcome: await flowUi.executeFlowRun(f, {
        send: async (text) => {
          rs.set(true); // store sets running:true synchronously at press
          try {
            await engine.runAgent({
              task: 'chat', sessionId: `v1138-${Date.now()}`,
              messages: [{ id: 'u-flow', role: 'user', kind: 'text', content: text, timestamp: Date.now() }],
              model: { provider: 'custom', model: 'flow-model' }, mode: 'fullAccess', workspace: WS,
              apiKey: 'test-key', baseUrl: base,
            }, io);
          } finally {
            rs.set(false); // terminal report clears running
          }
        },
        isRunning: rs.isRunning,
        subscribe: rs.subscribe,
        record: (id, ws) => flows.flowsMarkRun(id, ws),
      }),
      events,
      endSeenCountAtMessageEnd,
      rs,
    };
  };

  const first = await drive(flow);
  assert.ok(first.events.find((e) => e.type === 'message_end'), 'the flow turn reached message_end');
  assert.equal(first.endSeenCountAtMessageEnd, 0, 'runCount is still 0 while the turn is settling (NO premature/fake bump)');
  assert.equal(String(routes[0]?.messages?.at(-1)?.content ?? ''), flow.prompt, 'the EXACT saved prompt reached the provider');
  assert.equal(first.outcome.reason, 'ok', 'orchestrator reports a settled+recorded run');
  assert.equal(first.outcome.ok, true);
  assert.equal(first.outcome.settled, true, 'a real running false→true→false edge was observed');
  assert.equal(first.outcome.recorded, true);
  assert.equal(first.rs.listenerCount(), 0, 'the store subscription was disposed');
  const afterFirst = flows.flowsList().find((f) => f.id === flow.id);
  assert.equal(afterFirst.runCount, 1, 'runCount advanced exactly ONCE');
  assert.ok(afterFirst.lastRun > 0, 'lastRun persisted to disk');
  assert.equal(readFileSync(join(UD, 'flows.json'), 'utf8').includes('v1138 real flow'), true, 'persisted to flows.json on disk');

  // REPLAY = the same verified path re-sends the exact stored prompt.
  const second = await drive(flow);
  assert.equal(String(routes[1]?.messages?.at(-1)?.content ?? ''), flow.prompt, 'replay sent the EXACT same stored prompt');
  assert.equal(second.outcome.ok, true, 'replay settled and recorded');
  const afterSecond = flows.flowsList().find((f) => f.id === flow.id);
  assert.equal(afterSecond.runCount, 2, 'replay bumps runCount once more (2 total)');

  // Step states are honest only when the turn really settled + recorded.
  assert.deepEqual(
    flowUi.flowRunSteps('done', { sent: true, settled: true, recorded: true }, false).map((s) => s.state),
    ['done', 'done', 'done', 'done', 'done'],
  );
});

// ============================================================
// 2. HONEST FAILURES: no silent/fake success
// ============================================================
test('FLOWS PRO: no turn / timeout / record refusal are honest (never a fake counter bump)', async () => {
  const f = { id: 'honest-flow', name: 'honest', prompt: 'do real work', scope: 'global', createdAt: 1, runCount: 0 };

  // (a) sendMessage bailed (no model/session): running never flips → no-turn.
  const noTurn = await flowUi.executeFlowRun(f, {
    send: async () => { /* no turn — e.g. missing model or session */ },
    isRunning: () => false,
    subscribe: () => () => {},
    record: async () => { throw new Error('must not be called'); },
  });
  assert.equal(noTurn.reason, 'no-turn');
  assert.equal(noTurn.ok, false);
  assert.equal(noTurn.recorded, false, 'a non-run must never bump the counter');

  // (b) turn starts but never settles inside the window → timeout, no record.
  const rs = makeRunState(false);
  const timeout = await flowUi.executeFlowRun(f, {
    send: async () => { rs.set(true); }, // starts, never settles
    isRunning: rs.isRunning,
    subscribe: rs.subscribe,
    record: async () => { throw new Error('must not be called'); },
    timeoutMs: 20, // real bounded watchdog
  });
  assert.equal(timeout.reason, 'timeout');
  assert.equal(timeout.settled, false);
  assert.equal(timeout.ok, false);
  assert.equal(timeout.recorded, false, 'an unsettled turn is never recorded');
  assert.equal(rs.listenerCount(), 0, 'subscription disposed even on timeout');

  // (c) turn settles but the bridge refuses to record → honest record-failed.
  const rs2 = makeRunState(false);
  const refused = await flowUi.executeFlowRun(f, {
    send: async () => { rs2.set(true); rs2.set(false); },
    isRunning: rs2.isRunning,
    subscribe: rs2.subscribe,
    record: async () => false,
  });
  assert.equal(refused.settled, true, 'the turn DID settle');
  assert.equal(refused.recorded, false);
  assert.equal(refused.reason, 'record-failed');
  assert.equal(refused.ok, false, 'a refused record is never reported as a successful run');

  // (d) record throws → still honest, never a fake bump.
  const rs3 = makeRunState(false);
  const thrown = await flowUi.executeFlowRun(f, {
    send: async () => { rs3.set(true); rs3.set(false); },
    isRunning: rs3.isRunning,
    subscribe: rs3.subscribe,
    record: async () => { throw new Error('bridge down'); },
  });
  assert.equal(thrown.recorded, false);
  assert.equal(thrown.ok, false);
  assert.equal(thrown.reason, 'record-failed');

  // Step view must show the recorded step as an error for these failures.
  const failed = flowUi.flowRunSteps('error', { sent: true, noTurn: true }, false);
  assert.equal(failed[3].state, 'error', 'a no-turn run shows the record step as an error');
});

// ============================================================
// 3. SUGGESTIONS: real hit store, exact text, honest dedupe
// ============================================================
test('FLOWS PRO: repeated typed prompt suggests after 3 hits with the EXACT text and dedupes once saved', async () => {
  const raw = '  Summarize the weekly report for me  ';
  let r;
  for (let i = 0; i < 3; i++) r = await flows.flowsHit(raw);
  assert.equal(r.count, 3, 'three typed repetitions counted');
  assert.equal(r.suggest, true, 'suggestion raised at the threshold');

  const suggestions = flows.flowsSuggestions();
  const match = suggestions.find((s) => s.raw === raw.trim());
  assert.ok(match, 'suggestion carries the EXACT typed prompt (not the normalized 80-char key)');
  assert.equal(match.count, 3);
  assert.equal(match.suggested, true, 'the suggestion is honestly marked as already offered');

  const info = flows.flowsInfo();
  assert.ok(info.repeatedPrompts >= 1, 'flowsInfo exposes the real repeated-prompt count through the existing bridge');
  assert.ok(info.suggestionTexts.includes(raw.trim()), 'renderer can list suggestions without a new preload method');

  // Saving that exact prompt must stop the suggestion (real dedupe).
  await flows.flowsSave({ name: 'weekly summary', prompt: raw.trim(), scope: 'global' });
  const after = flows.flowsSuggestions();
  assert.equal(after.some((s) => s.raw === raw.trim()), false, 'a saved prompt is never suggested again');
  const saved = flows.flowsList().find((f) => f.name === 'weekly summary');
  assert.equal(saved.prompt, raw.trim(), 'the verbatim prompt was persisted');
});

// ============================================================
// 4. GATES + IPC surface: honest refusals, real channels
// ============================================================
test('FLOWS PRO: gate refuses no-session / missing workspace / slash prompts; IPC channels registered', async () => {
  const globalFlow = { id: 'g', name: 'g', prompt: 'real prompt', scope: 'global', createdAt: 1, runCount: 0 };
  assert.equal(flowUi.flowRunGate(globalFlow, false, WS, false, false).ok, false, 'no session → refuse');
  assert.equal(flowUi.flowRunGate({ ...globalFlow, scope: 'workspace' }, true, '', false).ok, false, 'workspace flow without workspace → refuse');
  assert.equal(flowUi.flowRunGate({ ...globalFlow, prompt: '/help' }, true, WS, false).ok, false, 'slash command is not a runnable prompt');
  assert.equal(flowUi.flowRunGate(globalFlow, true, '', false).ok, true, 'global flow needs no workspace');
  const busy = flowUi.flowRunGate(globalFlow, true, WS, true, false);
  assert.equal(busy.ok, true);
  assert.equal(busy.queued, true, 'a busy chat is reported as queued, not as done');

  flows.initFlows(); // boot-time self-registration (normally called from register.ts)
  const handlers = globalThis.__V1138_HANDLERS;
  for (const ch of ['kdx:flows:list', 'kdx:flows:save', 'kdx:flows:markRun', 'kdx:flows:hit', 'kdx:flows:info', 'kdx:flows:suggestions']) {
    assert.equal(handlers.has(ch), true, `${ch} is registered on ipcMain`);
  }
  const viaIpc = await handlers.get('kdx:flows:suggestions')({}, WS);
  assert.ok(Array.isArray(viaIpc), 'kdx:flows:suggestions returns a real array');

  // A bogus replay id is an honest structured verdict, never a thrown opaque error.
  const replayVerdict = await flows.flowsValidateByReplay('not-a-flow', WS);
  assert.equal(replayVerdict.ok, false);
  assert.equal(typeof replayVerdict.detail, 'string');
  assert.ok(replayVerdict.detail.length > 0, 'replay verdict carries an honest detail');
});
