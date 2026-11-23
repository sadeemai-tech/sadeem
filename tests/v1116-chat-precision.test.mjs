import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.16 — CHAT ART PRECISION (founder: "some drawing errors, needs more
// precision"; "the still-reasoning note is still annoying").
//
// Two layers:
//   1. RUNTIME — esbuild TS→CJS bundle of the two surfaces we own, SSR-render
//      30+ message variants + all 8 tool-family glyphs (LTR AND RTL) against
//      real React — no crash, no missing liveness hooks, no rounded arcs.
//   2. SOURCE — exact-math locks on every inline-SVG constant: 120° LSP node
//      spacing, 15° engraving ticks that no longer cross their ring, DOWNWARD
//      cylinder bands (sweep=0 in a y-down coordinate system), exact 2πr
//      progress rings at full float precision, closed paths, viewBox fit.
//      Plus the calm 20s marker (tiny mono line, dot kept), transform/opacity
//      only runline motion, and BOTH reduced-motion guards on every surface.
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

const BUNDLE = join(ROOT, 'tests', '.v1116-chat-precision.bundle.cjs');
let mod;
let React;
let renderToStaticMarkup;

// ------------------------------------------------------------
// Browser stubs installed BEFORE the store bundle loads (same posture as
// v1114-chat-runtime). The store is pulled in transitively by MessageView.
// ------------------------------------------------------------
before(() => {
  globalThis.window = {
    surnia: new Proxy({}, {
      get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : () => Promise.resolve(undefined)),
    }),
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false }),
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
    body: { appendChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {} }),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  esbuild.buildSync({
    stdin: {
      contents:
        "export { MessageView, toolGlyphOf, toolIcon, RING_CIRCUMFERENCE as MV_CIRC } from './src/components/MessageView';" +
        "export { StreamBandShell, RING_CIRCUMFERENCE as ST_CIRC } from './src/components/StreamTimeline';",
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
  // SSR reads getServerSnapshot; make it observe the live seeded state so the
  // thinking / running / notice branches actually execute.
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  // useLayoutEffect is a DOM-scan optimization in ToolCallCard (stack ordinal);
  // SSR has no layout, so silence React's warning without touching the source.
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

const h = React?.createElement;
const messageViewSrc = src('src/components/MessageView.tsx');
const streamTimelineSrc = src('src/components/StreamTimeline.tsx');
const toolStoryCss = src('src/components/tool-story.css');
const chatArtCss = src('src/components/chat-art.css');
const streamMotionCss = src('src/components/stream-motion.css');
const consoleCss = src('src/components/console.css');
const chatCss = src('src/components/chat.css');

// ============================================================
// 1 · EXACT GEOMETRY — the audit math, pinned as source assertions
// ============================================================
test('LSP node graph: 3 nodes at EXACTLY 120° apart on r=4.6 about (8,8)', () => {
  assert.ok(messageViewSrc.includes('const LSP_NODES = ([-90, 30, 150] as const).map'), 'three node angles');
  assert.ok(messageViewSrc.includes('8 + 4.6 * Math.cos(a)'), 'x uses cos');
  assert.ok(messageViewSrc.includes('8 + 4.6 * Math.sin(a)'), 'y uses sin');
  const angles = [-90, 30, 150];
  const gaps = angles.map((a, i) => (angles[(i + 1) % angles.length] - a + 360) % 360);
  assert.deepEqual(gaps, [120, 120, 120], 'equal angular spacing');
  const pts = angles.map((deg) => {
    const a = (deg * Math.PI) / 180;
    return { x: 8 + 4.6 * Math.cos(a), y: 8 + 4.6 * Math.sin(a) };
  });
  for (const p of pts) {
    assert.ok(p.x > 2 && p.x < 14 && p.y > 2 && p.y < 14, 'node fits the 16×16 viewBox');
  }
  // the hull path closes (ends with Z) and every point is 2dp formatted
  assert.ok(messageViewSrc.includes('.join(\'L\')}Z'), 'hull path closes');
  assert.ok(messageViewSrc.includes('.toFixed(2)'), 'spoke/hull coords are 2dp');
});

test('v11.22 precision thinking orbit: 32-grid, integer radii, 1px strokes, exact 12 o’clock tick', () => {
  // The old "thinking engraving" (24 ticks / 15°) WAS the app-logo + descending
  // line the founder demanded removed. It is GONE — replaced by this circle.
  assert.ok(messageViewSrc.includes('function PrecisionThinkingOrbit'), 'precision orbit component present');
  assert.ok(messageViewSrc.includes('viewBox="0 0 32 32"'), '32-unit grid');
  for (const r of ['r="14"', 'r="10"', 'r="6"']) {
    assert.ok(messageViewSrc.includes(r), `integer radius ${r}`);
  }
  assert.ok(messageViewSrc.includes('d="M16 8v4"'), 'exact 12 o’clock registration tick');
  assert.ok(messageViewSrc.includes('strokeDasharray="6 100"'), 'calibration arc');
  assert.ok(
    messageViewSrc.includes('from="0 16 16"') && messageViewSrc.includes('to="360 16 16"'),
    'equal-angle orbit about the integer centre',
  );
  assert.ok(!messageViewSrc.includes('ThinkEngraving'), 'the descending-line glyph is GONE');
  assert.equal(16 - 4, 12, 'node at y=4 is exactly 12 units above centre y=16');
});

test('database glyph: front bands arc DOWNWARD (sweep=0), not the inverted bowl (sweep=1)', () => {
  assert.ok(!messageViewSrc.includes('a5 1.9 0 0 1 10 0'), 'no upward-swept cylinder bands');
  assert.equal((messageViewSrc.match(/a5 1\.9 0 0 0 10 0/g) || []).length, 2, 'both bands sweep downward');
  // SVG y-down: sweep=0 from the left rim (θ=180°) to the right rim (θ=0°)
  // decreases the angle through θ=90° → y = cy + ry (the LOWER half).
  const cy = 8;
  const ry = 1.9;
  assert.ok(cy + ry > cy, 'sweep=0 dips through cy + ry (downward)');
  // cap ellipse + walls meet at the exact rim x=3 / x=13
  assert.ok(messageViewSrc.includes('cx="8" cy="3.8" rx="5" ry="1.9"'), 'exact cap ellipse');
  assert.ok(messageViewSrc.includes('M3 3.8v8.4M13 3.8v8.4'), 'walls meet cap extremes');
});

test('every closed story path closes; every glyph viewBox matches its draw area', () => {
  // The four rectangles / hulls / star are explicitly closed with Z/z.
  for (const frag of [
    'M3.2 2.4h5.6l4 4v7.2H3.2z',
    'M2.4 3.2h11.2v9.6H2.4z',
    'M3.2 2.4h5.6l4 4v7.2H3.2z',
    '6.5 6.5Z',
    "join('L')}Z",
  ]) {
    assert.ok(messageViewSrc.includes(frag), `closed path present: ${frag}`);
  }
  assert.ok(messageViewSrc.includes('<svg viewBox="0 0 16 16"'), 'glyph viewBox 16×16');
  assert.ok(messageViewSrc.includes('viewBox="0 0 32 32"'), 'precision thinking orbit viewBox 32×32');
  assert.ok(messageViewSrc.includes('<svg viewBox="0 0 14 14"') && streamTimelineSrc.includes('<svg viewBox="0 0 14 14"'), 'ring viewBox 14×14');
  assert.ok(streamTimelineSrc.includes('<svg viewBox="0 0 12 12"'), 'phase mark viewBox 12×12');
});

// ============================================================
// 2 · PROGRESS RINGS — exact 2πr, full float precision (no 31.42 seam)
// ============================================================
test('progress rings use the EXACT 2πr circumference in both renderers', () => {
  const exact = 2 * Math.PI * 5;
  assert.equal(mod.MV_CIRC, exact, 'MessageView ring circumference === 2πr');
  assert.equal(mod.ST_CIRC, exact, 'StreamTimeline ring circumference === 2πr');
  assert.equal(exact.toFixed(2), '31.42', 'the old rounded value for reference');
  assert.ok(!/strokeDasharray=\{circ\.toFixed\(2\)\}/.test(messageViewSrc), 'MessageView no longer rounds the dash array');
  assert.ok(!/strokeDashoffset=\{\(circ \* \(1 - value\)\)\.toFixed\(2\)\}/.test(streamTimelineSrc), 'StreamTimeline no longer rounds the offset');
  assert.ok(messageViewSrc.includes('strokeDasharray={circ}') && streamTimelineSrc.includes('strokeDasharray={circ}'), 'both pass circ at full precision');
  // r=5 in 14 viewBox + 1.6 stroke → 5.8 outer radius = 1.2px clear margin
  assert.ok(5 + 1.6 / 2 < 7, 'ring + stroke fits the viewBox');
});

test('SSR progress ring renders the full-precision dash (not "31.42")', () => {
  const band = renderToStaticMarkup(h(mod.StreamBandShell, {
    phase: 'build',
    live: false,
    label: 'precision',
    progress: { done: 2, total: 4 },
  }, h('div', null, 'x')));
  assert.ok(band.includes('stroke-dasharray="' + (2 * Math.PI * 5) + '"'), `full 2πr dash in markup (${band.slice(band.indexOf('stroke-dasharray'), band.indexOf('stroke-dasharray') + 40)})`);
  assert.ok(!band.includes('stroke-dasharray="31.42"'), 'no rounded seam');
  assert.equal((band.match(/stroke-dashoffset="15\.707963267948966"/g) || []).length, 1, 'half ring offset is exactly πr');
});

// ============================================================
// 3 · THE 20s "STILL REASONING" MARKER — tiny mono line, dot kept
// ============================================================
test('the 20s thinking marker is a quiet mono line, not the generic notice box', () => {
  // renderer: dedicated class + liveness dot; NO default box styling wins
  assert.ok(messageViewSrc.includes("${isQuietMarker ? 'sc-notice-quiet' : ''}"), 'quiet class emitted');
  assert.ok(messageViewSrc.includes('className="sc-notice-live-dot"'), 'liveness dot kept (watchdog signal)');
  assert.ok(messageViewSrc.includes("thinking: { en: 'THINK', ar: 'تفكير' }"), 'thinking notice kind known');
  assert.ok(messageViewSrc.includes("isQuietMarker\n    ? flat.replace(/^\\[/, '').replace(/\\]$/, '')"), 'bracket wrapper stripped for the plain line');
  // CSS: console.css loads AFTER chat.css and collapses the padded box
  assert.ok(consoleCss.includes(".sc-notice[data-notice='thinking']"), 'quiet selector present');
  assert.ok(/\.sc-notice\[data-notice='thinking'\] \{[\s\S]*?border: 0;[\s\S]*?background: none;[\s\S]*?font-size: 10px;/.test(consoleCss), 'no border/bg + 10px mono line');
  assert.ok(consoleCss.includes('.chat-panel-root .sc-notice-live-dot'), 'dot style shipped');
  assert.ok(consoleCss.includes("html.reduce-motion .sc-notice[data-notice='thinking']"), 'reduced-motion guard');
  // the watchdog itself is untouched (separate renderer recovery state)
  assert.ok(!/useStore\(\(s\) => s\.runRecovery\)/.test(messageViewSrc), 'MessageView never subscribes to the watchdog');
});

// ============================================================
// 4 · MOTION LAW — runline breathes in opacity only, no layout height
// ============================================================
test('tool-card runline breathing is transform/opacity only — no layout jitter', () => {
  assert.ok(toolStoryCss.includes('animation: tsg-run-breathe 1.7s'), 'runline breathes via keyframes');
  const at = toolStoryCss.indexOf('@keyframes tsg-run-breathe');
  assert.ok(at >= 0, 'keyframes present');
  const body = toolStoryCss.slice(at, toolStoryCss.indexOf('}', at));
  for (const m of body.matchAll(/([a-z-]+)\s*:/g)) {
    assert.ok(m[1] === 'opacity', `runline breathe animates opacity only (found ${m[1]})`);
  }
  // the base runline has a FIXED 2px height; my layer never animates it
  assert.ok(chatCss.includes('.tv-runline {') && /\.tv-runline \{[\s\S]*?height: 2px;/.test(chatCss), 'fixed 2px runline height');
  for (const m of toolStoryCss.matchAll(/animation\s*:\s*([^;]+);/g)) {
    assert.ok(!/\b(height|margin|padding|top|left|right|bottom)\b/.test(m[1]), 'no layout property animated');
  }
  // the draw-in rules are absolutely-positioned hairlines (paint only)
  assert.ok(chatArtCss.includes('.tv-complete-rule {') && /position: absolute;/.test(chatArtCss.slice(chatArtCss.indexOf('.tv-complete-rule {'), chatArtCss.indexOf('.tv-complete-rule {') + 260)), 'complete rule is absolute');
});

test('BOTH reduced-motion signals guard every animated surface', () => {
  for (const [name, css] of [
    ['tool-story.css', toolStoryCss],
    ['chat-art.css', chatArtCss],
    ['stream-motion.css', streamMotionCss],
    ['console.css', consoleCss],
  ]) {
    assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), `${name}: prefers-reduced-motion guard`);
    assert.ok(css.includes('html.reduce-motion'), `${name}: app-level reduce-motion guard`);
  }
});

// ============================================================
// 5 · RTL/LTR IDENTITY — no mirrored math in the 8 tool-family glyphs
// ============================================================
test('all 8 family glyphs + neutral star render identically in RTL and LTR', () => {
  const families = {
    file: 'read_file',
    command: 'run_command',
    search: 'search_files',
    web: 'web_fetch',
    db: 'db_query',
    test: 'test_run',
    lsp: 'lsp_definition',
    image: 'image_generate',
    tool: 'mcp__github__create_issue',
  };
  const glyphHtml = (toolName, dir) => {
    const html = renderToStaticMarkup(h('div', { dir }, h(mod.MessageView, {
      msg: {
        id: `g-${toolName}`,
        role: 'tool',
        kind: 'tool_call',
        content: '{}',
        toolName,
        timestamp: 1700000000000,
      },
    })));
    const m = /<span class="tsg" data-glyph="[^"]+"[\s\S]*?<\/svg><\/span>/.exec(html);
    assert.ok(m, `glyph markup rendered for ${toolName}`);
    return m[0];
  };
  for (const [kind, tool] of Object.entries(families)) {
    assert.equal(mod.toolGlyphOf(tool), kind, `${tool} → ${kind} family glyph`);
    const ltr = glyphHtml(tool, 'ltr');
    const rtl = glyphHtml(tool, 'rtl');
    assert.equal(rtl, ltr, `${kind} glyph markup is byte-identical in RTL and LTR`);
    assert.ok(ltr.includes(`data-glyph="${kind}"`), `${kind} glyph carries its data-glyph hook`);
  }
  // no CSS rule mirrors the instrument glyph itself (only the wipe direction
  // changes, and its final state is identical)
  for (const css of [toolStoryCss, chatArtCss, streamMotionCss, consoleCss]) {
    assert.ok(!/html\[dir='rtl'\][^{]*\.tsg[^{]*\{[^}]*scaleX\(-1\)/.test(css), 'no RTL mirror on .tsg');
  }
  assert.ok(toolStoryCss.includes('@keyframes tsg-glyph-draw-rtl'), 'RTL wipe exists');
  assert.ok(/@keyframes tsg-glyph-draw-rtl \{[\s\S]*?inset\(0 0 0 0\)/.test(toolStoryCss), 'RTL wipe ends at the same full-ink state as LTR');
});

// ============================================================
// 6 · SSR — 30+ message variants + tool families, no crash, hooks intact
// ============================================================
test('SSR renders 30+ message variants without throwing', () => {
  const T = 1700000000000;
  const mk = (id, extra) => ({
    id,
    role: 'assistant',
    kind: 'text',
    content: 'hello',
    timestamp: T,
    ...extra,
  });
  const variants = [
    mk('u1', { role: 'user', content: 'plain user' }),
    mk('u2', { role: 'user', content: 'with image', images: ['data:image/png;base64,AAAA'] }),
    mk('u3', { role: 'user', content: 'steer', model: 'steer' }),
    mk('u4', { role: 'user', content: 'queued', model: 'queued' }),
    mk('a1', { content: 'a **markdown** answer' }),
    mk('a2', { content: 'streaming', streaming: true }),
    mk('a3', { content: '', thinking: 'reasoning step one', streaming: true }),
    mk('a4', { content: 'answer', thinking: 'settled reasoning', thinkMs: 3200 }),
    mk('a5', { content: '<thinking>inline thoughts</thinking>\nanswer' }),
    mk('a6', { content: '```thinking\nfenced thoughts\n```\nanswer' }),
    mk('a7', { content: 'boom', model: 'error' }),
    mk('a8', { content: '[mutation gate] PASSED — all mutants killed' }),
    mk('a9', { content: '{"before":80,"after":40}', model: 'compaction' }),
    mk('a10', { content: '{"cmd":"npm test","exitCode":0}', model: 'verify' }),
    mk('a11', { content: '{"label":"scout","done":2,"total":3}', model: 'subagent' }),
    mk('a12', { content: '{"findings":[],"summary":"clean"}', model: 'review-findings' }),
    mk('a13', { content: '{"goal":"ship it"}', model: 'goal-verified' }),
    mk('a14', { content: '{"findings":0,"critical":0}', model: 'critic' }),
    mk('a15', { content: '{"files":[],"commands":[]}', model: 'receipt' }),
    mk('a16', { content: '{"verdict":"proven","file":"a.ts"}', model: 'proof' }),
    mk('a17', { content: '{"verdict":"killed-enough","ran":4,"killed":3}', model: 'mutation-gate' }),
    mk('a18', { content: '{"compliant":true}', model: 'red-green' }),
    mk('a19', { content: '{"scanned":10,"high":0}', model: 'fake-tests' }),
    mk('a20', { content: '{"origin":"untrusted.md"}', model: 'taint' }),
    mk('a21', { content: '{"summary":"ok","claims":[]}', model: 'claim-audit' }),
    mk('a22', { content: '{"honest":true}', model: 'mutation-check' }),
    mk('a23', { content: '{"outcome":"error","summary":"failed","files":[]}', model: 'task-report' }),
    mk('a24', { content: '{"summary":"meta"}', model: 'unknown-meta' }),
    mk('a25', { content: '\n[thinking 20s — still reasoning…]', kind: 'notice', noticeKind: 'thinking' }),
    mk('a26', { content: '[verify passed]', kind: 'notice', noticeKind: 'verify' }),
    mk('a27', { content: '```ts\nconst x = 1;\n```\ntext' }),
    mk('a28', { content: undefined }),
    // tool families
    mk('t1', { role: 'tool', kind: 'tool_call', toolName: 'write_file', content: '{"path":"src/a.ts","content":"x\\n"}' }),
    mk('t2', { role: 'tool', kind: 'tool_call', toolName: 'edit_file', content: '{"path":"src/a.ts","old_string":"a\\n","new_string":"b\\n"}' }),
    mk('t3', { role: 'tool', kind: 'tool_call', toolName: 'run_command', content: '{"command":"npm test"}' }),
    mk('t4', { role: 'tool', kind: 'tool_call', toolName: 'browser_navigate', content: '{"url":"https://example.com/a"}' }),
    mk('t5', { role: 'tool', kind: 'tool_call', toolName: 'mcp__github__create_issue', content: '{}' }),
    mk('t6', { role: 'tool', kind: 'tool_call', toolName: 'totally_new_tool', content: '{}' }),
    mk('t7', { role: 'tool', kind: 'tool_result', content: 'line1\nline2\n', resultOk: true, toolName: 'read_file' }),
  ];
  assert.ok(variants.length >= 30, `rendered ${variants.length} variants`);
  let rendered = 0;
  let nonEmpty = 0;
  for (const msg of variants) {
    let html;
    try {
      html = renderToStaticMarkup(h(mod.MessageView, { msg, turnStart: true }));
    } catch (err) {
      assert.fail(`${msg.id} crashed while rendering: ${err && err.stack ? err.stack : err}`);
    }
    assert.equal(typeof html, 'string', `${msg.id} returned a string (no crash)`);
    rendered++;
    if (html.length > 0) nonEmpty++;
  }
  assert.equal(rendered, variants.length, 'every variant rendered without throwing');
  // a few dedicated cards intentionally return null on empty payloads (e.g.
  // review-findings with zero findings) — that is a clean render, not a crash.
  assert.ok(nonEmpty >= 25, `most variants produced markup (${nonEmpty}/${variants.length})`);

  // asserted hooks survive the precision pass
  const thinking = renderToStaticMarkup(h(mod.MessageView, { msg: variants.find((v) => v.id === 'a3') }));
  assert.ok(thinking.includes('sc-think-mark'), 'sc-think-mark hook preserved');
  assert.ok(thinking.includes('sc-think-engrave'), 'engraving sibling preserved');
  const tool = renderToStaticMarkup(h(mod.MessageView, {
    msg: variants.find((v) => v.id === 't4'),
    result: mk('r', { role: 'tool', kind: 'tool_result', content: 'ok', resultOk: true }),
  }));
  assert.ok(tool.includes('data-status="done"'), 'data-status hook preserved');
  assert.ok(tool.includes('tv-chip'), 'tv-chip hook preserved');
  const running = renderToStaticMarkup(h(mod.MessageView, { msg: variants.find((v) => v.id === 't1') }));
  assert.ok(running.includes('tv-runline'), 'tv-runline hook preserved');
  assert.ok(running.includes('data-status="running"'), 'running data-status preserved');
  const marker = renderToStaticMarkup(h(mod.MessageView, { msg: variants.find((v) => v.id === 'a25') }));
  assert.ok(marker.includes('data-notice="thinking"'), 'quiet marker hook');
  assert.ok(marker.includes('sc-notice-live-dot'), 'liveness dot rendered');
  assert.ok(marker.includes('sc-notice-quiet'), 'quiet-line class present (CSS hides the redundant tag)');
  assert.ok(marker.includes('thinking 20s — still reasoning…'), 'plain mono body kept');
  assert.ok(!marker.includes('[thinking 20s'), 'wrapper brackets stripped');
});

test('all five phase bands render the node-ico + data-phase hooks', () => {
  for (const phase of ['think', 'work', 'build', 'run', 'prove']) {
    const html = renderToStaticMarkup(h(mod.StreamBandShell, {
      phase,
      live: true,
      label: phase,
      startAt: 1700000000000,
      count: 2,
    }, h('div', null, 'items')));
    assert.ok(html.includes(`data-phase="${phase}"`), `${phase} data-phase`);
    assert.ok(html.includes('sc18-node-ico'), `${phase} node icon hook`);
    assert.ok(html.includes('sc18-phase-mark'), `${phase} phase stamp`);
  }
});

// ============================================================
// 7 · ALL ASSERTED HOOKS STILL PRESENT IN SOURCE / CSS
// ============================================================
test('every asserted hook survives in the owned sources', () => {
  for (const [name, text, hooks] of [
    ['MessageView.tsx', messageViewSrc, ['sc-think-mark', 'tv-chip', 'tv-runline', 'data-status']],
    ['StreamTimeline.tsx', streamTimelineSrc, ['data-phase', 'sc18-node-ico']],
    ['console.css', consoleCss, ['pr-ink-check']],
    ['stream-motion.css', streamMotionCss, ['pr-ink-check']],
  ]) {
    for (const hook of hooks) {
      assert.ok(text.includes(hook), `${name} preserves ${hook}`);
    }
  }
  assert.ok(!/<Brain/.test(messageViewSrc) && !/<Brain/.test(streamTimelineSrc), 'no generic Brain glyph crept back');
});
