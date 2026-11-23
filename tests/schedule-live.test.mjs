import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// A11-LIVE — SCHEDULED JOBS: DIRECT end-to-end test (no mocks of the
// service under test — only the LLM provider is a local scripted mock).
//
// What a scheduled job IS (electron/services/scheduleService.ts): a
// persisted cron job that runs the agent HEADLESS on a timer — the run
// goes through the REAL engine path (runHeadlessAgent → runAgent),
// approvals auto-DENIED, summary/usage recorded on the job, status
// broadcast as kdx:schedule-event, and schedules.json persisted.
//
// Proven here, against the REAL scheduler:
//   1. A job loaded from schedules.json (backdated) is DUE on the first
//      runSchedulerTick() → the engine really runs (writes a file via
//      the mock provider) → the job's run record (lastStatus/lastRun/
//      lastMessage/sessionId) shows success, the broadcast fired
//      running→ok, and schedules.json on disk was updated.
//   2. The REAL 30s ticker (setInterval, no manual tick) fires a job
//      created with addJob() whose '* * * * *' cron becomes eligible on
//      the next minute boundary — live wall-clock proof.
//   3. runHeadlessAgent directly: fail-clean with 'no model configured'
//      when NO model exists anywhere; success + summary + usage when a
//      model IS bound (the provider-binding contract).
//   4. addJob validation (PROMPT_REQUIRED / WORKSPACE_REQUIRED /
//      INVALID_CRON / WORKSPACE_NOT_FOUND), toggleJob, removeJob.
//   5. Webhook trigger: POST /trigger/<jobId>?token=… fires the job
//      through the loopback listener (skipped if the port is busy).
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { connect } from 'node:net';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-sched-live-'));

process.env.SURNIA_TURN_RETRY_DELAYS_MS = '8';

// ---------- esbuild bundle (same posture as the v1111 harness) ----------
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

// electron stub with an ISOLATED userData dir (schedules.json lives here)
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
    safeStorage: { isEncryptionAvailable: () => false },
    shell: {},
    screen: {},
    powerMonitor: { on() {} },
  };`,
);

// ---------- mock OpenAI-compatible provider (local, scripted) ----------
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

const mockRequests = []; // { model } — provider-binding evidence
const sockets = new Set();
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
    mockRequests.push({ model: body.model, at: Date.now() });
    sseHeaders(res);
    if (body.model === 'sched-live') {
      const sawToolResult = (body.messages ?? []).some((m) => m.role === 'tool');
      if (!sawToolResult) {
        // headless auto-edit posture: a NEW file needs no prior read
        const args = JSON.stringify({ path: 'proof-sched.txt', content: 'SCHEDULED-WORK-HAPPENED\n' });
        for (const d of toolDeltas('write_file', args, 'call_s1')) res.write(sseChunk(d));
        finishSse(res, 'tool_calls', { prompt_tokens: 200, completion_tokens: 60 });
      } else {
        res.write(sseChunk({ role: 'assistant', content: 'PROOF-SCHEDULE-OK: proof-sched.txt written.' }));
        finishSse(res, 'stop', { prompt_tokens: 400, completion_tokens: 15 });
      }
    } else {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `UNSCRIPTED model ${body.model}` } }));
      return;
    }
  });
});
server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
const listening = new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const mockBase = `http://127.0.0.1:${await listening}`;
after(async () => {
  for (const s of sockets) s.destroy();
  await new Promise((r) => server.close(r));
});

// ---------- settings: provider bound to the mock, NO default model
// (jobs carry their own model; the empty settings.model exercises the
// honest 'no model configured' fail-clean path in test 3) ----------
writeFileSync(
  join(userDataDir, 'settings.json'),
  JSON.stringify({
    schemaVersion: 4,
    model: { provider: 'custom', model: '' },
    providers: { custom: { enabled: true, apiKey: 'test-key', baseUrl: mockBase } },
    agent: { maxRetries: 0, autoCompact: false, autoVerify: false, autoMemory: false, criticGate: false },
    dnaEnabled: false,
    doneNotifications: false,
  }),
);

const schedPath = join(tmp, 'schedule.cjs');
bundle('electron/services/scheduleService.ts', schedPath);
const sched = require(schedPath);

// ---------- workspaces (no package.json → no proof gate, 'no-suite') ----------
const ws1 = mkdtempSync(join(tmpdir(), 'surnia-sched-ws1-'));
const ws2 = mkdtempSync(join(tmpdir(), 'surnia-sched-ws2-'));
const ws3 = mkdtempSync(join(tmpdir(), 'surnia-sched-ws3-'));
after(() => {
  for (const ws of [ws1, ws2, ws3]) { try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ } }
});

// ---------- seed schedules.json with a BACKDATED job BEFORE init ----------
const JOB1_ID = 'job-live-1';
const seededAt = Date.now() - 5 * 60_000; // 5 minutes ago → a '* * * * *' slot already exists
writeFileSync(
  join(userDataDir, 'schedules.json'),
  JSON.stringify([
    {
      id: JOB1_ID,
      name: 'Backdated proof job',
      prompt: 'Create proof-sched.txt with content SCHEDULED-WORK-HAPPENED using write_file, then reply PROOF-SCHEDULE-OK.',
      workspace: ws1,
      cron: '* * * * *',
      enabled: true,
      mode: 'autoEdit',
      model: { provider: 'custom', model: 'sched-live' },
      createdAt: seededAt,
    },
  ]),
);

// ---------- init the REAL scheduler (30s ticker + loopback webhook listener) ----------
const broadcasts = [];
sched.initScheduleService({
  userDataDir,
  broadcast: (payload) => broadcasts.push({ ...payload, at: Date.now() }),
});
after(() => {
  sched.shutdownScheduleService();
});

async function waitFor(cond, { timeoutMs = 30_000, everyMs = 250, what = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = cond(); } catch { v = false; }
    if (v) return Date.now() - t0;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout (${timeoutMs}ms) waiting for ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

const persistedJobs = () => {
  try { return JSON.parse(readFileSync(join(userDataDir, 'schedules.json'), 'utf8')); }
  catch { return []; }
};

// ============================================================
// 1. DUE JOB FIRES ON THE TICK → RUN RECORD SHOWS SUCCESS
// ============================================================
test('schedule live: backdated persisted job fires on runSchedulerTick — run recorded ok + persisted', async () => {
  const due = sched.runSchedulerTick();
  assert.equal(due, 1, 'exactly one seeded job is due on the first tick');

  const job = sched.listJobs().find((j) => j.id === JOB1_ID);
  assert.ok(job, 'the seeded job loaded from schedules.json');

  // the headless run really happens (engine → mock provider → tool → text)
  await waitFor(() => job.lastStatus === 'ok' || job.lastStatus === 'error', {
    timeoutMs: 45_000, everyMs: 200, what: 'job1 terminal status',
  });
  assert.equal(job.lastStatus, 'ok', `job ran ok (lastMessage: ${job.lastMessage})`);
  assert.ok(typeof job.lastRun === 'number' && job.lastRun > seededAt, 'lastRun stamped');
  assert.ok(String(job.lastMessage ?? '').includes('PROOF-SCHEDULE-OK'), `summary recorded (${job.lastMessage})`);
  assert.ok(job.sessionId, 'sessionId recorded on the job');
  assert.ok(existsSync(join(ws1, 'proof-sched.txt')), 'the headless run actually wrote its file in the job workspace');
  assert.equal(readFileSync(join(ws1, 'proof-sched.txt'), 'utf8'), 'SCHEDULED-WORK-HAPPENED\n');

  // broadcast lifecycle: running → ok for THIS job
  const mine = broadcasts.filter((b) => b.jobId === JOB1_ID);
  assert.ok(mine.some((b) => b.status === 'running'), 'broadcast: running');
  assert.ok(mine.some((b) => b.status === 'ok'), 'broadcast: ok');

  // persistence: the on-disk store carries the run record
  const onDisk = persistedJobs().find((j) => j.id === JOB1_ID);
  assert.equal(onDisk.lastStatus, 'ok', 'schedules.json updated with lastStatus ok');
  assert.ok(typeof onDisk.lastRun === 'number' && onDisk.lastRun > seededAt, 'schedules.json updated with lastRun');

  // provider binding: the engine really used the job's configured model
  assert.ok(mockRequests.length >= 2, 'headless run made provider round-trips');
  assert.ok(mockRequests.every((r) => r.model === 'sched-live'), 'every request used the job model');

  // stop the recurring job so the live-ticker test below is undisturbed
  // (this also proves toggleJob)
  const toggled = sched.toggleJob(JOB1_ID, false);
  assert.equal(toggled.enabled, false, 'toggleJob disabled the job');
});

// ============================================================
// 2. REAL 30s TICKER FIRES A NEW JOB ON ITS FIRST CRON SLOT
//    (live wall clock — no manual tick is called in this test)
// ============================================================
test('schedule live: addJob with an every-minute cron fires via the REAL 30s ticker', async () => {
  const before = mockRequests.length;
  const job2 = sched.addJob({
    name: 'Live ticker job',
    prompt: 'Create proof-sched.txt with content SCHEDULED-WORK-HAPPENED using write_file, then reply PROOF-SCHEDULE-OK.',
    workspace: ws2,
    cron: '* * * * *',
    enabled: true,
    mode: 'autoEdit',
    model: { provider: 'custom', model: 'sched-live' },
  });
  assert.ok(job2.id, 'addJob returned the persisted job');

  // eligibility: the first cron slot STRICTLY after createdAt+60s; then the
  // 30s ticker must notice it. Deadline covers boundary + tick phase + run.
  const now = Date.now();
  const firstSlot = Math.ceil((now + 60_000) / 60_000) * 60_000;
  // v11.26 — under a 1600-test parallel run the 30s ticker + headless run can
  // miss a 55s margin; keep the real wall-clock ticker but widen the deadline.
  const budget = firstSlot - now + 150_000;

  await waitFor(() => job2.lastStatus === 'ok' || job2.lastStatus === 'error', {
    timeoutMs: budget, everyMs: 500, what: 'job2 terminal status (real ticker)',
  });
  assert.equal(job2.lastStatus, 'ok', `real ticker fired the job (lastMessage: ${job2.lastMessage})`);
  assert.ok(String(job2.lastMessage ?? '').includes('PROOF-SCHEDULE-OK'), 'run summary recorded');
  assert.ok(existsSync(join(ws2, 'proof-sched.txt')), 'the ticked run wrote its file');
  assert.ok(mockRequests.length > before, 'the ticker-driven run reached the provider');
  const mine = broadcasts.filter((b) => b.jobId === job2.id);
  assert.ok(mine.some((b) => b.status === 'running') && mine.some((b) => b.status === 'ok'), 'broadcast running→ok for the ticked job');
});

// ============================================================
// 3. runHeadlessAgent DIRECT: fail-clean without a model; success with one
// ============================================================
test('schedule live: runHeadlessAgent — "no model configured" when nothing is bound; success + usage when bound', async () => {
  // negative: settings.model is EMPTY (seeded above) and no explicit model
  const none = await sched.runHeadlessAgent({ prompt: 'noop', workspace: ws3 });
  assert.equal(none.ok, false);
  assert.equal(none.error, 'no model configured', 'fail-clean message when no model is bound anywhere');

  // positive: an explicit model bound to the local mock provider
  const r = await sched.runHeadlessAgent({
    prompt: 'Create proof-sched.txt with content SCHEDULED-WORK-HAPPENED using write_file, then reply PROOF-SCHEDULE-OK.',
    workspace: ws3,
    model: { provider: 'custom', model: 'sched-live' },
    mode: 'autoEdit',
  });
  assert.equal(r.ok, true, `headless run ok (error: ${r.error ?? 'none'})`);
  assert.ok(r.summary.includes('PROOF-SCHEDULE-OK'), `summary captured (${r.summary})`);
  assert.ok(r.sessionId, 'sessionId returned');
  assert.ok(r.inputTokens > 0, 'usage accounted (inputTokens)');
  assert.ok(r.costUsd >= 0, 'cost accounted');
  assert.ok(existsSync(join(ws3, 'proof-sched.txt')), 'the direct headless run wrote its file');
});

// ============================================================
// 4. addJob VALIDATION + REMOVE (records never half-exist)
// ============================================================
test('schedule live: addJob validation errors and removeJob', () => {
  assert.throws(() => sched.addJob({ prompt: '  ', workspace: ws3, cron: '* * * * *' }), /PROMPT_REQUIRED/);
  assert.throws(() => sched.addJob({ prompt: 'x', workspace: '', cron: '* * * * *' }), /WORKSPACE_REQUIRED/);
  assert.throws(() => sched.addJob({ prompt: 'x', workspace: ws3, cron: 'not a cron' }), /INVALID_CRON/);
  assert.throws(() => sched.addJob({ prompt: 'x', workspace: join(ws3, 'missing-dir'), cron: '* * * * *' }), /WORKSPACE_NOT_FOUND/);

  const j = sched.addJob({ name: 'Doomed job', prompt: 'noop', workspace: ws3, cron: '0 12 * * 1', model: { provider: 'custom', model: 'sched-live' } });
  assert.ok(sched.listJobs().some((x) => x.id === j.id), 'valid job listed');
  assert.equal(sched.removeJob(j.id), true, 'removeJob removed it');
  assert.equal(sched.removeJob(j.id), false, 'second remove is a no-op');
  assert.ok(!sched.listJobs().some((x) => x.id === j.id), 'gone from the list');
  assert.ok(!persistedJobs().some((x) => x.id === j.id), 'gone from schedules.json');
});

// ============================================================
// 5. WEBHOOK TRIGGER: POST /trigger/<jobId>?token=… FIRES THE JOB
// ============================================================
test('schedule live: webhook trigger fires the job through the loopback listener', async (t) => {
  // If another process (the running desktop app, another CI lane) already owns
  // 7681, our initScheduleService degraded to webhook-less. Talking to that
  // other listener with our token yields a misleading 403 — skip honestly.
  const portBusy = await new Promise((resolve) => {
    const sock = connect(7681, '127.0.0.1');
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => { sock.destroy(); resolve(false); });
  });
  if (portBusy) return t.skip('webhook port 7681 already in use by another process');
  // the listener started with initScheduleService on 127.0.0.1:7681; if the
  // port was busy (another CI lane), the scheduler degraded to webhook-less
  // and this test reports SKIP instead of pretending.
  let token = '';
  try { token = readFileSync(join(userDataDir, 'schedules-token'), 'utf8').trim(); } catch { token = ''; }
  assert.ok(token, 'webhook token file exists (schedules-token, 0600)');

  const j = sched.addJob({
    name: 'Webhook job',
    prompt: 'Create proof-sched.txt with content SCHEDULED-WORK-HAPPENED using write_file, then reply PROOF-SCHEDULE-OK.',
    workspace: ws3,
    cron: '0 0 31 2 1', // never matches a real date — ONLY the webhook fires it
    enabled: true,
    mode: 'autoEdit',
    model: { provider: 'custom', model: 'sched-live' },
  });

  const post = () =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: 7681, path: `/trigger/${encodeURIComponent(j.id)}?token=${encodeURIComponent(token)}`, method: 'POST' },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode, body }));
        },
      );
      req.on('error', reject);
      req.end();
    });

  let res;
  try {
    res = await post();
  } catch (err) {
    t.skip(`webhook listener not reachable (port busy in CI?): ${err.code ?? err.message}`);
    return;
  }
  assert.equal(res.status, 200, 'trigger accepted');
  assert.ok(res.body.includes('accepted'), `body ack (${res.body})`);

  // bad token must be REJECTED
  const bad = await new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: 7681, path: `/trigger/${encodeURIComponent(j.id)}?token=WRONG`, method: 'POST' },
      (r2) => { r2.resume(); r2.on('end', () => resolve(r2.statusCode)); },
    );
    req.on('error', () => resolve(-1));
    req.end();
  });
  assert.equal(bad, 403, 'wrong token → 403');

  await waitFor(() => j.lastStatus === 'ok' || j.lastStatus === 'error', {
    timeoutMs: 45_000, everyMs: 250, what: 'webhook job terminal status',
  });
  assert.equal(j.lastStatus, 'ok', `webhook-fired run recorded ok (${j.lastMessage})`);
  assert.ok(existsSync(join(ws3, 'proof-sched.txt')), 'webhook run wrote its file');
  sched.removeJob(j.id);
});
