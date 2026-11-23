// ErrorNotice — v11.35. THE CALM APP-ERROR INSTRUMENT.
//
// The founder: "مش أخطاء الذكاء الاصطناعي، أخطاء التطبيق — البروفايدر أو
// الريت ليميتنج — إنه يتم عرضه بطريقة أوضح وأجمل وأفضل."
//
// Scope: SYSTEM/APP failures only (provider 429 / quota exhausted / provider
// 503 / network / auth), carried into the transcript by store.ts as a
// `model:'error'` row. This is NOT the assistant's prose — the AI's own words
// still render as ordinary markdown. The old surface was a tinted boxy
// `.error-card` with a raw, unclassified text dump; this is a single 1px
// hairline instrument: short human title · the REAL machine reason · one
// concrete next step · a retry action only when a REAL handler exists.
//
// Design contract (same grammar as the rest of SADEEM's instruments):
//   · no box, no fill, no shadow, no gradient — one inline-start hairline;
//   · 1px currentColor glyph on a 24×24 grid, symmetric (RTL-safe);
//   · Instrument Serif display title, tabular mono machine code;
//   · one language per locale, never EN+AR stitched together;
//   · motion gated by BOTH prefers-reduced-motion AND html.reduce-motion.
//
// Pure helpers (classifyError / machineCodeOf / detailTextOf) are exported so
// the SSR suite can verify the classification without a DOM.
import React, { useState } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';
import './error-display.css';

// ---------------------------------------------------------------------------
// PURE CLASSIFICATION — reads the real payload, never invents a cause.
// Precedence: auth → quota → rate-limit → provider 5xx → network → generic.
// ---------------------------------------------------------------------------
export type AppErrorKind = 'rateLimit' | 'quota' | 'provider' | 'network' | 'auth' | 'generic';

const PATTERN: Record<Exclude<AppErrorKind, 'generic'>, RegExp> = {
  auth: /no api key|missing api key|invalid api key|unauthorized|\b401\b|\b403\b|authentication failed|مفتاح.*(?:غير صالح|مفقود)|غير مصرح/i,
  quota: /insufficient credits|no_credits|credit balance|out of credits|quota (?:exhausted|reached)|\b402\b|رصيد|اعتماد/i,
  rateLimit: /rate.?limit|too many requests|\b429\b|يحدد الطلبات|يحدّد الطلبات|طلبات كثيرة/i,
  provider: /\b503\b|\b5\d\d\b|unavailable|unreachable|overloaded|service.{0,12}down|المزوّد غير متاح|المزود غير متاح/i,
  network: /offline|econn|enotfound|network|fetch failed|timed? ?out|timeout|الشبكة|انقطع الاتصال|تعذّر الاتصال/i,
};

// ---------------------------------------------------------------------------
// v11.37 (ERROR HONESTY) — ASSISTANT PROSE IS NOT AN APP ERROR.
//
// The founder: "ارسلت له رسالة بيحكي لي الريت ليميت 429، وتلاقي انه دغري
// الذكاء الاصطناعي رد، بس بطلع لي هذا الغلط" — the AI answers fine, yet a
// 429 error card is still painted. The old gate was `msg.model === 'error'`
// and `classifyError` pattern-matched ANY text containing "429"/"rate":
// a stale / leaked row carrying an ordinary answer became a loud rate card.
//
// These two pure helpers are the honesty boundary:
//   • isAssistantProse  — recognises a normal answer that merely MENTIONS a
//     status; it is never a machine failure and must never be classified.
//   • isGenuineAppError — the ONLY gate MessageView uses to mount the card.
//     An explicit `isError` / `role:'error'` (or the legacy `model:'error'`
//     tag) is required, AND a streaming row or an assistant-answer row is
//     rejected even if a stale/leaked tag says "error".
// A REAL 429 (machine payload or canonical failure sentence) still passes.
// ---------------------------------------------------------------------------

/** Conversational openings + success claims that belong to the AI's ANSWER,
 *  not to an application failure. A canonical failure sentence ("Rate limited
 *  (429) – retries were exhausted…", "Insufficient credits (402)", …) never
 *  matches: it describes a failed request, not a completed answer. */
const ASSISTANT_PROSE_RE =
  /^(?:sure\b|here(?:'s| is| are)\b|i\b|we\b|ok\b|okay\b|done\b|thanks\b|you can\b|the answer\b|as requested\b|to summarize\b|in summary\b|based on\b)/i;
const SUCCESS_PROSE_RE =
  /\b(?:it worked|worked again|task (?:is )?(?:complete|completed|done)|completed successfully|resolved (?:it|the issue)|no error (?:now|anymore)|succeeded)\b/i;
/** A real HTTP/named status token: a genuine failure may still contain a word
 *  like "succeeded" ("no provider succeeded (429)") — never misread it as an
 *  answer just because of that word. */
const MACHINE_SIGNATURE_RE =
  /\b[45]\d{2}\b|\b(?:ENOTFOUND|ECONNRESET|ETIMEDOUT|NO_MODEL|NO_CREDITS|NO_API_KEY)\b/i;

/** True when the text reads like a normal assistant reply, not an app failure.
 *  Structured payloads (JSON) are never "prose" — they are error material. */
export function isAssistantProse(raw: unknown): boolean {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || /^[{[]/.test(s)) return false;
  // A conversational opener is decisive even when it mentions a status code.
  if (ASSISTANT_PROSE_RE.test(s)) return true;
  if (MACHINE_SIGNATURE_RE.test(s)) return false;
  return SUCCESS_PROSE_RE.test(s);
}

export interface ErrorLikeRow {
  role?: string;
  model?: string;
  isError?: boolean;
  streaming?: boolean;
  content?: string;
}

/** The single, strict gate for mounting an app-error card. A normal assistant
 *  answer — even one that mentions "429" / "rate limit" — is NEVER an error. */
export function isGenuineAppError(msg: ErrorLikeRow | null | undefined): boolean {
  if (!msg) return false;
  const explicit = msg.isError === true || msg.role === 'error';
  const tagged = msg.model === 'error';
  if (!explicit && !tagged) return false;
  // Live deltas are assistant output being written, never a settled app error.
  if (msg.streaming) return false;
  // Decisive: an answer-shaped payload wins over a stale / leaked error tag.
  return !isAssistantProse(msg.content);
}

export function classifyError(raw: unknown): AppErrorKind {
  const s = typeof raw === 'string' ? raw : '';
  if (!s.trim() || isAssistantProse(s)) return 'generic';
  if (PATTERN.auth.test(s)) return 'auth';
  if (PATTERN.quota.test(s)) return 'quota';
  if (PATTERN.rateLimit.test(s)) return 'rateLimit';
  if (PATTERN.provider.test(s)) return 'provider';
  if (PATTERN.network.test(s)) return 'network';
  return 'generic';
}

/** Uppercase tokens that are ordinary vocabulary, NOT machine reason codes. */
const NOT_A_CODE = new Set([
  'API', 'URL', 'HTTP', 'HTTPS', 'JSON', 'JSONL', 'UTF', 'GET', 'POST',
  'MCP', 'LSP', 'PDF', 'CLI', 'IDE', 'EN', 'AR', 'OK', 'AI', 'CSS', 'HTML',
  'SDK', 'HTTP2', 'DNS',
]);

/** Extract the SHORT, language-neutral machine reason: 429 / 402 / 503 /
 *  ENOTFOUND / NO_MODEL / … Never prose, never a JSON dump. */
export function machineCodeOf(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  const status = s.match(/\b([45]\d{2})\b/);
  if (status) return status[1];
  const named = s.match(/\b(E[A-Z0-9]{2,}|KDX_[A-Z0-9_]+|NO_[A-Z_]+|BAD_SHAPE)\b/);
  if (named) return named[1];
  const upper = s.match(/\b([A-Z][A-Z0-9_.-]{2,24})\b/);
  if (upper && !NOT_A_CODE.has(upper[1])) return upper[1];
  return '';
}

const ARABIC_SCRIPT_RE = /\p{Script=Arabic}/u;
const LATIN_PROSE_RE = /\b(the|and|with|provider|request|please|error|could|not|try|again|check|settings|right|now)\b/i;

/** Optional "Details" disclosure text. Raw JSON never reaches the surface —
 *  at most its `message`/`error` string, and only when it matches the UI
 *  language. Empty string ⇒ no disclosure is mounted at all (also keeps raw
 *  payload bytes out of SSR markup). */
export function detailTextOf(raw: unknown, ar: boolean): string {
  let s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return '';
  if (/^[{[]/.test(s)) {
    try {
      const obj = JSON.parse(s) as { message?: unknown; error?: unknown; reason?: unknown } | null;
      const inner = obj && typeof obj === 'object' ? (obj.message ?? obj.error ?? obj.reason) : undefined;
      s = typeof inner === 'string' ? inner.trim() : '';
    } catch {
      return '';
    }
    if (!s || /^[{[]/.test(s)) return '';
  }
  s = s.replace(/\s+/g, ' ').slice(0, 420);
  const hasArabic = ARABIC_SCRIPT_RE.test(s);
  const hasLatinProse = LATIN_PROSE_RE.test(s);
  // One language only: Arabic UI refuses an English sentence (and vice versa).
  if (ar ? (hasLatinProse && !hasArabic) : hasArabic) return '';
  return s;
}

// ---------------------------------------------------------------------------
// COPY TABLE — [English, Arabic]. `t(key, english)` is canonical; if the i18n
// bundle has not received the key yet, an Arabic locale uses the local Arabic
// string instead of the English fallback so the surface is never mixed.
// Parent MUST add every key listed in docs/ERROR-DISPLAY-V1135.md.
// ---------------------------------------------------------------------------
type Pair = readonly [string, string];
interface KindCopy {
  title: Pair;
  reason: Pair;
  next: Pair;
  keys: { title: string; reason: string; next: string };
}

const COPY: Record<AppErrorKind, KindCopy> = {
  rateLimit: {
    title: ['Rate limit reached', 'تم بلوغ حد الطلبات'],
    reason: ['The provider is limiting requests right now.', 'المزوّد يحدّد الطلبات حالياً.'],
    next: ['Wait a moment, then retry — or switch models.', 'انتظر قليلاً ثم أعد المحاولة — أو بدّل النموذج.'],
    keys: {
      title: 'err.display.title.rateLimit',
      reason: 'err.display.reason.rateLimit',
      next: 'err.display.next.rateLimit',
    },
  },
  quota: {
    title: ['Credits exhausted', 'الرصيد مستنفد'],
    reason: ['The provider account has no credits left.', 'حساب المزوّد ليس لديه رصيد متبقٍ.'],
    next: ['Add credits or switch provider/key in Settings → AI providers.', 'أضف رصيداً أو بدّل المزوّد/المفتاح من الإعدادات ← مزودو الذكاء الاصطناعي.'],
    keys: {
      title: 'err.display.title.quota',
      reason: 'err.display.reason.quota',
      next: 'err.display.next.quota',
    },
  },
  provider: {
    title: ['Provider unavailable', 'المزوّد غير متاح'],
    reason: ['The provider did not answer this request.', 'المزوّد لم يجب على هذا الطلب.'],
    next: ['Check the connection, then retry or switch provider.', 'تحقق من الاتصال، ثم أعد المحاولة أو بدّل المزوّد.'],
    keys: {
      title: 'err.display.title.provider',
      reason: 'err.display.reason.provider',
      next: 'err.display.next.provider',
    },
  },
  network: {
    title: ['Connection lost', 'انقطع الاتصال'],
    reason: ['The request never reached the provider.', 'لم يصل الطلب إلى المزوّد.'],
    next: ['Check your connection, then retry.', 'تحقق من اتصالك، ثم أعد المحاولة.'],
    keys: {
      title: 'err.display.title.network',
      reason: 'err.display.reason.network',
      next: 'err.display.next.network',
    },
  },
  auth: {
    title: ['API key needs attention', 'مفتاح API يحتاج تحققاً'],
    reason: ['The provider rejected the credentials.', 'المزوّد رفض بيانات الاعتماد.'],
    next: ['Check your API key in Settings → AI providers.', 'تحقق من مفتاح API في الإعدادات ← مزودو الذكاء الاصطناعي.'],
    keys: {
      title: 'err.display.title.auth',
      reason: 'err.display.reason.auth',
      next: 'err.display.next.auth',
    },
  },
  generic: {
    title: ["Couldn't complete the request", 'تعذّر إكمال الطلب'],
    reason: ['The request stopped before an answer arrived.', 'توقّف الطلب قبل وصول الإجابة.'],
    next: ['Retry, or check the provider settings.', 'أعد المحاولة، أو تحقق من إعدادات المزوّد.'],
    keys: {
      title: 'err.display.title.generic',
      reason: 'err.display.reason.generic',
      next: 'err.display.next.generic',
    },
  },
};

const EYEBROW: Pair = ['APP ERROR', 'خطأ التطبيق'];
const RETRY: Pair = ['Retry', 'إعادة المحاولة'];
const DETAILS: Pair = ['Details', 'التفاصيل'];
const HIDE_DETAILS: Pair = ['Hide details', 'إخفاء التفاصيل'];

/** `t(key, 'English fallback')` — always exactly one language in the output. */
function useLabel(): (key: string, en: string, ar: string) => string {
  const t = useT();
  const ar = useStore((s) => s.settings?.language === 'ar');
  return (key, en, arText) => {
    const viaI18n = t(key, en);
    // Key absent from the bundle yet → t() returns our English fallback.
    // In an Arabic UI substitute the local Arabic string, never English.
    return ar && viaI18n === en ? arText : viaI18n;
  };
}

export interface ErrorNoticeProps {
  /** The already-localized error text carried by the model:'error' row. */
  content: string;
  /** ONLY a real ChatPanel retry handler — omitted ⇒ no retry affordance. */
  onRetry?: () => void;
}

export function ErrorNotice({ content, onRetry }: ErrorNoticeProps) {
  const label = useLabel();
  const ar = useStore((s) => s.settings?.language === 'ar');
  const [showDetail, setShowDetail] = useState(false);
  const raw = typeof content === 'string' ? content : '';
  const kind = classifyError(raw);
  const code = machineCodeOf(raw);
  const detail = detailTextOf(raw, ar);
  const copy = COPY[kind];
  const title = label(copy.keys.title, copy.title[0], copy.title[1]);
  const reason = label(copy.keys.reason, copy.reason[0], copy.reason[1]);
  const next = label(copy.keys.next, copy.next[0], copy.next[1]);
  const eyebrow = label('err.display.eyebrow', EYEBROW[0], EYEBROW[1]);
  const retryLabel = label('err.display.retry', RETRY[0], RETRY[1]);
  const detailLabel = label('err.display.details', DETAILS[0], DETAILS[1]);
  const hideLabel = label('err.display.detailsHide', HIDE_DETAILS[0], HIDE_DETAILS[1]);

  return (
    <div
      className="ed anim-in msg-in"
      data-testid="app-error-notice"
      data-kind={kind}
      role="status"
      aria-live="polite"
      dir="auto"
    >
      <span className="ed-rule" aria-hidden />
      <div className="ed-body">
        <div className="ed-head">
          <span className="ed-glyph" aria-hidden>
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              focusable="false"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {/* interrupted orbit — a 270° hairline arc with an open top */}
              <path d="M6.34 6.34A8 8 0 1 0 17.66 6.34" />
              {/* the quiet break: a 1px cross centred exactly on (12, 4) */}
              <path d="M10.8 2.8 13.2 5.2M13.2 2.8 10.8 5.2" opacity=".9" />
              {/* registration stem + base tick, reaching the ring at y=20 */}
              <path d="M12 15.4v3M9.6 20h4.8" opacity=".5" />
              <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span className="ed-heading">
            <span className="ed-eyebrow" dir="auto">{eyebrow}</span>
            <span className="ed-title">{title}</span>
          </span>
          {code && (
            <span className="ed-code" dir="ltr" title={code}>{code}</span>
          )}
        </div>
        <p className="ed-reason">{reason}</p>
        <p className="ed-next">
          <span className="ed-next-mark" aria-hidden />
          {next}
        </p>
        {(onRetry || detail) && (
          <div className="ed-actions">
            {onRetry && (
              <button type="button" className="ed-retry" onClick={onRetry} title={retryLabel} aria-label={retryLabel}>
                <svg viewBox="0 0 16 16" width="12" height="12" focusable="false" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M11.25 11.25A4.6 4.6 0 1 1 11.25 4.75" />
                  <path d="M9.6 3.1 11.9 4.4 10.4 6.3" />
                </svg>
                {retryLabel}
              </button>
            )}
            {detail && (
              <button
                type="button"
                className="ed-detail-toggle"
                onClick={() => setShowDetail((v) => !v)}
                aria-expanded={showDetail}
              >
                {showDetail ? hideLabel : detailLabel}
              </button>
            )}
          </div>
        )}
        {showDetail && detail && (
          <div className="ed-detail" dir="auto">{detail}</div>
        )}
      </div>
    </div>
  );
}

export default ErrorNotice;
