// ============================================================
// SADEEM v11.34 — DNA VERIFICATION GUARD FOR V13's "DNA stops
// learning after a fixed number" FIX. DIAGNOSIS + TEST ONLY.
// NO application source is modified by this file.
//
// V13 is fixing: "DNA stops learning after a fixed number".
// AFTER V13 lands this guard asserts FOUR links with REAL artifacts:
//
//   1a. REAL engine runs with DISTINCT new facts → dna.json keeps
//       accumulating (1 → 2 → 3 → 4); nothing silently dropped.
//   1b. At the 60-pattern CAP a NEW fact from a REAL engine run is
//       KEPT and one OLD REINFORCED pattern is evicted — never the
//       reverse (the silent-drop bug that made DNA "stop learning").
//   2.  Learned facts reach the NEXT built system prompt's UNCACHED
//       dynamic tail, survive the no-cache downgrade, and reload from
//       disk in a FRESH module instance (restart simulation).
//   3.  Caps are honest + documented: bounded numeric constants,
//       lossless eviction, explicit 60/40 documentation, and NO false
//       "unlimited DNA" claim in product copy.
//   4.  ONE transient provider error on the extraction call does NOT
//       silently lose the fact — V13 must recover it.
//
// Source lines under test (failures are reported with these):
//   electron/agent/engine.ts:4207-4228  post-run DNA extraction trigger
//   electron/agent/engine.ts:7035-7101  learnDNAFacts (no-tools call, silent catch)
//   electron/agent/dna.ts:53-68         MAX_PATTERNS=60 / MAX_FEEDBACK=40 / DNA_LIMITS
//   electron/agent/dna.ts:385-390       dedupeKey (V13 full-text dedupe)
//   electron/agent/dna.ts:412-421       capPatternsLossless (evict reinforced)
//   electron/agent/dna.ts:434-502       mergeExtraction (dedupe/confidence/cap)
//   electron/agent/dna.ts:515-524       mergeExtractionInto (disk + IPC event)
//   electron/agent/dna.ts:597-680       renderDNAPrompt (8 slots, 4 newest, honest status)
//   electron/agent/dna.ts:718-747       dnaStats (cumulative factsRecorded growth)
//   electron/agent/prompts.ts:908-962   DNA in dynamic tail after cache split
//   electron/agent/providers.ts:1829/1831  system-message split / downgrade
//   src/store.ts:2613-2627              onDnaEvent → loadDna
//
// Run:  node --test --test-force-exit tests/v1134-dna-guard.test.mjs
// Debug: V1134_DEBUG=1 node --test --test-force-exit tests/v1134-dna-guard.test.mjs
// ============================================================
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync,
  existsSync, unlinkSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const DEBUG = !!process.env.V1134_DEBUG;
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1134-dna-'));
const USERDATA = join(tmp, 'userdata');
const WS = join(tmp, 'ws');
for (const d of [USERDATA, WS]) mkdirSync(d, { recursive: true });

process.env.SURNIA_HOME = USERDATA;
process.env.SURNIA_TURN_RETRY_DELAYS_MS = '8,8,8,8';
process.env.SURNIA_DELTA_FLUSH_MS = '20';

const RESULTS = join(ROOT, 'tests', '.v1134-dna-guard.results.json');
const findings = []; // { id, status, detail, fileLine }
function note(id, status, detail, fileLine) {
  findings.push({ id, status, detail, fileLine });
  console.log(`[${status}] ${id} — ${fileLine} — ${detail}`);
}
/** Wrap one guard: record a FAIL finding (with file:line) and rethrow. */
async function guard(id, fileLine, fn) {
  try {
    const detail = await fn();
    note(id, 'PASS', detail, fileLine);
  } catch (err) {
    note(id, 'FAIL', err?.message ?? String(err), fileLine);
    throw err;
  }
}

// ---------- electron stub (same instance for every bundle) ----------
const STUB_DIR = join(tmp, 'node_modules', 'electron');
mkdirSync(STUB_DIR, { recursive: true });
writeFileSync(join(STUB_DIR, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(STUB_DIR, 'index.js'),
  'const sent = globalThis.__v1134DnaSent || (globalThis.__v1134DnaSent = []);\n' +
  'module.exports = {\n' +
  '  app: { getPath: () => ' + JSON.stringify(USERDATA) + ', whenReady: async () => true, isReady: () => true, on() {}, quit() {}, getName: () => \'sadeem-v1134\', getVersion: () => \'0.0.0\' },\n' +
  '  ipcMain: { handle() {}, on() {}, removeAllListeners() {} },\n' +
  '  ipcRenderer: { invoke: async () => ({}), on() {}, send() {} },\n' +
  '  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (ch, payload) => sent.push({ ch, payload }) } }] },\n' +
  '  Notification: { isSupported: () => false },\n' +
  '  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },\n' +
  '  shell: {}, screen: {}, powerMonitor: { on() {} }, clipboard: { readText: () => \'\', writeText() {} },\n' +
  '  Menu: { buildFromTemplate: () => ({}) }, nativeImage: { createEmpty: () => ({}) }, dialog: {},\n' +
  '};\nmodule.exports.default = module.exports;\n',
);
globalThis.__v1134DnaSent = [];

// ---------- fresh bundles from CURRENT source ----------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${out}`, '--external:electron', '--external:@xterm/xterm',
    '--external:@xterm/addon-fit', '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}
const B = {};
let engine, dna, prompts, providers;
try {
  for (const [name, entry] of Object.entries({
    engine: 'electron/agent/engine.ts',
    dna: 'electron/agent/dna.ts',
    prompts: 'electron/agent/prompts.ts',
    providers: 'electron/agent/providers.ts',
  })) {
    B[name] = join(tmp, `${name}.cjs`);
    bundle(entry, B[name]);
  }
  engine = require(B.engine);
  dna = require(B.dna);
  prompts = require(B.prompts);
  providers = require(B.providers);
} catch (err) {
  console.error('[v1134] BUNDLE FAILED — the DNA path cannot be verified at all:', err?.message ?? err);
  throw err;
}
function freshDna() {
  delete require.cache[require.resolve(B.dna)];
  return require(B.dna);
}

const DNA_PATH = join(USERDATA, 'dna.json');
const STATS_PATH = join(USERDATA, 'dna-stats.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function readDnaFile() {
  return existsSync(DNA_PATH) ? JSON.parse(readFileSync(DNA_PATH, 'utf8')) : null;
}
function resetDna() {
  for (const f of [DNA_PATH, STATS_PATH]) { try { unlinkSync(f); } catch { /* absent */ } }
  globalThis.__v1134DnaSent.length = 0;
}
async function waitFor(pred, timeoutMs = 9000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return true;
    await sleep(40);
  }
  return false;
}

// ---------- local scripted OpenAI-compatible provider ----------
const sseHeaders = (res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  res.flushHeaders();
};
const sseChunk = (delta, finish = null) =>
  `data: ${JSON.stringify({ id: 'v1134', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
function finishSse(res) {
  res.write(sseChunk({}, 'stop'));
  res.write('data: [DONE]\n\n');
  res.end();
}
/**
 * @param {(callNo:number)=>{kind:'json',data:object}|{kind:'sse-error',message:string}} nextExtraction
 *   Called once per HTTP request that carries the real DNA_EXTRACT_SYSTEM header.
 */
function startMock(nextExtraction) {
  const requests = [];
  const sockets = new Set();
  let extractionCalls = 0;
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
        const callNo = ++extractionCalls;
        const script = nextExtraction(callNo) ?? { kind: 'json', data: {} };
        if (script.kind === 'sse-error') {
          // A TRANSPORT-200 transient provider error: the provider layer's
          // status-based retry (5xx/429) never sees it, and the current
          // learnDNAFacts catch silently drops it. V13 must recover.
          const errObj = { error: { message: script.message || 'temporary upstream glitch' } };
          res.write(`data: ${JSON.stringify(errObj)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        res.write(sseChunk({ content: JSON.stringify(script.data ?? {}) }));
        finishSse(res);
        return;
      }
      if (/Living Playbook|project memory file|project memory/i.test(sys)) {
        finishSse(res); // secondary learners: nothing to add
        return;
      }
      if (DEBUG && /You maintain the Surnia DNA user model/i.test(sys)) {
        console.error('[v1134] extraction request:', callNo);
      }
      res.write(sseChunk({ content: 'Done — the DNA guard ran.\n' }));
      finishSse(res);
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      requests,
      port: server.address().port,
      get extractionCalls() { return extractionCalls; },
      async stop() {
        for (const s of sockets) s.destroy();
        await new Promise((r) => server.close(r));
      },
    }));
  });
}

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
function makeIo() {
  const events = [];
  return {
    events,
    send(e) { events.push({ type: e.type, reason: e.reason, text: e.text ?? e.message ?? '' }); },
    async getDecision(requestId) { return { requestId, action: 'allow' }; },
    isAborted: () => false,
    onFetchSignal() {},
  };
}
async function driveRun(mock, label) {
  const io = makeIo();
  const baseUrl = `http://127.0.0.1:${mock.port}/v1`;
  writeSettings(baseUrl);
  await engine.runAgent(
    {
      task: 'chat',
      sessionId: 'v1134-' + label + '-' + Math.random().toString(36).slice(2),
      messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'Work the task normally, then report what you did.', timestamp: Date.now() }],
      model: { provider: 'custom', model: 'dna-guard', maxTokens: 2048 },
      mode: 'fullAccess',
      workspace: WS,
      apiKey: 'test-key',
      baseUrl,
    },
    io,
  );
  return io;
}
const src = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// ============================================================
// 1a — REAL engine runs, DISTINCT new facts, physical accumulation
// ============================================================
test('GUARD-1a: real engine runs accumulate distinct facts in dna.json', async () => {
  await guard('1a-accumulate',
    'electron/agent/engine.ts:4207-4228,7055-7097; electron/agent/dna.ts:434-502', async () => {
      resetDna();
      const facts = [];
      let n = 0;
      const mock = await startMock(() => {
        n += 1;
        const text = `V1134 DISTINCT FACT NUMBER ${n}: always use pnpm and write the failing test first`;
        facts.push(text);
        return { kind: 'json', data: { patterns_additions: [{ kind: 'workflow', text }] } };
      });
      try {
        for (let i = 0; i < 4; i++) {
          const io = await driveRun(mock, `acc${i}`);
          assert.ok(!io.events.some((e) => e.type === 'fatal'), `run ${i} emitted a fatal event`);
        }
        const ok = await waitFor(() => (readDnaFile()?.patterns?.length ?? 0) >= 4, 12000);
        assert.ok(ok, 'FAIL electron/agent/engine.ts:7086 / dna.ts:482-483 — no dna.json accumulation after 4 real runs');
        const disk = readDnaFile();
        assert.equal(
          disk.patterns.length, 4,
          'FAIL electron/agent/dna.ts:452 / 463 — expected 4 distinct facts in dna.json, got ' + disk.patterns.length,
        );
        for (const t of facts) {
          assert.ok(
            disk.patterns.some((p) => p.text === t),
            'FAIL electron/agent/engine.ts:7086 / dna.ts:452 — a distinct new fact was silently lost: ' + t,
          );
        }
        assert.ok(disk.stats.factsRecorded >= 4, 'FAIL electron/agent/dna.ts:454 — factsRecorded not incremented per new fact');
        if (DEBUG) console.error('[v1134] accumulated facts:', disk.patterns.map((p) => p.text));
        return `4/4 distinct facts physically present; factsRecorded=${disk.stats.factsRecorded}`;
      } finally {
        await mock.stop();
      }
    });
});

// ============================================================
// 1b — at the cap: NEW kept, old reinforced evicted (REAL engine)
// ============================================================
test('GUARD-1b: at MAX_PATTERNS a real-engine NEW fact is kept; one old reinforced pattern is evicted', async () => {
  await guard('1b-cap-eviction',
    'electron/agent/dna.ts:53-54,412-421,434-502; electron/agent/engine.ts:7096', async () => {
      resetDna();
      const now = Date.now();
      const old = Array.from({ length: 60 }, (_, i) => ({
        id: 'old-' + i,
        kind: 'workflow',
        text: `V1134 OLD REINFORCED PATTERN NUMBER ${i}: repeated workflow the user already mastered`,
        count: 10, // reinforced → high "forget" score → evicted first
        firstSeen: now - 45 * 86_400_000,
        lastSeen: now - 40 * 86_400_000,
        confidence: 0.95,
      }));
      writeFileSync(DNA_PATH, JSON.stringify({
        version: 1,
        profile: { expertise: [], languages: [], likes: [], dislikes: [], styleNotes: [] },
        patterns: old,
        feedback: [],
        stats: { sessionsObserved: 60, factsRecorded: 60, updatedAt: now - 86_400_000 },
      }, null, 2));

      const NEW = 'V1134 BRAND NEW FACT AT CAP — always prefer bun for this workspace';
      const mock = await startMock(() => ({ kind: 'json', data: { patterns_additions: [{ kind: 'command', text: NEW }] } }));
      try {
        await driveRun(mock, 'cap');
        const ok = await waitFor(() => {
          const d = readDnaFile();
          return !!d && d.patterns.some((p) => p.text === NEW);
        }, 12000);
        assert.ok(ok, 'FAIL electron/agent/dna.ts:412-421 — NEW fact never reached dna.json at the cap');
        const disk = readDnaFile();
        assert.equal(disk.patterns.length, 60, 'FAIL electron/agent/dna.ts:53 — cap of 60 not enforced (got ' + disk.patterns.length + ')');
        assert.ok(disk.patterns.some((p) => p.text === NEW), 'FAIL electron/agent/dna.ts:502 — NEW fact silently dropped at the cap');
        const oldLeft = disk.patterns.filter((p) => String(p.id).startsWith('old-')).length;
        assert.equal(oldLeft, 59, 'FAIL electron/agent/dna.ts:380-384 — eviction did not remove exactly one reinforced old pattern (old left=' + oldLeft + ')');
        assert.ok(
          disk.stats.factsRecorded >= 61,
          'FAIL electron/agent/dna.ts:454 — cumulative factsRecorded must keep rising past the active cap (got ' + disk.stats.factsRecorded + ')',
        );
        return 'new fact kept at cap; 60 active; 59 reinforced old left (1 evicted); factsRecorded=' + disk.stats.factsRecorded;
      } finally {
        await mock.stop();
      }
    });
});

// ============================================================
// 2 — next built prompt (dynamic tail) + restart survival
// ============================================================
test('GUARD-2: learned facts reach next built system prompt tail and survive a fresh module load', async () => {
  await guard('2-prompt-restart',
    'electron/agent/engine.ts:2421; electron/agent/prompts.ts:923,962; electron/agent/providers.ts:1829,1831; electron/agent/dna.ts:597-680', async () => {
      resetDna();
      const now = Date.now();
      // V13's real prompt bug: once 8 reinforced (0.95) patterns fill the
      // render window, a brand-new low-confidence (0.4) fact used to be
      // invisible. Pre-seed that exact condition so the guard proves the fix.
      const reinforced = Array.from({ length: 8 }, (_, i) => ({
        id: 'reinforced-' + i,
        kind: 'workflow',
        text: `V1134 REINFORCED PATTERN ${i}: the user already does this every day`,
        count: 9,
        firstSeen: now - 10 * 86_400_000,
        lastSeen: now - 1000,
        confidence: 0.95,
      }));
      writeFileSync(DNA_PATH, JSON.stringify({
        version: 1,
        profile: { expertise: [], languages: [], likes: [], dislikes: [], styleNotes: [] },
        patterns: reinforced,
        feedback: [],
        stats: { sessionsObserved: 8, factsRecorded: 8, updatedAt: now - 1000 },
      }, null, 2));
      const FACT = 'V1134 PROMPT FACT: always run typecheck before committing';
      let phase2 = false;
      const mock = await startMock(() => ({
        kind: 'json',
        data: phase2 ? {} : { patterns_additions: [{ kind: 'workflow', text: FACT }] },
      }));
      try {
        await driveRun(mock, 'prompt1');
        const wrote = await waitFor(() => (readDnaFile()?.patterns?.length ?? 0) >= 9, 12000);
        assert.ok(wrote, 'FAIL electron/agent/engine.ts:7086 — first run did not write the fact to dna.json');

        // Second run: inspect the ACTUAL outbound main-chat request.
        mock.requests.length = 0;
        phase2 = true;
        await driveRun(mock, 'prompt2');
        const main = mock.requests.filter((r) =>
          !/You maintain the Surnia DNA user model|Living Playbook|project memory file/i.test(r.sys));
        assert.ok(main.length >= 1, 'no main-chat provider request observed on the second run');
        const sysMsgs = main[0].body.messages.filter((m) => m && m.role === 'system');
        const allSys = sysMsgs.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
        assert.ok(allSys.includes('# User DNA'), 'FAIL electron/agent/engine.ts:2421 — second run built no # User DNA section');
        assert.ok(allSys.includes(FACT), 'FAIL electron/agent/prompts.ts:923 — accumulated fact dropped from the second-run prompt');
        const dynamicTail = sysMsgs.find((m) => !m.cache_control && String(m.content ?? '').includes('# User DNA'));
        assert.ok(
          dynamicTail && String(dynamicTail.content).includes(FACT),
          'FAIL electron/agent/prompts.ts:962 / providers.ts:1829 — DNA not in the uncached dynamic system message',
        );

        // The cache_control downgrade path must keep the DNA tail too.
        const rebuilt = sysMsgs.map((m) => String(m.content ?? '')).join('\n\n' + prompts.SYSTEM_CACHE_SPLIT + '\n\n');
        const downgraded = providers.toOpenAIMessages(rebuilt, [{ role: 'user', text: 'hi' }], { cache: false });
        const downgradedSys = downgraded.filter((m) => m.role === 'system').map((m) => String(m.content ?? '')).join('\n');
        assert.ok(downgradedSys.includes(FACT), 'FAIL electron/agent/providers.ts:1831 — DNA lost on cache_control downgrade');

        // RESTART simulation: a fresh dna module instance reads the bytes back.
        const fresh = freshDna();
        const reloaded = fresh.loadDNA(WS);
        assert.ok(reloaded.patterns.some((p) => p.text === FACT), 'FAIL electron/agent/dna.ts:255-267 — fact not reloaded from disk in a fresh module');
        const rendered = fresh.renderDNAPrompt(reloaded);
        assert.ok(
          rendered.includes(FACT),
          'FAIL electron/agent/dna.ts:558-620 — renderDNAPrompt dropped the new fact after 8 reinforced patterns filled the window',
        );
        assert.match(
          rendered, /LEARNING STATUS:.*facts recorded.*active cap/i,
          'FAIL electron/agent/dna.ts:654-660 — V13 honest cumulative-vs-active learning status missing from prompt',
        );
        assert.match(
          rendered, /CONTINUOUS LEARNING:/,
          'FAIL electron/agent/dna.ts:671-675 — V13 continuous-learning directive missing from prompt',
        );
        const sentUpdated = globalThis.__v1134DnaSent.some((x) => x.ch === 'kdx:dna:event' && x.payload?.type === 'updated');
        assert.ok(sentUpdated, 'FAIL electron/agent/dna.ts:523,979-985 — kdx:dna:event updated never reached the renderer');
        return 'new fact entered full 8-reinforced window, uncached tail + downgrade path; fresh reload + honest status + IPC OK';
      } finally {
        await mock.stop();
      }
    });
});

// ============================================================
// 3 — caps honest + documented; no false "unlimited" claim
// ============================================================
test('GUARD-3: caps are bounded by design, documented, and not falsely advertised as unlimited', async () => {
  await guard('3-caps-honest',
    'electron/agent/dna.ts:53-68,385-390,412-421,434-502; docs/DNA-V1134.md', async () => {
      const dnaSrc = src('electron/agent/dna.ts');
      // V13 exposes the bounds as a documented, exported object rather than
      // scattered magic numbers — accept either honest spelling of the cap.
      assert.match(dnaSrc, /DNA_LIMITS[\s\S]{0,400}?maxPatterns:\s*60\b|const MAX_PATTERNS\s*=\s*60\b/,
        'FAIL electron/agent/dna.ts:53-54 — active pattern cap must be a bounded numeric 60 (not "unlimited")');
      assert.match(dnaSrc, /DNA_LIMITS[\s\S]{0,400}?maxFeedback:\s*40\b|const MAX_FEEDBACK\s*=\s*40\b/,
        'FAIL electron/agent/dna.ts:53-54 — feedback cap must be a bounded numeric 40');
      assert.match(dnaSrc, /promptNewPatterns:\s*[1-9]\d*/,
        'FAIL electron/agent/dna.ts:64-66 — V13 must reserve prompt slots for freshly learned facts');
      assert.match(dnaSrc, /function dedupeKey/,
        'FAIL electron/agent/dna.ts:385-390 — V13 full-text dedupe (no 48-char prefix collision) missing');
      assert.match(dnaSrc, /factsRecorded:\s*number/,
        'FAIL electron/agent/dna.ts:718-747 — dnaStats must expose cumulative factsRecorded (honest growth)');
      assert.match(dnaSrc, /r\.facts\s*\?\?\s*r\.patterns/,
        'FAIL electron/agent/dna.ts:737 — growth chart must plot cumulative facts, not the capped active count');
      assert.match(dnaSrc, /function capPatternsLossless/, 'FAIL electron/agent/dna.ts:377 — lossless eviction policy missing');
      assert.match(dnaSrc, /dna\.patterns\s*=\s*capPatternsLossless\(dna\.patterns\)/, 'FAIL electron/agent/dna.ts:502 — mergeExtraction does not apply the lossless cap');

      // Pure behavior: over the cap the NEW fact survives, old reinforced go.
      const base = {
        version: 1,
        profile: { expertise: [], languages: [], likes: [], dislikes: [], styleNotes: [] },
        patterns: Array.from({ length: 70 }, (_, i) => ({
          id: 'seed-' + i, kind: 'workflow', text: `V1134 SEED OLD PATTERN NUMBER ${i}`,
          count: 10, firstSeen: Date.now() - 50 * 86_400_000, lastSeen: Date.now() - 45 * 86_400_000, confidence: 0.95,
        })),
        feedback: Array.from({ length: 45 }, (_, i) => ({ ts: Date.now() - i * 1000, kind: 'correction', note: 'fb' + i })),
        stats: { sessionsObserved: 0, factsRecorded: 0, updatedAt: 0 },
      };
      const NEW = 'V1134 TRIGGER NEW FACT: use bun in this repo';
      const r = dna.mergeExtraction(base, { patterns_additions: [{ kind: 'command', text: NEW }] });
      assert.equal(r.dna.patterns.length, 60, 'FAIL electron/agent/dna.ts:502 — cap of 60 not enforced in mergeExtraction');
      assert.ok(r.dna.patterns.some((p) => p.text === NEW), 'FAIL electron/agent/dna.ts:412-421 — new fact silently dropped at the cap');
      assert.equal(r.dna.feedback.length, 40, 'FAIL electron/agent/dna.ts:528 — feedback cap of 40 not enforced');
      assert.ok(r.dna.feedback.some((f) => f.note === 'fb0'), 'FAIL electron/agent/dna.ts:528 — newest feedback lost while trimming');

      // V13: distinct facts that merely share their first 48 chars must BOTH be
      // learned. The old prefix-dedupe silently merged them into one pattern.
      const empty = {
        version: 1,
        profile: { expertise: [], languages: [], likes: [], dislikes: [], styleNotes: [] },
        patterns: [], feedback: [],
        stats: { sessionsObserved: 0, factsRecorded: 0, updatedAt: 0 },
      };
      const shared = 'V1134 SHARED PREFIX ' + 'X'.repeat(60);
      const distinct = dna.mergeExtraction(empty, {
        patterns_additions: [
          { kind: 'workflow', text: shared + ' ALPHA ENDING' },
          { kind: 'workflow', text: shared + ' BETA ENDING' },
        ],
      });
      assert.equal(
        distinct.dna.patterns.length, 2,
        'FAIL electron/agent/dna.ts:385-390 — two distinct facts sharing a 48-char prefix were merged into one (silent stall)',
      );

      // Documented: the report explicitly states the bounded numbers.
      const doc = src('docs/DNA-V1134.md');
      assert.match(doc, /60[\s-]*patterns?/i, 'FAIL docs/DNA-V1134.md — the 60-pattern cap must be documented');
      assert.match(doc, /40[\s-]*feedback/i, 'FAIL docs/DNA-V1134.md — the 40-feedback cap must be documented');

      // No false "unlimited DNA" claim in product-facing copy.
      const offenders = [];
      for (const rel of ['src/i18n.ts', 'src/components/panels/DnaPanel.tsx', 'README.md']) {
        let lineNo = 0;
        for (const line of src(rel).split(/\r?\n/)) {
          lineNo += 1;
          if (/\bDNA\b/i.test(line) && /(unlimited|no limit|infinite|بلا حدود|غير محدود)/i.test(line)) {
            offenders.push(`${rel}:${lineNo}: ${line.trim().slice(0, 120)}`);
          }
        }
      }
      assert.deepEqual(offenders, [], 'FAIL — false "unlimited DNA" claim in product copy:\n' + offenders.join('\n'));
      return 'bounded 60/40 constants + lossless eviction; caps documented in docs/DNA-V1134.md; no unlimited claim';
    });
});

// ============================================================
// 4 — transient provider error must NOT silently lose the fact
// ============================================================
test('GUARD-4: one transient provider error on extraction is recovered, not silently lost', async () => {
  await guard('4-transient-error', 'electron/agent/engine.ts:7055-7101', async () => {
    resetDna();
    const FACT = 'V1134 TRANSIENT RECOVERY FACT: format numbers with Intl.NumberFormat';
    const mock = await startMock((callNo) => {
      if (callNo === 1) return { kind: 'sse-error', message: 'temporary upstream glitch — retry me' };
      return { kind: 'json', data: { patterns_additions: [{ kind: 'style', text: FACT }] } };
    });
    try {
      const io = await driveRun(mock, 'transient');
      assert.ok(!io.events.some((e) => e.type === 'fatal'), 'the run itself must still complete cleanly');
      const recovered = await waitFor(() => {
        const d = readDnaFile();
        return !!d && d.patterns.some((p) => p.text === FACT);
      }, 10000);
      assert.ok(
        recovered,
        'FAIL electron/agent/engine.ts:7081-7084,7098-7100 — learnDNAFacts swallowed ONE transient extraction error and silently lost the fact ' +
        '(no retry; V13 must recover it). Extraction calls observed: ' + mock.extractionCalls,
      );
      assert.ok(mock.extractionCalls >= 2, 'FAIL electron/agent/engine.ts:7045 — no retry of the extraction call was observed');
      return `fact recovered after ${mock.extractionCalls} extraction calls (transient error then success)`;
    } finally {
      await mock.stop();
    }
  });
});

// ============================================================
// EVIDENCE + CLEANUP
// ============================================================
test('write evidence + cleanup', () => {
  const summary = {
    generatedAt: new Date().toISOString(),
    verdict: findings.every((f) => f.status !== 'FAIL') ? 'ALL-GUARDS-PASS' : 'FAILURES-PRESENT',
    guards: {
      accumulate: findings.find((f) => f.id === '1a-accumulate')?.status ?? 'MISSING',
      capEviction: findings.find((f) => f.id === '1b-cap-eviction')?.status ?? 'MISSING',
      promptRestart: findings.find((f) => f.id === '2-prompt-restart')?.status ?? 'MISSING',
      capsHonest: findings.find((f) => f.id === '3-caps-honest')?.status ?? 'MISSING',
      transientError: findings.find((f) => f.id === '4-transient-error')?.status ?? 'MISSING',
    },
    findings,
  };
  writeFileSync(RESULTS, JSON.stringify(summary, null, 2));
  console.log(`V1134-DNA-VERDICT: ${summary.verdict} ` + JSON.stringify(summary.guards));
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  assert.ok(findings.length >= 5, 'all five guards must have run');
});
