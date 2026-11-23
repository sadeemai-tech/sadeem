import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// v11.18 — QUIET SIMPLE TURNS (founder: "NO audit/proof/critique rows
// after a simple conversational answer").
//
// Boots the REAL agent engine (electron/agent/engine.ts, esbuild-bundled)
// against a local, scripted, OpenAI-compatible provider (node:http — zero
// network, zero model), using the same harness posture as
// tests/v1114-live-repro.test.mjs. Two scenarios:
//
//   SIMPLE — one conversational turn, NO tools/writes/commands/verification.
//            Assert NO claim_audit / self_critique / proof_package events
//            (and no run_receipt / run_and_show), while the answer, the
//            task_report and turn_end still arrive (no completion/safety
//            regression).
//
//   WORK   — a real write_file tool call + a detected test command, then a
//            final answer with claims. Assert the FULL audit is kept:
//            claim_audit + proof_package + run_receipt (+ self_critique).
//
// Run:
//   node --test --test-force-exit tests/v1118-engine-quiet.test.mjs
// Debug:
//   V1118_DEBUG=1 node --test --test-force-exit tests/v1118-engine-quiet.test.mjs
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
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1118-quiet-'));

// ---------- esbuild bundle (same posture as the other live harnesses) ----------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN,
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
    shell: {},
    screen: {},
    powerMonitor: { on() {} },
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
  console.error('[v1118] ENGINE BUNDLE FAILED — no agent turn can start:', err?.message ?? err);
  throw err;
}

// ---------- local mock OpenAI-compatible provider ----------
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

// Scenario selector read at request time (set by driveRun).
let SCENARIO = 'simple';

function startMock() {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      requests.push({
        model: body.model,
        at: Date.now(),
        sawTool: (body.messages ?? []).some((m) => m.role === 'tool'),
      });

      // Secondary models (verifier / critic) get a tiny empty completion so
      // they stay LOCAL and never spin a retry loop. The main model is scripted.
      if (body.model !== 'quiet-live') {
        sseHeaders(res);
        finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 });
        return;
      }

      sseHeaders(res);
      const sawTool = (body.messages ?? []).some((m) => m.role === 'tool');
      if (SCENARIO === 'simple') {
        // Conversational answer only — NO tool call, NO claims about work.
        // auditClaims() still labels these sentences as claims, which is
        // precisely why the engine must gate on real work, not claims alone.
        for (const t of ['Hello! ', "I'm doing well, thanks for asking."]) {
          res.write(sseChunk({ content: t }));
        }
        finishSse(res, 'stop', { prompt_tokens: 10, completion_tokens: 12 });
      } else if (!sawTool) {
        // WORK turn 1: a real write_file tool call.
        res.write(sseChunk({ content: 'Creating the proof file now.\n' }));
        const args = JSON.stringify({ path: 'proof-work.txt', content: 'V1118-WORK\n' });
        for (const d of toolDeltas('write_file', args, 'call_v1118_1')) res.write(sseChunk(d));
        finishSse(res, 'tool_calls', { prompt_tokens: 120, completion_tokens: 60 });
      } else {
        // WORK turn 2: final answer with claim-like statements so the full
        // claim_audit / proof_package / receipt pipeline must fire.
        for (const t of ['Created proof-work.txt. ', 'All tests pass. ', 'Done.']) {
          res.write(sseChunk({ content: t }));
        }
        finishSse(res, 'stop', { prompt_tokens: 260, completion_tokens: 30 });
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

// ---------- engine harness: renderer-style IO that records events ----------
function makeIo() {
  const events = [];
  return {
    events,
    send(e) {
      events.push({
        type: e.type,
        at: Date.now(),
        kind: e.kind,
        text: e.text ?? e.message ?? '',
        summary: e.summary,
        outcome: e.outcome,
        claims: e.claims,
      });
    },
    async getDecision(requestId) { return { requestId, action: 'allow' }; },
    isAborted: () => false,
    onFetchSignal() {},
  };
}

function writeSettings(mockBase) {
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 4,
      providers: {
        custom: { apiKey: 'test-key', baseUrl: mockBase },
        zai: { apiKey: 'test-key', baseUrl: mockBase },
      },
      agent: { maxRetries: 0, autoCompact: false, autoVerify: false, selfCritique: true, runAndShow: true },
      doneNotifications: false,
    }),
  );
}

function timelineDump(io, t0) {
  return io.events.map((e) => `${String((e.at ?? t0) - t0).padStart(6)}ms  ${e.type}${e.kind ? '/' + e.kind : ''}  ${String(e.text ?? e.summary ?? '').slice(0, 90).replace(/\n/g, '\\n')}`).join('\n');
}

// A "row" reaches the renderer either as its own event type or as a
// sys_notice kind (self_critique, run_and_show, proof notices).
function rowsFor(io, name) {
  return io.events.filter((e) => e.type === name || (e.type === 'sys_notice' && e.kind === name));
}

async function driveRun(scenario) {
  SCENARIO = scenario;
  const mock = startMock();
  const port = await mock.port;
  const mockBase = `http://127.0.0.1:${port}/v1`;
  writeSettings(mockBase);
  const ws = mkdtempSync(join(tmpdir(), 'surnia-v1118-ws-'));
  // Give the WORK run a detectable test command so a real test executes
  // (same trick as v1114). The SIMPLE run gets no Makefile at all.
  if (scenario === 'work') writeFileSync(join(ws, 'Makefile'), 'test:\n\t@echo V1118-TEST-OK\n');
  const io = makeIo();

  process.env.SURNIA_TURN_RETRY_DELAYS_MS = '8,8,8,8,8,8';
  process.env.SURNIA_DELTA_FLUSH_MS = '20';
  process.env.SURNIA_HOME = userDataDir; // isolate memory/playbook/hooks/journal state

  const t0 = Date.now();
  let thrown = null;
  try {
    await engine.runAgent(
      {
        task: 'chat',
        sessionId: 'v1118-' + scenario + '-' + Math.random().toString(36).slice(2),
        messages: [{
          id: 'm1', role: 'user', kind: 'text', timestamp: t0,
          content: scenario === 'simple'
            ? 'Just say hello and tell me how you are.'
            : 'Create proof-work.txt, run the test, then report what you did.',
        }],
        model: { provider: 'custom', model: 'quiet-live', maxTokens: 2048 },
        mode: 'fullAccess',
        workspace: ws,
        apiKey: 'test-key',
        baseUrl: mockBase,
      },
      io,
    );
  } catch (err) {
    thrown = err;
  }
  if (process.env.V1118_DEBUG) console.error(`\n===== ${scenario.toUpperCase()} TIMELINE =====\n${timelineDump(io, t0)}`);
  return { mock, ws, io, t0, thrown };
}

// ============================================================
// SIMPLE — no tools: emit NOTHING audit/proof-like.
// ============================================================
test('v1118 SIMPLE chat turn emits no claim_audit / self_critique / proof_package rows', async () => {
  const { mock, ws, io, thrown } = await driveRun('simple');
  try {
    assert.equal(thrown, null, `runAgent must not throw (got: ${thrown?.stack ?? thrown})`);

    // The founder's complaint, translated to hard assertions.
    for (const name of ['claim_audit', 'self_critique', 'proof_package', 'run_receipt', 'run_and_show']) {
      assert.equal(
        rowsFor(io, name).length,
        0,
        `no ${name} row for a no-tool conversational turn (got ${rowsFor(io, name).length})`,
      );
    }
    // Also no proof/audit sys_notice chatter under any other kind.
    const chatter = io.events.filter((e) => e.type === 'sys_notice' && /\[(?:claim audit|self-critique|proof|red→green|regression|mutation gate|fake-test gate)\]/i.test(e.text ?? ''));
    assert.equal(chatter.length, 0, `no audit/proof sys_notice chatter (got: ${chatter.map((e) => e.text).join('; ')})`);

    // ...but the ANSWER and the completion guarantees are untouched. We only
    // suppressed no-op success chatter — never an ERROR, FAIL or the answer.
    const finalText = io.events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
    assert.ok(finalText.includes('doing well'), `answer text still streamed (got: ${finalText.slice(0, 120)})`);
    assert.ok(io.events.some((e) => e.type === 'task_report'), 'task_report still emitted');
    assert.ok(io.events.some((e) => e.type === 'turn_end'), 'turn_end still emitted');
    assert.equal(io.events.filter((e) => e.type === 'error' || e.type === 'aborted').length, 0, 'no error/abort introduced');
  } finally {
    await mock.stop();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ============================================================
// WORK — write_file + test: the FULL audit/receipt is kept.
// ============================================================
test('v1118 WORK turn keeps claim_audit + proof_package + run_receipt', async () => {
  const { mock, ws, io, thrown } = await driveRun('work');
  try {
    assert.equal(thrown, null, `runAgent must not throw (got: ${thrown?.stack ?? thrown})`);

    assert.ok(rowsFor(io, 'claim_audit').length > 0, 'claim_audit still emitted for real work');
    assert.ok(rowsFor(io, 'proof_package').length > 0, 'proof_package still emitted for real work');
    assert.ok(io.events.some((e) => e.type === 'run_receipt'), 'run_receipt still emitted for real work');
    assert.ok(rowsFor(io, 'self_critique').length > 0, 'full self-critique notice kept for real work');
    assert.ok(io.events.some((e) => e.type === 'task_report'), 'task_report still emitted');

    const finalText = io.events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
    assert.ok(finalText.includes('proof-work.txt'), `final answer text emitted (got: ${finalText.slice(0, 120)})`);
    assert.ok(mock.requests.length >= 2, `>=2 real provider round-trips (got ${mock.requests.length})`);
  } finally {
    await mock.stop();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

after(() => {
  for (const k of ['SURNIA_TURN_RETRY_DELAYS_MS', 'SURNIA_DELTA_FLUSH_MS', 'SURNIA_HOME']) delete process.env[k];
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});
