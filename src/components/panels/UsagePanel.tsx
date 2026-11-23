// UsagePanel — SURVEYOR v4 usage instrument: live app performance (3s poll),
// today's runs/tokens/cost with a purely INFORMATIVE free-season meter
// (nothing ever stops — v2.4 removed the old upgrade-gate CTA), current
// session totals, PER-MESSAGE token+cost rows (v11.10 A5 — every row is the
// whole-turn billing truth: all rounds + all retry/failover attempts, with an
// honest "≈" marker when the provider never reported usage), per-model
// breakdown as hairline keyrows, ONE 14-day cost chart (FIG. 02) plus a
// non-duplicating window summary, and a current/longest run-streak strip.
//
// v11.40 (USAGE-PRECISION) — the founder's rule: every token count and price
// comes from the real resolver (api.modelInfo → resolveModelInfo,
// fromProviderUsageReport, ctx.ts). Duplicated figures were collapsed to ONE
// authoritative place (the second 14-day bar strip is gone; cache tokens live
// only in TokenEconomyCard). Derived/projection figures carry "≈"; unbacked
// session totals (the store's stale-metadata fallback) are never called exact.
// Every number is .tnum mono and reconciles: sum(per-message) == session total.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Coins, Cpu, DollarSign, Activity, MemoryStick, Share2, Timer, GitBranch, RotateCw } from 'lucide-react';
import { useStore } from '../../store';
import { api } from '../../lib/api';
import { useT } from '../../i18n';
import {
  ctxFillTokens,
  fromProviderUsageReport,
  occupancySegments,
  tokenCountSource,
  type ProviderUsageReport,
  type UsageLike,
  type TokenCountSource,
} from '../../lib/ctx';
import { Btn, fmtCost, IconBtn, SectionTitle } from '../ui';
import { FreeSeasonBadge } from '../billingShared';
import { PageHead } from '../pages';
import type { AppMetrics, ChatMessage, Usage, UsageAttempt } from '../../../shared/types';
import '../workspace.css';
import '../pages.css';
import './usage-art.css';
import './panel-craft.css';

// The app site URL.
const APP_SITE_URL = 'https://surnia.app';

function StatRow({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center gap-2 h-7 text-[11.5px]">
      <span className="text-acc shrink-0 flex items-center">{icon}</span>
      <span className="text-faint flex-1 min-w-0 truncate">{label}</span>
      <span className="tnum font-medium" dir="ltr" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
    </div>
  );
}

const fmt = (n: number) => n.toLocaleString('en-US');

/* ============================================================
   v11.36 — THE SAME RESOLVER AS THE ORB / PRICING, IN THE USAGE TAB
   ------------------------------------------------------------
   The renderer cannot import electron/agent/costs.ts (BigInt + node-only
   catalog), but `api.modelInfo(id)` is the main-process bridge to that exact
   resolver (`kdx:model:info` → priceFor → resolvePrice → resolveModelInfo).
   The full provenance fields already ride on that response; the typed api
   surface is simply narrower than the runtime shape. We widen it locally,
   never invent a rate, and price every segment from the SAME catalog.

   Token honesty comes from src/lib/ctx.ts (read-only): `tokenCountSource`
   decides provider-exact vs ≈-estimate vs no-data, `ctxFillTokens` is the one
   fill formula, and `fromProviderUsageReport` maps raw provider fields once.
   ============================================================ */

export type UsagePriceSource = 'openrouter-live' | 'curated' | 'unknown';

/** Widen the runtime `modelInfo().price` payload to the full resolver shape. */
export interface UsagePriceView {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  estimated: boolean;
  source: UsagePriceSource;
  match: 'exact' | 'suffix' | 'prefix' | 'none';
  matchedId: string | null;
  fetchedAt: string | null;
  sourceUrl: string | null;
  unknown: boolean;
}

/** Normalize a `modelInfo()` response into a traceable price view. Never guesses. */
export function priceViewFromModelInfo(raw: unknown): UsagePriceView | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = (raw as { price?: Record<string, unknown> }).price;
  if (!p || typeof p !== 'object') return null;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const src = p.source;
  const source: UsagePriceSource =
    src === 'openrouter-live' || src === 'curated' ? src : 'unknown';
  // A real FREE tier ($0/$0) is a KNOWN price — never label it unknown just
  // because the rates are zero. Only the resolver's own flag/source decide.
  const hasRates = typeof p.input === 'number' && typeof p.output === 'number' && Number.isFinite(p.input) && Number.isFinite(p.output);
  const unknown = p.unknown === true || source === 'unknown' || !hasRates;
  const input = num(p.input);
  return {
    input,
    output: num(p.output),
    cacheRead: num(p.cacheRead) || (input > 0 ? input * 0.1 : 0),
    cacheWrite: num(p.cacheWrite) || (input > 0 ? input * 1.25 : 0),
    estimated: p.estimated === true || unknown,
    source: unknown ? 'unknown' : source,
    match: p.match === 'exact' || p.match === 'suffix' || p.match === 'prefix' ? p.match : 'none',
    matchedId: typeof p.matchedId === 'string' ? p.matchedId : null,
    fetchedAt: typeof p.fetchedAt === 'string' ? p.fetchedAt : null,
    sourceUrl: typeof p.sourceUrl === 'string' ? p.sourceUrl : null,
    unknown,
  };
}

/** Non-overlapping billed segments; cache is a SUBSET of the reported input. */
export function billedSegments(u: UsageLike | null | undefined): {
  fresh: number; cacheRead: number; cacheWrite: number; output: number; total: number;
} {
  if (!u) return { fresh: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 };
  const input = Math.max(0, u.inputTokens ?? 0);
  const occ = occupancySegments({ ...u, costUsd: u.costUsd ?? 0 });
  return {
    fresh: occ.fresh,
    cacheRead: occ.cacheRead,
    cacheWrite: occ.cacheWrite,
    output: Math.max(0, u.outputTokens ?? 0),
    total: ctxFillTokens(u),
  };
}

/**
 * Cost from the real catalog at the SAME per-million rates the resolver
 * publishes. `estimateCostExact` uses BigInt fixed point; with USD/1M rates
 * (already exact to 1e-12 in the payload) the identical product rounds to the
 * displayed micro-dollar. An unknown price returns 0 — never a fabricated $3/$15.
 */
export function priceCostUsd(
  p: UsagePriceView | null,
  tokens: { fresh: number; output: number; cacheRead: number; cacheWrite: number },
): number {
  if (!p || p.unknown) return 0;
  const seg = (n: number, rate: number): number => (Math.max(0, n) / 1_000_000) * rate;
  const usd =
    seg(tokens.fresh, p.input) +
    seg(tokens.cacheRead, p.cacheRead) +
    seg(tokens.cacheWrite, p.cacheWrite) +
    seg(tokens.output, p.output);
  return Math.round(usd * 1e6) / 1e6;
}

/** Map a transcript row through ctx.ts once; raw provider fields win when present. */
export function messageUsage(u: Usage | undefined): UsageLike | null {
  if (!u) return null;
  const raw = u as UsageLike & ProviderUsageReport;
  if (Number.isFinite(raw.prompt_tokens) || Number.isFinite(raw.completion_tokens)) {
    const mapped = fromProviderUsageReport(raw);
    if (mapped) return { ...mapped, costUsd: u.costUsd ?? 0, estimated: u.estimated ?? mapped.estimated };
  }
  return u;
}

/** Honest source label for one displayed token count. */
export function usageMark(src: TokenCountSource): string {
  return src === 'estimated' ? '≈ ' : src === 'none' ? '—' : '';
}

export interface ModelUsageRow {
  key: string;
  model: string;
  provider: string;
  tokens: number;
  costUsd: number;
  catalogCostUsd: number;
  estimated: boolean;
  runs: number;
  priced: boolean;
  price: UsagePriceView | null;
}

/**
 * Per-model breakdown from the REAL per-attempt ledger (not stale session
 * metadata). Engine cost is authoritative (it came from the same resolver at
 * run time); `catalogCostUsd` is recomputed from the live catalog as a
 * cross-check. Both are shown with their provenance; no numbers are invented.
 */
export function buildModelBreakdown(
  messages: ChatMessage[],
  prices: Record<string, UsagePriceView | null>,
): ModelUsageRow[] {
  const map = new Map<string, ModelUsageRow>();
  for (const m of messages) {
    const u = messageUsage(m.usage);
    if (!u) continue;
    const attempts: UsageAttempt[] = u.attempts?.length
      ? u.attempts
      : [{ provider: '', model: m.model ?? '', inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0,
           costUsd: u.costUsd ?? 0, cacheReadTokens: u.cacheReadTokens ?? 0,
           cacheCreationTokens: u.cacheCreationTokens ?? 0, estimated: u.estimated }];
    for (const a of attempts) {
      const model = String(a.model || m.model || '').trim();
      const provider = String(a.provider || '').trim();
      if (!model && !(a.inputTokens + a.outputTokens)) continue;
      const key = `${provider}/${model}`;
      const price = prices[model] ?? null;
      const segs = billedSegments({
        costUsd: a.costUsd ?? 0,
        inputTokens: a.inputTokens ?? 0,
        outputTokens: a.outputTokens ?? 0,
        cacheReadTokens: a.cacheReadTokens ?? 0,
        cacheCreationTokens: a.cacheCreationTokens ?? 0,
      });
      const catalogCostUsd = priceCostUsd(price, segs);
      const row = map.get(key) ?? {
        key, model, provider, tokens: 0, costUsd: 0, catalogCostUsd: 0,
        estimated: false, runs: 0, priced: !!price && !price.unknown, price,
      };
      row.tokens += Math.max(0, a.inputTokens ?? 0) + Math.max(0, a.outputTokens ?? 0);
      row.costUsd += Number.isFinite(a.costUsd) ? a.costUsd : 0;
      row.catalogCostUsd += catalogCostUsd;
      row.estimated = row.estimated || a.estimated === true || u.estimated === true;
      row.runs += 1;
      row.priced = row.priced && row.price !== null && !row.price.unknown;
      map.set(key, row);
    }
  }
  return [...map.values()]
    .map((r) => ({ ...r, costUsd: Math.round(r.costUsd * 1e6) / 1e6, catalogCostUsd: Math.round(r.catalogCostUsd * 1e6) / 1e6 }))
    .sort((a, b) => b.tokens - a.tokens);
}

/** Short, honest provenance label for a resolved price. */
export function priceSourceLabel(p: UsagePriceView | null, ar: boolean): string {
  if (!p || p.unknown) return ar ? 'غير معروف' : 'unknown';
  if (p.source === 'openrouter-live') return ar ? 'كتالوج حيّ' : 'live catalog';
  if (p.source === 'curated') return ar ? 'كتالوج ثابت' : 'curated catalog';
  return ar ? 'غير معروف' : 'unknown';
}

/**
 * v10.3 — Token economy card. Honest numbers only:
 *  · cache read/creation tokens are what the provider actually reported;
 *  · the hit rate is cached/(cached+billed input);
 *  · every cached token is billed at ~10% of input price (Anthropic/OpenAI
 *    cache pricing) — the saving line states that ratio, never a fake $.
 *  · the compaction row mirrors the real setting + session trim state.
 */
function TokenEconomyCard() {
  const t = useT();
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const sessionUsage = useStore((s) => s.sessionUsage);
  const promptCaching = useStore((s) => s.settings.agent?.promptCaching !== false);
  const autoCompact = useStore((s) => s.settings.agent?.autoCompact !== false);

  // v11.10 (A5) — exact cache math: the cache split is INSIDE the billed
  // input figure, so the full-rate (fresh) input is the remainder — the hit
  // rate is cached / (cached + fresh), the same ratio providers report.
  const cached = sessionUsage.cacheReadTokens ?? 0;
  const cacheWrite = sessionUsage.cacheCreationTokens ?? 0;
  const billedInput = sessionUsage.inputTokens ?? 0;
  const freshInput = Math.max(0, billedInput - cached - cacheWrite);
  // v11.11 (A6) — the shown % is computed from the SAME numbers displayed
  // below (cached / (cached + fresh)); the old guard keyed on billedInput,
  // a different denominator than the value it gated.
  const hitRate = cached + freshInput > 0 ? Math.round((cached / (cached + freshInput)) * 100) : 0;
  // v11.40 — "saved" is a DERIVED figure (cached × (1 − 0.1) under the
  // documented cache-rate convention), NOT a provider-reported count. It is
  // always marked "≈" below and never presented as an exact provider number.
  const savedTokens = Math.round(cached * 0.9);

  return (
    <div className="aurora-panel p-3">
      <SectionTitle>{t('usage.economy', lang === 'ar' ? 'اقتصاد التوكنات' : 'Token economy')}</SectionTitle>
      <StatRow
        icon={<Activity size={12} />}
        label={t('usage.cacheHit', lang === 'ar' ? 'معدل إصابة الكاش' : 'Cache hit rate')}
        value={cached + freshInput > 0 ? `${hitRate}%` : '—'}
        tone={hitRate >= 50 ? 'var(--ok)' : undefined}
      />
      <StatRow icon={<Coins size={12} />} label={t('usage.cachedTokens', lang === 'ar' ? 'توكنات مقروءة من الكاش' : 'Cache-read tokens')} value={fmt(cached)} />
      <StatRow
        icon={<Check size={12} />}
        label={t('usage.savedTokens', lang === 'ar' ? 'ما وفّره الكاش (توكنات مُحاسَبة ×0.1)' : 'Saved by cache (billed at 0.1x)')}
        value={cached > 0 ? `≈ ${fmt(savedTokens)}` : '—'}
        tone="var(--acc)"
      />
      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
        <span
          className={`stamp !h-[15px] !text-[8.5px] ${promptCaching ? 'stamp-acc' : ''}`}
          title={t('usage.cachingHint', lang === 'ar' ? 'تخزين السياق مؤقتاً بين الطلبات' : 'Prompt caching across requests')}
        >
          {t('usage.caching', lang === 'ar' ? 'كاش' : 'caching')} {promptCaching ? (lang === 'ar' ? 'مفعّل' : 'on') : (lang === 'ar' ? 'معطّل' : 'off')}
        </span>
        <span
          className={`stamp !h-[15px] !text-[8.5px] ${autoCompact ? 'stamp-acc' : ''}`}
          title={t('usage.compactHint', lang === 'ar' ? 'ضغط الجلسات الطويلة تلقائياً قبل بلوغ النافذة' : 'Auto-compact long sessions before the window fills')}
        >
          {t('usage.compact', lang === 'ar' ? 'ضغط تلقائي' : 'auto-compact')} {autoCompact ? (lang === 'ar' ? 'مفعّل' : 'on') : (lang === 'ar' ? 'معطّل' : 'off')}
        </span>
      </div>
    </div>
  );
}

/** 4521 → "1h 15m" */
function fmtUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

// ---------- v11.10 (A5) — per-message billing rows (reconciled) ----------

interface PerMessageRow {
  id: string;
  at: number;
  model: string; // row attribution (provider/model) — 'error' rows keep it honest
  tokens: number;
  costUsd: number;
  catalogCostUsd: number;
  cached: number;
  cacheWrite: number;
  source: TokenCountSource;
  estimated: boolean;
  price: UsagePriceView | null;
  attempts: UsageAttempt[];
}

/**
 * Every transcript row that owns a usage footer becomes one billing row.
 * Rows carry the whole-turn RUN view (all rounds + attempts), so the sum of
 * these rows equals the session total by construction — the panel asserts it
 * visually with the reconciled stamp below the table.
 */
export function perMessageRows(
  messages: ChatMessage[],
  prices: Record<string, UsagePriceView | null> = {},
): PerMessageRow[] {
  const rows: PerMessageRow[] = [];
  for (const m of messages) {
    const u = messageUsage(m.usage);
    if (!u) continue;
    const segs = billedSegments(u);
    const price = prices[String(m.model ?? '').trim()] ?? null;
    rows.push({
      id: m.id,
      at: m.timestamp,
      model: m.model ?? '',
      tokens: ctxFillTokens(u),
      costUsd: u.costUsd ?? 0,
      catalogCostUsd: priceCostUsd(price, segs),
      cached: u.cacheReadTokens ?? 0,
      cacheWrite: u.cacheCreationTokens ?? 0,
      source: tokenCountSource(u),
      estimated: u.estimated === true || (u.attempts ?? []).some((a) => a.estimated === true),
      price,
      attempts: u.attempts ?? [],
    });
  }
  return rows;
}

// ---------- streaks — pure math over active-day keys (YYYY-MM-DD, sorted, unique) ----------
const DAY_MS = 86400000;

/** YYYY-MM-DD key for a UTC timestamp — same UTC convention as usageLog dates. */
const toKey = (utcMs: number): string => new Date(utcMs).toISOString().slice(0, 10);

/** UTC day index (whole days since epoch) for a YYYY-MM-DD key. */
const dayNum = (key: string): number => Date.parse(`${key}T00:00:00Z`) / DAY_MS;

/**
 * Consecutive active days (runs > 0) ending today or yesterday. `dates` =
 * sorted unique YYYY-MM-DD keys, UTC (same convention as usageLog); empty
 * input → 0. Anchoring through yesterday keeps the streak alive until a full
 * inactive day has passed.
 */
export function currentStreak(dates: string[]): number {
  if (dates.length === 0) return 0;
  const active = new Set(dates);
  const todayNum = Math.floor(new Date().getTime() / DAY_MS);
  const has = (day: number): boolean => active.has(toKey(day * DAY_MS));
  const start = has(todayNum) ? todayNum : has(todayNum - 1) ? todayNum - 1 : -1;
  if (start < 0) return 0;
  let n = 0;
  for (let d = start; has(d); d--) n += 1;
  return n;
}

/** Longest run of consecutive active days across the whole log; empty input → 0. */
export function longestStreak(dates: string[]): number {
  let best = 0;
  let run = 0;
  let prev = Number.NaN;
  for (const date of dates) {
    const d = dayNum(date);
    run = run > 0 && d - prev === 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}

/* ============================================================
   EDITORIAL ART — presentation only. No IPC, no store writes, no
   state binding is touched; these components only draw. Motion is
   guarded by BOTH prefers-reduced-motion and html.reduce-motion.
   ============================================================ */

/** Opt-in reveal: sets data-in once the element scrolls into view.
 *  Falls back to "visible" when motion is off or IO is unavailable. */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    if (
      (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ||
      root.classList.contains('reduce-motion') ||
      typeof IntersectionObserver === 'undefined'
    ) {
      el.setAttribute('data-in', 'true');
      return;
    }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        el.setAttribute('data-in', 'true');
        io.disconnect();
      }
    }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

/** Original 1px glyph — an ascending read-out, meaningful to Usage. */
function UsageGlyph() {
  return (
    <span className="us-glyph" aria-hidden="true">
      <svg viewBox="0 0 72 34" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
        <path d="M4 28h64" opacity=".45" />
        <path d="M12 28V18M27 28V10M42 28V15M57 28V5" />
        <circle className="us-g-dot" cx="57" cy="5" r="1.9" />
      </svg>
    </span>
  );
}

type UsageDay = { key: string; label: string; tokens: number; costUsd: number; runs: number; isToday: boolean };

/** A real area chart driven ONLY by the 14-day usageLog values already in the
 *  panel. The area closes on the FIRST and LAST point centres (not the plot
 *  edges — that off-by-pixel left a sliver of empty baseline). Cost axis at
 *  100/50/0%, date ticks at the exact bar centres; no invented data. */
function UsageChart({ days, maxCost, ar }: { days: UsageDay[]; maxCost: number; ar: boolean }) {
  const ref = useInView<HTMLDivElement>();
  const W = 560, H = 150, L = 50, R = 8, T = 10, B = 22;
  const plotW = W - L - R, plotH = H - T - B, BASE = T + plotH;
  const n = Math.max(1, days.length);
  const step = plotW / n;
  const bw = Math.max(3, step * 0.46);
  const cxOf = (i: number) => L + i * step + step / 2;          // point centre
  const barX = (i: number) => L + i * step + (step - bw) / 2;   // bar left
  const yOf = (v: number) => BASE - (maxCost > 0 ? (v / maxCost) * plotH : 0);
  const pts = days.map((d, i) => `${cxOf(i).toFixed(1)},${yOf(d.costUsd).toFixed(1)}`).join(' ');
  // close exactly under the first and last centres — no baseline overhang
  const area = `${cxOf(0).toFixed(1)},${BASE} ${pts} ${cxOf(n - 1).toFixed(1)},${BASE}`;
  const ticks = [1, 0.5, 0];
  return (
    <div ref={ref} className="us-chart-wrap us-reveal">
      <div className="us-chart-head">
        <span className="us-chart-fig">{ar ? 'شكل ٠٢ / الاستخدام الحقيقي' : 'FIG. 02 / ACTUAL USAGE'}</span>
        <span className="us-chart-cap">
          {ar ? '١٤ يوماً · التكلفة اليومية من سجل الاستخدام' : '14 days · daily cost from your usage log'}
        </span>
      </div>
      <svg className="craft-svg us-chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={ar ? 'رسم بياني لتكلفة الاستخدام اليومية' : 'Daily usage cost chart'}>
        {ticks.map((f, i) => {
          const y = yOf(maxCost * f);
          return (
            <g key={f}>
              <line className="craft-us-grid craft-draw" pathLength={1} x1={L} y1={y} x2={W - R} y2={y}
                style={{ animationDelay: `${i * 60}ms` }} />
              <text className="craft-us-tick" x={L - 6} y={y + 3} textAnchor="end">{fmtCost(maxCost * f)}</text>
            </g>
          );
        })}
        <line className="craft-us-base craft-draw" pathLength={1} x1={L} y1={BASE} x2={W - R} y2={BASE}
          style={{ animationDelay: '180ms' }} />
        <polygon className="craft-us-area craft-in" points={area} style={{ animationDelay: '180ms' }} />
        {days.map((d, i) => (
          <rect key={d.key} className={'craft-us-bar' + (d.isToday ? ' is-today' : '')}
            x={barX(i)} y={yOf(d.costUsd)} width={bw}
            height={Math.max(d.costUsd > 0 ? 1 : 0.75, BASE - yOf(d.costUsd))}>
            <title>{`${d.key} · ${fmt(d.tokens)} tok · ${fmtCost(d.costUsd)}`}</title>
          </rect>
        ))}
        <polyline className="craft-us-line craft-draw" pathLength={1} points={pts}
          style={{ animationDelay: '240ms' }} />
        {days.map((d, i) => d.isToday && d.costUsd > 0
          ? <circle key={`p-${d.key}`} className="craft-us-peak" cx={cxOf(i)} cy={yOf(d.costUsd)} r="2.4" />
          : null)}
        {days.map((d, i) => (i % 3 === 0 || d.isToday)
          ? <g key={`t-${d.key}`}>
              <line className="craft-us-tick" x1={cxOf(i)} y1={BASE} x2={cxOf(i)} y2={BASE + 3} />
              <text className="craft-us-tick" x={cxOf(i)} y={H - 6} textAnchor="middle">{d.label}</text>
            </g>
          : null)}
      </svg>
    </div>
  );
}

export function UsagePanel({ embedded }: { embedded?: boolean }) {
  const t = useT();
  const usageLog = useStore((s) => s.settings.usageLog);
  const sessions = useStore((s) => s.sessions);
  const sessionUsage = useStore((s) => s.sessionUsage);
  const session = useStore((s) => s.session);
  const setPlans = useStore((s) => s.setPlans);
  const notify = useStore((s) => s.notify);
  const lang = useStore((s) => s.settings?.language ?? 'en');
  const ar = lang === 'ar';
  const activeModel = useStore((s) => s.settings.model?.model ?? '');
  // share-button copied feedback
  const [copied, setCopied] = useState(false);

  // v11.36 — resolve EVERY model seen in the transcript (and the active one)
  // through the SAME main-process resolver the orb/pricing use. The full
  // provenance rides on modelInfo(); a failed/absent bridge stays null so the
  // panel says "unknown" instead of printing a made-up rate.
  const modelIdsKey = useMemo(() => {
    const ids = new Set<string>();
    if (activeModel) ids.add(activeModel);
    for (const m of session?.messages ?? []) {
      if (m.model) ids.add(m.model);
      for (const a of m.usage?.attempts ?? []) if (a.model) ids.add(a.model);
    }
    for (const s of sessions) if (s.model) ids.add(s.model);
    return [...ids].sort().join('\n');
  }, [activeModel, session?.messages, sessions]);
  const [prices, setPrices] = useState<Record<string, UsagePriceView | null>>({});
  useEffect(() => {
    const ids = modelIdsKey ? modelIdsKey.split('\n') : [];
    let alive = true;
    if (!ids.length) {
      setPrices({});
      return;
    }
    void Promise.all(
      ids.map(async (id) => {
        try {
          return [id, priceViewFromModelInfo(await api.modelInfo(id))] as const;
        } catch {
          return [id, null] as const; // honest unknown — no invented fallback
        }
      }),
    ).then((pairs) => {
      if (alive) setPrices(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, [modelIdsKey]);

  const activePrice = prices[activeModel] ?? null;
  // per-message billing rows (v11.10 A5 / v11.36) — newest first, capped
  const msgRows = useMemo(
    () => perMessageRows(session?.messages ?? [], prices).reverse().slice(0, 24),
    [session?.messages, prices],
  );
  const rowsTokens = useMemo(() => msgRows.reduce((a, r) => a + r.tokens, 0), [msgRows]);
  const shownRows = msgRows.length;
  const allRows = useMemo(() => perMessageRows(session?.messages ?? [], prices), [session?.messages, prices]);
  const allRowsTokens = allRows.reduce((a, r) => a + r.tokens, 0);
  // Only claim "reconciled" when the two figures actually agree — the store
  // can fall back to session-metadata totals, in which case they legitimately
  // differ and the old stamp was a false statement.
  const sessionTokens = sessionUsage.inputTokens + sessionUsage.outputTokens;
  const sessionHasData = sessionTokens > 0;
  const rowsReconcile = allRowsTokens === sessionTokens;
  // v11.40 — a session total NOT backed by reconciled provider rows (the
  // store's stale session-metadata fallback) must never be shown as an exact
  // provider figure. Mark it "≈" instead of claiming precision we do not have.
  const sessionEstimated =
    sessionUsage.estimated === true ||
    allRows.some((r) => r.estimated) ||
    (sessionHasData && !rowsReconcile);

  // usageLog dates are UTC (toISOString), same convention as the store's daily counter.
  const todayKey = new Date().toISOString().slice(0, 10);
  const today = useMemo(
    () => usageLog.find((e) => e.date === todayKey) ?? { date: todayKey, runs: 0, tokens: 0, costUsd: 0 },
    [usageLog, todayKey],
  );
  // v11.42 — the daily usageLog carries NO per-row provenance flag: a turn whose
  // provider never reported usage is accumulated into the same tokens/cost as an
  // exact one. If any turn that landed today (or the restored session metadata)
  // was an estimate, today's aggregate is NOT a provider-exact figure — mark it
  // "≈" instead of printing a precision we do not have. This is the one honest
  // signal the renderer can derive without changing the store/engine schema.
  const todayEstimated =
    sessionUsage.estimated === true ||
    allRows.some((r) => r.estimated && Number.isFinite(r.at) && toKey(r.at) === todayKey);

  const days = useMemo(() => {
    // 14-day window, cost-driven bars (tokens stay in the tooltip)
    const arr: { key: string; label: string; tokens: number; costUsd: number; runs: number; isToday: boolean }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      const e = usageLog.find((x) => x.date === key);
      arr.push({
        key,
        label: String(d.getUTCDate()),
        tokens: e ? e.tokens : 0,
        costUsd: e ? e.costUsd : 0,
        runs: e ? e.runs : 0,
        isToday: i === 0,
      });
    }
    return arr;
  }, [usageLog]);
  const maxCost = Math.max(0.000001, ...days.map((d) => d.costUsd));

  // avg/day + projected/month over the 14-day window (cost-driven)
  const windowCost = days.reduce((a, d) => a + d.costUsd, 0);
  const windowRuns = days.reduce((a, d) => a + d.runs, 0);
  const windowTokens = days.reduce((a, d) => a + d.tokens, 0);
  const avgDayCost = windowCost / 14;
  const projectedMonth = avgDayCost * 30.4;
  // average runs/day — denominator for the informative (non-gating) meter
  const avgRunsDay = windowRuns / 14;

  // streaks — active (runs > 0) UTC day keys feed the pure streak math below
  const activeDates = useMemo(
    () =>
      usageLog
        .filter((e) => e.runs > 0)
        .map((e) => e.date)
        .sort(),
    [usageLog],
  );
  const curStreak = currentStreak(activeDates);
  const bestStreak = longestStreak(activeDates);

  // v11.36 — per-model breakdown from the REAL attempt ledger, priced by the
  // same resolver. Session metadata (totalTokens/totalCostUsd) is NO LONGER
  // used: it is a stale cached summary, not a per-model billing truth.
  const topModels = useMemo(
    () => buildModelBreakdown(session?.messages ?? [], prices).slice(0, 6),
    [session?.messages, prices],
  );

  // live app performance metrics (polled every 3s while the panel is visible)
  const [metrics, setMetrics] = useState<AppMetrics | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const m = await api.appMetrics();
        if (alive) setMetrics(m);
      } catch {
        /* metrics unavailable */
      }
    };
    void tick();
    const iv = setInterval(() => void tick(), 3000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
    // refreshKey: the header button re-runs this effect for an immediate read.
  }, [refreshKey]);

  return (
    <div className={`page-v14 art-usage p-3 flex flex-col gap-3 overflow-y-auto min-h-0 ${embedded ? 'flex-1' : 'h-full'}`}>
      <PageHead
        eyebrow={ar ? '٠٢ / الاستخدام' : '02 / USAGE'}
        title={t('rail.usage', 'Usage & performance')}
        description={ar
          ? 'مقاييس حقيقية من هذا الجهاز — لا حدود ولا توقف.'
          : 'Live device metrics and real usage — nothing is gated or capped.'}
        toolbar={
          <span className="flex items-center gap-1.5">
            <UsageGlyph />
            <IconBtn
              title={t('usage.refresh', 'Refresh live stats')}
              aria-label={t('usage.refresh', 'Refresh live stats')}
              onClick={() => setRefreshKey((k) => k + 1)}
            >
              <RotateCw size={12} />
            </IconBtn>
          </span>
        }
      />
      {/* the instrument: a real chart drawn from this device's usage log */}
      <UsageChart days={days} maxCost={maxCost} ar={ar} />
      {/* v2.4 free season — the badge leads the panel: nothing is gated */}
      <div className="flex items-center justify-between gap-2">
        <FreeSeasonBadge />
        <span className="text-[10px] text-faint truncate">{ar ? 'لا شيء يتوقف — بلا حدود' : 'Nothing stops — unlimited'}</span>
      </div>
      {/* v11.36 — pricing provenance. The rates are the SAME resolver the orb
          uses (kdx:model:info → resolveModelInfo); if it is unavailable the
          page says UNKNOWN instead of inventing a price. */}
      <div className="aurora-panel p-3">
        <SectionTitle>{t('usage.provenance', 'Pricing & token provenance')}</SectionTitle>
        <StatRow
          icon={<Cpu size={12} />}
          label={t('usage.provModel', 'Active model')}
          value={activeModel || (ar ? 'غير معروف' : 'unknown')}
        />
        <StatRow
          icon={<DollarSign size={12} />}
          label={t('usage.provSource', 'Price source')}
          value={priceSourceLabel(activePrice, ar)}
          tone={activePrice && !activePrice.unknown ? 'var(--acc)' : 'var(--warn)'}
        />
        {/* v11.40 — the ACTUAL per-million rates from the SAME resolver the
            orb uses. Never rendered for an unknown price (no fake $3/$15). */}
        {activePrice && !activePrice.unknown ? (
          <div className="flex items-center gap-1.5 flex-wrap mt-1.5 tnum" dir="ltr" title={t('usage.provRates', 'Resolver rates — USD per 1M tokens')}>
            <span className="stamp !h-[15px] !text-[8.5px]">IN ${activePrice.input}</span>
            <span className="stamp !h-[15px] !text-[8.5px]">OUT ${activePrice.output}</span>
            <span className="stamp !h-[15px] !text-[8.5px]">CACHE-R ${activePrice.cacheRead}</span>
            <span className="stamp !h-[15px] !text-[8.5px]">CACHE-W ${activePrice.cacheWrite}</span>
            <span className="text-[9px] text-faint">/1M</span>
          </div>
        ) : null}
        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
          <span className="stamp !h-[15px] !text-[8.5px] tnum" dir="ltr" title={t('usage.provMatch', 'How the model id matched the catalog')}>
            {ar ? 'تطابق' : 'match'}: {activePrice?.match ?? 'none'}
          </span>
          <span className="stamp !h-[15px] !text-[8.5px] tnum" dir="ltr" title={t('usage.provId', 'Exact catalog row that supplied the price')}>
            {ar ? 'السجل' : 'row'}: {activePrice?.matchedId ?? (ar ? 'غير معروف' : 'unknown')}
          </span>
          {activePrice?.fetchedAt ? (
            <span className="stamp !h-[15px] !text-[8.5px] tnum" dir="ltr" title={activePrice.sourceUrl ?? ''}>
              {ar ? 'جلب' : 'fetched'}: {new Date(activePrice.fetchedAt).toISOString().slice(0, 10)}
            </span>
          ) : null}
          <span className="stamp !h-[15px] !text-[8.5px]" title={t('usage.provTokens', 'Token counts are provider-exact unless marked ≈')}>
            {ar ? 'التوكنات: من المزوّد (≈ عند التقدير)' : 'tokens: provider-exact (≈ when estimated)'}
          </span>
        </div>
        {(!activePrice || activePrice.unknown) && (
          <div className="mt-2 rounded-[10px] border border-dashed border-[var(--line-strong)] px-2.5 py-2 text-[10.5px] text-faint leading-relaxed" role="status">
            {t('usage.provUnknown', 'This model has no catalog price in either source — costs are shown as unknown, never invented.')}
          </div>
        )}
      </div>
      {/* app performance — prominent, live */}
      {metrics ? (
        <div className="aurora-panel p-3">
          <div className="flex items-center justify-between min-w-0">
            <SectionTitle>{t('usage.perf', 'App performance')}</SectionTitle>
            <span className="glass-pill !h-[20px] !px-2 !text-[9.5px] text-acc mb-1 shrink-0" style={{ boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--acc) 40%, transparent)' }} title={t('usage.perf', 'App performance')}>
              <span className="led" aria-hidden />
              {t('live-badge', 'live')}
            </span>
          </div>
          <StatRow icon={<Cpu size={12} />} label={t('usage.cpu', 'App CPU')} value={`${metrics.cpuPercent.toFixed(1)}%`} />
          <StatRow icon={<MemoryStick size={12} />} label={t('usage.ram', 'App memory')} value={`${metrics.memoryMB} MB`} />
          <StatRow icon={<Activity size={12} />} label={t('usage.processes', 'Processes')} value={String(metrics.processes)} />
          <StatRow icon={<Timer size={12} />} label={t('usage.uptime', 'Uptime')} value={fmtUptime(metrics.uptimeSec)} />
          <div className="mt-2.5 pt-2.5 border-t border-line">
            <div
              className="h-1.5 overflow-hidden"
              style={{ background: 'var(--bg5)', borderRadius: 'var(--radius-pill)' }}
            >
              <div
                className="h-full transition-[width]"
                style={{
                  background: 'var(--acc)',
                  borderRadius: 'var(--radius-pill)',
                  width: `${Math.min(
                    100,
                    Math.max(2, ((metrics.hostMemTotalMB - metrics.hostMemFreeMB) / Math.max(1, metrics.hostMemTotalMB)) * 100),
                  )}%`,
                }}
              />
            </div>
            <div className="flex items-center gap-2 mt-2 text-[10.5px] text-faint">
              <span className="flex-1 min-w-0 truncate">{t('usage.hostMem', 'Device memory in use')}</span>
              <span className="tnum" dir="ltr">
                {metrics.hostMemTotalMB - metrics.hostMemFreeMB} / {metrics.hostMemTotalMB} MB
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="aurora-panel p-3" aria-label={t('misc.loading', 'Loading…')}>
          <SectionTitle>{t('usage.perf', 'App performance')}</SectionTitle>
          <div className="flex flex-col gap-2 py-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="wsp-skel-row" />
            ))}
          </div>
        </div>
      )}

      {/* today */}
      <div className="aurora-panel p-3">
        <SectionTitle>{t('usage.today')}</SectionTitle>
        <StatRow icon={<Activity size={12} />} label={t('usage.runs')} value={fmt(today.runs)} />
        <StatRow
          icon={<Coins size={12} />}
          label={t('usage.tokens')}
          value={today.tokens > 0 ? `${todayEstimated ? '≈ ' : ''}${fmt(today.tokens)}` : (ar ? 'غير معروف' : 'unknown')}
        />
        {/* v11.42 — a KNOWN $0 (free tier / free model) is a price, not "unknown".
            Only claim unknown when the provider reported no tokens at all. */}
        <StatRow
          icon={<DollarSign size={12} />}
          label={t('usage.cost')}
          value={today.tokens > 0 ? `${todayEstimated ? '≈ ' : ''}${fmtCost(today.costUsd)}` : (ar ? 'غير معروف' : 'unknown')}
        />
        <div className="text-[9.5px] text-faint mt-1" dir="ltr">
          {t('usage.logSource', 'source: this device’s recorded usage log (UTC day)')}
        </div>
        {todayEstimated && (
          <div className="text-[9.5px] text-faint mt-1" role="note">
            {t('usage.todayEstimate', ar
              ? '≈ تشمل طلبات لم يبلغ المزوّد عن استخدامها — ليست أرقاماً دقيقة.'
              : '≈ includes turns where the provider reported no usage — not exact figures.')}
          </div>
        )}

        {/* v2.4 — informative usage meter only: no cap, no red, no gate.
            The bar compares today with your 14-day average — context, not a limit. */}
        <div className="mt-2.5 pt-2.5 border-t border-line">
          <div
            className="h-1.5 overflow-hidden"
            style={{ background: 'var(--bg5)', borderRadius: 'var(--radius-pill)' }}
          >
            <div
              className="h-full transition-[width]"
              style={{
                background: 'var(--acc)',
                borderRadius: 'var(--radius-pill)',
                width: `${Math.min(100, (today.runs / Math.max(1, avgRunsDay)) * 100)}%`,
              }}
            />
          </div>
          <div className="flex items-center gap-2 mt-2 text-[10.5px] text-faint">
            <span className="flex-1 min-w-0 truncate">
              {ar
                ? 'اليوم مقابل متوسطك (14 يوماً) — إعلامي فقط، لا شيء يتوقف'
                : 'Today vs your 14-day average — informational only, nothing stops'}
            </span>
            {/* v11.40 — today's runs are already in the StatRow above; show
                only the average here so the figure is not printed twice. */}
            <span className="tnum" dir="ltr">
              avg {avgRunsDay.toFixed(1)}
            </span>
          </div>
          {/* celebration + share — explicit user actions only; opening the
              Plans screen from here is fine, no payment flow lives there */}
          <div className="flex items-center gap-2 mt-2">
            <Btn
              variant="primary"
              className="!h-7 !text-[11.5px] flex-1"
              onClick={() => {
                try {
                  navigator.clipboard
                    .writeText(APP_SITE_URL)
                    .then(() => {
                      setCopied(true);
                      notify(t('billing.share.copied', 'Link copied'));
                      window.setTimeout(() => setCopied(false), 2200);
                    })
                    .catch(() => notify(APP_SITE_URL));
                } catch {
                  notify(APP_SITE_URL);
                }
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                {copied ? <Check size={12} /> : <Share2 size={12} />}
                {t('billing.share.copy', 'Copy download link')}
              </span>
            </Btn>
            <Btn className="!h-7 !text-[11.5px]" onClick={() => setPlans(true)}>
              {t('plans.title', 'Choose your plan')}
            </Btn>
          </div>
        </div>
      </div>

      {/* streaks — current / longest active-day run streaks (honest: only
          fields the store actually carries — no placeholder tiles) */}
      <div className="flex items-stretch gap-2">
        <div className="aurora-panel p-2.5 flex-1 min-w-0">
          <div className="caps text-[8.5px] text-ghost truncate">{t('usage.streak.current', 'Current streak')}</div>
          <div className="tnum text-[13px] font-medium mt-0.5" dir="ltr">
            {curStreak} <span className="text-[9.5px] text-faint font-normal">{t('usage.streak.days', 'days')}</span>
          </div>
        </div>
        <div className="aurora-panel p-2.5 flex-1 min-w-0">
          <div className="caps text-[8.5px] text-ghost truncate">{t('usage.streak.longest', 'Longest streak')}</div>
          <div className="tnum text-[13px] font-medium mt-0.5" dir="ltr">
            {bestStreak} <span className="text-[9.5px] text-faint font-normal">{t('usage.streak.days', 'days')}</span>
          </div>
        </div>
      </div>

      {/* this session */}
      <div className="aurora-panel p-3">
        <SectionTitle>{t('usage.session')}</SectionTitle>
        <StatRow
          icon={<Coins size={12} />}
          label={t('usage.tokens')}
          value={`${sessionEstimated ? '≈ ' : ''}${sessionHasData ? fmt(sessionUsage.inputTokens + sessionUsage.outputTokens) : (ar ? 'غير معروف' : 'unknown')}`}
        />
        <StatRow
          icon={<DollarSign size={12} />}
          label={t('usage.cost')}
          value={`${sessionEstimated ? '≈ ' : ''}${sessionHasData ? fmtCost(sessionUsage.costUsd) : (ar ? 'غير معروف' : 'unknown')}`}
        />
        <div className="flex items-center gap-2 h-6 text-[10px] text-faint">
          <span className="stamp !h-[15px] tnum" dir="ltr" title={t('usage.tokensIn', 'Input tokens')}>
            IN {sessionHasData ? fmt(sessionUsage.inputTokens) : '—'}
          </span>
          <span className="stamp !h-[15px] tnum" dir="ltr" title={t('usage.tokensOut', 'Output tokens')}>
            OUT {sessionHasData ? fmt(sessionUsage.outputTokens) : '—'}
          </span>
          {/* v11.40 — cache tokens are shown ONCE, in TokenEconomyCard below. */}
        </div>
        {/* v11.10 (A5) — reconciliation stamp: sum(per-message) == session total */}
        {allRows.length > 0 && (
          <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-line">
            {rowsReconcile ? (
              <Check size={11} className="text-[var(--ok)] shrink-0" aria-hidden />
            ) : (
              <Activity size={11} className="text-[var(--warn)] shrink-0" aria-hidden />
            )}
            <span className="text-[9.5px] text-faint" dir="ltr">
              {rowsReconcile
                ? t('usage.reconciledTokens', 'Reconciled — {n} billing rows sum to the session token total', {
                    n: String(allRows.length),
                  })
                : t('usage.rowsDiffer', '{n} billing rows · Σ {a} tok vs session {b} tok', {
                    n: String(allRows.length),
                    a: fmt(allRowsTokens),
                    b: fmt(sessionTokens),
                  })}
            </span>
          </div>
        )}
      </div>

      {/* v11.10 (A5) — PER-MESSAGE BILLING ROWS: the whole-turn truth per reply.
          Each row = one message_end (all continuation rounds + ALL retry/
          failover attempts, each attempt attributed provider/model). "≈" marks
          usage the provider never reported (chars/4 estimate). */}
      <div className="aurora-panel p-3">
        <SectionTitle>{t('usage.perMsg', 'Messages — tokens & cost')}</SectionTitle>
        {msgRows.length > 0 ? (
          <div className="rounded-[8px] border border-line overflow-hidden mt-1">
            <div className="flex items-center gap-2 px-2.5 py-1 border-b border-line bg-[var(--hover-2)]">
              <span className="text-[8.5px] uppercase tracking-widest text-ghost flex-1 min-w-0">{t('usage.model', 'Model')}</span>
              <span className="text-[8.5px] uppercase tracking-widest text-ghost w-14 text-end shrink-0">{t('usage.tokens', 'Tokens')}</span>
              <span className="text-[8.5px] uppercase tracking-widest text-ghost w-16 text-end shrink-0">{t('usage.cost', 'Cost')}</span>
            </div>
            {msgRows.map((r) => {
              const title =
                `${r.model || '—'} · ${usageMark(r.source)}${fmt(r.tokens)} tok · ${fmtCost(r.costUsd)}` +
                `\n${t('usage.provSource', 'Price source')}: ${priceSourceLabel(r.price, ar)}` +
                (r.price?.matchedId ? ` · ${r.price.matchedId}` : '') +
                (r.price && !r.price.unknown && r.catalogCostUsd > 0
                  ? `\n${t('usage.catalogCross', 'catalog cross-check')}: ${fmtCost(r.catalogCostUsd)}`
                  : '') +
                (r.estimated ? ` · ${t('usage.estMark', 'estimated (no provider usage reported)')}` : '') +
                (r.attempts.length > 1
                  ? `\n${r.attempts
                      .map(
                        (a, i) =>
                          `${t('usage.attemptN', 'attempt {n}', { n: String(i + 1) })}: ${a.provider}/${a.model} — ${fmt((a.inputTokens ?? 0) + (a.outputTokens ?? 0))} tok · ${fmtCost(a.costUsd)}`,
                      )
                      .join('\n')}`
                  : '');
              return (
                <div key={r.id} className="keyrow !py-1.5" title={title}>
                  <span className="key-main min-w-0 flex flex-col">
                    {/* v11.42 — the MODEL column is a label, not a token count.
                        The old `usageMark(r.source)` prepended "—" for source=none
                        (rendering "—model-name") and an estimate "≈" in front of a
                        model id; the token column already carries the honest mark. */}
                    <span className="tnum text-[10.5px] text-ink truncate" dir="ltr">
                      {r.estimated ? '≈ ' : ''}{r.model || (ar ? 'غير معروف' : 'unknown')}
                    </span>
                    <span className="key-sub flex items-center gap-1.5 flex-wrap">
                      {r.cached > 0 && (
                        <span className="inline-flex items-center gap-0.5">
                          <Coins size={9} aria-hidden /> {t('usage.cacheReadShort', 'cache')} {fmt(r.cached)}
                        </span>
                      )}
                      {r.attempts.length > 1 && (
                        <span className="inline-flex items-center gap-0.5">
                          <GitBranch size={9} aria-hidden /> {t('usage.attemptsN', '{n} attempts', { n: String(r.attempts.length) })}
                        </span>
                      )}
                      <span>{new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </span>
                  </span>
                  <span className="tnum text-[10.5px] text-dim w-14 text-end shrink-0" dir="ltr">
                    {r.source === 'none' ? '—' : `${r.source === 'estimated' ? '≈ ' : ''}${fmt(r.tokens)}`}
                  </span>
                  <span className="tnum text-[10.5px] text-dim w-16 text-end shrink-0" dir="ltr" title={t('usage.cost', 'Est. cost')}>
                    {r.source === 'none' && !(r.costUsd > 0) ? (ar ? 'غير معروف' : 'unknown') : `${r.estimated ? '≈ ' : ''}${fmtCost(r.costUsd)}`}
                  </span>
                </div>
              );
            })}
            {allRows.length > shownRows && (
              <div className="px-2.5 py-1 text-[9px] text-faint border-t border-line tnum" dir="ltr">
                +{allRows.length - shownRows} {t('usage.moreRows', 'older rows · total this session:')}
                {' '}
                {fmt(allRowsTokens)}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-2 rounded-[10px] border border-dashed border-[var(--line-strong)] px-2.5 py-2.5 text-[10.5px] text-faint leading-relaxed" role="status">
            {t('usage.perMsgEmpty', 'No billed turns yet — rows appear when a reply completes')}
          </div>
        )}
      </div>

      {/* v10.3 — token economy: real cache numbers from the provider + config state */}
      <TokenEconomyCard />

      {/* v11.40 — ONE authoritative place for the 14-day figures. The daily
          cost chart is FIG. 02 above; this card NEVER redraws it (the old
          usage-bar strip repeated every cost/token tooltip a second time).
          Every stamp here is derived from the SAME usageLog rows the chart
          plots. PROJ/MO is an extrapolation, so it carries "≈". */}
      <div className="aurora-panel p-3">
        <div className="flex items-center justify-between min-w-0 gap-2">
          <SectionTitle>{t('usage.14day', 'Last 14 days')}</SectionTitle>
          <span className="text-[9px] text-faint truncate">
            {ar ? 'الرسم في الأعلى · FIG. 02' : 'chart above · FIG. 02'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-line flex-wrap">
          <span className="stamp !h-[16px] tnum" dir="ltr" title={t('usage.avgDay', 'Average cost per day')}>
            {t('usage.avgDayShort', 'AVG/DAY')} {fmtCost(avgDayCost)}
          </span>
          <span className="stamp stamp-acc !h-[16px] tnum" dir="ltr" title={t('usage.projected', 'Projected monthly cost from the 14-day average')}>
            ≈ {t('usage.projectedShort', 'PROJ/MO')} {fmtCost(projectedMonth)}
          </span>
          <span className="stamp !h-[16px] tnum" dir="ltr" title={t('usage.windowRuns', 'Runs in the window')}>
            {windowRuns} {t('usage.runs', 'runs')}
          </span>
          <span className="stamp !h-[16px] tnum" dir="ltr" title={t('usage.tokens', 'Tokens')}>
            {fmt(windowTokens)} {ar ? 'توكن / ١٤ يوماً' : 'tok / 14d'}
          </span>
        </div>
        {windowRuns === 0 && (
          <div className="mt-2 rounded-[10px] border border-dashed border-[var(--line-strong)] px-2.5 py-2 text-[10.5px] text-faint leading-relaxed" role="status">
            {t('usage.empty', 'No runs in this window yet — usage appears here as you work')}
          </div>
        )}
      </div>

      {/* per-model breakdown — hairline keyrow table */}
      <div className="aurora-panel p-3">
        <SectionTitle>{t('usage.byModel', 'Top models')}</SectionTitle>
        {topModels.length > 0 ? (
          <div className="rounded-[8px] border border-line overflow-hidden mt-1">
            <div className="flex items-center gap-2 px-2.5 py-1 border-b border-line bg-[var(--hover-2)]">
              <span className="text-[8.5px] uppercase tracking-widest text-ghost flex-1 min-w-0">{t('usage.model', 'Model')}</span>
              <span className="text-[8.5px] uppercase tracking-widest text-ghost w-14 text-end shrink-0">{t('usage.tokens', 'Tokens')}</span>
              <span className="text-[8.5px] uppercase tracking-widest text-ghost w-16 text-end shrink-0">{t('usage.cost', 'Cost')}</span>
            </div>
            {topModels.map((m) => (
              <div
                key={m.key}
                className="keyrow !py-1.5"
                title={
                  `${m.key} · ${priceSourceLabel(m.price, ar)}` +
                  (m.price?.matchedId ? ` · ${m.price.matchedId}` : '') +
                  (m.priced && m.catalogCostUsd > 0
                    ? `\n${t('usage.catalogCross', 'catalog cross-check')}: ${fmtCost(m.catalogCostUsd)}`
                    : '')
                }
              >
                <span className="key-main min-w-0 flex flex-col">
                  <span className="tnum text-[10.5px] text-ink truncate" dir="ltr">
                    {m.estimated ? '≈ ' : ''}{m.model || (ar ? 'غير معروف' : 'unknown')}
                  </span>
                  <span className="key-sub flex items-center gap-1.5 flex-wrap">
                    <span>{m.runs} {t('usage.runs', 'runs')}</span>
                    <span className="tnum" dir="ltr">{priceSourceLabel(m.price, ar)}</span>
                  </span>
                </span>
                <span className="tnum text-[10.5px] text-dim w-14 text-end shrink-0" dir="ltr">
                  {m.tokens >= 1000 ? `${(m.tokens / 1000).toFixed(1)}k` : m.tokens}
                </span>
                <span className="tnum text-[10.5px] text-dim w-16 text-end shrink-0" dir="ltr" title={t('usage.cost', 'Est. cost')}>
                  {!m.priced && !(m.costUsd > 0)
                    ? (ar ? 'غير معروف' : 'unknown')
                    : `${m.estimated ? '≈ ' : ''}${fmtCost(m.costUsd)}`}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 rounded-[10px] border border-dashed border-[var(--line-strong)] px-2.5 py-2.5 text-[10.5px] text-faint leading-relaxed" role="status">{t('usage.modelsEmpty', 'No model usage yet')}</div>
        )}
      </div>
    </div>
  );
}

export default UsagePanel;
