// ============================================================================
// v11.38 — MCP CAN ACTUALLY BE USED (end-to-end proof, no mocked client)
//
// The founder: "كل سيرفرات الـ MCP بيطلع لي ايرور… روح شغّل البلندر واعمل
// مجسم 3D". This suite drives the REAL client layer (mcp.ts) against REAL
// processes / HTTP sockets speaking the MCP JSON-RPC protocol:
//
//   1. a stdio "Blender bridge" that boots, advertises 3 tools and CREATES A
//      3D MODEL (marker file proves tools/call really reached the process);
//   2. a strict server that REJECTS the newest protocol revision → the client
//      must downgrade and still list/call;
//   3. a streamable-HTTP server answering with SSE-framed JSON-RPC;
//   4. a disconnected server → ONE short, honest, actionable error (no giant
//      stack trace, no phantom tools);
//   5. the real registry + canonical tool defs + real executeTool dispatch.
//
// Run: node --test --test-force-exit tests/v1138-mcp-real.test.mjs
// ============================================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1138-real-'));
const userData = join(tmp, 'userdata');
mkdirSync(userData, { recursive: true });
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ schemaVersion: 4, language: 'en', mcpServers: [] }));

const NO_STACK = (s) => !/\n\s+at\s+/.test(String(s ?? '')) && !/node:internal|node_modules[\\/]/.test(String(s ?? ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- minimal Electron stub (the client layer only uses app/ipcMain/BrowserWindow) ----------
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `
const p = ${JSON.stringify(userData)};
module.exports = {
  app: { getPath: (k) => (k === 'userData' ? p : p), isReady: () => false, whenReady: async () => {}, on() {}, quit() {} },
  ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
  BrowserWindow: { getAllWindows: () => [] }, Notification: { isSupported: () => false },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder() {}, trashItem: async () => {} },
  clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
  powerMonitor: { on() {} }, screen: {},
};`);

// ---------- one bundle with the REAL modules ----------
const entry = join(tmp, 'v1138-entry.ts');
writeFileSync(entry, [
  `export * from '${join(ROOT, 'electron/agent/mcp.ts').replace(/\\/g, '/')}';`,
  `export * from '${join(ROOT, 'electron/agent/tool-defs.ts').replace(/\\/g, '/')}';`,
  `export * from '${join(ROOT, 'electron/agent/tools.ts').replace(/\\/g, '/')}';`,
  `export * from '${join(ROOT, 'electron/services/mcpRegistryService.ts').replace(/\\/g, '/')}';`,
  `export { invalidateSettingsCache } from '${join(ROOT, 'electron/services/storeService.ts').replace(/\\/g, '/')}';`,
].join('\n'));

let api = null;
try {
  const out = join(tmp, 'v1138.cjs');
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, entry,
    '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
  api = require(out);
} catch (err) {
  console.error('[v1138] bundle failed:', err?.stack ?? err);
}

after(() => {
  try { api?.stopMcpHealthMonitor?.(); } catch { /* best effort */ }
  try { api?.closeAllMcpClients?.(); } catch { /* best effort */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

function writeServers(servers) {
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ schemaVersion: 4, language: 'en', mcpServers: servers }));
  api?.invalidateSettingsCache?.();
}

// ---------------------------------------------------------------------------
// REAL stdio fake MCP server: a Blender-like bridge. It deliberately writes a
// NON-JSON boot line to stdout (real bridges log there), answers initialize
// with an OLDER revision, and writes a marker when a 3D model is created.
// ---------------------------------------------------------------------------
const BLENDER_TOOLS = [
  { name: 'create_model', description: 'Create a 3D model inside Blender',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, format: { type: 'string' } }, required: ['name'] } },
  { name: 'render_scene', description: 'Render the active Blender scene',
    inputSchema: { type: 'object', properties: { samples: { type: 'integer' } }, required: [] } },
  { name: 'export_glb', description: 'Export the model as GLB',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: [] } },
];

function makeStdioServer({ marker, versionsFile, rejectNewest = false } = {}) {
  const file = join(tmp, 'server-' + Math.random().toString(36).slice(2) + '.cjs');
  writeFileSync(file, `
const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
const marker = ${JSON.stringify(marker ?? null)};
const versionsFile = ${JSON.stringify(versionsFile ?? null)};
const rejectNewest = ${JSON.stringify(rejectNewest)};
const tools = ${JSON.stringify(BLENDER_TOOLS)};
process.stdout.write('[blender-bridge] booting — waiting for the MCP handshake\\n'); // stdout noise, NOT JSON
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined || m.id === null || !m.method) return;
  if (versionsFile) { try { fs.appendFileSync(versionsFile, String(m.params?.protocolVersion ?? '') + '\\n'); } catch {} }
  let result;
  if (m.method === 'initialize') {
    const asked = String(m.params?.protocolVersion ?? '');
    if (rejectNewest && asked === '2025-11-25') {
      return send({ jsonrpc: '2.0', id: m.id, error: { code: -32600, message: 'Unsupported protocol version: use 2025-06-18' } });
    }
    result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-blender-bridge', version: '2.9.0' } };
  } else if (m.method === 'tools/list') {
    result = { tools };
  } else if (m.method === 'tools/call') {
    const name = String(m.params?.name ?? 'unknown');
    const args = m.params?.arguments ?? {};
    if (marker) {
      try { fs.writeFileSync(marker, JSON.stringify({ launched: true, pid: process.pid, tool: name, args })); } catch {}
    }
    const text = name === 'create_model'
      ? 'MODEL_3D_CREATED name=' + String(args.name ?? '?') + ' format=' + String(args.format ?? 'glb') + ' vertices=8 faces=12'
      : 'CALLED:' + name;
    result = { content: [{ type: 'text', text }], structuredContent: { tool: name, ok: true } };
  } else if (m.method === 'ping') {
    result = {};
  } else {
    result = {};
  }
  send({ jsonrpc: '2.0', id: m.id, result });
});
`);
  return file;
}

function stdioCfg(extra = {}) {
  return {
    id: 'v1138-blender', name: 'Blender', command: process.execPath,
    args: [makeStdioServer(extra)], enabled: true, transport: 'stdio',
    // NOTE: no timeoutMs on purpose — exercise the REAL generous default.
    ...(extra.config ?? {}),
  };
}

const ctx = (servers) => ({
  workspace: tmp, sessionId: 'v1138-mcp-real', mcpServers: servers,
  emit: () => {}, approve: async () => true, fullAccess: true,
});

// ---------------------------------------------------------------------------
test('v1138 startup budget + error shaping: no more giant stack in chat', () => {
  assert.ok(api, 'bundle must load');
  const cfg = { id: 'x', name: 'Blender', command: 'node', enabled: true };
  assert.ok(api.startupTimeoutMs(cfg) >= 60_000, 'cold npx/uvx installs get minutes, not 10 seconds');
  assert.equal(api.startupTimeoutMs({ ...cfg, timeoutMs: 1234 }), 1234, 'an explicit operator timeout still wins');

  const traceback = 'Python traceback: boom\n' + Array.from({ length: 200 }, (_, i) =>
    `  File "server.py", line ${i}, in do_it\n    raise RuntimeError("x")` ).join('\n');
  const friendly = api.mcpFriendlyError(cfg, traceback);
  assert.ok(friendly.includes('Blender'), 'names the server');
  assert.ok(friendly.length < 700, `single-line, capped error (got ${friendly.length})`);
  assert.equal(NO_STACK(friendly), true, 'no "at …" stack frames leaked into chat');
  assert.match(friendly, /Settings → MCP/, 'has a concrete next step');
});

// ---------------------------------------------------------------------------
test('v1138 REAL stdio Blender bridge: connect → 3 tools → real 3D-model result', { timeout: 30_000 }, async () => {
  assert.ok(api, 'bundle must load');
  const marker = join(tmp, 'blender-launched.json');
  try { rmSync(marker, { force: true }); } catch { /* none */ }
  const cfg = stdioCfg({ marker });

  // 1. connect (initialize handshake) + list ALL 3 tools
  const listed = await api.mcpListTools(cfg);
  assert.equal(listed.ok, true, `handshake + tools/list must succeed: ${listed.error ?? ''}`);
  assert.equal(listed.tools.length, 3, 'all three Blender tools are listable');
  assert.deepEqual(listed.tools.map((t) => t.name).sort(),
    ['create_model', 'export_glb', 'render_scene'], 'exact tool names from the wire');

  // 2. call one for real — the fake Blender process receives tools/call
  const called = await api.mcpCallTool(cfg, 'create_model', { name: 'cell_mitochondrion', format: 'glb' });
  assert.equal(called.ok, true, `tools/call must succeed: ${called.error ?? ''}`);
  assert.match(called.output, /MODEL_3D_CREATED name=cell_mitochondrion format=glb/, 'real model result relayed');
  assert.equal(existsSync(marker), true, 'the fake Blender process actually ran the tool');
  const proof = JSON.parse(readFileSync(marker, 'utf8'));
  assert.equal(proof.launched, true);
  assert.equal(proof.tool, 'create_model');
  assert.equal(proof.args.name, 'cell_mitochondrion');
  console.log('# V1138_STDIO=' + JSON.stringify({ tools: listed.tools.length, model: called.output, pid: proof.pid }));
});

// ---------------------------------------------------------------------------
test('v1138 strict server rejecting 2025-11-25: protocol downgrade, still usable', { timeout: 30_000 }, async () => {
  assert.ok(api, 'bundle must load');
  const versionsFile = join(tmp, 'protocol-versions.txt');
  try { rmSync(versionsFile, { force: true }); } catch { /* none */ }
  const cfg = stdioCfg({ versionsFile, rejectNewest: true, config: { id: 'v1138-strict', name: 'Strict Blender' } });

  const listed = await api.mcpListTools(cfg);
  assert.equal(listed.ok, true, `a strict server must still connect: ${listed.error ?? ''}`);
  assert.equal(listed.tools.length, 3, 'tools are listable after one bounded downgrade');
  const versions = readFileSync(versionsFile, 'utf8').trim().split('\n').filter(Boolean);
  assert.equal(versions[0], '2025-11-25', 'newest revision tried first');
  assert.equal(versions.includes('2025-06-18'), true, 'older revision tried after an explicit rejection');
  assert.ok(versions.length <= 3, 'bounded retries — never a protocol loop');

  const called = await api.mcpCallTool(cfg, 'render_scene', { samples: 16 });
  assert.equal(called.ok, true, `call after downgrade must work: ${called.error ?? ''}`);
  assert.match(called.output, /CALLED:render_scene/);
  console.log('# V1138_PROTOCOL=' + JSON.stringify(versions));
});

// ---------------------------------------------------------------------------
test('v1138 streamable HTTP: SSE-framed initialize/list + real tools/call', { timeout: 30_000 }, async () => {
  assert.ok(api, 'bundle must load');
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let m;
      try { m = JSON.parse(raw || '{}'); } catch { res.writeHead(400).end(); return; }
      seen.push({ method: m.method, version: req.headers['mcp-protocol-version'] });
      let result;
      if (m.method === 'initialize') {
        result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'http-bridge', version: '1' } };
      } else if (m.method === 'tools/list') {
        result = { tools: BLENDER_TOOLS };
      } else if (m.method === 'tools/call') {
        result = { content: [{ type: 'text', text: 'HTTP_3D_MODEL::' + String(m.params?.arguments?.name ?? '') }] };
      } else result = {};
      const frame = 'data: ' + JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n\n';
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'mcp-session-id': 'v1138-session',
        'cache-control': 'no-cache',
      });
      res.end(frame);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/mcp`;
    const cfg = { id: 'v1138-http', name: 'HTTP Bridge', transport: 'http', url, enabled: true };
    const listed = await api.mcpListTools(cfg);
    assert.equal(listed.ok, true, `SSE-framed tools/list must work: ${listed.error ?? ''}`);
    assert.equal(listed.tools.length, 3, 'all 3 tools listed over HTTP/SSE');
    const called = await api.mcpCallTool(cfg, 'create_model', { name: 'http_cube' });
    assert.equal(called.ok, true, `HTTP tools/call must work: ${called.error ?? ''}`);
    assert.match(called.output, /HTTP_3D_MODEL::http_cube/);
    assert.ok(seen.some((r) => r.method === 'initialize'), 'initialize reached the server');
    assert.ok(seen.some((r) => r.method === 'tools/list' && !!r.version), 'negotiated MCP-Protocol-Version header sent');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ---------------------------------------------------------------------------
test('v1138 registry + canonical defs + real dispatch (Blender end to end)', { timeout: 30_000 }, async () => {
  assert.ok(api, 'bundle must load');
  const marker = join(tmp, 'blender-e2e.json');
  try { rmSync(marker, { force: true }); } catch { /* none */ }
  const cfg = stdioCfg({ marker, config: { id: 'v1138-e2e', name: 'Blender E2E' } });
  writeServers([cfg]);

  const snap = await api.connectedServersWithTools();
  assert.equal(snap.servers.length, 1, 'the connected server is reported as connected');
  assert.equal(snap.errors.length, 0, 'no errors for a healthy server');
  assert.equal(snap.servers[0].tools.length, 3, 'all 3 tools available on the cold snapshot');

  const defs = await api.connectedMcpToolDefs();
  assert.equal(defs.length, 3, 'canonical builder emits 3 real defs');
  for (const name of ['create_model', 'render_scene', 'export_glb']) {
    const d = defs.find((x) => x.name === `mcp__blender_e2e__${name}`);
    assert.ok(d, `def ${name} exists`);
    assert.equal(d.kind, 'mcp');
    assert.equal(d.parameters?.type, 'object', 'inputSchema became JSON-Schema parameters');
  }

  const result = await api.executeTool('mcp__blender_e2e__create_model',
    JSON.stringify({ name: 'protein_complex', format: 'glb' }), ctx([{ server: cfg, tools: snap.servers[0].tools }]));
  assert.equal(result.ok, true, `real executeTool dispatch works: ${result.output}`);
  assert.match(result.output, /MODEL_3D_CREATED name=protein_complex/, '3D-model result reaches the agent');
  assert.equal(existsSync(marker), true, 'Blender bridge received the call');
  writeServers([]);
  console.log('# V1138_END_TO_END=1 server, 3 tools, 3 defs, real model result');
});

// ---------------------------------------------------------------------------
test('v1138 disconnected server: one honest error, zero phantom defs', { timeout: 30_000 }, async () => {
  assert.ok(api, 'bundle must load');
  const dead = { id: 'v1138-dead', name: 'Dead Blender', command: '__v1138_no_such_binary__', args: [], enabled: true, transport: 'stdio' };
  writeServers([dead]);

  const listed = await api.mcpListTools(dead);
  assert.equal(listed.ok, false);
  const err = String(listed.error ?? '');
  assert.ok(err.length > 0 && err.length < 700, `one short error, not a giant dump (${err.length} chars)`);
  assert.equal(NO_STACK(err), true, 'no stack frames');
  assert.ok(/Settings → MCP|not found|not recognized|ENOENT/i.test(err), 'error tells the user what to fix');
  assert.ok(!/I can(?:'|’)?t|I cannot|sorry/i.test(err), 'no refusal boilerplate');

  const snap = await api.connectedServersWithTools();
  assert.equal(snap.servers.length, 0, 'dead server is NOT reported as connected');
  assert.equal(snap.errors.length, 1, 'exactly one surfaced failure');
  assert.deepEqual(await api.connectedMcpToolDefs(), [], 'no phantom tool defs');

  const direct = await api.mcpCallTool(dead, 'create_model', {});
  assert.equal(direct.ok, false);
  assert.ok(String(direct.error ?? '').length > 0);
  const viaExec = await api.executeTool('mcp__dead_blender__create_model', '{}', ctx([]));
  assert.equal(viaExec.ok, false);
  assert.match(String(viaExec.output), /not connected/i, 'honest disconnect message, not "Unknown tool"');
  writeServers([]);
  console.log('# V1138_DISCONNECTED=' + JSON.stringify({ error: err.slice(0, 160), phantomDefs: 0 }));
});

test('v1138 cleanup', () => { assert.ok(true); });
