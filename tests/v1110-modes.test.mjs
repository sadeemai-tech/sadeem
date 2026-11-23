import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// v11.10 (A4) — MODES ARE REAL test suite: every task mode must cause an
// OBSERVABLE behavioral difference, and every slash command that reaches the
// engine must EXECUTE (never echo to the model).
//
//   (1) PLAN   — edit_file is HARD-denied by the harness (file untouched),
//                system prompt carries the plan protocol + plan.md contract,
//                the run ends with plan_ready + a switch-to-Build note, and
//                plan.md is the ONE sanctioned write.
//   (2) BUILD  — full access: the write actually lands on disk; system prompt
//                carries the build contract (apply → verify).
//   (3) DEBUG  — mandatory post-fix test loop: engine runs the project tests
//                itself (autoVerify OFF proves the mode overrides the
//                setting), red verdict → automatic fix round → green verdict,
//                all visible as `verify_run` events.
//   (4) REVIEW — structured review report: .surnia/reviews/review-*.md is
//                written from the parsed findings + a review report notice.
//   (5) SLASH  — /plan /build /debug /review switch the session task mode
//                WITHOUT a model call and PERSIST for the session; unknown
//                commands get the friendly local notice (v11.9 E19, no model
//                call); custom markdown commands expand ($ARGUMENTS) before
//                the model ever sees them.
//
// End-to-end against the REAL engine loop + REAL provider streaming layer,
// driven by a scripted local mock provider (node:http, zero network).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1110-modes-'));

// ---------- esbuild bundle (same posture as the endurance harness) ----------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, 
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
  ], { cwd: ROOT, stdio: 'pipe' });
}

// electron stub for plain-Node execution
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
    shell: {},
    screen: {},
  };`,
);

// Custom slash-command home BEFORE the bundles are required (the module reads
// the env at load time) — /deploy becomes a REAL custom command.
const surniaHome = join(tmp, 'surnia-home');
mkdirSync(join(surniaHome, 'commands'), { recursive: true });
writeFileSync(join(surniaHome, 'commands', 'deploy.md'), 'Deploy the app to $ARGUMENTS with zero downtime.');
process.env.SURNIA_HOME = surniaHome;

const engPath = join(tmp, 'engine.cjs');
bundle('electron/agent/engine.ts', engPath);
const engine = require(engPath);

const slashPath = join(tmp, 'slash.cjs');
bundle('electron/services/slashService.ts', slashPath);
const slashSvc = require(slashPath);

// ---------- mock OpenAI-compatible provider ----------
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

function sseHeaders(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  res.flushHeaders();
}
function finishSse(res, finish, usage) {
  if (usage) res.write(`data: ${JSON.stringify({ usage, choices: [] })}\n\n`);
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
const hToolCall = ({ text, name, args, id = 'call_1', finish = 'tool_calls' } = {}) => async ({ res }) => {
  sseHeaders(res);
  if (text) res.write(sseChunk({ content: text }));
  for (const d of toolDeltas(name, args, id)) res.write(sseChunk(d));
  finishSse(res, finish);
};

function startMock() {
  const routes = new Map(); // model → handler queue
  const requests = []; // { model, messages } — messages lets tests assert the SYSTEM PROMPT
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      requests.push({ model: body.model, messages: body.messages ?? [], at: Date.now() });
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

// ---------- settings (autoVerify OFF — the debug test PROVES the mode
// overrides it; critic/dna/memory off so scripted routes stay exact) ----------
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

// ---------- engine harness ----------
function makeIo() {
  const events = [];
  return {
    events,
    send(e) {
      events.push(e);
    },
    async getDecision(requestId) {
      return { requestId, action: 'allow' }; // approvals auto-allowed (permission layer, NOT mode gates)
    },
    isAborted: () => false,
    onFetchSignal() {},
  };
}

async function runEngine({ workspace, sessionId = 'sess-' + Math.random().toString(36).slice(2), message = 'Do the task end to end.', model = 'mock', taskMode } = {}) {
  const io = makeIo();
  const reqStart = mock.requests.length;
  const params = {
    task: 'chat',
    sessionId,
    messages: [{ id: 'm1', role: 'user', kind: 'text', content: message, timestamp: Date.now() }],
    model: { provider: 'custom', model, maxTokens: 2048 },
    mode: 'fullAccess',
    workspace,
    apiKey: 'test-key',
    baseUrl: mockBase,
  };
  if (taskMode) params.taskMode = taskMode;
  await engine.runAgent(params, io);
  return { io, events: io.events, sessionId, requests: mock.requests.slice(reqStart) };
}

const notices = (events) => events.filter((e) => e.type === 'sys_notice');
const sysPrompt = (requests, i = 0) => {
  const sys = requests[i]?.messages?.find((m) => m.role === 'system');
  return sys?.content ?? '';
};

// ---------- workspaces ----------
function freshWs(name) {
  const ws = join(tmp, name);
  mkdirSync(join(ws, 'src'), { recursive: true });
  writeFileSync(join(ws, 'src', 'a.ts'), 'const x = 1;\n');
  return ws;
}

// ============================================================
// 1) PLAN — hard read-only enforcement + plan protocol + next-step note
// ============================================================
test('plan mode: edit denied by the harness, plan protocol + plan.md contract in the system prompt, plan_ready + switch-to-Build note', async () => {
  const ws = freshWs('ws-plan');
  mock.routes.set('m-plan', [
    hToolCall({ name: 'read_file', args: JSON.stringify({ path: join(ws, 'src', 'a.ts') }), id: 'call_p0' }),
    hToolCall({ name: 'edit_file', args: JSON.stringify({ path: join(ws, 'src', 'a.ts'), old_string: 'const x = 1;', new_string: 'const x = 2;' }), id: 'call_p1' }),
    hComplete({ text: 'Plan: 1. change x to 2 in src/a.ts. 2. run tests. 3. ship.' }),
  ]);
  const { events, requests } = await runEngine({ workspace: ws, model: 'm-plan', message: 'Change x to 2', taskMode: 'plan' });

  // (a) the edit NEVER landed — hard read-only, not a suggestion
  assert.equal(readFileSync(join(ws, 'src', 'a.ts'), 'utf8'), 'const x = 1;\n', 'plan mode must leave the file untouched');
  // (b) the denial is user-visible with the mode posture
  const denial = notices(events).find((n) => /plan mode is read-only: write denied/.test(n.text));
  assert.ok(denial, `expected a plan read-only denial notice, got: ${JSON.stringify(notices(events).map((n) => n.text))}`);
  // (c) the system prompt switched to the plan protocol with the plan.md contract
  const sp = sysPrompt(requests, 1); // requests[0] is the pre-flight? [1] should be the loop call — search all
  const anySys = requests.map((r) => sysPrompt([r])).find((c) => c.includes('# Plan protocol'));
  assert.ok(anySys || sp.includes('# Plan protocol'), 'system prompt must carry the plan protocol');
  assert.ok((anySys ?? sp).includes('plan.md'), 'system prompt must carry the plan.md contract');
  // (d) end-of-run: the plan is offered as switch-to-Build next step
  assert.ok(events.some((e) => e.type === 'plan_ready'), 'plan_ready must be emitted');
  assert.ok(notices(events).some((n) => /switch to BUILD mode/.test(n.text)), 'switch-to-Build next-step note');
  // (e) the model was told WHY its tool call was denied (denyHint from the registry)
  assert.ok(
    requests.some((r) => JSON.stringify(r.messages).includes('Plan mode is read-only until the plan is approved')),
    'the registry denyHint must reach the model after a denial',
  );
});

test('plan mode: plan.md is the ONE sanctioned write (passes the gate)', async () => {
  const ws = freshWs('ws-plan-md');
  mock.routes.set('m-plan2', [
    hToolCall({ name: 'write_file', args: JSON.stringify({ path: join(ws, 'plan.md'), content: '# Plan\n1. do it\n' }), id: 'call_p2' }),
    hComplete({ text: 'Plan saved to plan.md.' }),
  ]);
  const { events } = await runEngine({ workspace: ws, model: 'm-plan2', message: 'Write the plan file', taskMode: 'plan' });
  assert.equal(readFileSync(join(ws, 'plan.md'), 'utf8'), '# Plan\n1. do it\n', 'plan.md write must be ALLOWED in plan mode');
  assert.ok(!notices(events).some((n) => /plan mode is read-only/.test(n.text)), 'no denial for the sanctioned plan.md write');
});

// ============================================================
// 2) BUILD — unchanged full access + build contract in the prompt
// ============================================================
test('build mode: full access applies the write for real; build contract in the system prompt', async () => {
  const ws = freshWs('ws-build');
  mock.routes.set('m-build', [
    hToolCall({ name: 'write_file', args: JSON.stringify({ path: join(ws, 'built.txt'), content: 'shipped\n' }), id: 'call_b1' }),
    hComplete({ text: 'Done — wrote built.txt.' }),
  ]);
  const { events, requests } = await runEngine({ workspace: ws, model: 'm-build', message: 'Create built.txt' });

  assert.equal(readFileSync(join(ws, 'built.txt'), 'utf8'), 'shipped\n', 'build mode must ACTUALLY write the file');
  assert.ok(!notices(events).some((n) => /read-only/.test(n.text)), 'no read-only posture in build mode');
  assert.ok(requests.map((r) => sysPrompt([r])).some((c) => c.includes('# Build mode')), 'system prompt must carry the build contract');
  assert.ok(requests.map((r) => sysPrompt([r])).some((c) => c.includes('VERIFY')), 'build contract includes verify-with-tests');
});

// ============================================================
// 3) DEBUG — mandatory post-fix test loop (red → fix round → green)
// ============================================================
test('debug mode: engine runs the post-fix test loop itself — red verify_run, automatic fix round, green verify_run (autoVerify OFF)', async () => {
  const ws = freshWs('ws-debug');
  // project: `npm test` = node check.js — exits 1 unless marker.txt == GOOD
  writeFileSync(
    join(ws, 'package.json'),
    JSON.stringify({ name: 'dbg', version: '1.0.0', scripts: { test: 'node check.js' } }),
  );
  writeFileSync(
    join(ws, 'check.js'),
    `const fs = require('fs');\nconst path = require('path');\ntry {\n  const c = fs.readFileSync(path.join(__dirname, 'marker.txt'), 'utf8');\n  process.exit(c.trim() === 'GOOD' ? 0 : 1);\n} catch {\n  process.exit(1);\n}\n`,
  );
  mock.routes.set('m-debug', [
    // main run: the model applies a (broken) fix then stops
    hToolCall({ name: 'write_file', args: JSON.stringify({ path: join(ws, 'marker.txt'), content: 'BAD\n' }), id: 'call_d1' }),
    hComplete({ text: 'Applied the fix to marker.txt.' }),
    // automatic fix round after the RED verdict: corrects the file
    hToolCall({ name: 'edit_file', args: JSON.stringify({ path: join(ws, 'marker.txt'), old_string: 'BAD', new_string: 'GOOD' }), id: 'call_d2' }),
    hComplete({ text: 'Root cause: wrong marker value. Fixed and re-verified.' }),
  ]);
  const { events, requests } = await runEngine({ workspace: ws, model: 'm-debug', message: 'Fix the failing test', taskMode: 'debug' });

  assert.ok(requests.map((r) => sysPrompt([r])).some((c) => c.includes('# Debug protocol')), 'system prompt must carry the debug protocol');
  const verifies = events.filter((e) => e.type === 'verify_run');
  assert.ok(verifies.length >= 2, `debug loop must run verify at least twice (red + green), got ${verifies.length}`);
  assert.equal(verifies[0].exitCode !== 0, true, 'first verdict must be RED (autoVerify was OFF — the mode overrides the setting)');
  assert.equal(verifies[verifies.length - 1].exitCode, 0, 'final verdict must be GREEN after the fix round');
  assert.ok(verifies.every((v) => /npm run test|npm test|node .*check/.test(v.cmd)), `verify commands must be the project tests, got ${verifies.map((v) => v.cmd)}`);
  assert.ok(notices(events).some((n) => /\[debug\] verification failed/.test(n.text)), 'the fix-round notice must be user-visible');
  assert.equal(readFileSync(join(ws, 'marker.txt'), 'utf8').trim(), 'GOOD', 'the fix round must have corrected the file');
});

// ============================================================
// 4) REVIEW — structured review report (file + notice) from review.ts
// ============================================================
test('review mode: hard read-only + structured review report file + notice from parsed findings', async () => {
  const ws = freshWs('ws-review');
  // real git repo with an uncommitted change → captureWorkingDiff has food
  execFileSync('git', ['init', '-q'], { cwd: ws });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: ws });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: ws });
  execFileSync('git', ['add', '.'], { cwd: ws });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: ws });
  writeFileSync(join(ws, 'src', 'a.ts'), 'const x = 2;\n'); // uncommitted diff

  const findings = JSON.stringify([
    { severity: 'major', file: 'src/a.ts', line: 1, note: 'Magic number — extract to a named constant.' },
    { severity: 'minor', file: 'src/a.ts', line: 1, note: 'Add a doc comment.' },
  ]);
  mock.routes.set('m-review', [
    hComplete({ text: 'Reviewing the working diff…' }), // the review turn itself
    hComplete({ text: findings }), // the review.ts structured call
  ]);
  const { events, requests } = await runEngine({ workspace: ws, model: 'm-review', message: 'Review my changes', taskMode: 'review' });

  assert.ok(requests.map((r) => sysPrompt([r])).some((c) => c.includes('# Review mode')), 'system prompt must carry the review protocol');
  assert.ok(notices(events).some((n) => /\[review report\]/.test(n.text)), 'review report notice must be emitted');
  assert.ok(notices(events).some((n) => /2 findings/.test(n.text)), 'report summary must count the parsed findings');
  const dir = join(ws, '.surnia', 'reviews');
  assert.ok(existsSync(dir), 'reviews dir must exist');
  const files = readdirSync(dir).filter((f) => f.startsWith('review-') && f.endsWith('.md'));
  assert.ok(files.length === 1, `exactly one review report expected, got ${files}`);
  const md = readFileSync(join(dir, files[0]), 'utf8');
  assert.ok(md.includes('major') && md.includes('src/a.ts') && md.includes('Magic number'), 'report must contain the parsed findings');
});

// ============================================================
// 5) SLASH — commands EXECUTE (no model echo), modes persist, E19 holds
// ============================================================
test('slash: /plan /build /debug /review dispatch to task modes with NO model call, and the mode PERSISTS for the session', async () => {
  const ws = freshWs('ws-slash');
  const { events, requests, sessionId } = await runEngine({ workspace: ws, model: 'unused', message: '/debug' });
  assert.equal(requests.length, 0, '/debug must be executed locally — zero provider calls');
  assert.ok(events.some((e) => e.type === 'turn_end'), 'the run ends cleanly');
  const n = notices(events).find((x) => /\[\/slash\]/.test(x.text));
  assert.ok(n, 'a local switch notice must be emitted');
  assert.ok(/DEBUG mode/.test(n.text) && /تصحيح الأخطاء/.test(n.text), 'notice is bilingual EN+AR');
  assert.equal(engine.getSessionTaskMode(sessionId), 'debug', 'the task mode persists per session');

  // next turn in the SAME session: plain text — engine uses the PERSISTED mode
  mock.routes.set('m-persist', [hComplete({ text: 'Debugging now.' })]);
  const { requests: r2 } = await runEngine({ workspace: ws, sessionId, model: 'm-persist', message: 'now find the bug' });
  assert.equal(r2.length, 1, 'second turn runs the model');
  assert.ok(sysPrompt(r2, 0).includes('# Debug protocol'), 'the persisted debug mode shapes the NEXT run');
});

test('slash: unknown command → friendly local notice (E19), never sent to the model', async () => {
  const ws = freshWs('ws-slash2');
  const { events, requests } = await runEngine({ workspace: ws, model: 'unused', message: '/frobnicate now' });
  assert.equal(requests.length, 0, 'unknown command must NOT reach the model');
  const n = notices(events).find((x) => /Unknown command \/frobnicate/.test(x.text));
  assert.ok(n, 'friendly unknown-command notice');
  assert.ok(/\/help/.test(n.text) && /أمر غير معروف/.test(n.text), 'notice points to /help and is bilingual');
  assert.ok(events.some((e) => e.type === 'turn_end'), 'run ends cleanly');
});

test('slash: custom markdown command expands ($ARGUMENTS) before the model; plain text passes through', async () => {
  const ws = freshWs('ws-slash3');
  mock.routes.set('m-custom', [hComplete({ text: 'Deploying to prod-1 now.' })]);
  const { requests } = await runEngine({ workspace: ws, model: 'm-custom', message: '/deploy prod-1' });
  assert.equal(requests.length, 1, 'custom command runs exactly one model turn');
  const lastUser = [...requests[0].messages].reverse().find((m) => m.role === 'user');
  assert.equal(
    lastUser?.content,
    'Deploy the app to prod-1 with zero downtime.',
    'the MODEL must receive the expansion, not the raw slash text',
  );

  // pure dispatcher unit checks (single source of truth with the engine path)
  const dPlan = await slashSvc.dispatchSlashCommand({ raw: '/plan', workspace: ws });
  assert.equal(dPlan.kind, 'task-mode');
  assert.equal(dPlan.taskMode, 'plan');
  const dBuild = await slashSvc.dispatchSlashCommand({ raw: '/build', workspace: ws });
  assert.equal(dBuild.taskMode, 'build');
  const dReview = await slashSvc.dispatchSlashCommand({ raw: '/review something', workspace: ws });
  assert.equal(dReview.kind, 'task-mode');
  assert.equal(dReview.taskMode, 'review');
  const dPass = await slashSvc.dispatchSlashCommand({ raw: 'plain question about /plan?', workspace: ws });
  assert.equal(dPass.kind, 'pass', 'text that merely CONTAINS a slash passes through');
  const dUnknown = await slashSvc.dispatchSlashCommand({ raw: '/nope', workspace: ws });
  assert.equal(dUnknown.kind, 'unknown');
  const dCustom = await slashSvc.dispatchSlashCommand({ raw: '/deploy canary', workspace: ws });
  assert.equal(dCustom.kind, 'custom');
  assert.equal(dCustom.expanded, 'Deploy the app to canary with zero downtime.');
});

after(async () => {
  await mock.stop();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
