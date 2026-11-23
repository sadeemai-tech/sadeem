// v11.26 — PROVIDER CONTINUITY / STREAM-RESILIENCE REGRESSION
//
// Founder directive: "الذكاء الاصطناعي لا ينقطع أبداً... تحل مشكلة الانقطاع
// والتأخر نهائيا" — the AI must NEVER silently stop. This suite boots the REAL
// providers.ts against scripted, real-shaped SSE transports and asserts:
//   • a stream that dies mid-answer is RESUMED transparently (same task, no
//     re-ask of the whole prompt, no replay of already-streamed deltas);
//   • a missing [DONE]/finish_reason/message_stop is NEVER a blank 'end_turn';
//   • if recovery is impossible, a PRECISE classified terminal error surfaces
//     with a visible notice — never a silent stop;
//   • retries are BOUNDED (one transparent continuation), no infinite loop;
//   • 402 fatal in ONE request; 429 bounded; slow provider surfaces a notice
//     and NEVER auto-switches; raw JSON never leaks.
//
// Run:
//   node --test --test-force-exit tests/v1126-provider-continuity.test.mjs
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
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1126-continuity-'));
const mod = join(tmp, 'providers.cjs');
execFileSync(ESBUILD_NODE, [ESBUILD_BIN, join(ROOT, 'electron/agent/providers.ts'),
  '--bundle', '--platform=node', '--format=cjs', '--outfile=' + mod,
  '--external:electron', '--log-level=error'], { cwd: ROOT, timeout: 120000 });
const p = require(mod);

// ---------- transport helpers ----------
const REAL_FETCH = globalThis.fetch;
const enc = new TextEncoder();
let calls = [];

const chatChunk = (text, finish = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: finish }] })}\n\n`;
const DONE = 'data: [DONE]\n\n';
const sseBody = (text) => chatChunk(text, 'stop') + DONE;

function sseStream(chunks, { reset = false } = {}) {
  let i = 0;
  // Deliver chunks via pull() so they are READ before the connection reset.
  // (Calling controller.error() inside start() discards all queued chunks.)
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i++]));
        return;
      }
      if (reset) controller.error(new Error('socket hang up'));
      else controller.close();
    },
  });
}
function silentStream() {
  return new ReadableStream({ start() { /* never emits */ } });
}

/**
 * script[model] is a queue of steps. Each step:
 *   { text }                       → clean 200 SSE answer + [DONE]
 *   { chunks:[...], reset?:true }  → 200 SSE stream that may die mid-answer
 *   { stall:true }                 → 200 stream that emits NOTHING (idle watchdog)
 *   { status, body?, headers? }    → non-2xx gateway response
 *   { throw }                      → fetch rejects (network error)
 */
function installFetch(script, fallbackText = 'ANSWER') {
  calls = [];
  const queues = Object.fromEntries(
    Object.entries(script).map(([model, steps]) => [model, [...steps]]),
  );
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const model = body.model;
    const step = (queues[model] ?? []).shift() ?? { text: fallbackText };
    calls.push({ model, body, at: Date.now(), status: step.status ?? 200 });
    if (step.throw) throw step.throw;
    if (step.stall) return new Response(silentStream(), { status: 200 });
    if (step.chunks) return new Response(sseStream(step.chunks, { reset: !!step.reset }), { status: 200 });
    if (step.status && step.status !== 200) {
      return new Response(step.body ?? 'provider error', { status: step.status, headers: step.headers ?? {} });
    }
    return new Response(step.body ?? sseBody(step.text ?? fallbackText), { status: 200 });
  };
  return calls;
}
function restoreFetch() { globalThis.fetch = REAL_FETCH; }

const model = (id, provider = 'custom') => ({ provider, model: id, maxTokens: 64 });
const turnOpts = (primary, failover = [], hooks = {}) => ({
  model: model(primary),
  baseUrl: 'http://mock.local/v1',
  failover,
  system: 'system',
  messages: [{ role: 'user', text: 'ORIGINAL USER PROMPT' }],
  tools: [],
  signal: new AbortController().signal,
  onText: () => {},
  onToolUse: () => {},
  ...hooks,
});
const countFor = (id) => calls.filter((c) => c.model === id).length;
const JSONISH = /[{}]|"error"|\\"/;
const AR = /[\u0600-\u06FF]/;

const anthropicChunk = (type, extra) => `data: ${JSON.stringify({ type, ...extra })}\n\n`;
const anthropicStart = anthropicChunk('message_start', { message: { usage: { input_tokens: 10 } } });
const anthropicText = (text) => anthropicChunk('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
const anthropicBody = (text) =>
  anthropicStart + anthropicText(text) +
  anthropicChunk('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }) +
  anthropicChunk('message_stop', {}) + DONE;

// ============================================================
// 1. DROPPED STREAM → TRANSPARENT RECOVERY (OpenAI protocol)
// ============================================================

test('v1126: mid-answer drop resumes transparently — no prompt re-ask, no delta replay', async () => {
  p.resetRateLimitNotices();
  const notices = [];
  let text = '';
  installFetch({
    resume: [
      // First attempt: two text deltas, then the socket dies — NO finish_reason, NO [DONE].
      { chunks: [chatChunk('HELLO '), chatChunk('WORLD-')], reset: true },
      // Second attempt (continuation): the rest, properly terminated.
      { chunks: [chatChunk('AGAIN'), chatChunk('!', 'stop'), DONE] },
    ],
  });
  let result;
  try {
    result = await p.streamTurn(turnOpts('resume', [], {
      onNotice: (n) => notices.push(n),
      onText: (t) => { text += t; },
    }));
  } finally { restoreFetch(); }

  assert.equal(result.stopReason, 'end_turn', 'a recovered stream completes normally');
  assert.equal(text, 'HELLO WORLD-AGAIN!', 'every already-streamed delta survives; only new text is added');
  assert.equal(countFor('resume'), 2, 'exactly ONE bounded continuation — no retry storm');
  assert.ok(notices.some((n) => n.kind === 'stream_recovered' && /resuming from the last streamed token/i.test(n.text)),
    `a visible recovery notice is emitted: ${JSON.stringify(notices)}`);
  assert.ok(notices.every((n) => !JSONISH.test(n.text)), 'no raw JSON in any notice');
  assert.ok(notices.every((n) => !AR.test(n.text)), 'single-language notices');

  // The continuation must carry the ALREADY-SHOWN text as an assistant prefix
  // plus a short "continue" instruction — NOT a fresh copy of the user prompt.
  const second = calls[1].body;
  const assistantPrefix = second.messages.filter((m) => m.role === 'assistant');
  assert.ok(assistantPrefix.some((m) => typeof m.content === 'string' && m.content.includes('HELLO WORLD-')),
    'the visible partial answer is resent as an assistant prefix');
  const lastUser = [...second.messages].reverse().find((m) => m.role === 'user');
  assert.match(lastUser.content, /CONTINUE EXACTLY where you left off/, 'resume instruction, not a new task');
  assert.doesNotMatch(lastUser.content, /ORIGINAL USER PROMPT/, 'the original prompt is never re-asked');
});

// ============================================================
// 2. DROPPED STREAM → RECOVERY (Anthropic protocol, thinking prefix)
// ============================================================

test('v1126: Anthropic mid-answer drop resumes with text+thinking prefix', async () => {
  p.resetRateLimitNotices();
  const notices = [];
  let text = '';
  let thinking = '';
  installFetch({
    claude: [
      {
        chunks: [
          anthropicStart,
          anthropicChunk('content_block_start', { index: 0, content_block: { type: 'thinking' } }),
          anthropicChunk('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'reasoning ' } }),
          anthropicChunk('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'SIG' } }),
          anthropicText('PART ONE '),
        ],
        reset: true,
      },
      { chunks: [anthropicText('PART TWO'), anthropicChunk('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } }), anthropicChunk('message_stop', {}), DONE] },
    ],
  });
  let result;
  try {
    result = await p.streamTurn({
      ...turnOpts('claude', [], { onNotice: (n) => notices.push(n), onText: (t) => { text += t; }, onThinking: (t) => { thinking += t; } }),
      model: model('claude', 'anthropic'),
    });
  } finally { restoreFetch(); }

  assert.equal(result.stopReason, 'end_turn');
  assert.equal(text, 'PART ONE PART TWO', 'no delta lost across the drop');
  assert.equal(thinking, 'reasoning ', 'thinking deltas survive too');
  assert.equal(countFor('claude'), 2, 'bounded continuation');
  assert.ok(notices.some((n) => n.kind === 'stream_recovered'));
  const second = calls[1].body;
  assert.ok(JSON.stringify(second.messages).includes('PART ONE'), 'prefix carries the visible answer on the Anthropic wire');
});

// ============================================================
// 3. MALFORMED CHUNKS — never a silent end, no raw JSON leak
// ============================================================

test('v1126: malformed chunks + missing terminal signal recover, never leak JSON', async () => {
  p.resetRateLimitNotices();
  const notices = [];
  let text = '';
  installFetch({
    noisy: [
      // Junk lines and malformed JSON; one valid delta; then a CLEAN EOF with
      // NO [DONE] and NO finish_reason. This used to end as a blank 'end_turn'.
      { chunks: [': ping\n\n', 'garbage\n\n', 'data: {not json\n\n', chatChunk('SAVED ')] },
      { chunks: [chatChunk('TAIL', 'stop'), DONE] },
    ],
  });
  let result;
  try {
    result = await p.streamTurn(turnOpts('noisy', [], { onNotice: (n) => notices.push(n), onText: (t) => { text += t; } }));
  } finally { restoreFetch(); }

  assert.equal(result.stopReason, 'end_turn');
  assert.equal(text, 'SAVED TAIL', 'the valid delta is preserved, junk never becomes text');
  assert.doesNotMatch(text, JSONISH, 'no raw JSON fabricated into the answer');
  assert.ok(notices.some((n) => n.kind === 'stream_recovered'), 'the silent EOF is surfaced as a recovery');
});

test('v1126: a malformed drop with NO usable output surfaces a precise terminal error (no blank stop)', async () => {
  p.resetRateLimitNotices();
  const notices = [];
  installFetch({
    junk: [
      { chunks: ['data: {broken json\n\n', 'not-json\n\n'] }, // clean EOF, zero valid deltas
      { chunks: ['data: {still broken\n\n'] },              // continuation also useless
    ],
  });
  let err = null;
  try {
    await p.streamTurn(turnOpts('junk', [], { onNotice: (n) => notices.push(n) }));
  } catch (e) { err = e; } finally { restoreFetch(); }

  assert.ok(err instanceof Error, 'a dead malformed stream must NOT end as an empty success');
  assert.equal(p.providerErrorKindOf(err), 'network', 'precise, classified terminal error');
  assert.match(err.message, /Stream ended before completion/i);
  assert.doesNotMatch(err.message, JSONISH, 'no raw JSON in the error');
  assert.doesNotMatch(err.message, AR);
  assert.equal(countFor('junk'), 1, 'no usable output → NO continuation; surface the terminal error at once');
  assert.ok(notices.some((n) => n.kind === 'stream_incomplete'), 'a visible terminal notice accompanies the error');
});

// ============================================================
// 4. BOUNDED RETRIES — repeated drops cannot loop forever
// ============================================================

test('v1126: repeated mid-answer drops stop after exactly ONE continuation', async () => {
  p.resetRateLimitNotices();
  const notices = [];
  let text = '';
  installFetch({
    endless: [
      { chunks: [chatChunk('A')], reset: true },
      { chunks: [chatChunk('B')], reset: true },
      { chunks: [chatChunk('C')], reset: true }, // must never be consumed
    ],
  });
  let err = null;
  try {
    await p.streamTurn(turnOpts('endless', [], { onNotice: (n) => notices.push(n), onText: (t) => { text += t; } }));
  } catch (e) { err = e; } finally { restoreFetch(); }

  assert.ok(err instanceof Error, 'exhausted recovery surfaces an error, not a blank stop');
  assert.match(err.message, /Recovery attempts were exhausted/);
  assert.equal(countFor('endless'), 2, 'NO third request — the continuation is strictly bounded');
  assert.equal(text, 'AB', 'already-streamed deltas are kept even on terminal failure');
  assert.ok(notices.some((n) => n.kind === 'stream_recovered'), 'first drop announced recovery');
  assert.ok(notices.some((n) => n.kind === 'stream_incomplete'), 'exhaustion announced honestly');
});

// ============================================================
// 5. SLOW / STALLED PROVIDER — visible notice, NO auto-switch
// ============================================================

test('v1126: a stalled stream surfaces a slow-provider notice and NEVER auto-switches', { timeout: 8000 }, async () => {
  const prev = process.env.SURNIA_SSE_IDLE_MS;
  process.env.SURNIA_SSE_IDLE_MS = '500';
  p.resetRateLimitNotices();
  const notices = [];
  installFetch({
    slow: [{ stall: true }],
    healthy: [{ text: 'SHOULD-NOT-BE-USED' }],
  });
  const keepAlive = setTimeout(() => {}, 1500);
  let err = null;
  try {
    await p.streamTurn(turnOpts('slow', [model('healthy')], { onNotice: (n) => notices.push(n) }));
  } catch (e) { err = e; } finally {
    clearTimeout(keepAlive);
    restoreFetch();
    if (prev === undefined) delete process.env.SURNIA_SSE_IDLE_MS;
    else process.env.SURNIA_SSE_IDLE_MS = prev;
  }
  assert.ok(err instanceof Error, 'a silent stream is never a blank success');
  assert.equal(p.providerErrorKindOf(err), 'network');
  assert.match(err.message, /Stream stalled|Stream ended before completion/);
  assert.equal(countFor('healthy'), 0, 'NO auto provider switch on a slow/stalled provider');
  assert.ok(notices.some((n) => n.kind === 'slow_provider' && /not switching automatically/i.test(n.text)));
  assert.equal(countFor('slow'), 1, 'no pointless continuation with zero output');
});

test('v1126: a fetch timeout is reported honestly and never auto-switches', async () => {
  const notices = [];
  const timeout = new Error('fetch failed');
  timeout.cause = new Error('connect ETIMEDOUT 10.0.0.1:443');
  installFetch({
    slow: [{ throw: timeout }],
    healthy: [{ text: 'SHOULD-NOT-BE-USED' }],
  });
  let err = null;
  try {
    await p.streamTurn(turnOpts('slow', [model('healthy')], { onNotice: (n) => notices.push(n) }));
  } catch (e) { err = e; } finally { restoreFetch(); }

  assert.ok(err instanceof Error);
  assert.equal(p.providerErrorKindOf(err), 'network');
  assert.match(err.message, /ETIMEDOUT/, 'real cause surfaced honestly');
  assert.doesNotMatch(err.message, JSONISH);
  assert.equal(countFor('healthy'), 0, 'no auto-switch on slowness');
  assert.ok(notices.some((n) => n.kind === 'slow_provider'));
});

// ============================================================
// 6. 402 — FATAL IN ONE REQUEST
// ============================================================

test('v1126: 402 is fatal in ONE request — no retry, no continuation, no raw JSON', async () => {
  const RAW = JSON.stringify({ error: { message: 'Insufficient credits. Never purchased credits. code 402', code: 402 } });
  const notices = [];
  installFetch({ empty: [{ status: 402, body: RAW }] });
  let err = null;
  try {
    await p.streamTurn(turnOpts('empty', [], { onNotice: (n) => notices.push(n) }));
  } catch (e) { err = e; } finally { restoreFetch(); }

  assert.ok(err instanceof Error, '402 never ends silently');
  assert.equal(p.providerErrorKindOf(err), 'no_credits');
  assert.equal(countFor('empty'), 1, '402 fatal in exactly ONE request');
  assert.match(err.message, /Insufficient credits \(402\)/);
  assert.doesNotMatch(err.message, JSONISH, 'raw gateway JSON never reaches the UI');
  assert.doesNotMatch(err.message, /never purchased credits|code/i);
  assert.doesNotMatch(err.message, AR);
  assert.ok(notices.every((n) => !JSONISH.test(n.text)));
});

// ============================================================
// 7. 429 — BOUNDED, ONE consolidated notice, honest terminal on all-429
// ============================================================

test('v1126: 429 stays bounded (<=1s) and never ends silently', async () => {
  p.resetRateLimitNotices();
  const notices = [];
  let text = '';
  const r429 = () => [
    { status: 429, body: '{"error":"rate limit"}', headers: { 'retry-after': '999' } },
    { status: 429, body: '{"error":"rate limit"}' },
  ];
  installFetch({ hot: r429(), good: [{ text: 'SERVED' }] });
  const t0 = Date.now();
  try {
    await p.streamTurn(turnOpts('hot', [model('good')], { onNotice: (n) => notices.push(n), onText: (t) => { text += t; } }));
  } finally { restoreFetch(); }
  const elapsed = Date.now() - t0;

  assert.equal(countFor('hot'), 2, 'exactly ONE in-provider 429 backoff');
  assert.equal(countFor('good'), 1, 'then the next configured model serves');
  assert.ok(elapsed < 1500, `hostile Retry-After capped at <=1s (got ${elapsed}ms)`);
  assert.equal(text, 'SERVED');
  assert.equal(notices.filter((n) => n.kind === 'rate_limited').length, 1, 'ONE consolidated 429 notice');
  assert.ok(notices.every((n) => !JSONISH.test(n.text)));
});

// ============================================================
// 8. ABORT — user stop / engine watchdog must NOT trigger continuation
// ============================================================

test('v1126: an aborted stream makes NO continuation request', async () => {
  p.resetRateLimitNotices();
  const ac = new AbortController();
  installFetch({ abortme: [{ chunks: [chatChunk('HALF')], reset: true }] });
  let err = null;
  try {
    await p.streamTurn({
      ...turnOpts('abortme', [], { signal: ac.signal }),
      // abort as soon as the first delta is emitted
      onText: () => ac.abort(),
    });
  } catch (e) { err = e; } finally { restoreFetch(); }

  assert.ok(err instanceof Error, 'abort surfaces an error, not a silent success');
  assert.equal(countFor('abortme'), 1, 'NO transparent continuation after abort');
});

// ============================================================
// 9. TAXONOMY CONSISTENCY with engine.ts (report-only surface)
// ============================================================

test('v1126: provider taxonomy is stable and distinct per kind', () => {
  assert.equal(p.providerErrorKindOf({ status: 402, message: 'x' }), 'no_credits');
  assert.equal(p.providerErrorKindOf({ status: 401, message: 'x' }), 'invalid_key');
  assert.equal(p.providerErrorKindOf({ status: 429, message: 'x' }), 'rate_limited');
  assert.equal(p.providerErrorKindOf({ status: 500, message: 'x' }), 'server_error');
  assert.equal(p.providerErrorKindOf({ status: 404, message: 'x' }), 'not_found');
  assert.equal(p.shouldSkipProvider({ status: 402, message: 'x' }), true);
  assert.equal(p.shouldSkipProvider({ status: 429, message: 'x' }), true);
  assert.equal(p.shouldSkipProvider({ status: 500, message: 'x' }), true);
  // bad_request is FATAL in the engine (isFatalProviderError) but is NOT a
  // "skip provider" signal here — this divergence is documented to the parent.
  assert.equal(p.shouldSkipProvider({ status: 400, message: 'x' }), false);
});

test('v1126: source keeps the continuity + boundedness contracts', () => {
  const src = readFileSync(join(ROOT, 'electron/agent/providers.ts'), 'utf8');
  assert.match(src, /MAX_STREAM_CONTINUATIONS = 1/, 'continuations are strictly bounded');
  assert.match(src, /class StreamDroppedError/, 'mid-answer drops are classified, never blank');
  assert.match(src, /STREAM_CONTINUE_HINT/, 'resume instruction, not a full prompt re-ask');
  assert.match(src, /stream_recovered/, 'visible recovery notice');
  assert.match(src, /stream_incomplete/, 'visible terminal notice');
  assert.match(src, /if \(!ctx\.terminal\)/, 'missing terminal signal is never a silent end_turn');
  // No per-stream wall-clock cap: only idle watchdogs, never a total-stream timer.
  assert.doesNotMatch(src, /STREAM_WALL_CLOCK|streamTimeoutMs|MAX_STREAM_MS|totalStreamBudget/);
});

after(() => {
  restoreFetch();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});
