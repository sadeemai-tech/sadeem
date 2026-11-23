#!/usr/bin/env node
// ============================================================
// v11.40 — HERO ART + MARKETING HONESTY GUARD
// ------------------------------------------------------------
// Run from anywhere:  node tests-v1140-hero-honesty.mjs
//
// HARD checks (FAIL = exit 1) cover ONLY the files owned by this
// workstream: the hero of website/app/page.tsx, its styles in
// website/app/home.css, and the tagline/SEO text in website/lib/site.ts.
//
// ADVISORY checks (WARN = exit 0) scan other marketing surfaces for the
// founder's "first / the only local AI agent" class of lie and print exact
// file:line so the owning agent can fix them. This guard never edits files.
//
// Source-level only: it cannot see pixels. See docs/HERO-HONESTY-V1140.md.
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
function check(id, ok, detail, loc = '') {
  results.push({ id, status: ok ? 'PASS' : 'FAIL', detail, loc });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${loc ? ` [${loc}]` : ''}: ${detail}`);
}
function warn(id, detail, loc = '') {
  results.push({ id, status: 'WARN', detail, loc });
  console.log(`WARN ${id}${loc ? ` [${loc}]` : ''}: ${detail}`);
}

const PAGE_PATH = path.join(WEB, 'app/page.tsx');
const CSS_PATH = path.join(WEB, 'app/home.css');
const SITE_PATH = path.join(WEB, 'lib/site.ts');
const page = read(PAGE_PATH);
const css = read(CSS_PATH);
const site = read(SITE_PATH);

// the hero illustration = data block + component, bounded by stable anchors.
// Anchors are line-ending agnostic (this checkout uses CRLF).
const heroStart = page.indexOf('const LIME =');
const heroDataEnd = page.indexOf('const DEMO = {');
const heroCompStart = page.indexOf('function HeroMosaic()');
/* v11.44 — the old "ProductInUse — a faithful" end marker was removed with
   the console section (v11.43). The mosaic function now ends at the ICON
   FIDELITY comment; target that marker so the hero slice is not empty. */
const iconFidelity = page.indexOf('ICON FIDELITY');
const heroEnd = iconFidelity >= 0 ? page.lastIndexOf('/*', iconFidelity) : -1;
const heroData = page.slice(heroStart, heroDataEnd > heroStart ? heroDataEnd : heroCompStart);
const heroComp = heroCompStart >= 0 && heroEnd > heroCompStart ? page.slice(heroCompStart, heroEnd) : '';
const hero = heroData + '\n' + heroComp;
const cssProduct = css.indexOf('2 — PRODUCT IN USE');
const cssEnd = cssProduct >= 0 ? css.lastIndexOf('/*', cssProduct) : -1;
const cssHero = cssEnd > 0 ? css.slice(0, cssEnd) : css;

// ---------------------------------------------------------------------------
// HARD 1 — v11.41: the plate AND the orbit are gone; the MOSAIC is mounted
// ---------------------------------------------------------------------------
const mounted = /<HeroMosaic\s*\/>/.test(page) && /className="hm-grid"/.test(hero);
const panels = (hero.match(/className="hm-panel hm-/g) || []).length;
const gear = /<rect x="1" y="1" width="98" height="98" rx="3" fill=\{LIME\}/.test(hero)
  && /scale\(\.72\)" fill=\{BLACK\}/.test(hero)
  && /const LIME = '#9be515'/.test(hero)
  && /const BLACK = '#000000'/.test(hero);
check('H1', mounted && panels >= 5 && gear,
  `hero mounts <HeroMosaic> as a ${panels}-panel mosaic with the official lime square + black gear anchor`,
  `website/app/page.tsx:${findLines(page, /<HeroMosaic\s*\/>/)[0] || '?'}`);

const oldArt = ['NEURAL CORE', 'measurement plate', 'feTurbulence', 'he-grain', '#1b2217', 'RULER.map', 'TRACES.map'];
const stale = oldArt.filter((s) => hero.includes(s));
check('H2', stale.length === 0,
  stale.length ? `old boxed engraving fragments remain: ${stale.join(', ')}` : 'no measurement plate / charcoal mat / grain-filter fragments remain',
  `website/app/page.tsx:${findLines(page, /const LIME = /)[0] || '?'}`);

const matRule = (cssHero.match(/\.hero-mat\{[^}]*\}/) || [''])[0];
const boxyCss = /border|background|box-shadow|aspect-ratio|padding|::after/.test(matRule);
check('H3', !boxyCss && /\.hero-mat\{position:relative;width:100%\}/.test(cssHero),
  boxyCss ? `.hero-mat still paints a box: ${matRule}` : '.hero-mat is a plain positioning wrapper (no border/background/inset shadow)',
  `website/app/home.css:${findLines(css, /\.hero-mat\{/)[0] || '?'}`);

// ---------------------------------------------------------------------------
// HARD 2 — palette discipline: only the official lime + black in the artwork
// ---------------------------------------------------------------------------
const hexes = [...new Set((hero.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((h) => h.toLowerCase()))];
const offPalette = hexes.filter((h) => h !== '#9be515' && h !== '#000000');
check('H4', offPalette.length === 0,
  offPalette.length ? `off-palette hex paint in hero art: ${offPalette.join(', ')}` : `palette clean — only ${hexes.join(' + ')}`,
  `website/app/page.tsx:${findLines(page, /const LIME = /)[0] || '?'}`);

// v11.41 — the hero is now an explicit near-black band. Its ONLY paint is
// the official lime plus the near-black canvas/ink ramp; no other hex.
const cssHexes = [...new Set((cssHero.match(/#[0-9a-fA-F]{6}\b/g) || []).map((h) => h.toLowerCase()))];
const allowedCanvas = ['#9be515', '#0c1103', '#0e1405', '#000000', '#e9eef6', '#aab79a', '#75835f'];
const cssOff = cssHexes.filter((h) => !allowedCanvas.includes(h));
check('H5', cssOff.length === 0,
  cssOff.length ? `off-palette hex in hero CSS: ${cssOff.join(', ')}` : `hero CSS paint is limited to lime + the near-black canvas ramp (${cssHexes.join(' ')})`,
  `website/app/home.css:${findLines(css, /\.hero\{/)[0] || '?'}`);

// ---------------------------------------------------------------------------
// HARD 3 — reduced motion / manual kill switches / RTL / hydration
// ---------------------------------------------------------------------------
const MOTION = ['hero-art-enter', 'hm-panel'];
// kill switches live AFTER the hero block, so scan the full stylesheet here
const rmIdx = css.indexOf('@media (prefers-reduced-motion:reduce)');
let rmBlock = '';
if (rmIdx >= 0) {
  let i = css.indexOf('{', rmIdx), depth = 0, j = i;
  for (; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  rmBlock = css.slice(i, j);
}
// the manual guards span several lines (the :is() list wraps), so slice the
// whole kill-switch section instead of filtering individual lines.
const manualStart = css.indexOf('html.reduce-motion :is(');
const appMockMark = css.indexOf('6 — APP MOCK', manualStart);
const manualEnd = appMockMark >= 0 ? css.lastIndexOf('/*', appMockMark) : css.length;
const manual = manualStart >= 0 ? css.slice(manualStart, manualEnd) : '';
const uncovered = MOTION.filter((c) => !rmBlock.includes(`.${c}`) || !manual.includes(`.${c}`));
check('H6', rmIdx >= 0 && uncovered.length === 0,
  uncovered.length ? `hero animation classes missing from a kill switch: ${uncovered.join(', ')}` : `${MOTION.length}/${MOTION.length} hero animation classes covered by OS + manual kill switches`,
  `website/app/home.css:${findLines(css, /@media \(prefers-reduced-motion/)[0] || '?'}`);

const rtlHooks = (hero.match(/\bdir="ltr"/g) || []).length;
check('H7', rtlHooks >= 3 && !/direction="ltr"/.test(hero),
  `${rtlHooks} dir="ltr" hooks on instrument text; no invalid SVG direction prop`,
  `website/app/page.tsx:${findLines(page, /\bdir="ltr"/).slice(0, 3).join(',')}`);

const nondeterministic = findLines(hero, /Math\.random\s*\(|new Date\s*\(|Date\.now\s*\(/);
check('H8', nondeterministic.length === 0,
  nondeterministic.length ? `render-time randomness at hero lines ${nondeterministic.join(',')}` : 'hero geometry is index-derived — hydration-safe',
  'website/app/page.tsx:hero');

// ---------------------------------------------------------------------------
// HARD 4 — honesty in the owned files
// ---------------------------------------------------------------------------
const ownedHonest = /tagline:\s*'A local-first coding agent that learns with you\.'/.test(site)
  && !/tagline:\s*'The\s/.test(site);
check('H9', ownedHonest,
  ownedHonest ? 'site.ts tagline says "A local-first coding agent", not "The ..."' : 'tagline still asserts uniqueness',
  `website/lib/site.ts:${findLines(site, /tagline:/)[0] || '?'}`);

const banned = /first local ai agent|world'?s first|the first (?:local |ai )?agent|أول وكيل (?:محلي|ذكاء)|unbeatable|unlimited forever|لا يُقهر|الأول عالمياً/i;
const ownedHits = [...findLines(site, banned).map((n) => `site.ts:${n}`), ...findLines(hero, banned).map((n) => `page.tsx(hero+${n})`)];
check('H10', ownedHits.length === 0,
  ownedHits.length ? `superiority claims remain: ${ownedHits.join(', ')}` : 'no superiority/first/unbeatable claims in owned hero + site copy',
  'website/app/page.tsx + website/lib/site.ts');

const freeSeason = /Free during the public season/.test(page) && /Free during the public season/.test(site);
check('H11', freeSeason,
  freeSeason ? '"Free during the public season" preserved verbatim in hero and SEO description' : '"Free during the public season" was lost',
  `website/lib/site.ts:${findLines(site, /Free during the public season/)[0] || '?'}`);

const figcap = /FIG\. 01 — Six miniature SADEEM surfaces/.test(page)
  && /ست واجهات مصغّرة لسديم/.test(page) && !/Code orbit|inference core/i.test(page);
check('H12', figcap,
  figcap ? 'art caption honestly describes the six-surface mosaic' : 'art caption still describes the rejected art',
  `website/app/page.tsx:${findLines(page, /artCaption:/)[0] || '?'}`);

// H1 (auditor X6, updated v11.40 value-first): the claim must MATCH the app.
// The founder chose "open the app first, account optional" — App.tsx no longer
// hard-blocks on AuthGate (it opens from an optional account button). So the
// website truthfully says you can start free and sign in only to sync/license.
// A claim is FALSE only if it says "no account required" while the app blocks.
const startLines = findLines(page, /no account required|حساب إجباري|must sign in/i);
const honestOptional = /Start free without an account/.test(page)
  && /sign in only when you want to sync/.test(page)
  && /ابدأ مجاناً بلا حساب/.test(page);
check('H13', startLines.length === 0 && honestOptional,
  startLines.length ? `false "required" claim contradicts value-first app at page.tsx:${startLines.join(',')}`
    : 'pillar 01 matches the value-first app: start free, sign in optional for sync/license',
  `website/app/page.tsx:${findLines(page, /Start free without an account/)[0] || '?'}`);

// H2 (auditor X6): subagent count is 16 (electron/agent/agents.ts), and MCP
// servers are user-configured (mcp.ts reads settings.mcpServers) — no fixed count.
const featuresDesc = (site.match(/features:\s*\{[\s\S]*?description:\s*'([^']+)'/) || [])[1] || '';
const countLies = /20\+\s*MCP|\b12 subagents\b|12 وكيل/i.test(featuresDesc);
/* v11.44 — site.ts now says "MCP servers" (user-configured is stated on the
   features page and in the FAQ). Accept the honest current phrasing too. */
const countsHonest = /16 specialist agents/.test(featuresDesc)
  && /(?:optional user-configured )?MCP servers/.test(featuresDesc);
check('H14', !countLies && countsHonest,
  countLies ? `features SEO description still asserts unverifiable counts: ${featuresDesc.slice(0, 120)}`
    : 'features SEO description says 16 specialist agents + optional user-configured MCP servers',
  `website/lib/site.ts:${findLines(site, /16 specialist agents/)[0] || '?'}`);

// ---------------------------------------------------------------------------
// ADVISORY — the founder's lie hunt outside this workstream's ownership
// ---------------------------------------------------------------------------
const OUT_OF_SCOPE = [
  'website/components/home/SEOContent.tsx',
  'website/components/download/DownloadPage.tsx',
  'website/components/chrome.tsx',
  'website/app/features/page.tsx',
  'website/docs/RESEARCH.md',
  'website/app/layout.tsx',
  'src/i18n.ts',
  'README-v7.1.0.md',
];
const ADVISORY = [
  [/The local-first|The local AI coding agent/i, 'definite article implies "the one / the first local AI agent" — use "A local-first coding agent"'],
  [/first local ai agent|world'?s first|the first (?:local |ai )?agent/i, 'explicit first-of-its-kind claim'],
  [/Upgrade for team features|دعم الأولوي/i, 'offers a paid tier/support that does not exist in this release'],
  [/20\+\s*(?:install-ready\s*)?MCP|20\+ servers|12 subagents|12 وكيل/i, 'unverifiable/false count — 16 agents; MCP servers are user-configured'],
  [/unbeatable|unlimited forever|لا يُقهر/i, 'absolute superiority claim'],
  [/أول وكيل لا تحتاج أن تثق به/i, 'historical "first agent" marketing headline'],
];
let advisories = 0;
for (const rel of OUT_OF_SCOPE) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  lines(read(abs)).forEach((line, i) => {
    for (const [re, why] of ADVISORY) {
      if (!re.test(line)) continue;
      advisories++;
      warn('OOS', `${why} :: ${line.trim().slice(0, 150)} — OUT OF OWNERSHIP, assign to owning agent`);
      console.log(`        @ ${rel}:${i + 1}`);
      break;
    }
  });
}
if (!advisories) console.log('INFO OOS no superiority claims detected on other marketing surfaces');

// ---------------------------------------------------------------------------
console.log('\n=== RESULT ===');
const fails = results.filter((r) => r.status === 'FAIL').length;
const warns = results.filter((r) => r.status === 'WARN').length;
const passes = results.filter((r) => r.status === 'PASS').length;
console.log(`${passes} PASS / ${fails} FAIL / ${warns} WARN`);
process.exit(fails ? 1 : 0);
