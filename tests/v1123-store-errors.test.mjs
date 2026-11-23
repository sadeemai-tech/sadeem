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
// v11.23 — STORE ERROR-INGEST AUDIT (founder: "random errors in chat").
//
// Drives the REAL bundled store through real-shaped AgentEvent sequences from
// electron/agent/register.ts / engine.ts and locks down the eight symptoms:
//   1. error events rendered as duplicate transcript rows
//   2. a 402 translated toast ALSO leaking the raw English payload
//   3. errors without a summary card
//   4. events ingested after turn_end
//   5. wrong / dishonest proof gating on failure
//   6. `running` stuck true after error / abort
//   7. liveness activity never cleared
//   8. malformed IPC payloads throwing during ingest ("thinking stops")
//   9. error text mixed EN+AR
//
//   node --test --test-force-exit tests/v1123-store-errors.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1123-'));
const BUNDLE = join(tmp, 'store.cjs');
const STORE_SRC = readFileSync(join(ROOT, 'src', 'store.ts'), 'utf8');

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

// Preview bridge responses are configurable so failing starts can be driven
// through the REAL store actions (not a mocked store).
const previewBridge = {
  staticStart: { ok: true, url: 'http://localhost:4173' },
  devStart: { ok: true },
  devThrows: null,
  status: {
    dev: { running: false, state: 'idle', lines: [], agentSources: [] },
    static: { running: false },
    ports: [],
  },
};
const bridge = new Proxy(
  {},
  {
    get(_t, key) {
      if (key === 'then' || typeof key === 'symbol') return undefined;
      return (...args) => {
        if (key === 'gitStatus') return Promise.resolve({ isRepo: false, branch: '', changed: [] });
        if (key === 'previewStatus') return Promise.resolve(previewBridge.status);
        if (key === 'previewStaticStart') return Promise.resolve(previewBridge.staticStart);
        if (key === 'previewDevStart') {
          if (previewBridge.devThrows) throw new Error(previewBridge.devThrows);
          return Promise.resolve(previewBridge.devStart);
        }
        if (key === 'saveSettings' || key === 'saveSession') return Promise.resolve();
        if (key === 'agentRun') return Promise.resolve();
        return Promise.resolve(undefined);
      };
    },
  },
);
globalThis.window = { surnia: bridge };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
globalThis.cancelAnimationFrame = () => {};

const { useStore } = require(BUNDLE);
const ingest = (e) => useStore.getState().ingestAgentEvent(e);
const T = 1700000000000;

/** Real-shaped send state, including the immediate-visible liveness strip. */
function seed(language = 'en', extra = {}) {
  const prev = useStore.getState();
  useStore.setState({
    wsPath: join(tmp, 'ws'),
    session: {
      id: 'sess-1',
      title: 't',
      workspace: join(tmp, 'ws'),
      messages: [
        { id: 'u1', role: 'user', kind: 'text', content: 'build the thing', timestamp: T },
        { id: 'a1', role: 'assistant', kind: 'text', content: 'Working on it…', timestamp: T + 1, streaming: true },
      ],
      createdAt: T,
      updatedAt: T,
      messageCount: 2,
      totalTokens: 0,
      totalCostUsd: 0,
    },
    settings: { ...prev.settings, language, model: { provider: 'anthropic', model: 'claude-sonnet-5.5' } },
    running: true,
    runStartedAt: T,
    runActivity: { phase: 'thinking', startedAt: T, at: T },
    runPhase: 'thinking',
    runRecovery: null,
    notice: null,
    lastTaskReport: null,
    lastReportToast: null,
    continueHint: null,
    proof: { status: 'unproven', gates: [], updatedAt: 0, mutation: null },
    proofVisible: false,
    ...extra,
  });
}

// v11.28 — the report card was removed from the transcript. The single owner
// surface is now a localized toast (`lastReportToast`) + `lastTaskReport`.
// Map it to a card-shaped view so the existing assertions verify the SAME
// honesty contract (one written summary, right language, no raw JSON).
const cards = () => {
  const s = useStore.getState();
  if (s.lastReportToast) {
    const r = s.lastTaskReport ?? {};
    return [{ content: JSON.stringify({
      summary: s.lastReportToast.title,
      severity: s.lastReportToast.severity,
      files: r.files ?? [], commands: r.commands ?? [], nextSteps: r.nextSteps ?? [], durationMs: r.durationMs ?? 0,
    }) }];
  }
  if (s.notice) return [{ content: JSON.stringify({ summary: String(s.notice) }) }];
  return [];
};
const rawErrorRows = () => useStore.getState().session.messages.filter((m) => m.model === 'error');
const cardPayload = (m) => JSON.parse(m.content);
const hasArabic = (s) => /\p{Script=Arabic}/u.test(String(s ?? ''));
const hasEnglishProse = (s) => /[A-Za-z][a-z]+\s+[A-Za-z][a-z]+\s+[A-Za-z][a-z]+/.test(String(s ?? ''));

// The founder's exact 402 payload (verbatim from tests/v1119-no-credits).
const RAW_402 = JSON.stringify({ error: {
  message: 'Insufficient credits. This account never purchased credits. Make sure your key is on the correct account or org, and if so, purchase more at https://openrouter.ai/settings/credits',
  code: 402,
  metadata: { limit_source: 'openrouter_credits' },
} });
const CREDS_EN = 'Insufficient credits: add balance to the provider account or switch the provider/key in Settings → Providers.';
const CREDS_AR = 'رصيد غير كافٍ: حساب المزوّد ليس لديه رصيد. أضف رصيداً أو بدّل المزوّد/المفتاح من الإعدادات ← المزوّدون.';

// ------------------------------------------------------------
// 1 — duplicate transcript rows
// ------------------------------------------------------------
test('error + task_report => exactly ONE summary card, no raw error row', () => {
  seed('en');
  ingest({ type: 'error', message: 'Provider error 500: upstream unavailable' });
  ingest({
    type: 'task_report',
    outcome: 'error',
    summary: 'Run failed: Provider error 500: upstream unavailable',
    files: [],
    commands: [],
    nextSteps: ['Partial state is untouched — send a follow-up message to retry the task.'],
    durationMs: 12,
  });
  ingest({ type: 'turn_end' });

  assert.equal(cards().length, 1, 'one — and only one — summary card');
  assert.equal(rawErrorRows().length, 0, 'no model:"error" raw dump row');
  assert.equal(useStore.getState().lastTaskReport.outcome, 'error');
  assert.ok(cardPayload(cards()[0]).summary.length > 0);
  // repeated error events for the same run still reuse the tracked card
  seed('en');
  ingest({ type: 'error', message: 'first failure' });
  ingest({ type: 'error', message: 'second failure' });
  ingest({ type: 'turn_end' }); // v11.28 — the single toast settles at turn_end
  assert.equal(cards().length, 1, 'a repeated error never adds a second report surface');
});

// ------------------------------------------------------------
// 2 — 402 must not leak raw English next to the translated toast
// ------------------------------------------------------------
test('402: one translated notice in the selected language, no raw JSON in the transcript', () => {
  for (const [language, expected] of [['en', CREDS_EN], ['ar', CREDS_AR]]) {
    seed(language);
    ingest({ type: 'error', message: RAW_402 });
    // v11.28 — no separate 402 notify: the ONE owner surface is the terminal
    // report toast, emitted when turn_end settles the run.
    ingest({
      type: 'task_report',
      outcome: 'error',
      summary: RAW_402, // main process forwards the raw provider text here
      files: [],
      commands: [],
      nextSteps: ['Partial state is untouched — send a follow-up message to retry the task.'],
      durationMs: 0,
    });
    ingest({ type: 'turn_end' });

    assert.equal(cards().length, 1);
    assert.match(String(useStore.getState().lastReportToast?.title ?? ''), new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'single canonical report toast');
    const payload = cardPayload(cards()[0]);
    // v11.28 — the one toast adds an outcome prefix + real counts; the canonical
    // localized credits sentence must still be present verbatim, in one language.
    assert.ok(String(payload.summary).includes(expected), 'card/report toast speaks the same single language');
    assert.deepEqual(
      payload.nextSteps,
      language === 'ar' ? [CREDS_AR] : ['Partial state is untouched — send a follow-up message to retry the task.'],
    );
    const transcript = JSON.stringify(useStore.getState().session.messages);
    assert.ok(!transcript.includes('never purchased credits'), 'raw English provider JSON never reaches the chat');
    assert.ok(!transcript.includes('openrouter_credits'), 'raw metadata never reaches the chat');
    assert.ok(!transcript.includes('"code":402'), 'raw 402 JSON never reaches the chat');
    if (language === 'ar') {
      assert.ok(hasArabic(payload.summary));
      assert.ok(!hasEnglishProse(payload.summary));
      assert.ok(!hasEnglishProse(payload.nextSteps.join(' ')));
    }
  }
});

// ------------------------------------------------------------
// 3 — error without a report still has a summary card
// ------------------------------------------------------------
test('error + turn_end with NO task_report leaves an honest summary card', () => {
  seed('en');
  ingest({ type: 'error', message: 'socket hang up', code: 'BAD_SHAPE' });
  ingest({ type: 'turn_end' });

  assert.equal(cards().length, 1, 'error-only terminal path still produced a card');
  const report = useStore.getState().lastTaskReport;
  assert.ok(report);
  assert.equal(report.outcome, 'error');
  assert.ok(cardPayload(cards()[0]).summary.includes('Run not started'));
  assert.equal(useStore.getState().running, false);
  assert.equal(useStore.getState().runActivity, null);
});

// ------------------------------------------------------------
// 4 — stale events after turn_end
// ------------------------------------------------------------
test('events ingested after turn_end are ignored (no zombie bubble / second card)', () => {
  seed('en');
  ingest({ type: 'error', message: 'boom' });
  ingest({ type: 'turn_end' });
  const before = useStore.getState().session;
  const count = before.messages.length;

  for (const e of [
    { type: 'text_delta', text: 'late token' },
    { type: 'think_delta', text: 'late thought' },
    { type: 'sys_notice', kind: 'liveness', text: 'still alive?' },
    { type: 'error', message: 'late error' },
    { type: 'task_report', outcome: 'completed', summary: 'late report', files: [], commands: [], nextSteps: [], durationMs: 0 },
    { type: 'aborted' },
  ]) {
    assert.doesNotThrow(() => ingest(e), `${e.type} after turn_end must not throw`);
    assert.equal(useStore.getState().session, before, `${e.type} rewrote the closed session`);
  }
  assert.equal(useStore.getState().session.messages.length, count);
  assert.equal(cards().length, 1);
  assert.equal(useStore.getState().running, false);
  assert.equal(useStore.getState().runActivity, null);
  assert.equal(useStore.getState().runStartedAt, null);
  assert.equal(useStore.getState().runPhase, null);

  // a fresh send re-arms the ingest lifecycle (resetProofForTurn at every send)
  useStore.getState().resetProofForTurn();
  useStore.setState({ running: true });
  ingest({ type: 'text_delta', text: 'fresh turn' });
  ingest({ type: 'message_end' });
  assert.ok(
    useStore.getState().session.messages.some((m) => m.role === 'assistant' && m.content === 'fresh turn'),
    'the next turn streams normally',
  );
});

// ------------------------------------------------------------
// 5 — honest proof gating on failure
// ------------------------------------------------------------
test('a proven proof package cannot survive a failed run', () => {
  seed('en');
  ingest({ type: 'verify_run', cmd: 'npm test', exitCode: 0, outputTail: '3 passed' });
  ingest({ type: 'proof_package', id: 'p', file: 'a.ts', verdict: 'proven', markdown: 'md' });
  assert.equal(useStore.getState().proof.status, 'proven');
  ingest({ type: 'error', message: 'commit failed after tests' });
  assert.equal(useStore.getState().proof.status, 'failed', 'error outranks a green gate');
  ingest({ type: 'turn_end' });
  assert.equal(useStore.getState().proof.status, 'failed', 'turn_end rollup must not repaint it green');
});

test('error outcome in a task_report (lost error event) fails the proof too', () => {
  seed('en');
  ingest({ type: 'tool_start', toolCallId: 'w1', name: 'write_file', args: { path: 'a.ts' } });
  ingest({ type: 'tool_result', toolCallId: 'w1', ok: true, output: 'ok' });
  ingest({ type: 'verify_run', cmd: 'npm test', exitCode: 0, outputTail: 'pass' });
  ingest({
    type: 'task_report', outcome: 'error', summary: 'run failed', files: [], commands: [], nextSteps: [], durationMs: 1,
  });
  ingest({ type: 'turn_end' });
  assert.equal(useStore.getState().proof.status, 'failed');
});

test('an aborted run is unproven, never proven', () => {
  seed('en');
  ingest({ type: 'verify_run', cmd: 'npm test', exitCode: 0, outputTail: 'pass' });
  ingest({ type: 'proof_package', id: 'p', file: 'a.ts', verdict: 'proven', markdown: 'md' });
  ingest({ type: 'aborted' });
  ingest({ type: 'turn_end' });
  assert.equal(useStore.getState().proof.status, 'unproven');
});

// ------------------------------------------------------------
// 6 + 7 — running flag + liveness activity on terminal paths
// ------------------------------------------------------------
test('error / aborted / report clear running AND the immediate liveness strip', () => {
  for (const terminal of [
    { type: 'error', message: '500 backend down' },
    { type: 'aborted' },
    {
      type: 'task_report', outcome: 'error', summary: 'done', files: [], commands: [], nextSteps: [], durationMs: 1,
    },
  ]) {
    seed('en');
    assert.equal(useStore.getState().running, true);
    assert.ok(useStore.getState().runActivity);
    ingest(terminal);
    const s = useStore.getState();
    assert.equal(s.running, false, `${terminal.type} clears running`);
    assert.equal(s.runStartedAt, null, `${terminal.type} clears runStartedAt`);
    assert.equal(s.runActivity, null, `${terminal.type} clears runActivity`);
    assert.equal(s.runPhase, null, `${terminal.type} clears runPhase`);
  }
  // a malformed error payload must still clear everything (critical set FIRST)
  seed('en');
  const hostile = { type: 'error', message: { toString() { throw new Error('hostile payload'); } } };
  assert.doesNotThrow(() => ingest(hostile));
  assert.equal(useStore.getState().running, false);
  assert.equal(useStore.getState().runActivity, null);
});

// ------------------------------------------------------------
// 8 — malformed IPC payloads must never throw / stall the stream
// ------------------------------------------------------------
test('malformed payload battery never throws and the next token still lands', () => {
  seed('en');
  const malformed = [
    { type: 'text_delta', text: 42 },
    { type: 'think_delta', text: null },
    { type: 'message_end', usage: { inputTokens: 'x', attempts: 'not-an-array' } },
    { type: 'plan_ready', steps: 5, risks: 'nope', plan: null },
    { type: 'review_findings', findings: 'nope' },
    { type: 'run_receipt', files: null, commands: [null, 'bad'], rounds: 'x' },
    { type: 'approval_request', requestId: 'r', kind: 'command', title: 't', detail: 'd', payload: null },
    { type: 'subagent_progress', id: 'sa', label: 'x', done: 'x', total: null },
    { type: 'queued_count', n: 'x' },
    { type: 'task_report', outcome: 'error', summary: null, files: null, commands: 'bad', nextSteps: null, durationMs: null },
    { type: 'error', message: undefined },
    { type: 'proof_package', verdict: { weird: true } },
    { type: 'mutation_gate', verdict: null, ran: null, killed: null, detail: null },
    { type: 'verify_run', cmd: null, exitCode: 'x', outputTail: null },
  ];
  for (const e of malformed) {
    assert.doesNotThrow(() => ingest(e), `ingest(${e.type}) threw on a malformed payload`);
  }
  ingest({ type: 'text_delta', text: 'still streaming' });
  ingest({ type: 'message_end' });
  const msgs = useStore.getState().session.messages;
  assert.ok(
    msgs.some((m) => m.role === 'assistant' && m.content === 'still streaming'),
    'buffered tokens flushed — thinking did not stop',
  );
});

// ------------------------------------------------------------
// 9 — no mixed EN+AR error copy
// ------------------------------------------------------------
test('mixed / wrong-language error text is rendered in the SELECTED language only', () => {
  seed('ar');
  ingest({ type: 'error', message: 'حدث خطأ Provider error 500: connection failed, please retry' });
  ingest({ type: 'turn_end' }); // v11.28 — the one toast settles at turn_end
  let payload = cardPayload(cards()[0]);
  assert.ok(hasArabic(payload.summary), 'Arabic UI gets an Arabic summary');
  assert.ok(!hasEnglishProse(payload.summary), 'no English prose inside the Arabic summary');
  assert.ok(!hasEnglishProse(String(useStore.getState().notice ?? '')), 'no English prose in the notice');

  seed('en');
  ingest({ type: 'error', message: 'تعذّر الاتصال بالمزوّد، أعد المحاولة من فضلك' });
  ingest({ type: 'turn_end' });
  payload = cardPayload(cards()[0]);
  assert.ok(!hasArabic(payload.summary), 'English UI gets an English summary');
  assert.ok(hasEnglishProse(payload.summary));
});

test('machine error codes resolve to the canonical bilingual err.* keys', () => {
  const cases = [
    [{ type: 'error', message: 'Run not started: no run parameters were supplied.', code: 'NO_PARAMS' }, 'Run not started — the request had no messages or no model selected.', null],
    [{ type: 'error', message: 'Run not started: there is no user message to send.', code: 'NO_USER_MESSAGE' }, 'Nothing to send — your message is empty.', null],
    [{ type: 'error', message: 'the provider is rate-limiting requests', code: undefined }, 'The provider is rate-limiting requests right now.', null],
  ];
  for (const [event, enFragment] of cases) {
    seed('en');
    ingest(event);
    ingest({ type: 'turn_end' });
    assert.ok(cardPayload(cards()[0]).summary.includes(enFragment), JSON.stringify(event));
    seed('ar');
    ingest(event);
    ingest({ type: 'turn_end' });
    const ar = cardPayload(cards()[0]).summary;
    assert.ok(hasArabic(ar));
    assert.ok(!hasEnglishProse(ar));
  }
});

// ------------------------------------------------------------
// 10 — P0 preview failures: one localized surface, no raw server output
// ------------------------------------------------------------
const RAW_SERVER_OUTPUT = '{"error":{"message":"spawn ENOENT","code":402}}';

function previewBaseline(language) {
  previewBridge.staticStart = { ok: true, url: 'http://localhost:4173' };
  previewBridge.devStart = { ok: true };
  previewBridge.devThrows = null;
  seed(language, { previewOpen: false, previewError: null, notice: null, previewUrl: '', previewWs: '' });
}

test('static preview failure: one localized card, NO toast, no raw JSON/prose', async () => {
  for (const [language, expected] of [['en', CREDS_EN], ['ar', CREDS_AR]]) {
    previewBaseline(language);
    previewBridge.staticStart = { ok: false, error: RAW_SERVER_OUTPUT };
    await useStore.getState().startStaticPreview();
    const st = useStore.getState();
    assert.equal(st.notice, null, 'single surface: no duplicate toast');
    assert.equal(st.previewOpen, true, 'the localized card is actually visible');
    assert.ok(st.previewError, 'honest error card present');
    assert.equal(st.previewError.reason, 'startFailed');
    assert.equal(st.previewError.detail, `${expected} (402)`, 'canonical reason + sanitized machine cause');
    assert.ok(!st.previewError.detail.includes('{'), 'no raw JSON in the popover detail');
    assert.ok(!st.previewError.detail.includes('spawn'), 'no raw server output');
  }
});

test('dev preview failure: reason bucket mapped, raw error never reaches the card or a toast', async () => {
  for (const language of ['en', 'ar']) {
    previewBaseline(language);
    previewBridge.devStart = { ok: false, error: 'no dev/start/serve script in package.json' };
    await useStore.getState().startDevPreview();
    const st = useStore.getState();
    assert.equal(st.notice, null, 'one surface only');
    assert.equal(st.previewError.reason, 'noDevScript', 'the REAL reason survives as a mapped bucket');
    assert.equal(st.previewError.detail, '', 'no second wording: the card body already says why + next step');
    assert.ok(!JSON.stringify(st.previewError).includes('no dev/start/serve script in package.json'));
  }
});

test('thrown preview error: localized single-language message, no stack/JSON leak', async () => {
  for (const language of ['en', 'ar']) {
    previewBaseline(language);
    // A thrown bridge rejection carrying a raw mixed-language payload.
    previewBridge.devThrows = 'خطأ 503: upstream unavailable, retry later';
    await useStore.getState().startDevPreview();
    const st = useStore.getState();
    assert.equal(st.notice, null);
    assert.ok(st.previewError && st.previewError.detail, 'card still reports the failure');
    assert.ok(!st.previewError.detail.includes('upstream unavailable'), 'no raw English prose');
    assert.ok(!st.previewError.detail.includes('{"'), 'no JSON');
    if (language === 'ar') {
      assert.ok(hasArabic(st.previewError.detail));
      assert.ok(!hasEnglishProse(st.previewError.detail));
    } else {
      assert.ok(!hasArabic(st.previewError.detail));
    }
    assert.match(st.previewError.detail, /\(503\)/, 'the concrete HTTP reason survives');
  }
});

test('no workspace: localized noWorkspace card, never a raw EN toast', async () => {
  for (const language of ['en', 'ar']) {
    previewBaseline(language);
    useStore.setState({ wsPath: '' });
    await useStore.getState().startDevPreview();
    const st = useStore.getState();
    assert.equal(st.notice, null, 'no raw "Open a workspace first" toast');
    assert.deepEqual(st.previewError, { reason: 'noWorkspace' });
    assert.equal(st.previewOpen, true, 'card visible even when the panel was closed');
  }
});

test('preview status poll strips ANSI + JSON before log lines reach any surface', async () => {
  previewBaseline('ar');
  previewBridge.status = {
    dev: {
      running: false,
      state: 'error',
      lines: ['> vite v5 ready', '{"error":"spawn boom"}', '\u001B[31mECONNRESET\u001B[0m'],
      agentSources: [],
    },
    static: { running: false },
    ports: [],
  };
  await useStore.getState().refreshPreviewStatus();
  const lines = useStore.getState().previewStatus.dev.lines;
  assert.deepEqual(lines, ['> vite v5 ready', 'ECONNRESET']);
  assert.ok(!JSON.stringify(lines).includes('{"error"'));
});

// ------------------------------------------------------------
// source-level locks (no regression of A6/A7 or the i18n wiring)
// ------------------------------------------------------------
test('source keeps the A7 fresh-read / immediate-visible fixes and all 8 err.* keys', () => {
  const runAgentStart = STORE_SRC.indexOf('runAgent: async');
  const body = STORE_SRC.slice(runAgentStart, STORE_SRC.indexOf('ingestAgentEvent:', runAgentStart));
  assert.ok(body.includes('const fresh = get();'), 'fresh read at the IPC boundary intact');
  assert.ok(body.includes('runStartedAt: pressAt'), 'immediate liveness clock intact');
  assert.ok(body.includes('runActivity: { phase: \'preparing\''), 'immediate activity strip intact');
  assert.ok(body.includes('model: runModel'), 'validated model still sent');
  for (const key of [
    'err.run.badParams', 'err.run.noUserMessage', 'err.run.rateLimited', 'err.run.providerUnavailable',
    'err.setup.noModel', 'err.setup.noWorkspace', 'err.setup.noApiKey', 'err.setup.noCredits',
  ]) {
    assert.ok(STORE_SRC.includes(key), `${key} must be wired in store.ts`);
  }
});
