import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.24 — COMPOSER ORB POLISH (founder's request).
//
// The composer must carry EXACTLY ONE context orb, beside the voice mic:
// no straight strip, no duplicates. This suite SSRs the real `compact`
// ContextLens at 0 / 50 / 100 and proves:
//   1. one compact mount beside the mic, no strip/duplicates anywhere;
//   2. the arc is the exact 2πr of the REAL fill percentage (never rounded);
//   3. reduced-motion guarded, bilingual label, EN+AR monolingual renders;
//   4. the popover art polish: precise 1px hairlines, aligned mono values,
//      one calm settle — no glow / gradient / blur, RTL-safe. Orb data/geometry
//      are NOT touched (that is B1's file).
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const LENS_SRC = read('src', 'components', 'ContextLens.tsx');
const ORB_CSS = read('src', 'components', 'context-orb.css');
const CHAT_FINAL_CSS = read('src', 'components', 'chat-final.css');
const COMPOSER = read('src', 'components', 'Composer.tsx');
const CHAT_PANEL = read('src', 'components', 'ChatPanel.tsx');
const STATUS_BAR = read('src', 'components', 'StatusBar.tsx');
const I18N = read('src', 'i18n.ts');

// Isolate just the ContextLens popover block (section 7) of chat-final.css.
// v11.24 — section headings were renumbered; slice by the actual selector,
// not a brittle "7 · CONTEXT LENS" heading that moves every wave.
const cssStart = CHAT_FINAL_CSS.indexOf('.lens-haircard {');
const cssEnd = CHAT_FINAL_CSS.indexOf('/* ====', cssStart + 10);
const POPOVER_CSS = CHAT_FINAL_CSS.slice(cssStart, cssEnd > cssStart ? cssEnd : CHAT_FINAL_CSS.length);
const popoverBody = POPOVER_CSS.replace(/\/\*[\s\S]*?\*\//g, ''); // drop doc comments

const BUNDLE = join(ROOT, 'tests', '.v1124-composer-orb.bundle.cjs');
let mod;
let React;
let renderToStaticMarkup;

before(() => {
  // Minimal browser stubs installed BEFORE the store bundle loads.
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
  // live seeded state so each pct branch actually executes.
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

const h = React.createElement;
// The composer mounts the COMPACT copy — that is the one under test.
const render = () => renderToStaticMarkup(h(mod.ContextLens, { compact: true }));
const ARABIC = /[\u0600-\u06FF]/;
const LATIN = /[A-Za-z]/;

/** Seed the REAL data slices the component reads (fill / window / language). */
function seed(fill, ctxWindow, lang = 'en') {
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
    lastTurnUsage: { inputTokens: fill, outputTokens: 0, costUsd: 0 },
    ctxWindow,
  });
}

/** Pull the arc circle's exact numbers straight out of the rendered markup. */
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
const COMPACT_RADIUS = (22 - 3.5) / 2; // 9.25 — must mirror ContextLens.tsx

// ------------------------------------------------------------
// 1 · EXACT PLACEMENT — one mount, beside the mic, no strip
// ------------------------------------------------------------
test('v11.24: exactly ONE compact orb, mounted beside the voice mic', () => {
  const micAt = COMPOSER.indexOf('<VoiceInput');
  const orbAt = COMPOSER.indexOf('<ContextLens');
  assert.ok(micAt >= 0 && orbAt > micAt, 'the orb is mounted right after the voice-input mic');
  assert.equal((COMPOSER.match(/<ContextLens\b/g) || []).length, 1, 'exactly one orb in the composer');
  assert.match(COMPOSER, /<ContextLens\s+compact\s*\/>/, 'it is the compact copy');
  assert.doesNotMatch(CHAT_PANEL, /<ContextLens/, 'no duplicate ring in the chat header');
  assert.doesNotMatch(STATUS_BAR, /<ContextRingButton\s*\/>/, 'no duplicate ring in the status bar');
});

test('v11.24: no ctx-meter strip remnants in the composer / lens / popover', () => {
  const STRIP = /ctx-meter|ctx-track|ctx-fill|ctx-strip/i;
  assert.doesNotMatch(COMPOSER, STRIP, 'no straight strip in the composer');
  assert.doesNotMatch(LENS_SRC, STRIP, 'no straight strip in ContextLens');
  assert.doesNotMatch(popoverBody, STRIP, 'no straight strip in the popover CSS');
});

// ------------------------------------------------------------
// 2 · PURE GEOMETRY — exact 2πr at the compact radius
// ------------------------------------------------------------
test('v11.24: orbArcLength is exact 2πr at 0 / 50 / 100 (no rounding)', () => {
  assert.equal(mod.ORB_SIZE, 32, 'full-size geometry constant unchanged');
  assert.ok(close(COMPACT_RADIUS, 9.25), 'compact radius = (22 - 3.5) / 2');
  assert.ok(close(2 * Math.PI * COMPACT_RADIUS, 2 * Math.PI * 9.25), 'circumference = 2πr');
  assert.equal(mod.orbArcLength(0, COMPACT_RADIUS), 0, '0% -> zero arc');
  assert.ok(close(mod.orbArcLength(50, COMPACT_RADIUS), Math.PI * COMPACT_RADIUS), '50% -> πr');
  assert.ok(close(mod.orbArcLength(100, COMPACT_RADIUS), 2 * Math.PI * COMPACT_RADIUS), '100% -> full 2πr');
  assert.equal(mod.orbArcLength(-10, COMPACT_RADIUS), 0, 'clamped low');
  assert.ok(close(mod.orbArcLength(140, COMPACT_RADIUS), 2 * Math.PI * COMPACT_RADIUS), 'clamped high');
  // the component still derives the arc from the UNROUNDED pct, per size
  assert.match(LENS_SRC, /compact \? 22 : ORB_SIZE/, 'compact size is 22px');
  assert.match(LENS_SRC, /const RADIUS = \(ORB - 3\.5\) \/ 2/, 'radius recomputed per size');
  assert.match(LENS_SRC, /orbArcLength\(pctExact, RADIUS\)/, 'arc driven by raw pctExact');
  assert.match(LENS_SRC, /strokeDasharray=\{`\$\{orbArc\} \$\{CIRC\}`\}/, 'exact arc + circumference in dasharray');
});

// ------------------------------------------------------------
// 3 · SSR at 0 / 50 / 100 — the compact orb, arc = real usage
// ------------------------------------------------------------
const CASES = [
  { name: '0%', fill: 1, window: 1_000_000_000, center: '0%' }, // ~0 (lens stays visible: fill > 0)
  { name: '50%', fill: 100_000, window: 200_000, center: '50%' },
  { name: '100%', fill: 200_000, window: 200_000, center: '100%' },
];

for (const c of CASES) {
  test(`v11.24: SSR compact orb at ${c.name} renders exact usage arc`, () => {
    seed(c.fill, c.window, 'en');
    const html = render();
    // one compact orb, no strip chip, no header label duplicate
    assert.match(html, /class="ctx-orb ctx-orb--compact"/, 'the single compact orb');
    assert.equal((html.match(/class="ctx-orb-arc"/g) || []).length, 1, 'exactly one arc ring');
    assert.equal((html.match(/<svg\b/g) || []).length, 1, 'exactly one ring svg');
    assert.doesNotMatch(html, /ctx-orb-label/, 'compact copy has no header-label duplicate');
    assert.match(html, /ctx-orb-ring" aria-hidden="true"/, 'ring is decorative for a11y');
    assert.match(html, /aria-expanded="false"/, 'click/expand contract preserved');
    assert.match(html, /viewBox="0 0 22 22"/, '22px compact viewBox');
    assert.match(html, /width="22" height="22"/, '22px compact render size');

    const { arc, circumference, r } = arcInfo(html);
    assert.ok(close(r, COMPACT_RADIUS), 'rendered radius = compact 2πr radius');
    assert.ok(close(circumference, 2 * Math.PI * r), 'dasharray total = 2πr');
    const exactPct = Math.min(100, (c.fill / c.window) * 100);
    assert.ok(close(arc, (exactPct / 100) * 2 * Math.PI * r), `${c.name} arc = exact pct × 2πr`);

    // centre prints the rounded percent (mono, LTR); geometry stays exact
    assert.ok(html.includes(`>${c.center}</span>`), `centre shows ${c.center}`);
    assert.match(html, /class="ctx-orb-value bidi-num" dir="ltr"/, 'mono value is LTR-safe');
  });
}

test('v11.24: 100% arc is a full ring and ~0% arc is effectively empty', () => {
  seed(200_000, 200_000, 'en');
  const full = arcInfo(render());
  assert.ok(close(full.arc, full.circumference), '100% closes the circle');

  seed(1, 1_000_000_000, 'en');
  const empty = arcInfo(render());
  assert.ok(empty.arc < 1e-4, '~0% paints no visible arc');
});

// ------------------------------------------------------------
// 4 · BILINGUAL LABEL + EN/AR MONOLINGUAL RENDERS
// ------------------------------------------------------------
function visibleText(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

function attributes(html) {
  return (html.match(/(?:title|aria-label)="([^"]*)"/g) || [])
    .map((m) => m.replace(/^(?:title|aria-label)="/, '').replace(/"$/, ''))
    .join(' ');
}

test('v11.24: the orb label is bilingual (EN + AR) in the i18n table', () => {
  assert.match(I18N, /'chat\.lens\.title': \['Context lens', 'عدسة السياق'\]/,
    'chat.lens.title has both an English and an Arabic value');
});

for (const lang of ['en', 'ar']) {
  test(`v11.24: ${lang} compact SSR is monolingual`, () => {
    for (const c of CASES) {
      seed(c.fill, c.window, lang);
      const html = render();
      const text = visibleText(html).trim();
      const attrs = attributes(html);
      if (lang === 'en') {
        assert.equal(text, c.center, 'only the LTR numeric value is visible');
        assert.doesNotMatch(attrs, ARABIC, 'no Arabic in EN title/aria');
        assert.match(attrs, /Context lens/, 'EN bilingual label present');
      } else {
        assert.equal(text, c.center, 'only the LTR numeric value is visible');
        assert.match(attrs, ARABIC, 'Arabic label present');
        assert.doesNotMatch(attrs, LATIN, 'no English words in AR title/aria');
        assert.match(attrs, /عدسة السياق/, 'AR bilingual label present');
      }
    }
  });
}

// ------------------------------------------------------------
// 5 · REDUCED MOTION + POPOVER ART (no glow/gradient/blur, RTL-safe)
// ------------------------------------------------------------
test('v11.24: both orb and popover are reduced-motion guarded', () => {
  assert.match(ORB_CSS, /@media \(prefers-reduced-motion: reduce\)/, 'orb respects OS reduce-motion');
  assert.match(ORB_CSS, /html\.reduce-motion \.ctx-orb/, 'orb respects app reduce flag');
  assert.match(ORB_CSS, /transition: none !important/, 'orb transitions hard-stopped');
  assert.match(POPOVER_CSS, /@media \(prefers-reduced-motion: reduce\)/, 'popover respects OS reduce-motion');
  assert.match(POPOVER_CSS, /html\.reduce-motion \.lens-haircard/, 'popover respects app reduce flag');
  assert.match(POPOVER_CSS, /animation: none !important/, 'popover settle hard-stopped');
});

test('v11.24: popover has a calm ONE-SHOT settle, 1px hairlines, aligned mono, no glow/gradient/blur, RTL-safe', () => {
  assert.match(popoverBody, /@keyframes lens-settle/, 'dedicated settle keyframes');
  assert.match(popoverBody, /animation: lens-settle [^;]*both\b/, 'one-shot (both) settle on the card');
  assert.doesNotMatch(popoverBody, /infinite/, 'settle never loops');
  assert.doesNotMatch(popoverBody, /gradient|box-shadow|glow|filter:|backdrop-filter|text-shadow/i,
    'no gradients, glows, blur or shadows');

  assert.match(popoverBody, /border: 1px solid var\(--line\)/, 'exact 1px card hairline');
  assert.equal((popoverBody.match(/border-bottom: 1px solid var\(--line-soft\)/g) || []).length, 2,
    'header + stats separated by exact 1px hairlines');
  assert.match(popoverBody, /font-variant-numeric: tabular-nums/, 'aligned tabular mono values');
  assert.match(popoverBody, /\.lens-haircard \.bidi-num/, 'mono alignment scoped to card values');

  assert.match(popoverBody, /inset-inline-end: 0/, 'RTL-safe card anchoring');
  assert.match(popoverBody, /text-align: end/, 'RTL-safe value alignment');
});
