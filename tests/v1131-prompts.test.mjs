import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.31 — SYSTEM-PROMPT ACCURACY / TOOL-NAME AUDIT
// ------------------------------------------------------------
// Owned file: electron/agent/prompts.ts (CAPABILITY / PROMPT-ACCURACY agent).
// Guards the whole rendered system prompt, not just one block:
//   1. RENDER     — buildSystemPrompt renders complete EN + AR prompts.
//   2. CONTRACT   — ACCURACY CONTRACT + ERROR HONESTY live in the byte-stable
//                   static prefix (before the cache sentinel) in BOTH languages.
//   3. NO HEDGING — accuracy/honesty blocks never reintroduce refusal/hedging.
//   4. ABSTENTION — honest "could not verify" is PERMITTED (line 457 clause);
//                   lazy "I can't" refusal is still forbidden; capability
//                   mindset is intact. Accuracy, not fake confidence.
//   5. BYTES      — EN < 24 KB, v11.21 delta cap, v11.23 net cap, contract ≤600 B.
//   6. LEGACY     — every legacy heading survives.
//   7. CACHE      — the static/dynamic split marker separates stable prefix
//                   from the clock/memory dynamic tail.
//   8. TOOL NAMES — every tool-name-like token in the prompt resolves to one
//                   of the 145 registered tools (no hallucinated tool names);
//                   the old phantom `queue/steer` "tools" are gone.
//
// Honest scope note: a system prompt can only steer behavior. It cannot make a
// weak model reason better, force a tool call, or guarantee factual accuracy —
// this suite guards the TEXT contract only.
//
// Run: node --test --test-force-exit tests/v1131-prompts.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1131-prompts-'));

// Minimal electron stub so tools.ts (which imports storeService) can be bundled
// and required headlessly — same posture as v1111-cognition.test.mjs.
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `module.exports = {
    app: { getPath: () => ${JSON.stringify(tmp)}, whenReady: async () => true, on() {}, quit() {} },
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: { getAllWindows: () => [] },
    Notification: { isSupported: () => false },
    shell: {}, screen: {},
  };`,
);

function bundle(entry, out) {
  execFileSync(
    ESBUILD_NODE,
    [ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`, '--external:electron'],
    { cwd: ROOT, stdio: 'pipe' },
  );
}
const promptsPath = join(tmp, 'prompts.cjs');
const toolsPath = join(tmp, 'tools.cjs');
bundle(join(ROOT, 'electron/agent/prompts.ts'), promptsPath);
bundle(join(ROOT, 'electron/agent/tools.ts'), toolsPath);
const prompts = require(promptsPath);
const tools = require(toolsPath);

const bytes = (s) => Buffer.byteLength(s, 'utf8');
const BASE = { workspace: 'D:/surnia-test-ws', mode: 'default', platform: 'win32', language: 'en' };

const CONTRACT_HEADING = '# ACCURACY CONTRACT (verify, not guess)';
const HONESTY_HEADING = '# ERROR HONESTY';
const CONTRACT_MARKERS = [
  'Correctness beats speed: verify, never guess.',
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
// Honest-abstention clause (v11.31) — added where the conflict lived: line 457
// used to bluntly forbid "I can't", pushing weak models to fabricate instead
// of admitting they could not verify. These markers prove the softening landed.
const ABSTENTION_MARKERS = [
  'If verification is impossible, say what you could not verify and the next step',
  'never invent, never silently guess',
  'keep working on what IS verifiable',
];

/** Slice a rendered section from its heading up to the next `\n\n# `. */
function section(prompt, heading) {
  const at = prompt.indexOf(heading);
  if (at < 0) return '';
  const end = prompt.indexOf('\n\n# ', at + heading.length);
  return end < 0 ? prompt.slice(at) : prompt.slice(at, end);
}

// ---------- 1. RENDER EN + AR ----------
test('v1131 render: buildSystemPrompt renders a complete prompt in EN and AR', () => {
  const en = prompts.buildSystemPrompt({ ...BASE });
  const ar = prompts.buildSystemPrompt({ ...BASE, language: 'ar' });
  for (const [lang, prompt] of [['en', en], ['ar', ar]]) {
    assert.ok(prompt.length > 1000, `${lang}: fully rendered (${prompt.length} chars)`);
    assert.ok(prompt.includes('You are SADEEM'), `${lang}: identity line present`);
    assert.ok(prompt.includes(prompts.SYSTEM_CACHE_SPLIT), `${lang}: cache split sentinel present`);
    assert.ok(prompt.includes('# Environment'), `${lang}: dynamic environment tail present`);
    assert.ok(prompt.includes(CONTRACT_HEADING), `${lang}: accuracy contract present`);
  }
  assert.ok(ar.includes('# Core rules | القواعد الأساسية'), 'ar: bilingual core-rules heading rendered');
  assert.ok(ar.includes('# Permission mode | وضع الصلاحيات'), 'ar: bilingual permission heading rendered');
});

// ---------- 2. CONTRACT IN THE STATIC PREFIX ----------
test('v1131 contract: ACCURACY CONTRACT + ERROR HONESTY are in the CACHEABLE prefix (EN + AR)', () => {
  for (const lang of ['en', 'ar']) {
    const prompt = prompts.buildSystemPrompt({ ...BASE, language: lang, memory: 'DYNAMIC_TAIL_MARKER' });
    const [prefix, tail] = prompt.split(prompts.SYSTEM_CACHE_SPLIT);
    assert.ok(tail !== undefined, `${lang}: cache sentinel present`);
    assert.ok(prefix.includes(CONTRACT_HEADING), `${lang}: contract heading in static prefix`);
    for (const marker of CONTRACT_MARKERS) {
      assert.ok(prefix.includes(marker), `${lang}: stable contract line in prefix — ${marker.slice(0, 44)}…`);
    }
    assert.ok(prefix.includes(HONESTY_HEADING), `${lang}: ERROR HONESTY in static prefix`);
    for (const marker of HONESTY_MARKERS) {
      assert.ok(section(prefix, HONESTY_HEADING).includes(marker), `${lang}: honesty marker — ${marker}`);
    }
    assert.ok(!tail.includes(CONTRACT_HEADING), `${lang}: contract NOT duplicated in dynamic tail`);
  }
  const en = prompts.buildSystemPrompt({ ...BASE });
  assert.ok(en.indexOf(CONTRACT_HEADING) < en.indexOf('# Core rules'), 'contract precedes core rules (high in prefix)');
});

// ---------- 3. NO REFUSAL HEDGING (accuracy + honesty blocks) ----------
test('v1131 no-hedging: accuracy blocks refuse nothing and hedge nothing', () => {
  const prompt = prompts.buildSystemPrompt({ ...BASE });
  for (const block of [section(prompt, CONTRACT_HEADING), section(prompt, HONESTY_HEADING)]) {
    assert.ok(block, 'accuracy block extracted');
    for (const banned of ["I can't", 'cannot', 'unable', 'refuse to', "I don't have", 'hedge']) {
      assert.ok(!block.includes(banned), `no refusal/hedging wording in accuracy blocks: "${banned}"`);
    }
  }
});

// ---------- 4. HONEST ABSTENTION PERMITTED / LAZY REFUSAL FORBIDDEN ----------
test('v1131 abstention: honest "could not verify" is allowed; lazy "I can\'t" is not', () => {
  for (const lang of ['en', 'ar']) {
    const prompt = prompts.buildSystemPrompt({ ...BASE, language: lang });
    const cap = section(prompt, '# Capability contract (read this first)');
    assert.ok(cap, `${lang}: capability contract section extracted`);
    for (const marker of ABSTENTION_MARKERS) {
      assert.ok(cap.includes(marker), `${lang}: honest-abstention clause present — ${marker}`);
    }
    // Lazy refusal is still explicitly forbidden.
    assert.ok(cap.includes('NEVER say "I can\'t / I don\'t have the tools / I\'m unable"'), `${lang}: lazy refusal still banned`);
    assert.ok(cap.includes('to dodge feasible work'), `${lang}: ban is scoped to dodging feasible work`);
    // Capability mindset survives, unweakened.
    assert.ok(prompt.includes('# CAPABILITY MINDSET'), `${lang}: capability mindset heading intact`);
    assert.ok(prompt.includes('Assume you CAN accomplish it'), `${lang}: assume-CAN directive intact`);
    assert.ok(prompt.includes('never hedge, never refuse'), `${lang}: no habitual hedging/refusal`);
    assert.ok(prompt.includes('LANGUAGE POLICY (mandatory)'), `${lang}: language policy intact`);
  }
  // The canonical accuracy contract also mandates honest verification-first reporting.
  const contract = section(prompts.buildSystemPrompt({ ...BASE }), CONTRACT_HEADING);
  assert.ok(/Verification impossible\? Say so honestly/.test(contract), 'accuracy contract permits honest verification failure');
  assert.ok(/NOT refusal; keep working/.test(contract), 'honest failure is explicitly NOT a refusal');
});

// ---------- 5. BYTE CAPS ----------
test('v1131 bytes: EN < 24 KB, delta caps hold, contract ≤ 600 B', () => {
  const en = prompts.buildSystemPrompt({ ...BASE });
  const size = bytes(en);
  assert.ok(size < 24 * 1024, `EN prompt < 24 KB (got ${size})`);
  // v11.21 hard cap: 23754 + 700.
  assert.ok(size - 23754 <= 700, `v11.21 total-delta cap holds (got +${size - 23754})`);
  // v11.23 net cap: pre-v11.23 baseline 24381, net must be >= 0 and < 400.
  const net = size - 24381;
  assert.ok(net >= 0, `accuracy guidance still present (got ${net})`);
  assert.ok(net < 400, `v11.23 net byte delta < 400 (got +${net})`);
  // The ACCURACY CONTRACT block stays inside its 600 B budget.
  const contractNet = bytes(section(en, CONTRACT_HEADING)) + 2;
  assert.ok(contractNet <= 600, `contract net bytes ≤ 600 (got ${contractNet})`);
});

// ---------- 6. LEGACY HEADINGS ----------
test('v1131 legacy: every legacy heading survives the accuracy edit', () => {
  const en = prompts.buildSystemPrompt({ ...BASE });
  for (const heading of LEGACY_HEADINGS) {
    assert.ok(en.includes(heading), `legacy heading preserved: ${heading}`);
  }
  assert.ok(en.includes('NO FORCED TEMPLATES'), 'output-discipline hook preserved');
  assert.ok(en.includes('image_generate') && en.includes('desktop_control'), 'tool-name hooks preserved');
});

// ---------- 7. PROMPT-CACHE SPLIT MARKER ----------
test('v1131 cache: the static prefix / dynamic tail split is correct', () => {
  const en = prompts.buildSystemPrompt({ ...BASE, memory: 'DYNAMIC_MEMORY_MARKER' });
  assert.ok(en.includes(prompts.SYSTEM_CACHE_SPLIT), 'sentinel present with dynamic context');
  const [prefix, tail] = en.split(prompts.SYSTEM_CACHE_SPLIT);
  assert.ok(prefix.length > 1000 && tail.length > 0, 'both sides of the split are populated');
  assert.ok(!/- Date: \d{4}-\d{2}-\d{2}/.test(prefix), 'no clock date in the cacheable prefix');
  assert.ok(/- Date: \d{4}-\d{2}-\d{2}/.test(tail), 'date lives in the dynamic tail');
  assert.ok(prefix.includes(CONTRACT_HEADING), 'contract is on the cacheable side of the split');
});

// ---------- 8. ALL 145 TOOL NAMES REFERENCED CORRECTLY ----------
// The prompt teaches tools by name. Every tool-name-like token it prints must
// resolve to a real registry entry — a hallucinated/mistyped name is a defect.
// A few printed tokens are action/parameter values, not tool names; they are
// explicitly allowlisted below with the reason.
const NON_TOOL_TOKENS = new Set([
  'dev_start',     // value of preview's `action` arg
  'double_click',  // value of desktop_control's action
  'extract_audio', // media_ffmpeg sub-action
  'make_gif',      // media_ffmpeg sub-action
  'old_string',    // edit_file parameter name
]);

test('v1131 tool names: the registry has 145 tools and the prompt references only real ones', () => {
  const registry = tools.getToolDefs([]).map((d) => d.name);
  assert.equal(registry.length, 145, 'registry has 145 tools');
  const registrySet = new Set(registry);

  // Render with all conditional sections on to maximize tool-name coverage.
  const en = prompts.buildSystemPrompt({
    ...BASE,
    taskMode: 'debug',
    dna: 'learned fact',
    playbook: 'learned lesson',
    skills: [{ name: 'Demo', description: 'demo skill' }],
  });

  const tokens = new Set(en.match(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g) || []);
  const suspicious = [...tokens].filter((t) => !registrySet.has(t) && !NON_TOOL_TOKENS.has(t)).sort();
  assert.deepEqual(suspicious, [], `prompt must not name non-existent tools; unknown tokens: ${suspicious.join(', ')}`);

  const mentioned = [...tokens].filter((t) => registrySet.has(t));
  assert.ok(mentioned.length >= 100, `prompt teaches a broad tool belt (${mentioned.length}/145 tools named)`);

  // The phantom "queue/steer" orchestration tools (they are user-side UI
  // controls, not callable tools) must no longer be presented as tools.
  assert.ok(!en.includes('queue/steer'), 'queue/steer are not advertised as callable tools');

  // Representative specialist tools the prompt explicitly instructs must be correct.
  for (const name of [
    'read_file', 'edit_file', 'write_file', 'multi_edit', 'run_command', 'web_search', 'web_fetch',
    'image_generate', 'make_document', 'pdf_make', 'pptx_make', 'docx_make', 'xlsx_make',
    'desktop_control', 'browser_snapshot', 'image_search', 'tool_help', 'use_skill', 'propose_plan',
  ]) {
    assert.ok(registrySet.has(name), `referenced tool is registered: ${name}`);
    assert.ok(en.includes(name), `referenced tool is printed in the prompt: ${name}`);
  }
});

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
