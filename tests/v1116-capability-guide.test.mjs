import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

// ============================================================
// v11.16 — CapabilityGuide SSR / semantics / copy-honesty tests.
//
// Verifies:
//  1. The self-contained <CapabilityGuide> SSR-renders in EN and AR without
//     crashing, with real dialog semantics and bilingual (non-mixed) copy.
//  2. Every real slash command is listed, grouped by purpose.
//  3. No stale/removed feature names survive in Onboarding / WhatsNew /
//     CommandPalette (monthly plans, Arena, scaffold templates, old counts).
//  4. The "Open capability guide" palette command dispatches a REAL event —
//     never a fake no-op — and the guide listens for that exact event.
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

// Emit the bundle INSIDE the repo so `require('react')` resolves to the same
// project React instance react-dom/server uses (a second copy breaks hooks).
const buildDir = mkdtempSync(join(ROOT, 'tests', '.capguide-build-'));
after(() => {
  try { rmSync(buildDir, { recursive: true, force: true }); } catch { /* best effort */ }
});
const i18nStub = join(buildDir, 'i18n-stub.ts');
// makeT is a pure dictionary lookup in production; the test swaps in an
// equivalent pure stub so the SSR harness never has to boot the zustand store
// (or the Electron bridge) just to render a presentation component.
require('node:fs').writeFileSync(
  i18nStub,
  'const D: Record<string, [string, string]> = {\n' +
    "  'app.name': ['SADEEM', 'سديم'],\n" +
    "  'common.close': ['Close', 'إغلاق'],\n" +
    '};\n' +
    'export function makeT(l: string) { const i = l === "ar" ? 1 : 0; return (k: string, f?: string) => (D[k] ? D[k][i] : (f ?? k)); }\n' +
    'export type Lang = "en" | "ar";\n',
);
const bundleOut = join(buildDir, 'capability-guide.cjs');

await esbuild.build({
  entryPoints: [join(ROOT, 'src', 'components', 'CapabilityGuide.tsx')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundleOut,
  loader: { '.css': 'empty' },
  external: ['react', 'react/jsx-runtime'],
  plugins: [
    {
      name: 'pure-i18n-stub',
      setup(build) {
        build.onResolve({ filter: /(^|\/)i18n$/ }, () => ({ path: i18nStub }));
      },
    },
  ],
  logLevel: 'silent',
});

const { CapabilityGuide, OPEN_GUIDE_EVENT, SLASH_GROUPS } = require(bundleOut);
const React = require(join(ROOT, 'node_modules', 'react'));
const { renderToStaticMarkup } = require(join(ROOT, 'node_modules', 'react-dom', 'server'));
const h = React.createElement;
const render = (lang) => renderToStaticMarkup(h(CapabilityGuide, { open: true, lang }));

const src = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const GUIDE_SRC = src('src/components/CapabilityGuide.tsx');
const CSS_SRC = src('src/components/capability-guide.css');
const PALETTE_SRC = src('src/components/CommandPalette.tsx');
const WHATSNEW_SRC = src('src/components/WhatsNew.tsx');
const ONBOARD_SRC = src('src/components/Onboarding.tsx');
const COMPOSER_SRC = src('src/components/Composer.tsx');
const STORE_SRC = src('src/store.ts');

/** Strip tags + decode the few entities the renderer emits → visible text. */
const visibleText = (html) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const ARABIC = /[\u0600-\u06FF]/;
const LATIN = /[A-Za-z]/;

// ------------------------------------------------------------
// 1 · SSR EN / AR
// ------------------------------------------------------------
test('v11.16: CapabilityGuide SSR-renders EN with real dialog semantics', () => {
  const html = render('en');
  assert.ok(html.length > 1000, 'produced substantial markup');
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="capguide-/);
  assert.match(html, /dir="ltr"/);
  assert.match(html, /lang="en"/);
  // keyboard: focusable scroll region + a real close button with an aria-label
  assert.match(html, /role="document"[^>]*tabindex="0"|tabindex="0"[^>]*role="document"/);
  assert.match(html, /aria-label="Close[^"]*"/);
  // editorial type + honest footer
  assert.match(html, /cg-title/);
  assert.match(html, /145 real tools/);
  assert.match(html, /BYOK — bring your own key\. No subscription/);
});

test('v11.16: CapabilityGuide SSR-renders AR (Cairo / RTL) without crashing', () => {
  const html = render('ar');
  assert.ok(html.length > 1000, 'produced substantial markup');
  assert.match(html, /dir="rtl"/);
  assert.match(html, /lang="ar"/);
  assert.ok(html.includes('دليل الإمكانيات'), 'Arabic title present');
  assert.ok(html.includes('الدليل الحيّ'), 'Living Playbook localized');
  assert.ok(html.includes('بمفتاحك الخاص بلا اشتراك'), 'BYOK / no-subscription localized');
  assert.ok(html.includes('فهمت'), 'footer CTA localized');
});

// ------------------------------------------------------------
// 2 · Every real slash command, grouped by purpose
// ------------------------------------------------------------
const FOUNDER_COMMANDS = [
  '/model', '/profile', '/undo', '/continue', '/diff',
  '/test', '/explain', '/skills', '/mcp', '/budget',
];
const ALL_COMMANDS = SLASH_GROUPS.flatMap((g) => g.rows.map((r) => r.cmd));

test('v11.16: all real slash commands are present, including the founder list', () => {
  assert.equal(SLASH_GROUPS.length, 4, 'four purpose groups');
  for (const cmd of FOUNDER_COMMANDS) {
    assert.ok(ALL_COMMANDS.includes(cmd), `${cmd} listed`);
  }
  const en = render('en');
  for (const cmd of ALL_COMMANDS) {
    assert.ok(en.includes(`<code>${cmd}</code>`) || en.includes(cmd), `${cmd} rendered`);
  }
  // sanity: the canonical set is substantial, not a token handful
  assert.ok(ALL_COMMANDS.length >= 40, `lists ${ALL_COMMANDS.length} commands`);
  assert.equal(new Set(ALL_COMMANDS).size, ALL_COMMANDS.length, 'no duplicate commands');
});

test('v11.16: no fabricated commands — every listed command exists in the app', () => {
  // A command is real if it is in Composer's menu OR dispatched in store.ts.
  const real = new Set();
  for (const m of COMPOSER_SRC.matchAll(/cmd:\s*'(\/[a-z]+)'/g)) real.add(m[1]);
  for (const m of STORE_SRC.matchAll(/cmd === '([a-z]+)'/g)) real.add('/' + m[1]);
  for (const cmd of ALL_COMMANDS) {
    assert.ok(real.has(cmd), `${cmd} is a real app command (not invented)`);
  }
  // Deliberately absent: the retired subscription/plans command.
  assert.ok(!ALL_COMMANDS.includes('/plans'), 'no stale /plans command');
});

// ------------------------------------------------------------
// 3 · Honest, non-mixed bilingual copy + no stale feature names
// ------------------------------------------------------------
test('v11.16: no mixed-language strings (EN pure Latin, AR pure Arabic)', () => {
  // Data-level: descriptions are authored per-language, never concatenated.
  for (const g of SLASH_GROUPS) {
    assert.ok(!ARABIC.test(g.title.en), `EN group "${g.title.en}" has no Arabic`);
    assert.ok(!LATIN.test(g.title.ar), `AR group "${g.title.ar}" has no Latin`);
    for (const r of g.rows) {
      assert.ok(!ARABIC.test(r.desc.en), `EN desc for ${r.cmd} has no Arabic`);
      assert.ok(!LATIN.test(r.desc.ar), `AR desc for ${r.cmd} has no Latin`);
    }
  }
  // Render-level visible text: strip command tokens before the Latin check,
  // because "/model" etc. are intentional command identifiers in both scripts.
  const enVisible = visibleText(render('en')).replace(/\/[a-z]+/g, ' ');
  assert.ok(!ARABIC.test(enVisible), 'EN visible text has no Arabic characters');
  const arVisible = visibleText(render('ar')).replace(/\/[a-z]+/g, ' ');
  assert.ok(!LATIN.test(arVisible), 'AR visible text has no Latin words');
});

test('v11.16: no stale / removed feature names anywhere in owned copy', () => {
  const stale = ['113', '118', 'Arena', 'scaffold', 'Scaffold', 'template', 'Template', '$20', 'Plans & upgrade', 'Pro plan', 'Team plan', 'CreditCard'];
  for (const [name, text] of [
    ['CapabilityGuide', GUIDE_SRC],
    ['CommandPalette', PALETTE_SRC],
    ['WhatsNew', WHATSNEW_SRC],
    ['Onboarding', ONBOARD_SRC],
  ]) {
    for (const bad of stale) {
      assert.ok(!text.includes(bad), `${name} has no stale "${bad}"`);
    }
  }
  assert.ok(WHATSNEW_SRC.includes('145'), 'WhatsNew reflects the real 145-tool count');
  assert.ok(!WHATSNEW_SRC.includes('113 → 118'), 'old count removed');
});

test('v11.16: real current state is stated (profiles, playbook, BYOK, guide)', () => {
  const en = render('en');
  const enLower = en.toLowerCase();
  for (const term of ['145', 'essential', 'balanced', 'full', 'living playbook', 'mcp', 'recommended setup', 'bring your own key']) {
    assert.ok(enLower.includes(term), `EN states "${term}"`);
  }
  assert.ok(GUIDE_SRC.includes('/profile'), 'tool profiles explained with /profile');
  assert.ok(GUIDE_SRC.includes('/model'), 'recommended setup includes /model');
});

// ------------------------------------------------------------
// 4 · Real wiring (no fake command) + reduced motion
// ------------------------------------------------------------
test('v11.16: palette command dispatches the real guide event; guide listens for it', () => {
  assert.equal(OPEN_GUIDE_EVENT, 'surnia:open-capability-guide');
  assert.match(PALETTE_SRC, /openGuide/);
  assert.match(PALETTE_SRC, /label: t\('palette\.openGuide', 'Open capability guide'\)/);
  assert.match(PALETTE_SRC, /dispatchEvent\(new CustomEvent\(OPEN_GUIDE_EVENT\)\)/);
  assert.match(GUIDE_SRC, /window\.addEventListener\(OPEN_GUIDE_EVENT,/);
  // The old subscription command is gone from the palette.
  assert.ok(!PALETTE_SRC.includes('setPlans'), 'no stale setPlans command');
  assert.ok(!PALETTE_SRC.includes('openPlans'), 'no plans command');
});

test('v11.16: reduced-motion is guarded both ways with a static end state', () => {
  assert.match(CSS_SRC, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(CSS_SRC, /html\.reduce-motion/);
  assert.match(CSS_SRC, /animation:\s*none\s*!important/);
  assert.match(CSS_SRC, /transform:\s*scaleX\(1\)/); // static end state / fallback
  // editorial discipline: hairlines + serif display font, no gradients/shadows
  assert.match(CSS_SRC, /--font-display-serif/);
  assert.ok(!CSS_SRC.includes('linear-gradient'), 'no gradients');
  assert.ok(!CSS_SRC.includes('box-shadow: '), 'no decorative shadows');
});
