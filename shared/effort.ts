// ============================================================
// Surnia — v1138 PER-MODEL REASONING EFFORT, v1142 HARDENING
// (single source of truth)
// ------------------------------------------------------------
// v1142 DIAGNOSIS (the founder's "بسحب الهاي" complaint):
//   A. Two DIFFERENT axes were rendered with identical hairline CSS in one
//      popover — `agent.effort` (standard/deep = ENGINE step budget) and
//      `model.reasoning` (the model's OWN named stop). Dragging one looked like
//      the other "jumped". They are now visually + verbally separated.
//   B. The chat control's first stop was DEAD: `setModelReasoning` compared the
//      clicked name against the *normalized* value, so an unset model could
//      never persist its own default stop. Fixed in EffortControl.tsx.
//   C. `store.setModel()` replaces the whole model object (store.ts:5543), so a
//      model switch dropped `reasoning` and the slider snapped back. `pick()`
//      and the control's cross-model carry now preserve the NAME (never an
//      index) — see carryEffortLevel() below.
//   D. The per-model scale MUST change with the model: the same name re-scales
//      to a different stop count (GPT medium = 2/3, o-series medium = 1/2).
//      That is correct; only the NAME is persisted, never a position.
//
// The founder's rule: effort is NOT one global "standard / deep" knob.
// Every model family exposes its OWN stops with its OWN names, and the wire
// field is different too:
//
//   OpenAI GPT-5/6, o-series  → `reasoning_effort` (minimal/low/medium/high)
//   Anthropic Claude          → `thinking.budget_tokens` (a real token budget)
//   OpenRouter                → `reasoning.effort` / `reasoning_effort`
//   Gemini (direct compat)    → NO named effort field exists on the gateway
//
// HONESTY: the OpenRouter `/api/v1/models` payload reports a `supported_parameters`
// capability list (real, fetched provider data) but DOES NOT publish the named
// effort levels. The NAMES here are therefore CURATED from each provider's
// published API docs, and the descriptor says so (`source`). We never claim a
// level name was fetched when it was not — see docs/EFFORT-PER-MODEL-V1138.md.
//
// This module is PURE (no node / electron imports): the Electron main process,
// the React renderer and the tests all bundle the same logic.
// ============================================================

import type { ProviderId } from './types';

/** Which real wire protocol a family's effort stop maps to. */
export type EffortParam =
  | 'reasoning_effort'   // OpenAI / o-series / OpenRouter OpenAI-compatible
  | 'reasoning'          // OpenRouter Anthropic-style `reasoning: { effort }`
  | 'thinking.budget_tokens' // Anthropic `thinking: { type, budget_tokens }`
  | 'none';              // no honest wire field for this gateway

export type EffortFamily = 'gpt5' | 'o-series' | 'claude' | 'gemini' | 'glm' | 'generic';

/** One stop on a model's OWN slider. `name` is the exact wire value. */
export interface EffortLevelDef {
  name: string;
  en: string;
  ar: string;
}

export interface EffortDescriptor {
  provider: ProviderId;
  model: string;
  family: EffortFamily;
  /** 'provider-catalog' only when the live catalog confirmed a capability;
   *  level names themselves stay curated (the provider does not publish them). */
  source: 'provider-catalog' | 'curated';
  /** The real request field this descriptor changes. */
  param: EffortParam;
  levels: EffortLevelDef[];
  /** Honest default stop (an "off"-like stop — we never silently reason). */
  defaultLevel: string;
  /** Anthropic only: budget_tokens per level (0 = thinking disabled). */
  budgets?: Record<string, number>;
  /** User-visible provenance / caveat, bilingual. */
  note: { en: string; ar: string };
}

/** Real capability signal parsed from OpenRouter's live catalog. */
export interface EffortCatalogSignal {
  /** True when the live row lists the `reasoning` supported parameter. */
  supportsReasoning: boolean;
  /** True when the live row lists the `reasoning_effort` supported parameter. */
  supportsReasoningEffort: boolean;
  /** The exact `supported_parameters` reported by the provider (traceability). */
  parameters: string[];
}

// ---------- level dictionaries (curated from official provider docs) ----------

const LV = {
  off: { name: 'off', en: 'Off', ar: 'إيقاف' },
  none: { name: 'none', en: 'None', ar: 'لا شيء' },
  minimal: { name: 'minimal', en: 'Minimal', ar: 'أدنى' },
  low: { name: 'low', en: 'Low', ar: 'منخفض' },
  medium: { name: 'medium', en: 'Medium', ar: 'متوسط' },
  high: { name: 'high', en: 'High', ar: 'مرتفع' },
  xhigh: { name: 'xhigh', en: 'Extra high', ar: 'أعلى جداً' },
  max: { name: 'max', en: 'Max', ar: 'أقصى' },
} satisfies Record<string, EffortLevelDef>;

const NOTE = {
  openai: {
    en: 'OpenAI reasoning_effort — exact values from the OpenAI API.',
    ar: 'reasoning_effort من OpenAI — قيم فعلية من واجهة OpenAI.',
  },
  oseries: {
    en: 'o-series reasoning_effort — exact values from the OpenAI API.',
    ar: 'reasoning_effort لسلسلة o — قيم فعلية من واجهة OpenAI.',
  },
  claude: {
    en: 'Anthropic extended thinking — stops map to real budget_tokens (the API has no named levels).',
    ar: 'التفكير الممتد من Anthropic — تُترجم المراحل إلى budget_tokens حقيقية (الواجهة لا تعرف مستويات مُسمّاة).',
  },
  gemini: {
    en: 'Gemini direct gateway has no named effort field; low/high are curated stops only.',
    ar: 'بوابة Gemini المباشرة لا تحتوي حقل جهد مُسمّى؛ منخفض/مرتفع مجرد مراحل مُنسّقة.',
  },
  glm: {
    en: 'GLM effort (low/high/max) — curated from the published provider docs.',
    ar: 'جهد GLM (منخفض/مرتفع/أقصى) — مُنسّق من وثائق المزوّد المنشورة.',
  },
  generic: {
    en: 'No family match — honest generic stops, best-effort wire field.',
    ar: 'لم يتطابق نموذج العائلة — مراحل عامة صادقة، حقل إرسال بأفضل جهد.',
  },
  routerReasoning: {
    en: 'OpenRouter advertises reasoning support (live catalog); the WIRE field is real. Stop names are curated from the model family, not published by the router.',
    ar: 'OpenRouter يُعلن دعم التفكير (من الكتالوج الحي)؛ حقل الإرسال حقيقي. أسماء المراحل مُنسّقة من عائلة النموذج، لا يَنشرها الموجّه.',
  },
  routerEffort: {
    en: 'OpenRouter advertises reasoning_effort (live catalog); the exact value is passed through. Stop names are curated from the model family.',
    ar: 'OpenRouter يُعلن دعم reasoning_effort (من الكتالوج الحي)؛ تُمرَّر القيمة كما هي. أسماء المراحل مُنسّقة من عائلة النموذج.',
  },
};

// ---------- family detection ----------

export function effortFamilyFor(provider: ProviderId, model: string): EffortFamily {
  const m = String(model ?? '').toLowerCase().trim();
  const bare = m.includes('/') ? m.slice(m.lastIndexOf('/') + 1) : m;
  if (provider === 'anthropic' || bare.startsWith('claude-') || bare === 'claude') return 'claude';
  if (/^o\d/.test(bare) || /^o\d-/.test(bare) || bare === 'o3' || bare === 'o4-mini') return 'o-series';
  if (/gpt-?[56]/.test(bare) || bare.includes('codex')) return 'gpt5';
  if (bare.includes('gemini')) return 'gemini';
  if (bare.includes('glm')) return 'glm';
  return 'generic';
}

function levelsForFamily(family: EffortFamily): EffortLevelDef[] {
  switch (family) {
    case 'gpt5': return [LV.minimal, LV.low, LV.medium, LV.high];
    case 'o-series': return [LV.low, LV.medium, LV.high];
    case 'claude': return [LV.none, LV.low, LV.medium, LV.high];
    case 'gemini': return [LV.low, LV.high];
    case 'glm': return [LV.low, LV.high, LV.max];
    default: return [LV.off, LV.low, LV.medium, LV.high];
  }
}

const ANTHROPIC_BUDGETS: Record<string, number> = {
  none: 0,
  off: 0,
  low: 2048,
  medium: 8192,
  high: 16384,
};

/**
 * THE descriptor used by the chat control, the model picker AND the wire
 * builders. `signal` is the optional REAL capability data from the live
 * OpenRouter catalog — when present the descriptor records `provider-catalog`
 * provenance and honours the router's advertised param.
 */
export function effortLevelsFor(
  provider: ProviderId,
  model: string,
  signal?: EffortCatalogSignal | null,
): EffortDescriptor {
  const family = effortFamilyFor(provider, model);
  const levels = levelsForFamily(family);
  // Fallback for an UNKNOWN stored value. An UNSET value (`reasoning` absent)
  // still sends NO field — the UI says so explicitly; it never claims a stop
  // was chosen on the user's behalf.
  const defaultLevel = levels[0].name;

  if (provider === 'openrouter' && signal?.supportsReasoningEffort) {
    return {
      provider, model, family, source: 'provider-catalog', param: 'reasoning_effort',
      levels, defaultLevel, budgets: family === 'claude' ? ANTHROPIC_BUDGETS : undefined,
      note: NOTE.routerEffort,
    };
  }
  if (provider === 'openrouter' && signal?.supportsReasoning) {
    return {
      provider, model, family, source: 'provider-catalog', param: 'reasoning',
      levels, defaultLevel, budgets: family === 'claude' ? ANTHROPIC_BUDGETS : undefined,
      note: NOTE.routerReasoning,
    };
  }

  const base: EffortDescriptor = {
    provider, model, family, source: 'curated',
    param: 'reasoning_effort',
    levels, defaultLevel,
    budgets: family === 'claude' ? ANTHROPIC_BUDGETS : undefined,
    note: NOTE.generic,
  };
  switch (family) {
    case 'gpt5': return { ...base, param: 'reasoning_effort', note: NOTE.openai };
    case 'o-series': return { ...base, param: 'reasoning_effort', note: NOTE.oseries };
    case 'claude': return { ...base, param: 'thinking.budget_tokens', note: NOTE.claude };
    case 'gemini': return { ...base, param: 'none', note: NOTE.gemini };
    case 'glm': return { ...base, param: 'reasoning_effort', note: NOTE.glm };
    default: return base;
  }
}

/** Map a stored (possibly legacy `off`) value onto the model's OWN stops. */
export function normalizeEffortLevel(desc: EffortDescriptor, value: string | undefined): string {
  if (!value) return desc.defaultLevel;
  if (desc.levels.some((l) => l.name === value)) return value;
  // Legacy alias: the v1.1 chat control stored 'off'; Claude calls it 'none'.
  if (value === 'off' && desc.levels.some((l) => l.name === 'none')) return 'none';
  if (value === 'none' && desc.levels.some((l) => l.name === 'off')) return 'off';
  return desc.defaultLevel;
}

/** Slider index for a stored value, clamped to the descriptor's own length. */
export function effortLevelIndex(desc: EffortDescriptor, value: string | undefined): number {
  const name = normalizeEffortLevel(desc, value);
  const i = desc.levels.findIndex((l) => l.name === name);
  return i < 0 ? 0 : i;
}

/** Is this stop "off" (no reasoning token spend)?
 *  v1142 — `off` and `none` are UNIVERSAL off sentinels: a Claude `none` must
 *  never silently become a GPT `minimal` just because the target family has no
 *  literal `none` stop. Check them BEFORE family normalization. */
export function isOffEffort(desc: EffortDescriptor, level: string): boolean {
  if (level === 'off' || level === 'none') return true;
  const name = normalizeEffortLevel(desc, level);
  if (desc.param === 'thinking.budget_tokens') return (desc.budgets?.[name] ?? 0) < 1024;
  return name === 'off' || name === 'none';
}

/**
 * v1142 — carry a stored stop ACROSS A MODEL SWITCH without inventing one.
 *
 * `store.setModel()` (store.ts:5543) replaces the whole model object, dropping
 * `reasoning`. Both the picker and the chat control call this helper so the
 * chosen NAME survives — never a slider index, because an index means a
 * different stop on a model with a different number of levels.
 *
 * Rules, in order:
 *   1. unset → unset (never silently choose a stop for the user);
 *   2. any off-like stop (`off` / `none` / a zero thinking budget) → `off`,
 *      the ONE universal "send no field" sentinel (GPT's `minimal` must NOT
 *      become a Claude `none`, nor must Claude's `none` become GPT `minimal`);
 *   3. a name that exists on the target model → kept as-is;
 *   4. a stale name from the previous model → DROPPED, not clamped to the
 *      default. Inventing `low` because `minimal` vanished is exactly the
 *      mislabelling the founder complained about.
 */
export function carryEffortLevel(
  desc: EffortDescriptor,
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  if (value === 'off' || value === 'none' || isOffEffort(desc, value)) return 'off';
  return desc.levels.some((l) => l.name === value) ? value : undefined;
}

const groupThousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * v1142 — the precise, honest caption under a named stop.
 * Anthropic has NO named wire levels: its stops are token budgets, so show the
 * REAL budget (e.g. `16,384 tok`). A gateway with no field says so plainly.
 */
export function effortLevelDetail(desc: EffortDescriptor, level: string): string {
  const name = normalizeEffortLevel(desc, level);
  if (desc.param === 'thinking.budget_tokens') {
    const budget = desc.budgets?.[name] ?? 0;
    return budget >= 1024 ? `${groupThousands(budget)} tok` : 'off';
  }
  if (desc.param === 'none') return 'no field';
  return desc.param;
}

/**
 * THE wire patch. This is the single mapping the request builders use, so a
 * slider change REALLY changes the request (the founder's "notice a difference").
 */
export function effortWireFor(
  desc: EffortDescriptor,
  level: string,
): Record<string, unknown> {
  // v1142 — the off sentinel is honored for EVERY family, not only families
  // that happen to carry a literal `off`/`none` stop.
  if (level === 'off' || level === 'none') return {};
  const name = normalizeEffortLevel(desc, level);
  if (isOffEffort(desc, name)) return {};
  switch (desc.param) {
    case 'thinking.budget_tokens': {
      const budget = desc.budgets?.[name] ?? 0;
      return budget >= 1024 ? { thinking: { type: 'enabled', budget_tokens: budget } } : {};
    }
    case 'reasoning_effort': return { reasoning_effort: name };
    case 'reasoning': return { reasoning: { effort: name } };
    default: return {}; // honest: no field for this gateway
  }
}

/** A live-catalog row shape (renderer gets this over IPC as plain JSON). */
export interface LiveEffortRow {
  id: string;
  supportedParameters?: string[];
}

/**
 * Renderer-side twin of openrouterEffortSignalFor(): build the real provider
 * capability signal from the live rows the model picker / chat control already
 * fetch. Returns null (honest curated fallback) when the model has no row.
 */
export function effortSignalFromRows(
  modelId: string,
  rows: LiveEffortRow[] | null | undefined,
): EffortCatalogSignal | null {
  if (!modelId || !Array.isArray(rows) || rows.length === 0) return null;
  const norm = (s: string) => String(s ?? '').trim().toLowerCase().replace(/[.:]/g, '-');
  const bare = (s: string) => {
    const k = norm(s);
    const i = k.lastIndexOf('/');
    return i >= 0 ? k.slice(i + 1) : k;
  };
  const want = norm(modelId);
  const row = rows.find((r) => norm(r.id) === want)
    ?? (want.includes('/') ? undefined : rows.find((r) => bare(r.id) === want));
  if (!row) return null;
  const parameters = Array.isArray(row.supportedParameters)
    ? row.supportedParameters.filter((p): p is string => typeof p === 'string')
    : [];
  const has = (name: string) => parameters.some((p) => norm(p) === name);
  return {
    supportsReasoning: has('reasoning'),
    supportsReasoningEffort: has('reasoning_effort'),
    parameters,
  };
}

/** Anthropic thinking budget for a level (0 = disabled) — used by streamAnthropic. */
export function thinkingBudgetFor(provider: ProviderId, model: string, level: string | undefined): number {
  const desc = effortLevelsFor(provider, model);
  if (desc.param !== 'thinking.budget_tokens') return 0;
  const budget = desc.budgets?.[normalizeEffortLevel(desc, level)] ?? 0;
  return budget >= 1024 ? budget : 0;
}
