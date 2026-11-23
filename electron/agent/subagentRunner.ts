// ============================================================
// SADEEM v11.19 — detached subagent runner (powers "Retry failed",
// the parallel `task` batch host and every headless subagent loop).
// ------------------------------------------------------------
// The engine's inline `runSubagent` lives inside an active run and dies with
// it. This module is self-contained: it resolves the current provider/model
// AND tool profile from settings, rebuilds the specialist prompt with the
// parent's capability mindset, runs a bounded streamTurn tool loop (a
// specialist can NEVER bypass the parent's approval gate) and streams REAL
// step progress back through the ledger hooks.
//
// v11.19 audit contract:
//  · `runSubagentBatch` launches tasks before awaiting them (up to the v1142
//    user cap, default 64), so two `task` subagents genuinely overlap. A
//    per-task deadline means one dead/failed subagent NEVER hangs or drops
//    the others; every task still gets a real result.
//  · Every result is returned to the caller (honest success OR failure) with a
//    clear notice + retry hint — no silent failures, no lost results.
//  · Every subagent has a wall-clock budget (env SURNIA_SUBAGENT_TIMEOUT_MS).
//  · The system prompt inherits the parent capability contract + tool profile;
//    `approve` delegates to the parent gate (fail-closed when absent) and
//    `fullAccess` is always false.
// v11.23 audit contract (real subagent path):
//  · The batch supplies EACH child a per-task AbortController via `hooks.signal`
//    and races the child against the PARENT's abort signal. A timeout/abort
//    actually stops the child's work — no orphaned process after the race.
//  · The deadline is owned ONCE (by the batch). The detached runner is told
//    `externalDeadline`, so there is no second timer to double-emit notices or
//    turn an honest timeout into `timedOut:false`.
//  · Parent abort yields explicit `aborted` results + ledger status 'aborted',
//    never a misleading child "error"; consumers/notice callbacks are guarded
//    so their exceptions cannot be misattributed as a child/parent error.
//  · One canonical bus notice per failure (finalize owns it when ledger on).
// This module never throws to a batch caller; `runStandaloneSubagent` throws
// only to its direct caller, with an honest message.
//
// v11.36 capability contract (FOUNDER #1): EVERY specialist — including the
// research/review/skill ones — is advertised and executes the FULL registry
// (145 core tools + MCP defs from the same registry + provider-native extras),
// exactly like the main AI. Specialists differ by prompt/role PERSONALITY,
// NOT by capability. The old `spec.tools` subset and the profile-based slice
// are gone: neither can make a tool "not allowed" by name any more. The V3
// tool profile survives only as a per-turn VIEW hint for weak models; it is
// never a dispatch gate. A subagent claiming "I don't have the tools" is now
// factually wrong and the system prompt says so explicitly.
// ============================================================
import type { AppSettings, ModelConfig, SubagentId, ToolProfile } from '../../shared/types';
import { clampMaxSubagents } from '../../shared/types';
import { getAgent } from './agents';
import { executeTool, getToolDefs, type ToolContext } from './tools';
import { streamTurn, getProviderToolDefs, type ProviderMsg, type ToolDef } from './providers';
import { redactSecrets } from './risk';
import { refCreds } from './router';
import * as subagents from './subagents';
import type {
  SubagentNotice,
  SubagentProgressEvent,
  SubagentRecord,
  SubagentRetryHooks,
  SubagentApprovalRequest,
} from './subagents';

const MAX_ITERATIONS = 12;
const DEFAULT_SUBAGENT_TIMEOUT_MS = 2 * 60_000;
const RESULT_CAP = 12_000;

/**
 * v11.23 — the parallel batch owns each child's wall-clock deadline. A detached
 * runner invoked through `defaultBatchRunner` must therefore NOT arm a second
 * timer for the same budget: two timers raced, the inner one won, and the outer
 * result was reported with `timedOut:false` (a dishonest timeout notice).
 * `externalDeadline` makes the runner observe only `signal`, which the batch
 * aborts on deadline/parent-cancel — so no child outlives its parent.
 */
type BatchHooks = SubagentRetryHooks & { externalDeadline?: boolean };

/** Per-subagent wall-clock budget, read at call time (tests shrink it). */
export function subagentTimeoutMs(): number {
  const raw = Number(process.env.SURNIA_SUBAGENT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_SUBAGENT_TIMEOUT_MS;
}

function settings(): AppSettings | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const svc = require('../services/storeService') as { getSettings(): AppSettings };
    return svc.getSettings();
  } catch {
    return null;
  }
}

/** v1142 — the same real user setting the engine's background path uses,
 *  clamped to [1, 64]. Used to bound the parallel batch host too. */
export function subagentBatchCap(): number {
  return clampMaxSubagents(settings()?.maxSubagents);
}

/** Inherit the parent's advertised tool profile (balanced is the app default). */
export function toolProfileOf(s: AppSettings | null): ToolProfile {
  const p = s?.agent?.toolProfile;
  return p === 'essential' || p === 'balanced' || p === 'full' ? p : 'balanced';
}

/**
 * v11.36 — the FULL callable registry for EVERY subagent, identical to the
 * main AI's surface: all 145 core defs (getToolDefs default = 'full'), any
 * MCP defs supplied to that registry, plus provider-native extras
 * (getProviderToolDefs: web_search / computer_use / unknown provider tools).
 *
 * NO profile slice and NO specialist allow-list here. `executeTool` resolves
 * this same full registry at dispatch time, so a tool that is merely hidden
 * from a per-turn VIEW still runs the moment the model names it. The profile
 * is only a weak-model prompt hint — never a permission boundary.
 */
export function subagentToolDefs(): ToolDef[] {
  const seen = new Set<string>();
  const all: ToolDef[] = [];
  for (const def of [...getToolDefs([], 'full'), ...getProviderToolDefs()]) {
    if (seen.has(def.name)) continue; // keep the first (core) def; never duplicate
    seen.add(def.name);
    all.push(def);
  }
  return all;
}

/**
 * Specialist prompt = parent capability mindset + this agent's FULL toolset +
 * specialist instructions (personality/role only). Written so a weak model
 * never claims a missing capability, but is told the TRUTH about the approval
 * gate it sits behind. There is deliberately NO 40-tool truncation any more:
 * the advertised list is the complete registry, on every turn.
 */
export function buildSubagentSystemPrompt(o: {
  name: string;
  prompt: string;
  tools: string[];
  profile: ToolProfile;
  workspace: string;
}): string {
  const toolLine = o.tools.length ? o.tools.join(', ') : '(no tools available to this specialist)';
  // The V3 profile is a per-turn VIEW for weak models ONLY. It never removes a
  // tool from `o.tools` and never gates dispatch — state that in the prompt so
  // a weak model cannot invent a "not allowed" refusal.
  const viewNote = o.profile === 'full'
    ? 'Tool profile: full — every registered tool is advertised to you.'
    : `Tool profile "${o.profile}" is a per-turn VIEW for weak models ONLY. It does NOT restrict you: you can call ANY tool by its exact name.`;
  return [
    `You are ${o.name}, a specialist subagent in the SADEEM agent team.`,
    '# Capability contract (inherited from the parent agent)',
    'You are FULLY CAPABLE — a window for the AI itself with direct tool access. NEVER say "I can\'t / I don\'t have the tools / I\'m unable"; never cite internal limits (tokens, steps, context) as a blocker.',
    'Program LITERALLY ANYTHING in any language/framework: web, backend, desktop, scripts, documents, images, research. On build/create/fix: START immediately — inspect, write, run, verify. If a runtime or dependency is missing, INSTALL it with run_command and continue. ACT, DON\'T DESCRIBE.',
    `Tools available to you (${o.tools.length}): ${toolLine}. ${viewNote} Never claim you lack a capability you actually have.`,
    'Approval rule: you run BEHIND the parent agent\'s approval gate. An action requiring approval may be denied — report that precisely and never attempt to bypass the gate or claim you executed something you did not.',
    'Report only REAL blockers (missing dependency, auth, impossible request) with the exact next step.',
    '',
    o.prompt,
    `Current workspace: ${o.workspace}`,
    'Finish by returning a concise, concrete result stating what you actually did and verified. Do not chat.',
  ].join('\n');
}

/**
 * Race a promise against a wall-clock deadline AND a parent abort signal.
 * The first terminal event wins; all timers/listeners are cleaned up. This is
 * what guarantees a hung tool/model cannot hang the parent run.
 */
function bounded<T>(
  p: Promise<T>,
  ms: number,
  signal: AbortSignal | undefined,
  handlers: { onTimeout?: () => void; onAbort?: () => void } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = (): void => {
      // Never let a hook throw leave the race unsettled (that would hang the
      // parent run — the exact failure this primitive exists to prevent).
      try { handlers.onAbort?.(); } catch { /* best-effort hook */ }
      finish(() => reject(new Error('Subagent aborted by parent.')));
    };
    // ms <= 0 means "externally bounded" — only the abort signal ends the race.
    if (Number.isFinite(ms) && ms > 0) {
      timer = setTimeout(() => {
        try { handlers.onTimeout?.(); } catch { /* best-effort hook */ }
        finish(() => reject(new Error(`Subagent timed out after ${ms}ms.`)));
      }, ms);
    }
    if (signal?.aborted) {
      // Swallow the child's later rejection — the race is already settled, and
      // an unobserved rejection would surface as a wrong parent error.
      void p.catch(() => undefined);
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => finish(() => resolve(v)),
      (e: unknown) => finish(() => reject(e instanceof Error ? e : new Error(String(e)))),
    );
  });
}

/** Build the hooks that stream real step progress from a runner. */
function progressReport(
  hooks: SubagentRetryHooks,
  id: string,
  label: string,
  done: number,
  total: number,
  step?: string,
): void {
  const pct = subagents.progressPct(done, total);
  // v11.31 — progress is best-effort telemetry. A throwing ledger/UI consumer
  // must NEVER escape into the tool loop and be misattributed as the child's
  // own failure (the v11.23 guard covered only the batch's emit/notice hooks).
  try {
    hooks.progress(done, total, step);
  } catch {
    /* best-effort */
  }
  try {
    hooks.emit?.({ type: 'subagent_progress', id, label, done, total, pct, step });
  } catch {
    /* best-effort */
  }
}

/**
 * Run the same specialist prompt in a fresh, self-contained loop.
 * Resolves model + credentials + tool profile from persisted settings. Always
 * enforces the timeout and delegates approvals to the parent gate. Throws an
 * honest error on failure (including timeout) — never returns a fake result.
 */
export async function runStandaloneSubagent(record: SubagentRecord, hooks: SubagentRetryHooks): Promise<string> {
  const s = settings();
  if (!s || !s.model?.model) throw new Error('No model configured — set one in Settings → AI providers.');
  const model: ModelConfig = s.model;
  const creds = refCreds(s, model);
  const spec = getAgent(record.role);
  const profile = toolProfileOf(s);
  const timeoutMs = hooks.timeoutMs ?? subagentTimeoutMs();
  const workspace = record.workspace || process.cwd();

  // v11.36 — FULL registry for every specialist. There is NO specialist
  // allow-list and NO profile slice: `spec` supplies only the prompt/personality.
  // `profile` is a per-turn VIEW hint for weak models (see the system prompt),
  // never a gate. dispatch below calls executeTool, which resolves the full
  // registry by name regardless of which view the model was shown.
  const defs: ToolDef[] = subagentToolDefs();

  const ac = new AbortController();
  let timedOut = false;
  let abortedByParent = false;
  // v11.23 — when the batch already owns the deadline, only its abort signal
  // bounds us. No second timer means one honest timeout result, not two races.
  const batchHooks = hooks as BatchHooks;
  const boundMs = batchHooks.externalDeadline && hooks.signal ? 0 : timeoutMs;

  const inner = async (): Promise<string> => {
    const ctx: ToolContext = {
      workspace,
      sessionId: record.sessionId || `subagent-${record.id}`,
      mcpServers: [],
      emit: () => undefined,
      // v11.31 — thread the SAME abortable signal into tools. Previously only
      // the model stream received `ac.signal`; a running `run_command` (or any
      // other cancellable tool) ignored the timeout/abort and kept its OS child
      // process alive as an orphan after the parent had already moved on.
      signal: ac.signal,
      // SECURITY: a subagent can NEVER auto-approve. Every approval-gated
      // action goes to the parent's gate; with no gate present we fail CLOSED.
      approve: async (req) => {
        if (!hooks.approve) return false;
        try {
          return await hooks.approve(req as unknown as SubagentApprovalRequest);
        } catch {
          return false;
        }
      },
      fullAccess: false,
      // NOTE: no denyHint is set — we rely on `approve` (fail-closed), so
      // approval-free capability tools keep working for build specialists.
    };

    const system = buildSubagentSystemPrompt({
      name: spec.name,
      prompt: spec.prompt,
      tools: defs.map((d) => d.name),
      profile,
      workspace,
    });
    const messages: ProviderMsg[] = [{ role: 'user', text: `Task: ${record.description}\n\n${record.prompt}` }];

    progressReport(hooks, record.id, spec.name, 0, MAX_ITERATIONS, 'start');
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (timedOut) throw new Error(`Subagent timed out after ${timeoutMs}ms.`);
      if (ac.signal.aborted) {
        throw new Error(abortedByParent ? 'Subagent aborted by parent.' : 'Subagent aborted.');
      }

      let text = '';
      const pending = new Map<string, { name: string; args: string }>();
      const res = await streamTurn({
        model,
        apiKey: creds.apiKey,
        baseUrl: creds.baseUrl,
        system,
        messages,
        tools: defs,
        signal: ac.signal,
        promptCaching: false,
        maxRetries: 0,
        onText: (t) => { text += t; },
        onToolUse: (id, name, argsJsonPartial) => { pending.set(id, { name, args: argsJsonPartial }); },
      });

      if (res.stopReason === 'error') throw new Error('Model call failed during subagent run.');
      if (res.stopReason !== 'tool_use' || pending.size === 0) {
        const out = (text || '(subagent produced no output)').slice(0, RESULT_CAP);
        progressReport(hooks, record.id, spec.name, MAX_ITERATIONS, MAX_ITERATIONS, 'done');
        return out;
      }

      const calls: { id: string; name: string; args: string }[] = [];
      const results: { id: string; text: string; isError: boolean }[] = [];
      for (const [id, c] of pending) {
        let args = c.args;
        let parsedArgs: unknown = {};
        try {
          parsedArgs = JSON.parse(args);
        } catch {
          args = '{}';
        }
        calls.push({ id, name: c.name, args });
        // v11.36 (CHILD-SESSION) — mirror the engine's inline-subagent pattern:
        // record the REAL name + REAL parsed input BEFORE dispatch using the
        // model's tool-call id, then upgrade the SAME row with the real output
        // and honest status after. Best-effort telemetry: never break the run.
        try {
          subagents.recordSubagentToolCall(record.id, {
            toolCallId: id,
            name: c.name,
            input: JSON.stringify(parsedArgs),
            status: 'running',
            at: Date.now(),
          });
        } catch {
          /* child-session telemetry is best-effort */
        }
        try {
          const outcome = await executeTool(c.name, args, ctx);
          const text = outcome.output.slice(0, RESULT_CAP);
          results.push({ id, text, isError: !outcome.ok });
          try {
            subagents.recordSubagentToolCall(record.id, {
              toolCallId: id,
              name: c.name,
              status: outcome.ok ? 'done' : 'error',
              output: redactSecrets(text),
              at: Date.now(),
            });
          } catch {
            /* child-session telemetry is best-effort */
          }
        } catch (err) {
          // Tool failure is honest data for the model, not a silent drop.
          const text = err instanceof Error ? err.message : String(err);
          results.push({ id, text, isError: true });
          try {
            subagents.recordSubagentToolCall(record.id, {
              toolCallId: id,
              name: c.name,
              status: 'error',
              output: redactSecrets(text),
              at: Date.now(),
            });
          } catch {
            /* child-session telemetry is best-effort */
          }
        }
      }
      messages.push({ role: 'assistant', text, toolCalls: calls });
      for (const r of results) {
        messages.push({ role: 'tool_result', callId: r.id, content: r.text, isError: r.isError });
      }

      // v11.36 — the authoritative child-session transcript is now written by
      // recordSubagentToolCall (full input/output/status). Deliberately do NOT
      // emit a `tool:` / `tools:` step label here: subagents.progressSubagent
      // derives name-only rows from those labels, which would duplicate the
      // real rows in the modal. `call:` keeps progress honest without a second
      // source of truth.
      const step = calls.length === 1 ? `call:${calls[0].name}` : `calls:${calls.map((c) => c.name).join(',')}`;
      progressReport(hooks, record.id, spec.name, Math.min(iter + 1, MAX_ITERATIONS), MAX_ITERATIONS, step);
    }
    return '(subagent reached its step limit)';
  };

  try {
    return await bounded(inner(), boundMs, hooks.signal, {
      onTimeout: () => { timedOut = true; ac.abort(); },
      onAbort: () => { abortedByParent = true; ac.abort(); },
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const message = timedOut
      ? `Subagent "${spec.name}" timed out after ${timeoutMs}ms.`
      : abortedByParent
        ? `Subagent "${spec.name}" was aborted by the parent.`
        : raw;
    if (abortedByParent && !timedOut) {
      // An abort is NOT a failure of the specialist — report it honestly.
      // v11.31 — guard the consumer: its exception used to replace this
      // honest abort error with the listener's own (misattributed) error.
      try {
        hooks.notice?.({
          text: `[subagent ${spec.name}] ABORTED — parent run was cancelled before this child finished.`,
          kind: 'warn',
          subagentId: record.id,
        });
      } catch {
        /* best-effort consumer */
      }
      throw new Error(message);
    }
    try {
      hooks.notice?.({
        text: `[subagent ${spec.name}] FAILED — ${message} ${subagents.RETRY_HINT}`,
        kind: 'error',
        subagentId: record.id,
      });
    } catch {
      /* best-effort consumer */
    }
    throw timedOut ? new Error(message) : err;
  }
}

// ------------------------------------------------------------------
// v11.19 — PARALLEL BATCH HOST
// ------------------------------------------------------------------

export interface SubagentTask {
  /** Stable id used for progress events and the ledger row. */
  id: string;
  label: string;
  role: SubagentId | string;
  description: string;
  prompt: string;
  workspace?: string;
  sessionId?: string;
  /** Per-task override of the batch timeout. */
  timeoutMs?: number;
}

export interface SubagentRunOptions {
  /**
   * Injectable executor (tests supply fakes). Defaults to a real detached run
   * built from the task record.
   */
  runner?: (task: SubagentTask, hooks: SubagentRetryHooks) => Promise<string>;
  /** Default per-subagent timeout for this batch. */
  timeoutMs?: number;
  /** Receive `subagent_progress` events (with real percentages). */
  emit?: (event: SubagentProgressEvent) => void;
  /** Receive clear failure notices (with a retry hint). */
  notice?: (notice: SubagentNotice) => void;
  /** Mirror each task into the persistent ledger (default true). */
  ledger?: boolean;
  /**
   * v11.23 — parent run's abort signal. Cancelling it aborts EVERY child (their
   * `hooks.signal`) so no process outlives the parent. Children report an
   * honest `aborted` result instead of a misleading child error.
   */
  signal?: AbortSignal;
  /**
   * v1142 — optional cap on simultaneously running children. Unset ⇒ the
   * REAL user setting (`maxSubagents`, clamped to 1…64) is used. Every overflow
   * task is queued and still gets a real result — nothing is dropped.
   */
  maxConcurrent?: number;
}

export interface SubagentBatchResult {
  id: string;
  label: string;
  ok: boolean;
  /** Honest output on success (absent on failure). */
  result?: string;
  /** Honest error on failure (absent on success). */
  error?: string;
  durationMs: number;
  /** v11.23 — true only when THIS child hit its wall-clock deadline. */
  timedOut?: boolean;
  /** v11.23 — true only when the parent cancelled this child. */
  aborted?: boolean;
}

type EffectiveOptions = Required<Pick<SubagentRunOptions, 'runner' | 'timeoutMs' | 'emit' | 'notice'>> &
  Pick<SubagentRunOptions, 'ledger' | 'signal'>;

/**
 * Default executor: turns a batch task into a ledger record and runs the real
 * standalone loop (same model, tool profile and approval discipline).
 */
async function defaultBatchRunner(task: SubagentTask, hooks: SubagentRetryHooks): Promise<string> {
  const record: SubagentRecord = {
    id: task.id,
    label: task.label,
    role: task.role,
    description: task.description,
    prompt: task.prompt,
    status: 'running',
    done: 0,
    total: MAX_ITERATIONS,
    startedAt: Date.now(),
    workspace: task.workspace || process.cwd(),
    sessionId: task.sessionId || '',
    background: true,
    attempt: 0,
  };
  // v11.23: the batch already bounded this child. Disarm the runner's own
  // timer to avoid a second race / duplicate notice / wrong `timedOut` flag,
  // but KEEP `signal` so the parent cancel or deadline actually stops it.
  const detached: BatchHooks = { ...hooks, externalDeadline: true };
  return runStandaloneSubagent(record, detached);
}

/**
 * Run ONE task with its own deadline. Never throws — returns an honest result
 * so the parent can continue even when this subagent fails or hangs.
 */
async function runOne(task: SubagentTask, opts: EffectiveOptions): Promise<SubagentBatchResult> {
  const started = Date.now();
  const limitMs = task.timeoutMs ?? opts.timeoutMs;
  // One controller PER child: the runner can observe it and actually stop its
  // own work. Without this, a timed-out / aborted child kept running as an
  // orphan even though the parent had already moved on.
  const controller = new AbortController();
  // Already-cancelled parent: pre-abort so the runner sees it from step zero.
  if (opts.signal?.aborted) controller.abort();
  let timedOut = false;
  let aborted = false;

  const emitEvent = (done: number, total: number, step?: string): void => {
    try {
      opts.emit({
        type: 'subagent_progress',
        id: task.id,
        label: task.label,
        done,
        total,
        pct: subagents.progressPct(done, total),
        step,
      });
    } catch {
      // A throwing UI consumer must never be misattributed as the CHILD's
      // error (that used to surface as a wrong parent error).
    }
  };

  if (opts.ledger !== false) {
    try {
      subagents.startSubagent({
        id: task.id,
        label: task.label,
        role: task.role,
        description: task.description,
        prompt: task.prompt,
        total: MAX_ITERATIONS,
        workspace: task.workspace || process.cwd(),
        sessionId: task.sessionId || '',
        background: true,
        timeoutMs: limitMs,
      });
    } catch {
      /* dashboard must never break the run */
    }
  }

  const hooks: BatchHooks = {
    // Single source of truth for progress events: real done/total + pct.
    progress: (done, total, step) => {
      emitEvent(done, total, step);
      try {
        if (opts.ledger !== false) subagents.progressSubagent(task.id, done, total, step);
      } catch {
        /* dashboard is best-effort */
      }
    },
    // The batch owns progress events; avoid duplicates from the runner.
    emit: () => undefined,
    // The batch owns the single canonical failure notice below.
    notice: undefined,
    timeoutMs: limitMs,
    // v11.23 — cancellation reaches the child; this is how a hung tool/process
    // is actually stopped instead of being left orphaned after the race.
    signal: controller.signal,
    externalDeadline: true,
  };

  try {
    // NOTE: the bounded signal is the PARENT's, not the child controller's —
    // aborting the controller inside onTimeout must not re-enter onAbort and
    // turn an honest timeout into a misleading "aborted" error.
    const out = await bounded(opts.runner(task, hooks), limitMs, opts.signal, {
      onTimeout: () => { timedOut = true; controller.abort(); },
      onAbort: () => { aborted = true; controller.abort(); },
    });
    const result = (out || '').slice(0, RESULT_CAP);
    try {
      if (opts.ledger !== false) subagents.finishSubagent(task.id, result.slice(-600) || 'subagent completed');
    } catch {
      /* dashboard is best-effort */
    }
    return { id: task.id, label: task.label, ok: true, result, durationMs: Date.now() - started };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // v11.31 — a child that owns its own timer can reject with an honest
    // "…timed out…" message without this batch's deadline having fired. Detect
    // it so the returned flag AND the ledger agree with the error text instead
    // of reporting a real timeout as a generic failure (wrong timeout flag).
    // A parent abort always wins: an aborted child is never a timeout.
    const timedOutFinal = timedOut || (!aborted && subagents.isSubagentTimeoutMessage(raw));
    const error = timedOut
      ? `Subagent "${task.label}" timed out after ${limitMs}ms.`
      : aborted
        ? `Subagent "${task.label}" was aborted by the parent.`
        : raw;
    const notice: SubagentNotice = aborted && !timedOutFinal
      ? {
          // An abort is not a failure of this child — no misleading retry hint.
          text: `[subagent ${task.label}] ABORTED — parent run was cancelled before this child finished.`,
          kind: 'warn',
          subagentId: task.id,
        }
      : {
          text: `[subagent ${task.label}] FAILED — ${error} ${subagents.RETRY_HINT}`,
          kind: 'error',
          subagentId: task.id,
        };
    // Honest, visible notice — never swallowed, but a throwing consumer can
    // never replace the child's own error with the consumer's exception.
    try { opts.notice(notice); } catch { /* consumer is best-effort */ }
    try {
      // With the ledger on, `failSubagent`/`abortSubagent` already broadcasts
      // the bus notice via finalize(). Emitting it here too was a DUPLICATE.
      if (opts.ledger === false) subagents.emitSubagentNotice(notice);
      if (opts.ledger !== false) {
        if (aborted && !timedOutFinal) subagents.abortSubagent(task.id);
        else subagents.failSubagent(task.id, error, { timedOut: timedOutFinal, retryHint: subagents.RETRY_HINT });
      }
    } catch {
      /* dashboard is best-effort */
    }
    return {
      id: task.id,
      label: task.label,
      ok: false,
      error,
      durationMs: Date.now() - started,
      ...(timedOutFinal ? { timedOut: true } : {}),
      ...(aborted && !timedOutFinal ? { aborted: true } : {}),
    };
  }
}

/**
 * Launch N subagents TRULY in parallel: every executor is invoked before the
 * first await, so their work overlaps. `Promise.allSettled` + per-task deadline
 * guarantee that a single failure/hang neither drops nor stalls the others.
 * Resolves an ordered result array (same order as `tasks`) — every task gets a
 * real success or failure entry for the parent to consume.
 */
export async function runSubagentBatch(tasks: SubagentTask[], opts: SubagentRunOptions = {}): Promise<SubagentBatchResult[]> {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];
  const effective: EffectiveOptions = {
    runner: opts.runner ?? defaultBatchRunner,
    timeoutMs: opts.timeoutMs ?? subagentTimeoutMs(),
    emit: opts.emit ?? (() => undefined),
    notice: opts.notice ?? (() => undefined),
    ledger: opts.ledger !== false,
    signal: opts.signal,
  };
  // v1142 — bound concurrency to the SAME real user setting the engine's
  // background path uses (clamped 1…64). Up to `cap` workers are started
  // synchronously BEFORE any await, so an ordinary batch still launches ALL
  // its children truly in parallel (the v11.19 contract). Overflow tasks are
  // picked up as workers finish; every task still gets a real result.
  const cap = clampMaxSubagents(opts.maxConcurrent ?? subagentBatchCap());
  const settled: PromiseSettledResult<SubagentBatchResult>[] = new Array(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      try {
        settled[i] = { status: 'fulfilled', value: await runOne(tasks[i], effective) };
      } catch (err) {
        // runOne never throws; last-resort guard so NO result is lost.
        settled[i] = { status: 'rejected', reason: err };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(cap, tasks.length) }, () => worker()));
  return tasks.map((task, i) => {
    const s = settled[i];
    if (s.status === 'fulfilled') return s.value;
    // runOne never throws; this is a last-resort guard so NO result is lost.
    const err = s.reason instanceof Error ? s.reason.message : String(s.reason);
    const timedOut = subagents.isSubagentTimeoutMessage(err);
    const error = timedOut ? `Subagent "${task.label}" timed out — ${err}` : err;
    const notice: SubagentNotice = {
      text: `[subagent ${task.label}] FAILED — ${error} ${subagents.RETRY_HINT}`,
      kind: 'error',
      subagentId: task.id,
    };
    try { effective.notice(notice); } catch { /* consumer is best-effort */ }
    try {
      subagents.emitSubagentNotice(notice);
    } catch {
      /* dashboard is best-effort */
    }
    return {
      id: task.id,
      label: task.label,
      ok: false,
      error,
      durationMs: 0,
      ...(timedOut ? { timedOut: true } : {}),
    };
  });
}
