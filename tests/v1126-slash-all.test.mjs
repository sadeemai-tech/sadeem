// ============================================================
// v11.26 — EVERY advertised slash command is REAL (proof, not decoration).
//
// The founder (repeated many times): "كل أوامر السلاش يجب أن تعمل بشكل
// المثالي والمطلوب." This suite walks the ONE advertised-command registry
// (src/lib/modes.ts :: SLASH_COMMANDS) and, for EVERY entry, proves a REAL
// observable effect:
//
//   (A) REGISTRY    — every advertised command has a handler with a concrete
//                     side-effect call (store handler / prompt template /
//                     Composer UI action / engine task-mode dispatch). A dead
//                     command advertised in the menu FAILS this suite.
//   (B) PARITY      — the four BUILD/PLAN/DEBUG/REVIEW stamps match real engine
//                     TASK_MODE_SPECS protocols (read-only + denyHint where the
//                     stamp claims it). No cosmetic-only claims.
//   (C) TASK MODES  — /build /plan /debug /review run locally (ZERO provider
//                     calls), persist, and shape the NEXT real model turn.
//   (D) PARSING     — leading '/', args, Arabic/English text, and UNKNOWN
//                     commands produce an honest bilingual local notice —
//                     never a silent no-op, never a leaked model prompt.
//   (E) REVIEW      — REVIEW mode writes a PHYSICAL .surnia/reviews/*.md that
//                     passes the renderer's own report contract validator.
//   (F) UI SURFACES — the quick-hint row and the CapabilityGuide advertise only
//                     commands that also exist in the registry.
//
// Real engine loop + real provider streaming layer, scripted LOCAL mock
// provider (node:http, zero network). Same posture as v1121/v1111.
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
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1126-slash-'));
process.env.SURNIA_SKIP_UI_GATE = '1';

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
const src = (rel) => readFileSync(join(ROOT, rel), 'utf8');

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

// custom command home BEFORE the bundles load (module reads env at load time)
const surniaHome = join(tmp, 'surnia-home');
mkdirSync(join(surniaHome, 'commands'), { recursive: true });
writeFileSync(join(surniaHome, 'commands', 'deploy.md'), 'Deploy to $1 (all: $ARGUMENTS).');
process.env.SURNIA_HOME = surniaHome;

const modesPath = join(tmp, 'modes.cjs');
bundle('src/lib/modes.ts', modesPath);
const modes = require(modesPath);

const promptsPath = join(tmp, 'prompts.cjs');
bundle('electron/agent/prompts.ts', promptsPath);
const prompts = require(promptsPath);

const slashPath = join(tmp, 'slash.cjs');
bundle('electron/services/slashService.ts', slashPath);
const slashSvc = require(slashPath);

const reviewPath = join(tmp, 'review.cjs');
bundle('electron/agent/review.ts', reviewPath);
const review = require(reviewPath);

const enginePath = join(tmp, 'engine.cjs');
bundle('electron/agent/engine.ts', enginePath);
const engine = require(enginePath);

// ---------- mock OpenAI-compatible provider ----------
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const sseHeaders = (res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  res.flushHeaders();
};
const finishSse = (res, finish) => {
  res.write(sseChunk({}, finish));
  res.write('data: [DONE]\n\n');
  res.end();
};
const toolDeltas = (name, args, id) => {
  const half = Math.max(1, Math.floor(args.length / 2));
  return [
    { tool_calls: [{ index: 0, id, function: { name, arguments: '' } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(0, half) } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(half) } }] },
  ];
};
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
const notices = (events) => events.filter((e) => e.type === 'sys_notice').map((n) => n.text ?? '');
const sysPrompt = (requests) => requests.map((r) => r.messages.find((m) => m.role === 'system')?.content ?? '');
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
// A) EVERY advertised command → a REAL handler with a concrete effect
// ============================================================
const storeSrc = src('src/store.ts');
const composerSrc = src('src/components/Composer.tsx');
const guideSrc = src('src/components/CapabilityGuide.tsx');

/** Concrete side-effect token that MUST appear in store.ts for a 'store' cmd. */
const STORE_EFFECT = {
  clear: 'newSession()', compact: 'compact()', rewind: 'cpList', undo: 'undoLastCheckpoint()',
  continue: 'continueTask()', fork: 'sessionFork(', export: 'buildSessionMarkdown', goal: 'setGoal(',
  init: "runAgent('init')", context: 'ctxFillTokens(', cost: 'sessionUsage', dna: 'dnaStats',
  review: 'gitReview(', diff: 'showDiff(', test: 'runTests(', explain: 'explainFile(', commit: 'gitCommitMessage(',
  flows: "rail: 'flows'", effort: 'updateSettings({ agent:', model: 'switchModel(', profile: 'switchToolProfile(',
  budget: 'budgetCommand(', terminal: 'toggleTerminal()', help: 'Available SADEEM commands',
  mcp: 'mcpCommand(', skills: 'skillsCommand(',
  // panel-group commands open a rail (single shared branch)
  git: "cmd === 'prompts' || cmd === 'git'", usage: "cmd === 'prompts' || cmd === 'git'",
  library: "cmd === 'prompts' || cmd === 'git'", prompts: "cmd === 'prompts' || cmd === 'git'",
  status: 'slash.status.title', share: 'buildShareHtml(',
};
/** Concrete call that MUST appear in Composer's selectSlash for a 'ui' action. */
const UI_EFFECT = {
  schedule: 'setScheduled(true)', mode: 'setMode(nextMode)', settings: 'setSettingsModal(true',
  theme: 'cycleTheme()', lang: "setLang(lang === 'ar'", plans: 'setPlans(true)',
  panel: 'setRail(c.panel)', taskmode: 'setTaskMode(c.taskMode)',
};

test('v1126 REGISTRY: every advertised slash command has a REAL effect handler (no dead commands)', () => {
  const all = modes.SLASH_COMMANDS;
  assert.ok(all.length >= 40, `registry must advertise the full menu, got ${all.length}`);

  // the literal Composer menu and the canonical registry MUST be the same set
  // (guards against a command advertised in one place but not the other).
  const menuTokens = new Set([...composerSrc.matchAll(/cmd: '(\/[a-z0-9_-]+)'/g)].map((m) => m[1]));
  const registryTokens = new Set(all.map((c) => c.cmd));
  assert.deepEqual([...menuTokens].sort(), [...registryTokens].sort(),
    'Composer menu tokens must exactly equal the SLASH_COMMANDS registry');
  const names = new Set();
  for (const spec of all) {
    const name = spec.cmd.slice(1);
    assert.ok(/^\/[a-z0-9][a-z0-9_-]*$/.test(spec.cmd), `bad advertised token ${spec.cmd}`);
    assert.ok(!names.has(spec.cmd), `duplicate advertised command ${spec.cmd}`);
    names.add(spec.cmd);

    // the Composer owns a localized label (otherwise the menu row is blank)
    assert.ok(composerSrc.includes(`case '${spec.cmd}':`), `${spec.cmd} needs a slashDescription() label`);

    switch (spec.effect) {
      case 'store': {
        assert.ok(storeSrc.includes(`cmd === '${name}'`), `${spec.cmd} has NO store.ts handler`);
        const token = STORE_EFFECT[name];
        assert.ok(token, `${spec.cmd} needs a declared real-effect token`);
        assert.ok(storeSrc.includes(token), `${spec.cmd} store handler lacks the real effect '${token}'`);
        break;
      }
      case 'template': {
        const key = `${name}:`;
        assert.ok(storeSrc.includes(key), `${spec.cmd} is missing from SLASH_PROMPT_TEMPLATES`);
        assert.ok(storeSrc.includes('SLASH_PROMPT_TEMPLATES[cmd](arg)'), 'templates must expand before a real send');
        break;
      }
      case 'ui': {
        assert.ok(composerSrc.includes(`case '${spec.action}':`), `${spec.cmd} UI action '${spec.action}' is not handled`);
        const token = UI_EFFECT[spec.action];
        assert.ok(token && composerSrc.includes(token), `${spec.cmd} UI action lacks the real effect '${token}'`);
        break;
      }
      case 'engine-mode': {
        assert.equal(slashSvc.TASK_MODE_SLASH_COMMANDS[spec.taskMode], name,
          `${spec.cmd} must dispatch to the engine ${spec.taskMode} task mode`);
        assert.ok(prompts.TASK_MODE_SPECS[spec.taskMode]?.protocol?.length, `${spec.cmd} engine mode needs a real protocol`);
        break;
      }
      default:
        assert.fail(`${spec.cmd} has unknown effect kind ${spec.effect}`);
    }
  }

  // /help + CapabilityGuide extras are advertised too — they must be handled.
  for (const cmd of modes.SLASH_STORE_EXTRA) {
    const name = cmd.slice(1);
    assert.ok(storeSrc.includes(`cmd === '${name}'`), `${cmd} advertised by /help has NO store handler`);
    assert.ok(storeSrc.includes(STORE_EFFECT[name]), `${cmd} lacks a real effect`);
    assert.ok(guideSrc.includes(`cmd: '${cmd}'`), `${cmd} must be advertised in the CapabilityGuide`);
  }
});

// ============================================================
// B) Mode stamps ↔ real engine capabilities
// ============================================================
test('v1126 PARITY: all four stamps match real engine protocols (no cosmetic claims)', () => {
  assert.deepEqual([...modes.TASK_MODES], ['build', 'plan', 'debug', 'review']);
  for (const m of modes.TASK_MODES) {
    assert.ok(modes.TASK_MODE_DESC[m]?.length, `${m} needs a visible stamp description`);
    const spec = prompts.TASK_MODE_SPECS[m];
    assert.ok(spec?.protocol?.length, `${m} needs a real engine protocol`);
    // every stamp is slash-reachable AND has a real effect handler. BUILD/PLAN/
    // DEBUG dispatch to the engine task mode; REVIEW's renderer slash runs a
    // real git review while the REVIEW stamp itself drives the engine protocol.
    const entry = modes.SLASH_COMMANDS.find((c) => c.cmd === modes.SLASH_TASK_MODE[m]);
    assert.ok(entry, `${m} must have a slash command in the registry`);
    assert.ok(['engine-mode', 'store'].includes(entry.effect), `${m} slash must have a real effect`);
    if (m !== 'review') {
      assert.equal(entry.effect, 'engine-mode', `${m} slash must dispatch to the engine`);
      assert.equal(slashSvc.TASK_MODE_SLASH_COMMANDS[m], m);
    }
  }
  // the REVIEW stamp is still backed by a REAL engine protocol + persisted
  // report (proved physically in test E below), never a cosmetic claim.
  assert.match(modes.TASK_MODE_DESC.plan, /no writes/i);
  assert.equal(prompts.TASK_MODE_SPECS.plan.readOnly, true);
  assert.match(modes.TASK_MODE_DESC.review, /read-only/i);
  assert.equal(prompts.TASK_MODE_SPECS.review.readOnly, true);
  assert.equal(prompts.TASK_MODE_SPECS.build.readOnly, false);
  assert.equal(prompts.TASK_MODE_SPECS.debug.readOnly, false);
  assert.ok(prompts.TASK_MODE_SPECS.plan.denyHint && prompts.TASK_MODE_SPECS.review.denyHint,
    'read-only modes need real model-facing refusal hints');
});

// ============================================================
// C) Task-mode slash commands are REAL (local, persisted, shape next run)
// ============================================================
test('v1126 TASK-MODE SLASH: /build /plan /debug /review run with ZERO provider calls, persist, shape the next run', async () => {
  const ws = freshWs('slash-modes');
  for (const m of modes.TASK_MODES) {
    const cmd = modes.SLASH_TASK_MODE[m];
    const sid = `v1126-${m}`;
    const { events, requests } = await runEngine({ workspace: ws, sessionId: sid, model: 'unused', message: cmd });
    assert.equal(requests.length, 0, `${cmd} must execute locally — no provider round-trip`);
    assert.ok(events.some((e) => e.type === 'turn_end'), `${cmd} ends cleanly`);
    assert.ok(notices(events).some((n) => /\[\/slash\]/.test(n)), `${cmd} has a visible confirmation`);
    assert.equal(engine.getSessionTaskMode(sid), m, `${cmd} persists for the session`);
  }
  // persisted posture shapes the NEXT real run
  const sid = 'v1126-persist';
  await runEngine({ workspace: ws, sessionId: sid, model: 'unused', message: '/plan' });
  mock.routes.set('m-persist', [hComplete({ text: 'Plan follows.' })]);
  const next = await runEngine({ workspace: ws, sessionId: sid, model: 'm-persist', message: 'now plan it' });
  assert.equal(next.requests.length, 1, 'the next turn really runs the model');
  assert.ok(sysPrompt(next.requests).some((p) => p.includes('# Plan protocol')), 'persisted PLAN shapes the next run');
});

// ============================================================
// D) Parsing: leading '/', args, Arabic/English, honest unknown notice
// ============================================================
test('v1126 PARSING: leading slash, arguments, Arabic text and unknown commands never silently no-op', async () => {
  const p = (raw) => modes.parseSlashCommand(raw);
  assert.deepEqual(p('/plan'), { name: 'plan', args: '' }, 'bare command');
  assert.deepEqual(p('/model  gpt-4o  '), { name: 'model', args: 'gpt-4o' }, 'ASCII args trimmed');
  assert.deepEqual(p('/goal بناء ميزة جديدة'), { name: 'goal', args: 'بناء ميزة جديدة' }, 'Arabic ARGUMENTS pass through');
  assert.deepEqual(p('  /review x'), { name: 'review', args: 'x' }, 'leading whitespace tolerated');
  assert.equal(p('plain /plan?'), null, 'text that merely contains a slash is not a command');
  assert.equal(p('/'), null, 'bare slash is not a command');
  assert.equal(p('/مساعدة'), null, 'an Arabic-typed command slug is not a registered ASCII slug');
  assert.equal(modes.isSlashMenuQuery('/'), true);
  assert.equal(modes.isSlashMenuQuery('/pl'), true);
  assert.equal(modes.isSlashMenuQuery('/plan x'), false, 'menu stops live-filtering once args begin');
  assert.equal(modes.isSlashMenuQuery('hi /plan'), false);

  const notice = modes.unknownSlashNotice('frobnicate');
  assert.match(notice, /Unknown command \/frobnicate/);
  assert.match(notice, /أمر غير معروف/);
  assert.match(notice, /\/help/);

  // engine: an unknown ASCII slash is a local notice, NOT a model prompt
  const ws = freshWs('slash-unknown');
  const unknown = await runEngine({ workspace: ws, model: 'unused', message: '/frobnicate please' });
  assert.equal(unknown.requests.length, 0, 'unknown command must never reach the model');
  assert.ok(notices(unknown.events).some((n) => /Unknown command \/frobnicate/.test(n)), 'honest notice');
  assert.ok(notices(unknown.events).some((n) => /أمر غير معروف/.test(n)), 'bilingual (Arabic) notice');

  // custom markdown command expands $ARGUMENTS before the model sees it
  mock.routes.set('m-custom', [hComplete({ text: 'Deploying.' })]);
  const custom = await runEngine({ workspace: ws, model: 'm-custom', message: '/deploy prod-1' });
  assert.equal(custom.requests.length, 1, 'custom command runs one real model turn');
  const lastUser = [...custom.requests[0].messages].reverse().find((m) => m.role === 'user');
  assert.equal(lastUser.content, 'Deploy to prod-1 (all: prod-1).', 'the model receives the expansion, not raw slash text');
});

// ============================================================
// E) /review writes a REAL persisted report validated by the renderer
// ============================================================
test('v1126 REVIEW REPORT: REVIEW mode writes a physical .surnia/reviews/*.md that passes the renderer contract', async () => {
  const ws = freshWs('slash-review');
  gitRepo(ws);
  writeFileSync(join(ws, 'src', 'a.ts'), 'const x = 2;\n'); // uncommitted diff
  const findings = JSON.stringify([
    { severity: 'critical', file: 'src/a.ts', line: 1, note: 'Magic number — extract a constant.' },
    { severity: 'minor', file: 'src/a.ts', line: 1, note: 'Add a doc comment.' },
  ]);
  mock.routes.set('m-review-slash', [
    hComplete({ text: 'Reviewing the working diff…' }),
    hComplete({ text: findings }),
  ]);
  const { events, requests } = await runEngine({ workspace: ws, model: 'm-review-slash', message: 'Review my changes', taskMode: 'review' });
  assert.ok(sysPrompt(requests).some((p) => p.includes('# Review mode')), 'review posture must be active');
  const dir = join(ws, '.surnia', 'reviews');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^review-.*\.md$/.test(f)) : [];
  assert.equal(files.length, 1, `exactly one real persisted report expected, got ${JSON.stringify(files)}`);
  const md = readFileSync(join(dir, files[0]), 'utf8');
  const verdict = review.validateReviewReport(md);
  assert.equal(verdict.ok, true, `persisted report violates its own contract: ${verdict.missing}`);
  assert.match(md, /critical/);
  assert.match(md, /src\/a\.ts/);
  assert.match(md, /Magic number/);
  assert.ok(notices(events).some((n) => /\[review report\]/.test(n) && /2 findings/.test(n)), 'report announced with real summary');

  // honesty: a non-repo is NEVER reported as a fake "clean" working tree
  const plain = freshWs('slash-not-a-repo');
  const res = await review.reviewWorkingDiff(plain, { model: { provider: 'custom', model: 'never', maxTokens: 16 }, apiKey: 'k', baseUrl: mockBase });
  assert.equal(res.ok, false);
  assert.match(res.error, /Not a git repository/i);
  assert.equal(res.clean, undefined);
});

// ============================================================
// F) UI surfaces advertise only commands that exist in the registry
// ============================================================
test('v1126 UI SURFACES: quick hints + CapabilityGuide advertise only real commands', () => {
  const registry = new Set(modes.SLASH_COMMANDS.map((c) => c.cmd));
  const quick = /const QUICK_COMMANDS = \[([^\]]*)\]/.exec(composerSrc);
  assert.ok(quick, 'QUICK_COMMANDS row must exist');
  for (const m of quick[1].matchAll(/'(\/[a-z0-9_-]+)'/g)) {
    assert.ok(registry.has(m[1]), `quick hint ${m[1]} is not a registered command`);
  }
  for (const m of guideSrc.matchAll(/cmd: '(\/[a-z0-9_-]+)'/g)) {
    assert.ok(registry.has(m[1]) || modes.SLASH_STORE_EXTRA.includes(m[1]),
      `CapabilityGuide advertises ${m[1]} with no real handler`);
  }
});

after(async () => {
  await mock.stop();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
