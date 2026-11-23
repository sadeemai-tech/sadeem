#!/usr/bin/env node
// ============================================================
// v11.38 — MCP GUARD (F1 verification). DIAGNOSIS + TEST ONLY.
// ------------------------------------------------------------
// Zero app source is edited. This is a ROOT node script that verifies
// "MCP servers actually work" with REAL protocol behavior:
//
//   1. raw JSON-RPC 2.0 round trip + app client connect/list/call on a
//      local stdio fake server with 3 tools (no external network);
//   2. a "Blender-like" server: the exact AI tool name
//      mcp__blender__create_model reaches the server (marker file on
//      disk) and returns a real 3D-model result through executeTool;
//   3. a disconnected server yields ONE honest, actionable error —
//      no giant stack, no "I can't" — and ZERO phantom tool defs;
//   4. ALL configured servers get defs (not just the first); 40 tools
//      → 40 defs, no truncation;
//   5. source scan of electron/agent/mcp.ts: real initialize handshake,
//      correct/current protocol version, bounded retry, no silent catch;
//   6. (supplementary) F1-fix presence probe in engine.ts — does the
//      cold-start "every MCP server errors" symptom still reproduce?
//
// The transports, def builders, registry API and dispatch are the REAL
// app modules, esbuild-bundled with an Electron stub exactly like the
// other reality tests. The only fake is the MCP SERVER (a local child
// process speaking genuine newline-delimited JSON-RPC 2.0 over stdio).
//
// Run:  node tests-v1138-mcp-guard.mjs
// Writes: tests/.v1138-mcp-guard.results.json
// Exit 0 = every check PASS; exit 1 = at least one FAIL.
// ============================================================
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ESBUILD_BIN, ESBUILD_NODE } from './tests/_esbuild-bin.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const p = (...xs) => join(...xs).replace(/\\/g, '/');
process.env.SURNIA_NO_BROWSER = '1';

const findings = [];
function check(id, ok, detail, fileLine = '') {
  const status = ok ? 'PASS' : 'FAIL';
  findings.push({ id, status, detail, fileLine });
  console.log(`${status} ${id}${fileLine ? ` [${fileLine}]` : ''}: ${detail}`);
  return ok;
}
function loc(rel, needle) {
  try {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split(/\r?\n/);
    const i = lines.findIndex((l) => l.includes(needle));
    return `${rel}:${i >= 0 ? i + 1 : '?'}`;
  } catch { return `${rel}:?`; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------
// Harness: temp home + Electron stub + bundle of the real modules
// ------------------------------------------------------------
const TMP = mkdtempSync(join(tmpdir(), 'sadeem-v1138-mcp-'));
const userData = join(TMP, 'userdata');
mkdirSync(userData, { recursive: true });
writeFileSync(join(userData, 'settings.json'), JSON.stringify({
  schemaVersion: 4, language: 'en', mcpServers: [],
}));

const stubDir = join(TMP, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), [
  'const p = ' + JSON.stringify(userData) + ';',
  'module.exports = {',
  '  app: { getPath: () => p, isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },',
  // No ipcMain.handle → registerMcpV2Ipc() returns early → no health-monitor
  // timer competes with the explicit probes below. Headless is intentional.
  '  ipcMain: { on() {}, removeAllListeners() {} },',
  '  BrowserWindow: { getAllWindows: () => [] }, Notification: { isSupported: () => false },',
  '  safeStorage: { isEncryptionAvailable: () => false },',
  '  shell: { openExternal: async () => {}, openPath: async () => \'\', showItemInFolder() {}, trashItem: async () => {} },',
  '  clipboard: { readText: () => \'\', writeText() {}, readImage: () => ({ isEmpty: () => true }) },',
  '  powerMonitor: { on() {} }, screen: {},',
  '};',
].join('\n'));

let api = null;
try {
  const entry = join(TMP, 'v1138-entry.ts');
  writeFileSync(entry, [
    `export { mcpListTools, mcpCallTool, closeAllMcpClients } from '${p(ROOT, 'electron/agent/mcp.ts')}';`,
    `export { executeTool, getToolDefs } from '${p(ROOT, 'electron/agent/tools.ts')}';`,
    `export { buildMcpToolDefs, mcpDisconnectedError } from '${p(ROOT, 'electron/agent/tool-defs.ts')}';`,
    `export { connectedServersWithTools, connectedMcpToolDefs } from '${p(ROOT, 'electron/services/mcpRegistryService.ts')}';`,
    `export { invalidateSettingsCache } from '${p(ROOT, 'electron/services/storeService.ts')}';`,
  ].join('\n'));
  const out = join(TMP, 'v1138.cjs');
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${out}`, '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react'], { cwd: ROOT, stdio: 'pipe' });
  api = require(out);
  check('B0-BUNDLE', true, 'real mcp.ts / tools.ts / tool-defs.ts / registry bundled (Electron stubbed)');
} catch (err) {
  check('B0-BUNDLE', false, `esbuild/require of real app modules failed: ${err?.message ?? err}`);
}

function writeServers(list) {
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({
    schemaVersion: 4, language: 'en', mcpServers: list,
  }));
  try { api?.invalidateSettingsCache?.(); } catch { /* none */ }
}
const ctx = (servers) => ({
  workspace: TMP, sessionId: 'v1138-mcp-guard', mcpServers: servers,
  emit() {}, approve: async () => true, fullAccess: true,
});

// ------------------------------------------------------------
// Genuine stdio MCP server fixture (newline-delimited JSON-RPC 2.0)
// ------------------------------------------------------------
function toolDef(name, description, extra = {}) {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string', description: 'value for ' + name }, ...extra },
      required: ['value'],
    },
  };
}

function makeFixture(tag, serverName, tools, markerDir) {
  const file = join(TMP, `fixture-${tag}.cjs`);
  const src = [
    "const readline = require('node:readline');",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const markerDir = ' + JSON.stringify(markerDir) + ';',
    'const serverName = ' + JSON.stringify(serverName) + ';',
    'const tools = ' + JSON.stringify(tools) + ';',
    'const rl = readline.createInterface({ input: process.stdin });',
    "rl.on('line', (line) => {",
    '  let m; try { m = JSON.parse(line); } catch { return; }',
    '  if (typeof m.method === "string" && m.method.indexOf("notifications/") === 0) return;',
    '  if (m.id === undefined || m.id === null) return;',
    '  let result;',
    "  if (m.method === 'initialize') {",
    '    result = { protocolVersion: (m.params && m.params.protocolVersion) || "2025-06-18",',
    '      capabilities: { tools: {} }, serverInfo: { name: serverName, version: "1.0.0" } };',
    "  } else if (m.method === 'ping') { result = {};",
    "  } else if (m.method === 'tools/list') { result = { tools };",
    "  } else if (m.method === 'tools/call') {",
    '    const name = String((m.params && m.params.name) || "unknown");',
    '    const args = (m.params && m.params.arguments) || {};',
    '    try { fs.mkdirSync(markerDir, { recursive: true });',
    '      fs.writeFileSync(path.join(markerDir, name + ".called"), JSON.stringify(args)); } catch {}',
    '    if (name === "create_model") {',
    '      const fmt = String(args.format || "glb");',
    '      const label = String(args.name || name);',
    '      result = { isError: false, content: [{ type: "text",',
    '        text: "MODEL_3D_CREATED name=" + label + " format=" + fmt + " vertices=8 faces=12" }],',
    '        structuredContent: { kind: "3d-model", name: label, format: fmt,',
    '          vertices: 8, faces: 12, file: label + "." + fmt } };',
    '    } else {',
    '      result = { isError: false, content: [{ type: "text",',
    '        text: "CALLED:" + name + " " + JSON.stringify(args) }] };',
    '    }',
    '  } else if (m.method === "resources/list" || m.method === "prompts/list") { result = {};',
    '  } else {',
    '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id,',
    '      error: { code: -32601, message: "method not found: " + m.method } }) + "\\n");',
    '    return;',
    '  }',
    '  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\\n");',
    '});',
  ];
  writeFileSync(file, src.join('\n'));
  return file;
}

function cfg(id, name, fixture) {
  return {
    id, name, command: process.execPath, args: [fixture],
    transport: 'stdio', enabled: true, timeoutMs: 10_000, env: {},
  };
}

// Direct wire-level round trip — proves the server is a REAL MCP server
// before any app code is involved.
async function rawRoundTrip(fixture, firstTool) {
  const child = spawn(process.execPath, [fixture], { stdio: ['pipe', 'pipe', 'pipe'] });
  const seen = [];
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) { try { seen.push(JSON.parse(line)); } catch { /* noise */ } }
    }
  });
  const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
  const wait = async (id) => {
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      const m = seen.find((x) => x && x.id === id);
      if (m) return m;
      await sleep(20);
    }
    return null;
  };
  try {
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'v1138-guard', version: '1.0.0' },
    } });
    const init = await wait(1);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const list = await wait(2);
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: firstTool, arguments: { value: 'raw-wire-v1138' } } });
    const call = await wait(3);
    return { init, list, call };
  } finally {
    try { child.kill(); } catch { /* gone */ }
  }
}

const NO_STACK = (s) => !/\n\s+at\s+/.test(String(s ?? '')) && !/node:internal|node_modules[\\/]/.test(String(s ?? ''));
const NO_REFUSAL = (s) => !/I can(?:'|’)?t\b|I cannot\b|\bsorry\b/i.test(String(s ?? ''));
const ACTIONABLE = (s) => /check|install|PATH|command|args|settings|retry|reconnect|configured|valid/i.test(String(s ?? ''));

async function main() {
  console.log('===== V1138 MCP GUARD — real protocol, zero external net =====');

  // ---- CHECK 1: connect/list/call on a 3-tool fake server ----
  const threeNames = ['echo', 'now', 'list_models'];
  const threeTools = threeNames.map((n) => toolDef(n, `${n} — v1138 three-tool server`));
  const dir1 = join(TMP, 'markers-1');
  mkdirSync(dir1, { recursive: true });
  const fx1 = makeFixture('three', 'three-tool-server', threeTools, dir1);
  const cfg1 = cfg('v1138-three', 'Three Tool Server', fx1);

  const raw = await rawRoundTrip(fx1, 'echo');
  check('1-RAW-INIT', raw.init?.result?.serverInfo?.name === 'three-tool-server'
    && raw.init?.result?.protocolVersion === '2025-11-25',
  `initialize → serverInfo=three-tool-server, protocolVersion=${raw.init?.result?.protocolVersion}`);
  check('1-RAW-LIST', (raw.list?.result?.tools ?? []).length === 3,
    `tools/list on the wire returned ${(raw.list?.result?.tools ?? []).length} tools`);
  check('1-RAW-CALL', String(raw.call?.result?.content?.[0]?.text ?? '').includes('CALLED:echo'),
    `tools/call on the wire → ${JSON.stringify(String(raw.call?.result?.content?.[0]?.text ?? '').slice(0, 90))}`);

  if (api) {
    const listed = await api.mcpListTools(cfg1);
    const names = (listed?.tools ?? []).map((t) => t.name);
    check('1-APP-LIST', listed?.ok === true && names.length === 3 && threeNames.every((n) => names.includes(n)),
      `real mcpListTools discovered: ${names.join(', ') || '(none)'}`,
      loc('electron/agent/mcp.ts', 'export async function mcpListTools('));
    const called = await api.mcpCallTool(cfg1, 'echo', { value: 'app-client-v1138' });
    check('1-APP-CALL', called?.ok === true && String(called.output).includes('CALLED:echo')
      && existsSync(join(dir1, 'echo.called')),
    `real mcpCallTool(echo) → ${JSON.stringify(String(called?.output ?? '').slice(0, 100))}; server marker=${existsSync(join(dir1, 'echo.called'))}`,
    loc('electron/agent/mcp.ts', 'export async function mcpCallTool('));
  } else {
    check('1-APP-LIST', false, 'skipped: bundle unavailable');
    check('1-APP-CALL', false, 'skipped: bundle unavailable');
  }

  // ---- CHECK 2: Blender-like exact-name dispatch via executeTool ----
  const blenderTool = toolDef('create_model', 'Create a 3D model (v1138 Blender-like server)', {
    name: { type: 'string', description: 'model name' },
    format: { type: 'string', enum: ['glb', 'obj', 'fbx'], description: 'export format' },
  });
  const dir2 = join(TMP, 'markers-blender');
  mkdirSync(dir2, { recursive: true });
  const fx2 = makeFixture('blender', 'Blender', [blenderTool], dir2);
  const cfg2 = cfg('v1138-blender', 'Blender', fx2);

  if (api) {
    const listed = await api.mcpListTools(cfg2);
    const defs = api.getToolDefs([{ server: cfg2, tools: listed.tools ?? [] }], 'full')
      .filter((d) => d.kind === 'mcp');
    const d = defs.find((x) => x.name === 'mcp__blender__create_model');
    check('2-DEF', !!d && d.mcpServerName === 'Blender' && d.mcpToolName === 'create_model'
      && d.parameters?.properties?.format?.type === 'string',
    `getToolDefs emits mcp__blender__create_model (kind=mcp, raw tool metadata + inputSchema kept)`,
    loc('electron/agent/tools.ts', 'name: `mcp__${serverSlug}__${slugMcpName(t.name)}`'));
    const canonical = api.buildMcpToolDefs([{ server: cfg2, tools: listed.tools ?? [] }]);
    check('2-DEF-PARITY', canonical.some((x) => x.name === 'mcp__blender__create_model')
      && JSON.stringify(canonical.find((x) => x.name === 'mcp__blender__create_model')?.parameters)
        === JSON.stringify(d?.parameters),
    'canonical buildMcpToolDefs agrees with runtime getToolDefs on the Blender def',
    loc('electron/agent/tool-defs.ts', 'export function buildMcpToolDefs('));

    const marker = join(dir2, 'create_model.called');
    try { rmSync(marker, { force: true }); } catch { /* none */ }
    const res = await api.executeTool('mcp__blender__create_model',
      JSON.stringify({ name: 'cell_mitochondrion', format: 'glb', value: 'v1138' }),
      ctx([{ server: cfg2, tools: listed.tools ?? [] }]));
    const markerArgs = existsSync(marker) ? readFileSync(marker, 'utf8') : '';
    check('2-REAL-DISPATCH', res?.ok === true
      && String(res.output).includes('MODEL_3D_CREATED')
      && String(res.output).includes('vertices=8')
      && existsSync(marker) && markerArgs.includes('cell_mitochondrion'),
    `executeTool('mcp__blender__create_model') → ${JSON.stringify(String(res?.output ?? '').slice(0, 150))}; server marker=${existsSync(marker)} args=${markerArgs.slice(0, 80)}`,
    loc('electron/agent/tools.ts', 'const res = await mcpCallTool(entry.server, toolName, args);'));
  } else {
    check('2-DEF', false, 'skipped: bundle unavailable');
    check('2-DEF-PARITY', false, 'skipped: bundle unavailable');
    check('2-REAL-DISPATCH', false, 'skipped: bundle unavailable');
  }

  // ---- CHECK 3: disconnected server → one honest error, no phantoms ----
  const dead = {
    id: 'v1138-dead', name: 'Dead Server', command: '__v1138_no_such_mcp_binary__',
    args: [], enabled: true, transport: 'stdio', timeoutMs: 3000,
  };
  if (api) {
    writeServers([dead]);
    const { servers, errors } = await api.connectedServersWithTools();
    const e1 = String(errors?.[0]?.error ?? '');
    check('3-PROBE', servers.length === 0 && errors.length === 1,
      `dead server → 0 connected, ${errors.length} surfaced error(s)`,
      loc('electron/services/mcpRegistryService.ts', 'connectedServersWithTools('));
    check('3-HONEST', e1.length > 0 && e1.length < 500 && NO_STACK(e1) && NO_REFUSAL(e1) && ACTIONABLE(e1),
      `error text: ${JSON.stringify(e1.slice(0, 220))}`,
      loc('electron/agent/mcp.ts', 'Failed to launch MCP server'));
    const defs = await api.connectedMcpToolDefs();
    check('3-NO-PHANTOM', Array.isArray(defs) && defs.length === 0,
      `connectedMcpToolDefs() → ${defs.length} defs for the dead server (must be 0)`,
      loc('electron/services/mcpRegistryService.ts', 'export async function connectedMcpToolDefs('));
    const direct = await api.mcpCallTool(dead, 'anything', {});
    const e2 = String(direct?.error ?? '');
    check('3-CALL-ERROR', direct?.ok === false && e2.length > 0 && NO_STACK(e2) && NO_REFUSAL(e2),
      `mcpCallTool(dead) → ok=false, error=${JSON.stringify(e2.slice(0, 200))}`,
      loc('electron/agent/mcp.ts', "return { ok: false, output: '', error }"));
    const viaExec = await api.executeTool('mcp__blender__create_model', '{}', ctx([]));
    const e3 = String(viaExec?.output ?? '');
    check('3-EXEC-VISIBLE', viaExec?.ok === false && e3.length > 0 && NO_STACK(e3) && NO_REFUSAL(e3),
      `executeTool(known mcp__ name, no servers) → ok=false, output=${JSON.stringify(e3.slice(0, 200))}`,
      loc('electron/agent/tools.ts', 'Unknown tool: ${name}'));
  } else {
    for (const id of ['3-PROBE', '3-HONEST', '3-NO-PHANTOM', '3-CALL-ERROR', '3-EXEC-VISIBLE']) {
      check(id, false, 'skipped: bundle unavailable');
    }
  }

  // ---- CHECK 4: every configured server, no truncation ----
  if (api) {
    const namesA = ['alpha_a', 'alpha_b', 'alpha_c'];
    const namesB = ['bravo_a', 'bravo_b', 'bravo_c'];
    const dirA = join(TMP, 'markers-alpha'); mkdirSync(dirA, { recursive: true });
    const dirB = join(TMP, 'markers-bravo'); mkdirSync(dirB, { recursive: true });
    const cfgA = cfg('v1138-alpha', 'Alpha', makeFixture('alpha', 'Alpha', namesA.map((n) => toolDef(n, n)), dirA));
    const cfgB = cfg('v1138-bravo', 'Bravo', makeFixture('bravo', 'Bravo', namesB.map((n) => toolDef(n, n)), dirB));
    writeServers([cfgA, cfgB]);
    const both = await api.connectedServersWithTools();
    check('4-ALL-SERVERS', both.servers.length === 2 && both.errors.length === 0,
      `connectedServersWithTools → ${both.servers.length}/2 servers connected, ${both.errors.length} errors`,
      loc('electron/services/mcpRegistryService.ts', 'enabled.map(async (cfg) =>'));
    const allDefs = await api.connectedMcpToolDefs();
    const got = allDefs.map((x) => x.name);
    const want = [...namesA.map((n) => `mcp__alpha__${n}`), ...namesB.map((n) => `mcp__bravo__${n}`)];
    check('4-ALL-DEFS', want.every((n) => got.includes(n)),
      `defs from BOTH servers: ${got.join(', ') || '(none)'}`,
      loc('electron/agent/tool-defs.ts', 'export function buildMcpToolDefs('));
    const forty = Array.from({ length: 40 }, (_, i) => toolDef(`tool_${i}`, `tool ${i}`));
    const many = api.buildMcpToolDefs([{ server: cfgA, tools: forty }]);
    check('4-NO-TRUNCATION', many.length === 40 && new Set(many.map((x) => x.name)).size === 40,
      `40 advertised tools → ${many.length} defs, ${new Set(many.map((x) => x.name)).size} unique names`,
      loc('electron/agent/tool-defs.ts', 'export function buildMcpToolDefs('));
  } else {
    for (const id of ['4-ALL-SERVERS', '4-ALL-DEFS', '4-NO-TRUNCATION']) {
      check(id, false, 'skipped: bundle unavailable');
    }
  }

  // ---- CHECK 5: source scan of mcp.ts ----
  const mcpSrc = readFileSync(join(ROOT, 'electron/agent/mcp.ts'), 'utf8');
  const mcpLines = mcpSrc.split(/\r?\n/);
  const ml = (needle) => { const i = mcpLines.findIndex((l) => l.includes(needle)); return i >= 0 ? i + 1 : '?'; };

  const initCalls = (mcpSrc.match(/call\(\s*['"]initialize['"]/g) ?? []).length;
  const initialized = (mcpSrc.match(/notifications\/initialized/g) ?? []).length;
  check('5-HANDSHAKE', initCalls >= 3 && initialized >= 3,
    `${initCalls} initialize requests + ${initialized} notifications/initialized across stdio/http/sse transports`,
    `electron/agent/mcp.ts:${ml("'initialize',")}`);

  const versions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
  const hasVersionConst = /const PROTOCOL_VERSION = '2025-11-25'/.test(mcpSrc);
  check('5-PROTOCOL', hasVersionConst && versions.every((v) => mcpSrc.includes(`'${v}'`)),
    `PROTOCOL_VERSION=${hasVersionConst ? '2025-11-25' : 'MISSING'}; all ${versions.length} supported revisions listed`,
    `electron/agent/mcp.ts:${ml('const PROTOCOL_VERSION')}`);

  const pages = /const MAX_LIST_PAGES = 10/.test(mcpSrc);
  const restarts = /const HEALTH_MAX_RESTARTS = 3/.test(mcpSrc);
  const retryFlag = mcpSrc.includes('isRetryableTransportError');
  const oneRetry = (mcpSrc.match(/return withClientOnce\(server, fn\);/g) ?? []).length === 1;
  const bounded = !/while\s*\(\s*true\s*\)/.test(mcpSrc) && mcpSrc.includes('withTimeout(');
  check('5-BOUNDED-RETRY', pages && restarts && retryFlag && oneRetry && bounded,
    `MAX_LIST_PAGES=10:${pages}, HEALTH_MAX_RESTARTS=3:${restarts}, one cold retry:${oneRetry}, withTimeout+no while(true):${bounded}`,
    `electron/agent/mcp.ts:${ml('const MAX_LIST_PAGES')}`);

  const emptyCatches = (mcpSrc.match(/catch\s*(?:\([^)]*\))?\s*\{\s*\}/g) ?? []).length;
  const surfaced = (mcpSrc.match(/ok: false, error:/g) ?? []).length;
  const callErrorReturn = mcpSrc.includes("return { ok: false, output: '', error };");
  const warns = mcpSrc.includes('console.warn(');
  check('5-NO-SILENT-CATCH', emptyCatches === 0 && surfaced >= 2 && callErrorReturn && warns,
    `empty catch blocks=${emptyCatches}, error-returning paths=${surfaced}, mcpCallTool surfaces error=${callErrorReturn}, warnings emitted=${warns}`,
    `electron/agent/mcp.ts:${ml('return { ok: false, output:')}`);

  // ---- CHECK 6 (supplementary): F1-fix presence in engine.ts ----
  // This is the "every MCP server errors" symptom: a cold-start server
  // that advertises ZERO defs in the first provider request because
  // enabledMcp is seeded only from the synchronous last-good cache.
  const engineSrc = readFileSync(join(ROOT, 'electron/agent/engine.ts'), 'utf8');
  const engineLines = engineSrc.split(/\r?\n/);
  const seedIdx = engineLines.findIndex((l) => /connectedServersWithTools\(\)/.test(l));
  const defsIdx = engineLines.findIndex((l) => l.includes('const toolDefs ='));
  // Must be an AWAITED call in the discovery block, BEFORE getToolDefs — an
  // import or a stray reference elsewhere does not fix cold start.
  const seededFromRegistry = /await\s+withTimeout\(\s*connectedServersWithTools\(\)/.test(engineSrc)
    && seedIdx >= 0 && defsIdx >= 0 && seedIdx < defsIdx;
  const cacheSeedLine = seedIdx >= 0 ? seedIdx + 1 : (engineLines.findIndex((l) => l.includes('cachedToolsForEngine')) + 1);
  check('F1-ENGINE-COLDSTART', seededFromRegistry,
    seededFromRegistry
      ? 'engine also seeds enabledMcp from the registry connected-tools API — cold-start servers advertise defs on run 1'
      : `engine still seeds only from cachedToolsForEngine — a connected cold server can show zero MCP defs on the first run (founder's symptom can still reproduce)`,
    `electron/agent/engine.ts:${cacheSeedLine || '?'}`);

  // ------------------------------------------------------------
  try { api?.closeAllMcpClients?.(); } catch { /* best-effort */ }
  const pass = findings.filter((f) => f.status === 'PASS').length;
  const fail = findings.length - pass;
  const result = {
    version: 'v11.38', guard: 'mcp', at: new Date().toISOString(),
    summary: { pass, fail }, findings,
  };
  try {
    writeFileSync(join(ROOT, 'tests', '.v1138-mcp-guard.results.json'), JSON.stringify(result, null, 2));
  } catch { /* results file is best-effort */ }
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* temp dir */ }
  console.log(`\n===== V1138 MCP GUARD SUMMARY: ${fail ? 'FAIL' : 'PASS'} (${pass} pass / ${fail} fail) =====`);
  for (const f of findings) if (f.status === 'FAIL') console.log('  - ' + f.id + ': ' + f.detail);
  process.exitCode = fail ? 1 : 0;
}

main().catch((err) => {
  console.error('V1138 MCP GUARD crashed:', err?.stack ?? err);
  process.exitCode = 1;
});
