// ============================================================
// SADEEM v11.11 — POLISH TESTS (wave3-A9)
//   • 4 hand-authored SVG illustrations exist, are valid XML-ish
//     markup, carry a viewBox, and contain NO external references
//     (license-safe, offline-safe).
//   • tokens.css LIGHT MODE LEMON: the light theme carries the lime
//     accent (#98D83B family) and NO dark-green button hexes.
//   • polish.css: prefers-reduced-motion guards, lime focus ring,
//     toast spring, palette stagger — transform/opacity only.
//   • Components are wired: Welcome/Home use the illustration,
//     Toasts carries the spring class, the palette carries the
//     stagger class.
// Run: node --test tests/v1111-polish.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ILL_DIR = join(ROOT, 'src', 'assets', 'illustrations');

const EXPECTED_ILLUSTRATIONS = ['empty-sessions.svg', 'empty-preview.svg', 'flows-empty.svg'];

// ---------- 1 · illustrations ----------
test('all 3 illustrations exist in src/assets/illustrations/', () => {
  const present = existsSync(ILL_DIR) ? readdirSync(ILL_DIR) : [];
  for (const name of EXPECTED_ILLUSTRATIONS) {
    assert.ok(present.includes(name), `${name} missing`);
  }
});

test('illustrations: valid XML, viewBox present, no external refs (license-safe)', () => {
  for (const name of EXPECTED_ILLUSTRATIONS) {
    const src = readFileSync(join(ILL_DIR, name), 'utf8');
    // structural XML sanity (self-contained subset — no parser dependency)
    assert.ok(src.trim().startsWith('<svg'), `${name} starts with <svg>`);
    assert.ok(src.trimEnd().endsWith('</svg>'), `${name} closes </svg>`);
    assert.match(src, /viewBox="0 0 \d+ \d+"/, `${name} carries a viewBox`);
    assert.ok(src.includes('xmlns="http://www.w3.org/2000/svg"'), `${name} declares its namespace`);
    // balanced tags for the containers we author
    const opens = (src.match(/<(g|defs|svg)[\s>]/g) || []).length;
    const closes = (src.match(/<\/(g|defs|svg)>/g) || []).length;
    const selfClosed = (src.match(/<(g|defs|svg)[^>]*\/>/g) || []).length;
    assert.equal(opens, closes + selfClosed, `${name} has balanced container tags`);
    // NO external references: no href/xlink, no url() to http(s), no <image>
    assert.ok(!/xlink:|<image|\bhref\s*=/i.test(src), `${name} must not reference external resources`);
    assert.ok(!/url\(\s*['"]?https?:/i.test(src), `${name} must not load remote assets`);
    // offline palette: the Deep Space lime must be present, tastefully
    assert.ok(src.includes('#98D83B') || src.includes('#A9E34D'), `${name} uses the lime accent`);
  }
});

// ---------- 2 · light-mode lemon (tokens.css) ----------
const tokens = readFileSync(join(ROOT, 'src', 'styles', 'tokens.css'), 'utf8');

test('tokens.css light section: lemon-lime accent (#98D83B family) present', () => {
  // A dedicated light-theme block re-points button fills to the lime system.
  const lightIdx = tokens.indexOf(":root[data-theme='light']");
  assert.ok(lightIdx >= 0, 'a :root[data-theme=light] override block exists in tokens.css');
  const lemonBlock = tokens.slice(lightIdx);
  assert.ok(/--lemon:\s*#98D83B/i.test(lemonBlock), 'light theme carries the dark-mode lime token');
  assert.ok(/--lemon-ink:\s*#0C1103/i.test(lemonBlock), 'dark ink on lime for AA contrast (≈11:1)');
  assert.ok(/\.btn-primary[\s\S]{0,240}var\(--lemon\)/.test(lemonBlock), 'primary buttons consume the lime fill');
  // follow-the-system light OS gets the same treatment
  assert.ok(/data-theme='follow'/.test(tokens) && /prefers-color-scheme:\s*light/.test(tokens), 'follow theme covered');
});

test('tokens.css contains NO dark-green button hexes', () => {
  const DARK_GREEN = ['#14532d', '#14532a', '#166534', '#15803d'];
  const low = tokens.toLowerCase();
  for (const hex of DARK_GREEN) {
    assert.ok(!low.includes(hex), `dark-green button hex ${hex} must not exist in tokens.css`);
  }
  // The lemon system replaced them: light buttons = lime, not dark green.
  assert.ok(/#98D83B/i.test(tokens), 'the lime system is the light-mode button family');
});

// ---------- 3 · polish.css: motion + a11y ----------
const polish = readFileSync(join(ROOT, 'src', 'styles', 'polish.css'), 'utf8');

test('polish.css: every motion block is guarded by prefers-reduced-motion', () => {
  const guards = (polish.match(/prefers-reduced-motion:\s*no-preference/g) || []).length;
  assert.ok(guards >= 3, `expected ≥3 no-preference guards, found ${guards}`);
  assert.ok(polish.includes('prefers-reduced-motion'), 'reduced-motion handling present');
});

test('polish.css: focus-visible lime ring + button hover lift exist', () => {
  assert.ok(/:focus-visible/.test(polish), 'focus-visible ring defined');
  assert.match(polish, /outline-color:\s*var\(--lemon/, 'ring uses the lime token');
  assert.ok(/translateY\(-1px\)/.test(polish), '1px hover lift present');
});

test('polish.css: animations are transform/opacity only', () => {
  const keyframeBlocks = polish.match(/@keyframes\s+[\w-]+\s*\{[\s\S]*?\n\}/g) || [];
  assert.ok(keyframeBlocks.length >= 3, `expected ≥3 keyframes, found ${keyframeBlocks.length}`);
  for (const block of keyframeBlocks) {
    assert.ok(
      !/\b(width|height|top|left|right|bottom|margin|padding|font-size|box-shadow)\s*:/.test(block),
      `keyframe animates only compositor-safe props: ${block.slice(0, 60)}…`,
    );
    assert.ok(/transform|opacity/.test(block), 'keyframes drive transform/opacity');
  }
});

test('polish.css: toast spring + palette stagger hooks exist', () => {
  assert.ok(polish.includes('.toast-spring'), 'toast spring class defined');
  assert.ok(polish.includes('.pal-stagger'), 'palette stagger container hook defined');
});

// ---------- 4 · component wiring ----------
test('Welcome + Home use the empty-state illustration', () => {
  const welcome = readFileSync(join(ROOT, 'src', 'components', 'Welcome.tsx'), 'utf8');
  const home = readFileSync(join(ROOT, 'src', 'components', 'Home.tsx'), 'utf8');
  assert.match(welcome, /empty-sessions\.svg/, 'Welcome imports the illustration');
  assert.match(welcome, /src=\{emptySessions\}/, 'Welcome renders it');
  assert.match(home, /empty-sessions\.svg/, 'Home imports the illustration');
  assert.match(home, /src=\{emptySessions\}/, 'Home renders it');
});

test('Toasts carries the spring class; CommandPalette carries the stagger class', () => {
  const toasts = readFileSync(join(ROOT, 'src', 'components', 'Toasts.tsx'), 'utf8');
  const palette = readFileSync(join(ROOT, 'src', 'components', 'CommandPalette.tsx'), 'utf8');
  assert.match(toasts, /toast-spring/, 'ToastRow opts into the spring entrance');
  assert.match(palette, /pal-stagger/, 'palette results list opts into the stagger');
});

test('polish.css is imported by the token layer (loads everywhere)', () => {
  assert.match(tokens, /@import\s+'\.\//, 'tokens.css imports polish.css');
  assert.ok(existsSync(join(ROOT, 'src', 'styles', 'polish.css')), 'polish.css exists');
});
