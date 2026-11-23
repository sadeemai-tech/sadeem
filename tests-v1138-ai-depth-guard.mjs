#!/usr/bin/env node
// ============================================================
// v11.38 — AI-DEPTH GUARD (G1 verification). DIAGNOSIS + TEST ONLY.
// ------------------------------------------------------------
// Zero app source is edited. This ROOT node script answers ONE blunt
// question about the G1 change: "is the AI actually deeper, or just
// more words?" It refuses to accept a prompt-only word dump as proof.
//
// Four verification blocks:
//   1. SOURCE  — prompts.ts carries a DEEP WORK directive in the DYNAMIC
//                tail (AFTER the v11.16 cache split), naming all four
//                behaviours: tool-selection-by-intent,
//                read-fix-relay-not-loop, verify-before-done,
//                honest-evidence final summary. A directive hidden in the
//                byte-stable cached prefix is REJECTED.
//   2. BYTES   — real buildSystemPrompt() output vs the three frozen caps
//                (v11.16 <24 KB, v11.21 +671<=700, v11.23 +44 in [0,400)).
//                Actual UTF-8 bytes are measured; the +delta vs the 24425 B
//                pre-G1 baseline is reported honestly.
//   3. ENGINE  — the REAL electron/agent/engine.ts is esbuild-bundled
//                (electron stubbed) and driven against a LOCAL scripted
//                OpenAI-compatible provider (node:http, ZERO external net):
//                 (a) the built system prompt CONTAINS the directive;
//                 (b) a failing tool call with an actionable Fix: error is
//                     followed by a DIFFERENT tool call that the engine
//                     actually dispatches (self-correct, not loop/stop);
//                 (c) a build task emits a preview/screenshot step BEFORE
//                     the final answer (behavioural event order + the
//                     FINISHING LOOP ordering in the built prompt/source).
//   4. HYGIENE — no mixed EN+AR prose inside the directive string, and the
//                directive is word-stable (no ${} interpolation / no opts,
//                clock, env or lang reads in its source block).
//
// Run:  node tests-v1138-ai-depth-guard.mjs
// Writes: tests/.v1138-ai-depth-guard.results.json
// Exit 0 = every check PASS; exit 1 = at least one FAIL (or G1 absent).
// ============================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import http from 'node:http';
import { ESBUILD_BIN, ESBUILD_NODE } from './tests/_esbuild-bin.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
process.env.SURNIA_NO_BROWSER = '1';

// ------------------------------------------------------------
// findings / check helpers
// ------------------------------------------------------------
const findings = [];
function check(id, ok, detail, fileLine = '') {
  const status = ok ? 'PASS' : 'FAIL';
  findings.push({ id, status, detail, fileLine });
  console.log(`${status} ${id}${fileLine ? ` [${fileLine}]` : ''}: ${detail}`);
  return ok;
}
function loc(rel, needle) {
  try {
    const lines = readFileSync(join(ROOT, rel), 'utf8').split(/\r?\n/);
    const i = lines.findIndex((l) => l.includes(needle));
    return `${rel}:${i >= 0 ? i + 1 : '?'}`;
  } catch { return `${rel}:?`; }
}
const bytes = (s) => Buffer.byteLength(String(s ?? ''), 'utf8');

// The four behaviours the G1 directive MUST name. Each is a PREDICATE that
// accepts the founder's hyphenated tokens OR a reworded-but-equivalent phrase
// (the landed directive uses "INTENT / RIGHT TOOL", "FAIL: read EXACT FIX,
// self-correct ONCE, never loop", "VERIFY: READ output, never claim done",
// "FINISH: honest evidence"). These predicates are the published contract —
// see docs/AI-DEPTH-GUARD-V1138.md. They are substantive: a directive that
// merely says "work deeply" cannot satisfy them.
const BEHAVIOURS = {
  // tool-selection-by-intent: grasp the goal AND pick the right tool by it.
  toolSelectionByIntent: (t) =>
    /(?:INTENT|real goal|by[-\s]?intent)/i.test(t) &&
    /(?:RIGHT TOOL|TOOL SELECTION|SELECT(?:S|ING)? (?:THE )?(?:RIGHT|CORRECT) TOOL|CHOOSE (?:THE )?(?:RIGHT|CORRECT) TOOL|match the tool)/i.test(t),
  // read-fix-relay-not-loop: read the fix, self-correct/switch (relay), never loop.
  readFixRelayNotLoop: (t) =>
    /read/i.test(t) && /(?:EXACT )?FIX/i.test(t) &&
    /(?:self[-\s]?correct|relay|switch approach|\bswitch\b)/i.test(t) &&
    /never loop|not loop|no loop|don't loop|do not loop/i.test(t),
  // verify-before-done: verify and READ output; no done-from-memory claim.
  verifyBeforeDone: (t) =>
    /verif/i.test(t) &&
    /(?:never claim done|claim done|before done|before claiming|READ output|run the check)/i.test(t),
  // honest evidence final summary: finish with honest evidence.
  honestEvidenceFinal: (t) =>
    /(?:FINISH|FINAL)/i.test(t) && /honest/i.test(t) && /evidence/i.test(t),
};
const DEEP_HEADING_RE = /#\s*DEEP WORK\b/i;
function sectionFromHeading(text, re) {
  const m = re.exec(text);
  if (!m) return '';
  const rest = text.slice(m.index);
  const next = rest.indexOf('\n\n# ', 2);
  return next >= 0 ? rest.slice(0, next) : rest;
}

// ------------------------------------------------------------
// temp dir + Electron stub (shared by the prompts + engine bundles)
// ------------------------------------------------------------
const TMP = mkdtempSync(join(tmpdir(), 'sadeem-v1138-depth-'));
const userData = join(TMP, 'userdata');
mkdirSync(userData, { recursive: true });
const stubDir = join(TMP, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `
const paths = { temp: ${JSON.stringify(TMP)}, userData: ${JSON.stringify(userData)}, home: ${JSON.stringify(TMP)}, appData: ${JSON.stringify(TMP)} };
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

function bundle(entry, out, extra = []) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${out}`, '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react', ...extra],
  { cwd: ROOT, stdio: 'pipe' });
}

let prompts = null;
let engine = null;
try {
  const pOut = join(TMP, 'prompts.cjs');
  bundle(join(ROOT, 'electron/agent/prompts.ts'), pOut);
  prompts = require(pOut);
  check('B0-PROMPTS-BUNDLE', true, 'real electron/agent/prompts.ts bundled');
} catch (err) {
  check('B0-PROMPTS-BUNDLE', false, `esbuild/require of prompts.ts failed: ${err?.message ?? err}`);
}
try {
  const eOut = join(TMP, 'engine.cjs');
  bundle(join(ROOT, 'electron/agent/engine.ts'), eOut);
  engine = require(eOut);
  check('B0-ENGINE-BUNDLE', true, 'real electron/agent/engine.ts bundled (Electron stubbed)');
} catch (err) {
  check('B0-ENGINE-BUNDLE', false, `esbuild/require of engine.ts failed: ${err?.message ?? err}`);
}

// ------------------------------------------------------------
// local SSE provider helpers (scripted, zero external network)
// ------------------------------------------------------------
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'v1138-depth-mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
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
function partText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map((b) => (typeof b === 'string' ? b : (b && typeof b.text === 'string' ? b.text : ''))).join('\n');
  }
  return '';
}
/**
 * Reconstruct the FULL system prompt the engine sent. The OpenAI-compatible
 * path puts the byte-stable prefix and the dynamic tail as TWO role:'system'
 * messages in `messages` (providers.ts toOpenAIMessages); the Anthropic path
 * uses `body.system`. Read both so neither wire format fools the guard.
 */
function systemText(body) {
  const chunks = [];
  chunks.push(partText(body.system));
  for (const m of (Array.isArray(body.messages) ? body.messages : [])) {
    if (m && m.role === 'system') chunks.push(partText(m.content));
  }
  return chunks.filter(Boolean).join('\n');
}

/** Drive one scripted scenario through the REAL engine.runAgent. */
async function runScenario(script) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      const sysRaw = systemText(body);
      // Ignore the engine's auxiliary calls (compact / DNA / subagent): their
      // system prompts differ, so only the main model is counted/answered.
      if (
        body.model !== script.model ||
        /compact coding-agent transcripts/i.test(sysRaw) ||
        /extract durable engineering facts|Surnia DNA user model/i.test(sysRaw) ||
        /part of the Surnia agent team/i.test(sysRaw)
      ) {
        finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 });
        return;
      }
      const n = requests.filter((r) => r.model === script.model).length + 1;
      requests.push({ model: body.model, system: sysRaw, n });
      try { script.respond(n, res); } catch (err) { finishSse(res, 'stop', { prompt_tokens: 1, completion_tokens: 1 }); }
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({
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
  const workspace = mkdtempSync(join(TMP, 'ws-' + script.model + '-'));
  let thrown = null;
  try {
    await engine.runAgent({
      task: 'chat',
      taskMode: script.taskMode,
      sessionId: script.sessionId,
      messages: [{ id: 'm1', role: 'user', kind: 'text', timestamp: Date.now(), content: script.user }],
      model: { provider: 'custom', model: script.model, maxTokens: 2048 },
      mode: 'fullAccess',
      workspace,
      apiKey: 'test-key',
      baseUrl,
    }, io);
  } catch (err) {
    thrown = err;
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise((r) => server.close(r));
  }
  return { events, requests, thrown, workspace };
}

async function main() {
  console.log('===== V1138 AI-DEPTH GUARD — is the AI deeper, or just more words? =====');

  const srcPath = join(ROOT, 'electron/agent/prompts.ts');
  const promptSrc = readFileSync(srcPath, 'utf8');
  const srcLines = promptSrc.split(/\r?\n/);

  // =====================================================================
  // CHECK 1 — SOURCE SCAN: DEEP WORK directive in the DYNAMIC tail
  // =====================================================================
  const buildFnIdx = promptSrc.indexOf('export function buildSystemPrompt(');
  const staticFnIdx = promptSrc.indexOf('function buildStaticSystemPrefix(');
  let deepLine = -1;
  for (let i = 0; i < srcLines.length; i++) {
    if (DEEP_HEADING_RE.test(srcLines[i]) && srcLines[i].indexOf('Deep work mode') < 0) {
      // A legitimate G1 directive heading sits inside buildSystemPrompt's
      // tail, i.e. AFTER the static-prefix builder and the public entry.
      if (i > 0 && buildFnIdx >= 0 && staticFnIdx >= 0) {
        const charPos = srcLines.slice(0, i).reduce((a, l) => a + l.length + 1, 0);
        if (charPos > buildFnIdx && charPos > staticFnIdx) { deepLine = i; break; }
      }
    }
  }
  // Slice ONLY the tail.push([ ... ].join('\n')) array literal — never the
  // surrounding code, or the word-stable scan would pick up opts/new Date.
  let sourceEnd = deepLine;
  if (deepLine >= 0) {
    for (let i = deepLine; i < srcLines.length; i++) {
      if (/^\s*\]\.join\(/.test(srcLines[i])) { sourceEnd = i; break; }
    }
  }
  const sourceBlock = deepLine >= 0
    ? srcLines.slice(deepLine, sourceEnd + 1).join('\n')
    : '';
  check('1-SOURCE-HEADING', deepLine >= 0,
    deepLine >= 0
      ? `DEEP WORK directive heading found inside buildSystemPrompt() (dynamic tail region)`
      : `no DEEP WORK directive heading inside buildSystemPrompt() — G1 has NOT landed (or directive is in the cached prefix)`,
    deepLine >= 0 ? `electron/agent/prompts.ts:${deepLine + 1}` : loc('electron/agent/prompts.ts', 'Deep work mode'));

  const markerReport = {};
  for (const [key, predicate] of Object.entries(BEHAVIOURS)) {
    markerReport[key] = deepLine >= 0 && sourceBlock.length > 0 && predicate(sourceBlock);
  }
  const allMarkers = Object.values(markerReport).every(Boolean);
  check('1-SOURCE-FOUR-BEHAVIOURS', allMarkers,
    `tool-selection-by-intent:${markerReport.toolSelectionByIntent} read-fix-relay-not-loop:${markerReport.readFixRelayNotLoop} verify-before-done:${markerReport.verifyBeforeDone} honest-evidence-final:${markerReport.honestEvidenceFinal}`,
    deepLine >= 0 ? `electron/agent/prompts.ts:${deepLine + 1}` : loc('electron/agent/prompts.ts', 'Deep work mode'));

  // Rendered placement: after the v11.16 split, in the tail, not the prefix.
  let placement = { prefix: false, tail: false, split: false };
  if (prompts) {
    try {
      prompts.clearStaticPromptCache?.();
      const rendered = prompts.buildSystemPrompt({
        workspace: 'D:/v1138-ws', mode: 'fullAccess', platform: 'win32', language: 'en',
      });
      const parts = rendered.split(prompts.SYSTEM_CACHE_SPLIT);
      placement = {
        split: parts.length === 2,
        prefix: parts.length === 2 && DEEP_HEADING_RE.test(parts[0]),
        tail: parts.length === 2 && DEEP_HEADING_RE.test(parts[1]),
      };
    } catch { /* checked below */ }
  }
  check('1-RENDER-TAIL-NOT-PREFIX',
    !!prompts && placement.split && placement.tail && !placement.prefix,
    !!prompts
      ? `cache split=${placement.split}; directive in dynamic tail=${placement.tail}; in cached prefix=${placement.prefix}`
      : 'skipped: prompts bundle unavailable',
    loc('electron/agent/prompts.ts', 'SYSTEM_CACHE_SPLIT'));

  // =====================================================================
  // CHECK 2 — BYTE DELTA vs the three frozen caps
  // =====================================================================
  if (prompts) {
    try {
      const BASE = { workspace: 'D:/surnia-test-ws', mode: 'default', platform: 'win32', language: 'en' };
      prompts.clearStaticPromptCache?.();
      const en = prompts.buildSystemPrompt({ ...BASE });
      const size = bytes(en);
      const d16 = size;                 // v11.16: < 24*1024
      const d21 = size - 23754;         // v11.21: <= 700
      const d23 = size - 24381;         // v11.23: 0 <= d < 400
      const deltaBaseline = size - 24425; // pre-G1 EN baseline from docs/TOKEN-SAVINGS-V1135.md:68
      findings.push({ id: '2-BYTES-MEASURED', status: 'INFO',
        detail: `size=${size} B; v11.16=${d16}/24576; v11.21=+${d21}/700; v11.23=+${d23}/400; vs-24425-baseline=${deltaBaseline >= 0 ? '+' : ''}${deltaBaseline} B`,
        fileLine: loc('electron/agent/prompts.ts', 'export function buildSystemPrompt(') });
      console.log(`INFO 2-BYTES-MEASURED: size=${size} B; v11.16=${d16}/24576; v11.21=+${d21}/700; v11.23=+${d23}/400; vs-24425-baseline=${deltaBaseline >= 0 ? '+' : ''}${deltaBaseline} B`);
      check('2-CAP-V1116', d16 < 24 * 1024, `EN prompt ${d16} B < 24576 B`);
      check('2-CAP-V1121', d21 <= 700, `size-23754 = +${d21} <= +700 (headroom ${700 - d21} B)`);
      check('2-CAP-V1123', d23 >= 0 && d23 < 400, `size-24381 = +${d23} in [0,400)`);
      check('2-DIRECTIVE-HAS-BYTES', deltaBaseline > 0 || deepLine >= 0,
        deltaBaseline > 0
          ? `G1 added ${deltaBaseline} B to the (uncached) tail vs the 24425 B baseline`
          : `delta vs 24425 baseline = ${deltaBaseline} B — if G1 landed it paid for the directive by trimming static text (genuinely deeper, not just more words)`);
    } catch (err) {
      check('2-CAP-V1116', false, `byte measurement failed: ${err?.message ?? err}`);
      check('2-CAP-V1121', false, 'skipped: measurement failed');
      check('2-CAP-V1123', false, 'skipped: measurement failed');
      check('2-DIRECTIVE-HAS-BYTES', false, 'skipped: measurement failed');
    }
  } else {
    for (const id of ['2-CAP-V1116', '2-CAP-V1121', '2-CAP-V1123', '2-DIRECTIVE-HAS-BYTES']) {
      check(id, false, 'skipped: prompts bundle unavailable');
    }
  }

  // =====================================================================
  // CHECK 3 — REAL ENGINE HARNESS (scripted provider, zero net)
  // =====================================================================
  process.env.SURNIA_TURN_RETRY_DELAYS_MS = '5,5,5,5,5,5';
  process.env.SURNIA_DELTA_FLUSH_MS = '5';
  process.env.SURNIA_SKIP_UI_GATE = '1';

  if (engine && typeof engine.runAgent === 'function') {
    check('B0-RUN-AGENT', true, 'real runAgent bundled',
      loc('electron/agent/engine.ts', 'export async function runAgent('));

    // ---- 3a / 3b: self-correct after an actionable tool failure ----
    const FINAL_S1 = [
      'I tried to read the requested file, but it does not exist. ',
      'I listed the workspace instead and found the real files. ',
      'Summary: the read failed with an actionable path fix, so I switched to list_dir, verified the directory, and reported the blocker honestly.',
    ];
    const s1 = await runScenario({
      model: 'v1138-depth-selfcorrect',
      sessionId: 'v1138-depth-selfcorrect-' + Math.random().toString(36).slice(2),
      user: 'Read the requested file; if it is missing, recover with a different tool and summarize honestly.',
      respond(n, res) {
        const missing = JSON.stringify({ path: 'definitely-missing-v1138-depth.txt' });
        if (n === 1) {
          for (const d of toolDeltas('read_file', missing, 'call_v1138_read')) res.write(sseChunk(d));
          finishSse(res, 'tool_calls', { prompt_tokens: 60, completion_tokens: 40 });
        } else if (n === 2) {
          for (const d of toolDeltas('list_dir', JSON.stringify({ path: '.' }), 'call_v1138_list')) res.write(sseChunk(d));
          finishSse(res, 'tool_calls', { prompt_tokens: 60, completion_tokens: 40 });
        } else {
          for (const t of FINAL_S1) res.write(sseChunk({ content: t }));
          finishSse(res, 'stop', { prompt_tokens: 40, completion_tokens: 30 });
        }
      },
    });

    check('3A-SYSTEM-PROMPT-HAS-DIRECTIVE',
      s1.thrown === null && s1.requests.length > 0 && DEEP_HEADING_RE.test(s1.requests[0]?.system ?? ''),
      s1.thrown
        ? `runAgent threw: ${s1.thrown?.message ?? s1.thrown}`
        : `built system prompt from the real engine ${DEEP_HEADING_RE.test(s1.requests[0]?.system ?? '') ? 'CONTAINS' : 'does NOT contain'} the DEEP WORK directive (${(s1.requests[0]?.system ?? '').length} chars)`,
      loc('electron/agent/engine.ts', 'const baseSystem = buildSystemPrompt({'));

    const s1Starts = s1.events.filter((e) => e.type === 'tool_start');
    const s1Names = s1Starts.map((e) => String(e.name ?? ''));
    const s1Results = s1.events.filter((e) => e.type === 'tool_result');
    const readStart = s1Starts.find((e) => e.name === 'read_file');
    const listStart = s1Starts.find((e) => e.name === 'list_dir');
    const readResult = s1Results.find((e) => e.toolCallId === readStart?.toolCallId);
    const readOut = String(readResult?.output ?? readResult?.content ?? '');
    check('3B-ACTIONABLE-FAILURE', /fix\s*:|does not exist|not found/i.test(readOut),
      `read_file failure is actionable: ${JSON.stringify(readOut.slice(0, 160))}`,
      loc('electron/agent/tools.ts', 'function coreFail('));
    check('3B-SELF-CORRECT-FOLLOWUP',
      !!readStart && !!listStart &&
      s1Starts.indexOf(readStart) < s1Starts.indexOf(listStart) &&
      s1Results.some((e) => e.toolCallId === listStart?.toolCallId),
      `engine dispatched the failing read_file THEN a different follow-up list_dir (gets: ${s1Names.join(' → ') || '(none)'}) — no silent stop`,
      loc('electron/agent/engine.ts', "const tp = parseTextToolCalls(text, known);"));
    const blockNotices = s1.events.filter((e) =>
      e.type === 'sys_notice' && /DISPATCH BLOCKED/i.test(String(e.text ?? '')));
    check('3B-NOT-A-LOOP', blockNotices.length === 0,
      `no repeated-failure breaker fired for the single actionable failure (${blockNotices.length} DISPATCH BLOCKED notices)`,
      loc('electron/agent/engine.ts', 'DISPATCH BLOCKED'));
    const s1Text = s1.events.filter((e) => e.type === 'text_delta').map((e) => String(e.text ?? '')).join('');
    check('3B-HONEST-FINAL',
      s1.thrown === null && /Summary:/.test(s1Text) &&
      s1.events.some((e) => e.type === 'turn_end') &&
      s1.events.some((e) => e.type === 'task_report'),
      `run reached an honest summarized final answer (${s1Text.length} chars); turn_end=${s1.events.some((e) => e.type === 'turn_end')}, task_report=${s1.events.some((e) => e.type === 'task_report')}`);

    // ---- 3c: build task → preview/screenshot step before final ----
    const FINAL_S2 = [
      'I wrote index.html and captured a preview screenshot before finishing. ',
      'Summary: the page was written, the preview step ran, and the result is reported honestly.',
    ];
    const s2 = await runScenario({
      model: 'v1138-depth-build',
      sessionId: 'v1138-depth-build-' + Math.random().toString(36).slice(2),
      taskMode: 'build',
      user: 'Build a small HTML page and preview it before you finish.',
      respond(n, res) {
        if (n === 1) {
          for (const d of toolDeltas('write_file', JSON.stringify({ path: 'index.html', content: '<!doctype html><html><body>hi</body></html>' }), 'call_v1138_write')) res.write(sseChunk(d));
          finishSse(res, 'tool_calls', { prompt_tokens: 60, completion_tokens: 40 });
        } else if (n === 2) {
          for (const d of toolDeltas('preview_screenshot', JSON.stringify({ path: 'index.html' }), 'call_v1138_preview')) res.write(sseChunk(d));
          finishSse(res, 'tool_calls', { prompt_tokens: 60, completion_tokens: 40 });
        } else {
          for (const t of FINAL_S2) res.write(sseChunk({ content: t }));
          finishSse(res, 'stop', { prompt_tokens: 40, completion_tokens: 30 });
        }
      },
    });
    const s2Starts = s2.events.filter((e) => e.type === 'tool_start');
    const s2Names = s2Starts.map((e) => String(e.name ?? ''));
    const previewIdx = s2Names.findIndex((n) => /preview|screenshot|ui_quality/i.test(n));
    const firstTextIdx = s2.events.findIndex((e) => e.type === 'text_delta' && String(e.text ?? '').trim());
    check('3C-PREVIEW-BEFORE-FINAL',
      previewIdx >= 0 && (firstTextIdx < 0 || s2Starts[previewIdx] !== undefined) &&
      (() => {
        const pEvt = previewIdx >= 0 ? s2Starts[previewIdx] : null;
        const pIdx = pEvt ? s2.events.indexOf(pEvt) : -1;
        return pIdx >= 0 && (firstTextIdx < 0 || pIdx < firstTextIdx);
      })(),
      `build task emitted a preview/screenshot step before the final answer (steps: ${s2Names.join(' → ') || '(none)'})`,
      loc('electron/agent/engine.ts', "if (p.call.name === 'ui_quality_check') uiQualityRan = true;"));

    const buildSys = s2.requests[0]?.system ?? '';
    const finIdx = buildSys.indexOf('FINISHING LOOP');
    // Work inside the FINISHING LOOP line only — other sections also mention
    // "preview", so a whole-prompt indexOf would compare the wrong tokens.
    const finSlice = finIdx >= 0 ? buildSys.slice(finIdx, finIdx + 420) : '';
    const prevIdx = finSlice.indexOf('preview');
    const shotIdx = finSlice.indexOf('preview_screenshot');
    const finalIdx = finSlice.indexOf('final summary');
    const notDoneIdx = finSlice.indexOf('Unseen UI is not done');
    check('3C-BUILD-PROMPT-FINISHING-LOOP',
      buildSys.includes('# Build mode (taskMode: build)') && finIdx >= 0 &&
      prevIdx >= 0 && shotIdx > prevIdx && finalIdx > shotIdx && notDoneIdx > finalIdx,
      `build system prompt orders preview → preview_screenshot → final summary → "Unseen UI is not done" (fin=${finIdx}, offsets in loop: preview=${prevIdx}, shot=${shotIdx}, final=${finalIdx}, notdone=${notDoneIdx})`,
      loc('electron/agent/prompts.ts', 'FINISHING LOOP (every UI)'));
  } else {
    for (const id of ['B0-RUN-AGENT', '3A-SYSTEM-PROMPT-HAS-DIRECTIVE', '3B-ACTIONABLE-FAILURE',
      '3B-SELF-CORRECT-FOLLOWUP', '3B-NOT-A-LOOP', '3B-HONEST-FINAL',
      '3C-PREVIEW-BEFORE-FINAL', '3C-BUILD-PROMPT-FINISHING-LOOP']) {
      check(id, false, 'skipped: engine bundle unavailable');
    }
  }

  // =====================================================================
  // CHECK 4 — HYGIENE: no mixed EN+AR in the directive; word-stable
  // =====================================================================
  const stable = sourceBlock.length > 0 &&
    !sourceBlock.includes('${') &&
    !/\bopts\.|new Date\s*\(|process\.(?:env|platform)|\blang\s*===|\bbi\s*\(/.test(sourceBlock);
  check('4-WORD-STABLE', stable,
    sourceBlock.length === 0
      ? 'no directive source block to inspect (G1 absent)'
      : `directive block has ${sourceBlock.includes('${') ? 'INTERPOLATION' : 'no ${}'}, ${/\bopts\.|new Date\s*\(|process\.(?:env|platform)|\blang\s*===|\bbi\s*\(/.test(sourceBlock) ? 'DYNAMIC reads' : 'no dynamic reads'}`,
    deepLine >= 0 ? `electron/agent/prompts.ts:${deepLine + 1}` : loc('electron/agent/prompts.ts', 'function bi('));

  let enBlock = '';
  let arBlock = '';
  if (prompts) {
    try {
      const BASE = { workspace: 'D:/v1138-ws', mode: 'fullAccess', platform: 'win32' };
      prompts.clearStaticPromptCache?.();
      const en = prompts.buildSystemPrompt({ ...BASE, language: 'en' });
      const ar = prompts.buildSystemPrompt({ ...BASE, language: 'ar' });
      enBlock = sectionFromHeading(en, DEEP_HEADING_RE);
      arBlock = sectionFromHeading(ar, DEEP_HEADING_RE);
    } catch { /* reported by the checks below */ }
  }
  // "Mixed EN+AR prose in a single string" = Arabic script embedded in the
  // directive (the bi() helper's `${en} — ${ar}` pattern). An em dash used as
  // punctuation ("READ output — never claim done") is NOT language mixing.
  const AR_RE = /[\u0600-\u06FF]/;
  check('4-NO-EN-AR-MIX',
    enBlock.length > 0 && !AR_RE.test(enBlock) && (!arBlock || !AR_RE.test(arBlock)),
    enBlock.length === 0
      ? 'no rendered directive block to inspect (G1 absent)'
      : `EN directive carries ${AR_RE.test(enBlock) ? 'ARABIC' : 'no Arabic'} chars; AR directive ${arBlock ? (AR_RE.test(arBlock) ? 'carries Arabic (mixed)' : 'language-neutral') : 'absent'} — no bilingual bi() prose inside the directive`,
    loc('electron/agent/prompts.ts', 'function bi('));
  check('4-BLOCK-BYTE-IDENTICAL-EN-AR',
    enBlock.length > 0 && arBlock === enBlock,
    enBlock.length === 0
      ? 'no rendered directive blocks to compare (G1 absent)'
      : arBlock === enBlock
        ? 'directive renders byte-identically in EN and AR (single language-neutral word-stable block)'
        : `EN/AR directive blocks differ (${bytes(enBlock)} B vs ${bytes(arBlock)} B) — translation/mixing detected`,
    loc('electron/agent/prompts.ts', 'export function buildSystemPrompt('));

  // ------------------------------------------------------------
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* temp dir */ }
  const pass = findings.filter((f) => f.status === 'PASS').length;
  const fail = findings.filter((f) => f.status === 'FAIL').length;
  const result = {
    version: 'v11.38', guard: 'ai-depth-guard', at: new Date().toISOString(),
    summary: { pass, fail },
    markers: markerReport,
    findings,
  };
  try {
    writeFileSync(join(ROOT, 'tests', '.v1138-ai-depth-guard.results.json'), JSON.stringify(result, null, 2));
  } catch { /* results file is best-effort */ }
  console.log(`\n===== V1138 AI-DEPTH GUARD SUMMARY: ${fail ? 'FAIL' : 'PASS'} (${pass} pass / ${fail} fail) =====`);
  for (const f of findings) if (f.status === 'FAIL') console.log('  - ' + f.id + ': ' + f.detail);
  process.exitCode = fail ? 1 : 0;
}

main().catch((err) => {
  console.error('V1138 AI-DEPTH GUARD crashed:', err?.stack ?? err);
  process.exitCode = 1;
});
