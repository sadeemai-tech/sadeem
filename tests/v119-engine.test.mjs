import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// v11.9 — ENGINE RELIABILITY FIXES (Task 3-a): unit tests for the pure,
// network-free parts of the E1–E19 engine fixes.
//   • E3  pause_turn / refusal stop-reason mapping (providers.ts)
//   • E5  GOAL_COMPLETE marker stripping (engine.ts)
//   • E6  ```surnia-tool fence stripping / parse (engine.ts)
//   • E8  temp-id vs final-id tool-call dedupe invariant (engine.ts + providers.ts)
//   • E10 content_filter finish_reason mapping (providers.ts)
//   • E16 Q&A heuristic for the unapplied-code gate (engine.ts)
//   • E11/E12/E13/E19 source-level wiring asserts (same posture as v31-harness)
// Self-bootstrapping: bundles electron/agent/{engine,providers}.ts with esbuild
// (same flags as tests/v2-verify.mjs / v3-harness.test.mjs). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v119-'));

// ---------- esbuild bundle (same posture as v2-verify.mjs / v3-harness) ----------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, 
    entry,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${out}`,
    '--external:electron',
    '--external:@xterm/xterm',
    '--external:@xterm/addon-fit',
    '--external:monaco-editor',
    '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// electron stub for plain-Node execution (minimal — nothing here calls it)
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `module.exports = { app: { getPath: (k) => ${JSON.stringify(tmp)}, whenReady: async () => true, on() {}, quit() {} }, ipcMain: { handle() {}, on() {} } };`,
);

const provPath = join(tmp, 'providers.cjs');
bundle('electron/agent/providers.ts', provPath);
const providers = require(provPath);

const engPath = join(tmp, 'engine.cjs');
bundle('electron/agent/engine.ts', engPath);
const engine = require(engPath);

// ---------- E3 — Anthropic stop_reason mapping ----------
test('E3: pause_turn maps to a dedicated "paused" stop reason', () => {
  assert.equal(providers.mapAnthropicStopReason('pause_turn'), 'paused');
  assert.equal(providers.mapAnthropicStopReason('refusal'), 'refusal');
});

test('E3: classic Anthropic stop reasons keep their mapping', () => {
  assert.equal(providers.mapAnthropicStopReason('tool_use'), 'tool_use');
  assert.equal(providers.mapAnthropicStopReason('max_tokens'), 'max_tokens');
  assert.equal(providers.mapAnthropicStopReason('end_turn'), 'end_turn');
  assert.equal(providers.mapAnthropicStopReason('stop_sequence'), 'end_turn');
});

test('E10: OpenAI content_filter no longer silently becomes end_turn', () => {
  assert.equal(providers.mapOpenAIFinishReason('content_filter'), 'content_filter');
  assert.equal(providers.mapOpenAIFinishReason('stop'), 'end_turn');
  assert.equal(providers.mapOpenAIFinishReason('tool_calls'), 'tool_use');
  assert.equal(providers.mapOpenAIFinishReason('length'), 'max_tokens');
});

// ---------- E5 — GOAL_COMPLETE stripping ----------
test('E5: stripGoalMarker removes the marker line from final text', () => {
  assert.equal(engine.stripGoalMarker('All work is done.\nGOAL_COMPLETE\n'), 'All work is done.');
  assert.equal(engine.stripGoalMarker('  GOAL_COMPLETE with trailing prose  \nrest'), 'rest');
  assert.equal(engine.stripGoalMarker('\tGOAL_COMPLETE'), '');
});

test('E5: stripGoalMarker preserves ordinary text (incl. non-marker words)', () => {
  assert.equal(engine.stripGoalMarker('the goal is complete and verified'), 'the goal is complete and verified');
  // \b after GOAL_COMPLETE — "GOAL_COMPLETELY" is NOT a marker line
  assert.equal(engine.stripGoalMarker('it was GOAL_COMPLETELY wrong'), 'it was GOAL_COMPLETELY wrong');
  assert.equal(engine.stripGoalMarker(''), '');
});

// ---------- E6 — surnia-tool fence stripping ----------
test('E6: stripTextToolBlocks removes every raw tool fence from visible text', () => {
  const raw = 'Before\n```surnia-tool\n{"tool":"read_file","args":{"path":"a.ts"}}\n```\nAfter';
  const out = engine.stripTextToolBlocks(raw);
  assert.ok(!out.includes('surnia-tool'), 'no fence marker left');
  assert.ok(out.includes('Before') && out.includes('After'), 'surrounding prose kept');
  assert.equal(engine.stripTextToolBlocks('plain answer'), 'plain answer');
});

test('E6: parseTextToolCalls parses known-tool fences and skips unknown/malformed', () => {
  const known = new Set(['read_file']);
  const good = '```surnia-tool\n{"tool":"read_file","args":{"path":"a.ts"}}\n```';
  const parsed = engine.parseTextToolCalls(good, known);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, 'read_file');
  assert.equal(JSON.parse(parsed[0].args).path, 'a.ts');
  // unknown tool → dropped (never dispatched) — the fence is stripped downstream
  assert.equal(engine.parseTextToolCalls('```surnia-tool\n{"tool":"not_a_tool"}\n```', known).length, 0);
  // malformed JSON → dropped
  assert.equal(engine.parseTextToolCalls('```surnia-tool\n{"tool":"read_file",\n```', known).length, 0);
});

// ---------- E8 — temp-id vs final-id dedupe invariant ----------
test('E8: temp-id partial is pruned next to the final complete call (prefix args)', () => {
  const pending = new Map([
    [`${providers.TEMP_TOOL_ID_PREFIX}call_0`, { name: 'read_file', args: '{"path":"src/a' }], // throttled partial
    ['toolu_real_1', { name: 'read_file', args: '{"path":"src/a.ts","mode":"text"}' }], // final flush
  ]);
  engine.pruneTempToolCalls(pending);
  assert.equal(pending.size, 1);
  assert.ok(pending.has('toolu_real_1'), 'only the FINAL complete call survives');
});

test('E8: temp-id entry with invalid JSON args is pruned for the same name', () => {
  const pending = new Map([
    [`${providers.TEMP_TOOL_ID_PREFIX}call_0`, { name: 'run_command', args: '{"comm' }], // truncated → invalid
    ['toolu_real_2', { name: 'run_command', args: '{"command":"npm test"}' }],
  ]);
  engine.pruneTempToolCalls(pending);
  assert.deepEqual([...pending.keys()], ['toolu_real_2']);
});

test('E8: a genuinely different temp call (distinct valid args, same name) is KEPT', () => {
  const pending = new Map([
    [`${providers.TEMP_TOOL_ID_PREFIX}call_0`, { name: 'read_file', args: '{"path":"b.ts"}' }],
    ['toolu_real_3', { name: 'read_file', args: '{"path":"a.ts","line":3}' }],
  ]);
  engine.pruneTempToolCalls(pending);
  assert.equal(pending.size, 2, 'nothing prefix-related → nothing pruned');
});

test('E8: temp-only entries (no final flush yet) survive; other names untouched', () => {
  const pending = new Map([
    [`${providers.TEMP_TOOL_ID_PREFIX}call_0`, { name: 'read_file', args: '{"path":"src/a' }],
    ['toolu_real_4', { name: 'write_file', args: '{"path":"x.ts"}' }],
  ]);
  engine.pruneTempToolCalls(pending);
  assert.equal(pending.size, 2);
});

// ---------- E16 — Q&A heuristic for the unapplied-code agency gate ----------
test('E16: questions are detected (EN + AR + question marks)', () => {
  assert.equal(engine.looksLikeQuestion('What is recursion?'), true);
  assert.equal(engine.looksLikeQuestion('how does the retry loop work'), true);
  assert.equal(engine.looksLikeQuestion('Is this a bug'), true);
  assert.equal(engine.looksLikeQuestion('ما هي فوائد استخدام الوكيل؟'), true);
  assert.equal(engine.looksLikeQuestion('هل يمكن ذلك'), true);
  assert.equal(engine.looksLikeQuestion('why'), true);
});

test('E16: build requests are NOT questions even when phrased curiously', () => {
  assert.equal(engine.looksLikeQuestion('Write a parser for CSV files'), false);
  assert.equal(engine.looksLikeQuestion('fix the failing test in auth.ts'), false);
  assert.equal(engine.looksLikeQuestion('أنشئ مكوّن جديد للوحة التحكم'), false);
  assert.equal(engine.looksLikeQuestion('what is 2+2? also write it to out.txt'), false);
  assert.equal(engine.looksLikeQuestion(''), false);
});

// ---------- E13 — KEY_REQUIRED_PROVIDERS completeness (source assert) ----------
test('E13: KEY_REQUIRED_PROVIDERS covers xai/moonshot/qwen/mistral (exact ids)', () => {
  const src = readFileSync(join(ROOT, 'electron', 'agent', 'engine.ts'), 'utf8');
  const m = /KEY_REQUIRED_PROVIDERS = new Set<ProviderId>\(\[([\s\S]*?)\]\)/.exec(src);
  assert.ok(m, 'KEY_REQUIRED_PROVIDERS found');
  const ids = [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
  for (const id of ['anthropic', 'openai', 'openrouter', 'gemini', 'zai', 'deepseek', 'xai', 'moonshot', 'qwen', 'mistral']) {
    assert.ok(ids.includes(id), `provider "${id}" is key-required`);
  }
  // keyless families stay out
  assert.ok(!ids.includes('ollama') && !ids.includes('custom'), 'ollama/custom remain key-optional');
});

// ---------- E11 — cli.ts env chain ----------
test('E11: cli.ts resolves SURNIA_HOME via SURNIA_HOME || KODEX_HOME || default', () => {
  const src = readFileSync(join(ROOT, 'electron', 'agent', 'cli.ts'), 'utf8');
  assert.ok(src.includes("process.env.SURNIA_HOME || process.env.KODEX_HOME || path.join(os.homedir(), '.surnia')"), 'intended chain restored');
  assert.ok(!src.includes('process.env.SURNIA_HOME || process.env.SURNIA_HOME'), 'duplicated condition gone');
});

// ---------- E12 — skillGate dead ternary ----------
test('E12: promoteSkillsFromTraces returns out directly (dead ternary removed)', () => {
  const src = readFileSync(join(ROOT, 'electron', 'agent', 'skillGate.ts'), 'utf8');
  assert.ok(!/return\s+out\.promotions\.length\s*\|\|\s*out\.scanned\s*\?\s*out\s*:\s*out\s*;/.test(src), 'dead ternary return gone');
  assert.ok(/return\s+out;\s*$/m.test(src), 'plain `return out;` in place');
});

// ---------- E19 — unknown slash commands are a local no-op (source assert) ----------
test('E19: unknown slash commands emit a local sys_notice + zero-usage no-op end', () => {
  const src = readFileSync(join(ROOT, 'electron', 'agent', 'engine.ts'), 'utf8');
  assert.ok(src.includes("Unknown command '/"), 'friendly unknown-command notice present');
  assert.ok(/expanded\)\s*\{[\s\S]*?message_end[\s\S]*?inputTokens: 0[\s\S]*?turn_end[\s\S]*?return;/, 'no-op end (zero usage, no model call)');
  assert.ok(!src.includes('unknown/failed command → pass the raw text through'), 'old pass-through comment gone');
});

test('cleanup', () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
