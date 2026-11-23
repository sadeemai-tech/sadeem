#!/usr/bin/env node
// ============================================================
// v11.41 — HERO MOSAIC + SILK REMOVAL SOURCE GUARD
// ------------------------------------------------------------
// Run from the repository root:  node tests-v1141-hero-mosaic.mjs
//
// The founder rejected BOTH the boxed "measurement plate" and the
// "code orbit", then rejected the ribbon under the console. This guard
// reads source only (no browser) and proves:
//   1. the hero is an asymmetric >=5-panel miniature-window MOSAIC,
//   2. the silk/ribbon is gone from markup AND every owned stylesheet,
//   3. reduced-motion / html.reduce-motion / data-art='off' guards cover
//      the hero, and the built-site preview detail survived.
// No file is edited. See docs/HERO-MOSAIC-V1141.md.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const WEB = path.join(ROOT, 'website');
const results = [];
const read = (p) => fs.readFileSync(p, 'utf8');
const lines = (s) => s.split(/\r?\n/);
const findLines = (src, re) => {
  const out = [];
  lines(src).forEach((l, i) => { if (re.test(l)) out.push(i + 1); });
  return out;
};
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
function check(id, ok, detail, loc = '') {
  results.push({ id, status: ok ? 'PASS' : 'FAIL', detail, loc });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${loc ? ` [${loc}]` : ''}: ${detail}`);
}

const PAGE = read(path.join(WEB, 'app/page.tsx'));
const HOME = read(path.join(WEB, 'app/home.css'));
const MOCK = read(path.join(WEB, 'app/app-mock.css'));
const ART = read(path.join(WEB, 'app/art-motion.css'));
const HP = read(path.join(WEB, 'app/hero-panels.css'));
const page = stripComments(PAGE);

// ---------------------------------------------------------------------------
// 1 — the mosaic is mounted, with a bilingual accessible label
// ---------------------------------------------------------------------------
const compStart = PAGE.indexOf('function HeroMosaic()');
const compEnd = PAGE.indexOf('ICON FIDELITY', compStart);
const heroArt = stripComments(PAGE.slice(compStart, compEnd > compStart ? compEnd : undefined));
const cssHeroStart = HOME.indexOf(' * 1 — HERO');
const cssHeroEnd = HOME.indexOf(' * 2 — PRODUCT IN USE', cssHeroStart);
const cssHero = stripComments(HOME.slice(0, cssHeroEnd > cssHeroStart ? cssHeroEnd : undefined));

check('M1', /<HeroMosaic\s*\/>/.test(PAGE)
  && /className="hm-grid" role="img" aria-label=\{alt\}/.test(heroArt)
  && /const alt = tx\(/.test(heroArt),
  'hero mounts <HeroMosaic> as .hm-grid with a bilingual role=img label',
  `website/app/page.tsx:${findLines(PAGE, /<HeroMosaic\s*\/>/)[0] || '?'}`);

// ---------------------------------------------------------------------------
// 2 — SIX miniature windows (>= 5 required), arranged ASYMMETRICALLY
// ---------------------------------------------------------------------------
const panels = (heroArt.match(/className="hm-panel hm-/g) || []).length;
const hooks = ['hm-desktop', 'hm-editor', 'hm-cli', 'hm-terminal', 'hm-mobile', 'hm-schedule'];
const missingHooks = hooks.filter((h) => !heroArt.includes(h));
check('M2', panels >= 5 && missingHooks.length === 0,
  `${panels}/6 miniature .hm-panel windows present${missingHooks.length ? `; missing: ${missingHooks.join(', ')}` : ''}`,
  `website/app/page.tsx:${findLines(PAGE, /className="hm-panel hm-/).join(',')}`);

const placements = hooks.filter((h) => new RegExp(`\\.${h}\\{grid-column:[^}]+grid-row:`).test(cssHero));
check('M3', placements.length >= 5,
  `${placements.length}/6 panels have explicit grid-column + grid-row (asymmetric editorial collage)`,
  `website/app/home.css:${findLines(HOME, /\.hm-(desktop|editor|cli|terminal|mobile|schedule)\{grid-column/).join(',')}`);
check('M4', /\.hm-scene\{[^}]*grid-template-columns:repeat\(12,minmax\(0,1fr\)\)/.test(cssHero),
  'the mosaic uses a 12-column editorial grid, not one big rectangle',
  `website/app/home.css:${findLines(HOME, /\.hm-scene\{/)[0] || '?'}`);

// ---------------------------------------------------------------------------
// 3 — the official gear is the visual anchor; hairlines, no bloom/glow
// ---------------------------------------------------------------------------
const gear = /const LIME = '#9be515'/.test(page) && /const BLACK = '#000000'/.test(page)
  && /<rect x="1" y="1" width="98" height="98" rx="3" fill=\{LIME\}/.test(heroArt)
  && /<g transform="translate\(14 14\) scale\(\.72\)" fill=\{BLACK\}/.test(heroArt)
  && /className="hm-mark"/.test(heroArt);
check('M5', gear,
  'lime square + black gear mark anchors the collage in the official palette',
  `website/app/page.tsx:${findLines(PAGE, /const LIME = /)[0] || '?'}`);

const paint = /radialGradient|linearGradient|box-shadow|filter:|blur\(|feGaussian|hero-bloom|he-svg|he-spin|co-caret/i;
check('M6', !paint.test(heroArt) && !paint.test(cssHero),
  'no gradients, shadows, blur, glow or old orbit/bloom fragments in the hero',
  `website/app/page.tsx:${compStart >= 0 ? findLines(PAGE, /function HeroMosaic/)[0] : '?'} + website/app/home.css:1`);
check('M7', /\.hm-panel\{[^}]*border:1px solid var\(--line\)/.test(cssHero),
  'every panel is a 1px hairline frame on the page',
  `website/app/home.css:${findLines(HOME, /\.hm-panel\{/)[0] || '?'}`);
check('M8', /FIG\. 01 — Six miniature SADEEM surfaces/.test(PAGE)
  && /ست واجهات مصغّرة لسديم/.test(PAGE)
  && !/Code orbit|مدار الشيفرة/.test(PAGE),
  'the caption describes the mosaic; the rejected "code orbit" copy is gone',
  `website/app/page.tsx:${findLines(PAGE, /artCaption:/)[0] || '?'}`);

// ---------------------------------------------------------------------------
// 4 — copy + centred layout: the mosaic is the centrepiece
// ---------------------------------------------------------------------------
/* v11.44 — the old poetry headline ("The agent that grows with you") and the
   "No telemetry" note were replaced with a keyword-bearing descriptor and an
   honest BYOK note. Assert the CURRENT honest copy. */
const copy = ['A local-first AI coding agent', 'that ', 'learns your workspace.',
  'Download for Windows', 'Free during the public season']
  .every((s) => PAGE.includes(s));
check('M9', copy,
  'the local-first AI coding agent headline / CTA / honest note are present',
  `website/app/page.tsx:${findLines(PAGE, /const HERO = /)[0] || '?'}`);
check('M10', /\.hero-copy\{[^}]*text-align:center/.test(cssHero)
  && !/grid-template-columns:1\.08fr \.92fr/.test(cssHero)
  && /\.hero-mosaic\{[^}]*width:100%;max-width:1120px/.test(cssHero),
  'copy is centred and the wide mosaic sits below it as the hero centrepiece',
  `website/app/home.css:${findLines(HOME, /\.hero-copy\{/)[0] || '?'}`);

// ---------------------------------------------------------------------------
// 5 — reduced motion, manual kill switches, RTL, hydration safety
// ---------------------------------------------------------------------------
const rmIdx = HOME.indexOf('@media (prefers-reduced-motion:reduce)');
let rmBlock = '';
if (rmIdx >= 0) {
  let i = HOME.indexOf('{', rmIdx), depth = 0, j = i;
  for (; j < HOME.length; j++) {
    if (HOME[j] === '{') depth++;
    else if (HOME[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  rmBlock = HOME.slice(i, j);
}
check('M11', /\.hero-art-enter/.test(rmBlock) && /\.hm-panel/.test(rmBlock),
  'OS prefers-reduced-motion covers the mosaic reveal and the panels',
  `website/app/home.css:${findLines(HOME, /@media \(prefers-reduced-motion/)[0] || '?'}`);
const manual = HOME.slice(HOME.indexOf('html.reduce-motion :is('));
check('M12', /html\.reduce-motion/.test(manual) && /html\[data-art='off'\]/.test(manual)
  && /\.hero-art-enter/.test(manual) && /\.hm-panel/.test(manual),
  'html.reduce-motion AND html[data-art="off"] guards cover the hero mosaic');
check('M13', /\.hm-scene\{[^}]*direction:ltr/.test(cssHero)
  && /padding-inline:|border-inline-start:/.test(cssHero)
  && /html\[lang='ar'\] :is\(\.hm-head-label/.test(cssHero),
  'RTL-safe: physical LTR for instrument text, logical insets + Arabic type rules');
check('M14', !/Math\.random\s*\(|new Date\s*\(|Date\.now\s*\(/.test(heroArt),
  'mosaic geometry is literal/index-derived — hydration-safe');

// ---------------------------------------------------------------------------
// 6 — the silk/ribbon is gone from markup and EVERY owned stylesheet
// ---------------------------------------------------------------------------
const allOwned = stripComments(PAGE) + '\n' + stripComments(HOME) + '\n'
  + stripComments(MOCK) + '\n' + stripComments(ART);
check('M15', !/appmock-silk|SILK_FAN|AppMockSilk|silk-band|am-silk-glow/i.test(allOwned),
  'no silk/ribbon selector, component, fan data or gradient remains anywhere',
  'website/app/page.tsx + app/{home,app-mock,art-motion}.css');
check('M16', !/silk/i.test(stripComments(PAGE).slice(PAGE.indexOf('1 — HERO'), PAGE.indexOf('2 — PRODUCT IN USE'))),
  'the hero itself carries no silk/light-line language');

// ---------------------------------------------------------------------------
// 7 — the built-site preview detail survived the ribbon removal
// ---------------------------------------------------------------------------
/* v11.43 — the illustrative console section was removed; the same preview
   experience now opens INSIDE the hero Desktop panel (hpx-preview). These
   two guards keep their intent but follow the new markup + beat id. */
check('M17', /className="hpx-preview mono"/.test(PAGE)
  && /hpx-pv-url/.test(PAGE) && /hpx-pv-canvas/.test(PAGE)
  && /hpx-pv-page/.test(PAGE) && /hpx-pv-card/.test(PAGE)
  && /hpx-pv-stamp/.test(PAGE) && /localhost:5173/.test(PAGE)
  && /200 OK/.test(PAGE),
  'desktop preview renders a real mini page + URL bar + verified 200 OK stamp',
  `website/app/page.tsx:${findLines(PAGE, /className="hpx-preview/)[0] || '?'}`);
check('M18', /hb\(16\)/.test(PAGE) && /hpx-pv-h1/.test(PAGE)
  && /\.hpx-pv-stamp\{/.test(HP),
  'preview joins the one cadence beat system (hb(16), one 400ms unit) and has hairline stamp styles',
  `website/app/page.tsx:${findLines(PAGE, /hb\(16\)/)[0] || '?'}`);

// ---------------------------------------------------------------------------
console.log('\n=== RESULT ===');
const fails = results.filter((r) => r.status === 'FAIL').length;
const passes = results.filter((r) => r.status === 'PASS').length;
console.log(`${passes} PASS / ${fails} FAIL — v11.41 hero mosaic`);
process.exit(fails ? 1 : 0);
