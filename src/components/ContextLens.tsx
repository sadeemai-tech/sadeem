// SADEEM — Context Lens (v7.2 signature feature 7c).
// A lens over the session's context, docked in the chat header: clicking the
// compact usage chip opens a popover with the model id, the context window
// fill (segments when provider cache data exists — cache read / cache write /
// fresh — otherwise the honest session total), the session cost and a
// "Compact now" action (the existing /compact command path).
// HONESTY CONTRACT: the renderer only ever receives session totals (+ the
// provider cache split). No invented system/tools/files segments — when only
// the total is known, only the total is shown.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Copy, Gauge } from 'lucide-react';
import { useStore } from '../store';
import {
  ctxFillTokens,
  liveFillEstimate,
  remainingContextTokens,
  formatContextBreakdown,
  contextFillPercent,
  occupancySegments,
  tokenCountSource,
  isOneMClassWindow,
} from '../lib/ctx';
import { api } from '../lib/api';
import { useT, useDigits } from '../i18n';
import { fmtCost } from './ui';
import './chat-final.css';
import './context-orb.css';

// v11.21 — the straight usage strip is REPLACED by a radial context orb that
// reuses the status-bar circle art language (one 2πr donut, exact arc = used%).
// These primitives are exported so the geometry can be verified independently
// of React — the arc is never rounded, or the 2πr contract would break.
export const ORB_SIZE = 32;
export const ORB_STROKE = 2.5;
export const ORB_RADIUS = (ORB_SIZE - 3.5) / 2;
export const ORB_CIRCUMFERENCE = 2 * Math.PI * ORB_RADIUS;

/** Exact arc length for a percentage — no rounding, geometry stays honest. */
export function orbArcLength(pct: number, radius = ORB_RADIUS): number {
  const clamped = Math.max(0, Math.min(100, pct));
  return (clamped / 100) * (2 * Math.PI * radius);
}

/** "Anthropic (Claude)" -> "Anthropic" (same rule as the status bar). */
const shortProvider = (label: string): string => label.replace(/\s*\(.*\)$/, '').trim();

/** 12345 → "12.3k" for the collapsed chip (same rule as the header chip). */
const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// v11.35 — single-language honesty labels for the popover. Each entry is an
// [English, Arabic] pair; one render emits ONE language only (never a mixed
// sentence). Kept local so no other agent's i18n.ts is touched.
const LENS_TEXT = {
  source: ['Source', 'المصدر'],
  sourceExact: ['Exact — provider reported usage', 'دقيق — المزوّد أبلغ عن الاستخدام'],
  sourceEstimate: ['Estimated — no provider usage reported', 'تقديري — لم يبلغ المزوّد عن استخدام'],
  sourceNone: ['No usage reported yet', 'لم يُبلَّغ عن استخدام بعد'],
  streaming: [
    'Live estimate (script-aware) — replaced by exact usage on completion',
    'تقدير حيّ (حسب نوع الحروف) — يُستبدل بالاستخدام الدقيق عند الاكتمال',
  ],
  windowUnknown: [
    'Window unknown — no catalog entry',
    'حجم النافذة غير معروف — لا يوجد سجل في الكتالوج',
  ],
  windowKnown: [
    'Window: confirmed from model catalog',
    'حجم النافذة: مؤكَّد من كتالوج النموذج',
  ],
} as const;
type LensTextKey = keyof typeof LENS_TEXT;
const lt = (key: LensTextKey, lang: 'en' | 'ar'): string => LENS_TEXT[key][lang === 'ar' ? 1 : 0];
/** Exported for the v11.35 monolingual-label guard (pure, no DOM). */
export const lensText = lt;

/**
 * v11.21 — `compact` mounts the SAME precise orb in the composer, directly
 * next to the voice-input mic, replacing the old straight context strip.
 * It is the ONLY context indicator in the UI (the chat-header copy and the
 * status-bar copy are intentionally removed) — no duplicate rings.
 */
export function ContextLens({ compact = false }: { compact?: boolean } = {}) {
  const t = useT();
  const n = useDigits();
  const usage = useStore((s) => s.lastTurnUsage); // v11.3 — the REAL context fill (last turn)
  const sessionTotals = useStore((s) => s.sessionUsage); // session cost stays cumulative
  const ctxWindow = useStore((s) => s.ctxWindow);
  const ctxWindowEstimated = useStore((s) => s.ctxWindowEstimated); // v11.10 (A5) — ≈ marker
  const running = useStore((s) => s.running);
  const liveStreamChars = useStore((s) => s.liveStreamChars); // v11.10 (A5) — live ≈ estimate
  const model = useStore((s) => s.settings.model);
  const sendMessage = useStore((s) => s.sendMessage);
  const setModelPicker = useStore((s) => s.setModelPicker);

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  // v11.31 — the one-shot "Copied" reset must never fire after unmount (the
  // composer can be torn down on a session/focus switch mid-confirmation).
  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    },
    [],
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  // v11.26 — the composer is an overflow/transform context that CLIPS an
  // absolutely-positioned child (that is why the card landed in a corner).
  // When open, pin the card with FIXED coordinates measured from the real orb.
  const [popStyle, setPopStyle] = useState<React.CSSProperties | null>(null);
  const rtl = useStore((s) => s.settings.language === 'ar');

  // v11.34 (CTX-1) — the orb resolves the model's REAL window from the provider
  // catalog itself. StatusBar does the same fetch, but it is unmounted in focus
  // mode and a cold catalog can leave a stale 200k: this keeps the meter honest
  // regardless of which chrome is on screen. Both paths converge on one value.
  useEffect(() => {
    let alive = true;
    let retry: number | null = null;
    const resolveWindow = () => {
      void api
        .modelInfo(model.model)
        .then((info) => {
          if (!alive || !info || !(info.contextWindow > 0)) return;
          const st = useStore.getState();
          const estimated = info.ctxEstimated === true;
          if (st.ctxWindow === info.contextWindow && st.ctxWindowEstimated === estimated) return;
          // v1137 — never DOWNGRADE a confirmed 1M-class window to an ≈200k
          // default (a stale catalog answer must not re-hide the real window).
          if (!st.ctxWindowEstimated && isOneMClassWindow(st.ctxWindow) && estimated) return;
          st.setCtxWindow(info.contextWindow);
          st.setCtxWindowEstimated(estimated);
          // A cold/offline start has no live catalog. Retry shortly after so a
          // catalog that finishes loading in the background upgrades the orb.
          if (estimated && retry === null) {
            retry = window.setTimeout(() => {
              retry = null;
              resolveWindow();
            }, 1500);
          }
        })
        .catch(() => {
          /* keep the last honest window — never invent a number */
        });
    };
    resolveWindow();
    // The live catalog is fetched when the model picker opens / a provider is
    // enabled. Coming back to the chat must pick up the provider window.
    const onFocus = () => resolveWindow();
    const onVisible = () => { if (!document.hidden) resolveWindow(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      if (retry !== null) window.clearTimeout(retry);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [model.model]);

  // v11.35 — the ONLY exact token source is the provider's reported usage.
  // The renderer receives a liveStreamChars COUNTER (never the text), so the
  // streaming tail uses a script profile from the UI language: an Arabic
  // session is not measured with the Latin chars/4 rate. It stays "≈".
  const ctxFill = ctxFillTokens(usage);
  const usageSource = tokenCountSource(usage);
  const streaming = running && liveStreamChars > 0;
  const liveEstimate = streaming
    ? liveFillEstimate(ctxFill, liveStreamChars, rtl ? 'arabic' : 'latin')
    : null;
  const fillShown = liveEstimate ?? ctxFill;
  // v11.34 — null ⇒ NO trustworthy percentage (unknown window, or an ≈-default
  // the fill has already outgrown). The arc stays at 0 and the centre shows the
  // token count instead of a false "100% when there is still room".
  const realPct = contextFillPercent(fillShown, ctxWindow, ctxWindowEstimated);
  const pctExact = realPct ?? 0; // geometry input — kept unrounded for 2πr
  const ctxPct = Math.round(pctExact);
  const approx = streaming || ctxWindowEstimated || usage?.estimated === true;
  const unknown = realPct === null;
  // v11.35 — session totals are cumulative; if any turn was an engine estimate
  // the whole displayed total (and its cost) must carry the "≈" marker too.
  const sessionApprox = sessionTotals.estimated === true || usage?.estimated === true;
  const lang: 'en' | 'ar' = rtl ? 'ar' : 'en';
  const sourceKey: LensTextKey = usageSource === 'provider'
    ? 'sourceExact'
    : usageSource === 'estimated' ? 'sourceEstimate' : 'sourceNone';
  const cacheRead = usage?.cacheReadTokens ?? 0;
  const cacheWrite = usage?.cacheCreationTokens ?? 0;
  const hasCache = cacheRead + cacheWrite > 0;
  const hasData = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) > 0;

  // v11.27 — the orb is ALWAYS mounted, even on a fresh session BEFORE the
  // first provider usage report (the founder's "context tab does not appear"
  // bug). `hasData` is no longer a visibility gate: it only decides whether
  // the centre prints a real figure or an honest em-dash — "—" means "nothing
  // measured YET", never a misleading "0%" that would imply a known, empty
  // window. The single 2πr arc, one-mount, no-strip and reduced-motion
  // contracts are untouched.
  const noData = !hasData;

  // v11.21 — circle replaces the strip. The SAME real pctExact drives the arc
  // (exact 2πr math); only the presentation changes, never the numbers.
  // The compact composer copy uses the identical geometry at a smaller size —
  // same stroke, same -90° start, same radius formula, no rounded arc.
  const ORB = compact ? 22 : ORB_SIZE;
  const RADIUS = (ORB - 3.5) / 2;
  const CIRC = 2 * Math.PI * RADIUS;
  const orbArc = orbArcLength(pctExact, RADIUS);
  const orbTone = unknown
    ? 'var(--ghost)'
    : pctExact >= 90
      ? 'var(--bad)'
      : pctExact >= 70
        ? 'var(--warn)'
        : 'var(--acc)';
  // Honest centre label: an em-dash until real usage arrives, then the token
  // count when the window is still unknown, else the exact rounded percentage.
  const centerText = noData ? '—' : unknown ? fmtTokens(fillShown) : `${ctxPct}%`;

  // dismiss: outside click + Esc (popover-local, stops before app handlers)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
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

  // v11.26 — measure the orb and pin the card inside the viewport. Recompute on
  // open, scroll and resize. No measurement is read before layout (SSR keeps the
  // CSS fallback), so first paint can never place it in the corner.
  useLayoutEffect(() => {
    if (!open) { setPopStyle(null); return; }
    const place = () => {
      const el = wrapRef.current;
      if (!el || typeof window === 'undefined') return;
      const r = el.getBoundingClientRect();
      const width = Math.min(280, window.innerWidth - 24);
      const height = 330; // card max-height (bounded by CSS)
      let left = rtl ? r.right - width : r.left;
      left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
      const above = r.top - height - 8;
      const top = above >= 12 ? above : Math.min(r.bottom + 8, window.innerHeight - height - 12);
      // v11.31 — the stylesheet's compact override still carries the header-era
      // `bottom: calc(100% + 8px)` and `inset-inline-end: 0`. Left as-is they
      // FIGHT this fixed placement: with position:fixed the containing block
      // is the viewport, so `bottom: calc(100% + 8px)` resolves to ~viewport
      // height and an auto-height card collapses to zero (or lands off-screen).
      // Cancel both logical/physical insets inline (inline wins over the CSS)
      // so the measured left/top are the ONLY position sources — this is the
      // "orb popover hidden / off-position" fix, kept inside the owned file.
      setPopStyle({
        position: 'fixed',
        // React applies style keys in insertion order. Set the logical inset
        // FIRST so the physical `left` below is the last write for that side
        // in RTL (where inset-inline-end maps to left) — otherwise `auto`
        // would win and lose the measured, clamped position.
        insetInlineEnd: 'auto',
        left,
        top: Math.max(12, top),
        bottom: 'auto',
        right: 'auto',
        margin: 0,
        width,
        maxHeight: height,
        overflowY: 'auto',
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, rtl, compact]);

  // v11.27 — NO early return. The compact orb is a permanent fixture beside
  // the mic: on a fresh session it renders a hollow ghost ring, an honest
  // "—" centre and an empty 0-length arc until the first provider report.
  // Clicking it still opens the same measured, viewport-clamped popover.

  // v11.34 (CTX-1) — DISJOINT segments of ONE fill. The old bar painted
  // `fill` AND `generated` on top of each other when no cache split existed,
  // making the meter look full (the founder's double-count). The pure helper
  // guarantees cache-read + cache-write + fresh + generated + streamed === fill.
  const segments = occupancySegments(usage, fillShown);
  const generatedSeg = segments.generated;
  const segFresh = segments.fresh;
  // v11.11 (A6) — segments are shares of the WINDOW (not of the fill): the
  // painted spans now sum to EXACTLY fill/window — the bar's fullness is the
  // same number the label prints ("12,482 / 200,000 · 6.2%"). The old code
  // painted 100% of the track whenever cache data existed, regardless of fill.
  const pctOf = (v: number): string => `${ctxWindow > 0 ? (v / ctxWindow) * 100 : 0}%`;

  const tip = unknown
    ? t('sb.ring.ctxUnknown', '{u} tokens used — window size unknown', { u: n(fillShown) })
    : t('sb.ring.ctxOfExact', '{a}{u} / {l} tokens ({p}%)', {
        a: approx ? '≈ ' : '',
        u: n(fillShown),
        l: n(ctxWindow),
        p: pctExact.toFixed(1),
      });

  // v12 (E) — remaining window budget + copy-friendly plain-text breakdown.
  const remaining = remainingContextTokens(fillShown, ctxWindow);
  const copyBreakdown = async () => {
    const text = formatContextBreakdown({
      model: `${model.provider}/${model.model}`,
      fill: fillShown,
      window: ctxWindow,
      windowEstimated: ctxWindowEstimated,
      approximate: approx,
      cacheRead,
      cacheWrite,
      generated: generatedSeg,
      sessionTotal: sessionTotals.inputTokens + sessionTotals.outputTokens,
      sessionCostUsd: sessionTotals.costUsd,
      // v11.35 — single-language output + per-figure honesty markers.
      lang,
      sessionEstimated: sessionApprox,
      source: usageSource,
    });
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // headless / insecure-context fallback — never fail silently
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => {
        copiedTimerRef.current = null;
        setCopied(false);
      }, 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    // v11.26 — SELF-CONTAINED positioned anchor. The popover below is
    // `position:absolute`; it MUST resolve against this wrapper, never the
    // initial containing block (which would drop it at the viewport corner,
    // off-screen, on the very first paint). `relative` is kept for Tailwind,
    // but `ctx-orb-anchor` carries `position:relative` in context-orb.css so
    // the containing block exists even before utility CSS is applied.
    <div
      className={`ctx-orb-anchor${compact ? ' ctx-orb-anchor--compact' : ''} relative shrink-0`}
      ref={wrapRef}
    >
      <button
        className={`ctx-orb${compact ? ' ctx-orb--compact' : ''}`}
        title={`${t('chat.lens.title', 'Context lens')} — ${tip}`}
        aria-label={`${t('chat.lens.title', 'Context lens')} — ${tip}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ctx-orb-ring" aria-hidden="true">
          <svg viewBox={`0 0 ${ORB} ${ORB}`} width={ORB} height={ORB} focusable="false">
            <circle
              cx={ORB / 2}
              cy={ORB / 2}
              r={RADIUS}
              fill="none"
              stroke="var(--line-strong, var(--line))"
              strokeWidth={ORB_STROKE}
              opacity={0.65}
            />
            {/* exact 1px registration tick at 12 o'clock — craft grammar shared
                with the thinking orb; no blur, no gradient, no drift. */}
            <path
              d={`M${ORB / 2} 1v2`}
              stroke="var(--line-strong, var(--line))"
              strokeWidth="1"
              opacity={0.75}
            />
            <circle
              className="ctx-orb-arc"
              cx={ORB / 2}
              cy={ORB / 2}
              r={RADIUS}
              fill="none"
              stroke={orbTone}
              strokeWidth={ORB_STROKE}
              strokeLinecap="round"
              strokeDasharray={`${orbArc} ${CIRC}`}
              transform={`rotate(-90 ${ORB / 2} ${ORB / 2})`}
            />
          </svg>
          <span className="ctx-orb-value bidi-num" dir="ltr">{centerText}</span>
        </span>
        {!compact && <span className="ctx-orb-label">{t('sb.ring.ctx', 'Context')}</span>}
      </button>

      {open && (
        <div
          className="lens-haircard"
          style={popStyle ?? undefined}
          role="dialog"
          aria-label={t('chat.lens.title', 'Context lens')}
        >
          {/* model id + change — quiet hairline header */}
          <div className="lens-head">
            <Gauge size={12} className="text-acc shrink-0" aria-hidden />
            <span className="lens-eyebrow">
              {t('chat.lens.title', 'Context lens')}
            </span>
            <span
              className="bidi-num font-code text-[11px] truncate min-w-0 flex-1 text-end"
              dir="ltr"
              title={`${model.provider}/${model.model}`}
            >
              {model.model.split('/').pop()}
            </span>
            <button
              className="text-[10px] text-acc hover:underline shrink-0 cursor-pointer"
              onClick={() => {
                setOpen(false);
                setModelPicker(true);
              }}
            >
              {t('sb.ring.openPicker', 'Change model')}
            </button>
          </div>

          {/* FINAL POLISH — mono context stats, all derived from real data. */}
          <div className="lens-stats" dir="ltr">
            <span>
              {unknown
                ? n(ctxFill)
                : `${approx ? '≈ ' : ''}${n(fillShown)} / ${ctxWindowEstimated ? '≈' : ''}${n(ctxWindow)}`}
            </span>
            <small>
              {unknown
                ? t('sb.ring.ctxUnknownShort', 'NO WINDOW')
                : `${approx ? '≈' : ''}${pctExact.toFixed(1)}%`}
            </small>
          </div>

          {/* v11.35 — WHERE the number came from. Exact provider usage is never
              marked ≈; an estimate is. This is the founder's sourcing demand. */}
          <div className="flex items-center justify-between gap-2 py-1 border-t border-[var(--line-soft)]">
            <span className="text-[9.5px] text-faint">{lt('source', lang)}</span>
            <span className="text-[9.5px] text-faint text-end">{lt(sourceKey, lang)}</span>
          </div>

          {/* context used / limit — v11.10 (A5): exact figures + ≈ honesty */}
          <div className="flex items-center justify-between gap-2 py-1 border-t border-[var(--line-soft)]">
            <span className="text-[11px] text-dim">{t('sb.ring.ctx', 'Context')}</span>
            <span
              className="bidi-num tnum text-[11px]"
              dir="ltr"
              style={{ fontFamily: 'var(--font-mono-x, var(--font-mono2))' }}
            >
              {unknown
                ? n(ctxFill)
                : `${approx ? '≈' : ''}${n(fillShown)} / ${ctxWindowEstimated ? '≈' : ''}${n(ctxWindow)} · ${approx ? '≈' : ''}${pctExact.toFixed(1)}%`}
            </span>
          </div>
          {streaming && (
            <div className="flex items-center justify-between gap-2 py-1">
              <span className="text-[9.5px] text-faint">{lt('streaming', lang)}</span>
              <span className="stamp !h-[15px] !text-[8.5px]">≈</span>
            </div>
          )}
          {ctxWindowEstimated && !streaming && (
            <div className="flex items-center justify-between gap-2 py-1">
              <span className="text-[9.5px] text-faint">{t('sb.ring.ctxDefault', 'Window unknown for this model — 200k default')}</span>
              <span className="stamp !h-[15px] !text-[8.5px]">≈</span>
            </div>
          )}
          {/* v1137 — a confirmed (non-≈) window is sourced from the model
              catalog / live provider; for a 1M-class model say "1M" plainly. */}
          {!ctxWindowEstimated && ctxWindow > 0 && (
            <div className="flex items-center justify-between gap-2 py-1">
              <span className="text-[9.5px] text-faint">{lt('windowKnown', lang)}</span>
              <span className="stamp !h-[15px] !text-[8.5px]">
                {isOneMClassWindow(ctxWindow) ? '1M' : '✓'}
              </span>
            </div>
          )}
          {ctxWindow <= 0 && (
            <div className="flex items-center justify-between gap-2 py-1">
              <span className="text-[9.5px] text-faint">{lt('windowUnknown', lang)}</span>
              <span className="stamp !h-[15px] !text-[8.5px]">?</span>
            </div>
          )}

          {/* v12 (E) — remaining budget: how much room is actually left. */}
          {!unknown && (
            <div className="flex items-center justify-between gap-2 py-1">
              <span className="text-[11px] text-dim">{t('sb.ring.remaining', 'Remaining')}</span>
              <span
                className="bidi-num tnum text-[11px]"
                dir="ltr"
                style={{ fontFamily: 'var(--font-mono-x, var(--font-mono2))' }}
              >
                {approx ? '≈ ' : ''}{n(remaining)}
              </span>
            </div>
          )}

          {/* window fill — segmented (cache split) when that data exists */}
          {!unknown && (
            <div className="mt-1.5">
              <div
                className="flex h-[5px] w-full overflow-hidden rounded-[2px]"
                style={{ background: 'var(--hover-2)' }}
                role="img"
                aria-label={tip}
              >
                {segments.cacheRead > 0 && <span style={{ width: pctOf(segments.cacheRead), background: 'var(--acc2)' }} />}
                {segments.cacheWrite > 0 && <span style={{ width: pctOf(segments.cacheWrite), background: 'var(--clay)' }} />}
                <span style={{ width: pctOf(segFresh), background: 'var(--acc)' }} />
                {generatedSeg > 0 && <span style={{ width: pctOf(generatedSeg), background: 'var(--ok)' }} />}
                {segments.streamed > 0 && <span style={{ width: pctOf(segments.streamed), background: 'var(--acc2)' }} />}
              </div>
              {hasCache && (
                <div className="flex items-center gap-2.5 mt-1 flex-wrap">
                  <span className="flex items-center gap-1 text-[9.5px] text-faint">
                    <span className="w-1.5 h-1.5 rounded-[1px] inline-block" style={{ background: 'var(--acc2)' }} />
                    {t('sb.ring.cacheRead', 'Cache read')} {n(cacheRead)}
                  </span>
                  <span className="flex items-center gap-1 text-[9.5px] text-faint">
                    <span className="w-1.5 h-1.5 rounded-[1px] inline-block" style={{ background: 'var(--clay)' }} />
                    {t('sb.ring.cacheWrite', 'Cache write')} {n(cacheWrite)}
                  </span>
                  <span className="flex items-center gap-1 text-[9.5px] text-faint">
                    <span className="w-1.5 h-1.5 rounded-[1px] inline-block" style={{ background: 'var(--acc)' }} />
                    {t('sb.ring.freshInput', 'Fresh input')} {n(segFresh)}
                  </span>
                  {generatedSeg > 0 && (
                    <span className="flex items-center gap-1 text-[9.5px] text-faint">
                      <span className="w-1.5 h-1.5 rounded-[1px] inline-block" style={{ background: 'var(--ok)' }} />
                      {t('sb.ring.generated', 'Generated')} {n(generatedSeg)}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* honest segments — session total (+ provider cache split only) */}
          <div className="py-1 border-t border-[var(--line-soft)] mt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-faint">{t('sb.ring.total', 'Session total')}</span>
              <span className="bidi-num tnum text-[11px]" dir="ltr">
                {sessionApprox ? '≈' : ''}{n(sessionTotals.inputTokens + sessionTotals.outputTokens)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-faint">{t('sb.ring.segments', 'Segments')}</span>
              <span className="text-[9.5px] text-faint text-end">
                {t('sb.ring.segmentsApprox', 'Approximate — only session totals are exposed')}
              </span>
            </div>
          </div>

          {/* cost — v11.10 (A5): whole-turn run totals, exactly reconciled */}
          <div className="flex items-center justify-between gap-2 py-1 border-t border-[var(--line-soft)]">
            <span className="text-[11px] text-dim">{t('sb.ring.cost', 'Session cost')}</span>
            <span className="bidi-num tnum text-[11px]" dir="ltr">
              {sessionApprox ? '≈' : ''}{fmtCost(sessionTotals.costUsd)} · {sessionApprox ? '≈' : ''}{n(sessionTotals.inputTokens + sessionTotals.outputTokens)} {t('sb.tokens', 'tokens')}
            </span>
          </div>

          {/* v12 (E) — copy the honest breakdown for pasting into issues / notes */}
          <div className="pt-2 border-t border-[var(--line-soft)] mt-1">
            <button
              className="btn w-full !h-7 !text-[11px] !px-2 justify-center"
              onClick={() => void copyBreakdown()}
              title={t('sb.ring.copyHint', 'Copy a text summary of this context breakdown')}
            >
              {copied ? <Check size={11} className="text-ok" aria-hidden /> : <Copy size={11} aria-hidden />}
              {copied
                ? t('sb.ring.copied', 'Copied')
                : t('sb.ring.copy', 'Copy breakdown')}
            </button>
          </div>

          {/* compact action — the existing /compact command path */}
          <div className="pt-2 border-t border-[var(--line-soft)] mt-1">
            <button
              className="btn btn-primary w-full !h-7 !text-[11px] !px-2 justify-center"
              disabled={running}
              title={t('sb.ring.compactHint', 'Summarize and compact the transcript to free context')}
              onClick={() => {
                setOpen(false);
                void sendMessage('/compact');
              }}
            >
              {running ? t('chat.queue', 'Queue') : t('sb.ring.compact', 'Compact now')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ContextLens;
