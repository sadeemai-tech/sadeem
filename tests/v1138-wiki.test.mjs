// ============================================================
// v11.38 — "THE REPO WIKI MUST WORK" REGRESSION TEST
// ------------------------------------------------------------
// Founder: "والريبو ويكي يجب أن يعمل" — D7 added a docs fallback but the
// wiki still read as broken. This test reproduces the REAL disk conditions:
//
//   1. a temp repo with README + docs → wiki has real, sectioned pages;
//   2. source structure + package.json scripts → real extra pages, no key;
//   3. no provider key → generation says why, but getWiki STILL shows a
//      useful offline wiki (never an empty panel);
//   4. a model outage WITH a key degrades to the honest offline wiki;
//   5. corrupt wiki.json → honest error, never a blank panel;
//   6. the IPC gate helper accepts a valid open workspace even when
//      recentPaths has not caught up (the silent-null bug);
//   7. the Wiki panel SSR renders the real page content + source stamp.
//
//   node --test --test-force-exit tests/v1138-wiki.test.mjs
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const HOME = mkdtempSync(join(tmpdir(), 'sadeem-v1138-'));
const USERDATA = join(HOME, 'userData');
const REPO = join(HOME, 'repo');
const CODE_REPO = join(HOME, 'code-repo');
const EMPTY = join(HOME, 'empty');
const WIKI_BUNDLE = join(ROOT, 'tests', '.v1138-wiki.bundle.cjs');
const UI_BUNDLE = join(ROOT, 'tests', '.v1138-panels.bundle.cjs');
// wikiDir() resolves through electron.app.getPath('userData'); the test stub
// honours this variable so nothing is written into the real profile.
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

// Stub ONLY the provider runtime: no key and no network. The offline wiki
// must still be real and useful.
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

let wiki, ui, React, renderToStaticMarkup;

before(async () => {
  mkdirSync(USERDATA, { recursive: true });
  mkdirSync(join(REPO, 'docs'), { recursive: true });
  mkdirSync(join(CODE_REPO, 'src', 'core'), { recursive: true });
  mkdirSync(join(CODE_REPO, 'docs'), { recursive: true });
  mkdirSync(EMPTY, { recursive: true });

  writeFileSync(join(REPO, 'README.md'),
    '# Sadeem Demo\n\n## What it does\n\nUniqueMarkerV1138 documents the demo repo.\n\n## Getting started\n\nRun the tests.\n');
  writeFileSync(join(REPO, 'docs', 'architecture.md'),
    '# Architecture\n\nThe renderer talks to the main process over IPC.\n');

  writeFileSync(join(CODE_REPO, 'README.md'), '# Code Repo\n\nA code-only wiki source.\n');
  writeFileSync(join(CODE_REPO, 'docs', 'guide.md'), '# Guide\n\nReal guide body.\n');
  writeFileSync(join(CODE_REPO, 'package.json'), JSON.stringify({
    name: 'code-repo',
    description: 'A repo with real scripts',
    scripts: { test: 'node --test', build: 'esbuild src/index.ts --bundle' },
  }, null, 2));
  writeFileSync(join(CODE_REPO, 'src', 'index.ts'), 'export const answer = 42;\n');
  writeFileSync(join(CODE_REPO, 'src', 'core', 'engine.ts'), 'export function run() { return answer; }\n');

  wiki = await bundle([
    '{ getWiki, generateWiki, scanWorkspace, isAllowedWikiWorkspace } from "./electron/services/wikiService"',
  ], WIKI_BUNDLE, { plugins: [noProviders] });

  // Renderer bridge must exist BEFORE api.ts is evaluated at bundle load.
  const bridge = new Proxy({}, {
    get(_t, key) {
      if (key === 'then' || key === 'toJSON' || typeof key === 'symbol') return undefined;
      return (...args) => {
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
  for (const f of [WIKI_BUNDLE, UI_BUNDLE]) {
    try { rmSync(f, { force: true }); } catch { /* best effort */ }
  }
});

function wikiDir(repo) {
  const hash = createHash('sha1').update(repo).digest('hex').slice(0, 16);
  return join(USERDATA, 'wiki', hash);
}
function clean(repo) {
  try { rmSync(wikiDir(repo), { recursive: true, force: true }); } catch { /* absent */ }
}
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

// ------------------------------------------------------------
// SERVICE — a real wiki from real files
// ------------------------------------------------------------
test('S1: README + docs produce a real, sectioned wiki with no model', () => {
  clean(REPO);
  const status = wiki.getWiki(REPO);
  assert.ok(status.wiki, 'a wiki is produced');
  assert.equal(status.error, undefined);
  assert.equal(status.source, 'repo-docs');
  assert.ok(status.wiki.pages.length >= 2);
  assert.equal(status.wiki.pages[0].title, 'Sadeem Demo', 'title comes from the real README heading');
  assert.match(status.wiki.pages[0].body, /UniqueMarkerV1138/);
  assert.match(status.wiki.pages[0].body, /## What it does/, 'real Markdown sections survive');
  assert.ok(status.wiki.catalog.some((c) => c.title === 'Architecture'));
});

test('S2: source structure + package scripts become real wiki pages, still offline', () => {
  clean(CODE_REPO);
  const status = wiki.getWiki(CODE_REPO);
  assert.ok(status.wiki, 'code-only repo still yields a wiki');
  assert.equal(status.source, 'repo-docs');
  const titles = status.wiki.pages.map((p) => p.title);
  assert.ok(titles.includes('Project structure'), 'source tree is in the wiki: ' + titles);
  assert.ok(titles.includes('Scripts & setup'), 'package scripts are in the wiki: ' + titles);
  const structure = status.wiki.pages.find((p) => p.title === 'Project structure');
  assert.match(structure.body, /src\/core/);
  assert.match(structure.body, /engine\.ts/);
  const scripts = status.wiki.pages.find((p) => p.title === 'Scripts & setup');
  assert.match(scripts.body, /node --test/);
  assert.match(scripts.body, /esbuild src\/index\.ts/);
});

test('S3: no key → generation fails honestly, but getWiki still shows useful content', async () => {
  clean(REPO);
  const res = await wiki.generateWiki(REPO, { model: { provider: 'custom', model: 'm' }, creds: {} });
  assert.equal(res.ok, false);
  assert.match(String(res.error), /api[_ -]?key/i);
  const status = wiki.getWiki(REPO);
  assert.ok(status.wiki, 'offline wiki is still available with no key');
  assert.ok(status.wiki.pages.length >= 2, 'and it is not an empty shell');
});

test('S4: a model outage WITH a key degrades to the honest offline wiki', async () => {
  clean(CODE_REPO);
  const res = await wiki.generateWiki(CODE_REPO, {
    model: { provider: 'custom', model: 'm' },
    creds: { apiKey: 'test-key' },
  });
  assert.equal(res.ok, true, 'model failure is not a dead end');
  assert.equal(res.offline, true);
  assert.equal(res.source, 'repo-docs');
  assert.ok(existsSync(join(wikiDir(CODE_REPO), 'wiki.json')), 'offline wiki was persisted');
  const status = wiki.getWiki(CODE_REPO);
  assert.equal(status.source, 'repo-docs', 'provenance stays honest after reload');
  assert.ok(status.wiki.pages.some((p) => p.title === 'Scripts & setup'));
});

test('S5: a corrupt saved wiki is an honest error, never a blank panel', () => {
  clean(REPO);
  const dir = wikiDir(REPO);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'wiki.json'), '{ truncated: definitely not json');
  const status = wiki.getWiki(REPO);
  assert.equal(status.wiki, null);
  assert.match(String(status.error), /unreadable/i);
});

test('S6: the IPC gate accepts a valid workspace not yet in recentPaths', () => {
  assert.equal(wiki.isAllowedWikiWorkspace(REPO, [REPO]), true, 'recentPaths match');
  assert.equal(wiki.isAllowedWikiWorkspace(REPO, []), true, 'stale recentPaths must not null a real repo');
  assert.equal(wiki.isAllowedWikiWorkspace(CODE_REPO, ['/some/other']), true, 'project markers count');
  assert.equal(wiki.isAllowedWikiWorkspace(EMPTY, []), false, 'an arbitrary empty folder is rejected');
  assert.equal(wiki.isAllowedWikiWorkspace(join(EMPTY, 'nope'), []), false, 'a missing path is rejected');
});

// ------------------------------------------------------------
// PANEL — real content actually reaches the screen
// ------------------------------------------------------------
test('P1: the Wiki panel renders real repo sections from the service', () => {
  clean(REPO);
  const status = wiki.getWiki(REPO);
  assert.ok(status.wiki);
  ui.useStore.setState({ settings: { language: 'en' }, wsPath: REPO, notify: () => {} });
  // useState order: wiki 0, active 1, stage 2, stageDetail 3, error 4, loadError 5.
  const html = renderWithState(ui.WikiPanel, {}, {
    0: { ...status.wiki, stale: false, source: status.source },
    1: status.wiki.pages[0].slug,
  });
  assert.match(html, /wiki-reader/);
  assert.match(html, /UniqueMarkerV1138/, 'the real file body is on screen');
  assert.match(html, /What it does/, 'the real Markdown section is on screen');
  assert.match(html, /from repo docs/, 'the offline source is shown honestly');
});

test('P2: the panel shows the honest corruption error instead of a blank reader', () => {
  ui.useStore.setState({ settings: { language: 'en' }, wsPath: REPO, notify: () => {} });
  const html = renderWithState(ui.WikiPanel, {}, {
    5: 'The saved wiki is unreadable. Generate it again.',
  });
  assert.match(html, /role="alert"/);
  assert.match(html, /unreadable/);
});
