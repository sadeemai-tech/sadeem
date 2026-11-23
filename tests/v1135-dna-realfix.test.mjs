import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.35 — DNA "STUCK AT 60 / NOT LEARNING" REAL FIX
// ------------------------------------------------------------
// The founder still said DNA "not learning, stuck at 60" AFTER
// v11.34 (which reserved fresh-fact slots, used full-text dedup
// and retried the extraction call). Those patches fixed the
// WRITE path; this suite targets the two things they missed:
//
//   A. THE PROMPT TRUNCATION BUG (dna.ts:renderDNAPrompt). The old
//      builder joined ALL lines then `slice(0, 1970)`. With a
//      realistic profile + real-length pattern texts the cumulative
//      LEARNING STATUS, the dna_note directive, every observed
//      fact past the first few, and ALL feedback were silently cut
//      mid-line. The model literally never received the "DNA keeps
//      learning" signal -> "it does not develop with me".
//   B. THE DISPLAY BUG (handoff): 60 is the ACTIVE cap shown by the
//      StatusBar chip / IdentitySheet; cumulative facts exist but
//      are not surfaced where the founder looks. dnaStats now
//      exposes patternCap/atCap so the UI can label `patterns`
//      honestly (see docs/DNA-RELFIX-V1135.md for file:line handoff).
//
// Run: node --test --test-force-exit tests/v1135-dna-realfix.test.mjs
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
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1135-dna-'));
const UD = join(tmp, 'userdata');
const WS = join(tmp, 'ws');
mkdirSync(UD, { recursive: true });
mkdirSync(WS, { recursive: true });

globalThis.__v1135DnaEvents = [];
const STUB = join(tmp, 'node_modules', 'electron');
mkdirSync(STUB, { recursive: true });
writeFileSync(join(STUB, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(STUB, 'index.js'),
  'const sent = globalThis.__v1135DnaEvents || (globalThis.__v1135DnaEvents = []);\n' +
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
bundle('electron/agent/dna.ts', dnaMod);
const dna = require(dnaMod);

const DNA_PATH = join(UD, 'dna.json');
const STATS_PATH = join(UD, 'dna-stats.json');
const readDnaFile = () => (existsSync(DNA_PATH) ? JSON.parse(readFileSync(DNA_PATH, 'utf8')) : null);
const empty = () => ({
  version: 1,
  profile: { expertise: [], languages: [], likes: [], dislikes: [], styleNotes: [] },
  patterns: [], feedback: [],
  stats: { sessionsObserved: 0, factsRecorded: 0, updatedAt: 0 },
});
// A real-length durable fact (~150 chars) — short fixtures never triggered
// the old 2000-char truncation, which is why v11.34's tests all passed while
// the founder still saw a dead model.
const longFact = (i) =>
  `V1135 Fact ${i}: user prefers verbose structured answers with tables and step-by-step reasoning when debugging complex TypeScript build pipelines in this workspace (${i})`;
const populated = () => {
  const now = Date.now();
  return {
    version: 1,
    profile: {
      name: 'Founder', role: 'Senior engineer',
      expertise: ['TypeScript', 'Node.js', 'Electron', 'React', 'Python', 'Go'],
      languages: ['Arabic', 'English', 'French', 'German', 'Spanish', 'Turkish'],
      likes: ['tables', 'concise diffs', 'tests first', 'strict mode'],
      dislikes: ['verbose intros', 'emoji', 'long preambles', 'unrequested summaries'],
      styleNotes: ['use 2-space indent', 'always run typecheck', 'prefer bun', 'write tests first'],
    },
    patterns: Array.from({ length: 60 }, (_, i) => ({
      id: 'p' + i, kind: 'workflow', text: longFact(i),
      count: 1 + ((i * 7) % 9), firstSeen: now - i * 1000, lastSeen: now - i * 1000,
      confidence: 0.4 + (i % 4) * 0.15,
    })),
    feedback: Array.from({ length: 5 }, (_, i) => ({
      ts: now - i * 1000, kind: 'correction',
      note: `feedback note number ${i} that is fairly long and detailed about a behavior correction`,
    })),
    stats: { sessionsObserved: 120, factsRecorded: 200, updatedAt: now },
  };
};

// ============================================================
// A — the truncation bug: critical learning signal must survive
// ============================================================
test('v1135: realistic DNA prompt keeps cumulative status, dna_note directive, newest facts and feedback', () => {
  const body = dna.renderDNAPrompt(populated());
  assert.ok(body.length <= 2000, `prompt must honour the 2000-char budget (got ${body.length})`);
  // These were ALL silently dropped by the old slice(0, 1970):
  assert.match(body, /LEARNING STATUS:.*facts recorded over.*active cap 60/i,
    'FAIL dna.ts:renderDNAPrompt — cumulative learning status truncated away (founder sees "stuck at 60")');
  assert.match(body, /CONTINUOUS LEARNING:/, 'FAIL dna.ts:renderDNAPrompt — learning directive truncated away');
  assert.ok(body.includes('dna_note'), 'FAIL dna.ts:renderDNAPrompt — dna_note extraction signal truncated away');
  assert.ok(body.includes('ALREADY learned'), 'FAIL dna.ts:renderDNAPrompt — already-known marker truncated away');
  assert.ok(body.includes(longFact(0)), 'FAIL dna.ts:renderDNAPrompt — newest learned fact truncated away');
  assert.ok(body.includes('never assume DNA is full'), 'FAIL dna.ts:renderDNAPrompt — "never full" contract must survive');
  // Feedback is the LOWEST priority (single events, not standing rules). It may
  // be dropped under real budget pressure — but then the truncation MUST be
  // reported honestly, never a silent mid-line slice like the old code did.
  if (!body.includes('RECENT FEEDBACK')) {
    assert.ok(body.includes('[truncated'), 'if feedback was cut, the truncation must be declared, not silent');
  }
  // No half-word fragment: every rendered `- ` line must be a complete fact.
  for (const line of body.split('\n')) {
    if (line.startsWith('- [')) assert.ok(/ \([0-9]+\)$/.test(line) || /\)$/.test(line), `mid-line cut: ${line}`);
  }
});

test('v1135: when the budget is genuinely exceeded, truncation is line-aware and honest', () => {
  const d = populated();
  d.patterns = Array.from({ length: 60 }, (_, i) => ({
    ...d.patterns[i], text: longFact(i) + ' X'.repeat(120), // force overflow
  }));
  const body = dna.renderDNAPrompt(d);
  assert.ok(body.length <= 2000, `budget exceeded: ${body.length}`);
  assert.match(body, /LEARNING STATUS:/, 'critical status must survive even on overflow');
  assert.match(body, /CONTINUOUS LEARNING:/, 'critical directive must survive even on overflow');
  assert.ok(body.includes(longFact(0)), 'newest fact must survive even on overflow');
  assert.ok(body.includes('[truncated'), 'overflow must be reported honestly, not silently');
  assert.ok(!/…\s*\w+\s*$/.test(body.replace(/\[truncated[^\]]*\]/, '')), 'no half-word tail fragment');
});

// ============================================================
// B — a genuinely NEW fact always reaches the NEXT prompt
// ============================================================
test('v1135: a new fact learned at the 60-cap reaches the next rendered prompt', async () => {
  dna.clearDNA('all');
  const now = Date.now();
  const old = Array.from({ length: 60 }, (_, i) => ({
    id: 'old-' + i, kind: 'workflow',
    text: longFact(i), count: 10,
    firstSeen: now - 10 * 86_400_000, lastSeen: now - 9 * 86_400_000, confidence: 0.95,
  }));
  writeFileSync(DNA_PATH, JSON.stringify({
    ...empty(), patterns: old,
    stats: { sessionsObserved: 60, factsRecorded: 60, updatedAt: now - 86_400_000 },
  }, null, 2));

  const NEW = 'V1135 BRAND NEW LEARNED FACT — always prefer bun for installs in this workspace';
  const changed = await dna.mergeExtractionInto(WS, {
    patterns_additions: [{ kind: 'command', text: NEW }],
  });
  assert.equal(changed, true, 'the new fact must be a real change');
  const disk = readDnaFile();
  assert.equal(disk.patterns.length, 60, 'active window stays honestly bounded at 60');
  assert.equal(disk.stats.factsRecorded, 61, 'cumulative learning rose past the cap');
  assert.ok(disk.patterns.some((p) => p.text === NEW), 'new fact kept at cap');

  const body = dna.renderDNAPrompt(dna.loadDNA(WS));
  assert.ok(body.includes(NEW), 'FAIL dna.ts:renderDNAPrompt — newly learned fact did not reach the NEXT prompt');
  assert.match(body, /61 facts recorded over 61 sessions/, 'prompt shows the honest cumulative number');
});

// ============================================================
// C — cumulative facts keep rising; dnaStats exposes the split
// ============================================================
test('v1135: cumulative facts rise past 60 via both write paths; dnaStats labels active vs total', async () => {
  dna.clearDNA('all');
  for (let i = 0; i < 70; i++) {
    await dna.mergeExtractionInto(WS, { patterns_additions: [{ kind: 'workflow', text: longFact(i) }] });
  }
  assert.equal(await dna.recordAgentNote('preference', 'V1135 note-only durable fact about formatting'), true);

  const stats = dna.dnaStats(WS);
  assert.equal(stats.patterns, 60, 'ACTIVE window is capped at 60 — this is the "60" the founder sees');
  assert.equal(stats.patternCap, 60, 'dnaStats exposes the honest active cap to the UI');
  assert.equal(stats.atCap, true, 'dnaStats flags that the active window is full');
  assert.ok(stats.factsRecorded >= 71,
    `cumulative facts must keep rising past the cap (got ${stats.factsRecorded}) — learning did NOT stop`);

  const rows = JSON.parse(readFileSync(STATS_PATH, 'utf8'));
  const today = rows[rows.length - 1];
  assert.equal(today.patterns, 60, 'growth row active count capped');
  assert.equal(today.facts, stats.factsRecorded, 'growth row plots cumulative facts, not active count');
  assert.equal(stats.growth[stats.growth.length - 1].count, stats.factsRecorded,
    'growth chart plots cumulative facts — the honest "still learning" signal');
});

// ============================================================
// D — empty model still omits the section (cache stability)
// ============================================================
test('v1135: an empty DNA model still renders no prompt section', () => {
  assert.equal(dna.renderDNAPrompt(empty()), '', 'empty model must stay byte-stable (section omitted)');
});

test.after(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
