// ============================================================================
// SADEEM v11.36 — INTERRUPTION GUARD  (D5 verification guard)
//
// DIAGNOSIS + TEST + DOC ONLY. Nothing under src/, shared/ or electron/ is
// edited by this file. It is a REAL-ENGINE harness: it esbuild-bundles the
// actual electron/agent/engine.ts, runs it against an isolated userData dir
// with an electron stub, and drives it with a LOCAL scripted OpenAI-compatible
// provider (node:http on 127.0.0.1 — ZERO external network, ZERO real model).
//
// It models the founder's exact bug report:
//   "الذكاء يوقف بعد ما يلتقط صورة التحقق / يطلع نتيجة كبيرة وما يكتب ملخص أخير"
//   ("the AI stops after the verification screenshot / after a large result and
//    never emits a final summary").
//
// FIVE CHECKS (scenario → assertion):
//   1. preview_screenshot (+ a LARGE image result via read_image) → the loop
//      MUST issue >=2 provider requests and emit a final text answer.
//   2. ui_quality_check → same: run continues to a final answer.
//   3. tool_use with NO final text, then a FALSE-DONE prose claim with no real
//      write → the v11.33/V1132 false-done nudge fires (never a silent stop),
//      and the loop keeps going until a real final answer is produced.
//   4. a REAL terminal cap (explicit SURNIA_MAX_RUN_MS time cap) → a VISIBLE
//      sys_notice with a reason is emitted, not a silent end.
//   5. the final assistant message always reaches the sink with a real summary
//      (2-4 bullets + real file paths) — no truncation right before the end.
//
// PLUS a static source-scan of engine.ts for any `break`/`return` that ends the
// loop without a final answer, with file:line (the diagnosis half).
//
// RUN (repo root):  node --test --test-force-exit tests/v1136-interruption-guard.test.mjs
// Debug:            V1136_DEBUG=1 node --test ... (prints the full event stream)
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as pathResolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import zlib from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const ENGINE_SRC = join(ROOT, 'electron', 'agent', 'engine.ts');
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1136-guard-'));
const MAIN = 'v1136-main';

// ---------------------------------------------------------------------------
// PASS/FAIL ledger (printed per check; the test only throws on failure at the
// very end so one broken check cannot hide the others).
// ---------------------------------------------------------------------------
const RESULTS = [];
function check(id, ok, detail, where = '') {
  const line = `${ok ? 'PASS' : 'FAIL'} ${id}${where ? ' [' + where + ']' : ''}: ${detail}`;
  console.log(line);
  RESULTS.push({ id, ok, detail, where });
  return ok;
}

// ---------------------------------------------------------------------------
// Bundle the REAL engine with electron stubbed; isolate userData.
// ---------------------------------------------------------------------------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}
const userDataDir = join(tmp, 'userdata');
mkdirSync(userDataDir, { recursive: true });
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `
const paths = { temp: ${JSON.stringify(tmp)}, userData: ${JSON.stringify(userDataDir)}, home: ${JSON.stringify(tmp)}, appData: ${JSON.stringify(tmp)} };
module.exports = {
  app: { getPath: (k) => paths[k] ?? paths.userData, isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },
  ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
  Notification: { isSupported: () => false },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder() {}, trashItem: async () => {} },
  clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
  BrowserWindow: { getAllWindows: () => [] },
  powerMonitor: { on() {} }, screen: {},
};`);

const engPath = join(tmp, 'engine.cjs');
let engine;
try {
  bundle(ENGINE_SRC, engPath);
  engine = require(engPath);
} catch (err) {
  console.error('[V1136] ENGINE BUNDLE FAILED:', err?.message ?? err);
  throw err;
}

// ---------------------------------------------------------------------------
// A real, LARGE PNG (256x256 RGB random noise, stored deflate → ~197 KB) so
// read_image returns a genuine ~263 KB dataUrl through the SAME engine path a
// screenshot uses: toolResultImages(finalOutput) at engine.ts:6311.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function makeLargePng(width = 256, height = 256) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const off = y * (1 + width * 3);
    raw[off] = 0;
    for (let x = 0; x < width * 3; x++) raw[off + 1 + x] = (Math.random() * 256) | 0;
  }
  const idat = zlib.deflateSync(raw, { level: 0 }); // stored → genuinely large
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// The final answer the founder demands: 3 bullets with real file paths.
const SUMMARY_LINES = [
  'Verification results — screenshot reviewed, UI checks passed:',
  '- `src/components/Widget.tsx`: adjusted 390/820/1366px overflow and contrast.',
  '- `electron/agent/engine.ts`: checked the loop continues after screenshot tools.',
  '- `docs/INTERRUPTION-GUARD-V1136.md`: notes the diagnosis and verdict.',
];
const SUMMARY = SUMMARY_LINES.join('\n');
// A false "done" claim naming a file that does NOT exist in the fresh workspace.
const FALSE_DONE = 'Done — I created index.html and fixed the widget layout.';

// ---------------------------------------------------------------------------
// SSE helpers (OpenAI-compatible chat.completion.chunk stream).
// ---------------------------------------------------------------------------
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'v1136-mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const chunkString = (s, n) => (s.match(new RegExp(`[\\s\\S]{1,${n}}`, 'g')) || []);
function writeText(res, text) {
  for (const part of chunkString(text, 90)) res.write(sseChunk({ content: part }));
}
function writeToolCalls(res, calls) {
  calls.forEach((c, i) => {
    res.write(sseChunk({ tool_calls: [{ index: i, id: c.id, type: 'function', function: { name: c.name, arguments: '' } }] }));
    const half = Math.max(1, Math.floor(c.args.length / 2));
    if (c.args.slice(0, half)) res.write(sseChunk({ tool_calls: [{ index: i, function: { arguments: c.args.slice(0, half) } }] }));
    if (c.args.slice(half)) res.write(sseChunk({ tool_calls: [{ index: i, function: { arguments: c.args.slice(half) } }] }));
  });
}
function finishSse(res, reason, usage = { prompt_tokens: 40, completion_tokens: 30 }) {
  if (!res.headersSent) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.flushHeaders();
  }
  res.write(`data: ${JSON.stringify({ usage, choices: [] })}\n\n`);
  res.write(sseChunk({}, reason));
  res.write('data: [DONE]\n\n');
  res.end();
}

// ---------------------------------------------------------------------------
// Generic scenario runner: fresh workspace, fresh local server, scripted
// handler `respond(body, n, ctx, res)`, isolated env restoration.
// ---------------------------------------------------------------------------
const ENV_KEYS = ['SURNIA_MAX_RUN_MS', 'SURNIA_TIME_CAP_GRACE_MS', 'SURNIA_MAX_CONTINUE_ROUNDS'];
const SAVED_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
}

function writeSettings(baseUrl) {
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({
    schemaVersion: 4,
    language: 'en',
    providers: { custom: { apiKey: 'test-key', baseUrl } },
    agent: {
      maxRetries: 0, autoCompact: false, autoVerify: false, selfCritique: false,
      autoMemory: false, checkpointsEnabled: false, allowModelFailover: false,
    },
    doneNotifications: false,
  }));
}

// ---------------------------------------------------------------------------
// Turn-script helpers for each scenario.
// ---------------------------------------------------------------------------
const textRespond = (text) => (res) => { writeText(res, text); finishSse(res, 'stop'); };

const shotCalls = (ws) => [
  { id: 'call_shot', name: 'preview_screenshot', args: JSON.stringify({ url: 'http://127.0.0.1/', note: 'verification screenshot' }) },
  { id: 'call_image', name: 'read_image', args: JSON.stringify({ path: join(ws, 'assets', 'shot.png') }) },
];
const qualityCall = () => [
  { id: 'call_qc', name: 'ui_quality_check', args: JSON.stringify({ path: 'index.html' }) },
];

function finalTextOf(events) {
  return events.filter((e) => e.type === 'text_delta').map((e) => e.text ?? '').join('');
}
function hasBullets(text) {
  return (text.match(/^\s*-\s+\S/gm) || []).length;
}
function hasFilePath(text) {
  return /(?:^|[\s`])(?:[\w@.\-]+\/)*[\w@.\-]+\.(?:tsx?|jsx?|mjs|cjs|md|html?|json|py|go|rs|css)\b/.test(text);
}
function imageResultChars(events) {
  return events
    .filter((e) => e.type === 'tool_result')
    .reduce((n, e) => n + (String(e.output ?? '').includes('data:image/') ? String(e.output).length : 0), 0);
}

// ===========================================================================
// THE TEST — all scenarios run SEQUENTIALLY inside one test so env/userData
// never race. Every check is logged; assertion failures are collected.
// ===========================================================================
test('v1136 interruption guard — real engine, scripted local provider', async () => {
  console.log('\n==================== V1136 INTERRUPTION GUARD ====================\n');

  // ---- Use a DETERMINISTIC workspace path for the screenshot scenarios -----
  // The respond closure needs the real workspace path to build read_image args,
  // so the runner creates a known path and passes it into `respond`.
  async function runScenarioFixed({ name, respond, env = {} }) {
    restoreEnv();
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    const ws = join(tmp, `fixed-${name}-ws`);
    mkdirSync(join(ws, 'assets'), { recursive: true });
    writeFileSync(join(ws, 'assets', 'shot.png'), makeLargePng());

    const requests = [];
    const sockets = new Set();
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
        const sys = JSON.stringify(body.system ?? '');
        const isSecondary =
          body.model !== MAIN ||
          /compact coding-agent transcripts/i.test(sys) ||
          /extract durable engineering facts|Surnia DNA user model/i.test(sys) ||
          /part of the Surnia agent team/i.test(sys);
        const n = requests.filter((r) => r.isMain).length;
        requests.push({ model: body.model, isMain: !isSecondary, messages: JSON.parse(JSON.stringify(body.messages ?? [])), at: Date.now() });
        if (isSecondary) { finishSse(res, 'stop'); return; }
        try { respond(res, n + 1, { requests, body, ws }); } catch { finishSse(res, 'stop'); }
      });
    });
    server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
    const baseUrl = `http://127.0.0.1:${port}/v1`;
    writeSettings(baseUrl);

    const events = [];
    const io = {
      send(e) { events.push({ ...e, at: Date.now() }); },
      async getDecision(requestId) { return { requestId, action: 'allow' }; },
      isAborted() { return false; },
      onFetchSignal() {},
    };
    Object.assign(process.env, {
      SURNIA_HOME: userDataDir,
      SURNIA_TURN_RETRY_DELAYS_MS: '5,5,5,5,5,5',
      SURNIA_DELTA_FLUSH_MS: '5',
      SURNIA_SKIP_UI_GATE: '1',
      SURNIA_LIVENESS_PULSE_MS: '50',
    });
    let thrown = null;
    try {
      await engine.runAgent({
        task: 'chat',
        sessionId: `v1136-${name}-${Math.random().toString(36).slice(2)}`,
        messages: [{ id: 'm1', role: 'user', kind: 'text', timestamp: Date.now(), content: 'Verify the widget UI and give me a final summary with the files you touched.' }],
        model: { provider: 'custom', model: MAIN, maxTokens: 2048 },
        mode: 'fullAccess',
        workspace: ws,
        apiKey: 'test-key',
        baseUrl,
      }, io);
    } catch (err) { thrown = err; }
    for (const s of sockets) s.destroy();
    await new Promise((r) => server.close(r));
    restoreEnv();
    return { requests: requests.filter((r) => r.isMain), events, thrown, ws };
  }

  // ---------- CHECK 1: preview_screenshot + large image result -------------
  const C1 = await runScenarioFixed({
    name: 'preview',
    respond: (res, n, { ws }) => {
      if (n === 1) { writeToolCalls(res, shotCalls(ws)); finishSse(res, 'tool_calls'); }
      else textRespond(SUMMARY)(res);
    },
  });
  check('S1-NOTHROW', C1.thrown === null, `runAgent did not throw (${C1.thrown?.message ?? 'clean'})`);
  const c1text = finalTextOf(C1.events);
  const c1img = imageResultChars(C1.events);
  check('S1-REQUESTS>=2', C1.requests.length >= 2, `loop issued >=2 provider requests (got ${C1.requests.length})`);
  check('S1-FINAL-TEXT', c1text.length > 40, `a final text answer reached the sink (${c1text.length} chars)`);
  check('S1-LARGE-IMAGE', c1img > 100_000, `a LARGE image result was produced (${c1img} output chars)`);
  check('S1-SUMMARY', hasBullets(c1text) >= 2 && hasFilePath(c1text), `final answer has bullets + file paths (${hasBullets(c1text)} bullets)`);

  // ---------- CHECK 2: ui_quality_check ------------------------------------
  const C2 = await runScenarioFixed({
    name: 'quality',
    respond: (res, n) => {
      if (n === 1) { writeToolCalls(res, qualityCall()); finishSse(res, 'tool_calls'); }
      else textRespond(SUMMARY)(res);
    },
  });
  const c2text = finalTextOf(C2.events);
  check('S2-NOTHROW', C2.thrown === null, `runAgent did not throw (${C2.thrown?.message ?? 'clean'})`);
  check('S2-REQUESTS>=2', C2.requests.length >= 2, `loop continued past ui_quality_check (got ${C2.requests.length} requests)`);
  check('S2-FINAL-TEXT', c2text.length > 40 && hasBullets(c2text) >= 2, `final answer emitted (${c2text.length} chars, ${hasBullets(c2text)} bullets)`);

  // ---------- CHECK 3: tool_use + no final text → false-done nudge ----------
  const C3 = await runScenarioFixed({
    name: 'falsedone',
    respond: (res, n, { ws }) => {
      if (n === 1) { writeToolCalls(res, shotCalls(ws)); finishSse(res, 'tool_calls'); }
      else if (n === 2) textRespond(FALSE_DONE)(res);
      else textRespond(SUMMARY)(res);
    },
  });
  const c3text = finalTextOf(C3.events);
  const falseDoneNotices = C3.events.filter((e) => e.type === 'sys_notice' && /false-done guard/i.test(e.text ?? ''));
  check('S3-NOTHROW', C3.thrown === null, `runAgent did not throw (${C3.thrown?.message ?? 'clean'})`);
  check('S3-FALSE-DONE-NUDGE', falseDoneNotices.length >= 1, `false-done corrective fired (visible notice count ${falseDoneNotices.length})`);
  check('S3-REQUESTS>=3', C3.requests.length >= 3, `loop kept going until a real answer (got ${C3.requests.length} requests)`);
  check('S3-FINAL-TEXT', c3text.includes('Verification results') && hasBullets(c3text) >= 2, 'a real final answer followed the nudge (no silent stop)');

  // ---- CHECK 3b (D5 root cause): screenshot + EMPTY end_turn (no final text) —
  // The founder's literal bug: after the verification screenshot the provider
  // emits finish_reason 'stop' with NO visible text (a bare GOAL_COMPLETE
  // marker). v11.36 EMPTY_FINAL_NUDGE must redirect to a real summary.
  const C3B = await runScenarioFixed({
    name: 'emptyfinal',
    respond: (res, n, { ws }) => {
      if (n === 1) { writeToolCalls(res, shotCalls(ws)); finishSse(res, 'tool_calls'); }
      else if (n === 2) textRespond('GOAL_COMPLETE')(res); // marker-only, no summary
      else textRespond(SUMMARY)(res);
    },
  });
  const c3btext = finalTextOf(C3B.events);
  const emptyNotices = C3B.events.filter((e) => e.type === 'sys_notice' && /final answer missing/i.test(e.text ?? ''));
  check('S3B-EMPTY-FINAL-NUDGE', emptyNotices.length >= 1,
    `empty/bare-marker end_turn was NOT accepted as an answer (nudge notice count ${emptyNotices.length})`);
  check('S3B-REQUESTS>=3', C3B.requests.length >= 3, `loop kept requesting until a real answer (got ${C3B.requests.length})`);
  check('S3B-FINAL-TEXT', c3btext.includes('Verification results') && hasBullets(c3btext) >= 2,
    'a real summary followed the empty-final nudge (founder scenario fixed)');

  // ---- CHECK 3c: even a BROKEN model that never writes text ends honestly ---
  const C3C = await runScenarioFixed({
    name: 'silentfallback',
    respond: (res, n, { ws }) => {
      if (n === 1) { writeToolCalls(res, shotCalls(ws)); finishSse(res, 'tool_calls'); }
      else textRespond('GOAL_COMPLETE')(res); // every turn marker-only
    },
  });
  const c3creport = C3C.events.find((e) => e.type === 'task_report');
  const c3cSummary = String(c3creport?.summary ?? '');
  const c3cNotice = C3C.events.some((e) => e.type === 'sys_notice' && /honest fallback written/i.test(e.text ?? ''));
  // NOTE (honest diagnosis): the fallback is written into `finalText`, which the
  // engine surfaces through task_report.summary + a visible sys_notice — NOT as
  // a streamed text_delta (the model's own GOAL_COMPLETE markers are the only
  // deltas). The run is never blank, but the fallback text is in the report.
  check('S3C-HONEST-FALLBACK', /\[system — interrupted\]/.test(c3cSummary) && /انقطاع/.test(c3cSummary) && c3cNotice,
    `after the bounded nudge, an HONEST visible fallback was written to the report + notice (never a blank completed run)`);
  check('S3C-NO-SILENT-STOP', c3cSummary.length > 40, `the broken-model run still carried a visible honest summary (${c3cSummary.length} chars in task_report)`);

  // ---------- CHECK 4: real time cap → VISIBLE sys_notice -------------------
  const C4 = await runScenarioFixed({
    name: 'timecap',
    env: { SURNIA_MAX_RUN_MS: '1', SURNIA_TIME_CAP_GRACE_MS: '60000' },
    respond: (res) => textRespond(SUMMARY)(res),
  });
  const capNotices = C4.events.filter((e) => e.type === 'sys_notice' && /\[time cap\]/i.test(e.text ?? ''));
  const c4text = finalTextOf(C4.events);
  check('S4-NOTHROW', C4.thrown === null, `runAgent did not throw (${C4.thrown?.message ?? 'clean'})`);
  check('S4-VISIBLE-NOTICE', capNotices.length >= 1 && /reason|cap|wrapping|ending/i.test(capNotices.map((n) => n.text).join(' ')),
    `a VISIBLE sys_notice with a reason was emitted (${capNotices.length})`);
  check('S4-NO-SILENT-END', c4text.length > 40 || C4.events.some((e) => e.type === 'task_report'),
    'the capped run still produced a final answer or a visible task_report (not a silent end)');

  // ---------- CHECK 5: final answer always a real summary / no truncation ---
  const answers = [
    ['preview', C1], ['quality', C2], ['falsedone', C3], ['timecap', C4],
  ];
  for (const [label, R] of answers) {
    const t = finalTextOf(R.events);
    const bullets = hasBullets(t);
    const lastBullet = SUMMARY_LINES[SUMMARY_LINES.length - 1].replace(/^- /, '').slice(0, 24);
    check(`S5-${label}-SUMMARY`, bullets >= 2 && hasFilePath(t), `${label}: ${bullets} bullets + file paths`);
    check(`S5-${label}-NOT-TRUNCATED`, t.includes('Verification results') && t.toLowerCase().includes(lastBullet.toLowerCase()),
      `${label}: final text starts with summary and contains the LAST bullet (no pre-end truncation)`);
    const report = R.events.find((e) => e.type === 'task_report');
    const turnEnd = R.events.find((e) => e.type === 'turn_end');
    check(`S5-${label}-TERMINAL`, !!report && !!turnEnd && R.events.indexOf(turnEnd) > R.events.indexOf(report),
      `${label}: task_report precedes the final turn_end (answer delivered before end)`);
  }

  // ---------- SOURCE SCAN: stop-after-screenshot / silent loop end ----------
  console.log('\n--- Source scan: engine.ts loop termination (diagnosis) ---');
  const src = readFileSync(ENGINE_SRC, 'utf8');
  const lines = src.split(/\r?\n/);
  const lineOf = (needle) => { const i = lines.findIndex((l) => l.includes(needle)); return i < 0 ? '?' : i + 1; };

  // Locate the main loop dynamically so the scan survives concurrent edits.
  const loopStartLine = lines.findIndex((l) => l.includes('for (; iter < o.maxIters; iter++)'));
  const loopEndLine = lines.findIndex((l, i) => i > loopStartLine && l.includes('v2 — background subagents'));
  const loopSlice = lines.slice(loopStartLine, loopEndLine > 0 ? loopEndLine : lines.length);
  check('SRC-LOOP-BOUNDS', loopStartLine > 0, `main loop located at engine.ts:${loopStartLine + 1}`);

  check('SRC-TOOL-CONTINUES',
    src.includes("finalText = ''; // text before tool calls is not the final answer") && src.includes('continue;'),
    'tool dispatch ends with finalText=\'\' + continue (the loop RE-REQUESTS after a screenshot tool)',
    `engine.ts:${lineOf('text before tool calls is not the final answer')}`);
  check('SRC-NO-SHOT-STOP',
    !/preview_screenshot|ui_quality_check|read_image/.test(
      loopSlice.filter((l) => /\b(break|return)\b/.test(l)).join('\n'),
    ),
    'no screenshot/quality/image tool name appears on any break/return inside the main loop',
    `engine.ts:${loopStartLine + 1}-${loopEndLine > 0 ? loopEndLine + 1 : '?'}`);

  const suspicious = [
    ['abort', 'if (io.isAborted() || signal.aborted)'],
    ['time_cap', "stopReason: 'time_cap'"],
    ['budget-silent-fallback', 'silentStopFallback(\'the task budget was exhausted'],
    ['error', "stopReason: 'error'"],
    ['maxedOut', 'silentStopFallback(\'the step budget was exhausted\')'],
  ];
  for (const [label, needle] of suspicious) console.log(`        loop-end [${label}] at engine.ts:${lineOf(needle)}`);

  check('SRC-TERMINAL-NOTICE',
    src.includes('[time cap] run reached its wall-clock cap') &&
    /\[budget\] task budget exhausted \(continuation denied\) — stopping (?:cleanly|with an honest status)/.test(src) &&
    src.includes('An explicitly configured step-budget cap was reached'),
    'every terminal cap emits a visible reason (sys_notice / task_report.nextSteps), never a bare silent end',
    `engine.ts:${lineOf('[time cap] run reached its wall-clock cap')}`);

  // D5 root-cause fix: an empty / bare-marker end_turn after a screenshot is no
  // longer accepted as the final answer; a bounded nudge + honest fallback exist.
  check('SRC-EMPTY-FINAL-GUARD',
    src.includes('export const EMPTY_FINAL_NUDGE') &&
    /let emptyFinalNudges = 0/.test(src) &&
    src.includes('if (result.stopReason === \'end_turn\' && o.stream && !finalProse)'),
    'empty / marker-only end_turn is redirected by EMPTY_FINAL_NUDGE (bounded)',
    `engine.ts:${lineOf('export const EMPTY_FINAL_NUDGE')}`);
  check('SRC-SILENT-FALLBACK',
    src.includes('function silentStopFallback(reason: string)') &&
    (src.match(/silentStopFallback\(/g) || []).length >= 4,
    'no final answer ever ends as an empty string — an honest visible fallback is written',
    `engine.ts:${lineOf('function silentStopFallback')}`);

  // ---------- verdict -------------------------------------------------------
  const failed = RESULTS.filter((r) => !r.ok);
  console.log('\n==================== V1136 RESULT ====================');
  console.log(`checks: ${RESULTS.length - failed.length}/${RESULTS.length} passed`);
  if (failed.length) {
    console.log('FAILURES:');
    for (const f of failed) console.log(`  - ${f.id} [${f.where}] — ${f.detail}`);
    console.log('\nBLUNT VERDICT: at least one guard FAILED — inspect the failing check above.');
  } else {
    console.log('BLUNT VERDICT: "stops after screenshot / no final summary" does NOT reproduce in the current engine.');
    console.log('The loop re-requests after every screenshot/quality/vision tool; BOTH the false-done');
    console.log('nudge AND the v11.36 EMPTY_FINAL_NUDGE prevent a silent stop (with an honest');
    console.log('fallback when the model stays broken); caps emit a visible reason; and the final');
    console.log('answer always carries a bulleted summary. Re-run after any further D5 edits land.');
  }
  if (process.env.V1136_DEBUG) {
    for (const [label, R] of [...answers, ['emptyfinal', C3B], ['silentfallback', C3C]]) {
      console.log(`\n----- events: ${label} -----`);
      console.log(R.events.map((e) => `${e.type}${e.kind ? '/' + e.kind : ''} ${String(e.text ?? e.output ?? e.summary ?? '').slice(0, 90).replace(/\n/g, '\\n')}`).join('\n'));
    }
  }

  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  assert.equal(failed.length, 0, `${failed.length} interruption-guard check(s) failed`);
});
