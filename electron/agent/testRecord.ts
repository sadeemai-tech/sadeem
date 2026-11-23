// ============================================================
// Surnia v7.1 — TEST RECORD: red→green ENFORCED by the harness.
// v7.0 shipped a directive ("show the failing run first") plus a
// message parser. A model can satisfy both without ever running a
// test. This module makes the HARNESS the source of truth:
//
//   • Every test command the run executes is recorded here with its
//     phase (before / red / green / after), exit code and parsed
//     per-test results (jest/vitest PASS/FAIL files, pytest test ids,
//     node:test ✔/✖ lines, mocha ✔/✗).
//   • redGreenCompliant(): a red run (exit ≠ 0) for the same
//     normalized command must exist EARLIER than a green run
//     (exit = 0). The model's prose is irrelevant.
//   • regressions(): per-test results are diffed between the first
//     'before' full-suite run and the last 'after' run — anything
//     that passed before and fails after is a REGRESSION, returned
//     by name so the engine can reject the fix outright.
//   • falseDone(): for the False-Done Rate metric — claimedSuccess +
//     gateVerdict pairs recorded per run.
// Pure module state per run instance; no globals, no IO.
// ============================================================

export type TestPhase = 'before' | 'after' | 'red' | 'green' | 'mutation' | 'verify';

export interface TestRunRecord {
  phase: TestPhase;
  command: string;
  normCommand: string;
  exitCode: number;
  at: number; // epoch ms
  durationMs: number;
  outputTail: string;
  /** Best-effort parsed results. */
  failed: string[]; // test ids / files that failed
  passed: string[]; // test ids / files that passed
  parseable: boolean;
}

export interface RedGreenVerdict {
  compliant: boolean;
  reason: string;
  redAt?: number;
  greenAt?: number;
}

export interface FalseDoneEntry {
  runId: string;
  at: number;
  claimedSuccess: boolean;
  /** Proof verdict at record time. String-typed so future verdict values
   *  never silently break the ledger (v8.1). */
  gateVerdict: 'proven' | 'partial' | 'unproven' | 'failed' | 'aborted' | string;
  falseDone: boolean; // claimed success AND gates say otherwise
}

const MAX_RUNS = 200;

/** Normalize a test command for comparison: collapse whitespace, strip cd prefixes. */
export function normTestCommand(cmd: string): string {
  return String(cmd ?? '')
    .replace(/^cd\s+\S+\s*&&\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ------------------------------------------------------------
// Output parsers (best-effort, per runner)
// ------------------------------------------------------------

/** jest / vitest: "PASS src/foo.test.ts" / "FAIL src/foo.test.ts". */
function parseJestFiles(output: string): { passed: string[]; failed: string[] } {
  const passed: string[] = [];
  const failed: string[] = [];
  for (const m of output.matchAll(/^\s*(PASS|FAIL)\s+([\w./\\-]+\.(?:test|spec)\.[cm]?[jt]sx?)\b/gim)) {
    (m[1].toUpperCase() === 'PASS' ? passed : failed).push(m[2].replace(/\\/g, '/'));
  }
  return { passed, failed };
}

/** pytest: short summary lines "FAILED tests/test_a.py::test_b" / "PASSED …" / "ERROR …". */
function parsePytestIds(output: string): { passed: string[]; failed: string[] } {
  const passed: string[] = [];
  const failed: string[] = [];
  for (const m of output.matchAll(/^\s*(PASSED|FAILED|ERROR)\s+([\w./\\:-]+::[\w:]+)\b/gim)) {
    (m[1].toUpperCase() === 'PASSED' ? passed : failed).push(m[2].replace(/\\/g, '/'));
  }
  return { passed, failed };
}

/** node:test / mocha: "✔ name" / "✖ name" (with variations). */
function parseCheckMarks(output: string): { passed: string[]; failed: string[] } {
  const passed: string[] = [];
  const failed: string[] = [];
  for (const line of output.split('\n')) {
    const t = line.trim();
    let m = /^[✔✓]\s+(.{2,120}?)(?:\s*\(\d+\s*m?s\))?$/.exec(t);
    if (m) {
      passed.push(m[1].trim());
      continue;
    }
    m = /^[✖✗×]\s+(.{2,120}?)(?:\s*\(\d+\s*m?s\))?$/.exec(t);
    if (m) failed.push(m[1].trim());
  }
  return { passed, failed };
}

/** mocha/jest summary counts — used to decide "parseable". */
function hasSummarySignals(output: string): boolean {
  return /\b\d+\s+(?:passing|failing|passed|failed)\b/i.test(output) || /\bTests:\s*\d+/i.test(output);
}

export function parseTestOutput(output: string): { passed: string[]; failed: string[]; parseable: boolean } {
  const out = String(output ?? '');
  const jest = parseJestFiles(out);
  const py = parsePytestIds(out);
  const marks = parseCheckMarks(out);
  const passed = [...new Set([...jest.passed, ...py.passed, ...marks.passed])];
  const failed = [...new Set([...jest.failed, ...py.failed, ...marks.failed])];
  const parseable = passed.length > 0 || failed.length > 0 || hasSummarySignals(out);
  return { passed, failed, parseable };
}

// ------------------------------------------------------------
// The record
// ------------------------------------------------------------

export class TestRecord {
  private runs: TestRunRecord[] = [];

  /** Record one executed test run. Returns the stored record. */
  record(input: {
    phase: TestPhase;
    command: string;
    exitCode: number;
    output?: string;
    durationMs?: number;
    at?: number;
  }): TestRunRecord {
    const at = input.at ?? Date.now();
    const rec: TestRunRecord = {
      phase: input.phase,
      command: input.command,
      normCommand: normTestCommand(input.command),
      exitCode: input.exitCode,
      at,
      durationMs: Math.max(0, Math.round(input.durationMs ?? 0)),
      outputTail: String(input.output ?? '').slice(-2000),
      ...parseTestOutput(input.output ?? ''),
    };
    this.runs.push(rec);
    if (this.runs.length > MAX_RUNS) this.runs.shift();
    return rec;
  }

  all(): TestRunRecord[] {
    return [...this.runs];
  }

  /** All runs of one normalized command, oldest first. */
  forCommand(cmd: string): TestRunRecord[] {
    const n = normTestCommand(cmd);
    return this.runs.filter((r) => r.normCommand === n);
  }

  /**
   * ENFORCED red→green: for the given command (or any command when none
   * given), a failing run must exist earlier than a passing run. Ordering is
   * by LEDGER POSITION (insertion order) — two runs can share a millisecond,
   * and wall-clock ties must not flip the verdict. Anything ambiguous →
   * non-compliant (honest default).
   */
  redGreenCompliant(cmd?: string): RedGreenVerdict {
    const relevant = cmd ? this.forCommand(cmd) : this.runs;
    const order = new Map<TestRunRecord, number>(relevant.map((r, i) => [r, i]));
    const green = relevant.filter((r) => r.exitCode === 0);
    const red = relevant.filter((r) => r.exitCode !== 0);
    if (!green.length) {
      return { compliant: false, reason: 'no passing test run was recorded by the harness' };
    }
    const firstGreen = green[0];
    const firstGreenPos = order.get(firstGreen) ?? 0;
    const redBeforeGreen = red.find((r) => (order.get(r) ?? Number.MAX_SAFE_INTEGER) < firstGreenPos);
    if (!redBeforeGreen) {
      return {
        compliant: false,
        reason: `the first recorded run of "${firstGreen.command.slice(0, 120)}" already PASSED — no failing (red) run came before it, so the bug was never shown to reproduce`,
      };
    }
    return {
      compliant: true,
      reason: `red run (exit ${redBeforeGreen.exitCode}, ${new Date(redBeforeGreen.at).toISOString()}) precedes green run (${new Date(firstGreen.at).toISOString()})`,
      redAt: redBeforeGreen.at,
      greenAt: firstGreen.at,
    };
  }

  /**
   * Regression detection: tests/files that PASSED in an earlier full run of
   * the command and FAIL in the latest run. Unparseable output → empty list
   * with `unknown` (no regression detected is NOT the same as none).
   */
  regressions(cmd?: string): { tests: string[]; unknown: boolean } {
    const relevant = cmd ? this.forCommand(cmd) : this.runs;
    const full = relevant.filter((r) => r.phase === 'before' || r.phase === 'after' || r.phase === 'verify');
    if (full.length < 2) return { tests: [], unknown: true };
    const first = full[0];
    const last = full[full.length - 1];
    if (!first.parseable || !last.parseable) return { tests: [], unknown: true };
    const passedBefore = new Set(first.passed);
    const failedAfter = new Set(last.failed);
    const tests = [...failedAfter].filter((t) => passedBefore.has(t));
    return { tests, unknown: false };
  }

  /** Did the harness ever see a green run for this run at all? */
  everGreen(cmd?: string): boolean {
    return (cmd ? this.forCommand(cmd) : this.runs).some((r) => r.exitCode === 0);
  }

  /** Compact evidence block for prompts / proof packages. */
  summary(): string {
    if (!this.runs.length) return 'no test runs recorded';
    const parts = this.runs.slice(-6).map((r) => `[${r.phase}] "${r.command.slice(0, 90)}" → exit ${r.exitCode}${r.failed.length ? `, failed: ${r.failed.slice(0, 4).join(', ')}` : ''}`);
    return parts.join(' | ');
  }
}

// ------------------------------------------------------------
// False-Done ledger (static, process-wide — the metric is global)
// v8.1 — PERSISTED: loaded from disk on first use, appended on every
// record, so the metric is a career-long record that survives app
// restarts instead of a per-process counter silently resetting to 0.
// ------------------------------------------------------------

const falseDoneLedger: FalseDoneEntry[] = [];
const MAX_LEDGER = 500;
const MAX_PERSISTED = 2000;

let falseDoneStoreDir: string | null = null;
let falseDoneStoreLoaded = false;
let falseDoneFlushTimer: ReturnType<typeof setTimeout> | null = null;

async function falseDoneLoad(dir: string): Promise<void> {
  try {
    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'false-done.json'), 'utf8')) as FalseDoneEntry[];
    if (Array.isArray(raw)) {
      falseDoneLedger.length = 0;
      for (const e of raw.slice(-MAX_LEDGER)) {
        if (e && typeof e === 'object' && typeof e.claimedSuccess === 'boolean') {
          falseDoneLedger.push({
            runId: String(e.runId ?? ''),
            at: Number(e.at ?? 0),
            claimedSuccess: !!e.claimedSuccess,
            gateVerdict: String(e.gateVerdict ?? 'unproven'),
            falseDone: !!e.falseDone,
          });
        }
      }
    }
  } catch {
    /* first run or unreadable — start empty, never fabricate history */
  }
}

function falseDoneScheduleFlush(): void {
  if (!falseDoneStoreDir) return;
  if (falseDoneFlushTimer) clearTimeout(falseDoneFlushTimer);
  falseDoneFlushTimer = setTimeout(() => {
    falseDoneFlushTimer = null;
    void falseDoneFlushNow();
  }, 800);
}

async function falseDoneFlushNow(): Promise<void> {
  const dir = falseDoneStoreDir;
  if (!dir) return;
  try {
    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'false-done.json'), JSON.stringify(falseDoneLedger.slice(-MAX_PERSISTED), null, 2), 'utf8');
  } catch {
    /* best-effort persistence */
  }
}

/**
 * v8.1 — point the ledger at a disk directory (userData/metrics). Loads any
 * previous history once; later records are appended and flushed (debounced).
 */
export async function setFalseDoneStore(dir: string): Promise<void> {
  if (falseDoneStoreLoaded && falseDoneStoreDir === dir) return;
  falseDoneStoreDir = dir;
  if (!falseDoneStoreLoaded) {
    falseDoneStoreLoaded = true;
    await falseDoneLoad(dir);
  }
}

/** Record one run outcome; `falseDone` is COMPUTED here, not trusted from the caller. */
export function recordFalseDone(entry: Omit<FalseDoneEntry, 'falseDone'>): void {
  falseDoneLedger.push({
    ...entry,
    falseDone: entry.claimedSuccess && (entry.gateVerdict === 'failed' || entry.gateVerdict === 'unproven'),
  });
  if (falseDoneLedger.length > MAX_LEDGER) falseDoneLedger.shift();
  falseDoneScheduleFlush();
}

export interface FalseDoneStats {
  claimed: number; // runs that claimed success
  falseDone: number; // of those, gates disagreed
  rate: number; // falseDone / claimed (0 when claimed === 0)
  recent: FalseDoneEntry[];
}

/**
 * THE metric: False-Done Rate — of all runs where the agent claimed success,
 * the share the proof gates overruled. Published, not hidden.
 */
export function falseDoneStats(): FalseDoneStats {
  const claimed = falseDoneLedger.filter((e) => e.claimedSuccess);
  const falseDone = claimed.filter((e) => e.falseDone);
  return {
    claimed: claimed.length,
    falseDone: falseDone.length,
    rate: claimed.length ? falseDone.length / claimed.length : 0,
    recent: falseDoneLedger.slice(-10),
  };
}

export function resetFalseDoneLedgerForTests(): void {
  falseDoneLedger.length = 0;
  falseDoneStoreLoaded = false;
  falseDoneStoreDir = null;
  if (falseDoneFlushTimer) {
    clearTimeout(falseDoneFlushTimer);
    falseDoneFlushTimer = null;
  }
}
