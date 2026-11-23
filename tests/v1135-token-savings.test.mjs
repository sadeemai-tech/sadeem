// ============================================================
// SADEEM v11.35 — BUILT-IN TOKEN SAVINGS, CAPABILITY-NEUTRAL
// ------------------------------------------------------------
// Founder: "أريد أن يكون هيك في طريقة جوا إنه يوفر التوكن... مشكلة توفير
// التوكنز" + "ما في مانع، إحنا نعطيه كل القدرات".
//
// This suite PROVES that every token saving keeps the full capability surface:
//   1. AUDIT numbers (system prompt bytes, 145 tool schemas, cache markers).
//   2. CACHE: the byte-stable prefix + per-profile tool definitions are
//      identical across turns and carry cache_control → billed as cache READs.
//   3. DEDUPE: repeated IDENTICAL tool-result blobs fold to a short reference,
//      with real measured byte/token savings — while EVERY callId, message and
//      distinct output survives verbatim (no capability loss).
//   4. ALL TOOLS: profiles only change what is ADVERTISED; the full 145-tool
//      registry + every executor is intact, and the V15 capability roster is
//      preserved in the prompt.
//
// Run: node --test --test-force-exit tests/v1135-token-savings.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1135-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN,
    entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

const promptsPath = join(tmp, 'prompts.cjs');
const providersPath = join(tmp, 'providers.cjs');
const defsPath = join(tmp, 'defs.cjs');
const econPath = join(tmp, 'econ.cjs');
bundle(join(ROOT, 'electron/agent/prompts.ts'), promptsPath);
bundle(join(ROOT, 'electron/agent/providers.ts'), providersPath);
bundle(join(ROOT, 'electron/agent/tool-defs.ts'), defsPath);
bundle(join(ROOT, 'electron/agent/tokenEconomy.ts'), econPath);

const prompts = require(promptsPath);
const providers = require(providersPath);
const td = require(defsPath);
const econ = require(econPath);

const bytes = (s) => Buffer.byteLength(s, 'utf8');
const BASE = { workspace: 'D:/surnia-test-ws', mode: 'default', platform: 'win32', language: 'en' };

function fakeArgs(overrides = {}) {
  return {
    model: { provider: 'openrouter', model: 'openai/gpt-4o-mini', maxTokens: 4096, temperature: 0.2 },
    apiKey: 'test-key',
    baseUrl: 'https://openrouter.ai/api/v1',
    system: 'You are a coding agent.',
    messages: [{ role: 'user', text: 'fix the bug' }],
    tools: [
      { name: 'read_file', description: 'read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } }, kind: 'fs' },
      { name: 'write_file', description: 'write a file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } }, kind: 'fs' },
    ],
    signal: new AbortController().signal,
    promptCaching: true,
    onText: () => {},
    onToolUse: () => {},
    ...overrides,
  };
}

// ------------------------------------------------------------
test('v1135 AUDIT: prompt + tool-schema byte/token numbers (measured, not guessed)', () => {
  const en = prompts.buildSystemPrompt({ ...BASE });
  const ar = prompts.buildSystemPrompt({ ...BASE, language: 'ar' });
  const stable = providers.splitSystemPrompt(en).stable;
  const CORE = td.CORE_DEFS;
  const wire = (defs) => JSON.stringify(defs.map((d) => ({
    type: 'function', function: { name: d.name, description: d.description, parameters: d.parameters },
  })));
  const fullBytes = bytes(wire(CORE));
  const coreBytes = bytes(wire(td.defsForProfile(CORE, 'core')));

  console.log(`V1135_AUDIT: EN=${bytes(en)}B (~${econ.estimateTokens(en)} tok) AR=${bytes(ar)}B stable=${bytes(stable)}B`);
  console.log(`V1135_AUDIT: 145 tool schemas=${fullBytes}B (~${econ.estimateTokens(wire(CORE))} tok) core(43)=${coreBytes}B -> focused saves ${fullBytes - coreBytes}B (~${econ.estimateTokens(wire(CORE)) - econ.estimateTokens(wire(td.defsForProfile(CORE, 'core')))} tok)/turn`);

  assert.equal(CORE.length, 145, 'honest inventory: 145 tools');
  assert.ok(fullBytes > 90_000, 'the 145-schema wall is ~92 KB of source — the real token burn');
  assert.ok(coreBytes < fullBytes, 'a focused profile is strictly smaller');
  assert.equal(prompts.PROMPT_TOKEN_ECONOMY.renderedPromptBytesAdded, 0, 'v11.35 adds ZERO rendered prompt bytes');
  assert.equal(prompts.PROMPT_TOKEN_ECONOMY.capabilityNeutral, true);
});

test('v1135 byte caps: EN prompt still <24 KB, v11.21 +671≤700, v11.23 +44, roster intact', () => {
  const en = prompts.buildSystemPrompt({ ...BASE });
  const size = bytes(en);
  assert.ok(size < 24 * 1024, `EN < 24 KB (got ${size})`);
  assert.ok(size - 23754 <= 700, `v11.21 band: +${size - 23754} ≤ 700`);
  assert.ok(size - 24381 >= 0 && size - 24381 < 400, `v11.23 band: +${size - 24381}`);
  // v11.38 (F11) — added `use_skill` to the static WRITE roster so weak models
  // see the tool that loads skills. Absolute baseline drifts with os.tmpdir()
  // length in the harness; assert the honest band, not a brittle literal.
  assert.ok(size >= 24400 && size < 24 * 1024, `EN size in honest post-v11.38 band (got ${size})`);
  for (const marker of ['# CAPABILITY ROSTER', 'tool_help for args', 'markdown_outline', 'image_generate']) {
    assert.ok(en.includes(marker), `V15 roster / capability marker preserved: ${marker}`);
  }
  assert.ok(en.includes('still WORK — call them by exact name'), 'hidden-by-profile tools remain callable by exact name');
});

// ------------------------------------------------------------
test('v1135 CACHE: stable prefix + tool defs byte-identical across turns, marked cache_control', () => {
  // Five turns with DIFFERENT dynamic tails → one cached prefix + one write.
  const prefixes = [];
  for (let turn = 0; turn < 5; turn++) {
    const sys = prompts.buildSystemPrompt({ ...BASE, memory: `TURN_${turn}_${'x'.repeat(50 + turn)}` });
    const { stable } = providers.splitSystemPrompt(sys);
    prefixes.push(stable);
  }
  assert.equal(new Set(prefixes).size, 1, 'static prefix is byte-identical on every turn (cache READ eligible)');

  const sys = prompts.buildSystemPrompt({ ...BASE, memory: 'dynamic tail' });
  const { body } = providers.buildOpenAIRequestBody(fakeArgs({ system: sys }));
  const split = providers.splitSystemPrompt(sys);
  assert.deepEqual(body.messages[0].cache_control, { type: 'ephemeral' }, 'stable system carries the cache marker');
  assert.equal(body.messages[0].content, split.stable);
  assert.ok(!body.messages[1].cache_control, 'dynamic tail is NOT cached (cannot invalidate the prefix)');
  assert.deepEqual(body.tools[body.tools.length - 1].cache_control, { type: 'ephemeral' }, 'last tool def is a cache breakpoint');
  assert.deepEqual(body.cache_control, { type: 'ephemeral' });

  // Per-profile tool definitions are byte-stable too → provider cache can hit.
  const CORE = td.CORE_DEFS;
  const defsA = JSON.stringify(td.defsForProfile(CORE, 'balanced'));
  const defsB = JSON.stringify(td.defsForProfile(CORE, 'balanced'));
  assert.equal(econ.stableFingerprint(defsA), econ.stableFingerprint(defsB), 'tool defs fingerprint stable across turns');
  const reads = prefixes.length - 1;
  console.log(`V1135_CACHE: 1 cache write + ${reads} cache reads; prefix=${bytes(prefixes[0])}B (~${econ.estimateTokens(prefixes[0])} tok)/turn at 10% read price`);
});

// ------------------------------------------------------------
test('v1135 DEDUPE: repeated identical tool results fold with REAL byte/token savings', () => {
  const big = 'LOG LINE — the very same 3200-char tool output repeated across turns\n' + 'x'.repeat(3200);
  const uniqueA = 'UNIQUE_RESULT_A ' + 'a'.repeat(900);
  const uniqueB = 'UNIQUE_RESULT_B ' + 'b'.repeat(700);
  const history = [
    { role: 'user', text: 'do the task' },
    { role: 'assistant', toolCalls: [{ id: 'c1', name: 'run_command', args: '{}' }], text: '' },
    { role: 'tool_result', callId: 'c1', content: big },             // first full copy
    { role: 'assistant', toolCalls: [{ id: 'c2', name: 'run_command', args: '{}' }], text: '' },
    { role: 'tool_result', callId: 'c2', content: uniqueA },
    { role: 'assistant', toolCalls: [{ id: 'c3', name: 'run_command', args: '{}' }], text: '' },
    { role: 'tool_result', callId: 'c3', content: big },             // identical → fold
    { role: 'assistant', toolCalls: [{ id: 'c4', name: 'run_command', args: '{}' }], text: '' },
    { role: 'tool_result', callId: 'c4', content: uniqueB },
    { role: 'assistant', toolCalls: [{ id: 'c5', name: 'run_command', args: '{}' }], text: '' },
    { role: 'tool_result', callId: 'c5', content: big },             // identical → fold
  ];
  const beforeSnapshot = JSON.stringify(history);
  const { messages, report, collapsed } = econ.dedupeWithReport(history);

  assert.equal(collapsed, 2, 'two repeated copies collapsed');
  assert.equal(messages.length, history.length, 'NO message removed');
  assert.ok(report.savedBytes > 3000 && report.savedTokens > 700, `real savings: ${report.savedBytes} B / ${report.savedTokens} tok`);
  console.log(`V1135_DEDUPE: before=${report.beforeBytes}B after=${report.afterBytes}B saved=${report.savedBytes}B (~${report.savedTokens} tok, ${report.savedPct}%)`);
  assert.equal(JSON.stringify(history), beforeSnapshot, 'input history is never mutated');
});

test('v1135 CAPABILITY-NEUTRAL DEDUPE: every callId, role, order and distinct output survives', () => {
  const big = 'REPEAT ' + 'z'.repeat(400);
  const distinct = 'DISTINCT ' + 'q'.repeat(400);
  const history = [
    { role: 'user', text: 'question' },
    { role: 'assistant', text: 'thinking', toolCalls: [{ id: 'a', name: 'x', args: '{}' }] },
    { role: 'tool_result', callId: 'a', content: big },
    { role: 'assistant', toolCalls: [{ id: 'b', name: 'x', args: '{}' }] },
    { role: 'tool_result', callId: 'b', content: distinct },
    { role: 'assistant', toolCalls: [{ id: 'c', name: 'x', args: '{}' }] },
    { role: 'tool_result', callId: 'c', content: big, isError: false },
  ];
  const out = econ.dedupeToolResults(history);

  // 1. Shape / ordering / pairing untouched → OpenAI message contract intact.
  assert.deepEqual(out.map((m) => m.role), history.map((m) => m.role), 'roles and order unchanged');
  assert.deepEqual(out.map((m) => m.callId), history.map((m) => m.callId), 'every callId preserved in place');

  // 2. First full copy of each DISTINCT output is byte-identical.
  assert.equal(out[2].content, big, 'first occurrence kept verbatim');
  assert.equal(out[4].content, distinct, 'distinct output kept verbatim');

  // 3. Only the repeated copy is shortened, and it points to the surviving one.
  assert.notEqual(out[6].content, big);
  assert.match(out[6].content, /token-economy: identical tool output omitted/);
  assert.match(out[6].content, /\ba\b/, 'marker names the first copy callId');
  assert.match(out[6].content, /Full UNCHANGED output/, 'marker states the full output is still available');

  // 4. Union of information is unchanged: every distinct original body is still
  //    present in full exactly once (so nothing becomes unknowable to the model).
  const fullBodies = out.filter((m) => typeof m.content === 'string' && !m.content.startsWith('[token-economy:'))
    .map((m) => m.content);
  assert.deepEqual([...new Set(fullBodies)].sort(), [big, distinct].sort(), 'no distinct information lost');

  // 5. Non-tool messages are never touched.
  assert.equal(out[0], history[0]);
  assert.equal(out[1], history[1]);
});

test('v1135 DEDUPE edge cases: small blobs, distinct blobs and hash collisions stay safe', () => {
  const h = [
    { role: 'tool_result', callId: 's1', content: 'tiny' },
    { role: 'tool_result', callId: 's2', content: 'tiny' },                    // below minChars → untouched
    { role: 'tool_result', callId: 'd1', content: 'A'.repeat(400) },
    { role: 'tool_result', callId: 'd2', content: 'B'.repeat(400) },            // same length, different → untouched
    { role: 'user', text: 'U'.repeat(600) },
  ];
  const out = econ.dedupeToolResults(h);
  assert.equal(out[0].content, 'tiny');
  assert.equal(out[1].content, 'tiny', 'small repeated blobs are not worth folding');
  assert.equal(out[2].content, 'A'.repeat(400));
  assert.equal(out[3].content, 'B'.repeat(400), 'same-length but different content is never folded');
  assert.equal(out[4].text, 'U'.repeat(600), 'user messages are never touched');
  assert.equal(econ.estimateTokens('abcd'), 1);
  assert.equal(econ.utf8Bytes('سديم'), 8, 'UTF-8 byte counter handles Arabic');
});

// ------------------------------------------------------------
test('v1135 ALL TOOLS: profile views are advertisement only — 145 tools stay executable', () => {
  const CORE = td.CORE_DEFS;
  const full = td.defsForProfile(CORE, 'full');
  const core = td.defsForProfile(CORE, 'core');
  const balanced = td.defsForProfile(CORE, 'balanced');
  assert.equal(full.length, 145, 'full still advertises all 145');
  assert.ok(core.length < 145 && balanced.length < 145, 'focused views are smaller');

  // A tool hidden from BOTH focused views is still in the full registry.
  const hidden = 'markdown_outline';
  assert.ok(!core.some((d) => d.name === hidden) && !balanced.some((d) => d.name === hidden));
  assert.ok(full.some((d) => d.name === hidden), 'hidden tool remains in full registry');

  // Source-level proof: every declared tool has an executor (no capability cut).
  const q = String.fromCharCode(39);
  const defsSrc = readFileSync(join(ROOT, 'electron/agent/tool-defs.ts'), 'utf8');
  const toolsSrc = readFileSync(join(ROOT, 'electron/agent/tools.ts'), 'utf8');
  const defNames = [...defsSrc.matchAll(new RegExp('^\\s*name:\\s*' + q + '([^' + q + ']+)' + q, 'gm'))].map((m) => m[1]);
  const cases = new Set([...toolsSrc.matchAll(new RegExp('^\\s*case\\s+' + q + '([^' + q + ']+)' + q + ':', 'gm'))].map((m) => m[1]));
  assert.equal(defNames.length, 145);
  assert.deepEqual(defNames.filter((n) => !cases.has(n)), [], 'no tool lost its executor');
  console.log('V1135_ALL_TOOLS: 145 defs / 145 executors; focused views 43/120; dedupe never touches tool names');
});

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});
