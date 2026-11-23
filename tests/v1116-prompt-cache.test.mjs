import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.16 — PROMPT-CACHE / STATIC-PROMPT LATENCY TESTS
// ------------------------------------------------------------
// Regression suite for the P0 latency diagnosis (docs/DIAG-LATENCY.md):
//   • the OpenAI-compatible wire body must carry cache_control on the
//     BYTE-STABLE system prefix and on the (stable) last tool definition;
//   • the dynamic tail (clock / memory / project context) must NOT be cached;
//   • memory must be injected AT MOST ONCE (playbook vs MEMORY.md);
//   • the EN static prefix must stay under 24 KB (was ~34 KB);
//   • buildSystemPrompt memoizes its static prefix by
//     (lang, taskMode, profile, mode, effort, vibe, protocol, platform).
//
// Bundling uses the same esbuild harness as v1115-message-contract.test.mjs.
// Run:
//   node --test --test-force-exit tests/v1116-prompt-cache.test.mjs
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
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1116-cache-'));

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
const provPath = join(tmp, 'providers.cjs');
bundle(join(ROOT, 'electron/agent/prompts.ts'), promptsPath);
bundle(join(ROOT, 'electron/agent/providers.ts'), provPath);
const prompts = require(promptsPath);
const providers = require(provPath);

const bytes = (s) => Buffer.byteLength(s, 'utf8');
const BASE = { workspace: 'D:/surnia-test-ws', mode: 'default', platform: 'win32', language: 'en' };

function fakeArgs(overrides = {}) {
  return {
    model: {
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
      maxTokens: 4096,
      temperature: 0.2,
      reasoning: undefined,
    },
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

// ---------- 1. cache_control on stable system + tools ----------

test('v11.16: OpenAI-compat body marks the STABLE system prefix with cache_control (not the dynamic tail)', () => {
  const sys = prompts.buildSystemPrompt({
    ...BASE,
    memory: 'PROJECT_MEMORY_MARKER — this is the dynamic tail and must NOT be cached.',
  });
  assert.ok(sys.includes(prompts.SYSTEM_CACHE_SPLIT), 'rendered system prompt carries the cache split sentinel');

  const { body, cacheControl } = providers.buildOpenAIRequestBody(fakeArgs({ system: sys }));
  assert.equal(cacheControl, true, 'cache control enabled for OpenRouter by default');

  const split = providers.splitSystemPrompt(sys);
  const systemMsg = body.messages[0];
  assert.equal(systemMsg.role, 'system');
  assert.equal(typeof systemMsg.content, 'string', 'system content stays a plain string for existing consumers');
  assert.deepEqual(systemMsg.cache_control, { type: 'ephemeral' }, 'stable system message carries the cache marker');
  assert.equal(systemMsg.content, split.stable, 'cache_control sits on the exact byte-stable prefix');
  assert.ok(!systemMsg.content.includes(prompts.SYSTEM_CACHE_SPLIT), 'sentinel is stripped from the wire body');
  const dynamicMsg = body.messages[1];
  assert.equal(dynamicMsg.role, 'system');
  assert.ok(!dynamicMsg.cache_control, 'dynamic tail is NOT cached (clock/memory changes must not break the prefix)');
  assert.ok(dynamicMsg.content.includes('PROJECT_MEMORY_MARKER'), 'dynamic content still reaches the model');
  assert.deepEqual(body.cache_control, { type: 'ephemeral' }, 'top-level directive enables automatic prefix caching');
});

test('v11.16: OpenAI-compat body marks the last tool definition with cache_control', () => {
  const { body } = providers.buildOpenAIRequestBody(fakeArgs());
  assert.ok(Array.isArray(body.tools) && body.tools.length === 2);
  assert.ok(!body.tools[0].cache_control, 'only the last tool gets a breakpoint (Anthropic parity)');
  assert.deepEqual(body.tools[body.tools.length - 1].cache_control, { type: 'ephemeral' });
  assert.equal(body.tools[0].function.name, 'read_file', 'tool capability descriptions preserved');
});

test('v11.16: promptCaching:false omits every explicit cache marker', () => {
  const sys = prompts.buildSystemPrompt({ ...BASE, memory: 'dynamic' });
  const { body, cacheControl } = providers.buildOpenAIRequestBody(fakeArgs({ system: sys, promptCaching: false }));
  assert.equal(cacheControl, false);
  assert.equal(typeof body.messages[0].content, 'string', 'legacy plain-string system content when caching is off');
  assert.ok(!body.messages[0].content.includes(prompts.SYSTEM_CACHE_SPLIT));
  assert.ok(body.tools.every((t) => !t.cache_control));
});

test('v1115 contract still holds: plain systems keep the single string system message', () => {
  const body = providers.toOpenAIMessages('You are a coding agent.', [{ role: 'user', text: 'hi' }]);
  assert.equal(body.length, 2);
  assert.equal(body[0].content, 'You are a coding agent.');
  assert.ok(!body[0].cache_control);
});

// ---------- 2. memory injected at most once ----------

test('v11.16: memory injected at most once — playbook memory block suppresses opts.memory', () => {
  const playbookWithMemory = [
    'ADVISORY DEFAULTS learned from real runs',
    'CUMULATIVE SESSION MEMORY — reconstructed from REAL on-disk run data (journal + playbook + DNA + compaction summaries).',
    '- ORIGINAL TASK (still authoritative): remember everything',
  ].join('\n');
  const prompt = prompts.buildSystemPrompt({
    ...BASE,
    playbook: playbookWithMemory,
    memory: 'DUPLICATE_MEMORY_MARKER_from_MEMORY.md_should_not_appear',
  });
  assert.ok(prompt.includes('# Living Playbook'), 'playbook still reaches the model');
  assert.ok(prompt.includes('CUMULATIVE SESSION MEMORY'), 'the canonical memory block is present exactly once');
  assert.ok(!prompt.includes('# Project memory (MEMORY.md)'), 'second project-memory section is omitted');
  assert.ok(!prompt.includes('DUPLICATE_MEMORY_MARKER'), 'duplicate memory text is absent');
  assert.equal(prompt.split('CUMULATIVE SESSION MEMORY').length - 1, 1, 'memory block appears exactly once');
});

test('v11.16: memory IS injected when the playbook does not already carry it', () => {
  const prompt = prompts.buildSystemPrompt({ ...BASE, playbook: 'lesson learned', memory: 'UNIQUE_MEMORY_MARKER' });
  assert.ok(prompt.includes('# Project memory (MEMORY.md)'));
  assert.ok(prompt.includes('UNIQUE_MEMORY_MARKER'));
});

test('v11.16: explicit skipProjectMemory suppresses the project-memory section', () => {
  const prompt = prompts.buildSystemPrompt({ ...BASE, memory: 'SHOULD_BE_ABSENT', skipProjectMemory: true });
  assert.ok(!prompt.includes('# Project memory (MEMORY.md)'));
  assert.ok(!prompt.includes('SHOULD_BE_ABSENT'));
});

test('v11.16: one shared advisory header covers DNA / playbook / memory (no 3x boilerplate)', () => {
  const prompt = prompts.buildSystemPrompt({
    ...BASE,
    dna: 'learned DNA fact',
    playbook: 'playbook fact',
    memory: 'memory fact',
  });
  assert.equal(
    prompt.split(prompts.ADVISORY_HEADER).length - 1,
    1,
    'the shared advisory header is emitted exactly once',
  );
  assert.ok(!prompt.includes('DNA RULES:'), 'old per-section DNA boilerplate removed');
  assert.ok(!prompt.includes('PLAYBOOK RULES:'), 'old per-section playbook boilerplate removed');
});

// ---------- 3. static prompt < 24 KB for EN ----------

test('v11.16: EN static prompt is under 24 KB (was ~34 KB)', () => {
  const en = prompts.buildSystemPrompt({ ...BASE }); // default vibe ON — the real default path
  const size = bytes(en);
  assert.ok(size < 24 * 1024, `EN static prompt must be < 24 KB, measured ${size} bytes (${en.length} chars)`);
  // Real instructions survive the trim.
  for (const marker of [
    '# Capability contract (read this first)',
    '# Workspace safety',
    '# Permission mode',
    'NO FORCED TEMPLATES',
    'LANGUAGE POLICY (mandatory)',
    'ARABIC-FIRST',
    '# WHICH TOOL WHEN',
    '# Tool notes',
    'image_generate',
    'desktop_control',
  ]) {
    assert.ok(en.includes(marker), `required instruction preserved: ${marker}`);
  }
});

// ---------- 4. memoization of the static prefix ----------

test('v11.16: buildSystemPrompt memoizes the static prefix by (lang, taskMode, profile, ...)', () => {
  prompts.clearStaticPromptCache();
  const a = prompts.buildSystemPrompt({ ...BASE });
  const b = prompts.buildSystemPrompt({ ...BASE });
  assert.equal(a, b, 'identical inputs → identical string');
  let stats = prompts.staticPromptCacheStats();
  assert.equal(stats.misses, 1, 'static prefix built exactly once');
  assert.equal(stats.hits, 1, 'second build served from the memo');

  // Changing ONLY dynamic context must reuse the same memo entry.
  const c = prompts.buildSystemPrompt({ ...BASE, memory: 'different dynamic memory' });
  stats = prompts.staticPromptCacheStats();
  assert.equal(stats.misses, 1, 'dynamic tail does not invalidate the memo');
  assert.equal(stats.hits, 2);
  assert.equal(providers.splitSystemPrompt(a).stable, providers.splitSystemPrompt(c).stable, 'cached prefix byte-identical');

  // Changing a key component builds a new entry.
  prompts.buildSystemPrompt({ ...BASE, language: 'ar' });
  stats = prompts.staticPromptCacheStats();
  assert.equal(stats.misses, 2, 'language change produces a new memo entry');

  prompts.buildSystemPrompt({ ...BASE, taskMode: 'debug' });
  assert.equal(prompts.staticPromptCacheStats().misses, 3, 'taskMode is part of the memo key');

  prompts.buildSystemPrompt({ ...BASE, toolProfile: 'essential' });
  assert.equal(prompts.staticPromptCacheStats().misses, 4, 'profile is part of the memo key');
});

test('v11.16: the static prefix never contains a clock date; the dynamic tail does', () => {
  const prompt = prompts.buildSystemPrompt({ ...BASE, memory: 'ctx' });
  const split = providers.splitSystemPrompt(prompt);
  assert.ok(split.hasSplit, 'sentinel present when dynamic context exists');
  assert.ok(!/- Date: \d{4}-\d{2}-\d{2}/.test(split.stable), 'no date in the cacheable prefix');
  assert.ok(/- Date: \d{4}-\d{2}-\d{2}/.test(split.dynamic), 'date lives in the dynamic tail');

  // The environment tail (workspace/date) is always dynamic, so a real prompt
  // always carries the sentinel; a plain string has none.
  assert.ok(providers.splitSystemPrompt(prompts.buildSystemPrompt({ ...BASE })).hasSplit);
  assert.ok(!providers.splitSystemPrompt('You are a coding agent.').hasSplit, 'plain string has no sentinel');
});

test.after(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});
