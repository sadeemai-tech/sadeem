import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// A11-LIVE — FLOWS: DIRECT end-to-end test (not mocks of the service).
//
// What a flow IS in SADEEM (electron/services/flowsService.ts): a saved,
// named PROMPT the user can re-run with one click. "Running" a flow =
// the renderer re-sends the flow's prompt as a NORMAL chat message
// through the real agent engine, then calls flowsMarkRun(id) so the
// run record (runCount / lastRun) stays accurate. A second, sharper
// path is flowsValidateByReplay(): the flow's stored text is replayed
// as a captured shell command and judged by its EXIT CODE.
//
// This suite drives BOTH paths FOR REAL:
//   1. create a flow (flowsSave) → run its prompt through the REAL
//      engine (runAgent) with a scripted local OpenAI-compatible
//      provider (node:http, zero network) that actually WRITES A FILE
//      via the write_file tool → assert the file landed on disk + the
//      run's streamed text/usage arrived → flowsMarkRun → the run
//      record (runCount/lastRun) shows the run.
//   2. a command-shaped flow validated by flowsValidateByReplay
//      (exit 0 + side effect on disk), and a failing one (exit ≠ 0).
//   3. the repetition counter (flowsHit) suggests saving on the 3rd
//      repeat and stops suggesting once the prompt IS a flow.
//   4. delete → the record disappears.
//
// Harness posture: esbuild runtime bundles of the REAL services +
// electron stub + local mock provider — same as tests/v1111-modes.
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-flows-live-'));

process.env.SURNIA_TURN_RETRY_DELAYS_MS = '8';

// ---------- esbuild bundle (same posture as the v1111 harness) ----------
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

// electron stub with an ISOLATED userData dir (flows.json lands here)
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
    safeStorage: { isEncryptionAvailable: () => false },
    shell: {},
    screen: {},
    powerMonitor: { on() {} },
  };`,
);

const flowsPath = join(tmp, 'flows.cjs');
bundle('electron/services/flowsService.ts', flowsPath);
const flows = require(flowsPath);

const engPath = join(tmp, 'engine.cjs');
bundle('electron/agent/engine.ts', engPath);
const engine = require(engPath);

// ---------- mock OpenAI-compatible provider (local, scripted) ----------
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
function toolDeltas(name, args, id) {
  const half = Math.max(1, Math.floor(args.length / 2));
  return [
    { tool_calls: [{ index: 0, id, function: { name, arguments: '' } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(0, half) } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(half) } }] },
  ];
}

const mockRequests = []; // { model, messages } — lets tests assert the binding
const sockets = new Set();
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
    mockRequests.push({ model: body.model, messages: body.messages ?? [], at: Date.now() });
    sseHeaders(res);
    if (body.model === 'flows-live') {
      // two turns: (1) write_file the proof file, (2) final text
      const sawToolResult = (body.messages ?? []).some((m) => m.role === 'tool');
      if (!sawToolResult) {
        const args = JSON.stringify({ path: 'proof-flows.txt', content: 'HELLO-FLOWS-LIVE\n' });
        for (const d of toolDeltas('write_file', args, 'call_w1')) res.write(sseChunk(d));
        finishSse(res, 'tool_calls', { prompt_tokens: 120, completion_tokens: 40 });
      } else {
        res.write(sseChunk({ role: 'assistant', content: 'DONE: proof-flows.txt written.' }));
        finishSse(res, 'stop', { prompt_tokens: 260, completion_tokens: 12 });
      }
    } else {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `UNSCRIPTED model ${body.model}` } }));
      return;
    }
  });
});
server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
const listening = new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const mockBase = `http://127.0.0.1:${await listening}`;
after(async () => {
  for (const s of sockets) s.destroy();
  await new Promise((r) => server.close(r));
});

// ---------- engine harness (the renderer contract: the flow's prompt is
// re-sent as a normal chat message; approvals auto-allowed like the UI) ----------
function makeIo() {
  const events = [];
  return {
    events,
    send(e) { events.push(e); },
    async getDecision(requestId) { return { requestId, action: 'allow' }; },
    isAborted: () => false,
    onFetchSignal() {},
  };
}

async function runFlowPrompt(prompt, workspace) {
  const io = makeIo();
  const params = {
    task: 'chat',
    sessionId: 'flows-live-' + Math.random().toString(36).slice(2),
    messages: [{ id: 'm1', role: 'user', kind: 'text', content: prompt, timestamp: Date.now() }],
    model: { provider: 'custom', model: 'flows-live', maxTokens: 2048 },
    mode: 'fullAccess',
    workspace,
    apiKey: 'test-key',
    baseUrl: mockBase,
  };
  await engine.runAgent(params, io);
  return io.events;
}

const wsGlobal = mkdtempSync(join(tmpdir(), 'surnia-flows-ws-'));
after(() => { try { rmSync(wsGlobal, { recursive: true, force: true }); } catch { /* ignore */ } });

// ============================================================
// 1. CREATE → RUN END-TO-END → RUN RECORD SHOWS SUCCESS + OUTPUTS
// ============================================================
test('flows live: create a flow, run its prompt through the real engine, run record shows the run', async () => {
  // --- create (the one-click saved prompt) ---
  const PROMPT = 'Create proof-flows.txt containing HELLO-FLOWS-LIVE using the write_file tool, then reply DONE.';
  const list0 = await flows.flowsSave({ name: 'Write proof file', prompt: PROMPT, scope: 'global' });
  const flow = list0.find((f) => f.name === 'Write proof file');
  assert.ok(flow, 'flowsSave returned the merged list containing the new flow');
  assert.equal(flow.runCount, 0, 'a fresh flow has never run');
  assert.ok(!flow.lastRun, 'a fresh flow has no lastRun');

  // --- run it end-to-end through the REAL engine (same prompt, real tools) ---
  const events = await runFlowPrompt(flow.prompt, wsGlobal);

  // outputs: the file the flow's run actually produced
  const proofPath = join(wsGlobal, 'proof-flows.txt');
  assert.ok(existsSync(proofPath), 'the flow run wrote proof-flows.txt to disk');
  assert.equal(readFileSync(proofPath, 'utf8'), 'HELLO-FLOWS-LIVE\n');

  // the engine streamed: a successful write_file tool call + final text + usage
  // (tool_start carries the name; tool_result carries ok — matched by id)
  const writeStarts = events.filter((e) => e.type === 'tool_start' && e.name === 'write_file');
  assert.ok(writeStarts.length >= 1, `write_file tool_start streamed (tools seen: ${events.filter((e) => e.type === 'tool_start').map((e) => e.name).join(', ')})`);
  const writeIds = new Set(writeStarts.map((e) => e.toolCallId));
  assert.ok(
    events.some((e) => e.type === 'tool_result' && writeIds.has(e.toolCallId) && e.ok),
    'write_file tool_result (ok) streamed',
  );
  const text = events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
  assert.ok(text.includes('DONE'), `final text streamed (got: ${text.slice(0, 80)})`);
  const ends = events.filter((e) => e.type === 'message_end' && e.usage);
  assert.ok(ends.length >= 1, 'message_end carried usage (tokens accounted)');
  const errors = events.filter((e) => e.type === 'error');
  assert.equal(errors.length, 0, `no engine errors (${errors.map((e) => e.message).join('; ')})`);

  // the provider binding: the engine really called our configured provider/model
  assert.ok(mockRequests.length >= 2, 'the run made real provider round-trips');
  assert.ok(mockRequests.every((r) => r.model === 'flows-live'), 'every request used the flow run model');

  // --- markRun → the RUN RECORD shows the run ---
  await flows.flowsMarkRun(flow.id);
  const after = flows.flowsList().find((f) => f.id === flow.id);
  assert.equal(after.runCount, 1, 'runCount advanced to 1');
  assert.ok(typeof after.lastRun === 'number' && after.lastRun >= flow.createdAt, 'lastRun stamped');
  const info = flows.flowsInfo();
  assert.ok(info.globalCount >= 1, 'flowsInfo counts the global flow');
});

// ============================================================
// 2. COMMAND-SHAPED FLOW VALIDATED BY REPLAY (exit code + side effect)
// ============================================================
test('flows live: workspace flow validated by replay — exit 0 with the file written; failing replay reports the exit', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'surnia-flows-ws2-'));
  try {
    const okCmd = `node -e "require('node:fs').writeFileSync('replay-proof.txt','REPLAY-OK\\n')"`;
    const list = await flows.flowsSave({ name: 'Replay write', prompt: okCmd, scope: 'workspace' }, ws);
    assert.ok(list.some((f) => f.name === 'Replay write' && f.scope === 'workspace'), 'workspace-scoped flow saved');
    const flow = list.find((f) => f.name === 'Replay write');

    const r = await flows.flowsValidateByReplay(flow.id, ws);
    assert.equal(r.ok, true, `replay succeeded (detail: ${r.detail})`);
    assert.equal(r.exitCode, 0);
    assert.ok(r.detail.includes('exit 0'));
    const proof = join(ws, 'replay-proof.txt');
    assert.ok(existsSync(proof), 'the replayed flow actually wrote its file');
    assert.equal(readFileSync(proof, 'utf8'), 'REPLAY-OK\n');

    // failing replay: exit code propagates, ok=false (the suggestion engine
    // never activates a flow it could not reproduce)
    const bad = await flows.flowsSave({ name: 'Replay fail', prompt: 'node -e "process.exit(3)"', scope: 'workspace' }, ws);
    const badFlow = bad.find((f) => f.name === 'Replay fail');
    const r2 = await flows.flowsValidateByReplay(badFlow.id, ws);
    assert.equal(r2.ok, false);
    assert.equal(r2.exitCode, 3);
    assert.ok(r2.detail.includes('exit 3'), `failing detail mentions exit 3 (got: ${r2.detail})`);
  } finally {
    try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ============================================================
// 3. REPETITION COUNTER → SUGGEST ON THE 3rd HIT → STOP ONCE SAVED
// ============================================================
test('flows live: repeated prompt suggests saving on the 3rd hit and latches once it IS a flow', async () => {
  const text = 'run the full verification suite on this workspace and summarize failures';
  const h1 = await flows.flowsHit(text);
  assert.equal(h1.count, 1, 'first hit counted');
  assert.equal(h1.suggest, false);
  await flows.flowsHit(text);
  const h3 = await flows.flowsHit(text);
  assert.equal(h3.count, 3, 'third hit counted');
  assert.equal(h3.suggest, true, 'suggestion fires at the threshold');
  assert.ok(h3.text.length > 0, 'normalized text returned');

  // save the SAME prompt as a global flow → the counter must go quiet
  await flows.flowsSave({ name: 'Verify suite', prompt: text, scope: 'global' });
  const h4 = await flows.flowsHit(text);
  assert.equal(h4.suggest, false, 'no suggestion for a prompt that already is a flow');
});

// ============================================================
// 4. DELETE → RECORD GONE (workspace layer first, then global)
// ============================================================
test('flows live: delete removes the flow from the run record store', async () => {
  const list = flows.flowsList();
  const victim = list.find((f) => f.name === 'Write proof file');
  assert.ok(victim, 'the flow from test 1 is still there');
  const after = await flows.flowsDelete(victim.id);
  assert.ok(!after.some((f) => f.id === victim.id), 'deleted flow disappeared from the list');
  // markRun on a deleted id is a silent no-op (never breaks the UI)
  await flows.flowsMarkRun(victim.id);
  assert.ok(!flows.flowsList().some((f) => f.id === victim.id), 'markRun on a deleted flow does not resurrect it');
});
