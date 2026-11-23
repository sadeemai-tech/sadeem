import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.32 — REAL-WORK CONTRACT PROMPT GUARD
// ------------------------------------------------------------
// Founder's UX diagnosis (trust his word over code tests):
//   "الذكاء الاصطناعي مليان أخطاء غبية ... التصميم سيء جدا،
//    اللغة المستخدمة خطأ ... 147 تولز ولا يستخدم ولا واحدة ...
//    أحيانا يستخدم MCP وأنا ما حكيت له."
// This suite guards the five high-signal directives added to the
// BYTE-STABLE static prefix (electron/agent/prompts.ts owned file):
//   1. DESIGN QUALITY CONTRACT  2. LANGUAGE DISCIPLINE
//   3. TOOL USE IS MANDATORY    4. MCP IS OPT-IN
//   5. NO STUPID LOOPS
// Checks: EN+AR symmetry, static-prefix placement, byte caps and
// no contradictions with the existing accuracy/capability rules.
//
// Run: node --test --test-force-exit tests/v1132-prompt-real.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1132-real-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`, '--external:electron',
  ], { cwd: ROOT, stdio: 'pipe' });
}

const promptsPath = join(tmp, 'prompts.cjs');
bundle(join(ROOT, 'electron/agent/prompts.ts'), promptsPath);
const prompts = require(promptsPath);

const bytes = (s) => Buffer.byteLength(s, 'utf8');
const BASE = { workspace: 'D:/surnia-test-ws', mode: 'default', platform: 'win32', language: 'en' };
const en = prompts.buildSystemPrompt({ ...BASE });
const ar = prompts.buildSystemPrompt({ ...BASE, language: 'ar' });

// English phrases are emitted in BOTH prompts (bi() returns `${en} — ${ar}`
// in AR mode). Arabic phrases are emitted in the AR prompt only.
const EN_PHRASES = [
  'DESIGN QUALITY CONTRACT',
  'generous whitespace, one confident type scale',
  'a deliberate 2-3 color palette (not generic defaults)',
  'NEVER ship generic boxed-card grids',
  'a default bootstrap/tailwind look',
  'Prefer hand-crafted SVG/CSS over stock images or failing image services',
  'Verify by reading the rendered file back',
  'LANGUAGE DISCIPLINE',
  'EXACTLY in every sentence AND in code comments/UI strings',
  'Arabic request → Arabic UI text, no English prose embedded',
  'TOOL USE IS MANDATORY',
  'read before write, write real files, run the test/build',
  'having tools without calling them is failure',
  'Never answer "I built it" from memory',
  'MCP IS OPT-IN',
  'never just because it exists',
  'Prefer the 145 core tools for ordinary work',
  'NO STUPID LOOPS',
  'after 2 failures switch approach (see engine breaker)',
];
const AR_PHRASES = [
  '# Real-work contract | عقد العمل الواقعي',
  'عقد جودة التصميم',
  'مساحات واسعة، مقياس خط واحد واثق',
  'لا تشحن شبكات بطاقات عامة',
  'انضباط اللغة',
  'الطلب العربي → نصوص واجهة عربية بلا نثر إنجليزي',
  'استخدام الأدوات إلزامي',
  'امتلاك الأدوات دون استخدامها فشل',
  'MCP اختياري',
  'لا لمجرد وجودها',
  'لا حلقات غبية',
  'بعد فشلين غيّر المقاربة',
];

// ---------- 1. new phrases render in EN + AR ----------
test('v1132 phrases: all five directives render in the EN prompt', () => {
  for (const phrase of EN_PHRASES) {
    assert.ok(en.includes(phrase), `EN prompt carries directive phrase: ${phrase}`);
  }
});

test('v1132 phrases: EN + AR are symmetric (EN phrases in both, Arabic phrases in AR)', () => {
  for (const phrase of EN_PHRASES) {
    assert.ok(ar.includes(phrase), `AR prompt is symmetric — carries EN phrase: ${phrase}`);
  }
  for (const phrase of AR_PHRASES) {
    assert.ok(ar.includes(phrase), `AR prompt carries Arabic directive phrase: ${phrase}`);
  }
  assert.ok(!en.includes('عقد العمل الواقعي'), 'EN prompt stays English (no Arabic section heading)');
});

// ---------- 2. directives live in the byte-stable static prefix ----------
test('v1132 cache: the new directives are in the CACHEABLE prefix, not the dynamic tail', () => {
  for (const [lang, prompt] of [['en', en], ['ar', ar]]) {
    const withTail = prompts.buildSystemPrompt({ ...BASE, language: lang, memory: 'DYNAMIC_TAIL_MARKER' });
    const [prefix, tail] = withTail.split(prompts.SYSTEM_CACHE_SPLIT);
    assert.ok(tail !== undefined, `${lang}: cache sentinel present`);
    for (const phrase of EN_PHRASES) {
      assert.ok(prefix.includes(phrase), `${lang}: "${phrase.slice(0, 30)}…" is in the byte-stable prefix`);
      assert.ok(!tail.includes(phrase), `${lang}: directive is NOT duplicated in the dynamic tail`);
    }
  }
});

// ---------- 3. byte caps (the mission: byte delta < 700B) ----------
test('v1132 bytes: EN < 24 KB, total delta ≤ 700B, net delta within existing caps', () => {
  const size = bytes(en);
  assert.ok(size < 24 * 1024, `EN prompt < 24 KB (got ${size})`);
  assert.ok(size - 23754 <= 700, `built-prompt byte delta < 700B (got +${size - 23754})`);
  assert.ok(size - 23754 > 0, 'the new directives are actually present (+delta)');
  assert.ok(size - 24381 >= 0 && size - 24381 < 400, `net delta within v11.23 band (got ${size - 24381})`);
  // Source text is word-stable: the new block uses no dynamic interpolation.
  const src = require('node:fs').readFileSync(join(ROOT, 'electron/agent/prompts.ts'), 'utf8');
  const blockStart = src.indexOf("'# Real-work contract");
  const blockEnd = src.indexOf('// ---------- v11.3 output', blockStart);
  const block = src.slice(blockStart, blockEnd);
  assert.ok(block.length > 0, 'REAL-WORK CONTRACT source block located');
  assert.ok(!block.includes('${'), 'REAL-WORK CONTRACT block has no interpolation (word-stable)');
});

// ---------- 4. no contradictions with existing rules ----------
test('v1132 no-contradiction: accuracy / capability / language / cache rules all survive', () => {
  for (const [lang, prompt] of [['en', en], ['ar', ar]]) {
    for (const keep of [
      '# ACCURACY CONTRACT (verify, not guess)',
      '# ERROR HONESTY',
      '# CAPABILITY MINDSET',
      'Assume you CAN accomplish it',
      'never hedge, never refuse',
      'LANGUAGE POLICY (mandatory)',
      'reply in the SAME language the user writes, FULLY',
      'ARABIC-FIRST',
      '# Core rules',
      'ALWAYS read a file before editing it.',
      'never repeat a failing call unchanged',
      prompts.SYSTEM_CACHE_SPLIT,
    ]) {
      assert.ok(prompt.includes(keep), `${lang}: existing rule preserved alongside new directives: ${keep}`);
    }
  }
});

test('v1132 MCP opt-in: the dynamic MCP section agrees with the static OPT-IN rule', () => {
  const withMcp = prompts.buildSystemPrompt({
    ...BASE,
    mcpTools: ['mcp__demo__render', 'mcp__demo__export'],
  });
  assert.ok(withMcp.includes('# MCP tools'), 'MCP section renders when servers are available');
  assert.ok(withMcp.includes('OPT-IN: call these only when the task needs that specific server'),
    'MCP section repeats the opt-in discipline');
  assert.ok(!withMcp.includes('FIRST-CLASS tools — use them the moment they fit'),
    'the old "use them the moment they fit" eager wording is gone (no contradiction)');
  assert.ok(withMcp.includes('MCP IS OPT-IN'), 'static opt-in rule is present in the same prompt');
});

test('v1132 loops: NO STUPID LOOPS reinforces, not replaces, the existing failure rule', () => {
  assert.ok(en.includes('NO STUPID LOOPS') && en.includes('after 2 failures switch approach'),
    'explicit 2-failure switch rule present');
  assert.ok(en.includes('never repeat a failing call unchanged') && en.includes('never repeat the same failing tool call'),
    'both the existing and the new anti-loop rules coexist (consistent, not contradictory)');
});

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
