#!/usr/bin/env node
/**
 * HOMEPAGE WOW + SEO GUARD — source-level diagnosis + test.
 *
 * Run from anywhere:   node website/tests-homepage-seo.mjs
 * Live deploy check:   node website/tests-homepage-seo.mjs --live
 * Custom deploy URL:   HOMEPAGE_URL=https://... node website/tests-homepage-seo.mjs --live
 *
 * Exit 0 = all HARD checks pass; exit 1 = at least one FAIL.
 * WARN findings are printed but do not fail the run.
 *
 * WHAT THIS GUARD CAN AND CANNOT DO
 * ---------------------------------------------------------------------
 * It reads SOURCE (app/page.tsx, app/home.css, app/globals.css,
 * app/layout.tsx, components/home/SEOContent.tsx) with exact file:line
 * reporting. With --live it fetches the deployed HTML and counts the same
 * structural signals in the rendered page. It CANNOT see pixels, visual
 * hierarchy, spacing, contrast, or whether the engraving looks like "art".
 * See docs/HOMEPAGE-WOW-SEO.md — source != pixels. That gap is deliberate
 * and is stated out loud in the verdict.
 *
 * The contract this guard enforces (S1 / S2 / S3):
 *   S1 — hero has a hand-crafted SVG with detailed geometry
 *        (concentric rings + 120 graduation ticks + orbital nodes + core),
 *        AND a first-load entrance with STAGGERED, NAMED variants.
 *   S2 — SEOContent is MOUNTED in page.tsx, carries real bilingual prose +
 *        a native <details> FAQ, and layout.tsx emits a FAQPage JSON-LD
 *        mainEntity that mirrors it; metadata is enriched.
 *   S3 — style tokens / reduced-motion guards cover EVERY new animation,
 *        and homepage render code is free of hydration-unsafe calls.
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

/** 1-based line numbers of every line matching `re` */
function findLines(src, re) {
  const out = [];
  lines(src).forEach((line, i) => { if (re.test(line)) out.push(i + 1); });
  return out;
}
/** replace /* ... *\/ comment bodies with spaces, preserving line numbers */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}
/** brace-balanced bodies of all @media (prefers-reduced-motion ...) blocks */
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
/** class tokens from a CSS selector/declaration text */
function classTokens(text) {
  return [...text.matchAll(/(?:^|[\s,{}>+~])\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// 0. Files present
// ---------------------------------------------------------------------------
const FILES = {
  page: 'app/page.tsx',
  home: 'app/home.css',
  globals: 'app/globals.css',
  layout: 'app/layout.tsx',
  seo: 'components/home/SEOContent.tsx',
};
const S = {};
for (const [k, rel] of Object.entries(FILES)) {
  if (!exists(rel)) { fail('FILE-' + k, `missing ${rel}`, 'expected artifact not found'); S[k] = ''; }
  else S[k] = read(rel);
}
const PAGE = stripComments(S.page);
const HOME = stripComments(S.home);
const GLOBALS = stripComments(S.globals);
const SEO = stripComments(S.seo);
const LAYOUT = stripComments(S.layout);
const CSS = HOME + '\n' + GLOBALS;

// ---------------------------------------------------------------------------
// S1-A — v11.41 HERO MOSAIC: >=5 miniature-window panels + gear anchor.
// The old orbit geometry (rings/ticks/nodes/core) was rejected by the founder.
// ---------------------------------------------------------------------------
const gridLine = findLines(PAGE, /className="hm-grid"/)[0];
const panelLines = findLines(PAGE, /className="hm-panel hm-/);
const panelsN = panelLines.length;
const miniUi = ['hm-app-rail', 'hm-app-tool', 'hm-code-add', 'hm-cli-body',
  'hm-term-body', 'hm-phone-code', 'hm-cron-row'].filter((c) => PAGE.includes(c));
const gear = /const LIME = '#9be515'/.test(PAGE) && /const BLACK = '#000000'/.test(PAGE)
  && /className="hm-mark"/.test(PAGE);
if (gridLine && panelsN >= 5 && miniUi.length >= 5 && gear) {
  pass('W1', 'hero mosaic has detailed miniature-window geometry',
    `app/page.tsx:${gridLine} <div class="hm-grid"> — ${panelsN} .hm-panel windows `
    + `(page.tsx:${panelLines.join(',')}); mini-UIs: ${miniUi.join(', ')}; gear anchor present`);
} else {
  fail('W1', 'hero mosaic has detailed miniature-window geometry',
    `hm-grid@page.tsx:${gridLine || 'MISSING'} | panels=${panelsN} (need >=5) `
    + `| mini-UIs=${miniUi.join(', ')} | gear=${gear}`);
}

// ---------------------------------------------------------------------------
// S1-B — Entrance animation with staggered, NAMED variants
// ---------------------------------------------------------------------------
const heroKfs = [...HOME.matchAll(/@keyframes\s+(hero-[\w-]+|he-[\w-]+)/g)]
  .map((m) => ({ name: m[1], line: HOME.slice(0, m.index).split('\n').length }));
const heroEnterLines = findLines(PAGE, /className="[^"]*\bhero-enter\b/);
const heroRuleLine = findLines(PAGE, /hero-rule-enter/)[0];
const heroArtLine = findLines(PAGE, /hero-art-enter/)[0];
const staggerLines = findLines(PAGE, /'--d':/);
const cssStaggerLine = findLines(HOME, /animation-delay:var\(--d/);
const entranceNamed = heroKfs.length >= 3
  && heroKfs.some((k) => /rise/.test(k.name))
  && heroKfs.some((k) => /rule/.test(k.name))
  && heroKfs.some((k) => /art-in/.test(k.name));
const staggered = staggerLines.length >= 5 && cssStaggerLine.length >= 2;
if (entranceNamed && staggered && heroEnterLines.length >= 4 && heroRuleLine && heroArtLine) {
  pass('W2', 'first-load entrance has staggered named variants',
    `${heroKfs.length} hero keyframes (${heroKfs.map((k) => k.name + '@home.css:' + k.line).join(', ')}); `
    + `${heroEnterLines.length} .hero-enter nodes + rule:page.tsx:${heroRuleLine} + art:page.tsx:${heroArtLine}; `
    + `${staggerLines.length} staggered --d delays (page.tsx:${staggerLines.join(',')}), CSS home.css:${cssStaggerLine.join(',')}`);
} else {
  fail('W2', 'first-load entrance has staggered named variants',
    `keyframes=${heroKfs.map((k) => k.name).join(',') || 'NONE'} named=${entranceNamed} | hero-enter nodes=${heroEnterLines.length} `
    + `rule=${heroRuleLine || '-'} art=${heroArtLine || '-'} | --d markup=${staggerLines.join(',') || '-'} CSS=${cssStaggerLine.join(',') || '-'} staggered=${staggered}`);
}

// ---------------------------------------------------------------------------
// S3-A — Reduced-motion guards cover EVERY new hero animation
// ---------------------------------------------------------------------------
const NEW_ANIM_CLASSES = ['hero-enter', 'hero-rule-enter', 'hero-art-enter', 'hm-panel'];
const rm = reduceBlocks(HOME);
const rmText = rm.map((b) => b.text).join('\n');
const manualText = (HOME.match(/html(?:\.reduce-motion|\[data-art=['"]off['"]\])[^{]*\{[^}]*\}/g) || []).join('\n');
const missing = NEW_ANIM_CLASSES.filter((c) =>
  !(new RegExp('\\.' + esc(c) + '\\b').test(rmText) && new RegExp('\\.' + esc(c) + '\\b').test(manualText)));
const killGlobal = /@media\s*\(prefers-reduced-motion[^)]*\)\s*\{\s*\*,\*::before,\*::after\s*\{[^}]*animation-duration\s*:\s*\.01ms/i.test(GLOBALS);
if (!missing.length) {
  pass('W3', 'reduced-motion guards cover all new animations',
    `${NEW_ANIM_CLASSES.length}/${NEW_ANIM_CLASSES.length} hero animation classes inside both OS @media and manual guards `
    + `(home.css:${rm.map((b) => b.start).join(',')} + :is() guards); global kill-switch globals.css:${findLines(GLOBALS, /animation-duration:\.01ms/).join(',') || '-'}`
    + (killGlobal ? '' : ' (NOTE: universal kill-switch absent)'));
} else {
  fail('W3', 'reduced-motion guards cover all new animations',
    `unguarded: ${missing.join(', ')} — add to BOTH the @media (prefers-reduced-motion) block and the .reduce-motion/[data-art=off] :is() lists`);
}

// ---------------------------------------------------------------------------
// S2-A — SEOContent is MOUNTED in page.tsx (not just imported)
// ---------------------------------------------------------------------------
const seoImport = findLines(PAGE, /import\s*\{\s*SEOContent\s*\}/)[0];
const seoMount = findLines(PAGE, /<SEOContent\s*\/?>/)[0];
const seoSection = /<section(?:\s|>)/.test(SEO);
const seoH2 = findLines(SEO, /<h2\b/).length;
const seoH3 = findLines(SEO, /<h3\b/).length;
const seoDetails = findLines(SEO, /<details\b/).length;
// FAQ entries and subsections are generated by .map(); count their source arrays.
// Each Q&A has an EN and an AR `q:` field — halve to get the Q&A count.
const faqEntries = Math.round((SEO.match(/\bq:\s*'/g) || []).length / 2);
const arLinesSeo = findLines(SEO, /[\u0600-\u06FF]/).length;
const seoReal = seoSection && seoH2 >= 1 && seoH3 >= 2 && seoDetails >= 1 && faqEntries >= 4 && arLinesSeo >= 20;
if (seoImport && seoMount && seoReal) {
  pass('S1', 'SEOContent MOUNTED with real bilingual content',
    `import page.tsx:${seoImport}, render <SEOContent /> page.tsx:${seoMount} (before final CTA); `
    + `SEOContent.tsx: ${arLinesSeo} Arabic lines, ${seoH2} h2, ${seoH3} h3, ${seoDetails} native <details>, ${faqEntries} FAQ Q&As — substantive, not a stub`);
} else {
  fail('S1', 'SEOContent MOUNTED with real bilingual content',
    `import=${seoImport || '-'} render=${seoMount || '-'} section=${seoSection} h2=${seoH2} h3=${seoH3} details=${seoDetails} faqEntries=${faqEntries} arLines=${arLinesSeo} (need h2>=1 h3>=2 details>=1 faq>=4 ar>=20)`);
}

// ---------------------------------------------------------------------------
// S2-B — FAQPage JSON-LD mirrors the rendered FAQ
// ---------------------------------------------------------------------------
const faqTypeLine = findLines(LAYOUT, /'@type':\s*'FAQPage'/)[0];
const mainEntityLine = findLines(LAYOUT, /mainEntity:/)[0];
const questionLine = findLines(LAYOUT, /'@type':\s*'Question'/)[0];
const answerLine = findLines(LAYOUT, /acceptedAnswer:/)[0];
const ldScriptLine = findLines(S.layout, /type="application\/ld\+json"/);
// The Question node is written once inside .map(); the 4 entries are the tuples in FAQ_ENTRIES.
const layoutFaqEntries = (() => {
  const start = LAYOUT.indexOf('FAQ_ENTRIES');
  const end = LAYOUT.indexOf('FAQ_SCHEMA', start);
  return (start >= 0 && end > start ? (LAYOUT.slice(start, end).match(/^\s*\[$/gm) || []).length : 0);
})();
const faqCount = layoutFaqEntries || faqEntries;
if (faqTypeLine && mainEntityLine && questionLine && answerLine && ldScriptLine.length >= 2 && faqCount >= 4) {
  pass('S2', 'FAQPage JSON-LD present in layout.tsx',
    `FAQPage layout.tsx:${faqTypeLine}, mainEntity:${mainEntityLine}, Question:${questionLine}, acceptedAnswer:${answerLine}; `
    + `${faqCount} Q&As (FAQ_ENTRIES); ld+json scripts layout.tsx:${ldScriptLine.join(',')} (SoftwareApplication + FAQPage)`);
} else {
  fail('S2', 'FAQPage JSON-LD present in layout.tsx',
    `FAQPage=${faqTypeLine || '-'} mainEntity=${mainEntityLine || '-'} Question=${questionLine || '-'} answer=${answerLine || '-'} `
    + `ld+json scripts=${ldScriptLine.join(',') || '-'} questions=${faqCount} (need >=4)`);
}

// ---------------------------------------------------------------------------
// S2-C — Metadata enriched
// ---------------------------------------------------------------------------
// `keywords` is deliberately absent: Google has ignored it since 2009 and the
// old list was keyword-stuffed. One natural phrase per route in SEO.* instead
// (docs/SEO-WORDS-V1144.md §3.2). Assert that the dead tag stays gone.
const metaKeys = ['export const metadata: Metadata', 'title:', 'description:', 'openGraph:', 'robots:', 'alternates:', 'twitter:', 'canonical:'];
const metaMissing = metaKeys.filter((k) => !LAYOUT.includes(k));
const hasKeywords = /^\s*keywords\s*:/m.test(LAYOUT);
if (!metaMissing.length && !hasKeywords) pass('S3', 'metadata enriched', `all ${metaKeys.length} metadata surfaces present in layout.tsx; no keywords meta tag (ignored by Google since 2009)`);
else fail('S3', 'metadata enriched', `missing: ${metaMissing.join(', ') || 'none'}${hasKeywords ? ' | keywords meta tag still present' : ''}`);

// ---------------------------------------------------------------------------
// S2-D — h1 / h2 / h3 hierarchy sane (source, render order)
// ---------------------------------------------------------------------------
const h1 = findLines(PAGE, /<h1\b/);
const h2Page = findLines(PAGE, /<h2\b/);
const h3Page = findLines(PAGE, /<h3\b/);
const h2Seo = findLines(SEO, /<h2\b/);
const h3Seo = findLines(SEO, /<h3\b/);
const firstH2 = h2Page[0] ?? Infinity;
const hierarchyOk = h1.length === 1 && h2Page.length >= 3 && !h3Page.some((n) => n < firstH2)
  && h2Seo.length >= 1 && h3Seo.length >= 2;
if (hierarchyOk) {
  pass('S4', 'heading hierarchy sane',
    `exactly 1 <h1> (page.tsx:${h1[0]}); ${h2Page.length} h2 (page.tsx:${h2Page.join(',')}); `
    + `SEOContent h2:${h2Seo.join(',')} h3:${h3Seo.join(',')}; no h3 before first h2`);
} else {
  fail('S4', 'heading hierarchy sane',
    `h1=${h1.join(',') || 'NONE'} h2=${h2Page.join(',') || 'NONE'} h3=${h3Page.join(',') || 'NONE'} `
    + `seoH2=${h2Seo.join(',') || '-'} seoH3=${h3Seo.join(',') || '-'} firstH2=${firstH2}`);
}

// ---------------------------------------------------------------------------
// S3-B — No hydration-unsafe calls in homepage render code
// ---------------------------------------------------------------------------
const unsafeRe = /Math\.random\s*\(|Date\.now\s*\(|new Date\s*\(|performance\.now\s*\(/g;
const scope = [
  ['app/page.tsx', PAGE],
  ['components/home/SEOContent.tsx', SEO],
];
const unsafe = [];
for (const [rel, src] of scope) {
  for (const m of src.matchAll(unsafeRe)) {
    unsafe.push(`${rel}:${src.slice(0, m.index).split('\n').length} ${m[0]}`);
  }
}
if (!unsafe.length) {
  pass('S5', 'homepage render code is hydration-safe',
    'no Math.random / Date.now / new Date / performance.now in app/page.tsx or components/home/SEOContent.tsx; hero geometry is index-derived');
} else {
  fail('S5', 'homepage render code is hydration-safe', unsafe.join(' | '));
}
// Out-of-scope occurrences are reported, not failed.
const allScope = [];
for (const rel of ['app/auth/page.tsx', 'app/sitemap.ts']) {
  if (!exists(rel)) continue;
  const src = stripComments(read(rel));
  for (const m of src.matchAll(unsafeRe)) allScope.push(`${rel}:${src.slice(0, m.index).split('\n').length} ${m[0]}`);
}
if (allScope.length) warn('S6', 'hydration-unsafe calls elsewhere (out of homepage scope)', allScope.join(' | ') + ' — not this guard\'s contract');

// ---------------------------------------------------------------------------
// LIVE — deployed HTML carries the new markers + SEO FAQ text
// ---------------------------------------------------------------------------
if (LIVE) {
  try {
    const res = await fetch(DEPLOY_URL, { headers: { 'user-agent': 'homepage-wow-seo-guard/1.0' } });
    const html = await res.text();
    const h1n = (html.match(/<h1\b/gi) || []).length;
    const hasFaqLd = /FAQPage/.test(html) && /mainEntity/.test(html) && /acceptedAnswer/.test(html);
    const hasQ = /Is SADEEM really a local-first AI coding agent/.test(html);
    const hasGuide = /id="guide"/.test(html);
    const hasEngrave = /he-svg|NEURAL CORE|hero-enter/.test(html);
    const hasOld = ['hero-metrics', 'eng-plate-notes', 'art-corner', 'hero-chips'].filter((m) => html.includes(m));
    const detail = `${DEPLOY_URL} HTTP ${res.status} | <h1>=${h1n} FAQ-LD=${hasFaqLd} FAQtext=${hasQ} #guide=${hasGuide} engraving=${hasEngrave} oldMarkers=${hasOld.join(',') || 'none'}`;
    if (!res.ok) warn('LIVE-0', 'deploy fetch non-200', detail);
    else if (hasOld.length) fail('LIVE-1', 'deployed homepage is still OLD (pending redeploy)', detail);
    else if (hasFaqLd && hasQ && hasGuide && hasEngrave && h1n === 1) pass('LIVE-1', 'deployed homepage has new wow + SEO markers', detail);
    else warn('LIVE-1', 'deployed homepage markers incomplete', detail);
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
console.log('=== HOMEPAGE WOW + SEO SOURCE GUARD ===');
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
console.log('NOTE: source guard only — it cannot verify pixels. See docs/HOMEPAGE-WOW-SEO.md.');
process.exit(fails ? 1 : 0);
