// ============================================================================
// v11.36 — CHILD SESSION (جلسة جوا الجلسة): real tool-call transcript
// ----------------------------------------------------------------------------
// Proves, with the REAL components + the REAL zustand store + the REAL engine
// ledger module, that clicking an agent card lands inside a child session that
// shows what the agent ACTUALLY did:
//
//   1. SOURCE: the record carries a real `toolCalls` array; the engine emits a
//      NEW `toolcall` event from REAL observed calls; the store ACCUMULATES it;
//   2. ENGINE: `toolCallsFromStep` parses the engine's OWN step label and never
//      invents a name/input/status for labels that are not tool calls;
//   3. STORE: a real `subagents:toolcall` event appends/updates a row, pairing
//      start→result by toolCallId (real output/status land on the same row);
//   4. SSR: the modal renders each REAL row (name/input/status/output), the
//      parent-session breadcrumb NAVIGATES via `sessionId`, and NO fabricated
//      tool name appears when it was never in an event.
//
// Harness: esbuild TS→CJS + renderToStaticMarkup + jsx-runtime capture
// (same posture as tests/v1135-agent-drill.test.mjs). No jsdom, no network.
//
//   node --test --test-force-exit tests/v1136-child-session.test.mjs
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
const Module = require('node:module');

const P = {
  types: 'shared/types.ts',
  engine: 'electron/agent/subagents.ts',
  store: 'src/store.ts',
  modal: 'src/components/SubagentDetailModal.tsx',
  card: 'src/components/AgentTeamCard.tsx',
  css: 'src/components/subagents.css',
  sessionCss: 'src/components/agentSession.css',
};
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const SRC = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, read(p)]));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');
const clean = Object.fromEntries(Object.entries(SRC).map(([k, v]) => [k, strip(v)]));

function lineOf(src, needle) {
  const i = src.indexOf(needle);
  if (i < 0) return 0;
  let line = 1;
  for (let k = 0; k < i; k++) if (src.charCodeAt(k) === 10) line++;
  return line;
}
const at = (p, src, needle) => `${p}:${lineOf(src, needle) || '?'}`;

const BUNDLE = join(ROOT, 'tests', '.v1136-child-session.bundle.cjs');
const ENGINE_BUNDLE = join(ROOT, 'tests', '.v1136-engine.bundle.cjs');
let mod, engineMod, React, renderToStaticMarkup;
const captured = [];
let subagentsEventCb = null;
let agentEventCb = null;

const T = 1700000000000;
const RECORD = {
  id: 'sub-child-1',
  label: 'Explore auth',
  role: 'explore',
  description: 'Inspect auth flow',
  prompt: 'inspect auth flow and report call sites',
  status: 'running',
  done: 2,
  total: 4,
  startedAt: T,
  workspace: '/ws',
  sessionId: 'main-session-42', // the REAL parent link
  background: false,
  attempt: 1,
};
/** Fixture shaped exactly like a real `subagent_toolcall` event payload. */
const REAL_CALLS = [
  { toolCallId: 'c1', name: 'read_file', input: '{"path":"src/App.tsx"}', status: 'done', output: 'export default function App() {}', at: T + 100 },
  { toolCallId: 'c2', name: 'run_command', input: '{"cmd":"npm test"}', status: 'error', output: 'FAIL: 1 test failed', at: T + 900 },
];

before(async () => {
  // A bridge that captures the two live event subscriptions so the test can
  // push a REAL-shaped engine event through the actual store handler.
  const bridge = new Proxy({}, {
    get(_t, k) {
      if (k === 'then' || k === 'toJSON' || typeof k === 'symbol') return undefined;
      if (k === 'onSubagentsEvent') return (cb) => { subagentsEventCb = cb; return () => {}; };
      if (k === 'onAgentEvent') return (cb) => { agentEventCb = cb; return () => {}; };
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
        "export { useStore, mergeSubagentToolCalls } from './src/store';" +
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
  // Real engine ledger module — stub only the Electron host globals.
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: { getPath: () => process.cwd() },
        BrowserWindow: { getAllWindows: () => [] },
        ipcMain: { handle() {} },
      };
    }
    return origLoad.call(this, request, parent, isMain);
  };
  try {
    esbuild.buildSync({
      entryPoints: [join(ROOT, P.engine)],
      bundle: true, platform: 'node', format: 'cjs', outfile: ENGINE_BUNDLE,
      external: ['electron'],
    });
    engineMod = require(ENGINE_BUNDLE);
  } finally {
    Module._load = origLoad;
  }
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
  // Register the store's live IPC subscriptions (async init registers after
  // its first await) so a real-shaped event can be pushed through the handler.
  await mod.useStore.getState().init();
});

/** HTML-escaped SSR markup → original text (for verbatim arg/result asserts). */
const decode = (html) => html
  .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&');

after(() => {
  for (const f of [BUNDLE, ENGINE_BUNDLE]) { try { unlinkSync(f); } catch { /* already gone */ } }
});

function seed(extra = {}) {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    settings: {
      ...prev.settings, language: 'en', numerals: 'western',
      model: { provider: 'custom', model: 'm' },
    },
    subagents: [RECORD],
    subagentSteps: { [RECORD.id]: [{ at: T, done: 1, total: 4 }] },
    subagentToolCalls: { [RECORD.id]: REAL_CALLS },
    subagentDetailId: RECORD.id,
    ...extra,
  });
}
const renderModal = () => renderToStaticMarkup(React.createElement(mod.SubagentDetailModal));
const byTestId = (id) => captured.find((e) => e.props && e.props['data-testid'] === id);

// ============================================================
// 1 · SOURCE — the real data path exists end to end
// ============================================================
test('1 · source: additive toolCalls field, real engine toolcall event, store accumulator', () => {
  const recBlock = (SRC.types.match(/export interface SubagentRecord\s*\{[\s\S]*?\n\}/) || [''])[0];
  assert.match(recBlock, /toolCalls\s*\??\s*:\s*SubagentToolCall\[\]/,
    `${at(P.types, SRC.types, 'toolCalls')}: SubagentRecord carries the real transcript array`);
  assert.match(SRC.types, /interface SubagentToolCall\s*\{/, 'a real tool-call shape is declared');
  for (const f of ['name', 'input', 'output', 'status', 'at']) {
    assert.match(SRC.types.slice(SRC.types.indexOf('interface SubagentToolCall')).slice(0, 900), new RegExp(`\\b${f}\\s*\\??\\s*:`),
      `tool-call shape declares ${f}`);
  }
  // Engine: the NEW event is emitted with a real observed call.
  assert.match(clean.engine, /recordSubagentToolCall/, at(P.engine, SRC.engine, 'recordSubagentToolCall'));
  assert.match(clean.engine, /emit\(['"]toolcall['"]/, 'engine broadcasts the new `toolcall` event');
  assert.match(clean.engine, /toolCallsFromStep/, 'engine derives names from its OWN real step label');
  // Store: event-driven append, not a demo array.
  assert.match(clean.store, /case ['"]subagent_toolcall['"]/, at(P.store, SRC.store, "case 'subagent_toolcall'"));
  assert.match(clean.store, /mergeSubagentToolCalls/, 'store has a pure append/merge helper');
  assert.ok(!/toolCalls\s*:\s*\[\s*\{\s*name\s*:\s*['"]/.test(clean.store), 'no hardcoded demo transcript in the store');
});

// ============================================================
// 2 · ENGINE — parse real step labels; never invent a tool name
// ============================================================
test('2 · engine parses the REAL step label and invents nothing', () => {
  assert.equal(typeof engineMod.toolCallsFromStep, 'function', 'engine exposes the real parser');
  const one = engineMod.toolCallsFromStep('tool:read_file src/App.tsx');
  assert.equal(one.length, 1, 'one tool: label → one call');
  assert.equal(one[0].name, 'read_file', 'the REAL tool name is preserved verbatim');
  assert.equal(one[0].input, 'src/App.tsx', 'the REAL inline argument summary is preserved');
  assert.equal(one[0].status, 'done', 'the observed call is marked executed');
  assert.ok(typeof one[0].at === 'number' && one[0].at > 0, 'a real timestamp is attached');
  const many = engineMod.toolCallsFromStep('tools:read_file,edit_file');
  assert.deepEqual(many.map((c) => c.name), ['read_file', 'edit_file'], 'tools: label → both REAL names');
  for (const noise of ['start', 'done', 'thinking', '', undefined]) {
    assert.deepEqual(engineMod.toolCallsFromStep(noise), [], `non-tool step ${JSON.stringify(noise)} yields NO invented call`);
  }
});

// ============================================================
// 3 · STORE — a real event appends + upgrades a row (start → result)
// ============================================================
test('3 · store appends a real toolcall event and pairs start with result', () => {
  seed({ subagentToolCalls: {}, subagents: [{ ...RECORD, toolCalls: undefined }] });
  const started = { toolCallId: 'c9', name: 'edit_file', status: 'running', at: T + 10 };
  assert.ok(typeof subagentsEventCb === 'function', 'store subscribed to subagents events');
  subagentsEventCb({ type: 'toolcall', id: RECORD.id, call: started });
  let rows = mod.useStore.getState().subagentToolCalls[RECORD.id];
  assert.equal(rows.length, 1, 'one real event → one row');
  assert.equal(rows[0].name, 'edit_file');
  assert.equal(rows[0].status, 'running');
  // The RESULT of the same call arrives with real output — same row, no dupe.
  subagentsEventCb({
    type: 'toolcall', id: RECORD.id,
    call: { ...started, status: 'done', output: 'edited 1 file', input: '{"path":"a.ts"}' },
  });
  rows = mod.useStore.getState().subagentToolCalls[RECORD.id];
  assert.equal(rows.length, 1, 'start/result stay ONE row (dedupe by toolCallId)');
  assert.equal(rows[0].status, 'done', 'the REAL result status landed on that row');
  assert.equal(rows[0].output, 'edited 1 file', 'the REAL output landed on that row');
  assert.equal(mod.useStore.getState().subagents[0].toolCalls?.[0]?.output, 'edited 1 file',
    'the record transcript mirrors the same real row');
});

// ============================================================
// 4 · SSR — the child session renders REAL rows + parent breadcrumb
// ============================================================
test('4 · SSR modal renders every REAL tool call: name / input / status / output', () => {
  seed();
  captured.length = 0;
  const raw = renderModal();
  const html = decode(raw);
  assert.match(raw, /data-testid="sad-modal"/, 'child-session surface is mounted');
  assert.match(raw, /data-testid="sad-toolcalls"/, 'real transcript section exists');
  assert.equal((raw.match(/data-testid="sad-toolcall"/g) || []).length, REAL_CALLS.length,
    'exactly one row per REAL event — no fabricated extras');
  for (const c of REAL_CALLS) {
    assert.ok(html.includes(c.name), `${c.name}: the REAL tool name is rendered`);
    assert.ok(html.includes(c.input), `${c.name}: the REAL input is rendered`);
    assert.ok(html.includes(c.output), `${c.name}: the REAL output is rendered`);
  }
  assert.match(html, /class="jc-status is-done"/, 'real done status row');
  assert.match(html, /class="jc-status is-error"/, 'real error status row');
  assert.ok(html.includes('Done') && html.includes('Error'), 'bilingual status labels are real');
  assert.ok(html.includes(RECORD.prompt), 'the REAL delegated task is shown');
  assert.ok(html.includes(RECORD.description), 'the REAL task description is shown');
});

test('4b · no fabricated content: an un-seeded tool name never appears', () => {
  seed();
  const html = renderModal();
  for (const fake of ['FAKE_TOOL_SHOULD_NOT_APPEAR', 'MadeUpTool', 'Lorem ipsum', 'mockTool']) {
    assert.ok(!html.includes(fake), `no fabricated "${fake}" in SSR output`);
  }
  const rows = byTestId('sad-toolcall');
  assert.ok(rows, 'the row test hook exists');
});

test('4c · parent breadcrumb NAVIGATES to the main session via sessionId', () => {
  seed();
  captured.length = 0;
  let opened = null;
  mod.useStore.setState({ openSession: async (sid) => { opened = sid; } });
  const html = renderModal();
  assert.match(html, /data-testid="sad-breadcrumb"/, 'parent breadcrumb is rendered');
  assert.match(html, /sad-crumb/, 'a real clickable crumb is present');
  assert.ok(html.includes('main-session-4'), 'the REAL parent session link is shown');
  const crumb = captured.find((e) => e.props && e.props.className && String(e.props.className).includes('sad-crumb press'));
  assert.ok(crumb && typeof crumb.props.onClick === 'function', 'the crumb has a real onClick');
  crumb.props.onClick();
  assert.equal(opened, RECORD.sessionId, 'clicking the crumb opens the REAL parent session');
});

test('4d · an empty transcript shows an honest empty state, never a demo row', () => {
  seed({ subagentToolCalls: {}, subagents: [{ ...RECORD, toolCalls: undefined }] });
  const html = renderModal();
  assert.equal((html.match(/data-testid="sad-toolcall"/g) || []).length, 0, 'no rows when no real events arrived');
  assert.ok(html.includes('Waiting for the next step'), 'honest live empty state');
  assert.ok(!html.includes('read_file') && !html.includes('run_command'), 'no tool name invented for an empty feed');
});

// ============================================================
// 5 · DESIGN — RTL / motion / hairline / single-language labels
// ============================================================
test('5 · child-session CSS keeps the hairline grammar, RTL and both motion gates', () => {
  const c = SRC.sessionCss;
  for (const needle of ['inset-inline-start', 'border-block-end', 'html[dir=\'rtl\']',
    '@media (prefers-reduced-motion: reduce)', 'html.reduce-motion', 'animation: none !important']) {
    assert.ok(c.includes(needle), `agentSession.css carries ${needle}`);
  }
  assert.ok(!/border:\s*[1-9]px/.test(c), 'no boxed rows — only 1px logical hairlines');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(c), 'zero hardcoded hex colours');
  // D13 — bigger reading size inside the child session.
  assert.match(c, /\.jc-name\s*\{[\s\S]*?font:\s*600 13px/, 'tool names are 13px (bigger than the 10px inline card)');
  assert.match(c, /\.jc-v\s*\{[\s\S]*?font:\s*12px/, 'real input/output text is 12px');
});

test('5b · single-language labels: no string literal mixes Arabic + Latin', () => {
  const mixed = new RegExp('[\\u0600-\\u06FF][^\\n\'"]*[A-Za-z]{3}|[A-Za-z]{3}[^\\n\'"]*[\\u0600-\\u06FF]');
  const literals = [...SRC.card.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g), ...SRC.modal.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)]
    .map((m) => m[1] || m[2]).filter((s) => mixed.test(s));
  assert.deepEqual(literals, [], 'all visible labels are single-language');
});
