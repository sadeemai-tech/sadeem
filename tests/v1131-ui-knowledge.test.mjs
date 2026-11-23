// ============================================================
// v11.31 — UI KNOWLEDGE PANELS AUDIT (Git / Artifacts / Library /
// Prompts / Wiki). Verifies the five owned panels with the repo's
// standard esbuild-bundle + mock-bridge + SSR + real-click pattern
// (copied from tests/v1127-ui-guard.test.mjs) plus source guards.
//
// What is locked down here:
//   Git      — review via the REAL store contract (no dead listeners),
//              honest "nothing to commit", full staged+unstaged patch,
//              real refresh spinner, localized branch-graph labels,
//              stage/unstage '!' contract, AI error display.
//   Artifacts— real clipboard Copy action + localized failure, stale
//              export marker cleared on session change.
//   Library  — forget uses a trash glyph (not "open folder"), confirms
//              and reports; open failures are caught; kind labels are
//              bilingual where the dictionary has no lib.kind.* keys.
//   Prompts  — exact save error codes (storage_failed is NOT "text
//              required"), delete reports success/failure, helpers pure.
//   Wiki     — real wiki_stage events drive the pipeline, errors render
//              in EVERY state (including first-generation failure),
//              load failures are distinct from "no wiki yet".
//
//   node --test --test-force-exit tests/v1131-ui-knowledge.test.mjs
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const P = {
  git: 'src/components/panels/GitPanel.tsx',
  art: 'src/components/panels/ArtifactsPanel.tsx',
  lib: 'src/components/panels/LibraryPanel.tsx',
  prompts: 'src/components/panels/PromptsPanel.tsx',
  wiki: 'src/components/panels/WikiPanel.tsx',
};
const SRC = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, readFileSync(join(ROOT, p), 'utf8')]));
/** Strip comments so a removed comment cannot satisfy a strict guard. */
const strip = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');
const CODE = Object.fromEntries(Object.entries(SRC).map(([k, s]) => [k, strip(s)]));
function lineOf(src, needle) {
  const i = src.indexOf(needle);
  if (i < 0) return 0;
  let line = 1;
  for (let k = 0; k < i; k++) if (src.charCodeAt(k) === 10) line++;
  return line;
}
const at = (key, needle) => `${P[key]}:${lineOf(SRC[key], needle) || '?'}`;

// ------------------------------------------------------------
// mock bridge — installed BEFORE the bundle is required (api.ts
// captures window.surnia at module load time).
// ------------------------------------------------------------
const calls = [];
const notes = [];
const agentEvents = [];
const mock = {
  gitStatus: () => ({ isRepo: true, branch: 'main', changed: [] }),
  gitLog: () => [],
  gitDiff: () => [],
  gitStage: () => true,
  gitCommit: () => 'abcdef123456',
  gitInit: () => true,
  writeFile: () => undefined,
  aiComplete: () => 'chore: tidy the widget',
  gitCommitMessage: () => ({ ok: true, message: 'feat: add widget' }),
  agentReviewRun: () => ({ findings: [{ severity: 'critical', file: 'a.ts', note: 'boom' }] }),
  libraryList: () => [],
  libraryOpen: () => true,
  libraryForget: () => true,
  libraryClear: () => true,
  promptsList: () => [],
  promptsSave: () => ({ ok: true, item: { id: 'p1', name: 'n', text: 't', createdAt: 1, updatedAt: 1 } }),
  promptsDelete: () => ({ ok: true }),
  wikiGet: () => ({ wiki: null, stale: false, generating: false }),
  wikiGenerate: () => ({ ok: true, pages: 3 }),
  onAgentEvent: (cb) => {
    agentEvents.push(cb);
    return () => {
      const i = agentEvents.indexOf(cb);
      if (i >= 0) agentEvents.splice(i, 1);
    };
  },
};
const bridge = new Proxy({}, {
  get(_t, key) {
    if (key === 'then' || key === 'toJSON' || typeof key === 'symbol') return undefined;
    return (...args) => {
      calls.push({ key: String(key), args });
      const fn = mock[String(key)];
      return fn ? fn(...args) : Promise.resolve(undefined);
    };
  },
});
let clipboardWrites = [];
let confirms = true;

const BUNDLE = join(ROOT, 'tests', '.v1131-ui-knowledge.bundle.cjs');
let mod, React, renderToStaticMarkup;
let origJsx, origJsxs;
const captured = [];

before(() => {
  globalThis.window = {
    surnia: bridge,
    addEventListener() {}, removeEventListener() {},
    confirm: () => confirms,
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: () => 1,
    setTimeout: () => 1, clearTimeout() {},
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
    value: { clipboard: { writeText: async (t) => { clipboardWrites.push(String(t)); } } },
    configurable: true, writable: true,
  });

  esbuild.buildSync({
    stdin: {
      contents: [
        "export { useStore } from './src/store';",
        "export { makeT } from './src/i18n';",
        "export { GitPanel, commitOutcome } from './src/components/panels/GitPanel';",
        "export { ArtifactsPanel } from './src/components/panels/ArtifactsPanel';",
        "export { LibraryPanel } from './src/components/panels/LibraryPanel';",
        "export { PromptsPanel, promptSaveError } from './src/components/panels/PromptsPanel';",
        "export { WikiPanel } from './src/components/panels/WikiPanel';",
      ].join('\n'),
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLE,
    loader: { '.css': 'empty' },
    external: [
      'electron', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/server', 'zustand',
      'lucide-react', 'lottie-web', '@xterm/xterm', '@xterm/addon-fit',
      'monaco-editor', '@monaco-editor/react',
    ],
  });
  mod = require(BUNDLE);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect; // SSR: silence layout-effect warning
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
  const jr = require('react/jsx-runtime');
  origJsx = jr.jsx; origJsxs = jr.jsxs;
  jr.jsx = (...a) => { captured.push({ type: a[0], props: a[1] }); return origJsx(...a); };
  jr.jsxs = (...a) => { captured.push({ type: a[0], props: a[1] }); return origJsxs(...a); };
});

after(() => {
  const jr = require('react/jsx-runtime');
  if (origJsx) jr.jsx = origJsx;
  if (origJsxs) jr.jsxs = origJsxs;
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------
const T = 1700000000000;
const WS = join(ROOT, 'ws-v1131');
const h = (...a) => React.createElement(...a);
const reset = () => { calls.length = 0; notes.length = 0; clipboardWrites = []; confirms = true; };
function seed(extra = {}) {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    wsPath: WS,
    settings: { ...prev.settings, language: 'en', model: { provider: 'custom', model: 'm' } },
    session: {
      id: 's1', title: 'Session one', workspace: WS, messages: [], createdAt: T, updatedAt: T,
      messageCount: 0, totalTokens: 0, totalCostUsd: 0,
    },
    git: null, lastReview: null, commitSuggestion: null, artifactComments: [],
    todos: [], diffView: null, composerInsert: null,
    notify: (m) => { notes.push(String(m)); },
    ...extra,
  });
}
/** SSR a panel and capture every JSX element it created. */
function render(Comp, props) {
  captured.length = 0;
  const html = renderToStaticMarkup(h(Comp, props ?? {}));
  return html;
}
/**
 * SSR with seeded LOCAL state. These panels load their lists in useEffect,
 * which renderToStaticMarkup never runs; overriding React.useState for the
 * panel's first hooks (before any child renders) lets the real row handlers
 * receive real items without adding test-only props to production code.
 */
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
    return render(Comp, props);
  } finally {
    React.useState = original;
  }
}
/** Find a clickable control by an EXACT title / aria-label / testid / label.
 *  Exactness matters: "Stage" must not match the "Staged" count pill. */
function ctrl(needle) {
  const match = (p) => {
    if (!p) return false;
    if (p.title === needle || p['aria-label'] === needle || p['data-testid'] === needle) return true;
    const kids = Array.isArray(p.children) ? p.children : [p.children];
    return kids.some((k) => typeof k === 'string' && k.trim() === needle);
  };
  return captured.find((e) => e?.props && typeof e.props.onClick === 'function' && match(e.props))
    ?? captured.find((e) => e?.props && match(e.props));
}
async function click(el) {
  assert.ok(el, 'control exists');
  assert.equal(typeof el.props?.onClick, 'function', 'control has a real onClick');
  const oldErr = console.error; console.error = () => {};
  try {
    await el.props.onClick({ preventDefault() {}, stopPropagation() {} });
    await new Promise((r) => setImmediate(r));
  } finally { console.error = oldErr; }
}
const had = (key, pred = () => true) => calls.some((c) => c.key === key && pred(c.args));

// ============================================================
// GIT PANEL
// ============================================================
test('G1 source: review uses the store contract; no dead duplicate window listeners', () => {
  assert.doesNotMatch(CODE.git, /surnia:review-findings/, `${at('git', 'surnia:review-findings')}: dead duplicate listener bridge must be gone`);
  assert.match(CODE.git, /useStore\(\(s\) => s\.lastReview\)/, `${at('git', 'lastReview')}: reads the real review state`);
  assert.match(CODE.git, /await runReviewAction\(\)/, `${at('git', 'runReviewAction')}: review button calls the store action`);
  assert.match(CODE.git, /finally \{\s*setReviewBusy\(false\)/, `${at('git', 'setReviewBusy')}: spinner always terminates`);
  assert.doesNotMatch(CODE.git, /agentReviewRun/, `${at('git', 'agentReviewRun')}: no direct window review bridge bypass`);
  assert.match(CODE.git, /gitAheadBehind/, 'the optional ahead/behind probe stays forward-compatible');
});

test('G2 runtime: stage/unstage call the real git stage contract', async () => {
  reset();
  seed({ git: {
    isRepo: true, branch: 'main',
    changed: [
      { path: 'src/a.ts', status: 'M', staged: false },
      { path: 'src/b.ts', status: 'M', staged: true },
    ],
  } });
  render(mod.GitPanel);
  await click(ctrl('Stage'));
  assert.ok(had('gitStage', (a) => Array.isArray(a[1]) && a[1].includes('src/a.ts')), 'unstaged file staged via gitStage');
  await click(ctrl('Unstage'));
  assert.ok(had('gitStage', (a) => Array.isArray(a[1]) && a[1].includes('!src/b.ts')), 'staged file unstaged via "!" prefix');
});

test('G3 commitResult: empty hash is NEVER reported as a commit', () => {
  const t = mod.makeT('en');
  const empty = mod.commitOutcome('', t, 'en');
  assert.equal(empty.clear, false, 'message is kept when nothing was committed');
  assert.match(empty.message, /Nothing to commit/i);
  assert.doesNotMatch(empty.message, /Committed/);
  const done = mod.commitOutcome('abcdef1234', t, 'en');
  assert.equal(done.clear, true);
  assert.match(done.message, /Committed · abcdef1/, 'success shows the verifiable short hash');
  const ar = mod.commitOutcome('', mod.makeT('ar'), 'ar');
  assert.match(ar.message, /لا شيء للإيداع/, 'Arabic failure is Arabic, not an English raw error');
});

test('G4 runtime: view-diff sends the WHOLE patch (staged + unstaged)', async () => {
  reset();
  seed({ git: { isRepo: true, branch: 'main', changed: [{ path: 'src/a.ts', status: 'M', staged: false }] } });
  mock.gitDiff = () => [
    { path: 'src/a.ts', patch: '+working line' },
    { path: 'src/a.ts (staged)', patch: '+staged line' },
  ];
  render(mod.GitPanel);
  await click(ctrl('View diff'));
  const dv = mod.useStore.getState().diffView;
  assert.match(dv?.patch ?? '', /\+working line/);
  assert.match(dv?.patch ?? '', /\+staged line/, 'the second (staged) patch is NOT dropped');
  mock.gitDiff = () => [];
});

test('G5 source+SSR: branch graph is honest when upstream data is absent and bilingual when present', () => {
  assert.match(CODE.git, /known=\{aheadBehind !== null\}/, `${at('git', 'known=')}: graph knows whether data is real`);
  assert.match(CODE.git, /t\('hgs\.git\.local'/, `${at('git', 'hgs.git.local')}: local label localized`);
  assert.match(CODE.git, /t\('hgs\.git\.upstream'/, `${at('git', 'hgs.git.upstream')}: upstream label localized`);
  assert.doesNotMatch(CODE.git, />LOCAL</, 'no hard-coded English SVG label');
  assert.doesNotMatch(CODE.git, />UPSTREAM</, 'no hard-coded English SVG label');
  seed({ git: { isRepo: true, branch: 'main', changed: [] } });
  const en = render(mod.GitPanel);
  assert.match(en, /upstream distance unavailable in this build/, 'unknown distance is stated, not faked');
  assert.doesNotMatch(en, />UPSTREAM</, 'no fabricated upstream lane');
  seed({ git: { isRepo: true, branch: 'main', changed: [] }, settings: { ...mod.useStore.getState().settings, language: 'ar' } });
  const ar = render(mod.GitPanel);
  assert.match(ar, /المسافة من المنبع غير متاحة/, 'Arabic honesty string renders in Arabic UI');
});

test('G6 runtime: review button reaches the store action and clears busy', async () => {
  reset();
  seed({ git: { isRepo: true, branch: 'main', changed: [] } });
  render(mod.GitPanel);
  await click(ctrl('Review working diff'));
  assert.ok(had('agentReviewRun'), 'the real review IPC channel was used');
  const rev = mod.useStore.getState().lastReview;
  assert.equal(rev?.findings?.[0]?.severity, 'critical', 'canonical severity preserved in store');
  assert.equal(notes.some((n) => /Review complete/i.test(n)), true, 'real review outcome notified');
});

// ============================================================
// ARTIFACTS PANEL
// ============================================================
test('A1 source: real copy action, localized export failure, stale marker cleared', () => {
  assert.match(CODE.art, /navigator\.clipboard\.writeText/, `${at('art', 'navigator.clipboard')}: copy is a real clipboard write`);
  assert.match(CODE.art, /artifacts\.exportFailed/, `${at('art', 'artifacts.exportFailed')}: raw error is wrapped`);
  assert.match(CODE.art, /setExported\(null\)/, `${at('art', 'setExported(null)')}: stale export marker reset`);
  assert.match(CODE.art, /\[session\?\.id\]/, `${at('art', 'session?.id')}: reset is keyed on the session`);
});

test('A2 runtime: Copy writes the real proof HTML to the clipboard + notifies', async () => {
  reset();
  seed();
  render(mod.ArtifactsPanel);
  await click(ctrl('Copy'));
  assert.ok(clipboardWrites.length > 0, 'clipboard.writeText was called');
  assert.match(clipboardWrites[0], /<!doctype html|<html/i, 'copied payload is the self-contained proof page');
  assert.ok(notes.some((n) => /copied to clipboard/i.test(n)), 'success is reported');
});

test('A3 runtime: Export writes into the workspace and reports the real filename', async () => {
  reset();
  seed();
  render(mod.ArtifactsPanel);
  await click(ctrl('Export shareable proof page (HTML)'));
  const w = calls.find((c) => c.key === 'writeFile');
  assert.ok(w, 'writeFile bridge used');
  assert.match(String(w.args[0]), /surnia-proof-.*\.html$/, 'real dated filename saved in workspace');
  assert.ok(notes.some((n) => /surnia-proof-.*\.html/.test(n)), 'filename shown to user');
});

// ============================================================
// LIBRARY PANEL
// ============================================================
test('L1 source: forget uses a trash glyph, confirms, and reports; open is guarded', () => {
  const forgetBlock = CODE.lib.slice(CODE.lib.indexOf('const forget'), CODE.lib.indexOf('const forget') + 900);
  assert.match(forgetBlock, /window\.confirm/, `${at('lib', 'window.confirm')}: destructive forget confirms`);
  assert.match(forgetBlock, /api\.libraryForget/, 'forget calls the real bridge');
  assert.match(forgetBlock, /notify\(/, 'forget reports its outcome');
  const handlerAt = CODE.lib.indexOf('void forget(x)');
  const card = CODE.lib.slice(handlerAt - 300, handlerAt + 120);
  assert.match(card, /<Trash2\b/, `${at('lib', '<Trash2')}: forget icon is a trash can`);
  assert.doesNotMatch(card, /<FolderOpen\b/, 'no misleading "open folder" glyph on a delete control');
  // v11.38 (F6) — FolderOpen is now a legitimate FALLBACK glyph for unknown
  // item kinds (not a delete/open-folder action). Only the delete control must
  // be free of it; the kind-icon fallback is correct.
  assert.match(CODE.lib, /default: return FolderOpen/, 'FolderOpen kept only as the unknown-kind fallback');
  assert.match(CODE.lib, /try \{\s*const ok = await api\.libraryOpen/, `${at('lib', 'libraryOpen')}: open failures are caught`);
});

test('L2 SSR: kind labels are bilingual where the dictionary has no lib.kind.* keys', () => {
  seed({ settings: { ...mod.useStore.getState().settings, language: 'ar' } });
  const ar = render(mod.LibraryPanel);
  assert.match(ar, /الكل/, 'Arabic "All" filter label');
  assert.match(ar, /صورة/, 'Arabic "Image" shelf bay');
  assert.doesNotMatch(ar, />IMAGE</, 'no uppercase English leakage into Arabic UI');
  seed({ settings: { ...mod.useStore.getState().settings, language: 'en' } });
  const en = render(mod.LibraryPanel);
  assert.match(en, />All</, 'English labels still correct');
});

test('L3 runtime: open + forget reach the bridge and results are reported', async () => {
  reset();
  const item = { id: 'i1', title: 'Shot', kind: 'image', path: '/tmp/shot.png', createdAt: T, origin: 'agent' };
  mock.libraryList = () => [item];
  seed();
  renderWithState(mod.LibraryPanel, {}, { 1: [item] }); // useState #1 = items
  await click(ctrl('Open'));
  assert.ok(had('libraryOpen', (a) => a[0] === 'i1'), 'libraryOpen called with the item id');
  await click(ctrl('Remove from library'));
  assert.ok(had('libraryForget', (a) => a[0] === 'i1'), 'libraryForget called with the item id');
  assert.ok(notes.some((n) => /stays on disk|يبقى على القرص/.test(n)), 'honest "file stays on disk" notice');
  mock.libraryList = () => [];
});

// ============================================================
// PROMPTS PANEL
// ============================================================
test('P1 promptSaveError: every service error code gets its own honest message', () => {
  const t = mod.makeT('en');
  const name = mod.promptSaveError('name_required', t, false);
  const text = mod.promptSaveError('text_required', t, false);
  const storage = mod.promptSaveError('storage_failed', t, false);
  assert.match(name, /name is required/i);
  assert.match(text, /text is required/i);
  assert.match(storage, /Could not save on this device/i, 'storage failure is NOT "text required"');
  assert.equal(name === text && text === storage, false, 'three distinct causes');
  const ar = mod.promptSaveError('storage_failed', mod.makeT('ar'), true);
  assert.match(ar, /تعذّر الحفظ/, 'Arabic storage failure is Arabic');
  assert.match(mod.promptSaveError('weird_code', t, false), /weird_code/, 'unknown code is surfaced, not swallowed');
});

test('P2 source: the blanket "text required" fallback is gone; delete reports', () => {
  assert.match(CODE.prompts, /promptSaveError\(res\.error, t, ar\)/, `${at('prompts', 'promptSaveError')}: exact code mapping used`);
  assert.match(CODE.prompts, /if \(!res\?\.ok\)/, `${at('prompts', '!res?.ok')}: delete failure checked`);
  assert.match(CODE.prompts, /prompts\.deleted/, `${at('prompts', 'prompts.deleted')}: delete success reported`);
  assert.match(CODE.prompts, /catch \(err\)[\s\S]{0,200}prompts\.deleteFailed/, `${at('prompts', 'deleteFailed')}: delete rejection caught`);
});

test('P3 runtime: delete + insert call the real bridges; failures are visible', async () => {
  reset();
  const item = { id: 'p9', name: 'Review', text: 'Review the code', createdAt: T, updatedAt: T };
  mock.promptsList = () => [item];
  seed();
  renderWithState(mod.PromptsPanel, {}, { 0: [item] }); // useState #0 = items
  await click(ctrl('Delete'));
  assert.ok(had('promptsDelete', (a) => a[0] === 'p9'), 'promptsDelete called with the id');
  assert.ok(notes.some((n) => /deleted/i.test(n)), 'deletion result notified');
  await click(ctrl('Insert'));
  assert.equal(mod.useStore.getState().composerInsert?.text, 'Review the code', 'insert puts the exact saved text in the composer');
  mock.promptsList = () => [];
});

// ============================================================
// WIKI PANEL
// ============================================================
test('W1 source: real wiki_stage events drive stages; error shown outside the reader', () => {
  assert.match(CODE.wiki, /api\.onAgentEvent/, `${at('wiki', 'api.onAgentEvent')}: subscribes to real stage events`);
  assert.match(CODE.wiki, /e\?\.type === 'wiki_stage'/, `${at('wiki', "wiki_stage")}: event narrowed to wiki stage`);
  assert.match(CODE.wiki, /setStage\(e\.stage\)/, `${at('wiki', 'setStage(e.stage)')}: stage comes from the backend`);
  const errAt = CODE.wiki.indexOf('role="alert"');
  const readerAt = CODE.wiki.indexOf('wiki-reader');
  assert.ok(errAt > 0 && errAt < readerAt, `${at('wiki', 'role="alert"')}: global error precedes the reader branch`);
  assert.match(CODE.wiki, /setLoadError\(/, `${at('wiki', 'setLoadError')}: load failure tracked separately`);
  assert.doesNotMatch(CODE.wiki, /new Date\(wiki\.generatedAt\)\.toLocaleString\(\)/, 'no locale-less date in the reader');
});

test('W2 runtime: generation reaches the wiki bridge and its result is reported', async () => {
  reset();
  seed();
  render(mod.WikiPanel);
  await click(ctrl('Generate the wiki'));
  assert.ok(had('wikiGenerate', (a) => a[0] === WS && a[1] === 'en'), 'real generate channel with the active workspace + language');
  assert.ok(notes.some((n) => /Wiki generated — 3 pages/.test(n)), 'the REAL page count is reported');
});

test('W3 runtime: a failed first generation leaves a visible alert (not a silent empty state)', async () => {
  reset();
  mock.wikiGenerate = () => ({ ok: false, error: 'MODEL_OFFLINE' });
  seed();
  // The handler sets local state; assert the error text is carried into the
  // alert channel (source guard W1 proves that channel is outside the reader).
  render(mod.WikiPanel);
  await click(ctrl('Generate the wiki'));
  assert.ok(!notes.some((n) => /Wiki generated/.test(n)), 'no false success notice');
  assert.ok(had('wikiGenerate'), 'the real call was made');
  assert.match(CODE.wiki, /\{error \|\| loadError\}/, `${at('wiki', 'error || loadError')}: the alert renders the failure`);
  mock.wikiGenerate = () => ({ ok: true, pages: 3 });
});

test('W4 source: catalog opens a real page; the reader renders real markdown', () => {
  // SSR cannot run the async wikiGet effect, so the loaded-reader path is
  // guarded at source level (the generate/error paths are runtime-tested).
  assert.match(CODE.wiki, /onClick=\{\(\) => setActive\(c\.slug\)\}/, `${at('wiki', 'setActive(c.slug)')}: catalog item opens its page`);
  assert.match(CODE.wiki, /<ReactMarkdown remarkPlugins=\{\[remarkGfm\]\}>\{page\.body\}<\/ReactMarkdown>/,
    `${at('wiki', 'ReactMarkdown')}: the REAL page body is rendered, not a placeholder`);
  assert.match(CODE.wiki, /page = wiki\?\.pages\.find\(\(p\) => p\.slug === active\) \?\? wiki\?\.pages\[0\] \?\? null/,
    `${at('wiki', 'page = wiki')}: active selection falls back to the first real page`);
  assert.match(CODE.wiki, /wiki\.stale/, `${at('wiki', 'wiki.stale')}: stale badge driven by the real signal`);
});
