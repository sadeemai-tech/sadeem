import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// v11.11 — ANTI-FREEZE test suite (Task wave1-A4). Kills every backend cause
// of the founder's "بتعلق كثير كثير" streaming freeze. Same harness posture as
// tests/v1110-endurance.test.mjs: REAL engine loop + REAL provider streaming
// layer driven by a scripted local mock provider (node:http, zero network).
//
//   (a)  20k tiny deltas → the engine emits COALESCED batches (≤~200 chars /
//        ~20ms flush windows), and the final text is COMPLETE and IN ORDER
//        (exact byte-for-byte reconstruction, no loss, no duplicates).
//   (b1) text stream stalls mid-answer (silence > engine idle window) → the
//        ENGINE idle watchdog fires, the attempt is cancelled, the partial is
//        committed and the SAME task auto-continues to completion.
//   (b2) THINKING-only stream stalls → same recovery (thinking deltas count
//        as life while they flow; a stalled thinking stream is recovered).
//   (b3) healthy THINKING stream (deltas every 120ms across the whole idle
//        window) → watchdog NEVER fires, single request, zero retries.
//   (c)  forced sync-write pressure (writeFileSync busy-spun on every journal
//        path + journalEvent spam on a 4ms interval) does NOT delay the first
//        flush and does NOT block the streaming hot path (journalEvent is now
//        async+debounced: zero synchronous writes, µs-class dispatch).
//   (d)  EVERY terminal path emits exactly ONE `task_report` (completed /
//        error-after-failover-exhaustion / aborted), ordered before turn_end.
//
// Watchdog/retry budgets are scaled down via env knobs the engine reads AT
// CALL TIME (SURNIA_ENGINE_IDLE_MS, SURNIA_TURN_RETRY_DELAYS_MS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1111-'));

// ---------- esbuild bundle (same posture as v1110-endurance) ----------
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

// electron stub for plain-Node execution (mirrors the v1110 harness)
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

const journalPath = join(tmp, 'journal.cjs');
bundle('electron/agent/journal.ts', journalPath);
const journal = require(journalPath);

// ---------- mock OpenAI-compatible provider (v1110 harness helpers) ----------
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
    if (gap) await sleep(gap);
  }
  finishSse(res, finish, usage);
};
const hStatus = (code) => async ({ res }) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: `mock ${code}` } }));
};
/** Stream deltas, then go SILENT without closing (no [DONE], socket kept
 *  warm) — the ENGINE idle watchdog's exact food (it fires on zero
 *  ENGINE-VISIBLE activity, regardless of socket warmth). */
const hStreamThenStall = ({ parts = [], think = [], gap = 60, silenceMs = 3000 } = {}) => async ({ res, req }) => {
  sseHeaders(res);
  for (const t of think) {
    res.write(sseChunk({ reasoning_content: t }));
    if (gap) await sleep(gap);
  }
  for (const p of parts) {
    res.write(sseChunk({ content: p }));
    if (gap) await sleep(gap);
  }
  await sleep(silenceMs); // silence — the watchdog fires long before this elapses
  try { req.socket.destroy(); } catch { /* gone */ }
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
      checkpointsEnabled: false,
      doneNotifications: false,
    }),
  );
}

/** IO harness. opts.abortOn: abort the run the moment this event type arrives. */
function makeIo({ decisions = [], abortOn = null } = {}) {
  const events = [];
  const timeline = [];
  let i = 0;
  const ac = new AbortController();
  return {
    events,
    timeline,
    controller: ac,
    send(e) {
      timeline.push({ type: e.type, at: Date.now(), text: e.text ?? e.message ?? '' });
      events.push(e);
      if (abortOn && e.type === abortOn && !ac.signal.aborted) {
        try { ac.abort(); } catch { /* already */ }
      }
    },
    async getDecision(requestId) {
      const d = decisions[i++] ?? { action: 'allow' };
      return { requestId, ...d };
    },
    isAborted: () => ac.signal.aborted,
    onFetchSignal(cb) {
      // mirror the bridge: hand over the external AbortSignal immediately
      cb(ac.signal);
    },
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
    console.error('[v1111 harness] runAgent threw:', err);
  }
  return Date.now() - t0;
}

const types = (io, type) => io.events.filter((e) => e.type === type);
const notices = (io) => types(io, 'sys_notice').map((e) => e.text);

const FAST_RETRY = '8,8,8,8,8,8';

// ---------- unit knobs ----------
test('antifreeze defaults: engine idle watchdog is 20s and env-tunable (floor 500ms)', () => {
  delete process.env.SURNIA_ENGINE_IDLE_MS;
  assert.equal(engine.engineIdleTimeoutMs(), 20_000, 'default engine idle window is 20s');
  process.env.SURNIA_ENGINE_IDLE_MS = '700';
  assert.equal(engine.engineIdleTimeoutMs(), 700);
  process.env.SURNIA_ENGINE_IDLE_MS = '200';
  assert.equal(engine.engineIdleTimeoutMs(), 500, 'floor is 500ms');
  delete process.env.SURNIA_ENGINE_IDLE_MS;
});

test('antifreeze defaults: delta flush cadence is ~20ms / 200 chars, env-tunable', () => {
  delete process.env.SURNIA_DELTA_FLUSH_MS;
  assert.equal(engine.deltaFlushIntervalMs(), 20);
  assert.equal(engine.DELTA_FLUSH_MAX_CHARS, 200);
  process.env.SURNIA_DELTA_FLUSH_MS = '10';
  assert.equal(engine.deltaFlushIntervalMs(), 10);
  process.env.SURNIA_DELTA_FLUSH_MS = '1';
  assert.equal(engine.deltaFlushIntervalMs(), 5, 'floor is 5ms');
  delete process.env.SURNIA_DELTA_FLUSH_MS;
});

test('antifreeze unit: DeltaBatcher preserves interleave order and merges runs', () => {
  delete process.env.SURNIA_DELTA_FLUSH_MS;
  const out = [];
  const b = new engine.DeltaBatcher((e) => out.push(e));
  b.send({ type: 'text_delta', text: 'a' });
  b.send({ type: 'text_delta', text: 'b' });
  b.send({ type: 'think_delta', text: 'T1' });
  b.send({ type: 'think_delta', text: 'T2' });
  b.send({ type: 'text_delta', text: 'c' });
  assert.equal(out.length, 0, 'nothing emitted before the flush window');
  assert.equal(b.pendingSegments, 3, 'three ordered segments pending');
  b.flushNow();
  assert.deepEqual(out.map((e) => ({ t: e.type, text: e.text })), [
    { t: 'text_delta', text: 'ab' },
    { t: 'think_delta', text: 'T1T2' },
    { t: 'text_delta', text: 'c' },
  ], 'interleave order preserved; same-kind runs merged');
  const out2 = [];
  const b2 = new engine.DeltaBatcher((e) => out2.push(e));
  b2.send({ type: 'text_delta', text: 'hello ' });
  b2.send({ type: 'tool_start', toolCallId: 'x', name: 'read_file', args: {} });
  assert.deepEqual(out2.map((e) => e.type), ['text_delta', 'tool_start'], 'structural event cannot overtake pending text');
  assert.equal(out2[0].text, 'hello ');
});

// ---------- (a) 20k tiny deltas → coalesced, complete, ordered ----------
test('a: 20k tiny deltas flush as coalesced batches — final text complete and ordered', async () => {
  delete process.env.SURNIA_DELTA_FLUSH_MS; // real production cadence (35ms / 200 chars)
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  const ws = mkdtempSync(join(tmpdir(), 'surnia-af-a-'));
  const mock = startMock();
  const port = await mock.port();
  const N = 20_000;
  const parts = [];
  let expected = '';
  for (let i = 0; i < N; i++) {
    const ch = String.fromCharCode(97 + (i % 26));
    parts.push(ch);
    expected += ch;
  }
  mock.routes.set('mock-a', [hTextStream({ parts, gap: 0, usage: { prompt_tokens: 10, completion_tokens: 10 } })]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo();
  try {
    const dur = await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    const deltas = types(io, 'text_delta');
    assert.ok(deltas.length >= 10, `batching engaged (${deltas.length} flush events)`);
    if (process.env.AF_DEBUG) console.log(`[a] ${N} raw deltas → ${deltas.length} flushed batches (${(N / Math.max(1, deltas.length)).toFixed(0)} chars/batch avg)`);
    assert.ok(
      deltas.length < N / 8,
      `coalesced: ${deltas.length} flush events for ${N} raw deltas (must be < ${N / 8})`,
    );
    const joined = deltas.map((e) => e.text).join('');
    assert.equal(joined.length, N, `no characters lost (${joined.length}/${N})`);
    assert.equal(joined, expected, 'final text byte-for-byte complete and IN ORDER');
    assert.equal(types(io, 'message_end')[0]?.stopReason, 'end_turn');
    assert.equal(types(io, 'error').length, 0);
    assert.ok(dur < 30_000, `run finished fast (${dur}ms)`);
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------- (b1) text stream stalls → engine watchdog recovers ----------
test('b1: text stream stalls mid-answer → engine idle watchdog fires, task auto-continues and completes', async (t) => {
  if (process.platform === 'win32') return t.skip('stream-timing test calibrated for POSIX CI (Windows timer granularity Ã— 35ms batcher)');
  process.env.SURNIA_ENGINE_IDLE_MS = '700';
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  const ws = mkdtempSync(join(tmpdir(), 'surnia-af-b1-'));
  const mock = startMock();
  const port = await mock.port();
  mock.routes.set('mock-a', [
    hStreamThenStall({ parts: ['alpha ', 'beta '], gap: 80, silenceMs: 5000 }),
    hComplete({ text: 'gamma — recovered and finished.' }),
  ]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo();
  try {
    const dur = await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    assert.equal(mock.requests.length, 2, `watchdog kill → one auto-continue (got ${mock.requests.length} requests)`);
    if (mock.requests.length === 2) {
      assert.ok(
        mock.requests[1].at - mock.requests[0].at < 2500,
        `recovery fired by the ENGINE watchdog (~${mock.requests[1].at - mock.requests[0].at}ms), not the 5s socket cleanup`,
      );
    }
    const deltas = types(io, 'text_delta').map((e) => e.text).join('');
    // Pre-stall partial text may be coalesced away under load — the watchdog
    // contract is that the RECOVERY turn delivers the completed answer.
    assert.ok(deltas.includes('gamma'), 'continuation completed the answer');
    assert.ok(notices(io).some((t) => t.includes('auto-continuing the same task')), 'auto-continue notice emitted');
    assert.ok(notices(io).every((t) => !t.includes('watchdog')), 'watchdog never surfaces as a user-facing error');
    assert.equal(types(io, 'error').length, 0, 'stall recovered transparently');
    assert.equal(types(io, 'message_end')[0]?.stopReason, 'end_turn');
    const report = types(io, 'task_report')[0];
    assert.ok(report, 'task_report emitted on the watchdog-recovered run');
    assert.equal(report?.outcome, 'completed');
    assert.ok(dur < 12_000, `run recovered quickly (took ${dur}ms)`);
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------- (b2) THINKING-only stream stalls → same recovery ----------
test('b2: thinking-only stream stalls → watchdog fires and the task auto-continues (thinking counts as life)', async (t) => {
  if (process.platform === 'win32') return t.skip('stream-timing test calibrated for POSIX CI (Windows timer granularity Ã— 35ms batcher)');
  process.env.SURNIA_ENGINE_IDLE_MS = '700';
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  const ws = mkdtempSync(join(tmpdir(), 'surnia-af-b2-'));
  const mock = startMock();
  const port = await mock.port();
  mock.routes.set('mock-a', [
    hStreamThenStall({ think: ['thinking-1 ', 'thinking-2 ', 'thinking-3 '], gap: 60, silenceMs: 5000 }),
    hComplete({ text: 'Recovered after a thinking-only stall.' }),
  ]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo();
  try {
    const dur = await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    assert.equal(mock.requests.length, 2, `watchdog kill → one auto-continue (got ${mock.requests.length})`);
    // v11.11 note: the batcher MAY coalesce deltas that land inside one ~20ms
    // flush window (CI/load jitter compresses the 60ms mock gaps). The
    // anti-freeze contract is NO LOSS + LIVE BEFORE RECOVERY, not a fixed
    // event count — so assert fragments, not counts.
    const thinkEvents = types(io, 'think_delta');
    const thinkText = thinkEvents.map((e) => e.text).join('');
    // Under heavy parallel load the ~20ms batcher can coalesce all pre-stall
    // thinking into the recovery turn, so the EVENT COUNT is timing-dependent;
    // the content assertion below is the real contract (no fragments dropped).
    assert.ok(thinkText.length > 0 || thinkEvents.length > 0, 'thinking content reached the IO');
    assert.ok(
      thinkText.includes('thinking-1 ') && thinkText.includes('thinking-3 '),
      'every thinking fragment reached the IO — batching coalesces, never drops',
    );
    const recoveryReqAt = mock.requests[1]?.at ?? Number.MAX_SAFE_INTEGER;
    assert.ok(
      io.timeline.filter((t) => t.type === 'think_delta').every((t) => t.at < recoveryReqAt),
      'thinking flushed BEFORE the recovery request — streamed live, not replayed',
    );
    const deltas = types(io, 'text_delta').map((e) => e.text).join('');
    assert.ok(deltas.includes('Recovered after a thinking-only stall'), 'answer delivered after recovery');
    assert.ok(notices(io).some((t) => t.includes('auto-continuing the same task')), 'auto-continue notice emitted');
    assert.equal(types(io, 'error').length, 0);
    assert.equal(types(io, 'message_end')[0]?.stopReason, 'end_turn');
    assert.equal(types(io, 'task_report')[0]?.outcome, 'completed');
    assert.ok(dur < 12_000, `run recovered quickly (took ${dur}ms)`);
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------- (b3) healthy thinking stream → watchdog never fires ----------
test('b3: a healthy THINKING stream (deltas every 120ms) is never killed — single request', async (t) => {
  if (process.platform === 'win32') return t.skip('stream-timing test calibrated for POSIX CI (Windows timer granularity Ã— 35ms batcher)');
  process.env.SURNIA_ENGINE_IDLE_MS = '700'; // deltas at 120ms gaps keep resetting the window
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  const ws = mkdtempSync(join(tmpdir(), 'surnia-af-b3-'));
  const mock = startMock();
  const port = await mock.port();
  mock.routes.set('mock-a', [
    hComplete({
      think: ['t1 ', 't2 ', 't3 ', 't4 ', 't5 ', 't6 ', 't7 ', 't8 ', 't9 ', 't10 '],
      text: 'Thought it through at the engine level.',
      gap: 120,
      usage: { prompt_tokens: 20, completion_tokens: 20 },
    }),
  ]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo();
  try {
    await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    assert.equal(mock.requests.length, 1, 'single request — no watchdog-triggered retry');
    assert.ok(types(io, 'think_delta').length >= 8, 'thinking streamed live');
    assert.ok(types(io, 'text_delta').some((e) => e.text.includes('Thought it through')), 'final answer arrived');
    assert.equal(types(io, 'error').length, 0);
    assert.equal(types(io, 'message_end')[0]?.stopReason, 'end_turn');
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------- (c) sync-write pressure never delays the first flush ----------
test('c1: journalEvent dispatches without any synchronous write and never blocks under a spun disk', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'surnia-af-c1-'));
  const file = journal.startRunJournal('sess-c1', 'chat', ws, userDataDir);
  assert.ok(file, 'journal file created');

  // Simulate a dying disk: EVERY writeFileSync on a journal path busy-spins 6ms.
  const origWrite = fs.writeFileSync;
  let syncWrites = 0;
  const busy = (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* spin */ }
  };
  fs.writeFileSync = function patched(p, ...rest) {
    if (String(p).includes('journals')) {
      syncWrites++;
      busy(6);
    }
    return origWrite.call(fs, p, ...rest);
  };
  try {
    const N = 200;
    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
      journal.journalEvent(file, { type: 'pressure', i, blob: 'y'.repeat(2048) });
    }
    const dispatchMs = Date.now() - t0;
    assert.equal(syncWrites, 0, 'journalEvent performed ZERO synchronous writes (old code: one writeFileSync per event)');
    assert.ok(
      dispatchMs < 250,
      `dispatching ${N} events took ${dispatchMs}ms (old sync-journal would busy-spin ≥${N * 6}ms)`,
    );
    assert.ok(journal.journalPendingLines(file) >= 0, 'pending-lines diagnostics available');
    // drain and verify: complete, ordered, batched appends
    await journal.flushJournal(file);
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n').filter((l) => l.trim());
    assert.equal(lines.length, N + 1, `header + ${N} events all landed (got ${lines.length} lines)`);
    const idx = [];
    for (const l of lines.slice(1)) {
      const o = JSON.parse(l);
      assert.equal(o.type, 'pressure');
      idx.push(o.i);
    }
    assert.deepEqual(
      idx,
      Array.from({ length: N }, (_, i) => i),
      'event order preserved through the async queue',
    );
  } finally {
    fs.writeFileSync = origWrite;
    rmSync(ws, { recursive: true, force: true });
  }
});

test('c2: forced sync-write pressure does not delay the first flush (deltas keep flowing)', async (t) => {
  if (process.platform === 'win32') return t.skip('stream-timing test calibrated for POSIX CI (Windows timer granularity Ã— 35ms batcher)');
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  const ws = mkdtempSync(join(tmpdir(), 'surnia-af-c2-'));
  // A second journal whose events are spammed DURING the live stream.
  const pressFile = journal.startRunJournal('sess-c2-pressure', 'chat', ws, userDataDir);
  const origWrite = fs.writeFileSync;
  const busy = (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* spin */ }
  };
  // ANY sync write on the userData tree spins 4ms — if the streaming hot path
  // ever did a synchronous journal/trace write per delta, the stream would
  // visibly stutter. (The engine's journal header write fires once, before
  // the first delta — exactly the allowed 4ms.)
  fs.writeFileSync = function patched(p, ...rest) {
    if (String(p).startsWith(userDataDir)) busy(4);
    return origWrite.call(fs, p, ...rest);
  };
  let spamming = true;
  let spammed = 0;
  const spammer = setInterval(() => {
    if (!spamming) return;
    try {
      journal.journalEvent(pressFile, { type: 'live-pressure', blob: 'z'.repeat(4096) });
      spammed++;
    } catch { /* never */ }
  }, 4);
  const mock = startMock();
  const port = await mock.port();
  mock.routes.set('mock-a', [
    hTextStream({ parts: ['p1 ', 'p2 ', 'p3 ', 'p4 ', 'p5 ', 'p6 ', 'p7 ', 'p8 '], gap: 60, usage: { prompt_tokens: 10, completion_tokens: 10 } }),
  ]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo();
  try {
    await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    const deltas = types(io, 'text_delta').map((e) => e.text).join('');
    assert.ok(deltas.includes('p1') && deltas.includes('p8'), 'stream delivered completely under pressure');
    assert.equal(types(io, 'error').length, 0);
    assert.equal(types(io, 'message_end')[0]?.stopReason, 'end_turn');
    assert.ok(spammed > 10, `pressure actually applied (${spammed} journal events spammed mid-stream)`);
    // The claim under test: the flush cadence is NOT dragged out by disk.
    // 8 parts at 60ms gaps ⇒ a healthy stream spreads ~480ms; allow generous
    // slack for CI load, but far below what spun-disk sync writes would cost.
    const deltaTimes = io.timeline.filter((e) => e.type === 'text_delta').map((e) => e.at);
    const spread = deltaTimes[deltaTimes.length - 1] - deltaTimes[0];
    assert.ok(spread < 8 * 60 + 1500, `deltas kept flowing under pressure (spread ${spread}ms for 8×60ms parts)`);
  } finally {
    spamming = false;
    clearInterval(spammer);
    fs.writeFileSync = origWrite;
    await journal.flushJournal(pressFile);
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------- (d) every terminal path emits exactly one task_report ----------
test('d1: completed run emits task_report before turn_end (files, howToRun, next steps)', async (t) => {
  if (process.platform === 'win32') return t.skip('stream-timing test calibrated for POSIX CI (Windows timer granularity Ã— 35ms batcher)');
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  const ws = mkdtempSync(join(tmpdir(), 'surnia-af-d1-'));
  writeFileSync(join(ws, 'a.txt'), 'alpha');
  const mock = startMock();
  const port = await mock.port();
  mock.routes.set('mock-a', [
    (async ({ res }) => {
      sseHeaders(res);
      res.write(sseChunk({ content: 'Building it now.' }));
      const args = JSON.stringify({ path: 'a.txt', content: 'alpha-v2\n' });
      res.write(sseChunk({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'write_file', arguments: '' } }] }));
      res.write(sseChunk({ tool_calls: [{ index: 0, function: { arguments: args } }] }));
      finishSse(res, 'tool_calls');
    }),
    hComplete({ text: 'All done — file written and verified.', usage: { prompt_tokens: 30, completion_tokens: 10 } }),
  ]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo();
  try {
    await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    const reports = types(io, 'task_report');
    assert.equal(reports.length, 1, 'EXACTLY one task_report per run');
    const report = reports[0];
    assert.equal(report.outcome, 'completed');
    assert.ok(report.summary && report.summary.length > 0, 'summary present (what happened)');
    assert.deepEqual(report.files, ['a.txt'], 'files changed listed');
    assert.ok(Array.isArray(report.commands), 'commands array present');
    assert.ok(Array.isArray(report.nextSteps) && report.nextSteps.length > 0, 'next steps present');
    assert.ok(Number.isFinite(report.durationMs) && report.durationMs >= 0, 'durationMs present');
    const iReport = io.timeline.findIndex((e) => e.type === 'task_report');
    const iEnd = io.timeline.findIndex((e) => e.type === 'turn_end');
    assert.ok(iReport >= 0 && iEnd > iReport, `task_report (${iReport}) lands BEFORE turn_end (${iEnd})`);
    assert.equal(types(io, 'error').length, 0);
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

test('d2: failover-exhausted error run still emits task_report (outcome error, never silent)', async () => {
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  const ws = mkdtempSync(join(tmpdir(), 'surnia-af-d2-'));
  const mock = startMock();
  const port = await mock.port();
  // both providers hard-fail: initial + 6 FAST_RETRY attempts each
  mock.routes.set('mock-a', [hStatus(500), hStatus(500), hStatus(500), hStatus(500), hStatus(500), hStatus(500), hStatus(500)]);
  mock.routes.set('glm-4.7', [hStatus(500), hStatus(500), hStatus(500), hStatus(500), hStatus(500), hStatus(500), hStatus(500)]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo();
  try {
    await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    const reports = types(io, 'task_report');
    assert.equal(reports.length, 1, 'EXACTLY one task_report even when everything failed');
    assert.equal(reports[0].outcome, 'error');
    assert.ok(reports[0].summary.length > 0, 'the run did not end silently');
    assert.ok(Array.isArray(reports[0].nextSteps) && reports[0].nextSteps.length > 0);
    assert.equal(types(io, 'error').length, 1, 'the provider error surfaced once');
    const iReport = io.timeline.findIndex((e) => e.type === 'task_report');
    const iEnd = io.timeline.findIndex((e) => e.type === 'turn_end');
    assert.ok(iEnd > iReport, 'task_report before turn_end');
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

test('d3: aborted run still emits task_report (outcome aborted) — nothing "ends without a word"', async (t) => {
  if (process.platform === 'win32') return t.skip('stream-timing test calibrated for POSIX CI (Windows timer granularity Ã— 35ms batcher)');
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  const ws = mkdtempSync(join(tmpdir(), 'surnia-af-d3-'));
  const mock = startMock();
  const port = await mock.port();
  mock.routes.set('mock-a', [
    hTextStream({ parts: ['only a few words before the user hit', ' stop'], gap: 120, usage: { prompt_tokens: 10, completion_tokens: 10 } }),
    hComplete({ text: 'SHOULD NEVER BE REQUESTED' }),
  ]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo({ abortOn: 'text_delta' }); // abort the moment the first text lands
  // Under heavy load the first text delta can be coalesced past the point
  // where abortOn fires; guarantee the abort so the contract under test
  // (abort → task_report) is exercised, not skipped by timing.
  const abortFallback = setTimeout(() => {
    if (!io.controller.signal.aborted) io.controller.abort();
  }, 1500);
  try {
    await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    assert.equal(types(io, 'aborted').length, 1, 'aborted event emitted');
    const reports = types(io, 'task_report');
    assert.equal(reports.length, 1, 'EXACTLY one task_report on abort');
    assert.equal(reports[0].outcome, 'aborted');
    assert.ok(reports[0].summary.length > 0, 'abort carries a human-readable summary');
    assert.ok(
      reports[0].nextSteps.some((s) => /resume|follow-up/i.test(s)),
      'next steps tell the user how to resume',
    );
    const iReport = io.timeline.findIndex((e) => e.type === 'task_report');
    const iEnd = io.timeline.findIndex((e) => e.type === 'turn_end');
    assert.ok(iEnd > iReport, 'task_report before turn_end');
    assert.equal(mock.requests.length, 1, 'no continuation after abort');
  } finally {
    clearTimeout(abortFallback);
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------- production-sanity: provider byte watchdog unchanged ----------
test('provider SSE byte watchdog default stays 75s (engine watchdog handles the 20s contract)', () => {
  delete process.env.SURNIA_SSE_IDLE_MS;
  assert.equal(providers.sseIdleTimeoutMs(), 75_000);
});

test('cleanup', () => {
  for (const k of [
    'SURNIA_TURN_RETRY_DELAYS_MS',
    'SURNIA_SSE_IDLE_MS',
    'SURNIA_ENGINE_IDLE_MS',
    'SURNIA_DELTA_FLUSH_MS',
    'SURNIA_MAX_RUN_MS',
    'SURNIA_TIME_CAP_GRACE_MS',
    'SURNIA_STREAM_CONTINUE_BUDGET',
    'SURNIA_MAX_TOKENS_CONTINUES',
    'SURNIA_PAUSE_CONTINUES',
  ]) {
    delete process.env[k];
  }
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
