import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.15 — PROVIDER MESSAGE-CONTRACT REGRESSION TESTS
// Tests for the HTTP 400 "Assistant message must have either content or
// tool_calls, but not none" (code 3240) that broke tool-using turns.
//
// The request body's `messages` array is produced entirely by the two pure
// converters in electron/agent/providers.ts (toOpenAIMessages /
// toAnthropicMessages), so asserting on their output is asserting on the
// outgoing wire body. Feed them a battery of adversarial normalized-message
// sequences and check the hard invariants:
//   • NEVER an assistant message with empty content and no tool_calls
//   • tool_call function.arguments is ALWAYS valid JSON (never '')
//   • tool_result messages are ALWAYS paired with a preceding tool_calls msg
//
// Run:
//   node --test --test-force-exit tests/v1115-message-contract.test.mjs
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
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1115-contract-'));

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

const provPath = join(tmp, 'providers.cjs');
bundle(join(ROOT, 'electron/agent/providers.ts'), provPath);
const providers = require(provPath);

// ---------- contract assertions ----------

function assertValidJsonObject(str, label) {
  assert.strictEqual(typeof str, 'string', `${label}: arguments must be a string, got ${typeof str}`);
  assert.ok(str.length > 0, `${label}: arguments must never be empty`);
  let parsed;
  try {
    parsed = JSON.parse(str);
  } catch (e) {
    assert.fail(`${label}: arguments are not valid JSON (${JSON.stringify(str)}): ${e.message}`);
  }
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), `${label}: arguments must be a JSON object, got ${JSON.stringify(parsed)}`);
}

/** OpenAI-compat outgoing body contract. */
function assertOpenAIContract(body, label) {
  assert.ok(Array.isArray(body), `${label}: body must be an array`);
  const declared = new Set();
  body.forEach((m, i) => {
    if (m.role === 'assistant') {
      const hasCalls = Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
      // THE core invariant from the 3240 error.
      assert.ok(
        (typeof m.content === 'string' && m.content.length > 0) || hasCalls,
        `${label}: assistant[${i}] has NEITHER content nor tool_calls: ${JSON.stringify(m)}`,
      );
      // v11.15 strengthening: a benign non-empty string satisfies every
      // gateway (including those that reject content:null beside tool_calls).
      assert.strictEqual(typeof m.content, 'string', `${label}: assistant[${i}] content must be a string, got ${JSON.stringify(m.content)}`);
      assert.ok(m.content.length > 0, `${label}: assistant[${i}] content must be non-empty`);
      if (hasCalls) {
        for (const tc of m.tool_calls) {
          assert.ok(tc.id && tc.type === 'function' && tc.function?.name, `${label}: assistant[${i}] malformed tool_call`);
          assertValidJsonObject(tc.function.arguments, `${label} assistant[${i}] tool_call ${tc.id}`);
          declared.add(tc.id);
        }
      }
    } else if (m.role === 'tool') {
      assert.ok(
        declared.has(m.tool_call_id),
        `${label}: orphan tool result with no preceding tool_calls id ${JSON.stringify(m.tool_call_id)}`,
      );
    }
  });
}

/** Anthropic outgoing body contract. */
function assertAnthropicContract(body, label) {
  assert.ok(Array.isArray(body), `${label}: body must be an array`);
  const declared = new Set();
  body.forEach((m, i) => {
    assert.ok(m.role === 'user' || m.role === 'assistant', `${label}: msg[${i}] bad role ${m.role}`);
    assert.ok(Array.isArray(m.content), `${label}: msg[${i}] content must be an array`);
    if (m.role === 'assistant') {
      assert.ok(m.content.length > 0, `${label}: assistant[${i}] has empty content blocks`);
    }
    for (const block of m.content) {
      if (block.type === 'tool_use') {
        assert.ok(block.id && block.name, `${label}: msg[${i}] malformed tool_use`);
        assert.ok(block.input && typeof block.input === 'object' && !Array.isArray(block.input),
          `${label}: tool_use ${block.id} input is not a concrete object: ${JSON.stringify(block.input)}`);
        declared.add(block.id);
      } else if (block.type === 'tool_result') {
        assert.ok(declared.has(block.tool_use_id),
          `${label}: orphan tool_result with no preceding tool_use ${JSON.stringify(block.tool_use_id)}`);
        assert.ok(Array.isArray(block.content) && block.content.length > 0,
          `${label}: tool_result ${block.tool_use_id} has empty content`);
      } else if (block.type === 'text') {
        assert.strictEqual(typeof block.text, 'string', `${label}: text block missing text`);
      }
    }
  });
}

// ---------- adversarial sequence battery ----------

const tool = (id, name, args) => ({ id, name, args });
const result = (callId, content = 'ok') => ({ role: 'tool_result', callId, content });

const CASES = [
  ['empty assistant text', [{ role: 'assistant', text: '' }]],
  ['assistant with no fields', [{ role: 'assistant' }]],
  ['assistant with undefined text', [{ role: 'assistant', text: undefined }]],
  ['whitespace-only assistant', [{ role: 'assistant', text: '   \n\t' }]],
  ['thinking only (with signature)', [{ role: 'assistant', thinking: 'hmm', thinkingSignature: 'sig' }]],
  ['thinking only (no signature)', [{ role: 'assistant', thinking: 'hmm' }]],
  ['thinking + empty text', [{ role: 'assistant', text: '', thinking: 'hmm' }]],
  ['tool call only, visibleText empty (the tool-loop case)', [
    { role: 'assistant', text: undefined, toolCalls: [tool('c1', 'read_file', '{"path":"a.ts"}')] },
    result('c1', 'file contents'),
  ]],
  ['tool call with empty args string', [
    { role: 'assistant', text: '', toolCalls: [tool('c2', 'list_dir', '')] },
    result('c2'),
  ]],
  ['tool call with truncated args', [
    { role: 'assistant', toolCalls: [tool('c3', 'write_file', '{"path":"a.ts","content":')] },
    result('c3'),
  ]],
  ['tool call with undefined args', [
    { role: 'assistant', toolCalls: [{ id: 'c4', name: 'no_args' }] },
    result('c4'),
  ]],
  ['tool call with JSON scalar args', [
    { role: 'assistant', toolCalls: [tool('c5', 'weird', 'null')] },
    result('c5'),
  ]],
  ['parallel calls, one truncated', [
    { role: 'assistant', text: undefined, toolCalls: [tool('p1', 'a', '{"x":1}'), tool('p2', 'b', '{"y":')] },
    result('p1'),
    result('p2'),
  ]],
  ['dangling tool result only', [result('orphan', 'stray')]],
  ['dangling tool result after empty assistant', [
    { role: 'assistant', text: '' },
    result('orphan'),
  ]],
  ['mixed adversarial chain', [
    { role: 'user', text: 'do the thing' },
    { role: 'assistant', text: undefined, toolCalls: [tool('m1', 'read_file', '{"path":"x"}')] },
    result('m1', 'data'),
    result('m2', 'stray'),
    { role: 'assistant', text: '' },
    { role: 'assistant', thinking: 'continue', thinkingSignature: 's' },
  ]],
  ['empty sequence', []],
  ['user only', [{ role: 'user', text: 'hi' }]],
];

const SYSTEM = 'You are a coding agent.';

test('v11.15: OpenAI-compat outgoing body never violates the message contract (adversarial battery)', () => {
  for (const [name, msgs] of CASES) {
    const body = providers.toOpenAIMessages(SYSTEM, msgs);
    assertOpenAIContract(body, `OpenAI / ${name}`);
  }
});

test('v11.15: Anthropic outgoing body never violates the message contract (adversarial battery)', () => {
  for (const [name, msgs] of CASES) {
    const body = providers.toAnthropicMessages(msgs);
    assertAnthropicContract(body, `Anthropic / ${name}`);
  }
});

// ---------- targeted regression assertions ----------

test('v11.15: empty/undefined assistant text becomes a benign non-empty string (never null)', () => {
  for (const m of [
    { role: 'assistant', text: '' },
    { role: 'assistant', text: undefined },
    { role: 'assistant', thinking: 'reasoning only' },
  ]) {
    const body = providers.toOpenAIMessages(SYSTEM, [m]);
    const a = body.find((x) => x.role === 'assistant');
    assert.ok(a, 'assistant message present');
    assert.strictEqual(typeof a.content, 'string');
    assert.ok(a.content.length > 0, `benign placeholder emitted for ${JSON.stringify(m)}`);
    assert.ok(!a.tool_calls, 'no phantom tool_calls');
  }
});

test('v11.15: tool-loop message with empty text gets content AND valid tool_calls', () => {
  const body = providers.toOpenAIMessages(SYSTEM, [
    { role: 'assistant', text: undefined, toolCalls: [tool('tc1', 'read_file', '{"path":"a.ts"}')] },
    result('tc1'),
  ]);
  const a = body.find((x) => x.role === 'assistant');
  assert.ok(a.content.length > 0, 'content placeholder present beside tool_calls');
  assert.equal(a.tool_calls.length, 1);
  assert.deepEqual(JSON.parse(a.tool_calls[0].function.arguments), { path: 'a.ts' });
  assertOpenAIContract(body, 'tool-loop');
});

test('v11.15: empty and truncated tool args are normalized to "{}"', () => {
  const body = providers.toOpenAIMessages(SYSTEM, [
    { role: 'assistant', toolCalls: [
      tool('e1', 'empty', ''),
      tool('e2', 'truncated', '{"a":'),
      tool('e3', 'scalar', '42'),
      tool('e4', 'valid', '{"ok":true}'),
    ] },
  ]);
  const args = body.find((x) => x.role === 'assistant').tool_calls.map((tc) => tc.function.arguments);
  assert.deepEqual(args.slice(0, 3), ['{}', '{}', '{}']);
  assert.deepEqual(JSON.parse(args[3]), { ok: true });
  for (const a of args) assertValidJsonObject(a, 'normalized args');
});

test('v11.15: dangling tool results are dropped, paired results survive', () => {
  const body = providers.toOpenAIMessages(SYSTEM, [
    result('orphan-a'),
    { role: 'assistant', toolCalls: [tool('real', 'x', '{}')] },
    result('real', 'yes'),
    result('orphan-b'),
  ]);
  const toolMsgs = body.filter((m) => m.role === 'tool');
  assert.equal(toolMsgs.length, 1, 'only the paired result survives');
  assert.equal(toolMsgs[0].tool_call_id, 'real');
  assertAnthropicContract(providers.toAnthropicMessages([
    result('orphan-a'),
    { role: 'assistant', toolCalls: [tool('real', 'x', '{}')] },
    result('real', 'yes'),
    result('orphan-b'),
  ]), 'Anthropic pairing');
});

test('v11.15: valid content is preserved verbatim (no behavior drift)', () => {
  const body = providers.toOpenAIMessages(SYSTEM, [
    { role: 'user', text: 'hello' },
    { role: 'assistant', text: 'a real answer' },
  ]);
  assert.equal(body[2].content, 'a real answer');
  const anth = providers.toAnthropicMessages([{ role: 'assistant', text: 'a real answer' }]);
  assert.equal(anth[0].role, 'user', 'leading assistant gets a user preamble');
  assert.equal(anth[1].content[0].text, 'a real answer');
});

test.after(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});
