import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.2.1 — "clicking a file takes me to the editor and I can't get back".
// Regression contract for the editor -> Workspace navigation and the
// PROJECT FILES / stat-band occupancy fix:
//   1. A Back-to-Workspace control is ALWAYS rendered while a file is open
//      (tab strip + breadcrumb) AND in the empty editor state, and every one
//      of them funnels through the single goWorkspace() contract.
//   2. The inverse of the store's `rail: 'editor'` transition lands on the
//      Workspace stage with the sidebar (and its file tree) revealed.
//   3. The Workspace scroll root stays transform-free: no translate-based
//      stagger may return and collide the file card into the stat band.
//   4. SSR: render the real EditorArea with one tab / with zero tabs and
//      assert the escape hatch is in the markup in both states.
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1121-nav-'));

const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

// The store touches window.surnia / localStorage at load and call time.
const bridgeCalls = [];
globalThis.window = {
  surnia: new Proxy(
    {},
    {
      get(_t, key) {
        if (key === 'then' || typeof key === 'symbol') return undefined;
        return (...args) => {
          bridgeCalls.push({ key, args });
          return Promise.resolve(undefined);
        };
      },
    },
  ),
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

// ------------------------------------------------------------
// One esbuild harness exports BOTH the real EditorArea and the real store.
// Monaco / CSS are stubbed: nothing in the render path mounts Monaco, and
// SSR never runs effects, so the stubs only need to satisfy module scope.
// ------------------------------------------------------------
const stubs = [
  {
    name: 'sadeem-v1121-ssr-stubs',
    setup(b) {
      b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, namespace: 'css-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));

      b.onResolve({ filter: /^monaco-editor$/ }, () => ({ path: 'monaco-editor', namespace: 'monaco-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'monaco-stub' }, () => ({
        contents: `module.exports = { editor: { defineTheme() {} }, KeyMod: { CtrlCmd: 1, Shift: 2 }, KeyCode: { KeyI: 1, KeyE: 2 } };`,
        loader: 'js',
      }));

      b.onResolve({ filter: /^@monaco-editor\/react$/ }, () => ({ path: '@monaco-editor/react', namespace: 'editor-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'editor-stub' }, () => ({
        contents: `const React = require('react'); module.exports = { Editor: () => React.createElement('div'), loader: { config() {} } };`,
        loader: 'js',
      }));

      // zustand v5 serves getInitialState() to React's server snapshot, which
      // would ignore the state we seed for SSR. Wrap `create` so the server
      // snapshot reads the same (seeded) state as the client snapshot.
      b.onResolve({ filter: /^zustand$/ }, () => ({ path: 'zustand', namespace: 'zustand-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'zustand-stub' }, () => ({
        contents: `
          const React = require('react');
          const { createStore } = require('zustand/vanilla');
          const build = (createState) => {
            const api = createStore(createState);
            const snap = (selector) => () => (selector ? selector(api.getState()) : api.getState());
            const useBoundStore = (selector) =>
              React.useSyncExternalStore(api.subscribe, snap(selector), snap(selector));
            Object.assign(useBoundStore, api);
            return useBoundStore;
          };
          // store.ts uses the curried form: create()(initializer).
          exports.create = (createState) => (createState === undefined ? build : build(createState));
        `,
        loader: 'js',
        resolveDir: ROOT,
      }));

      b.onResolve({ filter: /[\\/]lib[\\/](monaco|ghostText)$/ }, (a) => ({ path: a.path, namespace: 'lib-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'lib-stub' }, (a) => ({
        contents: a.path.endsWith('ghostText')
          ? `module.exports = { registerGhostText: () => ({ dispose() {} }), stripCodeFences: (s) => s };`
          : `module.exports = { monaco: { editor: { defineTheme() {} }, KeyMod: {}, KeyCode: {} }, monacoThemeFor: () => 'surnia-dark', languageForPath: () => 'plaintext' };`,
        loader: 'js',
      }));
    },
  },
];

let harnessPromise = null;
function harness() {
  if (!harnessPromise) {
    harnessPromise = (async () => {
      const entry = join(tmp, 'entry.tsx');
      writeFileSync(
        entry,
        `import { EditorArea } from ${JSON.stringify(join(ROOT, 'src', 'components', 'EditorArea.tsx'))};\n` +
          `import { useStore } from ${JSON.stringify(join(ROOT, 'src', 'store.ts'))};\n` +
          `export { EditorArea, useStore };\n`,
      );
      // Emit inside the repo so `require('react')` resolves from node_modules.
      const out = join(ROOT, 'tests', `.tmp-v1121-nav-${process.pid}.cjs`);
      await esbuild.build({
        entryPoints: [entry],
        outfile: out,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        plugins: stubs,
        external: ['electron', '@xterm/xterm', '@xterm/addon-fit', 'react', 'react-dom', 'react-dom/server'],
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
  return harnessPromise;
}

// ------------------------------------------------------------
// 1 · source-level navigation contract
// ------------------------------------------------------------
test('NAV1: every editor back control calls the single goWorkspace() contract', () => {
  const ed = read('src', 'components', 'EditorArea.tsx');

  // One inverse function, shared by all three escape hatches.
  assert.match(
    ed,
    /function goWorkspace\(\): void \{\s*const st = useStore\.getState\(\);\s*st\.setRail\('workspace'\);\s*if \(!st\.sidebarOpen\) st\.toggleSidebar\(\);\s*\}/,
    'goWorkspace() lands on Workspace and reveals the sidebar',
  );
  const calls = [...ed.matchAll(/onClick=\{goWorkspace\}/g)];
  assert.equal(calls.length, 3, 'tab strip + breadcrumb + empty state all call goWorkspace');

  // The tab-strip back button is gated ONLY on tabs.length — not on activeTab,
  // rail, hover, or a media query — so it is visible whenever a file is open.
  assert.match(
    ed,
    /\{tabs\.length > 0 && \(\s*<div className="etab-strip[\s\S]*?className="ed-back-btn"[\s\S]*?onClick=\{goWorkspace\}/,
    'back control lives in the tab strip, gated on tabs.length > 0',
  );
  assert.match(ed, /className="ed-crumb-btn"[\s\S]*?onClick=\{goWorkspace\}/, 'breadcrumb root is a second back control');
  assert.match(
    ed,
    /className="ed-back-btn shrink-0"[\s\S]*?onClick=\{goWorkspace\}/,
    'closing the last tab still leaves an escape hatch in the empty state',
  );
  assert.match(ed, /aria-label=\{t\('ed\.back', 'Back to Workspace'\)\}/, 'back control is labelled for a11y');
});

test('NAV1: openFile/setActiveTab enter the editor rail; back control CSS is always visible', () => {
  const store = read('src', 'store.ts');
  assert.match(store, /set\(\{ activeTab: path, rail: 'editor' \}\)/, 'existing tab → editor rail');
  assert.match(store, /set\(\{ tabs: \[\.\.\.get\(\)\.tabs, tab\], activeTab: path, rail: 'editor' \}\)/, 'new tab → editor rail');
  assert.match(store, /setActiveTab: \(path\) => set\(\{ activeTab: path, rail: 'editor' \}\)/, 'tab switch → editor rail');

  const css = read('src', 'components', 'files.css');
  const rule = /\.ed-back-btn \{([\s\S]*?)\}/.exec(css);
  assert.ok(rule, '.ed-back-btn is styled');
  assert.doesNotMatch(rule[1], /display:\s*none/, 'back control is never display:none');
  assert.match(rule[1], /display:\s*inline-flex/, 'back control is laid out inline-flex');
  assert.match(rule[1], /flex-shrink:\s*0/, 'it cannot be squeezed out by a long tab strip');
});

// ------------------------------------------------------------
// 2 · store behaviour (real store bundle)
// ------------------------------------------------------------
test('NAV2: the inverse transition restores the Workspace stage and the sidebar', async () => {
  const { useStore } = await harness();
  useStore.setState({
    rail: 'editor',
    sidebarOpen: false,
    tabs: [{ path: '/ws/a.ts', content: 'x', original: 'x', dirty: false }],
    activeTab: '/ws/a.ts',
  });

  // Exactly what goWorkspace() does (store.ts:4620 makes setRail reveal the
  // sidebar when the rail actually changes; the guard covers the no-change case).
  useStore.getState().setRail('workspace');
  if (!useStore.getState().sidebarOpen) useStore.getState().toggleSidebar();
  assert.equal(useStore.getState().rail, 'workspace', 'back lands on the Workspace stage');
  assert.equal(useStore.getState().sidebarOpen, true, 'the file-tree sidebar is revealed');

  useStore.getState().setActiveTab('/ws/a.ts');
  assert.equal(useStore.getState().rail, 'editor', 'clicking a file returns to the editor');
});

// ------------------------------------------------------------
// 3 · no overlap CSS / occupancy contract
// ------------------------------------------------------------
test('NAV3: PROJECT FILES cannot collide with the stat tiles', () => {
  const panel = read('src', 'components', 'panels', 'WorkspacePanel.tsx');
  assert.match(
    panel,
    /className="ws-scroll ws-doc flex-1 overflow-y-auto overflow-x-hidden min-h-0 flex flex-col"/,
    'scroll root class contract unchanged',
  );
  assert.doesNotMatch(panel, /className="[^"]*pv14-stagger/, 'no translate-based stagger on the scroll root');
  assert.ok(
    panel.indexOf('ws-statband') < panel.indexOf('id="project-files"'),
    'stat band still precedes PROJECT FILES in normal flow',
  );

  const art = read('src', 'components', 'panels', 'hgs-art.css');
  assert.match(
    art,
    /\.page-v14\.page-v14 \.ws-scroll \{ animation: none !important; transform: none !important; \}/,
    'scroll root is pinned transform-free',
  );

  const css = read('src', 'components', 'files.css');
  assert.doesNotMatch(css, /\.ws-scroll\s*\{/, 'files.css never styles the scroll root with a transform');
  assert.match(css, /\.pf-tree-wrap \{[^}]*transform: none/, 'the tree well is transform-free too');
  for (const name of ['pf-stagger-in', 'pf-row-in', 'ws-fade']) {
    const block = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\}`).exec(css);
    assert.ok(block, `@keyframes ${name} exists`);
    const declarations = block[1].replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(declarations, /translate|scale|transform/, `${name} is opacity-only (no overlap)`);
  }
});

// ------------------------------------------------------------
// 4 · SSR — the real component, both states
// ------------------------------------------------------------
test('NAV4: SSR markup always contains a visible back control (open file + empty state)', async () => {
  const { EditorArea, useStore } = await harness();
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const ws = join(tmp, 'ws');
  const path = `${ws}/src/a.ts`;

  const seed = (tabs, activeTab) =>
    useStore.setState({
      wsPath: ws,
      tabs,
      activeTab,
      rail: 'editor',
      sidebarOpen: false,
      settings: { ...useStore.getState().settings, language: 'en', editor: { minimap: false } },
    });

  seed([{ path, content: 'const a = 1;\n', original: 'const a = 1;\n', dirty: false }], path);
  const withFile = renderToStaticMarkup(React.createElement(EditorArea));
  assert.match(withFile, /class="etab-strip/, 'tab strip is rendered with a file open');
  assert.match(withFile, /class="ed-back-btn"/, 'tab-strip back control is in the markup');
  assert.match(withFile, /aria-label="Back to Workspace"/, 'back control is labelled');
  assert.match(withFile, /class="ed-crumb-btn"/, 'breadcrumb root back control is in the markup');
  assert.match(withFile, /data-tab="/, 'the open tab is present');

  seed([], null);
  const empty = renderToStaticMarkup(React.createElement(EditorArea));
  assert.doesNotMatch(empty, /class="etab-strip/, 'no tabs → no tab strip');
  assert.match(empty, /class="ed-back-btn shrink-0"/, 'empty state keeps the escape hatch');
  assert.match(empty, /aria-label="Back to Workspace"/, 'empty-state back control is labelled');
});
