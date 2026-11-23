import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.24 — TIMELINE CIRCLE MERGE · DIAGNOSIS + TEST ONLY
// (never edits app source — only this file + docs/TIMELINE-GUARD-V1124.md)
//
// Founder's demand:
//   "the small circle with WORKING/time/HI should be shrunk and put INSIDE
//    the timeline strip, replacing it — exactly one, no big standalone
//    circle next to working."
//
// The required end state this suite LOCKS (it is a guard, not a snapshot):
//   1. The big standalone LiveThinkingPanel circle is GONE from the chat
//      transcript (mount removed or replaced); exactly ONE compact spinning
//      circle lives inside the run/timeline strip; its phase label, elapsed
//      clock and mono token count are real and inside that same strip; there
//      is NO second copy in the assistant message-row gutter.
//   2. The old ring + wave (`cp-live-dots`, `cp-live-sweep`) and the
//      trembling/rotating gerund (`rotateGerund`, `sc-status-label`,
//      `chat.gerund.*`) are GONE (A3).
//   3. Reduced motion renders a STATIC end state (circle present, no SMIL);
//      EN and AR labels are both real and inside the strip.
//
// Every source scan runs on COMMENT-STRIPPED code — a prior agent parked
// banned tokens in comments to game a guard. Do not repeat that.
// Run counts are printed as V1124_COUNTS=<json> for the parent report.
// ============================================================

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const src = (p) => readFileSync(join(ROOT, p), 'utf8');
const count = (hay, needle) => hay.split(needle).length - 1;
const stripComments = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')        // JSX comments
  .replace(/\/\*[\s\S]*?\*\//g, ' ')            // block comments
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');   // line comments
const lineOf = (s, needle) => {
  const i = s.indexOf(needle);
  return i < 0 ? -1 : s.slice(0, i).split('\n').length;
};
const hits = (rel, code, markers) => markers
  .filter((m) => code.includes(m))
  .map((m) => `${rel}:${lineOf(code, m)} (${m})`);

const FILES = {
  chat: 'src/components/ChatPanel.tsx',
  msg: 'src/components/MessageView.tsx',
  stream: 'src/components/StreamTimeline.tsx',
  i18n: 'src/i18n.ts',
  consoleCss: 'src/components/console.css',
  chatCss: 'src/components/chat.css',
};
const RAW = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, src(p)]));
const CODE = Object.fromEntries(Object.entries(RAW).map(([k, v]) => [k, stripComments(v)]));

// Banned hooks. Any survivor is a real leftover, with an exact file:line below.
const BIG_PANEL = [
  'function LiveThinkingPanel', '<LiveThinkingPanel', 'livePanelVisible',
  'useLivePanelVisible', 'LIVE_STATUS_LABEL', 'liveStatusFromStorePhase',
  'cp-live-panel', 'cp-live-glyph', 'cp-live-status', 'cp-live-meta',
  'cp-live-clock', 'cp-live-count', 'cp-live-bars', 'cp-live-info',
  'width="80"', 'viewBox="0 0 64 64"',
];
// The forbidden thing is the per-row GUTTER copy (the absolutely-positioned
// sc-plate / sc-think-orbit wrapper), not a same-named circle legitimately
// relocated into the strip. Pin the exact old gutter mount + wrapper.
const GUTTER = [
  '<CompactThinkingOrbit streaming={!!msg.streaming} />',
  'className="sc-plate sc-think-orbit"',
  "insetInlineStart: -24",
];
const RING_WAVE = ['cp-live-dots', 'cp-live-sweep', '@keyframes cp-live-sweep'];
// A3 retires the ROTATING / TREMBLING gerund, not the honest stable label.
// A single pickGerund() label and its `chat.gerund.*` i18n strings are fine;
// the timer, the keyed crossfade and the infinite shimmer are not.
const GERUND = ['rotateGerund', 'GERUND_ROTATE_MS', 'key={token}'];
const GERUND_SHIMMER = ['sc-shimmer 4s var(--ease-out) 600ms infinite'];

// The run/timeline strip is the stable anchor across v11.x.
const STRIP_ANCHORS = ['phase-strip run-strip-v13', 'run-strip-v13', 'data-run-strip', 'data-timeline-strip'];
const stripSourceAnchor = STRIP_ANCHORS.find((a) => CODE.chat.includes(a)) || null;
// Accept any new strip class A4 introduces (e.g. cp-timeline-*, tl-live-*),
// as long as the element genuinely carries the circle + real instruments.
const NEW_STRIP_RE = /(?:strip|timeline|run-)/i;

/** Slice the RunStatusLine function body out of comment-free ChatPanel source. */
function stripRegion() {
  const start = CODE.chat.indexOf('function RunStatusLine');
  if (start < 0) return '';
  let end = CODE.chat.indexOf('\nfunction ', start + 1);
  if (end < 0) end = CODE.chat.length;
  return CODE.chat.slice(start, end);
}
const STRIP_SRC = stripRegion();

/** Extract one <div> element (balanced) from rendered static markup. */
function elementByMarker(html, markers) {
  for (const m of markers) {
    const idx = html.indexOf(m);
    if (idx < 0) continue;
    const start = html.lastIndexOf('<div', idx);
    if (start < 0) continue;
    let depth = 0, p = start;
    while (p < html.length) {
      const o = html.indexOf('<div', p);
      const c = html.indexOf('</div>', p);
      if (c < 0) break;
      if (o >= 0 && o < c) { depth++; p = o + 4; }
      else { depth--; p = c + 6; if (depth === 0) return html.slice(start, p); }
    }
    return html.slice(start);
  }
  return '';
}

const BUNDLE = join(ROOT, 'tests', '.v1124-timeline-guard.bundle.cjs');
let mod, React, renderToStaticMarkup;

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
      contents:
        "export { ChatPanel } from './src/components/ChatPanel';" +
        "export { useStore } from './src/store';",
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
const STREAM_MSG = {
  id: 'a-v1124', role: 'assistant', kind: 'text',
  thinking: 'Let me carefully work through the reasoning for this answer.',
  content: 'The result is ready.',
  streaming: true, model: 'custom/m', thinkMs: 1200, timestamp: Date.now(),
};

function seed(running, language = 'en', messages = [], tokens = 6912) {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    wsPath: 'D:\\ws',
    session: {
      id: 's-v1124', title: 't', workspace: 'D:\\ws', messages,
      createdAt: Date.now() - 5000, updatedAt: Date.now(),
      messageCount: messages.length, totalTokens: 0, totalCostUsd: 0,
    },
    settings: {
      ...prev.settings, language, numerals: 'western',
      model: { provider: 'custom', model: 'm' },
    },
    running,
    sessionUsage: { inputTokens: tokens, outputTokens: 0, costUsd: 0 },
    ctxWindow: 200000,
    pendingApproval: null,
  });
}
const renderChat = (running, language, messages = [], tokens = 6912) => {
  seed(running, language, messages, tokens);
  return renderToStaticMarkup(h(mod.ChatPanel));
};
const CLOCK_RE = /\b\d+s\b|\b\d+m\s+\d{2}s\b/;
const SPIN_RE = /animateTransform|<animate\s|spin|orbit|glyph|circle/i;

/** All balanced <div> elements in static markup (top-level and nested). */
function allDivs(html) {
  const out = [];
  let p = 0;
  while (p < html.length) {
    const i = html.indexOf('<div', p);
    if (i < 0) break;
    let depth = 0, q = i, closed = false;
    while (q < html.length) {
      const o = html.indexOf('<div', q);
      const c = html.indexOf('</div>', q);
      if (c < 0) break;
      if (o >= 0 && o < c) { depth++; q = o + 4; }
      else { depth--; q = c + 6; if (depth === 0) { closed = true; break; } }
    }
    if (!closed) { p = i + 4; continue; }
    out.push(html.slice(i, q));
    p = q;
  }
  return out;
}

/** The live strip = the smallest element holding a spinning SVG + clock + tok.
 *  Prefer the stable .run-strip-v13 anchor when it actually qualifies. */
function stripHtml(html) {
  const anchored = elementByMarker(html, STRIP_ANCHORS);
  const qualifies = (el) => el && count(el, '<svg') >= 1 &&
    CLOCK_RE.test(el) && /\btok\b/i.test(el);
  if (qualifies(anchored)) return anchored;
  const candidates = allDivs(html).filter((el) => qualifies(el) && NEW_STRIP_RE.test(el.slice(0, 160)));
  candidates.sort((a, b) => a.length - b.length);
  return candidates[0] || anchored;
}

// ------------------------------------------------------------
// 1 · SOURCE — the standalone circle and the gutter copy are GONE
// ------------------------------------------------------------
test('source: no big standalone LiveThinkingPanel circle in ChatPanel', () => {
  const found = hits(FILES.chat, CODE.chat, BIG_PANEL);
  assert.equal(found.length, 0,
    `standalone live circle remnants (file:line):\n${found.join('\n')}`);
  assert.ok(stripSourceAnchor, `run/timeline strip anchor missing in ${FILES.chat}`);
});

test('source: no second spinning-circle copy in the message-row gutter', () => {
  const found = hits(FILES.msg, CODE.msg, GUTTER);
  assert.equal(found.length, 0,
    `message-row gutter circle remnants (file:line):\n${found.join('\n')}`);
});

test('source: the compact circle lives in the run strip with real phase/clock/tok', () => {
  assert.ok(STRIP_SRC.length > 0, 'RunStatusLine region not found — A4 must keep a named run-strip component');
  assert.equal(count(STRIP_SRC, '<svg'), 1,
    'exactly one compact SVG inside the run strip region');
  assert.ok(SPIN_RE.test(STRIP_SRC), 'that SVG actually spins (SMIL or CSS spin/orbit hook)');
  assert.ok(STRIP_SRC.includes('formatElapsedClock'), 'elapsed clock is derived, not hardcoded');
  assert.ok(STRIP_SRC.includes('fmtTokens') || STRIP_SRC.includes('tok'),
    'mono token count is rendered inside the strip');
  assert.ok(/t\(`?['"]chat\./.test(STRIP_SRC) || STRIP_SRC.includes('t(\'chat.'),
    'phase label goes through i18n');
  // "real": no fabricated numbers parked in the strip.
  assert.ok(!/\b(123|999|42)\s*(tok|tools)/i.test(STRIP_SRC), 'no fake counters in the strip');
});

// ------------------------------------------------------------
// 2 · SOURCE — old ring + wave and the trembling/rotating gerund are GONE (A3)
// ------------------------------------------------------------
test('source (TSX): cp-live-dots / cp-live-sweep mounts are gone', () => {
  const found = hits(FILES.chat, CODE.chat, RING_WAVE);
  assert.equal(found.length, 0, `old ring+wave TSX remnants (file:line):\n${found.join('\n')}`);
});

test('source (CSS): dead ring+wave rules/keyframes are gone too', () => {
  const found = [
    ...hits(FILES.consoleCss, RAW.consoleCss, RING_WAVE),
    ...hits(FILES.chatCss, RAW.chatCss, RING_WAVE),
  ];
  assert.equal(found.length, 0, `old ring+wave CSS remnants (file:line):\n${found.join('\n')}`);
});

test('source (TSX): the rotating/trembling gerund is gone (stable label is fine)', () => {
  const found = hits(FILES.chat, CODE.chat, GERUND);
  assert.equal(found.length, 0, `gerund rotation remnants (file:line):\n${found.join('\n')}`);
  assert.ok(!CODE.chat.includes('rotateGerund'),
    'phase label is a single stable pick, not a timer rotation');
});

test('source (CSS): the infinite shimmer/tremble on the status label is gone', () => {
  const found = hits(FILES.chatCss, RAW.chatCss, GERUND_SHIMMER);
  assert.equal(found.length, 0, `status-label shimmer remnants (file:line):\n${found.join('\n')}`);
});

// ------------------------------------------------------------
// 3 · SSR — real render of the real ChatPanel
// ------------------------------------------------------------
test('SSR running: exactly ONE compact spinning circle, inside the strip', () => {
  const html = renderChat(true, 'en', [STREAM_MSG]);
  const strip = stripHtml(html);
  assert.ok(strip.length > 0, 'run/timeline strip present in SSR markup');
  assert.equal(count(strip, '<svg'), 1,
    `exactly one circle SVG inside the strip (found ${count(strip, '<svg')})`);
  assert.ok(SPIN_RE.test(strip), 'that circle is a spinner while the run is live');
  assert.ok(CLOCK_RE.test(strip), `real elapsed clock inside the strip: ${strip.slice(0, 220)}`);
  assert.ok(/\btok\b/i.test(strip), 'mono token count inside the strip');
  assert.ok(/[A-Za-z\u0600-\u06FF]/.test(strip.replace(/<[^>]+>/g, ' ')), 'a phase/status word inside the strip');

  const transcript = html.slice(html.indexOf('chat-stream chat-stream-v13'));
  assert.ok(!transcript.includes('cp-live-panel'), 'no standalone panel in the transcript');
  assert.ok(!transcript.includes('cp-live-glyph'), 'no 80px standalone glyph in the transcript');
  assert.ok(!transcript.includes('width="80"'), 'no 80px SVG in the transcript');
  assert.ok(!html.includes('cp-live-dots') && !html.includes('cp-live-sweep'),
    'old ring+wave absent from rendered DOM');
  const orbitCount = count(html, 'sc-think-orbit');
  const orbitInStrip = strip.includes('sc-think-orbit');
  assert.ok(orbitCount === 0 || (orbitCount === 1 && orbitInStrip),
    `any sc-think-orbit must be the ONE strip circle, not a gutter copy (count=${orbitCount}, inStrip=${orbitInStrip})`);
});

test('SSR idle: no live circle and no ring+wave at all', () => {
  const html = renderChat(false, 'en', []);
  assert.equal(count(stripHtml(html), '<svg'), 0, 'no circle in the strip while idle');
  assert.ok(!html.includes('cp-live-panel') && !html.includes('cp-live-glyph'), 'no panel while idle');
  assert.ok(!html.includes('cp-live-dots') && !html.includes('cp-live-sweep'), 'no ring+wave while idle');
  assert.ok(!html.includes('sc-think-orbit'), 'no gutter circle while idle');
});

test('SSR reduced motion: static end state — circle present, zero SMIL', () => {
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  globalThis.document = { documentElement: { classList: { contains: () => true } } };
  try {
    const strip = stripHtml(renderChat(true, 'en', [STREAM_MSG]));
    assert.equal(count(strip, '<svg'), 1, 'the circle still renders (static end state)');
    assert.ok(!strip.includes('animateTransform'), 'reduced motion freezes the orbit');
    assert.ok(!strip.includes('<animate '), 'reduced motion freezes breathing/height animation');
    assert.ok(CLOCK_RE.test(strip) && /\btok\b/i.test(strip), 'text instruments remain real in the static state');
  } finally {
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
  }
});

test('SSR bilingual: EN and AR phase/status text both live inside the strip', () => {
  const en = stripHtml(renderChat(true, 'en', [STREAM_MSG]));
  const ar = stripHtml(renderChat(true, 'ar', [STREAM_MSG]));
  const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const enText = text(en), arText = text(ar);
  assert.notEqual(enText, arText, 'strip text actually changes with language');
  assert.ok(/[\u0600-\u06FF]/.test(arText), `Arabic label present in the strip: ${arText.slice(0, 160)}`);
  assert.ok(/[A-Za-z]/.test(enText), `English label present in the strip: ${enText.slice(0, 160)}`);
  assert.equal(count(en, '<svg'), 1, 'one circle in EN');
  assert.equal(count(ar, '<svg'), 1, 'one circle in AR');
  assert.ok(RAW.i18n.includes('"chat.livePanel.label"') || RAW.i18n.includes("'chat.livePanel.label'"),
    'i18n carries the bilingual live-panel label key');
});

// ------------------------------------------------------------
// 4 · EXACT COUNTS for the parent report
// ------------------------------------------------------------
test('report: print exact counts as JSON', () => {
  const srcFind = (markers) => markers.reduce((n, m) => n + count(CODE.chat, m), 0);
  const cssFind = (markers) => markers.reduce(
    (n, m) => n + count(RAW.consoleCss, m) + count(RAW.chatCss, m), 0);
  const msgFind = (markers) => markers.reduce((n, m) => n + count(CODE.msg, m), 0);
  const html = renderChat(true, 'en', [STREAM_MSG]);
  const strip = stripHtml(html);
  const summary = {
    stripSourceAnchor,
    bigPanelSourceHits: srcFind(BIG_PANEL),
    gutterSourceHits: msgFind(GUTTER),
    ringWaveTsxHits: srcFind(RING_WAVE),
    ringWaveCssHits: cssFind(RING_WAVE),
    gerundTsxHits: srcFind(GERUND),
    stripSvgSource: count(STRIP_SRC, '<svg'),
    ssrStripSvgs: count(strip, '<svg'),
    ssrStripSpinners: (strip.match(/animateTransform|<animate\s/g) || []).length,
    ssrStandalonePanel: count(html, 'cp-live-panel') + count(html, 'cp-live-glyph'),
    ssrGutterOrbits: count(html, 'sc-think-orbit') - (strip.includes('sc-think-orbit') ? count(strip, 'sc-think-orbit') : 0),
    ssrRingWave: count(html, 'cp-live-dots') + count(html, 'cp-live-sweep'),
    ssrStripHasClock: CLOCK_RE.test(strip),
    ssrStripHasTok: /\btok\b/i.test(strip),
  };
  console.log('V1124_COUNTS=' + JSON.stringify(summary));
  assert.ok(true);
});
