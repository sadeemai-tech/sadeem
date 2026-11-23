// ============================================================
// v11.31 — UI CAPABILITY / CSS AUDIT GUARD
//
// Source-level audit of every owned CSS sheet. This suite locks the
// graphics-polish pass so a later wave cannot silently re-introduce the
// bugs it fixed:
//   1. NO duplicate @keyframes names across all CSS (two same-named
//      keyframes used to fight globally — last sheet loaded won).
//   2. NO dead keyframes (defined but never referenced) except the one
//      the stream-ui guard deliberately keeps (sc-shimmer).
//   3. NO expensive keyframe properties (box-shadow / background-position
//      sweeps) in the animated art — paint -> compositor-only opacity.
//   4. Every animated sheet carries BOTH reduced-motion signals.
//   5. Precision: exact 2πr orb, geometricPrecision SVG, 1px token detail,
//      the founder's 2.2s calm cadence, RTL draw origin via dir='rtl'.
//   6. Protected art (spinning circle / ink flow / tool bloom / orbital
//      subagents / context orb) is STILL mounted.
//   7. Dead rules removed (retired popover chevron), no versioned CSS.
//
//   node --test --test-force-exit tests/v1131-css.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

// walk all CSS under src/
function walk(dir, out = []) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (e.name.endsWith('.css')) out.push(rel);
  }
  return out;
}
const CSS_FILES = walk('src');
const CSS = Object.fromEntries(CSS_FILES.map((f) => [f, read(f)]));
const ALL = CSS_FILES.map((f) => noComments(CSS[f])).join('\n');

/** all @keyframes names -> files that define them */
function keyframeDefs(text) {
  const map = new Map();
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    if (!map.has(m[1])) map.set(m[1], []);
    map.get(m[1]).push(m[1]);
  }
  return map;
}

// ---------- 1 · no duplicate keyframes ----------
test('no @keyframes name is defined twice across the CSS surface', () => {
  const owners = new Map();
  for (const file of CSS_FILES) {
    for (const name of keyframeDefs(noComments(CSS[file])).keys()) {
      if (!owners.has(name)) owners.set(name, []);
      owners.get(name).push(file);
    }
  }
  const dupes = [...owners].filter(([, files]) => files.length > 1);
  assert.deepEqual(dupes, [],
    `duplicate @keyframes: ${dupes.map(([n, f]) => `${n}@${f.join('+')}`).join(', ')}`);
});

// ---------- 2 · no dead keyframes (except the one locked by stream-ui) ----------
test('no orphan keyframes (defined but never referenced by an animation)', () => {
  const ALLOW = new Set(['sc-shimmer']); // v1111-stream-ui requires the definition to stay
  const orphan = [];
  for (const [name] of keyframeDefs(ALL)) {
    if (ALLOW.has(name)) continue;
    // count usages outside the keyframes definition (the definition itself is 1)
    const uses = (ALL.match(new RegExp('\\b' + name + '\\b', 'g')) || []).length;
    const defs = (ALL.match(new RegExp('@keyframes\\s+' + name + '\\b', 'g')) || []).length;
    if (uses <= defs) orphan.push(name);
  }
  assert.deepEqual(orphan, [], `orphan keyframes: ${orphan.join(', ')}`);
});

// ---------- 3 · no expensive animated properties ----------
test('animations use transform/opacity only — no box-shadow or background-position sweeps', () => {
  const banned = /\b(box-shadow|background-position|width|height|top|left|right|bottom|margin|padding)\s*:/g;
  for (const name of ['pf-reveal', 'skeleton-sweep', 'tsg-run-breathe', 'matte-breathe', 'billing-breathe', 'artBreathDot', 'artBreathRing']) {
    const re = new RegExp('@keyframes\\s+' + name + '\\s*\\{([\\s\\S]*?)\\}');
    const m = ALL.match(re);
    assert.ok(m, `@keyframes ${name} exists`);
    const bad = [...m[1].matchAll(banned)].map((x) => x[1]);
    assert.deepEqual(bad, [], `@keyframes ${name} must not animate layout/paint properties (found ${bad})`);
  }
});

// ---------- 4 · reduced-motion: every animated sheet has BOTH signals ----------
test('every sheet that declares keyframes carries prefers-reduced-motion AND html.reduce-motion', () => {
  for (const file of CSS_FILES) {
    const css = noComments(CSS[file]);
    if (!/@keyframes|animation\s*:/.test(css)) continue;
    // `no-preference` gating is an even stronger OS guard: the effect only
    // exists when the user has expressed no preference at all.
    assert.ok(css.includes('@media (prefers-reduced-motion: reduce)') ||
      css.includes('@media (prefers-reduced-motion: no-preference)'),
      `${file}: missing prefers-reduced-motion guard`);
    assert.ok(css.includes('html.reduce-motion'),
      `${file}: missing in-app html.reduce-motion guard`);
  }
});

// ---------- 5 · precision + cadence ----------
test('duplicate breathe collision removed; both phases keep their own named keyframe', () => {
  const styles = CSS['src/styles.css'], billing = CSS['src/components/billing.css'];
  assert.ok(styles.includes('@keyframes matte-breathe'), 'styles.css defines matte-breathe');
  assert.ok(styles.includes('animation: matte-breathe 1.6s'), 'shimmer keeps 1.6s sweep');
  assert.ok(styles.includes('animation: matte-breathe 2.2s'), 'thinking-live uses the 2.2s calm cadence');
  assert.ok(billing.includes('@keyframes billing-breathe'), 'billing.css defines its own invert-phase breath');
  assert.ok(billing.includes('animation: billing-breathe 1.6s'), 'billing skeleton references billing-breathe');
  // the generic name is gone from both sheets
  assert.ok(!/@keyframes\s+breathe\b/.test(noComments(styles)), 'no generic breathe in styles.css');
  assert.ok(!/@keyframes\s+breathe\b/.test(noComments(billing)), 'no generic breathe in billing.css');
});

test('dead keyframes removed from console.css; the live v13-fade stays in shell.css', () => {
  const consoleCss = noComments(CSS['src/components/console.css']);
  const shellCss = CSS['src/components/shell.css'];
  assert.ok(!/@keyframes\s+v13-fade\b/.test(consoleCss), 'console.css no longer duplicates v13-fade');
  assert.ok(!/@keyframes\s+reason-node-pulse\b/.test(consoleCss), 'retired reason-node-pulse removed');
  assert.ok(/@keyframes\s+v13-fade\b/.test(shellCss), 'shell.css keeps the single live v13-fade');
  assert.ok((shellCss.match(/animation:\s*v13-fade\b/g) || []).length >= 2, 'shell.css still references v13-fade');
});

test('art-layer breathing is aligned to the founder 2.2s cadence', () => {
  const art = CSS['src/components/art.css'];
  assert.ok(!/2\.8s|3\.4s/.test(noComments(art)), 'no stray 2.8s/3.4s breath remains');
  assert.ok(art.includes('artBreathDot 2.2s'), 'dot breathes at 2.2s');
  assert.ok(art.includes('artBreathRing 2.2s'), 'ring breathes at 2.2s');
  assert.ok(art.includes('calc(2.2s / var(--motion-scale, 1))'), 'motion-scale scaling follows 2.2s');
});

test('SVG precision: geometricPrecision on orb + crosshair hairlines', () => {
  const orb = CSS['src/components/context-orb.css'];
  const flows = CSS['src/components/flows-art.css'];
  assert.ok(/\.ctx-orb-ring svg\s*\{[^}]*shape-rendering:\s*geometricPrecision/s.test(orb),
    'context orb ring renders at geometricPrecision');
  assert.ok(/\.fl-cross svg\s*\{[^}]*shape-rendering:\s*geometricPrecision/s.test(flows),
    'flows crosshair renders at geometricPrecision');
  assert.ok(/vector-effect:\s*non-scaling-stroke/.test(orb), 'orb keeps 1px non-scaling strokes');
});

test('flows: RTL draw origin keys off dir, not only lang; 1px token detail added', () => {
  const flows = CSS['src/components/flows-art.css'];
  assert.ok(/html\[dir='rtl'\]\s+\.fl-rule-art/.test(flows), 'RTL draw origin guarded by dir=rtl');
  assert.ok(/\.fl-breathe::after\s*\{[^}]*border:\s*1px solid color-mix\(in srgb, var\(--faint\)/s.test(flows),
    'flat "has run" marker gained a 1px token-coloured registration ring');
});

// ---------- 5b · expensive paint: reveal keyline is opacity-only ----------
test('tree-row reveal keyline: static inset ring on a pseudo, only opacity animated', () => {
  const files = CSS['src/components/files.css'];
  const kf = files.match(/@keyframes\s+pf-reveal\s*\{([\s\S]*?)\}/);
  assert.ok(kf, 'pf-reveal keyframes exist');
  assert.ok(!/box-shadow\s*:/.test(kf[1]), 'keyframes never animate box-shadow');
  assert.ok(/opacity:\s*0(\.85)?/.test(kf[1]), 'keyframes animate opacity');
  assert.ok(/\.pf-tree \.tree-row\.is-revealed::after\s*\{[^}]*box-shadow:\s*inset/s.test(files),
    'static inset keyline lives on the overlay pseudo');
  assert.ok(/\.pf-tree \.tree-row\.is-revealed::after\s*\{\s*display:\s*none !important/s.test(files),
    'reduced-motion hides the static keyline');
  // the old duplicate row-level animation is gone
  assert.ok(!/\.pf-tree \.tree-row\.is-revealed \{[^}]*animation:\s*pf-reveal/s.test(files),
    'no row-level box-shadow animation remains');
});

test('skeleton shimmer: compositor-only translate of a highlight overlay', () => {
  const glass = CSS['src/assets/glass-v7.css'];
  const kf = glass.match(/@keyframes\s+skeleton-sweep\s*\{([\s\S]*?)\n\}/);
  assert.ok(kf && /translateX\(-100%\)/.test(kf[1]) && /translateX\(100%\)/.test(kf[1]),
    'skeleton-sweep animates transform only');
  assert.ok(/\.skeleton-shimmer::after\s*\{[^}]*background:\s*linear-gradient/s.test(glass),
    'highlight lives on an overlay pseudo');
  assert.ok(/html\.reduce-motion \.skeleton-shimmer::after \{ display: none !important; \}/.test(glass),
    'in-app reduce-motion hides the parked sweep');
});

// ---------- 6 · protected art survives ----------
test('protected art is still mounted: spinning circle / ink flow / tool bloom / orbital subagents / context orb', () => {
  assert.ok(/@keyframes agt-orbit-spin/.test(CSS['src/components/subagents.css']), 'orbital subagents alive');
  assert.ok(CSS['src/components/chat-final.css'].includes('.mv-tool-bloom'), 'tool bloom alive');
  assert.ok(CSS['src/components/stream-motion.css'].includes('pr-ink-check'), 'ink flow alive');
  assert.ok(/sc-think-orbit|sc18-think-orbit/.test(CSS['src/components/console.css']), 'spinning circle alive');
  assert.ok(CSS['src/components/context-orb.css'].includes('.ctx-orb'), 'context orb alive');
});

// ---------- 7 · no dead chevron / no versioned CSS ----------
test('dead popover chevron removed; no versioned selectors introduced', () => {
  const proof = noComments(CSS['src/components/proof.css']);
  assert.ok(!/\.pr-toggle-chevron/.test(proof), 'retired popover chevron rule removed');
  // no version-numbered class selectors in the sheets audited this wave
  for (const file of ['src/components/billing.css', 'src/components/console.css',
    'src/components/flows.css', 'src/components/flows-art.css', 'src/components/art.css',
    'src/components/files.css', 'src/styles.css']) {
    assert.ok(!/\.v\d{2,}\b/.test(noComments(CSS[file])), `${file}: no versioned class selector`);
  }
});
