// ============================================================
// v11.36 — USAGE / FLOWS / SCHEDULE ACCURACY + REALITY SUITE
// ------------------------------------------------------------
// The founder's demand: the USAGE page must be ACCURATE (same resolver as
// the orb), FLOWS must really run their steps, SCHEDULED JOBS must persist
// and fire. This suite uses ONLY local temp state + a loopback mock provider:
//   (1) usage math == costs.ts resolveModelInfo/estimateCostExact EXACTLY,
//       with provider-exact tokens (≈ only for estimates) and provenance;
//   (2) a saved flow is created, its prompt really runs through the SAME
//       engine the chat uses, and the run is recorded to completion;
//   (3) a scheduled job persists to disk, fires through a real trigger, and
//       the panel's displayed next-run matches the service's actual matcher.
// No mocks of the modules under test. Real esbuild bundles, real temp dirs.
//   node --test --test-force-exit tests/v1136-usage-flows-schedule.test.mjs
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
const TMP = mkdtempSync(join(tmpdir(), 'sadeem-v1136-'));
const UD = join(TMP, 'userdata');
const WS = join(TMP, 'ws');
const UD_SCHED = join(TMP, 'userdata-sched');
const UD_CRON = join(TMP, 'userdata-cron');
for (const d of [UD, WS, UD_SCHED, UD_CRON]) mkdirSync(d, { recursive: true });

// ---------- electron stub (same posture as v1131-flows) ----------
globalThis.__V1136_HANDLERS = new Map();
const STUB = join(TMP, 'node_modules', 'electron');
mkdirSync(STUB, { recursive: true });
writeFileSync(join(STUB, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(STUB, 'index.js'),
  `
const H = globalThis.__V1136_HANDLERS || (globalThis.__V1136_HANDLERS = new Map());
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

// ---------- browser stubs for the three renderer bundles ----------
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
    navigator: { userAgent: 'node-v1136', clipboard: { writeText: () => Promise.resolve() } },
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
  name: 'v1136-stubs',
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
      else if (p === 'monaco-react') contents = "const N = () => null; export const Editor = N; export const DiffEditor = N; export const loader = { config(){}, init: () => Promise.resolve({}) };";
      else if (p === 'lottie') contents = 'export const loadAnimation = () => ({ destroy(){}, play(){}, stop(){}, goToAndStop(){} }); export default { loadAnimation };';
      else if (p === 'qrcode') contents = "export const toDataURL = () => Promise.resolve('data:,'); export const toString = () => Promise.resolve(''); export default { toDataURL, toString };";
      return { contents, loader: 'js' };
    });
  },
};
const EXTERNALS = ['electron', 'react', 'react-dom', 'zustand', 'lucide-react', '@xterm/xterm', '@xterm/addon-fit'];
const LOADERS = { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.jpg': 'empty', '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' };

async function bundleEntry(entry, outfile, extraExternal = []) {
  await esbuild.build({
    entryPoints: [join(ROOT, entry)], bundle: true, platform: 'node', format: 'cjs', outfile,
    external: [...EXTERNALS, ...extraExternal], loader: LOADERS, plugins: [stubPlugin], logLevel: 'silent',
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

const costs = await bundleEntry('electron/agent/costs.ts', join(TMP, 'costs.cjs'));
const ctx = await bundleEntry('src/lib/ctx.ts', join(TMP, 'ctx.cjs'));
const flows = await bundleEntry('electron/services/flowsService.ts', join(TMP, 'flows.cjs'));
const schedule = await bundleEntry('electron/services/scheduleService.ts', join(TMP, 'schedule.cjs'));
const engine = await bundleEntry('electron/agent/engine.ts', join(TMP, 'engine.cjs'));
// Renderer bundles live under ROOT/tests so React/zustand/lucide resolve from
// the project's node_modules (the temp dir only holds the electron stub).
const UI_BUNDLES = [
  join(ROOT, 'tests', '.v1136-usage.cjs'),
  join(ROOT, 'tests', '.v1136-flowui.cjs'),
  join(ROOT, 'tests', '.v1136-schedul.cjs'),
];
const usage = await bundleExport(
  "export { priceCostUsd, priceViewFromModelInfo, billedSegments, buildModelBreakdown, perMessageRows, messageUsage, usageMark, priceSourceLabel } from './src/components/panels/UsagePanel';",
  UI_BUNDLES[0],
);
const flowUi = await bundleExport(
  "export { flowRunSteps, flowRunGate } from './src/components/panels/FlowsPanel';",
  UI_BUNDLES[1],
);
const schedUi = await bundleExport(
  "export { cronNextRun, cronIsValid } from './src/components/panels/SchedulePanel';",
  UI_BUNDLES[2],
);

const round6 = (n) => Math.round(n * 1e6) / 1e6;
/** The exact runtime shape of api.modelInfo(id) — priceFor rides on `.price`. */
const asModelInfo = (price) => ({ contextWindow: 200_000, ctxEstimated: false, price });
const scheduleInstances = [];
let providerServer;

// ============================================================
// 1. USAGE — exact resolver math, tokens, provenance
// ============================================================
test('USAGE: per-model cost math equals costs.ts resolveModelInfo/estimateCostExact to the micro-dollar', () => {
  const cases = [
    'claude-sonnet-4-6',            // curated, cache read 10% / write 125%
    'gpt-5.1-codex',                // prefix specificity
    'deepseek/deepseek-v4.1-flash-1017', // vendor-qualified id
    'glm-4.7-flash',                // real free tier
    'zzz-totally-unknown-xyz',      // UNKNOWN — must never invent a price
  ];
  const segs = { fresh: 500_000, cacheRead: 300_000, cacheWrite: 50_000, output: 100_000 };
  for (const id of cases) {
    const resolved = costs.resolveModelInfo(id);
    const view = usage.priceViewFromModelInfo(asModelInfo(costs.priceFor(id))); // exactly what modelInfo() returns
    assert.ok(view, `${id}: price view resolved`);
    assert.equal(view.unknown, resolved.price.unknown, `${id}: unknown flag matches resolver`);
    assert.equal(view.source, resolved.price.source, `${id}: source matches resolver`);
    assert.equal(view.matchedId, resolved.price.matchedId, `${id}: matched catalog row matches resolver`);
    const exact = costs.estimateCostExact(id, segs.fresh, segs.output, segs.cacheRead, segs.cacheWrite);
    const shown = usage.priceCostUsd(view, segs);
    assert.ok(
      Math.abs(shown - exact.costUsd) <= 1e-6,
      `${id}: panel ${shown} must equal resolver ${exact.costUsd}`,
    );
    assert.equal(round6(shown), round6(exact.costUsd), `${id}: micro-dollar exact`);
    if (resolved.price.unknown) {
      assert.equal(shown, 0, `${id}: unknown price is NOT printed as a fabricated $3/$15`);
    }
  }
  // cache segments are disjoint: the total billed input is NOT input + cache
  const seg = usage.billedSegments({ costUsd: 0, inputTokens: 12_482, outputTokens: 700, cacheReadTokens: 3_000, cacheCreationTokens: 0 });
  assert.equal(seg.fresh, 9_482, 'fresh input excludes the cache-read segment');
  assert.equal(seg.cacheRead, 3_000);
  assert.equal(seg.total, 13_182, 'fill is the single honest total (no double-count)');
});

test('USAGE: exact tokens vs ≈ marker via ctx.ts, per-model ledger + provenance', () => {
  // fromProviderUsageReport is the ONLY exact source; provider fields map 1:1.
  const exact = ctx.fromProviderUsageReport({ prompt_tokens: 12_482, completion_tokens: 700, cache_read_input_tokens: 3_000 });
  assert.equal(exact.estimated, false, 'provider-reported usage is never ≈');
  assert.equal(ctx.ctxFillTokens(exact), 13_182);
  assert.equal(ctx.tokenCountSource(exact), 'provider');
  assert.equal(usage.usageMark(ctx.tokenCountSource(exact)), '');
  const none = ctx.fromProviderUsageReport(null);
  assert.equal(ctx.tokenCountSource(none), 'none');
  assert.equal(usage.usageMark('none'), '—', 'no data is shown as a dash, never a fake 0');

  const price = usage.priceViewFromModelInfo(asModelInfo(costs.priceFor('claude-sonnet-4-6')));
  const messages = [
    { id: 'u1', role: 'user', kind: 'text', content: 'hi', timestamp: 1 },
    {
      id: 'a1', role: 'assistant', kind: 'text', content: 'done', timestamp: 2,
      model: 'claude-sonnet-4-6',
      usage: {
        inputTokens: 12_482, outputTokens: 700, costUsd: 0.05,
        cacheReadTokens: 3_000, cacheCreationTokens: 0, estimated: false,
        runInput: 12_482, runOutput: 700, runCost: 0.05,
        attempts: [
          { provider: 'anthropic', model: 'claude-sonnet-4-6', inputTokens: 10_000, outputTokens: 500, costUsd: 0.03 },
          { provider: 'openai', model: 'gpt-5.1-codex', inputTokens: 2_482, outputTokens: 200, costUsd: 0.02 },
        ],
      },
    },
  ];
  const rows = usage.buildModelBreakdown(messages, {
    'claude-sonnet-4-6': price,
    'gpt-5.1-codex': usage.priceViewFromModelInfo(asModelInfo(costs.priceFor('gpt-5.1-codex'))),
  });
  assert.equal(rows.length, 2, 'one row per real attempt provider/model');
  assert.equal(rows[0].tokens, 10_500, 'per-model tokens come from the attempt ledger');
  assert.equal(rows[0].priced, true);
  assert.equal(rows[0].price.source, 'curated', 'provenance is wired into the row');
  const msgRows = usage.perMessageRows(messages, { 'claude-sonnet-4-6': price });
  assert.equal(msgRows[0].source, 'provider');
  assert.equal(msgRows[0].estimated, false);
  assert.ok(msgRows[0].catalogCostUsd > 0, 'catalog cross-check is computed, not invented');
  // estimated turn → ≈ marker, no claim of provider exactness
  const estRow = usage.perMessageRows([{
    id: 'e1', role: 'assistant', kind: 'text', content: 'x', timestamp: 3, model: 'zzz-unknown-xyz',
    usage: { inputTokens: 400, outputTokens: 100, costUsd: 0.001, estimated: true },
  }], {})[0];
  assert.equal(estRow.source, 'estimated');
  assert.equal(usage.usageMark(estRow.source), '≈ ');
});

// ============================================================
// 2. FLOWS — create → run through the real engine → record
// ============================================================
test('FLOWS: a saved flow runs its prompt to completion through the real engine and is recorded', async () => {
  // loopback OpenAI-compatible provider — the same path store.sendMessage uses
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

  // CREATE (real service)
  const saved = await flows.flowsSave({ name: 'v1136 run flow', prompt: 'Say FLOW COMPLETED and stop.' });
  const flow = saved.find((f) => f.name === 'v1136 run flow');
  assert.ok(flow && flow.id, 'flow created and listed');
  assert.equal(flows.flowsList().some((f) => f.id === flow.id), true, 'flow persists in the list');

  // RUN the saved prompt through the REAL engine (store.sendMessage's path)
  const events = [];
  const io = {
    send: (e) => events.push(e),
    getDecision: async (requestId) => ({ requestId, action: 'allow' }),
    isAborted: () => false,
    onFetchSignal() {},
  };
  await engine.runAgent({
    task: 'chat', sessionId: `v1136-flow-${Date.now()}`,
    messages: [{ id: 'u-flow', role: 'user', kind: 'text', content: flow.prompt, timestamp: Date.now() }],
    model: { provider: 'custom', model: 'flow-model' }, mode: 'fullAccess', workspace: WS,
    apiKey: 'test-key', baseUrl: base,
  }, io);
  assert.equal(routes.length >= 1, true, 'the saved prompt actually reached the provider');
  assert.equal(String(routes[0].messages?.at(-1)?.content ?? ''), flow.prompt, 'the EXACT saved prompt was sent');
  const end = events.find((e) => e.type === 'message_end');
  assert.ok(end, 'the flow turn reached message_end (ran to completion)');
  assert.equal(end.usage.inputTokens, 128, 'real provider tokens, not an estimate');

  // RECORD (only after success) — this is what the UI does after the turn settles
  const gate = flowUi.flowRunGate(flow, true, WS, false, false);
  assert.equal(gate.ok, true, 'a session + workspace allows the run');
  assert.equal(await flows.flowsMarkRun(flow.id, gate.flowWs), true, 'run was recorded');
  const after = flows.flowsList().find((f) => f.id === flow.id);
  assert.equal(after.runCount, 1, 'runCount advanced exactly once');
  assert.ok(after.lastRun > 0, 'lastRun persisted');

  // STEPS reach all-done only when sent + recorded
  const done = flowUi.flowRunSteps('done', { sent: true, recorded: true }, false);
  assert.deepEqual(done.map((s) => s.state), ['done', 'done', 'done', 'done', 'done']);
  assert.equal(done.every((s) => s.label.length > 0), true, 'every step carries an honest label');
  const queued = flowUi.flowRunSteps('queued', { sent: false, queued: true }, false);
  assert.equal(queued[2].state, 'pending', 'a queued chat turn is NOT reported as running');
  assert.equal(queued[4].state, 'pending', 'and definitely not reported as finished');
  assert.equal(flowUi.flowRunGate({ ...flow, scope: 'workspace' }, true, '', false).ok, false, 'workspace flow without a workspace is refused');
  assert.equal(flowUi.flowRunGate({ ...flow, scope: 'global' }, true, '', false).ok, true, 'global flow needs no workspace');
  assert.equal(flowUi.flowRunGate(flow, false, WS, false).ok, false, 'no session → honest refusal');
});

test('FLOWS: legacy (pre-strict) ids stay stable across reads so runs can be recorded', async () => {
  writeFileSync(join(UD, 'flows.json'), JSON.stringify({
    flows: [{ id: '../legacy-flow', name: 'Legacy', prompt: 'legacy prompt', scope: 'global', createdAt: 1, runCount: 0 }],
    hits: {},
  }));
  const a = flows.flowsList();
  const b = flows.flowsList();
  assert.equal(a.length, 1);
  assert.equal(a[0].id, b[0].id, 'the sanitized legacy id is STABLE (was a new uuid on every read)');
  assert.match(a[0].id, /^lg-[a-f0-9]{16}$/);
  assert.equal(await flows.flowsMarkRun(a[0].id), true, 'the migrated id can be marked run');
  assert.equal(flows.flowsList()[0].runCount, 1);
});

// ============================================================
// 3. SCHEDULE — persist + fire + honest next-run
// ============================================================
function withClock(ts, fn) {
  const real = Date.now;
  Date.now = () => ts;
  try { return fn(); } finally { Date.now = real; }
}

test('SCHEDULE: a job persists to userData and fires through a real trigger with an honest result', async () => {
  const s = schedule; // one process-wide instance
  scheduleInstances.push(s);
  s.initScheduleService({ userDataDir: UD_SCHED, broadcast: () => {} });
  try {
    const status = s.schedulerStatus();
    assert.equal(status.running, true, 'the 30s ticker is actually installed');
    assert.equal(status.storePath, join(UD_SCHED, 'schedules.json'), 'store path is the injected userData dir');

    const job = s.addJob({ name: 'v1136 fire', prompt: 'ping', workspace: WS, cron: '* * * * *', enabled: true });
    assert.ok(job.id);
    const raw = JSON.parse(readFileSync(join(UD_SCHED, 'schedules.json'), 'utf8'));
    assert.ok(raw.some((j) => j.id === job.id), 'job is on disk immediately after addJob');

    // real trigger path (the same one "Run now" and the tick call)
    assert.equal(s.runNow(job.id).ok, true);
    const deadline = Date.now() + 20_000;
    let current;
    for (;;) {
      current = s.listJobs().find((j) => j.id === job.id);
      if (current.lastStatus === 'ok' || current.lastStatus === 'error') break;
      if (Date.now() > deadline) throw new Error('scheduled run never reached a terminal status');
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(current.lastRun > 0, 'lastRun was written by the real fire');
    assert.ok(['ok', 'error'].includes(current.lastStatus), 'a terminal, honest status was persisted');
    if (current.lastStatus === 'error') {
      assert.ok(typeof current.lastMessage === 'string' && current.lastMessage.length > 0, 'the error carries a reason');
    }

    // persistence across a fresh module init (simulates app restart)
    s.shutdownScheduleService();
    s.initScheduleService({ userDataDir: UD_SCHED, broadcast: () => {} });
    assert.ok(s.listJobs().some((j) => j.id === job.id), 'job survives a scheduler restart');
  } finally {
    s.shutdownScheduleService();
    assert.equal(s.schedulerStatus().running, false, 'shutdown honestly reports a stopped clock');
  }
});

test('SCHEDULE: the panel next-run equals the service matcher; month indexing and aliases are honest', () => {
  const from = new Date(2026, 10, 1, 0, 0, 0); // 1 Nov 2026, local
  const expected = new Date(2026, 10, 23, 4, 30, 0).getTime(); // Mon 23 Nov 04:30
  const shown = schedUi.cronNextRun('30 4 23 11 1', from);
  assert.equal(shown, expected, 'panel shows 04:30 on 23 NOV (was off-by-one month: December)');

  // freeze the clock at the displayed next-run + 1s: the SERVICE must fire it
  const initAt = from.getTime();
  writeFileSync(join(UD_CRON, 'schedules.json'), JSON.stringify([{
    id: 'v1136-cron', name: 'Cron', prompt: 'ping', workspace: '', cron: '30 4 23 11 1',
    enabled: true, createdAt: initAt,
  }]));
  const s = schedule;
  scheduleInstances.push(s);
  s.initScheduleService({ userDataDir: UD_CRON, broadcast: () => {} });
  try {
    assert.equal(withClock(shown - 60_000, () => s.runSchedulerTick()), 0, 'not due one minute early');
    assert.equal(withClock(shown + 1_000, () => s.runSchedulerTick()), 1, 'due exactly at the displayed next-run');
    const j = s.listJobs().find((x) => x.id === 'v1136-cron');
    assert.ok(j.lastRun > 0, 'a real fire was recorded');
    assert.equal(j.lastStatus, 'error');
    assert.equal(j.lastMessage, 'no workspace configured', 'honest error, no fabricated success');
    assert.equal(withClock(shown + 61_000, () => s.runSchedulerTick()), 0, 're-arm: no double fire inside 60s');
  } finally {
    s.shutdownScheduleService();
  }

  assert.equal(schedUi.cronIsValid('0 0 * * 13'), false, 'invalid month is refused by the panel too');
  assert.equal(schedUi.cronIsValid('@monthly'), true, '@monthly is supported (previously shown as "—")');
  const monthly = schedUi.cronNextRun('@monthly', new Date(2026, 10, 15, 12, 0, 0));
  assert.equal(monthly, new Date(2026, 11, 1, 0, 0, 0).getTime(), '@monthly → first of next month');
  assert.equal(schedUi.cronNextRun('garbage', from), 0, 'unparseable cron → 0 → honest "—"');
});

after(() => {
  for (const s of scheduleInstances) { try { s.shutdownScheduleService(); } catch { /* down */ } }
  for (const f of UI_BUNDLES) { try { rmSync(f, { force: true }); } catch { /* gone */ } }
  try { providerServer?.closeAllConnections?.(); } catch { /* optional */ }
  if (providerServer) providerServer.close();
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});
