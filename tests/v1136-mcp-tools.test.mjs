// ============================================================================
// v11.36 — MCP TOOLS ARE REAL: every tool of every connected server is a
// callable def, dispatch is by EXACT name, disconnect is HONEST, no silent
// truncation. Drives the REAL tools.ts dispatch path against a stdio fake
// MCP server (no mocks of getToolDefs / executeTool / mcpCallTool).
//
// Run: node --test --test-force-exit tests/v1136-mcp-tools.test.mjs
// ============================================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1136-'));
const userData = join(tmp, 'userdata');
mkdirSync(userData, { recursive: true });

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN,
    entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// --- minimal electron stub (same contract as the other reality tests) ---
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `
const p = ${JSON.stringify(userData)};
module.exports = {
  app: { getPath: (k) => (k === 'userData' ? p : p), isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },
  ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
  BrowserWindow: { getAllWindows: () => [] }, Notification: { isSupported: () => false },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder() {}, trashItem: async () => {} },
  clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
  powerMonitor: { on() {} }, screen: {},
};`);

function writeSettings(mcpServers) {
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({
    schemaVersion: 4, language: 'en', mcpServers,
  }));
}
writeSettings([]);

// --- one bundle exposing the canonical builder, the runtime path and the registry API ---
const entry = join(tmp, 'v1136-entry.ts');
writeFileSync(entry, [
  `export * from '${join(ROOT, 'electron/agent/tool-defs.ts').replace(/\\/g, '/')}';`,
  `export * from '${join(ROOT, 'electron/agent/tools.ts').replace(/\\/g, '/')}';`,
  `export * from '${join(ROOT, 'electron/agent/mcp.ts').replace(/\\/g, '/')}';`,
  `export * from '${join(ROOT, 'electron/services/mcpRegistryService.ts').replace(/\\/g, '/')}';`,
  `export { invalidateSettingsCache } from '${join(ROOT, 'electron/services/storeService.ts').replace(/\\/g, '/')}';`,
].join('\n'));

let api = null;
try {
  const out = join(tmp, 'v1136.cjs');
  bundle(entry, out);
  api = require(out);
} catch (err) {
  console.error('[v1136] bundle failed', err?.stack ?? err);
}

after(() => {
  try { api?.closeAllMcpClients?.(); } catch { /* best effort */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ---------- real stdio fake MCP server with 3 tools ----------
const TOOL_NAMES = ['sculpt', 'render', 'export_scene'];
function makeFixture(markerDir) {
  const file = join(tmp, 'fixture-' + Math.random().toString(36).slice(2) + '.cjs');
  const tools = TOOL_NAMES.map((name) => ({
    name,
    description: `${name} — v1136 fake Blender tool`,
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string', description: 'a value for ' + name } },
      required: ['value'],
    },
  }));
  writeFileSync(file, `
const readline = require('node:readline');
const path = require('node:path');
const fs = require('node:fs');
const markerDir = ${JSON.stringify(markerDir)};
const tools = ${JSON.stringify(tools)};
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined || m.id === null || !m.method) return;
  let result;
  if (m.method === 'initialize') {
    result = { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-blender', version: '1.0.0' } };
  } else if (m.method === 'tools/list') {
    result = { tools };
  } else if (m.method === 'tools/call') {
    const name = String(m.params?.name ?? 'unknown');
    try { fs.writeFileSync(path.join(markerDir, name + '.called'), 'OK'); } catch {}
    result = { content: [{ type: 'text', text: 'CALLED:' + name }], isError: false };
  } else {
    result = {};
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
});
`);
  return file;
}

function blenderConfig(markerDir) {
  return {
    id: 'v1136-blender', name: 'Blender', command: process.execPath,
    args: [makeFixture(markerDir)], enabled: true, transport: 'stdio',
    env: {}, timeoutMs: 5000,
  };
}

const ctx = (mcpServers) => ({
  workspace: tmp, sessionId: 'v1136-mcp-tools', mcpServers,
  emit: () => {}, approve: async () => true, fullAccess: true,
});

// ------------------------------------------------------------
test('v1136 fake MCP server: all 3 tools get real defs + dispatch by exact name', async () => {
  assert.ok(api, 'bundle must load');
  const markerDir = join(tmp, 'markers');
  mkdirSync(markerDir, { recursive: true });
  const cfg = blenderConfig(markerDir);

  // Real discovery: the fake server advertises exactly 3 tools.
  const listed = await api.mcpListTools(cfg);
  assert.equal(listed.ok, true, `discovery must succeed: ${listed.error ?? ''}`);
  assert.equal(listed.tools.length, 3, 'all 3 tools are discovered — no first-N cut');

  // Canonical builder + the REAL runtime builder agree on all 3 defs.
  const canonical = api.buildMcpToolDefs([{ server: cfg, tools: listed.tools }]);
  const runtime = api.getToolDefs([{ server: cfg, tools: listed.tools }], 'full').filter((d) => d.kind === 'mcp');
  assert.equal(canonical.length, 3, 'canonical builder emits 3 defs');
  assert.equal(runtime.length, 3, 'runtime getToolDefs emits 3 defs');
  for (const name of TOOL_NAMES) {
    const expected = `mcp__blender__${name}`;
    assert.ok(canonical.some((d) => d.name === expected), `canonical has ${expected}`);
    const rd = runtime.find((d) => d.name === expected);
    assert.ok(rd, `runtime has ${expected}`);
    assert.match(rd.description, /\[MCP · Blender\]/, `${expected}: real description with server label`);
    assert.equal(rd.parameters?.type, 'object', `${expected}: inputSchema became parameters`);
    assert.deepEqual(rd.parameters?.properties?.value?.type, 'string', `${expected}: schema properties preserved`);
    assert.equal(rd.mcpServerName, 'Blender', `${expected}: server metadata for dispatch`);
    assert.equal(rd.mcpToolName, name, `${expected}: raw tool metadata for dispatch`);
    const cd = canonical.find((d) => d.name === expected);
    assert.deepEqual(cd.parameters, rd.parameters, `${expected}: canonical schema equals runtime schema`);
  }

  // REAL execution of every def by its exact emitted name (no silent drop).
  for (const name of TOOL_NAMES) {
    const marker = join(markerDir, name + '.called');
    try { rmSync(marker, { force: true }); } catch { /* none */ }
    const res = await api.executeTool(`mcp__blender__${name}`, JSON.stringify({ value: 'x' }), ctx([{ server: cfg, tools: listed.tools }]));
    assert.equal(res.ok, true, `${name} executes: ${res.output}`);
    assert.match(res.output, /CALLED:/, `${name}: real MCP result relayed`);
    assert.equal(existsSync(marker), true, `${name}: the fake server actually received tools/call`);
  }
  console.log('# V1136_THREE_TOOLS=3 defs, 3 exact-name dispatches, 3 markers');
});

test('v1136 no silent drop: 40 advertised tools → 40 defs (no truncation)', () => {
  assert.ok(api, 'bundle must load');
  const cfg = { id: 'many', name: 'Many Tools', command: 'npx', enabled: true, transport: 'stdio' };
  const tools = Array.from({ length: 40 }, (_, i) => ({
    name: `tool_${i}`,
    description: `tool number ${i}`,
    inputSchema: { type: 'object', properties: { n: { type: 'integer' } }, required: [] },
  }));
  const canonical = api.buildMcpToolDefs([{ server: cfg, tools }]);
  const runtime = api.getToolDefs([{ server: cfg, tools }], 'full').filter((d) => d.kind === 'mcp');
  assert.equal(canonical.length, 40, 'canonical builder keeps every tool');
  assert.equal(runtime.length, 40, 'runtime builder keeps every tool');
  assert.equal(new Set(canonical.map((d) => d.name)).size, 40, 'all names unique');
  assert.equal(canonical.every((d) => d.parameters?.type === 'object' && d.description), true, 'every def is real');
  console.log('# V1136_NO_TRUNCATION=40/40 defs');
});

test('v1136 disconnected server: honest error, zero phantom defs', async () => {
  assert.ok(api, 'bundle must load');
  // A server whose binary does not exist → probe fails honestly.
  const dead = {
    id: 'v1136-dead', name: 'Dead Server', command: '__v1136_no_such_mcp_binary__',
    args: [], enabled: true, transport: 'stdio',
  };
  writeSettings([dead]);
  api.invalidateSettingsCache();

  const { servers, errors } = await api.connectedServersWithTools();
  assert.equal(servers.length, 0, 'a dead server is NOT reported as connected');
  assert.equal(errors.length, 1, 'the failure is surfaced, not swallowed');
  assert.ok(String(errors[0]?.error ?? '').length > 0, 'the error message is honest and non-empty');

  const defs = await api.connectedMcpToolDefs();
  assert.deepEqual(defs, [], 'no phantom defs for a disconnected server');

  const honest = api.mcpDisconnectedError('Blender');
  assert.match(honest, /not connected/i, 'helper names the real condition');

  // A call to a known mcp__ name with no connected servers must never be a
  // silent drop: it returns ok:false with an actionable message.
  const res = await api.executeTool('mcp__blender__sculpt', '{}', ctx([]));
  assert.equal(res.ok, false, 'disconnected call fails visibly');
  assert.ok(String(res.output ?? '').length > 0, 'no empty/silent result');
  console.log('# V1136_DISCONNECTED=' + JSON.stringify({ errors: errors.length, phantomDefs: defs.length }));
});

test('v1136 cleanup', () => {
  assert.ok(true);
});
