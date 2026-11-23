// ============================================================
// SADEEM v11.42 — PREVIEW CLEAN LAYOUT (FOUNDER: "لا يتداخل ببعضه")
// ------------------------------------------------------------
// The founder reported that the Preview panel had things stacked on top of
// each other: a duplicated source label chip, a duplicated status LED
// ("two ready chips"), and a status/loading ribbon painted over the canvas
// and crowding the URL bar. Everything must be FLEX and have its own place.
//
// This test proves the fix on two levels:
//   1. SOURCE/CSS contract — one label, one LED, wrapping toolbar, loading in
//      normal flow, only the two mutually-exclusive diagnose overlays remain
//      as intentional z-layers, and every real control is still wired.
//   2. SSR of the REAL component (both languages) — exactly one status LED in
//      the markup, no duplicated source chip, error card still honest.
//
// Run: node --test --test-force-exit tests/v1142-preview-clean.test.mjs
// ============================================================
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1142-preview-clean-'));
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

const AREA = read('src', 'components', 'PreviewArea.tsx');
const CSS = read('src', 'components', 'preview.css');
const stripComments = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');
const code = stripComments(AREA);
const css = stripComments(CSS);

const block = (sheet, selector) => {
  const m = new RegExp(`\\${selector}\\s*\\{([\\s\\S]*?)\\}`).exec(sheet);
  assert.ok(m, `${selector} is styled`);
  return m[1];
};
const count = (s, re) => (s.match(re) || []).length;

// ------------------------------------------------------------
// 1 · NO OVERLAP — exactly one of each chrome element, in flow
// ------------------------------------------------------------
test('1a · source label is rendered ONCE (the duplicate static pill is gone)', () => {
  // One JSX interpolation of {sourceLabel}, inside the source-selector button.
  assert.equal(count(code, /\{sourceLabel\}/g), 1,
    'the source label appears once — the old duplicated glass-pill was removed');
  assert.match(AREA, /v11\.42 — OVERLAP FIX: the source label used to be rendered TWICE/,
    'the fix is documented at the exact site');
  assert.match(code, /className="glass-pill cursor-pointer !h-\[26px\] max-w-\[24ch\]"[\s\S]{0,900}\{sourceLabel\}/,
    'the surviving label is the real source selector with its onClick');
});

test('1b · a SINGLE status LED / "ready" chip (no second one in the URL field)', () => {
  assert.equal(count(code, /pv-led is-\$\{previewState\}/g), 1,
    'exactly one state-driven LED in the whole component');
  assert.match(code, /role="status"[\s\S]{0,200}className="pv-status"[\s\S]{0,120}pv-led is-\$\{previewState\}/,
    'the one LED belongs to the authoritative role=status chip');
  const urlField = /data-testid="pv-url-field"[\s\S]{0,320}?<input/.exec(code);
  assert.ok(urlField, 'URL field is present with the input immediately inside it');
  assert.doesNotMatch(urlField[0], /pv-led/, 'the URL field no longer repeats the status LED');
});

test('1c · toolbar is a wrapping flex row, never a fixed single 44px line', () => {
  const bar = block(css, '.pv2-bar');
  assert.match(bar, /flex-wrap:\s*wrap/, 'controls wrap instead of stacking on each other');
  assert.match(bar, /height:\s*auto/, 'height grows with the wrapped rows');
  assert.match(bar, /min-height:\s*44px/, 'keeps the 44px baseline at rest');
  assert.match(bar, /row-gap:\s*6px/, 'precise gap between wrapped rows');
  assert.match(bar, /border-bottom:\s*1px solid var\(--line\)/, 'still a 1px hairline');
  assert.doesNotMatch(bar, /position:\s*absolute/, 'the toolbar itself is not an overlay');
  const url = block(css, '.pv2-url');
  assert.match(url, /min-width:\s*220px/, 'URL field cannot collapse into its neighbours');
  assert.match(url, /flex:\s*1 1 240px/, 'URL field flexes with a real basis');
});

test('1d · loading cue is a FLEX BAND, not an absolute ribbon over the canvas', () => {
  const loading = block(css, '.pv2-loading');
  assert.doesNotMatch(loading, /position:\s*absolute/, 'no absolute stacking');
  assert.doesNotMatch(loading, /z-index/, 'no z-layer');
  assert.doesNotMatch(loading, /pointer-events:\s*none/, 'it is a real row, not a ghost overlay');
  assert.match(loading, /flex-shrink:\s*0/, 'it owns its height in the column');
  assert.match(loading, /border-bottom:\s*1px solid var\(--line-soft\)/, 'precise hairline underneath');
  // In the component the band sits BEFORE the canvas, inside the flow wrapper.
  const bandAt = AREA.indexOf('data-testid="pv-loading"');
  const canvasAt = AREA.indexOf('---- canvas ----');
  assert.ok(bandAt > 0 && canvasAt > bandAt, 'loading band precedes the canvas in normal flow');
  const canvasChunk = AREA.slice(canvasAt, AREA.indexOf('---- guest-page console drawer ----'));
  assert.doesNotMatch(canvasChunk, /data-testid="pv-loading"/, 'no loading overlay left inside the canvas');
  // calm 1px progress + both motion gates survive (v11.26 contract).
  assert.match(block(css, '.pv2-loading-track'), /height:\s*1px/, 'progress is 1px');
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /html\.reduce-motion/);
});

test('1e · only the two mutually-exclusive diagnose layers remain absolute', () => {
  assert.match(code, /pv2-failed absolute inset-0 z-10/, 'dead-page error card is an intentional z-layer');
  assert.match(code, /blankHint && !failed && !loading/, 'blank hint never stacks on failed/loading');
  assert.match(code, /absolute inset-x-0 top-3 z-10/, 'blank hint is confined to the canvas top');
  // No other absolute overlay is driven by store/preview state.
  const overlays = code.match(/(?:absolute|fixed)\s+inset[^"']*/g) || [];
  assert.ok(overlays.every((o) => /inset-0|inset-x-0|inset-0/.test(o)),
    'every remaining absolute surface is a bounded diagnose layer');
});

// ------------------------------------------------------------
// 2 · ALL REAL FUNCTIONALITY IS STILL PRESENT
// ------------------------------------------------------------
test('2a · URL bar + reload + open-external + close are still wired', () => {
  for (const [id, handler] of [
    ['pv-url', /onChange=\{\(e\) => setDraft\(e\.target\.value\)\}/],
    ['pv-reload', /onClick=\{reload\}/],
    ['pv-open-external', /onClick=\{openExternal\}/],
    ['pv-copy-url', /onClick=\{\(\) => void copyUrl\(\)\}/],
    ['pv-close', /onClick=\{\(\) => setPreviewOpen\(false\)\}/],
  ]) {
    assert.match(AREA, new RegExp(`data-testid="${id}"[\\s\\S]{0,320}?${handler.source}`), `${id} still works`);
  }
});

test('2b · viewports, history, console and the honest error card survive', () => {
  assert.match(code, /const DEVICES = \[\s*\{ id: 'full', icon: Monitor/, 'full viewport');
  assert.match(code, /\{ id: 'tablet', icon: Tablet, width: 820 \}/, 'tablet viewport');
  assert.match(code, /\{ id: 'mobile', icon: Smartphone, width: 400 \}/, 'mobile viewport');
  assert.match(code, /data-testid="pv-error-card"/, 'honest error card still renders');
  assert.match(code, /data-testid="pv-error-log-toggle"/, 'machine log stays behind a disclosure');
  assert.match(code, /role="menu"[\s\S]{0,160}absolute top-full mt-1\.5 z-40/, 'source/history menus are intentional dropdowns');
  assert.doesNotMatch(code, /setNotice\(|notice/, 'no second toast/notice surface was introduced');
});

// ------------------------------------------------------------
// 3 · SSR of the REAL component — no overlap in the actual markup
// ------------------------------------------------------------
globalThis.window = {
  surnia: new Proxy({}, {
    get(_t, key) {
      if (key === 'then' || typeof key === 'symbol') return undefined;
      return () => Promise.resolve(undefined);
    },
  }),
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
globalThis.cancelAnimationFrame = () => {};

const stubs = [{
  name: 'sadeem-v1142-ssr-stubs',
  setup(b) {
    b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, namespace: 'css-stub' }));
    b.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
    b.onResolve({ filter: /^monaco-editor$/ }, () => ({ path: 'monaco-editor', namespace: 'monaco-stub' }));
    b.onLoad({ filter: /.*/, namespace: 'monaco-stub' }, () => ({
      contents: 'module.exports = { editor: { defineTheme() {} }, KeyMod: {}, KeyCode: {} };', loader: 'js',
    }));
    b.onResolve({ filter: /^@monaco-editor\/react$/ }, () => ({ path: '@monaco-editor/react', namespace: 'editor-stub' }));
    b.onLoad({ filter: /.*/, namespace: 'editor-stub' }, () => ({
      contents: "const React = require('react'); module.exports = { Editor: () => React.createElement('div'), loader: { config() {} } };",
      loader: 'js',
    }));
    b.onResolve({ filter: /^zustand$/ }, () => ({ path: 'zustand', namespace: 'zustand-stub' }));
    b.onLoad({ filter: /.*/, namespace: 'zustand-stub' }, () => ({
      contents: `
        const React = require('react');
        const { createStore } = require('zustand/vanilla');
        const build = (createState) => {
          const api = createStore(createState);
          const snap = (selector) => () => (selector ? selector(api.getState()) : api.getState());
          const useBoundStore = (selector) => React.useSyncExternalStore(api.subscribe, snap(selector), snap(selector));
          Object.assign(useBoundStore, api);
          return useBoundStore;
        };
        exports.create = (createState) => (createState === undefined ? build : build(createState));
      `,
      loader: 'js', resolveDir: ROOT,
    }));
  },
}];

let harnessPromise = null;
function harness() {
  if (!harnessPromise) {
    harnessPromise = (async () => {
      const entry = join(tmp, 'entry.tsx');
      writeFileSync(entry,
        `import { PreviewArea } from ${JSON.stringify(join(ROOT, 'src', 'components', 'PreviewArea.tsx'))};\n` +
        `import { useStore } from ${JSON.stringify(join(ROOT, 'src', 'store.ts'))};\n` +
        `export { PreviewArea, useStore };\n`);
      const out = join(ROOT, 'tests', `.tmp-v1142-preview-clean-${process.pid}.cjs`);
      await esbuild.build({
        entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'cjs',
        plugins: stubs,
        external: ['electron', '@xterm/xterm', '@xterm/addon-fit', 'react', 'react-dom', 'react-dom/server'],
        logLevel: 'silent',
      });
      try { return require(out); } finally { try { unlinkSync(out); } catch { /* gone */ } }
    })();
  }
  return harnessPromise;
}

const BASE_STATUS = {
  dev: { running: false, state: 'idle', lines: [], agentSources: [], agentUrls: [] },
  static: { running: false },
  ports: [],
};
async function render(language, extra = {}) {
  const { PreviewArea, useStore } = await harness();
  useStore.setState({
    wsPath: join(tmp, 'ws'), previewOpen: true, previewAuto: null,
    previewUrl: '', previewError: null, previewStatus: BASE_STATUS, previewWs: '',
    settings: { ...useStore.getState().settings, language, preview: { console: false } },
    ...extra,
  });
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  return renderToStaticMarkup(React.createElement(PreviewArea));
}

test('3a · SSR: exactly one status LED in the real markup, no duplicated source chip', async () => {
  const html = await render('en', { previewUrl: 'http://127.0.0.1:5173' });
  assert.equal(count(html, /class="pv-led /g), 1, 'a single LED is announced');
  assert.match(html, /class="pv-status"/, 'the one authoritative status chip is present');
  assert.equal(count(html, />Detected targets<\/span>/g), 1,
    'the source label text appears exactly once, inside the selector');
  assert.match(html, /data-testid="pv-url-field"/);
  assert.match(html, /data-testid="pv-reload"/);
  assert.match(html, /data-testid="pv-open-external"/);
  assert.match(html, /role="status"/);
});

test('3b · SSR: Arabic UI renders the same single-status structure', async () => {
  const html = await render('ar', { previewUrl: 'http://127.0.0.1:5173' });
  assert.equal(count(html, /class="pv-led /g), 1, 'one LED in Arabic too');
  assert.match(html, /class="pv-status"/);
  assert.match(html, /data-testid="pv-url"/);
});

test('3c · SSR: the honest error card is still one localized surface', async () => {
  for (const language of ['en', 'ar']) {
    const html = await render(language, {
      // The honest start-error card lives in the empty state (no page URL).
      previewUrl: '',
      previewError: { reason: 'startFailed', detail: 'machine (402)' },
      previewStatus: { ...BASE_STATUS, dev: { ...BASE_STATUS.dev, state: 'error', lines: ['{"code":402}'] } },
    });
    assert.equal(count(html, /data-testid="pv-error-card"/g), 1, `${language}: one error card`);
    assert.match(html, /data-testid="pv-error-log-toggle"/, `${language}: raw log stays disclosed`);
    assert.equal(count(html, /class="pv-led /g), 1, `${language}: still one status LED`);
  }
});
