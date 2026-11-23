// ============================================================
// SADEEM v11.19 — SUBAGENT RUNNER verification (offline).
//   node --test tests/v1119-subagents.test.mjs
//
// Covers the founder's audit contract:
//  · two `task`-style subagents launched in a batch genuinely overlap and BOTH
//    return their results to the parent (nothing silently dropped);
//  · one failing subagent does NOT stall or lose the other — the parent gets
//    an honest notice with a concrete retry hint;
//  · `subagent_progress` events carry REAL percentages from done/total;
//  · a hung subagent hits its per-subagent timeout and cannot hang the parent;
//  · the specialist prompt inherits the parent capability mindset + tool
//    profile, and approvals are delegated (never auto-approved).
// ============================================================
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1119-subagents-'));
const ud = join(tmp, 'ud');
mkdirSync(ud, { recursive: true });

// electron stub: capture `kdx:subagents:event` pushes so notices are observable.
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `const events = [];\nmodule.exports = {\n` +
    `  __events: events,\n` +
    `  app: { getPath: () => ${JSON.stringify(ud)} },\n` +
    `  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (_ch, p) => events.push(p) } }] },\n` +
    `  ipcMain: { handle: () => {} },\n` +
    `};\n`,
);
const electron = require(join(stubDir, 'index.js'));
const busEvents = () => electron.__events.slice();
const flush = () => new Promise((resolve) => setImmediate(resolve));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function bundle(entry, out) {
  execFileSync(
    ESBUILD_NODE,
    [ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`, '--external:electron', '--log-level=error'],
    { cwd: ROOT, timeout: 120000 },
  );
}

const sa = require((() => { const p = join(tmp, 'subagents.cjs'); bundle(join(ROOT, 'electron/agent/subagents.ts'), p); return p; })());
const runner = require((() => { const p = join(tmp, 'subagentRunner.cjs'); bundle(join(ROOT, 'electron/agent/subagentRunner.ts'), p); return p; })());

const task = (id, label) => ({
  id,
  label,
  role: 'explore',
  description: `work for ${id}`,
  prompt: `Do ${id} work`,
});

test('v11.19: progressPct derives honest, clamped percentages from done/total', () => {
  assert.equal(sa.progressPct(1, 4), 25);
  assert.equal(sa.progressPct(2, 4), 50);
  assert.equal(sa.progressPct(4, 4), 100);
  assert.equal(sa.progressPct(9, 4), 100, 'clamped');
  assert.equal(sa.progressPct(3, 0), 0, 'no total → 0, never NaN');
});

test('v11.19: ledger progress stores real pct + step and emits them', async () => {
  sa.clearSubagents();
  const rec = sa.startSubagent({ label: 'Reviewer', role: 'review', description: 'review', prompt: 'review the diff', total: 4, workspace: join(tmp, 'ws'), sessionId: 's1' });
  await flush();
  sa.progressSubagent(rec.id, 2, 4, 'read_file src/app.ts');
  await flush();

  const got = sa.getSubagent(rec.id);
  assert.equal(got.done, 2);
  assert.equal(got.total, 4);
  assert.equal(got.pct, 50, 'real percentage persisted');
  assert.equal(got.step, 'read_file src/app.ts');
  const progress = busEvents().filter((e) => e.type === 'progress').at(-1);
  assert.equal(progress.pct, 50);
  assert.equal(progress.step, 'read_file src/app.ts');
  assert.equal(progress.record.id, rec.id);
});

test('v11.19: a failed ledger record broadcasts a clear notice with a retry hint', async () => {
  sa.clearSubagents();
  const rec = sa.startSubagent({ label: 'Debugger', role: 'debugger', description: 'fix', prompt: 'fix crash', workspace: join(tmp, 'ws'), sessionId: 's2' });
  await flush();
  sa.failSubagent(rec.id, 'model call failed', { timedOut: false });
  await flush();

  const got = sa.getSubagent(rec.id);
  assert.equal(got.status, 'error');
  assert.equal(got.error, 'model call failed', 'error stays verbatim (v11.12 contract)');
  assert.match(got.retryHint, /retry/i);
  const notice = busEvents().filter((e) => e.type === 'notice').at(-1);
  assert.ok(notice, 'failure notice emitted — never silent');
  assert.match(notice.notice.text, /FAILED/);
  assert.match(notice.notice.text, /model call failed/);
  assert.match(notice.notice.text, /retry/i);
});

test('v11.19: TWO parallel subagents both complete and both results reach the parent', async () => {
  sa.clearSubagents();
  let active = 0;
  let maxActive = 0;
  let releaseBoth;
  const bothStarted = new Promise((r) => { releaseBoth = r; });
  const progress = [];

  const results = await runner.runSubagentBatch([task('alpha', 'Alpha'), task('beta', 'Beta')], {
    ledger: false,
    timeoutMs: 1500,
    emit: (e) => progress.push(e),
    runner: async (t, hooks) => {
      active++;
      maxActive = Math.max(maxActive, active);
      if (active === 2) releaseBoth();
      // Neither finishes until BOTH have started — deterministic proof of
      // real parallel launch (a sequential runner would deadlock here).
      await Promise.race([bothStarted, delay(500)]);
      hooks.progress(1, 2, `${t.id}:step-1`);
      await delay(5);
      hooks.progress(2, 2, `${t.id}:step-2`);
      return `${t.id}-done`;
    },
  });

  assert.equal(maxActive, 2, 'both executors were in flight simultaneously');
  assert.equal(results.length, 2, 'no result dropped');
  assert.ok(results.every((r) => r.ok), 'both succeeded');
  assert.deepEqual(results.map((r) => r.result).sort(), ['alpha-done', 'beta-done']);

  // Real percentages, not fabricated constants.
  for (const id of ['alpha', 'beta']) {
    const pcts = progress.filter((e) => e.id === id).map((e) => e.pct);
    assert.deepEqual(pcts, [50, 100], `${id} progress percentages`);
  }
});

test('v11.19: one subagent fails → parent continues with an honest notice + retry hint', async () => {
  sa.clearSubagents();
  const notices = [];
  const results = await runner.runSubagentBatch([task('good', 'Good'), task('bad', 'Bad')], {
    ledger: false,
    timeoutMs: 1500,
    notice: (n) => notices.push(n),
    runner: async (t, hooks) => {
      if (t.id === 'bad') {
        hooks.progress(1, 2, 'crash');
        throw new Error('model call failed');
      }
      hooks.progress(2, 2, 'done');
      return 'good-done';
    },
  });

  assert.equal(results.length, 2, 'both results returned — failure did not drop the good one');
  const good = results.find((r) => r.id === 'good');
  const bad = results.find((r) => r.id === 'bad');
  assert.equal(good.ok, true, 'parent continues with the healthy subagent');
  assert.equal(good.result, 'good-done');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /model call failed/, 'honest error propagated');

  const notice = notices.find((n) => n.subagentId === 'bad');
  assert.ok(notice, 'a clear notice was emitted for the failure');
  assert.match(notice.text, /FAILED/);
  assert.match(notice.text, /model call failed/);
  assert.match(notice.text, /retry/i, 'notice carries a retry hint');
});

test('v11.19: a hung subagent times out instead of hanging the parent run', async () => {
  sa.clearSubagents();
  const notices = [];
  const started = Date.now();
  const results = await runner.runSubagentBatch([task('hung', 'Hung')], {
    ledger: false,
    timeoutMs: 40,
    notice: (n) => notices.push(n),
    runner: () => new Promise(() => { /* never resolves — a dead subagent */ }),
  });
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 500, `batch returned promptly (${elapsed}ms), did not hang`);
  assert.equal(results.length, 1, 'the hung subagent still produces a result entry');
  assert.equal(results[0].ok, false);
  assert.equal(results[0].timedOut, true);
  assert.match(results[0].error, /timed out/i);
  assert.ok(notices.some((n) => /timed out/i.test(n.text) && /retry/i.test(n.text)), 'timeout notice + retry hint');
});

test('v11.19: subagent prompt inherits capability mindset + tool profile; gate cannot be bypassed', () => {
  const src = readFileSync(join(ROOT, 'electron/agent/subagentRunner.ts'), 'utf8');
  // Capability mindset inherited from the parent.
  assert.match(src, /Capability contract \(inherited from the parent agent\)/);
  assert.match(src, /FULLY CAPABLE/);
  // v11.36 (D1) — specialists now get the FULL registry via subagentToolDefs()
  // (the founder's "subagent says I don't have the tools" fix). The old
  // getToolDefs([], profile) allow-list was intentionally removed.
  assert.match(src, /function subagentToolDefs\(\)/);
  assert.match(src, /getToolDefs\(\[\], 'full'\)/);
  assert.doesNotMatch(src, /getToolDefs\(\[\], profile\)/);
  assert.equal(runner.toolProfileOf({ agent: { toolProfile: 'essential' } }), 'essential');
  assert.equal(runner.toolProfileOf({}), 'balanced', 'app default is balanced');
  // Approval gate delegated, never auto-approved / fullAccess.
  assert.match(src, /approve: async \(req\)/);
  assert.match(src, /hooks\.approve/);
  assert.match(src, /fullAccess: false/);
  assert.doesNotMatch(src, /approve:\s*async\s*\(\)\s*=>\s*true/);

  const prompt = runner.buildSubagentSystemPrompt({
    name: 'Tester',
    prompt: 'verify the fix',
    tools: ['read_file', 'run_command'],
    profile: 'balanced',
    workspace: '/work',
  });
  assert.match(prompt, /FULLY CAPABLE/);
  assert.match(prompt, /approval gate/);
  assert.match(prompt, /balanced/);
  assert.match(prompt, /verify the fix/);
  assert.match(prompt, /read_file/);
});

test('v11.19: per-subagent timeout is env-tunable and read at call time', () => {
  const previous = process.env.SURNIA_SUBAGENT_TIMEOUT_MS;
  try {
    process.env.SURNIA_SUBAGENT_TIMEOUT_MS = '1234';
    assert.equal(runner.subagentTimeoutMs(), 1234);
    delete process.env.SURNIA_SUBAGENT_TIMEOUT_MS;
    assert.equal(runner.subagentTimeoutMs(), 2 * 60_000);
  } finally {
    if (previous === undefined) delete process.env.SURNIA_SUBAGENT_TIMEOUT_MS;
    else process.env.SURNIA_SUBAGENT_TIMEOUT_MS = previous;
  }
});

test.after(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});
