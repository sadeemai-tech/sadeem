// ============================================================
// v11.38 — PER-MODEL REASONING EFFORT (the founder's F12 request)
// ------------------------------------------------------------
// Proves, with a SINGLE esbuild module graph (so the catalog cache the main
// process seeds is the same one the request builder reads):
//   1 · GPT → 4 REAL named stops (minimal/low/medium/high) → reasoning_effort
//   2 · o-series → 3 stops; GLM → 3 stops; Gemini → 2 stops (honest no-field)
//   3 · Claude → named stops → REAL thinking.budget_tokens on the wire
//   4 · unknown model → honest curated default, no invented capability
//   5 · a REAL-shaped OpenRouter `/api/v1/models` fixture is parsed and its
//       `supported_parameters` capability drives the descriptor + wire field
//   6 · BEHAVIOURAL: moving the slider one stop changes the ACTUAL request field
//   7 · the chat control + model picker + settings tab all consume the descriptor
//
//   node --test --test-force-exit tests/v1138-effort.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1138-effort-'));
const outfile = join(tmp, 'effort-graph.cjs');

// One bundle ⇒ one instance of openrouterCatalog's cache. Seeding the fixture
// therefore really affects buildOpenAIRequestBody (no test-only injection).
await esbuild.build({
  stdin: {
    contents: [
      "export * as effort from './shared/effort';",
      "export * as providers from './electron/agent/providers';",
      "export * as catalog from './electron/services/openrouterCatalog';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'cjs', outfile,
  external: ['electron'], logLevel: 'silent',
});
const M = require(outfile);
after(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });

const names = (d) => d.levels.map((l) => l.name);
const wireFor = (provider, model, level) => {
  const d = M.effort.effortLevelsFor(provider, model);
  const normalized = M.effort.normalizeEffortLevel(d, level);
  return M.effort.effortWireFor(d, normalized);
};
function turnArgs(provider, model, reasoning) {
  return {
    model: { provider, model, maxTokens: 8192, temperature: 0.2, reasoning },
    apiKey: 'test-key',
    baseUrl: provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1',
    system: 'You are a coding agent.',
    messages: [{ role: 'user', text: 'fix the bug' }],
    tools: [],
    signal: new AbortController().signal,
    promptCaching: false,
    onText() {}, onToolUse() {},
  };
}
const bodyFor = (provider, model, reasoning) =>
  M.providers.buildOpenAIRequestBody(turnArgs(provider, model, reasoning)).body;

// ---------------------------------------------------------------------
// 1 · GPT families
// ---------------------------------------------------------------------
test('1a · GPT model → exactly four REAL OpenAI reasoning_effort names', () => {
  const d = M.effort.effortLevelsFor('openai', 'gpt-5.3-codex');
  assert.deepEqual(names(d), ['minimal', 'low', 'medium', 'high']);
  assert.equal(d.param, 'reasoning_effort');
  assert.equal(d.family, 'gpt5');
  assert.equal(d.defaultLevel, 'minimal', 'never silently turns reasoning on');
  assert.ok(d.levels.every((l) => l.en && l.ar), 'each stop has bilingual labels');
});

test('1b · the request body carries the EXACT GPT stop in reasoning_effort', () => {
  assert.equal(bodyFor('openai', 'gpt-5.3-codex', 'high').reasoning_effort, 'high');
  assert.equal(bodyFor('openai', 'gpt-5.3-codex', 'minimal').reasoning_effort, 'minimal');
  assert.equal(bodyFor('openai', 'gpt-5.3-codex', 'off').reasoning_effort, undefined,
    'off emits no reasoning field (legacy alias honoured)');
});

test('1c · o-series has THREE stops (no fabricated minimal)', () => {
  const d = M.effort.effortLevelsFor('openai', 'o3');
  assert.deepEqual(names(d), ['low', 'medium', 'high']);
  assert.equal(d.param, 'reasoning_effort');
  assert.equal(bodyFor('openai', 'o3', 'high').reasoning_effort, 'high');
});

// ---------------------------------------------------------------------
// 2 · Claude thinking budget + other curated families
// ---------------------------------------------------------------------
test('2a · Claude stops map to REAL budget_tokens, not a decorative label', () => {
  const d = M.effort.effortLevelsFor('anthropic', 'claude-sonnet-5.5');
  assert.deepEqual(names(d), ['none', 'low', 'medium', 'high']);
  assert.equal(d.param, 'thinking.budget_tokens');
  assert.equal(d.budgets.high, 16384);
  assert.equal(d.budgets.medium, 8192);
  assert.equal(d.budgets.low, 2048);
  assert.equal(d.budgets.none, 0);

  assert.deepEqual(wireFor('anthropic', 'claude-sonnet-5.5', 'high'),
    { thinking: { type: 'enabled', budget_tokens: 16384 } });
  assert.deepEqual(wireFor('anthropic', 'claude-sonnet-5.5', 'low'),
    { thinking: { type: 'enabled', budget_tokens: 2048 } }, 'low is NOT 8192');
  assert.deepEqual(wireFor('anthropic', 'claude-sonnet-5.5', 'none'), {}, 'none emits nothing');

  assert.equal(M.providers.wantedThinkingBudget('anthropic', 'claude-sonnet-5.5', 'high'), 16384);
  assert.equal(M.providers.wantedThinkingBudget('anthropic', 'claude-sonnet-5.5', 'medium'), 8192);
  assert.equal(M.providers.wantedThinkingBudget('openai', 'gpt-5.3-codex', 'high'), 0,
    'a GPT effort must never become an Anthropic thinking budget');
});

test('2b · GLM (low/high/max) and Gemini (low/high) keep their own stop counts', () => {
  assert.deepEqual(names(M.effort.effortLevelsFor('zai', 'glm-5.3')), ['low', 'high', 'max']);
  const gemini = M.effort.effortLevelsFor('gemini', 'gemini-4-argon');
  assert.deepEqual(names(gemini), ['low', 'high']);
  assert.equal(gemini.param, 'none', 'honest: direct Gemini compat has NO named effort field');
  assert.deepEqual(M.effort.effortWireFor(gemini, 'high'), {}, 'no fake wire parameter is invented');
  assert.match(gemini.note.en, /no named effort field/i);
});

// ---------------------------------------------------------------------
// 3 · honest unknown fallback
// ---------------------------------------------------------------------
test('3 · unknown model → honest curated default (no invented capability)', () => {
  const d = M.effort.effortLevelsFor('custom', 'totally-unknown-xyz');
  assert.deepEqual(names(d), ['off', 'low', 'medium', 'high']);
  assert.equal(d.source, 'curated');
  assert.ok(d.note.en.length > 10 && d.note.ar.length > 10, 'provenance is displayed');
  assert.equal(M.effort.normalizeEffortLevel(d, 'nonsense'), 'off', 'unknown value clamps to default');
  assert.equal(M.effort.normalizeEffortLevel(d, undefined), 'off');
});

// ---------------------------------------------------------------------
// 4 · REAL provider catalog fixture → capability → wire field
// ---------------------------------------------------------------------
const FIXTURE = {
  data: [
    {
      id: 'openai/gpt-5.3-codex', name: 'GPT-5.3 Codex', context_length: 400000,
      supported_parameters: ['temperature', 'reasoning_effort', 'tools'],
      pricing: { prompt: '0.00000175', completion: '0.000014' },
    },
    {
      id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', context_length: 1000000,
      supported_parameters: ['reasoning', 'tools'],
      pricing: { prompt: '0.000002', completion: '0.00001' },
    },
  ],
};

test('4a · the provider REPORTED capability is parsed from a real-shaped payload', () => {
  const rows = M.catalog.parseOpenRouterModels(FIXTURE);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].supportedParameters, ['temperature', 'reasoning_effort', 'tools']);
  assert.deepEqual(rows[1].supportedParameters, ['reasoning', 'tools']);

  const sigGpt = M.catalog.openrouterEffortSignalFor('openai/gpt-5.3-codex', rows);
  assert.equal(sigGpt.supportsReasoningEffort, true);
  assert.equal(sigGpt.supportsReasoning, false);
  const sigClaude = M.catalog.openrouterEffortSignalFor('anthropic/claude-sonnet-5.5', rows);
  assert.equal(sigClaude.supportsReasoning, true);
  assert.equal(M.catalog.openrouterEffortSignalFor('not/in-catalog', rows), null,
    'no row = null, never a fabricated capability');
});

test('4b · the seeded LIVE catalog changes the real request body', () => {
  const rows = M.catalog.parseOpenRouterModels(FIXTURE);
  M.catalog.__seedOpenRouterCatalogForTest(rows);
  const desc = M.providers.effortDescriptorFor('openrouter', 'openai/gpt-5.3-codex');
  assert.equal(desc.source, 'provider-catalog');
  assert.equal(desc.param, 'reasoning_effort');
  const body = bodyFor('openrouter', 'openai/gpt-5.3-codex', 'high');
  assert.equal(body.reasoning_effort, 'high', 'provider-reported field is used, not the legacy router guess');
  assert.equal(body.reasoning, undefined);

  const claudeBody = bodyFor('openrouter', 'anthropic/claude-sonnet-5.5', 'medium');
  assert.deepEqual(claudeBody.reasoning, { effort: 'medium' },
    'a router that only reports `reasoning` gets reasoning.effort');
  M.catalog.__resetOpenRouterCatalogForTest();
});

// ---------------------------------------------------------------------
// 5 · BEHAVIOURAL: one slider stop → one different wire field
// ---------------------------------------------------------------------
test('5a · GPT slider stop change changes reasoning_effort on the wire', () => {
  const desc = M.effort.effortLevelsFor('openai', 'gpt-6-astra');
  const i = M.effort.effortLevelIndex(desc, 'low');
  assert.equal(i, 1);
  const before = desc.levels[i].name;
  const after = desc.levels[i + 1].name;
  const b1 = bodyFor('openai', 'gpt-6-astra', before);
  const b2 = bodyFor('openai', 'gpt-6-astra', after);
  assert.equal(b1.reasoning_effort, 'low');
  assert.equal(b2.reasoning_effort, 'medium');
  assert.notEqual(b1.reasoning_effort, b2.reasoning_effort, 'the founder can SEE the difference');
});

test('5b · Claude slider stop change changes budget_tokens on the wire', () => {
  const desc = M.effort.effortLevelsFor('anthropic', 'claude-opus-5-5');
  const i = M.effort.effortLevelIndex(desc, 'low');
  const after = desc.levels[i + 1].name;
  assert.equal(M.providers.wantedThinkingBudget('anthropic', 'claude-opus-5-5', desc.levels[i].name), 2048);
  assert.equal(M.providers.wantedThinkingBudget('anthropic', 'claude-opus-5-5', after), 8192);
  assert.notEqual(
    M.providers.wantedThinkingBudget('anthropic', 'claude-opus-5-5', desc.levels[i].name),
    M.providers.wantedThinkingBudget('anthropic', 'claude-opus-5-5', after),
  );
});

// ---------------------------------------------------------------------
// 6 · UI wiring (every chooser consumes the SAME descriptor)
// ---------------------------------------------------------------------
test('6 · chat control, model picker and settings tab all use shared/effort', () => {
  const chat = read('src/components/EffortControl.tsx');
  const picker = read('src/components/ModelPicker.tsx');
  const settings = read('src/components/settings/ModelsSection.tsx');
  const prov = read('electron/agent/providers.ts');
  const cat = read('electron/services/openrouterCatalog.ts');
  assert.match(chat, /effortLevelsFor\(/, 'chat control builds the model descriptor');
  assert.match(chat, /<ReasoningSlider desc=\{desc\}/, 'chat slider is descriptor-driven');
  assert.match(picker, /effortDesc\.levels\.map\(/, 'model picker shows the model\'s own stops');
  assert.match(settings, /effortDesc\.levels\.map\(/, 'settings tab shows the model\'s own stops');
  assert.match(prov, /Object\.assign\(body, effortWireFor\(desc, level\)\)/, 'real wire field is applied');
  assert.match(prov, /thinkingBudgetFor\(provider, model, level\)/, 'Anthropic budget comes from the descriptor');
  assert.match(cat, /supported_parameters/, 'capability really comes from the provider payload');
});
