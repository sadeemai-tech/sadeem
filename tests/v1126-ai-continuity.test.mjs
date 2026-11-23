import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================================
// v11.26 — AI CONTINUITY TESTER — DIAGNOSIS + TEST ONLY (NO APP SOURCE EDITS).
//
// The founder: "تأكد لا ينقطع الذكاء الاصطناعي أبداً... مهمات طويلة جدا لساعات...
// لازم يعطيني ريبورت كتابي."  ("Make sure the AI NEVER disconnects ... very long
// hours-long tasks ... it must give me a WRITTEN report.")
//
// This harness drives the REAL electron/agent/engine.ts runAgent() (esbuild
// bundled, electron stubbed) against a LOCAL scripted OpenAI-compatible provider
// (node:http — zero network, zero model), then replays every engine event into
// the REAL src/store.ts ingestAgentEvent. It does NOT edit application source.
//
// NASTY CASES (the task's (a)–(h)):
//   a  stream drops mid-answer then recovers (visible notice, same task)
//   b  provider returns garbage SSE (non-SSE bytes / unparseable frames)
//   c  long stream with periodic deltas over a scaled-clock "long" duration
//   d  tool throws (real safety guard exception → honest tool_result ok:false)
//   e  user abort mid-THINKING (not mid-answer)
//   f  post-processing throws (one-shot sink failure on `message_end`)
//   g  provider returns 402 (no credits) — fatal, no silent retry
//   h  429 then success — one bounded same-provider retry
//   +  HOURS-LONG SIMULATION: hundreds of tool rounds with scaled clocks — must
//      keep going past the 120-step budget via auto-continue until the USER stops
//      it; assert NO artificial cap ended the run.
//
// PER-CASE CONTRACT (checked for EVERY scenario — the task's "FOR EACH assert"):
//   1  NO SILENT STOP  — output/activity exists, no unexpected budget stop,
//                        no unbounded gap before the terminal report.
//   2  exactly ONE terminal `task_report` with an HONEST written outcome
//      (outcome matches the error/abort evidence; summary is a real sentence).
//   3  `turn_end` is the LAST event (only dna_updated may follow).
//   4  `running` clears (REAL store replay).
//   5  no duplicate error rows / error events.
//   6  all real tool calls reported (tool_start ↔ tool_result, exact count).
//   7  local overhead bounded (last activity → report → turn_end, wall time).
//   8  no raw JSON anywhere user-visible.
//
// Run:   node --test --test-force-exit tests/v1126-ai-continuity.test.mjs
// Debug: V1126_DEBUG=1 node --test --test-force-exit tests/v1126-ai-continuity.test.mjs
//
// VERDICT POLICY: every failed check is printed as `[V1126 FAIL] <scenario> ::
// [I#] <check> :: <detail> :: @<file>:<line>` and ranked by user impact. A green
// run is the ONLY "AI never disconnects" signal. Nothing is suppressed.
// ============================================================================
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
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1126-ai-continuity-'));
const DEBUG = !!process.env.V1126_DEBUG;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Bounded local overhead budget (scaled clocks: mock provider + local tools).
// Anything slower than this on a zero-network loopback run is a real stall.
const OVERHEAD_MS = 4000;
const TERMINAL_LAG_MS = 1000;
const SILENT_GAP_MS = 8000;
const MAX_RUN_MS = 90_000;

// ---------------------------------------------------------------------------
// BUNDLE the real engine + store (electron stubbed with an isolated userData).
// ---------------------------------------------------------------------------
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
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder() {}, trashItem: async () => {} },
  clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
  WebContents: class {}, BrowserWindow: StubBrowserWindow,
  powerMonitor: { on() {} }, screen: {},
};`);

let engine;
try {
  const engPath = join(tmp, 'engine.cjs');
  bundle('electron/agent/engine.ts', engPath);
  engine = require(engPath);
} catch (err) {
  console.error('[V1126] ENGINE BUNDLE FAILED — no agent turn can start:', err?.message ?? err);
  throw err;
}

// Real store (window bridge + localStorage installed BEFORE load, per v1115).
const bridge = new Proxy({}, {
  get(_t, key) {
    if (key === 'then' || typeof key === 'symbol') return undefined;
    return (..._a) => {
      switch (key) {
        case 'gitStatus': return Promise.resolve({ isRepo: false, branch: '', changed: [] });
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
globalThis.window = { surnia: bridge, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { documentElement: { classList: { contains: () => false }, dataset: {}, style: {} }, addEventListener() {} };
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
let store;
try {
  const storePath = join(tmp, 'store.cjs');
  bundle('src/store.ts', storePath);
  store = require(storePath).useStore;
} catch (err) {
  console.error('[V1126] STORE BUNDLE FAILED:', err?.message ?? err);
  throw err;
}

// ---------------------------------------------------------------------------
// SSE + HTTP helpers.
// ---------------------------------------------------------------------------
const MAIN = 'v1126-live';
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'v1126-mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
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
function httpError(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// Controllable mock provider (loopback only). `dispatch.onMain` owns the main
// assistant turn and may write raw SSE / drop the socket / trigger an abort.
// ---------------------------------------------------------------------------
function startMock(dispatch, state) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      const sys = JSON.stringify(body);
      const msgs = body.messages ?? [];
      const rec = {
        model: body.model,
        at: Date.now(),
        sawTool: msgs.some((m) => m.role === 'tool'),
        lastRole: msgs.length ? msgs[msgs.length - 1].role : null,
        isCompact: /compact coding-agent transcripts/i.test(sys),
        isSubagent: /part of the Surnia agent team/i.test(sys),
        isExtraction: /extract durable engineering facts|Surnia DNA user model|maintain the Surnia DNA/i.test(sys),
      };
      requests.push(rec);
      try {
        if (rec.isCompact || rec.isExtraction || rec.isSubagent) {
          sseHeaders(res);
          finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 });
          return;
        }
        if (body.model !== MAIN) {
          sseHeaders(res);
          finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 });
          return;
        }
        const n = state.mainCount++;
        await dispatch.onMain({ res, req, body, rec, n, io: dispatch._io });
      } catch (err) {
        // A handler that intentionally destroys the socket lands here.
        try { res.destroy(); } catch { /* gone */ }
        state.handlerErrors.push(String(err?.message ?? err));
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

// ---------------------------------------------------------------------------
// Renderer-style IO recorder (abort control + one-shot fault injection).
// ---------------------------------------------------------------------------
function makeIo(opts = {}) {
  const events = [];
  let abortCb = null;
  let thrown = false;
  const io = {
    events,
    __aborted: false,
    __thrownOnce: false,
    send(e) {
      events.push({ ...e, raw: e, at: Date.now() });
      if (opts.throwOnceOn && e.type === opts.throwOnceOn && !thrown) {
        thrown = true;
        io.__thrownOnce = true;
        throw new Error('[V1126 injected] post-processing sink failure on ' + e.type);
      }
    },
    getDecision() { return Promise.resolve({ requestId: 'v1126', action: 'allow' }); },
    isAborted() { return io.__aborted === true; },
    onFetchSignal(cb) { abortCb = cb; },
    triggerAbort() {
      io.__aborted = true;
      const ac = new AbortController();
      ac.abort();
      try { abortCb?.(ac.signal); } catch { /* ignore */ }
    },
  };
  return io;
}

function writeSettings(base, extra = {}) {
  const agent = {
    maxRetries: 0, autoCompact: false, compactThreshold: 10_000,
    autoVerify: false, selfCritique: false, criticGate: false, autoMemory: false,
    checkpointsEnabled: false, allowModelFailover: false,
    ...(extra.agent ?? {}),
  };
  const { agent: _a, ...rest } = extra;
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({
    schemaVersion: 4,
    language: 'en',
    providers: {
      custom: { apiKey: 'test-key', baseUrl: base },
      zai: { apiKey: 'test-key', baseUrl: base },
    },
    agent,
    doneNotifications: false,
    ...rest,
  }));
}
function setEngineEnv(o = {}) {
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = o.retryDelays ?? '5,5,5,5,5,5';
  process.env.SURNIA_DELTA_FLUSH_MS = '5';
  process.env.SURNIA_HOME = userDataDir;
  process.env.SURNIA_SKIP_UI_GATE = '1';
  process.env.SURNIA_STREAM_CONTINUE_BUDGET = String(o.continueBudget ?? 0);
  process.env.SURNIA_MAX_TOKENS_CONTINUES = String(o.maxTokenContinues ?? 25);
  process.env.SURNIA_SSE_IDLE_MS = String(o.sseIdle ?? 20_000);
  process.env.SURNIA_ENGINE_IDLE_MS = String(o.engineIdle ?? 30_000);
  if (o.maxRunMs) process.env.SURNIA_MAX_RUN_MS = String(o.maxRunMs);
  else delete process.env.SURNIA_MAX_RUN_MS;
  if (o.subagentTimeout) process.env.SURNIA_SUBAGENT_TIMEOUT_MS = String(o.subagentTimeout);
  else delete process.env.SURNIA_SUBAGENT_TIMEOUT_MS;
}
function seedStore() {
  store.setState({
    wsPath: ROOT,
    session: { id: 'v1126', title: 't', workspace: ROOT, messages: [], createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0, totalTokens: 0, totalCostUsd: 0 },
    settings: { ...store.getState().settings, language: 'en', model: { provider: 'custom', model: MAIN } },
    running: true,
    proof: { status: 'unproven', gates: [], updatedAt: 0 },
    proofVisible: false,
    lastTaskReport: null,
    capabilityPanel: null,
    continueHint: null,
  });
}
function baseParams(name, base, ws) {
  return {
    task: 'chat',
    sessionId: 'v1126-' + name + '-' + Math.random().toString(36).slice(2),
    messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Do the task, then give me a WRITTEN report of what happened.', timestamp: Date.now() }],
    model: { provider: 'custom', model: MAIN, maxTokens: 2048 },
    mode: 'fullAccess',
    workspace: ws,
    apiKey: 'test-key',
    baseUrl: base,
  };
}

// ---------------------------------------------------------------------------
// Failure accumulator + assertion helpers.
// ---------------------------------------------------------------------------
const ALL = [];
function ck(list, cond, check, detail, impact, source) {
  if (!cond) list.push({ check, detail: String(detail), impact, source });
}
const ARABIC = (s) => [...String(s ?? '')].some((ch) => /\p{Script=Arabic}/u.test(ch) && /\p{Alphabetic}/u.test(ch));
const RAW_JSON = (s) => /\{\s*"[A-Za-z_][A-Za-z0-9_]*"\s*:/.test(String(s ?? '')) || /\[\s*\{\s*"/.test(String(s ?? ''));

/** Derive the final streamed answer (text deltas after the last tool result). */
function finalTextOf(ev) {
  let lastTool = -1;
  ev.forEach((e, i) => { if (e.type === 'tool_result') lastTool = i; });
  return ev.filter((e, i) => e.type === 'text_delta' && i > lastTool).map((e) => e.text).join('');
}

/**
 * Drive one runAgent() call. Returns {ev, requests, failures, after, thrown,
 * io, state, durationMs, finalText}.
 */
async function drive(name, cfg) {
  const state = { mainCount: 0, handlerErrors: [] };
  const mock = startMock(cfg.dispatch, state);
  const port = await mock.port;
  const mockBase = `http://127.0.0.1:${port}/v1`;
  writeSettings(mockBase, cfg.settings ?? {});
  setEngineEnv(cfg.env ?? {});
  const io = makeIo(cfg.io ?? {});
  cfg.dispatch._io = io;
  const ws = mkdtempSync(join(tmp, 'v1126-ws-' + name.replace(/[^a-z0-9]/gi, '') + '-'));
  const params = { ...baseParams(name, mockBase, ws), ...(cfg.params ?? {}) };
  const t0 = Date.now();
  let thrown = null;
  try {
    await engine.runAgent(params, io);
  } catch (err) {
    thrown = err;
  }
  const durationMs = Date.now() - t0;

  // Replay into the REAL store for running / proof / error-row assertions.
  seedStore();
  for (const e of io.events) {
    try { store.getState().ingestAgentEvent(e.raw); } catch { /* best-effort */ }
  }
  const after = store.getState();
  const ev = io.events;

  // ---- COMMON CONTRACT — 1..8, applied to EVERY scenario ----
  const fails = [];
  const reports = ev.filter((e) => e.type === 'task_report');
  const turnEnds = ev.filter((e) => e.type === 'turn_end');
  const errEvents = ev.filter((e) => e.type === 'error');
  const abortEvents = ev.filter((e) => e.type === 'aborted');
  const starts = ev.filter((e) => e.type === 'tool_start');
  const results = ev.filter((e) => e.type === 'tool_result');
  const activity = ev.filter((e) => ['text_delta', 'think_delta', 'tool_result'].includes(e.type));
  const finalText = finalTextOf(ev);

  // (1) no silent stop + (2) exactly one honest report.
  ck(fails, thrown === null, 'runAgent does not throw', thrown?.stack ?? thrown, 1, 'engine.ts:1427');
  ck(fails, reports.length === 1, 'exactly one terminal task_report', `got ${reports.length}`, 1, 'engine.ts:1808/4188');
  ck(fails, turnEnds.length === 1, 'exactly one turn_end', `got ${turnEnds.length}`, 1, 'engine.ts:1990/4205');
  if (reports.length && turnEnds.length) {
    ck(fails, ev.indexOf(turnEnds[0]) > ev.indexOf(reports[0]), 'task_report precedes turn_end', 'terminal order wrong', 1, 'engine.ts:4053/4205');
    // (3) turn_end LAST (only dna_updated may legally follow — engine.ts:1460).
    const tail = ev.slice(ev.indexOf(turnEnds[0]) + 1).map((e) => e.type);
    ck(fails, tail.every((t) => t === 'dna_updated'), 'turn_end is the LAST user-visible event', `events after turn_end: ${tail.join(',')}`, 1, 'engine.ts:1449-1460/1999');
  }
  if (reports.length) {
    const rep = reports[0];
    // Honest outcome derived from the run's OWN evidence, not the ask.
    // v11.26 — a failed TOOL call is also evidence: the founder refuses a
    // clean "completed" when tools failed (engine now reports 'error').
    const failedTools = ev.filter((e) => e.type === 'tool_result' && e.ok === false);
    const expected = abortEvents.length || cfg.expectAbort
      ? 'aborted'
      : errEvents.length || failedTools.length ? 'error' : 'completed';
    ck(fails, rep.outcome === expected, 'task_report outcome matches evidence', `outcome=${rep.outcome}, expected=${expected} (errs=${errEvents.length}, aborted=${abortEvents.length})`, 1, 'engine.ts:4037/4043/4175/4191');
    ck(fails, typeof rep.summary === 'string' && rep.summary.trim().length > 0, 'task_report has a WRITTEN summary', JSON.stringify(rep.summary), 1, 'engine.ts:1886');
    ck(fails, !/^(undefined|null|\[object Object\])$/i.test(String(rep.summary).trim()), 'task_report summary is not a placeholder', rep.summary, 2, 'engine.ts:1886');
    if (expected === 'error' && errEvents.length) {
      ck(fails, String(rep.summary).includes(errEvents[0].message), 'error report repeats the one error verbatim (one owner surface)', JSON.stringify({ summary: rep.summary, err: errEvents[0].message }), 2, 'engine.ts:4037/4175');
    }
    // Banned stop reasons must never masquerade as a clean completion.
    const banned = ['max_tokens', 'time_cap', 'paused'];
    ck(fails, !banned.includes(rep.stopReason) || cfg.allowBudgetStop === true, 'no silent budget/time cap ended the run', `stopReason=${rep.stopReason}`, 2, 'engine.ts:4029-4033');
    if (rep.outcome === 'completed') {
      ck(fails, rep.partial !== true, 'completed report is not secretly partial', `partial=${rep.partial}`, 2, 'engine.ts:1927');
    }
  }
  // (1) no silent stop — expected activity / final answer.
  if (cfg.expectOutput !== false) {
    ck(fails, activity.length > 0 || starts.length > 0, 'run produced visible model activity', `text=${ev.filter((e)=>e.type==='text_delta').length} think=${ev.filter((e)=>e.type==='think_delta').length} tools=${starts.length}`, 1, 'engine.ts:4974/4984');
  }
  if (cfg.expectFinalText !== false) {
    ck(fails, finalText.trim().length > 0, 'run produced a non-empty written answer (no silent stop)', `finalText=${JSON.stringify(finalText.slice(0, 80))}`, 1, 'engine.ts:5192/5844');
  }
  // (4) running clears (REAL store).
  ck(fails, after.running === false, 'running clears', `running=${after.running}`, 1, 'src/store.ts:2994');
  // (5) no duplicate error rows / events.
  const errRows = (after.session?.messages ?? []).filter((m) => m.model === 'error');
  ck(fails, errRows.length <= 1, 'at most one error row in transcript', `got ${errRows.length}`, 3, 'src/store.ts:3061');
  ck(fails, errEvents.length <= 1, 'at most one error event', `got ${errEvents.length}`, 3, 'engine.ts:1487 (sendError dedupe)');
  // (6) all real tool calls reported, with honest results.
  if (cfg.expectedTools !== undefined) {
    ck(fails, starts.length === cfg.expectedTools, 'all real tool calls reported (tool_start count)', `starts=${starts.length}, expected=${cfg.expectedTools}`, 2, 'engine.ts:5245');
  }
  ck(fails, results.length === starts.length, 'every tool_start has one tool_result', `starts=${starts.length}, results=${results.length}`, 2, 'engine.ts:5245');
  const startIds = new Set(starts.map((s) => s.toolCallId));
  const resultIds = new Set(results.map((r) => r.toolCallId));
  ck(fails, starts.every((s) => resultIds.has(s.toolCallId)) && results.every((r) => startIds.has(r.toolCallId)), 'tool_start/tool_result ids pair up', `starts=${[...startIds]} results=${[...resultIds]}`, 2, 'engine.ts:5245');
  ck(fails, results.every((r) => typeof r.ok === 'boolean'), 'tool results carry an honest ok flag', JSON.stringify(results.map((r) => r.ok)), 3, 'engine.ts:5245');
  // (7) local overhead bounded (scaled clocks).
  const lastActivityAt = activity.length ? activity[activity.length - 1].at : (ev[0]?.at ?? t0);
  const repAt = reports[0]?.at ?? t0;
  const teAt = turnEnds[0]?.at ?? t0;
  const over = repAt - lastActivityAt;
  const overBudget = cfg.maxOverheadMs ?? OVERHEAD_MS;
  ck(fails, over <= overBudget, 'local overhead bounded (last activity → task_report)', `${over}ms > ${overBudget}ms`, 2, 'engine.ts:3984-4053');
  ck(fails, teAt - repAt <= TERMINAL_LAG_MS, 'turn_end follows report with no stall', `${teAt - repAt}ms`, 2, 'engine.ts:4053/4205');
  const maxRun = cfg.maxDurationMs ?? MAX_RUN_MS;
  ck(fails, durationMs <= maxRun, 'run wall time bounded', `${durationMs}ms > ${maxRun}ms`, 2, 'engine.ts:1427');
  // (1b) no long silent gap between successive activity events (long streams).
  let maxGap = 0;
  for (let i = 1; i < activity.length; i++) maxGap = Math.max(maxGap, activity[i].at - activity[i - 1].at);
  ck(fails, maxGap <= (cfg.maxSilentGapMs ?? SILENT_GAP_MS), 'no unbounded silent gap mid-run', `maxGap=${maxGap}ms`, 1, 'engine.ts:4898-4948 (idle watchdog)');
  // (8) no raw JSON user-visible (tool_result.output is machine output, excluded).
  const userTexts = [
    ...ev.filter((e) => e.type === 'text_delta').map((e) => e.text),
    ...ev.filter((e) => e.type === 'think_delta').map((e) => e.text),
    ...errEvents.map((e) => e.message),
    ...reports.flatMap((e) => [e.summary, ...(e.nextSteps ?? [])]),
    ...errRows.map((m) => m.content),
  ];
  const jsonLeaks = userTexts.filter((t) => RAW_JSON(t));
  ck(fails, jsonLeaks.length === 0, 'no raw JSON user-visible', jsonLeaks.map((s) => String(s).slice(0, 120)).join(' | '), 2, 'providers.ts:1919-1921 / engine.ts:4037');

  if (DEBUG) {
    console.error(`\n===== ${name} TIMELINE (${durationMs}ms, requests=${state.mainCount}) =====`);
    for (const e of ev) console.error(`${String(e.at - t0).padStart(6)}ms  ${e.type}${e.kind ? '/' + e.kind : ''}  ${String(e.text ?? e.message ?? e.summary ?? e.output ?? '').slice(0, 100).replace(/\n/g, '\\n')}`);
    console.error('handlerErrors: ' + JSON.stringify(state.handlerErrors));
  }
  await mock.stop();
  try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  return { ev, requests: mock.requests, failures: fails, after, thrown, io, state, durationMs, finalText };
}

// ===========================================================================
// SCENARIOS (a)–(h)
// ===========================================================================

async function s01_stream_drop_recover() {
  const r = await drive('a-drop-recover', {
    env: { continueBudget: 2, sseIdle: 4000, engineIdle: 5000 },
    dispatch: {
      onMain: async ({ res, n, io }) => {
        sseHeaders(res);
        if (n === 0) {
          res.write(sseChunk({ content: 'Partial answer that the provider will drop mid-sentence ' }));
          await sleep(20);
          try { res.socket?.destroy(); } catch { /* already gone */ }
          return;
        }
        res.write(sseChunk({ content: '— resumed on the SAME task. ' }));
        res.write(sseChunk({ content: 'Recovery complete. Written report follows.' }));
        finishSse(res, 'stop', { prompt_tokens: 40, completion_tokens: 20 });
      },
    },
  });
  const F = [...r.failures];
  // Layer-agnostic: accept the engine-level notice (engine.ts:5231) OR the
  // v11.26 provider-level notice (providers.ts:2235 `stream_recovered`). The
  // user must SEE that the stream was interrupted — whichever layer resumed it.
  const notice = r.ev.some((e) => e.type === 'sys_notice' &&
    /stream interrupted mid-answer|connection dropped mid-answer/i.test(e.text ?? ''));
  ck(F, notice, 'mid-answer drop is surfaced VISIBLY (no silent re-request)',
    r.ev.filter((e) => e.type === 'sys_notice').map((e) => e.text).join(' | ') || 'NO sys_notice at all',
    1, 'engine.ts:5231 (grep "stream interrupted mid-answer") + providers.ts:2235-2240 (grep "stream_recovered") — engine never wires onNotice into streamTurn');
  ck(F, r.state.mainCount >= 2, 'stream drop re-requests the SAME task', `main requests=${r.state.mainCount}`, 1, 'engine.ts:5088-5093');
  ck(F, r.finalText.includes('Recovery complete'), 'run recovers to a complete written answer', r.finalText.slice(0, 120), 1, 'engine.ts:5192');
  return { name: 'S1 (a) stream drops mid-answer then recovers', failures: F };
}

async function s02_garbage_sse() {
  const r = await drive('b-garbage-sse', {
    // The ABSENCE of an answer is the defect under test here; the dedicated
    // check below is the single owner of that finding (no duplicate fails).
    expectOutput: false,
    expectFinalText: false,
    dispatch: {
      onMain: async ({ res, n }) => {
        sseHeaders(res);
        // Non-SSE garbage + an unparseable data frame. No valid deltas, no
        // finish_reason, no [DONE]: a provider speaking gibberish.
        res.write('GARBAGE-NOT-SSE {\\"broken\\":true, \\"secret\\":\\"do-not-leak\\"}\n');
        res.write('data: {this is not json}\n\n');
        res.write('event: weird\n\n');
        res.end();
      },
    },
  });
  const F = [...r.failures];
  // The founder's "no silent stop": garbage must not be silently accepted as a
  // clean EMPTY answer. Either a real answer OR an honest error/partial report.
  const rep = r.ev.find((e) => e.type === 'task_report');
  const honestFailure = rep && (rep.outcome !== 'completed' || rep.partial === true);
  ck(F, honestFailure || r.finalText.trim().length > 0,
    'garbage SSE never becomes a silent clean "completed" with no answer',
    `outcome=${rep?.outcome}, partial=${rep?.partial}, answer=${JSON.stringify(r.finalText.slice(0, 80))}`,
    1, 'providers.ts:1883,1894-1917 (grep: "let stop: StopReason = \'end_turn\'" / "catch { return; }") + engine.ts:4092-4100 ("outcome: errorEventSent") + engine.ts:1922-1928 ("Nothing was changed on disk")');
  return { name: 'S2 (b) provider returns garbage SSE', failures: F };
}

async function s03_long_stream() {
  const N = 320;
  const parts = [];
  for (let i = 0; i < N; i++) parts.push(`[delta-${String(i).padStart(3, '0')}] `);
  const expected = parts.join('');
  const r = await drive('c-long-stream', {
    env: { sseIdle: 10_000, engineIdle: 15_000 },
    dispatch: {
      onMain: async ({ res, n }) => {
        sseHeaders(res);
        for (const p of parts) {
          res.write(sseChunk({ content: p }));
          await sleep(2); // scaled clock: periodic deltas over simulated hours
        }
        finishSse(res, 'stop', { prompt_tokens: N, completion_tokens: N });
      },
    },
  });
  const F = [...r.failures];
  const got = r.ev.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
  ck(F, got === expected, 'long periodic stream arrives byte-for-byte', `got ${got.length}/${expected.length} chars`, 2, 'engine.ts:1418 (DeltaBatcher)');
  const deltas = r.ev.filter((e) => e.type === 'text_delta');
  ck(F, deltas.length >= 2, 'long stream stayed incremental (not one buffered blob)', `delta events=${deltas.length}`, 2, 'engine.ts:325-389');
  if (deltas.length >= 2) {
    ck(F, deltas[deltas.length - 1].at - deltas[0].at >= 100, 'deltas spread across the scaled-clock duration', `span=${deltas[deltas.length - 1].at - deltas[0].at}ms`, 3, 'engine.ts:4927');
  }
  return { name: 'S3 (c) long stream with periodic deltas (scaled clocks)', failures: F };
}

async function s04_tool_throws() {
  let toolId = null;
  const dangerous = 'mkfs.ext4 /dev/sda';
  const r = await drive('d-tool-throws', {
    dispatch: {
      onMain: async ({ res, n }) => {
        sseHeaders(res);
        if (n === 0) {
          toolId = 'call_throw';
          for (const d of toolDeltas('run_command', JSON.stringify({ command: dangerous }), toolId)) res.write(sseChunk(d));
          finishSse(res, 'tool_calls', { prompt_tokens: 60, completion_tokens: 30 });
        } else {
          res.write(sseChunk({ content: 'The dangerous tool threw and was refused safely. Written report: no filesystem was touched.' }));
          finishSse(res, 'stop', { prompt_tokens: 40, completion_tokens: 20 });
        }
      },
    },
  });
  const F = [...r.failures];
  const bad = r.ev.find((e) => e.type === 'tool_result' && e.toolCallId === toolId);
  ck(F, !!bad && bad.ok === false, 'throwing tool reported as honest ok:false', JSON.stringify(bad && { ok: bad.ok, output: String(bad.output).slice(0, 200) }), 2, 'tools.ts:857-864/2409 → engine.ts:5245');
  ck(F, !!bad && /BLOCKED_DANGEROUS_COMMAND|refused by the SADEEM safety guard/i.test(String(bad.output)), 'throwing tool reports the REAL cause', String(bad?.output).slice(0, 200), 2, 'tools.ts:860');
  ck(F, !r.ev.some((e) => e.type === 'error'), 'tool exception never escalates to a global error row', r.ev.filter((e) => e.type === 'error').map((e) => e.message).join(' | '), 2, 'tools.ts:2408');
  ck(F, r.finalText.includes('Written report'), 'run continues to a written answer after a tool throw', r.finalText.slice(0, 120), 2, 'engine.ts:5225');
  return { name: 'S4 (d) tool throws', failures: F };
}

async function s05_abort_mid_thinking() {
  const r = await drive('e-abort-thinking', {
    // A user abort legitimately has no final answer — the WRITTEN task_report
    // IS the outcome. (Visible thinking activity is still asserted below.)
    expectFinalText: false,
    dispatch: {
      onMain: async ({ res, n, io }) => {
        sseHeaders(res);
        for (let i = 0; i < 8; i++) {
          res.write(sseChunk({ reasoning_content: `thinking step ${i} ... reasoning deeply about the plan ... ` }));
          await sleep(25);
          if (i === 2) io.triggerAbort(); // REAL user abort mid-thinking
        }
        try { res.end(); } catch { /* ignore */ }
      },
    },
  });
  const F = [...r.failures];
  ck(F, r.ev.some((e) => e.type === 'think_delta'), 'thinking stream was active when aborted', `think deltas=${r.ev.filter((e)=>e.type==='think_delta').length}`, 2, 'engine.ts:5015');
  ck(F, r.ev.some((e) => e.type === 'aborted'), 'user abort emits an aborted event', 'no aborted event', 1, 'engine.ts:4162');
  ck(F, !r.ev.some((e) => e.type === 'error'), 'abort is NOT surfaced as an error row', r.ev.filter((e) => e.type === 'error').map((e) => e.message).join(' | '), 2, 'engine.ts:4161-4168');
  return { name: 'S5 (e) user abort mid-thinking', failures: F };
}

async function s06_post_processing_throws() {
  const r = await drive('f-postproc-throws', {
    io: { throwOnceOn: 'message_end' },
    dispatch: {
      onMain: async ({ res, n }) => {
        sseHeaders(res);
        if (n === 0) {
          for (const d of toolDeltas('write_file', JSON.stringify({ path: 'v1126-postproc.txt', content: 'written-before-postproc-throw\n' }), 'call_pp')) res.write(sseChunk(d));
          finishSse(res, 'tool_calls', { prompt_tokens: 60, completion_tokens: 30 });
        } else {
          res.write(sseChunk({ content: 'Work was written; the final answer is here.' }));
          finishSse(res, 'stop', { prompt_tokens: 40, completion_tokens: 20 });
        }
      },
    },
  });
  const F = [...r.failures];
  ck(F, r.io.__thrownOnce === true, 'post-processing fault was actually injected', 'io never threw on message_end', 2, 'harness');
  const rep = r.ev.find((e) => e.type === 'task_report');
  ck(F, !!rep, 'throw in post-processing still emits task_report', 'no report', 1, 'engine.ts:4177-4205');
  ck(F, r.ev.some((e) => e.type === 'turn_end'), 'throw in post-processing still emits turn_end', 'no turn_end', 1, 'engine.ts:4205');
  ck(F, r.after.running === false, 'throw in post-processing still clears running', `running=${r.after.running}`, 1, 'src/store.ts:2994');
  return { name: 'S6 (f) post-processing throws', failures: F };
}

async function s07_402() {
  const r = await drive('g-402', {
    // A fatal 402 legitimately ends in an honest error report, not an answer.
    expectFinalText: false,
    dispatch: {
      onMain: async ({ res, n }) => {
        if (n === 0) {
          sseHeaders(res);
          res.write(sseChunk({ content: 'Starting the requested work. ' }));
          for (const d of toolDeltas('write_file', JSON.stringify({ path: 'v1126-402.txt', content: 'mid-run\n' }), 'call_402')) res.write(sseChunk(d));
          finishSse(res, 'tool_calls', { prompt_tokens: 80, completion_tokens: 30 });
          return;
        }
        httpError(res, 402, { error: { message: 'Insufficient credits (402)', code: 402 } });
      },
    },
  });
  const F = [...r.failures];
  const errs = r.ev.filter((e) => e.type === 'error').map((e) => e.message);
  ck(F, errs.some((m) => /402|credit|balance|رصيد/i.test(m)), '402 error names credits/402', JSON.stringify(errs), 2, 'providers.ts:515 / engine.ts:5986');
  const rep = r.ev.find((e) => e.type === 'task_report');
  ck(F, !!rep && rep.outcome === 'error', '402 task_report outcome=error', rep?.outcome, 2, 'engine.ts:4043/4175');
  ck(F, r.state.mainCount <= 2, 'fatal 402 is NOT silently retried', `main requests=${r.state.mainCount} (expected ≤2)`, 2, 'engine.ts:5099/5117 (isFatalProviderError break)');
  return { name: 'S7 (g) provider returns 402', failures: F };
}

async function s08_429_then_success() {
  const r = await drive('h-429', {
    dispatch: {
      onMain: async ({ res, n }) => {
        if (n === 0) {
          httpError(res, 429, { error: 'rate limit' }, { 'retry-after': '0' });
          return;
        }
        sseHeaders(res);
        res.write(sseChunk({ content: 'Recovered after a rate limit. ' }));
        res.write(sseChunk({ content: 'Written report: task completed.' }));
        finishSse(res, 'stop', { prompt_tokens: 30, completion_tokens: 12 });
      },
    },
  });
  const F = [...r.failures];
  const rep = r.ev.find((e) => e.type === 'task_report');
  ck(F, !!rep && rep.outcome === 'completed', '429-then-success completes honestly', rep?.outcome, 2, 'engine.ts:4043');
  ck(F, !r.ev.some((e) => e.type === 'error'), 'bounded 429 recovery shows no error row', r.ev.filter((e) => e.type === 'error').map((e) => e.message).join(' | '), 2, 'providers.ts:838-853');
  ck(F, r.state.mainCount <= 2, '429 = at most one same-provider retry', `main requests=${r.state.mainCount}`, 3, 'providers.ts:838-853');
  return { name: 'S8 (h) 429 then success', failures: F };
}

// ---------------------------------------------------------------------------
// HOURS-LONG SIMULATION — hundreds of tool rounds, scaled clocks. The default
// 120-step budget must auto-continue; only the USER's abort ends the run.
// ---------------------------------------------------------------------------
async function s09_hours_long() {
  const ROUNDS = 240; // "hundreds" — deliberately ABOVE the default 120 budget
  const ABORT_AT = ROUNDS; // end only when the user stops it
  const r = await drive('hours-long', {
    // The run ends by USER abort, so there is no final answer by design —
    // the WRITTEN task_report is the outcome (asserted below).
    expectFinalText: false,
    maxOverheadMs: 10_000,
    maxDurationMs: 180_000,
    maxSilentGapMs: 20_000,
    // Default maxTurns=120; continueAuto must carry the run past it.
    settings: { agent: { continueAuto: true, maxContinueRounds: 4 } },
    env: { sseIdle: 20_000, engineIdle: 30_000 },
    dispatch: {
      onMain: async ({ res, n, io }) => {
        if (n >= ABORT_AT) {
          // USER STOP — the ONLY thing allowed to end this run.
          io.triggerAbort();
          try { res.destroy(); } catch { /* gone */ }
          return;
        }
        sseHeaders(res);
        for (const d of toolDeltas('write_file', JSON.stringify({ path: 'continuity-probe.txt', content: `tick-${n}\n` }), 'call_long_' + n)) res.write(sseChunk(d));
        finishSse(res, 'tool_calls', { prompt_tokens: 30, completion_tokens: 10 });
      },
    },
  });
  const F = [...r.failures];
  const starts = r.ev.filter((e) => e.type === 'tool_start');
  const results = r.ev.filter((e) => e.type === 'tool_result');
  ck(F, starts.length >= 200, 'hundreds of tool rounds executed', `tool_start=${starts.length}, expected ≥200`, 1, 'engine.ts:2830-2908 (auto-continue loop)');
  ck(F, starts.length > 120, 'run continued PAST the default 120-step budget (no artificial cap)', `tool_start=${starts.length}`, 1, 'engine.ts:125/2835-2847/2882-2908');
  ck(F, results.length === starts.length, 'every long-run tool call reported', `starts=${starts.length}, results=${results.length}`, 1, 'engine.ts:5245');
  ck(F, results.every((x) => x.ok === true), 'all long-run tools succeeded', JSON.stringify(results.filter((x) => !x.ok).slice(0, 5)), 2, 'engine.ts:5245');
  const continued = r.ev.some((e) => e.type === 'sys_notice' && /auto-continue/i.test(e.text ?? ''));
  ck(F, continued, 'step-budget exhaustion produced a visible auto-continue marker', r.ev.filter((e) => e.type === 'sys_notice').map((e) => e.text).filter((t) => /continue/i.test(t ?? '')).slice(0, 3).join(' | '), 2, 'engine.ts:2895');
  const rep = r.ev.find((e) => e.type === 'task_report');
  ck(F, !!rep && rep.outcome === 'aborted', 'only the USER abort ended the run', rep?.outcome, 1, 'engine.ts:4161-4168');
  ck(F, !rep || (rep.stopReason !== 'time_cap' && rep.stopReason !== 'max_tokens' && rep.maxedOut !== true), 'no wall-clock/step cap ended the long run', JSON.stringify(rep && { stopReason: rep.stopReason, maxedOut: rep.maxedOut }), 1, 'engine.ts:4029/4538/5851');
  return { name: 'S9 HOURS-LONG — hundreds of rounds until USER stops', failures: F };
}

// ---------------------------------------------------------------------------
// Single parent test runs every scenario, prints ALL failures, ranked.
// ---------------------------------------------------------------------------
test('V1126 AI CONTINUITY — (a)-(h) + hours-long simulation through the REAL engine + store', { timeout: 900_000 }, async (t) => {
  const scenarios = [
    s01_stream_drop_recover,
    s02_garbage_sse,
    s03_long_stream,
    s04_tool_throws,
    s05_abort_mid_thinking,
    s06_post_processing_throws,
    s07_402,
    s08_429_then_success,
    s09_hours_long,
  ];
  const results = [];
  for (const fn of scenarios) {
    let res;
    try {
      res = await fn();
    } catch (err) {
      res = { name: fn.name, failures: [{ check: 'scenario harness threw', detail: err?.stack ?? String(err), impact: 1, source: 'harness', scenario: fn.name }] };
    }
    results.push(res);
  }

  for (const res of results) {
    for (const f of res.failures) ALL.push({ ...f, scenario: f.scenario ?? res.name });
  }
  console.error('\n===== V1126 AI CONTINUITY — SCENARIO SUMMARY =====');
  for (const res of results) {
    console.error(`[V1126] ${res.name}: ${res.failures.length ? 'FAIL' : 'PASS'} (${res.failures.length} failure${res.failures.length === 1 ? '' : 's'})`);
    for (const f of res.failures) console.error(`[V1126 FAIL] ${res.name} :: [I${f.impact}] ${f.check} :: ${f.detail} :: @${f.source}`);
  }
  ALL.sort((a, b) => a.impact - b.impact);
  console.error('\n===== V1126 RANKED FAILURE REPORT (by user impact) =====');
  if (!ALL.length) console.error('NONE — the AI did not disconnect across any nasty case or the hours-long run.');
  for (const f of ALL) console.error(`I${f.impact}  ${f.scenario} :: ${f.check} :: ${f.detail} :: @${f.source}`);
  console.error(`\nTOTAL FAILURES: ${ALL.length}  (scenarios: ${results.filter((r) => r.failures.length).length}/${results.length} failing)`);

  assert.equal(
    ALL.length, 0,
    `V1126 AI CONTINUITY found ${ALL.length} failure(s) across ${results.filter((r) => r.failures.length).length} scenarios — see [V1126 FAIL] lines above`,
  );
});

after(() => {
  for (const k of [
    'SURNIA_SSE_IDLE_MS', 'SURNIA_ENGINE_IDLE_MS', 'SURNIA_TURN_RETRY_DELAYS_MS',
    'SURNIA_DELTA_FLUSH_MS', 'SURNIA_HOME', 'SURNIA_SKIP_UI_GATE',
    'SURNIA_STREAM_CONTINUE_BUDGET', 'SURNIA_MAX_TOKENS_CONTINUES',
    'SURNIA_SUBAGENT_TIMEOUT_MS', 'SURNIA_MAX_RUN_MS',
  ]) delete process.env[k];
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});
