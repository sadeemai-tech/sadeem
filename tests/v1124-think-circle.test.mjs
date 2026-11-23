import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.24 — THINK WEARS EXACTLY ONE CIRCLE, AND IT IS NOT IN A BOX.
//
// The founder: "I moved the big circle next to THINK — good, but now THINK
// has TWO copies. That is bad. And the circle in THINKING and next to
// REASONING — why did you put it inside a SQUARE? It looks ugly. Enlarge it,
// fix its place."
//
// Two layers, both against the real files:
//   1. SOURCE — exactly one ThinkOrbit mount (size 16, at sc18-node-ico); the
//      second circle (PHASE_MARKS.think inside the sc18-phase-mark square) is
//      deleted, not hidden; no Logo, no Tailwind square wrapper, integer/
//      1px geometry, both reduced-motion guards.
//   2. SSR — the think band renders exactly ONE circle SVG, no square wrapper
//      markup, no Logo; the reduced-motion end state is static at 12 o'clock.
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

const BUNDLE = join(ROOT, 'tests', '.v1124-think-circle.bundle.cjs');
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
const shellSrc = between('export function StreamBandShell', 'export { BAND_META }');

const renderBand = (phase, live) => renderToStaticMarkup(
  h(mod.StreamBandShell, {
    phase, live, label: phase, startAt: 1700000000000, count: 1,
  }, h('div', null, 'items')),
);

/** Every className value in a source string (string + template-literal forms). */
function classValues(code) {
  const out = [];
  for (const m of code.matchAll(/\b(?:className|class)=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    out.push(m[1] ?? m[2] ?? '');
  }
  return out;
}
const SQUARE_CLASS = /(?:^|\s)(?:border|rounded|bg-[\w-]+)(?:\s|$)/;

/** Count <svg> blocks in markup that actually contain <circle>. */
function circleSvgs(markup) {
  return (markup.match(/<svg\b[\s\S]*?<\/svg>/g) || []).filter((b) => b.includes('<circle'));
}

// ------------------------------------------------------------
// 1 · SOURCE — exactly one circle, the duplicate is DELETED
// ------------------------------------------------------------
test('exactly ONE ThinkOrbit mount, enlarged to 16px at sc18-node-ico', () => {
  assert.equal(count(timelineSrc, '<ThinkOrbit'), 1, 'one orbit mount in the source');
  assert.ok(shellSrc.includes('<ThinkOrbit size={16} live={live} />'), 'the single circle is rendered at 16px');
  assert.ok(shellSrc.includes('sc18-node-ico'), 'hook sc18-node-ico kept on the orbit socket');
  assert.ok(/function ThinkOrbit\(\{ size = 12/.test(orbitSrc), 'default stays 12 (geometry grid), mount overrides to 16');
  assert.ok(orbitSrc.includes('width={size}') && orbitSrc.includes('height={size}'), 'SVG size driven by the prop');
  assert.ok(orbitSrc.includes('style={{ width: size, height: size, color: \'var(--acc)\' }}'),
    'inline size beats the CSS 12px pin so the enlargement actually renders');
});

test('the SECOND circle (PHASE_MARKS.think in the stamp square) is removed, not hidden', () => {
  // The think branch of the phase stamp draws no monogram SVG at all — only a
  // hook-only marker. Non-think bands still wear their monogram in the square.
  assert.ok(shellSrc.includes('<span data-phase-mark="sc18-phase-mark" aria-hidden />'),
    'think stamp uses a hook-only marker, no second ring');
  const stampThink = shellSrc.indexOf('{phase === \'think\' ? (', shellSrc.indexOf('sc18-phase-stamp'));
  const thinkBranch = shellSrc.slice(stampThink, shellSrc.indexOf(') : (', stampThink));
  assert.ok(!thinkBranch.includes('<svg'), 'no circle SVG in the think phase stamp');
  assert.ok(!thinkBranch.includes('PHASE_MARKS'), 'no PHASE_MARKS circle mounted in the think stamp');
  assert.ok(!/display\s*:\s*none|visibility\s*:\s*hidden|\shidden\b/.test(thinkBranch),
    'removed from the DOM, not hidden with CSS / a hidden attribute');
  // The geometry source survives ONLY for the single rail orbit.
  assert.ok(orbitSrc.includes('{PHASE_MARKS.think}'), 'ThinkOrbit is the sole consumer of the think geometry');
});

test('no Logo, no brand treatment anywhere in StreamTimeline', () => {
  assert.ok(!timelineSrc.includes('import { Logo }'), 'no Logo import');
  assert.ok(!/<Logo\b/.test(timelineSrc), 'no <Logo> JSX');
  assert.ok(!timelineSrc.includes('ThinkBrand') && !timelineSrc.includes('is-brand'), 'no brand wrapper / halo');
  assert.ok(!timelineSrc.includes('brand: true') && !timelineSrc.includes('brand?:'), 'no brand flag');
});

// ------------------------------------------------------------
// 2 · SOURCE — no square wrapper markup around the kept circle
// ------------------------------------------------------------
test('no Tailwind square wrapper class on any band / node / node-ico', () => {
  const offenders = classValues(shellSrc).filter((v) => SQUARE_CLASS.test(v));
  assert.deepEqual(offenders, [], `no border/rounded/bg-* square classes on band wrappers: ${offenders.join(' | ')}`);
  for (const hook of ['sc18-band', 'sc18-node', 'sc18-node-ico']) {
    assert.ok(shellSrc.includes(hook), `wrapper hook ${hook} preserved`);
  }
});

test('the think node neutralises the stylesheet square in markup', () => {
  const nodeBlock = shellSrc.slice(
    shellSrc.indexOf('className="sc18-node"'),
    shellSrc.indexOf('sc18-node-ico'),
  );
  for (const decl of ["border: 'none'", "background: 'none'", "boxShadow: 'none'", 'borderRadius: 0']) {
    assert.ok(nodeBlock.includes(decl), `node square cleared by ${decl}`);
  }
  assert.ok(!/border:\s*['"]1px/.test(nodeBlock), 'no 1px border reinstated');
  assert.ok(!/background:\s*['"]var\(/.test(nodeBlock), 'no filled background reinstated');
});

// ------------------------------------------------------------
// 3 · SOURCE — precise, guard-bearing circle geometry
// ------------------------------------------------------------
test('the single circle is precise: integer radii, 1px strokes, tick, equal-angle orbit', () => {
  assert.ok(orbitSrc.includes('viewBox="0 0 12 12"'), 'integer 12-unit stamp grid');
  const radii = [...thinkMarkSrc.matchAll(/\br="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(radii, [5, 2], 'two concentric INTEGER rings r5 + r2');
  assert.ok(orbitSrc.includes('d="M6 1v2"'), 'exact 12-o-clock tick on the centre axis');
  assert.ok(orbitSrc.includes('cx="6" cy="3" r="2"'), 'orbiting node ring r2 at true top');
  assert.ok(orbitSrc.includes('r="1" fill="currentColor"'), 'solid node core r1');
  assert.ok(orbitSrc.includes('from="0 6 6"') && orbitSrc.includes('to="360 6 6"'),
    'equal-angle rotation about the exact centre');
  assert.ok(orbitSrc.includes('animateTransform'), 'native SMIL orbit while live');
  const sw = [...orbitSrc.matchAll(/strokeWidth="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(sw.length >= 2 && sw.every((n) => n === 1), `every stroke exactly 1px: ${sw.join(', ')}`);
  assert.ok(!/\br="\d+\.\d+"/.test(orbitSrc) && !/\br="\d+\.\d+"/.test(thinkMarkSrc), 'no fractional radii');
  assert.ok(!/filter=|feGaussian|<defs|<linearGradient|<radialGradient|blur|glow/i.test(orbitSrc), 'no FX');
});

test('both reduced-motion guards gate the orbit, and it is live-only', () => {
  assert.ok(orbitSrc.includes('const animate = live && motionAllowed'), 'rotation gated on the live band');
  assert.ok(orbitSrc.includes("matchMedia('(prefers-reduced-motion: reduce)')"), 'OS preference guard');
  assert.ok(orbitSrc.includes("classList.contains('reduce-motion')"), 'in-app reduce-motion guard');
  assert.ok(orbitSrc.includes("'change', sync"), 'subscribes to media-query changes');
});

// ------------------------------------------------------------
// 4 · SSR — one clean circle, static end state
// ------------------------------------------------------------
test('SSR: think band mounts exactly ONE circle SVG, no square, no logo', () => {
  const html = renderBand('think', true);
  assert.ok(html.includes('data-phase="think"'), 'data-phase hook');
  assert.equal(count(html, 'sc18-think-orbit'), 1, 'exactly one orbit hook in the DOM');
  const circles = circleSvgs(html);
  assert.equal(circles.length, 1, 'exactly one <svg> drawing circles in the think band');
  assert.ok(circles[0].includes('sc18-think-orbit'), 'that one circle is the spinning orbit');
  assert.equal(count(html, '<circle'), 4, 'r5 + r2 + orbit r2 + core r1 — one instrument, four primitives');
  assert.ok(!html.includes('class="sc18-phase-mark"'), 'no square phase-mark element for think');
  assert.ok(!/<svg[^>]*>[\s\S]{0,120}<circle[^>]*r="5"/.test(html.replace(circles[0], '')),
    'no second r5 ring anywhere outside the single orbit');
  assert.ok(!html.includes('Logo') && !html.includes('is-brand'), 'no logo / brand halo');
});

test('SSR: no square wrapper markup in the rendered think band', () => {
  const html = renderBand('think', true);
  const offenders = classValues(html).filter((v) => SQUARE_CLASS.test(v));
  assert.deepEqual(offenders, [], `no Tailwind square classes in DOM: ${offenders.join(' | ')}`);
  assert.ok(html.includes('border:none') && html.includes('background:none'), 'node square neutralised inline');
  assert.ok(!html.includes('border:1px'), 'no rendered 1px node border');
  assert.ok(!html.includes('box-shadow:inset'), 'no rendered inset node ring');
});

test('SSR: the kept circle is enlarged to 16px', () => {
  const html = renderBand('think', true);
  assert.ok(html.includes('width="16"') && html.includes('height="16"'), 'SVG size attributes are 16');
  assert.ok(html.includes('width:16px') && html.includes('height:16px'), 'inline size beats the 12px CSS pin');
  const circles = circleSvgs(html);
  assert.ok(circles[0].includes('viewBox="0 0 12 12"'), 'integer geometry grid is preserved when scaled up');
});

test('SSR: a settled think band parks the node (static end state)', () => {
  const html = renderBand('think', false);
  assert.ok(html.includes('sc18-think-orbit'), 'circle still present when settled');
  assert.ok(!html.includes('animateTransform'), 'no orbit animation when the band is not streaming');
  assert.ok(html.includes('cx="6" cy="3"'), 'node parked at true 12 o-clock');
});

test('SSR: reduced motion freezes a LIVE orbit at 12 o-clock (both switches)', () => {
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  globalThis.document = { documentElement: { classList: { contains: () => true } } };
  try {
    const html = renderBand('think', true);
    assert.equal(circleSvgs(html).length, 1, 'one circle remains');
    assert.ok(!html.includes('animateTransform'), 'prefers-reduced-motion freezes the orbit');
    assert.ok(html.includes('cx="6" cy="3"'), 'parked at exact 12 o-clock');
  } finally {
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
  }
});

test('SSR: only THINK wears the orbit; other bands keep their monogram square', () => {
  for (const phase of ['work', 'build', 'run', 'prove']) {
    const html = renderBand(phase, true);
    assert.ok(!html.includes('sc18-think-orbit'), `no orbit on ${phase}`);
    assert.ok(html.includes('class="sc18-phase-mark"'), `${phase} keeps its phase monogram`);
  }
  assert.equal(mod.BAND_META.think.icon.name, 'ThinkOrbit', 'think icon is the single circle');
  assert.equal(mod.BAND_META.think.cssVar, 'var(--v-think)', 'violet phase coding kept');
});
