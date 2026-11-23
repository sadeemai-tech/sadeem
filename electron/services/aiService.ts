// ============================================================
// Surnia — one-shot AI completions (no agent loop, no tools)
// Powers editor inline edit (Ctrl+I) and ghost-text completions.
// Streams via the same provider layer as the agent for identical
// credentials, base URLs and wire behavior.
//
// v11.31 audit: a key is now resolved ONLY from the active provider's
// own settings entry or that provider's OWN env var — never from an
// unrelated provider's env var (a credential leak to a third party).
// Keyless (Ollama) and locally-configured custom endpoints work without
// a key; missing credentials produce honest BYOK guidance (SADEEM never
// supplies model credits or a key of its own).
// ============================================================
import { streamTurn } from '../agent/providers';
import { getSettings } from './storeService';
import { isKeylessProvider, providerBaseUrl, providerEnvKey, redactSecrets } from './providerService';
import type { AiCompleteParams, AiCompleteResult, ModelConfig, ProviderId, Usage } from '../../shared/types';

const DEFAULT_MAX_TOKENS = 1024;
const MAX_CONTEXT_CHARS = 12_000;
const INLINE_SYSTEM =
  'You are an expert code assistant embedded in a desktop editor. Return ONLY the requested code or text — no explanations, no markdown fences unless the user explicitly asks for a whole markdown document. Preserve the surrounding indentation style and language of the provided context.';

/** Optional usage hook — one-shot calls are billable too; callers that care
 *  about rate/usage accounting can subscribe without changing the wire path. */
export type AiCompleteParamsWithUsage = AiCompleteParams & { onUsage?: (usage: Usage) => void };

interface ResolvedCreds {
  model: ModelConfig;
  apiKey?: string;
  baseUrl?: string;
}

function resolveCreds(override?: ModelConfig): ResolvedCreds {
  let model: ModelConfig = override ? { ...override } : { provider: 'anthropic', model: '' };
  let entry: { apiKey?: string; baseUrl?: string } | undefined;
  try {
    const s = getSettings();
    if (!override && s.model?.provider) model = { ...s.model };
    entry = s.providers?.[model.provider as ProviderId] ?? undefined;
  } catch {
    /* settings unavailable — fall through to the provider's own env key */
  }

  const apiKey = (entry?.apiKey ?? '').trim() || undefined;
  // Keep an explicit endpoint even on a keyless/env-key path — dropping it
  // used to silently send a local custom request to a vendor default URL.
  const baseUrl = (entry?.baseUrl ?? '').trim() || undefined;

  if (apiKey) return { model, apiKey, baseUrl };
  if (isKeylessProvider(model.provider)) {
    return { model, baseUrl: baseUrl || providerBaseUrl(model.provider) || undefined };
  }
  // Provider-specific only. Never "first env var that happens to exist":
  // that would send ANTHROPIC_API_KEY to DeepSeek, etc.
  const envName = providerEnvKey(model.provider);
  const envKey = envName ? (process.env[envName] ?? '').trim() : '';
  if (envKey) return { model, apiKey: envKey, baseUrl };
  return { model, ...(baseUrl ? { baseUrl } : {}) };
}

export async function aiComplete(params: AiCompleteParamsWithUsage): Promise<AiCompleteResult> {
  const { model, apiKey, baseUrl } = resolveCreds(params.model);

  if (!model.model) return { ok: false, error: 'no_model: pick a model in Settings first' };
  // A custom endpoint must be explicit — there is no safe vendor default for it.
  if (model.provider === 'custom' && !baseUrl) {
    return {
      ok: false,
      error: 'no_base_url: add the custom endpoint URL in Settings → AI providers first',
    };
  }
  const keyless = isKeylessProvider(model.provider) || (model.provider === 'custom' && !!baseUrl);
  if (!apiKey && !keyless) {
    return {
      ok: false,
      error: `no_api_key: ${model.provider} needs YOUR API key (BYOK). Open Settings → AI providers and add a key for ${model.provider}.`,
    };
  }

  const context = (params.context ?? '').slice(0, MAX_CONTEXT_CHARS);
  const userText = context ? `${params.prompt}\n\n\`\`\`\n${context}\n\`\`\`` : params.prompt;

  let acc = '';
  const controller = new AbortController();
  const poll = setInterval(() => {
    if (params.signal?.aborted) controller.abort();
  }, 120);
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await streamTurn({
      model: {
        ...model,
        // One-shot helpers stay fast: small caps unless the caller overrides.
        maxTokens: params.maxTokens ?? model.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: params.temperature ?? model.temperature,
        // Never spend reasoning budget on ghost text / inline edits.
        reasoning: 'off',
      },
      apiKey,
      baseUrl,
      system: params.system?.trim() || INLINE_SYSTEM,
      messages: [{ role: 'user', text: userText }],
      tools: [],
      signal: controller.signal,
      onText: (t) => {
        acc += t;
      },
      onUsage: params.onUsage,
      onToolUse: () => {
        /* one-shot: no tools are offered */
      },
    });
    if (res.stopReason === 'error') {
      return { ok: false, error: redactSecrets(acc.trim() || 'provider error', apiKey) };
    }
    return { ok: true, text: acc };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (controller.signal.aborted) return { ok: false, error: 'aborted' };
    return { ok: false, error: redactSecrets(msg, apiKey) };
  } finally {
    clearInterval(poll);
    clearTimeout(timeout);
  }
}
