import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// v11.31 — GIT / CLONE / ISOLATION CAPABILITY AUDIT (real temp git repos).
//
// Proves the audit fixes in electron/services/{gitService,cloneService,
// isolationService}.ts against the ACTUAL git CLI (no mocks for git):
//   • status / diff / stage / commit / init / log / checkout / numstat
//   • no silent failure (stage/commit/log/checkout errors surface)
//   • credential redaction + option-injection / path-jail refusals
//   • worktree create/list/resolve/merge/remove (dirty + force)
//   • clone URL/branch/name validation, error TOKENS + actionable detail,
//     error progress, AbortSignal cancel, no credential echo
//   • isolation: config resolution, XML escaping, fail-closed posture
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1131-git-'));

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

// electron stub (isolationService → terminalService → fsService → electron)
const userDataDir = join(tmp, 'userdata');
mkdirSync(userDataDir, { recursive: true });
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `module.exports = {
    app: { getPath: () => ${JSON.stringify(userDataDir)}, whenReady: async () => true, on() {}, quit() {}, isReady: () => true, getName: () => 'sadeem-v1131', getVersion: () => '0.0.0' },
    ipcMain: { handle() {}, on() {} },
    ipcRenderer: { invoke: async () => ({}), on() {}, send() {} },
    BrowserWindow: { getAllWindows: () => [] },
    Notification: { isSupported: () => false },
    shell: {}, dialog: {}, screen: {}, tray: {},
    contextBridge: { exposeInMainWorld: () => {} },
    nativeTheme: { shouldUseDarkColors: true },
    powerMonitor: { on() {} },
  };
  module.exports.default = module.exports;`,
);

const gitSvc = require(bundle('electron/services/gitService.ts', join(tmp, 'git.cjs')));
const cloneSvc = require(bundle('electron/services/cloneService.ts', join(tmp, 'clone.cjs')));
const isolation = require(bundle('electron/services/isolationService.ts', join(tmp, 'isolation.cjs')));

// ---------- real-git helpers ----------
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
  writeFileSync(join(root, 'a.txt'), 'one\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'base');
}

// ============================================================
// 1. status
// ============================================================
test('git status: clean repo, untracked + staged + modified, branch; null for non-repo', async () => {
  const repo = newRepo('status');
  seed(repo);
  let st = await gitSvc.status(repo);
  assert.equal(st.isRepo, true);
  assert.equal(st.changed.length, 0, 'clean tree');
  assert.match(st.branch, /^(main|master)$/);

  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');
  writeFileSync(join(repo, 'b.txt'), 'new\n');
  st = await gitSvc.status(repo);
  assert.ok(st.changed.some((c) => c.path === 'a.txt' && c.status === 'M' && c.staged === false), 'unstaged M');
  assert.ok(st.changed.some((c) => c.path === 'b.txt' && c.status === '??'), 'untracked ??');

  await gitSvc.stage(repo, ['a.txt']);
  st = await gitSvc.status(repo);
  assert.ok(st.changed.some((c) => c.path === 'a.txt' && c.staged === true), 'staged flag');

  const notRepo = mkdtempSync(join(tmp, 'notrepo-'));
  assert.equal(await gitSvc.status(notRepo), null, 'non-repo keeps the documented null signal');
});

// ============================================================
// 2. diff / numstat / stage (no silent failure)
// ============================================================
test('git diff + diffNumstat report real patches/stats; stage surfaces failures', async () => {
  const repo = newRepo('diff');
  seed(repo);
  writeFileSync(join(repo, 'a.txt'), 'one\nstaged-line\n');
  await gitSvc.stage(repo, ['a.txt']);
  writeFileSync(join(repo, 'a.txt'), 'one\nstaged-line\nunstaged-line\n');

  const patches = await gitSvc.diff(repo, 'a.txt');
  assert.ok(patches.length >= 2, 'both staged and unstaged patches returned');
  assert.ok(patches.some((p) => p.path === 'a.txt (staged)' && p.patch.includes('+staged-line')));
  assert.ok(patches.some((p) => p.path === 'a.txt' && p.patch.includes('+unstaged-line')));

  const stats = await gitSvc.diffNumstat(repo);
  assert.equal(stats.files, 1, `one changed file, got ${stats.files}`);
  assert.ok(stats.insertions >= 2 && stats.deletions >= 0, 'real insertion counts');

  await assert.rejects(() => gitSvc.stage(repo, ['does-not-exist.txt']), /git stage failed/, 'stage failure is not silent');
  await assert.rejects(() => gitSvc.diffNumstat(repo, 1), /timed out|timeout/i, 'timeout is surfaced, not returned as zeros');
});

// ============================================================
// 3. commit / init / log / checkout
// ============================================================
test('git commit returns a real hash, empty message and no-op are honest, identity auto-fix works', async () => {
  const repo = newRepo('commit');
  seed(repo);
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');
  await gitSvc.stage(repo, ['a.txt']);
  const hash = await gitSvc.commit(repo, 'feat: add two');
  assert.match(hash, /^[0-9a-f]{7,40}$/, 'short commit hash from rev-parse');
  assert.equal(git(repo, 'log', '-1', '--pretty=%s'), 'feat: add two');

  assert.equal(await gitSvc.commit(repo, 'nothing staged'), '', 'no-op returns empty string');
  await assert.rejects(() => gitSvc.commit(repo, '   '), /message is empty/, 'empty message is rejected');

  // fresh repo with NO configured identity → service sets a local one + retries
  const bare = newRepo('identity');
  git(bare, 'config', '--unset', 'user.name');
  git(bare, 'config', '--unset', 'user.email');
  writeFileSync(join(bare, 'x.txt'), 'x\n');
  await gitSvc.stage(bare, ['x.txt']);
  assert.match(await gitSvc.commit(bare, 'first'), /^[0-9a-f]{7,40}$/);
});

test('git init / log / checkout work and refuse option injection', async () => {
  const fresh = mkdtempSync(join(tmp, 'init-'));
  await gitSvc.init(fresh);
  assert.ok(existsSync(join(fresh, '.git')), 'git init created a repository');
  assert.deepEqual(await gitSvc.log(fresh), [], 'empty repo → honest empty log');

  writeFileSync(join(fresh, 'f.txt'), 'first\n');
  git(fresh, 'add', '.');
  git(fresh, 'commit', '-qm', 'first');
  const entries = await gitSvc.log(fresh, 5);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].message, 'first');
  assert.match(entries[0].hash, /^[0-9a-f]{7,40}$/);
  assert.ok(entries[0].date && entries[0].author, 'log carries date + author');

  const defaultBranch = git(fresh, 'rev-parse', '--abbrev-ref', 'HEAD');
  git(fresh, 'checkout', '-q', '-b', 'feature-x');
  await gitSvc.checkout(fresh, defaultBranch);
  assert.equal(git(fresh, 'rev-parse', '--abbrev-ref', 'HEAD'), defaultBranch, 'checkout switched branch');
  await assert.rejects(() => gitSvc.checkout(fresh, '--orphan'), /INVALID_REF/, 'option injection refused');
  await assert.rejects(() => gitSvc.checkout(fresh, 'no-such-branch'), /git checkout failed/, 'checkout failure is not silent');
});

// ============================================================
// 4. credential redaction
// ============================================================
test('credential redaction strips URL users/passwords and secret key=value pairs', () => {
  assert.equal(
    gitSvc.redactSecrets('fatal: could not read https://alice:hunter2@host/x.git'),
    'fatal: could not read https://***@host/x.git',
  );
  assert.equal(cloneSvc.redactCloneSecrets('git@github.com:org/repo.git'), 'git@github.com:org/repo.git', 'scp URLs left intact');
  assert.equal(cloneSvc.redactCloneSecrets('Cloning https://u:supersecret@host/x.git'), 'Cloning https://***@host/x.git');
  assert.equal(cloneSvc.redactCloneSecrets('token=abc123XYZ'), 'token=***');
});

// ============================================================
// 5. worktrees (real git) + path jail
// ============================================================
test('worktree lifecycle: create → list → resolve → commit → merge → cleanup', async () => {
  const main = newRepo('wt-main');
  writeFileSync(join(main, 'app.txt'), 'base\n');
  seed(main);

  const wt = await gitSvc.createWorktree(main, 'fix-api');
  assert.equal(wt.branch, 'sadeem/fix-api');
  assert.ok(existsSync(wt.path));
  assert.equal(git(wt.path, 'rev-parse', '--abbrev-ref', 'HEAD'), 'sadeem/fix-api');

  const list = await gitSvc.listWorktrees(main);
  assert.ok(list.some((w) => w.name === 'fix-api' && w.branch === 'sadeem/fix-api' && w.dirty === false));
  assert.ok((await gitSvc.resolveWorktree(main, 'fix-api'))?.path === wt.path);

  writeFileSync(join(wt.path, 'app.txt'), 'base\nfixed\n');
  writeFileSync(join(wt.path, 'new.ts'), 'export const ok = true;\n');
  git(wt.path, 'add', '.');
  git(wt.path, 'commit', '-qm', 'fix');
  const merged = await gitSvc.mergeWorktree(main, 'fix-api');
  assert.equal(merged.ok, true, merged.error ?? '');
  assert.ok(merged.merged?.includes('app.txt') && merged.merged?.includes('new.ts'));
  assert.match(readFileSync(join(main, 'app.txt'), 'utf8'), /fixed/);
  assert.ok(!existsSync(wt.path), 'worktree removed after merge');
  assert.equal(git(main, 'branch', '--list', 'sadeem/fix-api'), '', 'branch deleted after merge');
});

test('worktree: dirty refuses without force, force removes, invalid names cannot escape the jail', async () => {
  const main = newRepo('wt-dirty');
  seed(main);
  const wt = await gitSvc.createWorktree(main, 'dirty-one');
  writeFileSync(join(wt.path, 'scratch.txt'), 'uncommitted\n');

  await assert.rejects(() => gitSvc.removeWorktree(main, 'dirty-one'), /WORKTREE_DIRTY/);
  assert.ok(existsSync(wt.path));
  await gitSvc.removeWorktree(main, 'dirty-one', true);
  assert.ok(!existsSync(wt.path));

  // A traversal-style name must be refused BEFORE it becomes a path.
  await assert.rejects(() => gitSvc.removeWorktree(main, '../../escape'), /INVALID_NAME/);
  await assert.rejects(() => gitSvc.createWorktree(main, 'Bad Name!'), /INVALID_NAME/);
});

// ============================================================
// 6. AI helpers (injected completer, fences stripped, actionable errors)
// ============================================================
test('AI helpers: commit message + review with injected completer; errors are actionable', async () => {
  const repo = newRepo('ai');
  seed(repo);
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');
  await gitSvc.stage(repo, ['a.txt']);

  const cm = await gitSvc.generateCommitMessage(repo, async () => ({
    ok: true,
    text: '```\nfeat: add line\n\nExplain why.\n```',
  }));
  assert.equal(cm.ok, true);
  assert.equal(cm.message, 'feat: add line\nExplain why.', 'fences stripped');

  const rv = await gitSvc.reviewWorkingTree(repo, 'HEAD', async () => ({ ok: true, text: '**[major]** issue\nVerdict: fix it.' }));
  assert.equal(rv.ok, true);
  assert.match(rv.review, /\[major\]/);

  const badRef = await gitSvc.reviewWorkingTree(repo, '--upload-pack=evil', async () => ({ ok: true, text: 'x' }));
  assert.equal(badRef.ok, false);
  assert.match(badRef.error, /INVALID_REF/);
  const noAi = await gitSvc.generateCommitMessage(repo, undefined);
  assert.equal(noAi.ok, false);
  assert.match(noAi.error, /Settings/, 'actionable next step in error');
});

// ============================================================
// 7. clone: validation tokens, progress, cancel, path jail, no leaks
// ============================================================
test('clone validation: stable i18n tokens + actionable English detail + error progress', async () => {
  const dest = mkdtempSync(join(tmp, 'clone-dest-'));
  const events = [];
  const onProgress = (p) => events.push(p);

  const bad = await cloneSvc.cloneRepo({ url: 'ftp://example.com/x.git', destDir: dest }, onProgress);
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'bad_url', 'stable renderer i18n token');
  assert.match(bad.detail, /https:\/\//, 'English detail explains the allowed schemes');
  assert.ok(events.some((p) => p.step === 'error' && p.error === 'bad_url'), 'error progress emitted (no silent spinner)');

  assert.equal((await cloneSvc.cloneRepo({ url: 'https://example.com/x.git', destDir: dest, branch: '-oops' })).error, 'bad_branch');
  assert.equal((await cloneSvc.cloneRepo({ url: 'https://example.com/x.git', destDir: dest, name: '../escape' })).error, 'bad_name');
  assert.equal((await cloneSvc.cloneRepo({ url: 'https://example.com/x.git', destDir: 'relative/path' })).error, 'dest_not_absolute');

  mkdirSync(join(dest, 'taken'));
  const exists = await cloneSvc.cloneRepo({ url: 'https://example.com/taken.git', destDir: dest }, onProgress);
  assert.equal(exists.error, 'exists');
  assert.equal(exists.projectPath, join(dest, 'taken'), 'existing path reported for the UI');

  // Credential-bearing URLs that fail validation never echo the secret.
  const leaked = await cloneSvc.cloneRepo({ url: 'https://user:supersecret@example.com/bad path.git', destDir: dest }, onProgress);
  assert.equal(leaked.error, 'bad_url');
  assert.ok(!JSON.stringify(leaked).includes('supersecret'), 'credentials never leak into the result');
  assert.ok(!events.some((p) => JSON.stringify(p).includes('supersecret')), 'credentials never leak into progress');
});

test('clone cancel: AbortSignal stops the clone and removes any partial checkout', async () => {
  const dest = mkdtempSync(join(tmp, 'clone-cancel-'));
  const controller = new AbortController();
  const result = await cloneSvc.cloneRepo(
    { url: 'https://example.com/repo.git', destDir: dest },
    (p) => {
      if (p.step === 'git') controller.abort();
    },
    controller.signal,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'cancelled');
  assert.match(result.detail, /[Cc]ancelled/);
  assert.equal(existsSync(join(dest, 'repo')), false, 'no partial directory left behind');

  const pre = new AbortController();
  pre.abort();
  assert.equal((await cloneSvc.cloneRepo({ url: 'https://example.com/repo.git', destDir: dest }, undefined, pre.signal)).error, 'cancelled');
});

test('clone success path: streamed + redacted progress and a real done event', async () => {
  // Deterministic stand-in for `git clone`: a renamed Node binary plus a
  // script named `clone` in the cwd (argv: node, script, --progress, --, URL,
  // name). This exercises the REAL spawn/progress/cleanup code with no network.
  const { copyFileSync } = await import('node:fs');
  const { delimiter } = await import('node:path');
  const fakeBin = join(tmp, 'fakebin');
  mkdirSync(fakeBin, { recursive: true });
  copyFileSync(process.execPath, join(fakeBin, 'git.exe'));
  const dest = mkdtempSync(join(tmp, 'clone-progress-'));
  writeFileSync(
    join(dest, 'clone'),
    `const fs = require('fs'); const path = require('path');
const url = process.argv[4]; const name = process.argv[5];
process.stderr.write('Cloning ' + url + '\\r\\n');
process.stderr.write('Receiving objects: 100% (1/1), done.\\r\\n');
fs.mkdirSync(name, { recursive: true });
fs.writeFileSync(path.join(name, 'f.txt'), 'ok\\n');
`,
  );
  const oldPath = process.env.PATH;
  process.env.PATH = `${fakeBin}${delimiter}${oldPath ?? ''}`;
  try {
    const events = [];
    const res = await cloneSvc.cloneRepo(
      { url: 'https://user:supersecret@host/repo.git', destDir: dest },
      (p) => events.push(p),
    );
    assert.equal(res.ok, true, `clone succeeded: ${res.detail ?? ''}`);
    assert.equal(res.projectPath, join(dest, 'repo'));
    assert.equal(readFileSync(join(res.projectPath, 'f.txt'), 'utf8'), 'ok\n');
    assert.ok(events.some((p) => p.step === 'git' && /Cloning|Receiving objects/.test(p.message)), 'real git progress forwarded');
    assert.ok(events.some((p) => p.step === 'git' && p.message.includes('***@')), 'credential-bearing URL redacted in progress');
    assert.ok(events.some((p) => p.step === 'done' && p.projectPath === res.projectPath), 'done event carries projectPath');
    assert.ok(!events.some((p) => JSON.stringify(p).includes('supersecret')), 'secret never reaches the renderer');
  } finally {
    process.env.PATH = oldPath;
  }
});

// ============================================================
// 8. isolation: config, XML jail, fail-closed posture
// ============================================================
test('isolation: config resolution, sandbox XML escaping, and fail-closed execution', async () => {
  const cfg = isolation.resolveIsolationConfig({ profile: 'docker', networkMode: 'bridge' });
  assert.equal(cfg.profile, 'docker');
  assert.equal(cfg.networkMode, 'bridge');
  assert.equal(isolation.resolveIsolationConfig({ profile: 'nonsense' }).profile, 'none', 'unknown profile → safe default');

  const wsb = await isolation.generateSandboxConfig('C:\\work\\a&b<c>.txt', userDataDir, 'none');
  assert.match(wsb.content, /a&amp;b&lt;c&gt;\.txt/, 'HostFolder is fully XML-escaped');
  assert.match(wsb.content, /<Networking>Disable<\/Networking>/);

  const none = await isolation.health({ ...isolation.DEFAULT_ISOLATION, profile: 'none' });
  assert.equal(none.available, true);
  const ran = await isolation.execInIsolation({
    command: '',
    workspace: tmp,
    timeoutMs: 5000,
    cfg: { ...isolation.DEFAULT_ISOLATION, profile: 'winsandbox' },
    userDataDir,
  });
  assert.equal(ran.ran, false, 'visual profile never claims to have run a command');
  assert.equal(ran.isolated, false);
});

after(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});
