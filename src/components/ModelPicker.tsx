// SADEEM model picker — Nov 2026 catalog browser. Grouped by provider with
// headers, search filter, capability/pricing badges and keyboard navigation
// (↑/↓ move · Enter select). Pricing + context come from the catalog lookup
// IPC (kdx:model:info → electron/agent/costs.ts) so this file only carries
// UI metadata (names/badges) — one numeric source of truth.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, Star } from 'lucide-react';
import { PROVIDER_PRESETS, providerModelIds, useStore } from '../store';
import { api } from '../lib/api';
import { useT } from '../i18n';
import { Btn, Chip, Field, Kbd, Modal, SectionTitle, shortModel, Spinner, TextInput } from './ui';
import type { ProviderId } from '../../shared/types';
import {
  effortLevelsFor,
  normalizeEffortLevel,
  effortSignalFromRows,
  carryEffortLevel,
  effortLevelDetail,
  type LiveEffortRow,
} from '../../shared/effort';

// ---------- formatting helpers ----------

/** 1_048_576 → "1.05M", 500_000 → "500K", 65_536 → "66K". */
function fmtCtx(n: number): string {
  if (n >= 1_000_000) return `${Math.round((n / 1_000_000) * 100) / 100}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** 2 → "2", 2.5 → "2.5", 0.075 → "0.075" (mono tabular rendering). */
function fmtPrice(v: number): string {
  return v >= 1 ? String(Math.round(v * 100) / 100) : String(v);
}

/** Fold vendor prefixes + './:' so "claude-sonnet-5.5" and "claude-sonnet-5-5" share a key. */
function normId(id: string): string {
  const m = (id || '').toLowerCase().trim();
  const slash = m.lastIndexOf('/');
  return (slash >= 0 ? m.slice(slash + 1) : m).replace(/[.:]/g, '-');
}

// ---------- UI metadata (mirrors MODEL_CATALOG in electron/agent/providers.ts) ----------

interface ModelMeta {
  /** Display name. */
  n?: string;
  /** Dedicated reasoning / agentic-coding mode → REASON badge. */
  r?: boolean;
  /** Image input → VISION badge. */
  v?: boolean;
  /** Pricing/context caveat (tooltip). */
  note?: string;
}

const MODEL_META: Record<string, ModelMeta> = {
  // Anthropic
  'claude-opus-5-5': { n: 'Claude Opus 5.5', r: true, v: true, note: 'Agentic coding daily driver.' },
  'claude-sonnet-5-5': { n: 'Claude Sonnet 5.5', r: true, v: true, note: 'Coding/agents sweet spot.' },
  'claude-haiku-5-5': { n: 'Claude Haiku 5.5', v: true, note: '$0.10/$0.50 ≤100K prompt, then $0.50/$2.50.' },
  'claude-fable-5-1': { n: 'Claude Fable 5.1', r: true, v: true, note: 'Long-horizon agents ("Mythos" line).' },
  'claude-opus-4-8': { n: 'Claude Opus 4.8', v: true },
  'claude-sonnet-4-6': { n: 'Claude Sonnet 4.6', v: true },
  'claude-haiku-4-5': { n: 'Claude Haiku 4.5', v: true },
  'claude-opus-5': { n: 'Claude Opus 5', v: true },
  'claude-sonnet-5': { n: 'Claude Sonnet 5', v: true },
  // OpenAI
  'gpt-6-1-sol': { n: 'GPT-6.1 Sol', v: true },
  'gpt-6-1-sol-pro': { n: 'GPT-6.1 Sol Pro', v: true },
  'gpt-6-1-terra': { n: 'GPT-6.1 Terra', v: true, note: 'Best $/capability efficiency line.' },
  'gpt-6-1-terra-pro': { n: 'GPT-6.1 Terra Pro', v: true },
  'gpt-6-astra': { n: 'GPT-6 Astra', v: true },
  'gpt-6-luna': { n: 'GPT-6 Luna', v: true, note: 'Ultra-cheap workhorse.' },
  'gpt-5-5': { n: 'GPT-5.5', v: true },
  'gpt-5-5-mini': { n: 'GPT-5.5 Mini', v: true },
  'gpt-5-3-codex': { n: 'GPT-5.3 Codex', r: true, note: 'Codex CLI/IDE coding flagship.' },
  'gpt-5-1-codex-max': { n: 'GPT-5.1 Codex Max', r: true },
  'gpt-5-1-codex-mini': { n: 'GPT-5.1 Codex Mini', r: true },
  o3: { n: 'o3', r: true, v: true },
  // Google
  'gemini-4-argon': { n: 'Gemini 4 Argon', r: true, v: true, note: 'Intro $2/$10 until 2026-11-30.' },
  'gemini-3-8-flash': { n: 'Gemini 3.8 Flash', v: true, note: 'Intro $0.75/$3.75 through 2026-12-31.' },
  'gemini-3-6-flash': { n: 'Gemini 3.6 Flash', v: true },
  'gemini-3-5-flash-lite': { n: 'Gemini 3.5 Flash-Lite', v: true },
  'gemini-3-1-pro': { n: 'Gemini 3.1 Pro', r: true, v: true },
  // xAI
  'grok-4-7': { n: 'Grok 4.7', v: true, note: '≥200K prompt bills $4/$12.' },
  'grok-4-6': { n: 'Grok 4.6' },
  'grok-4-3': { n: 'Grok 4.3', note: '1M long-context tier.' },
  'grok-build-0-1': { n: 'Grok Build 0.1', r: true, note: 'Agentic-coding specialized.' },
  // DeepSeek
  'deepseek-flash': { n: 'DeepSeek Flash (V4.1-Flash)', r: true, v: true, note: 'Off-peak = half price; cache-hit $0.006.' },
  'deepseek-v4-pro': { n: 'DeepSeek V4-Pro', r: true },
  'deepseek-chat': { n: 'DeepSeek Chat (legacy)' },
  'deepseek-reasoner': { n: 'DeepSeek Reasoner (legacy)', r: true },
  // Qwen
  'qwen3-8-max': { n: 'Qwen3.8-Max', r: true, v: true },
  'qwen3-7-plus': { n: 'Qwen3.7-Plus' },
  'qwen3-8-flash': { n: 'Qwen3.8-Flash', v: true },
  'qwen3-coder-flash': { n: 'Qwen3-Coder-Flash', r: true },
  'qwen3-coder-next': { n: 'Qwen3-Coder-Next', r: true },
  'qwen3-coder': { n: 'Qwen3-Coder', r: true },
  // Moonshot
  'kimi-k3-1-pro': { n: 'Kimi K3.1 Pro', r: true, v: true },
  'kimi-k3': { n: 'Kimi K3', r: true, v: true },
  'kimi-k2-7-code': { n: 'Kimi K2.7 Code', r: true },
  'kimi-k2-7-code-highspeed': { n: 'Kimi K2.7 Code Highspeed' },
  // Z.ai
  'glm-5-3': { n: 'GLM-5.3', r: true, note: 'Reasoning-only flagship (effort levels).' },
  'glm-5-3-prime': { n: 'GLM-5.3 Prime', r: true },
  'glm-5-3-flash': { n: 'GLM-5.3-Flash' },
  'glm-5-3-flashx': { n: 'GLM-5.3-FlashX' },
  'glm-5-2': { n: 'GLM-5.2' },
  'glm-4-6': { n: 'GLM-4.6' },
  'glm-4-7-flash': { n: 'GLM-4.7-Flash' },
  // MiniMax (exact API capitalization)
  'minimax-m3-1-flash': { n: 'MiniMax M3.1 Flash', r: true, v: true },
  'minimax-m3': { n: 'MiniMax M3', r: true, v: true },
  // Mistral
  'mistral-large-4-0': { n: 'Mistral Large 4', v: true },
  'mistral-large-4': { n: 'Mistral Large 4', v: true },
  'mistral-medium-3-5': { n: 'Mistral Medium 3.5', v: true },
  'codestral-25-08': { n: 'Codestral 25.08' },
  'codestral-2508': { n: 'Codestral' },
  'mistral-small-2603': { n: 'Mistral Small 4', v: true },
  'devstral-2512': { n: 'Devstral 2', r: true, note: 'Agentic coding (SWE-bench focused).' },
  'devstral-small-2': { n: 'Devstral Small 2', r: true },
  // Meta Muse (via OpenRouter)
  'muse-spark-1-3': { n: 'Muse Spark 1.3', v: true },
  // OpenRouter free tier
  'nemotron-3-5-super-vl-free': { n: 'Nemotron 3.5 Super VL', v: true },
  'nemotron-3-ultra-550b-a55b-free': { n: 'Nemotron 3 Ultra 550B' },
  'north-mini-code-free': { n: 'North Mini Code', r: true },
  'gemma-4-31b-it-free': { n: 'Gemma 4 31B IT', v: true },
  'gpt-oss-20b': { n: 'GPT-OSS 20B (local)' },
};

/** November-2026 catalog ids unioned into each provider group (catalog order first). */
const PROVIDER_CATALOG_MODELS: Partial<Record<ProviderId, string[]>> = {
  anthropic: [
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
    'claude-fable-5-1',
    'claude-opus-4-8',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
  ],
  openai: [
    'gpt-6.1-sol',
    'gpt-6.1-sol-pro',
    'gpt-6.1-terra',
    'gpt-6.1-terra-pro',
    'gpt-6-astra',
    'gpt-6-luna',
    'gpt-5.5',
    'gpt-5.3-codex',
    'gpt-5.1-codex-max',
    'gpt-5.1-codex-mini',
    'o3',
  ],
  gemini: ['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro'],
  xai: ['grok-4.7', 'grok-4.6', 'grok-4.3', 'grok-build-0.1'],
  deepseek: ['deepseek-flash', 'deepseek-v4-pro'],
  qwen: ['qwen3.8-max', 'qwen3.7-plus', 'qwen3.8-flash', 'qwen3-coder-flash', 'qwen3-coder-next'],
  moonshot: ['kimi-k3.1-pro', 'kimi-k3', 'kimi-k2.7-code'],
  zai: ['glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx', 'glm-4.6', 'glm-4.7-flash'],
  mistral: ['mistral-large-4-0', 'mistral-medium-3-5', 'codestral-25-08', 'devstral-2512'],
  openrouter: [
    'anthropic/claude-sonnet-5.5',
    'anthropic/claude-opus-5.5',
    'openai/gpt-6.1-terra-pro',
    'openai/gpt-6.1-sol-pro',
    'google/gemini-4-argon',
    'google/gemini-3.8-flash',
    'x-ai/grok-4.7',
    'moonshotai/kimi-k3.1-pro',
    'z-ai/glm-5.3',
    'qwen/qwen3-coder-next',
    'deepseek/deepseek-v4.1-flash-1017',
    'minimax/minimax-m3.1-flash',
    'mistralai/devstral-2512',
    'meta/muse-spark-1.3',
    'nvidia/nemotron-3.5-super-vl:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'cohere/north-mini-code:free',
    'google/gemma-4-31b-it:free',
  ],
};

/** "Recommended for coding" per provider (normalized key). */
const RECOMMENDED: Partial<Record<ProviderId, string>> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-5-3-codex',
  gemini: 'gemini-3-8-flash',
  xai: 'grok-build-0-1',
  deepseek: 'deepseek-flash',
  qwen: 'qwen3-coder-next',
  moonshot: 'kimi-k3-1-pro',
  zai: 'glm-5-3',
  mistral: 'devstral-2512',
  openrouter: 'gpt-6-1-terra-pro',
  ollama: 'qwen3-coder',
};

type ModelInfo = Awaited<ReturnType<typeof api.modelInfo>>;

/** A6 — one live OpenRouter model (kdx:models:openrouter → openrouterCatalog). */
interface LiveOpenRouterModel {
  id: string;
  name: string;
  ctx: number;
  free: boolean;
  vision?: boolean;
  /** v1138 — real `supported_parameters` from the provider catalog. */
  supportedParameters?: string[];
}

/** Reasoning levels have no dictionary entry yet — keep both languages local. */
const REASON_LABEL: Record<'off' | 'low' | 'medium' | 'high', [string, string]> = {
  off: ['off', 'إيقاف'],
  low: ['low', 'منخفض'],
  medium: ['medium', 'متوسط'],
  high: ['high', 'مرتفع'],
};

export function ModelPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const settings = useStore((s) => s.settings);
  const setModel = useStore((s) => s.setModel);
  const updateSettings = useStore((s) => s.updateSettings);
  const [customId, setCustomId] = useState('');
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [info, setInfo] = useState<Record<string, ModelInfo>>({});
  // A6 — live OpenRouter catalog (merged under the static group when a key exists)
  const [orLive, setOrLive] = useState<LiveOpenRouterModel[]>([]);
  const [orLoading, setOrLoading] = useState(false);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Modal() focuses its own dialog on open via rAF; queue this after it so the
  // search box actually gets the caret (autoFocus alone loses that race).
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const pick = (provider: ProviderId, model: string) => {
    // v1142 — store.setModel() replaces the WHOLE model object (store.ts:5543),
    // silently dropping `reasoning`. Carry the chosen NAME to the newly chosen
    // model, normalized against THAT model's OWN levels — and ALWAYS persist it
    // when one existed. The old `carried !== defaultLevel` condition left the
    // store empty whenever the carried stop happened to equal the new default,
    // so the slider "lost" its value on a switch. Never persist an index: the
    // same index means a different stop on a model with a different scale.
    const previous = settings.model?.reasoning;
    const nextDesc = effortLevelsFor(
      provider,
      model,
      provider === 'openrouter' ? effortSignalFromRows(model, orLive as LiveEffortRow[]) : null,
    );
    const carried = carryEffortLevel(nextDesc, previous);
    setModel(provider, model);
    const fresh = useStore.getState().settings.model;
    updateSettings({ model: { ...fresh, ...(carried ? { reasoning: carried } : {}) } });
    onClose();
  };

  const setReasoning = (level: string) => {
    updateSettings({ model: { ...settings.model, reasoning: level } });
  };

  // v1138 — the reasoning-depth tab uses the ACTIVE model's own stops, sourced
  // from the live OpenRouter capability when available and curated otherwise.
  const activeModel = settings.model;
  const effortSignal = useMemo(
    () => (activeModel?.provider === 'openrouter'
      ? effortSignalFromRows(activeModel.model, orLive as LiveEffortRow[])
      : null),
    [activeModel?.provider, activeModel?.model, orLive],
  );
  const effortDesc = useMemo(
    () => effortLevelsFor(activeModel?.provider ?? 'custom', activeModel?.model ?? '', effortSignal),
    [activeModel?.provider, activeModel?.model, effortSignal],
  );
  const activeReasoning = normalizeEffortLevel(effortDesc, activeModel?.reasoning);
  const reasonLabel = (lv: string) => {
    // Keep the four legacy localized labels used elsewhere; every other
    // provider-specific stop renders its own bilingual descriptor label.
    if (lv === 'off' || lv === 'low' || lv === 'medium' || lv === 'high') {
      const legacy = (lv: keyof typeof REASON_LABEL) =>
        t('mp.reasoning.' + lv, REASON_LABEL[lv][lang === 'ar' ? 1 : 0]);
      return legacy(lv);
    }
    const def = effortDesc.levels.find((x) => x.name === lv);
    return lang === 'ar' ? (def?.ar ?? lv) : (def?.en ?? lv);
  };

  // ---------- groups: catalog ids first, then the provider's OWN live list ----------
  // v11.11 (A6) — each enabled provider's cached live fetch (ProviderEntry
  // .lastModels — what Settings persists on enable / "Load live models") is
  // merged into its group, so a provider the founder just added shows its REAL
  // models here immediately instead of only the static catalog rows. The
  // memo depends on the provider slice — a provider added while the app runs
  // appears on the next render (the old [] deps froze the groups at mount).
  const providersSlice = useStore((s) => s.settings.providers);
  const groups = useMemo(() => {
    return (Object.entries(PROVIDER_PRESETS) as [ProviderId, (typeof PROVIDER_PRESETS)[ProviderId]][]).map(
      ([id, preset]) => {
        const seen = new Set<string>();
        const models: string[] = [];
        const entry = providersSlice?.[id];
        for (const m of [
          ...(PROVIDER_CATALOG_MODELS[id] ?? []),
          ...preset.models,
          ...providerModelIds(entry, []),
        ]) {
          const k = normId(m);
          if (seen.has(k)) continue;
          seen.add(k);
          models.push(m);
        }
        return { id, preset, models };
      },
    );
  }, [providersSlice]);

  // ---------- catalog lookups (context window + price) for every listed id ----------
  const allIds = useMemo(() => groups.flatMap((g) => g.models), [groups]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    Promise.all(
      allIds.map(
        (id) =>
          api
            .modelInfo(id)
            .then((res): [string, ModelInfo] => [id, res])
            .catch((): [string, null] => [id, null]),
      ),
    ).then((entries) => {
      if (!alive) return;
      const next: Record<string, ModelInfo> = {};
      for (const [id, res] of entries) if (res) next[id] = res;
      setInfo(next);
    });
    return () => {
      alive = false;
    };
  }, [open, allIds]);

  // ---------- A6 — live OpenRouter catalog ----------
  // Fetch once per picker open when an OpenRouter key is configured; the
  // main process caches for 10 minutes so this stays cheap. An empty
  // result (no key / network error) simply keeps the static list.
  const orHasKey = !!settings.providers?.openrouter?.apiKey;
  useEffect(() => {
    if (!open || !orHasKey) return;
    let alive = true;
    setOrLoading(true);
    api
      .openrouterLiveModels()
      .then((models) => {
        if (alive) setOrLive(Array.isArray(models) ? models : []);
      })
      .catch(() => {
        if (alive) setOrLive([]);
      })
      .finally(() => {
        if (alive) setOrLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, orHasKey]);

  /** Normalized static openrouter ids — live entries already listed above are skipped. */
  const orStaticKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const m of PROVIDER_CATALOG_MODELS.openrouter ?? []) keys.add(normId(m));
    return keys;
  }, []);

  /** Live list minus static duplicates (merged, not duplicated). */
  const orLiveMerged = useMemo(() => {
    if (!orLive.length) return [];
    const seen = new Set<string>();
    const out: LiveOpenRouterModel[] = [];
    for (const m of orLive) {
      const k = normId(m.id);
      if (orStaticKeys.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push(m);
    }
    return out;
  }, [orLive, orStaticKeys]);

  // ---------- search filter ----------
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        models: g.models.filter((m) => {
          const meta = MODEL_META[normId(m)];
          return (
            m.toLowerCase().includes(q) ||
            (meta?.n ?? '').toLowerCase().includes(q) ||
            g.preset.label.toLowerCase().includes(q)
          );
        }),
      }))
      .filter((g) => g.models.length > 0);
  }, [groups, q]);

  /** Live rows that match the search filter (id or router display name). */
  const orLiveVisible = useMemo(() => {
    if (!q) return orLiveMerged;
    return orLiveMerged.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
  }, [orLiveMerged, q]);

  /** Flat list for keyboard navigation (group order preserved; live group last). */
  const flat = useMemo(
    () => [
      ...filtered.flatMap((g) => g.models.map((m) => ({ provider: g.id as ProviderId, id: m }))),
      ...orLiveVisible.map((m) => ({ provider: 'openrouter' as ProviderId, id: m.id })),
    ],
    [filtered, orLiveVisible],
  );

  // keep the keyboard cursor on the active model when the list changes
  useEffect(() => {
    const i = flat.findIndex(
      (m) => m.id === settings.model?.model && m.provider === settings.model?.provider,
    );
    setSel(i >= 0 ? i : 0);
  }, [flat, settings.model]);

  // scroll the keyboard cursor into view
  useEffect(() => {
    rowRefs.current[sel]?.scrollIntoView({ block: 'nearest' });
  }, [sel, flat]);

  const onNavKey = (e: ReactKeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flat.length) setSel((s) => (s + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length) setSel((s) => (s - 1 + flat.length) % flat.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setSel(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      if (flat.length) setSel(flat.length - 1);
    } else if (e.key === 'Enter') {
      // A focused model rowbutton already selects through its native click.
      // Running pick() here too would fire setModel/onClose twice.
      if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
      e.preventDefault();
      const m = flat[sel];
      if (m) pick(m.provider, m.id);
    }
  };

  return (
    <Modal open={open} width={600} title={t('mp.title', 'Choose model')} onClose={onClose}>
      <div className="flex flex-col gap-4" onKeyDown={onNavKey}>
        {/* search / filter */}
        <div className="flex flex-col gap-1.5">
          <input
            ref={searchRef}
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('mp.searchPh', 'Filter models…')}
            aria-label={t('mp.searchPh', 'Filter models…')}
            spellCheck={false}
            dir="auto"
          />
          <div className="flex items-center gap-1 text-[10px] text-[var(--faint)]">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <span dir="auto">{t('mp.navMove', 'navigate')}</span>
            <Kbd>↵</Kbd>
            <span dir="auto">{t('mp.navSelect', 'select')}</span>
          </div>
        </div>

        {/* grouped model list */}
        {flat.length === 0 && (
          <div className="text-[12px] text-[var(--dim)] py-6 text-center" dir="auto">
            {t('mp.none', 'No models match')}
            {q ? ` "${query.trim()}"` : ''}
          </div>
        )}
        <div role="listbox" aria-label={t('mp.title', 'Choose model')}>
          {filtered.map(({ id, preset, models }) => {
            const conf = settings.providers?.[id];
            const unconfigured = !preset.keyless && id !== 'custom' && !conf?.apiKey;
            return (
              <div key={id} className="mb-3">
                <SectionTitle>
                  {preset.label}
                  <span className="font-code text-[9.5px] normal-case tracking-normal text-[var(--faint)]">
                    {models.length}
                  </span>
                </SectionTitle>
                <div className="flex flex-col">
                  {models.map((m) => {
                    const idx = flat.findIndex((f) => f.provider === id && f.id === m);
                    const active = settings.model?.provider === id && settings.model?.model === m;
                    const selected = idx === sel;
                    const key = normId(m);
                    const meta = MODEL_META[key] ?? {};
                    const inf = info[m];
                    const price = inf?.price;
                    const free = m.endsWith(':free') || (!!price && price.input === 0 && price.output === 0);
                    const ctx = inf?.contextWindow ?? 0;
                    const rec = RECOMMENDED[id] === key;
                    return (
                      <button
                        key={m}
                        ref={(el) => {
                          rowRefs.current[idx] = el;
                        }}
                        role="option"
                        aria-selected={selected}
                        data-idx={idx}
                        onClick={() => pick(id, m)}
                        onMouseMove={() => idx >= 0 && sel !== idx && setSel(idx)}
                        className={`row-hover rounded-[var(--radius-sm)] px-2 py-1.5 flex items-center justify-between gap-2 cursor-pointer text-start border border-transparent ${
                          selected
                            ? 'bg-[color-mix(in_srgb,var(--acc)_10%,transparent)] border-[color-mix(in_srgb,var(--acc)_35%,transparent)]'
                            : ''
                        } ${unconfigured ? 'opacity-50' : ''}`}
                        title={meta.note ?? (unconfigured ? t('mp.configure', 'Configure in Settings → AI providers') : undefined)}
                      >
                        <span className="min-w-0 flex flex-col gap-0.5">
                          <span className="text-[12.5px] font-medium truncate" dir="auto">{meta.n ?? shortModel(m)}</span>
                          <span className="font-code text-[10.5px] text-[var(--faint)] truncate" dir="ltr">
                            {m}
                          </span>
                        </span>
                        <span className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end max-w-[60%]">
                          {rec && (
                            <Chip tone="acc" title={t('mp.rec', 'Recommended for coding')}>
                              <Star size={9} strokeWidth={2} aria-hidden /> {t('mp.recShort', 'Rec')}
                            </Chip>
                          )}
                          {meta.r && <Chip title={t('mp.reasonTip', 'Reasoning / extended thinking')}>{t('mp.reason', 'REASON')}</Chip>}
                          {meta.v && <Chip title={t('mp.visionTip', 'Accepts image input')}>{t('mp.vision', 'VISION')}</Chip>}
                          {free && <Chip tone="ok" title={t('mp.freeTip', 'No metered cost')}>{t('mp.free', 'FREE')}</Chip>}
                          {price && !free && (
                            <span
                              className="font-code tabular-nums text-[10.5px] text-[var(--dim)] whitespace-nowrap"
                              dir="ltr"
                              title={t('mp.priceTip', 'Estimated USD per 1M tokens (input / output)')}
                            >
                              ${fmtPrice(price.input)}/${fmtPrice(price.output)}
                              <span className="text-[var(--faint)]">/1M</span>
                            </span>
                          )}
                          {ctx > 0 && (
                            <Chip className="font-code tabular-nums" title={t('mp.ctxTip', 'Context window')}>
                              {fmtCtx(ctx)}
                            </Chip>
                          )}
                          {unconfigured && <Chip tone="bad">{t('mp.noKey', 'API key not configured')}</Chip>}
                          {active && <Check size={14} className="text-acc" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* A6 — live OpenRouter group: fetched with the configured key when the
              picker opens; merged UNDER the static catalog (kept above as the
              fallback). Rows already present in the static list are skipped. */}
          {(orLiveVisible.length > 0 || (orLoading && orHasKey)) && (
            <div className="mb-3">
              <SectionTitle>
                {t('mp.liveGroup', 'OpenRouter — live catalog')}
                <span className="font-code text-[9.5px] normal-case tracking-normal text-[var(--faint)]">
                  {orLiveVisible.length}
                </span>
                {orLoading && <Spinner size={11} />}
              </SectionTitle>
              <div className="flex flex-col">
                {orLiveVisible.map((m) => {
                  const idx = flat.findIndex((f) => f.provider === 'openrouter' && f.id === m.id);
                  const active =
                    settings.model?.provider === 'openrouter' && settings.model?.model === m.id;
                  const selected = idx === sel;
                  return (
                    <button
                      key={m.id}
                      ref={(el) => {
                        rowRefs.current[idx] = el;
                      }}
                      role="option"
                      aria-selected={selected}
                      data-idx={idx}
                      onClick={() => pick('openrouter', m.id)}
                      onMouseMove={() => idx >= 0 && sel !== idx && setSel(idx)}
                      className={`row-hover rounded-[var(--radius-sm)] px-2 py-1.5 flex items-center justify-between gap-2 cursor-pointer text-start border border-transparent ${
                        selected
                          ? 'bg-[color-mix(in_srgb,var(--acc)_10%,transparent)] border-[color-mix(in_srgb,var(--acc)_35%,transparent)]'
                          : ''
                      }`}
                      title={t('mp.liveTip', 'Fetched live from openrouter.ai with your API key')}
                    >
                      <span className="min-w-0 flex flex-col gap-0.5">
                        <span className="text-[12.5px] font-medium truncate" dir="auto">{m.name}</span>
                        <span className="font-code text-[10.5px] text-[var(--faint)] truncate" dir="ltr">
                          {m.id}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end max-w-[60%]">
                        {m.free && (
                          <Chip className="font-code" tone="ok" title={t('mp.liveFreeTip', 'Free variant — zero metered cost')}>
                            :free
                          </Chip>
                        )}
                        {m.vision && (
                          <Chip title={t('mp.visionTip', 'Accepts image input')}>{t('mp.vision', 'VISION')}</Chip>
                        )}
                        {m.ctx > 0 && (
                          <Chip className="font-code tabular-nums" title={t('mp.ctxTip', 'Context window')}>
                            {fmtCtx(m.ctx)}
                          </Chip>
                        )}
                        {active && <Check size={14} className="text-acc" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* reasoning depth — extended thinking controls (segmented voice) */}
      <div className="mt-5 pt-4 border-t border-[var(--line)]">
        <Field
          label={t('mp.reasoning', 'Reasoning depth (extended thinking)')}
          hint={t('mp.reasoningHint', 'Higher = deeper thinking for hard problems (slower, more tokens). Uses Anthropic thinking, o-series reasoning_effort and OpenRouter reasoning.')}
        >
          {/* v1138 + v1142 — EXACTLY this model's stops, with its OWN names.
              Anthropic has no named wire levels, so its REAL token budget is
              shown beside each stop instead of a decorative label. */}
          <div className="stamp-seg is-plain" data-testid="model-picker-effort-levels">
            {effortDesc.levels.map((lv) => {
              const active = activeReasoning === lv.name;
              const budget = effortDesc.param === 'thinking.budget_tokens'
                ? effortLevelDetail(effortDesc, lv.name)
                : '';
              return (
                <button
                  key={lv.name}
                  onClick={() => setReasoning(lv.name)}
                  aria-pressed={active}
                  className={active ? 'is-active' : ''}
                  title={budget ? `${lv.en} — ${budget}` : lv.en}
                >
                  {reasonLabel(lv.name)}
                  {budget && <span className="font-code ms-1 text-[9px] opacity-70">{budget}</span>}
                </button>
              );
            })}
          </div>
          <div className="text-[10.5px] text-[var(--faint)] mt-1" dir="auto">
            {lang === 'ar' ? effortDesc.note.ar : effortDesc.note.en}
          </div>
          {!activeModel?.reasoning && (
            <div className="font-code text-[9.5px] text-[var(--faint)] mt-0.5" dir="auto">
              {lang === 'ar' ? 'افتراضي المزوّد — لم يُرسل حقل جهد بعد' : 'Provider default — no effort field sent yet'}
            </div>
          )}
          <div className="font-code text-[9.5px] text-[var(--faint)] mt-0.5" dir="ltr">
            {`${effortDesc.source === 'provider-catalog'
              ? (lang === 'ar' ? 'من كتالوج المزوّد' : 'from provider catalog')
              : (lang === 'ar' ? 'مُنسّق' : 'curated')} · ${effortDesc.param} · ${effortDesc.levels.map((l) => l.name).join(' / ')}`}
          </div>
        </Field>
      </div>

      {/* custom provider entry */}
      <div className="mt-5 pt-4 border-t border-[var(--line)]">
        <Field label={t('mp.custom', 'Custom model ID')}>
          <div className="flex gap-2">
            <TextInput
              value={customId}
              placeholder={t('mp.customPh', 'my-org/my-model')}
              onChange={(e) => setCustomId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && customId.trim() && pick('custom', customId.trim())}
              className="font-code"
              dir="ltr"
            />
            <Btn variant="primary" disabled={!customId.trim()} onClick={() => pick('custom', customId.trim())}>
              {t('misc.save', 'Save')}
            </Btn>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

export default ModelPicker;
