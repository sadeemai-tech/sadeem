import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// v11.15 — LONG RUN / CONTINUITY / FULL-APPROVAL contract tests.
//
// The founder's requirement: "مهام طويلة طويلة ... بدون انقطاع حتى ينهيها
// أو أوقفه أنا" — very long tasks must continue across many tool calls,
// steps and compactions until the model finishes or the USER aborts.
//
// These tests exercise the REAL modules (esbuild-bundled from TS, same
// posture as v1110-endurance.test.mjs):
//   • budget.ts      — raised verification ceilings + explicit longRun tier
//   • longRun.ts     — flag resolution, raised ceilings, absolute clamp,
//                      rolling continuity ledger across compaction boundaries
//   • engineGates.ts — real RunGates data + full-approval mode resolution
//   • hooks.ts       — PreCompact hook receives the continuity snapshot
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1115-'));

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

const budgetPath = join(tmp, 'budget.cjs');
const longRunPath = join(tmp, 'longRun.cjs');
const gatesPath = join(tmp, 'engineGates.cjs');
const hooksPath = join(tmp, 'hooks.cjs');
bundle('electron/agent/budget.ts', budgetPath);
bundle('electron/agent/longRun.ts', longRunPath);
bundle('electron/agent/engineGates.ts', gatesPath);
bundle('electron/agent/hooks.ts', hooksPath);

const budget = require(budgetPath);
const longRun = require(longRunPath);
const gates = require(gatesPath);
const hooks = require(hooksPath);

const HOUR = 60 * 60_000;

// ------------------------------------------------------------
// 1) Verification-budget ceilings (the 429-proof gates get real room)
// ------------------------------------------------------------

test('v1115 budget: baseline + long-run verification ceilings are raised, explicit config wins', () => {
  const base = new budget.VerificationBudget();
  assert.deepEqual(base.limits, { maxGateCalls: 24, maxGateUsd: 1.5, maxGateMs: 30 * 60_000 });
  assert.match(base.label(), /24 verdicts/);

  const lr = new budget.VerificationBudget({ longRun: true });
  assert.equal(lr.limits.maxGateCalls, 96);
  assert.equal(lr.limits.maxGateUsd, 5);
  assert.equal(lr.limits.maxGateMs, 120 * 60_000);

  // Explicit per-run config is ALWAYS honored (v71-proven.test.mjs relies on it).
  const explicit = new budget.VerificationBudget({ longRun: true, maxGateCalls: 3, maxGateUsd: 0.02 });
  assert.equal(explicit.limits.maxGateCalls, 3);
  assert.equal(explicit.limits.maxGateUsd, 0.02);

  // The strict task budget is unchanged: a real ceiling, still reported honestly.
  const tb = budget.taskBudgetCheck(2, 1);
  assert.equal(tb.exceeded, true);
  assert.match(tb.reason, /budget exhausted/);
});

// ------------------------------------------------------------
// 2) Long Run flag + ceilings (hours, with a hard absolute clamp)
// ------------------------------------------------------------

test('v1115 longRun: flag resolution (setting OR env), default stays baseline', () => {
  assert.equal(longRun.longRunEnabled({ env: {}, settings: {} }), false);
  assert.equal(longRun.longRunEnabled({ env: { SURNIA_LONG_RUN: '1' }, settings: {} }), true);
  assert.equal(longRun.longRunEnabled({ env: { SURNIA_LONG_RUN: 'true' }, settings: {} }), true);
  assert.equal(longRun.longRunEnabled({ env: {}, settings: { agent: { longRunMode: true } } }), true);
  assert.equal(longRun.longRunEnabled({ env: {}, settings: { agent: { longRunMode: false } } }), false);

  const d = longRun.resolveLongRunLimits({ env: {}, settings: {} });
  assert.equal(d.enabled, false);
  assert.equal(d.maxTurns, longRun.BASELINE_LIMITS.maxTurns);
  assert.equal(d.maxContinueRounds, longRun.BASELINE_LIMITS.maxContinueRounds);
  assert.equal(d.runWallClockCapMs, 5 * HOUR);
});

test('v1115 longRun: enabled ceilings are hours, not minutes, and clamped', () => {
  const l = longRun.resolveLongRunLimits({ env: {}, settings: { agent: { longRunMode: true } } });
  assert.equal(l.enabled, true);
  assert.equal(l.source, 'flag');
  assert.equal(l.maxTurns, 400);
  assert.equal(l.maxContinueRounds, 200);          // engine's own hard ceiling
  assert.equal(l.runWallClockCapMs, 8 * HOUR);     // 8 hours
  assert.equal(l.timeCapGraceMs, 15 * 60_000);
  assert.equal(l.maxOutputContinues, 60);
  assert.equal(l.maxPauseContinues, 120);
  assert.equal(l.streamContinueBudget, 16);

  // A runaway env value is clamped to the generous absolute ceiling (24h).
  const huge = longRun.resolveLongRunLimits({ env: { SURNIA_MAX_RUN_MS: '999999999999' } });
  assert.equal(huge.runWallClockCapMs, longRun.ABSOLUTE_MAX_RUN_MS);
  // 0 = operator explicitly disabled the cap (still honored).
  const off = longRun.resolveLongRunLimits({ env: { SURNIA_MAX_RUN_MS: '0' } });
  assert.equal(off.runWallClockCapMs, 0);
  // Explicit ops value still respected (v1110 endurance uses 120000).
  const small = longRun.resolveLongRunLimits({ env: { SURNIA_MAX_RUN_MS: '120000' } });
  assert.equal(small.runWallClockCapMs, 120_000);
});

test('v1115 longRun: tuning overrides raise the step budget without disabling continueAuto', () => {
  const off = longRun.agentTuningOverrides({ env: {}, settings: {} });
  assert.equal(off.maxTurns, 120);
  assert.equal(off.maxContinueRounds, 30);
  assert.equal(off.verificationBudget.maxGateCalls, 24);

  const on = longRun.agentTuningOverrides({ env: {}, settings: { agent: { longRunMode: true } } });
  assert.equal(on.maxTurns, 400);
  assert.equal(on.maxContinueRounds, 200);
  assert.equal(on.continueAuto, true);
  assert.equal(on.verificationBudget.maxGateCalls, 96);

  // A user's explicit verification budget is never clobbered.
  const custom = longRun.agentTuningOverrides({
    env: {},
    settings: { agent: { longRunMode: true, verificationBudget: { maxGateCalls: 7, maxGateUsd: 0.9 } } },
  });
  assert.equal(custom.verificationBudget.maxGateCalls, 7);
  assert.equal(custom.verificationBudget.maxGateUsd, 0.9);
});

test('v1115 longRun: applyLongRunEnv sets engine knobs but never overwrites explicit values', () => {
  const env = { SURNIA_LONG_RUN: '1' };
  const applied = longRun.applyLongRunEnv({ env, settings: {} });
  assert.ok(applied.includes('SURNIA_MAX_RUN_MS'));
  assert.ok(applied.includes('SURNIA_MAX_TOKENS_CONTINUES'));
  assert.equal(env.SURNIA_MAX_RUN_MS, String(8 * HOUR));
  assert.equal(env.SURNIA_PAUSE_CONTINUES, '120');

  const explicit = { SURNIA_LONG_RUN: '1', SURNIA_MAX_RUN_MS: '60000' };
  longRun.applyLongRunEnv({ env: explicit, settings: {} });
  assert.equal(explicit.SURNIA_MAX_RUN_MS, '60000', 'operator value preserved');

  assert.deepEqual(longRun.applyLongRunEnv({ env: {}, settings: {} }), [], 'no side effects when disabled');
});

// ------------------------------------------------------------
// 3) Compaction continuity — real data crosses the boundary
// ------------------------------------------------------------

const head = [
  { role: 'user', text: '[Previous running summary] ignore me' },
  { role: 'user', text: 'Build the v11.15 long-run engine and keep it alive across compactions' },
  { role: 'assistant', text: 'Working on it', toolCalls: [{ name: 'edit' }] },
  { role: 'tool_result', content: 'edited engine' },
];

test('v1115 continuity: original task is recovered (never the literal "chat") and carried', () => {
  const led = new longRun.ContinuityLedger();
  const task = led.captureOriginalTask(head, [{ role: 'user', text: '[Conversation auto-compacted] noise' }, ...head]);
  assert.match(task, /Build the v11\.15 long-run engine/);
  assert.notEqual(task, 'chat');
  assert.equal(led.snapshot().originalTask, task);
});

test('v1115 continuity: decisions / files / pending steps / commands are bounded and deduped', () => {
  const led = new longRun.ContinuityLedger();
  led.setOriginalTask('Ship the feature');
  led.addDecision('Use a rolling ledger instead of re-reading the transcript');
  led.addDecision('Use a rolling ledger instead of re-reading the transcript'); // dedupe
  led.addPendingStep('Run the full test suite');
  led.addFile('/repo/electron/agent/engine.ts');
  led.addTestCommand('node --test tests/v1115-longrun.test.mjs');

  const s = led.snapshot();
  assert.equal(s.decisions.length, 1, 'duplicate decision collapsed');
  assert.ok(s.filesTouched.includes('/repo/electron/agent/engine.ts'));
  assert.ok(s.pendingSteps.includes('Run the full test suite'));
  assert.ok(s.testCommands.includes('node --test tests/v1115-longrun.test.mjs'));
  assert.equal(s.generations, 0);
});

test('v1115 continuity: merging a previous snapshot preserves old data across boundaries', () => {
  const led = new longRun.ContinuityLedger();
  led.setOriginalTask('Original user goal');
  led.addDecision('Decision from compaction #1');
  led.addPendingStep('Old pending step');
  const first = led.snapshot();

  const led2 = new longRun.ContinuityLedger();
  led2.setOriginalTask('Original user goal');
  led2.addDecision('Decision from compaction #2');
  const merged = led2.restore(first);

  assert.equal(merged.generations, 1, 'boundary count advanced');
  assert.ok(merged.decisions.includes('Decision from compaction #1'), 'old decision survived');
  assert.ok(merged.decisions.includes('Decision from compaction #2'), 'new decision present');
  assert.ok(merged.pendingSteps.includes('Old pending step'), 'old pending step survived');
  assert.equal(merged.originalTask, 'Original user goal');
});

test('v1115 continuity: preamble always keeps the original task, even at a tiny budget', () => {
  const led = new longRun.ContinuityLedger();
  led.setOriginalTask('Build the v11.15 long-run engine');
  led.addPendingStep('Finish the continuity preamble');
  led.addDecision('Raise the ceilings, keep abort');
  const full = led.preamble();
  assert.match(full, /ORIGINAL TASK/);
  assert.match(full, /Build the v11\.15 long-run engine/);
  assert.match(full, /PENDING \/ NEXT STEPS/);
  assert.match(full, /DECISIONS MADE/);
  assert.ok(full.length <= 6_000);

  const tight = led.preamble(220);
  assert.match(tight, /ORIGINAL TASK/);
  assert.match(tight, /Build the v11\.15 long-run engine/, 'task survives a 220-char budget');
  assert.ok(tight.length <= 220);
});

test('v1115 continuity: RunGates captures REAL file/command data into the snapshot', async () => {
  const ws = join(tmp, 'ws');
  mkdirSync(ws, { recursive: true });
  const file = join(ws, 'edited.ts');
  writeFileSync(file, 'export const a = 1;\n');

  const g = gates.createRunGates('v1115-session');
  await g.recordTouch(file, 'export const a = 1;\n');
  g.reportSpan(file, 1, 1);
  g.recordCommand('npm test -- --run', 0, 'all pass', 12);
  g.recordTestRun('verify', 'node --test tests/v1115-longrun.test.mjs', 0, 'ok', 5);
  g.recordDecision('Keep the abort path untouched');
  g.recordPendingStep('Report exact engine.ts lines to parent');

  const snap = g.continuitySnapshot('Real original user request');
  assert.ok(snap.filesTouched.includes(file), 'real touched file present');
  assert.ok(snap.testCommands.some((c) => c.includes('npm test')), 'real test command present');
  assert.ok(snap.decisions.includes('Keep the abort path untouched'));
  assert.ok(snap.pendingSteps.includes('Report exact engine.ts lines to parent'));
  assert.equal(snap.originalTask, 'Real original user request');

  // The snapshot crosses a second boundary via restore — generation advances.
  const again = g.restoreContinuity(snap);
  assert.equal(again.generations, 1);
  assert.ok(again.filesTouched.includes(file), 'file still present after restore');
  gates.clearRunGates('v1115-session');
});

// ------------------------------------------------------------
// 4) Full-approval bug — mode is honored for the WHOLE run
// ------------------------------------------------------------

test('v1115 approval: an explicit fullAccess survives a stale plan-approval override', () => {
  assert.equal(
    gates.resolvePermissionMode({ paramsMode: 'fullAccess', settingsMode: 'fullAccess', sessionOverride: 'default' }),
    'fullAccess',
  );
  assert.equal(
    gates.resolvePermissionMode({ paramsMode: 'fullAccess', settingsMode: 'fullAccess', sessionOverride: 'autoEdit' }),
    'fullAccess',
  );
  // Read-only 'plan' is safety and still wins over fullAccess.
  assert.equal(
    gates.resolvePermissionMode({ paramsMode: 'fullAccess', settingsMode: 'fullAccess', sessionOverride: 'plan' }),
    'plan',
  );
  // Without an explicit fullAccess, the override keeps its old precedence.
  assert.equal(
    gates.resolvePermissionMode({ paramsMode: 'autoEdit', settingsMode: 'default', sessionOverride: 'default' }),
    'default',
  );
});

test('v1115 approval: shouldAutoApprove honors fullAccess even when force=true', () => {
  // THE BUG: engine.ts:2199 required `req.force !== true`, so these prompted.
  assert.equal(gates.shouldAutoApprove('fullAccess', 'command', { force: true }), true);
  assert.equal(gates.shouldAutoApprove('fullAccess', 'write', { force: true }), true);
  assert.equal(gates.shouldAutoApprove('fullAccess', 'delete', { force: true }), true);
  assert.equal(gates.shouldAutoApprove('fullAccess', 'mcp'), true);
  assert.equal(gates.shouldAutoApprove('default', 'command', { fullApproval: true }), true);

  // Other modes keep their existing posture.
  assert.equal(gates.shouldAutoApprove('autoEdit', 'write'), true);
  assert.equal(gates.shouldAutoApprove('autoEdit', 'write', { force: true }), false);
  assert.equal(gates.shouldAutoApprove('autoEdit', 'command'), false);
  assert.equal(gates.shouldAutoApprove('default', 'write'), false);
  assert.equal(gates.shouldAutoApprove('plan', 'write'), false, 'plan is never bypassed');
  assert.equal(gates.shouldAutoApprove('read', 'command'), false, 'read is never bypassed');
});

// ------------------------------------------------------------
// 5) PreCompact hook receives continuity (optional, backward-compatible)
// ------------------------------------------------------------

test('v1115 hooks: PreCompact payload carries continuity when supplied; legacy call unchanged', async () => {
  const ws = join(tmp, 'hook-ws');
  mkdirSync(ws, { recursive: true });
  const out = join(tmp, 'precompact-payload.json');
  const script = join(tmp, 'capture.js');
  writeFileSync(script, `const fs=require('fs');let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>fs.writeFileSync(process.argv[2],s));`);
  // Unquoted: cmd.exe /s /c (Windows) would otherwise keep the quotes as
  // literal characters of the argument. The temp path has no spaces.
  const cfg = { PreCompact: [{ command: `node ${script} ${out}` }] };

  await hooks.runPreCompactHooks(cfg, ws, 'sid-1', 'manual', {
    originalTask: 'Build the thing',
    pendingSteps: ['Finish it'],
  });
  assert.equal(existsSync(out), true, 'hook ran and wrote the payload');
  const payload = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(payload.hook, 'PreCompact');
  assert.equal(payload.reason, 'manual');
  assert.equal(payload.continuity.originalTask, 'Build the thing');
  assert.ok(payload.continuity.pendingSteps.includes('Finish it'));

  // Legacy 4-arg callers get exactly the old payload shape.
  const out2 = join(tmp, 'precompact-legacy.json');
  const cfg2 = { PreCompact: [{ command: `node ${script} ${out2}` }] };
  await hooks.runPreCompactHooks(cfg2, ws, 'sid-2', 'token-limit');
  const legacy = JSON.parse(readFileSync(out2, 'utf8'));
  assert.equal(legacy.continuity, undefined);
});

test('after: clean temp dir', () => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
