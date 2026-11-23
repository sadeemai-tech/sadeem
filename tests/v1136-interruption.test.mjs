// ============================================================================
// v11.36 — INTERRUPTION / SILENT STOP ("stops right after the verification
// screenshot, never writes the final summary")
// ----------------------------------------------------------------------------
// Founder (live, frustrated): «بوصل لنقطة معينة بوقف لما ياخذ السكرين شوت تبع
// التحقق... فجأة بتعطل، لا يكمل للنهاية... خلص بكون قرب ينتهي فجأة بنقطع، ما
// بكتب الكلام الأخير... الانقطاعات مزعجة جدا، حرام... ليش بتصير؟»
//
// ROOT CAUSE (traced in electron/agent/engine.ts):
//   A verification screenshot / image result can make a provider finish with
//   finish_reason 'stop' but NO visible text (thinking-only or image-only turn).
//   Every end_turn guard checked the CONTENT of visibleText (bare DONE, refusal,
//   unapplied code, false-done prose) but NONE checked that visibleText was
//   non-empty. So the loop fell through to `finalText = visibleText` = '' and
//   returned stopReason 'end_turn' → task_report 'completed' with no summary.
//   A second silent stop lived in the budget wrap-up branch: `finalText = ''`
//   with stopReason 'end_turn' when continuation was denied.
//
// FIX: (a) empty/marker-only end_turn is REDIRECTED with a bounded corrective
//   (EMPTY_FINAL_NUDGE) until the model writes a real answer, then an HONEST
//   visible fallback if the bound is hit; (b) budget/time/step cap stops emit a
//   sys_notice AND a visible fallback text — never empty.
//
// This harness boots the REAL engine.ts (esbuild-bundled, electron stubbed)
// against a LOCAL scripted OpenAI-compatible provider (node:http, zero network,
// zero model). Turn 0 emits a real `read_image` call on a tiny PNG on disk
// (the engine attaches the base64 image to the next request). Turn 1 emits an
// EMPTY end_turn — the exact silent-stop trigger. Turn 2 emits the real answer.
//
// Run: node --test --test-force-exit tests/v1136-interruption.test.mjs
// ============================================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1136-'));
const MAIN = 'v1136-live';

// A harmless 1x1 PNG — read_image attaches it as a base64 image result.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
  'base64',
);

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
  bundle('electron/agent/engine.ts', engPath);
  engine = require(engPath);
} catch (err) {
  console.error('[V1136] BUNDLE FAILED:', err?.message ?? err);
  throw err;
}

after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ---------- SSE helpers ----------
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'v1136-mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
function finishSse(res, finish, usage) {
  if (!res.headersSent) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.flushHeaders();
  }
  if (usage) res.write(`data: ${JSON.stringify({ usage, choices: [] })}\n\n`);
  res.write(sseChunk({}, finish));
  res.write('data: [DONE]\n\n');
  res.end();
}
function toolDeltas(name, args, id) {
  const half = Math.max(1, Math.floor(args.length / 2));
  return [
    { tool_calls: [{ index: 0, id, function: { name, arguments: '' } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(0, half) } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(half) } }] },
  ];
}

const REDIRECT = engine.EMPTY_FINAL_NUDGE;
assert.ok(REDIRECT && /final answer missing/i.test(REDIRECT), 'engine exports the empty-final redirect');

// ---------- 1. INTEGRATION: empty end_turn after an image tool result ----------
test('v1136: empty end_turn after a screenshot image is redirected; run always ends with a real summary', async () => {
  const ws = mkdtempSync(join(tmp, 'v1136-ws-'));
  const pngPath = join(ws, 'verify.png');
  writeFileSync(pngPath, TINY_PNG);
  const pngFwd = pngPath.replace(/\\/g, '/');
  const IMAGE_ARGS = JSON.stringify({ path: pngFwd });

  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      const sys = JSON.stringify(body.system ?? '');
      const msgs = body.messages ?? [];
      requests.push({
        model: body.model,
        messages: JSON.parse(JSON.stringify(msgs)),
        sawRedirect: msgs.some((m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes(REDIRECT)),
        sawImage: msgs.some((m) => m.role === 'tool' && /data:image\//.test(JSON.stringify(m.content ?? m))),
      });
      // Secondary/compaction/extraction/subagent calls stay local + tiny.
      if (
        body.model !== MAIN ||
        /compact coding-agent transcripts/i.test(sys) ||
        /extract durable engineering facts|Surnia DNA user model/i.test(sys) ||
        /part of the Surnia agent team/i.test(sys)
      ) {
        finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 });
        return;
      }
      const n = requests.filter((r) => r.model === MAIN).length;
      if (n === 1) {
        // Turn 0: the verification screenshot (read_image attaches a base64 image).
        for (const d of toolDeltas('read_image', IMAGE_ARGS, 'call_v1136_shot')) res.write(sseChunk(d));
        finishSse(res, 'tool_calls', { prompt_tokens: 60, completion_tokens: 40 });
        return;
      }
      if (n === 2) {
        // Turn 1: THE BUG — provider finished with 'stop' and NO text at all.
        // (thinking-only / image-only turn after seeing the screenshot).
        finishSse(res, 'stop', { prompt_tokens: 40, completion_tokens: 30 });
        return;
      }
      // Turn 2+: the model finally wrote its real final answer.
      for (const t of [
        'I captured and inspected the verification screenshot. ',
        'The layout is correct at 390/820/1366px and there is no overflow. ',
        'All requested files are written and verified — the task is complete.',
      ]) res.write(sseChunk({ content: t }));
      finishSse(res, 'stop', { prompt_tokens: 40, completion_tokens: 30 });
    });
  });
  const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  const mockBase = `http://127.0.0.1:${port}/v1`;

  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({
    schemaVersion: 4,
    language: 'en',
    dnaEnabled: false,
    providers: { custom: { apiKey: 'test-key', baseUrl: mockBase } },
    agent: {
      maxRetries: 0, autoCompact: false, autoVerify: false, selfCritique: false,
      autoMemory: false, checkpointsEnabled: false, allowModelFailover: false,
    },
    doneNotifications: false,
  }));
  process.env.SURNIA_HOME = userDataDir;
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = '5,5,5,5,5,5';
  process.env.SURNIA_DELTA_FLUSH_MS = '5';
  process.env.SURNIA_SKIP_UI_GATE = '1';

  const events = [];
  const io = {
    send(e) { events.push({ ...e, at: Date.now() }); },
    async getDecision(requestId) { return { requestId, action: 'allow' }; },
    isAborted() { return false; },
    onFetchSignal() {},
  };
  let thrown = null;
  try {
    await engine.runAgent({
      task: 'chat',
      sessionId: 'v1136-loop-' + Math.random().toString(36).slice(2),
      messages: [{ id: 'm1', role: 'user', kind: 'text', timestamp: Date.now(), content: 'Build the page, then take a verification screenshot and report the result.' }],
      model: { provider: 'custom', model: MAIN, maxTokens: 2048, contextWindow: 200_000 },
      mode: 'fullAccess',
      taskMode: 'build',
      workspace: ws,
      apiKey: 'test-key',
      baseUrl: mockBase,
    }, io);
  } catch (err) {
    thrown = err;
  }

  try {
    assert.equal(thrown, null, `runAgent must not throw (got ${thrown?.stack ?? thrown})`);

    // (1) The screenshot tool really dispatched and its image reached the model.
    const imgStarts = events.filter((e) => e.type === 'tool_start' && e.name === 'read_image');
    assert.equal(imgStarts.length, 1, 'the verification screenshot tool dispatched once');
    assert.ok(
      requests.some((r) => r.model === MAIN && r.sawImage),
      'the base64 screenshot image was attached to the next provider request',
    );

    // (2) The empty end_turn did NOT end the run — it was redirected.
    const mainRequests = requests.filter((r) => r.model === MAIN);
    assert.ok(mainRequests.length >= 3, `empty end_turn triggered a redirect+continue (got ${mainRequests.length} main requests)`);
    assert.ok(
      mainRequests.slice(1).some((r) => r.sawRedirect),
      'the empty-final corrective reached the NEXT provider request',
    );
    assert.ok(
      events.some((e) => e.type === 'sys_notice' && e.kind === 'gate' && /final answer missing/i.test(e.text ?? '')),
      'a visible sys_notice announced the redirect (not a silent stop)',
    );

    // (3) The run ALWAYS ends with a real final summary — the founder's pain.
    const finalText = events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
    assert.match(finalText, /verification screenshot/i, 'a substantive final answer exists');
    assert.ok(finalText.length > 80, `final summary is real, not empty (got ${JSON.stringify(finalText)})`);

    // (4) ONE honest report + turn_end, in the right order.
    const reports = events.filter((e) => e.type === 'task_report');
    const turnEnds = events.filter((e) => e.type === 'turn_end');
    assert.equal(reports.length, 1, 'exactly one task_report');
    assert.equal(turnEnds.length, 1, 'exactly one turn_end');
    assert.ok(events.indexOf(turnEnds[0]) > events.indexOf(reports[0]), 'report precedes turn_end');
    assert.equal(reports[0].outcome, 'completed', 'the redirected run completes honestly');
    // The decisive assertion: no silent stop (empty summary) on a 'completed' card.
    // emitTaskReport folds finalText into `summary` (truncated to 800 chars).
    assert.match(String(reports[0].summary ?? ''), /verification screenshot/i, 'task_report carries a visible final summary');

    if (process.env.V1136_DEBUG) {
      console.error(events.map((e) => `+${e.at}ms ${e.type}${e.kind ? '/' + e.kind : ''} ${String(e.text ?? e.output ?? e.name ?? '').slice(0, 90).replace(/\n/g, '\\n')}`).join('\n'));
    }
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise((r) => server.close(r));
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ---------- 2. SOURCE: every cap-forced stop is honest + visible ----------
test('v1136: no silent-stop path remains in engine.ts (source invariants)', () => {
  const src = require('node:fs').readFileSync(join(ROOT, 'electron/agent/engine.ts'), 'utf8');
  const lineOf = (needle) => {
    const i = src.indexOf(needle);
    return i < 0 ? '?' : src.slice(0, i).split('\n').length;
  };
  // The budget wrap-up branch no longer writes an empty final text.
  const budgetBlock = src.slice(src.indexOf('if (budgetWrapUp)'), src.indexOf('if (budgetWrapUp)') + 700);
  assert.doesNotMatch(budgetBlock, /finalText\s*=\s*''/, `budget stop still silently blanks finalText: engine.ts:${lineOf('if (budgetWrapUp)')}`);
  assert.match(budgetBlock, /silentStopFallback/, 'budget stop writes an honest fallback');
  assert.match(budgetBlock, /notice\('budget'/, 'budget stop emits a visible sys_notice');
  // The empty-end_turn guard exists and is a redirect, not a stop.
  assert.match(src, /result\.stopReason === 'end_turn' && o\.stream && !finalProse/, `empty-final guard missing: engine.ts:${lineOf('const finalProse')}`);
  assert.match(src, /EMPTY_FINAL_NUDGE_MAX/, 'the redirect is bounded');
  // The wall-clock cap stop carries a fallback too.
  const capBlock = src.slice(src.indexOf("timeCapInjected && elapsed > cap + timeCapGraceMs()"), src.indexOf("timeCapInjected && elapsed > cap + timeCapGraceMs()") + 500);
  assert.match(capBlock, /silentStopFallback/, `wall-clock cap stop has no visible final text: engine.ts:${lineOf("timeCapInjected && elapsed > cap")}`);
});
