// SADEEM — toast stack. Severity-aware notifications (info/success/warn/error)
// rendered through a portal to document.body so they float above every panel
// and modal (z 95 — above the auth screen, below the tab context menu).
//
// Sources:
//   • pushToast() — direct API for any component (no store changes needed);
//   • the store's transient `notice` is bridged in read-only, so every
//     existing notify() call becomes a real toast instead of a status chip.
//
// Rules: max 4 visible (older drop), auto-dismiss 4s (errors 7s), entrance +
// exit run on the shared styles.css toast keyframes (which honor
// prefers-reduced-motion and html.reduce-motion). Flat card: matte fill,
// status-colored start-edge bar (ok/warn/bad/info), title line + mono
// timestamp, quiet close button. The stack sits TOP-END (below the 44px
// title bar, inline-end corner) — portal machinery and stacking unchanged.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useStore } from '../store';
import { useT } from '../i18n';

export type ToastSeverity = 'info' | 'success' | 'warn' | 'error';

export interface ToastItem {
  id: number;
  severity: ToastSeverity;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  duration: number;
  exiting?: boolean;
}

export interface ToastInput {
  title: string;
  severity?: ToastSeverity;
  /** Optional inline action (e.g. "Undo", "View diff"). */
  actionLabel?: string;
  onAction?: () => void;
  /** Override the default 4s (7s for errors). */
  duration?: number;
}

const MAX_TOASTS = 4;
const EXIT_MS = 150;

let nextId = 1;
let toasts: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

const emit = (): void => {
  for (const l of listeners) l(toasts);
};

/** Drop a toast (first fades it out, then removes it from the stack). */
export function dismissToast(id: number): void {
  const item = toasts.find((t) => t.id === id);
  if (!item || item.exiting) return;
  item.exiting = true;
  emit();
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, EXIT_MS);
}

/** Push a toast onto the stack (oldest drops when more than 4 are visible). */
export function pushToast(input: ToastInput): void {
  const severity: ToastSeverity = input.severity ?? 'info';
  const duration = input.duration ?? (severity === 'error' ? 7000 : 4000);
  toasts = [...toasts, { id: nextId++, severity, title: input.title, actionLabel: input.actionLabel, onAction: input.onAction, duration }].slice(
    -MAX_TOASTS,
  );
  emit();
}

/** Heuristic severity for plain notify() strings (error wording → error).
 *  v11.23 — the founder's honest-error keys are bilingual; an Arabic failure
 *  message must NOT be misclassified as an info toast. Cover both languages
 *  and the exact canonical error phrasing from i18n.ts (err.run.* / err.setup.*). */
function severityFor(text: string): ToastSeverity {
  if (
    /fail|error|denied|too large|couldn'?t|cannot|not started|unavailable|insufficient|no api key|no model|nothing to send|rate.?limit|invalid request/i.test(text) ||
    /فشل|تعذّر|تعذر|خطأ|لم يبدأ|لا يوجد|غير متاح|رصيد غير كاف|لا شيء للإرسال|مفتاح|نموذج|يحدّد الطلبات|طلب غير صالح/i.test(text)
  ) return 'error';
  return 'info';
}

const SEV_ICON: Record<ToastSeverity, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
};

function ToastRow({ item }: { item: ToastItem }) {
  const t = useT();
  // auto-dismiss timer (starts on mount; errors live longer via `duration`)
  useEffect(() => {
    const iv = window.setTimeout(() => dismissToast(item.id), item.duration);
    return () => window.clearTimeout(iv);
  }, [item.id, item.duration]);

  const Icon = SEV_ICON[item.severity];
  return (
    <div
      className={`toast sc-toast toast-${item.severity} toast-spring ${item.exiting ? 'toast-exit' : ''}`}
      role="status"
      aria-live="polite"
    >
      {/* v11.11 (A9-DESIGN) — success gets a tiny pop: the check lands with a
          soft overshoot (transform/opacity only, polish.css) */}
      <Icon
        size={14}
        strokeWidth={1.8}
        className={`toast-ico shrink-0${item.severity === 'success' ? ' toast-ok-pop' : ''}`}
        aria-hidden
      />
      <div className="flex-1 min-w-0 text-[12px] font-medium leading-snug break-words">
        <span dir="auto">{item.title}</span>
        {/* mono timestamp — the instrument-panel voice */}
        <div className="sc-toast-ts" dir="ltr">
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      </div>
      {item.actionLabel && item.onAction && !item.exiting && (
        <button
          className="toast-action shrink-0"
          onClick={() => {
            item.onAction?.();
            dismissToast(item.id);
          }}
        >
          <span dir="auto">{item.actionLabel}</span>
        </button>
      )}
      <button
        className="toast-x ibtn shrink-0"
        aria-label={t('toast.dismiss', 'Dismiss')}
        title={t('toast.dismiss', 'Dismiss')}
        onClick={() => dismissToast(item.id)}
      >
        <X size={12} strokeWidth={1.8} />
      </button>
    </div>
  );
}

export function Toasts() {
  const t = useT();
  const [list, setList] = useState<ToastItem[]>(toasts);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);

  // ---- store bridge (read-only): every notify() becomes a toast ----
  const notice = useStore((s) => s.notice);
  const lastNotice = useRef<string | null>(null);
  useEffect(() => {
    if (!notice) {
      lastNotice.current = null;
      return;
    }
    if (notice === lastNotice.current) return;
    lastNotice.current = notice;
    pushToast({ title: notice, severity: severityFor(notice) });
  }, [notice]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    // top-end stack: inline style re-anchors the shared .toast-stack below
    // the 44px title bar (portal + z-order machinery unchanged; the
    // inline-end edge + width still come from the stylesheet, RTL-safe).
    <div
      className="toast-stack"
      style={{ top: 50, bottom: 'auto' }}
      aria-label={t('toast.region', 'Notifications')}
    >
      {list.map((item) => (
        <ToastRow key={item.id} item={item} />
      ))}
    </div>,
    document.body,
  );
}

export default Toasts;
