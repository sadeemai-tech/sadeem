// ============================================================
// Surnia v3 — background process service ("give the agent time")
// ------------------------------------------------------------
// run_command is a BLOCKING one-shot (≤ 600s) — perfect for builds
// and tests, useless for dev servers, watchers and tunnels. This
// service starts LONG-LIVED processes that survive the tool call:
//
//   run_background("npm run dev") → returns immediately with an id
//   process_output(id)            → read the output tail on demand
//   stop_process(id)              → kill the whole process group
//
// Design notes:
// - Electron-free (the surnia CLI bundle imports this too): the log
//   directory is injected via setProcessLogsDir(); the default is a
//   temp dir so headless tests work unchanged.
// - Every process is spawned DETACHED in its own process group so
//   stop kills npm + vite + esbuild children, not just the shell.
// - Output is kept in a bounded ring (memory) AND appended to a log
//   file on disk (crash-safe, inspectable later).
// - URLs printed by dev servers (Vite "Local: …", Next "ready …")
//   are harvested and returned with every read so the agent can
//   point the Live Preview at the right port without guessing.
// - Bounded lifecycle: max RUNNING_PROCESSES_CAP live processes and
//   PROC_TTL_MS hard age limit (a forgotten `npm run dev` from a
//   session yesterday must never outlive the app silently).
// ============================================================
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'crypto';
// v11.31 — background processes share the terminal security stack: hard
// dangerous-command floor, severity classification, redaction and a
// redacted spawn environment.
import {
  assertHardCommandSafe,
  classifyForGuard,
  redactForAudit,
  sanitizeSpawnEnv,
} from './terminalGuard';
import { assertSafePath, confineActive, listAllowedRoots } from './fsService';

// ---------- tuning ----------
const RUNNING_PROCESSES_CAP = 8;
const HISTORY_CAP = 32; // finished records kept for later reads
const PROC_TTL_MS = 6 * 60 * 60_000; // 6h hard age limit
const RING_CHARS = 200_000; // in-memory ring per process
const LOG_FILE_CHARS = 5_000_000; // on-disk cap (then truncate front on rotate)
const URL_RE = /https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/[^\s"']*)?/gi;
const URL_SCAN_CHARS = 8_000; // scan only the recent tail for URLs

export interface BackgroundStartResult {
  ok: boolean;
  id?: string;
  pid?: number;
  logFile?: string;
  error?: string;
}

export interface BackgroundStatus {
  id: string;
  command: string;
  cwd: string;
  pid: number | null;
  running: boolean;
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
  outputChars: number;
}

export interface BackgroundReadResult extends BackgroundStatus {
  /** New output since the caller's last read (bounded by the requested tail). */
  output: string;
  /** Dev-server URLs harvested from the output (most recent last). */
  urls: string[];
  truncated: boolean;
}

interface ProcRecord {
  id: string;
  command: string;
  cwd: string;
  child: ChildProcess | null;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  ring: string;
  ringTruncated: boolean;
  readCursor: number; // per-caller reads are absolute-from-ring-start; cursor keeps tail semantics simple
  logFile: string;
  logFd: number | null;
  logBytes: number;
  killTimer: NodeJS.Timeout | null;
}

const procs = new Map<string, ProcRecord>();
let logsDir = path.join(os.tmpdir(), 'surnia-process-logs');

/** Inject the log directory (called by main.ts with app.getPath('userData')). */
export function setProcessLogsDir(dir: string): void {
  if (dir && dir.trim()) logsDir = dir;
}

export function getProcessLogsDir(): string {
  return logsDir;
}

// ---------- spawn plumbing (mirrors terminalService, no SOH marker) ----------
interface SpawnSpec {
  file: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

function buildCommand(cmd: string, cwd: string): SpawnSpec {
  if (process.platform === 'win32') {
    // v11.31 — shell:false + a hand-built cmd.exe command line (verbatim)
    // keeps `node -e "…"` quoting intact without letting Node re-escape it.
    return { file: 'cmd.exe', args: [`/d /s /c "${cmd}"`], windowsVerbatimArguments: true };
  }
  return { file: '/bin/bash', args: ['-lc', `exec 2>&1; cd ${shellQuote(cwd)} 2>/dev/null; ${cmd}`] };
}

function shellQuote(s: string): string {
  return `'` + s.replace(/'/g, `'\\''`) + `'`;
}

function killTree(child: ChildProcess): void {
  try {
    if (process.platform === 'win32') {
      if (child.pid) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
    } else {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL'); // detached group
      } catch {
        child.kill('SIGKILL');
      }
    }
  } catch {
    /* best effort */
  }
}

function isRunning(child: ChildProcess | null): boolean {
  return !!child && child.exitCode === null && child.signalCode === null;
}

/** Append to the ring + log file with caps. Never throws. */
function append(rec: ProcRecord, chunk: string): void {
  if (!chunk) return;
  rec.ring += chunk;
  if (rec.ring.length > RING_CHARS) {
    const dropped = rec.ring.length - RING_CHARS;
    rec.ring = rec.ring.slice(dropped);
    // v11.31 — the read cursor is an ABSOLUTE index into the ring; when the
    // front is dropped it must move too, otherwise read() returns an empty
    // string (a silent failure) for every later call.
    rec.readCursor = Math.max(0, rec.readCursor - dropped);
    rec.ringTruncated = true;
  }
  try {
    if (rec.logFd === null) {
      fs.mkdirSync(logsDir, { recursive: true });
      rec.logFd = fs.openSync(rec.logFile, 'a');
    }
    fs.writeSync(rec.logFd, chunk);
    rec.logBytes += Buffer.byteLength(chunk, 'utf8');
    if (rec.logBytes > LOG_FILE_CHARS) {
      // rotate: close, keep the LAST half as the new file
      try {
        fs.closeSync(rec.logFd);
      } catch {
        /* already closed */
      }
      rec.logFd = null;
      try {
        const keep = fs.readFileSync(rec.logFile, 'utf8').slice(-LOG_FILE_CHARS / 2);
        fs.writeFileSync(rec.logFile, keep, 'utf8');
        rec.logBytes = Buffer.byteLength(keep, 'utf8');
      } catch {
        rec.logBytes = 0;
      }
    }
  } catch {
    /* log file is best-effort; the ring is the source of truth */
  }
}

function reap(): void {
  // drop finished records beyond HISTORY_CAP (oldest finished first)
  const finished = [...procs.values()].filter((r) => !isRunning(r.child)).sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
  let excess = finished.length - HISTORY_CAP;
  for (const rec of finished) {
    if (excess <= 0) break;
    closeLog(rec);
    procs.delete(rec.id);
    excess--;
  }
  // hard age limit
  const now = Date.now();
  for (const rec of procs.values()) {
    if (now - rec.startedAt > PROC_TTL_MS && isRunning(rec.child)) {
      if (rec.child) killTree(rec.child);
    }
  }
}

function closeLog(rec: ProcRecord): void {
  try {
    if (rec.logFd !== null) fs.closeSync(rec.logFd);
  } catch {
    /* ignore */
  }
  rec.logFd = null;
}

// ---------- public API ----------
export function runningCount(): number {
  let n = 0;
  for (const rec of procs.values()) if (isRunning(rec.child)) n++;
  return n;
}

export function start(command: string, cwd: string): BackgroundStartResult {
  const cmd = String(command ?? '').trim();
  if (!cmd) return { ok: false, error: 'COMMAND_REQUIRED' };
  // v11.31 — service-level hard-deny floor (runs even if a caller skipped
  // the tool-layer guard). Honest error, nothing is spawned.
  try {
    assertHardCommandSafe(cmd);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const risk = classifyForGuard(cmd);
  // v11.31 — cwd jail: a renderer/agent-supplied directory must resolve
  // inside the active roots. realpath defeats symlink relocation.
  let workdir = cwd && cwd.trim() ? cwd : (listAllowedRoots()[0] ?? os.homedir());
  try {
    if (confineActive()) {
      workdir = assertSafePath(workdir, 'cwd');
      const real = fs.realpathSync(workdir);
      assertSafePath(real, 'cwd');
      workdir = real;
    } else {
      workdir = path.resolve(workdir);
    }
  } catch (err) {
    return { ok: false, error: `CWD_NOT_ALLOWED: ${err instanceof Error ? err.message : String(err)}` };
  }
  reap();
  if (runningCount() >= RUNNING_PROCESSES_CAP) {
    return {
      ok: false,
      error:
        `background process limit reached (${RUNNING_PROCESSES_CAP} running). ` +
        'Stop one with stop_process before starting another.',
    };
  }
  const id = `bg-${randomUUID().slice(0, 8)}`;
  const rec: ProcRecord = {
    id,
    command: redactForAudit(cmd.slice(0, 300)), // never keep a raw secret in memory/status
    cwd: workdir,
    child: null,
    startedAt: Date.now(),
    endedAt: null,
    exitCode: null,
    ring: '',
    ringTruncated: false,
    readCursor: 0,
    logFile: path.join(logsDir, `${id}.log`),
    logFd: null,
    logBytes: 0,
    killTimer: null,
  };
  try {
    const spec = buildCommand(cmd, rec.cwd);
    const child = spawn(spec.file, spec.args, {
      cwd: rec.cwd,
      // v11.31 — no whole-process.env inheritance (API keys / tokens / DSNs).
      env: sanitizeSpawnEnv({ TERM: 'xterm-256color', FORCE_COLOR: '0', npm_config_yes: 'true' }),
      detached: process.platform !== 'win32', // own process group → group kill
      windowsHide: true,
      shell: false, // EXPLICIT — spec.file is the (explicitly invoked) shell
      ...(spec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    rec.child = child;
    procs.set(id, rec);
    append(rec, `[surnia] started ${id}: ${redactForAudit(cmd)}\n[surnia] cwd: ${rec.cwd} [risk=${risk.level}]\n\n`);
    child.stdout?.on('data', (c: Buffer) => append(rec, c.toString('utf8')));
    child.stderr?.on('data', (c: Buffer) => append(rec, c.toString('utf8')));
    child.on('close', (code) => {
      rec.endedAt = Date.now();
      rec.exitCode = code ?? -1;
      append(rec, `\n[surnia] process exited with code ${rec.exitCode} after ${Math.round((rec.endedAt - rec.startedAt) / 1000)}s\n`);
      closeLog(rec);
      if (rec.killTimer) {
        clearTimeout(rec.killTimer);
        rec.killTimer = null;
      }
      reap();
    });
    child.on('error', (err) => {
      append(rec, `\n[surnia] spawn failed: ${String(err)}\n`);
      rec.endedAt = Date.now();
      rec.exitCode = -1;
      closeLog(rec);
    });
    reap();
    return { ok: true, id, pid: child.pid ?? undefined, logFile: rec.logFile };
  } catch (err) {
    closeLog(rec);
    procs.delete(id);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function statusOf(rec: ProcRecord): BackgroundStatus {
  return {
    id: rec.id,
    command: rec.command,
    cwd: rec.cwd,
    pid: rec.child?.pid ?? null,
    running: isRunning(rec.child),
    exitCode: rec.exitCode,
    startedAt: rec.startedAt,
    endedAt: rec.endedAt,
    outputChars: rec.ring.length,
  };
}

function harvestUrls(rec: ProcRecord): string[] {
  const tail = rec.ring.slice(-URL_SCAN_CHARS);
  const out: string[] = [];
  for (const m of tail.matchAll(URL_RE)) {
    const u = m[0].replace(/[)\].,;'"]}+$/, '');
    if (!out.includes(u)) out.push(u);
    if (out.length >= 6) break;
  }
  return out;
}

/** Read NEW output since the previous call (tail-bounded). Unknown id → null. */
export function read(id: string, tailChars = 6_000): BackgroundReadResult | null {
  const rec = procs.get(id);
  if (!rec) return null;
  const cap = Math.max(200, Math.min(40_000, tailChars));
  let fresh = rec.ring.slice(rec.readCursor);
  let truncated = false;
  if (fresh.length > cap) {
    fresh = fresh.slice(fresh.length - cap);
    truncated = true;
  }
  rec.readCursor = rec.ring.length;
  return {
    ...statusOf(rec),
    output: fresh || (rec.ring ? '(no new output)' : '(no output yet)'),
    urls: harvestUrls(rec),
    truncated,
  };
}

/** Read the whole tail regardless of cursors (used by stop + status helpers). */
export function tail(id: string, tailChars = 3_000): BackgroundReadResult | null {
  const rec = procs.get(id);
  if (!rec) return null;
  const cap = Math.max(200, Math.min(40_000, tailChars));
  const slice = rec.ring.length > cap ? rec.ring.slice(rec.ring.length - cap) : rec.ring;
  return {
    ...statusOf(rec),
    output: slice,
    urls: harvestUrls(rec),
    truncated: rec.ringTruncated || rec.ring.length > cap,
  };
}

export function stop(id: string): { ok: boolean; error?: string } {
  const rec = procs.get(id);
  if (!rec) return { ok: false, error: `unknown process id: ${id}` };
  if (!isRunning(rec.child)) return { ok: true };
  if (rec.child) killTree(rec.child);
  return { ok: true };
}

export function list(): BackgroundStatus[] {
  reap();
  return [...procs.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(statusOf);
}

/** Kill every live process (app shutdown / agent abort). */
export function stopAll(): void {
  for (const rec of procs.values()) {
    if (isRunning(rec.child) && rec.child) killTree(rec.child);
    closeLog(rec);
  }
  procs.clear();
}

/** Test/CLI helper — forget finished records immediately. */
export function disposeAll(): void {
  stopAll();
}
