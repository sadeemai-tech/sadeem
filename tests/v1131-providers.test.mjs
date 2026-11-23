// ============================================================================
// v11.31 — PROVIDER + ROUTER AUDIT (capability agent)
//
// Real-shaped HTTP/SSE responses against the REAL providers.ts / router.ts
// bundles. Covers every status path, stream parsing, SSE edge cases, dropped
// streams, malformed chunks, tool-call streaming, usage accounting, secret
// redaction, retry/backoff budgets, the failover gate and slow-provider rule.
//
// Invariants locked here (founder contracts):
//   • 402 / 401 are FATAL on the FIRST response (exactly one request);
//   • 429 is bounded, recovers IN PLACE (no auto provider switch) when no
//     failover chain is supplied, and never leaks raw JSON;
//   • a slow/stalled provider NEVER triggers an automatic switch;
//   • cross-provider failover is opt-in and OFF by default;
//   • no credential can reach a user-visible error/notice.
//
// Run: node --test --test-force-exit tests/v1131-providers.test.mjs
// ============================================================================
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
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
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1131-'));
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, join(ROOT, entry), '--bundle', '--platform=node',
    '--format=cjs', '--outfile=' + out, '--external:electron', '--log-level=error'],
  { cwd: ROOT, timeout: 120000 });
}
bundle('electron/agent/providers.ts', join(tmp, 'providers.cjs'));
bundle('electron/agent/router.ts', join(tmp, 'router.cjs'));
const p = require(join(tmp, 'providers.cjs'));
const r = require(join(tmp, 'router.cjs'));

// ---------- deterministic, real-shaped transport ----------
const REAL_FETCH = globalThis.fetch;
const ENV = ['SURNIA_RATE_LIMIT_MAX_ATTEMPTS', 'SURNIA_RATE_LIMIT_BUDGET_MS', 'SURNIA_SSE_IDLE_MS',
  'SURNIA_PROVIDER_RETRY_BUDGET_MS', 'SURNIA_PROVIDER_FAILOVER_BUDGET_MS'];
function clearEnv() { for (const k of ENV) delete process.env[k]; }
let calls = [];

/**
 * stepFor(parsedBody, index) -> { status, body?, sse?, headers?, throw?, stream? }
 * A missing status (or 200) returns a streaming Response with `sse`.
 */
function installFetch(stepFor) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const step = stepFor(body, calls.length) ?? {};
    calls.push({ url, body, headers: init.headers, model: body.model, at: Date.now(), status: step.status ?? 200 });
    if (step.throw) throw step.throw;
    if (step.stream) return new Response(new ReadableStream({ start() {} }), { status: 200 });
    if (step.status && step.status !== 200) {
      return new Response(step.body ?? 'provider error', { status: step.status, headers: step.headers ?? {} });
    }
    return new Response(step.sse ?? step.body ?? '', {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    });
  };
}
function restoreFetch() { globalThis.fetch = REAL_FETCH; }

// SSE builders — OpenAI-compatible and Anthropic wire shapes.
const oai = (delta, finish = null, extra = {}) =>
  `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
const oaiUsage = (usage) => `data: ${JSON.stringify({ id: 'c1', choices: [], usage })}\n\n`;
const DONE = 'data: [DONE]\n\n';
const sseAnswer = (text) => oai({ content: text }, 'stop') + DONE;
const anth = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const jsonish = /[{}]|"error"|\\"/;
const AR = /[\u0600-\u06FF]/;

const model = (id, provider = 'custom') => ({ provider, model: id, maxTokens: 256 });
function turnOpts(hooks = {}, provider = 'custom') {
  return {
    model: model('m', provider),
    baseUrl: provider === 'anthropic' ? 'http://mock.local' : 'http://mock.local/v1',
    system: 'system',
    messages: [{ role: 'user', text: 'hi' }],
    tools: [],
    signal: new AbortController().signal,
    onText: () => {}, onToolUse: () => {},
    ...hooks,
  };
}
const count = (id) => calls.filter((c) => c.model === id).length;
const kinds = (notices, k) => notices.filter((n) => n.kind === k);

// ===========================================================================
// PART A — HTTP status classification + retry/backoff contracts
// ===========================================================================

test('v1131 401: fatal on first request, clean single-language message', async () => {
  installFetch(() => ({ status: 401, body: '{"error":{"message":"bad key token sk-ant-abcdefghijklmnopqrstuvwx"}}' }));
  let err = null;
  try { await p.streamTurn(turnOpts()); } catch (e) { err = e; } finally { restoreFetch(); }
  assert.ok(err instanceof Error);
  assert.equal(p.providerErrorKindOf(err), 'invalid_key');
  assert.equal(calls.length, 1, '401 is fatal: ONE request');
  assert.match(err.message, /Invalid API key \(401\)/);
  assert.doesNotMatch(err.message, jsonish);
  assert.doesNotMatch(err.message, AR);
  assert.doesNotMatch(err.message, /sk-ant-/);
});

test('v1131 402: fatal on first request, vendor-neutral, JSON/secret-free', async () => {
  const raw = JSON.stringify({ error: { message: 'Insufficient credits, sk-proj-abcdefghijklmnopqrst add credits at https://vendor.example', code: 402 } });
  installFetch(() => ({ status: 402, body: raw }));
  const notices = [];
  let err = null;
  try { await p.streamTurn(turnOpts({ onNotice: (n) => notices.push(n) })); } catch (e) { err = e; } finally { restoreFetch(); }
  assert.ok(err instanceof Error);
  assert.equal(p.providerErrorKindOf(err), 'no_credits');
  assert.equal(calls.length, 1, '402 is fatal: ONE request');
  assert.match(err.message, /Insufficient credits \(402\)/);
  assert.match(err.message, /this provider account has no balance/);
  assert.doesNotMatch(err.message, jsonish);
  assert.doesNotMatch(err.message, /vendor\.example|sk-proj-/);
  assert.doesNotMatch(err.message, AR);
  assert.ok(notices.every((n) => !jsonish.test(n.text)));
});

test('v1131 403/404: sanitized body, no raw JSON, no secret', async () => {
  for (const status of [403, 404]) {
    installFetch(() => ({ status, body: JSON.stringify({ error: { message: `Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz denied; api_key=sk-proj-abcdefghijklmnop` } }) }));
    let err = null;
    try { await p.streamTurn(turnOpts()); } catch (e) { err = e; } finally { restoreFetch(); }
    assert.ok(err instanceof Error, `${status} throws`);
    assert.equal(err.status, status);
    assert.equal(calls.length, 1);
    assert.doesNotMatch(err.message, jsonish, `${status}: no raw JSON`);
    assert.doesNotMatch(err.message, /sk-ant-|sk-proj-|Bearer [A-Za-z0-9]/, `${status}: secrets redacted`);
    assert.doesNotMatch(err.message, AR);
  }
  assert.equal(p.providerErrorKindOf({ status: 403 }), 'forbidden');
  assert.equal(p.providerErrorKindOf({ status: 404 }), 'not_found');
});

test('v1131 400: cache_control rejection downgrades once, then success', async () => {
  p.resetCacheControlRejections(); p.resetSkippedTools();
  const seen = [];
  installFetch((body, i) => {
    seen.push(JSON.stringify(body));
    if (i === 0) return { status: 400, body: '{"error":"Unknown field cache_control"}' };
    return { sse: sseAnswer('OK-400') };
  });
  let text = '';
  try { await p.streamTurn(turnOpts({ onText: (t) => { text += t; } })); } finally { restoreFetch(); }
  assert.equal(calls.length, 2);
  assert.match(seen[0], /cache_control/);
  assert.doesNotMatch(seen[1], /cache_control/, 'cache marker stripped on retry');
  assert.equal(text, 'OK-400');
});

test('v1131 422: sequential cache_control + bad-tool rejections both recover (bounded multi-downgrade)', async () => {
  p.resetCacheControlRejections(); p.resetSkippedTools();
  const seen = [];
  const badTool = { detail: [{ type: 'literal_error', loc: ['body', 'tools', 0, 'function', 'type'] }] };
  installFetch((body, i) => {
    seen.push(JSON.parse(JSON.stringify(body)));
    if (i === 0) return { status: 422, body: JSON.stringify({ detail: [{ type: 'extra_forbidden', loc: ['body', 'messages', 0, 'cache_control'], msg: 'Extra inputs are not permitted' }] }) };
    if (i === 1) return { status: 422, body: JSON.stringify(badTool) };
    return { sse: sseAnswer('OK-422') };
  });
  const tools = [
    { name: 'bad_tool', description: 'x', parameters: { type: 'object' } },
    { name: 'good_tool', description: 'x', parameters: { type: 'object' } },
  ];
  let text = '';
  try { await p.streamTurn(turnOpts({ onText: (t) => { text += t; }, tools })); } finally { restoreFetch(); }
  assert.equal(calls.length, 3, 'two protocol downgrades then success');
  assert.match(JSON.stringify(seen[0]), /cache_control/);
  assert.doesNotMatch(JSON.stringify(seen[1]), /cache_control/, 'cache marker stripped first');
  assert.equal(seen[1].tools.length, 2);
  assert.equal(seen[2].tools.length, 1, 'exactly one bad tool dropped second');
  assert.equal(seen[2].tools[0].function.name, 'good_tool');
  assert.equal(text, 'OK-422');
});

test('v1131 429 (no failover): bounded in-place recovery, ONE quiet notice, no switch', async () => {
  clearEnv(); p.resetRateLimitNotices();
  const notices = [];
  let text = '';
  installFetch((_body, i) => i < 2
    ? { status: 429, body: '{"error":{"message":"raw gateway json"}}', headers: { 'retry-after': '999' } }
    : { sse: sseAnswer('RATE-RECOVERED') });
  const t0 = Date.now();
  try {
    const res = await p.streamTurn(turnOpts({ onText: (t) => { text += t; }, onNotice: (n) => notices.push(n) }));
    assert.equal(res.stopReason, 'end_turn');
  } finally { restoreFetch(); clearEnv(); }
  const elapsed = Date.now() - t0;
  assert.equal(calls.length, 3, 'two 429 backoffs then success on the SAME provider');
  assert.equal(text, 'RATE-RECOVERED');
  const rl = kinds(notices, 'rate_limited');
  assert.equal(rl.length, 1, 'exactly ONE quiet 429 notice');
  assert.match(rl[0].text, /continuing the same task/);
  assert.doesNotMatch(rl[0].text, /raw gateway json|failover/i);
  assert.ok(elapsed < 4000, `hostile Retry-After is capped (${elapsed}ms)`);
  const gaps = calls.slice(1).map((c, i) => c.at - calls[i].at);
  assert.ok(gaps.every((g) => g <= 1100), `each backoff <=1s (${gaps.join(',')})`);
});

test('v1131 429 bounded exhaustion: attempt cap stops the hammer, honest terminal', async () => {
  process.env.SURNIA_RATE_LIMIT_MAX_ATTEMPTS = '3';
  process.env.SURNIA_RATE_LIMIT_BUDGET_MS = '2000';
  installFetch(() => ({ status: 429, body: '{"error":{"message":"raw gateway json"}}' }));
  let err = null;
  try { await p.streamTurn(turnOpts()); } catch (e) { err = e; } finally { restoreFetch(); clearEnv(); }
  assert.equal(calls.length, 3, 'bounded to the configured attempt count');
  assert.equal(p.providerErrorKindOf(err), 'rate_limited');
  assert.match(err.message, /429|rate.?limit/i);
  assert.doesNotMatch(err.message, /raw gateway json|"error"/);
});

test('v1131 5xx: one bounded retry (incl gateway codes), 501 is NOT retried', async () => {
  for (const status of [500, 502, 503, 504, 507, 521, 522, 524, 529]) {
    installFetch(() => ({ status, body: '{"error":"boom"}' }));
    let err = null;
    try { await p.streamTurn(turnOpts()); } catch (e) { err = e; } finally { restoreFetch(); }
    assert.equal(calls.length, 2, `${status}: exactly one retry`);
    assert.equal(p.providerErrorKindOf(err), 'server_error');
    assert.doesNotMatch(err.message, jsonish);
  }
  installFetch(() => ({ status: 501, body: 'not implemented' }));
  try { await p.streamTurn(turnOpts()); } catch (e) { /* expected */ } finally { restoreFetch(); }
  assert.equal(calls.length, 1, '501 (Not Implemented) is not retried');
});

test('v1131 network timeout: honest cause, redacted, NO auto provider switch', async () => {
  const notices = [];
  const timeout = new Error('fetch failed');
  timeout.cause = new Error('connect ETIMEDOUT 10.0.0.1:443 ?api_key=sk-abcdefghijklmnop');
  installFetch(() => ({ throw: timeout }));
  let err = null;
  try {
    await p.streamTurn(turnOpts({ onNotice: (n) => notices.push(n), failover: [model('spare')] }));
  } catch (e) { err = e; } finally { restoreFetch(); }
  assert.ok(err instanceof Error);
  assert.equal(p.providerErrorKindOf(err), 'network');
  assert.match(err.message, /ETIMEDOUT/);
  assert.doesNotMatch(err.message, /sk-abcdefghijklmnop/);
  assert.equal(count('spare'), 0, 'slow provider must NOT switch');
  assert.ok(notices.some((n) => n.kind === 'slow_provider' && /not switching automatically/i.test(n.text)));
});

test('v1131 stalled SSE: watchdog surfaces a network error, no silent success, no switch', async () => {
  const prev = process.env.SURNIA_SSE_IDLE_MS;
  process.env.SURNIA_SSE_IDLE_MS = '500';
  installFetch(() => ({ stream: true }));
  const keepAlive = setTimeout(() => {}, 1200);
  let err = null;
  try {
    await p.streamTurn(turnOpts({ failover: [model('spare')] }));
  } catch (e) { err = e; } finally {
    clearTimeout(keepAlive);
    restoreFetch();
    if (prev === undefined) delete process.env.SURNIA_SSE_IDLE_MS; else process.env.SURNIA_SSE_IDLE_MS = prev;
  }
  assert.ok(err instanceof Error, 'a silent stream never ends as empty success');
  assert.equal(p.providerErrorKindOf(err), 'network');
  assert.match(err.message, /Stream stalled|Stream ended before completion/);
  assert.equal(count('spare'), 0);
});

// ===========================================================================
// PART B — stream parsing, tool calls, usage, dropped streams, malformed chunks
// ===========================================================================

test('v1131 Anthropic SSE: text, thinking+signature, tool JSON, cache usage, cost', async () => {
  const events = [
    anth({ type: 'message_start', message: { usage: { input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 } } }),
    anth({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu1', name: 'write_file' } }),
    anth({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":' } }),
    anth({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"a.txt"}' } }),
    anth({ type: 'content_block_start', index: 1, content_block: { type: 'thinking' } }),
    anth({ type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'reasoning ' } }),
    anth({ type: 'content_block_delta', index: 1, delta: { type: 'signature_delta', signature: 'sig123' } }),
    anth({ type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Hello Anthropic' } }),
    anth({ type: 'content_block_stop', index: 0 }),
    anth({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 42 } }),
    anth({ type: 'message_stop' }),
  ].join('');
  installFetch(() => ({ sse: events }));
  let text = '', thinking = '';
  const toolCalls = [];
  const usageSnaps = [];
  try {
    const res = await p.streamTurn(turnOpts({
      onText: (t) => { text += t; },
      onThinking: (t) => { thinking += t; },
      onToolUse: (id, name, args) => { toolCalls.push({ id, name, args }); },
      onUsage: (u) => { usageSnaps.push(u); },
    }, 'anthropic'));
    assert.equal(res.stopReason, 'tool_use');
    assert.equal(text, 'Hello Anthropic');
    assert.equal(thinking, 'reasoning ');
    assert.equal(res.thinking, 'reasoning ');
    assert.equal(res.thinkingSignature, 'sig123');
    const last = toolCalls[toolCalls.length - 1];
    assert.equal(last.id, 'tu1');
    assert.equal(last.name, 'write_file');
    assert.deepEqual(JSON.parse(last.args), { path: 'a.txt' }, 'complete tool JSON flushed');
    assert.ok(usageSnaps.length >= 2, 'early + final usage snapshots forwarded');
    assert.equal(res.usage.inputTokens, 160, 'input + cache read + cache creation');
    assert.equal(res.usage.outputTokens, 42);
    assert.equal(res.usage.cacheReadTokens, 50);
    assert.equal(res.usage.cacheCreationTokens, 10);
    assert.ok(res.usage.costUsd > 0, 'weighted cost computed');
    assert.equal(p.mapAnthropicStopReason('pause_turn'), 'paused');
    assert.equal(p.mapAnthropicStopReason('refusal'), 'refusal');
  } finally { restoreFetch(); }
});

test('v1131 OpenAI parallel tool-call streaming (indexed) keeps calls separate with complete args', async () => {
  const stream =
    oai({ tool_calls: [{ index: 0, id: 'c0', type: 'function', function: { name: 'alpha', arguments: '{"x":' } }] }) +
    oai({ tool_calls: [{ index: 1, id: 'c1', type: 'function', function: { name: 'beta', arguments: '{"y":2}' } }] }) +
    oai({ tool_calls: [{ index: 0, function: { arguments: '1}' } }] }) +
    oai({}, 'tool_calls') + DONE;
  installFetch(() => ({ sse: stream }));
  const callsSeen = [];
  try {
    await p.streamTurn(turnOpts({ onToolUse: (id, name, args) => callsSeen.push({ id, name, args }) }));
  } finally { restoreFetch(); }
  const final = new Map();
  for (const c of callsSeen) final.set(c.id, c);
  assert.deepEqual(JSON.parse(final.get('c0').args), { x: 1 });
  assert.deepEqual(JSON.parse(final.get('c1').args), { y: 2 });
  assert.equal(final.get('c0').name, 'alpha');
  assert.equal(final.get('c1').name, 'beta');
  assert.equal(p.mapOpenAIFinishReason('content_filter'), 'content_filter');
});

test('v1131 OpenAI index-less tool deltas: new id opens a fresh accumulator', async () => {
  const stream =
    oai({ tool_calls: [{ id: 'i0', type: 'function', function: { name: 'first', arguments: '{"a":1}' } }] }) +
    oai({ tool_calls: [{ id: 'i1', type: 'function', function: { name: 'second', arguments: '{"b":2}' } }] }) +
    oai({}, 'tool_calls') + DONE;
  installFetch(() => ({ sse: stream }));
  const seen = [];
  try { await p.streamTurn(turnOpts({ onToolUse: (id, name, args) => seen.push({ id, name, args }) })); }
  finally { restoreFetch(); }
  const final = new Map();
  for (const c of seen) final.set(c.id, c);
  assert.deepEqual(JSON.parse(final.get('i0').args), { a: 1 });
  assert.deepEqual(JSON.parse(final.get('i1').args), { b: 2 }, 'parallel calls not concatenated');
});

test('v1131 malformed SSE chunks: junk/JSON errors ignored, no fabricated text', async () => {
  const raw = [
    ': ping', 'event: message', 'id: 7', 'garbage line',
    'data: { this is not json',
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'VALID' }, finish_reason: 'stop' }] }),
    DONE.trim(),
  ].join('\n') + '\n';
  installFetch(() => ({ sse: raw }));
  let text = '';
  try { await p.streamTurn(turnOpts({ onText: (t) => { text += t; } })); } finally { restoreFetch(); }
  assert.equal(text, 'VALID');
  assert.doesNotMatch(text, jsonish);
});

test('v1131 mid-stream semantic error is sanitized, never mistaken for a drop', async () => {
  const raw = [
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'PARTIAL' } }] }),
    'data: ' + JSON.stringify({ error: { message: '{"secret":"sk-abcdefghijklmnopqrst"}' } }),
    DONE,
  ].join('');
  installFetch(() => ({ sse: raw }));
  let err = null;
  try { await p.streamTurn(turnOpts()); } catch (e) { err = e; } finally { restoreFetch(); }
  assert.ok(err instanceof Error, 'semantic error surfaces');
  assert.doesNotMatch(err.message, jsonish);
  assert.doesNotMatch(err.message, /secret|sk-abcdefghijklmnopqrst/);
  assert.equal(calls.length, 1, 'no transparent continuation for a semantic error');
});

test('v1131 dropped stream after text: transparent resume, no duplicated delta', async () => {
  const notices = [];
  let text = '';
  installFetch((body, i) => {
    if (i === 0) return { sse: oai({ content: 'PART ' }) }; // no finish/[DONE] => drop
    const roles = (body.messages ?? []).map((m) => m.role);
    assert.ok(roles.includes('assistant') && roles.includes('user'), 'resume prefix appended');
    const hint = body.messages.some((m) => /CONTINUE EXACTLY/.test(String(m.content ?? '')));
    assert.ok(hint, 'short continue instruction is the final user turn');
    return { sse: oai({ content: 'RESUMED' }, 'stop') + DONE };
  });
  try {
    await p.streamTurn(turnOpts({ onText: (t) => { text += t; }, onNotice: (n) => notices.push(n) }));
  } finally { restoreFetch(); }
  assert.equal(calls.length, 2, 'one transparent continuation');
  assert.equal(text, 'PART RESUMED', 'no replay of already-shown text');
  assert.ok(notices.some((n) => n.kind === 'stream_recovered'));
});

test('v1131 dropped stream with a tool in flight: NOT resumed from provider layer', async () => {
  const notices = [];
  installFetch(() => ({ sse: oai({ tool_calls: [{ index: 0, id: 't', function: { name: 'write_file', arguments: '{"p":' } }] }) }));
  let err = null;
  try { await p.streamTurn(turnOpts({ onNotice: (n) => notices.push(n) })); } catch (e) { err = e; } finally { restoreFetch(); }
  assert.ok(err instanceof Error);
  assert.equal(calls.length, 1, 'no re-send — a side-effecting tool could run twice');
  assert.ok(notices.some((n) => n.kind === 'stream_incomplete'));
});

test('v1131 usage accounting: provider cost trusted; fallback estimate when none', async () => {
  installFetch(() => ({ sse: oaiUsage({ prompt_tokens: 100, completion_tokens: 20, cost: 0.0123 }) + sseAnswer('x') }));
  let res;
  try { res = await p.streamTurn(turnOpts()); } finally { restoreFetch(); }
  assert.equal(res.usage.costUsd, 0.0123, 'OpenRouter server-side cost honored');
  assert.equal(res.usage.inputTokens, 100);
  assert.equal(res.usage.outputTokens, 20);

  installFetch(() => ({ sse: sseAnswer('four chars') }));
  let res2;
  try { res2 = await p.streamTurn(turnOpts()); } finally { restoreFetch(); }
  assert.ok(res2.usage.inputTokens > 0 && res2.usage.outputTokens > 0, 'chars/4 fallback estimate');
});

test('v1131 Ollama path: keyless request has no Authorization header or stream_options', async () => {
  installFetch(() => ({ sse: sseAnswer('LOCAL') }));
  let text = '';
  try {
    await p.streamTurn(turnOpts({ onText: (t) => { text += t; } }, 'ollama'));
  } finally { restoreFetch(); }
  assert.equal(text, 'LOCAL');
  assert.match(calls[0].url, /\/v1\/chat\/completions$/);
  assert.equal(calls[0].headers.authorization, undefined, 'no bearer header for keyless Ollama');
  const built = p.buildOpenAIRequestBody(turnOpts({}, 'ollama')).body;
  assert.equal(built.stream_options, undefined, 'include_usage stream_options is skipped for Ollama');
});

test('v1131 Anthropic 400: cache_control downgrade strips markers then succeeds', async () => {
  p.resetCacheControlRejections();
  const seen = [];
  installFetch((body, i) => {
    seen.push(JSON.stringify(body));
    if (i === 0) return { status: 400, body: '{"error":"cache_control not allowed"}' };
    return {
      sse: anth({ type: 'message_start', message: { usage: { input_tokens: 10 } } }) +
        anth({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ANTH-OK' } }) +
        anth({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }) +
        anth({ type: 'message_stop' }),
    };
  });
  let text = '';
  try { await p.streamTurn(turnOpts({ onText: (t) => { text += t; } }, 'anthropic')); }
  finally { restoreFetch(); }
  assert.equal(calls.length, 2);
  assert.match(seen[0], /cache_control/);
  assert.doesNotMatch(seen[1], /cache_control/, 'Anthropic cache markers stripped on retry');
  assert.equal(text, 'ANTH-OK');
});

// ===========================================================================
// PART C — secret redaction (pure + integration)
// ===========================================================================

test('v1131 sanitizeErrorText: JSON-free, single-language and secret-free', () => {
  const s = p.sanitizeErrorText('{"error":{"message":"Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234; api_key=sk-proj-abcdefghijklmnop; key=A1B2C3D4E5F6"}}');
  assert.ok(s.length > 0);
  assert.doesNotMatch(s, jsonish);
  assert.doesNotMatch(s, /sk-ant-|sk-proj-|Bearer [A-Za-z0-9]/);
  assert.equal(p.sanitizeErrorText(''),
    '');
  assert.equal(p.sanitizeErrorText('{"error":{}'), '', 'malformed JSON never shown');
  assert.doesNotMatch(p.sanitizeErrorText('كلمة عربية sk-abcdefghijklmnopqrst'), AR, 'ASCII clamp keeps single language');
});

// ===========================================================================
// PART D — router gate / failover default OFF / family profiles
// ===========================================================================

test('v1131 router: failover is opt-in and OFF by default (fresh read, getter)', () => {
  assert.equal(r.isFailoverEnabled(), false);
  assert.equal(r.isFailoverEnabled({}), false);
  assert.equal(r.isFailoverEnabled({ agent: { allowModelFailover: 'true' } }), false, 'truthy string is NOT opt-in');
  assert.equal(r.isFailoverEnabled({ agent: { allowModelFailover: false } }), false, 'explicit false stays off');
  assert.equal(r.isFailoverEnabled({ agent: { allowModelFailover: true } }), true);
  assert.equal(r.isFailoverEnabled(() => ({ agent: { allowModelFailover: true } })), true, 'live getter honored');
});

test('v1131 router: failoverChain is length 1 unless multi-provider AND opt-in', () => {
  const own = model('mine', 'custom');
  const one = { providers: { custom: { apiKey: 'k' } }, agent: {} };
  assert.equal(r.failoverChain(one, own).length, 1);

  const multi = {
    providers: {
      custom: { apiKey: 'k', lastModels: ['mine'] },
      openai: { apiKey: 'k', lastModels: ['gpt-x'] },
      anthropic: { apiKey: 'k', lastModels: ['claude-x'] },
    },
    agent: {},
  };
  assert.equal(r.failoverChain(multi, own).length, 1, 'no opt-in => no alternates');
  multi.agent.allowModelFailover = true;
  const chain = r.failoverChain(multi, own);
  assert.ok(chain.length > 1, 'opt-in => alternates appear');
  assert.deepEqual(chain[0], { provider: 'custom', model: 'mine' }, 'user model is always entry #0');
  const keys = new Set(chain.map((x) => `${x.provider}|${x.model}`));
  assert.equal(keys.size, chain.length, 'no duplicate alternates');
});

test('v1131 router: verifier degrades to own model without opt-in; explicit role honored', () => {
  const worker = model('mine', 'custom');
  const multi = {
    providers: { custom: { apiKey: 'k' }, openai: { apiKey: 'k', lastModels: ['gpt-x'] } },
    agent: { allowModelFailover: false },
  };
  assert.equal(r.pickVerifier(multi, worker).model.model, 'mine', 'no silent verifier switch');
  multi.agent.modelRoles = { verify: { provider: 'openai', model: 'gpt-x' } };
  assert.equal(r.pickVerifier(multi, worker).model.model, 'gpt-x', 'explicit verify role is honored');
});

test('v1131 router: configuredProviders ignores blank keys; familyOf/creds sane', () => {
  const settings = { providers: { custom: { apiKey: '   ' }, openai: { apiKey: 'k' }, anthropic: { apiKey: '' } } };
  assert.deepEqual(r.configuredProviders(settings), ['openai']);
  assert.equal(r.familyOf('anthropic', 'claude-sonnet'), 'claude');
  assert.equal(r.familyOf('openai', 'gpt-6.1-sol'), 'gpt');
  assert.equal(r.familyOf('ollama', 'llama3'), 'local');
  assert.equal(r.refCreds(settings, { provider: 'custom', model: 'x' }).apiKey, undefined, 'blank key not a credential');
});

after(() => {
  restoreFetch();
  clearEnv();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});
