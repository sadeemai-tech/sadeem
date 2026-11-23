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
// v11.31 — RENDERER STATE / CTX / MODES / API-BRIDGE AUDIT.
//
// Drives the REAL bundled store through the lifecycle edges the earlier suites
// do not cover and locks down the fixes for:
//   • abortAgent: a rejected abort IPC must NOT strand running:true, ghost
//     liveness, a stale resume marker, or an unpinned approval/queue card;
//   • decideApproval: a dead approval IPC must not pin the card forever;
//   • runAgent: a rejected agentRun must not leave a stale resume marker;
//   • session switch: stale proof gates must never decorate another session;
//   • queued_count: a malformed engine count must not be stored as a string;
//   • api bridge: every api.* call in store.ts exists in api.ts + preload.ts;
//   • flowsHit uses the real typed bridge (the stale cast/TODO is gone).
//
//   node --test --test-force-exit tests/v1131-store.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1131-'));
const BUNDLE = join(tmp, 'store.cjs');
const RESUME_KEY = 'sadeem.active-run-v12';

// ---- configurable bridge (installed BEFORE the store bundle loads) ----
const bridge = {
  agentAbort: () => Promise.resolve(),
  agentApproval: () => Promise.resolve(),
  agentRun: () => Promise.resolve(),
  saveSettings: () => Promise.resolve(),
  saveSession: () => Promise.resolve(),
  flowsHit: () => Promise.resolve({ count: 0, suggest: false, text: '' }),
  previewStatus: () => Promise.resolve({
    dev: { running: false, state: 'idle', lines: [], agentSources: [] },
    static: { running: false }, ports: [],
  }),
};
const bridgeProxy = new Proxy(bridge, {
  get(target, key) {
    if (key === 'then' || typeof key === 'symbol') return undefined;
    if (key in target) return target[key];
    return () => Promise.resolve(undefined);
  },
});
globalThis.window = { surnia: bridgeProxy };
const lsData = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsData.has(k) ? lsData.get(k) : null),
  setItem: (k, v) => lsData.set(k, String(v)),
  removeItem: (k) => lsData.delete(k),
};
globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
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

function seed(extra = {}) {
  const prev = useStore.getState();
  useStore.setState({
    wsPath: ws,
    session: {
      id: 's1', title: 't', workspace: ws,
      messages: [{ id: 'u1', role: 'user', kind: 'text', content: 'hello', timestamp: Date.now() }],
      createdAt: Date.now(), updatedAt: Date.now(), messageCount: 1,
      totalTokens: 0, totalCostUsd: 0,
    },
    running: true,
    runStartedAt: Date.now(),
    runActivity: { phase: 'thinking', startedAt: Date.now(), at: Date.now() },
    runPhase: 'thinking',
    runRecovery: null,
    resumableRun: null,
    notice: null,
    pendingApproval: null,
    steerPending: false,
    lastTaskReport: null,
    lastReportToast: null,
    settings: {
      ...prev.settings,
      language: 'en',
      model: { provider: 'anthropic', model: 'claude-sonnet-5.5' },
      providers: { anthropic: { enabled: true, apiKey: 'sk-test', lastModels: ['claude-sonnet-5.5'] } },
    },
    ...extra,
  });
}

// ------------------------------------------------------------
// 1 — abortAgent is a terminal edge even when the bridge rejects
// ------------------------------------------------------------
test('abortAgent clears running/liveness/queue/resume even when the engine rejects', async () => {
  bridge.agentAbort = () => Promise.reject(new Error('engine gone'));
  seed({
    resumableRun: { task: 'build x', sessionId: 's1', workspace: ws, at: Date.now() },
    queuedItems: ['later'], queuedCount: 1,
  });
  lsData.set(RESUME_KEY, JSON.stringify({ task: 'build x', sessionId: 's1', workspace: ws, at: Date.now() }));

  await assert.doesNotReject(() => useStore.getState().abortAgent());
  const s = useStore.getState();
  assert.equal(s.running, false, 'running cleared');
  assert.equal(s.runActivity, null, 'no ghost liveness strip');
  assert.equal(s.runStartedAt, null, 'no ghost clock');
  assert.equal(s.runPhase, null, 'no ghost phase');
  assert.equal(s.runRecovery, null, 'no ghost recovery chip');
  assert.equal(s.steerPending, false, 'steer flag cleared');
  assert.equal(s.resumableRun, null, 'no stale resume chip');
  assert.equal(lsData.get(RESUME_KEY), undefined, 'durable resume marker removed');
  assert.equal(lsData.get('sadeem.active-run-v12'), undefined, 'resume key absent');
  assert.ok(s.lastReportToast, 'one honest aborted report toast');
  bridge.agentAbort = () => Promise.resolve();
});

// ------------------------------------------------------------
// 2 — decideApproval never pins the card on a dead bridge
// ------------------------------------------------------------
test('decideApproval always closes the card, even on bridge failure', async () => {
  bridge.agentApproval = () => Promise.reject(new Error('approval IPC down'));
  seed({ pendingApproval: { requestId: 'r1', kind: 'command', title: 'Run?', detail: 'npm test', command: 'npm test' } });

  await assert.doesNotReject(() => useStore.getState().decideApproval('allow'));
  const s = useStore.getState();
  assert.equal(s.pendingApproval, null, 'approval card closed (no stuck dialog)');
  assert.ok(s.notice && String(s.notice).length > 0, 'a localized failure notice is shown (no silent failure)');
  bridge.agentApproval = () => Promise.resolve();
});

// ------------------------------------------------------------
// 3 — a rejected agentRun leaves no stale resume marker
// ------------------------------------------------------------
test('a rejected agentRun clears the durable resume marker', async () => {
  bridge.agentRun = () => Promise.reject(new Error('Insufficient credits'));
  lsData.set(RESUME_KEY, 'stale');
  seed({ running: false, runStartedAt: null, runActivity: null, runPhase: null, notice: null });

  await useStore.getState().sendMessage('hi');
  const s = useStore.getState();
  assert.equal(s.running, false, 'running not stranded');
  assert.equal(s.resumableRun, null, 'no resume chip');
  assert.equal(lsData.get(RESUME_KEY), undefined, 'no stale durable resume marker after a failed start');
  bridge.agentRun = () => Promise.resolve();
});

// ------------------------------------------------------------
// 4 — session switch drops proof from the previous session
// ------------------------------------------------------------
test('newSession clears stale proof gates from the previous session', async () => {
  seed({ running: false, runStartedAt: null, runActivity: null, runPhase: null });
  useStore.setState({
    proof: {
      status: 'proven',
      gates: [{ id: 'verify', tone: 'ok', detail: 'npm test — exit 0', at: Date.now() }],
      updatedAt: Date.now(), mutation: null,
    },
    proofVisible: true,
  });
  await useStore.getState().newSession();
  const s = useStore.getState();
  assert.equal(s.proof.status, 'unproven', 'fresh session is unproven');
  assert.equal(s.proof.gates.length, 0, 'no inherited gates');
  assert.equal(s.proofVisible, false, 'no stale proof ribbon');
});

// ------------------------------------------------------------
// 4b — session switch mid-run drops that run's marker, but never a boot resume
// ------------------------------------------------------------
test('switching away from a live run drops its resume marker; boot resume is kept', async () => {
  seed({ running: true });
  lsData.set(RESUME_KEY, 'in-flight');
  await useStore.getState().newSession();
  assert.equal(useStore.getState().running, false);
  assert.equal(lsData.get(RESUME_KEY), undefined, 'abandoned live run has no resume chip');

  // A crash marker read at boot must survive the automatic newSession() that
  // openWorkspace() performs — otherwise the resume chip dies before it shows.
  seed({ running: false });
  lsData.set(RESUME_KEY, 'from-crash');
  useStore.setState({ resumableRun: { task: 'x', sessionId: 's1', workspace: ws, at: Date.now() } });
  await useStore.getState().newSession();
  assert.equal(lsData.get(RESUME_KEY), 'from-crash', 'boot resume marker preserved');
});

// ------------------------------------------------------------
// 5 — queued_count is honest about malformed engine payloads
// ------------------------------------------------------------
test('queued_count ignores a non-numeric engine count instead of storing a string', () => {
  seed({ running: false, runStartedAt: null, runActivity: null, runPhase: null });
  useStore.setState({ queuedItems: ['a', 'b'], queuedCount: 2 });
  useStore.getState().ingestAgentEvent({ type: 'queued_count', n: 'x' });
  assert.equal(useStore.getState().queuedCount, 2, 'last honest count kept');

  useStore.getState().ingestAgentEvent({ type: 'queued_count', n: 1 });
  assert.equal(useStore.getState().queuedCount, 1, 'valid count still applied');
  assert.deepEqual(useStore.getState().queuedItems, ['b'], 'chip mirror trimmed to the real tail');
});

// ------------------------------------------------------------
// 6 — source locks: bridge coverage + typed flowsHit
// ------------------------------------------------------------
test('every api.* method called by store.ts exists in api.ts and preload.ts', () => {
  const storeSrc = readFileSync(join(ROOT, 'src', 'store.ts'), 'utf8');
  const apiSrc = readFileSync(join(ROOT, 'src', 'lib', 'api.ts'), 'utf8');
  const preSrc = readFileSync(join(ROOT, 'electron', 'preload.ts'), 'utf8');
  const calls = [...new Set([...storeSrc.matchAll(/\bapi\.([A-Za-z0-9_]+)\s*[(?]/g)].map((m) => m[1]))];
  assert.ok(calls.length > 40, 'the audit actually saw the store bridge surface');
  for (const c of calls) {
    assert.ok(new RegExp(`\\b${c}\\b`).test(apiSrc), `${c} declared in api.ts`);
    assert.ok(new RegExp(`\\b${c}\\b`).test(preSrc), `${c} exposed by preload.ts`);
  }
});

test('flowsHit uses the typed bridge (no stale cast / TODO)', () => {
  const src = readFileSync(join(ROOT, 'src', 'store.ts'), 'utf8');
  assert.ok(src.includes('api.flowsHit?.('), 'typed optional flowsHit call');
  assert.ok(!src.includes('TODO(flows)'), 'stale cast TODO removed');
});
