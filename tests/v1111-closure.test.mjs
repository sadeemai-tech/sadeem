import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// v11.11 (A4-CLOSURE) — THE GUARANTEE, END TO END. Regression suite for the
// founder's v11.10 incident: a build task that died mid-stream left the app
// hung — no completion report, no summary, no preview. These tests pin the
// CLOSED loop on REAL engine code (same harness posture as
// v1111-antifreeze / v1110-endurance: real engine loop + real provider
// streaming layer against a scripted local mock provider, zero network):
//
//   closure-1  A task aborted MID-STREAM right after writing a
//              NON-previewable artifact (data.bin) still emits exactly ONE
//              `task_report` — outcome 'aborted', the partial result
//              (data.bin, really on disk) listed — plus `aborted` BEFORE
//              `turn_end` (the renderer's hung-state killer), and the
//              auto-preview NEVER fires for a non-previewable artifact.
//              The run journal carries the same truth: a `task_report` line
//              and a finish line with outcome 'aborted'.
//   closure-2  Same abort shape, but the artifact is `dist/index.html` →
//              the engine's completion hook DOES emit `preview_open` with
//              previewHint {kind:'static', label:'index.html'} — the
//              auto-open linkage fires on every ending, aborts included.
//   closure-3  Completed run: the journal's `task_report` line is written
//              BEFORE the `finish` line (order contract — the journal
//              summary reader takes the LAST finish line, so a finish
//              queued first would make completed runs read as "crashed").
//
// Event names are NEVER renamed here — the renderer and engine share them.
import { test } from 'node:test';
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
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1111-closure-'));

// ---------- esbuild bundle (same posture as v1111-antifreeze) ----------
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
const hComplete = ({ text } = {}) => async ({ res }) => {
  sseHeaders(res);
  if (text) res.write(sseChunk({ content: text }));
  finishSse(res, 'stop', { prompt_tokens: 10, completion_tokens: 10 });
};
/** Turn 1: narrate + request ONE write_file, then stop for tool execution. */
const hWriteToolCall = ({ narrate, path, content }) => async ({ res }) => {
  sseHeaders(res);
  if (narrate) res.write(sseChunk({ content: narrate }));
  const args = JSON.stringify({ path, content });
  res.write(sseChunk({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'write_file', arguments: '' } }] }));
  res.write(sseChunk({ tool_calls: [{ index: 0, function: { arguments: args } }] }));
  finishSse(res, 'tool_calls');
};

function startMock() {
  const routes = new Map();
  const requests = [];
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

function writeSettings(mockBase) {
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      schemaVersion: 4,
      providers: {
        custom: { apiKey: 'test-key', baseUrl: mockBase },
        zai: { apiKey: 'failover-key', baseUrl: mockBase },
      },
      agent: { maxRetries: 0, autoCompact: false, autoVerify: false },
      checkpointsEnabled: false,
      doneNotifications: false,
    }),
  );
}

/** IO harness. opts.abortOn: abort the run the moment this event type arrives. */
function makeIo({ abortOn = null } = {}) {
  const events = [];
  const timeline = [];
  const ac = new AbortController();
  return {
    events,
    timeline,
    controller: ac,
    send(e) {
      timeline.push({ type: e.type, at: Date.now() });
      events.push(e);
      if (abortOn && e.type === abortOn && !ac.signal.aborted) {
        try { ac.abort(); } catch { /* already */ }
      }
    },
    async getDecision(requestId) {
      return { requestId, action: 'allow' };
    },
    isAborted: () => ac.signal.aborted,
    onFetchSignal(cb) {
      cb(ac.signal);
    },
  };
}

async function runEngine({ workspace, baseUrl, io, sessionId }) {
  try {
    await engine.runAgent(
      {
        task: 'chat',
        sessionId,
        messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Build the thing end to end.', timestamp: Date.now() }],
        model: { provider: 'custom', model: 'mock-a', maxTokens: 2048 },
        mode: 'fullAccess',
        workspace,
        apiKey: 'test-key',
        baseUrl,
      },
      io,
    );
  } catch (err) {
    console.error('[v1111-closure harness] runAgent threw:', err);
  }
}

const types = (io, type) => io.events.filter((e) => e.type === type);

// ---------- journal reading (the journal file is engine-internal; its path
// is deterministic: <userData>/journals/<YYYY-MM-DD>/<sessionId>.jsonl) ----------
function journalPathFor(sessionId) {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  return join(userDataDir, 'journals', day, `${sessionId}.jsonl`);
}
/** Poll until the journal's finish line lands (async chain, ≤120ms debounce). */
async function readJournalSettled(file) {
  for (let i = 0; i < 40; i++) {
    try {
      const text = readFileSync(file, 'utf8');
      if (text.includes('"type":"finish"') || text.includes('"type": "finish"')) {
        return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
      }
    } catch { /* not yet */ }
    await sleep(100);
  }
  // one last read — throw with content if the finish never landed
  const text = readFileSync(file, 'utf8');
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

const FAST_RETRY = '8,8,8,8,8,8';

// ---------- closure-1: abort mid-stream, NON-previewable artifact ----------
test('closure-1: abort mid-stream after a non-previewable write → ONE task_report (aborted, partial files) + NO preview_open + journal agrees', async () => {
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  const ws = mkdtempSync(join(tmpdir(), 'surnia-cl-1-'));
  const sessionId = 'sess-closure-1';
  const mock = startMock();
  const port = await mock.port();
  mock.routes.set('mock-a', [
    hWriteToolCall({ narrate: 'Writing the data chunk now.', path: 'data.bin', content: 'BIN-PARTIAL\n' }),
    hComplete({ text: 'SHOULD NEVER BE REQUESTED' }),
  ]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo({ abortOn: 'tool_result' }); // abort the instant the write lands
  try {
    await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io, sessionId });

    // the partial result is REAL: the write completed before the abort
    assert.ok(existsSync(join(ws, 'data.bin')), 'the aborted run kept its partial file on disk');

    // exactly one aborted event, exactly one report, report BEFORE turn_end
    assert.equal(types(io, 'aborted').length, 1, 'aborted event emitted');
    const reports = types(io, 'task_report');
    assert.equal(reports.length, 1, 'EXACTLY one task_report on the mid-stream abort');
    const report = reports[0];
    assert.equal(report.outcome, 'aborted', 'status is aborted');
    assert.ok(report.summary && report.summary.length > 0, 'human-readable summary present (never silent)');
    assert.ok(report.files.includes('data.bin'), 'partial result listed in files');
    assert.ok(Array.isArray(report.commands), 'commands array present');
    assert.ok(Array.isArray(report.nextSteps) && report.nextSteps.length > 0, 'next steps present');
    assert.ok(Number.isFinite(report.durationMs), 'durationMs present');
    const iTimeline = (t) => io.timeline.findIndex((e) => e.type === t);
    const iAbort = io.timeline.findIndex((e) => e.type === 'aborted');
    const iReport = iTimeline('task_report');
    const iEnd = iTimeline('turn_end');
    assert.ok(iReport >= 0 && iEnd > iReport, `task_report (${iReport}) lands BEFORE turn_end (${iEnd}) — the UI can never hang streaming`);
    assert.ok(iAbort >= 0 && iAbort < iReport, 'aborted precedes the report');

    // NO preview for a non-previewable artifact (data.bin matches neither the
    // artifact whitelist nor the code-extension fallback)
    assert.equal(types(io, 'preview_open').length, 0, 'auto-preview does NOT fire for non-previewable artifacts');

    // no request after the abort
    assert.equal(mock.requests.length, 1, 'no continuation request after abort');

    // the journal agrees: task_report + finish outcome aborted
    const lines = await readJournalSettled(journalPathFor(sessionId));
    const jReport = lines.find((o) => o.type === 'task_report');
    assert.ok(jReport, 'journal carries the task_report line');
    assert.equal(jReport.outcome, 'aborted', 'journal task_report outcome is aborted');
    const finishIdx = lines.map((o) => o.type).lastIndexOf('finish');
    const reportIdx = lines.findIndex((o) => o.type === 'task_report');
    assert.ok(finishIdx > reportIdx, `journal finish (${finishIdx}) is written AFTER the task_report line (${reportIdx})`);
    const finish = lines[finishIdx];
    assert.equal(finish.outcome, 'aborted', 'journal finish outcome is aborted');
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------- closure-2: abort mid-stream, dist/index.html → preview DOES open ----------
test('closure-2: abort mid-stream after writing dist/index.html → preview_open fires (static/index.html hint) + report still emitted', async () => {
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  const ws = mkdtempSync(join(tmpdir(), 'surnia-cl-2-'));
  const sessionId = 'sess-closure-2';
  const mock = startMock();
  const port = await mock.port();
  mock.routes.set('mock-a', [
    hWriteToolCall({ narrate: 'Building the site.', path: 'dist/index.html', content: '<html><body>hi</body></html>\n' }),
    hComplete({ text: 'SHOULD NEVER BE REQUESTED' }),
  ]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo({ abortOn: 'tool_result' });
  try {
    await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io, sessionId });

    assert.ok(existsSync(join(ws, 'dist', 'index.html')), 'the previewable artifact is really on disk');
    const reports = types(io, 'task_report');
    assert.equal(reports.length, 1, 'EXACTLY one task_report on this abort too');
    assert.equal(reports[0].outcome, 'aborted');
    assert.ok(reports[0].files.includes('dist/index.html'), 'artifact listed in the report');

    const previews = types(io, 'preview_open');
    assert.equal(previews.length, 1, 'auto-preview fires for the previewable artifact (even on abort)');
    const hint = previews[0]?.previewHint;
    assert.ok(hint, 'preview_open carries the previewHint');
    assert.equal(hint.kind, 'static', 'hint kind is static');
    assert.equal(hint.label, 'index.html', 'hint label names index.html');
    assert.equal(previews[0].ws, ws, 'preview is scoped to the run workspace');
    const iPreview = io.timeline.findIndex((e) => e.type === 'preview_open');
    const iReport = io.timeline.findIndex((e) => e.type === 'task_report');
    const iEnd = io.timeline.findIndex((e) => e.type === 'turn_end');
    // engine contract: the report lands first, the auto-open hint rides with
    // it (inside the same completion hook), turn_end closes the run
    assert.ok(iReport >= 0 && iPreview > iReport && iEnd > iPreview, `order: report (${iReport}) → preview (${iPreview}) → turn_end (${iEnd})`);
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

// ---------- closure-3: completed run — journal order contract ----------
test('closure-3: completed run journals task_report BEFORE the finish line (finish outcome completed)', async () => {
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = FAST_RETRY;
  const ws = mkdtempSync(join(tmpdir(), 'surnia-cl-3-'));
  const sessionId = 'sess-closure-3';
  const mock = startMock();
  const port = await mock.port();
  mock.routes.set('mock-a', [
    hWriteToolCall({ narrate: 'Writing the page.', path: 'page.md', content: '# done\n' }),
    hComplete({ text: 'All done — page written.' }),
  ]);
  writeSettings(`http://127.0.0.1:${port}/v1`);
  const io = makeIo();
  try {
    await runEngine({ workspace: ws, baseUrl: `http://127.0.0.1:${port}/v1`, io, sessionId });

    const reports = types(io, 'task_report');
    assert.equal(reports.length, 1, 'EXACTLY one task_report on completion');
    assert.equal(reports[0].outcome, 'completed');
    assert.ok(reports[0].files.includes('page.md'), 'files listed');
    const iReport = io.timeline.findIndex((e) => e.type === 'task_report');
    const iEnd = io.timeline.findIndex((e) => e.type === 'turn_end');
    assert.ok(iEnd > iReport, 'report before turn_end');
    assert.equal(types(io, 'error').length, 0);

    const lines = await readJournalSettled(journalPathFor(sessionId));
    const jReport = lines.find((o) => o.type === 'task_report');
    assert.ok(jReport, 'journal carries the task_report line');
    assert.equal(jReport.outcome, 'completed', 'journal report outcome completed');
    const finishIdx = lines.map((o) => o.type).lastIndexOf('finish');
    const reportIdx = lines.findIndex((o) => o.type === 'task_report');
    assert.ok(reportIdx >= 0 && finishIdx > reportIdx, `task_report (${reportIdx}) precedes finish (${finishIdx}) — completed runs never read as "crashed"`);
    assert.equal(lines[finishIdx].outcome, 'completed', 'journal finish outcome completed');
  } finally {
    await mock.stop();
    rmSync(ws, { recursive: true, force: true });
  }
});

test('cleanup', () => {
  for (const k of ['SURNIA_TURN_RETRY_DELAYS_MS', 'SURNIA_ENGINE_IDLE_MS', 'SURNIA_DELTA_FLUSH_MS']) {
    delete process.env[k];
  }
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
