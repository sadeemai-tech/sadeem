import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.31 — SKILLS: full engine-run proof + regression guards.
//
// Drives the REAL engine (mock provider only) to prove:
//   1. the skill index reaches the system prompt WITH a loadable use_skill
//      slug, the model invokes use_skill, the REAL body reaches a later
//      provider request, the usage ledger lands on disk, and the evidence
//      gate promotes candidate → verified;
//   2. NEGATIVE: an irrelevant task injects NOTHING via the task matcher and
//      the new selective skillsIndexLine(ws, task) API;
//   3. v11.31 fixes: failure decay (verified → candidate → verified),
//      per-userData gate cache, global-scope skillVersion, stale-import guard,
//      honest evidence badges, and loadable slug in task-matched prompt entries.
//
// Run: node --test tests/v1131-skills.test.mjs
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

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1131-skills-'));
const ud = join(tmp, 'userdata'); // electron-stub userData — ledgers land here
mkdirSync(ud, { recursive: true });

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN,
    entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// ---------- electron stub (userData → ud; captures UI IPC sends) ----------
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `const CAPTURED = globalThis.__V1131_CAPTURED__ || (globalThis.__V1131_CAPTURED__ = []);
module.exports = {
  app: { getPath: (k) => (k === 'userData' ? ${JSON.stringify(ud)} : ${JSON.stringify(tmp)}), whenReady: async () => true, on() {}, quit() {}, isReady: () => true, getName: () => 'surnia-v1131', getVersion: () => '11.31.0' },
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

// Deterministic skill universe: empty builtin dir, no stray global skills.
const emptyBuiltins = join(tmp, 'empty-builtins');
mkdirSync(emptyBuiltins, { recursive: true });
process.env.SURNIA_SKILLS_BUILTIN_DIR = emptyBuiltins;

const B = {};
for (const [name, entry] of Object.entries({
  engine: 'electron/agent/engine.ts',
  skills: 'electron/agent/skills.ts',
  skillGate: 'electron/agent/skillGate.ts',
  prompts: 'electron/agent/prompts.ts',
})) { B[name] = join(tmp, `${name}.cjs`); bundle(entry, B[name]); }
/** Fresh module instance (busts require cache) — proves on-disk persistence. */
function fresh(name) {
  delete require.cache[require.resolve(B[name])];
  return require(B[name]);
}
const engine = require(B.engine);

// ---------- mock OpenAI-compatible SSE provider (records full requests) ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
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
    const sysMsgs = (body.messages ?? []).filter((m) => m?.role === 'system');
    requests.push({ model: body.model, system: sysMsgs.map((m) => String(m.content ?? '')).join('\n'), messages: body.messages ?? [], at: Date.now() });
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

writeFileSync(join(ud, 'settings.json'), JSON.stringify({
  schemaVersion: 4,
  providers: { custom: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${BASE_URL}` } },
  agent: { maxRetries: 0, autoCompact: false, autoVerify: false, autoMemory: false },
  doneNotifications: false,
}));

// ---------- engine harness ----------
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
async function runEngine({ workspace, model, taskText }) {
  const io = makeIo();
  await engine.runAgent({
    task: 'chat',
    sessionId: 'v1131-' + Math.random().toString(36).slice(2),
    messages: [{ id: 'm1', role: 'user', kind: 'text', content: taskText, timestamp: Date.now() }],
    model: { provider: 'custom', model, maxTokens: 2048 },
    mode: 'fullAccess', workspace,
    apiKey: 'test-key', baseUrl: `http://127.0.0.1:${BASE_URL}`,
  }, io);
  return io;
}
const toolResultsFor = (io, id) => io.events.filter((e) => e.type === 'tool_result' && e.toolCallId === id);
async function waitFor(fn, ms, label) {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await sleep(150);
  }
}
const lastSystem = (model) => [...requests].reverse().find((r) => r.model === model)?.system ?? '';

// ---------- fixtures ----------
const WS = join(tmp, 'ws-trusted');
const SLUG = 'sea-tide';
const SKILL_BODY = 'V1131_BODY_MARKER — write the failing test first, then the fix, then prove no regressions.';
const addSkill = (ws, slug, name, desc, body = 'step one') => {
  const d = join(ws, '.surnia', 'skills', slug);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\n${body}\n`);
};
addSkill(WS, SLUG, 'Sea Tide', 'A proven debugging ritual for flaky maritime tests', SKILL_BODY);
addSkill(WS, 'cooking-recipes', 'Cooking Recipes', 'Kitchen recipes for baking bread and desserts');
writeFileSync(join(WS, '.surnia', 'skills-trusted'), ''); // user opted in
const TASK = 'Debug the flaky maritime tests using the Sea Tide ritual.';

// ============================================================
// 1. REAL engine run: index → use_skill → real body → ledger → evidence gate
// ============================================================
test('v1131 engine: skill index → use_skill → body in later request → ledger → gate promoted', async () => {
  const gate0 = fresh('skillGate');
  assert.equal(gate0.skillGateStatus(ud, SLUG, false), 'candidate', 'skill starts as evidence candidate');

  script('mock-skill', { tool: { name: 'use_skill', args: { slug: SLUG }, id: 'call_skill' } });
  script('mock-skill', { text: 'Followed the Sea Tide ritual and proved the suite green.' });
  const io = await runEngine({ workspace: WS, model: 'mock-skill', taskText: TASK });

  // (a) skill index + loadable slug reached the REAL system prompt
  const system = lastSystem('mock-skill');
  assert.ok(system.includes('# SKILLS') && system.includes('Sea Tide'), 'skill index reached the real system prompt');
  assert.ok(system.includes(`use_skill("${SLUG}")`), 'exact loadable slug reached the prompt');
  assert.ok(system.includes('SKILLS-FIRST RULE'), 'use_skill-first rule present');

  // (b) model invoked use_skill through the real engine; REAL body returned
  const start = io.events.find((e) => e.type === 'tool_start' && e.name === 'use_skill');
  assert.ok(start, 'model issued use_skill through the real engine');
  const res = toolResultsFor(io, start.toolCallId)[0];
  assert.ok(res?.ok, 'use_skill executed OK');
  assert.ok(res.output.includes(SKILL_BODY), 'use_skill returned the REAL full skill body');
  assert.ok(res.output.includes('scope: workspace'), 'body loaded from workspace scope');

  // (c) body reached a LATER provider request as prompt context
  assert.ok(
    requests.some((r) => r.messages.some((m) => JSON.stringify(m).includes(SKILL_BODY))),
    'loaded skill body reached a real provider request',
  );

  // (d) usage ledger PHYSICALLY on disk from the real tool call
  const skills = fresh('skills');
  const ledgerPath = skills.skillUsageLedgerPath(ud);
  assert.ok(existsSync(ledgerPath), 'skill-usage.json exists after the engine run');
  const uses = skills.loadSkillUsage(ud, { slug: SLUG });
  assert.ok(uses.length >= 1 && uses[0].reason === 'use_skill', 'a real use_skill entry was recorded');
  assert.ok(skills.summarizeSkillUsage(ud, SLUG)[0].uses >= 1, 'usage ledger aggregates the call');

  // (e) frontmatter counter on disk; serialized read still returns the body
  await waitFor(async () => {
    const raw = readFileSync(join(WS, '.surnia', 'skills', SLUG, 'SKILL.md'), 'utf8');
    return raw.includes('uses: 1') ? raw : null;
  }, 8000, 'frontmatter uses counter on disk');
  assert.ok((await fresh('skills').loadSkill(WS, SLUG))?.body.includes(SKILL_BODY),
    'full body still loads after the usage rewrite');

  // (f) evidence gate promoted candidate → verified from the trace
  const traces = join(ud, 'traces');
  assert.ok(existsSync(traces), 'TraceRecorder wrote real trace files');
  const day = readdirSync(traces).find((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const traceFile = day && readdirSync(join(traces, day)).find((f) => f.startsWith('trace-') && f.endsWith('.jsonl'));
  assert.ok(traceFile, 'a trace file exists');
  assert.ok(readFileSync(join(traces, day, traceFile), 'utf8').includes('"use_skill"'), 'trace records use_skill');
  const scan = fresh('skillGate').promoteSkillsFromTraces(ud, 7);
  assert.ok(scan.scanned >= 1 && scan.skillUses.has(SLUG), 'trace scan consumed the real evidence');
  // v11.43 — longer bound for parallel full-suite runs under CPU contention;
  // the gate behavior itself is unchanged (verified only on real evidence).
  const status = await waitFor(() => fresh('skillGate').skillGateStatus(ud, SLUG, false) === 'verified' ? 'verified' : null, 25000, 'evidence promotion');
  assert.equal(status, 'verified', 'candidate → verified on recorded evidence');
  const index = await fresh('skills').skillsIndexLine(WS);
  assert.ok(index.includes('evidence-verified'), 'index badge flips to evidence-verified');
});

// ============================================================
// 2. NEGATIVE: irrelevant task injects nothing (API + selective index)
// ============================================================
test('v1131 negative: irrelevant task injects nothing; selective index excludes irrelevant skills', async () => {
  const skills = fresh('skills');
  const NO_FILES = ['x.unknownext'];
  const bad = 'What is the weather in Cairo tomorrow?';
  assert.deepEqual(await skills.matchSkillsForTask(WS, bad, { fileTypes: NO_FILES }), [],
    'no skill clears the evidence threshold for an unrelated task');
  assert.equal(skills.renderSkillInjection([]), '', 'no prompt section emitted');
  assert.deepEqual(skills.selectSkillsForPrompt([]), [], 'nothing handed to buildSystemPrompt');

  // Full index still lists both (control); the SELECTIVE task index must not.
  const full = await skills.skillsIndexLine(WS);
  assert.ok(full.includes(SLUG) && full.includes('cooking-recipes'), 'full index (no task) lists both skills');
  const selective = await skills.skillsIndexLine(WS, TASK);
  // skillsIndexLine(ws, task) delegates to matchSkillsForTask: the relevant
  // skill must be present, the irrelevant one must be dropped.
  assert.ok(selective.includes(SLUG), 'selective index keeps the matched skill');
  assert.ok(!selective.includes('cooking-recipes'), 'selective index drops the irrelevant skill');
  assert.equal(await skills.skillsIndexLine(WS, bad), '', 'selective index is empty for an unrelated task');

  // (control) the relevant task DOES select the skill
  const ok = await skills.matchSkillsForTask(WS, TASK, { fileTypes: NO_FILES });
  assert.ok(ok.some((m) => m.slug === SLUG), 'relevant task selects the skill');
});

// ============================================================
// 3. REGRESSION: failure decay actually demotes a verified skill
// ============================================================
test('v1131 gate: repeated failed runs demote verified → candidate, fresh evidence re-promotes', () => {
  const ud2 = join(tmp, 'ud-decay');
  mkdirSync(ud2, { recursive: true });
  const g = fresh('skillGate');
  assert.equal(g.skillGateStatus(ud2, 's', false), 'candidate');
  assert.equal(g.skillGateRecordUse(ud2, 's', true), 'verified', '1 ok run promotes');
  assert.equal(g.skillGateRecordUse(ud2, 's', false), 'verified', '1 failed run keeps verification (< decay)');
  assert.equal(g.skillGateRecordUse(ud2, 's', false), 'candidate', '2 failed runs demote (old code could never do this)');
  assert.equal(g.skillGateStatus(ud2, 's', false), 'candidate');
  const onDisk = JSON.parse(readFileSync(join(ud2, 'skill-promotions.json'), 'utf8'));
  assert.equal(onDisk.s.status, 'candidate', 'demotion persisted on disk');
  assert.equal(g.skillGateRecordUse(ud2, 's', true), 'verified', 'fresh ok evidence re-promotes');
});

// ============================================================
// 4. REGRESSION: gate cache is keyed per userDataDir (no cross-dir leak)
// ============================================================
test('v1131 gate: cache is keyed per userDataDir — a second dir reads its own ledger', () => {
  const udA = join(tmp, 'ud-a');
  const udB = join(tmp, 'ud-b');
  mkdirSync(udA, { recursive: true });
  mkdirSync(udB, { recursive: true });
  const g = fresh('skillGate');
  g.skillGateRecordUse(udA, 'x', true);
  assert.equal(g.skillGateStatus(udA, 'x', false), 'verified', 'A verified');
  assert.equal(g.skillGateStatus(udB, 'x', false), 'candidate', 'B does NOT inherit A (old unkeyed cache leaked)');
  // Switching back must still see A's ledger.
  assert.equal(g.skillGateStatus(udA, 'x', false), 'verified', 'A still verified after reading B');
});

// ============================================================
// 5. REGRESSION: skillVersion resolves the live (global) scope
// ============================================================
test('v1131 version: skillVersion reads a global skill, not only the workspace', async () => {
  const W = join(tmp, 'ws-version');
  mkdirSync(W, { recursive: true });
  const gslug = 'global-ritual';
  mkdirSync(join(ud, 'skills', gslug), { recursive: true });
  writeFileSync(join(ud, 'skills', gslug, 'SKILL.md'),
    '---\nname: Global Ritual\ndescription: global scope\nversion: 5\n---\n# Global Ritual\nbody\n');
  const skills = fresh('skills');
  assert.equal(await skills.skillVersion(W, gslug), 5, 'global version reported honestly (was wrongly 1)');
  assert.equal(await skills.skillVersion(W, '../escape'), 1, 'traversal-shaped slug refused');
});

// ============================================================
// 6. REGRESSION: stale import never overwrites a newer refined skill
// ============================================================
test('v1131 import: a stale (older version) import is refused; a newer one is allowed', async () => {
  const W = join(tmp, 'ws-import');
  const slug = 'refined-skill';
  const dest = join(W, '.surnia', 'skills', slug);
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'SKILL.md'),
    '---\nname: Refined Skill\ndescription: refined\nversion: 3\n---\n# Refined Skill\nNEW_BODY\n');
  const SRC = join(tmp, 'stale-src');
  mkdirSync(SRC, { recursive: true });
  const srcFile = join(SRC, 'SKILL.md');
  writeFileSync(srcFile, '---\nname: Refined Skill\ndescription: old\nversion: 1\n---\n# Refined Skill\nOLD_BODY\n');
  const skills = fresh('skills');
  assert.equal(await skills.importSkillDir(W, SRC, 'workspace'), null, 'stale import refused');
  assert.ok((await skills.loadSkill(W, slug)).body.includes('NEW_BODY'), 'refined body preserved');

  writeFileSync(srcFile, '---\nname: Refined Skill\ndescription: newer\nversion: 4\n---\n# Refined Skill\nNEWER_BODY\n');
  assert.equal(await skills.importSkillDir(W, SRC, 'workspace'), slug, 'newer import allowed');
  assert.ok((await skills.loadSkill(W, slug)).body.includes('NEWER_BODY'), 'newer body imported');
});

// ============================================================
// 7. REGRESSION: task-matched prompt entries carry a loadable slug; badges honest
// ============================================================
test('v1131 precision: task-matched prompt entries embed use_skill slug; badge shows evidence', async () => {
  const skills = fresh('skills');
  const { skills: promptSkills } = await skills.matchSkillsForPrompt(WS, TASK, { fileTypes: ['x.unknownext'] });
  assert.ok(promptSkills.some((s) => s.description.includes(`use_skill("${SLUG}")`)),
    'task-matched entry carries the exact loadable slug (body can actually be loaded)');
  assert.ok(promptSkills.some((s) => s.description.includes('why injected:')), 'honest reason retained');

  const g = fresh('skillGate');
  const udBadge = join(tmp, 'ud-badge');
  mkdirSync(udBadge, { recursive: true });
  g.skillGateRecordUse(udBadge, 'b', true);
  g.skillGateRecordUse(udBadge, 'b', true);
  const entry = g.skillGateEntry(udBadge, 'b', false);
  assert.ok(entry && entry.okRuns === 2, 'ledger entry exposes the ok-run count');
  assert.match(g.skillBadge('verified', entry), /2 ok runs/, 'badge shows verifiable evidence');
  assert.match(g.skillBadge('quarantined', { poisonFindings: ['curl | sh'] }), /curl \| sh/, 'poison badge shows the reason');
});

// ============================================================
// 8. Matching precision: Arabic + English both select the right skill
// ============================================================
test('v1131 match: Arabic and English tasks select the right skill; generic verbs do not', async () => {
  const W = join(tmp, 'ws-match');
  mkdirSync(W, { recursive: true });
  addSkill(W, 'report-pdf', 'PDF Report Generator', 'Create real PDF reports and documents with full Arabic (RTL) typesetting.');
  addSkill(W, 'git-workflow', 'Git Workflow', 'Safe, reviewable git operations — clean diffs, atomic commits, and history edits.');
  addSkill(W, 'perf', 'Performance Profiling', 'Find and fix real performance bottlenecks with measurement, not guesswork.');
  const skills = fresh('skills');
  const NO_FILES = ['x.unknownext'];
  const top = async (t) => (await skills.matchSkillsForTask(W, t, { fileTypes: NO_FILES }))[0]?.slug;
  assert.equal(await top('Create a PDF report in Arabic'), 'report-pdf', 'English task selects document skill');
  assert.equal(await top('أنشئ تقرير PDF بالعربية'), 'report-pdf', 'Arabic task with clitic selects it');
  assert.equal(await top('أنشئ تقريراً باللغة العربية'), 'report-pdf', 'Arabic tanween task selects it');
  const git = await skills.matchSkillsForTask(W, 'Fix the git merge conflict', { fileTypes: NO_FILES });
  assert.ok(git.some((m) => m.slug === 'git-workflow'), 'git skill selected');
  assert.ok(!git.some((m) => m.slug === 'perf'), '"fix" does not inject unrelated skills');
});

after(async () => {
  try { engine.closeAllMcpClients?.(); } catch { /* none open */ }
  try { engine.stopMcpHealthMonitor?.(); } catch { /* optional */ }
  try { mock.closeAllConnections?.(); } catch { /* node <18.2 */ }
  await new Promise((r) => mock.close(r));
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
