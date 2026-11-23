import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.31 — UI / workspace / file-tree / editor audit regression.
// Covers the concrete fixes in the five owned components:
//   1. FileTree name filter actually expands nested directories
//      (allDirPaths used to return an EMPTY set → dead filter).
//   2. "New file / New folder" creates in the BROWSED folder, not always
//      at the workspace root (wrong-path bug via FILES_CREATE_EVENT).
//   3. External reveals (breadcrumb / editor breadcrumb) cannot be shadowed
//      by a sticky Crosshair localReveal; folder reveals browse INTO the dir.
//   4. Editor breadcrumb folders navigate back to Workspace + reveal; the
//      three goWorkspace() escape hatches remain intact; a visible Save
//      control resolves the dirty state.
//   5. PROJECT FILES consumes the reveal event and marks the current crumb.
//   6. Inline edit has an Escape exit after generation + undo grouping.
//   7. Store-level: createEntry honours the supplied parent directory.
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1131-files-'));

const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

// The store touches window.surnia / localStorage at module load. Install a
// permissive bridge BEFORE bundling so `api` binds to it (same pattern as the
// other store-level harnesses in this suite).
const calls = [];
globalThis.window = {
  surnia: new Proxy(
    {},
    {
      get(_t, key) {
        if (key === 'then' || typeof key === 'symbol') return undefined;
        return (...args) => {
          calls.push({ key, args });
          return Promise.resolve(undefined);
        };
      },
    },
  ),
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let storePromise = null;
function storeModule() {
  if (!storePromise) {
    storePromise = (async () => {
      const out = join(ROOT, 'tests', `.tmp-v1131-files-${process.pid}.cjs`);
      await esbuild.build({
        entryPoints: [join(ROOT, 'src', 'store.ts')],
        outfile: out,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: [
          'electron',
          '@xterm/xterm',
          '@xterm/addon-fit',
          'react',
          'react-dom',
          'monaco-editor',
          '@monaco-editor/react',
        ],
        logLevel: 'silent',
      });
      try {
        return require(out);
      } finally {
        try {
          unlinkSync(out);
        } catch {
          /* already gone */
        }
      }
    })();
  }
  return storePromise;
}

// ------------------------------------------------------------
test('FILES1: the name filter collects every directory path (was an empty set)', () => {
  const src = read('src', 'components', 'FileTree.tsx');
  const fn = /function allDirPaths\([\s\S]*?\n\}/.exec(src);
  assert.ok(fn, 'allDirPaths helper exists');
  assert.match(fn[0], /out\.push\(node\.path\)/, 'each directory is recorded before descending');
  // the filter expansion must actually use that helper.
  assert.match(src, /setExpanded\(new Set\(allDirPaths\(visibleTree\)\)\)/, 'filter expansion uses it');
});

test('FILES2: controlled create targets the browsed folder, not the root', () => {
  const pf = read('src', 'components', 'ProjectFiles.tsx');
  assert.match(
    pf,
    /new CustomEvent\(FILES_CREATE_EVENT, \{ detail: \{ mode: m, dir: currentDir \?\? wsPath \} \}\)/,
    'the browsed folder is carried with the create request',
  );
  const wp = read('src', 'components', 'panels', 'WorkspacePanel.tsx');
  assert.match(wp, /const parent = createDir \?\? wsPath;/, 'the panel resolves the target parent');
  assert.match(wp, /createEntry\(createMode, parent, name\)/, 'creation uses the resolved parent');
  assert.doesNotMatch(wp, /createEntry\(createMode, wsPath, name\)/, 'the hardcoded root path is gone');
});

test('FILES3: external reveal is never shadowed; folder reveals browse into the folder', () => {
  const src = read('src', 'components', 'FileTree.tsx');
  assert.match(src, /if \(revealPath\) setLocalReveal\(revealPath\);/, 'external reveal mirrors into local state');
  assert.match(
    src,
    /onActiveDirChange\?\.\(targetIsDir \? target : parentOf\(target\) \|\| root \|\| null\)/,
    'a directory target browses into that directory',
  );
});

test('FILES4: editor breadcrumbs navigate + Save exists + back contract intact', () => {
  const ed = read('src', 'components', 'EditorArea.tsx');
  assert.match(ed, /import \{ REVEAL_FILE_EVENT \} from '\.\/ProjectFiles';/, 'reveal bridge imported');
  assert.match(
    ed,
    /function goWorkspaceTo\(folderPath: string\): void \{\s*goWorkspace\(\);\s*window\.dispatchEvent\(new CustomEvent\(REVEAL_FILE_EVENT, \{ detail: \{ path: folderPath \} \}\)\);\s*\}/,
    'crumb click returns to Workspace and reveals its folder',
  );
  assert.equal([...ed.matchAll(/onClick=\{goWorkspace\}/g)].length, 3, 'the three back controls are unchanged');
  assert.match(ed, /onClick=\{\(\) => void saveTab\(tab\.path\)\}/, 'a visible Save control saves the active tab');
  assert.match(
    ed,
    /className="ed-crumb-seg[^"]*"[\s\S]*?onClick=\{\(\) => goWorkspaceTo\(seg\.path\)\}/,
    'folder crumbs are clickable',
  );
});

test('FILES5: PROJECT FILES consumes the reveal event and marks the current crumb', () => {
  const pf = read('src', 'components', 'ProjectFiles.tsx');
  assert.match(pf, /export const REVEAL_FILE_EVENT = 'surnia:files-reveal';/, 'event is exported');
  assert.match(pf, /window\.addEventListener\(REVEAL_FILE_EVENT, onReveal\)/, 'listener is installed');
  assert.match(pf, /aria-current=\{i === crumbs\.length - 1 \? 'page' : undefined\}/, 'breadcrumb marks current page');
});

test('FILES6: inline edit has an Escape exit after generation + undo grouping', () => {
  const src = read('src', 'components', 'InlineEditWidget.tsx');
  assert.match(src, /if \(phase === 'prompt'\) return;[\s\S]*?e\.key !== 'Escape'[\s\S]*?cancel\(\);/, 'Escape cancels in loading/preview');
  assert.match(src, /editor\.pushUndoStop\(\);[\s\S]*?executeEdits[\s\S]*?pushUndoStop\(\);/, 'the synthetic edit is one undo step');
});

test('FILES7: createEntry writes under the supplied parent directory', async () => {
  const { useStore } = await storeModule();
  calls.length = 0;
  await useStore.getState().createEntry('file', '/ws/src', 'new.ts');
  assert.ok(
    calls.some((c) => c.key === 'createFile' && c.args[0] === '/ws/src/new.ts'),
    'file created at /ws/src/new.ts, not /ws/new.ts',
  );
  calls.length = 0;
  await useStore.getState().createEntry('dir', '/ws/src', 'lib');
  assert.ok(
    calls.some((c) => c.key === 'createDir' && c.args[0] === '/ws/src/lib'),
    'folder created at /ws/src/lib',
  );
});
