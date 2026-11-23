// ============================================================
// SADEEM settings — reusable controls (owned by the settings UI).
// AURORA edition: Toggle / Slider / NumberInput / Segmented /
// SettingRow / SectionShell / GroupCard / InfoNote. Cards are
// .aurora-panel raised top-light panels at the 10px radius; the
// .tog switch and .stamp-seg instrument stay from SURVEYOR v4.
// RTL-safe (logical properties), every control keyboard accessible.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { useT } from '../../i18n';
import { useStore } from '../../store';
import { IconBtn } from '../ui';

// ---------------- Toggle (square instrument switch on .tog) ----------------
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Accessible name when the row text is not a <label> wrapping the control. */
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`tog ${checked ? 'is-on' : ''} disabled:opacity-50`}
    />
  );
}

// ---------------- Slider ----------------
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  disabled,
  suffix,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label?: string;
  disabled?: boolean;
  /** Unit shown next to the numeric readout, e.g. "%" or "px". */
  suffix?: string;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className="flex items-center gap-2.5 min-w-[190px]">
      <input
        type="range"
        className="set-slider flex-1"
        dir="ltr"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => onChange(clamp(e.target.valueAsNumber))}
      />
      <span
        className="tnum text-[12px] text-dim w-12 text-center shrink-0"
        aria-hidden
      >
        {value}
        {suffix ? <span className="text-[10px] text-[var(--faint)]">{suffix}</span> : null}
      </span>
    </div>
  );
}

// ---------------- NumberInput ----------------
export function NumberInput({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  disabled,
  placeholder,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState<string>(String(value));
  const focused = useRef(false);
  const t = useT();
  // v1131 — control-internal accessible names must be bilingual too; hardcoding
  // "decrease"/"increase" leaked English into the Arabic UI.
  const ar = useStore((s) => s.settings?.language === 'ar');

  // Sync external changes (reset, undo) while not being edited.
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const commit = (raw: string) => {
    const n = parseInt(raw, 10);
    const next = Number.isFinite(n) ? clamp(n) : clamp(value);
    setText(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <div className="flex items-center gap-1" dir="ltr">
      <IconBtn
        onClick={() => commit(String(clamp(value - step)))}
        disabled={disabled || value <= min}
        aria-label={label ? `${t('set.ctl.decrease.v1131', ar ? 'إنقاص' : 'Decrease')} ${label}` : t('set.ctl.decrease.v1131', ar ? 'إنقاص' : 'Decrease')}
        tabIndex={-1}
      >
        <Minus size={12} />
      </IconBtn>
      <input
        className="input tnum w-16 text-center"
        inputMode="numeric"
        dir="ltr"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={label}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onBlur={(e) => {
          focused.current = false;
          commit(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value);
          e.stopPropagation(); // keep the modal's Escape handler predictable
        }}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d-]/g, '');
          setText(raw);
          const n = parseInt(raw, 10);
          if (Number.isFinite(n)) onChange(clamp(n)); // live patch, clamped
        }}
      />
      <IconBtn
        onClick={() => commit(String(clamp(value + step)))}
        disabled={disabled || value >= max}
        aria-label={label ? `${t('set.ctl.increase.v1131', ar ? 'زيادة' : 'Increase')} ${label}` : t('set.ctl.increase.v1131', ar ? 'زيادة' : 'Increase')}
        tabIndex={-1}
      >
        <Plus size={12} />
      </IconBtn>
    </div>
  );
}

// ---------------- TextRow (single-line text input, mono option) ----------------
export function TextRow({
  value,
  onChange,
  label,
  placeholder,
  mono,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
}) {
  const [text, setText] = useState<string>(value);
  const focused = useRef(false);
  const t = useT();
  const ar = useStore((s) => s.settings?.language === 'ar');

  // Sync external changes (reset, undo) while not being edited.
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);

  return (
    <input
      type="text"
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      dir={mono ? 'ltr' : undefined}
      spellCheck={false}
      autoComplete="off"
      aria-label={label ?? t('set.ctl.value.v1131', ar ? 'قيمة' : 'Value')}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        if (text !== value) onChange(text);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        }
        e.stopPropagation(); // keep composer shortcuts out of settings fields
      }}
      className={`set-input h-[26px] w-[210px] px-2 text-[11.5px] outline-none transition-colors disabled:opacity-45${
        mono ? ' font-code tracking-tight' : ''
      }`}
    />
  );
}

// ---------------- Segmented (stamps row on .stamp-seg) ----------------
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="stamp-seg"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={active ? 'is-active' : ''}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------- SettingRow (definition-list row on .defrow) ----------------
/** A single labelled control row: label + hint left, control right. */
export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="defrow">
      <div className="min-w-0">
        <div className="def-label">{label}</div>
        {hint && <div className="def-desc">{hint}</div>}
      </div>
      <div className="def-ctl flex items-center">{children}</div>
    </div>
  );
}

// ---------------- GroupCard ----------------
/** An Aurora card: raised top-light panel (.aurora-panel) with a caps
 *  micro-label. Roomy 16px padding + consistent 12px rhythm (RTL-safe). */
export function GroupCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="aurora-panel set-card">
      {title && (
        <div className="caps text-[11px] text-[var(--faint)] mb-3 set-card-tt">
          {title}
        </div>
      )}
      {children}
    </section>
  );
}

// ---------------- SectionShell ----------------
/**
 * Numbered section header ("01 — Title") wrapped around section content.
 * `no` renders the SADEEM index (caps + tabular figures, quiet --faint;
 * the h2 title stays for a11y + i18n.
 */
export function SectionShell({
  titleKey,
  titleFallback,
  desc,
  onReset,
  no,
  children,
}: {
  titleKey: string;
  titleFallback: string;
  desc?: string;
  onReset?: () => void;
  /** Two-digit section index rendered as the clay "01" marker. */
  no?: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <section className="set-section">
      <div className="sec-titled mb-2">
        {no && <span className="sec-no caps tnum">{no}</span>}
        <h2 className="sec-tt m-0">{t(titleKey, titleFallback)}</h2>
        <span className="sec-rule" />
        {onReset && (
          <IconBtn
            className="!w-6 !h-6"
            onClick={onReset}
            title={t('settings.reset', 'Reset to defaults')}
            aria-label={t('settings.reset', 'Reset to defaults')}
          >
            <RotateCcw size={12} />
          </IconBtn>
        )}
      </div>
      {desc && <p className="text-[11.5px] leading-relaxed text-dim mb-3.5 mt-1">{desc}</p>}
      <div className={desc ? '' : 'mt-2.5'}>{children}</div>
    </section>
  );
}

// ---------------- InfoNote ----------------
/** Read-only informational card (used where a control honestly isn't supported).
 *  Aurora voice: quiet recessed well at the 8px radius. */
export function InfoNote({ children }: { children: ReactNode }) {
  return <div className="set-note">{children}</div>;
}
