import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.15 — CUMULATIVE MEMORY / `memory_snapshot`
// ------------------------------------------------------------
// Offline verification of the founder's requirement: after a long run and
// MANY compactions the agent must remember EVERYTHING it learned —
//   preferences (DNA + playbook), decisions, files touched, pending steps —
// derived from REAL on-disk data, with a version history, advisory only.
//
//   node --test tests/v1115-memory.test.mjs
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
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1115-memory-'));
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

// electron stub: app.getPath('userData') → UD; no ipcMain/BrowserWindow.
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `module.exports = { app: { getPath: () => ${JSON.stringify(UD)} } };`);

const dnaMod = join(tmp, 'dna.cjs');
const pbMod = join(tmp, 'playbook.cjs');
const compMod = join(tmp, 'compaction.cjs');
const jourMod = join(tmp, 'journal.cjs');
const promptsMod = join(tmp, 'prompts.cjs');
bundle(join(ROOT, 'electron/agent/dna.ts'), dnaMod);
bundle(join(ROOT, 'electron/agent/playbook.ts'), pbMod);
bundle(join(ROOT, 'electron/agent/compaction.ts'), compMod);
bundle(join(ROOT, 'electron/agent/journal.ts'), jourMod);
bundle(join(ROOT, 'electron/agent/prompts.ts'), promptsMod);

const dna = require(dnaMod);
const pb = require(pbMod);
const comp = require(compMod);
const jour = require(jourMod);
const prompts = require(promptsMod);

// ------------------------------------------------------------
// REAL data: a user DNA with durable preferences.
// ------------------------------------------------------------
test('setup: real DNA preferences are written to disk', () => {
  dna.saveDNA({
    version: 1,
    profile: {
      name: 'Founder',
      role: 'Engineering lead',
      expertise: ['typescript', 'electron'],
      languages: ['Arabic', 'English'],
      likes: ['Answer in Arabic with concise evidence'],
      dislikes: ['Long preambles'],
      styleNotes: ['Always show file:line when reporting'],
    },
    patterns: [{
      id: 'p-refactor', kind: 'style', text: 'Prefer edit_file over rewriting whole files',
      count: 3, firstSeen: Date.now(), lastSeen: Date.now(), confidence: 0.85,
    }],
    feedback: [{
      ts: Date.now(), kind: 'preference',
      note: 'Never claim done without running the tests',
    }],
    stats: { sessionsObserved: 4, factsRecorded: 2, updatedAt: Date.now() },
  });
  assert.ok(existsSync(join(UD, 'dna.json')), 'global dna.json written by dna.saveDNA');
  const loaded = dna.loadDNA(WS);
  assert.ok(loaded.profile.likes.includes('Answer in Arabic with concise evidence'));
});

// ------------------------------------------------------------
// REAL data: a living playbook with learned recipes/preferences.
// ------------------------------------------------------------
test('setup: real playbook lessons are written to disk', () => {
  const res = pb.applyPlaybookUpdate(WS, {
    worked: ['Read before edit, then run tsc --noEmit'],
    failed: ['Writing whole files loses the diff'],
    preferences: ['Keep memory local under .surnia and advisory'],
    recipes: ['journal → playbook → DNA → compaction → memory_snapshot'],
    learned: 'Memory must be cumulative across compactions.',
    sessionId: 'sess-memory-1',
  });
  assert.equal(res.changed, true);
  assert.ok(existsSync(pb.playbookMdPath(WS)));
  assert.ok(existsSync(join(WS, '.surnia', 'playbook.json')));
});

// ------------------------------------------------------------
// REAL data: a crash-resilient journal with task + touched files + decision.
// ------------------------------------------------------------
test('setup: real journal is written with task, files and decision facts', async () => {
  const file = jour.startRunJournal('sess-memory-1', 'chat', WS, UD);
  assert.ok(file && existsSync(file), 'journal header written');
  jour.journalEvent(file, { type: 'continue', round: 7 });
  jour.journalEvent(file, {
    type: 'tool', name: 'edit_file', ok: true,
    path: 'electron/agent/memory.ts',
  });
  jour.journalEvent(file, {
    type: 'task_report', outcome: 'completed', files: 3, commands: 2,
    summary: 'Built the cumulative memory snapshot helper and its tests.',
  });
  jour.journalMemoryFact(file, {
    sessionId: 'sess-memory-1',
    filesTouched: ['electron/agent/memory.ts', 'tests/v1115-memory.test.mjs'],
    decisions: ['Memory must be derived from real data, never invented'],
    pendingSteps: ['Verify tsc and both test files'],
    preferences: ['Report findings with file:line'],
  });
  jour.finishRunJournal(file, 'completed', 'Memory snapshot persisted.');
  await jour.flushJournal(file);
  const rows = jour.readJournal(file, 50);
  assert.ok(rows.some((r) => r.type === 'run'));
  assert.ok(rows.some((r) => r.type === 'memory_snapshot'));
});

// The COMPACT_SYSTEM contract's structured summary, as the model would write it.
const SUMMARY_1 = [
  '## Goal & constraints (verbatim user asks, non-negotiables)',
  '- Build a cumulative memory that survives long runs and compaction.',
  '',
  '## Decisions made (with the WHY)',
  '- Keep memory local under .surnia and advisory — never a rule, so the user stays in control.',
  '',
  '## Files touched (path — what changed and why)',
  '- electron/agent/memory.ts — new cumulative snapshot helper with version history.',
  '- electron/agent/compaction.ts — buildCompactionMemory carry-forward block.',
  '',
  '## Current state (what works / what was just done)',
  '- Snapshot writes + reads round-trip; playbook injection wired.',
  '',
  '## Open questions & blockers',
  '- None.',
  '',
  '## Next steps (ordered, concrete)',
  '- Run the memory test suite and confirm no loss on a second compaction.',
].join('\n');

const HEAD_1 = [
  { role: 'user', text: 'تأكد أن الذاكرة والتعلم شغالة — لا تنسى شيء بعد الكومباك.' },
  { role: 'assistant', text: 'I will audit the four memory subsystems and build a cumulative snapshot.', toolCalls: [{ name: 'read_file' }] },
  { role: 'tool_result', content: 'electron/agent/compaction.ts ...' },
];

let first;
test('v11.15: compaction carries the REAL task, preferences, files, decisions and pending steps', () => {
  first = comp.buildCompactionMemory({
    head: HEAD_1,
    rawMessages: HEAD_1,
    summary: SUMMARY_1,
    workspace: WS,
    userDataDir: UD,
    sessionId: 'sess-memory-1',
    reason: 'auto-compact-1',
  });

  assert.equal(first.originalTask, HEAD_1[0].text, 'real original task recovered, not the kind "chat"');
  assert.ok(first.originalTask.length > 20 && !/^chat$/i.test(first.originalTask));

  const all = first.block;
  // (a) original task
  assert.ok(all.includes('ORIGINAL TASK'), 'block has original task section');
  assert.ok(all.includes('الذاكرة والتعلم'), 'real Arabic task text survived');
  // (b) decisions
  assert.ok(all.includes('KEY DECISIONS'), 'block has decisions section');
  assert.ok(all.includes('Keep memory local under .surnia and advisory'), 'real decision from summary');
  assert.ok(all.includes('never invented'), 'real decision from journal');
  // (c) files touched
  assert.ok(all.includes('FILES CREATED / MODIFIED'), 'block has files section');
  assert.ok(all.includes('electron/agent/memory.ts'), 'real file from summary + journal');
  assert.ok(all.includes('tests/v1115-memory.test.mjs'), 'real file from journal');
  // (d) preferences — from BOTH DNA and playbook
  assert.ok(all.includes('LEARNED USER PREFERENCES'), 'block has preferences section');
  assert.ok(all.includes('Answer in Arabic with concise evidence'), 'real DNA preference');
  assert.ok(all.includes('Never claim done without running the tests'), 'real DNA feedback preference');
  assert.ok(all.includes('Keep memory local under .surnia and advisory'), 'real playbook preference');
  // (e) pending steps
  assert.ok(all.includes('PENDING NEXT STEPS'), 'block has next steps section');
  assert.ok(all.includes('Run the memory test suite and confirm no loss'), 'real pending step from summary');
  assert.ok(all.includes('Verify tsc and both test files'), 'real pending step from journal');
  // advisory contract
  assert.ok(all.includes('ADVISORY ONLY'), 'memory block is honest/advisory');
});

test('v11.15: memory_snapshot persists to disk with a version history and round-trips', () => {
  assert.ok(existsSync(join(WS, '.surnia', 'memory-snapshot.json')), 'snapshot file on disk');
  assert.ok(existsSync(join(WS, '.surnia', 'memory-history.json')), 'history file on disk');

  const disk = comp.readMemorySnapshot(WS);
  assert.equal(disk.version, 1);
  assert.equal(disk.originalTask, first.originalTask);
  assert.equal(comp.renderMemorySnapshot(disk), first.block, 'render(read(snapshot)) is stable (round-trip)');

  const hist = comp.readMemoryHistory(WS);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].version, 1);
  assert.equal(hist[0].reason, 'auto-compact-1');
  assert.equal(hist[0].snapshot.originalTask, first.originalTask, 'history stores the full snapshot');
  assert.equal(comp.renderMemorySnapshot(hist[0].snapshot), first.block, 'history revision renders identically');
});

// A SECOND compaction with only NEW facts. Nothing from the first may vanish.
const SUMMARY_2 = [
  '## Goal & constraints (verbatim user asks, non-negotiables)',
  '- Verify the two test suites after wiring.',
  '',
  '## Decisions made (with the WHY)',
  '- Version every memory revision so evolution is inspectable.',
  '- Keep memory local under .surnia and advisory — never a rule, so the user stays in control.',
  '',
  '## Files touched (path — what changed and why)',
  '- tests/v1115-memory.test.mjs — cumulative no-loss assertions.',
  '',
  '## Current state (what works / what was just done)',
  '- Second compaction reached.',
  '',
  '## Next steps (ordered, concrete)',
  '- Report the audit honestly to the founder.',
].join('\n');

const HEAD_2 = [
  { role: 'user', text: 'Follow up: now verify both test suites.' },
  { role: 'assistant', text: 'Running verification.' },
];

let second;
test('v11.15: a SECOND compaction is cumulative — no fact from the first is lost', () => {
  second = comp.buildCompactionMemory({
    head: HEAD_2,
    rawMessages: HEAD_2,
    summary: SUMMARY_2,
    workspace: WS,
    userDataDir: UD,
    sessionId: 'sess-memory-1',
    reason: 'auto-compact-2',
  });

  const all = second.block;
  // Everything from compaction #1 is still present.
  assert.ok(all.includes('الذاكرة والتعلم'), 'first task still present');
  assert.ok(all.includes('Keep memory local under .surnia and advisory'), 'first decision still present');
  assert.ok(all.includes('electron/agent/memory.ts'), 'first file still present');
  assert.ok(all.includes('Answer in Arabic with concise evidence'), 'first preference still present');
  assert.ok(all.includes('Run the memory test suite and confirm no loss'), 'first pending step still present');
  // New facts from compaction #2 are added.
  assert.ok(all.includes('Version every memory revision'), 'new decision added');
  assert.ok(all.includes('Report the audit honestly'), 'new pending step added');
  // Original task stays authoritative; the new task is also remembered.
  assert.equal(second.snapshot.originalTask, first.originalTask, 'original task unchanged');
  assert.ok(second.snapshot.recentTasks.some((t) => t.includes('verify both test suites')), 'new task remembered too');

  assert.equal(second.snapshot.version, 2);
  const hist = comp.readMemoryHistory(WS);
  assert.equal(hist.length, 2);
  assert.deepEqual(hist.map((h) => h.version).sort((a, b) => a - b), [1, 2]);
  assert.equal(hist[0].reason, 'auto-compact-2');
  // Reinforcement is visible: the repeated local-memory decision hardened.
  const reinforced = second.snapshot.decisions.find((f) => f.text.includes('Keep memory local under .surnia'));
  assert.ok(reinforced && reinforced.count >= 2, 'repeated fact reinforced, not duplicated');
});

test('v11.15: cumulative memory is injected into the NEXT run system prompt', () => {
  const body = pb.renderPlaybookPrompt(pb.loadPlaybook(WS));
  assert.ok(body.includes('CUMULATIVE SESSION MEMORY'), 'memory block reaches prompt via playbook injection');
  assert.ok(body.includes('الذاكرة والتعلم'), 'original task reaches the prompt');
  assert.ok(body.includes('Answer in Arabic with concise evidence'), 'DNA preference reaches the prompt');
  assert.ok(body.includes('electron/agent/memory.ts'), 'touched file reaches the prompt');
  const sys = prompts.buildSystemPrompt({
    workspace: WS, mode: 'default', platform: 'win32', playbook: body,
  });
  assert.ok(sys.includes('# Living Playbook'), 'playbook section injected into system prompt');
  assert.ok(sys.includes('CUMULATIVE SESSION MEMORY'), 'memory survives into the system prompt');

  // Empty workspace still omits the section (cache-stable, no phantom memory).
  assert.equal(pb.renderPlaybookPrompt(pb.loadPlaybook(join(tmp, 'never-created'))), '');
});

test('v11.15: originalTaskText recovers the real user task, not the task kind', () => {
  assert.equal(
    comp.originalTaskText(
      [{ role: 'user', text: '[Previous running summary] ...' }],
      [{ role: 'user', text: 'Build the real feature' }],
    ),
    'Build the real feature',
  );
});

test('v11.15: the post-run learnPlaybook hook auto-writes memory (no engine edit needed)', async () => {
  const wsAuto = join(tmp, 'ws-auto');
  mkdirSync(wsAuto, { recursive: true });
  const res = await pb.learnPlaybook(wsAuto, {
    preferences: ['Auto path keeps memory alive after every run'],
    sessionId: 'sess-auto',
  });
  assert.equal(res.changed, true);
  const snap = comp.readMemorySnapshot(wsAuto);
  assert.ok(snap.version >= 1, 'snapshot written by learnPlaybook');
  assert.ok(
    snap.preferences.some((f) => f.text.includes('Auto path keeps memory alive after every run')),
    'real playbook preference reached the snapshot',
  );
  assert.ok(comp.renderMemorySnapshot(snap).includes('CUMULATIVE SESSION MEMORY'));
});

test.after(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});
