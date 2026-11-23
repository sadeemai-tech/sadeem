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
// v11.26 — WRITTEN REPORT GUARANTEE + WEB PREVIEW AUTO-OPEN
//
// The founder: "الذكاء الاصطناعي لازم يعطيني ريبورت كتابي عن اللي صار"
// + "كل ما ينتهي من بناء ملف يعاين يفتح المعاينة تبع التطبيق".
//
// Drives the REAL bundled store through every terminal path and asserts:
//   • exactly ONE written task-report card, always, and running:false;
//   • a missing engine report is rebuilt HONESTLY from seen events;
//   • no late terminal event can add a stale row;
//   • a successful web-file write / build opens the in-app preview AFTER the
//     run settles, but never mid-write, never for non-web files, never over a
//     user-closed preview, and never twice when the engine already asked.
//
//   node --test --test-force-exit tests/v1126-store-report.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1126-'));
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

const preview = {
  staticStart: { ok: true, url: 'http://localhost:4173' },
  devStart: { ok: true },
  staticCalls: [],
  devCalls: [],
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
        if (key === 'previewStaticStart') {
          preview.staticCalls.push(args[0]);
          return Promise.resolve(preview.staticStart);
        }
        if (key === 'previewDevStart') {
          preview.devCalls.push(args);
          return Promise.resolve(preview.devStart);
        }
        if (key === 'previewStatus') return Promise.resolve(preview.status);
        if (key === 'gitStatus') return Promise.resolve({ isRepo: false, branch: '', changed: [] });
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
const tick = () => new Promise((r) => setImmediate(r));

// v11.28 — no transcript card anymore; the one owner surface is the localized
// toast. Map it to a card-shaped view for the existing honesty assertions.
const cards = () => {
  const s = useStore.getState();
  if (!s.lastReportToast) return [];
  const r = s.lastTaskReport ?? {};
  return [{
    content: JSON.stringify({
      summary: s.lastReportToast.title,
      severity: s.lastReportToast.severity,
      files: r.files ?? [],
      commands: r.commands ?? [],
      durationMs: r.durationMs ?? 0,
    }),
  }];
};
const payload = (m) => JSON.parse(m.content);
const arabic = (s) => /\p{Script=Arabic}/u.test(String(s ?? ''));
const englishProse = (s) => /[A-Za-z][a-z]+\s+[A-Za-z][a-z]+\s+[A-Za-z][a-z]+/.test(String(s ?? ''));

function seed(language = 'en', extra = {}) {
  preview.staticCalls.length = 0;
  preview.devCalls.length = 0;
  preview.staticStart = { ok: true, url: 'http://localhost:4173' };
  preview.devStart = { ok: true };
  // resetProofForTurn arms a genuinely fresh ledger, then simulate the send.
  useStore.getState().resetProofForTurn();
  const prev = useStore.getState();
  useStore.setState({
    wsPath: ws,
    session: {
      id: 's1',
      title: 't',
      workspace: ws,
      messages: [
        { id: 'u1', role: 'user', kind: 'text', content: 'build the thing', timestamp: Date.now() },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 1,
      totalTokens: 0,
      totalCostUsd: 0,
    },
    settings: { ...prev.settings, language, model: { provider: 'anthropic', model: 'claude-sonnet-5.5' } },
    running: true,
    runStartedAt: Date.now(),
    runActivity: { phase: 'preparing', startedAt: Date.now(), at: Date.now() },
    runPhase: 'preparing',
    continueHint: null,
    lastTaskReport: null,
  lastReportToast: null,
    previewOpen: false,
    previewError: null,
    previewUrl: '',
    previewWs: '',
    previewAuto: null,
    proof: { status: 'unproven', gates: [], updatedAt: 0, mutation: null },
    proofVisible: false,
    ...extra,
  });
}

function writeFile(path, id = 'w1', ok = true) {
  ingest({ type: 'tool_start', toolCallId: id, name: 'write_file', args: { path } });
  ingest({ type: 'tool_result', toolCallId: id, ok, output: ok ? 'written' : 'denied' });
}
function runCmd(cmd, id = 'c1', ok = true) {
  ingest({ type: 'tool_start', toolCallId: id, name: 'run_command', args: { cmd } });
  ingest({ type: 'tool_result', toolCallId: id, ok, output: ok ? 'done' : 'failed' });
}

// ------------------------------------------------------------
// 1 — exactly ONE written report on EVERY terminal path
// ------------------------------------------------------------
test('completed / error / abort / silent end each leave exactly one report card and clear running', () => {
  const paths = [
    { name: 'completed(task_report)', events: [
      { type: 'task_report', outcome: 'completed', summary: 'done', files: [], commands: [], nextSteps: [], durationMs: 10 },
      { type: 'turn_end' },
    ], outcome: 'completed' },
    { name: 'error(error only)', events: [
      { type: 'error', message: 'socket hang up' },
      { type: 'turn_end' },
    ], outcome: 'error' },
    { name: 'error(error + task_report)', events: [
      { type: 'error', message: 'socket hang up' },
      { type: 'task_report', outcome: 'error', summary: 'failed', files: [], commands: [], nextSteps: [], durationMs: 5 },
      { type: 'turn_end' },
    ], outcome: 'error' },
    { name: 'aborted', events: [
      { type: 'aborted' },
      { type: 'turn_end' },
    ], outcome: 'aborted' },
    { name: 'silent provider end', events: [
      { type: 'text_delta', text: 'here is the answer' },
      { type: 'message_end' },
      { type: 'turn_end' },
    ], outcome: 'completed' },
  ];
  for (const p of paths) {
    seed('en');
    for (const e of p.events) ingest(e);
    assert.equal(cards().length, 1, `${p.name}: exactly one written report`);
    assert.equal(useStore.getState().lastTaskReport.outcome, p.outcome, `${p.name}: honest outcome`);
    assert.equal(useStore.getState().running, false, `${p.name}: running cleared`);
    assert.equal(useStore.getState().runActivity, null, `${p.name}: no ghost activity strip`);
    assert.equal(useStore.getState().runStartedAt, null, `${p.name}: no ghost clock`);
  }
});

test('a silent end rebuilds the report from files/commands/duration actually seen', () => {
  seed('en');
  writeFile('src/App.tsx');
  writeFile('src/styles.css', 'w2');
  runCmd('npm run build', 'c1');
  ingest({ type: 'message_end', stopReason: 'end_turn' });
  ingest({ type: 'turn_end' });
  const r = useStore.getState().lastTaskReport;
  assert.equal(r.outcome, 'completed');
  assert.deepEqual(r.files, ['src/App.tsx', 'src/styles.css']);
  assert.ok(r.commands.some((c) => c.cmd === 'npm run build' && c.ok));
  assert.ok(r.durationMs >= 0);
  assert.equal(payload(cards()[0]).files.length, 2, 'the written card carries the real file evidence');
});

test('late terminal events cannot add a second card or re-open the run', () => {
  seed('en');
  ingest({ type: 'task_report', outcome: 'completed', summary: 'done', files: [], commands: [], nextSteps: [], durationMs: 1 });
  for (const e of [
    { type: 'error', message: 'late error' },
    { type: 'aborted' },
    { type: 'task_report', outcome: 'error', summary: 'late report', files: [], commands: [], nextSteps: [], durationMs: 0 },
  ]) {
    assert.doesNotThrow(() => ingest(e));
    assert.equal(cards().length, 1, `${e.type} after a report never adds a stale row`);
  }
  ingest({ type: 'turn_end' });
  assert.equal(cards().length, 1);
  assert.equal(useStore.getState().running, false);
  // events after turn_end are stale too
  ingest({ type: 'error', message: 'zombie' });
  assert.equal(cards().length, 1);
});

// ------------------------------------------------------------
// 2 — single language, no raw JSON in the visible summary
// ------------------------------------------------------------
test('synthesized reports speak the selected language only and never dump raw JSON', () => {
  for (const [language, check] of [
    ['ar', (s) => arabic(s) && !englishProse(s)],
    ['en', (s) => !arabic(s)],
  ]) {
    seed(language);
    ingest({ type: 'error', message: '{"error":{"message":"spawn ENOENT","code":500}}' });
    ingest({ type: 'turn_end' });
    const r = useStore.getState().lastTaskReport;
    assert.ok(check(r.summary), `${language}: single-language summary`);
    assert.ok(!r.summary.includes('{') && !r.summary.includes('spawn ENOENT'), 'no raw provider JSON in the report');
    assert.equal(cards().length, 1);
  }
});

// ------------------------------------------------------------
// 3 — web preview auto-open (store-side, after the run settles)
// ------------------------------------------------------------
test('a successful .html write opens a STATIC preview of its directory after the run settles', async () => {
  seed('en');
  writeFile('dist/index.html');
  // no preview while the run is still streaming / mid-write
  await tick();
  assert.equal(useStore.getState().previewOpen, false, 'never mid-write');
  assert.equal(preview.staticCalls.length, 0);
  ingest({ type: 'turn_end' });
  await tick();
  assert.equal(useStore.getState().previewOpen, true, 'in-app preview opened');
  assert.equal(preview.staticCalls.length, 1);
  assert.equal(preview.staticCalls[0].replace(/\\/g, '/'), join(ws, 'dist').replace(/\\/g, '/'));
  assert.equal(useStore.getState().previewUrl, 'http://localhost:4173', 'correct URL');
});

test('a successful .tsx write opens a DEV preview; non-web files open nothing', async () => {
  seed('en');
  writeFile('notes.md', 'n1');
  writeFile('script.py', 'p1');
  ingest({ type: 'turn_end' });
  await tick();
  assert.equal(preview.staticCalls.length + preview.devCalls.length, 0, 'non-web writes never open a preview');
  assert.equal(useStore.getState().previewOpen, false);

  seed('en');
  writeFile('src/App.tsx');
  ingest({ type: 'turn_end' });
  await tick();
  assert.equal(preview.devCalls.length, 1, 'web source opens dev preview');
  assert.equal(preview.devCalls[0][0], ws);
  assert.equal(preview.devCalls[0][1], 'npm');
});

test('a successful build command opens a DEV preview; a failed write or plain test does not', async () => {
  seed('en');
  writeFile('index.html', 'f1', false); // failed write is not evidence
  ingest({ type: 'turn_end' });
  await tick();
  assert.equal(preview.staticCalls.length + preview.devCalls.length, 0, 'failed web write opens nothing');

  seed('en');
  runCmd('npm test', 't1');
  ingest({ type: 'turn_end' });
  await tick();
  assert.equal(preview.devCalls.length, 0, 'a test command is not a build');

  seed('en');
  runCmd('npm run build', 'b1');
  ingest({ type: 'turn_end' });
  await tick();
  assert.equal(preview.devCalls.length, 1, 'a real build command opens dev preview');
});

test('a user-closed preview is never overridden, and an engine preview request avoids a double-open', async () => {
  seed('en');
  useStore.getState().setPreviewOpen(false); // explicit user close
  writeFile('index.html');
  ingest({ type: 'turn_end' });
  await tick();
  assert.equal(preview.staticCalls.length, 0, 'user close is authoritative');
  assert.equal(useStore.getState().previewOpen, false);

  seed('en');
  ingest({ type: 'preview_open', url: 'http://localhost:5173', previewHint: { kind: 'static' } });
  writeFile('index.html');
  ingest({ type: 'turn_end' });
  await tick();
  assert.equal(preview.staticCalls.length, 0, 'engine already requested a preview — no local double-open');
});

test('a preview that cannot start shows the localized error card (no raw output)', async () => {
  seed('ar');
  preview.staticStart = { ok: false, error: '{"error":{"message":"spawn ENOENT"}}' };
  writeFile('dist/index.html');
  ingest({ type: 'turn_end' });
  await tick();
  const st = useStore.getState();
  assert.equal(st.previewOpen, true, 'the error card is visible');
  assert.equal(st.previewError.reason, 'startFailed');
  assert.ok(arabic(st.previewError.detail), 'localized, single language');
  assert.ok(!st.previewError.detail.includes('{') && !st.previewError.detail.includes('"message"'), 'no raw JSON / server output');
});

// ------------------------------------------------------------
// 4 — source-level locks (watchdog + exact detection rules)
// ------------------------------------------------------------
test('source keeps the watchdog report path and the exact web detection rules', () => {
  assert.match(STORE_SRC, /function rrCommitWatchdog\(/, 'watchdog synthesizes a report');
  assert.match(STORE_SRC, /rrCommitInto\(msgs, report, true, 'error'\)/, 'watchdog writes the single card');
  assert.match(STORE_SRC, /html\|tsx\|jsx\|vue\|css\|js/, 'exact web extension set');
  assert.match(STORE_SRC, /RR_BUILD_CMD/, 'real build/dev command detection');
  assert.match(STORE_SRC, /previewUserClosed/, 'user close is respected');
});
