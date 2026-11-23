// ============================================================
// v11.31 — UI SHELL AUDIT (rail / titlebar / status / palette /
// shortcuts / sidebar / dock / stage wrappers).
//
// Founder-facing bugs pinned here:
//   A. The MORE (3-dot) flyout listed an INCOMPLETE set of views (no Repo
//      Wiki) and used the TERMINAL glyph for Subagents (wrong target).
//   B. Rail active marks depended on `sidebarOpen`, but every non-Home rail
//      is a STAGE rail rendered by RightDock regardless of that flag — the
//      highlight vanished while the section was still on screen.
//   C. Live Preview is painted ABOVE every stage rail. Every navigation
//      control OUTSIDE the rail (brand button, status chips, dock close/back)
//      forgot to clear it and therefore looked DEAD.
//   D. RightDock's X button toggled a sidebar that is never rendered on a
//      stage rail — a genuine no-op. It now returns Home.
//   E. StatusBar's language chip and subagent stamp were non-interactive.
//   F. The shortcuts cheat sheet omitted the live Ctrl+P Quick Open binding.
//   G. Precision animation + bilingual labels: shared easing on the task
//      fill, `anim-glass-pop` on the flyout, localized LED / dock labels.
//
// Harness: esbuild bundle of the REAL components + REAL store, SSR with a
// jsx-runtime capture so real onClick handlers can be invoked without a DOM
// (posture copied from tests/v1127-ui-guard.test.mjs). Source guards run on
// comment-stripped text so a removed behaviour cannot hide in a comment.
//
//   node --test --test-force-exit tests/v1131-ui-shell.test.mjs
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const P = {
  rail: 'src/components/Rail.tsx',
  title: 'src/components/TitleBar.tsx',
  status: 'src/components/StatusBar.tsx',
  palette: 'src/components/CommandPalette.tsx',
  shortcuts: 'src/components/ShortcutsOverlay.tsx',
  sidebar: 'src/components/Sidebar.tsx',
  dock: 'src/components/RightDock.tsx',
  stage: 'src/components/StagePage.tsx',
  pages: 'src/components/pages.tsx',
  shell: 'src/components/shell.css',
};
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const SRC = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, read(p)]));
/** Drop JSX comments, block comments and line comments. */
const strip = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');
const CODE = Object.fromEntries(Object.entries(SRC).map(([k, v]) => [k, strip(v)]));

const lineOf = (src, needle) => {
  const i = src.indexOf(needle);
  if (i < 0) return 0;
  let line = 1;
  for (let k = 0; k < i; k++) if (src.charCodeAt(k) === 10) line++;
  return line;
};
const at = (key, needle) => `${P[key]}:${lineOf(SRC[key], needle) || '?'}`;

// ------------------------------------------------------------
// Runtime harness
// ------------------------------------------------------------
const BUNDLE = join(ROOT, 'tests', '.v1131-ui-shell.bundle.cjs');
let mod, React, renderToStaticMarkup, origJsx, origJsxs, origPortal;
const captured = [];

function seedBase(extra = {}) {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    settings: {
      ...prev.settings,
      language: 'en',
      numerals: 'western',
      model: { provider: 'custom', model: 'm' },
      ui: { ...(prev.settings.ui ?? {}), sidebarWidth: undefined },
    },
    wsPath: join(ROOT, 'tests'),
    running: false,
    previewOpen: false,
    ...extra,
  });
}

before(() => {
  const bridge = new Proxy({}, {
    get(_t, k) {
      if (k === 'then' || k === 'toJSON' || typeof k === 'symbol') return undefined;
      return () => Promise.resolve(undefined);
    },
  });
  globalThis.window = {
    surnia: bridge,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    setTimeout: () => 1, clearTimeout() {},
    innerWidth: 1280, innerHeight: 800, location: { search: '' },
  };
  globalThis.document = {
    documentElement: {
      classList: { contains: () => false, add() {}, remove() {} },
      dataset: {}, style: { setProperty() {} },
    },
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {} }),
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => {} } }, configurable: true, writable: true,
  });

  // ReactDOMServer rejects portals; the toast stack portals to document.body.
  const rd = require('react-dom');
  origPortal = rd.createPortal;
  rd.createPortal = (children) => children;

  esbuild.buildSync({
    stdin: {
      contents:
        "export { useStore } from './src/store';" +
        "export { Rail } from './src/components/Rail';" +
        "export { TitleBar } from './src/components/TitleBar';" +
        "export { StatusBar } from './src/components/StatusBar';" +
        "export { RightDock } from './src/components/RightDock';" +
        "export { ShortcutsOverlay, shortcutSections } from './src/components/ShortcutsOverlay';" +
        "export { CommandPalette } from './src/components/CommandPalette';" +
        "export { makeT } from './src/i18n';",
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLE,
    loader: { '.css': 'empty', '.svg': 'dataurl' },
    external: [
      'electron', 'react', 'react/jsx-runtime', 'react/jsx-dev-runtime',
      'react-dom', 'react-dom/server', 'react-dom/client', 'zustand',
      'lucide-react', '@xterm/xterm', '@xterm/addon-fit',
      'monaco-editor', '@monaco-editor/react',
    ],
  });
  mod = require(BUNDLE);

  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect; // silence SSR layout-effect warning
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
  const rd = require('react-dom');
  if (origPortal) rd.createPortal = origPortal;
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
});

const h = (...a) => React.createElement(...a);
/** Render one component, return only the elements created by THAT render. */
function renderCapture(el) {
  captured.length = 0;
  const html = renderToStaticMarkup(el);
  return { html, els: captured.slice() };
}
const byTestId = (els, id) => els.find((e) => e && e.props && e.props['data-testid'] === id);
const byLabel = (els, label) => els.find((e) => e && e.props && e.props['aria-label'] === label);
const click = (el) => {
  assert.ok(el && typeof el.props?.onClick === 'function', 'element has a real onClick handler');
  el.props.onClick({ preventDefault() {}, stopPropagation() {} });
};
const textOf = (node) => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (typeof node === 'object' && 'props' in node) return textOf(node.props.children);
  return '';
};

// ============================================================
// A — SOURCE GUARDS
// ============================================================

test('A1 · More flyout lists EVERY stage view; Subagents has its own glyph', () => {
  const rail = CODE.rail;
  // The single source of truth for stage views.
  const registry = read('src/components/panels/registry.tsx');
  // v11.43 — STAGE_RAILS is typed AllRail (signature/proof are rail entries
  // appended for the new panels), so accept either generic.
  const stageBlock = registry.match(/STAGE_RAILS[\s\S]*?new Set<(?:RailView|AllRail)>\(\[([\s\S]*?)\]\)/);
  assert.ok(stageBlock, 'STAGE_RAILS set found');
  const stageViews = [...stageBlock[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  const primaryBlock = rail.match(/const PRIMARY[\s\S]*?\];/)[0];
  const moreBlock = rail.match(/const MORE[\s\S]*?\];/)[0];
  const listed = [
    ...[...primaryBlock.matchAll(/view: '([a-z]+)'/g)].map((m) => m[1]),
    ...[...moreBlock.matchAll(/view: '([a-z]+)'/g)].map((m) => m[1]),
  ];
  for (const v of stageViews) {
    if (v === 'search') {
      // Search is reached by the dedicated magnifier button, which dispatches
      // the same OPEN_SEARCH_EVENT App listens on (not a rail-view entry).
      assert.match(rail, /dispatchEvent\(new CustomEvent\(OPEN_SEARCH_EVENT\)\)/,
        `${at('rail', 'OPEN_SEARCH_EVENT')}: Search button reaches the search stage`);
    } else {
      assert.ok(listed.includes(v), `${at('rail', `view: '${v}'`)}: stage view '${v}' must be reachable from the rail`);
    }
  }
  assert.ok(!/\{\s*view: 'subagents',\s*icon: IcTerminal/.test(rail),
    `${at('rail', "view: 'subagents'")}: subagents must not borrow the terminal glyph`);
  assert.match(rail, /view: 'subagents', icon: IcSubagents/, 'subagents uses its own icon');
  // v1142 — the duplicate Wiki rail was removed: it was only LibraryPanel
  // with initialTab="wiki". The single visible surface is the Library tab.
  assert.doesNotMatch(rail, /view: 'wiki', icon: IcWiki/, 'repo wiki is no longer a separate rail item');
  assert.match(read('src/components/panels/LibraryPanel.tsx'), /t\('rail\.wiki'/,
    'repo wiki stays reachable as a visible tab inside LibraryPanel');
});

test('A2 · rail active marks do not depend on sidebarOpen', () => {
  const rail = CODE.rail;
  assert.ok(!/sidebarOpen/.test(rail),
    `${at('rail', 'sidebarOpen')}: stage rails stay active regardless of the sidebar flag`);
  assert.match(rail, /: rail === view;/, 'MORE entry active state is rail-only');
  assert.match(rail, /const moreActive = MORE\.some\(\(m\) => m\.view === rail\);/,
    'More button active state is rail-only');
});

test('A3 · every navigation control clears the live-preview overlay first', () => {
  for (const key of ['title', 'status', 'dock']) {
    const code = CODE[key];
    assert.ok(!/onClick=\{\(\) => setRail\(/.test(code),
      `${P[key]}: no onClick calls setRail directly (preview would stay on top)`);
    assert.ok(!/onClick=\{setRail\}/.test(code), `${P[key]}: no bare setRail handler`);
  }
  assert.match(CODE.title, /const goWorkspace = \(\) => \{[\s\S]*?setPreviewOpen\(false\);[\s\S]*?setRail\('workspace'\)/,
    `${at('title', 'goWorkspace')}: brand button reveals the workspace`);
  assert.match(CODE.status, /const goRail = [\s\S]*?setPreviewOpen\(false\);[\s\S]*?setRail\(v\)/,
    `${at('status', 'goRail')}: status navigation helper clears preview`);
  assert.match(CODE.dock, /const closeSection = \(\) => \{[\s\S]*?setPreviewOpen\(false\);[\s\S]*?setRail\('home'\)/,
    `${at('dock', 'closeSection')}: dock X returns Home`);
  assert.match(CODE.dock, /const goWorkspace = \(\) => \{[\s\S]*?setPreviewOpen\(false\);[\s\S]*?setRail\('workspace'\)/,
    `${at('dock', 'goWorkspace')}: dock back button reveals Workspace`);
});

test('A4 · RightDock close is not the dead toggleSidebar branch', () => {
  assert.ok(!/toggleSidebar/.test(CODE.dock),
    `${at('dock', 'toggleSidebar')}: sidebar is not rendered on a stage rail`);
  assert.match(CODE.dock, /data-testid="dock-close"/, 'close control has a stable hook');
  assert.match(CODE.dock, /onClick=\{closeSection\}/, 'close control returns Home');
  assert.match(CODE.dock, /title=\{t\('shortcuts\.close', 'Close section'\)\}/,
    `${at('dock', "t('shortcuts.close'")}: honest bilingual close label`);
  assert.ok(!/t\('palette\.toggleSidebar', 'Close section'\)/.test(CODE.dock),
    'the wrong "Toggle sidebar" label is gone');
});

test('A5 · status-bar chips are actionable, not decorative', () => {
  assert.match(CODE.status, /data-testid="status-subagents"[\s\S]*?onClick=\{\(\) => goRail\('subagents'\)\}/,
    `${at('status', 'status-subagents')}: subagent stamp opens the Subagents page`);
  assert.match(CODE.status, /data-testid="status-lang"[\s\S]*?onClick=\{\(\) => setLang\(lang === 'en' \? 'ar' : 'en'\)\}/,
    `${at('status', 'status-lang')}: language chip toggles AR/EN`);
  assert.match(CODE.status, /aria-label=\{t\('palette\.lang', 'Toggle language AR\/EN'\)\}/,
    'language chip has a bilingual accessible name');
});

test('A6 · shortcuts overlay lists the real Ctrl+P Quick Open binding', () => {
  assert.match(CODE.shortcuts, /\$\{M\}\+P/, `${at('shortcuts', '${M}+P')}: Quick Open row present`);
  assert.match(CODE.shortcuts, /Quick open/, 'row is labelled');
  // Every other claimed accelerator still exists.
  for (const needle of ['${M}+K', '${M}+Shift+P', '${M}+Shift+F', '${M}+O', '${M}+N', '${M}+B', '${M}+\\`', '${M}+S', '${M}+M', '${M}+Shift+V', '${M}+,']) {
    assert.ok(CODE.shortcuts.includes(needle), `binding ${needle} still listed`);
  }
});

test('A7 · command palette commands all do real work', () => {
  const pal = CODE.palette;
  assert.match(pal, /id: 'closeTab'[\s\S]*?else notify\(/,
    `${at('palette', "id: 'closeTab'")}: no-tab case reports instead of no-op`);
  assert.match(pal, /if \(!useStore\.getState\(\)\.previewOpen\) togglePreview\(\)/,
    `${at('palette', 'openPreviewUrl')}: honest preview first-step`);
  assert.ok(!/misc\.notify\.noWorkspace', 'Open a folder first'\)\);\s*\}/.test(pal),
    'the contradictory preview-URL message is gone');
  // Every Command object in the list carries a run() function.
  const runCount = (pal.match(/\brun:\s*\(/g) || []).length;
  const idCount = (pal.match(/\bid: '/g) || []).length;
  // ids also include the static settings jump-list + journal submenu rows,
  // so compare against a floor rather than a 1:1 count.
  assert.ok(runCount >= 20 && idCount >= runCount,
    `commands carry handlers (${runCount} runs / ${idCount} ids)`);
});

test('A8 · layout contract: chat LEFT, rail TOP; precision + bilingual polish', () => {
  assert.match(SRC.shell, /\.app-main-row-v12\s*>\s*\.chat-slot-v12\s*\{[^}]*order:\s*1\s*;/s,
    'chat slot keeps physical/order LEFT');
  assert.match(SRC.shell, /\.app-rail-bar-v13\s*\{[^}]*width:\s*100%/s,
    'rail stays a full-width TOP bar');
  assert.match(CODE.rail, /rail-flyout-v12 anim-glass-pop/,
    `${at('rail', 'anim-glass-pop')}: flyout opens on the shared precision curve`);
  assert.match(CODE.status, /transition: 'width \.28s var\(--ease-out\)'/,
    `${at('status', '--ease-out')}: task fill uses the shared easing token`);
  assert.match(CODE.status, /aria-label=\{t\(\s*'sb\.led\.state'/,
    `${at('status', 'sb.led.state')}: agent LED label is localized`);
  assert.match(CODE.pages, /className="pv14-eyebrow" dir="auto"/,
    `${at('pages', 'pv14-eyebrow')}: section eyebrow is RTL-aware`);
  assert.match(CODE.stage, /PANELS\[rail\] \?\? \(\(\) => null\)/,
    `${at('stage', 'PANELS[rail] ??')}: stage wrapper is crash-safe`);
  assert.match(SRC.sidebar, /has no live rail today/,
    'legacy drawer is documented as a fallback, not a live dock');
});

// ============================================================
// B — REAL RENDER + REAL CLICK HANDLERS
// ============================================================

test('B0 · harness boot: store + all shell components imported', () => {
  assert.ok(mod && mod.useStore && mod.Rail && mod.TitleBar && mod.StatusBar && mod.RightDock);
  assert.equal(typeof mod.shortcutSections, 'function');
});

test('B1 · shortcutSections exposes the live bindings in both languages', () => {
  const en = mod.shortcutSections(mod.makeT('en'));
  const flatEn = en.flatMap((s) => s.rows.map((r) => `${r.keys[0]} :: ${r.label}`));
  assert.ok(flatEn.some((r) => /\+P :: Quick open/.test(r)), 'EN: Ctrl+P Quick Open listed');
  const ar = mod.shortcutSections(mod.makeT('ar'));
  const flatAr = ar.flatMap((s) => s.rows.map((r) => r.label));
  assert.ok(flatAr.some((l) => /لوحة الأوامر/.test(l)), 'AR: command palette label localized');
});

test('B2 · SSR: every rail affordance renders with a real handler', () => {
  seedBase({ rail: 'home', previewOpen: false });
  const { html, els } = renderCapture(h(mod.Rail));
  for (const needle of ['aria-label="Home"', 'aria-label="Workspace"', 'aria-label="Sessions"', 'aria-label="Source control"', 'aria-label="Files · project files"', 'aria-label="More views"', 'aria-label="Search in files"', 'aria-label="Live preview"', 'aria-label="Toggle terminal"', 'aria-label="Settings"']) {
    assert.ok(html.includes(needle), `rail renders ${needle}`);
  }
  for (const el of els.filter((e) => e?.type === 'button')) {
    assert.equal(typeof el.props.onClick, 'function', 'every rail button has an onClick');
  }
  assert.match(html, /app-rail-bar-v13/, 'full-width top rail mounted');
});

test('B3 · rail navigation clears a live preview so the target is visible', () => {
  seedBase({ rail: 'home', previewOpen: true });
  const { els } = renderCapture(h(mod.Rail));
  click(byLabel(els, 'Sessions'));
  const st = mod.useStore.getState();
  assert.equal(st.rail, 'sessions', 'navigated to the clicked rail');
  assert.equal(st.previewOpen, false, 'preview overlay dismissed');
});

test('B4 · titlebar brand button reveals Workspace (not dead under preview)', () => {
  seedBase({ rail: 'home', previewOpen: true });
  const { els } = renderCapture(h(mod.TitleBar));
  click(byLabel(els, 'Open workspace panel'));
  const st = mod.useStore.getState();
  assert.equal(st.rail, 'workspace', 'brand button navigates to workspace');
  assert.equal(st.previewOpen, false, 'preview overlay dismissed');
});

test('B5 · titlebar controls are all wired', () => {
  seedBase({ rail: 'home', previewOpen: false });
  const { els } = renderCapture(h(mod.TitleBar));
  for (const label of ['Search or run a command…', 'Change AI model…', 'Toggle language AR/EN', 'Plans & upgrade', 'Settings', 'Focus mode', 'Minimize', 'Maximize', 'Close']) {
    assert.ok(byLabel(els, label), `titlebar control "${label}" is rendered`);
  }
  const radios = els.filter((e) => e?.props && e.props.role === 'radio');
  assert.equal(radios.length, 4, 'four permission radios');
  for (const r of radios) assert.equal(typeof r.props.onClick, 'function');
});

test('B6 · status chips navigate and clear preview', () => {
  seedBase({
    rail: 'home', previewOpen: true,
    git: { branch: 'main', changed: ['a.ts'], staged: [], untracked: [] },
    subagentProgress: { a: { label: 'a', done: 1, total: 1 } },
  });
  const { els } = renderCapture(h(mod.StatusBar));
  click(byTestId(els, 'status-git'));
  assert.equal(mod.useStore.getState().rail, 'git', 'git chip opens source control');
  assert.equal(mod.useStore.getState().previewOpen, false, 'preview dismissed');

  seedBase({ rail: 'home', previewOpen: true, subagentProgress: { a: { label: 'a', done: 1, total: 1 } } });
  const { els: els2 } = renderCapture(h(mod.StatusBar));
  click(byTestId(els2, 'status-subagents'));
  assert.equal(mod.useStore.getState().rail, 'subagents', 'subagent stamp opens Subagents');
  assert.equal(mod.useStore.getState().previewOpen, false, 'preview dismissed');
});

test('B7 · status language chip really toggles AR/EN', () => {
  seedBase({ rail: 'home', settings: { ...mod.useStore.getState().settings, language: 'en' } });
  const { els } = renderCapture(h(mod.StatusBar));
  click(byTestId(els, 'status-lang'));
  assert.equal(mod.useStore.getState().settings.language, 'ar', 'EN → AR');
  seedBase({ rail: 'home', settings: { ...mod.useStore.getState().settings, language: 'ar' } });
  const { els: els2 } = renderCapture(h(mod.StatusBar));
  click(byTestId(els2, 'status-lang'));
  assert.equal(mod.useStore.getState().settings.language, 'en', 'AR → EN');
});

test('B8 · status LED aria-label is localized', () => {
  seedBase({ rail: 'home', running: false });
  const en = renderCapture(h(mod.StatusBar)).html;
  assert.ok(/aria-label="agent idle"/.test(en), 'EN LED label');
  seedBase({ rail: 'home', running: true });
  const enRun = renderCapture(h(mod.StatusBar)).html;
  assert.ok(/aria-label="agent running"/.test(enRun), 'EN running LED label');
  const prev = mod.useStore.getState().settings;
  seedBase({ rail: 'home', running: false, settings: { ...prev, language: 'ar' } });
  const ar = renderCapture(h(mod.StatusBar)).html;
  assert.ok(/aria-label="الوكيل خامل"/.test(ar), 'AR LED label');
});

test('B9 · dock close returns Home and clears preview (no dead toggle)', () => {
  seedBase({ rail: 'workspace', previewOpen: true });
  const { els } = renderCapture(h(mod.RightDock, { rail: 'home' }));
  click(byTestId(els, 'dock-close'));
  const st = mod.useStore.getState();
  assert.equal(st.rail, 'home', 'X returns to Home');
  assert.equal(st.previewOpen, false, 'preview overlay dismissed');
});

test('B10 · command palette renders real commands with live handlers', () => {
  seedBase({ rail: 'home', previewOpen: false });
  let closed = 0;
  const { html, els } = renderCapture(h(mod.CommandPalette, { open: true, onClose: () => { closed++; } }));
  assert.match(html, /glass-strong anim-glass-pop/, 'palette opens on the shared curve');
  const buttons = els.filter((e) => e?.type === 'button' && e.props?.className?.includes?.('pal-row'));
  assert.ok(buttons.length >= 5, `suggested commands rendered (${buttons.length})`);
  for (const b of buttons) assert.equal(typeof b.props.onClick, 'function', 'palette row has a handler');
  const suggested = buttons.find((b) => textOf(b.props.children).includes('New session'));
  assert.ok(suggested, 'a real suggested command is present');
  click(suggested);
  assert.equal(closed, 1, 'non-keepOpen command closes the palette');
});

test('B11 · shortcuts overlay lists Quick Open and closes on X', () => {
  mod.useStore.setState({ shortcutsOpen: true });
  let closed = 0;
  // Override the store action for this render to observe the X handler.
  const prev = mod.useStore.getState().setShortcuts;
  mod.useStore.setState({ setShortcuts: (v) => { if (!v) closed++; return prev(v); } });
  const { html, els } = renderCapture(h(mod.ShortcutsOverlay));
  assert.match(html, /Quick open/, 'Ctrl+P row is visible');
  assert.match(html, /glass-strong/, 'panel mounted');
  const x = els.find((e) => e?.props && e.props['aria-label'] === 'Close');
  click(x);
  assert.ok(closed >= 1, 'close button calls setShortcuts(false)');
  mod.useStore.setState({ shortcutsOpen: false, setShortcuts: prev });
});
