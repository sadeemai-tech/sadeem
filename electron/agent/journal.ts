// ============================================================
// Surnia — crash-resilient RUN JOURNAL (v9)
// ------------------------------------------------------------
// The journal is the hours-long-run safety net: every turn / tool
// outcome is APPENDED to disk the moment it happens, so a kill /
// crash / power loss never loses the progress trail. Traces are
// rich but buffered; the journal is dumb, synchronous and durable:
//
//   - One JSON object per line, first line = header
//     {type:'run', at, task, workspace, sessionId}.
//   - Files land in <userData>/journals/<YYYY-MM-DD>/<sessionId>.jsonl
//     (falls back to os.tmpdir()/surnia-journals outside Electron).
//   - v11.11 (A4) ANTI-FREEZE: event writes are ASYNC + DEBOUNCED (queue +
//     chained fs.promises writer, ≤120ms flush latency) — the streaming hot
//     path NEVER blocks on disk. Ordering per file is preserved; a hard kill
//     may lose the last ≤120ms of lines and torn lines are expected after a
//     kill and simply skipped by the readers.
//   - NEVER throws, NEVER logs. A journal that cannot be written
//     is silently disabled for that run (startRunJournal → '').
//
// Readers are bounded: listJournals reads at most 64KB per file
// (header + line count) plus a tiny tail for the outcome line;
// readJournal reads a bounded tail window for the last N events.
// ============================================================
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ------------------------------------------------------------
// Public types
// ------------------------------------------------------------

/** One journal summary row (kdx:journal:list — newest first). */
export interface JournalSummary {
  file: string;
  sessionId: string;
  task: string;
  at: number;
  /** 'completed' | 'aborted' | … when a finish line exists (crashed runs have none). */
  outcome?: string;
  /** Line count after the header (lower bound for files above the 64KB read cap). */
  events: number;
}

// ------------------------------------------------------------
// Module-level current journal
// ------------------------------------------------------------

/** The most recently started journal file (startRunJournal sets it, finishRunJournal clears it). */
let currentFile: string | null = null;

/** The journal opened by the latest startRunJournal that succeeded (null when none). */
export function currentJournalFile(): string | null {
  return currentFile;
}

// ------------------------------------------------------------
// Environment resolution (Electron optional — CLI has no app)
// ------------------------------------------------------------

function fallbackUserData(): string {
  return path.join(os.tmpdir(), 'surnia-journals');
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function dateStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function safeName(s: string): string {
  const cleaned = (s || 'session').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
  return cleaned || 'session';
}

// ------------------------------------------------------------
// Writers — append-ordered, ASYNC + DEBOUNCED, never throw
// ------------------------------------------------------------
// v11.11 (A4) ANTI-FREEZE: journalEvent used to writeFileSync PER EVENT — a
// synchronous disk write on the streaming hot path (every tool outcome, every
// continue round). Under disk pressure (AV scanners, network drives, busy
// CI disks) each write stalled the main-process event loop and the live
// stream visibly stuttered — the founder's "بتعلق كثير كثير". Now events
// land in a per-file queue flushed by a CHAINED ASYNC writer: debounced at
// JOURNAL_FLUSH_MS, or immediately once JOURNAL_FLUSH_MAX_PENDING lines are
// queued (whichever comes first). Per-file ordering is preserved and writes
// never overlap (one chained promise per file). A hard kill can lose at most
// the last ~120ms of journal lines — the parallel JSONL trace keeps the full
// picture — an honest trade for a freeze-free stream.
//   - journalEvent / finishRunJournal NEVER block the caller on disk.
//   - flushJournal() awaits the queue (tests / graceful shutdown only).

const JOURNAL_FLUSH_MS = 120;
const JOURNAL_FLUSH_MAX_PENDING = 24;
/** Hard memory cap: beyond this many queued lines the flush becomes immediate. */
const JOURNAL_PENDING_HARD_CAP = 2000;

interface JournalQueue {
  pending: string[];
  timer: NodeJS.Timeout | null;
  /** Ordered write chain — preserves header → events → finish despite async. */
  chain: Promise<void>;
}

const journalQueues = new Map<string, JournalQueue>();

function queueFor(file: string): JournalQueue {
  let q = journalQueues.get(file);
  if (!q) {
    q = { pending: [], timer: null, chain: Promise.resolve() };
    journalQueues.set(file, q);
  }
  return q;
}

/** One async append of a batch of lines (single write syscall per batch). */
function journalAppendBatch(file: string, lines: string[]): Promise<void> {
  return fs.promises.appendFile(file, lines.join(''), { encoding: 'utf8', mode: 0o600 });
}

/** Drain the current queue into the write chain (immediate or debounced). */
function scheduleJournalFlush(file: string, delayMs: number): void {
  const q = queueFor(file);
  if (delayMs <= 0 || q.pending.length >= JOURNAL_PENDING_HARD_CAP) {
    // immediate: swap out the pending lines and append them via the chain
    if (q.timer) {
      clearTimeout(q.timer);
      q.timer = null;
    }
    if (!q.pending.length) return;
    const lines = q.pending;
    q.pending = [];
    q.chain = q.chain.then(() => journalAppendBatch(file, lines)).catch(() => {
      /* a torn/failed tail is acceptable — the journal must never take the run down */
    });
    return;
  }
  if (!q.timer) {
    const t = setTimeout(() => scheduleJournalFlush(file, 0), delayMs);
    try {
      t.unref?.();
    } catch {
      /* timers without unref are fine */
    }
    q.timer = t;
  }
}

/**
 * Open a new run journal at <userDataDir>/journals/<date>/<sessionId>.jsonl
 * and write the header line (synchronous — once per run, before any
 * streaming starts). Returns the file path, or '' when journaling
 * is unavailable (the callers treat ''/null as "no journal" and skip).
 */
export function startRunJournal(sessionId: string, task: string, workspace: string, userDataDir: string): string {
  try {
    const at = Date.now();
    const dir = path.join(userDataDir || fallbackUserData(), 'journals', dateStamp(at));
    const file = path.join(dir, `${safeName(sessionId)}.jsonl`);
    fs.mkdirSync(dir, { recursive: true });
    const header = JSON.stringify({
      type: 'run',
      at,
      task: String(task ?? '').slice(0, 400),
      workspace: String(workspace ?? ''),
      sessionId: String(sessionId ?? ''),
    });
    fs.writeFileSync(file, header + '\n', { encoding: 'utf8', flag: 'a', mode: 0o600 });
    currentFile = file;
    return file;
  } catch {
    currentFile = null;
    return ''; // journaling stays disabled for this run — never propagate
  }
}

/**
 * Append one journal event as {at, ...ev}. NON-BLOCKING (v11.11 A4): the
 * line is queued and written by the async chain — the caller never waits on
 * disk. null/'' file → no-op. Never throws.
 */
export function journalEvent(file: string | null, ev: Record<string, unknown>): void {
  try {
    if (!file) return;
    const line = JSON.stringify({ at: Date.now(), ...ev }) + '\n';
    const q = queueFor(file);
    q.pending.push(line);
    if (q.pending.length >= JOURNAL_FLUSH_MAX_PENDING) scheduleJournalFlush(file, 0);
    else scheduleJournalFlush(file, JOURNAL_FLUSH_MS);
  } catch {
    /* silent — the journal must never take the run down */
  }
}

/**
 * v11.15 — append a STRUCTURED memory fact to the journal. The durable
 * journal is the crash-safe intake for the cumulative memory_snapshot: the
 * engine can record a decision / touched file / preference / next step the
 * moment it happens, and memory.ts replays it after a restart or compaction
 * (it reads events of type `memory_snapshot`). Advisory, non-blocking, never
 * throws — same guarantees as journalEvent.
 */
export function journalMemoryFact(
  file: string | null,
  facts: {
    decisions?: string[];
    filesTouched?: string[];
    preferences?: string[];
    pendingSteps?: string[];
    sessionId?: string;
  },
): void {
  try {
    if (!file) return;
    // v11.19 — raised 16 → 256 per event so a whole batch of facts (e.g. 40
    // decisions across two compactions) reaches the durable journal intact;
    // memory.ts stores up to MAX_STORED_FACTS (1024) and never drops old facts.
    const clean = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((s) => s.slice(0, 220)).slice(0, 256)
        : [];
    journalEvent(file, {
      type: 'memory_snapshot',
      ...(facts?.sessionId ? { sessionId: String(facts.sessionId).slice(0, 80) } : {}),
      ...(clean(facts?.decisions).length ? { decisions: clean(facts.decisions) } : {}),
      ...(clean(facts?.filesTouched).length ? { filesTouched: clean(facts.filesTouched) } : {}),
      ...(clean(facts?.preferences).length ? { preferences: clean(facts.preferences) } : {}),
      ...(clean(facts?.pendingSteps).length ? { pendingSteps: clean(facts.pendingSteps) } : {}),
    });
  } catch {
    /* silent — journaling must never take the run down */
  }
}

/**
 * Await every pending journal write for a file (drain the queue first).
 * Tests / graceful shutdown only — the agent loop never needs this.
 * Never rejects.
 */
export async function flushJournal(file: string | null): Promise<void> {
  try {
    if (!file) return;
    scheduleJournalFlush(file, 0);
    const q = journalQueues.get(file);
    if (q) await q.chain;
  } catch {
    /* silent */
  }
}

/** Diagnostics: lines queued but not yet on disk for a journal file. */
export function journalPendingLines(file: string | null): number {
  const q = file ? journalQueues.get(file) : undefined;
  return q ? q.pending.length : 0;
}

/**
 * Close a journal with a final {type:'finish', outcome, summary} line and
 * clear the module-level current file. The finish line is queued AFTER any
 * pending events (order preserved) and flushed immediately through the async
 * chain. Idempotent-safe; never throws; never blocks on disk.
 */
export function finishRunJournal(file: string | null, outcome: string, summary?: string): void {
  try {
    if (file) {
      const line =
        JSON.stringify({
          type: 'finish',
          at: Date.now(),
          outcome: String(outcome ?? 'unknown'),
          ...(summary !== undefined ? { summary: String(summary).slice(0, 600) } : {}),
        }) + '\n';
      const q = queueFor(file);
      q.pending.push(line);
      scheduleJournalFlush(file, 0);
    }
  } catch {
    /* silent */
  }
  if (!file || currentFile === file) currentFile = null;
}

// ------------------------------------------------------------
// Bounded readers
// ------------------------------------------------------------

const HEAD_READ_BYTES = 64 * 1024;
const TAIL_OUTCOME_BYTES = 4 * 1024;
const TAIL_READ_BYTES = 512 * 1024;

/** Read up to `maxBytes` from the START of a file. Returns null on any error. */
function readHead(file: string, maxBytes: number): { text: string; size: number } | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    if (len <= 0) return { text: '', size };
    const buf = Buffer.alloc(len);
    const got = fs.readSync(fd, buf, 0, len, 0);
    return { text: buf.toString('utf8', 0, got), size };
  } catch {
    return null;
  } finally {
    try {
      if (fd !== null) fs.closeSync(fd);
    } catch {
      /* ignore */
    }
  }
}

/** Read the last `maxBytes` of a file. Returns '' on any error. */
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

interface RunHeader {
  at?: number;
  task?: string;
  workspace?: string;
  sessionId?: string;
}

/** Parse the first complete JSON line of the buffer as a run header. */
function parseHeader(headText: string): RunHeader | null {
  const nl = headText.indexOf('\n');
  if (nl === -1) return null;
  try {
    const obj = JSON.parse(headText.slice(0, nl)) as RunHeader;
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

/** Scan a tail window backwards for the last parseable finish line. */
function parseOutcome(tail: string): string | undefined {
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l) continue;
    try {
      const obj = JSON.parse(l) as { type?: string; outcome?: string };
      if (obj && obj.type === 'finish') return typeof obj.outcome === 'string' ? obj.outcome : undefined;
      return undefined; // last complete line is not the finish → no finish written
    } catch {
      /* torn line after a hard kill — keep scanning upwards */
    }
  }
  return undefined;
}

/** Bounded per-file summary: header line + line count (≤64KB) + tiny outcome tail. */
function readJournalSummary(file: string): JournalSummary | null {
  try {
    const head = readHead(file, HEAD_READ_BYTES);
    if (!head) return null;
    const header = parseHeader(head.text);
    const lines = head.text.split('\n');
    // complete lines in the window; when the window covers the whole file a
    // torn trailing line (hard kill mid-write) still counts as one event
    let lineCount = lines.length - 1; // split always yields one extra chunk
    if (lineCount < 0) lineCount = 0;
    if (!head.text.endsWith('\n') && head.text.trim()) lineCount += 1;
    const events = Math.max(0, lineCount - 1); // minus the header line
    const outcome = parseOutcome(readTail(file, TAIL_OUTCOME_BYTES));
    return {
      file,
      sessionId: String(header?.sessionId ?? path.basename(file, '.jsonl')),
      task: String(header?.task ?? ''),
      at: typeof header?.at === 'number' ? header.at : 0,
      ...(outcome !== undefined ? { outcome } : {}),
      events,
    };
  } catch {
    return null;
  }
}

/**
 * Newest-first list of run journals under <userDataDir>/journals.
 * Bounded: each file read is capped (64KB head + 4KB outcome tail), and the
 * directory walk stops once enough candidates are collected. Never throws.
 */
export function listJournals(userDataDir: string, limit = 20): JournalSummary[] {
  const out: JournalSummary[] = [];
  try {
    const cap = Math.max(1, Math.min(200, Math.floor(limit) || 20));
    const root = path.join(userDataDir || fallbackUserData(), 'journals');
    let dayDirs: string[] = [];
    try {
      dayDirs = fs
        .readdirSync(root)
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort()
        .reverse();
    } catch {
      return out; // no journals yet
    }
    for (const day of dayDirs) {
      if (out.length >= cap * 3) break; // enough candidates for a global newest-first sort
      let names: string[] = [];
      try {
        names = fs.readdirSync(path.join(root, day));
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith('.jsonl')) continue;
        const s = readJournalSummary(path.join(root, day, name));
        if (s) out.push(s);
      }
    }
    out.sort((a, b) => (b.at || 0) - (a.at || 0));
    return out.slice(0, cap);
  } catch {
    return out;
  }
}

/**
 * The last `maxLines` journal events (parsed JSON objects). Torn lines from a
 * hard kill are skipped; the read is bounded to a 512KB tail window. Never throws.
 */
export function readJournal(file: string, maxLines = 200): Array<Record<string, unknown>> {
  try {
    const cap = Math.max(1, Math.min(1000, Math.floor(maxLines) || 200));
    const tail = readTail(file, TAIL_READ_BYTES);
    const lines = tail
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const out: Array<Record<string, unknown>> = [];
    for (let i = Math.max(0, lines.length - cap); i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) continue;
      try {
        const obj = JSON.parse(l) as unknown;
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) out.push(obj as Record<string, unknown>);
      } catch {
        /* torn line — skip */
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ============================================================
// v11.11 (A8 security fix) — journal path jail.
// `kdx:journal:read` hands a renderer-supplied path straight to
// readJournal(), which reads ANY file on disk. The renderer round-trips
// `JournalSummary.file` (an absolute path under <userData>/journals), so the
// IPC layer resolves the supplied path against THAT root and refuses
// anything else — traversal, absolute escapes and non-journal files.
// Exported pure (no electron import) so the audit tests can drive it.
// ============================================================

/** True when `file` resolves to a .jsonl journal INSIDE `<userData>/journals`. */
export function isJournalFileAllowed(file: unknown, userDataDir: string): boolean {
  if (typeof file !== 'string' || !file.trim() || !userDataDir) return false;
  const root = path.join(userDataDir, 'journals');
  const resolved = path.resolve(file.trim());
  if (path.extname(resolved).toLowerCase() !== '.jsonl') return false;
  const rel = path.relative(root, resolved);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
