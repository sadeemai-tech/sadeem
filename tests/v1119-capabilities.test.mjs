// ============================================================
// SADEEM v11.19 — NEW DETERMINISTIC CAPABILITIES (offline tests)
//   node --test --test-force-exit tests/v1119-capabilities.test.mjs
// Bundles electron/agent/vibeFlow.ts + electron/agent/cursorIdeas.ts
// with the repo's esbuild shim. No electron, no model call, no IO, no clock.
// ============================================================
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(path.join(tmpdir(), 'sadeem-v1119-capabilities-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${out}`, '--external:electron',
  ], { cwd: ROOT, stdio: 'pipe' });
}

const flowOut = path.join(tmp, 'vibeFlow.cjs');
const ideasOut = path.join(tmp, 'cursorIdeas.cjs');
bundle(path.join(ROOT, 'electron/agent/vibeFlow.ts'), flowOut);
bundle(path.join(ROOT, 'electron/agent/cursorIdeas.ts'), ideasOut);
const flow = require(flowOut);
const ideas = require(ideasOut);

// ------------------------------------------------------------
// 1. contextBudget()
// ------------------------------------------------------------

test('v11.19: contextBudget is deterministic and reports a comfortable budget honestly', () => {
  const input = { estimatedTokens: 100_000, modelWindow: 200_000, reservedTokens: 8_000 };
  const r = flow.contextBudget(input);
  assert.deepEqual(r, flow.contextBudget(input), 'same input → same output');
  assert.equal(r.reservedTokens, 8_000);
  assert.equal(r.usableTokens, 192_000);
  assert.equal(r.usageRatio, 0.52);
  assert.equal(r.headroomTokens, 92_000);
  assert.equal(r.pressure, 'ok');
  assert.equal(r.action, 'none');
  assert.deepEqual(r.keep, []);
  assert.deepEqual(r.drop, []);
  assert.match(r.plan, /No compaction needed/);
  assert.match(r.plan, /52%/);
});

test('v11.19: contextBudget escalates ok → watch → compact → critical', () => {
  const base = { modelWindow: 100_000, reservedTokens: 10_000 }; // usable 90k
  const tiers = [
    [54_000, 'ok'], [63_000, 'watch'], [81_000, 'compact'], [108_000, 'critical'],
  ];
  for (const [estimatedTokens, expected] of tiers) {
    const r = flow.contextBudget({ ...base, estimatedTokens });
    assert.equal(r.pressure, expected, `estimate ${estimatedTokens} → ${expected}`);
  }
  const critical = flow.contextBudget({ ...base, estimatedTokens: 108_000 });
  assert.equal(critical.headroomTokens, 0, 'no fabricated headroom past the window');
  assert.equal(critical.action, 'compact');
  assert.match(critical.plan, /over by 18000 tokens/, 'real overshoot number from input');
  assert.match(critical.plan, /Compact NOW/);
});

test('v11.19: contextBudget keeps pinned essentials and drops the biggest low-value segment first', () => {
  const segments = [
    { id: 'system', tokens: 20_000, kind: 'system', pinned: true },
    { id: 'request', tokens: 2_000, pinned: true, importance: 0.99 },
    { id: 'rules', tokens: 10_000, importance: 0.9 },
    { id: 'summary', tokens: 30_000, importance: 0.2 },
    { id: 'tool-dump', tokens: 40_000, importance: 0.1 },
  ];
  const r = flow.contextBudget({ estimatedTokens: 92_000, modelWindow: 100_000, reservedTokens: 10_000, segments });
  assert.equal(r.pressure, 'critical');
  assert.equal(r.action, 'drop-segments');
  assert.deepEqual(r.keep, ['request', 'system', 'rules', 'summary']);
  assert.deepEqual(r.drop, ['tool-dump'], 'low-importance dump dropped, pinned kept');
  assert.ok(r.notes.some((n) => /marked for drop/.test(n)));
  assert.match(r.plan, /Drop first: tool-dump/);

  // A comfortable window keeps every segment and drops none.
  const calm = flow.contextBudget({ estimatedTokens: 40_000, modelWindow: 100_000, reservedTokens: 10_000, segments });
  assert.equal(calm.action, 'none');
  assert.equal(calm.drop.length, 0);
  assert.equal(calm.keep.length, segments.length);
});

test('v11.19: contextBudget fails honestly on invalid/negative input', () => {
  for (const bad of [
    { estimatedTokens: 'abc', modelWindow: 128_000 },
    { estimatedTokens: 10, modelWindow: 0 },
    {},
    null,
  ]) {
    const r = flow.contextBudget(bad);
    assert.equal(r.pressure, 'unknown');
    assert.equal(r.action, 'none');
    assert.match(r.plan, /Cannot compute a context budget/);
    assert.ok(r.notes.some((n) => /invalid token estimate/.test(n)));
  }
  const neg = flow.contextBudget({ estimatedTokens: -50, modelWindow: 100_000 });
  assert.equal(neg.estimatedTokens, 0, 'negative estimate clamped to zero');
});

// ------------------------------------------------------------
// 2. taskDecomposer()
// ------------------------------------------------------------

test('v11.19: taskDecomposer splits a real request into ordered, verifiable steps', () => {
  const input = {
    request: 'Read src/auth.ts and understand the login flow; fix the null-token bug; add a test for expired sessions; document the change in README.',
    constraints: ['do not edit engine.ts'],
    maxSteps: 6,
  };
  const r = flow.taskDecomposer(input);
  assert.deepEqual(r, flow.taskDecomposer(input), 'same input → same output');
  assert.equal(r.truncated, false);
  assert.equal(r.stepCount, 6);
  assert.deepEqual(r.steps.map((s) => s.title), ['Inspect', 'Inspect', 'Fix', 'Verify', 'Document', 'Verify']);
  assert.deepEqual(r.steps.map((s) => s.index), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(r.steps[0].dependsOn, []);
  assert.deepEqual(r.steps[2].dependsOn, [2], 'linear dependency chain');
  for (const s of r.steps) {
    assert.ok(s.doneWhen && s.doneWhen.length > 10, `step ${s.index} has a done-when check`);
    assert.ok(s.verify && s.verify.length > 5, `step ${s.index} has a suggested check`);
  }
  assert.equal(r.steps[5].title, 'Verify', 'final step is always a verification sweep');
  assert.match(r.totalDoneWhen, /All 6 step checks pass in order/);
  assert.match(r.totalDoneWhen, /respect: do not edit engine\.ts/);
  assert.ok(r.notes.some((n) => /constraint/.test(n)));
});

test('v11.19: taskDecomposer honours step caps and reports truncation', () => {
  const r = flow.taskDecomposer({
    request: 'inspect a; fix b; add c; write d; refactor e; document f; verify g',
    maxSteps: 4,
  });
  assert.equal(r.stepCount, 4, 'cap includes the verification step');
  assert.equal(r.truncated, true);
  assert.equal(r.steps[3].title, 'Verify');
  assert.ok(r.notes.some((n) => /folded into the final verification step/.test(n)));

  const clamped = flow.taskDecomposer({ request: 'Fix the bug', maxSteps: 1 });
  assert.equal(clamped.stepCount, 2, 'maxSteps clamped to a minimum of 2');
  assert.equal(clamped.truncated, false);
  const huge = flow.taskDecomposer({ request: 'x '.repeat(500) + 'fix the bug' });
  assert.equal(huge.truncated, true, 'over-long request text reported, not silently swallowed');
});

test('v11.19: taskDecomposer is honest on empty/bad input', () => {
  for (const bad of [{ request: '' }, { request: '   ' }, {}, null]) {
    const r = flow.taskDecomposer(bad);
    assert.deepEqual(r.steps, []);
    assert.equal(r.stepCount, 0);
    assert.match(r.totalDoneWhen, /no request was provided/);
    assert.ok(r.notes.some((n) => /empty request/.test(n)));
  }
});

// ------------------------------------------------------------
// 3. errorRecoveryHint()
// ------------------------------------------------------------

test('v11.19: errorRecoveryHint classifies real provider errors into concrete actions', () => {
  const rate = ideas.errorRecoveryHint(new Error('Rate limit exceeded: 429 too many requests'), 'streamTurn');
  assert.deepEqual(rate, ideas.errorRecoveryHint(new Error('Rate limit exceeded: 429 too many requests'), 'streamTurn'));
  assert.equal(rate.category, 'rate-limit');
  assert.equal(rate.retryable, true);
  assert.match(rate.nextAction, /Wait a few seconds and retry/);
  assert.match(rate.fallback, /Switch to another provider/);

  const overflow = ideas.errorRecoveryHint(new Error('maximum context length exceeded — prompt too long'), 'chat');
  assert.equal(overflow.category, 'context-overflow');
  assert.equal(overflow.retryable, true);
  assert.match(overflow.nextAction, /Compact/);

  const auth = ideas.errorRecoveryHint(new Error('\x1b[31m401 invalid api key\x1b[0m'), 'chat');
  assert.equal(auth.category, 'auth');
  assert.equal(auth.retryable, false);
  assert.match(auth.nextAction, /Settings/);
  assert.equal(/\x1b/.test(auth.nextAction + auth.fallback + auth.note), false, 'ANSI stripped from untrusted error');
});

test('v11.19: errorRecoveryHint honours status codes and adds tool-specific guidance', () => {
  const unauthorized = ideas.errorRecoveryHint(Object.assign(new Error('boom'), { status: 401 }), 'chat');
  assert.equal(unauthorized.category, 'auth');
  assert.equal(unauthorized.retryable, false);
  assert.match(unauthorized.note, /status 401/);

  const edit = ideas.errorRecoveryHint(new Error('ETIMEDOUT while editing'), 'edit_file');
  assert.equal(edit.category, 'timeout');
  assert.equal(edit.retryable, true);
  assert.match(edit.nextAction, /Re-read the file and retry with an exact match/);

  const shell = ideas.errorRecoveryHint(new Error('permission denied by policy'), 'shell');
  assert.equal(shell.category, 'permission');
  assert.equal(shell.retryable, false);
  assert.match(shell.nextAction, /Split the command/);

  const lsp = ideas.errorRecoveryHint(new Error('ECONNRESET'), 'lsp_definition');
  assert.equal(lsp.category, 'network');
  assert.match(lsp.nextAction, /repo_map\/find_refs/);
});

test('v11.19: errorRecoveryHint fails honestly with no usable error', () => {
  for (const bad of [null, undefined, '', new Error('')]) {
    const h = ideas.errorRecoveryHint(bad, 'unknown-tool');
    assert.equal(h.category, 'unknown');
    assert.equal(h.retryable, false);
    assert.equal(h.tool, 'unknown-tool');
    assert.match(h.note, /No usable error information/);
    assert.ok(h.nextAction.length > 10, 'still offers an honest generic next action');
  }
  assert.equal(ideas.errorRecoveryHint(new Error('boom')).tool, 'unknown', 'missing tool name is reported, not invented');
});

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
