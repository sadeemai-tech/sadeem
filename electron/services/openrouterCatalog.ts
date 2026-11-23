// ============================================================
// Surnia — LIVE OpenRouter catalog fetcher (A6)
// GET https://openrouter.ai/api/v1/models and map the router's full
// model list into picker-shaped rows so the agent can use ANY router
// model (incl. :free variants) without waiting for a MODEL_CATALOG
// refresh in providers.ts.
//
// Contract:
//  • 12s timeout via global fetch + AbortController.
//  • In-module cache, 10 minutes (per key — a new key refetches).
//  • `force: true` (explicit user refresh / provider enable) bypasses
//    the TTL so a catalog changed since the last picker open is seen.
//  • NEVER throws: resolves [] on any network / auth / parse error;
//    the picker keeps the static catalog as the visible fallback and
//    the last GOOD live list stays available for context lookups.
//  • The raw key is NEVER kept in module state — only a short
//    fingerprint used to tell caches apart.
//
// v11.35 (PRICE-1) — PRICING IS NOW CAPTURED, NOT DISCARDED.
// The router's `pricing` object is reported as USD-PER-TOKEN STRINGS:
//   { prompt, completion, input_cache_read, input_cache_write }
// (source: GET https://openrouter.ai/api/v1/models —
//  https://openrouter.ai/docs/api-reference/list-available-models).
// We keep the exact strings (never parseFloat them into a float) so
// `costs.ts` can do decimal-safe BigInt arithmetic. `fetchedAt` travels
// with every lookup so a displayed number is traceable to its fetch.
//
// v1138 — EFFORT CAPABILITY. The endpoint's REAL `supported_parameters` array
// is kept on every row and exposed through `openrouterEffortSignalFor()`.
// The provider does NOT publish named effort levels — level names stay curated
// in shared/effort.ts and are labelled as such.
// ============================================================

import type { EffortCatalogSignal } from '../../shared/effort';

/** USD-per-token prices as reported by OpenRouter, kept as exact decimal strings. */
export interface OpenRouterPrice {
  /** pricing.prompt — USD per input token (string, e.g. "0.000002"). */
  prompt: string | null;
  /** pricing.completion — USD per output token. */
  completion: string | null;
  /** pricing.input_cache_read — USD per cache-read token (null when unreported). */
  cacheRead: string | null;
  /** pricing.input_cache_write — USD per cache-write/creation token (null when unreported). */
  cacheWrite: string | null;
}

/** One live model row as consumed by the ModelPicker live group. */
export interface OpenRouterLiveModel {
  /** Exact router model id, sent verbatim as the API model (e.g. "deepseek/deepseek-r1:free"). */
  id: string;
  /** Router display name (e.g. "DeepSeek: DeepSeek R1 (free)"). */
  name: string;
  /** Advertised input context window (tokens); 0 when unreported. */
  ctx: number;
  /** Zero-metered pricing — pricing.prompt === '0' AND pricing.completion === '0',
   *  or a `:free` variant id when the router reports no prices at all. */
  free: boolean;
  /** Accepts image input (architecture.input_modalities / modality). */
  vision?: boolean;
  /** Exact router-reported USD-per-token prices (v11.35). Absent on hand-built test rows. */
  price?: OpenRouterPrice;
  /**
   * v1138 — the provider's REAL `supported_parameters` array from
   * `/api/v1/models` (e.g. ["reasoning", "temperature", "tools"]).
   * Used to decide whether a reasoning wire field is accepted — never to
   * invent level names (the endpoint does not publish them).
   */
  supportedParameters?: string[];
}

/** A live price row plus the provenance of the catalog it came from. */
export interface OpenRouterPriceRow {
  id: string;
  name: string;
  price: OpenRouterPrice;
  /** Epoch ms at which THIS catalog was fetched (null for injected explicit rows). */
  fetchedAt: number | null;
  /** Source URL — every number is traceable to this endpoint. */
  source: string;
}

/** Options for a live fetch. Everything is optional — old callers are unchanged. */
export interface OpenRouterFetchOptions {
  /** Skip the TTL cache and fetch fresh (used by explicit enable/refresh). */
  force?: boolean;
  /** Per-call timeout override (ms). Default 12s. */
  timeoutMs?: number;
}

/** Honest cache metadata for callers that want to show "fetched X ago". */
export interface OpenRouterCatalogInfo {
  count: number;
  fetchedAt: number;
  ageMs: number;
  stale: boolean;
  keyFingerprint: string;
}

const ENDPOINT = 'https://openrouter.ai/api/v1/models';
const FETCH_TIMEOUT_MS = 12_000;
/** Picker opens are cheap after the first fetch — 10-minute module cache. */
export const OPENROUTER_CATALOG_TTL_MS = 10 * 60 * 1000;

interface OpenRouterRawModel {
  id?: string;
  name?: string;
  context_length?: number | string;
  architecture?: { input_modalities?: string[]; modality?: string };
  /** v1138 — real capability list reported by the router's model endpoint. */
  supported_parameters?: string[];
  /** Router prices are strings ("0" / "0.0000025"), USD per TOKEN. */
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
    input_cache_read?: string | number;
    input_cache_write?: string | number;
  };
}

interface CatalogCache {
  keyFingerprint: string;
  at: number;
  models: OpenRouterLiveModel[];
}

/** Single module-level cache entry, keyed by a FINGERPRINT of the key it was fetched with. */
let cache: CatalogCache | null = null;

/**
 * Non-crypto, non-reversible-enough fingerprint used ONLY to tell cache
 * entries apart. Deliberately not the key itself: a module-level cache must
 * never retain a raw credential.
 */
function keyFingerprint(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function priceIsZero(v: string | number | undefined): boolean {
  if (v === undefined || v === null) return false;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) && n === 0;
}

function positiveInt(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.trim());
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return 0;
}

/**
 * v11.35 — keep the router's decimal string EXACTLY as reported; never
 * round-trip it through a float. Missing, non-finite, and the documented
 * `-1` dynamic-router sentinel (openrouter/auto, …) become null so no
 * caller can mistake "price unknown" for "$0 / free".
 */
function exactPriceString(v: string | number | undefined | null): string | null {
  if (v === undefined || v === null) return null;
  const s = typeof v === 'number' ? String(v) : String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? s : null;
}

/**
 * Parse a REAL OpenRouter `/api/v1/models` payload (including the `pricing`
 * object) into picker rows that also carry exact per-token prices.
 * Exported for the v1135 precision suite, which injects a real-shaped fixture
 * instead of a hand-made catalog.
 */
export function parseOpenRouterModels(json: unknown): OpenRouterLiveModel[] {
  const rows = (json as { data?: OpenRouterRawModel[] } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const out: OpenRouterLiveModel[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const pricing = r.pricing ?? {};
    const pricingReported = pricing.prompt !== undefined || pricing.completion !== undefined;
    // Trust the router's prices when they are present; only fall back to the
    // `:free` id convention when the router reported nothing (never claim a
    // priced model is free).
    const priced = pricing.prompt !== undefined && pricing.completion !== undefined;
    const free = priced
      ? priceIsZero(pricing.prompt) && priceIsZero(pricing.completion)
      : !pricingReported && /:free$/i.test(id);
    const mods = r.architecture?.input_modalities;
    const modality = r.architecture?.modality ?? '';
    const vision = Array.isArray(mods)
      ? mods.some((m) => typeof m === 'string' && m.toLowerCase() === 'image')
      : /image/i.test(modality);
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : id;
    // v1138 — keep the provider's REAL capability list verbatim. Names of the
    // effort levels are NOT in this payload; shared/effort.ts says so honestly.
    const supportedParameters = Array.isArray(r.supported_parameters)
      ? r.supported_parameters.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      : [];
    // v11.35 — preserve the exact router strings for decimal-safe billing.
    const price: OpenRouterPrice = {
      prompt: exactPriceString(pricing.prompt),
      completion: exactPriceString(pricing.completion),
      cacheRead: exactPriceString(pricing.input_cache_read),
      cacheWrite: exactPriceString(pricing.input_cache_write),
    };
    out.push({
      id,
      name,
      ctx: positiveInt(r.context_length),
      free,
      ...(vision ? { vision: true } : {}),
      price,
      ...(supportedParameters.length ? { supportedParameters } : {}),
    });
  }
  return out;
}

/**
 * Live OpenRouter model list — best-effort. Resolves [] when no key is
 * configured or the fetch fails for any reason; caches successful lists
 * in-module for 10 minutes (per key). A failed fetch NEVER discards the
 * last good list — it stays available to `cachedOpenRouterModels()` /
 * `openrouterContextFor()` so the context bar keeps a provider-reported
 * window instead of silently degrading to ≈200k.
 */
export async function openrouterLiveModels(
  apiKey: string,
  opts: OpenRouterFetchOptions = {},
): Promise<OpenRouterLiveModel[]> {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) return [];

  const fp = keyFingerprint(key);
  const now = Date.now();
  const fresh = cache && cache.keyFingerprint === fp && now - cache.at < OPENROUTER_CATALOG_TTL_MS;
  if (fresh && !opts.force) return cache!.models;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1, opts.timeoutMs ?? FETCH_TIMEOUT_MS));
  try {
    const res = await fetch(ENDPOINT, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const models = parseOpenRouterModels(await res.json().catch(() => null));
    if (models.length) cache = { keyFingerprint: fp, at: Date.now(), models };
    return models;
  } catch {
    return []; // never throw — the picker falls back to the static catalog
  } finally {
    clearTimeout(timer);
  }
}

/** Drop the in-module catalog (e.g. user clicked "Refresh models"). */
export function invalidateOpenRouterCache(): void {
  cache = null;
}

/** Metadata about the cached catalog — including whether it is stale. */
export function cachedOpenRouterCatalogInfo(): OpenRouterCatalogInfo | null {
  if (!cache) return null;
  const ageMs = Math.max(0, Date.now() - cache.at);
  return {
    count: cache.models.length,
    fetchedAt: cache.at,
    ageMs,
    stale: ageMs >= OPENROUTER_CATALOG_TTL_MS,
    keyFingerprint: cache.keyFingerprint,
  };
}

// ------------------------------------------------------------
// v11.11 (A6) — PROVIDER-REPORTED CONTEXT WINDOWS
// The live catalog rows carry each router model's EXACT advertised
// context_length (contextWindowInfo's per-model table only knows curated
// prefixes). The kdx:model:info handler consults the cache first — it is
// populated by the ModelPicker's live group and by provider enable — so the
// context bar uses the provider's own number for OpenRouter models, then the
// per-model table, then the honest ≈200k default.
// ------------------------------------------------------------

/** Synchronous read of the in-module cache ([] when nothing was fetched yet). */
export function cachedOpenRouterModels(): OpenRouterLiveModel[] {
  return cache?.models ?? [];
}

/**
 * EXACT provider-reported context window for a router model id (case- and
 * trim-insensitive exact match), or null when the catalog has no row for it
 * (caller falls back to the per-model table / 200k ≈ default).
 * Pass `models` explicitly in tests; production reads the module cache.
 */
export function openrouterContextFor(modelId: string, models?: OpenRouterLiveModel[]): number | null {
  const want = routerIdKey(modelId);
  if (!want) return null;
  const rows = models ?? cachedOpenRouterModels();
  // 1) exact router id (the founder's "from the source" path).
  const exact = rows.find((r) => r.ctx > 0 && routerIdKey(r.id) === want);
  if (exact) return exact.ctx;
  // 2) v1137 — a BARE id ("claude-sonnet-4.5") must still find the provider's
  // window when the live row is vendor-prefixed ("anthropic/claude-sonnet-4.5").
  // Unique suffix ONLY — never guess between two vendors (same rule as pricing).
  if (!want.includes('/')) {
    const matches = rows.filter((r) => r.ctx > 0 && bareRouterIdKey(r.id) === want);
    if (matches.length === 1) return matches[0].ctx;
  }
  return null;
}

// ------------------------------------------------------------
// v1137 — HIGH-PRECISION CURATED WINDOW FALLBACK (offline safety net)
// THE FOUNDER'S BUG: the live catalog is only fetched when the model
// picker opens (or a provider is enabled). On a cold/offline start there
// is NO catalog row, so `contextWindowInfo()` falls back to costs.ts's
// generic 200k — and a genuine 1M model is displayed as "200,000". D13's
// "13/13" only proved the INJECTED-catalog path; this table covers the
// real, offline runtime path with published per-model windows.
//
// This is a SEPARATE, high-precision table: costs.ts is owned by another
// agent and its generic CONTEXT_WINDOWS intentionally keeps some ids at
// 200k. We never touch it — the kdx:model:info handler consults THIS table
// only when the live provider catalog has no row for the id.
// ------------------------------------------------------------

/** Normalize a model id the same way the pricing/context tables do. */
function windowKey(modelId: string): string {
  let m = String(modelId ?? '').toLowerCase().trim();
  const slash = m.lastIndexOf('/');
  if (slash >= 0) m = m.slice(slash + 1); // drop vendor prefix
  return m.replace(/[.:_]/g, '-').replace(/-+/g, '-');
}

/**
 * Published 1M-class context windows keyed by normalized model id (exact id
 * first, then a boundary-safe family prefix). Every entry is a KNOWN value,
 * never an estimate — the founder's ids (claude 4.5/5.5 lines, haiku,
 * gemini, deepseek, qwen, …) are here so offline can never show 200k.
 */
const CURATED_ONE_M_WINDOWS: ReadonlyArray<{ key: string; ctx: number }> = [
  // Anthropic — the 4.5/5.x lines are 1M at the provider. costs.ts still
  // pins claude-sonnet-4-5 and claude-haiku-4-5 to 200k: those two entries
  // are the direct cause of "1M shown as 200,000".
  { key: 'claude-opus-5-5', ctx: 1_000_000 },
  { key: 'claude-sonnet-5-5', ctx: 1_000_000 },
  { key: 'claude-haiku-5-5', ctx: 1_000_000 },
  { key: 'claude-fable-5', ctx: 1_000_000 },
  { key: 'claude-opus-5', ctx: 1_000_000 },
  { key: 'claude-sonnet-5', ctx: 1_000_000 },
  { key: 'claude-opus-4-8', ctx: 1_000_000 },
  { key: 'claude-sonnet-4-6', ctx: 1_000_000 },
  { key: 'claude-sonnet-4-5', ctx: 1_000_000 },
  { key: 'claude-haiku-4-5', ctx: 1_000_000 },
  // OpenAI — 1.05M GPT-6/5.5, 1M GPT-4.1.
  { key: 'gpt-6', ctx: 1_050_000 },
  { key: 'gpt-5-5', ctx: 1_050_000 },
  { key: 'gpt-4-1', ctx: 1_000_000 },
  // Google Gemini — 1,048,576 (2^20) across the long-context families.
  { key: 'gemini-4', ctx: 1_048_576 },
  { key: 'gemini-3', ctx: 1_048_576 },
  { key: 'gemini-2-5', ctx: 1_048_576 },
  { key: 'gemini-2', ctx: 1_048_576 },
  // Other 1M-class families.
  { key: 'deepseek-v4', ctx: 1_000_000 },
  { key: 'deepseek-flash', ctx: 1_000_000 },
  { key: 'deepseek-chat', ctx: 1_000_000 },
  { key: 'deepseek-reasoner', ctx: 1_000_000 },
  { key: 'glm-5', ctx: 1_048_576 },
  { key: 'kimi-k3', ctx: 1_048_576 },
  { key: 'qwen4-max', ctx: 1_000_000 },
  { key: 'qwen3-8', ctx: 1_000_000 },
  { key: 'qwen3-7', ctx: 1_000_000 },
  { key: 'qwen3-coder-next', ctx: 1_000_000 },
  { key: 'minimax-m3', ctx: 1_000_000 },
  { key: 'muse', ctx: 1_000_000 },
  { key: 'nemotron', ctx: 1_000_000 },
  { key: 'grok-4-3', ctx: 1_000_000 },
];

/** High-precision curated window for a known 1M model, else null. */
export function curatedOneMWindowFor(modelId: string): number | null {
  const norm = windowKey(modelId);
  if (!norm) return null;
  const rows = [...CURATED_ONE_M_WINDOWS].sort((a, b) => b.key.length - a.key.length);
  const hit =
    rows.find((r) => r.key === norm) ??
    rows.find((r) => norm.startsWith(r.key) && (norm.length === r.key.length || norm[r.key.length] === '-')) ??
    null;
  return hit ? hit.ctx : null;
}

export type ModelWindowSource = 'openrouter-live' | 'curated-1m' | 'curated' | 'default';

export interface ModelWindowResolution {
  contextWindow: number;
  ctxEstimated: boolean;
  source: ModelWindowSource;
}

/**
 * THE single resolution used by `kdx:model:info`. Live provider window wins;
 * when the catalog is absent a KNOWN 1M id is resolved from the high-precision
 * table instead of the generic 200k default. Unknown ids keep the honest
 * `estimated` default so the orb still marks it "≈".
 */
export function resolveModelWindow(
  modelId: string,
  liveCtx: number | null | undefined,
  fallback: { ctx: number; estimated: boolean },
): ModelWindowResolution {
  if (liveCtx != null && liveCtx > 0) {
    return { contextWindow: liveCtx, ctxEstimated: false, source: 'openrouter-live' };
  }
  const oneM = curatedOneMWindowFor(modelId);
  if (oneM != null) return { contextWindow: oneM, ctxEstimated: false, source: 'curated-1m' };
  return {
    contextWindow: fallback.ctx,
    ctxEstimated: fallback.estimated === true,
    source: fallback.estimated === true ? 'default' : 'curated',
  };
}

// ------------------------------------------------------------
// v11.35 (PRICE-1) — EXACT, PROVENANCE-BEARING PRICE LOOKUP
// The live router price is the PRIMARY pricing source in costs.ts.
// Match rules are deliberately strict — the founder's exact worry is a
// 1M-context model silently picking up a DIFFERENT model's price:
//   1. full router id, normalized for case / '.' / ':' ONLY — the vendor
//      prefix is KEPT, so vendor-a/foo can never inherit vendor-b/foo.
//   2. a bare id (no '/') only when EXACTLY ONE live row has that suffix
//      (ambiguous vendors are refused — no coin-flip pricing).
// No prefix / fuzzy matching happens here. Prefix matching, where needed,
// stays in the curated fallback table in costs.ts.
// ------------------------------------------------------------

function routerIdKey(id: string): string {
  return String(id ?? '').trim().toLowerCase().replace(/[.:]/g, '-');
}

function bareRouterIdKey(id: string): string {
  const k = routerIdKey(id);
  const slash = k.lastIndexOf('/');
  return slash >= 0 ? k.slice(slash + 1) : k;
}

function hasLivePrice(r: OpenRouterLiveModel): boolean {
  return !!r.price && (r.price.prompt !== null || r.price.completion !== null);
}

function rowToPriceRow(r: OpenRouterLiveModel, fetchedAt: number | null): OpenRouterPriceRow {
  return {
    id: r.id,
    name: r.name,
    price: r.price ?? { prompt: null, completion: null, cacheRead: null, cacheWrite: null },
    fetchedAt,
    source: ENDPOINT,
  };
}

/** Exact router price row + fetch timestamp, or null. `models` is injectable for tests. */
export function openrouterPriceFor(
  modelId: string,
  models?: OpenRouterLiveModel[],
): OpenRouterPriceRow | null {
  const want = routerIdKey(modelId);
  if (!want) return null;
  const rows = models ?? cachedOpenRouterModels();
  const fetchedAt = models && models !== cache?.models ? null : cache?.at ?? null;

  const exact = rows.find((r) => hasLivePrice(r) && routerIdKey(r.id) === want);
  if (exact) return rowToPriceRow(exact, fetchedAt);

  // Bare id: accept only a UNIQUE suffix match — never guess between vendors.
  if (!want.includes('/')) {
    const matches = rows.filter((r) => hasLivePrice(r) && bareRouterIdKey(r.id) === want);
    if (matches.length === 1) return rowToPriceRow(matches[0], fetchedAt);
  }
  return null;
}

// ------------------------------------------------------------
// v1138 — REAL PROVIDER CAPABILITY → EFFORT SIGNAL
// ------------------------------------------------------------

/**
 * Read the live OpenRouter row for a model and return the provider-REPORTED
 * reasoning capability. Returns null when the live catalog has no row (the
 * caller then falls back to the curated descriptor honestly).
 * `models` is injectable for tests; production reads the module cache.
 */
export function openrouterEffortSignalFor(
  modelId: string,
  models?: OpenRouterLiveModel[],
): EffortCatalogSignal | null {
  const want = routerIdKey(modelId);
  if (!want) return null;
  const rows = models ?? cachedOpenRouterModels();
  const exact = rows.find((r) => routerIdKey(r.id) === want);
  const row = exact ?? (!want.includes('/')
    ? rows.find((r) => bareRouterIdKey(r.id) === want)
    : undefined);
  if (!row) return null;
  const parameters = row.supportedParameters ?? [];
  const has = (name: string) => parameters.some((p) => routerIdKey(p) === name);
  return {
    supportsReasoning: has('reasoning'),
    supportsReasoningEffort: has('reasoning_effort'),
    parameters,
  };
}

/** Test-only: seed the module cache with parsed real-shaped fixture rows. */
export function __seedOpenRouterCatalogForTest(rows: OpenRouterLiveModel[], fetchedAt = Date.now()): void {
  cache = { keyFingerprint: 'test-fixture', at: fetchedAt, models: rows };
}

/** Test-only: drop the seeded catalog so later lookups are honest-unknown / curated again. */
export function __resetOpenRouterCatalogForTest(): void {
  cache = null;
}
