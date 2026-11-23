// v11.27 (429 CONTINUATION GUARD) — INDEPENDENT VERIFICATION.
// ------------------------------------------------------------
// Real engine run (electron/agent/engine.ts, bundled from SOURCE at call time)
// driven by a scripted, loopback-only mock provider. NO app source is touched
// by this file. It encodes the founder's acceptance criteria for the 429 fix:
//
//   A. 429 x N (N=3..6) then success, WITH a tool call before the 429 burst:
//      run COMPLETES with real deltas, ONE written report, ONE quiet 429
//      notice, NO duplicate tool execution, NO auto-switch.
//   B. 429 forever: BOUNDED honest failure (not infinite, not instant), ONE
//      report, ONE error row, ONE 429 notice.
//   C. 402 => exactly ONE request + fatal; 401 => fatal on the first request.
//   D. Long task: 429s interleaved with two tool chains keep running until the
//      USER aborts; no duplicate tools, no auto-switch, honest 'aborted' report.
//
// Run:  node --test tests/v1127-429-guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const TMP = mkdtempSync(join(tmpdir(), 'sadeem-v1127-429-guard-'));
const userDataDir = join(TMP, 'userdata');
mkdirSync(userDataDir, { recursive: true });

// electron stub: the bundled engine sits in TMP/, so require('electron')
// resolves TMP/node_modules/electron — a plain-Node fake app.
const stubDir = join(TMP, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `module.exports = {
  app: { getPath: () => ${JSON.stringify(userDataDir)}, whenReady: async () => true, on() {}, quit() {} },
  ipcMain: { handle() {}, on() {} },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: { isSupported: () => false },
  shell: {}, screen: {},
};
module.exports.default = module.exports;`,
);

function bundle(entry, out) {
  execFileSync(
    ESBUILD_NODE,
    [
      ESBUILD_BIN,
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
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
}

const enginePath = join(TMP, 'engine.cjs');
const providersPath = join(TMP, 'providers.cjs');
bundle('electron/agent/engine.ts', enginePath);
bundle('electron/agent/providers.ts', providersPath);
const engine = require(enginePath);
const providers = require(providersPath);

// ---------- env knobs (read AT CALL TIME by engine/providers) ----------
process.env.SURNIA_TURN_RETRY_DELAYS_MS = '10,10,10,10,10,10'; // if the engine retries, fail FAST and LOUD
process.env.SURNIA_RATE_LIMIT_MAX_ATTEMPTS = '8';
process.env.SURNIA_RATE_LIMIT_BUDGET_MS = '60000';

// ---------- scripted local provider ----------
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'v1127', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const sseHeaders = (res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  res.flushHeaders();
};
const finishSse = (res, finish, usage = { prompt_tokens: 10, completion_tokens: 10 }) => {
  res.write(`data: ${JSON.stringify({ id: 'v1127', object: 'chat.completion.chunk', usage, choices: [] })}\n\n`);
  res.write(sseChunk({}, finish));
  res.write('data: [DONE]\n\n');
  res.end();
};

/** A 429 step. No Retry-After => the provider uses its own bounded exponential backoff. */
const h429 = () => ({ res }) => {
  res.writeHead(429, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Rate limited' } }));
};
const hStatus = (code, message) => ({ res }) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message, code } }));
};
const hText = (text) => ({ res }) => {
  sseHeaders(res);
  res.write(sseChunk({ content: text }));
  finishSse(res, 'stop');
};
const hTool = (name, args, id) => ({ res }) => {
  sseHeaders(res);
  res.write(sseChunk({ tool_calls: [{ index: 0, id, function: { name, arguments: '' } }] }));
  res.write(sseChunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }));
  finishSse(res, 'tool_calls');
};

function startMock() {
  const routes = new Map(); // model -> step queue
  const requests = []; // { model, at, hasToolResult }
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        /* keep {} */
      }
      const model = body.model ?? '(none)';
      requests.push({
        model,
        at: Date.now(),
        hasToolResult: (body.messages ?? []).some((m) => m.role === 'tool'),
      });
      const q = routes.get(model);
      const step = q && q.length ? q.shift() : null;
      if (!step) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `v1127: UNSCRIPTED request for model ${model}` } }));
        return;
      }
      try {
        await step({ res, body });
      } catch {
        try {
          res.destroy();
        } catch {
          /* socket gone */
        }
      }
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
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

// ---------- settings (TWO providers configured + failover opt-in ON, so an
// auto-switch would be VISIBLE as a request for another model) ----------
function writeSettings(baseUrl) {
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 4,
      providers: {
        custom: { apiKey: 'test-key', baseUrl },
        zai: { apiKey: 'failover-key', baseUrl },
      },
      agent: {
        maxRetries: 0,
        autoCompact: false,
        autoVerify: false,
        autoMemory: false,
        criticGate: false,
        allowModelFailover: true, // strongest form of the "no auto-switch" check
      },
      dnaEnabled: false,
      checkpointsEnabled: false,
      doneNotifications: false,
    }),
  );
}

/** Recording IO. abortWhen(e, events) may abort the run from inside send(). */
function makeIo({ abortWhen = null } = {}) {
  const events = [];
  const ac = new AbortController();
  return {
    events,
    controller: ac,
    send(e) {
      events.push(e);
      if (abortWhen && !ac.signal.aborted && abortWhen(e, events)) ac.abort();
    },
    async getDecision(requestId) {
      return { requestId, action: 'allow' };
    },
    isAborted: () => ac.signal.aborted,
    onFetchSignal(cb) {
      cb(ac.signal); // mirror the register.ts bridge
    },
  };
}

const ev = (io, type) => io.events.filter((e) => e.type === type);
const reports = (io) => ev(io, 'task_report');
const rateNotices = (io) => ev(io, 'sys_notice').filter((e) => e.kind === 'rate_limited');
const failoverNotices = (io) => ev(io, 'sys_notice').filter((e) => e.kind === 'failover');
const answerText = (io) => ev(io, 'text_delta').map((e) => e.text).join('');
const toolStarts = (io) => ev(io, 'tool_start');
const toolResults = (io) => ev(io, 'tool_result');

/** How many task_report rows were JOURNALLED for this session (0 if no file). */
function countJournalledReports(sessionId) {
  let count = 0;
  const root = join(userDataDir, 'journals');
  if (!existsSync(root)) return count;
  for (const day of readdirSync(root)) {
    const file = join(root, day, `${sessionId}.jsonl`);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        if (JSON.parse(line).type === 'task_report') count++;
      } catch {
        /* non-JSON line */
      }
    }
  }
  return count;
}

/** Journal writes are async/debounced (JOURNAL_FLUSH_MS=120) — poll briefly. */
async function journalledReports(sessionId) {
  for (let i = 0; i < 20; i++) {
    const n = countJournalledReports(sessionId);
    if (n > 0) return n;
    await new Promise((r) => setTimeout(r, 50));
  }
  return 0;
}

/**
 * Drive ONE real engine run.
 * @returns {{io, requests, thrown, durationMs, journalReports, sessionId}}
 */
async function drive({ model, steps, ws, abortWhen = null, timeoutMs = 30_000 }) {
  const mock = startMock();
  const port = await mock.port();
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  writeSettings(baseUrl);
  mock.routes.set(model, [...steps]);
  const sessionId = `v1127-${model}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const io = makeIo({ abortWhen });
  const t0 = Date.now();
  let thrown = null;
  let timer = null;
  try {
    const run = engine.runAgent(
      {
        task: 'chat',
        sessionId,
        messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Do the task end to end.', timestamp: t0 }],
        model: { provider: 'custom', model, maxTokens: 4096 },
        mode: 'fullAccess',
        workspace: ws,
        apiKey: 'test-key',
        baseUrl,
      },
      io,
    );
    const guard = new Promise((_, reject) => {
      timer = setTimeout(() => {
        try {
          io.controller.abort();
        } catch {
          /* already aborting */
        }
        reject(new Error(`TIMEOUT after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    await Promise.race([run, guard]);
  } catch (err) {
    thrown = err;
  } finally {
    if (timer) clearTimeout(timer);
    try {
      await mock.stop();
    } catch {
      /* best effort */
    }
  }
  const journalReports = await journalledReports(sessionId);
  return {
    io,
    requests: [...mock.requests],
    thrown,
    durationMs: Date.now() - t0,
    journalReports,
    sessionId,
  };
}

const freshWs = (tag) => mkdtempSync(join(tmpdir(), `v1127-${tag}-`));

// ============================================================
// A. 429 x N (3..6) then success — MUST recover in place.
// ============================================================
test('A: 429 x N then success — completes, one report, one quiet notice, no duplicate tool, no auto-switch', async (t) => {
  for (const N of [3, 4, 5, 6]) {
    await t.test(`N=${N}`, async (t2) => {
      const ws = freshWs(`a${N}`);
      try {
        const r = await drive({
          model: `guard-${N}`,
          steps: [
            hTool('write_file', { path: 'guard.txt', content: 'GUARDED\n' }, `guard_c1_${N}`),
            ...Array.from({ length: N }, h429),
            hText(`DONE after ${N} rate limits.`),
          ],
          ws,
        });
        const rep = reports(r.io);
        const starts = toolStarts(r.io);
        const results = toolResults(r.io);
        const rNotices = rateNotices(r.io);
        const fNotices = failoverNotices(r.io);
        t2.diagnostic(
          `N=${N}: requests=${r.requests.length} duration=${r.durationMs}ms reports=${rep.length} ` +
            `journalReports=${r.journalReports} rateNotices=${rNotices.length} failoverNotices=${fNotices.length} ` +
            `toolStarts=${starts.length} toolResults=${results.length} errors=${ev(r.io, 'error').length} thrown=${r.thrown?.message ?? 'none'}`,
        );

        assert.equal(r.thrown, null, `N=${N}: engine run must not throw`);
        assert.equal(ev(r.io, 'error').length, 0, `N=${N}: no error row on a recovered 429 burst`);
        assert.equal(ev(r.io, 'aborted').length, 0, `N=${N}: no abort`);
        assert.equal(rep.length, 1, `N=${N}: EXACTLY one written task_report`);
        assert.equal(rep[0]?.outcome, 'completed', `N=${N}: report outcome = completed`);
        assert.equal(r.journalReports, 1, `N=${N}: EXACTLY one task_report journaled`);
        assert.match(answerText(r.io), new RegExp(`DONE after ${N} rate limits`), `N=${N}: real final deltas streamed`);

        assert.equal(rNotices.length, 1, `N=${N}: EXACTLY one quiet 429 notice (got ${rNotices.length})`);
        assert.match(rNotices[0]?.text ?? '', /waiting briefly and continuing the same task/i, `N=${N}: notice wording`);
        assert.doesNotMatch(rNotices[0]?.text ?? '', /failover|switching provider/i, `N=${N}: 429 notice never claims a switch`);

        assert.equal(starts.length, 1, `N=${N}: tool executed EXACTLY once`);
        assert.equal(starts[0]?.toolCallId, `guard_c1_${N}`, `N=${N}: original tool id preserved`);
        assert.equal(results.length, 1, `N=${N}: one tool result`);
        assert.equal(results[0]?.ok, true, `N=${N}: tool result ok`);
        assert.equal(readFileSync(join(ws, 'guard.txt'), 'utf8'), 'GUARDED\n', `N=${N}: file written once (no duplicate side effect)`);

        assert.equal(fNotices.length, 0, `N=${N}: NO auto-switch notice`);
        assert.ok(
          r.requests.every((q) => q.model === `guard-${N}`),
          `N=${N}: every request stayed on the user's model (got ${[...new Set(r.requests.map((q) => q.model))].join(',')})`,
        );
        assert.equal(r.requests.length, N + 2, `N=${N}: ${N} 429s + 1 tool turn + 1 final turn, NO engine-level duplicate retries`);
      } finally {
        rmSync(ws, { recursive: true, force: true });
      }
    });
  }
});

// ============================================================
// B. 429 forever — bounded, honest, single report.
// ============================================================
test('B: 429 forever — bounded honest failure (not infinite, not instant), ONE report', async (t) => {
  process.env.SURNIA_RATE_LIMIT_MAX_ATTEMPTS = '8';
  process.env.SURNIA_RATE_LIMIT_BUDGET_MS = '60000';
  const ws = freshWs('b');
  try {
    const r = await drive({
      model: 'forever-429',
      steps: Array.from({ length: 24 }, h429),
      ws,
      timeoutMs: 25_000,
    });
    const rep = reports(r.io);
    const errs = ev(r.io, 'error');
    const rNotices = rateNotices(r.io);
    t.diagnostic(
      `429-forever: requests=${r.requests.length} duration=${r.durationMs}ms reports=${rep.length} ` +
        `journalReports=${r.journalReports} errors=${errs.length} errorText=${JSON.stringify(errs[0]?.message ?? '')} ` +
          `rateNotices=${rNotices.length} thrown=${r.thrown?.message ?? 'none'}`,
    );

    assert.equal(r.thrown, null, 'runAgent handles the failure internally — no uncaught throw');
    assert.ok(r.durationMs > 1500, `not an INSTANT fail: actually waited through the bounded backoff (${r.durationMs}ms)`);
    assert.ok(r.durationMs < 20_000, `not INFINITE: terminal within the bound (${r.durationMs}ms)`);
    assert.equal(r.requests.length, 8, 'exactly 8 bounded attempts (initial + 7 retries), no hammer loop');
    assert.equal(rep.length, 1, 'EXACTLY one written report');
    assert.equal(r.journalReports, 1, 'EXACTLY one journaled report');
    assert.equal(rep[0]?.outcome, 'error', 'report honestly says error');
    assert.equal(errs.length, 1, 'exactly ONE honest error row');
    assert.match(errs[0]?.message ?? '', /429|rate limited/i, `error row names the rate limit (got: ${errs[0]?.message})`);
    assert.equal(rNotices.length, 1, 'exactly ONE quiet 429 notice, not one per attempt');
    assert.equal(failoverNotices(r.io).length, 0, 'no auto-switch on a rate-limited provider');
    assert.equal(answerText(r.io), '', 'no fabricated success text');
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ============================================================
// C. 402 and 401 — fatal on the FIRST response.
// ============================================================
test('C1: 402 — exactly ONE provider request, fatal, one report', async (t) => {
  const ws = freshWs('c402');
  try {
    const r = await drive({
      model: 'credits-402',
      steps: [hStatus(402, 'Insufficient credits. This account never purchased credits. Add credits.')],
      ws,
    });
    const errs = ev(r.io, 'error');
    t.diagnostic(`402: requests=${r.requests.length} errors=${errs.length} reports=${reports(r.io).length} outcome=${reports(r.io)[0]?.outcome}`);
    assert.equal(r.requests.length, 1, '402: EXACTLY ONE provider request (no retry, no failover)');
    assert.equal(errs.length, 1, '402: one error row');
    assert.match(errs[0]?.message ?? '', /402|insufficient credits/i, '402: billing-classified message');
    assert.equal(reports(r.io).length, 1, '402: one report');
    assert.equal(reports(r.io)[0]?.outcome, 'error', '402: report = error');
    assert.equal(rateNotices(r.io).length, 0, '402: not mislabeled as a 429');
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test('C2: 401 — fatal on the FIRST provider request, one report', async (t) => {
  const ws = freshWs('c401');
  try {
    const r = await drive({
      model: 'auth-401',
      steps: [hStatus(401, 'Invalid API key')],
      ws,
    });
    const errs = ev(r.io, 'error');
    t.diagnostic(`401: requests=${r.requests.length} errors=${errs.length} reports=${reports(r.io).length} outcome=${reports(r.io)[0]?.outcome}`);
    assert.equal(r.requests.length, 1, '401: EXACTLY ONE provider request (no retry, no failover)');
    assert.equal(errs.length, 1, '401: one error row');
    assert.match(errs[0]?.message ?? '', /401|invalid api key/i, '401: key-classified message');
    assert.equal(reports(r.io).length, 1, '401: one report');
    assert.equal(reports(r.io)[0]?.outcome, 'error', '401: report = error');
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ============================================================
// D. Long task: 429s interleaved with tool chains until USER abort.
// ============================================================
test('D: interleaved 429s + two tool chains continue until user abort — no duplicate tools, honest aborted report', async (t) => {
  const ws = freshWs('d');
  try {
    let abortFired = false;
    const r = await drive({
      model: 'long-task',
      steps: [
        h429(),
        h429(),
        hTool('write_file', { path: 'a.txt', content: 'ALPHA' }, 'long_c1'),
        h429(),
        h429(),
        hTool('write_file', { path: 'b.txt', content: 'BETA' }, 'long_c2'),
        h429(),
        h429(),
        hText('FINAL LONG ANSWER — should be interrupted by the user.'),
      ],
      ws,
      // Abort on the FIRST answer delta of the final turn — by then both tool
      // chains already ran THROUGH the two 429 bursts.
      abortWhen: (e) => e.type === 'text_delta',
      timeoutMs: 25_000,
    });
    abortFired = r.io.controller.signal.aborted;
    const starts = toolStarts(r.io);
    const results = toolResults(r.io);
    const rep = reports(r.io);
    const rNotices = rateNotices(r.io);
    t.diagnostic(
      `long: requests=${r.requests.length} duration=${r.durationMs}ms toolStarts=${starts.map((s) => s.toolCallId).join(',')} ` +
        `toolResults=${results.length} aborted=${ev(r.io, 'aborted').length} reports=${rep.length} outcome=${rep[0]?.outcome} ` +
        `rateNotices=${rNotices.length} failoverNotices=${failoverNotices(r.io).length} errors=${ev(r.io, 'error').length} abortedByUser=${abortFired}`,
    );

    assert.ok(abortFired, 'user abort actually fired');
    assert.equal(r.requests.length, 9, '6 interleaved 429s + 3 successful turns, ALL reached before abort');
    assert.deepEqual(
      starts.map((s) => s.toolCallId),
      ['long_c1', 'long_c2'],
      'each tool executed EXACTLY once, in order — 429 recovery never re-executed a tool',
    );
    assert.equal(results.length, 2, 'exactly two tool results');
    assert.ok(results.every((x) => x.ok), 'both tool results ok');
    assert.equal(readFileSync(join(ws, 'a.txt'), 'utf8'), 'ALPHA', 'first file written once');
    assert.equal(readFileSync(join(ws, 'b.txt'), 'utf8'), 'BETA', 'second file written once');
    assert.equal(ev(r.io, 'aborted').length, 1, 'one aborted event');
    assert.equal(rep.length, 1, 'EXACTLY one written report on abort');
    assert.equal(rep[0]?.outcome, 'aborted', 'report honestly says aborted');
    assert.equal(ev(r.io, 'error').length, 0, 'no error row — the user stopped it, the provider did not fail');
    assert.equal(rNotices.length, 1, 'ONE quiet 429 notice for the whole run (deduped across 3 episodes)');
    assert.equal(failoverNotices(r.io).length, 0, 'NO auto-switch across the whole long task');
    assert.ok(
      r.requests.every((q) => q.model === 'long-task'),
      'every request stayed on the user-chosen model',
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

// ============================================================
// Unit sanity on the new env knobs (documents the intended bounds).
// ============================================================
test('E: v11.27 knobs are env-tunable and bounded', () => {
  process.env.SURNIA_RATE_LIMIT_MAX_ATTEMPTS = '8';
  assert.equal(providers.rateLimitMaxAttempts(), 8);
  process.env.SURNIA_RATE_LIMIT_MAX_ATTEMPTS = '999';
  assert.equal(providers.rateLimitMaxAttempts(), 50, 'attempt count hard-capped at 50');
  process.env.SURNIA_RATE_LIMIT_MAX_ATTEMPTS = '0';
  assert.equal(providers.rateLimitMaxAttempts(), 1, 'attempt count floored at 1');
  process.env.SURNIA_RATE_LIMIT_MAX_ATTEMPTS = '8';
  process.env.SURNIA_RATE_LIMIT_BUDGET_MS = '5000';
  assert.equal(providers.rateLimitBudgetMs(), 5000);
  process.env.SURNIA_RATE_LIMIT_BUDGET_MS = '60000';
});

test('cleanup', () => {
  for (const k of [
    'SURNIA_TURN_RETRY_DELAYS_MS',
    'SURNIA_RATE_LIMIT_MAX_ATTEMPTS',
    'SURNIA_RATE_LIMIT_BUDGET_MS',
  ]) {
    delete process.env[k];
  }
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
