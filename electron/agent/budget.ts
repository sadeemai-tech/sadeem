// ============================================================
// Surnia v7.1 — VERIFICATION BUDGET: gates that 429s cannot eat.
// The verifier/critic/fake-test/mutation gates each cost calls and
// money. The v7.0 posture charged every attempt — so a provider
// rate-limit storm (429) could silently consume the whole budget
// and leave the run unverified. That is exactly backwards: the
// budget buys VERIFICATION WORK, not provider congestion.
//
//   • A gate attempt that dies on a RETRYABLE provider error
//     (429 / 5xx / 529 / network reset) is REFUNDED — it costs zero
//     calls and zero dollars, and the next attempt runs fresh.
//   • Only a verdict (or a fatal 4xx, which is a real answer: "your
//     request was wrong") consumes budget.
//   • When the budget is exhausted the engine learns `exhausted`
//     and applies the configured fail posture (fail-open normally,
//     fail-closed for high-stakes tasks) — never a silent skip.
//
// Also ships the task cost ceiling: a strict per-run spend cap the
// engine checks after every turn.
// ============================================================

export type GateKind = 'verifier' | 'critic' | 'mutation' | 'fake-tests' | 'claim-audit';

export type GateErrorClass = 'retryable' | 'fatal' | 'ok';

/**
 * v11.15 (LONG RUN) — verification-budget ceilings.
 *
 * The v7.1 defaults (8 verdicts / $0.50 / 10 min) were sized for a single
 * short task. A hours-long run that verifies after every edit burst hits them
 * in minutes and then runs UNVERIFIED — exactly backwards for endurance.
 * Both tiers stay bounded (no runaway spend), but the baseline now gives a
 * real long task room, and `longRun: true` gives a genuinely hours-long task
 * a much larger envelope. Explicit per-run config ALWAYS wins (see ctor).
 */
export const VERIFICATION_BUDGET_DEFAULTS = Object.freeze({
  /** Baseline (every run): was 8 verdicts / $0.50 / 10 min. */
  maxGateCalls: 24,
  maxGateUsd: 1.5,
  maxGateMs: 30 * 60_000,
});
export const LONG_RUN_VERIFICATION_DEFAULTS = Object.freeze({
  /** Explicit long-run mode: generous but still a hard ceiling. */
  maxGateCalls: 96,
  maxGateUsd: 5,
  maxGateMs: 120 * 60_000,
});

export interface BudgetConfig {
  /** Max successful verifier/critic verdicts per run (baseline default 24). */
  maxGateCalls?: number;
  /** Max spend on verification per run, USD (baseline default 1.50). */
  maxGateUsd?: number;
  /** Max wall time on verification per run, ms (baseline default 30 min). */
  maxGateMs?: number;
  /** v11.15 — apply the long-run envelope (generous ceilings). Explicit fields win. */
  longRun?: boolean;
}

export interface BudgetState {
  gateCalls: number;
  gateUsd: number;
  gateMs: number;
  refunds: number;
  exhausted: boolean;
}

/**
 * v11.31 — a bare "429"/"5xx" is ALSO ordinary TEST OUTPUT and run_command
 * diagnostics ("expected 429 but got 200", "assert HTTP 500"). The v11.21 fix
 * only guarded the 429 case; a message like `Error: HTTP 500` still refunded a
 * REAL failure as congestion and the engine silently failed open. We now require
 * an explicit CONGESTION context for ANY bare status code found in a message.
 * An authoritative numeric `status` field (see classifyGateError) always wins.
 */
const CONGESTION_CONTEXT_RE =
  /rate[- ]?limit|too many requests|overload|quota|congest|gateway|unavailable|timeout|timed out|busy|temporar(?:ary|y)?|internal server error|service unavailable|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang ?up|network\s+(?:error|timeout)|fetch failed|aborted[^\n]*timeout/i;

/** Network/provider phrases that are retryable even without a numeric code. */
const RETRYABLE_PATTERNS: RegExp[] = [
  /rate[- ]?limit/i,
  /too many requests/i,
  /overloaded/i,
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE/i,
  /socket hang ?up/i,
  /network\s+(?:error|timeout)/i,
  /fetch failed/i,
  /aborted.*timeout/i,
];

/**
 * Classify a gate attempt error. Retryable = provider congestion or
 * transient network — the budget is refunded. Fatal (4xx-class, parse
 * errors of the request itself) = a spent attempt.
 */
export function classifyGateError(err: unknown): GateErrorClass {
  if (!err) return 'fatal';
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number }).status;
  if (typeof status === 'number' && Number.isFinite(status)) {
    // STATUS IS AUTHORITATIVE. A 4xx is a real answer ("your request was
    // wrong") even if the message happens to contain the word "timeout";
    // a 5xx is retryable. The old code only listed 500/502/503/529, so a
    // routine 504 Gateway Timeout (or Cloudflare 520-524) was CHARGED as a
    // fatal verdict and ate the verification budget during congestion.
    if (status === 429 || status === 408 || (status >= 500 && status < 600)) return 'retryable';
    if (status >= 400 && status < 500) return 'fatal';
  }
  // Message-only classification. A code on its own is TEST OUTPUT, not a
  // provider death — only congestion context makes it retryable.
  if (/\b(?:429|5\d{2})\b/.test(msg) && CONGESTION_CONTEXT_RE.test(msg)) return 'retryable';
  for (const re of RETRYABLE_PATTERNS) {
    try {
      if (re.test(msg)) return 'retryable';
    } catch {
      /* a broken pattern must not misclassify */
    }
  }
  return 'fatal';
}

export interface BudgetSpend {
  usd: number;
  ms: number;
}

/**
 * The per-run verification budget. One instance per runAgent invocation.
 * Every gate attempt goes through `attempt()`; refunds are automatic for
 * retryable failures, charges happen only for real verdicts / fatal errors.
 */
export class VerificationBudget {
  private readonly cfg: Required<Omit<BudgetConfig, 'longRun'>>;
  private state: BudgetState = { gateCalls: 0, gateUsd: 0, gateMs: 0, refunds: 0, exhausted: false };
  /** v11.21 — the spend of the most recent charged attempt, so refund() can give it back. */
  private lastChargeUsd = 0;
  /** v11.31 — one charge can be refunded ONCE. A second refund() must not
   *  hand back another verdict slot that was never paid for. */
  private lastChargeValid = false;
  private readonly startedAt = Date.now();

  constructor(cfg?: BudgetConfig) {
    const defs = cfg?.longRun ? LONG_RUN_VERIFICATION_DEFAULTS : VERIFICATION_BUDGET_DEFAULTS;
    this.cfg = {
      maxGateCalls: Math.max(1, Math.floor(cfg?.maxGateCalls ?? defs.maxGateCalls)),
      maxGateUsd: Math.max(0.01, cfg?.maxGateUsd ?? defs.maxGateUsd),
      maxGateMs: Math.max(5_000, cfg?.maxGateMs ?? defs.maxGateMs),
    };
  }

  /** v11.15 — resolved ceilings (tests / status UI). */
  get limits(): Readonly<Required<Omit<BudgetConfig, 'longRun'>>> {
    return { ...this.cfg };
  }

  get current(): BudgetState {
    const wall = Date.now() - this.startedAt;
    return {
      ...this.state,
      gateMs: Math.max(this.state.gateMs, wall),
      exhausted: this.state.gateCalls >= this.cfg.maxGateCalls || this.state.gateUsd >= this.cfg.maxGateUsd,
    };
  }

  /** Human summary for the receipt / status chip. */
  label(): string {
    const s = this.current;
    return `verification budget: ${s.gateCalls}/${this.cfg.maxGateCalls} verdicts · $${s.gateUsd.toFixed(3)}/${this.cfg.maxGateUsd.toFixed(2)} · ${s.refunds} refunded (429/5xx never charged)`;
  }

  /**
   * Run one gate attempt under budget accounting.
   * `fn` returns `{ value, usd? }` on success. Throws on error — the class
   * decides: retryable → refund (the attempt never happened, budget-wise),
   * fatal → charged as a spent call.
   * Returns null when the budget is exhausted BEFORE the attempt (caller
   * applies its fail posture).
   */
  async attempt<T>(kind: GateKind, fn: () => Promise<{ value: T; usd?: number }>): Promise<{ value: T; charged: boolean } | null> {
    const before = this.current;
    if (before.exhausted) {
      this.state.exhausted = true;
      return null; // caller decides fail-open / fail-closed
    }
    try {
      const { value, usd } = await fn();
      // v11.21 — Math.max(0, NaN) is NaN; a NaN/Infinity cost from a provider
      // poisoned gateUsd forever, so `gateUsd >= maxGateUsd` never tripped and
      // the run could spend without a ceiling. Non-finite cost = 0.
      const cost = typeof usd === 'number' && Number.isFinite(usd) ? Math.max(0, usd) : 0;
      this.state.gateCalls += 1;
      this.state.gateUsd += cost;
      this.lastChargeUsd = cost;
      this.lastChargeValid = true;
      return { value, charged: true };
    } catch (err) {
      const cls = classifyGateError(err);
      if (cls === 'retryable') {
        this.state.refunds += 1; // 429/5xx/network: the budget is NOT consumed
        throw err; // caller retries / fails per posture
      }
      this.state.gateCalls += 1; // fatal: a real (wasted) verdict slot
      this.lastChargeUsd = 0; // no USD was spent on a fatal error
      this.lastChargeValid = true; // the slot can still be voided/refunded once
      throw err;
    }
  }

  /**
   * Refund a previously charged call (e.g. a verdict that turned out void).
   * v11.21 — the OLD code returned only the verdict slot, never the money.
   * A voided verdict kept its USD charge, so a run could be declared
   * exhausted by dollars that had already been refunded. An explicit `usd`
   * overrides the tracked last charge when the caller knows the amount.
   */
  refund(reason = 'void verdict', usd?: number): void {
    if (!this.lastChargeValid) return; // already refunded (or nothing was charged)
    this.lastChargeValid = false;
    if (this.state.gateCalls > 0) this.state.gateCalls -= 1;
    const amt = typeof usd === 'number' && Number.isFinite(usd) && usd > 0 ? usd : this.lastChargeUsd;
    if (amt > 0) this.state.gateUsd = Math.max(0, this.state.gateUsd - amt);
    this.lastChargeUsd = 0;
    void reason;
  }
}

// ------------------------------------------------------------
// Task cost ceiling (strict, whole-run)
// ------------------------------------------------------------

export interface TaskBudgetCheck {
  exceeded: boolean;
  spentUsd: number;
  limitUsd: number;
  reason: string;
}

/** Check the run's total spend against the strict task budget. */
export function taskBudgetCheck(spentUsd: number, limitUsd: number | undefined | null): TaskBudgetCheck {
  // v11.31 — a NaN/Infinity spend from a provider must not be reported as a
  // real dollar figure or silently compare as "under budget". Coerce to 0 and
  // say so; the honest fall-through is "no usable spend figure", never a number.
  const spent = typeof spentUsd === 'number' && Number.isFinite(spentUsd) ? Math.max(0, spentUsd) : 0;
  if (limitUsd === undefined || limitUsd === null || !Number.isFinite(limitUsd) || limitUsd <= 0) {
    return { exceeded: false, spentUsd: spent, limitUsd: 0, reason: '' };
  }
  const exceeded = spent >= limitUsd;
  return {
    exceeded,
    spentUsd: spent,
    limitUsd,
    reason: exceeded
      ? `task budget exhausted: $${spent.toFixed(3)} spent, limit $${limitUsd.toFixed(2)}. Finish with what you have or stop cleanly.`
      : '',
  };
}

/**
 * Cost-per-proven-change accounting: only runs whose proof verdict is
 * 'proven' enter the ledger, keyed by provider/model. This is the honest
 * version of "model cost" — money that produced a PROVEN change.
 */
export interface ProvenCostEntry {
  at: number;
  provider: string;
  model: string;
  costUsd: number;
  durationMs: number;
}

export function costPerProvenChange(entries: ProvenCostEntry[]): Array<{ key: string; provenChanges: number; totalUsd: number; perProvenUsd: number }> {
  const byKey = new Map<string, ProvenCostEntry[]>();
  for (const e of entries) {
    const key = `${e.provider}/${e.model}`;
    const list = byKey.get(key) ?? [];
    list.push(e);
    byKey.set(key, list);
  }
  return [...byKey.entries()]
    .map(([key, list]) => {
      // v11.31 — one non-finite provider cost must not poison the whole ledger.
      const totalUsd = list.reduce((s, e) => s + (Number.isFinite(e.costUsd) ? Math.max(0, e.costUsd) : 0), 0);
      return { key, provenChanges: list.length, totalUsd, perProvenUsd: list.length ? totalUsd / list.length : 0 };
    })
    .sort((a, b) => a.perProvenUsd - b.perProvenUsd);
}
