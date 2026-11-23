#!/usr/bin/env node
// ============================================================
// v11.42 — HERO PANEL FIDELITY + SINGLE CURSOR GUARD
// ------------------------------------------------------------
// Run from the repository root:  node tests-v1142-hero-panels.mjs
//
// Source-level only. The founder asked for the hero's Desktop / Editor /
// CLI miniatures to be a copy of the REAL app, with the app-mock's mouse
// craft. This guard proves:
//   1. the three panels mirror real shell markup (rail, tool row, composer,
//      tabs + diff, terminal output),
//   2. the Desktop cursor is ONE measured path (exactly one keyframe), with a
//      transition-based ripple + scoped attach popover, and no duplication of
//      the app-mock pointer system,
//   3. all three motion kill switches + palette / determinism invariants.
// No file is edited. See docs/HERO-PANELS-V1142.md.
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
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
function check(id, ok, detail, loc = '') {
  results.push({ id, status: ok ? 'PASS' : 'FAIL', detail, loc });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${loc ? ` [${loc}]` : ''}: ${detail}`);
}

const PAGE = read(path.join(WEB, 'app/page.tsx'));
const HP = read(path.join(WEB, 'app/hero-panels.css'));
const HOME = read(path.join(WEB, 'app/home.css'));
const page = stripComments(PAGE);
const hp = stripComments(HP);

const compStart = PAGE.indexOf('function HeroMosaic()');
const compEnd = PAGE.indexOf('ICON FIDELITY', compStart);
const hero = stripComments(PAGE.slice(compStart, compEnd > compStart ? compEnd : undefined));
const desktop = hero.slice(hero.indexOf('hm-desktop'), hero.indexOf('hm-editor'));
const editor = hero.slice(hero.indexOf('hm-editor'), hero.indexOf('hm-cli'));
const cli = hero.slice(hero.indexOf('hm-cli'), hero.indexOf('hm-terminal'));
const hook = page.slice(page.indexOf('function useHeroPanelGeometry'), compStart);
const loc = (n) => `website/app/page.tsx:${n}`;

// ---------------------------------------------------------------------------
// 1 — the new layer is isolated (no home.css ownership) and mounted last
// ---------------------------------------------------------------------------
const imports = [...page.matchAll(/import '\.\/([^']+\.css)'/g)].map((m) => m[1]);
check('P1', imports.includes('hero-panels.css')
  && imports.indexOf('hero-panels.css') > imports.indexOf('app-mock.css')
  && !/hpx-/.test(HOME),
  'hero-panels.css imported after app-mock.css; home.css owns no hpx-* rule',
  loc(findLines(PAGE, /hero-panels\.css/)[0] || '?'));

// ---------------------------------------------------------------------------
// 2 — geometry comes from the panel's own rendered elements, not guesses
// ---------------------------------------------------------------------------
check('P2', /function useHeroPanelGeometry\(/.test(hook)
  && /getBoundingClientRect\(\)/.test(hook)
  && ['hpx-compose-input', 'hpx-plus', 'hpx-send'].every((c) => hook.includes('.' + c))
  && /--hm-c-\$\{name\}-x/.test(hook)
  && !/Math\.random|new Date|Date\.now/.test(hook),
  'one effect measures input / + / Send and publishes --hm-c-* pixels (no random/time)',
  loc(findLines(PAGE, /function useHeroPanelGeometry/)[0] || '?'));
check('P3', /className="hm-panel hm-desktop" ref=\{deskRef\}/.test(hero)
  && /useHeroPanelGeometry\(deskRef\)/.test(hero)
  && /hm-desktop\[data-hm-in='true'\]/.test(hp),
  'Desktop panel carries the measured ref; motion is gated by data-hm-in',
  loc(findLines(PAGE, /className="hm-panel hm-desktop"/)[0] || '?'));

// ---------------------------------------------------------------------------
// 3 — DESKTOP mirrors Rail.tsx / ChatPanel.tsx / MessageView / Composer
// ---------------------------------------------------------------------------
check('P4', /DEMO\.nav\.map\(/.test(desktop) && /hpx-rail-no/.test(desktop)
  && /hpx-rail-more/.test(desktop) && /DEMO\.utils\.map\(/.test(desktop)
  && /className="hm-app-rail" dir="ltr"/.test(desktop),
  'numbered primary rail + Files + More + utilities, physically LTR');
check('P5', /hpx-chat-brand/.test(desktop) && /DEMO\.consoleLabel/.test(desktop)
  && /DEMO\.session/.test(desktop) && /hpx-chat-status/.test(desktop),
  'chat head: brand square, 01 AGENT CONSOLE, session title, three status dots');
check('P6', /hpx-tool-verb/.test(desktop) && /DEMO\.toolName/.test(desktop)
  && /DEMO\.toolPath/.test(desktop) && /DEMO\.toolDuration/.test(desktop)
  && /hpx-tool-rule/.test(desktop)
  && /\.hm-app-tool::before\{[^}]*width:1px/.test(hp),
  'real tool row: read_file + path + OK/duration on one 1px hairline');
check('P7', /hpx-modes/.test(desktop) && /hpx-compose-input/.test(desktop)
  && /className="hpx-plus"/.test(desktop) && /className="hpx-mic"/.test(desktop)
  && /className="hpx-orb"/.test(desktop) && /pathLength=\{100\}/.test(desktop)
  && /strokeDasharray="62 100"/.test(desktop) && /className="hpx-send"/.test(desktop)
  && /DEMO\.quickCommands/.test(desktop),
  'composer: mode chips, input+caret, +, mic, 62% context orb, model, Send, slash hints');
check('P8', /className="hpx-attach-pop"/.test(desktop)
  && ['image', 'file', 'presets', 'rewind'].every((g) => desktop.includes(`name="${g}"`))
  && /hpx-attach-head/.test(desktop)
  && /\.hm-desktop\[data-hm-in='true'\] \.hpx-attach-pop\{/.test(hp),
  'AttachMenu popover: four real paths, one hairline, transition-scoped');

// ---------------------------------------------------------------------------
// 4 — EDITOR + CLI detail lifted from the real app
// ---------------------------------------------------------------------------
check('P9', (editor.match(/className="hpx-tab/g) || []).length >= 3
  && /hpx-diffstat/.test(editor) && /hpx-code-del/.test(editor)
  && /hm-code-add/.test(editor) && /hpx-minimap/.test(editor)
  && /Ln 20/.test(editor),
  'editor: 3 real file tabs, breadcrumb, +/− diff, line numbers, minimap, status');
check('P10', /sadeem run/.test(cli) && /read_file settings\/theme-context\.ts/.test(cli)
  && /2 tools/.test(cli) && /sadeem preview/.test(cli)
  && /localhost:5173/.test(cli) && /className="hpx-cli-caret"/.test(cli)
  && /@keyframes hpx-caret-blink/.test(hp),
  'CLI: real command, honest output lines and a gated blinking caret');

// ---------------------------------------------------------------------------
// 5 — ONE cursor, no duplicate of the app-mock pointer system
// ---------------------------------------------------------------------------
const pathKeys = (hp.match(/@keyframes\s+[\w-]*cursor[\w-]*/g) || []);
check('P11', pathKeys.length === 1 && /@keyframes hm-cursor-path\{/.test(hp)
  && !/appmock-cursor-path|appmock-ripple|appmock-ring/.test(hp),
  `exactly ONE cursor keyframe in the new sheet (${pathKeys.length}); no app-mock pointer copy`);
check('P12', /var\(--hm-c-input-x\)/.test(hp) && /var\(--hm-c-plus-x\)/.test(hp)
  && /var\(--hm-c-send-x\)/.test(hp)
  && !/cqw|Math\.random/.test(hp)
  && /@keyframes hm-cursor-path\{[\s\S]*?animation-timing-function:ease-out/.test(hp),
  'cursor waypoints are measured pixels with eased approach + dwell, no cqw guesses');
check('P13', (desktop.match(/className="hpx-cursor"/g) || []).length === 1
  && (desktop.match(/<svg\b/g) || []).length >= 2
  && !/appmock-cursor|appmock-click|appmock-send/.test(hero),
  'one deliberate cursor in the Desktop panel; zero appmock-* classes in the hero');
check('P14', /\.hm-desktop\[data-hm-in='true'\] \.hpx-click\{[^}]*transition:/.test(hp)
  && !/@keyframes[^{]*ripple/.test(hp)
  && /animation:hm-cursor-path calc\(var\(--art-cadence,2\.8s\) \* 2\.5\)/.test(hp),
  'click ripple is a transition on the same gate; the one cursor path shares --art-cadence');

// ---------------------------------------------------------------------------
// 6 — kill switches, palette, determinism, RTL
// ---------------------------------------------------------------------------
check('P15', /@media \(prefers-reduced-motion:reduce\)/.test(hp)
  && /html\.reduce-motion/.test(hp)
  && /html\[data-art='off'\]/.test(hp)
  && /hpx-cursor\{display:none!important\}/.test(hp),
  'OS media query + html.reduce-motion + data-art=off all hide the cursor');
check('P16', !/linearGradient|radialGradient|box-shadow|blur\(|filter:|feGaussian|drop-shadow/.test(hp),
  'no gradients, shadows, blur or glow in the new panel sheet');
check('P17', /font-variant-numeric:tabular-nums/.test(hp)
  && /font-feature-settings:'tnum' 1/.test(hp)
  && /vector-effect:non-scaling-stroke/.test(hp),
  'tabular mono figures and device-pixel-friendly non-scaling strokes');
const beforeHero = stripComments(PAGE.slice(0, compStart));
const afterHero = stripComments(PAGE.slice(compEnd > compStart ? compEnd : PAGE.length));
const bareHpxOutside = (beforeHero.match(/className="[^"]*\bhpx-/g) || [])
  .concat(afterHero.match(/className="[^"]*\bhpx-/g) || []);
check('P18', bareHpxOutside.length === 0,
  'hpx-* classes are used only inside HeroMosaic (no cross-section collision)');
check('P19', /\.hm-scene svg/.test(hp) && /inset-inline-start/.test(hp)
  && /dir="ltr"/.test(desktop) && /dir="ltr"/.test(editor) && /dir="ltr"/.test(cli),
  'RTL-safe: logical insets + physical LTR for rail, editor code and terminal');
check('P20', !/Math\.random\s*\(|new Date\s*\(|Date\.now\s*\(/.test(hero)
  && /const alt = tx\(/.test(hero),
  'mosaics stay hydration-safe with one bilingual accessible label');

// ---------------------------------------------------------------------------
console.log('\n=== RESULT ===');
const fails = results.filter((r) => r.status === 'FAIL').length;
const passes = results.filter((r) => r.status === 'PASS').length;
console.log(`${passes} PASS / ${fails} FAIL — v11.42 hero panels`);
process.exit(fails ? 1 : 0);
