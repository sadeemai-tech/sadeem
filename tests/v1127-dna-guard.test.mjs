import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.27 — DNA VERIFICATION GUARD (DIAGNOSIS / TEST ONLY)
// ------------------------------------------------------------
// The founder: "ال dna لا يعمل" (DNA does not work).
// This suite is an INDEPENDENT check with REAL artifacts. It does
// NOT mock the DNA module: it boots the REAL agent engine (freshly
// esbuild-bundled from source) against a scripted LOCAL OpenAI-
// compatible provider (node:http — zero network), with an isolated
// userData dir, and asserts the four links of the chain:
//
//   1. a real engine run produces a learnable pattern, and that
//      pattern is PHYSICALLY in <userData>/dna.json on disk;
//   2. `dna_updated` reaches the IO stream AND the kdx:dna:event IPC
//      channel the renderer store subscribes to; the store then
//      reloads real DNA and `/dna` prints REAL counts (store bundle);
//   3. a SECOND run's built system prompt still carries the
//      accumulated DNA patterns AFTER the v11.16 cache split
//      (dynamic tail, not the cached static prefix);
//   4. caps are honest: new facts kept, oldest/weakest reinforced
//      evicted, no silent loss in the normal range.
//
// Source lines under test (report failures with these):
//   electron/agent/engine.ts:3863-3889  post-run DNA extraction trigger
//   electron/agent/engine.ts:6460-6546  learnDNAFacts (no-tools model call)
//   electron/agent/engine.ts:2414-2442  DNA → buildSystemPrompt
//   electron/agent/dna.ts:329-402       mergeExtraction (dedupe/confidence/prune)
//   electron/agent/dna.ts:410-421       mergeExtractionInto (disk + emitDNAEvent)
//   electron/agent/dna.ts:489-530       renderDNAPrompt
//   electron/agent/prompts.ts:908-962   DNA in dynamic tail after cache split
//   src/store.ts:2613-2627              onDnaEvent → loadDna
//   src/store.ts:3295-3349              /dna renders real counts
//
// Run:
//   node --test --test-force-exit tests/v1127-dna-guard.test.mjs
// Debug:
//   V1127_DEBUG=1 node --test --test-force-exit tests/v1127-dna-guard.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync,
  existsSync, statSync, unlinkSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1127-dna-'));
const USERDATA = join(tmp, 'userdata');
mkdirSync(USERDATA, { recursive: true });

const DEBUG = !!process.env.V1127_DEBUG;
const PATTERN_TEXT = 'Always run typecheck before committing';
const EXTRACT_JSON = JSON.stringify({
  profile_additions: { expertise: ['TypeScript'] },
  patterns_additions: [{ kind: 'workflow', text: PATTERN_TEXT }],
});

// ---------- electron stub with a recording BrowserWindow ----------
// engine.ts / dna.ts call require('electron'); the stub lives next to the
// freshly-bundled modules so every bundle resolves the SAME instance.
const STUB_DIR = join(tmp, 'node_modules', 'electron');
mkdirSync(STUB_DIR, { recursive: true });
writeFileSync(join(STUB_DIR, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(STUB_DIR, 'index.js'),
  'const sent = globalThis.__dnaGuardSent || (globalThis.__dnaGuardSent = []);\n' +
  'module.exports = {\n' +
  '  app: { getPath: () => ' + JSON.stringify(USERDATA) + ', whenReady: async () => true, isReady: () => true, on() {}, quit() {} },\n' +
  '  ipcMain: { handle() {}, on() {} },\n' +
  '  // dna.ts emitDNAEvent() pushes {type:"updated"} to every live renderer.\n' +
  '  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (ch, payload) => sent.push({ ch, payload }) } }] },\n' +
  '  Notification: { isSupported: () => false },\n' +
  '  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },\n' +
  '  shell: {}, screen: {}, powerMonitor: { on() {} }, clipboard: { readText: () => \'\', writeText() {} },\n' +
  '};\n',
);
globalThis.__dnaGuardSent = [];

process.env.SURNIA_HOME = USERDATA;
process.env.SURNIA_TURN_RETRY_DELAYS_MS = '8,8,8,8';
process.env.SURNIA_DELTA_FLUSH_MS = '20';

// ---------- fresh bundles from CURRENT source (picks up F5 changes) ----------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
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
  ], { cwd: ROOT, stdio: 'pipe' });
}

let engine, dna, prompts, providers;
try {
  bundle('electron/agent/engine.ts', join(tmp, 'engine.cjs'));
  bundle('electron/agent/dna.ts', join(tmp, 'dna.cjs'));
  bundle('electron/agent/prompts.ts', join(tmp, 'prompts.cjs'));
  bundle('electron/agent/providers.ts', join(tmp, 'providers.cjs'));
  engine = require(join(tmp, 'engine.cjs'));
  dna = require(join(tmp, 'dna.cjs'));
  prompts = require(join(tmp, 'prompts.cjs'));
  providers = require(join(tmp, 'providers.cjs'));
} catch (err) {
  console.error('[v1127] BUNDLE FAILED — the DNA path cannot be verified at all:', err?.message ?? err);
  throw err;
}

const DNA_PATH = join(USERDATA, 'dna.json');
const STATS_PATH = join(USERDATA, 'dna-stats.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resetDna() {
  for (const f of [DNA_PATH, STATS_PATH]) { try { unlinkSync(f); } catch { /* absent */ } }
  globalThis.__dnaGuardSent.length = 0;
}
function readDnaFile() {
  return existsSync(DNA_PATH) ? JSON.parse(readFileSync(DNA_PATH, 'utf8')) : null;
}
async function waitFor(pred, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(40);
  }
  return false;
}

// ---------- local scripted OpenAI-compatible provider ----------
function writeSettings(baseUrl, dnaEnabled = true) {
  writeFileSync(
    join(USERDATA, 'settings.json'),
    JSON.stringify({
      schemaVersion: 4,
      dnaEnabled,
      providers: { custom: { apiKey: 'test-key', baseUrl } },
      agent: {
        maxRetries: 0, autoCompact: false, autoVerify: false,
        selfCritique: false, runAndShow: false, claimAudit: false, goalVerifier: false,
      },
      doneNotifications: false,
    }),
  );
}

const sseHeaders = (res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  res.flushHeaders();
};
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'dna-guard', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
function finishSse(res) {
  res.write(sseChunk({}, 'stop'));
  res.write('data: [DONE]\n\n');
  res.end();
}

function startMock(opts = {}) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* keep {} */ }
      const sys = (body.messages ?? [])
        .filter((m) => m && m.role === 'system')
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .join('\n');
      requests.push({ body, sys, at: Date.now() });
      sseHeaders(res);

      if (/You maintain the Surnia DNA user model/i.test(sys)) {
        // learnDNAFacts() no-tools call — return the learnable pattern JSON.
        res.write(sseChunk({ content: EXTRACT_JSON }));
        finishSse(res);
        return;
      }
      if (/Living Playbook|project memory file|project memory/i.test(sys)) {
        finishSse(res); // secondary learners: nothing to add
        return;
      }
      const sawTool = (body.messages ?? []).some((m) => m && m.role === 'tool');
      if (opts.noteTool && !sawTool) {
        // Turn 1: call the dna_note tool (a second, tool-driven DNA write path).
        const args = JSON.stringify({ kind: 'workflow', note: 'Always use pnpm for installs' });
        res.write(sseChunk({ tool_calls: [{ index: 0, id: 'call_dna_note', type: 'function', function: { name: 'dna_note', arguments: args } }] }));
        res.write(sseChunk({}, 'tool_calls'));
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      // Main turn: a plain final answer, no tool calls → run completes.
      res.write(sseChunk({ content: 'Done — the DNA guard ran.\n' }));
      finishSse(res);
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

function makeIo() {
  const events = [];
  return {
    events,
    send(e) {
      events.push({ type: e.type, reason: e.reason, kind: e.kind, text: e.text ?? e.message ?? '' });
    },
    async getDecision(requestId) { return { requestId, action: 'allow' }; },
    isAborted: () => false,
    onFetchSignal() {},
  };
}

async function driveRun(mock, workspace, label, dnaEnabled = true) {
  const io = makeIo();
  writeSettings(`http://127.0.0.1:${mock.port}/v1`, dnaEnabled);
  await engine.runAgent(
    {
      task: 'chat',
      sessionId: 'v1127-' + label + '-' + Math.random().toString(36).slice(2),
      messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Work the task normally, then report what you did.', timestamp: Date.now() }],
      model: { provider: 'custom', model: 'dna-guard', maxTokens: 2048 },
      mode: 'fullAccess',
      workspace,
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${mock.port}/v1`,
    },
    io,
  );
  return io;
}

// ============================================================
// 1 + 2 + 3 — the real engine chain
// ============================================================
test('v11.27 DNA guard: real run → dna.json → events → store → second-run prompt', async (t) => {
  const mock = await startMock();
  const workspace = join(tmp, 'ws');
  mkdirSync(workspace, { recursive: true });
  resetDna();
  try {
    // ---- 1. real engine run physically writes the learned pattern ----
    const io = await driveRun(mock, workspace, 'run1');
    const wroteFile = await waitFor(() => existsSync(DNA_PATH));
    assert.ok(
      wroteFile,
      'FAIL electron/agent/engine.ts:3868 / dna.ts:416 — no <userData>/dna.json after a completed chat run',
    );
    const disk = readDnaFile();
    assert.ok(
      disk && disk.patterns.some((p) => p.text === PATTERN_TEXT),
      'FAIL electron/agent/dna.ts:377-389 — extracted pattern missing from dna.json on disk',
    );
    assert.ok(disk.stats.sessionsObserved >= 1, 'FAIL dna.ts:414 — sessionsObserved not bumped');
    assert.ok(disk.stats.factsRecorded >= 1, 'FAIL dna.ts:388 — factsRecorded not bumped');
    if (DEBUG) console.error('[v1127] dna.json on disk:', JSON.stringify(disk));
    await t.test('1 · dna.json physically contains the learned pattern', () => {
      const st = statSync(DNA_PATH);
      assert.ok(st.size > 0, 'dna.json is non-empty');
    });

    // ---- 2. dna_updated stream event + kdx:dna:event IPC → store → /dna ----
    await waitFor(() => io.events.some((e) => e.type === 'dna_updated'));
    assert.ok(
      io.events.some((e) => e.type === 'dna_updated' && e.reason === 'extraction'),
      'FAIL electron/agent/engine.ts:3876-3879 — dna_updated(extraction) never reached the IO stream',
    );
    await waitFor(() => globalThis.__dnaGuardSent.some((x) => x.ch === 'kdx:dna:event' && x.payload?.type === 'updated'));
    assert.ok(
      globalThis.__dnaGuardSent.some((x) => x.ch === 'kdx:dna:event' && x.payload?.type === 'updated'),
      'FAIL electron/agent/dna.ts:810-818 — kdx:dna:event {type:"updated"} never reached the renderer channel',
    );
    if (DEBUG) console.error('[v1127] stream events:', JSON.stringify(io.events.filter((e) => /dna/i.test(e.type))));

    // Bundle the REAL renderer store and prove the subscription + /dna command.
    bundle('src/store.ts', join(tmp, 'store.cjs'));
    let dnaCb = null;
    const dnaGetCalls = [];
    const bridge = new Proxy({}, {
      get(_t, key) {
        if (key === 'then' || typeof key === 'symbol') return undefined;
        if (key === 'onDnaEvent') return (cb) => { dnaCb = cb; };
        if (key === 'dnaGet') return async (ws) => {
          dnaGetCalls.push(ws);
          return dna.loadDNA(typeof ws === 'string' ? ws : undefined);
        };
        if (key === 'dnaStats') return async () => ({
          sessionsObserved: disk.stats.sessionsObserved,
          patterns: disk.patterns.length,
          feedback: disk.feedback.length,
          growth: [],
        });
        if (key === 'getSettings') return async () => ({ language: 'en' });
        if (key === 'listSessions') return async () => [];
        if (key === 'authCurrent') return async () => null;
        return (..._a) => Promise.resolve(undefined);
      },
    });
    globalThis.window = {
      surnia: bridge,
      confirm: () => true,
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => true,
    };
    globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    globalThis.matchMedia = () => ({ matches: false });
    globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
    globalThis.cancelAnimationFrame = () => {};
    const { useStore } = require(join(tmp, 'store.cjs'));
    await useStore.getState().init();
    assert.equal(typeof dnaCb, 'function', 'FAIL src/store.ts:2615 — store never subscribed via onDnaEvent');

    // The real IPC payload the main process sends:
    dnaCb({ type: 'updated', payload: { reason: 'extraction' } });
    const reloaded = await waitFor(() => (useStore.getState().dna?.patterns?.length ?? 0) >= 1, 4000);
    assert.ok(reloaded, 'FAIL src/store.ts:2616-2617 — updated event did not reload DNA into the store');
    assert.ok(dnaGetCalls.length >= 1, 'FAIL src/store.ts:2617 — loadDna() did not call dnaGet');
    const storeCount = useStore.getState().dna.patterns.length;
    assert.equal(storeCount, disk.patterns.length, 'FAIL src/store.ts:5116 — store DNA counts differ from dna.json');

    useStore.setState({
      wsPath: workspace,
      session: {
        id: 's1', title: 't', workspace,
        messages: [{ id: 'u1', role: 'user', kind: 'text', content: 'previous turn', timestamp: Date.now() }],
        createdAt: Date.now(), updatedAt: Date.now(), messageCount: 1, totalTokens: 0, totalCostUsd: 0,
      },
      settings: { ...useStore.getState().settings, language: 'en' },
      running: false,
    });
    await useStore.getState().sendMessage('/dna');
    const msgs = useStore.getState().session?.messages ?? [];
    const reply = msgs.filter((m) => m.role === 'assistant').map((m) => String(m.content ?? '')).join('\n');
    assert.match(reply, /SADEEM DNA — \d+ patterns/, 'FAIL src/store.ts:3331 — /dna did not print real pattern counts');
    assert.ok(reply.includes(String(storeCount)), 'FAIL src/store.ts:3325 — /dna count != real store count');
    assert.ok(reply.includes(PATTERN_TEXT), 'FAIL src/store.ts:3337 — /dna did not show the real learned pattern');
    if (DEBUG) console.error('[v1127] /dna reply:', reply);
    await t.test('2 · dna_updated reaches the store and /dna shows real counts', () => {
      assert.ok(reply.includes(String(disk.patterns.length)));
    });

    // ---- 3. SECOND run: accumulated DNA survives the v11.16 cache split ----
    mock.requests.length = 0;
    await driveRun(mock, workspace, 'run2');
    await waitFor(() => mock.requests.some((r) => !/You maintain the Surnia DNA user model|Living Playbook|project memory file/i.test(r.sys)), 6000);
    const main = mock.requests.filter((r) => !/You maintain the Surnia DNA user model|Living Playbook|project memory file/i.test(r.sys));
    assert.ok(main.length >= 1, 'no main-run provider request was observed on the second run');
    const sysMsgs = main[0].body.messages.filter((m) => m && m.role === 'system');
    const allSys = sysMsgs.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    assert.ok(
      allSys.includes('# User DNA'),
      'FAIL electron/agent/engine.ts:2421 / prompts.ts:923 — second run built no # User DNA section',
    );
    assert.ok(
      allSys.includes(PATTERN_TEXT),
      'FAIL electron/agent/prompts.ts:923 — accumulated DNA pattern was DROPPED from the second run prompt',
    );
    // The cache split must place DNA in the uncached dynamic tail, never in
    // the byte-stable cached prefix (engine.ts:2442 → prompts.ts:962 →
    // providers.ts:1680/1828).
    const dynamicTail = sysMsgs.find((m) => !m.cache_control && String(m.content ?? '').includes('# User DNA'));
    assert.ok(
      dynamicTail && String(dynamicTail.content).includes(PATTERN_TEXT),
      'FAIL electron/agent/prompts.ts:962 / providers.ts:1829 — DNA not in the uncached dynamic system message',
    );
    if (DEBUG) console.error('[v1127] second-run system messages:', sysMsgs.map((m) => ({ cached: !!m.cache_control, len: String(m.content ?? '').length, dna: String(m.content ?? '').includes(PATTERN_TEXT) })));

    // Also verify the gateway-downgrade shape (cache_control rejected: one
    // merged system message) keeps the DNA tail — providers.ts:1831.
    const rebuilt = sysMsgs.map((m) => String(m.content ?? '')).join('\n\n' + prompts.SYSTEM_CACHE_SPLIT + '\n\n');
    const downgraded = providers.toOpenAIMessages(rebuilt, [{ role: 'user', text: 'hi' }], { cache: false });
    const downgradedSys = downgraded.filter((m) => m.role === 'system').map((m) => String(m.content ?? '')).join('\n');
    assert.ok(
      downgradedSys.includes(PATTERN_TEXT),
      'FAIL electron/agent/providers.ts:1831 — DNA lost when cache_control is downgraded',
    );
    await t.test('3 · second run prompt includes accumulated DNA after cache split', () => {
      assert.ok(dynamicTail.content.includes(PATTERN_TEXT));
      assert.ok(downgradedSys.includes(PATTERN_TEXT));
    });
  } finally {
    await mock.stop();
    try { rmSync(workspace, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ============================================================
// 4 — honest caps (pure merge, deterministic timestamps)
// ============================================================
function emptyDna() {
  return {
    version: 1,
    profile: { expertise: [], languages: [], likes: [], dislikes: [], styleNotes: [] },
    patterns: [],
    feedback: [],
    stats: { sessionsObserved: 0, factsRecorded: 0, updatedAt: 0 },
  };
}
function pattern(i, ageDays, count = 1, confidence = 0.4) {
  const ts = Date.now() - ageDays * 86_400_000;
  return { id: 'p' + i, kind: 'workflow', text: 'Pattern number ' + i, count, firstSeen: ts, lastSeen: ts, confidence };
}

test('v11.27 DNA guard: caps are honest (new kept, weakest/oldest evicted, no silent loss)', () => {
  // Normal range: nothing is dropped.
  const base = emptyDna();
  base.patterns = Array.from({ length: 20 }, (_, i) => pattern(i, 1));
  base.feedback = Array.from({ length: 5 }, (_, i) => ({ ts: Date.now() - i * 1000, kind: 'correction', note: 'fb' + i }));
  const adds = [21, 22, 23].map((i) => ({ kind: 'workflow', text: 'Pattern number ' + i }));
  const r1 = dna.mergeExtraction(base, { patterns_additions: adds });
  assert.equal(r1.dna.patterns.length, 23, 'FAIL dna.ts:397 — normal-range patterns silently dropped');
  assert.equal(r1.dna.feedback.length, 5, 'FAIL dna.ts:398 — normal-range feedback silently dropped');
  for (const a of adds) assert.ok(r1.dna.patterns.some((p) => p.text === a.text), 'new fact lost in normal range');

  // Repetition hardens an existing pattern instead of duplicating it.
  const r2 = dna.mergeExtraction(r1.dna, {
    patterns_additions: [{ kind: 'correction', text: 'Pattern number 21' }, { kind: 'workflow', text: 'Pattern number 21' }],
  });
  const hardened = r2.dna.patterns.filter((p) => p.text === 'Pattern number 21');
  assert.equal(hardened.length, 1, 'FAIL dna.ts:359-375 — duplicate pattern created instead of reinforcing');
  assert.equal(hardened[0].count, 3, 'FAIL dna.ts:371 — count not incremented on repetition');
  assert.equal(hardened[0].kind, 'correction', 'FAIL dna.ts:374 — correction label not hardened');
  assert.ok(Math.abs(hardened[0].confidence - 0.85) < 1e-9, 'FAIL dna.ts:373 — confidence not raised by repetition');

  // At the cap: 60 existing (55 old+weak, 5 fresh) + 5 brand-new facts.
  const full = emptyDna();
  full.patterns = [
    ...Array.from({ length: 55 }, (_, i) => pattern(i, 40)),          // old + weak
    ...Array.from({ length: 5 }, (_, i) => pattern(100 + i, 0)),      // fresh
  ];
  const freshTexts = ['BRAND NEW A', 'BRAND NEW B', 'BRAND NEW C', 'BRAND NEW D', 'BRAND NEW E'];
  const r3 = dna.mergeExtraction(full, {
    patterns_additions: freshTexts.map((t) => ({ kind: 'style', text: t })),
  });
  assert.equal(r3.dna.patterns.length, 60, 'FAIL dna.ts:397 — cap of 60 not enforced');
  for (const t of freshTexts) assert.ok(r3.dna.patterns.some((p) => p.text === t), 'FAIL dna.ts:397 — new fact evicted while older weaker facts survived');
  const oldSurvivors = r3.dna.patterns.filter((p) => /^Pattern number /.test(p.text) && /^Pattern number (10[0-9]|[0-9])$/.test(p.text)).length;
  assert.ok(oldSurvivors <= 55, 'FAIL dna.ts:394-397 — cap overflow: no old pattern was evicted');

  // Feedback cap: only when genuinely over the limit.
  const manyFb = emptyDna();
  manyFb.feedback = Array.from({ length: 45 }, (_, i) => ({ ts: Date.now() - i * 1000, kind: 'correction', note: 'fb' + i }));
  const r4 = dna.mergeExtraction(manyFb, { patterns_additions: [{ kind: 'style', text: 'a genuinely new fact' }] });
  assert.equal(r4.dna.feedback.length, 40, 'FAIL dna.ts:398 — feedback cap of 40 not enforced');
  assert.ok(r4.dna.feedback.some((f) => f.note === 'fb0'), 'FAIL dna.ts:398 — newest feedback lost while older trimmed');
});

// ============================================================
// 5 — DIAGNOSTIC: the dna_note TOOL is a second DNA write path.
//     With auto-extraction disabled (dnaEnabled=false) it is the ONLY
//     writer. Does its write notify the renderer store via IPC?
// ============================================================
test('v11.27 DIAGNOSTIC: dna_note writes dna.json but does it emit kdx:dna:event updated?', async () => {
  const mock = await startMock({ noteTool: true });
  const workspace = join(tmp, 'ws-note');
  mkdirSync(workspace, { recursive: true });
  resetDna();
  try {
    await driveRun(mock, workspace, 'note', false); // dnaEnabled=false → no extraction fallback
    const disk = readDnaFile();
    assert.ok(
      disk && disk.patterns.some((p) => p.text === 'Always use pnpm for installs'),
      'FAIL electron/agent/tools.ts:3020 / dna.ts:453-479 — dna_note did not persist to dna.json',
    );
    await sleep(300);
    const ipcUpdated = globalThis.__dnaGuardSent.some((x) => x.ch === 'kdx:dna:event' && x.payload?.type === 'updated');
    assert.ok(
      ipcUpdated,
      'FAIL electron/agent/dna.ts:453-479 — recordAgentNote() writes DNA but never calls emitDNAEvent("updated"); ' +
        'the store (src/store.ts:2615) only reloads on kdx:dna:event, so a dna_note-only run leaves the UI stale',
    );
  } finally {
    await mock.stop();
    try { rmSync(workspace, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});
