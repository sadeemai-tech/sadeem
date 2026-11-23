import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================================
// v11.32 — REPEATED-FAILURE BREAKER / NO BLIND RETRY (founder's screenshot).
//
// REAL BUG: the assistant got stuck at "thinking 58s — still reasoning" /
// "64s — still reasoning", calling image_generate over and over. Each call
// returned HTTP 503, and the error text literally said "retry once, then
// continue" — so the model retried forever.
//
// This harness drives the REAL electron/agent/engine.ts (esbuild-bundled,
// electron stubbed) against a LOCAL scripted OpenAI-compatible provider
// (node:http — zero network, zero model). `globalThis.fetch` is intercepted
// ONLY for image.pollinations.ai so every image_generate genuinely fails with
// 503. The mock provider attempts image_generate on EVERY turn unless it sees
// the engine's hard corrective in the request messages — so the ONLY thing
// that can stop the loop at 2 calls is the engine breaker itself.
//
// ASSERTS:
//   1. the 503 failure text is the exact NO-RETRY sentence (no "retry once");
//   2. at most 2 image_generate tool calls reach execution;
//   3. the hard corrective reaches the NEXT provider request;
//   4. the run continues and ends with ONE honest task_report (never a clean
//      "completed" with no result), plus turn_end.
//
// Run: node --test --test-force-exit tests/v1132-loop.test.mjs
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

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1132-loop-'));
const MAIN = 'v1132-live';

// The exact text the founder's fix mandates (imageGenService.ts).
const NO_RETRY_503 =
  'Image service unavailable (503) — DO NOT retry this tool. Switch to writing a hand-crafted SVG/CSS icon with write_file instead, or continue without it.';

// ---------- bundle the real sources (electron stubbed) ----------
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
const svcPath = join(tmp, 'imageGenService.cjs');
let engine;
let imageSvc;
try {
  bundle('electron/agent/engine.ts', engPath);
  bundle('electron/services/imageGenService.ts', svcPath);
  engine = require(engPath);
  imageSvc = require(svcPath);
} catch (err) {
  console.error('[V1132] BUNDLE FAILED:', err?.message ?? err);
  throw err;
}

after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ---------- SSE helpers ----------
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'v1132-mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
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
const IMAGE_ARGS = JSON.stringify({ prompt: 'a tiny hand-drawn icon', dest: 'assets/icon.jpg', size: 'icon' });

// ---------- 1. service-level: the 503 text never invites a retry ----------
test('v1132: image service 503 error text forbids retrying', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 503, ok: false, headers: { get: () => '' } });
  try {
    const r = await imageSvc.generateImage({ prompt: 'a hero banner', dest: 'assets/hero.jpg' }, (p) => join(tmp, p));
    assert.equal(r.ok, false);
    assert.equal(r.output, NO_RETRY_503, 'exact mandated NO-RETRY sentence');
    assert.doesNotMatch(r.output, /retry once/i, 'the infinite-loop trigger is gone');
    assert.match(r.output, /DO NOT retry this tool/i);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------- 2. integration: breaker stops the identical failing loop ----------
test('v1132: repeated 503 tool failures are broken after 2 calls, run continues honestly', async () => {
  const corrective = engine.REPEATED_FAILURE_NUDGE;
  assert.equal(
    corrective,
    'This exact tool call has already failed twice. STOP calling it. Use a DIFFERENT tool (write_file + SVG/CSS) or state the blocker and move on. Repeating it will not work.',
    'engine exports the exact hard corrective',
  );

  // Mock provider: ALWAYS tries image_generate unless the engine corrective is
  // present in the request. This makes the breaker — not the script — the only
  // thing that can end the loop.
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
        at: Date.now(),
        messages: JSON.parse(JSON.stringify(msgs)),
        sawCorrective: msgs.some((m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes(corrective)),
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
      // STUBBORN mock: ignore the corrective entirely and keep emitting the
      // SAME failing tool call 6 times. Only the engine's HARD CAP can stop it.
      if (n > 6) {
        // Honest redirect result: no tool call, state the blocker and move on.
        for (const t of [
          'Image generation returned 503. ',
          'I stopped retrying it and will continue without the generated image. ',
          'A hand-crafted SVG/CSS icon can be added with write_file instead.',
        ]) res.write(sseChunk({ content: t }));
        finishSse(res, 'stop', { prompt_tokens: 40, completion_tokens: 30 });
        return;
      }
      for (const d of toolDeltas('image_generate', IMAGE_ARGS, `call_v1132_${n}`)) res.write(sseChunk(d));
      finishSse(res, 'tool_calls', { prompt_tokens: 60, completion_tokens: 40 });
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  const mockBase = `http://127.0.0.1:${port}/v1`;

  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({
    schemaVersion: 4,
    language: 'en',
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

  // Only the IMAGE service fails; the provider's own fetch must still work.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) =>
    typeof url === 'string' && url.includes('image.pollinations.ai')
      ? Promise.resolve({ status: 503, ok: false, headers: { get: () => '' } })
      : realFetch(url, opts);

  const events = [];
  const io = {
    send(e) { events.push({ ...e, at: Date.now() }); },
    async getDecision(requestId) { return { requestId, action: 'allow' }; },
    isAborted() { return false; },
    onFetchSignal() {},
  };
  const ws = mkdtempSync(join(tmp, 'v1132-ws-'));
  let thrown = null;
  const t0 = Date.now();
  try {
    await engine.runAgent({
      task: 'chat',
      sessionId: 'v1132-loop-' + Math.random().toString(36).slice(2),
      messages: [{ id: 'm1', role: 'user', kind: 'text', timestamp: t0, content: 'Generate an icon for me, then report what happened.' }],
      model: { provider: 'custom', model: MAIN, maxTokens: 2048 },
      mode: 'fullAccess',
      workspace: ws,
      apiKey: 'test-key',
      baseUrl: mockBase,
    }, io);
  } catch (err) {
    thrown = err;
  } finally {
    globalThis.fetch = realFetch;
  }

  try {
    assert.equal(thrown, null, `runAgent must not throw (got ${thrown?.stack ?? thrown})`);

    // (1) HARD CAP: the stubborn mock emitted 6 identical failing calls, but
    // only 2 were ever DISPATCHED (tool_start is emitted only on real dispatch).
    const mainRequests = requests.filter((r) => r.model === MAIN);
    assert.equal(mainRequests.length, 7, 'stubborn mock really attempted 6 tool calls + 1 final answer');
    const imageStarts = events.filter((e) => e.type === 'tool_start' && e.name === 'image_generate');
    assert.equal(
      imageStarts.length, 2,
      `at most 2 REAL executions out of 6 identical attempts (got ${imageStarts.length}) — the hard cap did not hold`,
    );
    const allStarts = events.filter((e) => e.type === 'tool_start');
    const allResults = events.filter((e) => e.type === 'tool_result');
    assert.equal(allStarts.length, allResults.length, 'tool_start/tool_result pairing stays intact');
    assert.deepEqual(
      new Set(allStarts.map((e) => e.toolCallId)),
      new Set(allResults.map((e) => e.toolCallId)),
      'no orphan tool_result cards from blocked calls',
    );
    // The 4 blocked attempts still reached the MODEL. v11.35 (C6) wires
    // dedupeToolResults, which folds BYTE-IDENTICAL outputs ≥256 chars into a
    // reference marker (still carrying the real callId + preview + char count),
    // so identical "NOT executed again" results may appear as 1 full + 3 refs.
    // What matters: all 4 attempts are represented, none dropped silently.
    const lastMsgs = mainRequests[mainRequests.length - 1].messages;
    const synthetic = lastMsgs.filter(
      (m) => m.role === 'tool' && (/NOT executed again/.test(m.content ?? '') || /token-economy: identical tool output omitted/.test(m.content ?? '')),
    );
    assert.ok(synthetic.length >= 1 && synthetic.length <= 4, `blocked attempts represented as full or deduped refs (${synthetic.length})`);
    if (synthetic.some((m) => /token-economy: identical/.test(m.content ?? ''))) {
      // Every reference must point at a real earlier callId — capability intact.
      for (const m of synthetic.filter((r) => /token-economy: identical/.test(r.content ?? ''))) {
        assert.match(m.content, /earlier tool result \S+/, 'dedup reference carries the real source callId');
      }
    }
    assert.ok(
      events.some((e) => e.type === 'sys_notice' && e.kind === 'tool_failure_breaker' && /DISPATCH BLOCKED/.test(e.text ?? '')),
      'the blocked dispatch was visible, not silent',
    );

    // (2) the failure text that reached the model forbids a blind retry.
    const imageResults = events.filter((e) => e.type === 'tool_result' && e.ok === false && String(e.output ?? '').includes('Image service unavailable (503)'));
    assert.equal(imageResults.length, 2, 'both failures carried the 503 NO-RETRY text');
    for (const r of imageResults) {
      assert.match(r.output, /DO NOT retry this tool/);
      assert.doesNotMatch(r.output, /retry once/i);
    }

    // (3) the hard corrective reached the NEXT model request, after the 2nd result.
    const correctiveAt = mainRequests.findIndex((r) => r.sawCorrective);
    assert.ok(correctiveAt >= 0, 'a provider request saw the hard corrective');
    assert.equal(correctiveAt, 2, 'corrective reached turn 3 (the turn after the 2nd failure)');
    assert.ok(
      mainRequests[correctiveAt].messages.some((m) => m.role === 'tool' && /Image service unavailable \(503\)/.test(m.content ?? '')),
      'the corrective travelled with the real failing tool results',
    );

    // (4) a visible breaker notice was emitted (redirect, not silence).
    assert.ok(
      events.some((e) => e.type === 'sys_notice' && e.kind === 'tool_failure_breaker'),
      'tool_failure_breaker notice emitted',
    );

    // (5) the run CONTINUED and ended honestly — never "completed" with no result.
    const reports = events.filter((e) => e.type === 'task_report');
    const turnEnds = events.filter((e) => e.type === 'turn_end');
    assert.equal(reports.length, 1, 'exactly one task_report');
    assert.equal(turnEnds.length, 1, 'exactly one turn_end');
    assert.ok(events.indexOf(turnEnds[0]) > events.indexOf(reports[0]), 'report precedes turn_end');
    assert.equal(reports[0].outcome, 'error', 'failed tools are reported honestly, never a clean "completed"');
    const finalText = events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
    assert.match(finalText, /stopped retrying/i, 'the run produced a real, honest result after the redirect');
    assert.ok(finalText.length > 40, `a substantive written result exists (got ${JSON.stringify(finalText)})`);

    // (6) the "still reasoning" marker is at most ONE per run, not a loop.
    const markers = events.filter((e) => e.type === 'sys_notice' && e.kind === 'thinking' && /still reasoning/.test(e.text ?? ''));
    assert.ok(markers.length <= 1, `still-reasoning marker emitted at most once (got ${markers.length})`);

    if (process.env.V1132_DEBUG) {
      console.error(events.map((e) => `+${e.at - t0}ms ${e.type}${e.kind ? '/' + e.kind : ''} ${String(e.text ?? e.output ?? e.name ?? '').slice(0, 90).replace(/\n/g, '\\n')}`).join('\n'));
    }
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise((r) => server.close(r));
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
