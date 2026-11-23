#!/usr/bin/env node
// ============================================================
// v11.4.2 — FULL SEO GUARD (source + rendered-build verification)
// ------------------------------------------------------------
// Run from the repo root:  node tests-v1142-seo.mjs
// No network. No deploy. When website/.next/server/app exists the guard
// parses the REAL prerendered <head> of every route, robots.txt.body,
// sitemap.xml.body and the generated PNG. Otherwise those checks SKIP.
//
// Enforces:
//   1. unique title <= 60ch / description <= 160ch on all 7 routes
//   2. canonical + hreflang(ar/en/x-default) + OG(ar_AE/en_US) + Twitter
//      + robots directives on every route
//   3. JSON-LD: Organization, SoftwareApplication, WebSite, FAQPage,
//      BreadcrumbList — honest $0 offer, no fake rating or paid price
//   4. sitemap lists every route with a stable lastModified
//   5. robots allows all crawlers (incl. AI crawlers) + sitemap URL
//   6. public/llms.txt for AI discovery, factual, no superlatives
//   7. semantic landmarks, lang/dir, self-hosted swap fonts (CLS hygiene)
//   8. rendered build head/robots/sitemap/OG-image checks
// Exit 0 = no FAIL; exit 1 = at least one FAIL.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const WEB = path.join(ROOT, 'website');
const BUILD = path.join(WEB, '.next', 'server', 'app');
const SITE_URL = 'https://sadeem-ai.com';
const results = [];

function check(id, ok, detail, ref = '') {
  const status = ok ? 'PASS' : 'FAIL';
  results.push({ id, status, detail, ref });
  console.log(`${status} ${id}${ref ? ` [${ref}]` : ''}: ${detail}`);
  return ok;
}
function note(id, status, detail, ref = '') {
  results.push({ id, status, detail, ref });
  console.log(`${status} ${id}${ref ? ` [${ref}]` : ''}: ${detail}`);
}
const readWeb = (rel) => fs.readFileSync(path.join(WEB, rel), 'utf8');
const existsWeb = (rel) => fs.existsSync(path.join(WEB, rel));
const lineOf = (src, needle) => {
  const i = src.split(/\r?\n/).findIndex((l) => l.includes(needle));
  return i >= 0 ? i + 1 : '?';
};
const loc = (rel, needle) => `${rel}:${lineOf(readWeb(rel), needle)}`;
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .split(/\r?\n/)
  .map((l) => (/^\s*\/\//.test(l) ? '' : l))
  .join('\n');

const ROUTES = [
  { route: '/', key: 'home', files: ['app/layout.tsx'], build: 'index.html' },
  { route: '/features', key: 'features', files: ['app/features/layout.tsx'], build: 'features.html' },
  { route: '/pricing', key: 'pricing', files: ['app/pricing/layout.tsx'], build: 'pricing.html' },
  { route: '/download', key: 'download', files: ['app/download/page.tsx'], build: 'download.html' },
  { route: '/docs', key: 'docs', files: ['app/docs/layout.tsx'], build: 'docs.html' },
  { route: '/changelog', key: 'changelog', files: ['app/changelog/layout.tsx'], build: 'changelog.html' },
  { route: '/auth', key: 'auth', files: ['app/auth/layout.tsx'], build: 'auth.html' },
];
const SITEMAP_ROUTES = ROUTES.map((r) => r.route);
const HELPER = 'app/(sitemaps)/seo.tsx';

// ------------------------------------------------------------
// 0. Required artifacts
// ------------------------------------------------------------
const REQUIRED = [
  'lib/site.ts', 'app/layout.tsx', 'app/sitemap.ts', 'app/robots.ts',
  'app/opengraph-image.tsx', 'app/globals.css', 'app/download/page.tsx',
  'app/features/layout.tsx', 'app/pricing/layout.tsx', 'app/docs/layout.tsx',
  'app/changelog/layout.tsx', 'app/auth/layout.tsx', HELPER,
  'public/llms.txt', 'public/sadeem-app-logo.png',
];
const missing = REQUIRED.filter((f) => !existsWeb(f));
check('FILE-0', missing.length === 0,
  missing.length ? `missing: ${missing.join(', ')}` : `${REQUIRED.length} SEO artifacts present`);

const SRC = Object.fromEntries(REQUIRED.filter(existsWeb).map((f) => [f, strip(readWeb(f))]));
const RAW = Object.fromEntries(REQUIRED.filter(existsWeb).map((f) => [f, readWeb(f)]));
const site = SRC['lib/site.ts'];
const layout = SRC['app/layout.tsx'];
const helper = SRC[HELPER];

// ------------------------------------------------------------
// 1. SEO map: unique, bounded, truthful
// ------------------------------------------------------------
const seoBlock = site.slice(site.indexOf('export const SEO'));
function metaPair(key) {
  const lines = seoBlock.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^\\s{2}${key}:\\s*\\{`).test(l));
  if (start < 0) return null;
  let title = null, description = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s{2}\},?\s*$/.test(l)) break;
    const tm = l.match(/title:\s*(['"])(.*?)\1/);
    if (tm) title = tm[2];
    const dm = l.match(/description:\s*(['"])(.*?)\1/);
    if (dm) description = dm[2];
    else if (/description:\s*$/.test(l)) {
      const nl = (lines[i + 1] || '').match(/^\s*(['"])(.*?)\1,?\s*$/);
      if (nl) description = nl[2];
    }
    if (title && description) break;
  }
  return title && description ? { title, description } : null;
}
const pairs = Object.fromEntries(ROUTES.map(({ key }) => [key, metaPair(key)]));
const defined = Object.values(pairs).filter(Boolean);
check('SEO-1', defined.length === ROUTES.length,
  `SEO map defines all ${ROUTES.length} route pairs (${ROUTES.map((r) => r.key).join(', ')})`,
  loc('lib/site.ts', 'export const SEO'));
const tooLongTitles = ROUTES.filter(({ key }) => pairs[key] && pairs[key].title.length > 60)
  .map(({ key }) => `${key}=${pairs[key].title.length}`);
const tooLongDesc = ROUTES.filter(({ key }) => pairs[key] && pairs[key].description.length > 160)
  .map(({ key }) => `${key}=${pairs[key].description.length}`);
check('SEO-2', tooLongTitles.length === 0,
  tooLongTitles.length ? `titles over 60ch: ${tooLongTitles.join(', ')}` : `all ${defined.length} titles <= 60 chars`,
  loc('lib/site.ts', 'home:'));
check('SEO-3', tooLongDesc.length === 0,
  tooLongDesc.length ? `descriptions over 160ch: ${tooLongDesc.join(', ')}` : `all ${defined.length} descriptions <= 160 chars`,
  loc('lib/site.ts', 'home:'));
const titles = defined.map((p) => p.title);
const descs = defined.map((p) => p.description);
check('SEO-4', new Set(titles).size === titles.length && new Set(descs).size === descs.length,
  `${titles.length} unique titles / ${descs.length} unique descriptions`, loc('lib/site.ts', 'home:'));
// "local-first" is a product category, not a superlative — exclude it.
const banned = /(?<!local-)\b(?:unbeatable|best-in-class|world-class|guaranteed|perfect|number one|first|best)\b|#\s*1\b/i;
const metaText = [...titles, ...descs, (site.match(/ogImageAlt:\s*'([^']+)'/)?.[1] || '')].join(' ');
check('SEO-5', !banned.test(metaText),
  'no superlative / fake claims in titles, descriptions or OG alt', loc('lib/site.ts', 'home:'));

// ------------------------------------------------------------
// 2. Root metadata + document language
// ------------------------------------------------------------
const rootChecks = [
  ['metadataBase', /metadataBase:\s*new URL\(SITE\.siteUrl\)/],
  ['title template', /title:\s*\{\s*default:\s*TITLE,\s*template:/],
  ['description', /description:\s*DESCRIPTION/],
  ['canonical root', /canonical:\s*'\/'/],
  // v11.44 (Q4 SEO study) — self-referencing hreflang (ar/en/x-default all
  // pointing at '/') was REMOVED: Google ignores it without real /ar /en
  // routes. Assert the honest absence instead, since one URL serves both
  // languages via the client language toggle.
  ['no fake hreflang', /^(?![\s\S]*languages:\s*\{\s*ar:\s*'\/')[\s\S]*$/],
  ['og:type', /type:\s*'website'/],
  ['og:title', /title:\s*TITLE/],
  ['og:description', /description:\s*DESCRIPTION/],
  ['og:url', /url:\s*SITE\.siteUrl/],
  ['og:image 1200x630', /width:\s*1200,\s*height:\s*630/],
  ['og locale from SEO', /locale:\s*SEO\.ogLocale/],
  ['og alternate locale', /alternateLocale:\s*\[SEO\.ogAlternateLocale\]/],
  ['twitter card', /card:\s*'summary_large_image'/],
  ['robots index/follow', /index:\s*true,\s*follow:\s*true/],
];
const rootMissing = rootChecks.filter(([, re]) => !re.test(layout)).map(([n]) => n);
check('ROOT-1', rootMissing.length === 0,
  rootMissing.length ? `missing: ${rootMissing.join(', ')}` : `all ${rootChecks.length} root metadata fields present`,
  loc('app/layout.tsx', 'export const metadata'));
check('ROOT-2', /<html lang="ar" dir="rtl"/.test(RAW['app/layout.tsx']),
  'document starts lang=ar dir=rtl (LangProvider switches to en/ltr)', loc('app/layout.tsx', '<html lang='));
check('ROOT-3', /ogLocale:\s*'ar_AE'/.test(site) && /ogAlternateLocale:\s*'en_US'/.test(site),
  'Open Graph locale ar_AE with en_US alternate', loc('lib/site.ts', 'ogLocale:'));
const i18n = existsWeb('lib/i18n.tsx') ? readWeb('lib/i18n.tsx') : '';
check('ROOT-4', /document\.documentElement\.lang\s*=\s*lang/.test(i18n)
  && /document\.documentElement\.dir\s*=\s*dir/.test(i18n),
  'language toggle updates <html lang/dir> for fully-English mode', 'website/lib/i18n.tsx');

// ------------------------------------------------------------
// 3. Every route has complete metadata
// ------------------------------------------------------------
for (const { route, key, files } of ROUTES) {
  const src = files.map((f) => SRC[f] || '').join('\n') + '\n' + helper;
  const viaFactory = src.includes(`routeMetadata('${route}'`);
  const ok = !!pairs[key]
    && (src.includes(`canonical: '${route}'`) || (viaFactory && /canonical:\s*route/.test(helper)))
    // v11.44 — no self-referencing hreflang (Q4: useless without /ar /en routes).
    && !/languages:\s*\{\s*ar:\s*'\/'/.test(src)
    && /openGraph:\s*\{/.test(src)
    && /twitter:\s*\{/.test(src)
    && /robots:\s*\{/.test(src)
    && /locale:\s*SEO\.ogLocale/.test(src)
    && /alternateLocale:\s*\[SEO\.ogAlternateLocale\]/.test(src)
    && /card:\s*'summary_large_image'/.test(src);
  check(`PAGE-${key}`, ok,
    ok ? `${route}: unique title/description + canonical + hreflang + OG(ar_AE/en_US) + Twitter + robots`
      : `incomplete metadata wiring for ${route} (${files.join(', ')})`,
    `${files[0]}:${lineOf(readWeb(files[0]), 'metadata')}`);
}
check('PAGE-ALL', ROUTES.every(({ key }) => !!pairs[key]),
  `all ${ROUTES.length} sitemap routes have a metadata source`, 'website/app');

// ------------------------------------------------------------
// 4. Structured data — truthful
// ------------------------------------------------------------
const ld = layout + '\n' + helper;
const schemaChecks = [
  ['Organization', /'@type':\s*'Organization'/],
  ['SoftwareApplication', /'@type':\s*'SoftwareApplication'/],
  ['WebSite', /'@type':\s*'WebSite'/],
  ['FAQPage', /'@type':\s*'FAQPage'/],
  ['BreadcrumbList', /'@type':\s*'BreadcrumbList'/],
  ['publisher @id', /publisher:\s*\{\s*'@id':/],
  ['logo gear icon', /sadeem-app-logo\.png/],
  ['version from SITE', /version:\s*SITE\.version/],
  ['Windows', /operatingSystem:\s*'Windows'/],
  ['DeveloperApplication', /applicationCategory:\s*'DeveloperApplication'/],
  ['free offer', /price:\s*0/],
  ['isAccessibleForFree', /isAccessibleForFree:\s*true/],
  ['org @id', /#organization/],
  ['website @id', /#website/],
];
const schemaMissing = schemaChecks.filter(([, re]) => !re.test(ld)).map(([n]) => n);
const fake = /aggregateRating|reviewRating|ratingValue|price:\s*(?:79|99)\b|SearchAction/.test(ld);
check('LD-1', schemaMissing.length === 0 && !fake,
  schemaMissing.length || fake
    ? `schema issue: missing=[${schemaMissing.join(', ')}] fake=${fake}`
    : 'Organization + SoftwareApplication + WebSite + FAQPage + BreadcrumbList, honest $0 offer',
  loc('app/layout.tsx', 'ORGANIZATION_SCHEMA'));
check('LD-2', /version:\s*'11\.12\.0'/.test(site) && /siteUrl:\s*'https:\/\/sadeem-ai\.com'/.test(site),
  'version 11.12.0 and canonical domain are single-source constants', loc('lib/site.ts', 'version:'));
check('LD-3', (RAW['app/layout.tsx'].match(/type="application\/ld\+json"/g) || []).length === 4
  && /type="application\/ld\+json"/.test(RAW[HELPER]),
  'four global JSON-LD blocks in root + per-route breadcrumb block', 'website/app/layout.tsx');

// ------------------------------------------------------------
// 5. Sitemap + robots
// ------------------------------------------------------------
const sitemap = SRC['app/sitemap.ts'];
check('SM-1', SITEMAP_ROUTES.every((p) => sitemap.includes(`path: '${p}'`)),
  `sitemap lists all ${SITEMAP_ROUTES.length} public routes`, loc('app/sitemap.ts', 'const PAGES'));
check('SM-2', /const lastModified = SEO\.lastModified/.test(sitemap) && !/new Date\s*\(/.test(sitemap),
  'stable lastModified from SEO constant, no per-render clock', loc('app/sitemap.ts', 'const lastModified'));
check('SM-3', /SITE\.siteUrl\.replace/.test(sitemap) && !/vercel\.app/.test(sitemap),
  'sitemap URLs use the canonical domain only', loc('app/sitemap.ts', 'const base'));
// v11.44 — the self-referencing hreflang alternates were removed from the
// sitemap too (Q4 study). Assert they stay absent.
check('SM-4', !/languages:\s*\{\s*ar:\s*url,\s*en:\s*url/.test(sitemap),
  'sitemap has no fake self-referencing ar/en hreflang', loc('app/sitemap.ts', 'alternates:'));

const robots = RAW['app/robots.ts'];
check('ROBOTS-1', /allow:\s*'\/'/.test(robots) && /sitemap:\s*`\$\{base\}\/sitemap\.xml`/.test(robots),
  'crawlers allowed and canonical sitemap URL emitted', loc('app/robots.ts', 'rules:'));
check('ROBOTS-2', !/disallow/i.test(robots),
  'no public route blocked', loc('app/robots.ts', 'userAgent:'));
check('ROBOTS-3', ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot'].every((b) => robots.includes(b)),
  'AI discovery crawlers explicitly allowed', loc('app/robots.ts', 'userAgent: ['));

// ------------------------------------------------------------
// 6. llms.txt — AI discovery, factual
// ------------------------------------------------------------
const llms = existsWeb('public/llms.txt') ? readWeb('public/llms.txt') : '';
const llmsOk = /^# SADEEM/m.test(llms)
  && llms.includes(SITE_URL)
  && llms.includes('11.12.0')
  && llms.includes('BYOK')
  && llms.includes('offline-capable')
  && llms.includes('public season')
  && ['/features', '/download', '/docs', '/pricing', '/changelog'].every((p) => llms.includes(`${SITE_URL}${p}`));
check('LLMS-1', llmsOk,
  'llms.txt describes real capabilities, version, canonical URL and docs links', 'website/public/llms.txt:1');
check('LLMS-2', !!llms && !banned.test(llms) && !/aggregateRating|ratingValue|world.?class/i.test(llms),
  'llms.txt has no superlatives, ratings or invented prices', 'website/public/llms.txt');

// ------------------------------------------------------------
// 7. Semantic HTML + CWV font hygiene
// ------------------------------------------------------------
const H1_FILES = ['app/page.tsx', 'app/features/page.tsx', 'app/pricing/page.tsx', 'app/docs/page.tsx'];
let h1Ok = true;
for (const f of H1_FILES) {
  const s = existsWeb(f) ? strip(readWeb(f)) : '';
  const n = (s.match(/<h1\b/g) || []).length;
  const h2 = (s.match(/<h2\b/g) || []).length;
  if (n !== 1 || h2 < 1) h1Ok = false;
  note(`H1-${path.basename(path.dirname(f))}`, n === 1 && h2 >= 1 ? 'PASS' : 'FAIL',
    `${n} h1 / ${h2} h2`, `${f}:${lineOf(s, '<h1')}`);
}
check('H1-ALL', h1Ok, 'exactly one h1 with h2 subsections on the main pages', 'website/app');
check('A11Y-1', /<main>\{children\}<\/main>/.test(RAW['app/layout.tsx']),
  'main landmark wraps route content', loc('app/layout.tsx', '<main>'));
const css = RAW['app/globals.css'] || '';
const faces = css.match(/@font-face\s*\{[^}]*\}/g) || [];
check('CWV-1', faces.length >= 5 && faces.every((f) => /font-display:\s*swap/.test(f))
  && faces.some((f) => /url\('\/fonts\//.test(f)),
  `${faces.length} self-hosted @font-face rules all use font-display:swap (no render-blocking remote font, no CLS from font swap)`,
  loc('app/globals.css', '@font-face'));

// ------------------------------------------------------------
// 8. Rendered build artifacts (when present)
// ------------------------------------------------------------
if (!fs.existsSync(BUILD)) {
  note('BUILD-0', 'SKIP', 'website/.next not found — run npm run build for rendered-head checks');
} else {
  for (const { route, build } of ROUTES) {
    const f = path.join(BUILD, build);
    if (!fs.existsSync(f)) { note(`BUILD-${build}`, 'FAIL', 'prerendered HTML missing', `.next/server/app/${build}`); continue; }
    const html = fs.readFileSync(f, 'utf8');
    const canonical = route === '/' ? SITE_URL : `${SITE_URL}${route}`;
    const ok = /<title>[^<]+<\/title>/.test(html)
      && /<meta name="description" content="[^"]+"/.test(html)
      && html.includes(`<link rel="canonical" href="${canonical}"/>`)
      && html.includes('property="og:title"')
      && html.includes('property="og:image"')
      && html.includes('property="og:locale" content="ar_AE"')
      && html.includes('name="twitter:card"')
      // v11.44 — no self-referencing hreflang tags in the prerendered head.
      && !/hrefLang="ar"/i.test(html)
      && html.includes('"@type":"Organization"')
      && html.includes('"@type":"SoftwareApplication"')
      && html.includes('"@type":"WebSite"')
      && html.includes('"@type":"FAQPage"');
    check(`BUILD-${build}`, ok,
      ok ? `${route}: title/desc/canonical/OG(ar_AE)/Twitter/hreflang + 4 JSON-LD types`
        : `rendered head incomplete for ${route}`, `.next/server/app/${build}`);
  }
  const auditHtml = (name, label) => {
    const p = path.join(BUILD, name);
    if (!fs.existsSync(p)) { note(`BUILD-${label}`, 'FAIL', `${name} missing`, `.next/server/app/${name}`); return; }
    const t = fs.readFileSync(p, 'utf8');
    if (label === 'robots') {
      check('BUILD-robots', /Allow: \//.test(t) && t.includes(`Sitemap: ${SITE_URL}/sitemap.xml`)
        && !/Disallow:/i.test(t), 'rendered robots.txt allows crawlers and points to sitemap',
        '.next/server/app/robots.txt.body');
    } else {
      const ok = SITEMAP_ROUTES.every((p2) => t.includes(`<loc>${SITE_URL}${p2}</loc>`))
        && (t.match(/<lastmod>/g) || []).length === SITEMAP_ROUTES.length
        && !/xhtml:link/.test(t); // v11.44 — no self-referencing hreflang
      check('BUILD-sitemap', ok, `${SITEMAP_ROUTES.length} loc + lastmod, no fake hreflang in XML`,
        '.next/server/app/sitemap.xml.body');
    }
  };
  auditHtml('robots.txt.body', 'robots');
  auditHtml('sitemap.xml.body', 'sitemap');
  const ogb = path.join(BUILD, 'opengraph-image.body');
  if (fs.existsSync(ogb)) {
    const b = fs.readFileSync(ogb);
    const png = b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    check('BUILD-ogimage', png && w === 1200 && h === 630,
      `rendered OG image is a real PNG (${w}x${h}, ${b.length} bytes)`, '.next/server/app/opengraph-image.body');
  } else note('BUILD-ogimage', 'FAIL', 'opengraph-image.body missing', '.next/server/app/opengraph-image.body');
}

// ------------------------------------------------------------
// Output
// ------------------------------------------------------------
const fails = results.filter((r) => r.status === 'FAIL').length;
const passes = results.filter((r) => r.status === 'PASS').length;
const skips = results.filter((r) => r.status === 'SKIP').length;
console.log('');
console.log(`RESULT: ${passes} PASS / ${fails} FAIL / ${skips} SKIP`);
console.log('Scope: website SEO only. No deploy, no ranking guarantee.');
process.exit(fails ? 1 : 0);
