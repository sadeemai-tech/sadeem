import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.35 — MEMORY CONTINUITY (REAL ARTIFACTS, FRESH MODULE)
// ------------------------------------------------------------
// The founder's complaint: "بطل يتعلم النموذج، خلص وقف على عدد معين، بطل يزداد"
// ("the model stopped learning, stopped at a number, doesn't grow").
// This suite does NOT trust comments. It bundles the REAL
// electron/services/memoryContinuity.ts and drives it against REAL files:
//
//   T1  WRITE        — durable facts land in real continuity.json bytes with
//                      provenance + firstSeen/lastSeen timestamps.
//   T2  RESTART      — require.cache dropped, a FRESH module instance recalls
//                      every distinct fact from disk.
//   T3  REINFORCE    — an exact repeat increments count (no duplicate), while a
//                      text differing only at the TAIL is a distinct fact
//                      (full-text dedup, not prefix dedup).
//   T4  EVICTION     — at the honest cap a NEW fact is kept, the OLDEST +
//                      MOST-REINFORCED fact is retired, and the real retired
//                      text is reported + the evicted counter is persisted.
//   T5  PROMPT BLOCK — a SHORT advisory block contains the NEWEST fact, stays
//                      under the render cap, and still contains it after
//                      pathological truncation (with an honest marker).
//   T6  SCOPES       — user-scope facts live in userDataDir and render together
//                      with project facts; recall is offline + deterministic.
//   T7  CONFINEMENT  — traversal/UNC targets cannot write outside their root.
//
//   node --test --test-force-exit tests/v1135-memory-continuity.test.mjs
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
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1135-continuity-'));
const WS = join(tmp, 'workspace');
const UD = join(tmp, 'userdata');
const WS_CAP = join(tmp, 'workspace-cap');
const OUTSIDE = join(tmp, 'outside');
for (const d of [WS, UD, WS_CAP, OUTSIDE]) mkdirSync(d, { recursive: true });

const mod = join(tmp, 'memoryContinuity.cjs');
execFileSync(ESBUILD_NODE, [
  ESBUILD_BIN,
  join(ROOT, 'electron/services/memoryContinuity.ts'),
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${mod}`,
], { cwd: ROOT, stdio: 'pipe' });

function fresh() {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}
let mc = fresh();

const T0 = 1_700_000_000_000; // fixed clock — deterministic timestamps
const rawStore = (dir) => JSON.parse(readFileSync(join(dir, '.surnia', 'continuity.json'), 'utf8'));
const rawUserStore = () => JSON.parse(readFileSync(join(UD, 'continuity.json'), 'utf8'));

// ------------------------------------------------------------
// T1 — REAL WRITE: facts + provenance + timestamps in raw bytes.
// ------------------------------------------------------------
test('T1 WRITE: distinct durable facts reach real continuity.json bytes with provenance + timestamps', () => {
  const project = { workspace: WS, scope: 'project' };
  const a = mc.writeContinuityFact({
    ...project, text: 'V1135DEC_A keep memory local and honest', kind: 'decision',
    provenance: 'remember', source: 'src: electron/agent/tools.ts:3188', at: T0,
  });
  const b = mc.writeContinuityFact({
    ...project, text: 'V1135PREF_B answer in Arabic when asked', kind: 'preference',
    provenance: 'dna_note', at: T0 + 1,
  });
  const c = mc.writeContinuityFact({
    ...project, text: 'V1135FACT_C the build must stay offline', kind: 'fact',
    provenance: 'user', at: T0 + 2,
  });
  for (const r of [a, b, c]) {
    assert.equal(r.ok, true, `write ok: ${r.error ?? ''}`);
    assert.equal(r.action, 'added');
    assert.ok(r.fact.id && r.fact.firstSeen && r.fact.lastSeen);
  }
  assert.ok(a.fact.id !== b.fact.id && b.fact.id !== c.fact.id, 'each distinct fact has its own id');
  assert.equal(a.fact.source, 'src: electron/agent/tools.ts:3188');

  const disk = rawStore(WS);
  assert.equal(disk.version, 3, 'three real writes = version 3 in raw bytes');
  assert.ok(disk.facts.some((f) => f.text.includes('V1135DEC_A') && f.provenance === 'remember' && f.firstSeen === T0),
    'decision + provenance + firstSeen in raw bytes');
  assert.ok(disk.facts.some((f) => f.text.includes('V1135PREF_B') && f.kind === 'preference' && f.lastSeen === T0 + 1),
    'preference + lastSeen in raw bytes');
  assert.ok(disk.facts.some((f) => f.text.includes('V1135FACT_C')), 'third distinct fact in raw bytes');
});

// ------------------------------------------------------------
// T2 — RESTART: fresh module instance re-reads everything from disk.
// ------------------------------------------------------------
test('T2 RESTART: a fresh module instance recalls every distinct fact from disk', () => {
  mc = fresh(); // simulate process restart — all in-memory state is gone
  const read = mc.readContinuity({ workspace: WS, scope: 'project' });
  assert.equal(read.facts.length, 3);
  for (const needle of ['V1135DEC_A', 'V1135PREF_B', 'V1135FACT_C']) {
    assert.ok(read.facts.some((f) => f.text.includes(needle)), `${needle} survived restart`);
  }
  const hits = mc.recallContinuity({ workspace: WS }, 'Arabic', { limit: 4 });
  assert.ok(hits.some((h) => h.text.includes('V1135PREF_B')), 'offline recall finds the preference after restart');
  assert.equal(mc.continuityStats({ workspace: WS }).total, 3, 'stats report three facts');
});

// ------------------------------------------------------------
// T3 — DEDUP BY FULL TEXT: exact repeats reinforce, tail-difference is new.
// ------------------------------------------------------------
test('T3 DEDUP: exact repeat reinforces (count++); a tail-difference stays distinct', () => {
  const project = { workspace: WS, scope: 'project' };
  const before = mc.readContinuity(project).facts.length;
  const repeat = mc.writeContinuityFact({
    ...project, text: 'V1135DEC_A keep memory local and honest',
    provenance: 'engine', at: T0 + 10,
  });
  assert.equal(repeat.ok, true);
  assert.equal(repeat.action, 'reinforced', 'exact repeat is a reinforcement, not a duplicate');
  assert.equal(repeat.fact.count, 2, 'count incremented');
  assert.equal(repeat.fact.firstSeen, T0, 'firstSeen never moves');
  assert.equal(repeat.fact.lastSeen, T0 + 10, 'lastSeen refreshed');
  assert.equal(repeat.fact.lastProvenance, 'engine', 'latest writer recorded honestly');
  assert.equal(mc.readContinuity(project).facts.length, before, 'no duplicate row created');

  // Prefix-based systems would merge these two; full-text dedup must not.
  const tailVariant = mc.writeContinuityFact({
    ...project, text: 'V1135DEC_A keep memory local and honest — but tail differs',
    kind: 'decision', provenance: 'user', at: T0 + 11,
  });
  assert.equal(tailVariant.action, 'added', 'differs at the tail → genuinely distinct fact');
  assert.notEqual(tailVariant.fact.id, repeat.fact.id);
  assert.equal(mc.readContinuity(project).facts.length, before + 1);
  assert.equal(mc.continuityId('  V1135DEC_A   keep memory local and honest  '), repeat.fact.id,
    'dedupe key is the FULL normalized text (case/space insensitive)');
});

// ------------------------------------------------------------
// T4 — EVICTION IS HONEST: new kept, oldest+reinforced retired, counted.
// ------------------------------------------------------------
test('T4 EVICTION: at the cap a new fact is kept and the real old fact is retired', () => {
  const cap = mc.MAX_CONTINUITY_FACTS;
  assert.equal(cap, 512, 'storage cap is an explicit, honest constant');
  const seeded = Array.from({ length: cap }, (_, i) => {
    const text = `V1135CAP_${String(i).padStart(4, '0')} reinforced old fact`;
    return {
      id: mc.continuityId(text), text, kind: 'fact', scope: 'project',
      count: 9, firstSeen: T0 - cap * 1000 + i, lastSeen: T0 - cap * 1000 + i,
      provenance: 'seed',
    };
  });
  mkdirSync(join(WS_CAP, '.surnia'), { recursive: true });
  writeFileSync(join(WS_CAP, '.surnia', 'continuity.json'), JSON.stringify({
    version: 1, updatedAt: T0, scope: 'project', workspace: WS_CAP, evicted: 0, facts: seeded,
  }, null, 2));
  assert.equal(mc.readContinuity({ workspace: WS_CAP }).facts.length, cap, 'seed fills the cap exactly');

  const res = mc.writeContinuityFact({
    workspace: WS_CAP, scope: 'project', text: 'V1135CAP_NEW genuinely new after the cap',
    kind: 'decision', provenance: 'remember', at: T0 + 5_000,
  });
  assert.equal(res.ok, true);
  assert.equal(res.action, 'added');
  assert.equal(res.evicted.length, 1, 'exactly one REAL fact retired');
  assert.ok(res.evicted[0].includes('V1135CAP_0000'), 'retired text is reported, not invented');

  const disk = mc.readContinuity({ workspace: WS_CAP });
  assert.equal(disk.facts.length, cap, 'storage cap exact: 512');
  assert.ok(disk.facts.some((f) => f.text.includes('V1135CAP_NEW')), 'new fact kept — learning does not stop at a number');
  assert.ok(!disk.facts.some((f) => f.text.includes('V1135CAP_0000')), 'oldest reinforced fact evicted');
  assert.equal(disk.evicted, 1, 'evicted counter incremented');
  assert.equal(rawStore(WS_CAP).evicted, 1, 'eviction is honest in the raw bytes');
});

// ------------------------------------------------------------
// T5 — PROMPT BLOCK: short, advisory, contains the NEWEST fact.
// ------------------------------------------------------------
test('T5 PROMPT BLOCK: newest fact is always present, block is bounded, truncation is honest', () => {
  const newest = 'V1135NEWEST the most recently learned durable fact';
  const r = mc.writeContinuityFact({
    workspace: WS, scope: 'project', text: newest, kind: 'preference',
    provenance: 'user', at: T0 + 9_999,
  });
  assert.equal(r.action, 'added');

  const block = mc.renderContinuityBlock({ workspace: WS });
  assert.ok(mc.isContinuityMarker(block), 'block carries the WHAT I ALREADY KNOW marker');
  assert.ok(block.startsWith('WHAT I ALREADY KNOW'), 'short self-describing header');
  assert.ok(block.includes(newest), 'the NEWEST fact is in the prompt block');
  assert.ok(block.includes('ALREADY known') && block.includes('learning never stops'),
    'the model is told what it already knows AND that learning is unbounded by retirement');
  assert.ok(block.includes('preference') && block.includes('via user'), 'kind + provenance rendered');
  assert.ok(block.length <= mc.RENDER_CAP, `default render <= ${mc.RENDER_CAP} (got ${block.length})`);

  const tiny = mc.renderContinuityBlock({ workspace: WS }, { cap: 240 });
  assert.ok(tiny.includes(newest), 'newest fact survives a pathological cap');
  assert.ok(tiny.includes('continuity view truncated'), 'honest truncation marker');
});

// ------------------------------------------------------------
// T6 — SCOPES + RECALL: user facts survive too; recall is offline/bounded.
// ------------------------------------------------------------
test('T6 SCOPES + RECALL: user + project render together; recall is deterministic and bounded', () => {
  const r = mc.writeContinuityFact({
    scope: 'user', userDataDir: UD, text: 'V1135USER prefers concise Arabic answers',
    kind: 'preference', provenance: 'dna_note', at: T0 + 20_000,
  });
  assert.equal(r.ok, true);
  assert.equal(r.fact.scope, 'user');
  assert.ok(existsSync(join(UD, 'continuity.json')), 'user-scope store is a real file in userData');
  assert.ok(rawUserStore().facts.some((f) => f.text.includes('V1135USER')), 'fact in raw user bytes');

  const both = mc.renderContinuityBlock({ workspace: WS, userDataDir: UD });
  assert.ok(both.includes('V1135USER') && both.includes('V1135NEWEST'), 'both scopes reach one prompt block');
  assert.ok(both.indexOf('V1135USER') < both.indexOf('V1135NEWEST'), 'newest is ranked first across scopes');

  const hits = mc.recallContinuity({ workspace: WS, userDataDir: UD }, 'concise Arabic', { limit: 8 });
  assert.ok(hits.some((h) => h.text.includes('V1135USER')), 'recall finds the user preference');
  assert.ok(hits.length <= 8, 'recall limit honored');
  assert.equal(mc.recallContinuity({ workspace: WS }, '', { limit: 3 }).length, 3,
    'empty query = bounded newest view');

  const forget = mc.forgetContinuity({ workspace: WS }, 'V1135FACT_C');
  assert.equal(forget.removed, 1, 'forget removes exactly the matching fact');
});

// ------------------------------------------------------------
// T7 — CONFINEMENT: hostile workspace strings cannot escape the root.
// ------------------------------------------------------------
test('T7 CONFINEMENT: traversal and UNC targets are refused', () => {
  const traversal = OUTSIDE + sep + '..' + sep + 'escaped';
  assert.equal(mc.continuityPath({ workspace: traversal }), '', 'traversal path refused');
  const res = mc.writeContinuityFact({
    workspace: traversal, text: 'V1135ESCAPE should not escape', at: T0,
  });
  assert.equal(res.ok, false);
  assert.ok(!existsSync(join(OUTSIDE, '..', 'escaped', '.surnia', 'continuity.json')),
    'no continuity file created outside the workspace');
  assert.equal(mc.continuityPath({ scope: 'user', userDataDir: '\\\\server\\share\\data' }), '',
    'UNC userData refused');
});

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
