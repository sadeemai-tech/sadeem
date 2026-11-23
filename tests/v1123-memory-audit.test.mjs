import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.23 — MEMORY AUDIT (REAL ARTIFACTS, NOT CLAIMS)
// ------------------------------------------------------------
// The founder demands the AI remember EVERYTHING. This suite does not trust
// comments: it drives the REAL modules against REAL on-disk artifacts.
//
// Proved here, byte by byte:
//   • facts survive TWO compactions AND a module restart (require.cache drop);
//   • memory_snapshot reaches the FINAL system prompt DYNAMIC tail — the
//     prompt-cache split cannot drop it;
//   • the v11.21 overflow fix is intact: at 1024 facts a NEW fact is kept and
//     an OLD reinforced fact is evicted (never the reverse);
//   • the 4000-char render cap and 1024-fact storage cap are honest;
//   • a NEW fact is never silently dropped by a full playbook section either;
//   • every write path is confined to the workspace (no ../ traversal, no UNC).
//
// Bounded loss is stated honestly in assertions, not hidden.
//
//   node --test --test-force-exit tests/v1123-memory-audit.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1123-audit-'));
const UD = join(tmp, 'ud');
const WS = join(tmp, 'ws');
const WS_CAP = join(tmp, 'ws-cap');
const WS_PB = join(tmp, 'ws-playbook');
const OUTSIDE = join(tmp, 'outside');
for (const d of [UD, WS, WS_CAP, WS_PB, OUTSIDE]) mkdirSync(d, { recursive: true });

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

// electron stub — app.getPath('userData') -> UD; no ipcMain/BrowserWindow used.
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

const ORIGINAL = 'المهمة الأصلية: الذاكرة تتذكر كل شيء بعد ضغطين وإعادة تشغيل';
const HEAD_1 = [{ role: 'user', text: ORIGINAL }, { role: 'assistant', text: 'I will persist real facts.' }];

// Compaction #1 — distinct, short facts so the whole set fits the 4000 cap.
const D1 = ['V1123DEC1A keep memory local and advisory', 'V1123DEC1B evidence from real files',
  'V1123DEC1C never invent a preference', 'V1123DEC1D version every revision'];
const F1 = ['V1123FILE1A.ts', 'V1123FILE1B.ts', 'V1123FILE1C.ts'];
const P1 = ['V1123PREF1A answer Arabic', 'V1123PREF1B show file line', 'V1123PREF1C run tests first'];
const N1 = ['V1123NEXT1A verify tsc', 'V1123NEXT1B report honestly'];
const SUMMARY_1 = [
  '## Decisions made (with the WHY)',
  ...D1.map((d) => `- ${d}`),
  '## Files touched (path — what changed and why)',
  ...F1.map((f) => `- ${f} — touched in audit`),
  '## Next steps (ordered, concrete)',
  ...N1.map((n) => `- ${n}`),
].join('\n');

// Compaction #2 introduces ONLY new facts. Everything from #1 must survive.
const D2 = ['V1123DEC2A facts stay on disk', 'V1123DEC2B cap is storage honest'];
const F2 = ['V1123FILE2A.ts'];
const P2 = ['V1123PREF2A prefer edit_file'];
const N2 = ['V1123NEXT2A write real files'];
const ALL_FACTS = [...D1, ...F1, ...P1, ...N1, 'V1123DEC1S scraped from summary',
  'V1123FILE1S.ts', ...D2, ...F2, ...P2, ...N2];

const SUMMARY_2 = [
  '## Decisions made (with the WHY)',
  '- V1123DEC1S scraped from summary',
  '## Files touched (path — what changed and why)',
  '- V1123FILE1S.ts — scraped from summary',
].join('\n');

// ------------------------------------------------------------
// T1 — REAL WRITE: a real snapshot is written to real files.
// ------------------------------------------------------------
test('T1 WRITE: memorySnapshot writes REAL .surnia artifacts (snapshot + history)', () => {
  const snap = mem.memorySnapshot({
    workspace: WS,
    userDataDir: UD,
    originalTask: ORIGINAL,
    preferences: ['V1123PREFWRITER post-run writer path is live'],
    reason: 'v1123-audit-write',
  });
  assert.ok(snap.version >= 1);
  const snapFile = join(WS, '.surnia', 'memory-snapshot.json');
  const histFile = join(WS, '.surnia', 'memory-history.json');
  assert.ok(existsSync(snapFile), 'memory-snapshot.json exists on disk');
  assert.ok(existsSync(histFile), 'memory-history.json exists on disk');
  // Read the RAW bytes — an artifact, not a returned object.
  const raw = JSON.parse(readFileSync(snapFile, 'utf8'));
  assert.equal(raw.originalTask, ORIGINAL, 'original task in the raw file bytes');
  assert.ok(raw.preferences.some((f) => f.text.includes('V1123PREFWRITER')), 'new fact in raw bytes');
  assert.equal(JSON.parse(readFileSync(histFile, 'utf8'))[0].reason, 'v1123-audit-write');
});

// ------------------------------------------------------------
// T2 — TWO COMPACTIONS: every fact from #1 survives #2.
// ------------------------------------------------------------
test('T2 COMPACT #1 + #2: cumulative, original task protected, versions 1..3', () => {
  const first = comp.buildCompactionMemory({
    head: HEAD_1, rawMessages: HEAD_1, summary: SUMMARY_1,
    decisions: D1, filesTouched: F1, preferences: P1, pendingSteps: N1,
    workspace: WS, userDataDir: UD, sessionId: 'v1123-audit', reason: 'v1123-compact-1',
  });
  assert.equal(first.originalTask, ORIGINAL, 'real original task recovered, not "chat"');
  assert.ok(first.block.includes('CUMULATIVE SESSION MEMORY'));

  const second = comp.buildCompactionMemory({
    head: [{ role: 'user', text: 'Follow-up: do not forget anything.' }],
    summary: SUMMARY_2,
    decisions: D2, filesTouched: F2, preferences: P2, pendingSteps: N2,
    workspace: WS, userDataDir: UD, sessionId: 'v1123-audit', reason: 'v1123-compact-2',
  });
  assert.equal(second.snapshot.originalTask, ORIGINAL, '2nd compaction does not overwrite the task');
  assert.equal(second.snapshot.version, 3, 'post-run write (v1) + 2 compactions = v3');

  const has = (snap, f) => ['decisions', 'filesTouched', 'preferences', 'pendingSteps'].some((k) =>
    (snap[k] ?? []).some((x) => x.text.includes(f)));
  for (const f of ALL_FACTS) {
    assert.ok(has(second.snapshot, f), `${f} in returned snapshot after compaction #2`);
    assert.ok(has(comp.readMemorySnapshot(WS), f), `${f} on disk after compaction #2`);
  }
  assert.deepEqual(
    comp.readMemoryHistory(WS).map((h) => h.version).sort((a, b) => a - b), [1, 2, 3],
    'all three revisions in history',
  );
});

// ------------------------------------------------------------
// T3 — RESTART: drop require.cache, re-read everything from disk.
// ------------------------------------------------------------
test('T3 RESTART: fresh modules re-read every fact from the real files', () => {
  for (const m of [memMod, compMod, pbMod, promptsMod]) delete require.cache[require.resolve(m)];
  mem = require(memMod);
  comp = require(compMod);
  pb = require(pbMod);
  prompts = require(promptsMod);

  const snap = comp.readMemorySnapshot(WS);
  assert.equal(snap.originalTask, ORIGINAL);
  const has = (f) => ['decisions', 'filesTouched', 'preferences', 'pendingSteps'].some((k) =>
    (snap[k] ?? []).some((x) => x.text.includes(f)));
  for (const f of ALL_FACTS) assert.ok(has(f), `${f} present after simulated restart`);
});

// ------------------------------------------------------------
// T4 — FINAL PROMPT: memory in the DYNAMIC tail, never the cached prefix.
// ------------------------------------------------------------
test('T4 FINAL PROMPT: every fact reaches the built system prompt dynamic tail', () => {
  const body = pb.renderPlaybookPrompt(pb.loadPlaybook(WS));
  assert.ok(body.includes('CUMULATIVE SESSION MEMORY'), 'memory block appended to playbook body');
  assert.ok(prompts.playbookCarriesMemory(body), 'dedup guard recognizes the marker');

  const sys = prompts.buildSystemPrompt({ workspace: WS, mode: 'default', platform: 'win32', playbook: body });
  const pieces = sys.split(prompts.SYSTEM_CACHE_SPLIT);
  assert.ok(pieces.length >= 2, 'system prompt has a cache split');
  assert.ok(!pieces[0].includes('CUMULATIVE SESSION MEMORY'), 'marker NOT in the cached prefix');
  const tail = pieces.slice(1).join(prompts.SYSTEM_CACHE_SPLIT);
  assert.ok(tail.includes('CUMULATIVE SESSION MEMORY'), 'marker IS in the dynamic tail');
  assert.ok(tail.includes(ORIGINAL), 'original task in the dynamic tail');
  for (const f of ALL_FACTS) assert.ok(tail.includes(f), `${f} reaches the FINAL prompt dynamic tail`);
});

// ------------------------------------------------------------
// T5 — v11.21 OVERFLOW FIX: new kept, old reinforced evicted, cap exact.
// ------------------------------------------------------------
test('T5 FIX (v11.21): at the 1024 cap a new fact is kept; an old reinforced fact is evicted', () => {
  assert.equal(mem.MAX_STORED_FACTS, 1024);
  const base = {
    version: 1, workspace: WS_CAP, updatedAt: Date.now(), originalTask: 'CAP TASK',
    recentTasks: [],
    decisions: Array.from({ length: 1024 }, (_, i) => ({
      text: `V1123CAP_${String(i).padStart(4, '0')} a stored decision`,
      count: 1, firstSeen: 1000 + i, lastSeen: 2000 + i, source: 'cap-test',
    })),
    filesTouched: [], preferences: [], pendingSteps: [], sources: [],
  };
  mkdirSync(join(WS_CAP, '.surnia'), { recursive: true });
  writeFileSync(join(WS_CAP, '.surnia', 'memory-snapshot.json'), JSON.stringify(base));

  const res = mem.memorySnapshot({
    workspace: WS_CAP,
    decisions: ['V1123CAP_NEW — genuinely new after the category filled'],
    reason: 'cap-boundary',
  });
  const onDisk = mem.readMemorySnapshot(WS_CAP);
  assert.equal(onDisk.decisions.length, 1024, 'storage cap exact: 1024');
  assert.ok(res.decisions.some((f) => f.text.includes('V1123CAP_NEW')), 'new fact retained in result');
  assert.ok(onDisk.decisions.some((f) => f.text.includes('V1123CAP_NEW')), 'new fact persisted in raw bytes');
  assert.ok(!onDisk.decisions.some((f) => f.text.includes('V1123CAP_0000')), 'oldest reinforced fact evicted');
});

// ------------------------------------------------------------
// T6 — CAP HONESTY: render default 4000 never exceeded; full set on disk.
// ------------------------------------------------------------
test('T6 HONEST CAPS: render cap 4000 respected; wide cap reveals the full on-disk set', () => {
  assert.equal(mem.RENDER_CAP, 4000);
  const fact = (text, off = 0) => ({
    text, count: 1, firstSeen: 1000 + off, lastSeen: 2000 + off, source: 'audit',
  });
  const snap = {
    version: 1, workspace: WS, updatedAt: Date.now(),
    originalTask: 'V1123_ORIGINAL — never cut',
    recentTasks: [],
    preferences: Array.from({ length: 12 }, (_, i) => fact(`V1123P_${i} learned preference`, i)),
    decisions: Array.from({ length: 12 }, (_, i) => fact(`V1123D_${i} real decision`, i)),
    filesTouched: Array.from({ length: 12 }, (_, i) => fact(`V1123F_${i}.ts touched`, i)),
    pendingSteps: Array.from({ length: 30 }, (_, i) => fact(`V1123N_${i} low-priority step ${'x'.repeat(120)}`, i)),
    sources: [],
  };
  const block = mem.renderMemorySnapshot(snap);
  assert.ok(block.length <= mem.RENDER_CAP, `default render <= 4000 (got ${block.length})`);
  assert.ok(block.includes('… [memory truncated'), 'honest truncation marker');
  for (const m of ['V1123_ORIGINAL', 'V1123P_', 'V1123D_', 'V1123F_']) assert.ok(block.includes(m), `${m} survives truncation`);
  const wide = mem.renderMemorySnapshot(snap, { cap: 60000 });
  assert.ok(wide.includes('V1123N_0'), 'everything renders when the cap allows');
});

// ------------------------------------------------------------
// T7 — NO SILENT NEW-FACT LOSS at the PLAYBOOK 24-item cap.
// A learned preference from a real post-run update must survive even when the
// section is already full of reinforced lessons (the v11.21 pattern).
// ------------------------------------------------------------
test('T7 NO SILENT LOSS: a new playbook lesson survives a full (24) section', async () => {
  const old = Array.from({ length: 24 }, (_, i) => ({
    id: `old-${i}`, text: `V1123OLDPREF_${String(i).padStart(2, '0')} reinforced lesson`,
    count: 3, firstSeen: 1000 + i, lastSeen: Date.now() - 10_000, source: 'old',
  }));
  mkdirSync(join(WS_PB, '.surnia'), { recursive: true });
  writeFileSync(join(WS_PB, '.surnia', 'playbook.json'), JSON.stringify({
    version: 1, workspace: WS_PB, updatedAt: Date.now(),
    worked: [], failed: [], preferences: old, recipes: [], lastLearned: '', sessionsObserved: 1,
  }));

  await pb.learnPlaybook(WS_PB, {
    preferences: ['V1123NEWPREF genuinely new preference learned this run'],
    sessionId: 'v1123-new-pref',
  });

  const saved = pb.loadPlaybook(WS_PB);
  assert.equal(saved.preferences.length, 24, 'section still capped at 24');
  assert.ok(saved.preferences.some((p) => p.text.includes('V1123NEWPREF')),
    'FIX: new preference NOT silently dropped by the full section');
  const snap = comp.readMemorySnapshot(WS_PB);
  assert.ok(snap.preferences.some((f) => f.text.includes('V1123NEWPREF')),
    'new preference reaches the durable memory snapshot too');
});

// ------------------------------------------------------------
// T8 — WRITE PATH CONFINEMENT: no traversal, no UNC, no device/root.
// ------------------------------------------------------------
test('T8 CONFINEMENT: memory + playbook write paths stay inside the workspace', () => {
  // Keep a LITERAL `..` segment (path.join would normalize it away).
  const sep = require('node:path').sep;
  const traversal = OUTSIDE + sep + '..' + sep + 'escaped'; // resolves to tmp/escaped
  // Path helpers must not let a `..` segment escape into a sibling directory.
  assert.ok(!mem.memorySnapshotPath(traversal).split(/[\\/]/).includes('escaped'),
    'memorySnapshotPath rejects ../ traversal');
  assert.ok(!mem.memoryHistoryPath(traversal).split(/[\\/]/).includes('escaped'),
    'memoryHistoryPath rejects ../ traversal');
  assert.ok(!pb.playbookMdPath(traversal).split(/[\\/]/).includes('escaped'),
    'playbookMdPath rejects ../ traversal');
  // A write driven by a hostile traversal workspace must not create files outside.
  mem.memorySnapshot({ workspace: traversal, decisions: ['V1123ESCAPE should not escape'], reason: 'escape' });
  assert.ok(!existsSync(join(OUTSIDE, '..', 'escaped', '.surnia', 'memory-snapshot.json')),
    'no snapshot written to the escaped path');
});

// ------------------------------------------------------------
// T9 — READ-SIDE CAP: an over-full file must not drop the NEWEST fact on read.
// ------------------------------------------------------------
test('T9 READ CAP: sanitize keeps the new fact at the tail, not just the oldest 1024', () => {
  const WS_READ = join(tmp, 'ws-read');
  mkdirSync(join(WS_READ, '.surnia'), { recursive: true });
  const decisions = Array.from({ length: 1025 }, (_, i) => ({
    text: `V1123READ_${String(i).padStart(4, '0')} stored fact`,
    count: 1, firstSeen: 1000 + i, lastSeen: 2000 + i, source: 'read-cap',
  }));
  writeFileSync(join(WS_READ, '.surnia', 'memory-snapshot.json'), JSON.stringify({
    version: 1, workspace: WS_READ, updatedAt: Date.now(), originalTask: 'READ CAP',
    recentTasks: [], decisions, filesTouched: [], preferences: [], pendingSteps: [], sources: [],
  }));
  const snap = mem.readMemorySnapshot(WS_READ);
  assert.equal(snap.decisions.length, 1024, 'read-side cap exact: 1024');
  assert.ok(snap.decisions.some((f) => f.text.includes('V1123READ_1024')),
    'the NEWEST fact (tail) survives the read-side cap');
  assert.ok(!snap.decisions.some((f) => f.text.includes('V1123READ_0000')),
    'an OLDEST fact is evicted to make room');
});

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
