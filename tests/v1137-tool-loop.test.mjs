// ============================================================================
// v11.37 — TOOL-LOOP BREAKER / MALFORMED WRAPPER (founder's exact repro).
//
// Founder: «شاف عائق... فانقطع... كل ما يشغل اشي بيطلع له ايرور»
// ("it sees an obstacle then stops; every tool it runs throws an error").
// The repro: pdf_make emitted the SAME failing path 4 times, each errored,
// then the run stopped. Two root causes are covered here:
//   1. the engine's strict-fingerprint breaker misses cosmetically rewritten
//      calls, and the doom-gate approval path can end the run;
//   2. weak models emit {"tool":"pdf_make","args":{...}}} (nested envelope +
//      extra brace + duplicate blocks) which JSON.parse rejects forever.
//
// REAL-ENGINE harness: esbuild-bundles electron/agent/engine.ts (electron
// stubbed) and drives it against a LOCAL scripted OpenAI-compatible provider
// (node:http on 127.0.0.1 — ZERO external network, ZERO real model).
//
// Run: node --test --test-force-exit tests/v1137-tool-loop.test.mjs
// ============================================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1137-'));
const MAIN = 'v1137-live';

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
  console.error('[V1137] ENGINE BUNDLE FAILED:', err?.message ?? err);
  throw err;
}

after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ---------- SSE helpers ----------
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'v1137-mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
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
const writeText = (res, text) => {
  for (const part of text.match(/[\s\S]{1,90}/g) ?? []) res.write(sseChunk({ content: part }));
};
const FINAL_ANSWER = [
  'I could not create the PDF: pdf_make returned an actionable error. ',
  'The same failing call was NOT repeated — the engine stopped after two identical failures and gave me the exact fix. ',
  'I am reporting the blocker honestly instead of retrying a call that cannot work.',
].join('');

function writeSettings(baseUrl) {
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({
    schemaVersion: 4,
    language: 'en',
    dnaEnabled: false,
    providers: { custom: { apiKey: 'test-key', baseUrl } },
    agent: {
      maxRetries: 0, autoCompact: false, autoVerify: false, selfCritique: false,
      autoMemory: false, checkpointsEnabled: false, allowModelFailover: false,
    },
    doneNotifications: false,
  }));
}

async function startProvider(respond) {
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
      requests.push({ model: body.model, isMain: !isSecondary, messages: JSON.parse(JSON.stringify(body.messages ?? [])) });
      if (isSecondary) { finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 }); return; }
      try { respond(res, n + 1); } catch { finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 }); }
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  return {
    requests,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: async () => { for (const s of sockets) s.destroy(); await new Promise((r) => server.close(r)); },
  };
}

async function runEngine(baseUrl, prompt) {
  const events = [];
  const io = {
    send(e) { events.push({ ...e, at: Date.now() }); },
    async getDecision(requestId) { return { requestId, action: 'allow' }; },
    isAborted() { return false; },
    onFetchSignal() {},
  };
  const ws = mkdtempSync(join(tmp, 'v1137-ws-'));
  let thrown = null;
  try {
    await engine.runAgent({
      task: 'chat',
      sessionId: 'v1137-' + Math.random().toString(36).slice(2),
      messages: [{ id: 'm1', role: 'user', kind: 'text', timestamp: Date.now(), content: prompt }],
      model: { provider: 'custom', model: MAIN, maxTokens: 2048, contextWindow: 200_000 },
      mode: 'fullAccess',
      workspace: ws,
      apiKey: 'test-key',
      baseUrl,
    }, io);
  } catch (err) { thrown = err; }
  return { events, thrown, ws };
}

// ===========================================================================
// 1. PARSER UNIT — the founder's exact malformed string becomes ONE call.
// ===========================================================================
test('v1137: nested wrapper + extra brace + duplicate block parse to ONE valid call', () => {
  const known = new Set(['pdf_make', 'read_file']);
  const founder = '```surnia-tool\n{"tool":"pdf_make","args":{"path":"report.txt","content":"hi"}}}\n```';
  const calls = engine.parseTextToolCalls(founder, known);
  assert.equal(calls.length, 1, 'the malformed wrapper yields exactly ONE call, not zero');
  assert.equal(calls[0].name, 'pdf_make');
  assert.equal(JSON.parse(calls[0].args).path, 'report.txt');
  assert.equal(JSON.parse(calls[0].args).content, 'hi');

  const wrapped = engine.parseToolArgs('{"tool":"pdf_make","args":{"path":"report.txt","content":"hi"}}}');
  assert.equal(wrapped.invalid, false);
  assert.equal(wrapped.envelopeName, 'pdf_make');
  assert.equal(wrapped.parsed.path, 'report.txt');

  // Duplicated near-identical blocks in one fence → still ONE call.
  const dup =
    '```surnia-tool\n' +
    '{"tool":"pdf_make","args":{"path":"a.pdf","content":"x"}}\n' +
    '{"tool":"pdf_make","args":{"path":"a.pdf","content":"x"}}\n' +
    '```';
  assert.equal(engine.parseTextToolCalls(dup, known).length, 1, 'duplicate block deduped');

  // v119 E6 contract: a genuinely truncated object is NEVER repaired into a call.
  assert.equal(engine.parseToolArgs('{"tool":"read_file",').invalid, true);
  assert.equal(
    engine.parseTextToolCalls('```surnia-tool\n{"tool":"read_file",\n```', known).length,
    0,
    'truncated JSON still dropped',
  );
});

test('v1137: normalized fingerprint + actionable-fix extraction', () => {
  const a = engine.normalizedToolCallKey('pdf_make', { path: 'C:\\tmp\\report.txt', content: 'hi' });
  const b = engine.normalizedToolCallKey('PDF_MAKE', { content: 'hi', path: 'c:/tmp/report.txt' });
  assert.equal(a, b, 'cosmetic rewrites of one failing call share a breaker key');
  assert.notEqual(a, engine.normalizedToolCallKey('pdf_make', { path: 'other.pdf', content: 'hi' }));
  assert.equal(
    engine.actionableFixFrom('pdf_make needs a .pdf destination — rename the path to .pdf.'),
    'rename the path to .pdf.',
  );
  // M1 rewrote tool errors to `Fix: …` — the relay must follow the new format.
  assert.equal(
    engine.actionableFixFrom('pdf_make: missing content. Fix: pass markdown as "content" (aliases: text, body, markdown).'),
    'pass markdown as "content" (aliases: text, body, markdown).',
  );

  // The cap arms on NAME + NORMALIZED ARGS + `!outcome.ok` ONLY. No error-text
  // test is allowed in the arm condition (otherwise a sibling agent changing
  // tool wording could silently break the founder's loop guard).
  const src = readFileSync(join(ROOT, 'electron/agent/engine.ts'), 'utf8');
  assert.match(src, /if \(!outcome\.ok && !breakerBlocked\) \{/, 'breaker arms on failure, not on error text');
  assert.match(src, /normalizedToolCallKey\(p\.call\.name, p\.parsed\)/, 'breaker key is name + normalized args');
});

// ===========================================================================
// 2. INTEGRATION — 4 identical failing pdf_make calls, no loop, no stop.
// ===========================================================================
test('v1137: 4 identical failing pdf_make calls → <=2 dispatches, ONE notice, run continues', async () => {
  // M1 (tools.ts) now APPENDS .pdf to a *.txt destination, so "report.txt"
  // SUCCEEDS. Use a call that deterministically FAILS regardless of tool error
  // wording: pdf_make with no content → `pdf_make: missing content. Fix: …`.
  const PDF_ARGS = JSON.stringify({ path: 'report.pdf', title: 'Report' });
  const provider = await startProvider((res, n) => {
    if (n <= 4) {
      // STUBBORN model: re-emits the SAME failing call 4 times, including a
      // cosmetically rewritten copy (key order changed, args unchanged).
      const args = n === 3
        ? JSON.stringify({ title: 'Report', path: 'report.pdf' })
        : PDF_ARGS;
      for (const d of toolDeltas('pdf_make', args, `call_v1137_${n}`)) res.write(sseChunk(d));
      finishSse(res, 'tool_calls', { prompt_tokens: 60, completion_tokens: 40 });
      return;
    }
    writeText(res, FINAL_ANSWER);
    finishSse(res, 'stop', { prompt_tokens: 40, completion_tokens: 30 });
  });
  writeSettings(provider.baseUrl);
  process.env.SURNIA_HOME = userDataDir;
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = '5,5,5,5,5,5';
  process.env.SURNIA_DELTA_FLUSH_MS = '5';
  process.env.SURNIA_SKIP_UI_GATE = '1';

  const { events, thrown, ws } = await runEngine(provider.baseUrl, 'Create a PDF report, then tell me what happened.');
  if (process.env.V1137_DEBUG) {
    console.error(events.map((e) => `+${e.at}ms ${e.type}${e.kind ? '/' + e.kind : ''} ${String(e.text ?? e.output ?? e.name ?? '').slice(0, 160).replace(/\n/g, '\\n')}`).join('\n'));
  }
  try {
    assert.equal(thrown, null, `runAgent must not throw (${thrown?.stack ?? thrown})`);

    const mainRequests = provider.requests.filter((r) => r.isMain);
    assert.equal(mainRequests.length, 5, 'the stubborn model really emitted 4 tool turns + 1 final answer');

    const starts = events.filter((e) => e.type === 'tool_start' && e.name === 'pdf_make');
    assert.ok(starts.length >= 1 && starts.length <= 2, `only 1-2 real dispatches (got ${starts.length})`);
    const results = events.filter((e) => e.type === 'tool_result');
    assert.equal(results.length, starts.length, 'tool_start/tool_result pairing stays intact');
    assert.deepEqual(new Set(starts.map((e) => e.toolCallId)), new Set(results.map((e) => e.toolCallId)));
    assert.ok(results.every((r) => r.ok === false), 'every real pdf_make dispatch failed honestly');

    const realError = String(results[0]?.output ?? '');
    assert.ok(realError.length > 20, `the real actionable tool error reached the model/UI: ${realError}`);
    assert.match(realError, /missing content/i, 'the fixture is genuinely failing under the CURRENT tools.ts');

    const notices = events.filter((e) => e.type === 'sys_notice' && e.kind === 'tool_loop_breaker');
    assert.equal(notices.length, 1, `exactly ONE visible breaker notice, never notice spam (got ${notices.length})`);
    assert.ok(notices[0].text.includes(realError.slice(0, 120)), 'notice carries the EXACT tool error verbatim');
    assert.match(notices[0].text, /EXACT FIX:/);
    assert.match(String(notices[0].text), /pass markdown as "content"/, 'M1 Fix: clause relayed verbatim');

    // The synthetic tool_result reached the model with the precise correction.
    const lastMsgs = mainRequests[mainRequests.length - 1].messages;
    const synthetic = lastMsgs.filter(
      (m) => m.role === 'tool' && /NOT executed again/.test(String(m.content ?? '')),
    );
    assert.ok(synthetic.length >= 1, 'the blocked retries reached the model as synthetic tool_results');
    assert.match(String(synthetic[0].content), /EXACT FIX:/);
    assert.match(String(synthetic[0].content), /DIFFERENT tool/);
    assert.match(String(synthetic[0].content), /EXACT TOOL ERROR:/);

    // The run broke the loop WITHOUT the doom-gate approval path (which is what
    // used to stop the run after the 4th retry).
    assert.equal(events.filter((e) => e.type === 'doom_loop').length, 0, 'no doom-gate approval stopped the run');

    const finalText = events.filter((e) => e.type === 'text_delta').map((e) => e.text ?? '').join('');
    assert.match(finalText, /could not create the PDF/i, 'a substantive final answer was written');
    assert.ok(finalText.length > 80, `the run continued to a real answer (got ${JSON.stringify(finalText)})`);
    const reports = events.filter((e) => e.type === 'task_report');
    const turnEnds = events.filter((e) => e.type === 'turn_end');
    assert.equal(reports.length, 1, 'exactly one honest task_report');
    assert.equal(turnEnds.length, 1, 'exactly one turn_end');
    assert.ok(events.indexOf(turnEnds[0]) > events.indexOf(reports[0]));

    if (process.env.V1137_DEBUG) {
      console.error(events.map((e) => `+${e.at}ms ${e.type}${e.kind ? '/' + e.kind : ''} ${String(e.text ?? e.output ?? e.name ?? '').slice(0, 100).replace(/\n/g, '\\n')}`).join('\n'));
    }
  } finally {
    await provider.close();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

// ===========================================================================
// 3. INTEGRATION — the malformed wrapper is parsed and DISPATCHED once.
// ===========================================================================
test('v1137: malformed surnia-tool wrapper is repaired and dispatched as ONE call', async () => {
  const MALFORMED_BLOCK =
    'I will create the report.\n' +
    '```surnia-tool\n' +
    '{"tool":"pdf_make","args":{"path":"report.txt","content":"Hello"}}}\n' +
    '```';
  const provider = await startProvider((res, n) => {
    if (n === 1) {
      writeText(res, MALFORMED_BLOCK);
      finishSse(res, 'stop', { prompt_tokens: 50, completion_tokens: 40 });
      return;
    }
    writeText(res, FINAL_ANSWER);
    finishSse(res, 'stop', { prompt_tokens: 40, completion_tokens: 30 });
  });
  writeSettings(provider.baseUrl);
  process.env.SURNIA_HOME = userDataDir;
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = '5,5,5,5,5,5';
  process.env.SURNIA_DELTA_FLUSH_MS = '5';
  process.env.SURNIA_SKIP_UI_GATE = '1';

  const { events, thrown, ws } = await runEngine(provider.baseUrl, 'Make the report PDF, then report the result.');
  try {
    assert.equal(thrown, null, `runAgent must not throw (${thrown?.stack ?? thrown})`);
    const starts = events.filter((e) => e.type === 'tool_start');
    assert.equal(starts.length, 1, 'exactly ONE tool call parsed out of the malformed block');
    assert.equal(starts[0].name, 'pdf_make');
    assert.equal(starts[0].args.path, 'report.txt', 'the nested args were unwrapped correctly');
    assert.equal(starts[0].args.content, 'Hello');
    const results = events.filter((e) => e.type === 'tool_result');
    assert.equal(results.length, 1, 'one matching tool_result');
    assert.ok(String(results[0].output).length > 20, 'the real actionable error was surfaced, not a generic failure');
    assert.equal(events.filter((e) => e.type === 'sys_notice' && e.kind === 'tool_loop_breaker').length, 0,
      'a single repaired call does not fire the loop breaker');
    const finalText = events.filter((e) => e.type === 'text_delta').map((e) => e.text ?? '').join('');
    assert.match(finalText, /could not create the PDF/i, 'run continued to a real final answer');
  } finally {
    await provider.close();
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
