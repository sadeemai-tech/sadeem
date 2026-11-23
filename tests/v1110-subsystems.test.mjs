import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// v11.10 — SUBSYSTEM PROOF SUITE (Task A7): the founder claims six
// subsystems are decorative. This suite drives each one END-TO-END
// through its REAL implementation (mock LLM provider only):
//
//   1. SKILLS   user skill (global scope) → listSkills → skillsIndexLine →
//               buildSystemPrompt injection → REAL engine run where the
//               model calls use_skill → usage counter on disk →
//               skillGate candidate→verified (incl. the REAL trace scan).
//   2. MCP      real stdio JSON-RPC server (spawned child) + real local
//               streamable-HTTP server → registry.saveServer → listServers
//               probes BOTH (remote/url included — v3.1 claim) →
//               mcpListTools → executeTool('mcp__demo__echo') → server
//               received the call (receipt file) → full engine run that
//               invokes the MCP tool.
//   3. FLOWS    flowsSave → REAL engine run executes the flow's prompt as
//               two ordered write_file steps → flowsMarkRun persists
//               runCount/lastRun → flowsValidateByReplay runs the stored
//               command for real (exit 0 + marker file) → flowsHit suggests.
//   4. DNA      REAL engine run: post-run auto-extraction (mock provider
//               returns the fact JSON) lands in userData/dna.json →
//               fresh reload from disk → renderDNAPrompt + buildSystemPrompt
//               contain it → dna_updated event + kdx:dna:event captured →
//               DNA API preferences/corrections persist.
//   6. SCHEDULE seeded cron job fires on the REAL 30s tick → headless agent
//               run (mock provider) → job marked ok + persisted → no
//               double-fire inside the re-arm window (recurring re-arm).
//   7. FEEDBACK saveFeedback → 0600 file on disk → listFeedback → markdown.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-a7-'));
const ud = join(tmp, 'userdata'); // electron-stub userData — every store lands here
mkdirSync(ud, { recursive: true });

// ---------- esbuild bundle (same posture as v1110-endurance) ----------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, 
    entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// ---------- electron stub (userData → ud; BrowserWindow captures IPC sends) ----------
const CAPTURED = []; // {channel, payload} — every webContents.send from any bundle
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `const CAPTURED = globalThis.__A7_CAPTURED__ || (globalThis.__A7_CAPTURED__ = []);
module.exports = {
  app: { getPath: (k) => (k === 'userData' ? ${JSON.stringify(ud)} : ${JSON.stringify(tmp)}), whenReady: async () => true, on() {}, quit() {}, isReady: () => true, getName: () => 'surnia-a7', getVersion: () => '0.0.0-a7' },
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
const capture = () => globalThis.__A7_CAPTURED__ ?? CAPTURED;

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
    // v11.16: the prompt-cache split emits TWO system messages (stable prefix
    // + dynamic tail). Concatenate all system messages so assertions see the
    // full effective prompt regardless of the caching wire format.
    const sysMsgs = (body.messages ?? []).filter((m) => m?.role === 'system');
    requests.push({ model: body.model, system: sysMsgs.map((m) => String(m.content ?? '')).join('\n'), at: Date.now() });
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
/** Queue one scripted SSE turn: optional think/text, optional tool call, finish. */
function script(model, { text = null, tool = null, finish = null, usage } = {}) {
  const q = routes.get(model) ?? [];
  q.push(async ({ res }) => {
    if (text !== null) res.write(sseChunk({ content: text }));
    if (tool) for (const d of toolDeltas(tool.name, typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args), tool.id ?? 'call_1')) res.write(sseChunk(d));
    if (usage) res.write(`data: ${JSON.stringify({ usage, choices: [] })}\n\n`);
    res.write(sseChunk({}, finish ?? (tool ? 'tool_calls' : 'stop')));
    res.write('data: [DONE]\n\n');
    res.end();
  });
  routes.set(model, q);
}

// ---------- settings.json (providers → mock; learning knobs on/off) ----------
const BASE_URL = await listen;
writeFileSync(join(ud, 'settings.json'), JSON.stringify({
  schemaVersion: 4,
  providers: { custom: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${BASE_URL}` } },
  agent: { maxRetries: 0, autoCompact: false, autoVerify: false, autoMemory: false },
  doneNotifications: false,
}));

// ---------- bundles ----------
const B = {}; // name → module path
for (const [name, entry] of Object.entries({
  engine: 'electron/agent/engine.ts',
  prompts: 'electron/agent/prompts.ts',
  skills: 'electron/agent/skills.ts',
  skillGate: 'electron/agent/skillGate.ts',
  mcp: 'electron/agent/mcp.ts',
  tools: 'electron/agent/tools.ts',
  dna: 'electron/agent/dna.ts',
  flows: 'electron/services/flowsService.ts',
  schedule: 'electron/services/scheduleService.ts',
  registry: 'electron/services/mcpRegistryService.ts',
  feedback: 'electron/services/feedbackService.ts',
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
const prompts = require(B.prompts);
const tools = require(B.tools);

// ---------- engine harness ----------
function makeIo() {
  const events = [];
  return {
    events,
    send(e) { if (process.env.A7_DEBUG) console.error('[evt]', e.type, String(e.text ?? e.output ?? e.message ?? '').slice(0, 90).replace(/\n/g, ' ')); events.push(e); },
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

// ============================================================
// 1. SKILLS — listed → injected → invoked → gate promoted
// ============================================================
const WS_SKILL = join(tmp, 'ws-skill');
mkdirSync(join(WS_SKILL, '.surnia', 'skills'), { recursive: true });
writeFileSync(join(WS_SKILL, '.surnia', 'skills-trusted'), ''); // user opted in
const SKILL_BODY = 'TIDE_BODY_MARKER — always write the failing test first, then the fix.';
const skillMd = `---\nname: Sea Tide\ndescription: A user-authored debugging ritual for flaky maritime tests\n---\n# Sea Tide\n${SKILL_BODY}\n`;
mkdirSync(join(ud, 'skills', 'sea-tide'), { recursive: true });
writeFileSync(join(ud, 'skills', 'sea-tide', 'SKILL.md'), skillMd); // global scope = temp surnia home

test('A7 skills: discovery → index line → buildSystemPrompt injection', async () => {
  const skills = fresh('skills');
  const list = await skills.listSkills(WS_SKILL);
  const hit = list.find((s) => s.slug === 'sea-tide');
  assert.ok(hit, 'listSkills picks up the user skill');
  assert.equal(hit.scope, 'global', 'user skill found in the global (userData) scope');

  const index = await skills.skillsIndexLine(WS_SKILL);
  assert.ok(index.includes('Sea Tide') && index.includes('sea-tide'), 'skillsIndexLine lists it');
  assert.ok(index.includes('candidate — not yet evidence-verified'), 'gate badge starts at candidate');

  const built = prompts.buildSystemPrompt({
    workspace: WS_SKILL, mode: 'fullAccess', platform: process.platform,
    skills: index.split('\n').filter(Boolean).map((l) => {
      const m = /^(.+?)\s+\(([^)]+)\)\s+—\s+(.*)$/.exec(l.replace(/^-\s*/, ''));
      return { name: m[1], description: m[3] };
    }),
  });
  assert.ok(built.includes('# SKILLS') && built.includes('Sea Tide'), 'buildSystemPrompt injects the skill index');
  assert.ok(built.includes('use_skill'), 'prompt teaches the use_skill path');
});

test('A7 skills: REAL engine run — model invokes use_skill, usage recorded, gate candidate→verified', async () => {
  script('mock-skill', { tool: { name: 'use_skill', args: { slug: 'sea-tide' }, id: 'call_skill' } });
  script('mock-skill', { text: 'SKILL_APPLIED_MARKER — followed the Sea Tide ritual.' });
  // v11.19: skills are matched to the TASK (not all injected). Use a task
  // whose words match the "Sea Tide" debugging ritual so it is selected.
  const io = await runEngine({ workspace: WS_SKILL, model: 'mock-skill', taskText: 'Debug the flaky tests using the Sea Tide ritual.' });

  assert.ok(lastRequestSystem('mock-skill').includes('Sea Tide'), 'engine injected the skill index into the REAL system prompt');
  const start = io.events.find((e) => e.type === 'tool_start' && e.name === 'use_skill');
  assert.ok(start, 'model issued use_skill through the real engine');
  const res = toolResultsFor(io, start.toolCallId)[0];
  assert.ok(res?.ok, 'use_skill executed OK');
  assert.ok(res.output.includes('TIDE_BODY_MARKER'), 'use_skill returned the full skill body');

  const skills = fresh('skills');
  await waitFor(async () => (await skills.skillVersion(WS_SKILL, 'sea-tide')) >= 1 &&
    readFileSync(join(ud, 'skills', 'sea-tide', 'SKILL.md'), 'utf8').includes('uses: 1'), 25000, 'usage counter on disk');
  // the run leaves a REAL trace: tool_call record for use_skill + ok footer
  const tracesRoot = join(ud, 'traces');
  assert.ok(existsSync(tracesRoot), 'TraceRecorder wrote trace files');
  const day = existsSync(tracesRoot) ? require('node:fs').readdirSync(tracesRoot).find((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : null;
  const traceFile = day && require('node:fs').readdirSync(join(tracesRoot, day)).find((f) => f.startsWith('trace-') && f.endsWith('.jsonl'));
  assert.ok(traceFile, 'trace file exists');
  const traceText = readFileSync(join(tracesRoot, day, traceFile), 'utf8');
  assert.ok(traceText.includes('"use_skill"'), 'trace records the use_skill call');

  // Evidence gate: the REAL trace scan must promote the candidate.
  const gate = fresh('skillGate');
  const scan = gate.promoteSkillsFromTraces(ud, 7);
  assert.ok(scan.scanned >= 1, `trace scan consumed real traces (${scan.scanned})`);
  assert.ok(scan.skillUses.has('sea-tide'), 'scan matched the use_skill slug');
  const status = await waitFor(() => {
    const g = fresh('skillGate');
    return g.skillGateStatus(ud, 'sea-tide', false) === 'verified' ? 'verified' : null;
  }, 8000, 'skill gate promotion');
  assert.equal(status, 'verified', 'candidate → verified after evidence');

  const index = await fresh('skills').skillsIndexLine(WS_SKILL);
  assert.ok(index.includes('evidence-verified'), 'index badge flips to evidence-verified');
});

// ============================================================
// 2. MCP — real stdio + real local HTTP servers, registry, agent-tool path
// ============================================================
const stdioServerPath = join(tmp, 'mcp-stdio-server.mjs');
const stdioReceipt = join(tmp, 'stdio-receipt.jsonl');
writeFileSync(stdioServerPath, `import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const RECEIPT = process.env.A7_RECEIPT;
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined || msg.id === null) return; // notifications/initialized
  if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'demo-stdio', version: '1.0.0' } } });
  else if (msg.method === 'tools/list') send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'echo', description: 'Echo back the text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] } });
  else if (msg.method === 'tools/call') { appendFileSync(RECEIPT, JSON.stringify({ tool: msg.params.name, args: msg.params.arguments }) + '\\n'); send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'echo:' + (msg.params.arguments?.text ?? '') }] } }); }
  else send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'no such method' } });
});`);

// real local streamable-HTTP MCP server (remote/url transport)
const httpReceipt = join(tmp, 'http-receipt.jsonl');
let httpServer;
const httpPort = await new Promise((resolve) => {
  const s = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let msg; try { msg = JSON.parse(raw); } catch { msg = {}; }
      if (msg.id === undefined || msg.id === null) { res.writeHead(202); res.end(); return; }
      const reply = (result) => { res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'a7-sess' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })); };
      if (msg.method === 'initialize') reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'demo-remote', version: '1.0.0' } });
      else if (msg.method === 'tools/list') reply({ tools: [{ name: 'ping_tool', description: 'Ping the remote server', inputSchema: { type: 'object', properties: { tag: { type: 'string' } } } }] });
      else if (msg.method === 'tools/call') { require('node:fs').appendFileSync(httpReceipt, JSON.stringify({ tool: msg.params.name, args: msg.params.arguments }) + '\n'); reply({ content: [{ type: 'text', text: 'pong:http:' + (msg.params.arguments?.tag ?? '') }] }); }
      else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'no such method' } })); }
    });
  });
  httpServer = s;
  s.listen(0, '127.0.0.1', () => resolve(s.address().port));
});

const STDIO_CFG = { id: 'demo-stdio', name: 'Demo Stdio', command: 'node', args: [stdioServerPath], env: { A7_RECEIPT: stdioReceipt }, enabled: true };
const HTTP_CFG = { id: 'demo-remote', name: 'Demo Remote', transport: 'http', url: `http://127.0.0.1:${httpPort}/mcp`, enabled: true };

test('A7 mcp: registry discovery incl. remote/url (v3.1) + stdio tools/list', async () => {
  const registry = fresh('registry');
  assert.equal(registry.saveServer(STDIO_CFG).ok, true);
  assert.equal(registry.saveServer(HTTP_CFG).ok, true);
  const listing = await registry.listServers();
  const byId = Object.fromEntries(listing.servers.map((s) => [s.id, s]));
  console.error('[A7 debug] listing:', JSON.stringify(listing.servers.map((s) => ({ id: s.id, state: s.state, error: s.error, toolCount: s.toolCount })), null, 1));
  assert.equal(byId['demo-stdio']?.state, 'connected', 'stdio server probes connected');
  assert.ok(byId['demo-stdio']?.toolCount >= 1, 'stdio tools discovered');
  assert.equal(byId['demo-remote']?.state, 'connected', 'REMOTE (url) server probes connected — v3.1 fix');
  assert.ok(byId['demo-remote']?.toolCount >= 1, 'remote tools discovered');
  assert.ok(listing.totalTools >= 2, 'registry totals both servers');

  const mcp = fresh('mcp');
  const remote = await mcp.mcpListTools(HTTP_CFG);
  assert.ok(remote.ok && remote.tools.some((t) => t.name === 'ping_tool'), 'mcpListTools over HTTP transport');
  const local = await mcp.mcpListTools(STDIO_CFG);
  assert.ok(local.ok && local.tools.some((t) => t.name === 'echo'), 'mcpListTools over stdio transport');
});

test('A7 mcp: agent-tool path executes a REAL call the server receives', async () => {
  const mcp = fresh('mcp');
  const toolsFor = (await mcp.mcpListTools(STDIO_CFG)).tools ?? [];
  const ctx = {
    workspace: tmp, sessionId: 'a7-mcp', mcpServers: [{ server: STDIO_CFG, tools: toolsFor }],
    emit() {}, approve: async () => true,
  };
  const out = await tools.executeTool('mcp__demo_stdio__echo', JSON.stringify({ text: 'hello-from-agent' }), ctx);
  assert.ok(out.ok, `executeTool mcp bridge OK: ${out.output.slice(0, 120)}`);
  assert.ok(out.output.includes('echo:hello-from-agent'), 'result text round-tripped');
  const receipts = readFileSync(stdioReceipt, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(receipts.some((r) => r.tool === 'echo' && r.args?.text === 'hello-from-agent'), 'stdio server recorded the incoming call');

  const httpOut = await mcp.mcpCallTool(HTTP_CFG, 'ping_tool', { tag: 'a7' });
  assert.ok(httpOut.ok && httpOut.output.includes('pong:http:a7'), 'remote tools/call round-trips');
  const httpReceipts = readFileSync(httpReceipt, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(httpReceipts.some((r) => r.tool === 'ping_tool' && r.args?.tag === 'a7'), 'http server recorded the call');
  assert.ok(fresh('registry').serverCalls('demo-remote') >= 1, 'registry persisted the call counter');
  fresh('mcp').closeAllMcpClients();
});

test('A7 mcp: full engine run — model calls the discovered MCP tool', async () => {
  const mcp = fresh('mcp');
  const toolsFor = (await mcp.mcpListTools(STDIO_CFG)).tools ?? [];
  script('mock-mcp', { tool: { name: 'mcp__demo_stdio__echo', args: { text: 'ping-from-model' }, id: 'call_mcp' } });
  script('mock-mcp', { text: 'MCP_DONE_MARKER' });
  // v11.21: MCP discovery in the engine is DELIBERATELY fire-and-forget
  // (engine.ts:1442–1446) so a cold stdio client never holds the first token;
  // its documented contract is that a cold/busy client joins a LATER run.
  // Under parallel test load either the tool defs land late OR the first
  // stdio call fails while the client warms. Retry the whole exchange up to
  // up to 5 times (closing stale clients between attempts) — a genuine MCP
  // break fails all of them. Warming via `fresh('mcp')` above cannot help: the
  // engine holds its own module instance captured at require time. Under a
  // 1400-test parallel run cold stdio startup can miss several windows.
  let io = null;
  let start = null;
  let res = null;
  let used = 0;
  for (let attempt = 1; attempt <= 5; attempt++) {
    fresh('mcp').closeAllMcpClients();
    script('mock-mcp', { tool: { name: 'mcp__demo_stdio__echo', args: { text: 'ping-from-model' }, id: 'call_mcp' } });
    script('mock-mcp', { text: 'MCP_DONE_MARKER' });
    io = await runEngine({ workspace: tmp, model: 'mock-mcp', mcpServers: [STDIO_CFG] });
    used = attempt;
    start = io.events.find((e) => e.type === 'tool_start' && e.name === 'mcp__demo_stdio__echo');
    if (!start) { await sleep(400); continue; }
    res = toolResultsFor(io, start.toolCallId)[0];
    if (res?.ok && res.output.includes('echo:ping-from-model')) break;
    await sleep(400);
  }
  assert.ok(start, 'engine advertised + model called the MCP tool');
  assert.ok(res?.ok && res.output.includes('echo:ping-from-model'),
    `MCP tool result reached the engine (settled after ${used} attempt(s))`);
  const receipts = readFileSync(stdioReceipt, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(receipts.some((r) => r.args?.text === 'ping-from-model'), 'server physically received the engine-routed call');
  fresh('mcp').closeAllMcpClients();
});

// ============================================================
// 3. FLOWS — saved prompt → REAL 2-step agent run → persisted stats
// ============================================================
test('A7 flows: save → real engine run (two ordered steps) → markRun persists → replay validates', async () => {
  const flows = fresh('flows');
  const list = await flows.flowsSave({ name: 'Nightly report', prompt: 'Write step-1.txt then step-2.txt per the nightly ritual.' });
  const flow = list.find((f) => f.name === 'Nightly report');
  assert.ok(flow, 'flow saved + listed');

  const WS_FLOW = join(tmp, 'ws-flow');
  mkdirSync(WS_FLOW, { recursive: true });
  script('mock-flow', { tool: { name: 'write_file', args: { path: 'step-1.txt', content: 'step one body' }, id: 'call_f1' } });
  script('mock-flow', { tool: { name: 'write_file', args: { path: 'step-2.txt', content: 'step two body' }, id: 'call_f2' } });
  script('mock-flow', { text: 'FLOW_RUN_DONE' });
  const io = await runEngine({ workspace: WS_FLOW, model: 'mock-flow', taskText: flow.prompt });

  const starts = io.events.filter((e) => e.type === 'tool_start' && e.name === 'write_file');
  assert.equal(starts.length, 2, 'both flow steps executed');
  assert.equal(starts[0].args.path, 'step-1.txt', 'step 1 ran first');
  assert.equal(starts[1].args.path, 'step-2.txt', 'step 2 ran second');
  for (const s of starts) assert.ok(toolResultsFor(io, s.toolCallId)[0]?.ok, `${s.args.path} wrote OK`);
  assert.ok(existsSync(join(WS_FLOW, 'step-1.txt')) && existsSync(join(WS_FLOW, 'step-2.txt')), 'both artifacts exist');

  await flows.flowsMarkRun(flow.id);
  const after = fresh('flows').flowsList().find((f) => f.id === flow.id);
  assert.equal(after.runCount, 1, 'runCount persisted');
  assert.ok(after.lastRun > 0, 'lastRun persisted');
  const onDisk = JSON.parse(readFileSync(join(ud, 'flows.json'), 'utf8'));
  assert.ok(onDisk.flows.some((f) => f.id === flow.id && f.runCount === 1), 'flows.json on disk carries the run');

  // replay validator runs the stored text as a REAL command
  const rl = await flows.flowsSave({ name: 'Replay flow', prompt: `node -e "require('fs').writeFileSync('replay-marker.txt','ok')"` });
  const rf = rl.find((f) => f.name === 'Replay flow');
  const replay = await flows.flowsValidateByReplay(rf.id, tmp);
  assert.equal(replay.ok, true, `replay exit 0 (${replay.detail})`);
  assert.ok(existsSync(join(tmp, 'replay-marker.txt')), 'replay command really executed');

  // flowsHit correctly refuses to suggest a flow whose normalized text is
  // already saved (the 'Nightly report' flow above) — so probe a DIFFERENT
  // repeated prompt; at count >= SUGGEST_THRESHOLD (3) it must suggest once.
  let suggested = false;
  for (let i = 0; i < 3; i++) suggested = (await flows.flowsHit('generate the weekly standup summary from the journal')).suggest;
  assert.equal(suggested, true, 'repeated prompt suggests saving as a flow');
  const alreadySaved = (await flows.flowsHit('Write step-1.txt then step-2.txt per the nightly ritual.')).suggest;
  assert.equal(alreadySaved, false, 'already-saved flow text never re-suggests');
});

// ============================================================
// 4. DNA — learns via the REAL engine extraction loop + persists
// ============================================================
test('A7 dna: engine auto-extraction lands the mock fact in dna.json + prompt + events', async () => {
  script('mock-dna', { text: 'Understood — I will always write tests first.' });
  script('mock-dna', { text: '{"patterns_additions":[{"kind":"style","text":"User always writes tests first (TDD)"}],"profile_additions":{"dislikes":["emoji in code"]}}' });
  const WS_DNA = join(tmp, 'ws-dna');
  mkdirSync(WS_DNA, { recursive: true });
  const io = await runEngine({ workspace: WS_DNA, model: 'mock-dna' });

  await waitFor(() => existsSync(join(ud, 'dna.json')) && readFileSync(join(ud, 'dna.json'), 'utf8').includes('tests first (TDD)'), 10000, 'extraction in dna.json');
  const dna = fresh('dna');
  const reloaded = dna.loadDNA(WS_DNA); // FRESH instance reading from disk
  assert.ok(reloaded.patterns.some((p) => p.text.includes('TDD')), 'pattern persisted + reloaded');
  assert.ok(reloaded.profile.dislikes.includes('emoji in code'), 'profile addition persisted');
  assert.ok(io.events.some((e) => e.type === 'dna_updated'), 'engine emitted dna_updated');

  const rendered = dna.renderDNAPrompt(reloaded);
  assert.ok(rendered.includes('TDD'), 'renderDNAPrompt carries the learned fact');
  const built = prompts.buildSystemPrompt({ workspace: WS_DNA, mode: 'fullAccess', platform: process.platform, dna: rendered });
  assert.ok(built.includes('# User DNA') && built.includes('TDD'), 'built system prompt injects the DNA section');

  // DNA API: correction + preference persist across a fresh instance
  assert.equal(await dna.recordAgentNote('correction', 'Never use tabs — spaces only (user correction)'), true);
  assert.equal(await dna.recordFeedback('preference', 'User prefers concise answers'), true);
  const again = fresh('dna').loadDNA(WS_DNA);
  assert.ok(again.patterns.some((p) => p.text.includes('Never use tabs')), 'correction pattern persisted');
  assert.ok(again.feedback.some((f) => f.note === 'User prefers concise answers'), 'preference feedback persisted');
  const ev = capture().filter((c) => c.channel === 'kdx:dna:event');
  assert.ok(ev.some((c) => c.payload?.type === 'updated'), 'kdx:dna:event(updated) reached the UI bridge');
});

// ============================================================
// 6. SCHEDULED TASKS — real tick fires the agent, marks done, re-arms
// ============================================================
test('A7 schedule: runNow fires a real headless run + persists ok status', async () => {
  const WS_SCHED = join(tmp, 'ws-sched');
  mkdirSync(WS_SCHED, { recursive: true });
  script('mock-sched', { text: 'SCHEDULE_RUN_DONE nightly sweep finished' });
  const sched = fresh('schedule');
  sched.initScheduleService({ userDataDir: ud, broadcast: () => {} });
  const job = sched.addJob({ name: 'Nightly sweep', prompt: 'Run the nightly sweep.', workspace: WS_SCHED, cron: '0 3 * * *', model: { provider: 'custom', model: 'mock-sched' } });
  assert.equal(sched.runNow(job.id).ok, true, 'runNow accepted');
  const fired = await waitFor(() => sched.listJobs().find((j) => j.id === job.id)?.lastStatus === 'ok' ? 'ok' : null, 60000, 'job ok');
  assert.equal(fired, 'ok', 'headless agent run completed');
  assert.ok(sched.listJobs().find((j) => j.id === job.id).lastMessage.includes('SCHEDULE_RUN_DONE'), 'agent output captured in the job');
  const onDisk = JSON.parse(readFileSync(join(ud, 'schedules.json'), 'utf8'));
  assert.ok(onDisk.some((j) => j.id === job.id && j.lastStatus === 'ok'), 'schedules.json persisted the result');
});

test('A7 schedule: cron tick logic fires due jobs + runNow completes + re-arm (no double fire)', async () => {
  // NOTE: the product requires standard 5-field crons (sanitizeJob drops
  // anything else) — seed '* * * * *' (every minute), not bare '*'.
  const WS_SCHED = join(tmp, 'ws-sched');
  // job-tick: proves the REAL tick logic (shouldFire → fireJob) sees a job
  // whose cron window opened in the past as DUE and fires it.
  // job-run: proves the fired headless run completes end-to-end with output
  // (the same fireJob → runHeadlessAgent path the interval uses — driven via
  // the exported runNow because under heavy test-process load the unref'd
  // 30s wall-clock interval is not a reliable clock for assertions; the live
  // interval was additionally proven in a standalone 40s probe).
  const seeded = [
    { id: 'a7-cron-tick', name: 'Cron tick', prompt: 'Tick ping.', workspace: WS_SCHED, cron: '* * * * *', enabled: true, mode: 'autoEdit', model: { provider: 'custom', model: 'mock-cron-tick' }, createdAt: Date.now() - 15 * 60000, lastRun: Date.now() - 10 * 60000 },
    { id: 'a7-cron-run', name: 'Cron run', prompt: 'Run ping.', workspace: WS_SCHED, cron: '0 3 * * *', enabled: true, mode: 'autoEdit', model: { provider: 'custom', model: 'mock-cron-run' }, createdAt: Date.now() - 15 * 60000, lastRun: 0 },
  ];
  writeFileSync(join(ud, 'schedules.json'), JSON.stringify(seeded));
  // Script FULL conversations — the engine's false-done detector honestly
  // nudges bare markers, and the DNA extractor gets its own '[]' turns.
  script('mock-cron-tick', { text: 'Tick ping received and processed.' });
  script('mock-cron-tick', { text: '[]' });
  script('mock-cron-run', { text: 'CRON_FIRED_MARKER: the scheduled task ran end to end and the workspace is clean.' });
  script('mock-cron-run', { text: '[]' });
  const sched = fresh('schedule');
  sched.shutdownScheduleService(); // drop the earlier instance's ticker
  sched.initScheduleService({ userDataDir: ud, broadcast: () => {} });

  // 1) the REAL tick function sees the overdue job and fires it
  const dueCount = sched.runSchedulerTick();
  assert.ok(dueCount >= 1, `tick sees the overdue job as due (due=${dueCount})`);

  // 2) the same fireJob path completes end-to-end with real agent output
  sched.runNow('a7-cron-run');
  const fired = await waitFor(() => {
    const j = sched.listJobs().find((x) => x.id === 'a7-cron-run');
    return j?.lastStatus === 'ok' ? j : null;
  }, 120000, `headless run completed (state: ${JSON.stringify(sched.listJobs().find((x) => x.id === 'a7-cron-run'))})`).catch((err) => {
    console.error('[A7 cron debug] jobs:', JSON.stringify(sched.listJobs(), null, 1));
    console.error('[A7 cron debug] provider requests:', JSON.stringify(requests.map((r) => ({ model: r.model, at: r.at, systemLen: r.system?.length ?? 0 }))));
    throw err;
  });
  assert.ok(fired.lastMessage.includes('CRON_FIRED_MARKER'), 'cron-fired run produced agent output');

  // 3) re-arm — deterministic: inside the 60s window the REAL tick must see
  // the just-fired job as NOT due and never double-fire it.
  const lastRun = fired.lastRun;
  const dueAgain = sched.runSchedulerTick();
  await sleep(1500); // any double-fire would start a headless run immediately
  const after = sched.listJobs().find((x) => x.id === 'a7-cron-run');
  const tickJob = sched.listJobs().find((x) => x.id === 'a7-cron-tick');
  assert.equal(dueAgain, 0, 're-arm: tick sees no due job inside the 60s window');
  assert.equal(after.lastRun, lastRun, 'no double-fire inside the re-arm window (cron slot must pass)');
  assert.ok(lastRun + 60000 > Date.now(), 'next eligible slot is ≥60s away — recurring re-armed');
  assert.ok(tickJob.lastRun > 0, 'tick-fired job stamped its lastRun');
  sched.shutdownScheduleService();
});

// ============================================================
// 7. FEEDBACK — user reports persist as 0600 local files
// ============================================================
test('A7 feedback: save → file on disk → list → markdown export', () => {
  const fb = fresh('feedback');
  const saved = fb.saveFeedback({ kind: 'bug', message: 'Leaderboard flashes on open.', contact: 'founder@sadeem.app', diagnostics: { appVersion: '11.9.0', platform: 'linux', language: 'en', workspacesOpened: 2, sessions: 5 } });
  assert.equal(saved.ok, true, 'feedback saved');
  const file = join(ud, 'feedback', `${saved.entry.id}.json`);
  assert.ok(existsSync(file), 'entry persisted under userData/feedback');
  const list = fresh('feedback').listFeedback();
  assert.ok(list.some((e) => e.id === saved.entry.id && e.kind === 'bug'), 'listFeedback returns it (fresh instance)');
  const md = fb.feedbackToMarkdown(saved.entry);
  assert.ok(md.includes('Bug report') && md.includes('Leaderboard'), 'markdown export renders');
});

// ---------- cleanup: real servers/clients were opened — close them so the file exits ----------
after(async () => {
  try { fresh('mcp').closeAllMcpClients(); } catch { /* already closed */ }
  // v11.10 — the ENGINE bundles its own copy of mcp.ts (separate module
  // instance): its pooled stdio clients hold child processes open and keep
  // the test file alive until the runner timeout. Close them too.
  try { engine.closeAllMcpClients?.(); } catch { /* none open */ }
  try { engine.stopMcpHealthMonitor?.(); } catch { /* optional */ }
  try { fresh('mcp').stopMcpHealthMonitor?.(); } catch { /* optional */ }
  try { fresh('schedule').shutdownScheduleService(); } catch { /* optional */ }
  try { fresh('schedule').stopWebhookListener(); } catch { /* optional */ }
  try { mock.closeAllConnections?.(); } catch { /* node <18.2 */ }
  try { httpServer?.closeAllConnections?.(); } catch { /* node <18.2 */ }
  await new Promise((r) => mock.close(r));
  if (httpServer) await new Promise((r) => httpServer.close(r));
});
