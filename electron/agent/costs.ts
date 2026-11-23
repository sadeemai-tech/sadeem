// ============================================================
// v11.35 (PRICE-1) — PRECISE, SOURCED, TRACEABLE MODEL PRICING
// ------------------------------------------------------------
// SOURCE PRIORITY (per model id, resolved ONCE by resolveModelInfo):
//   1. LIVE OpenRouter catalog — GET https://openrouter.ai/api/v1/models
//      (docs: https://openrouter.ai/docs/api-reference/list-available-models)
//      Router prices are USD-PER-TOKEN strings: pricing.prompt,
//      pricing.completion, pricing.input_cache_read,
//      pricing.input_cache_write. Exact FULL-id match only (vendor prefix
//      preserved) — a 1M model can never inherit a different model's rate.
//      Each resolved price carries the catalog's fetch timestamp + source URL.
//   2. CURATED table below (RATES / CONTEXT_WINDOWS) — offline fallback,
//      pinned to vendor price pages listed in the legacy header.
//   3. UNKNOWN — honest null prices in resolvePrice()/resolveModelInfo().
//      The legacy priceFor() shape still returns the flagged $3/$15
//      conservative fallback (`unknown: true`) so the picker never labels an
//      unknown PAID model as "free"; it is NOT presented as a known price.
//
// MATH: cost = fresh/1e6*input + cacheRead/1e6*read + cacheWrite/1e6*write
//             + output/1e6*completion. All rate arithmetic is BigInt
//             fixed-point (1e-12 USD); no float rate multiplication, no
//             input/output swap, no double-counted cache segments.
// CAVEATS (documented in docs/PRICE-PRECISION-V1135.md): long-prompt
// "overrides", batch discounts, and non-USD billing are not modelled; the
// final invoice is always the provider's, not this estimate.
// ============================================================
// Surnia — token cost estimation (2026 catalog)
// Rates are USD per 1M tokens (input / output). Unknown models
// are matched by PREFIX (e.g. "claude-sonnet-4-20250514" → the
// claude-sonnet-4 row) after normalizing vendor-qualified ids
// ("anthropic/claude-opus-4.5" → "claude-opus-4-5"); anything
// still unmatched falls back to a conservative $3/$15 row that
// is flagged `estimated: true`.
// Prompt caching: cache READS are billed at 10% of the input
// rate — Anthropic's real rate (and DeepSeek/Kimi/GLM's current
// cache-hit tiers land at ≈10% too). For vendors whose cached-
// input discount is smaller (e.g. GPT-4.1 at 25%, GPT-4o at 50%),
// this rate can UNDERSTATE cost — callers that need a strictly
// conservative figure bill the full input rate instead (see
// providers.ts streamOpenAICompat). Anthropic cache WRITES are
// billed at 125% of input (see estimateCostDetailed).
// PRICE SOURCES (verified Nov 2026): real, currently-served models
// are pinned to their vendor price pages — Anthropic:
// anthropic.com/pricing (claude-opus-4-1 $15/$75, claude-sonnet-4
// $3/$15, claude-haiku-4-5 $1/$5); OpenAI: openai.com/api/pricing
// (gpt-4.1 $2/$8, gpt-5-1 $1.25/$10, gpt-5-1-codex $1.25/$10,
// gpt-5-mini $0.25/$2, o3 $2/$8, o3-mini $1.10/$4.40, o4-mini
// $1.10/$4.40); Google: ai.google.dev/pricing (gemini-2-5-pro
// $1.25/$10, gemini-2-5-flash $0.30/$2.50); DeepSeek:
// api-docs.deepseek.com/quick_start/pricing (chat $0.27/$1.10,
// reasoner $0.55/$2.19); xAI: docs.x.ai (grok-4 $3/$15); Moonshot
// (kimi-k2 $0.60/$2.50); Zhipu (glm-4-6 $0.60/$2.20). The
// next-generation rows (claude-*-5-5, gpt-6-*, gemini-3/4, glm-5-*,
// minimax-m3, muse-*, …) mirror MODEL_CATALOG inPerM/outPerM in
// providers.ts — the in-app catalog is the source of truth for
// those ids; nothing here is invented independently of it.
// Every cost surfaced through this module is an estimate — the
// UI labels it as such; nothing here is a billing source.
// ============================================================

import {
  openrouterContextFor,
  openrouterPriceFor,
} from '../services/openrouterCatalog';

/** UI hint: all costs produced by estimateCost are estimates. */
export const noteEstimate = true;

export interface Price {
  /** USD / 1M input tokens. */
  input: number;
  /** USD / 1M output tokens. */
  output: number;
  /** USD / 1M cache-read tokens (10% of input where caching applies; 0 for local models). */
  cacheRead: number;
  /** true → exact id unknown, conservative fallback pricing applied. */
  estimated: boolean;
  // ---- v11.35 traceability (optional: old callers/UI unchanged) ----
  /** Where the number came from. */
  source?: PriceSource;
  /** How the id was matched. */
  match?: PriceMatch;
  /** true → NO price known in either source; numbers above are the flagged conservative fallback. */
  unknown?: boolean;
  /** USD / 1M cache-write tokens (router-reported or 125% derived). */
  cacheWrite?: number;
  /** Exact row id that supplied the price. */
  matchedId?: string | null;
  /** ISO timestamp of the OpenRouter catalog fetch that supplied the price (live only). */
  fetchedAt?: string | null;
  /** Source URL for the price (live only). */
  sourceUrl?: string | null;
}

interface Rate {
  key: string; // stored NORMALIZED (see normalizeModelId)
  input: number; // USD / 1M input tokens
  output: number; // USD / 1M output tokens
}

// Matched longest-key-first (see priceFor), so 'gpt-5.1-codex'
// wins over 'gpt-5.1' and 'o3-mini' over 'o3' regardless of the
// order here — but keep it roughly most-specific-first anyway.
const RATES: Rate[] = [
  // ---------- Anthropic (cache read = 10% of input) — Nov 2026 catalog ----------
  { key: 'claude-opus-5-5', input: 4, output: 20 },
  { key: 'claude-sonnet-5-5', input: 2, output: 10 },
  { key: 'claude-haiku-5-5', input: 0.1, output: 0.5 },
  { key: 'claude-fable-5-1', input: 10, output: 50 },
  { key: 'claude-opus-5', input: 4, output: 20 },
  { key: 'claude-sonnet-5', input: 2, output: 10 },
  { key: 'claude-opus-4-8', input: 5, output: 25 },
  { key: 'claude-sonnet-4-6', input: 3, output: 15 },
  { key: 'claude-haiku-4-5', input: 1, output: 5 },
  { key: 'claude-sonnet-4-5', input: 3, output: 15 },
  { key: 'claude-opus-4-1', input: 15, output: 75 },
  { key: 'claude-sonnet-4', input: 3, output: 15 },
  // ---------- OpenAI — Nov 2026 catalog ----------
  // -pro tiers pinned explicitly so they outrank their base prefixes
  // (longest-key-first ordering handles precedence).
  { key: 'gpt-6-1-terra-pro', input: 2.5, output: 12 },
  { key: 'gpt-6-1-terra', input: 1, output: 5 },
  { key: 'gpt-6-1-sol-pro', input: 10, output: 50 },
  { key: 'gpt-6-1-sol', input: 2, output: 10 },
  { key: 'gpt-6-astra', input: 10, output: 50 },
  { key: 'gpt-6-luna', input: 0.1, output: 0.5 }, // ultra-cheap workhorse
  { key: 'gpt-6', input: 2, output: 10 },
  { key: 'gpt-5-3-codex', input: 1.75, output: 14 },
  { key: 'gpt-5-2-codex', input: 1.75, output: 14 },
  { key: 'gpt-5-1-codex-mini', input: 0.25, output: 2 },
  { key: 'gpt-5-1-codex', input: 1.25, output: 10 },
  { key: 'gpt-5-5', input: 5, output: 30 },
  { key: 'gpt-5-2', input: 1.25, output: 10 },
  { key: 'gpt-5-1', input: 1.25, output: 10 },
  { key: 'gpt-5-mini', input: 0.25, output: 2 },
  { key: 'gpt-4.1', input: 2, output: 8 },
  { key: 'o3-mini', input: 1.1, output: 4.4 }, // real model, cheaper than o3 — pinned before the 'o3' prefix
  { key: 'o3', input: 2, output: 8 },
  { key: 'o4-mini', input: 1.1, output: 4.4 },
  // ---------- Google — Nov 2026 catalog ----------
  // Standard-tier pricing; intros: argon $2/$10 until 2026-11-30,
  // 3.8-flash $0.75/$3.75 through 2026-12-31.
  { key: 'gemini-4-argon', input: 4, output: 20 },
  { key: 'gemini-3-8-flash', input: 1.5, output: 7.5 },
  { key: 'gemini-3-6-flash', input: 0.3, output: 1.2 },
  { key: 'gemini-3-5-flash-lite', input: 0.3, output: 2.5 },
  { key: 'gemini-3-1-pro', input: 2, output: 12 }, // >200K prompt bills $4/$18
  { key: 'gemini-3-pro', input: 2, output: 12 },
  { key: 'gemini-3-flash', input: 0.15, output: 0.6 },
  { key: 'gemini-2-5-pro', input: 1.25, output: 10 },
  { key: 'gemini-2-5-flash', input: 0.3, output: 2.5 },
  // ---------- Z.ai / GLM — Nov 2026 catalog ----------
  { key: 'glm-5-3-prime', input: 2.8, output: 8.8 },
  { key: 'glm-5-3-flashx', input: 0.37, output: 1.25 },
  { key: 'glm-5-3-flash', input: 0.15, output: 0.5 },
  { key: 'glm-5-3', input: 1.4, output: 4.4 }, // reasoning-only flagship
  { key: 'glm-5-2', input: 1.4, output: 4.4 },
  { key: 'glm-4-7-flash', input: 0, output: 0 }, // free tier
  { key: 'glm-4-7', input: 0.6, output: 2.2 },
  { key: 'glm-4-6', input: 0.6, output: 2.2 },
  // ---------- DeepSeek — Nov 2026 catalog ----------
  // PEAK rates (off-peak UTC nights = 50%; cache-hit input $0.006).
  { key: 'deepseek-flash', input: 0.3, output: 1.2 },
  // v11.10 — OpenRouter-qualified ids like 'deepseek/deepseek-v4.1-flash-1017'
  // normalize to 'deepseek-v4-1-flash-1017' and used to fall through to the
  // generic 'deepseek' row (chat pricing) — pinned to the flash tier instead
  // (matches MODEL_CATALOG deepseek-flash $0.30/$1.20).
  { key: 'deepseek-v4-1-flash', input: 0.3, output: 1.2 },
  { key: 'deepseek-v4-pro', input: 1.32, output: 3.96 },
  { key: 'deepseek-reasoner', input: 0.55, output: 2.19 },
  { key: 'deepseek-chat', input: 0.27, output: 1.1 },
  { key: 'deepseek', input: 0.27, output: 1.1 }, // generic deepseek-* → chat pricing
  // ---------- xAI — Nov 2026 catalog ----------
  { key: 'grok-4-7', input: 2, output: 6 }, // ≥200K prompt bills $4/$12
  { key: 'grok-4-6', input: 2, output: 6 },
  { key: 'grok-4-3', input: 1.25, output: 2.5 }, // 1M long-context tier
  { key: 'grok-4-5', input: 2, output: 6 },
  { key: 'grok-build-0-1', input: 1, output: 2 },
  { key: 'grok-4-20', input: 2, output: 6 },
  { key: 'grok-4', input: 3, output: 15 },
  // ---------- Moonshot (Kimi) — Nov 2026 catalog ----------
  { key: 'kimi-k3-1-pro', input: 2, output: 10 },
  { key: 'kimi-k3-1', input: 2, output: 10 }, // v11.10 — OR-qualified kimi-k3.1-pro ids
  { key: 'kimi-k3', input: 3, output: 16 }, // cache-hit input $0.30
  { key: 'kimi-k2-7-code', input: 0.6, output: 3.5 },
  { key: 'kimi-k2', input: 0.6, output: 2.5 },
  // ---------- Qwen — Nov 2026 catalog ----------
  { key: 'qwen3-8-max', input: 2, output: 6 },
  { key: 'qwen3-8-flash', input: 0.15, output: 0.47 },
  { key: 'qwen3-7-plus', input: 0.4, output: 1.6 }, // ≤256K band
  { key: 'qwen3-coder-next', input: 0.12, output: 0.8 },
  { key: 'qwen3-coder-flash', input: 0.3, output: 1.5 },
  { key: 'qwen3-coder', input: 0.3, output: 1.2 },
  // ---------- Mistral — Nov 2026 catalog ----------
  { key: 'mistral-large-4', input: 0.7, output: 2.1 },
  { key: 'mistral-medium-3-5', input: 1.5, output: 7.5 },
  { key: 'mistral-small-2603', input: 0.1, output: 0.3 },
  { key: 'devstral-2512', input: 0.4, output: 2 },
  { key: 'codestral', input: 0.3, output: 0.9 },
  { key: 'devstral', input: 0.4, output: 1.6 },
  // ---------- Minimax (direct + OpenRouter) ----------
  { key: 'minimax-m3-1-flash', input: 0.075, output: 0.3 },
  { key: 'minimax', input: 0.3, output: 1.2 },
  // ---------- Meta Muse (OpenRouter meta/muse-*) ----------
  { key: 'muse-spark', input: 1.25, output: 4.25 },
  { key: 'muse-glimmer', input: 0.3, output: 1.2 },
  { key: 'muse', input: 4, output: 20 },
  // ---------- OpenRouter free tier ----------
  { key: 'north-mini-code', input: 0, output: 0 },
  { key: 'gemma-4', input: 0, output: 0 },
  // ---------- Local (Ollama & friends) — no metered cost ----------
  { key: 'qwen2-5-coder', input: 0, output: 0 },
  { key: 'gpt-oss', input: 0, output: 0 },
  { key: 'llama', input: 0, output: 0 },
  { key: 'nemotron', input: 0, output: 0 },
];

/** Conservative fallback for fully unknown models. */
const FALLBACK: Rate = { key: '*', input: 3, output: 15 };

/**
 * Normalize a model id for pricing lookups:
 * - lowercase
 * - drop a vendor prefix ("anthropic/claude-opus-4.5" → "claude-opus-4.5")
 * - fold '.', ':' into '-' ("gpt-oss:20b" → "gpt-oss-20b") so Anthropic's
 *   dashed ids and OpenRouter's dotted ids share one keyspace.
 */
function normalizeModelId(modelId: string): string {
  let m = (modelId || '').toLowerCase().trim();
  const slash = m.lastIndexOf('/');
  if (slash >= 0) m = m.slice(slash + 1);
  return m.replace(/[.:]/g, '-');
}

// Pre-normalized, longest-first: prefix matching must prefer the most
// specific key ('gpt-5-1-codex' before 'gpt-5-1', 'o3-mini' before 'o3').
const NORMALIZED_RATES: Rate[] = RATES.map((r) => ({ ...r, key: normalizeModelId(r.key) })).sort(
  (a, b) => b.key.length - a.key.length,
);

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

// ============================================================
// v11.35 — DECIMAL-SAFE ARITHMETIC (no float rate multiplication)
// A Dec is the EXACT rational n / 10^scale. Router strings and curated
// USD/1M numbers are both parsed into this form; all billing is done in
// BigInt fixed-point with 1e-12 USD granularity, then converted ONCE.
// ============================================================
interface Dec { n: bigint; scale: number }
const ZERO_DEC: Dec = { n: 0n, scale: 0 };
/** Fixed-point output scale: 1e-12 USD (sub-micro-dollar precision). */
const USD_SCALE = 12;
const USD_SCALE_BIG = 10n ** BigInt(USD_SCALE);

function parseDecimal(value: string | number | null | undefined): Dec | null {
  if (value === null || value === undefined) return null;
  let s = String(value).trim();
  if (!s) return null;
  let exp = 0;
  const e = s.search(/[eE]/);
  if (e >= 0) {
    const parsedExp = Number(s.slice(e + 1));
    if (!Number.isFinite(parsedExp)) return null;
    exp = Math.trunc(parsedExp);
    s = s.slice(0, e);
  }
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (!m[2] && !m[3])) return null;
  const negative = m[1] === '-';
  const intPart = m[2] || '0';
  const frac = m[3] || '';
  let scale = frac.length - exp;
  let digits: string;
  if (scale >= 0) digits = intPart + frac;
  else { digits = intPart + '0'.repeat(-scale); scale = 0; }
  digits = digits.replace(/^0+/, '') || '0';
  if (digits === '0') return ZERO_DEC;
  while (scale > 0 && digits.endsWith('0')) { digits = digits.slice(0, -1); scale--; }
  const n = BigInt(digits);
  return { n: negative ? -n : n, scale };
}

function decimalToString(d: Dec): string {
  // Canonical form — derived rates (×125 / 10^2) can leave trailing zeros;
  // strip them so the exact string stays letter-identical to the source.
  let { n, scale } = d;
  while (scale > 0 && n % 10n === 0n) { n /= 10n; scale--; }
  const sign = n < 0n ? '-' : '';
  const digits = (n < 0n ? -n : n).toString().padStart(scale + 1, '0');
  if (scale === 0) return sign + digits;
  return sign + digits.slice(0, -scale) + '.' + digits.slice(-scale);
}

/** Curated USD / 1M → EXACT USD / token decimal string. */
function perMillionToPerToken(value: number): string | null {
  const d = parseDecimal(value);
  if (!d || d.n < 0n) return null;
  return decimalToString({ n: d.n, scale: d.scale + 6 });
}

/** Derive a cache rate from an input rate when the router didn't report one. */
function deriveCacheRate(perToken: string | null, kind: 'read' | 'write'): string | null {
  const d = parseDecimal(perToken);
  if (!d || d.n < 0n) return null;
  // read = 10% of input (×1 / 10^1), write = 125% of input (×125 / 10^2).
  return kind === 'read'
    ? decimalToString({ n: d.n, scale: d.scale + 1 })
    : decimalToString({ n: d.n * 125n, scale: d.scale + 2 });
}

function clampTokens(n: number): bigint {
  return BigInt(!Number.isFinite(n) || n <= 0 ? 0 : Math.floor(n));
}

/** Exact USD value of `tokens` at `perToken` (USD/token string), as 1e-12 units. */
function costScaled(tokens: number, perToken: string | null): bigint {
  const d = parseDecimal(perToken);
  if (!d || d.n <= 0n) return 0n;
  const t = clampTokens(tokens);
  if (t === 0n) return 0n;
  const num = t * d.n * USD_SCALE_BIG;
  const den = 10n ** BigInt(d.scale);
  let q = num / den;
  const rem = num % den;
  if (rem * 2n >= den) q += 1n; // half-up at 1e-12 USD
  return q;
}

function scaledToUsd(scaled: bigint): number {
  // Number stays an exact integer up to 2^53; 9e15 units = $9,000 — far
  // beyond any single modeled call. Beyond that, a documented float fallback
  // is used rather than throwing (still never mixes input/output rates).
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(scaled) / Number(USD_SCALE_BIG);
  }
  return Number(scaled) / 1e12;
}

// ============================================================
// Context windows (tokens) — prefix-matched like pricing.
// Powers the StatusBar context meter ("34% used") and the
// /compact threshold warnings. Values are the advertised
// context windows of the current-generation models (2026).
// ============================================================
const CONTEXT_WINDOWS: { key: string; ctx: number }[] = [
  // ---------- Anthropic — all 1M context in the 5.x line ----------
  { key: 'claude-opus-5-5', ctx: 1_000_000 },
  { key: 'claude-sonnet-5-5', ctx: 1_000_000 },
  { key: 'claude-haiku-5-5', ctx: 1_000_000 },
  { key: 'claude-fable-5-1', ctx: 1_000_000 },
  { key: 'claude-opus-5', ctx: 1_000_000 },
  { key: 'claude-sonnet-5', ctx: 1_000_000 },
  { key: 'claude-opus-4-8', ctx: 1_000_000 },
  { key: 'claude-sonnet-4-6', ctx: 1_000_000 },
  { key: 'claude-haiku-4-5', ctx: 200_000 },
  { key: 'claude-sonnet-4-5', ctx: 200_000 },
  { key: 'claude-opus-4-1', ctx: 200_000 },
  { key: 'claude-sonnet-4', ctx: 200_000 },
  { key: 'claude-3-7', ctx: 200_000 },
  { key: 'claude-3-5', ctx: 200_000 },
  // ---------- OpenAI ----------
  { key: 'gpt-6-1-terra', ctx: 1_050_000 },
  { key: 'gpt-6-1-sol', ctx: 1_050_000 },
  { key: 'gpt-6-astra', ctx: 1_050_000 },
  { key: 'gpt-6-luna', ctx: 1_050_000 },
  { key: 'gpt-6', ctx: 1_050_000 },
  { key: 'gpt-5-3-codex', ctx: 400_000 },
  { key: 'gpt-5-2-codex', ctx: 400_000 },
  { key: 'gpt-5-1-codex', ctx: 400_000 },
  { key: 'gpt-5-5', ctx: 1_050_000 },
  { key: 'gpt-5-2', ctx: 400_000 },
  { key: 'gpt-5-1', ctx: 400_000 },
  { key: 'gpt-5', ctx: 400_000 },
  { key: 'gpt-4.1', ctx: 1_000_000 },
  { key: 'gpt-4o', ctx: 128_000 },
  { key: 'o3-mini', ctx: 200_000 },
  { key: 'o3', ctx: 200_000 },
  { key: 'o4-mini', ctx: 200_000 },
  // ---------- Google — Gemini 4 line is 1M ----------
  { key: 'gemini-4-argon', ctx: 1_048_576 },
  { key: 'gemini-3-8-flash', ctx: 1_048_576 },
  { key: 'gemini-3-6-flash', ctx: 1_048_576 },
  { key: 'gemini-3-5-flash-lite', ctx: 1_048_576 },
  { key: 'gemini-3-1-pro', ctx: 1_048_576 },
  { key: 'gemini-3', ctx: 1_048_576 },
  { key: 'gemini-2-5-pro', ctx: 1_048_576 },
  { key: 'gemini-2-5-flash', ctx: 1_048_576 },
  { key: 'gemini-2', ctx: 1_048_576 },
  // ---------- DeepSeek — V4 line is 1M (chat/reasoner route to flash) ----------
  { key: 'deepseek-flash', ctx: 1_000_000 },
  { key: 'deepseek-v4', ctx: 1_000_000 }, // v11.10 — matches deepseek-v4.1-flash-1017 too
  { key: 'deepseek-chat', ctx: 1_000_000 }, // routes to the flash tier (catalog note)
  { key: 'deepseek-reasoner', ctx: 1_000_000 }, // routes to the flash tier (catalog note)
  { key: 'deepseek', ctx: 64_000 }, // bare/generic legacy ids only
  // ---------- GLM / Zhipu — 5.x line is 1M (1,048,576 per MODEL_CATALOG) ----------
  { key: 'glm-5', ctx: 1_048_576 },
  { key: 'glm-4-7', ctx: 200_000 },
  { key: 'glm-4-6', ctx: 200_000 },
  { key: 'glm-4-5', ctx: 128_000 },
  { key: 'glm-4', ctx: 128_000 },
  // ---------- xAI — Grok 4.7 is 500K, 4.3 is 1M ----------
  { key: 'grok-4-7', ctx: 500_000 },
  { key: 'grok-4-6', ctx: 500_000 },
  { key: 'grok-4-3', ctx: 1_000_000 },
  { key: 'grok-4-5', ctx: 500_000 },
  { key: 'grok-build', ctx: 256_000 },
  { key: 'grok-4-20', ctx: 2_000_000 },
  { key: 'grok', ctx: 256_000 },
  // ---------- Moonshot — K3 line is 1M (1,048,576 per MODEL_CATALOG) ----------
  { key: 'kimi-k3', ctx: 1_048_576 },
  { key: 'kimi-k2-7', ctx: 262_144 },
  { key: 'kimi-k2', ctx: 262_144 },
  { key: 'kimi', ctx: 262_144 },
  // ---------- Qwen ----------
  { key: 'qwen3-8', ctx: 1_000_000 },
  { key: 'qwen3-7-plus', ctx: 256_000 },
  { key: 'qwen3-7', ctx: 1_000_000 },
  { key: 'qwen3-coder-next', ctx: 1_000_000 },
  { key: 'qwen3-coder', ctx: 256_000 },
  { key: 'qwen', ctx: 128_000 },
  // ---------- Mistral (ctx per MODEL_CATALOG) ----------
  { key: 'mistral-large-4', ctx: 1_048_576 },
  { key: 'mistral-medium', ctx: 262_144 },
  { key: 'mistral-small', ctx: 128_000 },
  { key: 'devstral-2512', ctx: 256_000 }, // direct-provider catalog row is authoritative (OR row says 262,144)
  { key: 'devstral', ctx: 128_000 },
  { key: 'codestral', ctx: 256_000 },
  { key: 'mistral', ctx: 128_000 },
  // ---------- Minimax ----------
  { key: 'minimax-m3', ctx: 1_000_000 },
  { key: 'minimax', ctx: 200_000 },
  // ---------- Meta Muse (OpenRouter) + OR free tier ----------
  { key: 'muse', ctx: 1_000_000 },
  { key: 'muse-glimmer', ctx: 131_072 },
  { key: 'north-mini-code', ctx: 262_144 },
  { key: 'gemma-4', ctx: 262_144 },
  { key: 'nemotron', ctx: 1_000_000 },
  // ---------- Others / local ----------
  { key: 'llama', ctx: 128_000 },
  { key: 'gpt-oss', ctx: 128_000 },
];

// v11.10 — honest default for models with NO catalog entry: the modern
// agentic norm (200k) shown with an "≈" marker in the UI — never presented
// as an exact figure. (Was 128k, which silently under-measured every
// unknown long-context model.)
const CONTEXT_FALLBACK = 200_000;

/**
 * Advertised context window (tokens) for a model id, prefix-matched after
 * the same normalization as pricing. Unknown ids → honest default 200k
 * (flagged `estimated` by contextWindowInfo — the UI shows "≈ 200,000").
 * Nov 2026 refresh: mirrors the MODEL_CATALOG ctx values in providers.ts.
 */
export function contextWindowFor(modelId: string): number {
  return contextWindowInfo(modelId).ctx;
}

/**
 * v11.10 — context window + honesty flag. `estimated: true` means the id
 * matched NO catalog row and the returned window is the 200k default: the
 * context meter must mark it with "≈" instead of presenting a precise-looking
 * fake number.
 */
/**
 * v11.35 — BOUNDARY-SAFE curated lookup: exact id first, then the longest
 * prefix that ends on a token boundary ('-'). Plain `startsWith` would let
 * e.g. `gpt-6-1-terra` match a different `gpt-6-1-terra-x` row — exactly the
 * founder's "1M model gets another model's price" failure mode.
 */
function curatedMatch<T extends { key: string }>(norm: string, table: readonly T[]): T | null {
  const rows = table
    .map((row) => ({ ...row, key: normalizeModelId(row.key) }))
    .sort((a, b) => b.key.length - a.key.length);
  return (
    rows.find((row) => row.key === norm) ??
    rows.find((row) => norm.startsWith(row.key) && (norm.length === row.key.length || norm[row.key.length] === '-')) ??
    null
  );
}

/** Curated-only window lookup (the offline fallback used by resolveModelInfo). */
function curatedContextWindowInfo(modelId: string): { ctx: number; estimated: boolean } {
  const hit = curatedMatch(normalizeModelId(modelId), CONTEXT_WINDOWS);
  return hit ? { ctx: hit.ctx, estimated: false } : { ctx: CONTEXT_FALLBACK, estimated: true };
}

/**
 * Context window + honesty flag. v11.35: delegates to the SAME resolver that
 * prices the model, so the orb and the engine cannot disagree about a 1M
 * model. Public shape stays `{ ctx, estimated }` for existing callers.
 */
export function contextWindowInfo(modelId: string): { ctx: number; estimated: boolean } {
  const info = resolveModelInfo(modelId);
  return info.contextWindow === null
    ? { ctx: CONTEXT_FALLBACK, estimated: true }
    : { ctx: info.contextWindow, estimated: info.contextEstimated };
}

// ============================================================
// v11.35 — SINGLE RESOLVER (shared by the engine AND the orb)
// ============================================================

export type PriceSource = 'openrouter-live' | 'curated' | 'unknown';
export type PriceMatch = 'exact' | 'suffix' | 'prefix' | 'none';

/** Fully traceable price for one model id. Rates are USD/TOKEN decimal strings. */
export interface ResolvedPrice {
  modelId: string;
  normalizedId: string;
  source: PriceSource;
  match: PriceMatch;
  /** Exact row/key that supplied the price (null when unknown). */
  matchedId: string | null;
  /** USD per token, exact decimal strings — null means UNKNOWN, never 0. */
  perToken: { input: string | null; output: string | null; cacheRead: string | null; cacheWrite: string | null };
  /** Same numbers in USD per 1M for display, derived from `perToken`. */
  perMillion: { input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null };
  /** ISO timestamp of the live OpenRouter fetch (null for curated/unknown). */
  fetchedAt: string | null;
  /** Source URL of a live price (null for curated/unknown). */
  sourceUrl: string | null;
  /** true → no price in EITHER source — no number has been invented. */
  unknown: boolean;
  /** true → cache rates were derived (10% / 125%) because the router omitted them. */
  cacheRatesDerived: boolean;
}

/** Price + context window + provenance from ONE resolution pass. */
export interface ResolvedModelInfo {
  modelId: string;
  normalizedId: string;
  price: ResolvedPrice;
  /** null when neither the router nor the catalog knows the window. */
  contextWindow: number | null;
  contextSource: PriceSource;
  contextEstimated: boolean;
  fetchedAt: string | null;
}

function fullRouterKey(id: string): string {
  return String(id ?? '').trim().toLowerCase().replace(/[.:]/g, '-');
}

/**
 * THE price resolver. Live OpenRouter first (exact full id; no prefix / no
 * vendor bleed), curated table second (boundary-safe), honest unknown last.
 * A partial live row (only prompt or only completion) is DISCARDED rather
 * than mixed with a curated rate — input and output always come from the
 * same source/version.
 */
export function resolvePrice(modelId: string): ResolvedPrice {
  const id = String(modelId ?? '');
  const norm = normalizeModelId(id);
  const live = openrouterPriceFor(id);
  const liveComplete = !!live && live.price.prompt !== null && live.price.completion !== null;

  let source: PriceSource = 'unknown';
  let match: PriceMatch = 'none';
  let matchedId: string | null = null;
  let fetchedAt: string | null = null;
  let sourceUrl: string | null = null;
  let input: string | null = null;
  let output: string | null = null;
  let cacheRead: string | null = null;
  let cacheWrite: string | null = null;
  let cacheRatesDerived = false;

  if (liveComplete && live) {
    source = 'openrouter-live';
    match = fullRouterKey(live.id) === fullRouterKey(id) ? 'exact' : 'suffix';
    matchedId = live.id;
    fetchedAt = live.fetchedAt == null ? null : new Date(live.fetchedAt).toISOString();
    sourceUrl = live.source;
    input = live.price.prompt;
    output = live.price.completion;
    cacheRead = live.price.cacheRead;
    cacheWrite = live.price.cacheWrite;
    if (cacheRead === null) { cacheRead = deriveCacheRate(input, 'read'); cacheRatesDerived = true; }
    if (cacheWrite === null) { cacheWrite = deriveCacheRate(input, 'write'); cacheRatesDerived = true; }
  } else {
    const hit = curatedMatch(norm, NORMALIZED_RATES.filter((r) => r.key !== '*'));
    if (hit) {
      source = 'curated';
      match = normalizeModelId(hit.key) === norm ? 'exact' : 'prefix';
      matchedId = hit.key;
      input = perMillionToPerToken(hit.input);
      output = perMillionToPerToken(hit.output);
      cacheRead = deriveCacheRate(input, 'read');
      cacheWrite = deriveCacheRate(input, 'write');
      cacheRatesDerived = true;
    }
  }

  const unknown = input === null || output === null;
  const perMillionOf = (pt: string | null): number | null =>
    pt === null ? null : scaledToUsd(costScaled(1_000_000, pt));
  return {
    modelId: id,
    normalizedId: norm,
    source: unknown ? 'unknown' : source,
    match: unknown ? 'none' : match,
    matchedId: unknown ? null : matchedId,
    perToken: { input, output, cacheRead, cacheWrite },
    perMillion: {
      input: perMillionOf(input),
      output: perMillionOf(output),
      cacheRead: cacheRead === null ? null : perMillionOf(cacheRead),
      cacheWrite: cacheWrite === null ? null : perMillionOf(cacheWrite),
    },
    fetchedAt: unknown ? null : fetchedAt,
    sourceUrl: unknown ? null : sourceUrl,
    unknown,
    cacheRatesDerived: cacheRatesDerived && !unknown,
  };
}

/**
 * THE shared resolver: price AND window for a model id in one pass. The
 * engine (cost metering + compaction) and the orb (kdx:model:info) both
 * ultimately read from here, so a 1M window and its price can never come
 * from different models.
 */
export function resolveModelInfo(modelId: string): ResolvedModelInfo {
  const price = resolvePrice(modelId);
  const reported = openrouterContextFor(modelId); // exact router-reported window
  const curated = curatedContextWindowInfo(modelId);
  const contextWindow = reported ?? (curated.estimated ? null : curated.ctx);
  return {
    modelId,
    normalizedId: normalizeModelId(modelId),
    price,
    contextWindow,
    contextSource: reported !== null ? 'openrouter-live' : curated.estimated ? 'unknown' : 'curated',
    contextEstimated: reported === null && curated.estimated,
    fetchedAt: price.fetchedAt,
  };
}

/**
 * Price lookup (legacy UI shape). v11.35: delegates to `resolvePrice`, so a
 * live router rate wins and an unknown id is explicitly flagged `unknown`.
 * The $3/$15 fallback numbers remain ONLY to keep the legacy picker from
 * mistaking an unknown paid model for a free one — they are not a claim.
 */
export function priceFor(modelId: string): Price {
  const r = resolvePrice(modelId);
  if (r.unknown) {
    return {
      input: FALLBACK.input,
      output: FALLBACK.output,
      cacheRead: round6(FALLBACK.input * 0.1),
      cacheWrite: round6(FALLBACK.input * 1.25),
      estimated: true,
      source: 'unknown',
      match: 'none',
      unknown: true,
      matchedId: null,
      fetchedAt: null,
      sourceUrl: null,
    };
  }
  return {
    input: r.perMillion.input ?? 0,
    output: r.perMillion.output ?? 0,
    cacheRead: r.perMillion.cacheRead ?? 0,
    cacheWrite: r.perMillion.cacheWrite ?? 0,
    estimated: false,
    source: r.source,
    match: r.match,
    unknown: false,
    matchedId: r.matchedId,
    fetchedAt: r.fetchedAt,
    sourceUrl: r.sourceUrl,
  };
}

/** Exact, disjoint billed segments. `parts` sum to `costUsd` to 1e-12 USD. */
export interface CostBreakdown {
  modelId: string;
  costUsd: number;
  estimated: boolean;
  unknown: boolean;
  source: PriceSource;
  matchedId: string | null;
  fetchedAt: string | null;
  sourceUrl: string | null;
  parts: {
    /** inputTokens ONLY — cache segments are billed separately below. */
    fresh: number;
    cacheRead: number;
    cacheWrite: number;
    output: number;
  };
}

/**
 * v11.35 — exact cost. `inputTokens` counts ONLY tokens billed at the full
 * input rate (provider input MINUS cache reads/creations — providers.ts
 * already passes that split). Cache read/write use their OWN rates (router
 * reported when available, else 10% / 125% of input). All four segments are
 * accumulated in a single BigInt sum: no float rate multiplication, no
 * input/output swap, no cache double-count.
 */
export function estimateCostExact(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheCreationTokens = 0,
): CostBreakdown {
  const r = resolvePrice(model);
  const fresh = costScaled(inputTokens, r.perToken.input);
  const read = costScaled(cacheReadTokens, r.perToken.cacheRead);
  const write = costScaled(cacheCreationTokens, r.perToken.cacheWrite);
  const out = costScaled(outputTokens, r.perToken.output);
  return {
    modelId: model,
    costUsd: scaledToUsd(fresh + read + write + out),
    estimated: r.unknown,
    unknown: r.unknown,
    source: r.source,
    matchedId: r.matchedId,
    fetchedAt: r.fetchedAt,
    sourceUrl: r.sourceUrl,
    parts: {
      fresh: scaledToUsd(fresh),
      cacheRead: scaledToUsd(read),
      cacheWrite: scaledToUsd(write),
      output: scaledToUsd(out),
    },
  };
}

/**
 * Detailed cost estimate with prompt-caching rates (backwards-compatible).
 * `provider` is accepted for signature stability; pricing is keyed on model.
 */
export function estimateCostDetailed(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheCreationTokens = 0,
): { costUsd: number; estimated: boolean; unknown?: boolean; source?: PriceSource; fetchedAt?: string | null } {
  void provider; // accepted for signature stability; pricing is keyed on model
  const b = estimateCostExact(model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens);
  if (!b.unknown) {
    return {
      costUsd: b.costUsd,
      estimated: b.estimated,
      unknown: b.unknown,
      source: b.source,
      fetchedAt: b.fetchedAt,
    };
  }
  // LEGACY ONLY — the engine treats costUsd === 0 as "no provider usage", so
  // an unknown model still gets the historical CONSERVATIVE budget estimate.
  // It is explicitly flagged `estimated/unknown: true` here and in priceFor();
  // the precise API (resolvePrice / estimateCostExact) returns honest null/0
  // and never presents this number as a known price.
  const inPt = perMillionToPerToken(FALLBACK.input) ?? '0';
  const outPt = perMillionToPerToken(FALLBACK.output) ?? '0';
  const total =
    costScaled(inputTokens, inPt) +
    costScaled(cacheReadTokens, deriveCacheRate(inPt, 'read')) +
    costScaled(cacheCreationTokens, deriveCacheRate(inPt, 'write')) +
    costScaled(outputTokens, outPt);
  return {
    costUsd: scaledToUsd(total),
    estimated: true,
    unknown: true,
    source: 'unknown',
    fetchedAt: null,
  };
}

/**
 * Estimated cost in USD for a single model call (no cache split —
 * backwards-compatible shim over estimateCostDetailed).
 * `provider` is accepted for signature stability; pricing is keyed on model.
 */
export function estimateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  return estimateCostDetailed(provider, model, inputTokens, outputTokens).costUsd;
}
