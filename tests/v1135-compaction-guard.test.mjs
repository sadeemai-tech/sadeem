// ============================================================
// SADEEM v11.35 — COMACTION VERIFICATION GUARD FOR THE FOUNDER'S #1 COMPLAINT
// "يا دوب الذكاء الاصطناعي ما حكى كلمتين الا يلا يروح ضاغط الكونتكست...
//  الكونتكست كومباكشن انه كل شوي بيضغط"
// (barely two words and it compacts; it compacts every little while)
//
// DIAGNOSIS + TEST ONLY — NO application source is modified.
//
// This guard is deliberately NOT just math. It is a REAL-ENGINE harness:
//   * fresh esbuild bundle of the REAL electron/agent/engine.ts
//   * isolated userData directory (SURNIA_HOME + electron stub getPath)
//   * a local scripted OpenAI-compatible provider (ZERO external network)
//   * ~20 short user turns re-sent with FULL history (exactly how store.ts
//     runAgent works: src/store.ts:3976-4019 sends session.messages each turn)
//   * the full system prompt + ALL tool definitions are re-sent every request
//     (electron/agent/providers.ts:1994-2034) and the mock REPORTS that cost
//     as inputTokens — this is the founder's real failure mode.
//
// CHECKS
//   C0  harness sanity: 1M model actually resolves through the REAL engine.
//   C1  NO `compact`/`compaction`/`context_compacted` event in the first 20
//       short turns; measured fill stays < 10% of the 1M window.
//   C2  source-level eval of the engine threshold line with the REAL catalog
//       proves the resolved window is ~1M, NOT 200k.
//   C3  auto-compaction becomes eligible ONLY when fill is pushed to ~90% of
//       1M (real engine run with a 905k provider report).
//   C4  user-facing context telemetry is HONEST (≈, never a false 100% and
//       never "compacted" while there is room).
//   C5  the exact failure mode is seeded: system prompt + full tool defs cost
//       is counted per turn — a 180k/request payload (ABOVE the old broken
//       130k = 65%-of-200k trigger) must still NOT compact on a 1M model.
//   S1  read-only source scan: EVERY compaction trigger site with file:line,
//       flagging any fixed-small threshold / double-count that remains.
//
// Source lines under test (failures are reported with these):
//   electron/agent/engine.ts:32,4847-4861  real-window resolution + threshold
//   electron/agent/engine.ts:5116-5122     auto-compact eligibility gate
//   electron/agent/engine.ts:5123-5279     compaction call + honest pct event
//   electron/agent/engine.ts:5911          lastRealInputTokens = u.inputTokens
//   electron/agent/engine.ts:2541-2572     user /compact path (separate)
//   src/lib/ctx.ts:75-110                  90% ratio / eligibility / honesty
//   src/lib/ctx.ts:36-39,129-140           fill math (no cache double-count)
//   electron/agent/costs.ts:204-330        catalog (1M rows) + 200k fallback
//   electron/agent/providers.ts:1994-2034  system + full tools re-sent per turn
//   src/store.ts:3720-3758,4721,4794       /context readout + event handlers
//
// Run:  node --test --test-force-exit tests/v1135-compaction-guard.test.mjs
// Debug: V1135_DEBUG=1 node --test --test-force-exit tests/v1135-compaction-guard.test.mjs
// ============================================================
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const DEBUG = !!process.env.V1135_DEBUG;
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1135-compaction-'));
const USERDATA = join(tmp, 'userdata');
const WS = join(tmp, 'ws');
for (const d of [USERDATA, WS]) mkdirSync(d, { recursive: true });

process.env.SURNIA_HOME = USERDATA;
process.env.SURNIA_TURN_RETRY_DELAYS_MS = '8,8,8,8';
process.env.SURNIA_DELTA_FLUSH_MS = '20';

const RESULTS = join(ROOT, 'tests', '.v1135-compaction-guard.results.json');
const findings = []; // { id, status, detail, fileLine }
function note(id, status, detail, fileLine) {
  findings.push({ id, status, detail, fileLine });
  console.log(`[${status}] ${id} — ${fileLine} — ${detail}`);
}
async function guard(id, fileLine, fn) {
  try {
    const detail = await fn();
    note(id, 'PASS', detail, fileLine);
  } catch (err) {
    note(id, 'FAIL', err?.message ?? String(err), fileLine);
    throw err;
  }
}
const src = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- electron stub (single instance shared by every bundle) ----------
const STUB_DIR = join(tmp, 'node_modules', 'electron');
mkdirSync(STUB_DIR, { recursive: true });
writeFileSync(join(STUB_DIR, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(STUB_DIR, 'index.js'),
  'const sent = globalThis.__v1135Sent || (globalThis.__v1135Sent = []);\n' +
  'module.exports = {\n' +
  '  app: { getPath: () => ' + JSON.stringify(USERDATA) + ', whenReady: async () => true, isReady: () => true, on() {}, quit() {}, getName: () => \'sadeem-v1135\', getVersion: () => \'0.0.0\' },\n' +
  '  ipcMain: { handle() {}, on() {}, removeAllListeners() {} },\n' +
  '  ipcRenderer: { invoke: async () => ({}), on() {}, send() {} },\n' +
  '  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (ch, payload) => sent.push({ ch, payload }) } }] },\n' +
  '  Notification: { isSupported: () => false },\n' +
  '  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },\n' +
  '  shell: {}, screen: {}, powerMonitor: { on() {} }, clipboard: { readText: () => \'\', writeText() {} },\n' +
  '  Menu: { buildFromTemplate: () => ({}) }, nativeImage: { createEmpty: () => ({}) }, dialog: {},\n' +
  '};\nmodule.exports.default = module.exports;\n',
);
globalThis.__v1135Sent = [];

// ---------- FRESH bundles of the CURRENT source ----------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${out}`, '--external:electron', '--external:@xterm/xterm',
    '--external:@xterm/addon-fit', '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}
const B = {};
let engine, costs, ctx;
try {
  for (const [name, entry] of Object.entries({
    engine: 'electron/agent/engine.ts',
    costs: 'electron/agent/costs.ts',
    ctx: 'src/lib/ctx.ts',
  })) {
    B[name] = join(tmp, `${name}.cjs`);
    bundle(entry, B[name]);
  }
  if (DEBUG) {
    // Diagnostic-only instrumentation of the BUNDLE (never the app source).
    let s = readFileSync(B.engine, 'utf8');
    const needle = 'const realTokenTrigger = isCompactionEligible(lastRealInputTokens, ctxWindowTokens);';
    if (s.includes(needle)) {
      s = s.replace(needle, needle +
        '\n console.error("[v1135-engine] GATE", JSON.stringify({lastRealInputTokens, ctxWindowTokens, msgLen: messages.length, auto: cfg.autoCompact, thr: compactTokenThreshold, elig: isCompactionEligible(lastRealInputTokens, ctxWindowTokens)}));');
      writeFileSync(B.engine, s);
    }
  }
  engine = require(B.engine);
  costs = require(B.costs);
  ctx = require(B.ctx);
} catch (err) {
  console.error('[v1135] BUNDLE FAILED — the compaction path cannot be verified at all:', err?.message ?? err);
  throw err;
}

// The founder's model: a 1M-context model id the REAL catalog knows.
const MODEL_1M = 'claude-sonnet-5.5';
const WINDOW_1M = 1_000_000;
const ANSWER = 'Done — noted.';
const SHORT_TURNS = [
  'ok', 'and?', 'continue', 'yes', 'what next', 'good',
  'more', 'thanks', 'again', 'now what', 'fine', 'go on',
  'short one', 'keep going', 'yep', 'next step', 'ok thanks', 'still there', 'carry on', 'done?',
];

// ---------- local scripted OpenAI-compatible provider (ZERO network) ----------
const sseHeaders = (res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  res.flushHeaders();
};
const chunk = (delta, finish = null, usage = null) => {
  const o = { id: 'v1135', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] };
  if (usage) o.usage = usage;
  return `data: ${JSON.stringify(o)}\n\n`;
};
function startMock(scriptFn) {
  const requests = [];
  const sockets = new Set();
  let n = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      const sys = (body.messages ?? [])
        .filter((m) => m && m.role === 'system')
        .map((m) => {
          if (typeof m.content === 'string') return m.content;
          if (Array.isArray(m.content)) return m.content.map((p) => p?.text ?? '').join('');
          return '';
        })
        .join('\n');
      // Anchor to the START of the system text. The MAIN system prompt also
      // mentions DNA / Living Playbook / project memory further down, so a
      // substring match would misclassify every main request after a compaction
      // seeds cumulative memory (that bug bit the harness, not the engine).
      const headSys = sys.trimStart().slice(0, 240);
      const isCompaction = /^You compact coding-agent transcripts/i.test(headSys);
      const isLearner = /^(You maintain the Surnia DNA user model|You maintain the SADEEM Living Playbook|You extract durable engineering facts for a project memory file)/i.test(headSys);
      const d = {
        index: ++n, body, sys, isCompaction, isLearner, isMain: !isCompaction && !isLearner,
        tools: body.tools ?? [], at: Date.now(),
      };
      requests.push(d);
      const script = scriptFn(d) ?? { kind: 'answer', text: ANSWER };
      d.reportedTokens = script.tokens ?? 0;
      sseHeaders(res);
      try {
        if (script.kind === 'empty') {
          res.write(chunk({}, 'stop'));
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        if (script.kind === 'tool') {
          res.write(chunk({
            tool_calls: [{
              index: 0, id: 'call_' + d.index, type: 'function',
              function: { name: script.name ?? 'sys_info', arguments: JSON.stringify(script.args ?? {}) },
            }],
          }));
          res.write(chunk({}, 'tool_calls'));
          if (!script.noUsage) {
            res.write(chunk({}, null, {
              prompt_tokens: script.tokens ?? 0, completion_tokens: script.outTokens ?? 12,
            }));
          }
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        if (script.text) res.write(chunk({ content: script.text }));
        res.write(chunk({}, 'stop'));
        if (!script.noUsage) {
          res.write(chunk({}, null, {
            prompt_tokens: script.tokens ?? 0, completion_tokens: script.outTokens ?? 18,
          }));
        }
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (err) {
        if (DEBUG) console.error('[v1135] mock write error:', err?.message ?? err);
        try { res.end(); } catch { /* ignore */ }
      }
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      requests,
      port: server.address().port,
      async stop() {
        for (const s of sockets) s.destroy();
        await new Promise((r) => server.close(r));
      },
    }));
  });
}

/** A script that re-sends the system+tools cost each turn, then answers. */
function makeScript({ overheadTokens, answerTokens = 18, noUsage = false }) {
  let mainCount = 0;
  return (d) => {
    if (d.isCompaction) return { kind: 'answer', text: 'SUMMARY: task + decisions preserved.', tokens: 900, noUsage };
    if (d.isLearner) return { kind: 'empty' };
    const k = ++mainCount;
    // Turn shape: request#1 = harmless tool call (reports the full system+tools
    // token cost); request#2 = the short final answer containing the tool result.
    if (k % 2 === 1) {
      return { kind: 'tool', name: 'sys_info', args: {}, tokens: overheadTokens, outTokens: 12, noUsage };
    }
    return { kind: 'answer', text: ANSWER, tokens: overheadTokens, outTokens: answerTokens, noUsage };
  };
}

function writeSettings(baseUrl, autoCompact = true, compactThreshold = undefined) {
  writeFileSync(
    join(USERDATA, 'settings.json'),
    JSON.stringify({
      schemaVersion: 4,
      dnaEnabled: false,
      providers: { custom: { apiKey: 'test-key', baseUrl } },
      agent: {
        maxRetries: 0, autoCompact, autoVerify: false,
        selfCritique: false, runAndShow: false, claimAudit: false, goalVerifier: false,
        // When omitted, storeService merges the app default 120,000 chars. The
        // guard's regression check (C6) sets it explicitly to model that default.
        ...(compactThreshold === undefined ? {} : { compactThreshold }),
      },
      doneNotifications: false,
    }),
  );
}
function makeIo(events) {
  return {
    events,
    send(e) {
      events.push({
        type: e.type, reason: e.reason, kind: e.kind, before: e.before, after: e.after,
        inputTokens: e.usage?.inputTokens, outputTokens: e.usage?.outputTokens,
        text: e.text ?? e.message ?? '',
      });
    },
    async getDecision(requestId) { return { requestId, action: 'allow' }; },
    isAborted: () => false,
    onFetchSignal() {},
  };
}
/** Drive N REAL user turns, each re-sent with the full history (store.ts model). */
async function driveTurns(mock, {
  turns, label, autoCompact = true, seedHistory = 0, seedChars = 20_000, compactThreshold = undefined,
}) {
  const events = [];
  const io = makeIo(events);
  const baseUrl = `http://127.0.0.1:${mock.port}/v1`;
  writeSettings(baseUrl, autoCompact, compactThreshold);
  const history = [];
  // Optional large pre-existing transcript: needed to force the verbatim-tail
  // selection (35% of the 90% threshold ≈ 1.26M chars on a 1M model) to leave
  // at least 2 messages in `head` so the REAL compaction model call is made.
  for (let s = 0; s < seedHistory; s++) {
    const filler = '[prior context ' + s + '] ' + 'abcdefghij'.repeat(Math.ceil(seedChars / 10));
    history.push({
      id: `seed-u-${s}`, role: 'user', kind: 'text',
      content: filler.slice(0, seedChars), timestamp: Date.now(),
    });
    history.push({
      id: `seed-a-${s}`, role: 'assistant', kind: 'text',
      content: ('ACK prior context ' + s + ' ').repeat(Math.ceil(seedChars / 20)).slice(0, seedChars),
      timestamp: Date.now(),
    });
  }
  const sessionId = 'v1135-' + label + '-' + Math.random().toString(36).slice(2);
  for (let i = 0; i < turns; i++) {
    history.push({
      id: `u-${label}-${i}`, role: 'user', kind: 'text',
      content: SHORT_TURNS[i % SHORT_TURNS.length], timestamp: Date.now(),
    });
    await engine.runAgent(
      {
        task: 'chat', sessionId,
        messages: history.map((m) => ({ ...m })),
        model: { provider: 'custom', model: MODEL_1M, maxTokens: 2048 },
        mode: 'fullAccess', workspace: WS, apiKey: 'test-key', baseUrl,
      },
      io,
    );
    history.push({
      id: `a-${label}-${i}`, role: 'assistant', kind: 'text', content: ANSWER, timestamp: Date.now(),
    });
  }
  return { events, history };
}
const COMPACT_EVENTS = new Set(['compact', 'compaction', 'compaction_done', 'context_compacted']);
function compactionEvents(events) {
  return events.filter((e) => COMPACT_EVENTS.has(e.type));
}
function mainRequests(mock) {
  return mock.requests.filter((r) => r.isMain);
}
function maxReportedTokens(mock) {
  return mainRequests(mock).reduce((m, r) => Math.max(m, r.reportedTokens ?? 0), 0);
}

// ============================================================
// C0 — harness sanity: the REAL engine resolves the 1M model
// ============================================================
test('C0 · harness sanity — real engine runs against the local provider', async () => {
  await guard('C0-harness', 'electron/agent/engine.ts:4866-4872; electron/agent/costs.ts:204-330', async () => {
    assert.equal(costs.contextWindowInfo(MODEL_1M).ctx, WINDOW_1M,
      `FAIL electron/agent/costs.ts:206-213 — ${MODEL_1M} must be a 1M catalog row`);
    assert.equal(costs.contextWindowInfo(MODEL_1M).estimated, false,
      'FAIL electron/agent/costs.ts:324-330 — a catalog hit must not be flagged as an estimated 200k window');
    const mock = await startMock(makeScript({ overheadTokens: 40_000 }));
    try {
      const { events } = await driveTurns(mock, { turns: 1, label: 'sanity' });
      assert.ok(events.some((e) => e.type === 'message_end'), 'no message_end event — the engine never completed a turn');
      assert.ok(mainRequests(mock).length >= 2, 'the harness must observe at least one tool step + one answer step');
      if (DEBUG) console.error('[v1135] C0 main requests:', mainRequests(mock).length);
      return `real engine + local provider OK; catalog ${MODEL_1M}=${WINDOW_1M}; ${mainRequests(mock).length} main requests`;
    } finally {
      await mock.stop();
    }
  });
});

// ============================================================
// C1 — 20 short turns: NO compaction, fill < 10% of 1M
// ============================================================
test('C1 · first 20 short turns fire NO compaction and stay under 10% fill', async () => {
  await guard('C1-no-compact-20', 'electron/agent/engine.ts:5116-5122,5886; src/lib/ctx.ts:88-92', async () => {
    const TURNS = 20;
    const OVERHEAD = 40_000; // realistic system prompt + full tool defs + short history
    const mock = await startMock(makeScript({ overheadTokens: OVERHEAD }));
    try {
      const { events } = await driveTurns(mock, { turns: TURNS, label: 'twenty' });
      const bad = compactionEvents(events);
      assert.equal(bad.length, 0,
        'FAIL electron/agent/engine.ts:5116-5122 — auto-compaction fired within the first ' + TURNS +
        ' short turns (found: ' + JSON.stringify(bad.slice(0, 5)) + '). The founder\'s complaint REPRODUCES.');
      const maxTokens = maxReportedTokens(mock);
      const fillPct = (maxTokens / WINDOW_1M) * 100;
      assert.ok(fillPct < 10,
        `FAIL — measured fill ${fillPct.toFixed(1)}% (>=10%) of the 1M window after ${TURNS} short turns`);
      assert.ok(!events.some((e) => e.type === 'sys_notice' && /compact/i.test(e.text ?? '')),
        'FAIL electron/agent/engine.ts:5259,5265 — a compaction notice leaked to the user with room to spare');
      return `${TURNS} short turns, 0 compaction events, max reported fill ${maxTokens.toLocaleString()}/${WINDOW_1M.toLocaleString()} = ${fillPct.toFixed(1)}%`;
    } finally {
      await mock.stop();
    }
  });
});

// ============================================================
// C2 — source-level eval of the engine threshold line with the REAL catalog
// ============================================================
test('C2 · engine resolves ~1M (not 200k) — eval of the REAL threshold lines', async () => {
  await guard('C2-window-1m', 'electron/agent/engine.ts:4866-4872; src/lib/ctx.ts:82-92; electron/agent/costs.ts:204-330', () => {
    const ENGINE_SRC = src('electron/agent/engine.ts');
    const CTX_SRC = src('src/lib/ctx.ts');

    // 1) Eval the engine's ACTUAL window-resolution lines with the real catalog.
    const lines = ENGINE_SRC.split(/\r?\n/);
    const winIdx = lines.findIndex((l) => /const ctxWindowTokens\s*=/.test(l));
    assert.ok(winIdx >= 2, 'FAIL electron/agent/engine.ts:4856 — window resolution line not found');
    const snippet = lines.slice(winIdx - 2, winIdx + 1).join('\n');
    assert.match(snippet, /reportedCtx\s*\?\?\s*catalogCtx\.ctx/,
      'FAIL electron/agent/engine.ts:4856 — provider/catalog fallback was replaced by a hard-coded window');
    const resolveWin = new Function('openrouterContextFor', 'contextWindowInfo', 'params',
      `${snippet}\nreturn ctxWindowTokens;`);
    const cold = resolveWin(() => null, costs.contextWindowInfo, { model: { model: MODEL_1M } });
    assert.equal(cold, WINDOW_1M,
      `FAIL electron/agent/engine.ts:4866-4868 — engine resolved ${cold}, expected the 1M catalog row ${WINDOW_1M}`);
    const reported = resolveWin(() => 983_041, costs.contextWindowInfo, { model: { model: 'vendor/unknown' } });
    assert.equal(reported, 983_041,
      'FAIL electron/agent/engine.ts:4866-4868 — a provider-reported window must beat the 200k fallback');

    // 2) Eval the engine's ACTUAL threshold line with the REAL helper.
    const thrIdx = lines.findIndex((l) => /const compactTokenThreshold\s*=/.test(l));
    assert.ok(thrIdx >= 0, 'FAIL electron/agent/engine.ts:4860 — threshold line not found');
    const thrLine = lines[thrIdx].trim();
    assert.match(thrLine, /compactionThresholdTokens\(ctxWindowTokens\)/,
      'FAIL electron/agent/engine.ts:4860 — threshold no longer uses the real window helper');
    const evalThreshold = new Function('ctxWindowTokens', 'compactionThresholdTokens',
      `${thrLine}\nreturn compactTokenThreshold;`);
    const threshold = evalThreshold(WINDOW_1M, ctx.compactionThresholdTokens);
    assert.equal(threshold, 900_000,
      `FAIL electron/agent/engine.ts:4860 / src/lib/ctx.ts:82-85 — threshold ${threshold}, expected 900000 (90% of 1M)`);

    // 3) The trigger gate must call the helper with the provider's real input tokens.
    assert.match(ENGINE_SRC, /const realTokenTrigger\s*=\s*isCompactionEligible\(lastRealInputTokens, ctxWindowTokens\)/,
      'FAIL electron/agent/engine.ts:5099 — trigger no longer calls isCompactionEligible with the real window');
    assert.match(ENGINE_SRC, /lastRealInputTokens\s*=\s*u\.inputTokens/,
      'FAIL electron/agent/engine.ts:5911 — trigger is not fed the provider input tokens');
    assert.match(CTX_SRC, /COMPACT_TRIGGER_RATIO\s*=\s*0\.9\b|COMPACT_TRIGGER_RATIO\s*=\s*0\.90\b/,
      'FAIL src/lib/ctx.ts:76 — trigger ratio is not 90%');

    // 4) No fixed-small threshold / 65% trigger survives in the live code.
    for (const rel of ['electron/agent/engine.ts', 'src/lib/ctx.ts', 'src/store.ts']) {
      let lineNo = 0;
      for (const line of src(rel).split(/\r?\n/)) {
        lineNo += 1;
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        if (/\b0\.65\b|\b65\s*%|\b130_?000\b/.test(code)) {
          throw new Error(`FAIL ${rel}:${lineNo} — a fixed 65% / 130k compaction threshold is still LIVE: ${line.trim()}`);
        }
      }
    }
    return `real-line eval: window=${cold}, threshold=${threshold} (90% of 1M); no 65%/130k trigger in live code`;
  });
});

// ============================================================
// C3 — ~90% fill DOES make auto-compaction eligible (real engine run)
// ============================================================
test('C3 · auto-compaction fires ONLY when fill is pushed to ~90% of 1M', async () => {
  await guard('C3-90pct-trigger', 'electron/agent/engine.ts:5116-5122,5174-5259; src/lib/ctx.ts:88-92', async () => {
    // Pure math first (the real helper).
    assert.equal(ctx.isCompactionEligible(OVERHEAD_SAFE(), WINDOW_1M), false);
    assert.equal(ctx.isCompactionEligible(899_999, WINDOW_1M), false, 'FAIL src/lib/ctx.ts:88-92 — just below 90% must NOT compact');
    assert.equal(ctx.isCompactionEligible(900_000, WINDOW_1M), true, 'FAIL src/lib/ctx.ts:88-92 — 90% must be eligible');
    assert.equal(ctx.isCompactionEligible(905_000, 0), false, 'FAIL — unknown window must never auto-compact');

    const mock = await startMock(makeScript({ overheadTokens: 905_000 })); // 90.5% of 1M
    try {
      // Seed ~1.44M chars so the verbatim tail (35% of the 90% threshold ≈
      // 1.26M chars) cannot swallow the whole transcript: head.length >= 2,
      // so the REAL no-tools compaction model call executes.
      const { events } = await driveTurns(mock, {
        turns: 1, label: 'ninety', seedHistory: 36, seedChars: 20_000,
      });
      if (DEBUG) {
        console.error('[v1135] C3 events:', events.map((e) => `${e.type}:${e.kind ?? e.reason ?? ''}(in=${e.inputTokens},before=${e.before},after=${e.after},text=${String(e.text).slice(0, 80)})`).join(' | '));
        console.error('[v1135] C3 requests:', mock.requests.map((r) => `${r.index}:${r.isCompaction ? 'compact' : r.isLearner ? 'learn' : 'main'}:${r.reportedTokens}`).join(' | '));
      }
      const comps = events.filter((e) => e.type === 'compaction');
      assert.ok(comps.length >= 1,
        'FAIL electron/agent/engine.ts:5116-5122 — a 905k/1M (90.5%) fill did NOT trigger auto-compaction');
      assert.ok(mock.requests.some((r) => r.isCompaction),
        'FAIL electron/agent/engine.ts:5194 — no real compaction model call was made');
      return `905k/1M (90.5%) triggered ${comps.length} compaction event(s) + a real no-tools compaction call`;
    } finally {
      await mock.stop();
    }
  });
});
function OVERHEAD_SAFE() { return 40_000; }

// ============================================================
// C4 — the user-facing context percentage is HONEST
// ============================================================
test('C4 · context telemetry is honest — never a false 100% / "compacted" with room', async () => {
  await guard('C4-honest-pct', 'src/lib/ctx.ts:36-64,101-110; electron/agent/engine.ts:5123,5257-5259; src/store.ts:3740-3755', () => {
    const usage = { inputTokens: 40_000, outputTokens: 200 };
    const fill = ctx.ctxFillTokens(usage);
    assert.equal(fill, 40_200, 'FAIL src/lib/ctx.ts:36-39 — fill must be input+output of the last request');
    const pct = ctx.ctxPctExact(usage, WINDOW_1M);
    assert.ok(Math.abs(pct - 4.02) < 0.01,
      `FAIL src/lib/ctx.ts:42-45 — 40.2k on 1M must read ≈4.02%, got ${pct}`);
    assert.ok(pct < 100, 'FAIL — a small fill must never clamp to 100%');
    assert.equal(ctx.contextFillPercent(40_200, 0, false), null, 'FAIL src/lib/ctx.ts:101-110 — unknown window must return null, not a fake %');
    assert.equal(ctx.contextFillPercent(40_200, WINDOW_1M, false) < 10, true);

    // No double-count: cache lives INSIDE inputTokens; segments sum to one fill.
    const seg = ctx.occupancySegments({ inputTokens: 40_000, outputTokens: 200, cacheReadTokens: 30_000, cacheCreationTokens: 5_000 });
    assert.equal(
      seg.cacheRead + seg.cacheWrite + seg.fresh + seg.generated + seg.streamed, seg.total,
      'FAIL src/lib/ctx.ts:129-140 — segment double-count: parts must sum to ONE fill',
    );
    assert.equal(seg.fresh, 5_000, 'FAIL src/lib/ctx.ts:129-140 — cache was double-counted outside inputTokens');

    // The engine's compaction % must divide by the real window, not clamp early.
    const ENGINE_SRC = src('electron/agent/engine.ts');
    const pctLine = ENGINE_SRC.match(/const pctBefore\s*=\s*([^;]+);/);
    assert.ok(pctLine && /ctxWindowTokens/.test(pctLine[1]),
      'FAIL electron/agent/engine.ts:5123 — compaction % must divide by the resolved real window');
    assert.match(src('src/store.ts'), /const pct = windowTokens > 0 \? Math\.min\(100, \(fill \/ windowTokens\) \* 100\) : 0/,
      'FAIL src/store.ts:3740 — /context pct must use the real window');
    return `honest fill: 40,200 tok → ${pct.toFixed(2)}% of 1M; segments sum to one fill; no false 100%`;
  });
});

// ============================================================
// C5 — seed the EXACT founder failure mode: system+tools cost per turn
// ============================================================
test('C5 · 180k/turn system+tools cost (above the old 130k bug line) still does NOT compact', async () => {
  await guard('C5-system-tools-cost',
    'electron/agent/providers.ts:1994-2034; electron/agent/engine.ts:4866-4872,5098-5102; electron/agent/costs.ts:306', async () => {
      // 180,000 tokens per request = full system prompt + ~145 tool definitions
      // + playbook/DNA/memory + short history. The OLD code (200k fallback,
      // 65% trigger = 130k) compacted a 1M model here — "after two words".
      const OVERHEAD = 180_000;
      const mock = await startMock(makeScript({ overheadTokens: OVERHEAD }));
      try {
        const { events } = await driveTurns(mock, { turns: 6, label: 'heavy-sys' });
        const bad = compactionEvents(events);
        assert.equal(bad.length, 0,
          'FAIL — the 180k/turn system+tools cost compacted a 1M model within ' +
          '6 short turns (the founder\'s exact bug REPRODUCES): ' + JSON.stringify(bad.slice(0, 5)));

        // Prove the overhead was REALLY re-sent each turn, not a made-up number.
        const mains = mainRequests(mock);
        if (DEBUG) {
          console.error('[v1135] C5 requests:', mock.requests.map((r) => `${r.index}:${r.isCompaction ? 'compact' : r.isLearner ? 'learn' : 'main'}:${r.reportedTokens}`).join(' | '));
        }
        assert.ok(mains.length >= 6, 'expected at least 6 main-chat requests across 6 turns (got ' + mains.length + ')');
        const withTools = mains.filter((r) => Array.isArray(r.tools) && r.tools.length >= 20);
        const withSystem = mains.filter((r) => r.sys.length > 1_000);
        assert.ok(withTools.length >= mains.length - 1,
          `FAIL electron/agent/providers.ts:2023-2034 — full tool definitions were NOT re-sent each turn (${withTools.length}/${mains.length})`);
        assert.ok(withSystem.length >= mains.length - 1,
          `FAIL electron/agent/prompts.ts — the full system prompt was NOT re-sent each turn (${withSystem.length}/${mains.length})`);
        const reported = maxReportedTokens(mock);
        assert.equal(reported, OVERHEAD, 'FAIL — mock token report was not carried by the engine');
        assert.equal(costs.contextWindowInfo('totally-unknown-model-x').ctx, 200_000,
          'FAIL electron/agent/costs.ts:306 — the honest 200k default must still exist for UNKNOWN ids only');
        assert.equal(ctx.isCompactionEligible(OVERHEAD, WINDOW_1M), false,
          'FAIL src/lib/ctx.ts:88-92 — 180k on a 1M window must be ineligible');
        assert.equal(ctx.isCompactionEligible(OVERHEAD, 200_000), true,
          'FAIL — the old 200k window WOULD have compacted at 180k (>130k): this is the seed of the founder bug');

        const maxTools = Math.max(...mains.map((r) => r.tools.length));
        return `6 turns × ${OVERHEAD.toLocaleString()} tok system+tools (${maxTools} tool defs re-sent/turn); ` +
          '0 compaction; old 200k/65%=130k would have fired — real 1M/90% does not';
      } finally {
        await mock.stop();
      }
    });
});

// ============================================================
// C6 — the EXACT regression: default 120k-char compactThreshold + no provider
//      usage must NOT compact a 1M model (this is what C1 removed)
// ============================================================
test('C6 · no-usage provider + 120k default threshold must NOT compact a 1M model', async () => {
  await guard('C6-no-usage-120k',
    'electron/agent/engine.ts:5104-5122 (legacyCharsCap/charactersTrigger removed); src/components/settings/AgentSection.tsx:83', async () => {
      // The real default (AgentSection.tsx:83) is compactThreshold = 120,000
      // chars. Before C1 the engine OR'd a fixed small-count path:
      //   charsTrigger = lastRealInputTokens === 0 && transcript.chars >= 120,000
      // OpenAI-compatible/local providers often report NO usage, so
      // lastRealInputTokens stayed 0 and a 1M model compacted at ~30k tokens
      // (3% of its window) — literally "barely two words → compressor".
      const DEFAULT_COMPACT_CHARS = 120_000;
      const mock = await startMock(makeScript({ overheadTokens: 0, noUsage: true }));
      try {
        const { events } = await driveTurns(mock, {
          turns: 1, label: 'no-usage',
          compactThreshold: DEFAULT_COMPACT_CHARS,
          // ~160k chars: ABOVE the old 120k fixed trigger, FAR BELOW the
          // honest 90%-of-1M fallback (3.6M chars).
          seedHistory: 40, seedChars: 4_000,
        });
        const bad = compactionEvents(events);
        assert.equal(bad.length, 0,
          'FAIL electron/agent/engine.ts:5104-5122 — the fixed 120k-char charsTrigger still fires on a ' +
          '1M model when the provider reports no usage (the founder\'s bug REPRODUCES): ' +
          JSON.stringify(bad.slice(0, 5)));
        const notices = events.filter((e) => e.type === 'sys_notice' && e.kind === 'compact');
        assert.equal(notices.length, 0,
          'FAIL electron/agent/engine.ts — a compaction notice leaked with a 1M window and ~3% fill');

        // Source-level: the fixed small-count path must be gone for good.
        const ENGINE_SRC = src('electron/agent/engine.ts');
        // C1 documents the removed expression in a comment — strip comments
        // so this asserts on LIVE code only.
        const ENGINE_LIVE = ENGINE_SRC.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
        assert.doesNotMatch(ENGINE_LIVE, /legacyCharsCap|Math\.min\(cfg\.compactThreshold/,
          'FAIL electron/agent/engine.ts:5108 — the fixed 10k–120k chars fallback is still wired into the trigger');
        assert.match(ENGINE_SRC, /windowCharsCap\s*=\s*Math\.floor\(compactTokenThreshold\s*\*\s*CHARS_PER_TOKEN\)/,
          'FAIL electron/agent/engine.ts:5120 — the only chars fallback must be derived from the REAL window');
        const seedCharsUsed = mainRequests(mock).reduce((m, r) => Math.max(m, r.sys.length), 0);
        return `provider reported NO usage; transcript >120k chars; real 1M/90% gate => 0 compaction ` +
          `(system prompt chars observed ${seedCharsUsed})`;
      } finally {
        await mock.stop();
      }
    });
});

// ============================================================
// S1 — read-only source scan of EVERY compaction trigger site
// ============================================================
test('S1 · source scan — every compaction trigger site with file:line', async () => {
  await guard('S1-source-scan', 'electron/agent/engine.ts; src/lib/ctx.ts; src/store.ts', () => {
    const sites = [
      'electron/agent/engine.ts:2541-2572  USER /compact path (single no-tools call; not auto-gated)',
      'electron/agent/engine.ts:4847-4861  real-window resolution (provider → catalog → 200k) + 90% threshold',
      'electron/agent/engine.ts:5063-5066  context hygiene (tool-result pruning) BEFORE the compaction check',
      'electron/agent/engine.ts:5116-5122  AUTO-COMPACT GATE: isCompactionEligible(lastRealInputTokens, ctxWindowTokens) || charsTrigger',
      'electron/agent/engine.ts:5108      window-derived chars fallback ONLY (legacy compactThreshold cap removed)',
      'electron/agent/engine.ts:5123-5147  pctBefore + verbatim tail selection at the trigger',
      'electron/agent/engine.ts:5194-5279  real no-tools compaction call + honest compaction{before,after} event',
      'electron/agent/engine.ts:5911       lastRealInputTokens = u.inputTokens (feeds the gate; uses provider INPUT only, NOT input+output — no double count)',
      'src/lib/ctx.ts:75-92               COMPACT_TRIGGER_RATIO=0.9, compactionThresholdTokens(), isCompactionEligible()',
      'src/lib/ctx.ts:101-110             contextFillPercent() — null for unknown/outgrown window (no false 100%)',
      'src/lib/ctx.ts:129-140             occupancySegments() — disjoint segments; fixes the old cache+generated double count',
      'electron/agent/costs.ts:204-330    CONTEXT_WINDOWS (1M rows) + 200k fallback for unknown ids only',
      'electron/agent/providers.ts:1994-2034  system prompt + full tool defs re-sent on EVERY request (the "cost" seed)',
      'src/store.ts:3720-3758           /context readout: fill/lastTurnUsage ÷ real window, isCompactionEligible advisory',
      'src/store.ts:4721,4794            compaction / compaction_done event handlers (renderer rows)',
      'electron/agent/vibeFlow.ts:475-565  advisory contextBudget (pure, no trigger)',
    ];
    findings.push({
      id: 'S1-sites', status: 'INFO',
      detail: sites.join(' | '),
      fileLine: 'read-only scan',
    });
    // No LIVE fixed-small threshold / double-count (comments are allowed).
    const liveOffenders = [];
    for (const rel of [
      'electron/agent/engine.ts', 'src/lib/ctx.ts', 'src/store.ts',
      'electron/agent/costs.ts', 'electron/agent/compaction.ts',
    ]) {
      let lineNo = 0;
      for (const line of src(rel).split(/\r?\n/)) {
        lineNo += 1;
        const code = line.replace(/\/\/.*$/, '');
        if (/\b0\.65\b|\b130_?000\b|\bfill\s*\+\s*(generated|outputTokens)\b/.test(code)) {
          liveOffenders.push(`${rel}:${lineNo}: ${line.trim()}`);
        }
      }
    }
    assert.deepEqual(liveOffenders, [],
      'FAIL — a fixed-small threshold or context double-count is LIVE in:\n' + liveOffenders.join('\n'));
    return `${sites.length} trigger sites enumerated; 0 live fixed-small thresholds / double-counts`;
  });
});

// ============================================================
// EVIDENCE + CLEANUP
// ============================================================
test('write evidence + cleanup', () => {
  const byId = (id) => findings.find((f) => f.id === id)?.status ?? 'MISSING';
  const summary = {
    generatedAt: new Date().toISOString(),
    verdict: findings.every((f) => f.status !== 'FAIL') ? 'ALL-GUARDS-PASS' : 'FAILURES-PRESENT',
    complaint: 'compacts after two words / constantly (founder #1)',
    model: MODEL_1M,
    window: WINDOW_1M,
    guards: {
      C0_harness: byId('C0-harness'),
      C1_no_compact_20: byId('C1-no-compact-20'),
      C2_window_1m: byId('C2-window-1m'),
      C3_90pct_trigger: byId('C3-90pct-trigger'),
      C4_honest_pct: byId('C4-honest-pct'),
      C5_system_tools_cost: byId('C5-system-tools-cost'),
      C6_no_usage_120k: byId('C6-no-usage-120k'),
      S1_source_scan: byId('S1-source-scan'),
    },
    findings,
  };
  writeFileSync(RESULTS, JSON.stringify(summary, null, 2));
  console.log(`V1135-COMPACTION-VERDICT: ${summary.verdict} ` + JSON.stringify(summary.guards));
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  assert.ok(findings.length >= 9, 'all guards must have run');
});
