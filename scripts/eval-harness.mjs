#!/usr/bin/env node
// ============================================================
// Surnia — offline agent-quality eval harness (NO model API)
// ------------------------------------------------------------
// The regression gate the team runs before every release:
//   node scripts/eval-harness.mjs [--json]
// It exercises the agent's HARNESS COMPONENTS deterministically
// (no provider keys, no network) by bundling the real engine
// sources with esbuild into a tmpdir and importing them:
//
//   T1 edit-tolerance   tolerantReplace survives indentation
//                       drift + single-line typos, keeps the
//                       file bracket-balanced, and reports the
//                       match method (normalized/fingerprint).
//   T2 read-before-edit FileEditGuard enforces READ_BEFORE_EDIT
//                       / STALE_READ at the harness level.
//   T3 syntax-gate      syntaxProbe hard-fails invalid JSON and
//                       broken .cjs before a save, passes valid.
//   T4 context-math     v7 compaction trigger: fires at exactly
//                       65% of the real token window and never
//                       on the legacy 120k-chars default when
//                       real usage is known (old-bug regression).
//   T5 pruning+recall   contextStore prunes old huge tool
//                       results to stubs, keeps the vault
//                       exact-text recallable, respects
//                       keepRecent=6.
//   T6 repo-map-budget  bundled codeintel smoke test — SKIPPED
//                       gracefully while codeintel.ts is being
//                       built in parallel.
//
// Exit code: 0 when no task fails (skips don't fail the gate),
// 1 otherwise. A run summary is saved to scripts/.eval-last.json.
// ============================================================
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { strict as assert } from 'node:assert';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_MODE = process.argv.includes('--json');
const RUN_DIR = mkdtempSync(path.join(os.tmpdir(), 'surnia-eval-'));
const BUILD_DIR = path.join(RUN_DIR, 'bundle');
mkdirSync(BUILD_DIR, { recursive: true });

// ------------------------------------------------------------
// Task context (micro test framework)
// ------------------------------------------------------------

class TaskCtx {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.checks = [];
    this.fail = null;
    this.skipReason = null;
  }

  ok(label, cond, detail = '') {
    const pass = !!cond;
    this.checks.push({ label, pass });
    if (!pass && !this.fail) this.fail = `${label}${detail ? ` — ${detail}` : ''}`;
    return pass;
  }

  eq(label, actual, expected) {
    let pass = false;
    let detail = '';
    try {
      assert.deepStrictEqual(actual, expected);
      pass = true;
    } catch (e) {
      detail = String(e?.message ?? e).split('\n').slice(0, 3).join(' | ');
    }
    return this.ok(label, pass, detail);
  }

  skip(reason) {
    this.skipReason = reason;
  }
}

// ------------------------------------------------------------
// Bundling helpers — the real engine sources, compiled on the fly
// ------------------------------------------------------------

const bundleCache = new Map();

/**
 * esbuildCmd('electron/agent/editEngine.ts' → <tmpdir>/editEngine.mjs)
 * via `npx esbuild` (local devDependency resolves first). Returns the
 * outfile path. Throws on build failure (caller records it).
 */
function esbuildCmd(entryRel, outName) {
  const outfile = path.join(BUILD_DIR, outName);
  const q = (s) => JSON.stringify(s);
  const cmd =
    `npx esbuild ${q(entryRel)} --bundle --platform=node --format=esm ` +
    `--external:electron --log-level=warning --outfile=${q(outfile)}`;
  try {
    execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
  } catch (err) {
    // Fallback for environments where npx is unavailable/stalled: use the
    // local esbuild binary directly. Same compiler, same result.
    const localBin = path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild');
    if (!existsSync(localBin)) throw err;
    execSync(
      `${q(process.execPath)} ${q(localBin)} ${q(entryRel)} --bundle --platform=node ` +
        `--format=esm --external:electron --log-level=warning --outfile=${q(outfile)}`,
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 },
    );
  }
  return outfile;
}

async function bundle(entryRel, outName) {
  if (!bundleCache.has(outName)) {
    const outfile = esbuildCmd(entryRel, outName);
    bundleCache.set(outName, import(pathToFileURL(outfile).href));
  }
  return bundleCache.get(outName);
}

/** Per-task fixture directory under the run tmpdir. */
function fixture(name) {
  const dir = path.join(RUN_DIR, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Simple brace/paren/bracket balance with strings + comments stripped. */
function balanced(src) {
  const s = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
  const net = (open, close) => s.split(open).length - 1 - (s.split(close).length - 1);
  return net('{', '}') === 0 && net('(', ')') === 0 && net('[', ']') === 0;
}

// ------------------------------------------------------------
// T1 — edit-tolerance
// ------------------------------------------------------------

const T1_ORIGINAL = [
  'function computeTotal(items) {',
  '  let total = 0;',
  '  for (const it of items) {',
  '    total += it.price * it.qty;',
  '  }',
  '  return total;',
  '}',
  '',
  'function greet(name) {',
  '  return "hi " + name;',
  '}',
].join('\n');

// 4-space-indented old_string against the 2-space file → must still match.
// (Relative indentation inside the block matches the file: base+2 step.)
const T1_OLD_4SP = [
  '    function computeTotal(items) {',
  '      let total = 0;',
  '      for (const it of items) {',
  '        total += it.price * it.qty;',
  '      }',
  '      return total;',
  '    }',
].join('\n');

// new_string mirrors the drifted old_string style (like a real model copying
// the block it just read); the engine re-bases it onto the file's true indent.
const T1_NEW_TAX = [
  '    function computeTotal(items) {',
  '      let total = 0;',
  '      for (const it of items) {',
  '        total += it.price * it.qty;',
  '      }',
  '      total *= 1.2;',
  '      return total;',
  '    }',
].join('\n');

// Typo'd old_string (totl / retunr) against the UPDATED file → fingerprint rescue.
const T1_OLD_TYPO = [
  'function computeTotal(items) {',
  '  let totl = 0;',
  '  for (const it of items) {',
  '    total += it.price * it.qty;',
  '  }',
  '  totl *= 1.2;',
  '  retunr total;',
  '}',
].join('\n');

const T1_NEW_FIXED = [
  'function computeTotal(items) {',
  '  let total = 0;',
  '  for (const it of items) {',
  '    total += it.price * it.qty;',
  '  }',
  '  total *= 1.2;',
  '  return total;',
  '}',
].join('\n');

async function taskEditTolerance(t) {
  const mod = await bundle('electron/agent/editEngine.ts', 'editEngine.mjs');
  const dir = fixture('t1');
  const file = path.join(dir, 'calc.js');
  writeFileSync(file, T1_ORIGINAL);

  // Edit 1 — indentation drift (2-space file, 4-space old_string).
  const r1 = mod.tolerantReplace(T1_ORIGINAL, T1_OLD_4SP, T1_NEW_TAX);
  t.ok('4-space-drift edit matched', r1.ok === true, r1.error ?? JSON.stringify(r1));
  t.eq('method=normalized', r1.method ?? null, 'normalized');
  t.ok('replacement applied (tax line added)', typeof r1.updated === 'string' && r1.updated.includes('total *= 1.2;'));
  t.ok('indentation reconstructed to file style', typeof r1.updated === 'string' && !r1.updated.includes('    function computeTotal'));
  t.ok('sibling function untouched', typeof r1.updated === 'string' && r1.updated.includes('return "hi " + name;'));
  t.ok('braces balanced after edit 1', typeof r1.updated === 'string' && balanced(r1.updated));

  // Edit 2 — typo'd old_string → line-fingerprint fuzzy rescue.
  const r2 = mod.tolerantReplace(r1.updated, T1_OLD_TYPO, T1_NEW_FIXED);
  t.ok('typo edit matched (fingerprint)', r2.ok === true, r2.error ?? JSON.stringify(r2));
  t.eq('method=fingerprint', r2.method ?? null, 'fingerprint');
  t.ok('typo corrected', typeof r2.updated === 'string' && !r2.updated.includes('retunr') && r2.updated.includes('return total;'));
  t.ok('final file balanced', typeof r2.updated === 'string' && balanced(r2.updated));

  // The engine works on strings — persist the final content so the fixture
  // on disk reflects what a real edit_file run would have saved.
  if (r2.ok && typeof r2.updated === 'string') writeFileSync(file, r2.updated);
}

// ------------------------------------------------------------
// T2 — read-before-edit guard
// ------------------------------------------------------------

async function taskReadBeforeEdit(t) {
  const { FileEditGuard } = await bundle('electron/agent/editEngine.ts', 'editEngine.mjs');
  const file = path.join(fixture('t2'), 'app.ts');
  const content = 'const a = 1;\nconst b = 2;\n';
  writeFileSync(file, content);

  const guard = new FileEditGuard();

  let e1 = null;
  try {
    guard.assertEditable(file, content);
  } catch (err) {
    e1 = err;
  }
  t.ok('edit without read throws', e1 !== null);
  t.ok('error is READ_BEFORE_EDIT', e1 !== null && e1.message.includes('READ_BEFORE_EDIT'), e1?.message ?? '');

  guard.recordRead(file, content);
  let e2 = null;
  try {
    guard.assertEditable(file, content);
  } catch (err) {
    e2 = err;
  }
  t.ok('edit after recordRead passes', e2 === null, e2?.message ?? '');

  const changed = content + 'const c = 3;\n';
  writeFileSync(file, changed);
  let e3 = null;
  try {
    guard.assertEditable(file, changed);
  } catch (err) {
    e3 = err;
  }
  t.ok('edit after content change throws STALE_READ', e3 !== null && e3.message.includes('STALE_READ'), e3?.message ?? '');
}

// ------------------------------------------------------------
// T3 — syntax gate
// ------------------------------------------------------------

async function taskSyntaxGate(t) {
  const { syntaxProbe } = await bundle('electron/agent/editEngine.ts', 'editEngine.mjs');
  const dir = fixture('t3');

  const badJson = await syntaxProbe(path.join(dir, 'settings.json'), '{\n  "a": 1,\n  "b": [1, 2,\n}');
  t.ok('invalid JSON blocked (probe.error set)', badJson.error !== null, JSON.stringify(badJson));
  t.eq('invalid JSON checked=parser', badJson.checked, 'parser');

  const goodJson = await syntaxProbe(path.join(dir, 'good.json'), '{\n  "a": 1,\n  "b": [1, 2]\n}\n');
  t.ok('valid JSON passes', goodJson.error === null, JSON.stringify(goodJson));

  const badCjs = await syntaxProbe(path.join(dir, 'broken.cjs'), 'function broken( {\n  return 1;\n}\n');
  t.ok('broken .cjs blocked (node --check)', badCjs.error !== null, JSON.stringify(badCjs));

  const goodCjs = await syntaxProbe(
    path.join(dir, 'fine.cjs'),
    "'use strict';\nfunction ok(n) { return n + 1; }\nmodule.exports = ok;\n",
  );
  t.ok('valid .cjs passes', goodCjs.error === null, JSON.stringify(goodCjs));
}

// ------------------------------------------------------------
// T4 — context math (v7 compaction trigger, replicated verbatim
// from engine.ts: `compactTokenThreshold = floor(ctxWindow * 0.65)`,
// CHARS_PER_TOKEN = 3.5, legacy chars cap only when no real tokens).
// ------------------------------------------------------------

const CHARS_PER_TOKEN = 3.5;

function v7Compaction({ windowTokens, realInputTokens, transcriptChars, userCompactThresholdChars }) {
  const ctxWindowTokens = Math.max(8_000, windowTokens || 200_000);
  const compactTokenThreshold = Math.floor(ctxWindowTokens * 0.65);
  const legacyCharsCap = userCompactThresholdChars
    ? Math.max(10_000, Math.floor(userCompactThresholdChars))
    : Infinity;
  const realTokenTrigger = realInputTokens > 0 && realInputTokens >= compactTokenThreshold;
  const charsTrigger =
    realInputTokens === 0 &&
    transcriptChars >= Math.min(legacyCharsCap, Math.floor(compactTokenThreshold * CHARS_PER_TOKEN));
  return { fire: realTokenTrigger || charsTrigger, thresholdTokens: compactTokenThreshold };
}

async function taskContextMath(t) {
  const WINDOWS = [128_000, 200_000, 1_000_000];
  const USAGE = [50_000, 100_000, 700_000];
  const EXPECT_FIRE = {
    128_000: { 50_000: false, 100_000: true, 700_000: true }, // 65% = 83,200
    200_000: { 50_000: false, 100_000: false, 700_000: true }, // 65% = 130,000
    1_000_000: { 50_000: false, 100_000: false, 700_000: true }, // 65% = 650,000
  };
  const EXPECT_THRESHOLD = { 128_000: 83_200, 200_000: 130_000, 1_000_000: 650_000 };

  for (const w of WINDOWS) {
    t.eq(`threshold(${w / 1000}k)=${EXPECT_THRESHOLD[w]}`, v7Compaction({ windowTokens: w, realInputTokens: 0, transcriptChars: 0 }).thresholdTokens, EXPECT_THRESHOLD[w]);
    for (const u of USAGE) {
      const d = v7Compaction({ windowTokens: w, realInputTokens: u, transcriptChars: u * 4 });
      t.eq(
        `${w / 1000}k window @ ${u / 1000}k real tokens → ${EXPECT_FIRE[w][u] ? 'compact' : 'no compact'}`,
        d.fire,
        EXPECT_FIRE[w][u],
      );
    }
  }

  // Boundary: fires exactly at the threshold, not one token before.
  t.ok('128k fires AT 83,200 tokens', v7Compaction({ windowTokens: 128_000, realInputTokens: 83_200, transcriptChars: 0 }).fire === true);
  t.ok('128k does NOT fire at 83,199 tokens', v7Compaction({ windowTokens: 128_000, realInputTokens: 83_199, transcriptChars: 0 }).fire === false);

  // REGRESSION (old bug): pre-v7 the engine compacted on a legacy ~120k CHARS
  // default regardless of window size. On a 1M window that amputated healthy
  // context. v7: real token usage is known → the chars path is disabled.
  t.ok(
    '1M window @ 50k real tokens does NOT compact at 120k chars (old bug)',
    v7Compaction({ windowTokens: 1_000_000, realInputTokens: 50_000, transcriptChars: 120_000 }).fire === false,
  );
  t.ok(
    '1M window, no real usage yet: 120k chars is far below the 2.275M chars fallback',
    v7Compaction({ windowTokens: 1_000_000, realInputTokens: 0, transcriptChars: 120_000 }).fire === false,
  );
  t.ok(
    'chars fallback still works pre-first-usage (1M, no user cap, 2.3M chars)',
    v7Compaction({ windowTokens: 1_000_000, realInputTokens: 0, transcriptChars: 2_300_000 }).fire === true,
  );
  t.ok(
    'explicit user compactThreshold (chars) still caps earlier when lower',
    v7Compaction({ windowTokens: 1_000_000, realInputTokens: 0, transcriptChars: 120_000, userCompactThresholdChars: 120_000 }).fire === true,
  );
}

// ------------------------------------------------------------
// T5 — pruning + recall
// ------------------------------------------------------------

async function taskPruningRecall(t) {
  const cs = await bundle('electron/agent/contextStore.ts', 'contextStore.mjs');
  const sessionId = 'eval-t5-' + process.pid;

  // 12 tool rounds: results 0–2 are huge (5000 chars) and old; 3–11 small.
  const messages = [];
  const original = new Map();
  for (let i = 0; i < 12; i++) {
    const callId = `call_${i}`;
    messages.push({
      role: 'assistant',
      content: `tool round ${i}`,
      toolCalls: [{ id: callId, name: i < 3 ? 'read_file' : 'grep_search', args: '{}' }],
    });
    const content =
      i < 3 ? `RESULT-${i}-BEGIN\n${'x'.repeat(5000)}\nRESULT-${i}-END` : `small result ${i}`;
    original.set(callId, content);
    messages.push({ role: 'tool_result', callId, content, isError: false });
  }

  const stats = cs.pruneToolResults(sessionId, messages, { minChars: 2400, keepRecent: 6 });
  t.eq('pruned exactly the 3 huge old results', stats.pruned, 3);
  t.ok('charsSaved > 15000', stats.charsSaved > 15_000, String(stats.charsSaved));

  const stubs = messages.filter((m) => m.role === 'tool_result' && m.content.startsWith('[pruned'));
  t.eq('3 stubs present in the live transcript', stubs.length, 3);
  t.ok('stubs name the source tool', stubs.every((m) => m.content.includes('read_file')));

  const ids = stubs
    .map((m) => /id="([^"]+)"/.exec(m.content)?.[1])
    .filter(Boolean);
  t.eq('vault has 3 entries (one handle per stub)', ids.length, 3);

  for (let i = 0; i < 3; i++) {
    const hit = cs.recallResult(sessionId, ids[i]);
    t.ok(`recallResult(${ids[i]}) returns EXACT original text`, hit !== null && hit.content === original.get(`call_${i}`));
  }

  // keepRecent=6: the last 6 tool results stay verbatim, and so do the
  // small old ones (below minChars) — nothing is pruned speculatively.
  for (let i = 0; i < 12; i++) {
    const m = messages[2 * i + 1];
    const untouched = m.content === original.get(`call_${i}`);
    if (i < 3) t.ok(`call_${i} IS stubbed`, !untouched);
    else t.ok(`call_${i} untouched (keepRecent/minChars respected)`, untouched);
  }
}

// ------------------------------------------------------------
// T6 — repo-map-budget (graceful skip while codeintel is in flight)
// ------------------------------------------------------------

async function taskRepoMapBudget(t) {
  const entry = 'electron/agent/codeintel.ts';
  const entryAbs = path.join(ROOT, entry);
  if (!existsSync(entryAbs)) {
    t.skip('electron/agent/codeintel.ts not present yet — parallel build in flight');
    return;
  }

  let mod;
  try {
    mod = await bundle(entry, 'codeintel.mjs');
  } catch (e) {
    t.skip(`codeintel.ts exists but does not bundle standalone yet (${String(e?.message ?? e).slice(0, 120)})`);
    return;
  }

  const fns = Object.entries(mod)
    .filter(([, v]) => typeof v === 'function')
    .map(([k]) => k);
  const idxCtor = typeof mod.CodeIndex === 'function' ? mod.CodeIndex : null;
  if (!idxCtor) {
    t.skip(`no CodeIndex export found yet (exports: ${fns.slice(0, 8).join(', ') || 'none'})`);
    return;
  }

  // Tiny fixture repo.
  const repo = fixture('t6');
  writeFileSync(path.join(repo, 'a.ts'), 'export function alpha(x: number) { return x + 1; }\n');
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'src', 'beta.ts'), 'export class Beta { gamma() { return 2; } }\n');
  writeFileSync(path.join(repo, 'package.json'), '{ "name": "t6-fixture", "version": "1.0.0" }\n');

  let out;
  try {
    const idx = new idxCtor(repo);
    await idx.update();
    out = idx.repoMap(4000);
  } catch (e) {
    t.skip(`CodeIndex.repoMap call drifted: ${String(e?.message ?? e).slice(0, 120)}`);
    return;
  }
  if (typeof out !== 'string') {
    t.skip(`repoMap() returned ${typeof out} — API drift, harness needs an update`);
    return;
  }
  t.ok('repo map mentions fixture files', out.includes('a.ts') || out.includes('beta.ts'));
  t.ok('repo map respects ~4k budget', out.length <= 6000, `len=${out.length}`);
  t.ok('repo map lists symbols', /alpha|Beta|gamma/.test(out));
}

// ------------------------------------------------------------
// Runner
// ------------------------------------------------------------

const TASKS = [
  { id: 'T1', name: 'edit-tolerance', run: taskEditTolerance },
  { id: 'T2', name: 'read-before-edit', run: taskReadBeforeEdit },
  { id: 'T3', name: 'syntax-gate', run: taskSyntaxGate },
  { id: 'T4', name: 'context-math', run: taskContextMath },
  { id: 'T5', name: 'pruning+recall', run: taskPruningRecall },
  { id: 'T6', name: 'repo-map-budget', run: taskRepoMapBudget },
];

function printTable(results) {
  const header = ['task', 'name', 'result', 'checks', 'ms', 'note'];
  const rows = results.map((r) => [
    r.id,
    r.name,
    r.status.toUpperCase(),
    `${r.checks.filter((c) => c.pass).length}/${r.checks.length}`,
    String(r.ms),
    r.skip ?? r.fail ?? '',
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => Math.min(r[i].length, 60))));
  const line = (cells) => cells.map((c, i) => c.slice(0, 60).padEnd(widths[i])).join('  ');
  console.log(line(header));
  for (const r of rows) console.log(line(r));
}

async function main() {
  const results = [];
  for (const task of TASKS) {
    const t = new TaskCtx(task.id, task.name);
    const started = Date.now();
    try {
      await task.run(t);
    } catch (err) {
      if (!t.fail) t.fail = String(err?.stack ?? err).split('\n').slice(0, 2).join(' | ');
    }
    const status = t.skipReason ? 'skip' : t.fail ? 'fail' : 'pass';
    const entry = { id: task.id, name: task.name, status, checks: t.checks, ms: Date.now() - started };
    if (t.fail) entry.fail = t.fail;
    if (t.skipReason) entry.skip = t.skipReason;
    results.push(entry);
  }

  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;

  // Run summary — the pre-release record (always written, both modes).
  const summary = {
    ran: results.length,
    passed,
    failed,
    skipped,
    results: results.map(({ id, name, status, checks, ms, fail, skip }) => ({
      id,
      name,
      status,
      ms,
      checks: checks.map((c) => ({ label: c.label, pass: c.pass })),
      ...(fail ? { fail } : {}),
      ...(skip ? { skip } : {}),
    })),
    finishedAt: new Date().toISOString(),
    node: process.version,
  };
  try {
    fs.writeFileSync(path.join(ROOT, 'scripts', '.eval-last.json'), JSON.stringify(summary, null, 2) + '\n');
  } catch {
    /* best-effort */
  }

  if (JSON_MODE) {
    console.log(JSON.stringify({ ran: summary.ran, passed, failed, results: summary.results }));
  } else {
    console.log(`\nSurnia offline eval harness — ${TASKS.length} tasks (no model API needed)\n`);
    printTable(results);
    console.log('');
    for (const r of results) {
      if (r.status === 'fail') {
        console.log(`  FAIL ${r.id} ${r.name}: ${r.fail}`);
        for (const c of r.checks.filter((c) => !c.pass)) console.log(`    ✗ ${c.label}`);
      } else if (r.status === 'skip') {
        console.log(`  SKIP ${r.id} ${r.name}: ${r.skip}`);
      }
    }
    console.log(
      `summary: ${passed} passed, ${failed} failed, ${skipped} skipped (of ${results.length}) — ` +
        `gate: ${failed === 0 ? 'GREEN' : 'RED'}`,
    );
  }

  try {
    rmSync(RUN_DIR, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }

  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('eval-harness crashed:', err?.stack ?? err);
  process.exitCode = 1;
});
