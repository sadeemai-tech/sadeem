import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.23 — PROMPT ACCURACY / ERROR-HONESTY REGRESSION GUARD
// ------------------------------------------------------------
// Founder report: "the AI gives wrong answers and random errors".
// Scope: electron/agent/prompts.ts ONLY (prompt-only fix). This suite
// verifies the v11.22 ACCURACY CONTRACT survived intact and that the
// v11.23 additions (ERROR HONESTY + immediate-vs-verify fix) did not
// regress the cache, the byte cap, the language policy or any legacy
// heading/hook.
//
//   1. RENDER     — buildSystemPrompt renders EN + AR.
//   2. CONTRACT   — ACCURACY CONTRACT is present, high in the CACHEABLE
//                   STATIC PREFIX (before the sentinel), in BOTH languages.
//   3. WORD-STABLE— no interpolation in the new static blocks; identical
//                   static prefix across dynamic-context changes.
//   4. HONESTY    — ERROR HONESTY clause present in the static prefix with
//                   all mandated semantics (exact failure, next step, no
//                   invented result, no silent retry, no language mixing).
//   5. NO HEDGING — no refusal/hedging wording in the two accuracy blocks;
//                   the "answer immediately" directive now defers to tool
//                   verification; capability headings survive.
//   6. BYTES      — EN prompt < 24 KB; net delta vs the pre-v11.23 baseline
//                   bounded (<400 B); the v11.16/v11.21 caps still hold.
//   7. LEGACY     — every legacy heading/hook is preserved.
//
// Honest scope note: a system prompt can only steer behavior. It cannot
// raise a weak model's underlying reasoning/capability — this suite guards
// the TEXT contract, not model quality.
//
// Run: node --test --test-force-exit tests/v1123-prompt-accuracy.test.mjs
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
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1123-accuracy-'));

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
const HONESTY_HEADING = '# ERROR HONESTY';
const CONTRACT_MARKERS = [
  'Correctness beats speed: verify, never guess.',
  'Never assert a workspace/project fact (path, file, API, version) without READING it with a tool first (read_file / search_files / web_fetch).',
  'Priors are hints, not facts.',
  'Label OBSERVED (tool output) vs INFERRED (reasoning); never present a guess as observed.',
  'Unsure of a path/API/version? VERIFY with a tool BEFORE answering',
  'Verification impossible? Say so honestly + give the next step — NOT refusal; keep working.',
];
const HONESTY_MARKERS = [
  'tool/provider failure',
  'say exactly what failed',
  'next step',
  'never invent a result',
  'never silently retry',
  'never mix languages',
];
const LEGACY_HEADINGS = [
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

/** Slice a rendered section from its heading up to the next `\n\n# `. */
function section(prompt, heading) {
  const at = prompt.indexOf(heading);
  if (at < 0) return '';
  const end = prompt.indexOf('\n\n# ', at + heading.length);
  return end < 0 ? prompt.slice(at) : prompt.slice(at, end);
}

// ---------- 1. RENDER EN + AR ----------

test('v1123 render: buildSystemPrompt renders a complete prompt in EN and AR', () => {
  const en = prompts.buildSystemPrompt({ ...BASE });
  const ar = prompts.buildSystemPrompt({ ...BASE, language: 'ar' });
  for (const [lang, prompt] of [['en', en], ['ar', ar]]) {
    assert.ok(prompt.length > 1000, `${lang}: prompt is fully rendered (${prompt.length} chars)`);
    assert.ok(prompt.includes('You are SADEEM'), `${lang}: identity line present`);
    assert.ok(prompt.includes(prompts.SYSTEM_CACHE_SPLIT), `${lang}: cache split sentinel present`);
    assert.ok(prompt.includes('# Environment'), `${lang}: dynamic environment tail present`);
  }
  // AR sections are bilingual by design (English technical terms + Arabic).
  assert.ok(ar.includes('# Core rules | القواعد الأساسية'), 'ar: bilingual core-rules heading rendered');
});

// ---------- 2. CONTRACT HIGH IN THE CACHED PREFIX ----------

test('v1123 contract: ACCURACY CONTRACT is intact and lives in the STATIC PREFIX for EN and AR', () => {
  for (const lang of ['en', 'ar']) {
    const prompt = prompts.buildSystemPrompt({ ...BASE, language: lang, memory: 'DYNAMIC_TAIL_MARKER' });
    const [prefix, tail] = prompt.split(prompts.SYSTEM_CACHE_SPLIT);
    assert.equal(tail !== undefined, true, `${lang}: cache sentinel present`);
    assert.ok(prefix.includes(CONTRACT_HEADING), `${lang}: contract heading in static prefix`);
    for (const marker of CONTRACT_MARKERS) {
      assert.ok(prefix.includes(marker), `${lang}: stable contract line in prefix — ${marker.slice(0, 44)}…`);
    }
    assert.ok(!tail.includes(CONTRACT_HEADING), `${lang}: contract NOT duplicated in dynamic tail`);
  }
  // "High in the cached prefix": the contract must precede every legacy
  // section (it sits immediately after identity/capability mindset).
  const en = prompts.buildSystemPrompt({ ...BASE });
  assert.ok(en.indexOf(CONTRACT_HEADING) < en.indexOf('# Core rules'), 'contract precedes core rules (high in prefix)');
  assert.ok(en.indexOf(CONTRACT_HEADING) < en.indexOf('# Tool notes'), 'contract precedes tool notes');
});

// ---------- 3. WORD-STABLE / NO INTERPOLATION ----------

test('v1123 word-stable: new accuracy blocks are static text and the cached prefix is byte-identical', () => {
  const src = readFileSync(join(ROOT, 'electron/agent/prompts.ts'), 'utf8');
  const from = src.indexOf(CONTRACT_HEADING);
  const to = src.indexOf('// ---------- core rules');
  assert.ok(from > 0 && to > from, 'source block boundaries found');
  const block = src.slice(from, to);
  assert.ok(!block.includes('${'), 'accuracy blocks have NO template interpolation');
  assert.ok(!/opts\.|new Date|process\./.test(block), 'accuracy blocks read no dynamic opts/clock/env');

  prompts.clearStaticPromptCache();
  const a = prompts.buildSystemPrompt({ ...BASE });
  const b = prompts.buildSystemPrompt({ ...BASE, memory: 'different', dna: 'different', mcpTools: ['x'] });
  const splitA = a.split(prompts.SYSTEM_CACHE_SPLIT)[0];
  const splitB = b.split(prompts.SYSTEM_CACHE_SPLIT)[0];
  assert.equal(splitA, splitB, 'dynamic context does not change one byte of the cached prefix');
  assert.equal(section(a, CONTRACT_HEADING), section(b, CONTRACT_HEADING), 'contract bytes are word-stable');
});

// ---------- 4. ERROR HONESTY ----------

test('v1123 honesty: ERROR HONESTY clause is in the static prefix with all mandated semantics', () => {
  for (const lang of ['en', 'ar']) {
    const prompt = prompts.buildSystemPrompt({ ...BASE, language: lang, memory: 'dynamic' });
    const prefix = prompt.split(prompts.SYSTEM_CACHE_SPLIT)[0];
    assert.ok(prefix.includes(HONESTY_HEADING), `${lang}: ERROR HONESTY heading in static prefix`);
    const block = section(prefix, HONESTY_HEADING);
    for (const marker of HONESTY_MARKERS) {
      assert.ok(block.includes(marker), `${lang}: honesty marker present — ${marker}`);
    }
  }
  // English static text is identical in both renderings (cache-safe).
  const en = section(prompts.buildSystemPrompt({ ...BASE }), HONESTY_HEADING);
  const ar = section(prompts.buildSystemPrompt({ ...BASE, language: 'ar' }), HONESTY_HEADING);
  assert.equal(en, ar, 'ERROR HONESTY is word-stable across languages');
});

// ---------- 5. NO REFUSAL HEDGING + CONTRADICTION FIX ----------

test('v1123 no-hedging: accuracy blocks refuse nothing and the immediate-vs-verify contradiction is resolved', () => {
  const prompt = prompts.buildSystemPrompt({ ...BASE });
  for (const block of [section(prompt, CONTRACT_HEADING), section(prompt, HONESTY_HEADING)]) {
    assert.ok(block, 'accuracy block extracted');
    for (const banned of ["I can't", 'cannot', 'unable', 'refuse to', "I don't have", 'hedge']) {
      assert.ok(!block.includes(banned), `no refusal/hedging wording: "${banned}"`);
    }
  }
  // "Act immediately" now means a prompt tool action + verified claims only.
  const first = prompt.split('\n').find((l) => l.includes('FIRST TOKEN DISCIPLINE'));
  assert.ok(first, 'FIRST TOKEN DISCIPLINE directive still present');
  assert.ok(first.includes('next tool action'), 'immediate step is a TOOL action, not an unverified answer');
  assert.ok(first.includes('verify facts with tools before asserting them'), 'verification precedes assertions');
  assert.ok(!first.includes('answer/reasoning IMMEDIATELY'), 'old answer-immediately wording removed');
  // Capability mindset / language policy survive, unweakened.
  for (const keep of [
    '# Capability contract (read this first)',
    '# CAPABILITY MINDSET',
    'Assume you CAN accomplish it',
    'LANGUAGE POLICY (mandatory)',
    'never mix languages in prose',
    'ARABIC-FIRST',
  ]) {
    assert.ok(prompt.includes(keep), `preserved directive: ${keep}`);
  }
});

// ---------- 6. BYTE CAPS ----------

test('v1123 bytes: EN prompt < 24 KB, v11.21 delta cap holds, v11.23 net delta < 400 B', () => {
  const en = prompts.buildSystemPrompt({ ...BASE });
  const size = bytes(en);
  assert.ok(size < 24 * 1024, `EN prompt < 24 KB (got ${size} bytes)`);

  // v11.21 hard cap: baseline 23754 + 700. v11.16 hard cap: 24 KB (tested above).
  const V1121_BASELINE = 23754;
  assert.ok(size - V1121_BASELINE <= 700, `v11.21 total-delta cap holds (got +${size - V1121_BASELINE})`);

  // Pre-v11.23 baseline measured before this change (24381 bytes). The
  // v11.23 additions + contradiction fix + redundancy trimming must stay
  // bounded at < 400 B net.
  const PRE_V1123_BASELINE = 24381;
  const net = size - PRE_V1123_BASELINE;
  assert.ok(net >= 0, 'the accuracy guidance was actually added');
  assert.ok(net < 400, `v11.23 net byte delta < 400 B (got +${net})`);

  // The ACCURACY CONTRACT block itself stays inside its 600 B budget.
  const contractNet = bytes(section(en, CONTRACT_HEADING)) + 2;
  assert.ok(contractNet <= 600, `contract net bytes ≤ 600 (got ${contractNet})`);
});

// ---------- 7. LEGACY HEADINGS / HOOKS ----------

test('v1123 legacy: every legacy heading and hook survives the accuracy edit', () => {
  const en = prompts.buildSystemPrompt({ ...BASE });
  for (const heading of LEGACY_HEADINGS) {
    assert.ok(en.includes(heading), `legacy heading preserved: ${heading}`);
  }
  // Hooks the engine/providers rely on.
  assert.ok(en.includes(prompts.SYSTEM_CACHE_SPLIT), 'cache-split hook preserved');
  assert.ok(en.includes('NO FORCED TEMPLATES'), 'output-discipline hook preserved');
  assert.ok(en.includes('image_generate') && en.includes('desktop_control'), 'tool-name hooks preserved');

  // Conditional legacy headings render with their trigger opts.
  const ruleWs = join(tmp, 'rule-ws');
  mkdirSync(ruleWs, { recursive: true });
  writeFileSync(join(ruleWs, 'AGENTS.md'), '# rules\n- test rule');
  const withRules = prompts.buildSystemPrompt({ ...BASE, workspace: ruleWs });
  assert.ok(withRules.includes('# PROJECT RULES'), 'conditional legacy heading # PROJECT RULES preserved');
});

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
