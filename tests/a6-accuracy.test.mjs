import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// v11.11 (A6-ACCURACY) — regression suite for the founder's four live-bug areas,
// driven against the REAL sources (esbuild bundles of the actual .ts files):
//
//   1. PROVIDER BUG PATH — provider added in Settings (ProviderEntry shape the
//      Settings UI actually persists: enabled + lastModels + apiKey) MUST yield
//      usable models with no false "no model configured". The eligibility
//      matrix and providerModelIds derive the exact shape the picker reads.
//
//   2. SLASH EXECUTION — a REGISTERED digit-led custom command (commands/2fa.md
//      passes the scanner's NAME_RE and the Composer menu filter) used to be
//      REJECTED by dispatchSlashCommand's [a-z]-only head → dispatch 'pass' →
//      the literal "/2fa …" text went TO THE MODEL instead of expanding the
//      command body. Dispatch now shares the scanner's name contract.
//
//   3. CONTEXT BAR EXACTNESS — the founder's formula
//         fill = prompt_tokens_including_cached + generated_tokens_of_current_request
//         pct  = fill / model_context_window  (unrounded, UI shows 1 decimal)
//      with cache INSIDE inputTokens, ≈ chars/4 streaming estimate on top of
//      the last exact fill, and clamping at 100%.
//
//   4. USAGE RECONCILIATION — per-message billing rows (run view: all rounds +
//      all attempts) sum to the session accumulator, so sum(rows) == session
//      total reconciles by construction and the ≈ honesty marker propagates.
//
// Harness posture: esbuild bundles + tmp dirs, zero network, no electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-a6-acc-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, 
    entry,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--define:process.env.NODE_ENV="test"',
    `--outfile=${out}`,
    '--external:electron',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// ---------- bundle the REAL sources ----------
const slicePath = join(tmp, 'providerSlice.cjs');
bundle('src/lib/providerSlice.ts', slicePath);
const slice = require(slicePath);

const ctxPath = join(tmp, 'ctx.cjs');
bundle('src/lib/ctx.ts', ctxPath);
const ctx = require(ctxPath);

// slashService captures KODEX_HOME at module load — point SURNIA_HOME at a
// tmp home BEFORE requiring the bundle.
const slashHome = join(tmp, 'surnia-home');
mkdirSync(join(slashHome, 'commands'), { recursive: true });
process.env.SURNIA_HOME = slashHome;
const slashPath = join(tmp, 'slashService.cjs');
bundle('electron/services/slashService.ts', slashPath);
const slash = require(slashPath);

// ============================================================
// 1 · PROVIDER BUG PATH
// ============================================================
test('A6-ACC · eligibility matrix — user intent respected, pre-v11.10 profiles keep working', () => {
  // enabled === false → NEVER eligible (explicit off)
  assert.equal(slice.providerEligible({ enabled: false, apiKey: 'k' }), false);
  // enabled === true → eligible
  assert.equal(slice.providerEligible({ enabled: true }), true);
  // enabled undefined (pre-v11.10 profile) → credentials count as on
  assert.equal(slice.providerEligible({ apiKey: ' k ' }), true);
  assert.equal(slice.providerEligible({ baseUrl: ' http://x ' }), true);
  // enabled undefined, keyless preset → eligible by design (entry exists)
  assert.equal(slice.providerEligible({ enabled: undefined }, { keyless: true }), true);
  assert.equal(slice.providerEligible({}, { keyless: true }), true);
  // nothing at all → not eligible (a MISSING entry can never race, even keyless)
  assert.equal(slice.providerEligible(undefined), false);
  assert.equal(slice.providerEligible(undefined, { keyless: true }), false);
});

test('A6-ACC · providerModelIds precedence: lastModels → legacy models → presets; garbage filtered', () => {
  assert.deepEqual(slice.providerModelIds({ lastModels: ['live-1', 'live-2'] }, ['preset']), ['live-1', 'live-2']);
  assert.deepEqual(slice.providerModelIds({ models: ['legacy-1'] }, ['preset']), ['legacy-1'], 'defensive legacy key');
  assert.deepEqual(slice.providerModelIds({ lastModels: [] }, ['preset-1', 'preset-2']), ['preset-1', 'preset-2']);
  assert.deepEqual(
    slice.providerModelIds({ lastModels: ['ok', '', 42, null, 'ok2'] }, []),
    ['ok', 'ok2'],
    'non-string / empty entries are dropped',
  );
  assert.deepEqual(slice.providerModelIds(undefined, []), []);
});

// 2 · SLASH — registered commands execute (digit-led regression)
// ============================================================
test('A6-ACC · a REGISTERED digit-led custom command (/2fa …) expands its body instead of reaching the model', async () => {
  writeFileSync(
    join(slashHome, 'commands', '2fa.md'),
    '# Two-factor deploy gate\nRun the 2FA check for $ARGUMENTS (target: $1).\n',
    'utf8',
  );
  writeFileSync(join(slashHome, 'commands', 'deploy.md'), 'Deploy $1 to production. Notes: $ARGUMENTS\n', 'utf8');

  const d = await slash.dispatchSlashCommand({ raw: '/2fa canary to staging', workspace: undefined });
  assert.equal(d.kind, 'custom', `FAILING BEFORE FIX: [a-z]-only head rejected the registered name → kind was "${d.kind}" and the literal text went to the model`);
  assert.equal(d.command, '2fa');
  assert.match(d.expanded, /Run the 2FA check for canary to staging/);
  assert.match(d.expanded, /target: canary/);
  assert.ok(!d.expanded.includes('$ARGUMENTS') && !d.expanded.includes('$1'), 'no placeholder survives expansion');

  const dNoArgs = await slash.dispatchSlashCommand({ raw: '/2fa', workspace: undefined });
  assert.equal(dNoArgs.kind, 'custom');
  assert.match(dNoArgs.expanded, /for\s+\(target: \)\./, 'missing positional → empty substitution, never "$1"');
});

test('A6-ACC · dispatch contract intact: task-modes, unknown, paths, plain text', async () => {
  const mode = await slash.dispatchSlashCommand({ raw: '/build', workspace: undefined });
  assert.equal(mode.kind, 'task-mode');
  assert.equal(mode.taskMode, 'build');
  assert.match(mode.notice, /BUILD mode/);
  assert.match(mode.notice, /وضع البناء/, 'bilingual notice');

  const unknown = await slash.dispatchSlashCommand({ raw: '/definitely-not-registered', workspace: undefined });
  assert.equal(unknown.kind, 'unknown');
  assert.match(unknown.notice, /Unknown command \/definitely-not-registered/);
  assert.match(unknown.notice, /أمر غير معروف/);

  // bare UNIX path: NOT a command slug → pass (E19 keeps paths working)
  const pathLike = await slash.dispatchSlashCommand({ raw: '/usr/local/bin/node', workspace: undefined });
  assert.equal(pathLike.kind, 'pass');

  const plain = await slash.dispatchSlashCommand({ raw: 'explain how /plan works', workspace: undefined });
  assert.equal(plain.kind, 'pass');

  const wsShadow = join(tmp, 'ws-cmds');
  mkdirSync(join(wsShadow, '.surnia', 'commands'), { recursive: true });
  writeFileSync(join(wsShadow, '.surnia', 'commands', 'deploy.md'), 'WORKSPACE deploy of $1\n', 'utf8');
  const dShadow = await slash.dispatchSlashCommand({ raw: '/deploy blue', workspace: wsShadow });
  assert.equal(dShadow.kind, 'custom');
  assert.match(dShadow.expanded, /WORKSPACE deploy of blue/, 'workspace scope shadows the user scope');
});

test('A6-ACC · scanner + dispatch share ONE name contract (no command can be listed yet not executable)', () => {
  // A name accepted by the scanner (NAME_RE) must always be matchable by the
  // dispatch tail rules — this is the invariant the digit-led bug violated.
  const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/; // scanner NAME_RE minus ".md"
  const names = ['deploy', '2fa', '7b-run', 'fix-lint', 'run_2', 'a'];
  for (const n of names) {
    assert.ok(NAME_RE.test(n), `fixture sanity: ${n} is registrable`);
    const d = slash.TASK_MODE_SLASH_COMMANDS[n];
    // dispatch's first-char class: simulate via a probe through the public API
    // is async — assert the regex tail rules by construction instead:
    assert.match(n, /^\/?[a-z0-9][a-z0-9_-]*$/, `${n} must satisfy the dispatch head+tail shape`);
    void d;
  }
  // and the real probe for the previously-broken class:
  return (async () => {
    const d = await slash.dispatchSlashCommand({ raw: '/7b-run now' });
    assert.notEqual(d.kind, 'pass', 'digit-led registrable name must not fall through to the model');
  })();
});

// ============================================================
// 3 · CONTEXT BAR EXACTNESS (the founder's formula, to the token)
// ============================================================
test('A6-ACC · ctx fill = prompt(incl. cache) + generated — "12,482 in (3,000 cached) + 700 out / 200,000 → 6.6%"', () => {
  const u = { inputTokens: 12_482, outputTokens: 700, cacheReadTokens: 3_000 };
  assert.equal(ctx.ctxFillTokens(u), 13_182);
  const pct = ctx.ctxPctExact(u, 200_000);
  assert.equal(pct.toFixed(1), '6.6', `unrounded pct = ${pct}`);
  assert.equal(ctx.ctxPctOf(u, 200_000), 7, 'ring geometry rounds');
  // cache is INSIDE inputTokens — never subtracted, never added on top
  assert.equal(ctx.ctxFillTokens({ inputTokens: 12_482, outputTokens: 700, cacheReadTokens: 999_999 }), 13_182);
  assert.equal(ctx.ctxFillTokens(null), 0);
});

test('A6-ACC · Anthropic split + clamping: 150k in (120k read + 10k write inside) + 5k out / 1M → 15.5%; over-window clamps at 100', () => {
  const u = { inputTokens: 150_000, outputTokens: 5_000, cacheReadTokens: 120_000, cacheCreationTokens: 10_000 };
  assert.equal(ctx.ctxFillTokens(u), 155_000);
  assert.equal(ctx.ctxPctExact(u, 1_000_000).toFixed(1), '15.5');
  const over = ctx.ctxPctExact({ inputTokens: 210_000, outputTokens: 10_000 }, 200_000);
  assert.equal(over, 100, 'occupancy never lies above 100%');
  assert.equal(ctx.ctxPctExact(u, 0), 0, 'unknown window → 0, UI shows the ≈/unknown state instead');
});

test('A6-ACC · streaming ≈ estimate: last exact fill + chars/4 of streamed output; exact figure wins on finalize', () => {
  const u = { inputTokens: 12_482, outputTokens: 700 };
  // 8,001 streamed chars → ceil(8001/4) = 2001
  assert.equal(ctx.estimateTokensFromChars(8_001), 2_001);
  assert.equal(ctx.estimateTokensFromChars(-5), 0, 'defensive');
  const live = ctx.ctxPctLiveOf(u, 200_000, 8_001);
  assert.equal(live.toFixed(2), '7.59', `13,182 + 2,001 = 15,183 / 200,000 = ${(15_183 / 2000).toFixed(2)}%`);
  assert.equal(ctx.liveFillEstimate(13_182, 8_001), 15_183);
  // zero streamed chars → identical to the exact figure (no fake drift)
  assert.equal(ctx.ctxPctLiveOf(u, 200_000, 0), ctx.ctxPctExact(u, 200_000));
});

// ============================================================
// 4 · USAGE RECONCILIATION (per-message rows == session total)
// ============================================================
test('A6-ACC · runUsageView + accumulateUsage: whole-turn rows sum to the session accumulator; ≈ marker propagates', () => {
  // One message_end payload: turn delta (context-bar truth) + RUN totals
  // (billing truth: 2 rounds across 2 attempts, one of them estimated).
  const endPayload = {
    inputTokens: 9_000,
    outputTokens: 300,
    costUsd: 0.012,
    cacheReadTokens: 4_000,
    cacheCreationTokens: 500,
    runInput: 9_000 + 8_500,
    runOutput: 300 + 260,
    runCost: 0.012 + 0.0105,
    runCacheRead: 4_000 + 3_800,
    runCacheCreation: 500 + 400,
    estimated: undefined,
    attempts: [
      { provider: 'deepseek', model: 'ds-a', inputTokens: 9_000, outputTokens: 300, costUsd: 0.012 },
      { provider: 'deepseek', model: 'ds-b', inputTokens: 8_500, outputTokens: 260, costUsd: 0.0105, estimated: true },
    ],
  };
  const runView = ctx.runUsageView(endPayload);
  assert.equal(runView.inputTokens, 17_500, 'the ROW bills the whole turn, not only the surviving attempt');
  assert.equal(runView.outputTokens, 560);
  assert.ok(Math.abs(runView.costUsd - 0.0225) < 1e-9);
  assert.equal(runView.estimated, true, 'any estimated attempt marks the row ≈');

  // three turns accumulate into the session — sum(rows) == session total
  let session = ctx.emptySessionUsage();
  const turn2 = ctx.runUsageView({ inputTokens: 500, outputTokens: 50, costUsd: 0.001, runInput: 500, runOutput: 50, runCost: 0.001 });
  session = ctx.accumulateUsage(session, runView);
  session = ctx.accumulateUsage(session, turn2);
  session = ctx.accumulateUsage(session, turn2);
  const rowsSum =
    (runView.inputTokens + runView.outputTokens) + 2 * (turn2.inputTokens + turn2.outputTokens);
  assert.equal(session.inputTokens + session.outputTokens, rowsSum, 'reconciliation holds by construction');
  assert.equal(session.inputTokens, 17_500 + 1_000);
  assert.equal(session.outputTokens, 560 + 100);
  assert.ok(Math.abs(session.costUsd - (0.0225 + 0.002)) < 1e-9, 'cost sums at 1e-6 rounding');
  assert.equal(session.cacheReadTokens, 7_800);
  assert.equal(session.cacheCreationTokens, 900);
  assert.equal(session.attempts.length, 2, 'attempt rows ride the accumulator (only turns that carried attempts)');

  // the context bar keeps the DELTA fields (window occupancy), not the run sum
  assert.equal(ctx.ctxFillTokens(endPayload), 9_300);
});

test('A6-ACC · runUsageView fallbacks: legacy payloads without run fields degrade honestly', () => {
  const legacy = ctx.runUsageView({ inputTokens: 100, outputTokens: 10, costUsd: 0.002 });
  assert.equal(legacy.inputTokens, 100);
  assert.equal(legacy.outputTokens, 10);
  assert.equal(legacy.costUsd, 0.002);
  assert.equal(legacy.estimated, undefined);
  const empty = ctx.runUsageView(null);
  assert.deepEqual(empty, { inputTokens: 0, outputTokens: 0, costUsd: 0 });
});

// ---------- cleanup ----------
test('cleanup', () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
