import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.24 — FOCUS MODE: natural size, other sections simply GONE.
//
// The founder (angry): "I did NOT tell you to shrink the whole screen and put
// it in a frame. Keep it at its natural size, just REMOVE the other sections."
//
// This is a SOURCE-LEVEL guard on the two CSS files that own focus mode:
//   src/components/shell.css      — the focus rules themselves
//   src/components/type-scale.css — must contain NO focus rules at all
//
// Required end state:
//   * focus mode hides ONLY the work slot and the chat resizer;
//   * the chat slot, if it has a focus rule at all, may only grow to fill the
//     row (flex: 1 1 auto !important) — required by v1112-ui-fixes — and must
//     carry NO width/max-width/padding/border/shadow/margin/gradient/backdrop;
//   * the chat PANEL and all of its descendants are never re-styled in focus;
//   * both reduced-motion guards and the palette are untouched; no versioned
//     CSS is introduced.
//
// All scans run on COMMENT-STRIPPED source so a banned token cannot be parked
// inside a comment (a prior agent tried that trick — see v1123-graphics-guard).
// ============================================================

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');

const SHELL_PATH = 'src/components/shell.css';
const TYPE_PATH = 'src/components/type-scale.css';
const shellRaw = read(SHELL_PATH);
const typeRaw = read(TYPE_PATH);
const shell = stripComments(shellRaw);
const typeScale = stripComments(typeRaw);

/** Every flat CSS rule in `css`, as { selector, body }. */
const RULE_RE = /([^{}]+)\{([^{}]*)\}/g;
function rules(css) {
  const out = [];
  for (const m of css.matchAll(RULE_RE)) {
    out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

/** Only rules whose selector is gated by html[data-focus='on']. */
function focusRules(css) {
  return rules(css).filter((r) => r.selector.includes("[data-focus='on']"));
}

const focus = focusRules(shell);

/** Split a declaration block into its individual declarations. */
const declarations = (body) =>
  body.split(';').map((d) => d.trim()).filter(Boolean);

// The ONLY declarations focus mode is allowed to emit. `display:none` hides
// the other sections; `flex:1 1 auto` lets the one remaining chat slot fill
// the row at its natural full size (never a shrunken 900px framed column).
const ALLOWED_DECL = [
  /^display\s*:\s*none(\s*!important)?$/i,
  /^flex\s*:\s*1\s+1\s+auto(\s*!important)?$/i,
];

// Any of these in a focus rule is a regression back to the rejected design.
const BANNED = [
  [/\bmax-width\s*:/i, 'max-width (shrunken measure)'],
  [/\bmin-width\s*:/i, 'min-width'],
  [/\bwidth\s*:/i, 'width (artificial measure)'],
  [/\bpadding(?:-[\w-]+)?\s*:/i, 'padding / gutters'],
  [/\bmargin(?:-[\w-]+)?\s*:/i, 'margin'],
  [/\bborder(?:-[\w-]+)?\s*:/i, 'border / border-radius / frame'],
  [/\bbox-shadow\s*:/i, 'box-shadow'],
  [/\bbackdrop\b/i, 'backdrop'],
  [/\bbackground(?:-[\w-]+)?\s*:/i, 'background / bloom'],
  [/\b(?:radial|linear|conic)-gradient\b/i, 'gradient bloom'],
  [/\bcolor-mix\s*\(/i, 'color-mix tint'],
  [/\bjustify-content\s*:/i, 'justify-content (centering)'],
  [/\balign-items\s*:/i, 'align-items (centering)'],
  [/\bcontain\s*:/i, 'contain (transcript re-layout)'],
  [/\bfilter\s*:/i, 'filter'],
  [/\btransform\s*:/i, 'transform / scale'],
  [/\bheight\s*:/i, 'height / max-height'],
  [/--focus-/i, '--focus-* measure tokens'],
  [/\b--(?:sh-float|radius-lg|acc)\b/i, 'frame/bloom palette tokens'],
];

// ------------------------------------------------------------
// 1 · Focus mode hides ONLY the work slot and the resizer.
// ------------------------------------------------------------
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

test('1c · only the two hide rules (plus the natural-size flex growth) exist', () => {
  const allowedSelectors = [
    (s) => s.includes('.app-main-row-v12') && s.includes('.chat-slot-v12'),
    (s) => s.includes('.chat-resizer'),
    (s) => s.includes('.app-main-row-v12') && s.includes('.work-slot-v12'),
  ];
  for (const r of focus) {
    assert.ok(allowedSelectors.some((ok) => ok(r.selector)),
      `no unexpected focus selector: ${r.selector}`);
  }
  assert.ok(focus.length >= 2 && focus.length <= 3,
    `expected 2–3 focus rules, found ${focus.length}`);

  // Every focus declaration must be on the tiny allowlist — nothing else.
  for (const r of focus) {
    for (const decl of declarations(r.body)) {
      assert.ok(ALLOWED_DECL.some((re) => re.test(decl)),
        `focus rule ${r.selector} may not declare "${decl}"`);
    }
  }
});

// ------------------------------------------------------------
// 2 · No width constraint / centering / frame / backdrop anywhere in focus.
// ------------------------------------------------------------
test('2 · focus block contains NO max-width/padding/border/shadow/margin/backdrop rules', () => {
  assert.ok(focus.length > 0, 'focus rules were found to scan');
  for (const r of focus) {
    for (const [re, label] of BANNED) {
      assert.ok(!re.test(r.body),
        `${label} must not appear in focus rule "${r.selector}"`);
    }
  }
  // The shrunken 900px reading column and its gutters are gone by name too.
  assert.ok(!/--focus-measure|--focus-inset|--focus-gutter/.test(shell),
    'no --focus-* measure/inset/gutter tokens remain in shell.css');
});

// ------------------------------------------------------------
// 3 · The chat panel and its descendants are never re-styled in focus.
// ------------------------------------------------------------
test('3 · chat panel is not re-styled in focus mode', () => {
  const RESTYLED = [
    'chat-panel-root', 'chat-head', 'chat-stream', 'composer-dock',
    'sc-focus-hint', 'chat-run-details', 'chat-passive-rows',
    'phase-strip', 'diffv',
  ];
  for (const r of focus) {
    for (const cls of RESTYLED) {
      assert.ok(!r.selector.includes(cls),
        `focus must not re-style .${cls} (found in "${r.selector}")`);
    }
  }
  // No `.chat-slot-v12 > .chat-panel-root` frame override survived.
  assert.ok(!focus.some((r) => /chat-slot-v12\s*>\s*\.chat-panel-root/.test(r.selector)),
    'no framed chat-panel override in focus mode');
});

// ------------------------------------------------------------
// 4 · Normal (non-focus) geometry is untouched: chat LEFT, rail TOP.
// ------------------------------------------------------------
test('4 · normal chat-left / rail-top geometry is preserved', () => {
  assert.match(shell, /\.app-main-row-v12\s*>\s*\.chat-slot-v12\s*\{[^}]*order:\s*1\s*;[^}]*flex:\s*0\s+0\s+auto/s,
    'chat slot keeps order:1 and flex:0 0 auto in normal mode');
  assert.match(shell, /\.app-main-row-v12\s*>\s*\.work-slot-v12\s*\{[^}]*order:\s*2\s*;[^}]*flex:\s*1\s+1\s+auto/s,
    'work slot keeps order:2 and flex:1 1 auto in normal mode');
  assert.match(shell, /\.app-rail-bar-v13\s*\{[^}]*width:\s*100%/s,
    'rail bar stays full-width (TOP)');
});

// ------------------------------------------------------------
// 5 · type-scale.css owns no focus rules.
// ------------------------------------------------------------
test('5 · type-scale.css has no focus-mode rules', () => {
  assert.equal(focusRules(typeScale).length, 0,
    'no html[data-focus] rules in type-scale.css');
  assert.ok(!typeRaw.includes('data-focus'),
    'type-scale.css does not mention data-focus at all');
});

// ------------------------------------------------------------
// 6 · Reduced-motion guards, palette and version-free CSS untouched.
// ------------------------------------------------------------
test('6a · both reduced-motion guards survive', () => {
  assert.match(shell, /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
    'shell.css reduced-motion guard intact');
  assert.match(typeScale, /html\.reduce-motion\s+\.brand-display/,
    'type-scale.css in-app reduce-motion guard intact');
  assert.match(typeScale, /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
    'type-scale.css OS reduced-motion guard intact');
});

test('6b · no versioned CSS / palette reintroduction in focus block', () => {
  for (const r of focus) {
    assert.ok(!/\bv\d+\.\d+/.test(r.selector + r.body),
      `no version tag in focus rule "${r.selector}"`);
  }
  assert.ok(shellRaw.includes('STABLE, version-free'),
    'shell.css still declares itself version-free');
});
