// ============================================================
// v11.37 — INDEPENDENT GUARD B: AGENT LOOP / REPEATED FAILURE
// ------------------------------------------------------------
// Founder's complaint M2: "the agent loops forever on the same failing tool
// call, then stops silently with no summary".
//
// DIAGNOSIS + TEST ONLY — no app source is edited. This script bundles the
// REAL electron/agent/engine.ts (electron stubbed) and drives runAgent against
// a LOCAL scripted OpenAI-compatible provider (node:http — no external net,
// no model). The mock emits FOUR identical failing tool calls; only the
// engine's own breaker can stop the loop. A second scenario feeds a malformed
// nested {"tool","args"} text-tool wrapper through the REAL parseTextToolCalls
// and the REAL loop, asserting it becomes exactly ONE dispatch.
//
// Run: node tests-v1137-loop-guard.mjs
// ============================================================
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const failures = [];
function check(id, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
  if (!ok) failures.push(`${id} — ${detail}`);
  return ok;
}
function loc(rel, needle) {
  try {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split(/\r?\n/);
    const i = lines.findIndex((l) => l.includes(needle));
    return `${rel}:${i >= 0 ? i + 1 : '?'}`;
  } catch { return `${rel}:?`; }
}

// ------------------------------------------------------------
// bundle the REAL engine + electron stub + local temp dirs
// ------------------------------------------------------------
const TMP = mkdtempSync(join(tmpdir(), 'sadeem-v1137-loop-'));
const userDataDir = join(TMP, 'userdata');
mkdirSync(userDataDir, { recursive: true });
const stubDir = join(TMP, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `
const paths = { temp: ${JSON.stringify(TMP)}, userData: ${JSON.stringify(userDataDir)}, home: ${JSON.stringify(TMP)}, appData: ${JSON.stringify(TMP)} };
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

const engPath = join(TMP, 'engine.bundle.cjs');
let engine;
try {
  esbuild.buildSync({
    entryPoints: [join(ROOT, 'electron/agent/engine.ts')],
    outfile: engPath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    logLevel: 'silent',
  });
  engine = require(engPath);
} catch (err) {
  check('B0-BUNDLE', false, `esbuild of real engine.ts failed: ${err?.message ?? err}`);
}

process.env.SURNIA_HOME = userDataDir;
process.env.SURNIA_TURN_RETRY_DELAYS_MS = '5,5,5,5,5,5';
process.env.SURNIA_DELTA_FLUSH_MS = '5';
process.env.SURNIA_SKIP_UI_GATE = '1';

// ------------------------------------------------------------
// local SSE provider helpers
// ------------------------------------------------------------
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
const FINAL_TEXT = [
  'I stopped retrying the missing file after two identical failures. ',
  'Summary: read_file could not find the requested path, so no further retries were made; ',
  'I am reporting the blocker honestly instead of stalling the session.',
];

/** Run one scripted scenario; returns { events, requests, thrown }. */
async function runScenario(script) {
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
        sawCorrective: msgs.some((m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes(engine.REPEATED_FAILURE_NUDGE)),
      });
      if (
        body.model !== script.model ||
        /compact coding-agent transcripts/i.test(sys) ||
        /extract durable engineering facts|Surnia DNA user model/i.test(sys) ||
        /part of the Surnia agent team/i.test(sys)
      ) {
        finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 });
        return;
      }
      const n = requests.filter((r) => r.model === script.model).length;
      script.respond(n, requests, res);
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  const baseUrl = `http://127.0.0.1:${port}/v1`;
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
  const events = [];
  const io = {
    send(e) { events.push({ ...e }); },
    async getDecision(requestId) { return { requestId, action: 'allow' }; },
    isAborted() { return false; },
    onFetchSignal() {},
  };
  const ws = mkdtempSync(join(TMP, 'ws-'));
  let thrown = null;
  try {
    await engine.runAgent({
      task: 'chat',
      sessionId: script.sessionId,
      messages: [{ id: 'm1', role: 'user', kind: 'text', timestamp: Date.now(), content: script.user }],
      model: { provider: 'custom', model: script.model, maxTokens: 2048 },
      mode: 'fullAccess',
      workspace: ws,
      apiKey: 'test-key',
      baseUrl,
    }, io);
  } catch (err) {
    thrown = err;
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise((r) => server.close(r));
  }
  return { events, requests, thrown, baseUrl };
}

async function main() {
  console.log('===== GUARD B — LOOP (real engine.ts, scripted local provider) =====');
  check('B0-HARNESS', typeof engine?.runAgent === 'function' && typeof engine?.parseTextToolCalls === 'function',
    `real runAgent + parseTextToolCalls bundled @ ${loc('electron/agent/engine.ts', 'export async function runAgent(')}`);
  if (!engine) return;

  // ===== Scenario 1: four identical FAILING tool calls =====
  const FAIL_ARGS = JSON.stringify({ path: 'definitely-missing-v1137.txt' });
  const s1 = await runScenario({
    model: 'v1137-fail',
    sessionId: 'v1137-fail-' + Math.random().toString(36).slice(2),
    user: 'Read the file, then tell me what happened.',
    respond(n, _requests, res) {
      if (n <= 4) {
        for (const d of toolDeltas('read_file', FAIL_ARGS, `call_v1137_${n}`)) res.write(sseChunk(d));
        finishSse(res, 'tool_calls', { prompt_tokens: 60, completion_tokens: 40 });
      } else {
        for (const t of FINAL_TEXT) res.write(sseChunk({ content: t }));
        finishSse(res, 'stop', { prompt_tokens: 40, completion_tokens: 30 });
      }
    },
  });

  check('B1-NO-THROW', s1.thrown === null, `runAgent completed without throwing (${s1.thrown?.message ?? 'clean'})`);
  const starts = s1.events.filter((e) => e.type === 'tool_start' && e.name === 'read_file');
  const results = s1.events.filter((e) => e.type === 'tool_result');
  const allStarts = s1.events.filter((e) => e.type === 'tool_start');
  check('B1-DISPATCH-CAP', starts.length <= 2,
    `${starts.length} real dispatches out of 4 identical failing attempts (cap ≤2) @ ${loc('electron/agent/engine.ts', 'already failed twice with identical arguments')}`);
  check('B1-PAIRING', allStarts.length === results.length &&
    new Set(allStarts.map((e) => e.toolCallId)).size === new Set(results.map((e) => e.toolCallId)).size,
  'tool_start / tool_result stay paired (no orphan cards)');
  const breakerNotices = s1.events.filter((e) => e.type === 'sys_notice' && e.kind === 'tool_failure_breaker');
  const blockNotices = breakerNotices.filter((e) => /DISPATCH BLOCKED/i.test(String(e.text ?? '')));
  check('B1-ONE-NOTICE', blockNotices.length === 1,
    `exactly ONE visible "DISPATCH BLOCKED" notice for the 4 attempts — no per-attempt spam (got ${blockNotices.length}) @ ${loc('electron/agent/engine.ts', 'DISPATCH BLOCKED')}`);
  check('B1-NOTICES-BOUNDED', breakerNotices.length >= 1 && breakerNotices.length <= 2 &&
    new Set(breakerNotices.map((e) => String(e.text ?? ''))).size === breakerNotices.length,
    `breaker notices bounded + distinct (arm ×1 + block ×1 = ${breakerNotices.length}; no repeated identical notice) @ ${loc('electron/agent/engine.ts', 'corrective injected; switching approach')}`);
  check('B1-NOTICE-VISIBLE', breakerNotices.some((e) => /failed|blocked|switching/i.test(String(e.text ?? ''))),
    `notice text is human-readable: ${JSON.stringify(breakerNotices[0]?.text ?? '')}`);
  const mainReqs = s1.requests.filter((r) => r.model === 'v1137-fail');
  const correctiveAt = mainReqs.findIndex((r) => r.sawCorrective);
  check('B1-CORRECTIVE', correctiveAt >= 0 && correctiveAt <= 2,
    `REPEATED_FAILURE_NUDGE reached the next model turn (index ${correctiveAt}) @ ${loc('electron/agent/engine.ts', 'export const REPEATED_FAILURE_NUDGE')}`);
  const finalText = s1.events.filter((e) => e.type === 'text_delta').map((e) => String(e.text ?? '')).join('');
  const turnEnds = s1.events.filter((e) => e.type === 'turn_end');
  check('B1-CONTINUES', /stopped retrying/i.test(finalText) && /Summary:/.test(finalText) && finalText.length > 40,
    `run reached a real final answer WITH a summary (${finalText.length} chars) — no silent stop`);
  check('B1-TURN-END', turnEnds.length >= 1,
    `turn_end emitted after the answer (${turnEnds.length}) — not a mid-loop kill @ ${loc('electron/agent/engine.ts', "send({ type: 'turn_end'")}`);
  const reports = s1.events.filter((e) => e.type === 'task_report');
  check('B1-REPORT', reports.length >= 1, `honest task_report emitted (${reports.length})`);

  // ===== Scenario 2: malformed nested {"tool","args"} wrapper =====
  const FENCE = [
    '```surnia-tool',
    JSON.stringify({ tool: 'write_file', args: { path: 'v1137-note.txt', content: 'ملاحظة بالعربية' } }),
    '```',
  ].join('\n');
  const parsed = engine.parseTextToolCalls(
    FENCE + '\n```surnia-tool\n{not valid json\n```',
    new Set(['write_file', 'read_file']),
  );
  check('B2-PARSE-ONE', parsed.length === 1,
    `nested {tool,args} wrapper (plus one malformed fence) parsed to exactly ONE call (got ${parsed.length}) @ ${loc('electron/agent/engine.ts', 'export function parseTextToolCalls(')}`);
  check('B2-PARSE-CONTENT', parsed[0]?.name === 'write_file' && /v1137-note\.txt/.test(parsed[0]?.args ?? ''),
    `parsed call keeps the real name + args: ${JSON.stringify(parsed[0] ?? null)}`);

  const s2 = await runScenario({
    model: 'v1137-wrapper',
    sessionId: 'v1137-wrapper-' + Math.random().toString(36).slice(2),
    user: 'Use the tool protocol to write a note, then summarize.',
    respond(n, _requests, res) {
      if (n === 1) {
        res.write(sseChunk({ content: FENCE + '\n' }));
        finishSse(res, 'stop', { prompt_tokens: 60, completion_tokens: 40 });
      } else {
        for (const t of ['I wrote the note successfully. ', 'Summary: one write_file call was parsed from the tool wrapper and executed once.']) res.write(sseChunk({ content: t }));
        finishSse(res, 'stop', { prompt_tokens: 40, completion_tokens: 30 });
      }
    },
  });
  const wrapperStarts = s2.events.filter((e) => e.type === 'tool_start' && e.name === 'write_file');
  check('B2-INTEGRATION-ONE', s2.thrown === null && wrapperStarts.length === 1,
    `fenced wrapper produced exactly ONE real dispatch through the live loop (got ${wrapperStarts.length}) @ ${loc('electron/agent/engine.ts', 'const tp = parseTextToolCalls(text, known);')}`);
  const wrapperText = s2.events.filter((e) => e.type === 'text_delta').map((e) => String(e.text ?? '')).join('');
  check('B2-FINAL', /Summary:/.test(wrapperText) && s2.events.some((e) => e.type === 'turn_end'),
    'wrapper scenario also reaches a summarized final answer');

  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* gone */ }
  console.log(`\n===== GUARD B SUMMARY: ${failures.length ? 'FAIL' : 'PASS'} (${failures.length} failure(s)) =====`);
  for (const f of failures) console.log('  - ' + f);
  process.exitCode = failures.length ? 1 : 0;
}
main().catch((err) => {
  console.error('GUARD B crashed:', err);
  process.exitCode = 1;
});
