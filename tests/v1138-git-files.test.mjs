// ============================================================
// v11.38 — SOURCE CONTROL + FILES: real git repos, real temp files.
// No mocks for git or the filesystem. The ACTUAL electron services
// are bundled with esbuild and driven through their public APIs.
//
// Proves:
//   • status → stage → commit (incl. Arabic/unicode filenames)
//   • branch create / list / switch via gitService + safety refusals
//   • file browse → read → edit → save → create → delete (unicode)
//   • path jail refuses traversal / outside / relative / unreadable paths
//   • merge conflicts are honest (U status, blocked commit + checkout)
//   • source guards: no dead controls, real bridge wiring, honest states
//
// Run: node --test --test-force-exit tests/v1138-git-files.test.mjs
// ============================================================
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1138-'));

function bundle(entry, out) {
  execFileSync(
    ESBUILD_NODE,
    [
      ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
      `--outfile=${out}`, '--external:electron',
      '--external:@xterm/xterm', '--external:@xterm/addon-fit',
      '--external:monaco-editor', '--external:@monaco-editor/react',
    ],
    { cwd: ROOT, stdio: 'pipe' },
  );
  return out;
}

// ---------- electron stub (fsService → terminalGuard → electron) ----------
const userDataDir = join(tmp, 'userdata');
mkdirSync(userDataDir, { recursive: true });
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `class WC { on() {} send() {} }
   class BW { constructor() { this.webContents = new WC(); } }
   BW.getAllWindows = () => [];
   module.exports = {
     app: { getPath: (k) => (k === 'userData' ? ${JSON.stringify(userDataDir)} : userDataDir),
            isReady: () => true, whenReady: async () => {}, on() {}, quit() {},
            getName: () => 'v1138', getVersion: () => '0.0.0' },
     ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
     safeStorage: { isEncryptionAvailable: () => false },
     BrowserWindow: BW, shell: { showItemInFolder() {}, openExternal: async () => {} },
     contextBridge: { exposeInMainWorld() {} },
   };`,
);

const absImport = (rel) => join(ROOT, rel).replace(/\\/g, '/');
const entry = join(tmp, 'v1138-entry.ts');
writeFileSync(
  entry,
  [
    `import * as gitSvc from '${absImport('electron/services/gitService')}';`,
    `import * as fsSvc from '${absImport('electron/services/fsService')}';`,
    `export { gitSvc, fsSvc };`,
  ].join('\n'),
);
const { gitSvc, fsSvc } = require(bundle(entry, join(tmp, 'services.cjs')));

// ---------- real-git helpers ----------
const git = (root, ...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function newRepo(name) {
  const root = mkdtempSync(join(tmp, `${name}-`));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'tester@v1138');
  git(root, 'config', 'user.name', 'V1138 Tester');
  return root;
}

// ============================================================
// 1. status → stage → commit (real git, unicode filename)
// ============================================================
test('v1138 · status → stage → commit works on a real repo (unicode path)', async () => {
  const repo = newRepo('flow');
  const file = 'ملف-تجربة.txt';
  writeFileSync(join(repo, file), 'one\n');

  let st = await gitSvc.status(repo);
  assert.equal(st.isRepo, true);
  assert.ok(st.changed.some((c) => c.path === file && c.status === '??'), 'untracked unicode path reported');

  await gitSvc.stage(repo, [file]);
  st = await gitSvc.status(repo);
  assert.ok(st.changed.some((c) => c.path === file && c.staged === true), 'stage really hit the index');

  const hash = await gitSvc.commit(repo, 'feat: add unicode file');
  assert.match(hash, /^[0-9a-f]{7,40}$/, 'authoritative short hash from rev-parse');
  assert.equal(git(repo, 'log', '-1', '--pretty=%s'), 'feat: add unicode file', 'commit is real');
  assert.equal((await gitSvc.status(repo)).changed.length, 0, 'tree clean after commit');
  assert.equal((await gitSvc.log(repo, 3))[0].message, 'feat: add unicode file', 'log reads the real commit');
});

// ============================================================
// 2. branch create / list / switch (real git)
// ============================================================
test('v1138 · branch create → list → switch is real git, injection refused', async () => {
  const repo = newRepo('branches');
  writeFileSync(join(repo, 'a.txt'), 'base\n');
  await gitSvc.stage(repo, ['a.txt']);
  await gitSvc.commit(repo, 'base');

  const initial = await gitSvc.listBranches(repo);
  assert.equal(initial.length, 1, 'one branch after first commit');
  assert.equal(initial[0].current, true, 'current flag is real');
  const defaultBranch = initial[0].name;

  const created = await gitSvc.createBranch(repo, 'feature/x');
  assert.equal(created.name, 'feature/x');
  assert.equal(created.current, false, 'plain create stays on the current branch');
  assert.equal((await gitSvc.listBranches(repo)).length, 2);
  assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), defaultBranch, 'no surprise switch');

  await gitSvc.checkout(repo, 'feature/x');
  assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature/x', 'checkout really switched');
  assert.ok((await gitSvc.listBranches(repo)).find((b) => b.name === 'feature/x' && b.current), 'current flag moved');

  const switched = await gitSvc.createBranch(repo, 'feature/y', { checkout: true });
  assert.equal(switched.current, true);
  assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feature/y', 'create-and-switch works');

  await assert.rejects(() => gitSvc.createBranch(repo, '--upload-pack=evil'), /INVALID_BRANCH/, 'option injection refused');
  await assert.rejects(() => gitSvc.createBranch(repo, 'ok', { startPoint: 'no-such-ref' }), /BRANCH_START_MISSING/);
});

// ============================================================
// 3. file browse → read → edit → save → create → delete (unicode)
// ============================================================
test('v1138 · file browse → read → edit → save → create → delete (unicode)', async () => {
  const ws = mkdtempSync(join(tmp, 'files-'));
  mkdirSync(join(ws, 'مجلس'));
  writeFileSync(join(ws, 'مجلس', 'ملف.txt'), 'مرحبا\n');
  writeFileSync(join(ws, 'root.txt'), 'root\n');
  fsSvc.setConfineRoot(ws);

  const tree = await fsSvc.readDirTree(ws);
  assert.ok(tree && tree.type === 'dir', 'real tree from disk');
  const dir = tree.children.find((c) => c.name === 'مجلس' && c.type === 'dir');
  assert.ok(dir, 'unicode directory is browsable — no phantom rows');
  assert.ok(dir.children.some((c) => c.name === 'ملف.txt'), 'unicode file is in the tree');

  const file = join(ws, 'مجلس', 'ملف.txt');
  assert.equal(await fsSvc.readFile(file), 'مرحبا\n', 'read real bytes');
  await fsSvc.writeFile(file, 'مرحبا بالعالم\n');
  assert.equal(await fsSvc.readFile(file), 'مرحبا بالعالم\n', 'edit + save round-trip');

  await fsSvc.createFile(join(ws, 'جديد.txt'), 'جديد\n');
  assert.equal(await fsSvc.readFile(join(ws, 'جديد.txt')), 'جديد\n', 'create works');
  await fsSvc.deletePath(join(ws, 'جديد.txt'));
  assert.equal(existsSync(join(ws, 'جديد.txt')), false, 'delete really removed the file');
});

// ============================================================
// 4. unsafe paths refused
// ============================================================
test('v1138 · unsafe paths are refused by the jail', async () => {
  const ws = mkdtempSync(join(tmp, 'jail-'));
  writeFileSync(join(ws, 'ok.txt'), 'ok\n');
  const outside = join(tmp, 'outside-v1138.txt');
  writeFileSync(outside, 'secret\n');
  fsSvc.setConfineRoot(ws);

  assert.throws(() => fsSvc.assertSafePath(outside), /OUTSIDE_WORKSPACE/, 'outside read path refused');
  assert.throws(() => fsSvc.assertSafePath(`${ws}/../escape.txt`), /TRAVERSAL/, 'raw traversal refused');
  assert.throws(() => fsSvc.assertSafePath('relative/x.txt'), /MUST_BE_ABSOLUTE/, 'relative path refused');
  assert.throws(() => fsSvc.assertSafePath('//server/share/x'), /UNC_NOT_ALLOWED/, 'UNC refused');
  await assert.rejects(() => fsSvc.writeFile(outside, 'hacked'), /OUTSIDE_WORKSPACE/, 'outside write refused');
  await assert.rejects(() => fsSvc.readFile(outside), /OUTSIDE_WORKSPACE/, 'outside read refused');
  await assert.rejects(() => fsSvc.deletePath(outside), /OUTSIDE_WORKSPACE/, 'outside delete refused');
  await assert.rejects(() => fsSvc.readDirTree(outside), /OUTSIDE_WORKSPACE/, 'outside listing refused');
});

// ============================================================
// 5. conflicts are honest
// ============================================================
test('v1138 · merge conflict is honest (U status, blocked commit + checkout)', async () => {
  const repo = newRepo('conflict');
  writeFileSync(join(repo, 'c.txt'), 'base\n');
  await gitSvc.stage(repo, ['c.txt']);
  await gitSvc.commit(repo, 'base');
  const main = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');

  await gitSvc.createBranch(repo, 'other');
  writeFileSync(join(repo, 'c.txt'), 'main\n');
  await gitSvc.stage(repo, ['c.txt']);
  await gitSvc.commit(repo, 'main change');

  await gitSvc.checkout(repo, 'other');
  writeFileSync(join(repo, 'c.txt'), 'other\n');
  await gitSvc.stage(repo, ['c.txt']);
  await gitSvc.commit(repo, 'other change');

  try {
    git(repo, 'merge', main); // expected non-zero: conflict
  } catch {
    /* conflict is the fixture */
  }

  const st = await gitSvc.status(repo);
  const conflicted = st.changed.find((c) => c.path === 'c.txt');
  assert.ok(conflicted, 'conflicted path is reported, not hidden');
  assert.equal(conflicted.status, 'U', 'honest U code');
  assert.equal(conflicted.staged, false, 'not mislabelled as a clean staged edit');
  assert.equal(gitSvc.isConflictStatus('UU'), true);
  assert.equal(gitSvc.isConflictStatus('AA'), true);
  assert.equal(gitSvc.isConflictStatus('M'), false);

  await assert.rejects(() => gitSvc.commit(repo, 'during conflict'), /conflict|unmerged|merge/i, 'commit refuses with an honest reason');
  await assert.rejects(() => gitSvc.checkout(repo, main), /conflict|unmerged|resolve|index/i, 'switch refuses with an honest reason');
  git(repo, 'merge', '--abort');
});

// ============================================================
// 6. source-level guards (no dead buttons, real wiring)
// ============================================================
test('v1138 · source guards: no dead controls, real bridge wiring, honest states', () => {
  const src = readFileSync(join(ROOT, 'src/components/panels/GitPanel.tsx'), 'utf8');
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const re = /<(button|Btn|IconBtn|TextInput)\b/gi;
  const dead = [];
  let m;
  while ((m = re.exec(stripped))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let quote = null;
    for (; i < stripped.length; i++) {
      const ch = stripped[i];
      if (quote) {
        if (ch === '\\') { i++; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') depth = Math.max(0, depth - 1);
      else if (ch === '>' && depth === 0) break;
    }
    const tag = stripped.slice(m.index, i + 1);
    if (!/\bon(?:Click|Change|KeyDown)\s*=/.test(tag)) dead.push(tag.slice(0, 120).replace(/\s+/g, ' '));
  }
  assert.deepEqual(dead, [], `dead controls: ${dead.join(' | ')}`);

  assert.match(src, /isConflictStatus/, 'conflict detection present');
  assert.match(src, /git\.branch === '\(detached\)'/, 'detached HEAD surfaced');
  assert.match(src, /api\.gitBranchCreate/, 'branch create uses the real bridge');
  assert.match(src, /api\.gitCheckout/, 'branch switch uses the real bridge');
  assert.match(src, /window\.confirm/, 'destructive switch is confirmed');

  const apiSrc = readFileSync(join(ROOT, 'src/lib/api.ts'), 'utf8');
  assert.match(apiSrc, /gitBranchCreate/, 'renderer API exposes branch create');
  const preloadSrc = readFileSync(join(ROOT, 'electron/preload.ts'), 'utf8');
  assert.match(preloadSrc, /kdx:git:branch:create/, 'preload exposes the channel');
  const ipcSrc = readFileSync(join(ROOT, 'electron/ipc.ts'), 'utf8');
  assert.match(ipcSrc, /kdx:git:branch:create/, 'main process handles the channel');
});

after(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
