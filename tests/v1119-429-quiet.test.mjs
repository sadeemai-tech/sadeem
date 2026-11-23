// v11.19 — QUIET 429 REGRESSION
//
// Founder complaints:
//   (a) "أحيانا بعطيني خطأ 429" — sometimes a raw 429 error is shown.
//   (b) "دائما بعطيهم فيل اوفر فيل اوفر" — endless "failover" notices.
//   (c) "بصير يبدل المزودين لحاله" — it switches providers by itself.
//
// Contract under test (providers.ts only):
//   • on 429: ONE short (≤1s) backoff, retry the SAME provider once; only a
//     SECOND 429 moves to the next provider;
//   • at most ONE consolidated rate-limit notice for the whole chain, deduped
//     per endpoint so repeated 429s never spam sys_notice;
//   • a 429 never produces an error row when a failover succeeds (the answer
//     is shown, with a quiet notice only);
//   • if ALL providers 429, ONE clear bilingual-aware (English base, renderer
//     translates) message with a Retry-After hint — not N raw errors;
//   • 402 / no_credits / 401 / 422 logic is untouched.
//
// Run:
//   node --test --test-force-exit tests/v1119-429-quiet.test.mjs
// ============================================================
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
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-429-quiet-'));
const mod = join(tmp, 'providers.cjs');
execFileSync(ESBUILD_NODE, [ESBUILD_BIN, join(ROOT, 'electron/agent/providers.ts'),
  '--bundle', '--platform=node', '--format=cjs', '--outfile=' + mod,
  '--external:electron', '--log-level=error'], { cwd: ROOT, timeout: 120000 });
const p = require(mod);

// ---------- deterministic fetch ----------
const REAL_FETCH = globalThis.fetch;
let calls = [];
const sseBody = (text) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\n` +
  'data: [DONE]\n\n';

/** script[model] is a queue of steps; an empty queue returns 200 with `done`. */
function installFetch(script, done = 'ANSWER') {
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
      return new Response(step.text ?? 'error', {
        status: step.status,
        headers: step.headers ?? {},
      });
    }
    return new Response(sseBody(step.text ?? done), {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    });
  };
  return calls;
}
function restoreFetch() { globalThis.fetch = REAL_FETCH; }

const model = (id) => ({ provider: 'custom', model: id, maxTokens: 64 });
const turnOpts = (primary, failover, hooks = {}) => ({
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
const rateNotices = (notices) => notices.filter((n) => n.kind === 'rate_limited');

// ============================================================
// 1. REPEATED 429 → ONE consolidated notice (dedup), no spam
// ============================================================

test('v1119: repeated 429 from the same endpoint emits exactly ONE consolidated notice', async () => {
  p.resetRateLimitNotices();
  const notices = [];
  installFetch({
    hot: [
      { status: 429, text: '{"error":"rate limit"}', headers: { 'retry-after': '30' } },
      { status: 429, text: '{"error":"rate limit"}', headers: { 'retry-after': '30' } },
    ],
    healthy: [{ status: 200, text: 'SERVED' }],
  });
  try {
    await p.streamTurn(turnOpts('hot', [model('healthy')], {
      onNotice: (n) => notices.push(n),
      onText: () => {},
    }));
  } finally {
    restoreFetch();
  }

  // Two 429 attempts on `hot` (one backoff retry) — yet only ONE notice.
  assert.equal(countFor('hot'), 2, 'one short retry of the SAME provider, not a hammer loop');
  const rl = rateNotices(notices);
  assert.equal(rl.length, 1, `exactly one consolidated rate-limit notice: ${JSON.stringify(notices)}`);
  assert.match(rl[0].text, /rate-limited — trying the next configured model/);
  assert.match(rl[0].text, /\(1\/2 tried\)/, 'notice carries an honest counter');
  // No "failover" wording anywhere in the notice text.
  assert.ok(
    notices.every((n) => !/\bfailover\b/i.test(n.text)),
    `no "failover" spam in notice text: ${JSON.stringify(notices)}`,
  );
});

test('v1119: the per-endpoint dedup key suppresses a second 429 episode from the same endpoint', async () => {
  p.resetRateLimitNotices();
  const notices = [];
  const run = async () => {
    installFetch({
      hot: [
        { status: 429, text: 'limit', headers: { 'retry-after': '30' } },
        { status: 429, text: 'limit' },
      ],
      healthy: [{ status: 200, text: 'OK' }],
    });
    try {
      await p.streamTurn(turnOpts('hot', [model('healthy')], { onNotice: (n) => notices.push(n) }));
    } finally {
      restoreFetch();
    }
  };
  await run();
  await run(); // same endpoint, immediately again — must NOT re-notify.
  assert.equal(rateNotices(notices).length, 1,
    `same endpoint 429 twice across two turns still emits one notice: ${JSON.stringify(notices)}`);
});

// ============================================================
// 2. SUCCESSFUL FAILOVER → answer only, NO error row
// ============================================================

test('v1119: a 429 that fails over successfully shows the answer with no error row', async () => {
  p.resetRateLimitNotices();
  const notices = [];
  const errorRows = []; // stands in for the renderer's error bubble
  let text = '';
  let threw = null;
  installFetch({
    throttled: [
      { status: 429, text: 'limit', headers: { 'retry-after': '30' } },
      { status: 429, text: 'limit' },
    ],
    good: [{ status: 200, text: 'THE ANSWER' }],
  });
  try {
    const result = await p.streamTurn(turnOpts('throttled', [model('good')], {
      onNotice: (n) => {
        notices.push(n);
        if (n.kind === 'error' || /error/i.test(n.kind)) errorRows.push(n);
      },
      onText: (t) => { text += t; },
    }));
    assert.equal(result.stopReason, 'end_turn');
  } catch (err) {
    threw = err;
  } finally {
    restoreFetch();
  }
  assert.equal(threw, null, `failover to a healthy provider must not throw: ${threw}`);
  assert.equal(text, 'THE ANSWER', 'the user sees the answer, not an error');
  assert.equal(errorRows.length, 0, 'no user-visible ERROR row on a successful failover');
  assert.equal(rateNotices(notices).length, 1, 'only the quiet consolidated notice remains');
});

// ============================================================
// 3. ALL PROVIDERS 429 → ONE clear message with Retry-After hint
// ============================================================

test('v1119: all providers 429 surfaces ONE clean message with a Retry-After hint, not N raw errors', async () => {
  p.resetRateLimitNotices();
  const notices = [];
  const r429 = () => [
    { status: 429, text: '{"error":{"message":"raw gateway json"}}', headers: { 'retry-after': '30' } },
    { status: 429, text: '{"error":{"message":"raw gateway json"}}', headers: { 'retry-after': '30' } },
  ];
  installFetch({ a: r429(), b: r429(), c: r429() });
  let threw = null;
  try {
    await p.streamTurn(turnOpts('a', [model('b'), model('c')], { onNotice: (n) => notices.push(n) }));
  } catch (err) {
    threw = err;
  } finally {
    restoreFetch();
  }

  assert.ok(threw instanceof Error, 'all-429 chain must throw a single clean error');
  const msg = threw.message;
  assert.match(msg, /All 3 configured providers are rate-limited \(429\)/);
  assert.match(msg, /retry after about 30 seconds/, 'Retry-After hint is surfaced');
  assert.doesNotMatch(msg, /raw gateway json|\{.*error.*\}/, 'no raw provider JSON leaks to the user');
  assert.doesNotMatch(msg, /\b[À-ۿ]/, 'English base only — renderer translates (no mixed EN+AR)');
  assert.equal(rateNotices(notices).length, 1, 'one consolidated notice even when all providers 429');
});

// ============================================================
// 4. BOUNDED: ≤1s backoff, one retry, then the next provider
// ============================================================

test('v1119: a hostile Retry-After is capped at ≤1s and the chain stays bounded', async () => {
  p.resetRateLimitNotices();
  installFetch({
    hot: [
      { status: 429, text: 'slow down', headers: { 'retry-after': '999' } },
      { status: 429, text: 'slow down' },
    ],
    good: [{ status: 200, text: 'OK' }],
  });
  const t0 = Date.now();
  try {
    await p.streamTurn(turnOpts('hot', [model('good')], { onText: () => {} }));
  } finally {
    restoreFetch();
  }
  const elapsed = Date.now() - t0;
  assert.equal(countFor('hot'), 2, 'exactly one in-provider retry');
  assert.equal(countFor('good'), 1, 'moved to the next provider after the second 429');
  assert.ok(elapsed < 1500, `backoff is hard-capped at ≤1s (got ${elapsed}ms)`);
});

// ============================================================
// 5. GUARDRAILS: 402 / 401 / 422 logic untouched
// ============================================================

test('v1119: 402 and 401 classifications remain intact', () => {
  assert.equal(p.providerErrorKindOf({ status: 402, message: 'no credits' }), 'no_credits');
  assert.equal(p.providerErrorKindOf({ status: 401, message: 'bad key' }), 'invalid_key');
  assert.equal(p.providerErrorKindOf({ status: 429, message: 'rate limit' }), 'rate_limited');
  // 422 is handled as a 400-style feature downgrade in postJsonWithRetry,
  // never as a 429/rate-limit (so it must not enter the quiet-429 path).
  assert.notEqual(p.providerErrorKindOf({ status: 422, message: 'validation' }), 'rate_limited');
});

test('v1119: source keeps the 402 / 422 guards and the ≤1s 429 cap', () => {
  const src = require('node:fs').readFileSync(join(ROOT, 'electron/agent/providers.ts'), 'utf8');
  assert.match(src, /status === 402/, '402 branch intact');
  assert.match(src, /res\.status === 400 \|\| res\.status === 422/, '422 downgrade intact');
  assert.match(src, /RATE_LIMIT_BACKOFF_CAP_MS = 1000/, '429 backoff hard-capped at 1s');
  assert.match(src, /resetRateLimitNotices/, 'dedup reset surface exported for tests');
});

after(() => {
  restoreFetch();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});
