import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// v11.21 — PERFORMANCE / "INSTANT ACTIVITY" regression suite.
//
// The founder's complaint: "أداء التطبيق بالكامل، اجعلها أسرع، سلاسة أكثر"
// and specifically the delay BEFORE the agent starts. This suite locks in the
// two guarantees that kill that blank screen:
//
//   1. SOURCE ORDER — `sys_notice/run_start` is the first statement of
//      runAgent (after a param guard), ahead of ALL MCP / settings / DNA /
//      transcript / tool-definition work, with no await or IO before it.
//   2. RUNTIME ORDER — against a REAL bundled engine + a local scripted
//      provider with an ARTIFICIAL delay, `run_start` is literally the first
//      event to reach the IO (within a tiny budget), and the quiet liveness
//      pulse actually fires during the pre-token window and STOPS on the
//      first real delta (no leak, no overlap).
//   3. SETTINGS CACHE — `settingsOnce()` caches only the storeService MODULE
//      handle (value is re-read on every call), the settings snapshot is
//      per-run, and the failover gate bypasses the snapshot with a fresh read
//      so a test's (or user's) settings write is never masked by a stale
//      forever-cache.
//
// Run:
//   node --test --test-force-exit tests/v1121-perf.test.mjs
// Debug:
//   V1121_DEBUG=1 node --test --test-force-exit tests/v1121-perf.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1121-perf-'));

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
    shell: {}, screen: {}, powerMonitor: { on() {} },
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
  console.error('[v1121] ENGINE BUNDLE FAILED:', err?.message ?? err);
  throw err;
}

// ============================================================
// (1) SOURCE-LEVEL ORDER + CACHE-SHAPE ASSERTIONS
// ============================================================
test('v1121 source: run_start is the first statement of runAgent, before MCP/settings/tools, with no await/IO ahead of it', () => {
  const src = readFileSync(join(ROOT, 'electron/agent/engine.ts'), 'utf8');
  // v11.31 — runAgent is now a thin outer safety-net wrapper; the run itself
  // (including the FIRST visible event) lives in runAgentImpl.
  const ra = src.indexOf('async function runAgentImpl');
  assert.ok(ra >= 0, 'runAgentImpl exists');

  const guardIdx = src.indexOf('if (!params || !io) return;', ra);
  const startIdx = src.indexOf("kind: 'run_start'", ra);
  assert.ok(guardIdx > ra && startIdx > guardIdx, 'param guard precedes the run_start notice');

  // Nothing between the function entry and run_start may perform IO or await.
  // Strip comments first — the explanatory comments themselves name these words.
  const prefix = src.slice(ra, startIdx)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  for (const forbidden of ['await', 'settingsOnce()', 'getSettings()', 'mcpListTools', 'getToolDefs', 'fsSync.', 'fs.', 'require(']) {
    assert.ok(!prefix.includes(forbidden), `no "${forbidden}" before run_start (found in the pre-notice prefix)`);
  }

  // Heavy setup MUST come after the notice.
  const mcpIdx = src.indexOf('mcpListTools(server)', ra);
  const settingsIdx = src.indexOf('const settingsSnapshot: AppSettings = settingsOnce();', ra);
  const toolDefsIdx = src.indexOf('getToolDefs(enabledMcp', ra);
  const streamIdx = src.indexOf('await streamTurn(', ra);
  assert.ok(startIdx < mcpIdx, `run_start (${startIdx}) before MCP discovery (${mcpIdx})`);
  assert.ok(startIdx < settingsIdx, `run_start (${startIdx}) before settings snapshot (${settingsIdx})`);
  assert.ok(startIdx < toolDefsIdx, `run_start (${startIdx}) before tool defs (${toolDefsIdx})`);
  assert.ok(startIdx < streamIdx, `run_start (${startIdx}) before the provider stream (${streamIdx})`);
});

test('v1121 source: liveness pulse is ≤1.5s, fires on a single timer and stops on first delta / finally', () => {
  const src = readFileSync(join(ROOT, 'electron/agent/engine.ts'), 'utf8');
  assert.ok(/const LIVENESS_PULSE_MS = 1_500;/.test(src), 'cadence constant is 1.5s');
  // Env override is capped at the 1.5s contract and floored (never spins).
  assert.ok(/export function livenessPulseMs\(\)/.test(src), 'cadence is env-tunable for tests/ops');
  assert.ok(/Math\.min\(LIVENESS_PULSE_MS, Math\.floor\(raw\)\)/.test(src), 'override never exceeds 1.5s');
  // ONE interval, cleared on stop; guarded against double-stop / overlap.
  assert.ok(src.includes('setInterval(() => {'), 'a single setInterval drives the pulse');
  assert.ok(src.includes('}, livenessPulseMs());'), 'interval uses the bounded cadence');
  assert.ok(src.includes('if (livenessTimer) {') && src.includes('clearInterval(livenessTimer);'), 'stopLiveness clears the interval');
  assert.ok(src.includes('if (firstVisibleDeltaAt) return;'), 'markFirstDelta is idempotent (no overlapping timers)');
  assert.ok(src.includes('markFirstDelta(); // v11.21 — real delta: stop the setup pulse'), 'text delta stops the pulse');
  assert.ok(src.includes('markFirstDelta(); // v11.21 — first real think_delta: stop the setup pulse'), 'think delta stops the pulse');
  const raIdx = src.indexOf('export async function runAgent');
  const cleanupIdx = src.indexOf('stopLiveness(); // v11.21 — never leak the pre-token heartbeat timer');
  assert.ok(cleanupIdx > raIdx, 'run-scope cleanup stops the pulse on every exit (no leak on throw/abort)');
  assert.ok(src.slice(cleanupIdx - 120, cleanupIdx).includes('} finally {'), 'the pulse stop lives inside the run finally block');
});

test('v1121 source: settings cache is per-run and the failover gate reads fresh (never a stale forever-cache)', () => {
  const src = readFileSync(join(ROOT, 'electron/agent/engine.ts'), 'utf8');
  // settingsOnce caches only the MODULE HANDLE; getSettings() is invoked on
  // every call, so its return value can never go stale.
  assert.ok(src.includes('let cachedStoreService:'), 'module handle is cached once');
  assert.ok(/function settingsOnce\(\)[\s\S]{0,320}return cachedStoreService\.getSettings\(\);/.test(src),
    'settingsOnce re-reads the value on every call (no frozen value cache)');
  // The snapshot is captured inside runAgent => per-run, not module-level.
  const ra = src.indexOf('async function runAgentImpl');
  const snapIdx = src.indexOf('const settingsSnapshot: AppSettings = settingsOnce();');
  assert.ok(snapIdx > ra, 'settings snapshot is captured per run, inside runAgent');
  // The failover gate — the exact place a test's settings write was missed —
  // bypasses the snapshot with a fresh getSettings() read.
  const failIdx = src.indexOf('const failoverSettings');
  assert.ok(failIdx > ra, 'failover gate lives inside the run');
  // v11.31 — the fresh read is `fullSettings()` (a single per-run snapshot
  // helper). It re-reads the store module on every call, so a settings write is
  // never masked by a frozen value; A01 switched the gate to this helper.
  assert.ok(/const failoverSettings\s*=\s*fullSettings\(\)/.test(src.slice(failIdx, failIdx + 80)),
    'failover gate reads fresh settings (fullSettings) so a write is never masked');
});

// ============================================================
// (2) RUNTIME ORDER — real engine, artificial provider delay
// ============================================================
const TOKEN = new Set(['text_delta', 'think_delta']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

// A single simple conversational turn, delayed ARTIFICIALLY before it streams.
const MOCK_DELAY_MS = 350;
let firstRequestAt = 0;
function startMock() {
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      if (!firstRequestAt) firstRequestAt = Date.now();
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.flushHeaders();
      // ARTIFICIAL DELAY: the provider is intentionally slow so the engine's
      // pre-token liveness window is exercised and observable.
      await sleep(MOCK_DELAY_MS);
      for (const t of ['Perf ', 'check.']) res.write(sseChunk({ content: t }));
      res.write(`data: ${JSON.stringify({ usage: { prompt_tokens: 8, completion_tokens: 4 }, choices: [] })}\n\n`);
      res.write(sseChunk({}, 'stop'));
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const listening = new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  return {
    port: listening,
    async stop() {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

function writeSettings(mockBase) {
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 4,
      providers: { custom: { apiKey: 'test-key', baseUrl: mockBase } },
      agent: { maxRetries: 0, autoCompact: false, autoVerify: false, selfCritique: false, runAndShow: false, criticGate: false, mutationGate: { enabled: false } },
      doneNotifications: false,
    }),
  );
}

function makeIo() {
  const events = [];
  return {
    events,
    send(e) {
      events.push({ type: e.type, kind: e.kind, phase: e.phase, at: Date.now(), text: e.text ?? e.message ?? '' });
    },
    async getDecision(requestId) { return { requestId, action: 'allow' }; },
    isAborted: () => false,
    onFetchSignal() {},
  };
}

function dump(io, t0) {
  return io.events.map((e) => `${String(e.at - t0).padStart(6)}ms  ${e.type}${e.kind ? '/' + e.kind : ''}${e.phase ? '/' + e.phase : ''}`).join('\n');
}

test('v1121 runtime: run_start is the first event; liveness pulse fires then stops on first delta', async () => {
  // livenessPulseMs() unit behavior: env override is bounded to the contract.
  process.env.SURNIA_LIVENESS_PULSE_MS = '80';
  assert.equal(typeof engine.livenessPulseMs, 'function', 'engine exports livenessPulseMs');
  assert.equal(engine.livenessPulseMs(), 80, 'override applied');
  process.env.SURNIA_LIVENESS_PULSE_MS = '9000';
  assert.equal(engine.livenessPulseMs(), 1500, 'override capped at the 1.5s contract');
  process.env.SURNIA_LIVENESS_PULSE_MS = '80'; // use the fast pulse for the run below

  const mock = startMock();
  const port = await mock.port;
  const mockBase = `http://127.0.0.1:${port}/v1`;
  writeSettings(mockBase);
  const io = makeIo();
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = '5,5,5,5,5,5';
  process.env.SURNIA_DELTA_FLUSH_MS = '10';
  process.env.SURNIA_HOME = userDataDir;
  firstRequestAt = 0;

  const t0 = Date.now();
  let thrown = null;
  try {
    await engine.runAgent({
      task: 'chat',
      sessionId: 'v1121-perf-' + Math.random().toString(36).slice(2),
      messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Just say hello.', timestamp: t0 }],
      model: { provider: 'custom', model: 'perf-live', maxTokens: 512 },
      mode: 'fullAccess',
      workspace: mkdtempSync(join(tmpdir(), 'surnia-v1121-ws-')),
      apiKey: 'test-key',
      baseUrl: mockBase,
    }, io);
  } catch (err) {
    thrown = err;
  }

  if (process.env.V1121_DEBUG) console.error(`\n===== v1121 TIMELINE =====\n${dump(io, t0)}`);
  try {
    assert.equal(thrown, null, `runAgent must not throw (got: ${thrown?.stack ?? thrown})`);
    const events = io.events;
    assert.ok(events.length > 0, 'engine emitted events');

    // run_start is LITERALLY the first event — before MCP/settings/tool work.
    assert.equal(events[0].type, 'sys_notice', `first event is sys_notice (got ${events[0].type})`);
    assert.equal(events[0].kind, 'run_start', `first event is run_start (got ${events[0].kind})`);
    const startLatency = events[0].at - t0;
    console.error(`v1121: time-to-first-visible-event (run_start) = ${startLatency}ms; provider request at ${firstRequestAt - t0}ms; first delta at ${(events.find((e) => TOKEN.has(e.type))?.at ?? t0) - t0}ms`);
    assert.ok(startLatency <= 200, `run_start within 200ms of entry (got ${startLatency}ms) — no blocking work before it`);
    assert.ok(firstRequestAt > 0 && events[0].at < firstRequestAt, 'run_start precedes the provider request (which is issued after all setup)');

    // Liveness pulse: at least one timer-driven 'preparing' heartbeat after the
    // initial one AND strictly before the first real delta (artificial delay).
    const firstDelta = events.find((e) => TOKEN.has(e.type));
    assert.ok(firstDelta, 'a real delta arrived');
    const preparing = events.filter((e) => e.type === 'heartbeat' && e.phase === 'preparing');
    assert.ok(preparing.length >= 2, `liveness timer fired (got ${preparing.length} preparing heartbeats, expected ≥2)`);
    assert.ok(preparing.some((e) => e.at > events[0].at + 20 && e.at < firstDelta.at),
      'a timer pulse lands inside the pre-token window');

    // Timer STOPPED on first delta: no 'preparing' pulse after it (no leak /
    // overlap). Any later heartbeat is the separate 'streaming'/'compacting' one.
    const afterDelta = preparing.filter((e) => e.at > firstDelta.at);
    assert.equal(afterDelta.length, 0, `no pre-token pulse after the first delta (got ${afterDelta.length}) — timer stopped`);

    // Completion guarantees intact.
    assert.ok(events.some((e) => e.type === 'task_report'), 'task_report emitted');
    assert.ok(events.some((e) => e.type === 'turn_end'), 'turn_end emitted');
    assert.equal(events.filter((e) => e.type === 'error' || e.type === 'aborted').length, 0, 'no error/abort');
  } finally {
    await mock.stop();
  }
});

after(() => {
  for (const k of ['SURNIA_LIVENESS_PULSE_MS', 'SURNIA_TURN_RETRY_DELAYS_MS', 'SURNIA_DELTA_FLUSH_MS', 'SURNIA_HOME']) delete process.env[k];
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});
