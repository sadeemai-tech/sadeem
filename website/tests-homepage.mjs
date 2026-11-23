#!/usr/bin/env node
/**
 * HOMEPAGE REDESIGN GUARD — source-level diagnosis + test.
 *
 * Run from anywhere:   node website/tests-homepage.mjs
 * Live deploy check:   node website/tests-homepage.mjs --live
 * Custom deploy URL:   HOMEPAGE_URL=https://... node website/tests-homepage.mjs --live
 *
 * Exit 0 = all HARD checks pass; exit 1 = at least one FAIL.
 * WARN findings are printed but do not fail the run.
 *
 * WHAT THIS GUARD CAN AND CANNOT DO
 * ---------------------------------------------------------------------
 * It reads SOURCE (app/page.tsx, app/home.css, app/globals.css,
 * lib/i18n.tsx) with exact file:line reporting. It also optionally
 * fetches the deployed HTML with --live and counts the same structural
 * signals in the rendered page. It CANNOT see pixels, visual hierarchy,
 * spacing, contrast, or whether the result looks polished. See
 * docs/HOMEPAGE-REDESIGN.md — source != pixels.
 *
 * The contract this guard enforces (H1's rebuild of page.tsx + home.css):
 *   - exactly one <h1>
 *   - 4..6 top-level <section> elements
 *   - none of the old clutter markers: hero-metrics, eng-plate-notes,
 *     art-corner, hero-chips (demo-sec is a WARN: allowed only if the
 *     demo was deliberately kept and cleaned)
 *   - bilingual EN/AR through tx(), with dir/lang sync in i18n
 *   - RTL-safe CSS (logical properties / [dir=rtl] overrides)
 *   - every CSS animation explicitly disabled under
 *     @media (prefers-reduced-motion: reduce) in home.css
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)); // website/
const LIVE = process.argv.includes('--live');
const DEPLOY_URL = process.env.HOMEPAGE_URL || 'https://sadeem-website-theta.vercel.app/';
const SNAPSHOT = new Date().toISOString();

const results = [];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const lines = (s) => s.split(/\r?\n/);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function add(id, title, status, detail) { results.push({ id, title, status, detail }); }
const pass = (id, t, d) => add(id, t, 'PASS', d);
const fail = (id, t, d) => add(id, t, 'FAIL', d);
const warn = (id, t, d) => add(id, t, 'WARN', d);

/** line numbers (1-based) of every line matching `re` */
function findLines(src, re) {
  const out = [];
  lines(src).forEach((line, i) => { if (re.test(line)) out.push(i + 1); });
  return out;
}
/** replace /* ... *\/ comment bodies with spaces, preserving line numbers */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}
/** all brace-balanced @media (prefers-reduced-motion ...) blocks */
function reduceBlocks(css) {
  const out = [];
  const marker = /@media\s*\(prefers-reduced-motion[^)]*\)/g;
  let m;
  while ((m = marker.exec(css))) {
    const i = css.indexOf('{', m.index + m[0].length);
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
/** class tokens from a selector, ignoring decimals (.7s) and URL dots (.org) */
function classTokens(text) {
  return [...text.matchAll(/(?:^|[\s,{}>+~])\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
}
/** walk back from a declaration line to the selector that opened its rule */
function selectorForDeclaration(srcLines, idx) {
  let prefix = '';
  for (let k = idx; k >= Math.max(0, idx - 8); k--) {
    const l = srcLines[k] || '';
    const open = l.indexOf('{');
    if (open >= 0) {
      const close = l.lastIndexOf('}', open);
      return (l.slice(close + 1, open) + prefix).replace(/\s+/g, ' ').trim();
    }
    if (l.includes('}')) return '';
    prefix = l + '\n' + prefix;
  }
  return prefix.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// 0. Files present
// ---------------------------------------------------------------------------
const FILES = {
  page: 'app/page.tsx',
  home: 'app/home.css',
  globals: 'app/globals.css',
  i18n: 'lib/i18n.tsx',
};
const S = {};
for (const [k, rel] of Object.entries(FILES)) {
  if (!exists(rel)) { fail('FILE-' + k, `missing ${rel}`, 'expected homepage artifact not found'); S[k] = ''; }
  else S[k] = read(rel);
}
const HOME_CSS = stripComments(S.home);

// ---------------------------------------------------------------------------
// A. Exactly one <h1>, and it is authored bilingually
// ---------------------------------------------------------------------------
const h1Lines = findLines(S.page, /<h1(?:\s|>)/);
if (h1Lines.length === 1) pass('A1', 'exactly one <h1>', `app/page.tsx:${h1Lines[0]}`);
else fail('A1', 'exactly one <h1>', `found ${h1Lines.length}: app/page.tsx:${h1Lines.join(', ') || '(none)'}`);

if (h1Lines.length) {
  const blockStart = h1Lines[0] - 1;
  const block = lines(S.page).slice(blockStart, blockStart + 8).join('\n');
  if (/\btx\s*\(/.test(block)) pass('A2', '<h1> copy is bilingual via tx()', `app/page.tsx:${h1Lines[0]}-${h1Lines[0] + 7}`);
  else warn('A2', '<h1> copy not visibly wrapped in tx()', `check app/page.tsx:${h1Lines[0]}`);
}

// ---------------------------------------------------------------------------
// B. Section budget: 4..6 top-level <section> elements
// ---------------------------------------------------------------------------
const secLines = findLines(S.page, /<section(?:\s|>)/);
if (secLines.length >= 4 && secLines.length <= 6)
  pass('B1', 'section count within 4..6', `${secLines.length} sections at app/page.tsx:${secLines.join(', ')}`);
else
  fail('B1', 'section count within 4..6', `${secLines.length} sections at app/page.tsx:${secLines.join(', ') || '(none)'} — contract requires 4..6`);

// ---------------------------------------------------------------------------
// C. Clutter markers must be gone from BOTH markup and CSS
// ---------------------------------------------------------------------------
const HARD_MARKERS = ['hero-metrics', 'eng-plate-notes', 'art-corner', 'hero-chips'];
const SOFT_MARKERS = ['demo-sec']; // "if replaced" — allowed when demo deliberately kept
function markerLines(marker, src) { return findLines(src, new RegExp(marker)); }

let clutterGaps = [];
for (const m of HARD_MARKERS) {
  const p = markerLines(m, S.page), c = markerLines(m, HOME_CSS);
  if (p.length || c.length) {
    clutterGaps.push(`${m}: page.tsx:${p.join(',') || '-'} home.css:${c.join(',') || '-'}`);
  }
}
if (!clutterGaps.length) pass('C1', 'old clutter markers removed', `${HARD_MARKERS.join(', ')} absent from page.tsx + home.css`);
else fail('C1', 'old clutter markers removed', clutterGaps.join(' | '));

const softHits = SOFT_MARKERS.map((m) => {
  const p = markerLines(m, S.page), c = markerLines(m, HOME_CSS);
  return (p.length || c.length) ? `${m}: page.tsx:${p.join(',') || '-'} home.css:${c.join(',') || '-'}` : null;
}).filter(Boolean);
if (softHits.length) warn('C2', 'demo-sec still present', `${softHits.join(' | ')} — acceptable ONLY if H1 kept a cleaned #watch; otherwise remove`);
else pass('C2', 'demo-sec removed (or renamed)', 'no demo-sec marker in page.tsx or home.css');

// orphan CSS: classes styled in home.css but never referenced in ANY source file
// (many classes are emitted by components, not written literally in page.tsx)
const SRC_FILES = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.vercel'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx|ts|js|mjs)$/.test(e.name)) SRC_FILES.push(p);
  }
})(ROOT);
const allSrc = SRC_FILES.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
const cssClasses = new Set(classTokens(HOME_CSS));
const orphans = [...cssClasses].filter((c) => c.length > 2 && !new RegExp('\\b' + esc(c) + '\\b').test(allSrc));
if (orphans.length) warn('C3', 'possibly orphaned home.css classes', `${orphans.length} class(es) styled but not referenced in page.tsx: ${orphans.slice(0, 25).join(', ')}${orphans.length > 25 ? ' ...' : ''}`);
else pass('C3', 'no orphaned home.css classes', 'every class styled in home.css appears in page.tsx');

// NEW: every className the rebuilt markup emits must actually be styled.
// This is the inverse of C3 and catches "rebuilt TSX, forgot home.css".
const CLASS_CSS = Object.keys(FILES)
  .filter((k) => k === 'home' || k === 'globals')
  .map((k) => S[k]).join('\n')
  + (exists('components/visuals/visuals.css') ? read('components/visuals/visuals.css') : '');
const emitted = new Set();
for (const m of S.page.matchAll(/className\s*=\s*"([^"]+)"/g)) {
  m[1].split(/\s+/).forEach((c) => { if (/^[A-Za-z_][\w-]*$/.test(c)) emitted.add(c); });
}
for (const m of S.page.matchAll(/className\s*=\s*'([^']+)'/g)) {
  m[1].split(/\s+/).forEach((c) => { if (/^[A-Za-z_][\w-]*$/.test(c)) emitted.add(c); });
}
// string literals on class-variable assignment lines only, e.g.
//   const codeClass = 'demo-code' + (lang === 'ar' ? ' demo-code--ar' : '')
for (const line of lines(S.page)) {
  if (!/\b\w*[Cc]lass\w*\s*=/.test(line)) continue;
  for (const m of line.matchAll(/'([^']*)'/g)) {
    m[1].split(/\s+/).forEach((c) => { if (/^[a-z][\w-]*$/.test(c) && c.length > 2) emitted.add(c); });
  }
}
const undefinedClasses = [...emitted].filter((c) => !new RegExp('\\.' + esc(c) + '\\b').test(CLASS_CSS));
const undefWithLines = undefinedClasses.slice(0, 40).map((c) => `${c}@page.tsx:${findLines(S.page, new RegExp('\\b' + esc(c) + '\\b'))[0]}`);
if (!undefinedClasses.length) pass('C4', 'all emitted classes are styled', `${emitted.size} className tokens all have CSS definitions`);
else if (undefinedClasses.length <= 5) warn('C4', 'a few emitted classes are unstyled', `${undefinedClasses.length}: ${undefWithLines.join(', ')} — usually a harmless dead hook, not a layout break`);
else fail('C4', 'all emitted classes are styled', `${undefinedClasses.length} unstyled class(es): ${undefWithLines.join(', ')}${undefinedClasses.length > 40 ? ' ...' : ''} — likely "rebuilt TSX, forgot CSS"`);

// ---------------------------------------------------------------------------
// D. Bilingual EN/AR through tx() + i18n dir/lang sync
// ---------------------------------------------------------------------------
const txCalls = (S.page.match(/\btx\s*\(/g) || []).length;
const arLines = findLines(S.page, /[\u0600-\u06FF]/).length;
const i18nOk = /lang\s*===\s*'ar'\s*\?\s*'rtl'\s*:\s*'ltr'/.test(S.i18n)
  && /documentElement\.lang/.test(S.i18n)
  && /\btx\s*:\s*\(en,\s*ar\)/.test(S.i18n);
if (txCalls >= 20 && arLines >= 20 && i18nOk)
  pass('D1', 'bilingual EN/AR present', `${txCalls} tx() calls, ${arLines} Arabic lines in page.tsx; i18n.tsx dir/lang sync OK`);
else
  fail('D1', 'bilingual EN/AR present', `tx()=${txCalls} (need >=20), Arabic lines=${arLines} (need >=20), i18nOk=${i18nOk}`);

const sameArgs = findLines(S.page, /\btx\(\s*(['"])([^'"]*)\1\s*,\s*\1\2\1\s*\)/);
if (!sameArgs.length) pass('D2', 'no no-op tx() pairs', "0 tx('x','x') translations");
else warn('D2', 'tx() pairs with identical EN/AR args', `app/page.tsx:${sameArgs.join(', ')} — acceptable for version labels, not for prose`);

// ---------------------------------------------------------------------------
// E. RTL-safe CSS
// ---------------------------------------------------------------------------
const logicalProps = ['inset-inline', 'margin-inline', 'padding-inline', 'border-inline',
  'margin-inline-start', 'margin-inline-end', 'padding-inline-start', 'padding-inline-end'];
const logicalLines = findLines(HOME_CSS, new RegExp(logicalProps.join('|')));
const rtlLines = findLines(HOME_CSS, /\[dir\s*=\s*['"]rtl['"]\]|\[lang\s*=\s*['"]ar['"]\]/);
const hardLeftRight = findLines(HOME_CSS, /(?:^|[;{]\s*)(?:left|right)\s*:/);
const hardTextAlign = findLines(HOME_CSS, /text-align\s*:\s*(?:left|right)\b/);

if (logicalLines.length >= 3 || rtlLines.length >= 2)
  pass('E1', 'RTL-safe CSS present', `${logicalLines.length} logical-property lines, ${rtlLines.length} rtl/arabic override lines (e.g. home.css:${logicalLines.slice(0, 3).join(',')} / ${rtlLines.slice(0, 3).join(',')})`);
else if (logicalLines.length || rtlLines.length)
  warn('E1', 'RTL handling thin', `only ${logicalLines.length} logical-property lines and ${rtlLines.length} rtl/arabic overrides in home.css`);
else
  fail('E1', 'RTL-safe CSS present', 'no logical properties and no [dir=rtl]/[lang=ar] overrides found in home.css');

if (hardLeftRight.length || hardTextAlign.length)
  warn('E2', 'physical left/right still used', `home.css:${hardLeftRight.slice(0, 12).join(',')||'-'} (left/right), :${hardTextAlign.slice(0, 12).join(',')||'-'} (text-align) — verify each has an RTL override`);
else
  pass('E2', 'no physical-direction CSS', 'home.css uses logical properties only');

// ---------------------------------------------------------------------------
// F. Reduced-motion guards cover every animation introduced in home.css
// ---------------------------------------------------------------------------
const blocks = reduceBlocks(HOME_CSS);
const mediaText = blocks.map((b) => b.text).join('\n');
const mediaLineList = findLines(HOME_CSS, /@media\s*\(prefers-reduced-motion/);
const manualText = (HOME_CSS.match(/html(?:\.reduce-motion|\[data-art=['"]off['"]\])[^{]*\{[^}]*\}/g) || []).join('\n');
const mediaClasses = new Set(classTokens(mediaText));
const manualClasses = new Set(classTokens(manualText));

// Baseline safety net in globals.css: *,*::before,*::after{animation-duration:.01ms!important}
const globalKillSwitch = /@media\s*\(prefers-reduced-motion[^)]*\)\s*\{\s*\*,\*::before,\*::after\s*\{[^}]*animation-duration\s*:\s*\.01ms/i.test(stripComments(S.globals));
if (globalKillSwitch) pass('F1', 'global reduced-motion fallback present', 'globals.css universal * rule caps animation-duration at .01ms');
else warn('F1', 'no global reduced-motion fallback', 'globals.css has no universal animation kill-switch; every animation must be explicitly guarded');

const keyframes = [...HOME_CSS.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => ({ name: m[1], line: HOME_CSS.slice(0, m.index).split('\n').length }));
const animGaps = [], animManual = [], animCovered = [];
for (const kf of keyframes) {
  const animRe = new RegExp('animation(?:-name)?\\s*:[^;]*\\b' + esc(kf.name) + '\\b', 'g');
  let m, found = 0;
  while ((m = animRe.exec(HOME_CSS))) {
    found++;
    const ln = HOME_CSS.slice(0, m.index).split('\n').length;
    const cssLines = lines(HOME_CSS);
    const srcLine = cssLines[ln - 1] || '';
    // declarations inside a reduced-motion / manual guard are not animations to cover
    if (/prefers-reduced-motion|reduce-motion|data-art/.test(srcLine)) continue;
    const cls = classTokens(selectorForDeclaration(cssLines, ln - 1));
    if (!cls.length) continue;
    for (const c of cls) {
      if (mediaClasses.has(c)) animCovered.push(`${c}@home.css:${ln}`);
      else if (manualClasses.has(c)) animManual.push(`${c}@home.css:${ln} (${kf.name})`);
      else animGaps.push(`.${c}@home.css:${ln} -> @keyframes ${kf.name}`);
    }
  }
  if (!found) warn('F2', `@keyframes ${kf.name} has no animation declaration`, `home.css:${kf.line} — dead keyframe or referenced from another file`);
}

if (!animGaps.length) pass('F2', 'all home.css animations have explicit reduced-motion guards', `${animCovered.length} class guards inside @media (prefers-reduced-motion) at home.css:${mediaLineList.join(',') || '-'}`);
else fail('F2', 'all home.css animations have explicit reduced-motion guards', animGaps.join(' | '));

if (animManual.length) warn('F3', 'animation guarded only by manual switch', `${animManual.join(' | ')} — OS prefers-reduced-motion relies on the global fallback only`);
else pass('F3', 'no manual-switch-only animation guards', 'every animation is inside the OS media query');

// A pass on F2 is vacuous if the rebuilt markup's reveal hooks have no CSS at all.
const hasBeat = /\.beat\b/.test(CLASS_CSS);
const hasDataIn = /\[data-in\s*=/.test(CLASS_CSS);
if (hasBeat && hasDataIn) pass('F4', 'new reveal hooks are styled', '.beat + [data-in=...] selectors exist in CSS');
else fail('F4', 'new reveal hooks are styled', `page.tsx uses .beat + data-in (page.tsx:143,149,265) but CSS has .beat=${hasBeat} [data-in]=${hasDataIn} — F2 passes only on leftover animations the new markup never uses`);

// ---------------------------------------------------------------------------
// G. Live deploy (optional): same structural signals in rendered HTML
// ---------------------------------------------------------------------------
if (LIVE) {
  try {
    const res = await fetch(DEPLOY_URL, { headers: { 'user-agent': 'homepage-redesign-guard/1.0' } });
    const html = await res.text();
    if (!res.ok) {
      warn('LIVE-0', 'deploy fetch returned non-200', `${DEPLOY_URL} -> HTTP ${res.status}`);
    } else {
      const h1n = (html.match(/<h1\b/gi) || []).length;
      const secn = (html.match(/<section\b/gi) || []).length;
      const liveHard = HARD_MARKERS.filter((m) => html.includes(m));
      const dataSections = (html.match(/data-section=/g) || []).length;
      const dataHome = /\bdata-homepage=/.test(html);
      const detail = `${DEPLOY_URL} | <h1>=${h1n} <section>=${secn} data-section=${dataSections} data-homepage=${dataHome} | old markers=${liveHard.join(',') || 'none'}`;
      if (liveHard.length) fail('LIVE-1', 'deployed homepage is still the OLD homepage (pending redesign deploy)', detail);
      else if (h1n === 1 && secn >= 4 && secn <= 6) pass('LIVE-1', 'deployed homepage has clean structure', detail);
      else warn('LIVE-1', 'deployed homepage structure unexpected', detail);
    }
  } catch (e) {
    warn('LIVE-1', 'deploy fetch failed', `${DEPLOY_URL} -> ${e && e.message ? e.message : String(e)}`);
  }
} else {
  add('LIVE-0', 'deploy check', 'SKIP', 'run with --live to fetch ' + DEPLOY_URL);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
const STATUS = { PASS: '+', FAIL: 'X', WARN: '!', SKIP: '-' };
console.log('=== HOMEPAGE REDESIGN SOURCE GUARD ===');
console.log(`root: ${ROOT}`);
console.log(`snapshot: ${SNAPSHOT}`);
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
console.log('NOTE: source guard only — it cannot verify pixels. See docs/HOMEPAGE-REDESIGN.md.');
process.exit(fails ? 1 : 0);
