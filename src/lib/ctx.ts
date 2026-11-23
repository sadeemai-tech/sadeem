// SADEEM — v11.3 context-fill math + v11.10 (A5) exact-token honesty helpers
// + v11.11 (A6) THE FOUNDER'S EXACT FORMULA.
//
// The REAL context usage is the last completed request, measured as:
//
//     fill = prompt_tokens_including_cached + generated_tokens_of_current_request
//
// The prompt of request N already contains every earlier turn (that is what
// makes inputTokens the transcript size), and its generated output joins the
// transcript the moment the turn ends — so fill = inputTokens + outputTokens
// of the LAST request is the true window occupancy. The cumulative session
// SUM must never drive a context meter — it grew every turn and made the
// ring/bar lie.
//
// v11.10 (A5) — TO THE TOKEN, HONESTLY:
//  · CACHE IS NOT DOUBLE-COUNTED. Both provider families fold the cache split
//    INTO inputTokens (Anthropic: providers.ts adds cache_read/_creation to
//    input_tokens; OpenAI-compat: prompt_tokens includes cached_tokens), so
//    cached input counts toward occupancy as a SEGMENT of the prompt — never
//    subtracted, never added on top.
//  · The fill percentage is carried unrounded — the UI formats it to one
//    decimal ("12,482 / 200,000 tokens · 6.2%"), never a rounded-only figure.
//  · While a stream is live there is no provider number yet: the bar shows a
//    chars/4 estimate on top of the last known fill, clearly marked "≈", and
//    replaces it with the exact provider usage on message_end.
//
// v11.35 (TOKEN-PRECISION) — SOURCE OF TRUTH:
//  · EXACT numbers come ONLY from the provider's reported usage
//    (prompt_tokens / completion_tokens / cache_read / cache_write), mapped
//    once by fromProviderUsageReport() and consumed by ctxFillTokens().
//  · There is NO real BPE tokenizer in this project (verified: no tiktoken /
//    js-tiktoken / gpt-tokenizer dependency). Every pre-report number is an
//    ESTIMATE and is labelled "≈" — never printed as a precise figure.
//  · The fallback estimator is script-aware: Arabic and CJK code points cost
//    more tokens than Latin characters, so an Arabic prompt is not measured
//    with the Latin chars/4 rate.
import type { Usage, UsageAttempt } from '../../shared/types';

export type UsageLike = Usage & { cacheReadTokens?: number; cacheCreationTokens?: number };

// ---------- v1137 — 1M-class window invariant (never display 200k for it) ----------

/** One million tokens — the floor of a "1M-class" context window. */
export const ONE_M_TOKEN_WINDOW = 1_000_000;

/**
 * True for any window at or above 1M (1_000_000 / 1_048_576 / 1_050_000 …).
 * The lens uses this to label a confirmed 1M window honestly and to assert
 * the founder's invariant: a 1M-class model must never be rendered as the
 * generic 200k default.
 */
export function isOneMClassWindow(ctxWindow: number): boolean {
  return Number.isFinite(ctxWindow) && ctxWindow >= ONE_M_TOKEN_WINDOW;
}

// ---------- v11.35 — provider-reported usage is the ONLY exact source ----------

/** Raw provider field names, before the engine maps them onto `Usage`. */
export interface ProviderUsageReport {
  prompt_tokens?: number;
  completion_tokens?: number;
  cache_read?: number;
  cache_read_input_tokens?: number;
  cache_write?: number;
  cache_creation?: number;
  cache_creation_input_tokens?: number;
}

const nonNegative = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0;

/**
 * Map a real provider usage object onto the renderer's `UsageLike`. Cache is
 * NOT added: both provider families already fold it into the prompt total
 * (Anthropic adds cache_read/_creation to input_tokens; OpenAI includes
 * cached_tokens in prompt_tokens). It is recorded only as a SEGMENT so the
 * lens can split one fill without double-counting. `estimated: false` marks
 * these as provider numbers — the one case where "≈" must NOT be shown.
 */
export function fromProviderUsageReport(r: ProviderUsageReport | null | undefined): UsageLike | null {
  if (!r) return null;
  if (!Number.isFinite(r.prompt_tokens) && !Number.isFinite(r.completion_tokens)) return null;
  return {
    inputTokens: nonNegative(r.prompt_tokens),
    outputTokens: nonNegative(r.completion_tokens),
    costUsd: 0,
    cacheReadTokens: nonNegative(r.cache_read ?? r.cache_read_input_tokens),
    cacheCreationTokens: nonNegative(r.cache_write ?? r.cache_creation ?? r.cache_creation_input_tokens),
    estimated: false,
  };
}

/** Where a displayed token count came from — decides whether "≈" is required. */
export type TokenCountSource = 'provider' | 'estimated' | 'none';

export function tokenCountSource(u: UsageLike | null | undefined): TokenCountSource {
  if (!u) return 'none';
  if (nonNegative(u.inputTokens) + nonNegative(u.outputTokens) <= 0) return 'none';
  return u.estimated === true ? 'estimated' : 'provider';
}

/**
 * True window occupancy of the last completed request: prompt tokens (cache
 * INSIDE, per the A5 contract) plus the tokens that request generated.
 * v11.11 (A6) — this is the founder's exact formula; before A6 the generated
 * half was missing and every bar understated occupancy by the output size.
 */
export function ctxFillTokens(u: UsageLike | null | undefined): number {
  if (!u) return 0;
  return Math.max(0, (u.inputTokens ?? 0) + (u.outputTokens ?? 0));
}

/** Unrounded fill percentage — the UI renders this with one decimal. */
export function ctxPctExact(u: UsageLike | null | undefined, ctxWindow: number): number {
  if (!ctxWindow || ctxWindow <= 0) return 0;
  return Math.min(100, (ctxFillTokens(u) / ctxWindow) * 100);
}

/** Rounded percentage (ring arc geometry + legacy callers). */
export function ctxPctOf(u: UsageLike | null | undefined, ctxWindow: number): number {
  return Math.round(ctxPctExact(u, ctxWindow));
}

/**
 * v11.11 (A6) — streaming-aware percentage: last exact fill PLUS the chars/4
 * estimate of the output streamed so far (marked "≈" by the callers), so the
 * bar moves DURING the stream instead of only at finalize.
 */
export function ctxPctLiveOf(
  u: UsageLike | null | undefined,
  ctxWindow: number,
  streamedChars = 0,
  script: TokenScript = 'latin',
): number {
  if (!ctxWindow || ctxWindow <= 0) return 0;
  const fill = ctxFillTokens(u) + estimateTokensFromChars(streamedChars, script);
  return Math.min(100, (fill / ctxWindow) * 100);
}

// ---------- v11.34 (CTX-1) — REAL-window compaction + honest occupancy ----------
// The founder's bug: a 1M-context model was measured against a 200k fallback
// and auto-compacted at 65% of THAT (130k = 13% of the real window), so the
// orb looked full and compaction fired constantly. Auto-compaction now engages
// only NEAR the model's REAL window (90%), driven by the exact occupancy —
// never a fixed small token count. A user-initiated /compact is a different
// code path and is unaffected.

/** Auto-compaction engages at 90% of the model's REAL context window. */
export const COMPACT_TRIGGER_RATIO = 0.9;

/**
 * Token count at which auto-compaction becomes eligible. 0 ⇒ the window is
 * unknown, so there is no honest threshold and callers MUST NOT auto-compact.
 */
export function compactionThresholdTokens(ctxWindow: number): number {
  if (!Number.isFinite(ctxWindow) || ctxWindow <= 0) return 0;
  return Math.floor(ctxWindow * COMPACT_TRIGGER_RATIO);
}

/** True only when the real window is known and the exact fill is near its ceiling. */
export function isCompactionEligible(fill: number, ctxWindow: number): boolean {
  const threshold = compactionThresholdTokens(ctxWindow);
  if (threshold <= 0) return false;
  return Math.max(0, fill) >= threshold;
}

/**
 * Honest occupancy percentage for the orb. `null` ⇒ no trustworthy percentage
 * exists: the window is unknown, OR it is an ≈-default that the fill has
 * already exceeded (in which case a clamped 100% would be a lie — the real
 * window is plainly larger). Callers show the token count + "window unknown"
 * instead of inventing a percentage.
 */
export function contextFillPercent(
  fill: number,
  ctxWindow: number,
  windowEstimated = false,
): number | null {
  if (!Number.isFinite(ctxWindow) || ctxWindow <= 0) return null;
  const f = Math.max(0, fill);
  if (windowEstimated && f >= ctxWindow) return null;
  return Math.min(100, (f / ctxWindow) * 100);
}

/** Non-overlapping token segments that sum to EXACTLY the single fill. */
export interface OccupancySegments {
  cacheRead: number;
  cacheWrite: number;
  fresh: number;
  generated: number;
  streamed: number;
  total: number;
}

/**
 * v11.34 — honest segment split of ONE fill. Cache lives INSIDE inputTokens
 * (both provider families fold it in); generated output is already part of
 * `fill`. The old bar painted `fill` AND `generated` on top of it whenever no
 * cache split existed — a double count that made the meter look full. Every
 * segment here is disjoint and the five parts sum to `total`.
 */
export function occupancySegments(
  u: UsageLike | null | undefined,
  fill = ctxFillTokens(u),
): OccupancySegments {
  const input = Math.max(0, u?.inputTokens ?? 0);
  const read = Math.min(input, Math.max(0, u?.cacheReadTokens ?? 0));
  const write = Math.max(0, Math.min(input, read + Math.max(0, u?.cacheCreationTokens ?? 0)) - read);
  const fresh = Math.max(0, input - read - write);
  const generated = Math.max(0, u?.outputTokens ?? 0);
  const streamed = Math.max(0, Math.max(0, fill) - input - generated);
  return { cacheRead: read, cacheWrite: write, fresh, generated, streamed, total: Math.max(0, fill) };
}

// ---------- v11.35 — HONEST estimator (no real BPE tokenizer installed) ----------

/**
 * Script profile of the text being measured. Arabic and CJK code points carry
 * substantially more tokens per character than Latin text under byte-level
 * BPE, so measuring an Arabic stream at chars/4 understates it by ~2×.
 */
export type TokenScript = 'latin' | 'arabic' | 'cjk' | 'mixed';

/** Conservative, documented chars-per-token rates for the three scripts. */
export const CHARS_PER_TOKEN: Record<Exclude<TokenScript, 'mixed'>, number> = {
  latin: 4,
  arabic: 2,
  cjk: 1.5,
};

const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const CJK_SCRIPT = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;
const LATIN_ALNUM = /[A-Za-z0-9]/;

/** Detect the dominant script of a string for the text-based estimator. */
export function detectTokenScript(text: string): TokenScript {
  let arabic = 0;
  let cjk = 0;
  let latin = 0;
  for (const ch of text) {
    if (ARABIC_SCRIPT.test(ch)) arabic++;
    else if (CJK_SCRIPT.test(ch)) cjk++;
    else if (LATIN_ALNUM.test(ch)) latin++;
  }
  const nonLatin = arabic + cjk;
  if (nonLatin === 0) return 'latin';
  if (latin === 0) return arabic >= cjk ? 'arabic' : 'cjk';
  return 'mixed';
}

/**
 * Script-aware ESTIMATE for real text (≈, never exact): each code point gets
 * the rate of its own script, so a mixed Arabic/English sentence is measured
 * honestly instead of at one Latin rate. This is a heuristic, NOT a tokenizer.
 */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  for (const ch of text) {
    if (ARABIC_SCRIPT.test(ch)) tokens += 1 / CHARS_PER_TOKEN.arabic;
    else if (CJK_SCRIPT.test(ch)) tokens += 1 / CHARS_PER_TOKEN.cjk;
    else if ((ch.codePointAt(0) ?? 0) > 0xffff) tokens += 1; // emoji / astral symbol
    else tokens += 1 / CHARS_PER_TOKEN.latin;
  }
  return Math.ceil(tokens);
}

/**
 * Char-count fallback (the renderer only receives a `liveStreamChars` counter,
 * never the streamed text). Default `latin` preserves the engine's chars/4
 * heuristic; callers that know the language pass `arabic` / `cjk` / `mixed`.
 */
export function estimateTokensFromChars(chars: number, script: TokenScript = 'latin'): number {
  const charsPerToken = script === 'mixed'
    ? (CHARS_PER_TOKEN.latin + CHARS_PER_TOKEN.arabic) / 2
    : CHARS_PER_TOKEN[script];
  return Math.ceil(Math.max(0, chars) / charsPerToken);
}

/**
 * Live estimate while a stream runs: the last known window fill plus the
 * output streamed so far. ALWAYS an estimate — the UI keeps the "≈" marker
 * until message_end replaces it with the provider's exact usage.
 */
export function liveFillEstimate(
  prevFill: number,
  streamedChars: number,
  script: TokenScript = 'latin',
): number {
  return Math.max(0, prevFill) + estimateTokensFromChars(streamedChars, script);
}

// ---------- v11.10 (A5) — session billing accumulator (store-level math) ----------
// The store accumulates the RUN VIEW of each message_end here (via
// runUsageView — the whole-turn billing truth), and the Usage tab renders
// per-message rows from the SAME view, so sum(per-message) == session total
// reconciles by construction.

export type SessionUsageLike = UsageLike & { attempts?: UsageAttempt[] };

/** Sum one turn's billing usage into the session accumulator (pure, new object). */
export function accumulateUsage(
  prev: SessionUsageLike | null | undefined,
  delta: SessionUsageLike,
): SessionUsageLike {
  const p = prev ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  return {
    inputTokens: (p.inputTokens ?? 0) + (delta.inputTokens ?? 0),
    outputTokens: (p.outputTokens ?? 0) + (delta.outputTokens ?? 0),
    costUsd: Math.round(((p.costUsd ?? 0) + (delta.costUsd ?? 0)) * 1e6) / 1e6,
    cacheReadTokens: (p.cacheReadTokens ?? 0) + (delta.cacheReadTokens ?? 0),
    cacheCreationTokens: (p.cacheCreationTokens ?? 0) + (delta.cacheCreationTokens ?? 0),
    attempts: [...(p.attempts ?? []), ...(delta.attempts ?? [])],
  };
}

/** Zeroed session accumulator (fresh session / reset). */
export function emptySessionUsage(): SessionUsageLike {
  return {
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    attempts: [],
  };
}

/**
 * The BILLING view of a message_end usage payload: the whole-turn run totals
 * (all rounds + all attempts — the real money) with the honesty marker. The
 * per-message rows use this; the context bar keeps the raw DELTA fields.
 */
export function runUsageView(u: SessionUsageLike | null | undefined): UsageLike & { attempts?: UsageAttempt[] } {
  if (!u) return { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const attempts = u.attempts ?? [];
  return {
    inputTokens: u.runInput ?? u.inputTokens,
    outputTokens: u.runOutput ?? u.outputTokens,
    costUsd: u.runCost ?? u.costUsd,
    cacheReadTokens: u.runCacheRead ?? u.cacheReadTokens,
    cacheCreationTokens: u.runCacheCreation ?? u.cacheCreationTokens,
    estimated: u.estimated === true || attempts.some((a) => a.estimated === true) || undefined,
    attempts: attempts.length ? attempts : undefined,
  };
}

// ---------- v12 (E) — Context Lens "copy breakdown" + remaining budget ----------

/** Honest remaining window budget: never negative, 0 when unknown. */
export function remainingContextTokens(fill: number, ctxWindow: number): number {
  if (!ctxWindow || ctxWindow <= 0) return 0;
  return Math.max(0, ctxWindow - Math.max(0, fill));
}

export type BreakdownLang = 'en' | 'ar';

export interface ContextBreakdown {
  model: string;
  fill: number;
  window: number;
  windowEstimated?: boolean;
  approximate?: boolean;
  cacheRead?: number;
  cacheWrite?: number;
  generated?: number;
  sessionTotal?: number;
  sessionCostUsd?: number;
  /** v11.35 — single-language output: 'en' (default) or 'ar'. */
  lang?: BreakdownLang;
  /** v11.35 — true when the cumulative session figures include an estimate. */
  sessionEstimated?: boolean;
  /** v11.35 — where the displayed fill came from. */
  source?: TokenCountSource;
}

interface BreakdownText {
  title: (model: string) => string;
  context: (fillMark: string, fill: string, window: string) => string;
  remaining: (mark: string, value: string) => string;
  cache: (mark: string, read: string, write: string, fresh: string, generated: string) => string;
  session: (mark: string, total: string, costMark: string, cost: string) => string;
  note: string;
  unknownWindow: string;
  sourceProvider: string;
  sourceEstimated: string;
  sourceNone: string;
}

const BREAKDOWN_TEXT: Record<BreakdownLang, BreakdownText> = {
  en: {
    title: (model) => `SADEEM context — ${model || 'unknown model'}`,
    context: (mark, fill, window) => `Context: ${mark}${fill} / ${window} tokens`,
    remaining: (mark, value) => `Remaining: ${mark}${value} tokens`,
    cache: (mark, read, write, fresh, generated) =>
      `Cache read ${mark}${read} · cache write ${mark}${write} · fresh input ${mark}${fresh} · generated ${mark}${generated}`,
    session: (mark, total, costMark, cost) =>
      `Session total ${mark}${total} tokens · ${costMark}$${cost}`,
    note: '≈ figures are estimates until the provider reports exact usage',
    unknownWindow: 'unknown',
    sourceProvider: 'Source: provider reported usage',
    sourceEstimated: 'Source: estimate (no provider usage reported)',
    sourceNone: 'Source: no usage reported yet',
  },
  ar: {
    title: (model) => `سياق سيديم — ${model || 'نموذج غير معروف'}`,
    context: (mark, fill, window) => `السياق: ${mark}${fill} / ${window} رمزاً`,
    remaining: (mark, value) => `المتبقي: ${mark}${value} رمزاً`,
    cache: (mark, read, write, fresh, generated) =>
      `قراءة الكاش ${mark}${read} · كتابة الكاش ${mark}${write} · إدخال جديد ${mark}${fresh} · مُولَّد ${mark}${generated}`,
    session: (mark, total, costMark, cost) =>
      `إجمالي الجلسة ${mark}${total} رمزاً · ${costMark}$${cost}`,
    note: 'الأرقام المسبوقة بـ ≈ تقديرية حتى يبلغ المزوّد عن استخدام دقيق',
    unknownWindow: 'غير معروف',
    sourceProvider: 'المصدر: استخدام أبلغ عنه المزوّد',
    sourceEstimated: 'المصدر: تقديري (لم يبلغ المزوّد عن استخدام)',
    sourceNone: 'المصدر: لم يُبلَّغ عن استخدام بعد',
  },
};

/**
 * Plain-text, copy-friendly snapshot of the Context Lens. Uses ONLY numbers
 * the renderer actually received (never invents per-surface segments). Every
 * figure derived from an estimate carries its own "≈" — the old version
 * marked only the fill/window and printed "remaining", "cache" and "session"
 * as if they were exact. Pure — no clipboard or DOM access — so unit-testable.
 */
export function formatContextBreakdown(b: ContextBreakdown): string {
  const dict = BREAKDOWN_TEXT[b.lang === 'ar' ? 'ar' : 'en'];
  const src: TokenCountSource = b.source
    ?? (b.approximate || b.windowEstimated || b.sessionEstimated
      ? 'estimated'
      : (b.fill ?? 0) > 0 ? 'provider' : 'none');
  const fillApprox = b.approximate === true;
  const windowApprox = b.windowEstimated === true || !(b.window > 0);
  const sessionApprox = b.sessionEstimated === true || fillApprox;
  const mark = (on: boolean): string => (on ? '≈' : '');
  const fresh = Math.max(0, (b.fill ?? 0) - (b.cacheRead ?? 0) - (b.cacheWrite ?? 0) - (b.generated ?? 0));
  const lines = [
    dict.title(b.model),
    dict.context(
      mark(fillApprox),
      String(Math.round(b.fill ?? 0)),
      b.window > 0 ? `${mark(windowApprox)}${Math.round(b.window)}` : dict.unknownWindow,
    ),
    dict.remaining(mark(fillApprox || windowApprox), String(remainingContextTokens(b.fill ?? 0, b.window ?? 0))),
    dict.cache(
      mark(fillApprox),
      String(Math.round(b.cacheRead ?? 0)),
      String(Math.round(b.cacheWrite ?? 0)),
      String(fresh),
      String(Math.round(b.generated ?? 0)),
    ),
    dict.session(
      mark(sessionApprox),
      String(Math.round(b.sessionTotal ?? 0)),
      mark(sessionApprox),
      (b.sessionCostUsd ?? 0).toFixed(4),
    ),
  ];
  if (fillApprox || windowApprox || sessionApprox || src === 'none') lines.push(dict.note);
  lines.push(src === 'provider' ? dict.sourceProvider : src === 'estimated' ? dict.sourceEstimated : dict.sourceNone);
  return lines.join('\n');
}
