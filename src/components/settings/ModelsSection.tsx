// ============================================================
// SADEEM settings — Models & Providers section.
// Active-model preview, model + reasoning config, and the eight
// provider cards as FLAT hairline cards: provider name +
// connection-state dot, masked key field with show/hide, verify /
// load-models actions, live model rows in .font-code, and an
// honest empty state when no provider key is configured.
// All wiring unchanged (store selectors, api.providerVerify /
// api.listModels, ProviderEntry.lastModels cache).
// The legacy 'providers' section id lands here.
// ============================================================
import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Eye, EyeOff, KeyRound, Loader2, RefreshCw, Search } from 'lucide-react';
import { PROVIDER_PRESETS, useStore } from '../../store';
import { useT, useDigits } from '../../i18n';
import { api } from '../../lib/api';
import { Btn, Chip, Select, Spinner, TextInput, Toggle } from '../ui';
import { GroupCard } from './controls';
import type { AppSettings, ProviderId } from '../../../shared/types';
import { effortLevelsFor, normalizeEffortLevel } from '../../../shared/effort';
import './s2-art.css';

/** local mirror of the website's tx(en, ar): EN only in EN, AR only in AR. */
const pick = (lang: string, en: string, ar: string) => (lang === 'ar' ? ar : en);

/** exact polar placement — no eyeballed coordinates. */
const POLAR = (cx: number, cy: number, r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: +(cx + Math.cos(a) * r).toFixed(2), y: +(cy + Math.sin(a) * r).toFixed(2) };
};
/** three nodes at a true 72° separation (three steps of a pentagon). */
const ORBIT_DEGREES = [-90, -18, 54] as const;
const GLYPH_NODES = ORBIT_DEGREES.map((d) => POLAR(22, 22, 15, d));
const PLATE_NODES = ORBIT_DEGREES.map((d) => POLAR(160, 60, 44, d));

interface VerifyResult {
  ok: boolean;
  models?: string[];
  error?: string;
}

const REASONING_OPTIONS: { value: NonNullable<AppSettings['model']['reasoning']>; key: string; fb: string }[] = [
  { value: 'off', key: 'settings.models.reasoning.off', fb: 'Off — fastest' },
  { value: 'low', key: 'settings.models.reasoning.low', fb: 'Low — quick reasoning' },
  { value: 'medium', key: 'settings.models.reasoning.medium', fb: 'Medium — balanced' },
  { value: 'high', key: 'settings.models.reasoning.high', fb: 'High — hardest problems' },
];

export function ModelsSection({ providersOnly = false }: { providersOnly?: boolean }) {
  const t = useT();
  const n = useDigits();
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const tx = (en: string, ar: string) => pick(lang, en, ar);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const model = settings.model;
  const [expanded, setExpanded] = useState<ProviderId | null>(model.provider);

  // v1138 — the model's OWN named stops, not a global off/low/medium/high list.
  const effortDesc = useMemo(() => effortLevelsFor(model.provider, model.model), [model.provider, model.model]);
  const activeReasoning = normalizeEffortLevel(effortDesc, model.reasoning);

  const patch = (p: Partial<AppSettings['model']>) => updateSettings({ model: { ...model, ...p } });

  const activePreset = PROVIDER_PRESETS[model.provider];

  // honest configured check — real ProviderEntry fields only
  const anyConfigured = Object.values(settings.providers ?? {}).some(
    (p) => (p?.apiKey ?? '').trim() !== '' || (p?.baseUrl ?? '').trim() !== '',
  );

  return (
    <section className="set-section s2-page" dir={lang === 'ar' ? 'rtl' : undefined}>
      {/* ---------- refined page head · 03 / MODELS ---------- */}
      <header className="s2-head">
        <div className="s2-glyph-wrap">
          <svg className="s2-glyph" viewBox="0 0 44 44" aria-hidden="true">
            {/* three-node constellation, 72° apart */}
            <circle className="quiet" cx="22" cy="22" r="15" strokeDasharray="1.5 3.5" />
            <path className="quiet" d={GLYPH_NODES.map((p) => `M22 22L${p.x} ${p.y}`).join('')} />
            <path d={`M${GLYPH_NODES[0].x} ${GLYPH_NODES[0].y}L${GLYPH_NODES[1].x} ${GLYPH_NODES[1].y}L${GLYPH_NODES[2].x} ${GLYPH_NODES[2].y}`} />
            {GLYPH_NODES.map((p, i) => (
              <circle key={i} className="dot" cx={p.x} cy={p.y} r={i === 0 ? 2.2 : 1.8} />
            ))}
            <circle className="dot" cx="22" cy="22" r="1.3" />
          </svg>
        </div>
        <div className="s2-head-copy">
          <div className="s2-eyebrow">
            <span className="no">{n(providersOnly ? '04' : '03')}</span>
            <span className="slash">/</span>
            {providersOnly
              ? t('settings.nav.providers', 'Providers')
              : t('settings.nav.models', 'Models')}
          </div>
          <h2 className="s2-display">
            {providersOnly
              ? t('settings.nav.providers', 'Providers')
              : t('settings.nav.models', 'Models')}
          </h2>
          <p className="s2-desc">
            {providersOnly
              ? tx(
                  'Connect providers with your own API keys — the active model lives in 03 — Models.',
                  'اربط مزوّدين بمفاتيح API خاصة بك — النموذج النشط في ٠٣ — النماذج.',
                )
              : t(
                  'settings.models.desc',
                  'Pick the active model, tune reasoning, and connect providers with your own API keys.',
                )}
          </p>
        </div>
        <span className="s2-draw" aria-hidden="true" />
      </header>

      {/* ---------- the one precise element · orbit at 72° ---------- */}
      <div className="s2-plate s2-plate--orbit" aria-hidden="true">
        <svg viewBox="0 0 320 120">
          <circle className="quiet" cx="160" cy="60" r="62" />
          <circle className="quiet" cx="160" cy="60" r="44" strokeDasharray="1 6" />
          {PLATE_NODES.map((p, i) => (
            <line key={i} className="quiet" x1="160" y1="60" x2={p.x} y2={p.y} />
          ))}
          <path className="mid" d={`M${PLATE_NODES[0].x} ${PLATE_NODES[0].y}L${PLATE_NODES[1].x} ${PLATE_NODES[1].y}L${PLATE_NODES[2].x} ${PLATE_NODES[2].y}`} />
          <circle cx="160" cy="60" r="9" />
          <circle className="dot" cx="160" cy="60" r="1.8" />
          {PLATE_NODES.map((p, i) => (
            <g key={i}>
              <circle className="quiet" cx={p.x} cy={p.y} r="5.5" />
              <circle className={i === 0 ? 'dot accent' : 'dot'} cx={p.x} cy={p.y} r={i === 0 ? 3 : 2.2} />
            </g>
          ))}
          <text className="num" x="160" y="115" textAnchor="middle">72°</text>
        </svg>
      </div>

      <div className="s2-groups">
      {/* ---- active model strip (models pane only) ---- */}
      {!providersOnly && (
        <div className="card p-3 mb-3 flex items-center gap-2 flex-wrap" aria-live="polite">
          <span className="stamp stamp-acc">{t('settings.models.active', 'Active model')}</span>
          <span className="text-[12.5px] font-semibold">{activePreset?.label ?? model.provider}</span>
          <span className="tnum text-[12px] text-dim font-code" dir="ltr">
            {model.model}
          </span>
          <span className="ms-auto flex items-center gap-1.5 flex-wrap">
            <span className="stamp !h-[16px]">{t('settings.models.reasoning', 'Reasoning depth')}: {activeReasoning}</span>
            {typeof model.maxTokens === 'number' && <span className="stamp !h-[16px] tnum">max {model.maxTokens}</span>}
            {typeof model.temperature === 'number' && <span className="stamp !h-[16px] tnum">temp {model.temperature}</span>}
          </span>
        </div>
      )}

      {/* ---- model config (models pane only) ---- */}
      {!providersOnly && (
      <GroupCard title={t('settings.models.config', 'Model configuration')}>
        <label className="block mb-3.5">
          <div className="text-[11.5px] font-medium text-[var(--dim)] mb-1.5">
            {t('settings.models.provider', 'Provider')}
          </div>
          <Select value={model.provider} onChange={(e) => patch({ provider: e.target.value as ProviderId })}>
            {Object.entries(PROVIDER_PRESETS).map(([id, preset]) => (
              <option key={id} value={id}>
                {preset.label}
              </option>
            ))}
          </Select>
        </label>

        <label className="block mb-3.5">
          <div className="text-[11.5px] font-medium text-[var(--dim)] mb-1.5">
            {t('settings.models.model', 'Model id')}
          </div>
          <TextInput
            value={model.model}
            placeholder="claude-sonnet-5.5"
            onChange={(e) => patch({ model: e.target.value.trim() })}
            className="font-code"
            dir="ltr"
          />
        </label>

        <label className="block mb-3.5">
          <div className="text-[11.5px] font-medium text-[var(--dim)] mb-1.5">
            {t('settings.models.reasoning', 'Reasoning depth')}
          </div>
          <Select
            value={activeReasoning}
            onChange={(e) => patch({ reasoning: e.target.value })}
          >
            {effortDesc.levels.map((lv) => {
              const known = REASONING_OPTIONS.find((o) => o.value === lv.name);
              return (
                <option key={lv.name} value={lv.name}>
                  {known ? t(known.key, known.fb) : (lang === 'ar' ? lv.ar : lv.en)}
                </option>
              );
            })}
          </Select>
          <div className="text-[10.5px] text-[var(--faint)] mt-1">
            {t(
              'settings.models.reasoning.hint',
              'Extended thinking (Anthropic) / reasoning effort (OpenAI o-series, GPT-5). Higher = deeper, slower, costlier.',
            )}
          </div>
          <div className="font-code text-[9.5px] text-[var(--faint)] mt-0.5" dir="auto">
            {lang === 'ar' ? effortDesc.note.ar : effortDesc.note.en}
          </div>
          {!model.reasoning && (
            <div className="font-code text-[9.5px] text-[var(--faint)] mt-0.5" dir="auto">
              {lang === 'ar' ? 'افتراضي المزوّد — لم يُرسل حقل جهد بعد' : 'Provider default — no effort field sent yet'}
            </div>
          )}
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-[11.5px] font-medium text-[var(--dim)] mb-1.5">
              {t('settings.models.maxTokens', 'Max output tokens')}
            </div>
            <TextInput
              type="number"
              min={256}
              max={64000}
              step={256}
              value={model.maxTokens ?? ''}
              placeholder={t('settings.models.auto', 'auto')}
              onChange={(e) => {
                const v = e.target.valueAsNumber;
                patch({ maxTokens: Number.isNaN(v) ? undefined : Math.max(256, Math.min(64000, Math.round(v))) });
              }}
              className="font-code"
              dir="ltr"
            />
            <div className="text-[10.5px] text-[var(--faint)] mt-1">
              {t('settings.models.maxTokens.hint', 'Empty = provider default')}
            </div>
          </label>

          <label className="block">
            <div className="text-[11.5px] font-medium text-[var(--dim)] mb-1.5">
              {t('settings.models.temperature', 'Temperature')}
            </div>
            <TextInput
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={model.temperature ?? ''}
              placeholder={t('settings.models.auto', 'auto')}
              onChange={(e) => {
                const v = e.target.valueAsNumber;
                patch({ temperature: Number.isNaN(v) ? undefined : Math.max(0, Math.min(1, v)) });
              }}
              className="font-code"
              dir="ltr"
            />
            <div className="text-[10.5px] text-[var(--faint)] mt-1">
              {t('settings.models.temperature.hint', '0 = deterministic, 1 = creative. Empty = provider default.')}
            </div>
          </label>
        </div>
      </GroupCard>
      )}

      {/* ---- provider cards ---- */}
      <div className="caps text-[10.5px] text-[var(--faint)] mb-2 px-0.5">
        {t('settings.providers', 'AI providers')}
      </div>
      <p className="text-[11px] leading-relaxed text-dim mb-3">
        {t(
          'settings.about.keys',
          'Your API keys are stored locally with OS-level encryption when available. Nothing is sent to SADEEM servers.',
        )}
      </p>

      {/* honest empty state — no invented providers, one real action */}
      {!anyConfigured && (
        <div className="set-empty" role="note">
          <KeyRound size={18} aria-hidden />
          <div className="set-empty-title">
            {t('settings.providers.empty.title', 'No provider keys configured')}
          </div>
          <div className="set-empty-hint">
            {t(
              'settings.providers.empty.hint',
              'Add an API key to one provider below — live model lists and connections activate from that key. Keys stay on this device.',
            )}
          </div>
          <Btn variant="primary" onClick={() => setExpanded(model.provider)}>
            <KeyRound size={12} className="inline-block me-1.5" />
            {t('settings.providers.empty.cta', 'Add provider key')}
          </Btn>
        </div>
      )}

      <div className="flex flex-col gap-2.5 mb-1">
        {Object.entries(PROVIDER_PRESETS).map(([rawId, preset]) => (
          <ProviderCard
            key={rawId}
            id={rawId as ProviderId}
            expanded={expanded === (rawId as ProviderId)}
            onToggle={() => setExpanded(expanded === rawId ? null : (rawId as ProviderId))}
          />
        ))}
      </div>
      </div>
    </section>
  );
}

// ---------------- one provider card ----------------
function ProviderCard({
  id,
  expanded,
  onToggle,
}: {
  id: ProviderId;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const notify = useStore((s) => s.notify);
  const preset = PROVIDER_PRESETS[id];
  const conf = settings.providers[id] ?? {};
  const isActiveModel = settings.model.provider === id;

  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState<false | 'verify' | 'models'>(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [liveModels, setLiveModels] = useState<string[] | null>(conf.lastModels ?? null);
  const [filter, setFilter] = useState('');
  // v11.10 (A8) — ENABLE flow: field-level credential errors + honest
  // per-provider warnings live HERE, never as a global validation failure.
  const [enabling, setEnabling] = useState(false);
  const [fieldErr, setFieldErr] = useState<{ apiKey?: string; baseUrl?: string } | null>(null);
  const [warn, setWarn] = useState<string | null>(conf.lastModelWarning ?? null);

  // v11.11 (A6) — ALWAYS read the provider slice from the LIVE store state:
  // a patch built from this render's closure could silently drop fields a
  // fast follow-up wrote (enable → lastModels → a quick "Load live models"
  // click), which is how the founder's providers "sometimes disappeared" from
  // settings. updateSettings also entry-merges (store-side belt & braces).
  const patchProvider = (patch: { apiKey?: string; baseUrl?: string; enabled?: boolean; lastModels?: string[]; fetchedAt?: number; lastModelWarning?: string }) => {
    const current = useStore.getState().settings.providers;
    updateSettings({
      providers: { ...current, [id]: { ...(current[id] ?? {}), ...patch } },
    });
  };

  /** Enable/disable — enable is the smart path: validates credentials at
   *  FIELD level, auto-fetches the live catalog, auto-picks a default model
   *  when none is usable, and never throws a global failure. */
  const toggleEnabled = async (next: boolean) => {
    if (enabling) return;
    setFieldErr(null);
    if (!next) {
      patchProvider({ enabled: false });
      return;
    }
    setEnabling(true);
    try {
      const activeConf = settings.providers[settings.model.provider];
      const res = await api.providerEnable(id, {
        apiKey: conf.apiKey,
        baseUrl: conf.baseUrl || preset.baseUrl || undefined,
        // curated presets ride along as the honest fetch-failure fallback
        curatedModels: preset.models,
        active: {
          provider: settings.model.provider,
          model: settings.model.model,
          hasKey: !!PROVIDER_PRESETS[settings.model.provider]?.keyless || !!(activeConf?.apiKey ?? '').trim(),
        },
      });
      if (!res.ok) {
        if (res.fieldErrors) setFieldErr(res.fieldErrors);
        if (res.error) notify(res.error);
        return; // NOT enabled — honest field message, no global failure
      }
      patchProvider({
        enabled: true,
        lastModels: res.models,
        fetchedAt: Date.now(),
        lastModelWarning: res.warning,
      });
      setLiveModels(res.models);
      setWarn(res.warning ?? null);
      // auto-adopt the sensible default so a fresh provider is RUNNABLE —
      // this is the actual fix for "enabled it, but 'no model configured'".
      if (res.adopt && res.defaultModel) {
        updateSettings({ model: { ...settings.model, provider: id, model: res.defaultModel } });
      }
      notify(
        res.warning
          ? t('settings.providers.enabledWarn', 'Provider enabled — model list unavailable, curated presets in use')
          : res.adopt
            ? t('settings.providers.enabledAuto', 'Provider enabled — model {m} selected').replace('{m}', res.defaultModel ?? '')
            : t('settings.providers.enabled', 'Provider enabled'),
      );
    } catch (err) {
      // IPC failure must not look like a validation error — save intent + honest note.
      // v11.12 (A6-RADICAL fix #6): also persist the curated fallback list so an
      // enable that fails at the IPC layer still yields ≥1 usable model instead
      // of the "no models configured" dead end (mirrors enableProvider's own
      // fetch-failure fallback in providerService).
      patchProvider({
        enabled: true,
        lastModels: Array.isArray(preset.models) && preset.models.length ? preset.models : undefined,
        lastModelWarning: `ENABLE_UNAVAILABLE: ${String(err)}`,
      });
      setWarn(`ENABLE_UNAVAILABLE: ${String(err)}`);
    } finally {
      setEnabling(false);
    }
  };

  const verify = async () => {
    if (id === 'custom' && !conf.baseUrl) return; // custom requires a base URL
    setBusy('verify');
    try {
      const res = await api.providerVerify(id, {
        apiKey: conf.apiKey,
        baseUrl: conf.baseUrl || preset.baseUrl || undefined,
      });
      setResult({ ok: !!res?.ok, models: res?.models, error: res?.error });
      if (res?.ok && res.models) {
        setLiveModels(res.models);
        // v11.12 (A6-RADICAL fix #5): a Verify-only flow used to leave NO
        // lastModels on disk — the user saw "Connected (23)" in Settings while
        // the picker kept saying "no models configured". Persist the same write
        // shape the Enable/Load buttons use.
        const ids = Array.isArray(res.models)
          ? res.models.map((m: unknown) => (typeof m === 'string' ? m : (m as { id?: string })?.id)).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
          : [];
        if (ids.length) patchProvider({ lastModels: ids, fetchedAt: Date.now() });
      }
    } catch (err) {
      setResult({ ok: false, error: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const fetchModels = async () => {
    if (id === 'custom' && !conf.baseUrl) return;
    setBusy('models');
    try {
      const res = await api.listModels(id, {
        apiKey: conf.apiKey,
        baseUrl: conf.baseUrl || preset.baseUrl || undefined,
      });
      if (res?.ok && res.models?.length) {
        const ids = res.models.map((m) => m.id);
        setLiveModels(ids);
        setResult({ ok: true, models: ids });
        // persist the cached list (ProviderEntry.lastModels) — via the
        // live-state patch helper so nothing already written is lost
        patchProvider({ lastModels: ids, fetchedAt: Date.now() });
      } else {
        setResult({ ok: false, error: res?.error ?? t('settings.models.none', 'No models found') });
      }
    } catch (err) {
      setResult({ ok: false, error: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const selectModel = (mid: string) => {
    updateSettings({ model: { ...settings.model, provider: id, model: mid } });
    notify(t('settings.saved', 'Saved'));
  };

  const list = liveModels && liveModels.length > 0 ? liveModels : preset.models;
  const q = filter.trim().toLowerCase();
  const shown = q ? list.filter((m) => m.toLowerCase().includes(q)) : list;
  const isLive = !!(liveModels && liveModels.length > 0);

  // connection state — derived ONLY from real fields (key presence,
  // keyless preset, last verify result). Dot + label, never color alone.
  const state = preset.keyless
    ? { key: 'keyless' as const, label: t('settings.models.noKeyNeeded', 'no key needed') }
    : result?.ok
      ? { key: 'ok' as const, label: t('settings.verified', 'Connected') }
      : result && !result.ok
        ? { key: 'bad' as const, label: t('settings.verifyFailed', 'Connection failed') }
        : (conf.apiKey ?? '').trim() !== ''
          ? { key: 'saved' as const, label: t('settings.keyStored', 'Key saved locally') }
          : { key: 'off' as const, label: t('settings.providers.state.off', 'Not configured') };

  return (
    <div className={`prov ${expanded ? 'is-open' : ''}`}>
      {/* header — always visible */}
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="prov-head"
      >
        {expanded ? (
          <ChevronUp size={14} className="text-[var(--faint)] shrink-0" />
        ) : (
          <ChevronDown size={14} className="text-[var(--faint)] shrink-0" />
        )}
        <span className="prov-name">{preset.label}</span>
        <Chip>{preset.protocol === 'anthropic' ? 'Anthropic API' : 'OpenAI-compatible'}</Chip>
        {preset.keyless && <Chip tone="ok">{t('settings.models.keyless', 'keyless')}</Chip>}
        {isActiveModel && (
          <Chip tone="acc">
            <Check size={10} className="inline-block me-1 -mt-0.5" />
            {t('settings.models.active', 'Active model')}
          </Chip>
        )}
        <span className="prov-meta">
          {conf.enabled && <Chip tone="ok">{t('settings.providers.enabled', 'Enabled')}</Chip>}
          <span className="prov-state">
            <span className="prov-dot" data-state={state.key} aria-hidden />
            {state.label}
          </span>
        </span>
      </button>

      {expanded && (
        <div className="prov-body">
          {preset.keyless ? (
            <div className="flex items-center gap-2 flex-wrap py-1">
              <Chip tone="ok">{t('settings.keyStored', 'Key saved locally')}</Chip>
              <span className="text-[11px] text-dim">{t('settings.models.noKeyNeeded', 'no key needed')}</span>
            </div>
          ) : (
            <>
              {/* masked API key field */}
              <div>
                <span className="set-fieldlabel caps">
                  {t('settings.apiKey', 'API key')}
                </span>
                <div className="prov-row">
                  <TextInput
                    type={showKey ? 'text' : 'password'}
                    placeholder={t('settings.apiKey', 'API key')}
                    value={conf.apiKey ?? ''}
                    onChange={(e) => patchProvider({ apiKey: e.target.value })}
                    autoComplete="off"
                    className="flex-1 font-code"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    aria-label={showKey ? t('settings.models.hideKey', 'Hide API key') : t('settings.models.showKey', 'Show API key')}
                    className="icon-btn shrink-0"
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {fieldErr?.apiKey && (
                  <div className="text-[11px] mt-1.5 flex items-center gap-1.5" style={{ color: 'var(--bad)' }} role="alert">
                    <KeyRound size={11} className="shrink-0" />
                    {t('settings.providers.errKey', 'An API key is required to enable this provider.')}
                  </div>
                )}
              </div>
              <div>
                <span className="set-fieldlabel caps">
                  {t('settings.baseUrl', 'Base URL (optional)')}
                </span>
                <TextInput
                  placeholder={preset.baseUrl || t('settings.baseUrl', 'Base URL (optional)')}
                  value={conf.baseUrl ?? ''}
                  onChange={(e) => patchProvider({ baseUrl: e.target.value })}
                  className="font-code"
                  dir="ltr"
                />
              </div>
              <div className="prov-actions">
                <Btn variant="primary" onClick={() => void verify()} disabled={busy !== false || (id === 'custom' && !conf.baseUrl)}>
                  {busy === 'verify' ? <Spinner size={12} /> : null}
                  {t('settings.verify', 'Verify')}
                </Btn>
                <Btn onClick={() => void fetchModels()} disabled={busy !== false || (id === 'custom' && !conf.baseUrl)}>
                  {busy === 'models' ? <Spinner size={12} /> : <RefreshCw size={12} />}
                  {t('settings.models.loadModels', 'Load live models')}
                </Btn>
                {result &&
                  (result.ok ? (
                    <Chip tone="ok">
                      {t('settings.verified', 'Connected')}
                      {result.models ? ` (${result.models.length})` : ''}
                    </Chip>
                  ) : (
                    <Chip tone="bad">{result.error || t('settings.verifyFailed', 'Connection failed')}</Chip>
                  ))}
              </div>
              {/* v11.10 (A8) — the enable control: credentials are the only
                  blocker (field message above); everything else warns. */}
              <div className="flex items-center gap-2.5 py-1">
                <Toggle checked={conf.enabled === true} onChange={(v) => void toggleEnabled(v)} />
                <span className="text-[11.5px] text-dim">
                  {conf.enabled === true
                    ? t('settings.providers.disableHint', 'Enabled — models are live and the picker can use this provider')
                    : t('settings.providers.enableHint', 'Enable — fetch models and pick a default automatically')}
                </span>
                {enabling && <Spinner size={12} />}
              </div>
              {warn && (
                <div className="text-[11px] flex items-start gap-1.5 py-0.5" style={{ color: 'var(--warn)' }} role="note">
                  <span aria-hidden>⚠</span>
                  <span>
                    {t('settings.providers.warnModels', 'Model list unavailable right now — the provider is saved and curated presets are in use. Error:')}
                    <span className="font-code" dir="ltr"> {warn}</span>
                  </span>
                </div>
              )}
            </>
          )}

          {/* model list (live fetch or curated presets) */}
          <div className="prov-models">
            <div className="prov-models-head">
              <Search size={12} className="text-[var(--faint)] shrink-0" />
              <input
                className="input h-7 text-[11.5px] flex-1"
                placeholder={t('settings.models.searchPh', 'Filter models…')}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                dir="ltr"
              />
              <Chip tone={isLive ? 'ok' : 'default'}>
                {isLive ? t('settings.models.live', 'live') : t('settings.models.preset', 'presets')}
              </Chip>
            </div>
            {shown.length === 0 ? (
              <div className="text-[11px] text-[var(--faint)] py-2 px-3 flex items-center gap-1.5">
                <Loader2 size={12} />
                {t('settings.models.none', 'No models found')}
              </div>
            ) : (
              <ul className="prov-models-list set-scroll">
                {shown.map((mid) => {
                  const active = settings.model.provider === id && settings.model.model === mid;
                  return (
                    <li key={mid}>
                      <button
                        onClick={() => selectModel(mid)}
                        title={t('settings.models.selectHint', 'Click a model to make it active')}
                        className={`model-row ${active ? 'is-active' : ''}`}
                        dir="ltr"
                      >
                        <span className="truncate flex-1">{mid}</span>
                        {active && <Check size={13} className="text-acc shrink-0 model-row-check" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="text-[10px] text-[var(--faint)] mt-0.5">
            {t('settings.models.selectHint', 'Click a model to make it active')}
            {isLive && typeof conf.fetchedAt === 'number' && (
              <> · {t('settings.models.fetched', 'Updated')} {new Date(conf.fetchedAt).toLocaleString()}</>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ModelsSection;
