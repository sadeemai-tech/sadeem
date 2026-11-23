// ============================================================
// SADEEM v11.23 — REAL SUBAGENT PATH audit (offline, mock child runs).
//   node --test tests/v1123-subagents.test.mjs
//
// Founder's contract: spawn, parallel run, timeout, result merge, abort
// propagation and failure reporting must be honest. Every mock child below is
// a plain promise — no model / network — so a success, a failure, a hang and an
// abort are deterministic. We assert the PARENT always continues with a real
// per-child result and that the event stream has no silent drops, no duplicates
// and no misattributed errors.
// ============================================================
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1123-subagents-'));
const ud = join(tmp, 'ud');
mkdirSync(ud, { recursive: true });

// electron stub — capture every `kdx:subagents:event` pushed to the renderer.
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
const clearBus = () => { electron.__events.length = 0; };
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

test('v1123: parallel children succeed — both results merge in order, no duplicate progress events', async () => {
  sa.clearSubagents();
  clearBus();
  let active = 0;
  let maxActive = 0;
  let bothStarted;
  const gate = new Promise((resolve) => { bothStarted = resolve; });
  const emitted = [];
  const notices = [];

  const results = await runner.runSubagentBatch([task('s-ok-a', 'Ok A'), task('s-ok-b', 'Ok B')], {
    ledger: false,
    timeoutMs: 400,
    emit: (e) => emitted.push(e),
    notice: (n) => notices.push(n),
    runner: async (t, hooks) => {
      active++;
      maxActive = Math.max(maxActive, active);
      if (active === 2) bothStarted();
      // Neither child finishes until BOTH are in flight: a sequential host
      // would deadlock here (and hit the deadline).
      await gate;
      hooks.progress(1, 2, `${t.id}:step-1`);
      hooks.progress(2, 2, `${t.id}:step-2`);
      return `${t.id}-result`;
    },
  });

  assert.equal(maxActive, 2, 'children genuinely overlapped');
  assert.deepEqual(results.map((r) => r.id), ['s-ok-a', 's-ok-b'], 'ordered merge, nothing dropped');
  assert.ok(results.every((r) => r.ok && !r.timedOut && !r.aborted), 'clean success');
  assert.deepEqual(results.map((r) => r.result), ['s-ok-a-result', 's-ok-b-result']);
  assert.equal(notices.length, 0, 'success is silent');
  for (const id of ['s-ok-a', 's-ok-b']) {
    const events = emitted.filter((e) => e.id === id);
    assert.equal(events.length, 2, 'exactly one event per progress call — no duplicates');
    assert.deepEqual(events.map((e) => e.pct), [50, 100], 'real percentages');
  }
});

test('v1123: a failing child does not drop or taint its sibling — error is attributed correctly', async () => {
  sa.clearSubagents();
  clearBus();
  const notices = [];
  const results = await runner.runSubagentBatch([task('f-good', 'Good'), task('f-bad', 'Bad')], {
    ledger: false,
    timeoutMs: 400,
    notice: (n) => notices.push(n),
    runner: async (t) => {
      if (t.id === 'f-bad') throw new Error('child-only API error 422');
      return 'good-result';
    },
  });

  assert.equal(results.length, 2, 'both results returned — failure did not drop the sibling');
  const good = results.find((r) => r.id === 'f-good');
  const bad = results.find((r) => r.id === 'f-bad');
  assert.equal(good.ok, true, 'parent continues with the healthy child');
  assert.equal(good.result, 'good-result');
  assert.equal(good.error, undefined, 'no cross-contamination from the failing child');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /child-only API error 422/, 'honest child error, not a wrong parent error');
  assert.equal(bad.timedOut, undefined, 'a fast failure is NOT reported as a timeout');
  assert.equal(bad.aborted, undefined, 'a fast failure is NOT reported as an abort');

  assert.equal(notices.filter((n) => n.subagentId === 'f-bad').length, 1, 'one consumer notice for the failed child');
  assert.equal(notices.filter((n) => n.subagentId === 'f-good').length, 0, 'no notice for the healthy child');
  const bus = busEvents().filter((e) => e.type === 'notice' && e.notice?.subagentId === 'f-bad');
  assert.equal(bus.length, 1, 'exactly one bus notice');
  assert.match(bus[0].notice.text, /FAILED/);
  assert.match(bus[0].notice.text, /retry/i, 'honest retry hint');
});

test('v1123: a hung child is stopped (no orphan) and reports a real timeout; sibling survives', async () => {
  sa.clearSubagents();
  clearBus();
  const seen = [];
  const notices = [];
  const t0 = Date.now();
  const results = await runner.runSubagentBatch([task('h-hung', 'Hung'), task('h-good', 'Good')], {
    ledger: false,
    timeoutMs: 60,
    notice: (n) => notices.push(n),
    runner: (t, hooks) => {
      seen.push({ id: t.id, hooks });
      if (t.id !== 'h-hung') return Promise.resolve('good-result');
      return new Promise(() => { /* never settles — a dead child */ });
    },
  });
  const elapsed = Date.now() - t0;

  assert.ok(elapsed < 500, `batch returned promptly (${elapsed}ms), did not hang`);
  assert.equal(results.length, 2, 'hung child still gets a result entry; none dropped');
  const hung = results.find((r) => r.id === 'h-hung');
  assert.equal(hung.ok, false);
  assert.equal(hung.timedOut, true, 'honest timeout flag');
  assert.equal(hung.aborted, undefined, 'timeout is NOT mislabeled as abort');
  assert.match(hung.error, /timed out after 60ms/i);
  const good = results.find((r) => r.id === 'h-good');
  assert.equal(good.ok, true, 'sibling result survived the hang');
  assert.equal(good.result, 'good-result');

  const hungHooks = seen.find((s) => s.id === 'h-hung').hooks;
  assert.equal(hungHooks.signal.aborted, true, 'hung child received abort — no orphaned work');

  const notice = notices.find((n) => n.subagentId === 'h-hung');
  assert.ok(notice, 'timeout is never silent');
  assert.match(notice.text, /timed out/i);
  assert.match(notice.text, /retry/i);
});

test('v1123: parent abort stops every child (no orphans) and yields honest aborted results', async () => {
  sa.clearSubagents();
  clearBus();
  const notices = [];
  const children = [];
  const ac = new AbortController();

  const batch = runner.runSubagentBatch([task('a-1', 'A1'), task('a-2', 'A2')], {
    ledger: true,
    timeoutMs: 2000,
    signal: ac.signal,
    notice: (n) => notices.push(n),
    runner: (t, hooks) => {
      let observed = false;
      hooks.signal.addEventListener('abort', () => { observed = true; });
      children.push({ id: t.id, isStopped: () => observed });
      return new Promise((resolve) => {
        if (hooks.signal.aborted) return resolve('stopped');
        hooks.signal.addEventListener('abort', () => resolve('stopped'), { once: true });
      });
    },
  });

  await delay(20);
  assert.equal(children.length, 2, 'both children spawned before the abort');
  ac.abort();
  const results = await batch;

  assert.equal(results.length, 2);
  for (const r of results) {
    assert.equal(r.ok, false);
    assert.equal(r.aborted, true, `${r.id} honestly reported as aborted`);
    assert.equal(r.timedOut, undefined, 'abort is NOT mislabeled as a timeout');
    assert.match(r.error, /aborted by the parent/i);
  }
  assert.ok(children.every((c) => c.isStopped()), 'every child observed the abort — no orphaned processes');

  await delay(20);
  for (const id of ['a-1', 'a-2']) {
    const rec = sa.getSubagent(id);
    assert.ok(rec, 'ledger record exists');
    assert.equal(rec.status, 'aborted', 'ledger says aborted, not error');
    assert.equal(notices.filter((n) => n.subagentId === id).length, 1, 'one consumer abort notice');
    const bus = busEvents().filter((e) => e.type === 'notice' && e.notice?.subagentId === id);
    assert.equal(bus.length, 1, 'exactly one bus notice — no duplicate events');
    assert.match(bus[0].notice.text, /ABORTED/);
  }
});

test('v1123: ledger-backed failure broadcasts exactly ONE bus notice (no duplicate)', async () => {
  sa.clearSubagents();
  clearBus();
  const notices = [];
  const results = await runner.runSubagentBatch([task('d-fail', 'D')], {
    ledger: true,
    timeoutMs: 400,
    notice: (n) => notices.push(n),
    runner: async () => { throw new Error('boom'); },
  });

  await delay(20);
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].error, 'boom');
  assert.equal(notices.length, 1, 'one consumer notice');
  const bus = busEvents().filter((e) => e.type === 'notice' && e.notice?.subagentId === 'd-fail');
  assert.equal(bus.length, 1, 'finalize owns the single canonical bus notice — no duplicate');
  const rec = sa.getSubagent('d-fail');
  assert.equal(rec.status, 'error');
  assert.equal(rec.error, 'boom');
});

test('v1123: a throwing event/notice consumer cannot turn a successful child into a failed parent', async () => {
  sa.clearSubagents();
  clearBus();
  const results = await runner.runSubagentBatch([task('c-1', 'C1')], {
    ledger: false,
    timeoutMs: 400,
    emit: () => { throw new Error('renderer listener exploded'); },
    notice: () => { throw new Error('notice listener exploded'); },
    runner: async (_t, hooks) => { hooks.progress(1, 1, 'step'); return 'child-ok'; },
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true, 'consumer exception was not misattributed as the child error');
  assert.equal(results[0].result, 'child-ok');
  assert.equal(results[0].error, undefined);
});

test('v1123: an already-aborted parent yields immediate honest aborted results (no unhandled rejection)', async () => {
  sa.clearSubagents();
  clearBus();
  const ac = new AbortController();
  ac.abort();
  const children = [];
  const unhandled = [];
  const onUnhandled = (err) => unhandled.push(err);
  process.on('unhandledRejection', onUnhandled);
  let results;
  try {
    results = await runner.runSubagentBatch([task('pre-1', 'Pre')], {
      ledger: false,
      timeoutMs: 400,
      signal: ac.signal,
      runner: (t, hooks) => {
        children.push(hooks.signal.aborted);
        // Reject AFTER the race has settled — must not crash the parent.
        return new Promise((_resolve, reject) => setTimeout(() => reject(new Error('late child rejection')), 5));
      },
    });
    await delay(20);
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].aborted, true);
  assert.match(results[0].error, /aborted by the parent/i);
  assert.deepEqual(children, [true], 'child signal was already aborted before it ran');
  assert.equal(unhandled.length, 0, 'late child rejection was observed, not unhandled');
});

test('v1123: detached runner uses the batch deadline and an abortable child signal', () => {
  const src = readFileSync(join(ROOT, 'electron/agent/subagentRunner.ts'), 'utf8');
  assert.match(src, /externalDeadline/);
  assert.match(src, /const boundMs = batchHooks\.externalDeadline && hooks\.signal \? 0 : timeoutMs/);
  assert.match(src, /signal: controller\.signal/);
  assert.match(src, /onTimeout: \(\) => \{ timedOut = true; controller\.abort\(\); \}/);
  assert.match(src, /onAbort: \(\) => \{ aborted = true; controller\.abort\(\); \}/);
});

after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
