import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// v11.10 (A5) — EXACT-TOKEN HONESTY suite: the circular CONTEXT bar and the
// Usage tab must be accurate TO THE TOKEN, derived from real provider usage
// data, with an honest "≈" marker whenever a number is an estimate.
//
//   (a)  message_end carries the provider's EXACT usage (no rounding, no
//        drift) and the context-bar math consumes it without double-counting
//        the cache split (the old bug: bar % = input + cache, where input
//        already includes cache → inflated fill).
//   (b)  STORE-LEVEL RECONCILIATION: per-message rows and the session total
//        share accumulateUsage() — sum(per-message) == session total is
//        asserted numerically, for normal turns AND for the no-streaming-row
//        fallbacks (error-only / tool-only / empty turns).
//   (c)  FAILOVER 2-ATTEMPT COST: a dead attempt that burned REAL billed
//        tokens (usage snapshot mid-stream, then the socket died) is ledgered
//        provider/model-exact; retry estimate attempt marked `estimated`;
//        failover attempt on the next provider completes — runCost ==
//        sum(attempt costs) to the micro-dollar.
//   (d)  ESTIMATE → EXACT: a provider that reports NO usage gets the chars/4
//        fallback honestly marked `estimated`; the live bar estimate
//        (last fill + chars/4) is replaced by the exact figure on finalize.
//   (e)  PRICING ARITHMETIC spot-checks against the catalog (cache-weighted
//        billing, prefix specificity, honest 200k default for unknown ids).
//
// Same harness posture as v1110-endurance: REAL engine loop + REAL provider
// streaming layer against a scripted local mock (node:http, zero network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1110-usage-'));

// ---------- esbuild bundle (same posture as v1110-endurance) ----------
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

// electron stub for plain-Node execution
const userDataDir = join(tmp, 'userdata');
mkdirSync(userDataDir, { recursive: true });
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `module.exports = {
    app: { getPath: (k) => ${JSON.stringify(userDataDir)}, whenReady: async () => true, on() {}, quit() {} },
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: { getAllWindows: () => [] },
    Notification: { isSupported: () => false },
    shell: {},
    screen: {},
  };`,
);

const engPath = join(tmp, 'engine.cjs');
bundle('electron/agent/engine.ts', engPath);
const engine = require(engPath);

const costsPath = join(tmp, 'costs.cjs');
bundle('electron/agent/costs.ts', costsPath);
const costs = require(costsPath);

const ctxPath = join(tmp, 'ctx.cjs');
bundle('src/lib/ctx.ts', ctxPath);
const ctx = require(ctxPath);

const usagePath = join(tmp, 'usage.cjs');
bundle('src/lib/usage.ts', usagePath);
const usageLib = require(usagePath);

// ---------- mock OpenAI-compatible provider ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

function sseHeaders(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  res.flushHeaders();
}
function finishSse(res, finish, usage) {
  if (usage) res.write(`data: ${JSON.stringify({ usage, choices: [] })}\n\n`);
  res.write(sseChunk({}, finish));
  res.write('data: [DONE]\n\n');
  res.end();
}
const hComplete = ({ text, finish = 'stop', usage } = {}) => async ({ res }) => {
  sseHeaders(res);
  if (text) res.write(sseChunk({ content: text }));
  finishSse(res, finish, usage);
};
const hStatus = (code) => async ({ res }) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: `mock ${code}` } }));
};
/**
 * Deliver a REAL usage snapshot (the provider's own accounting, exactly what
 * Anthropic message_start / OpenAI's final usage chunk carry), then murder
 * the connection mid-stream: the attempt DIES after billing.
 */
const hBillThenDrop = ({ usage, graceMs = 60 } = {}) => async ({ res, req }) => {
  sseHeaders(res);
  res.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
  await sleep(graceMs); // let the usage chunk land in the parser
  req.socket.destroy();
};

function startMock() {
  const routes = new Map(); // model → handler queue
  const requests = []; // { model, at }
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      requests.push({ model: body.model, at: Date.now() });
      const q = routes.get(body.model);
      const h = q && q.length ? q.shift() : null;
      if (!h) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `UNSCRIPTED request for model ${body.model}` } }));
        return;
      }
      try { await h({ res, req, body }); } catch { try { res.destroy(); } catch { /* gone */ } }
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const listening = new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  return {
    routes,
    requests,
    port: () => listening,
    async stop() {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

// ---------- engine harness (mirrors v1110-endurance) ----------
function writeSettings(mockBase, extraAgent = {}) {
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 4,
      providers: {
        custom: { apiKey: 'test-key', baseUrl: mockBase },
        zai: { apiKey: 'failover-key', baseUrl: mockBase },
      },
      agent: { maxRetries: 0, autoCompact: false, autoVerify: false, ...extraAgent },
      doneNotifications: false,
    }),
  );
}

function makeIo() {
  const events = [];
  return {
    events,
    send(e) {
      events.push(e);
    },
    async getDecision(requestId) {
      return { requestId, action: 'allow' };
    },
    isAborted: () => false,
    onFetchSignal() {},
  };
}

async function runEngine({ workspace, baseUrl, io, model = 'mock-a' }) {
  try {
    await engine.runAgent(
      {
        task: 'chat',
        sessionId: 'sess-' + Math.random().toString(36).slice(2),
        messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Do the task end to end.', timestamp: Date.now() }],
        model: { provider: 'custom', model, maxTokens: 2048 },
        mode: 'fullAccess',
        workspace,
        apiKey: 'test-key',
        baseUrl,
      },
      io,
    );
  } catch (err) {
    console.error('[v1110-usage harness] runAgent threw:', err);
  }
}

const types = (io, type) => io.events.filter((e) => e.type === type);
const notices = (io) => types(io, 'sys_notice').map((e) => e.text);
const round6 = (n) => Math.round(n * 1e6) / 1e6;

// ============================================================
// (a) message_end exact usage + bar math without cache double-count
// ============================================================
test('a: message_end usage is the provider EXACT figure; bar math never double-counts cache', async () => {
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = '8';
  const ws = mkdtempSync(join(tmpdir(), 'surnia-u-a-'));
  const mock = startMock();
  const port = await mock.port();
  // The provider reports EXACTLY 12,482 in / 700 out (plus a cache split that
  // is a SUBSET of prompt_tokens, OpenAI-style) — no rounding, no drift.
  mock.routes.set('mock-a', [
    hComplete({ text: 'Done.', usage: { prompt_tokens: 12482, completion_tokens: 700, prompt_tokens_details: { cached_tokens: 3000 } } }),
  ]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo();
  try {
    await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    const end = types(io, 'message_end')[0];
    assert.ok(end, 'message_end emitted');
    const u = end.usage;
    assert.equal(u.inputTokens, 12482, 'input tokens EXACT (12,482)');
    assert.equal(u.outputTokens, 700, 'output tokens EXACT (700)');
    assert.equal(u.estimated, undefined, 'provider-reported usage is NEVER marked ≈');
    assert.ok(u.costUsd > 0, 'cost priced from the real token counts');
    assert.equal(u.cacheReadTokens, 3000, 'cache split rides through (subset of input)');
    assert.equal(u.runInput, 12482, 'run totals == the single attempt');
    assert.equal(u.runOutput, 700);
    assert.equal(u.runCost, round6(u.costUsd), 'runCost == attempt cost');
    assert.equal(u.attempts.length, 1, 'one attempt on the ledger');
    assert.deepEqual([u.attempts[0].provider, u.attempts[0].model], ['custom', 'mock-a']);
    assert.equal(u.attempts[0].inputTokens, 12482);
    assert.equal(u.attempts[0].estimated, undefined);

    // ----- context-bar math (the renderer's exact functions) -----
    // OLD BUG: fill = input + cacheRead + cacheWrite → 12482+3000 = 15,482 (a lie).
    const fill = ctx.ctxFillTokens({ inputTokens: 12482, cacheReadTokens: 3000, cacheCreationTokens: 0 });
    assert.equal(fill, 12482, 'ctxFill == inputTokens — cache is INSIDE the total, never added on top');
    // 12,482 / 200,000 = 6.241% → shown as "6.2%"
    const pct = ctx.ctxPctExact({ inputTokens: fill }, 200000);
    assert.ok(Math.abs(pct - 6.241) < 1e-9, `exact pct is 6.241 (got ${pct})`);
    assert.equal(pct.toFixed(1), '6.2', 'one-decimal display string');
    assert.equal(Math.round(pct), 6, 'rounded pct for the ring arc geometry');
    assert.equal(ctx.ctxPctExact({ inputTokens: 12482 }, 0), 0, 'unknown window → 0 (never a fake %)');
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

// ============================================================
// (b) store-level reconciliation: sum(per-message) == session total
// ============================================================
test('b: per-message rows and the session total reconcile EXACTLY (all attach shapes)', () => {
  const { accumulateUsage, emptySessionUsage, runUsageView } = ctx;
  const { attachTurnUsage } = usageLib;

  const mkDelta = (n, cost, attempts) => ({
    inputTokens: 100 * n,
    outputTokens: 10 * n,
    costUsd: cost,
    cacheReadTokens: 20 * n,
    cacheCreationTokens: 0,
    runInput: 100 * n,
    runOutput: 10 * n,
    runCost: cost,
    runCacheRead: 20 * n,
    runCacheCreation: 0,
    attempts,
  });
  const att = (p, m, i, o, c) => ({ provider: p, model: m, inputTokens: i, outputTokens: o, costUsd: c });

  // --- normal shape: streaming assistant row owns the usage ---
  let total = emptySessionUsage();
  const msgs1 = [
    { id: 'u1', role: 'user', kind: 'text', content: 'hi', timestamp: 1 },
    { id: 'a1', role: 'assistant', kind: 'text', content: 'hello', timestamp: 2, streaming: true, model: 'custom/mock-a' },
  ];
  const d1 = mkDelta(1, 0.0011, [att('custom', 'mock-a', 100, 10, 0.0011)]);
  msgs1[1] = { ...msgs1[1], streaming: false, usage: runUsageView(d1) }; // finalizeRow
  total = accumulateUsage(total, runUsageView(d1));

  // --- error-only turn: NO streaming row — the fallback must attach ---
  const msgs2 = [...msgs1, { id: 'e1', role: 'assistant', kind: 'text', content: 'provider 500', model: 'error', timestamp: 3 }];
  const d2 = mkDelta(2, 0.0042, [att('custom', 'mock-a', 150, 0, 0.0012), att('zai', 'glm-4.7', 50, 20, 0.003)]);
  const idx2 = attachTurnUsage(msgs2, runUsageView(d2));
  assert.equal(idx2, 2, 'usage lands on the ERROR row (last assistant text row)');
  assert.equal(msgs2[2].usage.costUsd, runUsageView(d2).costUsd, 'error row carries the whole-turn billing');
  total = accumulateUsage(total, runUsageView(d2));

  // --- tool-only turn: no assistant text row — attach to the tool_call row ---
  const msgs3 = [
    { id: 'u2', role: 'user', kind: 'text', content: 'run it', timestamp: 4 },
    { id: 't1', role: 'tool', kind: 'tool_call', toolName: 'run_command', content: '{}', timestamp: 5 },
  ];
  const d3 = mkDelta(3, 0.009);
  const idx3 = attachTurnUsage(msgs3, runUsageView(d3));
  assert.equal(idx3, 1, 'usage lands on the last tool_call row when no assistant row exists');
  total = accumulateUsage(total, runUsageView(d3));

  // --- empty-output turn: synthetic row keeps the books balanced ---
  const msgs4 = [{ id: 'u3', role: 'user', kind: 'text', content: '…', timestamp: 6 }];
  const d4 = mkDelta(1, 0.0005);
  attachTurnUsage(msgs4, runUsageView(d4));
  assert.equal(msgs4.length, 2, 'synthetic owner row pushed (usage never silently dropped)');
  assert.equal(msgs4[1].usage.costUsd, d4.runCost);
  total = accumulateUsage(total, runUsageView(d4));

  // --- THE RECONCILIATION: sum(per-message) == session total, exactly ---
  const allRows = [...msgs1, ...msgs2.slice(2), ...msgs3.slice(1), ...msgs4.slice(1)];
  const rowCost = allRows.reduce((a, m) => a + (m.usage?.costUsd ?? 0), 0);
  const rowIn = allRows.reduce((a, m) => a + (m.usage?.inputTokens ?? 0), 0);
  const rowOut = allRows.reduce((a, m) => a + (m.usage?.outputTokens ?? 0), 0);
  const rowCache = allRows.reduce((a, m) => a + (m.usage?.cacheReadTokens ?? 0), 0);
  assert.equal(Math.round(rowCost * 1e6), Math.round(total.costUsd * 1e6), 'sum(rows.costUsd) == sessionUsage.costUsd');
  assert.equal(rowIn, total.inputTokens, 'sum(rows.inputTokens) == sessionUsage.inputTokens');
  assert.equal(rowOut, total.outputTokens, 'sum(rows.outputTokens) == sessionUsage.outputTokens');
  assert.equal(rowCache, total.cacheReadTokens, 'cache split reconciles too');
  assert.equal(total.attempts.length, 3, 'attempts merge across turns (1 + 2 + 0 + 0)');

  // --- run view honesty: marker propagates from any estimated attempt ---
  const rv = runUsageView({ inputTokens: 5, outputTokens: 5, costUsd: 0.001, attempts: [att('a', 'm', 1, 1, 0.0005), { ...att('b', 'm2', 2, 2, 0.0005), estimated: true }] });
  assert.equal(rv.estimated, true, '≈ marker when ANY attempt was estimated');
  const rvExact = runUsageView({ inputTokens: 5, outputTokens: 5, costUsd: 0.001, attempts: [att('a', 'm', 1, 1, 0.001)] });
  assert.equal(rvExact.estimated, undefined, 'no marker when every attempt is provider-exact');
});

// ============================================================
// (c) failover: dead attempt's REAL usage + estimate + survivor
// ============================================================
test('c: failover 2-attempt cost breakdown — dead attempt billed exactly, retry marked ≈, sums reconcile', async () => {
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = '8'; // 1 retry per provider → deterministic 3 attempts
  const ws = mkdtempSync(join(tmpdir(), 'surnia-u-c-'));
  const mock = startMock();
  const port = await mock.port();
  mock.routes.set('mock-a', [
    // attempt 1: REAL usage snapshot (1,203 in / 50 out) → then the stream dies
    hBillThenDrop({ usage: { prompt_tokens: 1203, completion_tokens: 50 } }),
    // attempt 2: hard 500 — no usage data at all → honest transcript estimate (≈)
    hStatus(500),
  ]);
  mock.routes.set('glm-4.7', [
    // attempt 3: the failover provider delivers (2,000 in / 100 out)
    hComplete({ text: 'Recovered.', usage: { prompt_tokens: 2000, completion_tokens: 100 } }),
  ]);
  // v11.19: failover is OFF by default — this test exercises the mechanism.
  writeSettings(`http://127.0.0.1:${port}/v1`, { allowModelFailover: true });
  const io = makeIo();
  try {
    await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    assert.equal(types(io, 'error').length, 0, 'failover absorbed the failure');
    assert.ok(notices(io).some((x) => x.includes('Trying another configured model')), 'failover notice emitted');
    const end = types(io, 'message_end')[0];
    assert.equal(end?.stopReason, 'end_turn');
    const u = end.usage;
    const atts = u.attempts ?? [];
    assert.equal(atts.length, 3, `all three attempts on the ledger (got ${atts.length})`);

    // attempt 1 — DEAD but BILLED: the provider's own snapshot, EXACT, attributed
    assert.deepEqual([atts[0].provider, atts[0].model], ['custom', 'mock-a']);
    assert.equal(atts[0].inputTokens, 1203, 'dead attempt input EXACT (1,203)');
    assert.equal(atts[0].outputTokens, 50, 'dead attempt output EXACT (50)');
    assert.equal(atts[0].estimated, undefined, 'provider-reported dead usage is EXACT — no ≈');
    assert.ok(atts[0].costUsd > 0, 'dead attempt costed');

    // attempt 2 — dead with ZERO data: honest estimate, marked ≈
    assert.equal(atts[1].estimated, true, 'no-usage retry marked ≈');
    assert.ok(atts[1].inputTokens > 0, 'estimate still counts real transcript size');

    // attempt 3 — survivor on the failover provider, exact
    assert.deepEqual([atts[2].provider, atts[2].model], ['zai', 'glm-4.7']);
    assert.equal(atts[2].inputTokens, 2000);
    assert.equal(atts[2].estimated, undefined);

    // RECONCILIATION: runCost == sum(attempt costs); runInput == sum(inputs)
    const sumCost = round6(atts.reduce((a, x) => a + x.costUsd, 0));
    const sumIn = atts.reduce((a, x) => a + x.inputTokens, 0);
    const sumOut = atts.reduce((a, x) => a + x.outputTokens, 0);
    assert.equal(u.runCost, sumCost, 'runCost == sum(per-attempt cost) to the micro-dollar');
    assert.equal(u.runInput, sumIn, 'runInput == sum(per-attempt input)');
    assert.equal(u.runOutput, sumOut, 'runOutput == sum(per-attempt output)');
    assert.equal(u.runCacheRead, 0, 'run cache totals ride through');

    // DELTA vs RUN: the bar uses the FINAL prompt (2,000 — the true window
    // occupancy); billing uses the whole run (1,203 + est + 2,000).
    assert.equal(u.inputTokens, 2000, 'delta = final prompt (bar semantics)');
    assert.ok(u.runInput > u.inputTokens, 'run totals include the dead attempts');

    // the store would reconcile on this payload:
    let su = ctx.emptySessionUsage();
    const row = ctx.runUsageView(u);
    su = ctx.accumulateUsage(su, row);
    assert.equal(Math.round(su.costUsd * 1e6), Math.round(u.runCost * 1e6), 'store total == runCost');
    assert.equal(row.costUsd, u.runCost, 'the single per-message row carries the whole run');
    assert.equal(row.estimated, true, '≈ surfaced (one estimated attempt in the chain)');
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

// ============================================================
// (d) estimate honesty + estimate → exact replacement on finalize
// ============================================================
test('d: provider that reports NO usage → chars/4 marked ≈; live estimate replaced by exact on finalize', async () => {
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = '8';
  const ws = mkdtempSync(join(tmpdir(), 'surnia-u-d-'));
  const mock = startMock();
  const port = await mock.port();
  mock.routes.set('mock-a', [hComplete({ text: 'Silent provider — no usage chunk here.' })]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo();
  try {
    await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io });
    const end = types(io, 'message_end')[0];
    assert.ok(end, 'message_end emitted');
    const u = end.usage;
    assert.equal(u.estimated, true, 'usage honestly marked ≈ (provider reported nothing)');
    assert.equal(u.attempts?.[0]?.estimated, true, 'the attempt ledger entry is marked too');
    assert.ok(u.inputTokens > 0 && u.outputTokens > 0, 'chars/4 estimate still counts real sizes');
    assert.ok(u.costUsd > 0, 'estimated usage is still priced (conservatively, full rate)');
    // an estimate must NEVER pretend to be a precise provider figure: the
    // marker is the contract the UI renders as "≈".
    assert.equal(u.inputTokens, Math.ceil(u.inputTokens), 'integer token counts only');
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }

  // estimate → exact replacement (the renderer bar contract, in numbers):
  // streaming: fill = last exact (1200) + chars/4 of 4,000 streamed = 2,200 (≈)
  const live = ctx.liveFillEstimate(1200, 4000);
  assert.equal(live, 2200, 'live estimate = last fill + ceil(chars/4)');
  assert.equal(ctx.estimateTokensFromChars(4000), 1000, 'the engine\'s own chars/4 heuristic');
  // finalize: message_end arrives with the provider's EXACT fill → the store
  // sets liveStreamChars=0 and lastTurnUsage=exact → the bar shows 2,482.
  const exactFill = ctx.ctxFillTokens({ inputTokens: 2482, cacheReadTokens: 0, cacheCreationTokens: 0 });
  assert.equal(exactFill, 2482, 'exact fill replaces the 2,200 ≈ estimate');
  assert.notEqual(exactFill, live, 'the estimate is GONE after finalize (never lingers)');
});

// ============================================================
// (e) pricing arithmetic spot-checks
// ============================================================
test('e: pricing arithmetic — cache-weighted billing, prefix specificity, honest fallbacks', () => {
  // claude-sonnet-4-6 $3/$15, cache read 10% ($0.3/M), cache write 125% ($3.75/M):
  // 500k fresh in ($1.50) + 300k cached ($0.09) + 50k writes ($0.1875) + 100k out ($1.50)
  const c = costs.estimateCostDetailed('anthropic', 'claude-sonnet-4-6', 500_000, 100_000, 300_000, 50_000);
  assert.equal(c.costUsd, 3.2775, `cache-weighted cost exact (got ${c.costUsd})`);
  assert.equal(c.estimated, false);
  // prefix specificity: the codex row outranks the gpt-5-1 base row
  const codex = costs.priceFor('gpt-5.1-codex');
  assert.deepEqual([codex.input, codex.output], [1.25, 10], 'gpt-5.1-codex pinned $1.25/$10 (openai.com/api/pricing)');
  assert.equal(costs.estimateCost('openai', 'gpt-5.1-codex', 1_000_000, 0), 1.25, '1M in @ $1.25/M = $1.25');
  // context windows: known model exact, unknown model → 200k DEFAULT marked ≈
  assert.deepEqual(costs.contextWindowInfo('claude-opus-4-1'), { ctx: 200_000, estimated: false });
  assert.deepEqual(costs.contextWindowInfo('claude-sonnet-4-6'), { ctx: 1_000_000, estimated: false });
  assert.deepEqual(costs.contextWindowInfo('totally-unknown-model-xyz'), { ctx: 200_000, estimated: true }, 'unknown id → honest 200k ≈');
  assert.deepEqual(costs.contextWindowInfo(''), { ctx: 200_000, estimated: true });
  // unknown pricing → conservative fallback flagged estimated (never silent)
  const fb = costs.priceFor('zzz-not-a-real-model-xyz');
  assert.equal(fb.estimated, true, 'unknown model pricing flagged ≈');
  assert.deepEqual([fb.input, fb.output], [3, 15], 'conservative $3/$15 fallback');
  // vendor-qualified ids price correctly after the v11.10 deepseek/kimi fixes
  const ds = costs.priceFor('deepseek/deepseek-v4.1-flash-1017');
  assert.deepEqual([ds.input, ds.output], [0.3, 1.2], 'OR-qualified deepseek v4.1 flash → flash tier (was falling to generic chat pricing)');
  assert.equal(costs.contextWindowInfo('deepseek/deepseek-v4.1-flash-1017').ctx, 1_000_000, 'was 64k generic → now the real 1M window');
  // zero-cost free tier stays free
  assert.equal(costs.estimateCost('zai', 'glm-4.7-flash', 999_999, 999_999), 0, 'free tier = $0');
});

test('cleanup', () => {
  for (const k of ['SURNIA_TURN_RETRY_DELAYS_MS', 'SURNIA_SSE_IDLE_MS', 'SURNIA_MAX_RUN_MS', 'SURNIA_TIME_CAP_GRACE_MS']) {
    delete process.env[k];
  }
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
