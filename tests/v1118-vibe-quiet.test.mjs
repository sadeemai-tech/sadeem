import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.18 — VIBE QUIET / NOTICE POLICY
// Audit / proof / critique notices are emitted ONLY for REAL work.
// A simple chat turn (no writes, no commands, no tools) must produce
// no advisory footer, no empty "Run & Show" card, and no claim audit.
//
// Run:
//   node --test --test-force-exit tests/v1118-vibe-quiet.test.mjs
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
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1118-quiet-'));

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

const flowMod = join(tmp, 'vibeFlow.cjs');
bundle(join(ROOT, 'electron/agent/vibeFlow.ts'), flowMod);
const flow = require(flowMod);

// Arabic script detector — used to prove EN output is not language-mixed.
const ARABIC_RE = /\p{Script=Arabic}/u;

const SIMPLE_TURN = {
  finalText: 'Sure — the capital of France is Paris.',
  language: 'en',
  writesThisRun: false,
  commandsRun: 0,
  verificationRan: false,
  verificationPassed: null,
  unverifiedClaims: [],
  claimsTotal: 0,
};

const REAL_WORK = {
  finalText: 'Done — edited the parser and ran the test suite.',
  language: 'en',
  writesThisRun: true,
  commandsRun: 2,
  verificationRan: true,
  verificationPassed: true,
  unverifiedClaims: [],
  claimsTotal: 1,
};

// ------------------------------------------------------------
// 1. SIMPLE TURN → helpers return empty (notices become no-ops)
// ------------------------------------------------------------

test('v11.18: selfCritique simple turn returns an empty footer (EN + AR)', () => {
  const en = flow.selfCritique(SIMPLE_TURN);
  assert.equal(en.footer, '', 'EN simple turn → no advisory footer');
  const ar = flow.selfCritique({ ...SIMPLE_TURN, language: 'ar' });
  assert.equal(ar.footer, '', 'AR simple turn → no advisory footer');
  // The whole result stays well-formed (only the footer is suppressed).
  assert.equal(en.completed, false);
  assert.deepEqual(en.unverified, []);
  assert.deepEqual(en.verifiedEvidence, []);
});

test('v11.18: runAndShowSummary with quiet=true and no command returns exactly empty', () => {
  assert.equal(flow.runAndShowSummary({ command: null, quiet: true }, 'en'), '');
  assert.equal(flow.runAndShowSummary({ command: null, quiet: true }, 'ar'), '');
  // Exactly '' — not whitespace / newline noise.
  assert.equal(flow.runAndShowSummary({ command: null, quiet: true }, 'en').length, 0);
});

test('v11.18: shouldEmitClaimAudit blocks simple turns', () => {
  assert.equal(
    flow.shouldEmitClaimAudit({ claimsTotal: 0, writes: 0, commands: 0 }),
    false,
    'no work, no claims → no audit notice',
  );
  // auditClaims() classifies every sentence as a claim, so a plain chat
  // answer can have claims>0 — but with no real work it still emits nothing.
  assert.equal(
    flow.shouldEmitClaimAudit({ claimsTotal: 3, writes: 0, commands: 0 }),
    false,
    'chat prose claims with zero work → no audit notice',
  );
  assert.equal(
    flow.shouldEmitClaimAudit({ claimsTotal: 0, writes: 1, commands: 0 }),
    false,
    'work but nothing to audit → no empty audit notice',
  );
});

// ------------------------------------------------------------
// 2. REAL WORK → full advisory footer / honest Run & Show card
// ------------------------------------------------------------

test('v11.18: selfCritique real work keeps the full advisory footer', () => {
  const en = flow.selfCritique(REAL_WORK);
  assert.equal(en.completed, true);
  assert.ok(en.footer.includes('Verified:'));
  assert.ok(en.footer.includes('Status: complete'));
  assert.ok(en.footer.includes('2 command(s) executed'));
  const ar = flow.selfCritique({ ...REAL_WORK, language: 'ar' });
  assert.ok(ar.footer.includes('Verified:'), 'bilingual: EN retained');
  assert.ok(ar.footer.includes('المُتحقَّق:'), 'bilingual: AR advisory present');
});

test('v11.18: shouldEmitClaimAudit allows real work with claims', () => {
  assert.equal(flow.shouldEmitClaimAudit({ claimsTotal: 2, writes: 1, commands: 0 }), true, 'file writes');
  assert.equal(flow.shouldEmitClaimAudit({ claimsTotal: 2, writes: 0, commands: 1 }), true, 'commands run');
  assert.equal(flow.shouldEmitClaimAudit({ claimsTotal: 2, writes: 2, commands: 3 }), true, 'both');
});

test('v11.18: a hollow completion claim is NOT quiet (regression guard)', () => {
  // A false-done claim with no work is exactly what critique must flag;
  // it must keep the advisory footer even though writes/commands are zero.
  const hollow = flow.selfCritique({
    finalText: 'تم إنهاء المهمة',
    language: 'ar',
    writesThisRun: false,
    commandsRun: 0,
    verificationRan: false,
    verificationPassed: null,
  });
  assert.notEqual(hollow.footer, '', 'hollow completion claim keeps critique');
  assert.ok(hollow.footer.includes('المُتحقَّق:'));
  const hollowEn = flow.selfCritique({ ...hollow, finalText: 'Done, task finished.', language: 'en' });
  assert.notEqual(hollowEn.footer, '', 'EN hollow completion claim keeps critique');
});

test('v11.18: real Run & Show result still renders the honest transcript', () => {
  const ok = flow.runAndShowSummary({
    command: 'npm test',
    exitCode: 0,
    outputTail: 'PASS src/a.test.ts\n12 tests passed (1.8s)',
    durationMs: 1800,
    quiet: true, // quiet only affects the no-command branch
  }, 'en');
  assert.ok(ok.includes('$ npm test'));
  assert.ok(ok.includes('exit 0'));
  assert.ok(ok.includes('12 tests passed'));
});

test('v11.18: default no-runner line is preserved (v1113 compatibility)', () => {
  assert.ok(flow.runAndShowSummary({ command: null }, 'en').includes('no runner detected'));
  assert.ok(flow.runAndShowSummary({ command: null }, 'ar').includes('لم يُكتشف مشغّل'));
});

// ------------------------------------------------------------
// 3. NO MIXED-LANGUAGE STRINGS
// ------------------------------------------------------------

test('v11.18: EN advisory footer contains no Arabic script', () => {
  assert.equal(ARABIC_RE.test(flow.selfCritique(REAL_WORK).footer), false, 'EN footer is pure English');
  assert.equal(ARABIC_RE.test(flow.runAndShowSummary({ command: 'npm test', exitCode: 0 }, 'en')), false, 'EN transcript is pure English');
});

test('v11.18: quiet outputs are exactly empty — no stray bilingual fragments', () => {
  const outputs = [
    flow.selfCritique(SIMPLE_TURN).footer,
    flow.selfCritique({ ...SIMPLE_TURN, language: 'ar' }).footer,
    flow.runAndShowSummary({ command: null, quiet: true }, 'en'),
    flow.runAndShowSummary({ command: null, quiet: true }, 'ar'),
  ];
  for (const out of outputs) {
    assert.equal(out, '', 'no mixed-language or stray text in quiet output');
    assert.equal(ARABIC_RE.test(out), false);
  }
});

test.after(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});
