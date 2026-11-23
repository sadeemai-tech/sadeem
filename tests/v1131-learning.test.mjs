import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.31 — CAPABILITY / LEARNING END-TO-END AUDIT
// ------------------------------------------------------------
// Three durable learning subsystems, driven with REAL temp artifacts and
// FRESH module reloads (require.cache dropped) — no mocks of the modules
// under test:
//
//   A. MEMORY   write → disk → TWO compactions → restart → FINAL system prompt
//   B. DNA      patterns → dna.json → kdx:dna:event → prompt → restart
//   C. PLAYBOOK recipes  → playbook.json + PLAYBOOK.md + history → prompt → memory
//
// Plus the honesty / robustness guards the founder demands:
//   • capped growth (RENDER_CAP 4000 / MAX_STORED_FACTS 1024 / MAX_PATTERNS 60)
//     is explicit and bounded — no silent drop of a NEW fact;
//   • eviction policy = keep NEW, drop OLDEST + MOST-REINFORCED;
//   • every write path is confined to its workspace (no ../ traversal);
//   • a programmatic DNA write MUST notify the renderer (no stale event).
//
//   node --test --test-force-exit tests/v1131-learning.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync,
  existsSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const sep = require('node:path').sep;
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1131-learning-'));
const UD = join(tmp, 'userdata');
const WS_MEM = join(tmp, 'ws-memory');
const WS_PB = join(tmp, 'ws-playbook');
const WS_DNA = join(tmp, 'ws-dna');
const WS_SAFE = join(tmp, 'ws-confined');
const ESCAPED = join(tmp, 'escaped');
for (const d of [UD, WS_MEM, WS_PB, WS_DNA, WS_SAFE, join(ESCAPED, '.surnia')]) {
  mkdirSync(d, { recursive: true });
}

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

// electron stub: app.getPath('userData') -> UD; record kdx:dna:event broadcasts.
globalThis.__v1131DnaEvents = [];
const STUB = join(tmp, 'node_modules', 'electron');
mkdirSync(STUB, { recursive: true });
writeFileSync(join(STUB, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(STUB, 'index.js'),
  'const sent = globalThis.__v1131DnaEvents || (globalThis.__v1131DnaEvents = []);\n' +
  'module.exports = {\n' +
  '  app: { getPath: () => ' + JSON.stringify(UD) + ' },\n' +
  '  ipcMain: { handle() {} },\n' +
  '  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (ch, payload) => sent.push({ ch, payload }) } }] },\n' +
  '};\n',
);

const memMod = join(tmp, 'memory.cjs');
const compMod = join(tmp, 'compaction.cjs');
const pbMod = join(tmp, 'playbook.cjs');
const dnaMod = join(tmp, 'dna.cjs');
const promptsMod = join(tmp, 'prompts.cjs');
for (const [entry, out] of [
  ['electron/agent/memory.ts', memMod],
  ['electron/agent/compaction.ts', compMod],
  ['electron/agent/playbook.ts', pbMod],
  ['electron/agent/dna.ts', dnaMod],
  ['electron/agent/prompts.ts', promptsMod],
]) bundle(join(ROOT, entry), out);

function reload() {
  for (const m of [memMod, compMod, pbMod, dnaMod, promptsMod]) delete require.cache[require.resolve(m)];
  return {
    mem: require(memMod),
    comp: require(compMod),
    pb: require(pbMod),
    dna: require(dnaMod),
    prompts: require(promptsMod),
  };
}
let { mem, comp, pb, dna, prompts } = reload();

const has = (snap, needle) => ['decisions', 'filesTouched', 'preferences', 'pendingSteps']
  .some((k) => (snap[k] ?? []).some((x) => x.text.includes(needle)));
const rawSnap = (ws) => JSON.parse(readFileSync(join(ws, '.surnia', 'memory-snapshot.json'), 'utf8'));

// ============================================================
// A — MEMORY: write → disk → 2 compactions → restart → FINAL prompt
// ============================================================
const ORIGINAL = 'V1131 original task: remember everything across compaction and restart';
const D1 = ['V1131D1A keep memory advisory', 'V1131D1B evidence from real files',
  'V1131D1C never invent a preference', 'V1131D1D version every revision'];
const F1 = ['V1131F1A.ts', 'V1131F1B.ts', 'V1131F1C.ts'];
const P1 = ['V1131P1A answer Arabic', 'V1131P1B show file line', 'V1131P1C run tests first'];
const N1 = ['V1131N1A verify tsc', 'V1131N1B report honestly'];
const S1 = [
  '## Decisions made (with the WHY)', ...D1.map((d) => `- ${d}`),
  '## Files touched (path — what changed and why)', ...F1.map((f) => `- ${f} — touched`),
  '## Next steps (ordered, concrete)', ...N1.map((n) => `- ${n}`),
].join('\n');
const D2 = ['V1131D2A facts stay on disk', 'V1131D2B cap is storage honest'];
const F2 = ['V1131F2A.ts'];
const P2 = ['V1131P2A prefer edit_file'];
const N2 = ['V1131N2A write real files'];
const S2 = [
  '## Decisions made (with the WHY)', '- V1131D1S scraped from real summary',
  '## Files touched (path — what changed and why)', '- V1131F1S.ts — scraped',
].join('\n');
const ALL_MEMORY = [...D1, ...F1, ...P1, ...N1, 'V1131D1S', 'V1131F1S.ts', ...D2, ...F2, ...P2, ...N2];

test('A1 WRITE: memorySnapshot persists REAL bytes (snapshot + history)', () => {
  const snap = mem.memorySnapshot({
    workspace: WS_MEM, userDataDir: UD, originalTask: ORIGINAL,
    preferences: ['V1131PREFWRITER post-run writer is live'], reason: 'v1131-write',
  });
  assert.ok(snap.version >= 1);
  const disk = rawSnap(WS_MEM);
  assert.equal(disk.originalTask, ORIGINAL, 'original task in raw bytes');
  assert.ok(disk.preferences.some((f) => f.text.includes('V1131PREFWRITER')), 'new fact in raw bytes');
  assert.equal(JSON.parse(readFileSync(join(WS_MEM, '.surnia', 'memory-history.json'), 'utf8'))[0].reason, 'v1131-write');
});

test('A2 COMPACT x2: every fact from #1 survives #2, versions/history intact', () => {
  const first = comp.buildCompactionMemory({
    head: [{ role: 'user', text: ORIGINAL }], rawMessages: [{ role: 'user', text: ORIGINAL }],
    summary: S1, decisions: D1, filesTouched: F1, preferences: P1, pendingSteps: N1,
    workspace: WS_MEM, userDataDir: UD, sessionId: 'v1131', reason: 'v1131-compact-1',
  });
  assert.equal(first.originalTask, ORIGINAL);
  const second = comp.buildCompactionMemory({
    head: [{ role: 'user', text: 'Follow-up: forget nothing.' }],
    summary: S2, decisions: D2, filesTouched: F2, preferences: P2, pendingSteps: N2,
    workspace: WS_MEM, userDataDir: UD, sessionId: 'v1131', reason: 'v1131-compact-2',
  });
  assert.equal(second.snapshot.originalTask, ORIGINAL, 'second compaction does not overwrite the task');
  for (const f of ALL_MEMORY) {
    assert.ok(has(second.snapshot, f), `${f} in returned snapshot after compaction #2`);
    assert.ok(has(comp.readMemorySnapshot(WS_MEM), f), `${f} on disk after compaction #2`);
  }
  const versions = comp.readMemoryHistory(WS_MEM).map((h) => h.version).sort((a, b) => a - b);
  assert.deepEqual(versions, [1, 2, 3], 'write + two compactions = 3 versions in history');
});

test('A3 RESTART: fresh modules re-read every fact from the real files', () => {
  ({ mem, comp, pb, dna, prompts } = reload());
  const snap = comp.readMemorySnapshot(WS_MEM);
  assert.equal(snap.originalTask, ORIGINAL);
  for (const f of ALL_MEMORY) assert.ok(has(snap, f), `${f} present after simulated restart`);
});

test('A4 FINAL PROMPT: every fact reaches the dynamic tail of the built system prompt', () => {
  const body = pb.renderPlaybookPrompt(pb.loadPlaybook(WS_MEM));
  assert.ok(body.includes('CUMULATIVE SESSION MEMORY'), 'memory block appended to playbook body');
  assert.ok(prompts.playbookCarriesMemory(body), 'dedup guard recognizes the marker');
  const sys = prompts.buildSystemPrompt({ workspace: WS_MEM, mode: 'default', platform: 'win32', playbook: body });
  const pieces = sys.split(prompts.SYSTEM_CACHE_SPLIT);
  assert.ok(pieces.length >= 2, 'system prompt has a cache split');
  assert.ok(!pieces[0].includes('CUMULATIVE SESSION MEMORY'), 'marker NOT in the cached prefix');
  const tail = pieces.slice(1).join(prompts.SYSTEM_CACHE_SPLIT);
  assert.ok(tail.includes(ORIGINAL), 'original task in the dynamic tail');
  for (const f of ALL_MEMORY) assert.ok(tail.includes(f), `${f} reaches the FINAL prompt dynamic tail`);
});

// ============================================================
// B — DNA: pattern → dna.json → event → prompt → restart
// ============================================================
const DNA_PATTERN = 'Always run typecheck before committing (v1131)';
const DNA_PATH = join(UD, 'dna.json');

test('B1 DNA: mergeExtractionInto writes raw dna.json + emits kdx:dna:event', async () => {
  globalThis.__v1131DnaEvents.length = 0;
  const changed = await dna.mergeExtractionInto(WS_DNA, {
    patterns_additions: [{ kind: 'workflow', text: DNA_PATTERN }],
    profile_additions: { likes: ['concise answers (v1131)'] },
  });
  assert.equal(changed, true, 'extraction reported a real change');
  assert.ok(existsSync(DNA_PATH), 'dna.json physically written');
  const disk = JSON.parse(readFileSync(DNA_PATH, 'utf8'));
  assert.ok(disk.patterns.some((p) => p.text === DNA_PATTERN), 'pattern in raw dna.json bytes');
  assert.equal(disk.stats.factsRecorded, 1, 'factsRecorded bumped');
  assert.equal(disk.stats.sessionsObserved, 1, 'sessionsObserved bumped');
  assert.ok(
    globalThis.__v1131DnaEvents.some((e) => e.ch === 'kdx:dna:event' && e.payload?.type === 'updated' && e.payload?.payload?.reason === 'extraction'),
    'FAIL dna.ts:mergeExtractionInto — kdx:dna:event{type:updated,reason:extraction} must reach the renderer',
  );
});

test('B2 DNA: pattern renders into the prompt and survives a fresh module reload', () => {
  const prompt = dna.renderDNAPrompt(dna.loadDNA(WS_DNA));
  assert.ok(prompt.includes('# User DNA') === false, 'section BODY does not duplicate the heading');
  assert.ok(prompt.includes(DNA_PATTERN), 'learned pattern reaches the DNA prompt body');
  ({ mem, comp, pb, dna, prompts } = reload());
  const after = dna.loadDNA(WS_DNA);
  assert.ok(after.patterns.some((p) => p.text === DNA_PATTERN), 'pattern survives restart via raw dna.json');
  assert.ok(dna.renderDNAPrompt(after).includes(DNA_PATTERN), 'pattern still prompts after restart');
});

test('B3 DNA CAP HONESTY: at 60, new kept and oldest reinforced evicted', () => {
  const empty = () => ({
    version: 1,
    profile: { expertise: [], languages: [], likes: [], dislikes: [], styleNotes: [] },
    patterns: [], feedback: [],
    stats: { sessionsObserved: 0, factsRecorded: 0, updatedAt: 0 },
  });
  const now = Date.now();
  const base = empty();
  // 58 OLD + STRONGLY REINFORCED (most forgettable by policy), 2 NEW (fresh).
  base.patterns = [
    ...Array.from({ length: 58 }, (_, i) => ({
      id: 'old' + i, kind: 'workflow', text: 'V1131OLD_' + i,
      count: 9, firstSeen: now - 80 * 86400000, lastSeen: now - 80 * 86400000, confidence: 0.95,
    })),
    ...Array.from({ length: 2 }, (_, i) => ({
      id: 'fresh' + i, kind: 'workflow', text: 'V1131FRESH_' + i,
      count: 1, firstSeen: now, lastSeen: now, confidence: 0.4,
    })),
  ];
  const freshTexts = ['V1131BRAND_A', 'V1131BRAND_B', 'V1131BRAND_C'];
  const res = dna.mergeExtraction(base, { patterns_additions: freshTexts.map((t) => ({ kind: 'style', text: t })) });
  assert.equal(res.dna.patterns.length, 60, 'MAX_PATTERNS=60 enforced exactly');
  for (const t of [...freshTexts, 'V1131FRESH_0', 'V1131FRESH_1']) {
    assert.ok(res.dna.patterns.some((p) => p.text === t), `${t} (new) NOT silently dropped at the cap`);
  }
  assert.ok(!res.dna.patterns.some((p) => p.text === 'V1131OLD_0'), 'oldest reinforced pattern evicted first');
  assert.ok(res.dna.patterns.some((p) => p.text === 'V1131OLD_57'), 'a less-old reinforced pattern survives');
});

// ============================================================
// C — PLAYBOOK: recipe → file + history → prompt → memory
// ============================================================
const RECIPE = 'V1131RECIPE verify with: node --test tests/v1131-learning.test.mjs';

test('C1 RECIPE: learnPlaybook writes playbook.json + PLAYBOOK.md + history', async () => {
  const res = await pb.learnPlaybook(WS_PB, {
    recipes: [RECIPE],
    worked: ['V1131WORKED real artifact verification works'],
    sessionId: 'v1131-playbook',
  });
  assert.equal(res.changed, true, 'learning reported a change');
  assert.ok(res.data.version >= 1);
  const sidecar = JSON.parse(readFileSync(join(WS_PB, '.surnia', 'playbook.json'), 'utf8'));
  assert.ok(sidecar.recipes.some((r) => r.text.includes('V1131RECIPE')), 'recipe in raw playbook.json bytes');
  const md = readFileSync(join(WS_PB, '.surnia', 'PLAYBOOK.md'), 'utf8');
  assert.ok(md.includes('V1131RECIPE'), 'recipe in human-readable PLAYBOOK.md');
  const hist = JSON.parse(readFileSync(join(WS_PB, '.surnia', 'playbook-history.json'), 'utf8'));
  assert.ok(hist[0].snapshot.includes('V1131RECIPE'), 'recipe in revision snapshot');
});

test('C2 RECIPE: reaches playbook prompt, durable memory, and FINAL system prompt', async () => {
  ({ mem, comp, pb, dna, prompts } = reload());
  const data = pb.loadPlaybook(WS_PB);
  const body = pb.renderPlaybookPrompt(data);
  assert.ok(body.includes('V1131RECIPE'), 'recipe rendered in the playbook prompt body');
  const snap = comp.readMemorySnapshot(WS_PB);
  assert.ok(snap.decisions.some((f) => f.text.includes('V1131RECIPE')), 'recipe replayed into durable memory as a decision');
  const sys = prompts.buildSystemPrompt({ workspace: WS_PB, mode: 'default', platform: 'win32', playbook: body });
  assert.ok(sys.includes('V1131RECIPE'), 'recipe reaches the FINAL system prompt');
});

// ============================================================
// D — HONESTY AT BOUNDS + NEW-FACT EVICTION (memory + playbook)
// ============================================================
test('D1 MEMORY CAPS: exact RENDER_CAP=4000 / MAX_STORED_FACTS=1024, new kept at cap', () => {
  assert.equal(mem.RENDER_CAP, 4000);
  assert.equal(mem.MAX_STORED_FACTS, 1024);
  assert.equal(comp.RENDER_CAP, 4000);
  const WS_CAP = join(tmp, 'ws-cap');
  mkdirSync(join(WS_CAP, '.surnia'), { recursive: true });
  // 1024 facts, all reinforced+old except one NEW tail fact.
  const decisions = Array.from({ length: 1024 }, (_, i) => ({
    text: `V1131CAP_${String(i).padStart(4, '0')} stored decision`,
    count: i === 1023 ? 5 : 9,
    firstSeen: 1000 + i, lastSeen: (i === 1023 ? nowMinus(90 * 86400000) : Date.now()),
    source: 'cap-test',
  }));
  writeFileSync(join(WS_CAP, '.surnia', 'memory-snapshot.json'), JSON.stringify({
    version: 1, workspace: WS_CAP, updatedAt: Date.now(), originalTask: 'CAP TASK',
    recentTasks: [], decisions, filesTouched: [], preferences: [], pendingSteps: [], sources: [],
  }));
  const res = mem.memorySnapshot({ workspace: WS_CAP, decisions: ['V1131CAP_NEW genuinely new after cap'], reason: 'cap' });
  const disk = mem.readMemorySnapshot(WS_CAP);
  assert.equal(disk.decisions.length, 1024, 'storage cap exact: 1024');
  assert.ok(disk.decisions.some((f) => f.text.includes('V1131CAP_NEW')), 'new fact persisted');
  assert.ok(!disk.decisions.some((f) => f.text.includes('V1131CAP_0000')), 'oldest reinforced fact evicted');
  assert.ok(res.decisions.some((f) => f.text.includes('V1131CAP_NEW')), 'new fact in returned snapshot');

  // Render cap: over-wide snapshot truncates with an HONEST marker and keeps critical groups.
  const big = {
    version: 1, workspace: WS_CAP, updatedAt: Date.now(), originalTask: 'V1131_ORIGINAL never cut',
    recentTasks: [],
    preferences: Array.from({ length: 12 }, (_, i) => ({ text: `V1131P_${i} preference`, count: 1, firstSeen: 1 + i, lastSeen: 2 + i })),
    decisions: Array.from({ length: 12 }, (_, i) => ({ text: `V1131D_${i} decision`, count: 1, firstSeen: 1 + i, lastSeen: 2 + i })),
    filesTouched: Array.from({ length: 12 }, (_, i) => ({ text: `V1131F_${i}.ts`, count: 1, firstSeen: 1 + i, lastSeen: 2 + i })),
    pendingSteps: Array.from({ length: 30 }, (_, i) => ({ text: `V1131N_${i} low priority ${'x'.repeat(120)}`, count: 1, firstSeen: 1 + i, lastSeen: 2 + i })),
    sources: [],
  };
  const block = mem.renderMemorySnapshot(big);
  assert.ok(block.length <= mem.RENDER_CAP, `default render <= 4000 (got ${block.length})`);
  assert.ok(block.includes('… [memory truncated'), 'honest truncation marker');
  for (const m of ['V1131_ORIGINAL', 'V1131P_', 'V1131D_', 'V1131F_']) assert.ok(block.includes(m), `${m} survives truncation`);
  assert.ok(mem.renderMemorySnapshot(big, { cap: 60000 }).includes('V1131N_0'), 'wide cap reveals the full set');
});
function nowMinus(ms) { return Date.now() - ms; }

test('D2 PLAYBOOK CAP: a new lesson survives a full (24) section — no silent loss', async () => {
  const old = Array.from({ length: 24 }, (_, i) => ({
    id: 'old' + i, text: `V1131OLDPREF_${String(i).padStart(2, '0')} reinforced lesson`,
    count: 3, firstSeen: 1000 + i, lastSeen: Date.now() - 10_000, source: 'old',
  }));
  const WS = join(tmp, 'ws-pb-cap');
  mkdirSync(join(WS, '.surnia'), { recursive: true });
  writeFileSync(join(WS, '.surnia', 'playbook.json'), JSON.stringify({
    version: 1, workspace: WS, updatedAt: Date.now(),
    worked: [], failed: [], preferences: old, recipes: [], lastLearned: '', sessionsObserved: 1,
  }));
  await pb.learnPlaybook(WS, { preferences: ['V1131NEWPREF genuinely new preference'], sessionId: 'v1131-cap' });
  const saved = pb.loadPlaybook(WS);
  assert.equal(saved.preferences.length, 24, 'section still capped at 24');
  assert.ok(saved.preferences.some((p) => p.text.includes('V1131NEWPREF')), 'new preference NOT silently dropped');
  assert.ok(!saved.preferences.some((p) => p.text.includes('V1131OLDPREF_00')), 'oldest reinforced preference evicted');
});

// ============================================================
// E — PATH CONFINEMENT + STALE EVENTS (dna.ts)
// ============================================================
test('E1 CONFINEMENT: dna workspace writes cannot escape via ../ traversal', () => {
  // A real folder OUTSIDE the workspace that holds a sentinel workspace DNA file.
  const sentinel = join(ESCAPED, '.surnia', 'dna.json');
  writeFileSync(sentinel, JSON.stringify({
    version: 1,
    profile: { expertise: [], languages: [], likes: [], dislikes: [], styleNotes: [] },
    patterns: [{ id: 'esc', kind: 'workflow', text: 'V1131ESCAPE_SENTINEL', count: 1, firstSeen: 1, lastSeen: 2, confidence: 0.4 }],
    feedback: [], stats: { sessionsObserved: 1, factsRecorded: 1, updatedAt: 1 },
  }));
  // Keep a LITERAL `..` segment (path.join would normalize it away).
  const traversal = WS_SAFE + sep + '..' + sep + 'escaped';

  // clearDNA must not delete a file outside the workspace.
  dna.clearDNA('workspace', traversal);
  assert.ok(existsSync(sentinel), 'FAIL dna.ts:clearDNA — traversal deleted a file outside the workspace');

  // forgetMemory must not rewrite a file outside the workspace.
  dna.forgetMemory(traversal, 'V1131ESCAPE_SENTINEL');
  const after = JSON.parse(readFileSync(sentinel, 'utf8'));
  assert.ok(after.patterns.some((p) => p.text === 'V1131ESCAPE_SENTINEL'),
    'FAIL dna.ts:forgetMemory — traversal modified a file outside the workspace');

  // trustWorkspaceSkills must not create a marker outside the workspace.
  assert.equal(dna.trustWorkspaceSkills(traversal), false, 'FAIL dna.ts:trustWorkspaceSkills — traversal accepted');
  assert.ok(!existsSync(join(ESCAPED, '.surnia', 'skills-trusted')),
    'FAIL dna.ts:trustWorkspaceSkills — created a marker outside the workspace');
});

test('E2 STALE EVENT: programmatic DNA writes notify the renderer store', async () => {
  // B1 wrote the pattern to global DNA via mergeExtractionInto (which emits).
  // A *different* programmatic writer, forgetMemory, removes it — the store
  // only reloads on kdx:dna:event, so it MUST emit too.
  await dna.mergeExtractionInto(WS_DNA, { patterns_additions: [{ kind: 'style', text: 'V1131FORGET_ME' }] });
  globalThis.__v1131DnaEvents.length = 0;
  const removed = dna.forgetMemory(undefined, 'V1131FORGET_ME');
  assert.ok(removed >= 1, 'forgetMemory actually removed the pattern');
  assert.ok(
    globalThis.__v1131DnaEvents.some((e) => e.ch === 'kdx:dna:event' && e.payload?.type === 'updated'),
    'FAIL dna.ts:forgetMemory — removed a pattern but emitted no kdx:dna:event (UI stays stale)',
  );

  // saveDNA is another global writer (profile import); it must notify too.
  const model = dna.loadDNA(WS_DNA);
  globalThis.__v1131DnaEvents.length = 0;
  dna.saveDNA(model);
  assert.ok(
    globalThis.__v1131DnaEvents.some((e) => e.ch === 'kdx:dna:event' && e.payload?.type === 'updated'),
    'FAIL dna.ts:saveDNA — wrote dna.json but emitted no kdx:dna:event (UI stays stale)',
  );
});

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
