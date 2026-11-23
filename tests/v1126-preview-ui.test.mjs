import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// ============================================================
// v11.26 — AUTO-OPEN PREVIEW UI (founder: "كل ما ينتهي من بناء ملف يفتح
// المعاينة تبع التطبيق"). A3 owns the trigger; this locks the SURFACE:
//   1. precise 1px toolbar (URL + reload + open externally), every button wired
//   2. calm loading state (1px hairline, no spinner/glow)
//   3. localized error card: prose dir="auto", raw log behind a disclosure,
//      ONE surface per failure, no duplicate toast, no raw JSON/English in AR
//   4. a visible "built / preview ready" cue — a hairline band, NOT a card
//
//   node --test --test-force-exit tests/v1126-preview-ui.test.mjs
// ============================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1126-preview-ui-'));
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

const AREA = read('src', 'components', 'PreviewArea.tsx');
const CSS = read('src', 'components', 'preview.css');

// ------------------------------------------------------------
// 1 · SOURCE CONTRACT — toolbar / cue / states / no dead buttons
// ------------------------------------------------------------
test('UI1: precise 1px toolbar carries URL + reload + open externally with real handlers', () => {
  assert.match(AREA, /className="pv-toolbar pv2-bar" data-testid="pv-toolbar"/, 'hairline toolbar is rendered');
  assert.match(AREA, /className="pv-urlfield pv2-url mx-1" data-testid="pv-url-field"/, 'URL field is 1px/polished');
  assert.match(AREA, /data-testid="pv-url"[\s\S]{0,120}onChange=\{\(e\) => setDraft\(e\.target\.value\)\}/, 'URL input is editable');
  assert.match(AREA, /data-testid="pv-reload"[\s\S]{0,220}onClick=\{reload\}/, 'reload button calls reload()');
  assert.match(AREA, /data-testid="pv-open-external"[\s\S]{0,260}onClick=\{openExternal\}/, 'open-externally calls openExternal()');
  assert.match(AREA, /data-testid="pv-close"[\s\S]{0,220}onClick=\{\(\) => setPreviewOpen\(false\)\}/, 'close calls setPreviewOpen(false)');
  assert.match(CSS, /\.pv2-bar \{[\s\S]*?border-bottom: 1px solid var\(--line\)/, 'toolbar baseline is a 1px token hairline');
  assert.match(CSS, /\.pv2-url \{[\s\S]*?border: 1px solid var\(--line\)/, 'URL field is a 1px token hairline');
});

test('UI1: every action button has a wired onClick — no dead controls', () => {
  const wired = [
    [ 'pv-copy-url', /onClick=\{\(\) => void copyUrl\(\)\}/ ],
    [ 'pv-reload', /onClick=\{reload\}/ ],
    [ 'pv-open-external', /onClick=\{openExternal\}/ ],
    [ 'pv-close', /onClick=\{\(\) => setPreviewOpen\(false\)\}/ ],
    [ 'pv-error-log-toggle', /onClick=\{\(\) => setErrorLogOpen\(\(v\) => !v\)\}/ ],
    [ 'pv-error-dismiss', /onClick=\{\(\) => \{[\s\S]{0,120}dismissPreviewError\(\)/ ],
    [ 'pv-built-dismiss', /onClick=\{\(\) => setBuiltDismissedSeq\(/ ],
    [ 'pv-failed-log-toggle', /onClick=\{\(\) => setFailedLogOpen\(\(v\) => !v\)\}/ ],
    [ 'pv-failed-reload', /onClick=\{reload\}/ ],
    [ 'pv-failed-back', /onClick=\{\(\) => \{ setFailed\(null\)/ ],
  ];
  for (const [id, handler] of wired) {
    const re = new RegExp(`data-testid="${id}"[\\s\\S]{0,320}?${handler.source}`);
    assert.match(AREA, re, `${id} is wired to a real handler`);
  }
});

test('UI1: loading is a calm 1px hairline; built cue is a hairline band, NOT a boxed card', () => {
  assert.match(AREA, /data-testid="pv-loading"/, 'calm loading surface is rendered');
  assert.match(CSS, /\.pv2-loading-track \{[\s\S]*?height: 1px/, 'loading progress is 1px');
  assert.match(AREA, /data-testid="pv-built-cue"/, 'built / preview-ready cue is rendered');
  assert.match(AREA, /preview\.built', lang === 'ar' \? 'تم البناء — المعاينة جاهزة'/, 'cue has an Arabic fallback');

  const band = /\.pv2-built \{([\s\S]*?)\}/.exec(CSS);
  assert.ok(band, '.pv2-built is styled');
  assert.doesNotMatch(band[1], /box-shadow|border-radius|background:\s*var\(--panel\)/, 'no card shadow / panel fill');
  assert.match(band[1], /border-bottom: 1px solid var\(--line-soft\)/, 'one hairline rule');
  assert.match(band[1], /padding: 0 12px/, 'whitespace, not a box');

  // The design law: no glow / gradient / blur anywhere in the new sheet.
  assert.doesNotMatch(CSS, /linear-gradient|radial-gradient|backdrop-filter|filter:\s*blur|box-shadow:\s*0\s+0/, 'no glow/gradient/blur');
  assert.doesNotMatch(CSS, /@keyframes pv2-breathe \{[\s\S]*?translate|scale/, 'loading animation is opacity-only');
  assert.match(CSS, /prefers-reduced-motion: reduce/, 'OS motion gate');
  assert.match(CSS, /html\.reduce-motion/, 'app motion gate');
});

test('UI1: showBuiltCue follows the sequenced auto-open request, not a fabricated flag', () => {
  assert.match(AREA, /previewAuto\.seq !== builtDismissedSeq/, 'each auto-open seq is shown once');
  assert.match(AREA, /!shownError[\s\S]{0,120}previewState !== 'error'[\s\S]{0,120}previewState !== 'loading'/, 'cue never paints over an error or a load');
  assert.match(AREA, /window\.setTimeout\(\(\) => setBuiltDismissedSeq\(seq\), 7000\)/, 'cue retires on its own');
});

// ------------------------------------------------------------
// 2 · ERROR / LOG CONTRACT — localized prose, machine text disclosed
// ------------------------------------------------------------
test('UI2: error prose is dir="auto"; raw log is only behind a localized disclosure', () => {
  assert.match(AREA, /data-testid="pv-error-card"/, 'one error surface exists');
  assert.match(AREA, /dir="auto" data-testid="pv-error-reason"/, 'reason prose is dir="auto"');
  assert.match(AREA, /dir="auto" data-testid="pv-error-detail"/, 'detail prose is dir="auto"');
  assert.doesNotMatch(AREA, /shownError\.detail[\s\S]{0,300}?dir="ltr"/, 'raw LTR log is never inline prose');

  // The dev-state fallback used to dump dev.lines into the localized detail.
  assert.doesNotMatch(AREA, /dev\.lines\.slice\(-3\)\.join\('\\n'\)/, 'raw dev stdout is not injected into prose');

  assert.match(AREA, /data-testid="pv-error-log-toggle"[\s\S]{0,700}?t\('preview\.devLog'/, 'disclosure label is localized');
  assert.match(AREA, /errorLogOpen && \([\s\S]{0,260}?pv-error-log[\s\S]{0,80}?dir="ltr"/, 'raw log renders only when disclosed, dir="ltr"');
  assert.match(CSS, /\.pv2-error \{[\s\S]*?box-shadow: none/, 'error card uses hairlines, no inset glow');
});

test('UI2: no duplicate toast surface for a preview failure', () => {
  // The error card dismisses through the preview-error slice only; it never
  // posts a chat notice. Store-owned single-surface behaviour is covered by
  // v1123-store-errors; here we lock the UI not re-announcing it.
  const start = AREA.indexOf('{shownError && (');
  const dismissed = AREA.indexOf('dismissPreviewError()', start);
  const end = AREA.indexOf('            )}', dismissed);
  assert.ok(start > -1 && dismissed > start && end > dismissed, 'error card block located');
  const card = AREA.slice(start, end);
  assert.doesNotMatch(card, /notice|toast|setNotice/, 'error card never raises a second notice/toast');
  assert.match(card, /dismissPreviewError\(\)/, 'dismiss clears the single surface');
});

// ------------------------------------------------------------
// 3 · SSR — the real component, both languages, real store state
// ------------------------------------------------------------
globalThis.window = {
  surnia: new Proxy(
    {},
    {
      get(_t, key) {
        if (key === 'then' || typeof key === 'symbol') return undefined;
        return () => Promise.resolve(undefined);
      },
    },
  ),
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };
globalThis.cancelAnimationFrame = () => {};

const stubs = [
  {
    name: 'sadeem-v1126-ssr-stubs',
    setup(b) {
      b.onResolve({ filter: /\.css$/ }, (a) => ({ path: a.path, namespace: 'css-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: 'module.exports = {};', loader: 'js' }));
      b.onResolve({ filter: /^monaco-editor$/ }, () => ({ path: 'monaco-editor', namespace: 'monaco-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'monaco-stub' }, () => ({
        contents: `module.exports = { editor: { defineTheme() {} }, KeyMod: {}, KeyCode: {} };`,
        loader: 'js',
      }));
      b.onResolve({ filter: /^@monaco-editor\/react$/ }, () => ({ path: '@monaco-editor/react', namespace: 'editor-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'editor-stub' }, () => ({
        contents: `const React = require('react'); module.exports = { Editor: () => React.createElement('div'), loader: { config() {} } };`,
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
            const useBoundStore = (selector) =>
              React.useSyncExternalStore(api.subscribe, snap(selector), snap(selector));
            Object.assign(useBoundStore, api);
            return useBoundStore;
          };
          exports.create = (createState) => (createState === undefined ? build : build(createState));
        `,
        loader: 'js',
        resolveDir: ROOT,
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
        `import { PreviewArea } from ${JSON.stringify(join(ROOT, 'src', 'components', 'PreviewArea.tsx'))};\n` +
          `import { useStore } from ${JSON.stringify(join(ROOT, 'src', 'store.ts'))};\n` +
          `export { PreviewArea, useStore };\n`,
      );
      const out = join(ROOT, 'tests', `.tmp-v1126-preview-ui-${process.pid}.cjs`);
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
        try { unlinkSync(out); } catch { /* already gone */ }
      }
    })();
  }
  return harnessPromise;
}

const hasArabic = (s) => /\p{Script=Arabic}/u.test(String(s ?? ''));
const hasEnglishProse = (s) => /[A-Za-z][a-z]+\s+[A-Za-z][a-z]+\s+[A-Za-z][a-z]+/.test(String(s ?? ''));

const BASE_STATUS = {
  dev: { running: false, state: 'idle', lines: [], agentSources: [], agentUrls: [] },
  static: { running: false },
  ports: [],
};
const seed = (useStore, language, extra = {}) =>
  useStore.setState({
    wsPath: join(tmp, 'ws'),
    previewOpen: true,
    previewAuto: null,
    previewUrl: '',
    previewError: null,
    previewStatus: BASE_STATUS,
    previewWs: '',
    settings: { ...useStore.getState().settings, language, preview: { console: false } },
    ...extra,
  });
const render = async (useStore, language, extra) => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  seed(useStore, language, extra);
  return renderToStaticMarkup(React.createElement((await harness()).PreviewArea));
};

// Raw machine output a real failed dev server can emit.
const RAW_LOG = '{"error":{"message":"spawn ENOENT","code":402}}';

test('UI3 SSR: polished toolbar with wired URL / reload / external controls is in the markup', async () => {
  const { useStore } = await harness();
  const html = await render(useStore, 'en', { previewUrl: 'http://127.0.0.1:5173' });
  assert.match(html, /data-testid="pv-toolbar"/);
  assert.match(html, /data-testid="pv-url-field"/);
  assert.match(html, /data-testid="pv-url"/);
  assert.match(html, /data-testid="pv-reload"/);
  assert.match(html, /data-testid="pv-open-external"/);
  assert.match(html, /data-testid="pv-close"/);
  assert.match(html, /role="status"/, 'a live status is announced');
});

test('UI3 SSR: built / preview-ready cue appears after an auto-open request, in the selected language', async () => {
  const { useStore } = await harness();
  const auto = { seq: 7, kind: 'dev', runtime: 'npm', ws: join(tmp, 'ws') };

  const en = await render(useStore, 'en', { previewUrl: 'http://127.0.0.1:5173', previewAuto: auto });
  assert.match(en, /data-testid="pv-built-cue"/);
  assert.match(en, /Built — preview ready/);
  assert.match(en, /data-testid="pv-built-dismiss"/, 'cue has a real dismiss control');

  const ar = await render(useStore, 'ar', { previewUrl: 'http://127.0.0.1:5173', previewAuto: auto });
  assert.match(ar, /data-testid="pv-built-cue"/);
  const arCue = /<span class="pv2-built-text" dir="auto">([^<]*)<\/span>/.exec(ar);
  assert.ok(arCue && hasArabic(arCue[1]), 'Arabic UI speaks Arabic');
  assert.ok(!hasEnglishProse(arCue[1]), 'no English prose in the Arabic cue');

  // no auto-open request → no fabricated "ready" celebration
  const idle = await render(useStore, 'en', { previewUrl: 'http://127.0.0.1:5173' });
  assert.doesNotMatch(idle, /data-testid="pv-built-cue"/);
});

test('UI3 SSR: localized error card — one surface, prose dir="auto", raw log withheld', async () => {
  const { useStore } = await harness();
  for (const language of ['en', 'ar']) {
    const html = await render(useStore, language, {
      previewError: { reason: 'startFailed', detail: language === 'ar' ? 'رصيد غير كافٍ (402)' : 'Insufficient balance (402)' },
      previewStatus: { ...BASE_STATUS, dev: { ...BASE_STATUS.dev, state: 'error', lines: [RAW_LOG] } },
    });
    assert.match(html, /data-testid="pv-error-card"/, 'card rendered');
    assert.match(html, /dir="auto" data-testid="pv-error-reason"/, 'reason is localized prose');
    assert.match(html, /dir="auto" data-testid="pv-error-detail"/, 'detail is localized prose');
    assert.match(html, /data-testid="pv-error-log-toggle"/, 'disclosure present');
    assert.match(html, /aria-expanded="false"/, 'disclosure starts closed');
    assert.doesNotMatch(html, /data-testid="pv-error-log"/, 'raw log is NOT rendered inline');
    assert.doesNotMatch(html, /spawn ENOENT|openrouter_credits|&quot;error&quot;/, 'no raw JSON / server prose anywhere');
    assert.match(html, /data-testid="pv-error-dismiss"/, 'dismiss control wired');

    const card = html.match(/data-testid="pv-error-card"[\s\S]{0,2200}/)[0];
    if (language === 'ar') {
      assert.ok(hasArabic(card), 'Arabic UI is Arabic');
      assert.doesNotMatch(card, /Preview could not start|Dev server output/, 'no English prose in the Arabic card');
    } else {
      assert.match(card, /Preview could not start/);
      assert.doesNotMatch(card, /\p{Script=Arabic}/u, 'English UI is English');
    }
  }
});
