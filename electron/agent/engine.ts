// ============================================================
// Surnia — agent engine (the loop)
// Converts the UI transcript → normalized provider messages,
// streams model turns, executes tools behind the approval gate,
// handles checkpoints, subagents, compaction and /init.
// v2.1.0-engine: plan approval contract, steer semantics, doom
// loop detector, command risk gating, auto-verify loop, review
// diff, task modes, skill factory, memory nudge, context-window
// compaction, /recap and live subagent progress.
// v2.2.0-engine: Surnia DNA (the closed learning loop — auto
// extraction, feedback capture, dna_note/recall_memory), skill
// self-improvement (uses/version/Refinements), proactive skill
// suggestions, persistent approval rules, review/plan-mode
// mutating-command hard deny, alternating doom-loop detection,
// workspace skills trust gate.
// ============================================================
import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import * as checkpoints from '../services/checkpointService';
import { runCaptured } from '../services/terminalService';
import { buildSystemPrompt, TASK_MODE_SPECS, dedupeToolResults } from './prompts'; // v11.35 (C6) — fold byte-identical tool results before each provider request
import { estimateCost, contextWindowInfo } from './costs';
import { getAgent, rosterLine } from './agents';
import { executeTool, getToolDefs, toolResultImages, detectProjectTestCommand, type ToolContext, type TestPlan } from './tools';
// v11.34 — shared, pure tool-profile selection (view only, never a gate).
// v11.35 (A2) — salientToolProfile gives STRONG models the full 145-tool view.
import { salientToolProfile, type ToolProfileId } from '../../src/lib/modes';
// v11.34 (CTX-1) — compaction threshold shares the renderer's honest math:
// one 90%-of-REAL-window rule, never a fixed 65% of a 200k fallback.
import { isCompactionEligible, compactionThresholdTokens } from '../../src/lib/ctx';
import { openrouterContextFor } from '../services/openrouterCatalog';
import { isInvalidKeyError } from './providers'; // v11.16 — never retry a 401 in this loop
import { slugMcpName } from './tools';
import { redactSecrets, isMutatingCommand } from './risk';
import { clearGuard } from './editEngine';
import { mutationCheck, auditClaims, parseRedGreen, type ClaimAudit } from './verification';
import { createRunGates, clearRunGates } from './engineGates';
import { mutationGate } from './mutation';
import { detectFakeTests, fakeTestDirective } from './fakeTests';
import { buildProofPackage, saveProofPackage, loadSigningKey, proofToMarkdown, type ProofVerdict } from './proof';
import { recordFalseDone, falseDoneStats, setFalseDoneStore } from './testRecord';
import { taskBudgetCheck } from './budget';
import { selectAffectedTests, buildNarrowedCommand } from './coverage';
import { pickVerifier, resolveRoleModel, failoverChain, refCreds, isFailoverEnabled, profileFor, type AgentRole } from './router';
import { TraceRecorder } from '../agent/traces';
import { startRunJournal, journalEvent, finishRunJournal } from './journal'; // v9 — crash-resilient run journal
import { parseSkillMarkdown, saveSkill, skillsIndexLine, loadSkill, listSkills, skillVersion, appendSkillRefinement, slugifySkillName, matchSkillsForTask } from './skills';
// v1143 — task-matched selection for the honest HARNESS soft-injection.
import type { SkillMatch } from './skills';
import * as dna from './dna';
import * as playbook from './playbook'; // v11.12 - signature feature: Living Memory / Adaptive Playbook
// v11.38 (F11) — Saved Prompts must reach the model, not just sit in storage.
import { promptsForModel } from '../services/promptLibraryService';
import {
  originalTaskText,
  buildCompactionMemory,
} from './compaction'; // v11.14/v11.15 — preserve the real task + cumulative memory through compaction
import { agentTuningOverrides, applyLongRunEnv, resolveLongRunLimits } from './longRun'; // v11.15 — long autonomous runs
import { resolvePermissionMode, shouldAutoApprove, type ApprovalRequestLike, type PermissionModeLike } from './engineGates'; // v11.15 — honor full-access live
import {
  selfCritique,
  unverifiedFromAudit,
  runAndShowSummary,
  type FlowLang,
  type RunShowResult,
} from './vibeFlow'; // v11.13 — Vibe Coder internals
import * as subagents from './subagents'; // v11.12 — live subagent dashboard ledger
import { subagentTimeoutMs } from './subagentRunner'; // v11.20 (A10) — shared per-subagent wall-clock budget
import { reviewWorkingDiff, renderReviewReportMarkdown } from './review';
import * as slash from '../services/slashService';
import { auditAppend } from '../services/terminalGuard';
import { checkGate } from '../services/billingService';
import { notifyAgentDone } from '../services/notifyService';
import {
  streamTurn, type ProviderMsg, type StreamResult, type ToolDef, TEMP_TOOL_ID_PREFIX,
  providerErrorKindOf, sanitizeErrorText, getProviderToolDefs,
} from './providers'; // v11.23 — shared error classification + JSON/mixed-language sanitizer (402 / 429 / 5xx / network never mislabeled)
// v11.35 (A2) — getProviderToolDefs() makes provider-native tools (web_search /
// computer_use / unknown extras) visible in the advertised tools[] array.
// v11.26 — `cachedToolsForEngine` seeds MCP tool defs from the SYNC last-good
// cache so the FIRST provider request advertises them (fire-and-forget
// discovery otherwise lands after getToolDefs and cold servers join next run).
import { cachedToolsForEngine, mcpListTools } from './mcp';
// v11.36 (FOLLOW-UP 2) — D8's LOSSLESS connected-servers snapshot. A cold
// connected server has NO last-good cache, so the sync cache alone seeds ZERO
// defs into the first provider request. This is the canonical source for every
// tool of every connected server (no slice, no first-N) and names the real
// disconnect errors. Awaited (bounded) before tool defs are built; the
// per-server fire-and-forget probe below stays for freshness.
import { connectedServersWithTools } from '../services/mcpRegistryService';
// v11.10 — re-export for the app lifecycle: the main process must be able to
// tear down pooled MCP stdio clients on quit (and tests need the same handle
// for the engine-bundled copy, which is a SEPARATE module instance from the
// standalone mcp bundle).
export { closeAllMcpClients, stopMcpHealthMonitor } from './mcp';
import { pruneToolResults, clearVault, recallResult, renderPins } from './contextStore';
import {
  loadHooks, runPostToolHooks, runPreToolHooks, type HooksConfig,
  runSessionStartHooks, runSessionEndHooks, runUserPromptHooks,
  runPreCompactHooks, runStopHooks, runSubagentStopHooks, runNotificationHooks,
} from './hooks';
import type {
  AgentEvent,
  AgentPlan,
  AgentRunParams,
  ApprovalKind,
  ApprovalPayload,
  AppSettings,
  ChatMessage,
  MCPServerConfig,
  MCPToolInfo,
  ModelConfig,
  PermissionDecision,
  PermissionMode,
  PlanApprovalChoice,
  ProviderId,
  SessionData,
  SubagentId,
  TaskMode,
  TodoItem,
  Usage,
  UsageAttempt,
} from '../../shared/types';
import { MAX_SUBAGENTS_DEFAULT, clampMaxSubagents } from '../../shared/types';

/** Engine version — bumped per engine release (surfaced in diagnostics/recap). */
// v11.12 — the Subagents panel's "Retry failed" runs the same role + prompt in
// a detached loop (no active host run required). Registered once at boot.
subagents.setSubagentRetryLauncher((record, hooks) =>
  import('./subagentRunner').then((m) => m.runStandaloneSubagent(record, hooks)),
);

export const ENGINE_VERSION = 'v3.1.0-engine';

// ---------- public IO contract (register.ts constructs this) ----------

export interface AgentIO {
  send(event: AgentEvent): void;
  getDecision(requestId: string): Promise<PermissionDecision | null>;
  isAborted(): boolean;
  onFetchSignal(cb: (signal: AbortSignal) => void): void;
}

// ---------- constants ----------

const DEFAULT_MAX_TURNS = 120; // v8: was 40 — hours-long tasks need real room (continuation rounds stack on top)
const SUBAGENT_MAX_ITERATIONS = 24; // v8: was 12 — subagents do heavy lifting now

/**
 * v11.10 ENDURANCE — engine-level retry backoff for transient provider stream
 * failures (±20% jitter applied). SIX delays = the initial attempt plus six
 * transparent retries per provider BEFORE failover (v11.7 shipped four). The
 * schedule is env-tunable (SURNIA_TURN_RETRY_DELAYS_MS="600,1800,...") so
 * tests can shrink it and ops can lengthen it — read at call time.
 */
// v11.16: capped at ~6s total (was 59s) — a bad key must not burn a minute
// before the working model. providers.ts now handles 401/429/5xx with a
// bounded 15s failover budget; this engine-level backoff is the last resort.
const TURN_RETRY_DELAYS_MS: readonly number[] = [200, 400, 600, 800, 1000, 1200];
export function turnRetryDelays(): number[] {
  const raw = process.env.SURNIA_TURN_RETRY_DELAYS_MS;
  if (raw) {
    const parts = raw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n >= 0);
    if (parts.length) return parts;
  }
  return [...TURN_RETRY_DELAYS_MS];
}

/** Env integer helper — read at call time; falls back to `def` when unset/invalid. */
function envInt(name: string, def: number, min = 0): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= min ? Math.floor(raw) : def;
}

/**
 * v11.10 — STREAM-DROP AUTO-CONTINUE budget per loop iteration: how many times
 * a stream that died MID-ANSWER (after visible deltas) may commit its partial
 * output and re-request the SAME task. Default 8; SURNIA_STREAM_CONTINUE_BUDGET.
 */
function streamContinueBudget(): number {
  // v11.19 — 0 by default. The old default (8, later 16 under long-run)
  // silently re-requested the SAME task up to 16 times after a brief stream
  // drop — the founder saw "a full minute of nothing, then it starts".
  // Text that arrived is committed and shown immediately; a real interruption
  // is surfaced as a visible notice the user can act on, never hidden.
  return envInt('SURNIA_STREAM_CONTINUE_BUDGET', 0, 0);
}

/**
 * v11.10 — finish_reason=length auto-continues per loop (was a hard 3 — long
 * agentic answers kept getting truncated into a stop). Default 25.
 */
export function maxOutputContinues(): number {
  return envInt('SURNIA_MAX_TOKENS_CONTINUES', 25, 0);
}

/**
 * v11.10 — Anthropic pause_turn re-requests per loop (was a hard 3 — a
 * long-running server-side turn kept ending). Default 50.
 */
export function maxPauseContinues(): number {
  return envInt('SURNIA_PAUSE_CONTINUES', 50, 0);
}

/**
 * Legacy reference value kept for the v1110 endurance unit assertion.
 * v11.33 (ENDURANCE) — THE ENGINE NO LONGER ENFORCES A DEFAULT WALL-CLOCK CAP.
 * A cap is applied ONLY when an operator/tests explicitly set SURNIA_MAX_RUN_MS
 * (or opt into Long Run mode, which sets it to 8h). With no explicit override a
 * run is UNBOUNDED: it continues for hours/days until the work is done, the user
 * aborts, or the provider genuinely dies. See `wallClockCapExplicit()` below.
 */
const RUN_WALL_CLOCK_CAP_MS_DEFAULT = 5 * 60 * 60_000;
/**
 * RUN WALL-CLOCK CAP (explicit overrides only). Gracefully enforced: at the cap
 * the model is asked to wrap up; after SURNIA_TIME_CAP_GRACE_MS (default 10min)
 * the loop force-returns with stop_reason 'time_cap' — never a mid-stream kill.
 */
function runWallClockCapMs(): number {
  return envInt('SURNIA_MAX_RUN_MS', RUN_WALL_CLOCK_CAP_MS_DEFAULT, 0);
}
/** True only when the operator/tests EXPLICITLY configured the wall-clock knob. */
function wallClockCapExplicit(): boolean {
  const raw = process.env.SURNIA_MAX_RUN_MS;
  return raw !== undefined && raw.trim() !== '' && Number.isFinite(Number(raw));
}
function timeCapGraceMs(): number {
  return envInt('SURNIA_TIME_CAP_GRACE_MS', 10 * 60_000, 0);
}
/**
 * v11.33 (ENDURANCE) — OPTIONAL ops/test cap on auto-continue ROUNDS.
 * 0 / unset = UNBOUNDED (the default). A positive integer bounds the number of
 * step-budget rounds, exactly like the old settings-based ceiling but explicit.
 */
function maxContinueRounds(): number {
  const raw = process.env.SURNIA_MAX_CONTINUE_ROUNDS;
  if (raw === undefined || raw.trim() === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
// v11.10 — exported for the endurance test suite (pure env-tunable knobs).
export { runWallClockCapMs, timeCapGraceMs, streamContinueBudget, envInt, wallClockCapExplicit, maxContinueRounds };
const MEMORY_CAP = 6000;
const DIFF_CAP = 8000;
// v11.16: MCP discovery must NEVER sit on the first-token path. A cold
// `npx -y` server can take 10s+; 1.5s is enough for a warm local server and
// the rest is retried in the background by the MCP health monitor.
// v11.38 (F1) — cold MCP servers launched via `npx -y`/`uvx` spend tens of
// seconds downloading on first run; 3s made the first discovery miss them.
// 10s matches the client's bounded cold probe without blocking the turn.
const MCP_DISCOVERY_TIMEOUT_MS = 10_000;
/**
 * v11.21 (INSTANT ACTIVITY) — quiet liveness pulse cadence. The engine used to
 * emit NOTHING until the first provider delta, so a slow setup (MCP discovery,
 * settings, DNA/playbook, hooks, tool defs) looked like a frozen, blank screen.
 * A pure `heartbeat` event (no text, no transcript row) at this cadence keeps
 * the renderer's watchdog fed for the whole pre-first-token window. ≤2s by
 * contract; 1.5s leaves margin under the renderer's 2s watchdog window.
 */
const LIVENESS_PULSE_MS = 1_500;
/**
 * v11.21 — test/ops-overridable liveness cadence. Never exceeds the 1.5s
 * contract (the renderer's watchdog window); tests shrink it to observe the
 * pulse without waiting a full second. Floor 50ms so it can never spin.
 */
export function livenessPulseMs(): number {
  const raw = Number(process.env.SURNIA_LIVENESS_PULSE_MS);
  return Number.isFinite(raw) && raw >= 50 ? Math.min(LIVENESS_PULSE_MS, Math.floor(raw)) : LIVENESS_PULSE_MS;
}
/** v11.21 — hard cap for fire-and-forget context loads (hooks / skills index). */
const CONTEXT_LOAD_TIMEOUT_MS = 500;
const MENTION_MAX_FILES = 5;
const MENTION_MAX_FILE_CHARS = 8000;
const MENTION_TOTAL_CAP = 40_000;
const COMPACT_THRESHOLD_DEFAULT = 120_000; // legacy CHARS override floor (min 10_000) — see v7 threshold math

const DENY_HINT = 'User denied this action. Ask how to proceed or use an alternative.';

/**
 * v11.10 — continuation instruction injected when a stream dies mid-task after
 * visible output. Preserves the accumulated tool results: everything already
 * recorded in the transcript is DONE (executed tools live there as
 * assistant(toolCalls)+tool_result pairs) — only the interrupted attempt's
 * un-dispatched calls need re-issuing.
 */
const STREAM_DROP_CONTINUE_MSG =
  '[system] Your previous reply stream was interrupted mid-task (connection drop / provider stall). ' +
  'CONTINUE EXACTLY where you left off — same task, same plan, no recap. Tool results already recorded above are DONE; do not re-run them. ' +
  'If you were about to call a tool, issue that call again COMPLETE from the start of the call (the interrupted attempt never executed). ' +
  'If the work is actually finished, say DONE.';

// ============================================================
// v11.11 (A4) — ANTI-FREEZE: ENGINE-LEVEL DELTA BATCHING
// ------------------------------------------------------------
// The founder's #1 complaint: the live chat stream "بتعلق كثير كثير".
// Cause #1 was per-token IPC: every provider SSE delta became ONE
// io.send('text_delta') — thousands of tiny main→renderer messages per
// answer. The register.ts bridge already coalesces 33ms windows for the
// desktop UI, but every OTHER AgentIO consumer (CLI, tests, remote sinks,
// future surfaces) got the raw flood, and the engine paid the send cost on
// every token regardless. The fix lives at the SOURCE: the engine coalesces
// consecutive text/thinking deltas into ONE ordered segment queue and
// flushes at most every ~20ms OR ~200 chars (whichever comes first).
// Event NAMES are unchanged (text_delta / think_delta) — only the payload
// granularity changes. Structural events (tool_start, message_end, notices,
// errors…) always flush pending deltas FIRST, so ordering can never break,
// and every turn/tool boundary ends with a final flush.
// ============================================================

/** Flush cadence: at most one batch per interval (env SURNIA_DELTA_FLUSH_MS, floor 5ms). */
const DELTA_FLUSH_INTERVAL_MS_DEFAULT = 20;
/** Or flush early once this many chars are pending (whichever comes first). */
export const DELTA_FLUSH_MAX_CHARS = 200;

export function deltaFlushIntervalMs(): number {
  const raw = Number(process.env.SURNIA_DELTA_FLUSH_MS);
  if (!Number.isFinite(raw)) return DELTA_FLUSH_INTERVAL_MS_DEFAULT;
  return raw < 5 ? 5 : Math.floor(raw); // floor 5ms — a flush timer must never spin
}

/**
 * v11.11 (A4) — ENGINE IDLE WATCHDOG window. The providers.ts byte watchdog
 * (75s) only fires when ZERO bytes arrive; a proxy that keeps the socket warm
 * (keep-alive pings) while the model never speaks would stall the turn
 * forever. This engine-level watchdog watches ENGINE-VISIBLE activity
 * (answer deltas, THINKING deltas, tool-arg deltas, usage snapshots) and
 * fires after this many ms of silence, cancelling the attempt so the
 * v11.10 stream-drop auto-continue machinery recovers from the last
 * committed state. Env SURNIA_ENGINE_IDLE_MS (floor 500ms — tests scale it
 * down); default 20s per the anti-freeze contract.
 */
export function engineIdleTimeoutMs(): number {
  const raw = Number(process.env.SURNIA_ENGINE_IDLE_MS);
  if (!Number.isFinite(raw)) return 20_000;
  return raw < 500 ? 500 : Math.floor(raw); // floor 500ms — never spin the watchdog
}

/**
 * v11.26 (CONTINUITY) — EXTENDED-REASONING GRACE. Deep/reasoning models can
 * think for minutes while emitting ZERO bytes (no text, no thinking delta, no
 * keep-alive). That is PROGRESS, not silence: the engine idle window (20s by
 * default) must never abort it. While an attempt is in an open thinking phase,
 * the idle watchdog extends the window by up to this long instead of killing
 * the stream. It stays bounded (default 10 min) so a truly dead socket cannot
 * live forever, and is env-tunable (SURNIA_EXTENDED_REASONING_MS; 0 disables
 * the grace and restores the strict idle abort).
 */
export function extendedReasoningGraceMs(): number {
  const raw = Number(process.env.SURNIA_EXTENDED_REASONING_MS);
  if (!Number.isFinite(raw) || raw < 0) return 10 * 60_000;
  return Math.floor(raw);
}

/** One ordered pending segment: an answer-text or reasoning chunk. */
interface DeltaSegment {
  kind: 'text' | 'think';
  text: string;
}

/**
 * Ordered delta batcher. Consecutive same-kind segments merge; a
 * kind switch (thinking → answer) keeps its position, so the renderer sees
 * EXACTLY the provider's interleaving, just in bigger chunks. The flush
 * timer is unref'd — a pending batch never keeps the process alive.
 */
export class DeltaBatcher {
  private queue: DeltaSegment[] = [];
  private pendingChars = 0;
  private oldestAt = 0;
  private timer: NodeJS.Timeout | null = null;
  /** Diagnostics for tests / recap: raw deltas absorbed vs batches emitted. */
  readonly stats = { added: 0, flushedEvents: 0 };

  constructor(private readonly emit: (event: AgentEvent) => void) {}

  /**
   * THE io.send replacement for the run: deltas are coalesced, every other
   * event flushes the pending batch first (a tool_start must never overtake
   * the text that preceded it) and forwards instantly.
   */
  send(event: AgentEvent): void {
    if (event.type === 'text_delta') {
      this.add('text', event.text);
      return;
    }
    if (event.type === 'think_delta') {
      this.add('think', event.text);
      return;
    }
    this.flushNow();
    this.emit(event);
  }

  /** Queue one delta; flush immediately at the 200-char cap, else arm the timer. */
  add(kind: DeltaSegment['kind'], text: string): void {
    if (!text) return;
    this.stats.added++;
    const last = this.queue[this.queue.length - 1];
    if (last && last.kind === kind) last.text += text;
    else this.queue.push({ kind, text });
    this.pendingChars += text.length;
    if (!this.oldestAt) this.oldestAt = Date.now();
    if (this.pendingChars >= DELTA_FLUSH_MAX_CHARS) {
      this.flushNow();
      return;
    }
    if (!this.timer) {
      const delay = Math.max(1, deltaFlushIntervalMs() - (Date.now() - this.oldestAt));
      const t = setTimeout(() => {
        this.timer = null;
        this.flushNow();
      }, delay);
      try {
        t.unref?.();
      } catch {
        /* timers without unref are fine */
      }
      this.timer = t;
    }
  }

  /**
   * Drain the queue IN ORDER (consecutive same-kind segments merge into one
   * event). Called by the timer, the 200-char cap, every structural event,
   * and the final flush on turn/tool boundaries. Never throws.
   */
  flushNow(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingChars = 0;
    this.oldestAt = 0;
    while (this.queue.length) {
      const seg = this.queue.shift()!;
      let text = seg.text;
      while (this.queue.length && this.queue[0].kind === seg.kind) text += this.queue.shift()!.text;
      this.stats.flushedEvents++;
      try {
        this.emit(seg.kind === 'text' ? { type: 'text_delta', text } : { type: 'think_delta', text });
      } catch {
        /* a dead sink must never break the stream */
      }
    }
  }

  /** Diagnostics: segments waiting for the next flush. */
  get pendingSegments(): number {
    return this.queue.length;
  }
}

// ============================================================
// v2.3 — anti-refusal + text tool protocol
// ============================================================

/** A turn that ENDS with refusal language while doing NOTHING is recovered. */
// NOTE: the Arabic alternation deliberately has NO \b — \b is ASCII-only in
// JS regex and never fires between a space and an Arabic letter.
const REFUSAL_RE =
  /\b(i can'?t|i cannot|i can not|i'?m unable|unable to|i don'?t have (?:access|the (?:tools|capability|ability))|not able to|(?:do|can)?n['o]t have the (?:necessary|required) tools|cannot assist|i lack (?:the|access))\b|(لا أستطيع|لا اقدر|لا أقدر|لا أملك|لا يمكنني|غير قادر|لا أعرف كيف|لا أملك الأدوات)/i;

// v8 — UNAPPLIED-CODE gate: detects replies that DRAFT code without applying it.
/** True when the text contains a fenced code block of ≥7 lines. */
function hasUnappliedCode(t: string): boolean {
  if (!t) return false;
  const fences = t.match(/```[^\n]*\n[\s\S]*?\n```/g) ?? [];
  return fences.some((f) => f.split('\n').length >= 7);
}

/**
 * v11.9 (E16) — Q&A heuristic for the unapplied-code gate. True when the user
 * message READS AS A QUESTION: starts with a question word (EN/AR) or carries
 * a question mark ("?" / "؟") — AND contains no code-application verbs (a
 * question with "write the file…" is still a build request). The gate must
 * never push code-to-disk for Q&A turns.
 * NOTE: the Arabic alternations deliberately have NO \b — \b is ASCII-only in
 * JS regex and never fires between a space and an Arabic letter.
 */
export function looksLikeQuestion(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  const APPLY_EN =
    /\b(?:write|create|build|make|implement|code|add|fix|update|refactor|apply|generate|install|run|modify|change|delete|remove|edit|append|insert|save|deploy)\b/i;
  const APPLY_AR = /(اكتب|أنشئ|انشئ|اصنع|أصنع|اضف|أضف|أصلح|صلح|عدّل|عدل|نفّذ|نفذ|شغّل|شغل|احذف|حدّث|حدث|طبّق|طبق|أنشئي|ارفع|نصّب)/;
  if (APPLY_EN.test(t) || APPLY_AR.test(t)) return false;
  const Q_WORD_EN = /^(?:what|why|how|when|where|who|whom|whose|which|can|could|should|would|will|shall|is|are|am|was|were|do|does|did|isn't|aren't|don't|doesn't|didn't|explain|describe|tell|list|show)\b/i;
  const Q_WORD_AR = /^(?:هل|ما|ماذا|متى|لماذا|ليه|كيف|ازاي|إزاي|أين|اين|من|شنو|وش|ايه|إيه)/;
  if (Q_WORD_EN.test(t) || Q_WORD_AR.test(t)) return true;
  return t.includes('?') || t.includes('؟');
}

/** Short single-line reason for the E14 best-effort notices (capped). */
function briefErr(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim().slice(0, 160);
}

/**
 * v11.10 (A4) — engine-run verification core used by the DEBUG post-fix test
 * loop (runAgent scope — agentLoop's runAutoVerify is out of reach there).
 * Same internals: internal runCaptured pathway (no approval ping-pong),
 * harness test ledger, `verify_run` event. Never throws.
 */
async function runEngineVerify(
  cmd: string,
  workspace: string,
  signal: AbortSignal,
  emit: (e: AgentEvent) => void,
  ledger?: {
    recordTestRun: (phase: 'before' | 'after' | 'red' | 'green' | 'verify', cmd: string, exitCode: number, output: string, durationMs: number) => void;
  } | null,
): Promise<{ exitCode: number; output: string }> {
  const started = Date.now();
  let exitCode = 0;
  let output = '';
  try {
    const r = await runCaptured(cmd, workspace, 600_000, { signal });
    exitCode = r.exitCode;
    output = r.output ?? '';
  } catch {
    exitCode = -1;
    output = signal.aborted ? '[aborted]' : '[command failed to start]';
  }
  try {
    ledger?.recordTestRun(exitCode === 0 ? 'after' : 'red', cmd, exitCode, output, Date.now() - started);
  } catch {
    /* ledger is best-effort */
  }
  const tail = output.length > VERIFY_TAIL_CHARS ? output.slice(-VERIFY_TAIL_CHARS) : output;
  emit({ type: 'verify_run', cmd, exitCode, outputTail: tail });
  return { exitCode, output: tail };
}

/**
 * v11.37 (TOOL-LOOP) — recover balanced top-level JSON objects from a raw
 * payload. The founder's real output was
 *   {"tool":"pdf_make","args":{...}}}
 * i.e. an extra trailing brace that makes JSON.parse throw, plus duplicated
 * near-identical blocks. Scanning for the FIRST balanced object fixes both
 * without ever accepting a truncated object (v119 E6 contract: `{"tool":`
 * has no closing brace and stays invalid).
 */
function extractTopLevelJsonObjects(raw: string): string[] {
  const out: string[] = [];
  const text = String(raw ?? '');
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

/** Unwrap a nested {"tool","args"} / {"name","arguments"} command envelope. */
export function unwrapToolEnvelope(obj: unknown): { name: string; args: Record<string, unknown> } | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const rec = obj as Record<string, unknown>;
  const name = typeof rec.tool === 'string' ? rec.tool : typeof rec.name === 'string' ? rec.name : '';
  if (!name) return null;
  const raw = rec.args ?? rec.arguments;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return { name, args: raw as Record<string, unknown> };
}

/**
 * v11.37 — parse EITHER a bare args object OR a malformed / wrapped payload.
 * `invalid=true` only when NO balanced JSON object can be recovered at all.
 * Exported so the harness can prove the founder's exact string parses once.
 */
export function parseToolArgs(raw: string): {
  parsed: Record<string, unknown>;
  invalid: boolean;
  envelopeName: string;
} {
  const text = String(raw ?? '').trim();
  if (!text) return { parsed: {}, invalid: true, envelopeName: '' };
  const candidates = [text, ...extractTopLevelJsonObjects(text)];
  let bareObject: Record<string, unknown> | null = null;
  for (const cand of candidates) {
    let obj: unknown;
    try {
      obj = JSON.parse(cand);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
    const env = unwrapToolEnvelope(obj);
    if (env) return { parsed: env.args, invalid: false, envelopeName: env.name };
    if (cand === text && !bareObject) bareObject = obj as Record<string, unknown>;
  }
  // A complete bare object followed by stray braces / a duplicate block is
  // still ONE usable call — but only when the payload STARTS with it.
  if (!bareObject) {
    for (const cand of candidates.slice(1)) {
      if (!text.startsWith(cand)) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(cand);
      } catch {
        continue;
      }
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        bareObject = obj as Record<string, unknown>;
        break;
      }
    }
  }
  return bareObject ? { parsed: bareObject, invalid: false, envelopeName: '' } : { parsed: {}, invalid: true, envelopeName: '' };
}

/**
 * v2.3 — parse ```surnia-tool fenced blocks from a model turn (fallback
 * protocol for providers with unreliable native function calling).
 * v11.37 — unwraps nested tool/args envelopes, tolerates trailing braces and
 * dedupes duplicated near-identical blocks so ONE call is dispatched.
 * Returns validated calls; genuinely broken blocks are skipped.
 */
export function parseTextToolCalls(
  text: string,
  knownTools: Set<string>,
  cap = 8,
): { id: string; name: string; args: string }[] {
  const out: { id: string; name: string; args: string }[] = [];
  const seen = new Set<string>();
  const re = /```surnia-tool[ \t]*\r?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < cap) {
    const p = parseToolArgs(m[1]);
    if (p.invalid) continue;
    let name = p.envelopeName;
    let args = p.parsed;
    if (!name) {
      name = typeof args.tool === 'string' ? args.tool : typeof args.name === 'string' ? args.name : '';
      if (typeof args.args === 'object' && args.args && !Array.isArray(args.args)) {
        args = args.args as Record<string, unknown>;
      }
    }
    if (!name || !knownTools.has(name)) continue;
    const dedupeKey = name + '\u0000' + stableStringify(args);
    if (seen.has(dedupeKey)) continue; // duplicated near-identical block → one call
    seen.add(dedupeKey);
    out.push({ id: `txt_${out.length}_${randomUUID().slice(0, 8)}`, name, args: JSON.stringify(args) });
  }
  return out;
}

/**
 * v11.9 (E5) — the GOAL_COMPLETE marker is a harness protocol token, not
 * user-visible prose: strip every marker line from the final text before the
 * run's final events. The renderer store strips the SAME pattern from its
 * message row (cross-team contract). Exported for unit tests.
 */
export function stripGoalMarker(text: string): string {
  return text.replace(/^[ \t]*GOAL_COMPLETE\b.*$/gm, '').trim();
}

/** Remove ```surnia-tool blocks from a turn's visible text. */
export function stripTextToolBlocks(text: string): string {
  return text.replace(/```surnia-tool[ \t]*\r?\n[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** True when s parses to a non-null JSON object (not array/primitive). */
function parsesAsJsonObject(s: string): boolean {
  if (!s || !s.trim()) return false;
  try {
    const v = JSON.parse(s);
    return !!v && typeof v === 'object' && !Array.isArray(v);
  } catch {
    return false;
  }
}

/**
 * v11.9 (E8) — TEMP-ID vs FINAL-ID dedupe. A throttled tool_use partial
 * emitted under a deterministic temp id (providers.ts TEMP_TOOL_ID_PREFIX)
 * can end up NEXT TO the final complete call that flushed under its real id.
 * Invariant: never dispatch two calls with the same name where one is a
 * truncated prefix of the other — drop any temp-id entry whose name matches a
 * final call and whose args are a prefix of (equal to, or invalid JSON
 * against) the final args. Pure + exported for unit tests.
 */
export function pruneTempToolCalls(pending: Map<string, { name: string; args: string }>): void {
  const finals: { name: string; args: string }[] = [];
  for (const [id, v] of pending) {
    if (!id.startsWith(TEMP_TOOL_ID_PREFIX)) finals.push({ name: v.name, args: v.args });
  }
  if (!finals.length) return;
  for (const [id, v] of pending) {
    if (!id.startsWith(TEMP_TOOL_ID_PREFIX)) continue;
    const stale = finals.some(
      (f) => f.name === v.name && (f.args.startsWith(v.args) || !parsesAsJsonObject(v.args)),
    );
    if (stale) pending.delete(id);
  }
}

/**
 * v2.3 — corrective nudge injected when the model ends a run with refusal
 * language and NOTHING was built (no writes; v3.1 also recovers read-only-
 * then-refuse mid-task stalls). Lists the real capabilities and orders it to
 * proceed. Max 2 injections per run (state in the agent loop).
 */
function refusalRecoveryNudge(userAsk: string, tools: string[], envSummary?: string): string {
  return (
    '[SYSTEM — capability correction]\n' +
    'Your previous message refused or claimed you lack tools. That is INCORRECT: you are Surnia, running with FULL tool access on this machine — you can program ANYTHING in any language, create documents (make_document), generate images, browse the web, control this desktop, and install whatever a task needs.\n' +
    `Available tools include: ${tools.slice(0, Math.min(14, tools.length)).join(', ')}… and more.\n` +
    (envSummary ? `Machine capabilities:\n${envSummary}\n` : '') +
    'The user asked: ' +
    userAsk.slice(0, 400).replace(/\s+/g, ' ') +
    '\nExecute the request NOW: pick the first concrete step (read/inspect with workspace_map, list_dir or read_file — anywhere on this machine), then build, run and verify. ' +
    'If a runtime or dependency is missing, INSTALL it with run_command (winget/choco/brew/apt/pip/npm) — that is part of the work, not a blocker. ' +
    'Do not apologize, do not discuss your capabilities, do not refuse. Begin.'
  );
}
const INIT_PROMPT =
  'Analyze this project thoroughly (list dirs, read README/package.json/manifests, sample key source files) ' +
  'then create MEMORY.md at the workspace root documenting: project purpose, tech stack, structure map, ' +
  'build/test commands, conventions. Keep it under 120 lines.';
const COMPACT_SYSTEM =
  'You compact coding-agent transcripts. Produce a DENSE STRUCTURED summary under 800 words with EXACTLY these sections:\n' +
  '## Goal & constraints (verbatim user asks, non-negotiables)\n' +
  '## Decisions made (with the WHY)\n' +
  '## Files touched (path — what changed and why)\n' +
  '## Current state (what works / what was just done)\n' +
  '## Open questions & blockers\n' +
  '## Next steps (ordered, concrete)\n' +
  'Never drop: exact file paths, command lines, error messages, numeric values, names the user gave. Write facts, not prose.';

/** Continuation prompt pushed when the step budget runs out mid-task. */
const CONTINUE_MSG =
  '[system] You reached the step budget for this round, but the task is not done. Continue: review your todo ' +
  'list, keep implementing the remaining items, and verify your work (build/tests) as you go. Reply with ' +
  'exactly "DONE" only when every item is complete and verified.';

/**
 * v11.33 (HONEST FINISH) — injected when the model claims DONE but the last tool
 * call failed and/or a file it claimed to write is missing. Bare "DONE" is NOT
 * accepted as a completion while the evidence says otherwise: the model must
 * fix the problem or write an honest report of what failed. Bounded (max 2
 * injections per run) so a stuck model cannot spin forever.
 */
const HONEST_FINISH_NUDGE =
  '[system — completion integrity] You answered "DONE", but the run evidence contradicts that: ' +
  '{DETAIL} Do NOT claim completion. Either fix the failed step / restore the missing file with a real tool ' +
  'call, or — if it genuinely cannot be fixed — write an HONEST final report stating exactly what failed and ' +
  'what remains unfinished. Reply with "DONE" ONLY after the evidence is clean.';

/** True when the model's final message is a bare completion claim (not prose). */
function isBareDoneClaim(text: string): boolean {
  return /^\s*(?:DONE|GOAL_COMPLETE)\b[.!]?\s*$/i.test(String(text ?? ''));
}

/**
 * v11.33 (FALSE-DONE REALITY) — "Done — I created index.html" with ZERO
 * successful write calls and no file on disk is a LIE, not a completion.
 * This is the prose counterpart of `isBareDoneClaim`. It deliberately requires
 * an AFFIRMATIVE creation verb and REJECTS negation/failure language, so an
 * honest answer ("I could not create it", "no file was written", a Q&A reply)
 * is never flagged.
 */
const HONEST_NEGATION_RE =
  /\b(?:no|not|never|failed|failure|cannot|can't|couldn't|could\s+not|didn't|did\s+not|wasn't|was\s+not|weren't|were\s+not|haven't|have\s+not|hasn't|unable|blocked)\b|(?:لم|لا|فشل|تعذر|غير\s+قادر|غير\s+قادرة)/i;
const WORK_CLAIM_RE =
  /\b(?:created|built|wrote|written|made|implemented|added|generated|saved|produced|delivered|completed|finished|uploaded|installed)\b|(?:تم\s(?:إنشاء|بناء|كتابة|حفظ|إضافة|توليد|إنجاز)|أنشأت|بنيت|كتبت|حفظت|أضفت|أنجزت|ولّدت)/i;
function claimsWorkDone(text: string): boolean {
  const t = String(text ?? '');
  if (HONEST_NEGATION_RE.test(t)) return false;
  return WORK_CLAIM_RE.test(t);
}

/** First file path the model NAMES that does not exist on disk (null = none). */
function firstMissingClaimedPath(text: string, workspace: string): string | null {
  const re =
    /(?:^|[\s(["'`])((?:[A-Za-z]:[\\/])?[A-Za-z0-9_@.\-/\\]+\.(?:html?|css|js|jsx|ts|tsx|json|md|txt|py|go|rs|java|cpp|h|rb|php|sh|svg|png|jpe?g|gif|webp|pdf|docx?|csv|xml|ya?ml|toml|sql|vue|svelte|ipynb))\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text ?? '')))) {
    const raw = m[1];
    try {
      const abs = path.isAbsolute(raw) ? raw : path.resolve(workspace, raw);
      if (!fsSync.existsSync(abs)) return raw;
    } catch {
      /* a path we cannot resolve is not evidence */
    }
  }
  return null;
}

/** Corrective injected when a prose success claim has no write behind it. */
const FALSE_DONE_NUDGE =
  '[system — completion integrity] You claimed work was done but no file was written this run. ' +
  'You made ZERO tool calls that wrote anything — nothing exists on disk for {PATH}. ' +
  'Call write_file to actually create it, then verify. Do NOT present a claim as completed work; ' +
  'if you genuinely cannot create it, write an honest report of what failed instead.';

/**
 * v11.36 (INTERRUPTION — THE FOUNDER'S #1 PAIN) — a verification screenshot /
 * image result can make a provider finish with `stop` but NO visible text
 * (a thinking-only or image-only turn). The old engine ACCEPTED that as a
 * completed run with `finalText === ''` — exactly the "cuts off right after
 * the screenshot, never writes the last text" silent stop. This is a REDIRECT,
 * never a stop: the loop keeps going until the model writes a real answer.
 * Bounded by EMPTY_FINAL_NUDGE_MAX so a broken model cannot spin forever.
 */
export const EMPTY_FINAL_NUDGE =
  '[system — final answer missing] Your last turn produced NO visible final text — only reasoning, an image, ' +
  'or a bare completion marker. That is not an answer. WRITE the final response NOW in the user\'s language: ' +
  'a short, concrete summary of what you did, what the verification / screenshot showed, and anything ' +
  'still unfinished. If a completion marker is required, keep it on its own line AFTER the summary. ' +
  'Do NOT call more tools unless something is genuinely broken — just write the final answer.';

/** v11.36 — bound on the empty-final redirect (still ends honestly after N). */
const EMPTY_FINAL_NUDGE_MAX = 2;

/**
 * v11.36 — HONEST, VISIBLE terminal text when a cap/bound forces a stop with
 * no model-written summary. Never an empty string, never a fake "DONE".
 */
function silentStopFallback(reason: string): string {
  return (
    `[system — interrupted] The run stopped because ${reason}. The agent did not write a final summary; ` +
    'all work completed so far is preserved on disk. ' +
    `[system — انقطاع] توقف التشغيل بسبب ${reason} ولم يكتب الوكيل ملخصاً نهائياً؛ العمل المنجز محفوظ على القرص.`
  );
}

/** Corrective nudge when the model repeats identical read-only batches. */
const STALL_NUDGE =
  '[system] You are repeating the same tool calls without new progress. Stop. Re-read your todo list, pick a ' +
  'DIFFERENT approach or a narrower step, and continue. If something is blocking you, state the exact error ' +
  'and try one concrete alternative.';

/**
 * v11.32 (REPEATED-FAILURE BREAKER) — hard system corrective injected into the
 * NEXT model turn when the SAME tool name + arguments has failed twice in one
 * run (the founder's 503 image-generation loop). This is a REDIRECT, not a stop:
 * the run continues, the model must switch tools or state the blocker.
 */
export const REPEATED_FAILURE_NUDGE =
  'This exact tool call has already failed twice. STOP calling it. Use a DIFFERENT tool (write_file + SVG/CSS) or state the blocker and move on. Repeating it will not work.';

/**
 * v11.37 (TOOL-LOOP BREAKER) — the founder's exact complaint:
 * «شاف عائق... فانقطع» / "it sees an obstacle, retries the SAME failing tool
 * four times, then the run stops". The fix is a REDIRECT with the tool's own
 * actionable error, never a hard stop and never a generic "failed".
 */
export const TOOL_LOOP_BREAKER_NUDGE =
  'STOP repeating this failing call. Change the arguments using the EXACT fix below, or use a DIFFERENT tool / state the blocker. Repeating unchanged will not work and will stay blocked.';

/**
 * Surface the actionable FIX clause of a real tool error. The engine only
 * RELAYS the tool's own text — it never decides whether a call is a loop based
 * on that text (the breaker counts `!outcome.ok` + name + normalized args only).
 * v11.37 — M1's tools.ts uses `… Fix: <exact fix>`; older tools used `… — fix`.
 */
export function actionableFixFrom(output: string): string {
  const lines = String(output ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let s = lines[lines.length - 1] ?? 'Change the arguments or use a different tool.';
  s = s.replace(/^\[[^\]]+\]\s*/, '').replace(/^(?:system note|SYSTEM NOTE)\s*/i, '');
  // New tool-error style (M1): `<tool>: <cause>. Fix: <exact fix>`.
  const fixStyle = s.match(/(?:^|\s)(?:Fix|FIX|fix)\s*[:：]\s*(.+)$/);
  if (fixStyle && fixStyle[1].trim().length >= 8) {
    s = fixStyle[1].trim();
  } else {
    // Legacy style: `<cause> — <exact fix>`.
    const m = s.match(/\s(?:—|–|-)\s([^-—–]{8,})$/);
    if (m) s = m[1].trim();
  }
  return s.slice(0, 320);
}

/** Normalize args for the breaker: key order, whitespace and path style are cosmetic. */
function normalizeToolArgsValue(v: unknown): unknown {
  if (typeof v === 'string') {
    return v
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/{2,}/g, '/')
      .replace(/^([A-Za-z]):\//, (_m, d: string) => `${d.toLowerCase()}:/`);
  }
  if (Array.isArray(v)) return v.map(normalizeToolArgsValue);
  if (v && typeof v === 'object') {
    const rec = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(rec).sort()) out[k.toLowerCase()] = normalizeToolArgsValue(rec[k]);
    return out;
  }
  return v;
}

/**
 * Breaker fingerprint: same tool name + same NORMALIZED args. Exported so the
 * harness can assert that cosmetic rewrites of one failing call still match.
 */
export function normalizedToolCallKey(name: string, args: unknown): string {
  return String(name ?? '')
    .trim()
    .toLowerCase() +
    '\u0000' +
    stableStringify(normalizeToolArgsValue(args ?? {}));
}

/** Fingerprint for a still-unparseable call (raw text, whitespace/braces normalized). */
export function malformedToolCallKey(name: string, raw: string): string {
  const s = String(raw ?? '').replace(/\s+/g, '').replace(/[}'"`]+$/g, '');
  return 'malformed\u0000' + String(name ?? '').trim().toLowerCase() + '\u0000' + s.slice(0, 4000);
}

/** v7 — stagnation guard: K turns without NEW evidence (files/commands) → strategy change. */
const STAGNANT_TURNS_THRESHOLD = 6;
const STAGNANT_NUDGE =
  '[system — stagnation guard] The last several turns produced NO new evidence: no files changed, no commands run. ' +
  'Repeating reasoning is not progress. FORCE a strategy change now: (1) re-read the most relevant file or the ' +
  'error output with read_file / process_output, (2) state ONE new hypothesis about what is wrong, ' +
  '(3) take a concrete step that produces observable evidence (an edit, a build, a test). ' +
  'If you are genuinely blocked, ask the user one precise question with ask_user — do not keep spinning.';

/** Session-scoped: did the LAST run of this session perform file writes? */
const lastRunWrote = new Map<string, boolean>();

// ============================================================
// v2 — session goals (/goal), message queue, background subagents
// ============================================================

/** Marker the model appends to its final message to signal full goal completion. */
const GOAL_MARKER = 'GOAL_COMPLETE';
/**
 * v6 — the goal VERIFIER's system prompt (ZCode Goal Mode / Antigravity
 * stop-hook class). The verifier is a SEPARATE no-tools model pass that only
 * accepts EVIDENCE — changed files, command output, test results. Confident
 * prose, plans and checklists do NOT count.
 */
const GOAL_VERIFIER_SYSTEM =
  'You are a strict, evidence-based VERIFIER for an autonomous coding agent. You receive a goal, '
  + 'the working evidence recorded by the harness (files actually changed, commands actually run '
  + 'with exit status), and the agent\'s final message. Decide ONLY from the evidence: plans, '
  + 'checklists, effort or confident prose are NOT proof. If the evidence proves the goal is met, '
  + 'output exactly one line: GOAL_VERIFIED. Otherwise output exactly one line: '
  + 'GOAL_INCOMPLETE: <the single most important next concrete action>. No other text.';
/** Continue-round budget override while a session goal is active (/goal loop). */
const GOAL_CONTINUE_ROUNDS = 30;
/** Turn-heuristic progress ceiling (never self-reports 100% without todos). */
const GOAL_HEURISTIC_MAX_PCT = 90;
/** Prefix for user messages delivered mid-run from the session queue. */
const QUEUE_MSG_PREFIX = '[user, sent while you were working] ';
/** Prefix for engine-injected system notes delivered via the queue. */
const SYSTEM_NOTE_PREFIX = '[system] ';
/** Prefix for STEER messages injected at a tool boundary. */
const STEER_NOTE_PREFIX = '[steered — sent while you were working] ';
/**
 * v11.35 (A3/FOUNDER) — HARD SAFETY CEILING for concurrent background
 * subagents per session. The founder: «الوكلاء ما عنده حد معين» ("agents have
 * no set limit"). The old cap of 4 produced "no agents left" in ordinary
 * parallel work and contradicted that instruction. This is NOT a claim of
 * truly unlimited concurrency — it is a high runaway-protection ceiling that
 * normal use never reaches.
 *
 * v1142 — this constant is now ONLY the hard ceiling. The EFFECTIVE cap comes
 * from the real user setting `maxSubagents` (Settings → Agent → Max parallel
 * subagents), clamped here by {@link clampMaxSubagents} so a corrupt value can
 * never exceed this ceiling or spawn infinitely. Default stays at 64 so the
 * founder's "no practical limit" posture is preserved until the user lowers it.
 */
const BACKGROUND_SUBAGENT_CAP = 64; // hard ceiling — mirrors MAX_SUBAGENTS_CEILING in shared/types.ts

/** v1142 — effective runtime cap = user setting, clamped to [1, hard ceiling]. */
export function backgroundSubagentCap(settings?: AppSettings): number {
  return clampMaxSubagents(settings?.maxSubagents ?? MAX_SUBAGENTS_DEFAULT);
}
/** Auto-memory extractor bounds. */
const MEMORY_EXTRACT_MSGS = 6;
const MEMORY_LEARNED_CAP = 60;
/** v2.1 — memory nudge fires on run end with at least this many tool calls. */
const MEMORY_NUDGE_MIN_TOOLS = 6;
/** v2.1 — skill factory: minimum tool calls in a completed-goal session. */
const SKILL_MIN_TOOLS = 8;
/** v2.1 — auto-verify: consecutive file edits that trigger a verify run. */
const EDIT_VERIFY_THRESHOLD = 3;
/** v2.1 — auto-verify: max consecutive engine verify runs without new edits. */
const MAX_CONSECUTIVE_VERIFIES = 2;
/** v2.1 — verify output tail fed back to the model / event. */
const VERIFY_TAIL_CHARS = 2_000;
/** v2.1 — chars per token estimate for context-window compaction math. */
const CHARS_PER_TOKEN = 3.5;
/** v2.1 — a repeated identical tool call triggers the doom gate at this count. */
const DOOM_LOOP_THRESHOLD = 3;
/** v2.1 — doom decisions kept per session ('proceed' | 'stop'). */
const sessionDoomDecisions = new Map<string, 'proceed' | 'stop'>();
/** v2.1 — one-shot permission-mode overrides (plan approval contract). */
const sessionPermissionModes = new Map<string, PermissionMode>();
/** v2.1 — per-session task mode ('build' | 'plan' | 'debug' | 'review'). */
const sessionTaskModes = new Map<string, TaskMode>();
/** v2.1 — latest structured plan submitted via propose_plan, per session. */
const sessionPlans = new Map<string, { plan: AgentPlan; at: number }>();
/** v2.2 — skill self-improvement: one refinement per skill per session (in-memory). */
const refinedSkillKeys = new Set<string>();
/** v2.2 — skills trust gate: emit the consent event once per workspace per process. */
const skillsTrustNudged = new Set<string>();

// ============================================================
// v2.2 — persistent approval rules ("always allow" decisions)
// Per-workspace, stored in <userData>/approval-rules.json (0600):
//   { <workspaceHash>: { <ruleKey>: { command, ts } } }
// Loaded at every runAgent init and merged into the session's
// always-rules; saved whenever the user picks "always".
// ============================================================

const APPROVAL_RULES_CAP = 100;

type ApprovalRulesFile = Record<string, Record<string, { command: string; ts: number }>>;

function approvalRulesPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const app = (require('electron') as { app?: { getPath?: (k: string) => string } }).app;
    const dir = app?.getPath?.('userData');
    return dir ? path.join(dir, 'approval-rules.json') : '';
  } catch {
    return ''; // non-electron harness — persistence off
  }
}

function workspaceHashKey(workspace: string): string {
  return createHash('sha1').update(path.resolve(workspace || process.cwd())).digest('hex').slice(0, 16);
}

function readApprovalRulesFile(): ApprovalRulesFile {
  const file = approvalRulesPath();
  if (!file) return {};
  try {
    const parsed = JSON.parse(fsSync.readFileSync(file, 'utf8')) as ApprovalRulesFile;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Load the persisted "always" rule keys for a workspace. */
function loadApprovalRules(workspace: string): string[] {
  const entry = readApprovalRulesFile()[workspaceHashKey(workspace)];
  return entry && typeof entry === 'object' ? Object.keys(entry) : [];
}

/** Save one "always" decision (ruleKey → command text) for a workspace. */
function persistApprovalRule(workspace: string, ruleKey: string, command: string): void {
  const file = approvalRulesPath();
  if (!file || !ruleKey) return;
  try {
    const parsed = readApprovalRulesFile();
    const key = workspaceHashKey(workspace);
    const entry = parsed[key] && typeof parsed[key] === 'object' ? parsed[key] : {};
    entry[ruleKey] = { command: String(command ?? '').slice(0, 300), ts: Date.now() };
    // cap: drop the OLDEST rules beyond APPROVAL_RULES_CAP per workspace
    const keys = Object.keys(entry);
    if (keys.length > APPROVAL_RULES_CAP) {
      keys
        .sort((a, b) => (entry[a]?.ts ?? 0) - (entry[b]?.ts ?? 0))
        .slice(0, keys.length - APPROVAL_RULES_CAP)
        .forEach((k) => delete entry[k]);
    }
    parsed[key] = entry;
    fsSync.mkdirSync(path.dirname(file), { recursive: true });
    fsSync.writeFileSync(file, JSON.stringify(parsed, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {
    /* persistence is best-effort — the in-memory rule still applies */
  }
}

/** Wipe every persisted approval rule (Privacy → clear approvals). */
export function clearPersistentApprovalRules(): number {
  const file = approvalRulesPath();
  if (!file) return 0;
  try {
    const parsed = readApprovalRulesFile();
    let n = 0;
    for (const entry of Object.values(parsed)) n += Object.keys(entry ?? {}).length;
    fsSync.rmSync(file, { force: true });
    return n;
  } catch {
    return 0;
  }
}

// ============================================================
// v6 — persistent DENY rules ("always reject" decisions).
// Same shape/store discipline as the allow rules, separate file so clearing
// approvals clears both. DENY beats ALLOW (Antigravity precedence).
// ============================================================

const sessionDenyRules = new Map<string, Set<string>>();

type DenyRulesFile = Record<string, Record<string, { command: string; ts: number }>>;

function denyRulesPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const app = (require('electron') as { app?: { getPath?: (k: string) => string } }).app;
    const dir = app?.getPath?.('userData');
    return dir ? path.join(dir, 'approval-deny-rules.json') : '';
  } catch {
    return '';
  }
}

function readDenyRulesFile(): DenyRulesFile {
  const file = denyRulesPath();
  if (!file) return {};
  try {
    const parsed = JSON.parse(fsSync.readFileSync(file, 'utf8')) as DenyRulesFile;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function loadDenyRules(workspace: string): string[] {
  const entry = readDenyRulesFile()[workspaceHashKey(workspace)];
  return entry && typeof entry === 'object' ? Object.keys(entry) : [];
}

function persistDenyRule(workspace: string, ruleKey: string, command: string): void {
  const file = denyRulesPath();
  if (!file || !ruleKey) return;
  try {
    const parsed = readDenyRulesFile();
    const key = workspaceHashKey(workspace);
    const entry = parsed[key] && typeof parsed[key] === 'object' ? parsed[key] : {};
    entry[ruleKey] = { command: String(command ?? '').slice(0, 300), ts: Date.now() };
    const keys = Object.keys(entry);
    if (keys.length > APPROVAL_RULES_CAP) {
      keys
        .sort((a, b) => (entry[a]?.ts ?? 0) - (entry[b]?.ts ?? 0))
        .slice(0, keys.length - APPROVAL_RULES_CAP)
        .forEach((k) => delete entry[k]);
    }
    parsed[key] = entry;
    fsSync.mkdirSync(path.dirname(file), { recursive: true });
    fsSync.writeFileSync(file, JSON.stringify(parsed, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {
    /* persistence is best-effort */
  }
}

/** Wipe every persisted deny rule (Privacy → clear approvals). */
export function clearPersistentDenyRules(): number {
  const file = denyRulesPath();
  if (!file) return 0;
  try {
    const parsed = readDenyRulesFile();
    let n = 0;
    for (const entry of Object.values(parsed)) n += Object.keys(entry ?? {}).length;
    fsSync.rmSync(file, { force: true });
    return n;
  } catch {
    return 0;
  }
}

/**
 * v6 — rule matching with SCOPE BROADENING: an exact hit wins; otherwise a
 * stored rule matches when it is a token-boundary PREFIX of the computed key
 * ("cmd:npm" covers "cmd:npm install" — the editable-scope approvals from the
 * card). 'write'/'delete'/'mcp' keys stay exact.
 */
export function ruleAllows(stored: ReadonlySet<string>, ruleKey: string): boolean {
  if (stored.has(ruleKey)) return true;
  if (ruleKey.startsWith('cmd:')) {
    for (const s of stored) {
      if (s.startsWith('cmd:') && ruleKey.startsWith(s + ' ')) return true;
    }
  }
  return false;
}

/** v2.2 — DNA master switch (settings.dnaEnabled, default ON). */
function dnaEnabledSetting(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const svc = require('../services/storeService') as { getSettings(): AppSettings };
    return svc.getSettings().dnaEnabled !== false;
  } catch {
    return true;
  }
}

/** v2.2 — workspace skills trust posture (settings.trustWorkspaceSkills, default 'ask'). */
function skillsTrustSetting(): 'ask' | 'always' | 'never' {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const svc = require('../services/storeService') as { getSettings(): AppSettings };
    const v = svc.getSettings().trustWorkspaceSkills;
    return v === 'always' || v === 'never' ? v : 'ask';
  } catch {
    return 'ask';
  }
}

// ============================================================
// v1143 — SKILLS AUTO-USE (founder: «السكيلز اللي بضيفها بالسكيلز يجب أن
// استخدمها تلقائيا ... جوا الهاي يستخدمها كليات»).
//
// THE REAL GAP (traced end-to-end before this fix):
//   1. The founder adds a skill in the Skills panel — default scope
//      'workspace' → <ws>/.surnia/skills/<slug>/SKILL.md.
//   2. The old engine gate did `trusted = hasSkillsDir && !skillsTrusted` and
//      SKIPPED skillsIndexLine() entirely when untrusted. Default trust is
//      'ask' → a freshly added skill was INVISIBLE in the next system prompt.
//   3. Even when trusted, skillsIndexLine(ws, currentTask) used TASK-MATCHED
//      selective injection: a user skill with no keyword overlap vanished.
//   4. The SKILLS-FIRST directive existed but was low-salience relevance
//      advice; weak models improvised without ever calling use_skill.
// FIX: (a) ALWAYS advertise every skill (no trust suppression, no task filter
//      on the INDEX); (b) sharpen the directive with an ALL-STEPS mandate;
// (c) SOFT-INJECT the single most relevant USER skill's body into the system
//      prompt as an explicitly-labelled harness injection, so the skill is
//      followed even when the model never calls use_skill — while NEVER
//      claiming the model "used" the tool when it did not.
// Poison/quarantine is still enforced by skillsIndexLine()/matchSkillsForTask();
// `trust === 'never'` still opts out of WORKSPACE-scope body auto-injection.
// ============================================================

export interface AutoSkillInjection {
  name: string;
  slug: string;
  scope: 'workspace' | 'global';
  body: string;
  reason: string;
}

const AUTO_SKILL_BODY_CAP = 6000;
const AUTO_SKILL_MATCH_TIMEOUT_MS = 4000;

/**
 * Pick the single most relevant USER-ADDED skill (global or workspace — never
 * a built-in) for a soft harness injection. Selection is the SAME honest
 * task-match heuristic already used for the index (name > slug > description,
 * concept synonyms, quarantined skills excluded), so the "most relevant"
 * claim is verifiable from `reason`. Best-effort: never throws into the loop.
 */
export async function buildAutoSkillInjection(
  workspace: string,
  skillsTaskText: string,
  allowWorkspace = true,
  /** v11.31/v1123 — task-matched index lines; the honest candidate whitelist. */
  matchedIndex = '',
): Promise<AutoSkillInjection | null> {
  const t = String(skillsTaskText ?? '').trim();
  if (!t) return null;
  // Only skills the task-matched index actually selected may be soft-injected.
  // The full index above is for ADVERTISING; this one is for RELEVANCE.
  const matchedSlugs = new Set(
    matchedIndex
      .split('\n')
      .map((l) => /use_skill\("([^"]+)"\)/.exec(l)?.[1])
      .filter((s): s is string => !!s),
  );
  try {
    const matches: SkillMatch[] = await withTimeout(
      matchSkillsForTask(workspace, t),
      AUTO_SKILL_MATCH_TIMEOUT_MS,
      'auto skill match',
    ).catch(() => [] as SkillMatch[]);
    for (const m of matches) {
      if (m.scope === 'builtin') continue; // built-ins are shipped, not user-added
      if (m.scope === 'workspace' && !allowWorkspace) continue; // explicit 'never'
      if (matchedSlugs.size && !matchedSlugs.has(m.slug)) continue; // not task-matched
      const skill = await loadSkill(workspace, m.slug);
      if (!skill || !skill.body.trim()) continue;
      return {
        name: skill.name,
        slug: m.slug,
        scope: skill.scope === 'global' ? 'global' : 'workspace',
        body: skill.body.slice(0, AUTO_SKILL_BODY_CAP),
        reason: m.reason || 'its name/description match the current task',
      };
    }
  } catch {
    /* strictly additive — never break the run */
  }
  return null;
}

/** Stable-stringify for doom-loop hashing (sorted object keys, recursive). */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map((x) => stableStringify(x)).join(',') + ']';
  const rec = v as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(rec[k])).join(',') + '}';
}

/** Doom-loop hash: tool name + stable-serialized arguments. */
export function toolCallHash(name: string, args: unknown): string {
  return createHash('sha1').update(name + '\u0000' + stableStringify(args ?? {})).digest('hex');
}

/**
 * v2.2 — ALTERNATING doom-loop detection over the last ≤6 call hashes.
 * Pure function (exported for unit tests). Triggers when:
 *  (a) the SAME hash appears ≥4 times within the window AND there is at most
 *      1 different call between consecutive occurrences, or
 *  (b) the whole window alternates between exactly 2 hashes (A,B,A,B,…), or
 *  (c) the last 6 calls repeat a period-3 cycle (window[i] === window[i-3]).
 */
export function alternatingDoom(window: readonly string[]): boolean {
  const n = window.length;
  if (n < 4) return false;
  const cur = window[n - 1];

  // (a) ≥4 occurrences, gap ≤1 between consecutive occurrences
  const positions: number[] = [];
  for (let i = 0; i < n; i++) if (window[i] === cur) positions.push(i);
  if (positions.length >= 4) {
    let tight = true;
    for (let i = 1; i < positions.length; i++) {
      if (positions[i] - positions[i - 1] - 1 > 1) {
        tight = false;
        break;
      }
    }
    if (tight) return true;
  }

  if (n >= 6) {
    const distinct = new Set(window);
    // (b) period-2: window fills with exactly 2 hashes, no two adjacent equal
    if (distinct.size === 2) {
      let alt = true;
      for (let i = 1; i < n; i++) {
        if (window[i] === window[i - 1]) {
          alt = false;
          break;
        }
      }
      if (alt) return true;
    }
    // (c) period-3: the last 6 calls are a strict A,B,C,A,B,C cycle
    if (distinct.size === 3) {
      let p3 = true;
      for (let i = n - 1; i >= 3; i--) {
        if (window[i] !== window[i - 3]) {
          p3 = false;
          break;
        }
      }
      if (p3) return true;
    }
  }
  return false;
}

// ============================================================
// v11.32 (MCP OPT-IN) — the founder's UX finding: an MCP tool was ADVERTISED
// and EXECUTED with ZERO approval requests and ZERO notices. The prompt says
// "MCP is opt-in" but that is only words. These PURE helpers give the engine a
// REAL gate at MCP-call dispatch time. Opt-in means: the user named the server
// or tool by name, the task clearly requires that server, or the (currently
// nonexistent) mcpAutoUse setting is on. fullAccess alone is NOT opt-in.
// Exported for unit tests; no engine state is read here.
// ============================================================

/** All genuine user words in this session (harness summary/progress rows excluded). */
export function allUserText(messages: readonly { role?: unknown; text?: unknown; content?: unknown }[]): string {
  const out: string[] = [];
  for (const m of messages ?? []) {
    if (!m || m.role !== 'user') continue;
    const t = String((m as { text?: unknown }).text ?? (m as { content?: unknown }).content ?? '').trim();
    if (t && !/^\[(?:Previous running summary|Conversation auto-compacted|tool result|active goal|Newer messages)/i.test(t)) {
      out.push(t);
    }
  }
  return out.join('\n').slice(0, 8_000);
}

/** Enabled-server shape used by engine.ts (`{ server, tools }`), tolerant of a flat `{ name, tools }`. */
type McpServerEntry = {
  server?: { name?: string } | null;
  name?: string;
  tools?: readonly { name?: string }[] | null;
};
function serverEntryName(s: McpServerEntry): string {
  return String(s?.server?.name ?? s?.name ?? '');
}

/** Resolve an MCP call name (`mcp__<server>__<tool>`) against the enabled servers. */
export function resolveMcpCall(
  callName: string,
  servers: readonly McpServerEntry[],
): { server: string; tool: string } | null {
  const m = /^mcp__([\s\S]+?)__([\s\S]+)$/.exec(String(callName ?? ''));
  if (!m) return null;
  const [, serverSlug, toolSlug] = m;
  for (const s of servers ?? []) {
    const name = serverEntryName(s);
    if (!name || slugMcpName(name) !== serverSlug) continue;
    for (const t of s.tools ?? []) {
      if (t?.name && slugMcpName(t.name) === toolSlug) return { server: name, tool: t.name };
    }
  }
  return { server: serverSlug, tool: toolSlug };
}

/** Resolve by the RAW mcpToolName the model-facing approval payload carries. */
export function resolveMcpByToolName(
  toolName: string,
  servers: readonly McpServerEntry[],
): { server: string; tool: string } | null {
  const raw = String(toolName ?? '');
  if (!raw) return null;
  for (const s of servers ?? []) {
    const name = serverEntryName(s);
    if (!name) continue;
    for (const t of s.tools ?? []) {
      if (t?.name && (t.name === raw || slugMcpName(t.name) === slugMcpName(raw))) {
        return { server: name, tool: t.name };
      }
    }
  }
  return resolveMcpCall(raw, servers);
}

/**
 * v11.36 (FOLLOW-UP 2) — Latin↔Arabic letter maps for MCP server/tool names.
 * Vowels are DROPPED in the Latin→Arabic direction because that is how Arabic
 * speakers actually write tech names: "blender" → "بلندر", "render" → "رندر".
 * Both directions are generated so an explicit name in EITHER script opts in.
 */
const MCP_LATIN_TO_ARABIC: Record<string, string> = {
  a: '', b: 'ب', c: 'ك', d: 'د', e: '', f: 'ف', g: 'ج', h: 'ه',
  i: '', j: 'ج', k: 'ك', l: 'ل', m: 'م', n: 'ن', o: '', p: 'ب',
  q: 'ق', r: 'ر', s: 'س', t: 'ت', u: '', v: 'ف', w: 'و', x: 'كس',
  y: 'ي', z: 'ز',
};
const MCP_ARABIC_TO_LATIN: Record<string, string> = {
  'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th',
  'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z',
  'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': '',
  'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
  'ه': 'h', 'و': 'w', 'ي': 'y', 'ى': 'y', 'ة': 'h', 'ء': '',
};

/** v11.36 — every way the user may spell a resolved MCP server/tool name. */
function mcpNameAliases(name: string): string[] {
  const raw = String(name ?? '').trim();
  if (raw.length < 3) return [];
  const lower = raw.toLowerCase();
  const latin = lower.normalize('NFKD').replace(/[^a-z0-9\u0600-\u06FF]+/g, '');
  const aliases = new Set<string>([lower, latin].filter((v) => v.length >= 3));
  if (/[a-z]/.test(latin)) {
    const ar = latin.replace(/[a-z]/g, (c) => MCP_LATIN_TO_ARABIC[c] ?? '');
    if (ar.length >= 3) aliases.add(ar);
  }
  if (/[\u0600-\u06FF]/.test(latin)) {
    const la = latin.replace(/[\u0600-\u06FF]/g, (c) => MCP_ARABIC_TO_LATIN[c] ?? '');
    if (la.length >= 3) aliases.add(la);
  }
  // Distinctive parts of a hyphen/underscore-separated name also count:
  // "blender-cold" → "blender"/"بلندر"; "render_scene" → "render"/"رندر".
  // The verdict applies its own length guard (≥3 server / ≥5 tool).
  for (const part of lower.split(/[^a-z0-9\u0600-\u06FF]+/)) {
    if (part.length < 4) continue;
    aliases.add(part);
    const arPart = /[a-z]/.test(part) ? part.replace(/[a-z]/g, (c) => MCP_LATIN_TO_ARABIC[c] ?? '') : '';
    if (arPart.length >= 3) aliases.add(arPart);
  }
  return [...aliases];
}

export interface McpOptInVerdict {
  optedIn: boolean;
  reason: 'explicit-name' | 'task-requires' | 'setting' | 'not-requested';
  server?: string;
  tool?: string;
}

/**
 * Decide whether an MCP call may proceed silently.
 *  - setting on                         → opt-in (explicit user configuration)
 *  - user named the server/tool        → opt-in (explicit request)
 *  - task clearly requires MCP          → opt-in (e.g. "use blender", "search huggingface")
 *  - otherwise                          → NOT opt-in → require a per-call approval
 * A fullAccess permission mode is deliberately NOT a signal here.
 */
export function mcpOptInVerdict(
  userText: string,
  toolNameOrCall: string,
  servers: readonly McpServerEntry[],
  autoUseEnabled: boolean,
): McpOptInVerdict {
  const raw = String(toolNameOrCall ?? '');
  const info = resolveMcpByToolName(raw, servers) ?? resolveMcpCall(raw, servers);
  const lower = String(userText ?? '').toLowerCase();
  const base = { server: info?.server, tool: info?.tool };
  if (autoUseEnabled) return { optedIn: true, reason: 'setting', ...base };
  if (info) {
    // v11.36 (FOLLOW-UP 2) — explicitly NAMING a server/tool opts in in BOTH
    // scripts. The old code only matched the raw Latin name, so the founder's
    // «استخدم بلندر لرسم مشهد» was rejected while "use blender" passed. Check
    // every normalized/transliterated alias of the RESOLVED name.
    // A server name is distinctive; a tool name must be long enough to avoid
    // matching generic words like "search"/"read".
    for (const alias of mcpNameAliases(info.server)) {
      if (alias.length >= 3 && lower.includes(alias)) return { optedIn: true, reason: 'explicit-name', ...base };
    }
    for (const alias of mcpNameAliases(info.tool)) {
      if (info.tool.length >= 5 && alias.length >= 3 && lower.includes(alias)) {
        return { optedIn: true, reason: 'explicit-name', ...base };
      }
    }
  }
  if (raw.length >= 4 && lower.includes(raw.toLowerCase())) return { optedIn: true, reason: 'explicit-name', ...base };
  // "use the X MCP server" / Arabic equivalents — the task clearly requires MCP.
  if (/\b(?:use|using|call|invoke|via|through|run)\b[^.!?\n]{0,60}\bmcp\b/i.test(lower) ||
      /(استخدم|استعمل|عبر|باستخدام|شغل|شغّل)[^.!?\n]{0,60}(mcp|سيرفر|خادم)/i.test(lower)) {
    return { optedIn: true, reason: 'task-requires', ...base };
  }
  return { optedIn: false, reason: 'not-requested', ...base };
}

/** Readable multi-line rendering of a structured plan (tool result / recap). */
export function planToText(plan: AgentPlan): string {
  const lines = [`Plan: ${plan.title}`, ...plan.steps.map((s, i) => `${i + 1}. ${s}`)];
  if (plan.risks?.length) lines.push(`Risks: ${plan.risks.join('; ')}`);
  return lines.join('\n');
}

interface SessionGoal {
  goal: string;
  startedAt: number;
  /** Latest progress estimate (percent). */
  lastPct: number;
  /** Todo-derived progress (null until a todo_write event is observed). */
  todoDone: number | null;
  todoTotal: number;
  /** Turns observed while the goal is active (drives the heuristic estimate). */
  turns: number;
}

/**
 * One queued delivery item: a plain user message, a STEER, or a system note.
 * (Declared near the queue map; see sessionQueues below.)
 */
interface QueueItem {
  text: string;
  /** STEER — injected at the NEXT tool boundary instead of the turn end. */
  steer?: boolean;
  /** Engine system note (plan approval, verify feedback) — no user attribution. */
  system?: boolean;
}

const sessionGoals = new Map<string, SessionGoal>();
/** Per-session FIFO of queued deliveries (user messages, STEERs, system notes). */
const sessionQueues = new Map<string, QueueItem[]>();
/** sessionId → subagent runner of the ACTIVE run (hosts background subagents). */
const activeSubagentRunners = new Map<
  string,
  (agentId: SubagentId, description: string, prompt: string, opts?: { cwd?: string; background?: boolean }) => Promise<string>
>();
/** sessionId → in-flight background subagent count. */
const backgroundRunning = new Map<string, number>();

/** Register/replace the session goal (/goal). Empty goal text is ignored. */
export function setSessionGoal(sessionId: string, goal: string): void {
  const g = (goal ?? '').trim();
  if (!sessionId || !g) return;
  // keep the map bounded for the app lifetime
  if (sessionGoals.size >= 100 && !sessionGoals.has(sessionId)) {
    const oldest = sessionGoals.keys().next().value;
    if (oldest) sessionGoals.delete(oldest);
  }
  sessionGoals.set(sessionId, { goal: g, startedAt: Date.now(), lastPct: 0, todoDone: null, todoTotal: 0, turns: 0 });
  try {
    console.log(`[agent] goal set (${sessionId}): ${g.slice(0, 160)}`);
  } catch {
    /* logging is best-effort */
  }
}

/** Drop the session goal (met or cancelled). */
export function clearSessionGoal(sessionId: string): void {
  sessionGoals.delete(sessionId);
}

/** Current goal + latest progress for a session (goal null when none active). */
export function getSessionGoal(sessionId: string): { goal: string | null; pct?: number } {
  const g = sessionGoals.get(sessionId);
  return g ? { goal: g.goal, pct: g.lastPct } : { goal: null };
}

/**
 * Queue a user message for a session (sent while the agent is working or idle).
 * The engine drains the queue at run start and at every turn boundary of the
 * main run, injecting each text as a user message. Returns the queue length.
 */
export function enqueueUserMessage(sessionId: string, text: string): number {
  const q = sessionQueues.get(sessionId) ?? [];
  const t = (text ?? '').trim();
  if (t) {
    q.push({ text: t });
    if (sessionQueues.size >= 200 && !sessionQueues.has(sessionId)) {
      const oldest = sessionQueues.keys().next().value;
      if (oldest) sessionQueues.delete(oldest);
    }
    sessionQueues.set(sessionId, q);
  }
  return q.length;
}

/**
 * v2.1 STEER semantics: mark a queued message as a STEER. The engine injects
 * it at the NEXT tool boundary (between tool calls) with a visible "steered"
 * note instead of waiting for the turn end. Normal queue behavior is kept —
 * when no run is active a steer drains at the next run start like any message.
 */
export function steer(sessionId: string, text: string): number {
  const q = sessionQueues.get(sessionId) ?? [];
  const t = (text ?? '').trim();
  if (t) {
    q.push({ text: t, steer: true });
    if (sessionQueues.size >= 200 && !sessionQueues.has(sessionId)) {
      const oldest = sessionQueues.keys().next().value;
      if (oldest) sessionQueues.delete(oldest);
    }
    sessionQueues.set(sessionId, q);
  }
  return q.length;
}

/** Queue an engine system note (plan approval result, etc.) — no user attribution. */
export function enqueueSystemNote(sessionId: string, text: string): number {
  const q = sessionQueues.get(sessionId) ?? [];
  const t = (text ?? '').trim();
  if (t) {
    q.push({ text: t, system: true });
    sessionQueues.set(sessionId, q);
  }
  return q.length;
}

/**
 * v2.1 PLAN APPROVAL CONTRACT — apply the user's decision on a submitted plan.
 *  'auto'   → session permission mode becomes autoEdit + system note
 *             "Plan approved, execute autonomously" (arrives at the next
 *             turn boundary of the active run, or the next run start).
 *  'manual' → mode 'default' + note "Plan approved, ask before each edit/command".
 *  'revise' → stay in plan mode + inject the user feedback as a steered message.
 */
export function applyPlanApproval(sessionId: string, choice: PlanApprovalChoice, feedback?: string): void {
  sessionPlans.delete(sessionId);
  if (choice === 'auto') {
    sessionPermissionModes.set(sessionId, 'autoEdit');
    enqueueSystemNote(sessionId, 'Plan approved, execute autonomously.');
  } else if (choice === 'manual') {
    sessionPermissionModes.set(sessionId, 'default');
    enqueueSystemNote(sessionId, 'Plan approved, ask before each edit/command.');
  } else {
    // revise: stay in plan mode — clear any earlier override that would escape it
    sessionPermissionModes.delete(sessionId);
    const fb = (feedback ?? '').trim();
    if (fb) steer(sessionId, `Plan feedback — revise the plan accordingly: ${fb}`);
  }
}

/** v2.1 — latest structured plan submitted via propose_plan for a session (null when none). */
export function getSessionPlan(sessionId: string): AgentPlan | null {
  return sessionPlans.get(sessionId)?.plan ?? null;
}

/** v2.1 — set the session task mode ('build' | 'plan' | 'debug' | 'review'). */
export function setSessionTaskMode(sessionId: string, taskMode: TaskMode): void {
  if (!sessionId) return;
  const m: TaskMode = taskMode === 'plan' || taskMode === 'debug' || taskMode === 'review' ? taskMode : 'build';
  sessionTaskModes.set(sessionId, m);
}

/** v2.1 — current task mode for a session (default 'build'). */
export function getSessionTaskMode(sessionId: string): TaskMode {
  return sessionTaskModes.get(sessionId) ?? 'build';
}

/** In-flight background subagent count for a session (callers can pre-check the cap). */
export function backgroundSubagentCount(sessionId: string): number {
  return backgroundRunning.get(sessionId) ?? 0;
}

/** Take ALL queued deliveries for a session (FIFO), leaving the queue empty. */
function drainSessionQueue(sessionId: string): QueueItem[] {
  const q = sessionQueues.get(sessionId);
  if (!q || !q.length) return [];
  sessionQueues.delete(sessionId);
  return q;
}

/**
 * v2.1 — take only STEER items (FIFO), preserving normal messages in the queue.
 * Called at tool boundaries so steers land BETWEEN tool calls.
 */
function drainSteers(sessionId: string): QueueItem[] {
  const q = sessionQueues.get(sessionId);
  if (!q || !q.length) return [];
  const steers: QueueItem[] = [];
  const rest: QueueItem[] = [];
  for (const item of q) (item.steer ? steers : rest).push(item);
  if (rest.length) sessionQueues.set(sessionId, rest);
  else sessionQueues.delete(sessionId);
  return steers;
}

/** Render a queued delivery for the model transcript (keeps provenance clear). */
function queueItemText(item: QueueItem): string {
  if (item.system) return SYSTEM_NOTE_PREFIX + item.text;
  if (item.steer) return STEER_NOTE_PREFIX + item.text;
  return QUEUE_MSG_PREFIX + item.text;
}

/** Feed a todo event into the session goal's progress tracking (best-effort). */
function trackGoalTodos(sessionId: string, todos: TodoItem[]): void {
  try {
    const g = sessionGoals.get(sessionId);
    if (!g || !Array.isArray(todos) || !todos.length) return;
    const done = todos.filter((t) => t && typeof t === 'object' && t.status === 'completed').length;
    g.todoDone = done;
    g.todoTotal = todos.length;
    g.lastPct = Math.max(0, Math.min(100, Math.round((done / todos.length) * 100)));
  } catch {
    /* progress tracking must never break the run */
  }
}

/** Reminder appended to CONTINUE_MSG while a goal is active. */
function goalReminderSuffix(goal: string): string {
  return (
    `\n\n[active goal] ${goal} — keep working autonomously until the goal is fully met. ` +
    `End your final message with exactly ${GOAL_MARKER} only when every part is done and verified.`
  );
}

/** Read-only tools that may safely run concurrently — never writes/commands/mcp. */
const PARALLEL_SAFE_TOOLS = new Set([
  'list_dir',
  'read_file',
  'read_image',
  'search_files',
  'glob_files',
  'process_list',
  'process_output',
  'sys_info',
  'network_info',
  'web_search',
  'search_web',
  'web_fetch',
  // v11.20 (A10) — `task` is a READ-ONLY-ORCHESTRATION call: taskTool already
  // enforces checkGate('subagent') and the inline subagent inherits the
  // parent's gate (fail-closed). Multiple `task` calls in one turn must run
  // in PARALLEL — the founder explicitly wants agents to work together.
  'task',
]);

/** Corrective nudge sent when the model emits unparseable tool_use arguments. */
const MALFORMED_JSON_MSG =
  'Your tool_use arguments were invalid JSON. Re-emit the tool call with valid JSON arguments ' +
  '(a single JSON object matching the tool schema, no trailing commas, no comments). ' +
  'EXACT FIX: emit ONLY the tool\'s argument object — no outer {"tool","args"} wrapper, ' +
  'no extra closing brace, no duplicate copy of the same call. ' +
  'Example: {"path":"report.pdf","content":"..."}. ' +
  TOOL_LOOP_BREAKER_NUDGE;

/** v1.3 agent tuning knobs (settings.agent), read defensively. */
interface AgentTuning {
  maxTurns?: number;
  promptCaching?: boolean;
  parallelToolCalls?: boolean;
  maxRetries?: number;
  autoCompact?: boolean;
  compactThreshold?: number;
  /** v1.5 — long-task engine discipline. */
  continueAuto?: boolean;
  maxContinueRounds?: number;
  verifyCommand?: string;
  effort?: 'standard' | 'deep';
  /** v2 — post-run learning into MEMORY.md ('## Learned'). Default ON. */
  autoMemory?: boolean;
  /** v2.1 — engine-run verify after edit bursts (default ON). */
  autoVerify?: boolean;
  /** v6 — adversarial critic gate on trusted-mode runs (default ON). */
  criticGate?: boolean;
  /** v7 — per-step model roles (multi-provider router). */
  modelRoles?: Partial<Record<'plan' | 'search' | 'edit' | 'verify' | 'context', { provider: string; model: string }>>;
  /** v7 — verifier posture: 'fail-open' (default) or 'fail-closed'. */
  verifierMode?: 'fail-open' | 'fail-closed';
  /** v7 — network allowlist for run_command (hostnames). */
  networkAllowlist?: string[];
  /** v7.1 — mutation gate on changed lines (kill-rate threshold / budget). */
  mutationGate?: { enabled?: boolean; threshold?: number; maxMutations?: number };
  /** v7.1 — verification budget (gate verdicts / USD; 429/5xx attempts refunded). */
  verificationBudget?: { maxGateCalls?: number; maxGateUsd?: number };
  /** v7.1 — strict per-run spend ceiling, USD. */
  taskBudgetUsd?: number;
  /** v7.1 — impact-driven verification: run only tests exercising changed files (default ON). */
  impactVerify?: boolean;
  /** v11.13 — no-tools self-critique checkpoint on the final answer (default ON). */
  selfCritique?: boolean;
  /** v11.13 — post-run "Run & Show" real command report (default ON). */
  runAndShow?: boolean;
  /** v12 — tool profile advertised to the model (default 'balanced'). */
  toolProfile?: 'essential' | 'balanced' | 'full';
}

function agentTuning(): AgentTuning {
  try {
    // storeService is the main-process settings source (sync getSettings).
    const svc = require('../services/storeService') as { getSettings(): AppSettings };
    // v11.15 LONG RUN: pass the REAL settings so the helper respects the
    // user's continueAuto:false / maxTurns / verificationBudget. Calling it
    // with no settings forced continueAuto:true and clobbered user values —
    // the continuation loop then ran 30-200 extra rounds ("takes forever").
    const settings = svc.getSettings();
    return { ...(settings.agent ?? {}), ...agentTuningOverrides({ settings }) };
  } catch {
    return {}; // settings unavailable — engine defaults apply
  }
}

/**
 * v11.21 — storeService module handle, required AT MOST ONCE per process.
 * getSettings() reads+migrates+decrypts settings.json on every call; the old
 * engine called it ~17× before the first token. `settingsOnce()` is called
 * once per run (see runAgent) to capture a single snapshot; every other
 * consumer reads that snapshot instead of re-reading disk.
 */
type StoreServiceHandle = {
  getSettings(): AppSettings;
  getSettingsCallCount?(): number;
  getSettingsDiskReadCount?(): number;
  resetSettingsDiagnostics?(): void;
};
let cachedStoreService: StoreServiceHandle | null = null;
function settingsOnce(): AppSettings {
  try {
    if (!cachedStoreService) {
      cachedStoreService = require('../services/storeService') as StoreServiceHandle;
    }
    return cachedStoreService.getSettings();
  } catch {
    return {} as AppSettings; // settings unavailable — engine defaults apply
  }
}

/**
 * v11.24 — diagnostics for the latency regression suite. The engine bundle
 * contains its OWN storeService module instance, so counters must be read
 * through this handle (a separately-bundled storeService would never see them).
 * Returns -1 when the service exposes no counters (mocked/legacy bundles).
 */
export function settingsCallCountForTest(): number {
  try {
    const n = cachedStoreService?.getSettingsCallCount?.();
    return typeof n === 'number' ? n : -1;
  } catch { return -1; }
}
export function settingsDiskReadCountForTest(): number {
  try {
    const n = cachedStoreService?.getSettingsDiskReadCount?.();
    return typeof n === 'number' ? n : -1;
  } catch { return -1; }
}
export function resetSettingsDiagnosticsForTest(): void {
  try { cachedStoreService?.resetSettingsDiagnostics?.(); } catch { /* legacy bundle */ }
}

/** v7 — full settings snapshot for the router (provider keys live outside agent.*). */
function fullSettings(): AppSettings {
  return settingsOnce();
}

/** Plan gate for parallel execution; on billing failure fall back to sequential (always correct). */
function parallelGateAllowed(): boolean {
  try {
    return checkGate('parallel').allowed;
  } catch {
    return false;
  }
}

// Session-scoped "always allow" rules, persisted across runs.
// Keys: 'write' | 'cmd:<leader>[ <sub>]' | 'mcp:<toolName>' | 'delete'
const alwaysRules = new Map<string, Set<string>>();

/** v2.1 — wipe every session "always allow" rule (Privacy → clear approvals). */
export function clearApprovalRules(): number {
  let n = 0;
  for (const set of alwaysRules.values()) {
    n += set.size;
    set.clear();
  }
  return n;
}

// ============================================================
// Pure helpers (exported for unit tests — no IO, no imports)
// ============================================================

/**
 * Command leaders that act through a SUBCOMMAND ("git push" ≠ "git status"),
 * so "always allow" rules must key on the first TWO tokens for these.
 * Everything else keys on the leader token alone.
 */
export const MULTI_TOKEN_CMDS: ReadonlySet<string> = new Set([
  'git',
  'npm',
  'npx',
  'yarn',
  'pnpm',
  'docker',
  'kubectl',
  'cargo',
  'python',
  'pip',
]);

/**
 * Normalized approval-rule key for a command:
 *  - lowercased, whitespace-collapsed
 *  - TWO tokens (leader + subcommand) for known multi-word tools, else ONE
 * e.g. "git push --force" → "cmd:git push" — approving a push no longer
 * whitelists every git command. "ls -la" → "cmd:ls".
 */
export function commandRuleKey(command: string): string {
  const toks = (command ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return 'cmd:';
  const [head, sub] = toks;
  if (MULTI_TOKEN_CMDS.has(head) && sub) return `cmd:${head} ${sub}`;
  return `cmd:${head}`;
}

/** Serialized size of one normalized message (chars — matches the old JSON.stringify measure). */
export function msgChars(m: ProviderMsg): number {
  return JSON.stringify(m).length;
}

/** Incremental transcript size tracker (see createTranscriptTracker). */
export interface TranscriptTracker {
  readonly chars: number;
  push(m: ProviderMsg): void;
  /** Re-base after a wholesale replacement (e.g. compaction swap). */
  replaceAll(msgs: readonly ProviderMsg[]): void;
}

/**
 * Running transcript-size counter. The old compaction check re-serialized the
 * entire message array on EVERY loop iteration (O(n²) across a long run);
 * this keeps a counter updated incrementally on push/replace.
 */
export function createTranscriptTracker(initial: readonly ProviderMsg[]): TranscriptTracker {
  let chars = 0;
  for (const m of initial) chars += msgChars(m);
  return {
    get chars(): number {
      return chars;
    },
    push(m: ProviderMsg): void {
      chars += msgChars(m);
    },
    replaceAll(msgs: readonly ProviderMsg[]): void {
      chars = 0;
      for (const m of msgs) chars += msgChars(m);
    },
  };
}

/** Short single-line summary of a tool-call payload (first string value, capped). */
function firstArgSummary(args: unknown): string {
  if (args && typeof args === 'object') {
    for (const v of Object.values(args as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) {
        const t = v.replace(/\s+/g, ' ').trim();
        return t.length > 48 ? t.slice(0, 48) + '…' : t;
      }
    }
  }
  return '';
}

/** Abort-aware sleep used between engine-level turn retries. */
function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// ============================================================
// Entry point
// ============================================================

export async function runAgent(params: AgentRunParams, io: AgentIO): Promise<void> {
  if (!params || !io) return;
  try {
    await runAgentImpl(params, io);
  } catch (err) {
    // ============================================================
    // v11.31 (OUTER SAFETY NET) — CLOSE THE SETUP-PHASE SILENT STOP.
    // runAgentImpl emits its own terminal events from the moment its inner
    // try/finally is installed, but the ~400 lines of setup BEFORE that inner
    // try (TraceRecorder, createRunGates, cachedToolsForEngine, onFetchSignal,
    // permission/task-mode resolution) were outside ANY try/finally. A throw
    // there rejected runAgent with only `run_start` on the wire — the renderer
    // kept `running:true` and its watchdog hung forever ("AI stopped / blank").
    // This wrapper is the LAST line of defence: exactly ONE honest error row,
    // one task_report and one turn_end, sent RAW (the batcher / sink may never
    // have been constructed). It can only fire for a pre-inner-try throw —
    // every later path is already caught inside runAgentImpl, so no duplicates.
    // ============================================================
    const msg = friendlyError(err, params.model);
    try { io.send({ type: 'error', message: msg } as AgentEvent); } catch { /* dead sink */ }
    try {
      io.send({
        type: 'task_report',
        outcome: 'error',
        summary: msg,
        files: [],
        commands: [],
        nextSteps: ['Retry, or switch the provider/model in Settings → AI providers.'],
        durationMs: 0,
      } as AgentEvent);
    } catch { /* dead sink */ }
    try { io.send({ type: 'turn_end' }); } catch { /* dead sink */ }
  }
}

async function runAgentImpl(params: AgentRunParams, io: AgentIO): Promise<void> {
  // v11.21 (PERF) — INITIAL PARAM VALIDATION. The ONLY code allowed ahead of
  // the first visible event: without a sink or params there is nothing to run
  // and nobody to report to, so bail out before any setup, disk IO or await.
  if (!params || !io) return;

  // ============================================================
  // v11.21 (INSTANT ACTIVITY) — FIRST VISIBLE EVENT, THE FIRST STATEMENT.
  // Pure local sends: ZERO await, ZERO disk/IO, ZERO model latency. The
  // renderer's watchdog is fed before the batcher even exists, so the blank
  // screen while MCP/settings/DNA/tool defs load is gone. Raw io.send here is
  // intentional — no deltas can be pending yet, and it keeps the notice ahead
  // of ALL setup (not merely ahead of the first await).
  // ============================================================
  io.send({ type: 'sys_notice', kind: 'run_start', text: 'Starting…' } as AgentEvent);
  io.send({ type: 'heartbeat', phase: 'preparing' } as AgentEvent);

  // v11.11 (A4) — ENGINE-LEVEL DELTA BATCHING: every send from THIS run (the
  // loop, gates, tools, terminal events) flows through an ordered batcher.
  // text_delta/think_delta are coalesced (≤35ms / ≤200 chars per flush);
  // every other event flushes the pending batch FIRST so a structural event
  // can never overtake the deltas that preceded it. Event names unchanged.
  // v11.23 (LATE EVENTS) — turn_end is the LAST user-visible event. Once it is
  // sent the renderer has cleared its streaming state; a fire-and-forget hook,
  // DNA/playbook learner, Run & Show or skill refinement that calls ioB.send
  // afterwards would re-open a stale row (and could re-set `running`). The
  // sink is closed in sendTurnEnd() and drops everything after that point.
  let sinkClosed = false;
  const deltaBatcher = new DeltaBatcher((event) => {
    // v11.23 — allow the one DATA event that legitimately lands after the
    // terminal turn_end: DNA auto-extraction is fire-and-forget and must still
    // report its learned fact. It is not a transcript row and cannot re-open
    // a stale row or re-set `running`; all other late UI events stay dropped.
    if (sinkClosed && event.type !== 'turn_end' && event.type !== 'dna_updated') return;
    io.send(event);
  });
  const ioB: AgentIO = { ...io, send: (event: AgentEvent) => deltaBatcher.send(event) };
  // v11.3 — SYSTEM NOTICES ride a dedicated channel: gates, verifiers,
  // compaction and progress NEVER mix into the model's answer text again,
  // and the SAME notice text is emitted at most ONCE per run (the old
  // stream repeated guard/verify lines mid-answer).
  const noticedKeys = new Set<string>();
  const notice = (kind: string, text: string): void => {
    const key = `${kind}::${text.trim()}`;
    if (noticedKeys.has(key)) return;
    noticedKeys.add(key);
    ioB.send({ type: 'sys_notice', kind, text } as AgentEvent);
  };

  // v11.23 (ERROR ROWS) — ONE error row per run, from ONE place. Every path
  // that used to call ioB.send({type:'error'}) directly could fire twice (an
  // in-loop stream failure followed by a throw in post-processing, or a
  // `refusal` stop reason), and none of them forced the task_report outcome
  // to 'error' — so the user saw an error bubble next to a "completed" report.
  // `errorEventSent` is the single source of truth for the final classification.
  let errorEventSent = false;
  // v11.26 — a run with FAILED tool calls must never be reported as a clean
  // 'completed' (that is the founder's "intelligence stops / lies about done").
  let toolFailureCount = 0;
  // v11.33 (HONEST FINISH) — evidence of the LAST tool call + bounded corrective
  // injections when the model claims DONE against that evidence. Run-scoped so
  // it survives step-budget continuation rounds.
  let lastToolCallOk: boolean | null = null;
  let doneNudges = 0;
  // v11.36 (INTERRUPTION) — run-scoped so the empty-final redirect survives
  // step-budget continuation rounds. A screenshot/image-only turn must never
  // become a silent stop; after this bound an honest visible fallback is written.
  let emptyFinalNudges = 0;
  // v11.33 (FALSE-DONE REALITY) — successful WRITE calls this run. A prose
  // success claim with zero of these and no file on disk is rejected.
  let successfulWriteCalls = 0;
  /** v11.23 (P0) — the EXACT classified text of the one error row, so the
   *  terminal task_report repeats the same localized sentence (one owner
   *  surface, no raw detail) instead of inventing a second "Run failed:" copy. */
  let lastErrorText = '';
  const sendError = (message: string): void => {
    if (errorEventSent || sinkClosed) return;
    errorEventSent = true;
    lastErrorText = message;
    ioB.send({ type: 'error', message } as AgentEvent);
  };

  // v11.21 — the first visible events were emitted at the very top of this
  // function (see above), ahead of ALL the setup below: MCP discovery, the
  // settings snapshot, DNA/playbook, hooks, tree scan and tool defs all run
  // AFTER the renderer has already been fed. Nothing between the entry and
  // run_start performs IO or awaits.

  const workspace = params.workspace || process.cwd();

  // v11.26/v11.36 — MCP tools MUST be in the FIRST provider request.
  // Fire-and-forget discovery lands AFTER getToolDefs below, so seed from
  // mcp.ts's SYNC last-good cache first (zero first-token cost). v11.36 adds
  // D8's LOSSLESS connected-servers snapshot: a cold connected server with no
  // cache now contributes ALL its tools to the FIRST request too. The snapshot
  // probe is bounded (MCP_DISCOVERY_TIMEOUT_MS) and only runs when MCP servers
  // are configured. The per-server fire-and-forget probe below stays for
  // freshness — it can only UPGRADE, never blank, the first-request tool set.
  const enabledMcp: { server: MCPServerConfig; tools: MCPToolInfo[] }[] = [];
  const mcpServers = (params.mcpServers ?? []).filter((s) => s && s.enabled && (s.command || s.url));
  for (const s of mcpServers) {
    const warm = cachedToolsForEngine(s);
    if (warm?.length) enabledMcp.push({ server: s, tools: warm });
  }
  if (mcpServers.length) {
    // v11.36 (COLD SERVER) — the founder: «حكيت له يستخدم بلندر... لم يستطع».
    // A fresh connection had no last-good cache → 0 defs on turn 1. Seed from
    // the registry's connected snapshot (canonical, lossless) BEFORE defs are
    // built. Best-effort: a dead/offline server never blocks first token.
    try {
      const snap = await withTimeout(
        connectedServersWithTools(),
        MCP_DISCOVERY_TIMEOUT_MS,
        'MCP connected-servers snapshot timed out',
      );
      for (const entry of snap.servers ?? []) {
        if (!entry.tools?.length) continue;
        const id = entry.server?.id;
        const idx = enabledMcp.findIndex((e) =>
          (id && e.server.id === id) || e.server.name === entry.server?.name);
        if (idx >= 0) {
          if (!enabledMcp[idx].tools?.length) enabledMcp[idx] = { server: entry.server, tools: entry.tools };
        } else {
          enabledMcp.push({ server: entry.server, tools: entry.tools });
        }
      }
    } catch {
      /* probe is best-effort — never block the first token on a dead server */
    }
  }
  if (mcpServers.length) {
    const discoveries = mcpServers.map(async (server) => {
      try {
        const res = await withTimeout(
          mcpListTools(server),
          MCP_DISCOVERY_TIMEOUT_MS,
          `MCP discovery for "${server.name}" timed out`,
        );
        return res.ok && res.tools?.length ? { server, tools: res.tools } : null;
      } catch {
        return null; // a broken MCP server must never block the agent
      }
    });
    void Promise.all(discoveries)
      .then((found) => {
        for (const f of found) {
          if (!f) continue;
          const idx = enabledMcp.findIndex((e) => e.server.id === f.server.id);
          if (idx >= 0) enabledMcp[idx] = f; else enabledMcp.push(f);
        }
      })
      .catch(() => {
        /* discovery is best-effort — never an unhandled rejection */
      });
  }

  // v11.21 — ONE settings snapshot for the whole pre-first-token path.
  // Every consumer below uses this instead of re-reading/migrating/decrypting
  // settings.json ~17×. The module-level helpers are shadowed here on purpose
  // (JS const shadowing) so nested agentLoop/gate closures read the SAME
  // snapshot without changing their call sites.
  const settingsSnapshot: AppSettings = settingsOnce();
  // v11.24 (FIRST-TOKEN LATENCY) — start the bounded hook-config load NOW, in
  // parallel with credentials/memory/transcript/tool-def work below. The await
  // stays at the same logical point (just before the prompt is built); this only
  // overlaps the disk read with the other synchronous setup instead of paying
  // it serially. A hostile/slow workspace config is still capped at 500ms.
  const hooksCfgPromise: Promise<HooksConfig> = withTimeout(
    loadHooks(workspace),
    CONTEXT_LOAD_TIMEOUT_MS,
    'hook config load',
  ).catch(() => ({ PreToolUse: [], PostToolUse: [] }) as HooksConfig);
  const fullSettings = (): AppSettings => settingsSnapshot;
  const agentTuning = (): AgentTuning => ({
    ...(settingsSnapshot.agent ?? {}),
    ...agentTuningOverrides({ settings: settingsSnapshot }),
  });
  const dnaEnabledSetting = (): boolean => settingsSnapshot.dnaEnabled !== false;
  const skillsTrustSetting = (): 'ask' | 'always' | 'never' => {
    const v = settingsSnapshot.trustWorkspaceSkills;
    return v === 'always' || v === 'never' ? v : 'ask';
  };

  // v2.1 — one-shot permission-mode override (plan approval contract): the
  // approval IPC writes the override; THIS run consumes it as its base mode.
  // Mid-run approvals keep working because the approval gate re-reads the map.
  const settingsPermissionMode: string | undefined = settingsSnapshot.permissionMode;
  const mode: PermissionMode = resolvePermissionMode({
    paramsMode: params.mode as PermissionModeLike,
    settingsMode: settingsPermissionMode as PermissionModeLike,
    sessionOverride: sessionPermissionModes.get(params.sessionId) as PermissionModeLike,
  }) as PermissionMode;
  sessionPermissionModes.delete(params.sessionId);
  // v11.15 LONG RUN: flip env-read ceilings to long-run values for a
  // fullAccess/long-run session (never overrides an explicit operator env).
  if (mode === 'fullAccess' || resolveLongRunLimits({ settings: settingsSnapshot }).enabled) {
    applyLongRunEnv();
  }
  /** Live permission mode: a mid-run plan approval applies to THIS run too. */
  const currentMode = (): PermissionMode => sessionPermissionModes.get(params.sessionId) ?? mode;
  // v2.1 — task mode: IPC override (explicit user action) wins over params.
  // v11.12 (A4-GUARANTEE): the run's EXPLICIT taskMode (what the UI strip
  // shows) now WINS over the in-memory engine map — after openSession the
  // strip resets to build while a stale map still said 'plan', so runs used to
  // execute in a mode the UI did not show (the founder's "nothing happens").
  const taskMode: TaskMode = params.taskMode ?? sessionTaskModes.get(params.sessionId) ?? 'build';

  if (!params.model?.model) {
    // v11.23 (P0) — one owner message, ONE language. The error row and the
    // terminal task_report previously disagreed (EN row for an AR user, or a
    // bilingual row next to an EN-only report note). Both read this snapshot.
    const arNoModel = settingsSnapshot.language === 'ar';
    const noModelMsg = arNoModel
      ? 'لا يوجد نموذج مُعدّ. افتح الإعدادات ← مزودو الذكاء الاصطناعي واختر نموذجاً.'
      : 'No model configured. Check Settings → AI providers.';
    const noModelNext = arNoModel
      ? 'افتح الإعدادات ← مزودو الذكاء الاصطناعي، اختر نموذجاً بمفتاح صالح، ثم أعد المحاولة.'
      : 'Open Settings → AI providers, pick a model with a valid key, then retry.';
    sendError(noModelMsg);
    // v11.11 (A4) — completion guarantee: even this terminal path reports.
    try {
      ioB.send({
        type: 'task_report',
        outcome: 'error',
        summary: noModelMsg,
        files: [],
        commands: [],
        nextSteps: [noModelNext],
        durationMs: 0,
      } as AgentEvent);
    } catch {
      /* report is best-effort */
    }
    // v11.26 — this TERMINAL exit sits before the try/finally, so it cannot
    // call sendTurnEnd() (declared later). Guard the terminal send directly:
    // a dead sink must never throw out of runAgent and strand the renderer.
    try {
      ioB.send({ type: 'turn_end' });
    } catch {
      /* the channel is dead — nothing further can be delivered */
    }
    sinkClosed = true;
    return;
  }

  // Abort bridge: register.ts owns the AbortController; mirror it locally so
  // every fetch and the loop itself can observe the abort.
  const local = new AbortController();
  io.onFetchSignal((external) => {
    if (external.aborted) local.abort();
    else external.addEventListener('abort', () => local.abort(), { once: true });
  });
  const signal = local.signal;

  // v11.21 — QUIET LIVENESS HEARTBEAT, started at RUN START (not when
  // streamTurn is finally reached, which is after all the setup work). It
  // pulses every ≤2s until the first REAL provider delta lands, covering the
  // entire pre-first-token window. It is a pure `heartbeat` event: NO text,
  // NO transcript row, NO spam — the renderer only uses it to reset its
  // watchdog. The single 20s "still reasoning" TEXT marker inside the
  // thinking stream is kept unchanged; this pulse is its silent companion.
  let firstVisibleDeltaAt = 0;
  let livenessTimer: NodeJS.Timeout | null = null;
  const stopLiveness = (): void => {
    if (livenessTimer) {
      clearInterval(livenessTimer);
      livenessTimer = null;
    }
  };
  const markFirstDelta = (): void => {
    if (firstVisibleDeltaAt) return;
    firstVisibleDeltaAt = Date.now();
    stopLiveness(); // real provider deltas take over the liveness signal
  };
  livenessTimer = setInterval(() => {
    if (firstVisibleDeltaAt || signal.aborted) {
      stopLiveness();
      return;
    }
    try {
      ioB.send({ type: 'heartbeat', phase: 'preparing' } as AgentEvent);
    } catch {
      /* a dead sink must never break the run */
    }
  }, livenessPulseMs());
  try {
    livenessTimer.unref?.();
  } catch {
    /* timers without unref are fine */
  }

  // Session "always" rules (shared with subagents of this session).
  let rules = alwaysRules.get(params.sessionId);
  if (!rules) {
    rules = new Set<string>();
    // prune: keep the rules map bounded for the app lifetime
    if (alwaysRules.size >= 50) {
      const oldest = alwaysRules.keys().next().value;
      if (oldest) alwaysRules.delete(oldest);
    }
    alwaysRules.set(params.sessionId, rules);
  }
  // v6 — session "always deny" rules (Deny > Allow precedence).
  let denyRules = sessionDenyRules.get(params.sessionId);
  if (!denyRules) {
    denyRules = new Set<string>();
    sessionDenyRules.set(params.sessionId, denyRules);
  }
  // v2.2 — persistent approval rules: merge the workspace's saved "always"
  // decisions (approval-rules.json) into this session's rule set.
  try {
    for (const key of loadApprovalRules(workspace)) rules!.add(key);
  } catch {
    /* persistence is best-effort */
  }
  // v6 — persistent deny rules merge the same way.
  try {
    for (const key of loadDenyRules(workspace)) denyRules!.add(key);
  } catch {
    /* persistence is best-effort */
  }

  // One checkpoint per run, before the first allowed write/edit.
  let checkpointDone = false;
  let checkpointsEnabled = true; // refined from settings below
  // v1.5: did THIS run perform writes? (drives the next turn's checkpoint)
  let writesThisRun = false;
  // v7 — structured run trace (JSONL in userData/traces) — offline failure
  // statistics feed the eval loop; best-effort, never throws.
  const trace = new TraceRecorder(params.sessionId, workspace, params.task);
  // Provider credentials — resolved in the try block, captured by agentLoop.
  let creds: { apiKey?: string; baseUrl?: string } = {};
  // v1.3 agent tuning (max turns, caching, parallel calls, retries, compaction).
  const cfg = agentTuning();
  // v2.1 — run-scoped counters shared with agentLoop (main run only).
  let runToolCalls = 0;
  const touchedFiles = new Set<string>();
  let planSubmittedThisRun = false;
  // v2.1 — verify-loop command cache (detected once per run).
  let verifyCmdCache: TestPlan | null | undefined;
  // v2.2 — DNA / skill self-improvement run state.
  let verifyFailedThisRun = false; // engine verify loop exited non-zero
  let denialsThisRun = 0; // user denied write/command approvals (→ DNA feedback)
  const skillsUsedThisRun = new Set<string>(); // slugs passed to use_skill
  // v2.6 — UI quality gate state: which UI files were written, and whether
  // the model already probed them with ui_quality_check.
  const uiWritePaths: string[] = [];
  let uiQualityRan = false;
  // v6 — Evidence receipt: every command the run executed (text + ok) and the
  // files it touched feed (a) the end-of-run EVIDENCE RECEIPT the UI renders
  // and (b) the goal VERIFIER's evidence block. Recorded in execPrepared.
  const commandsRun: { cmd: string; ok: boolean }[] = [];
  // v11.12 (A4-REPORT) — per-tool usage counters for the end-of-run report:
  // the founder asked to SEE what the run actually used (read_file ×12 ✓,
  // edit_file ×5 with 3 failures …) instead of guessing.
  const toolUsage = new Map<string, { ok: number; fail: number }>();
  const bumpToolUsage = (name: string, ok: boolean): void => {
    const e = toolUsage.get(name) ?? { ok: 0, fail: 0 };
    if (ok) e.ok++; else e.fail++;
    toolUsage.set(name, e);
  };
  // v11.12 (A4-REPORT) — the last successful todo snapshot drives the report's
  // honest "what was NOT done" section.
  let lastTodoSnapshot: { text: string; done: boolean }[] = [];
  // v11.12 (A4-GUARANTEE) — finalText carried OUTSIDE the try block: the catch
  // path cannot see the try-scoped `result`, so PLAN-mode crashes still show
  // whatever the model produced before dying.
  let planCarryText = '';
  // v11.12 (A4-REPORT) — run usage totals, captured by reference once the main
  // loop creates them (early short-circuit paths report without usage).
  let runUsageRef: Usage | null = null;
  let criticRanThisRun = false; // the adversarial critic runs at most once per run
  // v7.1 — critic verdict captured for the proof package (null = not run).
  let criticPayloadThisRun: { findings: number; critical: number; summary: string } | null = null;
  let gateFixRoundsThisRun = 0; // fake-test/critic/mutation-driven fix rounds
  // v7.1 — PROVEN CHANGE PIPELINE: one per-run gate bundle (test ledger,
  // verification budget, taint ledger, before-hashes, mutation spans).
  // Tools find it via the sessionId registry; cleared at run end.
  const gates = createRunGates(params.sessionId, {
    maxGateCalls: cfg.verificationBudget?.maxGateCalls,
    maxGateUsd: cfg.verificationBudget?.maxGateUsd,
  });
  const runStartedAt = Date.now();
  const absTouched = (): string[] =>
    [...gates.beforeHashes.keys()].map((p) => (path.isAbsolute(p) ? p : path.resolve(workspace, p)));
  /** Proof-package claim-audit payload (pure mapping). */
  const audit2Payload = (audit: ClaimAudit) => ({
    total: audit.claims.length,
    unsupported: audit.unsupportedCount,
    claims: audit.claims.slice(0, 8).map((c) => ({ claim: c.claim, kind: c.kind, supported: c.supported })),
  });
  /** Electron userData dir (defensive — CLI bundles have no app). */
  const electronUserDataDirSafe = (): string => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { app } = require('electron') as { app?: { getPath?: (k: string) => string } };
      return app?.getPath?.('userData') ?? process.cwd();
    } catch {
      return process.cwd();
    }
  };
  /** v11.12 (B1-GATE-ESCAPE) — is a real Electron runtime present? The UI
   * quality probe needs BrowserWindow; in headless/CLI harnesses it can never
   * run, and the gate must degrade gracefully instead of burning a fix round. */
  const electronAvailableForProbe = (): boolean => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { BrowserWindow } = require('electron') as { BrowserWindow?: unknown };
      return typeof BrowserWindow === 'function';
    } catch {
      return false;
    }
  };
  /** Dense evidence summary for the verifier / receipt (pure, no IO). */
  const evidenceBlock = (): string => {
    const lines: string[] = [];
    if (touchedFiles.size) {
      lines.push(`Files changed (${touchedFiles.size}): ${[...touchedFiles].slice(0, 12).join(', ')}`);
    } else {
      lines.push('Files changed: NONE');
    }
    if (commandsRun.length) {
      lines.push(`Commands executed (${commandsRun.length}):`);
      for (const c of commandsRun.slice(-10)) lines.push(`  - ${c.cmd} → ${c.ok ? 'exit 0' : 'FAILED'}`);
    } else {
      lines.push('Commands executed: NONE');
    }
    return lines.join('\n');
  };

  // ============================================================
  // v11.11 (A4) — COMPLETION GUARANTEE (the founder: "ينتهي وما كتب شي").
  // EVERY terminal path of the run — completed, aborted, error (including
  // failover-exhausted and watchdog-recovered runs) — emits ONE structured
  // `task_report` event before turn_end: what was built, which files
  // changed, how to verify/run it, and concrete next steps. Deterministic
  // (evidence-driven, no extra model call) so it can NEVER fail silently.
  // Emitted at most once per run.
  // ============================================================
  let taskReportSent = false;
  /** v11.26 — did a task_report actually REACH the sink (not merely attempted)? */
  let reportDelivered = false;
  /** v11.11 (A4-CLOSURE) — outcome of the report that WAS emitted (journal finish line). */
  let lastReportOutcome: 'completed' | 'error' | 'aborted' | null = null;
  /**
   * v11.26 (CONTINUITY) — the REAL reason the run ended, captured before ANY
   * cleanup so the finally-based safety net can write an HONEST report. This is
   * never fabricated: when the try block blew through, this is the actual error
   * (or the user's abort) — the fallback report repeats it, classified, instead
   * of inventing a generic "success" or a vague "could not complete".
   */
  let fatalErrorText = '';
  /** v11.26 — true when the finally safety net had to emit the terminal report. */
  let safetyNetReport = false;
  /** v11.12 (A4-GUARANTEE) — honest plan fallback from the run's OWN trace.
   * Pure-trace by design: it NEVER touches the try-scoped `result`, so it is
   * safe to call from the catch path where `result` may be uninitialized. */
  const synthesizePlanFallback = (): string => {
    const goal = sessionGoals.get(params.sessionId)?.goal?.trim() || params.task || 'session task';
    const tools = [...toolUsage.entries()]
      .sort((a, b) => b[1].ok + b[1].fail - (a[1].ok + a[1].fail))
      .slice(0, 8);
    const lines: string[] = [
      `# Plan draft (harness-synthesized) — ${goal}`.slice(0, 260),
      '',
      "> The model returned no explicit plan this run. This draft is built from the run's own trace — nothing is invented.",
      '',
      '## What this run examined',
      tools.length
        ? tools.map(([n, c]) => `- ${n} — ${c.ok} ok / ${c.fail} failed`).join('\n')
        : '- no tool calls were made',
    ];
    if (commandsRun.length) {
      lines.push('', '## Commands run');
      for (const c of commandsRun.slice(-8)) lines.push(`- ${c.ok ? 'ok' : 'FAIL'}: ${c.cmd.slice(0, 120)}`);
    }
    lines.push(
      '',
      '## Next',
      '1. Review the analysis in the conversation above.',
      '2. Switch to BUILD mode (the mode strip or /build) and approve implementation.',
      '3. After the build, the engine verifies and opens the live preview automatically.',
    );
    return lines.join('\n').trim();
  };
  const runLoop = async (args: Parameters<typeof agentLoop>[0]): Promise<Awaited<ReturnType<typeof agentLoop>>> => {
    const r = await agentLoop(args);
    // v11.12 (A4-GUARANTEE) — capture finalText OUTSIDE the try scope so the
    // catch path can still surface PLAN output after a mid-run crash.
    planCarryText = (r.finalText ?? '').slice(0, 16000);
    return r;
  };
  const emitTaskReport = (o: {
    outcome: 'completed' | 'error' | 'aborted';
    stopReason?: string;
    note?: string;
    finalText?: string;
    maxedOut?: boolean;
    /** v12 — explicit honesty override: a truncated/force-ended run is PARTIAL
     *  even if no file was written, so it must never read as a clean "completed". */
    partial?: boolean;
  }): void => {
    if (taskReportSent) return;
    taskReportSent = true;
    // Recorded BEFORE any IO so the journal finish line (written in the run's
    // finally) knows the outcome even if the send path blows up.
    lastReportOutcome = o.outcome;
    try {
      // Normalize to forward slashes so the completion report lists
      // `dist/index.html` on Windows too (the preview hint below already does
      // this; the report must agree with it and with the renderer's UI).
      const files = [...touchedFiles].slice(0, 50).map((f) => f.replace(/\\/g, '/'));
      const cmds = commandsRun.slice(-20).map((c) => ({ cmd: c.cmd, ok: c.ok }));
      const verifyCmd = verifyCmdCache?.command ?? cfg.verifyCommand?.trim() ?? '';
      const nextSteps: string[] = [];
      if (o.outcome === 'completed') {
        if (o.maxedOut) nextSteps.push('An explicitly configured step-budget cap was reached; all work completed so far is preserved on disk.');
        if (verifyCmd) nextSteps.push(`Verify the work yourself: run \`${verifyCmd}\` in the workspace.`);
        if (files.length) nextSteps.push('Review the changed files listed above; ask for any adjustment.');
        if (o.stopReason === 'time_cap') nextSteps.push('An explicitly configured wall-clock cap was reached; all work completed so far is preserved on disk.');
        if (!nextSteps.length) nextSteps.push('Send a follow-up message for changes or a deeper pass.');
      } else if (o.outcome === 'aborted') {
        nextSteps.push('The run was stopped — everything already built is kept on disk.');
        nextSteps.push('Send a follow-up message to resume exactly where it left off.');
      } else {
        nextSteps.push('Partial output is preserved; nothing was lost.');
        nextSteps.push('Check the error above (network / provider / API key), then send a follow-up to continue the task.');
        if (verifyCmd) nextSteps.push(`Once resumed, verify with \`${verifyCmd}\`.`);
      }
      const summary =
        (o.note ? `${o.note} ` : '') +
        (o.finalText && o.finalText.trim()
          ? o.finalText.trim().slice(0, 800)
          : files.length
            ? `Work stopped mid-task — ${files.length} file(s) changed${cmds.length ? `, ${cmds.length} command(s) executed` : ''}.`
            : 'Nothing was changed on disk in this run.');
      // v11.12 (A4-REPORT) — richer, honest payload: per-tool usage, what was
      // NOT done (open todos), run usage, partial flag, and the task mode.
      const toolsUsed = [...toolUsage.entries()]
        .sort((a, b) => b[1].ok + b[1].fail - (a[1].ok + a[1].fail))
        .slice(0, 12)
        .map(([name, c]) => ({ name, count: c.ok + c.fail, ok: c.ok, fail: c.fail }));
      const notDone = lastTodoSnapshot.filter((td) => !td.done).map((td) => td.text).slice(0, 12);
      if (taskMode !== 'build' && o.outcome === 'completed') {
        if (taskMode === 'plan') nextSteps.push('PLAN mode: switch to BUILD (mode strip or /build) to implement the plan.');
        if (taskMode === 'debug') nextSteps.push('DEBUG mode: re-run with the failing symptom for a hypothesis → test → fix loop.');
        if (taskMode === 'review') nextSteps.push('REVIEW mode: address the findings above, then re-run for a follow-up pass.');
      }
      // NOTE: `files`, `cmds`, `verifyCmd` and `summary` are captured BEFORE
      // any send so the journal write below sees the exact payload (A4-CLOSURE).
      ioB.send({
        type: 'task_report',
        outcome: o.outcome,
        summary,
        files,
        commands: cmds,
        ...(verifyCmd ? { howToRun: verifyCmd } : {}),
        nextSteps,
        ...(toolsUsed.length ? { toolsUsed } : {}),
        ...(notDone.length ? { notDone } : {}),
        ...(taskMode !== 'build' ? { taskMode } : {}),
        ...(runUsageRef
          ? {
              usage: {
                inputTokens: runUsageRef.inputTokens,
                outputTokens: runUsageRef.outputTokens,
                costUsd: Math.round(runUsageRef.costUsd * 1e6) / 1e6,
              },
            }
          : {}),
        partial: o.partial === true || ((writesThisRun || commandsRun.length > 0) && o.outcome !== 'completed'),
        ...(o.stopReason ? { stopReason: o.stopReason } : {}),
        durationMs: Math.max(0, Date.now() - runStartedAt),
      } as AgentEvent);
      // v11.26 — the report REACHED the sink. If the send above throws, this
      // stays false and the finally safety net performs a raw last-ditch send.
      reportDelivered = true;
      // v11.11 (A3) — AUTO-OPEN LIVE PREVIEW (the founder's #1 demand: any
      // build, in any language, must SHOW itself). If the run created/modified
      // runnable-looking files, emit the EXISTING `preview_open` event with a
      // `previewHint` describing WHAT to preview; the renderer turns it into
      // an auto-start request. Pure Q&A turns (no writes) never open it, and
      // the taskReportSent guard above makes this fire at most once per run.
      if (touchedFiles.size > 0) {
        type PreviewHint = NonNullable<Extract<AgentEvent, { type: 'preview_open' }>['previewHint']>;
        const rels = [...touchedFiles].map((f) => f.replace(/\\/g, '/'));
        const has = (re: RegExp): boolean => rels.some((f) => re.test(f));
        const hint: PreviewHint | null = (() => {
          if (has(/(^|\/)package\.json$/)) return { kind: 'dev', runtime: 'npm', label: 'dev server' };
          if (has(/(^|\/)go\.mod$/)) return { kind: 'dev', runtime: 'go', label: 'go run .' };
          if (has(/(^|\/)(manage|app|main|server|run)\.py$/i) || has(/(^|\/)requirements\.txt$/i))
            return { kind: 'dev', runtime: 'python' };
          if (has(/(^|\/)index\.html$/i)) return { kind: 'static', label: 'index.html' };
          const art = [...touchedFiles]
            .reverse()
            .find((f) => /\.(pdf|png|jpe?g|gif|webp|svg|bmp|ico|md|markdown|txt|json|csv|xml|mp4|webm|mp3|wav|ogg)$/i.test(f));
          if (art) {
            const abs = path.isAbsolute(art) ? art : path.resolve(workspace, art);
            return { kind: 'artifact' as const, dir: abs, label: path.basename(abs) };
          }
          // any other runnable-looking code → static folder preview (listing)
          if (has(/\.(html?|css|js|mjs|cjs|jsx|ts|tsx|py|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|rb|sh|vue|svelte)$/i))
            return { kind: 'static', label: 'workspace folder' };
          return null;
        })();
        if (hint) {
          ioB.send({ type: 'preview_open', ws: workspace, previewHint: hint } as AgentEvent);
          // v11.11 (A4-CLOSURE) — the auto-open decision is journaled too (the
          // postmortem trail answers "why did/didn't the preview open").
          journalEvent(journalFile, { type: 'preview_open', hint: hint.kind, ws: workspace });
        }
      }
      // v11.11 (A4-CLOSURE) — the report is ALSO JOURNALED: a run that ends
      // while the UI is gone (renderer closed, session switch) still leaves
      // a durable, structured record on disk. Same payload, same moment.
      journalEvent(journalFile, {
        type: 'task_report',
        outcome: o.outcome,
        ...(o.stopReason ? { stopReason: o.stopReason } : {}),
        files: files.length,
        commands: cmds.length,
        ...(verifyCmd ? { howToRun: verifyCmd } : {}),
        summary: summary.slice(0, 200),
        durationMs: Math.max(0, Date.now() - runStartedAt),
      });
    } catch {
      /* the completion report must never break the run */
    }
  };

  // v11.11 (A4-CLOSURE) — turn_end is GUARANTEED too. The founder's freeze
  // was "ended silently": the renderer clears its streaming state ONLY on
  // turn_end / aborted / error — a run that dies between its report and its
  // turn_end would leave the UI hung. One guarded, idempotent sender; every
  // terminal path below uses it, and the try/finally at the end of the run
  // fires it even when the catch block itself is blown through.
  let turnEnded = false;
  /** v11.26 — did a turn_end actually REACH the sink (not merely attempted)? */
  let turnEndDelivered = false;
  const sendTurnEnd = (): void => {
    if (turnEnded) return;
    turnEnded = true;
    try {
      ioB.send({ type: 'turn_end' });
      turnEndDelivered = true;
    } catch {
      /* batched send failed — try the raw fallback below */
    }
    // v11.26 (CONTINUITY) — last-ditch RAW turn_end. The renderer clears its
    // streaming state ONLY on this event; a broken batcher must never leave
    // the UI hung. Emitted only when the batched send did not get through.
    if (!turnEndDelivered) {
      try {
        io.send({ type: 'turn_end' });
        turnEndDelivered = true;
      } catch {
        /* the channel is truly dead — nothing further can be delivered */
      }
    }
    // v11.23 — close the sink AFTER turn_end is delivered. Every later
    // ioB.send (fire-and-forget hooks / learners / Run & Show / skill writes)
    // is dropped, so no stale row can ever appear after the run is over.
    sinkClosed = true;
  };

  // v3.1 — machine capability summary (computed inside the try, captured for
  // agentLoop's refusal-recovery nudges; '' on failure — never blocks a run).
  let envSummary = '';
  // v9 — run journal handle, declared ONCE in the run function: the tool-exec
  // loop below (agentLoop → execPrepared) journals every tool outcome through it.
  let journalFile: string | null = null;
  // v11.9 (E18) — THINKING DURATION for the run: set when the FIRST think_delta
  // arrives, closed when the FIRST answer text_delta arrives after thinking (or
  // at turn end). Reported as `thinkMs` (finite integer, 0 if none) on the final
  // message_end; renderer-side consumers handle the rest.
  let thinkingStartedAt = 0;
  let thinkingEndedAt = 0;

  try {
    // ---------- 1. credentials + memory ----------
    creds = resolveCredentials(params, settingsSnapshot);

    // Fail fast with a CLEAR message instead of a doomed unauthenticated HTTP
    // call (this used to surface as a raw provider 401 like "Invalid API key").
    // v11.21 — from the single run-start settings snapshot (was another
    // getSettings() disk read on the first-token path).
    const lang = settingsSnapshot.language;

    // v11.10 (A4) — REAL slash dispatch (main-process side). The renderer
    // handles its UI-only commands; anything that still reaches the ENGINE as
    // a '/'-message is executed HERE — never echoed to the model:
    //   · /build /plan /debug /review → session task-mode switch (persists in
    //     sessionTaskModes; IPC kdx:agent:task-mode overrides it later), run
    //     ends locally with the notice;
    //   · custom markdown commands → expanded in place ($ARGUMENTS/$1..$9);
    //   · unknown → friendly local notice, run ends (v11.9 E19 semantics,
    //     restored at the engine layer for every client).
    // Dispatch only fires when the LAST transcript row is the user's '/'-text
    // (a run is triggered by the final message — synthetic assistant rows
    // after /review, /commit etc. never re-trigger an old command).
    if (params.task === 'chat') {
      const msgs = params.messages ?? [];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'user' && String(last.content ?? '').trim().startsWith('/')) {
        const dispatch = await slash.dispatchSlashCommand({ raw: String(last.content ?? ''), workspace });
        if (dispatch.kind === 'task-mode' && dispatch.taskMode) {
          setSessionTaskMode(params.sessionId, dispatch.taskMode);
          notice('mode', `\n[/slash] ${dispatch.notice ?? ''}\n`);
          // v11.12 (A4-GUARANTEE) — keep the renderer's strip in sync: the map
          // alone is invisible, and with run-params precedence the strip MUST
          // show the mode the slash command just set or the next run overrides it.
          ioB.send({ type: 'task_mode', taskMode: dispatch.taskMode } as AgentEvent);
          trace.finish({ ok: true, turns: 0, tools: 0 });
          clearRunGates(params.sessionId);
          emitTaskReport({ outcome: 'completed', note: `Task mode switched to ${dispatch.taskMode} — nothing to build in this turn.` });
          sendTurnEnd();
          return;
        }
        if (dispatch.kind === 'unknown') {
          notice('sys', `\n[/slash] ${dispatch.notice ?? ''}\n`);
          trace.finish({ ok: true, turns: 0, tools: 0 });
          clearRunGates(params.sessionId);
          emitTaskReport({ outcome: 'completed', note: `Slash command not recognized — nothing ran. ${String(dispatch.notice ?? '').trim().slice(0, 200)}` });
          sendTurnEnd();
          return;
        }
        if (dispatch.kind === 'custom' && dispatch.expanded && dispatch.expanded.trim()) {
          // The model receives the expanded body; the transcript keeps the
          // short command the user actually typed (renderer displayAs parity).
          const chat = [...msgs];
          chat[msgs.length - 1] = { ...last, content: dispatch.expanded };
          params = { ...params, messages: chat };
        }
      }
    }
    if (!creds.apiKey && KEY_REQUIRED_PROVIDERS.has(params.model.provider)) {
      const en = `No API key for "${params.model.provider}". Open Settings → AI providers, paste your ${params.model.provider} key, then retry.`;
      const ar = `لا يوجد مفتاح API للمزود "${params.model.provider}". افتح الإعدادات ← مزودو الذكاء الاصطناعي والصق مفتاحك ثم أعد المحاولة.`;
      // v11.23 (P0) — the terminal report carries the EXACT same localized
      // string as the error row (no separate EN-only note beside an AR row).
      const noKeyMsg = lang === 'ar' ? ar : en;
      sendError(noKeyMsg);
      emitTaskReport({ outcome: 'error', note: noKeyMsg });
      sendTurnEnd();
      return;
    }

    // v11.21 — from the snapshot (removed an await + dynamic import on the
    // first-token path).
    checkpointsEnabled = settingsSnapshot.checkpointsEnabled !== false;

    // v1.5 long-run safety: a checkpoint BEFORE this turn when the previous
    // turn of this session ended in file writes (Claude-Code-style per-turn
    // rewind coverage — zero cost for read-only turns).
    if (params.task === 'chat' && checkpointsEnabled && lastRunWrote.get(params.sessionId)) {
      try {
        await checkpoints.create(workspace, 'before-turn');
      } catch {
        /* best-effort */
      }
    }
    lastRunWrote.set(params.sessionId, false);

    // Memory = global user memory (settings) + workspace memory files.
    // v1.5: AGENTS.md / KODEX.md are honored alongside MEMORY.md so repos
    // written for Claude Code / Codex conventions just work.
    const parts: string[] = [];
    const globalMemory = (params.memory ?? '').trim();
    if (globalMemory) parts.push(globalMemory.slice(0, MEMORY_CAP));
    let memTotal = parts.reduce((a, p) => a + p.length, 0);
    for (const name of ['AGENTS.md', 'KODEX.md', 'MEMORY.md'] as const) {
      if (memTotal >= MEMORY_CAP * 2) break;
      try {
        // v11.21 — synchronous read of a tiny local file. The old three
        // `await fs.readFile` hops put three event-loop turns on the
        // first-token path for no benefit; these files are ≤MEMORY_CAP chars.
        const text = fsSync.readFileSync(path.join(workspace, name), 'utf8').trim();
        if (text && !parts.some((p) => p === text)) {
          const wrapped = `[${name}]\n${text.slice(0, MEMORY_CAP)}`;
          parts.push(wrapped);
          memTotal += wrapped.length; // v3.1 — count the wrapper too (was under-counting)
        }
      } catch {
        /* no such memory file — fine */
      }
    }
    const memory = parts.join('\n\n');

    // ---------- 2b. machine capability summary (v3.1) ----------
    // Injected into the system prompt so the model KNOWS which runtimes exist
    // (node/python/cargo/go/java…) and installs what's missing instead of
    // refusing — one of the root causes of "I can't" answers.
    // v11.24 (FIRST-TOKEN LATENCY — P0) — machineCapabilitySummaryNow() looks
    // "zero-spawn" but its fire-and-forget probe executes SYNCHRONOUSLY up to
    // its first await: `require('node:sqlite')` loads a native module (~5s cold
    // on Windows) and it then launches 21 `versionOf` child processes. Measured
    // in this tree it blocked the event loop for 4.8s on EVERY cold run, before
    // the provider request was even issued — the "AI takes forever to reply"
    // complaint. Keep a zero-cost static hint for THIS turn's prompt (the model
    // still sees a machine-capabilities section) and run the full probe only
    // AFTER the run's terminal events, warming the module cache for next turn.
    envSummary =
      `os: ${process.platform} ${process.arch}  node: ${process.version}\n` +
      '(a full runtime probe is available on demand via env_probe — the complete capability list joins the conversation when you need it)';

    // ---------- 2. MCP discovery (NON-BLOCKING since v11.21) ----------
    // Started at the very top of runAgent (see enabledMcp there) and consumed
    // below by getToolDefs/buildSystemPrompt. NO await here: a cold MCP server
    // can take the full 3s cap, which must never delay the first token. Warm
    // pooled clients finish before we get here and are included normally.
    // v3.1 — remote (http/sse) servers are included too (url OR command).

    // ---------- 3. transcript normalization ----------
    const messages = await toProviderMessages(params.messages ?? [], workspace);
    if (params.task === 'init') messages.unshift({ role: 'user', text: INIT_PROMPT });

    // ---------- 3a. drain queued user messages (sent while no run was active) ----------
    // Messages enqueued between runs are prepended as user messages at the next
    // runAgent call; the same queue is also drained at every turn boundary below.
    if (params.task === 'chat') {
      const drained = drainSessionQueue(params.sessionId);
      for (let i = drained.length - 1; i >= 0; i--) {
        messages.unshift({ role: 'user', text: queueItemText(drained[i]) });
      }
      if (drained.length) ioB.send({ type: 'queued_count', n: 0 });
    }

    if (!messages.length) messages.push({ role: 'user', text: 'Hello.' });

    // ---------- 3b. custom slash commands (/name args from .surnia/commands) ----------
    if (params.task === 'chat' && messages.length) {
      const last = messages[messages.length - 1];
      if (last.role === 'user' && last.text.trim().startsWith('/')) {
        // v11.9 (E19) — the lookahead rejects PATH-LIKE text ("/usr/local/bin…")
        // so only genuine command invocations ("/name", "/name args") enter
        // the command path.
        const m = /^\/([a-z0-9][a-z0-9_-]*)(?![/\w-])(?:\s+([\s\S]*))?$/.exec(last.text.trim());
        if (m) {
          let expanded = false;
          try {
            const cmd = slash.listSlashCommands(workspace).find((c) => c.name === m[1]);
            if (cmd) {
              const body = await slash.loadCommandBody(cmd);
              if (body.trim()) {
                last.text = slash.expandCommand(body, m[2] ?? '') + `\n\n[custom command: /${m[1]}]`;
                expanded = true;
              }
            }
          } catch {
            /* command expansion failed — treated as unknown below */
          }
          // v11.9 (E19) — UNKNOWN slash commands are NOT model prompts: the raw
          // "/xyz …" text used to fall through and the model answered it with
          // "weird replies". No matching command file → friendly local notice
          // and a no-op end: no model call, no tool use, zero usage.
          if (!expanded) {
            notice(
              'cmd',
              lang === 'ar'
                ? `أمر غير معروف '/${m[1]}' — جرّب /help لعرض الأوامر المتاحة.`
                : `Unknown command '/${m[1]}' — try /help to list available commands.`,
            );
            ioB.send({ type: 'message_end', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, stopReason: 'end_turn' });
            emitTaskReport({ outcome: 'completed', note: `Unknown command '/${m[1]}' — try /help to list available commands. Nothing ran.` });
            sendTurnEnd();
            return;
          }
        }
      }
    }

    // ---------- 3c. active goal injection (/goal loop) ----------
    // A session goal keeps the model working autonomously: it is injected into
    // the turn context, re-attached to every continuation round, and completed
    // via the GOAL_COMPLETE marker convention (checked in the final events).
    const activeGoal = params.task === 'chat' ? sessionGoals.get(params.sessionId) : undefined;
    if (activeGoal) {
      messages.push({
        role: 'user',
        text:
          `[active goal] ${activeGoal.goal}\n` +
          'Work autonomously toward this goal turn after turn until it is FULLY met — do not stop to ask unless ' +
          'genuinely blocked. Plan and track the work with todo_write. When every part of the goal is done and ' +
          `verified, end your final message with the exact marker ${GOAL_MARKER} on its own line.`,
      });
    }

    // ---------- 4. compact task: single no-tools model call ----------
    if (params.task === 'compact') {
      if (!messages.length) {
        ioB.send({ type: 'compaction_done', summary: '' });
        emitTaskReport({ outcome: 'completed', note: 'Nothing to compact.' });
        sendTurnEnd();
        return;
      }
      let summary = '';
      // v7.2 — `context` role routing: compaction runs on the explicitly
      // configured context model when one is set (cheap/fast summarizer),
      // else the session model as before.
      const ctxRole = resolveRoleModel('context', fullSettings(), params.model);
      const ctxExplicit = ctxRole.reason.startsWith('explicit');
      const res = await streamTurn({
        model: ctxExplicit ? ctxRole.model : params.model,
        apiKey: (ctxExplicit ? ctxRole.apiKey : undefined) ?? creds.apiKey,
        baseUrl: (ctxExplicit ? ctxRole.baseUrl : undefined) ?? creds.baseUrl,
        system: COMPACT_SYSTEM,
        // v11.35 (C6) — fold byte-identical tool-result blobs before the request.
        // Pure + capability-neutral: the original `messages` array is untouched,
        // every callId/role/order is preserved and the FIRST full copy survives.
        messages: dedupeToolResults(messages),
        tools: [],
        signal,
        onText: (t) => {
          summary += t;
        },
        onToolUse: () => {
          /* no tools in play */
        },
      });
      if (res.stopReason === 'error') throw new Error('Compaction stream error.');
      ioB.send({ type: 'compaction_done', summary: summary.slice(0, 40_000) });
      emitTaskReport({ outcome: 'completed', note: 'Conversation compacted into a structured summary.', finalText: summary });
      sendTurnEnd();
      return;
    }

    // ---------- 5. hooks + prompt + tool defs + contexts ----------
    // v11.24 — the bounded config load was STARTED at run start (see
    // hooksCfgPromise) so its disk read overlaps the earlier setup; awaiting it
    // here is now a microtask when the config is warm. Same empty-config
    // fallback, same 500ms cap, no behavior change.
    const hooksCfg: HooksConfig = await hooksCfgPromise;
    // v12 (HOOKS) — full lifecycle. Every hook is best-effort and NEVER blocks
    // the run; its stdout (if any) surfaces as a quiet sys_notice.
    const fireLifecycle = async (
      run: () => Promise<{ context?: string; requestStop?: boolean }>,
      kind: string,
    ): Promise<void> => {
      try {
        const r = await run();
        if (r?.context) notice(kind, r.context);
      } catch {
        /* a broken hook never breaks a run */
      }
    };
    // v11.21 — FIRE-AND-FORGET with a hard cap: user/session-start hooks are
    // advisory context, never a first-token gate. Their notices (if any)
    // arrive quietly when they finish; tool-stage hooks below are untouched.
    void withTimeout(
      fireLifecycle(
        () => runSessionStartHooks(hooksCfg, workspace, params.sessionId, { task: params.task?.slice(0, 4000) }),
        'hook:session-start',
      ),
      CONTEXT_LOAD_TIMEOUT_MS,
      'session-start hook',
    ).catch(() => { /* a hook must never break the run */ });
    void withTimeout(
      fireLifecycle(
        () => runUserPromptHooks(hooksCfg, workspace, params.sessionId, originalTaskText([], params.messages) || params.task || ''),
        'hook:prompt',
      ),
      CONTEXT_LOAD_TIMEOUT_MS,
      'user-prompt hook',
    ).catch(() => { /* a hook must never break the run */ });
    // v11.35 (A2) TOOL PROFILE = A PER-TURN VIEW, NEVER A GATE.
    // salientToolProfile: a STRONG model (Claude 5.5 / GPT-5 / Gemini 2.5 Pro …)
    // sees the FULL 145-tool surface; a weak/local default gets the focused
    // 'core' view; an explicit setting (including 'full') always wins. Provider
    // -native tools (getProviderToolDefs: web_search / computer_use / unknown
    // extras) are APPENDED to the advertised defs, so nothing offered by the
    // model/provider is invisible. NO executor is removed and NO call is
    // refused: dispatch resolves the FULL registry regardless of this view.
    const advertisedProfile: ToolProfileId = salientToolProfile(cfg.toolProfile, params.model.model);
    const toolDefs = [...getToolDefs(enabledMcp, advertisedProfile), ...getProviderToolDefs()];
    // v2.1 — SKILLS index (workspace .surnia/skills) injected when skills exist.
    // v1143 — the v2.2 TRUST GATE no longer suppresses ADVERTISING: a skill the
    // user adds in the Skills panel is user-controlled, so it is listed in the
    // next system prompt even without `.surnia/skills-trusted`. Trust/quarantine
    // now gate only the optional HARNESS body auto-injection (see below).
    // v11.31 — SELECTIVE matching remains, but its role changed: the FULL index
    // is advertised unconditionally, while the task-matched index is the
    // candidate whitelist for the ONE soft-injected skill. Prefer the last
    // genuine user message (the live ask, incl. follow-ups); skip engine
    // synthetic notes ('[system]' / '[steered]' / '[user, …]') and slash text;
    // fall back to the session's original task — NEVER the task KIND ('chat').
    const skillsTaskText: string = (() => {
      const msgs = params.messages ?? [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (!m || m.role !== 'user') continue;
        const t = String((m as { content?: unknown }).content ?? '').trim();
        if (!t || t.startsWith('[') || t.startsWith('/')) continue;
        return t.slice(0, 4000);
      }
      return originalTaskText([], params.messages) || '';
    })();
    let skillsIndex = '';
    let autoSkillInjection: AutoSkillInjection | null = null;
    try {
      const hasSkillsDir = (() => {
        try {
          return fsSync.statSync(path.join(workspace, '.surnia', 'skills')).isDirectory();
        } catch {
          return false;
        }
      })();
      const trust = skillsTrustSetting();
      const trusted = hasSkillsDir ? (dna.workspaceSkillsTrusted(workspace) || trust === 'always') : true;
      // v1143 (FOUNDER, THE REAL FIX) — the trust gate NEVER hides the skill
      // INDEX again. A skill the user adds in the Skills panel is user-controlled
      // even when it lands in the workspace scope; hiding it until an obscure
      // `.surnia/skills-trusted` marker exists is exactly why "I add a skill and
      // the AI never uses it" kept happening. Advertising a name + description +
      // loadable slug is harmless: quarantined (poison-scanned) skills are still
      // excluded inside skillsIndexLine(). We also DROP the old task filter on
      // the INDEX so EVERY user-added skill is in the next system prompt —
      // task relevance is used only to pick the soft-injected body below.
      // v11.23 — bounded local scan; run_start was already sent at the top of
      // runAgent, so this can NEVER hold the first token. 15s bound as before.
      skillsIndex = await withTimeout(
        skillsIndexLine(workspace),
        15_000,
        'skills index',
      ).catch(() => '');
      // v11.31/v1123 — the SELECTIVE task-matched index is still computed
      // (bounded at 15s), but its role changed in v1143: it is no longer a gate
      // on ADVERTISING (the full index above does that unconditionally); it is
      // the honest candidate whitelist for the single SOFT-INJECTED skill.
      const matchedSkillsIndex = await withTimeout(
        skillsIndexLine(workspace, skillsTaskText),
        15_000,
        'task-matched skills index',
      ).catch(() => '');
      // v1143 — SOFT injection of the single most relevant USER skill. The
      // trust setting now governs ONLY this body auto-injection: 'never' opts
      // out of WORKSPACE-scope bodies (repo-sourced skills stay opt-in), while
      // GLOBAL skills (installed by the user) always qualify. Default 'ask'
      // injects the user's own skill so it is actually followed. This is an
      // explicit harness action, labelled as such in the prompt — never a claim
      // that the model called use_skill.
      autoSkillInjection = await buildAutoSkillInjection(
        workspace,
        skillsTaskText,
        trust !== 'never',
        matchedSkillsIndex,
      );
      // Keep the one-time honest consent event for repo workspace skills; it is
      // no longer a suppression switch (the index is always advertised).
      if (hasSkillsDir && !trusted && !skillsTrustNudged.has(workspace)) {
        skillsTrustNudged.add(workspace);
        dna.emitDNAEvent('skills-trust', { workspace });
        try {
          console.warn(`[agent] workspace skills are advertised but not marked trusted for ${workspace} (create .surnia/skills-trusted or call kdx:skills:trust to allow repo skills as harness-injected bodies)`);
        } catch {
          /* logging is best-effort */
        }
      }
    } catch {
      /* trust gate must never break the run */
      skillsIndex = '';
    }
    // v2.2 — Surnia DNA: render the learned user model into the prompt
    // (empty model → section omitted entirely, prompt cache stays stable).
    // v11.21 — these are SYNCHRONOUS sub-millisecond local JSON reads with no
    // await, so they never delay the first token (unlike the old await chain).
    let dnaPrompt = '';
    if (dnaEnabledSetting()) {
      try {
        dnaPrompt = dna.renderDNAPrompt(dna.loadDNA(workspace));
      } catch {
        dnaPrompt = '';
      }
    }
    // v11.12 — Living Playbook: inject this workspace's learned field guide
    // into the next run's system prompt. Empty → section omitted (cache-stable).
    let playbookPrompt = '';
    try {
      playbookPrompt = playbook.renderPlaybookPrompt(playbook.loadPlaybook(workspace));
    } catch {
      playbookPrompt = '';
    }
    const baseSystem = buildSystemPrompt({
      workspace,
      mode,
      memory,
      platform: process.platform,
      language: lang === 'ar' ? 'ar' : 'en',
      effort: cfg.effort === 'deep' ? 'deep' : 'standard',
      taskMode,
      dna: dnaPrompt || undefined,
      playbook: playbookPrompt || undefined,
      // v11.38 (F11) — the founder's saved prompts actually reach the model now.
      savedPrompts: (() => { try { return promptsForModel(); } catch { return []; } })(),
      // v2.3 — models routed through custom / OpenRouter / Ollama endpoints
      // get the ```surnia-tool text fallback (their function calling is often
      // missing or broken — this is the #1 "AI says it can't" root cause).
      textToolProtocol:
        params.model.provider === 'custom' || params.model.provider === 'openrouter' || params.model.provider === 'ollama',
      skills: skillsIndex
        ? skillsIndex
            .split('\n')
            .map((l) => l.replace(/^-\s*/, ''))
            .filter(Boolean)
            .map((l) => {
              const m = /^(.+?)\s+\(([^)]+)\)\s+—\s+(.*)$/.exec(l);
              return m ? { name: m[1], description: m[3] } : { name: l, description: '' };
            })
        : undefined,
      // v1143 — the harness soft-injection (labelled honestly in prompts.ts).
      injectedSkill: autoSkillInjection
        ? {
            name: autoSkillInjection.name,
            slug: autoSkillInjection.slug,
            body: autoSkillInjection.body,
            reason: autoSkillInjection.reason,
          }
        : undefined,
      mcpTools: enabledMcp.flatMap(({ server, tools }) =>
        // v3.1 — advertise the SLUGGED names (exactly what getToolDefs emits and
        // what the model must call); the raw-name drift used to confuse models.
        tools.map((t) => `mcp__${slugMcpName(server.name)}__${slugMcpName(t.name)}${t.description ? ` — ${t.description}` : ''}`),
      ),
      envSummary: envSummary || undefined,
    });
    // v7 — model-family profile: per-family prompt guidance appended to the
    // system prompt (GLM/DeepSeek get strict-JSON + verbatim-copy coaching;
    // local models get the fallback protocol up front).
    const familyProfile = profileFor(params.model);
    const system = familyProfile.promptAddendum ? `${baseSystem}\n\n${familyProfile.promptAddendum}` : baseSystem;
    // v1143 — HONEST harness notice: the body was injected by the harness, NOT
    // by a model use_skill call. The renderer gets a real event; the run never
    // claims the model "used" a tool it did not call.
    if (autoSkillInjection) {
      try {
        ioB.send({
          type: 'sys_notice',
          kind: 'skill:auto-injected',
          text: `HARNESS (not the model) injected user skill "${autoSkillInjection.name}" (slug: ${autoSkillInjection.slug}) into the system prompt — ${autoSkillInjection.reason}. The model has NOT called use_skill for it yet.`,
        });
      } catch {
        /* notice is best-effort */
      }
    }

    // v11.32 (MCP OPT-IN) — the user's REAL words this session, plus the only
    // setting that may pre-authorize MCP. No such setting ships today, so it
    // defaults OFF: an unprompted MCP call always needs a per-call decision,
    // even when the permission mode is fullAccess.
    const mcpUserText = allUserText(params.messages);
    const mcpAutoUseSetting = (): boolean =>
      (settingsSnapshot as unknown as Record<string, unknown>).mcpAutoUse === true;

    async function gate(
      req: { kind: ApprovalKind; title: string; detail: string; payload: ApprovalPayload; force?: boolean },
      subagent: boolean,
    ): Promise<boolean> {
      const kind = req.kind;
      // v2.2 — permission-plan mode: mutating commands are denied with the
      // plan-first reason (the denyHint on the ToolContext carries the
      // model-facing text; the denial here is harness-enforced for
      // EVERYTHING in plan mode).
      if (currentMode() === 'plan') return false;
      // v11.10 (A4) — task-mode read-only postures, driven by the
      // TASK_MODE_SPECS registry (single source of truth in prompts.ts):
      // 'plan' and 'review' are HARD read-only EVEN when the permission mode
      // would auto-approve — writes/deletes are denied, mutating commands are
      // classified and hard-denied, annotated-destructive MCP tools are
      // denied. Every denial is user-visible so the posture is obvious.
      // Plan keeps exactly ONE sanctioned write: plan.md in the workspace
      // root (the plan protocol tells the model to publish its plan there).
      if (taskMode !== 'build' && TASK_MODE_SPECS[taskMode].readOnly) {
        if (kind === 'write' || kind === 'delete') {
          const sanctionedPlanFile =
            taskMode === 'plan' &&
            kind === 'write' &&
            !!req.payload.path &&
            path.resolve(req.payload.path) === path.resolve(workspace, 'plan.md');
          if (!sanctionedPlanFile) {
            notice(taskMode, `\n[${taskMode} mode is read-only: ${kind} denied — ${String(req.payload.path ?? req.title).replace(/\s+/g, ' ').slice(0, 120)}]\n`);
            return false;
          }
        }
        if (kind === 'command' && isMutatingCommand(req.payload.command ?? '')) {
          notice(taskMode, `\n[${taskMode} mode is read-only: command mutates state — ${String(req.payload.command ?? '').replace(/\s+/g, ' ').slice(0, 120)}]\n`);
          return false;
        }
        if (kind === 'mcp' && req.payload.destructive === true) {
          notice(taskMode, `\n[${taskMode} mode is read-only: destructive tool denied — ${String(req.payload.toolName ?? '')}]\n`);
          return false;
        }
      }
      // v2.1 — doom-loop decision pathway (never persisted as an "always" rule;
      // the session-level decision map below owns the semantics).
      if (kind === 'doom_loop') {
        // v11.16: in fullAccess/fullApproval, a doom-loop is an advisory
        // notice, NOT a blocking card — the founder has full approval and
        // still saw cards. Auto-proceed without asking (plan mode still asks).
        if (shouldAutoApprove(currentMode(), kind, req as ApprovalRequestLike)) {
          notice(taskMode, '\n[full-access: continuing past a detected loop without asking.]\n');
          sessionDoomDecisions.set(params.sessionId, 'proceed');
          return true;
        }
        const requestId = randomUUID();
        ioB.send({ type: 'approval_request', requestId, kind, title: req.title, detail: req.detail, payload: req.payload });
        const decision = await io.getDecision(requestId);
        // v6 — only explicit allow-family actions proceed the doom loop;
        // deny/never/timeout all stop it.
        const proceed =
          !!decision &&
          (decision.action === 'allow' ||
            decision.action === 'always' ||
            decision.action === 'always_session' ||
            decision.action === 'always_project');
        sessionDoomDecisions.set(params.sessionId, proceed ? 'proceed' : 'stop');
        return proceed;
      }
      const ruleKey =
        kind === 'command'
          ? commandRuleKey(req.payload.command ?? '')
          : kind === 'mcp'
            ? 'mcp:' + String(req.payload.toolName ?? '')
            : kind;
      // v6 — DENY rules beat everything (including persisted allow rules):
      // a scope-broadened "always reject" wins over a matching allow rule.
      if (denyRules!.has(ruleKey)) return false;
      if (ruleAllows(rules!, ruleKey)) return true;
      // v11.32 (MCP OPT-IN) — REAL gate at MCP-call dispatch. A persisted "always"
      // rule above is explicit prior consent and still wins. Otherwise, if the
      // user never named this MCP server/tool and the task doesn't require it,
      // MCP is NOT silently allowed: emit a visible notice and force a per-call
      // approval decision. Crucially, fullAccess alone does NOT opt MCP in.
      const mcpVerdict =
        kind === 'mcp'
          ? mcpOptInVerdict(mcpUserText, String(req.payload.toolName ?? ''), enabledMcp, mcpAutoUseSetting())
          : null;
      const mcpNeedsApproval = kind === 'mcp' && !!mcpVerdict && !mcpVerdict.optedIn;
      if (mcpNeedsApproval) {
        const label = mcpVerdict!.server
          ? `${mcpVerdict!.server}${mcpVerdict!.tool ? ' → ' + mcpVerdict!.tool : ''}`
          : String(req.payload.toolName ?? 'MCP tool');
        notice(
          'mcp',
          `\n[MCP opt-in] An MCP tool (${label}) was invoked without an explicit request. ` +
            "You called an MCP tool the user didn't ask for — confirm it's necessary or use the 145 core tools instead. " +
            'Approval is required; full-access mode never auto-approves MCP.\n',
        );
      }
      // v2.1 — req.force (risk classifier: danger commands) bypasses MODE-based
      // auto-approval; an explicit "always" rule above still wins.
      // v11.15: honor full-access/full-approval as a whole-run contract even
      // when `force` is set — that was why "full access" still asked (code 3240
      // and approval cards both traced to this gate). plan/read still ask.
      // v11.32 — MCP is the ONE exception: an unprompted call is never
      // auto-approved by mode alone; it must pass the per-call card above.
      const autoAllowed = !mcpNeedsApproval && shouldAutoApprove(currentMode(), kind, req as ApprovalRequestLike);
      if (autoAllowed) {
        writesThisRun = kind === 'write' || writesThisRun;
        // Auto-approved writes still get a one-time rollback checkpoint
        // (checkpointsEnabled is honored; best-effort, never blocks).
        if (kind === 'write' && !checkpointDone && checkpointsEnabled) {
          checkpointDone = true;
          try {
            await checkpoints.create(workspace, 'before-agent-edit', params.sessionId);
          } catch {
            /* best-effort */
          }
        }
        return true;
      }

      // Build UI-facing title/detail (diff for writes).
      let title = (subagent ? '[subagent] ' : '') + req.title;
      let detail = req.detail;
      if (kind === 'write') {
        const rel = req.payload.path
          ? path.relative(workspace, req.payload.path) || req.payload.path
          : '(unknown)';
        try {
          detail = createTwoFilesPatch(
            'a/' + rel,
            'b/' + rel,
            req.payload.oldText ?? '',
            req.payload.newText ?? '',
            undefined,
            undefined,
            { context: 3 },
          );
        } catch {
          /* diff failed — fall back to the tool-provided detail */
        }
        if (detail.length > DIFF_CAP) detail = detail.slice(0, DIFF_CAP) + '\n… [diff truncated]';
      }

      const requestId = randomUUID();
      ioB.send({ type: 'approval_request', requestId, kind, title, detail, payload: req.payload });
      const decision = await io.getDecision(requestId); // null (timeout/abort) → deny
      try {
        auditAppend('permission', { kind, title, action: decision?.action ?? 'deny' });
      } catch {
        /* audit is best-effort — never blocks the agent */
      }
      if (!decision || decision.action === 'deny') {
        // v2.3 — REWORKED DNA feedback capture. v2.2 recorded EVERY denial (and
        // even approval TIMEOUTS) as a "correction"; weaker models then read
        // those entries as bans and refused similar work — the #1 cause of
        // "why can't you do X? / because you disliked it". Now: only EXPLICIT
        // command denials count (a denied write usually means "not now" —
        // writes happen in every build), timeouts NEVER record, max ONE entry
        // per run, and the note text is explicitly advisory (see dna.ts).
        if (kind === 'command' && !!decision && dnaEnabledSetting() && denialsThisRun < 1) {
          denialsThisRun++;
          // v7.1 — corrections→rules: repeated user rejections become flow
          // suggestions (flowsService learns the shape; ≥3 similar → suggest).
          try {
            const { flowsRecordCorrection } = await import('../services/flowsService');
            flowsRecordCorrection('denied-command', String(req.payload.command ?? req.title));
          } catch {
            /* learning is silent */
          }
          try {
            void dna
              .recordFeedback(
                'correction',
                `User declined running "${String(req.payload.command ?? req.title).replace(/\s+/g, ' ').slice(0, 120)}" once — single event, may be routine review, NOT a standing rule`,
                'one-time denial',
              )
              .then(() => {
                dna.emitDNAEvent('updated', { reason: 'feedback' });
                ioB.send({ type: 'dna_updated', reason: 'feedback' });
              })
              .catch(() => {
                /* v11.12 (C2-SWALLOW) — the fire-and-forget chain now has a
                 * .catch: a rejection here used to escape unhandled. */
              });
          } catch {
            /* feedback capture is best-effort */
          }
        }
        return false;
      }
      // v6 — 6-way decisions. The card may return an EDITED rule scope in
      // decision.value (command kind only): the remembered pattern becomes
      // what the user typed, token-boundary prefix-matched from now on.
      const editedScope =
        kind === 'command' && typeof decision?.value === 'string' && decision.value.trim()
          ? commandRuleKey(decision.value.trim())
          : null;
      if (decision && (decision.action === 'never' || decision.action === 'never_always')) {
        denyRules!.add(ruleKey);
        try {
          persistDenyRule(
            workspace,
            editedScope ?? ruleKey,
            kind === 'command' ? String(req.payload.command ?? '') : String(req.payload.toolName ?? req.title),
          );
        } catch {
          /* persistence is best-effort */
        }
        return false;
      }
      if (decision && (decision.action === 'always' || decision.action === 'always_session' || decision.action === 'always_project')) {
        rules!.add(editedScope ?? ruleKey);
        // v2.2/v6 — persist for future sessions (always / always_project);
        // 'always_session' stays in-memory for this session only.
        if (decision.action !== 'always_session') {
          try {
            persistApprovalRule(
              workspace,
              editedScope ?? ruleKey,
              kind === 'command' ? String(req.payload.command ?? '') : String(req.payload.toolName ?? req.title),
            );
          } catch {
            /* persistence is best-effort */
          }
        }
      }

      writesThisRun = kind === 'write' || writesThisRun;

      // Checkpoint: once per run, before the FIRST allowed write takes effect.
      if (kind === 'write' && !checkpointDone) {
        checkpointDone = true;
        try {
          await checkpoints.create(workspace, 'before-agent-edit', params.sessionId);
        } catch {
          /* best-effort */
        }
      }
      return true;
    }

    function makeCtx(subagent: boolean, wsOverride?: string): ToolContext {
      return {
        workspace: wsOverride || workspace,
        sessionId: params.sessionId,
        // v11.31 (CANCELLATION) — the engine owns the run's AbortController but
        // never handed it to tools. tools.ts explicitly supports ctx.signal and
        // threads it into runCaptured / fetch (process-group kill on abort).
        // Without this, "Stop" aborted the fetches but left shell commands and
        // long HTTP probes running as orphans (and the child could write files
        // AFTER the run reported 'aborted'). Every tool now observes the same
        // signal the stream does — one cancel semantics for the whole run.
        signal,
        // v11.36 (FOLLOW-UP 3) — subagents get the SAME MCP execution context as
        // the main agent. The old `subagent ? [] : enabledMcp` left MCP tools
        // advertised but uncallable ("I don't have that tool"). Opt-in is still
        // enforced by the shared gate() below (Arabic/Latin explicit name counts).
        mcpServers: enabledMcp,
        emit: subagent
          ? () => {}
          : (e: AgentEvent) => {
              // /goal loop: derive progress from todo_write events.
              if (e.type === 'todo') trackGoalTodos(params.sessionId, e.todos);
              ioB.send(e);
            },
        approve: (req) => gate(req, subagent),
        runSubagent: subagent ? undefined : runSubagent,
        // v3.1 — ask_user: structured question; the decision value is the answer.
        askUser: subagent
          ? undefined
          : async (q) => {
              const requestId = randomUUID();
              ioB.send({
                type: 'approval_request',
                requestId,
                kind: 'question',
                title: 'Agent question',
                detail: q.question,
                payload: { choices: q.choices ?? [], allowText: q.allowText !== false },
              });
              const decision = await io.getDecision(requestId);
              if (!decision || decision.action === 'deny') return '';
              return decision.action === 'answer' ? String(decision.value ?? '') : decision.action === 'allow' ? (decision.value ?? '') : '';
            },
        // v3 — task(background:true) → fire-and-forget host over the SAME
        // active run (same model/tools/gate); completion arrives as
        // `background_done` (see runBackgroundSubagent).
        runSubagentBackground: subagent
          ? undefined
          : (agentId: SubagentId, description: string, prompt: string): void => {
              void runBackgroundSubagent(
                io,
                { workspace, sessionId: params.sessionId, mcpServers: enabledMcp },
                agentId,
                description,
                prompt,
              );
            },
        denyHint:
          currentMode() === 'plan'
            ? 'Plan mode is read-only until the plan is approved — present the plan (propose_plan) and wait; the user must approve it before any file/command changes happen (approve the plan first).'
            : TASK_MODE_SPECS[taskMode].denyHint,
        fullAccess: currentMode() === 'fullAccess',
        // v2.1 — plan approval contract: store + emit `plan_ready`.
        onPlan: subagent
          ? undefined
          : (plan: AgentPlan) => {
              planSubmittedThisRun = true;
              sessionPlans.set(params.sessionId, { plan, at: Date.now() });
              ioB.send({
                type: 'plan_ready',
                plan: planToText(plan),
                sessionId: params.sessionId,
                title: plan.title,
                steps: plan.steps,
                risks: plan.risks,
              });
            },
        // v2.1 — review_diff: self-review of the working diff (creds stay here).
        reviewDiff: subagent
          ? undefined
          : () =>
              reviewWorkingDiff(
                workspace,
                { model: params.model, apiKey: creds.apiKey, baseUrl: creds.baseUrl },
                { signal },
              ),
      };
    }

    async function runSubagent(agentId: SubagentId, description: string, prompt: string, opts?: { cwd?: string; background?: boolean }): Promise<string> {
      // v7.2 — ROLE ROUTING WIRING (the audit found resolveRoleModel imported
      // but NEVER called, leaving the plan/search/edit settings dead). Each
      // subagent family maps to a step role; an explicit role override in
      // settings.agent.modelRoles now ACTUALLY reroutes that subagent's loop
      // to the configured provider/model (+creds). Emitted as `role_route`
      // so the UI/settings card can show the routing live. No explicit
      // override → session model, unchanged behavior.
      const subRole: 'plan' | 'search' | 'edit' | null =
        agentId === 'spec' || agentId === 'architect' || agentId === 'docs'
          ? 'plan'
          : agentId === 'explore' || agentId === 'web-research'
            ? 'search'
            : agentId === 'implement' || agentId === 'refactor'
              ? 'edit'
              : null;
      const roleRes = subRole ? resolveRoleModel(subRole, fullSettings(), params.model) : null;
      const roleExplicit = !!roleRes && roleRes.reason.startsWith('explicit');
      if (roleRes && roleExplicit) {
        try {
          ioB.send({ type: 'role_route', role: String(subRole), agent: String(agentId), provider: roleRes.model.provider, model: roleRes.model.model, reason: roleRes.reason });
        } catch { /* event is best-effort */ }
      }
      const spec = getAgent(agentId);
      // v11.36 (FOLLOW-UP 3) — NO advertised-view filter. All 16 specialists
      // have tools === '*' and D1's subagentToolDefs() is the full 145 registry;
      // the old `d.name !== 'task' && d.name !== 'todo_write'` filter silently
      // withheld two capabilities from inline subagents even though dispatch
      // already resolves them. The founder demands EVERY capability, literally.
      // MCP tools are in toolDefs too (enabledMcp) and now execute via makeCtx.
      // Like D1's detached subagentToolDefs(), advertise the FULL core registry
      // regardless of the per-turn profile view (a weak-model hint, not a gate):
      // 145 core + MCP + provider-native tools, never a hidden task/todo_write.
      const subToolDefs: ToolDef[] = [
        ...getToolDefs(enabledMcp, 'full'),
        ...getProviderToolDefs(),
      ];
      // v2.1 — live subagent progress: each subagent gets an id so the UI can
      // show a progress bar driven by `subagent_progress` events.
      const subId = randomUUID();
      const maxIters = currentMode() === 'fullAccess' ? SUBAGENT_MAX_ITERATIONS * 2 : SUBAGENT_MAX_ITERATIONS;
      // v11.12 — DASHBOARD: register this subagent in the persistent ledger
      // BEFORE it starts so the Subagents panel shows it live from step 0.
      try {
        subagents.startSubagent({
          id: subId,
          label: spec.name,
          role: agentId,
          description,
          prompt,
          total: maxIters,
          workspace: opts?.cwd || workspace,
          sessionId: params.sessionId,
          background: opts?.background === true,
        });
      } catch {
        /* dashboard must never break the run */
      }
      // v11.20 (A10) — a REAL per-subagent wall-clock budget, shared with the
      // detached runner (SURNIA_SUBAGENT_TIMEOUT_MS, default 2min). A stuck
      // specialist can no longer hang the parent run with no result at all.
      const subTimeoutMs = subagentTimeoutMs();
      let subTimer: NodeJS.Timeout | null = null;
      const subTimeout = new Promise<never>((_resolve, reject) => {
        subTimer = setTimeout(
          () => reject(new Error(`subagent exceeded its ${subTimeoutMs}ms wall-clock budget`)),
          subTimeoutMs,
        );
        try {
          subTimer.unref?.();
        } catch {
          /* timers without unref are fine */
        }
      });
      let res: Awaited<ReturnType<typeof agentLoop>>;
      try {
        res = await Promise.race([
          agentLoop({
            system: `You are ${spec.name}, part of the Surnia agent team.\n${spec.prompt}\nCurrent workspace: ${opts?.cwd || workspace}`,
            messages: [{ role: 'user', text: `Task: ${description}\n\n${prompt}` }],
            tools: subToolDefs,
            ctx: makeCtx(true, opts?.cwd),
            maxIters,
            stream: false,
            hooks: hooksCfg,
            // Subagent transcripts are invisible (ctx.emit is a no-op) — the loop
            // piggybacks compact `⎿ [name i/N] step` progress lines on text_delta
            // so the user sees what each specialist is doing.
            progressLabel: spec.name.toLowerCase(),
            progressId: subId,
            // v7.2 — role routing: only when an EXPLICIT override exists (never
            // silently on the fallback path).
            modelOverride: roleExplicit ? roleRes!.model : undefined,
            credsOverride: roleExplicit ? { apiKey: roleRes!.apiKey, baseUrl: roleRes!.baseUrl } : undefined,
          }),
          subTimeout,
        ]);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        try {
          // v11.31 — flag genuine timeouts honestly (A08 exported the shared
          // classifier) so the dashboard never mislabels a timed-out child.
          subagents.failSubagent(subId, reason, {
            timedOut: subagents.isSubagentTimeoutMessage?.(reason) ?? /\btimed?\s*out\b|\btimeout\b/i.test(reason),
            retryHint: subagents.RETRY_HINT,
          });
        } catch {
          /* dashboard is best-effort */
        }
        // v11.20 — honest failure: the REAL reason plus a retry hint. Never a
        // vague "(subagent produced no output)" that hides a timeout/crash.
        return `(subagent failed: ${reason} — retry with a narrower prompt or fewer steps)`.slice(0, 12_000);
      } finally {
        if (subTimer) clearTimeout(subTimer);
      }
      const finalText = res.finalText.trim();
      const failureReason = res.aborted
        ? 'subagent was aborted'
        : res.stopReason === 'error'
          ? 'model stream ended with an error'
          : '';
      const summary = (
        finalText ||
        (failureReason
          ? `(subagent ${failureReason} — retry with a narrower prompt or fewer steps)`
          : '(subagent produced no output — retry with a narrower prompt or more explicit instructions)')
      ).slice(0, 12_000);
      try {
        if (res.aborted) subagents.abortSubagent(subId);
        else if (res.stopReason === 'error') subagents.failSubagent(subId, failureReason);
        else subagents.finishSubagent(subId, summary.slice(-600));
      } catch {
        /* dashboard must never break the run */
      }
      return summary;
    }

    // v2: register as this session's host for background subagents (the task
    // tool's background:true path reuses the inline runner). In-flight
    // background tasks keep their captured runner when this entry is deleted.
    activeSubagentRunners.set(params.sessionId, runSubagent);

    // ---------- 6. agent loop + long-run continuation ----------
    // v1.5: the ENGINE carries long tasks — when a round exhausts its step
    // budget the loop CONTINUES with a fresh budget, compacting as it goes.
    // v11.33 (ENDURANCE) — THE DEFAULT IS UNBOUNDED: no 30-round / 200-round
    // silent cap. Continuation is automatic and needs NO user re-ask; the only
    // terminal conditions are work-done, user abort, or genuine provider death.
    // A cap applies ONLY when EXPLICITLY requested by ops (env) or by the user's
    // own settings. agentTuningOverrides() injects a baseline 30 into cfg, so
    // the RAW setting is read here to tell "explicit user cap" from "default".
    const baseIters = Math.max(1, Math.floor(cfg.maxTurns ?? DEFAULT_MAX_TURNS));
    const effIters = cfg.effort === 'deep' ? baseIters * 2 : baseIters;
    const envRoundCap = maxContinueRounds(); // 0 = unbounded
    const rawUserRounds = settingsSnapshot.agent?.maxContinueRounds;
    const userRoundCap =
      typeof rawUserRounds === 'number' && Number.isFinite(rawUserRounds) && rawUserRounds > 0
        ? Math.floor(rawUserRounds)
        : 0;
    const roundCap = envRoundCap > 0 ? envRoundCap : userRoundCap;
    const maxRounds =
      cfg.continueAuto === false
        ? 1
        : roundCap === 0
          ? Number.POSITIVE_INFINITY
          : Math.max(1, Math.min(200, roundCap));
    // /goal loop: an explicit session goal overrides the continuation budget.
    const goalActive = params.task === 'chat' && sessionGoals.has(params.sessionId);
    // v5 — fullAccess / goal runs raised the old floor; with no cap there is no
    // floor to raise, and the GOAL_MARKER stop condition below still terminates.
    const effRounds =
      cfg.continueAuto === false
        ? 1
        : roundCap === 0
          ? Number.POSITIVE_INFINITY
          : goalActive
            ? Math.max(maxRounds, GOAL_CONTINUE_ROUNDS)
            : mode === 'fullAccess'
              ? Math.max(maxRounds, 60)
              : maxRounds;
    const goalStillActive = (): boolean => params.task === 'chat' && sessionGoals.has(params.sessionId);
    const startedAt = Date.now();
    // v9 — crash-resilient run journal: every tool outcome lands on disk as it happens.
    journalFile = startRunJournal(params.sessionId, params.task, workspace, electronUserDataDirSafe());

    let result = await runLoop({
      system,
      messages,
      tools: toolDefs,
      ctx: makeCtx(false),
      maxIters: effIters,
      stream: true,
      hooks: hooksCfg,
    });
    let totalUsage = { ...result.usage };
    // v11.12 (A4-REPORT) — capture by REFERENCE: addRunUsage mutates this object
    // in place, so the end-of-run task_report always reads the latest totals.
    runUsageRef = totalUsage;
    // v11.10 (A5) — RUN-TOTAL ACCUMULATOR: merges a continuation/fix/subagent
    // round's usage into the run totals INCLUDING the v11.10 ride-alongs (run
    // cache split + the per-attempt ledger), so message_end carries the honest
    // whole-turn billing picture across ALL rounds and providers.
    const addRunUsage = (delta: Usage): void => {
      totalUsage.inputTokens += delta.inputTokens;
      totalUsage.outputTokens += delta.outputTokens;
      totalUsage.costUsd += delta.costUsd;
      totalUsage.cacheReadTokens = Math.max(0, totalUsage.cacheReadTokens ?? 0) + Math.max(0, delta.cacheReadTokens ?? 0);
      totalUsage.cacheCreationTokens = Math.max(0, totalUsage.cacheCreationTokens ?? 0) + Math.max(0, delta.cacheCreationTokens ?? 0);
      totalUsage.runCacheRead = Math.max(0, totalUsage.runCacheRead ?? 0) + Math.max(0, delta.runCacheRead ?? 0);
      totalUsage.runCacheCreation = Math.max(0, totalUsage.runCacheCreation ?? 0) + Math.max(0, delta.runCacheCreation ?? 0);
      totalUsage.attempts = [...(totalUsage.attempts ?? []), ...(delta.attempts ?? [])];
    };

    let rounds = 0;
    while (
      result.maxedOut &&
      !result.aborted &&
      params.task === 'chat' &&
      mode !== 'plan' &&
      rounds < effRounds &&
      !io.isAborted() &&
      !signal.aborted &&
      // /goal loop: the model signalled full completion — stop continuing.
      !(goalStillActive() && result.finalText.includes(GOAL_MARKER))
    ) {
      rounds++;
      journalEvent(journalFile, { type: 'continue', round: rounds }); // v9
      notice('continue', `\n\n[auto-continue · round ${rounds} — working through the remaining plan]\n`);
      const g = sessionGoals.get(params.sessionId);
      result.messages.push({ role: 'user', text: g ? CONTINUE_MSG + goalReminderSuffix(g.goal) : CONTINUE_MSG });
      result = await runLoop({
        system,
        messages: result.messages,
        tools: toolDefs,
        ctx: makeCtx(false),
        maxIters: effIters,
        stream: true,
        hooks: hooksCfg,
      });
      addRunUsage(result.usage);
    }

    // v11.23 (FAILURE INTEGRITY) — a terminal failure (provider error, provider
    // refusal, or an abort that landed after the loop) must NEVER fall through
    // the success-only gates below. They emitted claim_audit / proof_package /
    // run_receipt / critic rows that read as SUCCESS immediately next to the
    // `error` bubble, and the final task_report then claimed 'completed'.
    // Skip the whole pipeline on failure, keep the cleanup, go to final events.
    const failedRun =
      result.aborted ||
      result.stopReason === 'error' ||
      result.stopReason === 'refusal' ||
      signal.aborted ||
      io.isAborted();
    postProcess: {
    if (failedRun) {
      // The normal (non-throwing) failure path never reaches the try/catch
      // cleanup below — do the equivalent here so no per-session state leaks.
      try {
        activeSubagentRunners.delete(params.sessionId);
        clearGuard(params.sessionId);
        trace.finish({ ok: false, failure: result.stopReason, turns: 0, tools: runToolCalls });
      } catch {
        /* cleanup is best-effort */
      }
      break postProcess;
    }

    // ---------- 6b. verification loop (engine-run, gated like any command) ----
    // After a run that edited files, run the project's own verification and,
    // on failure, hand the failure back for ONE fix round. This is how the
    // agent ships verified work instead of "looks done" work.
    if (
      params.task === 'chat' &&
      mode !== 'plan' &&
      !result.aborted &&
      writesThisRun &&
      cfg.verifyCommand &&
      cfg.verifyCommand.trim()
    ) {
      const cmd = cfg.verifyCommand.trim();
      notice('verify', `\n\n[verify] ${cmd}\n`);
      try {
        const vr = await executeTool('run_command', JSON.stringify({ command: cmd, timeout_seconds: 600 }), makeCtx(false));
        if (!vr.ok) {
          verifyFailedThisRun = true; // v2.2 — drives skill self-improvement
          notice('verify', '\n[verify failed — starting one fix round]\n');
          result.messages.push({
            role: 'user',
            text:
              `[verification failed] \`${cmd}\` exited non-zero. Output:\n\n` +
              `${vr.output.slice(0, 6000)}\n\nFix the failures, then run \`${cmd}\` yourself to confirm.`,
          });
          result = await runLoop({
            system,
            messages: result.messages,
            tools: toolDefs,
            ctx: makeCtx(false),
            maxIters: effIters,
            stream: true,
            hooks: hooksCfg,
          });
          addRunUsage(result.usage);
        } else {
          notice('verify', '\n[verify passed]\n');
        }
      } catch (err) {
        // v11.9 (E14) — still best-effort, but never invisible: deduped,
        // low-noise sys_notice so a dead verify step is never silent.
        notice('verify', `[verify step failed: ${briefErr(err)}]`);
      }
    }

    // ---------- 6b-bis. DEBUG mode: MANDATORY post-fix test loop (v11.10 A4) ----
    // The debug protocol is only real if a fix is PROVEN. After a debug run
    // that changed files the ENGINE runs the project tests itself (internal
    // runCaptured pathway — no approval ping-pong, works under every
    // permission mode), feeds a red verdict back for ONE automatic fix round,
    // then re-verifies. Verdicts land in `verify_run` events + the gates test
    // ledger. Runs even when autoVerify is disabled — the debug mode contract
    // overrides the generic setting; that is the point of the mode.
    // (runAgent-scope twin of agentLoop's runAutoVerify: same internals —
    // runCaptured + recordTestRun + verify_run — minus the model note.)
    if (params.task === 'chat' && taskMode === 'debug' && !result.aborted) {
      const dbgCmd =
        (cfg.verifyCommand && cfg.verifyCommand.trim()) ||
        (await detectProjectTestCommand(workspace).catch(() => null))?.command ||
        null;
      if (dbgCmd) {
        const dbgVerify = (cmd: string) =>
          runEngineVerify(cmd, workspace, signal, (e) => ioB.send(e), gates);
        let verdict = await dbgVerify(dbgCmd);
        if (verdict.exitCode !== 0) {
          notice('verify', '\n[debug] verification failed — automatic fix round, then re-verify\n');
          result.messages.push({
            role: 'user',
            text:
              `${SYSTEM_NOTE_PREFIX}Debug verification FAILED: \`${dbgCmd}\` exited non-zero. Output tail:\n\n` +
              `${verdict.output.slice(0, 6000)}\n\nApply the minimal targeted fix for these failures, then confirm green yourself.`,
          });
          result = await runLoop({
            system,
            messages: result.messages,
            tools: toolDefs,
            ctx: makeCtx(false),
            maxIters: effIters,
            stream: true,
            hooks: hooksCfg,
          });
          addRunUsage(result.usage);
          verdict = await dbgVerify(dbgCmd);
          if (verdict.exitCode !== 0) verifyFailedThisRun = true; // honest verdict, drives DNA/skill feedback
        }
      }
    }

    // v11.12 (A4-GUARANTEE) — DEBUG mode ALWAYS produces a visible diagnosis
    // summary (the founder: "debug mode — where is it? nothing"). Synthesized
    // from the run's own evidence (tools, commands + verdicts, verify verdict)
    // — no model call, so it cannot fail. The enriched task_report below
    // carries the mode-specific next steps.
    if (params.task === 'chat' && taskMode === 'debug' && !result.aborted) {
      const toolLine = [...toolUsage.entries()]
        .sort((a, b) => b[1].ok + b[1].fail - (a[1].ok + a[1].fail))
        .slice(0, 6)
        .map(([n, c]) => `${n}×${c.ok + c.fail}${c.fail ? ` (${c.fail} failed)` : ''}`)
        .join(', ');
      const cmdLine = commandsRun
        .slice(-5)
        .map((c) => `${c.ok ? 'ok' : 'FAIL'}: ${c.cmd.slice(0, 70)}`)
        .join(' | ');
      notice(
        'debug',
        `\n[debug report] ${toolLine ? `tools: ${toolLine}` : 'no tools used'}${cmdLine ? ` | commands: ${cmdLine}` : ''}${
          verifyFailedThisRun ? ' | verification FAILED after the fix round — see next steps' : ' | diagnosis and fixes are in the conversation above'
        }\n`,
      );
    }

    // ---------- 6b-ter. REVIEW mode: structured review report (v11.10 A4) ----
    if (params.task === 'chat' && taskMode === 'review' && !result.aborted) {
      try {
        const rep = await reviewWorkingDiff(
          workspace,
          { model: params.model, apiKey: creds.apiKey, baseUrl: creds.baseUrl },
          { signal },
        );
        if (rep.ok) {
          const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
          const dir = path.join(workspace, '.surnia', 'reviews');
          fsSync.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `review-${stamp}.md`);
          fsSync.writeFileSync(file, renderReviewReportMarkdown(rep), 'utf8');
          notice('review', `\n[review report] ${rep.summary ?? `${rep.findings.length} findings`} — saved to ${file}\n`);
          // v11.12 (A4-GUARANTEE): the review task-mode ALSO emits the
          // structured event — the renderer already renders the ReviewCard for
          // it (only the /review IPC path did; the task-mode path never did,
          // which is exactly why review mode "showed nothing").
          ioB.send({
            type: 'review_findings',
            findings: rep.findings,
            summary: rep.summary ?? `${rep.findings.length} findings`,
          } as AgentEvent);
        } else {
          notice('review', `\n[review report unavailable: ${rep.error ?? 'unknown reason'}]\n`);
        }
      } catch (err) {
        notice('review', `\n[review report failed: ${briefErr(err)}]\n`);
      }
    }

    // ---------- 6b-2. UI quality gate (engine-run, deterministic, v2.6) ----
    // The model wrote UI files but never probed them: run the deterministic
    // visual probe ONCE ourselves and, on failures, hand them back for ONE
    // fix round. This is what turns "the AI built a broken ugly page" into
    // "the app refuses to ship an overflowing/low-contrast page" — it works
    // with every provider because it needs zero model judgment.
    if (
      params.task === 'chat' &&
      mode !== 'plan' &&
      !result.aborted &&
      uiWritePaths.length > 0 &&
      !uiQualityRan &&
      // v11.12 (B1-GATE-ESCAPE) — the probe needs a real Electron window. In
      // a headless/CLI context it can NEVER pass (BrowserWindow is not a
      // constructor), so without an escape the gate forced a pointless fix
      // round + extra model call and could cascade into failover chaos. Two
      // honest escapes: the SURNIA_SKIP_UI_GATE env knob, and the
      // electron-unavailable (headless harness) case.
      !(process.env.SURNIA_SKIP_UI_GATE === '1') &&
      electronAvailableForProbe()
    ) {
      const htmlTarget = uiWritePaths.find((p) => /\.html?$/i.test(p));
      const target = htmlTarget ?? uiWritePaths[0];
      notice('uiq', `\n[ui-quality] probing ${path.basename(target)} at 390/820/1366px…\n`);
      try {
        const rep = await executeTool('ui_quality_check', JSON.stringify({ path: target }), makeCtx(false));
        const failed = !rep.ok || !/RESULT: PASS/.test(rep.output);
        if (failed) {
          notice('uiq', '\n[ui-quality issues found — starting one fix round]\n');
          result.messages.push({
            role: 'user',
            text:
              `[ui quality gate] An automated visual probe checked the UI you just wrote and found issues ` +
              `(overflow / contrast / tiny text / missing alt or viewport / console errors):\n\n` +
              `${rep.output.slice(0, 4000)}\n\n` +
              `Fix EVERY reported issue in the source, then run ui_quality_check yourself and keep fixing until it reports PASS.`,
          });
          result = await runLoop({
            system,
            messages: result.messages,
            tools: toolDefs,
            ctx: makeCtx(false),
            maxIters: effIters,
            stream: true,
            hooks: hooksCfg,
          });
          addRunUsage(result.usage);
        } else {
          notice('uiq', '\n[ui-quality pass]\n');
        }
      } catch (err) {
        // v11.9 (E14) — best-effort, but surfaced (deduped sys_notice).
        notice('uiq', `[ui-quality gate failed: ${briefErr(err)}]`);
      }
    }

    // ---------- 6b-3. GOAL VERIFIER (evidence-based completion gate, v6) ----
    // A GOAL_COMPLETE marker alone no longer finishes a /goal: a SEPARATE
    // no-tools verifier pass re-reads the goal + the recorded evidence and
    // either confirms it or hands back ONE concrete next action (up to 3
    // verification rounds). Fail-open on verifier errors — a broken verifier
    // must never trap a finished run.
    if (
      params.task === 'chat' &&
      mode !== 'plan' &&
      !result.aborted &&
      sessionGoals.has(params.sessionId)
    ) {
      for (let gv = 0; gv < 3; gv++) {
        const g = sessionGoals.get(params.sessionId);
        if (!g || !result.finalText.trim().includes(GOAL_MARKER)) break;
        let verdictOk = true;
        let nextAction = '';
        let verifierNote = '';
        try {
          let vout = '';
          // v7 — INDEPENDENT VERIFIER: different model family than the worker.
          // v7.1 upgrades, exactly per spec:
          //   (a) the verifier RUNS COMMANDS ITSELF — it gets run_command +
          //       read_file (read-only posture; the recorded commands land in
          //       the same evidence ledger as the worker's);
          //   (b) the whole attempt is budget-wrapped — a 429/5xx/network
          //       death is REFUNDED (verification budget cannot be eaten by
          //       congestion) and one same-family retry runs for free;
          //   (c) when the budget is exhausted the fail posture applies
          //       explicitly (fail-closed → NOT verified), never a silent skip.
          const verifier = pickVerifier(fullSettings(), params.model);
          verifierNote = verifier.reason;
          const verifierToolDefs = toolDefs.filter((d) => d.name === 'run_command' || d.name === 'read_file');
          const vMessages: ProviderMsg[] = [
            {
              role: 'user',
              text:
                `GOAL: ${g.goal}\n\nEVIDENCE recorded by the harness:\n${evidenceBlock()}\n\n` +
                `Agent's final message:\n${result.finalText.slice(0, 4000)}\n\n` +
                `You MAY run read-only verification commands yourself (run_command) and read files to check claims. ` +
                `Do NOT modify anything. Then answer with GOAL_VERIFIED or GOAL_INCOMPLETE: <next action>.`,
            },
          ];
          let verifierRan = false;
          const vout2 = await gates.budget
            .attempt('verifier', async () => {
              vout = '';
              const vres = await agentLoop({
                system: GOAL_VERIFIER_SYSTEM,
                messages: vMessages,
                tools: verifierToolDefs,
                ctx: makeCtx(false),
                maxIters: 6, // verifier commands are capped — evidence, not a second agent
                // v11.9 (E4) — stream:false: the verifier's GOAL_VERIFIED /
                // GOAL_INCOMPLETE lines and its tool calls are harness-internal
                // protocol. With stream:true (makeCtx(false) still forwards)
                // its text_delta/tool events leaked into the USER transcript;
                // now only the parsed goal verdict reaches the UI.
                stream: false,
                hooks: hooksCfg,
                modelOverride: verifier.model,
                credsOverride: { apiKey: verifier.apiKey ?? creds.apiKey, baseUrl: verifier.baseUrl ?? creds.baseUrl },
              });
              vout = vres.finalText;
              addRunUsage(vres.usage);
              // verifier-executed commands were already recorded into commandsRun
              // by agentLoop's shared evidence path — one ledger, no fakes.
              return { value: vres.finalText, usd: vres.usage.costUsd };
            })
            .then((r) => {
              verifierRan = !!r;
              return r?.value ?? '';
            });
          if (verifierRan && /GOAL_VERIFIED/.test(vout2)) verdictOk = true;
          else if (verifierRan) {
            const m = /GOAL_INCOMPLETE:\s*(.+)/.exec(vout2);
            verdictOk = false;
            nextAction = (m ? m[1] : 'continue the goal').trim().slice(0, 300);
          }
        } catch {
          // v7 — posture: 'fail-closed' (high-stakes) treats a broken verifier
          // as NOT-verified (the claim never passes unexamined); 'fail-open'
          // (default, legacy) lets the run finish instead of trapping it.
          if (cfg.verifierMode === 'fail-closed') {
            verdictOk = false;
            nextAction = 'run the verification commands yourself and show their output (the independent verifier is unreachable)';
          } else {
            // v11.23 — fail-open stays the default (a dead verifier must not
            // trap a finished run), but it is NEVER silent: the user is told
            // that the completion claim was not independently checked.
            verdictOk = true;
            notice('goal', '\n[goal verifier unreachable — failing open (default posture); the completion claim was NOT independently checked.]\n');
          }
        }
        if (verdictOk) {
          ioB.send({ type: 'goal_verified', goal: g.goal });
          if (verifierNote) notice('goal', `[goal verifier] ${verifierNote}\n`);
          break;
        }
        notice('goal', `\n[goal verifier] not verified yet — ${nextAction}\n`);
        result.messages.push({
          role: 'user',
          text:
            `[goal verifier] Your completion claim did NOT survive evidence-based verification. ` +
            `Evidence on record:\n${evidenceBlock()}\n\nNext required action: ${nextAction}\n\n` +
            `Do it now, run the verification commands yourself, and only then end with ${GOAL_MARKER} again.`,
        });
        result = await runLoop({
          system,
          messages: result.messages,
          tools: toolDefs,
          ctx: makeCtx(false),
          maxIters: effIters,
          stream: true,
          hooks: hooksCfg,
        });
        addRunUsage(result.usage);
      }
    }

    // ---------- 6b-4. ADVERSARIAL CRITIC GATE (v6, upgraded v7.1) ----------
    // v7.0: fullAccess runs with ≥3 files, model-only, one round.
    // v7.1: ALL permission modes — the trigger is RISK, not mode: ≥3 files
    // touched, or a test file was written, or the run already failed a gate.
    // The deterministic fake-test detector runs FIRST (zero model calls) and
    // its findings feed the critic prompt. Budget-wrapped: a 429/5xx critic
    // attempt is refunded, not consumed. One auto-fix round on criticals.
    const criticTrigger =
      params.task === 'chat' &&
      !result.aborted &&
      writesThisRun &&
      !criticRanThisRun &&
      cfg.criticGate !== false &&
      (touchedFiles.size >= 3 || [...touchedFiles].some((f) => /\.(?:test|spec)\.[cm]?[jt]sx?|_test\.py$/i.test(f)) || gateFixRoundsThisRun > 0);
    if (criticTrigger) {
      criticRanThisRun = true;
      notice('critic', '\n[critic] adversarial review of the working diff…\n');
      try {
        // v7.1 — deterministic first: fake-test findings need no model and are
        // reported to the agent immediately (they are mechanical facts).
        const touchedAbsForFakes = [...touchedFiles].slice(0, 30).map((rel) => (path.isAbsolute(rel) ? rel : path.resolve(workspace, rel)));
        const fakes = await detectFakeTests({ files: touchedAbsForFakes }).catch(() => null);
        const fakeFindings = fakes?.findings.filter((f) => f.severity === 'high') ?? [];

        // v7 — cross-family critic (independent judgment), now budget-wrapped:
        // retryable provider errors (429/5xx) refund the attempt entirely.
        const cv = pickVerifier(fullSettings(), params.model);
        const rev = await gates.budget
          .attempt('critic', async () => ({
            value: await reviewWorkingDiff(workspace, { model: cv.model, apiKey: cv.apiKey ?? creds.apiKey, baseUrl: cv.baseUrl ?? creds.baseUrl }),
          }))
          .then((r) => r?.value);
        if (rev?.ok) {
          const crit = rev.findings.filter((f) => f.severity === 'critical');
          criticPayloadThisRun = { findings: rev.findings.length, critical: crit.length, summary: (rev.summary ?? '').slice(0, 600) };
          ioB.send({
            type: 'critic_verdict',
            findings: rev.findings.length,
            critical: crit.length,
            summary: (rev.summary ?? '').slice(0, 600),
          });
          if (crit.length || fakeFindings.length) {
            gateFixRoundsThisRun++;
            notice('critic', `\n[critic] ${crit.length} critical finding(s), ${fakeFindings.length} fake-test finding(s) — one auto-fix round starting\n`);
            result.messages.push({
              role: 'user',
              text:
                '[adversarial critic] A read-only critic reviewed your working diff and found issues ' +
                '(mocked/faked tests, facade code, broken imports, unverified claims):\n\n' +
                `${crit
                  .map((f) => `- (${f.file}${typeof f.line === 'number' ? ':' + f.line : ''}) ${f.note}`)
                  .join('\n')}\n\n` +
                (fakeFindings.length
                  ? `DETERMINISTIC FAKE-TEST GATE (no model — mechanical facts):\n${fakeFindings.map((f) => `- ${f.file}:${f.line} [${f.rule}] ${f.note}`).join('\n')}\n\n`
                  : '') +
                "Fix them for real — no mocked tests, no facade code — then re-run the project's verification.",
            });
            result = await runLoop({
              system,
              messages: result.messages,
              tools: toolDefs,
              ctx: makeCtx(false),
              maxIters: effIters,
              stream: true,
              hooks: hooksCfg,
            });
            addRunUsage(result.usage);
          }
        }
      } catch (err) {
        // v11.9 (E14) — best-effort, but surfaced (deduped sys_notice).
        notice('critic', `[critic gate failed: ${briefErr(err)}]`);
      }
    }

    // Host registration ends with the run; in-flight background subagents keep
    // their captured runner.
    activeSubagentRunners.delete(params.sessionId);
    clearGuard(params.sessionId); // v7 — drop the read-before-edit ledger with the run
    trace.finish({ ok: !result?.aborted, turns: Math.max(1, Math.round(runToolCalls / 2)), tools: runToolCalls });
    // v11.11 (A4-CLOSURE) — the journal finish line moved to the run's
    // try/finally: it must be queued AFTER the journaled `task_report` event
    // (the journal summary reader takes the LAST finish line — a finish
    // written here would precede the report line and the run would read as
    // "crashed" despite its recorded outcome).

    // ---------- 6b-5..6b-9. PROVEN CHANGE PIPELINE (v7.1) ----------
    // The harness, not the model, is the source of truth:
    //   6b-5 claim→evidence audit (v7, kept) + harness red→green verdict
    //   6b-6 fake-test detector (deterministic, zero model)
    //   6b-7 mutation gate ON THE CHANGED LINES (kill-rate verdict)
    //   6b-8 signed re-runnable proof package (+ False-Done record)
    // Gates vote; the proof verdict is computed from the votes.
    if (params.task === 'chat' && !result.aborted && result.finalText.trim()) {
      // v11.18 — QUIET SIMPLE TURNS. An audit / self-critique / proof "row" is
      // only meaningful when the turn actually DID work. A plain conversational
      // answer runs no tools, writes no files and records no verification, so
      // emitting those rows is pure noise (the founder's complaint). `auditClaims`
      // classifies EVERY sentence as a claim, so `audit.claims.length > 0` alone
      // is NOT evidence — it is true even for "hello". This single predicate is
      // the source of truth for every post-answer proof-of-work event below.
      // Safety invariant: an ERROR or a FAIL verdict can only arise from real
      // work (writes / commands / verification), which always satisfies this
      // predicate — no failure signal is ever suppressed by these gates.
      const realWorkThisRun = writesThisRun || commandsRun.length > 0 || gates.testRecord.all().length > 0;
      // v8.1 — False-Done honesty: the PROSE claim is frozen BEFORE any gate
      // overrules it. The gate's verdict travels separately (gateVerdict), so
      // a gate-caught round is counted AS a false done (claimed + gates
      // disagreed) instead of silently leaving both numerator and denominator.
      const claimedProse = /\b(?:done|complete|finished|all tests? (?:pass|green))\b|تم|اكتمل|أنهيت|كل الاختبارات/i.test(result.finalText);
      let gateRedGreen: 'ok' | 'missing' | 'not-applicable' = 'not-applicable';
      let gateMutation: 'killed-enough' | 'survivors' | 'boundary-survivors' | 'strong-small' | 'weak' | 'no-mutations' | 'baseline-failed' | 'skipped' | 'not-run' = 'not-run';
      let gateFakes: 'clean' | 'findings' | 'not-run' = 'not-run';
      let gateRegressions = 'unknown' as 'none' | 'present' | 'unknown' | string; // widened: CFA must not fold 'present' out
      let mutationReport: Awaited<ReturnType<typeof mutationGate>> | null = null;
      let fakeReport: Awaited<ReturnType<typeof detectFakeTests>> | null = null;

      try {
        // ---- 6b-5a claim audit (v7 kept) ----
        const audit = auditClaims(result.finalText, {
          filesTouched: [...touchedFiles],
          commands: commandsRun.map((c) => ({ command: c.cmd, exitCode: c.ok ? 0 : 1 })),
          testsRun: commandsRun.some((c) => /\b(test|vitest|jest|pytest|cargo test|go test|mvn|gradle)\b/i.test(c.cmd)) || gates.testRecord.all().length > 0,
        });
        // v11.18 — require BOTH parsed claims AND real work. `audit.claims.length`
        // is non-zero for any non-empty answer (every sentence is a claim), so
        // without the `realWorkThisRun` half a simple chat still emits this row.
        if (audit.claims.length && realWorkThisRun) {
          ioB.send({ type: 'claim_audit', summary: audit.summary, unsupported: audit.unsupportedCount, claims: audit.claims.slice(0, 8).map((c: { claim: string; kind: string; supported: boolean }) => ({ claim: c.claim, kind: c.kind, supported: c.supported })) });
          if (audit.unsupportedCount > 0) {
            notice('audit', `\n[claim audit] ${audit.summary} — unevidenced claims are flagged in the receipt.\n`);
          }
        }

        // ---- v11.13 (VIBE CODER) 6b-5a-EXT: NO-TOOLS SELF-CRITIQUE ----
        // EXTENDS the existing critic pipeline (it does NOT add a model
        // round-trip): a deterministic checkpoint reviews whether the task
        // was actually completed and which final-answer claims lack
        // evidence, then feeds a compact bilingual footer into the final
        // answer path via the dedicated sys_notice channel (same pattern
        // as every other gate/receipt in this engine).
        const flowLang: FlowLang = lang === 'ar' ? 'ar' : 'en';
        if (cfg.selfCritique !== false) {
          try {
            const testRecs = gates.testRecord.all();
            const lastTest = testRecs.length ? testRecs[testRecs.length - 1] : null;
            const critique = selfCritique({
              finalText: result.finalText,
              language: flowLang,
              writesThisRun,
              commandsRun: commandsRun.length,
              verificationRan: testRecs.length > 0,
              verificationPassed: lastTest ? lastTest.exitCode === 0 : null,
              unverifiedClaims: unverifiedFromAudit(audit),
              claimsTotal: audit.claims.length,
            });
            // v11.18 — the helper still runs (deterministic / tests rely on it),
            // but a no-op conversational turn must not print a critique row.
            if (realWorkThisRun) {
              notice('self_critique', `\n[self-critique] ${critique.footer}\n`);
            }
          } catch {
            /* self-critique is advisory — never blocks the receipt */
          }
        }

        // ---- v11.13 (VIBE CODER) RUN & SHOW: real command, honest report ----
        // Reuses the engine's own verifier plumbing. Reuses an already
        // recorded harness test run when one exists (no duplicate work);
        // otherwise runs the detected command ONCE through runCaptured.
        // Never fabricates a screenshot, count or green result.
        if (
          cfg.runAndShow !== false &&
          writesThisRun &&
          mode !== 'plan' &&
          taskMode !== 'plan' &&
          taskMode !== 'review' &&
          !signal.aborted
        ) {
          try {
            // Same detection inputs as the gate, computed locally so this
            // block stays independent of declaration order / inner-loop scope.
            // P0: `detectProjectTestCommand` spawns a probe (e.g. `make test`)
            // and can cost ~5s. It MUST NOT sit on the completion path — the
            // renderer watchdog interprets a long post-stream silence as a
            // dead agent. Prefer the cached detection (already computed earlier
            // in the run as verifyCmdCache) and never await a fresh probe here.
            const detected =
              cfg.verifyCommand?.trim() ||
              gates.defaultTestCommand() ||
              verifyCmdCache?.command ||
              null;
            const recs = gates.testRecord.all();
            const reused = detected ? recs.find((r) => r.command === detected) ?? recs[recs.length - 1] : recs[recs.length - 1];
            let rs: RunShowResult | null = null;
            if (reused) {
              rs = {
                command: reused.command,
                exitCode: reused.exitCode,
                outputTail: String(reused.outputTail ?? '').slice(-1500),
              };
            } else if (detected && (currentMode() === 'autoEdit' || currentMode() === 'fullAccess')) {
              // Autonomous command execution is allowed ONLY in the same
              // modes the harness already auto-verifies — never silently run
              // a command in a mode that requires user approval.
              // CRITICAL (P0): this MUST NOT block the run. A 600s await here
              // kept `running:true` in the renderer, which dropped all new
              // sends and killed the session via the 600s watchdog — the
              // "AI stopped responding" regression. Fire-and-forget with a
              // 45s cap; the result still arrives through the notice channel.
              const vStarted = Date.now();
              void runCaptured(detected, workspace, 45_000, { signal })
                .then((r) => {
                  const done: RunShowResult = {
                    command: detected,
                    exitCode: r.exitCode,
                    outputTail: String(r.output ?? '').slice(-1500),
                    durationMs: Date.now() - vStarted,
                    aborted: signal.aborted,
                  };
                  notice('run_and_show', `\n${runAndShowSummary(done, flowLang)}\n`);
                  try {
                    gates.recordTestRun(r.exitCode === 0 ? 'after' : 'red', detected, r.exitCode, r.output ?? '', Date.now() - vStarted);
                  } catch { /* ledger is best-effort */ }
                })
                .catch((err) => {
                  const detail = err instanceof Error ? err.message : String(err);
                  notice('run_and_show', `\n[Run & Show / تشغيل وعرض] runner failed: ${detail.slice(0, 160)}\n`);
                });
              // The notice is delivered by the promise handlers above —
              // `rs` stays null so the synchronous notice below is skipped.
            } else if (detected) {
              rs = {
                command: detected,
                skippedReason:
                  flowLang === 'ar'
                    ? 'لم يُنفَّذ: تشغيل الأوامر يتطلب موافقة في وضع الصلاحيات الحالي'
                    : 'not executed: running commands requires approval in the current permission mode',
              };
            } else {
              rs = { command: null };
            }
            if (rs) notice('run_and_show', `\n${runAndShowSummary(rs, flowLang)}\n`);
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            notice('run_and_show', `\n[Run & Show / تشغيل وعرض] runner failed to start: ${detail.slice(0, 160)}\n`);
          }
        }

        // ---- 6b-5b RED→GREEN enforced by the harness ----
        const testCmdForGate = cfg.verifyCommand?.trim() || gates.defaultTestCommand() || (await detectProjectTestCommand(workspace).catch(() => null))?.command || null;
        if (testCmdForGate && gates.testRecord.all().length > 0) {
          const rgH = gates.testRecord.redGreenCompliant(testCmdForGate);
          gateRedGreen = rgH.compliant ? 'ok' : 'missing';
          ioB.send({ type: 'red_green', compliant: rgH.compliant, reason: rgH.reason });
          if (!rgH.compliant) {
            notice('redgreen', `\n[red→green ENFORCED] ${rgH.reason} — the failing-test-first run must come from the harness, not from prose.\n`);
          } else {
            notice('redgreen', `\n[red→green] ${rgH.reason}\n`);
          }
          // regression detection from parsed per-test results
          const regs = gates.testRecord.regressions(testCmdForGate);
          gateRegressions = regs.unknown ? 'unknown' : regs.tests.length ? 'present' : 'none';
          if (regs.tests.length) {
            notice('regression', `\n[regression] ${regs.tests.length} test(s) passed BEFORE this run and fail now: ${regs.tests.slice(0, 6).join(', ')} — this is a REGRESSION, not a fix.\n`);
          }
        } else {
          // no harness-visible test runs — keep the v7 prose heuristic as a hint
          const rg = parseRedGreen(result.finalText);
          if (!rg.compliant && /\bfix(ed|es)?\b|\bbug\b|\bأصلحت\b|\bصلحت\b/i.test(result.finalText)) {
            gateRedGreen = 'missing';
            notice('redgreen', '\n[red→green] no failing-test-BEFORE-fix evidence detected — real bug fixes need a failing test first, then the fix makes it pass.\n');
          }
        }

        // ---- 6b-6 FAKE-TEST DETECTOR (deterministic, before the critic) ----
        if (writesThisRun && cfg.criticGate !== false) {
          try {
            const touchedAbs = [...touchedFiles].slice(0, 30).map((rel) => (path.isAbsolute(rel) ? rel : path.resolve(workspace, rel)));
            fakeReport = await detectFakeTests({ files: touchedAbs });
            if (fakeReport.scanned > 0) {
              gateFakes = fakeReport.high > 0 ? 'findings' : 'clean';
              ioB.send({
                type: 'fake_tests',
                scanned: fakeReport.scanned,
                high: fakeReport.high,
                summary: fakeReport.summary,
                findings: fakeReport.findings.slice(0, 10).map((f) => ({ file: f.file, line: f.line, rule: f.rule, severity: f.severity, note: f.note })),
              });
              const dir = fakeTestDirective(fakeReport);
              if (dir) {
                notice('fake', `\n[fake-test gate] ${dir}\n`);
              }
            }
          } catch {
            /* detector is best-effort */
          }
        }

        // ---- 6b-7 MUTATION GATE on the CHANGED LINES (v8.1: verdicts are
        // honest — only hard survivors FAIL; weak/small-sample/boundary are
        // inconclusive and NEVER flip the claim; hard survivors are fed back
        // to the agent for one fix round, then the gate re-runs) ----
        if (
          writesThisRun &&
          (currentMode() === 'autoEdit' || currentMode() === 'fullAccess') &&
          cfg.criticGate !== false &&
          cfg.mutationGate?.enabled !== false &&
          absTouched().length > 0
        ) {
          const testCmd = testCmdForGate;
          if (testCmd) {
            for (let mutRound = 0; mutRound < 2; mutRound++) {
              try {
                notice('mutation', `\n[mutation gate]${mutRound > 0 ? ' (re-check after fixes)' : ''} breaking the changed lines to prove the tests protect them…\n`);
                mutationReport = await mutationGate({
                  workspace,
                  testCommand: testCmd,
                  files: absTouched(),
                  spans: gates.lineSpans(),
                  maxMutations: cfg.mutationGate?.maxMutations,
                  threshold: cfg.mutationGate?.threshold,
                  timeoutMs: 180_000,
                });
                gateMutation = mutationReport.verdict;
                ioB.send({
                  type: 'mutation_gate',
                  verdict: mutationReport.verdict,
                  inconclusive: mutationReport.inconclusive,
                  ran: mutationReport.ran,
                  killed: mutationReport.killed,
                  killRate: mutationReport.killRate,
                  detail: mutationReport.detail,
                });
                // keep the v7 event name alive for older UI surfaces
                ioB.send({ type: 'mutation_check', honest: mutationReport.verdict === 'killed-enough' ? true : mutationReport.ran === 0 ? null : mutationReport.verdict === 'survivors' ? false : null, detail: mutationReport.detail });
                if (mutationReport.verdict === 'killed-enough') {
                  notice('mutation', `\n[mutation gate] PASSED — ${mutationReport.detail}\n`);
                  break;
                }
                if (mutationReport.inconclusive) {
                  // honest: no claim either way — the claim is NOT overruled
                  notice('mutation', `\n[mutation gate] INCONCLUSIVE (no overrule) — ${mutationReport.detail}\n`);
                  break;
                }
                // verdict === 'survivors': hard evidence of unprotected lines.
                notice('mutation', `\n[mutation gate] FAILED — ${mutationReport.detail}\n`);
                if (mutRound === 0) {
                  // v8.1 — SURVIVORS GO BACK TO THE AGENT: one bounded fix
                  // round, then the gate re-runs on the fixed tree.
                  const survivors = mutationReport.survivors.filter((s) => s.severity === 'hard').slice(0, 6);
                  if (survivors.length) {
                    result.messages.push({
                      role: 'user',
                      text:
                        '[mutation gate] Your change is NOT protected by the tests. These mutations were applied to the lines you just wrote and the suite still PASSED with each of them — meaning no test covers their behavior:\n\n' +
                        survivors.map((s) => `- ${s.file}:${s.lineNo} [${s.op}] "${s.before}" survives as "${s.after}"`).join('\n') +
                        '\n\nAdd/adjust assertions that FAIL when the mutated operator ships (test the boundary or the behavior the operator changes), re-run the suite, and end when the gate can pass.',
                    });
                    notice('mutation', `\n[mutation gate] ${survivors.length} survivor(s) fed back to the agent — one fix round…\n`);
                    result = await runLoop({
                      system,
                      messages: result.messages,
                      tools: toolDefs,
                      ctx: makeCtx(false),
                      maxIters: effIters,
                      stream: true,
                      hooks: hooksCfg,
                    });
                    addRunUsage(result.usage);
                    continue; // re-run the gate on the fixed tree
                  }
                }
                break; // survivors after the fix round — report honestly
              } catch (err) {
                // v11.9 (E14) — best-effort, but surfaced (deduped sys_notice).
                notice('mutation', `[mutation gate failed: ${briefErr(err)}]`);
                break;
              }
            }
          }
        }

        // ---- 6b-8 SIGNED PROOF PACKAGE + False-Done ----
        // v11.18 — a no-op conversational turn emits no proof row. Only real
        // work (writes / commands / verification) earns a proof_package. FAIL
        // and ERROR verdicts originate only from real work, so they are kept.
        if (realWorkThisRun) {
          try {
            const userDataDir = electronUserDataDirSafe();
            // v8.1 — False-Done persistence: survives restarts, so the metric is
            // a career-long record, not a per-process counter.
            await setFalseDoneStore(path.join(userDataDir, 'metrics'));
            const signingKey = await loadSigningKey(userDataDir);
            const gates2 = {
              redGreen: gateRedGreen,
              mutationGate: gateMutation,
              fakeTests: gateFakes,
              regressions: (gateRegressions === 'present' ? 'present' : gateRegressions === 'none' ? 'none' : 'unknown') as 'none' | 'present' | 'unknown',
            };
            // verdict: worst vote wins (computing, not asserting)
            let verdict: ProofVerdict;
            if (!writesThisRun && commandsRun.length === 0) verdict = 'unproven';
            else if (gateRegressions === 'present' || gateMutation === 'survivors') verdict = 'failed';
            else if (gateRedGreen === 'missing' && gateMutation === 'not-run') verdict = 'unproven';
            else if (gateMutation === 'killed-enough' && gateRedGreen === 'ok' && gateFakes !== 'findings' && gateRegressions !== 'present') verdict = 'proven';
            else if (gateMutation === 'no-mutations' && gateRedGreen !== 'missing') verdict = 'partial';
            else verdict = 'partial';

            const testRuns = gates.testRecord.all().map((r) => ({ phase: r.phase === 'mutation' || r.phase === 'verify' ? 'after' : r.phase, command: r.command, exitCode: r.exitCode, at: new Date(r.at).toISOString() }));
            const proof = await buildProofPackage(
              {
                durationMs: Date.now() - runStartedAt,
                task: { kind: params.task, ...(params.task === 'chat' && sessionGoals.get(params.sessionId) ? { goal: sessionGoals.get(params.sessionId)!.goal } : {}), prompt: String(params.messages.at(-1)?.content ?? '').slice(0, 400) },
                model: { provider: params.model.provider, model: params.model.model },
                workspace,
                verdict,
                beforeHashes: gates.beforeHashes,
                touchedFiles: absTouched(),
                commands: commandsRun.slice(-40).map((c) => ({ command: c.cmd, exitCode: c.ok ? 0 : 1 })),
                tests: testRuns.length
                  ? {
                      runs: testRuns.slice(-24),
                      regressions: gateRegressions === 'present' ? (gates.testRecord.regressions(testCmdForGate ?? undefined).tests) : [],
                    }
                  : null,
                mutation: mutationReport
                  ? {
                      ran: mutationReport.ran,
                      killed: mutationReport.killed,
                      killRate: mutationReport.killRate,
                      verdict: mutationReport.verdict,
                      survivors: mutationReport.survivors.slice(0, 8).map((s) => ({ file: s.file, lineNo: s.lineNo, op: s.op, before: s.before, after: s.after })),
                    }
                  : null,
                fakeTests: fakeReport && fakeReport.scanned > 0
                  ? {
                      scanned: fakeReport.scanned,
                      high: fakeReport.high,
                      findings: fakeReport.findings.slice(0, 8).map((f) => ({ file: f.file, line: f.line, rule: f.rule, note: f.note })),
                    }
                  : null,
                claimAudit: audit2Payload(audit),
                critic: criticPayloadThisRun,
                gates: gates2,
              },
              signingKey,
            );
            const proofFile = await saveProofPackage(proof, path.join(userDataDir, 'proofs'));
            ioB.send({ type: 'proof_package', id: proof.id, file: proofFile, verdict: proof.verdict, markdown: proofToMarkdown(proof) });
            // v11.18: duplicate proof notice removed - proof_package event carries file and verdict

            // False-Done Rate: the published metric, updated every claimed run
            // False-Done Rate: the published metric, updated every claimed run —
            // recorded with the ORIGINAL prose claim (v8.1), so gate-caught
            // rounds enter the fraction instead of vanishing from it.
            recordFalseDone({
              runId: proof.id,
              at: Date.now(),
              claimedSuccess: claimedProse,
              gateVerdict: verdict,
            });
            const fd = falseDoneStats();
            ioB.send({ type: 'false_done', claimed: fd.claimed, falseDone: fd.falseDone, rate: fd.rate });
            ioB.send({ type: 'budget_state', label: gates.budget.label() });

            // v7.1 — COST PER PROVEN CHANGE: only proven runs enter the ledger,
            // keyed provider/model. This is the honest cost metric.
            if (verdict === 'proven') {
              try {
                const ledgerPath = path.join(userDataDir, 'costs', 'proven.json');
                let entries: Array<{ at: number; provider: string; model: string; costUsd: number; durationMs: number }> = [];
                try {
                  entries = JSON.parse(await fs.readFile(ledgerPath, 'utf8')) as typeof entries;
                  if (!Array.isArray(entries)) entries = [];
                } catch {
                  entries = [];
                }
                entries.push({ at: Date.now(), provider: params.model.provider, model: params.model.model, costUsd: totalUsage.costUsd, durationMs: Date.now() - runStartedAt });
                if (entries.length > 500) entries = entries.slice(-500);
                await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
                await fs.writeFile(ledgerPath, JSON.stringify(entries, null, 2), 'utf8');
              } catch {
                /* ledger is best-effort */
              }
            }

            // v7.1 — SKILL EVIDENCE GATE: record this run's skill outcomes and
            // replay the recent traces — candidates promote only on evidence.
            if (skillsUsedThisRun.size) {
              try {
                const { skillGateRecordUse } = await import('./skillGate');
                const runOk = verdict === 'proven' || verdict === 'partial';
                for (const slug of skillsUsedThisRun) skillGateRecordUse(userDataDir, slug, runOk);
              } catch {
                /* gating is silent */
              }
            }
            try {
              const { promoteSkillsFromTraces } = await import('./skillGate');
              void promoteSkillsFromTraces(userDataDir, 7);
            } catch {
              /* catch-up scan is silent */
            }
          } catch (proofErr) {
            // the proof package never breaks the run — but it is honest about it
            try {
              notice('proof', `\n[proof] package build failed: ${proofErr instanceof Error ? proofErr.message : String(proofErr)}\n`);
            } catch {
              /* io may be gone */
            }
          }
        }
      } catch (pipelineErr) {
        // v11.23 — the whole proven-change pipeline used to be wrapped in a
        // bare `catch {}`. A gate that crashed (or a file write that failed)
        // left the run claiming success with NO evidence and NO explanation.
        // Still best-effort, but never an invisible fail-open: one deduped
        // notice names the phase so the receipt can be trusted.
        notice('proof', `\n[evidence pipeline skipped: ${briefErr(pipelineErr)} — no proof verdict was produced]\n`);
      }
    }

    // ---------- 6c. auto-memory (post-run learning, fire-and-forget) ----------
    // After a run that edited files, quietly distill 0-3 durable project facts
    // into MEMORY.md ('## Learned') for future sessions. Never blocks or fails
    // the run; disabled via settings.agent.autoMemory === false.
    if (params.task === 'chat' && !result.aborted && writesThisRun && cfg.autoMemory !== false) {
      try {
        learnMemoryFacts({
          workspace,
          messages: result.messages,
          model: params.model,
          creds,
          maxRetries: cfg.maxRetries,
          signal,
        }).catch(() => {
          /* learning is silent */
        });
      } catch {
        /* best-effort */
      }
    }

    // ---------- 6c-bis. Surnia DNA — auto-extraction (fire-and-forget) ----------
    // ONE lightweight no-tools model call after a completed run (same shape as
    // learnMemoryFacts) distills durable facts about HOW THIS USER works into
    // the persistent DNA model. Never blocks or fails the run; disabled via
    // settings.dnaEnabled === false.
    if (params.task === 'chat' && !result.aborted && dnaEnabledSetting()) {
      try {
        void learnDNAFacts({
          workspace,
          messages: result.messages,
          model: params.model,
          creds,
          signal,
          onUpdated: () => {
            try {
              ioB.send({ type: 'dna_updated', reason: 'extraction' });
            } catch {
              /* io may be gone after the run — best-effort */
            }
          },
        }).catch(() => {
          /* DNA learning is silent */
        });
      } catch {
        /* best-effort */
      }
    }

    // ---------- 6c-ter. v11.12 LIVING PLAYBOOK — post-run learning ----------
    // After a completed chat run, ONE lightweight no-tools call distills what
    // worked / failed / preferences / verified recipes and updates the
    // workspace PLAYBOOK.md + its version timeline. Fire-and-forget: never
    // blocks or fails the run. Emits `playbook_learned` → visible toast + UI.
    if (params.task === 'chat' && !result.aborted && dnaEnabledSetting()) {
      try {
        void learnPlaybookFacts({
          workspace,
          messages: result.messages,
          model: params.model,
          creds,
          signal,
          sessionId: params.sessionId,
          onLearned: (summary, version) => {
            try {
              ioB.send({ type: 'playbook_learned', summary, version, sessionId: params.sessionId } as AgentEvent);
            } catch {
              /* io may be gone — best-effort */
            }
          },
        }).catch(() => {
          /* playbook learning is silent */
        });
      } catch {
        /* best-effort */
      }
    }
    } // v11.23 — end postProcess (skipped in full on a failed/aborted run)

    // Remember writes for the NEXT turn's before-turn checkpoint.
    lastRunWrote.set(params.sessionId, writesThisRun);
    // v7.1 — the gate bundle (test ledger / budget / taint / hashes) is dropped
    // AFTER the pipeline so tools can read it to the very end of the run.
    clearRunGates(params.sessionId);

    // ---------- 7. final events ----------
    // v11.23 — an abort that arrived during post-processing must still end as
    // 'aborted' (never a clean 'completed' with `running` left stuck). The two
    // branches are mutually exclusive and both terminate the run.
    if (signal.aborted || io.isAborted()) {
      ioB.send({ type: 'aborted' });
      emitTaskReport({ outcome: 'aborted', finalText: result.finalText, stopReason: result.stopReason });
      sendTurnEnd();
      return;
    }
    if (result.aborted) {
      ioB.send({ type: 'aborted' });
      emitTaskReport({ outcome: 'aborted', finalText: result.finalText, stopReason: result.stopReason });
      sendTurnEnd();
      return;
    }
    // /goal loop: cheap completion check on the model's final text — when the
    // GOAL_COMPLETE marker is present the goal is done; emit and clear it.
    const finishedGoal = params.task === 'chat' ? sessionGoals.get(params.sessionId) : undefined;
    if (finishedGoal && result.finalText.trim().includes(GOAL_MARKER)) {
      sessionGoals.delete(params.sessionId);
      ioB.send({ type: 'goal_done', goal: finishedGoal.goal });
      // v2.1 SKILL FACTORY — a completed goal with real work behind it becomes
      // a reusable skill: a skill-writer subagent distills the transcript into
      // a SKILL.md; the engine saves it under .surnia/skills and emits
      // `skill_created`. Fire-and-forget — must never delay or fail the run.
      if (runToolCalls >= SKILL_MIN_TOOLS && cfg.autoMemory !== false) {
        void (async (): Promise<void> => {
          const transcript = transcriptTailForSkill(result.messages);
          if (!transcript) return;
          const prompt =
            'From the session transcript below, extract ONE reusable skill that would help future sessions in this ' +
            'workspace (a repeatable procedure, convention, or gotcha-handling recipe — NOT a summary of this task).\n\n' +
            'Output ONLY the full SKILL.md content: a frontmatter block with `name:` (2-4 words) and `description:` ' +
            '(one sentence), followed by a concise markdown body (when to use, steps, verification). Keep it under 80 lines.\n\n' +
            '--- SESSION TRANSCRIPT ---\n' +
            transcript;
          const out = await runSubagent('skill-writer', 'Extract a reusable skill from this session', prompt);
          const parsed = parseSkillMarkdown(out, 'session-skill');
          if (!parsed.name || parsed.body.trim().length < 80) return; // nothing usable
          const slug = await saveSkill(workspace, parsed);
          ioB.send({ type: 'skill_created', name: parsed.name, slug });
          try {
            console.log(`[agent] skill created (${params.sessionId}): ${parsed.name} → .surnia/skills/${slug}`);
          } catch {
            /* logging is best-effort */
          }
        })().catch(() => {
          /* the skill factory is silent */
        });
      }
    }
    // v11.9 (E5) — the GOAL_COMPLETE marker is a harness protocol token, not
    // user-visible prose: strip every marker line from the final text BEFORE
    // the run's final events (detection above already consumed it). The
    // renderer store strips the SAME pattern from its message row — cross-team
    // contract; the engine must not rely on that alone.
    if (result.finalText.includes(GOAL_MARKER)) {
      result.finalText = stripGoalMarker(result.finalText);
    }
    // v11.10 (A4) — plan postures: the permission-plan approval contract AND
    // the plan TASK mode both end with a plan_ready card; the task-mode one
    // also emits the explicit switch-to-Build next-step note.
    // v11.12 (A4-GUARANTEE — the founder's "where is the plan? literally
    // nothing"): the card is now UNCONDITIONAL for plan runs. An empty
    // finalText no longer swallows it — the harness synthesizes an honest plan
    // draft from the run's own trace, and the catch path below emits one too.
    if ((mode === 'plan' || taskMode === 'plan') && !planSubmittedThisRun) {
      const planText = result.finalText.trim() || (taskMode === 'plan' ? synthesizePlanFallback() : '');
      if (planText) ioB.send({ type: 'plan_ready', plan: planText.slice(0, 16000), sessionId: params.sessionId } as AgentEvent);
    }
    if (params.task === 'chat' && taskMode === 'plan' && !result.aborted && (planSubmittedThisRun || result.finalText.trim() || toolUsage.size)) {
      // v11.12 — the harness writes plan.md ITSELF (the read-only gate already
      // sanctions exactly this path), so the artifact exists even when the
      // model never wrote it.
      try {
        // v11.12 — the harness writes plan.md ITSELF but ONLY when the model
        // didn't: the read-only gate sanctions the model's own plan.md write
        // (propose_plan protocol), and the harness must never clobber it.
        const planMdPath = path.join(workspace, 'plan.md');
        if (!fsSync.existsSync(planMdPath)) {
          const planMd = result.finalText.trim() || synthesizePlanFallback();
          if (planMd) {
            fsSync.writeFileSync(planMdPath, planMd.slice(0, 50000), 'utf8');
            touchedFiles.add('plan.md');
          }
        }
      } catch {
        /* plan.md is best-effort */
      }
      notice(
        'plan',
        '\n[plan ready — switch to BUILD mode (/build or the mode strip) to implement it · الخطة جاهزة — انتقل إلى وضع البناء لتنفيذها]\n',
      );
    }
    if (result.maxedOut) {
      notice('stop', `\n\n[Stopped: reached an explicitly configured tool-step limit${rounds > 0 ? ` after ${rounds} continuation round${rounds === 1 ? '' : 's'}` : ''}. Work already done is preserved on disk.]`);
    }
    // v6 — EVIDENCE RECEIPT: a compact proof-of-work record the renderer turns
    // into a card (files touched, commands + exit status, rounds, duration).
    // Emitted only for runs that actually did something (writes or commands).
    if (writesThisRun || commandsRun.length) {
      ioB.send({
        type: 'run_receipt',
        files: [...touchedFiles].slice(0, 50),
        commands: commandsRun.slice(-20).map((c) => ({ cmd: c.cmd, ok: c.ok })),
        rounds,
        verifyFailed: verifyFailedThisRun,
        durationMs: Date.now() - startedAt,
      });
    }
    // message_end carries the per-turn DELTA (inputTokens/outputTokens/costUsd
    // — display semantics unchanged) PLUS cumulative RUN totals in the added
    // optional fields runInput/runOutput/runCost — now accumulated across ALL
    // continuation/fix rounds (the old code overwrote the usage every turn).
    // v11.9 (E18) — `thinkMs`: thinking duration for the whole run — first
    // think_delta → first answer text_delta (or turn end when no answer
    // followed). Finite integer ms, 0 when the model never thought. The
    // renderer-side consumers handle the rest; the engine just emits it.
    const thinkEnd = thinkingEndedAt > 0 ? thinkingEndedAt : Date.now();
    const thinkMs = thinkingStartedAt > 0 ? Math.max(0, Math.round(thinkEnd - thinkingStartedAt)) : 0;
    ioB.send({
      type: 'message_end',
      usage: {
        inputTokens: result.lastTurn.inputTokens,
        outputTokens: result.lastTurn.outputTokens,
        costUsd: result.lastTurn.costUsd,
        // v7 — per-turn provider cache split (status-bar cache-hit chip).
        cacheReadTokens: result.lastTurn.cacheReadTokens,
        cacheCreationTokens: result.lastTurn.cacheCreationTokens,
        // v11.10 (A5) — honesty marker: true ⇒ the provider never reported
        // usage and these figures are the chars/4 fallback (the renderer
        // shows "≈" — a precise-looking fake is worse than an honest estimate).
        ...(result.lastTurn.estimated ? { estimated: true } : {}),
        // v11.10 (A5) — whole-turn billing totals: ALL continuation/fix rounds
        // + ALL attempts (retries/failovers that still burned billed tokens),
        // plus the run cache split and the per-attempt breakdown. The Usage
        // tab reconciles on these; the context bar keeps the DELTA fields
        // (the final prompt is the true window occupancy).
        runInput: totalUsage.inputTokens,
        runOutput: totalUsage.outputTokens,
        runCost: Math.round(totalUsage.costUsd * 1e6) / 1e6,
        runCacheRead: Math.max(0, totalUsage.runCacheRead ?? 0),
        runCacheCreation: Math.max(0, totalUsage.runCacheCreation ?? 0),
        attempts: totalUsage.attempts ?? [],
      },
      stopReason: result.stopReason,
      thinkMs: Number.isFinite(thinkMs) ? thinkMs : 0,
    } as AgentEvent);
    // v1.5 milestone notify: a run that took ≥8 minutes pings the desktop
    // (the user walked away — this is how long tasks keep them informed).
    if (params.task === 'chat' && Date.now() - startedAt > 8 * 60_000) {
      try {
        notifyAgentDone('Surnia', `Task finished after ${Math.max(1, Math.round((Date.now() - startedAt) / 60_000))} min.`);
      } catch {
        /* notifications are best-effort */
      }
    }
    // Final /goal progress snapshot before the run ends (goal still active).
    if (sessionGoals.has(params.sessionId)) emitGoalProgress();
    // v11.11 (A4) — COMPLETION GUARANTEE: the run ALWAYS ends with a
    // structured summary (completed / error — incl. failover-exhausted and
    // watchdog-recovered runs), never "ended and said nothing".
    // v12 — a run that ended because an output/pause/time budget exhausted is
    // PARTIAL, never a clean "completed": the model may have been cut off
    // mid-answer. Report that honestly and tell the user how to continue.
    const budgetExhausted =
      result.stopReason === 'max_tokens' ||
      result.stopReason === 'paused' ||
      result.stopReason === 'time_cap' ||
      result.maxedOut === true;
    // v11.23 (P0) — ONE owner surface per failure: when an error row was
    // emitted, the terminal report repeats that EXACT classified sentence
    // (no second "Run failed:" copy and no raw provider detail).
    const reportNote = lastErrorText ||
      (budgetExhausted ? 'An explicitly configured output/time budget was reached — the answer may be truncated; saved work is preserved.' : '');
    emitTaskReport({
      // v11.23 — `error` is the single source of truth: a provider refusal (or
      // any other path that emitted an error row) can no longer be reported as
      // 'completed' just because its stopReason string is not literally 'error'.
      // v11.26/v11.33 — ANY failed tool call AND a last-call failure both make
      // the outcome 'error' (honest), never a clean 'completed'. Verified gate:
      // toolFailureCount is incremented in emitPrepared for every main-run tool
      // result with ok:false, accumulates across continuation rounds, and is
      // read here after the final round.
      outcome:
        errorEventSent ||
        result.stopReason === 'error' ||
        toolFailureCount > 0 ||
        lastToolCallOk === false
          ? 'error'
          : 'completed',
      stopReason: result.stopReason,
      finalText: result.finalText,
      maxedOut: result.maxedOut,
      partial: budgetExhausted,
      ...(reportNote
        ? { note: reportNote }
        : toolFailureCount > 0
          ? { note: `${toolFailureCount} tool call(s) failed — see the commands below. Nothing was silently completed.` }
          : {}),
    });
    // v12 (HOOKS) — Stop + SessionEnd fire on every terminal path. Best-effort.
    void fireLifecycle(() => runStopHooks(hooksCfg, workspace, params.sessionId, { outcome: result.stopReason }), 'hook:stop');
    void fireLifecycle(() => runSessionEndHooks(hooksCfg, workspace, params.sessionId, { outcome: result.stopReason }), 'hook:session-end');
    sendTurnEnd();

    // ---------- v2.1 MEMORY NUDGE (session-end hook) ----------
    // On run end (the engine's session-end hook), a substantial session (≥6
    // tool calls) leaves a one-line learning summary in MEMORY.md '## Learned'
    // — deduped by similarity prefix so repeated sessions don't pile up.
    if (params.task === 'chat' && !result.aborted && runToolCalls >= MEMORY_NUDGE_MIN_TOOLS) {
      void nudgeSessionMemory({
        workspace,
        toolCalls: runToolCalls,
        files: [...touchedFiles],
        aborted: false,
      }).catch(() => {
        /* the nudge is silent */
      });
    }

    // ---------- v2.2 SKILL SELF-IMPROVEMENT (session-end hook) ----------
    // When a skill WAS used this run and the run went badly (verify failure
    // or ≥1 user deny/correction), fire the skill-writer subagent with a PATCH
    // prompt that appends a '## Refinements' entry to the skill's SKILL.md and
    // bumps its version. At most ONE refinement per skill per session.
    if (
      params.task === 'chat' &&
      !result.aborted &&
      dnaEnabledSetting() &&
      skillsUsedThisRun.size > 0 &&
      (verifyFailedThisRun || denialsThisRun > 0)
    ) {
      const reason = verifyFailedThisRun
        ? 'project verification FAILED during the run'
        : 'the user denied/corrected agent actions during the run';
      for (const slug of skillsUsedThisRun) {
        const key = params.sessionId + '::' + slug;
        if (refinedSkillKeys.has(key)) continue; // once per skill per session
        // v11.31 — bound this process-lifetime set (old entries can never be
        // re-added for a session that already refined them, but an app that
        // runs for days would otherwise grow it without limit).
        if (refinedSkillKeys.size >= 2000) refinedSkillKeys.clear();
        refinedSkillKeys.add(key);
        void (async (): Promise<void> => {
          const before = await skillVersion(workspace, slug);
          const skill = await loadSkill(workspace, slug);
          if (!skill) return;
          const prompt =
            `The workspace skill "${skill.name}" (slug: ${slug}, version ${before}) was used in a session where ${reason}. ` +
            'From the session transcript below, distill ONE refinement that makes this skill better next time: what failed or was corrected, and what to do differently.\n\n' +
            'Output ONLY a JSON object (no code fences): {"topic": "3-8 word label for what went wrong", "refinement": "1-3 concrete sentences of what to do differently next time"}. ' +
            'If nothing generalizable went wrong, output {}.\n\n' +
            '--- SESSION TRANSCRIPT ---\n' +
            transcriptTailForSkill(result.messages);
          const out = await runSubagent('skill-writer', `Refine the "${skill.name}" skill from this session`, prompt);
          let topic = '';
          let refinement = '';
          try {
            const match = /\{[\s\S]*\}/.exec(out);
            const parsed = JSON.parse(match ? match[0] : '{}') as { topic?: unknown; refinement?: unknown };
            if (typeof parsed.topic === 'string') topic = parsed.topic.trim().slice(0, 120);
            if (typeof parsed.refinement === 'string') refinement = parsed.refinement.trim().slice(0, 2000);
          } catch {
            return; // unparseable patch output — skip silently
          }
          if (!topic || !refinement) return; // model said {} — nothing to add
          const version = await appendSkillRefinement(workspace, slug, topic, refinement);
          if (version > 0) {
            ioB.send({ type: 'skill_refined', name: skill.name, version });
            dna.emitDNAEvent('refined', { slug, name: skill.name, version });
          }
        })().catch(() => {
          /* skill refinement is silent */
        });
      }
    }

    // ---------- v2.2 PROACTIVE SKILL SUGGESTION (session-end hook) ----------
    // A DNA workflow pattern with count ≥3 that has NO matching skill yet is a
    // candidate: emit `dna_suggestion` (UI shows a chip; dismissable via
    // kdx:dna:dismissSuggestion). One suggestion per run, best pattern first.
    if (params.task === 'chat' && !result.aborted && dnaEnabledSetting()) {
      try {
        const model = dna.loadDNA(workspace);
        const candidate = [...model.patterns]
          .filter((p) => p.kind === 'workflow' && p.count >= 3 && !dna.isSuggestionDismissed(p.id))
          .sort((a, b) => b.count * b.confidence - a.count * a.confidence)[0];
        if (candidate) {
          const existing = new Set((await listSkills(workspace)).map((s) => s.slug));
          const slug = slugifySkillName(candidate.text.slice(0, 40));
          if (!existing.has(slug)) {
            ioB.send({ type: 'dna_suggestion', kind: 'skill', patternId: candidate.id, text: candidate.text });
            dna.emitDNAEvent('suggestion', { kind: 'skill', patternId: candidate.id, text: candidate.text });
          }
        }
      } catch {
        /* suggestions are best-effort */
      }
    }
  } catch (err) {
    // v11.26 (CONTINUITY) — capture the REAL cause FIRST, before any cleanup in
    // this catch can itself throw. If cleanup blows through, the finally safety
    // net still writes an honest report carrying this exact reason.
    fatalErrorText = err instanceof Error ? err.message : String(err);
    // v11.26 (CONTINUITY) — the WHOLE catch body is guarded. A dead sink (a
    // throw from sendError / the aborted event) or a throwing cleanup must
    // NEVER reject runAgent and strand the caller. The single finally-based
    // safety net below is the one terminal emitter (report + turn_end) on
    // EVERY exit; if this body blows through, that net still fires honestly.
    try {
      // v11.12 (A4-GUARANTEE) — even a crashed PLAN run shows a plan card: the
      // carry text (captured outside the try by runLoop) or the trace-based
      // fallback. Best-effort; the task_report below still fires regardless.
      if (params.task === 'chat' && taskMode === 'plan') {
        try {
          const txt = (planCarryText.trim() || synthesizePlanFallback()).slice(0, 16000);
          if (txt.trim()) ioB.send({ type: 'plan_ready', plan: txt, sessionId: params.sessionId } as AgentEvent);
        } catch {
          /* best-effort */
        }
      }
      activeSubagentRunners.delete(params.sessionId);
      clearGuard(params.sessionId); // v7 — drop the read-before-edit ledger with the run
      clearRunGates(params.sessionId); // v7.1 — drop the gate bundle (ledger/budget/taint/hashes)
      trace.finish({ ok: false, failure: fatalErrorText.slice(0, 200), turns: 0, tools: runToolCalls });
      if (signal.aborted || io.isAborted()) {
        ioB.send({ type: 'aborted' });
        emitTaskReport({
          outcome: 'aborted',
          note: settingsSnapshot.language === 'ar' ? 'تم إيقاف التشغيل.' : 'Run aborted.',
        });
        sendTurnEnd();
        return;
      }
      const errText = friendlyError(err, params.model);
      sendError(errText);
      // v11.23 (P0) — ONE owner surface per failure. The error row already
      // carries errText; the terminal report repeats it VERBATIM (no second
      // "Run failed:" copy, no truncated raw detail, no conflicting language).
      emitTaskReport({ outcome: 'error', note: errText });
      sendTurnEnd();
    } catch {
      /* swallowed — the finally safety net emits the terminal report + turn_end */
    }
  } finally {
    stopLiveness(); // v11.21 — never leak the pre-token heartbeat timer
    // v11.31 (STALE STATE) — catch-all session cleanup. The normal path clears
    // these at 3396/3925 and the catch path at 4237-4239, but the early terminal
    // returns INSIDE the try (compact task, no-key, custom-slash no-op, unknown
    // slash) skipped all of them — leaving a session-scoped RunGates bundle
    // (test ledger / budget / taint / before-hashes) and the subagent host
    // registered for the NEXT run, so an unrelated follow-up inherited stale
    // evidence and gates. All three clears are idempotent; do them here so
    // EVERY exit path is covered by one owner.
    try {
      clearRunGates(params.sessionId);
      clearGuard(params.sessionId);
      activeSubagentRunners.delete(params.sessionId);
    } catch {
      /* cleanup is best-effort — never take the run down */
    }
    // v11.11 (A4-CLOSURE) — THE LAST HOLE, CLOSED. Until now a throw that
    // ORIGINATED INSIDE the catch block itself (trace/gate cleanup, io
    // failure on the error event…) skipped BOTH the task_report and the
    // turn_end — the exact "ended silently, UI stuck streaming" incident
    // the founder reported. The finally below runs on EVERY exit of the
    // run body (normal returns included — the guards make it a no-op
    // there) and guarantees the two terminal events ALWAYS fire, in the
    // contract order: task_report first, turn_end last.
    // v11.26 (CONTINUITY) — SINGLE finally-based safety net. Runs on EVERY
    // exit of the run body (normal returns included — guards make it a no-op
    // there) and guarantees BOTH terminal events, in contract order:
    // task_report FIRST, turn_end LAST. The report is HONEST — outcome, files
    // changed, commands run, duration and next steps all come from the run's
    // OWN captured evidence (emitTaskReport never fabricates success). When a
    // path blew through, the classified REAL cause is carried into the note.
    try {
      if (!taskReportSent) {
        safetyNetReport = true;
        const aborted = signal.aborted || io.isAborted();
        const ar = settingsSnapshot.language === 'ar';
        const reason = fatalErrorText || lastErrorText;
        let honestNote: string;
        if (aborted) {
          honestNote = ar ? 'تم إيقاف التشغيل.' : 'Run aborted.';
        } else if (reason) {
          try {
            honestNote = friendlyError(new Error(reason), params.model);
          } catch {
            honestNote = reason.slice(0, 240);
          }
        } else {
          honestNote = ar
            ? 'تعذّر إكمال التشغيل. أعد المحاولة، أو بدّل المزوّد/النموذج من الإعدادات ← مزودو الذكاء الاصطناعي.'
            : 'Run could not be completed. Retry, or switch the provider/model in Settings → AI providers.';
        }
        emitTaskReport(
          aborted ? { outcome: 'aborted', note: honestNote } : { outcome: 'error', note: honestNote },
        );
      }
    } catch {
      /* the report is best-effort — the raw fallback + turn_end below are the guarantee */
    }
    // v11.26 — if even emitTaskReport's send failed (dead/one-shot sink), do a
    // RAW last-ditch report so the run NEVER ends silently. Still honest: the
    // real outcome, the real touched files/commands and the real duration.
    if (!reportDelivered) {
      try {
        io.send({
          type: 'task_report',
          outcome: lastReportOutcome ?? (signal.aborted || io.isAborted() ? 'aborted' : 'error'),
          summary: (fatalErrorText || lastErrorText || 'Run ended before a completion report could be written.').slice(0, 400),
          files: [...touchedFiles].slice(0, 50).map((f) => f.replace(/\\/g, '/')),
          commands: commandsRun.slice(-20).map((c) => ({ cmd: c.cmd, ok: c.ok })),
          nextSteps: ['Review the conversation above, then retry or send a follow-up to continue.'],
          durationMs: Math.max(0, Date.now() - runStartedAt),
        } as AgentEvent);
        reportDelivered = true;
      } catch {
        /* nothing further can be delivered */
      }
    }
    sendTurnEnd();
    // v11.11 (A4-CLOSURE) — close the run journal LAST, whatever the exit:
    // the finish line is then always queued AFTER the journaled task_report
    // (same per-file queue, order preserved) and the journal summary reads
    // the REAL outcome (completed / aborted / error) instead of "crashed".
    try {
      finishRunJournal(
        journalFile,
        lastReportOutcome ?? (signal.aborted || io.isAborted() ? 'aborted' : 'error'),
        safetyNetReport ? 'terminal report emitted by the finally safety net' : undefined,
      );
    } catch {
      /* the journal must never take the run down */
    }
    // v11.24 — the full machine-capability probe is deliberately NEVER kicked
    // from the run path. Its cold call synchronously loads node:sqlite (~5s) and
    // spawns 21 version probes; even a deferred kick starved the event loop long
    // enough to trip a short engine-idle watchdog on the NEXT back-to-back run.
    // The advisory summary is available on demand through the `env_probe` tool,
    // so the first-token path (and the run boundary) stays completely free of it.
  }

  // ============================================================
  // The loop itself (shared by main run and subagents)
  // ============================================================

  /** Emit goal_progress once per turn boundary while a session goal is active. */
  function emitGoalProgress(): void {
    try {
      const g = sessionGoals.get(params.sessionId);
      if (!g) return;
      g.turns++;
      const pct =
        g.todoDone !== null && g.todoTotal > 0
          ? g.lastPct
          : Math.min(GOAL_HEURISTIC_MAX_PCT, g.turns * 5);
      g.lastPct = pct;
      ioB.send({
        type: 'goal_progress',
        goal: g.goal,
        pct,
        note:
          g.todoDone !== null && g.todoTotal > 0
            ? `${g.todoDone}/${g.todoTotal} todos complete`
            : `turn ${g.turns} — no todo list yet`,
      });
    } catch {
      /* progress events are best-effort */
    }
  }

  async function agentLoop(o: {
    system: string;
    messages: ProviderMsg[];
    tools: ToolDef[];
    ctx: ToolContext;
    maxIters: number;
    stream: boolean;
    hooks?: HooksConfig;
    /** Set for subagent runs — enables `⎿ [label i/N] step` progress lines. */
    progressLabel?: string;
    /** v2.1 — subagent progress id (emits `subagent_progress` events). */
    progressId?: string;
    /** v7.1 — verifier/role override: run this loop on a DIFFERENT model + creds. */
    modelOverride?: ModelConfig;
    credsOverride?: { apiKey?: string; baseUrl?: string };
  }): Promise<{
    finalText: string;
    stopReason: string;
    usage: Usage; // cumulative RUN totals (this call only — outer accumulates)
    lastTurn: Usage; // per-turn delta (display)
    aborted: boolean;
    maxedOut: boolean;
    /** Final transcript — continuation rounds chain on this. */
    messages: ProviderMsg[];
  }> {
    const messages = [...o.messages];
    // Incremental transcript size (chars) — replaces the old O(n²)
    // JSON.stringify(messages).length check per iteration.
    const transcript = createTranscriptTracker(messages);
    const pushMessage = (m: ProviderMsg): void => {
      messages.push(m);
      transcript.push(m);
    };
    // Run-level usage totals. Every loop turn re-sends the growing transcript,
    // so providers bill input PER TURN — summing turns is the true run cost
    // (the old code overwrote the total each turn).
    const runUsage = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0, costUsd: 0 };
    // v11.10 (A5) — PER-ATTEMPT LEDGER: EVERY model call this run makes (dead
    // or alive) is attributed provider/model + usage. Failover/retry spend used
    // to vanish silently (only the surviving attempt was counted) — now
    // sum(attempts) == runUsage exactly, and the Usage tab can show the honest
    // multi-attempt cost ("attempt 1 provider X · attempt 2 provider Y").
    const attemptLedger: UsageAttempt[] = [];
    const runUsageTotals = (): Usage => ({
      inputTokens: runUsage.inputTokens,
      outputTokens: runUsage.outputTokens,
      costUsd: Math.round(runUsage.costUsd * 1e6) / 1e6,
      // v11.10 (A5) — ride-alongs consumed by the outer accumulator and the
      // message_end payload: run cache totals + the per-attempt breakdown.
      runCacheRead: runUsage.cacheRead,
      runCacheCreation: runUsage.cacheCreation,
      attempts: attemptLedger.map((a) => ({ ...a })),
    });
    let lastTurn: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    let finalText = '';
    let stopReason = 'end_turn';
    // v1.5 — verbatim-window compaction state + stall detection.
    let compactSoFar = '';
    const recentBatches: string[] = [];
    let stallsInjected = 0;
    // v11.32 — repeated-FAILURE breaker (distinct from the read-only STALL_NUDGE
    // above and from the doom gate below, which needs user approval). Counts are
    // keyed by tool+stable-args fingerprint. After 2 failed executions of the
    // SAME fingerprint the tool is HARD-BLOCKED in the dispatch path (no third
    // executeTool ever happens); the corrective fires ONCE per fingerprint and
    // NEVER ends the run — it only redirects. A SUCCESS on that fingerprint
    // clears both the count and the block.
    const repeatedFailureCounts = new Map<string, number>();
    const correctedFailures = new Set<string>();
    /** Fingerprints that already failed twice — the 3rd+ call is never executed. */
    const blockedFingerprints = new Set<string>();
    /** Call ids short-circuited by the breaker (no UI tool_start/tool_result pair). */
    const breakerBlockedCallIds = new Set<string>();
    let lastFailureFingerprint = '';
    // v11.37 — NORMALIZED breaker state. The strict fingerprint above misses a
    // stubborn model that rewrites the same failing call cosmetically (path
    // separators, key order, an extra brace, a nested tool/args wrapper). These
    // maps recognise that as the SAME failure and stop it after 2 dispatches.
    const normalizedFailureCounts = new Map<string, number>();
    const normalizedBlocked = new Set<string>();
    /** The tool's OWN actionable error for a fingerprint (relayed verbatim). */
    const actionableFixByKey = new Map<string, string>();
    /** Emit the corrective notice ONCE per fingerprint — never notice spam. */
    const loopNoticesSent = new Set<string>();
    // v2.2 — doom-loop detector state: the last 6 call hashes (window) drives
    // both the consecutive-3 rule and the alternating-period rules.
    const doomWindow: string[] = [];
    // v7 — stagnation guard state (no-NEW-evidence window).
    let lastEvidenceCount = -1;
    let stagnantTurns = 0;
    let stagnantNudges = 0;
    // v2.1 — auto-verify loop state (edit streak + consecutive verify budget).
    let editStreak = 0;
    let verifyStreak = 0;
    // v2.3 — refusal auto-recovery budget (max 2 corrective nudges per run).
    let refusalsInjected = 0;
    // v8 — unapplied-code gate budget (max 2 agency nudges per run).
    let unappliedCodeNudges = 0;
    // v3.1 — max_tokens auto-continue budget (raised per-loop by v11.10).
    let maxTokensContinues = 0;
    // v11.10 — Anthropic pause_turn re-request budget (separate from max_tokens).
    let pauseContinues = 0;
    // v11.32 — the "still reasoning" marker is now emitted at most ONCE for the
    // whole RUN. It used to be a per-iteration flag while `thinkingStartedAt`
    // is run-scoped, so a stuck tool-failure loop produced an endless stream of
    // "[thinking 58s / 64s — still reasoning]" markers instead of a redirect.
    let thinkQuietMarkerSent = false;
    // v11.10 — task-budget confirmation state: WARN at 80%, ask to CONTINUE at
    // the limit (never a silent kill), wrap up only after an explicit denial.
    let budgetWarned = false;
    let budgetWrapUp = false;
    /** Raised ceiling after a user-approved continuation (null = settings limit). */
    let budgetLimitUsd: number | null = null;
    // v11.10 — run wall-clock cap state (wrap-up injected once, grace, hard stop).
    let timeCapInjected = false;

    // v11.34 (CTX-1) — auto-compaction engages only NEAR the model's REAL window.
    // Resolution order matches kdx:model:info (so the engine and the orb agree):
    //  1) the provider-reported EXACT window from the live OpenRouter catalog,
    //  2) the curated per-model catalog table, 3) the honest 200k default.
    // Previously this used only the table AND triggered at 65% of it — a 1M
    // model that missed the table was compacted at 130k (13% of its window),
    // which is the founder's "context always full / always compacting" bug.
    const reportedCtx = openrouterContextFor(params.model.model);
    const catalogCtx = contextWindowInfo(params.model.model);
    const ctxWindowTokens = Math.max(8_000, reportedCtx ?? catalogCtx.ctx);
    const ctxCapChars = Math.floor(ctxWindowTokens * CHARS_PER_TOKEN);
    const ctxTargetChars = Math.floor(ctxCapChars * 0.8);
    /** v11.34 — 90% of the REAL window: the default compaction trigger. */
    const compactTokenThreshold = compactionThresholdTokens(ctxWindowTokens);
    let lastRealInputTokens = 0; // updated from provider usage each turn

    /** v7 — PINNED context: goal, plan and user constraints NEVER get summarized away. */
    const pinnedContext = (): string => {
      const parts: string[] = [];
      const g = sessionGoals.get(params.sessionId);
      if (g?.goal) parts.push(`[ACTIVE GOAL — must not be lost] ${g.goal}`);
      const p = sessionPlans.get(params.sessionId);
      if (p?.plan?.steps?.length) {
        parts.push(
          '[APPROVED PLAN — still authoritative]\n' +
            p.plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
        );
      }
      const mode = sessionTaskModes.get(params.sessionId);
      if (mode && mode !== 'build') parts.push(`[TASK MODE] ${mode}`);
      // v12 — user/agent-pinned context survives pruning + compaction.
      const pinTxt = renderPins(params.sessionId);
      if (pinTxt) parts.push(pinTxt);
      return parts.join('\n\n');
    };

    /** v7 — prune huge OLD tool results into the recall vault (every turn boundary). */
    const pruneOldToolResults = (): void => {
      try {
        pruneToolResults(params.sessionId, messages, { minChars: 2_400, keepRecent: 6 });
      } catch {
        /* pruning is best-effort */
      }
    };

    /** v2.1 — focus keywords from recent user messages (drives the summary). */
    const focusKeywords = (): string => {
      const userTexts = messages
        .filter((m) => m.role === 'user')
        .slice(-3)
        .map((m) => (m.role === 'user' ? m.text : ''));
      return extractKeywords(userTexts.join(' '));
    };

    /** v2.1 — index of the first of the last 2 tool results (kept verbatim). */
    const keepLastToolResults = (): number => {
      let kept = 0;
      let start = messages.length;
      for (let i = messages.length - 1; i >= 1 && kept < 2; i--) {
        if (messages[i].role === 'tool_result') {
          kept++;
          start = i;
        }
      }
      return start;
    };

    /** v2.1 — verify-gate conditions (autoEdit/fullAccess, setting ON, chat task). */
    const canAutoVerify = (): boolean =>
      params.task === 'chat' &&
      cfg.autoVerify !== false &&
      (currentMode() === 'autoEdit' || currentMode() === 'fullAccess');

    /** v2.1 — the project's verify command (user override → auto-detect, cached per run). */
    const verifyCommandFor = async (): Promise<string | null> => {
      if (cfg.verifyCommand && cfg.verifyCommand.trim()) return cfg.verifyCommand.trim();
      if (verifyCmdCache === undefined) {
        verifyCmdCache = await detectProjectTestCommand(workspace).catch(() => null);
      }
      return verifyCmdCache?.command ?? null;
    };

    /**
     * v2.1 VERIFY LOOP — engine-run project verification after an edit burst.
     * Uses the INTERNAL run pathway (runCaptured, no approval ping-pong: the
     * engine verifies its own work like the post-run verify step). Emits
     * `verify_run` and feeds the result to the model as a system note.
     * v11.10 (A4) — returns the verdict {cmd, exitCode, outputTail} (or null
     * when there is nothing to run) so the DEBUG post-fix loop can branch on
     * it; existing callers ignore the return value.
     */
    const runAutoVerify = async (): Promise<{ cmd: string; exitCode: number; outputTail: string } | null> => {
      const cmd = await verifyCommandFor();
      if (!cmd) return null;
      // v7.1 — IMPACT-DRIVEN VERIFICATION: run only the tests that exercise the
      // changed files (coverage → import graph → naming). A runner that cannot
      // narrow keeps the full suite — narrowing must never silently skip tests.
      let effectiveCmd = cmd;
      try {
        if (cfg.impactVerify !== false && absTouched().length > 0) {
          const sel = await selectAffectedTests(workspace, absTouched());
          if (sel.tests.length > 0) {
            const narrowed = buildNarrowedCommand(cmd, sel.tests);
            if (narrowed) {
              effectiveCmd = narrowed;
              notice('sys', `\n[impact] ${sel.note} → narrowed: ${effectiveCmd}\n`);
            } else {
              notice('sys', `\n[impact] ${sel.note} → runner cannot narrow, full suite runs\n`);
            }
          }
        }
      } catch {
        /* selection is best-effort — full suite runs */
      }
      if (o.stream) notice('sys', `\n[auto-verify] ${effectiveCmd}\n`);
      const vStarted = Date.now();
      let exitCode = 0;
      let output = '';
      try {
        const r = await runCaptured(effectiveCmd, workspace, 600_000, { signal });
        exitCode = r.exitCode;
        output = r.output ?? '';
      } catch {
        exitCode = -1;
        output = signal.aborted ? '[aborted]' : '[command failed to start]';
      }
      // v7.1 — the harness test ledger: auto-verify is a first-class run.
      try {
        gates.recordTestRun(exitCode === 0 ? 'after' : 'red', effectiveCmd, exitCode, output, Date.now() - vStarted);
      } catch {
        /* ledger is best-effort */
      }
      const tail = output.length > VERIFY_TAIL_CHARS ? output.slice(-VERIFY_TAIL_CHARS) : output;
      ioB.send({ type: 'verify_run', cmd: effectiveCmd, exitCode, outputTail: tail });
      pushMessage({
        role: 'user',
        text:
          `${SYSTEM_NOTE_PREFIX}Auto-verify ran \`${effectiveCmd}\` → exit code ${exitCode}. ` +
          (exitCode === 0
            ? 'Verification PASSED — continue with the task.'
            : `Verification FAILED — read the output tail below, fix the failures, then re-run the command yourself to confirm.\n\n${tail}`),
      });
      return { cmd: effectiveCmd, exitCode, outputTail: tail };
    };

    // Subagent visibility: piggyback compact progress lines on text_delta
    // (zero AgentEvent type changes). Format: `⎿ [implementer 2/12] tool:read_file src/App.tsx`
    // v2.1 — ALSO emits `subagent_progress` {id, label, done, total} so the UI
    // can render a live progress bar for inline AND background subagents.
    let iter = 0; // current loop iteration (read by the progress closure)
    const progressLabel = o.progressLabel;
    const progressId = o.progressId;
    /**
     * v11.36 (CHILD-SESSION) — only calls that REALLY reached executeTool get a
     * row in the subagent's own transcript. A malformed / breaker-blocked /
     * hook-vetoed call has no real execution to show, so it never enters here.
     */
    const subagentDispatchedCalls = new Set<string>();
    const subNote = progressLabel
      ? (step: string): void => {
          notice('progress', `\n⎿ [${progressLabel} ${Math.min(iter + 1, o.maxIters)}/${o.maxIters}] ${step}\n`);
          if (progressId) {
            const done = Math.min(iter + 1, o.maxIters);
            ioB.send({
              type: 'subagent_progress',
              id: progressId,
              label: progressLabel,
              done,
              total: o.maxIters,
            });
            // v11.12 — mirror into the persistent Subagents dashboard ledger.
            try {
              subagents.progressSubagent(progressId, done, o.maxIters);
            } catch {
              /* dashboard is best-effort */
            }
          }
        }
      : null;

    for (; iter < o.maxIters; iter++) {
      if (io.isAborted() || signal.aborted) {
        return { finalText, stopReason, usage: runUsageTotals(), lastTurn, aborted: true, maxedOut: false, messages };
      }

      // v11.33 (ENDURANCE) — RUN WALL-CLOCK CAP is DISABLED BY DEFAULT.
      // A default run is unbounded: hours/days until done, user abort, or a
      // genuinely dead provider. A cap is enforced ONLY when an operator/tests
      // EXPLICITLY set SURNIA_MAX_RUN_MS (or opt into Long Run mode, which sets
      // it to 8h). When present it is GRACEFUL: at the cap the model is asked to
      // wrap up; after SURNIA_TIME_CAP_GRACE_MS (default 10min) the loop returns
      // stop_reason 'time_cap' — never a mid-stream kill. Main runs only.
      if (o.stream && wallClockCapExplicit()) {
        const cap = runWallClockCapMs();
        if (cap > 0) {
          const elapsed = Date.now() - runStartedAt;
          if (elapsed > cap && !timeCapInjected) {
            timeCapInjected = true;
            notice('sys', `\n[time cap] run reached its wall-clock cap (${(cap / 3_600_000).toFixed(1)}h — SURNIA_MAX_RUN_MS) — wrapping up now\n`);
            pushMessage({
              role: 'user',
              text:
                `${SYSTEM_NOTE_PREFIX}The run reached its wall-clock cap (${(cap / 3_600_000).toFixed(1)}h). ` +
                'Wrap up NOW: finish or safely stop the current step, save any unsaved work, then summarize what is done and what remains. Do not start new work.',
            });
          } else if (timeCapInjected && elapsed > cap + timeCapGraceMs()) {
            notice('sys', '\n[time cap] grace period over — ending the run\n');
            // v11.36 — a cap-forced stop is visible AND carries an honest final
            // text (the model may never have written one).
            if (o.stream && !finalText.trim()) finalText = silentStopFallback('the wall-clock time cap was reached');
            return { finalText, stopReason: 'time_cap', usage: runUsageTotals(), lastTurn, aborted: false, maxedOut: false, messages };
          }
        }
      }

      // v2 turn boundary (main run only): deliver user messages queued while
      // the agent was working, and report /goal progress, BEFORE streaming a
      // new model turn. Subagent loops have no session queue and never stream.
      if (o.stream) {
        const drained = drainSessionQueue(params.sessionId);
        for (const item of drained) pushMessage({ role: 'user', text: queueItemText(item) });
        if (drained.length) ioB.send({ type: 'queued_count', n: 0 });
        emitGoalProgress();
      }

      // v7 — context hygiene BEFORE the compaction check: old huge tool
      // results move to the recall vault (the model can pull any back with
      // recall_result(id)); then the token-driven auto-compact runs.
      pruneOldToolResults();

      // v7 — STAGNATION DETECTOR (no-NEW-evidence rule, not just identical
      // repetition): if K consecutive turns produced no new touched files and
      // no new commands, force a strategy change (re-read, new hypothesis,
      // different tool class) — bounded injections, then surface to the user.
      // Main run only — subagent loops don't record evidence ledgers.
      if (o.stream) {
        const evidenceNow = touchedFiles.size * 1000 + commandsRun.length;
        if (evidenceNow === lastEvidenceCount) {
          stagnantTurns++;
        } else {
          lastEvidenceCount = evidenceNow;
          stagnantTurns = 0;
        }
        if (stagnantTurns >= STAGNANT_TURNS_THRESHOLD && stagnantNudges < 2) {
          stagnantNudges++;
          stagnantTurns = 0; // reset the window after each intervention
          pushMessage({ role: 'user', text: STAGNANT_NUDGE });
          notice('guard', '\n[stagnation guard] no new evidence for several turns — strategy change injected\n');
        } else if (stagnantTurns === STAGNANT_TURNS_THRESHOLD + 2 && stagnantNudges === 2) {
          // escalation surface: the user must know the run is spinning
          notice('guard', '\n[stagnation guard] the run is still not producing new evidence — consider steering it or aborting (Esc).\n');
        }
      }

      // ---------- auto-compact (settings.agent.autoCompact, default ON) ----------
      // v11.35 (COMPACTION ROOT FIX) — ONE gate: 90% of the model's REAL window.
      // V11 added the 90% token rule but LEFT an OR'd fixed small-count path:
      //   charsTrigger = lastRealInputTokens === 0
      //       && transcript.chars >= Math.min(cfg.compactThreshold /* ≥10,000 */, …)
      // That meant a provider returning no usage (u.inputTokens === 0 — common
      // on OpenAI-compatible/local endpoints and on early stream failures) kept
      // lastRealInputTokens at 0, and compaction fired at a FIXED 10k–120k chars
      // ≈ 2,857–34,285 tokens = 0.29–3.4% of a 1M window. That is the founder's
      // "barely two words → context compressor" path. It is removed. The only
      // chars fallback left is DERIVED FROM THE REAL WINDOW, so nothing can
      // compact below the model's actual ceiling. User /compact stays separate.
      if (cfg.autoCompact !== false && messages.length > 1) {
        const realTokenTrigger = isCompactionEligible(lastRealInputTokens, ctxWindowTokens);
        // Honest fallback (no provider count yet): 90% of the REAL window,
        // expressed in chars — never a fixed user-set small count.
        const windowCharsCap = Math.floor(compactTokenThreshold * CHARS_PER_TOKEN);
        const charsTrigger = lastRealInputTokens === 0 && windowCharsCap > 0 && transcript.chars >= windowCharsCap;
        if (realTokenTrigger || charsTrigger) {
          const pctBefore = Math.min(100, Math.round(((lastRealInputTokens || transcript.chars / CHARS_PER_TOKEN) / ctxWindowTokens) * 100));
          // VERBATIM TAIL (not a trigger): how much recent context to keep
          // unchanged AFTER the real-window gate has fired. The user's legacy
          // compactThreshold (chars, min 10k) still bounds this tail — it can
          // NO LONGER trigger a compaction. Without it, a sane bounded default
          // keeps a compaction from silently keeping the whole transcript.
          const tailCapChars = cfg.compactThreshold
            ? Math.max(10_000, Math.floor(cfg.compactThreshold))
            : Math.min(windowCharsCap, 40_000);
          const tailBudget = Math.max(4_000, Math.floor(tailCapChars * 0.35));
          let tailChars = 0;
          let tailStart = messages.length;
          while (tailStart > 1) {
            const c = msgChars(messages[tailStart - 1]);
            if (tailChars + c > tailBudget) break;
            tailStart--;
            tailChars += c;
          }
          // v2.1 — keep the last 2 tool results verbatim even below the budget.
          const toolResultStart = keepLastToolResults();
          if (toolResultStart < tailStart) tailStart = toolResultStart;
          // keep assistant(toolCalls) with their tool_results — never split a pair
          for (;;) {
            if (tailStart <= 1) break;
            const m = messages[tailStart - 1];
            const calls = 'toolCalls' in m ? m.toolCalls : undefined;
            if (!calls || calls.length === 0) break;
            tailStart--;
          }
          const head = messages.slice(0, tailStart);
          const tail = messages.slice(tailStart);
          if (head.length >= 2) {
            let merged = compactSoFar;
            try {
              // v2.1 — focus instruction: recent user-message keywords steer
              // the summary toward what the user actually asked for.
              const focus = focusKeywords();
              const focusNote = focus ? `\n\nFocus especially on the user's recent topics: ${focus}.` : '';
              // v12 (CONTINUITY FIX) — the compaction call declares tools:[].
              // Feeding raw tool_use / tool_result blocks into a tools:[] request
              // makes Anthropic AND OpenAI-compatible endpoints 400 — the #1
              // cause of "disconnects right after compaction". Flatten every
              // message to plain text before sending.
              const flatHead: ProviderMsg[] = head.map((m: any) => {
                if (m.role === 'assistant') {
                  return { role: 'assistant', text: String(m.text ?? '').slice(0, 4000) || '(tool-use step)' } as ProviderMsg;
                }
                if (m.role === 'tool_result' || m.role === 'tool') {
                  return { role: 'user', text: `[tool result] ${String(m.content ?? m.text ?? '').slice(0, 800)}` } as ProviderMsg;
                }
                return m;
              });
              const headMsgs: ProviderMsg[] = compactSoFar
                ? [
                    {
                      role: 'user',
                      text:
                        '[Previous running summary of the older context:]\n' +
                        `${compactSoFar}\n\n[Newer messages to fold into the summary:]`,
                    },
                    ...flatHead,
                  ]
                : flatHead;
              // v12 — compaction gets its OWN abort controller linked to the run
              // signal, and a 1-second heartbeat so the renderer watchdog never
              // declares a false disconnect while the engine is compacting.
              const compactAc = new AbortController();
              const onRunAbortCompact = (): void => { try { compactAc.abort(); } catch { /* ignore */ } };
              if (signal.aborted) compactAc.abort();
              else signal.addEventListener('abort', onRunAbortCompact, { once: true });
              let lastCompactPing = 0;
              const pingCompact = (): void => {
                const n = Date.now();
                if (n - lastCompactPing >= 1000) {
                  lastCompactPing = n;
                  ioB.send({ type: 'heartbeat', phase: 'compacting' } as AgentEvent);
                }
              };
              const cres = await streamTurn({
                model: params.model,
                apiKey: creds.apiKey,
                baseUrl: creds.baseUrl,
                system: COMPACT_SYSTEM + focusNote,
                messages: headMsgs,
                tools: [],
                signal: compactAc.signal,
                promptCaching: false,
                maxRetries: cfg.maxRetries,
                onText: (t) => {
                  merged += t;
                  pingCompact();
                },
                onThinking: () => pingCompact(),
                onHeartbeat: () => pingCompact(),
                onUsage: () => pingCompact(),
                onToolUse: () => {
                  /* no tools in play */
                },
              }).finally(() => {
                signal.removeEventListener('abort', onRunAbortCompact);
              });
              if (cres.stopReason !== 'error' && merged.trim()) {
                compactSoFar = merged.trim().slice(0, 40_000);
                // v11.15 (A7) — persist the CUMULATIVE memory snapshot at the
                // compaction boundary and build the advisory carry-forward
                // block (original task / decisions / files / preferences /
                // pending steps). The FULL facts stay on disk; the block is
                // self-describing and never a user rule. buildCompactionMemory
                // never throws, but the try keeps this strictly best-effort.
                let cmBlock = '';
                try {
                  const cm = buildCompactionMemory({
                    head,
                    rawMessages: params.messages,
                    summary: merged,
                    workspace,
                    userDataDir: electronUserDataDirSafe(),
                    sessionId: params.sessionId,
                    reason: 'auto-compact',
                  });
                  cmBlock = cm.block || '';
                } catch {
                  /* advisory cumulative memory must never break compaction */
                }
                const pinned = pinnedContext();
                // v12 — ALSO preserve the ORIGINAL task statement. Without a
                // /goal the first user message was previously discarded at
                // compaction, so the model forgot WHAT it was building.
                // FIX: params.task is only the KIND ('chat'), not the user's
                // request — preserve the REAL original task from the transcript.
                const originalTask = originalTaskText(head, params.messages);
                const taskNote = originalTask ? `[ORIGINAL TASK — still authoritative]\n${originalTask}\n\n` : '';
                // v11.15 — carry real decisions / files touched / pending steps
                // across the compaction boundary so the agent NEVER forgets.
                let continuityNote = '';
                try {
                  const cont = gates.continuity?.preamble?.();
                  if (cont) continuityNote = `${cont}\n\n`;
                } catch { /* best-effort advisory */ }
                messages.length = 0;
                messages.push({
                  role: 'user',
                  text:
                    (pinned ? pinned + '\n\n' : '') +
                    taskNote +
                    continuityNote +
                    `[Conversation auto-compacted: older context summarized below in a structured form. ` +
                    'The most recent messages follow verbatim — resume the task from here.]\n\n' +
                    compactSoFar,
                });
                // v11.15 (A7) — messages[0] is the compaction note above. Attach
                // the advisory cumulative-memory block so the agent NEVER
                // forgets the real task / decisions / files / pending steps
                // across THIS or any FUTURE compaction (and after a restart).
                if (cmBlock && messages[0].role === 'user') {
                  (messages[0] as { text: string }).text += '\n\n' + cmBlock;
                }
                for (const m of tail) messages.push(m);
                transcript.replaceAll(messages); // re-base the incremental counter
                lastRealInputTokens = 0; // v7 — reset the trigger until the next real measurement
                // v2.1 — compaction telemetry with context-window percentages.
                const pctAfter = Math.min(100, Math.round(((lastRealInputTokens || transcript.chars / CHARS_PER_TOKEN) / ctxWindowTokens) * 100));
                ioB.send({ type: 'compaction', before: pctBefore, after: pctAfter });
                if (o.stream) notice('compact', `\n\n[auto-compacted older context — ${pctBefore}% → ${pctAfter}% of the context window; recent work kept verbatim]\n\n`);
              } else if (cres.stopReason === 'error') {
                // v11.23 — a FAILED compaction call was completely silent:
                // no swap, no notice, no telemetry. The run limped on with a
                // bloated transcript until the next provider 3240. Surface it
                // once (deduped) instead of failing open invisibly.
                notice('compact', '\n[auto-compaction model call failed — keeping the full conversation; the run continues.]\n');
              }
            } catch (err) {
              // v11.9 (E14) — compaction stays best-effort, but never invisible
              // (deduped sys_notice; cannot spam across loop iterations).
              notice('compact', `[compaction failed: ${briefErr(err)}]`);
            }
          }
        }
      }

      const textParts: string[] = [];
      // Map preserves first-seen order; each onToolUse overwrites with the
      // latest accumulated args, and providers always flush the complete JSON.
      const pending = new Map<string, { name: string; args: string }>();
      let notedThinking = false; // one progress line per iteration, not per delta
      // v12 (STREAMING CONTINUITY) — long PURE-thinking streams (no answer text
      // yet) can look dead even though reasoning is flowing into the thinking
      // block. Emit a quiet sys_notice('thinking') with a live seconds counter,
      // but no earlier than 2s in and at most once per 2s thereafter — enough
      // to prove liveness, never a per-token spam. Subagent runs already have
      // their own `⎿ [label i/N] thinking` progress line, so they are excluded.
      let lastThinkNoticeAt = 0;

      // v11.3 — thinking streams on its own think_delta channel into the
      // dedicated thinking block. NO <thinking> tags ever touch the text
      // stream, so the answer stays clean markdown end to end.
      let thinkingOpen = false;
      const openThinking = (): void => {
        thinkingOpen = true;
      };
      const closeThinking = (): void => {
        thinkingOpen = false;
      };

      // ---------- model turn, with engine-level retry for transient failures ----------
      // Providers retry HTTP-level hiccups internally; THIS retry covers
      // mid-stream deaths (stopReason 'error' / thrown). Backoff 600ms → 30s
      // (±20% jitter), SIX transparent retries per provider before failover.
      // v7 FAILOVER: after the local retries exhaust, the run switches to the
      // next model in the failover chain (different configured provider) with
      // the FULL conversation state preserved — a rate limit on one vendor no
      // longer kills a long task mid-flight.
      // v11.10 ENDURANCE: a stream that dies MID-ANSWER (after visible deltas)
      // no longer fails the turn. The partial text is COMMITTED to the
      // transcript (assistant partial + continuation note) and the SAME task
      // auto-continues — on this provider, then across the failover chain.
      // Already-executed tools are safe by construction: they live in
      // `messages` as assistant(toolCalls)+tool_result pairs, and a dead
      // attempt's pending args never dispatched (tool_start fires only after
      // a complete turn) — only accumulators are reset (v11.9 E2/E8).
      let result: StreamResult | null = null;
      // v11.10 (A5) — provider/model of the attempt that DELIVERED (captured at
      // the success break; the failover-loop scope is gone by the accounting).
      let delivered: { provider: string; model: string } | null = null;
      let lastErr: unknown = null;
      let partialUsage: Usage | null = null; // v11.9 (E15) — failed attempt's usage snapshot
      let dropContinues = 0; // v11.10 — mid-stream auto-continues spent in THIS iteration
      const retryDelays = turnRetryDelays();
      const continueBudget = streamContinueBudget();
      // v11.20 (A6/A2) — FAILOVER GATE + NO DOUBLE-CALL.
      // router.failoverChain() now returns the user's OWN model as entry #0,
      // followed by alternates — but the loop below already attempts the
      // primary at failoverIdx=-1, so trying entry #0 again would call the
      // SAME model TWICE (doubling latency). Keep ONLY alternates (slice(1)).
      // The gate is OFF by default: no cross-provider switching unless the
      // user opted in with agent.allowModelFailover === true. A single
      // configured provider also yields no alternates (router enforces it).
      // v11.31 — use the ONE run-start settings snapshot. The old code called
      // cachedStoreService.getSettings() here, re-reading + migrating +
      // decrypting settings.json on EVERY turn of every long run (a disk IO
      // per iteration, off the first-token path but pure waste across hours).
      const failoverSettings = fullSettings();
      const primaryAttempt = o.modelOverride ?? params.model;
      const failover = isFailoverEnabled(failoverSettings)
        ? failoverChain(failoverSettings, params.model)
            .slice(1) // drop entry #0 (the already-attempted primary model)
            .filter((r) => r.provider !== primaryAttempt.provider || r.model !== primaryAttempt.model)
        : [];
      // v11.20 — at most ONE consolidated, quiet fallback notice per RUN
      // (the old code emitted a raw "[failover] … failed (…JSON…)" on every
      // switch — the founder's "فيل أوفر فيل أوفر" wall of text).
      let failoverNoticeSent = false;
      // v11.9 (E17) — FAILOVER IS AN INNER LOOP: provider-failure retries happen
      // INSIDE the same iteration (the old `continue` burned one maxIters slot
      // per provider failure). The outer budget stays for real work; every
      // outer turn still re-runs the abort/compaction/stagnation guards.
      for (let failoverIdx = -1; ; failoverIdx++) {
        const fo = failoverIdx >= 0 ? failover[failoverIdx] : null;
        const fCreds = fo ? refCreds(fullSettings(), fo) : null;
        // v11.10 (A5) — attribute attempts to the RIGHT provider/model even
        // mid-failover (the ledger itself lives at run scope).
        const attemptModel = (): { provider: string; model: string } =>
          o.modelOverride
            ? { provider: o.modelOverride.provider, model: o.modelOverride.model }
            : fo
              ? { provider: fo.provider, model: fo.model }
              : { provider: params.model.provider, model: params.model.model };
        /**
         * v11.10 (A5) — a DEAD attempt's billed tokens must never vanish:
         * capture its usage snapshot (REAL when the provider reported one
         * mid-stream — a dead stream can never run the chars/4 fallback flush)
         * or an honest transcript-based estimate (marked `estimated`), then add
         * it to the run totals immediately.
         */
        const ledgerDeadAttempt = (): void => {
          const prov = attemptModel();
          const snap = partialUsage;
          partialUsage = null; // consumed — a later attempt's snapshot must not double-count
          const entry: UsageAttempt = snap
            ? {
                provider: prov.provider,
                model: prov.model,
                inputTokens: Math.max(0, snap.inputTokens),
                outputTokens: Math.max(0, snap.outputTokens),
                costUsd: snap.costUsd > 0 ? snap.costUsd : 0,
                cacheReadTokens: Math.max(0, snap.cacheReadTokens ?? 0),
                cacheCreationTokens: Math.max(0, snap.cacheCreationTokens ?? 0),
                // provider-reported snapshot = EXACT usage (never marked ≈)
              }
            : {
                provider: prov.provider,
                model: prov.model,
                inputTokens: Math.ceil(transcript.chars / CHARS_PER_TOKEN),
                outputTokens: 0,
                costUsd: 0,
                estimated: true, // honest marker — chars/4 reconstruction, not provider data
              };
          if (!(entry.costUsd > 0)) {
            entry.costUsd = estimateCost(prov.provider, prov.model, entry.inputTokens, entry.outputTokens);
          }
          entry.costUsd = Math.round(entry.costUsd * 1e6) / 1e6;
          attemptLedger.push(entry);
          runUsage.inputTokens += entry.inputTokens;
          runUsage.outputTokens += entry.outputTokens;
          runUsage.cacheRead += entry.cacheReadTokens ?? 0;
          runUsage.cacheCreation += entry.cacheCreationTokens ?? 0;
          runUsage.costUsd += entry.costUsd;
        };
        // v11.9 (E1) — per dead attempt: did THIS attempt stream reasoning?
        // Captured where think deltas are pushed, BEFORE closeThinking() clears
        // thinkingOpen, so the failover guard below cannot be defeated by the
        // close (a think-only partial stream must not re-stream duplicate
        // reasoning on the next provider).
        let sawThinking = false;
        for (let attempt = 0; ; attempt++) {
          sawThinking = false; // v11.10 — per-ATTEMPT flag (the per-provider reset lives above)
          // v11.11 (A4) — ENGINE IDLE WATCHDOG (stall detection + recovery).
          // The provider-level byte watchdog (providers.ts, 75s) fires only on
          // ZERO bytes; a proxy that keeps the socket warm with keep-alive
          // pings while the model never speaks would stall the turn forever.
          // THIS watchdog watches ENGINE-VISIBLE activity instead: answer
          // deltas, THINKING deltas, tool-arg deltas and usage snapshots all
          // count as life, so it applies equally to TEXT-ONLY and
          // THINKING-ONLY streams and never kills a healthy flowing stream.
          // After engineIdleTimeoutMs() (default 20s, SURNIA_ENGINE_IDLE_MS)
          // of silence the attempt's signal is aborted — streamTurn throws —
          // and the v11.10 stream-drop auto-continue machinery below recovers
          // from the last committed state (retry / continue / failover).
          const idleMs = engineIdleTimeoutMs();
          const graceMs = extendedReasoningGraceMs(); // v11.26 — deep-reasoning grace (0 = strict)
          const attemptStartedAt = Date.now();
          const attemptAc = new AbortController();
          let idleFired = false;
          let lastActivity = Date.now();
          // v12 (STREAMING CONTINUITY) — a slow / thinking-only stream may go
          // long stretches with NO delta text while the provider keeps the
          // socket warm (`: ping`, keep-alive chunks). bumpActivity previously
          // only updated the engine's LOCAL idle watchdog — the renderer got no
          // liveness pulse at all, so its run watchdog could declare a false
          // "disconnected" on a healthy-but-quiet stream. Pulse a `heartbeat`
          // AgentEvent to the renderer too, throttled to at most once per second
          // (mirrors pingCompact) so it never spams. This fires on EVERY sign of
          // engine life (keep-alive bytes, text/thinking deltas, tool args,
          // usage); the event carries no text and is a pure watchdog reset in
          // store.ts. Keep `onHeartbeat: () => bumpActivity()` literal below —
          // it is a source contract asserted by tests/v12-enhancements.test.mjs.
          let lastStreamPing = 0;
          const bumpActivity = (): void => {
            lastActivity = Date.now();
            if (lastActivity - lastStreamPing >= 1000) {
              lastStreamPing = lastActivity;
              if (o.stream) ioB.send({ type: 'heartbeat', phase: 'streaming' } as AgentEvent);
            }
          };
          // v11.26 (CONTINUITY) — RENDERER LIVENESS INDEPENDENT OF PROVIDER BYTES.
          // bumpActivity only fires on provider activity; a silent-but-progressing
          // reasoning phase produced NO heartbeat at all, so the renderer's own
          // watchdog could show "disconnected" on a healthy run. This timer keeps
          // the renderer fed for the whole attempt. It deliberately does NOT touch
          // lastActivity: the engine's silent-stream watchdog still sees genuine
          // silence and can recover a truly hung socket. Unref'd + cleared below.
          let streamHeartbeatTimer: NodeJS.Timeout | null = null;
          if (o.stream) {
            streamHeartbeatTimer = setInterval(() => {
              try {
                ioB.send({ type: 'heartbeat', phase: 'streaming' } as AgentEvent);
              } catch {
                /* liveness is best-effort */
              }
            }, 1000);
            try {
              streamHeartbeatTimer.unref?.();
            } catch {
              /* timers without unref are fine */
            }
          }
          const idleTimer = setInterval(() => {
            if (Date.now() - lastActivity < idleMs) return;
            // v11.26 — SILENT REASONING IS PROGRESS, NOT SILENCE. While the model
            // is in an open thinking phase, extend the window (up to the grace
            // budget) instead of aborting. Deltas/keep-alives already reset
            // lastActivity via bumpActivity; this covers the zero-byte case that
            // used to kill legitimate deep reasoning after ~20s.
            if (o.stream && thinkingOpen && graceMs > 0 && Date.now() - attemptStartedAt < graceMs) {
              lastActivity = Date.now();
              return;
            }
            idleFired = true;
            try {
              attemptAc.abort();
            } catch {
              /* already dead */
            }
          }, Math.max(50, Math.min(1000, Math.floor(idleMs / 4))));
          try {
            idleTimer.unref?.();
          } catch {
            /* timers without unref are fine */
          }
          const onRunAbort = (): void => {
            try {
              attemptAc.abort();
            } catch {
              /* ignore */
            }
          };
          if (signal.aborted) attemptAc.abort();
          else signal.addEventListener('abort', onRunAbort, { once: true });
          try {
            const r = await streamTurn({
              model: o.modelOverride ?? (fo ? { ...params.model, provider: fo.provider, model: fo.model } : params.model),
              apiKey: o.credsOverride?.apiKey ?? (fo ? fCreds?.apiKey ?? creds.apiKey : creds.apiKey),
              baseUrl: o.credsOverride?.baseUrl ?? (fo ? fCreds?.baseUrl ?? creds.baseUrl : creds.baseUrl),
              // v12 — re-inject pinned context EVERY turn so a pin_context call
              // made mid-run takes effect on the very next model request.
              system: (() => {
                const pinTxt = renderPins(params.sessionId);
                return pinTxt ? `${o.system}\n\n${pinTxt}` : o.system;
              })(),
              // v11.35 (C6) — fold byte-identical tool results per request.
              // The local `messages` transcript stays untouched (compaction,
              // pruning and recall still see full copies); only the provider
              // payload shrinks, so u.inputTokens reflects the honest smaller
              // prompt and no capability is lost.
              messages: dedupeToolResults(messages),
              tools: o.tools,
              signal: attemptAc.signal,
              promptCaching: cfg.promptCaching !== false,
              maxRetries: cfg.maxRetries,
              onText: (t) => {
                markFirstDelta(); // v11.21 — real delta: stop the setup pulse
                bumpActivity();
                closeThinking();
                textParts.push(t);
                // v11.9 (E18) — the first answer delta after thinking closes
                // the run's thinking window.
                if (o.stream && thinkingStartedAt > 0 && thinkingEndedAt === 0) thinkingEndedAt = Date.now();
                if (o.stream) ioB.send({ type: 'text_delta', text: t });
              },
              onThinking: (t) => {
                markFirstDelta(); // v11.21 — first real think_delta: stop the setup pulse
                bumpActivity();
                openThinking();
                sawThinking = true; // v11.9 (E1) — captured BEFORE closeThinking
                // v11.9 (E18) — the first think_delta of the RUN opens the
                // thinking window.
                if (o.stream && thinkingStartedAt === 0) thinkingStartedAt = Date.now();
                if (subNote && !notedThinking) {
                  notedThinking = true;
                  subNote('thinking');
                }
                // v12 (STREAMING CONTINUITY) — throttled thinking progress line
                // for normal (non-subagent) runs: only during a STILL-OPEN pure
                // thinking window, no sooner than 2s in, at most once per 2s.
                // The seconds change each time so the notice dedup (by text)
                // lets each tick through; the throttle is what stops spam.
                // The streaming think_delta itself is the liveness signal —
                // a periodic "[thinking Ns — still reasoning]" notice is visual
                // noise that breaks the flow (founder complaint). Keep the
                // renderer watchdog happy via real deltas; emit at most ONE
                // quiet marker after a long 20s silence, never every 2s.
                if (o.stream && !subNote && thinkingOpen && thinkingStartedAt > 0) {
                  const n = Date.now();
                  if (!thinkQuietMarkerSent && n - thinkingStartedAt >= 20000) {
                    thinkQuietMarkerSent = true;
                    lastThinkNoticeAt = n;
                    const secs = Math.floor((n - thinkingStartedAt) / 1000);
                    notice('thinking', `\n[thinking ${secs}s — still reasoning…]`);
                  }
                }
                if (o.stream) ioB.send({ type: 'think_delta', text: t });
              },
              onToolUse: (id, name, args) => {
                bumpActivity();
                pending.set(id, { name, args });
              },
              // v11.9 (E15) — providers emit usage snapshots as soon as they are
              // known (Anthropic message_start); the last snapshot survives a
              // mid-stream death so the failed turn reports REAL usage.
              onUsage: (snap) => {
                bumpActivity();
                partialUsage = snap;
              },
              // v12 (HEARTBEAT) — provider keep-alive bytes (`: ping`, `ping`
              // events) count as life so a healthy but silently-reasoning
              // stream is never killed by the engine idle watchdog.
              onHeartbeat: () => bumpActivity(),
              // v11.26 (I1 FIX) — route ALL honest provider notices onto the
              // engine's single deduped sys_notice channel. The provider now
              // resumes a dropped stream INTERNALLY (routeStream) and emits
              // `stream_recovered` / `stream_incomplete`; without this callback
              // they were discarded and the founder saw only "Starting…" then
              // a silent freeze. `retry` / `rate_limited` / `failover` notices
              // become visible here too. Never a transcript row — safe after
              // turn_end thanks to the sink guard.
              onNotice: (n) => notice(n.kind, n.text),
            });
            // v11.11 (A4) — FINAL FLUSH on the turn boundary: every delta this
            // attempt produced lands BEFORE any post-turn processing (tool
            // dispatch, commit, notices) and before the next attempt starts.
            deltaBatcher.flushNow();
            if (r.stopReason !== 'error' && r.stopReason !== 'content_filter') {
              result = r;
              delivered = attemptModel();
              break;
            }
            // v11.9 (E10) — content_filter is retried/fail-overed like a
            // provider error: censored output must never present as a complete
            // reply, and one cross-provider attempt is allowed.
            lastErr =
              r.stopReason === 'content_filter'
                ? new Error('Provider content filter blocked this response (finish_reason content_filter).')
                : new Error('Provider stream error.');
          } catch (err) {
            if (signal.aborted || io.isAborted()) throw err; // abort is never retried
            // v11.11 (A4) — the watchdog fired (NOT a user abort): surface the
            // REAL cause so retry/failover sees a stall, not a cryptic
            // AbortError, and the recovery path can tell the user what happened.
            lastErr = idleFired
              ? new Error(
                  `Stream idle watchdog — no model activity for ${Math.round(idleMs / 1000)}s (SURNIA_ENGINE_IDLE_MS); recovering from the last committed state.`,
                )
              : err;
          } finally {
            clearInterval(idleTimer);
            // v11.26 — never leak the renderer-liveness heartbeat timer either.
            if (streamHeartbeatTimer) {
              clearInterval(streamHeartbeatTimer);
              streamHeartbeatTimer = null;
            }
            signal.removeEventListener('abort', onRunAbort);
          }
          // v11.10 (A5) — this attempt is DEAD (error stopReason, thrown, or
          // content-filter): record its real burned tokens before any retry,
          // stream-drop-continue, or failover decision below.
          ledgerDeadAttempt();
          // v11.10 — did THIS attempt stream anything the user already saw?
          // (tool args are engine-internal — tool_start has not fired yet.)
          const visible = o.stream && (textParts.length > 0 || thinkingOpen || sawThinking);
          // v11.24 (SLOW PROVIDER) — a stall/network failure BEFORE the first
          // token used to burn the whole retry schedule in silence (the
          // founder's "AI takes forever, no answer"). Surface ONE honest notice
          // at once via the deduping notice channel; never silently switch
          // vendors because a provider is merely slow.
          if (!visible && o.stream && isSlowProviderError(lastErr)) {
            notice(
              'slow_provider',
              `${params.model.provider} is slow or stalled — retrying briefly, no automatic provider switch. Check Settings → AI providers if this persists.`,
            );
          }
          // maxAttempts = TOTAL streamTurn calls for this provider: the
          // initial attempt + (visible ? continueBudget continuations :
          // retryDelays.length retries).
          const maxAttempts = (visible ? continueBudget : retryDelays.length) + 1;
          const exhausted = attempt + 1 >= maxAttempts;
          // v11.10 — STREAM-DROP AUTO-CONTINUE: commit the partial output and
          // keep the SAME task running instead of failing the turn.
          if (visible && !exhausted) {
            dropContinues++;
            const partial = textParts.join('');
            if (partial) pushMessage({ role: 'assistant', text: partial });
            pushMessage({ role: 'user', text: STREAM_DROP_CONTINUE_MSG });
            if (o.stream) notice('sys', '\n[stream interrupted mid-answer — auto-continuing the same task]\n');
          }
          if (exhausted) break;
          // v11.23: 402/no_credits (and every other deterministic 4xx) is FATAL
          // on the FIRST response. The old 401-only guard let a dead 402 burn
          // ~4.2s of silent retries before the right message appeared.
          if (isFatalProviderError(lastErr)) break;
          // v11.27 — a 429 that survived the provider's full bounded recovery
          // is genuine exhaustion: do NOT replay the whole recovery schedule
          // again (which would multiply requests ~7× and burn minutes).
          if (isRateLimitExhausted(lastErr)) break;
          // v11.9 (E2) — reset the DEAD attempt's accumulators before retrying,
          // for BOTH stream and non-stream runs: text (committed above when
          // visible), reasoning state and partial tool args.
          textParts.length = 0;
          closeThinking();
          pending.clear();
          try {
            const delay = retryDelays[Math.min(attempt, retryDelays.length - 1)];
            await sleepAbortable(Math.round(delay * (0.8 + Math.random() * 0.4)), signal);
          } catch {
            throw lastErr; // aborted while backing off
          }
        }
        if (result) break; // this provider delivered — leave the failover loop
        // v11.23 (P1) — a fatal 402/4xx never fails over either, even when the
        // user enabled cross-provider failover: more credits are not going to
        // appear by switching models. ONE terminal error, no extra requests.
        if (isFatalProviderError(lastErr)) break;
        // v11.27 — a rate-limited provider keeps the user's chosen provider:
        // never auto-switch just because it was throttled.
        if (isRateLimitExhausted(lastErr)) break;
        // v11.24 — a slow/stalled/network error is NEVER a reason to auto-switch
        // vendors (matches providers.ts v11.19). The user already saw the notice
        // above and decides in Settings; only deterministic account/key/model
        // failures are allowed to fail over.
        if (isSlowProviderError(lastErr)) break;
        // No more providers in the chain → final failure below.
        if (failoverIdx + 1 >= failover.length) break;
        // v7/v11.9 (E1) — a dead attempt with UNCOMMITTED visible output must
        // NOT fail over: the next provider would re-stream duplicates into the
        // live block. v11.10: a COMMITTED partial (stream-drop auto-continue
        // above resets the accumulators) or a fully invisible death fails over
        // cleanly with the continuation already in the transcript — E17 now
        // covers stream drops, not only pre-request failures.
        if (o.stream && (textParts.length > 0 || thinkingOpen)) break;
        // v11.9 (E2) — drop the dead attempt's accumulators before switching.
        textParts.length = 0;
        closeThinking();
        pending.clear();
        const next = failover[failoverIdx + 1];
        // v11.20 — ONE quiet notice for the whole run, never a per-switch
        // stream of raw provider errors / JSON. `next` is consumed by the
        // loop's model override below; the visible text stays cosmetic.
        if (!failoverNoticeSent) {
          failoverNoticeSent = true;
          const total = failover.length + 1; // primary + alternates
          const nth = failoverIdx + 2; // 1-based ordinal of the next attempt
          notice('failover', `Trying another configured model (${nth}/${total})…`);
        }
      }
      closeThinking();

      if (!result || result.stopReason === 'error') {
        // ---------- final failure: never silently discard partial output ----------
        const partial = textParts.join('');
        const message = friendlyError(lastErr, params.model);
        if (o.stream) {
          if (partial) {
            // The deltas already streamed the partial text; append a note inline.
            notice('sys', `\n\n[stream interrupted — ${message}]`);
          }
          // Main run: surface the failure as an event (renderer error bubble).
          // v11.23 — routed through sendError so it is deduped AND reflected in
          // the final task_report outcome, even if post-processing throws later.
          sendError(message);
        }
        // v11.9 (E15) + v11.10 (A5) — a failed turn must not report the
        // PREVIOUS turn's usage. Every dead attempt is ALREADY ledgered and
        // added to the run totals at its death (ledgerDeadAttempt above), so
        // the turn's reported delta is the LAST dead attempt: the real
        // provider snapshot when one arrived (exact), else the honest
        // transcript-based estimate (marked `estimated`). No double-add.
        const lastDead = attemptLedger[attemptLedger.length - 1];
        const failedUsage: Usage = lastDead
          ? {
              inputTokens: lastDead.inputTokens,
              outputTokens: lastDead.outputTokens,
              costUsd: lastDead.costUsd,
              ...(lastDead.cacheReadTokens ? { cacheReadTokens: lastDead.cacheReadTokens } : {}),
              ...(lastDead.cacheCreationTokens ? { cacheCreationTokens: lastDead.cacheCreationTokens } : {}),
              ...(lastDead.estimated ? { estimated: true } : {}),
            }
          : {
              // Defensive: no attempt ever reached a death point (pre-request
              // hard throw) — honest transcript-based estimate, marked ≈.
              inputTokens: Math.ceil(transcript.chars / CHARS_PER_TOKEN),
              outputTokens: Math.ceil(partial.length / 4),
              costUsd: 0,
              estimated: true,
            };
        if (!(failedUsage.costUsd > 0)) {
          failedUsage.costUsd = estimateCost(params.model.provider, params.model.model, failedUsage.inputTokens, failedUsage.outputTokens);
        }
        // Subagent run (stream:false): return the failure inside the result —
        // it flows back through the task tool_result instead of a global error.
        const finalText = o.stream ? partial : partial || `[error: ${message}]`;
        return {
          finalText,
          stopReason: 'error',
          usage: runUsageTotals(),
          lastTurn: failedUsage,
          aborted: false,
          maxedOut: false,
          messages,
        };
      }

      // ---------- usage accounting (per-turn delta + cumulative run totals) ----------
      const u = result.usage;
      const split = u as Usage & { cacheReadTokens?: number; cacheCreationTokens?: number };
      // v11.10 (A5) — EXACT vs ESTIMATE: when a provider reports real usage it
      // also arrives with a computed cost (OpenRouter's usage.cost, or the
      // cache-weighted estimate over REAL token counts). A final usage with
      // zero cost and nonzero tokens can only be the chars/4 fallback
      // (providers.ts estimateUsage) — mark it honestly so the UI shows "≈".
      const turnIsEstimate = !(u.costUsd > 0) && (u.inputTokens > 0 || u.outputTokens > 0);
      const turnCost = u.costUsd > 0 ? u.costUsd : estimateCost(params.model.provider, params.model.model, u.inputTokens, u.outputTokens);
      runUsage.inputTokens += Math.max(0, u.inputTokens);
      runUsage.outputTokens += Math.max(0, u.outputTokens);
      runUsage.cacheRead += Math.max(0, split.cacheReadTokens ?? 0);
      runUsage.cacheCreation += Math.max(0, split.cacheCreationTokens ?? 0);
      runUsage.costUsd += turnCost;
      // v11.10 (A5) — the SURVIVING attempt closes this iteration's ledger:
      // sum(attempts) == runUsage exactly (reconciliation identity).
      {
        const prov = delivered ?? { provider: params.model.provider, model: params.model.model };
        attemptLedger.push({
          provider: prov.provider,
          model: prov.model,
          inputTokens: Math.max(0, u.inputTokens),
          outputTokens: Math.max(0, u.outputTokens),
          costUsd: Math.round(turnCost * 1e6) / 1e6,
          cacheReadTokens: Math.max(0, split.cacheReadTokens ?? 0),
          cacheCreationTokens: Math.max(0, split.cacheCreationTokens ?? 0),
          ...(turnIsEstimate ? { estimated: true } : {}),
        });
      }
      // v7.1 → v11.10 — TASK BUDGET: WARN early, CONFIRM at the limit. The old
      // behavior hard-stopped the turn the moment spend crossed the ceiling
      // (pushing a wrap-up note the model never got to answer — a silent kill
      // mid-task). Now: a warning at 80%, and at the limit the user is asked
      // through the STANDARD approval flow; approval grants another full
      // budget of headroom, denial gives the model ONE wrap-up turn, and only
      // a post-denial crossing force-stops the run.
      {
        const settingsLimit = fullSettings()?.agent?.taskBudgetUsd;
        const limit: number = budgetLimitUsd ?? (typeof settingsLimit === 'number' && settingsLimit > 0 ? settingsLimit : 0);
        const spent = runUsage.costUsd;
        if (limit > 0 && spent > 0) {
          if (!budgetWarned && spent >= limit * 0.8 && spent < limit) {
            budgetWarned = true;
            notice('budget', `\n[budget warning] $${spent.toFixed(3)} of the $${limit.toFixed(2)} task budget spent — you will be asked to confirm continuing at the limit.\n`);
          }
          const tb = taskBudgetCheck(spent, limit);
          if (tb.exceeded) {
            if (budgetWrapUp) {
              // v11.36 (INTERRUPTION) — the OLD code blanked finalText here
              // and returned stopReason 'end_turn': a SILENT stop that looked
              // like a clean completion with no summary. A cap forcing the end
              // must be honest and VISIBLE: a sys_notice (below) + a real final
              // text — never empty.
              const fallback = silentStopFallback('the task budget was exhausted and continuation was denied');
              notice('budget', '\n[budget] task budget exhausted (continuation denied) — stopping with an honest status\n');
              finalText = fallback;
              return {
                finalText,
                stopReason: 'end_turn',
                usage: runUsageTotals(),
                lastTurn,
                aborted: false,
                maxedOut: false,
                messages,
              };
            }
            notice('budget', `\n[budget] ${tb.reason}\n`);
            const requestId = randomUUID();
            ioB.send({
              type: 'approval_request',
              requestId,
              kind: 'question',
              title: 'Task budget reached — continue working?',
              detail:
                `${tb.reason}\n\n` +
                `Approve to keep going with another $${limit.toFixed(2)} of headroom (you will be asked again at the next crossing), ` +
                `or deny to have the agent wrap up with a status summary.`,
              payload: {},
            } as AgentEvent);
            const decision = await io.getDecision(requestId);
            const allowed =
              !!decision &&
              (decision.action === 'allow' ||
                decision.action === 'always' ||
                decision.action === 'always_session' ||
                decision.action === 'always_project');
            if (allowed) {
              // Grant one more full budget of headroom from the CURRENT spend.
              const raised: number = spent + limit;
              budgetLimitUsd = raised;
              notice('budget', `\n[budget] continuation approved — ceiling raised to $${raised.toFixed(2)}\n`);
            } else {
              budgetWrapUp = true;
              pushMessage({
                role: 'user',
                text:
                  `${SYSTEM_NOTE_PREFIX}task budget exhausted: $${spent.toFixed(3)} spent, limit $${limit.toFixed(2)}. ` +
                  'Wrap up NOW with a short status: what is done, what remains. Do not start new work.',
              });
              notice('budget', '\n[budget] continuation denied — wrapping up\n');
              continue; // one turn to produce the wrap-up summary
            }
          }
        }
      }
      lastTurn = {
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        costUsd: Math.round(turnCost * 1e6) / 1e6,
        // v7 — per-turn cache split (rides the IPC JSON; the renderer's
        // status-bar ctx+cache chip accumulates it on sessionUsage).
        cacheReadTokens: Math.max(0, split.cacheReadTokens ?? 0),
        cacheCreationTokens: Math.max(0, split.cacheCreationTokens ?? 0),
        // v11.10 (A5) — honesty marker: chars/4 estimate (no provider usage)
        // is flagged so the context bar and usage rows show "≈", never a
        // precise-looking fake.
        ...(turnIsEstimate ? { estimated: true } : {}),
      };
      // v7 — real token measurement drives the compaction trigger.
      if (u.inputTokens > 0) lastRealInputTokens = u.inputTokens;

      const text = textParts.join('');

      // v11.9 (E8) — a throttled tool_use partial emitted under a temp id
      // (TEMP_TOOL_ID_PREFIX) before the real tool id arrived must never
      // dispatch alongside the final complete call: prune stale temp entries
      // whose name matches a final call and whose args are a prefix of /
      // invalid against the final args, THEN dedupe identical name+args.
      pruneTempToolCalls(pending);

      // Dedupe calls that arrived under both a temp id and the final id
      // (identical name+args ⇒ same call; keep the first occurrence).
      const calls: { id: string; name: string; args: string }[] = [];
      const byContent = new Map<string, string>();
      for (const [id, v] of pending) {
        const key = v.name + '\u0000' + v.args;
        if (byContent.has(key)) continue;
        byContent.set(key, id);
        calls.push({ id, name: v.name, args: v.args });
      }

      // v11.37 — REPAIR NATIVE tool_use args BEFORE validation. Weak providers
      // emit {"tool":"pdf_make","args":{...}}} (nested wrapper + extra brace)
      // as the raw args of a call; untouched that is a permanent MALFORMED JSON
      // loop — exactly the founder's "every tool emits an error" complaint.
      const knownToolNames = new Set([
        ...o.tools.map((d) => d.name),
        ...getToolDefs([], 'full').map((d) => d.name),
        ...getProviderToolDefs().map((d) => d.name),
      ]);
      for (const c of calls) {
        let directObject = false;
        try {
          const v: unknown = JSON.parse(c.args);
          directObject = !!v && typeof v === 'object' && !Array.isArray(v);
        } catch {
          /* repaired below */
        }
        const fixed = parseToolArgs(c.args);
        if (fixed.invalid) continue;
        if (!directObject) c.args = JSON.stringify(fixed.parsed);
        if (
          fixed.envelopeName &&
          !knownToolNames.has(c.name) &&
          knownToolNames.has(fixed.envelopeName)
        ) {
          c.name = fixed.envelopeName;
        }
      }

      // v2.3 — TEXT TOOL PROTOCOL: a tool-free turn that contains ```surnia-tool
      // blocks converts to REAL calls (custom/OpenRouter/Ollama models whose
      // native function calling is missing or broken).
      let visibleText = text;
      // v11.9 (E6) — count EVERY ```surnia-tool fence BEFORE anything is
      // stripped; the count vs parsed calls drives the skip-with-warning log.
      const toolFenceCount = (text.match(/```surnia-tool/g) ?? []).length;
      if (calls.length === 0 && toolFenceCount > 0) {
        // v11.35 (A2) — recognise the FULL callable registry here, not just the
        // current advertised view. A tool hidden by the profile (or a provider
        // -native/extra tool) is still executable by name in dispatch, so a
        // ```surnia-tool fence naming it must not be silently dropped.
        // v11.37 — reuse the same registry set built for native-args repair.
        const known = knownToolNames;
        const tp = parseTextToolCalls(text, known);
        if (tp.length) {
          calls.push(...tp);
          result.stopReason = 'tool_use';
          visibleText = stripTextToolBlocks(text);
          if (o.stream) notice('sys', '\n[fallback protocol → executing tool call(s)]\n');
        }
      }
      // v11.9 (E6) — raw ```surnia-tool fences must NEVER reach the user, even
      // when ZERO calls parsed out of them (unknown tool name / malformed
      // JSON): strip the blocks from the visible text in EVERY case and log
      // each dropped fence (skip-with-warning — never pure silence).
      if (visibleText.includes('```surnia-tool')) {
        // v11.12 (T2-DEADEND) — dropped fences are NO LONGER SILENT: each block
        // is replaced by a corrective marker the model reads next turn (and
        // the user sees exactly what happened), instead of the call vanishing
        // into nothing with zero feedback — a true dead end for weak models.
        visibleText = visibleText.replace(
          /```surnia-tool[\s\S]*?```/g,
          '[system note: the tool call block above was DROPPED — unknown tool name or malformed JSON. Re-emit it with a valid tool name and strict JSON arguments.]',
        );
      }
      {
        const parsedFences = calls.filter((c) => c.id.startsWith('txt_')).length;
        const droppedFences = Math.max(0, toolFenceCount - parsedFences);
        if (droppedFences > 0) {
          try {
            console.warn(`[agent] dropped ${droppedFences} unparseable \`\`\`surnia-tool block(s) (unknown tool name or malformed JSON) — corrective marker injected`);
            notice('sys', `\n[${droppedFences} tool-call block(s) could not be parsed — the model was told to re-emit them correctly]\n`);
          } catch {
            /* logging is best-effort */
          }
        }
      }

      // v1.5 stall detection: the same ALL-read-only batch issued 3× within
      // the recent window is a loop, not progress — nudge a different approach
      // (bounded to 3 injections so a legitimately repetitive-but-useful
      // sequence is never permanently blocked).
      if (calls.length > 0 && calls.every((c) => PARALLEL_SAFE_TOOLS.has(c.name))) {
        const batchHash = calls.map((c) => `${c.name}:${c.args}`).sort().join('|');
        recentBatches.push(batchHash);
        if (recentBatches.length > 6) recentBatches.shift();
        const occurrences = recentBatches.filter((h) => h === batchHash).length;
        if (occurrences >= 3 && stallsInjected < 3) {
          stallsInjected++;
          pushMessage({ role: 'user', text: STALL_NUDGE });
          if (o.stream) notice('sys', '\n[stall detected — trying a different approach]\n');
        }
      }

      if (calls.length > 0 && (result.stopReason === 'tool_use' || result.stopReason === 'end_turn')) {
        // v11.7 — DEFENSIVE TOOL DISPATCH: gateways that emit tool deltas with
        // finish_reason 'stop' (instead of 'tool_calls') used to have their
        // calls silently DROPPED here — the model's tool intent vanished and
        // the next turn answered from nothing ("weird replies", "tool errors").
        // A parsed call is a parsed call: execute it regardless of the finish
        // reason. max_tokens still falls through to the continuation below so
        // truncated JSON is never executed.
        if (result.stopReason !== 'tool_use') result.stopReason = 'tool_use';
        // Preserve the thinking trace on the resent assistant turn — Anthropic
        // requires thinking blocks to accompany tool_use inside the tool loop.
        pushMessage({
          role: 'assistant',
          text: visibleText || undefined,
          toolCalls: calls,
          ...(result.thinking ? { thinking: result.thinking, thinkingSignature: result.thinkingSignature } : {}),
        });

        // Validate args JSON up front; malformed calls get a corrective error
        // result instead of executing with silently-emptied arguments.
        const prepared = calls.map((call) => {
          let parsed: unknown = {};
          let invalid = false;
          try {
            parsed = JSON.parse(call.args);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              parsed = {};
              invalid = true;
            }
          } catch {
            parsed = {};
            invalid = true;
          }
          return { call, parsed, invalid };
        });

        /**
         * v11.37 — ONE visible corrective per broken fingerprint. It carries the
         * tool's OWN actionable error verbatim (M1 makes tools.ts actionable;
         * the engine only relays), never a generic "failed", and it never ends
         * the run. Dedupe by fingerprint prevents notice spam across retries.
         */
        const emitLoopBreakerNotice = (key: string, name: string, fullOutput: string): void => {
          if (!o.stream || loopNoticesSent.has(key)) return;
          loopNoticesSent.add(key);
          const fix = actionableFixFrom(fullOutput);
          notice(
            'tool_loop_breaker',
            `[tool loop breaker] ${name} failed repeatedly with the SAME arguments — DISPATCH BLOCKED; the run continues. ` +
              `EXACT TOOL ERROR: ${fullOutput.slice(0, 500)}\n` +
              `EXACT FIX: ${fix}\n` +
              TOOL_LOOP_BREAKER_NUDGE,
          );
        };
        /** Synthetic tool_result for a blocked retry: precise, never silent. */
        const blockedRetryOutput = (name: string, fullOutput: string): string => {
          const fix = actionableFixFrom(fullOutput);
          return (
            `${SYSTEM_NOTE_PREFIX}${REPEATED_FAILURE_NUDGE}\n` +
            `[blocked: this exact ${name} call already failed twice with identical arguments — it was NOT executed again.]\n` +
            `EXACT TOOL ERROR: ${fullOutput.slice(0, 500)}\n` +
            `EXACT FIX: ${fix}\n` +
            `Change the arguments above to that fix, or use a DIFFERENT tool / state the blocker and continue.`
          );
        };

        // v11.23 (ID PAIRING) — emit `tool_start` lazily, right before each
        // call is actually dispatched, instead of firing them all up front.
        // The old code emitted every tool_start at once and then bailed out on
        // abort before emitting the matching tool_result, leaving tool cards
        // stuck open with a call id that never got a result. One start per
        // dispatch ⇒ tool_start.toolCallId and tool_result.toolCallId always
        // form a complete pair (including the MALFORMED_JSON path below).
        const execPrepared = async (
          p: (typeof prepared)[number],
        ): Promise<{ outcome: { ok: boolean; output: string }; pre: { blocked: boolean; reason?: string; context?: string } }> => {
          // v11.32 (HARD CAP) + v11.37 (NORMALIZED CAP) — before ANY dispatch,
          // refuse a call that already failed twice with the same tool name and
          // the same (cosmetically normalized) arguments. A synthetic tool_result
          // reaches the model, ONE visible notice reaches the user, and the run
          // CONTINUES. No doom-gate approval, no termination, no silent stop.
          const loopKey = p.invalid
            ? malformedToolCallKey(p.call.name, p.call.args)
            : normalizedToolCallKey(p.call.name, p.parsed);
          const strictFp = p.invalid ? '' : toolCallHash(p.call.name, p.parsed);
          const hardBlocked =
            (strictFp !== '' && blockedFingerprints.has(strictFp)) || normalizedBlocked.has(loopKey);
          if (hardBlocked) {
            breakerBlockedCallIds.add(p.call.id);
            const priorError = actionableFixByKey.get(loopKey) ?? REPEATED_FAILURE_NUDGE;
            emitLoopBreakerNotice(loopKey, p.call.name, priorError);
            if (o.stream) {
              notice(
                'tool_failure_breaker',
                `${p.call.name} already failed twice with identical arguments — DISPATCH BLOCKED. Corrective injected; switching approach.`,
              );
            }
            return {
              outcome: { ok: false, output: blockedRetryOutput(p.call.name, priorError) },
              pre: { blocked: false },
            };
          }
          if (o.stream) {
            ioB.send({ type: 'tool_start', toolCallId: p.call.id, name: p.call.name, args: p.parsed });
            trace?.step({ t: Date.now(), kind: 'tool_call', name: p.call.name, argsPreview: JSON.stringify(p.parsed).slice(0, 300) });
          }
          if (p.invalid) {
            bumpToolUsage(p.call.name, false); // v11.12 (A4-REPORT) — malformed calls count, visibly
            return { outcome: { ok: false, output: MALFORMED_JSON_MSG }, pre: { blocked: false } };
          }
          // v11.31 (HONEST REPORT) — candidate write paths are fingerprinted
          // BEFORE execution (before-hash), but only committed to `touchedFiles`
          // AFTER executeTool reports success. The old code added them up front,
          // so a DENIED / failed write was still listed in task_report.files,
          // opened a phantom live preview and polluted the proof package.
          const writePaths: string[] = [];
          // v2.1 — run stats (main run only): tool-call count for the memory
          // nudge / skill factory, and touched files from write/edit calls.
          if (o.stream) {
            runToolCalls++;
            // v2.2 — skills used this run (drives skill self-improvement).
            // v1143 — REAL use_skill execution tracing: a distinct trace step
            // proves the MODEL (not the harness) dispatched this tool call.
            if (p.call.name === 'use_skill') {
              const a = (p.parsed && typeof p.parsed === 'object' ? p.parsed : {}) as Record<string, unknown>;
              const slug = typeof a.slug === 'string' ? a.slug.trim() : '';
              if (slug) {
                skillsUsedThisRun.add(slug);
                trace?.step({
                  t: Date.now(),
                  kind: 'tool_call',
                  name: 'skill:auto-used',
                  argsPreview: JSON.stringify({ slug }),
                  note: 'v1143: the MODEL dispatched use_skill (not a harness injection)',
                });
              }
            }
            if (p.call.name === 'write_file' || p.call.name === 'edit_file' || p.call.name === 'multi_edit') {
              const argsRec = (p.parsed && typeof p.parsed === 'object' ? p.parsed : {}) as Record<string, unknown>;
              const paths: string[] = [];
              if (typeof argsRec.path === 'string' && argsRec.path) paths.push(argsRec.path);
              // multi_edit: edits[].path (all edits target one file; honest multi-path support)
              if (Array.isArray(argsRec.edits)) {
                for (const e of argsRec.edits as Record<string, unknown>[]) {
                  if (e && typeof e === 'object' && typeof e.path === 'string' && e.path) paths.push(e.path);
                }
              }
              writePaths.push(...paths.slice(0, 4));
              for (const pth of writePaths) {
                try {
                  const abs = path.isAbsolute(pth) ? pth : path.resolve(workspace, pth);
                  // v7.1 — fingerprint BEFORE the tool mutates the file (this runs
                  // before executeTool) → the proof package can prove before→after.
                  void gates.recordTouch(abs).catch(() => undefined);
                } catch {
                  /* before-hash is best-effort */
                }
              }
            }
          }
          // v2.1 — DOOM LOOP DETECTOR: hash(name + stable-args). v2.2 keeps
          // the last 6 call hashes and ALSO detects ALTERNATING loops (period-2
          // A,B,A,B / period-3 A,B,C,A,B,C / ≥4 occurrences of the same hash
          // with ≤1 different call between hits) — not just the classic 3
          // consecutive identical calls. Same doom_loop approval flow.
          // Plan mode is read-only — there the read-only stall nudge handles
          // repetition.
          // v11.37 — a call ALREADY known to have failed is owned by the tool
          // failure breaker (bounded retries + actionable notice). It must
          // NEVER reach the doom-gate approval, which is what ended the run
          // after the founder's 4 identical failing pdf_make calls.
          const alreadyFailing = (normalizedFailureCounts.get(loopKey) ?? 0) > 0;
          if (currentMode() !== 'plan' && !alreadyFailing) {
            const h = toolCallHash(p.call.name, p.parsed);
            doomWindow.push(h);
            if (doomWindow.length > 6) doomWindow.shift();
            // trailing consecutive run of the current hash (classic rule)
            let doomCount = 1;
            for (let i = doomWindow.length - 2; i >= 0 && doomWindow[i] === h; i--) doomCount++;
            const doomHit = doomCount >= DOOM_LOOP_THRESHOLD || alternatingDoom(doomWindow);
            if (doomHit) {
              const prior = sessionDoomDecisions.get(params.sessionId);
              if (prior === 'stop') {
                return {
                  outcome: {
                    ok: false,
                    output:
                      '[doom loop stopped] This exact tool call already repeated and the user chose to stop it. ' +
                      `EXACT TOOL ERROR: ${actionableFixByKey.get(loopKey) ?? '(none)'}\n` +
                      `EXACT FIX: ${actionableFixFrom(actionableFixByKey.get(loopKey) ?? '')}\n` +
                      'Change the arguments or use a DIFFERENT tool before retrying.',
                  },
                  pre: { blocked: false },
                };
              }
              if (prior !== 'proceed') {
                ioB.send({ type: 'doom_loop', tool: p.call.name, count: Math.max(doomCount, DOOM_LOOP_THRESHOLD) });
                const ok = await o.ctx.approve({
                  kind: 'doom_loop',
                  title: 'Repeating tool call detected',
                  detail:
                    `${p.call.name} is repeating with identical arguments (consecutive ×${doomCount}` +
                    `${doomCount < DOOM_LOOP_THRESHOLD ? ', alternating pattern detected' : ''}). Proceed, or stop this loop?`,
                  payload: { toolName: p.call.name },
                });
                if (!ok) {
                  doomWindow.length = 0; // next identical call re-triggers detection
                  return {
                    outcome: {
                      ok: false,
                      output:
                        '[doom loop stopped] You repeated the same tool call with identical arguments and the user chose to stop it. ' +
                        `EXACT TOOL ERROR: ${actionableFixByKey.get(loopKey) ?? '(none)'}\n` +
                        `EXACT FIX: ${actionableFixFrom(actionableFixByKey.get(loopKey) ?? '')}\n` +
                        'Re-think the approach, change the arguments, use a DIFFERENT tool, or explain the blocker.',
                    },
                    pre: { blocked: false },
                  };
                }
              }
            }
          }
          // PreToolUse hooks can veto any tool (exit code 2 = block).
          let pre: { blocked: boolean; reason?: string; context?: string } = { blocked: false };
          try {
            pre = await runPreToolHooks(o.hooks ?? {}, p.call.name, p.call.args, workspace, params.sessionId);
          } catch {
            /* hooks must never break the loop */
          }
          if (pre.blocked) {
            return { outcome: { ok: false, output: `Blocked by PreToolUse hook: ${pre.reason ?? 'denied'}` }, pre };
          }
          if (subNote && !p.invalid) {
            subNote(`tool:${p.call.name}${firstArgSummary(p.parsed) ? ' ' + firstArgSummary(p.parsed) : ''}`);
          }
          // v11.36 (CHILD-SESSION) — an INLINE subagent (progressId set, stream:false)
          // gets the same real tool-call transcript as a detached one: the REAL
          // name + REAL parsed args are recorded BEFORE executeTool, then the
          // result below upgrades the SAME toolCallId row with real output/status.
          // Best-effort: telemetry must never break the agent loop.
          if (progressId && !p.invalid) {
            try {
              subagents.recordSubagentToolCall(progressId, {
                toolCallId: p.call.id,
                name: p.call.name,
                input: JSON.stringify(p.parsed),
                status: 'running',
                at: Date.now(),
              });
              subagentDispatchedCalls.add(p.call.id);
            } catch {
              /* child-session telemetry is best-effort */
            }
          }
          const jT0 = Date.now();
          try {
            const outcome = await executeTool(p.call.name, p.call.args, o.ctx);
            journalEvent(journalFile, { type: 'tool', name: p.call.name, ok: !!outcome.ok, ms: Date.now() - jT0 }); // v9
            // v11.12 (A4-REPORT) — per-tool counters feed the end-of-run report.
            bumpToolUsage(p.call.name, !!outcome.ok);
            // v11.31 — commit the write paths ONLY on success. A denied or
            // failed write keeps its before-hash (fingerprinted above) but must
            // NOT appear in task_report.files / run_receipt / preview hint.
            if (writePaths.length) {
              for (const pth of writePaths) {
                let abs: string | null = null;
                try {
                  abs = path.isAbsolute(pth) ? pth : path.resolve(workspace, pth);
                  const rel = path.relative(workspace, abs);
                  if (outcome.ok) {
                    touchedFiles.add((rel && !rel.startsWith('..') ? rel : pth).slice(0, 160));
                  } else if (abs) {
                    // v11.31 — a denied/failed write must also vanish from the
                    // proof package's before-hash fingerprint list.
                    gates.dropTouch?.(abs);
                  }
                } catch {
                  if (outcome.ok) touchedFiles.add(pth.slice(0, 160));
                }
              }
            }
            // v11.12 (A4-REPORT) — the last successful todo snapshot drives the
            // report's honest "what was NOT done" section.
            if (p.call.name === 'todo_write' && outcome.ok) {
              const targs = (p.parsed ?? {}) as Record<string, unknown>;
              if (Array.isArray(targs.todos)) {
                lastTodoSnapshot = (targs.todos as Record<string, unknown>[])
                  .slice(0, 50)
                  .map((td) => ({
                    text: typeof td?.content === 'string' ? td.content.slice(0, 120) : 'todo item',
                    done: td?.status === 'completed',
                  }));
              }
            }
            // v6 — evidence tracking: every shell command the run executed is
            // recorded (text + ok) for the end-of-run receipt and the goal
            // verifier. run_background counts too (long-lived servers).
            if (p.call.name === 'run_command' || p.call.name === 'run_background') {
              const pargs = (p.parsed ?? {}) as Record<string, unknown>;
              const cmdText = typeof pargs.command === 'string' ? pargs.command.trim() : '';
              if (cmdText) commandsRun.push({ cmd: cmdText.slice(0, 240), ok: !!outcome.ok });
            }
            // v2.6 — UI-quality gate tracking (write paths + probe usage)
            // v11.31 — a FAILED write never wrote UI, so it must not arm the
            // ui-quality gate (that would burn a pointless fix round + model call).
            if (p.call.name === 'ui_quality_check') uiQualityRan = true;
            if (outcome.ok && (p.call.name === 'write_file' || p.call.name === 'edit_file')) {
              const pargs = (p.parsed ?? {}) as Record<string, unknown>;
              const wp = typeof pargs.path === 'string' ? pargs.path : '';
              if (wp && /\.(html?|css)$/i.test(wp) && !uiWritePaths.includes(wp)) uiWritePaths.push(wp);
            }
            return { outcome, pre };
          } catch (err) {
            journalEvent(journalFile, { type: 'tool', name: p.call.name, ok: false, ms: Date.now() - jT0 }); // v9
            bumpToolUsage(p.call.name, false); // v11.12 (A4-REPORT)
            return {
              outcome: { ok: false, output: `Tool error: ${err instanceof Error ? err.message : String(err)}` },
              pre,
            };
          }
        };

        const emitPrepared = async (
          p: (typeof prepared)[number],
          outcome: { ok: boolean; output: string },
          pre: { blocked: boolean; reason?: string; context?: string },
        ): Promise<void> => {
          // PostToolUse hooks can annotate the result (linters, formatters…).
          let postCtx: string | undefined;
          if (!p.invalid) {
            try {
              postCtx = (
                await runPostToolHooks(o.hooks ?? {}, p.call.name, p.call.args, outcome.ok, outcome.output, workspace, params.sessionId)
              ).context;
            } catch {
              /* best-effort */
            }
          }
          let finalOutput = outcome.output;
          if (pre.context) finalOutput += `\n[PreToolUse hook] ${pre.context}`;
          if (postCtx) finalOutput += `\n[PostToolUse hook] ${postCtx}`;
          // v11.36 (CHILD-SESSION) — upgrade the SAME row with the REAL result of
          // the call: honest status + the exact output the model saw (redacted for
          // the UI, like the tool_result card). Runs even for inline subagents,
          // whose `o.stream` is false — hence outside the stream-only block.
          if (progressId && subagentDispatchedCalls.has(p.call.id)) {
            try {
              subagents.recordSubagentToolCall(progressId, {
                toolCallId: p.call.id,
                name: p.call.name,
                status: outcome.ok ? 'done' : 'error',
                output: redactSecrets(finalOutput),
                at: Date.now(),
              });
            } catch {
              /* child-session telemetry is best-effort */
            }
          }
          // v11.32 — a breaker-blocked call emitted NO tool_start (it was never
          // dispatched), so it must emit NO tool_result card either: that keeps
          // the strict tool_start/tool_result pairing intact. The synthetic
          // result still goes into the model transcript below, and the visible
          // tool_failure_breaker notice was already emitted in execPrepared.
          const breakerBlocked = breakerBlockedCallIds.has(p.call.id);
          if (o.stream && !breakerBlocked) {
            // v2.1 — redact secrets from tool RESULTS before they reach the
            // renderer/UI (model transcript keeps full fidelity for the tool).
            if (!outcome.ok) toolFailureCount++;
            // v11.33 (HONEST FINISH) — the LAST dispatched tool's outcome is the
            // evidence used to reject a bare "DONE" (see the end_turn guard).
            lastToolCallOk = outcome.ok;
            // v11.33 (FALSE-DONE REALITY) — count SUCCESSFUL writes so a prose
            // "I created X" claim can be checked against actual disk work.
            if (outcome.ok && /^(?:write_file|edit_file|multi_edit|create_file|make_document)$/.test(p.call.name)) {
              successfulWriteCalls++;
            }
            ioB.send({ type: 'tool_result', toolCallId: p.call.id, ok: outcome.ok, output: redactSecrets(finalOutput) });
            trace?.step({ t: Date.now(), kind: 'tool_result', name: p.call.name, ok: outcome.ok, chars: finalOutput.length });
          }
          pushMessage({
            role: 'tool_result',
            callId: p.call.id,
            content: finalOutput,
            isError: !outcome.ok,
            // read_image results carry a dataUrl → vision-capable models see it.
            images: toolResultImages(finalOutput),
          });

          // v1143 — CONFIRMED use_skill delivery tracing. `pushMessage` above is
          // what turns this tool result into a provider message on the NEXT
          // request; the trace step + sys_notice record the real slug, the body
          // length and a body hash so a run can be audited honestly. This fires
          // ONLY when the model actually called use_skill AND the tool succeeded
          // — never for a harness soft-injection.
          if (p.call.name === 'use_skill' && outcome.ok) {
            const a = (p.parsed && typeof p.parsed === 'object' ? p.parsed : {}) as Record<string, unknown>;
            const slug = typeof a.slug === 'string' ? a.slug.trim() : '';
            if (slug) {
              const bodyHash = createHash('sha1').update(finalOutput).digest('hex').slice(0, 12);
              trace?.step({
                t: Date.now(),
                kind: 'tool_result',
                name: 'skill:auto-used',
                ok: true,
                chars: finalOutput.length,
                note: `v1143: MODEL use_skill body delivered to transcript; slug=${slug}; sha1=${bodyHash}`,
              });
              if (o.stream) {
                try {
                  ioB.send({
                    type: 'sys_notice',
                    kind: 'skill:auto-used',
                    text: `Skill loaded via use_skill: ${slug} (body ${finalOutput.length} chars, sha1 ${bodyHash}) — its instructions are now in context for the next steps.`,
                  });
                } catch {
                  /* notice is best-effort */
                }
              }
            }
          }

          // v11.32 (REPEATED-FAILURE BREAKER) — bookkeeping AFTER each real
          // dispatch. Two FAILED EXECUTIONS of the same tool+args fingerprint
          // are a dead end: arm the HARD CAP (execPrepared now refuses every
          // later call with that fingerprint before executeTool) and inject a
          // system corrective into the NEXT model turn. Never terminates the
          // run — a later SUCCESS on the same fingerprint clears everything.
          if (!p.invalid) {
            const fp = toolCallHash(p.call.name, p.parsed);
            lastFailureFingerprint = fp;
            if (!outcome.ok && !breakerBlocked) {
              const n = (repeatedFailureCounts.get(fp) ?? 0) + 1;
              repeatedFailureCounts.set(fp, n);
              if (n >= 2) {
                // STICKY per-run cap: intervening unrelated calls cannot reset
                // it, so an alternating stubborn model cannot slip through.
                blockedFingerprints.add(fp);
                if (!correctedFailures.has(fp)) {
                  correctedFailures.add(fp);
                  pushMessage({ role: 'user', text: `${SYSTEM_NOTE_PREFIX}${REPEATED_FAILURE_NUDGE}` });
                  if (o.stream) {
                    notice('tool_failure_breaker', `${p.call.name} failed ${n}× with identical arguments — corrective injected; switching approach.`);
                    notice('sys', '\n[repeated tool failure — switching approach]\n');
                  }
                }
              }
            } else if (outcome.ok) {
              // Success on a fingerprint resets the count AND the hard cap.
              repeatedFailureCounts.delete(fp);
              correctedFailures.delete(fp);
              blockedFingerprints.delete(fp);
            }
          }

          // v11.37 — NORMALIZED breaker bookkeeping (covers cosmetically
          // rewritten calls AND still-malformed calls). INVARIANT: arming uses
          // ONLY `!outcome.ok` + tool name + normalized args — NEVER the error
          // text (M1 may rewrite every tool message without breaking the cap).
          // The tool's own actionable error is stored verbatim and relayed in
          // the ONE notice and the synthetic tool_result. Success clears the cap.
          const loopKey = p.invalid
            ? malformedToolCallKey(p.call.name, p.call.args)
            : normalizedToolCallKey(p.call.name, p.parsed);
          if (!outcome.ok && !breakerBlocked) {
            actionableFixByKey.set(loopKey, finalOutput);
            const n = (normalizedFailureCounts.get(loopKey) ?? 0) + 1;
            normalizedFailureCounts.set(loopKey, n);
            if (n >= 2) {
              normalizedBlocked.add(loopKey);
              emitLoopBreakerNotice(loopKey, p.call.name, finalOutput);
              if (!p.invalid && !correctedFailures.has(toolCallHash(p.call.name, p.parsed))) {
                pushMessage({
                  role: 'user',
                  text: `${SYSTEM_NOTE_PREFIX}${TOOL_LOOP_BREAKER_NUDGE}\nEXACT FIX: ${actionableFixFrom(finalOutput)}`,
                });
              }
            }
          } else if (outcome.ok) {
            normalizedFailureCounts.delete(loopKey);
            normalizedBlocked.delete(loopKey);
            actionableFixByKey.delete(loopKey);
          }
        };

        // Parallel execution: multiple calls, ALL read-only-safe, setting ON,
        // plan gate OK (free plans run sequentially). Results are assembled in
        // the ORIGINAL call order regardless of completion order.
        const parallel =
          prepared.length >= 2 &&
          cfg.parallelToolCalls !== false &&
          prepared.every((p) => !p.invalid && PARALLEL_SAFE_TOOLS.has(p.call.name)) &&
          parallelGateAllowed();

        if (parallel) {
          const settled = await Promise.allSettled(prepared.map(execPrepared));
          for (let ci = 0; ci < prepared.length; ci++) {
            const s = settled[ci];
            const outcome =
              s.status === 'fulfilled'
                ? s.value.outcome
                : {
                    ok: false,
                    output: `Tool error: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`,
                  };
            const pre = s.status === 'fulfilled' ? s.value.pre : { blocked: false };
            await emitPrepared(prepared[ci], outcome, pre);
          }
          if (io.isAborted() || signal.aborted) {
            return { finalText: '', stopReason, usage: runUsageTotals(), lastTurn, aborted: true, maxedOut: false, messages };
          }
        } else {
          for (const p of prepared) {
            if (io.isAborted() || signal.aborted) {
              return { finalText: '', stopReason, usage: runUsageTotals(), lastTurn, aborted: true, maxedOut: false, messages };
            }
            const { outcome, pre } = await execPrepared(p);
            await emitPrepared(p, outcome, pre);
          }
        }

        // ---------- v2.1 tool boundary: STEER injection + auto-verify ----------
        // (Runs after every tool batch, before the next model turn.)
        if (o.stream) {
          // STEER: queued mid-run messages land BETWEEN tool calls with a
          // visible "steered" note — they do not wait for the turn to end.
          const steers = drainSteers(params.sessionId);
          for (const s of steers) {
            pushMessage({ role: 'user', text: queueItemText(s) });
            ioB.send({ type: 'steer_injected', text: s.text });
            notice('sys', `\n[steered: ${s.text.replace(/\s+/g, ' ').slice(0, 120)}]\n`);
          }
          if (steers.length) ioB.send({ type: 'queued_count', n: sessionQueues.get(params.sessionId)?.length ?? 0 });

          // AUTO-VERIFY: after ≥3 consecutive file-edit calls in autoEdit /
          // fullAccess, run the project's verification once and feed the
          // result back as a system note (max 2 consecutive verifies).
          const editCalls = prepared.filter(
            (p) => !p.invalid && (p.call.name === 'write_file' || p.call.name === 'edit_file'),
          ).length;
          if (editCalls > 0) editStreak += editCalls;
          else editStreak = 0;
          if (editCalls === 0) verifyStreak = 0; // new non-edit activity resets the cap
          if (editStreak >= EDIT_VERIFY_THRESHOLD && verifyStreak < MAX_CONSECUTIVE_VERIFIES && canAutoVerify()) {
            editStreak = 0;
            verifyStreak++;
            await runAutoVerify();
          }
        }
        finalText = ''; // text before tool calls is not the final answer
        continue;
      }

      // end_turn / max_tokens (or tool_use with no parsable calls)
      // v11.9 (E3) — ANTHROPIC pause_turn: the provider paused a long-running
      // turn server-side and expects a bare re-request to continue. Continue
      // the loop immediately — do NOT execute tools, do NOT inject a fake
      // final answer. v11.10 — budgeted with its own (generous) counter so a
      // pathological pause loop still terminates.
      if (result.stopReason === 'paused' && pauseContinues < maxPauseContinues()) {
        pauseContinues++;
        if (visibleText || result.thinking) {
          // Keep whatever partial content arrived so the re-request continues
          // the SAME turn (thinking is only resent with a valid signature —
          // see toAnthropicMessages).
          pushMessage({
            role: 'assistant',
            text: visibleText || undefined,
            ...(result.thinking ? { thinking: result.thinking, thinkingSignature: result.thinkingSignature } : {}),
          });
        }
        if (o.stream) notice('sys', '\n[provider paused the turn — continuing]\n');
        continue;
      }
      // v11.9 (E3/E10) — content_filter never reaches here (the turn retry
      // loop converts it to an error and retries/fails over); REFUSAL stop
      // reason (Anthropic) surfaces as a friendly error instead of a normal
      // end — it is a provider-level refusal, not prose to auto-recover.
      if (result.stopReason === 'refusal') {
        const message = friendlyError(new Error('The model refused to continue this turn (provider refusal).'), params.model);
        if (o.stream) {
          // v11.23 — a provider refusal is a FAILURE, not a completed turn.
          // sendError marks errorEventSent so task_report cannot say 'completed'.
          sendError(message);
        }
        return {
          finalText: o.stream ? visibleText : visibleText || `[refused: ${message}]`,
          stopReason: 'refusal',
          usage: runUsageTotals(),
          lastTurn,
          aborted: false,
          maxedOut: false,
          messages,
        };
      }
      // v3.1 → v11.10 — MAX-TOKENS AUTO-CONTINUE: the run hit the output cap
      // mid-answer (the old behavior just STOPPED — truncated work looked like
      // giving up). Continue the loop with an explicit continuation
      // instruction. v11.10: budget raised from a hard 3 to a generous default
      // (25, env SURNIA_MAX_TOKENS_CONTINUES) and it now applies to SUBAGENT
      // loops too (stream:false) — a truncated subagent report no longer
      // pretends to be complete.
      if (result.stopReason === 'max_tokens' && maxOutputContinues() > 0 && maxTokensContinues < maxOutputContinues()) {
        maxTokensContinues++;
        // v11.15 (MESSAGE-CONTRACT) — a max_tokens hit while the model was
        // thinking-only leaves visibleText === ''. Pushing `{role:'assistant',
        // text:''}` produced an assistant message with neither content nor
        // tool_calls → HTTP 400 code 3240 on the very next request. Only commit
        // the assistant turn when there is actual visible content to resume
        // from; the continuation user message below is pushed either way.
        if (visibleText) pushMessage({ role: 'assistant', text: visibleText });
        pushMessage({
          role: 'user',
          text: '[system] Your previous reply was cut off at the max_tokens limit. CONTINUE EXACTLY where you stopped — same task, same plan, no recap, no repetition. If you were mid-code, keep writing the code; if the reply is actually complete, say DONE.',
        });
        if (o.stream) notice('sys', '\n[continued — output limit reached]\n');
        continue;
      }
      // v2.3 → v3.1 — REFUSAL AUTO-RECOVERY: the run ended with refusal language
      // and NOTHING was built (zero tool calls, or only reads with no writes).
      // (max 2 per run; subagent turns are exempt — they don't stream).
      if (
        result.stopReason === 'end_turn' &&
        o.stream &&
        runToolCalls === 0 &&
        refusalsInjected < 2 &&
        REFUSAL_RE.test(visibleText)
      ) {
        refusalsInjected++;
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        pushMessage({
          role: 'user',
          text: refusalRecoveryNudge(lastUser?.text ?? '', o.tools.map((d) => d.name), envSummary),
        });
        notice('sys', '\n[capability reminder — continuing]\n');
        continue;
      }
      // v3.1 — MID-TASK refusal recovery: tools ran but no writes happened and
      // the run ends in refusal language ("I can't find X so I can't proceed")
      // → one corrective nudge to push through with a different approach.
      if (
        result.stopReason === 'end_turn' &&
        o.stream &&
        runToolCalls > 0 &&
        !writesThisRun &&
        refusalsInjected < 2 &&
        REFUSAL_RE.test(visibleText)
      ) {
        refusalsInjected++;
        pushMessage({
          role: 'user',
          text:
            '[SYSTEM — capability correction]\n' +
            'You stopped with refusal language after inspecting the machine. That is NOT the end of the road: you have full shell access (install missing runtimes with run_command — winget/choco/brew/apt/pip/npm), can create projects from scratch with write_file/create_file, write documents with make_document, and search the web for solutions. ' +
            'Continue the task NOW with the best available approach — state your assumption in one line and BUILD it. Do not refuse, do not ask permission to continue.',
        });
        notice('sys', '\n[capability reminder — continuing]\n');
        continue;
      }
      // v8 — UNAPPLIED-CODE GATE (the owner's #1 complaint: "يفكر ويكتب الكود
      // وينسى يكتبه على الحقيقي"). The reply drafts substantial code but ZERO
      // tools were called — the engine refuses to accept that as an answer and
      // pushes the model to apply the code to the real files (max 2 pushes).
      // v11.9 (E16) — the gate is an IMPLEMENTATION nudge, not a universal
      // one: it fires ONLY in the build task mode (actual TaskMode names:
      // 'build' | 'plan' | 'debug' | 'review' — there is no 'ask'/'chat'
      // TaskMode; plan/review are read-only postures) and NEVER when the
      // user's last message reads as a QUESTION (question word / question
      // mark with no code-application verbs) — no spurious bare-DONE turns
      // for Q&A.
      if (
        result.stopReason === 'end_turn' &&
        o.stream &&
        runToolCalls === 0 &&
        unappliedCodeNudges < 2 &&
        taskMode === 'build' &&
        currentMode() !== 'plan' &&
        !looksLikeQuestion(
          // the user's LAST real ask (engine system notes are not user asks)
          ([...messages].reverse().find((m): m is Extract<ProviderMsg, { role: 'user' }> => m.role === 'user' && !m.text.startsWith(SYSTEM_NOTE_PREFIX))?.text ?? '').replace(/^\[[^\]]*\]\s*/, ''),
        ) &&
        hasUnappliedCode(visibleText)
      ) {
        unappliedCodeNudges++;
        pushMessage({
          role: 'user',
          text:
            '[surnia agency gate] Your reply drafts code but you made ZERO tool calls — nothing exists on disk. ' +
            'You are an agent with real file access: apply that code NOW with write_file/edit_file/multi_edit, then verify (build/tests). ' +
            'If the user genuinely only asked a question and no file change is needed, reply with exactly DONE and nothing else.',
        });
        notice('gate', '\n[agency gate — code drafted but not applied; continuing to apply it]\n');
        continue;
      }
      // v11.33 (HONEST FINISH) — a bare "DONE" is not accepted while the run's
      // own evidence contradicts it (last tool call failed, or a file the model
      // claimed to write is missing on disk). Inject ONE bounded corrective (max
      // 2 per run) that demands a fix or an honest report — NEVER a stop, a fake
      // completion, or a user re-ask. The next provider turn decides.
      if (result.stopReason === 'end_turn' && o.stream && doneNudges < 2 && isBareDoneClaim(visibleText)) {
        const missingFiles = [...touchedFiles].filter((f) => {
          try {
            return !fsSync.existsSync(path.isAbsolute(f) ? f : path.resolve(workspace, f));
          } catch {
            return false;
          }
        });
        const lastFailed = lastToolCallOk === false;
        if (lastFailed || missingFiles.length) {
          doneNudges++;
          const detail: string[] = [];
          if (lastFailed) detail.push('The LAST tool call failed (ok:false) — it did not succeed.');
          if (missingFiles.length) {
            detail.push(`Files you claimed to write are MISSING on disk: ${missingFiles.slice(0, 5).join(', ')}.`);
          }
          pushMessage({
            role: 'user',
            text: `${SYSTEM_NOTE_PREFIX}${HONEST_FINISH_NUDGE.replace('{DETAIL}', detail.join(' '))}`,
          });
          notice('gate', '\n[completion integrity — bare DONE rejected; finish honestly]\n');
          continue;
        }
      }
      // v11.33 (FALSE-DONE REALITY) — the prose counterpart: "Done — I created
      // index.html" with ZERO successful writes and no such file on disk is a
      // lie. The existing bare-DONE guard above cannot see it (the text is not
      // bare DONE, no tool ran, so lastToolCallOk is null and touchedFiles is
      // empty). Route to the next model turn with a concrete corrective. Shares
      // the bounded 2-injection budget with the bare-DONE guard; honest answers
      // (negation/failure language, or only information) are never flagged.
      if (
        result.stopReason === 'end_turn' &&
        o.stream &&
        doneNudges < 2 &&
        successfulWriteCalls === 0 &&
        claimsWorkDone(visibleText)
      ) {
        const missingClaimedPath = firstMissingClaimedPath(visibleText, workspace);
        if (missingClaimedPath) {
          doneNudges++;
          pushMessage({
            role: 'user',
            text: `${SYSTEM_NOTE_PREFIX}${FALSE_DONE_NUDGE.replace('{PATH}', missingClaimedPath)}`,
          });
          notice('gate', '\n[false-done guard — claimed file does not exist; write it or report honestly]\n');
          continue;
        }
      }
      // v11.36 (INTERRUPTION ROOT CAUSE) — the silent stop the founder reported.
      // After a verification screenshot / image result a provider can emit
      // finish_reason 'stop' with NO visible text (thinking-only or image-only
      // turn). Every existing end_turn guard checks the CONTENT of visibleText,
      // so an empty one sailed through to `finalText = visibleText` → a run
      // that reported 'completed' with finalText === '' and NO final summary.
      // FIX: never accept an empty (or marker-only) end_turn as the answer.
      // Redirect with a bounded corrective; after the bound, write an HONEST
      // visible fallback instead of stopping silently.
      const finalProse = visibleText.replace(GOAL_MARKER, '').trim();
      if (result.stopReason === 'end_turn' && o.stream && !finalProse) {
        if (emptyFinalNudges < EMPTY_FINAL_NUDGE_MAX) {
          emptyFinalNudges++;
          pushMessage({ role: 'user', text: `${SYSTEM_NOTE_PREFIX}${EMPTY_FINAL_NUDGE}` });
          notice('gate', '\n[final answer missing — the turn had no visible text; writing the summary now]\n');
          continue;
        }
        finalText = silentStopFallback('the run ended without a written final answer');
        stopReason = result.stopReason;
        notice('gate', '\n[final answer missing after repeated attempts — honest fallback written]\n');
        subNote?.('done');
        return { finalText, stopReason, usage: runUsageTotals(), lastTurn, aborted: false, maxedOut: false, messages };
      }
      finalText = visibleText;
      stopReason = result.stopReason;
      subNote?.('done');
      return { finalText, stopReason, usage: runUsageTotals(), lastTurn, aborted: false, maxedOut: false, messages };
    }

    // v11.36 — the step-budget exit also carries a visible final answer; a run
    // that exhausts its steps is honest, never a blank "completed" card.
    if (o.stream && !finalText.trim()) {
      finalText = silentStopFallback('the step budget was exhausted');
      notice('sys', `\n${finalText}\n`);
    }
    subNote?.('done');
    return { finalText, stopReason: 'end_turn', usage: runUsageTotals(), lastTurn, aborted: false, maxedOut: true, messages };
  }
}

// ============================================================
// v2 — background subagents
// ============================================================

/** Context needed to host a background subagent (parity with ToolContext fields). */
export interface BackgroundSubagentCtx {
  workspace: string;
  sessionId: string;
  /** Present for contract parity; the host run's toolset/credentials are reused. */
  mcpServers?: { server: MCPServerConfig; tools: MCPToolInfo[] }[];
}

/**
 * Fire-and-forget background subagent host (used by the task tool when args
 * include background:true). Reuses the ACTIVE run's inline subagent runner for
 * this session (same model, tools, approval gate and abort signal). The call
 * returns immediately; completion is reported via a `background_done` event
 * carrying the last 400 chars of the subagent's final message.
 *
 * Limits (v1142): the EFFECTIVE cap is the user's `maxSubagents` setting
 * (Settings → Agent → Max parallel subagents), clamped to 1…BACKGROUND_SUBAGENT_CAP
 * (=64, the hard safety ceiling). Default 64 keeps the "no practical limit"
 * posture. Beyond the cap the function refuses and emits an honest
 * `background_done` with a next step in the summary; callers can pre-check with
 * backgroundSubagentCount(). With no active run in the session it emits a
 * diagnostic summary instead. Never throws.
 */
export async function runBackgroundSubagent(
  io: AgentIO,
  ctx: BackgroundSubagentCtx,
  agentId: SubagentId,
  label: string,
  prompt: string,
): Promise<void> {
  try {
    const sessionId = ctx.sessionId;
    const runner = activeSubagentRunners.get(sessionId);
    if (!runner) {
      io.send({
        type: 'background_done',
        label,
        summary: '[no active agent run in this session — background subagent unavailable]',
      });
      return;
    }
    // v1142 — the limit is a REAL user setting now (Settings → Agent → Max
    // parallel subagents). Read it from the run's cached settings snapshot and
    // clamp defensively; BACKGROUND_SUBAGENT_CAP remains the HARD ceiling.
    const cap = backgroundSubagentCap(fullSettings());
    if ((backgroundRunning.get(sessionId) ?? 0) >= cap) {
      // v11.35 (A3) — honest refusal with a next step (never a bare error code).
      io.send({
        type: 'background_done',
        label,
        summary: `BACKGROUND_LIMIT: ${cap} background agents are already running in this session (a runaway-protection ceiling, not a normal limit). Wait for one to finish, or start a new session. Change the limit in Settings → Agent → Max parallel subagents (up to ${BACKGROUND_SUBAGENT_CAP}).`,
      });
      return;
    }
    backgroundRunning.set(sessionId, (backgroundRunning.get(sessionId) ?? 0) + 1);
    // Detached: the caller (task tool) returns at once; the loop keeps running.
    void (async (): Promise<void> => {
      let summary: string;
      try {
        const out = await runner(agentId, label, prompt, { background: true });
        summary = (out || '').slice(-400);
      } catch (err) {
        summary = `[background subagent error] ${err instanceof Error ? err.message : String(err)}`.slice(-400);
      } finally {
        const left = (backgroundRunning.get(sessionId) ?? 1) - 1;
        if (left > 0) backgroundRunning.set(sessionId, left);
        else backgroundRunning.delete(sessionId);
      }
      try {
        // io may belong to a run that already ended — sending must not throw.
        io.send({ type: 'background_done', label, summary });
      } catch {
        /* host io gone — nothing to report to */
      }
    })();
  } catch {
    /* hosting must never throw into the tool caller */
  }
}

// ============================================================
// Helpers
// ============================================================

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${message} (after ${ms}ms)`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Resolve provider credentials. Order:
 *  1. Renderer-supplied overrides (forward-compatible fields on params).
 *  2. Main-process injected providers map (register.ts injects this — the
 *     single source of truth).
 *  3. Main-process settings service (defensive direct read).
 * All keys are trimmed; empty keys are treated as MISSING, never sent.
 */
function resolveCredentials(
  params: AgentRunParams,
  settings?: AppSettings,
): { apiKey?: string; baseUrl?: string } {
  const pick = (
    entry?: { apiKey?: string; baseUrl?: string },
  ): { apiKey?: string; baseUrl?: string } | null => {
    if (!entry) return null;
    const apiKey = typeof entry.apiKey === 'string' ? entry.apiKey.trim() : '';
    const baseUrl = typeof entry.baseUrl === 'string' ? entry.baseUrl.trim() : '';
    if (!apiKey && !baseUrl) return null;
    return { apiKey: apiKey || undefined, baseUrl: baseUrl || undefined };
  };

  const extended = params as AgentRunParams & {
    apiKey?: string;
    baseUrl?: string;
    providers?: Partial<Record<ProviderId, { apiKey?: string; baseUrl?: string }>>;
  };
  const direct = pick({ apiKey: extended.apiKey, baseUrl: extended.baseUrl });
  if (direct) return direct;
  const injected = pick(extended.providers?.[params.model.provider]);
  if (injected) return injected;
  // v11.21 — prefer the run's single settings snapshot; only fall back to a
  // direct service read when no snapshot was supplied (keeps this helper's
  // standalone callers working without an extra disk read on the hot path).
  const resolved = pick(settings?.providers?.[params.model.provider]);
  if (resolved) return resolved;
  try {
    // storeService is the main-process settings source (sync getSettings).
    const svc = require('../services/storeService') as Record<string, unknown>;
    const get = (svc.getSettings ?? svc.load ?? svc.read) as
      | (() => AppSettings | Promise<AppSettings>)
      | undefined;
    if (typeof get === 'function') {
      const s = get();
      if (!(s instanceof Promise)) {
        const fromService = pick(s?.providers?.[params.model.provider]);
        if (fromService) return fromService;
      }
    }
  } catch {
    /* no settings service available — continue without credentials */
  }
  return {};
}

/** Providers that physically cannot work without an API key. */
// v11.9 (E13) — completed with the exact ProviderId family ids used in
// router.ts PROVIDER_FAMILY / creds code: xai, moonshot, qwen, mistral.
// (ollama and custom stay key-optional by design.)
const KEY_REQUIRED_PROVIDERS = new Set<ProviderId>([
  'anthropic',
  'openai',
  'openrouter',
  'gemini',
  'zai',
  'deepseek',
  'xai',
  'moonshot',
  'qwen',
  'mistral',
]);

/**
 * UI transcript → normalized ProviderMsg[].
 * - skips UI error markers (assistant messages with model==='error')
 * - merges consecutive assistant tool_call messages into one assistant msg
 * - expands @mentions for user text (≤5 files, ≤8k chars each, ≤40k total)
 */
/** Test/diagnostic export: transcript → provider messages. */
export async function toProviderMessages(chat: ChatMessage[], workspace: string): Promise<ProviderMsg[]> {
  const out: ProviderMsg[] = [];
  const openCalls = new Set<string>(); // tool_calls without a result yet
  for (const m of chat) {
    if (m.role === 'assistant' && m.model === 'error') continue; // UI marker

    if (m.kind === 'tool_call') {
      if (!m.toolCallId || !m.toolName) continue;
      openCalls.add(m.toolCallId);
      const last = out[out.length - 1];
      if (last && last.role === 'assistant') {
        (last.toolCalls ??= []).push({ id: m.toolCallId, name: m.toolName, args: m.content || '{}' });
      } else {
        out.push({
          role: 'assistant',
          toolCalls: [{ id: m.toolCallId, name: m.toolName, args: m.content || '{}' }],
        });
      }
      continue;
    }

    if (m.kind === 'tool_result') {
      if (!m.toolCallId) continue;
      openCalls.delete(m.toolCallId);
      out.push({
        role: 'tool_result',
        callId: m.toolCallId,
        content: m.content ?? '',
        isError: m.resultOk === false,
      });
      continue;
    }

    // Plain text message: close any dangling tool_calls from an interrupted
    // session — providers reject tool_use without a matching tool_result.
    if (openCalls.size > 0) {
      for (const id of openCalls) {
        out.push({ role: 'tool_result', callId: id, content: '[interrupted — no result recorded]', isError: true });
      }
      openCalls.clear();
    }
    if (!m.content || !m.content.trim()) continue;
    if (m.role === 'user') {
      const text = await expandMentions(m.content, workspace);
      const images = m.images?.length ? await resolveImages(m.images, workspace) : [];
      out.push(images.length ? { role: 'user', text, images } : { role: 'user', text });
    } else if (m.role === 'assistant') {
      const last = out[out.length - 1];
      if (last && last.role === 'assistant' && !last.text) last.text = m.content;
      else out.push({ role: 'assistant', text: m.content });
    }
  }
  // Trailing dangling calls (session ended mid-tool)
  for (const id of openCalls) {
    out.push({ role: 'tool_result', callId: id, content: '[interrupted — no result recorded]', isError: true });
  }
  return out;
}

const IMAGE_MAX_COUNT = 5;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * Normalize image attachments to data URLs (vision messages).
 * Accepts data: URLs as-is and absolute/relative file paths (read from
 * disk). Caps count at 5 and size at 5 MB each; unreadable items are
 * skipped so a bad attachment never blocks the whole message.
 */
/** Test/diagnostic export: normalize image attachments to data URLs. */
export async function resolveImages(images: string[], workspace: string): Promise<string[]> {
  const out: string[] = [];
  for (const raw of images) {
    if (out.length >= IMAGE_MAX_COUNT) break;
    if (typeof raw !== 'string' || !raw) continue;
    if (raw.startsWith('data:image/')) {
      if (raw.length <= IMAGE_MAX_BYTES * 1.4) out.push(raw); // base64 ≈ 4/3 of bytes
      continue;
    }
    if (raw.includes('..') || raw.length > 1024) continue;
    const abs = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(workspace, raw);
    const ext = path.extname(abs).toLowerCase();
    const mime = IMAGE_MIME[ext];
    if (!mime) continue;
    try {
      const st = await fs.stat(abs);
      if (!st.isFile() || st.size > IMAGE_MAX_BYTES) continue;
      const buf = await fs.readFile(abs);
      out.push(`data:${mime};base64,${buf.toString('base64')}`);
    } catch {
      /* unreadable → skip */
    }
  }
  return out;
}

/** Expand @path mentions in user text with capped file contents. */
async function expandMentions(content: string, workspace: string): Promise<string> {
  if (!content.includes('@')) return content;
  const parts: string[] = [content];
  const seen = new Set<string>();
  let files = 0;
  let total = 0;

  for (const match of content.matchAll(/@([^\s]+)/g)) {
    if (files >= MENTION_MAX_FILES || total >= MENTION_TOTAL_CAP) break;
    const token = match[1].replace(/[,.;:!?)\]}'"]+$/, ''); // strip trailing punctuation
    if (!token || token.includes('..') || token.length > 512) continue;

    const abs = path.resolve(workspace, token);
    const rel = path.relative(workspace, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue; // stay inside the workspace
    if (seen.has(abs)) continue;
    seen.add(abs);

    try {
      const st = await fs.stat(abs);
      if (!st.isFile()) continue;
      let text = await fs.readFile(abs, 'utf8');
      if (text.length > MENTION_MAX_FILE_CHARS) text = text.slice(0, MENTION_MAX_FILE_CHARS) + '\n… [truncated]';
      total += text.length;
      files++;
      parts.push(`\n\n[File @${token}]:\n${text}`);
    } catch {
      /* not an existing file — leave the token as plain text */
    }
  }
  return files ? parts.join('') : content;
}

/**
 * v11.23 (P1 — FATAL 402) — a fatal provider failure must die on the FIRST
 * response: no engine-level retry, no failover, no silent multi-second stall.
 * `isInvalidKeyError` covers 401 (and its string fallbacks); the shared
 * classifier adds 402/no_credits, 403/forbidden, 404/not_found and 400/
 * bad_request — all deterministic, never fixed by repeating the same call.
 * Transient kinds (429 / 5xx / network) deliberately stay on the retry path.
 */
function isFatalProviderError(err: unknown): boolean {
  if (err == null) return false;
  if (isInvalidKeyError(err)) return true;
  try {
    const kind = providerErrorKindOf(err);
    return kind === 'no_credits' || kind === 'forbidden' || kind === 'not_found' || kind === 'bad_request';
  } catch {
    return false;
  }
}

/**
 * v11.27 (429 CONTINUE) — providers.ts now owns the GENEROUS in-place 429
 * recovery (bounded exponential backoff, ≤1s each, 5-8 attempts over a ~60s
 * budget, ONE quiet notice). If a rate-limit error still reaches the engine it
 * means that recovery GENUINELY EXHAUSTED: re-running the whole engine retry
 * schedule (or auto-switching providers) would only duplicate the wait and
 * break the "no auto-switch on a rate-limited provider" contract. This error
 * is terminal for the turn — the honest report is produced below.
 */
function isRateLimitExhausted(err: unknown): boolean {
  if (err == null) return false;
  try {
    return providerErrorKindOf(err) === 'rate_limited';
  } catch {
    return false;
  }
}

/**
 * v11.24 — a slow/stalled/network failure is NOT a reason to auto-switch
 * providers (the founder's "it jumped to another model by itself" complaint).
 * This mirrors providers.ts v11.19 slow-provider handling for the engine's own
 * retry/failover loop: the user gets an honest notice and decides in Settings.
 */
function isSlowProviderError(err: unknown): boolean {
  if (err == null) return false;
  try {
    if (providerErrorKindOf(err) === 'network') return true;
  } catch {
    /* fall through to the string classifier */
  }
  return /stalled|timeout|timed out|ETIMEDOUT|ECONNRESET|stream idle watchdog/i.test(String(err));
}

/** Map raw provider/network errors to friendly, actionable messages. */
function friendlyError(err: unknown, model: ModelConfig): string {
  const raw = err instanceof Error ? err.message : String(err);
  // v11.23 (P0 — RAW PAYLOAD LEAK) — untrusted provider text is NEVER shown
  // verbatim. Sanitize ONCE up front, then keep only a short plain reason
  // phrase: embedded JSON / gateway jargon is dropped and the curated
  // classification below supplies the actionable text. Classification still
  // reads the RAW text (a status code in the body may be stripped otherwise).
  const sanitized = sanitizeErrorText(raw) || '';
  const msg =
    sanitized && sanitized.length <= 96 && !/[{}"\[\]]/.test(sanitized)
      ? sanitized
      : 'Check Settings → AI providers.';
  const l = raw.toLowerCase();
  // Classify from the SHARED provider taxonomy first. HTTP errors carry a
  // structured `kind`/`status`, so a 402 is never mislabeled and a reworded
  // 429 is still recognised. String checks remain a fallback for plain Errors.
  let kind: ReturnType<typeof providerErrorKindOf> | '' = '';
  try {
    kind = providerErrorKindOf(err);
  } catch {
    /* the classifier is pure and best-effort — never break error reporting */
  }
  // v11.23 (P0) — 402 / no_credits BEFORE the generic 4xx branches. Single
  // language, actionable, NO provider name in the message (the renderer adds
  // the translated toast; a hardcoded provider name leaked vendor identity).
  if (kind === 'no_credits' || l.includes('402') || l.includes('insufficient credits')) {
    return 'Insufficient credits (402): add balance to the provider account or switch the provider/key in Settings → Providers.';
  }
  if (
    kind === 'network' ||
    l.includes('fetch failed') ||
    l.includes('network') ||
    l.includes('enotfound') ||
    l.includes('econnrefused') ||
    l.includes('econnreset') ||
    l.includes('socket hang up') ||
    l.includes('eai_again')
  ) {
    return `Network error — check connection/proxy. (provider: ${model.provider})`;
  }
  // v11.9 (E10) — a content-filter block is never a normal end: name it.
  if (l.includes('content_filter') || l.includes('content filter')) {
    return 'The provider safety filter blocked this response (content_filter). Rephrase the request or try another model.';
  }
  if (kind === 'invalid_key' || l.includes('401')) return 'Invalid API key (401). Check Settings → AI providers.';
  if (kind === 'forbidden' || l.includes('403')) return 'Access forbidden (403). Check the provider/key permissions in Settings → AI providers.';
  // v11.23 (P0) — ONE canonical, quiet 429 wording, identical to providers.ts.
  if (kind === 'rate_limited' || l.includes('429')) return 'Rate limited (429) - retries were exhausted; the chosen provider was kept. Wait briefly, then send again.';
  if (kind === 'not_found' || l.includes('404')) return `Model not found (404): ${model.model}. Check the model name in Settings.`;
  // v11.23 (P0) — a 5xx is a provider-side failure, not user input. Curated,
  // actionable text; the sanitized detail is never forwarded verbatim.
  if (kind === 'server_error') return 'Provider server error (5xx). Wait a moment and try again, or switch the provider/model in Settings → AI providers.';
  if (kind === 'bad_request') {
    const status = (err as { status?: number } | null)?.status;
    return `Bad request (${typeof status === 'number' ? status : 400}): ${msg}`;
  }
  if (l.includes('400')) return `Bad request (400): ${msg}`;
  return msg;
}

// ============================================================
// v2 — auto-memory (post-run learning into MEMORY.md)
// ============================================================

const MEMORY_EXTRACT_SYSTEM =
  'You extract durable engineering facts for a project memory file. From the transcript tail, output ONLY ' +
  '0-3 bullet lines (each starting with "- "), each one concise durable fact about the project: build/test ' +
  'commands, conventions, architecture decisions, gotchas. No headers, no preamble, no transient details. ' +
  'Output nothing at all if there is nothing worth remembering.';

// ============================================================
// v2.2 — Surnia DNA: post-run user-model extraction (fire-and-forget)
// ============================================================

const DNA_EXTRACT_MSGS = 10;
const DNA_EXTRACT_SYSTEM =
  'You maintain the Surnia DNA user model — durable facts about HOW THIS USER works, not about the task. ' +
  'From the transcript tail extract: role/expertise/languages, style preferences (naming, formatting, verbosity, ' +
  'tooling), repeated workflows or commands, and corrections of the assistant\'s behavior. ' +
  'NEVER invent dislikes or negative preferences: omit the dislikes array ENTIRELY unless the user EXPLICITLY said they dislike something, in their own words, in this transcript. ' +
  'Return ONLY JSON (no code fences): {"profile_additions":{"expertise":[],"languages":[],"likes":[],"styleNotes":[]},' +
  '"patterns_additions":[{"kind":"command|workflow|style|correction","text":"one sentence"}]} — ' +
  'ONLY durable, reusable facts, never one-off task details. Return {} (empty JSON) if nothing new.';

/**
 * v2.2 — fire-and-forget DNA extraction after a completed run. ONE lightweight
 * no-tools model call (the same pattern as learnMemoryFacts) → defensively
 * parse the JSON → merge via dna.mergeExtraction (dedupe + confidence +
 * prune) → persist. Bumps sessionsObserved so the growth chart tracks usage.
 * ALL errors are swallowed — DNA must never surface a run failure.
 */
async function learnDNAFacts(o: {
  workspace: string;
  messages: ProviderMsg[];
  model: ModelConfig;
  creds: { apiKey?: string; baseUrl?: string };
  signal: AbortSignal;
  onUpdated?: () => void;
}): Promise<void> {
  try {
    // Compact transcript tail: roles + text only, tightly capped.
    const lines: string[] = [];
    for (const m of o.messages.slice(-DNA_EXTRACT_MSGS)) {
      if (m.role === 'user') lines.push('[user] ' + m.text.slice(0, 600));
      else if (m.role === 'assistant' && m.text) lines.push('[assistant] ' + m.text.slice(0, 600));
      else if (m.role === 'tool_result') lines.push('[tool] ' + m.content.slice(0, 200));
      if (lines.join('\n').length > 6000) break;
    }
    if (!lines.length) return;

    let out = '';
    // v11.34 (V14) — a transient provider hiccup must not silently end
    // learning. Retry the small extraction call up to 3 times with a short
    // bounded backoff; fire-and-forget so it never blocks or fails the run.
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      out = '';
      try {
        const res = await streamTurn({
          model: o.model,
          apiKey: o.creds.apiKey,
          baseUrl: o.creds.baseUrl,
          system: DNA_EXTRACT_SYSTEM,
          messages: [
            {
              role: 'user',
              text:
                'Transcript tail:\n\n' +
                lines.join('\n') +
                '\n\nExtract durable facts about HOW THIS USER works (JSON only, {} if nothing new):',
            },
          ],
          tools: [],
          signal: o.signal,
          promptCaching: false,
          maxRetries: 0,
          onText: (t) => {
            out += t;
          },
          onToolUse: () => {
            /* no tools in play */
          },
        });
        if (res.stopReason !== 'error') ok = true;
      } catch {
        /* retry below */
      }
      if (!ok && attempt < 2) await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
    if (!ok) return;

    // Defensively parse: strip code fences, find the outermost JSON object.
    const match = /\{[\s\S]*\}/.exec(out.replace(/```(?:json)?/gi, ''));
    if (!match) return;
    let extracted: dna.ExtractionInput;
    try {
      extracted = JSON.parse(match[0]) as dna.ExtractionInput;
    } catch {
      return;
    }

    const changed = await dna.mergeExtractionInto(o.workspace, extracted);
    if (changed) o.onUpdated?.();
  } catch {
    /* DNA extraction must never surface an error */
  }
}

// ============================================================
// v11.12 — LIVING PLAYBOOK: post-run extraction (fire-and-forget)
// ============================================================

const PLAYBOOK_EXTRACT_MSGS = 12;
const PLAYBOOK_EXTRACT_SYSTEM =
  'You maintain the SADEEM Living Playbook — a workspace field guide of what ACTUALLY worked and failed in real ' +
  'runs. From the transcript tail, extract ONLY durable, reusable lessons (never one-off task details):\n' +
  '- worked: approaches/commands/tool choices that succeeded here.\n' +
  '- failed: approaches that failed, with the gotcha to avoid.\n' +
  '- preferences: durable user preferences observed (style, naming, language, workflow).\n' +
  '- recipes: verified step-by-step recipes that can be reused verbatim.\n' +
  'NEVER invent negative preferences. Return ONLY JSON (no code fences): ' +
  '{"worked":[],"failed":[],"preferences":[],"recipes":[],"learned":"one short sentence (max 200 chars) describing the single most useful thing learned"} — ' +
  'empty arrays and empty learned string when nothing new.';

/**
 * v11.12 — fire-and-forget playbook extraction after a completed run. ONE
 * no-tools model call → defensive JSON parse → merge into the workspace
 * PLAYBOOK.md + version timeline via playbook.learnPlaybook(). Emits
 * `onLearned(summary, version)` so the UI can toast + refresh. NEVER throws.
 */
async function learnPlaybookFacts(o: {
  workspace: string;
  messages: ProviderMsg[];
  model: ModelConfig;
  creds: { apiKey?: string; baseUrl?: string };
  signal: AbortSignal;
  sessionId: string;
  onLearned?: (summary: string, version: number) => void;
}): Promise<void> {
  try {
    const lines: string[] = [];
    for (const m of o.messages.slice(-PLAYBOOK_EXTRACT_MSGS)) {
      if (m.role === 'user') lines.push('[user] ' + m.text.slice(0, 600));
      else if (m.role === 'assistant' && m.text) lines.push('[assistant] ' + m.text.slice(0, 600));
      else if (m.role === 'tool_result') lines.push('[tool] ' + m.content.slice(0, 220));
      if (lines.join('\n').length > 6000) break;
    }
    if (!lines.length) return;

    let out = '';
    try {
      const res = await streamTurn({
        model: o.model,
        apiKey: o.creds.apiKey,
        baseUrl: o.creds.baseUrl,
        system: PLAYBOOK_EXTRACT_SYSTEM,
        messages: [
          { role: 'user', text: 'Transcript tail:\n\n' + lines.join('\n') + '\n\nPlaybook update (JSON only):' },
        ],
        tools: [],
        signal: o.signal,
        promptCaching: false,
        maxRetries: 0,
        onText: (t) => {
          out += t;
        },
        onToolUse: () => {
          /* no tools in play */
        },
      });
      if (res.stopReason === 'error') return;
    } catch {
      return; // provider errors are silently ignored
    }

    const match = /\{[\s\S]*\}/.exec(out.replace(/```(?:json)?/gi, ''));
    if (!match) return;
    let update: playbook.PlaybookUpdate;
    try {
      const parsed = JSON.parse(match[0]) as Record<string, unknown>;
      update = {
        worked: asStringArraySafe(parsed.worked),
        failed: asStringArraySafe(parsed.failed),
        preferences: asStringArraySafe(parsed.preferences),
        recipes: asStringArraySafe(parsed.recipes),
        learned: typeof parsed.learned === 'string' ? parsed.learned : '',
        sessionId: o.sessionId,
      };
    } catch {
      return;
    }
    const result = await playbook.learnPlaybook(o.workspace, update);
    if (result.changed) o.onLearned?.(result.revision.summary, result.data.version);
  } catch {
    /* playbook extraction must never surface an error */
  }
}

function asStringArraySafe(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((s) => s.trim().slice(0, 220));
}

/**
 * v2 auto-memory: fire-and-forget post-run learning. Distills 0-3 durable
 * facts from the tail of a successful run (that performed writes) via a
 * one-shot no-tools model call, then merges them into MEMORY.md under a
 * '## Learned' section (exact-line dedup, 60-line cap). ALL errors are
 * swallowed — learning must never surface in the UI.
 */
async function learnMemoryFacts(o: {
  workspace: string;
  messages: ProviderMsg[];
  model: ModelConfig;
  creds: { apiKey?: string; baseUrl?: string };
  maxRetries?: number;
  signal: AbortSignal;
}): Promise<void> {
  try {
    // Compact transcript tail: roles + text only, tightly capped.
    const lines: string[] = [];
    for (const m of o.messages.slice(-MEMORY_EXTRACT_MSGS)) {
      if (m.role === 'user') lines.push('[user] ' + m.text.slice(0, 600));
      else if (m.role === 'assistant' && m.text) lines.push('[assistant] ' + m.text.slice(0, 600));
      else if (m.role === 'tool_result') lines.push('[tool] ' + m.content.slice(0, 200));
      if (lines.join('\n').length > 4000) break;
    }
    if (!lines.length) return;

    let out = '';
    try {
      const res = await streamTurn({
        model: o.model,
        apiKey: o.creds.apiKey,
        baseUrl: o.creds.baseUrl,
        system: MEMORY_EXTRACT_SYSTEM,
        messages: [
          { role: 'user', text: 'Transcript tail:\n\n' + lines.join('\n') + '\n\nDurable facts worth remembering:' },
        ],
        tools: [],
        signal: o.signal,
        promptCaching: false,
        maxRetries: 0,
        onText: (t) => {
          out += t;
        },
        onToolUse: () => {
          /* no tools in play */
        },
      });
      if (res.stopReason === 'error') return;
    } catch {
      return; // provider errors are silently ignored
    }

    const additions = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^[-*•]\s+\S/.test(l))
      .map((l) => '- ' + l.replace(/^[-*•]\s+/, '').trim())
      .slice(0, 3);
    if (!additions.length) return;

    const file = path.join(o.workspace, 'MEMORY.md');
    let existing = '';
    try {
      existing = await fs.readFile(file, 'utf8');
    } catch {
      /* no MEMORY.md yet — start fresh */
    }
    const merged = mergeLearnedSection(existing, additions);
    if (merged === existing) return; // nothing new (exact duplicates)
    await fs.writeFile(file, merged, 'utf8');
  } catch {
    /* auto-memory must never surface an error */
  }
}

/**
 * Merge bullet lines into MEMORY.md's '## Learned' section. Exact-line dedup;
 * the section is capped at MEMORY_LEARNED_CAP lines. Pure helper (exported for
 * unit tests) — returns the original text unchanged when nothing is new.
 */
export function mergeLearnedSection(existing: string, additions: string[]): string {
  const lines = existing.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toLowerCase() === '## learned');
  let learned: string[] = [];
  let after = start; // exclusive end index of the section body
  if (start >= 0) {
    let i = start + 1;
    for (; i < lines.length; i++) {
      const t = lines[i].trim();
      if (/^#{1,6}\s/.test(t)) break; // next section header
      if (/^[-*•]\s+\S/.test(t)) learned.push('- ' + t.replace(/^[-*•]\s*/, ''));
    }
    after = i;
  }
  const seen = new Set(learned);
  // Normalize every addition to a '- ' bullet so the section stays uniform.
  const fresh = additions
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => (/^[-*•]\s*/.test(a) ? '- ' + a.replace(/^[-*•]\s*/, '') : '- ' + a))
    .filter((a) => !seen.has(a));
  if (!fresh.length) return existing;
  learned = [...learned, ...fresh].slice(-MEMORY_LEARNED_CAP);
  const section = ['## Learned', ...learned].join('\n');
  if (start >= 0) {
    return [...lines.slice(0, start), ...section.split('\n'), ...lines.slice(after)].join('\n');
  }
  const head = existing.trimEnd();
  return (head ? head + '\n\n' : '') + section + '\n';
}

// ============================================================
// v2.1 — memory nudge / skill transcript / keywords / recap
// ============================================================

const STOPWORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'has', 'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all',
  'can', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'his', 'how', 'man', 'new', 'now', 'old', 'see',
  'two', 'way', 'who', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use', 'will', 'would', 'could',
  'should', 'into', 'than', 'then', 'them', 'there', 'these', 'they', 'this', 'what', 'when', 'where',
  'which', 'while', 'your', 'mine', 'please', 'make', 'made', 'just', 'like', 'need', 'want', 'file',
  'files', 'code', 'also', 'about', 'after', 'before', 'because', 'been', 'being', 'some', 'such', 'only',
  'over', 'very', 'well', 'were', 'does', 'done', 'don\u0027t', 'didn\u0027t', 'work', 'works',
]);

/** Top keywords (4+ letters, stopword-filtered) from recent user text — cap 10. */
export function extractKeywords(text: string): string {
  const freq = new Map<string, number>();
  for (const m of (text ?? '').matchAll(/[A-Za-z][A-Za-z0-9_-]{3,}/g)) {
    const w = m[0].toLowerCase();
    if (STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w)
    .join(', ');
}

/** Normalized similarity prefix for memory-nudge dedupe (first 48 chars). */
function similarityPrefix(line: string): string {
  return line
    .toLowerCase()
    .replace(/^[-*•]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
}

/**
 * v2.1 MEMORY NUDGE — session-end learning. Appends ONE templated line to
 * MEMORY.md's '## Learned' section summarizing the session (tool calls, files
 * touched). Deduped by similarity prefix so running the same kind of session
 * repeatedly does not pile up near-identical lines. Never throws.
 */
export async function nudgeSessionMemory(o: {
  workspace: string;
  toolCalls: number;
  files: string[];
  aborted?: boolean;
}): Promise<void> {
  try {
    if (!o.workspace) return;
    const fileList = o.files.filter(Boolean).slice(0, 3).join(', ');
    const more = o.files.length > 3 ? ` (+${o.files.length - 3} more)` : '';
    const line =
      `- session ${new Date().toISOString().slice(0, 16).replace('T', ' ')} — ` +
      `${o.toolCalls} tool calls${o.aborted ? ' (aborted)' : ''}` +
      `${fileList ? `; touched: ${fileList}${more}` : ''}`;
    const file = path.join(o.workspace, 'MEMORY.md');
    let existing = '';
    try {
      existing = await fs.readFile(file, 'utf8');
    } catch {
      existing = ''; // no MEMORY.md yet — start one
    }
    // similarity-prefix dedupe against the existing '## Learned' bullets
    const learnedStart = existing.split(/\r?\n/).findIndex((l) => l.trim().toLowerCase() === '## learned');
    if (learnedStart >= 0) {
      const prefix = similarityPrefix(line);
      const body = existing.split(/\r?\n/).slice(learnedStart + 1);
      for (const l of body) {
        if (!/^[-*•]\s+\S/.test(l.trim())) {
          if (/^#{1,6}\s/.test(l.trim())) break; // next section
          continue;
        }
        if (similarityPrefix(l) === prefix) return; // near-identical line exists
      }
    }
    const merged = mergeLearnedSection(existing, [line]);
    if (merged === existing) return;
    await fs.writeFile(file, merged, 'utf8');
  } catch {
    /* the memory nudge must never surface an error */
  }
}

/**
 * v2.1 — compact transcript tail for the skill-writer subagent (roles + text,
 * tool calls summarized as one-liners). Capped at 12k chars. Exported for reuse.
 */
export function transcriptTailForSkill(messages: readonly ProviderMsg[], maxChars = 12_000): string {
  const lines: string[] = [];
  const recent = messages.slice(-40);
  for (const m of recent) {
    if (m.role === 'user') lines.push('[user] ' + m.text.replace(/\s+/g, ' ').slice(0, 500));
    else if (m.role === 'assistant') {
      if (m.toolCalls?.length) {
        for (const c of m.toolCalls) lines.push(`[tool] ${c.name} ${firstArgSummary(safeJson(c.args))}`.trimEnd());
      }
      if (m.text) lines.push('[assistant] ' + m.text.replace(/\s+/g, ' ').slice(0, 500));
    } else if (m.role === 'tool_result') {
      lines.push('[result] ' + (m.isError ? 'ERROR: ' : '') + m.content.replace(/\s+/g, ' ').slice(0, 200));
    }
    if (lines.join('\n').length > maxChars) break;
  }
  const out = lines.join('\n');
  return out.length > maxChars ? out.slice(-maxChars) : out;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: String(s).slice(0, 200) };
  }
}

// ============================================================
// v2.1 — /recap (template markdown, NO model call)
// ============================================================

/**
 * Build a markdown session recap from persisted session data + engine state.
 * Sections: goal, steps done (todos), files touched (write/edit tool calls),
 * decisions (key user messages), usage. Pure template — no model call.
 */
export function buildSessionRecap(data: SessionData, goal?: string | null, engineVersion?: string): string {
  const files = new Map<string, number>();
  const decisions: string[] = [];
  const date = new Date(data.updatedAt || Date.now()).toISOString().slice(0, 16).replace('T', ' ');
  for (const m of data.messages ?? []) {
    if (m.role === 'user' && m.kind !== 'tool_result' && m.content.trim() && !m.content.startsWith('/')) {
      if (decisions.length < 12) decisions.push(m.content.replace(/\s+/g, ' ').trim().slice(0, 220));
    }
    if (m.kind === 'tool_call' && (m.toolName === 'write_file' || m.toolName === 'edit_file')) {
      try {
        const args = JSON.parse(m.content || '{}') as { path?: string };
        if (typeof args.path === 'string' && args.path) {
          files.set(args.path, (files.get(args.path) ?? 0) + 1);
        }
      } catch {
        /* malformed args — skip */
      }
    }
  }
  const todos = data.todos ?? [];
  const todoLines = todos.length
    ? todos.map((t) => `- [${t.status === 'completed' ? 'x' : ' '}] ${t.content}`).join('\n')
    : '_(no todo list was kept)_';
  const fileLines = files.size
    ? [...files.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([p, n]) => `- \`${p}\` (${n} edit${n === 1 ? '' : 's'})`)
        .join('\n')
    : '_(no files were modified)_';
  const tokens = data.totalTokens ?? 0;
  const cost = data.totalCostUsd ?? 0;
  return [
    `# Session recap — ${data.title || data.id}`,
    `- Date: ${date}`,
    `- Messages: ${(data.messages ?? []).length}`,
    engineVersion ? `- Engine: ${engineVersion}` : '',
    '',
    '## Goal',
    (goal || decisions[0] || '_(no explicit goal)_').slice(0, 500),
    '',
    '## Steps done',
    todoLines,
    '',
    '## Files touched',
    fileLines,
    '',
    '## Decisions & key input',
    decisions.length ? decisions.map((d) => `- ${d}`).join('\n') : '_(none recorded)_',
    '',
    '## Usage',
    `- Tokens: ${tokens.toLocaleString('en-US')}`,
    `- Cost: $${cost.toFixed(4)}`,
    '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}
