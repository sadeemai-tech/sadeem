/**
 * v11.40 — app-mock fidelity SOURCE GUARDS.
 * Reads the real app (authoritative) and the website mock; no browser needed.
 * Run from the repository root: node tests-v1140-app-mock-fidelity.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const page = read('website/app/page.tsx');
const css = read('website/app/app-mock.css');
const homeCss = read('website/app/home.css');
const artMotion = read('website/app/art-motion.css');
const rail = read('src/components/Rail.tsx');
const composer = read('src/components/Composer.tsx');
const chatPanel = read('src/components/ChatPanel.tsx');

let failed = 0;
const ok = (id, msg) => console.log(`PASS ${id} — ${msg}`);
const bad = (id, msg) => { failed++; console.log(`FAIL ${id} — ${msg}`); };
const check = (id, cond, msg) => (cond ? ok(id, msg) : bad(id, msg));

/* the one motion block is the only owner of app-mock timing */
const mm = page.match(/const APP_MOCK_MOTION = `([\s\S]*?)`;/);
check('M0', !!mm, 'APP_MOCK_MOTION source block found');
const motion = mm ? mm[1] : '';

/* 1 — exact lucide identifiers from Rail.tsx must all be in the mock import */
const railLucide = new Set();
for (const m of rail.matchAll(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g)) {
  for (const name of m[1].split(',')) {
    const n = name.trim().split(/\s+as\s+/)[0].trim();
    if (n) railLucide.add(n);
  }
}
const importBlock = (page.match(/import\s*\{([\s\S]*?)\}\s*from\s*'lucide-react'/) || [])[1] || '';
const missingIcons = [...railLucide].filter((n) => !new RegExp(`\\b${n}\\b`).test(importBlock));
check('I1', railLucide.size > 0 && missingIcons.length === 0,
  `exact Rail.tsx lucide names present (${railLucide.size} names${missingIcons.length ? `; missing: ${missingIcons.join(', ')}` : ''})`);

/* also require the composer/chat glyphs the founder called out */
const required = ['Mic', 'BookMarked', 'History', 'Gauge', 'Download', 'ShieldCheck',
  'Shrink', 'MessageSquarePlus', 'MessageSquare', 'ChevronDown'];
check('I2', required.every((n) => new RegExp(`\\b${n}\\b`).test(importBlock)),
  'composer + chat-header lucide names present');
check('I3', /IcPlus|name="plus"|plus: \{ shapes/.test(page) && /send: \{ shapes/.test(page)
  && /spark: \{ shapes/.test(page), 'IcPlus / IcSend / IcSpark copied verbatim (no invented icons)');

/* 2 — rail names + numbers from Rail.tsx MORE list must be in DEMO.railMore */
const moreSection = rail.slice(rail.indexOf('const MORE'), rail.indexOf('OPEN_SETTINGS_EVENT'));
const realMore = [...moreSection.matchAll(/labelFallback:\s*'([^']+)'/g)].map((m) => m[1]);
const realNos = [...moreSection.matchAll(/no:\s*'(\d+)'/g)].map((m) => m[1]);
const absentMore = realMore.filter((label) => !page.includes(`'${label}'`));
check('R1', realMore.length === 11 && absentMore.length === 0,
  `all 11 MORE labels mirrored (${realMore.length}${absentMore.length ? `; missing: ${absentMore.join(', ')}` : ''})`);
const absentNos = realNos.filter((n) => !/no:\s*'\d+'/g.test(page) || !page.includes(`no: '${n}'`));
check('R2', ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '13', '15', '16']
  .every((n) => page.includes(`no: '${n}'`)) && absentNos.length === 0,
  'rail numbers match exactly (incl. real gaps 12/14)');
check('R3', /DEMO\.railMore\.map/.test(page) && /appmock-rail-flyout/.test(page)
  && /appmock-rail-flyout\[hidden\]/.test(css),
  'More items are data/collapsed, not visible tabs (calm rail)');

/* 3 — exactly ONE pointer keyframe ACROSS page.tsx + home.css (X6 C1) */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const allSources = stripComments(page) + '\n' + stripComments(homeCss);
const glideCount = (allSources.match(/@keyframes\s+appmock-cursor-path\s*\{/g) || []).length;
check('C1', glideCount === 1, `exactly one cursor keyframe in page.tsx + home.css (found ${glideCount})`);
check('C1b', !/appmock-click-pulse|appmock-mouse-glide/.test(allSources),
  'no legacy click-pulse / mouse-glide system remains (comments ignored)');
check('C1c', !/animation\s*:\s*appmock-cursor-path/.test(homeCss)
  && !/animation\s*:\s*appmock-(ripple|ring)/.test(homeCss),
  'home.css applies no cursor/click animation (static chrome only)');
const glideBody = (motion.match(/@keyframes appmock-cursor-path\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
check('C2', glideBody.length > 0 && !/cqw/.test(glideBody),
  'cursor keyframe uses measured --am-c-* variables, no cqw guesses');
const targets = ['input', 'plus', 'orb', 'send', 'tool'];
check('C3', targets.every((t) => glideBody.includes(`--am-c-${t}-x`) && glideBody.includes(`--am-c-${t}-y`)),
  'lands on prompt / + / orb / Send / tool row');
check('C4', /useAppMockGeometry/.test(page) && /getBoundingClientRect/.test(page)
  && /--am-c-\$\{name\}-x/.test(page), 'waypoints computed from real element geometry');
check('C5', /dwell|landing/i.test(motion) && /46%/.test(glideBody) && /51%/.test(glideBody),
  'easing + genuine dwell on the measured Send target');

/* 4 — no nondeterminism in the motion block */
check('C6', !/Math\.random|new Date\s*\(|Date\.now\s*\(/.test(motion),
  'no Math.random / Date in APP_MOCK_MOTION');

/* 5 — exactly THREE motion gates */
const gates = [
  ['OS media query', /@media\s*\(prefers-reduced-motion:\s*reduce\)/g],
  ['in-app class', /html\.reduce-motion/g],
  ['art switch', /html\[data-art='off'\]/g],
];
let gateTypes = 0;
for (const [name, re] of gates) {
  const n = (motion.match(re) || []).length;
  if (n > 0) gateTypes++;
  check(`G-${name}`, n > 0, `${name} gate present (${n} guarded selectors)`);
}
check('G-count', gateTypes === 3, `exactly three motion gate types (found ${gateTypes})`);
check('G4', /static end state/.test(motion) && /100%\{opacity:0/.test(glideBody),
  'reduced/static end state is explicit');

/* 6 — v11.41 — SILK REMOVED. The old S1–S4 checks asserted that the silk
 * fan existed, was symmetric, had one glow and was motion-guarded. The
 * founder rejected the band outright ("شيله تماما"), so those assertions
 * were inverted: no silk selector, markup, gradient or keyframe may remain
 * in ANY owned source. Two new checks cover the built-site preview that
 * replaced the detail the founder asked for inside the console. */
const srcNoComments = stripComments(page) + '\n' + stripComments(css)
  + '\n' + stripComments(homeCss) + '\n' + stripComments(artMotion);
const silkRe = /appmock-silk|SILK_FAN|AppMockSilk|silk-band|am-silk-glow|silk ribbon/i;
check('S1', !silkRe.test(srcNoComments),
  'no silk/ribbon selector, component, fan data or gradient remains (page.tsx + 3 CSS files)');
check('S2', !/radialGradient|linearGradient/.test(stripComments(page).slice(
  page.indexOf('function HeroMosaic()'), page.indexOf('ICON FIDELITY'))),
  'the rejected light-line/glow treatment is gone from the hero art too');
check('S3', /appmock-preview/.test(page) && /appmock-pv-canvas/.test(page)
  && /appmock-pv-stamp/.test(page) && /preview_screenshot/.test(page),
  'built-site preview panel with a rendered page + preview_screenshot hairline stamp is present');
check('S4', /appmock-pv-url/.test(page) && /localhost:5173/.test(page)
  && /appmock-pv-eyebrow/.test(page) && /appmock-pv-h1/.test(page)
  && /appmock-pv-card/.test(page),
  'preview URL bar, LIVE PREVIEW bar, mini hero and cards mirror the real PreviewArea');

/* 7 — cross-checks that the real source still owns these contracts */
check('X1', /deriveRunPhases/.test(chatPanel) && /no timers/.test(chatPanel),
  'real phase strip stays data-derived (mock has no invented progress)');
check('X2', /QUICK_COMMANDS = \['\/plan', '\/review', '\/init', '\/compact', '\/model', '\/settings'\]/.test(composer),
  'real QUICK_COMMANDS unchanged; mock mirrors the same list');

/* X6 C4 — one declaration per property for the duplicate composer rules */
const sendBlocks = (homeCss.match(/\.appmock-send\s*\{/g) || []).length;
const sendSvgBlocks = (homeCss.match(/\.appmock-send svg\s*\{/g) || []).length;
const cursorSvgBlocks = (homeCss.match(/\.appmock-cursor>svg\s*\{/g) || []).length;
check('D1', sendBlocks === 1 && sendSvgBlocks === 1 && cursorSvgBlocks === 1,
  `one .appmock-send (${sendBlocks}), one send svg (${sendSvgBlocks}), one cursor svg (${cursorSvgBlocks})`);
check('D2', !/width:20px;height:24px|translate3d\(31cqw,74cqw/.test(homeCss),
  'no stale 20×24 / guessed-cqw cursor base left in home.css');

/* X6 C5 — one --am-ink value; the app-mock's light ink wins everywhere */
const inks = [...homeCss.matchAll(/--am-ink\s*:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase());
check('K1', inks.length > 0 && inks.every((v) => v === '#e9eef6') && !/#0c1103/.test(artMotion),
  `--am-ink consistent (${[...new Set(inks)].join(', ') || 'none'}; art-motion defines no --am-*)`);

/* X6 C6 — one cadence family: 2.8s base, 400ms unit, 4-cadence pointer shot */
check('T1', /--art-cadence\s*:\s*2\.8s/.test(artMotion)
  && /AM_CADENCE_MS\s*=\s*2800/.test(page) && /AM_BEAT_UNIT\s*=\s*AM_CADENCE_MS\s*\/\s*7/.test(page),
  'one cadence base (2.8s) and one derived 400ms unit');
check('T2', /calc\(var\(--art-cadence,2\.8s\) \* 4\)/.test(motion)
  && !/9200ms|8\.6s|2200ms linear 3[68]00ms/.test(motion),
  'pointer / ripple / ring share the 4-cadence clock; no orphan 9.2s / 8.6s / 2.2s');
check('T3', !/d: '\d+ms'/.test(page) && !/beat\('\d+ms'\)/.test(page),
  'every reveal delay is a cadence unit, not a free literal');

console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILED`} — v11.40 app-mock fidelity`);
process.exit(failed === 0 ? 0 : 1);
