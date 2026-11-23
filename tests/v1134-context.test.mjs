import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.34 (CTX-1) — THE FOUNDER'S CONTEXT-RING / COMPACTION BUG
// ------------------------------------------------------------
// Symptom: "الدائرة... كل شوي الكونتكست بيمتلى... بعمل ضغط للكونتكست،
// والنموذج كونتكست تبعه مليون!" — a 1M-context model was measured against the
// 200k fallback and auto-compacted at 65% of it (130k = 13% of the real
// window), so the orb looked full and compaction fired constantly.
//
// This suite drives the REAL pure math in src/lib/ctx.ts, the REAL ContextLens
// via SSR, and source-guards the REAL engine threshold. Proof:
//   1. cache is folded INSIDE inputTokens — never double counted;
//   2. 100k / 1M -> ~10% and NOT compaction eligible; 900k / 1M -> ~90% and
//      compaction eligible; the trigger is 90% of the REAL catalog window;
//   3. the orb prints the precise percentage, an honest "window unknown"
//      state, and NEVER a fabricated 100% when an ≈ window was outgrown;
//   4. the user's /compact path is untouched.
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const LENS_SRC = readFileSync(join(ROOT, 'src', 'components', 'ContextLens.tsx'), 'utf8');
const ENGINE_SRC = readFileSync(join(ROOT, 'electron', 'agent', 'engine.ts'), 'utf8');
const STORE_SRC = readFileSync(join(ROOT, 'src', 'store.ts'), 'utf8');

const CTX_BUNDLE = join(ROOT, 'tests', '.v1134-ctx.bundle.cjs');
const LENS_BUNDLE = join(ROOT, 'tests', '.v1134-lens.bundle.cjs');
let ctx;
let React;
let renderToStaticMarkup;
let mod;

before(() => {
  esbuild.buildSync({
    entryPoints: [join(ROOT, 'src', 'lib', 'ctx.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: CTX_BUNDLE,
  });
  ctx = require(CTX_BUNDLE);

  // Minimal browser stubs installed BEFORE the store bundle loads (same shape
  // as v1121/v1127). Effects do not run under SSR, so modelInfo is never called.
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

  esbuild.buildSync({
    stdin: {
      contents:
        "export { ContextLens, ORB_RADIUS } from './src/components/ContextLens';" +
        "export { useStore } from './src/store';",
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: LENS_BUNDLE,
    loader: { '.css': 'empty' },
    external: ['electron', 'react', 'react/jsx-runtime', 'react-dom', 'lucide-react'],
  });
  mod = require(LENS_BUNDLE);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  for (const f of [CTX_BUNDLE, LENS_BUNDLE]) {
    try { unlinkSync(f); } catch { /* already gone */ }
  }
});

const usage = (input, output, extra = {}) => ({ inputTokens: input, outputTokens: output, costUsd: 0, ...extra });
const ONE_M = 1_000_000;
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

// ------------------------------------------------------------
// 1 · CACHE IS NOT DOUBLE-COUNTED
// ------------------------------------------------------------
test('v1134: ctxFillTokens = last prompt (cache inside) + generated — no cache double count', () => {
  // Anthropic-style usage: inputTokens ALREADY includes cache read + creation.
  const u = usage(100_000, 5_000, { cacheReadTokens: 60_000, cacheCreationTokens: 10_000 });
  assert.equal(ctx.ctxFillTokens(u), 105_000, 'cache is a segment of input, not added twice');
  assert.equal(ctx.ctxFillTokens(null), 0);
  assert.equal(ctx.ctxFillTokens(undefined), 0);
});

test('v1134: occupancySegments are disjoint and sum to exactly the fill', () => {
  const u = usage(95_000, 5_000, { cacheReadTokens: 40_000, cacheCreationTokens: 10_000 });
  const s = ctx.occupancySegments(u, 100_000);
  assert.equal(s.cacheRead, 40_000);
  assert.equal(s.cacheWrite, 10_000);
  assert.equal(s.fresh, 45_000, 'fresh = input - cache, never input + generated');
  assert.equal(s.generated, 5_000);
  assert.equal(s.streamed, 0);
  assert.equal(s.cacheRead + s.cacheWrite + s.fresh + s.generated + s.streamed, s.total);
  assert.equal(s.total, 100_000);

  // Live estimate: the streamed chars/4 tail is its OWN segment, still no overlap.
  const live = ctx.occupancySegments(u, 110_000);
  assert.equal(live.streamed, 10_000);
  assert.equal(live.cacheRead + live.cacheWrite + live.fresh + live.generated + live.streamed, 110_000);
});

// ------------------------------------------------------------
// 2 · REAL 1M WINDOW: 100k -> 10% (no compaction), 900k -> 90% (eligible)
// ------------------------------------------------------------
test('v1134: 100k fill in a 1M window is ~10% and NOT compaction eligible', () => {
  const u = usage(95_000, 5_000, { cacheReadTokens: 40_000, cacheCreationTokens: 10_000 });
  assert.equal(ctx.ctxFillTokens(u), 100_000);
  assert.ok(close(ctx.ctxPctExact(u, ONE_M), 10), '10% of the REAL window');
  assert.equal(ctx.isCompactionEligible(100_000, ONE_M), false, 'no compaction at 10%');
  assert.equal(ctx.compactionThresholdTokens(ONE_M), 900_000, 'trigger is 90% of 1M = 900k');
});

test('v1134: 900k fill in a 1M window is ~90% and compaction IS eligible', () => {
  const u = usage(850_000, 50_000, { cacheReadTokens: 500_000, cacheCreationTokens: 100_000 });
  assert.equal(ctx.ctxFillTokens(u), 900_000);
  assert.ok(close(ctx.ctxPctExact(u, ONE_M), 90), '90% of the REAL window');
  assert.equal(ctx.isCompactionEligible(900_000, ONE_M), true, 'compaction at 90%');
  assert.equal(ctx.isCompactionEligible(899_999, ONE_M), false, 'not one token earlier');
});

test('v1134: trigger is a percentage of the REAL window, not a fixed small count', () => {
  assert.equal(ctx.compactionThresholdTokens(200_000), 180_000, '≈200k fallback -> 180k');
  assert.equal(ctx.compactionThresholdTokens(1_048_576), 943_718);
  assert.equal(ctx.compactionThresholdTokens(0), 0, 'unknown window -> no threshold');
  assert.equal(ctx.isCompactionEligible(1_000_000, 0), false, 'never auto-compact on an unknown window');
  // 100k used to exceed 65% of a 200k fallback (130k) soon after — it is now 10% of 1M.
  assert.equal(ctx.isCompactionEligible(100_000, 200_000), false);
});

// ------------------------------------------------------------
// 3 · HONEST ORB: precise %, unknown state, never a false 100%
// ------------------------------------------------------------
test('v1134: contextFillPercent is null for unknown / outgrown-estimate windows', () => {
  assert.equal(ctx.contextFillPercent(100_000, 0), null, 'unknown -> no percentage');
  assert.equal(ctx.contextFillPercent(250_000, 200_000, true), null,
    'an ≈200k window outgrown by 250k is plainly larger — 100% would be a lie');
  assert.equal(ctx.contextFillPercent(100_000, 200_000, true), 50, 'below the estimate -> honest ≈50%');
  assert.equal(ctx.contextFillPercent(100_000, ONE_M), 10);
});

const seed = ({ fill = 0, window = ONE_M, estimated = false, output = 0 } = {}) => {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    settings: { ...prev.settings, language: 'en', numerals: 'western', model: { provider: 'custom', model: 'one-million' } },
    running: false,
    liveStreamChars: 0,
    ctxWindowEstimated: estimated,
    sessionUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    lastTurnUsage: fill > 0 || output > 0 ? usage(fill, output) : null,
    ctxWindow: window,
  });
};
const renderOrb = () => renderToStaticMarkup(React.createElement(mod.ContextLens, { compact: true }));
const arcInfo = (html) => {
  const el = html.match(/<circle[^>]*class="ctx-orb-arc"[^>]*>/);
  assert.ok(el, 'arc circle rendered');
  const dash = el[0].match(/stroke-dasharray="([\d.eE+-]+)\s+([\d.eE+-]+)"/);
  assert.ok(dash, 'stroke-dasharray present');
  return { arc: Number(dash[1]), circumference: Number(dash[2]) };
};

test('v1134: SSR orb shows a precise 10% / 90% and an exact 2πr arc at a 1M window', () => {
  for (const [fill, center] of [[100_000, '10%'], [900_000, '90%']]) {
    seed({ fill, window: ONE_M });
    const html = renderOrb();
    assert.ok(html.includes(`>${center}</span>`), `orb centre prints ${center}, not a rounded/fake value`);
    const { arc, circumference } = arcInfo(html);
    assert.ok(close(arc, (fill / ONE_M) * circumference), 'arc = exact fill/window × 2πr');
  }
});

test('v1134: SSR orb NEVER shows a false 100% when the real window has room', () => {
  // A 1M model mis-resolved to the ≈200k default, with 250k already used.
  seed({ fill: 250_000, window: 200_000, estimated: true });
  const html = renderOrb();
  assert.ok(html.includes('>250.0k</span>'), 'centre shows the honest token count');
  assert.doesNotMatch(html, />100%<\/span>/, 'no fabricated full ring');
  assert.match(html, /window size unknown/, 'tip reports the unknown / outgrown window');
  assert.equal(arcInfo(html).arc, 0, 'no percentage => empty arc');
});

// ------------------------------------------------------------
// 4 · SOURCE GUARDS — the real engine/lens/store use the fixed math
// ------------------------------------------------------------
test('v1134: engine compaction uses the REAL catalog window at 90%, never 65% of 200k', () => {
  assert.match(ENGINE_SRC, /openrouterContextFor\(params\.model\.model\)/, 'provider-reported window first');
  assert.match(ENGINE_SRC, /contextWindowInfo\(params\.model\.model\)/, 'curated catalog second');
  assert.match(ENGINE_SRC, /compactionThresholdTokens\(ctxWindowTokens\)/, 'shared 90% threshold');
  assert.match(ENGINE_SRC, /isCompactionEligible\(lastRealInputTokens, ctxWindowTokens\)/, 'shared eligibility');
  assert.doesNotMatch(ENGINE_SRC, /ctxWindowTokens \* 0\.65/, 'the aggressive 65% trigger is gone');
  assert.match(ENGINE_SRC, /if \(params\.task === 'compact'\)/, 'user /compact stays a separate path');
});

test('v1134: the lens uses honest percentage + disjoint segments; store advisory uses the real ceiling', () => {
  assert.match(LENS_SRC, /contextFillPercent\(fillShown, ctxWindow, ctxWindowEstimated\)/, 'honest orb percentage');
  assert.match(LENS_SRC, /occupancySegments\(usage, fillShown\)/, 'no double-painted fill + generated');
  assert.doesNotMatch(LENS_SRC, /pctOf\(totalTokens\)/, 'the old double-count segment is gone');
  assert.match(LENS_SRC, /api\s*\.modelInfo\(model\.model\)/, 'orb resolves the real window from the catalog');
  assert.match(STORE_SRC, /isCompactionEligible\(fill, windowTokens\)/, '/context advisory tracks the 90% ceiling');
});
