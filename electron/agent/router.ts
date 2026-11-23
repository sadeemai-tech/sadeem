// ============================================================
// Surnia v7 — multi-model ROUTER
// The single-vendor competitors CANNOT copy this: Surnia speaks to
// every provider, so each STEP can run on the model that fits it:
//   plan   → strongest reasoner      search → cheapest fast reader
//   edit   → mid-tier code editor    verify → DIFFERENT model family
//   context→ long-window repo reader
// Also owns: model-family profiles, the failover chain (mid-run
// provider failure switches models with state preserved) and the
// independent-verifier selection (cross-family, fail-closed option).
// ============================================================
import { ALLOW_MODEL_FAILOVER_DEFAULT, type AppSettings, type ModelConfig, type ProviderId } from '../../shared/types';

export type AgentRole = 'plan' | 'search' | 'edit' | 'verify' | 'context';

export interface ModelRef {
  provider: ProviderId;
  model: string;
}

export interface ResolvedModel {
  model: ModelConfig;
  apiKey?: string;
  baseUrl?: string;
  /** Why this model was chosen (shown in diagnostics / recap). */
  reason: string;
  family: string;
}

// ------------------------------------------------------------
// Family classification
// ------------------------------------------------------------

const PROVIDER_FAMILY: Partial<Record<ProviderId, string>> = {
  anthropic: 'claude',
  openai: 'gpt',
  zai: 'glm',
  deepseek: 'deepseek',
  gemini: 'gemini',
  xai: 'grok',
  ollama: 'local',
  moonshot: 'open',
  qwen: 'open',
  mistral: 'mistral',
  custom: 'custom',
  openrouter: 'openrouter',
};

/** Map a (provider, modelId) pair to a coarse model family. */
export function familyOf(provider: ProviderId, modelId: string): string {
  const m = (modelId || '').toLowerCase();
  const p = PROVIDER_FAMILY[provider];
  if (p && p !== 'openrouter' && p !== 'open') return p;
  // model-name heuristics for aggregators / open gateways
  if (/claude/.test(m)) return 'claude';
  if (/\bgpt|o[134](-|$)|codex/.test(m)) return 'gpt';
  if (/glm|zhipu|z\.ai/.test(m)) return 'glm';
  if (/deepseek/.test(m)) return 'deepseek';
  if (/gemini/.test(m)) return 'gemini';
  if (/grok/.test(m)) return 'grok';
  if (/qwen|kimi|moonshot|minimax|llama|mixtral/.test(m)) return 'open';
  if (provider === 'ollama') return 'local';
  return p ?? 'unknown';
}

// ------------------------------------------------------------
// Role resolution
// ------------------------------------------------------------

const ROLE_SETTING_KEY: Record<AgentRole, string> = {
  plan: 'plan',
  search: 'search',
  edit: 'edit',
  verify: 'verify',
  context: 'context',
};
void ROLE_SETTING_KEY; // kept for settings-UI key parity

function credsFor(settings: AppSettings, provider: ProviderId): { apiKey?: string; baseUrl?: string } {
  const entry = settings.providers?.[provider];
  // v11.31 — match configuredProviders(): whitespace-only values are NOT
  // credentials. Avoid resolving a role/verifier model with a blank key.
  const key = typeof entry?.apiKey === 'string' ? entry.apiKey.trim() : '';
  const url = typeof entry?.baseUrl === 'string' ? entry.baseUrl.trim() : '';
  return { apiKey: key || undefined, baseUrl: url || undefined };
}

function refToModelConfig(ref: ModelRef, base?: Partial<ModelConfig>): ModelConfig {
  return {
    provider: ref.provider,
    model: ref.model,
    temperature: base?.temperature,
    maxTokens: base?.maxTokens,
    reasoning: base?.reasoning,
  } as ModelConfig;
}

/** Which providers actually have credentials configured (order = preference). */
export function configuredProviders(settings: AppSettings): ProviderId[] {
  const out: ProviderId[] = [];
  const provs = settings.providers ?? {};
  for (const [id, entry] of Object.entries(provs) as [ProviderId, { apiKey?: string } | undefined][]) {
    if (entry && typeof entry.apiKey === 'string' && entry.apiKey.trim()) out.push(id);
  }
  return out;
}

/** agent.allowModelFailover is a v11.19 opt-in; OFF unless explicitly true. */
type FailoverAgentSettings = { allowModelFailover?: boolean };

/**
 * SETTINGS GATE (v11.19 / hardened v11.23) — automatic cross-provider
 * switching is OFF by default. The founder complaint ("يبدل المزودين لحاله"
 * — it swaps providers on its own when the first is merely slow) is fixed by
 * requiring the user to opt in with `settings.agent.allowModelFailover === true`.
 *
 * FRESH READ — there is NO module-level cache here. The flag is read from the
 * supplied settings object on every call; pass a getter (`() => getSettings()`)
 * to bind directly to the live store instead of a possibly stale snapshot.
 * Only a literal boolean `true` opts in — strings/"truthy" values are OFF.
 * Safe with no/partial settings (engine consults it early); absent values
 * resolve to {@link ALLOW_MODEL_FAILOVER_DEFAULT} (false).
 */
export function isFailoverEnabled(settings?: AppSettings | (() => AppSettings | undefined)): boolean {
  const current = typeof settings === 'function' ? settings() : settings;
  const agent = current?.agent as FailoverAgentSettings | undefined;
  const flag = agent?.allowModelFailover;
  // v11.31 — opt-in only. An explicit `false` must stay OFF even if the
  // compiled default ever flips to true; strings/truthy junk are never a yes.
  if (flag === true) return true;
  if (flag === false) return false;
  return ALLOW_MODEL_FAILOVER_DEFAULT;
}

/**
 * True only when the user EXPLICITLY configured at least two providers WITH
 * credentials. A single configured provider must never produce silent
 * alternates — that is the whole point of the v11.19 audit.
 */
function hasExplicitMultiProviderConfig(settings: AppSettings): boolean {
  return configuredProviders(settings).length >= 2;
}

/**
 * Resolve the model for a STEP ROLE.
 *  1. explicit role mapping in settings.agent.modelRoles[role] → use it
 *  2. fallback = the active session model (unchanged behavior)
 */
export function resolveRoleModel(role: AgentRole, settings: AppSettings, sessionModel: ModelConfig): ResolvedModel {
  const roles = (settings.agent as { modelRoles?: Partial<Record<AgentRole, ModelRef>> } | undefined)?.modelRoles;
  const ref = role === 'plan' ? roles?.plan : role === 'search' ? roles?.search : role === 'edit' ? roles?.edit : role === 'verify' ? roles?.verify : roles?.context;
  if (ref && ref.provider && ref.model) {
    const creds = credsFor(settings, ref.provider);
    return {
      model: refToModelConfig(ref, sessionModel),
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      reason: `explicit ${role} role`,
      family: familyOf(ref.provider, ref.model),
    };
  }
  return {
    model: sessionModel,
    apiKey: undefined,
    baseUrl: undefined,
    reason: 'session model (no role override)',
    family: familyOf(sessionModel.provider, sessionModel.model),
  };
}

// ------------------------------------------------------------
// Independent verifier / critic selection
// ------------------------------------------------------------

/** Default model per provider used when a family is picked for verification. */
const FAMILY_DEFAULT_MODEL: Record<string, { provider: ProviderId; model: string }> = {
  claude: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  gpt: { provider: 'openai', model: 'gpt-5.1-codex' },
  glm: { provider: 'zai', model: 'glm-4.7' },
  deepseek: { provider: 'deepseek', model: 'deepseek-chat' },
  gemini: { provider: 'gemini', model: 'gemini-3-pro-preview' },
  grok: { provider: 'xai', model: 'grok-4' },
};

/**
 * Pick the VERIFIER model for an EXPLICIT REVIEW RUN (goal verification /
 * adversarial critic). This is NEVER used for the main chat turn — the main
 * turn keeps the user's active model (see failoverChain, whose first entry is
 * always the user's chosen model).
 *
 * v11.19 audit: automatic cross-family selection is gated. It may introduce a
 * DIFFERENT provider only when the user EXPLICITLY configured multiple
 * providers WITH credentials AND opted in via `allowModelFailover`. An
 * explicit `verify` role remains honored (it is the user's own choice).
 * Otherwise we degrade to the worker model — never a silent vendor switch.
 */
export function pickVerifier(settings: AppSettings, worker: ModelConfig): ResolvedModel {
  const roles = (settings.agent as { modelRoles?: Partial<Record<AgentRole, ModelRef>> } | undefined)?.modelRoles;
  const explicit = roles?.verify;
  const workerFamily = familyOf(worker.provider, worker.model);

  // 1) explicit verify role — honor it even if same family (user's choice)
  if (explicit?.provider && explicit?.model) {
    const creds = credsFor(settings, explicit.provider);
    return {
      model: refToModelConfig(explicit, worker),
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      reason: 'explicit verify role',
      family: familyOf(explicit.provider, explicit.model),
    };
  }

  // 2) automatic cross-family verifier — ONLY with explicit multi-provider
  // credentials AND the failover opt-in. No silent switch when merely slow.
  if (hasExplicitMultiProviderConfig(settings) && isFailoverEnabled(settings)) {
    const candidates = configuredProviders(settings).filter((p) => familyOf(p, '') !== workerFamily);
    for (const p of candidates) {
      const def = FAMILY_DEFAULT_MODEL[familyOf(p, '')];
      const model = def && def.provider === p ? def.model : firstModelFor(settings, p);
      if (!model) continue;
      const creds = credsFor(settings, p);
      if (!creds.apiKey) continue;
      return {
        model: refToModelConfig({ provider: p, model }, worker),
        apiKey: creds.apiKey,
        baseUrl: creds.baseUrl,
        reason: `independent cross-family verifier (${familyOf(p, '')} ≠ ${workerFamily})`,
        family: familyOf(p, ''),
      };
    }
  }

  // 3) honest degrade: keep the user's own model, different persona only.
  return {
    model: worker,
    apiKey: undefined,
    baseUrl: undefined,
    reason: `no opted-in cross-family provider — same-model verifier (degraded)`,
    family: workerFamily,
  };
}

function firstModelFor(settings: AppSettings, provider: ProviderId): string | null {
  // ProviderEntry.lastModels (fetched live) is the freshest signal.
  const entry = settings.providers?.[provider];
  if (entry?.lastModels?.length && typeof entry.lastModels[0] === 'string') return entry.lastModels[0];
  return null;
}

// ------------------------------------------------------------
// Failover chain (mid-run provider failure → next model)
// ------------------------------------------------------------

/**
 * Ordered failover candidates for the session model.
 *
 * v11.19 ROUTER GATE — the model the USER chose (active model / /model) is
 * ALWAYS entry #0 and is never replaced by a verifier/role model for the main
 * turn. A DIFFERENT provider is appended ONLY when BOTH hold:
 *   1. the user explicitly configured ≥2 providers WITH credentials, and
 *   2. the user opted in with `settings.agent.allowModelFailover === true`.
 *
 * With a single configured provider — or with the gate off (the default) —
 * the chain is length 1: exactly the user's own model. A slow first provider
 * can no longer trigger a silent vendor switch; the cause is handled in place.
 * `cap` limits the number of ALTERNATE entries (entry #0 is never counted).
 */
export function failoverChain(settings: AppSettings, sessionModel: ModelConfig, cap = 2): ModelRef[] {
  const own: ModelRef = { provider: sessionModel.provider, model: sessionModel.model };

  if (!hasExplicitMultiProviderConfig(settings) || !isFailoverEnabled(settings)) {
    return [own];
  }

  const workerFamily = familyOf(sessionModel.provider, sessionModel.model);
  const others = configuredProviders(settings).filter((p) => p !== sessionModel.provider);
  const cross = others.filter((p) => familyOf(p, '') !== workerFamily);
  const same = others.filter((p) => familyOf(p, '') === workerFamily);
  const out: ModelRef[] = [own];
  // v11.23 — explicit dedup so neither a duplicated provider entry nor a
  // repeated model default can produce two identical alternates in one chain.
  const seen = new Set<string>([`${own.provider}|${own.model}`]);
  for (const p of [...cross, ...same]) {
    const def = FAMILY_DEFAULT_MODEL[familyOf(p, '')];
    const model = def && def.provider === p ? def.model : firstModelFor(settings, p);
    if (!model) continue;
    const key = `${p}|${model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ provider: p, model });
    // cap counts ALTERNATES only — entry #0 (the user's own model) is never
    // dropped, so the chain is bounded at `cap + 1` entries.
    if (out.length - 1 >= cap) break;
  }
  return out;
}

export function refCreds(settings: AppSettings, ref: ModelRef): { apiKey?: string; baseUrl?: string } {
  return credsFor(settings, ref.provider);
}

// ------------------------------------------------------------
// Model-family profiles (prompt / tooling adjustments per family)
// ------------------------------------------------------------

export interface FamilyProfile {
  family: string;
  /** Extra system-prompt guidance tuned to this family's failure modes. */
  promptAddendum: string;
  /** Suggest the text-tool fallback protocol proactively? */
  preferTextTools: boolean;
  /** Bias max_tokens up (some families need room for long tool JSON). */
  maxTokensBoost?: number;
}

const PROFILES: Record<string, FamilyProfile> = {
  glm: {
    family: 'glm',
    promptAddendum:
      '[profile: GLM] When calling tools, emit STRICT JSON arguments — no comments, no trailing commas. ' +
      'Prefer edit_file/multi_edit with old_string copied VERBATIM from read_file output.',
    preferTextTools: false,
    maxTokensBoost: undefined,
  },
  deepseek: {
    family: 'deepseek',
    promptAddendum:
      '[profile: DeepSeek] Keep tool-call JSON exact. Large refactorings: use multi_edit to batch changes into one atomic call.',
    preferTextTools: false,
  },
  gpt: {
    family: 'gpt',
    promptAddendum: '',
    preferTextTools: false,
  },
  claude: {
    family: 'claude',
    promptAddendum: '',
    preferTextTools: false,
  },
  local: {
    family: 'local',
    promptAddendum:
      '[profile: local models] You MUST wrap tool calls exactly as instructed; if native calls fail, use the ```surnia-tool fenced protocol.',
    preferTextTools: true,
  },
  open: {
    family: 'open',
    promptAddendum: '[profile: open models] Strict JSON in tool arguments; copy old_string verbatim.',
    preferTextTools: false,
  },
  unknown: {
    family: 'unknown',
    promptAddendum: '',
    preferTextTools: false,
  },
};

export function profileFor(model: ModelConfig): FamilyProfile {
  const fam = familyOf(model.provider, model.model);
  return PROFILES[fam] ?? PROFILES.unknown;
}

export const ROUTER_VERSION = 'v7-router-1';
