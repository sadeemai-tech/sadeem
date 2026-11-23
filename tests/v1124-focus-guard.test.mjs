import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.24 — FOCUS-GUARD (diagnosis + test ONLY; never edits source)
//
// THE FOUNDER (verbatim intent):
//   "I did NOT tell you to shrink the whole screen and frame it. Keep natural
//    size — only remove the other sections."
//
// This guard locks the ONE behaviour focus mode is allowed to have:
//   * hide the work area (.work-slot-v12) and the splitter (.chat-resizer);
//   * let the one remaining chat slot fill the row at its NATURAL full size
//     (the flex:1 1 auto rule required by v1112-ui-fixes).
// It forbids every "reading column" artefact: shrunken measure, gutters,
// centering, frame, border/radius/shadow, backdrop, bloom, re-layout — on the
// chat panel or any descendant. Scanning is done on COMMENT-STRIPPED source
// with byte-length preserved, so indices map back to exact file:line.
// ============================================================

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const SHELL_REL = 'src/components/shell.css';
const TYPE_REL = 'src/components/type-scale.css';
const APP_REL = 'src/App.tsx';

const shellRaw = read(SHELL_REL);
const typeRaw = read(TYPE_REL);
const appRaw = read(APP_REL);

/** Replace comment bodies with spaces, preserving length + newlines so that
 *  character indices in the result are identical to the raw source. */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\r\n]/g, ' '));

const shell = stripComments(shellRaw);
const typeScale = stripComments(typeRaw);

/** 1-based line number for a character index in `src`. */
function lineAt(src, index) {
  let line = 1;
  const end = Math.min(index, src.length);
  for (let i = 0; i < end; i++) if (src[i] === '\n') line++;
  return line;
}

const RULE_RE = /([^{}]+)\{([^{}]*)\}/g;
function rules(css) {
  const out = [];
  for (const m of css.matchAll(RULE_RE)) {
    const leading = m[1].length - m[1].trimStart().length;
    out.push({
      selector: m[1].trim(),
      body: m[2],
      index: m.index,
      selectorStart: m.index + leading,
      bodyStart: m.index + m[0].indexOf('{') + 1,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/** Only flat rules whose selector is gated by html[data-focus='on']. */
function focusRules(css) {
  return rules(css).filter((r) => r.selector.includes("[data-focus='on']"));
}

const focus = focusRules(shell);

const declarations = (body) =>
  body.split(';').map((d) => d.trim()).filter(Boolean);

// The ONLY declarations focus mode may emit.
const ALLOWED_DECL = [
  /^display\s*:\s*none(\s*!important)?$/i,
  /^flex\s*:\s*1\s+1\s+auto(\s*!important)?$/i,
];

// Any of these inside a focus rule = regression to the rejected framed design.
// Lookbehind (?<![-a-z]) stops `width`/`height` from double-matching
// `max-width`/`min-width`/`max-height`.
const BANNED = [
  ['max-width (shrunken measure)',      /\bmax-width\s*:/i],
  ['min-width',                          /\bmin-width\s*:/i],
  ['width (artificial measure)',         /(?<![-a-z])width\s*:/i],
  ['height / max-height',                /(?<![-a-z])(?:max-)?height\s*:/i],
  ['padding / padding-inline (gutters)', /\bpadding(?:-[a-z-]+)?\s*:/i],
  ['margin',                             /\bmargin(?:-[a-z-]+)?\s*:/i],
  ['border / border-radius / frame',     /\bborder(?:-[a-z-]+)?\s*:/i],
  ['box-shadow',                         /\bbox-shadow\s*:/i],
  ['backdrop / backdrop-filter',         /\bbackdrop(?:-[a-z-]+)?\b/i],
  ['centering (justify/align/place)',    /\b(?:justify-content|align-items|place-content|align-content)\s*:/i],
  ['transform / scale',                  /\btransform\s*:/i],
  ['filter',                             /\bfilter\s*:/i],
  ['contain (transcript re-layout)',     /\bcontain\s*:/i],
  ['background / bloom',                 /\bbackground(?:-[a-z-]+)?\s*:/i],
  ['gradient bloom',                     /\b(?:radial|linear|conic)-gradient\s*\(/i],
  ['color-mix tint',                     /\bcolor-mix\s*\(/i],
  ['--focus-* measure tokens',           /--focus-[a-z-]*/i],
  ['frame/bloom palette tokens',         /--(?:sh-float|radius-lg|acc)\b/i],
];

/** Every restrictive declaration, annotated with its exact file:line. */
function restrictiveHits() {
  const hits = [];
  for (const r of focus) {
    for (const [label, re] of BANNED) {
      const global = re.flags.includes('g') ? re : new RegExp(re.source, re.flags + 'g');
      for (const m of r.body.matchAll(global)) {
        hits.push({
          file: SHELL_REL,
          line: lineAt(shellRaw, r.bodyStart + m.index),
          selector: r.selector,
          token: m[0].trim(),
          label,
        });
      }
    }
  }
  return hits;
}

const formatHits = (hits) =>
  hits.map((h) => `  ${h.file}:${h.line}  [${h.label}] "${h.token}"  in ${h.selector}`).join('\n');

// =============================================================
// 1 · Focus mode hides ONLY the work slot and the resizer.
// =============================================================
test('1a · work slot is hidden in focus mode', () => {
  const r = focus.find((x) => x.selector.includes('.work-slot-v12'));
  assert.ok(r, 'a focus rule targets .work-slot-v12');
  assert.match(r.body, /display\s*:\s*none\s*!important/i,
    'work slot is display:none !important');
});

test('1b · chat resizer is hidden in focus mode', () => {
  const r = focus.find((x) => x.selector.includes('.chat-resizer'));
  assert.ok(r, 'a focus rule targets .chat-resizer');
  assert.match(r.body, /display\s*:\s*none\s*!important/i,
    'resizer is display:none !important');
});

test('1c · hiding the work area + resizer is the ONLY focus behaviour', () => {
  const allowed = [
    (s) => s.includes('.app-main-row-v12') && s.includes('.chat-slot-v12'),
    (s) => s.includes('.chat-resizer'),
    (s) => s.includes('.app-main-row-v12') && s.includes('.work-slot-v12'),
  ];
  for (const r of focus) {
    assert.ok(allowed.some((ok) => ok(r.selector)),
      `no unexpected focus selector: ${r.selector}`);
  }
  assert.ok(focus.length >= 2 && focus.length <= 3,
    `expected 2–3 focus rules, found ${focus.length}`);
  for (const r of focus) {
    for (const decl of declarations(r.body)) {
      assert.ok(ALLOWED_DECL.some((re) => re.test(decl)),
        `focus rule ${r.selector} may not declare "${decl}"`);
    }
  }
});

// =============================================================
// 2 · No width constraint / gutter / frame / centering / backdrop anywhere.
// =============================================================
test('2 · ZERO restrictive declarations in the focus block', () => {
  assert.ok(focus.length > 0, 'focus rules were found to scan');
  const hits = restrictiveHits();
  assert.equal(hits.length, 0,
    `leftover restrictive rule(s) in focus mode (file:line):\n${formatHits(hits)}`);
  assert.ok(!/--focus-measure|--focus-inset|--focus-gutter|--focus-/.test(shell),
    'no --focus-* measure/inset/gutter tokens remain in shell.css');
});

// =============================================================
// 3 · Chat panel + descendants inherit NORMAL geometry (never re-styled).
// =============================================================
test('3 · chat panel inherits normal geometry; no framed reading column', () => {
  const RESTYLED = [
    'chat-panel-root', 'chat-head', 'chat-stream', 'composer-dock',
    'sc-focus-hint', 'chat-run-details', 'chat-passive-rows',
    'phase-strip', 'diffv',
  ];
  const FRAME_WORDS = /reading|measure|gutter|inset|frame|column|center/i;
  for (const r of focus) {
    for (const cls of RESTYLED) {
      assert.ok(!r.selector.includes(cls),
        `focus must not re-style .${cls} (found in "${r.selector}")`);
    }
    assert.ok(!FRAME_WORDS.test(r.selector),
      `no framed reading-column selector in focus mode: "${r.selector}"`);
  }
  assert.ok(!focus.some((r) => /chat-slot-v12\s*>\s*\.chat-panel-root/.test(r.selector)),
    'no framed chat-panel override in focus mode');
});

// =============================================================
// 4 · chat LEFT / rail TOP contract untouched.
// =============================================================
test('4a · normal chat-left / rail-top geometry survives in shell.css', () => {
  assert.match(shell, /\.app-main-row-v12\s*>\s*\.chat-slot-v12\s*\{[^}]*order:\s*1\s*;[^}]*flex:\s*0\s+0\s+auto/s,
    'chat slot keeps order:1 + flex:0 0 auto in normal mode');
  assert.match(shell, /\.app-main-row-v12\s*>\s*\.work-slot-v12\s*\{[^}]*order:\s*2\s*;[^}]*flex:\s*1\s+1\s+auto/s,
    'work slot keeps order:2 + flex:1 1 auto in normal mode');
  assert.match(shell, /\.app-rail-bar-v13\s*\{[^}]*width:\s*100%/s,
    'rail bar stays full-width (TOP)');
  assert.match(shell, /\.chat-slot-v12\s*>\s*\.chat-panel-root\s*\{[^}]*border-inline-end:\s*1px solid var\(--line\)/s,
    'chat panel keeps its NORMAL right hairline — focus adds no frame');
});

test('4b · JSX keeps rail at top and chat at left; mirrors data-focus', () => {
  assert.ok(appRaw.includes('{!focusMode && <Rail />}'),
    'rail still renders at TOP, hidden only in focus');
  assert.ok(appRaw.includes('const workArea = focusMode ? null : ('),
    'work area is removed (null) in focus, not shrunken');
  assert.ok(appRaw.includes('document.documentElement.dataset.focus = focusMode ? \'on\' : \'\''),
    'focus flag is mirrored onto <html> so the CSS actually matches');
  const chatIdx = appRaw.indexOf('className="chat-slot-v12');
  const workIdx = appRaw.indexOf('{workArea}');
  assert.ok(chatIdx > -1 && workIdx > chatIdx,
    'chat slot precedes the work area (chat LEFT) in the DOM');
});

// =============================================================
// 5 · Both reduced-motion guards intact.
// =============================================================
test('5 · both reduced-motion guards survive', () => {
  assert.match(shell, /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
    'shell.css OS reduced-motion guard intact');
  assert.match(typeScale, /html\.reduce-motion\s+\.brand-display/,
    'type-scale.css in-app reduce-motion guard intact');
  assert.match(typeScale, /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
    'type-scale.css OS reduced-motion guard intact');
});

// =============================================================
// 6 · REPORT — exact counts + any leftover restrictive rule (file:line).
// =============================================================
test('6 · REPORT — exact counts and restrictive leftovers', () => {
  const hits = restrictiveHits();
  const hideRules = focus.filter((r) => /display\s*:\s*none/i.test(r.body)).length;
  const flexRules = focus.filter((r) => /flex\s*:\s*1\s+1\s+auto/i.test(r.body)).length;
  const totalDecls = focus.reduce((n, r) => n + declarations(r.body).length, 0);
  const firstLine = focus.length ? lineAt(shellRaw, focus[0].selectorStart) : -1;
  const lastLine = focus.length
    ? lineAt(shellRaw, focus[focus.length - 1].end - 1) : -1;

  console.log('=== V1124 FOCUS-GUARD REPORT ===');
  console.log(`shell.css focus rules: ${focus.length}`);
  console.log(`  hide rules (display:none !important): ${hideRules}`);
  console.log(`  natural-size flex rules (flex:1 1 auto): ${flexRules}`);
  console.log(`  total declarations in focus rules: ${totalDecls}`);
  console.log(`  focus block line span: ${firstLine}–${lastLine}`);
  console.log(`restrictive declarations found: ${hits.length}`);
  if (hits.length) console.log(formatHits(hits));
  else console.log('  NONE — no leftover restrictive rule.');
  console.log('chat LEFT / rail TOP contract: asserted (test 4)');
  console.log('reduced-motion guards: asserted (test 5)');
  console.log('=== END REPORT ===');

  assert.equal(hits.length, 0,
    `focus mode must contain ZERO restrictive rules:\n${formatHits(hits)}`);
});
