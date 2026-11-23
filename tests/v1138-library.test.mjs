// ============================================================
// v11.38 — LIBRARY "STILL EMPTY" REGRESSION TEST
// ------------------------------------------------------------
// The founder re-reported that the v11.36 rescan did not make the library
// show anything. This test reproduces the REAL production gaps, on disk:
//
//   1. the ACTIVE workspace is discovered from fsService's confine root even
//      though settings.json/recentPaths was never written (panel-first open);
//   2. the WHOLE workspace tree is scanned — a file in public/, a deeply
//      nested static/data/ folder and root files are all visible, not just
//      the old fixed (downloads/assets/images/…) subdir allowlist;
//   3. the OS Downloads path is accepted even when its basename is NOT
//      literally "downloads" (redirected/OneDrive download folders);
//   4. userData artifacts/exports are still found;
//   5. every card renders a DISTINCT, CSP-safe kind glyph/thumbnail — no
//      <img src="file:…"> (the renderer CSP forbids file:);
//   6. forget removes a scan-only item, clear empties the gallery, and the
//      empty state is shown ONLY when the library is truly empty;
//   7. load errors are distinct and honest (bridge vs reply vs generic).
//
//   node --test --test-force-exit tests/v1138-library.test.mjs
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const HOME = mkdtempSync(join(tmpdir(), 'sadeem-v1138-'));
const USERDATA = join(HOME, 'userData');
const WORKSPACE = join(HOME, 'workspace');
// Deliberately NOT named "downloads" — v11.36 only accepted a literal name.
const DOWNLOADS = join(HOME, 'OneDrive', 'Downloaded Assets');
const LIB_BUNDLE = join(ROOT, 'tests', '.v1138-library.bundle.cjs');
const UI_BUNDLE = join(ROOT, 'tests', '.v1138-panels.bundle.cjs');
process.env.SADEEM_TEST_USERDATA = USERDATA;
process.env.SURNIA_DOWNLOADS_DIR = DOWNLOADS;

async function bundle(exportsList, outfile) {
  await esbuild.build({
    stdin: {
      contents: exportsList.map((e) => `export ${e};`).join('\n'),
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    loader: { '.css': 'empty' },
    alias: { electron: join(ROOT, 'tests', 'electron-stub.mjs') },
    external: [
      'electron', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/server',
      'zustand', 'lucide-react', 'lottie-web', '@xterm/xterm', '@xterm/addon-fit',
      'monaco-editor', '@monaco-editor/react',
    ],
  });
  return require(outfile);
}

let library, ui, React, renderToStaticMarkup;

before(async () => {
  for (const d of [
    USERDATA, join(USERDATA, 'artifacts'), join(USERDATA, 'exports'),
    WORKSPACE, join(WORKSPACE, 'downloads'), join(WORKSPACE, 'assets'),
    join(WORKSPACE, 'public'), join(WORKSPACE, 'static', 'data', 'nested'),
    DOWNLOADS,
  ]) mkdirSync(d, { recursive: true });

  library = await bundle([
    '{ listLibraryItems, scanArtifactWells, noteLibraryItem, forgetLibraryItem, clearLibrary, libraryScanHealth } from "./electron/services/libraryService"',
    '{ setConfineRoot } from "./electron/services/fsService"',
  ], LIB_BUNDLE);

  // Renderer bridge stub — must exist before api.ts is evaluated at load.
  const calls = [];
  const bridge = new Proxy({}, {
    get(_t, key) {
      if (key === 'then' || key === 'toJSON' || typeof key === 'symbol') return undefined;
      return (...args) => {
        calls.push({ key: String(key), args });
        if (key === 'libraryList') return Promise.resolve([]);
        if (key === 'onAgentEvent') return () => {};
        return Promise.resolve(undefined);
      };
    },
  });
  globalThis.window = {
    surnia: bridge,
    addEventListener() {}, removeEventListener() {},
    confirm: () => true, matchMedia: () => ({ matches: false }),
    requestAnimationFrame: () => 1, setTimeout: () => 1, clearTimeout() {},
    innerWidth: 1280, innerHeight: 800,
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {} },
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {} }),
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => {} } }, configurable: true, writable: true,
  });

  ui = await bundle([
    '{ useStore } from "./src/store"',
    '{ LibraryPanel, libraryLoadError } from "./src/components/panels/LibraryPanel"',
  ], UI_BUNDLE);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  try { rmSync(HOME, { recursive: true, force: true }); } catch { /* best effort */ }
  for (const f of [LIB_BUNDLE, UI_BUNDLE]) {
    try { rmSync(f, { force: true }); } catch { /* best effort */ }
  }
});

function renderWithState(Comp, props, overrides) {
  const original = React.useState;
  let i = 0;
  React.useState = (init) => {
    const idx = i++;
    return Object.prototype.hasOwnProperty.call(overrides, idx)
      ? [overrides[idx], () => {}]
      : original(init);
  };
  try {
    return renderToStaticMarkup(React.createElement(Comp, props ?? {}));
  } finally {
    React.useState = original;
  }
}

const paths = {
  userPng: join(USERDATA, 'artifacts', 'net-image.png'),
  exportHtml: join(USERDATA, 'exports', 'session.html'),
  downloadJpg: join(DOWNLOADS, 'downloaded-asset.jpg'),
  downloadZip: join(DOWNLOADS, 'bundle.zip'),
  rootPdf: join(WORKSPACE, 'root-note.pdf'),
  dlPdf: join(WORKSPACE, 'downloads', 'report.pdf'),
  publicPng: join(WORKSPACE, 'public', 'logo.png'),
  deepMp3: join(WORKSPACE, 'static', 'data', 'nested', 'sound.mp3'),
  assetsJpg: join(WORKSPACE, 'assets', 'hero.jpg'),
};

// ------------------------------------------------------------
// DISK TRUTH — first open sees every real well, without any note hook
// ------------------------------------------------------------
test('T1: first open lists artifacts from ALL wells (active workspace, whole tree, redirected downloads, userData)', async () => {
  writeFileSync(paths.userPng, Buffer.from('89504e470d0a1a0a', 'hex'));
  writeFileSync(paths.exportHtml, '<h1>export</h1>');
  writeFileSync(paths.downloadJpg, Buffer.from('ffd8ffe0', 'hex'));
  writeFileSync(paths.downloadZip, Buffer.from('504b0304', 'hex'));
  writeFileSync(paths.rootPdf, '%PDF-1.4 root');
  writeFileSync(paths.dlPdf, '%PDF-1.4 report');
  writeFileSync(paths.publicPng, Buffer.from('89504e470d0a1a0a', 'hex'));
  writeFileSync(paths.deepMp3, Buffer.from('494433', 'hex'));
  writeFileSync(paths.assetsJpg, Buffer.from('ffd8ffe0', 'hex'));

  // The ONLY workspace signal is the active confine root — NO settings.json,
  // NO recentPaths. This is the founder's "opened panel, saw nothing" case.
  library.setConfineRoot(WORKSPACE);

  const items = await library.listLibraryItems();
  const at = (p) => items.find((x) => x.path === p);
  for (const p of Object.values(paths)) {
    assert.ok(at(p), `artifact ${p} must be visible on the FIRST list call`);
  }
  assert.equal(at(paths.publicPng).kind, 'image', 'public/ is scanned, not just the old subdir allowlist');
  assert.equal(at(paths.deepMp3).kind, 'file', 'deeply nested files are scanned');
  assert.equal(at(paths.downloadJpg).kind, 'image', 'redirected Downloads path is scanned');
  assert.equal(at(paths.downloadZip).kind, 'download', 'generic files in a downloads well are kind=download');
  assert.equal(at(paths.exportHtml).kind, 'export');
  assert.equal(at(paths.dlPdf).kind, 'document');
  const health = library.libraryScanHealth();
  assert.equal(health.ok, true);
  assert.ok(health.wells > 0, 'real wells were opened');
  assert.ok(health.found >= Object.keys(paths).length);
});

// ------------------------------------------------------------
// RENDER — distinct, CSP-safe glyph thumbnails on every card
// ------------------------------------------------------------
test('T2: cards render DISTINCT glyph thumbnails and never a file: URL (CSP-safe)', async () => {
  const items = await library.listLibraryItems();
  ui.useStore.setState({ settings: { language: 'en' }, notify: () => {} });
  // useState order: tab 0, items 1, kind 2, q 3, loadError 4.
  const html = renderWithState(ui.LibraryPanel, {}, { 1: items, 4: '' });
  for (const kind of ['image', 'document', 'download', 'export', 'file']) {
    assert.match(html, new RegExp(`lib-thumb-${kind}`), `${kind} has its own thumbnail glyph`);
    assert.match(html, new RegExp(`data-library-kind="${kind}"`), `${kind} card is distinguishable`);
  }
  assert.doesNotMatch(html, /src=["']file:/i, 'no file: URL is ever put in the renderer (CSP blocks it)');
});

// ------------------------------------------------------------
// FORGET / CLEAR — real mutations, honest empty state
// ------------------------------------------------------------
test('T3: forget removes a scan-only item and it stays gone after a rescan', async () => {
  const items = await library.listLibraryItems();
  const target = items.find((x) => x.path === paths.publicPng);
  assert.ok(target, 'seed from T1 present');
  const res = library.forgetLibraryItem(target.id);
  assert.equal(res.ok, true);
  const after = await library.listLibraryItems();
  assert.equal(after.some((x) => x.path === paths.publicPng), false, 'forget survives the next rescan');
  assert.ok(after.some((x) => x.path === paths.assetsJpg), 'other items are untouched');
});

test('T4: clear empties the gallery; the empty state is honest (no error banner)', async () => {
  library.clearLibrary();
  const items = await library.listLibraryItems();
  assert.equal(items.length, 0, 'clear empties even with files still on disk');

  ui.useStore.setState({ settings: { language: 'en' }, notify: () => {} });
  const html = renderWithState(ui.LibraryPanel, {}, { 1: [], 4: '' });
  assert.match(html, /lib-empty/);
  assert.match(html, /Empty for now/);
  assert.doesNotMatch(html, /role="alert"/, 'an empty library is NOT reported as an error');
});

// ------------------------------------------------------------
// ERRORS — distinct, one-language, actionable
// ------------------------------------------------------------
test('T5: load errors are distinct and honest (bridge / reply / generic, EN+AR)', () => {
  const bridge = ui.libraryLoadError(new Error('kdx:library:list failed: ECONN'), 'en');
  const reply = ui.libraryLoadError(new Error('invalid library response'), 'en');
  const generic = ui.libraryLoadError(new Error('IPC_DOWN'), 'en');
  assert.match(bridge, /Could not read the library/);
  assert.match(bridge, /bridge is not ready/);
  assert.match(reply, /unexpected reply/);
  assert.match(generic, /Could not read the library/);
  assert.match(ui.libraryLoadError(new Error('IPC_DOWN'), 'ar'), /تعذّر قراءة المكتبة/);
  assert.doesNotMatch(ui.libraryLoadError(new Error('x'), 'en'), /عربي/);
});
