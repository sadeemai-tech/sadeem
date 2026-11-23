#!/usr/bin/env node
// =====================================================================
// v11.42 — HERO BUTTONS + LIGHT-MODE COLOUR-CONTRAST SOURCE GUARD
// ---------------------------------------------------------------------
// Run from anywhere:  node tests-v1142-hero-light.mjs
//
// SOURCE-LEVEL ONLY (no browser, no edits). The founder reported three
// things on the published site:
//   1. "التنزيل لويندوز والريد دخلات ببعض" — the two hero CTAs cramp/overlap;
//   2. "مشكلة بتباين الألوان" — a colour-contrast problem on the buttons;
//   3. "الوضع المنير كلياته بيبقى أسود" — the whole hero + mosaic stays black
//      when the light theme is selected.
//
// This guard reads website/app/{page.tsx,home.css,globals.css} and proves:
//   A  two distinct, spaced, tappable, bilingual CTA buttons in the hero
//   B  BOTH themes are explicitly referenced by the hero CSS and are fed
//      from the shared palette tokens (not a local dark override)
//   C  no hardcoded dark canvas / lime-alpha paint survives in the hero
//   D  readable text tokens in both themes; the lime gear mark is untouched
//
// A FAIL = exit 1. See docs/HERO-LIGHT-V1142.md for the bilingual contract.
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const WEB = path.join(ROOT, 'website');
const P = {
  page: path.join(WEB, 'app/page.tsx'),
  home: path.join(WEB, 'app/home.css'),
  globals: path.join(WEB, 'app/globals.css'),
};
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const page = read(P.page);
const css = read(P.home);
const globals = read(P.globals);

/* ---------- source helpers (1-based lines, CRLF safe) ---------- */
const lineAt = (s, pos) => {
  let n = 1;
  for (let i = 0; i < pos; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
};
const findAll = (s, re) => {
  const out = [];
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m;
  while ((m = r.exec(s)) !== null) {
    out.push({ line: lineAt(s, m.index), pos: m.index, text: m[0] });
    if (m[0].length === 0) r.lastIndex++;
  }
  return out;
};
const firstLine = (s, re) => {
  const h = findAll(s, re);
  return h.length ? h[0].line : '?';
};
// keep offsets/line numbers, blank out only the comment bodies
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const loc = (rel, n) => `${rel}:${n}`;
const pageNoCm = stripComments(page);
const cssNoCm = stripComments(css);

/* ---------- region boundaries (anchored, never hard-coded line numbers) */
const homeIdx = page.indexOf('export default function Home()');
const heroOpenRe = /<section\b[^>]*\bhero\b[^>]*>/g;
heroOpenRe.lastIndex = homeIdx > 0 ? homeIdx : 0;
const heroOpen = heroOpenRe.exec(page);
const heroStart = heroOpen ? heroOpen.index : -1;
const heroEnd = heroStart >= 0 ? page.indexOf('</section>', heroStart + heroOpen[0].length) : -1;
const heroMarkup = heroStart >= 0 && heroEnd > heroStart ? page.slice(heroStart, heroEnd) : '';
const heroStartLine = heroStart >= 0 ? lineAt(page, heroStart) : -1;

const cssCut = css.indexOf('PRODUCT IN USE');
const heroCssEnd = cssCut > 0 ? cssCut : css.length;
const heroCss = css.slice(0, heroCssEnd);
const heroCssNoCm = stripComments(heroCss);
const heroCssLine = lineAt(css, heroCssEnd);

/* the exact .hero-actions row inside the hero */
const haIdx = heroMarkup.indexOf('className="hero-actions');
const haEnd = haIdx >= 0 ? heroMarkup.indexOf('</div>', haIdx) : -1;
const actions = haIdx >= 0 && haEnd > haIdx ? heroMarkup.slice(haIdx, haEnd) : '';

/* one CSS rule body by selector (hero CSS only) */
const bodyOf = (re) => {
  const m = heroCssNoCm.match(re);
  return m ? m[1] : '';
};

/* ---------- result plumbing ---------- */
const results = [];
let failed = 0;
const check = (id, ok, detail, where = '') => {
  if (!ok) failed++;
  results.push({ id, ok, detail, where });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${where ? ` [${where}]` : ''} — ${detail}`);
};

console.log('v11.42 HERO BUTTONS + LIGHT-MODE GUARD (source-level)');
console.log(`scanning: app/page.tsx (${page.length}B), app/home.css (${css.length}B), app/globals.css (${globals.length}B)`);
console.log(`hero region: page.tsx:${heroStartLine} | hero CSS: home.css:1-${heroCssLine}`);
console.log('');

/* =====================================================================
 * A — TWO DISTINCT, SPACED, TAPPABLE, BILINGUAL CTA BUTTONS
 * ===================================================================== */
const links = findAll(actions, /<Link\b/g);
const hasPrimary = /className="btn btn-solid"/.test(actions);
const hasSecondary = /className="btn hero-more"/.test(actions);
const oldBareLink = /className="link hero-more"/.test(actions);
check('A1', links.length === 2 && hasPrimary && hasSecondary && !oldBareLink,
  `two sibling <Link> CTAs: count=${links.length}, solid primary=${hasPrimary}, ` +
  `outline secondary=${hasSecondary}, old bare link=${oldBareLink}`,
  loc('website/app/page.tsx', heroStartLine >= 0 ? lineAt(page, page.indexOf('className="hero-actions', heroStart)) : '?'));

const actionsBody = bodyOf(/\.hero-actions\s*\{([^}]*)\}/);
const flexOk = /display\s*:\s*flex/.test(actionsBody);
const wrapOk = /flex-wrap\s*:\s*wrap/.test(actionsBody);
const centerOk = /justify-content\s*:\s*center/.test(actionsBody);
const gapM = actionsBody.match(/gap\s*:\s*([^;]+)/);
const gapOk = !!gapM && !/^\s*0\b/.test(gapM[1]);
check('A2', flexOk && wrapOk && centerOk && gapOk,
  `.hero-actions spacing: display:flex=${flexOk}, flex-wrap=${wrapOk}, ` +
  `centred=${centerOk}, nonzero gap=${gapOk} (${gapM ? gapM[1].trim() : 'none'}) — no overlap`,
  loc('website/app/home.css', firstLine(css, /\.hero-actions\s*\{/)));

const btnBody = bodyOf(/\.hero \.btn\s*\{([^}]*)\}/);
const minH = btnBody.match(/min-height\s*:\s*(\d+)px/);
const pads = btnBody.match(/padding-inline\s*:\s*(\d+)px/);
check('A3', !!minH && Number(minH[1]) >= 40 && !!pads && Number(pads[1]) >= 16,
  `hit targets: min-height=${minH ? minH[1] + 'px' : 'none'} (need >=40), ` +
  `padding-inline=${pads ? pads[1] + 'px' : 'none'} (need >=16)`,
  loc('website/app/home.css', firstLine(css, /\.hero \.btn\s*\{/)));

const globalsSolid = /\.btn-solid\s*\{[^}]*background\s*:\s*var\(--accent-fill\)/.test(globals);
const secondaryBody = bodyOf(/\.hero \.hero-more\s*\{([^}]*)\}/);
const hairline = /border-color\s*:\s*var\(--line-strong\)/.test(secondaryBody);
const inkText = /color\s*:\s*var\(--ink\)/.test(secondaryBody);
const flatten = findAll(heroCssNoCm, /\.hero \.btn\s*\{[^}]*color\s*:/);
check('A4', globalsSolid && hairline && inkText && flatten.length === 0,
  `distinct weight: lime --accent-fill primary=${globalsSolid}, ` +
  `hairline --line-strong secondary=${hairline}, --ink secondary text=${inkText}, ` +
  `flattening .hero .btn{color:} override=${flatten.length}`,
  loc('website/app/home.css', firstLine(css, /\.hero \.hero-more\s*\{/)));

const ctaPair = /cta\s*:\s*\[\s*'Download for Windows'\s*,\s*'[^']+'\s*\]/.test(page);
const morePair = /more\s*:\s*\[\s*'Read the docs'\s*,\s*'[^']+'\s*\]/.test(page);
const ctaTx = /tx\(HERO\.cta\[0\],\s*HERO\.cta\[1\]\)/.test(heroMarkup);
const moreTx = /tx\(HERO\.more\[0\],\s*HERO\.more\[1\]\)/.test(heroMarkup);
check('A5', ctaPair && morePair && ctaTx && moreTx,
  `bilingual labels present and rendered: cta pair=${ctaPair}, more pair=${morePair}, ` +
  `tx(cta)=${ctaTx}, tx(more)=${moreTx}`,
  loc('website/app/page.tsx', firstLine(page, /const HERO = /)));

/* =====================================================================
 * B — BOTH THEMES REFERENCED, FED BY SHARED PALETTE TOKENS
 * ===================================================================== */
const lightHook = /:root \.hero\s*\{/.test(heroCssNoCm);
const darkHook = /html\[data-theme\s*=\s*['"]dark['"]\] \.hero\s*\{/.test(heroCssNoCm);
check('B1', lightHook && darkHook,
  `hero CSS names both themes: :root .hero=${lightHook}, ` +
  `html[data-theme='dark'] .hero=${darkHook}`,
  loc('website/app/home.css', firstLine(css, /:root \.hero\s*\{/)));

const heroBody = bodyOf(/\.hero\s*\{([^}]*)\}/);
const themedBg = /background\s*:\s*var\(--hm-canvas\s*,\s*var\(--bg\)\)/.test(heroBody);
const themedInk = /color\s*:\s*var\(--ink\)/.test(heroBody);
check('B2', themedBg && themedInk,
  `hero canvas/text follow theme tokens: background=var(--hm-canvas,var(--bg))=${themedBg}, ` +
  `color=var(--ink)=${themedInk}`,
  loc('website/app/home.css', firstLine(css, /\.hero\s*\{/)));

const rootBg = /:root\s*\{[^}]*--bg\s*:/.test(globals);
const darkBg = /html\[data-theme\s*=\s*['"]dark['"]\]\s*\{[^}]*--bg\s*:/.test(globals);
check('B3', rootBg && darkBg,
  `globals.css defines --bg for both themes: :root=${rootBg}, dark=${darkBg}`,
  loc('website/app/globals.css', firstLine(globals, /html\[data-theme='dark'\]/)));

const panelBody = bodyOf(/\.hm-panel\s*\{([^}]*)\}/);
const panelToken = /background\s*:\s*var\(--hm-panel\s*,\s*var\(--paper\)\)/.test(panelBody);
const panelHairline = /border\s*:\s*1px solid var\(--line\)/.test(panelBody);
check('B4', panelToken && panelHairline,
  `mosaic panels adapt: background=var(--hm-panel,var(--paper))=${panelToken}, ` +
  `1px var(--line) hairline=${panelHairline}`,
  loc('website/app/home.css', firstLine(css, /\.hm-panel\s*\{/)));

/* =====================================================================
 * C — NO HARDCODED DARK CANVAS THAT IGNORES THE THEME TOKEN
 * ===================================================================== */
const darkHex = findAll(heroCssNoCm, /#0c1103\b|#0e1405\b|#0a0c0f\b|#15130e\b|#000000\b/i);
const limeAlpha = findAll(heroCssNoCm, /rgba?\(\s*155\s*,\s*229\s*,\s*21\b/i);
const anyHex = findAll(heroCssNoCm, /#[0-9a-f]{3,8}\b/i);
const anyRgba = findAll(heroCssNoCm, /\brgba?\([^)]*\)/i);
const hardcoded = [...darkHex, ...limeAlpha, ...anyHex, ...anyRgba];
check('C1', hardcoded.length === 0,
  hardcoded.length
    ? `${hardcoded.length} hardcoded colour literal(s) in hero CSS: ` +
      hardcoded.slice(0, 8).map((h) => loc('home.css', h.line) + ' "' + h.text + '"').join(', ')
    : 'zero colour literals in hero CSS — every paint resolves through a theme token',
  loc('website/app/home.css', hardcoded.length ? hardcoded[0].line : 1));

const literalHeroBg = findAll(heroCssNoCm, /\.hero\s*\{[^}]*background\s*:\s*#/);
const localOverride = findAll(heroCssNoCm,
  /\.hero\s*\{[^}]*--(?:ink|dim|faint|line|line-soft|line-strong|accent|accent-fill|accent-soft)\s*:/);
check('C2', literalHeroBg.length === 0 && localOverride.length === 0,
  `no local dark override: .hero{background:#...}=${literalHeroBg.length}, ` +
  `.hero{--ink/--line/--accent:...}=${localOverride.length}`,
  loc('website/app/home.css', firstLine(css, /\.hero\s*\{/)));

const limeConst = /const LIME = '#9be515'/.test(page);
const blackConst = /const BLACK = '#000000'/.test(page);
const limeSquare = /fill=\{LIME\}/.test(pageNoCm);
const blackGear = /fill=\{BLACK\}/.test(pageNoCm);
check('C3', limeConst && blackConst && limeSquare && blackGear,
  `identity kept in BOTH themes: lime const=${limeConst}, black const=${blackConst}, ` +
  `fill={LIME}=${limeSquare}, fill={BLACK}=${blackGear}`,
  loc('website/app/page.tsx', firstLine(page, /const LIME = /)));

/* =====================================================================
 * D — READABLE TEXT TOKENS IN BOTH THEMES
 * ===================================================================== */
const dimText = [
  /\.hero-note\s*\{[^}]*color\s*:\s*var\(--dim\)/,
  /\.hm-head-src\s*\{[^}]*color\s*:\s*var\(--dim\)/,
  /\.hm-index\s*\{[^}]*color\s*:\s*var\(--dim\)/,
  /\.hm-foot>span:nth-child\(2\)\s*\{[^}]*color\s*:\s*var\(--dim\)/,
  /\.hm-phone-state\s*\{[^}]*color\s*:\s*var\(--dim\)/,
];
const dimOk = dimText.every((re) => re.test(heroCssNoCm));
const faintText = findAll(heroCssNoCm, /color\s*:\s*var\(--faint\)/);
check('D1', dimOk && faintText.length === 0,
  `small text uses adaptive --dim: all key labels=${dimOk}, ` +
  `text still on low-contrast --faint=${faintText.length}`,
  loc('website/app/home.css', firstLine(css, /\.hero-note\s*\{/)));

const phoneInk = /\.hm-phone-letter\s*\{[^}]*color\s*:\s*var\(--bg\)|\.hm-phone-letter\s*\{[\s\S]{0,160}?color\s*:\s*var\(--bg\)/.test(heroCssNoCm);
check('D2', phoneInk,
  `ink-on-accent adapts with --bg on the lime mini-mark (no fixed black): ${phoneInk}`,
  loc('website/app/home.css', firstLine(css, /\.hm-phone-letter\s*\{/)));

const solidHover = /\.hero \.btn-solid:hover\s*\{[^}]*color\s*:\s*var\(--bg\)/.test(heroCssNoCm);
check('D3', solidHover,
  `primary hover ink follows --bg (dark-on-lime in both themes): ${solidHover}`,
  loc('website/app/home.css', firstLine(css, /\.hero \.btn-solid:hover\s*\{/)));

/* =====================================================================
 * RESULT + FOUNDER VERDICT
 * ===================================================================== */
const pass = results.filter((r) => r.ok).length;
console.log('');
console.log('=== RESULT ===');
console.log(`${pass} PASS / ${failed} FAIL  (${results.length} checks)`);
if (failed) console.log('FAILED IDS: ' + results.filter((r) => !r.ok).map((r) => r.id).join(', '));

console.log('');
console.log('=== FOUNDER VERDICT / حكم المؤسس ===');
console.log(failed
  ? 'FAIL — الأزرار ما زالت متزاحمة أو الوضع المنير ما زال أسود / راجع الفحوصات أعلاه.'
  : 'PASS — الأزرار مفصولة وواضحة، والوضع المنير فاتح فعلاً مع الحفاظ على الترس الليموني.');
console.log(failed
  ? 'FAIL — CTAs still cramped or the light theme still renders dark; see checks above.'
  : 'PASS — CTAs are spaced and legible; light theme renders light with the lime gear intact.');
process.exit(failed ? 1 : 0);
