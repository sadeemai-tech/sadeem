import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.27 — THE CONTEXT ORB IS ALWAYS VISIBLE (founder's bug).
//
// Symptom: "تبويبة الكونتيكس لا تضهر" — on a FRESH session (before the first
// provider usage report) ContextLens.tsx returned `null` via
// `if (!hasData) return null`, so there was no orb beside the mic at all.
//
// This suite SSRs the REAL compact component at zero usage and proves:
//   1. the orb IS mounted at startup (one anchor, one button, one arc/svg);
//   2. the no-data centre is HONEST ("—" = not measured yet, never a fake
//      "0%" / blank), the arc is a 0-length 2πr arc, the tip says the window
//      is unknown;
//   3. an `unknown` window WITH data shows a real token count, not a blank;
//   4. with real usage the arc is still the EXACT unrounded 2πr percentage;
//   5. one mount beside the mic, no ctx-meter, reduced-motion + the v11.26
//      fixed/viewport-clamped popover all still intact.
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const LENS_SRC = read('src', 'components', 'ContextLens.tsx');
const ORB_CSS = read('src', 'components', 'context-orb.css');
const COMPOSER = read('src', 'components', 'Composer.tsx');
const CHAT_PANEL = read('src', 'components', 'ChatPanel.tsx');
const STATUS_BAR = read('src', 'components', 'StatusBar.tsx');

const BUNDLE = join(ROOT, 'tests', '.v1127-context-visible.bundle.cjs');
let mod;
let React;
let renderToStaticMarkup;

before(() => {
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
        "export { ContextLens, ORB_SIZE, ORB_STROKE, ORB_RADIUS, ORB_CIRCUMFERENCE, orbArcLength } from './src/components/ContextLens';" +
        "export { useStore } from './src/store';",
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLE,
    loader: { '.css': 'empty' },
    external: ['electron', 'react', 'react/jsx-runtime', 'react-dom', 'lucide-react'],
  });
  mod = require(BUNDLE);
  React = require('react');
  // SSR's getServerSnapshot reads the INITIAL store state; make it read the
  // live seeded state so each branch actually executes.
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

const h = React.createElement;
const render = () => renderToStaticMarkup(h(mod.ContextLens, { compact: true }));

/** Seed the real slices the component reads. `usage` may be null (fresh session). */
function seed(usage, ctxWindow, lang = 'en') {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    settings: {
      ...prev.settings,
      language: lang,
      numerals: 'western',
      model: { provider: 'custom', model: 'm' },
    },
    running: false,
    liveStreamChars: 0,
    ctxWindowEstimated: false,
    sessionUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    lastTurnUsage: usage,
    ctxWindow,
  });
}

/** Fresh session: NO provider usage at all + unknown window. */
const seedEmpty = (lang = 'en') => seed(null, 0, lang);
/** A real provider report of `fill` input tokens into a known window. */
const seedReal = (fill, ctxWindow, lang = 'en') =>
  seed({ inputTokens: fill, outputTokens: 0, costUsd: 0 }, ctxWindow, lang);

function arcInfo(html) {
  const el = html.match(/<circle[^>]*class="ctx-orb-arc"[^>]*>/);
  assert.ok(el, 'the progress arc <circle> is rendered');
  const dash = el[0].match(/stroke-dasharray="([\d.eE+-]+)\s+([\d.eE+-]+)"/);
  assert.ok(dash, 'stroke-dasharray is present on the arc');
  const r = el[0].match(/\sr="([\d.eE+-]+)"/);
  assert.ok(r, 'radius is present on the arc');
  return { arc: Number(dash[1]), circumference: Number(dash[2]), r: Number(r[1]) };
}

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const COMPACT_RADIUS = (22 - 3.5) / 2; // 9.25 — mirrors ContextLens.tsx

// ------------------------------------------------------------
// 0 · SOURCE GUARD — the visibility gate is gone
// ------------------------------------------------------------
test('v11.27: no `if (!hasData) return null` gate remains in ContextLens', () => {
  assert.doesNotMatch(LENS_SRC, /if\s*\(\s*!hasData\s*\)\s*return null/,
    'the orb is no longer hidden on a fresh session');
  assert.match(LENS_SRC, /const noData = !hasData/, 'hasData now only drives the honest centre label');
});

// ------------------------------------------------------------
// 1 · SSR AT ZERO USAGE — the orb IS present and honest
// ------------------------------------------------------------
test('v11.27: SSR with zero usage mounts the compact orb (anchor + button + one arc)', () => {
  seedEmpty('en');
  const html = render();
  assert.match(html, /^<div class="ctx-orb-anchor ctx-orb-anchor--compact relative shrink-0">/,
    'first painted node is the positioned anchor — NOT an empty render');
  assert.match(html, /<button class="ctx-orb ctx-orb--compact"/, 'the compact orb button is beside the mic');
  assert.match(html, /aria-expanded="false"/, 'closed at startup, opens on click');
  assert.equal((html.match(/class="ctx-orb-arc"/g) || []).length, 1, 'exactly one arc ring');
  assert.equal((html.match(/<svg\b/g) || []).length, 1, 'exactly one orb svg');
  assert.match(html, /ctx-orb-ring" aria-hidden="true"/, 'ring stays decorative for a11y');
});

test('v11.27: zero usage shows an HONEST centre + unknown tip, never blank / fake 0%', () => {
  seedEmpty('en');
  const html = render();
  assert.ok(html.includes('>—</span>'), 'centre is the em-dash "not measured yet"');
  assert.doesNotMatch(html, />0%<\/span>/, 'no misleading "0%" implying a known empty window');
  assert.doesNotMatch(html, /class="ctx-orb-value bidi-num" dir="ltr"><\/span>/, 'centre is never blank');
  assert.match(html, /window size unknown/, 'tooltip honestly reports the missing window');
});

test('v11.27: zero usage renders an empty but exact 2πr arc (honest 0)', () => {
  seedEmpty('en');
  const { arc, circumference, r } = arcInfo(render());
  assert.ok(close(r, COMPACT_RADIUS), 'rendered radius = compact 2πr radius');
  assert.ok(close(circumference, 2 * Math.PI * r), 'dasharray total = 2πr');
  assert.equal(arc, 0, 'no data paints a zero-length arc — no invented fill');
});

test('v11.27: a zero-token Usage object (not just null) still shows the orb', () => {
  seed({ inputTokens: 0, outputTokens: 0, costUsd: 0 }, 200_000, 'en');
  const html = render();
  assert.match(html, /<button class="ctx-orb ctx-orb--compact"/, 'orb present with a known window but no report');
  assert.ok(html.includes('>—</span>'), 'still the honest dash until a provider reports');
  assert.equal(arcInfo(html).arc, 0, 'arc stays empty');
});

// ------------------------------------------------------------
// 2 · UNKNOWN WINDOW — an honest label instead of a blank
// ------------------------------------------------------------
test('v11.27: unknown window WITH data shows the token count, not a blank or fake percentage', () => {
  seedReal(1234, 0, 'en');
  const html = render();
  assert.ok(html.includes('>1.2k</span>'), 'centre shows the honest token count');
  assert.doesNotMatch(html, />\d+%<\/span>/, 'no percentage invented without a window');
  assert.match(html, /window size unknown/, 'tip explains the missing window');
  assert.equal(arcInfo(html).arc, 0, 'no percentage => no painted arc');
});

// ------------------------------------------------------------
// 3 · REAL USAGE — the exact arc is unchanged
// ------------------------------------------------------------
test('v11.27: real usage keeps the exact unrounded 2πr arc', () => {
  seedReal(100_000, 200_000, 'en');
  const html = render();
  const { arc, circumference, r } = arcInfo(html);
  assert.ok(close(r, COMPACT_RADIUS), 'compact radius unchanged');
  assert.ok(close(circumference, 2 * Math.PI * r), 'dasharray total = 2πr');
  assert.ok(close(arc, Math.PI * r), '50% arc = exact πr');
  assert.ok(html.includes('>50%</span>'), 'centre prints the rounded percentage');
  assert.match(LENS_SRC, /orbArcLength\(pctExact, RADIUS\)/, 'arc still driven by raw pctExact');
});

// ------------------------------------------------------------
// 4 · ONE mount, no strip, reduced motion, v11.26 popover intact
// ------------------------------------------------------------
test('v11.27: exactly ONE compact orb beside the mic, no duplicates / strip', () => {
  const micAt = COMPOSER.indexOf('<VoiceInput');
  const orbAt = COMPOSER.indexOf('<ContextLens');
  assert.ok(micAt >= 0 && orbAt > micAt, 'orb mounted right after the voice mic');
  assert.equal((COMPOSER.match(/<ContextLens\b/g) || []).length, 1, 'one orb in the composer');
  assert.doesNotMatch(CHAT_PANEL, /<ContextLens/, 'no header duplicate');
  assert.doesNotMatch(STATUS_BAR, /<ContextRingButton\s*\/>/, 'no status-bar duplicate');

  const STRIP = /ctx-meter|ctx-track|ctx-fill|ctx-strip/i;
  assert.doesNotMatch(COMPOSER, STRIP, 'no strip in composer');
  assert.doesNotMatch(LENS_SRC, STRIP, 'no strip in ContextLens');
  assert.doesNotMatch(read('src', 'components', 'context-orb.css'), STRIP, 'no strip in owned CSS');
});

test('v11.27: reduced-motion guard and the fixed, viewport-clamped popover are intact', () => {
  assert.match(ORB_CSS, /@media \(prefers-reduced-motion: reduce\)/, 'OS guard');
  assert.match(ORB_CSS, /html\.reduce-motion \.ctx-orb/, 'app guard');
  assert.match(LENS_SRC, /useLayoutEffect/, 'position measured after layout');
  assert.match(LENS_SRC, /getBoundingClientRect/, 'card pinned to the real orb box');
  assert.match(LENS_SRC, /position: 'fixed'/, 'card escapes Composer clipping');
  assert.match(LENS_SRC, /window\.innerWidth|window\.innerHeight/, 'viewport clamp kept');
  assert.match(ORB_CSS, /\.ctx-orb-anchor\s*\{[^}]*position:\s*relative/, 'positioned anchor kept');
});
