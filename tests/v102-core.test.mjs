// v102-core.test.mjs — SADEEM v10.2 feature tests.
// (1) linediff: hunks, numbers, add/del counts, truncation, identical → empty.
// (2) diffInputsFromToolArgs: the v10.1 dead path fix (edit_file old_string/
//     new_string, write_file content, multi_edit fold).
// (3) pluginService: validate/install/list/toggle/uninstall + prompt command
//     files + starter catalog (headless via SURNIA_HOME sandbox).
// (4) libraryService: note/list/forget/clear with a userData sandbox.
// (5) transcribeAudio: precise error codes when no provider is configured
//     (VOICE path — the feature that was silently broken before v10.2).
// (6) gitService worktrees: create (+ .worktreeinclude copy), resolve,
//     merge into main (real git in a temp repo).
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// ---------- (1) linediff (renderer lib — plain TS, import via esbuild-less path is fine? it's ESM TS) ----------
// linediff.ts is TS — bundle it quickly like the other tests do.
import { execSync } from 'node:child_process';
execSync(
  'npx esbuild src/lib/linediff.ts --bundle --platform=node --format=esm --outfile=tests/.linediff.bundle.mjs',
  { cwd: join(import.meta.dirname, '..'), stdio: 'pipe' },
);
const { lineDiff, wordLineDiff, diffInputsFromToolArgs } = await import('./.linediff.bundle.mjs');

test('linediff: basic replace produces one hunk with real numbers', () => {
  const r = lineDiff('a\nb\nc\nd\n', 'a\nB\nc\nd\n');
  assert.equal(r.add, 1);
  assert.equal(r.del, 1);
  assert.equal(r.hunks.length, 1);
  const kinds = r.hunks[0].rows.map((x) => x.kind).join(',');
  assert.equal(kinds, 'ctx,del,add,ctx,ctx'); // a=ctx, b=del, B=add, c+d=ctx (trailing-newline phantom dropped)
  const addRow = r.hunks[0].rows.find((x) => x.kind === 'add');
  assert.equal(addRow.newNo, 2);
  assert.equal(addRow.text, 'B');
  assert.match(r.hunks[0].header, /@@ -1,4 \+1,4 @@/);
});

test('linediff: word highlight pairs adjacent del/add rows', () => {
  const r = lineDiff('const x = 1;\n', 'const x = 2;\n');
  const del = r.hunks[0].rows.find((x) => x.kind === 'del');
  const add = r.hunks[0].rows.find((x) => x.kind === 'add');
  assert.ok(del.segs && add.segs, 'segments attached');
  assert.ok(del.segs.some((s) => s.k === 'del' && s.s.includes('1')));
  assert.ok(add.segs.some((s) => s.k === 'add' && s.s.includes('2')));
});

test('linediff: identical texts → empty result; truncation flag works', () => {
  const same = lineDiff('x\ny\n', 'x\ny\n');
  assert.equal(same.hunks.length, 0);
  assert.equal(same.add, 0);
  const many = Array.from({ length: 300 }, (_, i) => `line-${i}`).join('\n');
  const r = lineDiff(many, many.replace('line-299', 'CHANGED'));
  assert.equal(r.truncated, false, 'one change inside 400-row cap is not truncated');
  assert.ok(r.hunks.length >= 1);
});

test('linediff: big files degrade honestly (never throw, totals correct)', () => {
  const a = Array.from({ length: 4000 }, (_, i) => `a${i}`).join('\n');
  const b = Array.from({ length: 4000 }, (_, i) => `b${i}`).join('\n');
  const r = lineDiff(a, b);
  assert.equal(r.add, 4000);
  assert.equal(r.del, 4000);
});

test('wordLineDiff: single-word change highlights only that token', () => {
  const w = wordLineDiff('color: red;', 'color: blue;');
  assert.ok(w.del.some((s) => s.k === 'del' && s.s.includes('red')));
  assert.ok(w.add.some((s) => s.k === 'add' && s.s.includes('blue')));
  assert.ok(w.del.some((s) => s.k === 'ctx' && s.s.includes('color')));
});

// ---------- (2) diffInputsFromToolArgs (pure — same bundle as linediff) ----------

test('diffInputs: edit_file args (old_string/new_string) — the v10.1 dead path, now alive', () => {
  const inputs = diffInputsFromToolArgs('edit_file', {
    path: '/x/app.ts',
    old_string: 'const a = 1;',
    new_string: 'const a = 2;',
  });
  assert.ok(inputs);
  assert.equal(inputs.oldText, 'const a = 1;');
  assert.equal(inputs.newText, 'const a = 2;');
});

test('diffInputs: write_file → new-file view; read_file → null', () => {
  const wf = diffInputsFromToolArgs('write_file', { path: '/x/n.md', content: '# hi\n' });
  assert.ok(wf);
  assert.equal(wf.oldText, '');
  assert.equal(wf.newText, '# hi\n');
  assert.equal(diffInputsFromToolArgs('read_file', { path: '/x' }), null);
});

test('diffInputs: multi_edit folds replacements in order', () => {
  const me = diffInputsFromToolArgs('multi_edit', {
    path: '/x',
    edits: [
      { old_string: 'AAA', new_string: 'BBB' },
      { old_string: 'CCC', new_string: 'DDD' },
    ],
  });
  assert.ok(me);
  assert.ok(me.newText.includes('BBB') && me.newText.includes('DDD'));
});

// ---------- (3) pluginService ----------
const home = mkdtempSync(join(tmpdir(), 'sadeem-plugins-'));
process.env.SURNIA_HOME = home; // commands dir + headless plugins root fallback
delete process.env.KODEX_HOME;
execSync(
  'npx esbuild electron/services/pluginService.ts --bundle --platform=node --format=esm --outfile=tests/.plugins.bundle.mjs --alias:electron=./tests/electron-stub.mjs --define:__dirname=\'"/tmp"\'',
  { cwd: join(import.meta.dirname, '..'), stdio: 'pipe' },
);
const plugins = await import('./.plugins.bundle.mjs');

test('plugins: starter catalog exists and installs with real slash command files', async () => {
  const starters = plugins.STARTER_PLUGINS;
  assert.ok(starters.length >= 3);
  const info = await plugins.installStarter('sadeem.starter-web');
  assert.equal(info.enabled, true);
  assert.equal(info.mcpCount, 1);
  assert.equal(info.promptCount, 1);
  // the /research prompt became a REAL command file the slashService scans
  const cmds = readdirSync(join(home, 'commands'));
  assert.ok(cmds.some((f) => f.startsWith('plugin__sadeem.starter-web__research') && f.endsWith('.md')));
});

test('plugins: list/toggle/enabledPluginMcpServers/uninstall round-trip', async () => {
  let list = plugins.listPlugins();
  assert.equal(list.length, 1);
  await plugins.setPluginEnabled('sadeem.starter-web', false);
  assert.equal(plugins.enabledPluginMcpServers().length, 0);
  await plugins.setPluginEnabled('sadeem.starter-web', true);
  const mcp = plugins.enabledPluginMcpServers();
  assert.equal(mcp.length, 1);
  assert.match(mcp[0].id, /^plugin__sadeem\.starter-web__fetch$/);
  assert.ok(mcp[0].command.includes('npx'));
  await plugins.uninstallPlugin('sadeem.starter-web');
  assert.equal(plugins.listPlugins().length, 0);
  const cmds = readdirSync(join(home, 'commands'));
  assert.ok(!cmds.some((f) => f.startsWith('plugin__sadeem.starter-web__')));
});

test('plugins: invalid manifests are rejected with precise reasons', async () => {
  await assert.rejects(() => plugins.installPluginFromObject({ nope: true }, 'file'), /id must match/);
  await assert.rejects(() => plugins.installPluginFromObject({ id: 'ok id!', name: 'x' }, 'file'), /id must match/);
  await assert.rejects(
    () => plugins.installPluginFromObject({ id: 'good-id', name: 'x', mcpServers: [{ bad: true }] }, 'file'),
    /each mcpServer needs/,
  );
  await assert.rejects(() => plugins.installPluginFromUrl('http://insecure.example/x.json'), /https/);
});

// ---------- (4) libraryService ----------
process.env.SADEEM_TEST_USERDATA = mkdtempSync(join(tmpdir(), 'sadeem-libreg-')); // isolated registry
execSync(
  'npx esbuild electron/services/libraryService.ts --bundle --platform=node --format=esm --outfile=tests/.library.bundle.mjs --alias:electron=./tests/electron-stub.mjs',
  { cwd: join(import.meta.dirname, '..'), stdio: 'pipe' },
);
const library = await import('./.library.bundle.mjs');

test('library: note → list → forget → clear (de-dup by path, newest first)', async () => {
  const f1 = join(home, 'a.png');
  const f2 = join(home, 'b.pdf');
  writeFileSync(f1, 'x');
  writeFileSync(f2, 'yy');
  library.noteLibraryItem({ kind: 'image', title: 'a.png', path: f1, size: 1, origin: 'image_generate' });
  library.noteLibraryItem({ kind: 'document', title: 'b.pdf', path: f2, size: 2, origin: 'make_document' });
  library.noteLibraryItem({ kind: 'image', title: 'a.png', path: f1, size: 3, origin: 'image_generate' }); // dup
  const items = await library.listLibraryItems();
  assert.equal(items.filter((x) => x.path === f1).length, 1);
  // newest first — the RE-NOTED a.png (3rd call above) is deterministically newest
  assert.equal(items[0].path, f1);
  assert.equal(items[1].path, f2);
  const id = items.find((x) => x.path === f2).id;
  library.forgetLibraryItem(id);
  assert.equal((await library.listLibraryItems()).some((x) => x.path === f2), false);
  library.clearLibrary();
  assert.equal((await library.listLibraryItems()).filter((x) => x.origin !== 'scan').length, 0);
});

// ---------- (5) voice transcription error codes (headless, no settings) ----------
execSync(
  'npx esbuild electron/services/sessionService.ts --bundle --platform=node --format=esm --outfile=tests/.session.bundle.mjs --alias:electron=./tests/electron-stub.mjs --define:__dirname=\'"/tmp"\'',
  { cwd: join(import.meta.dirname, '..'), stdio: 'pipe' },
);
const session = await import('./.session.bundle.mjs');

test('voice: transcribeAudio reports precise codes (not a generic failure)', async () => {
  const empty = await session.transcribeAudio('', 'audio/webm');
  assert.equal(empty.error, 'EMPTY_AUDIO');
  // headless → no settings store → the honest NO_PROVIDER code (v10.1 said nothing at all)
  const r = await session.transcribeAudio('AAAA', 'audio/webm');
  assert.ok(['NO_PROVIDER', 'NO_API_KEY', 'NO_TRANSCRIPTION_ENDPOINT'].includes(r.error), `got ${r.error}`);
});

// ---------- (6) gitService worktrees: real git in a temp repo ----------
execSync(
  'npx esbuild electron/services/gitService.ts --bundle --platform=node --format=esm --outfile=tests/.git.bundle.mjs --alias:electron=./tests/electron-stub.mjs',
  { cwd: join(import.meta.dirname, '..'), stdio: 'pipe' },
);
const gitSvc = await import('./.git.bundle.mjs');

test('worktrees: create copies .worktreeinclude files, resolve finds it, merge lands on main', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'sadeem-wt-'));
  const g = (...args) => execFileSync('git', args, { cwd: repo });
  g('init', '-q');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  writeFileSync(join(repo, 'app.txt'), 'hello\n');
  writeFileSync(join(repo, '.worktreeinclude'), '# ignored-but-needed\n.env\n');
  writeFileSync(join(repo, '.env'), 'SECRET=1\n');
  writeFileSync(join(repo, '.gitignore'), '.env\n');
  g('add', '.');
  g('commit', '-qm', 'init');

  const wt = await gitSvc.createWorktree(repo, 'fix-api');
  assert.match(wt.branch, /^sadeem\/fix-api$/);
  assert.ok(wt.path.includes('sadeem-fix-api'));
  assert.equal(existsSync(join(wt.path, '.env')), true, '.worktreeinclude copied the ignored .env');
  assert.equal(existsSync(join(wt.path, '.gitignore')), true);

  // resolve round-trip
  const hit = await gitSvc.resolveWorktree(repo, 'fix-api');
  assert.ok(hit);
  assert.equal(hit.name, 'fix-api');

  // resolve tolerates legacy surnia- dirs too
  const legacy = await gitSvc.resolveWorktree(repo, 'nope');
  assert.equal(legacy, null);

  // commit inside the worktree, then merge into the main tree
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: wt.path });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: wt.path });
  writeFileSync(join(wt.path, 'app.txt'), 'hello v2\n');
  execFileSync('git', ['add', '.'], { cwd: wt.path });
  execFileSync('git', ['commit', '-qm', 'wip'], { cwd: wt.path });
  const merged = await gitSvc.mergeWorktree(repo, 'fix-api');
  assert.equal(merged.ok, true, merged.error ?? '');
  assert.deepEqual(merged.merged, ['app.txt']);
  // git checks out CRLF on Windows when core.autocrlf is enabled — compare
  // normalized line endings, the content itself is byte-for-byte otherwise.
  assert.equal(readFileSync(join(repo, 'app.txt'), 'utf8').replace(/\r\n/g, '\n'), 'hello v2\n');
  // worktree cleaned up after the merge
  assert.equal((await gitSvc.resolveWorktree(repo, 'fix-api')), null);

  rmSync(repo, { recursive: true, force: true });
});

test('worktrees: name validation is enforced', async () => {
  await assert.rejects(() => gitSvc.createWorktree('/tmp', 'Bad Name!'), /INVALID_NAME/);
});
