import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.38 — BIGGEST AI CAPABILITY UPLIFT (DEEP WORK)
// ------------------------------------------------------------
// Owned file: electron/agent/prompts.ts (MAIN system-prompt sections only).
// This suite guards the v11.38 "DEEP WORK" directive and the strengthened
// MODE_NOTES / TASK_MODE_SPECS / finishing-loop directives:
//   1. SOURCE   — DEEP WORK is in the DYNAMIC TAIL of buildSystemPrompt(),
//                 NOT in the byte-stable buildStaticSystemPrefix() (so the
//                 provider prompt cache prefix stays untouched).
//   2. BYTES    — directive ≤600 B net; EN < 24 KB; v11.21 +700 cap;
//                 v11.23 net cap. All pre-existing caps stay GREEN.
//   3. RENDER   — directive reaches EN + AR prompts, on the TAIL side of the
//                 cache sentinel (never duplicated in the cached prefix).
//   4. WIRE     — a scripted provider run proves the directive reaches the
//                 actual system message(s) sent to the model (cache on+off).
//   5. MODES    — plan/debug/review carry crisp tool sequences (weak-model
//                 salience) and the finishing loop ends with file paths.
//   6. STABLE   — prefix memo is byte-stable; directive has no interpolation.
//
// Honest scope: a prompt steers behavior, it cannot force a weak model to
// reason. This suite guards the TEXT contract + wire delivery only.
//
// Run: node --test --test-force-exit tests/v1138-ai-depth.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1138-depth-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${out}`, '--external:electron',
  ], { cwd: ROOT, stdio: 'pipe' });
}

const promptsPath = join(tmp, 'prompts.cjs');
const provPath = join(tmp, 'providers.cjs');
bundle(join(ROOT, 'electron/agent/prompts.ts'), promptsPath);
bundle(join(ROOT, 'electron/agent/providers.ts'), provPath);
const prompts = require(promptsPath);
const providers = require(provPath);

const bytes = (s) => Buffer.byteLength(s, 'utf8');
const BASE = { workspace: 'D:/surnia-test-ws', mode: 'default', platform: 'win32', language: 'en' };
const SRC = readFileSync(join(ROOT, 'electron/agent/prompts.ts'), 'utf8');

const DW_HEADING = '# DEEP WORK';
const DW_MARKERS = [
  '1. INTENT: grasp the real goal first; cover ALL parts.',
  '2. RIGHT TOOL: explore=read/search/map, change=edit, verify=run.',
  '3. VERIFY: run the check, READ output',
  '4. FAIL: read the error\'s EXACT FIX, self-correct ONCE, then switch',
  'never loop, never "I can\'t"',
  '5. FINISH: honest evidence — paths + command/result + gaps.',
];

function fakeArgs(overrides = {}) {
  return {
    model: { provider: 'openrouter', model: 'openai/gpt-4o-mini', maxTokens: 4096, temperature: 0.2, reasoning: undefined },
    apiKey: 'test-key',
    baseUrl: 'https://openrouter.ai/api/v1',
    system: 'You are a coding agent.',
    messages: [{ role: 'user', text: 'build me a UI' }],
    tools: [
      { name: 'read_file', description: 'read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } }, kind: 'fs' },
      { name: 'edit_file', description: 'edit a file', parameters: { type: 'object', properties: { path: { type: 'string' } } }, kind: 'fs' },
    ],
    signal: new AbortController().signal,
    promptCaching: true,
    onText: () => {},
    onToolUse: () => {},
    ...overrides,
  };
}

/** Slice a rendered section from its heading up to the next `\n\n# `. */
function section(prompt, heading) {
  const at = prompt.indexOf(heading);
  if (at < 0) return '';
  const end = prompt.indexOf('\n\n# ', at + heading.length);
  return end < 0 ? prompt.slice(at) : prompt.slice(at, end);
}

// ---------- 1. SOURCE: DEEP WORK lives in the dynamic tail, not the cached prefix ----------
test('v1138 source: DEEP WORK is in buildSystemPrompt dynamic tail, NOT buildStaticSystemPrefix', () => {
  const staticStart = SRC.indexOf('function buildStaticSystemPrefix(');
  const staticEnd = SRC.indexOf('function memoStaticPrefix(');
  const tailStart = SRC.indexOf('export function buildSystemPrompt(');
  const tailEnd = SRC.indexOf('// v11.35', tailStart);
  assert.ok(staticStart >= 0 && staticEnd > staticStart, 'static-prefix function located');
  assert.ok(tailStart >= 0 && tailEnd > tailStart, 'dynamic-tail function located');

  const staticBody = SRC.slice(staticStart, staticEnd);
  const tailBody = SRC.slice(tailStart, tailEnd);
  assert.ok(!staticBody.includes(DW_HEADING), 'DEEP WORK NOT in the byte-stable cached prefix');
  assert.ok(tailBody.includes(DW_HEADING), 'DEEP WORK IS in the dynamic tail');
  // No dynamic interpolation in the directive -> word-stable for every turn.
  const dwBlock = tailBody.slice(tailBody.indexOf(DW_HEADING), tailBody.indexOf('// ---------- dynamic: machine capabilities'));
  assert.ok(!dwBlock.includes('${'), 'DEEP WORK directive has NO interpolation (word-stable)');
  assert.ok(!/opts\.|new Date|process\./.test(dwBlock), 'DEEP WORK reads no dynamic opts/clock/env');
});

// ---------- 2. BYTES: all pre-existing caps stay green, directive ≤600 B ----------
test('v1138 bytes: directive ≤600 B net; EN < 24 KB; v11.21 +700; v11.23 net cap', () => {
  const en = prompts.buildSystemPrompt({ ...BASE });
  const size = bytes(en);

  const dw = section(en, DW_HEADING);
  assert.ok(dw, 'DEEP WORK directive rendered');
  const dwNet = bytes(dw) + 2; // +2 for the '\n\n' part separator
  assert.ok(dwNet <= 600, `DEEP WORK net bytes ≤ 600 (got ${dwNet})`);

  assert.ok(size < 24 * 1024, `EN prompt < 24 KB (got ${size})`);
  assert.ok(size - 23754 <= 700, `v11.21 +700 cap holds (got +${size - 23754})`);
  assert.ok(size - 24381 >= 0, `v11.23 net guidance present (got +${size - 24381})`);
  assert.ok(size - 24381 < 400, `v11.23 net band holds (got +${size - 24381})`);
});

// ---------- 3. RENDER: directive reaches EN + AR, on the TAIL side only ----------
test('v1138 render: DEEP WORK is in the dynamic tail of EN and AR, never the cached prefix', () => {
  for (const lang of ['en', 'ar']) {
    const prompt = prompts.buildSystemPrompt({ ...BASE, language: lang });
    for (const marker of [DW_HEADING, ...DW_MARKERS]) {
      assert.ok(prompt.includes(marker), `${lang}: DEEP WORK marker rendered — ${marker.slice(0, 42)}…`);
    }
    const [prefix, tail] = prompt.split(prompts.SYSTEM_CACHE_SPLIT);
    assert.ok(tail !== undefined, `${lang}: cache sentinel present`);
    assert.ok(tail.includes(DW_HEADING), `${lang}: DEEP WORK is in the dynamic tail`);
    assert.ok(!prefix.includes(DW_HEADING), `${lang}: DEEP WORK is NOT in the cached prefix`);
  }
});

// ---------- 4. WIRE: scripted provider run proves the directive reaches the system prompt ----------
test('v1138 wire (cache ON): scripted provider run delivers DEEP WORK in the dynamic system message', () => {
  const sys = prompts.buildSystemPrompt({ ...BASE, memory: 'DYNAMIC_MEMORY_MARKER' });
  assert.ok(sys.includes(DW_HEADING));
  const { body, cacheControl } = providers.buildOpenAIRequestBody(fakeArgs({ system: sys, promptCaching: true }));
  assert.equal(cacheControl, true, 'cache control active on the openrouter path');
  const systemMsgs = body.messages.filter((m) => m.role === 'system');
  assert.ok(systemMsgs.length >= 2, 'cache ON splits into stable + dynamic system messages');
  const wire = systemMsgs.map((m) => m.content).join('\n');
  assert.ok(wire.includes(DW_HEADING), 'DEEP WORK heading reaches the wire system prompt');
  for (const marker of DW_MARKERS) {
    assert.ok(wire.includes(marker), `DEEP WORK line reaches the wire system prompt — ${marker.slice(0, 42)}…`);
  }
  assert.ok(!systemMsgs[0].content.includes(DW_HEADING), 'cached stable prefix still free of DEEP WORK');
  assert.ok(systemMsgs[systemMsgs.length - 1].content.includes(DW_HEADING), 'dynamic (uncached) system message carries DEEP WORK');
});

test('v1138 wire (cache OFF): scripted provider run still delivers DEEP WORK', () => {
  const sys = prompts.buildSystemPrompt({ ...BASE });
  const { body, cacheControl } = providers.buildOpenAIRequestBody(fakeArgs({ system: sys, promptCaching: false }));
  assert.equal(cacheControl, false);
  const systemMsgs = body.messages.filter((m) => m.role === 'system');
  assert.equal(systemMsgs.length, 1, 'cache OFF keeps a single system message');
  assert.ok(systemMsgs[0].content.includes(DW_HEADING), 'DEEP WORK reaches the single system message');
  assert.ok(systemMsgs[0].content.includes(DW_MARKERS[0]), 'directive body reaches the model, not just the heading');
});

// ---------- 5. MODES + FINISHING LOOP: crisp tool sequences & final file paths ----------
test('v1138 modes: plan / debug / review carry crisp, literal tool sequences', () => {
  // Permission-mode PLAN note.
  const plan = prompts.buildSystemPrompt({ ...BASE, mode: 'plan' });
  for (const m of ['repo_map/list_dir', 'read_file/search_files', 'propose_plan']) {
    assert.ok(plan.includes(m), `plan MODE_NOTES tool sequence: ${m}`);
  }
  // Task-mode protocols.
  const debug = prompts.buildSystemPrompt({ ...BASE, taskMode: 'debug' });
  for (const m of ['TOOL SEQUENCE', 'debug_start', 'test_run', 'edit_file']) {
    assert.ok(debug.includes(m), `debug TASK_MODE_SPECS tool sequence: ${m}`);
  }
  const review = prompts.buildSystemPrompt({ ...BASE, taskMode: 'review' });
  for (const m of ['TOOL SEQUENCE', 'git_local', 'review_diff', 'read_file/search_files']) {
    assert.ok(review.includes(m), `review TASK_MODE_SPECS tool sequence: ${m}`);
  }
  const planTask = prompts.buildSystemPrompt({ ...BASE, taskMode: 'plan' });
  assert.ok(planTask.includes('crisp tool sequence: repo_map → symbol_outline → read_file/search_files'),
    'plan TASK_MODE_SPECS EXPLORE tool sequence present');
});

test('v1138 finishing loop: preview → screenshot → LOOK → fix → final summary with file paths', () => {
  const en = prompts.buildSystemPrompt({ ...BASE });
  const stack = section(en, '# Stack selection & build protocol');
  const fl = stack.split('\n').find((l) => l.includes('FINISHING LOOP'));
  assert.ok(fl, 'FINISHING LOOP line present');
  for (const step of ['preview', 'ui_quality_check', 'FIX', 'preview_screenshot', 'LOOK', 'final summary with file paths']) {
    assert.ok(fl.includes(step), `finishing loop step present: ${step}`);
  }
  const idx = (s) => fl.indexOf(s);
  assert.ok(idx('preview') < idx('preview_screenshot'), 'preview before screenshot');
  assert.ok(idx('preview_screenshot') < idx('LOOK'), 'screenshot before LOOK');
  assert.ok(idx('LOOK') < idx('final summary with file paths'), 'LOOK before final summary');
});

// ---------- 6. STABILITY: prefix memo unchanged by dynamic tail ----------
test('v1138 stable: dynamic DEEP WORK never invalidates the cached static prefix', () => {
  prompts.clearStaticPromptCache();
  const a = prompts.buildSystemPrompt({ ...BASE });
  const b = prompts.buildSystemPrompt({ ...BASE, memory: 'other dynamic memory' });
  assert.equal(prompts.staticPromptCacheStats().misses, 1, 'static prefix built once');
  assert.equal(providers.splitSystemPrompt(a).stable, providers.splitSystemPrompt(b).stable,
    'cached prefix byte-identical regardless of dynamic tail/DIFFERENT memory');
});

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
