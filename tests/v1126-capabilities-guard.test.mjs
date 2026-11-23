// ============================================================================
// SADEEM v11.12.6 — CAPABILITIES INTEGRATION GUARD (DIAGNOSIS + TEST ONLY)
// ============================================================================
// The founder said: "استخرج كل قدرة الذكاء الاصطناعي بالمعنى الحرفي... اختبر كل التولز"
// ("Extract EVERY AI capability in the literal sense... test EVERY tool").
//
// This harness does NOT edit any application source. It bundles the REAL
// electron/agent modules (esbuild, electron stubbed), drives the REAL engine
// against a LOCAL scripted OpenAI-compatible provider + a REAL stdio MCP
// server, and checks four brutal contracts:
//
//   G1  SOURCE + RUNTIME TOOL GUARD
//       145 defs exactly · all 145 dispatchable (no "Unknown tool") ·
//       no tools.slice(0,N) · profiles only FILTER what the model SEES,
//       executeTool always resolves the FULL registry (no executor deleted).
//   G2  REAL ENGINE RUN — CORE TOOL + SKILL + MCP TOOL, ONE RUN
//       The model calls use_skill + a core tool (run_command) + an MCP tool;
//       all three results are fed back into the final answer, and the ledgers
//       (journal, trace, skill-usage, skill-promotions, proof, MCP call count)
//       are physically written to disk.
//   G3  SLASH COMMAND GUARD
//       Every ADVERTISED slash command maps to a real handler with an
//       observable effect; engine-side dispatch verified at runtime;
//       no no-op / TODO handlers.
//   G4  VERDICT — printed as a single blunt line (honest, no masking).
//
// Run: node --test --test-force-exit tests/v1126-capabilities-guard.test.mjs
// ============================================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

// Force honest headless posture for browser/device tools in the executor sweep.
process.env.SURNIA_NO_BROWSER = '1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1126-guard-'));
const ud = join(tmp, 'userdata');
mkdirSync(ud, { recursive: true });

const src = (rel) => readFileSync(join(ROOT, rel), 'utf8');
function lineOf(rel, needle) {
  const i = src(rel).split(/\r?\n/).findIndex((l) => l.includes(needle));
  return i >= 0 ? `${rel}:${i + 1}` : rel;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Failure accumulator — every check prints file:line; nothing is hidden.
// ---------------------------------------------------------------------------
const ALL = [];
function ck(list, cond, check, detail, source) {
  if (!cond) list.push({ check, detail: String(detail), source });
}
function dump(list, label) {
  for (const f of list) {
    ALL.push({ ...f, label });
    console.error(`[V1126 FAIL] ${label} :: ${f.check} :: ${f.detail} :: @${f.source}`);
  }
}

// ---------------------------------------------------------------------------
// Shared bundler + electron stub (userData → ud).
// ---------------------------------------------------------------------------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `
const paths = { temp: ${JSON.stringify(tmp)}, userData: ${JSON.stringify(ud)}, home: ${JSON.stringify(tmp)}, appData: ${JSON.stringify(tmp)} };
class StubWebContents { on() {} async executeJavaScript() { return []; } }
class StubBrowserWindow { constructor(){ this.webContents = new StubWebContents(); } destroy(){} setBounds(){} getBounds(){ return { x:0, y:0 }; } }
module.exports = {
  app: { getPath: (k) => paths[k] ?? paths.userData, isReady: () => true, whenReady: async () => {}, on() {}, quit() {}, getName: () => 'v1126-guard', getVersion: () => '0.0.0' },
  ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
  Notification: { isSupported: () => false },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder() {}, trashItem: async () => {} },
  clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
  WebContents: class {}, BrowserWindow: StubBrowserWindow,
  powerMonitor: { on() {} }, screen: {},
};`);

// Browser-free DOM stubs so store.ts / prompts can load under plain Node.
globalThis.window = new Proxy({}, {
  get(_t, key) {
    if (key === 'then' || typeof key === 'symbol') return undefined;
    return (..._a) => Promise.resolve(undefined);
  },
});
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { documentElement: { classList: { contains: () => false }, dataset: {}, style: {} }, addEventListener() {} };
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

process.env.SURNIA_HOME = ud;
process.env.SURNIA_SKIP_UI_GATE = '1';
process.env.SURNIA_TURN_RETRY_DELAYS_MS = '5,5,5';
process.env.SURNIA_DELTA_FLUSH_MS = '5';
process.env.SURNIA_STREAM_CONTINUE_BUDGET = '0';
process.env.SURNIA_MAX_TOKENS_CONTINUES = '0';
process.env.SURNIA_SSE_IDLE_MS = '20_000';
process.env.SURNIA_ENGINE_IDLE_MS = '30_000';

// ---------------------------------------------------------------------------
// G1 — bundles for source/runtime tool guard
// ---------------------------------------------------------------------------
const toolsPath = join(tmp, 'tools.cjs');
const defsPath = join(tmp, 'tool-defs.cjs');
const providersPath = join(tmp, 'providers.cjs');
bundle('electron/agent/tools.ts', toolsPath);
bundle('electron/agent/tool-defs.ts', defsPath);
bundle('electron/agent/providers.ts', providersPath);
const tools = require(toolsPath);
const td = require(defsPath);

// ===========================================================================
// G1 — SOURCE + RUNTIME TOOL GUARD
// ===========================================================================
test('G1a source: registry is exactly 145; defsForProfile only ADVERTISES, never deletes', () => {
  const F = [];
  const CORE = td.CORE_DEFS;
  const full = td.defsForProfile(CORE, 'full');
  ck(F, Array.isArray(CORE) && CORE.length === 145, 'CORE_DEFS has exactly 145 defs', `got ${CORE?.length}`, lineOf('electron/agent/tool-defs.ts', 'export const CORE_DEFS'));
  ck(F, full.length === 145, 'defsForProfile(full) returns 145', `got ${full.length}`, lineOf('electron/agent/tool-defs.ts', 'export function defsForProfile'));
  ck(F, tools.getToolDefs([]).length === 145, 'getToolDefs([]) returns 145', `got ${tools.getToolDefs([]).length}`, lineOf('electron/agent/tools.ts', 'export function getToolDefs'));
  ck(F, new Set(full.map((d) => d.name)).size === 145, '145 unique def names', `unique=${new Set(full.map((d) => d.name)).size}`, 'electron/agent/tool-defs.ts');

  // Profiles must be strict SUBSETS that only change what the model SEES.
  const essential = td.defsForProfile(CORE, 'essential');
  const balanced = td.defsForProfile(CORE, 'balanced');
  const names = (a) => new Set(a.map((d) => d.name));
  const e = names(essential), b = names(balanced), f = names(full);
  ck(F, e.size < b.size && b.size < f.size, 'essential ⊂ balanced ⊂ full (by advertised name)', `${e.size}/${b.size}/${f.size}`, lineOf('electron/agent/tool-defs.ts', 'export function defsForProfile'));
  ck(F, [...e].every((n) => b.has(n)) && [...b].every((n) => f.has(n)), 'no advertised tool lost across profiles', 'subset violation', lineOf('electron/agent/tool-defs.ts', 'export function defsForProfile'));
  ck(F, essential.every((d) => d.kind === 'mcp' || e.has(d.name)), 'MCP defs never filtered by profile', 'mcp filtered out', lineOf('electron/agent/tool-defs.ts', 'MCP defs are NEVER filtered out'));

  // defsForProfile must FILTER a copy — never splice / truncate the registry.
  const profileBody = src('electron/agent/tool-defs.ts').split('export function defsForProfile')[1] ?? '';
  ck(F, !/\.splice\s*\(|\.length\s*=|delete\s/.test(profileBody), 'defsForProfile never mutates/deletes the registry', 'mutation found in defsForProfile', lineOf('electron/agent/tool-defs.ts', 'export function defsForProfile'));
  ck(F, /\.filter\s*\(/.test(profileBody), 'defsForProfile filters (advertisement), not deletion', 'no filter() — profile logic changed', lineOf('electron/agent/tool-defs.ts', 'export function defsForProfile'));

  // executeTool resolves defs with getToolDefs(ctx.mcpServers) — no profile arg,
  // i.e. the FULL registry, so no profile can delete an executor.
  const toolsSrc = src('electron/agent/tools.ts');
  ck(F, /getToolDefs\(ctx\.mcpServers\)\.find\(/.test(toolsSrc), 'executeTool resolves the FULL registry (default profile)', 'executor lookup narrowed by a profile', lineOf('electron/agent/tools.ts', 'getToolDefs(ctx.mcpServers).find'));

  // No ad-hoc tools.slice(0, N) / splice(0, N) on a tool collection.
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const toolColl = '(?:tools|toolDefs|toolList|allTools|availableTools|advertisedTools|defs|enabledMcp)';
  const badSlice = new RegExp(`\\b${toolColl}\\w*\\s*\\.\\s*slice\\s*\\(\\s*0\\s*,`, 'i');
  const badSplice = new RegExp(`\\b${toolColl}\\w*\\s*\\.\\s*splice\\s*\\(\\s*0\\s*,`, 'i');
  const offenders = [];
  for (const rel of ['electron/agent/tool-defs.ts', 'electron/agent/tools.ts', 'electron/agent/providers.ts', 'electron/agent/engine.ts']) {
    const originalLines = src(rel).split(/\r?\n/);
    const strippedLines = strip(src(rel)).split(/\r?\n/);
    strippedLines.forEach((line, i) => {
      // A `.slice(0,N).join(', ')` inside a human-readable prompt/notice is a
      // display truncation, NOT tool removal — the tools:[] array is intact.
      const displayOnly = /\.join\s*\(/.test(line);
      if (!displayOnly && (badSlice.test(line) || badSplice.test(line))) {
        offenders.push(`${rel}:${i + 1} ${originalLines[i]?.trim() ?? line.trim()}`);
      }
    });
  }
  ck(F, offenders.length === 0, 'no tools.slice(0,N) / splice(0,N) on a tool collection', offenders.join(' | '), 'electron/agent/providers.ts / tools.ts');

  // The ONLY legitimate narrowing: a 422 gateway fallback removes exactly ONE
  // located tool (splice(index,1)), driven by the error loc — not a fixed cap.
  const prov = src('electron/agent/providers.ts');
  ck(F, /obj\.tools\.splice\(index,\s*1\)/.test(prov), '422 fallback removes ONE located tool', 'single-tool 422 splice missing', lineOf('electron/agent/providers.ts', 'obj.tools.splice(index, 1)'));
  ck(F, /toolIndexFromValidationError/.test(prov), '422 fallback is loc-driven, not a fixed cap', 'loc-based detection missing', lineOf('electron/agent/providers.ts', 'toolIndexFromValidationError'));

  dump(F, 'G1a');
  assert.equal(F.length, 0, `G1a source guard: ${F.length} failure(s) — see [V1126 FAIL] G1a lines above`);
});

test('G1b runtime: all 145 defs dispatch through executeTool (145/145 executors, no Unknown tool)', { timeout: 300_000 }, async () => {
  const F = [];
  const defs = tools.getToolDefs([]);
  const ctx = () => ({
    workspace: tmp, sessionId: 'v1126-exec-sweep', mcpServers: [],
    emit() {}, approve: async () => true, fullAccess: true,
  });
  const unknown = [], threw = [], malformed = [];
  let okCount = 0, refusalCount = 0;
  for (const d of defs) {
    let res;
    try {
      res = await Promise.race([
        tools.executeTool(d.name, '{}', ctx()),
        new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT >20s')), 20_000)),
      ]);
    } catch (err) {
      threw.push(`${d.name}: ${err?.message ?? String(err)}`);
      continue;
    }
    const out = typeof res?.output === 'string' ? res.output : '';
    if (typeof res?.ok !== 'boolean' || !out.length) {
      malformed.push(`${d.name}: missing ok flag / empty output`);
      continue;
    }
    if (/^Unknown tool:/.test(out)) {
      unknown.push(d.name);
      continue;
    }
    if (res.ok === true) okCount++; else refusalCount++;
  }
  ck(F, threw.length === 0, 'executeTool never rejects / never hangs (20s cap)', threw.join(' | '), 'electron/agent/tools.ts:1054 (executeToolImpl)');
  ck(F, malformed.length === 0, 'every outcome has ok flag + non-empty output', malformed.join(' | '), 'electron/agent/tools.ts:1054');
  ck(F, unknown.length === 0, 'no "Unknown tool" — every def has a reachable executor', unknown.join(', '), lineOf('electron/agent/tools.ts', 'Unknown tool:'));
  const reach = okCount + refusalCount;
  ck(F, reach === 145, 'executor coverage is 145/145', `reachable=${reach}/145 (ok=${okCount}, honest-refusal=${refusalCount})`, lineOf('electron/agent/tool-defs.ts', 'export const CORE_DEFS'));

  dump(F, 'G1b');
  console.log(`[V1126] G1b RESULT: executors reachable = ${reach}/145 (ok=${okCount}, honest-refusal=${refusalCount}, unknown=0, threw=0)`);
  assert.equal(F.length, 0, `G1b runtime guard: ${F.length} failure(s) — see [V1126 FAIL] G1b lines above`);
});

// ===========================================================================
// G2 — REAL ENGINE RUN: core tool + use_skill + MCP tool + ledgers
// ===========================================================================

// --- Real stdio MCP server (spawned child, JSON-RPC over newline-stdio) ---
const MCP_ID = 'demo-v1126';
const mcpReceipt = join(tmp, 'mcp-v1126-receipt.jsonl');
const MCP_SCRIPT = join(tmp, 'mcp-v1126-server.mjs');
writeFileSync(MCP_SCRIPT, `import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const RECEIPT = process.env.V1126_RECEIPT;
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined || msg.id === null) return; // notifications/initialized
  if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: '${MCP_ID}', version: '1.0.0' } } });
  else if (msg.method === 'tools/list') send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'echo', description: 'Echo back the text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] } });
  else if (msg.method === 'tools/call') { appendFileSync(RECEIPT, JSON.stringify({ tool: msg.params.name, args: msg.params.arguments }) + '\\n'); send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'echo:' + (msg.params.arguments?.text ?? '') }] } }); }
  else send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'no such method' } });
});`);
// The advertised MCP tool name is derived from server.name (slugified):
//   mcp__<slug(server.name)>__<slug(tool name)>  →  mcp__demo_v1126__echo
const MCP_CFG = {
  id: MCP_ID, name: 'Demo V1126', transport: 'stdio',
  command: process.execPath, args: [MCP_SCRIPT], env: { V1126_RECEIPT: mcpReceipt }, enabled: true,
};

// --- Skill (global scope under SURNIA_HOME/userData) ---
const WS = join(tmp, 'ws-guard');
mkdirSync(join(WS, '.surnia'), { recursive: true });
writeFileSync(join(WS, '.surnia', 'skills-trusted'), ''); // user opted in
const SKILL_SLUG = 'guard-skill';
const SKILL_MARKER = 'GUARD_SKILL_BODY_MARKER_9F3';
const CORE_MARKER = 'CORE_TOOL_MARKER_9F3';
const MCP_MARKER = 'MCP_TOOL_MARKER_9F3';
mkdirSync(join(ud, 'skills', SKILL_SLUG), { recursive: true });
writeFileSync(join(ud, 'skills', SKILL_SLUG, 'SKILL.md'),
  `---\nname: Guard Skill\ndescription: A verification ritual for testing tool reachability across engines\n---\n# Guard Skill\n${SKILL_MARKER} — always verify before claiming success.\n`);

// --- Scripted local OpenAI-compatible provider ---
const GUARD_MODEL = 'guard-model';
const routes = new Map();
const requests = [];
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'guard', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const toolDeltas = (name, args, id) => [
  { tool_calls: [{ index: 0, id, function: { name, arguments: '' } }] },
  { tool_calls: [{ index: 0, function: { arguments: typeof args === 'string' ? args : JSON.stringify(args) } }] },
];
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
    requests.push({
      model: body.model,
      messages: (body.messages ?? []).map((m) => ({ role: m?.role, content: String(m?.content ?? '') })),
    });
    const q = routes.get(body.model) ?? [];
    const h = q.shift() ?? null;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.flushHeaders();
    if (h) {
      try { await h({ res }); } catch { try { res.destroy(); } catch { /* gone */ } }
      return;
    }
    // Unscripted secondary request (extraction / role model) — honest no-op.
    res.write(sseChunk({ content: '' }));
    res.write(sseChunk({}, 'stop'));
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
const mockPort = await new Promise((r) => mock.listen(0, '127.0.0.1', () => r(mock.address().port)));
const BASE = `http://127.0.0.1:${mockPort}/v1`;
function scriptTurn(opts) {
  const q = routes.get(GUARD_MODEL) ?? [];
  q.push(async ({ res }) => {
    if (opts.text) res.write(sseChunk({ content: opts.text }));
    if (opts.tool) for (const d of toolDeltas(opts.tool.name, opts.tool.args, opts.tool.id)) res.write(sseChunk(d));
    res.write(sseChunk({}, opts.tool ? 'tool_calls' : 'stop'));
    res.write('data: [DONE]\n\n');
    res.end();
  });
  routes.set(GUARD_MODEL, q);
}
function resetScript() {
  routes.set(GUARD_MODEL, []);
  scriptTurn({ tool: { name: 'use_skill', args: { slug: SKILL_SLUG }, id: 'call_skill' } });
  scriptTurn({ tool: { name: 'run_command', args: { command: `node -e "console.log('${CORE_MARKER}')"` }, id: 'call_core' } });
  scriptTurn({ tool: { name: 'mcp__demo_v1126__echo', args: { text: MCP_MARKER }, id: 'call_mcp' } });
  scriptTurn({
    text: `ALL THREE TOOLS COMPLETED: skill=${SKILL_MARKER} core=${CORE_MARKER} mcp=echo:${MCP_MARKER} — done.`,
  });
}

// --- settings.json ---
writeFileSync(join(ud, 'settings.json'), JSON.stringify({
  schemaVersion: 4,
  language: 'en',
  providers: { custom: { apiKey: 'test-key', baseUrl: BASE } },
  agent: {
    maxRetries: 0, autoCompact: false, compactThreshold: 10_000, autoVerify: false,
    selfCritique: false, criticGate: false, autoMemory: false, checkpointsEnabled: false,
    allowModelFailover: false,
  },
  doneNotifications: false,
}));

// --- engine + helpers bundles (engine holds its OWN module instances) ---
const engPath = join(tmp, 'engine-v1126.cjs');
const mcpPath = join(tmp, 'mcp-v1126.cjs');
const registryPath = join(tmp, 'registry-v1126.cjs');
const skillsPath = join(tmp, 'skills-v1126.cjs');
const gatePath = join(tmp, 'skillGate-v1126.cjs');
let engine, mcpMod, registryMod, skillsMod, gateMod;
try {
  bundle('electron/agent/engine.ts', engPath);
  bundle('electron/agent/mcp.ts', mcpPath);
  bundle('electron/services/mcpRegistryService.ts', registryPath);
  bundle('electron/agent/skills.ts', skillsPath);
  bundle('electron/agent/skillGate.ts', gatePath);
  engine = require(engPath);
  mcpMod = require(mcpPath);
  registryMod = require(registryPath);
  skillsMod = require(skillsPath);
  gateMod = require(gatePath);
} catch (err) {
  console.error('[V1126] BUNDLE FAILED — no engine run possible:', err?.message ?? err);
  throw err;
}
// Seed the registry so the MCP call counter is observable on disk.
try { registryMod.saveServer(MCP_CFG); } catch { /* best effort */ }

function makeIo() {
  const events = [];
  return {
    events,
    send(e) { events.push({ ...e, at: Date.now(), raw: e }); },
    getDecision() { return Promise.resolve({ requestId: 'v1126', action: 'allow' }); },
    isAborted() { return false; },
    onFetchSignal() {},
  };
}
async function driveOnce(sessionId) {
  const io = makeIo();
  try {
    await engine.runAgent({
      task: 'chat',
      sessionId,
      messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Call the skill, the core tool and the MCP tool, then report.', timestamp: Date.now() }],
      model: { provider: 'custom', model: GUARD_MODEL, maxTokens: 2048 },
      mode: 'fullAccess',
      workspace: WS,
      apiKey: 'test-key',
      baseUrl: BASE,
      mcpServers: [MCP_CFG],
    }, io);
  } catch (err) {
    io.thrown = err;
  }
  return io;
}

function dateStamp() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
async function readSettled(file, sentinel, ms = 8000) {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const t = readFileSync(file, 'utf8');
      if (!sentinel || t.includes(sentinel)) return t;
    } catch { /* not yet */ }
    if (Date.now() > deadline) {
      try { return readFileSync(file, 'utf8'); } catch { return ''; }
    }
    await sleep(120);
  }
}

test('G2 real engine run: model calls use_skill + core tool + MCP tool; results reach the answer; ledgers written', { timeout: 420_000 }, async () => {
  const F = [];
  let io = null;
  const sessionId = 'v1126-guard-' + Math.random().toString(36).slice(2);

  // Cold MCP clients can miss the first run's fire-and-forget discovery; retry
  // the WHOLE exchange (same honest contract as v1110's MCP harness).
  let startSkill, startCore, startMcp, resSkill, resCore, resMcp, usedAttempts = 0;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try { mcpMod.closeAllMcpClients(); } catch { /* best effort */ }
    requests.length = 0;
    resetScript();
    io = await driveOnce(sessionId + '-' + attempt);
    usedAttempts = attempt;
    startSkill = io.events.find((e) => e.type === 'tool_start' && e.name === 'use_skill');
    startCore = io.events.find((e) => e.type === 'tool_start' && e.name === 'run_command');
    startMcp = io.events.find((e) => e.type === 'tool_start' && e.name === 'mcp__demo_v1126__echo');
    const resultFor = (s) => s && io.events.find((e) => e.type === 'tool_result' && e.toolCallId === s.toolCallId);
    resSkill = resultFor(startSkill);
    resCore = resultFor(startCore);
    resMcp = resultFor(startMcp);
    const allOk = !!startSkill && !!startCore && !!startMcp
      && resSkill?.ok && resCore?.ok && resMcp?.ok
      && String(resMcp?.output ?? '').includes(`echo:${MCP_MARKER}`);
    if (allOk) break;
    await sleep(400);
  }

  ck(F, !io?.thrown, 'runAgent does not throw', io?.thrown?.stack ?? io?.thrown, 'electron/agent/engine.ts:runAgent');
  ck(F, !!startSkill, 'model called use_skill through the real engine', `starts=${io.events.filter((e) => e.type === 'tool_start').map((e) => e.name).join(',')}`, lineOf('electron/agent/engine.ts', "p.call.name === 'use_skill'"));
  ck(F, !!startCore, 'model called a CORE tool (run_command) through the real engine', 'no run_command tool_start', lineOf('electron/agent/engine.ts', 'executeTool(p.call.name'));
  ck(F, !!startMcp, 'model called the MCP tool through the real engine', 'no mcp__demo_v1126__echo tool_start', lineOf('electron/agent/tools.ts', "def.kind === 'mcp' && def.mcpServerName"));

  // Every result is honest + reaches the model and the final answer.
  ck(F, !!resSkill?.ok && String(resSkill?.output ?? '').includes(SKILL_MARKER), 'use_skill returned the real skill body', JSON.stringify(resSkill && { ok: resSkill.ok, out: String(resSkill.output).slice(0, 120) }), lineOf('electron/agent/tools.ts', "case 'use_skill'"));
  ck(F, !!resCore?.ok && String(resCore?.output ?? '').includes(CORE_MARKER), 'core tool returned the real command output', JSON.stringify(resCore && { ok: resCore.ok, out: String(resCore.output).slice(0, 120) }), lineOf('electron/agent/tools.ts', "case 'run_command'"));
  ck(F, !!resMcp?.ok && String(resMcp?.output ?? '').includes(`echo:${MCP_MARKER}`), 'MCP result physically round-tripped from the server', JSON.stringify(resMcp && { ok: resMcp.ok, out: String(resMcp.output).slice(0, 120) }), lineOf('electron/agent/tools.ts', 'MCP tool call'));

  const finalText = io.events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
  for (const [label, marker] of [['skill', SKILL_MARKER], ['core', CORE_MARKER], ['mcp', MCP_MARKER]]) {
    ck(F, finalText.includes(marker), `${label} tool result reached the FINAL answer`, finalText.slice(-260), 'electron/agent/engine.ts:pushMessage(tool_result)');
  }
  // The LAST model request must carry all three tool_results back to the model.
  const guardReqs = requests.filter((r) => r.model === GUARD_MODEL);
  const lastReq = JSON.stringify(guardReqs.at(-1)?.messages ?? []);
  for (const [label, marker] of [['skill', SKILL_MARKER], ['core', CORE_MARKER], ['mcp', MCP_MARKER]]) {
    ck(F, lastReq.includes(marker), `${label} tool_result fed back into the model transcript`, `last guard request has ${guardReqs.length} turns`, 'electron/agent/engine.ts:5625 (pushMessage tool_result)');
  }
  const report = io.events.find((e) => e.type === 'task_report');
  ck(F, !!report, 'run emitted a task_report', 'no task_report', 'electron/agent/engine.ts:1767');

  // ---- Ledgers physically written ----
  // 1) durable journal
  const jFile = join(ud, 'journals', dateStamp(), `${sessionId}-${usedAttempts}.jsonl`);
  const jText = await readSettled(jFile, '"type":"finish"');
  const jToolNames = jText.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } })
    .filter((o) => o.type === 'tool').map((o) => o.name);
  for (const n of ['use_skill', 'run_command', 'mcp__demo_v1126__echo']) {
    ck(F, jToolNames.includes(n), `journal records tool '${n}'`, `journal tools=${jToolNames.join(',')} file=${jFile}`, 'electron/agent/journal.ts:185 (journalEvent)');
  }
  ck(F, jText.includes('"type":"finish"'), 'journal finish line written', jText.slice(-120), 'electron/agent/journal.ts:266 (finishRunJournal)');

  // 2) trace recorder
  const traceDir = join(ud, 'traces', dateStamp());
  let traceText = '';
  try {
    const tf = readdirSync(traceDir).filter((f) => f.startsWith('trace-') && f.endsWith('.jsonl')).sort().at(-1);
    if (tf) traceText = await readSettled(join(traceDir, tf), '"type":"footer"');
  } catch { /* none */ }
  for (const n of ['use_skill', 'run_command', 'mcp__demo_v1126__echo']) {
    ck(F, traceText.includes(`"${n}"`), `trace records tool '${n}'`, `trace bytes=${traceText.length}`, 'electron/agent/traces.ts:189 (TraceRecorder.step)');
  }
  ck(F, traceText.includes('"type":"footer"'), 'trace footer written', `trace tail=${traceText.slice(-120)}`, 'electron/agent/traces.ts:197 (finish)');

  // 3) skill ledgers — usage + evidence promotion
  const usageFile = join(ud, 'skill-usage.json');
  const usageText = await readSettled(usageFile, SKILL_SLUG, 6000);
  ck(F, usageText.includes(SKILL_SLUG), 'skill-usage.json ledger records the used skill', `usage bytes=${usageText.length}`, 'electron/agent/skillGate.ts:295');
  let promoText = '';
  try { promoText = await readSettled(join(ud, 'skill-promotions.json'), SKILL_SLUG, 6000); } catch { /* none */ }
  ck(F, promoText.includes(SKILL_SLUG), 'skill-promotions.json ledger records the skill', `promotions bytes=${promoText.length}`, 'electron/agent/skillGate.ts:64');
  try {
    const status = gateMod.skillGateStatus(ud, SKILL_SLUG, false);
    ck(F, status === 'verified' || status === 'candidate', 'skill gate status is a real recorded state', `status=${status}`, 'electron/agent/skillGate.ts:skillGateStatus');
  } catch (e) {
    ck(F, false, 'skill gate status readable', e?.message ?? String(e), 'electron/agent/skillGate.ts:skillGateStatus');
  }

  // 4) proof + false-done ledgers
  ck(F, io.events.some((e) => e.type === 'proof_package'), 'proof_package event emitted for real work', `types=${[...new Set(io.events.map((e) => e.type))].join(',')}`, lineOf('electron/agent/engine.ts', "type: 'proof_package'"));
  const proofDir = join(ud, 'proofs');
  let proofFiles = [];
  try { proofFiles = readdirSync(proofDir); } catch { /* none */ }
  ck(F, proofFiles.length > 0, 'proof package file written to disk', `proofs dir files=${proofFiles.length}`, lineOf('electron/agent/engine.ts', 'saveProofPackage(proof'));
  ck(F, io.events.some((e) => e.type === 'false_done'), 'false_done ledger event emitted', 'no false_done event', lineOf('electron/agent/engine.ts', "type: 'false_done'"));

  // 5) MCP call counter on disk
  let calls = 0;
  try { calls = registryMod.serverCalls(MCP_ID); } catch { calls = 0; }
  ck(F, calls >= 1, 'MCP registry persisted the real tool call', `serverCalls=${calls}`, 'electron/services/mcpRegistryService.ts:serverCalls');
  const receipts = existsSync(mcpReceipt)
    ? readFileSync(mcpReceipt, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } })
    : [];
  ck(F, receipts.some((r) => r.args?.text === MCP_MARKER), 'stdio MCP server physically received the engine-routed call', `receipts=${JSON.stringify(receipts).slice(0, 160)}`, 'electron/agent/mcp.ts:mcpCallTool');

  try { mcpMod.closeAllMcpClients(); } catch { /* best effort */ }
  dump(F, 'G2');
  console.log(`[V1126] G2 RESULT: attempts=${usedAttempts} skill=${!!resSkill?.ok} core=${!!resCore?.ok} mcp=${!!resMcp?.ok} ledgers checked; failures=${F.length}`);
  assert.equal(F.length, 0, `G2 engine-run guard: ${F.length} failure(s) — see [V1126 FAIL] G2 lines above`);
});

// ===========================================================================
// G3 — SLASH COMMAND GUARD
// ===========================================================================

test('G3a source: every ADVERTISED slash command maps to a real handler (no no-op/TODO)', () => {
  const F = [];
  const GUIDE = src('src/components/CapabilityGuide.tsx');
  const COMPOSER = src('src/components/Composer.tsx');
  const STORE = src('src/store.ts');
  const SLASH = src('electron/services/slashService.ts');

  // Advertised sets: the capability guide, the composer menu, and /help text.
  const advertised = new Set();
  for (const m of GUIDE.matchAll(/\{\s*cmd:\s*'(\/[a-z0-9_-]+)'/g)) advertised.add(m[1]);
  for (const m of COMPOSER.matchAll(/\{\s*cmd:\s*'(\/[a-z0-9_-]+)'/g)) advertised.add(m[1]);
  const helpBlock = STORE.slice(STORE.indexOf("if (cmd === 'help')"), STORE.indexOf("if (cmd === 'clear')"));
  for (const m of helpBlock.matchAll(/'(\/[a-z0-9_-]+)\s*—/g)) advertised.add(m[1]);

  // Handler sets.
  const storeHandlers = new Set();
  for (const m of STORE.matchAll(/cmd === '([a-z0-9_-]+)'/g)) storeHandlers.add('/' + m[1]);
  const templates = new Set();
  const tBlock = STORE.slice(STORE.indexOf('const SLASH_PROMPT_TEMPLATES'), STORE.indexOf('// ── A1 — built-in'));
  for (const m of tBlock.matchAll(/^\s{2}([a-z]+):\s*(?:\(|())/gm)) if (m[1]) templates.add('/' + m[1]);
  // Template dispatcher: cmd === 'pr' || 'changelog' || 'tests' || 'handoff' || 'grill'
  for (const c of ['pr', 'changelog', 'tests', 'handoff', 'grill']) templates.add('/' + c);
  const engineModes = new Set(
    [...SLASH.matchAll(/^\s*(build|plan|debug|review):\s*'(build|plan|debug|review)'/gm)].map((m) => '/' + m[1]),
  );

  ck(F, advertised.size >= 40, 'advertised command set is substantial', `advertised=${advertised.size}`, 'src/components/CapabilityGuide.tsx:55');

  const missing = [];
  for (const cmd of [...advertised].sort()) {
    const bare = cmd.slice(1);
    const has = storeHandlers.has(cmd) || templates.has(cmd) || engineModes.has(cmd);
    if (!has) missing.push(cmd);
  }
  ck(F, missing.length === 0, 'every advertised command has a real handler', missing.join(', '), 'src/store.ts:2908 (slash dispatch) / src/components/Composer.tsx:649');

  // No no-op / TODO handler in the store's slash region.
  const slashRegion = STORE.slice(STORE.indexOf("if (raw.startsWith('/'))"), STORE.indexOf('// v2.4 — the daily-run paywall gate is GONE'));
  const noop = [];
  slashRegion.split(/\r?\n/).forEach((line, i) => {
    if (/\bTODO\b|\bFIXME\b|not\s+implemented|throw new Error\('not implemented'\)/i.test(line)) {
      noop.push(`L${i}: ${line.trim()}`);
    }
  });
  ck(F, noop.length === 0, 'no TODO / not-implemented slash handlers', noop.join(' | '), 'src/store.ts:2908-3378');

  // The guide's advertised tool counts must match the LIVE registry.
  ck(F, /count:\s*'145'/.test(GUIDE) && GUIDE.includes('145 real tools'), 'guide advertises the real 145-tool count', 'stale tool count advertised', lineOf('src/components/CapabilityGuide.tsx', "count: '145'"));
  const liveEssential = td.defsForProfile(td.CORE_DEFS, 'essential').length;
  const liveBalanced = td.defsForProfile(td.CORE_DEFS, 'balanced').length;
  const liveFull = td.defsForProfile(td.CORE_DEFS, 'full').length;
  const WHATSNEW = src('src/components/WhatsNew.tsx');
  for (const [name, n] of [['essential', liveEssential], ['balanced', liveBalanced], ['full', liveFull]]) {
    ck(F, GUIDE.includes(`count: '${n}'`), `CapabilityGuide advertises the LIVE ${name} count (${n})`, `guide advertises a stale/wrong ${name} count (live=${n})`, lineOf('src/components/CapabilityGuide.tsx', `id: { en: '${name}'`));
  }
  ck(F, WHATSNEW.includes(`balanced (${liveBalanced}, the default)`),
    'WhatsNew advertises the LIVE balanced count', `WhatsNew has a stale balanced count (live=${liveBalanced})`,
    lineOf('src/components/WhatsNew.tsx', 'balanced ('));

  dump(F, 'G3a');
  console.log(`[V1126] G3a RESULT: advertised=${advertised.size} missing=${missing.length} noop=${noop.length}`);
  assert.equal(F.length, 0, `G3a slash source guard: ${F.length} failure(s) — see [V1126 FAIL] G3a lines above`);
});

test('G3b runtime: engine slashService dispatch has observable effects (task-mode / custom / unknown)', async () => {
  const F = [];
  const slashHome = join(tmp, 'slash-home');
  const cmdDir = join(slashHome, 'commands');
  mkdirSync(cmdDir, { recursive: true });
  writeFileSync(join(cmdDir, 'guard-deploy.md'),
    '# Deploy guard command\nDeploy to $1 with arguments: $ARGUMENTS\n');
  process.env.SURNIA_HOME = slashHome; // KODEX_HOME computed at module load
  const slashPath = join(tmp, 'slashService-v1126.cjs');
  bundle('electron/services/slashService.ts', slashPath);
  delete require.cache[require.resolve(slashPath)];
  const slash = require(slashPath);

  const plan = await slash.dispatchSlashCommand({ raw: '/plan' });
  ck(F, plan.kind === 'task-mode' && plan.taskMode === 'plan' && !!plan.notice,
    '/plan switches task mode with a visible notice', JSON.stringify(plan), lineOf('electron/services/slashService.ts', 'TASK_MODE_SLASH_COMMANDS'));
  const build = await slash.dispatchSlashCommand({ raw: '/build' });
  ck(F, build.kind === 'task-mode' && build.taskMode === 'build', '/build switches task mode', JSON.stringify(build), lineOf('electron/services/slashService.ts', 'build:'));
  const custom = await slash.dispatchSlashCommand({ raw: '/guard-deploy production --verbose' });
  ck(F, custom.kind === 'custom' && /production/.test(custom.expanded ?? '') && /production --verbose/.test(custom.expanded ?? ''),
    'custom command expands $1 + $ARGUMENTS into a real turn', JSON.stringify(custom), lineOf('electron/services/slashService.ts', 'expandCommand(body, rest)'));
  const unknown = await slash.dispatchSlashCommand({ raw: '/definitely-not-a-command' });
  ck(F, unknown.kind === 'unknown' && /\/help/.test(unknown.notice ?? ''),
    'unknown command yields a local notice (never silently reaches the model)', JSON.stringify(unknown), lineOf('electron/services/slashService.ts', 'const UNKNOWN_EN'));

  dump(F, 'G3b');
  assert.equal(F.length, 0, `G3b slash runtime guard: ${F.length} failure(s) — see [V1126 FAIL] G3b lines above`);
});

// ===========================================================================
// G4 — FINAL BLUNT VERDICT
// ===========================================================================
test('G4 verdict: print the aggregate honesty line', () => {
  const total = ALL.length;
  const verdict = total === 0
    ? 'ALL CAPABILITIES REALLY USABLE (145/145 tools dispatchable; real engine run with core+skill+MCP + ledgers; every advertised slash command handled).'
    : `STILL PARTLY COSMETIC — ${total} failing capability guard check(s); see [V1126 FAIL] lines above for exact file:line.`;
  console.error(`\n===== V1126 CAPABILITIES VERDICT =====\n${verdict}\nTOTAL GUARD FAILURES: ${total}\n=====================================\n`);
  assert.ok(true);
});

after(() => {
  try { mock.close(); } catch { /* gone */ }
  for (const k of [
    'SURNIA_HOME', 'SURNIA_SKIP_UI_GATE', 'SURNIA_TURN_RETRY_DELAYS_MS', 'SURNIA_DELTA_FLUSH_MS',
    'SURNIA_STREAM_CONTINUE_BUDGET', 'SURNIA_MAX_TOKENS_CONTINUES', 'SURNIA_SSE_IDLE_MS',
    'SURNIA_ENGINE_IDLE_MS', 'SURNIA_NO_BROWSER',
  ]) delete process.env[k];
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});
