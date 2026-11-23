// ============================================================
// v11.27 — UI COMPONENT GUARD (DIAGNOSIS ONLY — NEVER FIX SOURCE).
//
// Three founder-screenshot fixes, verified by SOURCE + SSR + a real click:
//   A. MessageView.tsx  — NO TaintRow / taint dispatch, and NO other rejected
//                         proof-ish row (claim-audit / mutation-check / …).
//   B. ProofRibbon.tsx — ONE small, ENABLED button with a REAL onClick wired
//                         to clipboard + store notify; no popover / tally /
//                         ledger; ZERO proof UI on a plain chat turn.
//   C. ContextLens.tsx — the compact orb is ALWAYS mounted (even at zero
//                         usage), ONE mount beside the mic, exact 2πr arc
//                         math when data exists, fixed + viewport-clamped
//                         popover.
//
// Every assertion prints an exact `file:line` of the offending source so the
// parent can hand it straight to the fixing agent. This suite never patches
// application source — it only bundles the real components + real store with
// esbuild and SSRs them with renderToStaticMarkup (harness posture copied from
// tests/v1127-no-taint-ui.test.mjs and tests/v1127-context-visible.test.mjs).
//
//   node --test --test-force-exit tests/v1127-ui-guard.test.mjs
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const P = {
  msg: 'src/components/MessageView.tsx',
  ribbon: 'src/components/ProofRibbon.tsx',
  lens: 'src/components/ContextLens.tsx',
  composer: 'src/components/Composer.tsx',
  chatPanel: 'src/components/ChatPanel.tsx',
  statusBar: 'src/components/StatusBar.tsx',
  orbCss: 'src/components/context-orb.css',
};
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const MSG = read(P.msg), RIBBON = read(P.ribbon), LENS = read(P.lens);
const COMPOSER = read(P.composer), CHAT_PANEL = read(P.chatPanel), STATUS_BAR = read(P.statusBar);
const ORB_CSS = read(P.orbCss);

/** Drop comments only — a "removed" note must not make a strict guard brittle. */
const strip = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');
const msgCode = strip(MSG), ribbonCode = strip(RIBBON), lensCode = strip(LENS);

/** Exact source line of a needle (for actionable failure messages). */
function lineOf(src, needle) {
  const i = src.indexOf(needle);
  if (i < 0) return 0;
  let line = 1;
  for (let k = 0; k < i; k++) if (src.charCodeAt(k) === 10) line++;
  return line;
}
const at = (path, src, needle) => `${path}:${lineOf(src, needle) || '?'}`;

const BUNDLE = join(ROOT, 'tests', '.v1127-ui-guard.bundle.cjs');
let mod, React, renderToStaticMarkup;
let origJsx, origJsxs;
const captured = []; // every JSX element the bundle creates during a render

before(() => {
  const bridge = new Proxy({}, {
    get(_t, k) {
      if (k === 'then' || k === 'toJSON' || typeof k === 'symbol') return undefined;
      return () => Promise.resolve(undefined);
    },
  });
  globalThis.window = {
    surnia: bridge,
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false }),
    setTimeout: () => 1, clearTimeout() {},
    innerWidth: 1280, innerHeight: 800,
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {} }),
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => {} } }, configurable: true, writable: true,
  });

  esbuild.buildSync({
    stdin: {
      contents:
        "export { useStore } from './src/store';" +
        "export { MessageView } from './src/components/MessageView';" +
        "export { ProofRibbon } from './src/components/ProofRibbon';" +
        "export { ContextLens, ORB_SIZE, ORB_STROKE, ORB_RADIUS, ORB_CIRCUMFERENCE, orbArcLength } from './src/components/ContextLens';",
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLE,
    loader: { '.css': 'empty', '.svg': 'dataurl' },
    external: [
      'electron', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/server', 'zustand',
      'lucide-react', '@xterm/xterm', '@xterm/addon-fit', 'monaco-editor', '@monaco-editor/react',
    ],
  });
  mod = require(BUNDLE);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect; // SSR: silence layout-effect warning
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;

  // Capture the JSX elements the bundle emits so a real onClick can be invoked
  // without a DOM (jsdom / react-test-renderer are NOT installed in this repo).
  const jr = require('react/jsx-runtime');
  origJsx = jr.jsx; origJsxs = jr.jsxs;
  jr.jsx = (...a) => { captured.push({ type: a[0], props: a[1] }); return origJsx(...a); };
  jr.jsxs = (...a) => { captured.push({ type: a[0], props: a[1] }); return origJsxs(...a); };
});

after(() => {
  const jr = require('react/jsx-runtime');
  if (origJsx) jr.jsx = origJsx;
  if (origJsxs) jr.jsxs = origJsxs;
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

const h = (...a) => React.createElement(...a);
const T = 1700000000000;
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

function seedBase(extra = {}) {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    settings: {
      ...prev.settings, language: 'en', numerals: 'western',
      model: { provider: 'custom', model: 'm' },
    },
    running: false, ...extra,
  });
}
function seedChat(msgs = []) {
  seedBase({
    wsPath: ROOT, proofVisible: false, capabilityPanel: null, settingsOpen: false,
    session: {
      id: 's1', title: 't', workspace: ROOT, messages: msgs,
      createdAt: T, updatedAt: T, messageCount: msgs.length,
      totalTokens: 0, totalCostUsd: 0,
    },
  });
}
function seedProof(visible, notifySpy) {
  seedBase({
    proofVisible: visible,
    proof: { status: 'proven', gates: [{ id: 'verify', tone: 'ok', detail: 'exit 0', at: T }], updatedAt: T, mutation: null },
    notify: notifySpy,
  });
}
function seedLens(usage, ctxWindow) {
  seedBase({
    liveStreamChars: 0, ctxWindowEstimated: false,
    sessionUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    lastTurnUsage: usage, ctxWindow,
  });
}
const renderChat = (msgs) => renderToStaticMarkup(
  h('div', { className: 'chat-stream' }, ...msgs.map((m) => h(mod.MessageView, { key: m.id, msg: m, turnStart: true }))),
);
const renderRibbon = () => renderToStaticMarkup(h(mod.ProofRibbon));
const renderLens = () => renderToStaticMarkup(h(mod.ContextLens, { compact: true }));

function arcInfo(html) {
  const el = html.match(/<circle[^>]*class="ctx-orb-arc"[^>]*>/);
  assert.ok(el, 'the progress arc <circle> is rendered');
  const dash = el[0].match(/stroke-dasharray="([\d.eE+-]+)\s+([\d.eE+-]+)"/);
  const r = el[0].match(/\sr="([\d.eE+-]+)"/);
  assert.ok(dash && r, 'arc carries stroke-dasharray + radius');
  return { arc: Number(dash[1]), circumference: Number(dash[2]), r: Number(r[1]) };
}
const COMPACT_RADIUS = (22 - 3.5) / 2; // mirrors ContextLens.tsx compact radius

// ============================================================
// A — MESSAGEVIEW: no taint, no rejected proof rows
// ============================================================
const TAINT_MARKUP = [
  'TaintRow', 'TAINT', 'FLAGGED', 'ESCALATED',
  'Dangerous command after untrusted content', 'Untrusted source:',
  'sc-taint', 'mv-taint', 'data-notice="taint"',
];

test('A1 source: TaintRow + taint dispatch are deleted (no trace)', () => {
  for (const needle of TAINT_MARKUP) {
    assert.ok(!msgCode.includes(needle), `${at(P.msg, MSG, needle)}: taint remnant "${needle}" must be deleted`);
  }
  assert.ok(!/model\s*===\s*['"]taint['"]/.test(msgCode), `${P.msg}: no taint dispatch branch in any form`);
  assert.ok(!/\btaint\b/i.test(msgCode), `${P.msg}: no live taint UI code at all`);
});

test('A2 source: rejected proof-ish row components + dispatches are deleted', () => {
  const gone = [
    ['function ProofCard', 'ProofCard component'],
    ['function ClaimAuditRow', 'ClaimAuditRow component'],
    ['function MutationCheckRow', 'MutationCheckRow component'],
    ["model === 'proof'", 'proof dispatch'],
    ["model === 'claim-audit'", 'claim-audit dispatch'],
    ["model === 'mutation-check'", 'mutation-check dispatch'],
    ["model === 'mutation-gate'", 'mutation-gate dispatch'],
    ["model === 'red-green'", 'red-green dispatch'],
    ["model === 'fake-tests'", 'fake-tests dispatch'],
  ];
  const found = gone
    .filter(([needle]) => msgCode.includes(needle))
    .map(([needle, desc]) => `    ${at(P.msg, MSG, needle)} — ${desc} still present ("${needle}")`);
  assert.equal(found.length, 0,
    `${P.msg}: ${found.length} rejected proof row remnant(s) still in source — delete them all:\n${found.join('\n')}`);
});

test('A3 SSR: a taint synthetic message renders NO taint / proof markup', () => {
  const msgs = [{
    id: 'taint-a', role: 'assistant', kind: 'text', model: 'taint',
    content: JSON.stringify({ why: 'escalate', sources: ['web'], findings: [{ rule: 'R1', label: 'L1' }] }),
    timestamp: T,
  }];
  seedChat(msgs);
  const out = renderChat(msgs);
  for (const needle of [...TAINT_MARKUP, 'PROOF', 'CLAIM AUDIT', 'MUTATION CHECK']) {
    assert.ok(!out.includes(needle), `SSR transcript must NOT contain "${needle}" (taint synthetic message)`);
  }
});

test('A4 SSR: every proof-ish synthetic model renders nothing proof-like', () => {
  const models = ['proof', 'claim-audit', 'mutation-check', 'mutation-gate', 'red-green', 'fake-tests', 'goal-verified', 'critic', 'receipt'];
  const msgs = [
    { id: 'u0', role: 'user', kind: 'text', content: 'normal turn', timestamp: T },
    { id: 'a0', role: 'assistant', kind: 'text', content: 'normal prose here', timestamp: T + 1 },
    ...models.map((m, i) => ({
      id: `p${i}`, role: 'assistant', kind: 'text', model: m,
      content: JSON.stringify({ verdict: 'PASS', gates: ['verify'] }), timestamp: T + i + 2,
    })),
  ];
  seedChat(msgs);
  const out = renderChat(msgs);
  assert.ok(out.includes('normal prose here'), 'ordinary assistant text still renders');
  const markers = [
    'CLAIM AUDIT', 'MUTATION CHECK', 'MUTATION GATE', 'RED→GREEN', 'FAKE-TEST',
    'PROVEN', 're-verify:', 'gates · fingerprints', 'sc-proof', 'sc-claim', 'sc-mutation',
    'PROOF', 'CRITIC', 'GOAL VERIFIED',
  ];
  for (const needle of markers) {
    assert.ok(!out.includes(needle), `proof-ish synthetic rows must render no "${needle}"`);
  }
});

// ============================================================
// B — PROOFRIBBON: one enabled button, real onClick, no ledger
// ============================================================
test('B1 source: exactly one small PROOF button, NOT disabled, WITH onClick', () => {
  assert.equal((ribbonCode.match(/<button\b/g) || []).length, 1,
    `${P.ribbon}: exactly ONE button in the component`);
  const block = (ribbonCode.match(/<button\b[\s\S]*?>/) || [''])[0];
  assert.ok(block.includes('data-testid="proof-toggle"'),
    `${at(P.ribbon, RIBBON, 'data-testid="proof-toggle"')}: proof-toggle hook present`);
  assert.ok(block.includes('pr-proof-toggle'), `${P.ribbon}: small control class on the button`);
  assert.ok(/\bonClick\s*=/.test(block),
    `${at(P.ribbon, RIBBON, '<button')}: button has a REAL onClick handler`);
  assert.ok(!/\bdisabled\b/.test(block),
    `${at(P.ribbon, RIBBON, 'disabled')}: button must NOT be disabled (founder: "بكبس عليه بتظهر لي الأشياء")`);
  assert.ok(ribbonCode.includes('if (!proofVisible) return null;'),
    `${at(P.ribbon, RIBBON, 'if (!proofVisible) return null;')}: plain chat renders no proof at all`);
});

test('B2 source: onClick really writes to clipboard + emits store notify', () => {
  assert.ok(/navigator\.clipboard/.test(ribbonCode) && /writeText\s*\(/.test(ribbonCode),
    `${at(P.ribbon, RIBBON, 'navigator.clipboard')}: a real clipboard write is wired`);
  assert.ok(/notify\s*\(/.test(ribbonCode),
    `${at(P.ribbon, RIBBON, 'notify(')}: a real store notify is wired`);
  for (const gone of ['pr-pop', 'pr-tally', 'pr-kind', 'pr-check', 'role="dialog"', '{open &&', 'toggleOpen(', 'copyEvidence(']) {
    assert.ok(!ribbonCode.includes(gone), `${at(P.ribbon, RIBBON, gone)}: proof ${gone} section removed`);
  }
});

test('B3 SSR with proof evidence: one ENABLED button, no popover / tally / ledger', () => {
  seedProof(true, () => {});
  const html = renderRibbon();
  assert.equal((html.match(/<button\b/g) || []).length, 1, 'SSR renders exactly one button');
  assert.match(html, /data-testid="proof-toggle"/, 'the PROOF button is rendered');
  assert.match(html, /PROOF/, 'the small PROOF label is visible');
  assert.doesNotMatch(html, /\sdisabled(=|\s|>)/, 'the button is NOT disabled in the rendered DOM');
  for (const gone of ['pr-pop', 'pr-tally', 'pr-kind', 'role="dialog"', 'lens-haircard']) {
    assert.ok(!html.includes(gone), `no proof ${gone} markup is mounted`);
  }
});

test('B4 SSR plain chat turn: ZERO proof UI (component returns null)', () => {
  seedProof(false, () => {});
  const html = renderRibbon();
  assert.equal(html.trim(), '', 'a plain chat turn renders NO proof markup at all');
  assert.ok(!html.includes('PROOF') && !html.includes('proof-toggle'), 'no proof button on a plain turn');
});

test('B5 runtime: clicking PROOF writes to clipboard and calls store notify', async () => {
  const writes = [], notes = [];
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async (t) => { writes.push(String(t)); } } },
    configurable: true, writable: true,
  });
  seedProof(true, (m) => notes.push(m));
  captured.length = 0;
  renderRibbon();
  const btn = captured.find((e) => e.props && e.props['data-testid'] === 'proof-toggle');
  assert.ok(btn, `${at(P.ribbon, RIBBON, 'data-testid="proof-toggle"')}: no proof button element was created`);
  const handler = btn && btn.props.onClick;
  assert.equal(typeof handler, 'function',
    `${at(P.ribbon, RIBBON, 'disabled')}: the PROOF button has no real onClick handler`);
  const oldErr = console.error; console.error = () => {};
  try {
    await Promise.resolve(handler({ preventDefault() {}, stopPropagation() {} }));
    await new Promise((r) => setImmediate(r));
  } finally { console.error = oldErr; }
  assert.ok(writes.length > 0,
    `${at(P.ribbon, RIBBON, 'clipboard')}: click did NOT write anything to the clipboard`);
  assert.ok(notes.length > 0,
    `${at(P.ribbon, RIBBON, 'notify')}: click did NOT call the store notify action`);
});

// ============================================================
// C — CONTEXTLENS: always-on compact orb, exact math, clamped popover
// ============================================================
test('C1 source: no `!hasData` visibility gate — orb is permanent', () => {
  assert.doesNotMatch(LENS, /if\s*\(\s*!hasData\s*\)\s*return null/,
    `${P.lens}: the fresh-session visibility gate must be gone`);
  assert.match(LENS, /const noData = !hasData/,
    `${at(P.lens, LENS, 'const noData = !hasData')}: hasData now only drives the honest centre label`);
});

test('C2 SSR zero usage: compact orb mounted, honest dash, empty 2πr arc', () => {
  seedLens(null, 0);
  const html = renderLens();
  assert.match(html, /^<div class="ctx-orb-anchor ctx-orb-anchor--compact relative shrink-0">/,
    'the positioned anchor is the first painted node (not an empty render)');
  assert.match(html, /<button class="ctx-orb ctx-orb--compact"/, 'the orb is beside the mic');
  assert.match(html, /aria-expanded="false"/, 'closed at startup');
  assert.equal((html.match(/class="ctx-orb-arc"/g) || []).length, 1, 'exactly one arc ring');
  assert.equal((html.match(/<svg\b/g) || []).length, 1, 'exactly one orb svg');
  assert.ok(html.includes('>—</span>'), 'centre is the honest em-dash, not a fake "0%"');
  assert.doesNotMatch(html, />0%<\/span>/, 'no misleading "0%"');
  assert.match(html, /window size unknown/, 'tip honestly reports the unknown window');
  const { arc, circumference, r } = arcInfo(html);
  assert.ok(close(r, COMPACT_RADIUS), 'radius = compact 2πr radius');
  assert.ok(close(circumference, 2 * Math.PI * r), 'dasharray total = 2πr');
  assert.equal(arc, 0, 'no data paints a zero-length arc');
});

test('C3 SSR real usage: exact, unrounded arc math (25% and 50%)', () => {
  for (const [fill, win, pct] of [[50_000, 100_000, 50], [12_500, 50_000, 25]]) {
    seedLens({ inputTokens: fill, outputTokens: 0, costUsd: 0 }, win);
    const html = renderLens();
    const { arc, circumference, r } = arcInfo(html);
    assert.ok(close(r, COMPACT_RADIUS), 'compact radius unchanged');
    assert.ok(close(circumference, 2 * Math.PI * r), 'dasharray total = 2πr');
    assert.ok(close(arc, (pct / 100) * (2 * Math.PI * r)), `${pct}% arc = exact ${pct}/100 · 2πr`);
    assert.ok(html.includes(`>${pct}%</span>`), `centre prints ${pct}%`);
  }
  assert.match(LENS, /orbArcLength\(pctExact, RADIUS\)/,
    `${at(P.lens, LENS, 'orbArcLength(pctExact, RADIUS)')}: arc driven by raw pctExact`);
});

test('C4 one mount beside the mic; no header / status-bar duplicate, no strip', () => {
  const micAt = COMPOSER.indexOf('<VoiceInput'), orbAt = COMPOSER.indexOf('<ContextLens');
  assert.ok(micAt >= 0 && orbAt > micAt, 'orb mounted right after the voice mic');
  assert.equal((COMPOSER.match(/<ContextLens\b/g) || []).length, 1, 'one orb in the composer');
  assert.doesNotMatch(CHAT_PANEL, /<ContextLens/, 'no chat-header duplicate');
  assert.doesNotMatch(STATUS_BAR, /<ContextRingButton\s*\/>/, 'no status-bar duplicate');
  const STRIP = /ctx-meter|ctx-track|ctx-fill|ctx-strip/i;
  assert.doesNotMatch(COMPOSER, STRIP, 'no strip in composer');
  assert.doesNotMatch(LENS, STRIP, 'no strip in ContextLens');
  assert.doesNotMatch(ORB_CSS, STRIP, 'no strip in owned CSS');
});

test('C5 popover is FIXED and viewport-clamped; guards intact', () => {
  assert.match(LENS, /useLayoutEffect/,
    `${at(P.lens, LENS, 'useLayoutEffect')}: position measured after layout`);
  assert.match(LENS, /getBoundingClientRect/,
    `${at(P.lens, LENS, 'getBoundingClientRect')}: card pinned to the real orb box`);
  assert.match(LENS, /position:\s*'fixed'/,
    `${at(P.lens, LENS, "position: 'fixed'")}: card escapes Composer clipping`);
  assert.match(LENS, /window\.innerWidth[\s\S]*window\.innerHeight/,
    `${P.lens}: clamped against BOTH viewport axes`);
  assert.match(LENS, /Math\.max\(12,\s*Math\.min\(left,\s*window\.innerWidth - width - 12\)\)/,
    `${at(P.lens, LENS, 'Math.max(12, Math.min(left')}: left edge stays 12px inside the viewport`);
  assert.match(LENS, /Math\.max\(12,\s*top\)/,
    `${at(P.lens, LENS, 'Math.max(12, top)')}: top edge never goes above the viewport`);
  assert.match(ORB_CSS, /@media \(prefers-reduced-motion: reduce\)/, 'OS reduced-motion guard');
  assert.match(ORB_CSS, /html\.reduce-motion \.ctx-orb/, 'in-app reduced-motion guard');
});
