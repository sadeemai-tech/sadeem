// ============================================================
// Surnia — provider streaming layer
// Research-verified wire protocols:
//  • Anthropic     : POST {base}/v1/messages          (SSE)
//  • OpenAI-compat : POST {base}/chat/completions     (SSE)
//    (openai, openrouter, ollama, gemini, zai, deepseek, custom)
// Both normalize into ProviderMsg and emit incremental callbacks.
// Usage: Anthropic cache reads are billed at 10% of input and
// cache writes at 125% (real rates — see costs.ts); the cache
// split rides on the Usage payload as runtime-only fields.
// ============================================================
import type { ModelConfig, ProviderId, Usage } from '../../shared/types';
import {
  effortLevelsFor,
  effortWireFor,
  normalizeEffortLevel,
  thinkingBudgetFor,
  type EffortDescriptor,
} from '../../shared/effort';
import { openrouterEffortSignalFor } from '../services/openrouterCatalog';
import { estimateCostDetailed } from './costs';
// v11.31 (SECRETS) — provider error bodies and undici network errors can embed
// a credential (`Bearer sk-…`, `?api_key=…`, `x-api-key: …`). Reuse the app's
// canonical redaction rule set so no key can reach sys_notice / an error row.
import { redactSecrets } from './risk';

// ---------- public types ----------

/**
 * v11.35 — PROVIDER-NATIVE TOOL DESCRIPTOR.
 *
 * A tool that the MODEL PROVIDER executes itself (OpenAI `web_search` /
 * `code_interpreter` / `computer_use_preview`, Anthropic server-side
 * `web_search_20250305` / `code_execution_20250825` / `computer_20250124`,
 * OpenRouter provider plugins). These are NOT ordinary app functions: sending
 * them as `{type:'function', function:{...}}` makes the provider reject them
 * or turn them into a model-side stub that is never really executed. They must
 * be forwarded in their NATIVE wire shape.
 *
 * `type` is the canonical, provider-neutral name (e.g. 'web_search').
 * `provider` restricts which wire families receive it ('all' = every family).
 * `wire` carries optional per-family overrides (display size, max_uses, ...).
 * Unknown canonical types are passed through verbatim — never guessed away.
 */
export type NativeToolFamily = 'openai' | 'anthropic' | 'openrouter' | 'all';

export interface NativeToolSpec {
  /** Canonical provider-neutral native type, e.g. 'web_search'. */
  type: string;
  /** Which provider families understand this descriptor. Default 'all'. */
  provider?: NativeToolFamily;
  /** Optional per-family extra fields merged into the native tool object. */
  wire?: {
    openai?: Record<string, unknown>;
    anthropic?: Record<string, unknown>;
    openrouter?: Record<string, unknown>;
  };
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  kind: 'fs' | 'exec' | 'meta' | 'mcp';
  /** MCP-only: originating server name (def name is mcp__<server>__<tool>). */
  mcpServerName?: string;
  /** MCP-only: original tool name on the server. */
  mcpToolName?: string;
  /**
   * v11.35 — when present, forward this tool with the PROVIDER'S NATIVE schema
   * instead of downgrading it to a generic function tool. See NativeToolSpec.
   */
  native?: NativeToolSpec;
  /**
   * v11.35 — true when this def was advertised by the provider (or discovered
   * at runtime) and the app has NO local executor for it. Such a call is routed
   * HONESTLY (native/server-side result relayed, or an explicit unsupported
   * message) — it is never silently dropped.
   */
  passthrough?: boolean;
  /** v11.35 — which provider/server advertised a pass-through tool. */
  providerSource?: string;
}

export type ProviderMsg =
  | { role: 'user'; text: string; images?: string[] }
  | {
      role: 'assistant';
      text?: string;
      toolCalls?: { id: string; name: string; args: string }[];
      /** Extended-thinking trace produced alongside tool_use — resent on the tool loop (Anthropic requirement). */
      thinking?: string;
      /** Anthropic thinking-block signature (required by the API when resending thinking). */
      thinkingSignature?: string;
    }
  | { role: 'tool_result'; callId: string; content: string; isError?: boolean; images?: string[] };

export interface StreamArgs {
  model: ModelConfig;
  apiKey?: string;
  baseUrl?: string;
  system: string;
  messages: ProviderMsg[];
  tools: ToolDef[];
  signal: AbortSignal;
  onText: (t: string) => void;
  /** Extended-thinking traces: Anthropic `thinking` blocks, DeepSeek/OpenRouter `reasoning_content`. */
  onThinking?: (t: string) => void;
  /** Called with accumulating args; the final call carries the complete JSON. */
  onToolUse: (id: string, name: string, argsJsonPartial: string) => void;
  onUsage?: (u: Usage) => void;
  /**
   * v12 (HEARTBEAT) — called on ANY byte received from the provider stream,
   * including keep-alive comments (`: ping`) and `ping` events that carry no
   * model content. The engine bumps its idle-watchdog activity here so a
   * healthy, keep-alive-warm but silently-reasoning stream is never killed.
   */
  onHeartbeat?: () => void;
  /**
   * Prompt caching (Anthropic + OpenAI-compatible cache_control breakpoints).
   * Default: enabled. A gateway that rejects the field is auto-downgraded and
   * remembered for the session, so no extra 400 round-trip is paid twice.
   */
  promptCaching?: boolean;
  /** Retry attempts for retryable HTTP statuses / network errors. Default 2. */
  maxRetries?: number;
  /**
   * v11.16 (LATENCY) — optional bounded failover chain. When present,
   * `streamTurn` tries the primary (`model`/`apiKey`/`baseUrl`) first, then
   * each entry in order, under a SINGLE wall-clock budget. A 401/invalid key
   * skips its provider immediately; a 429 moves on after one short backoff.
   * Without this field `streamTurn` keeps the legacy single-provider behavior.
   */
  failover?: FailoverTarget[];
  /** Override the failover wall-clock budget (ms) for this turn. */
  failoverBudgetMs?: number;
  /**
   * v11.16 (LATENCY) — honest, user-visible notice when a provider is
   * skipped, rate-limited, retried, or failed over. The engine wires this to
   * its sys_notice channel so the user knows WHY the first token is slow.
   */
  onNotice?: (notice: ProviderNotice) => void;
}

/** One additional provider/model to try when the primary fails. */
export interface FailoverTarget {
  model: ModelConfig;
  apiKey?: string;
  baseUrl?: string;
}

export type ProviderNoticeKind =
  | 'retry' | 'rate_limited' | 'invalid_key' | 'no_credits' | 'server_error' | 'failover' | 'provider_skip' | 'slow_provider'
  // v11.26 (CONTINUITY) — transparent mid-stream recovery: the connection died
  // after some answer text was already shown. `stream_recovered` is a QUIET
  // "resuming from the last token" notice; `stream_incomplete` is the honest
  // terminal notice when no bounded recovery was possible. Both are plain,
  // single-language, JSON-free text (the renderer translates by kind).
  | 'stream_recovered' | 'stream_incomplete';

export interface ProviderNotice {
  kind: ProviderNoticeKind;
  text: string;
  status?: number;
  provider?: ProviderId;
  model?: string;
}

// v11.9 — 'paused' (Anthropic pause_turn: long-running turn paused server-side,
// the caller must re-request to continue), 'refusal' (Anthropic refusal: the
// model explicitly refused — surfaced as an error, never a normal end) and
// 'content_filter' (OpenAI finish_reason: censored output must not pose as a
// complete reply) are first-class stop reasons now.
export type StopReason = 'tool_use' | 'end_turn' | 'max_tokens' | 'error' | 'paused' | 'refusal' | 'content_filter';

/**
 * v11.9 (E3) — Anthropic stop_reason → normalized StopReason. `pause_turn`
 * used to fall into the catch-all 'end_turn' branch, silently ending a turn
 * mid-work; `refusal` used to look like a normal completion. Pure + exported
 * for unit tests.
 */
export function mapAnthropicStopReason(raw: string): StopReason {
  if (raw === 'tool_use') return 'tool_use';
  if (raw === 'max_tokens') return 'max_tokens';
  if (raw === 'pause_turn') return 'paused';
  if (raw === 'refusal') return 'refusal';
  return 'end_turn';
}

/**
 * v11.9 (E10) — OpenAI finish_reason → normalized StopReason. `content_filter`
 * used to be silently mapped to 'end_turn', presenting censored output as a
 * complete reply. Pure + exported for unit tests.
 */
export function mapOpenAIFinishReason(raw: string): StopReason {
  if (raw === 'tool_calls') return 'tool_use';
  if (raw === 'length') return 'max_tokens';
  if (raw === 'content_filter') return 'content_filter';
  return 'end_turn';
}

export interface StreamResult {
  stopReason: StopReason;
  usage: Usage;
  /** Concatenated extended-thinking trace from this turn (when the model produced one). */
  thinking?: string;
  /** Anthropic thinking-block signature (required to resend the thinking block). */
  thinkingSignature?: string;
}

// ============================================================
// v11.35 — ALL PROVIDER-NATIVE TOOLS (FULL CAPABILITY, NO SILENT DROP)
// ------------------------------------------------------------
// Founder: "أريد أن يكون الذكاء الاصطناعي قادر على استخدام كل الأدوات الخاصة
// به ... يستخدم كل إمكانياته، إحنا نعطيه كل القدرات كل الإمكانيات المتاحة".
//
// Three honest guarantees, implemented here in the provider layer:
//  1. A tool carrying `native` is sent in the PROVIDER'S OWN wire shape
//     (web_search, code_interpreter, computer_use, code_execution, ...),
//     never downgraded to a generic function the provider won't execute.
//  2. A tool the PROVIDER ADVERTISES but the app does not know is registered
//     via registerProviderTool() and forwarded verbatim into the schema — it
//     is never dropped for being "unknown".
//  3. A call to such a tool is routed HONESTLY: relayed to the provider's
//     native result when native, or an explicit unsupported message when no
//     executor exists. No silent drop, no fake "ok".
//
// This ADDS to the 145 core defs and runtime MCP defs — it never removes or
// narrows them. `full` still means all 145 + all runtime tools.
// ============================================================

/** Canonical provider-neutral native tool names we know how to spell per family. */
export const PROVIDER_NATIVE_TOOL_TYPES = [
  'web_search', 'code_interpreter', 'computer_use', 'code_execution',
  'computer', 'image_generation', 'file_search', 'url_context',
] as readonly string[];

/** Canonical type -> OpenAI wire `type` (unknown types pass through unchanged). */
const OPENAI_NATIVE_TYPE: Readonly<Record<string, string>> = {
  web_search: 'web_search',
  code_interpreter: 'code_interpreter',
  computer_use: 'computer_use_preview',
  code_execution: 'code_interpreter',
  computer: 'computer_use_preview',
  image_generation: 'image_generation',
  file_search: 'file_search',
  url_context: 'url_context',
};

/** Canonical type -> Anthropic wire `type` (unknown types pass through unchanged). */
const ANTHROPIC_NATIVE_TYPE: Readonly<Record<string, string>> = {
  web_search: 'web_search_20250305',
  code_interpreter: 'code_execution_20250825',
  code_execution: 'code_execution_20250825',
  computer_use: 'computer_20250124',
  computer: 'computer_20250124',
  image_generation: 'image_generation_20251119',
  file_search: 'file_search_20260209',
  url_context: 'url_context_20250812',
};

/** True when `def` must be forwarded with a provider-native schema. */
export function isNativeTool(def: ToolDef): boolean {
  return !!def.native && typeof def.native.type === 'string' && def.native.type.length > 0;
}

/** Build a native-capable ToolDef (used for provider-advertised native tools). */
export function makeNativeToolDef(
  name: string,
  type: string,
  opts: { provider?: NativeToolFamily; description?: string; wire?: NativeToolSpec['wire']; parameters?: Record<string, unknown>; providerSource?: string } = {},
): ToolDef {
  return {
    name,
    description: opts.description || `Provider-native tool '${type}' (executed by the model provider).`,
    parameters: opts.parameters ?? { type: 'object', properties: {}, additionalProperties: true },
    kind: 'meta',
    native: { type, provider: opts.provider ?? 'all', wire: opts.wire },
    passthrough: true,
    providerSource: opts.providerSource,
  };
}

/** Resolve a canonical family against the concrete provider used this turn. */
function familyFor(spec: NativeToolSpec, provider: ProviderId): 'openai' | 'anthropic' | 'openrouter' | null {
  const configured = spec.provider ?? 'all';
  if (configured === 'all') return provider === 'anthropic' ? 'anthropic' : provider === 'openrouter' ? 'openrouter' : 'openai';
  if (configured === provider) return configured;
  // Honest compatibility: an 'openai' descriptor also fits OpenAI-compatible
  // gateways (ollama/gemini/zai/deepseek/custom/xai/moonshot/qwen/mistral).
  if (configured === 'openai' && provider !== 'anthropic' && provider !== 'openrouter') return 'openai';
  return null;
}

/** Render a native def into OpenAI-compatible `{type:'…'}` tool shape, or null. */
export function toOpenAINativeTool(def: ToolDef, provider: ProviderId): Record<string, unknown> | null {
  if (!isNativeTool(def)) return null;
  const spec = def.native as NativeToolSpec;
  const family = familyFor(spec, provider);
  if (!family) return null;
  const canonical = spec.type;
  const type = family === 'anthropic'
    ? (ANTHROPIC_NATIVE_TYPE[canonical] ?? canonical)
    : (OPENAI_NATIVE_TYPE[canonical] ?? canonical);
  const extra = family === 'openrouter'
    ? { ...(spec.wire?.openai ?? {}), ...(spec.wire?.openrouter ?? {}) }
    : (spec.wire?.openai ?? {});
  return { type, ...extra };
}

/** Render a native def into Anthropic server-side tool shape, or null. */
export function toAnthropicNativeTool(def: ToolDef): Record<string, unknown> | null {
  if (!isNativeTool(def)) return null;
  const spec = def.native as NativeToolSpec;
  if (spec.provider && spec.provider !== 'anthropic' && spec.provider !== 'all') return null;
  const canonical = spec.type;
  return {
    type: ANTHROPIC_NATIVE_TYPE[canonical] ?? canonical,
    name: def.name,
    ...(spec.wire?.anthropic ?? {}),
  };
}

/**
 * Dynamic registry of provider-advertised / unknown tools. The provider can
 * tell the app "I also support tool X" (capability discovery, MCP-style list,
 * an OpenRouter plugin, a gateway-specific tool). We KEEP it and forward it —
 * an unrecognised tool is never a reason to drop capability.
 */
const providerToolRegistry = new Map<string, ToolDef>();

/** Register/replace a provider-advertised tool so it is advertised & routed. */
export function registerProviderTool(def: ToolDef): ToolDef {
  providerToolRegistry.set(def.name, def);
  return def;
}

/** Register a plain (non-native) tool the provider advertised but we don't execute. */
export function registerUnknownProviderTool(
  name: string,
  provider: ProviderId | string,
  description?: string,
  parameters?: Record<string, unknown>,
  nativeType?: string,
): ToolDef {
  const def: ToolDef = nativeType
    ? makeNativeToolDef(name, nativeType, { description, parameters, providerSource: String(provider) })
    : {
        name,
        description: description || `Provider-advertised tool '${name}' (${provider}).`,
        parameters: parameters ?? { type: 'object', properties: {}, additionalProperties: true },
        kind: 'meta',
        passthrough: true,
        providerSource: String(provider),
      };
  return registerProviderTool(def);
}

export function getProviderToolDefs(): ToolDef[] {
  return [...providerToolRegistry.values()];
}

export function hasProviderTool(name: string): boolean {
  return providerToolRegistry.has(name);
}

export function clearProviderTools(): void {
  providerToolRegistry.clear();
}

export interface ProviderToolCallResult {
  ok: boolean;
  output: string;
  /** true when the provider executes the tool server-side and returns the result. */
  native?: boolean;
  /** true when we had to report an honest "unsupported" outcome. */
  unsupported?: boolean;
}

/**
 * Honest routing for a provider-native / unknown tool call. The provider
 * normally executes native tools itself and relays the result into the model's
 * context, so the app has nothing to do — but IF this is invoked (e.g. a model
 * emitted the native tool as a plain function call), we never pretend success
 * and never drop it silently: we return a clear, actionable message.
 */
export function routeProviderToolCall(name: string, argsJson = '{}'): ProviderToolCallResult {
  const def = providerToolRegistry.get(name);
  if (!def) {
    return { ok: false, unsupported: true, output: `Unknown tool: ${name}. No local executor and no provider advertisement is registered for this name.` };
  }
  if (isNativeTool(def)) {
    let args = '';
    try { args = JSON.stringify(JSON.parse(argsJson || '{}')).slice(0, 400); } catch { args = String(argsJson).slice(0, 400); }
    return {
      ok: false,
      native: true,
      unsupported: true,
      output: `Provider-native tool '${name}' (${(def.native as NativeToolSpec).type}) is executed by the model provider, not locally. Arguments relayed: ${args}. The provider returns its own result; no local action was faked.`,
    };
  }
  return {
    ok: false,
    unsupported: true,
    output: `Unsupported provider tool '${name}'${def.providerSource ? ` (advertised by ${def.providerSource})` : ''}: no local executor is available. The tool was advertised and routed honestly — it was NOT silently dropped. Extend the registry with a real executor to enable local execution.`,
  };
}

// ---------- defaults & shared helpers ----------

// OpenAI-compatible bases include the versioned path; '/chat/completions'
// is appended at request time. Bare origins get '/v1' appended defensively.
const DEFAULT_BASE_URLS: Record<ProviderId, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://localhost:11434/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  zai: 'https://api.z.ai/api/paas/v4',
  deepseek: 'https://api.deepseek.com/v1',
  xai: 'https://api.x.ai/v1',
  moonshot: 'https://api.moonshot.ai/v1',
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  mistral: 'https://api.mistral.ai/v1',
  custom: 'https://api.openai.com/v1',
};

const TOOL_USE_EMIT_INTERVAL_MS = 300;

// v11.26 (CONTINUITY) — a mid-answer stream drop is resumed by re-sending the
// SAME conversation with an assistant prefix containing only the text/thinking
// already shown, plus a short "continue" instruction. BOUNDED: at most one
// transparent continuation per streamTurn call (the engine's own stream-drop
// auto-continue remains the outer safety net). This is NOT a wall-clock cap:
// a healthy stream — even an hours-long one — is never cut off here.
const MAX_STREAM_CONTINUATIONS = 1;
const STREAM_CONTINUE_HINT =
  'The previous response was interrupted mid-answer. CONTINUE EXACTLY where you left off — same task, same plan, no recap, and do not repeat any text already shown.';

/** Internal-only StreamArgs extension: depth of transparent continuations used. */
interface ContinuableArgs extends StreamArgs {
  __streamContinuations?: number;
  /**
   * v11.27 (429 CONTINUE) — internal cap on IN-PROVIDER 429 retries for ONE
   * streamTurn call. Undefined = use the generous "continue the same task"
   * policy (5-8 attempts, bounded wall-clock budget). The failover orchestrator
   * sets it to 1 so its legacy "one short retry then move on" contract is kept
   * when the caller explicitly supplied a failover chain.
   */
  __maxRateLimitRetries?: number;
}
function continuationDepth(a: StreamArgs): number {
  return (a as ContinuableArgs).__streamContinuations ?? 0;
}
function maxRateLimitRetriesOf(a: StreamArgs): number | undefined {
  return (a as ContinuableArgs).__maxRateLimitRetries;
}

// ============================================================
// Model catalog — November 2026 (compiled 2026-11-05, see
// /ai-model-catalog-2026-11.md). PURE DATA: ids, display names,
// context / max-output windows, list prices (USD per 1M tokens)
// and UI capability flags. Nothing here feeds request building —
// streaming still reads ModelConfig alone. Billing + the context
// meter consume the mirrored tables in ./costs.ts.
//
// Notes:
//  • `ctx` = advertised input window; `maxOut` = advertised max
//    output tokens (omitted where the provider documents none).
//  • Prices are the STANDARD tier. Time-boxed intros are kept in
//    `note` (gemini-4-argon / gemini-3.8-flash), tiered or
//    off-peak regimes in note as well (haiku-5-5 >100K prompt,
//    deepseek off-peak = 50%, xAI ≥200K surcharge).
//  • DeepSeek also exposes an Anthropic-format endpoint at
//    https://api.deepseek.com/anthropic (Moonshot /anthropic,
//    Z.ai /api/anthropic and MiniMax /anthropic are similar).
//    Surnia routes the wire protocol by ProviderId
//    (streamTurn: 'anthropic' → Anthropic SSE, everything else
//    → OpenAI-compat), so surfacing those natively needs a new
//    ProviderId in shared/types.ts — noted here, not wired.
//  • MiniMax + Meta Muse have no ProviderId yet; their entries
//    ride along for pricing parity and are reachable through
//    OpenRouter (minimax/*, meta/muse-*).
// ============================================================

/** ProviderId widened with catalog-only vendors that have no direct wiring yet. */
export type CatalogProvider = ProviderId | 'minimax' | 'meta';

export interface CatalogModel {
  /** Exact API model id (vendor spelling, e.g. "MiniMax-M3.1-Flash"). */
  id: string;
  /** Human display name. */
  name: string;
  /** Advertised input context window (tokens). 0 = unverified. */
  ctx: number;
  /** Advertised max output tokens (omitted when undocumented). */
  maxOut?: number;
  /** USD per 1M input tokens (standard tier). */
  inPerM: number;
  /** USD per 1M output tokens (standard tier). */
  outPerM: number;
  /** Dedicated reasoning/thinking mode (or agentic-coding tuning). */
  reasoning?: boolean;
  /** Accepts image input. */
  vision?: boolean;
  /** Zero-metered cost (free tier). */
  free?: boolean;
  /** Recommended default for coding on this provider. */
  recommended?: boolean;
  /** Pricing/context caveats surfaced as tooltips. */
  note?: string;
}

export interface ProviderCatalog {
  provider: CatalogProvider;
  label: string;
  models: CatalogModel[];
}

export const MODEL_CATALOG: ProviderCatalog[] = [
  {
    provider: 'anthropic',
    label: 'Anthropic',
    models: [
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', ctx: 1_000_000, maxOut: 128_000, inPerM: 4, outPerM: 20, reasoning: true, vision: true, note: 'Agentic coding daily driver; fast mode 2× ($8/$20→$40).' },
      { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', ctx: 1_000_000, maxOut: 128_000, inPerM: 2, outPerM: 10, reasoning: true, vision: true, recommended: true, note: 'High-performance coding/agents sweet spot.' },
      { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', ctx: 1_000_000, maxOut: 128_000, inPerM: 0.1, outPerM: 0.5, vision: true, note: 'Fastest/cheapest; $0.10/$0.50 applies ≤100K prompt, then $0.50/$2.50.' },
      { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', ctx: 1_000_000, maxOut: 128_000, inPerM: 10, outPerM: 50, reasoning: true, vision: true, note: '"Mythos" line for long-running, long-horizon agents.' },
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', ctx: 1_000_000, maxOut: 128_000, inPerM: 5, outPerM: 25, vision: true, note: 'Previous generation, still served.' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', ctx: 1_000_000, maxOut: 128_000, inPerM: 3, outPerM: 15, vision: true, note: 'Previous generation.' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', ctx: 200_000, maxOut: 64_000, inPerM: 1, outPerM: 5, vision: true, note: 'Budget workhorse (200K window).' },
    ],
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    models: [
      { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', ctx: 1_050_000, maxOut: 128_000, inPerM: 2, outPerM: 10, vision: true },
      { id: 'gpt-6.1-sol-pro', name: 'GPT-6.1 Sol Pro', ctx: 1_050_000, maxOut: 128_000, inPerM: 10, outPerM: 50, vision: true },
      { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra', ctx: 1_050_000, maxOut: 128_000, inPerM: 1, outPerM: 5, vision: true, note: 'Latest efficiency line — best $/capability for coding agents.' },
      { id: 'gpt-6.1-terra-pro', name: 'GPT-6.1 Terra Pro', ctx: 1_050_000, maxOut: 128_000, inPerM: 2.5, outPerM: 12, vision: true },
      { id: 'gpt-6-astra', name: 'GPT-6 Astra', ctx: 1_050_000, maxOut: 128_000, inPerM: 10, outPerM: 50, vision: true, note: 'Ultra-flagship tier.' },
      { id: 'gpt-6-luna', name: 'GPT-6 Luna', ctx: 1_050_000, maxOut: 128_000, inPerM: 0.1, outPerM: 0.5, vision: true, note: 'Ultra-cheap high-volume workhorse.' },
      { id: 'gpt-5.5', name: 'GPT-5.5', ctx: 1_050_000, maxOut: 128_000, inPerM: 5, outPerM: 30, vision: true },
      { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', ctx: 400_000, maxOut: 128_000, inPerM: 1.75, outPerM: 14, reasoning: true, recommended: true, note: 'Codex CLI/IDE coding flagship.' },
      { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max', ctx: 400_000, maxOut: 128_000, inPerM: 1.25, outPerM: 10, reasoning: true, note: 'Long-horizon Codex variant.' },
      { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', ctx: 400_000, maxOut: 128_000, inPerM: 0.25, outPerM: 2, reasoning: true, note: 'Cheap codex.' },
      { id: 'o3', name: 'o3', ctx: 200_000, maxOut: 100_000, inPerM: 2, outPerM: 8, reasoning: true, vision: true, note: 'Legacy reasoning line, superseded by 5.x/6.x.' },
    ],
  },
  {
    provider: 'gemini',
    label: 'Google Gemini',
    models: [
      { id: 'gemini-4-argon', name: 'Gemini 4 Argon', ctx: 1_048_576, maxOut: 65_536, inPerM: 4, outPerM: 20, reasoning: true, vision: true, note: 'Flagship reasoning. Intro $2/$10 until 2026-11-30; up to 1M out with long-decode.' },
      { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', ctx: 1_048_576, maxOut: 65_536, inPerM: 1.5, outPerM: 7.5, vision: true, recommended: true, note: 'Most intelligent Flash. Intro $0.75/$3.75 through 2026-12-31.' },
      { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', ctx: 1_048_576, maxOut: 65_536, inPerM: 0.3, outPerM: 2.5, vision: true, note: 'High-throughput cheap tier.' },
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', ctx: 1_048_576, maxOut: 65_536, inPerM: 2, outPerM: 12, reasoning: true, vision: true, note: 'Pro multimodal + vibe-coding; >200K prompt bills $4/$18.' },
    ],
  },
  {
    provider: 'xai',
    label: 'xAI (Grok)',
    models: [
      { id: 'grok-4.7', name: 'Grok 4.7', ctx: 500_000, maxOut: 64_000, inPerM: 2, outPerM: 6, vision: true, note: 'Flagship; prompts ≥200K bill at $4/$12.' },
      { id: 'grok-4.6', name: 'Grok 4.6', ctx: 500_000, maxOut: 64_000, inPerM: 2, outPerM: 6, note: 'Prior stable.' },
      { id: 'grok-4.3', name: 'Grok 4.3', ctx: 1_000_000, maxOut: 64_000, inPerM: 1.25, outPerM: 2.5, note: 'Long-context tier.' },
      { id: 'grok-build-0.1', name: 'Grok Build 0.1', ctx: 256_000, inPerM: 1, outPerM: 2, reasoning: true, recommended: true, note: 'Agentic-coding specialized.' },
    ],
  },
  {
    provider: 'deepseek',
    label: 'DeepSeek',
    models: [
      { id: 'deepseek-flash', name: 'DeepSeek Flash (V4.1-Flash-1017)', ctx: 1_000_000, maxOut: 384_000, inPerM: 0.3, outPerM: 1.2, reasoning: true, vision: true, recommended: true, note: 'Off-peak = half price; cache-hit $0.006 in. deepseek-chat/reasoner route here.' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4-Pro', ctx: 1_000_000, maxOut: 384_000, inPerM: 1.32, outPerM: 3.96, reasoning: true, note: 'Text-only reasoning flagship.' },
    ],
  },
  {
    provider: 'qwen',
    label: 'Qwen (DashScope)',
    models: [
      { id: 'qwen3.8-max', name: 'Qwen3.8-Max', ctx: 1_000_000, maxOut: 131_072, inPerM: 2, outPerM: 6, reasoning: true, vision: true, note: 'Flagship; thinking + non-thinking.' },
      { id: 'qwen3.7-plus', name: 'Qwen3.7-Plus', ctx: 256_000, maxOut: 131_072, inPerM: 0.4, outPerM: 1.6, note: 'Mid-tier workhorse; higher bands beyond 256K.' },
      { id: 'qwen3.8-flash', name: 'Qwen3.8-Flash', ctx: 1_000_000, maxOut: 131_072, inPerM: 0.15, outPerM: 0.47, vision: true, note: 'Cheap fast tier.' },
      { id: 'qwen3-coder-flash', name: 'Qwen3-Coder-Flash', ctx: 256_000, inPerM: 0.3, outPerM: 1.5, reasoning: true, note: 'Agentic coding.' },
      { id: 'qwen3-coder-next', name: 'Qwen3-Coder-Next', ctx: 1_000_000, inPerM: 0.12, outPerM: 0.8, reasoning: true, recommended: true },
    ],
  },
  {
    provider: 'moonshot',
    label: 'Moonshot (Kimi)',
    models: [
      { id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro', ctx: 1_048_576, maxOut: 131_072, inPerM: 2, outPerM: 10, reasoning: true, vision: true, recommended: true, note: 'New flagship; native vision, up to 1M out.' },
      { id: 'kimi-k3', name: 'Kimi K3', ctx: 1_048_576, inPerM: 3, outPerM: 16, reasoning: true, vision: true, note: 'First open-source 3T model; cache-hit input $0.30.' },
      { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', ctx: 262_144, maxOut: 230_000, inPerM: 0.6, outPerM: 3.5, reasoning: true, note: 'Coding-specialized; deprecating end of 2026.' },
    ],
  },
  {
    provider: 'zai',
    label: 'Z.ai (GLM)',
    models: [
      { id: 'glm-5.3', name: 'GLM-5.3', ctx: 1_048_576, maxOut: 128_000, inPerM: 1.4, outPerM: 4.4, reasoning: true, recommended: true, note: 'Reasoning-only flagship; effort low/high/max. Cache read $0.26.' },
      { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', ctx: 1_048_576, inPerM: 0.15, outPerM: 0.5, note: 'Cheap default for Claude-Code-class tools; cache read $0.03.' },
      { id: 'glm-5.3-flashx', name: 'GLM-5.3-FlashX', ctx: 1_048_576, maxOut: 131_072, inPerM: 0.37, outPerM: 1.25, note: 'Faster mid-tier.' },
      { id: 'glm-4.6', name: 'GLM-4.6', ctx: 200_000, maxOut: 128_000, inPerM: 0.6, outPerM: 2.2, note: 'Legacy.' },
      { id: 'glm-4.7-flash', name: 'GLM-4.7-Flash', ctx: 200_000, inPerM: 0, outPerM: 0, free: true },
    ],
  },
  {
    // No direct ProviderId yet (shared/types) — reachable via OpenRouter
    // ("minimax/minimax-m3.1-flash") or a custom OpenAI-compatible entry.
    provider: 'minimax',
    label: 'MiniMax',
    models: [
      { id: 'MiniMax-M3.1-Flash', name: 'MiniMax M3.1 Flash', ctx: 1_000_000, maxOut: 524_288, inPerM: 0.075, outPerM: 0.3, reasoning: true, vision: true, recommended: true, note: 'Frontier multimodal coding; tunable thinking effort (default max).' },
      { id: 'MiniMax-M3', name: 'MiniMax M3', ctx: 1_000_000, maxOut: 512_000, inPerM: 0.3, outPerM: 1.2, reasoning: true, vision: true, note: 'Previous frontier coding model.' },
    ],
  },
  {
    provider: 'mistral',
    label: 'Mistral AI',
    models: [
      { id: 'mistral-large-4-0', name: 'Mistral Large 4', ctx: 1_048_576, inPerM: 0.7, outPerM: 2.1, vision: true, note: 'New flagship, successor to Large 3.' },
      { id: 'mistral-medium-3-5', name: 'Mistral Medium 3.5', ctx: 262_144, inPerM: 1.5, outPerM: 7.5, vision: true, note: 'Best per-cost multimodal.' },
      { id: 'codestral-25-08', name: 'Codestral 25.08', ctx: 256_000, inPerM: 0.3, outPerM: 0.9, note: 'Dedicated code/FIM model.' },
      { id: 'devstral-2512', name: 'Devstral 2', ctx: 256_000, inPerM: 0.4, outPerM: 2, reasoning: true, recommended: true, note: 'Agentic coding (SWE-bench focused).' },
    ],
  },
  {
    // No direct ProviderId yet — Llama API was replaced by the Meta Model
    // API (Muse family); served through OpenRouter ("meta/muse-*").
    provider: 'meta',
    label: 'Meta (Muse)',
    models: [
      { id: 'muse-wonder', name: 'Muse Wonder', ctx: 1_000_000, inPerM: 4, outPerM: 20, vision: true, note: 'Frontier coding, long-running agents, computer use.' },
      { id: 'muse-spark-1.3', name: 'Muse Spark 1.3', ctx: 1_000_000, inPerM: 1.25, outPerM: 4.25, vision: true, note: 'Long-horizon coding & agentic work.' },
      { id: 'muse-glimmer-30b', name: 'Muse Glimmer 30B', ctx: 131_072, inPerM: 0.3, outPerM: 1.2, note: 'Always-on local agents.' },
    ],
  },
  {
    provider: 'openrouter',
    label: 'OpenRouter',
    models: [
      { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', ctx: 1_000_000, inPerM: 2, outPerM: 10, reasoning: true, vision: true },
      { id: 'anthropic/claude-opus-5.5', name: 'Claude Opus 5.5', ctx: 1_000_000, inPerM: 4, outPerM: 20, reasoning: true, vision: true },
      { id: 'openai/gpt-6.1-terra-pro', name: 'GPT-6.1 Terra Pro', ctx: 1_050_000, inPerM: 2.5, outPerM: 12, vision: true, recommended: true, note: 'Best $/capability for coding agents on the router.' },
      { id: 'openai/gpt-6.1-sol-pro', name: 'GPT-6.1 Sol Pro', ctx: 1_050_000, inPerM: 10, outPerM: 50, vision: true },
      { id: 'google/gemini-4-argon', name: 'Gemini 4 Argon', ctx: 1_048_576, inPerM: 4, outPerM: 20, reasoning: true, vision: true },
      { id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash', ctx: 1_048_576, inPerM: 1.5, outPerM: 7.5, vision: true },
      { id: 'x-ai/grok-4.7', name: 'Grok 4.7', ctx: 500_000, inPerM: 2, outPerM: 6, vision: true },
      { id: 'moonshotai/kimi-k3.1-pro', name: 'Kimi K3.1 Pro', ctx: 1_048_576, inPerM: 2, outPerM: 10, reasoning: true, vision: true },
      { id: 'z-ai/glm-5.3', name: 'GLM-5.3', ctx: 1_048_576, inPerM: 1.4, outPerM: 4.4, reasoning: true },
      { id: 'qwen/qwen3-coder-next', name: 'Qwen3-Coder-Next', ctx: 1_000_000, inPerM: 0.12, outPerM: 0.8, reasoning: true },
      { id: 'deepseek/deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 Flash', ctx: 1_000_000, inPerM: 0.3, outPerM: 1.2, reasoning: true, vision: true, note: 'Router often lists off-peak $0.15/$0.60.' },
      { id: 'minimax/minimax-m3.1-flash', name: 'MiniMax M3.1 Flash', ctx: 1_000_000, inPerM: 0.075, outPerM: 0.3, reasoning: true, vision: true },
      { id: 'mistralai/devstral-2512', name: 'Devstral 2', ctx: 262_144, inPerM: 0.4, outPerM: 2, reasoning: true },
      { id: 'meta/muse-spark-1.3', name: 'Muse Spark 1.3', ctx: 1_000_000, inPerM: 1.25, outPerM: 4.25, vision: true },
      { id: 'nvidia/nemotron-3.5-super-vl:free', name: 'Nemotron 3.5 Super VL', ctx: 1_000_000, inPerM: 0, outPerM: 0, free: true, vision: true },
      { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Nemotron 3 Ultra 550B', ctx: 1_000_000, inPerM: 0, outPerM: 0, free: true, note: 'Context unverified (~1M class).' },
      { id: 'cohere/north-mini-code:free', name: 'North Mini Code', ctx: 262_144, inPerM: 0, outPerM: 0, free: true, reasoning: true },
      { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B IT', ctx: 262_144, inPerM: 0, outPerM: 0, free: true, vision: true },
    ],
  },
];

/**
 * v3.1 — default output budget when the user has not set maxTokens.
 * The old hard 8192 truncated long agentic answers (stopReason 'max_tokens'
 * mid-task, no auto-continuation) — one of the "AI gives up halfway" causes.
 * Now: the catalog's maxOut for the model when known, else 16384.
 */
const DEFAULT_MAX_TOKENS_FALLBACK = 16_384;

export function defaultMaxTokensFor(modelId: string): number {
  const id = modelId.toLowerCase();
  for (const p of MODEL_CATALOG) {
    for (const m of p.models) {
      if (m.id.toLowerCase() === id && m.maxOut && m.maxOut > 0) {
        return Math.min(m.maxOut, 32_000);
      }
    }
  }
  return DEFAULT_MAX_TOKENS_FALLBACK;
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch (err) {
    // v11.12 (T4-SILENT) — the silent `{}` used to EAT the model's tool
    // arguments with no trace anywhere. It must at least be visible in the
    // main-process log for postmortems.
    try {
      console.warn(`[providers] safeJsonParse failed (${err instanceof Error ? err.message : String(err)}) — input: ${String(s).slice(0, 200)}`);
    } catch {
      /* logging is best-effort */
    }
    return {};
  }
}

/**
 * v11.15 (MESSAGE-CONTRACT) — `function.arguments` on the wire MUST be a
 * syntactically valid JSON object string. A stream-sliced/truncated args blob
 * (`'{"path":'`) or an empty string used to be forwarded verbatim, which some
 * gateways reject with HTTP 400 mid tool-loop. The engine already converts a
 * malformed call into a corrective tool result, so the `'{}'` fallback never
 * changes which tools actually execute — it only keeps the request legal.
 */
function safeToolArguments(args: string | undefined): string {
  if (typeof args === 'string' && args.length > 0) {
    try {
      const parsed = JSON.parse(args);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return args;
    } catch {
      /* fall through to the empty-object fallback */
    }
  }
  return '{}';
}

/** Anthropic `tool_use.input` must be a concrete object (never null/scalar/array). */
function safeToolInput(args: string | undefined): Record<string, unknown> {
  const parsed = safeJsonParse(typeof args === 'string' ? args : '');
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

// ---------- error classification (v11.16 LATENCY) ----------
//
// The founder's "AI takes forever" report traced to bad free-OpenRouter keys
// (401) and rate limits (429) being retried all the way through a long engine
// backoff schedule before failover. HTTP errors now carry an explicit class so
// the failover orchestrator (and the engine) can act on it:
//   • 401 / 403 / 404 → fatal for THIS provider: skip it immediately, no retry.
//   • 429             → rate limit: ONE short backoff here, then move on.
//   • 5xx / network   → retry once (server) / within the shared budget.
//   • other 4xx       → fatal (bad request), no retry.

export type ProviderErrorKind =
  | 'invalid_key' | 'no_credits' | 'forbidden' | 'not_found' | 'rate_limited'
  | 'server_error' | 'network' | 'bad_request' | 'unknown';

export class ProviderHttpError extends Error {
  readonly status: number;
  readonly kind: ProviderErrorKind;
  /** Whether a short in-provider retry is meaningful (HTTP layer decides). */
  readonly retryable: boolean;
  /** Stop trying this provider entirely and hand over to the next failover target. */
  readonly skipProvider: boolean;
  /** v11.19 — raw `Retry-After` seconds from a 429, used as a user-facing hint. */
  readonly retryAfterSeconds?: number;

  constructor(opts: {
    status: number;
    message: string;
    kind: ProviderErrorKind;
    retryable?: boolean;
    skipProvider?: boolean;
    retryAfterSeconds?: number;
  }) {
    super(opts.message);
    this.name = 'ProviderHttpError';
    this.status = opts.status;
    this.kind = opts.kind;
    this.retryable = opts.retryable ?? false;
    this.skipProvider = opts.skipProvider ?? true;
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }
}

/**
 * v11.26 (CONTINUITY) — a stream died BEFORE it emitted a completion signal
 * (connection reset / SSE [DONE] or message_stop missing / premature close).
 * It is a `network`-class `ProviderHttpError` so the engine's existing
 * stream-drop auto-continue machinery (and the slow-provider gate) classify it
 * correctly. It additionally carries the answer/thinking text already emitted
 * to `onText`/`onThinking` so `routeStream` can resume WITHOUT re-asking the
 * whole prompt and WITHOUT losing any already-streamed delta.
 *
 * Never thrown for a semantic provider error event (those stay fatal) and
 * never thrown when the caller aborted (user stop / engine idle watchdog).
 */
class StreamDroppedError extends ProviderHttpError {
  readonly partialText: string;
  readonly partialThinking: string;
  readonly partialSignature: string;
  readonly depth: number;
  // v11.26 — a tool call was already emitted/in-flight when the stream died.
  // Re-sending it from the PROVIDER layer can execute it twice (side effects);
  // the engine's transcript-safe continuation owns that case instead.
  readonly partialToolCall: boolean;

  constructor(opts: {
    cause: unknown;
    partialText: string;
    partialThinking: string;
    partialSignature: string;
    depth: number;
    partialToolCall?: boolean;
  }) {
    const why = opts.cause
      ? networkErrorMessage(opts.cause)
      : 'connection closed before a completion signal arrived';
    const exhausted = opts.depth > 0 ? ' Recovery attempts were exhausted.' : '';
    super({
      status: 0,
      kind: 'network',
      message: `Stream ended before completion after ${opts.partialText.length} characters (${why}).${exhausted} Retry the request or check the provider/connection in Settings.`,
    });
    this.name = 'StreamDroppedError';
    this.partialText = opts.partialText;
    this.partialThinking = opts.partialThinking;
    this.partialSignature = opts.partialSignature;
    this.depth = opts.depth;
    this.partialToolCall = opts.partialToolCall === true;
  }
}

/** True for a transport-level stream death (NOT a semantic provider error). */
function isStreamDropError(err: unknown): boolean {
  if (isRetryableNetworkError(err)) return true;
  const msg = `${err instanceof Error ? err.message : String(err)}`;
  return /terminated|premature close|connection reset|stream reset|socket|EOF|unexpected end|stream stalled/i.test(msg);
}

/** Classify any thrown value (HTTP error, network error, or plain Error). */
export function providerErrorKindOf(err: unknown): ProviderErrorKind {
  if (err instanceof ProviderHttpError) return err.kind;
  const status = (err as { status?: number } | null)?.status;
  if (status === 401) return 'invalid_key';
  // v11.19 — 402 means NO CREDITS on the provider account. It is fatal for
  // this provider and must be explained clearly, not shown as a raw JSON.
  if (status === 402) return 'no_credits';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (typeof status === 'number' && status >= 500) return 'server_error';
  const msg = `${err instanceof Error ? err.message : String(err)}`;
  if (/\b402\b|Insufficient credits|no credits|never purchased credits|add credits/i.test(msg)) return 'no_credits';
  if (/\b401\b|Invalid API key|Unauthorized/i.test(msg)) return 'invalid_key';
  if (/\b403\b|Forbidden/i.test(msg)) return 'forbidden';
  if (/\b404\b|Model not found/i.test(msg)) return 'not_found';
  if (/\b429\b|Rate limited|rate.?limit/i.test(msg)) return 'rate_limited';
  if (/\b5\d\d\b|Provider error 5/i.test(msg)) return 'server_error';
  if (isRetryableNetworkError(err)) return 'network';
  return 'unknown';
}

/** True when this error means "abandon this provider, try the next one". */
export function shouldSkipProvider(err: unknown): boolean {
  if (err instanceof ProviderHttpError) return err.skipProvider;
  const kind = providerErrorKindOf(err);
  return kind === 'invalid_key' || kind === 'no_credits' || kind === 'forbidden' || kind === 'not_found' ||
    kind === 'rate_limited' || kind === 'server_error' || kind === 'network';
}

export function isInvalidKeyError(err: unknown): boolean {
  return providerErrorKindOf(err) === 'invalid_key';
}

/**
 * v11.23 (PROVIDER ERRORS) — JSON-free, single-language error text.
 *
 * Gateways return bodies like
 * `{"error":{"message":"Insufficient credits ...","code":402}}`. Forwarding
 * that raw body to the UI produced the founder's "402 Insufficient credits
 * {json}" screenshots. This helper NEVER returns a raw payload: when the text
 * is JSON it optionally lifts one human-readable reason field, and it always
 * clamps to printable ASCII so providers.ts stays single-language (the
 * renderer translates the classified error into the user's language).
 * Best-effort and pure: an unparseable body yields '' (caller falls back to a
 * generic status phrase).
 */
export function sanitizeErrorText(text: string | undefined | null): string {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return '';
  let reason = raw;
  if (raw[0] === '{' || raw[0] === '[') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const root = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
      const nested = (root.error && typeof root.error === 'object' ? root.error : {}) as Record<string, unknown>;
      const candidate = nested.message ?? root.message ?? root.detail ?? nested.type ?? root.error;
      reason = typeof candidate === 'string' ? candidate : '';
    } catch {
      reason = ''; // malformed JSON is NEVER shown to the user
    }
  }
  const clean = reason.replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '').slice(0, 160).trim();
  // v11.31 — JSON-free AND secret-free: a gateway body can carry a live key.
  return redactSecrets(clean);
}

/**
 * v11.23 — text for user-visible notices. Our own `ProviderHttpError` messages
 * are sanitized at construction, so keep them verbatim (including the `→`
 * typographic arrow in the "Settings → Providers" hint). Anything else is
 * untrusted and goes through the JSON/mixed-language guard.
 */
function visibleErrorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Our own classified messages are single-language/JSON-free already, but a
  // provider-supplied body may still carry a key — scrub defensively in both
  // branches before the text reaches a sys_notice or an error row.
  return redactSecrets(err instanceof ProviderHttpError ? raw : (sanitizeErrorText(raw) || 'provider error'));
}

/**
 * v11.23 — honest network/timeout text. Node's undici `fetch` rejects with a
 * generic `TypeError: fetch failed` and hides the real cause (ETIMEDOUT,
 * ECONNREFUSED, socket hang up, ...) on `.cause`. Surface it so a stall is
 * reported truthfully instead of as an opaque "fetch failed".
 */
function networkErrorMessage(err: unknown): string {
  const direct = err instanceof Error ? err.message : String(err);
  const cause = (err as { cause?: unknown } | null)?.cause;
  const causeText = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  return sanitizeErrorText(causeText ? `${direct}: ${causeText}` : direct) || 'Network error.';
}

/** Build a descriptive, classified Error from a non-2xx response. */
async function httpError(res: Response, preReadText?: string): Promise<ProviderHttpError> {
  let text = preReadText ?? '';
  if (!text) {
    try {
      text = (await res.text()).slice(0, 400);
    } catch {
      /* body unreadable — fall through */
    }
  }
  if (res.status === 401) {
    return new ProviderHttpError({
      status: 401, kind: 'invalid_key',
      message: 'Invalid API key (401). Check Settings → AI providers.',
    });
  }
  if (res.status === 402) {
    // Provider-agnostic + SINGLE language (the renderer sets a.language before
    // calling). Never hardcode a provider name or mix EN+AR in one value.
    return new ProviderHttpError({
      status: 402, kind: 'no_credits',
      // Neutral + single language: no provider name, no mixed EN/AR. The
      // renderer translates this classified error into the selected language.
      message: 'Insufficient credits (402): this provider account has no balance. Add credits to the provider account or switch the provider/key in Settings → Providers.',
    });
  }
  if (res.status === 403) {
    // v11.23 — never forward a raw provider body (JSON leak). Sanitize to a
    // short, single-language reason; fall back to a generic status phrase.
    return new ProviderHttpError({
      status: 403, kind: 'forbidden',
      message: `Access forbidden (403): ${sanitizeErrorText(text) || sanitizeErrorText(res.statusText) || 'Forbidden'}`,
    });
  }
  if (res.status === 429) {
    // v11.19 (QUIET 429) — NO raw provider body (no JSON / 30s Retry-After
    // noise) and NO "failover" wording. The failover orchestrator emits ONE
    // consolidated, deduped notice for the whole chain; the renderer i18ns it.
    const retryAfterSeconds = parseRetryAfterSeconds(res.headers.get('retry-after')) ?? undefined;
    return new ProviderHttpError({
      status: 429, kind: 'rate_limited',
      message: 'Rate limited (429) - retries were exhausted; the chosen provider was kept. Wait briefly, then send again.',
      retryAfterSeconds,
    });
  }
  if (res.status === 404) {
    // v11.23 — same JSON-leak guard as 403.
    return new ProviderHttpError({
      status: 404, kind: 'not_found',
      message: `Model not found (404): ${sanitizeErrorText(text) || sanitizeErrorText(res.statusText) || 'Model not found'}`,
    });
  }
  // v11.23 — covers 5xx and other 4xx (incl. a failed 400/422 downgrade).
  // The body is sanitized so no JSON / mixed language ever reaches the UI;
  // the status code + kind remain the honest, machine-readable classification.
  return new ProviderHttpError({
    status: res.status,
    kind: res.status >= 500 ? 'server_error' : 'bad_request',
    message: `Provider error ${res.status}: ${sanitizeErrorText(text) || sanitizeErrorText(res.statusText) || 'Unknown provider error'}`,
  });
}

// ---------- retry with bounded, status-specific backoff ----------

/**
 * v11.23 — every transient 5xx gets ONE short retry inside the shared budget.
 * 504/521/522/524 are gateway timeouts/upstream failures, 507 is a transient
 * capacity error; 501 (Not Implemented) is intentionally excluded — retrying
 * an unsupported endpoint is pointless. All statuses here remain classified
 * as `server_error` by providerErrorKindOf/httpError.
 */
const RETRYABLE_STATUS = new Set([500, 502, 503, 504, 507, 521, 522, 524, 529]);
const RETRY_BASE_MS = 1500;
const RETRY_MAX_MS = 8000;
/**
 * v11.27 (429 CONTINUE) — a 429 is now RECOVERABLE in place. Each wait is
 * exponential but HARD-CAPPED at ≤1s (the founder forbade multi-second sleeps);
 * the GENEROUS total budget lets a short congestion episode pass before the
 * task continues on the SAME provider. Nothing here switches providers.
 */
const RATE_LIMIT_BACKOFF_MS = 250;
const RATE_LIMIT_BACKOFF_CAP_MS = 1000;
/** Default: initial request + 7 bounded retries (8 total attempts). */
const DEFAULT_RATE_LIMIT_MAX_ATTEMPTS = 8;
/** Default generous wall-clock budget for the whole 429 episode (60s). */
const DEFAULT_RATE_LIMIT_BUDGET_MS = 60_000;
/**
 * v11.31 — a strict gateway can reject MORE THAN ONE optional feature in a
 * single request (e.g. 422 on cache_control, then 422 on one tool schema).
 * Allow several immediate, backoff-free downgrade hops but keep them bounded
 * so a hostile endpoint can never spin forever. Each hop must CHANGE the body
 * (see `replacement !== body`) or it terminates immediately.
 */
const MAX_PROTOCOL_DOWNGRADES = 4;
/** One retry for 5xx — enough for a transient blip, never a 30s stall. */
const SERVER_ERROR_RETRIES = 1;
const SERVER_ERROR_BACKOFF_MS = 500;
/** Hard ceiling on ALL in-provider HTTP retries for a single streamTurn call. */
const DEFAULT_PROVIDER_RETRY_BUDGET_MS = 10_000;

export function providerRetryBudgetMs(): number {
  const raw = Number(process.env.SURNIA_PROVIDER_RETRY_BUDGET_MS);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_PROVIDER_RETRY_BUDGET_MS;
}

/**
 * v11.27 — total number of attempts (initial request + retries) allowed for a
 * single 429 episode before a terminal error. Env-tunable for tests/ops; kept
 * inside 1..50 so a bad config can never create an unbounded hammer loop.
 */
export function rateLimitMaxAttempts(): number {
  const raw = Number(process.env.SURNIA_RATE_LIMIT_MAX_ATTEMPTS);
  if (!Number.isFinite(raw)) return DEFAULT_RATE_LIMIT_MAX_ATTEMPTS;
  return Math.max(1, Math.min(50, Math.floor(raw)));
}

/** v11.27 — generous WALL-CLOCK budget (ms) for one 429 episode (env-tunable). */
export function rateLimitBudgetMs(): number {
  const raw = Number(process.env.SURNIA_RATE_LIMIT_BUDGET_MS);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_RATE_LIMIT_BUDGET_MS;
}

/** ±20% jitter so parallel agents / turns never retry in lockstep. */
function jitterMs(ms: number): number {
  return Math.max(0, Math.round(ms * (0.8 + Math.random() * 0.4)));
}

function backoffMs(attempt: number): number {
  return jitterMs(Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS));
}

function isRetryableNetworkError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code ?? '';
  const m = `${err instanceof Error ? err.message : String(err)} ${code}`;
  // v11.7 — the SSE idle watchdog's stall error is retryable by definition
  // (the engine's turn-level retry + provider failover take over).
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|UND_ERR|socket hang up|fetch failed|network|Stream stalled/i.test(m);
}

/** Parse a Retry-After header (seconds or HTTP-date), capped SHORT for 429. */
function parseRetryAfter(v: string | null): number | null {
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, RATE_LIMIT_BACKOFF_CAP_MS);
  const date = Date.parse(v);
  if (!Number.isNaN(date)) return Math.min(Math.max(0, date - Date.now()), RATE_LIMIT_BACKOFF_CAP_MS);
  return null;
}

/**
 * v11.19 — raw Retry-After seconds (UNCAPPED) for the user-facing hint only.
 * Never used to schedule a wait: the actual backoff is capped at ≤1s above.
 */
function parseRetryAfterSeconds(v: string | null): number | null {
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs) && secs >= 0 && secs < 86400) return Math.round(secs);
  const date = Date.parse(v);
  if (!Number.isNaN(date)) return Math.max(0, Math.round((date - Date.now()) / 1000));
  return null;
}

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Drain a failed response body so the socket can be reused/closed cleanly. */
async function drainBody(res: Response): Promise<void> {
  try {
    await res.arrayBuffer();
  } catch {
    /* already closed */
  }
}

interface PostJsonOpts {
  url: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
  maxRetries: number;
  /**
   * v11.27 — explicit cap on in-provider 429 retries. Undefined uses the
   * generous "continue same task" policy; a failover orchestrator passes 1.
   */
  maxRateLimitRetries?: number;
  /** Honest user-visible notice channel (threaded from StreamArgs.onNotice). */
  onNotice?: (notice: ProviderNotice) => void;
  /**
   * On a 400 whose error text matches a known-unsupported feature, return a
   * replacement request body (feature stripped) to retry once immediately.
   * Used for gateways that reject cache_control / reasoning parameters.
   */
  downgrade400?: (errorText: string, requestBody: string) => string | null;
}

function networkError(err: unknown): ProviderHttpError {
  return new ProviderHttpError({
    status: 0,
    kind: 'network',
    // v11.23 — surface the real cause (ETIMEDOUT / ECONNREFUSED / ...), never
    // a raw payload. `kind: 'network'` is what the engine/store classify on.
    message: networkErrorMessage(err),
  });
}

/** Remaining ms in the per-provider retry budget; never negative. */
function budgetLeft(startedAt: number, budget: number): number {
  return Math.max(0, budget - (Date.now() - startedAt));
}

/**
 * POST JSON and resolve with the (streaming) Response. v11.16 (LATENCY):
 * the retry policy is now STATUS-SPECIFIC and bounded by a total wall-clock
 * budget, so a bad key or a throttled provider can never burn 30-60s:
 *   • 401 / 403 / 404 → throw IMMEDIATELY (no retry, skip provider).
 *   • 429             → v11.27: RECOVERABLE in place with bounded exponential
 *                       backoff (≤1s each), up to 5-8 attempts over a generous
 *                       ~60s budget. ONE quiet notice. Same provider only —
 *                       no auto-switch, no duplicated text, no re-run tools.
 *                       A caller with an explicit failover chain still passes
 *                       maxRateLimitRetries=1 (legacy one-retry behavior).
 *   • 5xx             → retry ONCE with a short backoff.
 *   • network errors  → retry within the shared budget.
 * The 400/422 downgrade path (cache_control / one bad tool / reasoning params)
 * runs immediately, without consuming the retry budget, and is now bounded to
 * a few hops so a gateway rejecting several features can still be recovered.
 */
async function postJsonWithRetry(o: PostJsonOpts): Promise<Response> {
  const startedAt = Date.now();
  const budget = providerRetryBudgetMs();
  const totalRetries = Math.max(0, Math.floor(o.maxRetries));
  let body = o.body;
  let downgrades = 0;
  let rateLimitRetries = 0;
  /** v11.27 — wall-clock start of the current 429 episode (0 = none yet). */
  let rlStartedAt = 0;
  let serverRetries = 0;
  let networkRetries = 0;

  for (;;) {
    // v11.27 — once a 429 episode is in progress the generous 429 budget owns
    // the wait; the short generic retry budget must NOT cut it off after 10s.
    if (rateLimitRetries === 0 && budgetLeft(startedAt, budget) <= 0) {
      o.onNotice?.({
        kind: 'retry',
        // v11.31 — honest + switch-free: most callers (the engine) have NO
        // failover chain, so promising "the next provider" was misleading.
        text: `Provider retry budget (${budget}ms) exhausted — the provider did not respond in time. Try again or check the connection in Settings.`,
      });
      // Not a rate-limit: keep it OUT of the 429 bookkeeping so the
      // consolidated "all providers rate-limited" message stays honest.
      throw new ProviderHttpError({
        status: 0, kind: 'server_error',
        message: `Provider retry budget (${budget}ms) exhausted — the provider did not respond in time.`,
      });
    }

    let res: Response;
    try {
      res = await fetch(o.url, { method: 'POST', headers: o.headers, body, signal: o.signal });
    } catch (err) {
      if (o.signal.aborted || !isRetryableNetworkError(err)) throw err;
      const delay = Math.min(backoffMs(networkRetries), budgetLeft(startedAt, budget));
      if (networkRetries >= totalRetries || delay <= 0) throw networkError(err);
      networkRetries++;
      o.onNotice?.({
        kind: 'retry',
        text: `Network error (${networkErrorMessage(err)}) — retrying in ${delay}ms.`,
      });
      await sleepAbortable(delay, o.signal);
      continue;
    }
    if (res.ok) return res;

    // Gateway rejects an optional feature (cache_control / one bad tool /
    // reasoning params): strip it and retry immediately — no backoff consumed,
    // but bounded to MAX_PROTOCOL_DOWNGRADES hops (v11.31).
    // v11.16 FIX: FastAPI/Pydantic gateways (DashScope, Moonshot, custom
    // OpenAI-compatible servers) reject extra fields with 422, not 400. A
    // 422 on cache_control was fatal → "Provider error 422, no response".
    // Treat 400 AND 422 as a downgradeable validation error.
    if ((res.status === 400 || res.status === 422) && o.downgrade400 && downgrades < MAX_PROTOCOL_DOWNGRADES) {
      let errText = '';
      try {
        errText = (await res.text()).slice(0, 400);
      } catch {
        /* unreadable body */
      }
      const replacement = o.downgrade400(errText, body);
      if (replacement != null && replacement !== body) {
        body = replacement;
        downgrades++; // v11.31 — bounded; each hop must change the request
        continue;
      }
      throw await httpError(res, errText);
    }

    // Fatal for this provider: never retry a bad key / forbidden / missing model.
    // (400/403/401/404 all fall straight through to httpError below.)
    if (res.status === 429) {
      // v11.27 (429 CONTINUE) — a 429 is RECOVERABLE in place. Retry the SAME
      // request (no text has been streamed yet, so nothing is duplicated and no
      // tool can be re-executed) with bounded EXPONENTIAL backoff capped at ≤1s
      // per wait, until either the provider recovers OR the episode is genuinely
      // exhausted. The user's provider is NEVER switched because of a 429.
      // A caller with an explicit failover chain passes maxRateLimitRetries=1
      // and stays silent here (the orchestrator owns the one consolidated
      // notice); the default in-place policy emits ONE quiet notice on the
      // first 429 so a long task visibly explains the brief pause.
      const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
      const retryAfterSecs = parseRetryAfterSeconds(res.headers.get('retry-after'));
      await drainBody(res);

      const chained = o.maxRateLimitRetries !== undefined;
      const maxRetriesFor429 = o.maxRateLimitRetries ?? Math.max(0, rateLimitMaxAttempts() - 1);
      if (!chained && rateLimitRetries === 0 && maxRetriesFor429 > 0) {
        o.onNotice?.({
          kind: 'rate_limited',
          status: 429,
          text: 'Rate limited (429) — waiting briefly and continuing the same task (no provider switch).',
        });
      }

      if (!rlStartedAt) rlStartedAt = Date.now();
      const rlLeft = budgetLeft(rlStartedAt, rateLimitBudgetMs());
      // Exponential 250 → 500 → 1000 (capped) unless the provider supplied a
      // short Retry-After (also capped at 1s). Jitter is applied only to the
      // wait, then capped AGAIN so the real sleep is always ≤1s.
      const exponential = Math.min(RATE_LIMIT_BACKOFF_MS * 2 ** rateLimitRetries, RATE_LIMIT_BACKOFF_CAP_MS);
      const requested = retryAfterMs ?? exponential;
      // A `Retry-After: 0` is a VALID immediate-retry signal, not "no budget".
      // Stop only on genuine exhaustion: attempt cap or an expired wall clock.
      const delay = Math.min(jitterMs(requested), RATE_LIMIT_BACKOFF_CAP_MS, rlLeft);
      if (rateLimitRetries >= maxRetriesFor429 || rlLeft <= 0) {
        const err = await httpError(res);
        // Preserve the honest Retry-After hint for the terminal report.
        if (retryAfterSecs !== null && (err as ProviderHttpError).retryAfterSeconds === undefined) {
          (err as { retryAfterSeconds?: number }).retryAfterSeconds = retryAfterSecs;
        }
        throw err;
      }
      rateLimitRetries++;
      await sleepAbortable(delay, o.signal);
      continue;
    }

    if (RETRYABLE_STATUS.has(res.status)) {
      await drainBody(res);
      const delay = Math.min(jitterMs(SERVER_ERROR_BACKOFF_MS), budgetLeft(startedAt, budget));
      if (serverRetries >= SERVER_ERROR_RETRIES || delay <= 0) throw await httpError(res);
      serverRetries++;
      o.onNotice?.({
        kind: 'server_error', status: res.status,
        text: `Provider error ${res.status} — retrying once in ${delay}ms.`,
      });
      await sleepAbortable(delay, o.signal);
      continue;
    }

    throw await httpError(res);
  }
}

/** Recursively delete every `cache_control` key from a parsed request body. */
function stripCacheControl(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCacheControl);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'cache_control') continue;
      out[k] = stripCacheControl(v);
    }
    return out;
  }
  return value;
}

/** Strip `reasoning_effort` / `reasoning` keys from an OpenAI-compat request body. */
function stripReasoningParams(bodyText: string): string | null {
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    if (!('reasoning_effort' in parsed) && !('reasoning' in parsed)) return null;
    delete parsed.reasoning_effort;
    delete parsed.reasoning;
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

/** Fallback when the provider does not report usage: chars/4 heuristic. */
function estimateUsage(a: StreamArgs, outputChars: number): Usage {
  const inputChars = a.system.length + JSON.stringify(a.messages).length;
  return {
    inputTokens: Math.ceil(inputChars / 4),
    outputTokens: Math.ceil(outputChars / 4),
    costUsd: 0, // engine fills via estimateCost
  };
}

/**
 * Usage payload extended with runtime-only cache-split fields. The shared
 * `Usage` type is intentionally left untouched; these extra fields ride the
 * IPC JSON so the engine can weight run totals correctly.
 */
export type UsageWithCache = Usage & { cacheReadTokens?: number; cacheCreationTokens?: number };

/**
 * Forward-compatible tuning knobs that may ride along on ModelConfig or
 * StreamArgs (ModelConfig only declares temperature/maxTokens/reasoning in
 * shared/types.ts — read defensively here until the type grows them).
 */
function tuningOf(a: StreamArgs): {
  topP?: number;
  stop?: string[];
  parallelToolCalls?: boolean;
} {
  const m = a.model as ModelConfig & { topP?: number; stop?: unknown; parallelToolCalls?: unknown };
  const s = a as StreamArgs & { topP?: unknown; stop?: unknown; parallelToolCalls?: unknown };
  const pickTopP = (): number | undefined =>
    typeof s.topP === 'number' && s.topP > 0 && s.topP <= 1
      ? s.topP
      : typeof m.topP === 'number' && m.topP > 0 && m.topP <= 1
        ? m.topP
        : undefined;
  const pickStop = (): string[] | undefined => {
    const raw = Array.isArray(s.stop) ? s.stop : Array.isArray(m.stop) ? m.stop : null;
    if (!raw) return undefined;
    const list = raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
    return list.length ? list : undefined;
  };
  const pickParallel = (): boolean | undefined => {
    if (typeof s.parallelToolCalls === 'boolean') return s.parallelToolCalls;
    if (typeof m.parallelToolCalls === 'boolean') return m.parallelToolCalls;
    return undefined;
  };
  const topP = pickTopP();
  const stop = pickStop();
  const parallelToolCalls = pickParallel();
  return {
    ...(topP !== undefined ? { topP } : {}),
    ...(stop ? { stop } : {}),
    ...(parallelToolCalls !== undefined ? { parallelToolCalls } : {}),
  };
}

interface ToolAcc {
  id?: string;
  name: string;
  json: string;
  lastEmit: number;
}

/**
 * v11.9 (E8) — deterministic tag for throttled tool_use partials emitted
 * BEFORE the real tool id arrives. When the final call later flushes under
 * its real id, the engine prunes the temp entry whose (name) matches and
 * whose args are a strict prefix of / invalid against the final args — the
 * invariant: never dispatch two calls with the same name where one is a
 * truncated prefix of the other. Exported so the engine (and tests) can
 * recognize temp ids without duplicating the literal.
 */
export const TEMP_TOOL_ID_PREFIX = 'surnia_tmp_';
function tempToolId(index: number): string {
  return `${TEMP_TOOL_ID_PREFIX}call_${index}`;
}

interface SseCtx {
  a: StreamArgs;
  accs: Map<number, ToolAcc>;
  outChars: number;
  /** v11.26 — answer text actually emitted (post <think> stripping), used to resume a dropped stream. */
  answerText: string;
  /** v11.26 — a terminal completion signal (finish_reason / [DONE] / message_stop) was seen. */
  terminal: boolean;
  /** v11.26 — a semantic provider error event was raised; never swallow it as a drop. */
  semanticError: boolean;
}

/** Throttled onToolUse emit (every ~300ms per tool call). */
function maybeEmitToolUse(ctx: SseCtx, index: number): void {
  const acc = ctx.accs.get(index);
  if (!acc || !acc.name) return;
  const now = Date.now();
  if (now - acc.lastEmit < TOOL_USE_EMIT_INTERVAL_MS) return;
  acc.lastEmit = now;
  // v11.9 (E8) — throttled partials BEFORE the real id arrives carry the
  // deterministic temp tag; the engine prunes the stale entry when the final
  // call flushes under its real id.
  ctx.a.onToolUse(acc.id ?? tempToolId(index), acc.name, acc.json);
}

/** Final onToolUse flush — guarantees the engine sees complete JSON. */
function flushToolUse(ctx: SseCtx): void {
  for (const [index, acc] of ctx.accs) {
    if (acc.name) ctx.a.onToolUse(acc.id ?? tempToolId(index), acc.name, acc.json);
  }
}

/**
 * v11.7 — STREAM IDLE WATCHDOG: the #1 cause of "the AI never replied" is a
 * provider that stops sending SSE bytes WITHOUT closing the connection (proxy
 * stalls, overloaded gateways, dead sockets). reader.read() then awaits
 * FOREVER — the turn hangs, the UI spins, nothing surfaces. The watchdog races
 * every read against an idle timer; any received byte resets it. On timeout
 * the reader is cancelled and a retryable error is thrown (the engine's turn
 * retry + provider failover then take over, so a stalled stream now costs a
 * few seconds, not an eternity).
 *
 * v11.10 FAIRNESS CONTRACT: the timer fires ONLY when ZERO bytes arrive for
 * the whole idle window. Answer deltas, THINKING deltas, tool-JSON deltas,
 * SSE comment/keep-alive lines (\": ping\") and Anthropic `ping` events are
 * all bytes — they all reset the window. A model that thinks out loud for
 * minutes with a steady delta flow must NEVER trip it. Comment/ping bytes
 * count as "alive" (they reset the timer) but are ignored by the parsers —
 * they never fabricate answer content.
 */
const SSE_IDLE_TIMEOUT_MS = 75_000; // 75s with ZERO bytes = dead stream

/**
 * v11.10 — the idle window is env-tunable (SURNIA_SSE_IDLE_MS, floor 500ms).
 * Default stays 75s. Read at CALL time (not module load) so tests can scale
 * the window down without touching production behavior.
 */
export function sseIdleTimeoutMs(): number {
  const raw = Number(process.env.SURNIA_SSE_IDLE_MS);
  return Number.isFinite(raw) && raw >= 500 ? Math.floor(raw) : SSE_IDLE_TIMEOUT_MS;
}

function sseIdleErr(): string {
  return `Stream stalled (no data for ${Math.round(sseIdleTimeoutMs() / 1000)}s) — connection dropped by the provider/proxy.`;
}

async function readSseLines(
  res: Response,
  onLine: (dataPayload: string) => void,
  onByte?: () => void,
): Promise<void> {
  if (!res.body) throw new Error('Provider returned an empty response body.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handle = (): void => {
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.startsWith('data:')) onLine(line.slice(5).trim());
    }
  };
  // v11.7 — watchdog: any byte resets the idle window; when the timer fires
  // the reader is cancelled and we surface the REAL cause (stalled stream) as
  // a retryable error.
  let watchdog: NodeJS.Timeout | null = null;
  let stalled = false;
  const onIdleFire = (): void => {
    stalled = true;
    try {
      void reader.cancel();
    } catch {
      /* not readable anymore */
    }
  };
  const armIdle = (): void => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(onIdleFire, sseIdleTimeoutMs());
    void watchdog.unref?.();
  };
  try {
    armIdle();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      armIdle(); // ANY byte resets the idle window (text/thinking/tool deltas, keep-alive comments, pings)
      onByte?.(); // v12 — let the engine's idle watchdog see keep-alive bytes too
      buffer += decoder.decode(value, { stream: true });
      handle();
    }
    if (watchdog) clearTimeout(watchdog);
    // v11.10 FAIRNESS FIX: per the WHATWG Streams spec, reader.cancel() RESOLVES
    // pending read() calls with {done:true} instead of rejecting them — so the
    // watchdog fire could masquerade as a clean end-of-stream here and the turn
    // would silently end with an (empty) "complete" answer. A done-break while
    // `stalled` is a STALL: surface the retryable error (the engine's turn
    // retry + provider failover then take over).
    if (stalled) throw new Error(sseIdleErr());
    buffer += decoder.decode(); // flush decoder tail
    // Process a final line that lacked a trailing newline.
    const last = buffer.trim();
    if (last.startsWith('data:')) onLine(last.slice(5).trim());
  } catch (err) {
    if (watchdog) clearTimeout(watchdog);
    // Error/abort mid-stream — release the socket, then rethrow.
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
    // v11.7 — a watchdog-fired cancel arrives as an opaque AbortError; surface
    // the REAL cause (stalled stream) so the engine retry/failover sees a
    // retryable network-class failure instead of a confusing abort.
    if (stalled) throw new Error(sseIdleErr());
    throw err;
  }
}

// ============================================================
// Anthropic protocol
// ============================================================

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | AnthropicBlock[];
  is_error?: boolean;
  thinking?: string;
  signature?: string;
  source?: { type: 'base64'; media_type: string; data: string };
}

/**
 * v1138 — Extended-thinking budget from the model's OWN named effort stop.
 * Replaced the old hardcoded {low,medium,high} table: the budget is now read
 * from the per-model descriptor in shared/effort.ts, so a Claude stop and a
 * GPT stop can never silently share one meaning. 0 = thinking disabled.
 */
export function wantedThinkingBudget(
  provider: ProviderId,
  model: string,
  level: string | undefined,
): number {
  return thinkingBudgetFor(provider, model, level);
}

/**
 * Map normalized messages → Anthropic messages, merging consecutive same-role
 * entries. Exported for the v11.15 message-contract tests (test-only surface;
 * production still calls it through `streamAnthropic`).
 */
export function toAnthropicMessages(msgs: ProviderMsg[]): { role: 'user' | 'assistant'; content: AnthropicBlock[] }[] {
  const out: { role: 'user' | 'assistant'; content: AnthropicBlock[] }[] = [];
  const push = (role: 'user' | 'assistant', block: AnthropicBlock): void => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(block);
    else out.push({ role, content: [block] });
  };
  // v11.15 — a tool_result block is only legal when a preceding tool_use block
  // declared the same id. Track ids as they are emitted; drop orphan results
  // (interrupted sessions / adversarial transcripts) instead of 400ing.
  const declaredCalls = new Set<string>();

  for (const m of msgs) {
    if (m.role === 'user') {
      push('user', { type: 'text', text: m.text });
      for (const img of m.images ?? []) {
        const parsed = parseDataUrl(img);
        if (parsed) {
          push('user', { type: 'image', source: { type: 'base64', media_type: parsed.mime, data: parsed.data } });
        }
      }
    } else if (m.role === 'assistant') {
      // Thinking blocks must come FIRST in an assistant message. They are ONLY
      // resent when a non-empty API signature was captured: the Anthropic API
      // validates the signature and rejects an unsigned thinking block with a
      // 400 mid-loop (v11.9 — the old code pushed m.thinking without a
      // signature whenever the signature was absent). When the signature is
      // missing the thinking content is DROPPED for the resent message;
      // text/toolCalls are always kept.
      if (m.thinking && m.thinkingSignature) {
        push('assistant', {
          type: 'thinking',
          thinking: m.thinking,
          signature: m.thinkingSignature,
        });
      }
      if (m.text) push('assistant', { type: 'text', text: m.text });
      for (const tc of m.toolCalls ?? []) {
        declaredCalls.add(tc.id);
        // safeToolInput always yields a concrete object (never a truncated
        // string, null scalar or array), so tool_use.input is valid on the wire.
        push('assistant', { type: 'tool_use', id: tc.id, name: tc.name, input: safeToolInput(tc.args) });
      }
    } else {
      if (!declaredCalls.has(m.callId)) continue; // orphan tool_result — never sent
      // v11.15 — Anthropic rejects an empty text block; a benign placeholder
      // keeps the tool_result content array non-empty.
      const content = typeof m.content === 'string' && m.content.length > 0 ? m.content : '(empty tool result)';
      const blocks: AnthropicBlock[] = [{ type: 'text', text: content }];
      for (const img of m.images ?? []) {
        const parsed = parseDataUrl(img);
        if (parsed) {
          blocks.push({ type: 'image', source: { type: 'base64', media_type: parsed.mime, data: parsed.data } });
        }
      }
      push('user', {
        type: 'tool_result',
        tool_use_id: m.callId,
        content: blocks,
        is_error: !!m.isError,
      });
    }
  }

  // Anthropic requires the first message to be user-role.
  if (out.length && out[0].role === 'assistant') {
    out.unshift({ role: 'user', content: [{ type: 'text', text: '(conversation continues)' }] });
  }
  return out;
}

/**
 * v7 — ROLLING cache breakpoint: mark the LAST message so the ENTIRE
 * conversation prefix becomes a cached prefix for the next turn (Anthropic
 * bills cache reads at ~10% — long sessions stop paying full price for
 * history every step). Uses the 4th and final allowed breakpoint slot
 * (system + last-tool already take two).
 */
function applyRollingCacheBreakpoint(
  out: { role: 'user' | 'assistant'; content: AnthropicBlock[] }[],
): void {
  const last = out[out.length - 1];
  if (!last || last.content.length === 0) return;
  const block = last.content[last.content.length - 1] as unknown as Record<string, unknown>;
  if (block && typeof block === 'object' && !block.cache_control) {
    block.cache_control = { type: 'ephemeral' };
  }
}

async function streamAnthropic(a: StreamArgs): Promise<StreamResult> {
  const base = (a.baseUrl?.trim() || DEFAULT_BASE_URLS[a.model.provider] || DEFAULT_BASE_URLS.anthropic).replace(/\/+$/, '');
  let maxTokens = a.model.maxTokens ?? defaultMaxTokensFor(a.model.model);
  // Prompt caching: the system prompt + tool definitions are identical across
  // every turn — cache them (up to 90% cheaper, faster TTFT). Some gateways
  // reject cache_control → postJsonWithRetry retries once without it.
  // NOTE: Anthropic allows at most 4 cache_control breakpoints per request;
  // Surnia sets exactly 2 — the system block and the LAST tool definition
  // (both byte-identical across turns, so the prefix cache always hits).
  // Do not add more breakpoints casually or 400s will follow.
  const caching = a.promptCaching !== false;
  const anthropicMessages = toAnthropicMessages(a.messages);
  if (caching) applyRollingCacheBreakpoint(anthropicMessages); // v7 — rolling history breakpoint
  // v11.16 — only the STABLE prefix gets a breakpoint; the dynamic tail
  // (clock/memory/context) is a separate system block so the cache still hits.
  const sysSplit = splitSystemPrompt(a.system);
  const systemBlocks: AnthropicBlock[] = [
    {
      type: 'text',
      text: sysSplit.stable,
      ...(caching ? { cache_control: { type: 'ephemeral' } } : {}),
    },
    ...(sysSplit.dynamic ? [{ type: 'text' as const, text: sysSplit.dynamic }] : []),
  ];
  const body: Record<string, unknown> = {
    model: a.model.model,
    max_tokens: maxTokens,
    system: systemBlocks,
    messages: anthropicMessages,
    stream: true,
  };
  if (a.tools.length) {
    // v11.35 — forward EVERY tool: provider-native defs as Anthropic
    // server-side tool blocks, the rest as standard function tools. Nothing is
    // dropped for being unknown, and native blocks are never downgraded.
    body.tools = buildAnthropicTools(a.tools, caching);
  }
  // Extended thinking — Anthropic reasoning mode (budget ≥1024 and < max_tokens).
  const thinkBudget = wantedThinkingBudget(a.model.provider, a.model.model, a.model.reasoning);
  if (thinkBudget) {
    body.thinking = { type: 'enabled', budget_tokens: thinkBudget };
    // Anthropic requires temperature 1 while thinking is enabled.
    body.temperature = 1;
    if (maxTokens < thinkBudget + 4096) {
      maxTokens = thinkBudget + 4096;
      body.max_tokens = maxTokens;
    }
  } else if (typeof a.model.temperature === 'number') {
    body.temperature = a.model.temperature;
  }
  // Optional tuning (forward-compatible fields — see tuningOf). Anthropic
  // rejects top_p / stop_sequences alongside extended thinking, so both are
  // only sent on plain (non-thinking) requests.
  const tuning = tuningOf(a);
  if (!thinkBudget) {
    if (tuning.topP !== undefined) body.top_p = tuning.topP;
    if (tuning.stop?.length) body.stop_sequences = tuning.stop;
  }

  const res = await postJsonWithRetry({
    url: base + '/v1/messages',
    headers: {
      'content-type': 'application/json',
      'x-api-key': a.apiKey ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: a.signal,
    maxRetries: a.maxRetries ?? 2,
    maxRateLimitRetries: maxRateLimitRetriesOf(a),
    onNotice: a.onNotice,
    downgrade400: (errText, reqBody) => {
      if (!/cache_control|ephemeral/i.test(errText)) return null;
      try {
        return JSON.stringify(stripCacheControl(JSON.parse(reqBody)));
      } catch {
        return null;
      }
    },
  });
  if (!res.ok) throw await httpError(res);

  const ctx: SseCtx = { a, accs: new Map(), outChars: 0, answerText: '', terminal: false, semanticError: false };
  const usage: UsageWithCache = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let cacheRead = 0;
  let cacheCreation = 0;
  let sawRealUsage = false;
  let stop: StopReason = 'end_turn';
  let thinkingText = '';
  let thinkingSignature = '';

  let streamDropErr: unknown = null;
  try {
  await readSseLines(res, (payload) => {
    if (!payload || payload === '[DONE]') return;
    let ev: {
      type?: string;
      index?: number;
      message?: { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };
      content_block?: { type?: string; id?: string; name?: string };
      delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string; thinking?: string; signature?: string };
      usage?: { output_tokens?: number; input_tokens?: number };
      error?: { message?: string };
    };
    try {
      ev = JSON.parse(payload);
    } catch {
      return;
    }
    switch (ev.type) {
      case 'message_start': {
        const u = ev.message?.usage;
        if (typeof u?.input_tokens === 'number') {
          usage.inputTokens = u.input_tokens;
          sawRealUsage = true;
        }
        // Cache reads are billed at 10% of input, cache writes at 125%.
        // Keep the raw split for the weighted cost below; the display meter
        // still counts them as prompt input (total tokens processed).
        if (typeof u?.cache_read_input_tokens === 'number') {
          cacheRead = u.cache_read_input_tokens;
          usage.inputTokens += u.cache_read_input_tokens;
          sawRealUsage = true;
        }
        if (typeof u?.cache_creation_input_tokens === 'number') {
          cacheCreation = u.cache_creation_input_tokens;
          usage.inputTokens += u.cache_creation_input_tokens;
          sawRealUsage = true;
        }
        // v11.9 (E15) — EARLY partial-usage snapshot: input tokens are known at
        // message_start, long before the stream ends. Forwarding them now lets
        // the engine report a FAILED turn's real usage instead of a stale
        // previous-turn figure. The final flush below still fires on success.
        if (sawRealUsage && usage.inputTokens > 0) {
          a.onUsage?.({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: 0 });
        }
        break;
      }
      case 'content_block_start': {
        if (ev.content_block?.type === 'tool_use') {
          ctx.accs.set(ev.index ?? 0, {
            id: ev.content_block.id,
            name: ev.content_block.name ?? '',
            json: '',
            lastEmit: 0,
          });
        }
        break;
      }
      case 'content_block_delta': {
        const d = ev.delta ?? {};
        if (d.type === 'text_delta' && typeof d.text === 'string' && d.text) {
          ctx.outChars += d.text.length;
          ctx.answerText += d.text; // v11.26 — resume prefix if the stream drops
          a.onText(d.text);
        } else if (d.type === 'thinking_delta' && typeof d.thinking === 'string' && d.thinking) {
          // Extended-thinking trace — streamed to the engine (UI marker tags),
          // never mixed into the answer text.
          thinkingText += d.thinking;
          a.onThinking?.(d.thinking);
        } else if (d.type === 'signature_delta' && typeof d.signature === 'string' && d.signature) {
          thinkingSignature += d.signature;
        } else if (d.type === 'input_json_delta' && typeof d.partial_json === 'string' && d.partial_json) {
          const acc = ctx.accs.get(ev.index ?? 0);
          if (acc) {
            acc.json += d.partial_json;
            maybeEmitToolUse(ctx, ev.index ?? 0);
          }
        }
        break;
      }
      case 'content_block_stop': {
        // Block finished — emit the complete JSON for this tool call.
        const acc = ctx.accs.get(ev.index ?? 0);
        if (acc && acc.name) a.onToolUse(acc.id ?? tempToolId(ev.index ?? 0), acc.name, acc.json);
        break;
      }
      case 'message_delta': {
        // v11.9 (E3) — pause_turn → 'paused', refusal → 'refusal' (see
        // mapAnthropicStopReason); every other reason keeps the old mapping.
        if (ev.delta?.stop_reason) {
          stop = mapAnthropicStopReason(ev.delta.stop_reason);
          ctx.terminal = true; // completion signal — the answer is finished
        }
        if (typeof ev.usage?.output_tokens === 'number') {
          usage.outputTokens = ev.usage.output_tokens; // cumulative
          sawRealUsage = true;
        }
        // Some gateways echo input here — it is the RAW input figure, so
        // re-attach the cache split instead of clobbering it.
        if (typeof ev.usage?.input_tokens === 'number' && ev.usage.input_tokens > 0) {
          usage.inputTokens = ev.usage.input_tokens + cacheRead + cacheCreation;
          sawRealUsage = true;
        }
        break;
      }
      case 'message_stop':
        // Stream complete; remaining buffered lines are ignored by design.
        ctx.terminal = true;
        break;
      case 'error':
        // v11.23 — a mid-stream `error` event is untrusted: sanitize its
        // message so a JSON payload can never land in the UI.
        // v11.26 — mark it semantic so the drop-recovery wrapper NEVER
        // swallows a real provider error as an "incomplete stream".
        ctx.semanticError = true;
        throw new Error(sanitizeErrorText(ev.error?.message) || 'Anthropic stream error.');
      default:
        break; // 'ping' and unknown events are ignored
    }
  }, () => a.onHeartbeat?.());
  } catch (err) {
    // v11.26 — only a TRANSPORT death is recoverable. Semantic provider error
    // events and caller aborts (user stop / engine idle watchdog) are rethrown
    // unchanged — never disguised as an "incomplete stream".
    if (a.signal.aborted || ctx.semanticError || !isStreamDropError(err)) throw err;
    streamDropErr = err;
  }
  if (!ctx.terminal) {
    throw new StreamDroppedError({
      cause: streamDropErr,
      partialText: ctx.answerText,
      partialThinking: thinkingText,
      partialSignature: thinkingSignature,
      depth: continuationDepth(a),
      partialToolCall: ctx.accs.size > 0,
    });
  }

  flushToolUse(ctx);
  const finalUsage: UsageWithCache =
    sawRealUsage && (usage.inputTokens > 0 || usage.outputTokens > 0)
      ? usage
      : estimateUsage(a, ctx.outChars);
  if (sawRealUsage) {
    // Weighted billing: full-rate input + 10% cache reads + 125% cache writes.
    finalUsage.costUsd = estimateCostDetailed(
      a.model.provider,
      a.model.model,
      Math.max(0, finalUsage.inputTokens - cacheRead - cacheCreation),
      finalUsage.outputTokens,
      cacheRead,
      cacheCreation,
    ).costUsd;
    finalUsage.cacheReadTokens = cacheRead;
    finalUsage.cacheCreationTokens = cacheCreation;
  }
  a.onUsage?.(finalUsage);
  return {
    stopReason: stop,
    usage: finalUsage,
    ...(thinkingText ? { thinking: thinkingText, thinkingSignature } : {}),
  };
}

// ============================================================
// OpenAI-compatible protocol (openai, openrouter, ollama, gemini,
// zai, deepseek, custom)
// ============================================================

interface OpenAIMsg {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[] | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  /** Anthropic-style explicit cache marker (OpenRouter / Qwen / Gemini via OpenRouter). Unknown fields are ignored by other gateways. */
  cache_control?: { type: 'ephemeral'; ttl?: '1h' };
}

interface OpenAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
  /** Anthropic-style explicit cache marker on a TEXT BLOCK — place only on the byte-stable system prefix. */
  cache_control?: { type: 'ephemeral'; ttl?: '1h' };
}

/**
 * v11.16 (LATENCY) — must stay byte-identical to `SYSTEM_CACHE_SPLIT` in
 * prompts.ts. Everything before it is word-stable across turns (cacheable);
 * everything after it is the dynamic tail (clock, memory, project context).
 */
export const SYSTEM_CACHE_SPLIT = '\n\n<!--SURNIA:STATIC_END-->\n\n';

/** Split a rendered system prompt into its cacheable prefix and dynamic tail. */
export function splitSystemPrompt(system: string): { stable: string; dynamic: string; hasSplit: boolean } {
  const at = system.indexOf(SYSTEM_CACHE_SPLIT);
  if (at < 0) return { stable: system, dynamic: '', hasSplit: false };
  return {
    stable: system.slice(0, at),
    dynamic: system.slice(at + SYSTEM_CACHE_SPLIT.length),
    hasSplit: true,
  };
}

/** Endpoints that rejected an explicit cache_control field on a 400 (sticky opt-out). */
const cacheControlRejected = new Set<string>();
function cacheEndpointKey(a: StreamArgs): string {
  return `${a.model.provider}|${a.baseUrl?.trim() || ''}|${a.model.model}`;
}
/** Test-only: clear the sticky rejection set (production never calls this). */
export function resetCacheControlRejections(): void {
  cacheControlRejected.clear();
}

/**
 * v11.18 — A strict gateway can 422 on a SINGLE malformed tool schema. When it
 * does, we drop only that one tool (from `detail[].loc`) and remember its name
 * per endpoint so it is never re-sent. This is deliberately NOT a fixed-size
 * tool subset: every other tool must stay available (the founder requires the
 * full capability surface to be preserved).
 */
const skippedToolsByEndpoint = new Map<string, Set<string>>();
function skippedToolsFor(endpoint: string): Set<string> | undefined {
  return skippedToolsByEndpoint.get(endpoint);
}
function rememberSkippedTool(endpoint: string, name: string): void {
  let set = skippedToolsByEndpoint.get(endpoint);
  if (!set) {
    set = new Set<string>();
    skippedToolsByEndpoint.set(endpoint, set);
  }
  set.add(name);
}
/** Test-only: clear the per-endpoint skipped-tool set (production never calls this). */
export function resetSkippedTools(): void {
  skippedToolsByEndpoint.clear();
}

/**
 * Extract the ONE tool index a Pydantic/FastAPI 422 points at, from a
 * validation-error `loc` such as `["body","tools",147,"WebSearchTool","type"]`
 * (or a dotted string like `body.tools.147.type`). Returns -1 when no loc can
 * be parsed — the caller must then propagate the honest error and drop nothing.
 */
export function toolIndexFromValidationError(errText: string): number {
  try {
    const parsed = JSON.parse(errText) as unknown;
    if (!parsed || typeof parsed !== 'object') return -1;
    const root = parsed as Record<string, unknown>;
    const details = Array.isArray(root.detail) ? root.detail
      : Array.isArray(root.errors) ? root.errors
      : [];
    for (const entry of details) {
      const loc = (entry as { loc?: unknown } | null)?.loc;
      if (Array.isArray(loc)) {
        for (let i = 0; i < loc.length - 1; i++) {
          if (loc[i] === 'tools') {
            const idx = loc[i + 1];
            if (typeof idx === 'number' && Number.isInteger(idx) && idx >= 0) return idx;
            if (typeof idx === 'string' && /^\d+$/.test(idx)) return Number(idx);
          }
        }
      } else if (typeof loc === 'string') {
        const m = /(?:^|\.)tools\.(\d+)(?:\.|$)/.exec(loc);
        if (m) return Number(m[1]);
      }
    }
  } catch { /* not a parseable validation payload — no index */ }
  return -1;
}

/**
 * Remove exactly one tool (at `index`) from a serialized OpenAI-compat body
 * and remember its name as skipped for this endpoint. Returns null when the
 * body/loc cannot be reconciled, so the original 422 surfaces unchanged.
 */
function dropSingleRejectedTool(reqBody: string, index: number, endpoint: string): string | null {
  try {
    const obj = JSON.parse(reqBody) as Record<string, unknown>;
    if (!Array.isArray(obj.tools) || index >= obj.tools.length || index < 0) return null;
    const removed = obj.tools[index] as { function?: { name?: unknown } } | null;
    const name = typeof removed?.function?.name === 'string' ? removed.function.name : '';
    obj.tools.splice(index, 1); // ONE tool — never a fixed-size slice
    if (name) rememberSkippedTool(endpoint, name);
    return JSON.stringify(obj);
  } catch {
    return null;
  }
}

/** True when a 400 error text points at the cache_control field. */
function isCacheControlRejection(text: string): boolean {
  return /cache_control|ephemeral|extra[_ ]forbidden|extra inputs|additional propert|unrecognized|unknown field|unexpected (field|key|parameter)|Extra inputs are not permitted/i.test(text);
}

/**
 * Restore the pre-v11.16 wire shape for a gateway that rejected cache_control:
 * strip every marker and merge the two system messages back into one.
 */
function downgradeOpenAICache(reqBody: string): string | null {
  try {
    const stripped = stripCacheControl(JSON.parse(reqBody)) as Record<string, unknown>;
    const msgs = stripped.messages;
    if (Array.isArray(msgs)) {
      const systems = msgs.filter((m) => m && (m as OpenAIMsg).role === 'system') as OpenAIMsg[];
      if (systems.length > 1) {
        const merged: OpenAIMsg = {
          role: 'system',
          content: systems.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n\n'),
        };
        stripped.messages = [merged, ...msgs.filter((m) => !(m && (m as OpenAIMsg).role === 'system'))];
      }
    }
    return JSON.stringify(stripped);
  } catch {
    return null;
  }
}

/** Parse `data:<mime>;base64,<data>` — returns null for anything else. */
function parseDataUrl(url: string): { mime: string; data: string } | null {
  const m = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (!m) return null;
  return { mime: m[1] === 'image/jpg' ? 'image/jpeg' : m[1], data: m[2] };
}

/**
 * Map normalized messages → OpenAI-compatible messages. Exported for the
 * v11.15 message-contract tests (production calls it via `streamOpenAICompat`).
 */
export function toOpenAIMessages(
  system: string,
  msgs: ProviderMsg[],
  options: { cache?: boolean } = {},
): OpenAIMsg[] {
  const split = splitSystemPrompt(system);
  const out: OpenAIMsg[] = [];
  if (options.cache && split.hasSplit) {
    // v11.16 — TWO system messages: the first is the byte-stable prefix and
    // carries the cache_control marker; the second is the dynamic tail and is
    // never cached. Content stays a plain STRING so every existing consumer of
    // `messages.find(m => m.role === 'system').content` keeps working.
    out.push({ role: 'system', content: split.stable, cache_control: { type: 'ephemeral' } });
    if (split.dynamic) out.push({ role: 'system', content: split.dynamic });
  } else {
    out.push({ role: 'system', content: system.replace(SYSTEM_CACHE_SPLIT, '\n\n') });
  }
  // v11.15 — a `tool` message is only legal when a preceding assistant message
  // declared the matching tool_call id. Track ids as we emit them; drop orphan
  // results instead of sending a body the gateway rejects with HTTP 400.
  const declaredCalls = new Set<string>();
  for (const m of msgs) {
    if (m.role === 'user') {
      const imgs = m.images ?? [];
      if (imgs.length) {
        const parts: OpenAIContentPart[] = [{ type: 'text', text: m.text }];
        for (const img of imgs) {
          if (parseDataUrl(img)) parts.push({ type: 'image_url', image_url: { url: img } });
        }
        out.push({ role: 'user', content: parts });
      } else {
        out.push({ role: 'user', content: m.text });
      }
    } else if (m.role === 'assistant') {
      // v11.15 (MESSAGE-CONTRACT) — HONOR the last-hop contract: an assistant
      // message MUST carry content or tool_calls, never neither. The reported
      // production 400 ("Assistant message must have either content or
      // tool_calls, but not none", code 3240) came from an assistant message
      // with an empty/undefined text and no calls (e.g. the max_tokens
      // continuation pushing `{ text: visibleText }` while visibleText === '',
      // or a thinking-only message whose thinking is not sent on this wire).
      //
      // We ALWAYS emit a non-empty content string. A single space is a benign
      // text block that satisfies every provider: OpenRouter accepts null
      // content with tool_calls, but several OpenAI-compat gateways reject it,
      // and no provider rejects a legit text block next to tool_calls. This
      // also fixes the tool loop where `{toolCalls:[...], text: undefined}`
      // used to serialize as `content: null`.
      const hasCalls = Boolean(m.toolCalls?.length);
      const text = typeof m.text === 'string' && m.text.trim().length > 0 ? m.text : ' ';
      const toolCalls = hasCalls
        ? m.toolCalls!.map((tc) => {
            declaredCalls.add(tc.id);
            return {
              id: tc.id,
              type: 'function' as const,
              // v11.15 — never forward an empty or truncated args string.
              function: { name: tc.name, arguments: safeToolArguments(tc.args) },
            };
          })
        : undefined;
      out.push({
        role: 'assistant',
        content: text,
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      });
    } else {
      // tool_result — only emit when paired with a declared tool_call id.
      if (!declaredCalls.has(m.callId)) continue;
      // v11.16 — some OpenAI-compat gateways also reject an empty `tool`
      // content string; a benign placeholder keeps every message legal.
      const toolContent = typeof m.content === 'string' && m.content.length > 0
        ? m.content
        : '(empty tool result)';
      out.push({ role: 'tool', tool_call_id: m.callId, content: toolContent });
    }
  }
  return out;
}

// v11.4 — stateful <think>…</think> splitter for OpenAI-compatible streams.
// Models like Qwen3, deepseek-r1 (via Ollama) and generic gateways inline
// their reasoning as literal <think>…</think> spans inside delta.content.
// That text is REASONING: the splitter strips the spans and routes the inner
// text to onThinking, never the answer channel. Chunks that split a tag
// mid-way are handled by holding back a possible partial-tag suffix; content
// that carries no tags passes through byte-for-byte.
function createThinkSplitter(onText: (t: string) => void, onThinking: (t: string) => void) {
  const OPEN = '<think>';
  const CLOSE = '</think>';
  const HOLD = CLOSE.length - 1; // longest partial-tag suffix we must retain
  let buf = '';
  let inThink = false;
  /** Longest suffix of s that is a proper prefix of either tag (0 = none). */
  const partialTag = (s: string): number => {
    for (let n = Math.min(HOLD, s.length); n > 0; n--) {
      const suf = s.slice(-n);
      if (OPEN.startsWith(suf) || CLOSE.startsWith(suf)) return n;
    }
    return 0;
  };
  const emit = (t: string): void => {
    if (t) (inThink ? onThinking : onText)(t);
  };
  return {
    /** Feed one content delta; emits everything that is unambiguous. */
    push(chunk: string): void {
      buf += chunk;
      for (;;) {
        if (inThink) {
          const end = buf.indexOf(CLOSE);
          if (end < 0) {
            const keep = partialTag(buf);
            emit(buf.slice(0, buf.length - keep));
            buf = buf.slice(buf.length - keep);
            return;
          }
          emit(buf.slice(0, end));
          buf = buf.slice(end + CLOSE.length);
          inThink = false;
          continue;
        }
        const start = buf.indexOf(OPEN);
        if (start < 0) {
          const keep = partialTag(buf);
          emit(buf.slice(0, buf.length - keep));
          buf = buf.slice(buf.length - keep);
          return;
        }
        emit(buf.slice(0, start));
        buf = buf.slice(start + OPEN.length);
        inThink = true;
      }
    },
    /** Stream over: flush any held-back tail (never a complete tag). */
    flush(): void {
      emit(buf);
      buf = '';
    },
  };
}

/**
 * v11.35 — PURE wire-shape builder for OpenAI-compatible `tools[]`. Every def
 * is forwarded: native defs in their native shape, all others as functions.
 * `cache_control` is attached to the LAST FUNCTION tool only — native tool
 * objects must not be polluted with a field the provider does not accept.
 * Exported so the v11.35 pass-through test asserts on the exact wire array.
 */
export function buildOpenAITools(defs: ToolDef[], provider: ProviderId, cacheControl = false): Record<string, unknown>[] {
  let lastFunctionIndex = -1;
  for (let i = 0; i < defs.length; i++) if (!isNativeTool(defs[i])) lastFunctionIndex = i;
  return defs.map((d, i) => {
    const native = toOpenAINativeTool(d, provider);
    if (native) return native;
    // A native tool scoped to a DIFFERENT provider family is still advertised
    // (never dropped), but its description says so honestly — a call returns
    // an explicit unsupported result instead of a silent failure.
    const mismatch = isNativeTool(d)
      ? ` [native tool '${(d.native as NativeToolSpec).type}' is scoped to another provider family; this provider may not execute it — the app reports an honest unsupported result if called.]`
      : '';
    const fn: Record<string, unknown> = {
      type: 'function',
      function: { name: d.name, description: d.description + mismatch, parameters: d.parameters },
    };
    if (cacheControl && i === lastFunctionIndex) fn.cache_control = { type: 'ephemeral' };
    return fn;
  });
}

/**
 * v11.35 — PURE wire-shape builder for Anthropic `tools[]`. Native defs become
 * Anthropic server-side tool blocks; every other def keeps the standard
 * `{name, description, input_schema}` shape. Cache breakpoint goes on the last
 * NON-NATIVE tool so a native block is never sent a foreign field.
 */
export function buildAnthropicTools(defs: ToolDef[], cacheControl = false): Record<string, unknown>[] {
  let lastStandardIndex = -1;
  for (let i = 0; i < defs.length; i++) if (!isNativeTool(defs[i])) lastStandardIndex = i;
  return defs.map((d, i) => {
    const native = toAnthropicNativeTool(d);
    if (native) return native;
    const mismatch = isNativeTool(d)
      ? ` [native tool '${(d.native as NativeToolSpec).type}' is scoped to another provider family; this provider may not execute it — the app reports an honest unsupported result if called.]`
      : '';
    const tool: Record<string, unknown> = {
      name: d.name,
      description: d.description + mismatch,
      input_schema: d.parameters,
    };
    if (cacheControl && i === lastStandardIndex) tool.cache_control = { type: 'ephemeral' };
    return tool;
  });
}

/**
 * v11.16 (LATENCY) — build the full OpenAI-compatible request body. Pure and
 * exported so the message-contract / cache tests assert on the exact wire body.
 * Adds Anthropic-style `cache_control` breakpoints on:
 *   • the STABLE system-prefix text block (never the dynamic tail), and
 *   • the last tool definition (the largest, byte-stable block).
 * Providers that do not understand the field ignore it; gateways that 400 on
 * it are handled by `downgrade400` + a sticky opt-out in streamOpenAICompat.
 */
/**
 * v1138 — per-model effort descriptor with the real OpenRouter capability
 * signal (when a live catalog row exists). Exported for the effort suite so a
 * test can prove the slider value reaches the exact wire field.
 */
export function effortDescriptorFor(provider: ProviderId, model: string): EffortDescriptor {
  const signal = provider === 'openrouter' ? openrouterEffortSignalFor(model) : null;
  return effortLevelsFor(provider, model, signal);
}

export function buildOpenAIRequestBody(a: StreamArgs): { body: Record<string, unknown>; cacheControl: boolean } {
  const cacheControl = a.promptCaching !== false && !cacheControlRejected.has(cacheEndpointKey(a));
  const model = a.model.model;
  const useMaxCompletionTokens = /^(o\d|gpt-5)/.test(model) || /\/(gpt-5|o\d)/.test(model);
  const body: Record<string, unknown> = {
    model,
    messages: toOpenAIMessages(a.system, a.messages, { cache: cacheControl }),
    stream: true,
  };
  // OpenRouter documents a top-level Anthropic-style directive (= automatic
  // prefix caching with sticky routing). Combined with the explicit marker on
  // the stable system message and the last tool, this makes the cache hit on
  // the byte-identical prefix while the dynamic tail changes every turn.
  if (cacheControl) body.cache_control = { type: 'ephemeral' };
  if (a.model.provider !== 'ollama') body.stream_options = { include_usage: true };
  body[useMaxCompletionTokens ? 'max_completion_tokens' : 'max_tokens'] =
    a.model.maxTokens ?? defaultMaxTokensFor(a.model.model);
  if (typeof a.model.temperature === 'number') body.temperature = a.model.temperature;
  // v1138 + v1142 — the REAL named stop is applied to the provider's own wire
  // field. GPT/o-series/GLM → `reasoning_effort`; OpenRouter → its reported
  // capability (`reasoning_effort` or `reasoning.effort`); unknown → no field.
  const desc = effortDescriptorFor(a.model.provider, model);
  if (a.model.reasoning && a.model.reasoning !== 'off') {
    const level = normalizeEffortLevel(desc, a.model.reasoning);
    // v1142 — drive the safety gate from the DESCRIPTOR, not a model-id regex.
    // The old regex forgot gpt-6-*/glm-* on their native providers, so those
    // sliders were decorative (the founder's "no difference" complaint).
    // A curated/unknown family on a generic gateway still gets NO invented
    // field; a known family (or a catalog-confirmed capability) really sends.
    const knownReasoningModel = /(^|\/)(o\d|gpt-5|gpt-6)|reasoner|r1|thinking/i.test(model);
    const trustedFamily = desc.source === 'provider-catalog'
      || (desc.family !== 'generic' && desc.param !== 'none'
          && desc.param !== 'thinking.budget_tokens');
    if (trustedFamily || a.model.provider === 'openai' || a.model.provider === 'openrouter'
        || useMaxCompletionTokens || knownReasoningModel) {
      Object.assign(body, effortWireFor(desc, level));
    }
  }
  const tuning = tuningOf(a);
  if (tuning.topP !== undefined) body.top_p = tuning.topP;
  if (tuning.stop?.length) body.stop = tuning.stop;
  const skippedTools = skippedToolsFor(cacheEndpointKey(a));
  const usableTools = skippedTools?.size
    ? a.tools.filter((t) => !skippedTools.has(t.name))
    : a.tools;
  if (usableTools.length) {
    // v11.35 — FORWARD EVERY TOOL IN ITS HONEST WIRE SHAPE. Provider-native
    // tools (web_search / code_interpreter / computer_use / …) keep their
    // native `{type:'…'}` descriptor; everything else stays an ordinary
    // function tool. A native tool is NEVER downgraded to a fake function the
    // provider would not execute, and NEVER dropped for being "unknown".
    const tools = buildOpenAITools(usableTools, a.model.provider, cacheControl);
    body.tools = tools;
    // tool_choice is meaningful only when at least one function tool is present.
    if (tools.some((t) => t.type === 'function')) body.tool_choice = 'auto';
    if (typeof tuning.parallelToolCalls === 'boolean') body.parallel_tool_calls = tuning.parallelToolCalls;
  }
  if (a.model.provider === 'openrouter') body.usage = { include: true };
  return { body, cacheControl };
}

async function streamOpenAICompat(a: StreamArgs): Promise<StreamResult> {
  let base = (a.baseUrl?.trim() || DEFAULT_BASE_URLS[a.model.provider] || DEFAULT_BASE_URLS.openai).replace(/\/+$/, '');
  // Heuristic: a bare origin (no path) almost certainly needs '/v1'.
  try {
    const u = new URL(base);
    if (u.pathname === '' || u.pathname === '/') base += '/v1';
  } catch {
    /* keep as provided */
  }

  // v11.16 — build the wire body via the exported pure helper (cache markers
  // on the stable system prefix + last tool), then send it.
  const { body, cacheControl } = buildOpenAIRequestBody(a);

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (a.apiKey) headers.authorization = 'Bearer ' + a.apiKey; // omitted when keyless (ollama)
  if (a.model.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://surnia.app';
    headers['X-Title'] = 'Surnia';
  }

  const res = await postJsonWithRetry({
    url: base + '/chat/completions',
    headers,
    body: JSON.stringify(body),
    signal: a.signal,
    maxRetries: a.maxRetries ?? 2,
    maxRateLimitRetries: maxRateLimitRetriesOf(a),
    onNotice: a.onNotice,
    downgrade400: (errText, reqBody) => {
      // Gateway rejects an explicit cache marker → strip it for this call and
      // remember the endpoint so we never pay the extra 400 round-trip again.
      if (cacheControl && isCacheControlRejection(errText)) {
        cacheControlRejected.add(cacheEndpointKey(a));
        return downgradeOpenAICache(reqBody);
      }
      // v11.18 — a strict gateway can 422 on ONE tool schema it cannot parse
      // (Pydantic `literal_error` / `extra_forbidden`, e.g. tools[147]).
      // Drop ONLY the offending tool, using the index from
      // the validation error's `loc`, and remember its name for this endpoint.
      // NEVER narrow the list to a fixed count: every other tool stays live.
      // If the loc cannot be parsed, drop nothing and surface the honest error.
      const badToolIndex = toolIndexFromValidationError(errText);
      if (badToolIndex >= 0) {
        const replacement = dropSingleRejectedTool(reqBody, badToolIndex, cacheEndpointKey(a));
        if (replacement != null) return replacement;
      }
      return /reasoning/i.test(errText) ? stripReasoningParams(reqBody) : null;
    },
  });
  if (!res.ok) throw await httpError(res);

  const ctx: SseCtx = { a, accs: new Map(), outChars: 0, answerText: '', terminal: false, semanticError: false };
  const usage: UsageWithCache = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let sawRealUsage = false;
  let providerCost = 0; // OpenRouter's own computed cost (usage.include)
  let stop: StopReason = 'end_turn';
  let thinkingTextForOpenAI = ''; // v11.26 — thinking prefix for a dropped stream
  // v11.9 (E7) — accumulator slot of the LAST tool_call delta that arrived
  // without an `index`: argument-only continuations append to it.
  let lastNoIndexKey = -1;
  // v11.4 — strips inline <think>…</think> reasoning from delta.content and
  // routes it to onThinking (outChars already counted the raw delta above).
  const thinkSplit = createThinkSplitter(
    (t) => {
      ctx.answerText += t; // v11.26 — answer-only resume prefix ( thinkers routed separately)
      a.onText(t);
    },
    (t) => {
      thinkingTextForOpenAI += t;
      a.onThinking?.(t);
    },
  );

  let streamDropErr: unknown = null;
  try {
  await readSseLines(res, (payload) => {
    if (!payload) return;
    if (payload === '[DONE]') {
      ctx.terminal = true; // OpenAI completion marker — the answer finished
      return;
    }
    let obj: {
      error?: { message?: string };
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        cost?: number;
        prompt_tokens_details?: { cached_tokens?: number } | null;
      } | null;
      choices?: {
        delta?: {
          content?: string | null;
          reasoning_content?: string | null;
          reasoning?: string | null;
          tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
        };
        finish_reason?: string | null;
      }[];
    };
    try {
      obj = JSON.parse(payload);
    } catch {
      return;
    }
    if (obj.error) {
      // v11.23 — same JSON-leak guard as the Anthropic error event.
      // v11.26 — never misclassify a semantic error event as a stream drop.
      ctx.semanticError = true;
      throw new Error(sanitizeErrorText(obj.error.message) || 'Provider stream error.');
    }

    // The final SSE chunk carries usage (OpenAI stream_options / OpenRouter
    // usage.include); intermediate chunks without usage are ignored.
    if (obj.usage) {
      usage.inputTokens = obj.usage.prompt_tokens ?? usage.inputTokens;
      usage.outputTokens = obj.usage.completion_tokens ?? usage.outputTokens;
      sawRealUsage = true;
      if (typeof obj.usage.cost === 'number' && obj.usage.cost > 0) providerCost = obj.usage.cost;
      const cached = obj.usage.prompt_tokens_details?.cached_tokens;
      if (typeof cached === 'number' && cached > 0) usage.cacheReadTokens = cached; // informational split
      // v11.9 (E15) — forward the usage chunk as soon as it arrives so the
      // engine can report a failed turn's real usage (final flush below still
      // fires on success).
      if (usage.inputTokens > 0 || usage.outputTokens > 0) {
        a.onUsage?.({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: 0 });
      }
    }

    const choice = obj.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? {};
    if (typeof delta.content === 'string' && delta.content) {
      ctx.outChars += delta.content.length;
      // v11.4 — literal <think>…</think> inline in content (Qwen3, R1 via
      // Ollama, generic gateways) is reasoning: the splitter strips the spans
      // and routes the inner text to onThinking; tag-free content passes
      // through byte-for-byte.
      thinkSplit.push(delta.content);
    }
    // reasoning_content (DeepSeek-R1, OpenRouter reasoning models): thinking
    // trace — surfaced through onThinking so the engine can stream it as
    // <thinking> blocks, never mixed into the answer text.
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      thinkingTextForOpenAI += delta.reasoning_content;
      a.onThinking?.(delta.reasoning_content);
    } else if (typeof delta.reasoning === 'string' && delta.reasoning) {
      thinkingTextForOpenAI += delta.reasoning;
      a.onThinking?.(delta.reasoning);
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        if (typeof tc.index === 'number') {
          // Index-based path — providers that send `index` (unchanged).
          const index = tc.index;
          let acc = ctx.accs.get(index);
          if (!acc) {
            acc = { name: '', json: '', lastEmit: 0 };
            ctx.accs.set(index, acc);
          }
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (typeof tc.function?.arguments === 'string' && tc.function.arguments) {
            acc.json += tc.function.arguments;
            maybeEmitToolUse(ctx, index);
          }
          lastNoIndexKey = index;
          continue;
        }
        // v11.9 (E7) — INDEX-LESS deltas: the old code folded EVERY call into
        // accumulator 0, concatenating parallel calls' arguments into one
        // blob. Now: a delta carrying a NEW tool id/name opens a fresh
        // accumulator (id match first, then name match); an argument-only
        // continuation (no id/name) appends to the LAST opened accumulator.
        let acc: ToolAcc | undefined;
        let key = -1;
        if (tc.id) {
          for (const [k, a] of ctx.accs) {
            if (a.id === tc.id) {
              acc = a;
              key = k;
              break;
            }
          }
        } else if (tc.function?.name) {
          for (const [k, a] of ctx.accs) {
            if (a.name === tc.function.name) {
              acc = a; // prefer the MOST RECENT same-name accumulator
              key = k;
            }
          }
        } else if (lastNoIndexKey >= 0) {
          acc = ctx.accs.get(lastNoIndexKey);
          key = lastNoIndexKey;
        }
        if (!acc) {
          let fresh = 0;
          while (ctx.accs.has(fresh)) fresh++; // next free accumulator slot
          key = fresh;
          acc = { name: '', json: '', lastEmit: 0 };
          ctx.accs.set(key, acc);
        }
        if (tc.id && !acc.id) acc.id = tc.id;
        if (tc.function?.name && !acc.name) acc.name = tc.function.name;
        if (typeof tc.function?.arguments === 'string' && tc.function.arguments) {
          acc.json += tc.function.arguments;
          maybeEmitToolUse(ctx, key);
        }
        lastNoIndexKey = key;
      }
    }
    if (choice.finish_reason) {
      // v11.9 (E10) — content_filter is now a distinct stop reason (see
      // mapOpenAIFinishReason); 'stop' and unknown reasons still map to
      // 'end_turn'.
      stop = mapOpenAIFinishReason(choice.finish_reason);
      ctx.terminal = true; // completion signal — the answer is finished
    }
  }, () => a.onHeartbeat?.());
  } catch (err) {
    if (a.signal.aborted || ctx.semanticError || !isStreamDropError(err)) throw err;
    streamDropErr = err;
  }
  if (!ctx.terminal) {
    throw new StreamDroppedError({
      cause: streamDropErr,
      partialText: ctx.answerText,
      partialThinking: thinkingTextForOpenAI,
      partialSignature: '',
      depth: continuationDepth(a),
      partialToolCall: ctx.accs.size > 0,
    });
  }

  thinkSplit.flush(); // release any held-back partial-tag tail
  flushToolUse(ctx);
  const finalUsage =
    sawRealUsage && (usage.inputTokens > 0 || usage.outputTokens > 0)
      ? usage
      : estimateUsage(a, ctx.outChars);
  if (sawRealUsage) {
    if (providerCost > 0) {
      // OpenRouter computed the real cost server-side — trust it.
      finalUsage.costUsd = Math.round(providerCost * 1e6) / 1e6;
    } else {
      // Conservative: cached-input discounts vary by vendor (OpenAI ≈50%,
      // DeepSeek ≈90%, others none) — bill everything at the full input rate.
      finalUsage.costUsd = estimateCostDetailed(
        a.model.provider,
        a.model.model,
        finalUsage.inputTokens,
        finalUsage.outputTokens,
      ).costUsd;
    }
  }
  a.onUsage?.(finalUsage);
  return { stopReason: stop, usage: finalUsage };
}

// ============================================================
// Entry point — bounded failover (v11.16 LATENCY)
// ============================================================

const DEFAULT_FAILOVER_BUDGET_MS = 15_000;

/** Total wall-clock budget for all FAILED providers in one turn (env-tunable). */
export function failoverBudgetMs(): number {
  const raw = Number(process.env.SURNIA_PROVIDER_FAILOVER_BUDGET_MS);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_FAILOVER_BUDGET_MS;
}

/**
 * v11.26 (CONTINUITY) — single entry point for a provider turn, with a BOUNDED
 * transparent recovery for mid-answer stream drops.
 *
 * When a stream dies after showing partial answer text (and it was not a user
 * abort / engine idle-watchdog abort), we re-send the SAME conversation with an
 * assistant prefix holding ONLY the already-shown text/thinking plus a short
 * "continue" instruction. The user's prompt is never re-asked as a new task and
 * no already-streamed delta is replayed — only new deltas flow to onText.
 *
 * The retry is counted (MAX_STREAM_CONTINUATIONS), not wall-clock bounded: a
 * healthy stream is never cut off here. Beyond the bound, or when the drop
 * happened before any visible output, the classified StreamDroppedError is
 * surfaced (with a visible notice) so the engine's stream-drop auto-continue
 * and honest error rows take over — never a blank 'end_turn'.
 */
async function routeStream(a: StreamArgs): Promise<StreamResult> {
  const fn = a.model.provider === 'anthropic' ? streamAnthropic : streamOpenAICompat;
  try {
    return await fn(a);
  } catch (err) {
    if (!(err instanceof StreamDroppedError)) throw err;
    const depth = continuationDepth(a);
    const hasPartial = err.partialText.length > 0 || err.partialThinking.length > 0;
    // A tool call was in flight — NEVER resume from the provider layer: the
    // re-sent assistant prefix could re-execute a side-effecting tool. Surface
    // it and let the engine's transcript-safe auto-continue handle it ONCE.
    if (err.partialToolCall) {
      a.onNotice?.({
        kind: 'stream_incomplete',
        provider: a.model.provider,
        model: a.model.model,
        // Keep the notice calm and user-facing: never forward the raw stall
        // wording (or any payload) into sys_notice; the classified error row
        // still carries the precise reason if recovery ultimately fails.
        text: `${a.model.provider} connection did not complete — resuming the same task.`,
      });
      throw err;
    }
    if (a.signal.aborted || depth >= MAX_STREAM_CONTINUATIONS || !hasPartial) {
      a.onNotice?.({
        kind: 'stream_incomplete',
        provider: a.model.provider,
        model: a.model.model,
        // Keep the notice calm and user-facing: never forward the raw stall
        // wording (or any payload) into sys_notice; the classified error row
        // still carries the precise reason if recovery ultimately fails.
        text: `${a.model.provider} connection did not complete — resuming the same task.`,
      });
      throw err;
    }
    a.onNotice?.({
      kind: 'stream_recovered',
      provider: a.model.provider,
      model: a.model.model,
      text: `${a.model.provider} connection dropped mid-answer — resuming from the last streamed token without restarting the task.`,
    });
    // Build the resume prefix from ONLY what the user already saw. Thinking
    // is resent on Anthropic only when a valid signature was captured (the API
    // rejects unsigned thinking blocks). The final user turn is a short
    // continuation instruction, NOT the original prompt.
    const tail: ProviderMsg[] = [];
    if (err.partialThinking && err.partialSignature) {
      tail.push({
        role: 'assistant',
        thinking: err.partialThinking,
        thinkingSignature: err.partialSignature,
      });
    }
    tail.push({ role: 'assistant', text: err.partialText || ' ' });
    tail.push({ role: 'user', text: STREAM_CONTINUE_HINT });
    return routeStream({
      ...a,
      messages: [...a.messages, ...tail],
      __streamContinuations: depth + 1,
    } as ContinuableArgs);
  }
}

function shortReason(err: unknown): string {
  const kind = providerErrorKindOf(err);
  // v11.23 — the failover notice is user-visible; keep it JSON-free/single-language.
  const msg = visibleErrorText(err);
  return `${kind}: ${msg.slice(0, 120)}`;
}

// v11.19 (QUIET 429) — a dedup key so repeated 429s from the SAME endpoint
// never spam `sys_notice`, even across turns or parallel agents. The TTL is
// short: a genuinely new rate-limit episode later is still reported once.
const RATE_LIMIT_NOTICE_TTL_MS = 30_000;
const rateLimitNoticeAt = new Map<string, number>();

function rateLimitNoticeFresh(endpoint: string): boolean {
  const now = Date.now();
  const prev = rateLimitNoticeAt.get(endpoint);
  if (prev !== undefined && now - prev < RATE_LIMIT_NOTICE_TTL_MS) return false;
  rateLimitNoticeAt.set(endpoint, now);
  return true;
}

/** Test-only: clear the 429 notice dedup map (production never calls this). */
export function resetRateLimitNotices(): void {
  rateLimitNoticeAt.clear();
}

/**
 * Stream a turn. With no `a.failover` this is the legacy single-provider call.
 *
 * v11.16 (LATENCY) — when a failover chain is supplied, ALL failed providers
 * share ONE wall-clock budget (default 15s, `a.failoverBudgetMs` override).
 * Within that budget:
 *   • a 401/invalid key is skipped IMMEDIATELY — no retry, no backoff;
 *   • a 429 gets ONE short (≤1s) in-provider retry of the SAME provider, then
 *     we move on with a SINGLE consolidated, deduped notice for the chain;
 *   • a 5xx gets one retry.
 *
 * v11.19 (QUIET 429) — the founder's complaints ("429 errors", "failover,
 * failover, failover", "it switches providers by itself") are addressed here:
 * 429 notices are emitted ONCE (deduped per endpoint, English base, renderer
 * translates) and never produce an error row when a failover succeeds; only
 * when EVERY provider 429s do we surface one clear message with a Retry-After
 * hint. Slow/network errors still never switch providers.
 *
 * A working provider is never cut off mid-stream: the budget bounds
 * time-to-first-token, not a healthy response.
 */
export async function streamTurn(a: StreamArgs): Promise<StreamResult> {
  if (!a.failover?.length) return routeStream(a);

  // Tolerate both `{ model: ModelConfig, apiKey?, baseUrl? }` and a bare
  // `ModelConfig` in the chain — JS callers (and older configs) use both.
  const asTarget = (t: FailoverTarget | ModelConfig): FailoverTarget => {
    const raw = t as ModelConfig & { model?: unknown };
    return typeof raw.provider === 'string' && typeof raw.model === 'string'
      ? { model: raw }
      : (t as FailoverTarget);
  };
  const chain: FailoverTarget[] = [
    { model: a.model, apiKey: a.apiKey, baseUrl: a.baseUrl },
    ...a.failover.map(asTarget),
  ];
  const budget = a.failoverBudgetMs ?? failoverBudgetMs();
  const startedAt = Date.now();
  let lastErr: unknown = null;
  // v11.19 (QUIET 429) — consolidated bookkeeping for the whole chain.
  let rateLimitedCount = 0;
  let rateLimitNoticeSent = false;
  let maxRetryAfterSeconds = 0;

  for (let i = 0; i < chain.length; i++) {
    if (i > 0) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= budget) {
        a.onNotice?.({
          kind: 'failover',
          text: `Failover budget (${budget}ms) exhausted after ${elapsed}ms — stopping instead of burning more time.`,
        });
        break;
      }
      a.onNotice?.({
        kind: 'failover',
        provider: chain[i].model.provider,
        model: chain[i].model.model,
        // Honest, quiet switch notice — no "failover" wording, no raw error.
        text: `Trying ${chain[i].model.provider}/${chain[i].model.model} after ${shortReason(lastErr)} (${elapsed}ms elapsed).`,
      });
    }
    const target = chain[i];
    try {
      // 429 backoff is handled INSIDE postJsonWithRetry (one short bounded
      // retry). Cross-provider failover below is the only outer retry — do
      // not add another loop here or it double-retries and breaks the shared
      // wall-clock budget + consolidated-notice contract.
      return await routeStream({
        ...a,
        model: target.model,
        apiKey: target.apiKey,
        baseUrl: target.baseUrl,
        maxRetries: 0,
        // v11.27 — keep the legacy bounded 429 behavior when an explicit
        // failover chain is present: one short retry, then the orchestrator's
        // single consolidated notice decides. The generous in-place recovery
        // applies only to the no-failover (user's chosen provider) case.
        __maxRateLimitRetries: 1,
      } as ContinuableArgs);
    } catch (err) {
      if (a.signal.aborted) throw err;
      lastErr = err;
      const kind = providerErrorKindOf(err);
      // v11.19 — DO NOT switch providers on a slow/stalled/network error.
      // The founder saw the app jump to another provider when the first was
      // merely slow, hiding the real cause. Only a DEFINITIVE account/key/model
      // failure justifies failover. A slow provider gets a visible notice and
      // the error is surfaced — the user decides, not an automatic switch.
      if (kind === 'network' || /stalled|timeout|timed out|ETIMEDOUT|ECONNRESET/i.test(String(err))) {
        a.onNotice?.({
          kind: 'slow_provider',
          provider: target.model.provider,
          text: `${target.model.provider} is slow or stalled — not switching automatically. Check the provider/connection in Settings.`,
        });
        throw err;
      }
      // v11.19 (QUIET 429) — ONE consolidated notice for the WHOLE chain,
      // deduped per endpoint. postJsonWithRetry stays silent for 429; this is
      // the single honest explanation the user sees (English base; the
      // renderer translates it into the selected language).
      if (kind === 'rate_limited') {
        rateLimitedCount++;
        const retryAfter = (err as { retryAfterSeconds?: number } | null)?.retryAfterSeconds ?? 0;
        if (retryAfter > maxRetryAfterSeconds) maxRetryAfterSeconds = retryAfter;
        const endpoint = `${target.model.provider}|${target.baseUrl ?? a.baseUrl ?? ''}|${target.model.model}`;
        if (!rateLimitNoticeSent && rateLimitNoticeFresh(endpoint)) {
          rateLimitNoticeSent = true;
          a.onNotice?.({
            kind: 'rate_limited',
            status: 429,
            provider: target.model.provider,
            model: target.model.model,
            // Counter = which configured model this is, so it is honest even
            // though we emit only once per chain.
            text: `Provider ${target.model.provider}/${target.model.model} rate-limited — trying the next configured model (${i + 1}/${chain.length} tried).`,
          });
        }
        // A 429 is NOT an error row: stay quiet, just continue to the next
        // provider. If one succeeds, the answer is shown with no error at all.
        continue;
      }
      if (kind === 'invalid_key' || kind === 'no_credits' || kind === 'forbidden' || kind === 'not_found') {
        a.onNotice?.({
          kind: 'provider_skip',
          status: (err as { status?: number } | null)?.status,
          provider: target.model.provider,
          model: target.model.model,
          text: `${target.model.provider}/${target.model.model}: ${visibleErrorText(err)} — skipping this provider.`,
        });
      }
      // 5xx notices are emitted inside postJsonWithRetry; continue to the
      // next target without adding duplicate noise here.
    }
  }

  // v11.19 (QUIET 429) — if EVERY provider was rate-limited, surface ONE
  // clear, single-language (English base; renderer translates) message with a
  // Retry-After hint instead of N raw 429 JSON errors / repeated notices.
  if (rateLimitedCount > 0 && rateLimitedCount === chain.length) {
    const hint = maxRetryAfterSeconds > 0
      ? ` The provider asked to retry after about ${maxRetryAfterSeconds} second${maxRetryAfterSeconds === 1 ? '' : 's'}.`
      : ' Wait a short moment before retrying.';
    throw new Error(
      `All ${chain.length} configured provider${chain.length === 1 ? '' : 's'} are rate-limited (429).${hint} Add another provider/model in Settings → Providers if this keeps happening.`,
    );
  }
  throw lastErr ?? new Error('All providers in the failover chain failed.');
}
