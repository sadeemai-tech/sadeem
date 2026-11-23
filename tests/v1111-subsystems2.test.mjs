import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// v11.11 (A7, wave3) — SUBSYSTEMS LIVE, PART 2. Extends (not duplicates)
// tests/v1110-subsystems.test.mjs: the founder asked for REAL subsystems
// driven DIRECTLY, so this suite upgrades the weakest proofs:
//
//   1. MCP — the REAL npm package `@modelcontextprotocol/server-filesystem`
//      (a genuine third-party stdio MCP server) is registered through
//      SADEEM's actual registry, probed (initialize handshake → serverInfo +
//      protocol negotiation → tools/list round-trip), and USED: both
//      `executeTool('mcp__real_fs__read_text_file')` on a REAL temp file and
//      a full engine run where the model calls the tool. Plus ONE real
//      JSON-RPC-over-HTTP MCP server (streamable-http style, session-gated,
//      ephemeral port) driven through registry → client → executeTool →
//      engine run, with a server-side receipt proving the physical call.
//   2. SKILLS — a user-written workspace skill: honest trust gate (NOT
//      injected before `.surnia/skills-trusted` consent, injected after),
//      trigger text provably inside the system prompt SENT TO THE PROVIDER,
//      use_skill invocation returning the full body, usage counter on disk,
//      trace-scan promotion candidate→verified, malformed-frontmatter skills
//      REFUSED with honest errors (validateSkillMarkdown + importSkillDir),
//      and the Settings-UI list endpoint (kdx:skills:list → listSkills)
//      returning the skill.
//   3. FLOWS — a real 3-step ordered run (write a → write b → run command)
//      through flowsService + the REAL engine; markRun persisted; the replay
//      validator executes the stored command for real. A flow whose middle
//      step fails records the honest failure (ok:false + exit code) and step
//      3 never runs; the replay validator honestly reports the failing exit.
//   4. SCHEDULED JOBS — invalid cron strings rejected at save and dropped at
//      load; the REAL tick logic fires an overdue 5-field cron job, the
//      headless run completes with output captured, and the re-arm window
//      prevents double-fire; the webhook trigger fires the job for real on a
//      live loopback listener, and the port is RELEASED on shutdown (the
//      same port rebinds and the listener still fires).
//
// Harness posture: esbuild bundles + electron stub + scripted local SSE mock
// (mock LLM provider only; every subsystem runs its REAL implementation).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import net from 'node:net';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-a7b-'));
const ud = join(tmp, 'userdata'); // electron-stub userData — every store lands here
mkdirSync(ud, { recursive: true });

// ---------- esbuild bundle (same posture as v1110-subsystems) ----------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, 
    entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// ---------- electron stub (userData → ud; BrowserWindow captures IPC sends) ----------
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `const CAPTURED = globalThis.__A7B_CAPTURED__ || (globalThis.__A7B_CAPTURED__ = []);
module.exports = {
  app: { getPath: (k) => (k === 'userData' ? ${JSON.stringify(ud)} : ${JSON.stringify(tmp)}), whenReady: async () => true, on() {}, quit() {}, isReady: () => true, getName: () => 'surnia-a7b', getVersion: () => '0.0.0-a7b' },
  ipcMain: { handle() {}, on() {} },
  ipcRenderer: { invoke: async () => ({}), on() {}, send() {} },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (channel, payload) => CAPTURED.push({ channel, payload }) } }] },
  Notification: { isSupported: () => false },
  shell: {}, dialog: {}, screen: {}, tray: {}, Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
  contextBridge: { exposeInMainWorld: () => {} }, webContents: { getAllWebContents: () => [] },
  nativeTheme: { shouldUseDarkColors: true }, globalShortcut: { register: () => true, unregisterAll: () => {} },
  clipboard: { readText: () => '', writeText: () => {} }, powerMonitor: { on() {} }, nativeImage: { createEmpty: () => ({}) },
  session: { defaultSession: { setProxy: async () => {}, clearCache: async () => {} } },
};
module.exports.default = module.exports;`);

// ---------- mock OpenAI-compatible SSE provider (records full requests) ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const toolDeltas = (name, args, id) => [
  { tool_calls: [{ index: 0, id, function: { name, arguments: '' } }] },
  { tool_calls: [{ index: 0, function: { arguments: args } }] },
];

const routes = new Map(); // model → handler queue
const requests = []; // { model, system, at }
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* {} */ }
    requests.push({ model: body.model, system: body.messages?.find((m) => m.role === 'system')?.content ?? '', at: Date.now() });
    const q = routes.get(body.model);
    const h = q && q.length ? q.shift() : null;
    if (!h) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `UNSCRIPTED request for model ${body.model}` } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.flushHeaders();
    try { await h({ res, body }); } catch { try { res.destroy(); } catch { /* gone */ } }
  });
});
const listen = new Promise((resolve) => mock.listen(0, '127.0.0.1', () => resolve(mock.address().port)));
/** Queue one scripted SSE turn: optional text, optional tool call, finish. */
function script(model, { text = null, tool = null, finish = null } = {}) {
  const q = routes.get(model) ?? [];
  q.push(async ({ res }) => {
    if (text !== null) res.write(sseChunk({ content: text }));
    if (tool) for (const d of toolDeltas(tool.name, typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args), tool.id ?? 'call_1')) res.write(sseChunk(d));
    res.write(sseChunk({}, finish ?? (tool ? 'tool_calls' : 'stop')));
    res.write('data: [DONE]\n\n');
    res.end();
  });
  routes.set(model, q);
}

// ---------- settings.json (providers → mock; DNA off so scripted turns stay exact) ----------
const BASE_URL = await listen;
writeFileSync(join(ud, 'settings.json'), JSON.stringify({
  schemaVersion: 4,
  providers: { custom: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${BASE_URL}` } },
  agent: { maxRetries: 0, autoCompact: false, autoVerify: false, autoMemory: false },
  dnaEnabled: false,
  doneNotifications: false,
}));

// ---------- bundles ----------
const B = {}; // name → module path
for (const [name, entry] of Object.entries({
  engine: 'electron/agent/engine.ts',
  skills: 'electron/agent/skills.ts',
  skillGate: 'electron/agent/skillGate.ts',
  mcp: 'electron/agent/mcp.ts',
  tools: 'electron/agent/tools.ts',
  dna: 'electron/agent/dna.ts',
  flows: 'electron/services/flowsService.ts',
  schedule: 'electron/services/scheduleService.ts',
  registry: 'electron/services/mcpRegistryService.ts',
})) {
  B[name] = join(tmp, `${name}.cjs`);
  bundle(entry, B[name]);
}
/** Fresh module instance (busts require cache) — proves on-disk persistence. */
function fresh(name) {
  delete require.cache[require.resolve(B[name])];
  return require(B[name]);
}
const engine = require(B.engine);
const tools = require(B.tools);

// ---------- engine harness ----------
function makeIo() {
  const events = [];
  return {
    events,
    send(e) { if (process.env.A7B_DEBUG) console.error('[evt]', e.type, String(e.text ?? e.output ?? e.message ?? '').slice(0, 90).replace(/\n/g, ' ')); events.push(e); },
    async getDecision(requestId) { return { requestId, action: 'allow' }; },
    isAborted: () => false,
    onFetchSignal() {},
  };
}
async function runEngine({ workspace, model, mcpServers, taskText = 'Do the task end to end.' }) {
  const io = makeIo();
  await engine.runAgent({
    task: 'chat',
    sessionId: 'sess-' + Math.random().toString(36).slice(2),
    messages: [{ id: 'm1', role: 'user', kind: 'text', content: taskText, timestamp: Date.now() }],
    model: { provider: 'custom', model, maxTokens: 2048 },
    mode: 'fullAccess',
    workspace,
    apiKey: 'test-key',
    baseUrl: `http://127.0.0.1:${BASE_URL}`,
    ...(mcpServers ? { mcpServers } : {}),
  }, io);
  return io;
}
const toolResultsFor = (io, toolCallId) => io.events.filter((e) => e.type === 'tool_result' && e.toolCallId === toolCallId);
async function waitFor(fn, ms, label) {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await sleep(200);
  }
}
const lastRequestSystem = (model) => [...requests].reverse().find((r) => r.model === model)?.system ?? '';
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

// ============================================================
// 1. MCP — the REAL npm package (stdlib filesystem server) + a real
//    JSON-RPC-over-HTTP MCP server, driven through SADEEM's registry,
//    client pool, agent-tool path and a full engine run.
// ============================================================

// The REAL third-party package (installed with `npm i --no-save`; the test
// re-installs defensively when the sandbox lost node_modules).
const FS_PKG_DIR = join(ROOT, 'node_modules', '@modelcontextprotocol', 'server-filesystem');
const FS_SERVER_ENTRY = join(FS_PKG_DIR, 'dist', 'index.js');
if (!existsSync(FS_SERVER_ENTRY)) {
  try {
    execFileSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', '@modelcontextprotocol/server-filesystem'],
      { cwd: ROOT, stdio: 'pipe', timeout: 180_000 });
  } catch (err) {
    console.error(`[A7b] could not install the real MCP package: ${err.message}`);
  }
}
const FS_AVAILABLE = existsSync(FS_SERVER_ENTRY);

// A REAL temp directory the filesystem server is allowed to touch + a REAL file in it.
const FS_ROOT = join(tmp, 'fs-root');
mkdirSync(FS_ROOT, { recursive: true });
const REAL_FILE = join(FS_ROOT, 'ledger.txt');
const REAL_FS_MARKER = 'A7B_REAL_FS_MARKER_77 — served by the genuine @modelcontextprotocol/server-filesystem';
writeFileSync(REAL_FILE, REAL_FS_MARKER, 'utf8');

const FS_CFG = {
  id: 'real-fs',
  name: 'Real FS',
  command: process.execPath,
  args: [FS_SERVER_ENTRY, FS_ROOT],
  enabled: true,
  transport: 'stdio',
};

test('A7b mcp REAL package: initialize handshake + tools/list round-trip via SADEEM\u2019s client', { skip: !FS_AVAILABLE && 'real package @modelcontextprotocol/server-filesystem unavailable in this sandbox' }, async () => {
  const mcp = fresh('mcp');
  const client = mcp.createClient(FS_CFG);
  await client.start(); // REAL spawn + initialize handshake
  assert.equal(client.sessionInfo?.serverInfo?.name, 'secure-filesystem-server',
    `real server identity negotiated: ${JSON.stringify(client.sessionInfo?.serverInfo)}`);
  assert.equal(client.sessionInfo?.protocolVersion, '2025-06-18', 'protocol version negotiated');
  const listed = await client.call('tools/list', {}, 15_000);
  const names = (listed.tools ?? []).map((t) => t.name);
  assert.ok(names.length >= 10, `real tools/list round-trip (${names.length} tools)`);
  assert.ok(names.includes('read_text_file') && names.includes('list_directory'), 'real filesystem tools discovered');
  const called = await client.call('tools/call', { name: 'read_text_file', arguments: { path: REAL_FILE } }, 15_000);
  const text = (called.content ?? []).map((p) => p.text ?? '').join('\n');
  assert.ok(text.includes('A7B_REAL_FS_MARKER_77'), 'tools/call returned the REAL file content');
  client.kill();
});

test('A7b mcp REAL package: registry register → probe → connected with the real tool inventory', { skip: !FS_AVAILABLE && 'real package @modelcontextprotocol/server-filesystem unavailable in this sandbox' }, async () => {
  const registry = fresh('registry');
  assert.equal(registry.saveServer(FS_CFG).ok, true, 'registry accepted the real stdio server');
  const listing = await registry.listServers();
  const st = listing.servers.find((s) => s.id === 'real-fs');
  assert.equal(st?.state, 'connected', `registry probe of the REAL server (${st?.error ?? 'ok'})`);
  assert.ok(st?.toolCount >= 10, `real tool inventory counted: ${st?.toolCount}`);
});

test('A7b mcp REAL package: executeTool mcp__real_fs__read_text_file reads a REAL temp file', { skip: !FS_AVAILABLE && 'real package @modelcontextprotocol/server-filesystem unavailable in this sandbox' }, async () => {
  const mcp = fresh('mcp');
  const toolsFor = (await mcp.mcpListTools(FS_CFG)).tools ?? [];
  assert.ok(toolsFor.some((t) => t.name === 'read_text_file'), 'mcpListTools round-trips the real server');
  const ctx = {
    workspace: tmp, sessionId: 'a7b-mcp-fs', mcpServers: [{ server: FS_CFG, tools: toolsFor }],
    emit() {}, approve: async () => true,
  };
  const out = await tools.executeTool('mcp__real_fs__read_text_file', JSON.stringify({ path: REAL_FILE }), ctx);
  assert.ok(out.ok, `agent-tool path executed the REAL server: ${out.output.slice(0, 160)}`);
  assert.ok(out.output.includes('A7B_REAL_FS_MARKER_77'), 'the REAL file content came back through executeTool');
  fresh('mcp').closeAllMcpClients();
});

test('A7b mcp REAL package: full engine run — the model invokes the real filesystem tool', { skip: !FS_AVAILABLE && 'real package @modelcontextprotocol/server-filesystem unavailable in this sandbox' }, async () => {
  script('mock-realfs', { tool: { name: 'mcp__real_fs__read_text_file', args: { path: REAL_FILE }, id: 'call_realfs' } });
  script('mock-realfs', { text: 'REALFS_RUN_DONE: the real MCP filesystem server served the ledger file end to end.' });
  const io = await runEngine({ workspace: tmp, model: 'mock-realfs', mcpServers: [FS_CFG] });
  assert.ok(lastRequestSystem('mock-realfs').includes('mcp__real_fs__read_text_file'),
    'engine advertised the real MCP tool in the system prompt');
  const start = io.events.find((e) => e.type === 'tool_start' && e.name === 'mcp__real_fs__read_text_file');
  assert.ok(start, 'model issued the MCP tool call through the real engine');
  const res = toolResultsFor(io, start.toolCallId)[0];
  assert.ok(res?.ok && res.output.includes('A7B_REAL_FS_MARKER_77'), 'REAL file content reached the engine');
  engine.closeAllMcpClients?.();
});

// ---------- real JSON-RPC-over-HTTP MCP server (session-gated, ephemeral port) ----------
const HTTP_SESS = 'a7b-http-session-9f2c';
const httpReceipt = join(tmp, 'a7b-http-receipt.jsonl');
const VAULT_NOTE = 'A7B_HTTP_VAULT_MARKER — served by the real JSON-RPC-over-HTTP MCP server';
let httpMcp;
const httpPort = await new Promise((resolve) => {
  const s = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let msg; try { msg = JSON.parse(raw || '{}'); } catch { msg = {}; }
      const reply = (status, obj, extra = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...extra });
        res.end(JSON.stringify(obj));
      };
      if (msg.id === undefined || msg.id === null) { res.writeHead(202); res.end(); return; } // notifications/initialized
      // streamable-http session gate: after initialize every request must echo the session id
      if (msg.method !== 'initialize' && req.headers['mcp-session-id'] !== HTTP_SESS) {
        reply(404, { jsonrpc: '2.0', id: msg.id, error: { code: -32001, message: 'unknown or missing mcp-session-id' } });
        return;
      }
      if (msg.method === 'initialize') {
        reply(200, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'http-vault', version: '2.0.1' } } }, { 'mcp-session-id': HTTP_SESS });
      } else if (msg.method === 'tools/list') {
        reply(200, { jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'vault_read', description: 'Read a note from the HTTP vault', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }] } });
      } else if (msg.method === 'tools/call') {
        appendFileSync(httpReceipt, JSON.stringify({
          tool: msg.params?.name, args: msg.params?.arguments,
          sess: req.headers['mcp-session-id'] ?? null, proto: req.headers['mcp-protocol-version'] ?? null,
        }) + '\n');
        reply(200, { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `${VAULT_NOTE} (path=${msg.params?.arguments?.path ?? ''})` }] } });
      } else {
        reply(200, { jsonrpc: '2.0', id: msg.id, result: {} }); // ping etc.
      }
    });
  });
  httpMcp = s;
  s.listen(0, '127.0.0.1', () => resolve(s.address().port));
});
const HTTP_CFG = { id: 'http-probe', name: 'HTTP Probe', transport: 'http', url: `http://127.0.0.1:${httpPort}/mcp`, enabled: true };

test('A7b mcp HTTP: registry + client round-trip against the real session-gated HTTP server', async () => {
  const registry = fresh('registry');
  assert.equal(registry.saveServer(HTTP_CFG).ok, true);
  const listing = await registry.listServers();
  const st = listing.servers.find((x) => x.id === 'http-probe');
  assert.equal(st?.state, 'connected', `HTTP MCP server probed connected (${st?.error ?? 'ok'})`);
  assert.ok(st?.toolCount >= 1, 'HTTP tools discovered');

  // the session gate is REAL: a session-less call is rejected by the server
  const raw = await fetch(`http://127.0.0.1:${httpPort}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  assert.equal(raw.status, 404, 'server refuses requests without the echoed mcp-session-id');

  const mcp = fresh('mcp');
  const remote = await mcp.mcpListTools(HTTP_CFG);
  assert.ok(remote.ok && remote.tools.some((t) => t.name === 'vault_read'), 'mcpListTools over the HTTP transport');
  const ctx = {
    workspace: tmp, sessionId: 'a7b-mcp-http', mcpServers: [{ server: HTTP_CFG, tools: remote.tools ?? [] }],
    emit() {}, approve: async () => true,
  };
  const out = await tools.executeTool('mcp__http_probe__vault_read', JSON.stringify({ path: 'note.txt' }), ctx);
  assert.ok(out.ok && out.output.includes('A7B_HTTP_VAULT_MARKER'), 'executeTool round-tripped the HTTP MCP server');
  const receipts = readFileSync(httpReceipt, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const last = receipts.at(-1);
  assert.equal(last.sess, HTTP_SESS, 'client echoed the mcp-session-id the server issued');
  assert.equal(last.proto, '2025-06-18', 'client declared the negotiated MCP-Protocol-Version');
  fresh('mcp').closeAllMcpClients();
});

test('A7b mcp HTTP: full engine run — model calls the HTTP MCP tool, server records the receipt', async () => {
  script('mock-httpmcp', { tool: { name: 'mcp__http_probe__vault_read', args: { path: 'note.txt' }, id: 'call_httpmcp' } });
  script('mock-httpmcp', { text: 'HTTP_MCP_RUN_DONE: the vault note arrived through the real HTTP MCP server.' });
  const io = await runEngine({ workspace: tmp, model: 'mock-httpmcp', mcpServers: [HTTP_CFG] });
  const start = io.events.find((e) => e.type === 'tool_start' && e.name === 'mcp__http_probe__vault_read');
  assert.ok(start, 'engine advertised + model called the HTTP MCP tool');
  const res = toolResultsFor(io, start.toolCallId)[0];
  assert.ok(res?.ok && res.output.includes('A7B_HTTP_VAULT_MARKER'), 'HTTP MCP result reached the engine');
  const receipts = readFileSync(httpReceipt, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(receipts.some((r) => r.tool === 'vault_read' && r.args?.path === 'note.txt'),
    'the HTTP server physically received the engine-routed call (receipt)');
  engine.closeAllMcpClients?.();
});

// ============================================================
// 2. SKILLS — REALLY used: trust gate → injected into the provider request →
//    invoked → usage recorded → trace-scan promotion. Plus honest rejection
//    of malformed frontmatter and the Settings-UI list endpoint.
// ============================================================
const WS_SKILL2 = join(tmp, 'ws-skill2');
mkdirSync(join(WS_SKILL2, '.surnia', 'skills', 'coral-ritual'), { recursive: true });
const TRIGGER = 'CORAL_TRIGGER_7F3: load this when debugging flaky maritime timing tests that flake under load';
const SKILL_BODY2 = 'CORAL_BODY_9K2 — reproduce the race twice, capture the interleaving log, then pin the tide window before patching.';
writeFileSync(join(WS_SKILL2, '.surnia', 'skills', 'coral-ritual', 'SKILL.md'),
  `---\nname: Coral Ritual\ndescription: ${TRIGGER}\n---\n# Coral Ritual\n${SKILL_BODY2}\n`);

test('A7b skills: workspace trust gate holds, then consent → skill text lands in the REAL provider request', async () => {
  // BEFORE consent: the engine must NOT inject the untrusted workspace skill
  script('mock-wskill-a', { text: 'Acknowledged — I will wait for the next instruction.' });
  await runEngine({ workspace: WS_SKILL2, model: 'mock-wskill-a' });
  const sysBefore = lastRequestSystem('mock-wskill-a');
  assert.ok(!sysBefore.includes('CORAL_TRIGGER_7F3') && !sysBefore.includes('Coral Ritual'),
    'trust gate: untrusted workspace skill is NOT injected into the provider prompt');

  // consent via the REAL API behind kdx:skills:trust
  const dna = fresh('dna');
  assert.equal(dna.trustWorkspaceSkills(WS_SKILL2), true, 'consent marker written');
  assert.ok(existsSync(join(WS_SKILL2, '.surnia', 'skills-trusted')), '.surnia/skills-trusted exists');

  // AFTER consent: the skill text (name + trigger from the user\u2019s SKILL.md) is injected
  script('mock-wskill-b', { text: 'Ready — I noted the Coral Ritual procedure from the skills index.' });
  await runEngine({ workspace: WS_SKILL2, model: 'mock-wskill-b' });
  const sys = lastRequestSystem('mock-wskill-b');
  assert.ok(sys.includes('# SKILLS'), 'engine injected the SKILLS section');
  assert.ok(sys.includes('CORAL_TRIGGER_7F3'), 'the user-written trigger text is inside the prompt SENT TO THE PROVIDER');
  assert.ok(sys.includes('Coral Ritual') && sys.includes('use_skill'), 'the prompt teaches the use_skill path');

  // Settings-UI list endpoint (kdx:skills:list → listSkills) returns it
  const list = await fresh('skills').listSkills(WS_SKILL2);
  const hit = list.find((s) => s.slug === 'coral-ritual');
  assert.ok(hit, 'listSkills (kdx:skills:list) returns the user skill');
  assert.equal(hit.scope, 'workspace', 'reported with its real scope');
  assert.ok(hit.description.includes('CORAL_TRIGGER_7F3'), 'the real trigger description reaches the Settings UI');
});

test('A7b skills: model invokes use_skill → full body returned → usage recorded → trace-scan promotion', async () => {
  script('mock-wskill-c', { tool: { name: 'use_skill', args: { slug: 'coral-ritual' }, id: 'call_ws_skill' } });
  script('mock-wskill-c', { text: 'CORAL_APPLIED_4T8: followed the Coral Ritual steps for the flaky timing test.' });
  const io = await runEngine({ workspace: WS_SKILL2, model: 'mock-wskill-c' });
  const start = io.events.find((e) => e.type === 'tool_start' && e.name === 'use_skill');
  assert.ok(start, 'model issued use_skill through the real engine');
  const res = toolResultsFor(io, start.toolCallId)[0];
  assert.ok(res?.ok, 'use_skill executed OK');
  assert.ok(res.output.includes('CORAL_BODY_9K2'), 'use_skill returned the full skill body');

  const raw = readFileSync(join(WS_SKILL2, '.surnia', 'skills', 'coral-ritual', 'SKILL.md'), 'utf8');
  assert.ok(/uses:\s*1/.test(raw), 'usage counter recorded in the SKILL.md frontmatter');

  // Evidence gate: the REAL trace scan must promote the candidate.
  const scan = fresh('skillGate').promoteSkillsFromTraces(ud, 7);
  assert.ok(scan.scanned >= 1, `trace scan consumed real traces (${scan.scanned})`);
  assert.ok(scan.skillUses.has('coral-ritual'), 'scan matched the use_skill slug');
  const status = await waitFor(() => {
    const g = fresh('skillGate');
    return g.skillGateStatus(ud, 'coral-ritual', false) === 'verified' ? 'verified' : null;
  }, 8000, 'skill gate promotion');
  assert.equal(status, 'verified', 'candidate → verified after real evidence');
});

test('A7b skills: malformed frontmatter refused with honest errors; valid import still works', async () => {
  const skills = fresh('skills');
  const broken = '---\nname: Broken Ritual\nthis line never closes the frontmatter block';
  const v1 = skills.validateSkillMarkdown(broken);
  assert.equal(v1.ok, false, 'unterminated frontmatter rejected');
  assert.ok(v1.errors.some((e) => /closing "---"/.test(e)), `honest error: ${v1.errors.join(' | ')}`);
  const v2 = skills.validateSkillMarkdown('---\nname:\ndescription: x\n---\nbody without heading');
  assert.equal(v2.ok, false, 'empty name value rejected');
  assert.ok(v2.errors.some((e) => /empty "name:"/.test(e)), `honest error: ${v2.errors.join(' | ')}`);
  const v3 = skills.validateSkillMarkdown('---\ndescription: only desc\n---\n');
  assert.equal(v3.ok, false, 'no name + no heading + empty body rejected');
  assert.equal(skills.validateSkillMarkdown('# Just a heading\nReal instructions here.').ok, true,
    'frontmatter-less skills with a heading stay importable');

  const badDir = join(tmp, 'bad-skill-src');
  mkdirSync(badDir, { recursive: true });
  writeFileSync(join(badDir, 'SKILL.md'), broken);
  assert.equal(await skills.importSkillDir(WS_SKILL2, badDir, 'workspace'), null,
    'import of the malformed skill honestly refused');

  const goodDir = join(tmp, 'good-skill-src');
  mkdirSync(goodDir, { recursive: true });
  writeFileSync(join(goodDir, 'SKILL.md'), '---\nname: Valid Import\ndescription: A well-formed imported skill\n---\n# Valid Import\nDo the thing carefully.');
  const slug = await skills.importSkillDir(WS_SKILL2, goodDir, 'workspace');
  assert.equal(slug, 'valid-import', 'valid import succeeds');
  assert.ok((await fresh('skills').listSkills(WS_SKILL2)).some((s) => s.slug === 'valid-import'),
    'imported skill appears in the list endpoint');
});

// ============================================================
// 3. FLOWS — real 3-step ordered run + honest failure semantics.
// ============================================================
test('A7b flows: real 3-step run (write a → write b → run command) → markRun persisted → replay executes for real', async () => {
  const flows = fresh('flows');
  const list = await flows.flowsSave({ name: 'A7B triple step', prompt: 'Create alpha.txt, then beta.txt, then run the gamma command that writes gamma.txt.' });
  const flow = list.find((f) => f.name === 'A7B triple step');
  assert.ok(flow, 'flow saved + listed');

  const WS_FLOW3 = join(tmp, 'ws-flow3');
  mkdirSync(WS_FLOW3, { recursive: true });
  script('mock-flow3', { tool: { name: 'write_file', args: { path: 'alpha.txt', content: 'alpha body' }, id: 'c1' } });
  script('mock-flow3', { tool: { name: 'write_file', args: { path: 'beta.txt', content: 'beta body' }, id: 'c2' } });
  script('mock-flow3', { tool: { name: 'run_command', args: { command: `node -e "require('node:fs').writeFileSync('gamma.txt','gamma-from-command')"` }, id: 'c3' } });
  script('mock-flow3', { text: 'TRIPLE_DONE: alpha and beta written, then the command created gamma.txt.' });
  const io = await runEngine({ workspace: WS_FLOW3, model: 'mock-flow3', taskText: flow.prompt });

  const starts = io.events.filter((e) => e.type === 'tool_start');
  assert.deepEqual(starts.map((s) => s.name), ['write_file', 'write_file', 'run_command'], '3 steps in exact order');
  for (const s of starts) assert.ok(toolResultsFor(io, s.toolCallId)[0]?.ok, `${s.name} step succeeded`);
  assert.equal(readFileSync(join(WS_FLOW3, 'alpha.txt'), 'utf8'), 'alpha body', 'step 1 on disk');
  assert.equal(readFileSync(join(WS_FLOW3, 'beta.txt'), 'utf8'), 'beta body', 'step 2 on disk');
  assert.ok(existsSync(join(WS_FLOW3, 'gamma.txt')), 'step 3 (run_command) really executed');

  await flows.flowsMarkRun(flow.id);
  const afterRun = fresh('flows').flowsList().find((f) => f.id === flow.id);
  assert.equal(afterRun.runCount, 1, 'runCount persisted');
  assert.ok(afterRun.lastRun > 0, 'lastRun persisted');
  const onDisk = JSON.parse(readFileSync(join(ud, 'flows.json'), 'utf8'));
  assert.ok(onDisk.flows.some((f) => f.id === flow.id && f.runCount === 1), 'flows.json on disk carries the run');

  // the replay validator executes the STORED COMMAND for real
  const rl = await flows.flowsSave({ name: 'A7B replay', prompt: `node -e "require('node:fs').writeFileSync('replay-a7b.txt','ok')"` });
  const rf = rl.find((f) => f.name === 'A7B replay');
  const replay = await flows.flowsValidateByReplay(rf.id, WS_FLOW3);
  assert.equal(replay.ok, true, `replay exit 0 (${replay.detail})`);
  assert.ok(existsSync(join(WS_FLOW3, 'replay-a7b.txt')), 'replay command really executed');
});

test('A7b flows: middle step fails — honest failure recorded (ok:false + exit code), step 3 never runs', async () => {
  const flows = fresh('flows');
  const WS_FAIL = join(tmp, 'ws-flowfail');
  mkdirSync(WS_FAIL, { recursive: true });
  script('mock-flowfail', { tool: { name: 'write_file', args: { path: 'mid-a.txt', content: 'before the failure' }, id: 'f1' } });
  script('mock-flowfail', { tool: { name: 'run_command', args: { command: 'node -e "process.exit(3)"' }, id: 'f2' } });
  script('mock-flowfail', { text: 'MID_FAIL_ACK: the probe exited with code 3, so I stopped without creating mid-c.txt.' });
  const io = await runEngine({ workspace: WS_FAIL, model: 'mock-flowfail', taskText: 'Write mid-a.txt, then run the failing probe, then write mid-c.txt.' });

  const writes = io.events.filter((e) => e.type === 'tool_start' && e.name === 'write_file');
  assert.equal(writes.length, 1, 'only the first write ran');
  assert.equal(writes[0].args.path, 'mid-a.txt', 'step 1 executed');
  const cmdStart = io.events.find((e) => e.type === 'tool_start' && e.name === 'run_command');
  assert.ok(cmdStart, 'the middle step (run_command) executed');
  const cmdRes = toolResultsFor(io, cmdStart.toolCallId)[0];
  assert.equal(cmdRes?.ok, false, 'the failing middle step is recorded with honest status');
  assert.ok(cmdRes.output.includes('[exit code: 3]'), `honest error output: ${cmdRes.output.slice(0, 160)}`);
  assert.ok(existsSync(join(WS_FAIL, 'mid-a.txt')), 'step 1 artifact exists');
  assert.ok(!existsSync(join(WS_FAIL, 'mid-c.txt')), 'step 3 never ran after the honest failure');

  // the replay validator reports a failing stored command honestly
  const fl = await flows.flowsSave({ name: 'A7B failing replay', prompt: 'node -e "process.exit(3)"' });
  const ff = fl.find((f) => f.name === 'A7B failing replay');
  const bad = await flows.flowsValidateByReplay(ff.id, WS_FAIL);
  assert.equal(bad.ok, false, 'replay honestly reports the failure');
  assert.equal(bad.exitCode, 3, 'exit code preserved');
  assert.ok(/replay failed/.test(bad.detail), `honest detail: ${bad.detail}`);
});

// ============================================================
// 4. SCHEDULED JOBS — invalid cron rejected, real tick fires, re-arm holds,
//    webhook trigger fires for real, port released on shutdown.
// ============================================================
const WS_JOB = join(tmp, 'ws-jobs');
mkdirSync(WS_JOB, { recursive: true });
const schedBoot = () => {
  const s = fresh('schedule');
  s.initScheduleService({ userDataDir: ud, broadcast: () => {} });
  return s;
};

test('A7b schedule: invalid cron strings rejected at save; corrupt cron dropped at load', () => {
  const sched = schedBoot();
  assert.throws(() => sched.addJob({ name: 'bad1', prompt: 'x', workspace: WS_JOB, cron: 'not-a-cron' }), /INVALID_CRON/, 'garbage cron rejected');
  assert.throws(() => sched.addJob({ name: 'bad2', prompt: 'x', workspace: WS_JOB, cron: '99 99 99 99 99' }), /INVALID_CRON/, 'out-of-range fields rejected');
  assert.throws(() => sched.addJob({ name: 'bad3', prompt: 'x', workspace: WS_JOB, cron: '* * * * * *' }), /INVALID_CRON/, '6-field cron rejected');
  const daily = sched.addJob({ name: 'Alias ok', prompt: 'kept job', workspace: WS_JOB, cron: '@daily', model: { provider: 'custom', model: 'mock-never' } });
  assert.ok(daily.id, 'valid alias cron accepted');

  // a corrupt cron in the store is DROPPED on load (sanitizeJob), valid ones kept
  writeFileSync(join(ud, 'schedules.json'), JSON.stringify([
    { id: 'a7b-keep', name: 'Keep', prompt: 'kept job', workspace: WS_JOB, cron: '0 3 * * *', enabled: true, createdAt: Date.now() },
    { id: 'a7b-drop', name: 'Drop', prompt: 'bad cron job', workspace: WS_JOB, cron: 'banana', enabled: true, createdAt: Date.now() },
  ]));
  sched.shutdownScheduleService();
  const re = schedBoot();
  const ids = re.listJobs().map((j) => j.id);
  assert.ok(ids.includes('a7b-keep'), 'valid job survives reload');
  assert.ok(!ids.includes('a7b-drop'), 'invalid-cron job dropped at load');
  re.shutdownScheduleService();
});

test('A7b schedule: the REAL tick fires an overdue 5-field cron → headless run output captured → re-arm holds', async () => {
  script('mock-cron-a7b', { text: 'A7B_CRON_FIRED: the overdue scheduled job ran end to end and produced this line.' });
  writeFileSync(join(ud, 'schedules.json'), JSON.stringify([
    { id: 'a7b-cron', name: 'Overdue cron', prompt: 'Run the overdue sweep.', workspace: WS_JOB, cron: '* * * * *', enabled: true, mode: 'autoEdit', model: { provider: 'custom', model: 'mock-cron-a7b' }, createdAt: Date.now() - 15 * 60000, lastRun: Date.now() - 10 * 60000 },
  ]));
  const sched = schedBoot();
  const due = sched.runSchedulerTick();
  assert.ok(due >= 1, `tick sees the overdue job as due (due=${due})`);
  const fired = await waitFor(() => {
    const j = sched.listJobs().find((x) => x.id === 'a7b-cron');
    return j?.lastStatus === 'ok' ? j : null;
  }, 60_000, 'overdue cron job fired + completed');
  assert.ok(fired.lastMessage.includes('A7B_CRON_FIRED'), 'headless run output captured in the job');
  const onDisk = JSON.parse(readFileSync(join(ud, 'schedules.json'), 'utf8'));
  assert.ok(onDisk.some((j) => j.id === 'a7b-cron' && j.lastStatus === 'ok'), 'schedules.json persisted the result');

  // re-arm: inside the 60s window the same tick must NOT fire it again
  const lastRun = fired.lastRun;
  assert.equal(sched.runSchedulerTick(), 0, 're-arm: tick sees no due job inside the window');
  await sleep(1500);
  const again = sched.listJobs().find((x) => x.id === 'a7b-cron');
  assert.equal(again.lastRun, lastRun, 'no double-fire inside the re-arm window');
  sched.shutdownScheduleService();
});

test('A7b schedule: webhook trigger fires the job for real; port released on shutdown (rebind succeeds)', async () => {
  const sched = schedBoot();
  sched.stopWebhookListener(); // take over the loopback port for THIS test
  const port = await freePort();
  const started = sched.startWebhookListener(port);
  assert.equal(started.ok, true, `webhook listener bound 127.0.0.1:${port} (${started.detail})`);
  const token = sched.webhookToken();
  assert.ok(token && token.length >= 16, 'install token minted');
  const job = sched.addJob({ name: 'A7B webhook job', prompt: 'Run the webhook probe.', workspace: WS_JOB, cron: '0 3 * * *', model: { provider: 'custom', model: 'mock-webhook' } });

  script('mock-webhook', { text: 'A7B_WEBHOOK_FIRED: the webhook trigger ran this job headlessly end to end.' });
  const post = await fetch(`http://127.0.0.1:${port}/trigger/${job.id}?token=${token}`, { method: 'POST' });
  assert.equal(post.status, 200, 'webhook accepted the trigger');
  assert.deepEqual(await post.json(), { accepted: true });
  const forbidden = await fetch(`http://127.0.0.1:${port}/trigger/${job.id}?token=WRONG`, { method: 'POST' });
  assert.equal(forbidden.status, 403, 'bad token rejected');
  const fired = await waitFor(() => {
    const j = sched.listJobs().find((x) => x.id === job.id);
    return j?.lastStatus === 'ok' ? j : null;
  }, 60_000, 'webhook-fired job completed');
  assert.ok(fired.lastMessage.includes('A7B_WEBHOOK_FIRED'), 'webhook → fireJob → headless agent run produced output');
  const firedLastRun = fired.lastRun; // numeric snapshot — listJobs() returns LIVE job objects

  // shutdown releases the port: the SAME port must rebind, and the re-armed
  // listener must still fire the job end-to-end.
  sched.stopWebhookListener();
  const probe = http.createServer(() => {});
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', () => resolve()); });
  await new Promise((r) => probe.close(r)); // port was free → shutdown released it
  const re = sched.startWebhookListener(port);
  assert.equal(re.ok, true, 'listener re-armed on the released port');
  script('mock-webhook', { text: 'A7B_WEBHOOK_REFIRED: the rebound listener triggered the job again.' });
  const post2 = await fetch(`http://127.0.0.1:${port}/trigger/${job.id}?token=${token}`, { method: 'POST' });
  assert.equal(post2.status, 200, 're-armed listener accepted the trigger');
  const refired = await waitFor(() => {
    const j = sched.listJobs().find((x) => x.id === job.id);
    return j?.lastRun > firedLastRun && j.lastStatus === 'ok' ? j : null;
  }, 60_000, 'refire after rebind').catch((err) => {
    console.error('[A7b webhook debug] jobs:', JSON.stringify(sched.listJobs(), null, 1));
    console.error('[A7b webhook debug] provider requests for mock-webhook:', requests.filter((r) => r.model === 'mock-webhook').length);
    throw err;
  });
  assert.ok(refired.lastMessage.includes('A7B_WEBHOOK_REFIRED'), 'the rebound webhook fired the job again');
  sched.stopWebhookListener();
  sched.shutdownScheduleService();
});

// ---------- cleanup: real servers/clients were opened — close them so the file exits ----------
after(async () => {
  try { fresh('mcp').closeAllMcpClients(); } catch { /* already closed */ }
  try { fresh('mcp').stopMcpHealthMonitor?.(); } catch { /* optional */ }
  // the ENGINE and TOOLS bundles carry their own mcp.ts instances (separate pools)
  try { engine.closeAllMcpClients?.(); } catch { /* none open */ }
  try { engine.stopMcpHealthMonitor?.(); } catch { /* optional */ }
  try { fresh('schedule').shutdownScheduleService(); } catch { /* optional */ }
  try { fresh('schedule').stopWebhookListener(); } catch { /* optional */ }
  try { mock.closeAllConnections?.(); } catch { /* node <18.2 */ }
  try { httpMcp?.closeAllConnections?.(); } catch { /* node <18.2 */ }
  await new Promise((r) => mock.close(r));
  if (httpMcp) await new Promise((r) => httpMcp.close(r));
});
