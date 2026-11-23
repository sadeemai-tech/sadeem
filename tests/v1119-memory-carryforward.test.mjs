import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.19 — STRUCTURAL MEMORY CARRY-FORWARD AUDIT
// ------------------------------------------------------------
// The founder's non-negotiable (ar): "الذاكرة... الكومباك... بديش ينسى،
// يظل متذكر كل شيء" — across MANY compactions AND a process restart the agent
// must still hold the original task, decisions, files touched, pending next
// steps and user preferences.
//
// This suite drives the REAL modules with 40 facts across TWO successive
// compactions and asserts:
//   1. all 40 facts survive on disk after compaction #2 (no silent cap);
//   2. buildCompactionMemory() exposes a STRUCTURED carryForward with all
//      five categories, which A1 appends at the compaction boundary;
//   3. a simulated restart (fresh module instance) re-reads everything;
//   4. the CUMULATIVE SESSION MEMORY block lives in the DYNAMIC system-prompt
//      tail, so the prompt-cache split can never drop it;
//   5. the original task is NEVER dropped (not by exclude, not by truncation).
//
//   node --test --test-force-exit tests/v1119-memory-carryforward.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1119-carry-'));
const UD = join(tmp, 'ud');
const WS = join(tmp, 'ws');
mkdirSync(UD, { recursive: true });
mkdirSync(WS, { recursive: true });

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
const pb = require(pbMod);
const prompts = require(promptsMod);

const ORIGINAL = 'المهمة الأصلية: ابنِ ذاكرة لا تُنسى بعد الكومباك ولا بعد إعادة التشغيل';
const HEAD_1 = [
  { role: 'user', text: ORIGINAL },
  { role: 'assistant', text: 'I will build a cumulative memory and verify it.' },
];
// 20 REAL facts in compaction #1, spread over the four durable categories.
const D1 = Array.from({ length: 8 }, (_, i) => `DEC1_${String(i).padStart(2, '0')} — decision from first compaction`);
// File bullets are reduced to the bare path by memory.pathFromBullet(), so the
// durable fact is the path itself (the " — why" tail is not stored).
const F1 = Array.from({ length: 5 }, (_, i) => `FILE1_${String(i).padStart(2, '0')}`);
const P1 = Array.from({ length: 4 }, (_, i) => `PREF1_${String(i).padStart(2, '0')} — preference learned in first compaction`);
const N1 = Array.from({ length: 3 }, (_, i) => `NEXT1_${String(i).padStart(2, '0')} — pending step from first compaction`);

const SUMMARY_1 = [
  '## Decisions made (with the WHY)',
  ...D1.map((d) => `- ${d}`),
  '## Files touched (path — what changed and why)',
  ...F1.map((f) => `- ${f} — file touched in first compaction`),
  '## Next steps (ordered, concrete)',
  ...N1.map((n) => `- ${n}`),
].join('\n');

let first;
test('v1119: cap constants were raised (render 4000, stored facts 1024)', () => {
  assert.equal(mem.RENDER_CAP, 4000, 'RENDER_CAP bumped to 4000');
  assert.equal(mem.MAX_STORED_FACTS, 1024, 'MAX_STORED_FACTS bumped to 1024');
  assert.equal(comp.RENDER_CAP, 4000, 'compaction re-exports the raised render cap');
});

test('v1119: compaction #1 persists 20 facts from real summary sections', () => {
  first = comp.buildCompactionMemory({
    head: HEAD_1,
    rawMessages: HEAD_1,
    summary: SUMMARY_1,
    preferences: P1,
    workspace: WS,
    userDataDir: UD,
    sessionId: 'v1119-session',
    reason: 'auto-compact-1',
  });
  assert.equal(first.snapshot.originalTask, ORIGINAL, 'real original task recovered, not "chat"');
  assert.equal(first.carryForward.originalTask, ORIGINAL, 'structured carryForward carries the task');

  const disk = comp.readMemorySnapshot(WS);
  for (const f of [...D1, ...F1, ...P1, ...N1]) {
    const inAny = ['decisions', 'filesTouched', 'preferences', 'pendingSteps'].some((k) =>
      (disk[k] ?? []).some((x) => x.text === f),
    );
    assert.ok(inAny, `${f} on disk after compaction #1`);
  }
  assert.ok(existsSync(join(WS, '.surnia', 'memory-snapshot.json')), 'snapshot file written');
  assert.ok(existsSync(join(WS, '.surnia', 'memory-history.json')), 'history file written');
});

// 20 MORE facts in compaction #2, with a DIFFERENT head user message.
const D2 = Array.from({ length: 8 }, (_, i) => `DEC2_${String(i).padStart(2, '0')} — decision from second compaction`);
const F2 = Array.from({ length: 5 }, (_, i) => `FILE2_${String(i).padStart(2, '0')}`);
const P2 = Array.from({ length: 4 }, (_, i) => `PREF2_${String(i).padStart(2, '0')} — preference learned in second compaction`);
const N2 = Array.from({ length: 3 }, (_, i) => `NEXT2_${String(i).padStart(2, '0')} — pending step from second compaction`);

let second;
test('v1119: two successive compactions keep ALL 40 facts (nothing critical lost)', () => {
  second = comp.buildCompactionMemory({
    head: [{ role: 'user', text: 'Follow-up: keep going, do not lose anything.' }],
    decisions: D2,
    filesTouched: F2,
    preferences: P2,
    pendingSteps: N2,
    workspace: WS,
    userDataDir: UD,
    sessionId: 'v1119-session',
    reason: 'auto-compact-2',
  });

  const all = [...D1, ...D2, ...F1, ...F2, ...P1, ...P2, ...N1, ...N2];
  assert.equal(all.length, 40);
  const disk = comp.readMemorySnapshot(WS);
  const has = (snap, f) => ['decisions', 'filesTouched', 'preferences', 'pendingSteps'].some((k) =>
    (snap[k] ?? []).some((x) => x.text === f),
  );
  for (const f of all) {
    assert.ok(has(second.snapshot, f), `${f} survives in the returned snapshot after compaction #2`);
    assert.ok(has(disk, f), `${f} survives on disk after compaction #2`);
  }
  // Original task stays authoritative even though compaction #2 had a new task.
  assert.equal(second.snapshot.originalTask, ORIGINAL, 'original task unchanged by 2nd compaction');
  assert.equal(disk.version, 2);
  assert.deepEqual(comp.readMemoryHistory(WS).map((h) => h.version).sort((a, b) => a - b), [1, 2]);
});

test('v1119: carryForward is the structured five-category snapshot A1 appends', () => {
  const cf = second.carryForward;
  assert.equal(cf.originalTask, ORIGINAL);
  assert.deepEqual(Object.keys(cf).sort(), [
    'decisions', 'filesTouched', 'originalTask', 'pendingSteps', 'preferences',
    'sources', 'updatedAt', 'version', 'workspace',
  ].sort());
  for (const f of [...D1, ...D2]) assert.ok(cf.decisions.includes(f), `${f} in carryForward.decisions`);
  for (const f of [...F1, ...F2]) assert.ok(cf.filesTouched.includes(f), `${f} in carryForward.filesTouched`);
  for (const f of [...P1, ...P2]) assert.ok(cf.preferences.includes(f), `${f} in carryForward.preferences`);
  for (const f of [...N1, ...N2]) assert.ok(cf.pendingSteps.includes(f), `${f} in carryForward.pendingSteps`);
  // The advisory block is ready to append and self-describing.
  assert.ok(second.block.includes('CUMULATIVE SESSION MEMORY'), 'block carries the marker');
  assert.ok(second.block.includes('ADVISORY ONLY'), 'block stays advisory');
  assert.ok(second.block.includes(ORIGINAL), 'original task in the appended block');
  // The read-only variant agrees with the persisted state.
  assert.deepEqual(comp.currentCompactionCarryForward(WS).decisions.sort(), cf.decisions.sort());
});

test('v1119: simulated restart — a fresh module re-reads all 40 facts from disk', () => {
  delete require.cache[require.resolve(compMod)];
  delete require.cache[require.resolve(memMod)];
  comp = require(compMod);
  mem = require(memMod);

  const snap = comp.readMemorySnapshot(WS);
  assert.equal(snap.version, 2);
  assert.equal(snap.originalTask, ORIGINAL);
  const all = [...D1, ...D2, ...F1, ...F2, ...P1, ...P2, ...N1, ...N2];
  const has = (f) => ['decisions', 'filesTouched', 'preferences', 'pendingSteps'].some((k) =>
    (snap[k] ?? []).some((x) => x.text === f),
  );
  for (const f of all) assert.ok(has(f), `${f} present after restart`);
  const wide = mem.renderMemorySnapshot(snap, { cap: 60000 });
  for (const f of all) assert.ok(wide.includes(f), `${f} renders after restart when budget allows`);
  assert.deepEqual(comp.readMemoryHistory(WS).map((h) => h.version).sort((a, b) => a - b), [1, 2]);
});

test('v1119: the memory block rides in the DYNAMIC system-prompt tail, never the cached prefix', () => {
  const body = pb.renderPlaybookPrompt(pb.loadPlaybook(WS));
  assert.ok(body.includes('CUMULATIVE SESSION MEMORY'), 'renderPlaybookPrompt appends the memory block');
  assert.ok(prompts.playbookCarriesMemory(body), 'marker recognized by the dedup guard');

  const sys = prompts.buildSystemPrompt({ workspace: WS, mode: 'default', platform: 'win32', playbook: body });
  const pieces = sys.split(prompts.SYSTEM_CACHE_SPLIT);
  assert.ok(pieces.length >= 2, 'system prompt has a cache split');
  assert.ok(!pieces[0].includes('CUMULATIVE SESSION MEMORY'), 'memory NOT in byte-stable cached prefix');
  assert.ok(pieces.slice(1).join(prompts.SYSTEM_CACHE_SPLIT).includes('CUMULATIVE SESSION MEMORY'),
    'memory IS in the dynamic tail — the cache split cannot drop it');
  assert.ok(sys.includes(ORIGINAL), 'original task reaches the final system prompt');
});

test('v1119: full priority order is task > prefs > decisions > files > pending > other', () => {
  const snap = {
    version: 1, workspace: WS, updatedAt: Date.now(),
    originalTask: 'ORIGINAL_MARKER',
    recentTasks: ['OTHER_TASK_MARKER'],
    decisions: [{ text: 'DECISION_MARKER', count: 1, firstSeen: 1, lastSeen: 1 }],
    filesTouched: [{ text: 'FILE_MARKER', count: 1, firstSeen: 1, lastSeen: 1 }],
    preferences: [{ text: 'PREF_MARKER', count: 1, firstSeen: 1, lastSeen: 1 }],
    pendingSteps: [{ text: 'PENDING_MARKER', count: 1, firstSeen: 1, lastSeen: 1 }],
    sources: [],
  };
  const block = mem.renderMemorySnapshot(snap, { cap: 60000 });
  const at = (marker) => block.indexOf(marker);
  const order = ['ORIGINAL_MARKER', 'PREF_MARKER', 'DECISION_MARKER', 'FILE_MARKER', 'PENDING_MARKER', 'OTHER_TASK_MARKER'].map(at);
  for (const idx of order) assert.ok(idx >= 0, `marker present (${idx})`);
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i - 1] < order[i], `priority slot ${i - 1} before slot ${i}`);
  }
});

test('v1119: the original task is never dropped — not by exclude, not by tiny-cap truncation', () => {
  const snap = {
    version: 1, workspace: WS, updatedAt: Date.now(),
    originalTask: ORIGINAL,
    recentTasks: [],
    decisions: [], filesTouched: [], preferences: [], pendingSteps: [], sources: [],
  };
  // `exclude` is allowed to hide other facts, but never the original task.
  const withExclude = mem.renderMemorySnapshot(snap, {
    cap: 60000,
    exclude: [ORIGINAL, 'a low priority thing'],
  });
  assert.ok(withExclude.includes(ORIGINAL), 'exclude cannot erase the original task');
  // Even a pathological cap keeps it (front-placed + final re-insert guard).
  const tiny = mem.renderMemorySnapshot(snap, { cap: 400 });
  assert.ok(tiny.includes(ORIGINAL), 'original task survives a tiny-cap truncation');
});

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
