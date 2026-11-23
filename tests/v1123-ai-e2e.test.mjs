import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================================
// v11.23 — AI END-TO-END INTEGRATION HARNESS (the founder's complaint:
// "الذكاء الاصطناعي لا يعمل... كل شوي بيطلع لي خطأ").
//
// This harness drives the REAL electron/agent/engine.ts runAgent() (esbuild
// bundled, electron stubbed) against a LOCAL scripted OpenAI-compatible
// provider (node:http — zero network, zero model). NO application source is
// edited by this agent. Every engine event is recorded, replayed into the REAL
// src/store.ts ingestAgentEvent, and checked against the founder's contract.
//
// 11 nasty cases a user actually hits:
//   1  first turn succeeds, second turn with cross-session/model history
//   2  402 mid-run (no credits)
//   3  429 then success (same-provider bounded retry)
//   4  provider returns malformed JSON (stream error object)
//   5  tool call with bad arguments (invalid JSON args)
//   6  tool call fails, then succeeds
//   7  user abort mid-stream
//   8  very long token stream (punctuation / Unicode / Arabic)
//   9  compaction triggered mid-run
//  10  subagent failure
//  11  slow provider — NO automatic provider switch
//
// PER-CASE CONTRACT (checked for every scenario):
//   A exactly ONE task_report + ONE turn_end, report before turn_end
//   B error messages are single-language + actionable (no raw JSON, no mixed
//     EN/AR, they name the setting/next step)
//   C no duplicate / double error rows in the transcript
//   D `running` clears (real store)
//   E proof state honest (no fabricated gates without evidence events)
//   F no raw JSON anywhere user-visible
//   G no silent re-request (bounded, visible provider attempts)
//
// Run:   node --test --test-force-exit tests/v1123-ai-e2e.test.mjs
// Debug: V1123_DEBUG=1 node --test --test-force-exit tests/v1123-ai-e2e.test.mjs
//
// NOTE ON VERDICT: this harness does NOT hide failures. Every failed check is
// printed with [V1123 FAIL] and an @source:line hint for the owning agents,
// then ranked by user impact at the end. A green run means "AI works today";
// any red line is a real, reproducible defect.
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
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1123-ai-e2e-'));
const DEBUG = !!process.env.V1123_DEBUG;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  console.error('[V1123] ENGINE BUNDLE FAILED — no agent turn can start:', err?.message ?? err);
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
  console.error('[V1123] STORE BUNDLE FAILED:', err?.message ?? err);
  throw err;
}

// ---------------------------------------------------------------------------
// SSE + HTTP helpers.
// ---------------------------------------------------------------------------
const MAIN = 'v1123-live';
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
function httpError(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// Controllable mock provider. Routes main-turn / compaction / extraction /
// subagent / secondary requests. Records every request for assertions.
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
      const sys = JSON.stringify(body); // system prompt may live in body.system OR in messages[0]
      const msgs = body.messages ?? [];
      const rec = {
        model: body.model,
        at: Date.now(),
        sawTool: msgs.some((m) => m.role === 'tool'),
        lastRole: msgs.length ? msgs[msgs.length - 1].role : null,
        isCompact: /compact coding-agent transcripts/i.test(sys),
        isSubagent: /part of the Surnia agent team/i.test(sys),
        isExtraction: /extract durable engineering facts|Surnia DNA user model|maintain the Surnia DNA/i.test(sys),
        prompt: msgs.filter((m) => m.role === 'user').map((m) => String(m.text ?? m.content ?? '')).join(' ').slice(0, 120),
      };
      requests.push(rec);
      try {
        if (rec.isCompact) {
          sseHeaders(res);
          res.write(sseChunk({ content: 'COMPACT SUMMARY (v1123): work captured.\n' }));
          finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 });
          return;
        }
        if (rec.isExtraction) { sseHeaders(res); finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 }); return; }
        if (rec.isSubagent && dispatch.onSubagent) { await dispatch.onSubagent({ res, req, body, rec, io: dispatch._io }); return; }
        if (body.model !== MAIN || rec.isSubagent) { sseHeaders(res); finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 }); return; }
        const n = state.mainCount++;
        await dispatch.onMain({ res, req, body, rec, n, io: dispatch._io });
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

// ---------------------------------------------------------------------------
// Renderer-style IO recorder (with abort control).
// ---------------------------------------------------------------------------
function makeIo() {
  const events = [];
  let abortCb = null;
  const io = {
    events,
    send(e) { events.push({ ...e, raw: e, at: Date.now() }); },
    getDecision() { return Promise.resolve({ requestId: 'v1123', action: 'allow' }); },
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
      zai: { apiKey: 'test-key', baseUrl: base }, // 2 configured, but failover OPT-IN is off
    },
    agent,
    doneNotifications: false,
    ...rest,
  }));
}
function setEngineEnv(o = {}) {
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = o.retryDelays ?? '5,5,5';
  process.env.SURNIA_DELTA_FLUSH_MS = '5';
  process.env.SURNIA_HOME = userDataDir;
  process.env.SURNIA_SKIP_UI_GATE = '1';
  process.env.SURNIA_STREAM_CONTINUE_BUDGET = String(o.continueBudget ?? 0);
  process.env.SURNIA_MAX_TOKENS_CONTINUES = String(o.maxTokenContinues ?? 25);
  process.env.SURNIA_SSE_IDLE_MS = String(o.sseIdle ?? 20_000);
  process.env.SURNIA_ENGINE_IDLE_MS = String(o.engineIdle ?? 30_000);
  if (o.subagentTimeout) process.env.SURNIA_SUBAGENT_TIMEOUT_MS = String(o.subagentTimeout);
  else delete process.env.SURNIA_SUBAGENT_TIMEOUT_MS;
}
function seedStore() {
  store.setState({
    wsPath: ROOT,
    session: { id: 'v1123', title: 't', workspace: ROOT, messages: [], createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0, totalTokens: 0, totalCostUsd: 0 },
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
    sessionId: 'v1123-' + name + '-' + Math.random().toString(36).slice(2),
    messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Do the task, then report what you did.', timestamp: Date.now() }],
    model: { provider: 'custom', model: MAIN, maxTokens: 2048 },
    mode: 'fullAccess',
    workspace: ws,
    apiKey: 'test-key',
    baseUrl: base,
  };
}

// ---------------------------------------------------------------------------
// Failure accumulator + assertion helpers (ALL checks run; nothing is hidden).
// ---------------------------------------------------------------------------
const ALL = [];
function ck(list, cond, check, detail, impact, source) {
  if (!cond) list.push({ check, detail: String(detail), impact, source });
}
const ARABIC = (s) => [...String(s ?? '')].some((ch) => /\p{Script=Arabic}/u.test(ch) && /\p{Alphabetic}/u.test(ch));
const RAW_JSON = (s) => /\{\s*"[A-Za-z_][A-Za-z0-9_]*"\s*:/.test(String(s ?? '')) || /\[\s*\{\s*"/.test(String(s ?? ''));
const ACTIONABLE = (s) => /(settings|retry|try|check|add|switch|open|send|choose|paste|rephrase|follow-?up|verify|balance|key|provider|stream|continue)/i.test(String(s ?? ''));

/**
 * Drive one runAgent() call and run EVERY common contract check.
 * Returns {events, requests, failures, after, thrown, state, durationMs}.
 */
async function drive(name, cfg) {
  const state = { mainCount: 0 };
  const mock = startMock(cfg.dispatch, state);
  const port = await mock.port;
  const mockBase = `http://127.0.0.1:${port}/v1`;
  writeSettings(mockBase, cfg.settings ?? {});
  setEngineEnv(cfg.env ?? {});
  const io = makeIo();
  cfg.dispatch._io = io;
  const ws = mkdtempSync(join(tmp, 'v1123-ws-' + name.replace(/[^a-z0-9]/gi, '') + '-'));
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
    try { store.getState().ingestAgentEvent(e.raw); } catch { /* ingest is best-effort */ }
  }
  const after = store.getState();

  const ev = io.events;
  const fails = [];
  // A — exactly one terminal report + turn_end, in order.
  const reports = ev.filter((e) => e.type === 'task_report');
  const turnEnds = ev.filter((e) => e.type === 'turn_end');
  ck(fails, thrown === null, 'runAgent does not throw', thrown?.stack ?? thrown, 1, 'engine.ts:3998');
  ck(fails, reports.length === 1, 'exactly one task_report', `got ${reports.length}`, 1, 'engine.ts:1767/4034');
  ck(fails, turnEnds.length === 1, 'exactly one turn_end', `got ${turnEnds.length}`, 1, 'engine.ts:1909/4045');
  if (reports.length && turnEnds.length) {
    ck(fails, ev.indexOf(turnEnds[0]) > ev.indexOf(reports[0]), 'task_report precedes turn_end', 'terminal order wrong', 1, 'engine.ts:4045');
  }
  // D — running clears.
  ck(fails, after.running === false, 'running clears', `running=${after.running}`, 1, 'src/store.ts:4166');
  // B — single-language + actionable errors, no raw JSON.
  const errEvents = ev.filter((e) => e.type === 'error');
  const terminalReport0 = ev.find((e) => e.type === 'task_report');
  if (terminalReport0?.outcome === 'completed') {
    ck(fails, errEvents.length === 0, 'successful run shows no error row/event', errEvents.map((e) => e.message).join(' | '), 3, 'engine.ts:1830');
  }
  for (const er of errEvents) {
    ck(fails, !ARABIC(er.message), 'error single-language (en run)', er.message, 2, 'engine.ts:4020');
    ck(fails, ACTIONABLE(er.message), 'error actionable (names next step)', er.message, 2, 'engine.ts:5986');
  }
  // C — no duplicate / double error rows in the transcript.
  const errRows = (after.session?.messages ?? []).filter((m) => m.model === 'error');
  ck(fails, errRows.length <= 1, 'at most one error row', `got ${errRows.length}`, 3, 'src/store.ts:4103');
  ck(fails, errEvents.length <= 1, 'at most one error event', `got ${errEvents.length}`, 3, 'engine.ts:4020');
  // F — no raw JSON anywhere user-visible.
  const userTexts = [
    ...ev.filter((e) => e.type === 'text_delta').map((e) => e.text),
    ...errEvents.map((e) => e.message),
    ...reports.map((e) => e.summary),
    ...reports.flatMap((e) => e.nextSteps ?? []),
    ...errRows.map((m) => m.content),
  ];
  const jsonLeaks = userTexts.filter((t) => RAW_JSON(t));
  ck(fails, jsonLeaks.length === 0, 'no raw JSON user-visible', jsonLeaks.map((s) => String(s).slice(0, 120)).join(' | '), 2, 'providers.ts:532 / engine.ts:5986');
  // E — proof state honest (no gates without evidence).
  const gateEvidence = ev.some((e) => ['run_receipt', 'mutation_gate', 'verify_run', 'red_green'].includes(e.type));
  if (!gateEvidence) {
    ck(fails, after.proofVisible !== true, 'proof not fabricated without evidence', `proofVisible=${after.proofVisible}`, 3, 'src/store.ts:1650');
    ck(fails, (after.proof?.gates ?? []).length === 0, 'no fabricated proof gates', JSON.stringify(after.proof?.gates), 3, 'src/store.ts:1650');
  }
  // G — no silent re-request. The founder's exact anti-pattern is a mid-answer
  // stream drop being silently re-requested ("a minute of nothing, then it
  // starts"). That path is gated by SURNIA_STREAM_CONTINUE_BUDGET=0 (set above)
  // and MUST emit a visible notice if it ever fires. Check that first.
  const silentContinue = ev.some((e) => e.type === 'sys_notice' && /stream interrupted mid-answer|auto-continuing the same task/i.test(e.text ?? ''));
  ck(fails, !silentContinue, 'no silent mid-answer re-request', 'stream-drop auto-continue notice fired', 1, 'engine.ts:4971/4976');
  // Secondary: bound the number of fresh (user-initiated) main-turn requests.
  // Scenarios with expected retries (429, hard failure) tune expectedFresh.
  const freshReqs = mock.requests.filter((r) => r.model === MAIN && !r.isExtraction && !r.isSubagent && !r.isCompact && r.lastRole === 'user');
  ck(fails, freshReqs.length <= (cfg.expectedFresh ?? 1), 'no silent re-request (fresh user turns)', `fresh=${freshReqs.length}, expected<=${cfg.expectedFresh ?? 1}`, 4, 'engine.ts:4971');

  if (DEBUG) {
    console.error('fresh main requests: ' + JSON.stringify(freshReqs.map((r) => ({ last: r.lastRole, prompt: r.prompt }))));
    console.error(`\n===== ${name} TIMELINE =====`);
    for (const e of ev) console.error(`${String(e.at - t0).padStart(6)}ms  ${e.type}${e.kind ? '/' + e.kind : ''}  ${String(e.text ?? e.message ?? e.summary ?? '').slice(0, 90).replace(/\n/g, '\\n')}`);
    console.error('requests: ' + JSON.stringify(mock.requests.map((r) => ({ m: r.model, last: r.lastRole, tool: r.sawTool, sub: r.isSubagent }))));
  }
  await mock.stop();
  try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  return { ev, requests: mock.requests, failures: fails, after, thrown, state, durationMs };
}

// ===========================================================================
// SCENARIOS
// ===========================================================================

async function s01_crossSession() {
  const F = [];
  // Turn 1: clean success.
  const r1 = await drive('S1-turn1', {
    dispatch: {
      onMain: async ({ res, n }) => {
        sseHeaders(res);
        for (const t of ['First ', 'turn ', 'OK.']) res.write(sseChunk({ content: t }));
        finishSse(res, 'stop', { prompt_tokens: 20, completion_tokens: 10 });
      },
    },
  });
  F.push(...r1.failures.map((f) => ({ ...f, scenario: 'S1a first turn' })));
  // Turn 2: history from a DIFFERENT session/model embedded in messages.
  const crossMessages = [
    { id: 'h1', role: 'user', kind: 'text', content: 'Earlier question from another session', timestamp: Date.now() - 9000 },
    { id: 'h2', role: 'assistant', kind: 'text', content: 'Answer produced by some-other-model in session OTHER-SESSION', model: 'some-other-model', timestamp: Date.now() - 8000 },
    { id: 'm1', role: 'user', kind: 'text', content: 'Second turn — use the current model, ignore stale history.', timestamp: Date.now() },
  ];
  const r2 = await drive('S1-turn2', {
    params: { messages: crossMessages },
    dispatch: {
      onMain: async ({ res, rec, n }) => {
        ck(F, rec.model === MAIN, 'second turn uses current model', `model=${rec.model}`, 2, 'engine.ts:1512');
        sseHeaders(res);
        for (const t of ['Second ', 'turn ', 'OK.']) res.write(sseChunk({ content: t }));
        finishSse(res, 'stop', { prompt_tokens: 20, completion_tokens: 10 });
      },
    },
  });
  F.push(...r2.failures.map((f) => ({ ...f, scenario: 'S1b cross-session history' })));
  const ok1 = r1.ev.some((e) => e.type === 'task_report') && r1.ev.some((e) => e.type === 'turn_end');
  const ok2 = r2.ev.some((e) => e.type === 'task_report') && r2.ev.some((e) => e.type === 'turn_end');
  ck(F, ok1 && ok2, 'both turns complete cleanly', `t1=${ok1} t2=${ok2}`, 1, 'engine.ts:1767');
  return { name: 'S1 first turn + cross-session/model second turn', failures: F };
}

async function s02_402() {
  const r = await drive('S2-402', {
    dispatch: {
      onMain: async ({ res, n }) => {
        if (n === 0) {
          sseHeaders(res);
          res.write(sseChunk({ content: 'Writing the proof file mid-run.\n' }));
          const args = JSON.stringify({ path: 'v1123-402.txt', content: 'mid-run\n' });
          for (const d of toolDeltas('write_file', args, 'call_402')) res.write(sseChunk(d));
          finishSse(res, 'tool_calls', { prompt_tokens: 80, completion_tokens: 30 });
          return;
        }
        // Raw JSON gateway 402 body — must be sanitized, never shown raw.
        httpError(res, 402, { error: { message: 'Insufficient credits (402)', code: 402 } });
      },
    },
  });
  const F = [...r.failures];
  const errs = r.ev.filter((e) => e.type === 'error').map((e) => e.message);
  ck(F, errs.some((m) => /402|credit|balance|récharge|رصيد/i.test(m)), '402 error names credits/402', JSON.stringify(errs), 2, 'providers.ts:579 / engine.ts:5986');
  const errRows = (r.after.session?.messages ?? []).filter((m) => m.model === 'error');
  ck(F, errRows.length === 0, '402 uses ONE toast, no raw English JSON error row', `rows=${errRows.length}`, 3, 'src/store.ts:4102');
  const report = r.ev.find((e) => e.type === 'task_report');
  ck(F, !!report && report.outcome === 'error', '402 task_report outcome=error', report?.outcome, 2, 'engine.ts:4021');
  ck(F, r.state.mainCount === 2, '402 is FATAL — no silent retry of a dead account', `main requests=${r.state.mainCount} (expected 2)`, 4, 'engine.ts:5033 (was 5025; grep "isInvalidKeyError(lastErr)") + providers.ts:515 (only invalid_key, not no_credits)');
  return { name: 'S2 402 mid-run (no credits)', failures: F };
}

async function s03_429_then_success() {
  const r = await drive('S3-429', {
    expectedFresh: 2, // one bounded same-provider retry of the 429
    dispatch: {
      onMain: async ({ res, n }) => {
        if (n === 0) {
          httpError(res, 429, { error: 'rate limit' }, { 'retry-after': '1' });
          return;
        }
        sseHeaders(res);
        for (const t of ['Recovered ', 'after 429. ', 'Done.']) res.write(sseChunk({ content: t }));
        finishSse(res, 'stop', { prompt_tokens: 30, completion_tokens: 12 });
      },
    },
  });
  const F = [...r.failures];
  const report = r.ev.find((e) => e.type === 'task_report');
  ck(F, !!report && report.outcome === 'completed', '429-then-success completes', report?.outcome, 2, 'engine.ts:1830');
  const errs = r.ev.filter((e) => e.type === 'error');
  ck(F, errs.length === 0, '429 recovery shows no error row/event', errs.map((e) => e.message).join(' | '), 2, 'providers.ts:597');
  const failoverNotices = r.ev.filter((e) => e.type === 'sys_notice' && /failover|switching/i.test(e.text ?? ''));
  ck(F, failoverNotices.length === 0, '429 retry is same-provider, no failover spam', failoverNotices.map((e) => e.text).join(' | '), 4, 'providers.ts:2136');
  ck(F, r.state.mainCount === 2, '429 = one bounded same-provider retry', `main requests=${r.state.mainCount}`, 4, 'providers.ts:2146');
  return { name: 'S3 429 then success', failures: F };
}

async function s04_malformed_json() {
  const RAW = '{"error":{"message":"{\\"code\\":402,\\"msg\\":\\"raw \\u0645\\u062a\\u0631\\u062c\\u0645\\"}","code":402}}';
  const r = await drive('S4-malformed', {
    expectedFresh: 4, // the documented bounded pre-first-token retry schedule
    dispatch: {
      onMain: async ({ res, n }) => {
        // A stream-level error object whose message embeds mixed-language raw
        // JSON — the exact shape that used to leak into the chat as a row.
        sseHeaders(res);
        res.write(`data: ${RAW}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      },
    },
  });
  const F = [...r.failures];
  const visible = [
    ...r.ev.filter((e) => e.type === 'text_delta').map((e) => e.text),
    ...r.ev.filter((e) => e.type === 'error').map((e) => e.message),
  ].join(' ');
  ck(F, !visible.includes('\\"code\\"') && !RAW_JSON(visible), 'malformed/raw JSON never reaches the user', visible.slice(0, 160), 2, 'providers.ts:1910 / 532');
  ck(F, !ARABIC(visible), 'no mixed Arabic fragment in EN error', visible.slice(0, 160), 2, 'providers.ts:547 (ASCII clamp)');
  return { name: 'S4 provider malformed JSON', failures: F };
}

async function s05_bad_tool_args() {
  const wsProbe = 'MUST-NOT-EXIST-v1123.txt';
  const r = await drive('S5-bad-args', {
    dispatch: {
      onMain: async ({ res, n }) => {
        sseHeaders(res);
        if (n === 0) {
          const args = '{bad json'; // invalid JSON arguments
          for (const d of toolDeltas('write_file', args, 'call_bad')) res.write(sseChunk(d));
          finishSse(res, 'tool_calls', { prompt_tokens: 60, completion_tokens: 30 });
        } else {
          for (const t of ['Recovered from bad tool args. ', 'Done.']) res.write(sseChunk({ content: t }));
          finishSse(res, 'stop', { prompt_tokens: 30, completion_tokens: 12 });
        }
      },
    },
  });
  const F = [...r.failures];
  const badResult = r.ev.find((e) => e.type === 'tool_result' && /invalid JSON/i.test(e.output ?? ''));
  ck(F, !!badResult && badResult.ok === false, 'bad args → honest corrective tool_result (ok:false)', JSON.stringify(badResult && { ok: badResult.ok, output: badResult.output }), 3, 'engine.ts:5253 / 1181');
  ck(F, r.ev.some((e) => e.type === 'text_delta' && /Recovered/.test(e.text)), 'run continues after bad tool args', 'no final answer', 2, 'engine.ts:5225');
  ck(F, !r.ev.some((e) => e.type === 'error'), 'bad args do not raise a global error event', r.ev.filter((e) => e.type === 'error').map((e) => e.message).join(' | '), 3, 'engine.ts:5255');
  return { name: 'S5 tool call with bad arguments', failures: F };
}

async function s06_tool_fail_then_success() {
  const r = await drive('S6-tool-fail-ok', {
    dispatch: {
      onMain: async ({ res, n }) => {
        sseHeaders(res);
        if (n === 0) {
          const args = JSON.stringify({ command: '__v1123_no_such_command__' });
          for (const d of toolDeltas('run_command', args, 'call_fail')) res.write(sseChunk(d));
          finishSse(res, 'tool_calls', { prompt_tokens: 60, completion_tokens: 30 });
        } else if (n === 1) {
          for (const d of toolDeltas('write_file', JSON.stringify({ path: 'v1123-tool-ok.txt', content: 'OK\n' }), 'call_ok')) res.write(sseChunk(d));
          finishSse(res, 'tool_calls', { prompt_tokens: 90, completion_tokens: 30 });
        } else {
          for (const t of ['Failed then succeeded. ', 'Done.']) res.write(sseChunk({ content: t }));
          finishSse(res, 'stop', { prompt_tokens: 30, completion_tokens: 12 });
        }
      },
    },
  });
  const F = [...r.failures];
  const results = r.ev.filter((e) => e.type === 'tool_result');
  ck(F, results.length >= 2, 'both tool outcomes reported', `results=${results.length}`, 3, 'engine.ts:5245');
  ck(F, results.some((x) => x.ok === false), 'failed tool is honestly ok:false', JSON.stringify(results.map((x) => x.ok)), 3, 'engine.ts:5245');
  ck(F, results.some((x) => x.ok === true), 'succeeded tool is honestly ok:true', JSON.stringify(results.map((x) => x.ok)), 3, 'engine.ts:5245');
  ck(F, r.ev.some((e) => e.type === 'text_delta' && /Failed then succeeded/.test(e.text)), 'run completes after tool failure', 'no final answer', 2, 'engine.ts:5225');
  return { name: 'S6 tool call fails then succeeds', failures: F };
}

async function s07_abort() {
  const r = await drive('S7-abort', {
    dispatch: {
      onMain: async ({ res, n, io }) => {
        sseHeaders(res);
        res.write(sseChunk({ content: 'Starting a long answer that will be aborted. ' }));
        await sleep(30);
        // Trigger a REAL user abort through the IO fetch signal.
        io?.triggerAbort();
        await sleep(200);
        try { res.end(); } catch { /* ignore */ }
      },
    },
  });
  const F = [...r.failures];
  const report = r.ev.find((e) => e.type === 'task_report');
  ck(F, r.ev.some((e) => e.type === 'aborted'), 'abort emits an aborted event', 'no aborted event', 1, 'engine.ts:4015');
  ck(F, !!report && report.outcome === 'aborted', 'abort task_report outcome=aborted', report?.outcome, 1, 'engine.ts:4016');
  ck(F, !r.ev.some((e) => e.type === 'error'), 'abort is not surfaced as an error', r.ev.filter((e) => e.type === 'error').map((e) => e.message).join(' | '), 2, 'engine.ts:4014');
  return { name: 'S7 user abort mid-stream', failures: F };
}

async function s08_long_unicode() {
  const parts = [
    'مرحبا بالعالم! ', '✅🚀 ', 'Punctuation: !?.,;:()[]{}<>/\\|@#$%^&*+-=~`"\' ',
    'Unicode: café naïve résumé 中文 日本語 한국어 Ελληνικά Русский ',
    'Numbers: 0123456789 ', 'Emoji: 😀🎯🔥💡🧠 ', 'Arabic again: الذكاء الاصطناعي يعمل الآن. ',
    'Mixed 123-ab INLINE. ', 'End. ✅',
  ];
  // Repeat to make a genuinely long stream, but keep the joined text exact.
  const stream = [...parts, ...parts.map((p) => p.toUpperCase()), ...parts];
  const expected = stream.join('');
  const r = await drive('S8-long-unicode', {
    dispatch: {
      onMain: async ({ res, n }) => {
        sseHeaders(res);
        for (const t of stream) res.write(sseChunk({ content: t }));
        finishSse(res, 'stop', { prompt_tokens: 400, completion_tokens: 300 });
      },
    },
  });
  const F = [...r.failures];
  const got = r.ev.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
  ck(F, got === expected, 'long Unicode/Arabic stream arrives byte-for-byte', `got ${got.length} chars, expected ${expected.length}`, 2, 'engine.ts:1418 (delta batcher)');
  ck(F, got.includes('الذكاء الاصطناعي') && got.includes('✅'), 'Arabic + emoji preserved', got.slice(-120), 2, 'engine.ts:1418');
  return { name: 'S8 very long token stream (punctuation/Unicode/Arabic)', failures: F };
}

async function s09_compaction() {
  const r = await drive('S9-compaction', {
    settings: { agent: { autoCompact: true, compactThreshold: 10_000 } },
    params: { messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Do all steps. ' + 'CONTEXT-FILLER '.repeat(600), timestamp: Date.now() }] },
    dispatch: {
      onMain: async ({ res, n, rec }) => {
        sseHeaders(res);
        if (n < 8) {
          let name, args;
          if (n % 2 === 0) {
            name = 'write_file';
            args = { path: `v1123-c${n}.txt`, content: `step-${n}\n` };
          } else {
            // Long output so the verbatim tail exceeds the 4000-char budget and
            // the head kept for compaction has >=2 messages (engine.ts:4503/4525).
            name = 'run_command';
            args = { command: `node -e "console.log('Y'.repeat(2200))"` };
          }
          res.write(sseChunk({ content: `Step ${n + 1}: calling ${name}.\n` }));
          for (const d of toolDeltas(name, JSON.stringify(args), 'call_c' + n)) res.write(sseChunk(d));
          // Usage above the 65% trigger (>=130000 of a 200000 fallback window)
          // at n===5 forces a REAL auto-compaction on the next loop iteration.
          const usage = n === 4 ? { prompt_tokens: 200_000, completion_tokens: 40 } : { prompt_tokens: 800 + n, completion_tokens: 40 };
          finishSse(res, 'tool_calls', usage);
        } else {
          for (const t of ['Compaction survived. ', 'All steps done. ', 'Done.']) res.write(sseChunk({ content: t }));
          finishSse(res, 'stop', { prompt_tokens: 300, completion_tokens: 40 });
        }
      },
    },
  });
  const F = [...r.failures];
  const compacted = r.ev.some((e) => e.type === 'compaction' || e.type === 'compaction_done' || (e.type === 'heartbeat' && e.phase === 'compacting'));
  ck(F, compacted, 'mid-run compaction actually occurred', `events=${r.ev.filter((e) => /compact/i.test(e.type)).map((e) => e.type).join(',')}`, 2, 'engine.ts:3931/4172');
  const report = r.ev.find((e) => e.type === 'task_report');
  ck(F, !!report && report.outcome === 'completed', 'run continues to clean completion after compaction', report?.outcome, 1, 'engine.ts:1830');
  return { name: 'S9 compaction mid-run', failures: F };
}

async function s10_subagent_failure() {
  let taskToolSeen = false;
  const r = await drive('S10-subagent-fail', {
    expectedFresh: 2, // initial task turn + post-tool follow-up
    env: { subagentTimeout: 8000 },
    dispatch: {
      onMain: async ({ res, n }) => {
        sseHeaders(res);
        if (n === 0) {
          taskToolSeen = true;
          const args = JSON.stringify({ agent: 'explore', description: 'probe', prompt: 'find something' });
          for (const d of toolDeltas('task', args, 'call_sub')) res.write(sseChunk(d));
          finishSse(res, 'tool_calls', { prompt_tokens: 60, completion_tokens: 30 });
        } else {
          for (const t of ['Subagent failed but I recovered. ', 'Done.']) res.write(sseChunk({ content: t }));
          finishSse(res, 'stop', { prompt_tokens: 40, completion_tokens: 20 });
        }
      },
      onSubagent: async ({ res }) => {
        // Force the specialist's model stream to fail.
        httpError(res, 500, { error: { message: 'subagent model unavailable' } });
      },
    },
  });
  const F = [...r.failures];
  ck(F, taskToolSeen && r.ev.some((e) => e.type === 'tool_start' && e.name === 'task'), 'subagent path exercised (task tool_start)', `seen=${taskToolSeen}`, 2, 'tools.ts:3076');
  const surfaced = r.ev.some((e) => e.type === 'tool_result' && /subagent failed|error:|retry shortly|unavailable|5xx/i.test(e.output ?? '')) ||
    r.ev.some((e) => e.type === 'sys_notice' && /subagent failed|error|retry/i.test(e.text ?? ''));
  ck(F, surfaced, 'subagent failure surfaced honestly (real cause + retry hint)', JSON.stringify(r.ev.filter((e) => e.type === 'tool_result').map((e) => (e.output ?? '').slice(0, 120))), 2, 'engine.ts:2725');
  const report = r.ev.find((e) => e.type === 'task_report');
  ck(F, !!report, 'parent still emits task_report after subagent failure', 'no report', 1, 'engine.ts:1825');
  return { name: 'S10 subagent failure', failures: F };
}

async function s11_slow_no_switch() {
  const r = await drive('S11-slow', {
    env: { sseIdle: 30_000, engineIdle: 40_000 },
    dispatch: {
      onMain: async ({ res, n }) => {
        sseHeaders(res);
        if (n === 0) {
          for (const t of ['Slow ', 'but ', 'steady ', 'stream. ', 'No ', 'auto ', 'switch. ', 'Still ', 'here. ', 'Done. ']) {
            res.write(sseChunk({ content: t }));
            await sleep(220);
          }
          finishSse(res, 'stop', { prompt_tokens: 50, completion_tokens: 20 });
        } else {
          finishSse(res, 'stop', { prompt_tokens: 5, completion_tokens: 5 });
        }
      },
    },
  });
  const F = [...r.failures];
  const switched = r.requests.some((q) => q.model !== MAIN && !q.isExtraction && !q.isCompact && !q.isSubagent);
  ck(F, !switched, 'slow provider does NOT auto-switch vendor', JSON.stringify(r.requests.map((q) => q.model)), 4, 'router.ts:119 / providers.ts:2166');
  const slowNotice = r.ev.some((e) => e.type === 'sys_notice' && /slow|switch/i.test(e.text ?? ''));
  ck(F, !slowNotice, 'no misleading slow/switch notice on a merely slow stream', r.ev.filter((e) => e.type === 'sys_notice').map((e) => e.text).join(' | '), 4, 'providers.ts:2167');
  const report = r.ev.find((e) => e.type === 'task_report');
  ck(F, !!report && report.outcome === 'completed', 'slow provider completes cleanly', report?.outcome, 2, 'engine.ts:1830');
  return { name: 'S11 slow provider (no auto-switch)', failures: F };
}

// ---------------------------------------------------------------------------
// Single parent test runs every scenario; prints ALL failures, ranked.
// ---------------------------------------------------------------------------
test('V1123 AI E2E — 11 nasty cases through the REAL engine + store', { timeout: 600_000 }, async (t) => {
  const scenarios = [
    s01_crossSession,
    s02_402,
    s03_429_then_success,
    s04_malformed_json,
    s05_bad_tool_args,
    s06_tool_fail_then_success,
    s07_abort,
    s08_long_unicode,
    s09_compaction,
    s10_subagent_failure,
    s11_slow_no_switch,
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

  // Flatten + rank failures by user impact (1 = worst).
  for (const res of results) {
    for (const f of res.failures) ALL.push({ ...f, scenario: f.scenario ?? res.name });
  }
  console.error('\n===== V1123 AI E2E — SCENARIO SUMMARY =====');
  for (const res of results) {
    console.error(`[V1123] ${res.name}: ${res.failures.length ? 'FAIL' : 'PASS'} (${res.failures.length} failure${res.failures.length === 1 ? '' : 's'})`);
    for (const f of res.failures) console.error(`[V1123 FAIL] ${res.name} :: [I${f.impact}] ${f.check} :: ${f.detail} :: @${f.source}`);
  }
  ALL.sort((a, b) => a.impact - b.impact);
  console.error('\n===== V1123 RANKED FAILURE REPORT (by user impact) =====');
  if (!ALL.length) console.error('NONE — the AI works across all 11 nasty cases.');
  for (const f of ALL) console.error(`I${f.impact}  ${f.scenario} :: ${f.check} :: ${f.detail} :: @${f.source}`);
  console.error(`\nTOTAL FAILURES: ${ALL.length}  (scenarios: ${results.filter((r) => r.failures.length).length}/${results.length} failing)`);

  assert.equal(
    ALL.length, 0,
    `V1123 AI E2E found ${ALL.length} failure(s) across ${results.filter((r) => r.failures.length).length} scenarios — see [V1123 FAIL] lines above`,
  );
});

after(() => {
  for (const k of [
    'SURNIA_SSE_IDLE_MS', 'SURNIA_ENGINE_IDLE_MS', 'SURNIA_TURN_RETRY_DELAYS_MS',
    'SURNIA_DELTA_FLUSH_MS', 'SURNIA_HOME', 'SURNIA_SKIP_UI_GATE',
    'SURNIA_STREAM_CONTINUE_BUDGET', 'SURNIA_MAX_TOKENS_CONTINUES', 'SURNIA_SUBAGENT_TIMEOUT_MS',
  ]) delete process.env[k];
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});
