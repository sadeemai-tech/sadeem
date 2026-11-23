import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.21 — CONTEXT ORB (the founder's request).
//
// The straight context strip in ContextLens is REPLACED by a radial donut that
// reuses the status-bar circle art language. This suite SSRs the real
// component at pct 0 / 50 / 100 and proves:
//   1. the ring arc is the exact 2πr usage percentage (no rounding breaks it);
//   2. rendering never crashes and keeps the click/expand + a11y contract;
//   3. a single render is monolingual — no mixed EN + AR values.
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const LENS_SRC = readFileSync(join(ROOT, 'src', 'components', 'ContextLens.tsx'), 'utf8');
const ORB_CSS = readFileSync(join(ROOT, 'src', 'components', 'context-orb.css'), 'utf8');

const BUNDLE = join(ROOT, 'tests', '.v1121-context-orb.bundle.cjs');
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
const render = () => renderToStaticMarkup(h(mod.ContextLens));
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

// ------------------------------------------------------------
// 1 · pure 2πr geometry at the exact boundaries
// ------------------------------------------------------------
test('v11.21: orbArcLength is exact 2πr geometry at 0 / 50 / 100', () => {
  const r = mod.ORB_RADIUS;
  assert.equal(mod.ORB_SIZE, 32, 'compact 32px orb fits the chat header/footer');
  assert.ok(close(mod.ORB_CIRCUMFERENCE, 2 * Math.PI * r), 'circumference = 2πr');
  assert.equal(mod.orbArcLength(0, r), 0, '0% -> zero arc');
  assert.ok(close(mod.orbArcLength(50, r), Math.PI * r), '50% -> πr half-circle');
  assert.ok(close(mod.orbArcLength(100, r), 2 * Math.PI * r), '100% -> full 2πr');
  // out-of-range input is clamped, never overshoots the ring
  assert.equal(mod.orbArcLength(-10, r), 0);
  assert.ok(close(mod.orbArcLength(140, r), 2 * Math.PI * r));
});

// ------------------------------------------------------------
// 2 · SSR at 0 / 50 / 100 — arc matches the REAL data, never crashes
// ------------------------------------------------------------
const CASES = [
  { name: '0%', fill: 1, window: 1_000_000_000, center: '0%' }, // ~0 (lens stays visible: fill > 0)
  { name: '50%', fill: 100_000, window: 200_000, center: '50%' },
  { name: '100%', fill: 200_000, window: 200_000, center: '100%' },
];

for (const c of CASES) {
  test(`v11.21: SSR at ${c.name} renders a circular orb whose arc = exact usage`, () => {
    seed(c.fill, c.window, 'en');
    const html = render();
    assert.match(html, /class="ctx-orb"/, 'strip replaced by the orb button');
    assert.doesNotMatch(html, /class="chip font-code/, 'no straight strip chip remains');
    assert.match(html, /class="ctx-orb-label"/, 'small label present');
    assert.match(html, /aria-expanded="false"/, 'click/expand contract preserved');
    assert.match(html, /ctx-orb-ring" aria-hidden="true"/, 'ring is decorative for a11y');

    const { arc, circumference, r } = arcInfo(html);
    const exactPct = Math.min(100, (c.fill / c.window) * 100);
    assert.ok(close(circumference, 2 * Math.PI * r), 'dasharray total = 2πr');
    assert.ok(close(arc, (exactPct / 100) * 2 * Math.PI * r), `${c.name} arc = exact pct × 2πr`);
    // the centre prints the rounded percent (mono, LTR digits), geometry stays exact
    assert.ok(html.includes(`>${c.center}</span>`), `centre shows ${c.center}`);
    assert.match(html, /class="ctx-orb-value bidi-num" dir="ltr"/, 'mono percentage is LTR-safe');
  });
}

test('v11.21: 100% arc is a full ring and ~0% arc is effectively empty', () => {
  seed(200_000, 200_000, 'en');
  const full = arcInfo(render());
  assert.ok(close(full.arc, full.circumference), '100% closes the circle');

  seed(1, 1_000_000_000, 'en');
  const empty = arcInfo(render());
  assert.ok(empty.arc < 1e-4, '~0% paints no visible arc');
});

// ------------------------------------------------------------
// 3 · monolingual renders (no mixed EN + AR values)
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

for (const lang of ['en', 'ar']) {
  test(`v11.21: ${lang} SSR is monolingual (no mixed EN + AR values)`, () => {
    for (const c of CASES) {
      seed(c.fill, c.window, lang);
      const html = render();
      const text = visibleText(html);
      const attrs = attributes(html);
      assert.ok(text.trim().length > 0, 'has visible label text');
      if (lang === 'en') {
        assert.doesNotMatch(text, ARABIC, 'no Arabic glyphs in EN orb text');
        assert.ok(LATIN.test(text), 'EN label present');
        assert.doesNotMatch(attrs, ARABIC, 'no Arabic in EN title/aria');
      } else {
        assert.match(text, ARABIC, 'Arabic label present');
        assert.doesNotMatch(text, LATIN, 'no Latin letters in AR orb text');
        assert.doesNotMatch(attrs, LATIN, 'no English words in AR title/aria');
      }
    }
  });
}

// ------------------------------------------------------------
// 4 · source-level guards — reduced motion, palette, no gradients/glows
// ------------------------------------------------------------
test('v11.21: orb reuses 2πr math from real pctExact, not a rounded value', () => {
  // v11.21: the orb now has a `compact` composer copy (same geometry, smaller
  // size), so the exact radius/circumference are computed per size — still
  // unrounded pctExact × 2πr, never a rounded percentage.
  assert.match(LENS_SRC, /orbArcLength\(pctExact, RADIUS\)/, 'arc driven by the unrounded pctExact');
  assert.match(LENS_SRC, /2 \* Math\.PI \* RADIUS/, 'exact 2πr formula per size');
  assert.match(LENS_SRC, /strokeDasharray=\{`\$\{orbArc\} \$\{CIRC\}`\}/, 'dasharray uses exact arc + circumference');
  assert.match(LENS_SRC, /import '\.\/context-orb\.css'/, 'orb styles imported');
});

test('v11.21: reduced-motion guarded (media query + html.reduce-motion), tokens only', () => {
  assert.match(ORB_CSS, /@media \(prefers-reduced-motion: reduce\)/, 'OS reduced-motion respected');
  assert.match(ORB_CSS, /html\.reduce-motion \.ctx-orb/, 'app reduce-motion flag respected');
  assert.match(ORB_CSS, /transition: none !important/, 'transitions hard-stopped under reduce flag');
  const body = ORB_CSS.replace(/\/\*[\s\S]*?\*\//g, ''); // ignore the documentation comment
  assert.doesNotMatch(body, /gradient|box-shadow|glow|filter:/i, 'no gradients, glows or shadows');
  assert.match(LENS_SRC, /'var\(--acc\)'/, 'unchanged accent palette');
});

// ------------------------------------------------------------
// 5 · PLACEMENT — exactly ONE context ring, beside the voice mic
// ------------------------------------------------------------
test('v11.21: the context ring is MOVED — one mount, in the composer beside the mic, no strip/duplicates', () => {
  const composer = readFileSync(join(ROOT, 'src', 'components', 'Composer.tsx'), 'utf8');
  const chatPanel = readFileSync(join(ROOT, 'src', 'components', 'ChatPanel.tsx'), 'utf8');
  const statusBar = readFileSync(join(ROOT, 'src', 'components', 'StatusBar.tsx'), 'utf8');

  // The single mount: compact orb immediately after the voice input.
  const micAt = composer.indexOf('<VoiceInput');
  const orbAt = composer.indexOf('<ContextLens compact />');
  assert.ok(micAt >= 0 && orbAt > micAt,
    'the orb is mounted right after the voice-input mic in the composer');
  assert.equal((composer.match(/<ContextLens\s/g) || []).length, 1, 'exactly one orb in the composer');

  // The other two copies are GONE, not merely hidden.
  assert.doesNotMatch(chatPanel, /<ContextLens/, 'no duplicate ring in the chat header');
  assert.doesNotMatch(statusBar, /<ContextRingButton\s*\/>/, 'no duplicate ring in the status bar');

  // The old straight strip is gone from source and from CSS rules it used.
  assert.doesNotMatch(composer, /ctx-meter|ctx-track|ctx-fill/, 'the straight context strip is removed');
  const chatCss = readFileSync(join(ROOT, 'src', 'components', 'chat.css'), 'utf8');
  assert.doesNotMatch(chatCss, /\.sc-ctx \.ctx-track|\.sc-ctx \.ctx-fill/, 'dead strip CSS removed');
});
