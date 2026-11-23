// ============================================================
// SADEEM v11.15 — LONG RUN MODE + COMPACTION CONTINUITY
// ------------------------------------------------------------
// The founder's requirement, verbatim in intent:
//   "مهام طويلة طويلة ... بدون انقطاع حتى ينهيها أو أوقفه أنا"
//   (very long tasks, without interruption until it finishes or I stop it).
//
// This module is the SINGLE SOURCE OF TRUTH for the long-run ceilings and
// for the rolling continuity summary that must survive auto-compaction.
// It is deliberately pure/testable: no engine imports, no side effects on
// import. Two integration points remain in engine.ts (owned by the parent):
//
//   1. `agentTuningOverrides()` → merge into `agentTuning()` settings so the
//      per-round step budget and continuation rounds are raised.
//   2. `applyLongRunEnv()` → called once at run start when the flag is on;
//      it sets the SURNIA_* env knobs the engine already reads AT CALL TIME
//      (wall clock 8h, output/pause continues, stream-drop continues).
//      It NEVER overwrites a value the operator/user already set, so the
//      v11.10 endurance tests (SURNIA_MAX_RUN_MS=120000) keep working.
//
// Safety posture: we RAISE configurable defaults and add an explicit flag;
// we do NOT remove the guardrails. A generous absolute ceiling (8h run /
// 24h hard clamp) prevents a genuine runaway. Abort is always honored by
// the engine loop — this module never suppresses io.isAborted().
// ============================================================

import { originalTaskText } from './compaction';
import {
  LONG_RUN_VERIFICATION_DEFAULTS,
  VERIFICATION_BUDGET_DEFAULTS,
} from './budget';

// ------------------------------------------------------------
// 1) Long-run flag + ceilings
// ------------------------------------------------------------

/** settings.agent.<flag> — explicit opt-in (plus env SURNIA_LONG_RUN). */
export const LONG_RUN_FLAG_SETTING = 'longRunMode';
export const LONG_RUN_FLAG_ENV = 'SURNIA_LONG_RUN';

/** Absolute hard ceiling. Even a misconfigured env value is clamped to this. */
export const ABSOLUTE_MAX_RUN_MS = 24 * 60 * 60_000;
export const ABSOLUTE_MAX_TURNS = 2_000;
/** Engine's own continuation ceiling is `Math.min(200, …)` (engine.ts:2516). */
export const ABSOLUTE_MAX_CONTINUE_ROUNDS = 200;

/** Reference values the engine ships today (used by tests / status UI). */
export const BASELINE_LIMITS = Object.freeze({
  maxTurns: 120,
  maxContinueRounds: 30,
  runWallClockCapMs: 5 * 60 * 60_000,
  timeCapGraceMs: 10 * 60_000,
  maxOutputContinues: 25,
  maxPauseContinues: 50,
  streamContinueBudget: 8,
});

/** Long-run defaults: hours, not minutes. Still bounded. */
export const LONG_RUN_LIMITS = Object.freeze({
  maxTurns: 400,
  maxContinueRounds: ABSOLUTE_MAX_CONTINUE_ROUNDS,
  runWallClockCapMs: 8 * 60 * 60_000,
  timeCapGraceMs: 15 * 60_000,
  maxOutputContinues: 60,
  maxPauseContinues: 120,
  streamContinueBudget: 16,
});

export type EnvSource = Record<string, string | undefined>;
export interface LongRunConfigInput {
  /** settings object (only `.agent[LONG_RUN_FLAG_SETTING]` and tuning are read). */
  settings?: unknown;
  /** env override — defaults to process.env. Tests pass a small map. */
  env?: EnvSource;
}

export interface LongRunLimits {
  enabled: boolean;
  source: 'flag' | 'env' | 'default';
  maxTurns: number;
  maxContinueRounds: number;
  runWallClockCapMs: number; // 0 = operator disabled the cap
  timeCapGraceMs: number;
  maxOutputContinues: number;
  maxPauseContinues: number;
  streamContinueBudget: number;
}

function envOf(input: LongRunConfigInput): EnvSource {
  return input.env ?? (process.env as EnvSource);
}

function agentOf(input: LongRunConfigInput): Record<string, unknown> {
  const s = input.settings as { agent?: Record<string, unknown> } | null | undefined;
  return s && typeof s === 'object' && s.agent && typeof s.agent === 'object' ? s.agent : {};
}

function truthy(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'number') return v === 1;
  return typeof v === 'string' && /^(1|true|yes|on)$/i.test(v.trim());
}

function positiveInt(v: unknown, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

/** Is Long Run mode requested — explicit setting flag OR env var. */
export function longRunEnabled(input: LongRunConfigInput = {}): boolean {
  const agent = agentOf(input);
  if (truthy(agent[LONG_RUN_FLAG_SETTING])) return true;
  return truthy(envOf(input)[LONG_RUN_FLAG_ENV]);
}

/**
 * Resolve the effective ceilings. Precedence: explicit env > explicit setting
 * > long-run default > baseline. Wall-clock `0` is honored (operator chose to
 * disable the cap) but any positive value is clamped to ABSOLUTE_MAX_RUN_MS.
 */
export function resolveLongRunLimits(input: LongRunConfigInput = {}): LongRunLimits {
  const env = envOf(input);
  const agent = agentOf(input);
  const enabled = longRunEnabled(input);
  const d = enabled ? LONG_RUN_LIMITS : BASELINE_LIMITS;
  const source: LongRunLimits['source'] = truthy(env[LONG_RUN_FLAG_ENV])
    ? 'env'
    : truthy(agent[LONG_RUN_FLAG_SETTING])
      ? 'flag'
      : 'default';

  const rawRunMs = env.SURNIA_MAX_RUN_MS;
  let runWallClockCapMs = d.runWallClockCapMs;
  if (rawRunMs !== undefined && rawRunMs.trim() !== '' && Number.isFinite(Number(rawRunMs))) {
    runWallClockCapMs = Number(rawRunMs) === 0 ? 0 : positiveInt(rawRunMs, d.runWallClockCapMs, 1, ABSOLUTE_MAX_RUN_MS);
  }

  return {
    enabled,
    source,
    maxTurns: positiveInt(agent.maxTurns, d.maxTurns, 1, ABSOLUTE_MAX_TURNS),
    maxContinueRounds: positiveInt(agent.maxContinueRounds, d.maxContinueRounds, 1, ABSOLUTE_MAX_CONTINUE_ROUNDS),
    runWallClockCapMs,
    timeCapGraceMs: positiveInt(env.SURNIA_TIME_CAP_GRACE_MS, d.timeCapGraceMs, 0, 60 * 60_000),
    maxOutputContinues: positiveInt(env.SURNIA_MAX_TOKENS_CONTINUES, d.maxOutputContinues, 0, 1_000),
    maxPauseContinues: positiveInt(env.SURNIA_PAUSE_CONTINUES, d.maxPauseContinues, 0, 1_000),
    streamContinueBudget: positiveInt(env.SURNIA_STREAM_CONTINUE_BUDGET, d.streamContinueBudget, 0, 200),
  };
}

/**
 * The settings.agent patch the engine owner merges into `agentTuning()`:
 *   return { ...defaults, ...agentTuningOverrides() };
 * User-set values win unless Long Run is explicitly on (then we raise the
 * floors, never disable `continueAuto`).
 */
export function agentTuningOverrides(input: LongRunConfigInput = {}): Record<string, unknown> {
  const limits = resolveLongRunLimits(input);
  const agent = agentOf(input);
  const vb = limits.enabled ? LONG_RUN_VERIFICATION_DEFAULTS : VERIFICATION_BUDGET_DEFAULTS;
  const explicitVb = agent.verificationBudget as { maxGateCalls?: number; maxGateUsd?: number } | undefined;
  return {
    maxTurns: limits.maxTurns,
    maxContinueRounds: limits.maxContinueRounds,
    continueAuto: agent.continueAuto === false && !limits.enabled ? false : true,
    verificationBudget: {
      maxGateCalls: positiveInt(explicitVb?.maxGateCalls, vb.maxGateCalls, 1, 10_000),
      maxGateUsd: Number.isFinite(explicitVb?.maxGateUsd) ? Number(explicitVb?.maxGateUsd) : vb.maxGateUsd,
    },
  };
}

/**
 * Apply the long-run env knobs the engine ALREADY reads at call time.
 * Explicit operator env values are never overwritten. Returns keys applied.
 * Call this once at the start of a long-run session (by the engine owner, or
 * from register.ts) — it is NOT called on import, so tests stay isolated.
 */
export function applyLongRunEnv(input: LongRunConfigInput = {}): string[] {
  const limits = resolveLongRunLimits(input);
  if (!limits.enabled) return [];
  const env = envOf(input);
  const target = input.env ?? process.env;
  const desired: Record<string, string> = {
    SURNIA_MAX_RUN_MS: String(limits.runWallClockCapMs),
    SURNIA_TIME_CAP_GRACE_MS: String(limits.timeCapGraceMs),
    SURNIA_MAX_TOKENS_CONTINUES: String(limits.maxOutputContinues),
    SURNIA_PAUSE_CONTINUES: String(limits.maxPauseContinues),
    // v11.19 — DO NOT auto-continue a dropped stream. Founders saw a ~60s
    // silent gap while up to 16 invisible retries ran. Keep 0 so partial text
    // is shown instantly and interruptions are visible.
    SURNIA_STREAM_CONTINUE_BUDGET: '0',
  };
  const applied: string[] = [];
  for (const [k, v] of Object.entries(desired)) {
    const cur = env[k];
    if (cur === undefined || cur.trim() === '') {
      target[k] = v;
      applied.push(k);
    }
  }
  return applied;
}

// ------------------------------------------------------------
// 2) Rolling continuity across compaction boundaries
// ------------------------------------------------------------

export interface ContinuitySnapshot {
  /** The real first user request — never the literal task KIND ('chat'). */
  originalTask: string;
  /** Most-recent decisions, newest first (bounded, deduped). */
  decisions: string[];
  /** Absolute file paths touched this run (from RunGates before-hashes/spans). */
  filesTouched: string[];
  /** Work still outstanding when the boundary was crossed. */
  pendingSteps: string[];
  /** Verification commands the engine/test ledger has seen. */
  testCommands: string[];
  capturedAt: number;
  /** How many compaction boundaries this snapshot has crossed. */
  generations: number;
}

export interface ContinuitySource {
  originalTask?: string;
  decisions?: readonly string[];
  filesTouched?: readonly string[];
  pendingSteps?: readonly string[];
  testCommands?: readonly string[];
  generations?: number;
}

const MAX_DECISIONS = 80;
const MAX_PENDING = 60;
const MAX_FILES = 300;
const MAX_COMMANDS = 30;
const DEFAULT_PREAMBLE_CHARS = 6_000;
const MAX_ITEM_CHARS = 400;

function boundedUnique(items: readonly string[] | undefined, cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items ?? []) {
    const s = String(raw ?? '').trim().slice(0, MAX_ITEM_CHARS);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

/** Normalize arbitrary records into a bounded, deduped snapshot. Pure. */
export function buildContinuitySnapshot(source: ContinuitySource): ContinuitySnapshot {
  return {
    originalTask: String(source.originalTask ?? '').trim().slice(0, 1_200),
    decisions: boundedUnique(source.decisions, MAX_DECISIONS),
    filesTouched: boundedUnique(source.filesTouched, MAX_FILES),
    pendingSteps: boundedUnique(source.pendingSteps, MAX_PENDING),
    testCommands: boundedUnique(source.testCommands, MAX_COMMANDS),
    capturedAt: Date.now(),
    generations: Number.isFinite(source.generations) ? Math.max(0, Math.floor(source.generations!)) : 0,
  };
}

/**
 * Merge a previous boundary's snapshot into current live state. Union +
 * dedupe (NOT replace): a decision made three compactions ago is still true.
 */
export function mergeContinuity(
  current: ContinuitySource,
  previous: ContinuitySnapshot | null | undefined,
): ContinuitySnapshot {
  if (!previous) return buildContinuitySnapshot(current);
  return buildContinuitySnapshot({
    originalTask: current.originalTask || previous.originalTask,
    decisions: [...(current.decisions ?? []), ...previous.decisions],
    filesTouched: [...(current.filesTouched ?? []), ...previous.filesTouched],
    pendingSteps: [...(current.pendingSteps ?? []), ...previous.pendingSteps],
    testCommands: [...(current.testCommands ?? []), ...previous.testCommands],
    generations: Math.max(current.generations ?? 0, previous.generations + 1),
  });
}

/** Minimal message shape shared by ProviderMsg and renderer ChatMessage. */
interface TaskMessage {
  role?: string;
  text?: string;
  content?: string;
}

/**
 * Mutable ledger kept for the whole run. `snapshot()` hands a copy to the
 * engine at each compaction; `restore()` folds the previous snapshot back in
 * when the next compaction summary is assembled. Nothing here can stop or
 * extend the run — it is pure continuity state.
 */
export class ContinuityLedger {
  private originalTask = '';
  private decisions: string[] = [];
  private pendingSteps: string[] = [];
  private filesTouched: string[] = [];
  private testCommands: string[] = [];
  private generations = 0;
  private readonly maxChars: number;

  constructor(opts: { maxChars?: number } = {}) {
    this.maxChars = Math.max(1_000, opts.maxChars ?? DEFAULT_PREAMBLE_CHARS);
  }

  /** Capture the real original task from the head slice + raw session messages. */
  captureOriginalTask(head: readonly TaskMessage[], rawMessages: readonly TaskMessage[] = []): string {
    const t = originalTaskText(head as never, rawMessages as never);
    if (t) this.originalTask = t;
    return this.originalTask;
  }

  setOriginalTask(text: string): void {
    if (String(text ?? '').trim()) this.originalTask = String(text).trim().slice(0, 1_200);
  }

  addDecision(text: string): void { this.decisions = boundedUnique([text, ...this.decisions], MAX_DECISIONS); }
  addPendingStep(text: string): void { this.pendingSteps = boundedUnique([text, ...this.pendingSteps], MAX_PENDING); }
  addFile(path: string): void { this.filesTouched = boundedUnique([path, ...this.filesTouched], MAX_FILES); }
  addTestCommand(cmd: string): void { this.testCommands = boundedUnique([cmd, ...this.testCommands], MAX_COMMANDS); }

  /** Fold a snapshot from the previous boundary into this live ledger. */
  restore(previous: ContinuitySnapshot | null | undefined): ContinuitySnapshot {
    const merged = mergeContinuity(this.snapshot(), previous);
    this.originalTask = merged.originalTask;
    this.decisions = merged.decisions;
    this.pendingSteps = merged.pendingSteps;
    this.filesTouched = merged.filesTouched;
    this.testCommands = merged.testCommands;
    this.generations = merged.generations;
    return this.snapshot();
  }

  snapshot(): ContinuitySnapshot {
    return buildContinuitySnapshot({
      originalTask: this.originalTask,
      decisions: this.decisions,
      filesTouched: this.filesTouched,
      pendingSteps: this.pendingSteps,
      testCommands: this.testCommands,
      generations: this.generations,
    });
  }

  /**
   * Render the model-visible continuity preamble. Priority order guarantees
   * the original task and the pending steps survive even under a tiny budget;
   * lower-priority sections are dropped whole rather than half-written.
   */
  preamble(maxChars = this.maxChars): string {
    const s = this.snapshot();
    const budget = Math.max(200, maxChars);
    const header = '[LONG-RUN CONTINUITY — carried across compaction]\n';
    const sections: string[] = [];

    if (s.originalTask) {
      sections.push(`ORIGINAL TASK (still authoritative):\n${s.originalTask}`);
    }
    if (s.pendingSteps.length) {
      sections.push(`PENDING / NEXT STEPS:\n${s.pendingSteps.map((x) => `- ${x}`).join('\n')}`);
    }
    if (s.decisions.length) {
      sections.push(`DECISIONS MADE (newest first):\n${s.decisions.map((x) => `- ${x}`).join('\n')}`);
    }
    if (s.filesTouched.length) {
      sections.push(`FILES TOUCHED THIS RUN (${s.filesTouched.length}):\n${s.filesTouched.join(', ')}`);
    }
    if (s.testCommands.length) {
      sections.push(`VERIFICATION COMMANDS SEEN:\n${s.testCommands.map((x) => `- ${x}`).join('\n')}`);
    }

    const kept: string[] = [];
    let used = header.length;
    for (const sec of sections) {
      const add = sec.length + (kept.length ? 2 : 0);
      if (used + add > budget) continue; // drop the whole low-priority section
      used += add;
      kept.push(sec);
    }
    // Guarantee: at minimum the original task is present even at 200 chars.
    if (!kept.length && s.originalTask) {
      return (header + `ORIGINAL TASK (still authoritative):\n${s.originalTask}`).slice(0, budget);
    }
    return header + kept.join('\n\n');
  }
}
