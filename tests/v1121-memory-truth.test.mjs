import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.21 — MEMORY TRUTH (VERIFICATION ONLY)
// ------------------------------------------------------------
// The founder's non-negotiable (ar): "الذاكرة... يظل متذكر كل شيء" —
// the agent must remember EVERYTHING. This suite does NOT trust claims or
// comments: it drives the REAL modules against REAL on-disk artifacts and
// proves, byte by byte, which facts persist and which can be lost.
//
// End-to-end path exercised here (no source edits — A7 owns the source):
//   WRITE  : memorySnapshot()/buildCompactionMemory() -> .surnia/memory-snapshot.json
//            + .surnia/memory-history.json  (real files under a temp workspace)
//   COMPACT: two successive compactions merge new facts, never erase old ones
//   RESTART: drop require.cache, re-require fresh modules, re-read from disk
//   READ   : renderPlaybookPrompt() -> renderMemoryBlock() -> buildSystemPrompt()
//            and assert the CUMULATIVE SESSION MEMORY marker reaches the FINAL
//            system prompt in the DYNAMIC tail (not dropped by the cache split).
//
// LOSS VECTORS audited honestly (exact file:line in docs/MEMORY-TRUTH.md):
//   • RENDER_CAP 4000 tail-truncation        (bounded, by design)
//   • MAX_STORED_FACTS 1024 storage cap       (FIXED v11.21 — new fact kept, old evicted)
//   • MAX_TASKS 8 recent-task cap             (bounded, by design)
//   • dedup by normalize() / exclude          (bounded, original task protected)
//   • category priority ordering              (task > prefs > decisions > files > …)
//   • empty-block omission for cache stability (by design)
//
//   node --test --test-force-exit tests/v1121-memory-truth.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1121-truth-'));
const UD = join(tmp, 'ud');
const WS = join(tmp, 'ws');
const WS_CAP = join(tmp, 'ws-cap');
for (const d of [UD, WS, WS_CAP]) mkdirSync(d, { recursive: true });

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN,
    entry,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${out}`,
    '--external:electron',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// electron stub — app.getPath('userData') -> UD. No ipcMain/BrowserWindow used.
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `module.exports = { app: { getPath: () => ${JSON.stringify(UD)} } };`);

const memMod = join(tmp, 'memory.cjs');
const compMod = join(tmp, 'compaction.cjs');
const pbMod = join(tmp, 'playbook.cjs');
const promptsMod = join(tmp, 'prompts.cjs');
bundle(join(ROOT, 'electron/agent/memory.ts'), memMod);
bundle(join(ROOT, 'electron/agent/compaction.ts'), compMod);
bundle(join(ROOT, 'electron/agent/playbook.ts'), pbMod);
bundle(join(ROOT, 'electron/agent/prompts.ts'), promptsMod);

let mem = require(memMod);
let comp = require(compMod);
let pb = require(pbMod);
let prompts = require(promptsMod);

const ORIGINAL = 'المهمة الأصلية: الذاكرة تتذكر كل شيء بعد الكومباك وإعادة التشغيل';
const HEAD_1 = [{ role: 'user', text: ORIGINAL }, { role: 'assistant', text: 'I will persist real facts.' }];

// Compaction #1 facts — short + distinct so the full set fits the 4000-char
// render cap in the happy-path prompt assertion below.
const D1 = ['DEC1A keep memory local', 'DEC1B advisory not rules', 'DEC1C real file line evidence',
  'DEC1D never invent facts', 'DEC1E version every revision', 'DEC1F dedupe repeated facts'];
const F1 = ['FILE1A.ts', 'FILE1B.ts', 'FILE1C.ts', 'FILE1D.ts'];
const P1 = ['PREF1A answer Arabic', 'PREF1B show file line', 'PREF1C run tests first', 'PREF1D no preambles'];
const N1 = ['NEXT1A verify tsc', 'NEXT1B run memory tests', 'NEXT1C report honestly'];
const SUMMARY_1 = [
  '## Decisions made (with the WHY)',
  '- DEC1S decision scraped from real summary',
  '## Files touched (path — what changed and why)',
  '- FILE1S.ts file scraped from summary',
  '## Next steps (ordered, concrete)',
  '- NEXT1S pending scraped from summary',
].join('\n');
const EXPECTED_1 = [...D1, ...F1, ...P1, ...N1, 'DEC1S', 'FILE1S.ts', 'NEXT1S'];

// Compaction #2 introduces ONLY new facts — every #1 fact must survive.
const D2 = ['DEC2A facts stay on disk', 'DEC2B cap is render only', 'DEC2C restart re reads disk'];
const F2 = ['FILE2A.ts', 'FILE2B.ts'];
const P2 = ['PREF2A prefer edit_file', 'PREF2B batch read calls'];
const N2 = ['NEXT2A write truth doc', 'NEXT2B run v1121 test'];
const EXPECTED_2 = [...D2, ...F2, ...P2, ...N2];
const ALL_EXPECTED = [...EXPECTED_1, ...EXPECTED_2];

// ------------------------------------------------------------
// T1 — WRITE: a real snapshot is written to real files (not a claim).
// ------------------------------------------------------------
test('T1 WRITE: memorySnapshot writes REAL .surnia artifacts (snapshot + history)', () => {
  const snap = mem.memorySnapshot({
    workspace: WS,
    userDataDir: UD,
    originalTask: ORIGINAL,
    preferences: ['PREFWRITER post-run writer path is live'],
    reason: 'v1121-truth-write',
  });
  assert.ok(snap.version >= 1);
  const snapFile = join(WS, '.surnia', 'memory-snapshot.json');
  const histFile = join(WS, '.surnia', 'memory-history.json');
  assert.ok(existsSync(snapFile), 'memory-snapshot.json exists on disk');
  assert.ok(existsSync(histFile), 'memory-history.json exists on disk');
  // Read the RAW bytes — this is an artifact, not a returned object.
  const raw = JSON.parse(readFileSync(snapFile, 'utf8'));
  assert.equal(raw.originalTask, ORIGINAL, 'original task is in the raw file bytes');
  assert.ok(raw.preferences.some((f) => f.text.includes('PREFWRITER')), 'post-run fact is in the raw file bytes');
  const hist = JSON.parse(readFileSync(histFile, 'utf8'));
  assert.equal(hist[0].reason, 'v1121-truth-write');
});

// ------------------------------------------------------------
// T2 — COMPACTION #1: real facts land on disk.
// ------------------------------------------------------------
let first;
test('T2 COMPACT #1: buildCompactionMemory persists task + 4 categories from real input', () => {
  first = comp.buildCompactionMemory({
    head: HEAD_1,
    rawMessages: HEAD_1,
    summary: SUMMARY_1,
    decisions: D1,
    filesTouched: F1,
    preferences: P1,
    pendingSteps: N1,
    workspace: WS,
    userDataDir: UD,
    sessionId: 'v1121-truth',
    reason: 'v1121-compact-1',
  });
  assert.equal(first.originalTask, ORIGINAL, 'real original task recovered, not "chat"');
  assert.ok(first.block.includes('CUMULATIVE SESSION MEMORY'), 'advisory marker in compaction block');
  assert.equal(first.snapshot.version, 2, 'compaction bumped the on-disk version (post-run write = v1)');
  const disk = comp.readMemorySnapshot(WS);
  // Summary bullets are stored as their full text (marker is a prefix), so use
  // substring matching — the same criterion the final-prompt check uses.
  const has = (f) => ['decisions', 'filesTouched', 'preferences', 'pendingSteps'].some((k) =>
    (disk[k] ?? []).some((x) => x.text.includes(f)));
  for (const f of EXPECTED_1) assert.ok(has(f), `${f} on disk after compaction #1`);
});

// ------------------------------------------------------------
// T3 — COMPACTION #2: cumulative — nothing from #1 vanishes.
// ------------------------------------------------------------
let second;
test('T3 COMPACT #2: every fact from #1 survives and every new fact is added', () => {
  second = comp.buildCompactionMemory({
    head: [{ role: 'user', text: 'Follow-up: do not forget anything.' }],
    decisions: D2,
    filesTouched: F2,
    preferences: P2,
    pendingSteps: N2,
    workspace: WS,
    userDataDir: UD,
    sessionId: 'v1121-truth',
    reason: 'v1121-compact-2',
  });
  const has = (snap, f) => ['decisions', 'filesTouched', 'preferences', 'pendingSteps'].some((k) =>
    (snap[k] ?? []).some((x) => x.text.includes(f)));
  for (const f of ALL_EXPECTED) {
    assert.ok(has(second.snapshot, f), `${f} in returned snapshot after compaction #2`);
    assert.ok(has(comp.readMemorySnapshot(WS), f), `${f} on disk after compaction #2`);
  }
  assert.equal(second.snapshot.originalTask, ORIGINAL, 'original task unchanged by a 2nd compaction');
  assert.equal(second.snapshot.version, 3);
  assert.deepEqual(
    comp.readMemoryHistory(WS).map((h) => h.version).sort((a, b) => a - b),
    [1, 2, 3],
    'version history has all three revisions',
  );
});

// ------------------------------------------------------------
// T4 — RESTART: fresh module instance re-reads every fact from disk.
// ------------------------------------------------------------
test('T4 RESTART: fresh modules re-read all facts from the real files', () => {
  delete require.cache[require.resolve(memMod)];
  delete require.cache[require.resolve(compMod)];
  delete require.cache[require.resolve(pbMod)];
  delete require.cache[require.resolve(promptsMod)];
  mem = require(memMod);
  comp = require(compMod);
  pb = require(pbMod);
  prompts = require(promptsMod);

  const snap = comp.readMemorySnapshot(WS);
  assert.equal(snap.originalTask, ORIGINAL);
  const has = (f) => ['decisions', 'filesTouched', 'preferences', 'pendingSteps'].some((k) =>
    (snap[k] ?? []).some((x) => x.text.includes(f)));
  for (const f of ALL_EXPECTED) assert.ok(has(f), `${f} present after simulated restart`);
});

// ------------------------------------------------------------
// T5 — READ INTO NEXT PROMPT: marker reaches the FINAL system prompt.
// ------------------------------------------------------------
test('T5 READ: facts are injected into the NEXT prompt via playbook -> buildSystemPrompt', () => {
  const body = pb.renderPlaybookPrompt(pb.loadPlaybook(WS));
  assert.ok(body.includes('CUMULATIVE SESSION MEMORY'), 'memory block appended to playbook body');

  const sys = prompts.buildSystemPrompt({ workspace: WS, mode: 'default', platform: 'win32', playbook: body });
  assert.ok(sys.includes('# Living Playbook'), 'playbook section present in FINAL system prompt');
  assert.ok(sys.includes('CUMULATIVE SESSION MEMORY'), 'marker present in FINAL system prompt');
  assert.ok(sys.includes(ORIGINAL), 'original task reaches the model');
  for (const f of ALL_EXPECTED) {
    assert.ok(sys.includes(f), `${f} reaches the FINAL system prompt after restart`);
  }
});

// ------------------------------------------------------------
// T6 — CACHE SPLIT: memory is in the dynamic tail, never the cached prefix.
// ------------------------------------------------------------
test('T6 CACHE SPLIT: marker is in the dynamic tail, not the byte-stable prefix', () => {
  const body = pb.renderPlaybookPrompt(pb.loadPlaybook(WS));
  assert.ok(prompts.playbookCarriesMemory(body), 'dedup guard recognizes the marker');
  const sys = prompts.buildSystemPrompt({ workspace: WS, mode: 'default', platform: 'win32', playbook: body });
  const pieces = sys.split(prompts.SYSTEM_CACHE_SPLIT);
  assert.ok(pieces.length >= 2, 'system prompt has a cache split');
  assert.ok(!pieces[0].includes('CUMULATIVE SESSION MEMORY'), 'marker NOT in cached prefix');
  assert.ok(pieces.slice(1).join(prompts.SYSTEM_CACHE_SPLIT).includes('CUMULATIVE SESSION MEMORY'),
    'marker IS in dynamic tail — cache split cannot drop it');
});

// ------------------------------------------------------------
// T7 — LOSS VECTOR: RENDER_CAP (4000) tail truncation is bounded + honest.
// ------------------------------------------------------------
test('T7 LOSS (bounded): RENDER_CAP truncation drops low-priority tail, keeps critical facts', () => {
  assert.equal(mem.RENDER_CAP, 4000);
  const fact = (text, count = 1, offset = 0) => ({
    text, count, firstSeen: 1000 + offset, lastSeen: 2000 + offset, source: 'truth',
  });
  const snap = {
    version: 1, workspace: WS, updatedAt: Date.now(),
    originalTask: 'ORIGINAL_TRUTH_MARKER — never cut',
    recentTasks: [],
    preferences: [fact('PREF_TRUTH_MARKER — language preference')],
    decisions: [fact('DEC_TRUTH_MARKER — a real decision')],
    filesTouched: [fact('FILE_TRUTH_MARKER.ts — a real file')],
    pendingSteps: Array.from({ length: 30 }, (_, i) =>
      fact(`PEND_${String(i).padStart(2, '0')}_TRUTH — low priority step ${'x'.repeat(150)}`, 1, i)),
    sources: [],
  };
  const block = mem.renderMemorySnapshot(snap);
  for (const m of ['ORIGINAL_TRUTH_MARKER', 'PREF_TRUTH_MARKER', 'DEC_TRUTH_MARKER', 'FILE_TRUTH_MARKER']) {
    assert.ok(block.includes(m), `${m} survives truncation`);
  }
  assert.ok(block.includes('… [memory truncated'), 'honest truncation marker present');
  assert.ok(!block.includes('PEND_00_TRUTH'), 'oldest low-priority pending step dropped from the VIEW');
  // The full set stays on disk — the loss is only in this rendered view.
  const wide = mem.renderMemorySnapshot(snap, { cap: 60000 });
  assert.ok(wide.includes('PEND_00_TRUTH'), 'everything renders when the cap allows');
  assert.ok(block.length <= mem.RENDER_CAP + 80, 'respects the render cap');
});

// ------------------------------------------------------------
// T8 — BOUNDARY: MAX_STORED_FACTS (1024). Regression for the v11.21 fix:
// a genuinely NEW fact must survive a full category; an OLD, most-reinforced
// fact is evicted instead (the reverse of the original `slice` behaviour).
// ------------------------------------------------------------
test('T8 FIX (v11.21): a new fact is RETAINED at the 1024 cap; an old one is evicted', () => {
  assert.equal(mem.MAX_STORED_FACTS, 1024);
  const base = {
    version: 1, workspace: WS_CAP, updatedAt: Date.now(), originalTask: 'CAP TASK',
    recentTasks: [],
    decisions: Array.from({ length: 1024 }, (_, i) => {
      const text = `CAPDEC_${String(i).padStart(4, '0')} a stored decision`;
      return { text, count: 1, firstSeen: 1000 + i, lastSeen: 2000 + i, source: 'cap-test' };
    }),
    filesTouched: [], preferences: [], pendingSteps: [], sources: [],
  };
  // A REAL artifact with a full category.
  mkdirSync(join(WS_CAP, '.surnia'), { recursive: true });
  writeFileSync(join(WS_CAP, '.surnia', 'memory-snapshot.json'), JSON.stringify(base));
  const res = mem.memorySnapshot({
    workspace: WS_CAP,
    decisions: ['CAPDEC_NEW — a genuinely new decision after the category filled'],
    reason: 'cap-boundary',
  });
  const onDisk = mem.readMemorySnapshot(WS_CAP);
  // v11.21 fix (memory.ts:284): on overflow, the OLDEST most-reinforced fact
  // is evicted — the brand-new one is kept in memory AND persisted to disk.
  assert.equal(onDisk.decisions.length, 1024);
  assert.ok(res.decisions.some((f) => f.text.includes('CAPDEC_NEW')),
    'FIX: new decision RETAINED when decisions already has 1024 facts');
  assert.ok(onDisk.decisions.some((f) => f.text.includes('CAPDEC_NEW')),
    'FIX: new decision persisted in the raw on-disk artifact');
  assert.ok(!onDisk.decisions.some((f) => f.text.includes('CAPDEC_0000')),
    'oldest most-reinforced fact evicted to make room');
});

// ------------------------------------------------------------
// T9 — LOSS VECTORS: dedup, MAX_TASKS, ordering, empty omission.
// ------------------------------------------------------------
test('T9 LOSS (bounded): dedup merges repeats, MAX_TASKS=8, ordering, protection, omission', () => {
  // (a) dedup: same normalized text is counted, not stored twice.
  const snap = {
    version: 1, workspace: WS, updatedAt: Date.now(), originalTask: ORIGINAL,
    recentTasks: [],
    decisions: [
      { text: 'Repeated   Fact', count: 2, firstSeen: 1, lastSeen: 2 },
      { text: 'repeated fact', count: 2, firstSeen: 1, lastSeen: 2 },
    ],
    filesTouched: [], preferences: [], pendingSteps: [], sources: [],
  };
  const dedupBlock = mem.renderMemorySnapshot(snap, { cap: 60000 });
  const occurrences = dedupBlock.split('repeated fact').length - 1;
  assert.equal(occurrences, 1, 'normalize()-dedup collapses case/whitespace variants to one line');

  // (b) MAX_TASKS=8: a 9th distinct task is dropped from recentTasks.
  const manyTasks = Array.from({ length: 9 }, (_, i) => `TASK_${i} distinct session objective`);
  const tSnap = mem.memorySnapshot({ workspace: WS, tasks: manyTasks, reason: 'task-cap' });
  assert.ok(tSnap.recentTasks.length <= 8, 'recentTasks bounded to MAX_TASKS=8');
  assert.ok(!tSnap.recentTasks.includes('TASK_0 distinct session objective'), 'oldest 9th task dropped');
  assert.equal(tSnap.originalTask, ORIGINAL, 'original task survives the task cap');

  // (c) priority ordering: prefs before decisions before files before pending.
  const ordered = mem.renderMemorySnapshot({
    version: 1, workspace: WS, updatedAt: Date.now(), originalTask: 'ORD_TASK',
    recentTasks: ['ORD_OTHER'],
    decisions: [{ text: 'ORD_DEC', count: 1, firstSeen: 1, lastSeen: 1 }],
    filesTouched: [{ text: 'ORD_FILE', count: 1, firstSeen: 1, lastSeen: 1 }],
    preferences: [{ text: 'ORD_PREF', count: 1, firstSeen: 1, lastSeen: 1 }],
    pendingSteps: [{ text: 'ORD_PEND', count: 1, firstSeen: 1, lastSeen: 1 }],
    sources: [],
  }, { cap: 60000 });
  const order = ['ORD_TASK', 'ORD_PREF', 'ORD_DEC', 'ORD_FILE', 'ORD_PEND', 'ORD_OTHER'].map((m) => ordered.indexOf(m));
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], `priority slot ${i - 1} before ${i}`);

  // (d) original task protected from exclude; empty snapshot omits the block.
  const protectedBlock = mem.renderMemorySnapshot(snap, { cap: 60000, exclude: [ORIGINAL] });
  assert.ok(protectedBlock.includes(ORIGINAL), 'exclude cannot erase the original task');
  assert.equal(mem.renderMemorySnapshot(null), '', 'null snapshot → no block (cache-stable)');
  assert.equal(pb.renderPlaybookPrompt(pb.loadPlaybook(join(tmp, 'never-created'))), '',
    'empty workspace → no playbook/memory section');
});

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
