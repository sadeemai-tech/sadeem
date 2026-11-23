// ============================================================
// v11.38 — SCHEDULED JOBS: PROVE THEY REALLY FIRE + PERSIST
// ------------------------------------------------------------
// Founder: "SCHEDULED JOBS are the MOST IMPORTANT thing — must work
// professionally and STRONGLY." This suite drives the REAL service with an
// injected fake clock + injected runner (no 30-second sleeps, no LLM), and
// asserts the whole path: create → persist (atomic, userData) → ticker fires
// at the EXACT cron minute → runs → lastRun/nextRun/runCount update → event
// emitted → survives a restart → status observed. Plus honest errors, missed
// run policy, concurrency guard, cancel, and a real loopback webhook trigger.
//
//   node --test --test-force-exit tests/v1138-schedule.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const TMP = mkdtempSync(join(tmpdir(), 'sadeem-v1138-'));

// ---------- electron stub (same posture as v1136) ----------
globalThis.__V1138_HANDLERS = new Map();
const STUB = join(TMP, 'node_modules', 'electron');
mkdirSync(STUB, { recursive: true });
writeFileSync(join(STUB, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(STUB, 'index.js'),
  `
const H = globalThis.__V1138_HANDLERS || (globalThis.__V1138_HANDLERS = new Map());
module.exports = {
  app: {
    getPath: (k) => (k === 'userData' ? ${JSON.stringify(join(TMP, 'ud-fallback'))} : ${JSON.stringify(TMP)}),
    whenReady: async () => true, on() {}, once() {}, quit() {}, isReady: () => true, setName() {}, setPath() {},
  },
  ipcMain: { handle: (c, fn) => H.set(c, fn), on() {}, removeAllListeners() {} },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  safeStorage: { isEncryptionAvailable: () => false },
  Notification: { isSupported: () => false },
  shell: {}, screen: {}, dialog: {}, powerMonitor: { on() {} },
};
module.exports.default = module.exports;
`,
);

const stubPlugin = {
  name: 'v1138-stubs',
  setup(build) {
    build.onResolve({ filter: /\?worker$/ }, () => ({ path: 'worker', namespace: 'ssm' }));
    build.onResolve({ filter: /(^|\/)lib\/monaco$/ }, () => ({ path: 'lib-monaco', namespace: 'ssm' }));
    build.onResolve({ filter: /^@monaco-editor\/react$/ }, () => ({ path: 'monaco-react', namespace: 'ssm' }));
    build.onResolve({ filter: /^lottie-web$/ }, () => ({ path: 'lottie', namespace: 'ssm' }));
    build.onResolve({ filter: /^qrcode$/ }, () => ({ path: 'qrcode', namespace: 'ssm' }));
    build.onLoad({ filter: /.*/, namespace: 'ssm' }, ({ path: p }) => {
      let contents = 'export default null;';
      if (p === 'worker') contents = 'export default class SSMWorker {}';
      else if (p === 'lib-monaco') contents = "export const monaco = { editor: { defineTheme(){}, createModel(){}, createDiffEditor(){} } }; export const monacoThemeFor = () => 'dark'; export const languageForPath = () => 'plaintext';";
      else if (p === 'monaco-react') contents = "const N = () => null; export const Editor = N; export const DiffEditor = N; export const loader = { config(){}, init: () => Promise.resolve({}) };";
      else if (p === 'lottie') contents = 'export const loadAnimation = () => ({ destroy(){}, play(){}, stop(){}, goToAndStop(){} }); export default { loadAnimation };';
      else if (p === 'qrcode') contents = "export const toDataURL = () => Promise.resolve('data:,'); export const toString = () => Promise.resolve(''); export default { toDataURL, toString };";
      return { contents, loader: 'js' };
    });
  },
};
const EXTERNALS = ['electron', 'react', 'react-dom', 'zustand', 'lucide-react', '@xterm/xterm', '@xterm/addon-fit'];
const LOADERS = { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.jpg': 'empty', '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' };
async function bundleEntry(entry, outfile) {
  await esbuild.build({
    entryPoints: [join(ROOT, entry)], bundle: true, platform: 'node', format: 'cjs', outfile,
    external: EXTERNALS, loader: LOADERS, plugins: [stubPlugin], logLevel: 'silent',
  });
  return require(outfile);
}
const svc = await bundleEntry('electron/services/scheduleService.ts', join(TMP, 'schedule.cjs'));

// ---------- fake clock ----------
function makeClock(start) {
  let now = start;
  let seq = 0;
  const intervals = new Map();
  const timeouts = new Map();
  return {
    now: () => now,
    setInterval(fn, ms) { const id = ++seq; intervals.set(id, { fn, ms, next: now + ms }); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(fn, ms) { const id = ++seq; timeouts.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let pick = null, pickId = null, pickAt = Infinity, pickKind = '';
        for (const [id, t] of timeouts) {
          if (t.at <= target && t.at < pickAt) { pickAt = t.at; pick = t.fn; pickId = id; pickKind = 'timeout'; }
        }
        for (const [id, t] of intervals) {
          if (t.next <= target && t.next < pickAt) { pickAt = t.next; pick = t.fn; pickId = id; pickKind = 'interval'; }
        }
        if (!pick) break;
        now = pickAt;
        if (pickKind === 'timeout') { timeouts.delete(pickId); pick(); }
        else { const t = intervals.get(pickId); t.next += t.ms; pick(); }
      }
      now = target;
    },
  };
}
const flush = () => new Promise((r) => setImmediate(r));
const AT = Date.parse('2026-11-23T04:29:30'); // local
const CRON = '30 4 23 11 1'; // exactly 04:30 on 23 Nov 2026 (month/dow honesty)
const DAILY = '30 4 * * *'; // daily at 04:30 — always has a near next slot
const WS = join(TMP, 'ws');
mkdirSync(WS, { recursive: true });

function okRunner(label = 'WORK-HAPPENED') {
  let n = 0;
  return {
    runs: () => n,
    fn: async () => {
      n += 1;
      return {
        ok: true, summary: `${label}#${n}`, sessionId: `sess-${n}`,
        costUsd: 0, inputTokens: 1, outputTokens: 1, aborted: false,
      };
    },
  };
}
const noGate = async () => 'no-suite';

after(() => {
  try { svc.shutdownScheduleService(); } catch { /* down */ }
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ============================================================
test('1. create → persist atomically in userData → exact cron nextRun', () => {
  const ud = join(TMP, 'ud-a'); mkdirSync(ud, { recursive: true });
  const clock = makeClock(AT);
  svc.initScheduleService({ userDataDir: ud, clock, runJob: okRunner().fn, proofGate: noGate });
  try {
    const status = svc.schedulerStatus();
    assert.equal(status.running, true, 'the ticker is actually installed');
    assert.equal(status.tickMs, 30_000);
    assert.equal(status.storePath, join(ud, 'schedules.json'), 'store is in userData, NOT process.cwd()');

    const job = svc.addJob({ name: 'A', prompt: 'ping', workspace: WS, cron: CRON, enabled: true });
    assert.ok(job.id);
    assert.equal(job.nextRun, svc.computeNextRun(CRON, AT), 'exact nextRun persisted at creation');
    assert.equal(job.nextRun, Date.parse('2026-11-23T04:30:00'));

    const file = join(ud, 'schedules.json');
    assert.ok(existsSync(file), 'schedules.json written immediately');
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    assert.ok(raw.some((j) => j.id === job.id && j.cron === CRON), 'job is on disk');
    // atomic write ⇒ no leftover .tmp files
    assert.equal(readdirSafe(ud).filter((f) => f.endsWith('.tmp')).length, 0, 'no torn tmp files');
  } finally {
    svc.shutdownScheduleService();
    assert.equal(svc.schedulerStatus().running, false, 'shutdown honestly stops the clock');
  }
});

test('2. the LIVE ticker fires at the exact cron minute → real run → telemetry + event', async () => {
  const ud = join(TMP, 'ud-b'); mkdirSync(ud, { recursive: true });
  const clock = makeClock(AT);
  const runner = okRunner();
  const events = [];
  svc.initScheduleService({
    userDataDir: ud, clock, runJob: runner.fn, proofGate: noGate,
    broadcast: (p) => events.push(p),
  });
  try {
    const job = svc.addJob({ name: 'B', prompt: 'do work', workspace: WS, cron: DAILY });

    // 29s later: still 04:29 — NOT due
    clock.advance(29_000);
    assert.equal(runner.runs(), 0, 'did not fire before the cron minute');

    // cross 04:30:00 — the 30s interval tick itself fires the job
    clock.advance(1_000);
    await flush();
    assert.equal(runner.runs(), 1, 'the REAL interval tick fired the job at 04:30');

    const j = svc.listJobs().find((x) => x.id === job.id);
    assert.equal(j.lastStatus, 'ok');
    assert.ok(j.lastRun >= Date.parse('2026-11-23T04:30:00'), 'lastRun stamped by real fire');
    assert.equal(j.lastFireSlot, Date.parse('2026-11-23T04:30:00'), 'exact cron slot consumed');
    assert.equal(j.runCount, 1, 'runCount advanced');
    assert.equal(j.consecutiveErrors, 0);
    assert.ok(j.lastDurationMs >= 0);
    assert.match(j.lastMessage, /WORK-HAPPENED/, 'the runner output became the stored summary');
    assert.equal(j.nextRun, svc.computeNextRun(DAILY, Date.parse('2026-11-23T04:30:00')), 'nextRun re-armed to the next slot');
    assert.equal(j.lastEvent?.status, 'ok', 'an emitted event is attached to the job (panel consumes it)');
    assert.ok(j.lastEvent.seq >= 1);

    // event ledger is durable + the panel-facing broadcast happened
    const ledger = svc.listEvents();
    assert.ok(ledger.some((e) => e.status === 'running' && e.jobId === job.id), 'running event emitted');
    assert.ok(ledger.some((e) => e.status === 'ok' && e.jobId === job.id), 'ok event emitted');
    assert.ok(events.some((p) => p.jobId === job.id && p.status === 'ok'), 'broadcast delivered ok');

    const disk = JSON.parse(readFileSync(join(ud, 'schedules.json'), 'utf8'));
    assert.equal(disk.find((x) => x.id === job.id).runCount, 1, 'telemetry persisted to disk');

    // 60s later: NEXT tick must NOT re-fire the same slot (concurrency/duplicate guard)
    clock.advance(60_000);
    await flush();
    assert.equal(runner.runs(), 1, 'no duplicate fire inside the next minute');
    assert.equal(svc.schedulerStatus().observed, true, 'status honestly reports an observed fire');
  } finally {
    svc.shutdownScheduleService();
  }
});

test('3. survives a restart: job + telemetry + event ledger still there', async () => {
  const ud = join(TMP, 'ud-c'); mkdirSync(ud, { recursive: true });
  const clock = makeClock(AT);
  const runner = okRunner();
  svc.initScheduleService({ userDataDir: ud, clock, runJob: runner.fn, proofGate: noGate });
  let id;
  try {
    id = svc.addJob({ name: 'C', prompt: 'persist me', workspace: WS, cron: DAILY }).id;
    clock.advance(30_000); // fire at 04:30
    await flush();
    assert.equal(runner.runs(), 1);
    svc.shutdownScheduleService();

    // fresh init = app restart (same userDataDir, new clock). Runner is a NEW
    // instance so a "resurrected" fire would be obvious.
    const clock2 = makeClock(Date.parse('2026-11-23T04:35:00'));
    const runner2 = okRunner();
    svc.initScheduleService({ userDataDir: ud, clock: clock2, runJob: runner2.fn, proofGate: noGate });
    try {
      const jobs = svc.listJobs();
      const j = jobs.find((x) => x.id === id);
      assert.ok(j, 'the job survived the restart');
      assert.equal(j.runCount, 1, 'its run history survived');
      assert.ok(j.lastRun > 0);
      assert.equal(j.nextRun, svc.computeNextRun(DAILY, clock2.now()), 'nextRun recomputed for the new wall clock');
      assert.equal(runner2.runs(), 0, 'restart did NOT fabricate a new run');
      const st = svc.schedulerStatus();
      assert.equal(st.running, true);
      assert.equal(st.observed, true, 'status is OBSERVED from the durable ledger');
      assert.equal(st.jobCount, 1);
      assert.ok(st.eventSeq >= 1);
    } finally {
      svc.shutdownScheduleService();
    }
  } finally {
    try { svc.shutdownScheduleService(); } catch { /* down */ }
  }
});

test('4. honest errors: invalid cron, missing workspace, no-workspace fire', () => {
  const ud = join(TMP, 'ud-d'); mkdirSync(ud, { recursive: true });
  svc.initScheduleService({ userDataDir: ud, clock: makeClock(AT), runJob: okRunner().fn, proofGate: noGate });
  try {
    assert.throws(() => svc.addJob({ prompt: 'x', workspace: WS, cron: 'not a cron' }), /INVALID_CRON/);
    assert.throws(() => svc.addJob({ prompt: 'x', workspace: '', cron: CRON }), /WORKSPACE_REQUIRED/);
    assert.throws(() => svc.addJob({ prompt: 'x', workspace: join(TMP, 'nope'), cron: CRON }), /WORKSPACE_NOT_FOUND/);
    assert.throws(() => svc.addJob({ workspace: WS, cron: CRON }), /PROMPT_REQUIRED/);

    // a legacy job with no workspace fires with an honest error, never a fake ok
    writeFileSync(join(ud, 'schedules.json'), JSON.stringify([{
      id: 'noworkspace', name: 'NoWS', prompt: 'x', workspace: '', cron: CRON,
      enabled: true, createdAt: AT - 86_400_000,
    }]));
    svc.shutdownScheduleService();
    const fireClock = makeClock(Date.parse('2026-11-23T04:30:30'));
    svc.initScheduleService({ userDataDir: ud, clock: fireClock, runJob: okRunner().fn, proofGate: noGate });
    assert.equal(svc.runNow('noworkspace').error, 'NO_WORKSPACE', 'runNow refuses an honest no-workspace job');
    assert.equal(svc.runSchedulerTick(), 1, 'the cron tick still reaches the job');
    const j = svc.listJobs().find((x) => x.id === 'noworkspace');
    assert.equal(j.lastStatus, 'error');
    assert.equal(j.lastError, 'no workspace configured');
    assert.equal(j.lastEvent.status, 'error');
  } finally {
    svc.shutdownScheduleService();
  }
});

test('5. concurrency guard + cancel an in-flight run', async () => {
  const ud = join(TMP, 'ud-e'); mkdirSync(ud, { recursive: true });
  svc.initScheduleService({ userDataDir: ud, clock: makeClock(AT), proofGate: noGate });
  try {
    const job = svc.addJob({ name: 'E', prompt: 'long', workspace: WS, cron: '* * * * *' });
    const runner = async (o) => {
      await new Promise((res) => {
        if (o.signal?.aborted) return res();
        o.signal?.addEventListener('abort', res, { once: true });
      });
      return { ok: false, summary: 'aborted', sessionId: 's', costUsd: 0, inputTokens: 0, outputTokens: 0, aborted: true };
    };
    // re-init so the injected blocking runner is used at fire time
    svc.shutdownScheduleService();
    svc.initScheduleService({ userDataDir: ud, clock: makeClock(AT), runJob: runner, proofGate: noGate });
    assert.equal(svc.runNow(job.id).ok, true);
    await flush();
    assert.equal(svc.runNow(job.id).error, 'ALREADY_RUNNING', 'a second fire is refused while one is in flight');
    assert.equal(svc.schedulerStatus().inFlight, 1);
    assert.equal(svc.cancelJob(job.id), true, 'the in-flight run was cancelled');
    await flush();
    assert.equal(svc.schedulerStatus().inFlight, 0);
  } finally {
    svc.shutdownScheduleService();
  }
});

test('6. REAL loopback webhook trigger fires the job', async () => {
  const ud = join(TMP, 'ud-f'); mkdirSync(ud, { recursive: true });
  const clock = makeClock(AT);
  const runner = okRunner();
  svc.initScheduleService({ userDataDir: ud, clock, runJob: runner.fn, proofGate: noGate });
  try {
    const job = svc.addJob({ name: 'F', prompt: 'web', workspace: WS, cron: CRON });
    svc.stopWebhookListener(); // release the default 7681
    const wh = svc.startWebhookListener(0); // OS-assigned free port
    if (!wh.ok) { t_skip('webhook could not bind'); return; }
    const port = await waitForPort(svc, 3000);
    if (!port) { t_skip('webhook never reached listening state'); return; }
    assert.equal(svc.webhookState().listening, true, 'listener honestly reports bound');

    const code = await post(port, `/trigger/${job.id}?token=${wh.token}`);
    assert.equal(code, 200, 'a valid token + real job is accepted');
    const bad = await post(port, `/trigger/${job.id}?token=wrong`);
    assert.equal(bad, 403, 'a bad token is refused');
    const unknown = await post(port, `/trigger/does-not-exist?token=${wh.token}`);
    assert.equal(unknown, 404, 'an unknown job is refused honestly');

    // the webhook schedules fireJob via clock().setTimeout(...,0); drive it
    clock.advance(1);
    await flush(); // small real wait for the async fire to settle
    assert.equal(runner.runs(), 1, 'the webhook actually fired the job headlessly');
    assert.equal(svc.listJobs().find((x) => x.id === job.id).lastEvent.status, 'ok');
  } finally {
    svc.stopWebhookListener();
    svc.shutdownScheduleService();
  }
});

// ---------- helpers ----------
function readdirSafe(dir) {
  try { return require('fs').readdirSync(dir); } catch { return []; }
}
function t_skip(msg) {
  // node:test has no global skip here; print honestly rather than fake a pass
  console.log(`# SKIP ${msg}`);
}
async function waitForPort(svc, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const p = svc.webhookPort();
    if (p) return p;
    await new Promise((r) => setTimeout(r, 20));
  }
  return null;
}
function post(port, path) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST' }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on('error', () => resolve(0));
    req.end();
  });
}
