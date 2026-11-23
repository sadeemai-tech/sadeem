import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.26 — CONTEXT LENS STARTUP POSITION (founder's bug).
//
// Symptom: on the first window open the lens popover turned up in a corner /
// off-screen and could not be seen. Reading the render path showed two
// causes, both fixed in files this suite owns (ContextLens.tsx +
// context-orb.css), with NO Composer.tsx change and NO JS measurement:
//
//   1. The popover is `position:absolute` but the wrapper only carried
//      Tailwind's `relative` utility — at first paint it could resolve
//      against the initial containing block: `top:calc(100% + 8px)` =
//      below the viewport, `inset-inline-end:0` = viewport corner.
//      Fix: a self-contained `.ctx-orb-anchor { position: relative }` in
//      context-orb.css, always applied on the wrapper.
//   2. The orb was MOVED from the (top) chat header into the (bottom)
//      composer in v11.21, but the popover kept the header-era downward
//      `top: calc(100% + 8px)` anchor, so it opened below the fold.
//      Fix: the compact copy opens UPward (`bottom: calc(100% + 8px)`),
//      clamped to the viewport with a max inline size.
//
// This suite asserts the exact 2πr arc, single mount, bilingual/reduced-
// motion contract are all still intact after the position fix.
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

// The base popover rule still lives in chat-final.css (owned elsewhere);
// slice exactly that block so the assertions stay robust to renumbering.
const cssStart = CHAT_FINAL_CSS.indexOf('.lens-haircard {');
const cssEnd = CHAT_FINAL_CSS.indexOf('/* ====', cssStart + 10);
const POPOVER_CSS = CHAT_FINAL_CSS.slice(cssStart, cssEnd > cssStart ? cssEnd : CHAT_FINAL_CSS.length);
const popoverBody = POPOVER_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const orbBody = ORB_CSS.replace(/\/\*[\s\S]*?\*\//g, ''); // ignore doc comments

// v11.26 override block in the owned stylesheet.
const anchorBlock = (orbBody.match(/\.ctx-orb-anchor\s*\{[^}]*\}/) || [''])[0];
const compactAnchorBlock = (orbBody.match(/\.ctx-orb-anchor--compact \.lens-haircard\s*\{[^}]*\}/) || [''])[0];
const sizeBlock = (orbBody.match(/\.ctx-orb-anchor \.lens-haircard\s*\{[^}]*\}/) || [''])[0];

const BUNDLE = join(ROOT, 'tests', '.v1126-context-position.bundle.cjs');
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
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

const h = React.createElement;
const render = () => renderToStaticMarkup(h(mod.ContextLens, { compact: true }));

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
const COMPACT_RADIUS = (22 - 3.5) / 2;

// ------------------------------------------------------------
// 1 · CAUSE A — the wrapper is a SELF-CONTAINED positioned anchor
// ------------------------------------------------------------
test('v11.26: the orb wrapper is a positioned anchor (not a Tailwind-only relative)', () => {
  assert.match(LENS_SRC, /className=\{`ctx-orb-anchor\$\{compact \? ' ctx-orb-anchor--compact' : ''\} relative shrink-0`\}/,
    'the wrapper carries the explicit anchor class (and keeps Tailwind relative)');
  assert.match(anchorBlock, /position:\s*relative/, 'context-orb.css pins position:relative on the anchor');
  assert.match(anchorBlock, /flex:\s*0 0 auto/, 'anchor never shrinks beside the mic');
  assert.match(anchorBlock, /min-width:\s*0/, 'anchor is bounded in the flex row');
  assert.match(LENS_SRC, /ref=\{wrapRef\}/, 'the outside-click measurement ref is on the same wrapper');
});

test('v11.26: the popover is a CHILD of the positioned anchor, not a viewport-level sibling', () => {
  const wrapAt = LENS_SRC.indexOf('className={`ctx-orb-anchor');
  const popAt = LENS_SRC.indexOf('className="lens-haircard"');
  assert.ok(wrapAt >= 0 && popAt > wrapAt, 'popover markup is inside the anchored wrapper');
  // The wrapper closes only after the popover block ({open && ( ... )}).
  const openAt = LENS_SRC.indexOf('{open && (', wrapAt);
  assert.ok(openAt > wrapAt && openAt < popAt, 'the {open && (...)} popover is nested in the anchor div');
});

// ------------------------------------------------------------
// 2 · CAUSE B — compact popover opens INSIDE the viewport (upwards)
// ------------------------------------------------------------
test('v11.26: base popover uses wrapper-relative offsets, never position:fixed', () => {
  assert.match(popoverBody, /position:\s*absolute/, 'absolute inside the relative anchor');
  assert.match(popoverBody, /top:\s*calc\(100% \+ 8px\)/, 'base (header) anchor stays 8px below the orb');
  assert.doesNotMatch(popoverBody, /position:\s*fixed/, 'no viewport-level fixed positioning');
  assert.doesNotMatch(orbBody, /\.lens-haircard\s*\{[^}]*position:\s*fixed/, 'no fixed override in owned CSS');
});

test('v11.26: compact (bottom composer) popover is flipped upward, into the viewport', () => {
  assert.match(compactAnchorBlock, /top:\s*auto/, 'header-era downward top is cancelled');
  assert.match(compactAnchorBlock, /bottom:\s*calc\(100% \+ 8px\)/, 'opens 8px ABOVE the orb, on screen');
  assert.equal((compactAnchorBlock.match(/calc\(100% \+ 8px\)/g) || []).length, 1,
    'exactly one 8px anchor gap (no leftover top offset)');
});

test('v11.26: popover is viewport-safe with a max inline size — no JS measurement', () => {
  assert.match(sizeBlock, /max-width:\s*min\(280px,\s*calc\(100vw - 24px\)\)/, 'width clamped to viewport');
  assert.match(sizeBlock, /max-inline-size:\s*min\(280px,\s*calc\(100vw - 24px\)\)/, 'inline size clamped (RTL-safe)');
  // v11.26 real fix: the card is FIXED and measured from the orb's bounding
  // rect in a layout effect when OPEN (never at first paint / SSR), clamped to
  // the viewport. This is why it no longer lands in a corner inside Composer's
  // overflow/transform context. The CSS fallback remains for SSR.
  assert.match(LENS_SRC, /useLayoutEffect/, 'position is computed in a layout effect, after paint-ready layout');
  assert.match(LENS_SRC, /getBoundingClientRect/, 'card is anchored to the real orb box');
  assert.match(LENS_SRC, /position: 'fixed'/, 'card escapes Composer clipping with fixed positioning');
  assert.match(LENS_SRC, /window\.innerWidth|window\.innerHeight/, 'viewport clamp prevents off-screen placement');
});

// ------------------------------------------------------------
// 3 · RTL-safe logical inset (kept from the header era, still correct)
// ------------------------------------------------------------
test('v11.26: RTL-safe — logical inline-end anchoring + clamped inline size', () => {
  assert.match(popoverBody, /inset-inline-end:\s*0/, 'card follows writing direction (end edge of the orb)');
  assert.match(popoverBody, /text-align:\s*end/, 'mono values stay end-aligned in Arabic');
  assert.match(sizeBlock, /max-inline-size:/, 'logical max size, not physical width only');
});

// ------------------------------------------------------------
// 4 · ONE mount, no strip, bilingual + reduced motion intact
// ------------------------------------------------------------
test('v11.26: exactly ONE compact orb beside the mic, no duplicates', () => {
  const micAt = COMPOSER.indexOf('<VoiceInput');
  const orbAt = COMPOSER.indexOf('<ContextLens');
  assert.ok(micAt >= 0 && orbAt > micAt, 'orb mounted right after the voice mic');
  assert.equal((COMPOSER.match(/<ContextLens\b/g) || []).length, 1, 'one orb in the composer');
  assert.match(COMPOSER, /<ContextLens\s+compact\s*\/>/, 'compact copy');
  assert.doesNotMatch(CHAT_PANEL, /<ContextLens/, 'no header duplicate');
  assert.doesNotMatch(STATUS_BAR, /<ContextRingButton\s*\/>/, 'no status-bar duplicate');
});

test('v11.26: no ctx-meter strip remnants after the position fix', () => {
  const STRIP = /ctx-meter|ctx-track|ctx-fill|ctx-strip/i;
  assert.doesNotMatch(COMPOSER, STRIP, 'no strip in composer');
  assert.doesNotMatch(LENS_SRC, STRIP, 'no strip in ContextLens');
  assert.doesNotMatch(orbBody, STRIP, 'no strip in owned CSS');
  assert.doesNotMatch(popoverBody, STRIP, 'no strip in popover CSS');
});

test('v11.26: exact 2πr arc still driven by the real (unrounded) fill', () => {
  assert.match(LENS_SRC, /compact \? 22 : ORB_SIZE/, 'compact 22px size');
  assert.match(LENS_SRC, /const RADIUS = \(ORB - 3\.5\) \/ 2/, 'radius per size');
  assert.match(LENS_SRC, /orbArcLength\(pctExact, RADIUS\)/, 'arc from raw pctExact');
  assert.match(LENS_SRC, /strokeDasharray=\{`\$\{orbArc\} \$\{CIRC\}`\}/, 'exact arc + circumference');
  seed(100_000, 200_000, 'en');
  const { arc, circumference, r } = arcInfo(render());
  assert.ok(close(r, COMPACT_RADIUS), 'rendered radius = compact radius');
  assert.ok(close(circumference, 2 * Math.PI * r), 'dasharray total = 2πr');
  assert.ok(close(arc, Math.PI * r), '50% arc = exact πr');
});

test('v11.26: reduced-motion guarded and bilingual label preserved', () => {
  assert.match(ORB_CSS, /@media \(prefers-reduced-motion: reduce\)/, 'orb OS guard');
  assert.match(ORB_CSS, /html\.reduce-motion \.ctx-orb/, 'orb app guard');
  assert.match(popoverBody, /html\.reduce-motion \.lens-haircard/, 'popover app guard');
  assert.match(I18N, /'chat\.lens\.title': \['Context lens', 'عدسة السياق'\]/,
    'bilingual context-lens label intact');
  seed(100_000, 200_000, 'ar');
  const html = render();
  assert.match(html, /class="ctx-orb-anchor ctx-orb-anchor--compact relative shrink-0"/,
    'AR SSR still renders the positioned anchor');
  assert.match(html, /class="ctx-orb ctx-orb--compact"/, 'AR compact orb still renders');
});

// ------------------------------------------------------------
// 5 · SSR: the wrapper is present & positioned at first paint
// ------------------------------------------------------------
test('v11.26: SSR renders the positioned anchor with the orb at startup (EN + AR)', () => {
  for (const lang of ['en', 'ar']) {
    seed(100_000, 200_000, lang);
    const html = render();
    assert.match(html, /^<div class="ctx-orb-anchor ctx-orb-anchor--compact relative shrink-0">/,
      'first painted node is the self-contained positioned anchor');
    assert.match(html, /<button class="ctx-orb ctx-orb--compact"/, 'orb sits inside the anchor');
    assert.match(html, /aria-expanded="false"/, 'closed at startup, opens on click');
    assert.equal((html.match(/class="ctx-orb-arc"/g) || []).length, 1, 'exactly one arc ring');
    assert.equal((html.match(/<svg\b/g) || []).length, 1, 'exactly one orb svg');
    assert.doesNotMatch(html, /lens-haircard/, 'popover not painted until opened');
  }
});
