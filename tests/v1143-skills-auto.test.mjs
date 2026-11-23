// ============================================================
// SADEEM v1143 — SKILLS AUTO-USE (the founder's repeated complaint:
// «السكيلز اللي بضيفها بالسكيلز يجب أن استخدمها تلقائيا، فاهم علي؟
// إنه جوا الهاي يستخدمها كليات»).
//
// This suite drives the REAL engine with a SCRIPTED provider and proves the
// four contracts that were broken before v1143:
//   1. a user-added skill is ALWAYS advertised in the NEXT system prompt —
//      even in workspace scope with NO `.surnia/skills-trusted` marker and the
//      default `ask` trust posture (the old trust gate hid it completely);
//   2. the SKILLS-FIRST directive says "load the user's skill FIRST" and
//      "follow ALL its steps" (not vague relevance advice);
//   3. TRACED: when the model DOES call use_skill, a distinct trace/event pair
//      proves it, the REAL body comes back and reaches a LATER provider request;
//   4. HONESTY: when the model does NOT call use_skill, the harness soft-injects
//      the single most relevant user skill's body into the system prompt — and
//      does NOT emit a "skill:auto-used" claim. A `never` trust posture still
//      advertises the skill but suppresses workspace body auto-injection.
//
// Run: node --test --test-force-exit tests/v1143-skills-auto.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1143-skills-auto-'));
const ud = join(tmp, 'userdata');
mkdirSync(ud, { recursive: true });

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const PROMPTS_SRC = read('electron/agent/prompts.ts');
const ENGINE_SRC = read('electron/agent/engine.ts');
const PANEL_SRC = read('src/components/panels/SkillsPanel.tsx');

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN,
    entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// electron stub: userData → ud; capture UI IPC sends.
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `const CAP = globalThis.__V1143_CAPTURED__ || (globalThis.__V1143_CAPTURED__ = []);
module.exports = {
  app: { getPath: (k) => (k === 'userData' ? ${JSON.stringify(ud)} : ${JSON.stringify(tmp)}), whenReady: async () => true, on() {}, quit() {}, isReady: () => true, getName: () => 'v1143', getVersion: () => '11.43.0' },
  ipcMain: { handle() {}, on() {} },
  ipcRenderer: { invoke: async () => ({}), on() {}, send() {} },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (channel, payload) => CAP.push({ channel, payload }) } }] },
  Notification: { isSupported: () => false },
  shell: {}, dialog: {}, screen: {}, tray: {}, Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
  contextBridge: { exposeInMainWorld: () => {} }, webContents: { getAllWebContents: () => [] },
  nativeTheme: { shouldUseDarkColors: true }, globalShortcut: { register: () => true, unregisterAll: () => {} },
  clipboard: { readText: () => '', writeText: () => {} }, powerMonitor: { on() {} }, nativeImage: { createEmpty: () => ({}) },
  session: { defaultSession: { setProxy: async () => {}, clearCache: async () => {} } },
};
module.exports.default = module.exports;`);

// Deterministic skill universe: no built-ins / no stray global skills.
const emptyBuiltins = join(tmp, 'empty-builtins');
mkdirSync(emptyBuiltins, { recursive: true });
process.env.SURNIA_SKILLS_BUILTIN_DIR = emptyBuiltins;

const B = {};
for (const [name, entry] of Object.entries({
  engine: 'electron/agent/engine.ts',
  prompts: 'electron/agent/prompts.ts',
})) { B[name] = join(tmp, `${name}.cjs`); bundle(entry, B[name]); }
const engine = require(B.engine);
const prompts = require(B.prompts);

// ---------- scripted OpenAI-compatible SSE provider ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'v1143', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const toolDeltas = (name, args, id) => [
  { tool_calls: [{ index: 0, id, function: { name, arguments: '' } }] },
  { tool_calls: [{ index: 0, function: { arguments: args } }] },
];
const routes = new Map();
const requests = [];
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* {} */ }
    requests.push({ model: body.model, system: (body.messages ?? []).filter((m) => m?.role === 'system').map((m) => String(m.content ?? '')).join('\n'), messages: body.messages ?? [] });
    const q = routes.get(body.model) ?? [];
    const h = q.length ? q.shift() : null;
    if (!h) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `UNSCRIPTED request for model ${body.model}` } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.flushHeaders();
    try { await h({ res }); } catch { try { res.destroy(); } catch { /* gone */ } }
  });
});
const BASE_URL = await new Promise((resolve) => mock.listen(0, '127.0.0.1', () => resolve(mock.address().port)));
function script(model, { text = null, tool = null } = {}) {
  const q = routes.get(model) ?? [];
  q.push(async ({ res }) => {
    if (text !== null) res.write(sseChunk({ content: text }));
    if (tool) for (const d of toolDeltas(tool.name, typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args), tool.id ?? 'call_1')) res.write(sseChunk(d));
    res.write(sseChunk({}, tool ? 'tool_calls' : 'stop'));
    res.write('data: [DONE]\n\n');
    res.end();
  });
  routes.set(model, q);
}

// settings: trust defaults to 'ask'; NO .surnia/skills-trusted marker in WS.
function writeSettings(extra = {}) {
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({
    schemaVersion: 4,
    providers: { custom: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${BASE_URL}` } },
    agent: { maxRetries: 0, autoCompact: false, autoVerify: false, autoMemory: false },
    doneNotifications: false,
    ...extra,
  }));
}
writeSettings();

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
async function runEngine({ workspace, model, taskText, sessionId }) {
  const io = makeIo();
  await engine.runAgent({
    task: 'chat',
    sessionId: sessionId ?? ('v1143-' + Math.random().toString(36).slice(2)),
    messages: [{ id: 'm1', role: 'user', kind: 'text', content: taskText, timestamp: Date.now() }],
    model: { provider: 'custom', model, maxTokens: 2048 },
    mode: 'fullAccess', workspace,
    apiKey: 'test-key', baseUrl: `http://127.0.0.1:${BASE_URL}`,
  }, io);
  return io;
}
const lastSystem = (model) => [...requests].reverse().find((r) => r.model === model)?.system ?? '';
const bodyReachedProvider = (marker) => requests.some((r) => r.messages.some((m) => JSON.stringify(m).includes(marker)));
async function waitFor(fn, ms, label) {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await sleep(120);
  }
}
function traceHas(needle) {
  try {
    const root = join(ud, 'traces');
    if (!existsSync(root)) return false;
    for (const day of readdirSync(root)) {
      const d = join(root, day);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      for (const f of readdirSync(d)) {
        if (!f.startsWith('trace-') || !f.endsWith('.jsonl')) continue;
        if (readFileSync(join(d, f), 'utf8').includes(needle)) return true;
      }
    }
  } catch { /* best-effort */ }
  return false;
}

// ---------- fixtures: a USER-ADDED workspace skill, NO trust marker ----------
const WS = join(tmp, 'ws-user-added');
const SLUG = 'v1143-beacon-protocol';
const BODY = 'V1143_BEACON_BODY_MARKER — STEP 1 do the exact beacon ritual. STEP 2 verify it. STEP 3 report evidence. Follow ALL steps in order.';
const skillDir = join(WS, '.surnia', 'skills', SLUG);
mkdirSync(skillDir, { recursive: true });
writeFileSync(join(skillDir, 'SKILL.md'),
  `---\nname: V1143 Beacon Protocol\ndescription: A user-added protocol for the v1143 beacon build task\n---\n# V1143 Beacon Protocol\n${BODY}\n`);
// Intentionally DO NOT create <ws>/.surnia/skills-trusted — default trust is 'ask'.
const TASK = 'Follow the V1143 Beacon Protocol to build the thing.';

// ============================================================
test('v1143 source: directive loads USER skill FIRST + ALL steps; honesty label; panel info', () => {
  const sec = PROMPTS_SRC.slice(PROMPTS_SRC.indexOf('# SKILLS'), PROMPTS_SRC.indexOf('# SAVED PROMPTS'));
  assert.match(sec, /USER-ADDED SKILL/, 'directive names USER-ADDED skills');
  assert.match(sec, /load the user\\u2019s skill FIRST|load the user’s skill FIRST/, 'directive says load the user skill FIRST');
  assert.match(sec, /follow ALL its steps|EVERY step/, 'directive mandates ALL steps');
  assert.match(sec, /HARNESS-INJECTED USER SKILL/, 'soft injection is labelled as harness work');
  assert.match(sec, /NOT a model use_skill call/, 'soft injection never claims a model use_skill call');
  assert.match(ENGINE_SRC, /skillsIndexLine\(workspace\)/, 'index has NO task filter — every skill is advertised');
  assert.match(ENGINE_SRC, /buildAutoSkillInjection\(/, 'engine builds the honest soft injection');
  assert.match(ENGINE_SRC, /name: 'skill:auto-used'/, 'distinct use_skill execution trace exists');
  assert.match(PANEL_SRC, /AUTO-USE:/, 'panel tells the user skills auto-apply next run');
});

// ============================================================
test('v1143 real run: untrusted user skill is ADVERTISED + soft-injected, and tracing is honest when model does NOT call use_skill', async () => {
  writeSettings(); // default 'ask', no trust marker
  script('v1143-soft', { text: 'Done.' });
  const io = await runEngine({ workspace: WS, model: 'v1143-soft', taskText: TASK });

  // (a) ALWAYS advertised — the old trust gate would have left skillsIndex empty.
  const sys = lastSystem('v1143-soft');
  assert.ok(sys.includes('# SKILLS') && sys.includes('V1143 Beacon Protocol'), 'untrusted user skill is in the next system prompt');
  assert.ok(sys.includes(`use_skill("${SLUG}")`), 'exact loadable slug advertised');
  assert.ok(sys.includes('SKILLS-FIRST RULE') && sys.includes('load the user’s skill FIRST') && sys.includes('follow ALL its steps'), 'hardened directive reached the prompt');

  // (b) SOFT injection: body reached the provider even with NO use_skill call.
  assert.ok(sys.includes(BODY), 'user skill body was soft-injected into the system prompt');
  assert.ok(bodyReachedProvider(BODY), 'body reached a real provider request');
  assert.ok(sys.includes('HARNESS-INJECTED USER SKILL') && sys.includes('NOT a model use_skill call'), 'injection is honestly labelled');

  // (c) HONESTY: harness notice present, but NO model-use claim / no use_skill tool.
  assert.ok(io.events.some((e) => e.type === 'sys_notice' && e.kind === 'skill:auto-injected'), 'harness injection notice emitted');
  assert.ok(!io.events.some((e) => e.type === 'sys_notice' && e.kind === 'skill:auto-used'), 'NO false claim that the model used the skill');
  assert.ok(!io.events.some((e) => e.type === 'tool_start' && e.name === 'use_skill'), 'model did not call use_skill');
  assert.ok(!traceHas('skill:auto-used'), 'no use_skill execution trace for a model that did not call it');
});

// ============================================================
test('v1143 real run: when the model DOES call use_skill, body reaches the next provider request and the call is TRACED', async () => {
  writeSettings();
  script('v1143-used', { tool: { name: 'use_skill', args: { slug: SLUG }, id: 'call_v1143' } });
  script('v1143-used', { text: 'Followed the beacon protocol.' });
  const io = await runEngine({ workspace: WS, model: 'v1143-used', taskText: TASK });

  const start = io.events.find((e) => e.type === 'tool_start' && e.name === 'use_skill');
  assert.ok(start, 'model issued use_skill through the real engine');
  const res = io.events.find((e) => e.type === 'tool_result' && e.toolCallId === start.toolCallId);
  assert.ok(res?.ok && res.output.includes(BODY), 'use_skill returned the REAL full body');
  assert.ok(bodyReachedProvider(BODY), 'loaded body reached a real LATER provider request');
  assert.ok(io.events.some((e) => e.type === 'sys_notice' && e.kind === 'skill:auto-used'), 'honest model-use notice emitted');
  await waitFor(() => traceHas('skill:auto-used') || null, 8000, 'use_skill execution trace');
  assert.ok(traceHas('MODEL use_skill body delivered'), 'trace records the real body delivery, not just the call');
});

// ============================================================
test('v1143 trust=never: still advertised, but workspace body auto-injection suppressed (global skills unaffected)', async () => {
  writeSettings({ trustWorkspaceSkills: 'never' });
  script('v1143-never', { text: 'Done.' });
  const io = await runEngine({ workspace: WS, model: 'v1143-never', taskText: TASK });

  const sys = lastSystem('v1143-never');
  assert.ok(sys.includes('V1143 Beacon Protocol'), 'trust=never still ADVERTISES the user skill');
  assert.ok(!sys.includes(BODY), 'trust=never suppresses WORKSPACE body auto-injection');
  assert.ok(!io.events.some((e) => e.type === 'sys_notice' && e.kind === 'skill:auto-injected'), 'no injection notice for a suppressed body');
  writeSettings(); // restore for any later runs
});

// ============================================================
test('v1143 byte caps unchanged: no-skill base prompt stays byte-stable', () => {
  const en = prompts.buildSystemPrompt({ workspace: 'D:/v1143', mode: 'default', platform: 'win32', language: 'en' });
  const size = Buffer.byteLength(en, 'utf8');
  assert.ok(size < 24 * 1024, `EN base < 24 KB (got ${size})`);
  assert.ok(!en.includes('# SKILLS') && !en.includes('HARNESS-INJECTED'), 'no-skill prompt carries zero SKILLS bytes');
});

after(async () => {
  try { engine.closeAllMcpClients?.(); } catch { /* none */ }
  try { engine.stopMcpHealthMonitor?.(); } catch { /* optional */ }
  try { mock.closeAllConnections?.(); } catch { /* node <18.2 */ }
  await new Promise((r) => mock.close(r));
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
