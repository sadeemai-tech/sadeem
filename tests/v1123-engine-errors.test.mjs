import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// v11.23 — ENGINE ERROR SURFACING (the founder: "الذكاء الاصطناعي لا يعمل،
// كل شوي بيطلع لي غلط... أصلح كل شيء").
//
// Boots the REAL agent engine (electron/agent/engine.ts, esbuild-bundled)
// against a local, scripted OpenAI-compatible provider (node:http — zero
// network, zero model) and drives EVERY failure path that used to surface an
// error to the user incorrectly:
//
//   NETWORK  — transport death → ONE classified error + error task_report.
//   402      — insufficient credits → ONE billing-classified error (no raw
//              provider JSON), error task_report.
//   429→200  — transient rate limit recovered on the SAME provider → ZERO
//              error rows, completed task_report.
//   BAD-ARGS — a tool call with malformed JSON args → exactly one paired
//              tool_start/tool_result with the SAME id, ok:false, no error row.
//   ABORTED  — the stream is interrupted mid-answer → ONE aborted event,
//              aborted task_report, no error row, no stuck `running` state.
//
// Every scenario asserts the SAME terminal invariants: run_start first,
// exactly one task_report + one turn_end, turn_end strictly LAST (no late
// events after the renderer cleared streaming), tool ids pair 1:1, no
// duplicate/invalid rows, and the report outcome agrees with the error rows.
//
// Run:
//   node --test --test-force-exit tests/v1123-engine-errors.test.mjs
// Debug:
//   V1123_DEBUG=1 node --test --test-force-exit tests/v1123-engine-errors.test.mjs
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
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1123-engine-'));
const DEBUG = !!process.env.V1123_DEBUG;

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
  console.error('[v1123] ENGINE BUNDLE FAILED — no agent turn can start:', err?.message ?? err);
  throw err;
}

// ---------- SSE helpers (same shape as the other live harnesses) ----------
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
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      requests.push({
        model: body.model,
        at: Date.now(),
        sawTool: (body.messages ?? []).some((m) => m.role === 'tool'),
      });
      try {
        if (SCENARIO === 'network') {
          // Transport death: no HTTP response at all.
          try { res.destroy(); } catch { /* gone */ }
          return;
        }
        if (SCENARIO === '402') {
          const payload = Buffer.from(JSON.stringify({
            error: { message: 'Insufficient credits. This account never purchased credits. Add credits.', code: 402 },
          }));
          res.writeHead(402, { 'content-type': 'application/json', 'content-length': payload.length });
          res.end(payload);
          return;
        }
        if (SCENARIO === '400-json' || SCENARIO === '500-json') {
          // The founder's exact leak shape: a RAW JSON body from the provider.
          const status = SCENARIO === '400-json' ? 400 : 500;
          const payload = Buffer.from(JSON.stringify({
            error: { message: 'Backend rejected the request: token {"kind":"bad","n":7} expired', code: status },
          }));
          res.writeHead(status, { 'content-type': 'application/json', 'content-length': payload.length });
          res.end(payload);
          return;
        }
        if (SCENARIO === '429-then-success') {
          state.n++;
          if (state.n <= 2) {
            const payload = Buffer.from(JSON.stringify({ error: { message: 'Rate limited', type: 'rate_limit_error' } }));
            res.writeHead(429, { 'content-type': 'application/json', 'content-length': payload.length });
            res.end(payload);
            return;
          }
          sseHeaders(res);
          for (const t of ['Recovered after a transient 429. ', 'Everything is fine now. ']) {
            res.write(sseChunk({ content: t }));
          }
          finishSse(res, 'stop', { prompt_tokens: 20, completion_tokens: 10 });
          return;
        }
        if (SCENARIO === 'malformed-tool') {
          const sawTool = (body.messages ?? []).some((m) => m.role === 'tool');
          sseHeaders(res);
          if (!sawTool) {
            res.write(sseChunk({ content: 'Calling a tool with broken arguments.\n' }));
            // Trailing comma => JSON.parse throws in the engine's prepared step.
            const badArgs = '{"path": "created.txt", "content": "hello",}';
            for (const d of toolDeltas('write_file', badArgs, 'call_bad_v1123_1')) res.write(sseChunk(d));
            finishSse(res, 'tool_calls', { prompt_tokens: 50, completion_tokens: 20 });
          } else {
            for (const t of ['The malformed call was reported back to me. ', 'Done. ']) {
              res.write(sseChunk({ content: t }));
            }
            finishSse(res, 'stop', { prompt_tokens: 80, completion_tokens: 20 });
          }
          return;
        }
        if (SCENARIO === 'aborted') {
          sseHeaders(res);
          res.write(sseChunk({ content: 'This partial answer will be interrupted mid-stream. ' }));
          // The provider keeps the socket OPEN. The test aborts only AFTER it
          // has observed the first text_delta in the IO (driveRun), so the
          // partial answer is deterministically visible before the abort —
          // no race with SSE parsing / the engine's delta batcher.
          return;
        }
        // Fallback (should not be reached by these scenarios).
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
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

// ---------- renderer-style IO that records EVERY field we assert on ----------
function makeIo(controller) {
  const events = [];
  let fetchCb = null;
  return {
    events,
    send(e) {
      events.push({
        type: e.type,
        at: Date.now(),
        kind: e.kind,
        phase: e.phase,
        text: e.text ?? '',
        message: e.message ?? '',
        output: e.output ?? '',
        outcome: e.outcome,
        summary: e.summary ?? '',
        toolCallId: e.toolCallId,
        name: e.name,
        ok: e.ok,
        stopReason: e.stopReason,
      });
    },
    async getDecision() { return { action: 'allow' }; },
    isAborted: () => !!(controller && controller.signal.aborted),
    onFetchSignal(cb) {
      fetchCb = cb;
      // v1123: hand the engine our controller the moment it registers, so a
      // mid-stream abort reaches every fetch and the loop (not just isAborted).
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
    `${e.toolCallId ? ' id=' + e.toolCallId : ''}  ${String(e.message || e.output || e.text || e.summary || '').slice(0, 80).replace(/\n/g, '\\n')}`,
  ).join('\n');
}

async function driveRun(scenario) {
  SCENARIO = scenario;
  onFirstChunk = null;
  const mock = startMock();
  const port = await mock.port;
  const mockBase = `http://127.0.0.1:${port}/v1`;
  writeSettings(mockBase);
  const ws = mkdtempSync(join(tmpdir(), 'surnia-v1123-ws-'));

  const controller = scenario === 'aborted' ? new AbortController() : null;
  const io = makeIo(controller);
  // v1123: abort ONLY once the first text_delta has actually reached the IO.
  // The mock holds the SSE socket open until this fires, so there is no race
  // with SSE parsing or the engine's ~10ms delta batcher.
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
    }, 45_000); // safety valve: never hang the suite
    if (abortFallback.unref) abortFallback.unref();
  }

  // Shrink every retry/stall knob: the test must finish in well under a second
  // per scenario while still exercising the REAL retry/failover machinery.
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = '5,5,5,5,5,5';
  process.env.SURNIA_PROVIDER_RETRY_BUDGET_MS = '100';
  process.env.SURNIA_PROVIDER_FAILOVER_BUDGET_MS = '100';
  process.env.SURNIA_DELTA_FLUSH_MS = '10';
  // 30s: the scripted mock is LOCAL but this suite bundles two large engines
  // per process; a 500ms idle window killed the response before the provider
  // could answer, producing watchdog retries that are NOT a 402 retry.
  process.env.SURNIA_ENGINE_IDLE_MS = '30000';
  process.env.SURNIA_SKIP_UI_GATE = '1';
  process.env.SURNIA_HOME = userDataDir;

  const t0 = Date.now();
  let thrown = null;
  try {
    await engine.runAgent({
      task: 'chat',
      sessionId: 'v1123-' + scenario + '-' + Math.random().toString(36).slice(2),
      messages: [{
        id: 'm1', role: 'user', kind: 'text', timestamp: t0,
        content: scenario === 'malformed-tool'
          ? 'Write created.txt with hello in it.'
          : 'Please help me with this task.',
      }],
      model: { provider: 'custom', model: 'errors-live', maxTokens: 2048 },
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

// ---------- shared terminal invariants (the heart of this suite) ----------
function assertCleanTerminal(io, expectedOutcome, label) {
  const ev = io.events;
  const first = ev[0];
  assert.ok(first, `${label}: engine emitted events`);
  assert.equal(first.type, 'sys_notice', `${label}: FIRST event is sys_notice`);
  assert.equal(first.kind, 'run_start', `${label}: FIRST event is run_start (13ms contract, no setup ahead of it)`);

  const reports = ev.filter((e) => e.type === 'task_report');
  assert.equal(reports.length, 1, `${label}: exactly ONE task_report (got ${reports.length})`);
  assert.equal(reports[0].outcome, expectedOutcome, `${label}: task_report outcome = ${expectedOutcome} (got ${reports[0].outcome})`);

  const ends = ev.filter((e) => e.type === 'turn_end');
  assert.equal(ends.length, 1, `${label}: exactly ONE turn_end (got ${ends.length})`);
  assert.equal(ev[ev.length - 1].type, 'turn_end', `${label}: turn_end is strictly LAST — no late events after the renderer cleared streaming`);

  // An error row can only ever coexist with an 'error' report — never success.
  const errors = ev.filter((e) => e.type === 'error');
  assert.ok(errors.length <= 1, `${label}: at most ONE error row (got ${errors.length})`);
  if (errors.length) assert.equal(reports[0].outcome, 'error', `${label}: an error row forces an 'error' report`);

  // tool_start / tool_result must form complete pairs with identical ids.
  const starts = ev.filter((e) => e.type === 'tool_start').map((e) => e.toolCallId).sort();
  const results = ev.filter((e) => e.type === 'tool_result').map((e) => e.toolCallId).sort();
  assert.deepEqual(starts, results, `${label}: tool ids pair 1:1 (starts=${JSON.stringify(starts)} results=${JSON.stringify(results)})`);
}

// ============================================================
test('v1123 NETWORK: transport death → one classified error, error report, no stuck state', { timeout: 60_000 }, async () => {
  const { mock, ws, io, thrown } = await driveRun('network');
  try {
    assert.equal(thrown, null, `runAgent must not throw (got: ${thrown?.stack ?? thrown})`);
    assertCleanTerminal(io, 'error', 'network');
    const err = io.events.find((e) => e.type === 'error');
    assert.ok(err, 'network: an error row reached the user');
    assert.match(err.message, /network error/i, `network: classified as a network error (got: ${err.message})`);
    assert.equal(io.events.some((e) => e.type === 'aborted'), false, 'network: not mislabeled as an abort');
  } finally {
    await mock.stop();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('v1123 402: insufficient credits → one billing-classified error, no raw JSON row', { timeout: 60_000 }, async () => {
  const { mock, ws, io, thrown } = await driveRun('402');
  try {
    assert.equal(thrown, null, `runAgent must not throw (got: ${thrown?.stack ?? thrown})`);
    assertCleanTerminal(io, 'error', '402');
    const err = io.events.find((e) => e.type === 'error');
    assert.ok(err, '402: an error row reached the user');
    assert.match(err.message, /insufficient credits/i, `402: classified as insufficient credits (got: ${err.message})`);
    assert.match(err.message, /402/, '402: status code preserved for the renderer toast matcher');
    assert.doesNotMatch(err.message, /\{\s*"/, '402: NO raw provider JSON leaked into the error row');
    assert.doesNotMatch(err.message, /never purchased credits/i, '402: raw provider prose not forwarded verbatim');
    // v11.23 (P1) — a fatal 402 dies on the FIRST response. The old 401-only
    // guard retried it ~3 times (~4.2s of "nothing happens") before the error.
    assert.equal(mock.requests.length, 1, `402: EXACTLY ONE provider request, no silent retry/failover (got ${mock.requests.length})`);
  } finally {
    await mock.stop();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('v1123 400/402/500 with raw JSON bodies → clean single-language actionable text', { timeout: 120_000 }, async () => {
  for (const scenario of ['400-json', '402', '500-json']) {
    const { mock, ws, io, thrown } = await driveRun(scenario);
    try {
      assert.equal(thrown, null, `${scenario}: runAgent must not throw (got: ${thrown?.stack ?? thrown})`);
      assertCleanTerminal(io, 'error', scenario);
      const err = io.events.find((e) => e.type === 'error');
      assert.ok(err, `${scenario}: an error row reached the user`);
      const m = err.message;
      // Every surface must be CLEAN: no raw JSON, no raw provider prose, no
      // mixed language, no raw body leaked through the fall-through.
      assert.doesNotMatch(m, /[{}]/, `${scenario}: no JSON braces in the error row (got: ${m})`);
      assert.doesNotMatch(m, /Backend rejected|token|expired/i, `${scenario}: raw provider body not forwarded (got: ${m})`);
      assert.doesNotMatch(m, /[\u0600-\u06FF]/, `${scenario}: EN surface stays single-language (got: ${m})`);
      assert.ok(m.length > 20 && /\.$/.test(m.trim()), `${scenario}: actionable sentence with a next step (got: ${m})`);
      if (scenario === '400-json') assert.match(m, /bad request/i, `400: classified as bad request (got: ${m})`);
      if (scenario === '402') {
        assert.match(m, /insufficient credits/i, `402: classified as insufficient credits (got: ${m})`);
        assert.doesNotMatch(m, /custom|errors-live/i, '402: NO hardcoded provider name in the message');
      }
      if (scenario === '500-json') assert.match(m, /5xx|server error/i, `500: classified as a provider server error (got: ${m})`);
      // The terminal report repeats the EXACT same text — one owner surface.
      const report = io.events.find((e) => e.type === 'task_report');
      assert.equal(report.summary?.startsWith(m.slice(0, 80)), true, `${scenario}: report note is the same classified text`);
    } finally {
      await mock.stop();
      try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
});

test('v1123 429→success: transient rate limit recovers with ZERO error rows', { timeout: 60_000 }, async () => {
  const { mock, ws, io, thrown } = await driveRun('429-then-success');
  try {
    assert.equal(thrown, null, `runAgent must not throw (got: ${thrown?.stack ?? thrown})`);
    assertCleanTerminal(io, 'completed', '429→success');
    assert.equal(io.events.filter((e) => e.type === 'error').length, 0, '429→success: no error row for a recovered provider');
    assert.equal(io.events.some((e) => e.type === 'aborted'), false, '429→success: no abort');
    const text = io.events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
    assert.match(text, /Recovered after a transient 429/, '429→success: the real answer streamed');
    assert.ok(mock.requests.length >= 3, `429→success: the two 429s really happened (requests=${mock.requests.length})`);
  } finally {
    await mock.stop();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('v1123 MALFORMED TOOL ARGS: paired ids, ok:false result, no duplicate/invalid rows', { timeout: 60_000 }, async () => {
  const { mock, ws, io, thrown } = await driveRun('malformed-tool');
  try {
    assert.equal(thrown, null, `runAgent must not throw (got: ${thrown?.stack ?? thrown})`);
    // v11.26 — a failed tool call must be reported honestly as 'error', never
    // as a clean 'completed' (the founder's "AI says done while it failed").
    assertCleanTerminal(io, 'error', 'malformed-tool');
    const starts = io.events.filter((e) => e.type === 'tool_start');
    const results = io.events.filter((e) => e.type === 'tool_result');
    assert.equal(starts.length, 1, `malformed-tool: exactly one tool_start (got ${starts.length})`);
    assert.equal(results.length, 1, `malformed-tool: exactly one tool_result (got ${results.length})`);
    assert.equal(results[0].ok, false, 'malformed-tool: the result is marked failed');
    assert.equal(results[0].toolCallId, starts[0].toolCallId, 'malformed-tool: tool ids match');
    assert.match(results[0].output ?? results[0].text ?? '', /invalid JSON/i, `malformed-tool: the model was told its args were invalid (got: ${JSON.stringify(results[0])})`);
    assert.equal(io.events.filter((e) => e.type === 'error').length, 0, 'malformed-tool: a bad tool call is not a run-level error');
  } finally {
    await mock.stop();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('v1123 ABORTED STREAM: one aborted event, aborted report, no error/stuck state', { timeout: 60_000 }, async () => {
  const { mock, ws, io, thrown } = await driveRun('aborted');
  try {
    assert.equal(thrown, null, `runAgent must not throw (got: ${thrown?.stack ?? thrown})`);
    assertCleanTerminal(io, 'aborted', 'aborted');
    const aborts = io.events.filter((e) => e.type === 'aborted');
    assert.equal(aborts.length, 1, `aborted: exactly one aborted event (got ${aborts.length})`);
    assert.equal(io.events.filter((e) => e.type === 'error').length, 0, 'aborted: user abort is NOT surfaced as an error');
    const partial = io.events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
    assert.match(partial, /partial answer/i, 'aborted: the partial answer already shown is preserved');
  } finally {
    await mock.stop();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

after(() => {
  for (const k of [
    'SURNIA_TURN_RETRY_DELAYS_MS', 'SURNIA_PROVIDER_RETRY_BUDGET_MS',
    'SURNIA_PROVIDER_FAILOVER_BUDGET_MS', 'SURNIA_DELTA_FLUSH_MS',
    'SURNIA_ENGINE_IDLE_MS', 'SURNIA_SKIP_UI_GATE', 'SURNIA_HOME',
  ]) delete process.env[k];
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});
