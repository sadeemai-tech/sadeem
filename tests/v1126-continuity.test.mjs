import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// v11.26 — AGENT CONTINUITY / "NEVER END SILENTLY" CONTRACT.
//
// The founder: "مشكلة انقطاع الذكاء الاصطناعي... ممكن يوقف فجأة ولا يعطيني
// ريبورت... تأكد لا ينقطع أبداً، يقوم بمهمات طويلة جدا تستمر لساعات."
//
// Boots the REAL agent engine (electron/agent/engine.ts, esbuild-bundled)
// against a local, scripted OpenAI-compatible provider (node:http — zero
// network, zero model) and drives the failure / endurance paths that used to
// end with NO report and a stuck renderer:
//
//   CRASH      — provider dies mid-answer → ONE honest 'error' report + turn_end.
//   SLOW       — a paced 5-minute-equivalent stream (periodic deltas, idle
//                window shrunk to the 500ms floor) is NEVER killed by the
//                engine idle watchdog → ONE 'completed' report + turn_end.
//   TOOLCRASH  — the sink throws while dispatching a tool → error propagates,
//                the finally safety net still emits report + turn_end.
//   ABORT      — user abort mid-stream → ONE 'aborted' report + turn_end,
//                no error row, partial answer preserved.
//   POSTPROC   — the sink throws in the FINAL events pipeline (message_end)
//                AND on the error row (the catch itself blows through) → the
//                single finally safety net still writes an HONEST report of
//                what actually happened + turn_end.
//
// Every scenario asserts the SAME terminal invariants: runAgent RESOLVES (it
// never rejects), run_start is FIRST, exactly one task_report + one turn_end,
// turn_end is strictly LAST (no late event can re-open a row / re-set running),
// and the report outcome is HONEST (never a fabricated success).
//
// Run:
//   node --test --test-force-exit tests/v1126-continuity.test.mjs
// Debug:
//   V1126_DEBUG=1 node --test --test-force-exit tests/v1126-continuity.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1126-'));
const DEBUG = !!process.env.V1126_DEBUG;

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// ---------- electron stub with an ISOLATED userData dir ----------
const userDataDir = join(tmp, 'userdata');
mkdirSync(userDataDir, { recursive: true });
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `module.exports = {
    app: { getPath: (k) => ${JSON.stringify(userDataDir)}, whenReady: async () => true, on() {}, quit() {} },
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: { getAllWindows: () => [] },
    Notification: { isSupported: () => false },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: {}, screen: {}, powerMonitor: { on() {} },
  };`,
);

const engPath = join(tmp, 'engine.cjs');
const provPath = join(tmp, 'providers.cjs');
let engine;
try {
  bundle('electron/agent/engine.ts', engPath);
  bundle('electron/agent/providers.ts', provPath);
  engine = require(engPath);
  require(provPath);
} catch (err) {
  console.error('[v1126] ENGINE BUNDLE FAILED — no agent turn can start:', err?.message ?? err);
  throw err;
}

// ---------- SSE helpers ----------
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
function sseHeaders(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  res.flushHeaders();
}
function finishSse(res, finish, usage) {
  if (usage) res.write(`data: ${JSON.stringify({ usage, choices: [] })}\n\n`);
  res.write(sseChunk({}, finish));
  res.write('data: [DONE]\n\n');
  res.end();
}
function toolDeltas(name, args, id) {
  const half = Math.max(1, Math.floor(args.length / 2));
  return [
    { tool_calls: [{ index: 0, id, function: { name, arguments: '' } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(0, half) } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(half) } }] },
  ];
}

// ---------- scripted local provider ----------
let SCENARIO = '';
let onFirstChunk = null;

function startMock() {
  const requests = [];
  const sockets = new Set();
  const state = { n: 0 };
  const timers = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
    return t;
  };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      const sawTool = (body.messages ?? []).some((m) => m.role === 'tool');
      requests.push({ model: body.model, at: Date.now(), sawTool });
      // Secondary models (verifier / critic) get an empty completion — every
      // such gate is disabled in settings, but stay safe if one slips through.
      if (body.model !== 'continuity-live') {
        sseHeaders(res);
        finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 });
        return;
      }
      try {
        if (SCENARIO === 'crash') {
          sseHeaders(res);
          res.write(sseChunk({ content: 'Partial answer delivered before the provider died. ' }));
          // Transport death mid-stream: NO finish_reason, socket destroyed.
          later(() => { try { res.destroy(); } catch { /* gone */ } }, 40);
          return;
        }
        if (SCENARIO === 'slow') {
          sseHeaders(res);
          // 24 paced deltas at 80ms = ~2s wall-clock here, standing in for a
          // 5-MINUTE slow generation (the cadence is the contract, not the
          // literal duration). With the idle window at its 500ms floor, every
          // delta resets the watchdog — a healthy slow stream is NEVER killed.
          const parts = [
            'This ', 'is ', 'a ', 'deliberately ', 'slow ', 'stream. ',
            'Each ', 'delta ', 'arrives ', 'on ', 'time, ', 'so ', 'the ',
            'idle ', 'watchdog ', 'sees ', 'progress ', 'and ', 'never ',
            'aborts ', 'the ', 'run. ',
          ];
          let i = 0;
          const tick = () => {
            if (i < parts.length) {
              res.write(sseChunk({ content: parts[i++] }));
              later(tick, 80);
            } else {
              finishSse(res, 'stop', { prompt_tokens: 60, completion_tokens: 40 });
            }
          };
          later(tick, 30);
          return;
        }
        if (SCENARIO === 'toolcrash') {
          sseHeaders(res);
          res.write(sseChunk({ content: 'Calling a tool that will crash the sink.\n' }));
          const args = JSON.stringify({ path: 'crash.txt', content: 'never written\n' });
          for (const d of toolDeltas('write_file', args, 'call_v1126_crash')) res.write(sseChunk(d));
          finishSse(res, 'tool_calls', { prompt_tokens: 50, completion_tokens: 20 });
          return;
        }
        if (SCENARIO === 'abort') {
          sseHeaders(res);
          res.write(sseChunk({ content: 'This partial answer will be interrupted mid-stream. ' }));
          // Socket intentionally held OPEN; the test aborts after it observes
          // the first text_delta in the IO (deterministic, no race).
          return;
        }
        if (SCENARIO === 'postproc') {
          sseHeaders(res);
          if (!sawTool) {
            res.write(sseChunk({ content: 'Writing the file, then finishing.\n' }));
            const args = JSON.stringify({ path: 'postproc.txt', content: 'v1126\n' });
            for (const d of toolDeltas('write_file', args, 'call_v1126_postproc')) res.write(sseChunk(d));
            finishSse(res, 'tool_calls', { prompt_tokens: 50, completion_tokens: 20 });
          } else {
            for (const t of ['The file was written. ', 'Final answer. ']) res.write(sseChunk({ content: t }));
            finishSse(res, 'stop', { prompt_tokens: 90, completion_tokens: 30 });
          }
          return;
        }
        // Fallback.
        sseHeaders(res);
        finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 });
      } catch (err) {
        try { res.destroy(); } catch { /* gone */ }
      }
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const listening = new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  return {
    requests,
    port: listening,
    async stop() {
      for (const t of timers) clearTimeout(t);
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

// ---------- renderer-style IO that can inject sink failures ----------
function makeIo(controller, throwOn = []) {
  const events = [];
  let fetchCb = null;
  const thrown = new Set();
  return {
    events,
    send(e) {
      // Throw BEFORE recording: a broken sink never delivered the event.
      if (throwOn.includes(e.type) && !thrown.has(e.type)) {
        thrown.add(e.type);
        throw new Error(`v1126 injected sink failure on ${e.type}`);
      }
      events.push({
        type: e.type,
        at: Date.now(),
        kind: e.kind,
        phase: e.phase,
        text: e.text ?? '',
        message: e.message ?? '',
        outcome: e.outcome,
        summary: e.summary ?? '',
        toolCallId: e.toolCallId,
        stopReason: e.stopReason,
        durationMs: e.durationMs,
        partial: e.partial,
        files: e.files,
        commands: e.commands,
        nextSteps: e.nextSteps,
      });
    },
    async getDecision() { return { action: 'allow' }; },
    isAborted: () => !!(controller && controller.signal.aborted),
    onFetchSignal(cb) {
      fetchCb = cb;
      if (controller) cb(controller.signal);
    },
    get fetchCb() { return fetchCb; },
  };
}

function writeSettings(mockBase) {
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 4,
      providers: { custom: { apiKey: 'test-key', baseUrl: mockBase } },
      agent: {
        maxRetries: 0,
        autoCompact: false,
        autoVerify: false,
        selfCritique: false,
        runAndShow: false,
        criticGate: false,
        allowModelFailover: false,
      },
      doneNotifications: false,
    }),
  );
}

function dump(io, t0) {
  return io.events.map((e) =>
    `${String(e.at - t0).padStart(6)}ms  ${e.type}${e.kind ? '/' + e.kind : ''}${e.outcome ? '/' + e.outcome : ''}` +
    `  ${String(e.message || e.text || e.summary || '').slice(0, 80).replace(/\n/g, '\\n')}`,
  ).join('\n');
}

async function driveRun(scenario, opts = {}) {
  SCENARIO = scenario;
  onFirstChunk = null;
  const mock = startMock();
  const port = await mock.port;
  const mockBase = `http://127.0.0.1:${port}/v1`;
  writeSettings(mockBase);
  const ws = mkdtempSync(join(tmpdir(), 'surnia-v1126-ws-'));

  const controller = scenario === 'abort' ? new AbortController() : null;
  const io = makeIo(controller, opts.throwOn || []);
  let abortWatch = null;
  let abortFallback = null;
  if (controller) {
    abortWatch = setInterval(() => {
      if (io.events.some((e) => e.type === 'text_delta')) {
        clearInterval(abortWatch);
        clearTimeout(abortFallback);
        controller.abort();
      }
    }, 10);
    abortFallback = setTimeout(() => {
      clearInterval(abortWatch);
      if (!controller.signal.aborted) controller.abort();
    }, 45_000);
    if (abortFallback.unref) abortFallback.unref();
  }

  process.env.SURNIA_TURN_RETRY_DELAYS_MS = '5,5,5,5,5,5';
  process.env.SURNIA_PROVIDER_RETRY_BUDGET_MS = '100';
  process.env.SURNIA_PROVIDER_FAILOVER_BUDGET_MS = '100';
  process.env.SURNIA_DELTA_FLUSH_MS = '10';
  process.env.SURNIA_ENGINE_IDLE_MS = '500'; // floor — a stalled stream is caught fast
  process.env.SURNIA_EXTENDED_REASONING_MS = '0'; // strict watchdog for these scenarios
  process.env.SURNIA_SKIP_UI_GATE = '1';
  process.env.SURNIA_HOME = userDataDir;

  const t0 = Date.now();
  let thrown = null;
  try {
    await engine.runAgent({
      task: 'chat',
      sessionId: 'v1126-' + scenario + '-' + Math.random().toString(36).slice(2),
      messages: [{
        id: 'm1', role: 'user', kind: 'text', timestamp: t0,
        content: scenario === 'toolcrash' || scenario === 'postproc'
          ? 'Create a small file for me.'
          : 'Please help me with this task.',
      }],
      model: { provider: 'custom', model: 'continuity-live', maxTokens: 2048 },
      mode: 'fullAccess',
      workspace: ws,
      apiKey: 'test-key',
      baseUrl: mockBase,
    }, io);
  } catch (err) {
    thrown = err;
  }
  if (abortWatch) clearInterval(abortWatch);
  if (abortFallback) clearTimeout(abortFallback);
  if (DEBUG) console.error(`\n===== ${scenario.toUpperCase()} TIMELINE =====\n${dump(io, t0)}`);
  return { mock, ws, io, t0, thrown };
}

// ---------- shared terminal invariants ----------
function assertCleanTerminal(io, expectedOutcome, label) {
  const ev = io.events;
  const first = ev[0];
  assert.ok(first, `${label}: engine emitted events`);
  assert.equal(first.type, 'sys_notice', `${label}: FIRST event is sys_notice`);
  assert.equal(first.kind, 'run_start', `${label}: run_start is FIRST (13ms contract)`);

  const reports = ev.filter((e) => e.type === 'task_report');
  assert.equal(reports.length, 1, `${label}: EXACTLY ONE task_report (got ${reports.length})`);
  assert.equal(reports[0].outcome, expectedOutcome, `${label}: honest outcome = ${expectedOutcome} (got ${reports[0].outcome})`);

  const ends = ev.filter((e) => e.type === 'turn_end');
  assert.equal(ends.length, 1, `${label}: EXACTLY ONE turn_end (got ${ends.length})`);
  assert.equal(ev[ev.length - 1].type, 'turn_end', `${label}: turn_end is STRICTLY LAST (late events cannot re-open a row)`);
  assert.ok(Number.isFinite(reports[0].durationMs) && reports[0].durationMs >= 0, `${label}: report carries a real duration`);
  assert.ok(Array.isArray(reports[0].files), `${label}: report carries the files-changed evidence`);
  assert.ok(Array.isArray(reports[0].commands), `${label}: report carries the commands-run evidence`);
  assert.ok(Array.isArray(reports[0].nextSteps) && reports[0].nextSteps.length > 0, `${label}: report carries next steps`);

  const errors = ev.filter((e) => e.type === 'error');
  assert.ok(errors.length <= 1, `${label}: at most ONE error row`);
  if (errors.length) assert.equal(reports[0].outcome, 'error', `${label}: an error row forces an 'error' report`);

  const starts = ev.filter((e) => e.type === 'tool_start').map((e) => e.toolCallId).sort();
  const results = ev.filter((e) => e.type === 'tool_result').map((e) => e.toolCallId).sort();
  assert.deepEqual(starts, results, `${label}: tool ids pair 1:1`);
}

// ============================================================
test('v1126 CRASH: provider dies mid-answer → one honest error report, no silent stop', { timeout: 60_000 }, async () => {
  const { mock, ws, io, thrown } = await driveRun('crash');
  try {
    assert.equal(thrown, null, `runAgent must RESOLVE, never reject (got: ${thrown?.stack ?? thrown})`);
    assertCleanTerminal(io, 'error', 'crash');
    const err = io.events.find((e) => e.type === 'error');
    assert.ok(err, 'crash: an error row reached the user');
    const report = io.events.find((e) => e.type === 'task_report');
    assert.ok(report.summary.length > 0, 'crash: the report states what happened (not a fabricated success)');
    assert.equal(io.events.some((e) => e.type === 'aborted'), false, 'crash: provider death is not mislabeled as user abort');
  } finally {
    await mock.stop();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('v1126 SLOW: paced 5-minute-equivalent stream completes — idle watchdog never fires on progress', { timeout: 90_000 }, async () => {
  const { mock, ws, io, thrown } = await driveRun('slow');
  try {
    assert.equal(thrown, null, `runAgent must RESOLVE (got: ${thrown?.stack ?? thrown})`);
    assertCleanTerminal(io, 'completed', 'slow');
    const text = io.events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
    assert.match(text, /deliberately slow stream/, `slow: the full slow answer arrived (got: ${text.slice(0, 120)})`);
    assert.equal(io.events.filter((e) => e.type === 'error').length, 0, 'slow: no error row');
    assert.equal(io.events.some((e) => e.type === 'aborted'), false, 'slow: no abort');
    // The watchdog must NOT have declared silence on a progressing stream.
    const watchdogNoise = io.events.filter((e) =>
      (e.type === 'sys_notice' && /stream interrupted|idle watchdog|auto-continuing/i.test(e.text)) ||
      (e.type === 'error' && /watchdog|idle/i.test(e.message)),
    );
    assert.equal(watchdogNoise.length, 0, `slow: no watchdog/stall recovery fired (got: ${watchdogNoise.map((e) => e.text || e.message).join('; ')})`);
    assert.ok(io.events.filter((e) => e.type === 'heartbeat' && e.phase === 'streaming').length >= 0, 'slow: streaming liveness pulses are permitted');
  } finally {
    await mock.stop();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('v1126 TOOLCRASH: sink throws during tool dispatch → finally emits report + turn_end', { timeout: 60_000 }, async () => {
  const { mock, ws, io, thrown } = await driveRun('toolcrash', { throwOn: ['tool_start'] });
  try {
    assert.equal(thrown, null, `runAgent must RESOLVE even when the sink throws (got: ${thrown?.stack ?? thrown})`);
    assertCleanTerminal(io, 'error', 'toolcrash');
    const report = io.events.find((e) => e.type === 'task_report');
    assert.ok(report.summary.length > 0, 'toolcrash: the report is honest, not a fabricated success');
    assert.equal(report.outcome, 'error', 'toolcrash: a crashed tool dispatch is an error, never completed');
  } finally {
    await mock.stop();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('v1126 ABORT: user abort mid-stream → one aborted report, no error, partial preserved', { timeout: 60_000 }, async () => {
  const { mock, ws, io, thrown } = await driveRun('abort');
  try {
    assert.equal(thrown, null, `runAgent must RESOLVE (got: ${thrown?.stack ?? thrown})`);
    assertCleanTerminal(io, 'aborted', 'abort');
    assert.equal(io.events.filter((e) => e.type === 'aborted').length, 1, 'abort: exactly one aborted event');
    assert.equal(io.events.filter((e) => e.type === 'error').length, 0, 'abort: user abort is NOT an error');
    const partial = io.events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
    assert.match(partial, /partial answer/i, 'abort: already-shown partial answer is preserved');
  } finally {
    await mock.stop();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('v1126 POSTPROC: throw in final pipeline AND in the catch → single finally net reports honestly', { timeout: 60_000 }, async () => {
  // Throwing on 'message_end' makes the main body blow through into the catch;
  // throwing on 'error' makes the catch itself blow through. The ONLY thing
  // left is the finally safety net — it must still write ONE honest report
  // (carrying the real injected failure) and a final turn_end.
  const { mock, ws, io, thrown } = await driveRun('postproc', { throwOn: ['message_end', 'error'] });
  try {
    assert.equal(thrown, null, `runAgent must RESOLVE even through a blown catch (got: ${thrown?.stack ?? thrown})`);
    assertCleanTerminal(io, 'error', 'postproc');
    const report = io.events.find((e) => e.type === 'task_report');
    assert.equal(report.outcome, 'error', 'postproc: an aborted pipeline is an error, never a fabricated completed');
    assert.ok(
      /sink failure|unexpected|error|retry|injected/i.test(report.summary),
      `postproc: the note reflects the real failure, not a clean success (got: ${report.summary})`,
    );
    assert.ok((report.durationMs ?? 0) >= 0, 'postproc: the fallback report carries a real duration');
  } finally {
    await mock.stop();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

after(() => {
  for (const k of [
    'SURNIA_TURN_RETRY_DELAYS_MS', 'SURNIA_PROVIDER_RETRY_BUDGET_MS',
    'SURNIA_PROVIDER_FAILOVER_BUDGET_MS', 'SURNIA_DELTA_FLUSH_MS',
    'SURNIA_ENGINE_IDLE_MS', 'SURNIA_EXTENDED_REASONING_MS',
    'SURNIA_SKIP_UI_GATE', 'SURNIA_HOME',
  ]) delete process.env[k];
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});
