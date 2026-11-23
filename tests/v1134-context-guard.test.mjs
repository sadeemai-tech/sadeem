// ============================================================================
// v1134 — CONTEXT-FILL VERIFICATION GUARD  (diagnosis + test ONLY)
// ----------------------------------------------------------------------------
// Founder's complaint (Arabic): «السياق يمتلئ فورًا / الواجهة تضغط السياق باستمرار
// على نموذج 1M» — "the context fills instantly / compresses constantly on a
// 1M model".
//
// This file does NOT fix anything. It is the guard the parent runs AFTER V11
// lands. It exercises the REAL sources (esbuild bundles + react-dom/server SSR
// against the REAL zustand store), never a re-implementation of the math:
//
//   1. REAL MATH   — 1,000,000 window + 100k used ⇒ ctxPct ≈ 10 (NOT 50 / 100),
//                    no compaction; 900k ⇒ ≈ 90%, compaction eligible.
//   2. NO DOUBLE COUNT / REAL WINDOW — cache split is INSIDE inputTokens (never
//                    added again); ctxWindow comes from the provider catalog /
//                    model:info, not a hard-coded 200k for a 1M model.
//   3. ORB HONESTY — unknown window ⇒ token count / em-dash, never a false
//                    "100%"; estimated or streaming ⇒ visible "≈" marker.
//   4. COMPACTION — threshold = 65% of the REAL window (650k for 1M), driven by
//                    provider input tokens; the decision at 100k / 900k is
//                    evaluated from the ACTUAL engine.ts expressions.
//
// Harness posture: same as tests/v1121-context-orb.test.mjs + the image guard —
// esbuild JS API, browser stubs installed BEFORE loading the store, SSR snapshot
// patched to the live store, no app source modified, no network, no load-time
// assertions. Every failure message carries file:line for the parent's report.
//
// Run: node --test --test-force-exit tests/v1134-context-guard.test.mjs
// ============================================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** 1-based line number of the first `needle`, for parent-facing failure reports. */
function lineOf(src, needle) {
  const i = typeof needle === 'string' ? src.indexOf(needle) : src.search(needle);
  return i < 0 ? '?' : src.slice(0, i).split('\n').length;
}
const at = (file, needle) => `${file}:${lineOf(read(file), needle)}`;

const CTX_SRC = read('src/lib/ctx.ts');
const COSTS_SRC = read('electron/agent/costs.ts');
const ENGINE_SRC = read('electron/agent/engine.ts');
const IPC_SRC = read('electron/ipc.ts');
const STORE_SRC = read('src/store.ts');
const STATUSBAR_SRC = read('src/components/StatusBar.tsx');
const LENS_SRC = read('src/components/ContextLens.tsx');

// Browser stubs BEFORE the store bundle loads (same as v1121-context-orb).
globalThis.window = {
  surnia: new Proxy({}, {
    get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : () => Promise.resolve(undefined)),
  }),
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false }),
  setTimeout: () => 1, clearTimeout() {},
};
globalThis.document = {
  documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
  body: { appendChild() {}, removeChild() {} },
  createElement: () => ({ style: {}, select() {}, remove() {} }),
  addEventListener() {}, removeEventListener() {},
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

const BUNDLES = [
  join(ROOT, 'tests', '.v1134-ctx-math.bundle.cjs'),
  join(ROOT, 'tests', '.v1134-ctx-costs.bundle.cjs'),
  join(ROOT, 'tests', '.v1134-ctx-lens.bundle.cjs'),
];

function bundle(entry, out, opts = {}) {
  esbuild.buildSync({
    ...(typeof entry === 'string'
      ? { entryPoints: [join(ROOT, entry)] }
      : { stdin: { ...entry, resolveDir: ROOT, loader: 'tsx' } }),
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"' },
    loader: { '.css': 'empty', '.svg': 'dataurl' },
    external: [
      'electron', '@xterm/xterm', '@xterm/addon-fit',
      'monaco-editor', '@monaco-editor/react',
      'react', 'react/jsx-runtime', 'react-dom', 'zustand',
    ],
    logLevel: 'silent',
    ...opts,
  });
}

bundle('src/lib/ctx.ts', BUNDLES[0]);
bundle('electron/agent/costs.ts', BUNDLES[1]);
bundle({
  contents:
    "export { ContextLens, ORB_CIRCUMFERENCE, orbArcLength } from './src/components/ContextLens';" +
    "export { useStore } from './src/store';",
}, BUNDLES[2]);

const ctx = require(BUNDLES[0]);
const costs = require(BUNDLES[1]);
const lensBundle = require(BUNDLES[2]);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// zustand v5 SSR reads api.getInitialState() (create()-time defaults) for the
// server snapshot. Point the third argument at the LIVE getSnapshot so every
// seeded state actually renders (same override as v1121-context-orb). Must be
// installed before the first render; zustand reads React.useSyncExternalStore
// at hook-call time, so the patch is picked up.
const useSES = React.useSyncExternalStore;
React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);

after(() => {
  for (const p of BUNDLES) { try { if (existsSync(p)) unlinkSync(p); } catch { /* gone */ } }
});

const h = React.createElement;
const renderLens = () => renderToStaticMarkup(h(lensBundle.ContextLens));
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

/** Seed the real slices the orb reads (fill / window / language / streaming). */
function seedLens({ fill = 0, ctxWindow = 1_000_000, estimated = false, streaming = false, lang = 'en' }) {
  lensBundle.useStore.setState({
    settings: {
      ...(lensBundle.useStore.getState().settings ?? {}),
      language: lang,
      numerals: 'western',
      model: { provider: 'anthropic', model: 'claude-sonnet-5.5' },
    },
    running: streaming,
    liveStreamChars: streaming ? 4_000 : 0,
    ctxWindowEstimated: estimated,
    ctxWindow,
    sessionUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    lastTurnUsage: { inputTokens: fill, outputTokens: 0, costUsd: 0 },
  });
}

/** Pull the rendered orb's centre text, title/aria tip and exact arc geometry. */
function orb(html) {
  const center = html.match(/class="ctx-orb-value bidi-num" dir="ltr">([^<]*)</);
  assert.ok(center, 'the orb centre span is rendered');
  const title = html.match(/\btitle="([^"]*)"/);
  assert.ok(title, 'the orb button carries a title/tip');
  const arcEl = html.match(/<circle[^>]*class="ctx-orb-arc"[^>]*>/);
  assert.ok(arcEl, 'the orb arc circle is rendered');
  const dash = arcEl[0].match(/stroke-dasharray="([\d.eE+-]+)\s+([\d.eE+-]+)"/);
  assert.ok(dash, 'stroke-dasharray is present on the arc');
  return { center: center[1], title: title[1], arc: Number(dash[1]), circ: Number(dash[2]) };
}

// ===========================================================================
// 0 · harness sanity — prove we bundled the REAL modules
// ===========================================================================
test('V1134-CTX-0 · harness bundles real ctx.ts / costs.ts / ContextLens + real store', () => {
  assert.equal(typeof ctx.ctxFillTokens, 'function', 'real ctxFillTokens not bundled');
  assert.equal(typeof ctx.ctxPctExact, 'function', 'real ctxPctExact not bundled');
  assert.equal(typeof costs.contextWindowFor, 'function', 'real contextWindowFor not bundled');
  assert.ok(lensBundle.ContextLens && lensBundle.useStore?.setState,
    'real ContextLens + zustand store not bundled');
  seedLens({ fill: 100_000, ctxWindow: 1_000_000 });
  const html = renderLens();
  assert.match(html, /class="ctx-orb"/, 'ContextLens did not SSR the orb');
  assert.ok(html.length > 200, 'ContextLens SSR produced no meaningful markup');
});

// ===========================================================================
// 1 · REAL MATH — 1M window: 100k ⇒ ≈10% (never 50/100); 900k ⇒ ≈90%
// ===========================================================================
test('V1134-CTX-1a · 100k used on a 1,000,000 window = ~10%, NOT 50% or 100%', () => {
  const u = { inputTokens: 100_000, outputTokens: 0, costUsd: 0 };
  const fill = ctx.ctxFillTokens(u);
  assert.equal(fill, 100_000, `fill wrong: ${at('src/lib/ctx.ts', 'export function ctxFillTokens')}`);
  const pct = ctx.ctxPctExact(u, 1_000_000);
  assert.ok(close(pct, 10, 1e-9),
    `100k / 1M must be ~10%, got ${pct}. Formula broken at ${at('src/lib/ctx.ts', 'export function ctxPctExact')}`);
  assert.equal(ctx.ctxPctOf(u, 1_000_000), 10,
    `rounded ctxPct must be 10 (the founder saw 50/100): ${at('src/lib/ctx.ts', 'export function ctxPctOf')}`);
  assert.ok(pct < 20 && pct !== 50 && pct !== 100,
    `the "instantly full" symptom (50%/100%) is still present: ${at('src/lib/ctx.ts', 'Math.min(100, (ctxFillTokens(u) / ctxWindow) * 100)')}`);
});

test('V1134-CTX-1b · generated output joins the fill; 95k prompt + 5k out = ~10%', () => {
  const u = { inputTokens: 95_000, outputTokens: 5_000, costUsd: 0 };
  assert.equal(ctx.ctxFillTokens(u), 100_000,
    `output tokens missing from fill (the A6 bug): ${at('src/lib/ctx.ts', '(u.inputTokens ?? 0) + (u.outputTokens ?? 0)')}`);
  assert.ok(close(ctx.ctxPctExact(u, 1_000_000), 10, 1e-9), '95k+5k on 1M must be ~10%');
});

test('V1134-CTX-1c · 900k used on 1M = ~90% (near-full, compaction eligible)', () => {
  const u = { inputTokens: 900_000, outputTokens: 0, costUsd: 0 };
  const pct = ctx.ctxPctExact(u, 1_000_000);
  assert.ok(close(pct, 90, 1e-9), `900k / 1M must be ~90%, got ${pct}`);
  assert.equal(ctx.ctxPctOf(u, 1_000_000), 90, 'rounded pct at 900k must be 90');
  assert.ok(pct >= 65, '900k must be above the 65% compaction line');
});

test('V1134-CTX-1d · the SAME 100k on a true 200k window is 50% (window drives the number)', () => {
  const u = { inputTokens: 100_000, outputTokens: 0, costUsd: 0 };
  assert.ok(close(ctx.ctxPctExact(u, 200_000), 50, 1e-9),
    'the 50% figure is only correct for a genuine 200k model — never a 1M model');
});

// ===========================================================================
// 2 · NO CACHE DOUBLE-COUNT + WINDOW FROM CATALOG (not a hard-coded 200k)
// ===========================================================================
test('V1134-CTX-2a · cache split stays INSIDE inputTokens — never added again', () => {
  const u = {
    inputTokens: 120_000, outputTokens: 5_000,
    cacheReadTokens: 90_000, cacheCreationTokens: 20_000,
  };
  const fill = ctx.ctxFillTokens(u);
  assert.equal(fill, 125_000,
    `cache was double-counted (fill should be input+output only): ${at('src/lib/ctx.ts', 'export function ctxFillTokens')}`);
  assert.notEqual(fill, 120_000 + 5_000 + 90_000 + 20_000,
    `cache segments were added on top of the prompt: ${at('src/lib/ctx.ts', 'export function ctxFillTokens')}`);
  assert.ok(close(ctx.ctxPctExact(u, 1_000_000), 12.5, 1e-9), '125k / 1M = 12.5%');
  assert.ok(!/cacheReadTokens|cacheCreationTokens/.test(
    CTX_SRC.slice(CTX_SRC.indexOf('export function ctxFillTokens'), CTX_SRC.indexOf('export function ctxPctExact'))),
    `ctxFillTokens must ignore cache fields entirely: ${at('src/lib/ctx.ts', 'export function ctxFillTokens')}`);
});

test('V1134-CTX-2d · occupancy segments are disjoint and sum to exactly one fill', () => {
  const u = {
    inputTokens: 120_000, outputTokens: 5_000,
    cacheReadTokens: 90_000, cacheCreationTokens: 20_000,
  };
  const s = ctx.occupancySegments(u);
  assert.equal(s.cacheRead, 90_000, `cache read segment: ${at('src/lib/ctx.ts', 'export function occupancySegments')}`);
  assert.equal(s.cacheWrite, 20_000, `cache write segment: ${at('src/lib/ctx.ts', 'export function occupancySegments')}`);
  assert.equal(s.fresh, 10_000, 'fresh input = prompt minus the cache segments inside it');
  assert.equal(s.generated, 5_000, 'generated output does not inflate fresh input');
  assert.equal(s.streamed, 0, 'no live stream in an exact usage report');
  assert.equal(s.cacheRead + s.cacheWrite + s.fresh + s.generated + s.streamed, s.total,
    `segments must sum to ONE fill, never a fill + generated double count: ${at('src/lib/ctx.ts', 'export function occupancySegments')}`);
  // fill = prompt 100k + generated 5k + 5k streamed since the last exact report.
  const withStream = ctx.occupancySegments({ inputTokens: 100_000, outputTokens: 5_000 }, 110_000);
  assert.equal(withStream.streamed, 5_000, 'live streamed tokens are their own segment');
  assert.equal(withStream.cacheRead + withStream.cacheWrite + withStream.fresh + withStream.generated + withStream.streamed,
    withStream.total, 'streaming segments still sum to exactly the shown fill');
});

test('V1134-CTX-2b · provider catalog returns the real 1M-class window (never the 200k fallback)', () => {
  // Rows whose catalog value is exactly 1,000,000.
  const exactOneM = [
    'claude-opus-5.5', 'claude-sonnet-5.5', 'claude-haiku-5.5',
    'anthropic/claude-sonnet-5.5', 'openrouter/anthropic/claude-opus-5.5',
    'deepseek-v4', 'qwen3-8', 'qwen3-7', 'minimax-m3',
  ];
  for (const id of exactOneM) {
    const info = costs.contextWindowInfo(id);
    assert.equal(info.ctx, 1_000_000,
      `"${id}" fell through to ${info.ctx} instead of the 1M catalog row: ${at('electron/agent/costs.ts', 'const CONTEXT_WINDOWS')}`);
    assert.equal(info.estimated, false,
      `a known 1M model must NOT be flagged estimated: ${at('electron/agent/costs.ts', 'return hit ?')}`);
    assert.equal(costs.contextWindowFor(id), info.ctx, 'contextWindowFor must delegate to contextWindowInfo');
  }
  // Rows whose catalog value is slightly above 1M (1,048,576 / 1,050,000) are
  // still 1M-class models — never the 200k fallback.
  for (const id of ['gpt-6-astra', 'gemini-4-argon', 'gpt-5.5', 'glm-5-3', 'kimi-k3']) {
    const info = costs.contextWindowInfo(id);
    assert.ok(info.ctx >= 1_000_000,
      `"${id}" is a 1M-class model but got ${info.ctx}: ${at('electron/agent/costs.ts', 'const CONTEXT_WINDOWS')}`);
    assert.notEqual(info.ctx, 200_000,
      `hard-coded 200k leaked for 1M-class model "${id}": ${at('electron/agent/costs.ts', 'const CONTEXT_FALLBACK')}`);
    assert.equal(info.estimated, false, `known model "${id}" must not be flagged estimated`);
  }
  const unknown = costs.contextWindowInfo('totally-unknown-model-zzz');
  assert.equal(unknown.ctx, 200_000, 'unknown models still get the honest 200k default');
  assert.equal(unknown.estimated, true, 'the 200k default must be flagged estimated (shown as ≈)');
});

test('V1134-CTX-2c · the live window reaches the store via model:info (catalog first), not a literal', () => {
  assert.match(IPC_SRC, /catalogCtx\s*\?\?\s*info\.ctx/,
    `model:info must prefer the provider-reported window: ${at('electron/ipc.ts', 'const catalogCtx')}`);
  assert.match(IPC_SRC, /estimated\s*=\s*catalogCtx\s*==\s*null\s*\?\s*info\.estimated\s*:\s*false/,
    `estimated flag must follow the catalog resolution: ${at('electron/ipc.ts', 'const estimated')}`);
  assert.match(STATUSBAR_SRC, /setCtxWindow\(info\.contextWindow \|\| 0\)/,
    `ctxWindow must be seeded from modelInfo: ${at('src/components/StatusBar.tsx', 'setCtxWindow(info.contextWindow')}`);
  assert.match(STORE_SRC, /windowTokens\s*=\s*info\.contextWindow \|\| 0/,
    `/context fallback must use the real window: ${at('src/store.ts', 'windowTokens = info.contextWindow')}`);
  // The compact decision & the /context readout must not divide by a fixed small count.
  assert.match(ENGINE_SRC, /contextWindowInfo\(params\.model\.model\)/,
    `engine window must come from the catalog: ${at('electron/agent/engine.ts', 'const catalogCtx')}`);
  assert.match(ENGINE_SRC, /openrouterContextFor\(params\.model\.model\)/,
    `engine must prefer the provider-reported window: ${at('electron/agent/engine.ts', 'const reportedCtx')}`);
  assert.doesNotMatch(
    ENGINE_SRC.slice(ENGINE_SRC.indexOf('const ctxWindowTokens'), ENGINE_SRC.indexOf('const ctxCapChars')),
    /=\s*\d[\d_]*\s*;/,
    `a hard-coded window replaced the catalog lookup: ${at('electron/agent/engine.ts', 'const ctxWindowTokens')}`);
});

// ===========================================================================
// 3 · ORB HONESTY — ≈ / unknown states, no false 100%
// ===========================================================================
test('V1134-CTX-3a · orb at 100k / 1M prints 10% and draws a ~10% arc (exact 2πr)', () => {
  seedLens({ fill: 100_000, ctxWindow: 1_000_000 });
  const o = orb(renderLens());
  assert.equal(o.center, '10%', `orb centre must read 10%, got "${o.center}"`);
  assert.ok(close(o.arc, (10 / 100) * o.circ, 1e-6),
    `arc must be 10% of 2πr, got ${o.arc}/${o.circ}: ${at('src/components/ContextLens.tsx', 'orbArcLength(pctExact, RADIUS)')}`);
  assert.ok(!o.title.includes('≈'), 'a known exact window must NOT be marked ≈');
  assert.match(o.title, /10\.0%/, `orb tip must print the exact pct: ${at('src/components/ContextLens.tsx', 'p: pctExact.toFixed(1)')}`);
});

test('V1134-CTX-3b · UNKNOWN window shows tokens, never a false 100% (the founder\'s symptom)', () => {
  seedLens({ fill: 100_000, ctxWindow: 0 });
  const o = orb(renderLens());
  assert.ok(!/100%|50%|0%/.test(o.center),
    `unknown window still prints a fake percentage "${o.center}": ${at('src/components/ContextLens.tsx', 'const centerText')}`);
  assert.match(o.center, /k$/, 'unknown window must show a token count (e.g. "100.0k"), not a percent');
  assert.match(o.title, /window size unknown/i,
    `the tip must admit the window is unknown: ${at('src/components/ContextLens.tsx', "t('sb.ring.ctxUnknown'")}`);
  assert.ok(close(o.arc, 0, 1e-9), 'unknown window must not draw a misleading arc');
});

test('V1134-CTX-3c · no data prints an em-dash, never "0%" or "100%"', () => {
  seedLens({ fill: 0, ctxWindow: 1_000_000 });
  const o = orb(renderLens());
  assert.equal(o.center, '—',
    `empty session must show "—" (nothing measured yet), got "${o.center}": ${at('src/components/ContextLens.tsx', "noData ? '—'")}`);
  assert.ok(close(o.arc, 0, 1e-9), '0% paints no arc');
});

test('V1134-CTX-3d · estimated window and live stream carry the honest ≈ marker', () => {
  seedLens({ fill: 50_000, ctxWindow: 200_000, estimated: true });
  const est = orb(renderLens());
  assert.ok(est.title.includes('≈'),
    `estimated 200k must be marked ≈: ${at('src/components/ContextLens.tsx', 'const approx')}`);
  assert.equal(est.center, '25%', 'the percentage still reflects the real numbers');

  seedLens({ fill: 100_000, ctxWindow: 1_000_000, streaming: true });
  const live = orb(renderLens());
  assert.ok(live.title.includes('≈'),
    `live chars/4 estimate must be marked ≈: ${at('src/components/ContextLens.tsx', 'const approx')}`);
  assert.notEqual(live.center, '100%', 'streaming must not flip the orb to a false full state');
});

test('V1134-CTX-3e · contextFillPercent: null when unknown / outgrown ≈-default, never a fake 100%', () => {
  assert.equal(ctx.contextFillPercent(100_000, 1_000_000, false), 10,
    `100k on 1M must be 10: ${at('src/lib/ctx.ts', 'export function contextFillPercent')}`);
  assert.equal(ctx.contextFillPercent(100_000, 0, false), null,
    `unknown window must return null (no trustworthy pct): ${at('src/lib/ctx.ts', 'export function contextFillPercent')}`);
  assert.equal(ctx.contextFillPercent(250_000, 200_000, true), null,
    `an outgrown ≈-default must return null, not a clamped 100%: ${at('src/lib/ctx.ts', 'windowEstimated && f >= ctxWindow')}`);
  assert.equal(ctx.contextFillPercent(50_000, 200_000, true), 25,
    'a not-yet-outgrown estimated window still reports the real ratio');
  assert.ok(LENS_SRC.includes("const realPct = contextFillPercent(fillShown, ctxWindow, ctxWindowEstimated)"),
    `orb must use the honest helper: ${at('src/components/ContextLens.tsx', 'const realPct')}`);
  assert.ok(LENS_SRC.includes('const unknown = realPct === null'),
    `unknown state must follow the honest helper: ${at('src/components/ContextLens.tsx', 'const unknown')}`);
  assert.ok(LENS_SRC.includes("noData ? '—' : unknown ? fmtTokens(fillShown) : `${ctxPct}%`"),
    `orb centre contract changed: ${at('src/components/ContextLens.tsx', 'const centerText')}`);
});

test('V1134-CTX-3f · outgrown estimated window renders tokens, still not 100%', () => {
  seedLens({ fill: 250_000, ctxWindow: 200_000, estimated: true });
  const o = orb(renderLens());
  assert.ok(!/100%/.test(o.center),
    `an outgrown ≈ default still shows "${o.center}" — false 100% at ${at('src/components/ContextLens.tsx', 'const centerText')}`);
  assert.match(o.center, /k$/, 'the centre must fall back to a token count');
  assert.ok(close(o.arc, 0, 1e-9), 'no honest pct exists ⇒ no arc');
});

// ===========================================================================
// 4 · COMPACTION THRESHOLD — real window, evaluated from engine.ts itself
// ===========================================================================
test('V1134-CTX-4a · compaction threshold = 90% of the REAL window (catalog-first, never 130k)', () => {
  assert.equal(ctx.COMPACT_TRIGGER_RATIO, 0.9,
    `auto-compact must engage at 90%, not the old 65%: ${at('src/lib/ctx.ts', 'COMPACT_TRIGGER_RATIO')}`);
  assert.equal(ctx.compactionThresholdTokens(1_000_000), 900_000,
    `1M window ⇒ 900k threshold, not 130k: ${at('src/lib/ctx.ts', 'export function compactionThresholdTokens')}`);
  assert.equal(ctx.compactionThresholdTokens(200_000), 180_000, '200k window ⇒ 180k threshold');
  assert.equal(ctx.compactionThresholdTokens(0), 0, 'unknown window ⇒ no honest threshold');
  assert.equal(ctx.compactionThresholdTokens(-1), 0, 'invalid window ⇒ no threshold');

  // Evaluate the engine's ACTUAL window-resolution lines (provider report,
  // catalog, Math.max) with the real catalog + a simulated provider window.
  const lines = ENGINE_SRC.split('\n');
  const winIdx = lines.findIndex((l) => /const ctxWindowTokens\s*=/.test(l));
  assert.ok(winIdx >= 2, `engine window expression not found: ${at('electron/agent/engine.ts', 'const ctxWindowTokens')}`);
  const snippet = lines.slice(winIdx - 2, winIdx + 1).join('\n');
  const resolveWin = new Function('openrouterContextFor', 'contextWindowInfo', 'params',
    `${snippet}\nreturn ctxWindowTokens;`);
  const cold = resolveWin(() => null, costs.contextWindowInfo, { model: { model: 'claude-sonnet-5.5' } });
  assert.equal(cold, 1_000_000,
    `engine window is ${cold}, expected the 1M catalog row: ${at('electron/agent/engine.ts', 'const ctxWindowTokens')}`);
  const reported = resolveWin(() => 983_041, costs.contextWindowInfo, { model: { model: 'vendor/unknown-1m' } });
  assert.equal(reported, 983_041,
    `provider-reported window must win over the catalog/200k default: ${at('electron/agent/engine.ts', 'const reportedCtx')}`);
  assert.match(ENGINE_SRC, /const compactTokenThreshold\s*=\s*compactionThresholdTokens\(ctxWindowTokens\)/,
    `engine must use the real-window threshold helper: ${at('electron/agent/engine.ts', 'const compactTokenThreshold')}`);
});

test('V1134-CTX-4b · compaction decision: 100k = NO, 900k = YES (real helper + engine wiring)', () => {
  assert.equal(ctx.isCompactionEligible(100_000, 1_000_000), false,
    `100k on a 1M model must NOT compact (the founder's "compresses constantly"): ${at('src/lib/ctx.ts', 'export function isCompactionEligible')}`);
  assert.equal(ctx.isCompactionEligible(130_000, 1_000_000), false,
    '130k — the old 65%-of-200k trigger — must no longer compact a 1M model');
  assert.equal(ctx.isCompactionEligible(899_999, 1_000_000), false, 'just below 90% ⇒ no compaction');
  assert.equal(ctx.isCompactionEligible(900_000, 1_000_000), true,
    `900k on a 1M model ⇒ compaction eligible: ${at('src/lib/ctx.ts', 'export function isCompactionEligible')}`);
  assert.equal(ctx.isCompactionEligible(500_000, 0), false, 'unknown window must never trigger compaction');
  assert.match(ENGINE_SRC, /const realTokenTrigger\s*=\s*isCompactionEligible\(lastRealInputTokens, ctxWindowTokens\)/,
    `engine trigger must call the real helper: ${at('electron/agent/engine.ts', 'const realTokenTrigger')}`);
  const pct = ENGINE_SRC.match(/const pctBefore\s*=\s*([^;]+);/);
  assert.ok(pct && /ctxWindowTokens/.test(pct[1]),
    `compaction % must divide by the real window: ${at('electron/agent/engine.ts', 'const pctBefore')}`);
  assert.match(ENGINE_SRC, /lastRealInputTokens\s*=\s*u\.inputTokens/,
    `trigger must use the provider's real input tokens: ${at('electron/agent/engine.ts', 'lastRealInputTokens = u.inputTokens')}`);
});

test('V1134-CTX-4c · /context readout uses the last-turn delta / real window, not the session sum', () => {
  assert.match(STORE_SRC, /const pct = windowTokens > 0 \? Math\.min\(100, \(fill \/ windowTokens\) \* 100\) : 0/,
    `/context pct must use the real window: ${at('src/store.ts', 'const pct = windowTokens > 0')}`);
  assert.ok(STORE_SRC.includes('lastTurnUsage: { ...usage }'),
    `the context meter must keep the per-turn delta, not the cumulative sum: ${at('src/store.ts', 'lastTurnUsage: { ...usage }')}`);
});
