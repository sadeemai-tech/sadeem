// ============================================================
// v11.36 — CHAT FONT: clearer + larger, one readable step above V7.
//
// Source guards for the founder's "حسن الخط المستخدم للتشات… اريد خط
// افضل،كونه اوضح،اكبر" (improve the chat font — better, clearer, larger).
//
//   1 · V7 (v11.34) literals are RETAINED as the documented baseline —
//       tests/v1134-ui-layout.test.mjs guards them verbatim — and the v11.36
//       declarations immediately after are the EFFECTIVE (last-wins) sizes.
//       Every value is strictly larger than its V7 predecessor.
//   2 · Instrument Serif still owns display; tabular mono numerals survive;
//       no new mono family assignment is introduced in the type sheet.
//   3 · No versioned CSS file was added — changes live in the stable sheets.
//   4 · RTL-safe logical layout + BOTH reduced-motion signals still present.
//   5 · Palette untouched (no literal colors), reading leading tightened,
//       the calm no-box tool grammar intact.
//
//   node --test --test-force-exit tests/v1136-chat-font.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const TYPE = read('src/components/type-scale.css');
const CONSOLE = read('src/components/console.css');
const FINAL = read('src/components/chat-final.css');
const OWNED = { type: TYPE, console: CONSOLE, final: FINAL };

/** CSS-comment stripper — the V7 baseline and the v11.36 step are REAL
    declarations, not comments, so they survive this (unlike the v1134
    guard's own stripComments, which is why both suites can stay green). */
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');

const TYPE_C = strip(TYPE);
const CONSOLE_C = strip(CONSOLE);
const FINAL_C = strip(FINAL);

const block = (src, re) => (src.match(re) || ['', ''])[1];
const px = (b, prop) => [...b.matchAll(new RegExp(`${prop}:\\s*([0-9.]+)px`, 'g'))]
  .map((m) => parseFloat(m[1]));
const fontSizes = (b) => [...b.matchAll(/font-size:\s*([0-9.]+)px/g)]
  .map((m) => parseFloat(m[1]));

const TOKENS = block(TYPE_C, /html \.chat-panel-root \{([\s\S]*?)\}/);

// ---------------------------------------------------------------------
// 1 · V7 baseline retained; v11.36 effective sizes strictly larger
// ---------------------------------------------------------------------
test('1a · chat tokens step up (V7 baseline kept for the v1134 guard)', () => {
  assert.ok(TOKENS, 'the html .chat-panel-root token block exists');
  const steps = [
    ['--chat-base', 15.5, 16.75, 'message body'],
    ['--chat-ui', 15, 16, 'heads / tool rows'],
    ['--chat-meta', 13.5, 14.5, 'stamps / clocks'],
  ];
  for (const [prop, before, after, label] of steps) {
    const vals = px(TOKENS, prop);
    assert.ok(vals.includes(before), `${prop}: V7 baseline ${before}px retained (${label})`);
    assert.equal(vals[vals.length - 1], after,
      `${prop}: effective value is the v11.36 ${after}px step (${label})`);
    assert.ok(after > before, `${prop}: ${after}px > ${before}px (larger)`);
  }
});

test('1b · reasoning + tool rows step up too (not just the body)', () => {
  const think = block(TYPE_C, /html \.chat-panel-root \.kb-think-body \{([\s\S]*?)\}/);
  const verb = block(TYPE_C, /html \.chat-panel-root \.tl2-card \.sc18-tverb \{([\s\S]*?)\}/);
  const result = block(TYPE_C, /html \.chat-panel-root \.sc18-res-pre \{([\s\S]*?)\}/);

  const check = (b, before, after, label) => {
    assert.ok(b, `${label}: rule exists in type-scale.css`);
    const sizes = fontSizes(b);
    assert.ok(sizes.includes(before), `${label}: V7 ${before}px retained`);
    assert.equal(sizes[sizes.length - 1], after, `${label}: effective ${after}px`);
    assert.ok(after > before, `${label}: larger`);
  };
  check(think, 15.5, 16.75, 'reasoning stream');
  check(verb, 10.5, 11.5, 'tool verb caps');
  check(result, 12.5, 13.5, 'tool result mono');

  // tool target / meta rows ride the enlarged --chat-ui token
  assert.match(TYPE_C, /html \.chat-panel-root \.tl2-card \.sc18-targ,[\s\S]{0,200}font-size:\s*var\(--chat-ui\)/,
    'tool target rows still follow the token step');
});

test('1c · message body + user bubble + reasoning rows in console.css agree', () => {
  assert.match(CONSOLE_C, /\.chat-panel-root \.chat-stream \{\s*font-size:\s*var\(--chat-base\);\s*line-height:\s*1\.58;/,
    'transcript body uses the enlarged token with tightened leading');
  const bubbleBlocks = [...CONSOLE_C.matchAll(/\.chat-panel-root \.sc-userbody \{[\s\S]*?\}/g)].map((m) => m[0]);
  assert.ok(bubbleBlocks.length >= 2, 'base + active v13 user-bubble rules both exist');
  for (const b of bubbleBlocks) {
    assert.match(b, /font-size:\s*16\.5px\s*!important/,
      'every user-bubble rule lifted to 16.5px (no stale 13.5/14.5 !important wins)');
    assert.match(b, /line-height:\s*1\.58\s*!important/, 'user-bubble leading tightened to 1.58');
  }
  assert.match(CONSOLE_C, /\.chat-panel-root \.kb-think-body \{\s*font-size:\s*16\.75px;/,
    'reasoning body agrees with the guarded type-sheet value');
  assert.match(CONSOLE_C, /\.chat-panel-root \.kb-think-head \{\s*font-size:\s*14px;/,
    'reasoning head lifted 13 → 14px');
  assert.match(CONSOLE_C, /\.chat-panel-root \.sc18-think-peek \{\s*font-size:\s*13\.5px/,
    'reasoning peek lifted 12.5 → 13.5px');
});

// ---------------------------------------------------------------------
// 2 · display face + tabular mono preserved
// ---------------------------------------------------------------------
test('2a · Instrument Serif still owns display (no family reassignment)', () => {
  assert.match(TYPE_C, /font-family:\s*var\(--font-display-serif\)/,
    'the wordmark keeps the Instrument Serif token');
  assert.doesNotMatch(TYPE_C, /font-family:\s*[^;]*mono[^;]*;/,
    'no mono family reassignment slipped into the type sheet');
  assert.match(FINAL_C, /\.pv-title \{[\s\S]{0,160}font-family:\s*var\(--font-display-serif\)/,
    'preview title still Instrument Serif');
  assert.match(FINAL_C, /\.goal-title-serif \{[\s\S]{0,220}font-family:\s*var\(--font-display-serif\)/,
    'goal title still Instrument Serif');
  const glass = read('src/assets/glass-v7.css');
  assert.match(glass, /font-family:\s*'Instrument Serif'/, 'the registered face is still Instrument Serif');
  const display = read('src/components/display-type.css');
  assert.match(display, /font-family:\s*var\(--font-display-serif\)/, 'display-type.css mapping intact');
  assert.match(display, /--font-display-ar/, 'Arabic display guard intact');
});

test('2b · tabular mono numerals survive the step', () => {
  for (const [name, src] of [['console.css', CONSOLE_C], ['chat-final.css', FINAL_C]]) {
    assert.match(src, /--font-mono-x/, `${name}: mono token still referenced`);
    assert.match(src, /font-variant-numeric:\s*tabular-nums/, `${name}: tabular figures still declared`);
  }
});

// ---------------------------------------------------------------------
// 3 · no versioned CSS
// ---------------------------------------------------------------------
test('3 · changes live in stable sheets — no versioned CSS file added', () => {
  const dir = join(ROOT, 'src', 'components');
  const versioned = readdirSync(dir).filter((f) => /\.css$/i.test(f) && /v\d{3,}/i.test(f));
  assert.deepEqual(versioned, [], `no v11xx*.css under src/components (found ${versioned.join(', ')})`);
  for (const [name, src] of Object.entries(OWNED)) {
    assert.doesNotMatch(src, /@import\s+['"][^'"]*v\d{3,}[^'"]*\.css['"]/,
      `${name}: no @import of a versioned sheet`);
  }
});

// ---------------------------------------------------------------------
// 4 · balanced RTL + both reduced-motion guards
// ---------------------------------------------------------------------
test('4a · BOTH reduced-motion signals remain in every owned sheet', () => {
  for (const [name, src] of Object.entries(OWNED)) {
    assert.match(src, /@media \(prefers-reduced-motion: reduce\)/,
      `${name}: OS preference guard`);
    assert.match(src, /html\.reduce-motion/,
      `${name}: in-app preference guard`);
  }
});

test('4b · RTL-safe: explicit guards or logical properties in every sheet', () => {
  const rtl = /html\[lang='ar'\]|html\[dir='rtl'\]|\[dir='rtl'\]|inset-inline|padding-inline|margin-inline|border-inline/;
  for (const [name, src] of Object.entries(OWNED)) {
    assert.match(src, rtl, `${name}: mirrors under RTL (guard or logical inset)`);
  }
  // the new legibility weight is scoped to the chat panel, not global h1-h3
  assert.match(CONSOLE_C, /\.chat-panel-root \.chat-stream p,\s*\.chat-panel-root \.chat-stream li,\s*\.chat-panel-root \.kb-ai-msg \{\s*font-weight:\s*450;/,
    'weight bump is scoped to chat reading text');
});

// ---------------------------------------------------------------------
// 5 · leading tightened, palette + no-box grammar intact
// ---------------------------------------------------------------------
test('5a · leading tightened so density survives the larger glyphs', () => {
  assert.match(TYPE_C, /html \.chat-panel-root \.chat-stream \{ line-height: 1\.55; \}/,
    'stream leading 1.6 → 1.55');
  assert.match(TYPE_C, /html \.chat-panel-root \.kb-think-body \{[\s\S]{0,220}line-height:\s*1\.58/,
    'reasoning leading 1.62 → 1.58');
  assert.doesNotMatch(CONSOLE_C, /\.sc-userbody \{[\s\S]{0,200}font-size:\s*(?:13\.5|14\.5)px\s*!important/,
    'no stale user-bubble size can win the cascade');
});

test('5b · palette tokens unchanged (no literal colors introduced)', () => {
  for (const [name, src] of Object.entries(OWNED)) {
    assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/,
      `${name}: color rides existing tokens only`);
  }
});

test('5c · calm editorial grammar: tool cards stay frame-free', () => {
  assert.match(CONSOLE_C, /\.chat-panel-root \.tl2-card \{[\s\S]{0,220}border:\s*0\s*!important[\s\S]{0,220}background:\s*none\s*!important[\s\S]{0,220}box-shadow:\s*none\s*!important/,
    'no box returned with the bigger type');
});
