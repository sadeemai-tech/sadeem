// ============================================================
// v11.26 — THINKING ART: ONE ENLARGED, MEASURED, BOX-FREE CIRCLE
//
// The founder: "حسن طريقة عرض الذكاء الاصطناعي كيف بفكر... هي جميلة لكن
// تحتاج تحسين أكثر وجرافيكس أكثر... الدائرة اللي جنب الريثينك والريزونينج
// صغيرة، كبرها، اجعلها نفس حجم التي عند الثوت... ما بدك كل إشي جوا مربع/jا
// إطار — ابدع بالتصميم."
//
// Two layers, both against the real files:
//   1. SOURCE — the single precision orbit is 30px (≈2× the 16px THINK band
//      circle) with the SAME craft grammar (integer radii, 1px strokes,
//      equal-angle SMIL orbit, 12 o'clock tick, calibration arc). New precise
//      graphics: dashed orbit trace, four measured cardinal ticks, a fine 1px
//      header baseline. No box wrapper in the owned JSX; both motion switches
//      gate the animation; all asserted hooks + bilingual labels survive.
//   2. SSR — real React renders exactly ONE circle-drawing SVG in the head,
//      no frame markup, all new graphics present, and a live orbit freezes to
//      its 12 o'clock end state under either reduced-motion signal.
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

const BUNDLE = join(ROOT, 'tests', '.v1126-thinking-art.bundle.cjs');
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
      contents: "export { MessageView } from './src/components/MessageView';",
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

const h = React?.createElement;
const MSG = src('src/components/MessageView.tsx');
const STREAM = src('src/components/StreamTimeline.tsx');
/** Comments stripped so comment prose cannot fake a source assertion. */
const CODE = MSG
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');
const count = (hay, needle) => hay.split(needle).length - 1;
const between = (start, end) => {
  const a = CODE.indexOf(start);
  assert.ok(a >= 0, `marker present: ${start}`);
  const b = CODE.indexOf(end, a);
  assert.ok(b > a, `end marker present: ${end}`);
  return CODE.slice(a, b);
};
const orbitSrc = between('const REASON_ORBIT_SIZE', 'const ThinkingBlock = memo');
const headSrc = between('const ThinkingBlock = memo', '{open && (');

const renderThink = (streaming = true) => renderToStaticMarkup(h(mod.MessageView, {
  msg: {
    id: 'think-art',
    role: 'assistant',
    kind: 'text',
    content: '',
    thinking: 'reasoning step one',
    streaming,
    timestamp: 1700000000000,
  },
}));

/** <svg> blocks that actually draw circles (lucide carets have none). */
const circleSvgs = (markup) =>
  (markup.match(/<svg\b[\s\S]*?<\/svg>/g) || []).filter((b) => b.includes('<circle'));

// ------------------------------------------------------------
// 1 · SOURCE — enlarged, one instrument, THINK-circle grammar
// ------------------------------------------------------------
test('one 30px precision instrument matches the THINK circle craft grammar', () => {
  assert.ok(CODE.includes('const REASON_ORBIT_SIZE = 30'), 'single size source of truth is 30px');
  assert.equal(count(CODE, 'function PrecisionThinkingOrbit'), 1, 'one orbit component');
  assert.equal(count(CODE, '<PrecisionThinkingOrbit'), 1, 'one orbit mount in the reasoning head');
  assert.equal(count(orbitSrc, '<svg'), 1, 'exactly one SVG — one circle instrument, no companion');
  assert.ok(orbitSrc.includes('width={REASON_ORBIT_SIZE}') && orbitSrc.includes('height={REASON_ORBIT_SIZE}'),
    'enlarged size drives both SVG attributes');
  assert.ok(orbitSrc.includes('width: REASON_ORBIT_SIZE') && orbitSrc.includes('height: REASON_ORBIT_SIZE'),
    'inline size pins the enlargement against any CSS size rule');
  const thinkSize = /<ThinkOrbit size=\{(\d+)\}/.exec(STREAM);
  assert.ok(thinkSize, 'THINK band circle mount found');
  assert.ok(30 > Number(thinkSize[1]), `reasoning circle (30px) out-prominates the THINK band circle (${thinkSize[1]}px)`);

  assert.ok(orbitSrc.includes('viewBox="0 0 32 32"'), 'integer 32-unit grid');
  for (const r of ['r="14"', 'r="10"', 'r="6"']) {
    assert.ok(orbitSrc.includes(r), `integer radius ${r}`);
  }
  assert.ok(orbitSrc.includes('d="M16 8v4"'), 'exact 12 o’clock registration tick');
  assert.ok(orbitSrc.includes('strokeDasharray="6 100"') && orbitSrc.includes('transform="rotate(-90 16 16)"'),
    'true-top calibration arc');
  assert.ok(orbitSrc.includes('from="0 16 16"') && orbitSrc.includes('to="360 16 16"'),
    'equal-angle SMIL rotation about the integer centre');
  assert.ok(orbitSrc.includes('cx="16" cy="4" r="2"') && orbitSrc.includes('cx="16" cy="4" r="1"'),
    'node ring r2 + solid core r1 parked 12 units above centre');
  const sw = [...orbitSrc.matchAll(/strokeWidth="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(sw.length >= 4 && sw.every((n) => n === 1), `every stroke exactly 1px: ${sw.join(', ')}`);
  assert.ok(!/\br="\d+\.\d+"/.test(orbitSrc), 'no fractional radii');
  assert.ok(!/filter=|feGaussian|<defs|<linearGradient|<radialGradient|blur|glow/i.test(orbitSrc),
    'no glow / gradient / blur / filter — token strokes only');
});

// ------------------------------------------------------------
// 2 · SOURCE — new precise graphics, no box, hooks intact
// ------------------------------------------------------------
test('new precise graphics: orbit trace, measured ticks, fine header baseline', () => {
  assert.ok(orbitSrc.includes('r="12"') && orbitSrc.includes('strokeDasharray="1 3"'),
    'dashed 1px orbit trace on the exact r12 node path');
  assert.ok(orbitSrc.includes('d="M16 1v3M28 16h3M16 28v3M1 16h3"'),
    'four symmetric cardinal tick marks on integer coordinates');
  assert.ok(headSrc.includes('className="sc-reason-baseline"'), 'header baseline hook');
  assert.ok(headSrc.includes('height: 1'), 'baseline is a 1px hairline, not a panel');
  assert.ok(headSrc.includes('insetInlineStart: 38') && headSrc.includes('insetInlineEnd: 0'),
    'baseline measures the label, starting after the 30px circle + 8px gap');
  assert.ok(headSrc.includes("background: 'var(--line-soft)'"), 'token colour only');
  assert.ok(headSrc.includes('opacity: 0.6'), 'opacity only — no layout animation');
});

test('reasoning head JSX carries NO border/background/radius box around the circle', () => {
  const slot = headSrc.slice(headSrc.indexOf('<span'), headSrc.indexOf('<PrecisionThinkingOrbit'));
  for (const decl of ["border: 'none'", "background: 'none'", 'borderRadius: 0', "boxShadow: 'none'"]) {
    assert.ok(slot.includes(decl), `box declaration cleared in JSX: ${decl}`);
  }
  assert.ok(!/border:\s*['"]1px/.test(slot), 'no 1px border reinstated');
  assert.ok(!/borderRadius:\s*\d/.test(slot.replace('borderRadius: 0', '')), 'no radius reinstated');
  assert.equal(count(headSrc, '<svg'), 0, 'no second inline SVG in the head — one circle only');
});

test('asserted hooks and bilingual labels survive the art pass', () => {
  for (const hook of ['sc-think-mark', 'sc-reason-glyph', 'kb-think-head', 'sc-think-engrave', 'sc-reason-orbit-svg']) {
    assert.ok(CODE.includes(hook), `hook preserved: ${hook}`);
  }
  assert.ok(CODE.includes("t('chat.thinking', 'Thinking')"), 'English live label unchanged');
  assert.ok(CODE.includes("chat.thinking.thoughtFor",), 'settled bilingual label unchanged');
  assert.ok(MSG.includes("ar: 'تفكير'"), 'Arabic THINK label unchanged');
});

test('both reduced-motion signals gate the orbit', () => {
  assert.ok(CODE.includes('const animate = live && !reduced'), 'motion gated on live + reduced');
  assert.ok(MSG.includes("window.matchMedia('(prefers-reduced-motion: reduce)').matches"),
    'OS preference guard');
  assert.ok(MSG.includes("document.documentElement.classList.contains('reduce-motion')"),
    'in-app reduce-motion guard');
});

// ------------------------------------------------------------
// 3 · SSR — one clean circle, new graphics, static reduced motion
// ------------------------------------------------------------
test('SSR: one enlarged 30px circle instrument with all new graphics', () => {
  const html = renderThink(true);
  assert.ok(html.includes('kb-think-head'), 'head hook rendered');
  assert.ok(html.includes('sc-think-mark') && html.includes('sc-reason-glyph'), 'glyph hooks rendered');
  assert.ok(html.includes('sc-reason-orbit-svg') && html.includes('sc-think-engrave'), 'instrument hooks rendered');
  const circles = circleSvgs(html);
  assert.equal(circles.length, 1, 'exactly one circle-drawing SVG in the reasoning head');
  assert.equal(count(html, '<circle'), 7, 'r14 + r10 + r6 + r12 trace + r6 arc + node r2 + core r1');
  assert.ok(circles[0].includes('width="30"') && circles[0].includes('height="30"'), '30px attributes rendered');
  assert.ok(circles[0].includes('width:30px') && circles[0].includes('height:30px'), 'inline 30px rendered');
  assert.ok(circles[0].includes('viewBox="0 0 32 32"'), 'integer grid rendered');
  assert.ok(circles[0].includes('stroke-dasharray="1 3"'), 'orbit trace rendered');
  assert.ok(circles[0].includes('d="M16 1v3M28 16h3M16 28v3M1 16h3"'), 'measured ticks rendered');
  assert.ok(html.includes('sc-reason-baseline') && html.includes('height:1px'), 'header baseline rendered');
  assert.ok(html.includes('Thinking'), 'English live reasoning label rendered');
});

test('SSR: no square/frame markup wraps the reasoning circle', () => {
  const html = renderThink(true);
  const slot = /<span class="[^"]*sc-reason-orbit-slot[^"]*"[^>]*>/.exec(html);
  assert.ok(slot, 'orbit slot span rendered');
  for (const decl of ['border:none', 'background:none', 'border-radius:0', 'box-shadow:none']) {
    assert.ok(slot[0].includes(decl), `box killed in markup: ${decl}`);
  }
  assert.ok(!/border:1px/.test(slot[0]), 'no rendered 1px frame');
  assert.ok(!/border-radius:[1-9]/.test(slot[0]), 'no rendered rounded plate');
  assert.equal(count(html, 'sc-reason-baseline'), 1, 'one fine baseline, not a card');
});

test('SSR: LIVE orbit animates; settled block is static', () => {
  const live = renderThink(true);
  assert.ok(live.includes('animateTransform'), 'equal-angle orbit while live');
  assert.ok(live.includes('<animate attributeName="r"'), 'integer ring breath while live');
  const settled = renderThink(false);
  assert.ok(settled.includes('sc-reason-orbit-svg'), 'circle survives settling');
  assert.ok(!settled.includes('animateTransform'), 'no SMIL when settled');
  assert.ok(!settled.includes('<animate attributeName="r"'), 'no ring breath when settled');
  assert.ok(settled.includes('cx="16" cy="4"'), 'node parked at 12 o’clock');
});

test('SSR: BOTH reduced-motion switches freeze a LIVE orbit at 12 o’clock', () => {
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  try {
    // OS preference
    globalThis.window = { ...savedWindow, matchMedia: () => ({ matches: true }) };
    globalThis.document = savedDocument;
    let html = renderThink(true);
    assert.equal(circleSvgs(html).length, 1, 'one circle remains');
    assert.ok(!html.includes('animateTransform') && !html.includes('<animate '),
      'prefers-reduced-motion removes every SMIL element');
    assert.ok(html.includes('cx="16" cy="4"'), 'parked at exact 12 o’clock');

    // In-app switch
    globalThis.window = savedWindow;
    globalThis.document = {
      ...savedDocument,
      documentElement: { classList: { contains: () => true }, dataset: {}, style: {} },
    };
    html = renderThink(true);
    assert.equal(circleSvgs(html).length, 1, 'one circle remains');
    assert.ok(!html.includes('animateTransform') && !html.includes('<animate '),
      'html.reduce-motion removes every SMIL element');
    assert.ok(html.includes('cx="16" cy="4"'), 'parked at exact 12 o’clock');
  } finally {
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
  }
});
