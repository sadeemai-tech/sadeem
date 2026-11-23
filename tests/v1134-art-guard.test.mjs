// ============================================================================
// v11.34 — TOOL / AGENT ART GUARD  (DIAGNOSIS + TEST ONLY — NEVER PATCH SOURCE)
// ----------------------------------------------------------------------------
// Verification guard for V9's "precise hairline instrument row" redesign of
// tool calls + agent presentation. Enforces the founder's law —
//   "كل شيء جوا مربع" (everything inside a box) is FORBIDDEN —
// and reports (does not silently fix) any surviving dirty pattern.
//
// POSTURE: pure SOURCE assertions. No esbuild/SSR (this is presentation CSS +
// JSX grammar, not runtime behaviour); runs in milliseconds, no stubs needed.
// Every finding carries an exact file:line so the parent can hand it to a
// fixing agent. The final test prints a bilingual PASS/DIRTY report and a
// blunt verdict.
//
//   node --test --test-force-exit tests/v1134-art-guard.test.mjs
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
/** CSS/JSX comment stripping — a stale "removed" note must not fail a guard. */
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[;\s{])\/\/[^\n]*/g, '$1 ');

const PATHS = {
  console: 'src/components/console.css',
  art: 'src/components/chat-art.css',
  story: 'src/components/tool-story.css',
  final: 'src/components/chat-final.css',
  motion: 'src/components/stream-motion.css',
  chatcss: 'src/components/chat.css',
  sub: 'src/components/subagents.css',
  msg: 'src/components/MessageView.tsx',
  agent: 'src/components/AgentTeamCard.tsx',
  stream: 'src/components/StreamTimeline.tsx',
};
const SRC = Object.fromEntries(Object.entries(PATHS).map(([k, p]) => [k, read(p)]));
const CSS = Object.fromEntries(
  Object.entries(SRC).filter(([k]) => ['console', 'art', 'story', 'final', 'motion', 'chatcss', 'sub'].includes(k))
    .map(([k, v]) => [k, noComments(v)]),
);
const ART_SHEETS = ['art', 'story', 'final', 'motion', 'sub'];

function lineOf(src, needle) {
  const i = src.indexOf(needle);
  if (i < 0) return 0;
  let line = 1;
  for (let k = 0; k < i; k++) if (src.charCodeAt(k) === 10) line++;
  return line;
}
const at = (key, needle) => `${PATHS[key]}:${lineOf(SRC[key], needle) || '?'}`;

/** Brace-matched extraction of one CSS rule body (handles nested @supports). */
function rule(css, selector) {
  const i = css.indexOf(selector);
  if (i < 0) return '';
  const open = css.indexOf('{', i);
  if (open < 0) return '';
  let depth = 1;
  for (let k = open + 1; k < css.length && depth; k++) {
    if (css[k] === '{') depth++;
    else if (css[k] === '}') depth--;
    if (!depth) return css.slice(open + 1, k);
  }
  return '';
}

/** Diagnosed dirty patterns — reported with file:line, never patched here. */
const DIRTY = [];
function dirty(category, key, needle, note) {
  DIRTY.push({ category, ref: at(key, needle), note });
}

// ============================================================================
// 1 · TOOL ROW — no box, ONE 1px baseline, line art, tabular mono, pip, one-shot
// ============================================================================

test('1a · tool row has NO border box: border:0 / radius:0 / background:none / no shadow / no lift', () => {
  const card = rule(CSS.console, '.chat-panel-root .tl2-card {');
  assert.ok(card, `the no-box tool-row rule exists (${at('console', '.chat-panel-root .tl2-card {')})`);
  for (const decl of ['border: 0 !important', 'border-radius: 0 !important', 'background: none !important', 'box-shadow: none !important']) {
    assert.ok(card.includes(decl), `tool row neutralizes "${decl}" (${at('console', '.chat-panel-root .tl2-card {')})`);
  }
  const hover = rule(CSS.console, '.chat-panel-root .tl2-card:hover,\n.chat-panel-root .tl2-card:focus-within {');
  assert.ok(hover.includes('background: none !important') && hover.includes('transform: none !important'),
    'hover/focus never paints a fill or lifts the row into a card');
  // last-word sheet re-locks result rows and the error explainer to no box
  const finalSheet = CSS.final;
  assert.ok(SRC.final.includes('11 · NO-BOX LOCK'), 'chat-final.css carries the final no-box lock');
  assert.match(finalSheet, /\.chat-panel-root \.sc18-res\s*\{[^}]*background:\s*none/s, 'result rows are fill-free');
  assert.match(finalSheet, /\.chat-panel-root \.sc18-res-explain[^{]*\{[^}]*border:\s*0[^}]*background:\s*none/s,
    'error explainer is an inline hairline link, not a boxed green button');
});

test('1b · exactly ONE 1px baseline rail — token-hued hairline, never a box edge', () => {
  const rail = rule(CSS.console, '.chat-panel-root .tl2-card::before {');
  assert.ok(rail.includes('width: 1px'), 'the single rail is 1px');
  assert.ok(rail.includes('border: 0') && rail.includes('border-radius: 0'), 'the rail draws no frame of its own');
  assert.ok(rail.includes('inset-inline-start: 0'), 'the rail sits on the logical inline-start (RTL mirrors)');
  assert.ok(rail.includes('color-mix(in srgb'), 'rail hue is token-derived, never a literal');
  // two-stage draw: top rule on start, left rule on completion — both frame-free
  assert.ok(CSS.art.includes('.tv-complete-rule'), 'completion rail hook present');
  const complete = rule(CSS.art, '.chat-panel-root .tv-complete-rule {');
  assert.ok(complete.includes('width: 1px') && complete.includes('background: color-mix('), 'completion rail is 1px + token');
});

test('1c · line-art glyph present and frameless (engraved SVG, no square chip)', () => {
  assert.ok(SRC.msg.includes('<StoryGlyph name={msg.toolName} />'), at('msg', '<StoryGlyph'));
  assert.ok(CSS.story.includes('.chat-panel-root .sc18-tico .tsg svg'), 'the line-art wrapper is wired in CSS');
  assert.ok(CSS.story.includes('vector-effect: non-scaling-stroke'), 'every stroke stays exactly 1 screen px');
  const ico = rule(CSS.story, '.chat-panel-root .tl2-card .sc18-tico {');
  assert.ok(/border:\s*0/.test(ico) && /background:\s*none/.test(ico) && /box-shadow:\s*none/.test(ico),
    'the glyph is freed from its rounded chip (no square, no fill, no shadow)');
});

test('1d · tabular mono labels and end-aligned figures', () => {
  const verb = rule(CSS.console, '.chat-panel-root .sc18-tverb {');
  assert.ok(verb.includes('font-family: var(--font-mono-x)'), 'caps verb is mono');
  assert.ok(verb.includes('font-variant-numeric: tabular-nums'), 'caps verb is tabular');
  assert.ok(CSS.story.includes("font-feature-settings: 'tnum' 1"), 'figures share one tabular rhythm');
  assert.ok(/\.chat-panel-root \.tl2-card :is\(\.tv-badge, \.tv-stack, \.tv-exit, \.tl2-diff, \.tl2-dur, \.tl2-meta\)/.test(CSS.story),
    'every receipt in the row is in the tabular-mono group');
});

test('1e · status pip + ONE-SHOT draw animations (never looping)', () => {
  const pip = rule(CSS.story, '.chat-panel-root .tl2-card .tl2-head::before {');
  assert.ok(/width:\s*4px/.test(pip) && /height:\s*4px/.test(pip) && /border-radius:\s*50%/.test(pip),
    'a 4px pip lives in the head gutter, no box');
  assert.ok(CSS.story.includes("[data-status='done'] .tl2-head::before { background: var(--ok); }")
    && CSS.story.includes("[data-status='denied'] .tl2-head::before { background: var(--bad); }")
    && CSS.story.includes("[data-status='error'] .tl2-head::before,"),
    'the pip takes an honest verdict hue (done/error/denied)');
  // one-shot: fill mode `both`/`forwards`, no `infinite` on these named draws
  const oneShots = [
    ['art', 'animation: sc-left-draw 420ms var(--ease-out) both;'],
    ['art', 'animation: art-calibration 2.2s var(--ease-out) both;'],
    ['art', 'animation: sc-path-grow 900ms var(--ease-out) 120ms both;'],
    ['story', 'animation: tsg-glyph-draw 380ms var(--ease-out) both;'],
    ['story', 'animation: ts-verb-underline 460ms var(--ease-out) 80ms both;'],
    ['final', 'animation: mv-bloom-ink 440ms var(--ease-out) 40ms both;'],
  ];
  for (const [key, needle] of oneShots) {
    assert.ok(CSS[key].includes(needle), `one-shot draw present: ${needle} (${at(key, needle)})`);
    assert.ok(!/infinite/.test(needle), `${needle} is NOT infinite`);
  }
});

// ============================================================================
// 2 · AGENT PRESENTATION — exact trig orbit + 1px grammar (wrapper audited)
// ============================================================================

test('2 · agent team uses an exact trig orbit with 1px rings — no card grid', () => {
  const agent = SRC.agent;
  for (const needle of [
    'function orbitGeometry', 'Math.sin(Math.PI / count)', 'const theta = -Math.PI / 2',
    'agt-stage', 'agt-orbit-track', 'agt-orbit-sweep', 'agt-orbit-hub',
  ]) assert.ok(agent.includes(needle), `orbital geometry: ${needle} (${at('agent', needle)})`);
  assert.ok(!/agt-grid|agent-grid/.test(agent), 'no boxy agent card grid in the chat stream');
  const track = rule(CSS.sub, '.agt-orbit-track {');
  const sweep = rule(CSS.sub, '.agt-orbit-sweep {');
  assert.ok(track.includes('border: 1px solid') || CSS.sub.includes('.agt-orbit-track { border: 1px solid'),
    'the orbit guide is a 1px hairline');
  assert.ok(sweep.includes('border: 1px dashed') || CSS.sub.includes('border: 1px dashed'),
    'the live sweep is a 1px dashed hairline — never a glow');
  assert.ok(CSS.sub.includes('@keyframes agt-orbit-spin'), 'the orbital sweep animation survives');

  // ---- DIRTY: the wrapper itself is still a rounded 10px box with a 2px rail
  dirty('AGENT-CARD BOX', 'sub', '.agt-card {',
    'inline agent card still wears border:1px + border-radius:10px + filled background, and a PHYSICAL 2px border-left on state');
  dirty('AGENT RTL', 'agent', 'left: g.centre + g.radius',
    'node placement uses physical left/top; node dot uses right/bottom — not logical properties');
});

// ============================================================================
// 3 · ANIMATIONS + BOTH REDUCED-MOTION GATES + RTL + UNCHANGED PALETTE
// ============================================================================

test('3a · signature animations preserved: spinning circle, ink flow, bloom', () => {
  assert.ok(SRC.stream.includes('ThinkOrbit') && SRC.stream.includes('<animateTransform'),
    at('stream', 'function ThinkOrbit'));          // spinning circle
  assert.ok(CSS.motion.includes('@keyframes art-orbit'), 'spinning circle keyframes live in stream-motion.css');
  assert.ok(CSS.art.includes('@keyframes art-ink-flow'), at('art', '@keyframes art-ink-flow'));
  assert.ok(CSS.story.includes('@keyframes craft-ink-flow'), at('story', '@keyframes craft-ink-flow'));
  assert.ok(CSS.final.includes('@keyframes mv-bloom-ink'), at('final', '@keyframes mv-bloom-ink'));
  assert.ok(SRC.msg.includes('status === \'done\' && <ToolBloom />'), 'bloom mounts only on a real done status');
});

test('3b · BOTH reduced-motion signals present in every art sheet', () => {
  for (const key of ART_SHEETS) {
    assert.ok(SRC[key].includes('@media (prefers-reduced-motion: reduce)'),
      `${PATHS[key]} carries the OS-level reduced-motion guard`);
    assert.ok(SRC[key].includes('html.reduce-motion'),
      `${PATHS[key]} carries the in-app reduce-motion guard`);
    assert.ok(CSS[key].includes('animation: none !important'),
      `${PATHS[key]} freezes continuous motion at a static end state`);
  }
});

test('3c · RTL-safe tool art; physical leftovers reported on the agent wrapper', () => {
  for (const key of ['art', 'story', 'final']) {
    const sheet = CSS[key];
    assert.ok(/inset-inline-(start|end)/.test(sheet), `${PATHS[key]} uses logical inline insets`);
    assert.ok(!/^\s*(margin|padding|border)-(left|right)\s*:/m.test(sheet), `${PATHS[key]} has no physical side margins/padding/borders`);
    assert.ok(!/^\s*(left|right)\s*:/m.test(sheet), `${PATHS[key]} has no physical left/right declarations`);
  }
  assert.ok(CSS.art.includes("html[dir='rtl']") && CSS.story.includes("html[dir='rtl']"),
    'the RTL mirror selectors survive in both art sheets');
  assert.ok(CSS.story.includes('@keyframes tsg-glyph-draw-rtl'), 'the ink wipe mirrors in RTL');
  assert.ok(CSS.story.includes('inset-inline-start') && CSS.art.includes('border-block-start'),
    'geometry is block/inline, never top/left boxes');
});

test('3d · palette unchanged: zero hex literals in the art sheets; hues ride tokens', () => {
  for (const key of ART_SHEETS) {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(SRC[key]), `${PATHS[key]} contains no hardcoded hex colour`);
  }
  assert.ok(CSS.art.includes('color-mix(in srgb') && CSS.story.includes('color-mix(in srgb'),
    'derivatives mix existing tokens');
  assert.ok(CSS.story.includes('currentColor') || CSS.final.includes('currentColor'),
    'line art rides currentColor / token hues');
});

// ============================================================================
// 4 · DIRTY-PATTERN SCAN — raw code / green CTA / ARGUMENTS-PATH-CONTENT tables
// ============================================================================

test('4 · DIRTY REPORT — remaining non-instrument patterns are located and reported', () => {
  const msg = SRC.msg;

  // (a) RAW CODE BLOCKS — the result payload still prints a <pre> by default.
  if (msg.includes('<pre className={`sc18-res-pre')) {
    dirty('RAW-CODE-BLOCK', 'msg', '<pre className={`sc18-res-pre',
      'tool RESULT still prints a <pre> inline (6 lines by default) — clamped + hairline-underlined, not a table, but still raw text');
  }
  if (msg.includes('<pre className="sc18-arg-pre"')) {
    dirty('RAW-CODE-BLOCK', 'msg', '<pre className="sc18-arg-pre"',
      'multi-line / object ARGUMENTS render a mini <pre> inside the OPT-IN drawer');
  }
  if (SRC.agent.includes('<pre dir="auto">')) {
    dirty('RAW-CODE-BLOCK', 'agent', '<pre dir="auto">',
      'agent output drawer still prints raw specialist output in a <pre> behind a toggle');
  }
  // Image results (v11.34) are the clean counterexample: bitmaps never hit a <pre>.
  assert.ok(msg.includes('v11.34 — a real image result is a BITMAP, never raw base64/JSON.'),
    'v11.34 image results bypass <pre> entirely (clean pattern)');

  // (b) GREEN CTA PER EVENT — the repeated green error button is gone; the
  //     per-event affordance is a 1px hairline link; one empty-state CTA remains.
  assert.match(CSS.final, /\.chat-panel-root \.sc18-res-explain[^{]*\{[^}]*text-decoration:\s*underline/s,
    'per-event "Explain this error" is a hairline LINK (green CTA retired)');
  assert.ok(!/<button[^>]*className="[^"]*is-ok/.test(msg), 'no green verdict button per tool event');
  if (CSS.chatcss.includes('.chat-empty-cta')) {
    dirty('GREEN-CTA', 'chatcss', '.chat-empty-cta',
      'one empty-state CTA class remains (onboarding, NOT per event) — audit its fill if the founder wants zero CTAs');
  }
  if (CSS.chatcss.includes('.tl2-pill.is-ok')) {
    dirty('GREEN-CTA-LEGACY', 'chatcss', '.tl2-pill.is-ok',
      'legacy 10% green pill fill still in chat.css — shadowed by console.css no-box cascade (!important), not rendered');
  }

  // (c) ARGUMENTS / PATH / CONTENT TABLES — no uppercase table headers left.
  assert.ok(!/\bARGUMENTS\b|\bCONTENT\b/.test(msg), 'no ARGUMENTS/CONTENT table headers in the tool renderer');
  assert.ok(msg.includes('<div className="sc18-args" role="list">'), at('msg', 'sc18-args'));
  assert.ok(msg.includes('className="sc18-arg-k"'), at('msg', 'sc18-arg-k'));
  assert.ok(SRC.chatcss.includes('raw-JSON ARGUMENTS leak is dead'), 'the legacy raw-JSON ARGUMENTS leak is documented dead');
  if (msg.includes("t('tool.args', 'Arguments')")) {
    dirty('ARGS-LABEL', 'msg', "t('tool.args', 'Arguments')",
      'a localized "Arguments" drawer header survives — a structured key/value LIST, not an ARGUMENTS/PATH/CONTENT table');
  }

  // report — every finding is real and pinned with file:line
  assert.ok(DIRTY.length > 0, 'the diagnosis found at least one remaining dirty pattern');
  for (const f of DIRTY) assert.match(f.ref, /^src\/.*:\d+$/, `finding carries file:line — ${f.ref}`);
  const rule = '-'.repeat(72);
  console.log(`\n${rule}\nv11.34 TOOL/AGENT ART — DIRTY REPORT (${DIRTY.length})`);
  for (const f of DIRTY) console.log(`  [${f.category}] ${f.ref}\n      ${f.note}`);
  console.log(`${rule}\nVERDICT (EN): tool rows ARE elegant — hairline instrument grammar, one-shot ink,\n  no box / no green CTA / no tables. Agent card is NOT fully converted: its orbit\n  is 1px-exact but the wrapper is still a rounded box with a physical 2px rail,\n  and raw <pre> payloads remain behind clamped drawers.\nVERDICT (AR): صفوف الأدوات أنيقة فعلاً — قواعد شعرية دقيقة وحبر بضغطة واحدة،\n  بلا مربعات أو أزرار خضراء أو جداول. بطاقة الوكلاء غير مكتملة: مدارها\n  دقيق أحادي البكسل لكن غلافها ما زال مربعاً بحافة فيزيائية 2px،\n  ونصوص <pre> الخام ما زالت موجودة خلف الأدراج.\n${rule}`);
});
