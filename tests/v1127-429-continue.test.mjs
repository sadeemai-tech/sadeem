// ============================================================================
// v11.27 — 429 CONTINUE (no sudden AI stop)
//
// Founder: "حل مشكلة انقطاع الذكاء الاصطناعي وتوقفه الماجئ اذا لا يكمل المهم
// ويتقف هنا" — a 429 must NEVER end a long task on the first response.
//
// Contract under test:
//   • a 429 is RECOVERABLE in place: bounded exponential backoff (≤1s each),
//     5-8 attempts over a generous budget, ONE quiet visible notice;
//   • the user's chosen provider is kept (no auto-switch on 429);
//   • no silent re-request duplicates streamed text or re-executes a tool;
//   • 402 / 401 remain FATAL on the FIRST response (one request only);
//   • a long task with transient 429s completes with real deltas + ONE honest
//     written task_report.
//
// Run: node --test --test-force-exit tests/v1127-429-continue.test.mjs
// ============================================================================
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
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
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1127-429-continue-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, entry, '--bundle', '--platform=node',
    '--format=cjs', '--outfile=' + out,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
    '--log-level=error'], { cwd: ROOT, timeout: 120000 });
}

// ---------------------------------------------------------------------------
// PART A — providers.ts in isolation (deterministic global fetch).
// ---------------------------------------------------------------------------
const provPath = join(tmp, 'providers.cjs');
bundle('electron/agent/providers.ts', provPath);
const p = require(provPath);

const REAL_FETCH = globalThis.fetch;
let calls = [];
const sseBody = (text) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\n` +
  'data: [DONE]\n\n';

function installFetch(stepFor) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const model = body.model;
    const step = stepFor(model, calls.length, body);
    calls.push({ model, at: Date.now(), status: step.status, body });
    if (step.status !== 200) {
      return new Response(step.text ?? 'error', { status: step.status, headers: step.headers ?? {} });
    }
    return new Response(sseBody(step.text ?? 'ANSWER'), {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    });
  };
  return calls;
}
function restoreFetch() { globalThis.fetch = REAL_FETCH; }

const turnOpts = (hooks = {}) => ({
  model: { provider: 'custom', model: 'hot', maxTokens: 64 },
  baseUrl: 'http://mock.local/v1',
  system: 'system',
  messages: [{ role: 'user', text: 'hi' }],
  tools: [],
  signal: new AbortController().signal,
  onText: () => {},
  onToolUse: () => {},
  ...hooks,
});

const ENV_KEYS = ['SURNIA_RATE_LIMIT_MAX_ATTEMPTS', 'SURNIA_RATE_LIMIT_BUDGET_MS'];
function clearRateEnv() { for (const k of ENV_KEYS) delete process.env[k]; }

test('v1127 A1: 429×5 then success → same-provider recovery with real deltas + ONE quiet notice', async () => {
  p.resetRateLimitNotices();
  clearRateEnv();
  let text = '';
  const notices = [];
  installFetch((_model, n) => n < 5
    ? { status: 429, text: '{"error":{"message":"raw gateway json"}}', headers: {} }
    : { status: 200, text: 'RECOVERED AFTER RATE LIMIT' });

  const t0 = Date.now();
  try {
    const r = await p.streamTurn(turnOpts({
      onText: (t) => { text += t; },
      onNotice: (n) => notices.push(n),
    }));
    assert.equal(r.stopReason, 'end_turn');
  } finally {
    restoreFetch();
  }
  const elapsed = Date.now() - t0;

  assert.equal(calls.length, 6, 'exactly six requests: five 429s then success (never stopped early)');
  assert.ok(calls.slice(0, 5).every((c) => c.status === 429));
  assert.equal(calls[5].status, 200);
  assert.equal(text, 'RECOVERED AFTER RATE LIMIT', 'real streamed delta delivered after recovery');

  const rl = notices.filter((n) => n.kind === 'rate_limited');
  assert.equal(rl.length, 1, 'exactly ONE quiet visible 429 notice');
  assert.match(rl[0].text, /continuing the same task/);
  assert.doesNotMatch(rl[0].text, /raw gateway json|failover/i, 'notice is JSON-free and switch-free');

  // Bounded exponential backoff: each gap ≤1s (+ small scheduling slack).
  const gaps = calls.slice(1).map((c, i) => c.at - calls[i].at);
  assert.ok(gaps.every((g) => g <= 1100), `each backoff ≤1s (gaps=${gaps.join(',')})`);
  assert.ok(gaps.slice(0, 2).some((g) => g >= 200), 'real exponential backoff was applied');
  assert.ok(elapsed < 10_000, `bounded total time (${elapsed}ms)`);
});

test('v1127 A2: 429 forever → bounded honest failure (no infinite hammer)', async () => {
  p.resetRateLimitNotices();
  process.env.SURNIA_RATE_LIMIT_MAX_ATTEMPTS = '5';
  process.env.SURNIA_RATE_LIMIT_BUDGET_MS = '2000';
  let threw = null;
  installFetch(() => ({ status: 429, text: '{"error":{"message":"raw gateway json"}}', headers: {} }));
  const t0 = Date.now();
  try {
    await p.streamTurn(turnOpts());
  } catch (err) {
    threw = err;
  } finally {
    restoreFetch();
    clearRateEnv();
  }
  const elapsed = Date.now() - t0;

  assert.ok(threw instanceof Error, 'eventual exhaustion throws a real Error');
  assert.equal(calls.length, 5, 'bounded to the configured attempt count (5), not unbounded');
  assert.equal(p.providerErrorKindOf(threw), 'rate_limited', 'honest terminal classification');
  assert.match(threw.message, /429|rate.?limit/i);
  assert.doesNotMatch(threw.message, /raw gateway json|\{.*error.*\}/, 'no raw provider JSON leaks');
  assert.ok(elapsed < 6000, `bounded wall time (${elapsed}ms)`);
});

test('v1127 A3: 402 and 401 still fatal on the FIRST response (one request)', async () => {
  for (const status of [402, 401]) {
    p.resetRateLimitNotices();
    clearRateEnv();
    installFetch(() => ({ status, text: '{"error":{"message":"raw gateway json"}}', headers: {} }));
    let threw = null;
    try {
      await p.streamTurn(turnOpts());
    } catch (err) {
      threw = err;
    } finally {
      restoreFetch();
    }
    assert.ok(threw instanceof Error, `${status} throws immediately`);
    assert.equal(calls.length, 1, `${status} = exactly ONE request (no silent retry)`);
    assert.equal(p.providerErrorKindOf(threw), status === 402 ? 'no_credits' : 'invalid_key');
  }
});

// ---------------------------------------------------------------------------
// PART B — real engine.runAgent against a local scripted provider.
// ---------------------------------------------------------------------------
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

const engPath = join(tmp, 'engine.cjs');
bundle('electron/agent/engine.ts', engPath);
const engine = require(engPath);

// Minimal browser globals some bundled modules read at call time.
globalThis.window = {
  surnia: new Proxy({}, { get: (_t, key) => (..._a) => Promise.resolve(undefined) }),
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false }),
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { documentElement: { classList: { contains: () => false }, dataset: {}, style: {} }, addEventListener() {} };
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

const MAIN = 'v1127-main';
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'v1127', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const sseHeaders = (res) => { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.flushHeaders(); };
const finishSse = (res, finish, usage) => {
  if (usage) res.write(`data: ${JSON.stringify({ usage, choices: [] })}\n\n`);
  res.write(sseChunk({}, finish));
  res.write('data: [DONE]\n\n');
  res.end();
};
const toolDeltas = (name, args, id) => {
  const half = Math.max(1, Math.floor(args.length / 2));
  return [
    { tool_calls: [{ index: 0, id, function: { name, arguments: '' } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(0, half) } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(half) } }] },
  ];
};

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
        model: body.model, at: Date.now(),
        sawTool: msgs.some((m) => m.role === 'tool' || m.role === 'tool_result'),
        isAux: /compact coding-agent transcripts|extract durable engineering facts|Surnia DNA user model|part of the Surnia agent team/i.test(sys),
      };
      requests.push(rec);
      try {
        if (rec.isAux || body.model !== MAIN) {
          sseHeaders(res);
          finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 });
          return;
        }
        const n = state.mainCount++;
        await dispatch.onMain({ res, n, rec });
      } catch (err) {
        try { res.destroy(); } catch { /* gone */ }
        state.handlerErrors.push(String(err?.message ?? err));
      }
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const listening = new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  return {
    requests, port: listening,
    async stop() {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

function writeSettings(base) {
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({
    schemaVersion: 4, language: 'en',
    providers: { custom: { apiKey: 'test-key', baseUrl: base }, zai: { apiKey: 'test-key', baseUrl: base } },
    agent: {
      maxRetries: 0, autoCompact: false, compactThreshold: 10_000, autoVerify: false,
      selfCritique: false, criticGate: false, autoMemory: false, checkpointsEnabled: false,
      allowModelFailover: false, continueAuto: false,
    },
    doneNotifications: false,
  }));
}

function setEnv() {
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = '5,5,5,5,5,5';
  process.env.SURNIA_DELTA_FLUSH_MS = '5';
  process.env.SURNIA_HOME = userDataDir;
  process.env.SURNIA_SKIP_UI_GATE = '1';
  process.env.SURNIA_STREAM_CONTINUE_BUDGET = '0';
  process.env.SURNIA_MAX_TOKENS_CONTINUES = '25';
  process.env.SURNIA_SSE_IDLE_MS = '20_000';
  process.env.SURNIA_ENGINE_IDLE_MS = '30_000';
  process.env.SURNIA_RATE_LIMIT_MAX_ATTEMPTS = '8';
  process.env.SURNIA_RATE_LIMIT_BUDGET_MS = '20_000';
  delete process.env.SURNIA_MAX_RUN_MS;
}

function makeIo() {
  const events = [];
  return {
    events, send(e) { events.push({ ...e, at: Date.now() }); },
    getDecision() { return Promise.resolve({ action: 'allow' }); },
    isAborted() { return false; },
    onFetchSignal() {},
  };
}

async function drive(name, dispatch) {
  const state = { mainCount: 0, handlerErrors: [] };
  const mock = startMock(dispatch, state);
  const base = `http://127.0.0.1:${await mock.port}/v1`;
  writeSettings(base);
  setEnv();
  const io = makeIo();
  const ws = mkdtempSync(join(tmp, 'v1127-ws-' + name + '-'));
  const params = {
    task: 'chat',
    sessionId: 'v1127-' + name + '-' + Math.random().toString(36).slice(2),
    messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Do the task and give a written report.', timestamp: Date.now() }],
    model: { provider: 'custom', model: MAIN, maxTokens: 2048 },
    mode: 'fullAccess', workspace: ws, apiKey: 'test-key', baseUrl: base,
  };
  let thrown = null;
  try {
    await engine.runAgent(params, io);
  } catch (err) {
    thrown = err;
  }
  await mock.stop();
  try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  return { events: io.events, requests: mock.requests, state, thrown };
}

test('v1127 B1: long task survives 429×5 → real deltas + ONE honest written report', { timeout: 60_000 }, async () => {
  const r = await drive('recover', {
    onMain: async ({ res, n }) => {
      if (n < 5) {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' });
        res.end('{"error":{"message":"raw gateway json"}}');
        return;
      }
      sseHeaders(res);
      res.write(sseChunk({ content: 'Recovered after a rate limit. ' }));
      res.write(sseChunk({ content: 'Written report: task completed.' }));
      finishSse(res, 'stop', { prompt_tokens: 30, completion_tokens: 12 });
    },
  });

  assert.equal(r.thrown, null, 'runAgent did not throw');
  const mainReqs = r.state.mainCount;
  assert.ok(mainReqs >= 6, `429s were recovered in place (main requests=${mainReqs})`);
  const text = r.events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
  assert.match(text, /Recovered after a rate limit/, 'real streamed delta delivered');
  assert.match(text, /Written report/, 'written report present');

  const reports = r.events.filter((e) => e.type === 'task_report');
  assert.equal(reports.length, 1, 'exactly ONE terminal task_report');
  assert.equal(reports[0].outcome, 'completed', 'honest report outcome');
  assert.ok(typeof reports[0].summary === 'string' && reports[0].summary.trim().length > 0, 'report has a written summary');

  const rateNotices = r.events.filter((e) => e.type === 'sys_notice' && e.kind === 'rate_limited');
  assert.equal(rateNotices.length, 1, 'exactly ONE quiet visible 429 notice');
  assert.ok(!r.events.some((e) => e.type === 'error'), 'no duplicate/error row on transient 429 recovery');
});

test('v1127 B2: 429 during a tool chain never re-executes the tool', { timeout: 60_000 }, async () => {
  const r = await drive('toolchain', {
    onMain: async ({ res, n, rec }) => {
      if (n === 0) {
        sseHeaders(res);
        for (const d of toolDeltas('write_file', JSON.stringify({ path: 'v1127-once.txt', content: 'once\n' }), 'call_once')) res.write(sseChunk(d));
        finishSse(res, 'tool_calls', { prompt_tokens: 60, completion_tokens: 30 });
        return;
      }
      if (n === 1 || n === 2) {
        // The tool-result request is throttled TWICE, then succeeds. Retrying
        // the same request body must not re-run the already-executed tool.
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' });
        res.end('rate limit');
        return;
      }
      sseHeaders(res);
      res.write(sseChunk({ content: 'Tool ran exactly once. Written report: done.' }));
      finishSse(res, 'stop', { prompt_tokens: 40, completion_tokens: 20 });
    },
  });

  assert.equal(r.thrown, null, 'runAgent did not throw');
  const starts = r.events.filter((e) => e.type === 'tool_start');
  const results = r.events.filter((e) => e.type === 'tool_result');
  assert.equal(starts.length, 1, 'the tool executed exactly ONCE (no duplicate from 429 retry)');
  assert.equal(results.length, 1, 'one tool_result for the one tool_start');
  const throttled = r.requests.filter((x) => x.sawTool);
  assert.ok(throttled.length >= 3, 'the tool-result request was throttled then retried in place');
  const text = r.events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
  assert.match(text, /Tool ran exactly once/, 'run continued to a written answer');
  const reports = r.events.filter((e) => e.type === 'task_report');
  assert.equal(reports.length, 1, 'ONE honest terminal report');
  assert.equal(reports[0].outcome, 'completed');
});

after(() => {
  restoreFetch();
  clearRateEnv();
  for (const k of [
    'SURNIA_TURN_RETRY_DELAYS_MS', 'SURNIA_DELTA_FLUSH_MS', 'SURNIA_HOME',
    'SURNIA_SKIP_UI_GATE', 'SURNIA_STREAM_CONTINUE_BUDGET', 'SURNIA_MAX_TOKENS_CONTINUES',
    'SURNIA_SSE_IDLE_MS', 'SURNIA_ENGINE_IDLE_MS',
  ]) delete process.env[k];
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});
