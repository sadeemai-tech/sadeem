import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.14 — CHAT RUNTIME smoke tests (source-level + real render).
//
// The v11.14 incident: "thinking stops, stream appears interrupted,
// many errors" while static tests stay green. The renderer's ingest path was
// hardened in the store; these tests lock the UI side: the run-status helpers
// in ChatPanel/Composer must exist, cover every phase, and must not throw
// while a run is active — including on an empty transcript or a malformed
// (non-string) streaming row, where one unguarded string method used to blank
// the whole transcript.
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const chatSrc = readFileSync(join(ROOT, 'src', 'components', 'ChatPanel.tsx'), 'utf8');
const compSrc = readFileSync(join(ROOT, 'src', 'components', 'Composer.tsx'), 'utf8');
const BUNDLE = join(ROOT, 'tests', '.v1114-chat-runtime.bundle.cjs');
let mod;
let React;
let renderToString;

before(() => {
  // Minimal browser stubs installed BEFORE the store bundle loads.
  globalThis.window = {
    surnia: new Proxy({}, {
      get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : () => Promise.resolve(undefined)),
    }),
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
        "export { ChatPanel } from './src/components/ChatPanel';" +
        "export { Composer } from './src/components/Composer';" +
        "export { useStore } from './src/store';",
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLE,
    loader: { '.css': 'empty' },
    external: ['electron', 'react', 'react-dom', 'lucide-react'],
  });
  mod = require(BUNDLE);
  React = require('react');
  // SSR's getServerSnapshot reads the INITIAL store state; make it read the
  // live seeded state so the run-status branches actually execute.
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  renderToString = require('react-dom/server').renderToString;
});

after(() => {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

// ------------------------------------------------------------
// 1 — source-level: helpers + phase grammar exist
// ------------------------------------------------------------
test('ChatPanel defines the run-status helpers (single primary circle, activity, ledgers, phase line)', () => {
  for (const helper of [
    // v11.24 — the big standalone circle was REMOVED; A4 owns the one small
    // timeline circle in MessageView.
    'function useRunActivity',
    'function deriveRunPhases',
    'function MessagePhaseLine',
    'function RunStatusLine',
    'function streamingThinking',
  ]) {
    assert.ok(chatSrc.includes(helper), `ChatPanel defines ${helper}`);
  }
  // v11.23 — the founder demanded the duplicate working circle be removed.
  assert.ok(!chatSrc.includes('function ChatLiveIndicator'), 'duplicate working indicator is gone');
  assert.ok(!chatSrc.includes('className="chat-live"'), 'no second ring next to WORKING');
  assert.ok(!chatSrc.includes('cp-live-glyph'), 'the big standalone circle is REMOVED');
  assert.ok(chatSrc.includes('className="phase-strip run-strip-v13 anim-in shrink-0"'), 'run strip class preserved');
  assert.ok(chatSrc.includes('formatElapsedClock(now - startRef.current)'), 'elapsed tick preserved');
});

test('Composer defines useRunProgressSteps and keeps the stop test hook', () => {
  assert.ok(compSrc.includes('function useRunProgressSteps'), 'progress helper exists');
  assert.ok(compSrc.includes('const runSteps = useRunProgressSteps()'), 'helper is wired into the deck');
  assert.ok(compSrc.includes('data-testid="composer-stop"'), 'composer-stop hook preserved');
  assert.ok(compSrc.includes('void abortAgent()'), 'stop still aborts the real run');
  assert.ok(compSrc.includes('className="cf-run-progress"'), 'progress strip class preserved');
});

test('both phase ledgers enumerate all five phases (no out-of-bounds on empty data)', () => {
  const order = "['think', 'work', 'build', 'run', 'prove']";
  assert.ok(compSrc.includes(`const RUN_PHASE_ORDER: StreamPhase[] = ${order}`), 'Composer phase order complete');
  assert.ok(chatSrc.includes(`const order: StreamPhase[] = ${order}`), 'ChatPanel phase order complete');
  for (const key of ['think', 'work', 'build', 'run', 'prove']) {
    assert.ok(chatSrc.includes(`${key}: { active: 0, done: 0 }`), `ChatPanel accumulator has ${key}`);
    assert.ok(compSrc.includes(`${key}: false`), `Composer done-map has ${key}`);
  }
  // MessagePhaseLine indexes MSG_PHASES with a clamped 0..3 reached index
  assert.ok(chatSrc.includes('const MSG_PHASES = [\'thinking\', \'tools\', \'answering\', \'verified\']'), 'phase line array');
  assert.ok(chatSrc.includes('const phase = MSG_PHASES[reached]'), 'phase line index access');
});

test('every lucide icon imported by the two files exists in the installed lucide-react', () => {
  const dts = readFileSync(join(ROOT, 'node_modules', 'lucide-react', 'dist', 'lucide-react.d.ts'), 'utf8');
  let checked = 0;
  for (const src of [chatSrc, compSrc]) {
    const imports = /import\s*\{([\s\S]*?)\}\s*from\s*'lucide-react'/g;
    let m;
    while ((m = imports.exec(src))) {
      for (const raw of m[1].split(',')) {
        const name = raw.trim().replace(/^type\s+/, '').trim();
        if (!name) continue;
        // Newer lucide versions export legacy names as aliases
        // (e.g. `Ellipsis as MoreHorizontal`), not as their own declaration.
        const declared = dts.includes(`declare const ${name}:`);
        const aliased = new RegExp(`\\bas\\s+${name}\\b`).test(dts);
        assert.ok(declared || aliased, `lucide-react exports ${name}`);
        checked++;
      }
    }
  }
  assert.ok(checked >= 30, `checked all imported icons (${checked})`);
});

// ------------------------------------------------------------
// 2 — runtime: mounting both surfaces with `running: true` must not throw
// ------------------------------------------------------------
function seed(running, messages, extra = {}) {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    wsPath: 'D:\\ws',
    session: {
      id: 's1', title: 't', workspace: 'D:\\ws', messages,
      createdAt: Date.now(), updatedAt: Date.now(), messageCount: messages.length,
      totalTokens: 0, totalCostUsd: 0,
    },
    settings: { ...prev.settings, language: 'en', model: { provider: 'custom', model: 'm' } },
    running,
    sessionUsage: { inputTokens: 10, outputTokens: 20, costUsd: 0.01 },
    lastTurnUsage: null,
    ctxWindow: 200000,
    pendingApproval: null,
    ...extra,
  });
}

function render(C) {
  return renderToString(React.createElement(C));
}

test('empty transcript while running: both surfaces render, no crash', () => {
  seed(true, []);
  const panel = render(mod.ChatPanel);
  const deck = render(mod.Composer);
  assert.ok(panel.includes('phase-strip'), 'run phase strip mounted');
  assert.ok(deck.includes('cf-run-progress'), 'composer progress strip mounted');
  assert.ok(deck.includes('data-testid="composer-stop"'), 'stop button visible while running');
  assert.ok(deck.includes('1/5'), 'empty transcript still yields one active of five phases');
});

test('idle transcript: run chrome is absent, no crash', () => {
  seed(false, []);
  assert.ok(!render(mod.ChatPanel).includes('phase-strip'), 'run strip hidden while idle');
  assert.ok(!render(mod.Composer).includes('cf-run-progress'), 'progress strip hidden while idle');
});

test('streaming + tool rows render without a runtime exception', () => {
  const now = Date.now();
  const rows = [
    { id: 'u1', role: 'user', kind: 'user', content: 'do it', timestamp: now - 5000 },
    { id: 't1', role: 'assistant', kind: 'tool_call', toolName: 'read_file', toolCallId: 'c1', content: '{"path":"a.ts"}', timestamp: now - 4000 },
    { id: 'a1', role: 'assistant', kind: 'assistant', content: '', thinking: 'reasoning…', streaming: true, timestamp: now - 3000 },
  ];
  seed(true, rows);
  assert.ok(render(mod.ChatPanel).includes('phase-strip'), 'run strip survives a live transcript');
  assert.ok(render(mod.Composer).includes('composer-stop'), 'stop survives a live transcript');
});

test('a malformed non-string streaming row does not blank the renderer', () => {
  // v11.14: the IPC boundary is untrusted. A row whose content is not a
  // string used to throw in ChatPanel's render (streamingThinking/pureThinking)
  // and abort the whole transcript update.
  seed(true, [{ id: 'bad1', role: 'assistant', kind: 'assistant', content: 42, streaming: true, timestamp: Date.now() }]);
  assert.ok(render(mod.ChatPanel).includes('phase-strip'), 'ChatPanel survives malformed content');
  assert.ok(render(mod.Composer).includes('cf-run-progress'), 'Composer survives malformed content');
});
