// ============================================================
// v11.36 — LIBRARY / REPO WIKI "DOES NOT WORK" REGRESSION TEST
// ------------------------------------------------------------
// Founder report: images/files/docs downloaded from the net never appear in
// the Library; the Repo Wiki never shows anything. This test reproduces the
// real conditions on disk — not mocks of the panels:
//
//   1. seed a REAL artifact under userData/artifacts → library lists it;
//   2. seed a REAL download inside an OPEN workspace → library lists it
//      even though NO producer called noteLibraryItem (browser_download);
//   3. forget/clear tombstone the path so a rescan cannot resurrect it;
//   4. a REAL repo with README.md + docs/*.md → wiki service reads pages;
//   5. a corrupt wiki.json → honest error, never a blank wiki;
//   6. the panels actually RENDER those real pages / a visible error banner.
//
//   node --test --test-force-exit tests/v1136-library-wiki.test.mjs
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const HOME = mkdtempSync(join(tmpdir(), 'sadeem-v1136-'));
const USERDATA = join(HOME, 'userData');
const WORKSPACE = join(HOME, 'workspace');
const REPO = join(HOME, 'repo');
const LIB_BUNDLE = join(ROOT, 'tests', '.v1136-library.bundle.cjs');
const WIKI_BUNDLE = join(ROOT, 'tests', '.v1136-wiki.bundle.cjs');
const UI_BUNDLE = join(ROOT, 'tests', '.v1136-panels.bundle.cjs');
process.env.SADEEM_TEST_USERDATA = USERDATA;

async function bundle(exportsList, outfile, opts = {}) {
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
    external: opts.external ?? [
      'electron', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/server',
      'zustand', 'lucide-react', 'lottie-web', '@xterm/xterm', '@xterm/addon-fit',
      'monaco-editor', '@monaco-editor/react',
    ],
    plugins: opts.plugins ?? [],
  });
  return require(outfile);
}

// wikiService imports the provider runtime; stub only that module so the test
// never needs a model key or network (offline repo docs must still work).
const noProviders = {
  name: 'no-providers',
  setup(build) {
    build.onResolve({ filter: /agent\/providers$/ }, () => ({ path: 'providers-stub', namespace: 'sadeem-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'sadeem-stub' }, () => ({
      contents: 'export async function streamTurn(){ throw new Error("NO_MODEL_IN_TEST"); }',
      loader: 'js',
    }));
  },
};

let library, wiki, ui, React, renderToStaticMarkup;

before(async () => {
  mkdirSync(USERDATA, { recursive: true });
  mkdirSync(join(USERDATA, 'artifacts'), { recursive: true });
  mkdirSync(join(USERDATA, 'exports'), { recursive: true });
  mkdirSync(join(WORKSPACE, 'downloads'), { recursive: true });
  mkdirSync(join(WORKSPACE, 'assets'), { recursive: true });
  mkdirSync(join(REPO, 'docs'), { recursive: true });

  library = await bundle([
    '{ listLibraryItems, scanArtifactWells, noteLibraryItem, forgetLibraryItem, clearLibrary } from "./electron/services/libraryService"',
  ], LIB_BUNDLE);
  wiki = await bundle([
    '{ getWiki, generateWiki, scanWorkspace } from "./electron/services/wikiService"',
  ], WIKI_BUNDLE, { plugins: [noProviders] });

  // Renderer bridge must exist BEFORE api.ts is evaluated at bundle load.
  const calls = [];
  const bridge = new Proxy({}, {
    get(_t, key) {
      if (key === 'then' || key === 'toJSON' || typeof key === 'symbol') return undefined;
      return (...args) => {
        calls.push({ key: String(key), args });
        if (key === 'libraryList') return Promise.resolve([]);
        if (key === 'wikiGet') return Promise.resolve({ wiki: null, stale: false, generating: false });
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
    '{ WikiPanel } from "./src/components/panels/WikiPanel"',
  ], UI_BUNDLE);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  try { rmSync(HOME, { recursive: true, force: true }); } catch { /* best effort */ }
  for (const f of [LIB_BUNDLE, WIKI_BUNDLE, UI_BUNDLE]) {
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

function wikiDir(repo) {
  const hash = createHash('sha1').update(repo).digest('hex').slice(0, 16);
  return join(USERDATA, 'wiki', hash);
}

// ------------------------------------------------------------
// LIBRARY — disk truth, not a hook that one tool forgot to call
// ------------------------------------------------------------
test('L1: a real artifact seeded in userData/artifacts is listed by the library', async () => {
  const png = join(USERDATA, 'artifacts', 'net-image.png');
  writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
  const html = join(USERDATA, 'exports', 'session.html');
  writeFileSync(html, '<h1>export</h1>');

  const items = await library.listLibraryItems();
  const shot = items.find((x) => x.path === png);
  const exported = items.find((x) => x.path === html);
  assert.ok(shot, 'downloaded/generated image under artifacts is visible');
  assert.equal(shot.kind, 'image');
  assert.equal(shot.origin, 'scan');
  assert.ok(exported, 'session export under exports is visible');
  assert.equal(exported.kind, 'export');
});

test('L2: a real download inside an open workspace is listed WITHOUT any note hook', async () => {
  // The app's settings.json declares the open workspace — the same source the
  // wiki IPC gate uses. browser_download writes here and never notes the
  // library; the rescan must still find it.
  writeFileSync(join(USERDATA, 'settings.json'), JSON.stringify({ recentPaths: [WORKSPACE] }));
  const pdf = join(WORKSPACE, 'downloads', 'report.pdf');
  const jpg = join(WORKSPACE, 'assets', 'hero.jpg');
  const secret = join(WORKSPACE, 'downloads', 'api-key.txt');
  writeFileSync(pdf, '%PDF-1.4 real document');
  writeFileSync(jpg, Buffer.from('ffd8ffe0', 'hex'));
  writeFileSync(secret, 'SHOULD_NOT_BE_SHOWN');

  const items = await library.listLibraryItems();
  const foundPdf = items.find((x) => x.path === pdf);
  const foundJpg = items.find((x) => x.path === jpg);
  assert.ok(foundPdf, 'downloaded PDF in <workspace>/downloads appears in the library');
  assert.equal(foundPdf.kind, 'document');
  assert.ok(foundJpg, 'downloaded image in <workspace>/assets appears in the library');
  assert.equal(foundJpg.kind, 'image');
  assert.equal(items.some((x) => x.path === secret), false, 'credential-named files are never listed');
});

test('L3: forget/clear tombstone paths so a rescan cannot resurrect them', async () => {
  const png = join(USERDATA, 'artifacts', 'net-image.png');
  let items = await library.listLibraryItems();
  const before = items.find((x) => x.path === png);
  assert.ok(before, 'seed from L1 still present');
  assert.equal(library.forgetLibraryItem(before.id).ok, true);
  items = await library.listLibraryItems();
  assert.equal(items.some((x) => x.path === png), false, 'forget survives the next rescan');

  // Re-producing the same path is an explicit re-add.
  assert.equal(library.noteLibraryItem({ kind: 'image', title: 'net-image.png', path: png, origin: 'browser_download' }).ok, true);
  items = await library.listLibraryItems();
  const readded = items.find((x) => x.path === png);
  assert.ok(readded, 're-download lifts the tombstone');
  assert.equal(readded.origin, 'browser_download');

  library.clearLibrary();
  items = await library.listLibraryItems();
  assert.equal(items.length, 0, 'clear empties the gallery even with files still on disk');
});

// ------------------------------------------------------------
// WIKI — real repo docs, honest corruption, honest no-key error
// ------------------------------------------------------------
test('W1: the wiki service reads a REAL repo (README + docs/*.md) with no model', () => {
  writeFileSync(join(REPO, 'README.md'), '# Real Repo Guide\n\nUniqueMarkerText 7331 describes the repo.\n');
  writeFileSync(join(REPO, 'docs', 'architecture.md'), '# Architecture\n\nThe renderer calls the main process over IPC.\n');
  try { rmSync(wikiDir(REPO), { recursive: true, force: true }); } catch { /* absent */ }

  const status = wiki.getWiki(REPO);
  assert.ok(status.wiki, 'real repo docs produce a wiki');
  assert.equal(status.source, 'repo-docs');
  assert.equal(status.error, undefined);
  assert.equal(status.wiki.pages.length, 2);
  assert.equal(status.wiki.pages[0].title, 'Real Repo Guide', 'title comes from the real Markdown heading');
  assert.match(status.wiki.pages[0].body, /UniqueMarkerText 7331/);
  assert.ok(status.wiki.catalog.some((c) => c.title === 'Architecture'));
});

test('W2: a corrupt saved wiki is an honest error, never a blank panel', () => {
  const dir = wikiDir(REPO);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'wiki.json'), '{ this is not json');
  const status = wiki.getWiki(REPO);
  assert.equal(status.wiki, null);
  assert.match(String(status.error), /unreadable/i);
});

test('W3: generation without a key says why AND points to the readable repo docs', async () => {
  const res = await wiki.generateWiki(REPO, { model: { provider: 'custom', model: 'm' }, creds: {} });
  assert.equal(res.ok, false);
  assert.match(String(res.error), /api[_ -]?key/i);
  assert.match(String(res.error), /Markdown/i, 'the user is told about the offline docs fallback');
});

// ------------------------------------------------------------
// PANELS — the real content actually reaches the screen
// ------------------------------------------------------------
test('P1: libraryLoadError is a real, single-language, actionable message', () => {
  assert.match(ui.libraryLoadError(new Error('IPC_DOWN'), 'en'), /Could not read the library/);
  assert.match(ui.libraryLoadError(new Error('IPC_DOWN'), 'en'), /IPC_DOWN/);
  assert.match(ui.libraryLoadError(new Error('IPC_DOWN'), 'ar'), /تعذّر قراءة المكتبة/);
  assert.doesNotMatch(ui.libraryLoadError(new Error('x'), 'en'), / arab|عربي/);
});

test('P2: the Library panel shows a visible error banner instead of a blank grid', () => {
  ui.useStore.setState({
    settings: { language: 'en' },
    notify: () => {},
  });
  // useState order: tab 0, items 1, kind 2, q 3, loadError 4.
  const html = renderWithState(ui.LibraryPanel, {}, {
    1: [],
    4: ui.libraryLoadError(new Error('BRIDGE_DOWN'), 'en'),
  });
  assert.match(html, /role="alert"/);
  assert.match(html, /BRIDGE_DOWN/);
  assert.match(html, /Could not read the library/);
});

test('P3: the Wiki panel renders REAL repo page content from the service', () => {
  const status = wiki.getWiki(REPO);
  // W2 left a corrupt wiki.json; remove it so the repo docs are read again.
  assert.ok(status, 'service call is stable');
  try { rmSync(wikiDir(REPO), { recursive: true, force: true }); } catch { /* absent */ }
  const docs = wiki.getWiki(REPO);
  assert.ok(docs.wiki, 'repo docs loaded');

  ui.useStore.setState({
    settings: { language: 'en' },
    wsPath: REPO,
    notify: () => {},
  });
  // useState order: wiki 0, active 1, stage 2, stageDetail 3, error 4, loadError 5.
  const html = renderWithState(ui.WikiPanel, {}, {
    0: { ...docs.wiki, stale: false, source: docs.source },
    1: docs.wiki.pages[0].slug,
  });
  assert.match(html, /wiki-reader/);
  assert.match(html, /UniqueMarkerText 7331/, 'the real file body is on screen');
  assert.match(html, /from repo docs/, 'the source is shown honestly');
});

test('P4: the Wiki panel shows the real error text when reading fails', () => {
  ui.useStore.setState({ settings: { language: 'en' }, wsPath: REPO, notify: () => {} });
  // useState index 5 = loadError, index 2 = stage ('idle').
  const html = renderWithState(ui.WikiPanel, {}, {
    5: 'The saved wiki is unreadable. Generate it again.',
  });
  assert.match(html, /role="alert"/);
  assert.match(html, /unreadable/);
});
