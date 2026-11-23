// ============================================================
// Surnia v7.1 — RUN GATES: one bundle per agent run that tools.ts and
// the engine share. This is the connective tissue of the Proven
// Change pipeline:
//
//   • TestRecord — every test-looking command the agent runs is
//     classified (before/red/green/after) and parsed for per-test
//     results. Red→green compliance is judged FROM THIS LEDGER, not
//     from the model's prose.
//   • VerificationBudget — verifier/critic/fake-test/mutation verdicts
//     are charged only when they actually happen; 429/5xx/network
//     deaths are refunded (the budget cannot be eaten by congestion).
//   • TaintLedger — web/MCP/repo/issue/skill content marks the run;
//     run_command consults it for escalation even in fullAccess.
//   • beforeHashes — sha256 of every file at FIRST touch, so the proof
//     package can prove before→after fingerprints (not just claim them).
//   • lineSpans — per-file changed line ranges (write/edit tools report
//     them), so the mutation gate mutates ONLY what changed.
//
// A module-level registry keyed by sessionId lets tool handlers find
// their run's bundle without threading a new field through ToolContext.
// ============================================================
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { TestRecord } from './testRecord';
import { VerificationBudget, BudgetConfig } from './budget';
import { TaintLedger, TaintSourceKind } from './taint';
import { ContinuityLedger, ContinuitySnapshot } from './longRun';

export interface LineSpan {
  start: number; // 1-based inclusive
  end: number;
}

export class RunGates {
  readonly sessionId: string;
  readonly testRecord = new TestRecord();
  readonly budget: VerificationBudget;
  readonly taint = new TaintLedger();
  readonly beforeHashes = new Map<string, string>();
  /** v11.15 — rolling summary that survives every compaction boundary. */
  readonly continuity = new ContinuityLedger();
  private spans = new Map<string, LineSpan[]>(); // abs file → changed ranges
  private firstTestCommand: string | null = null;

  constructor(sessionId: string, budgetCfg?: BudgetConfig) {
    this.sessionId = sessionId;
    this.budget = new VerificationBudget(budgetCfg);
  }

  // ---- fingerprints ----

  /**
   * Record the BEFORE hash of a file at first touch. When the caller already
   * holds the file content (write/edit tools do), pass it — that removes the
   * read-after-write race. Later touches keep the FIRST hash.
   */
  async recordTouch(absPath: string, content?: string): Promise<void> {
    const key = path.resolve(absPath);
    this.continuity.addFile(key); // v11.15 — every first touch is continuity data
    if (this.beforeHashes.has(key)) return;
    if (typeof content === 'string') {
      this.beforeHashes.set(key, crypto.createHash('sha256').update(content).digest('hex'));
      return;
    }
    try {
      const buf = await fs.readFile(key);
      this.beforeHashes.set(key, crypto.createHash('sha256').update(buf).digest('hex'));
    } catch {
      this.beforeHashes.set(key, '');
    }
  }

  /**
   * v11.31 — undo a fingerprint that was recorded BEFORE a tool ran. A write
   * that was DENIED or FAILED never changed the file, so it must not appear in
   * `proof_package.touchedFiles` (which is derived from `beforeHashes.keys()`).
   * Idempotent: deleting an absent key is a no-op, and repeated calls are safe.
   * The caller (engine.ts) invokes this in the `!outcome.ok` branch.
   */
  dropTouch(absPath: string): void {
    this.beforeHashes.delete(path.resolve(absPath));
  }

  /** Write/edit tools report the line range they changed (1-based inclusive). */
  reportSpan(absPath: string, start: number, end: number): void {
    const key = path.resolve(absPath);
    this.continuity.addFile(key); // v11.15 — an edited file is continuity data
    const list = this.spans.get(key) ?? [];
    const merged: LineSpan[] = [];
    let placed = false;
    for (const s of list) {
      if (start <= s.end + 1 && end >= s.start - 1) {
        s.start = Math.min(s.start, start);
        s.end = Math.max(s.end, end);
        placed = true;
      }
      merged.push(s);
    }
    if (!placed) merged.push({ start, end });
    this.spans.set(key, merged);
  }

  lineSpans(): Record<string, Array<[number, number]>> {
    const out: Record<string, Array<[number, number]>> = {};
    for (const [k, list] of this.spans) out[k] = list.map((s) => [s.start, s.end] as [number, number]);
    return out;
  }

  // ---- test-run ledger ----

  /**
   * v11.31 — match a runner at the START of a command (or just after a chain
   * separator / `cd … &&`). The old `\b` matched the words inside prose like
   * `grep "npm test" README.md`, recording a bogus green test run that could
   * make red→green compliance pass without a single test executing.
   */
  private static readonly TEST_CMD_RE =
    /(?:^|&&|;|\|)\s*(?:cd\s+\S+\s*&&\s*)?(?:npm\s+(?:test|run\s+test)|npx\s+(?:jest|vitest)|yarn\s+test|pnpm\s+test|vitest|jest|pytest|python3?\s+-m\s+(?:pytest|unittest)|cargo\s+test|go\s+test|mvn\s+test|gradle\s+test|node\s+--test|mocha)\b/i;

  static isTestCommand(cmd: string): boolean {
    return RunGates.TEST_CMD_RE.test(String(cmd ?? ''));
  }

  /**
   * v11.21 — a command that targets specific test FILES rather than the whole
   * suite. The engine uses defaultTestCommand() for red→green checks and
   * run-and-show; a narrow one-off the model ran early must not become the
   * canonical verification command for the entire run ("picking a wrong
   * command"). A suite command stays preferred once one is seen.
   */
  private static isNarrowTestCommand(cmd: string): boolean {
    const s = String(cmd ?? '');
    return /\.(?:test|spec)\.[cm]?[jt]sx?\b|(?:^|[\s/])__tests__[/\\]|(?:^|[\s/])test_[\w.-]+\.py\b|_test\.py\b|\btests?[/\\][\w./\\-]+\.(?:py|js|ts)\b/i.test(s);
  }

  /**
   * Every command outcome flows through here (called by the run_command
   * handler). Test-looking commands are parsed into the ledger with the
   * right phase: the FIRST green run of a command is 'before' until a red
   * run precedes it, in which case runs self-organize as red → green.
   */
  recordCommand(cmd: string, exitCode: number, output: string, durationMs: number): void {
    if (!RunGates.isTestCommand(cmd)) return;
    this.continuity.addTestCommand(cmd); // v11.15 — verification history survives compaction
    // v11.21 — prefer a full-suite command over a narrow one-off. Replacing a
    // narrow first run with a later suite command fixes the wrong command
    // being propagated to red→green / run-and-show; a suite command already
    // recorded is never demoted by a later targeted run.
    if (!this.firstTestCommand) this.firstTestCommand = cmd;
    else if (RunGates.isNarrowTestCommand(this.firstTestCommand) && !RunGates.isNarrowTestCommand(cmd)) {
      this.firstTestCommand = cmd;
    }
    // phase: keep the phase stable per normalized command — first run 'before';
    // a failing run after a passing one is 'red' (regression evidence), a
    // passing run after a red one is 'green'.
    const prior = this.testRecord.all().filter((r) => r.command === cmd);
    let phase: 'before' | 'after' | 'red' | 'green' = 'before';
    const hadPass = prior.some((r) => r.exitCode === 0);
    const hadFail = prior.some((r) => r.exitCode !== 0);
    if (exitCode === 0 && hadFail) phase = 'green';
    else if (exitCode !== 0 && hadPass) phase = 'red';
    else if (hadPass) phase = 'after';
    // v11.31 — a failure with NO prior pass is a persistent red, not an
    // "after" (post-change) result. Labelling it 'after' let a never-green
    // command feed the regression diff as if a fix had been applied.
    else if (exitCode !== 0) phase = 'red';
    else phase = prior.length ? 'after' : 'before';
    this.testRecord.record({ phase, command: cmd, exitCode, output, durationMs });
  }

  /** Explicit test run (test_run tool / engine verification) with a known phase. */
  recordTestRun(phase: 'before' | 'after' | 'red' | 'green' | 'verify', cmd: string, exitCode: number, output: string, durationMs: number): void {
    this.continuity.addTestCommand(cmd); // v11.15
    this.testRecord.record({ phase, command: cmd, exitCode, output, durationMs });
  }

  // ---- v11.15 — compaction continuity surface ----

  /** Record a design/implementation decision so it survives compaction. */
  recordDecision(text: string): void {
    this.continuity.addDecision(text);
  }

  /** Record work still outstanding so the next round resumes, not restarts. */
  recordPendingStep(text: string): void {
    this.continuity.addPendingStep(text);
  }

  /**
   * Snapshot for the engine to inject into the post-compaction system note.
   * Pass the recovered original task (from compaction.originalTaskText) the
   * first time; later boundaries fold the previous snapshot via `restore`.
   */
  continuitySnapshot(originalTask?: string): ContinuitySnapshot {
    if (originalTask) this.continuity.setOriginalTask(originalTask);
    return this.continuity.snapshot();
  }

  /** Fold a previous boundary's snapshot into the live ledger. */
  restoreContinuity(previous: ContinuitySnapshot | null | undefined): ContinuitySnapshot {
    return this.continuity.restore(previous);
  }

  defaultTestCommand(): string | null {
    return this.firstTestCommand;
  }

  // ---- taint ----

  markTaint(kind: TaintSourceKind, origin: string, note: string, flags: string[] = []): void {
    this.taint.mark(kind, origin, note, flags);
  }

  taintActive(): boolean {
    return this.taint.hasActive();
  }

  taintDescribe(): string {
    return this.taint.describe();
  }
}

// ------------------------------------------------------------
// Registry (sessionId → gates). Engine creates at run start, clears at end.
// ------------------------------------------------------------

const registry = new Map<string, RunGates>();

export function createRunGates(sessionId: string, budgetCfg?: BudgetConfig): RunGates {
  const g = new RunGates(sessionId, budgetCfg);
  registry.set(sessionId, g);
  return g;
}

export function getRunGates(sessionId: string | undefined): RunGates | null {
  if (!sessionId) return null;
  return registry.get(sessionId) ?? null;
}

export function clearRunGates(sessionId: string): void {
  registry.delete(sessionId);
}

/** Registry size (diagnostics/tests). */
export function runGatesCount(): number {
  return registry.size;
}

// ------------------------------------------------------------
// v11.15 — PERMISSION MODE RESOLUTION / FULL-APPROVAL HONORING
// ------------------------------------------------------------
// THE BUG (reported to the engine.ts owner with exact lines):
//   engine.ts:2198-2199
//     const autoAllowed =
//       req.force !== true && (currentMode() === 'fullAccess' || (currentMode() === 'autoEdit' && kind === 'write'));
//   `req.force === true` silently DOWNGRADES an explicit fullAccess to a
//   permission prompt. Producers of `force`:
//     tools.ts:1700 (write to a file not read this session),
//     tools.ts:1995 + 2054 (danger-classified command),
//     tools.ts:2038/2005 (taint + network-allowlist escalation),
//     tools.ts:859,1166 (browser_eval), lsp.ts:251 (global install).
//   A user who selected "Full access" therefore still sees approval cards.
//
// FIX (one line in engine.ts, helper lives HERE so it is independently
// testable): replace the 2198-2199 expression with
//     const autoAllowed = shouldAutoApprove(currentMode(), kind, req);
// `shouldAutoApprove` makes fullAccess a WHOLE-RUN contract: no `force`
// flag can reintroduce a prompt. Read-only modes still win (never escaped).
// ------------------------------------------------------------

export type PermissionModeLike = 'default' | 'autoEdit' | 'fullAccess' | 'plan' | 'read' | (string & {});

export interface ModeResolutionInput {
  /** mode passed by the renderer (store.ts:2981 → settings.permissionMode). */
  paramsMode?: PermissionModeLike;
  /** persisted settings.permissionMode (authoritative user choice). */
  settingsMode?: PermissionModeLike;
  /** one-shot session override written by plan approval (engine.ts:1358). */
  sessionOverride?: PermissionModeLike;
}

/**
 * Resolve the live mode for a run. An EXPLICIT fullAccess is a whole-run
 * contract and is not downgraded by a stale one-shot plan-approval override
 * ('default'/'autoEdit'); a 'plan' override still wins (read-only is safety).
 * This must be called BEFORE the override is consumed/deleted so the mode is
 * honored from the first turn through every compaction.
 */
export function resolvePermissionMode(input: ModeResolutionInput): PermissionModeLike {
  // SAFETY: an explicit PLAN mode (from the UI, the persisted settings OR a
  // one-shot override) is a read-only contract and must NEVER be upgraded —
  // even when fullAccess is persisted or a stale params value says autoEdit.
  // v11.31: the old code only checked paramsMode/sessionOverride, so a
  // persisted `plan` setting could be silently upgraded by a renderer param.
  if (input.paramsMode === 'plan' || input.settingsMode === 'plan' || input.sessionOverride === 'plan') return 'plan';
  const explicitFull = input.paramsMode === 'fullAccess' || input.settingsMode === 'fullAccess';
  if (explicitFull && input.sessionOverride !== 'plan') return 'fullAccess';
  return input.sessionOverride ?? input.paramsMode ?? input.settingsMode ?? 'default';
}

export interface ApprovalRequestLike {
  kind?: string;
  /** Risk/taint escalation flag from tools.ts — CANNOT downgrade fullAccess. */
  force?: boolean;
  /** Explicit "full approval" alias used by remote/headless surfaces. */
  fullApproval?: boolean;
}

/**
 * The single decision function for MODE-based auto approval.
 *  - plan/read: always ask (read-only contract wins, never bypassed).
 *  - fullAccess / fullApproval: ALWAYS auto-approve, for every tool kind and
 *    regardless of `force`. This is what the founder demanded be honored.
 *  - autoEdit: auto-approve writes only, and only without a force escalation.
 */
export function shouldAutoApprove(
  mode: PermissionModeLike,
  kind: string,
  req: ApprovalRequestLike = {},
): boolean {
  if (mode === 'plan' || mode === 'read') return false;
  if (mode === 'fullAccess' || req.fullApproval === true) return true;
  if (mode === 'autoEdit' && (kind === 'write' || kind === 'edit') && req.force !== true) return true;
  return false;
}
