// ============================================================
// Surnia — persistent scheduled agent jobs (<userData>/schedules.json)
// ------------------------------------------------------------
// A job is a REAL cron worker: it is persisted atomically under userData, a
// live timer evaluates cron slots (minute resolution), a due job is fired
// through the SAME `runAgent` engine the chat uses, the result is verified by
// the workspace test suite (proof gate), and the outcome is broadcast +
// journalled so the UI can OBSERVE it. Jobs survive an app restart.
//
// v11.38 (founder: "SCHEDULED JOBS ARE THE MOST IMPORTANT THING") — hardened:
//   • injectable ScheduleClock + runJob + proofGate (deterministic tests,
//     no 30-second sleeps, no real LLM) while production still calls the
//     real engine (`electron/agent/engine.ts:1935 runAgent`).
//   • persisted `nextRun` + `lastFireSlot` => exact next-run, no duplicate
//     fire for a run that outlives its cron minute, explicit missed-run
//     policy (skip slots older than LOOKBACK_MS, never replay a storm).
//   • per-job error state (lastError / consecutiveErrors / runCount /
//     lastDurationMs) + a durable event ledger (<userData>/schedules-events.json)
//     surfaced through listJobs() so the PANEL CONSUMES real emitted events
//     (the preload has no kdx:schedule-event subscription — see HANDOFF).
//   • cancel/pause: abort an in-flight run by jobId; pausing cancels it.
//   • honest webhook state (listening only after the 'listening' event).
// The interval NEVER throws; every fs/child operation is guarded.
// ============================================================
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  AgentRunParams,
  ChatMessage,
  ModelConfig,
  PermissionDecision,
  ScheduleJob,
} from '../../shared/types';
import { runAgent, type AgentIO } from '../agent/engine';
import { estimateCost } from '../agent/costs';
import { getSettings } from './storeService';
import { notifyScheduleDone } from './notifyService';
// v11.31 P1 (A12) — reuse the repo's existing credential redactor. The webhook
// install secret is a REAL trigger credential: it must never reach stdout,
// kdx:logs:export, or a crash report in any form (not even a prefix).
import { redactSecrets } from './providerService';

// ---------- constants ----------

const TICK_MS = 30_000; // scheduler resolution (cron is minute-granular)
const RUN_TIMEOUT_MS = 30 * 60 * 1000; // hard cap for one headless run
const LOOKBACK_MS = 90 * 60 * 1000; // never scan for missed slots older than this
const MAX_JOBS = 100;
const MAX_SUMMARY = 300; // lastMessage chars persisted per job
const MAX_BUFFER = 64 * 1024; // headless text buffer cap
const MEMORY_READ_CAP = 32 * 1024;
const MAX_EVENTS = 50; // durable event ledger size

// ---------- injectable clock (deterministic tests) ----------

/** Minimal timer surface so a test can advance time without sleeping. */
export interface ScheduleClock {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: ScheduleClock = {
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

// ---------- public view types (extra runtime fields, no types.ts edit) ----------

export type ScheduleEventStatus = 'running' | 'ok' | 'error' | 'missed';

export interface ScheduleEvent {
  seq: number;
  jobId: string;
  jobName?: string;
  status: ScheduleEventStatus;
  at: number;
  sessionId?: string;
  message?: string;
}

/**
 * Runtime shape returned by listJobs(). The extra fields are persisted and
 * ride over IPC (structured clone keeps them); the shared ScheduleJob type is
 * intentionally unchanged (owned by another agent) — consumers cast locally.
 */
export interface ScheduleJobView extends ScheduleJob {
  /** Exact next cron slot (ms epoch), computed by the scheduler. */
  nextRun?: number;
  /** The cron minute that was consumed by the last fire (anti-duplicate). */
  lastFireSlot?: number;
  /** Last error reason (mirrors the error half of lastMessage). */
  lastError?: string;
  /** Consecutive failed runs (reset to 0 on success). */
  consecutiveErrors?: number;
  /** Total fires since creation. */
  runCount?: number;
  /** Duration of the last run in ms. */
  lastDurationMs?: number;
  /** Most recent emitted event — the panel consumes this from listJobs(). */
  lastEvent?: ScheduleEvent;
}

export type ProofVerdict = 'verified' | 'unverified' | 'gate-failed' | 'no-suite';

// ---------- injected options ----------

export interface ScheduleServiceOptions {
  /** app.getPath('userData') — passed in from main.ts (no electron import here). */
  userDataDir: string;
  /** UI broadcaster (main.ts forwards to the focused window's webContents). */
  broadcast?: (payload: {
    jobId: string;
    status: 'running' | 'ok' | 'error';
    sessionId?: string;
    jobName?: string;
    seq?: number;
    at?: number;
    message?: string;
  }) => void;
  /** Inject a fake clock for deterministic tick tests. Defaults to real timers. */
  clock?: ScheduleClock;
  /** Inject the job runner. Defaults to runHeadlessAgent (real engine path). */
  runJob?: (opts: HeadlessRunOptions) => Promise<HeadlessRunResult>;
  /** Inject the proof gate. Defaults to the workspace test-suite runner. */
  proofGate?: (workspace: string, summary: string) => Promise<ProofVerdict>;
}

let opts: ScheduleServiceOptions | null = null;
let jobs: ScheduleJobView[] = [];
let ticker: unknown = null;
let quitting = false;
let eventSeq = 0;
let recentEvents: ScheduleEvent[] = [];

/** Controllers of in-flight headless runs — aborted on shutdown/cancel. */
const activeRuns = new Set<AbortController>();
/** jobId → controller of the in-flight run (cancel by job). */
const runControllers = new Map<string, AbortController>();
/** jobIds with a fire in progress — prevents stacking the same job. */
const firing = new Set<string>();

const clock = (): ScheduleClock => opts?.clock ?? realClock;

// ---------- v11.31 P1 (A12) — secret-safe logging ----------

/** Last known webhook secret (set only when the token is actually read/minted). */
let knownWebhookToken: string | null = null;

/**
 * Scrub EVERY schedule log line through the repo's `redactSecrets` and a
 * generic query-secret scrub. The explicit secret list removes the webhook
 * install token even when it does not look like an API key; the regex removes
 * `?token=…` / `&key=…` style query secrets from URLs in error messages.
 */
export function redactScheduleLog(text: unknown, ...secrets: Array<string | undefined>): string {
  const all = [...secrets, knownWebhookToken ?? undefined] as Array<string | undefined>;
  let out = redactSecrets(text, ...all);
  out = out.replace(/([?&])(?:token|key|api[_-]?key|apikey|password|secret|sig|signature|auth)=[^&\s#]+/gi, '$1«redacted»');
  return out;
}
const safeLogText = redactScheduleLog;
function scheduleLog(msg: string, ...secrets: Array<string | undefined>): void {
  console.log(safeLogText(`[surnia-schedule] ${msg}`, ...secrets));
}
function scheduleWarn(msg: string, ...secrets: Array<string | undefined>): void {
  console.warn(safeLogText(`[surnia-schedule] ${msg}`, ...secrets));
}
function scheduleDebug(msg: string, ...secrets: Array<string | undefined>): void {
  console.error(safeLogText(msg, ...secrets));
}

/**
 * v11.31 — validate a trigger at creation time. Before this, addJob() silently
 * DISCARDED `partial.trigger`, so file-watch / webhook / ci-failure jobs could
 * never be created through the public API even though the ticker supported
 * them. Invalid triggers now fail loudly instead of degrading to a cron job
 * that never fires.
 */
function normalizeTrigger(raw: unknown): ScheduleJob['trigger'] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') throw new Error('INVALID_TRIGGER');
  const t = raw as { kind?: unknown; path?: unknown };
  const kind = String(t.kind ?? '');
  if (kind === 'cron' || kind === 'webhook') return { kind };
  if (kind === 'file-watch' || kind === 'ci-failure') {
    const p = typeof t.path === 'string' ? t.path.trim() : '';
    if (!p) throw new Error('INVALID_TRIGGER_PATH');
    // ci-failure shells out to `gh --repo owner/repo`: reject anything that is
    // not exactly an owner/repo slug (argument injection / path jail).
    if (kind === 'ci-failure') {
      const parts = p.split('/');
      if (parts.length !== 2 || parts.some((s) => !s || s === '.' || s === '..' || /\s/.test(s))) {
        throw new Error('INVALID_TRIGGER_PATH');
      }
    }
    return { kind, path: p.slice(0, 500) };
  }
  throw new Error('INVALID_TRIGGER');
}

// ---------- persistence ----------

function storePath(): string {
  // v11.36 — persistence must NEVER silently land in process.cwd(). Before
  // initScheduleService() (or in a plain-node test), `''` used to make a
  // relative schedules.json in whatever folder happened to be current, while
  // every other schedule file (token, CI latch) used the safe userData dir.
  return path.join(opts?.userDataDir ?? userDataDirSafe(), 'schedules.json');
}

function eventsFilePath(): string {
  return path.join(opts?.userDataDir ?? userDataDirSafe(), 'schedules-events.json');
}

function intField(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function sanitizeJob(raw: unknown): ScheduleJobView | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<ScheduleJobView>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.prompt !== 'string' || !r.prompt.trim()) return null;
  if (typeof r.cron !== 'string' || !isValidCron(r.cron)) return null;
  return {
    id: r.id,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 120) : 'Untitled job',
    prompt: r.prompt,
    workspace: typeof r.workspace === 'string' && r.workspace.trim() ? r.workspace.trim() : '',
    cron: r.cron.trim(),
    enabled: r.enabled !== false,
    ...(r.model && typeof r.model === 'object' ? { model: r.model as ModelConfig } : {}),
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    ...(intField(r.lastRun) !== undefined ? { lastRun: r.lastRun } : {}),
    ...(r.lastStatus === 'ok' || r.lastStatus === 'error' || r.lastStatus === 'running'
      ? { lastStatus: r.lastStatus }
      : {}),
    ...(typeof r.lastMessage === 'string' ? { lastMessage: r.lastMessage } : {}),
    ...(typeof r.sessionId === 'string' ? { sessionId: r.sessionId } : {}),
    // v11.38 — honest runtime telemetry (persisted, but optional on legacy rows).
    ...(intField(r.nextRun) !== undefined ? { nextRun: r.nextRun } : {}),
    ...(intField(r.lastFireSlot) !== undefined ? { lastFireSlot: r.lastFireSlot } : {}),
    ...(intField(r.runCount) !== undefined ? { runCount: r.runCount } : {}),
    ...(intField(r.consecutiveErrors) !== undefined ? { consecutiveErrors: r.consecutiveErrors } : {}),
    ...(intField(r.lastDurationMs) !== undefined ? { lastDurationMs: r.lastDurationMs } : {}),
    ...(typeof r.lastError === 'string' ? { lastError: r.lastError } : {}),
    ...(r.lastEvent && typeof r.lastEvent === 'object' ? { lastEvent: r.lastEvent as ScheduleEvent } : {}),
    // v2.2 — job permission ceiling: migrate legacy jobs (no mode) to 'autoEdit'.
    mode: r.mode === 'read' || r.mode === 'fullAccess' ? r.mode : 'autoEdit',
    // v7.1 — triggers (file-watch / webhook / ci-failure), validated defensively.
    ...(r.trigger && typeof r.trigger === 'object' && ['cron', 'file-watch', 'webhook', 'ci-failure'].includes(String((r.trigger as { kind?: string }).kind))
      ? { trigger: { kind: (r.trigger as { kind: 'cron' | 'file-watch' | 'webhook' | 'ci-failure' }).kind, ...(typeof (r.trigger as { path?: string }).path === 'string' ? { path: (r.trigger as { path: string }).path.slice(0, 500) } : {}) } }
      : {}),
  };
}

/** Atomic, owner-only write to any of our JSON files. Never throws. */
function atomicWriteJson(file: string, value: unknown): boolean {
  const dir = path.dirname(file);
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best-effort cleanup */
    }
    scheduleWarn(`could not persist ${path.basename(file)}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function loadJobs(): ScheduleJobView[] {
  let loaded: ScheduleJobView[] = [];
  try {
    const raw = fs.readFileSync(storePath(), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : [];
    loaded = arr
      .map(sanitizeJob)
      .filter((j): j is ScheduleJobView => j !== null)
      .slice(0, MAX_JOBS);
  } catch (err) {
    // v11.31 — an existing but corrupt store is NOT a silent "0 jobs": say so
    // once, then start clean so the scheduler still boots.
    if (fs.existsSync(storePath())) {
      scheduleWarn(`schedules.json unreadable (${err instanceof Error ? err.message : String(err)}) — starting with no jobs`);
    }
  }
  for (const j of loaded) {
    // A job that was 'running' when the app died is not running anymore.
    if (j.lastStatus === 'running') {
      j.lastStatus = 'error';
      j.lastError = 'interrupted by restart';
      j.lastMessage = 'interrupted by restart';
    }
    // v11.38 — exact nextRun is ALWAYS derived from the cron, never trusted
    // from disk (the wall clock moved while the app was closed).
    j.nextRun = computeNextRun(j.cron, clock().now()) || undefined;
  }
  return loaded;
}

function persistJobs(): void {
  atomicWriteJson(storePath(), jobs);
}

function loadEvents(): ScheduleEvent[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(eventsFilePath(), 'utf8'));
    const arr = Array.isArray(parsed) ? parsed : [];
    return arr
      .filter((e): e is ScheduleEvent => !!e && typeof e === 'object' && typeof e.seq === 'number')
      .slice(-MAX_EVENTS);
  } catch {
    return [];
  }
}

function persistEvents(): void {
  atomicWriteJson(eventsFilePath(), recentEvents);
}

// ---------- cron (tiny matcher, minute resolution) ----------

const CRON_ALIASES: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
};

const FIELD_RANGES: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // day of week (0 and 7 = Sunday)
];

/** Parse one cron field ("*", "5", "1-5", step syntax "n/step", "a-b/step", "a,b,c") into a value set. */
export function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const p = part.trim();
    if (!p) return null;
    let body = p;
    let step = 1;
    const slash = p.indexOf('/');
    if (slash >= 0) {
      body = p.slice(0, slash);
      step = Number(p.slice(slash + 1));
      if (!Number.isInteger(step) || step < 1) return null;
    }
    let lo = min;
    let hi = max;
    if (body !== '*') {
      const dash = body.indexOf('-');
      if (dash >= 0) {
        const lhs = body.slice(0, dash);
        const rhs = body.slice(dash + 1);
        if (!lhs || !rhs) return null; // reject "-5", "5-" (Number('') would be 0)
        lo = Number(lhs);
        hi = Number(rhs);
      } else {
        lo = Number(body);
        hi = step > 1 ? max : lo; // "5/15" → 5,20,35,50
      }
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
      if (lo < min || hi > max || lo > hi) return null;
    }
    for (let v = lo; v <= hi; v += step) out.add(v === 7 && max === 7 ? 0 : v); // dow 7 → 0
  }
  return out.size ? out : null;
}

/** Validate a cron expression (alias or 5-field). */
export function isValidCron(cron: string): boolean {
  const expr = CRON_ALIASES[String(cron ?? '').trim().toLowerCase()] ?? String(cron ?? '').trim();
  const fields = expr.split(/\s+/);
  if (fields.length !== 5) return false;
  for (let i = 0; i < 5; i++) {
    if (!parseCronField(fields[i], FIELD_RANGES[i][0], FIELD_RANGES[i][1])) return false;
  }
  return true;
}

function cronParts(cron: string): [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>] | null {
  const expr = CRON_ALIASES[cron.trim().toLowerCase()] ?? cron.trim();
  const fields = expr.split(/\s+/);
  if (fields.length !== 5) return null;
  const sets = fields.map((f, i) => parseCronField(f, FIELD_RANGES[i][0], FIELD_RANGES[i][1]));
  for (const s of sets) if (!s) return null;
  return sets as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
}

/** Does the given local timestamp (minute resolution) match the cron? */
export function cronMatches(cron: string, t: number): boolean {
  const parts = cronParts(cron);
  if (!parts) return false;
  const [mins, hours, doms, months, dows] = parts;
  const d = new Date(t);
  return (
    mins.has(d.getMinutes()) &&
    hours.has(d.getHours()) &&
    doms.has(d.getDate()) &&
    months.has(d.getMonth() + 1) &&
    dows.has(d.getDay())
  );
}

/**
 * Exact next matching cron slot strictly after `from` (minute resolution).
 * Mirrors SchedulePanel.cronNextRun so the persisted nextRun equals the UI.
 * Scans day-by-day (cheap even for @yearly). Returns 0 if unparseable.
 */
export function computeNextRun(cron: string, from: number): number {
  const parts = cronParts(cron);
  if (!parts) return 0;
  const [mins, hours, doms, months, dows] = parts;
  const start = new Date(from);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);
  const startMs = start.getTime();
  const limit = from + 400 * 86_400_000;
  const hs = [...hours].sort((a, b) => a - b);
  const ms = [...mins].sort((a, b) => a - b);
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (day.getTime() <= limit) {
    if (months.has(day.getMonth() + 1) && doms.has(day.getDate()) && dows.has(day.getDay())) {
      for (const h of hs) {
        for (const m of ms) {
          const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
          if (t >= startMs && t <= limit) return t;
        }
      }
    }
    day.setDate(day.getDate() + 1);
  }
  return 0;
}

/**
 * Should this job fire now? Returns the cron slot being consumed (ms epoch),
 * or 0. At most ONE slot is consumed per tick; slots older than LOOKBACK_MS
 * are skipped (laptop asleep → skip, never replay a storm). `lastFireSlot`
 * (not the run start time) gates re-fires, so a long run can never consume the
 * same minute twice.
 */
function dueSlot(job: ScheduleJobView, now: number): number {
  const kind = job.trigger?.kind ?? 'cron';
  if (kind === 'webhook') return 0; // webhooks fire via fireJob(), not the tick
  if (kind === 'file-watch') return fileWatchFired(job, now) ? Math.floor(now / 60_000) * 60_000 : 0;
  if (kind === 'ci-failure') return ciFailureFired(job, now) ? Math.floor(now / 60_000) * 60_000 : 0;
  const lastSlot = intField(job.lastFireSlot) ?? (intField(job.lastRun) ?? job.createdAt) - 60_000;
  const from = Math.max(lastSlot + 1, now - LOOKBACK_MS);
  const end = Math.floor(now / 60_000) * 60_000;
  let found = 0;
  for (let t = Math.ceil(from / 60_000) * 60_000; t <= end; t += 60_000) {
    if (cronMatches(job.cron, t)) found = t; // latest matching slot wins
  }
  return found;
}

// ---------- v7.1 triggers: file-watch / webhook / ci-failure ----------

/** file-watch: mtime of the watched path newer than the last fire. */
function fileWatchFired(job: ScheduleJobView, now: number): boolean {
  const p = job.trigger?.path;
  if (!p) return false;
  try {
    const st = fs.statSync(p);
    const mtime = st.mtimeMs;
    const last = typeof job.lastRun === 'number' ? job.lastRun : job.createdAt;
    return mtime > last + 1_000 && now - last > 5_000; // debounce 5s
  } catch {
    return false;
  }
}

/** ci-failure: latest `gh run list` conclusion is failure (fires once per incident). */
function ciFailureFired(job: ScheduleJobView, now: number): boolean {
  const repo = job.trigger?.path;
  if (!repo) return false;
  const last = typeof job.lastRun === 'number' ? job.lastRun : job.createdAt;
  if (now - last < 5 * 60_000) return false; // poll at most every 5 min
  try {
    const { execFileSync } = require('child_process') as { execFileSync: (c: string, a: string[], o?: object) => Buffer };
    const out = execFileSync('gh', ['run', 'list', '--repo', repo, '--limit', '1', '--json', 'conclusion,databaseId'], { timeout: 20_000, windowsHide: true }).toString('utf8');
    const parsed = JSON.parse(out) as Array<{ conclusion?: string; databaseId?: number }>;
    const latest = parsed?.[0];
    if (latest?.conclusion !== 'failure') return false;
    // fire once per failure id
    const key = `ci-${repo}-${latest.databaseId}`;
    const firedSet = ciFiredKeys();
    if (firedSet.has(key)) return false;
    firedSet.add(key);
    // v11.31 — never claim an incident is latched when the write failed: back
    // out and skip the fire rather than spamming the user every poll.
    if (!saveCiFiredKeys(firedSet)) {
      firedSet.delete(key);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * v11.31 — dedicated latch file for "fire once per CI incident". The previous
 * implementation hung `__ciFired` on the schedules.json ARRAY; JSON.stringify
 * drops named properties on arrays, so the latch NEVER survived and the same
 * failing run re-fired on every 5-minute poll. A separate file also stops the
 * latch from being overwritten by persistJobs().
 */
function ciFiredFile(): string {
  return path.join(opts?.userDataDir ?? userDataDirSafe(), 'schedules-ci-fired.json');
}
function ciFiredKeys(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(ciFiredFile(), 'utf8'));
    return new Set(Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}
function saveCiFiredKeys(set: Set<string>): boolean {
  return atomicWriteJson(ciFiredFile(), [...set].slice(-100));
}

/**
 * v7.1 — webhook listener: loopback-only HTTP server; POST /trigger/<jobId>
 * with ?token=<install secret> fires the job. The token lives in
 * userData/schedules-token (0600) and is shown once in the scheduler UI.
 */
let webhookServer: import('http').Server | null = null;
/** v11.31 — honest listener state (listen() errors are async; `ok:true` alone lies). */
let webhookListening = false;
let webhookError: string | null = null;

function tokenFile(): string {
  return path.join(opts?.userDataDir ?? userDataDirSafe(), 'schedules-token');
}

export function webhookToken(): string {
  const file = tokenFile();
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (t) {
      knownWebhookToken = t;
      try {
        fs.chmodSync(file, 0o600);
      } catch {
        /* best-effort on read-only filesystems */
      }
      return t;
    }
  } catch {
    /* create below */
  }
  const t = randomUUID().replace(/-/g, '');
  knownWebhookToken = t;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, t + '\n', { mode: 0o600 });
  } catch {
    /* best-effort */
  }
  return t;
}

/** Actual bound port once listening, else null (never guess from the request). */
export function webhookPort(): number | null {
  if (!webhookListening || !webhookServer) return null;
  try {
    const addr = webhookServer.address();
    return addr && typeof addr === 'object' && 'port' in addr ? Number((addr as { port: number }).port) : null;
  } catch {
    return null;
  }
}

/** Honest listener state (used by schedulerStatus + the IPC webhook handler). */
export function webhookState(): { listening: boolean; port: number | null; error: string | null } {
  return { listening: webhookListening, port: webhookPort(), error: webhookError };
}

function userDataDirSafe(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as { app?: { getPath?: (k: string) => string } };
    return app?.getPath?.('userData') ?? process.cwd();
  } catch {
    return process.cwd();
  }
}

export function startWebhookListener(port = 7681): { ok: boolean; detail: string; token: string } {
  const token = webhookToken();
  if (webhookServer) {
    return {
      ok: webhookListening,
      detail: webhookListening
        ? `webhook listener already running on port ${webhookPort() ?? port}`
        : `webhook listener not bound (${webhookError ?? 'starting'})`,
      token,
    };
  }
  try {
    const http = require('http') as typeof import('http');
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (req.method !== 'POST' || !u.pathname.startsWith('/trigger/')) {
          res.writeHead(404).end();
          return;
        }
        if (u.searchParams.get('token') !== token) {
          res.writeHead(403).end('bad token');
          return;
        }
        const jobId = decodeURIComponent(u.pathname.slice('/trigger/'.length));
        const job = jobs.find((j) => j.id === jobId);
        // HONEST response: 404 for unknown job, 409 for a duplicate fire,
        // 200 only when the fire was actually accepted.
        if (!job) {
          res.writeHead(404).end('{"accepted":false,"error":"JOB_NOT_FOUND"}');
          return;
        }
        if (firing.has(jobId) || quitting || !job.enabled) {
          res.writeHead(409).end('{"accepted":false,"error":"NOT_ACCEPTABLE"}');
          return;
        }
        res.writeHead(200).end('{"accepted":true}');
        // fire outside the request lifetime
        clock().setTimeout(() => void fireJob(jobId, Math.floor(clock().now() / 60_000) * 60_000), 0);
      } catch {
        try {
          res.writeHead(500).end();
        } catch {
          /* socket gone */
        }
      }
    });
    webhookListening = false;
    webhookError = null;
    // v11.31 — register BEFORE listen(): a busy port must never crash the
    // process, and the state must honestly report the failure to callers.
    server.on('listening', () => {
      webhookListening = true;
      webhookError = null;
    });
    server.on('error', (err: Error) => {
      webhookError = err.message;
      webhookListening = false;
      scheduleWarn(`webhook listener unavailable: ${err.message}`, token);
      if (webhookServer === server) webhookServer = null;
    });
    server.listen(port, '127.0.0.1');
    webhookServer = server;
    return { ok: true, detail: `webhook listener starting on http://127.0.0.1:${port}/trigger/<jobId>`, token };
  } catch (err) {
    webhookError = err instanceof Error ? err.message : String(err);
    webhookListening = false;
    return { ok: false, detail: webhookError, token };
  }
}

export function stopWebhookListener(): void {
  try {
    webhookServer?.close();
  } catch {
    /* already closed */
  }
  webhookServer = null;
  webhookListening = false;
  webhookError = null;
}

// ---------- headless runner ----------

/** Detect the workspace's test command from its manifest / project files. */
async function detectTestCommand(workspace: string): Promise<string | null> {
  try {
    const pkg = path.join(workspace, 'package.json');
    if (fs.existsSync(pkg)) {
      const j = JSON.parse(await fs.promises.readFile(pkg, 'utf8')) as { scripts?: Record<string, string> };
      const t = j.scripts?.test?.trim();
      if (t && !/^echo\b/i.test(t)) return t.startsWith('npm') ? t : 'npm test';
    }
  } catch {
    /* fall through */
  }
  try {
    if (fs.existsSync(path.join(workspace, 'pyproject.toml')) || fs.existsSync(path.join(workspace, 'pytest.ini'))) return 'python -m pytest -q';
  } catch {
    /* fall through */
  }
  try {
    if (fs.existsSync(path.join(workspace, 'go.mod'))) return 'go test ./...';
  } catch {
    /* fall through */
  }
  try {
    if (fs.existsSync(path.join(workspace, 'Cargo.toml'))) return 'cargo test';
  } catch {
    /* fall through */
  }
  return null;
}

/** Default proof gate: the workspace test suite must pass after a claimed success. */
async function defaultProofGate(workspace: string, _summary: string): Promise<ProofVerdict> {
  try {
    const testCmd = await detectTestCommand(workspace);
    if (!testCmd) return 'no-suite';
    const { runCaptured } = await import('./terminalService');
    const t = await runCaptured(testCmd, workspace, 150_000);
    return t.exitCode === 0 ? 'verified' : 'gate-failed';
  } catch {
    return 'unverified';
  }
}

export interface HeadlessRunOptions {
  prompt: string;
  workspace: string;
  model?: ModelConfig;
  sessionId?: string;
  timeoutMs?: number;
  /** Optional external abort signal (cancel/pause/shutdown). */
  signal?: AbortSignal;
  /**
   * v2.2 — permission ceiling for this run ('read' | 'autoEdit' | 'fullAccess';
   * default 'autoEdit'). 'read' → review task mode + default permission mode
   * (fully read-only posture, mutating commands hard-denied by the gate).
   */
  mode?: 'read' | 'autoEdit' | 'fullAccess';
}

export interface HeadlessRunResult {
  ok: boolean;
  summary: string;
  sessionId: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  aborted: boolean;
  error?: string;
}

/** Read <workspace>/MEMORY.md (defensive) — injected into headless runs. */
export function readWorkspaceMemory(workspace: string): string | undefined {
  try {
    if (!workspace) return undefined;
    const p = path.join(workspace, 'MEMORY.md');
    if (!fs.existsSync(p)) return undefined;
    const content = fs.readFileSync(p, 'utf8');
    return content ? content.slice(0, MEMORY_READ_CAP) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run the agent headlessly (no UI): buffer text, auto-DENY approvals,
 * hard timeout, abort on app quit. Same engine path as the local API
 * server / the interactive run, with credential injection from settings.
 */
export async function runHeadlessAgent(runOpts: HeadlessRunOptions): Promise<HeadlessRunResult> {
  const sessionId = runOpts.sessionId || randomUUID();
  const workspace = runOpts.workspace;
  const result: HeadlessRunResult = {
    ok: false,
    summary: '',
    sessionId,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    aborted: false,
  };

  // Resolve the model: explicit override → settings → nothing (fail clean).
  let model: ModelConfig | undefined = runOpts.model;
  if (!model?.model) {
    try {
      model = getSettings().model;
    } catch {
      model = undefined;
    }
  }
  if (!model?.model) {
    result.error = 'no model configured';
    result.summary = 'no model configured';
    return result;
  }

  const userMsg: ChatMessage = {
    id: randomUUID(),
    role: 'user',
    kind: 'text',
    content: runOpts.prompt,
    timestamp: Date.now(),
  };
  const memory = readWorkspaceMemory(workspace);
  // v2.2 — job permission ceiling: 'read' runs fully read-only (review task
  // mode + default permission mode); 'autoEdit' auto-approves file edits
  // (headless approvals below still DENY everything else); 'fullAccess' is an
  // explicit per-job opt-in. NEVER hardcode fullAccess anymore.
  const jobMode = runOpts.mode === 'read' || runOpts.mode === 'fullAccess' ? runOpts.mode : 'autoEdit';
  const params: AgentRunParams = {
    task: 'chat',
    sessionId,
    messages: [userMsg],
    model,
    ...(jobMode === 'read'
      ? { mode: 'default' as const, taskMode: 'review' as const }
      : { mode: jobMode }),
    workspace,
    ...(memory ? { memory } : {}),
  };
  try {
    params.providers = getSettings().providers; // credential injection (main owns settings.json)
  } catch {
    /* engine falls back to env keys */
  }

  // Text buffer + usage accounting via a minimal AgentIO.
  let buffer = '';
  let sawError: string | undefined;
  const controller = new AbortController();
  activeRuns.add(controller);

  const io: AgentIO = {
    send: (event): void => {
      if (process.env.SURNIA_DEBUG_HEADLESS) scheduleDebug(`[headless ${sessionId.slice(0, 8)}] evt ${event.type} @${Date.now() % 100000}`);
      try {
        if (event.type === 'text_delta') {
          if (buffer.length < MAX_BUFFER) buffer += event.text;
        } else if (event.type === 'tool_result') {
          if (buffer.length < MAX_BUFFER) {
            buffer += `\n[${event.ok ? 'tool' : 'tool-error'}] ${event.output.slice(0, 200)}`;
          }
        } else if (event.type === 'message_end' && event.usage) {
          result.inputTokens += event.usage.inputTokens;
          result.outputTokens += event.usage.outputTokens;
          result.costUsd += estimateCost(model.provider, model.model, event.usage.inputTokens, event.usage.outputTokens);
        } else if (event.type === 'error') {
          sawError = event.message;
        }
      } catch {
        /* accounting must never break the run */
      }
    },
    getDecision: (requestId: string): Promise<PermissionDecision | null> => {
      // Headless = unattended → auto-DENY every approval (safe default).
      void requestId;
      return Promise.resolve({ requestId, action: 'deny' });
    },
    isAborted: (): boolean => controller.signal.aborted || !!runOpts.signal?.aborted || quitting,
    onFetchSignal: (cb: (signal: AbortSignal) => void): void => {
      try {
        cb(controller.signal);
        if (runOpts.signal) {
          if (runOpts.signal.aborted) controller.abort();
          else runOpts.signal.addEventListener('abort', () => controller.abort(), { once: true });
        }
      } catch {
        /* ignore */
      }
    },
  };

  const timeout = clock().setTimeout(() => {
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  // v11.31 — allow short, injected timeouts (deterministic abort tests) while
  // keeping the 30-minute production default. The timer is always cleared in `finally`.
  }, Math.max(1_000, runOpts.timeoutMs ?? RUN_TIMEOUT_MS));

  try {
    await runAgent(params, io);
  } catch (err) {
    sawError = sawError ?? (err instanceof Error ? err.message : String(err));
  } finally {
    clock().clearTimeout(timeout);
    activeRuns.delete(controller);
  }

  result.aborted = controller.signal.aborted || !!runOpts.signal?.aborted || quitting;
  const text = buffer.replace(/\s+/g, ' ').trim();
  result.summary = (text || sawError || (result.aborted ? 'run aborted' : '')).slice(0, 500);
  result.ok = !result.aborted && !sawError;
  if (sawError) result.error = sawError;
  return result;
}

// ---------- events ----------

function broadcast(payload: {
  jobId: string;
  status: 'running' | 'ok' | 'error';
  sessionId?: string;
  jobName?: string;
  seq?: number;
  at?: number;
  message?: string;
}): void {
  try {
    opts?.broadcast?.(payload);
  } catch {
    /* window gone — ignore */
  }
}

/** Emit a durable + broadcast event for a job (the panel consumes lastEvent). */
function emitEvent(job: ScheduleJobView, status: ScheduleEventStatus, extra?: { sessionId?: string; message?: string }): ScheduleEvent {
  const ev: ScheduleEvent = {
    seq: ++eventSeq,
    jobId: job.id,
    ...(job.name ? { jobName: job.name } : {}),
    status,
    at: clock().now(),
    ...(extra?.sessionId ? { sessionId: extra.sessionId } : {}),
    ...(extra?.message ? { message: extra.message.slice(0, MAX_SUMMARY) } : {}),
  };
  recentEvents.push(ev);
  if (recentEvents.length > MAX_EVENTS) recentEvents = recentEvents.slice(-MAX_EVENTS);
  job.lastEvent = ev;
  persistEvents();
  if (status !== 'missed') {
    broadcast({
      jobId: job.id,
      status,
      ...(job.name ? { jobName: job.name } : {}),
      seq: ev.seq,
      at: ev.at,
      ...(extra?.sessionId ? { sessionId: extra.sessionId } : {}),
      ...(extra?.message ? { message: extra.message } : {}),
    });
  }
  return ev;
}

/** Read-only snapshot of the durable event ledger (tests / CLI / future IPC). */
export function listEvents(limit = MAX_EVENTS): ScheduleEvent[] {
  return [...recentEvents].slice(-Math.max(1, Math.min(MAX_EVENTS, limit))).reverse();
}

// ---------- firing ----------

/** Fire one job headlessly (scheduled tick or manual runNow). Never throws. */
async function fireJob(jobId: string, slot?: number): Promise<void> {
  const job = jobs.find((j) => j.id === jobId);
  if (!job || firing.has(jobId) || quitting) return;
  if (!job.workspace) {
    const reason = 'no workspace configured';
    job.lastStatus = 'error';
    job.lastMessage = reason;
    job.lastError = reason;
    job.consecutiveErrors = (job.consecutiveErrors ?? 0) + 1;
    job.lastRun = clock().now();
    if (slot) job.lastFireSlot = slot;
    job.nextRun = computeNextRun(job.cron, clock().now()) || undefined;
    persistJobs();
    emitEvent(job, 'error', { message: reason });
    return;
  }

  firing.add(jobId);
  const controller = new AbortController();
  runControllers.set(jobId, controller);
  const startedAt = clock().now();
  job.lastStatus = 'running';
  job.lastRun = startedAt;
  job.lastMessage = undefined;
  job.lastError = undefined;
  if (slot) job.lastFireSlot = slot;
  // Re-arm nextRun immediately so the countdown never freezes during a long run.
  job.nextRun = computeNextRun(job.cron, slot ?? startedAt) || undefined;
  persistJobs();
  emitEvent(job, 'running');

  try {
    const runner = opts?.runJob ?? runHeadlessAgent;
    const r = await runner({
      prompt: job.prompt,
      workspace: job.workspace,
      // v2.2 — honor the job's permission ceiling ('read' | 'autoEdit' |
      // 'fullAccess'); sanitizeJob migrates legacy jobs to 'autoEdit'.
      mode: job.mode,
      ...(job.model ? { model: job.model } : {}),
      signal: controller.signal,
    });

    // v7.1 — PROOF GATE: an automation that says "done" is noise until the
    // harness agrees. When the workspace has a test command, the run's exit
    // is not enough — the suite must pass AFTER the run.
    const gate = opts?.proofGate ?? defaultProofGate;
    let proofVerdict: ProofVerdict = 'no-suite';
    if (r.ok) {
      try {
        proofVerdict = await gate(job.workspace, r.summary);
        if (proofVerdict === 'gate-failed') {
          job.lastStatus = 'error';
          job.lastMessage = `[proof gate] automation claims done but the test suite FAILED — suppressed. ${r.summary.slice(0, 120)}`;
          job.lastError = job.lastMessage;
        }
      } catch {
        proofVerdict = 'unverified';
      }
    }

    if (proofVerdict !== 'gate-failed') {
      job.lastStatus = r.ok ? 'ok' : 'error';
      if (proofVerdict === 'verified') job.lastMessage = `[proof gate: verified] ${r.summary.slice(0, MAX_SUMMARY - 30)}`;
      else if (proofVerdict === 'no-suite') job.lastMessage = r.summary.slice(0, MAX_SUMMARY);
      else if (proofVerdict === 'unverified') job.lastMessage = `[proof gate: unverified] ${r.summary.slice(0, MAX_SUMMARY - 26)}`;
      else job.lastMessage = r.summary.slice(0, MAX_SUMMARY);
      if (!r.ok) job.lastError = r.error || r.summary || 'run failed';
    }
    const finalOk = r.ok && proofVerdict !== 'gate-failed';
    job.consecutiveErrors = finalOk ? 0 : (job.consecutiveErrors ?? 0) + 1;
    job.runCount = (job.runCount ?? 0) + 1;
    job.lastDurationMs = Math.max(0, clock().now() - startedAt);
    job.sessionId = r.sessionId;
    job.nextRun = computeNextRun(job.cron, clock().now()) || undefined;

    try {
      // Notify for every terminal result (ok OR error); only a gate-overruled
      // run is suppressed by the verdict itself, not by skipping the call.
      notifyScheduleDone(job.name, finalOk);
    } catch {
      /* notifications must never break the scheduler */
    }
    emitEvent(job, finalOk ? 'ok' : 'error', {
      sessionId: r.sessionId,
      message: job.lastMessage ?? job.lastError,
    });
  } catch (err) {
    const reason = (err instanceof Error ? err.message : String(err)).slice(0, MAX_SUMMARY);
    job.lastStatus = 'error';
    job.lastError = reason;
    job.lastMessage = reason;
    job.consecutiveErrors = (job.consecutiveErrors ?? 0) + 1;
    job.runCount = (job.runCount ?? 0) + 1;
    job.lastDurationMs = Math.max(0, clock().now() - startedAt);
    job.nextRun = computeNextRun(job.cron, clock().now()) || undefined;
    emitEvent(job, 'error', { message: reason });
  } finally {
    firing.delete(jobId);
    runControllers.delete(jobId);
    persistJobs();
  }
}

// ---------- scheduler tick ----------

function tick(): void {
  try {
    if (quitting || !opts) return;
    const now = clock().now();
    for (const job of [...jobs]) {
      if (quitting) return; // v11.31 — no new fires once shutdown started
      try {
        if (!job.enabled || firing.has(job.id)) continue;
        const slot = dueSlot(job, now);
        if (slot) void fireJob(job.id, slot);
      } catch {
        /* per-job guard — one bad job never kills the tick */
      }
    }
  } catch {
    /* NEVER throw from the interval */
  }
}

// ---------- lifecycle ----------

export function initScheduleService(serviceOpts: ScheduleServiceOptions): void {
  opts = serviceOpts;
  quitting = false; // allow re-init after a shutdown (tests / hot reload)
  jobs = loadJobs();
  recentEvents = loadEvents();
  eventSeq = recentEvents.reduce((m, e) => Math.max(m, e.seq), 0);
  if (ticker !== null) clock().clearInterval(ticker);
  ticker = clock().setInterval(tick, TICK_MS);
  // never keep the process alive just for the scheduler (Electron stays alive).
  const t = ticker as { unref?: () => void } | null;
  t?.unref?.();
  // v7.1 — webhook triggers (loopback-only, token-gated; safe to start always)
  const wh = startWebhookListener();
  scheduleLog(`${jobs.length} job(s) loaded · ${wh.detail}`, wh.token);
  // v11.31 P1 (A12) — log only that the token is armed, never its value.
  scheduleLog(`webhook token: «redacted» (${jobs.length} job(s) triggerable)`, wh.token);
}

/** Stop the scheduler and abort in-flight headless runs (main.ts will-quit). */
export function shutdownScheduleService(): void {
  quitting = true;
  // v11.10 — release the loopback webhook port too: a restart in the same
  // process (hot reload / tests / settings apply) used to hit EADDRINUSE and
  // take the whole scheduler init down with it.
  stopWebhookListener();
  if (ticker !== null) {
    clock().clearInterval(ticker);
    ticker = null;
  }
  for (const c of [...activeRuns]) {
    try {
      c.abort();
    } catch {
      /* ignore */
    }
  }
  activeRuns.clear();
  for (const c of runControllers.values()) {
    try {
      c.abort();
    } catch {
      /* ignore */
    }
  }
  runControllers.clear();
  // v11.31 — no orphan "in-flight" markers across a restart.
  firing.clear();
}

// ---------- job API ----------

export function listJobs(): ScheduleJobView[] {
  // Keep the ORIGINAL reference semantics: callers (and the live test suite)
  // hold a job object and watch it mutate after a fire. A shallow copy here
  // would freeze that view at "running" forever.
  return [...jobs];
}

/**
 * v11.36/v11.38 — honest scheduler state. `running` is true ONLY when the
 * ticker is actually installed and shutdown has not begun; the webhook fields
 * come from the listener's own events. Added: eventSeq/jobCount telemetry.
 */
export function schedulerStatus(): {
  running: boolean;
  quitting: boolean;
  jobCount: number;
  inFlight: number;
  webhookListening: boolean;
  webhookPort: number | null;
  webhookError: string | null;
  storePath: string;
  eventSeq: number;
  tickMs: number;
  observed: boolean;
} {
  const wh = webhookState();
  return {
    running: ticker !== null && !quitting,
    quitting,
    jobCount: jobs.length,
    inFlight: firing.size,
    webhookListening: wh.listening,
    webhookPort: wh.port,
    webhookError: wh.error,
    storePath: storePath(),
    eventSeq,
    tickMs: TICK_MS,
    // "observed" = a real fire has been recorded in this install (durable).
    observed: recentEvents.some((e) => e.status === 'ok' || e.status === 'error'),
  };
}

export function addJob(partial: Partial<ScheduleJob>): ScheduleJobView {
  const prompt = typeof partial?.prompt === 'string' ? partial.prompt.trim() : '';
  if (!prompt) throw new Error('PROMPT_REQUIRED');
  const workspace = typeof partial?.workspace === 'string' ? partial.workspace.trim() : '';
  if (!workspace) throw new Error('WORKSPACE_REQUIRED');
  try {
    if (!fs.statSync(workspace).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error('WORKSPACE_NOT_FOUND');
  }
  const cron = typeof partial?.cron === 'string' ? partial.cron.trim() : '';
  if (!isValidCron(cron)) throw new Error('INVALID_CRON');
  if (jobs.length >= MAX_JOBS) throw new Error('TOO_MANY_JOBS');

  const now = clock().now();
  const job: ScheduleJobView = {
    id: randomUUID(),
    name:
      typeof partial?.name === 'string' && partial.name.trim()
        ? partial.name.trim().slice(0, 120)
        : 'Untitled job',
    prompt,
    workspace,
    cron,
    enabled: partial?.enabled !== false,
    // v2.2 — permission ceiling (default 'autoEdit'; renderer form may pass 'read'/'fullAccess').
    mode: partial?.mode === 'read' || partial?.mode === 'fullAccess' ? partial.mode : 'autoEdit',
    ...(partial?.model && typeof partial.model === 'object' && partial.model.model
      ? { model: partial.model as ModelConfig }
      : {}),
    // v11.31 — persist validated triggers; they used to be silently discarded.
    ...(partial?.trigger !== undefined ? { trigger: normalizeTrigger(partial.trigger) } : {}),
    createdAt: now,
    runCount: 0,
    consecutiveErrors: 0,
    nextRun: computeNextRun(cron, now) || undefined,
  };
  jobs.push(job);
  persistJobs();
  // Callers hold this reference and watch it mutate after a fire — return the
  // live object, never a copy (same contract as listJobs()).
  return job;
}

export function removeJob(id: string): boolean {
  const before = jobs.length;
  cancelJob(id); // abort an in-flight run before removing the job
  jobs = jobs.filter((j) => j.id !== id);
  const removed = jobs.length < before;
  if (removed) persistJobs();
  return removed;
}

export function toggleJob(id: string, enabled: boolean): ScheduleJobView | null {
  const job = jobs.find((j) => j.id === id);
  if (!job) return null;
  job.enabled = enabled === true;
  if (!job.enabled) cancelJob(id); // pausing a running job stops its run
  persistJobs();
  return job;
}

/** Abort an in-flight run for a job. Returns true if one was cancelled. */
export function cancelJob(id: string): boolean {
  const c = runControllers.get(id);
  if (!c) return false;
  try {
    c.abort();
  } catch {
    /* ignore */
  }
  runControllers.delete(id);
  return true;
}

/** Run ONE scheduler tick on demand. Same code path the timer invokes. */
export function runSchedulerTick(): number {
  const now = clock().now();
  const due: Array<[string, number]> = [];
  for (const j of jobs) {
    if (j.enabled && !firing.has(j.id)) {
      const slot = dueSlot(j, now);
      if (slot) due.push([j.id, slot]);
    }
  }
  for (const [id, slot] of due) void fireJob(id, slot);
  return due.length;
}

export function runNow(id: string): { ok: boolean; error?: string } {
  const job = jobs.find((j) => j.id === id);
  if (!job) return { ok: false, error: 'JOB_NOT_FOUND' };
  if (firing.has(id)) return { ok: false, error: 'ALREADY_RUNNING' };
  if (!job.workspace) return { ok: false, error: 'NO_WORKSPACE' };
  void fireJob(id, Math.floor(clock().now() / 60_000) * 60_000);
  return { ok: true };
}
