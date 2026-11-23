// v11.18 — NO TOOL SLICING. The founder's complaint:
//   "الأدوات الكثيرة لماذا أزلتها؟ لماذا قلصتها؟ طلبت منك أن تحافظ على قدرته"
// A strict gateway 422 on ONE tool schema must drop ONLY that tool (located via
// detail[].loc), never shrink the tool list to a fixed count such as 40.
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1118-'));
const mod = join(tmp, 'providers.cjs');
execFileSync(ESBUILD_NODE, [ESBUILD_BIN, join(ROOT, 'electron/agent/providers.ts'),
  '--bundle', '--platform=node', '--format=cjs', '--outfile=' + mod,
  '--external:electron', '--log-level=error'], { cwd: ROOT, timeout: 120000 });
const p = require(mod);

// The founder's EXACT 422 payload: the offending tool is tools[147].
const FOUNDER_422 = JSON.stringify({
  detail: [
    { type: 'literal_error', loc: ['body', 'tools', 147, 'WebSearchTool', 'type'],
      msg: 'Input should be a valid literal', input: 'function' },
  ],
});

const SSE_OK = 'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
const REAL_FETCH = globalThis.fetch;

// 150 tools — the one at index 147 is the strict gateway's WebSearchTool.
const TOOLS = Array.from({ length: 150 }, (_, i) => ({
  name: i === 147 ? 'WebSearchTool' : `tool_${String(i).padStart(3, '0')}`,
  description: 'x',
  parameters: { type: 'object', properties: {} },
}));

function turnArgs(hooks = {}) {
  return {
    model: { provider: 'custom', model: 'strict-model', maxTokens: 100 },
    baseUrl: 'http://127.0.0.1:9/v1',
    system: 'hello',
    messages: [{ role: 'user', text: 'go' }],
    tools: TOOLS.map((t) => ({ ...t, parameters: { ...t.parameters } })),
    promptCaching: false,
    signal: new AbortController().signal,
    onText: () => {}, onThinking: () => {}, onToolUse: () => {}, onNotice: () => {}, onUsage: () => {},
    ...hooks,
  };
}

const json422 = (body) => new Response(body, {
  status: 422, headers: { 'content-type': 'application/json' },
});
const sse200 = () => new Response(SSE_OK, {
  status: 200, headers: { 'content-type': 'text/event-stream' },
});

beforeEach(() => {
  p.resetSkippedTools();
  p.resetCacheControlRejections();
  globalThis.fetch = REAL_FETCH;
});
after(() => {
  globalThis.fetch = REAL_FETCH;
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ---------------------------------------------------------------------------

test('source: no code path narrows tools to a fixed count', () => {
  const src = readFileSync(join(ROOT, 'electron/agent/providers.ts'), 'utf8');
  // Strip comments so prose mentioning the old approach cannot mask live code.
  const live = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(live, /\btools\w*(?:\.\w+)*\.slice\(\s*0\s*,\s*\d+\s*\)/i,
    'no tools.slice(0, N) may remain on any live code path');
  assert.doesNotMatch(live, /\.slice\(\s*0\s*,\s*(?:10|20|30|40)\s*\)/,
    'no fixed small-count slice remains');
  assert.doesNotMatch(live, /\btools\w*(?:\.\w+)*\.splice\(\s*0\s*,\s*\d+\s*\)/i,
    'no tools.splice(0, N) fixed-count removal');
  assert.match(live, /obj\.tools\.splice\(index, 1\)/,
    'only a single tool is removed, at the located index');
  assert.match(live, /toolIndexFromValidationError/, 'loc-based detection is present');
});

test('pure helper parses the founder loc and refuses unparseable payloads', () => {
  assert.equal(p.toolIndexFromValidationError(FOUNDER_422), 147);
  assert.equal(p.toolIndexFromValidationError(JSON.stringify({
    detail: [{ loc: ['body', 'tools', 9, 'function', 'parameters'] }],
  })), 9);
  assert.equal(p.toolIndexFromValidationError(JSON.stringify({
    detail: [{ loc: 'body.tools.12.type' }],
  })), 12);
  assert.equal(p.toolIndexFromValidationError('not json at all'), -1);
  assert.equal(p.toolIndexFromValidationError(JSON.stringify({
    detail: [{ type: 'value_error', msg: 'opaque validation failure' }],
  })), -1);
});

test('founder payload: retry keeps 149 tools, only index 147 removed, answer arrives', async () => {
  const seen = [];
  globalThis.fetch = async (_url, init) => {
    const parsed = JSON.parse(init.body);
    seen.push({ parsed, raw: init.body });
    return seen.length === 1 ? json422(FOUNDER_422) : sse200();
  };
  let text = '';
  try {
    await p.streamTurn(turnArgs({ onText: (t) => { text += t; } }));
  } finally {
    globalThis.fetch = REAL_FETCH;
  }

  assert.equal(seen.length, 2, 'one 422, one retry');
  assert.equal(seen[0].parsed.tools.length, 150, 'first call sent all 150 tools');
  const firstNames = seen[0].parsed.tools.map((t) => t.function.name);
  assert.equal(firstNames[147], 'WebSearchTool', 'index 147 is the offending tool');

  assert.equal(seen[1].parsed.tools.length, 149, 'exactly ONE tool was removed');
  const secondNames = seen[1].parsed.tools.map((t) => t.function.name);
  assert.deepEqual(secondNames, firstNames.filter((_, i) => i !== 147),
    'every other tool name and position is intact');
  assert.ok(!secondNames.includes('WebSearchTool'), 'only WebSearchTool was dropped');
  assert.ok(!seen[1].raw.includes('cache_control'), 'no cache_control marker on the retry');
  assert.ok(text.includes('OK'), 'the answer still arrives');
});

test('the offending tool name is remembered per endpoint, not globally', async () => {
  let call = 0;
  globalThis.fetch = async (_url, init) => {
    call++;
    return call === 1 ? json422(FOUNDER_422) : sse200();
  };
  try {
    await p.streamTurn(turnArgs());
  } finally {
    globalThis.fetch = REAL_FETCH;
  }

  const same = p.buildOpenAIRequestBody(turnArgs()).body;
  assert.equal(same.tools.length, 149, 'later turns to the same endpoint omit the rejected tool');
  assert.ok(!same.tools.some((t) => t.function.name === 'WebSearchTool'));

  const other = p.buildOpenAIRequestBody({
    ...turnArgs(), baseUrl: 'http://127.0.0.1:10/v1',
  }).body;
  assert.equal(other.tools.length, 150, 'a different endpoint keeps the full tool set');
});

test('unparseable 422 loc propagates the honest error and drops nothing', async () => {
  const opaque = JSON.stringify({ detail: [{ type: 'value_error', msg: 'opaque validation failure' }] });
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return json422(opaque);
  };
  let err = null;
  try {
    await p.streamTurn(turnArgs());
  } catch (e) {
    err = e;
  } finally {
    globalThis.fetch = REAL_FETCH;
  }
  assert.ok(err, 'the 422 surfaces to the caller');
  assert.match(String(err?.message ?? err), /422/);
  assert.equal(bodies.length, 1, 'no retry with a narrowed tool list');
  assert.equal(bodies[0].tools.length, 150, 'no tool was dropped');
});

test('a loc pointing outside the body drops nothing and surfaces the 422', async () => {
  const outOfRange = JSON.stringify({
    detail: [{ type: 'literal_error', loc: ['body', 'tools', 9999, 'type'] }],
  });
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return json422(outOfRange);
  };
  let err = null;
  try {
    await p.streamTurn(turnArgs());
  } catch (e) {
    err = e;
  } finally {
    globalThis.fetch = REAL_FETCH;
  }
  assert.ok(err, 'honest error when the loc cannot be reconciled with the body');
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].tools.length, 150);
});
