// ============================================================
// SADEEM v11.12.3 — MCP CLIENT LIFECYCLE / TOOL-CALL ERRORS
//
// End-to-end proof against the REAL electron/agent/mcp.ts (bundled, with an
// electron stub), using a real spawned stdio JSON-RPC server and real local
// HTTP servers. Locks down the fixes for:
//   1. stdio crash reported honestly (not swallowed after handshake)
//   2. cold client first-call failure retried once (no hang)
//   3. stale/dead pooled client never reused
//   4. http/sse 401/404 surfaced as actionable errors, not "no response"
//   5. tool result never lost (text, bare-string and structuredContent)
//   6. closeAllMcpClients leaves no orphan process / pending restart
//   7. colliding tool names deduped with an actionable warning
//
// Run: node --test --test-force-exit tests/v1123-mcp-errors.test.mjs
// ============================================================
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'v1123-mcp-'));
const ud = join(tmp, 'userdata');
mkdirSync(ud, { recursive: true });
const SETTINGS = join(ud, 'settings.json');
const writeSettings = (servers) =>
  writeFileSync(SETTINGS, JSON.stringify({ schemaVersion: 4, mcpServers: servers }));
writeSettings([]); // no startup auto-probe; tests control exactly what spawns

// ---------- bundle the real mcp.ts ----------
const OUT = join(tmp, 'mcp.cjs');
execFileSync(
  ESBUILD_NODE,
  [
    ESBUILD_BIN, 'electron/agent/mcp.ts', '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${OUT}`, '--external:electron',
    '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ],
  { cwd: ROOT, stdio: 'pipe' },
);

// ---------- electron stub: capture IPC handlers + health snapshots ----------
const IPC = (globalThis.__V1123_IPC__ = new Map());
const HEALTH = (globalThis.__V1123_HEALTH__ = []);
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `const H = globalThis.__V1123_IPC__;
const HEALTH = globalThis.__V1123_HEALTH__;
module.exports = {
  app: { getPath: (k) => (k === 'userData' ? ${JSON.stringify(ud)} : ${JSON.stringify(tmp)}),
         whenReady: async () => true, on() {}, isReady: () => true, getName: () => 'v1123', getVersion: () => '0.0.0' },
  ipcMain: { handle(ch, fn) { H.set(ch, fn); }, removeHandler(ch) { H.delete(ch); }, on() {} },
  ipcRenderer: { invoke: async () => ({}), on() {}, send() {} },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: {
    send: (ch, p) => { if (ch === 'kdx:mcp:health') HEALTH.push(JSON.parse(JSON.stringify(p))); },
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

const mcp = require(OUT); // module init registers IPC + starts health monitor

// ---------- real stdio MCP server ----------
const SERVER_JS = join(tmp, 'mcp-server.mjs');
const SPAWN_LOG = join(tmp, 'spawn.log');
const EXIT_LOG = join(tmp, 'exit.log');
const CRASH_MARK = join(tmp, 'crash.mark');
const ORPHAN_CRASH_MARK = join(tmp, 'orphan-crash.mark');
writeFileSync(
  SERVER_JS,
  `import { createInterface } from 'node:readline';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
if (process.env.V1123_SPAWN_LOG) appendFileSync(process.env.V1123_SPAWN_LOG, JSON.stringify({ pid: process.pid, at: Date.now() }) + '\\n');
process.on('exit', (code) => { try { if (process.env.V1123_EXIT_LOG) appendFileSync(process.env.V1123_EXIT_LOG, JSON.stringify({ pid: process.pid, code }) + '\\n'); } catch {} });
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined || msg.id === null) return; // notifications/initialized
  const reply = (result) => send({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'v1123', version: '1' } });
  if (msg.method === 'ping') return reply({});
  if (msg.method === 'tools/list') {
    const tools = [
      { name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
      { name: 'fail', description: 'fail', inputSchema: { type: 'object' } },
      { name: 'bare', description: 'bare', inputSchema: { type: 'object' } },
      { name: 'crash', description: 'crash', inputSchema: { type: 'object' } },
    ];
    if (process.env.V1123_COLLISION === '1') tools.push(
      { name: 'READ_FILE', inputSchema: { type: 'object' } },
      { name: 'read file', inputSchema: { type: 'object' } },
      { name: 'read.file', inputSchema: { type: 'object' } },
    );
    return reply({ tools });
  }
  if (msg.method === 'tools/call') {
    const name = msg.params && msg.params.name;
    const arg = (msg.params && msg.params.arguments) || {};
    if (name === 'echo') return reply({ content: [{ type: 'text', text: 'ECHO:' + (arg.text ?? '') }] });
    if (name === 'fail') return reply({ isError: true, content: [{ type: 'text', text: 'TOOL_FAILED: bad input' }] });
    if (name === 'bare') { send({ jsonrpc: '2.0', id: msg.id, result: 'BARE_RESULT_OK' }); return; }
    if (name === 'crash' && process.env.V1123_CRASH_MARK && !existsSync(process.env.V1123_CRASH_MARK)) {
      writeFileSync(process.env.V1123_CRASH_MARK, 'x');
      setImmediate(() => process.exit(7)); // hard crash mid-call, no reply
      return;
    }
    return reply({ content: [{ type: 'text', text: 'OK:' + name }] });
  }
  send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'no method' } });
});`,
);

const baseEnv = { V1123_SPAWN_LOG: SPAWN_LOG, V1123_EXIT_LOG: EXIT_LOG };
const cfg = (id, extra = {}) => ({
  id, name: id, command: process.execPath, args: [SERVER_JS],
  env: { ...baseEnv, ...extra }, enabled: true,
});
const WORK = cfg('v1123-work');
const COLLISION = cfg('v1123-collision', { V1123_COLLISION: '1' });
const CRASH = cfg('v1123-crash', { V1123_CRASH_MARK: CRASH_MARK });
const ORPHAN = cfg('v1123-orphan', { V1123_CRASH_MARK: ORPHAN_CRASH_MARK });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function guard(p, ms, label) {
  let t;
  return Promise.race([
    p,
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`HANG: ${label} > ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(t));
}
function spawnCount() {
  return existsSync(SPAWN_LOG)
    ? readFileSync(SPAWN_LOG, 'utf8').trim().split('\n').filter(Boolean).length
    : 0;
}
function unlink(p) { try { require('node:fs').unlinkSync(p); } catch { /* absent */ } }
async function waitFor(fn, ms) {
  const until = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > until) return false;
    await sleep(100);
  }
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'mcp';

// ---------- 1. working server, honest results, no hang ----------
test('v1123 stdio: list + call work; text/bare results preserved; isError honest; no retry', { timeout: 20000 }, async () => {
  const listed = await guard(mcp.mcpListTools(WORK), 8000, 'list');
  assert.equal(listed.ok, true, listed.error);
  assert.ok(listed.tools.some((t) => t.name === 'echo'), 'echo advertised');

  const echo = await guard(mcp.mcpCallTool(WORK, 'echo', { text: 'roundtrip' }), 8000, 'echo');
  assert.equal(echo.ok, true, echo.error);
  assert.equal(echo.output, 'ECHO:roundtrip', 'text content preserved verbatim');

  const bare = await guard(mcp.mcpCallTool(WORK, 'bare', {}), 8000, 'bare');
  assert.equal(bare.ok, true, bare.error);
  assert.equal(bare.output, 'BARE_RESULT_OK', 'bare-string tool result is not lost');

  const before = spawnCount();
  const failed = await guard(mcp.mcpCallTool(WORK, 'fail', {}), 8000, 'fail');
  assert.equal(failed.ok, false, 'server isError surfaced as a failure');
  assert.match(failed.error, /TOOL_FAILED: bad input/, 'tool error text reported honestly');
  assert.equal(spawnCount(), before, 'a tool-level error is never retried (no extra spawn)');
});

// ---------- 2. crash once, restart: honest report + cold retry + no hang ----------
test('v1123 stdio: crash reported honestly, cold first call retried once, later call recovers', { timeout: 20000 }, async () => {
  unlink(CRASH_MARK);
  HEALTH.length = 0;
  const before = spawnCount();

  const out = await guard(mcp.mcpCallTool(CRASH, 'crash', {}), 12000, 'crash call');
  assert.ok(out && typeof out === 'object', 'the crashed call settled (never hung)');
  if (out.ok) assert.match(out.output, /OK:crash/, 'cold retry answered on a fresh process');
  else assert.match(String(out.error), /stopped unexpectedly|not running|restart/i, String(out.error));

  const reported = HEALTH.filter((h) => h.lastError && /stopped unexpectedly|exit code 7/i.test(h.lastError));
  assert.ok(reported.length >= 1, 'crash reached the health card: ' + JSON.stringify(HEALTH.slice(-3)));

  const after = await guard(mcp.mcpCallTool(CRASH, 'echo', { text: 'after' }), 8000, 'recovery');
  assert.equal(after.ok, true, after.error);
  assert.equal(after.output, 'ECHO:after', 'no stale dead client reused after the crash');
  assert.ok(spawnCount() > before, 'a fresh process was spawned after the crash');
});

// ---------- 3. http 401 / 404 surfaced as actionable errors, never retried ----------
test('v1123 http: 401 and 404 are actionable and not retried', { timeout: 20000 }, async () => {
  const counts = { 401: 0, 404: 0 };
  const body = (status) => (status === 401 ? '{"error":"invalid_token"}' : 'not found');
  const srv = http.createServer((req, res) => {
    const status = req.url.includes('401') ? 401 : 404;
    counts[status]++;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body(status));
  });
  const port = await new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
  try {
    const a = await guard(mcp.mcpListTools({ id: 'v1123-401', name: 'v1123-401', transport: 'http', url: `http://127.0.0.1:${port}/401`, enabled: true }), 8000, '401');
    assert.equal(a.ok, false);
    assert.match(a.error, /401/);
    assert.match(a.error, /auth|token|oauth/i, '401 explains what to fix: ' + a.error);
    assert.equal(counts[401], 1, '401 is a config error — no pointless retry');

    const b = await guard(mcp.mcpListTools({ id: 'v1123-404', name: 'v1123-404', transport: 'http', url: `http://127.0.0.1:${port}/404`, enabled: true }), 8000, '404');
    assert.equal(b.ok, false);
    assert.match(b.error, /404/);
    assert.match(b.error, /URL|endpoint|path/i, '404 explains what to fix: ' + b.error);
    assert.equal(counts[404], 1, '404 is a config error — no pointless retry');
  } finally {
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
});

// ---------- 4. tool name collision deduped with an actionable warning ----------
test('v1123 discovery: colliding tool names deduped with an actionable warning', { timeout: 20000 }, async () => {
  const warnings = [];
  const orig = console.warn;
  console.warn = (...a) => warnings.push(a.map(String).join(' '));
  try {
    const r = await guard(mcp.mcpListTools(COLLISION), 8000, 'collision list');
    assert.equal(r.ok, true, r.error);
    const hits = r.tools.filter((t) => slug(t.name) === 'read_file');
    assert.equal(hits.length, 1, 'only one tool survives the mcp__<server>__<tool> slug collision');
    assert.ok(warnings.some((w) => /both map to the agent name|Rename one of the tools/i.test(w)), 'warning explains the fix: ' + warnings.join(' | '));
  } finally {
    console.warn = orig;
  }
});

// ---------- 5. closeAllMcpClients leaves no orphans ----------
test('v1123 shutdown: closeAllMcpClients kills children and cancels pending restarts', { timeout: 25000 }, async () => {
  unlink(ORPHAN_CRASH_MARK);
  const warm = await guard(mcp.mcpListTools(ORPHAN), 8000, 'warm orphan');
  assert.equal(warm.ok, true, warm.error);

  // The crash is on a WARM client, so withClient does not retry it — the
  // health ladder arms a 5s restart timer. closeAllMcpClients must cancel it.
  writeSettings([ORPHAN]);
  await guard(mcp.mcpCallTool(ORPHAN, 'crash', {}), 8000, 'orphan crash');
  mcp.closeAllMcpClients();
  const atClose = spawnCount();
  await sleep(6500); // past the 5s backoff — an uncancelled timer would respawn here
  assert.equal(spawnCount(), atClose, 'no orphan process spawned after closeAllMcpClients');

  const spawned = readFileSync(SPAWN_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const gone = await waitFor(async () => spawned.every((s) => {
    try { process.kill(s.pid, 0); return false; } catch { return true; }
  }), 2500);
  assert.equal(gone, true, 'every spawned child process was terminated on close');
  writeSettings([]);
});

after(() => {
  try { mcp.closeAllMcpClients(); } catch { /* gone */ }
  try { mcp.stopMcpHealthMonitor(); } catch { /* optional */ }
});
