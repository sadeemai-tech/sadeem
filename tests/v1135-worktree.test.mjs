// ============================================================
// v11.35 — PROFESSIONAL WORKTREE FLOW (real temp git repos, no network).
//
// Bundles the REAL electron/services/gitService.ts and drives the actual git
// CLI. Proves the v11.35 hardening end to end:
//   • create on an isolated branch, list, resolve, path normalization;
//   • base ref is VERIFIED (empty repo / bogus ref / option injection);
//   • DETACHED HEAD is handled — branch is still created at that commit;
//   • path jail — name traversal + outside-workspace paths are refused;
//   • remove refuses DIRTY worktrees unless force=true; stale entries prune;
//   • .worktreeinclude copies safely (Windows separators, no ../ or absolute
//     escapes, never clobbers a file the worktree already has).
// ============================================================
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1135-worktree-'));

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
      '--external:@xterm/xterm',
      '--external:@xterm/addon-fit',
      '--external:monaco-editor',
      '--external:@monaco-editor/react',
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
  return out;
}

const gitSvc = require(bundle('electron/services/gitService.ts', join(tmp, 'git.cjs')));

const git = (root, ...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function newRepo(name) {
  const root = mkdtempSync(join(tmp, `${name}-`));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 'Tester');
  return root;
}
function seed(root) {
  writeFileSync(join(root, 'a.txt'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'base');
}

// ============================================================
// 1. create → list → resolve → remove, with a VERIFIED base ref
// ============================================================
test('worktree: create on new branch, list/resolve with normalized path, remove deletes branch', async () => {
  const main = newRepo('wt-flow');
  seed(main);

  const wt = await gitSvc.createWorktree(main, 'fix-api');
  assert.equal(wt.name, 'fix-api');
  assert.equal(wt.branch, 'sadeem/fix-api');
  assert.ok(existsSync(wt.path), 'worktree directory exists');
  assert.equal(wt.path, join(dirname(resolve(main)), 'sadeem-fix-api'), 'expected sibling path');
  assert.equal(git(wt.path, 'rev-parse', '--abbrev-ref', 'HEAD'), 'sadeem/fix-api', 'isolated branch checked out');
  assert.equal(git(wt.path, 'rev-parse', 'HEAD'), git(main, 'rev-parse', 'HEAD'), 'branched from verified HEAD');

  const list = await gitSvc.listWorktrees(main);
  const entry = list.find((w) => w.name === 'fix-api');
  assert.ok(entry, 'listed by short name');
  assert.equal(entry.branch, 'sadeem/fix-api');
  assert.equal(resolve(entry.path), resolve(wt.path), 'porcelain path normalized to native absolute path');
  assert.equal(entry.dirty, false, 'fresh worktree is clean');
  assert.equal(resolve((await gitSvc.resolveWorktree(main, 'fix-api')).path), resolve(wt.path));

  assert.equal(await gitSvc.removeWorktree(main, 'fix-api'), true);
  assert.ok(!existsSync(wt.path), 'worktree directory gone');
  assert.equal(git(main, 'branch', '--list', 'sadeem/fix-api'), '', 'branch deleted');
});

// ============================================================
// 2. base ref verification: empty repo / bogus ref / option injection
// ============================================================
test('worktree: base ref must exist; invalid bases give one actionable error', async () => {
  const empty = newRepo('wt-empty'); // no commits at all
  await assert.rejects(() => gitSvc.createWorktree(empty, 'x'), /WORKTREE_BASE_MISSING[\s\S]*Commit your changes first/);

  const main = newRepo('wt-base');
  seed(main);
  await assert.rejects(
    () => gitSvc.createWorktree(main, 'x', 'no-such-ref'),
    /WORKTREE_BASE_MISSING[\s\S]*does not exist/,
  );
  await assert.rejects(() => gitSvc.createWorktree(main, 'x', '--upload-pack=evil'), /INVALID_BASE/);
  // no worktree/branch leaked from the rejected attempts
  assert.equal(git(main, 'branch', '--list', 'sadeem/x'), '');
});

// ============================================================
// 3. detached HEAD is handled: branch created at the detached commit
// ============================================================
test('worktree: creating from a detached HEAD still produces a clean isolated branch', async () => {
  const main = newRepo('wt-detached');
  seed(main);
  const baseCommit = git(main, 'rev-parse', 'HEAD');
  git(main, 'checkout', '--detach', '-q');

  const wt = await gitSvc.createWorktree(main, 'detached-wt');
  assert.equal(git(wt.path, 'rev-parse', '--abbrev-ref', 'HEAD'), 'sadeem/detached-wt');
  assert.equal(git(wt.path, 'rev-parse', 'HEAD'), baseCommit, 'branch points at the detached commit');
  assert.equal(await gitSvc.removeWorktree(main, 'detached-wt'), true);
  assert.equal(git(main, 'branch', '--list', 'sadeem/detached-wt'), '');
});

// ============================================================
// 4. path jail: traversal names and outside-workspace paths are refused
// ============================================================
test('worktree: unsafe paths are refused before touching the filesystem', async () => {
  const main = newRepo('wt-jail');
  seed(main);

  await assert.rejects(() => gitSvc.createWorktree(main, '../../escape'), /INVALID_NAME/);
  await assert.rejects(() => gitSvc.createWorktree(main, 'Bad Name!'), /INVALID_NAME/);
  await assert.rejects(() => gitSvc.removeWorktree(main, '..\\escape'), /INVALID_NAME/);
  assert.throws(() => gitSvc.assertWorktreeTarget(main, '../evil'), /UNSAFE_PATH|INVALID_NAME/);

  const target = gitSvc.assertWorktreeTarget(main, 'good');
  assert.equal(dirname(target), dirname(resolve(main)), 'target is a sibling, never inside the workspace');
  assert.ok(!gitSvc.worktreePath(main, 'good').startsWith(resolve(main) + '\\'), 'worktreePath is not inside repo');
});

// ============================================================
// 5. dirty remove guard + stale registration pruning
// ============================================================
test('worktree: dirty remove needs force; a stale worktree prunes instead of hanging', async () => {
  const main = newRepo('wt-dirty');
  seed(main);

  const wt = await gitSvc.createWorktree(main, 'dirty-one');
  writeFileSync(join(wt.path, 'scratch.txt'), 'uncommitted\n');
  await assert.rejects(() => gitSvc.removeWorktree(main, 'dirty-one'), /WORKTREE_DIRTY[\s\S]*force=true/);
  assert.ok(existsSync(wt.path), 'dirty worktree survived the refused remove');
  await gitSvc.removeWorktree(main, 'dirty-one', true);
  assert.ok(!existsSync(wt.path), 'force removed it');

  // stale: directory deleted by hand, admin entry still registered
  const stale = await gitSvc.createWorktree(main, 'stale-one');
  rmSync(stale.path, { recursive: true, force: true });
  assert.equal(await gitSvc.removeWorktree(main, 'stale-one'), true, 'stale registration pruned, no throw');
  assert.equal(git(main, 'branch', '--list', 'sadeem/stale-one'), '');
});

// ============================================================
// 6. .worktreeinclude safe copy (Windows separators, no escape, no clobber)
// ============================================================
test('worktree: .worktreeinclude copies safe entries only and never clobbers', async () => {
  const main = newRepo('wt-include');
  writeFileSync(join(main, '.gitignore'), '.env\n');
  writeFileSync(join(main, 'a.txt'), 'base\n');
  git(main, 'add', '.');
  git(main, 'commit', '-qm', 'base');

  writeFileSync(join(main, '.env'), 'SECRET=1\n');
  mkdirSync(join(main, 'config'));
  writeFileSync(join(main, 'config', 'local.json'), '{"local":true}\n');
  writeFileSync(
    join(main, '.worktreeinclude'),
    ['# generated secrets', '.env', 'config\\local.json', '../outside-secret', 'C:/Windows/System32/x.ini', 'a.txt'].join('\n') + '\n',
  );
  const outside = join(dirname(main), 'outside-secret');
  writeFileSync(outside, 'DO-NOT-TOUCH\n');

  const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const wt = await gitSvc.createWorktree(main, 'inc');
  assert.equal(read(join(wt.path, '.env')), 'SECRET=1\n', 'gitignored .env copied');
  assert.equal(read(join(wt.path, 'config', 'local.json')), '{"local":true}\n', 'Windows backslash path normalized');
  assert.equal(read(join(wt.path, 'a.txt')), 'base\n', 'tracked file never clobbered by include');
  assert.equal(readFileSync(outside, 'utf8'), 'DO-NOT-TOUCH\n', '../ escape did not touch parent file');
  assert.ok(!existsSync(join(wt.path, 'outside-secret')), 'traversal entry not materialized');

  // include-created untracked files make the worktree dirty → force removal
  await gitSvc.removeWorktree(main, 'inc', true);
  assert.ok(!existsSync(wt.path));
});

after(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});
