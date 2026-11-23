// ============================================================
// v11.35 (COMPACTION ROOT) — "compacts after two words" ROOT-CAUSE TEST
// ------------------------------------------------------------
// Founder (live): «السي ات اكس compaction انه دائما كل شوي ... يا دوب الذكاء
// الاصطناعي ما حكى كلمتين الا يلا يروح ضاغط الكونتكست ... مش عارف ليه»
//
// V11 added a 90%-of-REAL-window token gate but LEFT an OR'd FIXED small-count
// path in engine.ts: `charsTrigger` gated by `cfg.compactThreshold` (floored at
// 10,000 chars ≈ 2,857 tokens = 0.29% of a 1M window). Whenever a provider
// reported no usage (u.inputTokens === 0), lastRealInputTokens stayed 0 and
// that fixed char cap fired instead — compaction at a tiny fraction of a 1M
// window, i.e. "after two words". V11's green source guards never exercised
// the OR'd branch (they only checked that isCompactionEligible is CALLED).
//
// This suite:
//   1. proves the fixed-count path is GONE from the real engine source;
//   2. evaluates the REAL engine expressions (window resolution + gate) with
//      the real ctx.ts helpers and real costs.ts catalog;
//   3. proves dedupeToolResults (C6) is wired at BOTH streamTurn call sites
//      and is capability-neutral (no message/callId/role/distinct output lost);
//   4. measures the real system-prompt + 145 tool-definition cost that is
//      re-sent every turn and folded into the provider's inputTokens.
// No app source is modified by this test. esbuild bundles the REAL modules.
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const lineOf = (src, needle) => {
  const i = typeof needle === 'string' ? src.indexOf(needle) : src.search(needle);
  return i < 0 ? '?' : src.slice(0, i).split('\n').length;
};
const at = (file, needle) => `${file}:${lineOf(read(file), needle)}`;

const ENGINE_SRC = read('electron/agent/engine.ts');
const CTX_SRC = read('src/lib/ctx.ts');
const PROMPTS_SRC = read('electron/agent/prompts.ts');
const PROVIDERS_SRC = read('electron/agent/providers.ts');

const ENGINE_BUNDLE = join(ROOT, 'tests', '.v1135-engine-exp.bundle.cjs');

/** Bundle the REAL engine.ts with a few internals exported for the cap test.
 *  The injected `export` line changes nothing about behaviour. */
function bundleEngineWithInternals() {
  const src = read('electron/agent/engine.ts');
  esbuild.buildSync({
    stdin: {
      contents: src + '\nexport { BACKGROUND_SUBAGENT_CAP, activeSubagentRunners, backgroundRunning };\n',
      resolveDir: join(ROOT, 'electron', 'agent'), sourcefile: 'engine.ts', loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: ENGINE_BUNDLE,
    external: ['electron'], logLevel: 'silent',
  });
  return require(ENGINE_BUNDLE);
}

const BUNDLES = [
  join(ROOT, 'tests', '.v1135-ctx.bundle.cjs'),
  join(ROOT, 'tests', '.v1135-costs.bundle.cjs'),
  join(ROOT, 'tests', '.v1135-tokeneconomy.bundle.cjs'),
  join(ROOT, 'tests', '.v1135-promptsize.bundle.cjs'),
];
let ctx, costs, econ, promptSize;

before(() => {
  esbuild.buildSync({ entryPoints: [join(ROOT, 'src/lib/ctx.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLES[0], logLevel: 'silent' });
  ctx = require(BUNDLES[0]);
  esbuild.buildSync({ entryPoints: [join(ROOT, 'electron/agent/costs.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLES[1], logLevel: 'silent' });
  costs = require(BUNDLES[1]);
  esbuild.buildSync({ entryPoints: [join(ROOT, 'electron/agent/tokenEconomy.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLES[2], logLevel: 'silent' });
  econ = require(BUNDLES[2]);
  esbuild.buildSync({
    stdin: {
      contents: "export { getToolDefs } from './electron/agent/tools'; export { buildSystemPrompt } from './electron/agent/prompts';",
      resolveDir: ROOT, loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLES[3], external: ['electron'], logLevel: 'silent',
  });
  promptSize = require(BUNDLES[3]);
});
after(() => {
  for (const p of [...BUNDLES, ENGINE_BUNDLE]) { try { if (existsSync(p)) unlinkSync(p); } catch { /* gone */ } }
});

// Evaluate the REAL `const` lines lifted out of engine.ts (no re-implementation).
function engineWindow(reportedCtx, modelId) {
  const lines = ENGINE_SRC.split('\n');
  const start = lines.findIndex((l) => /const reportedCtx\s*=/.test(l));
  const end = lines.findIndex((l) => /const compactTokenThreshold\s*=/.test(l));
  assert.ok(start >= 0 && end > start, `window-resolution lines missing: ${at('electron/agent/engine.ts', 'const reportedCtx')}`);
  const snippet = lines.slice(start, end + 1).join('\n');
  return new Function('openrouterContextFor', 'contextWindowInfo', 'params', 'CHARS_PER_TOKEN', 'compactionThresholdTokens',
    `${snippet}\nreturn { ctxWindowTokens, compactTokenThreshold, ctxCapChars };`)(() => reportedCtx, costs.contextWindowInfo, { model: { model: modelId } }, 3.5, ctx.compactionThresholdTokens);
}

/** Evaluate the REAL gate expressions from engine.ts for a given fill + transcript size. */
function engineGate(lastRealInputTokens, transcriptChars, ctxWindowTokens, compactTokenThreshold) {
  const lines = ENGINE_SRC.split('\n');
  const start = lines.findIndex((l) => /const realTokenTrigger\s*=/.test(l));
  const end = lines.findIndex((l) => /if \(realTokenTrigger \|\| charsTrigger\)/.test(l));
  assert.ok(start >= 0 && end > start, `gate lines missing: ${at('electron/agent/engine.ts', 'const realTokenTrigger')}`);
  const snippet = lines.slice(start, end).join('\n').replace(/transcript\.chars/g, 'transcriptChars');
  return new Function('isCompactionEligible', 'CHARS_PER_TOKEN', 'lastRealInputTokens', 'transcriptChars',
    'ctxWindowTokens', 'compactTokenThreshold',
    `${snippet}\nreturn { realTokenTrigger, charsTrigger, fired: realTokenTrigger || charsTrigger, windowCharsCap };`)
    (ctx.isCompactionEligible, 3.5, lastRealInputTokens, transcriptChars, ctxWindowTokens, compactTokenThreshold);
}

// ------------------------------------------------------------
// 0 · harness sanity — real modules bundled
// ------------------------------------------------------------
test('v1135-0 · harness bundles the REAL ctx.ts / costs.ts / tokenEconomy.ts', () => {
  assert.equal(typeof ctx.isCompactionEligible, 'function');
  assert.equal(typeof costs.contextWindowInfo, 'function');
  assert.equal(typeof econ.dedupeToolResults, 'function');
  assert.equal(ctx.COMPACT_TRIGGER_RATIO, 0.9);
});

// ------------------------------------------------------------
// 1 · ROOT CAUSE: the fixed small-count trigger is GONE
// ------------------------------------------------------------
test('v1135-1a · engine.ts no longer contains a fixed chars-count compaction trigger', () => {
  assert.doesNotMatch(ENGINE_SRC, /legacyCharsCap/,
    `the legacy fixed cap is still wired: ${at('electron/agent/engine.ts', 'legacyCharsCap')}`);
  assert.doesNotMatch(ENGINE_SRC, /cfg\.compactThreshold[\s\S]{0,400}charsTrigger/,
    `compactThreshold still feeds the compaction gate: ${at('electron/agent/engine.ts', 'compactThreshold')}`);
  // The TRIGGER lines (up to the `if`) must not mention a user-set cap. The
  // legacy compactThreshold is now ONLY a verbatim-tail size bound AFTER the
  // real-window gate fires — it can never decide WHETHER to compact.
  const lines = ENGINE_SRC.split('\n');
  const tStart = lines.findIndex((l) => /const realTokenTrigger\s*=/.test(l));
  const tEnd = lines.findIndex((l) => /if \(realTokenTrigger \|\| charsTrigger\)/.test(l));
  const triggerLines = lines.slice(tStart, tEnd).join('\n');
  assert.ok(!/compactThreshold/.test(triggerLines), 'no fixed user cap in the trigger decision');
});

test('v1135-1b · the ONLY chars fallback is derived from the REAL window (90%)', () => {
  assert.match(ENGINE_SRC, /const windowCharsCap\s*=\s*Math\.floor\(compactTokenThreshold \* CHARS_PER_TOKEN\)/,
    `fallback must use the real-window threshold: ${at('electron/agent/engine.ts', 'const windowCharsCap')}`);
  assert.match(ENGINE_SRC, /const charsTrigger\s*=\s*lastRealInputTokens === 0 && windowCharsCap > 0 && transcript\.chars >= windowCharsCap/,
    `gate must be real-window-derived: ${at('electron/agent/engine.ts', 'const charsTrigger')}`);
  // 90% of a 1M window = 900k tokens = 3.15M chars — never 10k/120k.
  const { compactTokenThreshold } = engineWindow(null, 'claude-sonnet-5.5');
  assert.equal(compactTokenThreshold, 900_000);
  assert.equal(Math.floor(compactTokenThreshold * 3.5), 3_150_000);
});

// ------------------------------------------------------------
// 2 · REAL engine expressions: "two words" never compacts
// ------------------------------------------------------------
test('v1135-2a · window resolves to the real 1M (provider report wins over catalog)', () => {
  const cold = engineWindow(null, 'claude-sonnet-5.5');
  assert.equal(cold.ctxWindowTokens, 1_000_000, 'cold catalog still resolves the curated 1M row');
  const live = engineWindow(983_041, 'vendor/unknown-1m');
  assert.equal(live.ctxWindowTokens, 983_041, 'provider-reported window wins');
  assert.equal(live.compactTokenThreshold, 884_736); // floor(0.9 * 983041)
});

test('v1135-2b · 34k fill (system+145 tools+two words) does NOT compact on 1M', () => {
  const { ctxWindowTokens, compactTokenThreshold } = engineWindow(null, 'claude-sonnet-5.5');
  const g = engineGate(34_000, 120_000, ctxWindowTokens, compactTokenThreshold);
  assert.equal(g.fired, false, 'the founder\'s "two words" scenario must NOT compact');
  assert.equal(g.realTokenTrigger, false);
  assert.equal(g.charsTrigger, false, '120k transcript chars is nowhere near 3.15M');
});

test('v1135-2c · no provider usage + 100k/500k transcript chars still does NOT compact', () => {
  const { ctxWindowTokens, compactTokenThreshold } = engineWindow(null, 'claude-sonnet-5.5');
  for (const chars of [10_000, 120_000, 500_000, 3_149_999]) {
    const g = engineGate(0, chars, ctxWindowTokens, compactTokenThreshold);
    assert.equal(g.fired, false, `chars=${chars} must not fire (old code fired at 10k–120k)`);
  }
  const near = engineGate(0, 3_150_000, ctxWindowTokens, compactTokenThreshold);
  assert.equal(near.fired, true, 'only at 90% of the REAL window may the chars fallback fire');
});

test('v1135-2d · 900k fill DOES compact; 899,999 does not (real 1M window)', () => {
  const { ctxWindowTokens, compactTokenThreshold } = engineWindow(null, 'claude-sonnet-5.5');
  assert.equal(engineGate(900_000, 0, ctxWindowTokens, compactTokenThreshold).fired, true);
  assert.equal(engineGate(899_999, 0, ctxWindowTokens, compactTokenThreshold).fired, false);
  // The old 130k trigger (65% of a 200k fallback) must be long gone.
  assert.equal(engineGate(130_000, 0, ctxWindowTokens, compactTokenThreshold).fired, false);
});

test('v1135-2e · unknown window never auto-compacts (no honest threshold)', () => {
  const g = engineGate(1_000_000, 0, 0, 0);
  assert.equal(g.fired, false, 'an unknown window must not drive compaction');
  const tiny = engineWindow(null, 'totally-unknown-model-zzz');
  assert.equal(tiny.ctxWindowTokens, 200_000, 'honest 200k fallback remains');
  assert.equal(tiny.compactTokenThreshold, 180_000);
});

// ------------------------------------------------------------
// 3 · dedupeToolResults wiring (C6) + capability neutrality
// ------------------------------------------------------------
test('v1135-3a · dedupeToolResults is imported from ./prompts and wired at BOTH streamTurn sites', () => {
  assert.match(ENGINE_SRC, /import \{ buildSystemPrompt, TASK_MODE_SPECS, dedupeToolResults \} from '\.\/prompts'/,
    `one-line import from prompts: ${at('electron/agent/engine.ts', 'dedupeToolResults } from')}`);
  assert.match(PROMPTS_SRC, /export \{[\s\S]{0,80}dedupeToolResults/, 'C6 re-export is present in prompts.ts');
  const wraps = ENGINE_SRC.match(/messages:\s*dedupeToolResults\(messages\)/g) ?? [];
  assert.equal(wraps.length, 2,
    `expected wraps at the /compact call (~2555) and the main loop (~5505), got ${wraps.length}`);
  // Neither wrap may mutate the stored transcript (no reassignment).
  assert.doesNotMatch(ENGINE_SRC, /messages\s*=\s*dedupeToolResults\(messages\)/, 'wrapping must be non-mutating');
});

test('v1135-3b · dedupe is capability-neutral: order/roles/callIds/first copy intact', () => {
  const blob = 'X'.repeat(12_186);
  const msgs = [
    { role: 'user', text: 'go' },
    { role: 'tool_result', callId: 'c1', content: blob },
    { role: 'assistant', text: 'ok', toolCalls: [{ id: 'c1', name: 'run' }] },
    { role: 'tool_result', callId: 'c2', content: blob }, // byte-identical repeat
    { role: 'tool_result', callId: 'c3', content: 'Y'.repeat(4_000) }, // distinct
  ];
  const out = econ.dedupeToolResults(msgs);
  assert.equal(out.length, msgs.length, 'no message removed');
  assert.deepEqual(out.map((m) => m.role), msgs.map((m) => m.role), 'roles/order unchanged');
  assert.equal(out[1].content, blob, 'first full copy survives byte-for-byte');
  assert.ok(out[3].content.length < blob.length, 'only the repeated blob is folded');
  assert.match(out[3].content, /c1/, 'the marker points at the surviving first copy');
  assert.equal(out[3].callId, 'c2', 'own callId preserved');
  assert.equal(out[4].content.length, 4_000, 'distinct output untouched');
  assert.equal(msgs[3].content, blob, 'input array not mutated');
});

// ------------------------------------------------------------
// 4 · tool definitions are re-sent every turn and counted in fill
// ------------------------------------------------------------
test('v1135-4a · 145 tool defs + system prompt are re-sent each request and land in inputTokens', () => {
  const defs = promptSize.getToolDefs([], 'full');
  const sys = promptSize.buildSystemPrompt({ mode: 'build', task: 'chat' });
  const defsChars = JSON.stringify(defs).length;
  assert.equal(defs.length, 145, 'the full tool registry stays at 145');
  assert.ok(defsChars > 50_000, `tool defs are a real recurring cost: ${defsChars} chars`);
  assert.ok(sys.length > 10_000, 'system prompt is a real recurring cost');
  const approxTokens = Math.ceil((defsChars + sys.length) / 3.5);
  assert.ok(approxTokens > 20_000 && approxTokens < 130_000,
    `per-turn overhead ~ ${approxTokens} tokens — far below the 900k real trigger but above the old 10k char cap`);
  // providers.ts sends the full tools[] on every streamTurn call.
  assert.match(PROVIDERS_SRC, /body\.tools\s*=\s*(buildAnthropicTools\(a\.tools|tools)/,
    `tools re-sent per request: ${at('electron/agent/providers.ts', 'body.tools =')}`);
  assert.match(PROVIDERS_SRC, /inputTokens/, 'provider usage reports the prompt (incl. tools) as inputTokens');
});

// ------------------------------------------------------------
// 5 · complete trigger-site enumeration (read-only scan)
// ------------------------------------------------------------
test('v1135-5 · every compaction/context trigger site is enumerated and safe', () => {
  assert.match(ENGINE_SRC, /if \(params\.task === 'compact'\)/, 'user /compact is a separate path');
  assert.match(ENGINE_SRC, /ioB\.send\(\{ type: 'compaction', before: pctBefore, after: pctAfter \}\)/, 'honest telemetry');
  assert.match(ENGINE_SRC, /lastRealInputTokens\s*=\s*u\.inputTokens/, 'gate fed by real provider input tokens');
  assert.doesNotMatch(ENGINE_SRC, /ctxWindowTokens \* 0\.65/, 'the 65% trigger is gone');
  assert.doesNotMatch(ENGINE_SRC, /compactTokenThreshold\s*=\s*Math\.floor\([^)]*200_000/, 'no fixed 200k×ratio trigger');
  // No "compact every N turns" rule.
  assert.doesNotMatch(ENGINE_SRC, /iter\s*%\s*\d+[\s\S]{0,200}compact/i, 'no fixed-turn compaction rule');
});

// ============================================================
// 6 · THE BLUNT VERDICT (source path traced by this suite)
// ============================================================
test('v1135-6 VERDICT · "compacts after two words" does NOT reproduce in the traced source path', () => {
  const w = engineWindow(null, 'claude-sonnet-5.5');
  assert.equal(w.ctxWindowTokens, 1_000_000);
  assert.equal(engineGate(34_000, 120_000, w.ctxWindowTokens, w.compactTokenThreshold).fired, false);
  assert.equal(engineGate(0, 120_000, w.ctxWindowTokens, w.compactTokenThreshold).fired, false);
  // Guarded by rebuild: stale dist-electron/electron/agent/engine.js still has 0.65.
  const stale = read('dist-electron/electron/agent/engine.js');
  const staleOld = /compactTokenThreshold\s*=\s*Math\.floor\(ctxWindowTokens \* 0\.65\)/.test(stale);
  assert.equal(staleOld, true,
    'HANDOFF: the standalone stale build artifact still carries the 65% trigger; source is fixed, artifact must be rebuilt');
});

// ============================================================
// 7 · A3/FOUNDER — background agents have a HIGH safety ceiling, not 4
// ============================================================
test('v1135-7a · BACKGROUND_SUBAGENT_CAP is 64 (normal work never hits it)', () => {
  assert.match(ENGINE_SRC, /const BACKGROUND_SUBAGENT_CAP\s*=\s*64\b/,
    `cap must be raised from 4: ${at('electron/agent/engine.ts', 'const BACKGROUND_SUBAGENT_CAP')}`);
  assert.doesNotMatch(ENGINE_SRC, /const BACKGROUND_SUBAGENT_CAP\s*=\s*4\b/, 'old cap of 4 is gone');
});

test('v1135-7b · >4 (and up to the ceiling) background agents actually launch', async () => {
  // Browser stubs must exist before the engine bundle is required.
  globalThis.window = {
    surnia: new Proxy({}, { get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : () => Promise.resolve(undefined)) }),
    addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }),
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {} }),
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

  const engine = bundleEngineWithInternals();
  assert.equal(engine.BACKGROUND_SUBAGENT_CAP, 64, 'real runtime constant is 64');
  const session = 'v1135-cap-test-' + Date.now();
  const events = [];
  const io = { send: (e) => events.push(e) };
  // Register a fake ACTIVE runner for this session (same surface the engine uses).
  engine.activeSubagentRunners.set(session, async (_id, label) => `done:${label}`);
  try {
    const N = 12; // >4 — the old cap would refuse 8 of these.
    for (let i = 0; i < N; i++) {
      await engine.runBackgroundSubagent(io, { sessionId: session }, `agent-${i}`, `worker-${i}`, 'do work');
    }
    await new Promise((r) => setImmediate(r)); // let detached completions flush
    assert.equal(engine.backgroundSubagentCount(session), 0, 'all launched agents finished');
    assert.equal(events.length, N, `all ${N} agents launched (old cap emitted only 4 successes + 8 refusals)`);
    assert.equal(events.filter((e) => /BACKGROUND_LIMIT/.test(e.summary)).length, 0, 'no false "no agents left"');
    assert.equal(events.filter((e) => /^done:worker-/.test(e.summary)).length, N, 'every agent really ran');

    // Honest ceiling: at 63 in-flight the 64th still launches; at 64 it refuses
    // with a next step instead of a bare code.
    engine.backgroundRunning.set(session, 63);
    await engine.runBackgroundSubagent(io, { sessionId: session }, 'edge', 'edge-64', 'do work');
    await new Promise((r) => setImmediate(r));
    assert.ok(!/BACKGROUND_LIMIT/.test(events.at(-1).summary), 'the 64th agent is allowed');
    engine.backgroundRunning.set(session, 64);
    await engine.runBackgroundSubagent(io, { sessionId: session }, 'over', 'over-65', 'do work');
    assert.match(events.at(-1).summary, /BACKGROUND_LIMIT: 64 background agents are already running/);
    assert.match(events.at(-1).summary, /Wait for one to finish, or start a new session/, 'honest next step');
  } finally {
    engine.activeSubagentRunners.delete(session);
    engine.backgroundRunning.delete(session);
  }
});
