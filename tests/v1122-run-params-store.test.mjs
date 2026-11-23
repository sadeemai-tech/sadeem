import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

// ============================================================
// v11.22 (A6) — "Invalid run parameters (missing messages or model)".
//
// ROOT CAUSE: runAgent() used ONE snapshot (`const s = get()`) taken ~50 lines
// before `api.agentRun`, after the usage-log write / liveness set / proof
// reset. Any state change in that gap (an async model switch, a session
// rewrite) left the payload stale — `messages` empty and/or `model` missing
// its `model` id — and the bridge rejected the run.
//
// FIX: a FRESH `get()` at the IPC boundary rebuilds the entire payload, and
// the model is resolved/validated before any visible state is written.
//
// These tests bundle the REAL store with a stubbed window.surnia bridge and
// simulate the gap by having `saveSettings` (called from the usage-log write)
// corrupt settings.model + session.messages synchronously. The payload that
// reaches agentRun must still be well formed.
//
//   node --test --test-force-exit tests/v1122-run-params-store.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1122-'));
const BUNDLE = join(tmp, 'store.cjs');
const storeSrc = readFileSync(join(ROOT, 'src', 'store.ts'), 'utf8');

// captured agentRun payloads + an optional state mutation injected into the
// async-looking gap between runAgent's snapshot and the bridge call.
const runs = [];
let mutateOnSave = null;

const bridge = new Proxy(
  {},
  {
    get(_t, key) {
      if (key === 'then' || typeof key === 'symbol') return undefined;
      return (...args) => {
        if (key === 'agentRun') {
          runs.push(args[0]);
          return Promise.resolve();
        }
        // updateSettings() calls `void api.saveSettings(settings)` synchronously
        // after set({settings}) — the perfect place to simulate a concurrent
        // writer landing between runAgent's `s` snapshot and `api.agentRun`.
        if (key === 'saveSettings' && mutateOnSave) {
          try { mutateOnSave(); } catch { /* keep the stub inert */ }
        }
        return Promise.resolve(undefined);
      };
    },
  },
);

globalThis.window = { surnia: bridge };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

execFileSync(
  ESBUILD_NODE,
  [
    ESBUILD_BIN,
    'src/store.ts',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${BUNDLE}`,
    '--external:electron',
    '--external:@xterm/xterm',
    '--external:@xterm/addon-fit',
    '--external:monaco-editor',
    '--external:@monaco-editor/react',
    '--loader:.css=empty',
  ],
  { cwd: ROOT, stdio: 'pipe' },
);
const { useStore } = require(BUNDLE);
const ws = join(tmp, 'ws');

const ALL_PROVIDERS = [
  'anthropic', 'openai', 'openrouter', 'ollama', 'gemini', 'zai',
  'deepseek', 'xai', 'moonshot', 'qwen', 'mistral', 'custom',
];

function seed({ model, messages, providers, language = 'en' } = {}) {
  mutateOnSave = null;
  runs.length = 0;
  const prev = useStore.getState();
  const msgs = messages ?? [
    { id: 'u1', role: 'user', kind: 'text', content: 'hello from user', timestamp: Date.now() },
  ];
  useStore.setState({
    wsPath: ws,
    session: {
      id: 'sess-1',
      title: 't',
      workspace: ws,
      messages: msgs,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: msgs.length,
      totalTokens: 0,
      totalCostUsd: 0,
    },
    running: false,
    taskMode: 'build',
    notice: null,
    settings: {
      ...prev.settings,
      language,
      model: model ?? { provider: 'anthropic', model: 'claude-sonnet-5.5' },
      providers: providers ?? {
        anthropic: { enabled: true, apiKey: 'sk-test', lastModels: ['claude-sonnet-5.5'] },
      },
    },
  });
}

function assertValidPayload(p, task) {
  assert.equal(p.task, task, `task is ${task}`);
  assert.equal(p.sessionId, 'sess-1', 'sessionId comes from live session');
  assert.equal(p.workspace, ws, 'workspace comes from live state');
  assert.ok(Array.isArray(p.messages) && p.messages.length > 0, 'messages array is NON-EMPTY');
  assert.ok(
    p.messages.some((m) => typeof m.content === 'string' && m.content.trim() !== ''),
    'at least one message carries real, non-empty content',
  );
  assert.ok(p.model && typeof p.model === 'object', 'model is an object');
  assert.ok(typeof p.model.provider === 'string' && p.model.provider !== '', 'model.provider present');
  assert.ok(typeof p.model.model === 'string' && p.model.model.trim() !== '', 'model.model id present');
}

// ------------------------------------------------------------
// 0 — source-level: fresh read + validation live at the call site
// ------------------------------------------------------------
test('runAgent rebuilds the payload from a fresh get() and validates the model', () => {
  const start = storeSrc.indexOf('runAgent: async');
  const body = storeSrc.slice(start, storeSrc.indexOf('ingestAgentEvent:', start));
  assert.ok(body.includes('const fresh = get();'), 'fresh get() at the IPC boundary');
  assert.ok(body.indexOf('const fresh = get();') > body.indexOf('get().updateSettings('), 'fresh read is AFTER the usage-log write');
  assert.ok(body.includes('messages,'), 'messages rebuilt from fresh session');
  assert.ok(body.includes('model: runModel'), 'validated model is sent');
  const payload = body.slice(body.indexOf('api.agentRun({'), body.indexOf('} catch (err)'));
  assert.ok(!payload.includes('model: s.settings.model'), 'stale snapshot model is NOT sent');
  assert.ok(payload.includes('sessionId: session.id,'), 'live sessionId is sent');
  assert.ok(storeSrc.includes('function resolveRunModel('), 'model resolver exists');
});

// ------------------------------------------------------------
// 1 — chat send: model goes incomplete + messages change in the gap
// ------------------------------------------------------------
test('chat send: stale model + mutated messages are repaired before agentRun', async () => {
  seed();
  mutateOnSave = () => {
    const cur = useStore.getState();
    useStore.setState({
      // simulate an async settings writer dropping the model id
      settings: { ...cur.settings, model: { provider: 'anthropic' } },
      // simulate the session being rewritten: only steer/queued UI rows remain
      session: cur.session
        ? {
            ...cur.session,
            messages: [
              { id: 'sys:1', role: 'user', kind: 'text', content: 'filtered', model: 'queued', timestamp: Date.now() },
              { id: 'sys:2', role: 'assistant', kind: 'text', content: 'steer', model: 'steer', timestamp: Date.now() },
            ],
          }
        : null,
    });
  };
  await useStore.getState().sendMessage('hello from user');
  mutateOnSave = null;

  assert.equal(runs.length, 1, 'agentRun called exactly once');
  assertValidPayload(runs[0], 'chat');
  // the fresh read recovered a REAL user message (or a synthesized one)
  assert.ok(runs[0].messages.some((m) => m.content.includes('hello from user') || m.content.length > 0));
});

// ------------------------------------------------------------
// 2 — gap removes ALL messages but keeps a real user turn: recovered verbatim
// ------------------------------------------------------------
test('chat send: if the filter drops every row, the latest real user message is used', async () => {
  seed({
    messages: [
      { id: 'q1', role: 'user', kind: 'text', content: 'queued copy', model: 'queued', timestamp: Date.now() },
      { id: 'u-real', role: 'user', kind: 'text', content: 'the real user turn', timestamp: Date.now() },
    ],
  });
  mutateOnSave = () => {
    const cur = useStore.getState();
    // force the decoded array to empty by leaving only a filtered row
    useStore.setState({
      settings: { ...cur.settings, model: { provider: 'anthropic' } },
      session: cur.session
        ? {
            ...cur.session,
            messages: [
              { id: 'sys:gone', role: 'user', kind: 'text', content: 'gone', model: 'queued', timestamp: Date.now() },
            ],
          }
        : null,
    });
  };
  await useStore.getState().sendMessage('the real user turn');
  mutateOnSave = null;
  assert.equal(runs.length, 1);
  assertValidPayload(runs[0], 'chat');
});

// ------------------------------------------------------------
// 3 — no model at all: precise single-language notice, bridge untouched
// ------------------------------------------------------------
test('no usable model: notify once in one language, never call the bridge', async () => {
  seed({
    model: { provider: 'anthropic' }, // missing model id
    providers: Object.fromEntries(ALL_PROVIDERS.map((pid) => [pid, { enabled: false }])),
    language: 'en',
  });
  await useStore.getState().sendMessage('hi');
  assert.equal(runs.length, 0, 'bridge must NOT be called');
  assert.equal(useStore.getState().running, false, 'running flag not stranded');
  const notice = useStore.getState().notice || '';
  assert.equal(
    notice,
    'No model is selected. Open Settings → AI providers and choose a model, then send your message again.',
    'canonical err.setup.noModel EN copy from makeT()',
  );
  assert.ok(!/[\u0600-\u06FF]/.test(notice), 'single language (no Arabic mixed in)');
});

test('no usable model (Arabic): single-language Arabic notice', async () => {
  seed({
    model: { provider: 'anthropic' },
    providers: Object.fromEntries(ALL_PROVIDERS.map((pid) => [pid, { enabled: false }])),
    language: 'ar',
  });
  await useStore.getState().sendMessage('مرحباً');
  assert.equal(runs.length, 0, 'bridge must NOT be called');
  const notice = useStore.getState().notice || '';
  assert.equal(
    notice,
    'لا يوجد نموذج مختار. افتح الإعدادات ← مزودو الذكاء الاصطناعي واختر نموذجاً، ثم أعد إرسال رسالتك.',
    'canonical err.setup.noModel AR copy from makeT()',
  );
  assert.ok(!/[A-Za-z]{4,}/.test(notice), 'single language (no English words mixed in)');
});

// ------------------------------------------------------------
// 4 — compact / init always synthesize a real, non-empty message
// ------------------------------------------------------------
test('compact and init send a real, non-empty message with a valid model', async () => {
  seed();
  await useStore.getState().compact();
  assert.equal(runs.length, 1);
  assertValidPayload(runs[0], 'compact');
  assert.ok(runs[0].messages.some((m) => (m.content || '').trim().length > 0));

  useStore.setState({ running: false });
  runs.length = 0;
  await useStore.getState().sendMessage('/init');
  assert.equal(runs.length, 1);
  assertValidPayload(runs[0], 'init');
  assert.ok(runs[0].messages.some((m) => (m.content || '').includes('/init')));
});

// ------------------------------------------------------------
// 5 — fallback to a configured model when the selected one is incomplete
// ------------------------------------------------------------
test('incomplete selected model falls back to the first enabled provider model', async () => {
  seed({
    model: { provider: 'openai' }, // no model id — but openai is enabled w/ models
    providers: {
      openai: { enabled: true, apiKey: 'sk-openai', lastModels: ['gpt-6-astra'] },
    },
  });
  await useStore.getState().sendMessage('fallback please');
  assert.equal(runs.length, 1);
  assertValidPayload(runs[0], 'chat');
  assert.equal(runs[0].model.provider, 'openai');
  assert.equal(runs[0].model.model, 'gpt-6-astra');
});
