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
// v11.28 — THE WRITTEN REPORT IS A TOAST, NOT A CHAT CARD
//
// The founder: "NO report card in chat, but أريد ريبورت كتابي عن اللي صار
// when the AI stops/finishes." Drives the REAL bundled store through every
// terminal path and asserts:
//   • a task_report adds ZERO transcript rows (no model:'task-report' card);
//   • exactly ONE localized toast per run, carrying the REAL summary + the
//     real file/command/duration counts (no raw JSON);
//   • EN and AR are each monolingual;
//   • error / abort / silent end / no-session paths ALL produce a toast;
//   • repeated / late terminal events never duplicate it;
//   • the full slice survives in lastTaskReport for programmatic use.
//
//   node --test --test-force-exit tests/v1128-report-toast.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1128-'));
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

const bridge = new Proxy(
  {},
  {
    get(_t, key) {
      if (key === 'then' || typeof key === 'symbol') return undefined;
      return (...args) => {
        if (key === 'gitStatus') return Promise.resolve({ isRepo: false, branch: '', changed: [] });
        if (key === 'previewStatus') {
          return Promise.resolve({
            dev: { running: false, state: 'idle', lines: [], agentSources: [] },
            static: { running: false },
            ports: [],
          });
        }
        if (key === 'saveSettings' || key === 'saveSession' || key === 'agentRun') return Promise.resolve();
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
const ws = join(tmp, 'ws');
const ingest = (e) => useStore.getState().ingestAgentEvent(e);
const toast = () => useStore.getState().lastReportToast;
const msgs = () => useStore.getState().session?.messages ?? [];
const cards = () => msgs().filter((m) => m.model === 'task-report');
const arabic = (s) => /\p{Script=Arabic}/u.test(String(s ?? ''));
const englishProse = (s) => /[A-Za-z][a-z]+\s+[A-Za-z][a-z]+\s+[A-Za-z][a-z]+/.test(String(s ?? ''));

function seed(language = 'en', withSession = true) {
  useStore.getState().resetProofForTurn(); // fresh per-run ledger (toastShown=false)
  const prev = useStore.getState();
  useStore.setState({
    wsPath: ws,
    session: withSession
      ? {
          id: 's1',
          title: 't',
          workspace: ws,
          messages: [
            { id: 'u1', role: 'user', kind: 'text', content: 'build the feature', timestamp: Date.now() },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messageCount: 1,
          totalTokens: 0,
          totalCostUsd: 0,
        }
      : null,
    settings: { ...prev.settings, language, model: { provider: 'anthropic', model: 'claude-sonnet-5.5' } },
    running: true,
    runStartedAt: Date.now(),
    runActivity: { phase: 'preparing', startedAt: Date.now(), at: Date.now() },
    runPhase: 'preparing',
    runRecovery: null,
    notice: null,
    lastTaskReport: null,
    lastReportToast: null, // resets the seq counter for this run
    continueHint: null,
    proof: { status: 'unproven', gates: [], updatedAt: 0, mutation: null },
    proofVisible: false,
    previewOpen: false,
    previewError: null,
    previewUrl: '',
    previewWs: '',
    previewAuto: null,
  });
}

// ------------------------------------------------------------
// 1 — task_report: NO chat row, ONE toast with the real summary + counts
// ------------------------------------------------------------
test('task_report adds no transcript row and emits exactly one honest toast', () => {
  seed('en');
  const before = msgs().length;
  ingest({
    type: 'task_report',
    outcome: 'completed',
    summary: 'Implemented the login flow and fixed the broken header',
    files: ['src/Login.tsx', 'src/Header.tsx'],
    commands: [{ cmd: 'npm test', ok: true }, { cmd: 'npm run build', ok: true }],
    nextSteps: [],
    durationMs: 2500,
  });
  assert.equal(cards().length, 0, 'no model:task-report card in the transcript');
  assert.equal(msgs().length, before, 'not a single transcript row was added');
  assert.equal(toast()?.seq, 1, 'exactly one report toast');
  const t = toast().title;
  assert.match(t, /Implemented the login flow/, 'real engine summary is shown');
  assert.match(t, /2 files/, 'real file count');
  assert.match(t, /2 commands/, 'real command count');
  assert.match(t, /2\.5s/, 'real duration');
  assert.ok(!t.includes('{') && !t.includes('"'), 'no raw JSON in the toast');
  assert.equal(toast().severity, 'success');
  assert.equal(useStore.getState().lastTaskReport.outcome, 'completed', 'slice kept for /report');
  assert.equal(useStore.getState().lastTaskReport.summary, 'Implemented the login flow and fixed the broken header');
  assert.equal(useStore.getState().running, false);
});

// ------------------------------------------------------------
// 2 — one language per selected locale (AR / EN), no mixed prose
// ------------------------------------------------------------
test('EN and AR report toasts are each monolingual', () => {
  seed('en');
  ingest({
    type: 'task_report', outcome: 'completed',
    summary: 'Refactored the parser and added regression tests for it',
    files: ['a.ts'], commands: [{ cmd: 'npm test', ok: true }], nextSteps: [], durationMs: 900,
  });
  const en = toast().title;
  assert.ok(!arabic(en), 'EN toast has no Arabic script');
  assert.ok(englishProse(en), 'EN toast has real English prose');

  seed('ar');
  ingest({
    type: 'task_report', outcome: 'completed',
    summary: 'أعدت بناء المحلل وأضفت اختبارات انحدار شاملة',
    files: ['أ.ts'], commands: [{ cmd: 'npm test', ok: true }], nextSteps: [], durationMs: 900,
  });
  const ar = toast().title;
  assert.ok(arabic(ar), 'AR toast uses Arabic script');
  assert.ok(!englishProse(ar), 'AR toast has no English prose run');
  assert.ok(/ملفات/.test(ar) && /أوامر/.test(ar), 'AR counts are localized too');
});

test('a wrong-language / raw-JSON engine summary is re-localized, never pasted', () => {
  seed('ar');
  ingest({
    type: 'task_report', outcome: 'completed',
    summary: '{"error":{"message":"spawn ENOENT while building the app"}}',
    files: [], commands: [], nextSteps: [], durationMs: 10,
  });
  const ar = toast().title;
  assert.ok(arabic(ar), 'AR toast stays Arabic');
  assert.ok(!englishProse(ar));
  assert.ok(!ar.includes('{') && !ar.includes('spawn'), 'no raw provider JSON in the toast');
});

// ------------------------------------------------------------
// 3 — no duplicate toast per run, even with repeated / late terminal events
// ------------------------------------------------------------
test('error → task_report → turn_end → late duplicate yields exactly one toast', () => {
  seed('en');
  ingest({ type: 'error', message: 'socket hang up' });
  assert.equal(toast(), null, 'provisional error does not toast before the run settles');
  ingest({
    type: 'task_report', outcome: 'error',
    summary: 'Run failed: the provider dropped the connection mid-build',
    files: ['partial.ts'], commands: [{ cmd: 'npm test', ok: false }], nextSteps: [], durationMs: 40,
  });
  assert.equal(toast()?.seq, 1);
  const first = toast().title;
  ingest({ type: 'turn_end' });
  ingest({ type: 'task_report', outcome: 'completed', summary: 'late', files: [], commands: [], nextSteps: [], durationMs: 0 });
  ingest({ type: 'error', message: 'late error' });
  assert.equal(toast()?.seq, 1, 'still exactly one toast for this run');
  assert.equal(toast().title, first, 'the final toast is not overwritten by a stale event');
  assert.equal(cards().length, 0, 'still no chat card');
});

// ------------------------------------------------------------
// 4 — EVERY terminal path produces a toast (never nothing)
// ------------------------------------------------------------
test('error-only + turn_end emits one localized failure toast', () => {
  for (const language of ['en', 'ar']) {
    seed(language);
    ingest({ type: 'error', message: 'Provider error 500: upstream unavailable' });
    ingest({ type: 'turn_end' });
    assert.equal(toast()?.seq, 1, `${language}: error-only path toasts once`);
    assert.equal(toast().severity, 'error');
    assert.equal(useStore.getState().lastTaskReport.outcome, 'error');
    if (language === 'ar') assert.ok(arabic(toast().title) && !englishProse(toast().title));
    else assert.ok(!arabic(toast().title));
    assert.equal(cards().length, 0);
  }
});

test('aborted emits one warn toast; silent turn_end emits one toast with real counts', () => {
  seed('en');
  ingest({ type: 'aborted' });
  ingest({ type: 'turn_end' });
  assert.equal(toast()?.seq, 1, 'abort path toasts once');
  assert.equal(toast().severity, 'warn');
  assert.equal(cards().length, 0);

  seed('en');
  ingest({ type: 'tool_start', toolCallId: 'w1', name: 'write_file', args: { path: 'src/App.tsx' } });
  ingest({ type: 'tool_result', toolCallId: 'w1', ok: true, output: 'ok' });
  ingest({ type: 'message_end', stopReason: 'end_turn' });
  ingest({ type: 'turn_end' });
  assert.equal(toast()?.seq, 1, 'silent end toasts once');
  assert.match(toast().title, /1 files/, 'counts come from real evidence');
  assert.equal(cards().length, 0);
});

test('a task_report with no session still emits one toast (no transcript to add a row to)', () => {
  seed('en', false);
  ingest({
    type: 'task_report', outcome: 'completed', summary: 'Done with the offline migration',
    files: ['db.sql'], commands: [], nextSteps: [], durationMs: 15,
  });
  assert.equal(toast()?.seq, 1);
  assert.match(toast().title, /Done with the offline migration/);
  assert.equal(useStore.getState().lastTaskReport.outcome, 'completed');
  ingest({ type: 'turn_end' });
  assert.equal(toast()?.seq, 1, 'late turn_end does not duplicate the no-session toast');
});

// ------------------------------------------------------------
// 5 — source lock: the transcript card is gone from the store
// ------------------------------------------------------------
test('source no longer builds a task-report transcript card', () => {
  assert.ok(!/function reportCard\(/.test(STORE_SRC), 'reportCard helper removed');
  assert.match(STORE_SRC, /function rrEmitReportToast\(/, 'single-toast emitter present');
  assert.match(STORE_SRC, /chat\.report\.done/, 'bilingual chat.report.* keys used');
  assert.match(STORE_SRC, /err\.run\.providerUnavailable/, 'bilingual err.* key used');
  assert.match(STORE_SRC, /toastShown/, 'per-run dedupe latch present');
});
