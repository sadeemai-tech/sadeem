// ============================================================
// v11.36 (FINAL INDEPENDENT VERIFIER) — CONTEXT / TOKEN / PRICE PRECISION
// ------------------------------------------------------------
// Founder: "تأكد بأنك أصلحت مشكلة الكونتكست... الكونتكست حسب النموذج...
// مثل المودلز اللي بستخدمها at 1M / 100k / 200k توكن، حسب النموذج. يجب أن
// يكون جايب النموذج هاي من المزود نفسه... بدقة عالية، بيانات حقيقية وصحيحة،
// واحتساب التوكن واحتساب السعر... كله صحيح ودقيق."
//
// This is a DIAGNOSIS + TEST script. It edits NO source. It bundles the REAL
// electron/services/openrouterCatalog.ts + electron/agent/costs.ts +
// src/lib/ctx.ts with esbuild into ONE module (shared module cache), injects a
// REAL OpenRouter-shaped /api/v1/models payload (3 models: 1M / 100K / 200K,
// each with distinct exact per-token STRING prices) and drives REAL behavior
// — not source regexes — through the actual resolvers.
//
// Run:  node --test --test-force-exit tests-v1136-context-precision.mjs
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url)); // script lives at repo root
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const BUNDLE = join(ROOT, '.v1136-context.bundle.cjs');
const CATALOG_SRC = read('electron/services/openrouterCatalog.ts');
const COSTS_SRC = read('electron/agent/costs.ts');
const CTX_SRC = read('src/lib/ctx.ts');
const ENGINE_SRC = read('electron/agent/engine.ts');
const IPC_SRC = read('electron/ipc.ts');

const ENDPOINT = 'https://openrouter.ai/api/v1/models';
const FETCHED_MS = Date.UTC(2026, 10, 21, 12, 0, 0);
const FETCHED_ISO = '2026-11-21T12:00:00.000Z';

// REAL OpenRouter response shape: context_length + USD-PER-TOKEN strings in
// `pricing` (prompt / completion / input_cache_read / input_cache_write).
// The 1M model deliberately reuses a CURATED id whose table entry is 200K and
// $1/$5 — if the resolver ever falls back to curated, this fixture FAILS.
const PAYLOAD = {
  data: [
    {
      id: 'anthropic/claude-haiku-4-5',
      canonical_slug: 'anthropic/claude-haiku-4-5-20251115',
      name: 'Anthropic: Claude Haiku 4.5 (fixture 1M)',
      context_length: 1000000,
      architecture: { modality: 'text+image->text', input_modalities: ['text', 'image'] },
      pricing: {
        prompt: '0.000000777',       // $0.777 / 1M  (curated says $1)
        completion: '0.000004321',   // $4.321 / 1M  (curated says $5)
        input_cache_read: '0.0000000777',
        input_cache_write: '0.00000097125',
      },
    },
    {
      id: 'vendor-b/beta-100k',
      name: 'Vendor B: Beta 100K',
      context_length: 100000,
      pricing: {
        prompt: '0.000003',          // $3 / 1M
        completion: '0.000015',      // $15 / 1M
        input_cache_read: '0.0000006',
        input_cache_write: '0.00000375',
      },
    },
    {
      id: 'vendor-c/gamma-200k',
      name: 'Vendor C: Gamma 200K',
      context_length: 200000,
      pricing: {
        prompt: '0.000000075',       // $0.075 / 1M — 9-decimal BigInt stress
        completion: '0.0000003',     // $0.30 / 1M
        input_cache_read: '0.000000015',
        input_cache_write: '0.00000009375',
      },
    },
  ],
};

const MODEL_1M = 'anthropic/claude-haiku-4-5';
const MODEL_100K = 'vendor-b/beta-100k';
const MODEL_200K = 'vendor-c/gamma-200k';
const close = (a, b, eps = 1e-15) => Math.abs(a - b) <= eps;

let mod;
const seed = () => {
  const rows = mod.catalog.parseOpenRouterModels(PAYLOAD);
  mod.catalog.__seedOpenRouterCatalogForTest(rows, FETCHED_MS);
  return rows;
};

before(() => {
  // ONE bundle → costs.ts + openrouterCatalog.ts SHARE the module cache, so a
  // seeded catalog is seen by resolvePrice/resolveModelInfo/contextWindowInfo.
  esbuild.buildSync({
    stdin: {
      contents:
        "import * as costs from './electron/agent/costs';" +
        "import * as catalog from './electron/services/openrouterCatalog';" +
        "import * as ctx from './src/lib/ctx';" +
        'export { costs, catalog, ctx };',
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: BUNDLE,
    logLevel: 'silent',
  });
  mod = require(BUNDLE);
});

after(() => {
  mod?.catalog.__resetOpenRouterCatalogForTest();
  try { if (existsSync(BUNDLE)) unlinkSync(BUNDLE); } catch { /* gone */ }
});

// ------------------------------------------------------------
// HARNESS — the real modules were bundled (not re-implemented)
// ------------------------------------------------------------
test('v1136 harness: real costs.ts + openrouterCatalog.ts + ctx.ts bundled together', () => {
  for (const [ns, fn] of [
    ['catalog', 'parseOpenRouterModels'], ['catalog', '__seedOpenRouterCatalogForTest'],
    ['catalog', 'openrouterContextFor'], ['costs', 'resolvePrice'], ['costs', 'resolveModelInfo'],
    ['costs', 'estimateCostExact'], ['costs', 'contextWindowInfo'],
    ['ctx', 'fromProviderUsageReport'], ['ctx', 'ctxPctExact'], ['ctx', 'isCompactionEligible'],
    ['ctx', 'estimateTokensFromText'], ['ctx', 'formatContextBreakdown'],
  ]) assert.equal(typeof mod[ns][fn], 'function', `${ns}.${fn} must come from the REAL source`);
});

// ============================================================
// 1 · EXACT WINDOW (1M / 100K / 200K) + EXACT PRICE FROM THE PROVIDER
//     with fetchedAt + sourceUrl — not curated, not default.
// ============================================================
test('v1136 §1: parser keeps the router\'s exact 1M/100k/200k windows and exact price strings', () => {
  const rows = seed();
  assert.equal(rows.length, 3);
  const expected = new Map([
    [MODEL_1M,  { ctx: 1_000_000, prompt: '0.000000777', completion: '0.000004321' }],
    [MODEL_100K, { ctx: 100_000,   prompt: '0.000003',    completion: '0.000015' }],
    [MODEL_200K, { ctx: 200_000,   prompt: '0.000000075', completion: '0.0000003' }],
  ]);
  for (const [id, want] of expected) {
    const row = rows.find((r) => r.id === id);
    assert.ok(row, `router row ${id} parsed`);
    assert.equal(row.ctx, want.ctx, `${id}: exact context_length from provider payload`);
    assert.equal(row.price.prompt, want.prompt, `${id}: exact prompt string verbatim`);
    assert.equal(row.price.completion, want.completion, `${id}: exact completion string verbatim`);
  }
});

test('v1136 §1: resolveModelInfo → exact window + exact price + fetchedAt + sourceUrl (costs.ts:624)', () => {
  seed();
  const cases = [
    [MODEL_1M,   1_000_000, 0.777, 4.321],
    [MODEL_100K, 100_000,   3,     15],
    [MODEL_200K, 200_000,   0.075, 0.3],
  ];
  for (const [id, ctxWant, inWant, outWant] of cases) {
    const info = mod.costs.resolveModelInfo(id);
    assert.equal(info.contextWindow, ctxWant, `${id}: EXACT window from provider`);
    assert.equal(info.contextSource, 'openrouter-live');
    assert.equal(info.contextEstimated, false, `${id}: not an approximate default`);
    assert.equal(info.fetchedAt, FETCHED_ISO, `${id}: provenance timestamp`);
    assert.equal(info.price.source, 'openrouter-live', `${id}: price from the router, not curated`);
    assert.equal(info.price.match, 'exact');
    assert.equal(info.price.matchedId, id);
    assert.equal(info.price.fetchedAt, FETCHED_ISO);
    assert.equal(info.price.sourceUrl, ENDPOINT, `${id}: every number traceable to the endpoint`);
    assert.equal(info.price.unknown, false);
    assert.equal(info.price.perMillion.input, inWant, `${id}: exact distinct input rate`);
    assert.equal(info.price.perMillion.output, outWant, `${id}: exact distinct output rate`);
  }
  // The legacy UI shape carries the same provenance.
  const legacy = mod.costs.priceFor(MODEL_1M);
  assert.equal(legacy.sourceUrl, ENDPOINT);
  assert.equal(legacy.fetchedAt, FETCHED_ISO);
  assert.equal(legacy.estimated, false);
});

test('v1136 §1: LIVE payload beats the curated table — A/B proof on a curated-colliding id', () => {
  // A) curated-only: claude-haiku-4-5 is pinned to 200k / $1 / $5 in costs.ts.
  mod.catalog.__resetOpenRouterCatalogForTest();
  const beforeWindow = mod.costs.contextWindowInfo(MODEL_1M);
  const beforePrice = mod.costs.resolvePrice(MODEL_1M);
  assert.equal(beforeWindow.ctx, 200_000, 'WITHOUT the provider payload the table says 200k');
  assert.deepEqual([beforePrice.perMillion.input, beforePrice.perMillion.output], [1, 5],
    'WITHOUT the provider payload the table says $1/$5');
  assert.equal(beforePrice.source, 'curated');

  // B) with the provider payload: SAME id resolves to 1M and $0.777/$4.321.
  seed();
  const info = mod.costs.resolveModelInfo(MODEL_1M);
  assert.equal(info.contextWindow, 1_000_000, 'provider payload overrides the curated 200k');
  assert.deepEqual([info.price.perMillion.input, info.price.perMillion.output], [0.777, 4.321],
    'provider payload overrides the curated $1/$5');
  assert.equal(info.price.source, 'openrouter-live');
});

// ============================================================
// 2 · A 1M MODEL IS NEVER TREATED AS 200K IN THE WINDOW PATH
//     token fill math: 100k/1M=10% no compaction; 900k=90% eligible.
// ============================================================
test('v1136 §2: every window path returns 1M for the 1M model (engine, orb, shared resolver)', () => {
  seed();
  // orb path (ipc.ts:689) — provider-reported first.
  assert.equal(mod.catalog.openrouterContextFor(MODEL_1M), 1_000_000);
  // shared resolver path (costs.ts:493 / :624) — also provider-first.
  assert.equal(mod.costs.contextWindowInfo(MODEL_1M).ctx, 1_000_000);
  assert.equal(mod.costs.contextWindowFor(MODEL_1M), 1_000_000);
  assert.equal(mod.costs.resolveModelInfo(MODEL_1M).contextWindow, 1_000_000);
  // engine path (engine.ts:4866-4868) — same two-call resolution.
  const reportedCtx = mod.catalog.openrouterContextFor(MODEL_1M);
  const catalogCtx = mod.costs.contextWindowInfo(MODEL_1M);
  const ctxWindowTokens = Math.max(8_000, reportedCtx ?? catalogCtx.ctx);
  assert.equal(ctxWindowTokens, 1_000_000, 'engine computes the REAL window, not 200k');
  assert.notEqual(ctxWindowTokens, 200_000);
});

test('v1136 §2: 1M window fill math — 100k = 10% (no compaction), 900k = 90% (eligible)', () => {
  seed();
  const window = mod.costs.resolveModelInfo(MODEL_1M).contextWindow;
  assert.equal(window, 1_000_000);

  const u100 = mod.ctx.fromProviderUsageReport({ prompt_tokens: 100_000, completion_tokens: 0 });
  assert.equal(mod.ctx.ctxFillTokens(u100), 100_000);
  assert.equal(mod.ctx.ctxPctExact(u100, window), 10, '100k / 1M = 10%, not 50%');
  assert.equal(mod.ctx.contextFillPercent(100_000, window), 10);
  assert.equal(mod.ctx.compactionThresholdTokens(window), 900_000, '90% of the REAL 1M window');
  assert.equal(mod.ctx.isCompactionEligible(100_000, window), false, '10% ⇒ NO compaction');

  const u900 = mod.ctx.fromProviderUsageReport({ prompt_tokens: 900_000, completion_tokens: 0 });
  assert.equal(mod.ctx.ctxPctExact(u900, window), 90, '900k / 1M = 90%');
  assert.equal(mod.ctx.isCompactionEligible(900_000, window), true, 'at 90% compaction IS eligible');
  assert.equal(mod.ctx.isCompactionEligible(899_999, window), false, 'one token below 90% is not eligible');

  // Behavioural proof that the 1M window is not the 200k fallback:
  // 200k fill is 20% of 1M (safe) but 100% of 200k (would compact).
  assert.equal(mod.ctx.contextFillPercent(200_000, window), 20);
  assert.equal(mod.ctx.isCompactionEligible(200_000, window), false);
  assert.equal(mod.ctx.isCompactionEligible(200_000, 200_000), true,
    'if 1M were treated as 200k this would (wrongly) compact');
  assert.equal(mod.ctx.COMPACT_TRIGGER_RATIO, 0.9);
});

// ============================================================
// 3 · PRICE MATH — exact distinct input/output/cache, BigInt-safe,
//     unknown model honest (no invented price).
// ============================================================
test('v1136 §3: exact distinct input/output/cache rates, no swap, no double count', () => {
  seed();
  // 1M model: all four rates distinct and exact.
  const a = mod.costs.estimateCostExact(MODEL_1M, 1_000_000, 0, 0, 0);
  assert.equal(a.costUsd, 0.777, '1M input = $0.777 exactly (not curated $1)');
  assert.equal(mod.costs.estimateCostExact(MODEL_1M, 0, 1_000_000).costUsd, 4.321, '1M output = $4.321');
  assert.equal(mod.costs.estimateCostExact(MODEL_1M, 0, 0, 1_000_000).costUsd, 0.0777, 'cache READ rate');
  assert.equal(mod.costs.estimateCostExact(MODEL_1M, 0, 0, 0, 1_000_000).costUsd, 0.97125, 'cache WRITE rate');
  const combo = mod.costs.estimateCostExact(MODEL_1M, 500_000, 100_000, 200_000, 50_000);
  // 0.3885 + 0.4321 + 0.01554 + 0.0485625 = 0.8847025
  assert.ok(close(combo.costUsd, 0.8847025), `combo = ${combo.costUsd}`);
  assert.equal(combo.parts.fresh, 0.3885);
  assert.equal(combo.parts.output, 0.4321);
  assert.ok(close(combo.parts.cacheRead, 0.01554));
  assert.ok(close(combo.parts.cacheWrite, 0.0485625));
  assert.ok(close(combo.parts.fresh + combo.parts.cacheRead + combo.parts.cacheWrite + combo.parts.output, combo.costUsd),
    'disjoint segments sum to the total — no double counting');

  // Distinct per-model prices — no model borrows another's rate.
  assert.equal(mod.costs.estimateCostExact(MODEL_100K, 1_000_000, 0).costUsd, 3);
  assert.equal(mod.costs.estimateCostExact(MODEL_100K, 0, 1_000_000).costUsd, 15);
  assert.equal(mod.costs.estimateCostExact(MODEL_200K, 1_000_000, 0).costUsd, 0.075);
  assert.notEqual(a.costUsd, mod.costs.estimateCostExact(MODEL_100K, 1_000_000, 0).costUsd);
});

test('v1136 §3: BigInt decimal math — 1,234,567 tok @ $0.000000075/tok is exact, no float drift', () => {
  seed();
  const b = mod.costs.estimateCostExact(MODEL_200K, 1_234_567, 0);
  assert.equal(b.source, 'openrouter-live');
  assert.ok(close(b.costUsd, 0.092592525), `got ${b.costUsd}`);
  assert.equal(mod.costs.estimateCostExact(MODEL_200K, 1_000_000, 0).costUsd, 0.075);
  assert.equal(mod.costs.estimateCostExact(MODEL_200K, 0, 1_000_000).costUsd, 0.3);
  assert.equal(mod.costs.estimateCostExact(MODEL_200K, 0, 0, 1_000_000, 1_000_000).costUsd, 0.10875,
    '0.015 read + 0.09375 write');
  const r = mod.costs.resolvePrice(MODEL_200K);
  assert.equal(r.perToken.input, '0.000000075', 'exact string preserved, never parseFloat-ed');
  assert.equal(r.perToken.cacheWrite, '0.00000009375');
  assert.equal(r.cacheRatesDerived, false, 'router reported cache rates — none were guessed');
});

test('v1136 §3: unknown model is honestly unknown — no made-up price (costs.ts:595)', () => {
  seed();
  for (const id of ['never/seen-model-xyz', 'totally-unknown-42']) {
    const r = mod.costs.resolvePrice(id);
    assert.equal(r.source, 'unknown');
    assert.equal(r.unknown, true);
    assert.equal(r.match, 'none');
    assert.equal(r.matchedId, null);
    assert.equal(r.fetchedAt, null);
    assert.equal(r.sourceUrl, null);
    assert.equal(r.perToken.input, null);
    assert.equal(r.perToken.output, null);
    assert.equal(r.perMillion.input, null);
    assert.equal(r.perMillion.output, null);
    const b = mod.costs.estimateCostExact(id, 1_000_000, 1_000_000);
    assert.equal(b.costUsd, 0, 'no price ⇒ no invented cost');
    assert.equal(b.unknown, true);
    // Honest window too: unknown id ⇒ no exact window, flagged approximate.
    const info = mod.costs.resolveModelInfo(id);
    assert.equal(info.contextWindow, null);
    assert.equal(info.contextEstimated, true);
    assert.equal(mod.costs.contextWindowInfo(id).estimated, true, 'UI must show "≈ 200,000"');
    // The legacy picker fallback exists only FLAGGED, never as a known price.
    const legacy = mod.costs.priceFor(id);
    assert.equal(legacy.unknown, true);
    assert.equal(legacy.estimated, true);
    assert.equal(legacy.source, 'unknown');
  }
});

// ============================================================
// 4 · ctx.ts — script-aware estimate, ≈ labelling, no false 100%
// ============================================================
test('v1136 §4: Arabic ≈2 chars/token estimate — never measured at Latin chars/4', () => {
  assert.equal(mod.ctx.detectTokenScript('مرحبا بالعالم'), 'arabic');
  assert.equal(mod.ctx.detectTokenScript('hello مرحبا'), 'mixed');
  assert.equal(mod.ctx.detectTokenScript('hello world'), 'latin');
  assert.equal(mod.ctx.CHARS_PER_TOKEN.arabic, 2);
  const arabic = 'مرحبا بالعالم';
  assert.ok(mod.ctx.estimateTokensFromText(arabic) > mod.ctx.estimateTokensFromChars(arabic.length),
    'Arabic at chars/4 would understate the token count');
  assert.equal(mod.ctx.estimateTokensFromChars(2_000, 'arabic'), 1_000, '~2 chars/token');
  assert.equal(mod.ctx.estimateTokensFromChars(2_000, 'latin'), 500, 'chars/4 for Latin');
  assert.ok(mod.ctx.ctxPctLiveOf({ inputTokens: 100_000, outputTokens: 0, costUsd: 0 }, 1_000_000, 4_000, 'arabic')
    > mod.ctx.ctxPctLiveOf({ inputTokens: 100_000, outputTokens: 0, costUsd: 0 }, 1_000_000, 4_000, 'latin'),
    'an Arabic live stream must not use the Latin rate');
});

test('v1136 §4: every estimated figure carries ≈; no fabricated 100% on an estimated window', () => {
  const exact = mod.ctx.formatContextBreakdown({
    model: MODEL_1M, fill: 100_000, window: 1_000_000,
    cacheRead: 40_000, cacheWrite: 10_000, generated: 2_000,
    sessionTotal: 150_000, sessionCostUsd: 0.1234,
  });
  assert.doesNotMatch(exact, /≈/, 'provider figures are exact — no ≈');
  assert.match(exact, /Source: provider reported usage/);

  const est = mod.ctx.formatContextBreakdown({
    model: MODEL_1M, fill: 100_000, window: 1_000_000,
    approximate: true, sessionEstimated: true, windowEstimated: true,
  });
  for (const prefix of ['Context:', 'Remaining:', 'Cache read', 'Session total']) {
    assert.match(est.split('\n').find((l) => l.startsWith(prefix)) ?? '', /≈/, `${prefix} marked ≈`);
  }
  assert.match(est, /figures are estimates/);
  assert.match(est, /Source: estimate \(no provider usage reported\)/);

  // The founder's "no false 100%": an unknown/≈ window that is already exceeded
  // must yield NO percentage at all — not a fabricated 100%.
  assert.equal(mod.ctx.contextFillPercent(1_200_000, 200_000, true), null);
  assert.equal(mod.ctx.contextFillPercent(250_000, 200_000, true), null);
  assert.equal(mod.ctx.contextFillPercent(100_000, 1_000_000, false), 10, 'known window still reports exact %');
  const unknownWindow = mod.ctx.formatContextBreakdown({ model: 'x', fill: 42, window: 0 });
  const windowLine = unknownWindow.split('\n').find((l) => l.startsWith('Context:'));
  assert.match(windowLine, /unknown/);
  assert.doesNotMatch(windowLine, /≈0/, 'the WINDOW is "unknown", never a fabricated "≈0"');
  assert.equal(mod.ctx.tokenCountSource({ inputTokens: 5, outputTokens: 0, costUsd: 0, estimated: true }), 'estimated');
  assert.equal(mod.ctx.tokenCountSource({ inputTokens: 5, outputTokens: 0, costUsd: 0 }), 'provider');
});

// ============================================================
// 5 · SOURCE SCAN — no fixed 120k/10k chars TRIGGER remains;
//     window resolution is catalog-first everywhere.
// ============================================================
test('v1136 §5: engine.ts auto-compact gate is derived from the REAL window, not fixed chars', () => {
  assert.match(ENGINE_SRC, /import \{ openrouterContextFor \} from '\.\.\/services\/openrouterCatalog'/);
  assert.match(ENGINE_SRC, /import \{ isCompactionEligible, compactionThresholdTokens \} from '\.\.\/\.\.\/src\/lib\/ctx'/);
  assert.match(ENGINE_SRC, /const reportedCtx = openrouterContextFor\(params\.model\.model\)/);
  assert.match(ENGINE_SRC, /const ctxWindowTokens = Math\.max\(8_000, reportedCtx \?\? catalogCtx\.ctx\)/,
    'catalog-first, then curated — engine.ts:4866-4868');

  const gateRaw = ENGINE_SRC.slice(
    ENGINE_SRC.indexOf('// ---------- auto-compact'),
    ENGINE_SRC.indexOf('if (realTokenTrigger || charsTrigger)'),
  );
  // The comments in this region DOCUMENT the removed bug; scan only live code.
  // ([^\r\n]* avoids CRLF/$ semantics; strip block comments too.)
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '');
  const gate = stripComments(gateRaw);
  assert.ok(gate.length > 0, 'auto-compact gate region found');
  assert.match(gate, /const realTokenTrigger = isCompactionEligible\(lastRealInputTokens, ctxWindowTokens\)/);
  assert.match(gate, /const windowCharsCap = Math\.floor\(compactTokenThreshold \* CHARS_PER_TOKEN\)/,
    'the ONLY chars fallback is derived from the real window (90%)');
  assert.match(gate, /const charsTrigger = lastRealInputTokens === 0 && windowCharsCap > 0 && transcript\.chars >= windowCharsCap/);
  // The removed 10k-120k fixed chars TRIGGER must not be back in live code.
  assert.doesNotMatch(gate, /transcript\.chars >= Math\.min\(/);
  assert.doesNotMatch(gate, /transcript\.chars >= 10_000/);
  assert.doesNotMatch(gate, /transcript\.chars >= 120_000/);
  assert.doesNotMatch(gate, /transcript\.chars >= COMPACT_THRESHOLD_DEFAULT/);
  // The legacy 120k constant still exists as a DECLARATION only (dead code),
  // and the remaining 10_000 is a TAIL-SIZE floor — neither can trigger compaction.
  const declCount = (ENGINE_SRC.match(/COMPACT_THRESHOLD_DEFAULT/g) ?? []).length;
  assert.equal(declCount, 1, '120k constant is declared once and NEVER consumed as a trigger');
  assert.doesNotMatch(ENGINE_SRC, /compactThreshold: COMPACT_THRESHOLD_DEFAULT/);
  assert.match(ENGINE_SRC, /const tailCapChars = cfg\.compactThreshold\s*\n\s*\? Math\.max\(10_000, Math\.floor\(cfg\.compactThreshold\)\)/,
    'the surviving 10_000 only bounds the verbatim tail AFTER a real-window trigger');
});

test('v1136 §5: costs.ts + orb (ipc.ts) resolve the window catalog-first', () => {
  const resolver = COSTS_SRC.slice(
    COSTS_SRC.indexOf('export function resolveModelInfo('),
    COSTS_SRC.indexOf('export function priceFor('),
  );
  assert.match(resolver, /const reported = openrouterContextFor\(modelId\)/);
  assert.match(resolver, /const curated = curatedContextWindowInfo\(modelId\)/);
  assert.match(resolver, /const contextWindow = reported \?\? \(curated\.estimated \? null : curated\.ctx\)/,
    'provider window wins; curated is the fallback; unknown stays null');
  assert.match(resolver, /contextSource: reported !== null \? 'openrouter-live' : curated\.estimated \? 'unknown' : 'curated'/);

  const handler = IPC_SRC.slice(IPC_SRC.indexOf("handle('kdx:model:info'"), IPC_SRC.indexOf("handle('kdx:ai:complete'"));
  assert.match(handler, /const catalogCtx = openrouterContextFor\(id\)/);
  assert.match(handler, /const info = contextWindowInfo\(id\)/);
  assert.match(handler, /const ctx = catalogCtx \?\? info\.ctx/, 'orb window is catalog-first too');

  assert.match(CATALOG_SRC, /export function parseOpenRouterModels\(/);
  assert.match(CATALOG_SRC, /source: ENDPOINT/, 'provenance always points at the provider endpoint');
});
