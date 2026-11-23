import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.21 — AI ANSWER-QUALITY / ACCURACY-CONTRACT TESTS
// ------------------------------------------------------------
// Source-level + buildSystemPrompt regression guards for the prompt-only
// fix to "the AI makes mistakes / gives wrong answers". Scope is strictly
// electron/agent/prompts.ts (DIAGNOSIS + FIX subagent): no engine/providers/
// tools/store changes are asserted here.
//
// What is verified:
//   1. SOURCE   — the word-stable ACCURACY CONTRACT block exists with its
//                 stable phrases and NO dynamic interpolation (cache-safe).
//   2. RENDER   — buildSystemPrompt injects the contract in EN and AR and it
//                 lives in the CACHEABLE STATIC PREFIX (before the sentinel).
//   3. NO REFUSAL — the contract does not reintroduce refusal/hedging words
//                 and the capability-mindset headings survive intact.
//   4. LANGUAGE — Arabic → fully Arabic, English → English only, no mixing.
//   5. BYTES    — contract ≤600 bytes net; full EN prompt < 24 KB; total
//                 delta vs the pre-change baseline is bounded.
//   6. LEGACY   — every pre-existing legacy heading is preserved.
//
// Run: node --test --test-force-exit tests/v1121-ai-quality.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1121-aiq-'));

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

const promptsPath = join(tmp, 'prompts.cjs');
bundle(join(ROOT, 'electron/agent/prompts.ts'), promptsPath);
const prompts = require(promptsPath);

const bytes = (s) => Buffer.byteLength(s, 'utf8');
const BASE = { workspace: 'D:/surnia-test-ws', mode: 'default', platform: 'win32', language: 'en' };

const CONTRACT_HEADING = '# ACCURACY CONTRACT (verify, not guess)';
const CONTRACT_MARKERS = [
  'Correctness beats speed: verify, never guess.',
  'Never assert a workspace/project fact (path, file, API, version) without READING it with a tool first (read_file / search_files / web_fetch).',
  'Priors are hints, not facts.',
  'Label OBSERVED (tool output) vs INFERRED (reasoning); never present a guess as observed. State assumptions in one line.',
  'Unsure of a path/API/version? VERIFY with a tool BEFORE answering',
  'Verification impossible? Say so honestly + give the next step — NOT refusal; keep working.',
];

/** Extract the ACCURACY CONTRACT block from a rendered prompt (up to the next section). */
function contractBlock(prompt) {
  const m = prompt.match(/# ACCURACY CONTRACT[^\n]*[\s\S]*?(?=\n\n# )/);
  return m ? m[0] : '';
}

// ---------- 1. SOURCE-LEVEL ----------

test('v1121 source: prompts.ts carries a word-stable ACCURACY CONTRACT (no interpolation)', () => {
  const src = readFileSync(join(ROOT, 'electron/agent/prompts.ts'), 'utf8');
  assert.ok(src.includes(CONTRACT_HEADING), `source defines the contract heading: ${CONTRACT_HEADING}`);
  for (const marker of CONTRACT_MARKERS) {
    assert.ok(src.includes(marker), `source carries stable contract line: ${marker.slice(0, 48)}…`);
  }
  // The contract block must be static text — no template expressions, so the
  // provider prefix cache sees identical bytes on every turn.
  const block = src.slice(src.indexOf(CONTRACT_HEADING), src.indexOf('// ---------- core rules'));
  assert.ok(!block.includes('${'), 'contract block has NO dynamic interpolation (word-stable)');
  assert.ok(!/opts\.|new Date|process\./.test(block), 'contract reads no dynamic opts/clock/env');
});

// ---------- 2. RENDER: present in EN + AR, inside the cacheable prefix ----------

test('v1121 render: contract is injected in EN and AR and lives in the STATIC PREFIX (before the cache sentinel)', () => {
  const en = prompts.buildSystemPrompt({ ...BASE });
  const ar = prompts.buildSystemPrompt({ ...BASE, language: 'ar' });
  for (const [lang, prompt] of [['en', en], ['ar', ar]]) {
    assert.ok(prompt.includes(CONTRACT_HEADING), `${lang}: contract heading present`);
    for (const marker of CONTRACT_MARKERS) {
      assert.ok(prompt.includes(marker), `${lang}: contract line present — ${marker.slice(0, 40)}…`);
    }
  }
  const split = prompts.buildSystemPrompt({ ...BASE, memory: 'dynamic-tail-marker' }).split(prompts.SYSTEM_CACHE_SPLIT);
  assert.equal(split.length, 2, 'cache sentinel present with dynamic context');
  assert.ok(split[0].includes(CONTRACT_HEADING), 'contract is in the byte-stable prefix, NOT the dynamic tail');
  assert.ok(!split[1].includes(CONTRACT_HEADING), 'contract is not duplicated in the dynamic tail');
});

// ---------- 3. NO REFUSAL / no contradiction with capability mindset ----------

test('v1121 no-refusal: accuracy is achieved by verification, never by refusing or hedging', () => {
  const block = contractBlock(prompts.buildSystemPrompt({ ...BASE }));
  assert.ok(block, 'contract block extracted');
  // Accuracy via verification — the block must NOT reintroduce refusal language.
  for (const banned of ["I can't", 'cannot', 'unable', 'refuse to', 'I don\'t have', 'hedge']) {
    assert.ok(!block.includes(banned), `contract does not say "${banned}"`);
  }
  assert.ok(/NOT refusal; keep working/.test(block), 'contract explicitly says this is NOT refusal');
  assert.ok(/VERIFY with a tool BEFORE answering/.test(block), 'contract mandates tool verification');
  // Capability mindset survives, unweakened.
  const en = prompts.buildSystemPrompt({ ...BASE });
  for (const keep of [
    '# Capability contract (read this first)',
    '# CAPABILITY MINDSET',
    'Assume you CAN accomplish it',
    'NEVER say',
    'never hedge, never refuse',
  ]) {
    assert.ok(en.includes(keep), `capability marker preserved: ${keep}`);
  }
});

// ---------- 4. LANGUAGE POLICY ----------

test('v1121 language policy: Arabic → full Arabic, English → English only, no mixed prose', () => {
  const en = prompts.buildSystemPrompt({ ...BASE });
  for (const marker of [
    'LANGUAGE POLICY (mandatory)',
    'reply in the SAME language the user writes, FULLY',
    'Arabic → fully Arabic prose (no English sentences)',
    'English → English only',
    'never mix languages in prose',
    'ARABIC-FIRST',
  ]) {
    assert.ok(en.includes(marker), `language-policy marker present: ${marker}`);
  }
  // The old weaker wording that allowed drifting/mixing is gone.
  assert.ok(!en.includes('Arabic for Arabic (natural, not machine-translated)'), 'old ambiguous policy wording removed');
});

// ---------- 5. BYTE DELTA BOUNDED ----------

test('v1121 bytes: contract ≤600 bytes net; full prompt < 24 KB; total delta bounded', () => {
  const en = prompts.buildSystemPrompt({ ...BASE });
  const block = contractBlock(en);
  // +2 accounts for the '\n\n' part separator: net addition to the prefix.
  const contractNet = bytes(block) + 2;
  assert.ok(contractNet <= 600, `contract net bytes must be ≤600, got ${contractNet} (block ${bytes(block)})`);

  const size = bytes(en);
  assert.ok(size < 24 * 1024, `EN prompt stays under 24 KB (got ${size} bytes)`);

  // Pre-change baseline captured before the v11.21 edits (23754 bytes). The
  // whole fix (contract + strengthened language policy) must stay bounded.
  const PRE_CHANGE_BASELINE = 23754;
  const delta = size - PRE_CHANGE_BASELINE;
  assert.ok(delta > 0, 'the fix actually adds the new guidance');
  assert.ok(delta <= 700, `total byte delta is bounded (got +${delta}, cap +700)`);
});

// ---------- 6. LEGACY HEADINGS PRESERVED ----------

test('v1121 legacy: every pre-existing heading survives the prompt edit', () => {
  const en = prompts.buildSystemPrompt({ ...BASE });
  const legacyHeadings = [
    '# Capability contract (read this first)',
    '# CAPABILITY MINDSET',
    '# Core rules',
    '# Discipline',
    '# Output discipline',
    '# Workspace safety',
    '# Long-task discipline',
    '# Verify before done',
    '# Stack selection & build protocol',
    '# Tool notes',
    '# DEVICE & MEDIA ARSENAL',
    '# BUILDER ARSENAL',
    '# TOOL STRATEGY',
    '# WHICH TOOL WHEN',
    '# POWER TOOL ARSENAL',
    '# Specialist subagents',
    '# Permission mode',
    '# Output style',
    '# Environment',
  ];
  for (const heading of legacyHeadings) {
    assert.ok(en.includes(heading), `legacy heading preserved: ${heading}`);
  }
  // Conditional dynamic headings need their trigger opts present to render.
  const ruleWs = join(tmp, 'rule-ws');
  mkdirSync(ruleWs, { recursive: true });
  writeFileSync(join(ruleWs, 'AGENTS.md'), '# rules\n- test rule');
  const withRules = prompts.buildSystemPrompt({ ...BASE, workspace: ruleWs });
  assert.ok(withRules.includes('# PROJECT RULES'), 'conditional legacy heading # PROJECT RULES preserved');
});

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
