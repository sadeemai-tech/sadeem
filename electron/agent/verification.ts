// ============================================================
// Surnia — verification upgrades (self-contained module)
// Three harness-level honesty gates the engine can wire into any
// run. Nothing here mutates engine state; restore is memory-based
// so it works even when the workspace is NOT git-tracked.
//
//   1. mutationCheck() — the tests-honesty probe. Runs the test
//      command on the pristine tree, applies ONE safe in-memory
//      mutation to a small source file (=== flip / boolean return
//      flip / numeric literal nudge), re-runs the tests, then
//      ALWAYS restores the original bytes on every path including
//      throws. Tests that still pass after the mutation do not
//      test anything: green results on this tree are unproven.
//
//   2. auditClaims() — final-report auditor. Binds every claim in
//      the model's final message to the recorded run evidence
//      (touched files, commands + exit codes, test runs) and
//      counts unevidenced claims. Pure function, no IO. Arabic
//      verbs (عدّلت / شغّلت / …) are matched alongside English.
//
//   3. redGreenDirective() / parseRedGreen() — red→green
//      discipline: a model-facing instruction block that REQUIRES
//      failing-test-first, plus order-sensitive heuristics that
//      check the final message actually shows the failing run
//      BEFORE the passing one. Honest heuristics: anything not
//      detectable is non-compliant.
// Every function is defensive: mutationCheck never throws.
// ============================================================
import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { runCaptured } from '../services/terminalService';

// ------------------------------------------------------------
// Shared constants
// ------------------------------------------------------------

const DEFAULT_MUTATION_BUDGET_MS = 120_000;
const MIN_RUN_BUDGET_MS = 1_000;
const MAX_MUTATION_TARGET_LINES = 400;
const MAX_MUTATION_TARGET_BYTES = 512 * 1024;
const WALK_MAX_DEPTH = 10;
const WALK_MAX_ENTRIES = 4_000;
const DETAIL_CAP = 700;

const MUTATABLE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py']);

/** Directories never probed for a mutation target (tests/dist/vendor/…). */
const SKIP_DIR_NAMES = new Set([
  'node_modules', 'dist', 'dist-electron', 'out', 'build', 'coverage',
  '__pycache__', '__tests__', 'tests', 'test', 'e2e', 'spec', 'migrations',
  'fixtures', 'vendor', 'target', 'venv', 'tmp', 'docs', 'examples',
]);

interface RunResult {
  output: string;
  exitCode: number;
}

function msgOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function tailOf(output: string, cap = 240): string {
  const t = String(output ?? '').trim().replace(/\s+/g, ' ').slice(-cap);
  return t ? ` Output tail: ${t}` : '';
}

// ------------------------------------------------------------
// 1a. Mutation target picker (deterministic)
// ------------------------------------------------------------

/** Test-runner-ish file names are never mutation targets. */
function isTestishName(name: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(name)) return true;
  if (/(?:^|[._-])tests?\.[cm]?[jt]sx?$/i.test(name)) return true; // run-tests.mjs, test.js
  if (/^test[\w.-]*\.py$|^conftest\.py$|_test\.py$/i.test(name)) return true;
  if (/\.d\.ts$/i.test(name)) return true;
  if (/\.min\.[cm]?js$|\.bundle\.[cm]?js$/i.test(name)) return true;
  return false;
}

function isMutableFileName(name: string): boolean {
  if (name.startsWith('.') || name.startsWith('~')) return false;
  if (!MUTATABLE_EXTS.has(path.extname(name).toLowerCase())) return false;
  return !isTestishName(name);
}

interface TargetCandidate {
  file: string;
  depth: number;
  inSrc: boolean;
}

/**
 * Deterministically pick a small, non-test source file to mutate:
 * prefers anything under a `src/` segment, then the shallowest path,
 * then lexicographic order — same tree, same answer, every time.
 * Binaries are excluded by the extension allowlist; test files,
 * migrations, node_modules, dist and dot-dirs are skipped entirely.
 * Returns an absolute path, or null when the workspace has nothing
 * mutable (≤400 lines, .ts/.tsx/.js/.jsx/.mjs/.cjs/.py).
 */
export async function pickMutationTarget(workspace: string): Promise<string | null> {
  try {
    const root = path.resolve(workspace);
    const cands: TargetCandidate[] = [];
    let visited = 0;
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > WALK_MAX_DEPTH || visited > WALK_MAX_ENTRIES || cands.length >= 64) return;
      let entries: Dirent[] = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return; // unreadable dir — skip
      }
      entries = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const e of entries) {
        if (++visited > WALK_MAX_ENTRIES || cands.length >= 64) return;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.isSymbolicLink()) continue;
          if (e.name.startsWith('.') || SKIP_DIR_NAMES.has(e.name)) continue;
          await walk(full, depth + 1);
        } else if (e.isFile() && isMutableFileName(e.name)) {
          try {
            const st = await fs.stat(full);
            if (!st.isFile() || st.size > MAX_MUTATION_TARGET_BYTES) continue;
            const content = await fs.readFile(full, 'utf8');
            const lines = content.split('\n').length;
            if (lines < 2 || lines > MAX_MUTATION_TARGET_LINES) continue;
            const rel = path.relative(root, full).split(path.sep);
            cands.push({ file: full, depth: rel.length, inSrc: rel.includes('src') });
          } catch {
            /* unreadable file — skip */
          }
        }
      }
    };
    await walk(root, 0);
    if (!cands.length) return null;
    cands.sort((a, b) => {
      if (a.inSrc !== b.inSrc) return a.inSrc ? -1 : 1;
      if (a.depth !== b.depth) return a.depth - b.depth;
      return a.file < b.file ? -1 : 1;
    });
    return cands[0].file;
  } catch {
    return null; // never throws
  }
}

// ------------------------------------------------------------
// 1b. Safe in-memory mutation planning
// ------------------------------------------------------------

interface MutationPlan {
  lineNo: number; // 1-based
  before: string;
  after: string;
  strategy: string;
}

function isEligibleMutationLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.startsWith('//') || t.startsWith('#') || t.startsWith('/*') || t.startsWith('*')) return false;
  if (/^(?:import|from|require|package|using)\b/.test(t)) return false;
  return true;
}

/**
 * Plan ONE safe mutation against `content` (never touches disk).
 * Priority: `===` → `!==` on one line (python `==` → `!=`), then
 * `return true` → `return false` (python `True`/`False`), then a
 * single numeric literal nudge (decrement, 0 bumps to 1).
 * Returns null when the file offers no safe mutation point.
 */
function planMutation(content: string, ext: string): MutationPlan | null {
  const lines = content.split('\n');
  const py = ext === '.py';

  // 1) equality-operator flip (single line, first occurrence)
  const eq = py ? /(?<![=!<>])(==)(?!=)/ : null;
  for (let i = 0; i < lines.length; i++) {
    if (!isEligibleMutationLine(lines[i])) continue;
    if (!py && lines[i].includes('===')) {
      return { lineNo: i + 1, before: lines[i], after: lines[i].replace('===', '!=='), strategy: '=== flipped to !==' };
    }
    if (py && eq) {
      const m = eq.exec(lines[i]);
      if (m) return { lineNo: i + 1, before: lines[i], after: lines[i].replace(eq, '!='), strategy: '== flipped to !=' };
    }
  }

  // 2) boolean-return flip
  const boolRe = py ? /\breturn\s+True\b/ : /\breturn\s+true\b/;
  const boolNew = py ? 'return False' : 'return false';
  for (let i = 0; i < lines.length; i++) {
    if (!isEligibleMutationLine(lines[i])) continue;
    if (boolRe.test(lines[i])) {
      return { lineNo: i + 1, before: lines[i], after: lines[i].replace(boolRe, boolNew), strategy: `${py ? 'return True' : 'return true'} flipped to ${boolNew}` };
    }
  }

  // 3) numeric literal nudge (decrement; 0 → 1 keeps it expression-safe)
  const numRe = /(?<![\w.])(\d+)(?![\w.])/;
  for (let i = 0; i < lines.length; i++) {
    if (!isEligibleMutationLine(lines[i])) continue;
    const m = numRe.exec(lines[i]);
    if (!m) continue;
    const n = Number(m[1]);
    const after = lines[i].replace(numRe, String(n > 0 ? n - 1 : n + 1));
    if (after !== lines[i]) {
      return { lineNo: i + 1, before: lines[i], after, strategy: `numeric literal ${n} → ${n > 0 ? n - 1 : n + 1}` };
    }
  }
  return null;
}

async function firstMutableFrom(list: string[] | undefined): Promise<string | null> {
  for (const raw of list ?? []) {
    try {
      const p = path.resolve(String(raw));
      if (!MUTATABLE_EXTS.has(path.extname(p).toLowerCase())) continue;
      if (isTestishName(path.basename(p))) continue;
      const content = await fs.readFile(p, 'utf8');
      const n = content.split('\n').length;
      if (n < 2 || n > MAX_MUTATION_TARGET_LINES) continue;
      return p;
    } catch {
      /* skip invalid entries silently */
    }
  }
  return null;
}

async function safeRun(command: string, cwd: string, timeoutMs: number): Promise<RunResult> {
  try {
    return await runCaptured(command, cwd, timeoutMs);
  } catch (err) {
    return { output: `spawn failed: ${msgOf(err)}`, exitCode: -1 };
  }
}

// ------------------------------------------------------------
// 1c. mutationCheck — the tests-honesty probe
// ------------------------------------------------------------

export interface MutationCheckOptions {
  /** Absolute workspace path — the test command runs here. */
  workspace: string;
  /** The test command, run ONCE unmodified, then once mutated. */
  testCommand: string;
  /** Optional abs-path candidates; first valid one wins, else auto-picked. */
  filesToMutate?: string[];
  /** Total budget for BOTH runs (default 120s). */
  timeoutMs?: number;
}

export interface MutationReport {
  /** true = the probe itself completed (baseline green, file mutated & restored). */
  ok: boolean;
  /** true = tests caught the mutation; false = they didn't; null = inconclusive. */
  testsHonest: boolean | null;
  mutatedFile?: string;
  detail: string;
}

/**
 * Tests-honesty probe. (a) run `testCommand` once unmodified — a failing
 * baseline makes the probe inconclusive (testsHonest=null). (b) mutate ONE
 * small source file in memory (`===`→`!==`, `return true`→`return false`,
 * or a numeric literal nudge) and write it. (c) re-run the tests.
 * (d) restore the ORIGINAL bytes in a finally block — always, on every
 * path, git-tracked or not. testsHonest = second run FAILED while the
 * first PASSED: if the tests still pass after the mutation, they do not
 * test that file. Never throws; total time capped by `timeoutMs`.
 */
export async function mutationCheck(opts: MutationCheckOptions): Promise<MutationReport> {
  const ws = path.resolve(String(opts?.workspace ?? '.'));
  const cmd = String(opts?.testCommand ?? '').trim();
  const budget = Math.max(10_000, opts?.timeoutMs ?? DEFAULT_MUTATION_BUDGET_MS);
  const deadline = Date.now() + budget;
  const left = (): number => Math.max(MIN_RUN_BUDGET_MS, deadline - Date.now());

  try {
    if (!cmd) return { ok: false, testsHonest: null, detail: 'MUTATION_PROBE skipped: no test command given.' };

    // (a) baseline — evidence the tests are green before we break anything
    const base = await safeRun(cmd, ws, left());
    if (base.exitCode !== 0) {
      return {
        ok: false,
        testsHonest: null,
        detail:
          `MUTATION_PROBE INCONCLUSIVE: baseline "${cmd}" exited ${base.exitCode} — the suite must pass ` +
          `before the honesty probe can judge it. Fix the tests (or the code) first.` +
          tailOf(base.output),
      };
    }

    // (b) pick the mutation target (requested file first, then deterministic auto-pick)
    let target = await firstMutableFrom(opts?.filesToMutate);
    if (!target) target = await pickMutationTarget(ws);
    if (!target) {
      return {
        ok: false,
        testsHonest: null,
        detail: 'MUTATION_PROBE INCONCLUSIVE: no mutable source file (non-test .ts/.js/.py, ≤400 lines) found under the workspace.',
      };
    }

    let original: string;
    try {
      original = await fs.readFile(target, 'utf8');
    } catch (err) {
      return { ok: false, testsHonest: null, mutatedFile: target, detail: `MUTATION_PROBE failed: cannot read ${target}: ${msgOf(err)}` };
    }
    const plan = planMutation(original, path.extname(target).toLowerCase());
    if (!plan) {
      return { ok: false, testsHonest: null, mutatedFile: target, detail: `MUTATION_PROBE INCONCLUSIVE: no safe mutation point (===/return true/numeric) found in ${target}.` };
    }

    // (c) mutate → re-run, (d) restore ALWAYS (memory-based, no git needed)
    let second: RunResult | null = null;
    let wrote = false;
    let restoreErr: string | null = null;
    try {
      const mutatedLines = original.split('\n');
      mutatedLines[plan.lineNo - 1] = plan.after;
      await fs.writeFile(target, mutatedLines.join('\n'), 'utf8');
      wrote = true;
      const remaining = deadline - Date.now();
      if (remaining < MIN_RUN_BUDGET_MS) {
        return { ok: false, testsHonest: null, mutatedFile: target, detail: `MUTATION_PROBE INCONCLUSIVE: ${budget}ms budget exhausted after the baseline run. Original content restored.` };
      }
      second = await safeRun(cmd, ws, Math.min(remaining, budget));
    } finally {
      if (wrote) {
        try {
          await fs.writeFile(target, original, 'utf8');
        } catch {
          try {
            await fs.writeFile(target, original, 'utf8'); // one retry — restore is non-negotiable
          } catch (err2) {
            restoreErr = msgOf(err2);
          }
        }
      }
    }

    if (restoreErr) {
      return {
        ok: false,
        testsHonest: null,
        mutatedFile: target,
        detail:
          `MUTATION_PROBE RESTORE_FAILED: mutated ${target} could not be written back (${restoreErr}). ` +
          `Restore line ${plan.lineNo} manually — original line: ${JSON.stringify(plan.before.trim().slice(0, 160))}`,
      };
    }
    if (!second) {
      return { ok: false, testsHonest: null, mutatedFile: target, detail: `MUTATION_PROBE INCONCLUSIVE: the mutated re-run did not complete within the ${budget}ms budget. Original content restored.` };
    }

    // (e) verdict: honest iff the mutated run FAILED while the baseline PASSED
    const honest = second.exitCode !== 0;
    const detail = honest
      ? `MUTATION_PROBE HONEST: baseline "${cmd}" exit 0; after mutating ${target} (line ${plan.lineNo}, ${plan.strategy}) exit ${second.exitCode}. The tests caught the mutation — green results on this tree mean something. Original content restored.` + tailOf(second.output)
      : `MUTATION_PROBE DISHONEST: tests still exited ${second.exitCode} after mutating ${target} (line ${plan.lineNo}, ${plan.strategy}) — they do not exercise this file, so green claims about it are unproven. Add a test that fails when "${plan.before.trim().slice(0, 120)}" is broken. Original content restored.` + tailOf(second.output);
    return { ok: true, testsHonest: honest, mutatedFile: target, detail: detail.slice(0, DETAIL_CAP) };
  } catch (err) {
    return { ok: false, testsHonest: null, detail: `MUTATION_PROBE failed unexpectedly (workspace untouched): ${msgOf(err)}` };
  }
}

// ------------------------------------------------------------
// 2. auditClaims — claim-evidence binding (pure, no IO)
// ------------------------------------------------------------

export interface RunEvidence {
  filesTouched: string[];
  commands: { command: string; exitCode: number }[];
  testsRun: boolean;
}

export interface ClaimRecord {
  claim: string;
  kind: 'file-edit' | 'command' | 'test' | 'other';
  supported: boolean;
  note: string;
}

export interface ClaimAudit {
  claims: ClaimRecord[];
  unsupportedCount: number;
  summary: string;
}

const EN_EDIT_RE = /\b(?:edited?|updated?|wrote|rewrote|created|modified|removed|deleted|fixed|refactored|patched)\b/i;
const AR_EDIT_RE = /عدّلت|حدّثت|كتبت|أنشأت|أنشأ|حذفت|أصلحت|صلحت/;
const EN_RUN_RE = /\b(?:ran|run|executed?|built|rebuilt|installed?|invoked?)\b/i;
const AR_RUN_RE = /شغّلت|شغلت/;
const TEST_PASS_RE = /\btests?\s+(?:all\s+)?(?:pass|passed|passing|green|succeed|succeeds|succeeded)\b/i;
const TEST_GREEN_SUITE_RE = /\b(?:tests?|suite)\s+(?:is|are|looks)\s+green\b/i;

/** Known command-ish tokens — a command claim needs at least one. */
const TOOL_WORDS = new Set([
  'npm', 'npx', 'node', 'tsc', 'esbuild', 'vite', 'webpack', 'jest', 'vitest', 'mocha',
  'pytest', 'python', 'python3', 'pip', 'pip3', 'go', 'cargo', 'rustc', 'make', 'cmake',
  'gradle', 'mvn', 'maven', 'yarn', 'pnpm', 'bun', 'deno', 'gcc', 'clang', 'javac',
  'dotnet', 'swift', 'php', 'ruby', 'rake', 'eslint', 'prettier', 'ruff', 'mypy', 'black',
  'flake8', 'pylint', 'shellcheck', 'git', 'docker', 'kubectl', 'curl', 'wget',
  'test', 'tests', 'build', 'lint', 'compile', 'check', 'install', 'ci', 'suite',
]);

/** File-path / filename tokens: src/app.ts, auth.service.ts, a\b.js … */
const FILE_TOKEN_RE = /[\w@][\w@./\\:-]*\.[A-Za-z][A-Za-z0-9]{0,7}/g;

/** Sentence split — file tokens are masked first so "app.ts" never splits. */
const SENTENCE_SPLIT_RE = /[.!?؛؟\n]+/;

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function stem(t: string): string {
  return t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t;
}

function splitSentences(text: string): string[] {
  const tokens: string[] = [];
  const masked = text.replace(FILE_TOKEN_RE, (m) => {
    tokens.push(m);
    return `\u0000${tokens.length - 1}\u0000`;
  });
  return masked
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)] ?? '').trim())
    .filter(Boolean)
    .slice(0, 200);
}

/** File tokens in a sentence — stem must be ≥2 chars so "e.g" / "1.5" never count. */
function fileTokensIn(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(FILE_TOKEN_RE)) {
    const tok = m[0];
    const dot = tok.lastIndexOf('.');
    if (dot >= 2 && tok.slice(0, dot).length >= 2) out.push(tok);
  }
  return [...new Set(out)];
}

function toolTokensIn(s: string): string[] {
  const out: string[] = [];
  for (const raw of s.toLowerCase().split(/[^a-z0-9_@./\\:+-]+/)) {
    if (!raw) continue;
    if (TOOL_WORDS.has(raw)) out.push(raw);
    else {
      const st = stem(raw);
      if (TOOL_WORDS.has(st)) out.push(st);
    }
  }
  return [...new Set(out)];
}

function classifyClaim(s: string, touched: Set<string>, cmdTokens: Set<string>, testsRun: boolean): ClaimRecord {
  const claim = s.length > 240 ? `${s.slice(0, 240)}…` : s;

  // (1) explicit pass claim → supported iff a test run was recorded
  if (TEST_PASS_RE.test(s) || TEST_GREEN_SUITE_RE.test(s)) {
    return {
      claim,
      kind: 'test',
      supported: testsRun,
      note: testsRun ? 'evidenced: a test run was recorded this session' : 'no test run was recorded — the pass claim is unevidenced',
    };
  }

  const isEdit = EN_EDIT_RE.test(s) || AR_EDIT_RE.test(s);
  const isRun = EN_RUN_RE.test(s) || AR_RUN_RE.test(s);

  // (2) edit verb + file token → supported iff every cited file was touched
  const files = fileTokensIn(s);
  if (isEdit && files.length) {
    const missing = files.filter((f) => !touched.has(baseName(f).toLowerCase()));
    if (!missing.length) {
      return { claim, kind: 'file-edit', supported: true, note: `evidenced: ${files.map(baseName).join(', ')} in touched files` };
    }
    return { claim, kind: 'file-edit', supported: false, note: `unevidenced: ${missing.map(baseName).join(', ')} not among ${touched.size} touched file(s)` };
  }

  // (3) run verb + command-ish token → supported iff a recorded command shares it
  if (isRun) {
    const tools = toolTokensIn(s);
    if (tools.length) {
      const shared = tools.find((t) => cmdTokens.has(t) || cmdTokens.has(stem(t)));
      if (shared !== undefined) {
        return { claim, kind: 'command', supported: true, note: `evidenced: recorded command(s) share token "${shared}"` };
      }
      return { claim, kind: 'command', supported: false, note: `no recorded command shares token(s): ${tools.join(', ')}` };
    }
  }

  // (4) everything else carries no evidentiary burden
  return { claim, kind: 'other', supported: true, note: '' };
}

/**
 * Bind each sentence of the final report to the run evidence.
 * file-edit claims: every cited filename (basename, case-insensitive) must be
 * in filesTouched. Command claims: a known tool token must appear in a
 * recorded command. Test-pass claims: testsRun. Pure — no IO, no globals.
 */
export function auditClaims(finalText: string, evidence: RunEvidence): ClaimAudit {
  const touched = new Set((evidence?.filesTouched ?? []).map((f) => baseName(String(f)).toLowerCase()).filter(Boolean));
  const cmdTokens = new Set<string>();
  for (const c of evidence?.commands ?? []) {
    for (const t of String(c?.command ?? '').toLowerCase().split(/[^a-z0-9_@./\\:-]+/)) {
      if (!t) continue;
      cmdTokens.add(t);
      cmdTokens.add(stem(t));
    }
  }
  const testsRun = !!evidence?.testsRun;

  const claims = splitSentences(String(finalText ?? '')).map((s) => classifyClaim(s, touched, cmdTokens, testsRun));
  const unsupportedCount = claims.filter((c) => !c.supported).length;
  return {
    claims,
    unsupportedCount,
    summary: `${claims.length} claim${claims.length === 1 ? '' : 's'}, ${unsupportedCount} unevidenced`,
  };
}

// ------------------------------------------------------------
// 3. Red→green discipline (directive + order-sensitive parser)
// ------------------------------------------------------------

/**
 * Model-facing instruction block that REQUIRES the failing-test-first
 * cycle and both runs (with exit codes) in the final message.
 */
export function redGreenDirective(bugDescription: string): string {
  const bug = String(bugDescription ?? '').trim().replace(/\s+/g, ' ').slice(0, 300) || '(the reported bug)';
  return [
    `RED→GREEN DISCIPLINE — REQUIRED for this bug: ${bug}`,
    'Do not "fix and hope". Follow this exact cycle and show the receipts:',
    '1. RED first: write a MINIMAL FAILING TEST that reproduces the bug (a real assertion, not a smoke check) BEFORE touching any implementation code.',
    '2. Run that test and EXPECT it to fail. Record the exact command and its non-zero exit code (e.g. "exit code 1"). If it passes immediately, it is not reproducing the bug — sharpen the test.',
    '3. GREEN: apply the smallest implementation change that makes the bug go away. Do NOT weaken, skip or delete the test assertions to force a pass.',
    '4. Re-run the SAME test command and EXPECT it to pass (exit code 0).',
    '5. Your final message MUST include BOTH runs, in order: the failing run FIRST, then the passing run — each with its command and exit code. A fix whose failing run is missing, or shown after the passing run, is NON-COMPLIANT and the task is not done.',
  ].join('\n');
}

export interface RedGreenParse {
  hasFailingFirst: boolean;
  hasPassAfter: boolean;
  compliant: boolean;
}

const RG_FAIL_RES: RegExp[] = [
  /\bFAIL(?:ED|ING|S)?\b/i,
  /\bexpect(?:ed|s)?\s+(?:it\s+)?(?:to\s+)?fail/i,
  /\bfails\s+as\s+expected/i,
  /\bnon-?zero\s+exit/i,
  /\bexit(?:\s+code)?\s*[:=]?\s*[1-9]\d*\b/i,
];
const RG_PASS_RES: RegExp[] = [
  /\bPASS(?:ED|ING|ES)?\b/i,
  /\b(?:tests?|suite)\s+(?:is|are|all)\s+green\b/i,
  /\ball\s+green\b/i,
  /\ball\s+tests?\s+pass/i,
  /\bexit(?:\s+code)?\s*[:=]?\s*0\b/i,
  /[✓✔]/,
];

function firstIndex(text: string, res: RegExp[]): number {
  let best = -1;
  for (const re of res) {
    const m = re.exec(text);
    if (m && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
}

/**
 * Honest, order-sensitive heuristics: the final message must show a
 * failing-test marker (FAIL / "expected to fail" / non-zero exit code)
 * EARLIER than a passing marker (PASS / green / exit 0). Anything not
 * detectable → compliant=false. Pure function.
 */
export function parseRedGreen(finalText: string): RedGreenParse {
  const text = String(finalText ?? '');
  const failAt = firstIndex(text, RG_FAIL_RES);
  const passAt = firstIndex(text, RG_PASS_RES);
  const hasFailingFirst = failAt !== -1 && (passAt === -1 || failAt < passAt);
  const hasPassAfter = failAt !== -1 && passAt !== -1 && passAt > failAt;
  return { hasFailingFirst, hasPassAfter, compliant: hasFailingFirst && hasPassAfter };
}
