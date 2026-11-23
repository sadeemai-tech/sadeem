// SADEEM UI primitives — shared by all feature components.
// AURORA WORKSPACE voice: Modal = matte raised panel (.glass-strong,
// 14px radius, layered float shadow) on the app's single sanctioned
// blurred scrim (.scrim-glass + --scrim tint); IconBtn = .ibtn
// instrument button; Toggle = soft pill .tog switch; SectionTitle =
// numbered "01 — TITLE" header. Exports + prop signatures unchanged.
import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useT } from '../i18n';

// ---------- shared formatting helpers ----------

/** Platform-aware shortcut modifier: ⌘ on macOS, Ctrl elsewhere. */
export const MOD_KEY: string =
  typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform) ? '⌘' : 'Ctrl';

/**
 * Smart cost format: $0.00 when zero; otherwise up to 4 decimals with
 * trailing zeros stripped, but never fewer than 2 decimals.
 * e.g. 0 → "$0.00", 0.0143 → "$0.0143", 0.14 → "$0.14", 1.5 → "$1.50".
 */
export function fmtCost(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0.00';
  const [int, dec = ''] = n.toFixed(4).split('.');
  const trimmed = dec.replace(/0+$/, '');
  const padded = (trimmed + '00').slice(0, Math.max(2, trimmed.length));
  return `$${int}.${padded}`;
}

/** "anthropic/claude-sonnet-4.5" → "claude-sonnet-4.5" (drops provider prefix). */
export function shortModel(modelId: string): string {
  return modelId.split('/').pop() || modelId;
}

export function Btn({
  variant = 'default',
  className = '',
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger' }) {
  const v =
    variant === 'primary'
      ? 'btn btn-primary'
      : variant === 'ghost'
        ? 'btn btn-ghost'
        : variant === 'danger'
          ? 'btn btn-danger'
          : 'btn';
  return (
    // .press: tactile press feedback (glass-v7 micro-interaction layer)
    <button className={`${v} press ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function IconBtn({
  className = '',
  children,
  active,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  // .ibtn: 26px instrument button — quieter than .icon-btn
  return (
    <button className={`ibtn press ${active ? 'is-on' : ''} ${className}`} {...rest}>
      {children}
    </button>
  );
}

// Module-level stack of open modal ids — only the TOPMOST modal responds to
// Esc, so stacked dialogs (e.g. DiffModal above PlansScreen) close in order.
const modalStack: symbol[] = [];

/** Flatten a ReactNode to plain text (for aria-label derivation). */
function ariaTextOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(ariaTextOf).filter(Boolean).join(' ');
  if (React.isValidElement(node)) {
    return ariaTextOf((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 560,
  footer,
  z = 50,
  ariaLabel,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  width?: number;
  footer?: React.ReactNode;
  /** Stacking level — raise above other overlays (e.g. 75 for DiffModal over PlansScreen). */
  z?: number;
  /** Accessible dialog name; derived from `title` when omitted. */
  ariaLabel?: string;
}) {
  const t = useT();
  const idRef = useRef<symbol | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // stack membership + initial focus + focus restore
  useEffect(() => {
    if (!open) return;
    const id = Symbol('surnia-modal');
    idRef.current = id;
    modalStack.push(id);
    restoreRef.current = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      const i = modalStack.indexOf(id);
      if (i >= 0) modalStack.splice(i, 1);
      cancelAnimationFrame(raf);
      restoreRef.current?.focus?.();
      restoreRef.current = null;
      idRef.current = null;
    };
  }, [open]);

  // Esc (topmost modal only) + Tab focus trap
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (modalStack[modalStack.length - 1] === idRef.current) {
          e.stopPropagation();
          onClose();
        }
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        // never fight Monaco — it manages Tab (indentation) itself
        const target = e.target as HTMLElement | null;
        if (target?.closest?.('.monaco-editor')) return;
        const dialog = dialogRef.current;
        const focusables = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (!active || !dialog.contains(active)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && (active === first || active === dialog)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  if (!open) return null;
  const label = ariaLabel ?? (ariaTextOf(title) || 'Dialog');
  return (
    <div
      className="scrim-glass fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ zIndex: z, background: 'var(--scrim)' }}
      data-modal-open="true"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="glass-strong flex flex-col max-h-[86vh] anim-glass-pop focus:outline-none"
        style={{
          width,
          maxWidth: '96vw',
          borderRadius: 'var(--radius-lg, 14px)',
          boxShadow: 'var(--sh-float)',
        }}
      >
        <div className="flex items-center gap-3 ps-5 pe-3 h-12 border-b border-[var(--line)] shrink-0">
          <div className="caps caps-md min-w-0 truncate">{title}</div>
          <span className="flex-1" />
          {/* 32px hit target (icon stays 15px) */}
          <button className="ibtn !w-8 !h-8" onClick={onClose} aria-label={t('ui.close', 'Close')}>
            <X size={15} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
        {footer && <div className="px-5 py-3.5 border-t border-[var(--line)] shrink-0">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block mb-3.5">
      <div className="micro-label mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-[10.5px] text-[var(--faint)] mt-1 tnum" dir="ltr">{hint}</div>}
    </label>
  );
}

export function TextInput({
  className = '',
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`} {...rest} />;
}

export function Select({
  className = '',
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`input ${className}`} {...rest}>
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  // soft pill switch — knob travel handled by the .tog CSS
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`tog ${checked ? 'is-on' : ''}`}
    />
  );
}

export function Chip({
  tone = 'default',
  children,
  className = '',
  title,
}: {
  tone?: 'default' | 'acc' | 'ok' | 'bad' | 'warn';
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  const c =
    tone === 'acc' ? 'chip chip-acc' : tone === 'ok' ? 'chip chip-ok' : tone === 'bad' ? 'chip chip-bad' : tone === 'warn' ? 'chip chip-warn' : 'chip';
  return (
    <span className={`${c} ${className}`} title={title}>
      {children}
    </span>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="spin" aria-label="loading">
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--line)" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="var(--acc)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Empty({
  icon,
  title,
  sub,
  hint,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  sub?: string;
  /** Optional kbd hint row (e.g. ⌘K palette) — the empty-state voice. */
  hint?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-6 anim-in">
      {icon && <div className="mb-3 text-[var(--faint)]">{icon}</div>}
      <div className="text-[13px] font-semibold mb-1">{title}</div>
      {sub && <div className="text-[11.5px] text-[var(--dim)] max-w-[260px]">{sub}</div>}
      {hint && <div className="bs-hint mt-3">{hint}</div>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function Kbd({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  // matte keycap at the --r-xs radius (Aurora voice: quiet, no glass)
  return (
    <span className={`kbd ${className}`} style={{ borderRadius: 'var(--r-xs, 6px)' }}>
      {children}
    </span>
  );
}

/**
 * Numbered contract section header — "01 — TITLE" with a hairline rule.
 * `<SectionTitle no="01" title="Workspace" />` renders the .sec-titled
 * grammar; the legacy children form still renders .sec-head.
 */
export function SectionTitle({
  no,
  title,
  children,
}: {
  no?: string;
  title?: string;
  children?: React.ReactNode;
}) {
  if (no && title) {
    return (
      <div className="sec-titled">
        <span className="sec-no">{no}</span>
        <span className="sec-tt">{title}</span>
        <span className="sec-rule" />
      </div>
    );
  }
  // 11px uppercase panel-section voice — dim, tracked (v2 rhythm)
  return <div className="sec-head">{children}</div>;
}
