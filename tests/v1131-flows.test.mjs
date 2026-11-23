import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.31 — FLOWS / SCHEDULE / SESSIONS / CHECKPOINTS AUDIT
// ------------------------------------------------------------
// Direct, real-module tests (esbuild bundles of the ACTUAL services, isolated
// electron stub, real temp dirs, a mocked clock for cron windows). No mocks of
// the services under test; require.cache is dropped for fresh instances.
//
// Honesty guards proven here:
//   • P1 (A12): the webhook install token and query secrets NEVER appear in
//     any schedule log line (redactSecrets + query scrub).
//   • flows: strict ids, cross-scope uniqueness, caps, stats, replay exit
//     codes, atomic stores, at-most-200 hits.
//   • schedule: cron validation/aliases, mocked-clock due + re-arm, validated
//     triggers, proof-gate suppression, listener port release.
//   • sessions: atomic save, honest meta/count, fork/rename/delete/export,
//     renderer path jail.
//   • checkpoints: workspace jail (root + rel paths), undo/rewind, prune of
//     orphan shadow refs.
//
//   node --test --test-force-exit tests/v1131-flows.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync,
  existsSync, rmSync, readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const sep = require('node:path').sep;
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1131-flows-'));
const UD = join(tmp, 'userdata');
mkdirSync(UD, { recursive: true });

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${out}`, '--external:electron', '--external:@xterm/xterm',
    '--external:@xterm/addon-fit', '--external:monaco-editor',
    '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// ---------- isolated electron stub (records IPC handlers) ----------
globalThis.__V1131_HANDLERS = new Map();
const STUB = join(tmp, 'node_modules', 'electron');
mkdirSync(STUB, { recursive: true });
writeFileSync(join(STUB, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(STUB, 'index.js'), `
const H = globalThis.__V1131_HANDLERS || (globalThis.__V1131_HANDLERS = new Map());
module.exports = {
  app: { getPath: (k) => (k === 'userData' ? ${JSON.stringify(UD)} : ${JSON.stringify(tmp)}), whenReady: async () => true, on() {}, quit() {}, isReady: () => true },
  ipcMain: { handle: (c, fn) => H.set(c, fn), on() {} },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {},
  Notification: { isSupported: () => false },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: {}, screen: {}, powerMonitor: { on() {} },
};
module.exports.default = module.exports;
`);

const MOD = {
  flows: join(tmp, 'flows.cjs'),
  schedule: join(tmp, 'schedule.cjs'),
  session: join(tmp, 'session.cjs'),
  checkpoint: join(tmp, 'checkpoint.cjs'),
};
for (const [name, entry] of Object.entries({
  flows: 'electron/services/flowsService.ts',
  schedule: 'electron/services/scheduleService.ts',
  session: 'electron/services/sessionService.ts',
  checkpoint: 'electron/services/checkpointService.ts',
})) bundle(join(ROOT, entry), MOD[name]);

function fresh(name) {
  delete require.cache[require.resolve(MOD[name])];
  return require(MOD[name]);
}

/** Run fn with a frozen Date.now (sync only — no engine runs under a fake clock). */
function withClock(ts, fn) {
  const real = Date.now;
  Date.now = () => ts;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}
async function withClockAsync(ts, fn) {
  const real = Date.now;
  Date.now = () => ts;
  try {
    return await fn();
  } finally {
    Date.now = real;
  }
}

const WS_FLOWS = join(tmp, 'ws-flows');
const WS_REPLAY = join(tmp, 'ws-replay');
const WS_SCHED = join(tmp, 'ws-sched');
const WS_CP = join(tmp, 'ws-checkpoints');
for (const d of [WS_FLOWS, WS_REPLAY, WS_SCHED, WS_CP]) mkdirSync(d, { recursive: true });

let gateServer;
const scheduleInstances = [];
function bootSchedule(extraSeed) {
  if (extraSeed !== undefined) writeFileSync(join(UD, 'schedules.json'), JSON.stringify(extraSeed));
  const s = fresh('schedule');
  scheduleInstances.push(s);
  s.initScheduleService({ userDataDir: UD, broadcast: () => {} });
  return s;
}

const letters = (n) => {
  let s = '';
  let x = n;
  do {
    s = String.fromCharCode(97 + (x % 26)) + s;
    x = Math.floor(x / 26) - 1;
  } while (x >= 0);
  return s + 'v1131hit';
};

// ============================================================
// P1 (A12) — LOG REDACTION: no token, no query secret, ever
// ============================================================
test('P1 schedule logs: raw webhook token + query secrets are NEVER logged', () => {
  const s = bootSchedule([]);
  const raw = s.webhookToken();
  assert.match(raw, /^[a-f0-9]{16,}$/, 'a real install token was minted');

  const original = { log: console.log, warn: console.warn, error: console.error };
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  console.warn = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try {
    // re-init produces the boot lines that used to include token.slice(0,4)
    s.initScheduleService({ userDataDir: UD, broadcast: () => {} });
    // trigger an error-path log that could carry a token-bearing URL
    const safe = s.redactScheduleLog(
      `POST /trigger/job?token=${raw}&key=OTHERSECRET123 Bearer ${raw}`,
      raw,
    );
    lines.push(safe);
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
    s.shutdownScheduleService();
  }

  assert.ok(lines.length > 0, 'schedule actually emitted log lines');
  for (const line of lines) {
    assert.equal(line.includes(raw), false, `FAIL: raw webhook token leaked into a log line: ${line}`);
    assert.equal(line.includes('OTHERSECRET123'), false, `FAIL: query secret leaked into a log line: ${line}`);
  }
  assert.ok(
    lines.some((l) => l.includes('«redacted»') || l.includes('[REDACTED]')),
    'logs explicitly show a redaction marker where secrets were removed',
  );
  // the pure helper also scrubs each family in isolation
  const scrub = s.redactScheduleLog('x?token=SECRET_A&sig=SECRET_B', 'INSTALL_SECRET_C');
  assert.equal(scrub.includes('SECRET_A'), false);
  assert.equal(scrub.includes('SECRET_B'), false);
  assert.equal(scrub.includes('INSTALL_SECRET_C'), false);
});

// ============================================================
// FLOWS — validation / stats / replay / caps / atomic store
// ============================================================
test('flows: strict ids, duplicate + cross-scope rejection, caps, atomic store', async () => {
  const flows = fresh('flows');
  const first = await flows.flowsSave({ name: 'V1131 flow', prompt: 'do the thing' });
  const flow = first.find((f) => f.name === 'V1131 flow');
  assert.ok(flow && flow.scope === 'global');

  await assert.rejects(() => flows.flowsSave({ name: 'v1131 FLOW', prompt: 'x' }), /duplicate/);
  await assert.rejects(() => flows.flowsSave({ id: '../evil', name: 'Bad', prompt: 'x' }), /INVALID_FLOW_ID/);
  await assert.rejects(() => flows.flowsSave({ name: '', prompt: 'x' }), /name is required/);
  await assert.rejects(() => flows.flowsSave({ name: 'No prompt' }), /prompt is required/);

  await flows.flowsSave({ id: 'v1131-cross', name: 'Cross global', prompt: 'g', scope: 'global' });
  await assert.rejects(
    () => flows.flowsSave({ id: 'v1131-cross', name: 'Cross ws', prompt: 'w', scope: 'workspace' }, WS_FLOWS),
    /scope-mismatch/,
  );

  // stats survive an in-place update, and markRun is honest about stale ids
  assert.equal(await flows.flowsMarkRun(flow.id), true);
  assert.equal(await flows.flowsMarkRun('never-existed'), false);
  const updated = await flows.flowsSave({ id: flow.id, name: 'V1131 renamed', prompt: 'do it better' });
  const after = updated.find((f) => f.id === flow.id);
  assert.equal(after.runCount, 1, 'update preserved runCount');
  assert.equal(after.createdAt, flow.createdAt, 'update preserved createdAt');
  assert.ok(after.lastRun > 0, 'update preserved lastRun');

  // exact caps
  let guard = 0;
  while (flows.flowsList().filter((f) => f.scope === 'global').length < 50 && guard++ < 80) {
    await flows.flowsSave({ name: `cap-${guard}`, prompt: 'cap' });
  }
  await assert.rejects(() => flows.flowsSave({ name: 'over-cap', prompt: 'x' }), /Global flow limit reached/);
  guard = 0;
  const wsList = () => flows.flowsList(WS_FLOWS).filter((f) => f.scope === 'workspace');
  while (wsList().length < 20 && guard++ < 40) {
    await flows.flowsSave({ name: `wcap-${guard}`, prompt: 'cap', scope: 'workspace' }, WS_FLOWS);
  }
  await assert.rejects(
    () => flows.flowsSave({ name: 'over-wcap', prompt: 'x', scope: 'workspace' }, WS_FLOWS),
    /Workspace flow limit reached/,
  );

  // atomic: no leftover tmp files after all writes
  assert.equal(readdirSync(UD).some((n) => n.endsWith('.tmp')), false, 'no orphan .tmp in userData');
  assert.equal(readdirSync(join(WS_FLOWS, '.surnia')).some((n) => n.endsWith('.tmp')), false, 'no orphan .tmp in workspace');
});

test('flows: replay reports the real exit code and rejects a bad workspace', async () => {
  const flows = fresh('flows');
  const list = await flows.flowsSave({
    name: 'V1131 replay ok',
    prompt: `node -e "require('node:fs').writeFileSync('v1131-replay.txt','OK')"`,
    scope: 'workspace',
  }, WS_REPLAY);
  const okFlow = list.find((f) => f.name === 'V1131 replay ok');
  const ok = await flows.flowsValidateByReplay(okFlow.id, WS_REPLAY);
  assert.equal(ok.ok, true, `exit 0 replay (${ok.detail})`);
  assert.equal(ok.exitCode, 0);
  assert.equal(readFileSync(join(WS_REPLAY, 'v1131-replay.txt'), 'utf8'), 'OK');

  const badList = await flows.flowsSave({ name: 'V1131 replay bad', prompt: 'node -e "process.exit(7)"', scope: 'workspace' }, WS_REPLAY);
  const badFlow = badList.find((f) => f.name === 'V1131 replay bad');
  const bad = await flows.flowsValidateByReplay(badFlow.id, WS_REPLAY);
  assert.equal(bad.ok, false);
  assert.equal(bad.exitCode, 7);
  assert.match(bad.detail, /exit 7/);

  const invalid = await flows.flowsValidateByReplay(badFlow.id, join(tmp, 'missing-workspace'));
  assert.equal(invalid.ok, false);
  assert.match(invalid.detail, /invalid replay workspace/);
  assert.equal((await flows.flowsValidateByReplay('../junk')).detail, 'INVALID_FLOW_ID');
});

test('flows: repetition counter is capped at 200 and stops for saved prompts', async () => {
  const flows = fresh('flows');
  // the cap test filled the global store — free room for the "saved" probe
  for (const f of flows.flowsList().filter((x) => x.name.startsWith('cap-'))) {
    await flows.flowsDelete(f.id);
  }
  // keep the 201 seeded hits OLDER than the live-clock hits that follow:
  // pruneHits keeps the 200 most recently updated entries.
  const base = Date.now() - 1_000_000;
  for (let i = 0; i < 201; i++) {
    await withClockAsync(base + i, () => flows.flowsHit(letters(i) + ' v1131'));
  }
  assert.equal(flows.flowsInfo().hitsTracked, 200, 'hits pruned to exactly MAX_HITS');

  const text = 'v1131 repeated prompt about verification';
  let suggest = false;
  for (let i = 0; i < 3; i++) suggest = (await flows.flowsHit(text)).suggest;
  assert.equal(suggest, true, 'suggests on the 3rd repetition');
  await flows.flowsSave({ name: 'V1131 saved repeat', prompt: text });
  assert.equal((await flows.flowsHit(text)).suggest, false, 'no suggestion once the prompt IS a flow');
});

// ============================================================
// SCHEDULE — cron validation, mocked-clock due/re-arm, triggers
// ============================================================
test('schedule: cron validation/aliases + addJob trigger validation', () => {
  const s = bootSchedule([]);
  assert.equal(s.isValidCron('* * * * *'), true);
  assert.equal(s.isValidCron('*/15 1-5 * 1,6 0'), true);
  assert.equal(s.isValidCron('@hourly'), true);
  assert.equal(s.isValidCron('@monthly'), true);
  assert.equal(s.isValidCron('* * * * * *'), false);
  assert.equal(s.isValidCron('60 * * * *'), false);
  assert.equal(s.isValidCron('*/0 * * * *'), false);
  assert.equal(s.isValidCron('5-1 * * * *'), false);

  assert.throws(() => s.addJob({ prompt: 'x', workspace: WS_SCHED, cron: '* * * * *', trigger: { kind: 'bogus' } }), /INVALID_TRIGGER/);
  assert.throws(() => s.addJob({ prompt: 'x', workspace: WS_SCHED, cron: '* * * * *', trigger: { kind: 'file-watch' } }), /INVALID_TRIGGER_PATH/);
  assert.throws(() => s.addJob({ prompt: 'x', workspace: WS_SCHED, cron: '* * * * *', trigger: { kind: 'ci-failure', path: '../escape' } }), /INVALID_TRIGGER_PATH/);
  const job = s.addJob({ name: 'watch', prompt: 'x', workspace: WS_SCHED, cron: '* * * * *', trigger: { kind: 'file-watch', path: join(WS_SCHED, 'a.txt') } });
  assert.equal(job.trigger.kind, 'file-watch', 'trigger is persisted, not silently dropped');
  assert.equal(s.listJobs().find((j) => j.id === job.id).trigger.path, join(WS_SCHED, 'a.txt'));
  s.shutdownScheduleService();
});

test('schedule: mocked clock fires a cron slot once and re-arms inside 60s', () => {
  // Monday 2026-11-23, local time.
  const monday = new Date(2026, 10, 23, 4, 0, 0).getTime();
  const seeded = [{
    id: 'v1131-cron', name: 'Cron', prompt: 'ping',
    workspace: '', cron: '30 4 * * 1', enabled: true,
    createdAt: monday,
  }];
  const s = bootSchedule(seeded);
  try {
    const at429 = monday + 29 * 60_000;
    assert.equal(withClock(at429, () => s.runSchedulerTick()), 0, 'not due at 04:29');
    const at430 = monday + 30 * 60_000 + 7_000;
    assert.equal(withClock(at430, () => s.runSchedulerTick()), 1, 'due at 04:30');
    const job = s.listJobs().find((j) => j.id === 'v1131-cron');
    assert.equal(job.lastStatus, 'error', 'no-workspace job reports the honest error');
    assert.equal(job.lastMessage, 'no workspace configured');
    assert.equal(withClock(at430 + 60_000, () => s.runSchedulerTick()), 0, 're-arm: no double-fire inside 60s');
  } finally {
    s.shutdownScheduleService();
  }
});

// ============================================================
// SESSIONS — create/list/fork/rename/delete/export + path jail
// ============================================================
test('sessions: create/list/load/rename/fork/export/delete are real and honest', async () => {
  const sessions = fresh('session');
  const msg = (role, content) => ({ id: `m-${role}`, role, kind: 'text', content, timestamp: Date.now() });
  const created = await sessions.createSession({ title: 'V1131 session', workspace: WS_CP, messages: [msg('user', 'hello'), msg('assistant', 'hi')] });
  assert.match(created.id, /^[a-f0-9-]{36}$/);
  assert.equal(created.messageCount, 2);

  const loaded = await sessions.load(created.id);
  assert.equal(loaded.title, 'V1131 session');
  assert.equal(sessions_flows_count((await sessions.list()), created.id), 1, 'listed exactly once');

  const renamed = await sessions.renameSession(created.id, '  V1131 renamed  ');
  assert.equal(renamed.ok, true);
  assert.equal(renamed.session.title, 'V1131 renamed');
  assert.equal((await sessions.load(created.id)).title, 'V1131 renamed');
  assert.deepEqual(await sessions.renameSession(created.id, '   '), { ok: false, error: 'TITLE_REQUIRED' });

  const forked = await sessions.forkSession(created.id);
  assert.equal(forked.ok, true);
  assert.equal((await sessions.load(forked.sessionId)).title, 'Fork of V1131 renamed');
  assert.notEqual(forked.sessionId, created.id);

  const md = await sessions.exportSessionMarkdown(created.id);
  assert.equal(md.ok, true);
  assert.ok(md.markdown.includes('V1131 renamed'));
  assert.ok(existsSync(md.path));

  const html = await sessions.exportSessionHtml(created.id);
  assert.equal(html.ok, true);
  assert.ok(readFileSync(html.path, 'utf8').includes('V1131 renamed'));

  // renderer-facing export handler IGNORES an explicit escape path
  const handler = globalThis.__V1131_HANDLERS.get('kdx:session:export');
  assert.ok(typeof handler === 'function', 'kdx:session:export is registered');
  const rogue = join(tmp, 'ROGUE-EXPORT.html');
  const viaIpc = await handler({}, created.id, rogue);
  assert.equal(viaIpc.ok, true);
  assert.equal(existsSync(rogue), false, 'FAIL session export IPC honored a renderer-supplied path');
  assert.ok(viaIpc.path.startsWith(UD), 'export landed under userData');

  assert.equal(await sessions.remove(created.id), true);
  assert.equal(await sessions.remove(created.id), false, 'delete reports a missing session honestly');
  assert.equal(await sessions.load(created.id), null);
});
function sessions_flows_count(list, id) {
  return list.filter((m) => m.id === id).length;
}

test('sessions: id path jail and atomic writes', async () => {
  const sessions = fresh('session');
  const sessionDir = join(UD, 'sessions');
  await sessions.save({ id: '../v1131-escape', title: 'Jail', messages: [] });
  assert.equal(existsSync(join(tmp, 'v1131-escape.json')), false, 'no file escaped the sessions dir');
  // the traversal id is SANITIZED to a safe in-jail key — it can only ever
  // address the file inside <userData>/sessions, never a path outside it.
  const jailed = await sessions.load('../v1131-escape');
  assert.ok(jailed && jailed.id === '.._v1131-escape', 'traversal resolves only to the jailed file');
  assert.equal(await sessions.load('../../etc/passwd'), null, 'unknown traversal id stays missing');
  // every persisted file is valid JSON after atomic writes
  for (const name of readdirSync(sessionDir).filter((n) => n.endsWith('.json'))) {
    const parsed = JSON.parse(readFileSync(join(sessionDir, name), 'utf8'));
    assert.ok(parsed.id, `${name} is not torn JSON`);
  }
  assert.equal(readdirSync(sessionDir).some((n) => n.endsWith('.tmp')), false, 'no orphan .tmp');
});

// ============================================================
// CHECKPOINTS — create/list/restore/undo/rewind + path jail + prune
// ============================================================
test('checkpoints: file copy create → list → restore → undo/rewind', async () => {
  const cp = fresh('checkpoint');
  const file = join(WS_CP, 'state.txt');
  writeFileSync(file, 'version-one');
  const t0 = 1_900_000_000_000;
  const one = await withClockAsync(t0, () => cp.create(WS_CP, 'v1131 one'));
  assert.equal(one.kind, 'files');
  assert.ok(cp_list_has(await cp.list(WS_CP), one.id));

  writeFileSync(file, 'version-two');
  const two = await withClockAsync(t0 + 60_000, () => cp.create(WS_CP, 'v1131 two', 'sess-123'));
  assert.ok(two.at > one.at, 'newer checkpoint sorts first by creation time');

  writeFileSync(file, 'version-three');
  const rewound = await cp.rewind(WS_CP, 1);
  assert.equal(rewound.steps, 1);
  assert.equal(readFileSync(file, 'utf8'), 'version-one', 'rewind(1) restored the previous snapshot');

  writeFileSync(file, 'drift-again');
  const undone = await cp.undo(WS_CP);
  assert.equal(undone.id, two.id, 'undo restores the newest checkpoint');
  assert.equal(readFileSync(file, 'utf8'), 'version-two');
  assert.equal(undone.sessionId, 'sess-123', 'manifest sessionId travels with the restore');

  await assert.rejects(() => cp.create('   ', 'empty'), /WORKSPACE_REQUIRED/);
  await assert.rejects(() => cp.create(join(tmp, 'no-such-dir'), 'missing'), /WORKSPACE_NOT_FOUND/);
});
function cp_list_has(list, id) {
  return list.some((c) => c.id === id);
}

test('checkpoints: manifest traversal and cross-root restore are refused', async () => {
  const cp = fresh('checkpoint');
  const root = join(tmp, 'ws-cp-jail');
  mkdirSync(root, { recursive: true });
  const sentinel = join(tmp, 'v1131-escaped.txt');
  writeFileSync(sentinel, 'UNCHANGED');

  const id = 'evilcp';
  const dir = join(UD, 'checkpoints', id);
  mkdirSync(join(dir, 'files'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    id, label: 'evil', at: Date.now(), root, fileCount: 1,
    files: [`..${sep}v1131-escaped.txt`, `${sep}absolute.txt`, 'ok.txt'],
    kind: 'files',
  }));
  writeFileSync(join(dir, 'files', 'ok.txt'), 'safe');

  const r = await cp.restore(root, id);
  assert.equal(r.restored, 1, 'only the in-jail file restored');
  assert.equal(r.skipped, 2, 'traversal + absolute entries skipped');
  assert.equal(readFileSync(sentinel, 'utf8'), 'UNCHANGED', 'FAIL: checkpoint traversal escaped the workspace');

  const other = join(tmp, 'ws-cp-other');
  mkdirSync(other, { recursive: true });
  await assert.rejects(() => cp.restore(other, id), /CHECKPOINT_ROOT_MISMATCH/);
  // explicit force is the documented escape hatch for a moved workspace
  const forced = await cp.restore(other, id, true);
  assert.equal(forced.restored, 1);
});

test('checkpoints: pruning a shadow checkpoint removes its orphan git ref', async () => {
  const cp = fresh('checkpoint');
  const repo = join(tmp, 'ws-cp-git');
  mkdirSync(repo, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'v1131@t');
  git('config', 'user.name', 'v1131');
  writeFileSync(join(repo, 'tracked.txt'), 'base\n');
  git('add', '.');
  git('commit', '-qm', 'base');

  const base = new Date(2026, 0, 1).getTime();
  const old = await cp.create(repo, 'old shadow');
  assert.equal(old.kind, 'shadow', `git shadow checkpoint created (${old.kind})`);
  assert.ok(old.ref && /^refs\/surnia\/checkpoints\//.test(old.ref));
  // force the old manifest to be prunable on the NEXT create
  const manifestPath = join(UD, 'checkpoints', old.id, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify({ ...old, at: base }));
  // create a fresh checkpoint → pruneOld removes the stale one + its ref
  await cp.create(repo, 'new shadow');
  assert.equal(existsSync(join(UD, 'checkpoints', old.id)), false, 'old checkpoint dir pruned');
  let refGone = false;
  try {
    execFileSync('git', ['rev-parse', '--verify', old.ref], { cwd: repo, stdio: 'pipe' });
  } catch {
    refGone = true;
  }
  assert.equal(refGone, true, 'FAIL: pruned shadow checkpoint left an orphan git ref');
});

// ============================================================
// proof gate — a failing suite overrules a "done" headless run
// ============================================================
test('schedule: proof gate suppresses a run whose test suite fails', async () => {
  const gateBase = await new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.flushHeaders();
        const chunk = (delta, finish) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
        res.write(chunk({ role: 'assistant', content: 'Gate probe completed the requested work and verified the artifact end to end.' }, null));
        res.write(`data: ${JSON.stringify({ usage: { prompt_tokens: 20, completion_tokens: 8 }, choices: [] })}\n\n`);
        res.write(chunk({}, 'stop'));
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    gateServer = srv;
    srv.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${srv.address().port}`));
  });

  const ws = join(tmp, 'ws-gate');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(4)"' } }));
  writeFileSync(join(UD, 'settings.json'), JSON.stringify({
    schemaVersion: 4,
    model: { provider: 'custom', model: '' },
    providers: { custom: { enabled: true, apiKey: 'test-key', baseUrl: gateBase } },
    agent: { maxRetries: 0, autoCompact: false, autoVerify: false, autoMemory: false, criticGate: false },
    dnaEnabled: false,
    doneNotifications: false,
  }));

  const s = bootSchedule([{
    id: 'v1131-gate', name: 'Gate job', prompt: 'do the work',
    workspace: ws, cron: '0 0 31 2 1', enabled: true, mode: 'autoEdit',
    model: { provider: 'custom', model: 'gate-live' }, createdAt: Date.now() - 1000,
  }]);
  try {
    assert.equal(s.runNow('v1131-gate').ok, true);
    const deadline = Date.now() + 45_000;
    let job;
    for (;;) {
      job = s.listJobs().find((j) => j.id === 'v1131-gate');
      if (job.lastStatus === 'ok' || job.lastStatus === 'error') break;
      if (Date.now() > deadline) throw new Error('proof-gate run timed out');
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(job.lastStatus, 'error', 'failed suite overrules the "done" claim');
    assert.match(job.lastMessage ?? '', /\[proof gate\]/, 'honest proof-gate reason stored');
  } finally {
    s.shutdownScheduleService();
  }
});
// ---------- cleanup: release real listeners / servers / temp dirs ----------
after(async () => {
  for (const s of scheduleInstances) {
    try { s.shutdownScheduleService(); } catch { /* already down */ }
  }
  try { gateServer?.closeAllConnections?.(); } catch { /* optional */ }
  if (gateServer) await new Promise((r) => gateServer.close(r));
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
