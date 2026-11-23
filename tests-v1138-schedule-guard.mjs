// ============================================================
// v11.38 — INDEPENDENT VERIFICATION GUARD for F3
// "SCHEDULED JOBS WORK PROFESSIONALLY"
// ------------------------------------------------------------
// DIAGNOSIS + TEST + DOC ONLY. No app source is edited here.
//
// The guard esbuild-bundles the REAL electron/services/scheduleService.ts,
// runs it against a TEMP userData dir, and drives it with F3's OWN injection
// points: ScheduleClock (now + setInterval capture), runJob (captures the
// exact prompt + supports abort), and proofGate. One job is deliberately run
// through the REAL engine against a LOCAL scripted OpenAI-compatible
// provider (no network) to prove the default production path still works.
//
// The 30s tick callback is CAPTURED from the injected clock and invoked
// directly after moving the fake clock onto a cron slot — that is the exact
// function the production interval would call. No wall-clock sleeping, no
// mocked scheduleService.
//
// Run: node tests-v1138-schedule-guard.mjs
// Exit 0 = all gates PASS, 1 = at least one FAIL.
// ============================================================
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
process.env.SURNIA_NO_BROWSER = '1';
process.env.SURNIA_TURN_RETRY_DELAYS_MS = '8';

const failures = [];
const passes = [];
function check(id, ok, detail) {
  const line = `${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`;
  console.log(line);
  (ok ? passes : failures).push(line);
  return ok;
}
/** Exact file:line of the first live-source line containing `needle`. */
function loc(rel, needle) {
  try {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split(/\r?\n/);
    const i = lines.findIndex((l) => l.includes(needle));
    return `${rel}:${i >= 0 ? i + 1 : '?'}`;
  } catch {
    return `${rel}:?`;
  }
}
const SVC = 'electron/services/scheduleService.ts';
const PANEL = 'src/components/panels/SchedulePanel.tsx';

const realDateNow = Date.now;
async function waitFor(cond, { timeoutMs = 20_000, everyMs = 30, what = 'condition' } = {}) {
  const t0 = realDateNow();
  for (;;) {
    let v = false;
    try { v = cond(); } catch { /* retry */ }
    if (v) return true;
    if (realDateNow() - t0 > timeoutMs) throw new Error(`timeout (${timeoutMs}ms) waiting for ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const localMs = (y, m, d, h, min, s = 0) => new Date(y, m - 1, d, h, min, s, 0).getTime();

// ---------- temp userData + isolated electron stub ----------
const TMP = mkdtempSync(join(tmpdir(), 'sadeem-v1138-sched-'));
const userDataDir = join(TMP, 'userdata');
mkdirSync(userDataDir, { recursive: true });
const stubDir = join(TMP, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `module.exports = {
    app: { getPath: () => ${JSON.stringify(userDataDir)}, whenReady: async () => true, isReady: () => true, on() {}, quit() {} },
    ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
    BrowserWindow: { getAllWindows: () => [] },
    Notification: { isSupported: () => false },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: {}, screen: {}, powerMonitor: { on() {} },
  };`,
);
const CWD_FILES = ['schedules.json', 'schedules-token', 'schedules-ci-fired.json', 'schedules-events.json'];
const cwdBefore = CWD_FILES.map((f) => existsSync(join(ROOT, f)));

// ---------- local scripted OpenAI-compatible provider (REAL engine path) ----------
const mockRequests = [];
const sockets = new Set();
const sse = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
    const userMsg = (body.messages ?? []).find((m) => m.role === 'user');
    mockRequests.push({ model: body.model, prompt: userMsg?.content });
    if (body.model !== 'sched-live') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `UNSCRIPTED model ${body.model}` } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.flushHeaders();
    if (!(body.messages ?? []).some((m) => m.role === 'tool')) {
      const args = JSON.stringify({ path: 'proof-sched.txt', content: 'SCHEDULED-WORK-HAPPENED\n' });
      const half = Math.floor(args.length / 2);
      for (const d of [
        { tool_calls: [{ index: 0, id: 'c1', function: { name: 'write_file', arguments: '' } }] },
        { tool_calls: [{ index: 0, function: { arguments: args.slice(0, half) } }] },
        { tool_calls: [{ index: 0, function: { arguments: args.slice(half) } }] },
      ]) res.write(sse(d));
      res.write(`data: ${JSON.stringify({ usage: { prompt_tokens: 200, completion_tokens: 60 }, choices: [] })}\n\n`);
      res.write(sse({}, 'tool_calls'));
    } else {
      res.write(sse({ role: 'assistant', content: 'PROOF-SCHEDULE-OK: proof-sched.txt written.' }));
      res.write(`data: ${JSON.stringify({ usage: { prompt_tokens: 400, completion_tokens: 15 }, choices: [] })}\n\n`);
      res.write(sse({}, 'stop'));
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

// ---------- bundle the REAL scheduleService.ts once; restart = drop require.cache ----------
const schedPath = join(TMP, 'schedule.bundle.cjs');
let sched = null;
try {
  esbuild.buildSync({
    stdin: { contents: "export * from './electron/services/scheduleService';", resolveDir: ROOT, loader: 'ts', sourcefile: 'v1138-schedule-entry.ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: schedPath, external: ['electron'], logLevel: 'silent',
  });
  sched = require(schedPath);
} catch (err) {
  check('F3-0-BUNDLE', false, `esbuild of the REAL scheduleService.ts failed: ${err?.message ?? err}`);
}
function restartModule() {
  delete require.cache[require.resolve(schedPath)];
  return require(schedPath);
}

// ---------- F3's OWN injected clock: fake `now`, captured real tick callback ----------
let fakeNow = 0;
let tickFn = null;
const testClock = {
  now: () => fakeNow,
  setInterval: (fn, ms) => {
    if (ms === 30_000) { tickFn = fn; return { unref() {} }; }
    return setInterval(fn, ms);
  },
  clearInterval: () => {},
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
};
const setNow = (ts) => { fakeNow = ts; };

// ---------- F3's OWN injected runner: records the exact prompt, can be held/aborted ----------
const runCalls = [];
let holdRuns = false;
const releaseFns = [];
const fakeRunJob = async (opts) => {
  runCalls.push({ prompt: opts.prompt, workspace: opts.workspace, model: opts.model, mode: opts.mode, at: fakeNow });
  if (holdRuns) {
    await new Promise((resolve) => {
      const done = () => { opts.signal?.removeEventListener?.('abort', done); resolve(); };
      opts.signal?.addEventListener?.('abort', done, { once: true });
      releaseFns.push(done);
    });
  }
  const aborted = !!opts.signal?.aborted;
  return {
    ok: !aborted,
    summary: aborted ? 'run aborted' : `FAKE-RUN-OK:${opts.prompt.slice(0, 24)}`,
    sessionId: `sess-${runCalls.length}`,
    costUsd: 0, inputTokens: 0, outputTokens: 0, aborted,
  };
};
const broadcasts = [];
const optsFor = (extra = {}) => ({
  userDataDir,
  clock: testClock,
  broadcast: (p) => broadcasts.push({ ...p, at: fakeNow }),
  ...extra,
});
const persisted = () => {
  try { return JSON.parse(readFileSync(join(userDataDir, 'schedules.json'), 'utf8')); }
  catch { return []; }
};
const events = () => {
  try { return JSON.parse(readFileSync(join(userDataDir, 'schedules-events.json'), 'utf8')); }
  catch { return []; }
};
const PROMPT_A = 'PROVE-F3-FIRE: write proof-sched.txt with SCHEDULED-WORK-HAPPENED using write_file, then reply PROOF-SCHEDULE-OK.';
const PROMPT_B = 'PROVE-F3-CONCURRENCY: exact prompt must reach the run callback.';

const wsA = join(TMP, 'ws-a');
mkdirSync(wsA, { recursive: true });

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const settingsPath = join(userDataDir, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify({
    schemaVersion: 4,
    model: { provider: 'custom', model: '' },
    providers: { custom: { enabled: true, apiKey: 'test-key', baseUrl: `http://127.0.0.1:${server.address().port}` } },
    agent: { maxRetries: 0, autoCompact: false, autoVerify: false, autoMemory: false, criticGate: false },
    dnaEnabled: false, doneNotifications: false,
  }));
  // seed a no-workspace job (never-matching cron so it cannot disturb the real-run test)
  writeFileSync(join(userDataDir, 'schedules.json'), JSON.stringify([{
    id: 'v1138-no-workspace', name: 'No workspace job', prompt: 'must refuse', workspace: '',
    cron: '0 0 1 1 *', enabled: true, mode: 'autoEdit',
    model: { provider: 'custom', model: 'sched-live' }, createdAt: localMs(2026, 3, 10, 10, 0, 0),
  }]));

  console.log('===== F3 GUARD — scheduled jobs work professionally (real service, temp userData, injectable clock) =====');

  // ---------- A0 harness ----------
  const preStatus = sched ? sched.schedulerStatus() : null;
  check('F3-0-HARNESS',
    !!sched && ['initScheduleService', 'addJob', 'runSchedulerTick', 'runNow', 'toggleJob', 'removeJob', 'cancelJob', 'listJobs', 'listEvents', 'schedulerStatus', 'shutdownScheduleService', 'isValidCron', 'computeNextRun'].every((k) => typeof sched[k] === 'function'),
    `real service bundled with clock/runJob/proofGate injection points @ ${loc(SVC, 'export interface ScheduleServiceOptions {')}`);
  if (!sched) return;

  // ---------- A1 honest validation ----------
  const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(String(e?.message ?? e)); } };
  check('F3-1-BAD-CRON',
    throws(() => sched.addJob({ prompt: 'x', workspace: wsA, cron: 'not a cron' }), /INVALID_CRON/) &&
    !sched.isValidCron('61 * * * *') && sched.isValidCron('* * * * *') && sched.isValidCron('@daily'),
    `invalid cron rejected loudly, valid accepted @ ${loc(SVC, "if (!isValidCron(cron)) throw new Error('INVALID_CRON')")}`);
  check('F3-1-NO-WORKSPACE',
    throws(() => sched.addJob({ prompt: 'x', workspace: '', cron: '* * * * *' }), /WORKSPACE_REQUIRED/) &&
    throws(() => sched.addJob({ prompt: 'x', workspace: join(TMP, 'missing'), cron: '* * * * *' }), /WORKSPACE_NOT_FOUND/) &&
    throws(() => sched.addJob({ prompt: '  ', workspace: wsA, cron: '* * * * *' }), /PROMPT_REQUIRED/) &&
    JSON.stringify(sched.runNow('nope')) === JSON.stringify({ ok: false, error: 'JOB_NOT_FOUND' }),
    `empty/missing workspace, empty prompt and unknown id all fail honestly @ ${loc(SVC, "if (!job.workspace) return { ok: false, error: 'NO_WORKSPACE' };")}`);
  check('F3-1-PRE-STATUS', preStatus?.running === false && preStatus?.webhookListening === false && preStatus?.observed === false,
    `before init: running:false, webhookListening:false, observed:false — no fake ACTIVE @ ${loc(SVC, 'running: ticker !== null && !quitting')}`);

  // ---------- A2 REAL ENGINE: does a job actually FIRE when its cron time arrives? ----------
  const T0 = localMs(2026, 3, 10, 10, 29, 0);   // 10:29 local
  const SLOT = localMs(2026, 3, 10, 10, 31, 0); // job's cron = "31 10 * * *"
  setNow(T0);
  sched.initScheduleService(optsFor()); // NO runJob injected → real engine
  check('F3-2-TICK-CAPTURED', typeof tickFn === 'function',
    `the REAL 30s tick callback was captured from the injected clock @ ${loc(SVC, 'ticker = clock().setInterval(tick, TICK_MS)')}`);
  const jobA = sched.addJob({
    name: 'F3 fire proof', prompt: PROMPT_A, workspace: wsA, cron: '31 10 * * *',
    enabled: true, mode: 'autoEdit', model: { provider: 'custom', model: 'sched-live' },
  });
  check('F3-2-CREATED', !!jobA?.id && sched.listJobs().some((j) => j.id === jobA.id) && persisted().some((j) => j.id === jobA.id),
    `addJob landed in memory AND in <userData>/schedules.json @ ${loc(SVC, 'jobs.push(job);')}`);
  // addJob/listJobs return SNAPSHOTS in v11.38 — always re-read live state.
  const viewA = () => sched.listJobs().find((j) => j.id === jobA.id);
  check('F3-2-NEXTRUN-ARMED', viewA().nextRun === SLOT,
    `nextRun persisted at creation = ${new Date(viewA().nextRun).toISOString()} (the real next cron slot) @ ${loc(SVC, 'nextRun: computeNextRun(cron, now)')}`);
  tickFn(); // still 10:29 — cron is 10:31
  check('F3-2-NOT-EARLY', !viewA().lastRun && !broadcasts.some((b) => b.jobId === jobA.id),
    `tick BEFORE the cron minute does not fire (not stored-only, not early) @ ${loc(SVC, 'function dueSlot(')}`);

  setNow(localMs(2026, 3, 10, 10, 31, 10)); // cron slot is now due
  tickFn(); // <-- the exact interval callback
  check('F3-3-FIRE-STATES', viewA().lastStatus === 'running' && viewA().lastRun === localMs(2026, 3, 10, 10, 31, 10) && viewA().lastFireSlot === SLOT,
    `tick on the cron slot stamped lastStatus=running, lastRun and the consumed lastFireSlot @ ${loc(SVC, 'if (slot) job.lastFireSlot = slot;')}`);
  check('F3-3-BROADCAST-RUNNING', broadcasts.some((b) => b.jobId === jobA.id && b.status === 'running'),
    `running broadcast + event emitted for the firing job @ ${loc(SVC, "emitEvent(job, 'running');")}`);
  check('F3-3-NEXTRUN-REARMED', viewA().nextRun === localMs(2026, 3, 11, 10, 31, 0),
    `nextRun re-armed to the NEXT day immediately (countdown never freezes mid-run) @ ${loc(SVC, 'job.nextRun = computeNextRun(job.cron, slot ?? startedAt)')}`);
  await waitFor(() => viewA().lastStatus === 'ok' || viewA().lastStatus === 'error', { what: 'jobA terminal status (real engine)' });
  check('F3-3-TERMINAL-OK', viewA().lastStatus === 'ok' && viewA().runCount === 1 && viewA().consecutiveErrors === 0,
    `the fired job completed through the REAL engine (lastMessage: ${String(viewA().lastMessage).slice(0, 70)}) @ ${loc(SVC, 'job.runCount = (job.runCount ?? 0) + 1;')}`);
  check('F3-3-RUN-CALLBACK-PROMPT', mockRequests.filter((r) => r.prompt === PROMPT_A).length >= 2 && mockRequests.every((r) => r.model === 'sched-live'),
    `the real run callback received the job's EXACT prompt (${mockRequests.filter((r) => r.prompt === PROMPT_A).length} engine round-trips, all on the job model) @ ${loc(SVC, 'prompt: job.prompt,')}`);
  check('F3-3-REAL-WORK', existsSync(join(wsA, 'proof-sched.txt')) && readFileSync(join(wsA, 'proof-sched.txt'), 'utf8') === 'SCHEDULED-WORK-HAPPENED\n',
    `the job that FIRED wrote real bytes in its workspace via runAgent @ ${loc(SVC, 'const runner = opts?.runJob ?? runHeadlessAgent;')}`);
  check('F3-3-BROADCAST-OK', broadcasts.some((b) => b.jobId === jobA.id && b.status === 'ok' && !!b.sessionId) && !!viewA().sessionId,
    `ok broadcast + sessionId recorded; durable event ledger has ok @ ${loc(SVC, "emitEvent(job, finalOk ? 'ok' : 'error'")}`);
  const callsAfterFire = mockRequests.length;
  setNow(localMs(2026, 3, 10, 10, 31, 50)); // same cron minute, after the fire
  tickFn();
  check('F3-3-NO-SAME-MINUTE-REFIRE', mockRequests.length === callsAfterFire && viewA().runCount === 1,
    `a long/second tick in the SAME minute cannot consume the slot twice (lastFireSlot gate) @ ${loc(SVC, 'const lastSlot = intField(job.lastFireSlot)')}`);
  const finalA = viewA();
  sched.shutdownScheduleService();

  // ---------- A4 persistence across a module restart + nextRun + no cwd writes ----------
  const onDisk = persisted().find((j) => j.id === jobA.id);
  const diskEvt = events().find((e) => e.jobId === jobA.id && e.status === 'ok');
  check('F3-4-PERSISTED', !!onDisk && onDisk.lastStatus === 'ok' && onDisk.lastRun === finalA.lastRun && onDisk.lastFireSlot === SLOT && onDisk.nextRun === finalA.nextRun && !!diskEvt,
    `schedules.json + schedules-events.json carry lastRun/lastFireSlot/nextRun/runCount + ok event @ ${loc(SVC, 'persistEvents();')}`);
  check('F3-4-STORE-PATH', sched.schedulerStatus().storePath === join(userDataDir, 'schedules.json') && sched.schedulerStatus().running === false,
    `store path is the injected TEMP userData; after shutdown running:false @ ${loc(SVC, "opts?.userDataDir ?? userDataDirSafe(), 'schedules.json'")}`);
  sched = restartModule();
  setNow(localMs(2026, 3, 10, 12, 0, 0)); // wall clock "moved" while the app was closed
  sched.initScheduleService(optsFor({ runJob: fakeRunJob }));
  const jobA2 = sched.listJobs().find((j) => j.id === jobA.id);
  const expectedNext = sched.computeNextRun('31 10 * * *', localMs(2026, 3, 10, 12, 0, 0));
  check('F3-4-SURVIVES-RESTART', !!jobA2 && jobA2.lastRun === finalA.lastRun && jobA2.lastStatus === 'ok' && jobA2.sessionId === finalA.sessionId && jobA2.runCount === 1,
    `a fresh module instance loaded the same job + run record @ ${loc(SVC, 'jobs = loadJobs();')}`);
  check('F3-4-NEXTRUN-RECOMPUTED', jobA2?.nextRun === expectedNext && expectedNext === localMs(2026, 3, 11, 10, 31, 0),
    `nextRun is DERIVED from the cron on boot (not trusted from disk) @ ${loc(SVC, 'j.nextRun = computeNextRun(j.cron, clock().now())')}`);
  check('F3-4-RUNNING-NOT-LIES', sched.listJobs().every((j) => j.lastStatus !== 'running') && sched.schedulerStatus().observed === true,
    `an interrupted 'running' never survives; observed:true comes from the durable ledger @ ${loc(SVC, "j.lastError = 'interrupted by restart';")}`);

  // the panel's real exported calculator must agree with the service's computeNextRun
  const panel = await (async () => {
    try {
      const out = join(TMP, 'panel-fns.bundle.cjs');
      const stubUi = {
        name: 'stub-ui-deps',
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) =>
            /SchedulePanel\.tsx?$/.test(String(args.importer).replace(/\\/g, '/')) ? { path: args.path, namespace: 'stub-ui' } : undefined);
          build.onLoad({ filter: /.*/, namespace: 'stub-ui' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
        },
      };
      await esbuild.build({
        stdin: { contents: "export { cronNextRun, cronIsValid } from './src/components/panels/SchedulePanel';", resolveDir: ROOT, loader: 'ts', sourcefile: 'v1138-panel-entry.ts' },
        bundle: true, platform: 'node', format: 'cjs', outfile: out, plugins: [stubUi], logLevel: 'silent',
      });
      return require(out);
    } catch (e) { console.log(`  [panel bundle note] ${e?.message ?? e}`); return null; }
  })();
  if (panel) {
    const cases = ['* * * * *', '0 9 * * 1-5', '@daily', '@monthly', '31 10 * * *'];
    const from = localMs(2026, 3, 10, 12, 0, 0);
    check('F3-4-NEXTRUN-UI-MATCH', cases.every((c) => panel.cronNextRun(c, new Date(from)) === sched.computeNextRun(c, from)),
      `the panel's REAL cronNextRun equals the service's computeNextRun for ${cases.length} expressions @ ${loc(PANEL, 'export function cronNextRun(')}`);
    check('F3-4-CRON-VALIDITY-MIRROR',
      [...cases, 'nope', '61 * * * *', '@wat'].every((c) => panel.cronIsValid(c) === sched.isValidCron(c)),
      `panel isValid and service isValidCron agree on valid AND invalid input @ ${loc(PANEL, 'export function cronIsValid(')}`);
  } else {
    check('F3-4-NEXTRUN-UI-MATCH', false, `could not bundle the panel's real cronNextRun @ ${loc(PANEL, 'export function cronNextRun(')}`);
  }
  check('F3-4-NO-CWD-WRITES', cwdBefore.every((was, i) => was === existsSync(join(ROOT, CWD_FILES[i]))),
    `no schedule JSON/token/ledger appeared in process.cwd() (${ROOT}) @ ${loc(SVC, 'return path.join(opts?.userDataDir')}`);

  // ---------- A5 honest no-workspace error (fire-time + API-time) ----------
  sched.shutdownScheduleService();
  writeFileSync(join(userDataDir, 'schedules.json'), JSON.stringify([{
    id: 'v1138-nows-fire', name: 'No workspace (fire)', prompt: 'must fail honestly', workspace: '',
    cron: '* * * * *', enabled: true, mode: 'autoEdit', createdAt: localMs(2026, 3, 10, 13, 0, 0),
  }]));
  sched = restartModule();
  setNow(localMs(2026, 3, 10, 13, 2, 10));
  sched.initScheduleService(optsFor({ runJob: fakeRunJob }));
  const nws = sched.listJobs()[0];
  check('F3-5-API-HONEST', JSON.stringify(sched.runNow(nws.id)) === JSON.stringify({ ok: false, error: 'NO_WORKSPACE' }) && runCalls.length === 0,
    `runNow refuses a workspace-less job with NO_WORKSPACE (no fake run) @ ${loc(SVC, "if (!job.workspace) return { ok: false, error: 'NO_WORKSPACE' };")}`);
  check('F3-5-TICK-DUE', sched.runSchedulerTick() === 1,
    `the same job is still due on the real scheduler tick @ ${loc(SVC, 'export function runSchedulerTick(')}`);
  await waitFor(() => sched.listJobs()[0]?.lastStatus === 'error', { what: 'no-workspace fire error' });
  const nws2 = sched.listJobs()[0];
  check('F3-5-FIRE-HONEST', nws2.lastMessage === 'no workspace configured' && nws2.lastError === 'no workspace configured' && broadcasts.some((b) => b.jobId === nws.id && b.status === 'error'),
    `fire with no workspace stores the exact honest reason + error broadcast @ ${loc(SVC, "const reason = 'no workspace configured';")}`);
  sched.removeJob(nws.id);

  // ---------- A6 concurrency: no double-fire, anti-stacking, pause, cancel, abort ----------
  const T1 = localMs(2026, 3, 10, 15, 0, 0);
  setNow(T1);
  const jobB = sched.addJob({ name: 'F3 concurrency', prompt: PROMPT_B, workspace: wsA, cron: '* * * * *', enabled: true, mode: 'autoEdit', model: { provider: 'custom', model: 'sched-live' } });
  const viewB = () => sched.listJobs().find((j) => j.id === jobB.id);
  holdRuns = true;
  setNow(localMs(2026, 3, 10, 15, 2, 10));
  tickFn();
  await waitFor(() => runCalls.some((c) => c.prompt === PROMPT_B) && viewB().lastStatus === 'running', { what: 'held in-flight run' });
  check('F3-6-RUN-CALLBACK-INJECTED', runCalls.filter((c) => c.prompt === PROMPT_B).length === 1 && runCalls.find((c) => c.prompt === PROMPT_B).workspace === jobB.workspace,
    `the injected runJob received the EXACT prompt + workspace from the firing job @ ${loc(SVC, 'const runner = opts?.runJob ?? runHeadlessAgent;')}`);
  const before = runCalls.length;
  tickFn();                        // interval fires again mid-run
  const dueAgain = sched.runSchedulerTick();
  const again = sched.runNow(jobB.id);
  check('F3-6-NO-DOUBLE-FIRE',
    again.ok === false && again.error === 'ALREADY_RUNNING' && dueAgain === 0 && runCalls.length === before &&
    sched.schedulerStatus().inFlight === 1 && broadcasts.filter((b) => b.jobId === jobB.id && b.status === 'running').length === 1,
    `tick / runSchedulerTick / runNow cannot double-fire a running job @ ${loc(SVC, 'if (!job || firing.has(jobId) || quitting) return;')}`);
  releaseFns.shift()?.();
  await waitFor(() => viewB().lastStatus === 'ok' || viewB().lastStatus === 'error', { what: 'held run terminal' });
  check('F3-6-FINISH-ONCE', viewB().lastStatus === 'ok' && viewB().runCount === 1 && broadcasts.filter((b) => b.jobId === jobB.id && b.status === 'ok').length === 1,
    `the in-flight run finishes exactly once @ ${loc(SVC, 'firing.delete(jobId);')}`);

  // cancelJob aborts an in-flight run by jobId
  holdRuns = true;
  setNow(localMs(2026, 3, 10, 15, 5, 10));
  tickFn();
  await waitFor(() => sched.schedulerStatus().inFlight === 1, { what: 'cancellable in-flight run' });
  check('F3-6-CANCEL-JOB', sched.cancelJob(jobB.id) === true,
    `cancelJob(id) aborts the run that is actually in flight @ ${loc(SVC, 'export function cancelJob(')}`);
  await waitFor(() => viewB().lastStatus === 'error', { what: 'cancelled run terminal' });
  check('F3-6-CANCEL-ABORTED', viewB().lastMessage === 'run aborted',
    `the cancelled run ends aborted, not fake-ok @ ${loc(SVC, 'c.abort();')}`);

  // pause also cancels an in-flight run
  holdRuns = true;
  setNow(localMs(2026, 3, 10, 15, 6, 10));
  tickFn();
  await waitFor(() => sched.schedulerStatus().inFlight === 1, { what: 'pausable in-flight run' });
  check('F3-6-PAUSE-CANCELS-INFLIGHT', sched.toggleJob(jobB.id, false)?.enabled === false,
    `toggleJob(false) cancels the in-flight run via cancelJob @ ${loc(SVC, 'if (!job.enabled) cancelJob(id);')}`);
  await waitFor(() => viewB().lastStatus === 'error', { what: 'paused run aborted' });
  check('F3-6-PAUSE-ABORTED', viewB().lastMessage === 'run aborted',
    `the paused run ends aborted, not fake-ok @ ${loc(SVC, 'if (!job.enabled) cancelJob(id);')}`);

  // paused job stays dormant even when its slot is due
  const beforePause = runCalls.length;
  const lastRunAtPause = viewB().lastRun;
  setNow(localMs(2026, 3, 10, 15, 7, 10));
  tickFn();
  check('F3-6-PAUSE-DORMANT', runCalls.length === beforePause && viewB().lastRun === lastRunAtPause,
    `a paused job does not fire on a due slot @ ${loc(SVC, 'if (!job.enabled || firing.has(job.id)) continue;')}`);
  holdRuns = false;
  sched.toggleJob(jobB.id, true);
  setNow(localMs(2026, 3, 10, 15, 9, 10));
  check('F3-6-RESUME', sched.runSchedulerTick() >= 1 && runCalls.length > beforePause,
    `toggleJob(true) re-arms the job @ ${loc(SVC, 'export function toggleJob(')}`);
  await waitFor(() => sched.schedulerStatus().inFlight === 0, { what: 'resumed run done' });
  sched.removeJob(jobB.id);
  const beforeCancel = runCalls.length;
  setNow(localMs(2026, 3, 10, 15, 11, 10));
  tickFn();
  check('F3-6-CANCEL', !sched.listJobs().some((j) => j.id === jobB.id) && !persisted().some((j) => j.id === jobB.id) && runCalls.length === beforeCancel,
    `removeJob cancels in memory AND on disk; no further fires @ ${loc(SVC, 'cancelJob(id); // abort an in-flight run before removing the job')}`);

  // shutdown aborts an in-flight run
  holdRuns = true;
  const jobC = sched.addJob({ name: 'F3 abort', prompt: 'ABORT-ME', workspace: wsA, cron: '* * * * *', enabled: true, mode: 'autoEdit' });
  const viewC = () => sched.listJobs().find((j) => j.id === jobC.id);
  setNow(localMs(2026, 3, 10, 15, 13, 10));
  tickFn();
  await waitFor(() => sched.schedulerStatus().inFlight === 1, { what: 'abort candidate in flight' });
  sched.shutdownScheduleService();
  await waitFor(() => viewC().lastStatus === 'error', { what: 'aborted run terminal' });
  check('F3-6-ABORT-ON-SHUTDOWN', viewC().lastStatus === 'error' && viewC().lastMessage === 'run aborted' && sched.schedulerStatus().running === false,
    `shutdown aborts in-flight runs; no success after quit @ ${loc(SVC, 'for (const c of runControllers.values())')}`);

  // ---------- A7 UI: source-level honesty (the panel consumes real emitted state) ----------
  const panelSrc = readFileSync(join(ROOT, PANEL), 'utf8');
  check('F3-7-UI-POLLS', /setInterval\(\(\) => void loadJobs\(\), 5_000\)/.test(panelSrc),
    `SchedulePanel re-polls the real scheduleList every 5s @ ${loc(PANEL, 'window.setInterval(() => void loadJobs(), 5_000)')}`);
  check('F3-7-UI-EVENTS', /const latestEvent = jobViews\.reduce/.test(panelSrc) && /j\.lastEvent/.test(panelSrc) && /e\.seq > best\.seq/.test(panelSrc),
    `the panel consumes the service's real lastEvent ledger (no invented feed) @ ${loc(PANEL, 'const latestEvent = jobViews.reduce')}`);
  check('F3-7-UI-OBSERVED', /const clockState: 'unavailable' \| 'observed' \| 'unverified'/.test(panelSrc) && /j\.lastEvent/.test(panelSrc) && /data-clock-state=\{clockState\}/.test(panelSrc),
    `clock state derives from an OBSERVED real run/event @ ${loc(PANEL, "const clockState: 'unavailable'")}`);
  check('F3-7-UI-NO-FAKE-ACTIVE', /CLOCK UNVERIFIED/.test(panelSrc) && /SCHEDULER UNAVAILABLE/.test(panelSrc) && /CLOCK OBSERVED/.test(panelSrc) && !/clockState\s*===\s*'active'/.test(panelSrc),
    `the global clock says UNVERIFIED / UNAVAILABLE / OBSERVED — never fake ACTIVE @ ${loc(PANEL, "t('sch.clock.unverified'")}`);
  check('F3-7-UI-VERIFY-LANDING', /const landed = async/.test(panelSrc) && /Could not create the job — nothing was saved/.test(panelSrc),
    `create re-reads the list before claiming success @ ${loc(PANEL, 'const landed = async ()')}`);
  check('F3-7-UI-CANCEL-BRIDGE', /bridgeCancelOk/.test(panelSrc) && /scheduleCancel/.test(panelSrc),
    `the cancel control is only rendered when a real bridge exists @ ${loc(PANEL, 'const bridgeCancelOk = typeof cancelBridge')}`);

  // ---------- A8 webhook honesty + final cwd check ----------
  const blocker = http.createServer((_q, r) => r.writeHead(200).end());
  await new Promise((r) => blocker.listen(7682, '127.0.0.1', r));
  sched.stopWebhookListener();
  const wh = sched.startWebhookListener(7682);
  await sleep(300); // listen() errors are async
  const whStatus = sched.schedulerStatus();
  check('F3-8-WEBHOOK-HONEST', wh.ok === true && whStatus.webhookListening === false && whStatus.webhookPort === null && typeof whStatus.webhookError === 'string' && whStatus.webhookError.length > 0,
    `a busy port is reported honestly (webhookListening:false + webhookError), never a fake READY @ ${loc(SVC, 'webhookError = err.message;')}`);
  await new Promise((r) => blocker.close(r));
  sched.stopWebhookListener();
  check('F3-8-NO-CWD-FINAL', cwdBefore.every((was, i) => was === existsSync(join(ROOT, CWD_FILES[i]))),
    `still no schedule files in process.cwd() after every test @ ${loc(SVC, 'function userDataDirSafe(): string {')}`);

  // ---------- summary ----------
  for (const s of sockets) s.destroy();
  await new Promise((r) => server.close(r));
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* gone */ }
  console.log(`\n===== F3 GUARD SUMMARY: ${failures.length ? 'FAIL' : 'PASS'} — ${passes.length} passed, ${failures.length} failed =====`);
  for (const f of failures) console.log('  ' + f);
  process.exitCode = failures.length ? 1 : 0;
}

main().catch((err) => {
  console.error('F3 GUARD CRASHED:', err);
  for (const s of sockets) s.destroy();
  try { server.close(); } catch { /* gone */ }
  process.exitCode = 1;
});
