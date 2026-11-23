// ============================================================
// v11.42 — USAGE + FLOWS INDEPENDENT VERIFICATION (renderer + real service)
// ------------------------------------------------------------
// Scope (subagent verification + fix):
//   1. USAGE — re-audit v1140's de-dup against the REAL panel render:
//      · every rate/price still comes from api.modelInfo (resolver);
//      · no duplicated chart / cache / runs figure;
//      · the three NEW display fixes hold:
//        (a) a no-usage row no longer prints a broken "—model" label;
//        (b) a KNOWN $0 (free model) is a price, never "unknown";
//        (c) an estimated turn marks today's aggregate "≈", not exact.
//   2. FLOWS — the feature is genuinely useful: save a repeated prompt →
//      suggest (exact text) → run (real settled turn) → record (real count).
//      Plus UI honesty: ONE primary Run action (dead Replay removed), a visible
//      3-step purpose strip, and no fake ⌘/Ctrl+K shortcut in the empty state.
//
// Real esbuild bundles, real store, real SSR (react-dom/server), real flows
// service against a temp userData + injected run state. No source is patched.
//
//   node --test --test-force-exit tests/v1142-usage-flows.test.mjs
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const USAGE = 'src/components/panels/UsagePanel.tsx';
const FLOWS = 'src/components/panels/FlowsPanel.tsx';
const USRC = readFileSync(join(ROOT, USAGE), 'utf8');
const FSRC = readFileSync(join(ROOT, FLOWS), 'utf8');
const strip = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');
const UCODE = strip(USRC);
const FCODE = strip(FSRC);
const lineOf = (src, needle) => {
  const i = src.indexOf(needle);
  if (i < 0) return '?';
  let n = 1;
  for (let k = 0; k < i; k++) if (src.charCodeAt(k) === 10) n++;
  return String(n);
};
const loc = (file, src, needle) => `${file}:${lineOf(src, needle)}`;
const count = (hay, needle) => hay.split(needle).length - 1;

// ---------- isolated temp userData + electron stub ----------
const TMP = mkdtempSync(join(tmpdir(), 'sadeem-v1142-'));
const UD = join(TMP, 'userdata');
mkdirSync(UD, { recursive: true });
const ESTUB = join(TMP, 'node_modules', 'electron');
mkdirSync(ESTUB, { recursive: true });
writeFileSync(join(ESTUB, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(ESTUB, 'index.js'), `module.exports = {
  app: { getPath: () => ${JSON.stringify(UD)}, whenReady: async () => true, on() {}, quit() {}, isReady: () => true },
  ipcMain: { handle() {}, on() {} }, BrowserWindow: { getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false }, Notification: { isSupported: () => false },
  shell: {}, screen: {}, powerMonitor: { on() {} },
};`);

const UI = join(ROOT, 'tests', '.v1142-ui.cjs');
const FLOWS_SVC = join(TMP, 'flows.cjs');
const COSTS = join(TMP, 'costs.cjs');

// Browser stubs (same posture as v1140-usage-precision / v1138-flows).
function installStubs() {
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
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    matchMedia: mq,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    location: { href: 'http://localhost/', reload() {} },
    navigator: { userAgent: 'node-v1142', clipboard: { writeText: async () => {} } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, confirm: () => true,
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
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const LOADERS = { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.jpg': 'empty', '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' };
const EXTERNALS = ['electron', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/server', 'zustand',
  'lucide-react', '@xterm/xterm', '@xterm/addon-fit', 'monaco-editor', '@monaco-editor/react', 'lottie-web', 'qrcode'];
const stubPlugin = {
  name: 'v1142-stubs',
  setup(build) {
    build.onResolve({ filter: /\?worker$/ }, () => ({ path: 'worker', namespace: 'ssm' }));
    build.onResolve({ filter: /(^|\/)lib\/monaco$/ }, () => ({ path: 'lib-monaco', namespace: 'ssm' }));
    build.onResolve({ filter: /^@monaco-editor\/react$/ }, () => ({ path: 'monaco-react', namespace: 'ssm' }));
    build.onLoad({ filter: /.*/, namespace: 'ssm' }, ({ path: p }) => {
      let contents = 'export default null;';
      if (p === 'worker') contents = 'export default class SSMWorker {}';
      else if (p === 'lib-monaco') contents = "export const monaco = { editor: { defineTheme(){}, createModel(){} } }; export const monacoThemeFor = () => 'dark'; export const languageForPath = () => 'plaintext';";
      return { contents, loader: 'js' };
    });
  },
};

let mod, flowsSvc, React, renderToStaticMarkup, realUseState;
const MODEL = 'claude-sonnet-4-6';
const T = 1700000000000;

before(async () => {
  installStubs();
  await esbuild.build({
    stdin: {
      contents:
        "export { useStore } from './src/store';" +
        "export { UsagePanel, priceViewFromModelInfo, perMessageRows } from './src/components/panels/UsagePanel';" +
        "export { FlowsPanel, executeFlowRun, flowRunSteps, flowRunGate } from './src/components/panels/FlowsPanel';",
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: UI,
    loader: LOADERS, external: EXTERNALS, plugins: [stubPlugin], logLevel: 'silent',
  });
  esbuild.buildSync({
    stdin: { contents: "export * from './electron/services/flowsService';", resolveDir: ROOT, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: FLOWS_SVC,
    external: ['electron'], logLevel: 'silent',
  });
  esbuild.buildSync({
    entryPoints: [join(ROOT, 'electron/agent/costs.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: COSTS,
    external: ['electron'], logLevel: 'silent',
  });
  mod = require(UI);
  flowsSvc = require(FLOWS_SVC);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (sub, getSnap) => useSES(sub, getSnap, getSnap);
  React.useLayoutEffect = React.useEffect; // SSR silence
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

function seed(partial) {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    settings: { ...prev.settings, language: 'en', numerals: 'western', model: { provider: 'anthropic', model: MODEL }, usageLog: [] },
    session: { id: 's1', title: 't', messages: [], createdAt: T, updatedAt: T },
    sessionUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    running: false,
    sendMessage: async () => {},
    notify: () => {},
    ...partial,
  });
}

/**
 * SSR does not run effects. Inject a provider-exact price map into the panel's
 * `prices` state (the first bare `{}` in its subtree) so the real render path
 * is exercised with real resolver data.
 */
function renderUsage(priceMap) {
  realUseState = React.useState;
  let injected = false;
  React.useState = (initial) => {
    if (!injected && initial !== null && typeof initial === 'object' &&
        !Array.isArray(initial) && Object.keys(initial).length === 0) {
      injected = true;
      return [priceMap, () => {}];
    }
    return realUseState(initial);
  };
  try {
    return renderToStaticMarkup(React.createElement(mod.UsagePanel, { embedded: true }));
  } finally {
    React.useState = realUseState;
  }
}

/** Inject the flows array into the panel's first `useState(null)` (flows=null=loading). */
function renderFlows(flows) {
  realUseState = React.useState;
  let injected = false;
  React.useState = (initial) => {
    if (!injected && initial === null) {
      injected = true;
      return [flows, () => {}];
    }
    return realUseState(initial);
  };
  try {
    return renderToStaticMarkup(React.createElement(mod.FlowsPanel, { embedded: true }));
  } finally {
    React.useState = realUseState;
  }
}

// ============================================================
// 1 — USAGE: resolver wiring + de-dup still intact (re-audit v1140)
// ============================================================
test('1. USAGE re-audit: every rate is resolver-sourced; no duplicated section', () => {
  assert.ok(UCODE.includes('priceViewFromModelInfo(await api.modelInfo(id))'),
    `${loc(USAGE, USRC, 'priceViewFromModelInfo(await api.modelInfo')}: prices come from the main-process resolver`);
  assert.ok(UCODE.includes('fromProviderUsageReport(raw)'),
    `${loc(USAGE, USRC, 'fromProviderUsageReport(raw)')}: raw provider fields mapped once via ctx.ts`);
  assert.equal(count(UCODE, '<UsageChart'), 1, `${loc(USAGE, USRC, '<UsageChart')}: one chart`);
  assert.equal(count(UCODE, 'usage-bar'), 0, 'the second 14-day bar strip is gone');
  assert.equal(count(UCODE, 'Cache-read tokens'), 1, `${loc(USAGE, USRC, 'Cache-read tokens')}: one cache figure`);

  // real resolver payload → real price view, never a fabricated rate
  const costs = require(COSTS);
  const price = mod.priceViewFromModelInfo({ price: costs.priceFor(MODEL) });
  assert.equal(price.unknown, false);
  assert.equal(price.input, costs.priceFor(MODEL).input);
  const priceHtml = (() => {
    seed({ messages: [], sessionUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } });
    return renderUsage({ [MODEL]: price });
  })();
  assert.ok(priceHtml.includes(`IN $${price.input}`), 'exact resolver input rate rendered');
  assert.ok(priceHtml.includes(`OUT $${price.output}`), 'exact resolver output rate rendered');
  assert.equal(count(priceHtml, 'class="craft-svg us-chart"'), 1, 'one chart in the DOM');
  assert.equal(count(priceHtml, 'Cache-read tokens'), 1, 'cache figure rendered once');
  assert.equal(count(priceHtml, 'tok / 14d'), 1, `${loc(USAGE, USRC, 'windowTokens')}: one 14-day token total in the DOM`);
});

// ============================================================
// 2 — USAGE display fix (a): no broken "—model" label for source=none
// ============================================================
test('2. USAGE: a no-usage row keeps an honest model label (no "—" prefix)', () => {
  assert.ok(UCODE.includes('{r.estimated ? \'≈ \' : \'\'}{r.model ||'),
    `${loc(USAGE, USRC, "r.estimated ? '≈ '")}: model label no longer uses usageMark()`);
  assert.ok(!UCODE.includes('{usageMark(r.source)}\n                      {r.model'),
    'the old "—model" rendering is gone');
  seed({
    messages: [{ id: 'none', role: 'assistant', kind: 'text', content: 'x', timestamp: T, model: MODEL }],
    sessionUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  });
  const html = renderUsage({ [MODEL]: null });
  assert.ok(!html.includes(`—${MODEL}`), `no broken "—${MODEL}" label in the DOM ${loc(USAGE, USRC, 'r.model ||')}`);
  assert.ok(html.includes(MODEL), 'the model id is still shown');
});

// ============================================================
// 3 — USAGE display fix (b): known $0 is a price, not "unknown"
// ============================================================
test('3. USAGE: a free model with reported tokens shows $0.00, never "unknown"', () => {
  assert.ok(UCODE.includes('today.tokens > 0 ? `${todayEstimated ?'),
    `${loc(USAGE, USRC, 'today.tokens > 0 ?')}: cost is shown whenever tokens were reported`);
  seed({
    messages: [],
    sessionUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  });
  const todayKey = new Date().toISOString().slice(0, 10);
  mod.useStore.setState({
    settings: { ...mod.useStore.getState().settings, usageLog: [{ date: todayKey, runs: 1, tokens: 500, costUsd: 0 }] },
  });
  const html = renderUsage({});
  assert.ok(html.includes('$0.00'), 'a known $0 cost is rendered as a real price (fmtCost(0) = "$0.00")');
  assert.ok(!/>unknown<\/span>/.test(html.split('source: this device')[0].slice(-600)),
    'the Today cost cell does not say "unknown" when tokens were reported');
});

// ============================================================
// 4 — USAGE display fix (c): estimated turns mark today's aggregate "≈"
// ============================================================
test('4. USAGE: today aggregate carries ≈ when a turn was an estimate', () => {
  assert.ok(UCODE.includes('allRows.some((r) => r.estimated && Number.isFinite(r.at) && toKey(r.at) === todayKey)'),
    `${loc(USAGE, USRC, 'allRows.some((r) => r.estimated')}: estimate detection wired`);
  const now = Date.now();
  const todayKey = new Date(now).toISOString().slice(0, 10);
  seed({
    settings: { ...mod.useStore.getState().settings, language: 'en', model: { provider: 'custom', model: MODEL },
      usageLog: [{ date: todayKey, runs: 1, tokens: 500, costUsd: 0.002 }] },
    messages: [{
      id: 'est', role: 'assistant', kind: 'text', content: 'x', timestamp: now, model: MODEL,
      usage: { inputTokens: 400, outputTokens: 100, costUsd: 0, estimated: true,
        attempts: [{ provider: 'custom', model: MODEL, inputTokens: 400, outputTokens: 100, costUsd: 0, estimated: true }] },
    }],
    sessionUsage: { inputTokens: 400, outputTokens: 100, costUsd: 0, estimated: true },
  });
  const html = renderUsage({ [MODEL]: null });
  assert.ok(html.includes('≈ 500'), `today's estimated tokens are marked ≈ ${loc(USAGE, USRC, 'todayEstimated')}`);
  assert.ok(html.includes('includes turns') && html.includes('provider') && /≈/.test(html),
    'the honest ≈ explanation is rendered (i18n-backed copy)');
});

// ============================================================
// 5 — FLOWS: genuinely useful (save → suggest → run → record)
// ============================================================
test('5. FLOWS: repeat → exact-text suggestion → save → real settled run → one recorded bump', async () => {
  // (a) the app counts typed repetitions and exposes the EXACT text
  const raw = '  Summarize the weekly report for me  ';
  let r;
  for (let i = 0; i < 3; i++) r = await flowsSvc.flowsHit(raw);
  assert.equal(r.suggest, true, 'suggestion raised at the 3rd repetition');
  const suggestion = flowsSvc.flowsSuggestions().find((s) => s.raw === raw.trim());
  assert.ok(suggestion, 'a real suggestion exists with the exact typed prompt');
  assert.equal(flowsSvc.flowsInfo().suggestionTexts.includes(raw.trim()), true,
    'the existing bridge exposes it to the renderer');

  // (b) saving it as a flow stops the suggestion (the loop closes)
  const saved = await flowsSvc.flowsSave({ name: 'weekly summary', prompt: raw.trim(), scope: 'global' });
  const flow = saved.find((f) => f.name === 'weekly summary');
  assert.equal(flow.prompt, raw.trim(), 'the verbatim prompt was persisted');
  assert.equal(flowsSvc.flowsSuggestions().some((s) => s.raw === raw.trim()), false,
    'a saved prompt is never suggested again');

  // (c) Run drives a REAL false→true→false turn and records only after settle
  const listeners = new Set();
  const runState = { running: false };
  const setRunning = (v) => { runState.running = v; for (const l of listeners) l(v); };
  const seen = [];
  const outcome = await mod.executeFlowRun(flow, {
    send: async (text) => {
      seen.push(text);
      setRunning(true); // store flips running synchronously at press
      // ...the real chat turn would run here...
      setRunning(false); // terminal report clears it
    },
    isRunning: () => runState.running,
    subscribe: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    record: (id, ws) => flowsSvc.flowsMarkRun(id, ws),
  });
  assert.equal(seen[0], raw.trim(), 'the exact stored prompt reached the chat send path');
  assert.equal(outcome.reason, 'ok');
  assert.equal(outcome.settled, true, 'a real turn settled');
  assert.equal(outcome.recorded, true, 'the run was recorded');
  assert.equal(listeners.size, 0, 'subscription disposed');
  const after = flowsSvc.flowsList().find((f) => f.id === flow.id);
  assert.equal(after.runCount, 1, 'runCount advanced exactly once, after the real turn');
  assert.ok(after.lastRun > 0, 'lastRun persisted');
});

// ============================================================
// 6 — FLOWS UI: purpose obvious, one primary action, no dead control
// ============================================================
test('6. FLOWS UI: 3-step purpose, one Run action, honest empty state', () => {
  // source-level contracts (with file:line for the parent report)
  assert.ok(FCODE.includes('HOW A FLOW WORKS'), `${loc(FLOWS, FSRC, 'HOW A FLOW WORKS')}: purpose strip exists`);
  assert.equal(count(FCODE, 'flows.how.s'), 3, `${loc(FLOWS, FSRC, 'flows.how.s1')}: exactly 3 honest steps`);
  assert.ok(!FCODE.includes('RotateCcw'), `${loc(FLOWS, FSRC, 'RotateCcw')}: duplicate Replay icon removed`);
  assert.ok(!FCODE.includes('MOD_KEY'), `${loc(FLOWS, FSRC, 'MOD_KEY')}: fake ⌘K hint removed`);
  assert.equal(count(FCODE, 'fl-btn-run'), 1, `${loc(FLOWS, FSRC, 'fl-btn-run')}: one primary action per row`);
  assert.ok(FCODE.includes('Flow finished — run recorded'),
    `${loc(FLOWS, FSRC, 'flows.run.finished')}: accurate post-settle toast`);

  // real render — a saved flow shows exactly one Run control and the 3 steps
  seed({ session: { id: 's1', title: 't', messages: [], createdAt: T, updatedAt: T } });
  const withFlow = renderFlows([{ id: 'f1', name: 'daily check', prompt: 'check the build', scope: 'global', createdAt: 1, runCount: 0 }]);
  assert.ok(/HOW A FLOW WORKS|How a flow works/.test(withFlow), 'the purpose strip renders');
  assert.ok(withFlow.includes('Run flow'), 'the primary action is explicitly labelled');
  assert.equal(count(withFlow, '>Run flow</'), 1, 'exactly one primary Run action label in the DOM');
  assert.ok(!withFlow.includes('Replay this exact prompt'), 'no duplicate Replay control in the DOM');

  // real render — the empty state is honest (no fake keyboard shortcut)
  const empty = renderFlows([]);
  assert.ok(empty.includes('type the same prompt 3 times'), 'the empty state tells the user the real next step');
  assert.ok(!empty.includes('<kbd'), 'no dead keyboard hint in the empty state');
});

after(() => {
  if (React && realUseState) React.useState = realUseState;
  try { unlinkSync(UI); } catch { /* already gone */ }
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});
