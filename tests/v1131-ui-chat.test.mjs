// ============================================================
// v11.31 — UI CHAT PANEL / COMPOSER / CONTEXT / STREAM AUDIT.
//
// Owns only the four chat UI components. Locks in the precision/correctness
// fixes made by the UI capability agent:
//   • ContextLens popover: the inline FIXED placement cancels the stylesheet's
//     compact `bottom: calc(100% + 8px)` / `inset-inline-end: 0` so the card
//     can never collapse or land off-screen ("orb hidden / off-position").
//   • ChatPanel: dead `streamTailLive` subscription removed; malformed content
//     read defensively; both run strips share ONE per-phase ledger.
//   • Composer: the obsolete straight context meter (dead subscriptions +
//     dead fill/pct/tonal math) is gone; send feedback is reduced-motion aware;
//     the dead `.cp-send-pulse` node is removed.
//   • StreamTimeline: the single THINK circle keeps 1px token strokes + 2.2s
//     cadence; no boxed art; no proof/taint/report row re-introduction.
//
//   node --test --test-force-exit tests/v1131-ui-chat.test.mjs
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
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const P = {
  chat: 'src/components/ChatPanel.tsx',
  comp: 'src/components/Composer.tsx',
  lens: 'src/components/ContextLens.tsx',
  stream: 'src/components/StreamTimeline.tsx',
};
const SRC = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, read(v)]));
const stripComments = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');
const CODE = Object.fromEntries(Object.entries(SRC).map(([k, v]) => [k, stripComments(v)]));

// ---------------------------------------------------------------------
// SSR harness (mirrors tests/v1127-ui-guard.test.mjs).
// ---------------------------------------------------------------------
const BUNDLE = join(ROOT, 'tests', '.v1131-ui-chat.bundle.cjs');
let mod, React, renderToStaticMarkup;

before(() => {
  globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    setTimeout: () => 1, clearTimeout() {},
    innerWidth: 1280, innerHeight: 800,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {} }),
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  esbuild.buildSync({
    stdin: {
      contents:
        "export { ChatPanel } from './src/components/ChatPanel';" +
        "export { Composer } from './src/components/Composer';" +
        "export { ContextLens, ORB_RADIUS, orbArcLength } from './src/components/ContextLens';" +
        "export { useStore } from './src/store';",
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLE,
    loader: { '.css': 'empty' },
    external: ['electron', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/server', 'zustand', 'lucide-react',
      '@xterm/xterm', '@xterm/addon-fit', 'monaco-editor', '@monaco-editor/react'],
  });
  mod = require(BUNDLE);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect; // SSR silence
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  try { unlinkSync(BUNDLE); } catch { /* gone */ }
});

const h = (...a) => React.createElement(...a);
const T = 1700000000000;
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

function seed({ running = false, messages = [] } = {}) {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    wsPath: ROOT, running,
    settings: { ...prev.settings, language: 'en', numerals: 'western', model: { provider: 'custom', model: 'm' } },
    session: {
      id: 's1', title: 't', workspace: ROOT, messages, createdAt: T, updatedAt: T,
      messageCount: messages.length, totalTokens: 0, totalCostUsd: 0,
    },
    pendingApproval: null, capabilityPanel: null, continueHint: null,
    sessionUsage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    lastTurnUsage: null, ctxWindow: 200000, liveStreamChars: 0,
    proof: { status: 'unproven', gates: [], updatedAt: 0 },
  });
}

// ============================================================
// 1 · SOURCE CONTRACTS
// ============================================================
test('source: ContextLens fixed popover cancels the CSS compact insets', () => {
  const lens = CODE.lens;
  assert.match(lens, /position:\s*'fixed'/, 'card escapes composer clipping with fixed positioning');
  assert.match(lens, /bottom:\s*'auto'/, 'header-era CSS bottom inset is cancelled');
  assert.match(lens, /insetInlineEnd:\s*'auto'/, 'RTL inline-end inset is cancelled');
  assert.match(lens, /right:\s*'auto'/, 'physical right inset is cancelled');
  assert.match(lens, /getBoundingClientRect/, 'card is measured from the real orb box');
  assert.match(lens, /copiedTimerRef/, 'one-shot copied reset is cleaned up on unmount');
});

test('source: ChatPanel dead stream-tail selector removed; content read defensively', () => {
  assert.doesNotMatch(CODE.chat, /streamTailLive/, 'no dead subscription remains');
  assert.ok(CODE.chat.includes('msgText(m).length'), 'streaming delta length read through the guard');
  assert.doesNotMatch(CODE.chat, /m\.content\.length/, 'no raw content.length deref on IPC rows');
  assert.doesNotMatch(SRC.chat, /toolIcon|parseToolArgs/, 'unused MessageView helpers not imported');
  assert.match(CODE.chat, /if \(counted === 0\) acc\.think\.active = 1/, 'empty run seeds a THINK-active ledger');
  assert.match(CODE.chat, /className="phase-strip run-strip-v13 anim-in shrink-0"/, 'run strip class intact');
});

test('source: Composer dead meter gone; send feedback is reduced-motion aware', () => {
  const comp = CODE.comp;
  for (const dead of ['sessionUsage', 'sessionId', 'ctxPctShown', 'ctxTone', 'ctxFillShown', 'cp-send-pulse']) {
    assert.ok(!comp.includes(dead), `dead composer artifact "${dead}" removed`);
  }
  assert.match(comp, /sendingReduced/, 'send feedback checks motion preference');
  assert.match(comp, /sendingReduced \? '' : ' animate-pulse'/, 'pulse suppressed under reduced motion');
  assert.match(comp, /const activeSet: Record<StreamPhase, boolean>/, 'per-phase active ledger (matches chat strip)');
  assert.match(comp, /if \(counted === 0\) activeSet\.think = true/, 'empty run seeds 1/5');
  assert.match(comp, /data-testid="composer-stop"/, 'stop hook intact');
  assert.match(comp, /void abortAgent\(\)/, 'stop aborts the real run');
});

test('source: single 2.2s THINK circle, 1px token strokes, no boxed art', () => {
  const stream = CODE.stream;
  assert.equal((stream.match(/dur="2\.2s"/g) || []).length, 1, 'exactly one 2.2s orbit cadence');
  assert.match(stream, /strokeWidth="1"/, '1px currentColor strokes');
  assert.match(stream, /border: 'none'/, 'THINK node box neutralised (no boxed art)');
  assert.match(SRC.chat, /dur="2\.2s"/, 'run-strip orbit uses the same 2.2s cadence');
});

test('source: no report card / taint / proof panel re-introduction in owned files', () => {
  const joined = Object.values(SRC).join('\n');
  for (const needle of ['TaskReportCard', 'TaintRow', 'sc-taint', 'pr-pop', 'pr-tally', 'RUN REPORT', 'sc-report-quiet']) {
    assert.ok(!joined.includes(needle), `no "${needle}" in any owned chat file`);
  }
});

// ============================================================
// 2 · SSR
// ============================================================
test('SSR: compact context orb is always mounted, exact 2πr arc at 50%', () => {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    lastTurnUsage: { inputTokens: 100000, outputTokens: 0, costUsd: 0 },
    ctxWindow: 200000, liveStreamChars: 0, running: false,
    settings: { ...prev.settings, language: 'en' },
  });
  const html = renderToStaticMarkup(h(mod.ContextLens, { compact: true }));
  assert.match(html, /class="ctx-orb ctx-orb--compact"/, 'compact orb beside the mic');
  assert.equal((html.match(/class="ctx-orb-arc"/g) || []).length, 1, 'exactly one arc');
  const el = html.match(/<circle[^>]*class="ctx-orb-arc"[^>]*>/)[0];
  const arc = Number(el.match(/stroke-dasharray="([\d.eE+-]+)/)[1]);
  const r = Number(el.match(/\sr="([\d.eE+-]+)"/)[1]);
  assert.ok(close(r, (22 - 3.5) / 2), 'compact radius exact');
  assert.ok(close(arc, Math.PI * r), '50% arc = πr');

  mod.useStore.setState({ lastTurnUsage: null });
  const zero = renderToStaticMarkup(h(mod.ContextLens, { compact: true }));
  assert.ok(zero.includes('>—</span>'), 'fresh session prints an honest em-dash');
});

test('SSR: both run strips render while running and agree on the empty run (1/5)', () => {
  seed({ running: true, messages: [] });
  const chat = renderToStaticMarkup(h(mod.ChatPanel));
  const deck = renderToStaticMarkup(h(mod.Composer));
  assert.ok(chat.includes('phase-strip run-strip-v13'), 'chat run strip mounted');
  assert.ok(chat.includes('sc-status-label'), 'stable status label present');
  assert.ok(chat.includes('sc-status-clock'), 'elapsed clock present');
  assert.ok(chat.includes('ps-step is-active'), 'THINK dot active in the chat strip');
  assert.ok(deck.includes('cf-run-progress'), 'composer progress strip mounted');
  assert.ok(deck.includes('data-testid="composer-stop"'), 'stop visible while running');
  assert.ok(deck.includes('1/5'), 'both strips show one active phase of five');
});

test('SSR: all run chrome disappears when idle; plain turn renders no proof/taint/report', () => {
  seed({ running: false, messages: [{ id: 'u1', role: 'user', kind: 'text', content: 'hi', timestamp: T }] });
  const chat = renderToStaticMarkup(h(mod.ChatPanel));
  const deck = renderToStaticMarkup(h(mod.Composer));
  assert.doesNotMatch(chat, /phase-strip run-strip-v13/, 'no run strip while idle');
  assert.doesNotMatch(deck, /cf-run-progress/, 'no progress strip while idle');
  assert.doesNotMatch(deck, /data-testid="composer-stop"/, 'no stop while idle');
  for (const needle of ['TaintRow', 'TaskReportCard', 'RUN REPORT', 'pr-pop']) {
    assert.ok(!chat.includes(needle) && !deck.includes(needle), `no "${needle}" in idle SSR`);
  }
});
