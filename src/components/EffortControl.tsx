// EffortControl — v11.37 (founder's design request) + v11.38 (per-model effort)
// + v1142 (the "بسحب الهاي" fix: ONE honest per-model rail, no dead stop).
//
// TWO DISTINCT AXES live here; they are now VISUALLY + VERBALLY separated:
//   1. `agent.effort` ('standard' | 'deep') — the ENGINE step-budget multiplier
//      (engine.ts:3534 / 3014). Kept EXACTLY as v11.37 specified it and shown
//      as a small, explicitly-labelled secondary line.
//   2. `model.reasoning` — the model's OWN named stop, sourced from
//      shared/effort.ts (OpenAI `minimal|low|medium|high`, o-series,
//      Anthropic `none|low|medium|high` → real budget_tokens, GLM `low|high|max`,
//      live OpenRouter capability when the catalog has a row). This one changes
//      the ACTUAL request field in providers.ts — the founder's "notice a
//      difference" requirement. It is the PRIMARY control in the popover.
//
// v1142 root causes fixed here:
//   • the two rails used identical `.cf-effort-rail`/`.cf-effort-range` styling,
//     so dragging the engine rail looked like the named rail "jumped";
//   • `setModelReasoning` compared the click to the NORMALIZED value, making the
//     first stop dead while `reasoning` was unset;
//   • `store.setModel()` (store.ts:5543) drops `reasoning` on a model switch, so
//     the control now carries the NAME across (never an index — an index means
//     a different stop on a model with a different number of levels).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';
import { api } from '../lib/api';
import {
  effortLevelsFor,
  effortLevelIndex,
  normalizeEffortLevel,
  effortSignalFromRows,
  carryEffortLevel,
  effortLevelDetail,
  type EffortDescriptor,
  type LiveEffortRow,
} from '../../shared/effort';
import { IcSpark } from './icons';
import './chat-final.css';
import './effort.css';

export type EffortLevel = 'standard' | 'deep';

/** The engine's OWN two effort stages — mirrors shared/types.ts:1050 verbatim. */
export const EFFORT_LEVELS: readonly EffortLevel[] = ['standard', 'deep'];

export function effortToIndex(level: EffortLevel | undefined): number {
  return level === 'deep' ? 1 : 0;
}

export function indexToEffort(index: number): EffortLevel {
  return index >= 1 ? 'deep' : 'standard';
}

/**
 * The draggable two-stop ENGINE rail, exported for SSR tests. `dir="ltr"` fixes
 * the "low → high" reading direction even in the Arabic (RTL) UI; the localized
 * label text itself still flows naturally via `dir="auto"`.
 */
export function EffortSlider({
  level,
  onChange,
}: {
  level: EffortLevel | undefined;
  onChange: (next: EffortLevel) => void;
}) {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const idx = effortToIndex(level);

  return (
    <div className="cf-effort-rail effort-rail effort-rail--engine" dir="ltr" data-testid="chat-effort-rail">
      <button
        className={`cf-effort-stop effort-stop${idx === 0 ? ' is-on' : ''}`}
        onClick={() => onChange('standard')}
        title={t('chat.effort.standard', L('Standard engine effort', 'جهد محرك قياسي'))}
      >
        <span dir="auto">{t('chat.effort.standard', L('standard', 'قياسي'))}</span>
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={1}
        value={idx}
        onChange={(e) => onChange(indexToEffort(Number(e.target.value)))}
        className="cf-effort-range effort-range"
        data-testid="chat-effort-slider"
        aria-label={t('chat.effort', L('Engine effort', 'جهد المحرك'))}
        aria-valuetext={t(`chat.effort.${EFFORT_LEVELS[idx]}`, idx === 0 ? 'standard' : 'deep')}
      />
      <button
        className={`cf-effort-stop effort-stop${idx === 1 ? ' is-on' : ''}`}
        onClick={() => onChange('deep')}
        title={t('chat.effort.deep', L('Deep engine effort', 'جهد محرك عميق'))}
      >
        <span dir="auto">{t('chat.effort.deep', L('deep', 'عميق'))}</span>
      </button>
    </div>
  );
}

/**
 * v1138 + v1142 — the per-model rail. It has EXACTLY as many stops as the
 * descriptor (4 for GPT, 3 for o-series/GLM, 4 for Claude-with-none, 2 for
 * Gemini) and renders the provider's OWN names, not a fabricated pair.
 *
 * The thumb value is derived from the stored NAME (effortLevelIndex), never
 * persisted as an index: when the model changes, the name survives and the
 * rail simply re-scales to the new model's own stop count.
 */
export function ReasoningSlider({
  desc,
  level,
  onChange,
}: {
  desc: EffortDescriptor;
  level: string;
  onChange: (next: string) => void;
}) {
  const lang = useStore((s) => s.settings.language);
  const idx = effortLevelIndex(desc, level);
  const last = Math.max(0, desc.levels.length - 1);
  const showBudgets = desc.param === 'thinking.budget_tokens' && !!desc.budgets;

  return (
    <div className="cf-effort-rail effort-rail effort-rail--model" dir="ltr" data-testid="chat-effort-rail-permodel">
      <span className="effort-track" aria-hidden="true" />
      <input
        type="range"
        min={0}
        max={last}
        step={1}
        value={idx}
        onChange={(e) => {
          const i = Math.min(last, Math.max(0, Number(e.target.value)));
          onChange(desc.levels[i].name);
        }}
        className="cf-effort-range effort-range"
        data-testid="chat-effort-slider-permodel"
        data-effort-name={desc.levels[idx]?.name ?? ''}
        data-effort-count={desc.levels.length}
        aria-label="Reasoning depth"
        aria-valuetext={desc.levels[idx] ? (lang === 'ar' ? desc.levels[idx].ar : desc.levels[idx].en) : level}
      />
      <div className="cf-effort-stops effort-stops">
        {desc.levels.map((lv) => {
          const on = lv.name === level;
          const detail = effortLevelDetail(desc, lv.name);
          return (
            <button
              key={lv.name}
              className={`cf-effort-stop effort-stop${on ? ' is-on' : ''}`}
              onClick={() => onChange(lv.name)}
              aria-pressed={on}
              data-effort-name={lv.name}
              title={showBudgets ? `${lv.en} — ${detail}` : lv.en}
            >
              <span className="effort-dot" aria-hidden="true" />
              <span className="effort-stop-label" dir="auto">{lang === 'ar' ? lv.ar : lv.en}</span>
              {showBudgets && <span className="effort-stop-detail">{detail}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The trigger chip + its hairline popover. */
export function EffortControl() {
  const t = useT();
  const lang = useStore((s) => s.settings.language);
  const agent = useStore((s) => s.settings.agent);
  const modelCfg = useStore((s) => s.settings.model);
  const updateSettings = useStore((s) => s.updateSettings);
  const [open, setOpen] = useState(false);
  const [liveRows, setLiveRows] = useState<LiveEffortRow[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  // Remember the last model + its stored stop so a switch made ANYWHERE (the
  // picker, the /model command, a restored session) cannot silently lose it.
  const lastModelRef = useRef<{ key: string; reasoning?: string } | null>(null);

  const level: EffortLevel = agent?.effort === 'deep' ? 'deep' : 'standard';
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);

  // The live OpenRouter catalog is the REAL capability source. Main process
  // caches it for 10 min, so this is cheap; it only runs while the popover is
  // open and only for an OpenRouter model.
  useEffect(() => {
    if (!open || modelCfg?.provider !== 'openrouter') return;
    let alive = true;
    api.openrouterLiveModels()
      .then((rows) => { if (alive) setLiveRows(rows as LiveEffortRow[]); })
      .catch(() => { if (alive) setLiveRows([]); });
    return () => { alive = false; };
  }, [open, modelCfg?.provider]);

  const signal = useMemo(
    () => (modelCfg?.provider === 'openrouter' ? effortSignalFromRows(modelCfg.model, liveRows) : null),
    [modelCfg?.provider, modelCfg?.model, liveRows],
  );
  const desc = useMemo(
    () => effortLevelsFor(modelCfg?.provider ?? 'custom', modelCfg?.model ?? '', signal),
    [modelCfg?.provider, modelCfg?.model, signal],
  );
  const reasoningLevel = normalizeEffortLevel(desc, modelCfg?.reasoning);
  const current = desc.levels.find((lv) => lv.name === reasoningLevel) ?? desc.levels[0];
  const currentDetail = effortLevelDetail(desc, current.name);

  // v1142 — cross-model carry. store.ts:5543 replaces the whole model object,
  // so `reasoning` is gone right after a switch. Restore the NAME (normalized
  // against the NEW model's own levels) before the user can see a snap-back.
  useEffect(() => {
    const key = `${modelCfg?.provider ?? ''}\u0000${modelCfg?.model ?? ''}`;
    const prev = lastModelRef.current;
    lastModelRef.current = { key, reasoning: modelCfg?.reasoning };
    if (!prev || !modelCfg || prev.key === key) return;
    if (!prev.reasoning || modelCfg.reasoning) return;
    const carried = carryEffortLevel(desc, prev.reasoning);
    if (carried) updateSettings({ model: { ...modelCfg, reasoning: carried } });
  }, [modelCfg?.provider, modelCfg?.model, modelCfg?.reasoning, desc, updateSettings]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  /** REAL store write — identical mechanism to the `/effort` slash command. */
  const setEffort = (next: EffortLevel) => {
    if (next === level) return;
    updateSettings({ agent: { ...(agent ?? {}), effort: next } });
  };

  /** v1142 — an explicit click ALWAYS persists, including the first stop when
   *  `reasoning` is still unset (the old normalized compare made it dead). */
  const setModelReasoning = (next: string) => {
    if (!modelCfg || next === modelCfg.reasoning) return;
    updateSettings({ model: { ...modelCfg, reasoning: next } });
  };

  const sourceLabel = desc.source === 'provider-catalog'
    ? L('from provider catalog', 'من كتالوج المزوّد')
    : L('curated', 'مُنسّق');

  return (
    <div className="cf-effort" ref={rootRef}>
      <button
        className={`cf-effort-trigger${open ? ' is-on' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="chat-effort-trigger"
        onClick={() => setOpen((v) => !v)}
        title={t('chat.effort.hint', L(
          `Reasoning effort — engine: ${level}; model: ${current.en}`,
          `جهد التفكير — المحرك: ${level}؛ النموذج: ${current.ar}`,
        ))}
      >
        <IcSpark size={10} className="shrink-0" />
        <span dir="auto">{t('chat.effort', L('Effort', 'الجهد'))}</span>
        <span className="cf-effort-value tnum" dir="auto">
          {t(`chat.effort.${level}`, level === 'deep' ? L('deep', 'عميق') : L('standard', 'قياسي'))}
        </span>
        <span className="effort-chip-sep" aria-hidden="true">·</span>
        <span className="effort-chip-model" dir="auto">{lang === 'ar' ? current.ar : current.en}</span>
      </button>

      {open && (
        <div className="cf-effort-pop effort-pop" role="dialog" aria-label={t('chat.effort', L('Reasoning effort', 'جهد التفكير'))}>
          {/* PRIMARY — the model's OWN named stops and its own scale. */}
          <section className="effort-section effort-section--model" data-testid="chat-effort-permodel">
            <header className="effort-head">
              <span className="effort-title" dir="auto">
                {t('mp.reasoning', L('Reasoning depth', 'عمق التفكير'))}
              </span>
              <span className="effort-value tnum" dir="auto">
                {lang === 'ar' ? current.ar : current.en}
                {currentDetail && <span className="effort-value-detail"> · {currentDetail}</span>}
              </span>
            </header>
            <ReasoningSlider desc={desc} level={reasoningLevel} onChange={setModelReasoning} />
            <div className="effort-meta font-code" dir="ltr">
              <span className="effort-source">{sourceLabel}</span>
              <span aria-hidden="true"> · </span>
              <span>{desc.param}</span>
              <span aria-hidden="true"> · </span>
              <span>{modelCfg?.model ?? ''}</span>
            </div>
            {(!modelCfg?.reasoning || modelCfg.reasoning === 'off') && (
              <div className="effort-unset" dir="auto">
                {L('Provider default — no effort field sent yet', 'افتراضي المزوّد — لم يُرسل حقل جهد بعد')}
              </div>
            )}
            <div className="effort-note" dir="auto">
              {t('mp.reasoningHint', L(desc.note.en, desc.note.ar))}
            </div>
          </section>

          {/* SECONDARY — the engine step-budget axis, explicitly labelled so it
              can never again be mistaken for the model's reasoning scale. */}
          <section className="effort-section effort-section--engine">
            <header className="effort-head effort-head--sub">
              <span className="effort-title effort-title--sub" dir="auto">
                {t('chat.effort.engine', L('Engine step budget', 'ميزانية خطوات المحرك'))}
              </span>
              <span className="effort-value effort-value--sub tnum" dir="auto">
                {t(`chat.effort.${level}`, level === 'deep' ? L('deep', 'عميق') : L('standard', 'قياسي'))}
              </span>
            </header>
            <EffortSlider level={level} onChange={setEffort} />
            <div className="effort-note effort-note--sub" dir="auto">
              {t(
                'chat.effort.hint',
                L(
                  'standard = default · deep = 2× engine steps + thinking-first. Separate from the model’s reasoning depth above.',
                  'قياسي = الافتراضي · عميق = ضعف خطوات المحرك والتفكير أولاً. منفصل عن عمق تفكير النموذج أعلاه.',
                ),
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default EffortControl;
