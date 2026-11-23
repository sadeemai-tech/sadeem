// ============================================================
// v11.42 — DNA INSIGHTS MOVED INTO THE DNA PAGE (real-data proof)
//
// The founder's confusion was real: v11.40 only RENAMED the Signature
// "autopsy" tab to "insights"; it never moved the view into DnaPanel.
// This test proves the move actually happened:
//   • DnaPanel SSR renders a collapsible, READ-ONLY insights section
//     with REAL findings from the real dna.ts writer + pure engine;
//   • SignaturePanel has exactly TWO tabs (REPLAY + COMPASS), no insights;
//   • autopsyDNA()/promptVisibleIds() still come from signatureFeatures.
//
//   node --test --test-force-exit tests/v1142-dna-insights.test.mjs
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

const TMP = join(tmpdir(), 'sadeem-v1142-dna-insights');
rmSync(TMP, { recursive: true, force: true });
const ENGINE = join(TMP, 'engine');
const UD = join(TMP, 'userData');
const WS = join(TMP, 'ws');
const BUNDLE = join(ENGINE, 'engine.cjs');
const UI_BUNDLE = join(ROOT, 'tests', '.v1142-dna-insights-ui.cjs');
mkdirSync(join(ENGINE, 'node_modules', 'electron'), { recursive: true });
mkdirSync(UD, { recursive: true });
mkdirSync(WS, { recursive: true });

writeFileSync(join(ENGINE, 'node_modules', 'electron', 'package.json'),
  JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(ENGINE, 'node_modules', 'electron', 'index.js'), `
const UD = ${JSON.stringify(UD)};
class StubWC { on(){} send(){} }
class StubBW { constructor(){ this.webContents = new StubWC(); } static getAllWindows(){ return []; } }
module.exports = {
  app: { getPath: () => UD, isReady: () => true, whenReady: async () => {}, on(){}, once(){}, quit(){}, setName(){}, setPath(){} },
  ipcMain: { handle(){}, on(){}, removeAllListeners(){} },
  BrowserWindow: StubBW, WebContents: StubWC,
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder(){} },
  Notification: { isSupported: () => false }, clipboard: { readText: () => '', writeText(){} },
  dialog: { showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => ({ canceled: true }) },
  screen: {}, nativeImage: { createFromBuffer: () => ({ toDataURL: () => '' }) },
};`);

const stubPlugin = {
  name: 'sadeem-v1142-stubs',
  setup(build) {
    build.onResolve({ filter: /\?worker$/ }, () => ({ path: 'worker', namespace: 'ssm' }));
    build.onResolve({ filter: /(^|\/)lib\/monaco$/ }, () => ({ path: 'lib-monaco', namespace: 'ssm' }));
    build.onResolve({ filter: /^@monaco-editor\/react$/ }, () => ({ path: 'monaco-react', namespace: 'ssm' }));
    build.onResolve({ filter: /^lottie-web$/ }, () => ({ path: 'lottie', namespace: 'ssm' }));
    build.onResolve({ filter: /^qrcode$/ }, () => ({ path: 'qrcode', namespace: 'ssm' }));
    build.onLoad({ filter: /.*/, namespace: 'ssm' }, (a) => {
      const contents =
        a.path === 'worker' ? 'export default class SSMWorker {}'
        : a.path === 'lib-monaco'
          ? 'export const monaco = { editor: { defineTheme(){}, createModel(){}, createDiffEditor(){} } };' +
            'export const monacoThemeFor = () => "surnia-dark"; export const languageForPath = () => "plaintext";'
        : a.path === 'monaco-react'
          ? 'const Nil = () => null; export const Editor = Nil; export const DiffEditor = Nil;' +
            'export const loader = { config(){}, init(){ return Promise.resolve({}); } };'
        : a.path === 'lottie'
          ? 'export const loadAnimation = () => ({ destroy(){}, play(){}, stop(){}, goToAndStop(){} }); export default { loadAnimation };'
        : a.path === 'qrcode'
          ? 'export const toDataURL = () => Promise.resolve("data:image/png;base64,"); export const toString = () => Promise.resolve(""); export default { toDataURL, toString };'
          : 'export default null;';
      return { contents, loader: 'js' };
    });
  },
};
const EXTERNALS = ['electron', 'react', 'react-dom', 'zustand', 'lucide-react', '@xterm/xterm', '@xterm/addon-fit'];

function installBrowserStubs() {
  const bridge = new Proxy({}, {
    get(_t, key) {
      if (key === 'then' || key === 'toJSON' || typeof key === 'symbol') return undefined;
      return (..._args) => Promise.resolve(undefined);
    },
  });
  const el = () => ({
    style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    appendChild() {}, removeChild() {}, setAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {}, focus() {}, remove() {},
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
    querySelector: () => null, querySelectorAll: () => [],
  });
  const mq = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.self = globalThis;
  globalThis.window = {
    surnia: bridge, kodex: bridge,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    matchMedia: mq,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    location: { href: 'http://localhost/', reload() {} },
    navigator: { userAgent: 'node-ssr', clipboard: { writeText: () => Promise.resolve() } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    confirm: () => true, alert() {}, prompt: () => null,
  };
  globalThis.document = {
    documentElement: el(), body: el(), head: el(),
    createElement: el, createElementNS: el, createTextNode: () => ({}),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, hidden: false, visibilityState: 'visible',
  };
  const def = (n, v) => Object.defineProperty(globalThis, n, { value: v, configurable: true, writable: true });
  def('localStorage', globalThis.window.localStorage);
  def('sessionStorage', globalThis.window.sessionStorage);
  def('matchMedia', mq);
  def('navigator', globalThis.window.navigator);
  def('location', globalThis.window.location);
  def('requestAnimationFrame', globalThis.window.requestAnimationFrame);
  def('cancelAnimationFrame', globalThis.window.cancelAnimationFrame);
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
}

let mod, ui, React, renderToStaticMarkup;
let realDna;

const PATTERN_TEXT = 'Prefer incremental edits over full rewrites in big files';

before(async () => {
  // ---- real engine: unchanged pure functions + real dna.ts writer ----
  await esbuild.build({
    stdin: {
      contents:
        "export { autopsyDNA, promptVisibleIds, AUTOPSY_PROMPT_RULE, SIGNATURE_FEATURES } from './electron/agent/signatureFeatures';" +
        "export { mergeExtraction, saveDNA, loadDNA, recordFeedback } from './electron/agent/dna';",
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLE,
    loader: { '.css': 'empty', '.svg': 'empty' },
    external: ['electron'], logLevel: 'silent',
  });
  mod = require(BUNDLE);

  const first = mod.mergeExtraction(mod.loadDNA(), {
    profile_additions: { expertise: ['typescript'], languages: ['ar', 'en'] },
    patterns_additions: [{ kind: 'workflow', text: PATTERN_TEXT }],
  });
  mod.saveDNA(first.dna);
  await mod.recordFeedback('preference', PATTERN_TEXT, 'user correction');
  const second = mod.mergeExtraction(mod.loadDNA(), {
    patterns_additions: [{ kind: 'workflow', text: PATTERN_TEXT }],
  });
  mod.saveDNA(second.dna);
  realDna = mod.loadDNA();

  // ---- real components, SSR stubs ----
  installBrowserStubs();
  await esbuild.build({
    stdin: {
      contents:
        "export { DnaPanel } from './src/components/panels/DnaPanel';" +
        "export { SignaturePanel } from './src/components/SignaturePanel';" +
        "export { useStore } from './src/store';",
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: UI_BUNDLE,
    loader: { '.css': 'empty', '.svg': 'dataurl' },
    external: EXTERNALS, plugins: [stubPlugin], logLevel: 'silent',
  });
  ui = require(UI_BUNDLE);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  for (const f of [BUNDLE, UI_BUNDLE]) { try { if (existsSync(f)) unlinkSync(f); } catch { /* gone */ } }
});

const textOf = (html) => html
  .replace(/<[^>]*>/g, '')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
  .replace(/&#x2F;/g, '/').replace(/&amp;/g, '&');

function seed(lang) {
  ui.useStore.setState({
    settings: {
      ...(ui.useStore.getState().settings ?? {}),
      language: lang, numerals: 'western',
      model: { provider: 'custom', model: 'm' },
    },
    wsPath: WS,
    dna: realDna,
    dnaLoading: false,
    running: false,
  });
}
const renderDna = () => renderToStaticMarkup(React.createElement(ui.DnaPanel));
const renderSig = (props = {}) => renderToStaticMarkup(React.createElement(ui.SignaturePanel, props));

// ============================================================
// 1 · the engine is still the real one (not a UI-only copy)
// ============================================================
test('engine: autopsyDNA + promptVisibleIds are unchanged real functions', () => {
  assert.equal(typeof mod.autopsyDNA, 'function');
  assert.equal(typeof mod.promptVisibleIds, 'function');
  const report = mod.autopsyDNA({ dna: realDna });
  const finding = report.findings.find((f) => f.text.includes(PATTERN_TEXT));
  assert.ok(finding, 'real stored pattern is explained');
  assert.equal(finding.sightings, 2);
  assert.equal(finding.confidence, 0.7, 'stored confidence, not a guess');
  const visible = mod.promptVisibleIds(realDna);
  assert.ok(visible instanceof Set && visible.size > 0, 'real prompt-selection rule returns ids');
  assert.equal(finding.promptVisible, visible.has(finding.id), 'UI mark agrees with the real prompt rule');
});

// ============================================================
// 2 · DnaPanel SSR — the section really moved here
// ============================================================
test('SSR EN: DnaPanel renders a collapsible insights section with REAL findings', () => {
  seed('en');
  const html = renderDna();
  const text = textOf(html);
  assert.ok(html.includes('dna-insights'), 'insights section is on the DNA page');
  assert.ok(html.includes('<details') && html.includes(' open') && html.includes('<summary'),
    'section is collapsible and expanded for SSR');
  assert.ok(html.indexOf('dna-insights') > html.indexOf('keyrow'),
    'placed AFTER the learned-patterns section');
  assert.ok(text.includes(PATTERN_TEXT), 'real learned fact rendered');
  assert.ok(text.includes('70%'), 'real stored confidence rendered');
  assert.ok(text.includes('your feedback'), 'real provenance label rendered');
  assert.ok(text.includes('typescript'), 'real declared profile value rendered');
  assert.ok(!/\p{Script=Arabic}/u.test(text), 'single language EN');

  // READ-ONLY: no control or write affordance anywhere inside the section.
  const section = html.slice(html.indexOf('<details'), html.indexOf('</details>') + '</details>'.length);
  assert.ok(section.length > 0, 'section markup isolated');
  assert.ok(!/<button\b/i.test(section), 'no buttons in the insights section');
  assert.ok(!/onClick=|onChange=/.test(section), 'no handlers in the insights section');
  assert.ok(!/Forget|Remove|Delete|dnaUpdate|dnaClear/i.test(section), 'no mutation affordance');
});

test('SSR AR: the moved section is RTL and Arabic-labelled', () => {
  seed('ar');
  const html = renderDna();
  const text = textOf(html);
  assert.ok(html.includes('dir="rtl"'), 'DNA page declares RTL');
  assert.ok(text.includes('رؤى الحمض'), 'Arabic section title');
  assert.ok(text.includes('ملاحظتك'), 'Arabic provenance label');
  assert.ok(text.includes('في الموجّه'), 'Arabic prompt-visibility label');
  for (const en of ['DNA INSIGHTS', 'your feedback', 'in prompt', 'no score']) {
    assert.ok(!text.includes(en), `no English UI copy in AR surface: ${en}`);
  }
});

// ============================================================
// 3 · SignaturePanel no longer owns an insights tab
// ============================================================
test('SSR: SignaturePanel has exactly REPLAY + COMPASS, no insights tab', () => {
  const panel = src('src/components/SignaturePanel.tsx');
  assert.ok(panel.includes("type Tab = 'trajectory' | 'compass';"), 'Tab union has two members');
  assert.ok(!panel.includes("'insights'"), 'no insights tab id in source');
  assert.ok(!panel.includes('DNA INSIGHTS'), 'no insights tab label in source');
  // Ignore the header comment that names the engine functions; assert the
  // rendered finding UI itself is gone.
  assert.ok(!/function FindingRow|<FindingRow|const WHY_LABEL|useMemo\(\(\) => autopsyDNA/.test(panel),
    'findings UI fully removed from SignaturePanel');

  seed('en');
  const html = renderSig();
  const text = textOf(html);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 2, 'two tab buttons rendered');
  assert.ok(text.includes('REPLAY') && text.includes('COMPASS'), 'the two remaining instruments');
  assert.ok(!text.includes('DNA INSIGHTS'), 'no insights tab on the Signature rail');
  assert.ok(!html.includes('DNA INSIGHTS'), 'no insights label anywhere in markup');
});

// ============================================================
// 4 · source guards — real imports, hairline art, no drift
// ============================================================
test('source guards: real imports, hairline grammar, reduced motion', () => {
  const dna = src('src/components/panels/DnaPanel.tsx');
  assert.match(dna, /autopsyDNA[\s\S]{0,200}promptVisibleIds[\s\S]{0,200}signatureFeatures/,
    'imports the real pure functions from signatureFeatures');
  assert.match(dna, /<details[\s\S]{0,220}dna-insights[\s\S]{0,120}\bopen\b/, 'collapsible, open by default');
  assert.ok(/dir=\{lang === 'ar' \? 'rtl' : 'ltr'\}/.test(dna), 'RTL declared on the panel root');

  const css = src('src/components/signature-art.css');
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /html\.reduce-motion \.dna-insights-caret/);
  assert.ok(!/box-shadow|linear-gradient|radial-gradient/.test(css),
    'hairline grammar: no boxy shadows or gradients');

  assert.deepEqual(mod.SIGNATURE_FEATURES.map((f) => f.id), ['trajectory', 'autopsy', 'compass'],
    'honest engine manifest still lists all three APIs (UI homes are separate)');
});
