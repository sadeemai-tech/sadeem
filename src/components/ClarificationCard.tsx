// SADEEM — ClarificationCard (STABLE, version-free).
// A general, controlled "the agent needs a decision" card. It renders a
// bilingual question, 2–4 selectable options (short label + description), an
// optional free-text "other" answer, and a Confirm action, in the house
// editorial/ink style (1px strokes, hairlines, CSS vars only).
//
// This is a CONTROLLED PRESENTATION COMPONENT — it owns only its local
// selection/draft state; it does NOT talk to IPC or the store itself.
//
// WIRING (the real, existing path — do not fake it):
//   The engine's `ask_user` tool emits an `approval_request` AgentEvent with
//   kind:'question'. The store ingests it into `pendingApproval` (choices +
//   allowText), and the parent renders this card. The parent MUST pass:
//     onAnswer  = (value) => void useStore.getState().decideApproval('answer', value)
//     onDismiss = ()      => void useStore.getState().decideApproval('deny')   // optional
//   `decideApproval` already calls `api.agentApproval({requestId, action:'answer',
//   value})` → preload `invoke('kdx:agent:approval', d)` → register.ts resolves
//   the pending decision → engine `askUser()` returns the value as the tool
//   result. No new channel or store action is required.
//
// For richer future events, map their fields onto <ClarificationCard> the same
// way: question → {en,ar}, options → {value,label,description}, onAnswer → the
// store's existing `decideApproval('answer', value)`.

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import './clarification.css';

export type Lang = 'en' | 'ar';

/** A string that is either already localized, or carries both ICU-free variants. */
export type LocalizedText = string | { en: string; ar: string };

export interface ClarificationOption {
  /** Value sent to onAnswer when this option is confirmed. */
  value: string;
  /** Short bilingual label (one line). */
  label: LocalizedText;
  /** Optional one-line bilingual description. */
  description?: LocalizedText;
}

export interface ClarificationCardProps {
  /** The question the agent needs answered. */
  question: LocalizedText;
  /** Optional mono kicker above the question (e.g. "DECISION NEEDED"). */
  eyebrow?: LocalizedText;
  /** 2–4 options; only the first 4 are rendered (engine ask_user cap). */
  options: ClarificationOption[];
  /** Show a free-text "Other" answer row. Default true. */
  allowOther?: boolean;
  /** UI language used to resolve LocalizedText. Default 'en'. */
  lang?: Lang;
  /** Confirm button label override. */
  confirmLabel?: LocalizedText;
  /** Placeholder for the free-text "Other" input. */
  otherPlaceholder?: LocalizedText;
  /** Zero-based initial selection; index === options.length selects "Other". Default 0. */
  defaultSelected?: number;
  /** Called with the chosen option value, or the typed "Other" text. */
  onAnswer: (value: string) => void;
  /** Optional dismissal path (engine treats 'deny' as a dismissed question). */
  onDismiss?: () => void;
  /** Stable id seed for aria relationships. Falls back to React.useId(). */
  requestId?: string;
  /** Disable all interaction while submitting. Default false. */
  disabled?: boolean;
  /** Focus the initially selected control on mount (browser only). Default true. */
  autoFocus?: boolean;
}

const OTHER_INDEX_SENTINEL = -1;

/** Resolve a bilingual value for the active language, with a safe fallback. */
export function localize(text: LocalizedText | undefined, lang: Lang): string {
  if (text == null) return '';
  if (typeof text === 'string') return text;
  return (lang === 'ar' ? text.ar : text.en) || text.en || text.ar || '';
}

/** Total navigable items = options + (optional) "Other" row. */
export function itemCount(options: ClarificationOption[], allowOther: boolean): number {
  return Math.min(options.length, 4) + (allowOther ? 1 : 0);
}

/** Clamp a selection index into [0, count-1], or -1 when count is 0. */
export function clampSelection(index: number, count: number): number {
  if (count <= 0) return -1;
  if (index < 0) return -1;
  return Math.min(index, count - 1);
}

/**
 * Pure keyboard-navigation helper used by the root onKeyDown handler.
 * `delta` is a logical step (+1 next / -1 previous); wrap-around is enabled.
 * `rtl` flips only the horizontal arrow mapping, done by the caller.
 */
export function navIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  const c = ((current % count) + count) % count;
  return (((c + delta) % count) + count) % count;
}

/** Digit keys '1'–'4' map to option indices; anything else → -1. */
export function digitToIndex(key: string, optionCount: number): number {
  if (!/^[1-4]$/.test(key)) return -1;
  const i = Number(key) - 1;
  return i < optionCount ? i : -1;
}

/**
 * Resolve the value to submit. Returns null when nothing valid is chosen
 * (e.g. "Other" selected but empty). Exported for deterministic testing.
 */
export function resolveAnswer(
  options: ClarificationOption[],
  selected: number,
  otherText: string,
  allowOther: boolean,
): string | null {
  const opts = options.slice(0, 4);
  if (selected < 0) return null;
  if (allowOther && selected === opts.length) {
    const v = otherText.trim();
    return v || null;
  }
  const opt = opts[selected];
  return opt ? opt.value : null;
}

export function ClarificationCard({
  question,
  eyebrow,
  options,
  allowOther = true,
  lang = 'en',
  confirmLabel,
  otherPlaceholder,
  defaultSelected,
  onAnswer,
  onDismiss,
  requestId,
  disabled = false,
  autoFocus = true,
}: ClarificationCardProps) {
  const reactId = useId();
  const baseId = requestId ? `clarif-${requestId}` : `clarif-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const qid = `${baseId}-q`;
  const oid = `${baseId}-opts`;

  const opts = options.slice(0, 4);
  const count = itemCount(opts, allowOther);
  const otherIndex = allowOther ? opts.length : OTHER_INDEX_SENTINEL;
  const initial =
    defaultSelected === undefined
      ? opts.length > 0
        ? 0
        : otherIndex
      : clampSelection(defaultSelected, count);

  const [selected, setSelected] = useState<number>(initial);
  const [otherText, setOtherText] = useState('');
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const otherRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Reset local state when the question changes (same mounted card reused).
  useEffect(() => {
    setSelected(initial);
    setOtherText('');
  }, [baseId, initial]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus the initially selected control on mount — browser only, and never
  // while reduced-motion users are mid-interaction. rAF keeps SSR safe.
  useEffect(() => {
    if (!autoFocus || disabled || typeof window === 'undefined') return;
    const id = requestAnimationFrame(() => {
      if (selected === otherIndex) otherRef.current?.focus();
      else optionRefs.current[selected]?.focus();
    });
    return () => cancelAnimationFrame(id);
    // Only on mount / question change — don't steal focus on every arrow key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, autoFocus]);

  const focusItem = useCallback(
    (index: number) => {
      if (index === otherIndex) otherRef.current?.focus();
      else optionRefs.current[index]?.focus();
    },
    [otherIndex],
  );

  const select = useCallback(
    (index: number) => {
      const clamped = clampSelection(index, count);
      if (clamped < 0) return;
      setSelected(clamped);
      focusItem(clamped);
    },
    [count, focusItem],
  );

  const confirm = useCallback(() => {
    if (disabled) return;
    const value = resolveAnswer(opts, selected, otherText, allowOther);
    if (value == null) return;
    onAnswer(value);
  }, [disabled, opts, selected, otherText, allowOther, onAnswer]);

  const onRootKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      // Skip / Confirm already answer or dismiss through their native click on
      // Enter. Running confirm() here too would double-submit the engine's
      // decision (two approval answers for one user action). Option radios are
      // NOT action buttons — Enter from one still confirms, matching the ↵ hint.
      if (e.key === 'Enter' && target?.closest?.('.clarif-actions')) return;

      if (e.key === 'Enter') {
        e.preventDefault(); // Enter always confirms (also from the Other field)
        confirm();
        return;
      }
      if (e.key === 'Escape') {
        if (onDismiss) {
          e.preventDefault();
          onDismiss();
        }
        return;
      }
      // Don't hijack digit/arrow keys while typing free text (except Enter above).
      if (typing) return;

      const digit = digitToIndex(e.key, opts.length);
      if (digit >= 0) {
        e.preventDefault();
        select(digit);
        return;
      }

      if (
        e.key === 'ArrowDown' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight'
      ) {
        const rtl = lang === 'ar';
        let delta = 0;
        if (e.key === 'ArrowDown') delta = 1;
        else if (e.key === 'ArrowUp') delta = -1;
        else if (e.key === 'ArrowRight') delta = rtl ? -1 : 1;
        else delta = rtl ? 1 : -1; // ArrowLeft
        e.preventDefault();
        select(navIndex(selected < 0 ? 0 : selected, delta, count));
      }
    },
    [disabled, confirm, onDismiss, opts.length, select, lang, selected, count],
  );

  const qText = localize(question, lang);
  const eyebrowText = localize(eyebrow, lang) || localize({ en: 'Decision needed', ar: 'مطلوب قرار' }, lang);
  const confirmText = localize(confirmLabel, lang) || localize({ en: 'Confirm', ar: 'تأكيد' }, lang);
  const otherPlaceholderText =
    localize(otherPlaceholder, lang) || localize({ en: 'Type a different answer…', ar: 'اكتب إجابة مختلفة…' }, lang);
  const canConfirm = resolveAnswer(opts, selected, otherText, allowOther) != null;

  return (
    <div
      ref={rootRef}
      className="clarif"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      role="group"
      aria-labelledby={qid}
      aria-disabled={disabled || undefined}
      data-selected={selected}
      data-question={qText}
      onKeyDown={onRootKeyDown}
    >
      {/* masthead: mono kicker + drawn hairline + 1px question glyph */}
      <div className="clarif-head">
        <span className="clarif-eyebrow">{eyebrowText}</span>
        <span className="clarif-rule" aria-hidden="true" />
        <svg className="clarif-glyph" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <circle cx="10" cy="10" r="8.25" className="clarif-glyph-ink" />
          <path d="M7.7 7.6a2.4 2.4 0 1 1 3.7 2.05c-.9.6-1.4 1-1.4 2.05" className="clarif-glyph-ink" />
          <circle cx="10" cy="14.1" r="0.85" className="clarif-glyph-dot" />
        </svg>
      </div>

      <p className="clarif-q" id={qid} dir="auto">
        {qText}
      </p>

      <div className="clarif-opts" role="radiogroup" aria-labelledby={qid} id={oid}>
        {opts.map((opt, i) => {
          const isSelected = selected === i;
          const label = localize(opt.label, lang);
          const desc = localize(opt.description, lang);
          return (
            <button
              key={`${i}:${opt.value}`}
              ref={(el) => {
                optionRefs.current[i] = el;
              }}
              type="button"
              className="clarif-opt"
              role="radio"
              aria-checked={isSelected}
              aria-label={desc ? `${label}. ${desc}` : label}
              tabIndex={isSelected ? 0 : -1}
              data-selected={isSelected || undefined}
              disabled={disabled}
              onClick={() => select(i)}
            >
              <span className="clarif-opt-key" aria-hidden="true">
                {i + 1}
              </span>
              <span className="clarif-opt-body">
                <span className="clarif-opt-label" dir="auto">
                  {label}
                </span>
                {desc && (
                  <span className="clarif-opt-desc" dir="auto">
                    {desc}
                  </span>
                )}
              </span>
              <span className="clarif-opt-mark" aria-hidden="true" />
            </button>
          );
        })}

        {allowOther && (
          <div
            className="clarif-other"
            data-selected={selected === otherIndex || undefined}
            onClick={() => {
              if (!disabled) setSelected(otherIndex);
            }}
          >
            <span className="clarif-opt-key" aria-hidden="true">
              +
            </span>
            <input
              ref={otherRef}
              type="text"
              className="clarif-other-input"
              dir="auto"
              value={otherText}
              disabled={disabled}
              tabIndex={selected === otherIndex ? 0 : -1}
              placeholder={otherPlaceholderText}
              aria-label={otherPlaceholderText}
              onChange={(e) => {
                setOtherText(e.target.value);
                setSelected(otherIndex); // typing auto-selects "Other"
              }}
            />
            <span className="clarif-other-mark" aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="clarif-foot">
        <div className="clarif-hints" aria-hidden="true">
          <span className="clarif-hint">
            <span className="clarif-kbd">↑↓</span>
            {localize({ en: 'move', ar: 'تنقّل' }, lang)}
          </span>
          <span className="clarif-hint">
            <span className="clarif-kbd">↵</span>
            {localize({ en: 'confirm', ar: 'تأكيد' }, lang)}
          </span>
          {onDismiss && (
            <span className="clarif-hint">
              <span className="clarif-kbd">esc</span>
              {localize({ en: 'skip', ar: 'تخطي' }, lang)}
            </span>
          )}
        </div>
        <div className="clarif-actions">
          {onDismiss && (
            <button type="button" className="clarif-btn clarif-btn-ghost" onClick={onDismiss} disabled={disabled}>
              {localize({ en: 'Skip', ar: 'تخطي' }, lang)}
            </button>
          )}
          <button
            type="button"
            className="clarif-btn clarif-btn-confirm"
            onClick={confirm}
            disabled={disabled || !canConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ClarificationCard;
