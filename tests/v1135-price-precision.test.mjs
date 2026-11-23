import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.35 (PRICE-1) — PER-MODEL PRICE PRECISION, FROM THE SOURCE
// ------------------------------------------------------------
// The founder: "لكل نموذج ذكاء اصطناعي ... الكونتكست لينس غير دقيقة، لا في
// احتساب التوكن ولا باحتساب السعر ... جايبها من المصدر، دقة حرفية".
//
// This suite injects a REAL OpenRouter-shaped /api/v1/models payload
// (per-token STRING prices: prompt / completion / input_cache_read /
// input_cache_write) and drives the REAL costs.ts + openrouterCatalog.ts
// bundled TOGETHER (one shared module cache). Proof:
//   1. live router pricing is PRIMARY (exact full id, vendor prefix kept);
//   2. input/output/cache-read/cache-write are distinct, exact, no swap;
//   3. decimal-safe BigInt math: no float drift, no double counting;
//   4. unknown ids are honestly unknown — never a silent invented price;
//   5. a 1M-context model never inherits a different model's rate.
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const BUNDLE = join(ROOT, 'tests', '.v1135-price.bundle.cjs');
const COSTS_SRC = readFileSync(join(ROOT, 'electron', 'agent', 'costs.ts'), 'utf8');

const ENDPOINT = 'https://openrouter.ai/api/v1/models';
const FETCHED_MS = Date.UTC(2026, 10, 21, 12, 0, 0);
const FETCHED_ISO = '2026-11-21T12:00:00.000Z';

// A REAL OpenRouter response shape. Prices are USD PER TOKEN strings, exactly
// as the endpoint returns them (verified against the live catalog 2026-11-21).
const PAYLOAD = {
  data: [
    {
      id: 'anthropic/claude-sonnet-5.5',
      canonical_slug: 'anthropic/claude-sonnet-5.5-20260928',
      name: 'Anthropic: Claude Sonnet 5.5',
      context_length: 1000000,
      architecture: { modality: 'text+image->text', input_modalities: ['text', 'image', 'file'] },
      pricing: {
        prompt: '0.000002', completion: '0.00001',
        input_cache_read: '0.0000001', input_cache_write: '0.0000025',
      },
    },
    {
      // LOOKALIKE: same family prefix, DIFFERENT price. Must never bleed into
      // the plain sonnet-5.5 row (the founder's exact worry).
      id: 'anthropic/claude-sonnet-5.5-fast',
      name: 'Anthropic: Claude Sonnet 5.5 Fast',
      context_length: 500000,
      pricing: { prompt: '0.000009', completion: '0.00003' },
    },
    {
      // Same suffix, DIFFERENT vendor. Vendor prefix must be preserved.
      id: 'acme/claude-sonnet-5.5',
      name: 'Acme: Claude Sonnet 5.5',
      context_length: 262144,
      pricing: { prompt: '0.000007', completion: '0.000021' },
    },
    {
      // Decimal stress case from the real catalog (Thinking Machines Inkling).
      id: 'thinkingmachines/inkling-2-mini',
      name: 'Thinking Machines: Inkling 2 Mini',
      context_length: 1048576,
      architecture: { input_modalities: ['text', 'image'] },
      pricing: { prompt: '0.000000075', completion: '0.0000003', input_cache_read: '0.000000015' },
    },
    {
      id: 'mistralai/pixtral-large-2502',
      name: 'Mistral: Pixtral Large 2502',
      context_length: 128000,
      pricing: { prompt: '0.000002', completion: '0.000006' }, // no cache rates reported
    },
    {
      id: 'some-model:free',
      name: 'Some Model (free)',
      context_length: 32768,
      pricing: { prompt: '0', completion: '0' },
    },
    {
      // Documented OpenRouter sentinel: -1 = dynamic router, NOT free/unknown-zero.
      id: 'openrouter/auto',
      name: 'OpenRouter: Auto',
      context_length: 200000,
      pricing: { prompt: '-1', completion: '-1' },
    },
    {
      // Partial row: only one side reported — must NOT be mixed with a curated rate.
      id: 'vendor/partial-price',
      name: 'Vendor: Partial',
      context_length: 1000000,
      pricing: { prompt: '0.000004' },
    },
  ],
};

let mod;
const close = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;

before(() => {
  // One bundle => costs.ts and openrouterCatalog.ts share ONE module cache.
  esbuild.buildSync({
    stdin: {
      contents:
        "import * as costs from './electron/agent/costs';" +
        "import * as catalog from './electron/services/openrouterCatalog';" +
        'export { costs, catalog };',
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLE, logLevel: 'silent',
  });
  mod = require(BUNDLE);
});

after(() => {
  mod?.catalog.__resetOpenRouterCatalogForTest();
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

// ------------------------------------------------------------
// 0 · harness bundles the REAL modules and parses the REAL payload
// ------------------------------------------------------------
test('v1135: harness bundles real costs.ts + openrouterCatalog.ts (shared cache)', () => {
  assert.equal(typeof mod.costs.resolvePrice, 'function');
  assert.equal(typeof mod.costs.resolveModelInfo, 'function');
  assert.equal(typeof mod.costs.estimateCostExact, 'function');
  assert.equal(typeof mod.catalog.parseOpenRouterModels, 'function');
  assert.equal(typeof mod.catalog.__seedOpenRouterCatalogForTest, 'function');
});

test('v1135: parser keeps exact per-token strings, free flags, and refuses the -1 sentinel', () => {
  const rows = mod.catalog.parseOpenRouterModels(PAYLOAD);
  assert.equal(rows.length, 8);
  const sonnet = rows.find((r) => r.id === 'anthropic/claude-sonnet-5.5');
  assert.deepEqual(sonnet.price, {
    prompt: '0.000002', completion: '0.00001',
    cacheRead: '0.0000001', cacheWrite: '0.0000025',
  }, 'router strings preserved verbatim — never parseFloat-ed');
  assert.equal(sonnet.ctx, 1_000_000);
  assert.equal(sonnet.free, false);
  assert.equal(rows.find((r) => r.id === 'some-model:free').free, true, '0/0 → free');
  const auto = rows.find((r) => r.id === 'openrouter/auto');
  assert.equal(auto.free, false, '-1 dynamic router is NOT free');
  assert.equal(auto.price.prompt, null, '-1 is "unknown", never $0');
});

// ------------------------------------------------------------
// 1 · LIVE PRICE IS PRIMARY — exact id, provenance, distinct rates
// ------------------------------------------------------------
test('v1135: live OpenRouter price wins with source URL + fetch timestamp', () => {
  const rows = mod.catalog.parseOpenRouterModels(PAYLOAD);
  mod.catalog.__seedOpenRouterCatalogForTest(rows, FETCHED_MS);

  const r = mod.costs.resolvePrice('anthropic/claude-sonnet-5.5');
  assert.equal(r.source, 'openrouter-live');
  assert.equal(r.match, 'exact');
  assert.equal(r.matchedId, 'anthropic/claude-sonnet-5.5');
  assert.equal(r.unknown, false);
  assert.equal(r.fetchedAt, FETCHED_ISO, 'number is traceable to the fetch');
  assert.equal(r.sourceUrl, ENDPOINT);
  assert.equal(r.perToken.input, '0.000002');
  assert.equal(r.perToken.output, '0.00001');
  assert.equal(r.perToken.cacheRead, '0.0000001');
  assert.equal(r.perToken.cacheWrite, '0.0000025');
  assert.deepEqual(r.perMillion, { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 });

  // The legacy UI shape agrees with the precise resolver.
  const legacy = mod.costs.priceFor('anthropic/claude-sonnet-5.5');
  assert.deepEqual([legacy.input, legacy.output, legacy.cacheRead], [2, 10, 0.1]);
  assert.equal(legacy.source, 'openrouter-live');
  assert.equal(legacy.fetchedAt, FETCHED_ISO);
  assert.equal(legacy.estimated, false);
});

test('v1135: input and output rates are DISTINCT and never swapped', () => {
  const model = 'anthropic/claude-sonnet-5.5';
  assert.equal(mod.costs.estimateCostExact(model, 1_000_000, 0).costUsd, 2, '1M in = $2');
  assert.equal(mod.costs.estimateCostExact(model, 0, 1_000_000).costUsd, 10, '1M out = $10');
  assert.equal(mod.costs.estimateCostExact(model, 1_000_000, 1_000_000).costUsd, 12, 'in + out = $12');
  assert.equal(mod.costs.estimateCost('anthropic', model, 1_000_000, 0), 2, 'legacy shim agrees');
});

// ------------------------------------------------------------
// 2 · EXACT MATH, CACHE RATES, NO DOUBLE COUNTING
// ------------------------------------------------------------
test('v1135: cache read/write use the ROUTER rates, not 10%/125% guesses', () => {
  const model = 'anthropic/claude-sonnet-5.5';
  const b = mod.costs.estimateCostExact(model, 500_000, 100_000, 200_000, 50_000);
  // fresh 500k×$2/M = 1.00 | out 100k×$10/M = 1.00
  // cache READ 200k×$0.10/M = 0.02 (would be 0.40 at the input rate)
  // cache WRITE 50k×$2.50/M = 0.125
  assert.equal(b.parts.fresh, 1, 'cache segments are NOT inside fresh input');
  assert.equal(b.parts.output, 1);
  assert.equal(b.parts.cacheRead, 0.02, 'router read rate, not input rate');
  assert.equal(b.parts.cacheWrite, 0.125, 'router write rate, not 125% of input (=0.3125)');
  assert.equal(b.costUsd, 2.145);
  assert.ok(close(b.parts.fresh + b.parts.cacheRead + b.parts.cacheWrite + b.parts.output, b.costUsd),
    'disjoint segments sum to the total — no double counting');
});

test('v1135: decimal-safe BigInt math — 1,234,567 tok @ $0.000000075/tok is exact', () => {
  const model = 'thinkingmachines/inkling-2-mini';
  const b = mod.costs.estimateCostExact(model, 1_234_567, 0);
  assert.equal(b.source, 'openrouter-live');
  // 1,234,567 × 75 / 1e9 = 0.092592525 exactly (a float multiply drifts).
  assert.ok(close(b.costUsd, 0.092592525, 1e-15), `got ${b.costUsd}`);
  assert.equal(mod.costs.resolvePrice(model).perMillion.input, 0.075);
  assert.equal(mod.costs.resolvePrice(model).perMillion.output, 0.3);
  // Cache read reported, cache write absent → derived from THIS row's input,
  // not from another model's rate; marked as derived.
  const r = mod.costs.resolvePrice(model);
  assert.equal(r.cacheRatesDerived, true);
  assert.equal(r.perToken.cacheWrite, '0.00000009375'); // 0.000000075 × 1.25
});

test('v1135: unreported cache rates derive from the SAME row (10% / 125%)', () => {
  const r = mod.costs.resolvePrice('mistralai/pixtral-large-2502');
  assert.equal(r.perToken.input, '0.000002');
  assert.equal(r.perToken.output, '0.000006');
  assert.equal(r.perToken.cacheRead, '0.0000002', '10% of this row input');
  assert.equal(r.perToken.cacheWrite, '0.0000025', '125% of this row input');
  assert.equal(r.cacheRatesDerived, true);
  const b = mod.costs.estimateCostExact('mistralai/pixtral-large-2502', 0, 0, 1_000_000, 1_000_000);
  assert.equal(b.costUsd, 2.7, '0.20 read + 2.50 write');
});

// ------------------------------------------------------------
// 3 · MODEL-ID NORMALIZATION — NO CROSS-MODEL PRICE BLEED
// ------------------------------------------------------------
test('v1135: lookalike ids keep THEIR OWN price; 1M model never borrows another rate', () => {
  const fast = mod.costs.resolvePrice('anthropic/claude-sonnet-5.5-fast');
  assert.deepEqual([fast.perMillion.input, fast.perMillion.output], [9, 30]);
  const otherVendor = mod.costs.resolvePrice('acme/claude-sonnet-5.5');
  assert.deepEqual([otherVendor.perMillion.input, otherVendor.perMillion.output], [7, 21]);
  assert.notEqual(fast.perMillion.input, 2, 'the -fast row must not inherit sonnet $2');

  // THE founder's case: window AND price resolve from the SAME exact row.
  const info = mod.costs.resolveModelInfo('anthropic/claude-sonnet-5.5');
  assert.equal(info.contextWindow, 1_000_000, 'provider-reported 1M window');
  assert.equal(info.contextSource, 'openrouter-live');
  assert.equal(info.price.perMillion.input, 2, 'price of that same 1M model');
  assert.equal(info.price.source, 'openrouter-live');
  assert.equal(mod.costs.contextWindowInfo('anthropic/claude-sonnet-5.5').ctx, 1_000_000,
    'legacy window lookup agrees with the shared resolver');

  // A BARE id matches 3 live rows → ambiguous → NO coin-flip: curated fallback.
  const bare = mod.costs.resolvePrice('claude-sonnet-5.5');
  assert.equal(bare.source, 'curated', 'ambiguous vendor suffix refuses live pricing');
  assert.deepEqual([bare.perMillion.input, bare.perMillion.output], [2, 10]);
});

test('v1135: curated fallback is boundary-safe (o3mini is not o3)', () => {
  mod.catalog.__resetOpenRouterCatalogForTest();
  assert.equal(mod.costs.resolvePrice('o3mini').unknown, true, 'plain prefix must not match o3');
  assert.deepEqual(
    [mod.costs.resolvePrice('o3').perMillion.input, mod.costs.resolvePrice('o3').perMillion.output],
    [2, 8], 'o3 itself still resolves from the curated table');
  assert.deepEqual(
    [mod.costs.resolvePrice('gpt-5.1-codex').perMillion.input, mod.costs.resolvePrice('gpt-5.1-codex').perMillion.output],
    [1.25, 10], 'curated exact id still wins (regression guard)');
});

// ------------------------------------------------------------
// 4 · UNKNOWN MODEL HONESTY — never a made-up price
// ------------------------------------------------------------
test('v1135: unknown ids are honestly unknown in the precise API', () => {
  const rows = mod.catalog.parseOpenRouterModels(PAYLOAD);
  mod.catalog.__seedOpenRouterCatalogForTest(rows, FETCHED_MS);
  const r = mod.costs.resolvePrice('never/seen-model-xyz');
  assert.equal(r.source, 'unknown');
  assert.equal(r.unknown, true);
  assert.equal(r.match, 'none');
  assert.equal(r.matchedId, null);
  assert.equal(r.fetchedAt, null);
  assert.equal(r.perToken.input, null);
  assert.equal(r.perToken.output, null);
  assert.equal(r.perMillion.input, null);
  assert.equal(r.perMillion.output, null);

  const b = mod.costs.estimateCostExact('never/seen-model-xyz', 1_000_000, 1_000_000);
  assert.equal(b.costUsd, 0, 'no price ⇒ no invented cost');
  assert.equal(b.unknown, true);
  assert.equal(b.source, 'unknown');

  // Legacy shape is explicitly FLAGGED (never silently presented as known).
  const legacy = mod.costs.priceFor('never/seen-model-xyz');
  assert.equal(legacy.unknown, true);
  assert.equal(legacy.estimated, true);
  assert.equal(legacy.source, 'unknown');
});

test('v1135: -1 dynamic router and partial rows are unknown, not $0 / not mixed', () => {
  for (const id of ['openrouter/auto', 'vendor/partial-price']) {
    const r = mod.costs.resolvePrice(id);
    assert.equal(r.unknown, true, `${id} must be unknown`);
    assert.equal(r.perToken.input, null);
    assert.equal(r.perToken.output, null);
    assert.equal(mod.costs.estimateCostExact(id, 1000, 1000).costUsd, 0);
  }
  assert.equal(mod.costs.priceFor('openrouter/auto').input > 0, true,
    'legacy fallback still flagged (never free-labelled)');
});

// ------------------------------------------------------------
// 5 · SOURCE WIRING — one resolver feeds engine + orb
// ------------------------------------------------------------
test('v1135: priceFor / contextWindowInfo / estimateCostDetailed share the resolver', () => {
  assert.match(COSTS_SRC, /export function resolveModelInfo\(modelId: string\): ResolvedModelInfo/);
  assert.match(COSTS_SRC, /export function resolvePrice\(modelId: string\): ResolvedPrice/);
  assert.match(COSTS_SRC, /export function estimateCostExact\(/);
  const priceBody = COSTS_SRC.slice(COSTS_SRC.indexOf('export function priceFor('), COSTS_SRC.indexOf('export interface CostBreakdown'));
  assert.match(priceBody, /const r = resolvePrice\(modelId\)/, 'priceFor delegates to the single price resolver');
  const winBody = COSTS_SRC.slice(COSTS_SRC.indexOf('export function contextWindowInfo('), COSTS_SRC.indexOf('export function resolveModelInfo('));
  assert.match(winBody, /resolveModelInfo\(/, 'window lookup delegates to the same resolver');
  const detailedBody = COSTS_SRC.slice(COSTS_SRC.indexOf('export function estimateCostDetailed('));
  assert.match(detailedBody, /estimateCostExact\(/, 'legacy cost path delegates to the exact engine');
});
