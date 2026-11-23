import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.12 — SUBAGENT DASHBOARD ledger verification (offline).
//   node --test tests/v1112-subagents.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1112-subagents-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN,
    entry,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${out}`,
    '--external:electron',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// electron stub — the ledger guards BrowserWindow/ipcMain and uses app.getPath.
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `module.exports = { app: { getPath: () => ${JSON.stringify(join(tmp, 'ud'))} } };`);

const mod = join(tmp, 'subagents.cjs');
bundle(join(ROOT, 'electron/agent/subagents.ts'), mod);
const sa = require(mod);

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('v11.12: start → progress → finish keeps a durable record with duration', async () => {
  sa.clearSubagents();
  const rec = sa.startSubagent({
    label: 'Code Reviewer',
    role: 'review',
    description: 'Review diff',
    prompt: 'Find bugs in the diff',
    total: 10,
    workspace: join(tmp, 'ws'),
    sessionId: 's1',
  });
  assert.equal(rec.status, 'running');
  assert.equal(rec.role, 'review');
  assert.equal(rec.prompt, 'Find bugs in the diff');
  await flush();

  sa.progressSubagent(rec.id, 4, 10);
  await flush();
  sa.finishSubagent(rec.id, 'Found 2 issues');
  await flush();

  const got = sa.getSubagent(rec.id);
  assert.ok(got, 'record persisted');
  assert.equal(got.status, 'done');
  assert.equal(got.done, 4);
  assert.equal(got.total, 10);
  assert.ok(got.durationMs >= 0);
  assert.equal(got.summary, 'Found 2 issues');
});

test('v11.12: fail marks status error and keeps the reason', async () => {
  sa.clearSubagents();
  const rec = sa.startSubagent({ label: 'Debugger', role: 'debugger', description: 'Fix crash', prompt: 'Reproduce and fix', workspace: join(tmp, 'ws'), sessionId: 's2' });
  await flush();
  sa.failSubagent(rec.id, 'model call failed');
  await flush();
  const got = sa.getSubagent(rec.id);
  assert.equal(got.status, 'error');
  assert.equal(got.error, 'model call failed');
});

test('v11.12: retry re-runs the SAME prompt in a fresh record (attempt+1)', async () => {
  sa.clearSubagents();
  // Deterministic fake launcher (no model call in this offline test).
  sa.setSubagentRetryLauncher(async (record, hooks) => {
    hooks.progress(2, 5);
    return 'retry complete';
  });
  const rec = sa.startSubagent({ label: 'Implementer', role: 'implement', description: 'Do X', prompt: 'Implement X exactly', workspace: join(tmp, 'ws'), sessionId: 's3' });
  await flush();
  sa.failSubagent(rec.id, 'failed first time');
  await flush();

  const res = sa.retrySubagent(rec.id);
  assert.equal(res.ok, true);
  assert.ok(res.id && res.id !== rec.id, 'new record id');
  await flush();
  const fresh = sa.getSubagent(res.id);
  assert.ok(fresh);
  assert.equal(fresh.prompt, rec.prompt, 'same prompt');
  assert.equal(fresh.role, rec.role, 'same role');
  assert.equal(fresh.attempt, 1, 'attempt incremented');
  await flush();
  const done = sa.getSubagent(res.id);
  assert.equal(done.status, 'done');
  assert.equal(done.done, 2);
  sa.setSubagentRetryLauncher(null);
});

test('v11.12: list is newest-first and scoped by workspace', async () => {
  sa.clearSubagents();
  const wsA = join(tmp, 'wsA');
  const wsB = join(tmp, 'wsB');
  const a = sa.startSubagent({ label: 'A', role: 'general', description: 'a', prompt: 'a', workspace: wsA, sessionId: 's' });
  await flush();
  const b = sa.startSubagent({ label: 'B', role: 'general', description: 'b', prompt: 'b', workspace: wsB, sessionId: 's' });
  await flush();
  const all = sa.listSubagents();
  assert.equal(all[0].id, b.id, 'newest first');
  const scoped = sa.listSubagents(wsA);
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].id, a.id);
});

test.after(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});
