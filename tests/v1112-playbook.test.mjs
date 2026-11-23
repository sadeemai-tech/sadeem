import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.12 — SIGNATURE FEATURE: Living Memory / Adaptive Playbook
// Offline verification of: real-file writes, version history, evolution
// diffs, prompt injection, reinforcement and clear. Run:
//   node --test tests/v1112-playbook.test.mjs
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
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v1112-playbook-'));

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

// electron stub: app.getPath + no BrowserWindow/ipcMain (the module guards both)
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `module.exports = { app: { getPath: () => ${JSON.stringify(join(tmp, 'ud'))} } };`);

const pbMod = join(tmp, 'playbook.cjs');
const promptsMod = join(tmp, 'prompts.cjs');
bundle(join(ROOT, 'electron/agent/playbook.ts'), pbMod);
bundle(join(ROOT, 'electron/agent/prompts.ts'), promptsMod);
const pb = require(pbMod);
const prompts = require(promptsMod);

const WS = join(tmp, 'ws');
mkdirSync(WS, { recursive: true });

test('v11.12: applyPlaybookUpdate writes REAL files on disk', () => {
  const res = pb.applyPlaybookUpdate(WS, {
    worked: ['Run npm test before claiming done'],
    failed: ['Rewriting whole files with write_file lost the diff'],
    preferences: ['User wants concise Arabic answers'],
    recipes: ['Read → edit_file → run tests → report evidence'],
    learned: 'Use edit_file after read_file here, then verify with npm test.',
    sessionId: 'sess-1',
  });
  assert.equal(res.changed, true);
  assert.ok(res.data.version >= 1);
  assert.equal(res.data.lastLearned, 'Use edit_file after read_file here, then verify with npm test.');
  assert.ok(existsSync(pb.playbookMdPath(WS)), 'PLAYBOOK.md exists');
  assert.ok(existsSync(pb.playbookHistoryPath(WS)), 'playbook-history.json exists');
  const md = readFileSync(pb.playbookMdPath(WS), 'utf8');
  for (const title of ['What worked', 'What failed', 'User preferences', 'Verified recipes']) {
    assert.ok(md.includes(title), `markdown has section: ${title}`);
  }
  assert.ok(md.includes('Run npm test before claiming done'), 'markdown contains learned lesson');
});

test('v11.12: version history records an evolution diff per revision', () => {
  const history = pb.loadPlaybookHistory(WS);
  assert.ok(history.length >= 1);
  const top = history[0];
  assert.ok(top.version >= 1);
  assert.equal(top.sessionId, 'sess-1');
  assert.ok(top.summary.includes('Use edit_file'), 'summary is the one-line learning');
  const sections = new Set(top.changes.map((c) => c.section));
  for (const s of ['worked', 'failed', 'preferences', 'recipes']) {
    assert.ok(sections.has(s), `diff records change in ${s}`);
  }
  assert.ok(top.changes.every((c) => c.action === 'added'), 'first revision adds all lessons');
  assert.ok(typeof top.snapshot === 'string' && top.snapshot.includes('# SADEEM Living Playbook'));
});

test('v11.12: repeated lesson is reinforced (count++) not duplicated', () => {
  const before = pb.loadPlaybook(WS);
  const prevCount = before.worked.find((i) => i.text.includes('npm test'))?.count ?? 0;
  const res = pb.applyPlaybookUpdate(WS, {
    worked: ['Run npm test before claiming done'],
    sessionId: 'sess-2',
    learned: 'Reinforced: verify with tests.',
  });
  assert.equal(res.changed, true);
  assert.ok(res.data.version >= 2, 'version bumped again');
  const after = pb.loadPlaybook(WS);
  const hit = after.worked.find((i) => i.text.includes('npm test'));
  assert.ok(hit, 'lesson still present');
  assert.equal(hit.count, prevCount + 1, 'reinforcement increments count');
  const top = pb.loadPlaybookHistory(WS)[0];
  assert.ok(top.changes.some((c) => c.action === 'reinforced' && c.text.includes('npm test')));
});

test('v11.12: no-op update does not bump version', () => {
  const before = pb.loadPlaybook(WS);
  const res = pb.applyPlaybookUpdate(WS, { learned: '', worked: [], failed: [] });
  assert.equal(res.changed, false);
  assert.equal(res.data.version, before.version);
});

test('v11.12: renderPlaybookPrompt is advisory and includes learned lessons', () => {
  const body = pb.renderPlaybookPrompt(pb.loadPlaybook(WS));
  assert.ok(body.length > 0);
  assert.ok(body.includes('ADVISORY DEFAULTS'), 'advisory contract present');
  assert.ok(body.includes('WHAT WORKED here') || body.includes('WHAT FAILED here'));
  assert.ok(body.includes('Run npm test before claiming done'));
  assert.ok(body.length <= 2000, 'prompt body capped');
  // empty model → omitted section
  assert.equal(pb.renderPlaybookPrompt(pb.loadPlaybook(join(tmp, 'never-created'))), '');
});

test('v11.12: buildSystemPrompt injects the playbook section when provided', () => {
  const body = pb.renderPlaybookPrompt(pb.loadPlaybook(WS));
  const withPb = prompts.buildSystemPrompt({
    workspace: WS,
    mode: 'default',
    platform: 'win32',
    playbook: body,
  });
  assert.ok(withPb.includes('# Living Playbook (learned from runs in this workspace)'), 'playbook section injected');
  assert.ok(withPb.includes('Run npm test before claiming done'), 'lesson reaches the system prompt');
  assert.ok(withPb.includes('PLAYBOOK RULES'), 'advisory rules included');

  const without = prompts.buildSystemPrompt({ workspace: WS, mode: 'default', platform: 'win32' });
  assert.ok(!without.includes('# Living Playbook'), 'section omitted when no playbook');
});

test('v11.12: clearPlaybook removes all playbook files', () => {
  const res = pb.clearPlaybook(WS);
  assert.equal(res.cleared, true);
  assert.ok(!existsSync(pb.playbookMdPath(WS)));
  assert.ok(!existsSync(pb.playbookHistoryPath(WS)));
  assert.equal(pb.loadPlaybook(WS).version, 0);
});

test.after(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});
