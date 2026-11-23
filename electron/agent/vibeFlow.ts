// ============================================================
// SADEEM v11.13 — Vibe Coder internal capability module
// ------------------------------------------------------------
// Pure, deterministic helpers. NO IO, NO side effects, NO new
// dependencies. Consumed by prompts.ts (word-stable prompt
// sections) and engine.ts (post-run self-critique + Run & Show).
// v11.18 (NOTICE POLICY): audit / proof / critique notices are for REAL
// work only — a simple chat turn emits nothing (see docs/V1118-NOTICE-POLICY.md).
//
// Design rules (from docs/OPENCODE-RE.md research):
//  · prompt sections are STATIC: identical on every turn, so the
//    provider prompt cache keeps hitting (same pattern as the
//    other word-stable sections in prompts.ts);
//  · they are ADVISORY ONLY — they steer defaults, never grant or
//    restrict permissions, and the user's current request wins;
//  · every user-visible string is bilingual (EN + AR);
//  · reports are honest: never fabricate results or screenshots.
// ============================================================

import type { ClaimAudit } from './verification';

export type FlowLang = 'ar' | 'en';

function bi(en: string, ar: string, language: FlowLang | undefined): string {
  return language === 'ar' ? `${en} — ${ar}` : en;
}

function langOf(language?: FlowLang): FlowLang {
  return language === 'ar' ? 'ar' : 'en';
}

/** Stable marker — tests assert it reaches the system prompt. */
export const VIBE_FLOW_MARKER = '# Vibe Coder contract';

/**
 * 1. Vibe Coder standing contract. Advisory, word-stable.
 * Teaches the agent to plan before non-trivial edits, work in small
 * verified steps, explain trade-offs in the user's language, and
 * always separate verified facts from assumptions.
 */
export function vibeCoderSection(language?: FlowLang): string {
  const lang = langOf(language);
  return [
    '# Vibe Coder contract (advisory defaults)',
    'You are building for a vibe coder — a human who describes intent, not implementation steps. ' +
      'These are guidance defaults, NOT permissions or bans: they never restrict what you may do, and the user\u2019s current request always wins.',
    bi(
      '- PLAN FIRST for non-trivial edits: in 2–5 lines state what you will change and why, then act. Trivial one-line fixes need no plan.',
      'خطّط أولًا للتعديلات غير البسيطة: اذكر في ٢–٥ أسطر ما ستغيّره ولماذا، ثم نفّذ. الإصلاحات السطرية البسيطة لا تحتاج خطة.',
      lang,
    ),
    bi(
      '- SMALL VERIFIED STEPS: make the smallest change that can be checked; after each edit run the relevant build/typecheck/test and READ the result before the next change.',
      'خطوات صغيرة مُتحقَّق منها: أجْرِ أصغر تعديل يمكن فحصه، وبعد كل تعديل شغّل البناء/فحص الأنواع/الاختبارات واقرأ النتيجة قبل التالي.',
      lang,
    ),
    bi(
      '- TRADE-OFFS IN THE USER\u2019S LANGUAGE: explain meaningful choices briefly in the language the user writes in (Arabic for Arabic); keep identifiers, file names and commands in English.',
      'اشرح المفاضلات بلغة المستخدم: اذكر الخيارات المهمة بلغة كتابة المستخدم (العربية للعربية)، واترك الأسماء والأوامر بالإنجليزية.',
      lang,
    ),
    bi(
      '- VERIFIED vs ASSUMED: end every substantive answer with one short line naming what you actually verified (command + result) and what remains an assumption. Never present an assumption as a fact.',
      'مُتحقَّق مقابل مفترض: أنهِ كل إجابة جوهرية بسطر واحد يذكر ما تحققتَ منه فعلاً (الأمر + النتيجة) وما زال افتراضًا. لا تعرض الافتراض كحقيقة.',
      lang,
    ),
  ].join('\n');
}

/**
 * 2. Concise polyglot capability note. No token bloat: four rules.
 */
export function polyglotSection(language?: FlowLang): string {
  const lang = langOf(language);
  return [
    '# Polyglot engineering (any language)',
    bi(
      '- NAVIGATE WITH LSP FIRST when a server exists (lsp_definition / lsp_references / lsp_diagnostics); fall back to repo_map / symbol_outline / find_refs and say so honestly.',
      'استخدم LSP أولًا عند توفره (lsp_definition / lsp_references / lsp_diagnostics)، ثم ارجع إلى repo_map / symbol_outline / find_refs وقل ذلك بصراحة.',
      lang,
    ),
    bi(
      '- DETECT BEFORE EDITING: read the manifests (package.json, pyproject.toml, Cargo.toml, go.mod, build.gradle, Makefile, …) and identify the real build/test/lint commands before touching code.',
      'اكتشف قبل التعديل: اقرأ ملفات الإعداد (package.json، pyproject.toml، Cargo.toml، go.mod، build.gradle، Makefile، …) وحدّد أوامر البناء/الاختبار/الفحص الحقيقية قبل لمس الكود.',
      lang,
    ),
    bi(
      '- FRAMEWORK IDIOMS: when unsure about a version-specific API or idiom, web_search then web_fetch the official docs before writing — never guess an API.',
      'أساليب الأطر: عند الشك في واجهة أو أسلوب خاص بإصدار، ابحث ثم اقرأ الوثائق الرسمية قبل الكتابة — لا تخمّن واجهة برمجية.',
      lang,
    ),
    bi(
      '- Keep code, identifiers and commands in standard English unless the user asks otherwise; this prompt layer steers defaults only and never blocks a request.',
      'اترك الكود والمعرّفات والأوامر بالإنجليزية القياسية إلا إن طلب المستخدم غيرها؛ هذا التوجيه يضبط الافتراضات فقط ولا يمنع أي طلب.',
      lang,
    ),
  ].join('\n');
}

/**
 * 3. Run & Show directive (signature feature). Text transcript only.
 */
export function runAndShowSection(language?: FlowLang): string {
  const lang = langOf(language);
  return [
    '# Run & Show (signature)',
    bi(
      '- When you change runnable code, actually RUN the project\u2019s detected dev/test command and report the REAL result as a short terminal-style transcript: "$ <command>", the exit code, and one or two meaningful output lines.',
      'عند تغيير كود قابل للتشغيل، شغّل فعلاً أمر التطوير/الاختبار المكتشف وأبلغ عن النتيجة الحقيقية كسطر أوامر قصير: «$ <command>» ورمز الخروج وسطر أو سطرين مفيدين من المخرجات.',
      lang,
    ),
    bi(
      '- If no runner is detected or the tool is unavailable, say so honestly. NEVER fabricate a screenshot, a test count, or a green result — a text transcript is the deliverable, not a fake image.',
      'إن لم يُكتشف مشغّل أو كانت الأداة غير متاحة، قل ذلك بصراحة. لا تختلق لقطة شاشة أو عدد اختبارات أو نتيجة نجاح — المخرج هو نص الأوامر لا صورة مزيّفة.',
      lang,
    ),
    bi(
      '- The harness also runs a real command and reports it in the run receipt; treat that evidence as the source of truth over prose.',
      'المنظومة تشغّل أمرًا حقيقيًا أيضًا وتذكره في إيصال التشغيل؛ اعتبر هذا الدليل هو المرجع قبل النص.',
      lang,
    ),
  ].join('\n');
}

/**
 * 4. Self-critique checkpoint directive. A thinking step, no extra
 * user-visible round-trip and no new tool call.
 */
export function selfCritiqueSection(language?: FlowLang): string {
  const lang = langOf(language);
  return [
    '# Self-critique before the final answer',
    bi(
      '- Before your final reply, do ONE no-tools checkpoint: did I actually complete every part of the request? Which claims are backed by a real tool result, and which are assumptions?',
      'قبل ردّك النهائي، قم بفحص واحد بلا أدوات: هل أنجزتُ كل أجزاء الطلب فعلاً؟ أي الادعاءات مدعومة بنتيجة أداة حقيقية وأيها افتراضات؟',
      lang,
    ),
    bi(
      '- Drop or soften unsupported claims, state what remains unverified in one short line, and never claim success you did not observe. This is a thinking step — do not add an extra user-visible round-trip.',
      'احذف أو خفّف الادعاءات غير المدعومة، واذكر ما بقي غير مُتحقَّق في سطر قصير، ولا تدّعِ نجاحًا لم تشاهده. هذه خطوة تفكير — لا تُضف جولة مستخدم إضافية.',
      lang,
    ),
  ].join('\n');
}

/** All Vibe Flow prompt sections joined; word-stable for the prompt cache. */
export function buildVibeFlowSections(language?: FlowLang): string {
  return [
    vibeCoderSection(language),
    polyglotSection(language),
    runAndShowSection(language),
    selfCritiqueSection(language),
  ].join('\n\n');
}

// ============================================================
// Deterministic post-run helpers (used by engine.ts)
// ============================================================

export interface SelfCritiqueInput {
  finalText: string;
  language?: FlowLang;
  writesThisRun: boolean;
  commandsRun: number;
  verificationRan: boolean;
  verificationPassed: boolean | null;
  unverifiedClaims?: string[];
  claimsTotal?: number;
}

export interface SelfCritiqueResult {
  completed: boolean;
  claimsTotal: number;
  unverified: string[];
  verifiedEvidence: string[];
  notes: string[];
  /** Compact bilingual footer suitable for the final-answer path. */
  footer: string;
}

const CLAIMS_DONE_RE = /\b(?:done|complete|finished|all tests? (?:pass|green))\b|تم|اكتمل|أنهيت|كل الاختبارات/i;

/**
 * Lightweight no-tools checkpoint. Reviews whether the task was actually
 * completed and which claims lack evidence. Fully deterministic: same input
 * → same output, no clock, no randomness, no IO.
 */
export function selfCritique(input: SelfCritiqueInput): SelfCritiqueResult {
  const lang = langOf(input.language);
  const unverified = Array.isArray(input.unverifiedClaims) ? input.unverifiedClaims.filter(Boolean).slice(0, 8) : [];
  const claimsTotal = Number.isFinite(input.claimsTotal) ? Math.max(0, input.claimsTotal as number) : unverified.length;
  const didWork = input.writesThisRun || input.commandsRun > 0;
  const claimsDone = CLAIMS_DONE_RE.test(String(input.finalText ?? ''));

  // v11.18 (NOTICE POLICY): a SIMPLE chat turn — no edits, no commands, no
  // verification and no audit claims — is not real work. Return an empty
  // footer so the engine's `[self-critique]` notice carries no advisory
  // text. A hollow completion claim ("تم إنهاء المهمة" / "done") is the
  // exception: it is NOT a simple turn, and is exactly the dishonesty this
  // checkpoint exists to catch, so it keeps the full bilingual footer.
  const quietTurn =
    !input.writesThisRun &&
    input.commandsRun === 0 &&
    claimsTotal === 0 &&
    !input.verificationRan &&
    !claimsDone;

  const verifiedEvidence: string[] = [];
  if (input.commandsRun > 0) verifiedEvidence.push(`${input.commandsRun} command(s) executed`);
  if (input.verificationRan) {
    verifiedEvidence.push(
      input.verificationPassed === true
        ? 'verification passed'
        : input.verificationPassed === false
          ? 'verification FAILED'
          : 'verification ran (status unknown)',
    );
  }

  const notes: string[] = [];
  if (input.writesThisRun && !input.verificationRan)
    notes.push('code changed but no verification run was recorded');
  if (unverified.length) notes.push(`${unverified.length} claim(s) without tool evidence`);
  if (!didWork && claimsDone) notes.push('completion claimed with no writes or commands');

  const completed = claimsDone && didWork && unverified.length === 0 && (!input.writesThisRun || input.verificationRan);

  const evEn = verifiedEvidence.length ? verifiedEvidence.join('; ') : 'no tool evidence recorded';
  const unEn = unverified.length ? unverified.join(' | ') : 'none';
  const statusEn = completed ? 'complete' : 'partial';
  const footerEn = `Verified: ${evEn} | Unverified: ${unEn} | Status: ${statusEn}`;

  if (lang === 'ar') {
    const evAr = verifiedEvidence.length
      ? verifiedEvidence
          .map((e) =>
            e === 'verification passed'
              ? 'نجح التحقّق'
              : e === 'verification FAILED'
                ? 'فشل التحقّق'
                : e === 'verification ran (status unknown)'
                  ? 'جري التحقّق (حالة غير معروفة)'
                  : `${input.commandsRun} أمر(أوامر) نُفِّذت`,
          )
          .join('؛ ')
      : 'لا يوجد دليل أداة مسجّل';
    const unAr = unverified.length ? unverified.join(' | ') : 'لا شيء';
    const statusAr = completed ? 'مكتمل' : 'جزئي';
    const footerAr = `المُتحقَّق: ${evAr} | غير مُتحقَّق: ${unAr} | الحالة: ${statusAr}`;
    return {
      completed,
      claimsTotal,
      unverified,
      verifiedEvidence,
      notes,
      footer: quietTurn ? '' : `${footerEn}\n${footerAr}`,
    };
  }
  return { completed, claimsTotal, unverified, verifiedEvidence, notes, footer: quietTurn ? '' : footerEn };
}

/** Pull unsupported claims out of the existing claim audit. */
export function unverifiedFromAudit(audit: ClaimAudit): string[] {
  return audit.claims.filter((c) => !c.supported).map((c) => c.claim);
}

export interface RunShowResult {
  /** Detected command, or null when the workspace has no runner. */
  command: string | null;
  exitCode?: number | null;
  outputTail?: string;
  durationMs?: number;
  aborted?: boolean;
  /** Honest reason when a runner exists but was not executed (e.g. permission mode). */
  skippedReason?: string;
  /**
   * v11.18 (NOTICE POLICY): when true, a result with no command renders '' so
   * the caller emits NO empty "Run & Show" card. Default (false) keeps the
   * honest no-runner line for backward compatibility.
   */
  quiet?: boolean;
}

/** Pick 1–2 meaningful output lines (tests/errors/status), deterministic. */
export function summarizeOutputTail(tail: string | undefined, maxLines = 2, maxChars = 160): string[] {
  const raw = String(tail ?? '');
  if (!raw.trim()) return [];
  const useful = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (!useful.length) return [];
  // No trailing \b: real runners say "passed", "tests", "failed", not just
  // "pass"/"test". Over-long lines are kept but capped below.
  const preferred = useful.filter((l) => /pass|fail|error|test|suite|\bok\b|green|✓|✗|✔/i.test(l));
  const picked = (preferred.length ? preferred : useful).slice(-maxLines);
  return picked.map((l) => (l.length > maxChars ? `${l.slice(0, maxChars - 1)}…` : l));
}

/**
 * Render a short, honest, screencast-style TERMINAL transcript (text only).
 * Never fabricates results; explicit honest branches for no-runner / no-exit.
 */
export function runAndShowSummary(result: RunShowResult, language?: FlowLang): string {
  const lang = langOf(language);
  const headEn = 'RUN & SHOW';
  const headAr = 'تشغيل وعرض';
  const title = lang === 'ar' ? `${headEn} / ${headAr}` : headEn;

  if (!result.command) {
    // v11.18: a policy-driven caller sets quiet=true to suppress the card
    // entirely (returns exactly ''), so no empty Run & Show notice is sent.
    if (result.quiet === true) return '';
    const en = `${title} — no runner detected; nothing was run (reported honestly).`;
    return lang === 'ar' ? `${en}\n${title} — لم يُكتشف مشغّل؛ لم يُشغَّل شيء (بصراحة).` : en;
  }
  if (result.skippedReason) {
    const en = `${title}\n$ ${result.command}\n■ ${result.skippedReason}`;
    return lang === 'ar' ? `${en}\n■ لم يُنفَّذ: ${result.skippedReason}` : en;
  }
  if (result.aborted) {
    const en = `${title}\n$ ${result.command}\n■ aborted by user — no result.`;
    return lang === 'ar' ? `${en}\n■ أُلغي من المستخدم — لا توجد نتيجة.` : en;
  }
  if (result.exitCode === null || result.exitCode === undefined) {
    const en = `${title}\n$ ${result.command}\n? runner did not report an exit code (reported honestly).`;
    return lang === 'ar' ? `${en}\n? لم يُبلِّغ المشغّل عن رمز خروج (بصراحة).` : en;
  }

  const ok = result.exitCode === 0;
  const secs =
    Number.isFinite(result.durationMs) && (result.durationMs as number) > 0
      ? ` · ${((result.durationMs as number) / 1000).toFixed(1)}s`
      : '';
  const statusEn = ok ? 'PASSED' : 'FAILED';
  const statusAr = ok ? 'ناجح' : 'فاشل';
  const mark = ok ? '✓' : '✗';
  const lines = [
    title,
    `$ ${result.command}`,
    `${mark} exit ${result.exitCode} — ${lang === 'ar' ? `${statusEn} / ${statusAr}` : statusEn}${secs}`,
    ...summarizeOutputTail(result.outputTail).map((l) => `  ${l}`),
  ];
  return lines.join('\n');
}

// ============================================================
// v11.18 (NOTICE POLICY) — emission gates for engine.ts
// ============================================================

export interface ClaimAuditEmissionInput {
  /** audit.claims.length — number of claims the audit extracted from prose. */
  claimsTotal: number;
  /** touchedFiles.size — number of files written this run. */
  writes: number;
  /** commandsRun.length — number of commands executed this run. */
  commands: number;
}

/**
 * Gate for the engine's `claim_audit` ioB.send (engine.ts, the
 * `if (audit.claims.length) {` line inside the 6b-5a claim-audit block).
 *
 * Returns true ONLY for real work: at least one file written OR one command
 * executed, AND at least one claim to audit. `auditClaims()` classifies every
 * sentence of finalText as a claim, so a simple chat turn can produce claims
 * (e.g. "Paris is the capital of France") with writes=0 and commands=0 — those
 * must NOT produce an audit / proof / critique notice.
 *
 * Pure and deterministic: no clock, no randomness, no IO.
 */
export function shouldEmitClaimAudit(input: ClaimAuditEmissionInput): boolean {
  const writes = Number.isFinite(input.writes) ? Math.max(0, input.writes) : 0;
  const commands = Number.isFinite(input.commands) ? Math.max(0, input.commands) : 0;
  const claims = Number.isFinite(input.claimsTotal) ? Math.max(0, input.claimsTotal) : 0;
  return (writes > 0 || commands > 0) && claims > 0;
}

// ============================================================
// v11.19 — deterministic planning / context-budget helpers
// ------------------------------------------------------------
// Advisory ONLY: these helpers never grant permissions, never call a model,
// never read the clock and never touch IO. Same input → same output.
// Single-language (English base; the renderer translates for Arabic UI).
//
// WIRING (documentation only — engine.ts / prompts.ts are NOT edited here):
//  1) contextBudget(): engine.ts compaction block — at the `compaction_done`
//     send (line ~2034) and the failed-compaction notice
//     `notice('compact', `[compaction failed: ...]`)` (line ~4372). Feed the
//     real token estimate + model window; emit the short plan on the notice
//     channel, e.g. notice('context_budget', `\n[context budget] ${plan.plan}\n`).
//  2) taskDecomposer(): engine.ts plan emission `ioB.send({ type: 'plan_ready',
//     ... })` (line ~3605 / ~3819) and the active-goal prompt (line ~1998).
//     Feed the raw user request; render steps[].doneWhen as the verifiable
//     plan. Both are pure, so a bad input can never break a turn.
// ============================================================

/** Collapse untrusted text to one clean capped line (deterministic). */
function oneLineAi(input: unknown, cap: number): string {
  return String(input ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, cap);
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function clamp01(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

// ---------------- 1. contextBudget() ----------------

export type ContextSegmentKind =
  | 'system'
  | 'tools'
  | 'rules'
  | 'skills'
  | 'mcp'
  | 'subagent'
  | 'summary'
  | 'conversation'
  | 'other';

/** A caller-supplied slice of the context window (no IO, caller owns the data). */
export interface ContextSegment {
  id: string;
  tokens: number;
  kind?: ContextSegmentKind;
  /** Never dropped (system prompt, current request, tool contracts). */
  pinned?: boolean;
  /** 0..1; higher means more worth keeping. Default 0.5. */
  importance?: number;
}

export interface ContextBudgetInput {
  /** Estimated tokens currently in the conversation. */
  estimatedTokens: number;
  /** Total context window of the active model, in tokens. */
  modelWindow: number;
  /** Tokens to hold back for the next reply + tool results. Default min(4096, window/4). */
  reservedTokens?: number;
  /** Optional inventory used for keep/drop decisions. */
  segments?: readonly ContextSegment[];
}

export type ContextPressure = 'unknown' | 'ok' | 'watch' | 'compact' | 'critical';
export type ContextAction = 'none' | 'compact' | 'drop-segments' | 'summarize';

export interface ContextBudgetResult {
  estimatedTokens: number;
  window: number;
  reservedTokens: number;
  usableTokens: number;
  /** estimated / usable, rounded to 2 decimals (0 when unknown). */
  usageRatio: number;
  headroomTokens: number;
  pressure: ContextPressure;
  action: ContextAction;
  /** Segment ids to keep, highest priority first (empty when no segments given). */
  keep: string[];
  /** Segment ids to drop/compact first, highest priority first. */
  drop: string[];
  /** Short English advisory plan for the model / notice channel. */
  plan: string;
  notes: string[];
}

/**
 * Decide what to compact when a conversation approaches the model window.
 * Pure and advisory: it reports what to keep/drop but performs no compaction.
 * Honest about bad input: an invalid estimate/window yields pressure 'unknown'
 * and an explicit plan that offers no fabricated advice.
 */
export function contextBudget(input: ContextBudgetInput): ContextBudgetResult {
  const notes: string[] = [];
  const estRaw = Number(input?.estimatedTokens);
  const winRaw = Number(input?.modelWindow);
  const est = Number.isFinite(estRaw) ? Math.max(0, estRaw) : NaN;
  const win = Number.isFinite(winRaw) ? Math.max(0, winRaw) : NaN;

  if (!Number.isFinite(est) || !Number.isFinite(win) || win <= 0) {
    notes.push('invalid token estimate or model window — no budget was computed');
    return {
      estimatedTokens: Number.isFinite(est) ? est : 0,
      window: Number.isFinite(win) ? Math.max(0, win) : 0,
      reservedTokens: 0,
      usableTokens: 0,
      usageRatio: 0,
      headroomTokens: 0,
      pressure: 'unknown',
      action: 'none',
      keep: [],
      drop: [],
      plan: 'Cannot compute a context budget: provide a positive estimatedTokens and modelWindow. No compaction advice offered.',
      notes,
    };
  }

  const reserved = clampNum(input?.reservedTokens, 0, Math.floor(win / 2), Math.min(4096, Math.floor(win / 4)));
  const usable = Math.max(1, win - reserved);
  const usageRatio = Math.round((est / usable) * 100) / 100;
  const headroomTokens = Math.max(0, usable - est);
  const pct = Math.round(usageRatio * 100);

  let pressure: ContextPressure;
  if (usageRatio <= 0.6) pressure = 'ok';
  else if (usageRatio <= 0.8) pressure = 'watch';
  else if (usageRatio <= 1) pressure = 'compact';
  else pressure = 'critical';

  const needCompaction = pressure === 'compact' || pressure === 'critical';
  const segments = Array.isArray(input?.segments) ? input.segments : [];

  // Rank segments: pinned first, then importance desc, then fewer tokens first,
  // then original index (a deterministic tie-break, never Math.random).
  const ranked = segments.map((s, i) => ({
    id: String(s?.id ?? `seg-${i}`),
    tokens: Number.isFinite(Number(s?.tokens)) ? Math.max(0, Number(s.tokens)) : 0,
    pinned: s?.pinned === true || s?.kind === 'system',
    importance: clamp01(s?.importance),
    index: i,
  })).sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.importance !== b.importance) return b.importance - a.importance;
    if (a.tokens !== b.tokens) return a.tokens - b.tokens;
    return a.index - b.index;
  });

  const keep: string[] = [];
  const drop: string[] = [];
  let action: ContextAction = 'none';

  if (needCompaction) {
    action = segments.length ? 'drop-segments' : pressure === 'critical' ? 'compact' : 'summarize';
    if (segments.length) {
      // Keep the essentials within a 70% target; everything else is dropped.
      const target = Math.floor(usable * 0.7);
      let used = 0;
      for (const s of ranked) {
        if (s.pinned || used + s.tokens <= target) {
          keep.push(s.id);
          used += s.tokens;
        } else {
          drop.push(s.id);
        }
      }
      if (drop.length) notes.push(`${drop.length} low-priority segment(s) marked for drop/compaction first`);
    }
  } else if (segments.length) {
    for (const s of ranked) keep.push(s.id);
  }

  let plan: string;
  const size = `${est}/${usable} tokens, ${headroomTokens} free`;
  if (pressure === 'ok') {
    plan = `Context at ${pct}% of the usable window (${size}). No compaction needed — keep the current plan and tool results.`;
  } else if (pressure === 'watch') {
    plan = `Context at ${pct}% (${size}). Avoid large file dumps; prefer targeted reads and summarize tool output as you go.`;
  } else if (pressure === 'compact') {
    plan = `Context at ${pct}% (${size}). Compact the oldest conversation and drop low-value tool output; keep system rules, the current request and recent decisions.`;
  } else {
    plan = `Context is ${pct}% of the usable window — over by ${est - usable} tokens. Compact NOW before the next call; keep only pinned essentials and a short summary.`;
  }
  if (drop.length) plan += ` Drop first: ${drop.join(', ')}.`;

  return {
    estimatedTokens: est,
    window: win,
    reservedTokens: reserved,
    usableTokens: usable,
    usageRatio,
    headroomTokens,
    pressure,
    action,
    keep,
    drop,
    plan,
    notes,
  };
}

// ---------------- 2. taskDecomposer() ----------------

export interface DecomposeInput {
  /** The raw (possibly large) user request. */
  request: string;
  /** Extra constraints that must hold for the whole plan (e.g. "do not edit engine.ts"). */
  constraints?: readonly string[];
  /** Max steps including the final verification step. Default 6, clamped 2..12. */
  maxSteps?: number;
}

export interface DecomposedStep {
  /** 1-based, stable order. */
  index: number;
  title: string;
  intent: string;
  /** Concrete, verifiable completion check for THIS step (English). */
  doneWhen: string;
  /** Suggested check (command or observation) using repo-detected commands where possible. */
  verify: string;
  /** 1-based indices of prior steps this step depends on. */
  dependsOn: number[];
}

export interface DecomposeResult {
  request: string;
  steps: DecomposedStep[];
  stepCount: number;
  /** Single completion check for the whole decomposed request. */
  totalDoneWhen: string;
  notes: string[];
  /** True when clauses or the request text were cut by caps. */
  truncated: boolean;
}

type StepKind = 'inspect' | 'implement' | 'fix' | 'test' | 'document' | 'refactor' | 'complete';

interface StepTemplate {
  re: RegExp;
  title: string;
  intentPrefix: string;
  doneWhen: string;
  verify: string;
}

const STEP_TEMPLATES: readonly StepTemplate[] = [
  { re: /\b(?:test|tests|verify|validate|check|assert|coverage)\b/i, title: 'Verify', intentPrefix: 'Add or run checks', doneWhen: 'All relevant tests and typecheck pass with real output', verify: 'node --test / tsc --noEmit (use the repo-detected commands)' },
  { re: /\b(?:fix|bug|broken|error|crash|regression|repair)\b/i, title: 'Fix', intentPrefix: 'Diagnose and fix', doneWhen: 'The failing case now passes and no regression was introduced', verify: 'targeted failing test, then the full suite' },
  { re: /\b(?:read|inspect|explore|find|search|locate|understand|review|investigate)\b/i, title: 'Inspect', intentPrefix: 'Locate and read context', doneWhen: 'The relevant files/symbols are identified and actually read', verify: 'repo_map / find_refs / read tool results in evidence' },
  { re: /\b(?:refactor|rename|restructure|clean up)\b/i, title: 'Refactor', intentPrefix: 'Restructure without changing behaviour', doneWhen: 'Behaviour is unchanged and the full suite still passes', verify: 'full test suite before and after' },
  { re: /\b(?:document|docs|readme|comment|explain)\b/i, title: 'Document', intentPrefix: 'Write documentation', doneWhen: 'The docs reflect the change and contain no fabricated results', verify: 'review the documentation diff' },
  { re: /\b(?:add|implement|create|write|build|introduce|support)\b/i, title: 'Implement', intentPrefix: 'Make the change', doneWhen: 'The change is applied and typecheck/build passes', verify: 'tsc --noEmit / project build' },
];

function templateFor(clause: string): StepTemplate {
  for (const t of STEP_TEMPLATES) if (t.re.test(clause)) return t;
  return { re: /$/, title: 'Complete', intentPrefix: 'Carry out', doneWhen: 'The stated outcome is achieved with a real artifact to show', verify: 'compare the result against the step intent' };
}

/**
 * Split a large request into an ordered, verifiable plan — deterministic and
 * model-free. Clause splitting + keyword templates produce stable steps; each
 * step carries its own "done when" check and the last step is always a sweep.
 * Honest about bad input: an empty request yields zero steps and a note.
 */
export function taskDecomposer(input: DecomposeInput): DecomposeResult {
  const notes: string[] = [];
  const rawInput = String(input?.request ?? '');
  const raw = oneLineAi(rawInput, 600);
  if (!raw) {
    return {
      request: '',
      steps: [],
      stepCount: 0,
      totalDoneWhen: 'Nothing to verify — no request was provided.',
      notes: ['empty request — no steps generated'],
      truncated: false,
    };
  }

  const maxSteps = clampNum(input?.maxSteps, 2, 12, 6);
  const constraints = (Array.isArray(input?.constraints) ? input.constraints : [])
    .map((c) => oneLineAi(c, 120))
    .filter(Boolean)
    .slice(0, 6);

  // Clause split: newlines, bullets/numbering, semicolons and "then"/"and".
  const parts = raw
    .split(/(?:\r?\n)|(?:;)|(?:\s+then\s+)|(?:\s+and\s+)/i)
    .map((s) => s.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
    .filter((s) => s.length > 1);

  const clauses = parts.length ? parts : [raw];
  const taskLimit = maxSteps - 1; // reserve the final step for verification
  const used = clauses.slice(0, taskLimit);
  const truncated = clauses.length > used.length || oneLineAi(rawInput, Number.MAX_SAFE_INTEGER).length > 600;
  if (clauses.length > used.length) notes.push(`${clauses.length - used.length} clause(s) folded into the final verification step`);
  if (oneLineAi(rawInput, Number.MAX_SAFE_INTEGER).length > 600) notes.push('request text truncated at 600 characters');

  const steps: DecomposedStep[] = used.map((clause, i) => {
    const t = templateFor(clause);
    return {
      index: i + 1,
      title: t.title,
      intent: `${t.intentPrefix}: ${clause}`,
      doneWhen: t.doneWhen,
      verify: t.verify,
      dependsOn: i === 0 ? [] : [i],
    };
  });

  steps.push({
    index: steps.length + 1,
    title: 'Verify',
    intent: 'Run the full verification sweep across all changed files',
    doneWhen: 'Every step above has tool evidence and all tests/typecheck pass',
    verify: 'tsc --noEmit + the project test suite (use the repo-detected commands)',
    dependsOn: steps.length ? [steps.length] : [],
  });

  const constraintSuffix = constraints.length ? ` and respect: ${constraints.join('; ')}` : '';
  const totalDoneWhen = `All ${steps.length} step checks pass in order, with no unverified claims${constraintSuffix}.`;
  if (constraints.length) notes.push(`${constraints.length} constraint(s) carried into the completion check`);

  return { request: raw, steps, stepCount: steps.length, totalDoneWhen, notes, truncated };
}
