// ============================================================
// Surnia v7.1 — IMPACT-DRIVEN VERIFICATION.
// Running the full suite after every edit is why "proof" costs
// minutes. This module makes it cost seconds:
//
//   • selectAffectedTests(): map the run's changed files to the test
//     files that exercise them, by (1) coverage data when the project
//     has any (istanbul/jest coverage-final.json / coverage-summary.json,
//     pytest-cov coverage.xml), (2) an import-graph sweep (test files
//     that import the changed module), (3) naming conventions
//     (src/auth.ts → auth.test.ts / __tests__/auth.test.ts /
//     tests/test_auth.py). The strategy used is reported honestly.
//   • buildNarrowedCommand(): turn the project's test command into one
//     that runs ONLY the selected tests (jest/vitest/node --test take
//     paths; pytest takes paths; runners that cannot narrow are left
//     untouched — narrowing must never silently skip).
//   • coveredLines(): read coverage data → per-file covered line sets,
//     so the mutation gate can spend its budget only on lines a test
//     can actually see.
// Dependency-free: bounded directory walks, no coverage tool required.
// ============================================================
import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------

const TEST_WALK_MAX_DEPTH = 8;
const TEST_WALK_MAX_ENTRIES = 6_000;
const MAX_TEST_FILES = 200;

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'dist-electron', 'out', 'build', 'coverage', 'release',
  '__pycache__', '.git', '.venv', 'venv', 'target', 'vendor', '.next', '.nuxt', 'tmp',
]);

const JS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const PY_EXTS = new Set(['.py']);

export type SelectionStrategy = 'coverage' | 'import-graph' | 'name-convention' | 'none';

export interface AffectedTests {
  strategy: SelectionStrategy;
  /** Workspace-relative test file paths. */
  tests: string[];
  note: string;
}

// ------------------------------------------------------------
// Bounded walk collecting test files
// ------------------------------------------------------------

function isTestFileName(name: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(name)) return true;
  if (/(?:^|[._-])tests?\.[cm]?[jt]sx?$/i.test(name)) return true;
  if (/^test[\w.-]*\.py$|_test\.py$|^conftest\.py$/i.test(name)) return true;
  if (/(?:^|[/\\])__tests__[/\\]/i.test(name)) return true;
  return false;
}

async function walkTestFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  let visited = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > TEST_WALK_MAX_DEPTH || visited > TEST_WALK_MAX_ENTRIES || out.length >= MAX_TEST_FILES) return;
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (++visited > TEST_WALK_MAX_ENTRIES || out.length >= MAX_TEST_FILES) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.isSymbolicLink() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        await walk(full, depth + 1);
      } else if (e.isFile() && isTestFileName(e.name)) {
        try {
          const st = await fs.stat(full);
          if (st.isFile() && st.size < 512 * 1024) out.push(full);
        } catch {
          /* skip */
        }
      }
    }
  };
  await walk(root, 0);
  return out;
}

// ------------------------------------------------------------
// Strategy 1: coverage data
// ------------------------------------------------------------

interface CoverageLineMap {
  /** absolute file → set of covered 1-based lines */
  [file: string]: Set<number>;
}

async function readIstanbulCoverage(root: string): Promise<CoverageLineMap | null> {
  const candidates = ['coverage/coverage-final.json', 'coverage/coverage-summary.json', '.nyc_output/coverage-final.json'];
  for (const rel of candidates) {
    try {
      const raw = await fs.readFile(path.join(root, rel), 'utf8');
      const json = JSON.parse(raw) as Record<string, unknown>;
      const map: CoverageLineMap = {};
      if (rel.endsWith('coverage-final.json')) {
        for (const [fileKey, data] of Object.entries(json)) {
          const d = data as { statementMap?: Record<string, { start?: { line?: number } }>; s?: Record<string, number> };
          const lines = new Set<number>();
          const stmtMap = d.statementMap ?? {};
          const counts = d.s ?? {};
          for (const [id, count] of Object.entries(counts)) {
            if (count > 0 && stmtMap[id]?.start?.line) lines.add(stmtMap[id].start!.line!);
          }
          if (lines.size) map[fileKey] = lines;
        }
      } else {
        // coverage-summary.json: { file: { lines: { total, covered, pct } } } — file granularity only
        for (const [fileKey, data] of Object.entries(json)) {
          const d = data as { lines?: { covered?: number; total?: number } };
          if (d?.lines?.total && d.lines.covered && d.lines.covered > 0) map[fileKey] = new Set();
        }
      }
      if (Object.keys(map).length) return map;
    } catch {
      /* next candidate */
    }
  }
  return null;
}

async function readCoberturaCoverage(root: string): Promise<CoverageLineMap | null> {
  try {
    const raw = await fs.readFile(path.join(root, 'coverage.xml'), 'utf8');
    const map: CoverageLineMap = {};
    // line elements: <line number="12" hits="3" branch="false"/>
    for (const cls of raw.matchAll(/<class[^>]*filename="([^"]+)"[^>]*>([\s\S]*?)<\/class>/g)) {
      const file = cls[1];
      const lines = new Set<number>();
      for (const ln of cls[2].matchAll(/<line\s+number="(\d+)"\s+hits="(\d+)"/g)) {
        if (parseInt(ln[2], 10) > 0) lines.add(parseInt(ln[1], 10));
      }
      if (lines.size) map[file] = lines;
    }
    if (Object.keys(map).length) return map;
  } catch {
    /* no coverage.xml */
  }
  return null;
}

function normalizeCoverageKey(root: string, key: string): string {
  try {
    let p = key;
    // istanbul keys may be absolute or file:// URLs
    if (p.startsWith('file://')) p = decodeURIComponent(p.slice(7));
    if (!path.isAbsolute(p)) p = path.resolve(root, p);
    return p;
  } catch {
    return key;
  }
}

// ------------------------------------------------------------
// Strategy 2: import-graph sweep
// ------------------------------------------------------------

const IMPORT_RE = /(?:from\s+|require\(\s*|import\s+)['"]([^'"]+)['"]/g;

function moduleNameMatches(importPath: string, targetRel: string): boolean {
  // strip extension from target, normalize separators
  const t = targetRel.replace(/\.[cm]?[jt]sx?$/i, '').replace(/\\/g, '/');
  const base = path.posix.basename(t);
  const ip = importPath.replace(/\\/g, '/');
  if (ip === t || ip.endsWith(`/${t}`)) return true;
  if (ip.endsWith(`/${base}`) || ip === base) return true;
  // relative import resolution is skipped — basename match is the honest recall/precision trade
  return false;
}

function pyImportMatches(importPath: string, targetRel: string): boolean {
  const stem = path.basename(targetRel, path.extname(targetRel));
  const mod = importPath.split('.').at(-1) ?? '';
  return !!stem && (mod === stem || importPath.includes(stem));
}

async function selectByImports(root: string, changedAbs: string[], testFiles: string[]): Promise<string[]> {
  const changedRel = changedAbs.map((c) => path.relative(root, c).replace(/\\/g, '/'));
  const changedSet = new Set(changedAbs.map((c) => c.toLowerCase()));
  const out: string[] = [];
  for (const tf of testFiles) {
    try {
      const content = await fs.readFile(tf, 'utf8');
      const ext = path.extname(tf).toLowerCase();
      const imports = [...content.matchAll(IMPORT_RE)].map((m) => m[1]);
      // direct: test imports the changed module
      let hit = imports.some((imp) => {
        if (ext === '.py') return changedAbs.some((c) => pyImportMatches(imp, c));
        return changedRel.some((rel) => moduleNameMatches(imp, rel));
      });
      // also: test imports a module that lives in the same directory as a changed file
      if (!hit) {
        for (const imp of imports) {
          if (!imp.startsWith('.')) continue;
          const resolved = path.resolve(path.dirname(tf), imp);
          for (const ext2 of JS_EXTS) {
            if (changedSet.has((resolved + ext2).toLowerCase())) {
              hit = true;
              break;
            }
          }
          if (hit) break;
        }
      }
      if (hit) out.push(tf);
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

// ------------------------------------------------------------
// Strategy 3: name conventions
// ------------------------------------------------------------

function selectByNameConvention(root: string, changedAbs: string[]): string[] {
  const out: string[] = [];
  for (const abs of changedAbs) {
    const dir = path.dirname(abs);
    const base = path.basename(abs);
    const ext = path.extname(abs).toLowerCase();
    const stem = base.slice(0, base.length - ext.length);
    if (JS_EXTS.has(ext)) {
      out.push(
        path.join(dir, `${stem}.test.ts`), path.join(dir, `${stem}.test.tsx`), path.join(dir, `${stem}.test.js`),
        path.join(dir, `${stem}.spec.ts`), path.join(dir, `${stem}.spec.js`),
        path.join(dir, '__tests__', `${stem}.test.ts`), path.join(dir, '__tests__', `${stem}.test.js`),
      );
    } else if (PY_EXTS.has(ext)) {
      // resolve the tests/ convention against the WORKSPACE root (not cwd)
      out.push(path.join(dir, `test_${stem}.py`), path.join(root, 'tests', `test_${stem}.py`), path.join(dir, `${stem}_test.py`));
    }
  }
  return out.filter((p) => {
    try {
      return fsSync.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

// ------------------------------------------------------------
// Public: select affected tests
// ------------------------------------------------------------

export async function selectAffectedTests(workspace: string, changedFiles: string[]): Promise<AffectedTests> {
  const root = path.resolve(workspace);
  const changed = changedFiles.filter((f) => {
    try {
      return fsSync.statSync(path.isAbsolute(f) ? f : path.join(root, f)).isFile();
    } catch {
      return false;
    }
  });
  if (!changed.length) {
    return { strategy: 'none', tests: [], note: 'no changed files to map' };
  }

  // 1) coverage data — which changed files do tests cover at all?
  const cov = (await readIstanbulCoverage(root)) ?? (await readCoberturaCoverage(root));
  if (cov) {
    const covKeys = new Map<string, string>(); // normalized abs → original key
    for (const key of Object.keys(cov)) covKeys.set(normalizeCoverageKey(root, key).toLowerCase(), key);
    const covered = changed.filter((c) => covKeys.has(path.resolve(c).toLowerCase()));
    if (covered.length) {
      // coverage maps files → lines; per-test attribution needs per-test runs, so
      // coverage narrows to "test files that import the covered modules"
      const testFiles = await walkTestFiles(root);
      const byImports = await selectByImports(root, covered, testFiles);
      if (byImports.length) {
        return {
          strategy: 'coverage',
          tests: byImports.map((t) => path.relative(root, t).replace(/\\/g, '/')),
          note: `coverage data present; ${covered.length}/${changed.length} changed file(s) are covered; ${byImports.length} test file(s) exercise them`,
        };
      }
      return { strategy: 'coverage', tests: [], note: `coverage covers ${covered.length} changed file(s) but no test file imports them — falling through to import sweep` };
    }
  }

  // 2) import-graph sweep
  const testFiles = await walkTestFiles(root);
  if (testFiles.length) {
    const byImports = await selectByImports(root, changed, testFiles);
    if (byImports.length) {
      return {
        strategy: 'import-graph',
        tests: byImports.map((t) => path.relative(root, t).replace(/\\/g, '/')),
        note: `${byImports.length}/${testFiles.length} test file(s) import the changed modules`,
      };
    }
    // 3) name conventions
    const byName = selectByNameConvention(root, changed);
    if (byName.length) {
      return {
        strategy: 'name-convention',
        tests: byName.map((t) => path.relative(root, t).replace(/\\/g, '/')),
        note: `${byName.length} test file(s) match the changed files by name`,
      };
    }
  }

  return { strategy: 'none', tests: [], note: `no coverage data, no test file imports any of the ${changed.length} changed file(s), no name matches — full suite it is` };
}

// ------------------------------------------------------------
// Narrowed command builder
// ------------------------------------------------------------

/**
 * Test runners whose paths can be narrowed, in match order.
 * v11.31 — each runner must be followed by whitespace, a chain separator or
 * end-of-string. The old `\b` matched `npm run test:ci` / `test:unit` as if it
 * were `npm run test`, then appended `-- "path"` to `test:ci`, producing a
 * broken command that ran ZERO tests. A script name that merely starts with
 * "test" is not the generic test runner; narrow it only when we are sure.
 */
const NARROWABLE_RUNNERS: Array<{ re: RegExp; sep: string }> = [
  { re: /(?:^|&&)\s*(?:npx\s+|yarn\s+|pnpm\s+|bun(?:x)?\s+)?jest(?=\s|&&|;|\||$)/, sep: ' ' },
  { re: /(?:^|&&)\s*(?:npx\s+|yarn\s+|pnpm\s+|bun(?:x)?\s+)?vitest(?:\s+run)?(?=\s|&&|;|\||$)/, sep: ' ' },
  { re: /(?:^|&&)\s*node\s+--test(?=\s|&&|;|\||$)/, sep: ' ' },
  { re: /(?:^|&&)\s*(?:python3?\s+-m\s+pytest|pytest)(?=\s|&&|;|\||$)/, sep: ' ' },
  // npm test -- <paths> works when the script passes args through (jest/vitest do)
  { re: /(?:^|&&)\s*(?:npm\s+(?:test|run\s+test)|(?:yarn|pnpm|bun)\s+test)(?=\s|&&|;|\||$)/, sep: ' -- ' },
];

/** A link that already names specific test files/a one-off test run. */
const NARROW_TEST_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?\b|\b__tests__[/\\]|(?:^|[/\\])tests?[/\\]|\btest_[\w.-]+\.py\b|_test\.py\b/i;

export interface CanonicalTestLink {
  /** Offset just AFTER the runner keyword (where narrowed paths belong). */
  start: number;
  /** End offset of this chain link. */
  end: number;
  /** Separator this runner needs before file paths. */
  sep: string;
  /** True when the link is a whole-suite command, false for a narrow one-off. */
  suite: boolean;
}

/**
 * v11.23 (AUDIT) — pick the link in a `&&`/`;`/`|` chain that the narrowed
 * paths must attach to. The v11.21 fix made paths land on a *test runner*;
 * it still chose the FIRST runner, so a chain like
 *   `npx jest tests/smoke.test.ts && npm test`
 * attached the impact-selected tests to the narrow one-off jest command and
 * treated it as canonical. Prefer the full-suite link; a narrow one-off must
 * never become the canonical verification command. With no suite link, use
 * the last runner link (the most likely final/canonical step).
 */
export function chooseCanonicalTestLink(baseCommand: string): CanonicalTestLink | null {
  const base = String(baseCommand ?? '');
  const chainRe = /&&|;|\|/g;
  const links: Array<{ text: string; start: number; end: number }> = [];
  let pos = 0;
  for (const m of base.matchAll(chainRe)) {
    const i = m.index ?? 0;
    links.push({ text: base.slice(pos, i), start: pos, end: i });
    pos = i + m[0].length;
  }
  links.push({ text: base.slice(pos), start: pos, end: base.length });

  const candidates: CanonicalTestLink[] = [];
  for (const link of links) {
    const chosen = NARROWABLE_RUNNERS.find((r) => r.re.test(link.text));
    if (!chosen) continue;
    const m = chosen.re.exec(link.text);
    if (!m) continue;
    candidates.push({
      start: link.start + (m.index ?? 0) + m[0].length,
      end: link.end,
      sep: chosen.sep,
      suite: !NARROW_TEST_FILE_RE.test(link.text),
    });
  }
  if (!candidates.length) return null; // runner cannot narrow — honest null
  const suites = candidates.filter((c) => c.suite);
  return suites.length ? suites[suites.length - 1] : candidates[candidates.length - 1];
}

/**
 * Turn the project test command into one that runs ONLY the selected test
 * files. Runners that cannot take paths (cargo/make/gradle) return null —
 * the caller must fall back to the full suite rather than silently skip.
 */
export function buildNarrowedCommand(baseCommand: string, tests: string[]): string | null {
  const base = String(baseCommand ?? '').trim();
  if (!base || !tests.length) return null;
  const quoted = tests.map((t) => `"${t.replace(/"/g, '')}"`).join(' ');
  const link = chooseCanonicalTestLink(base);
  if (!link) return null; // runner cannot narrow — honest null
  // v11.31 — append at the END of the chosen chain link, not just after the
  // runner keyword. Existing flags (`pytest -q`, `npm test -- --coverage`)
  // must stay before the paths or the narrowed run can silently skip them.
  // `link.end` is the offset right before the next chain separator, so this
  // also keeps a later `&& echo …` link untouched.
  const prefix = base.slice(0, link.end).trimEnd();
  const suffix = base.slice(link.end).trimStart(); // starts with && / ; / |
  return suffix ? `${prefix}${link.sep}${quoted} ${suffix}` : `${prefix}${link.sep}${quoted}`;
}

// ------------------------------------------------------------
// Covered lines (for the mutation gate)
// ------------------------------------------------------------

/**
 * Per-file covered line sets from whatever coverage data exists.
 * Files without coverage data are absent from the map — callers must
 * treat absence as "unknown", never as "uncovered".
 */
export async function coveredLines(workspace: string): Promise<{ map: CoverageLineMap; source: 'istanbul' | 'cobertura' | 'none' }> {
  const root = path.resolve(workspace);
  const ist = await readIstanbulCoverage(root);
  if (ist) return { map: ist, source: 'istanbul' };
  const cob = await readCoberturaCoverage(root);
  if (cob) return { map: cob, source: 'cobertura' };
  return { map: {}, source: 'none' };
}

/** Intersect mutation spans with coverage: keep only lines a test can see. */
export function intersectSpansWithCoverage(
  spans: Record<string, Array<[number, number]>>,
  coverage: CoverageLineMap,
  absToKey: (abs: string) => string | null,
): Record<string, Array<[number, number]>> {
  const out: Record<string, Array<[number, number]>> = {};
  for (const [file, fileSpans] of Object.entries(spans)) {
    const key = absToKey(file);
    const lines = key ? coverage[key] : undefined;
    if (!lines || lines.size === 0) continue; // unknown/uncovered — drop (gate runs only on provably-covered lines)
    const kept: Array<[number, number]> = [];
    for (const [a, b] of fileSpans) {
      let cur: [number, number] | null = null;
      for (let l = a; l <= b; l++) {
        if (lines.has(l)) {
          if (cur) cur[1] = l;
          else cur = [l, l];
        } else if (cur) {
          kept.push(cur);
          cur = null;
        }
      }
      if (cur) kept.push(cur);
    }
    if (kept.length) out[file] = kept;
  }
  return out;
}
