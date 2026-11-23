// ============================================================
// Surnia v7.1 — FAKE-TEST DETECTOR (deterministic, zero model calls).
// The critic is a model; models can be sweet-talked and they cost
// tokens. This gate is pure rules run BEFORE the critic: it hunts
// the mechanical signatures of tests that exist to look green —
//
//   JS/TS (jest / vitest / mocha / node:test)
//   • tautologies: expect(true).toBe(true), expect(x).toBe(x)
//   • literal-vs-literal: expect('a').toBe('a')
//   • skipped tests: it.skip / test.skip / xit( / xdescribe( / it.todo
//   • empty bodies: a test block with ZERO assertion tokens
//   • swallowed errors: catch {} / catch { /* comment */ }
//   • mock-only files: every expect() targets a mock/spy/stub
//
//   Python (pytest / unittest)
//   • assert True / assert 1 / assertEqual(True, True)
//   • assert x == x (same identifier both sides)
//   • @unittest.skip / pytest.mark.skip / except Exception: pass
//   • test functions with no assert call
//
// It runs on the files the run touched (tests only), finds nothing
// → the critic is still allowed; finds something → the findings go
// straight to the agent AND the critic prompt. No IO, no network.
// ============================================================
import * as path from 'node:path';

export type FakeTestSeverity = 'high' | 'medium' | 'warn';

export interface FakeTestFinding {
  file: string;
  line: number; // 1-based
  rule: string;
  severity: FakeTestSeverity;
  note: string;
}

export interface FakeTestReport {
  scanned: number; // test files scanned
  findings: FakeTestFinding[];
  high: number;
  summary: string;
}

// ------------------------------------------------------------
// File classification
// ------------------------------------------------------------

const JS_TEST_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$|[/\\]__tests__[/\\]/i;
const PY_TEST_RE = /(?:^|[/\\])(?:test_[^/\\]*|[^/\\]*_test)\.py$|^conftest\.py$/i;

export function isJsTestFile(file: string): boolean {
  return JS_TEST_RE.test(file);
}
export function isPyTestFile(file: string): boolean {
  return PY_TEST_RE.test(file) && file.toLowerCase().includes('test');
}

// ------------------------------------------------------------
// JS/TS rules
// ------------------------------------------------------------

const ASSERT_TOKENS_RE = /\b(?:expect|assert|should|t\.(?:is|equal|deepEqual|ok)|assert\.)\b|\btoEqual\b|\btoBe\b|\btoBeTrue\b|\btoBeFalse\b|\bassertEqual\b|\bassertTrue\b|\bdeepStrictEqual\b|assert\s*\(/i;
const SKIP_RE = /\b(?:it|test|describe)\.(?:skip|todo)\b|\bxit\s*\(|\bxdescribe\s*\(|\bfdescribe\s*\(/;
const TAUTOLOGY_RE = /\bexpect\(\s*(true|false|null|undefined|0|1)\s*\)/i;
const LITERAL_TAUTOLOGY_RE = /\bexpect\(\s*(['"`])([^'"`\n]{1,40})\1\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*\1\2\1\s*\)/;
const SELF_TAUTOLOGY_RE = /\bexpect\(\s*(\w[\w.]*)\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*\1\s*\)/;
const EMPTY_CATCH_RE = /catch\s*(?:\([^)]*\))?\s*\{\s*\}|catch\s*\{\s*\/\*[^*]*\*\/\s*\}/;
const MOCKISH_RE = /(?:mock|stub|spy|fake)/i;

interface JsTestBlock {
  startLine: number; // 0-based index of the it(/test( line
  endLine: number; // 0-based index of the closing `});`
}

/** Extract it/test blocks by indent matching (no full AST needed). */
function jsTestBlocks(lines: string[]): JsTestBlock[] {
  const blocks: JsTestBlock[] = [];
  const openRe = /^\s*(?:it|test)\s*\(/;
  for (let i = 0; i < lines.length && blocks.length < 60; i++) {
    const m = openRe.exec(lines[i]);
    if (!m) continue;
    const indent = (lines[i].match(/^\s*/) ?? [''])[0].length;
    for (let j = i + 1; j < Math.min(lines.length, i + 80); j++) {
      const close = new RegExp(`^\\s{0,${indent}}\\}\\)\\s*;?\\s*$`);
      if (close.test(lines[j])) {
        blocks.push({ startLine: i, endLine: j });
        break;
      }
    }
  }
  return blocks;
}

function scanJsTestFile(file: string, content: string): FakeTestFinding[] {
  const findings: FakeTestFinding[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SKIP_RE.test(line)) {
      findings.push({ file, line: i + 1, rule: 'skipped-test', severity: 'high', note: `skipped test — it covers nothing while it is skipped: ${line.trim().slice(0, 110)}` });
    }
    if (TAUTOLOGY_RE.test(line)) {
      findings.push({ file, line: i + 1, rule: 'tautology', severity: 'high', note: `expect(<literal>) — asserts a constant against nothing: ${line.trim().slice(0, 110)}` });
    }
    if (LITERAL_TAUTOLOGY_RE.test(line)) {
      findings.push({ file, line: i + 1, rule: 'tautology', severity: 'high', note: `expect(literal).toBe(same literal) — always true: ${line.trim().slice(0, 110)}` });
    }
    if (SELF_TAUTOLOGY_RE.test(line)) {
      findings.push({ file, line: i + 1, rule: 'tautology', severity: 'high', note: `expect(x).toBe(x) — the value is compared with itself: ${line.trim().slice(0, 110)}` });
    }
    if (EMPTY_CATCH_RE.test(line)) {
      findings.push({ file, line: i + 1, rule: 'swallowed-error', severity: 'medium', note: `empty catch block — failures inside are silently ignored: ${line.trim().slice(0, 110)}` });
    }
  }

  // Empty test bodies: no assertion tokens between it( … });
  for (const b of jsTestBlocks(lines)) {
    const body = lines.slice(b.startLine + 1, b.endLine).join('\n');
    if (body.trim().length > 0 && !ASSERT_TOKENS_RE.test(body)) {
      findings.push({
        file,
        line: b.startLine + 1,
        rule: 'no-assertions',
        severity: 'high',
        note: `test body has NO assertion — it cannot fail, so it proves nothing`,
      });
    }
  }

  // Mock-only file: every expect() target is mockish → warn once
  const expectTargets = [...content.matchAll(/\bexpect\(\s*([^()\n]{1,80})\s*\)/g)].map((m) => m[1]);
  const nonMockish = expectTargets.filter((t) => !MOCKISH_RE.test(t));
  if (expectTargets.length >= 3 && nonMockish.length === 0) {
    findings.push({ file, line: 1, rule: 'mock-only', severity: 'warn', note: `all ${expectTargets.length} expect() calls target mocks/spies only — behavior is never verified against real results` });
  }
  return findings;
}

// ------------------------------------------------------------
// Python rules
// ------------------------------------------------------------

function scanPyTestFile(file: string, content: string): FakeTestFinding[] {
  const findings: FakeTestFinding[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/@unittest\.skip|pytest\.mark\.skip\b/.test(t)) {
      findings.push({ file, line: i + 1, rule: 'skipped-test', severity: 'high', note: `skipped test decorator — covers nothing while skipped: ${t.slice(0, 110)}` });
    }
    if (/^assert\s+(True|1|0)\s*$/.test(t)) {
      findings.push({ file, line: i + 1, rule: 'tautology', severity: 'high', note: `bare literal assert — always ${t.startsWith('assert True') || t === 'assert 1' ? 'passes' : 'fails or is vacuous'}: ${t.slice(0, 110)}` });
    }
    if (/assertEqual\(\s*(True|False)\s*,\s*\1\s*\)/.test(t)) {
      findings.push({ file, line: i + 1, rule: 'tautology', severity: 'high', note: `assertEqual(<const>, <same const>) — always true: ${t.slice(0, 110)}` });
    }
    const sameVar = /\bassert\s+(\w+)\s*==\s*\1\b/.exec(t);
    if (sameVar) {
      findings.push({ file, line: i + 1, rule: 'tautology', severity: 'high', note: `assert ${sameVar[1]} == ${sameVar[1]} — the value is compared with itself` });
    }
    // swallowed error: `except …:` whose NEXT meaningful line is pass/… (the
    // common multi-line shape) — or the single-line `except …: pass`.
    if (/^except\b[^:]*:\s*(?:pass|\.\.\.)?\s*$/.test(t)) {
      const inlineSwallow = /:\s*(?:pass|\.\.\.)\s*$/.test(t);
      const nextMeaningful = lines.slice(i + 1, i + 4).map((l) => l.trim()).find((l) => l !== '');
      if (inlineSwallow || nextMeaningful === 'pass' || nextMeaningful === '...') {
        findings.push({ file, line: i + 1, rule: 'swallowed-error', severity: 'medium', note: `except … : pass — the failure is silently swallowed: ${t.slice(0, 110)}` });
      }
    }
  }

  // Test functions with zero assert calls
  const defRe = /^\s*def\s+(test_\w+)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const m = defRe.exec(lines[i]);
    if (!m) continue;
    const indent = (lines[i].match(/^\s*/) ?? [''])[0].length;
    let end = i + 1;
    while (end < lines.length && (end === i + 1 || (lines[end].trim() === '' || (lines[end].match(/^\s*/) ?? [''])[0].length > indent))) {
      if (end > i + 1 && lines[end].trim() !== '' && (lines[end].match(/^\s*/) ?? [''])[0].length <= indent) break;
      end++;
      if (end - i > 120) break;
    }
    const body = lines.slice(i + 1, end).join('\n');
    if (body.trim() && !/assert/.test(body)) {
      findings.push({ file, line: i + 1, rule: 'no-assertions', severity: 'high', note: `test ${m[1]} has NO assert — it cannot fail, so it proves nothing` });
    }
  }
  return findings;
}

// ------------------------------------------------------------
// Public entry
// ------------------------------------------------------------

export interface FakeTestOptions {
  /** Absolute paths of files to inspect (touched files; test files only are scanned). */
  files: string[];
  /** Read contents (utf8) — supplied by the caller so this stays sync-free. */
  read?: (file: string) => Promise<string>;
  maxFiles?: number;
  maxLines?: number;
}

/**
 * Deterministic fake-test sweep over the touched test files. Never throws;
 * unreadable files are skipped silently (honest silence, not a fake pass —
 * the report lists how many files were actually scanned).
 */
export async function detectFakeTests(opts: FakeTestOptions): Promise<FakeTestReport> {
  const read = opts?.read ?? (async (f: string) => {
    const { promises: fs } = await import('node:fs');
    return fs.readFile(f, 'utf8');
  });
  const maxFiles = Math.max(1, Math.min(30, opts?.maxFiles ?? 30));
  const maxLines = Math.max(80, Math.min(4_000, opts?.maxLines ?? 1_200));
  const findings: FakeTestFinding[] = [];
  let scanned = 0;
  const files = (opts?.files ?? []).slice(0, maxFiles);
  for (const file of files) {
    try {
      const isJs = isJsTestFile(file);
      const isPy = isPyTestFile(file);
      if (!isJs && !isPy) continue;
      const content = await read(file);
      const lines = content.split('\n');
      if (lines.length > maxLines) {
        findings.push({ file, line: 1, rule: 'too-large', severity: 'warn', note: `test file has ${lines.length} lines — only the first ${maxLines} were swept` });
      }
      const slice = lines.slice(0, maxLines).join('\n');
      scanned++;
      findings.push(...(isJs ? scanJsTestFile(file, slice) : scanPyTestFile(file, slice)));
    } catch {
      /* unreadable — skip */
    }
  }
  const high = findings.filter((f) => f.severity === 'high').length;
  const summary = scanned === 0
    ? 'no test files among the touched files — nothing swept'
    : `${scanned} test file(s) swept: ${findings.length} finding(s), ${high} high-severity`;
  return { scanned, findings, high, summary };
}

/** One-line instruction for the agent when fakes were found. */
export function fakeTestDirective(report: FakeTestReport): string {
  if (!report.findings.length) return '';
  const top = report.findings
    .filter((f) => f.severity === 'high')
    .slice(0, 6)
    .map((f) => `- ${path.basename(f.file)}:${f.line} [${f.rule}] ${f.note}`)
    .join('\n');
  return top
    ? `FAKE-TEST GATE: these tests are decorations, not tests — fix them with REAL assertions:\n${top}`
    : '';
}
