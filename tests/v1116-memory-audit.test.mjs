import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.16 — MEMORY INJECTION / PRIORITY AUDIT
// ------------------------------------------------------------
// Founder's contract (ar): "الذاكرة تبعت الذكاء... الكومباك تبع الكونتكست،
// بديش ينسى، يظل متذكر كل شيء" — memory must reach the SYSTEM PROMPT, and
// compaction/restart must never erase the critical facts.
//
// This suite audits the REAL path (engine.ts -> playbook.renderPlaybookPrompt
// -> renderMemoryBlock -> buildSystemPrompt) and the renderer's losslessness:
//   A. the injection path is LIVE (source + behavior), not a dead disk write;
//   B. priority ordering survives truncation (task > prefs > decisions >
//      files > everything else) with line-boundary cuts;
//   C. a SECOND compaction keeps every fact (no silent MAX_FACTS drop);
//   D. a simulated restart re-reads all facts from disk;
//   E. duplicate injection is deduped (playbook <-> memory, intra-memory).
//
//   node --test tests/v1116-memory-audit.test.mjs
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
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1116-audit-'));
const UD = join(tmp, 'ud');
const WS = join(tmp, 'ws');
const WS_N = join(tmp, 'ws-no-loss');
const WS_D = join(tmp, 'ws-dedup');
for (const d of [UD, WS, WS_N, WS_D]) mkdirSync(d, { recursive: true });

function bundle(entry, out) {
  execFileSync(
    ESBUILD_NODE,
    [
      ESBUILD_BIN,
      entry,
      '--bundle',
      '--platform=node',
      '--format=cjs',
      `--outfile=${out}`,
      '--external:electron',
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
}

// electron stub — app.getPath('userData') -> UD, no ipcMain/BrowserWindow.
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `module.exports = { app: { getPath: () => ${JSON.stringify(UD)} } };`);

const memMod = join(tmp, 'memory.cjs');
const pbMod = join(tmp, 'playbook.cjs');
const compMod = join(tmp, 'compaction.cjs');
const promptsMod = join(tmp, 'prompts.cjs');
bundle(join(ROOT, 'electron/agent/memory.ts'), memMod);
bundle(join(ROOT, 'electron/agent/playbook.ts'), pbMod);
bundle(join(ROOT, 'electron/agent/compaction.ts'), compMod);
bundle(join(ROOT, 'electron/agent/prompts.ts'), promptsMod);

let mem = require(memMod);
const pb = require(pbMod);
const comp = require(compMod);
const prompts = require(promptsMod);

const now = Date.now();
const fact = (text, count = 1, offset = 0) => ({
  text,
  count,
  firstSeen: now - 1000 + offset,
  lastSeen: now + offset,
  source: 'audit',
});

// ------------------------------------------------------------
// A. The injection path is LIVE, not a dead disk write.
// ------------------------------------------------------------
test('A1: source-level wiring — engine calls renderPlaybookPrompt + buildSystemPrompt injects it', () => {
  const engine = readFileSync(join(ROOT, 'electron/agent/engine.ts'), 'utf8');
  const promptsSrc = readFileSync(join(ROOT, 'electron/agent/prompts.ts'), 'utf8');

  assert.match(engine, /dna\.renderDNAPrompt\(dna\.loadDNA\(workspace\)\)/, 'DNA prompt is rendered in engine');
  assert.match(
    engine,
    /playbook\.renderPlaybookPrompt\(playbook\.loadPlaybook\(workspace\)\)/,
    'engine.ts:2100 calls renderPlaybookPrompt (the memory read hook)',
  );
  assert.match(engine, /playbook:\s*playbookPrompt\s*\|\|\s*undefined/, 'rendered body is passed to buildSystemPrompt');
  assert.match(promptsSrc, /Living Playbook/, 'prompts.ts injects the playbook section');
  assert.match(promptsSrc, /opts\.playbook/, 'playbook injection is gated on the rendered body');

  // The hook that appends memory inside renderPlaybookPrompt must be present.
  const pbSrc = readFileSync(join(ROOT, 'electron/agent/playbook.ts'), 'utf8');
  assert.match(pbSrc, /renderMemoryBlock\(data\.workspace/, 'renderPlaybookPrompt appends the memory block');
});

test('A2: behavioral — a persisted memory block reaches the FINAL system prompt', () => {
  // Persist a real snapshot via the post-run writer that production uses.
  const snap = mem.memorySnapshot({
    workspace: WS,
    userDataDir: UD,
    originalTask: 'المهمة الأصلية: لا تنسى شيء بعد الكومباك',
    decisions: ['Audit decision that must reach the model'],
    filesTouched: ['electron/agent/memory.ts'],
    preferences: ['Answer in Arabic with file:line evidence'],
    reason: 'audit-A',
  });
  assert.ok(existsSync(join(WS, '.surnia', 'memory-snapshot.json')), 'snapshot written to disk');
  assert.ok(snap.version >= 1);

  const body = pb.renderPlaybookPrompt(pb.loadPlaybook(WS));
  assert.ok(body.includes('CUMULATIVE SESSION MEMORY'), 'memory block appended to the playbook body');
  assert.ok(body.includes('المهمة الأصلية'), 'original task reaches the body');

  const sys = prompts.buildSystemPrompt({
    workspace: WS,
    mode: 'default',
    platform: 'win32',
    playbook: body,
  });
  assert.ok(sys.includes('# Living Playbook'), 'playbook section in final system prompt');
  assert.ok(sys.includes('CUMULATIVE SESSION MEMORY'), 'memory block in FINAL system prompt sent to the model');
  assert.ok(sys.includes('Audit decision that must reach the model'), 'concrete decision reaches the model');
});

// ------------------------------------------------------------
// B. Priority ordering under truncation — line-boundary, no critical loss.
// ------------------------------------------------------------
test('B1: renderer prioritizes task > preferences > decisions > files > everything else', () => {
  const snapshot = {
    version: 1,
    workspace: WS,
    updatedAt: now,
    originalTask: 'ORIGINAL_TASK_MARKER — keep me no matter what',
    recentTasks: [],
    preferences: [
      fact('PREF_A_MARKER — durable user preference about language'),
      fact('PREF_B_MARKER — durable user preference about tests'),
      fact('PREF_C_MARKER — durable user preference about reporting'),
    ],
    decisions: [
      fact('DEC_A_MARKER — a recent decision with its why', 3),
      fact('DEC_B_MARKER — another recent decision', 2),
      fact('DEC_C_MARKER — a third recent decision', 1),
    ],
    filesTouched: [
      fact('FILE_A_MARKER — electron/agent/memory.ts changed'),
      fact('FILE_B_MARKER — electron/agent/playbook.ts changed'),
    ],
    // 24 long pending steps (oldest = index 0) overflow the 4000-char cap.
    pendingSteps: Array.from({ length: 24 }, (_, i) =>
      fact(`PEND_${String(i).padStart(2, '0')}_MARKER — a low priority pending step ${'x'.repeat(180)}`, 1, i),
    ),
    sources: ['audit'],
  };

  // 4000-char cap (the real RENDER_CAP). 20+ pending steps overflow it.
  const block = mem.renderMemorySnapshot(snapshot);
  assert.ok(block.includes('ORIGINAL_TASK_MARKER'), 'original task survives truncation');
  for (const m of ['PREF_A_MARKER', 'PREF_B_MARKER', 'PREF_C_MARKER']) {
    assert.ok(block.includes(m), `${m} (preference) survives truncation`);
  }
  for (const m of ['DEC_A_MARKER', 'DEC_B_MARKER', 'DEC_C_MARKER']) {
    assert.ok(block.includes(m), `${m} (decision) survives truncation`);
  }
  for (const m of ['FILE_A_MARKER', 'FILE_B_MARKER']) {
    assert.ok(block.includes(m), `${m} (file) survives truncation`);
  }
  // With 'recent' ranking, the highest index is newest (rendered first) and
  // index 0 is oldest — so the TAIL of the list is what actually gets dropped.
  assert.ok(block.includes('PEND_23_MARKER'), 'newest pending step still present');
  assert.ok(!block.includes('PEND_00_MARKER'), 'oldest / lowest-priority pending step dropped first');

  // Priority ORDER of section headers.
  const iPref = block.indexOf('LEARNED USER PREFERENCES');
  const iDec = block.indexOf('KEY DECISIONS');
  const iFile = block.indexOf('FILES CREATED / MODIFIED');
  assert.ok(iPref >= 0 && iDec >= 0 && iFile >= 0, 'critical sections present');
  assert.ok(iPref < iDec, 'preferences rendered BEFORE decisions');
  assert.ok(iDec < iFile, 'decisions rendered BEFORE files');

  // Truncation is honest and line-boundary safe (own line, no mid-word cut).
  assert.ok(block.includes('[memory truncated'), 'truncation marker present');
  assert.match(block, /\n… \[memory truncated[^\n]*$/, 'marker is its own final line (no mid-word slice)');
  assert.ok(block.length <= 4000 + 80, 'block respects the render cap');
});

test('B2: with budget, EVERY fact renders (the view is lossless when it fits)', () => {
  const snapshot = {
    version: 1,
    workspace: WS,
    updatedAt: now,
    originalTask: 'TASK',
    recentTasks: [],
    decisions: [fact('DECISION_ONE'), fact('DECISION_TWO')],
    filesTouched: [fact('FILE_ONE')],
    preferences: [fact('PREF_ONE')],
    pendingSteps: [fact('PENDING_ONE')],
    sources: [],
  };
  const block = mem.renderMemorySnapshot(snapshot, { cap: 60000 });
  for (const m of ['TASK', 'DECISION_ONE', 'DECISION_TWO', 'FILE_ONE', 'PREF_ONE', 'PENDING_ONE']) {
    assert.ok(block.includes(m), `${m} present with budget`);
  }
  assert.ok(!block.includes('[memory truncated'), 'no truncation when everything fits');
});

// ------------------------------------------------------------
// C. A SECOND compaction keeps every fact (no silent MAX_FACTS drop).
// ------------------------------------------------------------
test('C1: 30 decisions across two compactions are all kept on disk (no silent cap)', () => {
  const d1 = Array.from({ length: 18 }, (_, i) => `DECISION_${String(i).padStart(2, '0')} from first compaction`);
  const first = comp.buildCompactionMemory({
    head: [{ role: 'user', text: 'Original no-loss task' }],
    rawMessages: [{ role: 'user', text: 'Original no-loss task' }],
    decisions: d1,
    workspace: WS_N,
    userDataDir: UD,
    reason: 'audit-no-loss-1',
  });
  const after1 = comp.readMemorySnapshot(WS_N);
  for (const d of d1) assert.ok(after1.decisions.some((f) => f.text === d), `${d} present after compaction 1`);

  const d2 = Array.from({ length: 12 }, (_, i) => `DECISION_${String(i + 18).padStart(2, '0')} from second compaction`);
  const second = comp.buildCompactionMemory({
    head: [{ role: 'user', text: 'Follow-up no-loss task' }],
    decisions: d2,
    workspace: WS_N,
    userDataDir: UD,
    reason: 'audit-no-loss-2',
  });
  const all = [...d1, ...d2];
  for (const d of all) {
    assert.ok(second.snapshot.decisions.some((f) => f.text === d), `${d} survives the SECOND compaction`);
  }
  const disk = comp.readMemorySnapshot(WS_N);
  for (const d of all) {
    assert.ok(disk.decisions.some((f) => f.text === d), `${d} survives on disk after two compactions`);
  }
  assert.equal(disk.version, 2);
  // Both the oldest and the newest decision render when there is budget.
  const wide = mem.renderMemorySnapshot(disk, { cap: 60000 });
  assert.ok(wide.includes('DECISION_00'), 'oldest decision renders');
  assert.ok(wide.includes('DECISION_29'), 'newest decision renders');
});

// ------------------------------------------------------------
// D. Simulated restart — fresh module instance re-reads everything from disk.
// ------------------------------------------------------------
test('D1: a fresh module instance reads all facts back from disk (restart)', () => {
  // Drop the require cache to simulate a brand-new process loading the bundle.
  delete require.cache[require.resolve(compMod)];
  delete require.cache[require.resolve(memMod)];
  const freshComp = require(compMod);
  const freshMem = require(memMod);
  mem = freshMem; // subsequent tests use the fresh instance too

  const snap = freshComp.readMemorySnapshot(WS_N);
  assert.equal(snap.version, 2);
  assert.equal(snap.originalTask, 'Original no-loss task');
  for (let i = 0; i < 30; i++) {
    const d = `DECISION_${String(i).padStart(2, '0')} ${i < 18 ? 'from first' : 'from second'} compaction`;
    assert.ok(snap.decisions.some((f) => f.text === d), `${d} present after simulated restart`);
  }
  const hist = freshComp.readMemoryHistory(WS_N);
  assert.deepEqual(
    hist.map((h) => h.version).sort((a, b) => a - b),
    [1, 2],
    'version history survives restart',
  );
});

// ------------------------------------------------------------
// E. Duplicate injection is deduped.
// ------------------------------------------------------------
test('E1: exclude option removes facts already rendered elsewhere in the prompt', () => {
  const snapshot = {
    version: 1,
    workspace: WS,
    updatedAt: now,
    originalTask: 'TASK',
    recentTasks: [],
    preferences: [fact('SHARED_PREF_MARKER — shown in playbook already'), fact('UNIQUE_PREF_MARKER')],
    decisions: [],
    filesTouched: [],
    pendingSteps: [],
    sources: [],
  };
  const withExclude = mem.renderMemorySnapshot(snapshot, { exclude: ['SHARED_PREF_MARKER — shown in playbook already'] });
  assert.ok(!withExclude.includes('SHARED_PREF_MARKER'), 'excluded preference not repeated in memory block');
  assert.ok(withExclude.includes('UNIQUE_PREF_MARKER'), 'non-excluded preference still present');

  const without = mem.renderMemorySnapshot(snapshot);
  assert.ok(without.includes('SHARED_PREF_MARKER'), 'preference still renders when not excluded');
});

test('E2: playbook + memory injection does not duplicate a shared preference', async () => {
  const shared = 'SHARED_LEARNING — keep memory advisory and local';
  // learnPlaybook writes BOTH the playbook and the memory snapshot from the
  // same real fact — the exact scenario that used to inject it twice.
  pb.applyPlaybookUpdate(WS_D, { preferences: [shared], sessionId: 'audit-dedup' });
  await pb.learnPlaybook(WS_D, { preferences: [shared], sessionId: 'audit-dedup' });
  // Add a memory-ONLY fact so the block remains meaningful after the shared
  // preference is deduped away (otherwise the empty block is simply omitted).
  mem.memorySnapshot({ workspace: WS_D, preferences: ['MEMORY_ONLY_MARKER — unique to memory'] });

  assert.ok(existsSync(join(WS_D, '.surnia', 'memory-snapshot.json')), 'snapshot written for dedup workspace');
  const body = pb.renderPlaybookPrompt(pb.loadPlaybook(WS_D));
  const occurrences = body.split(shared).length - 1;
  assert.equal(occurrences, 1, `shared preference appears exactly once in the combined prompt (got ${occurrences})`);
  assert.ok(body.includes('MEMORY_ONLY_MARKER'), 'memory-only fact still injected');
  assert.ok(body.includes('CUMULATIVE SESSION MEMORY'), 'memory block still present after dedup');
});

test.after(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});
