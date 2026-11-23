// ============================================================
// v11.27 — THE SMALL PROOF BUTTON MUST WORK.
// The founder: "زر البروف الصغير الي اخر شيء لا يعمل" — the tiny PROOF
// chip was left `disabled`. It is now a REAL control: one honest click copies
// a plain-text evidence summary (counts of REAL store gates) through the real
// navigator.clipboard.writeText and fires a real store notify() toast on the
// ACTUAL outcome. Still NO panel, NO tally chips, NO gate rows.
//
// Two layers:
//   1. SOURCE — exact locks on the wired handler, the clipboard/notify paths,
//      the honest single-language copy, the one-shot pulse and the redesigned
//      (no-panel) surface.
//   2. SSR — real React render of the component with seeded store evidence:
//      the button renders ENABLED with an honest "copy" label and the pip,
//      no panel markup leaks, and a plain chat turn renders nothing at all.
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

const ribbonSrc = readFileSync(join(ROOT, 'src/components/ProofRibbon.tsx'), 'utf8');
const cssSrc = readFileSync(join(ROOT, 'src/components/proof.css'), 'utf8');

// Strip JS comments so prose ("no longer DISABLED", "no popover panel", etc.)
// never satisfies a source assertion; only executable code is inspected.
const strip = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');
const code = strip(ribbonSrc);
const buttonBlock = code.match(/<button\b[\s\S]*?<\/button>/)?.[0] ?? '';

// ─────────────────────────────────────────────────────────
// SSR harness (same posture as v1116-chat-precision): browser stubs installed
// BEFORE the bundle loads, esbuild TS→CJS of the real component + store.
// ─────────────────────────────────────────────────────────
const BUNDLE = join(ROOT, 'tests', '.v1127-proof-button.bundle.cjs');
let mod;
let React;
let renderToStaticMarkup;

before(() => {
  globalThis.window = {
    surnia: new Proxy({}, {
      get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : () => Promise.resolve(undefined)),
    }),
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false }),
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
    body: { appendChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {} }),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  esbuildBuild();
  mod = require(BUNDLE);
  React = require('react');
  // zustand's SSR snapshot is the INITIAL state; point it at the live seeded
  // state so the visible-evidence branch actually executes during SSR.
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

function esbuildBuild() {
  const esbuild = require('esbuild');
  esbuild.buildSync({
    stdin: {
      contents:
        "export { ProofRibbon } from './src/components/ProofRibbon';" +
        "export { useStore } from './src/store';",
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: BUNDLE,
    loader: { '.css': 'empty' },
    external: ['electron', 'react', 'react-dom', 'lucide-react'],
  });
}

after(() => {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

// ═════════════════════════════════════════════════════════
// 1 · SOURCE — the button is enabled and REALLY wired
// ═════════════════════════════════════════════════════════
test('the PROOF button is enabled and has a real click handler', () => {
  assert.ok(buttonBlock, 'the single button is present');
  assert.ok(!/\bdisabled\b/.test(buttonBlock), 'the disabled attribute is GONE');
  assert.ok(!/\bdisabled\b/.test(code), 'no disabled prop anywhere in the component');
  assert.match(buttonBlock, /onClick=\{handleProofCopy\}/, 'a real onClick is wired');
  assert.equal((code.match(/<button\b/g) || []).length, 1, 'exactly ONE control');
  assert.match(buttonBlock, /type="button"/, 'honest button type');
  assert.match(buttonBlock, /data-testid="proof-toggle"/, 'stable SSR/AT hook kept');
  assert.match(buttonBlock, /className="pr-proof-toggle"/, 'small-control class kept');
});

test('clicking writes a real clipboard summary and toasts the ACTUAL outcome', () => {
  assert.match(code, /const handleProofCopy = async/, 'one contained async handler');
  assert.match(code, /navigator\.clipboard/, 'uses the real clipboard API');
  assert.match(code, /typeof clip\.writeText !== 'function'/, 'guards clipboard availability');
  assert.match(code, /await clip\.writeText\(summary\)/, 'awaits the REAL write');
  // Three real notify() paths: unavailable → failure catch → success.
  assert.ok(code.includes("notify(ar ? 'الحافظة غير متاحة' : 'Clipboard unavailable')"),
    'honest Clipboard-unavailable toast, never a silent no-op');
  assert.ok(code.includes("notify(ar ? 'تعذّر نسخ الإثبات' : 'Could not copy evidence')"),
    'real toast when the write rejects');
  assert.ok(code.includes("notify(ar ? 'تم نسخ ملخص الإثبات' : 'Evidence summary copied')"),
    'real toast only AFTER a resolved write');
  // Nothing is faked: no fake "copied" state, no raw JSON dump.
  assert.ok(!code.includes('setCopied'), 'no fabricated copied state');
  assert.ok(!code.includes('JSON.stringify'), 'no raw JSON in the clipboard text');
});

test('the summary is short, plain-text and built from REAL store gates', () => {
  assert.match(code, /proof\.gates/, 'reads real gates from the store');
  assert.match(code, /g\.tone === 'ok'/, 'counts real passing gates');
  assert.match(code, /g\.tone === 'bad'/, 'counts real failing gates');
  assert.match(code, /g\.tone === 'warn'/, 'counts real inconclusive gates');
  assert.match(code, /proof\.status/, 'uses the real run status');
  assert.match(code, /digits\(total\)/, 'numbers use the store digit formatter');
  assert.ok(!code.includes('detail}'), 'no per-gate rows / raw detail lines in the copy');
});

test('the button stays tiny, one-shot-pulsing, and panel-free', () => {
  // exactly one <button> and NO overlay/ledger surface anywhere
  for (const gone of ['pr-pop', 'pr-check', 'pr-tally', 'pr-kind', 'pr-pop-foot', 'role="dialog"']) {
    assert.ok(!code.includes(gone), `no ${gone} surface`);
  }
  assert.ok(code.includes('if (!proofVisible) return null;'), 'plain chat renders nothing');
  assert.ok(!code.includes('{open &&'), 'no conditional panel');
  assert.ok(!code.includes('copyEvidence('), 'no legacy copy control');
  assert.ok(!code.includes('toggleOpen('), 'no open/close handler');
  // one-shot pulse on the rising edge of new evidence
  assert.match(code, /key=\{pulseGen\}/, 'pip is keyed so the animation replays on remount');
  assert.match(code, /is-pulsing/, 'pip gets the pulsing class');
  assert.match(code, /if \(proofVisible && !prevVisible\.current\)/, 'pulse fires on rising edge only');
  assert.match(cssSrc, /\.pr-toggle-dot\.is-pulsing\s*\{[\s\S]*?animation: pr-pip-core[^;]*\b1\b both/,
    'core pulse is iteration-count 1');
  assert.match(cssSrc, /\.pr-toggle-dot\.is-pulsing::after\s*\{[\s\S]*?animation: pr-pip-ring[^;]*\b1\b both/,
    'ring pulse is iteration-count 1');
  // the 22px / 1px / mono surface is unchanged
  assert.match(cssSrc, /height:\s*22px/, '22px tall');
  assert.match(cssSrc, /border:\s*1px solid/, '1px hairline border');
  assert.match(cssSrc, /font-family:\s*var\(--font-mono-x/, 'mono label');
});

test('the control and its toasts are correctly bilingual, single-language', () => {
  assert.match(buttonBlock, /PROOF/, 'visible wordmark is the monolingual PROOF tag');
  assert.ok(!/[\u0600-\u06FF]/.test(
    buttonBlock.match(/<span className="pr-tag"[^>]*>([^<]*)</)?.[1] ?? ''),
    'the visible PROOF tag mixes no Arabic');
  assert.ok(buttonBlock.includes('نسخ ملخص الإثبات'), 'Arabic honest aria-label/title');
  assert.ok(code.includes('proof.openCenter') && /Copy proof summary and open/.test(code), 'English honest aria-label/title (v11.43 i18n key)');
  assert.ok(code.includes('إثبات سادم:'), 'Arabic summary');
  assert.ok(code.includes('SADEEM proof:'), 'English summary');
});

// ═════════════════════════════════════════════════════════
// 2 · SSR — real React markup, enabled and contained
// ═════════════════════════════════════════════════════════
test('SSR renders an ENABLED copy button with the pip and no panel markup', () => {
  mod.useStore.setState({
    proofVisible: true,
    proof: {
      status: 'proven',
      gates: [
        { id: 'verify', tone: 'ok', detail: 'passed', at: 1 },
        { id: 'fakes', tone: 'bad', detail: 'failed', at: 2 },
      ],
      updatedAt: 2,
      mutation: null,
    },
  });
  const html = renderToStaticMarkup(React.createElement(mod.ProofRibbon));
  assert.match(html, /data-testid="proof-toggle"/, 'the button is in the markup');
  assert.ok(!html.includes('disabled='), 'SSR markup has NO disabled attribute');
  assert.match(html, /aria-label="[^"]*"/, 'an honest accessible label is present');
  assert.ok(html.includes('PROOF'), 'visible PROOF wordmark');
  assert.ok(html.includes('pr-toggle-dot'), 'the one-shot pulse pip is rendered');
  for (const gone of ['pr-pop', 'pr-check', 'pr-tally', 'role="dialog"']) {
    assert.ok(!html.includes(gone), `no ${gone} markup leaked into SSR`);
  }
});

test('SSR with no evidence renders nothing (no stray enabled chip)', () => {
  mod.useStore.setState({ proofVisible: false, proof: { status: 'unproven', gates: [], updatedAt: 0, mutation: null } });
  const html = renderToStaticMarkup(React.createElement(mod.ProofRibbon));
  assert.equal(html, '', 'a plain chat turn renders no PROOF control at all');
});
