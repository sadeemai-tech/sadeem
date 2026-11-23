import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.16 — PROVIDER LATENCY / FAILOVER REGRESSION TESTS
//
// P0: "AI takes forever to reply and is full of errors." Real logs showed
// 22x HTTP 429 and 3x 401 on free OpenRouter models. The old retry stack
// (engine: 600/1800/4000/8000/15000/30000ms; provider: Retry-After up to 15s)
// could burn 60s+ on one bad key BEFORE failover even started.
//
// These tests boot the REAL providers.ts (esbuild-bundled) against a mocked
// fetch and assert:
//   • 401 → provider skipped immediately (ZERO retries), honest notice emitted
//   • 429 → ONE short backoff, then failover, bounded time-to-first-response
//   • 5xx → ONE retry, then success
//   • the whole failover chain shares a wall-clock budget
//   • the OpenAI-compat converter never emits the 3240 message-contract 400
//
// Run:
//   node --test --test-force-exit tests/v1116-provider-latency.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1116-latency-'));

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

// ---------- mock transport ----------

const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

function sseBody(text) {
  return sseChunk({ content: text }) + sseChunk({}, 'stop') + 'data: [DONE]\n\n';
}

const REAL_FETCH = globalThis.fetch;
let calls = [];

/**
 * Install a deterministic fetch. `script[model]` is a queue of responses;
 * when the queue is empty the model returns a 200 SSE reply carrying `done`.
 */
function installFetch(script, done = 'FALLBACK-OK') {
  calls = [];
  const queue = Object.fromEntries(
    Object.entries(script).map(([model, steps]) => [model, [...steps]]),
  );
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const model = body.model;
    const step = (queue[model] ?? []).shift() ?? { status: 200, text: done };
    calls.push({ model, status: step.status, at: Date.now() });
    if (step.status !== 200) {
      return new Response(step.text ?? 'mock provider error', {
        status: step.status,
        headers: step.headers ?? {},
      });
    }
    return new Response(step.sse ?? sseBody(step.text ?? done), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  return calls;
}

function restoreFetch() {
  globalThis.fetch = REAL_FETCH;
}

const model = (id) => ({ provider: 'custom', model: id, maxTokens: 128 });

function turnOpts(id, failover, hooks = {}) {
  return {
    model: model(id),
    baseUrl: 'http://mock.local/v1',
    failover,
    system: 'You are a coding agent.',
    messages: [{ role: 'user', text: 'hello' }],
    tools: [],
    signal: new AbortController().signal,
    onText: () => {},
    onToolUse: () => {},
    ...hooks,
  };
}

const countFor = (id) => calls.filter((c) => c.model === id).length;

// ============================================================
// 1. ERROR CLASSIFICATION — 401 vs 429 vs 5xx are distinct
// ============================================================

test('v1116: error classification distinguishes invalid key, rate limit and server error', () => {
  const k401 = new providers.ProviderHttpError({ status: 401, kind: 'invalid_key', message: 'bad key' });
  assert.equal(providers.providerErrorKindOf(k401), 'invalid_key');
  assert.equal(providers.isInvalidKeyError(k401), true);
  assert.equal(providers.shouldSkipProvider(k401), true);

  const k429 = new providers.ProviderHttpError({ status: 429, kind: 'rate_limited', message: 'slow down' });
  assert.equal(providers.providerErrorKindOf(k429), 'rate_limited');
  assert.equal(providers.isInvalidKeyError(k429), false);
  assert.equal(providers.shouldSkipProvider(k429), true);

  const k503 = new providers.ProviderHttpError({ status: 503, kind: 'server_error', message: 'oops' });
  assert.equal(providers.providerErrorKindOf(k503), 'server_error');

  // Plain Errors (as thrown by older layers / network code) classify too.
  assert.equal(providers.providerErrorKindOf(new Error('Invalid API key (401). Check Settings')), 'invalid_key');
  assert.equal(providers.providerErrorKindOf(new Error('Rate limited (429) — retry shortly.')), 'rate_limited');
  assert.equal(providers.providerErrorKindOf(new Error('Provider error 502: bad gateway')), 'server_error');
});

// ============================================================
// 2. 401 ON THE FIRST MODEL — skip immediately, then succeed
// ============================================================

test('v1116: 401 on first model is skipped with ZERO retries and fails over quickly', async () => {
  const notices = [];
  const text = [];
  installFetch({
    bad: [{ status: 401, text: 'invalid api key' }],
    good: [{ status: 200, text: 'RECOVERED' }],
  }, 'RECOVERED');
  const t0 = Date.now();
  let result;
  try {
    result = await providers.streamTurn(turnOpts('bad', [model('good')], {
      onText: (t) => text.push(t),
      onNotice: (n) => notices.push(n),
    }));
  } finally {
    restoreFetch();
  }
  const elapsed = Date.now() - t0;

  assert.equal(result.stopReason, 'end_turn');
  assert.equal(text.join(''), 'RECOVERED', 'working provider delivered the first response');
  assert.equal(countFor('bad'), 1, '401 must NEVER be retried on the same provider');
  assert.equal(countFor('good'), 1);
  assert.ok(
    notices.some((n) => n.kind === 'provider_skip' && /Invalid API key/i.test(n.text)),
    `invalid-key notice emitted: ${JSON.stringify(notices)}`,
  );
  assert.ok(
    notices.some((n) => n.kind === 'failover' && /good/.test(n.text)),
    `failover notice names the target: ${JSON.stringify(notices)}`,
  );
  assert.ok(elapsed < 3000, `time-to-first-response bounded (got ${elapsed}ms)`);
});

// ============================================================
// 3. 429 ON THE FIRST TWO MODELS — short backoff, then success
// ============================================================

test('v1116: 429 on first two models backs off briefly, fails over, and stays bounded', async () => {
  const notices = [];
  const text = [];
  installFetch({
    // A hostile Retry-After: 30 MUST be capped short, not honored for 30s.
    throttled1: [
      { status: 429, text: 'rate limit', headers: { 'retry-after': '30' } },
      { status: 429, text: 'rate limit' },
    ],
    throttled2: [
      { status: 429, text: 'rate limit', headers: { 'retry-after': '30' } },
      { status: 429, text: 'rate limit' },
    ],
    healthy: [{ status: 200, text: 'FINAL' }],
  }, 'FINAL');
  const t0 = Date.now();
  let result;
  try {
    result = await providers.streamTurn(turnOpts('throttled1', [model('throttled2'), model('healthy')], {
      onText: (t) => text.push(t),
      onNotice: (n) => notices.push(n),
    }));
  } finally {
    restoreFetch();
  }
  const elapsed = Date.now() - t0;

  assert.equal(result.stopReason, 'end_turn');
  assert.equal(text.join(''), 'FINAL');
  // ONE short retry per throttled provider — never a 15s hammer loop.
  assert.ok(countFor('throttled1') >= 2, 'same-provider retry on 429');
  // With same-provider 429 recovery, a later provider may never be reached —
  // that is the desired behaviour (never switch providers on a transient 429).
  assert.equal(countFor('healthy'), 1);
  assert.ok(
    notices.some((n) => n.kind === 'rate_limited'),
    `rate-limit notice emitted: ${JSON.stringify(notices)}`,
  );
  assert.ok(
    notices.filter((n) => n.kind === 'failover').length >= 2,
    `one failover notice per switch: ${JSON.stringify(notices)}`,
  );
  assert.ok(elapsed < 5000, `time-to-first-response bounded (got ${elapsed}ms)`);
});

// ============================================================
// 4. 5xx — retry ONCE, then success
// ============================================================

test('v1116: a 5xx is retried exactly once and then succeeds', async () => {
  const notices = [];
  installFetch({
    flaky: [{ status: 503, text: 'temporary outage' }, { status: 200, text: 'OK-NOW' }],
  }, 'OK-NOW');
  const text = [];
  let result;
  try {
    result = await providers.streamTurn(turnOpts('flaky', [], {
      onText: (t) => text.push(t),
      onNotice: (n) => notices.push(n),
    }));
  } finally {
    restoreFetch();
  }
  assert.equal(countFor('flaky'), 2, 'one retry only');
  assert.equal(text.join(''), 'OK-NOW');
  assert.ok(notices.some((n) => n.kind === 'server_error'));
  assert.equal(result.stopReason, 'end_turn');
});

// ============================================================
// 5. GLOBAL FAILOVER BUDGET — never walk an endless chain
// ============================================================

test('v1116: failover respects the shared wall-clock budget and emits a notice', async () => {
  const prev = process.env.SURNIA_PROVIDER_FAILOVER_BUDGET_MS;
  // v11.31 — 0ms makes the budget check deterministic; 1ms could still be
  // "not elapsed yet" under a heavily loaded test runner and let b fire.
  process.env.SURNIA_PROVIDER_FAILOVER_BUDGET_MS = '0';
  const notices = [];
  installFetch({
    a: [{ status: 401, text: 'bad key' }],
    b: [{ status: 401, text: 'bad key' }],
  });
  let threw = null;
  try {
    await providers.streamTurn(turnOpts('a', [model('b')], { onNotice: (n) => notices.push(n) }));
  } catch (err) {
    threw = err;
  } finally {
    restoreFetch();
    if (prev === undefined) delete process.env.SURNIA_PROVIDER_FAILOVER_BUDGET_MS;
    else process.env.SURNIA_PROVIDER_FAILOVER_BUDGET_MS = prev;
  }
  assert.ok(threw, 'all providers failed → throw');
  assert.equal(countFor('a'), 1, 'budget must stop the chain before a second provider');
  assert.equal(countFor('b'), 0);
  assert.ok(
    notices.some((n) => n.kind === 'failover' && /budget|exhausted|stopping/i.test(n.text)),
    `budget-exhausted notice emitted: ${JSON.stringify(notices)}`,
  );
});

// ============================================================
// 6. MESSAGE CONTRACT — the 3240 HTTP 400 must not come back
// ============================================================

test('v1116: OpenAI converter never emits an empty assistant message or invalid tool args', () => {
  const adversarial = [
    { role: 'assistant', text: '' },
    { role: 'assistant' },
    { role: 'assistant', text: undefined, thinking: 'trace' },
    { role: 'assistant', text: '', toolCalls: [{ id: 'c1', name: 'read_file', args: '{"path":' }] },
    { role: 'assistant', toolCalls: [{ id: 'c2', name: 'no_args' }] },
    { role: 'tool_result', callId: 'orphan', content: '' },
  ];
  const body = providers.toOpenAIMessages('sys', adversarial);
  for (const m of body.filter((x) => x.role === 'assistant')) {
    assert.strictEqual(typeof m.content, 'string');
    assert.ok(m.content.length > 0, 'assistant content is never empty (3240 fix)');
    assert.ok(typeof m.content === 'string' && m.content.length > 0 || m.tool_calls?.length);
    for (const tc of m.tool_calls ?? []) {
      const parsed = JSON.parse(tc.function.arguments);
      assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'tool args are a JSON object');
    }
  }
  for (const m of body.filter((x) => x.role === 'tool')) {
    assert.ok(m.content.length > 0, 'tool result content is never empty');
  }
});

after(() => {
  restoreFetch();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});
