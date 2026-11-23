// electron/agent/testRecord.ts
var MAX_RUNS = 200;
function normTestCommand(cmd) {
  return String(cmd ?? "").replace(/^cd\s+\S+\s*&&\s*/i, "").replace(/\s+/g, " ").trim().toLowerCase();
}
function parseJestFiles(output) {
  const passed = [];
  const failed = [];
  for (const m of output.matchAll(/^\s*(PASS|FAIL)\s+([\w./\\-]+\.(?:test|spec)\.[cm]?[jt]sx?)\b/gim)) {
    (m[1].toUpperCase() === "PASS" ? passed : failed).push(m[2].replace(/\\/g, "/"));
  }
  return { passed, failed };
}
function parsePytestIds(output) {
  const passed = [];
  const failed = [];
  for (const m of output.matchAll(/^\s*(PASSED|FAILED|ERROR)\s+([\w./\\:-]+::[\w:]+)\b/gim)) {
    (m[1].toUpperCase() === "PASSED" ? passed : failed).push(m[2].replace(/\\/g, "/"));
  }
  return { passed, failed };
}
function parseCheckMarks(output) {
  const passed = [];
  const failed = [];
  for (const line of output.split("\n")) {
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
function hasSummarySignals(output) {
  return /\b\d+\s+(?:passing|failing|passed|failed)\b/i.test(output) || /\bTests:\s*\d+/i.test(output);
}
function parseTestOutput(output) {
  const out = String(output ?? "");
  const jest = parseJestFiles(out);
  const py = parsePytestIds(out);
  const marks = parseCheckMarks(out);
  const passed = [.../* @__PURE__ */ new Set([...jest.passed, ...py.passed, ...marks.passed])];
  const failed = [.../* @__PURE__ */ new Set([...jest.failed, ...py.failed, ...marks.failed])];
  const parseable = passed.length > 0 || failed.length > 0 || hasSummarySignals(out);
  return { passed, failed, parseable };
}
var TestRecord = class {
  runs = [];
  /** Record one executed test run. Returns the stored record. */
  record(input) {
    const at = input.at ?? Date.now();
    const rec = {
      phase: input.phase,
      command: input.command,
      normCommand: normTestCommand(input.command),
      exitCode: input.exitCode,
      at,
      durationMs: Math.max(0, Math.round(input.durationMs ?? 0)),
      outputTail: String(input.output ?? "").slice(-2e3),
      ...parseTestOutput(input.output ?? "")
    };
    this.runs.push(rec);
    if (this.runs.length > MAX_RUNS) this.runs.shift();
    return rec;
  }
  all() {
    return [...this.runs];
  }
  /** All runs of one normalized command, oldest first. */
  forCommand(cmd) {
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
  redGreenCompliant(cmd) {
    const relevant = cmd ? this.forCommand(cmd) : this.runs;
    const order = new Map(relevant.map((r, i) => [r, i]));
    const green = relevant.filter((r) => r.exitCode === 0);
    const red = relevant.filter((r) => r.exitCode !== 0);
    if (!green.length) {
      return { compliant: false, reason: "no passing test run was recorded by the harness" };
    }
    const firstGreen = green[0];
    const firstGreenPos = order.get(firstGreen) ?? 0;
    const redBeforeGreen = red.find((r) => (order.get(r) ?? Number.MAX_SAFE_INTEGER) < firstGreenPos);
    if (!redBeforeGreen) {
      return {
        compliant: false,
        reason: `the first recorded run of "${firstGreen.command.slice(0, 120)}" already PASSED \u2014 no failing (red) run came before it, so the bug was never shown to reproduce`
      };
    }
    return {
      compliant: true,
      reason: `red run (exit ${redBeforeGreen.exitCode}, ${new Date(redBeforeGreen.at).toISOString()}) precedes green run (${new Date(firstGreen.at).toISOString()})`,
      redAt: redBeforeGreen.at,
      greenAt: firstGreen.at
    };
  }
  /**
   * Regression detection: tests/files that PASSED in an earlier full run of
   * the command and FAIL in the latest run. Unparseable output → empty list
   * with `unknown` (no regression detected is NOT the same as none).
   */
  regressions(cmd) {
    const relevant = cmd ? this.forCommand(cmd) : this.runs;
    const full = relevant.filter((r) => r.phase === "before" || r.phase === "after" || r.phase === "verify");
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
  everGreen(cmd) {
    return (cmd ? this.forCommand(cmd) : this.runs).some((r) => r.exitCode === 0);
  }
  /** Compact evidence block for prompts / proof packages. */
  summary() {
    if (!this.runs.length) return "no test runs recorded";
    const parts = this.runs.slice(-6).map((r) => `[${r.phase}] "${r.command.slice(0, 90)}" \u2192 exit ${r.exitCode}${r.failed.length ? `, failed: ${r.failed.slice(0, 4).join(", ")}` : ""}`);
    return parts.join(" | ");
  }
};
var falseDoneLedger = [];
var MAX_LEDGER = 500;
var MAX_PERSISTED = 2e3;
var falseDoneStoreDir = null;
var falseDoneStoreLoaded = false;
var falseDoneFlushTimer = null;
async function falseDoneLoad(dir) {
  try {
    const { promises: fs } = await import("node:fs");
    const path = await import("node:path");
    const raw = JSON.parse(await fs.readFile(path.join(dir, "false-done.json"), "utf8"));
    if (Array.isArray(raw)) {
      falseDoneLedger.length = 0;
      for (const e of raw.slice(-MAX_LEDGER)) {
        if (e && typeof e === "object" && typeof e.claimedSuccess === "boolean") {
          falseDoneLedger.push({
            runId: String(e.runId ?? ""),
            at: Number(e.at ?? 0),
            claimedSuccess: !!e.claimedSuccess,
            gateVerdict: String(e.gateVerdict ?? "unproven"),
            falseDone: !!e.falseDone
          });
        }
      }
    }
  } catch {
  }
}
function falseDoneScheduleFlush() {
  if (!falseDoneStoreDir) return;
  if (falseDoneFlushTimer) clearTimeout(falseDoneFlushTimer);
  falseDoneFlushTimer = setTimeout(() => {
    falseDoneFlushTimer = null;
    void falseDoneFlushNow();
  }, 800);
}
async function falseDoneFlushNow() {
  const dir = falseDoneStoreDir;
  if (!dir) return;
  try {
    const { promises: fs } = await import("node:fs");
    const path = await import("node:path");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "false-done.json"), JSON.stringify(falseDoneLedger.slice(-MAX_PERSISTED), null, 2), "utf8");
  } catch {
  }
}
async function setFalseDoneStore(dir) {
  if (falseDoneStoreLoaded && falseDoneStoreDir === dir) return;
  falseDoneStoreDir = dir;
  if (!falseDoneStoreLoaded) {
    falseDoneStoreLoaded = true;
    await falseDoneLoad(dir);
  }
}
function recordFalseDone(entry) {
  falseDoneLedger.push({
    ...entry,
    falseDone: entry.claimedSuccess && (entry.gateVerdict === "failed" || entry.gateVerdict === "unproven")
  });
  if (falseDoneLedger.length > MAX_LEDGER) falseDoneLedger.shift();
  falseDoneScheduleFlush();
}
function falseDoneStats() {
  const claimed = falseDoneLedger.filter((e) => e.claimedSuccess);
  const falseDone = claimed.filter((e) => e.falseDone);
  return {
    claimed: claimed.length,
    falseDone: falseDone.length,
    rate: claimed.length ? falseDone.length / claimed.length : 0,
    recent: falseDoneLedger.slice(-10)
  };
}
function resetFalseDoneLedgerForTests() {
  falseDoneLedger.length = 0;
  falseDoneStoreLoaded = false;
  falseDoneStoreDir = null;
  if (falseDoneFlushTimer) {
    clearTimeout(falseDoneFlushTimer);
    falseDoneFlushTimer = null;
  }
}
export {
  TestRecord,
  falseDoneStats,
  normTestCommand,
  parseTestOutput,
  recordFalseDone,
  resetFalseDoneLedgerForTests,
  setFalseDoneStore
};
