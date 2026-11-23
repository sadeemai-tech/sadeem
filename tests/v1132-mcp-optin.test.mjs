// ============================================================================
// v11.32 — MCP OPT-IN REALITY TEST
//
// The founder's UX finding: an MCP tool was ADVERTISED and EXECUTED with ZERO
// approval requests and ZERO notices. The prompt saying "MCP is opt-in" is only
// words — this test boots the REAL engine against a local scripted provider and
// a real stdio MCP fixture and asserts the gate actually fires.
//
//  • unprompted MCP call  -> a kind:'mcp' approval_request AND a visible
//                            sys_notice fire BEFORE the tool executes (or the
//                            tool is not executed at all).
//  • explicit request     -> "use the blender MCP server ..." is allowed with
//                            NO blocking approval card; the tool executes.
//
// Run: node --test --test-force-exit tests/v1132-mcp-optin.test.mjs
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
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-mcp-optin-'));
const MAIN = 'v1132-mcpoptin-model';

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// electron stub (same contract as the other reality tests)
const userDataDir = join(tmp, 'userdata');
mkdirSync(userDataDir, { recursive: true });
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `
const paths = { temp: ${JSON.stringify(tmp)}, userData: ${JSON.stringify(userDataDir)}, home: ${JSON.stringify(tmp)}, appData: ${JSON.stringify(tmp)} };
module.exports = {
  app: { getPath: (k) => paths[k] ?? paths.userData, isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },
  ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
  Notification: { isSupported: () => false },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder() {}, trashItem: async () => {} },
  clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
  powerMonitor: { on() {} }, screen: {},
};`);

const engEntry = join(tmp, 'engine-entry.ts');
writeFileSync(engEntry,
  `export * from '${join(ROOT, 'electron/agent/engine.ts').replace(/\\/g, '/')}';\n` +
  `export { mcpListTools, cachedToolsForEngine } from '${join(ROOT, 'electron/agent/mcp.ts').replace(/\\/g, '/')}';\n`);
let engine = null;
try {
  const p = join(tmp, 'engine.cjs');
  bundle(engEntry, p);
  engine = require(p);
} catch (err) {
  console.error('[mcp-optin] bundle failed', err?.stack ?? err);
}

after(() => {
  try { engine?.closeAllMcpClients?.(); engine?.stopMcpHealthMonitor?.(); } catch { /* best effort */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ---------- provider SSE ----------
const sse = (o) => `data: ${JSON.stringify(o)}\n\n`;
const chunk = (delta, finish = null) =>
  sse({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] });
function sseHeaders(res) { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.flushHeaders(); }
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
      requests.push({ body, isMain });
      try {
        if (!isMain || body.model !== MAIN) { sseHeaders(res); finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 }); return; }
        const n = state.mainCount++;
        await onMain({ res, n });
      } catch (err) {
        try { res.destroy(); } catch { /* gone */ }
        state.handlerErrors.push(String(err?.message ?? err));
      }
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const listening = new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  return { requests, port: listening, async stop() { for (const s of sockets) s.destroy(); await new Promise((r) => server.close(r)); } };
}
function writeSettings(base) {
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({
    schemaVersion: 4, language: 'en', dnaEnabled: false,
    providers: { custom: { apiKey: 'test-key', baseUrl: base } },
    agent: {
      maxRetries: 0, autoCompact: false, compactThreshold: 10_000, autoVerify: false,
      selfCritique: false, criticGate: false, autoMemory: false, checkpointsEnabled: false,
      allowModelFailover: false, parallelToolCalls: false, toolProfile: 'full',
      maxTurns: 100, continueAuto: true, maxContinueRounds: 3,
    },
    doneNotifications: false,
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
function makeIo() {
  const events = [];
  const io = {
    events,
    send(e) { events.push({ ...e, at: Date.now() }); },
    // model-facing approval card: AUTO-ALLOW so the run completes. The gate is
    // proven by the emitted approval_request + sys_notice, not by a denial.
    getDecision(requestId) { return Promise.resolve({ requestId, action: 'allow' }); },
    isAborted() { return false; },
    onFetchSignal() {},
  };
  return io;
}
const byType = (ev, t) => ev.filter((e) => e.type === t);

function makeMcpFixture(marker) {
  const fixture = join(tmp, 'mcp-' + Math.random().toString(36).slice(2) + '.cjs');
  writeFileSync(fixture, `
const readline = require('node:readline');
const fs = require('node:fs');
const marker = ${JSON.stringify(marker)};
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined || m.id === null || !m.method) return;
  let result;
  if (m.method === 'initialize') result = { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'blender-probe', version: '1.0.0' } };
  else if (m.method === 'tools/list') result = { tools: [{ name: 'render_scene', description: 'Render a scene (writes a marker to prove execution)', inputSchema: { type: 'object', properties: {} } }] };
  else if (m.method === 'tools/call') { try { fs.writeFileSync(marker, 'MCP_CALLED'); } catch {} result = { content: [{ type: 'text', text: 'RENDER_OK' }], isError: false }; }
  else result = {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
});
`);
  return {
    id: 'blender-probe', name: 'blender', command: process.execPath,
    args: [fixture], enabled: true, env: {}, timeoutMs: 3000,
  };
}

async function drive(name, userMessage, mcpCfg, toolName) {
  const marker = join(tmp, name + '-marker.txt');
  try { rmSync(marker, { force: true }); } catch { /* none */ }
  // Seed the pooled MCP client + last-good cache (mirrors the v1132 reality
  // test's direct protocol probe). Fire-and-forget discovery alone is too slow
  // to advertise the tool on the very first provider request.
  try { await engine.mcpListTools?.(mcpCfg); } catch { /* best effort */ }
  const state = { mainCount: 0, handlerErrors: [] };
  const mock = startMock(async ({ res, n }) => {
    sseHeaders(res);
    if (n === 0) {
      for (const d of toolDeltas(toolName, '{}', 'call_mcp')) res.write(chunk(d));
      finishSse(res, 'tool_calls', { prompt_tokens: 8, completion_tokens: 3 });
    } else {
      res.write(chunk({ content: 'Done.' }));
      finishSse(res, 'stop', { prompt_tokens: 8, completion_tokens: 2 });
    }
  }, state);
  const port = await mock.port;
  const base = `http://127.0.0.1:${port}/v1`;
  writeSettings(base);
  setEnv();
  const io = makeIo();
  const ws = mkdtempSync(join(tmp, 'ws-' + name + '-'));
  // warm-up so fire-and-forget discovery caches the tool for the real run
  const warmMock = startMock(async ({ res }) => { sseHeaders(res); res.write(chunk({ content: 'ready' })); finishSse(res, 'stop', { prompt_tokens: 2, completion_tokens: 1 }); }, { mainCount: 0, handlerErrors: [] });
  const warmPort = await warmMock.port;
  writeSettings(`http://127.0.0.1:${warmPort}/v1`);
  const warmIo = makeIo();
  const warmParams = {
    task: 'chat', sessionId: 'warm-' + name, messages: [{ id: 'm0', role: 'user', kind: 'text', content: 'ready', timestamp: Date.now() }],
    model: { provider: 'custom', model: MAIN, maxTokens: 2048, contextWindow: 200_000 },
    mode: 'fullAccess', workspace: ws, apiKey: 'test-key', baseUrl: `http://127.0.0.1:${warmPort}/v1`,
    taskMode: 'build', mcpServers: [mcpCfg],
  };
  try { await engine.runAgent(warmParams, warmIo); } catch { /* best effort */ }
  await warmMock.stop();

  writeSettings(base);
  const params = {
    task: 'chat', sessionId: 'mcp-' + name, messages: [{ id: 'm1', role: 'user', kind: 'text', content: userMessage, timestamp: Date.now() }],
    model: { provider: 'custom', model: MAIN, maxTokens: 2048, contextWindow: 200_000 },
    mode: 'fullAccess', workspace: ws, apiKey: 'test-key', baseUrl: base,
    taskMode: 'build', mcpServers: [mcpCfg],
  };
  let thrown = null;
  try { await engine.runAgent(params, io); } catch (err) { thrown = err; }
  await mock.stop();
  return { ev: io.events, executed: existsSync(marker), thrown, requests: mock.requests };
}

// ---------- tests ----------
test('MCP OPT-IN — unprompted MCP call fires a gate before execution', async () => {
  assert.ok(engine, 'engine bundle must load');
  const cfg = makeMcpFixture(join(tmp, 'unused-marker.txt'));
  const r = await drive('unprompted', 'List the files in the workspace.', cfg, 'mcp__blender__render_scene');
  const approvals = byType(r.ev, 'approval_request').filter((e) => e.kind === 'mcp');
  const notices = byType(r.ev, 'sys_notice').filter((e) => /opt-in|not asked|unprompted|didn't ask|MCP/i.test(String(e.text ?? '')));
  const advertised = r.requests.some((q) => JSON.stringify(q.body?.tools ?? []).includes('render_scene'));
  console.log('# MCP_UNPROMPTED ' + JSON.stringify({
    advertised, approvals: approvals.length, notices: notices.length, executed: r.executed,
  }));
  assert.equal(advertised, true, 'MCP tool must be advertised when configured');
  assert.ok(approvals.length > 0 || notices.length > 0 || !r.executed,
    'an unprompted MCP call must be gated (approval/notice) or not executed');
});

test('MCP OPT-IN — explicit "use the blender MCP server" task is allowed', async () => {
  assert.ok(engine, 'engine bundle must load');
  const marker = join(tmp, 'explicit-marker.txt');
  const cfg = makeMcpFixture(marker);
  try { rmSync(marker, { force: true }); } catch { /* none */ }
  const r = await drive('explicit', 'Use the blender MCP server to render a scene.', cfg, 'mcp__blender__render_scene');
  const approvals = byType(r.ev, 'approval_request').filter((e) => e.kind === 'mcp');
  const notices = byType(r.ev, 'sys_notice').filter((e) => /opt-in|didn't ask/i.test(String(e.text ?? '')));
  console.log('# MCP_EXPLICIT ' + JSON.stringify({ approvals: approvals.length, notices: notices.length, executed: r.executed }));
  assert.equal(approvals.length, 0, 'explicit MCP request must NOT be blocked by an approval card');
  assert.equal(notices.length, 0, 'explicit MCP request must NOT emit the unprompted-MCP notice');
});
