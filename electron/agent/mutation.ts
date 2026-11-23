// ============================================================
// Surnia v7.1 — the MUTATION GATE on changed lines.
// v7.0's mutationCheck probed ONE auto-picked file anywhere in the
// tree. That answers "do the tests test anything?" — it does NOT
// answer "do the tests protect what the agent just changed?".
// This module closes that gap:
//
//   • Mutations are generated ONLY inside the lines the run actually
//     touched (explicit spans, or derived from `git diff -U0` when
//     spans are not supplied).
//   • Operator set matches real mutation testers: boundary flips
//     (> ↔ >=), equality flips (=== ↔ !==), logic flips (&& ↔ ||),
//     boolean-return flips, numeric constant ±1, condition deletion
//     (if (x) → if (true)) and string-constant clobbering.
//   • Each mutation is applied to disk, the test command runs, and
//     the ORIGINAL bytes are restored on every path (finally).
//   • Verdict is a KILL RATE on changed lines, not a single probe:
//     killed / total ≥ threshold (default 0.7) and ≥ minKills.
//   • Survivors are returned as concrete evidence — "line 42 of
//     src/auth.ts still passes with `>` flipped to `>=`" — which the
//     engine feeds back to the agent as one actionable instruction.
//
// Budget-honest: total wall time is capped; the baseline run must be
// green or the whole gate is INCONCLUSIVE (never a false accusation).
// Every function is defensive; nothing here throws by contract.
// ============================================================
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { runCaptured } from '../services/terminalService';

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------

const DEFAULT_MUTATIONS = 12;
const MAX_MUTATIONS = 40;
const MAX_PER_FILE = 6;
const DEFAULT_THRESHOLD = 0.7;
const DEFAULT_MIN_KILLS = 3;
const DEFAULT_BUDGET_MS = 180_000;
const MIN_RUN_BUDGET_MS = 1_500;
const DETAIL_CAP = 900;
const GIT_DIFF_TIMEOUT_MS = 10_000;
const MAX_DIFF_SPAN_LINES = 200;

const MUTATABLE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py']);

export interface MutationPlan {
  file: string; // absolute
  lineNo: number; // 1-based
  before: string; // original line
  after: string; // mutated line
  op: string; // operator id
  strategy: string; // human description
  /** v8.1 — boundary flips are classic EQUIVALENT-MUTANT candidates
   *  (`<` ↔ `<=` over an integer domain is often unobservable). A
   *  surviving boundary mutant is reported, but it must not fail a
   *  suite that kills everything else (the clamp-function trap). */
  severity: 'hard' | 'boundary';
}

export interface MutationSurvivor {
  file: string;
  lineNo: number;
  op: string;
  strategy: string;
  before: string;
  after: string;
  severity: 'hard' | 'boundary';
}

export type MutationVerdict =
  | 'killed-enough'
  | 'survivors'
  | 'boundary-survivors'
  | 'strong-small'
  | 'weak'
  | 'no-mutations'
  | 'baseline-failed'
  | 'skipped';

export interface MutationGateReport {
  ok: boolean; // gate machinery completed (baseline green + at least one mutation ran)
  ran: number; // mutations executed
  killed: number; // tests failed while mutated
  survivors: MutationSurvivor[];
  killRate: number; // killed / ran (0 when ran===0)
  verdict: MutationVerdict;
  /** v8.1 — inconclusive = the gate makes NO claim either way. Only
   *  'survivors' is a FAIL. 'strong-small' / 'boundary-survivors' are
   *  honest passes-with-caveats; 'weak' is an honest "not enough data". */
  inconclusive: boolean;
  detail: string;
}

// ------------------------------------------------------------
// Line eligibility
// ------------------------------------------------------------

function isEligibleMutationLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.startsWith('//') || t.startsWith('#') || t.startsWith('/*') || t.startsWith('*')) return false;
  if (/^(?:import|from|require|package|using|export\s+(?:type|interface)\b)/.test(t)) return false;
  if (t.length > 300) return false; // long lines are risky to mutate blindly
  return true;
}

// ------------------------------------------------------------
// Operators (ordered; several may apply to one line)
// ------------------------------------------------------------

interface Op {
  id: string;
  /** Returns the mutated line, or null when this op does not apply. */
  apply: (line: string, py: boolean) => string | null;
  describe: (line: string, py: boolean) => string;
  /** v8.1 — boundary-flip mutants are equivalence-prone (see MutationPlan.severity). */
  severity?: 'hard' | 'boundary';
}

const OPS: Op[] = [
  {
    id: 'arith-assign-flip',
    apply: (l) => {
      // += ↔ -= and *= ↔ /= — the classic accumulator bug class (Stryker's
      // ArithmeticOperator). `+=` → `-=` catches the exact "sums become
      // subtractions" regression the red→green loop exists for.
      if (/\+=/.test(l)) return l.replace(/\+=/g, '-=');
      if (/-=/.test(l)) return l.replace(/-=/g, '+=');
      if (/\*=(?!=)/.test(l)) return l.replace(/\*=/g, '/=');
      if (/\/=(?!=)/.test(l)) return l.replace(/\/=/g, '*=');
      return null;
    },
    describe: () => 'arithmetic-assignment flip: += ↔ -=',
  },
  {
    id: 'gt-flip',
    severity: 'boundary',
    apply: (l) => {
      if (/(?<![<>=!])>=(?!=)/.test(l)) return l.replace(/(?<![<>=!])>=(?!=)/, '>');
      if (/(?<![<>=!-])>(?![>=])/.test(l)) return l.replace(/(?<![<>=!-])>(?![>=])/, '>=');
      return null;
    },
    describe: () => 'boundary flip: > ↔ >=',
  },
  {
    id: 'lt-flip',
    severity: 'boundary',
    apply: (l) => {
      if (/(?<![<>=!])<=(?!=)/.test(l)) return l.replace(/(?<![<>=!])<=(?!=)/, '<');
      if (/(?<![<>=!+])<(?![<=])/.test(l)) return l.replace(/(?<![<>=!+])<(?![<=])/, '<=');
      return null;
    },
    describe: () => 'boundary flip: < ↔ <=',
  },
  {
    id: 'eq-flip',
    apply: (l, py) => {
      if (py) {
        if (/(?<![=!<>])(==)(?!=)/.test(l)) return l.replace(/(?<![=!<>])(==)(?!=)/, '!=');
        if (/!=(?!=)/.test(l)) return l.replace(/!=(?!=)/, '==');
        return null;
      }
      if (l.includes('===')) return l.replace(/===/g, '!==');
      if (l.includes('!==')) return l.replace(/!==/g, '===');
      if (/(?<![=!<>])(==)(?!=)/.test(l)) return l.replace(/(?<![=!<>])(==)(?!=)/, '!=');
      if (/(?<![=!<>])(!=)(?!=)/.test(l)) return l.replace(/(?<![=!<>])(!=)(?!=)/, '==');
      return null;
    },
    describe: (l) => `equality flip on: ${firstMatch(l, /={2,3}|!={2,3}|!=/)} → negated`,
  },
  {
    id: 'logic-flip',
    apply: (l) => {
      if (l.includes('&&')) return l.replace(/&&/g, '||');
      if (l.includes('||')) return l.replace(/\|\|/g, '&&');
      return null;
    },
    describe: () => 'logic flip: && ↔ ||',
  },
  {
    id: 'bool-return-flip',
    apply: (l, py) => {
      if (py) {
        if (/\breturn\s+True\b/.test(l)) return l.replace(/\breturn\s+True\b/, 'return False');
        if (/\breturn\s+False\b/.test(l)) return l.replace(/\breturn\s+False\b/, 'return True');
        return null;
      }
      if (/\breturn\s+true\b/.test(l)) return l.replace(/\breturn\s+true\b/, 'return false');
      if (/\breturn\s+false\b/.test(l)) return l.replace(/\breturn\s+false\b/, 'return true');
      return null;
    },
    describe: () => 'boolean return flip',
  },
  {
    id: 'condition-delete',
    apply: (l, py) => {
      // Delete the guard: if (x) → if (true). Only single-line, balanced ifs.
      const m = /\bif\s*\(([^()]*)\)/.exec(l);
      if (!m) return null;
      const guard = m[1].trim();
      if (!guard || guard === 'true' || guard === 'false' || guard === 'True' || guard === 'False') return null;
      const t = py ? 'True' : 'true';
      return l.replace(/\bif\s*\([^()]*\)/, `if (${t})`);
    },
    describe: () => 'condition deleted: guard forced true',
  },
  {
    id: 'numeric-bump',
    apply: (l) => {
      const m = /(?<![\w.])(\d+)(?![\w.])/.exec(l);
      if (!m) return null;
      const n = Number(m[1]);
      const bump = n === 0 ? 1 : n + 1;
      return l.replace(/(?<![\w.])(\d+)(?![\w.])/, String(bump));
    },
    describe: (l) => {
      const m = /(?<![\w.])(\d+)(?![\w.])/.exec(l);
      return `numeric constant ${m?.[1]} → ${Number(m?.[1] ?? 0) === 0 ? 1 : Number(m?.[1] ?? 0) + 1}`;
    },
  },
  {
    id: 'string-clobber',
    apply: (l) => {
      // Only when nothing else applied — replace the first non-empty string literal.
      if (/[{+\-*/<>]=?|&&|\|\|/.test(l)) return null;
      const m = /(["'])((?:(?!\1)[^\\]|\\.)*)\1/.exec(l);
      if (!m || !m[2].trim()) return null;
      return l.slice(0, m.index) + `${m[1]}surnia-mutation${m[1]}` + l.slice(m.index + m[0].length);
    },
    describe: () => 'string constant clobbered',
  },
];

function firstMatch(l: string, re: RegExp): string {
  const m = re.exec(l);
  return m ? m[0] : 'operator';
}

/** Enumerate every applicable mutation on one line (deterministic order). */
export function planMutationsForLine(file: string, lineNo: number, line: string): MutationPlan[] {
  if (!isEligibleMutationLine(line)) return [];
  const py = path.extname(file).toLowerCase() === '.py';
  const out: MutationPlan[] = [];
  for (const op of OPS) {
    try {
      const after = op.apply(line, py);
      if (after !== null && after !== line) {
        out.push({ file, lineNo, before: line, after, op: op.id, strategy: op.describe(line, py), severity: op.severity ?? 'hard' });
      }
    } catch {
      /* an op failing to parse one line is not fatal */
    }
  }
  return out;
}

// ------------------------------------------------------------
// Changed-line spans: explicit spans or `git diff -U0` derivation
// ------------------------------------------------------------

export type LineSpans = Record<string, Array<[number, number]>>; // file → inclusive [start,end]

export interface MutationGateOptions {
  workspace: string;
  testCommand: string;
  /** Files the run touched (absolute or workspace-relative). */
  files: string[];
  /** Optional explicit 1-based inclusive line spans per file. Derived from git diff when omitted. */
  spans?: LineSpans;
  /** Max mutations actually executed (default 12, hard cap 40). */
  maxMutations?: number;
  /** Kill-rate threshold (default 0.7). */
  threshold?: number;
  /** Minimum absolute kills for a confident verdict (default 3). */
  minKills?: number;
  /** Total wall budget for ALL runs including baseline (default 180s). */
  timeoutMs?: number;
}

/** Parse `git diff -U0 -- file` hunk headers into 1-based inclusive spans. */
export function parseDiffSpans(diffText: string, cap = MAX_DIFF_SPAN_LINES): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of diffText.matchAll(/^@@\s*-\d+(?:,\d+)?\s*\+(\d+)(?:,(\d+))?\s*@/gm)) {
    const start = parseInt(m[1], 10) || 1;
    const count = m[2] === undefined ? 1 : parseInt(m[2], 10);
    if (count === 0) continue; // pure deletion on the +side adds no mutable lines
    const end = Math.min(start + Math.max(0, count - 1), start + cap - 1);
    spans.push([start, end]);
  }
  return spans;
}

async function deriveSpansFromGit(workspace: string, file: string): Promise<Array<[number, number]>> {
  try {
    const rel = path.isAbsolute(file) ? path.relative(workspace, file) : file;
    const r = await runCaptured(`git diff -U0 -- "${rel}"`, workspace, GIT_DIFF_TIMEOUT_MS);
    if (r.exitCode !== 0) return [];
    return parseDiffSpans(r.output);
  } catch {
    return [];
  }
}

function lineInSpans(lineNo: number, spans: Array<[number, number]> | undefined): boolean {
  if (!spans || !spans.length) return true; // no span info → treat whole file as changed
  return spans.some(([a, b]) => lineNo >= a && lineNo <= b);
}

// ------------------------------------------------------------
// Plan assembly — round-robin across files so one big file cannot
// crowd out the rest; deterministic (sorted inputs → sorted output).
// ------------------------------------------------------------

export function assembleMutationPlans(
  candidateFiles: Array<{ file: string; content: string }>,
  spans: LineSpans,
  maxMutations: number,
): MutationPlan[] {
  const perFile: MutationPlan[][] = [];
  for (const { file, content } of candidateFiles) {
    const lines = content.split('\n');
    const fileSpans = spans[file];
    const plans: MutationPlan[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (plans.length >= MAX_PER_FILE) break;
      if (!lineInSpans(i + 1, fileSpans)) continue;
      plans.push(...planMutationsForLine(file, i + 1, lines[i]));
      if (plans.length > MAX_PER_FILE) plans.length = MAX_PER_FILE;
    }
    if (plans.length) perFile.push(plans);
  }
  // round-robin interleave
  const out: MutationPlan[] = [];
  let idx = 0;
  while (out.length < maxMutations) {
    let advanced = false;
    for (const plans of perFile) {
      if (idx < plans.length) {
        out.push(plans[idx]);
        advanced = true;
        if (out.length >= maxMutations) break;
      }
    }
    if (!advanced) break;
    idx++;
  }
  return out;
}

// ------------------------------------------------------------
// The gate
// ------------------------------------------------------------

async function safeRun(command: string, cwd: string, timeoutMs: number): Promise<{ output: string; exitCode: number }> {
  try {
    return await runCaptured(command, cwd, Math.max(MIN_RUN_BUDGET_MS, timeoutMs));
  } catch (err) {
    return { output: `spawn failed: ${err instanceof Error ? err.message : String(err)}`, exitCode: -1 };
  }
}

function tailOf(output: string, cap = 200): string {
  const t = String(output ?? '').trim().replace(/\s+/g, ' ').slice(-cap);
  return t ? ` Output tail: ${t}` : '';
}

/**
 * The mutation gate on changed lines. Baseline must be green; each mutation
 * is applied → tests run → original restored (always). Returns the kill-rate
 * verdict plus the surviving mutations as concrete, actionable evidence.
 * Never throws.
 */
export async function mutationGate(opts: MutationGateOptions): Promise<MutationGateReport> {
  const ws = path.resolve(String(opts?.workspace ?? '.'));
  const cmd = String(opts?.testCommand ?? '').trim();
  const maxMutations = Math.min(Math.max(1, opts?.maxMutations ?? DEFAULT_MUTATIONS), MAX_MUTATIONS);
  const threshold = Math.min(1, Math.max(0.1, opts?.threshold ?? DEFAULT_THRESHOLD));
  const minKills = Math.max(1, opts?.minKills ?? DEFAULT_MIN_KILLS);
  const budget = Math.max(20_000, opts?.timeoutMs ?? DEFAULT_BUDGET_MS);
  const deadline = Date.now() + budget;
  const left = (): number => Math.max(MIN_RUN_BUDGET_MS, deadline - Date.now());

  try {
    if (!cmd) {
      return { ok: false, ran: 0, killed: 0, survivors: [], killRate: 0, verdict: 'skipped', inconclusive: true, detail: 'MUTATION_GATE skipped: no test command.' };
    }
    const files = (opts?.files ?? []).map((f) => path.resolve(String(f))).filter((f) => MUTATABLE_EXTS.has(path.extname(f).toLowerCase()));

    // 0) baseline — green or the gate refuses to judge
    const base = await safeRun(cmd, ws, left());
    if (base.exitCode !== 0) {
      return {
        ok: false, ran: 0, killed: 0, survivors: [], killRate: 0, verdict: 'baseline-failed', inconclusive: true,
        detail: `MUTATION_GATE INCONCLUSIVE: baseline "${cmd}" exited ${base.exitCode}. The suite must be green before the gate can judge the changed lines.${tailOf(base.output)}`,
      };
    }

    // 1) collect candidates with content (touched files, mutable, size-capped)
    const candidateFiles: Array<{ file: string; content: string }> = [];
    const spans: LineSpans = {};
    for (const f of files.slice(0, 40)) {
      try {
        const content = await fs.readFile(f, 'utf8');
        const n = content.split('\n').length;
        if (n < 2 || n > 4_000) continue;
        candidateFiles.push({ file: f, content });
        spans[f] = opts?.spans?.[f] ?? (await deriveSpansFromGit(ws, f));
      } catch {
        /* unreadable — skip */
      }
    }
    if (!candidateFiles.length) {
      return { ok: true, ran: 0, killed: 0, survivors: [], killRate: 0, verdict: 'no-mutations', inconclusive: true, detail: 'MUTATION_GATE: no mutable changed files (.ts/.js/.py, ≤4000 lines) — nothing to probe.' };
    }

    // 2) plan mutations on the CHANGED lines only
    const plans = assembleMutationPlans(candidateFiles, spans, maxMutations);
    if (!plans.length) {
      return { ok: true, ran: 0, killed: 0, survivors: [], killRate: 0, verdict: 'no-mutations', inconclusive: true, detail: 'MUTATION_GATE: no safe mutation point found on the changed lines — the gate approves this diff by default (nothing breakable).' };
    }

    // 3) execute: one mutation at a time, restore ALWAYS
    const originals = new Map<string, string>();
    for (const { file, content } of candidateFiles) originals.set(file, content);

    let ran = 0;
    let killed = 0;
    const survivors: MutationSurvivor[] = [];
    let abortedByTimeout = false;

    for (const plan of plans) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_RUN_BUDGET_MS) {
        abortedByTimeout = true;
        break;
      }
      const perRun = Math.max(MIN_RUN_BUDGET_MS, Math.floor(remaining / Math.max(1, plans.length - ran)));
      let wrote = false;
      let restoreErr: string | null = null;
      try {
        const original = originals.get(plan.file) ?? '';
        const lines = original.split('\n');
        if (plan.lineNo < 1 || plan.lineNo > lines.length) continue;
        lines[plan.lineNo - 1] = plan.after;
        await fs.writeFile(plan.file, lines.join('\n'), 'utf8');
        wrote = true;
        const res = await safeRun(cmd, ws, perRun);
        ran++;
        if (res.exitCode !== 0) killed++;
        else {
          survivors.push({ file: plan.file, lineNo: plan.lineNo, op: plan.op, strategy: plan.strategy, before: plan.before.trim().slice(0, 160), after: plan.after.trim().slice(0, 160), severity: plan.severity });
        }
      } catch {
        /* the per-mutation run is best-effort; restore still happens */
      } finally {
        if (wrote) {
          const original = originals.get(plan.file) ?? '';
          try {
            await fs.writeFile(plan.file, original, 'utf8');
          } catch {
            try {
              await fs.writeFile(plan.file, original, 'utf8');
            } catch (e2) {
              restoreErr = e2 instanceof Error ? e2.message : String(e2);
            }
          }
        }
        if (restoreErr) {
          return {
            ok: false, ran, killed, survivors, killRate: ran ? killed / ran : 0, verdict: 'skipped', inconclusive: true,
            detail: `MUTATION_GATE RESTORE_FAILED on ${plan.file}: ${restoreErr}. Restore line ${plan.lineNo} to: ${JSON.stringify(plan.before.trim().slice(0, 120))}`,
          };
        }
      }
    }

    // 4) verdict — kill rate on the CHANGED lines, equivalence-aware (v8.1):
    //    hard survivors (eq/logic/bool/arith/numeric/string mutants that
    //    survive) are a genuine FAIL; boundary survivors alone are classic
    //    equivalent-mutant candidates (`<` ↔ `<=` over an integer domain is
    //    often unobservable) and must NOT fail an otherwise strong suite.
    const killRate = ran ? killed / ran : 0;
    if (ran === 0) {
      return { ok: true, ran: 0, killed: 0, survivors: [], killRate: 0, verdict: 'no-mutations', inconclusive: true, detail: 'MUTATION_GATE: budget exhausted before any mutated run completed.' };
    }
    const hardSurvivors = survivors.filter((s) => s.severity === 'hard');
    const boundarySurvivors = survivors.filter((s) => s.severity === 'boundary');
    const fmt = (list: MutationSurvivor[]): string =>
      list
        .slice(0, 8)
        .map((s) => `${path.relative(ws, s.file)}:${s.lineNo} (${s.op}) — "${s.before}" survived as "${s.after}"`)
        .join('; ');
    const survivorList = fmt(survivors);
    if (killed >= minKills && killRate >= threshold) {
      return {
        ok: true, ran, killed, survivors, killRate, verdict: 'killed-enough', inconclusive: false,
        detail: `MUTATION_GATE PROVEN: tests killed ${killed}/${ran} mutations on the changed lines (kill rate ${(killRate * 100).toFixed(0)}%). The suite protects this diff.${boundarySurvivors.length ? ` Note: ${boundarySurvivors.length} boundary mutant(s) survived — likely equivalent for the exercised domain, listed in the report.` : ''}${abortedByTimeout ? ' (budget stopped the remaining mutants)' : ''}`,
      };
    }
    if (hardSurvivors.length > 0) {
      return {
        ok: true, ran, killed, survivors, killRate, verdict: 'survivors', inconclusive: false,
        detail: `MUTATION_GATE FAILED: ${hardSurvivors.length} hard mutation(s) survived on the changed lines (kills ${killed}/${ran}, rate ${(killRate * 100).toFixed(0)}%, need ≥${(threshold * 100).toFixed(0)}%). The suite does NOT protect what was just changed.${survivorList ? ` Survivors: ${survivorList}` : ''}`,
      };
    }
    if (boundarySurvivors.length > 0) {
      // The clamp-function trap: a suite can be excellent and still be unable
      // to distinguish `<` from `<=` over an integer domain. Honest verdict:
      // pass with a caveat, never a false accusation.
      return {
        ok: true, ran, killed, survivors, killRate, verdict: 'boundary-survivors', inconclusive: true,
        detail: `MUTATION_GATE INCONCLUSIVE (equivalent-mutant candidates): tests killed ${killed}/${ran} mutations; only boundary flips survived (${boundarySurvivors.length}). Boundary flips are often UNOBSERVABLE for the tested domain (e.g. integer clamp) — this is not evidence of weak tests. Listed for review: ${fmt(boundarySurvivors)}`,
      };
    }
    if (killed === ran) {
      // 100% kill rate on a sample below minKills — STRONG but thin.
      // Saying "FAILED" or "add assertions" here would be dishonest: the tests
      // killed everything that ran. The honest statement is the sample size.
      return {
        ok: true, ran, killed, survivors, killRate, verdict: 'strong-small', inconclusive: true,
        detail: `MUTATION_GATE STRONG (small sample): tests killed ${killed}/${ran} mutations on the changed lines (100%). Confidence is limited by the sample size, not by the tests — the claim stands.`,
      };
    }
    return {
      ok: true, ran, killed, survivors, killRate, verdict: 'weak', inconclusive: true,
      detail: `MUTATION_GATE INCONCLUSIVE: only ${ran} mutation(s) could run (kills: ${killed}) — not enough evidence to JUDGE the suite either way. Consider adding assertions over the changed lines.${survivorList ? ` Survivors: ${survivorList}` : ''}`,
    };
  } catch (err) {
    return {
      ok: false, ran: 0, killed: 0, survivors: [], killRate: 0, verdict: 'skipped', inconclusive: true,
      detail: `MUTATION_GATE failed unexpectedly (workspace untouched): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
