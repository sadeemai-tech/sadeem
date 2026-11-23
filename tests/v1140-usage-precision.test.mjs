// ============================================================
// v11.40 — USAGE PANEL: PROVIDER-EXACT PRECISION + NO DUPLICATES
// ------------------------------------------------------------
// The founder's rule: "بيانات الاستهلاك، التوكنز وسعر التوكنز، يجب أن تكون
// دقيقة من المزود نفسه... كل شيء يجب أن يكون دقيق." This suite drives the
// REAL panel with a provider-exact fixture resolved by the SAME catalog the
// orb uses (api.modelInfo → priceFor → resolveModelInfo) and asserts:
//   1. exact tokens + exact price render, never fabricated;
//   2. duplicated UI is GONE (one chart, one cache figure, one runs figure);
//   3. every derived figure carries "≈"; an unbacked session total is never
//      presented as an exact provider number;
//   4. an unknown model says "unknown" and prints NO invented rate.
//
// Real esbuild bundles, real store, real SSR (react-dom/server). No source is
// patched. Run:
//   node --test --test-force-exit tests/v1140-usage-precision.test.mjs
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const PANEL = 'src/components/panels/UsagePanel.tsx';
const SRC = readFileSync(join(ROOT, PANEL), 'utf8');
const strip = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');
const CODE = strip(SRC);
const lineOf = (needle) => {
  const i = SRC.indexOf(needle);
  if (i < 0) return 0;
  let n = 1;
  for (let k = 0; k < i; k++) if (SRC.charCodeAt(k) === 10) n++;
  return n;
};
const at = (needle) => `${PANEL}:${lineOf(needle) || '?'}`;
const count = (hay, needle) => hay.split(needle).length - 1;

const TMP = mkdtempSync(join(tmpdir(), 'sadeem-v1140-'));
const UD = join(TMP, 'userdata');
mkdirSync(UD, { recursive: true });
// electron stub so costs.ts (node/main module) loads under plain Node
const ESTUB = join(TMP, 'node_modules', 'electron');
mkdirSync(ESTUB, { recursive: true });
writeFileSync(join(ESTUB, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(ESTUB, 'index.js'), `module.exports = {
  app: { getPath: () => ${JSON.stringify(UD)}, whenReady: async () => true, on() {}, quit() {}, isReady: () => true },
  ipcMain: { handle() {}, on() {} }, BrowserWindow: { getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false }, Notification: { isSupported: () => false },
  shell: {}, screen: {},
};`);

const COSTS = join(TMP, 'costs.cjs');
const CTX = join(TMP, 'ctx.cjs');
// renderer bundle lives under ROOT/tests so React/zustand/lucide resolve from
// the project's node_modules (the temp dir only holds the electron stub).
const UI = join(ROOT, 'tests', '.v1140-usage.cjs');

const MODEL = 'claude-sonnet-4-6';
const UNKNOWN = 'zzz-totally-unknown-xyz';
const T = 1700000000000;
const TOK = { in: 12_482, out: 700, cache: 3_000 };
const asModelInfo = (price) => ({ contextWindow: 200_000, ctxEstimated: false, price });

let mod, costs, ctx, React, renderToStaticMarkup, realUseState;
const PRICES = {};

before(() => {
  esbuild.buildSync({
    entryPoints: [join(ROOT, 'electron/agent/costs.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: COSTS,
    external: ['electron'], logLevel: 'silent',
  });
  costs = require(COSTS);
  esbuild.buildSync({
    entryPoints: [join(ROOT, 'src/lib/ctx.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: CTX,
    logLevel: 'silent',
  });
  ctx = require(CTX);

  // browser stubs (same posture as v1131-ui-run / v1136-usage-flows-schedule)
  const bridge = new Proxy({
    modelInfo: async (id) => asModelInfo(costs.priceFor(id)),
    appMetrics: async () => ({
      cpuPercent: 4.2, memoryMB: 256, processes: 12,
      uptimeSec: 4521, hostMemTotalMB: 16000, hostMemFreeMB: 6000,
    }),
    getSettings: async () => ({ language: 'en' }),
  }, {
    get(t, k) {
      if (k === 'then' || k === 'toJSON' || typeof k === 'symbol') return undefined;
      if (k in t) return t[k];
      return () => Promise.resolve(undefined);
    },
  });
  const mq = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.window = {
    surnia: bridge, kodex: bridge,
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    matchMedia: mq,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    navigator: { userAgent: 'node-v1140', clipboard: { writeText: async () => {} } },
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false } }, body: {},
    createElement: () => ({ style: {} }), addEventListener() {}, removeEventListener() {},
    hidden: false, visibilityState: 'visible',
  };
  globalThis.localStorage = globalThis.window.localStorage;
  globalThis.matchMedia = mq;
  Object.defineProperty(globalThis, 'navigator', { value: globalThis.window.navigator, configurable: true, writable: true });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };

  esbuild.buildSync({
    stdin: {
      contents:
        "export { useStore } from './src/store';" +
        "export { UsagePanel, priceViewFromModelInfo, priceCostUsd, billedSegments, perMessageRows, buildModelBreakdown, messageUsage, usageMark, priceSourceLabel, currentStreak, longestStreak } from './src/components/panels/UsagePanel';",
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: UI,
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty' },
    external: [
      'electron', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/server', 'zustand',
      'lucide-react', '@xterm/xterm', '@xterm/addon-fit', 'monaco-editor', '@monaco-editor/react',
    ],
    logLevel: 'silent',
  });
  mod = require(UI);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (sub, getSnap) => useSES(sub, getSnap, getSnap);
  React.useLayoutEffect = React.useEffect; // SSR silence
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;

  // The provider-exact fixture: real resolver output, exactly what
  // api.modelInfo(id) returns over the bridge at runtime.
  PRICES[MODEL] = mod.priceViewFromModelInfo(asModelInfo(costs.priceFor(MODEL)));
  PRICES[UNKNOWN] = mod.priceViewFromModelInfo(asModelInfo(costs.priceFor(UNKNOWN)));
});

function seed({ model = MODEL, messages = [], sessionUsage = null, usageLog = [] } = {}) {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    settings: { ...prev.settings, language: 'en', numerals: 'western', model: { provider: 'anthropic', model }, usageLog },
    session: { id: 's1', title: 't', messages, createdAt: T, updatedAt: T },
    sessionUsage: sessionUsage ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    notify: () => {},
  });
}

/**
 * SSR does not run useEffect, so the panel's `prices` state is empty by
 * default. Inject the provider-exact price map into that one useState call
 * (its initial value is the only bare `{}` in this subtree) to exercise the
 * real render path. Everything else is the real panel + real store.
 */
function renderUsage(priceMap = {}) {
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

// ============================================================
// 1 — provider-exact fixture → exact tokens & price, no fabrication
// ============================================================
test('1. provider-exact fixture renders exact tokens and the resolver price', () => {
  // wiring: the panel prices from api.modelInfo, and counts tokens via ctx.ts
  assert.ok(CODE.includes('priceViewFromModelInfo(await api.modelInfo(id))'), `${at('api.modelInfo')}: prices come from the main-process resolver`);
  assert.ok(CODE.includes('fromProviderUsageReport(raw)'), `${at('fromProviderUsageReport')}: raw provider fields are mapped once`);
  assert.ok(CODE.includes('ctxFillTokens(u)'), `${at('ctxFillTokens')}: token counts come from ctx.ts`);

  const price = PRICES[MODEL];
  const raw = costs.priceFor(MODEL);
  assert.equal(price.unknown, false, 'known model → known price');
  assert.equal(price.input, raw.input, 'input rate is the resolver rate');
  assert.equal(price.output, raw.output, 'output rate is the resolver rate');
  assert.equal(price.matchedId, raw.matchedId, 'catalog-row provenance preserved');

  const mapped = ctx.fromProviderUsageReport({
    prompt_tokens: TOK.in, completion_tokens: TOK.out, cache_read_input_tokens: TOK.cache,
  });
  assert.equal(mapped.estimated, false, 'provider-reported usage is never ≈');
  assert.equal(ctx.tokenCountSource(mapped), 'provider');
  assert.equal(mod.usageMark(ctx.tokenCountSource(mapped)), '', 'exact figure carries no ≈');

  const segs = mod.billedSegments(mapped);
  assert.equal(segs.fresh, TOK.in - TOK.cache, 'cache is a subset of billed input (no double count)');
  assert.equal(segs.cacheRead, TOK.cache);
  assert.equal(segs.total, TOK.in + TOK.out, 'single honest fill');
  assert.equal(segs.output, TOK.out);

  const exact = costs.estimateCostExact(MODEL, segs.fresh, segs.output, segs.cacheRead, segs.cacheWrite);
  const shown = mod.priceCostUsd(price, segs);
  assert.equal(Math.round(shown * 1e6), Math.round(exact.costUsd * 1e6), 'panel cost == costs.ts resolver cost to the micro-dollar');

  const usage = {
    ...mapped, costUsd: exact.costUsd,
    attempts: [{ provider: 'anthropic', model: MODEL, inputTokens: TOK.in, outputTokens: TOK.out, costUsd: exact.costUsd, cacheReadTokens: TOK.cache }],
  };
  seed({
    messages: [{ id: 'm1', role: 'assistant', kind: 'text', content: 'done', timestamp: T, model: MODEL, usage }],
    sessionUsage: {
      inputTokens: TOK.in, outputTokens: TOK.out, costUsd: exact.costUsd,
      cacheReadTokens: TOK.cache, cacheCreationTokens: 0,
    },
  });
  const rows = mod.perMessageRows(mod.useStore.getState().session.messages, { [MODEL]: price });
  assert.equal(rows[0].source, 'provider');
  assert.equal(rows[0].estimated, false);
  assert.equal(rows[0].tokens, TOK.in + TOK.out, 'per-message tokens are provider-exact');
  assert.equal(Math.round(rows[0].catalogCostUsd * 1e6), Math.round(exact.costUsd * 1e6));

  const html = renderUsage({ [MODEL]: price });
  assert.ok(html.includes('12,482'), 'exact input tokens rendered');
  assert.ok(html.includes('700'), 'exact output tokens rendered');
  assert.ok(html.includes('curated catalog') || html.includes('live catalog'), 'resolver price source rendered');
  assert.ok(html.includes(`IN $${price.input}`) && html.includes(`OUT $${price.output}`), 'exact resolver rates rendered');
  assert.ok(html.includes('Reconciled'), 'sum(rows) == session total');
  assert.ok(!html.includes('no catalog price'), 'known price → no unknown banner');
});

// ============================================================
// 2 — de-duplication: one authoritative place per figure
// ============================================================
test('2. duplicated chart / cache figure / runs figure are gone', () => {
  assert.equal(count(CODE, '<UsageChart'), 1, `${at('<UsageChart')}: one authoritative chart`);
  assert.equal(count(CODE, 'usage-bar'), 0, 'the second 14-day bar strip is removed');
  assert.equal(count(CODE, 'Cache-read tokens'), 1, `${at('Cache-read tokens')}: one cache figure`);
  assert.equal(CODE.includes('{today.runs} · avg'), false, 'today.runs is not printed twice');

  const price = PRICES[MODEL];
  const raw = costs.priceFor(MODEL);
  const mapped = ctx.fromProviderUsageReport({ prompt_tokens: TOK.in, completion_tokens: TOK.out, cache_read_input_tokens: TOK.cache });
  const exact = costs.estimateCostExact(MODEL, TOK.in - TOK.cache, TOK.out, TOK.cache, 0);
  const usage = { ...mapped, costUsd: exact.costUsd, attempts: [{ provider: 'anthropic', model: MODEL, inputTokens: TOK.in, outputTokens: TOK.out, costUsd: exact.costUsd }] };
  seed({
    messages: [{ id: 'm1', role: 'assistant', kind: 'text', content: 'done', timestamp: T, model: MODEL, usage }],
    sessionUsage: { inputTokens: TOK.in, outputTokens: TOK.out, costUsd: exact.costUsd, cacheReadTokens: TOK.cache, cacheCreationTokens: 0 },
    usageLog: [{ date: new Date().toISOString().slice(0, 10), runs: 2, tokens: 1000, costUsd: 0.01 }],
  });
  const html = renderUsage({ [MODEL]: price });
  assert.equal(count(html, 'usage-bar'), 0, 'no duplicated bar chart in the DOM');
  assert.ok(html.includes('us-chart'), 'the kept FIG. 02 chart is present');
  assert.equal(count(html, 'Cache-read tokens'), 1, 'cache-read tokens are rendered once');
  assert.equal(count(html, 'CACHE '), 0, 'no leftover CACHE stamp in the session card');
  assert.ok(html.includes('chart above'), 'lower card points to the one chart instead of redrawing it');
  assert.equal(raw.unknown, false);
});

// ============================================================
// 3 — estimates carry ≈; unbacked totals are never called exact
// ============================================================
test('3. every estimated or derived figure carries ≈', () => {
  assert.equal(mod.usageMark('estimated'), '≈ ');
  assert.equal(mod.usageMark('provider'), '');
  assert.equal(mod.usageMark('none'), '—');

  seed({
    messages: [{
      id: 'e1', role: 'assistant', kind: 'text', content: 'x', timestamp: T, model: MODEL,
      usage: {
        inputTokens: 400, outputTokens: 100, costUsd: 0.001, estimated: true, cacheReadTokens: 0,
        attempts: [{ provider: 'custom', model: MODEL, inputTokens: 400, outputTokens: 100, costUsd: 0.001, estimated: true }],
      },
    }],
    sessionUsage: { inputTokens: 400, outputTokens: 100, costUsd: 0.001, cacheReadTokens: 0 },
  });
  const html = renderUsage({ [MODEL]: PRICES[MODEL] });
  assert.ok(html.includes('≈ 500'), 'estimated session total carries ≈');
  assert.ok(html.includes(`≈ ${MODEL}`), 'estimated per-message row carries ≈');

  // derived "saved by cache" (cached × 0.9) is an estimate, not a provider count;
  // a session total with NO backing rows is the store's stale-metadata fallback.
  seed({
    messages: [],
    sessionUsage: { inputTokens: TOK.in, outputTokens: TOK.out, costUsd: 0.04, cacheReadTokens: TOK.cache, cacheCreationTokens: 0 },
  });
  const html2 = renderUsage({});
  assert.ok(html2.includes('≈ 2,700'), 'derived cache saving is marked ≈');
  assert.ok(html2.includes('≈ 13,182'), 'unbacked session total is marked ≈ (never exact)');
  assert.ok(html2.includes('≈ PROJ/MO'), 'monthly projection is marked ≈');
});

// ============================================================
// 4 — unknown model → honest unknown, never a fabricated rate
// ============================================================
test('4. unknown model shows honest unknown and NO invented price', () => {
  const p = PRICES[UNKNOWN];
  assert.equal(p.unknown, true, 'resolver flags the unknown id');
  assert.equal(mod.priceSourceLabel(p, false), 'unknown');
  assert.equal(mod.priceSourceLabel(null, false), 'unknown');
  assert.equal(mod.priceCostUsd(p, { fresh: 1000, output: 200, cacheRead: 0, cacheWrite: 0 }), 0, 'unknown price is never printed as a made-up cost');

  seed({ model: UNKNOWN, messages: [], sessionUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } });
  const html = renderUsage({ [UNKNOWN]: p });
  assert.ok(html.includes('no catalog price'), 'explicit unknown explanation rendered');
  assert.ok(html.includes('>unknown</span>'), 'price source honestly says unknown');
  assert.equal(count(html, 'IN $'), 0, 'no fabricated rate row for an unknown model');
  assert.ok(html.includes('No billed turns yet'), 'no invented token rows');
});

after(() => {
  if (React && realUseState) React.useState = realUseState;
  try { unlinkSync(UI); } catch { /* already gone */ }
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});
