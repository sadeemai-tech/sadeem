import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.34 — DNA KEEPS LEARNING (founder: "بطل يتعلم النموذج")
// ------------------------------------------------------------
// The founder reported that DNA "stopped at a certain number" and stopped
// improving. This suite drives the REAL dna.ts + prompts.ts modules (freshly
// esbuild-bundled from source, no mocks of the modules under test) through
// 100 SEQUENTIAL extraction runs with a DISTINCT learnable fact each time and
// proves:
//
//   1. the cumulative counter keeps rising (100 facts / 100 sessions) while
//      the ACTIVE window stays honestly bounded at 60;
//   2. the oldest, most-reinforced patterns are EVICTED and every new fact is
//      kept (no silent drop at the cap);
//   3. the newest fact still reaches the NEXT system prompt (dynamic tail,
//      after the v11.16 cache split) — the old top-8-by-confidence render
//      could never surface a brand-new 0.4-confidence pattern once 8
//      reinforced 0.95 patterns existed;
//   4. genuinely new facts sharing a long prefix are NOT absorbed by dedup;
//   5. re-learning the same fact does not duplicate or inflate the counter;
//   6. the growth log plots cumulative facts, not the capped active count.
//
// Run: node --test --test-force-exit tests/v1134-dna-learning.test.mjs
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
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1134-dna-'));
const UD = join(tmp, 'userdata');
const WS = join(tmp, 'ws');
mkdirSync(UD, { recursive: true });
mkdirSync(WS, { recursive: true });

// electron stub: app.getPath('userData') -> UD; record kdx:dna:event broadcasts.
globalThis.__v1134DnaEvents = [];
const STUB = join(tmp, 'node_modules', 'electron');
mkdirSync(STUB, { recursive: true });
writeFileSync(join(STUB, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(STUB, 'index.js'),
  'const sent = globalThis.__v1134DnaEvents || (globalThis.__v1134DnaEvents = []);\n' +
    'module.exports = {\n' +
    '  app: { getPath: () => ' + JSON.stringify(UD) + ' },\n' +
    '  ipcMain: { handle() {} },\n' +
    '  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (ch, payload) => sent.push({ ch, payload }) } }] },\n' +
    '};\n',
);

function bundle(entry, out) {
  execFileSync(
    ESBUILD_NODE,
    [ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`, '--external:electron'],
    { cwd: ROOT, stdio: 'pipe' },
  );
}
const dnaMod = join(tmp, 'dna.cjs');
const promptsMod = join(tmp, 'prompts.cjs');
bundle('electron/agent/dna.ts', dnaMod);
bundle('electron/agent/prompts.ts', promptsMod);
const dna = require(dnaMod);
const prompts = require(promptsMod);

const DNA_PATH = join(UD, 'dna.json');
const STATS_PATH = join(UD, 'dna-stats.json');
const readDnaFile = () => (existsSync(DNA_PATH) ? JSON.parse(readFileSync(DNA_PATH, 'utf8')) : null);
const fact = (i) => `V1134_RUN_${String(i).padStart(3, '0')} zeta_${i} durable learning fact`;

// ============================================================
// 1 + 2 — 100 sequential runs: cumulative learning, honest cap, eviction
// ============================================================
test('v11.34: 100 sequential runs keep accumulating facts; old reinforced patterns are evicted, new ones kept', async (t) => {
  dna.clearDNA('all');
  globalThis.__v1134DnaEvents.length = 0;

  for (let i = 0; i < 100; i++) {
    const changed = await dna.mergeExtractionInto(WS, {
      patterns_additions: [{ kind: 'workflow', text: fact(i) }],
    });
    assert.equal(changed, true, `run ${i}: a genuinely new fact must report a real change`);
  }

  const disk = readDnaFile();
  assert.ok(disk, 'dna.json physically written');
  assert.equal(disk.stats.factsRecorded, 100, 'cumulative facts learned keeps rising across 100 runs');
  assert.equal(disk.stats.sessionsObserved, 100, 'one observed session per completed run');
  assert.equal(disk.patterns.length, 60, 'ACTIVE window stays honestly bounded at 60 (never pretends unlimited)');

  const texts = new Set(disk.patterns.map((p) => p.text));
  for (let i = 40; i < 100; i++) {
    assert.ok(texts.has(fact(i)), `newest fact ${i} survived the cap (new facts are never silently dropped)`);
  }
  for (let i = 0; i < 40; i++) {
    assert.ok(!texts.has(fact(i)), `oldest fact ${i} was evicted as the window filled`);
  }
  assert.ok(
    globalThis.__v1134DnaEvents.some((e) => e.ch === 'kdx:dna:event' && e.payload?.type === 'updated'),
    'every merge notified the renderer — the UI never goes stale while learning',
  );

  await t.test('honest caps are exported and documented', () => {
    assert.equal(dna.DNA_LIMITS.maxPatterns, 60);
    assert.equal(dna.DNA_LIMITS.promptPatterns, 8);
    assert.ok(dna.DNA_LIMITS.promptNewPatterns >= 1, 'at least one prompt slot reserved for new facts');
  });
});

// ============================================================
// 3 — the newest fact still reaches the NEXT system prompt
// ============================================================
test('v11.34: after 100 runs the newest fact reaches the next system prompt (dynamic tail)', () => {
  const model = dna.loadDNA(WS);
  assert.ok(model.patterns.some((p) => p.text === fact(99)), 'fact 99 is in the active model');

  const body = dna.renderDNAPrompt(model);
  assert.ok(body.includes(fact(99)), 'FAIL dna.ts:renderDNAPrompt — newest learned fact not rendered');
  assert.ok(/100 facts recorded over 100 sessions/.test(body), 'prompt states cumulative learning honestly');
  assert.ok(/active cap 60/.test(body), 'prompt documents the active cap (bounded, not frozen)');
  assert.ok(body.includes('dna_note'), 'prompt carries the extraction signal to dna_note new facts');
  assert.ok(body.includes('ALREADY learned'), 'prompt marks existing facts to avoid re-learning them');

  const sys = prompts.buildSystemPrompt({ workspace: WS, mode: 'default', platform: 'win32', dna: body });
  assert.ok(sys.includes('# User DNA'), 'system prompt carries the DNA section');
  assert.ok(sys.includes(fact(99)), 'FAIL prompts.ts:DNA section — newest learned fact dropped from the system prompt');
  assert.ok(sys.includes('never assume DNA is full'), 'DNA section tells the model learning never stops');

  const pieces = sys.split(prompts.SYSTEM_CACHE_SPLIT);
  assert.ok(pieces.length >= 2, 'system prompt has the v11.16 cache split');
  assert.ok(!pieces[0].includes(fact(99)), 'new fact is NOT in the byte-stable cached prefix');
  const tail = pieces.slice(1).join(prompts.SYSTEM_CACHE_SPLIT);
  assert.ok(tail.includes(fact(99)), 'new fact lives in the uncached dynamic tail every turn');
});

// ============================================================
// 4 — dedup must not absorb genuinely new facts with a shared prefix
// ============================================================
test('v11.34: two distinct facts sharing a >48-char prefix are both learned', async () => {
  dna.clearDNA('all');
  const shared = 'V1134SHARED ' + 'same beginning '.repeat(6); // > 48 chars
  const a = shared + 'LEFT branch outcome';
  const b = shared + 'RIGHT branch outcome';
  assert.ok(a.slice(0, 48) === b.slice(0, 48), 'fixture really collides under the old 48-char prefix key');

  await dna.mergeExtractionInto(WS, { patterns_additions: [{ kind: 'workflow', text: a }] });
  await dna.mergeExtractionInto(WS, { patterns_additions: [{ kind: 'workflow', text: a }] }); // exact repeat
  await dna.mergeExtractionInto(WS, { patterns_additions: [{ kind: 'style', text: b }] });

  const disk = readDnaFile();
  assert.equal(disk.stats.factsRecorded, 2, 'only genuinely new facts bump the cumulative counter');
  assert.equal(disk.patterns.length, 2, 'both distinct facts survived (no silent absorption)');
  const pa = disk.patterns.find((p) => p.text === a);
  assert.equal(pa.count, 2, 'exact repeat reinforced the existing pattern, not duplicated it');
  assert.ok(disk.patterns.some((p) => p.text === b), 'the genuinely new prefix-colliding fact was learned');
});

// ============================================================
// 5 — re-learning the same fact never inflates the model
// ============================================================
test('v11.34: re-learning an already-known fact does not duplicate or inflate factsRecorded', async () => {
  dna.clearDNA('all');
  const text = 'V1134 repeat me — already learned once';
  await dna.mergeExtractionInto(WS, { patterns_additions: [{ kind: 'workflow', text }] });
  for (let i = 0; i < 5; i++) {
    const changed = await dna.mergeExtractionInto(WS, { patterns_additions: [{ kind: 'correction', text }] });
    assert.equal(changed, true, 'reinforcement is still a real update (count/confidence rise)');
  }
  const disk = readDnaFile();
  assert.equal(disk.stats.factsRecorded, 1, 're-learning the same fact never inflates the cumulative counter');
  assert.equal(disk.patterns.length, 1, 'no duplicate pattern created');
  assert.equal(disk.patterns[0].count, 6, 'repetition hardened the single pattern');
  assert.equal(disk.patterns[0].kind, 'correction', 'a correction hardens the label');
});

// ============================================================
// 6 — growth log plots cumulative learning, not the capped active count
// ============================================================
test('v11.34: stats growth keeps rising after the cap (honest 100 facts / 60 active)', async () => {
  dna.clearDNA('all');
  for (let i = 0; i < 70; i++) {
    await dna.mergeExtractionInto(WS, { patterns_additions: [{ kind: 'workflow', text: fact(i) }] });
  }
  const rows = JSON.parse(readFileSync(STATS_PATH, 'utf8'));
  const today = rows[rows.length - 1];
  assert.equal(today.patterns, 60, 'active count capped at 60');
  assert.equal(today.facts, 70, 'growth row records 70 cumulative facts, not 60 active patterns');

  const stats = dna.dnaStats(WS);
  assert.equal(stats.patterns, 60, 'dnaStats reports the bounded active window');
  assert.equal(stats.factsRecorded, 70, 'dnaStats reports cumulative learning');
  assert.equal(stats.growth[stats.growth.length - 1].count, 70, 'growth chart plots cumulative facts');
});

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
