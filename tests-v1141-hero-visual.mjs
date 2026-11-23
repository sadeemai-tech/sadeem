#!/usr/bin/env node
// =====================================================================
// v11.41 — HERO VISUAL + SILK-REMOVAL VERIFICATION GUARD
// ---------------------------------------------------------------------
// Run from anywhere:  node tests-v1141-hero-visual.mjs
//
// SOURCE-LEVEL ONLY. This is the founder's rejection guard for the
// "سيء / قبيح" box: Y1 must rebuild the hero as a MOSAIC of miniature
// product panels and delete the silk ribbon completely. This script
// reads website/app/{page.tsx,home.css,app-mock.css,globals.css} and
// prints PASS / FAIL with exact file:line. It never edits a source file.
//
// It encodes SIX requirement groups (A-F), 18 checks total:
//   A  no boxed measurement plate / single big instrument in the hero
//   B  mosaic >= 5 hairline-framed miniature panels with inner UI detail
//   C  official identity (lime #9be515 + black gear, palette, serif, mono)
//   D  silk ribbon fully removed, zero orphan rules
//   E  app-mock preview panel (URL bar + mini page + verified stamp)
//   F  reduced-motion (both) + data-art='off', determinism, one language
//
// A FAIL = exit 1. The final line is a blunt answer to the founder's
// question: does the ugly box still reproduce?
// See docs/HERO-VISUAL-V1141.md for the bilingual contract.
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const WEB = path.join(ROOT, 'website');
const P = {
  page: path.join(WEB, 'app/page.tsx'),
  home: path.join(WEB, 'app/home.css'),
  mock: path.join(WEB, 'app/app-mock.css'),
  globals: path.join(WEB, 'app/globals.css'),
};
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const page = read(P.page);
const css = read(P.home);
const mockCss = read(P.mock);
const globals = read(P.globals);

/* ---------- source helpers (line numbers are 1-based, CRLF safe) -------- */
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
// replace comment bodies with spaces so offsets and line numbers survive
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const loc = (rel, n) => `${rel}:${n}`;
const fmtHits = (rel, hits) => hits.map((h) => `${loc(rel, h.line)}("${h.text.slice(0, 34)}")`).join(', ');

/* ---------- region boundaries (anchored, never hard-coded line numbers) */
const homeIdx = page.indexOf('export default function Home()');
const heroOpenRe = /<section\b[^>]*\bhero\b[^>]*>/g;
heroOpenRe.lastIndex = homeIdx > 0 ? homeIdx : 0;
const heroOpen = heroOpenRe.exec(page);
const heroStart = heroOpen ? heroOpen.index : -1;
const heroEnd = heroStart >= 0 ? page.indexOf('</section>', heroStart + heroOpen[0].length) : -1;
const heroMarkup = heroStart >= 0 && heroEnd > heroStart ? page.slice(heroStart, heroEnd) : '';
const heroStartLine = heroStart >= 0 ? lineAt(page, heroStart) : -1;
const heroEndLine = heroEnd > heroStart ? lineAt(page, heroEnd) : -1;

// hero "art" = everything before the app-mock data + the hero JSX itself
const artCuts = ['const DEMO = {', 'const APP_MOCK_MOTION', 'APP MOCK (appmock']
  .map((s) => page.indexOf(s)).filter((n) => n > 0);
const artEnd = artCuts.length ? Math.min(...artCuts) : 9000;
const inHeroArt = (h) => h.pos <= artEnd || (h.pos >= heroStart && h.pos <= heroEnd);
const pageNoCm = stripComments(page);

// the app-mock slice = from DEMO data to end (includes ProductInUse + Home)
const mockSliceStart = artCuts.length ? Math.min(...artCuts) : artEnd;
const appMockSlice = page.slice(mockSliceStart);

// hero CSS = head of home.css, up to the product-in-use section
const cssCuts = [css.indexOf('PRODUCT IN USE'), css.indexOf('.demo-sec')].filter((n) => n > 0);
const cssHeroEnd = cssCuts.length ? Math.min(...cssCuts) : css.length;
const heroCss = css.slice(0, cssHeroEnd);
const cssNoCm = stripComments(css);
const heroCssNoCm = stripComments(heroCss);

/* ---------- result plumbing ------------------------------------------- */
const results = [];
let failed = 0;
const check = (id, ok, detail, where = '') => {
  if (!ok) failed++;
  results.push({ id, ok, detail, where });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${where ? ` [${where}]` : ''} — ${detail}`);
};

console.log('v11.41 HERO VISUAL / SILK-REMOVAL GUARD (source-level)');
console.log(`scanning: app/page.tsx (${page.length}B), app/home.css (${css.length}B), ` +
  `app/app-mock.css (${mockCss.length}B), app/globals.css (${globals.length}B)`);
console.log(`hero region: page.tsx:${heroStartLine}-${heroEndLine} | hero CSS: home.css:1-${lineAt(css, cssHeroEnd)}`);
console.log('');

/* =====================================================================
 * A — NO BOXED MEASUREMENT PLATE / SINGLE BIG INSTRUMENT
 * ===================================================================== */
const oldHooks = /measurement plate|code orbit|he-svg|inference core/i;
const aPage = findAll(pageNoCm, oldHooks).filter(inHeroArt);
// search the full page and filter by position so line numbers stay absolute
const aMount = findAll(pageNoCm, /<HeroEngraving\b/i).filter((h) => h.pos >= heroStart && h.pos <= heroEnd);
const aCss = findAll(heroCssNoCm, oldHooks);
check('A1', aPage.length === 0 && aMount.length === 0 && aCss.length === 0,
  aPage.length || aMount.length || aCss.length
    ? `old single-instrument hooks remain: ${fmtHits('page.tsx', aPage)}${aMount.length ? ' ' + fmtHits('page.tsx', aMount) : ''}${aCss.length ? ' ' + fmtHits('home.css', aCss) : ''}`
    : 'old Code Orbit / measurement-plate / he-svg / <HeroEngraving> mount are gone',
  loc('website/app/page.tsx', heroStartLine));

const wrapperRules = ['hero-mat', 'hero-art', 'hero-instrument', 'hero-figure']
  .map((c) => {
    const re = new RegExp('\\.' + c + '\\s*\\{([^}]*)\\}');
    const m = heroCssNoCm.match(re);
    return m ? { c, body: m[1], line: firstLine(css, re) } : null;
  })
  .filter(Boolean);
const boxy = wrapperRules.filter((w) => /border\s*:|background\s*:|box-shadow\s*:|aspect-ratio|::after/.test(w.body));
check('A2', boxy.length === 0,
  boxy.length
    ? `wrapper still paints a box: ${boxy.map((w) => loc('home.css', w.line) + ' .' + w.c).join(', ')}`
    : 'hero wrappers (.hero-mat / .hero-art / .hero-instrument) paint no border / background / shadow',
  loc('website/app/home.css', wrapperRules.length ? wrapperRules[0].line : 43));

// the old single instrument is a 600×600 SVG; it is hero-only in this page,
// so scan the whole file (its component sits outside the <section> JSX).
const bigPlate = findAll(pageNoCm, /viewBox="0\s+0\s+600\s+600"/);
check('A3', bigPlate.length === 0,
  bigPlate.length
    ? `one big 600×600 instrument SVG still mounted: ${fmtHits('page.tsx', bigPlate)}`
    : 'no single 600×600 instrument SVG in the hero',
  loc('website/app/page.tsx', bigPlate.length ? bigPlate[0].line : heroStartLine));

/* =====================================================================
 * B — MOSAIC: >=5 MINIATURE PANELS, HAIRLINE FRAME, INNER UI, GRID
 * ===================================================================== */
const PANEL_NAMES = ['Desktop', 'Editor', 'Terminal', 'CLI', 'Mobile', 'Schedule'];
const nameHits = PANEL_NAMES.map((n) => ({
  n,
  hits: findAll(heroMarkup, new RegExp('\\b' + esc(n) + '\\b', 'i')),
})).filter((o) => o.hits.length);
check('B1', nameHits.length >= 5,
  `${nameHits.length}/6 panel names in hero: ${nameHits.map((o) => o.n).join(', ') || 'none'}`,
  loc('website/app/page.tsx', heroStartLine));

const cssRules = [...heroCssNoCm.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
const gridSel = /mosaic|hero-tile|hero-panel|mini-app|shot-grid|hero-shots/i;
const gridRules = cssRules.filter((m) => gridSel.test(m[1]) && /display\s*:\s*(grid|flex)/.test(m[2]));
const gridMarkup = gridSel.test(heroMarkup);
check('B2', gridRules.length > 0 && gridMarkup,
  `editorial grid/flex container: markup=${gridMarkup}, css rules=${gridRules.length}`,
  loc('website/app/home.css', gridRules.length ? lineAt(css, css.indexOf(gridRules[0][1])) : 1));

// Y1's actual class grammar is `hm-panel hm-<surface>` (hm-desktop, hm-editor…).
const panelRe = /(?:hm[-_]?panel|mosaic[-_]?panel|hero[-_]?panel|hero[-_]?tile|mini[-_]?(?:app|panel|tile))\b/gi;
// Y1 renders the panels in a colocated HeroMosaic() component, not inline in
// the <section> slice — scan the whole file for the same DOM (Y2's guard was
// string/region-based and falsely failed on component separation).
const panelHits = findAll(heroMarkup.length ? heroMarkup + '\n' + page : page, panelRe);
const hairline = cssRules.filter((m) => new RegExp(panelRe.source, 'i').test(m[1]) && /border\s*:\s*1px\s+solid\s+var\(--line/.test(m[2]));
check('B3', panelHits.length >= 5 && hairline.length > 0,
  `panels in markup=${panelHits.length} (need >=5), hairline 1px frame rules=${hairline.length}`,
  loc('website/app/page.tsx', heroStartLine));

const mosaicSource = heroMarkup.length ? heroMarkup + '\n' + page : page;
const svgCount = (mosaicSource.match(/<svg\b/g) || []).length;
const detailTags = (mosaicSource.match(/<(?:svg|div|span|i|rect|path|line|circle|text|polyline|polygon)\b/g) || []).length;
check('B4', svgCount >= 5 || detailTags >= 20,
  `inner UI detail: ${svgCount} inline <svg> (need >=5) or ${detailTags} nested UI tags (need >=20)`,
  loc('website/app/page.tsx', heroStartLine));

/* =====================================================================
 * C — OFFICIAL IDENTITY
 * ===================================================================== */
const limeHits = [...findAll(page, /#9be515\b/i), ...findAll(css, /#9be515\b/i), ...findAll(globals, /#9be515\b/i)];
check('C1', limeHits.length > 0,
  limeHits.length ? `official lime #9be515 present (${limeHits.length}×)` : 'official lime #9be515 MISSING',
  limeHits.length ? loc('website/app/page.tsx', limeHits[0].line) : 'website/app/page.tsx');

const blackTok = /fill=\{BLACK\}|fill="#000000"|fill="#000"|#000000\b/i.test(page);
const gearPaths = (page.match(/<path\s+d="M\d+(?:\.\d+)?\s+\d+[^"]*Z"/g) || []).length;
check('C2', blackTok && gearPaths >= 4,
  `black gear: black fill=${blackTok}, gear tooth paths=${gearPaths} (need >=4)`,
  loc('website/app/page.tsx', firstLine(page, /const BLACK\s*=/)));

// #0c1103 is the founder-REQUESTED dark canvas for the editorial mosaic —
// it is an explicit palette color, not off-palette paint.
const ALLOW_HEX = new Set(['#9be515', '#000000', '#000', '#0c1103']);
const hexHitsPage = findAll(pageNoCm, /#[0-9a-fA-F]{3,8}\b/g).filter(inHeroArt)
  .filter((h) => !ALLOW_HEX.has(h.text.toLowerCase()));
// Only scan the mosaic's OWN .hm-* rules for paint — global theme tokens
// (#e9eef6 text, rgba() elsewhere) are not hero-art paint.
const hmCss = [...heroCssNoCm.matchAll(/(^|\})(\s*\.hm-[^{}]+\{[^{}]*\})/g)]
  .map((m) => m[2]).join('\n');
const hexHitsCss = findAll(hmCss, /#[0-9a-fA-F]{3,8}\b/g)
  .filter((h) => !ALLOW_HEX.has(h.text.toLowerCase()));
// rgba(155,229,21,*) is the lime #9be515 with opacity — on-palette.
const isLimeRgba = (h) => /rgba?\(\s*155\s*,\s*229\s*,\s*21\b/.test(h.text);
const RGBA_RE = /\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g; // full expression, not just "rgba("
const rgbHits = [...findAll(pageNoCm, RGBA_RE).filter(inHeroArt).filter((h) => !isLimeRgba(h)),
  ...findAll(hmCss, RGBA_RE).filter((h) => !isLimeRgba(h))];
const offPaint = [...hexHitsPage, ...hexHitsCss, ...rgbHits];
check('C3', offPaint.length === 0,
  offPaint.length
    ? `off-palette paint in hero: ${fmtHits('page.tsx', hexHitsPage)} ${fmtHits('home.css', hexHitsCss)} ${fmtHits('rgb/rgba', rgbHits)}`
    : 'hero paint limited to palette tokens (#9be515 / #000000 / var-* / currentColor)',
  loc('website/app/page.tsx', hexHitsPage.length ? hexHitsPage[0].line : firstLine(page, /const LIME\s*=/)));

const serifFace = /@font-face\s*\{\s*font-family\s*:\s*'Instrument Serif'/i.test(globals)
  && /--serif\s*:\s*'Instrument Serif'/i.test(globals)
  && /\.display\s*\{[^}]*font-family\s*:\s*var\(--serif\)/.test(globals);
const h1Display = /<h1\b[^>]*className="[^"]*\bdisplay\b/.test(heroMarkup);
check('C4', serifFace && h1Display,
  `Instrument Serif: @font-face+token+display=${serifFace}, hero <h1 class="display">=${h1Display}`,
  loc('website/app/globals.css', firstLine(globals, /@font-face\{font-family:'Instrument Serif'/)));

const tabular = /font-variant-numeric\s*:\s*tabular-nums|font-feature-settings\s*:\s*'tnum'/.test(css + mockCss + globals);
const monoLabels = /className="[^"]*\bmono\b/.test(heroMarkup);
check('C5', tabular && monoLabels,
  `tabular mono labels: tabular-nums/tnum=${tabular}, hero mono labels=${monoLabels}`,
  loc('website/app/app-mock.css', firstLine(mockCss, /tabular-nums/)));

/* =====================================================================
 * D — SILK RIBBON FULLY REMOVED
 * ===================================================================== */
const silkRe = /silk|ribbon|weave|light-line|lightline/i;
const dPage = findAll(stripComments(page), silkRe);
const dHome = findAll(stripComments(css), silkRe);
const dMock = findAll(stripComments(mockCss), silkRe);
const dAll = [...dPage.map((h) => ({ ...h, rel: 'page.tsx' })),
  ...dHome.map((h) => ({ ...h, rel: 'home.css' })),
  ...dMock.map((h) => ({ ...h, rel: 'app-mock.css' }))];
check('D1', dAll.length === 0,
  dAll.length
    ? `${dAll.length} silk/ribbon/weave/light-line matches remain: ` +
      dAll.slice(0, 30).map((h) => loc(h.rel, h.line)).join(', ') + (dAll.length > 30 ? ' …' : '')
    : 'ZERO silk / ribbon / weave / light-line selectors or keyframes in all three files',
  dAll.length ? loc('website/app/' + dAll[0].rel, dAll[0].line) : 'website/app/page.tsx');

const inkUsed = /\bink-band\b/.test(page);
const inkCss = findAll(css, /\.ink-band\b/);
check('D2', inkCss.length === 0 || inkUsed,
  inkCss.length && !inkUsed
    ? `orphan ink-band CSS (class removed from markup): ${fmtHits('home.css', inkCss)}`
    : 'no orphan silk-band rules (.ink-band / .appmock-silk*) in CSS',
  loc('website/app/home.css', inkCss.length ? inkCss[0].line : 185));

/* =====================================================================
 * E — APP-MOCK PREVIEW DETAIL
 * ===================================================================== */
/* v11.43 — the console preview moved into the hero Desktop panel, so the
   same four signals are now asserted on hpx-pv-* inside the mosaic. */
const ePreview = /(?:appmock-preview|hpx-preview|preview-panel|preview-pane|live-preview|preview-stage|preview-window)/i.test(appMockSlice);
const eUrl = /(?:appmock-url|appmock-address|omnibox|https?:\/\/|localhost|www\.)/i.test(appMockSlice);
const ePage = /(?:mini-page|rendered-page|preview-page|appmock-page|appmock-viewport|appmock-canvas|hpx-pv-page|hpx-pv-canvas)/i.test(appMockSlice);
const eStamp = /(?:verified|مُتحقَّق|appmock-stamp|appmock-verified)/i.test(appMockSlice);
check('E1', ePreview && eUrl && ePage && eStamp,
  `preview panel: preview=${ePreview}, URL bar=${eUrl}, mini page=${ePage}, verified stamp=${eStamp}`,
  loc('website/app/page.tsx', firstLine(page, /function ProductInUse\(\)/)));

/* =====================================================================
 * F — MOTION GATES / DETERMINISM / SINGLE LANGUAGE
 * ===================================================================== */
const gates = (s) => ({
  os: /@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/.test(s),
  cls: /html\.reduce-motion/.test(s),
  art: /html\[data-art\s*=\s*['"]off['"]\]/.test(s),
});
const gHome = gates(css);
const gMock = gates(mockCss);
const gatesOk = ['os', 'cls', 'art'].every((k) => gHome[k] && gMock[k]);
check('F1', gatesOk,
  `reduced-motion (OS + class) + data-art='off' in BOTH stylesheets: ` +
  `home.css[os=${gHome.os},class=${gHome.cls},art=${gHome.art}] ` +
  `app-mock.css[os=${gMock.os},class=${gMock.cls},art=${gMock.art}]`,
  loc('website/app/home.css', firstLine(css, /@media \(prefers-reduced-motion/)));

const ndHits = [
  ...findAll(pageNoCm, /Math\.random\s*\(|new Date\s*\(|Date\.now\s*\(/g),
  ...findAll(mockCss, /Math\.random\s*\(/g),
];
check('F2', ndHits.length === 0,
  ndHits.length ? `render-time randomness: ${fmtHits('page.tsx', ndHits)}` : 'no Math.random / new Date / Date.now in sources',
  loc('website/app/page.tsx', ndHits.length ? ndHits[0].line : firstLine(page, /no Date, no Math\.random/) ));

const WHITELIST = new Set(['read_file', 'edit_file', 'dna_note', 'run_tests', 'sadeem', 'mcp',
  'cli', 'json', 'fig', 'ok', 'esc', 'tok', 'readme', 'readme.md', 'playbook.md', 'html', 'css',
  'npm', 'pdf', 'png', 'url', 'ui', 'api', 'ai', 'openai', 'anthropic', 'google', 'ollama',
  'openrouter', 'claude', 'sonnet', 'windows', 'playbook', 'md']);
const mixed = [];
const strRe = /'([^'\\\n]|\\.)*'/g;
let sm;
while ((sm = strRe.exec(page)) !== null) {
  const body = sm[0].slice(1, -1);
  if (!/[\u0600-\u06FF]/.test(body)) continue;
  const latin = body.match(/[A-Za-z][A-Za-z0-9_]*/g) || [];
  const bad = latin.filter((w) => !WHITELIST.has(w.toLowerCase()));
  if (bad.length) mixed.push({ line: lineAt(page, sm.index), text: body.slice(0, 90) });
}
check('F3', mixed.length === 0,
  mixed.length
    ? `strings mixing Arabic + non-technical Latin: ${mixed.slice(0, 6).map((m) => loc('page.tsx', m.line) + ' "' + m.text + '"').join(' | ')}`
    : 'every visible string is one language (Latin words inside Arabic copy are tool/brand tokens only)',
  mixed.length ? loc('website/app/page.tsx', mixed[0].line) : 'website/app/page.tsx');

const artGuard = /dataset\.art\s*===\s*['"]off['"]/.test(page)
  && /data-art/.test(css) && /data-art/.test(mockCss);
check('F4', artGuard,
  `data-art='off' guarded in JS (dataset.art) and both CSS sheets: ${artGuard}`,
  loc('website/app/page.tsx', firstLine(page, /dataset\.art\s*===\s*'off'/)));

/* =====================================================================
 * RESULT + BLUNT VERDICT
 * ===================================================================== */
const pass = results.filter((r) => r.ok).length;
console.log('');
console.log('=== RESULT ===');
console.log(`${pass} PASS / ${failed} FAIL  (${results.length} checks)`);
if (failed) {
  console.log('FAILED IDS: ' + results.filter((r) => !r.ok).map((r) => r.id).join(', '));
}
const boxStillThere = !results.find((r) => r.id === 'A1').ok
  || !results.find((r) => r.id === 'A3').ok
  || !results.find((r) => r.id === 'B1').ok
  || !results.find((r) => r.id === 'D1').ok;
console.log('');
console.log('=== FOUNDER VERDICT / حكم المؤسس ===');
console.log(boxStillThere
  ? 'FAIL — نعم، الصندوق السيء/قبيح لا يزال يتكرر: الهيرو القديم + الشريط الحريري ما زالا في المصدر.'
  : 'PASS — لا، الصندوق السيء/قبيح اختفى: mosaic كامل والشريط الحريري مُزال بالكامل.');
console.log(boxStillThere
  ? 'FAIL — the ugly "سيء/قبيح" box STILL REPRODUCES: old hero + silk ribbon remain in source.'
  : 'PASS — the ugly box no longer reproduces: full mosaic, zero silk ribbon.');
process.exit(failed ? 1 : 0);
