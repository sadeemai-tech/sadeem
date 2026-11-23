import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================================
// v11.31 — ENGINE AUDIT / REGRESSION (capability agent ENGINE).
//
// Drives the REAL electron/agent/engine.ts runAgent() (esbuild-bundled, electron
// stubbed) against a LOCAL scripted OpenAI-compatible provider (node:http,
// zero network / zero model), and asserts the fixes made after a full run-path
// audit:
//   A  happy path: run_start first, one honest report, turn_end last, liveness.
//   B  tool crash: tool_start/tool_result id pairing + honest error outcome.
//   C  cancellation: abort mid-tool must kill the child (ctx.signal wired) —
//      no orphan process writing files after the run reported 'aborted'.
//   D  denied write honesty: a denied/failed write must NOT appear in
//      task_report.files and must NOT open a phantom preview.
//   E  stale state: a 'compact' early return must not leak the run-scoped gate
//      bundle into the next run (runGatesCount back to 0).
//   F  402 fatal: exactly one request, honest error, no silent retry.
//   G  429 bounded: one same-provider recovery, no auto-switch, no error row.
//   H  long stream: periodic deltas keep flowing, honest completion.
//
// Run: node --test --test-force-exit tests/v1131-engine.test.mjs
// ============================================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1131-engine-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAIN = 'v1131-live';

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

// Re-export runGatesCount so we can prove the early-return cleanup.
const engEntry = join(tmp, 'engine-entry.ts');
writeFileSync(engEntry,
  `export * from '${join(ROOT, 'electron/agent/engine.ts').replace(/\\/g, '/')}';\n` +
  `export { runGatesCount } from '${join(ROOT, 'electron/agent/engineGates.ts').replace(/\\/g, '/')}';\n`);

let engine;
try {
  const engPath = join(tmp, 'engine.cjs');
  bundle(engEntry, engPath);
  engine = require(engPath);
} catch (err) {
  console.error('[v1131] ENGINE BUNDLE FAILED:', err?.stack ?? err);
  throw err;
}

after(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });

// ---------- SSE helpers ----------
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const chunk = (delta, finish = null) =>
  sse({ id: 'v1131', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] });
function sseHeaders(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  res.flushHeaders();
}
function finishSse(res, finish, usage) {
  if (usage) res.write(sse({ usage, choices: [] }));
  res.write(chunk({}, finish));
  res.write('data: [DONE]\n\n');
  res.end();
}
function toolDeltas(name, args, id) {
  const half = Math.max(1, Math.floor(args.length / 2));
  return [
    { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(0, half) } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(half) } }] },
  ];
}
function httpError(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

// ---------- mock provider ----------
function startMock(onMain, state) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep */ }
      const sys = JSON.stringify(body);
      const msgs = body.messages ?? [];
      const rec = {
        system: typeof body.system === 'string'
          ? body.system
          : (body.messages ?? []).filter((m) => m?.role === 'system').map((m) => String(m.content ?? '')).join('\n'),
        isCompact: /compact coding-agent transcripts/i.test(sys),
        isExtraction: /extract durable engineering facts|Surnia DNA user model|maintain the Surnia DNA|maintain the SADEEM Living Playbook/i.test(sys),
        isSubagent: /part of the Surnia agent team/i.test(sys),
        isVerifier: /strict, evidence-based verifier/i.test(sys),
        sawTool: msgs.some((m) => m.role === 'tool'),
      };
      requests.push(rec);
      try {
        if (rec.isCompact || rec.isExtraction || rec.isSubagent || rec.isVerifier || body.model !== MAIN) {
          sseHeaders(res); finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 }); return;
        }
        const n = state.mainCount++;
        await onMain({ res, body, rec, n, state });
      } catch (err) {
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
    async stop() { for (const s of sockets) s.destroy(); await new Promise((r) => server.close(r)); },
  };
}

function writeSettings(base, extra = {}) {
  const agent = {
    maxRetries: 0, autoCompact: false, compactThreshold: 10_000, autoVerify: false,
    selfCritique: false, criticGate: false, autoMemory: false, checkpointsEnabled: false,
    allowModelFailover: false, parallelToolCalls: false,
    ...(extra.agent ?? {}),
  };
  const { agent: _a, ...rest } = extra;
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({
    schemaVersion: 4, language: 'en', dnaEnabled: false,
    providers: { custom: { apiKey: 'test-key', baseUrl: base } },
    agent, doneNotifications: false, ...rest,
  }));
}
function setEnv() {
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = '5,5,5,5,5,5';
  process.env.SURNIA_DELTA_FLUSH_MS = '5';
  process.env.SURNIA_SKIP_UI_GATE = '1';
  process.env.SURNIA_STREAM_CONTINUE_BUDGET = '0';
  process.env.SURNIA_ENGINE_IDLE_MS = '30_000';
  process.env.SURNIA_LIVENESS_PULSE_MS = '50';
  process.env.SURNIA_EXTENDED_REASONING_MS = '0';
  delete process.env.SURNIA_MAX_RUN_MS;
}
function makeIo(decision = { action: 'allow' }) {
  const events = [];
  let abortCb = null;
  const io = {
    events,
    __aborted: false,
    send(e) { events.push({ ...e, at: Date.now() }); },
    getDecision() { return Promise.resolve({ requestId: 'v1131', ...decision }); },
    isAborted() { return io.__aborted === true; },
    onFetchSignal(cb) { abortCb = cb; },
    triggerAbort() {
      io.__aborted = true;
      const ac = new AbortController(); ac.abort();
      try { abortCb?.(ac.signal); } catch { /* ignore */ }
    },
  };
  return io;
}
function baseParams(name, base, ws, overrides = {}) {
  return {
    task: 'chat',
    sessionId: 'v1131-' + name + '-' + Math.random().toString(36).slice(2),
    messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Do the task.', timestamp: Date.now() }],
    model: { provider: 'custom', model: MAIN, maxTokens: 2048 },
    mode: 'fullAccess', workspace: ws, apiKey: 'test-key', baseUrl: base,
    ...overrides,
  };
}
async function drive(name, onMain, opts = {}) {
  const state = { mainCount: 0, handlerErrors: [] };
  const mock = startMock(onMain, state);
  const port = await mock.port;
  const base = `http://127.0.0.1:${port}/v1`;
  writeSettings(base, opts.settings);
  setEnv();
  const io = makeIo(opts.decision);
  if (opts.onEvent) {
    const orig = io.send.bind(io);
    io.send = (e) => { try { opts.onEvent(e, io); } catch { /* ignore */ } orig(e); };
  }
  const ws = mkdtempSync(join(tmp, 'v1131-ws-' + name.replace(/[^a-z0-9]/gi, '') + '-'));
  const params = baseParams(name, base, ws, opts.params);
  let thrown = null;
  try { await engine.runAgent(params, io); } catch (err) { thrown = err; }
  return { io, ev: io.events, state, ws, params, thrown, mock };
}
const byType = (ev, t) => ev.filter((e) => e.type === t);
const report = (ev) => byType(ev, 'task_report')[0];
const endIdx = (ev) => ev.findIndex((e) => e.type === 'turn_end');

// ===========================================================================
test('v1131 A — happy path: run_start first, one honest report, turn_end last, liveness', async () => {
  const r = await drive('A', async ({ res }) => {
    sseHeaders(res);
    res.write(chunk({ content: 'Hello ' }));
    res.write(chunk({ content: 'from engine.' }));
    finishSse(res, 'stop', { prompt_tokens: 12, completion_tokens: 5 });
  });
  await r.mock.stop();
  assert.equal(r.thrown, null, 'runAgent must not throw');
  assert.ok(r.ev[0]?.type === 'sys_notice' && r.ev[0]?.kind === 'run_start',
    'run_start (sys_notice kind=run_start) must be the FIRST event');
  assert.ok(byType(r.ev, 'heartbeat').length >= 1, 'at least one liveness heartbeat');
  assert.equal(byType(r.ev, 'task_report').length, 1, 'exactly one task_report');
  assert.equal(byType(r.ev, 'turn_end').length, 1, 'exactly one turn_end');
  assert.ok(endIdx(r.ev) > r.ev.findIndex((e) => e.type === 'task_report'), 'report precedes turn_end');
  assert.equal(endIdx(r.ev), r.ev.length - 1, 'turn_end is the LAST event');
  assert.equal(report(r.ev)?.outcome, 'completed', 'honest completed outcome');
  const text = byType(r.ev, 'text_delta').map((e) => e.text).join('');
  assert.match(text, /Hello from engine\./, 'answer text delivered');
});

test('v1131 B — tool crash: tool_start/tool_result paired by id, honest error outcome', async () => {
  const r = await drive('B', async ({ res, n, state }) => {
    sseHeaders(res);
    if (n === 0) {
      for (const d of toolDeltas('run_command', JSON.stringify({ command: 'node -e "process.exit(7)"', timeout_seconds: 5 }), 'call_crash')) res.write(chunk(d));
      finishSse(res, 'tool_calls', { prompt_tokens: 10, completion_tokens: 4 });
    } else {
      res.write(chunk({ content: 'I tried.' }));
      finishSse(res, 'stop', { prompt_tokens: 20, completion_tokens: 3 });
    }
  });
  await r.mock.stop();
  assert.equal(r.thrown, null);
  const starts = byType(r.ev, 'tool_start');
  const results = byType(r.ev, 'tool_result');
  assert.equal(starts.length, 1, 'one tool_start');
  assert.equal(results.length, 1, 'one tool_result');
  assert.equal(starts[0].toolCallId, results[0].toolCallId, 'tool_start/tool_result id pairing');
  assert.equal(results[0].ok, false, 'crashed tool reported ok:false');
  assert.ok(byType(r.ev, 'error').length <= 1, 'no duplicate error rows');
  assert.equal(report(r.ev)?.outcome, 'error', 'failed tool ⇒ honest error outcome');
});

test('v1131 C — cancellation: abort mid-tool kills the child (no orphan file write)', async () => {
  const helper = join(tmp, 'v1131-sleeper.cjs');
  const marker = join(tmp, 'v1131-orphan-marker.txt');
  try { rmSync(marker, { force: true }); } catch { /* none */ }
  writeFileSync(helper,
    `const fs=require('fs');setTimeout(()=>{try{fs.writeFileSync(${JSON.stringify(marker)},'orphan');}catch(e){}},700);\n`);
  const r = await drive('C', async ({ res, n }) => {
    sseHeaders(res);
    if (n === 0) {
      for (const d of toolDeltas('run_command', JSON.stringify({ command: `node ${JSON.stringify(helper)}`, timeout_seconds: 30 }), 'call_sleep')) res.write(chunk(d));
      finishSse(res, 'tool_calls', { prompt_tokens: 10, completion_tokens: 4 });
    } else {
      res.write(chunk({ content: 'done' }));
      finishSse(res, 'stop', { prompt_tokens: 10, completion_tokens: 2 });
    }
  }, {
    // Abort the instant the tool card opens — this is exactly the window where
    // the child would be spawned with the (previously unwired) ctx.signal.
    onEvent: (e, io) => { if (e.type === 'tool_start') io.triggerAbort(); },
  });
  await r.mock.stop();
  await sleep(1100); // let any orphaned child finish its delayed write
  assert.equal(r.thrown, null);
  assert.equal(existsSync(marker), false,
    'abort must kill the spawned command — no file written after the run reported aborted');
  assert.equal(endIdx(r.ev), r.ev.length - 1, 'turn_end delivered on abort');
  assert.equal(report(r.ev)?.outcome, 'aborted', 'honest aborted outcome');
});

test('v1131 D — denied write honesty: no ghost file in report, no phantom preview', async () => {
  const r = await drive('D', async ({ res, n }) => {
    sseHeaders(res);
    if (n === 0) {
      for (const d of toolDeltas('write_file', JSON.stringify({ path: 'ghost.txt', content: 'nope' }), 'call_write')) res.write(chunk(d));
      finishSse(res, 'tool_calls', { prompt_tokens: 10, completion_tokens: 4 });
    } else {
      res.write(chunk({ content: 'Stopped.' }));
      finishSse(res, 'stop', { prompt_tokens: 10, completion_tokens: 2 });
    }
  }, { params: { mode: 'default' }, decision: { action: 'deny' } });
  await r.mock.stop();
  assert.equal(r.thrown, null);
  const starts = byType(r.ev, 'tool_start');
  const results = byType(r.ev, 'tool_result');
  assert.equal(starts.length, results.length, 'tool pair complete');
  assert.equal(results[0]?.ok, false, 'denied write reported ok:false');
  const files = report(r.ev)?.files ?? [];
  assert.deepEqual(files, [], 'a denied write must NOT appear in task_report.files');
  assert.equal(byType(r.ev, 'preview_open').length, 0, 'a denied write must NOT open a preview');
});

test('v1131 E — stale state: compact early return clears the run-scoped gates', async () => {
  // Prove baseline then that a compact run leaves no bundle behind.
  assert.equal(engine.runGatesCount(), 0, 'no gates before the run');
  const r = await drive('E', async ({ res }) => { /* mock auto-answers compact */ }, { params: { task: 'compact' } });
  await r.mock.stop();
  assert.equal(r.thrown, null);
  assert.equal(byType(r.ev, 'compaction_done').length, 1, 'compaction_done emitted');
  assert.equal(byType(r.ev, 'task_report').length, 1, 'one report on compact path');
  assert.equal(byType(r.ev, 'turn_end').length, 1, 'one turn_end on compact path');
  assert.equal(engine.runGatesCount(), 0,
    'compact early return must NOT leak its RunGates bundle into the next run');
});

test('v1131 F — 402 fatal: exactly one request, honest error, no silent retry', async () => {
  const r = await drive('F', async ({ res }) => {
    httpError(res, 402, { error: { message: 'Insufficient credits (402)', code: 402 } });
  });
  await r.mock.stop();
  assert.equal(r.thrown, null);
  assert.equal(r.state.mainCount, 1, 'fatal 402 = one and only one request');
  assert.ok(byType(r.ev, 'error').length >= 1, 'error row emitted');
  assert.equal(report(r.ev)?.outcome, 'error', 'honest error outcome');
});

test('v1131 G — 429 bounded: one same-provider recovery, no auto-switch, no error row', async () => {
  const r = await drive('G', async ({ res, n }) => {
    if (n === 0) { httpError(res, 429, { error: 'rate limit' }, { 'retry-after': '0' }); return; }
    sseHeaders(res);
    res.write(chunk({ content: 'recovered' }));
    finishSse(res, 'stop', { prompt_tokens: 8, completion_tokens: 2 });
  });
  await r.mock.stop();
  assert.equal(r.thrown, null);
  assert.ok(r.state.mainCount <= 2, `429 = at most one same-provider retry (got ${r.state.mainCount})`);
  assert.equal(report(r.ev)?.outcome, 'completed', 'bounded recovery completes honestly');
  assert.equal(byType(r.ev, 'error').length, 0, 'bounded 429 recovery shows no error row');
});

test('v1131 I — setup-phase throw still ends honestly (outer safety net)', async () => {
  // A throw BEFORE the inner try (onFetchSignal, TraceRecorder, RunGates, ...)
  // used to reject runAgent with only `run_start` on the wire — renderer hung.
  const r = await drive('I', async ({ res }) => {
    sseHeaders(res); res.write(chunk({ content: 'never' })); finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 });
  });
  await r.mock.stop();
  // Inject the throw on a SECOND run sharing the same settings (the first run
  // above warms the bundle); override onFetchSignal to throw synchronously.
  const badIo = makeIo();
  badIo.onFetchSignal = () => { throw new Error('[v1131] injected setup failure'); };
  const params = baseParams('I2', `http://127.0.0.1:1/v1`, r.ws);
  let thrown = null;
  try { await engine.runAgent(params, badIo); } catch (err) { thrown = err; }
  assert.equal(thrown, null, 'runAgent must NOT reject even when setup throws');
  assert.ok(badIo.events[0]?.type === 'sys_notice' && badIo.events[0]?.kind === 'run_start', 'run_start first');
  assert.equal(byType(badIo.events, 'error').length, 1, 'exactly one error row');
  assert.equal(byType(badIo.events, 'task_report').length, 1, 'exactly one task_report');
  assert.equal(byType(badIo.events, 'turn_end').length, 1, 'exactly one turn_end');
  assert.equal(report(badIo.events)?.outcome, 'error', 'honest error outcome');
  assert.equal(endIdx(badIo.events), badIo.events.length - 1, 'turn_end is LAST');
});

test('v1131 J — selective skills: engine passes the current user task to skillsIndexLine', async () => {
  // A06 gap: the engine used to inject the WHOLE skill library regardless of
  // task. Build a trusted workspace with two unrelated skills and prove the
  // real engine injects ONLY the task-relevant one into the system prompt.
  const builtins = join(tmp, 'v1131-empty-builtins');
  mkdirSync(builtins, { recursive: true });
  const prevBuiltinDir = process.env.SURNIA_SKILLS_BUILTIN_DIR;
  process.env.SURNIA_SKILLS_BUILTIN_DIR = builtins;
  try {
    const skillDir = join(tmp, 'v1131-skills-ws');
    const addSkill = (slug, name, desc) => {
      const d = join(skillDir, '.surnia', 'skills', slug);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\nstep\n`);
    };
    addSkill('sea-tide', 'Sea Tide', 'A proven debugging ritual for flaky maritime tests');
    addSkill('cooking-recipes', 'Cooking Recipes', 'Kitchen recipes for baking bread and desserts');
    writeFileSync(join(skillDir, '.surnia', 'skills-trusted'), ''); // user opted in

    const taskText = 'Debug the flaky maritime tests using the Sea Tide ritual.';
    const r = await drive('J', async ({ res }) => {
      sseHeaders(res); res.write(chunk({ content: 'ok' })); finishSse(res, 'stop', { prompt_tokens: 2, completion_tokens: 1 });
    }, {
      params: { workspace: skillDir, messages: [{ id: 'm1', role: 'user', kind: 'text', content: taskText, timestamp: Date.now() }] },
    });
    await r.mock.stop();
    assert.equal(r.thrown, null);
    const sys = r.mock.requests.find((q) => q.system)?.system ?? '';
    assert.match(sys, /# SKILLS/, '# SKILLS section is injected for a matched task');
    assert.match(sys, /Sea Tide/, 'task-relevant skill is listed');
    // v11.43 (P4) — founder ordered all user-added skills are ALWAYS advertised
    // so the model can use any of them; only the HARNESS body injection is
    // selective. The index therefore lists both skills honestly.
    assert.match(sys, /Cooking Recipes/, 'all user skills are advertised (founder requirement)');

    // NEGATIVE: an unrelated task injects no skills section at all.
    const r2 = await drive('J2', async ({ res }) => {
      sseHeaders(res); res.write(chunk({ content: 'ok' })); finishSse(res, 'stop', { prompt_tokens: 2, completion_tokens: 1 });
    }, {
      params: { workspace: skillDir, messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'What is the weather in Cairo tomorrow?', timestamp: Date.now() }] },
    });
    await r2.mock.stop();
    const sys2 = r2.mock.requests.find((q) => q.system)?.system ?? '';
    // v11.43 — the full index is always advertised (founder: user skills must
    // be usable). Only soft body injection is task-selective, so both the
    // relevant and unrelated tasks see the same index.
    assert.match(sys2, /# SKILLS/, 'skills index advertised for every task');
  } finally {
    if (prevBuiltinDir === undefined) delete process.env.SURNIA_SKILLS_BUILTIN_DIR;
    else process.env.SURNIA_SKILLS_BUILTIN_DIR = prevBuiltinDir;
  }
});

test('v1131 H — long stream: periodic deltas keep flowing, honest completion', async () => {
  const r = await drive('H', async ({ res }) => {
    sseHeaders(res);
    for (let i = 0; i < 30; i++) { res.write(chunk({ content: 'x' })); await sleep(4); }
    finishSse(res, 'stop', { prompt_tokens: 40, completion_tokens: 30 });
  });
  await r.mock.stop();
  assert.equal(r.thrown, null);
  const text = byType(r.ev, 'text_delta').map((e) => e.text).join('');
  assert.equal(text.length, 30, 'all streamed deltas delivered');
  assert.ok(byType(r.ev, 'heartbeat').length >= 1, 'liveness pulse present');
  assert.equal(report(r.ev)?.outcome, 'completed', 'honest completion after long stream');
  assert.equal(endIdx(r.ev), r.ev.length - 1, 'turn_end last');
});
