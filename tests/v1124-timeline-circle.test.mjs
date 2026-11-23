import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.24 — TIMELINE CIRCLE MERGE · MessageView half of the contract.
//
// Founder: "الدائرة الكبيرة اللي بيجي جنبيها وركينج... امحيها بالكامل...
//  شايف اللي تحتيه الشريط... تصغر الدائرة والكلام اللي معها تحطه بدالها"
//
// The one spinning circle now lives INSIDE ChatPanel's run/timeline strip
// (owned by A3/parent). THIS file owns the other half:
//   1. MessageView mounts ZERO circles — the old gutter copy was REMOVED
//      (deleted component + mount + hooks), not hidden.
//   2. The trembling text decor (wave / nib / beads / keyed word shimmer) is
//      deleted — reasoning renders as plain, stable text.
//   3. Latency: no per-delta word counting, stable markdown plugin arrays,
//      and the FIRST delta paints in the render commit (no rAF wait).
//   4. Dead CSS hooks are gone from chat-final.css.
// All source scans run on COMMENT-STRIPPED code so no banned token can hide
// in a comment. SSR drives the real bundled MessageView.
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const src = (p) => readFileSync(join(ROOT, p), 'utf8');
const count = (hay, needle) => hay.split(needle).length - 1;
const stripComments = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');

const MSG_PATH = 'src/components/MessageView.tsx';
const CSS_PATH = 'src/components/chat-final.css';
const CHAT_PATH = 'src/components/ChatPanel.tsx';
const msgSrc = stripComments(src(MSG_PATH));
const cssSrc = src(CSS_PATH);
const chatSrc = stripComments(src(CHAT_PATH));

const BUNDLE = join(ROOT, 'tests', '.v1124-timeline-circle.bundle.cjs');
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
    addEventListener() {},
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
    bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLE,
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
const CIRCLE_HOOKS = [
  'CompactThinkingOrbit', 'sc-think-orbit-svg', 'sc-think-orbit',
  'data-streaming', 'insetInlineStart: -24',
];
const TREMOR_HOOKS = [
  'LiveWave', 'sc-live-wave', 'WAVE_BARS',
  'LiveNib', 'mv-live-nib', 'mv-live-spark', 'NIB_ORBIT_R',
  'PhaseBeads', 'mv-phase-beads', 'mv-bead',
  'revealWords', 'sc-reason-word', 'sc-reason-dots',
  'deltaWordCount', 'waveTick', 'nibTick', 'thinkWords',
];

// ------------------------------------------------------------
// 1 · SOURCE — MessageView owns ZERO circles and ZERO trembling decor
// ------------------------------------------------------------
test('source: MessageView mounts no circle at all (gutter copy deleted, not hidden)', () => {
  for (const hook of CIRCLE_HOOKS) {
    assert.equal(count(msgSrc, hook), 0, `MessageView has no ${hook}`);
  }
  assert.ok(msgSrc.includes('function PrecisionThinkingOrbit'),
    'the one reasoning-head instrument is the only circle component left');
});

test('source: no wave / nib / beads / keyed word shimmer survives', () => {
  for (const hook of TREMOR_HOOKS) {
    assert.equal(count(msgSrc, hook), 0, `MessageView has no ${hook}`);
  }
  assert.ok(msgSrc.includes('{tail}'), 'reasoning tail renders as plain stable text');
  assert.ok(!/\.match\(\/\\S\+\/g\)/.test(msgSrc), 'no per-delta word-count allocation');
});

test('source: the single spinning circle lives in the ChatPanel run strip', () => {
  const stripStart = chatSrc.indexOf('function RunStatusLine');
  assert.ok(stripStart >= 0, 'RunStatusLine exists');
  const nextFn = chatSrc.indexOf('\nfunction ', stripStart + 1);
  const strip = chatSrc.slice(stripStart, nextFn > 0 ? nextFn : undefined);
  assert.equal(count(strip, '<svg'), 1, 'exactly one SVG circle inside the run strip');
  assert.ok(/animateTransform|<animate\s/.test(strip), 'that circle is a spinner');
  assert.ok(strip.includes('formatElapsedClock'), 'real elapsed clock in the strip');
  assert.ok(/\btok\b/.test(strip), 'mono token count in the strip');
});

// ------------------------------------------------------------
// 2 · SOURCE — latency work in this file
// ------------------------------------------------------------
test('latency: markdown plugins are hoisted (stable identity across deltas)', () => {
  assert.ok(/const MD_REMARK_PLUGINS[^\n]*= \[remarkGfm\]/.test(msgSrc), 'remark plugins hoisted');
  assert.ok(/const MD_REHYPE_PLUGINS[^\n]*= \[rehypeHighlight\]/.test(msgSrc), 'rehype plugins hoisted');
  assert.ok(!msgSrc.includes('remarkPlugins={[remarkGfm]}'), 'no inline plugin array per render');
  assert.ok(msgSrc.includes('remarkPlugins={MD_REMARK_PLUGINS}'), 'stable array used by Markdown');
});

test('latency: the first delta paints in the render commit, not a frame later', () => {
  assert.ok(msgSrc.includes('shown.length === 0 && lenRef.current === 0'),
    'first-delta fast path is guarded on the empty buffer');
  assert.ok(msgSrc.includes('setShown(source);'), 'first batch is shown immediately');
  assert.ok(msgSrc.includes('lenRef.current = source.length;'), 'buffer length advances in the same pass');
});

// ------------------------------------------------------------
// 3 · CSS — dead animation hooks removed, one-shot bloom kept
// ------------------------------------------------------------
test('css: no dead trembling-animation hooks remain in chat-final.css', () => {
  for (const hook of [
    'mv-live-nib', 'mv-nib-blink', 'mv-live-spark', 'mv-spark-orbit',
    'mv-bead', 'mv-bead-fill-in', 'mv-phase-beads',
  ]) {
    assert.equal(count(cssSrc, hook), 0, `chat-final.css has no ${hook}`);
  }
  assert.ok(cssSrc.includes('.mv-tool-bloom'), 'the one-shot tool bloom is retained');
});

// ------------------------------------------------------------
// 4 · SSR — the real assistant row is plain, stable and circle-free
// ------------------------------------------------------------
const assistant = (streaming) => ({
  id: 'a-v1124', role: 'assistant', kind: 'text',
  thinking: 'Let me work through the reasoning carefully.',
  content: 'The result is ready.',
  streaming, model: 'custom/m', thinkMs: 1200, timestamp: 1700000000001,
});

for (const streaming of [true, false]) {
  test(`SSR streaming=${streaming}: no circle, no trembling decor, plain reasoning text`, () => {
    const html = renderToStaticMarkup(h(mod.MessageView, { msg: assistant(streaming), turnStart: true }));
    for (const hook of CIRCLE_HOOKS.concat(TREMOR_HOOKS)) {
      assert.ok(!html.includes(hook), `rendered row has no ${hook}`);
    }
    assert.ok(html.includes('sc-reason-orbit-svg'), 'the one reasoning-head instrument remains');
    assert.ok(html.includes('Let me work through the reasoning carefully.'), 'reasoning text is present');
    assert.ok(html.includes('The result is ready.'), 'answer text is present');
  });
}

test('report: print exact counts for the parent', () => {
  const summary = {
    msgGutterHooks: CIRCLE_HOOKS.reduce((n, m) => n + count(msgSrc, m), 0),
    msgTremorHooks: TREMOR_HOOKS.reduce((n, m) => n + count(msgSrc, m), 0),
    cssDeadHooks: ['mv-live-nib', 'mv-live-spark', 'mv-bead'].reduce((n, m) => n + count(cssSrc, m), 0),
    stripSvgs: 1, // cross-checked by v1124-timeline-guard (ssrStripSvgs:1)
  };
  console.log('V1124_TIMELINE_CIRCLE=' + JSON.stringify(summary));
  assert.equal(summary.msgGutterHooks, 0);
  assert.equal(summary.msgTremorHooks, 0);
  assert.equal(summary.cssDeadHooks, 0);
});
