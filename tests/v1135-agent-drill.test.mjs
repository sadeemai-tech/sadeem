// ============================================================================
// v11.35 — AGENT SESSION DRILL-DOWN (A5)
// ----------------------------------------------------------------------------
// The founder's ask: "clicking the agent card should DRILL INTO that agent's
// own session (session-within-session), like OpenCode — showing what that agent
// is doing step by step." This suite proves, with the real components + the
// real zustand store, that:
//
//   1. the inline agent card is a REAL keyboard-accessible entry (a labelled
//      <button> with a live onClick, plus one named link per specialist) that
//      opens the agent's detail view — no dead/disabled drill control;
//   2. the detail view renders the REAL transcript SHAPE that actually exists
//      (record prompt + status + progress-step timeline + summary/error),
//      live while running, with a working "back to team" control;
//   3. NO fabricated content — no invented tool names, args or outputs; the
//      orbital rail has exactly one tick per RECORDED step;
//   4. bilingual + RTL — EN and AR labels are single-language, logical CSS,
//      mirrored arrow, both reduced-motion gates, zero hardcoded hex.
//
// Harness: esbuild TS→CJS bundle + renderToStaticMarkup + jsx-runtime capture
// (same posture as tests/v1127-ui-guard.test.mjs). No jsdom needed.
//
//   node --test --test-force-exit tests/v1135-agent-drill.test.mjs
// ============================================================================
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
  card: 'src/components/AgentTeamCard.tsx',
  modal: 'src/components/SubagentDetailModal.tsx',
  css: 'src/components/subagents.css',
};
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const CARD_SRC = read(P.card);
const MODAL_SRC = read(P.modal);
const CSS_SRC = read(P.css);
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');
const cardCode = strip(CARD_SRC), modalCode = strip(MODAL_SRC);

function lineOf(src, needle) {
  const i = src.indexOf(needle);
  if (i < 0) return 0;
  let line = 1;
  for (let k = 0; k < i; k++) if (src.charCodeAt(k) === 10) line++;
  return line;
}
const at = (p, src, needle) => `${p}:${lineOf(src, needle) || '?'}`;

const BUNDLE = join(ROOT, 'tests', '.v1135-agent-drill.bundle.cjs');
let mod, React, renderToStaticMarkup;
const captured = [];

const T = 1700000000000;
const RECORD = {
  id: 'sub-drill-1',
  label: 'Explore auth',
  role: 'explore',
  description: 'Inspect auth flow',
  prompt: 'inspect auth flow and report call sites',
  status: 'running',
  done: 2,
  total: 3,
  startedAt: T,
  workspace: '/ws',
  sessionId: 'sess-1',
  background: false,
  attempt: 1,
};
const STEPS = [
  { at: T, done: 1, total: 3 },
  { at: T + 1000, done: 2, total: 3 },
];

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
        "export { AgentTeamCard } from './src/components/AgentTeamCard';" +
        "export { SubagentDetailModal } from './src/components/SubagentDetailModal';",
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
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;

  const jr = require('react/jsx-runtime');
  const origJsx = jr.jsx, origJsxs = jr.jsxs;
  jr.jsx = (...args) => { captured.push({ type: args[0], props: args[1] }); return origJsx(...args); };
  jr.jsxs = (...args) => { captured.push({ type: args[0], props: args[1] }); return origJsxs(...args); };
});

after(() => {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

function seed(lang = 'en', extra = {}) {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    settings: {
      ...prev.settings, language: lang, numerals: 'western',
      model: { provider: 'custom', model: 'm' },
    },
    subagents: [RECORD],
    subagentSteps: { [RECORD.id]: STEPS },
    subagentDetailId: null,
    ...extra,
  });
}
function seedTasks() {
  const task = {
    id: 'task-1', role: 'assistant', kind: 'tool_call', toolName: 'task',
    toolCallId: 'tc-1', timestamp: T,
    content: JSON.stringify({ agent: 'explore', description: 'Inspect auth flow', prompt: RECORD.prompt }),
  };
  const result = {
    id: 'res-1', role: 'tool', kind: 'tool_result', toolName: 'task',
    toolCallId: 'tc-1', resultOk: true, timestamp: T + 2000,
    content: 'Found 2 call sites',
  };
  return { tasks: [task], resultById: new Map([['tc-1', result]]) };
}
const renderCard = (lang = 'en') => renderToStaticMarkup(React.createElement(mod.AgentTeamCard, seedTasks()));
const renderModal = () => renderToStaticMarkup(React.createElement(mod.SubagentDetailModal));
const byTestId = (id) => captured.find((e) => e.props && e.props['data-testid'] === id);

// ============================================================
// 1 · SOURCE — the card is a real, live entry (no dead button)
// ============================================================
test('1 · card source: labelled button + live onClick opens the detail; orbit preserved', () => {
  for (const needle of [
    'function orbitGeometry', 'Math.sin(Math.PI / count)', 'const theta = -Math.PI / 2',
    'agt-stage', 'agt-orbit-track', 'agt-orbit-sweep', 'agt-orbit-hub',
  ]) assert.ok(CARD_SRC.includes(needle), `orbital grammar preserved: ${needle} (${at(P.card, CARD_SRC, needle)})`);
  assert.ok(!/agt-grid|agent-grid/.test(CARD_SRC), 'no boxy agent grid');

  const btnAt = at(P.card, CARD_SRC, 'data-testid="agt-open-session"');
  assert.ok(cardCode.includes('data-testid="agt-open-session"'), `drill button exists (${btnAt})`);
  assert.match(cardCode, /<button[\s\S]{0,400}data-testid="agt-open-session"[\s\S]{0,400}onClick=\{\(\) => openSubagentDetail/,
    `${btnAt}: the drill button has a REAL onClick that opens the agent detail`);
  assert.ok(cardCode.includes('aria-label={`${openLabel} · ${focus.visual.name}`}'),
    `${at(P.card, CARD_SRC, 'aria-label={`${openLabel}')}: the entry is labelled`);
  assert.ok(cardCode.includes('agt-legend-item is-link'), 'named specialist rows are clickable too');
  assert.ok(cardCode.includes('data-testid="agt-agent-link"'), 'per-agent link is testable');
  // The header control is never rendered disabled — no dead button.
  const drillBlock = cardCode.slice(cardCode.indexOf('data-testid="agt-open-session"') - 300, cardCode.indexOf('data-testid="agt-open-session"') + 600);
  assert.ok(!/\bdisabled\b/.test(drillBlock), 'the drill button is never disabled');
});

// ============================================================
// 2 · SSR CARD — EN entry renders, and clicking REALLY drills in
// ============================================================
test('2 · SSR card: enabled, labelled button; clicking drills into that agent session', () => {
  seed('en');
  captured.length = 0;
  const html = renderCard();
  assert.match(html, /data-testid="agt-card"/, 'the card root is mounted');
  assert.match(html, /<button[^>]*data-testid="agt-open-session"/, 'the entry is a real <button>');
  assert.match(html, /data-record-id="sub-drill-1"/, 'the entry carries the ledger id of the focus agent');
  assert.match(html, /aria-label="Open · Codebase Explorer"/, 'a single-language accessible label');
  assert.doesNotMatch(html, /\sdisabled(=|\s|>)/, 'the drill control is enabled');
  assert.match(html, /class="agt-orbit-track"/, 'the orbital hairline survives in the DOM');

  const drill = byTestId('agt-open-session');
  assert.ok(drill && typeof drill.props.onClick === 'function', 'drill button has an onClick handler');
  mod.useStore.setState({ subagentDetailId: null });
  drill.props.onClick();
  assert.equal(mod.useStore.getState().subagentDetailId, RECORD.id,
    'click sets the store detail id — the card truly opens the agent session');

  const link = byTestId('agt-agent-link');
  assert.ok(link && typeof link.props.onClick === 'function', 'named agent link has an onClick handler');
  mod.useStore.setState({ subagentDetailId: null });
  link.props.onClick();
  assert.equal(mod.useStore.getState().subagentDetailId, RECORD.id, 'the named specialist link drills into the same session');
});

// ============================================================
// 3 · SSR MODAL — the REAL transcript shape (no invented feed)
// ============================================================
test('3 · detail view renders real data: prompt, status, step timeline, output, way back', () => {
  seed('en', { subagentDetailId: RECORD.id });
  const html = renderModal();
  assert.match(html, /role="dialog"/, 'focused session view is a dialog');
  assert.match(html, /data-testid="sad-modal"/, 'the detail surface is mounted');

  // task/prompt — the VERBATIM delegated prompt from the ledger.
  assert.match(html, /data-testid="sad-prompt"/, 'prompt section exists');
  assert.ok(html.includes(RECORD.prompt), 'the REAL prompt text is rendered');
  assert.ok(html.includes('Inspect auth flow'), 'the real description is rendered');
  // status — real SubagentRecord.status, single-language label.
  assert.match(html, /class="sad-status is-running">RUNNING/, 'real running status is shown');
  // step-by-step — only the recorded {at, done, total} progress events.
  assert.match(html, /data-testid="sad-timeline"/, 'timeline section exists');
  for (const s of STEPS) assert.ok(html.includes(`Step ${s.done} of ${s.total}`), `real step ${s.done}/${s.total} is rendered`);
  assert.ok(html.includes('Waiting for the next step'), 'live tail is shown while running');
  assert.match(html, /data-testid="sad-output"/, 'output section exists');
  assert.ok(html.includes('still running'), 'honest pending output — no invented result while running');
  // duration / steps / progress counters are all REAL record fields.
  assert.ok(html.includes('DURATION') && html.includes('STEPS') && html.includes('PROGRESS'), 'real counters surfaced');
  // way back — a real labelled control wired to close.
  assert.match(html, /<button[^>]*data-testid="sad-back"/, 'a back control is mounted');
  assert.ok(html.includes('AGENT TEAM'), 'the back control is labelled with the parent view');
  const back = byTestId('sad-back');
  assert.ok(back && typeof back.props.onClick === 'function', 'back has a real onClick');
  mod.useStore.setState({ subagentDetailId: null });
  back.props.onClick();
  assert.equal(mod.useStore.getState().subagentDetailId, null, 'back returns to the parent team view');
});

test('3b · orbital rail has exactly one tick per real step (no fabricated tool calls)', () => {
  seed('en', { subagentDetailId: RECORD.id });
  const html = renderModal();
  const ticks = (html.match(/class="sad-orbit-tick"/g) || []).length;
  assert.equal(ticks, STEPS.length, `rail draws ${STEPS.length} ticks — one per RECORDED step`);
  assert.equal((html.match(/class="sad-orbit-head"/g) || []).length, 1, 'one breathing head at the real done/total position');
  // Nothing anywhere invents a tool name, args or output for the subagent.
  const fabricated = ['read_file', 'edit_file', 'run_command', 'tool_call', 'mockTool', 'fake tool', 'Called tool'];
  for (const word of fabricated) {
    assert.ok(!MODAL_SRC.includes(word), `${at(P.modal, MODAL_SRC, word)}: no fabricated "${word}" in the detail source`);
    assert.ok(!html.includes(word), `SSR detail must not contain fabricated "${word}"`);
  }
  assert.ok(!/toolCalls?\.map\s*\(/.test(modalCode), 'the detail view does not fabricate a tool-call feed');
  // The rail uses real counters, never literal positioning values.
  assert.ok(modalCode.includes('lastStep.done / lastStep.total'), 'head position comes from real done/total');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(CSS_SRC), `${P.css}: zero hardcoded hex colours`);
});

test('3c · finished agent renders the REAL summary (output arrives on completion)', () => {
  seed('en', {
    subagentDetailId: RECORD.id,
    subagents: [{ ...RECORD, status: 'done', summary: 'Found 2 call sites', endedAt: T + 2000 }],
  });
  const html = renderModal();
  assert.match(html, /class="sad-status is-done">DONE/, 'real done status');
  assert.ok(html.includes('Found 2 call sites'), 'the REAL summary is the output');
  assert.ok(!html.includes('still running'), 'no stale pending placeholder once done');
});

test('3d · when the engine step label survives IPC it is shown verbatim (no invention)', () => {
  seed('en', {
    subagentDetailId: RECORD.id,
    subagentSteps: { [RECORD.id]: [{ at: T, done: 1, total: 3, step: 'read_file src/app.ts' }] },
  });
  const html = renderModal();
  assert.ok(html.includes('Step 1 of 3 · read_file src/app.ts'),
    'the REAL step label from subagent_progress.step is consumed as soon as the store keeps it');
  assert.equal((html.match(/class="sad-orbit-tick"/g) || []).length, 1, 'rail still tracks recorded steps only');
});

// ============================================================
// 4 · BILINGUAL + RTL — one language at a time, mirrored + guarded
// ============================================================
test('4 · Arabic UI: single-language Arabic labels on card and detail', () => {
  seed('ar');
  const card = renderCard();
  assert.ok(card.includes('فريق الوكلاء'), 'card head is Arabic (sa.team)');
  assert.ok(card.includes('فتح'), 'drill control is Arabic (sa.openDetail)');
  assert.ok(card.includes('مخرجات'), 'outputs drawer is Arabic (sa.outputs)');
  assert.ok(!card.includes('AGENT TEAM') && !card.includes('>Open<'), 'no English fallback leaks into the AR card');
  assert.match(card, /aria-label="فتح ·/, 'the accessible entry label is Arabic too');

  seed('ar', { subagentDetailId: RECORD.id });
  const modal = renderModal();
  assert.ok(modal.includes('تفاصيل الوكيل الفرعي') || modal.includes('وكيل فرعي / تفاصيل'), 'detail eyebrow is Arabic');
  assert.ok(modal.includes('الخطوة 1 من 3'), 'real step label is Arabic (sad.step)');
  assert.ok(modal.includes('قيد التشغيل'), 'status label is Arabic');
  assert.ok(modal.includes('فريق الوكلاء'), 'back label is Arabic');
  assert.ok(!modal.includes('Step 1 of 3') && !modal.includes('AGENT TEAM'), 'no English label fallback leaks into AR detail');
  // Real user/engine data stays verbatim (dir=auto); mono tokens are isolated.
  assert.match(modal, /dir="auto"/, 'untrusted transcript text keeps dir=auto');
  assert.match(modal, /dir="ltr"/, 'mono tokens stay LTR-isolated');
});

test('4b · CSS law: logical properties, RTL mirror, both motion gates, animations kept', () => {
  for (const needle of ['inset-inline-start', 'margin-block-end', "html[dir='rtl']", 'scaleX(-1)']) {
    assert.ok(CSS_SRC.includes(needle), `RTL/logical grammar present: ${needle}`);
  }
  assert.ok(!/(margin|padding|inset|border)-(left|right)\s*:/.test(CSS_SRC.slice(CSS_SRC.indexOf('v11.35'))),
    'the v11.35 section uses no physical side properties');
  assert.ok(CSS_SRC.includes('@media (prefers-reduced-motion: reduce)'), 'OS reduced-motion guard');
  assert.ok(CSS_SRC.includes('html.reduce-motion .sad-orbit-head'), 'in-app reduced-motion guard on the live head');
  for (const kf of ['agt-orbit-spin', 'agt-breathe', 'sad-tick-in', 'agt-node-in']) {
    assert.ok(CSS_SRC.includes(`@keyframes ${kf}`), `signature animation preserved: ${kf}`);
  }
});
