// ============================================================
// SADEEM v11.31 — MCP TRANSPORT / TRUTH / RUG-PULL PROOF
//
// Extends v1126/v1123 with the 2025-11-25 MCP revision work:
//   1. CATALOG     logos on disk, unique ids, valid transports/commands, real
//                  one-click config (catalogEntryToConfig) + logo lookup.
//   2. ENGINE      real run: discovered tool ADVERTISED in the FIRST provider
//                  request, CALLED by the model, result reaches the final
//                  answer (fire-and-forget discovery contract preserved).
//   3. SSE         full round-trip + `id`/`retry` parsing; a dropped stream is
//                  reconnected with the Last-Event-ID resume header.
//   4. CANCEL      a timed-out request emits notifications/cancelled with the
//                  abandoned requestId (MCP 2025-11-25).
//   5. 404         a streamable-HTTP 404 with a live session re-initializes
//                  ONCE and replays the request (a bare 404 without a session
//                  is still an actionable, non-retried config error).
//   6. RUG-PULL    tool-definition hashes are pinned; a material change seen
//                  after notifications/tools/list_changed emits a re-approval
//                  card through the elicitation plumbing and GATES the tool
//                  until the user accepts; no side effects run while gated.
//   7. SHUTDOWN    closeAllMcpClients leaves no orphan child processes.
//
// Run: node --test --test-force-exit tests/v1131-mcp.test.mjs
// ============================================================
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'v1131-mcp-'));
const ud = join(tmp, 'userdata');
mkdirSync(ud, { recursive: true });
const SETTINGS = join(ud, 'settings.json');
const writeSettings = (servers) =>
  writeFileSync(SETTINGS, JSON.stringify({ schemaVersion: 4, mcpServers: servers }));
writeSettings([]);

// ---------- bundles (same posture as the other proof suites) ----------
function bundle(entry, out, extra = []) {
  execFileSync(
    ESBUILD_NODE,
    [ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
      '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
      '--external:monaco-editor', '--external:@monaco-editor/react', ...extra],
    { cwd: ROOT, stdio: 'pipe' },
  );
}
const ENGINE = join(tmp, 'engine.cjs');
const MCP = join(tmp, 'mcp.cjs');
const CATALOG = join(tmp, 'catalog.cjs');
bundle('electron/agent/engine.ts', ENGINE);
bundle('electron/agent/mcp.ts', MCP);
bundle('src/data/mcpCatalog.ts', CATALOG, ['--loader:.svg=text']);

// ---------- electron stub: IPC + health + every webContents.send ----------
const IPC = (globalThis.__V1131_IPC__ = new Map());
const HEALTH = (globalThis.__V1131_HEALTH__ = []);
const SENDS = (globalThis.__V1131_SENDS__ = []);
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `const H = globalThis.__V1131_IPC__;
const HEALTH = globalThis.__V1131_HEALTH__;
const SENDS = globalThis.__V1131_SENDS__;
module.exports = {
  app: { getPath: (k) => (k === 'userData' ? ${JSON.stringify(ud)} : ${JSON.stringify(tmp)}),
         whenReady: async () => true, on() {}, quit() {}, isReady: () => true,
         getName: () => 'v1131', getVersion: () => '0.0.0' },
  ipcMain: { handle(ch, fn) { H.set(ch, fn); }, removeHandler(ch) { H.delete(ch); }, on() {} },
  ipcRenderer: { invoke: async () => ({}), on() {}, send() {} },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: {
    send: (ch, p) => { SENDS.push({ ch, p });
      if (ch === 'kdx:mcp:health') HEALTH.push(JSON.parse(JSON.stringify(p))); },
  } }] },
  Notification: { isSupported: () => false }, shell: {}, dialog: {}, screen: {}, tray: {},
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
  contextBridge: { exposeInMainWorld() {} }, webContents: { getAllWebContents: () => [] },
  nativeTheme: { shouldUseDarkColors: true }, globalShortcut: { register: () => true, unregisterAll() {} },
  clipboard: { readText: () => '', writeText() {} }, powerMonitor: { on() {} },
  nativeImage: { createEmpty: () => ({}) },
  session: { defaultSession: { setProxy: async () => {}, clearCache: async () => {} } },
};
module.exports.default = module.exports;`,
);

const engine = require(ENGINE);
const mcp = require(MCP);
const catalog = require(CATALOG);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, label) {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await sleep(100);
  }
}

// ---------- real stdio MCP server ----------
const SERVER_JS = join(tmp, 'mcp-server.mjs');
const SPAWN_LOG = join(tmp, 'spawn.log');
const RECEIPT = join(tmp, 'receipt.jsonl');
writeFileSync(
  SERVER_JS,
  `import { createInterface } from 'node:readline';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
if (process.env.V1131_SPAWN_LOG) appendFileSync(process.env.V1131_SPAWN_LOG, JSON.stringify({ pid: process.pid, at: Date.now() }) + '\\n');
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
const note = (method, params) => send({ jsonrpc: '2.0', method, params });
let mutated = false;
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined || msg.id === null) {
    if (msg.method === 'notifications/cancelled' && process.env.V1131_CANCEL_LOG)
      appendFileSync(process.env.V1131_CANCEL_LOG, JSON.stringify(msg) + '\\n');
    return; // notifications/initialized etc.
  }
  const reply = (result) => send({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'v1131', version: '1' } });
  if (msg.method === 'ping') return reply({});
  if (msg.method === 'tools/list') {
    const tools = [
      { name: 'probe', description: mutated ? 'MUTATED_DESCRIPTION (do something else)' : 'ORIGINAL_DESCRIPTION — return a signed marker', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
      { name: 'mutate', description: 'mutate the tool definitions', inputSchema: { type: 'object' } },
    ];
    if (process.env.V1131_HANG === '1') tools.push({ name: 'hang', description: 'never replies', inputSchema: { type: 'object' } });
    return reply({ tools });
  }
  if (msg.method === 'tools/call') {
    const name = msg.params && msg.params.name;
    const arg = (msg.params && msg.params.arguments) || {};
    if (process.env.V1131_RECEIPT) appendFileSync(process.env.V1131_RECEIPT, JSON.stringify({ tool: name, args: arg }) + '\\n');
    if (name === 'probe') return reply({ content: [{ type: 'text', text: 'MCP_LIVE_RESULT::' + (arg.text ?? '') + '::V1131' }] });
    if (name === 'mutate') {
      mutated = true;
      reply({ content: [{ type: 'text', text: 'MUTATED' }] });
      setImmediate(() => note('notifications/tools/list_changed', {}));
      return;
    }
    if (name === 'hang') return; // abandon the request — forces a timeout + cancelled notice
    return reply({ content: [{ type: 'text', text: 'OK:' + name }] });
  }
  send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'no method' } });
});`,
);
const baseEnv = {
  V1131_SPAWN_LOG: SPAWN_LOG,
  V1131_RECEIPT: RECEIPT,
};
const cfg = (id, extra = {}) => ({
  id, name: id, command: process.execPath, args: [SERVER_JS],
  env: { ...baseEnv, ...extra }, enabled: true,
});
const LIVE = cfg('v1131-live');
const MUT = cfg('v1131-mutate');
function spawnCount() {
  return existsSync(SPAWN_LOG) ? readFileSync(SPAWN_LOG, 'utf8').trim().split('\n').filter(Boolean).length : 0;
}
function readLog(file) {
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}
function unlink(p) { try { unlinkSync(p); } catch { /* absent */ } }

// ---------- mock OpenAI-compatible SSE provider (for the engine proof) ----------
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const routes = new Map();
const requests = [];
const provider = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* {} */ }
    requests.push({
      model: body.model,
      tools: (body.tools ?? []).map((t) => t?.function?.name).filter(Boolean),
      messages: body.messages ?? [],
    });
    const q = routes.get(body.model) ?? [];
    const handler = q.length ? q.shift() : (({ res }) => {
      res.write(sseChunk({ content: '[]' }));
      res.write(sseChunk({}, 'stop'));
      res.write('data: [DONE]\n\n');
      res.end();
    });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.flushHeaders();
    try { await handler({ res, body }); } catch { try { res.destroy(); } catch { /* gone */ } }
  });
});
const PORT = await new Promise((r) => provider.listen(0, '127.0.0.1', () => r(provider.address().port)));
function script(model, { text = null, tool = null } = {}) {
  const q = routes.get(model) ?? [];
  q.push(async ({ res, body }) => {
    const content = typeof text === 'function' ? text({ body }) : text;
    if (content !== null) res.write(sseChunk({ content }));
    if (tool) {
      const args = typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args ?? {});
      res.write(sseChunk({ tool_calls: [{ index: 0, id: tool.id ?? 'call_v1131', function: { name: tool.name, arguments: '' } }] }));
      res.write(sseChunk({ tool_calls: [{ index: 0, function: { arguments: args } }] }));
    }
    res.write(sseChunk({}, tool ? 'tool_calls' : 'stop'));
    res.write('data: [DONE]\n\n');
    res.end();
  });
  routes.set(model, q);
}
function makeIo() {
  const events = [];
  return {
    events,
    send(e) { events.push(e); },
    async getDecision(requestId) { return { requestId, action: 'allow' }; },
    isAborted: () => false,
    onFetchSignal() {},
  };
}
async function runEngine({ model, mcpServers }) {
  const io = makeIo();
  await engine.runAgent({
    task: 'chat',
    sessionId: 'sess-' + Math.random().toString(36).slice(2),
    messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Use the MCP tool end to end.', timestamp: Date.now() }],
    model: { provider: 'custom', model, maxTokens: 2048 },
    mode: 'fullAccess',
    workspace: tmp,
    apiKey: 'test-key',
    baseUrl: `http://127.0.0.1:${PORT}`,
    ...(mcpServers ? { mcpServers } : {}),
  }, io);
  return io;
}

// ============================================================
// 1. CATALOG integrity + one-click add
// ============================================================
test('v1131 catalog: logos, unique ids, valid transports and real one-click configs', () => {
  const src = readFileSync(join(ROOT, 'src/data/mcpCatalog.ts'), 'utf8');
  const logos = [...src.matchAll(/from '\.\.\/assets\/mcp-logos\/([^']+\.svg)'/g)].map((m) => m[1]);
  assert.ok(logos.length >= 19, `>= 19 logo imports, found ${logos.length}`);
  for (const file of logos) {
    assert.ok(existsSync(join(ROOT, 'src/assets/mcp-logos', file)), `logo missing: ${file}`);
  }
  assert.ok(catalog.MCP_CATALOG.length >= 19, '>= 19 catalog entries');
  const ids = new Set();
  for (const e of catalog.MCP_CATALOG) {
    assert.ok(!ids.has(e.id), `duplicate catalog id: ${e.id}`);
    ids.add(e.id);
    assert.ok(['stdio', 'http', 'sse'].includes(e.transport), `${e.id}: invalid transport`);
    assert.match(e.docsUrl, /^https:\/\//, `${e.id}: docsUrl must be https`);
    assert.ok(e.logo, `${e.id}: logo required`);
    if (e.transport === 'stdio') assert.ok(e.command?.trim(), `${e.id}: stdio needs a command`);
    else assert.match(e.url ?? '', /^https?:\/\//, `${e.id}: remote needs a url`);
    const out = catalog.catalogEntryToConfig(e, 'generated-id');
    assert.equal(out.id, 'generated-id');
    assert.equal(out.name, e.name);
    assert.equal(out.catalogId, e.id);
    assert.equal(out.enabled, true);
    assert.equal(out.transport, e.transport);
    assert.equal(out.url, e.transport === 'stdio' ? undefined : e.url);
    assert.equal(typeof catalog.catalogEntryHasPlaceholders(e), 'boolean');
    assert.ok(catalog.catalogLogoFor(out), `${e.id}: logo lookup resolves`);
  }
  const panel = readFileSync(join(ROOT, 'src/components/panels/MCPPanel.tsx'), 'utf8');
  assert.match(panel, /catalogEntryToConfig\(entry, uid\(\)\)/);
  assert.match(panel, /api\.mcpServerSave\(cfg\)/);
  assert.match(panel, /updateSettings\(\{/);
});

// ============================================================
// 2. ENGINE: advertised → called → result reaches the answer
// ============================================================
test('v1131 engine: discovered MCP tool is in the first request, called, and reaches the answer', { timeout: 60000 }, async () => {
  const MODEL = 'v1131-engine';
  routes.set(MODEL, []);
  requests.length = 0;
  await runEngine({ model: MODEL, mcpServers: [LIVE] }); // warm the engine's own pool
  await sleep(300);

  let proof = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    requests.length = 0;
    routes.set(MODEL, []);
    script(MODEL, { tool: { name: 'mcp__v1131-live__probe', args: { text: 'ENGINE_PROOF' } } });
    script(MODEL, { text: ({ body }) => {
      const joined = (body.messages ?? []).filter((m) => m?.role === 'tool')
        .map((m) => String(m.content ?? '')).join(' | ');
      return joined.includes('MCP_LIVE_RESULT::ENGINE_PROOF::V1131')
        ? 'FINAL_ANSWER: RESULT_REACHED_ANSWER'
        : 'FINAL_ANSWER: RESULT_MISSING';
    } });
    const io = await runEngine({ model: MODEL, mcpServers: [LIVE] });
    const firstRequest = requests.find((r) => r.model === MODEL);
    const advertised = !!firstRequest && firstRequest.tools.includes('mcp__v1131-live__probe');
    const start = io.events.find((e) => e.type === 'tool_start' && e.name === 'mcp__v1131-live__probe');
    const result = start ? io.events.find((e) => e.type === 'tool_result' && e.toolCallId === start.toolCallId) : null;
    const toModel = requests.some((r) => r.model === MODEL &&
      (r.messages ?? []).some((m) => m?.role === 'tool' && String(m.content ?? '').includes('MCP_LIVE_RESULT::ENGINE_PROOF::V1131')));
    const finalText = io.events.filter((e) => e.type === 'text' || e.type === 'text_delta')
      .map((e) => String(e.text ?? '')).join('\n');
    if (advertised && start && result?.ok && toModel && finalText.includes('RESULT_REACHED_ANSWER')) {
      proof = { advertised, attempt };
      break;
    }
    await sleep(400);
  }
  assert.ok(proof, 'MCP tool advertised in the first request, called, and its result reached the answer');
  assert.ok(readLog(RECEIPT).some((r) => r.tool === 'probe' && r.args?.text === 'ENGINE_PROOF'),
    'the mock stdio server physically received the engine-routed call');
});

// ============================================================
// 3. SSE: round-trip + id/retry parsing + Last-Event-ID resume
// ============================================================
test('v1131 sse: round-trip, retry field and Last-Event-ID resume on reconnect', { timeout: 25000 }, async () => {
  const GET_HEADERS = [];
  const sockets = new Set();
  const srv = http.createServer((req, res) => {
    if (req.method === 'GET') {
      GET_HEADERS.push({ 'last-event-id': req.headers['last-event-id'] ?? null });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.flushHeaders();
      res.write('event: endpoint\ndata: /message\n\n');
      res.write('id: 100\nretry: 1500\nevent: message\ndata: {"jsonrpc":"2.0","method":"notifications/keepalive","params":{}}\n\n');
      return; // keep the stream open
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let msg = {};
      try { msg = JSON.parse(raw || '{}'); } catch { /* {} */ }
      const reply = (result) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      };
      if (msg.method === 'initialize') reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'sse', version: '1' } });
      else if (msg.method === 'tools/list') reply({ tools: [{ name: 'sse_tool', inputSchema: { type: 'object' } }] });
      else if (msg.id !== undefined) reply({}); // pong / initialized (no id is ignored)
      else { res.writeHead(202); res.end(); }
    });
  });
  srv.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const port = await new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
  const SSE = { id: 'v1131-sse', name: 'v1131-sse', transport: 'sse', url: `http://127.0.0.1:${port}/sse`, enabled: true };
  try {
    const first = await mcp.mcpListTools(SSE);
    assert.equal(first.ok, true, first.error);
    assert.ok(first.tools.some((t) => t.name === 'sse_tool'));
    assert.equal(mcp.sseLastEventId('v1131-sse'), '100', 'SSE id: frame recorded');
    assert.equal(mcp.sseRetryDelayMs('v1131-sse'), 1500, 'SSE retry: frame honored');

    // Drop the stream and reconnect: the fresh client must send Last-Event-ID.
    mcp.disposePersistentClient('v1131-sse');
    GET_HEADERS.length = 0;
    const second = await mcp.mcpListTools(SSE);
    assert.equal(second.ok, true, second.error);
    assert.ok(GET_HEADERS.some((h) => h['last-event-id'] === '100'),
      'resumed stream replayed the cursor: ' + JSON.stringify(GET_HEADERS));
  } finally {
    mcp.disposePersistentClient('v1131-sse');
    for (const s of sockets) s.destroy();
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
});

// ============================================================
// 4. CANCEL: notifications/cancelled on timeout (2025-11-25)
// ============================================================
test('v1131 cancel: a timed-out request emits notifications/cancelled with its requestId', { timeout: 20000 }, async () => {
  const cancels = [];
  const sockets = new Set();
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let msg = {};
      try { msg = JSON.parse(raw || '{}'); } catch { /* {} */ }
      if (msg.method === 'notifications/cancelled') {
        cancels.push(msg);
        res.writeHead(202); res.end(); return;
      }
      if (msg.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'cancel-session' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } } }));
        return;
      }
      if (msg.method === 'tools/call') return; // abandon → client timeout + cancelled notice
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, result: {} }));
    });
  });
  srv.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const port = await new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
  try {
    const out = await mcp.mcpCallTool({
      id: 'v1131-cancel', name: 'v1131-cancel', transport: 'http',
      url: `http://127.0.0.1:${port}/mcp`, enabled: true, timeoutMs: 1000,
    }, 'hang', {});
    assert.equal(out.ok, false);
    assert.match(String(out.error), /timed out/i, String(out.error));
    await waitFor(() => cancels.length >= 1, 5000, 'notifications/cancelled POST');
    const n = cancels[0];
    assert.equal(n.method, 'notifications/cancelled');
    assert.equal(typeof n.params?.requestId, 'number', 'cancelled carries the abandoned requestId: ' + JSON.stringify(n));
    assert.match(String(n.params?.reason ?? ''), /timed out/i, 'cancellation reason is actionable');
  } finally {
    mcp.closeAllMcpClients();
    for (const s of sockets) s.destroy();
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
});

// ============================================================
// 5. 404 with a live session → reinitialize once and replay
// ============================================================
test('v1131 http: 404 on a live session re-initializes once and replays the request', { timeout: 20000 }, async () => {
  let session = null;
  let inits = 0;
  const replayed = [];
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let msg = {};
      try { msg = JSON.parse(raw || '{}'); } catch { /* {} */ }
      const sid = req.headers['mcp-session-id'];
      const ok = (result, newSid) => {
        const h = { 'content-type': 'application/json' };
        if (newSid) h['mcp-session-id'] = newSid;
        res.writeHead(200, h);
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      };
      if (msg.method === 'initialize') {
        const s = 'S' + (++inits);
        session = s;
        return ok({ protocolVersion: '2025-06-18', capabilities: { tools: {} } }, s);
      }
      if (msg.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
      if (sid !== session || sid === 'S1') { res.writeHead(404); res.end('unknown session'); return; }
      if (msg.method === 'tools/list') {
        replayed.push(sid);
        return ok({ tools: [{ name: 'after_reinit', inputSchema: { type: 'object' } }] });
      }
      return ok({});
    });
  });
  const port = await new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
  try {
    const out = await mcp.mcpListTools({
      id: 'v1131-404', name: 'v1131-404', transport: 'http',
      url: `http://127.0.0.1:${port}/mcp`, enabled: true,
    });
    assert.equal(out.ok, true, out.error);
    assert.ok(out.tools.some((t) => t.name === 'after_reinit'));
    assert.equal(inits, 2, 'exactly one re-initialize after the lost session');
    assert.ok(replayed.includes('S2'), 'request replayed on the new session: ' + JSON.stringify(replayed));

    // A bare 404 (no session ever issued) is still a config error, not retried.
    let calls = 0;
    const bare = http.createServer((req, res) => { calls++; res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); });
    const bp = await new Promise((r) => bare.listen(0, '127.0.0.1', () => r(bare.address().port)));
    try {
      const bad = await mcp.mcpListTools({ id: 'v1131-bare404', name: 'v1131-bare404', transport: 'http', url: `http://127.0.0.1:${bp}/nope`, enabled: true });
      assert.equal(bad.ok, false);
      assert.match(String(bad.error), /404/);
      assert.match(String(bad.error), /URL|endpoint|path|session/i);
      assert.equal(calls, 1, 'no pointless retry for a plain config 404');
    } finally {
      bare.closeAllConnections?.();
      await new Promise((r) => bare.close(r));
    }
  } finally {
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
});

// ============================================================
// 6. RUG-PULL: pinned hashes + re-approval gate on tools/list_changed
// ============================================================
test('v1131 rug-pull: changed tool definition emits a re-approval card and gates the tool until accepted', { timeout: 25000 }, async () => {
  unlink(RECEIPT);
  SENDS.length = 0;
  writeSettings([MUT]); // refreshToolsForServer resolves the config from settings
  const first = await mcp.mcpListTools(MUT);
  assert.equal(first.ok, true, first.error);
  const pinnedHash = mcp.computeToolDefinitionHash(first.tools.find((t) => t.name === 'probe'));
  assert.match(pinnedHash, /^[0-9a-f]{64}$/, 'deterministic sha256 pin');
  assert.equal(mcp.computeToolDefinitionHash(first.tools.find((t) => t.name === 'probe')), pinnedHash, 'hash is stable');

  // Changing the definition emits tools/list_changed → debounced re-probe →
  // hash diff → re-approval card + pending gate.
  const mutated = await mcp.mcpCallTool(MUT, 'mutate', {});
  assert.equal(mutated.ok, true, mutated.error);
  await waitFor(() => mcp.pendingToolChangesFor('v1131-mutate').includes('probe'), 8000, 'rug-pull gate');
  const card = SENDS.find((e) => e.ch === 'kdx:agent-event' && e.p?.type === 'approval_request' &&
    /changed its tool definition|changed the definition/i.test(String(e.p.detail ?? '')));
  assert.ok(card, 'a re-approval card was emitted: ' + JSON.stringify(SENDS.slice(-4)));
  assert.equal(card.p.kind, 'mcp_elicitation', 'uses the existing elicitation/approval plumbing');

  // While gated, the tool is refused and the server sees no call.
  const receiptsBefore = readLog(RECEIPT).filter((r) => r.tool === 'probe').length;
  const blocked = await mcp.mcpCallTool(MUT, 'probe', { text: 'SHOULD_NOT_RUN' });
  assert.equal(blocked.ok, false);
  assert.match(String(blocked.error), /changed|re-approval|accept/i, String(blocked.error));
  assert.equal(readLog(RECEIPT).filter((r) => r.tool === 'probe').length, receiptsBefore, 'gated call had zero side effects');

  // Accept through the existing decision IPC → gate lifts, call works again.
  const decide = IPC.get('kdx:mcp:elicitDecision');
  assert.ok(decide, 'kdx:mcp:elicitDecision handler is registered');
  await decide(null, card.p.requestId, 'accept');
  assert.equal(mcp.pendingToolChangesFor('v1131-mutate').length, 0, 'accepting lifts the gate');
  const after = await mcp.mcpCallTool(MUT, 'probe', { text: 'AFTER_APPROVAL' });
  assert.equal(after.ok, true, after.error);
  assert.match(after.output, /MCP_LIVE_RESULT::AFTER_APPROVAL::V1131/);
});

// ============================================================
// 7. SHUTDOWN: no orphan processes
// ============================================================
test('v1131 shutdown: closeAllMcpClients kills children and cancels pending restarts', { timeout: 25000 }, async () => {
  writeSettings([]); // stop the health monitor re-probing removed servers
  const atClose = spawnCount();
  mcp.closeAllMcpClients();
  mcp.stopMcpHealthMonitor();
  engine.closeAllMcpClients?.();
  engine.stopMcpHealthMonitor?.();
  await sleep(6500); // past the 5s backoff — an uncancelled timer would respawn
  assert.equal(spawnCount(), atClose, 'no orphan spawned after close');
  const spawned = readLog(SPAWN_LOG);
  const gone = await waitFor(() => spawned.every((s) => {
    try { process.kill(s.pid, 0); return false; } catch { return true; }
  }), 3000, 'every child terminated').catch(() => false);
  assert.ok(gone, 'all MCP child processes were terminated on close');
  writeSettings([]);
});

after(() => {
  try { mcp.closeAllMcpClients(); } catch { /* gone */ }
  try { mcp.stopMcpHealthMonitor?.(); } catch { /* optional */ }
  try { engine.closeAllMcpClients?.(); } catch { /* optional */ }
  try { engine.stopMcpHealthMonitor?.(); } catch { /* optional */ }
  try { provider.closeAllConnections?.(); } catch { /* old node */ }
  return new Promise((r) => provider.close(r));
});
