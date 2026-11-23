import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================================
// v11.32/v11.33 — REAL ENDURANCE / HONESTY TEST (drives the actual engine).
//
// The founder: "فجأة يتوقف عن العمل... يجب أن يقوم بمهام ساعات لأيام... لا يتوقف."
// (It suddenly stops working... it must do tasks for hours to days... never stop.)
//
// This harness bundles the REAL electron/agent/engine.ts (electron stubbed) and
// drives runAgent() against a LOCAL scripted OpenAI-compatible provider
// (node:http — zero network, zero model). It proves, with NO artificial cap
// configured, that:
//   1. a run performs 150 tool rounds (> the 120-step default budget) and
//      auto-continues silently — no wall-clock cap, no round cap, no re-ask;
//   2. occasional tool failures never become a fake 'completed' report;
//   3. a bare "DONE" after a FAILED last tool call is REJECTED with a corrective
//      nudge, and the run ends with ONE honest written report;
//   4. the default knobs really are unbounded (exported helpers checked).
//
// Run: node --test --test-force-exit tests/v1132-endurance-real.test.mjs
// ============================================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1132-endurance-'));

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
  console.error('[V1132] ENGINE BUNDLE FAILED:', err?.message ?? err);
  throw err;
}

// Minimal browser-ish globals the bundled modules probe for on import.
const bridge = new Proxy({}, {
  get(_t, key) {
    if (key === 'then' || typeof key === 'symbol') return undefined;
    return (..._a) => Promise.resolve(undefined);
  },
});
globalThis.window = { surnia: bridge, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { documentElement: { classList: { contains: () => false }, dataset: {}, style: {} }, addEventListener() {} };
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

const MAIN = 'v1132-endurance';
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'v1132-mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
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

const ROUNDS = 150;          // > the default 120-step budget
const FAIL_EVERY = 15;       // occasional failures; round 149 (the LAST) fails
const EXPECTED_FAILS = Math.floor(ROUNDS / FAIL_EVERY);
const HONEST_REPORT = 'Written report: 150 steps were attempted; 10 tool calls failed on missing files; the remaining verification is unfinished and is reported honestly, not claimed as done.';

function startMock() {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      const sys = JSON.stringify(body);
      requests.push({ model: body.model, at: Date.now() });
      // Secondary roles (compact / extraction / subagent / verifier) finish flat.
      const secondary =
        body.model !== MAIN ||
        /compact coding-agent transcripts|extract durable engineering facts|Surnia DNA user model|part of the Surnia agent team/i.test(sys);
      if (secondary) {
        sseHeaders(res);
        finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 });
        return;
      }
      const msgs = body.messages ?? [];
      const turn = requests.filter((r) => r.model === MAIN).length - 1;
      sseHeaders(res);
      if (turn < ROUNDS) {
        const failing = turn % FAIL_EVERY === FAIL_EVERY - 1;
        const callId = 'v1132_call_' + turn;
        if (failing) {
          // A DIFFERENT missing path each time so the repeated-failure breaker
          // does not mask the DONE-integrity guard under test.
          for (const d of toolDeltas('read_file', JSON.stringify({ path: `definitely-missing-${turn}.txt` }), callId)) {
            res.write(sseChunk(d));
          }
          finishSse(res, 'tool_calls', { prompt_tokens: 20, completion_tokens: 8 });
        } else {
          for (const d of toolDeltas('write_file', JSON.stringify({ path: `probe-${turn}.txt`, content: `tick-${turn}\n` }), callId)) {
            res.write(sseChunk(d));
          }
          finishSse(res, 'tool_calls', { prompt_tokens: 20, completion_tokens: 8 });
        }
        return;
      }
      if (turn === ROUNDS) {
        // Bare DONE while the LAST tool call failed → must be rejected.
        res.write(sseChunk({ content: 'DONE' }));
        finishSse(res, 'stop', { prompt_tokens: 5, completion_tokens: 2 });
        return;
      }
      // After the corrective nudge: honest prose, never another bare DONE.
      res.write(sseChunk({ content: HONEST_REPORT }));
      finishSse(res, 'stop', { prompt_tokens: 60, completion_tokens: 30 });
    });
  });
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

/** Provider that first LIES ("I created index.html", zero tools), then — only
 * after the engine's corrective nudge — really writes the file. */
function startFalseDoneMock(target, marker) {
  const requests = [];
  const sockets = new Set();
  let mainTurn = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      const sys = JSON.stringify(body);
      requests.push({ model: body.model, msgs: body.messages ?? [] });
      const secondary =
        body.model !== MAIN ||
        /compact coding-agent transcripts|extract durable engineering facts|Surnia DNA user model|part of the Surnia agent team/i.test(sys);
      if (secondary) {
        sseHeaders(res);
        finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 });
        return;
      }
      const n = mainTurn++;
      sseHeaders(res);
      if (n === 0) {
        res.write(sseChunk({ content: 'Done — I created index.html for you.' }));
        finishSse(res, 'stop', { prompt_tokens: 8, completion_tokens: 5 });
      } else if (n === 1) {
        for (const d of toolDeltas('write_file', JSON.stringify({ path: target.replace(/\\/g, '/'), content: marker }), 'call_real_fix')) {
          res.write(sseChunk(d));
        }
        finishSse(res, 'tool_calls', { prompt_tokens: 10, completion_tokens: 5 });
      } else {
        res.write(sseChunk({ content: 'Done — index.html is on disk and verified.' }));
        finishSse(res, 'stop', { prompt_tokens: 8, completion_tokens: 5 });
      }
    });
  });
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

function makeIo() {
  const events = [];
  const io = {
    events,
    send(e) { events.push({ ...e, at: Date.now() }); },
    getDecision() { return Promise.resolve({ action: 'allow' }); },
    isAborted() { return false; },
    onFetchSignal() {},
  };
  return io;
}

function writeSettings(base, ws) {
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({
    schemaVersion: 4,
    language: 'en',
    providers: {
      custom: { apiKey: 'test-key', baseUrl: base },
      zai: { apiKey: 'test-key', baseUrl: base },
    },
    agent: {
      maxRetries: 0, autoCompact: false, compactThreshold: 10_000_000,
      autoVerify: false, selfCritique: false, criticGate: false,
      autoMemory: false, runAndShow: false, checkpointsEnabled: false,
      allowModelFailover: false,
    },
    workspacePath: ws,
    doneNotifications: false,
  }));
}

function setEnv() {
  // CRITICAL: no artificial cap of any kind is configured for this test.
  for (const k of [
    'SURNIA_MAX_RUN_MS', 'SURNIA_TIME_CAP_GRACE_MS', 'SURNIA_MAX_CONTINUE_ROUNDS',
    'SURNIA_LONG_RUN', 'SURNIA_MAX_TOKENS_CONTINUES', 'SURNIA_PAUSE_CONTINUES',
  ]) delete process.env[k];
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = '5,5,5,5,5,5';
  process.env.SURNIA_DELTA_FLUSH_MS = '5';
  process.env.SURNIA_HOME = userDataDir;
  process.env.SURNIA_SKIP_UI_GATE = '1';
  process.env.SURNIA_STREAM_CONTINUE_BUDGET = '0';
  process.env.SURNIA_SSE_IDLE_MS = '20_000';
  process.env.SURNIA_ENGINE_IDLE_MS = '30_000';
}

test('V1132 REAL ENDURANCE — 150 tool rounds, no silent cap, bare DONE rejected, ONE honest report', { timeout: 240_000 }, async () => {
  // (0) the exported default knobs must be UNBOUNDED.
  setEnv();
  assert.equal(engine.wallClockCapExplicit(), false, 'no explicit wall-clock cap by default');
  assert.equal(engine.maxContinueRounds(), 0, '0 = unbounded continuation rounds by default');
  assert.equal(engine.streamContinueBudget(), 0, 'no hidden stream re-request loop');

  const mock = startMock();
  const port = await mock.port;
  const ws = mkdtempSync(join(tmp, 'v1132-ws-'));
  writeSettings(`http://127.0.0.1:${port}/v1`, ws);
  const io = makeIo();
  let thrown = null;
  const t0 = Date.now();
  try {
    await engine.runAgent({
      task: 'chat',
      sessionId: 'v1132-endurance-' + Math.random().toString(36).slice(2),
      messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Do 150 steps of work, then give me a WRITTEN report.', timestamp: Date.now() }],
      model: { provider: 'custom', model: MAIN, maxTokens: 2048 },
      mode: 'fullAccess',
      workspace: ws,
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${port}/v1`,
    }, io);
  } catch (err) {
    thrown = err;
  }
  const durationMs = Date.now() - t0;
  await mock.stop();

  const ev = io.events;
  const starts = ev.filter((e) => e.type === 'tool_start');
  const results = ev.filter((e) => e.type === 'tool_result');
  const reports = ev.filter((e) => e.type === 'task_report');
  const notices = ev.filter((e) => e.type === 'sys_notice').map((e) => String(e.text ?? ''));
  const finalText = ev.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');

  // 1. the engine never threw and never silently capped the run.
  assert.equal(thrown, null, `runAgent must not throw: ${thrown?.stack ?? thrown}`);
  assert.equal(starts.length, ROUNDS, `all ${ROUNDS} tool rounds executed (got ${starts.length})`);
  assert.equal(results.length, starts.length, 'every tool call has one result');
  const failed = results.filter((r) => r.ok === false);
  assert.equal(failed.length, EXPECTED_FAILS, `occasional tool failures preserved (got ${failed.length}, expected ${EXPECTED_FAILS})`);
  assert.ok(notices.some((t) => /auto-continue/i.test(t)), 'a bare >120-step run auto-continued (no step cap)');
  assert.ok(durationMs < 180_000, `run finished in bounded local time (${durationMs}ms)`);

  // 2. a bare "DONE" against a failed last tool call was REJECTED with a nudge.
  assert.ok(
    notices.some((t) => /completion integrity|bare DONE rejected/i.test(t)) ||
      finalText.includes('Written report:'),
    'bare DONE was rejected; the run continued to an honest written report',
  );

  // 3. exactly ONE honest written report; failures never read as 'completed'.
  assert.equal(reports.length, 1, `exactly one task_report (got ${reports.length})`);
  const rep = reports[0];
  assert.equal(rep.outcome, 'error', 'failed tool calls make the report outcome=error, never a fake completed');
  assert.ok(typeof rep.summary === 'string' && rep.summary.trim().length > 0, 'report carries a WRITTEN summary');
  assert.ok(
    rep.summary.includes('tool call') || rep.summary.includes('failed'),
    `report states the failure honestly: ${JSON.stringify(rep.summary)}`,
  );
  assert.ok(!['time_cap', 'max_tokens', 'paused'].includes(rep.stopReason), `no artificial cap ended the run: ${rep.stopReason}`);
  assert.notEqual(rep.maxedOut, true, 'the run did not end because a step cap maxed out');
  assert.ok(finalText.includes('Written report:'), 'the final answer is the honest report, not bare DONE');

  // 4. no ARTIFICIAL-STOP re-ask ("ask me to continue" / "send a follow-up
  //    to continue the remaining work") surfaced. Generic error-path guidance
  //    on a genuinely failed run is honest and is not an artificial stop.
  const nextSteps = (rep.nextSteps ?? []).join(' | ');
  assert.ok(
    !/ask me to continue|send a follow-up to continue the remaining work/i.test(nextSteps),
    `no artificial-stop re-ask in report: ${nextSteps}`,
  );
});

test('V1132 FALSE-DONE REALITY — "I created index.html" with zero tools is corrected into a REAL file', { timeout: 120_000 }, async () => {
  setEnv();
  const ws = mkdtempSync(join(tmp, 'v1132-ws-false-done-'));
  const target = join(ws, 'index.html');
  const marker = '<!doctype html><title>V1132 FALSE-DONE REALITY</title>';
  const mock = startFalseDoneMock(target, marker);
  const port = await mock.port;
  writeSettings(`http://127.0.0.1:${port}/v1`, ws);
  const io = makeIo();
  let thrown = null;
  try {
    await engine.runAgent({
      task: 'chat',
      sessionId: 'v1132-false-done-' + Math.random().toString(36).slice(2),
      messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Create a tiny HTML file named index.html in the workspace.', timestamp: Date.now() }],
      model: { provider: 'custom', model: MAIN, maxTokens: 2048 },
      mode: 'fullAccess',
      taskMode: 'build',
      workspace: ws,
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${port}/v1`,
    }, io);
  } catch (err) {
    thrown = err;
  }
  const mainReqs = mock.requests.filter((r) => r.model === MAIN);
  const starts = io.events.filter((e) => e.type === 'tool_start');
  const reports = io.events.filter((e) => e.type === 'task_report');
  const notices = io.events.filter((e) => e.type === 'sys_notice').map((e) => String(e.text ?? ''));
  await mock.stop();

  // 1. the lie triggered a corrective nudge → the provider was re-called.
  assert.equal(thrown, null, `runAgent must not throw: ${thrown?.stack ?? thrown}`);
  assert.ok(mainReqs.length >= 2, `a bare claim with no tools must be re-called (got ${mainReqs.length} main requests)`);
  assert.ok(
    notices.some((t) => /false-done guard|nothing exists on disk/i.test(t)) ||
      mainReqs.some((q) => /nothing exists on disk|Call write_file/i.test(JSON.stringify(q.msgs))),
    'a corrective completion-integrity nudge was injected',
  );

  // 2. the corrected turn REALLY called write_file and the file is on disk.
  assert.ok(starts.some((e) => e.name === 'write_file'), 'a write_file tool call happened after the nudge');
  assert.equal(existsSync(target), true, 'the claimed index.html really exists on disk');
  assert.ok(readFileSync(target, 'utf8').includes('V1132 FALSE-DONE REALITY'), 'the real file carries the written content');

  // 3. still exactly ONE honest written report.
  assert.equal(reports.length, 1, `exactly one task_report (got ${reports.length})`);
  assert.ok(typeof reports[0].summary === 'string' && reports[0].summary.trim().length > 0, 'written report present');
});

after(() => {
  for (const k of [
    'SURNIA_TURN_RETRY_DELAYS_MS', 'SURNIA_DELTA_FLUSH_MS', 'SURNIA_HOME',
    'SURNIA_SKIP_UI_GATE', 'SURNIA_STREAM_CONTINUE_BUDGET', 'SURNIA_SSE_IDLE_MS',
    'SURNIA_ENGINE_IDLE_MS', 'SURNIA_MAX_RUN_MS', 'SURNIA_TIME_CAP_GRACE_MS',
    'SURNIA_MAX_CONTINUE_ROUNDS', 'SURNIA_LONG_RUN',
  ]) delete process.env[k];
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
