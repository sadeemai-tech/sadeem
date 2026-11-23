import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// v11.24 — FIRST-TOKEN LATENCY regression suite.
//
// The founder's complaint: "الذكاء الاصطناعي بيتاخر بالرد" — the delay is NOT
// the run_start event (already ~6-13ms), it is the time to the FIRST TOKEN.
// Measured in this tree before the fix: run_start=6ms but the provider request
// was issued at 3351ms and the first delta arrived at 4151ms. A ~4.8s
// synchronous block (machineCapabilitySummaryNow → node:sqlite load + 21 spawn
// probes) sat on the first-token path. After the fix: request=150ms,
// first delta=509ms (a 350ms ARTIFICIAL provider delay + ~9ms overhead).
//
// HARD ASSERTIONS:
//   1. run_start is emitted before any await / IO (source + runtime order).
//   2. With a delayed mock, the first text_delta reaches the IO within a
//      bounded time of the provider RESPONSE HEADERS (no engine-side stall),
//      and the provider request itself is issued promptly after run_start.
//   3. storeService.getSettings() performs at most ONE disk read per run
//      (mtime cache + per-run snapshot); no 17× duplicate reads.
//   4. A 402 is FATAL on the first response — exactly ONE HTTP request, no
//      silent retry, no auto-switch.
//
// Run: node --test --test-force-exit tests/v1124-latency.test.mjs
// Debug: V1124_DEBUG=1 node --test --test-force-exit tests/v1124-latency.test.mjs
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
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1124-latency-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${out}`, '--external:electron', '--external:@xterm/xterm',
    '--external:@xterm/addon-fit', '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

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
  console.error('[v1124] ENGINE BUNDLE FAILED:', err?.message ?? err);
  throw err;
}

const TOKEN = new Set(['text_delta', 'think_delta']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

/**
 * Mock provider that records REQUEST arrival, RESPONSE-HEADER flush, and can
 * ARTIFICIALLY DELAY the first token — the exact shape needed to prove the
 * engine adds no stall between headers and the first visible delta.
 */
function startMock({ firstTokenDelayMs = 0, status = 200 } = {}) {
  const requests = [];
  let headersAt = 0;
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const at = Date.now();
      requests.push({ at, model: (() => { try { return JSON.parse(raw).model; } catch { return '?'; } })() });
      if (status !== 200) {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Insufficient credits', code: 402 } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.flushHeaders();
      headersAt = Date.now();
      if (firstTokenDelayMs) await sleep(firstTokenDelayMs);
      res.write(sseChunk({ content: 'Hello ' }));
      res.write(sseChunk({ content: 'from the delayed mock.' }));
      res.write(`data: ${JSON.stringify({ usage: { prompt_tokens: 9, completion_tokens: 6 }, choices: [] })}\n\n`);
      res.write(sseChunk({}, 'stop'));
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const listening = new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  return {
    requests,
    get headersAt() { return headersAt; },
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
    send(e) { events.push({ type: e.type, kind: e.kind, phase: e.phase, at: Date.now(), text: e.text ?? e.message ?? '' }); },
    async getDecision(requestId) { return { requestId, action: 'allow' }; },
    isAborted: () => false,
    onFetchSignal() {},
  };
}

function dump(io, t0) {
  return io.events.map((e) => `${String(e.at - t0).padStart(6)}ms  ${e.type}${e.kind ? '/' + e.kind : ''}${e.phase ? '/' + e.phase : ''}  ${String(e.text).slice(0, 60)}`).join('\n');
}

async function drive(mock, { withSettings = true } = {}) {
  const port = await mock.port;
  const mockBase = `http://127.0.0.1:${port}/v1`;
  if (withSettings) writeSettings(mockBase);
  const ws = mkdtempSync(join(tmpdir(), 'surnia-v1124-ws-'));
  const io = makeIo();
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = '5,5,5,5,5,5';
  process.env.SURNIA_DELTA_FLUSH_MS = '10';
  process.env.SURNIA_HOME = userDataDir;
  const t0 = Date.now();
  let thrown = null;
  try {
    await engine.runAgent({
      task: 'chat',
      sessionId: 'v1124-' + Math.random().toString(36).slice(2),
      messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Just say hello.', timestamp: t0 }],
      model: { provider: 'custom', model: 'v1124-live', maxTokens: 512 },
      mode: 'fullAccess',
      workspace: ws,
      apiKey: 'test-key',
      baseUrl: mockBase,
    }, io);
  } catch (err) { thrown = err; }
  return { io, t0, thrown, ws };
}

// ============================================================
// (1) SOURCE ORDER — run_start before any await / IO.
// ============================================================
test('v1124 source: run_start precedes every await/IO; no cold capability probe on the run path', () => {
  const src = readFileSync(join(ROOT, 'electron/agent/engine.ts'), 'utf8');
  // v11.31 — run_start lives in runAgentImpl (runAgent is an outer safety net).
  const ra = src.indexOf('async function runAgentImpl');
  assert.ok(ra >= 0, 'runAgentImpl exists');
  const guard = src.indexOf('if (!params || !io) return;', ra);
  const start = src.indexOf("kind: 'run_start'", ra);
  assert.ok(guard > ra && start > guard, 'guard then run_start');
  const prefix = src.slice(ra, start).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const forbidden of ['await', 'getSettings()', 'mcpListTools', 'getToolDefs', 'machineCapabilitySummaryNow', 'fsSync.', 'fs.', 'require(']) {
    assert.ok(!prefix.includes(forbidden), `no "${forbidden}" before run_start`);
  }
  // The cold capability probe (node:sqlite load + 21 spawns) must NOT be called
  // from the run path at all — not before the request, not deferred to finally.
  // It is available on demand through the `env_probe` tool instead.
  const runBody = src.slice(ra).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!runBody.includes('machineCapabilitySummaryNow('), 'no cold capability probe anywhere in runAgent');
});

// ============================================================
// (2) RUNTIME — first token bounded from provider HEADERS, request prompt.
// ============================================================
test('v1124 runtime: run_start first; provider request prompt; first text_delta bounded from headers', async () => {
  const MOCK_DELAY = 250;
  const mock = startMock({ firstTokenDelayMs: MOCK_DELAY });
  const { io, t0, thrown, ws } = await drive(mock);
  try {
    if (process.env.V1124_DEBUG) console.error(`\n===== v1124 TIMELINE =====\n${dump(io, t0)}`);
    assert.equal(thrown, null, `runAgent must not throw (got: ${thrown?.stack ?? thrown})`);
    const events = io.events;
    assert.ok(events.length > 0, 'events emitted');

    // run_start is literally the first event.
    assert.equal(events[0].type, 'sys_notice', 'first event is sys_notice');
    assert.equal(events[0].kind, 'run_start', 'first event is run_start');
    const startLatency = events[0].at - t0;
    assert.ok(startLatency <= 200, `run_start within 200ms (got ${startLatency}ms)`);

    // The provider request is issued promptly — the regression that cost ~3.3s.
    const reqAt = mock.requests[0]?.at;
    assert.ok(reqAt != null, 'provider request reached the mock');
    const requestLag = reqAt - t0;
    console.error(`v1124: run_start=${startLatency}ms, provider-request=${requestLag}ms, headers=${mock.headersAt - t0}ms`);
    assert.ok(requestLag <= 1500, `provider request within 1.5s of run entry (got ${requestLag}ms) — no synchronous first-token blocker`);

    // First real delta must arrive within a bounded time of the RESPONSE HEADERS.
    const first = events.find((e) => TOKEN.has(e.type));
    assert.ok(first, 'a real delta arrived');
    const headerToFirst = first.at - mock.headersAt;
    console.error(`v1124: headers→firstToken=${headerToFirst}ms (artificial provider delay=${MOCK_DELAY}ms)`);
    assert.ok(headerToFirst >= 0, 'first delta cannot precede provider headers');
    // 350ms headroom covers the artificial delay, the 10ms batch flush, IPC and
    // a shared-host scheduling wobble — but still fails the old ~4.8s stall.
    assert.ok(headerToFirst <= MOCK_DELAY + 350, `first token within ${MOCK_DELAY + 350}ms of headers (got ${headerToFirst}ms)`);
    assert.ok(events.some((e) => e.type === 'task_report'), 'completion report emitted');
  } finally {
    await mock.stop();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ============================================================
// (3) SETTINGS — no duplicate disk reads per run (mtime cache + snapshot).
// ============================================================
test('v1124 settings: at most one settings.json disk read per run (no 17× duplicate reads)', async () => {
  assert.equal(typeof engine.settingsDiskReadCountForTest, 'function', 'engine exposes a disk-read diagnostic');
  assert.equal(typeof engine.resetSettingsDiagnosticsForTest, 'function', 'engine exposes the diagnostic reset');
  const mock = startMock();
  // Warm-up run: sets cachedStoreService (the diagnostics handle) and writes
  // the settings file. Then a direct write bumps mtime so the measured run must
  // refill exactly once.
  const warm = await drive(mock);
  try {
    assert.equal(warm.thrown, null, `warm-up run must not throw (got ${warm.thrown?.stack ?? warm.thrown})`);
    writeSettings(`http://127.0.0.1:${await mock.port}/v1`); // bump mtime
    engine.resetSettingsDiagnosticsForTest();
    const measured = await drive(mock, { withSettings: false });
    try {
      assert.equal(measured.thrown, null, `measured run must not throw (got ${measured.thrown?.stack ?? measured.thrown})`);
      const diskReads = engine.settingsDiskReadCountForTest();
      const calls = engine.settingsCallCountForTest();
      console.error(`v1124 settings: diskReads=${diskReads}, getSettings() calls=${calls} for one run`);
      assert.ok(diskReads >= 0, 'diagnostics available in the bundled storeService');
      assert.ok(diskReads <= 1, `at most ONE settings.json disk read per run (got ${diskReads})`);
      assert.ok(calls >= 1 && calls <= 12, `settings reads bounded, no 17× storm (got ${calls})`);
    } finally {
      try { rmSync(measured.ws, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  } finally {
    await mock.stop();
    try { rmSync(warm.ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ============================================================
// (4) 402 — fatal on the FIRST response: exactly one request, no retry.
// ============================================================
test('v1124 402: exactly one provider request, fatal on first response, no auto-switch', async () => {
  const mock = startMock({ status: 402 });
  const { io, t0, thrown, ws } = await drive(mock);
  try {
    if (process.env.V1124_DEBUG) console.error(`\n===== v1124 402 TIMELINE =====\n${dump(io, t0)}`);
    assert.equal(thrown, null, `runAgent must not throw for a classified 402 (got: ${thrown?.stack ?? thrown})`);
    console.error(`v1124 402: provider requests=${mock.requests.length}`);
    assert.equal(mock.requests.length, 1, '402 = exactly ONE HTTP request (no silent retry / failover)');
    assert.ok(io.events.some((e) => e.type === 'error'), 'an error row is surfaced to the user');
    assert.ok(io.events.some((e) => e.type === 'task_report'), 'a terminal task_report is emitted');
    // 402 is deterministic, not "slow": never mislabel it with a slow-provider notice.
    assert.equal(io.events.filter((e) => e.kind === 'slow_provider').length, 0, '402 never gets a misleading slow-provider notice');
  } finally {
    await mock.stop();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

after(() => {
  for (const k of ['SURNIA_TURN_RETRY_DELAYS_MS', 'SURNIA_DELTA_FLUSH_MS', 'SURNIA_HOME']) delete process.env[k];
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});
