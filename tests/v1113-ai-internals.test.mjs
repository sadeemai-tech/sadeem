import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.13 — INTERNAL AI-CAPABILITY UPGRADES (Vibe Coder)
// Offline verification of: prompt-section injection + cache
// stability + deterministic self-critique + Run & Show report.
// Run:
//   node --test --test-force-exit tests/v1113-ai-internals.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1113-internals-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN,
    entry,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${out}`,
    '--external:electron',
  ], { cwd: ROOT, stdio: 'pipe' });
}

const promptsMod = join(tmp, 'prompts.cjs');
const flowMod = join(tmp, 'vibeFlow.cjs');
bundle(join(ROOT, 'electron/agent/prompts.ts'), promptsMod);
bundle(join(ROOT, 'electron/agent/vibeFlow.ts'), flowMod);
const prompts = require(promptsMod);
const flow = require(flowMod);

const BASE = { workspace: join(tmp, 'ws'), mode: 'default', platform: 'win32' };

// ------------------------------------------------------------
// 1. PROMPT INJECTION
// ------------------------------------------------------------

test('v11.13: buildSystemPrompt injects all four Vibe Flow sections by default', () => {
  const p = prompts.buildSystemPrompt(BASE);
  for (const marker of [
    '# Vibe Coder contract',
    '# Polyglot engineering (any language)',
    '# Run & Show (signature)',
    '# Self-critique before the final answer',
  ]) {
    assert.ok(p.includes(marker), `section injected: ${marker}`);
  }
  // substantive directives, not empty headings
  assert.ok(p.includes('PLAN FIRST'), 'plan-first directive present');
  assert.ok(p.includes('LSP FIRST'), 'LSP-first directive present');
  assert.ok(p.includes('DETECT BEFORE EDITING'), 'build/test detection directive present');
  assert.ok(p.includes('VERIFIED vs ASSUMED'), 'verified-vs-assumed directive present');
});

test('v11.13: every pre-existing prompt section is preserved', () => {
  const p = prompts.buildSystemPrompt({ ...BASE, playbook: 'ADVISORY DEFAULTS\nlesson', dna: 'learned', skills: [{ name: 'x', description: 'y' }] });
  for (const heading of [
    '# Capability contract (read this first)',
    '# Core rules',
    '# Discipline',
    '# Verify before done',
    '# TOOL STRATEGY — how to actually use this toolbox',
    '# WHICH TOOL WHEN',
    '# Specialist subagents (use via task tool)',
    '# Living Playbook (learned from runs in this workspace)',
    '# User DNA (evolves with this user)',
    '# SKILLS',
    '# Permission mode',
  ]) {
    assert.ok(p.includes(heading), `existing section preserved: ${heading}`);
  }
});

test('v11.13: vibeCoder:false omits the layer without touching other sections', () => {
  const off = prompts.buildSystemPrompt({ ...BASE, vibeCoder: false });
  assert.ok(!off.includes('# Vibe Coder contract'), 'Vibe section omitted');
  assert.ok(!off.includes('# Polyglot engineering'), 'polyglot section omitted');
  assert.ok(off.includes('# Capability contract (read this first)'), 'other sections intact');
});

test('v11.13: prompt is word-stable across calls (prompt-cache friendly)', () => {
  const a = prompts.buildSystemPrompt({ ...BASE, language: 'en' });
  const b = prompts.buildSystemPrompt({ ...BASE, language: 'en' });
  assert.equal(a, b, 'identical system prompt on repeated builds');
  const s1 = flow.buildVibeFlowSections('en');
  const s2 = flow.buildVibeFlowSections('en');
  assert.equal(s1, s2, 'Vibe Flow body is deterministic');
  assert.ok(s1.includes(flow.VIBE_FLOW_MARKER), 'marker matches module constant');
});

test('v11.13: Arabic UI injects bilingual Vibe Flow lines', () => {
  const p = prompts.buildSystemPrompt({ ...BASE, language: 'ar' });
  assert.ok(p.includes('خطّط أولًا'), 'Arabic plan-first line present');
  assert.ok(p.includes('استخدم LSP أولًا'), 'Arabic polyglot line present');
  assert.ok(p.includes('مُتحقَّق مقابل مفترض'), 'Arabic verified-vs-assumed line present');
  // English technical terms stay verbatim
  assert.ok(p.includes('LSP FIRST'), 'English terms kept for model reliability');
});

// ------------------------------------------------------------
// 2. DETERMINISTIC MODULE FUNCTIONS
// ------------------------------------------------------------

test('v11.13: polyglot + Run & Show + self-critique sections stay concise', () => {
  assert.ok(flow.polyglotSection('en').length < 1500, 'polyglot note is compact');
  assert.ok(flow.runAndShowSection('en').length < 1500, 'run&show directive is compact');
  assert.ok(flow.selfCritiqueSection('en').length < 1200, 'self-critique directive is compact');
  assert.ok(flow.polyglotSection('en').includes('web_fetch'), 'official-docs lookup included');
});

test('v11.13: selfCritique is deterministic and reports completion correctly', () => {
  const base = {
    finalText: 'Done — edited file and ran tests.',
    writesThisRun: true,
    commandsRun: 2,
    verificationRan: true,
    verificationPassed: true,
    unverifiedClaims: [],
    claimsTotal: 1,
  };
  const r1 = flow.selfCritique(base);
  assert.deepEqual(r1, flow.selfCritique(base), 'same input → same output');
  assert.equal(r1.completed, true, 'complete when work + evidence + no unverified claims');
  assert.deepEqual(r1.verifiedEvidence, ['2 command(s) executed', 'verification passed']);
  assert.ok(r1.footer.includes('Verified:'));
  assert.ok(r1.footer.includes('Status: complete'));
});

test('v11.13: selfCritique flags unverified claims and missing verification', () => {
  const r = flow.selfCritique({
    finalText: 'Done — all tests pass.',
    writesThisRun: true,
    commandsRun: 0,
    verificationRan: false,
    verificationPassed: null,
    unverifiedClaims: ['all tests pass', 'refactored the parser'],
    claimsTotal: 3,
  });
  assert.equal(r.completed, false, 'partial when code changed with no verification');
  assert.equal(r.unverified.length, 2);
  assert.equal(r.claimsTotal, 3);
  assert.ok(r.notes.some((n) => n.includes('no verification run was recorded')), 'missing verification noted');
  assert.ok(r.notes.some((n) => n.includes('without tool evidence')), 'unverified claims noted');
  assert.ok(r.footer.includes('Status: partial'));
});

test('v11.13: selfCritique detects hollow completion claims and is bilingual in Arabic', () => {
  const hollow = flow.selfCritique({
    finalText: 'تم إنهاء المهمة',
    language: 'ar',
    writesThisRun: false,
    commandsRun: 0,
    verificationRan: false,
    verificationPassed: null,
  });
  assert.equal(hollow.completed, false);
  assert.ok(hollow.notes.some((n) => n.includes('no writes or commands')));
  assert.ok(hollow.footer.includes('المُتحقَّق:'), 'Arabic footer present');
  assert.ok(hollow.footer.includes('Verified:'), 'English footer retained (bilingual)');
  assert.ok(hollow.footer.includes('جزئي'), 'Arabic status present');
});

test('v11.13: unverifiedFromAudit extracts only unsupported claims', () => {
  const audit = {
    claims: [
      { claim: 'edited src/a.ts', kind: 'file-edit', supported: true, note: '' },
      { claim: 'all tests pass', kind: 'test', supported: false, note: '' },
      { claim: 'ran npm run build', kind: 'command', supported: true, note: '' },
    ],
    unsupportedCount: 1,
    summary: '1 unsupported',
  };
  assert.deepEqual(flow.unverifiedFromAudit(audit), ['all tests pass']);
});

// ------------------------------------------------------------
// 3. RUN & SHOW (honest, text-only transcript)
// ------------------------------------------------------------

test('v11.13: Run & Show reports the real result with a terminal-style transcript', () => {
  const ok = flow.runAndShowSummary({
    command: 'npm test',
    exitCode: 0,
    outputTail: 'PASS src/a.test.ts\n12 tests passed (1.8s)',
    durationMs: 1800,
  }, 'en');
  assert.ok(ok.includes('$ npm test'), 'real command shown');
  assert.ok(ok.includes('exit 0'), 'real exit code shown');
  assert.ok(ok.includes('PASSED'), 'status shown');
  assert.ok(ok.includes('12 tests passed'), 'real output line shown');
  assert.ok(!/screenshot|\.png/i.test(ok), 'no fake screenshot');

  const fail = flow.runAndShowSummary({ command: 'npm test', exitCode: 1, outputTail: 'FAIL src/b.test.ts' }, 'en');
  assert.ok(fail.includes('✗ exit 1') && fail.includes('FAILED'), 'failure reported honestly');
});

test('v11.13: Run & Show is honest when no runner / no exit / aborted', () => {
  const none = flow.runAndShowSummary({ command: null }, 'en');
  assert.ok(none.includes('no runner detected'), 'no-runner honesty');
  const noExit = flow.runAndShowSummary({ command: 'make check', exitCode: null }, 'en');
  assert.ok(noExit.includes('did not report an exit code'), 'no-exit honesty');
  const aborted = flow.runAndShowSummary({ command: 'npm test', exitCode: 0, aborted: true }, 'en');
  assert.ok(aborted.includes('aborted'), 'abort honesty, no green claim');
  const ar = flow.runAndShowSummary({ command: null }, 'ar');
  assert.ok(ar.includes('لم يُكتشف مشغّل'), 'Arabic honesty line');
  assert.ok(ar.includes('RUN & SHOW'), 'English term retained');
  const skipped = flow.runAndShowSummary({ command: 'npm test', skippedReason: 'approval required' }, 'en');
  assert.ok(skipped.includes('npm test') && skipped.includes('approval required'), 'permission skip reported honestly');
});

test('v11.13: summarizeOutputTail is deterministic and prefers meaningful lines', () => {
  const tail = '\n\nbuilding...\nPASS src/a.test.ts\nnoise line\nFAIL src/b.test.ts\n';
  const s1 = flow.summarizeOutputTail(tail);
  assert.deepEqual(s1, flow.summarizeOutputTail(tail), 'deterministic');
  assert.deepEqual(s1, ['PASS src/a.test.ts', 'FAIL src/b.test.ts'], 'test status lines preferred');
  assert.deepEqual(flow.summarizeOutputTail(''), [], 'empty tail → empty');
  const long = 'x'.repeat(500);
  assert.ok(flow.summarizeOutputTail(long)[0].length <= 160, 'lines capped');
});

test.after(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});
