// ============================================================================
// v11.36 — FOLLOW-UP 2 & 3: MCP capability restoration
// ----------------------------------------------------------------------------
// Founder: «حكيت له يستخدم بلندر... لم يستطع» ("I told it to use Blender... it
// couldn't") and «كل قدراته لازم حرفيا» ("literally every capability").
//
// Proves against the REAL engine.ts (esbuild-bundled, electron stubbed):
//   1. opt-in accepts an explicit server name in BOTH scripts:
//        "use blender to render"  AND  "استخدم بلندر لرسم مشهد"
//   2. a COLD connected MCP server (no last-good cache) contributes ALL its
//      tools to the FIRST provider request (D8's connectedServersWithTools);
//   3. an INLINE subagent advertises the full 145-core registry (task and
//      todo_write included) and can EXECUTE an MCP tool by name when opted in.
//
// Run: node --test --test-force-exit tests/v1136-mcp-followup.test.mjs
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
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1136-mcpfu-'));
const MAIN = 'v1136-mcpfu-model';

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}
const userData = join(tmp, 'userdata');
mkdirSync(userData, { recursive: true });
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `
const p = ${JSON.stringify(userData)};
module.exports = {
  app: { getPath: () => p, isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },
  ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
  BrowserWindow: { getAllWindows: () => [] }, Notification: { isSupported: () => false },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder() {}, trashItem: async () => {} },
  clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
  powerMonitor: { on() {} }, screen: {},
};`);

let engine = null;
try {
  const out = join(tmp, 'engine.cjs');
  bundle('electron/agent/engine.ts', out);
  engine = require(out);
} catch (err) {
  console.error('[v1136-mcpfu] bundle failed', err?.stack ?? err);
}

after(() => {
  try { engine?.closeAllMcpClients?.(); engine?.stopMcpHealthMonitor?.(); } catch { /* best effort */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ---------- SSE helpers ----------
const sse = (o) => `data: ${JSON.stringify(o)}\n\n`;
const chunk = (delta, finish = null) =>
  sse({ id: 'v1136', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] });
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
const SUB_IDENTITY = 'part of the Surnia agent team';
function startMock(onRequest) {
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
      const kind = sys.includes(MAIN_IDENTITY) ? 'main'
        : sys.includes(SUB_IDENTITY) ? 'sub'
          : 'other';
      const rec = { body, sys, kind, isMain: kind === 'main', isSub: kind === 'sub' };
      requests.push(rec);
      try {
        if (kind === 'other' || body.model !== MAIN) {
          sseHeaders(res); finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 }); return;
        }
        await onRequest({ res, rec, requests });
      } catch (err) {
        try { res.destroy(); } catch { /* gone */ }
      }
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const listening = new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  return {
    requests, port: listening,
    async stop() { for (const s of sockets) s.destroy(); await new Promise((r) => server.close(r)); },
  };
}
function writeSettings(base, mcpServers = []) {
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({
    schemaVersion: 4, language: 'ar', dnaEnabled: false, mcpServers,
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
  process.env.SURNIA_HOME = userData;
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
  return {
    events,
    send(e) { events.push({ ...e, at: Date.now() }); },
    getDecision(requestId) { return Promise.resolve({ requestId, action: 'allow' }); },
    isAborted() { return false; },
    onFetchSignal() {},
  };
}
function makeFixture(marker, id = 'blender') {
  const file = join(tmp, 'fixture-' + Math.random().toString(36).slice(2) + '.cjs');
  writeFileSync(file, `
const readline = require('node:readline');
const fs = require('node:fs');
const marker = ${JSON.stringify(marker)};
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined || m.id === null || !m.method) return;
  let result;
  if (m.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: ${JSON.stringify(id)}, version: '1.0.0' } };
  else if (m.method === 'tools/list') result = { tools: [
    { name: 'render_scene', description: 'Render a scene', inputSchema: { type: 'object', properties: {} } },
    { name: 'sculpt', description: 'Sculpt a mesh', inputSchema: { type: 'object', properties: {} } },
  ] };
  else if (m.method === 'tools/call') { try { fs.writeFileSync(marker, 'MCP_CALLED'); } catch {} result = { content: [{ type: 'text', text: 'RENDER_OK' }], isError: false }; }
  else result = {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
});
`);
  return { id, name: 'blender', command: process.execPath, args: [file], enabled: true, env: {}, timeoutMs: 5000 };
}

// ---------- 1. UNIT: explicit name in either script opts in ----------
test('v1136-FU1: opt-in accepts "use blender" AND "استخدم بلندر"', () => {
  assert.ok(engine, 'engine bundle must load');
  const servers = [{ server: { name: 'Blender' }, tools: [{ name: 'render_scene' }] }];
  const verdict = (text, tool) => engine.mcpOptInVerdict(text, tool, servers, false);
  for (const text of ['Use blender to render a scene.', 'استخدم بلندر لرسم مشهد.', 'blender'] ) {
    const v = verdict(text, 'mcp__blender__render_scene');
    assert.equal(v.optedIn, true, `explicit name must opt in: ${text}`);
    assert.equal(v.reason, 'explicit-name', `reason for ${text}`);
  }
  const unprompted = verdict('List the files in the workspace.', 'mcp__blender__render_scene');
  assert.equal(unprompted.optedIn, false, 'unprompted call still gated');
  // Tool names transliterate too.
  const arabicTool = engine.mcpOptInVerdict('استخدم رندر المشهد', 'mcp__blender__render_scene', servers, false);
  assert.equal(arabicTool.optedIn, true, 'transliterated tool name opts in');
});

// ---------- 2. COLD server: ALL tools on the FIRST provider request ----------
test('v1136-FU2: cold connected server contributes MCP defs to the first request', async () => {
  assert.ok(engine, 'engine bundle must load');
  const cfg = makeFixture(join(tmp, 'cold-marker.txt'), 'blender-cold');
  cfg.name = 'blender-cold';
  const mock = startMock(async ({ res, requests }) => {
    sseHeaders(res);
    // First request: assert here, then finish with a plain final answer.
    if (requests.filter((r) => r.kind === 'main').length === 1) {
      // (assertions happen after the run; just answer)
    }
    for (const t of ['Done — Blender is ready.']) res.write(chunk({ content: t }));
    finishSse(res, 'stop', { prompt_tokens: 8, completion_tokens: 3 });
  });
  const port = await mock.port;
  const base = `http://127.0.0.1:${port}/v1`;
  writeSettings(base, [cfg]); // cold: settings knows the server, no warm cache
  setEnv();
  const io = makeIo();
  const ws = mkdtempSync(join(tmp, 'cold-ws-'));
  let thrown = null;
  try {
    await engine.runAgent({
      task: 'chat', sessionId: 'v1136-cold-' + Math.random().toString(36).slice(2),
      messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'استخدم بلندر لرسم مشهد', timestamp: Date.now() }],
      model: { provider: 'custom', model: MAIN, maxTokens: 2048, contextWindow: 200_000 },
      mode: 'fullAccess', taskMode: 'build', workspace: ws,
      apiKey: 'test-key', baseUrl: base, mcpServers: [cfg],
    }, io);
  } catch (err) { thrown = err; } finally { await mock.stop(); }
  assert.equal(thrown, null, `runAgent must not throw (${thrown?.stack ?? thrown})`);
  const first = mock.requests.find((r) => r.kind === 'main');
  assert.ok(first, 'the main provider was called');
  const tools = JSON.stringify(first.body.tools ?? []);
  const mcpNames = (first.body.tools ?? [])
    .map((d) => d.function?.name ?? d.name).filter((n) => /^mcp__/.test(String(n ?? '')));
  assert.ok(mcpNames.some((n) => /render_scene$/.test(n)), `cold server: render_scene advertised on the FIRST request (${mcpNames.join(', ')})`);
  assert.ok(mcpNames.some((n) => /sculpt$/.test(n)), 'cold server: EVERY tool advertised, not just the first');
});

// ---------- 3. Inline subagent: 145 tools + MCP execution when opted in ----------
test('v1136-FU3: inline subagent advertises full registry and executes MCP by name', async () => {
  assert.ok(engine, 'engine bundle must load');
  const marker = join(tmp, 'sub-marker.txt');
  try { rmSync(marker, { force: true }); } catch { /* none */ }
  const cfg = makeFixture(marker, 'blender');
  const mock = startMock(async ({ res, rec, requests }) => {
    sseHeaders(res);
    if (rec.isMain) {
      const n = requests.filter((r) => r.kind === 'main').length;
      if (n === 1) {
        for (const d of toolDeltas('task', JSON.stringify({ agent: 'general', description: 'render with blender', prompt: 'استخدم بلندر لرسم مشهد' }), 'call_task')) res.write(chunk(d));
        finishSse(res, 'tool_calls', { prompt_tokens: 10, completion_tokens: 4 });
        return;
      }
      for (const t of ['The subagent rendered the scene with Blender.']) res.write(chunk({ content: t }));
      finishSse(res, 'stop', { prompt_tokens: 10, completion_tokens: 4 });
      return;
    }
    // SUBAGENT turn: call the MCP tool by its exact advertised name.
    for (const d of toolDeltas('mcp__blender__render_scene', '{}', 'call_sub_mcp')) res.write(chunk(d));
    finishSse(res, 'tool_calls', { prompt_tokens: 10, completion_tokens: 4 });
  });
  const port = await mock.port;
  const base = `http://127.0.0.1:${port}/v1`;
  writeSettings(base, [cfg]);
  setEnv();
  const io = makeIo();
  const ws = mkdtempSync(join(tmp, 'sub-ws-'));
  let thrown = null;
  try {
    await engine.runAgent({
      task: 'chat', sessionId: 'v1136-fu3-' + Math.random().toString(36).slice(2),
      messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'استخدم بلندر لرسم مشهد', timestamp: Date.now() }],
      model: { provider: 'custom', model: MAIN, maxTokens: 2048, contextWindow: 200_000 },
      mode: 'fullAccess', taskMode: 'build', workspace: ws,
      apiKey: 'test-key', baseUrl: base, mcpServers: [cfg],
    }, io);
  } catch (err) { thrown = err; } finally { await mock.stop(); }
  assert.equal(thrown, null, `runAgent must not throw (${thrown?.stack ?? thrown})`);

  const sub = mock.requests.find((r) => r.kind === 'sub');
  assert.ok(sub, 'the inline subagent actually ran a provider turn');
  const names = (sub.body.tools ?? []).map((d) => d.function?.name ?? d.name).filter(Boolean);
  assert.ok(names.length >= 145, `subagent advertises the full registry (got ${names.length})`);
  for (const n of ['task', 'todo_write', 'mcp__blender__render_scene']) {
    assert.ok(names.includes(n), `subagent advertises ${n} (no hidden capability)`);
  }
  // The opt-in gate honoured the founder's Arabic request (no blocking card).
  const notices = io.events.filter((e) => e.type === 'sys_notice' && /MCP opt-in|didn't ask/i.test(String(e.text ?? '')));
  assert.equal(notices.length, 0, 'explicit Arabic MCP request is NOT gated');
  // Subagents have a NO-OP ctx.emit, so the marker file is the honest proof of
  // execution (tool_start cards are intentionally suppressed for subagents).
  assert.equal(existsSync(marker), true, 'the subagent really executed the MCP tool by name');
});
