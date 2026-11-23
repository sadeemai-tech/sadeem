// ============================================================
// v11.27 — NO TAINT UI (source + SSR guard).
//
// The founder showed a screenshot of the transcript row
//   TAINT · Dangerous command after untrusted content — explicit appr… [FLAGGED]
// and said: "هاذا القسم مابدي اياه شيله بلكامل احذفه لاتترك له اثر"
// ("I don't want this section — remove it completely, leave no trace").
//
// SCOPE — UI ONLY:
//   · src/components/MessageView.tsx  — TaintRow + its `model === 'taint'`
//     dispatch branch are DELETED, not hidden (no hidden/sr-only/comment).
//   · src/components/chat-final.css, stream-motion.css — no taint-only rules
//     existed there; this suite proves none remain.
// NOT in scope: security enforcement in electron/ (taint DETECTION still
// works internally — see `shouldEscalateForTaint`). This suite asserts that
// enforcement is still present, so the UI removal cannot be mistaken for a
// security downgrade.
//
// Harness posture follows tests/v1118-simple-turn-clean.test.mjs: bundle the
// REAL store + MessageView, SSR the transcript with renderToStaticMarkup, and
// never patch application source.
//
//   node --test --test-force-exit tests/v1127-no-taint-ui.test.mjs
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

const MSG_PATH = 'src/components/MessageView.tsx';
const OWNED_CSS = [
  'src/components/chat-final.css',
  'src/components/stream-motion.css',
];
const msgSrc = readFileSync(join(ROOT, MSG_PATH), 'utf8');
const cssSources = OWNED_CSS.map((p) => [p, readFileSync(join(ROOT, p), 'utf8')]);

/** Strip comments so an allowed one-line "section removed" note cannot make
 *  the strict source checks brittle — the point is no LIVE taint UI code. */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const msgCode = stripComments(msgSrc);

const BUNDLE = join(ROOT, 'tests', '.v1127-no-taint-ui.bundle.cjs');
let mod;
let React;
let renderToStaticMarkup;

before(() => {
  const bridge = new Proxy(
    {},
    {
      get(_t, key) {
        if (key === 'then' || key === 'toJSON' || typeof key === 'symbol') return undefined;
        return () => Promise.resolve(undefined);
      },
    },
  );
  globalThis.window = {
    surnia: bridge,
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false }),
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
    body: { appendChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {} }),
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  esbuild.buildSync({
    stdin: {
      contents:
        "export { useStore } from './src/store';" +
        "export { MessageView } from './src/components/MessageView';",
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: BUNDLE,
    loader: { '.css': 'empty', '.svg': 'dataurl' },
    external: [
      'electron', 'react', 'react-dom', 'zustand', 'lucide-react',
      '@xterm/xterm', '@xterm/addon-fit', 'monaco-editor', '@monaco-editor/react',
    ],
  });
  mod = require(BUNDLE);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect; // SSR: no layout; silence React's warning
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

// React is loaded in before(); look it up at CALL time (not module-load time).
const h = (...a) => React.createElement(...a);
const T = 1700000000000;

function seed(messages = []) {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    wsPath: ROOT,
    session: {
      id: 's1', title: 't', workspace: ROOT, messages,
      createdAt: T, updatedAt: T, messageCount: messages.length,
      totalTokens: 0, totalCostUsd: 0,
    },
    settings: {
      ...prev.settings,
      language: 'en',
      numerals: 'western',
      model: { provider: 'ollama', model: 'qwen3-coder' },
    },
    running: false, capabilityPanel: null, settingsOpen: false, proofVisible: false,
  });
}

/** SSR the transcript exactly as ChatPanel mounts it: every message through
 *  MessageView. This is the surface the founder saw in the screenshot. */
function renderChat(msgs) {
  return renderToStaticMarkup(
    h('div', { className: 'chat-stream chat-stream-v13' },
      ...msgs.map((m) => h(mod.MessageView, { key: m.id, msg: m, turnStart: true }))),
  );
}

const ingest = (e) => mod.useStore.getState().ingestAgentEvent(e);
const userMsg = (id, content) => ({ id, role: 'user', kind: 'text', content, timestamp: T });
const assistantMsg = (id, content) => ({ id, role: 'assistant', kind: 'text', content, timestamp: T + 1 });

// The literal marks the founder pointed at in the screenshot.
const TAINT_MARKUP = [
  'TAINT', 'FLAGGED', 'ESCALATED',
  'Dangerous command after untrusted content',
  'Untrusted source:', 'chat.taint',
  'sc-taint', 'mv-taint',
];
// NOTE: the generic notice chip can still receive an engine-supplied
// `data-notice="taint"` attribute (it degrades unknown kinds to SYSTEM). That
// is generic notice plumbing, NOT a taint-specific row/chip — MessageView has
// zero taint code (proved by the source test above), and there is no taint
// entry in NOTICE_META. We therefore do not ban the generic attribute.

// ============================================================
// 1 — SOURCE: the row, its dispatch and its CSS are gone.
// ============================================================
test('source: TaintRow component deleted (no hidden/sr-only remnant)', () => {
  assert.ok(!/\bTaintRow\b/.test(msgCode), `${MSG_PATH}: no TaintRow component`);
  assert.ok(!/\btaint\b/i.test(msgCode), `${MSG_PATH}: no live taint UI code at all`);
});

test('source: no `model === \'taint\'` dispatch branch', () => {
  assert.ok(!msgCode.includes("model === 'taint'"), `${MSG_PATH}: no taint dispatch branch`);
  assert.ok(!/model\s*===\s*['"]taint['"]/.test(msgCode), `${MSG_PATH}: no taint model comparison in any form`);
  // A real meta-row branch still lives on, proving only the taint arm was cut.
  // v11.28 — the proof-family AND task-report sibling rows were deleted; the
  // written report is now one localized toast. Only real result rows remain.
  assert.ok(msgCode.includes("msg.model === 'verify'"), `${MSG_PATH}: real command-result rows intact`);
  assert.ok(!msgCode.includes("model === 'task-report'"), `${MSG_PATH}: no report card dispatch`);
});

test('source: no taint row markup or translation keys remain in MessageView', () => {
  for (const needle of TAINT_MARKUP) {
    assert.ok(!msgCode.includes(needle), `${MSG_PATH}: "${needle}" removed`);
  }
  assert.ok(!msgCode.includes("'chat.taint.origin'") && !msgCode.includes("'chat.taint.escalated'"),
    `${MSG_PATH}: taint i18n hooks removed`);
});

test('source: owned CSS has no taint-row selectors', () => {
  for (const [path, css] of cssSources) {
    assert.ok(!/\.(?:sc|mv|tl2?|chat)-taint\b/i.test(css), `${path}: no taint-row class rule`);
    assert.ok(!/\btaint\b/i.test(css), `${path}: no taint styling at all`);
  }
});

// ============================================================
// 2 — SSR: neither the row nor any other taint notice renders.
// ============================================================
test('SSR: a legacy model=taint message renders NO taint row', () => {
  const taintMsgs = [
    {
      id: 'taint-a', role: 'assistant', kind: 'text', model: 'taint',
      content: JSON.stringify({ why: 'escalate', classes: ['shell'], sources: ['web'], findings: [{ rule: 'R1', label: 'L1' }] }),
      timestamp: T,
    },
    {
      id: 'taint-b', role: 'assistant', kind: 'text', model: 'taint',
      content: JSON.stringify({ origin: 'web', kind: 'web', findings: [{ rule: 'R2', label: 'L2' }] }),
      timestamp: T,
    },
  ];
  seed(taintMsgs);
  const out = renderChat(taintMsgs);
  for (const needle of TAINT_MARKUP) {
    assert.ok(!out.includes(needle), `SSR transcript must NOT contain "${needle}"`);
  }
});

test('SSR: no taint chip anywhere in a full mixed transcript', () => {
  const msgs = [
    userMsg('u1', 'check the page'),
    assistantMsg('a1', 'Here is what I found.'),
    { id: 'n1', role: 'assistant', kind: 'notice', noticeKind: 'taint', content: '[taint] untrusted source', timestamp: T },
    {
      id: 'taint-c', role: 'assistant', kind: 'text', model: 'taint',
      content: JSON.stringify({ why: 'danger', sources: ['repo'] }), timestamp: T,
    },
  ];
  seed(msgs);
  const out = renderChat(msgs);
  assert.ok(out.includes('Here is what I found.'), 'normal assistant prose still renders');
  for (const needle of TAINT_MARKUP) {
    assert.ok(!out.includes(needle), `no taint row/chip markup ("${needle}") in a full transcript`);
  }
});

// ============================================================
// 3 — SSR: REAL tool + command results still render.
// ============================================================
test('SSR: real tool_call + command result rows still render', () => {
  seed();
  // Drive the actual store ingest path (the same events the engine emits).
  ingest({ type: 'user_message', content: 'run a command', timestamp: T });
  ingest({ type: 'tool_start', toolCallId: 'cmd1', name: 'run_command', args: { command: 'echo hello' } });
  ingest({ type: 'tool_result', toolCallId: 'cmd1', ok: true, output: 'hello-from-command', meta: { toolName: 'run_command' } });
  ingest({ type: 'turn_end' });

  const msgs = mod.useStore.getState().session.messages;
  const out = renderChat(msgs);
  assert.ok(out.includes('tl2-card'), 'the real tool card is mounted');
  assert.ok(out.includes('sc18-res'), 'the real result row is mounted');
  assert.ok(out.includes('hello-from-command'), 'the real command output is visible');
  for (const needle of TAINT_MARKUP) {
    assert.ok(!out.includes(needle), `a real work turn still shows no taint row ("${needle}")`);
  }
});

test('SSR: a standalone command result still renders its output', () => {
  const msgs = [
    {
      id: 'res1', role: 'assistant', kind: 'tool_result', toolName: 'run_command',
      content: 'exit 0\nall tests passed', resultOk: true, timestamp: T,
    },
  ];
  seed(msgs);
  const out = renderChat(msgs);
  assert.ok(out.includes('sc18-res'), 'standalone result row mounted');
  assert.ok(out.includes('all tests passed'), 'real result output rendered');
  assert.ok(!out.includes('TAINT'), 'no taint row leaked into a real result');
});

// ============================================================
// 4 — Honesty guard: security enforcement in electron/ is untouched.
// ============================================================
test('security: electron taint DETECTION is still present (UI-only removal)', () => {
  const taintLib = readFileSync(join(ROOT, 'electron', 'agent', 'taint.ts'), 'utf8');
  const tools = readFileSync(join(ROOT, 'electron', 'agent', 'tools.ts'), 'utf8');
  assert.ok(taintLib.includes('export function shouldEscalateForTaint'),
    'electron/agent/taint.ts: taint escalation detector still exists');
  assert.ok(tools.includes('shouldEscalateForTaint'),
    'electron/agent/tools.ts: dangerous commands are still escalated under taint');
});
