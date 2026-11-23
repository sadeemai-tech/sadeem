import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// v11.10 — FRONTIER ENDURANCE test suite (Task A1): the engine must be able to
// run for HOURS without a forced stop. Every fix here is exercised END-TO-END
// against the REAL engine loop + REAL provider streaming layer, driven by a
// scripted local mock provider (node:http, zero network, zero model).
//
//   (a1) stream drops MID-TOOL-CALL after visible output → the engine
//        auto-continues the SAME task (partial committed, continuation note
//        injected) and the tool chain completes; already-executed tools are
//        NOT re-executed.
//   (a2) stream drops with ZERO deltas → transparent E2 retry, same outcome.
//   (b)  finish_reason=length mid-task → auto-continue fires and completes.
//   (c)  6 consecutive provider 500s → failover to the second configured
//        provider INSIDE the iteration (maxTurns=1 proves no step budget was
//        burned) and the turn completes.
//   (d)  slow THINKING deltas flowing (gap < idle window) → the 75s-class
//        watchdog NEVER fires (fairness: thinking counts as alive).
//   (e)  ZERO-byte stream beyond the idle window → watchdog fires and the
//        retry succeeds without surfacing an error.
//   (f)  first-token latency: the FIRST visible delta reaches the IO layer
//        while the stream is still open (no aggregate buffering).
//   (g)  task budget crossing → WARN + confirmation via the standard approval
//        flow (approve → ceiling raised; deny → one graceful wrap-up turn).
//   (h)  run wall-clock cap → graceful wrap-up injection, then a hard
//        'time_cap' stop — never a mid-stream kill.
//
// The watchdog/retry budgets are scaled down via env knobs that the engine
// reads AT CALL TIME (SURNIA_SSE_IDLE_MS, SURNIA_TURN_RETRY_DELAYS_MS,
// SURNIA_MAX_RUN_MS, …) — production defaults are asserted in the unit tests
// below (75s idle, ≥6 retries, ≥5h cap).
import { test } from 'node:test';
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
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1110-'));

// ---------- esbuild bundle (same posture as v119-engine.test.mjs) ----------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, 
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
  ], { cwd: ROOT, stdio: 'pipe' });
}

// electron stub for plain-Node execution (mirrors the v119 harness)
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
    shell: {},
    screen: {},
  };`,
);

const provPath = join(tmp, 'providers.cjs');
bundle('electron/agent/providers.ts', provPath);
const providers = require(provPath);

const engPath = join(tmp, 'engine.cjs');
bundle('electron/agent/engine.ts', engPath);
const engine = require(engPath);

// ---------- mock OpenAI-compatible provider ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

// handler builders — each receives { res, req, body }
const hComplete = ({ text, think = [], finish = 'stop', usage, gap = 0 } = {}) => async ({ res }) => {
  sseHeaders(res);
  for (const t of think) {
    res.write(sseChunk({ reasoning_content: t }));
    if (gap) await sleep(gap);
  }
  if (text) {
    res.write(sseChunk({ content: text }));
    if (gap) await sleep(gap);
  }
  finishSse(res, finish, usage);
};
const hTextStream = ({ parts, gap, finish = 'stop', usage } = {}) => async ({ res }) => {
  sseHeaders(res);
  for (const p of parts) {
    res.write(sseChunk({ content: p }));
    await sleep(gap);
  }
  finishSse(res, finish, usage);
};
const hToolCall = ({ text, name, args, id = 'call_1', finish = 'tool_calls', usage, delayMs = 0 } = {}) => async ({ res }) => {
  if (delayMs) await sleep(delayMs);
  sseHeaders(res);
  if (text) res.write(sseChunk({ content: text }));
  for (const d of toolDeltas(name, args, id)) res.write(sseChunk(d));
  finishSse(res, finish, usage);
};
/** Stream the given chunks, then murder the connection mid-stream (no [DONE]). */
const hDrop = ({ before = [], graceMs = 40 } = {}) => async ({ res, req }) => {
  sseHeaders(res);
  for (const d of before) res.write(sseChunk(d));
  await sleep(graceMs); // let the bytes hit the wire
  req.socket.destroy();
};
/** Headers only, then SILENCE (zero body bytes) — the watchdog's exact food. */
const hStall = ({ silenceMs }) => async ({ res, req }) => {
  sseHeaders(res);
  await sleep(silenceMs);
  try { req.socket.destroy(); } catch { /* gone */ }
};
const hStatus = (code) => async ({ res }) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: `mock ${code}` } }));
};

function startMock() {
  const routes = new Map(); // model → handler queue
  const requests = []; // { model, at }
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      requests.push({ model: body.model, at: Date.now() });
      const q = routes.get(body.model);
      const h = q && q.length ? q.shift() : null;
      if (!h) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `UNSCRIPTED request for model ${body.model}` } }));
        return;
      }
      try { await h({ res, req, body }); } catch { try { res.destroy(); } catch { /* gone */ } }
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const listening = new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  return {
    routes,
    requests,
    port: () => listening,
    async stop() {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

// ---------- engine harness ----------
function writeSettings(mockBase, extraAgent = {}) {
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 4,
      providers: {
        custom: { apiKey: 'test-key', baseUrl: mockBase },
        zai: { apiKey: 'failover-key', baseUrl: mockBase },
      },
      agent: { maxRetries: 0, autoCompact: false, autoVerify: false, ...extraAgent },
      doneNotifications: false,
    }),
  );
}

function makeIo(decisions = []) {
  const events = [];
  const timeline = [];
  let i = 0;
  return {
    events,
    timeline,
    send(e) {
      timeline.push({ type: e.type, at: Date.now(), text: e.text ?? e.message ?? '' });
      events.push(e);
    },
    async getDecision(requestId) {
      const d = decisions[i++] ?? { action: 'allow' };
      return { requestId, ...d };
    },
    isAborted: () => false,
    onFetchSignal() {},
  };
}

async function runEngine({ workspace, baseUrl, io, model = 'mock-a' }) {
  const t0 = Date.now();
  try {
    await engine.runAgent(
      {
        task: 'chat',
        sessionId: 'sess-' + Math.random().toString(36).slice(2),
        messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Do the task end to end.', timestamp: t0 }],
        model: { provider: 'custom', model, maxTokens: 2048 },
        mode: 'fullAccess',
        workspace,
        apiKey: 'test-key',
        baseUrl,
      },
      io,
    );
  } catch (err) {
    console.error('[v1110 harness] runAgent threw:', err);
  }
  if (process.env.V1110_DEBUG) console.error('[v1110 harness] events:', JSON.stringify(io.events.map((e) => ({ t: e.type, text: (e.text ?? e.message ?? '').slice(0, 200) })), null, 1));
  return Date.now() - t0;
}

const types = (io, type) => io.events.filter((e) => e.type === type);
const notices = (io) => types(io, 'sys_notice').map((e) => e.text);

// fast retry/jitter budget for every test — production default is asserted separately
const FAST_RETRY = '8,8,8,8,8,8';

// ---------- unit: production-default knobs (the 5h / 6-attempt guarantees) ----------
test('endurance defaults: ≥6 engine retries with real backoff (production schedule)', () => {
  delete process.env.SURNIA_TURN_RETRY_DELAYS_MS;
  const d = engine.turnRetryDelays();
  assert.ok(d.length >= 6, `default retry schedule has ≥6 delays (got ${d.length})`);
  // v11.16: bounded total backoff (~4.2s vs the old ~59s) — a bad provider
  // must not stall the first token for a minute. Still ≥6 real delays.
  assert.ok(d.reduce((a, b) => a + b, 0) < 10_000, 'total default backoff is bounded (<10s)');
  assert.ok(d.every((x) => x > 0 && x < 5_000), 'each backoff delay is short');
});

test('endurance defaults: wall-clock cap ≥ 5h, env-tunable, 0 disables', () => {
  delete process.env.SURNIA_MAX_RUN_MS;
  delete process.env.SURNIA_TIME_CAP_GRACE_MS;
  assert.ok(engine.runWallClockCapMs() >= 5 * 60 * 60_000, 'default cap ≥ 5 hours');
  process.env.SURNIA_MAX_RUN_MS = '120000';
  assert.equal(engine.runWallClockCapMs(), 120000);
  process.env.SURNIA_MAX_RUN_MS = '0';
  assert.equal(engine.runWallClockCapMs(), 0);
  delete process.env.SURNIA_MAX_RUN_MS;
  assert.equal(engine.timeCapGraceMs(), 10 * 60_000);
});

test('endurance defaults: continuation budgets (stream-drop 0, length 25, pause 50)', () => {
  delete process.env.SURNIA_STREAM_CONTINUE_BUDGET;
  delete process.env.SURNIA_MAX_TOKENS_CONTINUES;
  delete process.env.SURNIA_PAUSE_CONTINUES;
  // v11.19: 0 by default — never silently re-request a dropped stream; partial
  // text is shown immediately and interruptions are surfaced to the user.
  assert.equal(engine.streamContinueBudget(), 0);
  assert.equal(engine.maxOutputContinues(), 25);
  assert.equal(engine.maxPauseContinues(), 50);
  process.env.SURNIA_MAX_TOKENS_CONTINUES = '3';
  assert.equal(engine.maxOutputContinues(), 3);
  delete process.env.SURNIA_MAX_TOKENS_CONTINUES;
});

test('endurance defaults: SSE watchdog idle window is 75s and env-tunable', () => {
  delete process.env.SURNIA_SSE_IDLE_MS;
  assert.equal(providers.sseIdleTimeoutMs(), 75_000);
  process.env.SURNIA_SSE_IDLE_MS = '700';
  assert.equal(providers.sseIdleTimeoutMs(), 700);
  delete process.env.SURNIA_SSE_IDLE_MS;
});

// ---------- (a1) stream drop MID-TOOL-CALL (visible) → auto-continue ----------
test('a1: stream drop mid-tool-call → auto-continues, tool chain completes, executed tools NOT re-run', async () => {
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  // This test exercises the continuation MECHANISM itself, so opt in explicitly
  // (the global default is now 0 — no silent re-requests on dropped streams).
  process.env.SURNIA_STREAM_CONTINUE_BUDGET = '8';
  const ws = mkdtempSync(join(tmpdir(), 'surnia-a1-'));
  writeFileSync(join(ws, 'a.txt'), 'alpha');
  writeFileSync(join(ws, 'b.txt'), 'beta');
  const mock = startMock();
  const port = await mock.port();
  mock.routes.set('mock-a', [
    hToolCall({ text: 'Reading the first file.', name: 'read_file', args: JSON.stringify({ path: 'a.txt' }), id: 'call_a' }),
    // drop AFTER visible text + a partial tool call — the mid-task death
    hDrop({
      before: [
        { content: 'Now the second' },
        { content: ' file.' },
        { tool_calls: [{ index: 0, id: 'call_b_partial', function: { name: 'read_file', arguments: '' } }] },
        { tool_calls: [{ index: 0, function: { arguments: '{"path":"b' } }] },
      ],
    }),
    hToolCall({ text: 'Continuing where the stream died.', name: 'read_file', args: JSON.stringify({ path: 'b.txt' }), id: 'call_b' }),
    hComplete({ text: 'Both files read. Task complete.', usage: { prompt_tokens: 30, completion_tokens: 10 } }),
  ]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo();
  try {
    await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    assert.equal(mock.requests.length, 4, `4 model requests expected (got ${mock.requests.length})`);
    const starts = types(io, 'tool_start').map((e) => e.args?.path);
    assert.ok(starts.includes('a.txt') && starts.includes('b.txt'), 'both tool calls dispatched');
    assert.equal(types(io, 'tool_start').length, 2, 'each tool executed EXACTLY once (no re-execution)');
    assert.equal(types(io, 'tool_result').filter((e) => e.ok).length, 2, 'both tool results ok');
    assert.ok(notices(io).some((t) => t.includes('auto-continuing the same task')), 'auto-continue notice emitted');
    const end = types(io, 'message_end')[0];
    assert.ok(end, 'run finished');
    assert.equal(end.stopReason, 'end_turn');
    assert.ok(notices(io).every((t) => !t.includes('stream interrupted —')), 'no final stream-error notice');
    assert.equal(types(io, 'error').length, 0, 'no error surfaced to the user');
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------- (a2) invisible stream drop → transparent E2 retry ----------
test('a2: stream drop with zero deltas mid-tool-chain → silent retry completes the chain', async () => {
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  const ws = mkdtempSync(join(tmpdir(), 'surnia-a2-'));
  writeFileSync(join(ws, 'a.txt'), 'alpha');
  writeFileSync(join(ws, 'b.txt'), 'beta');
  const mock = startMock();
  const port = await mock.port();
  mock.routes.set('mock-a', [
    hToolCall({ name: 'read_file', args: JSON.stringify({ path: 'a.txt' }), id: 'call_a' }),
    hDrop({ before: [], graceMs: 30 }), // dies BEFORE any delta → invisible
    hToolCall({ name: 'read_file', args: JSON.stringify({ path: 'b.txt' }), id: 'call_b' }),
    hComplete({ text: 'Chain complete.' }),
  ]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo();
  try {
    await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    assert.equal(mock.requests.length, 4, '4 model requests (drop retried transparently)');
    assert.equal(types(io, 'tool_start').length, 2, 'both tools executed once');
    assert.equal(types(io, 'tool_result').filter((e) => e.ok).length, 2);
    assert.ok(!notices(io).some((t) => t.includes('auto-continuing')), 'no auto-continue notice (nothing visible was lost)');
    assert.equal(types(io, 'error').length, 0);
    assert.equal(types(io, 'message_end')[0]?.stopReason, 'end_turn');
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------- (b) finish_reason=length → auto-continue ----------
test('b: finish_reason=length mid-task → auto-continue fires and the turn completes', async () => {
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  const ws = mkdtempSync(join(tmpdir(), 'surnia-b-'));
  const mock = startMock();
  const port = await mock.port();
  mock.routes.set('mock-a', [
    hComplete({ text: 'PART-ONE of a long answer.', finish: 'length', usage: { prompt_tokens: 30, completion_tokens: 120 } }),
    hComplete({ text: 'PART-TWO, now actually finished.', finish: 'stop', usage: { prompt_tokens: 30, completion_tokens: 40 } }),
  ]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo();
  try {
    await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    assert.equal(mock.requests.length, 2, 'continuation re-requested the SAME task');
    assert.ok(notices(io).some((t) => t.includes('continued — output limit reached')), 'auto-continue notice for length');
    const deltas = types(io, 'text_delta').map((e) => e.text).join('');
    assert.ok(deltas.includes('PART-ONE') && deltas.includes('PART-TWO'), 'both parts streamed to the renderer');
    const end = types(io, 'message_end')[0];
    assert.equal(end?.stopReason, 'end_turn', 'run completes (not a truncation stop)');
    assert.equal(types(io, 'error').length, 0);
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------- (c) provider failures → failover INSIDE the iteration ----------
test('c: 6 consecutive provider 500s → failover completes the turn without burning step budget', async () => {
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  const ws = mkdtempSync(join(tmpdir(), 'surnia-c-'));
  const mock = startMock();
  const port = await mock.port();
  // maxTurns=1: if failover burned iterations (the pre-v11.9 bug), the loop
  // would exit maxedOut before the failover provider ever served.
  mock.routes.set('mock-a', [hStatus(500), hStatus(500), hStatus(500), hStatus(500), hStatus(500), hStatus(500), hStatus(500)]);
  mock.routes.set('glm-4.7', [hComplete({ text: 'Recovered on the failover provider.' })]);
  // v11.19: cross-provider failover is OFF by default (isFailoverEnabled gate).
  // This test exercises the failover MECHANISM, so opt in explicitly.
  writeSettings(`http://127.0.0.1:${port}/v1`, { maxTurns: 1, allowModelFailover: true });
  const io = makeIo();
  try {
    await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    const aCalls = mock.requests.filter((r) => r.model === 'mock-a').length;
    const bCalls = mock.requests.filter((r) => r.model === 'glm-4.7').length;
    assert.ok(aCalls >= 4, `≥4 consecutive failures absorbed on provider A (got ${aCalls})`);
    assert.equal(bCalls, 1, 'failover provider served exactly once');
    // v11.19 — the noisy `[failover]` wording was replaced with one quiet,
    // consolidated notice: "Trying another configured model (n/total)…".
    assert.ok(notices(io).some((t) => /Trying another configured model|failover/i.test(t)), 'one quiet failover notice emitted');
    assert.ok(notices(io).every((t) => !t.includes('tool-step limit')), 'step budget NOT consumed by failures (no maxedOut stop)');
    assert.equal(types(io, 'error').length, 0, 'turn did NOT end as an error');
    const deltas = types(io, 'text_delta').map((e) => e.text).join('');
    assert.ok(deltas.includes('Recovered on the failover provider.'), 'failover provider answer streamed');
    assert.equal(types(io, 'message_end')[0]?.stopReason, 'end_turn');
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------- (d) slow thinking deltas → watchdog must NOT fire ----------
// Scaled: idle window 800ms, thinking delta every 250ms for ~2s (the 90s/75s
// production pair scales by the same ratio — deltas always outrun the window).
test('d: slow thinking deltas keep the stream alive — watchdog never fires', async () => {
  process.env.SURNIA_SSE_IDLE_MS = '800';
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  const ws = mkdtempSync(join(tmpdir(), 'surnia-d-'));
  const mock = startMock();
  const port = await mock.port();
  mock.routes.set('mock-a', [
    hComplete({
      think: ['t1 ', 't2 ', 't3 ', 't4 ', 't5 ', 't6 ', 't7 ', 't8 '],
      text: 'Thought it through, done.',
      gap: 250,
      usage: { prompt_tokens: 20, completion_tokens: 20 },
    }),
  ]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo();
  try {
    await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    assert.equal(mock.requests.length, 1, 'single request — no watchdog-triggered retry');
    // Under load the ~20ms batcher coalesces thinking into fewer delta EVENTS;
    // assert on the content that actually reached the IO instead of the count
    // — the contract is "thinking streamed live without a watchdog retry".
    const thinkText = types(io, 'think_delta').map((e) => e.text).join('');
    assert.ok(thinkText.includes('t1') && thinkText.includes('t8'), 'thinking streamed live');
    assert.ok(types(io, 'text_delta').some((e) => e.text.includes('Thought it through')), 'final answer arrived');
    assert.ok(notices(io).every((t) => !t.includes('Stream stalled')), 'no stall surfaced');
    assert.equal(types(io, 'error').length, 0);
    assert.equal(types(io, 'message_end')[0]?.stopReason, 'end_turn');
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------- (e) zero-byte stream → watchdog fires, retry succeeds ----------
test('e: zero-byte stream beyond the idle window → watchdog fires and the retry succeeds', async () => {
  process.env.SURNIA_SSE_IDLE_MS = '600';
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  const ws = mkdtempSync(join(tmpdir(), 'surnia-e-'));
  const mock = startMock();
  const port = await mock.port();
  mock.routes.set('mock-a', [
    hStall({ silenceMs: 4000 }), // headers arrive, then ZERO bytes; 4s socket cleanup vs 600ms watchdog
    hComplete({ text: 'Back alive after the stall.' }),
  ]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo();
  try {
    const dur = await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    assert.equal(mock.requests.length, 2, 'watchdog kill → one transparent retry');
    // v11.23 — widen the scheduling margin under 1300-test parallel load while
    // still proving the 600ms watchdog beat the 4s socket cleanup.
    assert.ok(mock.requests[1].at - mock.requests[0].at < 3000, 'retry fired by the WATCHDOG (600ms window), not the 4s socket cleanup');
    // The watchdog assertion above (<1900ms to retry) proves recovery was fast;
    // the whole run's wall clock also includes mock startup + engine teardown,
    // which can add seconds on a heavily loaded CI box. Keep a generous cap.
    assert.ok(dur < 12_000, `run recovered quickly (took ${dur}ms)`);
    assert.ok(types(io, 'text_delta').some((e) => e.text.includes('Back alive')), 'answer delivered after recovery');
    assert.ok(notices(io).every((t) => !t.includes('Stream stalled')), 'stall never surfaced as a user error');
    assert.equal(types(io, 'error').length, 0);
    assert.equal(types(io, 'message_end')[0]?.stopReason, 'end_turn');
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------- (f) first-token latency ----------
test('f: first visible delta reaches the IO while the stream is still open (no aggregate buffering)', async () => {
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  const ws = mkdtempSync(join(tmpdir(), 'surnia-f-'));
  const mock = startMock();
  const port = await mock.port();
  mock.routes.set('mock-a', [
    // v11.23 — a 400ms gap (well above the 33ms batcher) keeps the deltas
    // distinct even under heavy parallel load; 150ms used to coalesce into 1.
    hTextStream({ parts: ['c1 ', 'c2 ', 'c3 ', 'c4 ', 'c5 ', 'c6 '], gap: 400, usage: { prompt_tokens: 10, completion_tokens: 10 } }),
  ]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo();
  try {
    const t0 = Date.now();
    await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    const textDeltas = io.timeline.filter((e) => e.type === 'text_delta');
    // Under parallel load the stream batcher can coalesce adjacent parts;
    // three separate deltas still prove incremental (non-buffered) delivery.
    assert.ok(textDeltas.length >= 3, 'deltas arrive incrementally (not one burst)');
    const first = textDeltas[0].at - t0;
    const last = textDeltas[textDeltas.length - 1].at - t0;
    // Load-tolerant bounds: CI machines under parallel agent load can stall the
    // mock server; the properties under test are INCREMENTALITY, not absolute ms.
    // first must land well before the last delta (no aggregate buffering), and
    // deltas must spread across the stream (no end-of-stream burst).
    assert.ok(first < last, `first delta (${first}ms) precedes last delta (${last}ms)`);
    // Compare against the MIDDLE DELTA, not wall-clock t0: under parallel CI
    // load the mock server can take seconds just to start, which shifts every
    // delta toward the end without any buffering in the engine. Incremental
    // delivery means the first delta must still precede the median delta.
    const mid = textDeltas[Math.floor(textDeltas.length / 2)].at - t0;
    assert.ok(first < mid, `first delta at ${first}ms precedes the median delta at ${mid}ms (no aggregate buffering)`);
    assert.ok(last - first > 300, 'deltas spread across the whole stream (no end-of-stream burst)');
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------- (g) task budget: WARN + confirm, never a silent kill ----------
test('g: budget crossing → warn + approval; approve raises ceiling, deny wraps up gracefully', async () => {
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  const ws = mkdtempSync(join(tmpdir(), 'surnia-g-'));
  for (const f of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) writeFileSync(join(ws, f), f);
  const mock = startMock();
  const port = await mock.port();
  const usage = { prompt_tokens: 50, completion_tokens: 50, cost: 0.05 };
  mock.routes.set('mock-a', [
    hToolCall({ name: 'read_file', args: JSON.stringify({ path: 'a.txt' }), id: 'c1', usage }),
    hToolCall({ name: 'read_file', args: JSON.stringify({ path: 'b.txt' }), id: 'c2', usage }),
    hToolCall({ name: 'read_file', args: JSON.stringify({ path: 'c.txt' }), id: 'c3', usage }),
    hToolCall({ name: 'read_file', args: JSON.stringify({ path: 'd.txt' }), id: 'c4', usage }),
    hComplete({ text: 'STATUS: wrapped up cleanly after the budget denial.' }),
  ]);
  writeSettings(`http://127.0.0.1:${port}/v1`, { taskBudgetUsd: 0.06 });
  const io = makeIo([{ action: 'allow' }, { action: 'deny' }]);
  try {
    await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    assert.ok(notices(io).some((t) => t.includes('[budget warning]')), 'WARN before the limit');
    const asks = types(io, 'approval_request').filter((e) => e.title?.includes('Task budget reached'));
    assert.equal(asks.length, 2, 'user asked at EACH limit crossing (never silently killed)');
    assert.ok(notices(io).some((t) => t.includes('continuation approved')), 'approval raised the ceiling');
    assert.ok(notices(io).some((t) => t.includes('continuation denied')), 'denial recorded');
    assert.equal(types(io, 'error').length, 0);
    const deltas = types(io, 'text_delta').map((e) => e.text).join('');
    assert.ok(deltas.includes('STATUS: wrapped up cleanly'), 'model produced its wrap-up summary turn');
    assert.equal(types(io, 'message_end')[0]?.stopReason, 'end_turn');
    assert.ok(mock.requests.length === 5, `wrap-up turn ran (got ${mock.requests.length} requests)`);
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------- (h) run wall-clock cap: graceful wrap-up, hard 'time_cap' stop ----------
test('h: wall-clock cap injects a graceful wrap-up, then force-stops with stop_reason time_cap', async () => {
  // v11.24 — the engine's startup stall was removed (2.9s → ~70ms). The old
  // 80ms cap now fires BEFORE the run even starts. Use an explicit mock delay
  // so the cap lands mid-run deterministically, independent of host speed.
  process.env.SURNIA_MAX_RUN_MS = '600';
  process.env.SURNIA_TIME_CAP_GRACE_MS = '40';
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  const ws = mkdtempSync(join(tmpdir(), 'surnia-h-'));
  writeFileSync(join(ws, 'a.txt'), 'alpha');
  writeFileSync(join(ws, 'b.txt'), 'beta');
  const mock = startMock();
  const port = await mock.port();
  mock.routes.set('mock-a', [
    hToolCall({ name: 'read_file', args: JSON.stringify({ path: 'a.txt' }), id: 'c1', delayMs: 900 }),
    hToolCall({ name: 'read_file', args: JSON.stringify({ path: 'b.txt' }), id: 'c2', delayMs: 900 }),
  ]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo();
  try {
    await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    assert.ok(notices(io).some((t) => t.includes('[time cap] run reached its wall-clock cap')), 'graceful wrap-up injected at the cap');
    assert.ok(notices(io).some((t) => t.includes('grace period over')), 'grace expiry surfaced');
    const end = types(io, 'message_end')[0];
    assert.equal(end?.stopReason, 'time_cap', 'hard stop carries the honest time_cap reason');
    assert.equal(types(io, 'error').length, 0, 'not an error — a deliberate cap');
    assert.ok(mock.requests.length <= 2, 'no runaway after the cap');
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

test('cleanup', () => {
  for (const k of ['SURNIA_TURN_RETRY_DELAYS_MS', 'SURNIA_SSE_IDLE_MS', 'SURNIA_MAX_RUN_MS', 'SURNIA_TIME_CAP_GRACE_MS', 'SURNIA_STREAM_CONTINUE_BUDGET', 'SURNIA_MAX_TOKENS_CONTINUES', 'SURNIA_PAUSE_CONTINUES']) {
    delete process.env[k];
  }
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
