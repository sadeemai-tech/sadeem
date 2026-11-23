import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v1121 — SKILLS PANEL / REACT #300 CRASH REGRESSION.
//
// Founder report: opening an EXISTING skill (and adding one) showed
// `stage skills / تعذّر عرض هذا القسم / Minified React error #300`
// — "Too many re-renders". React #300 is the signature of an unstable
// `getSnapshot`: a zustand selector returning a FRESH object/array on
// every call, or an effect whose dep is a new function/object each
// render, which makes React re-render until the safety limit throws.
//
// This harness follows tests/v1116-chat-precision.test.mjs / v1118:
// it bundles the REAL SkillsPanel + store with esbuild, SSR-renders the
// three views (list / detail / add) against a mocked preload store state,
// and captures console warnings. It ALSO locks out the unstable source
// patterns with exact source assertions, so the class of bug can never
// be reintroduced even though SSR alone cannot execute effects.
//
//   node --test tests/v1121-skills-crash.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

const BUNDLE = join(ROOT, 'tests', '.v1121-skills-crash.bundle.cjs');
let mod;
let React;
let renderToStaticMarkup;
let warnings;

before(() => {
  // --- browser stubs installed BEFORE the store bundle loads -----------
  const bridge = new Proxy(
    {},
    {
      get(_t, key) {
        if (key === 'then' || typeof key === 'symbol') return undefined;
        return () => Promise.resolve(undefined);
      },
    },
  );
  globalThis.window = {
    surnia: bridge,
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
  globalThis.IntersectionObserver = undefined;

  // Capture React warnings — specifically the unstable-snapshot warning
  // that precedes React #300 ("The result of getSnapshot should be
  // cached to avoid an infinite loop").
  warnings = [];
  const origError = console.error;
  console.error = (...args) => {
    warnings.push(args.map((a) => (a && a.message) || String(a)).join(' '));
    origError.apply(console, args);
  };

  esbuild.buildSync({
    stdin: {
      contents:
        "export { SkillsPanel, SkillDetail, NewSkillForm } from './src/components/panels/SkillsPanel';" +
        "export { SkillsMemorySection } from './src/components/settings/SkillsMemorySection';" +
        "export { useStore } from './src/store';",
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: BUNDLE,
    loader: { '.css': 'empty', '.svg': 'dataurl' },
    external: ['electron', 'react', 'react-dom', 'zustand', 'lucide-react'],
  });

  mod = require(BUNDLE);
  React = require('react');
  // SSR reads getServerSnapshot; make it observe the live seeded state so
  // every branch (trust banner, ladder, marketplace) actually executes.
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;

  // Mocked api/store state: a real skill list, two learned confidence
  // values, an open trust consent, and a workspace path.
  mod.useStore.setState({
    wsPath: '/workspace/demo',
    settings: { ...mod.useStore.getState().settings, language: 'en' },
    dna: {
      version: 1,
      profile: {},
      patterns: [
        { id: 'p1', confidence: 0.83 },
        { id: 'p2', confidence: 0.42 },
      ],
      feedback: [],
      stats: { sessionsObserved: 2, factsRecorded: 1, updatedAt: 0 },
    },
    skillsTrustNeeded: true,
  });
});

after(() => {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

const h = React?.createElement;
const LOOP_RE = /too many re-renders|#300|maximum update depth|getSnapshot should be cached|infinite loop/i;

/** Render one node and assert a clean, loop-free SSR pass. */
function renderClean(label, node) {
  warnings.length = 0;
  let html;
  try {
    html = renderToStaticMarkup(node);
  } catch (err) {
    assert.fail(`${label} crashed while rendering: ${err && err.stack ? err.stack : err}`);
  }
  assert.equal(typeof html, 'string', `${label} returned a string (no throw)`);
  const loopWarnings = warnings.filter((w) => LOOP_RE.test(w));
  assert.deepEqual(loopWarnings, [], `${label} emitted no render-loop warning (got ${JSON.stringify(loopWarnings)})`);
  return html;
}

// ============================================================
// 1 · RUNTIME — the three views SSR cleanly (no throw, no loop)
// ============================================================
test('v1121: LIST view SSR renders without throw or render-loop warning', () => {
  const html = renderClean('list view', h(mod.SkillsPanel));
  assert.match(html, /art-skills/, 'panel root present');
  assert.match(html, /PLATE 04 \/ CONFIDENCE LADDER/, 'confidence ladder instrument present');
  assert.match(html, /no confidence values recorded yet|83%|42%/, 'ladder renders honest values or honest empty state');
  assert.match(html, /Trust this workspace/, 'consent banner renders');
});

test('v1121: DETAIL view (opening an EXISTING skill) SSR renders cleanly', () => {
  // The founder's exact failing path: click a list row → SkillDetail mounts.
  // All IPC lives in its effect, so SSR exercises the mount render only;
  // the source-level guards below cover the effect wiring.
  const html = renderClean(
    'detail view',
    h(mod.SkillDetail, { ws: '/workspace/demo', slug: 'deploy-checklist', onBack: () => {} }),
  );
  assert.ok(html.length > 0, 'detail view produced markup');
  assert.match(html, /svg|loading/, 'busy state renders the spinner, not an error');
});

test('v1121: ADD view (SkillComposer / NewSkillForm) SSR renders cleanly', () => {
  const html = renderClean(
    'add view',
    h(mod.NewSkillForm, { ws: '/workspace/demo', onDone: () => {} }),
  );
  assert.match(html, /Skill name/, 'name field present');
  assert.match(html, /Markdown instructions/, 'body field present');
  assert.match(html, /disabled/, 'save is disabled until validation passes');
});

test('v1121: SkillsMemorySection settings surface SSR renders cleanly', () => {
  const html = renderClean('skills & memory section', h(mod.SkillsMemorySection));
  assert.match(html, /Skills &amp; Memory|Skills & Memory/, 'section heading present');
  assert.match(html, /Manage skills/, 'manager link present');
});

// ============================================================
// 2 · SOURCE — the unstable #300 patterns are absent, pinned exactly
// ============================================================
const panelSrc = src('src/components/panels/SkillsPanel.tsx');
const memorySrc = src('src/components/settings/SkillsMemorySection.tsx');

test('v1121: NO zustand selector returns a fresh object/array (the #300 root cause)', () => {
  for (const [name, text] of [['SkillsPanel.tsx', panelSrc], ['SkillsMemorySection.tsx', memorySrc]]) {
    assert.ok(
      !/useStore\(\s*\(s\)\s*=>\s*\(\s*\{/.test(text),
      `${name}: no \`useStore((s) => ({...}))\` object-literal selector`,
    );
    // A selector that derives a value inline (`.map()/.sort()/…`) returns a
    // fresh array on every getSnapshot call. Check line-by-line so a nearby
    // (but separate) useMemo derivation is not a false positive.
    const offenders = text
      .split(/\r?\n/)
      .filter((line) => /useStore\([^\n]*\.(map|sort|filter|slice)\(/.test(line));
    assert.deepEqual(
      offenders,
      [],
      `${name}: no derivation inside a useStore selector (fresh array per getSnapshot)`,
    );
  }
  // The confidence derivation is outside the selector AND memoized.
  assert.ok(
    /const dnaPatterns = useStore\(\(s\) => s\.dna\?\.patterns\);/.test(panelSrc),
    'primitive/slice selector reads only the dna.patterns reference',
  );
  assert.ok(
    /const skillConfidences = useMemo\(\s*\(\) => \(dnaPatterns \?\? \[\]\)\.map\([\s\S]*?\)\.sort\([\s\S]*?\),\s*\[dnaPatterns\],?\s*\)/.test(panelSrc),
    'confidence array is derived in useMemo keyed on the stable slice ref',
  );
});

test('v1121: ALL hooks are above the conditional early returns (the ACTUAL #300 root cause)', () => {
  // Founder crash: list view rendered N hooks (incl. loadRivals), then the
  // detail/create early returns skipped it → React saw N-1 hooks and threw
  // "Rendered more hooks than during the previous render" (#300).
  const guard = panelSrc.indexOf('  if (openSlug) {');
  assert.ok(guard > 0, 'detail early return located');
  const before = panelSrc.slice(0, guard);
  const after = panelSrc.slice(guard);
  assert.ok(before.includes('const loadRivals = useCallback'), 'loadRivals hook is declared before the early return');
  assert.ok(
    !/\buse(State|Effect|Memo|Callback|Ref|Context|Reducer|Id|ImperativeHandle|LayoutEffect)\s*\(/.test(after),
    'no hook is called after the detail/create early returns',
  );
  assert.ok(panelSrc.indexOf('const loadRivals = useCallback') < guard, 'hook line < early-return line');
});

test('v1121: effect deps are stable (useCallback / primitive deps) — no loop', () => {
  assert.ok(
    /const reload = useCallback\(async \(\) => \{[\s\S]*?\}, \[ws\]\);/.test(panelSrc),
    'reload is useCallback keyed on the primitive ws path',
  );
  assert.ok(/useEffect\(\(\) => \{\s*void reload\(\);\s*\}, \[reload\]\);/.test(panelSrc), 'reload effect depends on the stable callback');
  // v11.36 (D10) — closeDetail also clears editSlug (the new editor); assert
  // the STABLE contract (useCallback with empty deps + setOpenSlug(null)).
  assert.ok(/const closeDetail = useCallback\(\(\) => \{[\s\S]{0,120}setOpenSlug\(null\)[\s\S]{0,80}\}, \[\]\);/.test(panelSrc), 'detail onBack is a stable callback');
  assert.ok(/onBack=\{closeDetail\}/.test(panelSrc), 'detail view receives the stable callback');
  // SkillDetail fetches ONLY in its effect; no state setter in the render body.
  assert.ok(/useEffect\(\(\) => \{[\s\S]*?\}, \[ws, slug\]\);/.test(panelSrc), 'detail fetch effect is keyed on primitive ws + slug');

  // Settings section: only primitive/slice selectors; fetch effect keyed on wsPath.
  assert.ok(/useEffect\(\(\) => \{[\s\S]*?\}, \[wsPath\]\);/.test(memorySrc), 'skill-count effect keyed on primitive wsPath');
  assert.ok(!/useDigits\(\)[\s\S]{0,80}\[n\]/.test(memorySrc), 'useDigits formatter is not used as an effect dep');
});

test('v1121: ADD-skill flow — validation, IPC call, success toast, detail hand-off', () => {
  assert.ok(/const valid = name\.trim\(\)\.length >= 2 && body\.trim\(\)\.length >= 10;/.test(panelSrc), 'validation: name >= 2 and body >= 10 chars');
  assert.ok(/disabled=\{!valid \|\| busy\}/.test(panelSrc), 'save button disabled while invalid or busy');
  assert.ok(/await api\.skillsSave\(ws, \{[^}]*\}, scope\)/.test(panelSrc), 'IPC: api.skillsSave(ws, payload, scope)');
  assert.ok(/notify\(t\('skills\.saved', 'Skill saved'\) \+ `: \$\{slug\}`\)/.test(panelSrc), 'success toast on save');
  assert.ok(/onDone\(slug\)/.test(panelSrc), 'saved skill opens its detail view');
  // The bridge itself exposes the IPC method (read-only assertion).
  assert.ok(/skillsSave\(/.test(src('src/lib/api.ts')), 'renderer bridge declares skillsSave');
});

// ============================================================
// 3 · GRAPHICS — precise, meaningful ladder art (founder polish)
// ============================================================
const artSrc = src('src/components/panels/skills-art.css');

test('v1121: skills-art.css styles the REAL ladder markup (no dead selectors)', () => {
  for (const cls of ['craft-sk-axis', 'craft-sk-tick', 'craft-sk-rung', 'craft-sk-markline', 'craft-sk-marker', 'craft-sk-num', 'craft-sk-val']) {
    assert.ok(artSrc.includes('.' + cls), `skills-art.css styles .${cls} (the class the TSX actually emits)`);
  }
  assert.ok(!/^\.sk-rung/m.test(artSrc) && !/^\.sk-marker/m.test(artSrc), 'dead .sk-* ladder selectors removed');
  assert.ok(artSrc.includes('.art-skills'), 'art is scoped to the skills panel');
});

test('v1121: ladder geometry is exact (equal rung pitch + honest confidence projection)', () => {
  assert.ok(/const AXIS_TOP = 25, GAP = 28;/.test(panelSrc), 'equal rung pitch pinned');
  assert.ok(/const y = AXIS_TOP \+ i \* GAP;/.test(panelSrc), 'every rung is an exact multiple of GAP from one origin');
  assert.ok(/const rubric = \[0, 0\.25, 0\.5, 0\.75, 1\];/.test(panelSrc), 'honest 0/25/50/75/100 axis divisions');
  assert.ok(/const xOf = \(v: number\) => L \+ SPAN \* Math\.min\(1, Math\.max\(0, v\)\);/.test(panelSrc), 'marker x is the real confidence projected on the same scale');
  assert.ok(/const mx = xOf\(v\)/.test(panelSrc), 'marker uses the projected value');
});

test('v1121: motion guarded by BOTH reduced-motion signals', () => {
  assert.ok(artSrc.includes('@media (prefers-reduced-motion: reduce)'), 'OS preference guard present');
  assert.ok(artSrc.includes('html.reduce-motion'), 'app-level guard present');
  assert.ok(artSrc.includes('@keyframes sk-rule-draw'), 'masthead rule draw present');
});
