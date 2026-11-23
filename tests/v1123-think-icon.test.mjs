import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.23 — THE THINK NODE IS A CIRCLE, NOT THE APP LOGO.
//
// The founder (furious): "شيلها شيلها شيلها وحط بدالها الدائرة" —
// remove the app-logo icon beside THINK and put a circle in its place.
//
// Two layers, both against the real files:
//   1. SOURCE — no Logo import / JSX, no brand flag / violet brand-halo class;
//      ThinkOrbit reuses PHASE_MARKS.think (integer radii, 1px currentColor),
//      has an equal-angle node + core, an exact 12-o'clock tick, no FX, and is
//      guarded by BOTH prefers-reduced-motion and html.reduce-motion.
//   2. SSR — the think band mounts ThinkOrbit at sc18-node-ico (hooks kept),
//      animates only when live, and parks at 12 o'clock when the host asks for
//      reduced motion. Other bands keep their lucide glyphs.
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

const BUNDLE = join(ROOT, 'tests', '.v1123-think-icon.bundle.cjs');
let mod;
let React;
let renderToStaticMarkup;

before(() => {
  // Browser stubs installed before the bundle is required (same posture as
  // v1116-chat-precision / v1122-graphics-msg). Motion is allowed by default.
  globalThis.window = {
    surnia: new Proxy({}, {
      get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : () => Promise.resolve(undefined)),
    }),
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false }),
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
    body: { appendChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {} }),
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  esbuild.buildSync({
    stdin: {
      contents: "export { StreamBandShell, BAND_META } from './src/components/StreamTimeline';",
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: BUNDLE,
    loader: { '.css': 'empty' },
    external: ['electron', 'react', 'react-dom', 'lucide-react'],
  });
  mod = require(BUNDLE);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

const h = (...a) => React.createElement(...a);
const timelineSrc = src('src/components/StreamTimeline.tsx');
const count = (hay, needle) => hay.split(needle).length - 1;
const between = (start, end) => {
  const a = timelineSrc.indexOf(start);
  assert.ok(a >= 0, `marker present: ${start}`);
  const b = timelineSrc.indexOf(end, a);
  assert.ok(b > a, `end marker present: ${end}`);
  return timelineSrc.slice(a, b);
};

const thinkMarkSrc = between('  think: (', '  work: (');
const orbitSrc = between('function thinkMotionAllowed', '/** "512ms"');

const renderBand = (phase, live) => renderToStaticMarkup(
  h(mod.StreamBandShell, {
    phase, live, label: phase, startAt: 1700000000000, count: 1,
  }, h('div', null, 'items')),
);

// ------------------------------------------------------------
// 1 · SOURCE — the logo / brand treatment is GONE
// ------------------------------------------------------------
test('StreamTimeline carries no Logo import, no ThinkBrand, no brand flag or halo', () => {
  assert.ok(!timelineSrc.includes("import { Logo }"), 'no Logo import in StreamTimeline');
  assert.ok(!/<Logo\b/.test(timelineSrc), 'no <Logo> JSX anywhere in StreamTimeline');
  assert.ok(!timelineSrc.includes('ThinkBrand'), 'ThinkBrand wrapper deleted');
  assert.ok(!timelineSrc.includes('brand: true'), 'brand: true removed from BAND_META');
  assert.ok(!timelineSrc.includes('brand?:'), 'brand field removed from BandMeta');
  assert.ok(!timelineSrc.includes('is-brand'), 'violet brand-halo class no longer emitted');
  assert.ok(!/APP LOGO on the think chip/.test(timelineSrc), 'stale logo-advertising header comment gone');
  assert.ok(/SPINNING CIRCLE/.test(timelineSrc), 'header now advertises the spinning circle');
  assert.ok(/REMOVED and REPLACED by/.test(timelineSrc), 'header states the circle replaces the logo');
});

// ------------------------------------------------------------
// 2 · SOURCE — the circle's precise, reused geometry
// ------------------------------------------------------------
test('ThinkOrbit reuses PHASE_MARKS.think: integer rings, 1px, tick, orbit node, no FX', () => {
  assert.ok(timelineSrc.includes('function ThinkOrbit'), 'ThinkOrbit component defined');
  assert.ok(orbitSrc.includes('{PHASE_MARKS.think}'), 'reuses the band-head stamp geometry');
  assert.ok(orbitSrc.includes('viewBox="0 0 12 12"'), '12-unit stamp grid');
  assert.ok(orbitSrc.includes('width={size}') && orbitSrc.includes('height={size}'), 'sized to the band stamp');
  assert.ok(/size = 12/.test(orbitSrc), '~12px default fits the node slot');

  const radii = [...thinkMarkSrc.matchAll(/\br="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(radii, [5, 2], 'two concentric INTEGER rings r5 + r2');
  assert.ok(orbitSrc.includes('d="M6 1v2"'), 'exact 12-o-clock tick on the centre axis');
  assert.ok(orbitSrc.includes('cx="6" cy="3" r="2"'), 'orbiting node ring r2 at true top');
  assert.ok(orbitSrc.includes('r="1" fill="currentColor"'), 'solid node core r1');
  assert.ok(orbitSrc.includes('from="0 6 6"') && orbitSrc.includes('to="360 6 6"'),
    'equal-angle rotation about the exact centre');
  assert.ok(orbitSrc.includes('animateTransform'), 'native SMIL orbit while live');

  const sw = [...orbitSrc.matchAll(/strokeWidth="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(sw.length >= 2 && sw.every((n) => n === 1), `every stroke is exactly 1px: ${sw.join(', ')}`);
  assert.ok(orbitSrc.includes('currentColor') && orbitSrc.includes('var(--acc)'), 'token-only colour');
  assert.ok(!/filter=|feGaussian|<defs|<linearGradient|<radialGradient|blur|glow/i.test(orbitSrc),
    'no blur / glow / gradient / filter');
  assert.ok(!/\br="\d+\.\d+"/.test(orbitSrc) && !/\br="\d+\.\d+"/.test(thinkMarkSrc),
    'no fractional radii anywhere in the circle');
});

// ------------------------------------------------------------
// 3 · SOURCE — both motion guards, live-only animation
// ------------------------------------------------------------
test('ThinkOrbit animates only while live and is guarded by BOTH motion switches', () => {
  assert.ok(orbitSrc.includes('const animate = live && motionAllowed'), 'rotation gated on the live band');
  assert.ok(orbitSrc.includes("matchMedia('(prefers-reduced-motion: reduce)')"), 'OS preference guard');
  assert.ok(orbitSrc.includes("classList.contains('reduce-motion')"), 'in-app reduce-motion guard');
  assert.ok(orbitSrc.includes('React.useEffect') && orbitSrc.includes("'change', sync"),
    'subscribes to preference changes');
  assert.equal(count(timelineSrc, '<ThinkOrbit'), 1, 'one orbit mount in the source');
});

test('asserted hooks survive in StreamTimeline source', () => {
  for (const hook of ['data-phase', 'sc18-node-ico', 'sc18-phase-mark', 'sc18-band', 'sc18-think-orbit']) {
    assert.ok(timelineSrc.includes(hook), `StreamTimeline preserves ${hook}`);
  }
});

// ------------------------------------------------------------
// 4 · SSR — rendered behaviour of the real band shell
// ------------------------------------------------------------
test('SSR: think band mounts the spinning circle at node-ico; hooks kept; no logo', () => {
  const html = renderBand('think', true);
  assert.ok(html.includes('data-phase="think"'), 'data-phase hook');
  assert.ok(html.includes('sc18-node-ico'), 'node-ico hook');
  assert.ok(html.includes('sc18-phase-mark'), 'phase stamp hook');
  assert.ok(html.includes('sc18-think-orbit'), 'spinning circle mounted at the node');
  assert.ok(html.includes('viewBox="0 0 12 12"'), 'precise stamp SVG in SSR');
  assert.ok(html.includes('cx="6" cy="3"'), 'node parked at 12 o-clock in the markup');
  assert.ok(!html.includes('Logo'), 'no app logo in SSR output');
  assert.ok(!html.includes('is-brand'), 'no brand halo class in SSR output');

  for (const phase of ['work', 'build', 'run', 'prove']) {
    assert.ok(!renderBand(phase, true).includes('sc18-think-orbit'), `only THINK wears the orbit (${phase})`);
  }
});

test('SSR: a settled think band parks the node (no animation)', () => {
  const html = renderBand('think', false);
  assert.ok(html.includes('sc18-think-orbit'), 'circle still present when settled');
  assert.ok(!html.includes('animateTransform'), 'no orbit animation when the band is not streaming');
  assert.ok(html.includes('cx="6" cy="3"'), 'node at true 12 o-clock');
});

test('SSR: reduced motion freezes a LIVE orbit at 12 o-clock (both switches)', () => {
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  globalThis.document = { documentElement: { classList: { contains: () => true } } };
  try {
    const html = renderBand('think', true);
    assert.ok(html.includes('sc18-think-orbit'), 'circle present');
    assert.ok(!html.includes('animateTransform'), 'prefers-reduced-motion freezes the orbit');
    assert.ok(html.includes('cx="6" cy="3"'), 'parked at exact 12 o-clock');
  } finally {
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
  }
});

test('BAND_META.think points at ThinkOrbit with no brand field', () => {
  assert.equal(mod.BAND_META.think.icon.name, 'ThinkOrbit', 'think icon is the circle');
  assert.ok(!('brand' in mod.BAND_META.think), 'no brand field on the think band');
  assert.equal(mod.BAND_META.think.cssVar, 'var(--v-think)', 'violet phase coding kept');
});
