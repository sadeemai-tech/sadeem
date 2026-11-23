#!/usr/bin/env node
/**
 * APP-REPLICA DEMO GUARD — source-level diagnosis + test (+ optional live check).
 *
 * Run from anywhere:   node website/tests-app-demo.mjs
 * Full run:            node website/tests-app-demo.mjs --build --live
 * Live URL override:   HOMEPAGE_URL=https://your-deploy/ node website/tests-app-demo.mjs --live
 *
 * Exit 0 = all hard checks pass; exit 1 = at least one FAIL.
 * WARN findings print but do not fail the run.
 *
 * SCOPE / HONESTY: this guard reads SOURCE and, with --build, the built static
 * HTML. It cannot see pixels. A PASS here means "the replica's markup carries
 * the right structure and motion contract", NOT "it looks like the app".
 * See docs/APP-DEMO-FIDELITY.md for the pixel caveat and the gap list.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url)); // website/
const DEPLOY_URL = process.env.HOMEPAGE_URL || 'https://sadeem-website-theta.vercel.app/';
const ARGS = new Set(process.argv.slice(2));
const results = [];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const lines = (s) => s.split(/\r?\n/);

function add(id, title, status, detail) { results.push({ id, title, status, detail }); }
function pass(id, title, detail) { add(id, title, 'PASS', detail); }
function fail(id, title, detail) { add(id, title, 'FAIL', detail); }
function warn(id, title, detail) { add(id, title, 'WARN', detail); }

/** 1-based line numbers of a regex in a source string (regex must NOT be /g). */
function findLines(src, re) {
  const r = new RegExp(re.source, re.flags.includes('i') ? 'i' : '');
  const out = [];
  lines(src).forEach((line, i) => { if (r.test(line)) out.push(i + 1); });
  return out;
}
const cite = (file, ln) => `${file}:${ln}`;

// ---------------------------------------------------------------------------
// 0. Files present
// ---------------------------------------------------------------------------
const FILES = { page: 'app/page.tsx', css: 'app/home.css' };
const S = {};
for (const [k, rel] of Object.entries(FILES)) {
  if (!exists(rel)) { fail('FILE-' + k, `missing ${rel}`, 'D1/D2 artifact not found'); S[k] = ''; }
  else S[k] = read(rel);
}
const PAGE = S.page, CSS = S.css;

// ---------------------------------------------------------------------------
// 1. Structural checklist — the 11 things the replica must contain.
//    Each entry: [id, label, regex in page.tsx, regex in home.css]
// ---------------------------------------------------------------------------
const STRUCTURE = [
  ['S1',  'top rail (titlebar + nav rail)',   /className="appmock-rail"/,                    /\.appmock-rail[,\s{]/],
  ['S2',  'chat-left column',                 /className="appmock-chat"/,                    /\.appmock-chat[,\s{]/],
  ['S3',  'chat head',                        /className="appmock-chat-head/,                /\.appmock-chat-head[,\s{]/],
  ['S4',  'run strip (THINK·WORK·BUILD·RUN·PROVE)', /className="appmock-strip/,              /\.appmock-strip[,\s{]/],
  ['S5a', 'message rows',                     /className="appmock-msg /,                     /\.appmock-msg[,\s{]/],
  ['S5b', 'left gutter orbit circle',         /className="appmock-gutter/,                   /\.appmock-gutter[,\s{]/],
  ['S6',  'reasoning block',                  /className="appmock-reason/,                   /\.appmock-reason[,\s{]/],
  ['S7',  'tool card',                        /className="appmock-tool/,                     /\.appmock-tool[,\s{]/],
  ['S8a', 'composer mic',                     /className="appmock-mic"/,                     /\.appmock-mic[,\s{]/],
  ['S8b', 'composer context orb',             /className="appmock-orb"/,                     /\.appmock-orb[,\s{]/],
  ['S8c', 'composer send',                    /className="appmock-send"/,                    /\.appmock-send[,\s{]/],
  ['S9',  'right work area',                  /className="appmock-work"/,                    /\.appmock-work[,\s{]/],
  ['S10a','moving cursor element',           /className="appmock-cursor"/,                  /\.appmock-cursor[,\s{:]/],
  ['S10b','click pulse element',             /className="appmock-click"/,                   null],
];
const structGaps = [];
const structEvidence = [];
for (const [id, label, pageRe, cssRe] of STRUCTURE) {
  const pl = findLines(PAGE, pageRe);
  const cl = cssRe ? findLines(CSS, cssRe) : null;
  const ok = pl.length > 0 && (!cssRe || cl.length > 0);
  if (ok) structEvidence.push(`${id} ${cite(FILES.page, pl[0])}${cssRe ? ' + ' + cite(FILES.css, cl[0]) : ''}`);
  else structGaps.push(`${id} ${label} (page:${pl[0] ?? '-'} css:${cssRe ? (cl[0] ?? '-') : 'n/a'})`);
}
if (!structGaps.length) pass('S0', 'all structural markers present in page.tsx + home.css', structEvidence.join(' | '));
else fail('S0', 'all structural markers present in page.tsx + home.css', 'MISSING: ' + structGaps.join(' | '));

// moving cursor needs a real keyframed path, not just a static element
const cursorKf = [/appmock-cursor-move/, /appmock-cursor-path/].map((r) => findLines(PAGE + '\n' + CSS, r)[0]).filter(Boolean);
const clickKf  = [/appmock-click\b/, /appmock-click-pulse/].map((r) => findLines(PAGE + '\n' + CSS, r)[0]).filter(Boolean);
if (cursorKf.length && clickKf.length) pass('S11', 'cursor path + click pulse are keyframed', `cursor kf lines ${cursorKf.join(',')}; click kf lines ${clickKf.join(',')}`);
else fail('S11', 'cursor path + click pulse are keyframed', `cursor kf=${cursorKf.length} click kf=${clickKf.length}`);

// the two motion systems must not redefine the SAME @keyframes name with
// different bodies (cascade-dependent behaviour = brittleness, not fidelity).
const kfNames = new Set();
for (const src of [PAGE, CSS]) {
  for (const m of src.matchAll(/@keyframes\s+(appmock-[\w-]+)/g)) kfNames.add(m[1]);
}
const dupKf = [];
for (const name of kfNames) {
  const exact = new RegExp('@keyframes\\s+' + name + '(?![\\w-])', 'g');
  const count = (PAGE.match(exact) || []).length + (CSS.match(exact) || []).length;
  if (count > 1) dupKf.push(`${name} (${count}x)`);
}
if (dupKf.length) warn('S12', 'duplicate @keyframes names across page.tsx and home.css', `${dupKf.join(', ')} — cascade decides which body wins; verify in a browser`);
else pass('S12', 'no duplicate @keyframes names', 'single definition per animation');

// ---------------------------------------------------------------------------
// 2. Founder subtractions — no report card / TAINT row / proof panel in demo.
//    Scope: page.tsx demo region only (before the marketing PROOF section).
// ---------------------------------------------------------------------------
const demoStart = PAGE.indexOf('function ProductInUse()');
const demoEnd = PAGE.indexOf('export default function Home()');
const DEMO_SRC = PAGE.slice(demoStart > -1 ? demoStart : 0, demoEnd > -1 ? demoEnd : PAGE.length);
const demoOffset = (PAGE.slice(0, Math.max(0, demoStart)).split('\n').length - 1);
/** line numbers in DEMO_SRC, reported against the real page.tsx */
const demoLines = (re) => findLines(DEMO_SRC, re).map((n) => n + demoOffset);
const forbidden = [
  ['report card', /\breport[- ]?card\b|appmock-report|\bREPORT CARD\b/i],
  ['TAINT row',   /\btaint\b|appmock-taint/i],
  ['proof panel', /proof[- ]?panel|appmock-proof-panel|\bpr-anchor\b/i],
];
const banned = [];
for (const [label, re] of forbidden) {
  const hits = demoLines(re);
  if (hits.length) banned.push(`${label}@${hits.join(',')}`);
}
if (!banned.length) pass('R1', 'no report card / TAINT row / proof panel in the demo', 'forbidden markup absent from ProductInUse');
else fail('R1', 'no report card / TAINT row / proof panel in the demo', banned.join(' | '));

const proofChip = demoLines(/appmock-proof|\bPROOF\b/);
if (proofChip.length) warn('R2', 'PROOF micro-chip present inside demo', `${cite(FILES.page, proofChip[0])} — a label, not a panel; mirrors the app\'s compact ProofRibbon button (src/components/ChatPanel.tsx:1805). Confirm the founder is OK with any PROOF text at all.`);
else pass('R2', 'no PROOF label inside demo', 'none');

// ---------------------------------------------------------------------------
// 3. Reduced-motion / kill-switch coverage
// ---------------------------------------------------------------------------
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
const rBlocks = reduceBlocks(CSS);
const rText = rBlocks.map((b) => b.text).join('\n');
const broadGuard = /\[class\*=['"]appmock-['"]\]\s*\{[^}]*animation:\s*none\s*!important[^}]*transition:\s*none\s*!important/;
const mediaBroad = broadGuard.test(rText);
const manualBroad = /html\.reduce-motion\s+\[class\*=['"]appmock-['"]\]/.test(CSS) &&
                    /html\[data-art=['"]off['"]\]\s+\[class\*=['"]appmock-['"]\]/.test(CSS);
if (mediaBroad && manualBroad) pass('M1', 'broad reduced-motion kill switch covers every appmock animation', `[class*='appmock-'] animation:none+transition:none at home.css:${findLines(CSS, /\[class\*=['"]appmock-['"]\]\s*\{\s*animation:\s*none\s*!important/)[0]} and for html.reduce-motion / [data-art='off']`);
else fail('M1', 'broad reduced-motion kill switch covers every appmock animation', `mediaBroad=${mediaBroad} manualBroad=${manualBroad}`);

// every @keyframes name used by an appmock animation must be reachable via the
// broad guard; also require the cursor to be actually hidden, not just paused.
const cursorHidden = /\.appmock-cursor\s*\{\s*display:\s*none\s*!important/.test(rText) &&
                     /html\.reduce-motion\s+\.appmock-cursor\s*,\s*\n?\s*html\[data-art=['"]off['"]\]\s+\.appmock-cursor\s*\{\s*display:\s*none\s*!important/.test(CSS);
if (cursorHidden) pass('M2', 'scripted cursor hidden (not frozen) when motion is off', 'display:none!important in all three kill switches');
else fail('M2', 'scripted cursor hidden (not frozen) when motion is off', 'cursor must be display:none under prefers-reduced-motion, .reduce-motion and data-art=off');

// page.tsx inline motion block must carry its own reduced-motion contract
const inlineReduce = /@media \(prefers-reduced-motion:reduce\)/.test(PAGE) &&
                     /html\.reduce-motion \.appmock-stage/.test(PAGE);
if (inlineReduce) pass('M3', 'inline APP_MOCK_MOTION carries its own reduced-motion guards', `page.tsx:${findLines(PAGE, /@media \(prefers-reduced-motion:reduce\)/)[0]}`);
else fail('M3', 'inline APP_MOCK_MOTION carries its own reduced-motion guards', 'missing inline prefers-reduced-motion / html.reduce-motion block');

// ---------------------------------------------------------------------------
// 4. Hydration safety — no Date / Math.random at render; motion is DOM-attribute.
// ---------------------------------------------------------------------------
const renderNondet = [];
lines(PAGE).forEach((t, i) => {
  if (!/Math\.random\s*\(|new Date\s*\(|Date\.now\s*\(/.test(t)) return;
  const s = t.trim();
  if (s.startsWith('//') || s.startsWith('*')) return;
  renderNondet.push(`${cite(FILES.page, i + 1)} ${s.slice(0, 80)}`);
});
const setAttrOnly = !/useState[^\n]*appmock|setState[^\n]*data-in/i.test(PAGE) &&
                    /setAttribute\(\s*['"]data-in['"]/.test(PAGE);
if (!renderNondet.length && setAttrOnly) pass('H1', 'hydration-safe: no render-time Date/Math.random, motion writes data-in only', 'useStageReplay uses setAttribute, never React state');
else fail('H1', 'hydration-safe: no render-time Date/Math.random, motion writes data-in only', `${renderNondet.join(' | ') || 'no nondeterminism'} | setAttrOnly=${setAttrOnly}`);

// ---------------------------------------------------------------------------
// 5. Bilingual + RTL
// ---------------------------------------------------------------------------
const arabic = /[\u0600-\u06FF]/;
const txCount = (PAGE.match(/\btx\(/g) || []).length;
const arLines = findLines(PAGE, arabic).length;
const demoTx = (DEMO_SRC.match(/\btx\(/g) || []).length;
const bilingual = txCount >= 50 && arLines >= 60 && demoTx >= 30;
if (bilingual) pass('L1', 'bilingual EN/AR copy beside the markup', `${txCount} tx() pairs total, ${arLines} Arabic lines, ${demoTx} inside demo`);
else fail('L1', 'bilingual EN/AR copy beside the markup', `tx=${txCount} arLines=${arLines} demoTx=${demoTx}`);

const rtlDir = /data-dir=\{dir\}/.test(PAGE) && /lang === 'ar' \? 'rtl' : 'ltr'/.test(PAGE);
const rtlCss = /html\[lang='ar'\]/.test(CSS) && /data-dir=["']rtl["']/.test(PAGE);
const logical = /margin-inline-start|padding-inline-start|inset-inline-start|border-inline-end/.test(CSS);
const dirAuto = (DEMO_SRC.match(/dir="auto"/g) || []).length >= 5;
if (rtlDir && rtlCss && logical && dirAuto) pass('L2', 'RTL-safe: data-dir, logical properties, dir=auto on text', `dirAuto nodes=${dirAuto}`);
else fail('L2', 'RTL-safe: data-dir, logical properties, dir=auto on text', `rtlDir=${rtlDir} rtlCss=${rtlCss} logical=${logical} dirAuto=${dirAuto}`);

// ---------------------------------------------------------------------------
// 6. Honest caption
// ---------------------------------------------------------------------------
const honest = /not a screen recording/i.test(PAGE) && /ليس تسجيل شاشة/.test(PAGE);
if (honest) pass('T1', 'honest "illustration not recording" caption', `page.tsx:${findLines(PAGE, /not a screen recording/i)[0]}`);
else fail('T1', 'honest "illustration not recording" caption', 'caption must say it is a stylised illustration, not a recording');

// note: physical LTR shell is intentional but worth flagging
warn('N1', 'shell forced physically LTR even in Arabic', `page.tsx:${findLines(PAGE, /className="appmock-window" dir="ltr"/)[0]} + home.css:${findLines(CSS, /\.appmock-main\{[^}]*direction:ltr/)[0]} — faithful to the app's physical rail, but the chat column does not mirror in RTL; text is dir=auto/rtl. Confirm this is intended.`);

// ---------------------------------------------------------------------------
// 7. Optional build + typecheck
// ---------------------------------------------------------------------------
if (ARGS.has('--build')) {
  const run = (cmd) => {
    const r = spawnSync(cmd, { cwd: ROOT, shell: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    return { code: r.status, tail: (r.stdout + r.stderr).split(/\r?\n/).filter(Boolean).slice(-3).join(' / ') };
  };
  const b = run('npm run build');
  if (b.code === 0) pass('B1', 'npm run build', b.tail);
  else fail('B1', 'npm run build', `exit ${b.code}: ${b.tail}`);
  const t = run('npx tsc --noEmit');
  if (t.code === 0) pass('B2', 'npx tsc --noEmit', t.tail || 'clean');
  else fail('B2', 'npx tsc --noEmit', `exit ${t.code}: ${t.tail}`);
}

// ---------------------------------------------------------------------------
// 8. Optional live check — parent redeploys, then this must find appmock-*.
// ---------------------------------------------------------------------------
if (ARGS.has('--live')) {
  const buildHtml = exists('.next/server/app/index.html') ? read('.next/server/app/index.html') : '';
  const buildMarkers = (buildHtml.match(/appmock-/g) || []).length;
  if (buildMarkers > 0) pass('V0', 'built static HTML contains appmock-* markers', `${buildMarkers} occurrences in .next/server/app/index.html`);
  else fail('V0', 'built static HTML contains appmock-* markers', 'run npm run build first');

  try {
    const res = await fetch(DEPLOY_URL, { redirect: 'follow' });
    const html = await res.text();
    const live = (html.match(/appmock-/g) || []).length;
    const old = (html.match(/demo-msg/g) || []).length;
    const needed = ['appmock-rail', 'appmock-chat-head', 'appmock-strip', 'appmock-gutter',
                    'appmock-tool', 'appmock-mic', 'appmock-orb', 'appmock-send',
                    'appmock-work', 'appmock-cursor'];
    const missing = needed.filter((m) => !html.includes(m));
    if (res.ok && live > 0 && missing.length === 0) pass('V1', 'live / carries the new appmock-* markers', `${DEPLOY_URL} HTTP ${res.status}, ${live} markers, old demo-msg=${old}`);
    else fail('V1', 'live / carries the new appmock-* markers', `${DEPLOY_URL} HTTP ${res.status}, appmock=${live}, old demo-msg=${old}, missing=${missing.join(',') || 'none'} — parent must redeploy`);
  } catch (e) {
    fail('V1', 'live / carries the new appmock-* markers', `fetch failed: ${e.message}`);
  }
} else {
  warn('V1', 'live / marker check skipped', 'pass --live (after parent redeploys) to verify the deployed HTML');
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
const STATUS = { PASS: '+', FAIL: 'X', WARN: '!' };
console.log('=== APP-REPLICA DEMO GUARD (source-level; source != pixels) ===');
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
