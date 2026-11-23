// ============================================================================
// v11.32 — AI REALITY GUARD (DIAGNOSIS + BEHAVIOUR TESTS)
//
// "Your code tests are fine, but user-experience testing is mine. When I say
//  something doesn't work, don't lean on your code tests, lean on what I say."
//
// This file does NOT grep source strings to declare victory. It boots the REAL
// electron/agent/engine.ts (esbuild-bundled, electron stubbed) against a LOCAL
// scripted OpenAI-compatible provider (node:http, zero network / zero model)
// and asserts what actually HAPPENED: files on disk, tool calls dispatched,
// corrective nudges injected into the transcript, loop breakers, long runs,
// verbatim tool output reaching the model, and MCP opt-in behaviour.
//
// The only source-level check is #7 (buildSystemPrompt Arabic output) because
// the founder's complaint there is literally about the prompt text produced.
//
// Run: node --test --test-force-exit tests/v1132-ai-reality.test.mjs
// ============================================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1132-reality-'));
const MAIN = 'v1132-reality-model';
const RESULTS = [];
const result = (id, pass, detail, gap = '') => {
  RESULTS.push({ id, pass: !!pass, detail, gap });
  console.log(`V1132_CHECK ${id} ${pass ? 'PASS' : 'FAIL'} :: ${detail}${gap ? ` :: GAP ${gap}` : ''}`);
};

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

const engEntry = join(tmp, 'engine-entry.ts');
writeFileSync(engEntry,
  `export * from '${join(ROOT, 'electron/agent/engine.ts').replace(/\\/g, '/')}';\n` +
  `export { mcpListTools, cachedToolsForEngine } from '${join(ROOT, 'electron/agent/mcp.ts').replace(/\\/g, '/')}';\n` +
  `export * as Prompt from '${join(ROOT, 'electron/agent/prompts.ts').replace(/\\/g, '/')}';\n`);

let engine;
let bundleError = null;
try {
  const engPath = join(tmp, 'engine.cjs');
  bundle(engEntry, engPath);
  engine = require(engPath);
} catch (err) {
  bundleError = String(err?.stack ?? err);
  console.error('[v1132] ENGINE BUNDLE FAILED:', bundleError);
}

after(() => {
  try { engine?.closeAllMcpClients?.(); engine?.stopMcpHealthMonitor?.(); } catch { /* best effort */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  try {
    writeFileSync(join(ROOT, 'tests', '.v1132-ai-reality.results.json'), JSON.stringify({
      at: new Date().toISOString(),
      bundleError,
      results: RESULTS,
    }, null, 2));
  } catch { /* best effort */ }
  console.log('V1132_SUMMARY ' + JSON.stringify(RESULTS.map((r) => ({ id: r.id, pass: r.pass }))));
});

// ---------- SSE helpers ----------
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const chunk = (delta, finish = null) =>
  sse({ id: 'v1132', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] });
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

// ---------- scripted provider ----------
// Main requests are identified by the REAL system prompt identity line. Every
// helper pass (compact / verifier / critic / memory / run-and-show) has a
// different system and is auto-answered here — so mainCount is exact.
const MAIN_IDENTITY = 'You are SADEEM, an expert engineering agent';
function startMock(onMain, state) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep */ }
      const sys = typeof body.system === 'string'
        ? body.system
        : (body.messages ?? []).filter((m) => m?.role === 'system').map((m) => String(m.content ?? '')).join('\n');
      const isMain = sys.includes(MAIN_IDENTITY);
      const msgs = body.messages ?? [];
      const rec = {
        isMain,
        system: sys,
        body,
        msgs,
        sawTool: msgs.some((m) => m.role === 'tool'),
      };
      requests.push(rec);
      try {
        if (!isMain || body.model !== MAIN) {
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
    allowModelFailover: false, parallelToolCalls: false, toolProfile: 'full',
    maxTurns: 100, continueAuto: true, maxContinueRounds: 5,
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
  process.env.SURNIA_MAX_RUN_MS = '0';
  delete process.env.SURNIA_MAX_RUN_MS; // default 5h cap is irrelevant in this short suite
}
function makeIo(opts = {}) {
  const events = [];
  let abortCb = null;
  const decisions = [];
  const io = {
    events, decisions,
    __aborted: false,
    send(e) { events.push({ ...e, at: Date.now() }); },
    getDecision() {
      const d = { requestId: 'v1132', ...(opts.decision ?? { action: 'allow' }) };
      decisions.push(d);
      return Promise.resolve(d);
    },
    isAborted() { return io.__aborted === true; },
    onFetchSignal(cb) { abortCb = cb; },
  };
  return io;
}
function baseParams(name, base, ws, overrides = {}) {
  return {
    task: 'chat',
    sessionId: 'v1132-' + name + '-' + Math.random().toString(36).slice(2),
    messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Do the task.', timestamp: Date.now() }],
    model: { provider: 'custom', model: MAIN, maxTokens: 2048, contextWindow: 200_000 },
    mode: 'fullAccess', workspace: ws, apiKey: 'test-key', baseUrl: base,
    taskMode: 'build',
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
  const io = makeIo(opts);
  const ws = mkdtempSync(join(tmp, 'v1132-ws-' + name.replace(/[^a-z0-9]/gi, '') + '-'));
  const params = baseParams(name, base, ws, opts.params);
  let thrown = null;
  try { await engine.runAgent(params, io); } catch (err) { thrown = err; }
  return { io, ev: io.events, state, ws, params, thrown, mock, requests: mock.requests };
}
const byType = (ev, t) => ev.filter((e) => e.type === t);
const report = (ev) => byType(ev, 'task_report')[0];
const mainRequests = (r) => r.requests.filter((q) => q.isMain);
const transcriptHas = (r, needle) => {
  const re = needle instanceof RegExp ? needle : new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return mainRequests(r).some((q) => re.test(JSON.stringify(q.msgs)));
};

// ===========================================================================
// 1 — TOOL USE: real file on disk, not a prose claim
// ===========================================================================
test('V1132/1 — TOOL USE (real file + no false success)', async () => {
  if (!engine) { result('toolExecution', false, 'engine bundle failed', 'test harness'); return; }
  // ---- 1a: provider emits a tool call; assert the file really appears ----
  const wsA = mkdtempSync(join(tmp, 'v1132-1a-'));
  const target = join(wsA, 'index.html');
  const targetFwd = target.replace(/\\/g, '/');
  const stateA = { mainCount: 0, handlerErrors: [] };
  const mockA = startMock(async ({ res, n }) => {
    sseHeaders(res);
    if (n === 0) {
      for (const d of toolDeltas('write_file', JSON.stringify({ path: targetFwd, content: '<!doctype html><title>V1132 REALITY</title>' }), 'call_html')) res.write(chunk(d));
      finishSse(res, 'tool_calls', { prompt_tokens: 10, completion_tokens: 4 });
    } else {
      res.write(chunk({ content: 'Done — index.html is on disk.' }));
      finishSse(res, 'stop', { prompt_tokens: 12, completion_tokens: 6 });
    }
  }, stateA);
  const portA = await mockA.port;
  writeSettings(`http://127.0.0.1:${portA}/v1`);
  setEnv();
  const ioA = makeIo();
  const paramsA = baseParams('1a', `http://127.0.0.1:${portA}/v1`, wsA);
  let thrownA = null;
  try { await engine.runAgent(paramsA, ioA); } catch (err) { thrownA = err; }
  await mockA.stop();
  const fileExists = existsSync(target);
  const fileContent = fileExists ? readFileSync(target, 'utf8') : '';
  const startsA = byType(ioA.events, 'tool_start');
  const resultsA = byType(ioA.events, 'tool_result');
  const execPass = fileExists && fileContent.includes('V1132 REALITY') &&
    startsA.some((e) => e.name === 'write_file') &&
    resultsA.some((e) => e.ok === true) && thrownA === null;
  result('toolExecution', execPass,
    `file=${fileExists} content=${fileContent.includes('V1132 REALITY')} tool_start=${startsA.length} tool_result_ok=${resultsA.some((e) => e.ok === true)}`,
    execPass ? '' : 'write_file tool call did not produce the real file');

  // ---- 1b: provider claims "done" with ZERO tool calls; expect a nudge ----
  const rB = await drive('1b', async ({ res }) => {
    sseHeaders(res);
    res.write(chunk({ content: 'Done — I created index.html for you.' }));
    finishSse(res, 'stop', { prompt_tokens: 8, completion_tokens: 5 });
  }, {
    params: {
      messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Create a tiny HTML file named index.html in the workspace.', timestamp: Date.now() }],
      taskMode: 'build',
    },
  });
  await rB.mock.stop();
  const mainB = mainRequests(rB);
  const nudged = mainB.length >= 2 && transcriptHas(rB, /agency gate|capability correction|TOOL USE IS MANDATORY|make ZERO tool calls|nothing exists on disk|you made ZERO tool/i);
  result('falseDoneNudge', nudged,
    `main provider requests=${mainB.length} (a corrective nudge re-calls the provider with corrective text)`,
    nudged ? '' : 'engine.ts end_turn gates: refusal recovery requires REFUSAL_RE, agency gate requires a >=7-line fenced code block, and the new HONEST_FINISH gate (~6268-6291) requires lastToolCallOk===false or a touched-but-missing file — a ZERO-tool "I created index.html" claim has neither, so no nudge and the lie is accepted as completed');
});

// ===========================================================================
// 2 — ERROR LOOP: 5 failing image_generate calls must be capped + redirected
// ===========================================================================
test('V1132/2 — ERROR LOOP: repeated failing tool is broken after 2', async () => {
  if (!engine) { result('errorLoop', false, 'engine bundle failed', 'test harness'); return; }
  const r = await drive('2', async ({ res, n }) => {
    sseHeaders(res);
    if (n < 6) {
      // Invalid extension ⇒ generateImage() fails INSTANTLY, no network.
      for (const d of toolDeltas('image_generate', JSON.stringify({ prompt: 'a red fox', dest: 'assets/reject.txt' }), 'call_img_' + n)) res.write(chunk(d));
      finishSse(res, 'tool_calls', { prompt_tokens: 10, completion_tokens: 4 });
    } else {
      res.write(chunk({ content: 'I could not generate the image.' }));
      finishSse(res, 'stop', { prompt_tokens: 10, completion_tokens: 3 });
    }
  });
  await r.mock.stop();
  const imgStarts = byType(r.ev, 'tool_start').filter((e) => e.name === 'image_generate');
  const redirected = transcriptHas(r, /failed twice|STOP calling it|DIFFERENT tool|switch approach|change your approach|doom loop stopped/i) ||
    byType(r.ev, 'doom_loop').length > 0;
  const pass = imgStarts.length <= 2 && redirected;
  result('errorLoop', pass,
    `image_generate calls=${imgStarts.length} (must be <=2), redirect=${redirected}, doom_loop_events=${byType(r.ev, 'doom_loop').length}`,
    pass ? '' : 'U1 breaker (engine.ts ~6019-6051) injects a corrective AFTER the 2nd failure but does NOT block dispatch — it is advice, not a cap. A weak provider can emit 5+ identical failing calls and the engine executes every one; the doom gate (~threshold 3) auto-proceeds in fullAccess. Redirect happened, cap did not.');
});

// ===========================================================================
// 3 — LONG RUN: 60 tool rounds, no silent cap
// ===========================================================================
test('V1132/3 — LONG RUN: 60 tool rounds continue to a real finish', async () => {
  if (!engine) { result('longRun', false, 'engine bundle failed', 'test harness'); return; }
  const TOTAL = 60;
  const r = await drive('3', async ({ res, n }) => {
    sseHeaders(res);
    if (n < TOTAL) {
      const cmd = `node -e "process.stdout.write('R${n}')"`;
      for (const d of toolDeltas('run_command', JSON.stringify({ command: cmd, timeout_seconds: 5 }), 'call_round_' + n)) res.write(chunk(d));
      finishSse(res, 'tool_calls', { prompt_tokens: 6, completion_tokens: 3 });
    } else {
      res.write(chunk({ content: '60 rounds done.' }));
      finishSse(res, 'stop', { prompt_tokens: 10, completion_tokens: 3 });
    }
  });
  await r.mock.stop();
  const cmdStarts = byType(r.ev, 'tool_start').filter((e) => e.name === 'run_command');
  const text = byType(r.ev, 'text_delta').map((e) => e.text).join('');
  const pass = cmdStarts.length >= TOTAL && text.includes('60 rounds done.') && !r.thrown;
  result('longRun', pass,
    `run_command rounds=${cmdStarts.length}/${TOTAL}, final text=${JSON.stringify(text.slice(0, 60))}, thrown=${r.thrown ? String(r.thrown.message) : 'null'}`,
    pass ? '' : 'engine silent step cap / continuation gate ended the run before the model finished');
});

// ===========================================================================
// 4 — WEB + COMMAND: real loopback result reaches the model verbatim
// ===========================================================================
test('V1132/4 — WEB/COMMAND: loopback fetch + command output reach the model', async () => {
  if (!engine) { result('webCommand', false, 'engine bundle failed', 'test harness'); return; }
  const WEB_SENTINEL = 'V1132_WEB_SENTINEL_7f3a';
  const CMD_SENTINEL = 'V1132_CMD_SENTINEL_9c1d';
  const pageServer = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<html><head><title>Probe</title></head><body><p>${WEB_SENTINEL}</p></body></html>`);
  });
  const pagePort = await new Promise((resolve) => pageServer.listen(0, '127.0.0.1', () => resolve(pageServer.address().port)));
  const r = await drive('4', async ({ res, n }) => {
    sseHeaders(res);
    if (n === 0) {
      for (const d of toolDeltas('web_fetch', JSON.stringify({ url: `http://127.0.0.1:${pagePort}/probe` }), 'call_web')) res.write(chunk(d));
      finishSse(res, 'tool_calls', { prompt_tokens: 8, completion_tokens: 3 });
    } else if (n === 1) {
      const cmd = `node -e "process.stdout.write('${CMD_SENTINEL}')"`;
      for (const d of toolDeltas('run_command', JSON.stringify({ command: cmd, timeout_seconds: 5 }), 'call_cmd')) res.write(chunk(d));
      finishSse(res, 'tool_calls', { prompt_tokens: 8, completion_tokens: 3 });
    } else {
      res.write(chunk({ content: 'Fetched and ran.' }));
      finishSse(res, 'stop', { prompt_tokens: 8, completion_tokens: 3 });
    }
  }, { params: { mode: 'fullAccess' } });
  await r.mock.stop();
  await new Promise((resolve) => pageServer.close(resolve));
  const webResult = byType(r.ev, 'tool_result').find((e) => e.toolCallId === 'call_web');
  const cmdResult = byType(r.ev, 'tool_result').find((e) => e.toolCallId === 'call_cmd');
  const webToModel = transcriptHas(r, WEB_SENTINEL);
  const cmdToModel = transcriptHas(r, CMD_SENTINEL);
  const pass = webResult?.ok === true && webToModel && cmdResult?.ok === true && cmdToModel;
  result('webCommand', pass,
    `web_fetch_ok=${webResult?.ok} web_sentinel_in_model=${webToModel} run_command_ok=${cmdResult?.ok} cmd_sentinel_in_model=${cmdToModel}`,
    pass ? '' : 'tools.ts webFetch guard (tools.ts ~3218-3284, isBlockedHost ~4403-4432) can reject loopback outside fullAccess; or tool output is pruned/rewritten before the next model turn');
});

// ===========================================================================
// 5 — MCP OPT-IN: is there ANY gate for an unprompted MCP call?
// ===========================================================================
test('V1132/5 — MCP OPT-IN: unprompted MCP tool call is gated', async () => {
  if (!engine) { result('mcpOptIn', false, 'engine bundle failed', 'test harness'); return; }
  const marker = join(tmp, 'v1132-mcp-marker.txt');
  try { rmSync(marker, { force: true }); } catch { /* none */ }
  const fixture = join(tmp, 'v1132-mcp-server.cjs');
  writeFileSync(fixture, `
const readline = require('node:readline');
const fs = require('node:fs');
const marker = process.env.V1132_MCP_MARKER;
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined || m.id === null || !m.method) return;
  let result;
  if (m.method === 'initialize') result = { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'v1132-probe', version: '1.0.0' } };
  else if (m.method === 'tools/list') result = { tools: [{ name: 'unprompted_probe', description: 'Probe: writes a marker to prove unprompted MCP execution', inputSchema: { type: 'object', properties: {} } }] };
  else if (m.method === 'tools/call') { try { fs.writeFileSync(marker, 'MCP_CALLED'); } catch {} result = { content: [{ type: 'text', text: 'MCP_PROBE_OK' }], isError: false }; }
  else result = {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
});
`);
  const mcpCfg = {
    id: 'v1132-probe', name: 'v1132probe', command: process.execPath,
    args: [fixture], enabled: true, env: { V1132_MCP_MARKER: marker }, timeoutMs: 3000,
  };
  // Direct protocol probe (diagnostic): prove the fixture speaks MCP at all.
  let mcpProbe = 'n/a';
  try {
    const listed = await engine.mcpListTools?.(mcpCfg);
    mcpProbe = JSON.stringify({ ok: listed?.ok, names: (listed?.tools ?? []).map((t) => t.name), error: listed?.error });
  } catch (err) { mcpProbe = 'threw ' + String(err?.message ?? err); }
  console.log('# V1132 MCP_PROBE ' + mcpProbe);

  // Warm-up: MCP discovery is fire-and-forget, so a cold server is absent from
  // the FIRST provider request. One no-op run caches its tools for the next.
  const warm = await drive('5warm', async ({ res }) => {
    sseHeaders(res);
    res.write(chunk({ content: 'ready' }));
    finishSse(res, 'stop', { prompt_tokens: 2, completion_tokens: 1 });
  }, { params: { mcpServers: [mcpCfg] } });
  await warm.mock.stop();

  const r = await drive('5', async ({ res, n }) => {
    sseHeaders(res);
    if (n === 0) {
      for (const d of toolDeltas('mcp__v1132probe__unprompted_probe', '{}', 'call_mcp')) res.write(chunk(d));
      finishSse(res, 'tool_calls', { prompt_tokens: 8, completion_tokens: 3 });
    } else {
      res.write(chunk({ content: 'Done.' }));
      finishSse(res, 'stop', { prompt_tokens: 8, completion_tokens: 2 });
    }
  }, {
    params: {
      // The user NEVER mentioned MCP or this server.
      messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'List the files in the workspace.', timestamp: Date.now() }],
      mcpServers: [mcpCfg],
    },
  });
  await r.mock.stop();
  const executed = existsSync(marker);
  const approvals = byType(r.ev, 'approval_request').filter((e) => e.kind === 'mcp');
  const gateNotices = byType(r.ev, 'sys_notice').filter((e) => /opt-in|not asked|unprompted|MCP/i.test(String(e.text ?? '')));
  const mcpStarts = byType(r.ev, 'tool_start').filter((e) => /mcp/i.test(String(e.name ?? '')));
  const mcpResults = byType(r.ev, 'tool_result').filter((e) => /mcp/i.test(String(e.toolCallId ?? '')));
  const advertised = mainRequests(r).some((q) => JSON.stringify(q.body?.tools ?? []).includes('unprompted_probe'));
  const toolsDiag = mainRequests(r)[0]
    ? JSON.stringify({ keys: Object.keys(mainRequests(r)[0].body ?? {}), toolCount: (mainRequests(r)[0].body?.tools ?? []).length, tools: (mainRequests(r)[0].body?.tools ?? []).map((t) => t?.function?.name ?? t?.name).filter((n) => /mcp/i.test(String(n))) })
    : 'no main request';
  // A real gate test REQUIRES the tool to exist. If MCP discovery failed, the
  // "no execution" result is meaningless — report it as INCONCLUSIVE, not PASS.
  const pass = advertised && (approvals.length > 0 || gateNotices.length > 0 || (!executed && mcpStarts.length > 0));
  result('mcpOptIn', pass,
    `advertised=${advertised} toolsDiag=${toolsDiag} mcp_tool_start=${mcpStarts.length} mcp_tool_result=${mcpResults.length} executed=${executed} mcp_approval_requests=${approvals.length} gate_notices=${gateNotices.length} notices=${JSON.stringify(byType(r.ev, 'sys_notice').map((e) => String(e.text ?? '').slice(0, 90)))}`,
    advertised
      ? (pass ? '' : 'no opt-in gate: prompts.ts says "MCP IS OPT-IN" but engine.ts auto-approves kind:mcp in fullAccess (shouldAutoApprove ~2655) and tools.ts getToolDefs advertises MCP tools in EVERY profile (~1002-1024); no check that the user asked for this server')
      : 'INCONCLUSIVE: the scripted MCP server was never discovered, so the model never saw mcp__v1132probe__unprompted_probe — no opt-in gate could be exercised; check MCP_DISCOVERY_TIMEOUT_MS / stdio fixture');
});

// ===========================================================================
// 6 — DESIGN / LANGUAGE / TOOL MANDATE in the Arabic system prompt (U2)
// ===========================================================================
test('V1132/6 — buildSystemPrompt(ar): design quality + language + tool mandate', async () => {
  if (!engine) { result('promptDesignArabic', false, 'engine bundle failed', 'test harness'); return; }
  const base = { workspace: 'D:/sadeem-test-ws', mode: 'default', platform: 'win32', language: 'ar' };
  let sys = '';
  try { sys = String(engine.Prompt.buildSystemPrompt(base) ?? ''); }
  catch (err) { result('promptDesignArabic', false, 'buildSystemPrompt threw: ' + String(err?.message ?? err), 'prompts.ts'); return; }
  const checks = {
    arabic: /[\u0600-\u06FF]/.test(sys),
    design: /DESIGN QUALITY CONTRACT|boxed-card grids|عقد جودة التصميم|نظام تصميم حقيقي/.test(sys),
    noBoxes: /generic boxed-card grids|شبكات بطاقات عامة/.test(sys),
    language: /LANGUAGE DISCIPLINE|Arabic request → Arabic UI text|انضباط اللغة|الطلب العربي/.test(sys),
    toolMandate: /TOOL USE IS MANDATORY|استخدام الأدوات إلزامي/.test(sys),
    mcpOptIn: /MCP IS OPT-IN|MCP اختياري/.test(sys),
    noLoops: /NO STUPID LOOPS|لا حلقات غبية/.test(sys),
  };
  const pass = Object.values(checks).every(Boolean);
  result('promptDesignArabic', pass, JSON.stringify(checks),
    pass ? '' : 'prompts.ts v11.32 REAL-WORK CONTRACT / ARABIC-FIRST sections missing one or more mandated phrases');
  assert.equal(pass, true, 'Arabic system prompt must carry all design/language/tool-mandate phrases: ' + JSON.stringify(checks));
});

// ===========================================================================
// 7 — VERDICT. A reality guard that reports FAIL but exits 0 is just another
// green code test masking the UX failure. Fail the process when reality fails.
// ===========================================================================
test('V1132/7 — VERDICT: no reality-check failures', () => {
  const failed = RESULTS.filter((r) => !r.pass);
  const msg = failed.length
    ? `AI DOES NOT ACTUALLY WORK YET — ${failed.length}/${RESULTS.length} reality checks failed: ` +
      failed.map((f) => `${f.id} (${f.detail})`).join(' | ')
    : `AI WORKS on every measured behaviour (${RESULTS.length}/${RESULTS.length})`;
  console.log(`V1132_VERDICT ${msg}`);
  assert.equal(failed.length, 0, msg);
});
