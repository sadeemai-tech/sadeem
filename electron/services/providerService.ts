// ============================================================
// Surnia — provider connectivity + LIVE MODEL DISCOVERY
// listModels() probes each provider's models endpoint and returns
// the FULL live model list (newest first) so the user can pick any
// model their key can actually use — no hardcoded lists.
// verify() is a thin wrapper kept for the Settings "Verify" button.
//
// v11.31 audit: robust parsing (junk rows / numeric ids never abort the
// whole fetch), version-aware endpoint building (no /v1/v1), custom
// endpoint protocol fallback, credential redaction in every surfaced
// error, honest field-level key validation, and per-provider env-key
// resolution so a key is NEVER sent to the wrong provider.
// ============================================================
import type { ProviderId } from '../../shared/types';
import { openrouterLiveModels } from './openrouterCatalog';

interface ProviderPreset {
  baseUrl: string;
  protocol: 'anthropic' | 'openai';
  keyless?: boolean;
}

/** Base URLs are the SAME as the renderer's PROVIDER_PRESETS (src/store.ts). */
const PRESETS: Record<ProviderId, ProviderPreset> = {
  anthropic: { baseUrl: 'https://api.anthropic.com', protocol: 'anthropic' },
  openai: { baseUrl: 'https://api.openai.com/v1', protocol: 'openai' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', protocol: 'openai' },
  ollama: { baseUrl: 'http://localhost:11434/v1', protocol: 'openai', keyless: true },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', protocol: 'openai' },
  zai: { baseUrl: 'https://api.z.ai/api/paas/v4', protocol: 'openai' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai' },
  xai: { baseUrl: 'https://api.x.ai/v1', protocol: 'openai' },
  moonshot: { baseUrl: 'https://api.moonshot.ai/v1', protocol: 'openai' },
  qwen: { baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', protocol: 'openai' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', protocol: 'openai' },
  // Custom has NO default base — an explicit endpoint is required, and a
  // generic OPENAI_API_KEY is deliberately never borrowed for it.
  custom: { baseUrl: '', protocol: 'openai' },
};

/** Env var that belongs to a provider. Missing ⇒ there is NO safe env fallback. */
const ENV_KEYS: Partial<Record<ProviderId, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  gemini: 'GEMINI_API_KEY',
  zai: 'ZAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  xai: 'XAI_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  qwen: 'QWEN_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  // ollama is keyless; custom must be configured explicitly in Settings.
};

/** Provider-specific env var name (never a cross-provider fallback). */
export function providerEnvKey(id: ProviderId): string | undefined {
  return ENV_KEYS[id];
}

/** True only for presets that genuinely need no credential (local Ollama). */
export function isKeylessProvider(id: ProviderId): boolean {
  return PRESETS[id]?.keyless === true;
}

export interface VerifyOptions {
  apiKey?: string;
  baseUrl?: string;
}

/** One model as reported by the provider. */
export interface ModelInfo {
  id: string;
  label?: string;
  context?: number;
  created?: number; // unix seconds when the provider reports it
}

export interface ListResult {
  ok: boolean;
  models: ModelInfo[];
  error?: string;
}

export interface VerifyResult {
  ok: boolean;
  models?: string[];
  error?: string;
}

const FETCH_TIMEOUT_MS = 10_000;
/** Storage sanity cap: providers like OpenRouter list 300+ models. */
const MODELS_CAP = 500;

/** Obvious non-chat endpoints we hide from a coding-assistant picker. */
const NON_CHAT_RE =
  /(embedding|whisper|tts|dall-e|moderation|babbage|davinci|curie|transcribe|speech|realtime)/i;

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

interface RawModelsResponse {
  data?: Array<Record<string, unknown>>;
  models?: Array<Record<string, unknown>>;
}

/** Coerce the many shapes providers use into a string without throwing. */
function asString(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function asPositiveNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
  const s = asString(v);
  if (s) {
    const n = Number(s);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return undefined;
}

function asCreated(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
  if (typeof v === 'string' && v.trim()) {
    const direct = Number(v.trim());
    if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);
    const parsed = Date.parse(v);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  return undefined;
}

/**
 * Provider payloads are untrusted: a single null row or a numeric id used to
 * throw inside `.trim()` and sink the ENTIRE fetch into a misleading error.
 */
function parseModels(data: RawModelsResponse | null | undefined): ModelInfo[] {
  const rows: Record<string, unknown>[] = Array.isArray(data?.data)
    ? data!.data!
    : Array.isArray(data?.models)
      ? data!.models!
      : [];
  const out: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const id = asString(r.id) || asString(r.name) || asString(r.model);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const labelRaw = asString(r.display_name) || asString(r.displayName);
    const created = asCreated(r.created) ?? asCreated(r.created_at);
    const context =
      asPositiveNumber(r.context_length) ??
      asPositiveNumber(r.context_window) ??
      asPositiveNumber(r.input_token_limit);
    out.push({
      id,
      label: labelRaw && labelRaw !== id ? labelRaw : undefined,
      ...(context !== undefined ? { context } : {}),
      ...(created !== undefined ? { created } : {}),
    });
  }
  return out;
}

/** Sort newest-first when the provider gives timestamps; otherwise keep API order. */
function sortNewestFirst(models: ModelInfo[]): ModelInfo[] {
  if (!models.some((m) => typeof m.created === 'number')) return models;
  return [...models].sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
}

function cleanBase(raw: string): string {
  return raw.replace(/\/+$/, '');
}

/** v12 — resolve a provider's base URL (explicit override wins, then preset). */
export function providerBaseUrl(id: ProviderId, override?: string): string {
  return cleanBase((override ?? '').trim() || PRESETS[id]?.baseUrl || '');
}

/**
 * A bare host (`http://127.0.0.1:1234`) is NOT a complete OpenAI-compatible
 * base — the chat route lives under /v1. Presets and explicit endpoints that
 * already carry a version path are left untouched (no /v1/v1 duplication).
 */
function withVersionBase(clean: string): string {
  try {
    const u = new URL(clean);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return clean;
    if (!u.pathname || u.pathname === '/') return cleanBase(clean + '/v1');
  } catch {
    /* not a parseable URL — pass through rather than guess */
  }
  return clean;
}

const VERSION_PATH_RE = /\/v\d+(?:[a-z-]+)?(?:\/[^/]+)?$/i;

function anthropicModelsUrl(clean: string): string {
  const base = withVersionBase(clean);
  return `${VERSION_PATH_RE.test(base) ? base : `${base}/v1`}/models?limit=1000`;
}

function openaiModelsUrl(clean: string): string {
  return `${withVersionBase(clean)}/models`;
}

function ollamaTagsUrl(clean: string): string {
  return `${clean.replace(/\/v1\/?$/, '')}/api/tags`;
}

/**
 * Remove credentials from anything that can reach a log, a toast or
 * settings.warning. Provider error bodies sometimes echo the request
 * headers; settings never display a raw key.
 */
export function redactSecrets(text: unknown, ...secrets: Array<string | undefined>): string {
  let out = String(text ?? '');
  for (const s of secrets) {
    const v = (s ?? '').trim();
    if (v.length >= 4) out = out.split(v).join('[REDACTED]');
  }
  out = out.replace(/(Bearer\s+)[^\s"',}]+/gi, '$1[REDACTED]');
  out = out.replace(/(x-api-key["'\s:=]+)[^\s"',}]+/gi, '$1[REDACTED]');
  return out.replace(/[\r\n\u0000-\u001f]/g, ' ').slice(0, 300);
}

async function httpGetModels(
  url: string,
  headers: Record<string, string>,
  secrets: string[] = [],
): Promise<ModelInfo[]> {
  const t = withTimeout(FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: t.signal });
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 240);
      throw new Error(`HTTP ${res.status}${body ? ` — ${body}` : ''}`);
    }
    const json = (await res.json().catch(() => null)) as RawModelsResponse | null;
    return parseModels(json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const safe = redactSecrets(msg, ...secrets);
    throw new Error(safe.includes('abort') ? 'TIMEOUT' : safe);
  } finally {
    t.done();
  }
}

/** Ollama uses its own /api/tags route (names like "qwen2.5-coder:7b"). */
async function listOllama(base: string): Promise<ModelInfo[]> {
  const rows = await httpGetModels(ollamaTagsUrl(base), {});
  return rows.map((r) => ({ id: r.id, ...(r.label ? { label: r.label } : {}) }));
}

export async function listModels(provider: string, opts: VerifyOptions): Promise<ListResult> {
  const id = String(provider ?? '').trim().toLowerCase() as ProviderId;
  const preset = PRESETS[id];
  if (!preset) return { ok: false, models: [], error: `UNKNOWN_PROVIDER: ${provider}` };

  const base = (opts?.baseUrl ?? '').trim() || preset.baseUrl;
  if (!base) return { ok: false, models: [], error: 'NO_BASE_URL' };
  const clean = cleanBase(base);
  const apiKey = (opts?.apiKey ?? '').trim();

  try {
    let models: ModelInfo[] = [];

    if (id === 'ollama') {
      models = await listOllama(clean);
    } else if (preset.protocol === 'anthropic') {
      // Anthropic native: GET /v1/models?limit=… → { data: [{id, display_name, created_at}] }
      models = await httpGetModels(
        anthropicModelsUrl(clean),
        { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        [apiKey],
      );
    } else {
      // OpenAI-compatible: GET {base}/models → { data: [{id, created?, …}] }
      const headers: Record<string, string> = {};
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      models = await httpGetModels(openaiModelsUrl(clean), headers, [apiKey]);
    }

    if (id === 'openai') {
      models = models.filter((m) => !NON_CHAT_RE.test(m.id));
    }

    models = sortNewestFirst(models).slice(0, MODELS_CAP);
    return { ok: true, models };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Custom provider: the endpoint may speak either wire protocol. Try the
    // Anthropic listing once when the OpenAI-compatible probe fails — including
    // 404/405/500, not just "HTTP 4", since gateways disagree on status codes.
    if (id === 'custom') {
      try {
        const models = sortNewestFirst(
          await httpGetModels(
            anthropicModelsUrl(clean),
            { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
            [apiKey],
          ),
        ).slice(0, MODELS_CAP);
        if (models.length) return { ok: true, models };
      } catch {
        /* fall through to the original error */
      }
    }
    return { ok: false, models: [], error: redactSecrets(msg, apiKey) };
  }
}

/** Settings "Verify" button — booleans + flat id list (back-compatible shape). */
export async function verify(provider: string, opts: VerifyOptions): Promise<VerifyResult> {
  const res = await listModels(provider, opts);
  return {
    ok: res.ok,
    models: res.models.map((m) => m.id),
    error: res.error,
  };
}

// ============================================================
// v11.10 (A8) — PROVIDER ENABLE: validation + default-model policy.
// Founder bug: "I add an OpenRouter provider and enable it, settings
// says 'no model configured' even though it's set up." Root cause:
// enable/save never looked at the provider entry — a provider with a
// working key but no *active* model id tripped the runtime
// "No model configured" guards (agent/engine.ts run start, aiService
// one-shots). Fix contract:
//   • the ONLY enable blockers are missing credentials, reported as
//     FIELD errors (apiKey / baseUrl) — never a global failure;
//   • enabling auto-fetches the live model list; a catalog fetch
//     failure is an honest per-provider WARNING and the provider is
//     still saved (curated presets remain the fallback);
//   • if no usable model is selected, we auto-adopt a sensible
//     default picked from the fetched catalog (never a blind
//     hardcoded id).
// ============================================================

export interface ProviderFieldErrors {
  apiKey?: string;
  baseUrl?: string;
}

export interface ProviderEnableRequest {
  apiKey?: string;
  baseUrl?: string;
  /** The renderer's current active model config, so enable can decide
   *  whether the fetched default should be adopted. hasKey mirrors
   *  whether the ACTIVE provider's entry has a stored key. */
  active?: { provider: string; model: string; hasKey?: boolean };
  /** Curated fallback ids from the renderer's PROVIDER_PRESETS — used ONLY
   *  when every live fetch fails, so the honest warning still ships with a
   *  sensible default. Never invented here; passed through verbatim. */
  curatedModels?: string[];
  /** Explicit model-list refresh (Settings "Refresh models") — bypasses the
   *  10-minute live-catalog TTL. Provider enable forces a fresh fetch by
   *  default; pass `false` to reuse a warm cache. */
  refresh?: boolean;
}

export interface ProviderEnableResult {
  ok: boolean;
  /** Model ids available after enable (live when reachable, curated otherwise). */
  models: string[];
  /** Sensible default picked from `models` (see pickDefaultModel). */
  defaultModel?: string;
  /** true ⇒ the caller should point settings.model at {id, defaultModel}. */
  adopt: boolean;
  /** Honest per-provider warning (catalog unreachable etc.) — NOT a failure. */
  warning?: string;
  /** Field-level blockers (missing key / missing base URL). */
  fieldErrors?: ProviderFieldErrors;
  /** Global error — reserved for unknown providers only. */
  error?: string;
}

/**
 * Default-model policy. `models` is the freshest list we have (live catalog
 * newest-first, else the curated presets). OpenRouter prefers a FREE model
 * from a well-known vendor (exact ids come from the catalog — never blindly
 * hardcoded); every other provider takes the newest first row.
 * `freeIds` carries the router's pricing flags so a genuinely free model
 * without a `:free` suffix is not missed (and a priced `:free`-looking id
 * is not mislabeled free).
 */
const WELL_KNOWN_VENDORS = ['deepseek', 'z-ai', 'qwen', 'moonshot', 'meta-llama', 'google', 'mistral'] as const;

export function pickDefaultModel(
  provider: string,
  models: string[],
  opts?: { freeIds?: ReadonlySet<string> },
): string | undefined {
  const list = (models ?? []).map((m) => String(m ?? '').trim()).filter(Boolean);
  if (!list.length) return undefined;
  if (provider !== 'openrouter') return list[0];
  // When the catalog supplied pricing flags, trust them exclusively — a
  // `:free`-looking id with a non-zero price must not be labeled free.
  const isFree = (id: string): boolean =>
    opts?.freeIds ? opts.freeIds.has(id) : id.toLowerCase().endsWith(':free');
  const vendorOf = (id: string): string => id.split('/')[0]?.toLowerCase() ?? '';
  const free = list.filter(isFree);
  for (const v of WELL_KNOWN_VENDORS) {
    const hit = free.find((m) => vendorOf(m) === v);
    if (hit) return hit;
  }
  if (free.length) return free[0];
  for (const v of WELL_KNOWN_VENDORS) {
    const hit = list.find((m) => vendorOf(m) === v);
    if (hit) return hit;
  }
  return list[0];
}

/**
 * Reject obvious placeholders and CRLF/control characters (header injection)
 * WITHOUT imposing arbitrary length rules on real, varied provider keys.
 */
const PLACEHOLDER_KEY_RE =
  /^(?:sk-)?(?:x{3,}|your[_-]?api[_-]?key|change[_-]?me|changeme|replace[_-]?me|placeholder|test[_-]?key|none|null|todo|tbd)$/i;

function plausibleKey(key: string): boolean {
  return !/[\r\n\u0000-\u001f\u007f]/.test(key) && !PLACEHOLDER_KEY_RE.test(key);
}

/**
 * Pure field validation — the ONLY enable blockers. Everything else
 * (catalog reachability, model choice) must not block a save.
 */
export function validateProviderEnable(
  provider: string,
  req: ProviderEnableRequest,
  preset?: { keyless?: boolean },
): { ok: boolean; fieldErrors?: ProviderFieldErrors; error?: string } {
  if (!preset) return { ok: false, error: `UNKNOWN_PROVIDER: ${provider}` };
  const fieldErrors: ProviderFieldErrors = {};
  const key = (req.apiKey ?? '').trim();
  const base = (req.baseUrl ?? '').trim();

  if (!preset.keyless && provider !== 'custom') {
    if (!key) fieldErrors.apiKey = 'MISSING_KEY';
    else if (!plausibleKey(key)) fieldErrors.apiKey = 'INVALID_KEY';
  }
  if (provider === 'custom') {
    if (!base) fieldErrors.baseUrl = 'MISSING_BASE_URL';
    if (key && !plausibleKey(key)) fieldErrors.apiKey = 'INVALID_KEY';
  }
  const hasErrors = Object.keys(fieldErrors).length > 0;
  return hasErrors ? { ok: false, fieldErrors } : { ok: true };
}

/** Adoption rule: adopt the fetched default only when the current active
 *  model is unusable — empty id, or this provider is active with an id the
 *  catalog doesn't list, or the active provider has no key at all. */
export function shouldAdoptDefault(
  provider: string,
  models: string[],
  active?: ProviderEnableRequest['active'],
): boolean {
  if (!active) return true;
  const model = (active.model ?? '').trim();
  if (!model) return true;
  if (active.provider === provider) return models.length > 0 && !models.includes(model);
  return active.hasKey === false;
}

/**
 * Enable a provider: validate credentials (field-level), auto-fetch the
 * live model list, pick a default, decide adoption. NEVER throws; a
 * catalog fetch failure returns ok:true + honest warning + curated models.
 */
export async function enableProvider(
  provider: string,
  req: ProviderEnableRequest = {},
): Promise<ProviderEnableResult> {
  const id = String(provider ?? '').trim().toLowerCase() as ProviderId;
  const preset = PRESETS[id];
  const gate = validateProviderEnable(id, req, preset);
  if (!gate.ok) {
    return {
      ok: false,
      models: [],
      adopt: false,
      ...(gate.fieldErrors ? { fieldErrors: gate.fieldErrors } : {}),
      ...(gate.error ? { error: gate.error } : {}),
    };
  }

  const apiKey = (req.apiKey ?? '').trim();
  const baseUrl = (req.baseUrl ?? '').trim() || preset!.baseUrl;
  let models: string[] = [];
  let freeIds: Set<string> | undefined;
  let warning: string | undefined;

  if (id === 'openrouter') {
    // Rich catalog first (free/pricing flags drive the default-model policy).
    // An explicit enable is a user action — fetch fresh unless told otherwise.
    const live = await openrouterLiveModels(apiKey, { force: req.refresh !== false });
    if (live.length) {
      models = live.map((m) => m.id);
      freeIds = new Set(live.filter((m) => m.free).map((m) => m.id));
    }
  }
  if (!models.length) {
    // OpenAI-compatible / anthropic listing (also the OpenRouter fallback).
    const res = await listModels(id, { apiKey, baseUrl: baseUrl || undefined });
    if (res.ok && res.models.length) {
      models = res.models.map((m) => m.id);
      if (id === 'openrouter') {
        warning = 'LIVE_CATALOG_UNAVAILABLE: the live OpenRouter catalog was unreachable — showing the listed models only.';
      }
    } else {
      // Honest per-provider warning — the provider IS saved, the picker
      // keeps the curated presets until a fetch succeeds.
      warning = `MODEL_LIST_UNAVAILABLE: ${res.error ?? 'no models returned'}`;
    }
  }
  if (!models.length) {
    // curated fallback passed BY THE CALLER (store PROVIDER_PRESETS) —
    // providerService never hardcodes model ids.
    models = (req.curatedModels ?? []).filter((m) => typeof m === 'string' && m.trim());
  }

  const defaultModel = pickDefaultModel(id, models, freeIds ? { freeIds } : undefined);
  const adopt = shouldAdoptDefault(id, models, req.active);

  return {
    ok: true,
    models,
    adopt,
    ...(defaultModel ? { defaultModel } : {}),
    ...(warning ? { warning: redactSecrets(warning, apiKey) } : {}),
  };
}
