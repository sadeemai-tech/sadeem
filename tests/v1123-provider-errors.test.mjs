// v11.23 — PROVIDER ERRORS END-TO-END REGRESSION
//
// The founder repeatedly reports "402 Insufficient credits", "الذكاء لا يعمل"
// and random provider errors. This suite boots the REAL providers.ts against
// REAL-SHAPED HTTP responses (raw gateway JSON bodies, hostile Retry-After,
// undici-style fetch timeouts, stalled SSE, malformed SSE) and asserts the
// honest, single-language, JSON-free contract:
//   • 401 → fatal, one clear English message, ZERO retries;
//   • 402 → provider-agnostic, no raw JSON / no EN+AR mix / no vendor name;
//   • 429 → one short bounded backoff + ONE consolidated notice, never noisy;
//   • 5xx → exactly one retry inside a wall-clock budget (incl. 504/521/...);
//   • timeout/stall → surfaced honestly, NEVER an auto provider switch;
//   • malformed SSE → never leaks a raw payload, never fabricates text;
//   • postJsonWithRetry stays the ONLY retry layer (no double-retry loop).
//
// Run:
//   node --test --test-force-exit tests/v1123-provider-errors.test.mjs
// ============================================================
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1123-provider-errors-'));
const mod = join(tmp, 'providers.cjs');
execFileSync(ESBUILD_NODE, [ESBUILD_BIN, join(ROOT, 'electron/agent/providers.ts'),
  '--bundle', '--platform=node', '--format=cjs', '--outfile=' + mod,
  '--external:electron', '--log-level=error'], { cwd: ROOT, timeout: 120000 });
const p = require(mod);

// ---------- deterministic, real-shaped transport ----------
const REAL_FETCH = globalThis.fetch;
let calls = [];
const sse = (text) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\n` +
  'data: [DONE]\n\n';

/** script[model] is a queue of steps; an empty queue returns 200 with `done`. */
function installFetch(script, done = 'ANSWER') {
  calls = [];
  const queue = Object.fromEntries(
    Object.entries(script).map(([model, steps]) => [model, [...steps]]),
  );
  globalThis.fetch = async (_url, init) => {
    const model = JSON.parse(init.body).model;
    const step = (queue[model] ?? []).shift() ?? { status: 200, body: sse(done) };
    calls.push({ model, status: step.status ?? 200, at: Date.now() });
    if (step.throw) throw step.throw;
    if (step.stream) {
      // A connection that stays open but never emits a byte → SSE idle watchdog.
      return new Response(new ReadableStream({ start() { /* intentionally silent */ } }), { status: 200 });
    }
    if (step.status && step.status !== 200) {
      return new Response(step.body ?? step.text ?? 'provider error', {
        status: step.status,
        headers: step.headers ?? {},
      });
    }
    return new Response(step.body ?? sse(step.text ?? done), {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    });
  };
  return calls;
}
function restoreFetch() { globalThis.fetch = REAL_FETCH; }

const model = (id) => ({ provider: 'custom', model: id, maxTokens: 64 });
const turnOpts = (primary, failover = [], hooks = {}) => ({
  model: model(primary),
  baseUrl: 'http://mock.local/v1',
  failover,
  system: 'system',
  messages: [{ role: 'user', text: 'hi' }],
  tools: [],
  signal: new AbortController().signal,
  onText: () => {},
  onToolUse: () => {},
  ...hooks,
});
const countFor = (id) => calls.filter((c) => c.model === id).length;
const AR = /[\u0600-\u06FF]/;                       // any Arabic glyph
const JSONISH = /[{}]|"error"|\\"/;                  // raw JSON / escaped payload
const VENDOR = /openrouter|anthropic|openai|gemini|deepseek|moonshot|qwen|mistral|xai|z\.ai/i;

// The founder's exact 402 wire payload (OpenRouter-shaped).
const RAW_402 = JSON.stringify({ error: {
  message: 'Insufficient credits. This account never purchased credits. Make sure your key is on the correct account or org, and if so, purchase more at https://openrouter.ai/settings/credits',
  code: 402,
  metadata: { limit_source: 'openrouter_credits', remedy_hint: 'Add credits at https://openrouter.ai/settings/credits' },
} });

// ============================================================
// 1. 401 — fatal, clear, single-language, zero retries
// ============================================================

test('v1123: 401 throws one clear English message, no raw JSON, no retry', async () => {
  const notices = [];
  installFetch({ bad: [{ status: 401, body: '{"error":{"message":"invalid api key","code":401}}' }] });
  let err = null;
  try {
    await p.streamTurn(turnOpts('bad', [], { onNotice: (n) => notices.push(n) }));
  } catch (e) { err = e; } finally { restoreFetch(); }

  assert.ok(err instanceof Error, '401 must throw');
  assert.equal(p.providerErrorKindOf(err), 'invalid_key');
  assert.equal(err.status, 401);
  assert.match(err.message, /Invalid API key \(401\)/);
  assert.match(err.message, /Settings/);
  assert.doesNotMatch(err.message, JSONISH, 'no raw JSON in the message');
  assert.doesNotMatch(err.message, AR, 'single language — no Arabic mixed in');
  assert.equal(countFor('bad'), 1, '401 is fatal: ZERO retries');
});

test('v1123: 401 skips immediately in a failover chain (one skip + one switch notice)', async () => {
  p.resetRateLimitNotices();
  const notices = [];
  let text = '';
  installFetch({
    bad: [{ status: 401, body: '{"error":{"message":"invalid api key"}}' }],
    good: [{ status: 200, text: 'RECOVERED' }],
  });
  try {
    const r = await p.streamTurn(turnOpts('bad', [model('good')], {
      onNotice: (n) => notices.push(n), onText: (t) => { text += t; },
    }));
    assert.equal(r.stopReason, 'end_turn');
  } finally { restoreFetch(); }
  assert.equal(text, 'RECOVERED');
  assert.equal(countFor('bad'), 1, 'no same-provider retry on 401');
  assert.equal(countFor('good'), 1);
  assert.ok(notices.some((n) => n.kind === 'provider_skip' && /Invalid API key/i.test(n.text)));
  assert.equal(notices.filter((n) => n.kind === 'failover').length, 1, 'exactly one switch notice');
  assert.ok(notices.every((n) => !JSONISH.test(n.text)), 'no raw JSON in any notice');
});

// ============================================================
// 2. 402 — provider-agnostic, honest, no raw JSON / EN+AR / vendor name
// ============================================================

test('v1123: 402 with the founder\'s raw payload becomes one clean vendor-neutral message', async () => {
  const notices = [];
  installFetch({ empty: [{ status: 402, body: RAW_402 }] });
  let err = null;
  try {
    await p.streamTurn(turnOpts('empty', [], { onNotice: (n) => notices.push(n) }));
  } catch (e) { err = e; } finally { restoreFetch(); }

  assert.ok(err instanceof Error, '402 must throw');
  assert.equal(p.providerErrorKindOf(err), 'no_credits', 'correct kind for engine/store');
  assert.equal(err.status, 402);
  assert.equal(err.kind, 'no_credits');
  assert.match(err.message, /Insufficient credits \(402\)/);
  assert.match(err.message, /this provider account has no balance/);
  assert.doesNotMatch(err.message, JSONISH, 'raw gateway JSON never reaches the UI');
  assert.doesNotMatch(err.message, /never purchased credits|openrouter\.ai|limit_source|remedy_hint/i,
    'no body excerpt, no remedy URL from the gateway');
  assert.doesNotMatch(err.message, AR, 'single language — renderer translates');
  assert.doesNotMatch(err.message, VENDOR, 'no hardcoded provider name');
  assert.equal(countFor('empty'), 1, '402 is fatal: ZERO retries');
  assert.ok(notices.every((n) => !JSONISH.test(n.text)), 'no raw JSON in notices either');
});

test('v1123: 402 plain-Error classification stays no_credits (engine/store contract)', () => {
  assert.equal(p.providerErrorKindOf({ status: 402, message: RAW_402 }), 'no_credits');
  assert.equal(p.providerErrorKindOf(new Error('Provider error 402: ' + RAW_402)), 'no_credits');
  assert.equal(p.shouldSkipProvider({ status: 402, message: RAW_402 }), true);
  assert.equal(p.isInvalidKeyError({ status: 402, message: RAW_402 }), false);
});

// ============================================================
// 3. 429 — bounded backoff, ONE consolidated notice, never noisy
// ============================================================

test('v1123: 429 is bounded (<=1s), retried once, and emits exactly one quiet notice', async () => {
  p.resetRateLimitNotices();
  const notices = [];
  let text = '';
  installFetch({
    hot: [
      { status: 429, body: '{"error":{"message":"slow down","code":429}}', headers: { 'retry-after': '999' } },
      { status: 429, body: '{"error":{"message":"slow down","code":429}}', headers: { 'retry-after': '999' } },
    ],
    healthy: [{ status: 200, text: 'SERVED' }],
  });
  const t0 = Date.now();
  try {
    await p.streamTurn(turnOpts('hot', [model('healthy')], {
      onNotice: (n) => notices.push(n), onText: (t) => { text += t; },
    }));
  } finally { restoreFetch(); }
  const elapsed = Date.now() - t0;

  assert.equal(countFor('hot'), 2, 'exactly ONE same-provider backoff retry');
  assert.equal(countFor('healthy'), 1, 'then move on to the next model');
  assert.ok(elapsed < 1500, `Retry-After capped at <=1s (got ${elapsed}ms)`);
  assert.equal(text, 'SERVED');
  const rl = notices.filter((n) => n.kind === 'rate_limited');
  assert.equal(rl.length, 1, `ONE consolidated notice, never spam: ${JSON.stringify(notices)}`);
  assert.match(rl[0].text, /rate-limited — trying the next configured model/);
  assert.match(rl[0].text, /\(\d+\/\d+ tried\)/, 'honest counter');
  assert.ok(notices.every((n) => !/\bfailover\b/i.test(n.text)), 'no "failover" wording');
  assert.ok(notices.every((n) => !JSONISH.test(n.text)), 'no raw JSON in notices');
  assert.equal(notices.filter((n) => n.kind === 'error').length, 0, 'no error row on a recovered 429');
});

test('v1123: all-providers-429 is ONE clean message with Retry-After, no raw payload', async () => {
  p.resetRateLimitNotices();
  const r429 = () => [
    { status: 429, body: '{"error":{"message":"raw gateway json","code":429}}', headers: { 'retry-after': '30' } },
    { status: 429, body: '{"error":{"message":"raw gateway json","code":429}}', headers: { 'retry-after': '30' } },
  ];
  installFetch({ a: r429(), b: r429() });
  let err = null;
  try {
    await p.streamTurn(turnOpts('a', [model('b')], { onNotice: () => {} }));
  } catch (e) { err = e; } finally { restoreFetch(); }

  assert.ok(err instanceof Error);
  assert.match(err.message, /All 2 configured providers are rate-limited \(429\)/);
  assert.match(err.message, /retry after about 30 seconds/);
  assert.doesNotMatch(err.message, JSONISH, 'no raw JSON');
  assert.doesNotMatch(err.message, /raw gateway json/, 'no gateway body excerpt');
  assert.doesNotMatch(err.message, AR, 'single language base');
});

// ============================================================
// 4. 5xx — one retry inside the shared budget (incl. gateway 5xx)
// ============================================================

test('v1123: a 500 with raw JSON body is retried exactly once, then succeeds', async () => {
  const notices = [];
  let text = '';
  installFetch({
    flaky: [
      { status: 500, body: '{"error":{"message":"internal boom","code":500}}' },
      { status: 200, text: 'OK-NOW' },
    ],
  });
  try {
    const r = await p.streamTurn(turnOpts('flaky', [], {
      onNotice: (n) => notices.push(n), onText: (t) => { text += t; },
    }));
    assert.equal(r.stopReason, 'end_turn');
  } finally { restoreFetch(); }
  assert.equal(countFor('flaky'), 2, 'one retry only');
  assert.equal(text, 'OK-NOW');
  assert.ok(notices.some((n) => n.kind === 'server_error'));
  assert.ok(notices.every((n) => !JSONISH.test(n.text)), 'retry notice carries no raw JSON');
});

test('v1123: gateway 5xx (504) is retried once and a persistent 5xx stays bounded', async () => {
  installFetch({ gw: [{ status: 504, body: 'gateway timeout' }, { status: 200, text: 'RECOVERED' }] });
  try {
    const r = await p.streamTurn(turnOpts('gw', [], { onText: () => {} }));
    assert.equal(r.stopReason, 'end_turn');
  } finally { restoreFetch(); }
  assert.equal(countFor('gw'), 2, '504 gets the same bounded single retry');

  installFetch({ dead: [{ status: 500, body: '{"error":"boom"}' }, { status: 500, body: '{"error":"boom"}' }] });
  let err = null;
  try {
    await p.streamTurn(turnOpts('dead', [], { onText: () => {} }));
  } catch (e) { err = e; } finally { restoreFetch(); }
  assert.equal(countFor('dead'), 2, 'no infinite/second retry loop');
  assert.equal(p.providerErrorKindOf(err), 'server_error');
  assert.doesNotMatch(err.message, JSONISH, 'no raw JSON even on persistent 5xx');
});

// ============================================================
// 5. Timeout / stall — honest cause, NEVER an automatic provider switch
// ============================================================

test('v1123: a fetch timeout is reported honestly and never switches provider', async () => {
  const notices = [];
  const timeout = new Error('fetch failed');
  timeout.cause = new Error('connect ETIMEDOUT 10.0.0.1:443');
  installFetch({
    slow: [{ throw: timeout }],
    healthy: [{ status: 200, text: 'SHOULD-NOT-BE-USED' }],
  });
  let err = null;
  let text = '';
  try {
    await p.streamTurn(turnOpts('slow', [model('healthy')], {
      onNotice: (n) => notices.push(n), onText: (t) => { text += t; },
    }));
  } catch (e) { err = e; } finally { restoreFetch(); }

  assert.ok(err instanceof Error, 'slow provider surfaces an error');
  assert.equal(p.providerErrorKindOf(err), 'network');
  assert.match(err.message, /ETIMEDOUT/, 'real cause captured honestly');
  assert.doesNotMatch(err.message, JSONISH);
  assert.doesNotMatch(err.message, AR);
  assert.equal(countFor('healthy'), 0, 'NO auto-provider-switch on slowness');
  assert.equal(countFor('slow'), 1, 'no pointless same-provider retry in a failover chain');
  assert.equal(text, '');
  assert.ok(notices.some((n) => n.kind === 'slow_provider' && /not switching automatically/i.test(n.text)));
});

test('v1123: a stalled SSE stream surfaces a stall error, not a silent "complete" answer', { timeout: 8000 }, async () => {
  const prev = process.env.SURNIA_SSE_IDLE_MS;
  process.env.SURNIA_SSE_IDLE_MS = '500'; // floor 500ms — keeps this test fast
  p.resetRateLimitNotices();
  const notices = [];
  installFetch({
    silent: [{ stream: true }],
    healthy: [{ status: 200, text: 'SHOULD-NOT-BE-USED' }],
  });
  // The production SSE watchdog is intentionally unref'd (a real fetch socket
  // keeps the app alive). This mock stream has NO socket, so keep the test's
  // own event loop alive until the watchdog fires.
  const keepAlive = setTimeout(() => {}, 1500);
  let err = null;
  try {
    await p.streamTurn(turnOpts('silent', [model('healthy')], { onNotice: (n) => notices.push(n) }));
  } catch (e) { err = e; } finally {
    clearTimeout(keepAlive);
    restoreFetch();
    if (prev === undefined) delete process.env.SURNIA_SSE_IDLE_MS;
    else process.env.SURNIA_SSE_IDLE_MS = prev;
  }
  assert.ok(err instanceof Error, 'a silent stream must not end as an empty success');
  assert.equal(p.providerErrorKindOf(err), 'network', 'stall classifies as retryable network');
  assert.match(err.message, /Stream stalled/);
  assert.equal(countFor('healthy'), 0, 'no auto-switch on a slow/stalled provider');
  assert.ok(notices.some((n) => n.kind === 'slow_provider'));
});

// ============================================================
// 6. Malformed SSE — no raw payload leaks, no fabricated content
// ============================================================

test('v1123: malformed / junk SSE lines are ignored; only valid deltas become text', async () => {
  const raw = [
    ': ping',
    'not-json-at-all',
    'data: { this is not json',
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] }),
    'data: ' + JSON.stringify({ error: { message: '{"secret":"leak"}' } }), // mid-stream error
    'data: [DONE]',
  ].join('\n') + '\n';
  installFetch({ noisy: [{ status: 200, body: raw }] });
  let err = null;
  try {
    await p.streamTurn(turnOpts('noisy', [], { onText: () => {} }));
  } catch (e) { err = e; } finally { restoreFetch(); }
  // The mid-stream error event is honored, but its JSON payload is sanitized.
  assert.ok(err instanceof Error, 'mid-stream error event must surface');
  assert.ok(err.message.length > 0);
  assert.doesNotMatch(err.message, JSONISH, 'no raw JSON from the error event');
  assert.doesNotMatch(err.message, /secret|leak/, 'no payload fields leak');
});

test('v1123: a clean malformed stream (no error event) yields only the valid delta', async () => {
  const raw = [
    ': keep-alive',
    'garbage line',
    'data: {bad json',
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'CLEAN' }, finish_reason: 'stop' }] }),
    'data: [DONE]',
  ].join('\n') + '\n';
  let text = '';
  installFetch({ clean: [{ status: 200, body: raw }] });
  let threw = null;
  try {
    await p.streamTurn(turnOpts('clean', [], { onText: (t) => { text += t; } }));
  } catch (e) { threw = e; } finally { restoreFetch(); }
  assert.equal(threw, null);
  assert.equal(text, 'CLEAN', 'valid delta survives; junk is ignored');
  assert.doesNotMatch(text, JSONISH, 'no raw JSON fabricated into answer text');
});

// ============================================================
// 7. No double-retry loop: postJsonWithRetry is the ONLY retry layer
// ============================================================

test('v1123: a 401 -> 429 -> success chain makes exactly 1 + 2 + 1 requests', async () => {
  p.resetRateLimitNotices();
  installFetch({
    bad: [{ status: 401, body: '{"error":{"message":"bad key"}}' }],
    hot: [
      { status: 429, body: '{"error":{"message":"limit"}}' },
      { status: 429, body: '{"error":{"message":"limit"}}' },
    ],
    good: [{ status: 200, text: 'FINAL' }],
  });
  let text = '';
  try {
    await p.streamTurn(turnOpts('bad', [model('hot'), model('good')], { onText: (t) => { text += t; } }));
  } finally { restoreFetch(); }
  assert.equal(countFor('bad'), 1, 'no outer retry on 401');
  assert.equal(countFor('hot'), 2, 'exactly one in-provider 429 backoff — no double loop');
  assert.equal(countFor('good'), 1);
  assert.equal(text, 'FINAL');
});

test('v1123: source keeps the single retry layer and single-language messages', () => {
  const src = readFileSync(join(ROOT, 'electron/agent/providers.ts'), 'utf8');
  assert.match(src, /maxRetries: 0/, 'failover hands retries to postJsonWithRetry only');
  assert.match(src, /status === 402/, '402 branch intact');
  assert.match(src, /this provider account has no balance/, 'vendor-neutral 402 message');
  assert.match(src, /sanitizeErrorText/, 'JSON-leak guard present');
  assert.match(src, /RETRYABLE_STATUS = new Set\(\[500, 502, 503, 504/, 'gateway 5xx retryable');
  assert.doesNotMatch(src, /RATE_LIMIT_BACKOFF_CAP_MS = (?!1000)/, '429 backoff still capped at 1s');
});

after(() => {
  restoreFetch();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});
