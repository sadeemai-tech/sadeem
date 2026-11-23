// ============================================================
// SADEEM v11.12 — SUBAGENT DASHBOARD ledger (signature feature companion)
// ------------------------------------------------------------
// A persistent, real-time ledger of EVERY subagent launched via the `task`
// tool (foreground AND background, plus skill-writer/refiner helpers). Each
// record carries id, label, role, status, progress, duration, the original
// prompt and a retry counter. The renderer's Subagents panel reads it via IPC
// and listens to `kdx:subagents:event` for live updates. "Retry failed"
// re-runs the SAME role + prompt through the standalone runner registered by
// the engine (see subagentRunner.ts).
//
// Every function is defensive — ledger IO must never break a run. Writes are
// serialized (read-modify-write). IPC self-registers (kdx:subagents:*).
// ============================================================
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, ipcMain } from 'electron';
import type { SubagentId, SubagentToolCall } from '../../shared/types';

const LEDGER_FILE = 'subagents.json';
const MAX_RECORDS = 80;

export type SubagentStatus = 'running' | 'done' | 'error' | 'aborted';

/**
 * v11.19 — the one honest sentence appended to every failure notice. A failed
 * subagent must never be a silent dead end: the user always gets a concrete
 * next action. Kept short so it survives the 400-char ledger error cap.
 */
export const RETRY_HINT =
  'Retry: open the Subagents panel → "Retry failed" on this row, or ask the parent agent to re-delegate the task with a corrected prompt.';

/**
 * v11.31 — ONE honest timeout classifier shared by the ledger retry guard and
 * the detached runner's batch results. A failure whose only evidence is a
 * plain child rejection like "operation timed out" must carry `timedOut:true`
 * in both the result AND the ledger — otherwise the dashboard reports a
 * timeout as a generic error (the "wrong timeout flag" bug).
 */
export function isSubagentTimeoutMessage(message: string): boolean {
  return /\btimed?\s*out\b|\btimeout\b/i.test(String(message ?? ''));
}

/** Real percentage (0-100) derived from step counts — never a fake fixed value. */
export function progressPct(done: number, total: number): number {
  const t = Math.max(0, Math.floor(Number(total) || 0));
  const d = Math.max(0, Math.floor(Number(done) || 0));
  if (t <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((d / t) * 100)));
}

/** `subagent_progress` AgentEvent shape (mirrored into the dashboard ledger). */
export interface SubagentProgressEvent {
  type: 'subagent_progress';
  id: string;
  label: string;
  done: number;
  total: number;
  pct: number;
  step?: string;
  /** v11.36 — first REAL tool call observed on this progress tick, when any. */
  toolCall?: SubagentToolCall;
}

/** A clear, human-readable notice delivered to the parent agent / UI. */
export interface SubagentNotice {
  text: string;
  kind: 'info' | 'warn' | 'error';
  subagentId?: string;
}

/**
 * Minimal structural shape of an approval request — declared here (instead of
 * importing from tools.ts) so the ledger stays a dependency-free leaf module.
 */
export interface SubagentApprovalRequest {
  kind: string;
  title: string;
  detail: string;
  payload: Record<string, unknown>;
  force?: boolean;
}

export interface SubagentRecord {
  id: string;
  label: string;
  role: SubagentId | string;
  description: string;
  prompt: string;
  status: SubagentStatus;
  done: number;
  total: number;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  workspace: string;
  sessionId: string;
  background: boolean;
  attempt: number;
  summary?: string;
  error?: string;
  /** v11.19 — last observed real step + percentage (dashboard progress bar). */
  step?: string;
  pct?: number;
  /** v11.19 — per-subagent wall-clock budget (ms). */
  timeoutMs?: number;
  /** v11.19 — did this record fail specifically because of a timeout? */
  timedOut?: boolean;
  /** v11.19 — concrete next action attached to an error/failure notice. */
  retryHint?: string;
  /** v11.36 — REAL per-agent tool-call transcript (see recordSubagentToolCall). */
  toolCalls?: SubagentToolCall[];
}

/** Max tool-call rows kept per subagent (the transcript is bounded). */
const MAX_TOOL_CALLS = 120;

/**
 * v11.36 — normalize ONE untrusted tool-call value into an honest record.
 * Nothing is invented: a missing field stays missing, an invalid value is
 * rejected rather than replaced with a plausible-looking placeholder.
 */
function normalizeToolCall(raw: unknown): SubagentToolCall | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  if (!name) return null;
  const status = r.status === 'running' || r.status === 'error' ? r.status : 'done';
  const at = typeof r.at === 'number' && Number.isFinite(r.at) && r.at > 0 ? Math.floor(r.at) : Date.now();
  const call: SubagentToolCall = { name, status, at };
  if (typeof r.toolCallId === 'string' && r.toolCallId) call.toolCallId = r.toolCallId.slice(0, 120);
  if (typeof r.input === 'string') call.input = r.input.slice(0, 1200);
  if (typeof r.output === 'string') call.output = r.output.slice(0, 4000);
  return call;
}

/** Stable identity for a call (pairs a start with its later result). */
function toolCallKey(c: SubagentToolCall): string {
  return c.toolCallId ? `id:${c.toolCallId}` : `${c.name}:${c.at}`;
}

/**
 * v11.36 — derive REAL tool names from the engine's own step label. The detached
 * runner emits `tool:<name>` / `tools:<a>,<b>` (electron/agent/subagentRunner.ts:
 * 309-310) AFTER executing the tool; that string is the only per-tool datum the
 * current engine streams. We parse it — never invent a name — and leave fields
 * the engine does not stream (`output`, detailed `input`) ABSENT.
 * `status:'done'` here means "observed executed", not "succeeded".
 */
export function toolCallsFromStep(step: string | undefined): SubagentToolCall[] {
  const s = typeof step === 'string' ? step.trim() : '';
  if (!s) return [];
  const at = Date.now();
  if (/^tools?\s*:/i.test(s)) {
    const multi = /^tools\s*:/i.test(s);
    const body = s.slice(s.indexOf(':') + 1).trim();
    const parts = multi ? body.split(',') : [body];
    const out: SubagentToolCall[] = [];
    const seen = new Set<string>();
    for (const part of parts) {
      const tokens = part.trim().split(/\s+/).filter(Boolean);
      const name = (tokens.shift() ?? '').slice(0, 80);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const call: SubagentToolCall = { name, status: 'done', at };
      const input = tokens.join(' ').trim();
      if (input) call.input = input.slice(0, 500);
      out.push(call);
      if (out.length >= 16) break;
    }
    return out;
  }
  return [];
}

/** Hooks passed to the retry runner so progress lands back in the ledger. */
export interface SubagentRetryHooks {
  /** Real step progression. `step` is a short label of the action just taken. */
  progress: (done: number, total: number, step?: string) => void;
  /** Emit a `subagent_progress` AgentEvent to the renderer (optional). */
  emit?: (event: SubagentProgressEvent) => void;
  /** Deliver a clear notice to the parent/UI (optional). */
  notice?: (notice: SubagentNotice) => void;
  /**
   * Delegate every approval-gated action to the PARENT's gate. A subagent must
   * never auto-approve: when absent, the runner fails closed (deny).
   */
  approve?: (req: SubagentApprovalRequest) => Promise<boolean>;
  /** Parent abort signal — a cancelled run stops its subagents too. */
  signal?: AbortSignal;
  /** Per-subagent timeout override (ms). */
  timeoutMs?: number;
}

type RetryLauncher = (record: SubagentRecord, hooks: SubagentRetryHooks) => Promise<string>;

let retryLauncher: RetryLauncher | null = null;
/** Engine registers the detached runner once at boot. */
export function setSubagentRetryLauncher(fn: RetryLauncher | null): void {
  retryLauncher = fn;
}

// ---------- storage ----------

function userDataDir(): string {
  try {
    return app?.getPath?.('userData') ?? process.cwd();
  } catch {
    return process.cwd();
  }
}

function ledgerFile(): string {
  return path.join(userDataDir(), LEDGER_FILE);
}

function readLedger(): SubagentRecord[] {
  try {
    const raw = JSON.parse(fsSync.readFileSync(ledgerFile(), 'utf8')) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((r) => ({
        id: String(r.id ?? randomUUID()).slice(0, 80),
        label: String(r.label ?? 'subagent').slice(0, 120),
        role: String(r.role ?? 'general').slice(0, 60),
        description: String(r.description ?? '').slice(0, 300),
        prompt: String(r.prompt ?? '').slice(0, 8000),
        status: (['running', 'done', 'error', 'aborted'].includes(String(r.status)) ? r.status : 'done') as SubagentStatus,
        done: Math.max(0, Math.floor(Number(r.done) || 0)),
        total: Math.max(0, Math.floor(Number(r.total) || 0)),
        startedAt: Number(r.startedAt) || Date.now(),
        ...(typeof r.endedAt === 'number' ? { endedAt: r.endedAt } : {}),
        ...(typeof r.durationMs === 'number' ? { durationMs: r.durationMs } : {}),
        workspace: String(r.workspace ?? '').slice(0, 500),
        sessionId: String(r.sessionId ?? '').slice(0, 120),
        background: r.background === true,
        attempt: Math.max(0, Math.floor(Number(r.attempt) || 0)),
        ...(typeof r.summary === 'string' ? { summary: r.summary.slice(0, 800) } : {}),
        ...(typeof r.error === 'string' ? { error: r.error.slice(0, 400) } : {}),
        ...(typeof r.step === 'string' ? { step: r.step.slice(0, 120) } : {}),
        ...(typeof r.pct === 'number' ? { pct: progressPct(r.pct, 100) } : {}),
        ...(typeof r.timeoutMs === 'number' ? { timeoutMs: Math.max(0, Math.floor(r.timeoutMs)) } : {}),
        ...(r.timedOut === true ? { timedOut: true } : {}),
        ...(typeof r.retryHint === 'string' ? { retryHint: r.retryHint.slice(0, 300) } : {}),
        ...(Array.isArray(r.toolCalls)
          ? {
              toolCalls: r.toolCalls
                .map(normalizeToolCall)
                .filter((c): c is SubagentToolCall => !!c)
                .slice(-MAX_TOOL_CALLS),
            }
          : {}),
      }));
  } catch {
    return [];
  }
}

function writeLedger(rows: SubagentRecord[]): void {
  try {
    fsSync.mkdirSync(path.dirname(ledgerFile()), { recursive: true });
    fsSync.writeFileSync(ledgerFile(), JSON.stringify(rows.slice(0, MAX_RECORDS), null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {
    /* best-effort */
  }
}

let chain: Promise<unknown> = Promise.resolve();
function mutate<T>(fn: () => T): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

type SubagentEventType = 'started' | 'progress' | 'finished' | 'failed' | 'aborted' | 'cleared' | 'retried' | 'notice' | 'toolcall';

function emit(type: SubagentEventType, record?: SubagentRecord, extra?: Record<string, unknown>): void {
  try {
    for (const w of BrowserWindow?.getAllWindows?.() ?? []) {
      if (!w.isDestroyed()) {
        w.webContents.send('kdx:subagents:event', { type, ...(record ? { record } : {}), ...(extra ?? {}) });
      }
    }
  } catch {
    /* app tearing down / non-electron harness */
  }
}

/** v11.19 — a failure is NEVER silent: broadcast a clear notice + retry hint. */
export function emitSubagentNotice(notice: SubagentNotice): void {
  emit('notice', undefined, { notice });
}

/**
 * v11.36 (CHILD-SESSION) — record ONE REAL tool call executed by a subagent and
 * broadcast it on the NEW `kdx:subagents:event` `toolcall` channel. This is the
 * authoritative source for the child-session transcript: the renderer NEVER
 * invents a row; every row comes from a call the engine actually observed.
 *
 * The call is appended to the persistent ledger record (`record.toolCalls`) so
 * it survives restarts AND is pushed live to an open detail view. A repeated
 * `toolCallId` REPLACES the earlier row (running → done/error with real output),
 * so a start/result pair stays one row. Never throws — telemetry cannot break a run.
 */
export function recordSubagentToolCall(id: string, raw: unknown): void {
  const call = normalizeToolCall(raw);
  if (!call) return;
  void mutate(() => {
    const rows = readLedger();
    const rec = rows.find((r) => r.id === id);
    if (!rec) return;
    const prev = Array.isArray(rec.toolCalls) ? rec.toolCalls : [];
    const key = toolCallKey(call);
    const kept = prev.filter((c) => toolCallKey(c) !== key);
    rec.toolCalls = [...kept, call].slice(-MAX_TOOL_CALLS);
    writeLedger(rows);
    // The record carries the full transcript; `call` is the incremental delta.
    emit('toolcall', rec, { id, call });
  });
}

// ---------- public mutations ----------

export interface StartSubagentInput {
  id?: string;
  label: string;
  role: SubagentId | string;
  description: string;
  prompt: string;
  total?: number;
  workspace: string;
  sessionId: string;
  background?: boolean;
  attempt?: number;
  /** v11.19 — per-subagent wall-clock budget (ms). */
  timeoutMs?: number;
}

/** Create + persist a running record and broadcast a 'started' event. */
export function startSubagent(input: StartSubagentInput): SubagentRecord {
  const record: SubagentRecord = {
    id: String(input.id ?? randomUUID()).slice(0, 80),
    label: String(input.label ?? 'subagent').slice(0, 120),
    role: String(input.role ?? 'general').slice(0, 60),
    description: String(input.description ?? '').slice(0, 300),
    prompt: String(input.prompt ?? '').slice(0, 8000),
    status: 'running',
    done: 0,
    total: Math.max(0, Math.floor(Number(input.total) || 0)),
    startedAt: Date.now(),
    workspace: String(input.workspace ?? '').slice(0, 500),
    sessionId: String(input.sessionId ?? '').slice(0, 120),
    background: input.background === true,
    attempt: Math.max(0, Math.floor(Number(input.attempt) || 0)),
    ...(typeof input.timeoutMs === 'number' && input.timeoutMs > 0
      ? { timeoutMs: Math.floor(input.timeoutMs) }
      : {}),
  };
  void mutate(() => {
    writeLedger([record, ...readLedger().filter((r) => r.id !== record.id)]);
  });
  emit('started', record);
  return record;
}

/** Update progress (idempotent-ish; only emits when values changed). */
export function progressSubagent(id: string, done: number, total?: number, step?: string): void {
  void mutate(() => {
    const rows = readLedger();
    const rec = rows.find((r) => r.id === id);
    if (!rec || rec.status !== 'running') return;
    const d = Math.max(0, Math.floor(Number(done) || 0));
    const t = total === undefined ? rec.total : Math.max(0, Math.floor(Number(total) || 0));
    const cleanStep = typeof step === 'string' ? step.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    const pct = progressPct(d, t);
    if (d === rec.done && t === rec.total && (!cleanStep || cleanStep === rec.step)) return;
    rec.done = d;
    rec.total = t;
    rec.pct = pct;
    if (cleanStep) rec.step = cleanStep;
    // v11.36 — the engine's OWN step label (`tool:<name>` / `tools:<a>,<b>`) is
    // the real tool-call datum already flowing. Parse it (never invent one) and
    // append the observed calls to the persistent child-session transcript.
    const derived = toolCallsFromStep(cleanStep);
    if (derived.length) {
      const prev = Array.isArray(rec.toolCalls) ? rec.toolCalls : [];
      const seen = new Set(prev.map(toolCallKey));
      const fresh = derived.filter((c) => !seen.has(toolCallKey(c)));
      if (fresh.length) {
        rec.toolCalls = [...prev, ...fresh].slice(-MAX_TOOL_CALLS);
        for (const c of fresh) emit('toolcall', rec, { id, call: c });
      }
    }
    writeLedger(rows);
    // Real percentages, derived from done/total — never a fabricated constant.
    // The counter payload is UNCHANGED (V1131/V1132 compatibility); `toolCall`
    // is additive and absent when no real call was observed on this tick.
    emit('progress', rec, {
      pct,
      ...(cleanStep ? { step: cleanStep } : {}),
      ...(derived[0] ? { toolCall: derived[0] } : {}),
    });
  });
}

function finalize(
  id: string,
  status: 'done' | 'error' | 'aborted',
  extra: { summary?: string; error?: string; retryHint?: string; timedOut?: boolean },
): void {
  void mutate(() => {
    const rows = readLedger();
    const rec = rows.find((r) => r.id === id);
    if (!rec) return;
    rec.status = status;
    rec.endedAt = Date.now();
    rec.durationMs = Math.max(0, rec.endedAt - rec.startedAt);
    if (extra.summary !== undefined) rec.summary = extra.summary.slice(0, 800);
    if (extra.error !== undefined) rec.error = extra.error.slice(0, 400);
    if (extra.retryHint !== undefined) rec.retryHint = extra.retryHint.slice(0, 300);
    if (extra.timedOut !== undefined) rec.timedOut = extra.timedOut;
    writeLedger(rows);
    emit(status === 'done' ? 'finished' : status === 'error' ? 'failed' : 'aborted', rec);
    // v11.19 — a failed subagent ALWAYS broadcasts a clear notice with a retry
    // hint. No silent dead ends. The stored `error` stays verbatim.
    // v11.31 — a deliberate PARENT abort is not a failure of the child: it is
    // a 'warn' (never 'error') and it must not tell the user to retry work they
    // explicitly cancelled. The batch's consumer notice already uses 'warn'.
    if (status !== 'done') {
      const raw = (extra.error ?? (status === 'aborted' ? 'subagent was aborted' : 'subagent failed')).trim();
      const reason = extra.timedOut ? `${raw} (timeout)` : raw;
      const aborted = status === 'aborted';
      emitSubagentNotice({
        text: `[subagent ${rec.label}] ${aborted ? 'ABORTED' : 'FAILED'} — ${reason}.${aborted ? '' : ` ${RETRY_HINT}`}`,
        kind: aborted ? 'warn' : 'error',
        subagentId: rec.id,
      });
    }
  });
}

export function finishSubagent(id: string, summary?: string): void {
  finalize(id, 'done', { summary });
}
export function failSubagent(
  id: string,
  error?: string,
  opts?: { retryHint?: string; timedOut?: boolean },
): void {
  finalize(id, 'error', {
    error,
    retryHint: opts?.retryHint ?? RETRY_HINT,
    timedOut: opts?.timedOut === true,
  });
}
export function abortSubagent(id: string): void {
  finalize(id, 'aborted', { error: 'subagent was aborted' });
}

/** Never throws. */
export function listSubagents(workspace?: string): SubagentRecord[] {
  const rows = readLedger();
  const ws = typeof workspace === 'string' && workspace.trim() ? workspace.trim() : '';
  return (ws ? rows.filter((r) => r.workspace === ws || r.sessionId === '') : rows).sort(
    (a, b) => b.startedAt - a.startedAt,
  );
}

/** Never throws. */
export function getSubagent(id: string): SubagentRecord | null {
  return readLedger().find((r) => r.id === id) ?? null;
}

/** Never throws. */
export function clearSubagents(): { ok: boolean } {
  try {
    writeLedger([]);
    emit('cleared');
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Safety-net timeout for the detached retry launcher (env-tunable in tests). */
export function retryGuardTimeoutMs(): number {
  const raw = Number(process.env.SURNIA_SUBAGENT_RETRY_GUARD_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2 * 60_000;
}

/**
 * Reject (never hang) if `p` outlives `ms`. Cleans up its timer on settle.
 * v11.31 — `onTimeout` lets the caller stop the underlying work (abort its
 * signal) at the exact moment the deadline fires, so a timed-out retry cannot
 * leave an orphan runner still writing to the ledger afterwards.
 */
function withLedgerTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { onTimeout?.(); } catch { /* best-effort */ }
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    p.then(
      (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Re-run the SAME role + prompt in a fresh record. Returns the new record id.
 * The detached runner is invoked fire-and-forget; its progress/finish land in
 * the ledger through the passed hooks, so the dashboard shows the retry live.
 */
export function retrySubagent(id: string): { ok: boolean; id?: string; error?: string } {
  const original = getSubagent(String(id ?? '').trim());
  if (!original) return { ok: false, error: 'NOT_FOUND' };
  const budgetMs = original.timeoutMs ?? retryGuardTimeoutMs();
  const fresh = startSubagent({
    label: original.label,
    role: original.role,
    description: original.description,
    prompt: original.prompt,
    total: original.total || 12,
    workspace: original.workspace,
    sessionId: original.sessionId,
    background: true,
    attempt: original.attempt + 1,
    // v11.31 — carry the original wall-clock budget forward. A retry must not
    // silently acquire an unlimited/default timeout and go stale in the ledger.
    timeoutMs: original.timeoutMs,
  });
  emit('retried', fresh);
  if (!retryLauncher) {
    failSubagent(fresh.id, 'Retry runner unavailable in this process.');
    return { ok: false, id: fresh.id, error: 'NO_RUNNER' };
  }

  // v11.31 — one controller for this retry. The deadline ABORTS the detached
  // child (no orphan), and a single `settled` latch makes sure the timeout
  // failure and a late runner settle cannot both write the record (stale LEDGER)
  // or both broadcast a notice (duplicate notice).
  const controller = new AbortController();
  let settled = false;
  const failOnce = (message: string, timedOut: boolean): void => {
    if (settled) return;
    settled = true;
    try { controller.abort(); } catch { /* best-effort */ }
    failSubagent(fresh.id, message, { timedOut, retryHint: RETRY_HINT });
  };

  void (async () => {
    try {
      const out = await withLedgerTimeout(
        retryLauncher(fresh, {
          progress: (done, total, step) => progressSubagent(fresh.id, done, total, step),
          timeoutMs: fresh.timeoutMs,
          // Cancellation reaches the child so its tool loop / model stream
          // actually stops when the guard deadline (or a later error) fires.
          signal: controller.signal,
        }),
        budgetMs,
        `retry of ${fresh.label}`,
        () => failOnce(`retry of ${fresh.label} timed out after ${budgetMs}ms`, true),
      );
      if (settled) return; // timeout already finalized this record
      settled = true;
      try { controller.abort(); } catch { /* best-effort cleanup */ }
      finishSubagent(fresh.id, (out || '').slice(-600) || 'subagent completed');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failOnce(message, isSubagentTimeoutMessage(message));
    }
  })();
  return { ok: true, id: fresh.id };
}

// ---------- IPC ----------

let ipcRegistered = false;
export function initSubagentsIpc(): void {
  if (ipcRegistered) return;
  if (!ipcMain || typeof ipcMain.handle !== 'function') return;
  ipcRegistered = true;
  const handle = (channel: string, fn: (...args: never[]) => unknown): void => {
    ipcMain.handle(channel, async (_e: unknown, ...args: unknown[]) =>
      await (fn as (...a: unknown[]) => unknown)(...args),
    );
  };
  handle('kdx:subagents:list', (workspace?: string) => listSubagents(typeof workspace === 'string' ? workspace : undefined));
  handle('kdx:subagents:get', (id?: string) => getSubagent(String(id ?? '')));
  handle('kdx:subagents:retry', (id?: string) => retrySubagent(String(id ?? '')));
  handle('kdx:subagents:clear', () => clearSubagents());
}
