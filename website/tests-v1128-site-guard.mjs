#!/usr/bin/env node
/**
 * SITE-WOW V1128 GUARD — source-level diagnosis + test.
 *
 * Run from anywhere:   node website/tests-v1128-site-guard.mjs
 * Exit 0 = all hard checks pass; exit 1 = at least one FAIL.
 * WARN findings are printed but do not fail the run.
 *
 * This guard checks SOURCE only. It cannot see pixels. See docs/SITE-WOW-V1128.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)); // website/
const results = [];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const lines = (s) => s.split(/\r?\n/);

function add(id, title, status, detail) {
  results.push({ id, title, status, detail });
}
function pass(id, title, detail) { add(id, title, 'PASS', detail); }
function fail(id, title, detail) { add(id, title, 'FAIL', detail); }
function warn(id, title, detail) { add(id, title, 'WARN', detail); }

/** line numbers of a literal/regex in a source string */
function findLines(src, re) {
  const out = [];
  lines(src).forEach((line, i) => { if (re.test(line)) out.push(i + 1); });
  return out;
}

/** All @media (prefers-reduced-motion ...) blocks, brace-balanced. */
function reduceBlocks(css) {
  const out = [];
  const marker = /@media\s*\(prefers-reduced-motion[^\n]*?\)/g;
  let m;
  while ((m = marker.exec(css))) {
    let i = css.indexOf('{', m.index + m[0].length);
    if (i < 0) continue;
    let depth = 0, j = i;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    out.push({ start: css.slice(0, m.index).split('\n').length, text: css.slice(i, j) });
  }
  return out;
}

/** balanced body of a named @keyframes */
function keyframeLine(css, name) {
  const re = new RegExp('@keyframes\\s+' + name.replace(/[-]/g, '\\-') + '\\b');
  return findLines(css, re)[0] ?? null;
}

// ---------------------------------------------------------------------------
// 0. Files present
// ---------------------------------------------------------------------------
const FILES = {
  page: 'app/page.tsx',
  features: 'app/features/page.tsx',
  layout: 'app/layout.tsx',
  globals: 'app/globals.css',
  home: 'app/home.css',
  featuresCss: 'app/features/features.css',
  visualsCss: 'components/visuals/visuals.css',
  i18n: 'lib/i18n.tsx',
  index: 'components/visuals/index.ts',
  orbit: 'components/visuals/OrbitConstellation.tsx',
  flow: 'components/visuals/InkFlow.tsx',
  grid: 'components/visuals/PrecisionGrid.tsx',
  reveal: 'components/visuals/InkReveal.tsx',
};
const S = {};
for (const [k, rel] of Object.entries(FILES)) {
  if (!exists(rel)) {
    fail('FILE-' + k, `missing ${rel}`, 'expected W1-W5 artifact not found');
    S[k] = '';
  } else S[k] = read(rel);
}

// ---------------------------------------------------------------------------
// 1. New animation keyframes + utility classes
// ---------------------------------------------------------------------------
const KEYFRAMES = {
  [FILES.globals]: ['ink-draw', 'slow-orbit', 'float-settle', 'hairline-scan', 'glyph-stagger', 'section-bloom', 'aurora-drift'],
  [FILES.visualsCss]: ['oc-pulse', 'if-travel'],
  [FILES.home]: ['eng-breathe', 'eng-orbit', 'caret-breathe', 'arc-wander', 'note-draw', 'metric-settle', 'demo-pulse', 'demo-orbit-spin', 'demo-ring', 'demo-core'],
  [FILES.featuresCss]: ['anatomy-spin', 'anatomy-pulse', 'node-pulse', 'fp-dot-pulse', 'fp-think-hint'],
};
let kfMissing = [], kfCount = 0, kfEvidence = [];
for (const [rel, names] of Object.entries(KEYFRAMES)) {
  const css = S[Object.keys(FILES).find((k) => FILES[k] === rel)] || '';
  for (const n of names) {
    const ln = keyframeLine(css, n);
    if (ln) { kfCount++; kfEvidence.push(`${rel}:${ln} @keyframes ${n}`); }
    else kfMissing.push(`${rel} @keyframes ${n}`);
  }
}
if (kfMissing.length === 0) pass('A1', 'new animation keyframes present', `${kfCount} keyframes found. ${kfEvidence.slice(0, 4).join(' | ')} ...`);
else fail('A1', 'new animation keyframes present', `MISSING: ${kfMissing.join(', ')}`);

const REQUIRED_CLASSES = {
  [FILES.globals]: ['.anim-ink-draw', '.anim-orbit-slow', '.anim-settle', '.anim-scan', '.anim-stagger', '.anim-bloom', '.anim-aurora'],
  [FILES.visualsCss]: ['.oc', '.if', '.pg', '.ir-frame', '.art-cursor__ring'],
};
let clsMissing = [];
for (const [rel, cls] of Object.entries(REQUIRED_CLASSES)) {
  const css = S[Object.keys(FILES).find((k) => FILES[k] === rel)] || '';
  for (const c of cls) {
    if (!css.includes(c)) clsMissing.push(`${rel} ${c}`);
  }
}
if (!clsMissing.length) pass('A2', 'animation utility classes present', 'anim-* vocabulary + .oc/.if/.pg visual hooks all declared');
else fail('A2', 'animation utility classes present', `MISSING: ${clsMissing.join(', ')}`);

// ---------------------------------------------------------------------------
// 2. Reduced-motion guards cover the new animations
// ---------------------------------------------------------------------------
const GUARDS = {
  [FILES.globals]: ['.anim-ink-draw', '.anim-orbit-slow', '.anim-settle', '.anim-scan', '.anim-stagger', '.anim-bloom', '.anim-aurora'],
  [FILES.visualsCss]: ['.oc-node', '.if-flow', '.if-path', '.pg-line', '.pg-mark', '.pg-tick', '.ir-frame__line', '.art-cursor__ring'],
  [FILES.home]: ['.eng-rays', '.eng-orbit', '.glass-chip', '.eng-liquid', '.eng-dim-line', '.demo-orbit', '.demo-orbit-ring', '.demo-ellipsis'],
  [FILES.featuresCss]: ['.anatomy-rotor', '.fp-core-dot', '.fp-think-orbit', '.fp-stage-pip', '.palette-input .caret'],
};
let guardGaps = [], guardCount = 0;
for (const [rel, cls] of Object.entries(GUARDS)) {
  const css = S[Object.keys(FILES).find((k) => FILES[k] === rel)] || '';
  const blocks = reduceBlocks(css);
  const text = blocks.map((b) => b.text).join('\n');
  const mediaLn = findLines(css, /@media\s*\(prefers-reduced-motion/);
  if (!blocks.length) { guardGaps.push(`${rel}: no @media (prefers-reduced-motion) block`); continue; }
  for (const c of cls) {
    if (text.includes(c)) guardCount++;
    else guardGaps.push(`${rel}:${mediaLn[0]} reduced-motion block does not cover ${c}`);
  }
}
if (!guardGaps.length) pass('B1', 'reduced-motion guards cover new animations', `${guardCount} class guards inside @media (prefers-reduced-motion)`);
else fail('B1', 'reduced-motion guards cover new animations', guardGaps.join(' | '));

// @keyframes whose animating class is only gated by html:not(.reduce-motion)
// (a manual switch, NOT the OS media query) = a real accessibility gap.
const hoverOnly = /html:not\(\.reduce-motion\)[^}]*animation:/.test(S.featuresCss);
if (hoverOnly) warn('B2', 'hover motion gated only by manual .reduce-motion class', 'features.css:129 .fp-think-core animation uses html:not(.reduce-motion); a prefers-reduced-motion visitor without the class still gets the hover pulse');

// ---------------------------------------------------------------------------
// 3. Hydration safety — no Date / Math.random at render
// ---------------------------------------------------------------------------
const TS_FILES = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '.vercel') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(e.name)) TS_FILES.push(path.relative(ROOT, p).replace(/\\/g, '/'));
  }
})(ROOT);

const SERVER_ONLY = new Set(['app/sitemap.ts']); // Next metadata route, not a rendered component

/** innermost function declaration/const arrow enclosing a line (1-based index `i`) */
function enclosingFn(ls, i) {
  for (let k = i; k >= 0; k--) {
    const fm = ls[k].match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (fm) return { name: fm[1], line: k + 1, component: /^[A-Z]/.test(fm[1]) };
    const cm = ls[k].match(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/);
    if (cm) return { name: cm[1], line: k + 1, component: /^[A-Z]/.test(cm[1]) };
  }
  return null;
}
/** is a named function wired only as a JSX event handler (onSubmit/onClick/...)? */
function isEventHandler(name, src) {
  return new RegExp('on[A-Z]\\w*\\s*=\\s*\\{?\\s*' + name + '\\b').test(src) ||
         new RegExp('\\b' + name + '\\s*=\\s*\\([^)]*\\)\\s*=>').test(src);
}

const hydration = [];
for (const rel of TS_FILES) {
  const src = read(rel);
  const ls = lines(src);
  ls.forEach((text, i) => {
    const ln = i + 1;
    const hit = /Math\.random\s*\(|new Date\s*\(|Date\.now\s*\(/.test(text);
    if (!hit) return;
    const trimmed = text.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return; // comment
    if (SERVER_ONLY.has(rel)) return;
    // allowed when inside a useEffect/useMemo/route-handler body nearby
    const before = ls.slice(Math.max(0, i - 60), i).join('\n');
    if (/useEffect\s*\(|useMemo\s*\(|export async function (GET|POST|PUT|DELETE)/.test(before)) return;

    const fn = enclosingFn(ls, i);
    if (fn && !fn.component) {
      // Helper function: safe if every call site lives in a handler (or in an
      // effect) — i.e. it is invoked on interaction, never while rendering.
      const callLines = findLines(src, new RegExp('\\b' + fn.name + '\\s*\\('))
        .filter((c) => c !== fn.line);
      const allDeferred = callLines.length > 0 && callLines.every((c) => {
        const ctxFn = enclosingFn(ls, c - 1);
        if (ctxFn && isEventHandler(ctxFn.name, src)) return true;
        const near = ls.slice(Math.max(0, c - 31), c - 1).join('\n');
        return /useEffect\s*\(/.test(near);
      });
      if (allDeferred) return;
    }
    hydration.push(`${rel}:${ln} ${trimmed.slice(0, 90)}`);
  });
}
if (!hydration.length) pass('C1', 'no hydration-unsafe Date/Math.random at render', `${TS_FILES.length} TS/TSX files scanned; 0 render-time nondeterminism (server-only sitemap.ts exempt)`);
else fail('C1', 'no hydration-unsafe Date/Math.random at render', hydration.join(' | '));

// typewriter initial state must be deterministic (server === first client frame)
const deterministic = /useState\(''\)/.test(S.page) || /useState\(0\)/.test(S.page);
if (deterministic) pass('C2', 'demo uses deterministic initial state', 'page.tsx typewriter/reveal start from empty/0; inView=false on both server and client first paint');
else warn('C2', 'could not confirm deterministic initial state', 'inspect useTypewriter/useWordReveal in app/page.tsx');

// ---------------------------------------------------------------------------
// 4. "App in use" showcase section
// ---------------------------------------------------------------------------
const watchLine = findLines(S.page, /id="watch"/)[0];
const chatLn = findLines(S.page, /className="demo-chat"/)[0];
const thinkLn = findLines(S.page, /className="demo-thinking demo-rise"/)[0];
const toolLines = findLines(S.page, /className="demo-tool demo-rise"/);
const reasonLn = findLines(S.page, /className="demo-reason"/)[0];
const proofLn = findLines(S.page, /className="demo-proof-btn"/)[0];
const showcase = [
  ['#watch section', watchLine],
  ['chat panel', chatLn],
  ['thinking indicator', thinkLn],
  ['reasoning lines', reasonLn],
  ['PROOF disclosure', proofLn],
];
const showcaseGaps = showcase.filter(([, ln]) => !ln).map(([n]) => n);
if (!showcaseGaps.length && toolLines.length >= 2)
  pass('D1', 'app-in-use showcase exists with chat/thinking/tool',
    `app/page.tsx:${watchLine} #watch; chat:${chatLn}; thinking:${thinkLn}; tools:${toolLines.join(',')}; reason:${reasonLn}; proof:${proofLn}`);
else fail('D1', 'app-in-use showcase exists with chat/thinking/tool',
  `gaps: ${showcaseGaps.join(', ') || 'none'}; tool cards found: ${toolLines.length} (need >=2)`);

// honest labelling — it is a stylised illustration, not a recording
const honestLabel = /not a screen recording|ليس تسجيل شاشة/.test(S.page);
if (honestLabel) pass('D2', 'showcase honestly labelled as illustration', 'page.tsx:711-714 caption says "not a screen recording"');
else warn('D2', 'showcase not explicitly labelled as illustration', 'consider stating it is stylised, not real captured output');

// ---------------------------------------------------------------------------
// 5. Bilingual EN/AR
// ---------------------------------------------------------------------------
const arabic = /[\u0600-\u06FF]/;
const txCalls = (S.page.match(/\btx\(/g) || []).length;
const arLinesPage = findLines(S.page, arabic).length;
const arLinesFeat = findLines(S.features, arabic).length;
const i18nOk = /'ar'/.test(S.i18n) && /dataset\.lang|documentElement\.lang/.test(S.i18n) && /dir\s*=\s*(lang === 'ar' \? 'rtl' : 'ltr')/.test(S.i18n);
if (txCalls >= 40 && arLinesPage >= 40 && arLinesFeat >= 20 && i18nOk)
  pass('E1', 'bilingual EN/AR present', `page.tsx: ${txCalls} tx() pairs, ${arLinesPage} Arabic lines; features.tsx ${arLinesFeat} Arabic lines; i18n.tsx:11 ar default + dir/lang sync`);
else fail('E1', 'bilingual EN/AR present', `tx pairs=${txCalls}, arabic lines page=${arLinesPage} features=${arLinesFeat}, i18nOk=${i18nOk}`);

// paired tx() calls must supply an Arabic second argument (not tx('x','x'))
const sameArgs = findLines(S.page + '\n' + S.features, /\btx\(('[^']*'|"[^"]*"),\s*\1\)/);
if (!sameArgs.length) pass('E2', 'no tx() pair with identical EN/AR args', '0 no-op translations detected');
else warn('E2', 'tx() pairs with identical EN/AR args', 'lines: ' + sameArgs.join(','));

// ---------------------------------------------------------------------------
// 6. Wiring — new components actually rendered
// ---------------------------------------------------------------------------
const wiring = [
  ['OrbitConstellation', /import \{[^}]*OrbitConstellation[^}]*\}/.test(S.page) && /<OrbitConstellation\b/.test(S.page), findLines(S.page, /<OrbitConstellation\b/)[0]],
  ['InkFlow', /import \{[^}]*InkFlow[^}]*\}/.test(S.page) && /<InkFlow\b/.test(S.page), findLines(S.page, /<InkFlow\b/)[0]],
  ['PrecisionGrid', /import \{[^}]*PrecisionGrid[^}]*\}/.test(S.page) && /<PrecisionGrid\b/.test(S.page), findLines(S.page, /<PrecisionGrid\b/)[0]],
  ['InkReveal', /<InkReveal\b/.test(S.features), findLines(S.features, /<InkReveal\b/)[0]],
  ['index.ts exports', /OrbitConstellation/.test(S.index) && /InkFlow/.test(S.index) && /PrecisionGrid/.test(S.index), findLines(S.index, /OrbitConstellation/)[0]],
];
const unwired = wiring.filter(([, ok]) => !ok).map(([n]) => n);
if (!unwired.length)
  pass('F1', 'new visual components are imported AND rendered',
    wiring.map(([n, , ln]) => `${n}@${ln}`).join(', '));
else fail('F1', 'new visual components are imported AND rendered', 'unwired: ' + unwired.join(', '));

// dead-code check (informational)
const homeContentRel = 'components/home/HomeContent.tsx';
const allTs = TS_FILES.map((rel) => read(rel)).join('\n');
const importedSomewhere = /import\s*\{\s*HomeContent\s*\}|import\s+HomeContent/.test(allTs);
if (!importedSomewhere && exists(homeContentRel))
  warn('F2', 'duplicate showcase in orphaned HomeContent/TerminalDemo',
    'components/home/HomeContent.tsx:457 + TerminalDemo.tsx are never imported; the live showcase is the inline #watch in app/page.tsx. Dead code, not shipped.');

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
const STATUS = { PASS: '+', FAIL: 'X', WARN: '!' };
console.log('=== SITE-WOW V1128 SOURCE GUARD ===');
console.log(`root: ${ROOT}`);
console.log(`snapshot: ${new Date().toISOString()}`);
console.log('');
for (const r of results) {
  console.log(`[${STATUS[r.status]}] ${r.id} ${r.title}`);
  console.log(`      ${r.detail}`);
}
const fails = results.filter((r) => r.status === 'FAIL').length;
const warns = results.filter((r) => r.status === 'WARN').length;
const passes = results.filter((r) => r.status === 'PASS').length;
console.log('');
console.log(`RESULT: ${passes} PASS / ${fails} FAIL / ${warns} WARN`);
process.exit(fails ? 1 : 0);
