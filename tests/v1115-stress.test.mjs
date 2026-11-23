import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// v11.15 — HEAVY STRESS / VERIFICATION harness (founder mandate):
// "إصلاح نهائي وأبدي لحل مشكلة انقطاع البث ... لا أريد انقطاع تماما ...
//  مهام طويلة طويلة ... أختبره بشكل كبير وضخم."
//
// This is a BLACK-BOX stress harness: it boots the REAL engine / provider /
// tools / store bundles (esbuild, electron stubbed) and drives genuine
// end-to-end loads through a LOCAL scripted OpenAI-compatible provider
// (node:http — zero network, zero model). No application source is modified.
//
//  1. STREAM CONTINUITY — 5 real engine turns at token speeds from 10ms to
//     2000ms/token. Assert: no unexpected abort/stall, first token fast, no
//     token gap that trips a watchdog, a clean task_report every time.
//  2. LONG RUN — one turn with >=12 real tool calls (write_file + run_command)
//     spanning a REAL engine auto-compaction (forced via usage.prompt_tokens).
//     Assert: all deltas arrive, no tool message dropped, final answer lists
//     every file that was written.
//  3. TOOL STORM — all 142 registered tools dispatched through executeTool
//     with minimal schema-derived args (safe/sandbox defaults, auto-deny).
//     Assert: zero "Unknown tool", zero uncaught throws.
//  4. MALFORMED EVENTS — 500 seeded-random malformed events through the REAL
//     store ingestAgentEvent. Assert: no throw, no state corruption, and a
//     clean stream STILL produces correct state afterwards.
//
// Run:
//   node --test --test-force-exit tests/v1115-stress.test.mjs
// Debug timelines:
//   V1115_DEBUG=1 node --test --test-force-exit tests/v1115-stress.test.mjs
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
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1115-stress-'));
const DEBUG = !!process.env.V1115_DEBUG;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const toolsPath = join(tmp, 'tools.cjs');
const storePath = join(tmp, 'store.cjs');
let engine, providers, tools;
try {
  bundle('electron/agent/engine.ts', engPath);
  bundle('electron/agent/providers.ts', provPath);
  engine = require(engPath);
  providers = require(provPath);
} catch (err) {
  console.error('[v1115] ENGINE/PROVIDER BUNDLE FAILED:', err?.message ?? err);
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
  JSON.stringify(body?.system ?? '') .includes('You compact coding-agent transcripts') ||
  JSON.stringify(body).includes('You compact coding-agent transcripts');

// ---------- mock provider (smart dispatcher) ----------
function startMock(handler) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      const rec = { model: body.model, at: Date.now(), sawTool: (body.messages ?? []).some((m) => m.role === 'tool') };
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
    },
    // autoCompact is ON for every turn: the engine caches agent config on first
    // load, so a hard-coded false here would silently disable the long-run
    // compaction scenario below. Small usage in the continuity turns means it
    // never actually triggers there.
    agent: { maxRetries: 0, autoCompact: true, autoVerify: false, selfCritique: true, runAndShow: true, ...extraAgent },
    doneNotifications: false,
  }));
}
function setEngineEnv({ idleMs, sseMs }) {
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = '8,8,8,8,8,8';
  process.env.SURNIA_DELTA_FLUSH_MS = '20';
  process.env.SURNIA_HOME = userDataDir;
  process.env.SURNIA_SKIP_UI_GATE = '1';
  const idle = idleMs ?? 12_000;
  process.env.SURNIA_SSE_IDLE_MS = String(sseMs ?? idle);
  process.env.SURNIA_ENGINE_IDLE_MS = String(idle);
}

function timeline(io, t0) {
  return io.events.map((e) =>
    `${String(e.at - t0).padStart(6)}ms  ${e.type}${e.kind ? '/' + e.kind : ''}${e.phase ? '/' + e.phase : ''}  ` +
    `${String(e.text ?? e.summary ?? '').slice(0, 80).replace(/\n/g, '\\n')}`).join('\n');
}

// ============================================================
// 1. STREAM CONTINUITY — 5 turns, 10ms → 2000ms per token
// ============================================================
async function continuityTurn({ gap, label }) {
  const mock = startMock(async ({ res, body, rec }) => {
    if (isCompactRequest(body) || body.model !== 'stress-live') {
      sseHeaders(res);
      finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 });
      return;
    }
    sseHeaders(res);
    if (!rec.sawTool) {
      for (const t of ['Analyzing ', 'the task step by step.\n']) {
        res.write(sseChunk({ reasoning_content: t }));
        if (gap) await sleep(gap);
      }
      for (const t of ['I will write ', 'the proof file now.\n']) {
        res.write(sseChunk({ content: t }));
        if (gap) await sleep(gap);
      }
      const args = JSON.stringify({ path: 'proof-stress.txt', content: 'STRESS-CONTINUITY-OK\n' });
      for (const d of toolDeltas('write_file', args, 'call_' + label)) res.write(sseChunk(d));
      finishSse(res, 'tool_calls', { prompt_tokens: 120, completion_tokens: 40 });
    } else {
      for (const t of ['Created proof-stress.txt. ', 'All tests pass. ', 'Done.']) {
        res.write(sseChunk({ content: t }));
        if (gap) await sleep(gap);
      }
      finishSse(res, 'stop', { prompt_tokens: 260, completion_tokens: 30 });
    }
  });
  const port = await mock.port;
  const mockBase = `http://127.0.0.1:${port}/v1`;
  writeSettings(mockBase);
  const ws = mkdtempSync(join(tmpdir(), 'sadeem-v1115-ws-'));
  const io = makeIo();
  // Watchdog windows must comfortably exceed the slowest deliberate token gap.
  const idle = Math.max(6000, gap * 3 + 2000);
  setEngineEnv({ idleMs: idle });

  const t0 = Date.now();
  let thrown = null;
  try {
    await engine.runAgent({
      task: 'chat',
      sessionId: 'v1115-' + label + '-' + Math.random().toString(36).slice(2),
      messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Create proof-stress.txt then report what you did.', timestamp: t0 }],
      model: { provider: 'custom', model: 'stress-live', maxTokens: 2048 },
      mode: 'fullAccess', workspace: ws, apiKey: 'test-key', baseUrl: mockBase,
    }, io);
  } catch (err) { thrown = err; }

  try {
    assert.equal(thrown, null, `${label}: runAgent must not throw (got ${thrown?.stack ?? thrown})`);
    const ev = io.events;
    const types = ev.map((e) => e.type);

    // (a) first token fast (measured from the in-flight provider request)
    const first = ev.find((e) => TOKEN_TYPES.has(e.type));
    assert.ok(first, `${label}: at least one token delta reached the IO`);
    const startup = mock.requests[0] ? mock.requests[0].at - t0 : 0;
    const modelToFirst = mock.requests[0] ? first.at - mock.requests[0].at : Infinity;
    const loadFactor = Math.max(1, Math.min(20, startup / 4000));
    const firstBudget = Math.round(6000 * loadFactor);
    console.error(`[v1115] ${label}: startup=${startup}ms model→firstToken=${modelToFirst}ms (budget ${firstBudget}ms, loadFactor ${loadFactor.toFixed(2)})`);
    assert.ok(modelToFirst <= firstBudget, `${label}: first token within ${firstBudget}ms of request (got ${modelToFirst}ms)`);

    // (b) no token gap that trips a watchdog, while a stream is open
    let last = null, maxGap = 0, gapAt = null;
    for (const e of ev) {
      if (TOKEN_TYPES.has(e.type)) {
        if (last !== null && e.at - last > maxGap) { maxGap = e.at - last; gapAt = e.at - t0; }
        last = e.at;
      } else if (BOUNDARY_TYPES.has(e.type)) {
        last = null;
      }
    }
    console.error(`[v1115] ${label}: maxTokenGap=${maxGap}ms at ~${gapAt}ms (idle window ${idle}ms)`);
    assert.ok(maxGap < idle, `${label}: no token gap trips the ${idle}ms watchdog (max gap ${maxGap}ms)`);

    // (c) no unexpected abort / error / watchdog-stall notice
    const errs = ev.filter((e) => e.type === 'error');
    assert.equal(errs.length, 0, `${label}: no error event (${errs.map((e) => e.text).join('; ')})`);
    assert.equal(types.filter((t) => t === 'aborted').length, 0, `${label}: no abort event`);
    const stalls = ev.filter((e) => /watchdog|stream stalled|stream interrupted|disconnected|no model activity/i.test(e.text ?? ''));
    assert.equal(stalls.length, 0, `${label}: no stall notice (${stalls.map((e) => e.text).join('; ')})`);

    // (d) clean task_report + final answer, in order, no post-stream block
    const reportIdx = types.indexOf('task_report');
    assert.ok(reportIdx >= 0, `${label}: task_report emitted (completion guarantee)`);
    const finalText = ev.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
    assert.ok(finalText.includes('Done.'), `${label}: final answer streamed (got: ${finalText.slice(0, 120)})`);
    const lastTokenAt = [...ev].reverse().find((e) => TOKEN_TYPES.has(e.type))?.at;
    const report = ev[reportIdx];
    const turnEnd = ev.find((e) => e.type === 'turn_end');
    assert.ok(turnEnd, `${label}: turn_end emitted`);
    const lagBudget = Math.round(6000 * loadFactor);
    if (lastTokenAt != null) {
      console.error(`[v1115] ${label}: post-stream lag — report=+${report.at - lastTokenAt}ms turn_end=+${turnEnd.at - lastTokenAt}ms (budget ${lagBudget}ms)`);
      assert.ok(report.at - lastTokenAt <= lagBudget, `${label}: task_report promptly after last token`);
      assert.ok(turnEnd.at - lastTokenAt <= lagBudget, `${label}: turn_end promptly after last token`);
    }
    const turnEndIdx = types.indexOf('turn_end');
    assert.ok(turnEndIdx > reportIdx, `${label}: turn_end is terminal`);
    assert.ok(mock.requests.length >= 2, `${label}: >=2 real provider round-trips (got ${mock.requests.length})`);

    const summary = {
      label, gap, firstTokenMs: modelToFirst, maxGapMs: maxGap,
      durationMs: ev.length ? ev[ev.length - 1].at - t0 : null,
      events: ev.length, requests: mock.requests.length,
    };
    console.error(`[v1115] CONTINUITY-PASS ${JSON.stringify(summary)}`);
    if (DEBUG) console.error(`\n===== ${label} TIMELINE =====\n${timeline(io, t0)}`);
    return { ok: true, summary };
  } finally {
    await mock.stop();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

test('STREAM-CONTINUITY: 5 real engine turns, 10ms→2000ms/token, no abort/stall, fast first token, clean report', { timeout: 300_000 }, async () => {
  const speeds = [
    { label: 'T01-10ms', gap: 10 },
    { label: 'T02-50ms', gap: 50 },
    { label: 'T03-200ms', gap: 200 },
    { label: 'T04-700ms', gap: 700 },
    { label: 'T05-2000ms', gap: 2000 },
  ];
  const summaries = [];
  for (const s of speeds) {
    const r = await continuityTurn(s);
    summaries.push(r.summary);
  }
  console.error('[v1115] CONTINUITY-ALL-PASS turns=' + summaries.length +
    ' totalMs=' + summaries.reduce((a, b) => a + (b.durationMs || 0), 0));
});

// ============================================================
// 2. LONG RUN — >=12 real tool calls across a real compaction
// ============================================================
test('LONG-RUN: >=12 real tool calls (write_file+run_command) across compaction; all deltas, no dropped message, final answer lists all files', { timeout: 300_000 }, async () => {
  const TOTAL = 12;
  const COMPACT_AT = 5; // after this tool call, report huge prompt_tokens to force auto-compact
  const state = { toolCalls: 0, files: [] };
  const mock = startMock(async ({ res, body, rec }) => {
    if (isCompactRequest(body)) {
      sseHeaders(res);
      res.write(sseChunk({ content: 'COMPACT SUMMARY: 12 tool steps; files stress-out/file_*.txt written.\n' }));
      finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 });
      return;
    }
    if (body.model !== 'stress-live') {
      sseHeaders(res);
      finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 });
      return;
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
        // Long output so the verbatim tail exceeds the 4000-char budget and a
        // real head/tail split (hence compaction) happens at COMPACT_AT.
        args = { command: `node -e "console.log('Y'.repeat(2200))"` };
      }
      res.write(sseChunk({ content: `Step ${i + 1}: calling ${name}.\n` }));
      for (const d of toolDeltas(name, JSON.stringify(args), 'call_long_' + i)) res.write(sseChunk(d));
      // Unknown mock model → contextWindowFor() falls back to 200000 tokens,
      // so the 65% compaction trigger is 130000. Report above it to force a
      // REAL engine auto-compaction (engine.ts:3931/3935/4172).
      const usage = i === COMPACT_AT
        ? { prompt_tokens: 200_000, completion_tokens: 40 }
        : { prompt_tokens: 200 + i, completion_tokens: 40 };
      finishSse(res, 'tool_calls', usage);
      return;
    }
    // Final answer names EVERY file that was written.
    const finalText = 'DONE. Wrote ' + state.files.length + ' files: ' + state.files.join(', ') + '. All done.\n';
    const parts = finalText.match(/.{1,60}/g) ?? [finalText];
    for (const p of parts) res.write(sseChunk({ content: p }));
    finishSse(res, 'stop', { prompt_tokens: 300, completion_tokens: 80 });
  });
  const port = await mock.port;
  const mockBase = `http://127.0.0.1:${port}/v1`;
  // compactThreshold shrinks the verbatim tail budget (engine.ts:4177-4179)
  // so the huge usage token actually forces compaction instead of keeping
  // every message verbatim (which would leave head.length<2 and skip it).
  writeSettings(mockBase, { autoCompact: true, compactThreshold: 10_000 });
  const ws = mkdtempSync(join(tmpdir(), 'sadeem-v1115-long-'));
  const io = makeIo();
  setEngineEnv({ idleMs: 15_000 });
  try {
    const costsPath = join(tmp, 'costs.cjs'), svcPath = join(tmp, 'svc.cjs');
    bundle('electron/agent/costs.ts', costsPath);
    bundle('electron/services/storeService.ts', svcPath);
    const costsDbg = require(costsPath);
    const svcDbg = require(svcPath);
    const win = costsDbg.contextWindowFor('stress-live');
    console.error(`[v1115] LONG-RUN diag: contextWindowFor=${win}, threshold=${Math.floor(Math.max(8000, win || 200000) * 0.65)}, settings.agent=${JSON.stringify(svcDbg.getSettings().agent)}`);
  } catch (dbgErr) { console.error('[v1115] LONG-RUN diag failed: ' + dbgErr.message); }

  const t0 = Date.now();
  let thrown = null;
  try {
    await engine.runAgent({
      task: 'chat',
      sessionId: 'v1115-long-' + Math.random().toString(36).slice(2),
      messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Do all 12 steps end to end. ' + 'CONTEXT-FILLER '.repeat(600), timestamp: t0 }],
      model: { provider: 'custom', model: 'stress-live', maxTokens: 2048 },
      mode: 'fullAccess', workspace: ws, apiKey: 'test-key', baseUrl: mockBase,
    }, io);
  } catch (err) { thrown = err; }

  try {
    assert.equal(thrown, null, `runAgent must not throw (got ${thrown?.stack ?? thrown})`);
    const ev = io.events;
    const types = ev.map((e) => e.type);

    // every tool dispatched exactly once, with a matching ok result
    const starts = ev.filter((e) => e.type === 'tool_start');
    const results = ev.filter((e) => e.type === 'tool_result');
    assert.equal(state.toolCalls, TOTAL, `all ${TOTAL} tool calls were requested (got ${state.toolCalls})`);
    assert.equal(starts.length, TOTAL, `${TOTAL} tool_start events (got ${starts.length})`);
    assert.equal(results.filter((r) => r.ok).length, TOTAL, `${TOTAL} ok tool_result events`);
    const startIds = starts.map((s) => s.toolCallId).sort();
    const resultIds = results.map((r) => r.toolCallId).sort();
    assert.deepEqual(startIds, resultIds, 'no tool message dropped: every tool_start has a matching tool_result');

    // the forced compaction actually happened (real engine event / heartbeat)
    const compacted = ev.some((e) => e.type === 'compaction' || (e.type === 'heartbeat' && e.phase === 'compacting') || e.type === 'compaction_done');
    console.error(`[v1115] LONG-RUN: compactionObserved=${compacted}, compaction=${ev.filter((e) => e.type === 'compaction').length}, heartbeats=${ev.filter((e) => e.type === 'heartbeat').length}`);
    console.error('[v1115] LONG-RUN heartbeat phases: ' + JSON.stringify(ev.filter((e) => e.type === 'heartbeat').map((e) => e.phase)));
    console.error('[v1115] LONG-RUN notices: ' + JSON.stringify(ev.filter((e) => e.type === 'sys_notice').map((e) => e.text)));
    console.error('[v1115] LONG-RUN requests: ' + JSON.stringify(mock.requests.map((r) => r.model)));
    console.error('[v1115] LONG-RUN message_end usage: ' + JSON.stringify(ev.filter((e) => e.type === 'message_end').map((e) => e.usage)));
    assert.ok(compacted, 'a real engine compaction occurred mid-run and the run continued');

    // all deltas arrive: final text lists every wrote file
    const finalText = ev.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
    for (const f of state.files) {
      assert.ok(finalText.includes(f), `final answer contains wrote file ${f}`);
    }
    assert.ok(finalText.includes('All done.'), 'final answer completed');

    // no abort / error / stall
    assert.equal(types.filter((t) => t === 'error').length, 0, 'no error event');
    assert.equal(types.filter((t) => t === 'aborted').length, 0, 'no abort event');
    const stalls = ev.filter((e) => /watchdog|stream stalled|stream interrupted|disconnected|no model activity/i.test(e.text ?? ''));
    assert.equal(stalls.length, 0, `no stall notice (${stalls.map((e) => e.text).join('; ')})`);
    assert.ok(types.includes('task_report'), 'task_report emitted');
    assert.ok(types.includes('turn_end'), 'turn_end emitted');

    // the files really landed on disk
    const { existsSync } = require('node:fs');
    for (const f of state.files) {
      assert.ok(existsSync(join(ws, f)), `wrote file exists on disk: ${f}`);
    }

    const summary = {
      tools: starts.length, resultsOk: results.filter((r) => r.ok).length,
      files: state.files.length, compactionObserved: compacted,
      textDeltas: ev.filter((e) => e.type === 'text_delta').length,
      durationMs: ev.length ? ev[ev.length - 1].at - t0 : null, events: ev.length,
    };
    console.error(`[v1115] LONG-RUN-PASS ${JSON.stringify(summary)}`);
    if (DEBUG) console.error(`\n===== LONG-RUN TIMELINE =====\n${timeline(io, t0)}`);
  } finally {
    await mock.stop();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ============================================================
// 3. TOOL STORM — all 142 tools, minimal args, zero unknown / throws
// ============================================================
function minimalValue(key, sch, ws) {
  if (sch?.enum?.length) return sch.enum[0];
  const t = sch?.type;
  if (t === 'integer' || t === 'number') return 1;
  if (t === 'boolean') return false;
  if (t === 'array') return [];
  if (t === 'object') return {};
  const lk = String(key).toLowerCase();
  if (/path|file|dir|db|dest|archive|program|image|input|workspace|folder/.test(lk)) return join(ws, 'probe');
  if (/url|uri|endpoint|host/.test(lk)) return 'http://127.0.0.1:9/';
  if (/sql/.test(lk)) return 'SELECT 1';
  if (/command|cmd|expression|code|script/.test(lk)) return 'echo stress';
  if (/ref|index|line|character|count|ms|limit|offset|pid|id|port|n$|number/.test(lk)) return 1;
  return 'stress';
}
function minimalArgs(def, ws) {
  const p = def.parameters ?? {};
  const props = p.properties ?? {};
  const req = Array.isArray(p.required) ? p.required : [];
  const out = {};
  for (const k of [...new Set([...req, ...Object.keys(props).slice(0, 3)])]) {
    out[k] = minimalValue(k, props[k] ?? {}, ws);
  }
  return out;
}

test('TOOL-STORM: every registered tool dispatches via executeTool (safe minimal args) — zero Unknown tool, zero uncaught throws', { timeout: 300_000 }, async () => {
  process.env.SURNIA_NO_BROWSER = '1';
  bundle('electron/agent/tools.ts', toolsPath);
  tools = require(toolsPath);
  const defs = tools.getToolDefs([]);
  // The live registry has grown past the historical "142" figure; dispatch
  // EVERY registered tool (never fewer) and report the exact count honestly.
  const TOOL_COUNT = defs.length;
  assert.ok(TOOL_COUNT >= 142, `registry count ${TOOL_COUNT} regressed below the 142-tool baseline`);
  console.error(`[v1115] TOOL-STORM: live registry has ${TOOL_COUNT} tools (task brief said 142) — dispatching all of them`);

  const stormWs = join(tmp, 'storm-ws');
  mkdirSync(stormWs, { recursive: true });
  writeFileSync(join(stormWs, 'probe.txt'), 'stress fixture\n');

  // Tools whose minimal args could still spawn processes / hit the network /
  // do heavy work are driven with {} so they refuse fast and honestly.
  const FORCE_EMPTY = new Set([
    'run_background', 'process_output', 'stop_process', 'process_kill', 'process_list',
    'debug_start', 'debug_state', 'debug_eval', 'debug_step', 'debug_stop',
    'test_run', 'lint_check', 'env_install', 'export_project', 'env_probe', 'env_manager', 'network_info', 'port_probe', 'sys_info',
    'web_search', 'search_web', 'image_search', 'web_fetch', 'http_request',
    'download_file', 'browser_download', 'archive_create', 'archive_extract',
    'pdf_make', 'pdf_read', 'docx_make', 'xlsx_make', 'pptx_make', 'media_ffmpeg',
    'image_generate', 'e2e_run', 'lighthouse', 'a11y_audit', 'git_platform',
    'db_query', 'db_seed', 'db_migrate', 'create_pull_request', 'pr_status',
    'preview', 'preview_screenshot', 'gen_ui', 'screenshot', 'desktop_control',
    'notify_user', 'open_path', 'reveal_in_folder', 'device_launch_app',
    'run_command', 'browser_navigate', 'browser_snapshot', 'browser_click',
    'browser_type', 'browser_read', 'browser_screenshot', 'browser_eval',
    'browser_wait_for', 'browser_select', 'browser_console', 'browser_console_eval',
    'browser_close', 'browser_network', 'browser_tabs', 'task', 'checkpoint_restore',
  ]);

  function stormCtx(deny) {
    const approvals = [];
    return {
      workspace: stormWs, sessionId: 'v1115-tool-storm', mcpServers: [],
      emit() {},
      approve: async (req) => { approvals.push(req?.kind ?? '?'); return !deny; },
      fullAccess: false,
      denyHint: deny ? 'stress harness: read-only (auto-denied)' : undefined,
      approvals,
    };
  }

  const rounds = [
    { label: 'empty-args/allow', deny: false, empty: true },
    { label: 'schema-minimal/deny(read-only)', deny: true, empty: false },
  ];
  const unknown = [], threw = [], invalidJson = [], failures = [];
  let ok = 0, refusal = 0, calls = 0;
  const t0 = Date.now();
  for (const round of rounds) {
    const ctx = stormCtx(round.deny);
    for (const def of defs) {
      const args = round.empty || FORCE_EMPTY.has(def.name) ? {} : minimalArgs(def, stormWs);
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
      if (ms > 8000) console.error(`[v1115] slow tool ${def.name}[${round.label}]=${ms}ms`);
    }
  }
  const durationMs = Date.now() - t0;
  console.error(`[v1115] TOOL-STORM: calls=${calls} ok=${ok} honestRefusal=${refusal} unknown=${unknown.length} threw=${threw.length} invalidJson=${invalidJson.length} otherFailures=${failures.length} durationMs=${durationMs}`);
  if (unknown.length) console.error('[v1115] unknown tools: ' + unknown.join(', '));
  if (threw.length) console.error('[v1115] throws: ' + threw.join(' | '));
  if (invalidJson.length) console.error('[v1115] invalid-json: ' + invalidJson.join(', '));
  if (failures.length) console.error('[v1115] other failures: ' + failures.join(' | '));

  assert.equal(calls, TOOL_COUNT * 2, `2 rounds × ${TOOL_COUNT} tools = ${TOOL_COUNT * 2} dispatches (got ${calls})`);
  assert.deepEqual(unknown, [], `zero "Unknown tool" responses: ${unknown.join(', ')}`);
  assert.deepEqual(threw, [], `zero uncaught throws: ${threw.join(' | ')}`);
  assert.deepEqual(invalidJson, [], `zero "Invalid JSON args" for valid args: ${invalidJson.join(', ')}`);
  assert.deepEqual(failures, [], `zero outright failures: ${failures.join(' | ')}`);
  assert.equal(ok + refusal, calls, 'every dispatch returned an ok or honest-refusal outcome');
  console.error('[v1115] TOOL-STORM-PASS');
});

// ============================================================
// 4. MALFORMED EVENTS — 500 seeded-random events through store ingest
// ============================================================
test('MALFORMED-EVENTS: 500 random malformed events through store ingest — no throw, no corruption, clean stream still works', { timeout: 180_000 }, async () => {
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

  bundle('src/store.ts', storePath);
  const { useStore } = require(storePath);
  const ws = join(tmp, 'store-ws');
  function seed() {
    useStore.setState({
      wsPath: ws,
      session: {
        id: 's1', title: 't', workspace: ws, messages: [], createdAt: Date.now(),
        updatedAt: Date.now(), messageCount: 0, totalTokens: 0, totalCostUsd: 0,
      },
      running: true, capabilityPanel: null, continueHint: null, lastTaskReport: null,
      lastPlaybookLearning: null, subagentSteps: {}, subagentDetailId: null,
      proof: { status: 'unproven', gates: [], updatedAt: 0 },
    });
  }

  // seeded PRNG (mulberry32) — reproducible across the 3 suite runs
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
  function randVal() {
    switch ((r() * 8) | 0) {
      case 0: return null;
      case 1: return undefined;
      case 2: return r() * 1000;
      case 3: return (r() * 2) | 0 === 1;
      case 4: return 'x'.repeat(1 + ((r() * 8) | 0));
      case 5: return [randVal(), randVal()];
      case 6: return { nested: randVal() };
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
    const e = { type: r() < 0.82 ? TYPES[(r() * TYPES.length) | 0] : randVal() };
    for (const k of FIELDS) if (r() < 0.28) e[k] = randVal();
    // occasionally stamp a recognizable index so timeline corruption is traceable
    if (r() < 0.2) e.text = `evt-${i}`;
    return e;
  }

  seed();
  const ingest = useStore.getState().ingestAgentEvent;
  assert.equal(typeof ingest, 'function', 'ingestAgentEvent exists on the real store');
  const t0 = Date.now();
  let throws = 0;
  const thrownDetails = [];
  for (let i = 0; i < 500; i++) {
    const ev = makeEvent(i);
    try { ingest(ev); }
    catch (err) { throws++; if (thrownDetails.length < 10) thrownDetails.push(`#${i} ${err?.message ?? err} | event=${JSON.stringify(ev)}`); }
  }
  const durationMs = Date.now() - t0;
  console.error(`[v1115] MALFORMED-EVENTS: 500 events in ${durationMs}ms, throws=${throws}`);
  if (throws) console.error('[v1115] malformed throw details: ' + thrownDetails.join(' | '));
  assert.equal(throws, 0, `no throw across 500 malformed events (got ${throws}: ${thrownDetails.join(' | ')})`);

  // state not structurally corrupted
  const after = useStore.getState();
  assert.ok(after, 'store state still present');
  assert.equal(typeof after.running, 'boolean', 'running flag still a boolean');
  assert.equal(typeof after.ingestAgentEvent, 'function', 'ingest function intact');

  // functional proof: a CLEAN stream after the storm still produces correct state
  seed();
  const fresh = useStore.getState().ingestAgentEvent;
  fresh({ type: 'think_delta', text: 'reasoning…' });
  fresh({ type: 'text_delta', text: 'answer' });
  fresh({ type: 'message_end', usage: undefined });
  const msgs = useStore.getState().session.messages;
  const bubble = msgs.find((m) => m.role === 'assistant' && m.kind === 'text');
  assert.ok(bubble, 'assistant bubble still materializes after the storm');
  assert.equal(bubble.content, 'answer', 'buffered delta still flushes correctly (no "thinking stops")');
  assert.equal(bubble.thinking, 'reasoning…', 'thinking still attached');
  fresh({ type: 'task_report', outcome: 'completed', summary: 'ok', files: [], commands: [], nextSteps: [] });
  assert.ok(useStore.getState().lastTaskReport, 'task_report still lands after the storm');
  fresh({ type: 'turn_end' });
  assert.equal(useStore.getState().running, false, 'turn_end still clears running after the storm');
  console.error('[v1115] MALFORMED-EVENTS-PASS');
});

after(() => {
  for (const k of [
    'SURNIA_SSE_IDLE_MS', 'SURNIA_ENGINE_IDLE_MS', 'SURNIA_TURN_RETRY_DELAYS_MS',
    'SURNIA_DELTA_FLUSH_MS', 'SURNIA_HOME', 'SURNIA_SKIP_UI_GATE', 'SURNIA_NO_BROWSER',
  ]) delete process.env[k];
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});
