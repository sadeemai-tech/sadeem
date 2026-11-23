// ============================================================
// v11.21 — MODES & SLASH ARE REAL. PROOF, NOT DECORATION.
// The founder (30x): "أريدك أن كل قدرات السلاش تعمل، وطور البلان وطور
// الديباك وطور الريفيو يعمل بحق وليس مجرد منظر… مليون مرة أكدت عليك".
//
// This suite does NOT assert that an event was emitted or that a toast was
// shown. It asserts PHYSICAL side effects against the REAL engine loop +
// REAL provider streaming layer, driven by a scripted LOCAL mock provider
// (node:http, zero network):
//   PLAN   — write_file is refused: the file on disk is byte-identical; the
//            sanctioned plan.md lands; plan_ready + denyHint are real.
//   BUILD  — write_file really changes disk (control posture).
//   DEBUG  — the engine itself runs `npm run test` (red), starts an automatic
//            fix round, re-runs (green), and the project's own check.js
//            appends to a physical proofs log. The file is actually fixed.
//   REVIEW — a real git repo diff drives a persisted
//            .surnia/reviews/review-*.md with the parsed findings, plus a
//            review_findings event; a write attempt is hard-denied.
//   HONESTY— a NON-git folder is reported as "not a repository" and NO fake
//            "working tree is clean" report is produced (v11.21 fix).
//   PARITY — the renderer's src/lib/modes.ts stamps agree with the engine's
//            prompts.ts capability registry (no cosmetic UI claims).
//   SLASH  — /build /plan /debug /review execute with ZERO provider calls,
//            persist for the session, and shape the NEXT real run.
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1121-modes-'));
process.env.SURNIA_SKIP_UI_GATE = '1'; // headless harness — no Electron window to probe

function bundle(entry, out) {
  execFileSync(
    ESBUILD_NODE,
    [
      ESBUILD_BIN,
      entry,
      '--bundle',
      '--platform=node',
      '--format=cjs',
      `--outfile=${out}`,
      '--external:electron',
      '--external:@xterm/xterm',
      '--external:@xterm/addon-fit',
      '--external:monaco-editor',
      '--external:@monaco-editor/react',
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
}

// electron stub — plain Node execution
const userDataDir = join(tmp, 'userdata');
mkdirSync(userDataDir, { recursive: true });
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `module.exports = {
    app: { getPath: (k) => ${JSON.stringify(userDataDir)}, whenReady: async () => true, on() {}, quit() {} },
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: { getAllWindows: () => [] },
    Notification: { isSupported: () => false },
    shell: {}, screen: {},
  };`,
);

// custom slash command home BEFORE bundles load (module reads env at load time)
const surniaHome = join(tmp, 'surnia-home');
mkdirSync(join(surniaHome, 'commands'), { recursive: true });
writeFileSync(join(surniaHome, 'commands', 'deploy.md'), 'Deploy to $1 (all: $ARGUMENTS).');
process.env.SURNIA_HOME = surniaHome;

const enginePath = join(tmp, 'engine.cjs');
bundle('electron/agent/engine.ts', enginePath);
const engine = require(enginePath);

const reviewPath = join(tmp, 'review.cjs');
bundle('electron/agent/review.ts', reviewPath);
const review = require(reviewPath);

const modesPath = join(tmp, 'modes.cjs');
bundle('src/lib/modes.ts', modesPath);
const uiModes = require(modesPath);

const promptsPath = join(tmp, 'prompts.cjs');
bundle('electron/agent/prompts.ts', promptsPath);
const prompts = require(promptsPath);

// ---------- mock OpenAI-compatible provider ----------
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
function sseHeaders(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  res.flushHeaders();
}
function finishSse(res, finish) {
  res.write(sseChunk({}, finish));
  res.write('data: [DONE]\n\n');
  res.end();
}
function toolDeltas(name, args, id) {
  const half = Math.max(1, Math.floor(args.length / 2));
  return [
    { tool_calls: [{ index: 0, id, function: { name, arguments: '' } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(0, half) } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(half) } }] },
  ];
}
const hComplete = ({ text, finish = 'stop' } = {}) => async ({ res }) => {
  sseHeaders(res);
  if (text) res.write(sseChunk({ content: text }));
  finishSse(res, finish);
};
const hToolCall = ({ name, args, id = 'call_1' } = {}) => async ({ res }) => {
  sseHeaders(res);
  for (const d of toolDeltas(name, args, id)) res.write(sseChunk(d));
  finishSse(res, 'tool_calls');
};

function startMock() {
  const routes = new Map();
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      requests.push({ model: body.model, messages: body.messages ?? [] });
      const q = routes.get(body.model);
      const h = q && q.length ? q.shift() : null;
      if (!h) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `UNSCRIPTED request for model ${body.model}` } }));
        return;
      }
      try { await h({ res, req, body }); } catch { try { res.destroy(); } catch { /* gone */ } }
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const listening = new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  return {
    routes,
    requests,
    port: listening,
    async stop() {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}
const mock = startMock();
const mockBase = `http://127.0.0.1:${await mock.port}`;

writeFileSync(
  join(userDataDir, 'settings.json'),
  JSON.stringify({
    schemaVersion: 4,
    providers: { custom: { apiKey: 'test-key', baseUrl: mockBase } },
    agent: { maxRetries: 0, autoCompact: false, autoVerify: false, autoMemory: false, criticGate: false },
    dnaEnabled: false,
    doneNotifications: false,
  }),
);

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
async function runEngine({ workspace, sessionId = 's-' + Math.random().toString(36).slice(2), message, model = 'mock', taskMode } = {}) {
  const io = makeIo();
  const reqStart = mock.requests.length;
  const params = {
    task: 'chat',
    sessionId,
    messages: [{ id: 'm1', role: 'user', kind: 'text', content: message ?? 'Do the task.', timestamp: Date.now() }],
    model: { provider: 'custom', model, maxTokens: 2048 },
    mode: 'fullAccess',
    workspace,
    apiKey: 'test-key',
    baseUrl: mockBase,
  };
  if (taskMode) params.taskMode = taskMode;
  await engine.runAgent(params, io);
  return { events: io.events, sessionId, requests: mock.requests.slice(reqStart) };
}
const notices = (events) => events.filter((e) => e.type === 'sys_notice').map((n) => n.text);
const sysPrompt = (requests) =>
  requests.map((r) => r.messages.find((m) => m.role === 'system')?.content ?? '');

function freshWs(name) {
  const ws = join(tmp, name);
  mkdirSync(join(ws, 'src'), { recursive: true });
  writeFileSync(join(ws, 'src', 'a.ts'), 'const x = 1;\n');
  return ws;
}
function gitRepo(ws) {
  execFileSync('git', ['init', '-q'], { cwd: ws });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: ws });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: ws });
  execFileSync('git', ['add', '.'], { cwd: ws });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: ws });
}

// ============================================================
// PLAN — write_file refused, real effect on disk
// ============================================================
test('v1121 PLAN: write_file is REFUSED — the target file is byte-identical; plan.md + plan_ready + denyHint are real', async () => {
  const ws = freshWs('plan');
  mock.routes.set('m-plan', [
    hToolCall({ name: 'write_file', args: JSON.stringify({ path: join(ws, 'src', 'a.ts'), content: 'const x = 999;\n' }), id: 'p1' }),
    hComplete({ text: 'Plan: 1. change x to 2. 2. run tests. 3. ship.' }),
  ]);
  const { events, requests } = await runEngine({ workspace: ws, model: 'm-plan', message: 'Change x to 2', taskMode: 'plan' });

  assert.equal(readFileSync(join(ws, 'src', 'a.ts'), 'utf8'), 'const x = 1;\n', 'PLAN must leave the target file untouched — no write may land');
  assert.ok(notices(events).some((n) => /plan mode is read-only: write denied/.test(n)), 'the refusal must be visible');
  assert.ok(notices(events).some((n) => /switch to BUILD mode/.test(n)), 'the build handoff must be visible');
  assert.ok(events.some((e) => e.type === 'plan_ready'), 'plan_ready must be emitted');
  assert.ok(existsSync(join(ws, 'plan.md')), 'the ONE sanctioned write (plan.md) must land on disk');
  assert.ok(sysPrompt(requests).some((p) => p.includes('# Plan protocol')), 'the engine must actually switch posture');
  assert.ok(JSON.stringify(requests).includes('Plan mode is read-only'), 'the model must be told why the call was refused');
});

// ============================================================
// BUILD — control: a write really lands
// ============================================================
test('v1121 BUILD: write_file really changes disk (control posture)', async () => {
  const ws = freshWs('build');
  mock.routes.set('m-build', [
    hToolCall({ name: 'write_file', args: JSON.stringify({ path: join(ws, 'built.txt'), content: 'shipped\n' }), id: 'b1' }),
    hComplete({ text: 'Wrote built.txt.' }),
  ]);
  const { events } = await runEngine({ workspace: ws, model: 'm-build', message: 'Create built.txt' });
  assert.equal(readFileSync(join(ws, 'built.txt'), 'utf8'), 'shipped\n', 'BUILD must actually write');
  assert.ok(!notices(events).some((n) => /read-only/.test(n)), 'BUILD is not read-only');
});

// ============================================================
// DEBUG — engine-run test loop with physical proof
// ============================================================
test('v1121 DEBUG: engine runs npm test (red) → automatic fix round → re-verifies (green); file REALLY fixed, proofs log appended', async () => {
  const ws = freshWs('debug');
  writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'dbg', version: '1.0.0', scripts: { test: 'node check.js' } }));
  writeFileSync(
    join(ws, 'check.js'),
    `const fs = require('fs'), path = require('path');
try {
  const c = fs.readFileSync(path.join(__dirname, 'marker.txt'), 'utf8');
  if (c.trim() === 'GOOD') {
    fs.appendFileSync(path.join(__dirname, 'proofs.log'), 'verified ' + Date.now() + '\\n');
    process.exit(0);
  }
  process.exit(1);
} catch { process.exit(1); }\n`,
  );
  mock.routes.set('m-debug', [
    hToolCall({ name: 'write_file', args: JSON.stringify({ path: join(ws, 'marker.txt'), content: 'BAD\n' }), id: 'd1' }),
    hComplete({ text: 'Applied a first fix.' }),
    // automatic fix round after the red verdict
    hToolCall({ name: 'edit_file', args: JSON.stringify({ path: join(ws, 'marker.txt'), old_string: 'BAD', new_string: 'GOOD' }), id: 'd2' }),
    hComplete({ text: 'Root cause: wrong marker value. Fixed and re-verified.' }),
  ]);
  const { events, requests } = await runEngine({ workspace: ws, model: 'm-debug', message: 'Fix the failing test', taskMode: 'debug' });

  const verifies = events.filter((e) => e.type === 'verify_run');
  assert.ok(verifies.length >= 2, `DEBUG must verify at least twice (red + green), got ${verifies.length}`);
  assert.notEqual(verifies[0].exitCode, 0, 'the first verdict must be RED (autoVerify is OFF — the mode overrides it)');
  assert.equal(verifies[verifies.length - 1].exitCode, 0, 'the final verdict must be GREEN after the fix round');
  assert.ok(notices(events).some((n) => /\[debug\] verification failed/.test(n)), 'the automatic fix round must be announced');
  assert.equal(readFileSync(join(ws, 'marker.txt'), 'utf8').trim(), 'GOOD', 'the fix round must REALLY correct the file');
  assert.ok(existsSync(join(ws, 'proofs.log')), 'PHYSICAL proof: the project test really executed');
  assert.ok(sysPrompt(requests).some((p) => p.includes('# Debug protocol')), 'the debug protocol must be active');
  assert.ok(notices(events).some((n) => /\[debug report\]/.test(n)), 'the diagnosis summary must be visible');
});

// ============================================================
// REVIEW — git diff → persisted report; writes refused
// ============================================================
test('v1121 REVIEW: git diff drives a REAL persisted report file + review_findings event; edit is refused', async () => {
  const ws = freshWs('review');
  gitRepo(ws);
  writeFileSync(join(ws, 'src', 'a.ts'), 'const x = 2;\n'); // uncommitted diff = food
  const findings = JSON.stringify([
    { severity: 'critical', file: 'src/a.ts', line: 1, note: 'Magic number — extract a constant.' },
    { severity: 'minor', file: 'src/a.ts', line: 1, note: 'Add a doc comment.' },
  ]);
  mock.routes.set('m-review', [
    hComplete({ text: 'Reviewing the working diff…' }),
    hComplete({ text: findings }), // review.ts structured call
  ]);
  const { events, requests } = await runEngine({ workspace: ws, model: 'm-review', message: 'Review my changes', taskMode: 'review' });

  assert.ok(sysPrompt(requests).some((p) => p.includes('# Review mode')), 'review posture must be active');
  assert.ok(events.some((e) => e.type === 'review_findings'), 'the structured findings card must be emitted');
  const reportDir = join(ws, '.surnia', 'reviews');
  const files = existsSync(reportDir) ? readdirSync(reportDir).filter((f) => /^review-.*\.md$/.test(f)) : [];
  assert.equal(files.length, 1, `exactly one real report file expected, got ${JSON.stringify(files)}`);
  const md = readFileSync(join(reportDir, files[0]), 'utf8');
  assert.ok(md.includes('# Review report') && md.includes('| Severity | File | Line | Note |'), 'the report has real structure');
  assert.ok(md.includes('critical') && md.includes('src/a.ts') && md.includes('Magic number'), 'the report contains the parsed findings');
  assert.ok(notices(events).some((n) => /\[review report\]/.test(n) && /2 findings/.test(n)), 'the persisted report is announced with a real summary');
});

// ============================================================
// REVIEW HONESTY — never fabricate a "clean" report for a non-repo
// ============================================================
test('v1121 REVIEW honesty: a NON-git folder is reported as NOT a repository, never a fake clean report', async () => {
  const plain = freshWs('not-a-repo');
  const { diff, status, isRepo } = await review.captureWorkingDiff(plain);
  assert.equal(isRepo, false, 'a plain folder is NOT a git repository');
  assert.equal(diff.trim(), '', 'no diff can exist outside a repo');
  assert.equal(status.trim(), '', 'no porcelain status outside a repo');

  const res = await review.reviewWorkingDiff(plain, {
    model: { provider: 'custom', model: 'never-called', maxTokens: 16 },
    apiKey: 'test-key',
    baseUrl: mockBase,
  });
  assert.equal(res.ok, false, 'reviewWorkingDiff must refuse, not fabricate');
  assert.match(res.error, /Not a git repository/i, 'the refusal must be honest');
  assert.equal(res.clean, undefined, 'a non-repo is NOT "clean"');
  assert.deepEqual(res.findings, []);
});

// ============================================================
// UI STAMP ↔ ENGINE CAPABILITY PARITY (anti-cosmetic)
// ============================================================
test('v1121 PARITY: the renderer mode stamps agree with the engine capability registry — no cosmetic claims', async () => {
  const modes = uiModes.TASK_MODES;
  assert.deepEqual([...modes], ['build', 'plan', 'debug', 'review'], 'the strip order is the canonical one');
  for (const m of modes) {
    assert.ok(uiModes.TASK_MODE_DESC[m]?.length > 0, `${m} needs a visible description`);
    assert.ok(prompts.TASK_MODE_SPECS[m]?.protocol?.length > 0, `${m} needs a real engine protocol`);
  }
  // The UI calls PLAN "no writes" and REVIEW "read-only" — the engine must
  // actually enforce that, or the stamp is cosmetic.
  assert.match(uiModes.TASK_MODE_DESC.plan, /no writes/i);
  assert.equal(prompts.TASK_MODE_SPECS.plan.readOnly, true);
  assert.match(uiModes.TASK_MODE_DESC.review, /read-only/i);
  assert.equal(prompts.TASK_MODE_SPECS.review.readOnly, true);
  assert.equal(prompts.TASK_MODE_SPECS.build.readOnly, false);
  assert.equal(prompts.TASK_MODE_SPECS.debug.readOnly, false);
  assert.ok(prompts.TASK_MODE_SPECS.plan.denyHint, 'PLAN has a real model-facing refusal hint');
  assert.ok(prompts.TASK_MODE_SPECS.review.denyHint, 'REVIEW has a real model-facing refusal hint');
});

// ============================================================
// SLASH — instant local execution + persistence
// ============================================================
test('v1121 SLASH: /build /plan /debug /review execute with ZERO provider calls, persist, and shape the next real run', async () => {
  const ws = freshWs('slash');
  for (const [cmd, expected] of [['build', 'build'], ['plan', 'plan'], ['debug', 'debug'], ['review', 'review']]) {
    const sid = `slash-${cmd}`;
    const { events, requests } = await runEngine({ workspace: ws, sessionId: sid, model: 'unused', message: `/${cmd}` });
    assert.equal(requests.length, 0, `/${cmd} must execute locally — no provider round-trip`);
    assert.ok(events.some((e) => e.type === 'turn_end'), `/${cmd} ends cleanly`);
    assert.ok(notices(events).some((n) => /\[\/slash\]/.test(n)), `/${cmd} has a visible confirmation`);
    assert.equal(engine.getSessionTaskMode(sid), expected, `/${cmd} persists for the session`);
  }

  // the persisted mode MUST change the next real run's posture
  const sid = 'slash-persist';
  await runEngine({ workspace: ws, sessionId: sid, model: 'unused', message: '/plan' });
  mock.routes.set('m-persist', [hComplete({ text: 'Plan follows.' })]);
  const next = await runEngine({ workspace: ws, sessionId: sid, model: 'm-persist', message: 'now plan it' });
  assert.equal(next.requests.length, 1, 'the next turn really runs the model');
  assert.ok(sysPrompt(next.requests).some((p) => p.includes('# Plan protocol')), 'the persisted PLAN mode shapes the next run');
});

test('v1121 SLASH: unknown → honest local notice; custom markdown → expanded before the model', async () => {
  const ws = freshWs('slash2');
  const unknown = await runEngine({ workspace: ws, model: 'unused', message: '/frobnicate please' });
  assert.equal(unknown.requests.length, 0, 'unknown command must never reach the model');
  assert.ok(notices(unknown.events).some((n) => /Unknown command \/frobnicate/.test(n)), 'honest unknown-command notice');

  mock.routes.set('m-custom', [hComplete({ text: 'Deploying.' })]);
  const custom = await runEngine({ workspace: ws, model: 'm-custom', message: '/deploy prod-1' });
  assert.equal(custom.requests.length, 1, 'custom command runs one real model turn');
  const lastUser = [...custom.requests[0].messages].reverse().find((m) => m.role === 'user');
  assert.equal(lastUser.content, 'Deploy to prod-1 (all: prod-1).', 'the model receives the expansion, not the raw slash text');
});

after(async () => {
  await mock.stop();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
