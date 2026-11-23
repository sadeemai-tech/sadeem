// ============================================================
// Surnia — structured run-trace recorder (best-effort, silent)
// ------------------------------------------------------------
// Every agent run can persist a compact JSONL trace of what it
// actually did (turns, tool calls/results, compactions, errors,
// final outcome). Traces power two things:
//   1. Post-mortems: "why did run X fail at turn 40" without
//      reproducing it.
//   2. failureStats(): aggregate failure reasons across recent
//      runs so regressions show up as hot keys.
// Design contract:
//   - NEVER throws, NEVER logs, NEVER blocks the agent loop.
//     All writes are async fire-and-forget on an ordered chain;
//     any IO error is swallowed (tracing must never take the
//     agent down — it is instrumentation, not a feature).
//   - One JSON object per line. First line = header
//     {v:1, sessionId, workspace, task, startedAt, appVersion}.
//   - Files land in <userData>/traces/<YYYY-MM-DD>/trace-<sessionId>-<ts>.jsonl
//     (falls back to os.tmpdir()/surnia-traces outside Electron).
//   - Files are capped at 5 MB: when the cap is hit the recorder
//     stops appending and writes a footer line.
// ============================================================
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ------------------------------------------------------------
// Public types
// ------------------------------------------------------------

export interface TraceStep {
  /** Milliseconds since the run started (caller-supplied clock). */
  t: number;
  kind: 'turn' | 'tool_call' | 'tool_result' | 'compaction' | 'error' | 'final';
  /** Tool name / event short name for this step. */
  name?: string;
  /** Truncated preview of the call arguments (caller trims). */
  argsPreview?: string;
  /** Success flag for tool_result / final steps. */
  ok?: boolean;
  /** Size marker (e.g. transcript chars at compaction time). */
  chars?: number;
  /** Exit code for shell-ish tool results. */
  exitCode?: number;
  /** Free-form short note. */
  note?: string;
}

export interface TraceFinishResult {
  ok: boolean;
  failure?: string;
  turns: number;
  tools: number;
}

export interface FailureStats {
  total: number;
  failures: number;
  byFailure: Record<string, number>;
}

// ------------------------------------------------------------
// Environment resolution (Electron optional)
// ------------------------------------------------------------

interface ElectronAppLike {
  getPath?: (key: string) => string;
  getVersion?: () => string;
}

/**
 * Resolves the Electron app lazily via require so pure-Node contexts
 * (CLI, eval harness, unit tests) never crash on a static import.
 */
function electronApp(): ElectronAppLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as { app?: ElectronAppLike };
    return electron?.app ?? null;
  } catch {
    return null; // not running inside Electron
  }
}

function resolveUserData(): string {
  try {
    const p = electronApp()?.getPath?.('userData');
    if (p && typeof p === 'string') return p;
  } catch {
    /* fall through to tmp */
  }
  return path.join(os.tmpdir(), 'surnia-traces');
}

let cachedAppVersion: string | null = null;
function appVersion(): string {
  if (cachedAppVersion !== null) return cachedAppVersion;
  try {
    cachedAppVersion = electronApp()?.getVersion?.() || 'unknown';
  } catch {
    cachedAppVersion = 'unknown';
  }
  return cachedAppVersion;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function dateStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function safeName(s: string): string {
  const cleaned = (s || 'session').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
  return cleaned || 'session';
}

// ------------------------------------------------------------
// TraceRecorder
// ------------------------------------------------------------

const TRACE_CAP_BYTES = 5 * 1024 * 1024;

export class TraceRecorder {
  private readonly file: string | null;
  private bytes = 0;
  private finished = false;
  private footerWritten = false;
  /** Ordered write chain: preserves header→step→footer order despite fire-and-forget. */
  private chain: Promise<void> = Promise.resolve();

  constructor(sessionId: string, workspace: string, task: string) {
    let file: string | null = null;
    try {
      const startedAt = Date.now();
      const dir = path.join(resolveUserData(), 'traces', dateStamp(startedAt));
      const f = path.join(dir, `trace-${safeName(sessionId)}-${startedAt}.jsonl`);
      const header = JSON.stringify({
        v: 1,
        sessionId,
        workspace,
        task,
        startedAt,
        appVersion: appVersion(),
      });
      this.bytes = Buffer.byteLength(header, 'utf8') + 1;
      this.enqueue(async () => {
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(f, header + '\n', 'utf8');
      });
      file = f;
    } catch {
      file = null; // tracing stays disabled for this run — never propagate
    }
    this.file = file;
  }

  /** Absolute path of the trace file, or null when tracing is unavailable. */
  path(): string | null {
    return this.file;
  }

  /** Append one step. Fire-and-forget; never throws; ignores steps after finish/cap. */
  step(s: TraceStep): void {
    if (this.finished || !this.file) return;
    try {
      const line = JSON.stringify({
        t: s.t,
        kind: s.kind,
        ...(s.name !== undefined ? { name: s.name } : {}),
        ...(s.argsPreview !== undefined ? { argsPreview: s.argsPreview } : {}),
        ...(s.ok !== undefined ? { ok: s.ok } : {}),
        ...(s.chars !== undefined ? { chars: s.chars } : {}),
        ...(s.exitCode !== undefined ? { exitCode: s.exitCode } : {}),
        ...(s.note !== undefined ? { note: s.note } : {}),
      });
      const cost = Buffer.byteLength(line, 'utf8') + 1;
      if (this.bytes + cost > TRACE_CAP_BYTES) {
        // Cap reached: stop appending, add a footer line, ignore everything after.
        this.finished = true;
        this.writeFooter({ type: 'footer', reason: 'size_cap', bytes: this.bytes, at: Date.now() });
        return;
      }
      this.bytes += cost;
      const f = this.file;
      this.enqueue(async () => {
        await fs.promises.appendFile(f, line + '\n', 'utf8');
      });
    } catch {
      /* silent — instrumentation must never throw */
    }
  }

  /** Close the trace with a final footer. Idempotent; never throws. */
  finish(result: TraceFinishResult): void {
    if (this.finished || this.footerWritten) return; // capped runs already carry a footer
    this.finished = true;
    this.writeFooter({
      type: 'footer',
      ok: !!result.ok,
      ...(result.failure ? { failure: String(result.failure).slice(0, 500) } : {}),
      turns: result.turns,
      tools: result.tools,
      finishedAt: Date.now(),
    });
  }

  /**
   * Await all pending writes (graceful shutdown / tests only — the
   * agent loop never needs this). Never rejects.
   */
  async flush(): Promise<void> {
    try {
      await this.chain;
    } catch {
      /* silent */
    }
  }

  private writeFooter(footer: Record<string, unknown>): void {
    if (this.footerWritten || !this.file) return;
    this.footerWritten = true;
    try {
      const line = JSON.stringify(footer);
      const f = this.file;
      this.enqueue(async () => {
        await fs.promises.appendFile(f, line + '\n', 'utf8');
      });
    } catch {
      /* silent */
    }
  }

  private enqueue(job: () => Promise<void>): void {
    this.chain = this.chain.then(job).catch(() => undefined);
  }
}

// ------------------------------------------------------------
// failureStats — aggregate recent run outcomes
// ------------------------------------------------------------

const TAIL_SCAN_BYTES = 16 * 1024;

/** Read the last `maxBytes` of a file (footer lives at the end). Returns '' on any error. */
function readTail(file: string, maxBytes: number): string {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    if (len <= 0) return '';
    const buf = Buffer.alloc(len);
    const got = fs.readSync(fd, buf, 0, len, start);
    return buf.toString('utf8', 0, got);
  } catch {
    return '';
  } finally {
    try {
      if (fd !== null) fs.closeSync(fd);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Parse the trailing footer of a trace file. The footer (when present)
 * is the last complete JSON line; a torn final line (crash mid-write)
 * is skipped and the scan continues upwards. Returns null when absent.
 */
function parseFooter(tail: string): { ok?: boolean; failure?: string } | null {
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    try {
      const obj = JSON.parse(l) as { type?: string; ok?: boolean; failure?: string };
      if (obj && obj.type === 'footer') return obj;
      return null; // last complete line is not the footer → no footer was written
    } catch {
      /* torn line — keep scanning upwards */
    }
  }
  return null;
}

/**
 * Aggregate finish.failure reasons across the last `limitDays` days of
 * traces. Pure filesystem scan; NEVER throws (missing dirs / unreadable
 * files are simply skipped). `total` counts trace files seen; `failures`
 * counts runs whose footer says ok:false; `byFailure` buckets the
 * (truncated) failure reason strings.
 */
export function failureStats(limitDays = 30): FailureStats {
  const stats: FailureStats = { total: 0, failures: 0, byFailure: {} };
  try {
    const days = Math.max(1, Math.min(366, Math.floor(limitDays) || 30));
    const root = path.join(resolveUserData(), 'traces');
    const now = Date.now();
    for (let i = 0; i < days; i++) {
      const dir = path.join(root, dateStamp(now - i * 86_400_000));
      let entries: string[];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        continue; // no traces for this day
      }
      for (const name of entries) {
        if (!name.startsWith('trace-') || !name.endsWith('.jsonl')) continue;
        stats.total++;
        try {
          const footer = parseFooter(readTail(path.join(dir, name), TAIL_SCAN_BYTES));
          if (footer && footer.ok === false && footer.failure) {
            stats.failures++;
            const key = String(footer.failure).split('\n')[0].trim().slice(0, 120) || 'unknown';
            stats.byFailure[key] = (stats.byFailure[key] ?? 0) + 1;
          }
        } catch {
          /* unreadable trace — skip */
        }
      }
    }
  } catch {
    /* never throw */
  }
  return stats;
}
