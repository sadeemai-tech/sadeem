import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

// ============================================================
// v11.14 — stream ingest hardening regression tests.
//
// The renderer's `ingestAgentEvent` is the single choke point for the entire
// agent stream. One throw in any branch loses the current event's state update
// (buffered deltas never flush → "thinking stops") and repeats on every later
// event. This suite feeds EVERY known AgentEvent type — plus the forward-
// compatible v11.13+ types (`self_critique`, `run_and_show`) and malformed
// payloads — through the real bundled store and asserts:
//   • no event type throws;
//   • unknown/new event types are a TRUE no-op (no session clone / re-render);
//   • the core streaming + terminal path still produces the right state.
//
//   node --test --test-force-exit tests/v1114-store-ingest.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1114-'));

function bundle(entry, out) {
  execFileSync(
    ESBUILD_NODE,
    [
      ESBUILD_BIN,
      entry,
      '--bundle',
      '--platform=node',
      '--format=cjs',
      `--outfile=${out}`,
      '--external:electron',
      '--external:@xterm/xterm',
      '--external:@xterm/addon-fit',
      '--external:monaco-editor',
      '--external:@monaco-editor/react',
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
}

// ---- mock window.surnia bridge (installed BEFORE the store bundle loads) ----
const bridge = new Proxy(
  {},
  {
    get(_target, key) {
      if (key === 'then' || typeof key === 'symbol') return undefined;
      return (...args) => {
        switch (key) {
          case 'gitStatus':
            return Promise.resolve({ isRepo: true, branch: 'main', changed: [] });
          case 'previewStatus':
            return Promise.resolve({
              dev: { running: false, state: 'idle', lines: [], agentSources: [] },
              static: { running: false },
              ports: [],
            });
          case 'skillsList':
            return Promise.resolve([]);
          case 'playbookGet':
            return Promise.resolve(null);
          case 'playbookHistory':
            return Promise.resolve([]);
          case 'saveSession':
            return Promise.resolve();
          default:
            return Promise.resolve(undefined);
        }
      };
    },
  },
);
globalThis.window = { surnia: bridge };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const storePath = join(tmp, 'store.cjs');
bundle('src/store.ts', storePath);
const { useStore } = require(storePath);
const ws = join(tmp, 'ws');

function seed(extra = {}) {
  useStore.setState({
    wsPath: ws,
    session: {
      id: 's1',
      title: 't',
      workspace: ws,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
      totalTokens: 0,
      totalCostUsd: 0,
    },
    running: true,
    capabilityPanel: null,
    continueHint: null,
    lastTaskReport: null,
    lastPlaybookLearning: null,
    subagentSteps: {},
    subagentDetailId: null,
    proof: { status: 'unproven', gates: [], updatedAt: 0 },
    ...extra,
  });
}

/** Every AgentEvent type the renderer knows, with a well-formed payload. */
const ALL_EVENTS = [
  { type: 'text_delta', text: 'hello' },
  { type: 'think_delta', text: 'thinking' },
  { type: 'sys_notice', kind: 'gate', text: 'gate passed' },
  { type: 'heartbeat', phase: 'compacting' },
  { type: 'tool_start', toolCallId: 'tc1', name: 'read_file', args: { path: 'a.ts' } },
  { type: 'tool_result', toolCallId: 'tc1', ok: true, output: 'ok' },
  { type: 'message_end', usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 }, stopReason: 'end_turn' },
  {
    type: 'approval_request',
    requestId: 'r1',
    kind: 'command',
    title: 'Run?',
    detail: 'npm test',
    payload: { command: 'npm test' },
  },
  { type: 'todo', todos: [] },
  { type: 'compaction_done', summary: 'summary' },
  { type: 'plan_ready', plan: 'Plan\n- step1\n- step2', steps: ['step1', 'step2'], risks: [] },
  { type: 'preview_open', url: 'http://localhost:3000' },
  { type: 'goal_progress', goal: 'g', pct: 10 },
  { type: 'goal_done', goal: 'g' },
  { type: 'queued_count', n: 0 },
  { type: 'background_done', label: 'bg', summary: 'done' },
  { type: 'steer_injected', text: 'steer' },
  { type: 'doom_loop', tool: 'read_file', count: 3 },
  { type: 'verify_run', cmd: 'npm test', exitCode: 0, outputTail: 'pass' },
  { type: 'review_findings', findings: [{ file: 'a.ts', line: 1, rule: 'r', severity: 'low', note: 'n' }], summary: 'ok' },
  { type: 'task_mode', taskMode: 'plan' },
  { type: 'skill_created', name: 's' },
  { type: 'compaction', before: 80, after: 30 },
  { type: 'subagent_progress', id: 'sa1', label: 'Sub', done: 1, total: 2 },
  { type: 'dna_updated', reason: 'extraction' },
  { type: 'playbook_learned', summary: 'learned', version: 2 },
  { type: 'dna_suggestion', kind: 'skill', patternId: 'p1', text: 'suggest' },
  { type: 'skill_refined', name: 's', version: 2 },
  { type: 'goal_verified', goal: 'g' },
  { type: 'critic_verdict', findings: 1, critical: 0, summary: 'ok' },
  {
    type: 'run_receipt',
    files: ['a.ts'],
    commands: [{ cmd: 'npm test', ok: true }],
    rounds: 1,
    verifyFailed: false,
    durationMs: 100,
  },
  { type: 'claim_audit', summary: 's', unsupported: 0, claims: [] },
  { type: 'mutation_check', honest: true, detail: 'ok' },
  { type: 'mutation_gate', verdict: 'killed-enough', ran: 4, killed: 4, killRate: 1, detail: 'ok' },
  { type: 'fake_tests', scanned: 3, high: 0, summary: 'clean', findings: [] },
  { type: 'red_green', compliant: true, reason: 'ok' },
  { type: 'proof_package', id: 'p', file: 'a.ts', verdict: 'proven', markdown: 'md' },
  { type: 'false_done', claimed: 10, falseDone: 1, rate: 0.1 },
  { type: 'budget_state', label: 'ok' },
  { type: 'taint_escalation', why: 'w', classes: [], sources: [] },
  { type: 'role_route', role: 'r', agent: 'a', provider: 'p', model: 'm', reason: 'x' },
  { type: 'taint_notice', origin: 'repo', kind: 'poison', findings: [] },
  { type: 'wiki_stage', stage: 'scan' },
  {
    type: 'task_report',
    outcome: 'completed',
    summary: 'done',
    files: [],
    commands: [],
    nextSteps: ['x'],
    durationMs: 100,
  },
  { type: 'aborted' },
  { type: 'error', message: 'oops' },
  { type: 'turn_end' },

  // ---- forward-compatible / not-yet-typed engine events (v11.13+) ----
  { type: 'self_critique', summary: 'looks good', findings: [] },
  { type: 'run_and_show', cmd: 'npm test', output: 'pass' },
  { type: 'totally_unknown_future_event', foo: 1 },
];

test('ingestAgentEvent handles every known event type without throwing', () => {
  seed();
  const ingest = useStore.getState().ingestAgentEvent;
  assert.equal(typeof ingest, 'function');
  for (const e of ALL_EVENTS) {
    assert.doesNotThrow(() => ingest(e), `ingestAgentEvent threw on ${e.type}`);
  }
});

test('forward-compatible event types (self_critique / run_and_show / unknown) are true no-ops', () => {
  seed();
  const before = useStore.getState().session;
  const beforeCount = before.messages.length;
  const ingest = useStore.getState().ingestAgentEvent;
  for (const e of [
    { type: 'self_critique', summary: 'x' },
    { type: 'run_and_show', cmd: 'echo hi' },
    { type: 'some_brand_new_event' },
  ]) {
    assert.doesNotThrow(() => ingest(e));
    // No session clone → no chat-wide re-render on an event we cannot render.
    assert.equal(useStore.getState().session, before, `${e.type} rewrote the session`);
  }
  assert.equal(useStore.getState().session.messages.length, beforeCount);
});

test('streamed text + thinking + terminal events still produce the right state', () => {
  seed();
  const ingest = useStore.getState().ingestAgentEvent;
  ingest({ type: 'think_delta', text: 'reasoning…' });
  ingest({ type: 'text_delta', text: 'answer' });
  // A structural event synchronously flushes the rAF-batched buffers.
  ingest({ type: 'message_end', usage: undefined });
  const msgs = useStore.getState().session.messages;
  const bubble = msgs.find((m) => m.role === 'assistant' && m.kind === 'text');
  assert.ok(bubble, 'an assistant bubble was materialized');
  assert.equal(bubble.content, 'answer');
  assert.equal(bubble.thinking, 'reasoning…');
  ingest({ type: 'turn_end' });
  assert.equal(useStore.getState().running, false, 'turn_end clears running');
});

test('task_report lands the completion card + report slice, turn_end clears running', () => {
  seed();
  const ingest = useStore.getState().ingestAgentEvent;
  ingest({
    type: 'task_report',
    outcome: 'aborted',
    summary: 'partial work kept',
    files: ['a.ts'],
    commands: [{ cmd: 'npm test', ok: false }],
    nextSteps: ['resend'],
    partial: true,
    durationMs: 42,
  });
  const report = useStore.getState().lastTaskReport;
  assert.ok(report, 'report slice was set');
  assert.equal(report.outcome, 'aborted');
  assert.equal(report.summary, 'partial work kept');
  // v11.28 — the transcript card is gone; the report is a single localized
  // toast (and lastTaskReport state), never a model:'task-report' row.
  assert.ok(!useStore.getState().session.messages.some((m) => m.model === 'task-report'));
  assert.ok(useStore.getState().lastReportToast, 'one written report toast emitted');
  ingest({ type: 'turn_end' });
  assert.equal(useStore.getState().running, false, 'terminal event clears running even after a report');
});

test('malformed payloads (missing text / findings / files / commands) never throw', () => {
  seed();
  const ingest = useStore.getState().ingestAgentEvent;
  assert.doesNotThrow(() => ingest({ type: 'text_delta' }));
  assert.doesNotThrow(() => ingest({ type: 'think_delta' }));
  assert.doesNotThrow(() => ingest({ type: 'sys_notice', kind: 'gate' }));
  assert.doesNotThrow(() => ingest({ type: 'review_findings' }));
  assert.doesNotThrow(() =>
    ingest({ type: 'run_receipt', rounds: 1, verifyFailed: false, durationMs: 1 }),
  );
  assert.doesNotThrow(() => ingest({ type: 'error', message: undefined }));
});

test('a null / non-object event is ignored without throwing', () => {
  seed();
  const ingest = useStore.getState().ingestAgentEvent;
  assert.doesNotThrow(() => ingest(null));
  assert.doesNotThrow(() => ingest(undefined));
  assert.doesNotThrow(() => ingest({}));
});
