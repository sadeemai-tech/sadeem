import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.27 — "DNA WORKS" END-TO-END PROOF
// ------------------------------------------------------------
// The founder reported: "ال dna لا يعمل" — DNA does not work.
// This suite does NOT trust comments or the older v1110 smoke test.
// It drives the REAL engine with a mock LLM provider and proves every link:
//
//   1. a REAL engine run's post-run extraction writes the learnable pattern
//      into <userData>/dna.json (honest path, real bytes on disk);
//   2. the run emits BOTH `dna_updated` (agent event) and `kdx:dna:event`
//      (renderer bridge) so the UI store ingests it;
//   3. a FRESH module reload reads the pattern back from disk;
//   4. a SECOND real run's built system prompt contains the learned pattern
//      under `# User DNA`;
//   5. `/dna` stats (dnaStats) reflect the learned pattern + session;
//   6. REGRESSION GUARD: at the MAX_PATTERNS cap a NEW pattern is KEPT and the
//      oldest MOST-REINFORCED one is evicted — never the reverse (the silent
//      drop that made DNA "stop learning" after ~60 patterns).
//
//   node --test --test-force-exit tests/v1127-dna-works.test.mjs
// ============================================================
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
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1127-dna-'));
const UD = join(tmp, 'userdata'); // electron-stub userData — dna.json lands here
const WS = join(tmp, 'ws');
for (const d of [UD, WS]) mkdirSync(d, { recursive: true });

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${out}`, '--external:electron', '--external:@xterm/xterm',
    '--external:@xterm/addon-fit', '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// ---------- electron stub: userData → UD; BrowserWindow captures kdx:dna:event ----------
const CAPTURED = [];
writeFileSync(join(tmp, 'electron-stub-init.cjs'), `void 0;`);
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `const CAP = globalThis.__V1127_CAPTURED__ || (globalThis.__V1127_CAPTURED__ = []);
module.exports = {
  app: { getPath: (k) => (k === 'userData' ? ${JSON.stringify(UD)} : ${JSON.stringify(tmp)}), whenReady: async () => true, on() {}, quit() {}, isReady: () => true, getName: () => 'surnia-v1127', getVersion: () => '0.0.0' },
  ipcMain: { handle() {}, on() {} },
  ipcRenderer: { invoke: async () => ({}), on() {}, send() {} },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (channel, payload) => CAP.push({ channel, payload }) } }] },
  Notification: { isSupported: () => false }, shell: {}, dialog: {}, screen: {}, tray: {},
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
  contextBridge: { exposeInMainWorld: () => {} }, webContents: { getAllWebContents: () => [] },
  nativeTheme: { shouldUseDarkColors: true }, globalShortcut: { register: () => true, unregisterAll: () => {} },
  clipboard: { readText: () => '', writeText: () => {} }, powerMonitor: { on() {} }, nativeImage: { createEmpty: () => ({}) },
};
module.exports.default = module.exports;`);
const capture = () => globalThis.__V1127_CAPTURED__ ?? CAPTURED;

// ---------- mock OpenAI-compatible SSE provider (routes by system message) ----------
const LEARNED = 'V1127_LEARNED: team always uses pnpm and writes the failing test first';
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const requests = [];
const mock = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* {} */ }
    const sysMsgs = (body.messages ?? []).filter((m) => m?.role === 'system');
    const system = sysMsgs.map((m) => String(m.content ?? '')).join('\n');
    requests.push({ model: body.model, system, at: Date.now() });
    let text = 'Understood — noted.';
    if (system.includes('Surnia DNA user model')) {
      // The DNA_EXTRACT_SYSTEM prompt: return a durable, learnable pattern.
      text = JSON.stringify({
        profile_additions: { likes: ['pnpm over npm'] },
        patterns_additions: [{ kind: 'workflow', text: LEARNED }],
      });
    } else if (system.includes('Living Playbook')) {
      text = '{}'; // playbook extraction: nothing new
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.flushHeaders();
    res.write(sseChunk({ content: text }));
    res.write(sseChunk({}, 'stop'));
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
const BASE_URL = await new Promise((resolve) => mock.listen(0, '127.0.0.1', () => resolve(mock.address().port)));

writeFileSync(join(UD, 'settings.json'), JSON.stringify({
  schemaVersion: 4,
  providers: { custom: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${BASE_URL}` } },
  agent: { maxRetries: 0, autoCompact: false, autoVerify: false, autoMemory: false },
  doneNotifications: false,
}));

// ---------- bundles (fresh instances prove on-disk persistence) ----------
const B = {};
for (const [name, entry] of Object.entries({
  engine: 'electron/agent/engine.ts',
  dna: 'electron/agent/dna.ts',
  prompts: 'electron/agent/prompts.ts',
})) {
  B[name] = join(tmp, `${name}.cjs`);
  bundle(entry, B[name]);
}
function fresh(name) {
  delete require.cache[require.resolve(B[name])];
  return require(B[name]);
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
async function runEngine(taskText) {
  const io = makeIo();
  await fresh('engine').runAgent({
    task: 'chat',
    sessionId: 'sess-' + Math.random().toString(36).slice(2),
    messages: [{ id: 'm1', role: 'user', kind: 'text', content: taskText, timestamp: Date.now() }],
    model: { provider: 'custom', model: 'mock-v1127', maxTokens: 2048 },
    mode: 'fullAccess',
    workspace: WS,
    apiKey: 'test-key',
    baseUrl: `http://127.0.0.1:${BASE_URL}`,
  }, io);
  return io;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, label) {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await sleep(200);
  }
}

after(() => { try { mock.close(); } catch { /* gone */ } });

// ============================================================
test('v1127 DNA: real engine run writes the learned pattern into dna.json + emits both events', async () => {
  const io = await runEngine('Please set up the project the way we always do.');

  const dnaFile = join(UD, 'dna.json');
  await waitFor(() => existsSync(dnaFile) && readFileSync(dnaFile, 'utf8').includes('V1127_LEARNED'), 12000, 'pattern in dna.json');
  // Extraction is fire-and-forget: wait for the write before asserting the event.
  assert.ok(io.events.some((e) => e.type === 'dna_updated'), 'engine emitted dna_updated');

  // Fresh module instance — proves the bytes came from disk, not memory.
  const reloaded = fresh('dna').loadDNA(WS);
  assert.ok(reloaded.patterns.some((p) => p.text.includes('V1127_LEARNED')), 'pattern persisted + reloaded from disk');
  assert.ok(reloaded.profile.likes.includes('pnpm over npm'), 'profile fact persisted');

  const ev = capture().filter((c) => c.channel === 'kdx:dna:event' && c.payload?.type === 'updated');
  assert.ok(ev.length > 0, 'kdx:dna:event(updated) reached the renderer bridge (store ingest path)');
});

test('v1127 DNA: a SECOND real run\'s built system prompt includes the learned pattern', async () => {
  const requestsBefore = requests.length;
  const io = await runEngine('Do a second task now.');
  assert.ok(io.events.every((e) => e.type !== 'fatal'), 'second run completed');

  // Find the MAIN chat request (its system is the built prompt with the DNA section).
  const built = requests.slice(requestsBefore).find((r) => r.system.includes('# User DNA'));
  assert.ok(built, 'second run injected the # User DNA section into the built system prompt');
  assert.ok(built.system.includes('V1127_LEARNED'), 'built system prompt carries the learned pattern');

  // Direct render check as well (same source the engine used).
  const rendered = fresh('dna').renderDNAPrompt(fresh('dna').loadDNA(WS));
  assert.ok(rendered.includes('V1127_LEARNED'), 'renderDNAPrompt carries the learned pattern');
});

test('v1127 DNA: /dna stats (dnaStats) reflect the learned pattern + observed session', () => {
  const stats = fresh('dna').dnaStats(WS);
  assert.ok(stats.patterns >= 1, `dnaStats.patterns >= 1 (got ${stats.patterns})`);
  assert.ok(stats.sessionsObserved >= 1, `dnaStats.sessionsObserved >= 1 (got ${stats.sessionsObserved})`);
  assert.ok(Array.isArray(stats.growth) && stats.growth.length > 0, 'growth series present for /dna chart');
});

test('v1127 DNA: at the cap a NEW pattern is kept and an old reinforced one is evicted', () => {
  const dna = fresh('dna');
  let model = dna.loadDNA();
  const oldAdds = [];
  for (let i = 0; i < 60; i++) oldAdds.push({ kind: 'workflow', text: `Old reinforced DNA workflow number ${i} repeated many times by the user` });
  for (let round = 0; round < 4; round++) model = dna.mergeExtraction(model, { patterns_additions: oldAdds }).dna;
  assert.equal(model.patterns.length, 60, 'model filled to MAX_PATTERNS');

  const NEW = 'V1127_NEW_AT_CAP: always prefer bun over pnpm for this workspace';
  const after = dna.mergeExtraction(model, { patterns_additions: [{ kind: 'command', text: NEW }] }).dna;
  assert.equal(after.patterns.length, 60, 'still capped at MAX_PATTERNS');
  assert.ok(after.patterns.some((p) => p.text === NEW), 'NEW pattern survived the cap (no silent drop)');
  const oldAfter = after.patterns.filter((p) => p.text.includes('Old reinforced DNA workflow')).length;
  assert.equal(oldAfter, 59, 'exactly one old reinforced pattern was evicted to make room for the new one');
});
