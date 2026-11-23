import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// v11.11 (wave2-A5) — MODES / SLASH / WORKTREE ARE REAL (again, harder).
// The founder's demand: "تأكد مرة ثانية ... بأنها تعمل بشكل حقيقي وكامل،
// والورك تري يعمل. اختبر." — Build/Plan/Debug/Review must work FOR REAL,
// slash must be instant + local, worktrees must actually work.
//
// Same harness posture as tests/v1110-modes.test.mjs: REAL engine loop +
// REAL provider streaming layer driven by a scripted local mock provider
// (node:http, zero network). New in v11.11:
//
//   (1) PLAN   — write tool AND mutating command both HARD-denied with
//                visible notices; plan.md produced via the plan protocol;
//                plan_ready emitted; switch-to-Build handoff note injected;
//                the registry denyHint reaches the model after a denial.
//   (2) BUILD  — build-on-the-plan run: write lands, the post-run VERIFY
//                step actually executes the project's tests (cfg.verifyCommand;
//                proven PHYSICALLY via a proofs log the test writes to disk),
//                and the run reports verify evidence.
//   (3) DEBUG  — broken file pre-injected; the model reproduces (real red
//                test run) → hypothesizes (read) → applies a BROKEN fix →
//                the ENGINE's mandatory post-fix loop runs (red verify_run →
//                automatic fix round → green re-verify) with autoVerify OFF.
//   (4) REVIEW — read-only gate enforced (edit denied, file untouched) +
//                structured .surnia/reviews/review-<stamp>.md with REAL
//                sections (title, summary, findings table).
//   (5) SLASH  — /plan /build /debug /review switch modes with ZERO provider
//                round-trip (asserted by request count AND wall-clock),
//                persist per session, immediate UI-visible confirmation;
//                unknown /xyz → friendly local notice; custom .md commands
//                expand $ARGUMENTS AND $1..$9 before the model sees them.
//   (6) GATE BYPASS REGRESSION — read-only modes cannot be escaped through
//                side-door writing tools (create_skill / remember /
//                worktree_create): the denyHint contract blocks them all.
//   (7) WORKTREE — REAL git worktree machinery (gitService.create/list/
//                resolve/merge/remove on a temp repo): create→list→commit→
//                merge lands the files and cleans up; conflicting merge
//                REFUSES and leaves main clean (never downgrades main);
//                dirty remove refuses, force removes; .worktreeinclude
//                copies; agent-facing worktree_create/worktree_remove tools
//                execute through executeTool.
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1111-modes-'));

// ---------- esbuild bundle (same posture as the v1110 harness) ----------
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

// Custom slash-command home BEFORE the bundles are required (module reads the
// env at load time) — /deploy and /release become REAL custom commands.
const surniaHome = join(tmp, 'surnia-home');
mkdirSync(join(surniaHome, 'commands'), { recursive: true });
writeFileSync(join(surniaHome, 'commands', 'deploy.md'), 'Deploy the app to $ARGUMENTS with zero downtime.');
writeFileSync(
  join(surniaHome, 'commands', 'release.md'),
  'Ship $1 to channel $2 (args: $ARGUMENTS; spare $9).',
);
process.env.SURNIA_HOME = surniaHome;

const engPath = join(tmp, 'engine.cjs');
bundle('electron/agent/engine.ts', engPath);
const engine = require(engPath);

const slashPath = join(tmp, 'slash.cjs');
bundle('electron/services/slashService.ts', slashPath);
const slashSvc = require(slashPath);

const toolsPath = join(tmp, 'tools.cjs');
bundle('electron/agent/tools.ts', toolsPath);
const toolsMod = require(toolsPath);

const gitPath = join(tmp, 'gitservice.cjs');
bundle('electron/services/gitService.ts', gitPath);
const gitSvc = require(gitPath);

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
  const requests = []; // { model, messages } — messages let tests assert the SYSTEM PROMPT
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

// ---------- settings (autoVerify OFF — the debug test proves the mode
// overrides it; critic/dna/memory off so scripted routes stay exact).
// NOTE: storeService.getSettings() re-reads this file on every call, so the
// BUILD test can flip verifyCommand on temporarily and restore it. ----------
const settingsFile = join(userDataDir, 'settings.json');
const BASE_SETTINGS = {
  schemaVersion: 4,
  providers: { custom: { apiKey: 'test-key', baseUrl: mockBase } },
  agent: { maxRetries: 0, autoCompact: false, autoVerify: false, autoMemory: false, criticGate: false },
  dnaEnabled: false,
  doneNotifications: false,
};
const writeSettings = (agentOverrides) => {
  const cfg = { ...BASE_SETTINGS, agent: { ...BASE_SETTINGS.agent, ...(agentOverrides ?? {}) } };
  writeFileSync(settingsFile, JSON.stringify(cfg));
};
writeSettings(null);

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
  const t0 = Date.now();
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
  return {
    io,
    events: io.events,
    sessionId,
    durationMs: Date.now() - t0,
    requests: mock.requests.slice(reqStart),
  };
}

const notices = (events) => events.filter((e) => e.type === 'sys_notice');
const sysPrompt = (requests, i = 0) => {
  const sys = requests[i]?.messages?.find((m) => m.role === 'system');
  return sys?.content ?? '';
};
const anySys = (requests) => requests.map((r) => sysPrompt([r])).find((c) => c.length > 0) ?? '';
const wireHas = (requests, needle) => requests.some((r) => JSON.stringify(r.messages).includes(needle));

// ---------- workspaces ----------
function freshWs(name) {
  const ws = join(tmp, name);
  mkdirSync(join(ws, 'src'), { recursive: true });
  writeFileSync(join(ws, 'src', 'a.ts'), 'const x = 1;\n');
  return ws;
}

/** A workspace with a REAL npm test that only passes when marker.txt == GOOD.
 *  Green runs append to proofs-<tag>.log — physical evidence a verify ran. */
function testableWs(name, tag) {
  const ws = freshWs(name);
  writeFileSync(
    join(ws, 'package.json'),
    JSON.stringify({ name: 't', version: '1.0.0', scripts: { test: 'node check.js' } }),
  );
  writeFileSync(
    join(ws, 'check.js'),
    `const fs = require('fs');
const path = require('path');
try {
  const c = fs.readFileSync(path.join(__dirname, 'marker.txt'), 'utf8');
  if (c.trim() === 'GOOD') { fs.appendFileSync(path.join(__dirname, 'proofs-${tag}.log'), 'verified ' + Date.now() + '\\n'); process.exit(0); }
  process.exit(1);
} catch { process.exit(1); }
`,
  );
  return ws;
}

function gitRepo(ws) {
  execFileSync('git', ['init', '-q'], { cwd: ws });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: ws });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: ws });
  execFileSync('git', ['add', '.'], { cwd: ws });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: ws });
}

const gitOut = (ws, args) => execFileSync('git', args, { cwd: ws, encoding: 'utf8' }).trim();

// ============================================================
// 1) PLAN — hard read-only (write AND mutating command), plan.md produced,
//    plan_ready + switch-to-Build handoff, denyHint reaches the model
// ============================================================
test('plan mode: write tool + mutating command BOTH denied with visible notices; plan.md is the one sanctioned write; plan_ready + switch-to-Build handoff', async () => {
  const ws = freshWs('ws-plan');
  mock.routes.set('m-plan', [
    hToolCall({ name: 'write_file', args: JSON.stringify({ path: join(ws, 'src', 'a.ts'), content: 'const x = 999;\n' }), id: 'call_p0' }),
    hToolCall({ name: 'run_command', args: JSON.stringify({ command: 'npm install express' }), id: 'call_p1' }),
    hToolCall({ name: 'write_file', args: JSON.stringify({ path: join(ws, 'plan.md'), content: '# Plan\n1. change x to 2 in src/a.ts\n2. run npm test\n3. report\n' }), id: 'call_p2' }),
    hComplete({ text: 'Plan published: 1. change x to 2 in src/a.ts. 2. run tests. 3. report.' }),
  ]);
  const { events, requests } = await runEngine({ workspace: ws, model: 'm-plan', message: 'Plan how to change x to 2', taskMode: 'plan' });

  // (a) the write AND the mutating command NEVER landed
  assert.equal(readFileSync(join(ws, 'src', 'a.ts'), 'utf8'), 'const x = 1;\n', 'plan mode must leave the file untouched');
  assert.ok(!existsSync(join(ws, 'node_modules')), 'mutating command (npm install) must not have run');
  // (b) BOTH denials are user-visible with the mode posture
  assert.ok(notices(events).some((n) => /plan mode is read-only: write denied/.test(n.text)), 'write denial notice');
  assert.ok(notices(events).some((n) => /plan mode is read-only: command mutates state/.test(n.text)), 'mutating-command denial notice');
  // (c) system prompt carries the plan protocol + plan.md contract
  assert.ok(anySys(requests).includes('# Plan protocol'), 'system prompt must carry the plan protocol');
  assert.ok(anySys(requests).includes('plan.md'), 'system prompt must carry the plan.md contract');
  // (d) plan.md — the ONE sanctioned write — landed via the protocol
  assert.match(readFileSync(join(ws, 'plan.md'), 'utf8'), /# Plan/, 'plan.md must be produced by the plan protocol');
  // (e) end-of-run contract: plan_ready + switch-to-Build handoff note
  const pr = events.find((e) => e.type === 'plan_ready');
  assert.ok(pr, 'plan_ready must be emitted');
  assert.match(pr.plan, /change x to 2/, 'plan_ready carries the actual plan text');
  assert.ok(notices(events).some((n) => /switch to BUILD mode/.test(n.text)), 'switch-to-Build handoff note injected');
  // (f) the model was told WHY the calls were denied (registry denyHint in the wire)
  assert.ok(wireHas(requests, 'Plan mode is read-only until the plan is approved'), 'denyHint must reach the model after a denial');
});

// ============================================================
// 2) BUILD — build on the plan: write allowed, post-run VERIFY step
//    actually executes the project tests (cfg.verifyCommand), report contract
// ============================================================
test('build mode: write lands for real and the post-run verify step REALLY runs the project tests (physical proofs.log evidence), then reports', async () => {
  const ws = testableWs('ws-build', 'build');
  mock.routes.set('m-build', [
    hToolCall({ name: 'write_file', args: JSON.stringify({ path: join(ws, 'marker.txt'), content: 'GOOD\n' }), id: 'call_b1' }),
    hComplete({ text: 'Wrote marker.txt (GOOD). Verified: npm run test → exit code 0. Done.' }),
  ]);
  // flip verifyCommand ON for this run (getSettings re-reads from disk every call)
  writeSettings({ verifyCommand: 'npm run test' });
  try {
    const { events } = await runEngine({ workspace: ws, model: 'm-build', message: 'Implement the plan: make marker GOOD' });
    assert.equal(readFileSync(join(ws, 'marker.txt'), 'utf8'), 'GOOD\n', 'build mode must ACTUALLY write the file');
    assert.ok(
      notices(events).some((n) => /\[verify\] npm run test/.test(n.text)),
      'the post-run verify step must be announced',
    );
    assert.ok(notices(events).some((n) => /\[verify passed\]/.test(n.text)), 'the verify step must pass and be reported');
    assert.ok(existsSync(join(ws, 'proofs-build.log')), 'PHYSICAL proof: the project test really executed (proofs log appended by check.js)');
    assert.ok(readFileSync(join(ws, 'proofs-build.log'), 'utf8').trim().length > 0, 'proofs log has content');
    assert.ok(!notices(events).some((n) => /read-only/.test(n.text)), 'no read-only posture in build mode');
    assert.ok(notices(events).every((n) => !/\[verify failed/.test(n.text)), 'no fix round when verification passes');
  } finally {
    writeSettings(null); // restore for the other tests
  }
});

// ============================================================
// 3) DEBUG — reproduce (real red run) → hypothesize (read) → broken fix →
//    ENGINE's mandatory post-fix loop: red verify_run → auto fix → green
//    re-verify, even with autoVerify OFF
// ============================================================
test('debug mode: reproduce→hypothesize→fix protocol in the prompt + engine-run post-fix loop (red → auto-fix → green) with autoVerify OFF', async () => {
  const ws = testableWs('ws-debug', 'debug');
  writeFileSync(join(ws, 'marker.txt'), 'BAD\n'); // the broken file to debug
  mock.routes.set('m-debug', [
    // 1. REPRODUCE — the model runs the failing test for real (red)
    hToolCall({ name: 'run_command', args: JSON.stringify({ command: 'npm run test' }), id: 'call_d0' }),
    // 2. HYPOTHESIZE — read the broken file
    hToolCall({ name: 'read_file', args: JSON.stringify({ path: join(ws, 'marker.txt') }), id: 'call_d1' }),
    // 3. FIX (wrong first) — applies a STILL-BROKEN fix then stops
    hToolCall({ name: 'write_file', args: JSON.stringify({ path: join(ws, 'marker.txt'), content: 'BAD2\n' }), id: 'call_d2' }),
    hComplete({ text: 'Hypothesis: wrong marker value. Reproduced the failure with npm run test. Applied the fix to marker.txt.' }),
    // 4. automatic fix round after the RED verdict — corrects the file
    hToolCall({ name: 'edit_file', args: JSON.stringify({ path: join(ws, 'marker.txt'), old_string: 'BAD2', new_string: 'GOOD' }), id: 'call_d3' }),
    hComplete({ text: 'Root cause: marker value BAD2 instead of GOOD. Fixed and re-verified.' }),
  ]);
  const { events, requests } = await runEngine({ workspace: ws, model: 'm-debug', message: 'Fix the failing test', taskMode: 'debug' });

  // protocol in the system prompt: reproduce → hypothesize → fix, all present
  const sp = anySys(requests);
  assert.ok(sp.includes('# Debug protocol'), 'system prompt must carry the debug protocol');
  assert.ok(sp.includes('HYPOTHESES') && sp.includes('REPRODUCE') && sp.includes('FIX'), 'the protocol really encodes reproduce→hypothesize→fix');
  // the ENGINE's mandatory loop: red verdict → automatic fix round → green re-verify
  const verifies = events.filter((e) => e.type === 'verify_run');
  assert.ok(verifies.length >= 2, `debug loop must run verify at least twice (red + green), got ${verifies.length}`);
  assert.equal(verifies[0].exitCode !== 0, true, 'first engine verdict must be RED (autoVerify was OFF — the mode overrides the setting)');
  assert.equal(verifies[verifies.length - 1].exitCode, 0, 'final verdict must be GREEN after the fix round');
  assert.ok(verifies.every((v) => /npm run test|npm test/.test(v.cmd)), `verify commands must be the project tests, got ${verifies.map((v) => v.cmd)}`);
  assert.ok(notices(events).some((n) => /\[debug\] verification failed/.test(n.text)), 'the fix-round notice must be user-visible');
  assert.equal(readFileSync(join(ws, 'marker.txt'), 'utf8').trim(), 'GOOD', 'the fix round must have corrected the file');
});

// ============================================================
// 4) REVIEW — hard read-only enforced + structured review report with REAL
//    sections at .surnia/reviews/review-<stamp>.md
// ============================================================
test('review mode: edit HARD-denied (file untouched) + structured review report file with real sections', async () => {
  const ws = freshWs('ws-review');
  gitRepo(ws);
  writeFileSync(join(ws, 'src', 'a.ts'), 'const x = 2;\n'); // uncommitted diff → food for the review

  const findings = JSON.stringify([
    { severity: 'major', file: 'src/a.ts', line: 1, note: 'Magic number — extract to a named constant.' },
    { severity: 'minor', file: 'src/a.ts', line: 1, note: 'Add a doc comment.' },
  ]);
  mock.routes.set('m-review', [
    // the reviewer reads first (read-before-edit guard), then tries to "fix" —
    // the read-only gate must deny the write even in fullAccess permission mode
    hToolCall({ name: 'read_file', args: JSON.stringify({ path: join(ws, 'src', 'a.ts') }), id: 'call_r0' }),
    hToolCall({ name: 'edit_file', args: JSON.stringify({ path: join(ws, 'src', 'a.ts'), old_string: 'const x = 2;', new_string: 'const x = 3;' }), id: 'call_r1' }),
    hComplete({ text: 'Reviewing the working diff…' }), // the review turn itself
    hComplete({ text: findings }), // the review.ts structured call
  ]);
  const { events, requests } = await runEngine({ workspace: ws, model: 'm-review', message: 'Review my changes', taskMode: 'review' });

  // (a) read-only gate HARD-enforced — the attempted edit never landed
  assert.equal(readFileSync(join(ws, 'src', 'a.ts'), 'utf8'), 'const x = 2;\n', 'review mode must NEVER mutate');
  assert.ok(notices(events).some((n) => /review mode is read-only: write denied/.test(n.text)), 'denial is user-visible');
  assert.ok(anySys(requests).includes('# Review mode'), 'system prompt must carry the review protocol');
  assert.ok(wireHas(requests, 'Review task mode is read-only'), 'denyHint reaches the model');
  // (b) the structured report is a REAL artifact with REAL sections
  const dir = join(ws, '.surnia', 'reviews');
  assert.ok(existsSync(dir), 'reviews dir must exist');
  const files = readdirSync(dir).filter((f) => f.startsWith('review-') && f.endsWith('.md'));
  assert.equal(files.length, 1, `exactly one review report expected, got ${files}`);
  const md = readFileSync(join(dir, files[0]), 'utf8');
  assert.ok(md.includes('# Review report'), 'report has a title section');
  assert.ok(md.includes('**Summary:**') && md.includes('2 findings: 1 major, 1 minor'), 'report has a real summary with counts');
  assert.ok(md.includes('| Severity | File | Line | Note |'), 'report has a findings table');
  assert.ok(md.includes('major') && md.includes('src/a.ts') && md.includes('Magic number'), 'report contains the parsed findings');
  assert.ok(notices(events).some((n) => /\[review report\]/.test(n.text) && /2 findings/.test(n.text)), 'report notice is user-visible with the summary');
});

// ============================================================
// 5) SLASH — instant local mode switches (ZERO provider round-trip, FAST),
//    persisted per session; unknown → friendly local notice; custom .md
//    commands expand $ARGUMENTS AND $1..$9 before the model sees them
// ============================================================
test('slash: /review then /plan switch modes with ZERO provider round-trips, FAST, persisted per session; next text turn runs under the persisted mode', async () => {
  const ws = freshWs('ws-slash');
  const sessionId = 'sess-slash-persist';

  const r1 = await runEngine({ workspace: ws, sessionId, model: 'unused', message: '/review' });
  assert.equal(r1.requests.length, 0, '/review must be executed locally — zero provider calls');
  assert.ok(r1.durationMs < 2500, `slash handling must be FAST (no provider await) — took ${r1.durationMs}ms`);
  assert.ok(r1.events.some((e) => e.type === 'turn_end'), 'the run ends cleanly');
  const n1 = notices(r1.events).find((x) => /\[\/slash\]/.test(x.text));
  assert.ok(n1, 'immediate UI-visible confirmation notice');
  assert.ok(/REVIEW mode/.test(n1.text) && /المراجعة/.test(n1.text), 'notice is bilingual EN+AR');
  assert.equal(engine.getSessionTaskMode(sessionId), 'review', 'mode persists per session');

  const r2 = await runEngine({ workspace: ws, sessionId, model: 'unused', message: '/plan' });
  assert.equal(r2.requests.length, 0, '/plan must ALSO be local — still zero provider calls');
  assert.ok(r2.durationMs < 2500, `second switch must be FAST — took ${r2.durationMs}ms`);
  assert.equal(engine.getSessionTaskMode(sessionId), 'plan', 'mode switch replaces the previous one');

  // next turn in the SAME session: plain text — engine uses the PERSISTED mode
  mock.routes.set('m-persist', [hComplete({ text: 'Planning now.' })]);
  const { requests: r3 } = await runEngine({ workspace: ws, sessionId, model: 'm-persist', message: 'now plan the work' });
  assert.equal(r3.length, 1, 'third turn runs the model');
  assert.ok(sysPrompt(r3, 0).includes('# Plan protocol'), 'the persisted plan mode shapes the NEXT run');
});

test('slash: unknown /xyz → friendly bilingual local notice, never sent to the model; not even a slow provider call', async () => {
  const ws = freshWs('ws-slash2');
  const { events, requests, durationMs } = await runEngine({ workspace: ws, model: 'unused', message: '/frobnicate now' });
  assert.equal(requests.length, 0, 'unknown command must NOT reach the model');
  assert.ok(durationMs < 2500, `must be resolved locally without waiting on any provider — took ${durationMs}ms`);
  const n = notices(events).find((x) => /Unknown command \/frobnicate/.test(x.text));
  assert.ok(n, 'friendly unknown-command notice');
  assert.ok(/\/help/.test(n.text) && /أمر غير معروف/.test(n.text), 'notice points to /help and is bilingual');
  assert.ok(events.some((e) => e.type === 'turn_end'), 'run ends cleanly');
});

test('slash: custom .md commands expand $ARGUMENTS and $1..$9 correctly (engine path + dispatcher unit), and text containing a slash passes through', async () => {
  const ws = freshWs('ws-slash3');

  // engine path — $ARGUMENTS
  mock.routes.set('m-custom', [hComplete({ text: 'Deploying to prod-1 now.' })]);
  const { requests } = await runEngine({ workspace: ws, model: 'm-custom', message: '/deploy prod-1' });
  assert.equal(requests.length, 1, 'custom command runs exactly one model turn');
  const lastUser = [...requests[0].messages].reverse().find((m) => m.role === 'user');
  assert.equal(
    lastUser?.content,
    'Deploy the app to prod-1 with zero downtime.',
    'the MODEL must receive the expansion, not the raw slash text',
  );

  // engine path — $1..$9 positional expansion
  mock.routes.set('m-rel', [hComplete({ text: 'Shipping now.' })]);
  const r2 = await runEngine({ workspace: ws, model: 'm-rel', message: '/release app canary beta' });
  const lastUser2 = [...r2.requests[0].messages].reverse().find((m) => m.role === 'user');
  assert.equal(
    lastUser2?.content,
    'Ship app to channel canary (args: app canary beta; spare ).',
    '$1/$2 filled, $ARGUMENTS = full args, missing $9 = empty',
  );

  // dispatcher unit checks (single source of truth with the engine path)
  const dPlan = await slashSvc.dispatchSlashCommand({ raw: '/plan', workspace: ws });
  assert.equal(dPlan.kind, 'task-mode');
  assert.equal(dPlan.taskMode, 'plan');
  const dBuild = await slashSvc.dispatchSlashCommand({ raw: '/build', workspace: ws });
  assert.equal(dBuild.taskMode, 'build');
  const dDebug = await slashSvc.dispatchSlashCommand({ raw: '/debug', workspace: ws });
  assert.equal(dDebug.taskMode, 'debug');
  const dReview = await slashSvc.dispatchSlashCommand({ raw: '/review something', workspace: ws });
  assert.equal(dReview.kind, 'task-mode');
  assert.equal(dReview.taskMode, 'review');
  const dPass = await slashSvc.dispatchSlashCommand({ raw: 'plain question about /plan?', workspace: ws });
  assert.equal(dPass.kind, 'pass', 'text that merely CONTAINS a slash passes through');
  const dUnknown = await slashSvc.dispatchSlashCommand({ raw: '/nope', workspace: ws });
  assert.equal(dUnknown.kind, 'unknown');
  assert.match(dUnknown.notice, /Unknown command \/nope/);
  const dCustom = await slashSvc.dispatchSlashCommand({ raw: '/deploy canary', workspace: ws });
  assert.equal(dCustom.kind, 'custom');
  assert.equal(dCustom.expanded, 'Deploy the app to canary with zero downtime.');

  // $1..$9 expansion unit (all positions at once)
  const expanded = slashSvc.expandCommand('a=$1 b=$2 c=$3 d=$4 e=$5 f=$6 g=$7 h=$8 i=$9 all=$ARGUMENTS', 'p1 p2 p3 p4 p5 p6 p7 p8 p9');
  assert.equal(expanded, 'a=p1 b=p2 c=p3 d=p4 e=p5 f=p6 g=p7 h=p8 i=p9 all=p1 p2 p3 p4 p5 p6 p7 p8 p9');
});

// ============================================================
// 6) GATE BYPASS REGRESSION — read-only modes cannot be escaped through
//    side-door writing tools (create_skill / remember / worktree_create).
//    The engine's denyHint contract must block ALL of them.
// ============================================================
test('plan mode end-to-end: create_skill side-door is BLOCKED (no skill file written, model told why)', async () => {
  const ws = freshWs('ws-gate');
  mock.routes.set('m-gate', [
    hToolCall({ name: 'create_skill', args: JSON.stringify({ name: 'exfil', body: 'Do things.\nStep 2.', description: 'side door' }), id: 'call_g1' }),
    hComplete({ text: 'Attempted to save a skill.' }),
  ]);
  const { events, requests } = await runEngine({ workspace: ws, model: 'm-gate', message: 'save that as a skill', taskMode: 'plan' });
  assert.ok(!existsSync(join(ws, '.surnia', 'skills')), 'plan mode must NOT allow a side-door skill write');
  assert.ok(!existsSync(join(ws, '.surnia', 'skills', 'exfil', 'SKILL.md')), 'the skill body must not exist anywhere');
  assert.ok(wireHas(requests, 'Plan mode is read-only'), 'the model must be told the read-only reason');
  assert.ok(notices(events).every((n) => !/skill saved/.test(n.text)), 'no success notice');
});

test('denyHint contract: create_skill / remember / worktree_create all refuse under a read-only denyHint (unit, executeTool level)', async () => {
  const ws = freshWs('ws-gate2');
  gitRepo(ws);
  const denyCtx = {
    workspace: ws,
    sessionId: 'sess-deny-unit',
    mcpServers: [],
    emit: () => {},
    approve: async () => true, // approvals would be allowed — the denyHint is what must stop these
    fullAccess: true,
    denyHint: 'Review task mode is read-only — analyze and report; do not modify files.',
  };
  const plainCtx = { ...denyCtx, sessionId: 'sess-plain-unit', denyHint: undefined }; // NO read-only posture

  // create_skill — blocked before any write
  const sk = await toolsMod.executeTool('create_skill', JSON.stringify({ name: 'nope', body: 'x'.repeat(120) }), denyCtx);
  assert.equal(sk.ok, false, 'create_skill must be blocked by the denyHint contract');
  assert.match(sk.output, /Blocked:/, 'the refusal carries the mode reason');
  assert.ok(!existsSync(join(ws, '.surnia', 'skills')), 'no skill dir written');

  // remember — the forget verb deletes MEMORY.md lines; both verbs write MEMORY.md
  writeFileSync(join(ws, 'MEMORY.md'), '## Remembered\n- keep me\n');
  const rm = await toolsMod.executeTool('remember', JSON.stringify({ kind: 'project', content: 'keep me', action: 'forget' }), denyCtx);
  assert.equal(rm.ok, false, 'remember must be blocked by the denyHint contract');
  assert.match(rm.output, /Blocked:/, 'the refusal carries the mode reason');
  assert.equal(readFileSync(join(ws, 'MEMORY.md'), 'utf8'), '## Remembered\n- keep me\n', 'MEMORY.md untouched in a read-only posture');

  // worktree_create — mutates repo state (sibling dir + branch); must refuse
  const wt = await toolsMod.executeTool('worktree_create', JSON.stringify({ name: 'nope-wt' }), denyCtx);
  assert.equal(wt.ok, false, 'worktree_create must be blocked in a read-only posture');
  assert.match(wt.output, /Blocked:/, 'the refusal carries the mode reason');
  assert.ok(!existsSync(dirname(ws) + '/sadeem-nope-wt'), 'no sibling worktree dir created');

  // sanity: with NO denyHint the same tools still work (build mode unaffected)
  const skOk = await toolsMod.executeTool('create_skill', JSON.stringify({ name: 'fine', body: 'Do the thing.\nStep 2.' }), plainCtx);
  assert.equal(skOk.ok, true, 'create_skill still works when no read-only posture is active');
  const list = await gitSvc.listWorktrees(ws);
  assert.ok(list.every((w) => w.name !== 'nope-wt'), 'blocked worktree was truly not created');
});

// ============================================================
// 7) WORKTREE — REAL git worktree machinery end-to-end
// ============================================================
test('worktree: create → list → resolve → commit in the worktree → merge lands files → worktree + branch cleaned up', async () => {
  const main = freshWs('wt-main');
  writeFileSync(join(main, 'app.txt'), 'base\n');
  gitRepo(main);

  const created = await gitSvc.createWorktree(main, 'fix-api');
  assert.equal(created.branch, 'sadeem/fix-api', 'branch scheme sadeem/<name>');
  assert.ok(existsSync(created.path), 'worktree dir exists as a sibling checkout');
  assert.equal(gitOut(created.path, ['rev-parse', '--abbrev-ref', 'HEAD']), 'sadeem/fix-api', 'worktree HEAD is on its branch');

  const list = await gitSvc.listWorktrees(main);
  const entry = list.find((w) => w.name === 'fix-api');
  assert.ok(entry, 'list contains the worktree');
  assert.equal(entry.branch, 'sadeem/fix-api', 'list reports the branch');
  assert.equal(entry.dirty, false, 'fresh worktree is clean');

  const resolved = await gitSvc.resolveWorktree(main, 'fix-api');
  assert.ok(resolved && resolved.path === created.path, 'resolveWorktree finds it by short name');

  // real work INSIDE the worktree, then merge back
  writeFileSync(join(created.path, 'app.txt'), 'base\nfixed-in-worktree\n');
  writeFileSync(join(created.path, 'new-module.ts'), 'export const ok = true;\n');
  execFileSync('git', ['add', '.'], { cwd: created.path });
  execFileSync('git', ['commit', '-qm', 'fix: api'], { cwd: created.path });

  const merged = await gitSvc.mergeWorktree(main, 'fix-api');
  assert.equal(merged.ok, true, `merge succeeds: ${merged.error ?? ''}`);
  assert.ok(merged.merged?.includes('app.txt') && merged.merged?.includes('new-module.ts'), 'merge reports the files it landed');
  assert.match(readFileSync(join(main, 'app.txt'), 'utf8'), /fixed-in-worktree/, 'the worktree change REALLY landed in main');
  assert.ok(existsSync(join(main, 'new-module.ts')), 'new files really land in main');
  assert.ok(!existsSync(created.path), 'worktree removed after merge');
  assert.equal(gitOut(main, ['branch', '--list', 'sadeem/fix-api']), '', 'branch deleted after merge');
});

test('worktree: conflicting merge REFUSES (main never downgraded/broken) — main stays clean, worktree survives for retry', async () => {
  const main = freshWs('wt-conflict');
  writeFileSync(join(main, 'app.txt'), 'line=1\n');
  gitRepo(main);

  const wt = await gitSvc.createWorktree(main, 'conflicter');
  // worktree edits line=1 → line=worktree, commits
  writeFileSync(join(wt.path, 'app.txt'), 'line=worktree\n');
  execFileSync('git', ['add', '.'], { cwd: wt.path });
  execFileSync('git', ['commit', '-qm', 'wt change'], { cwd: wt.path });
  // main independently edits the same line → line=main, commits
  writeFileSync(join(main, 'app.txt'), 'line=main\n');
  execFileSync('git', ['add', '.'], { cwd: main });
  execFileSync('git', ['commit', '-qm', 'main change'], { cwd: main });

  const merged = await gitSvc.mergeWorktree(main, 'conflicter');
  assert.equal(merged.ok, false, 'conflicting merge must refuse');
  assert.ok(merged.error && merged.error.length > 0, 'an honest error is returned');
  // main never downgraded: content is main's version, repo clean, no merge in progress
  assert.equal(readFileSync(join(main, 'app.txt'), 'utf8').replace(/\r\n/g, '\n'), 'line=main\n', 'main content unchanged (never downgraded)');
  assert.equal(gitOut(main, ['status', '--porcelain']), '', 'main repo clean after the refused merge');
  assert.ok(!existsSync(join(main, '.git', 'MERGE_HEAD')), 'no merge left in progress');
  assert.ok(existsSync(wt.path), 'worktree kept for a retry');
  // cleanup for the next tests
  await gitSvc.removeWorktree(main, 'conflicter', true);
});

test('worktree: delete refuses on a DIRTY worktree, force removes it, and everything is cleaned (dir + branch gone)', async () => {
  const main = freshWs('wt-dirty');
  gitRepo(main);

  const wt = await gitSvc.createWorktree(main, 'dirty-wt');
  writeFileSync(join(wt.path, 'scratch.txt'), 'uncommitted\n'); // dirty

  await assert.rejects(
    () => gitSvc.removeWorktree(main, 'dirty-wt'),
    /WORKTREE_DIRTY/,
    'removing a dirty worktree without force must refuse',
  );
  assert.ok(existsSync(wt.path), 'dirty worktree still there');

  await gitSvc.removeWorktree(main, 'dirty-wt', true);
  assert.ok(!existsSync(wt.path), 'force removal deletes the dir');
  assert.equal(gitOut(main, ['branch', '--list', 'sadeem/dirty-wt']), '', 'branch deleted');
  const list = await gitSvc.listWorktrees(main);
  assert.ok(!list.some((w) => w.name === 'dirty-wt'), 'list no longer shows it');
});

test('worktree: .worktreeinclude git-ignored files (e.g. .env) are copied into the fresh worktree (Codex parity)', async () => {
  const main = freshWs('wt-include');
  writeFileSync(join(main, '.worktreeinclude'), '.env\nconfig/app.yml\n');
  writeFileSync(join(main, '.env'), 'SECRET=1\n');
  mkdirSync(join(main, 'config'), { recursive: true });
  writeFileSync(join(main, 'config', 'app.yml'), 'port: 1\n');
  gitRepo(main);

  const wt = await gitSvc.createWorktree(main, 'with-env');
  assert.equal(readFileSync(join(wt.path, '.env'), 'utf8').replace(/\r\n/g, '\n'), 'SECRET=1\n', '.env copied into the worktree');
  assert.equal(readFileSync(join(wt.path, 'config', 'app.yml'), 'utf8').replace(/\r\n/g, '\n'), 'port: 1\n', 'nested include copied');
  await gitSvc.removeWorktree(main, 'with-env', true);
});

test('worktree agent tools: worktree_create / worktree_remove REALLY execute through executeTool (real git machinery)', async () => {
  const main = freshWs('wt-agent');
  gitRepo(main);
  const ctx = {
    workspace: main,
    sessionId: 'sess-wt-tool',
    mcpServers: [],
    emit: () => {},
    approve: async () => true,
    fullAccess: true,
  };
  const cr = await toolsMod.executeTool('worktree_create', JSON.stringify({ name: 'agent-wt' }), ctx);
  assert.equal(cr.ok, true, `worktree_create executes: ${cr.output}`);
  assert.match(cr.output, /sadeem\/agent-wt/, 'the tool reports the branch');
  const wtDir = dirname(main) + '/sadeem-agent-wt';
  assert.ok(existsSync(wtDir), 'the worktree dir REALLY exists on disk');
  const list = await gitSvc.listWorktrees(main);
  assert.ok(list.some((w) => w.name === 'agent-wt' && w.branch === 'sadeem/agent-wt'), 'the UI list sees the agent-created worktree');

  const rm = await toolsMod.executeTool('worktree_remove', JSON.stringify({ name: 'agent-wt' }), ctx);
  assert.equal(rm.ok, true, `worktree_remove executes: ${rm.output}`);
  assert.ok(!existsSync(wtDir), 'worktree dir gone after the tool removal');
  assert.equal(gitOut(main, ['branch', '--list', 'sadeem/agent-wt']), '', 'branch gone after the tool removal');
});

after(async () => {
  await mock.stop();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
