// ============================================================
// v11.37 — CHAT CONTROLS (ATTACH MENU + EFFORT) GUARD.
//
// Proves the founder's design request, with exact file:line on failure:
//   1 · the 3 former chat-panel buttons (attach image / prompt presets /
//      rewind-to-checkpoint) are COLLECTED behind ONE "+" trigger whose
//      small hairline popover holds those 3 + the NEW attach-document item;
//   2 · attach-document is wired to the REAL composer attach path (the same
//      attachFiles used by image/paste/drop) — no fabricated store channel;
//   3 · the EFFORT control uses the MODEL'S OWN two stages (standard/deep)
//      and writes through the REAL updateSettings store action (same as
//      /effort) — no invented levels, no decorative slider;
//   4 · hairline design, RTL-safe logical insets, both reduced-motion gates,
//      larger clear labels, and ZERO dead controls.
//
// SOURCE assertions + esbuild/SSR render of the new components (open-state
// panel bodies exported precisely so no test-only prop is needed).
//
//   node --test --test-force-exit tests/v1137-chat-controls.test.mjs
// ============================================================
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const COMPOSER = read('src/components/Composer.tsx');
const ATTACH = read('src/components/AttachMenu.tsx');
const EFFORT = read('src/components/EffortControl.tsx');
const CSS = read('src/components/chat-final.css');
const TYPES = read('shared/types.ts');
const STORE = read('src/store.ts');
const ENGINE = read('electron/agent/engine.ts');

const lineOf = (src, needle) => src.slice(0, Math.max(0, src.indexOf(needle))).split('\n').length;
const count = (src, re) => (src.match(re) || []).length;

// ---------------------------------------------------------------------
// 1 · COLLECTION behind one "+"
// ---------------------------------------------------------------------
test('1a · the three standalone toolbar buttons were REMOVED from Composer', () => {
  assert.ok(!/<History size=\{13\}/.test(COMPOSER), 'Composer.tsx: rewind icon button is gone');
  assert.ok(!/<IcImage size=\{13\}/.test(COMPOSER), 'Composer.tsx: image icon button is gone');
  assert.ok(!/onClick=\{togglePresets\}/.test(COMPOSER), 'Composer.tsx: presets icon button is gone');
  assert.match(COMPOSER, /import \{ AttachMenu \} from '\.\/AttachMenu'/, 'AttachMenu imported');
  assert.match(COMPOSER, /import \{ EffortControl \} from '\.\/EffortControl'/, 'EffortControl imported');
  assert.match(COMPOSER, /<AttachMenu[\s\S]{0,500}\/>/, 'one AttachMenu instance in the toolbar');
  assert.match(COMPOSER, /<EffortControl \/>/, 'one EffortControl instance on the chat');
});

test('1b · one "+" trigger opens a hairline popover with exactly FOUR items', () => {
  assert.match(ATTACH, /data-testid="chat-attach-menu"/, 'single "+" trigger exists');
  assert.match(ATTACH, /<IcPlus size=\{13\} \/>/, 'trigger uses the plus glyph');
  assert.match(ATTACH, /aria-expanded=\{open\}/, 'trigger exposes expanded state');
  assert.match(ATTACH, /role="menu"/, 'popover is a menu');
  assert.equal(count(ATTACH, /role="menuitem"/g), 4, 'exactly four popover items');
  for (const handler of ['onAttachImage', 'onAttachDocument', 'onPresets', 'onRewind']) {
    assert.match(ATTACH, new RegExp(`onClick=\\{${handler}\\}`), `${handler} is wired to its row`);
  }
  assert.match(ATTACH, /const pick = /, 'menu item selection closes the popover then runs the action');
  assert.match(ATTACH, /window\.addEventListener\('mousedown', onDown, true\)/, 'outside-click dismissal');
  assert.match(ATTACH, /e\.key === 'Escape'/, 'Escape dismissal');
});

test('1c · labels are single localized t(key, fallback) calls — no mixed sigils', () => {
  assert.match(ATTACH, /t\('chat\.attach\.document', L\('Attach document', 'إرفاق مستند'\)\)/,
    'attach-document label is one t() call with a localized fallback');
  assert.match(ATTACH, /t\('chat\.attachImage',/, 'attach-image label via t()');
  assert.match(ATTACH, /t\('presets\.title',/, 'prompt-presets label via existing t() key');
  assert.match(ATTACH, /t\('chat\.rewind',/, 'rewind label via existing t() key');
  assert.match(EFFORT, /t\(`chat\.effort\.\$\{level\}`/, 'effort value label via t()');
});

// ---------------------------------------------------------------------
// 2 · ATTACH DOCUMENT uses the real composer attach path
// ---------------------------------------------------------------------
test('2a · document picker routes to attachFiles (the image/paste/drop path)', () => {
  assert.match(COMPOSER, /const DOC_ACCEPT = \[/, 'document accept-list constant exists');
  for (const ext of ['.pdf', '.docx', '.txt']) {
    assert.ok(COMPOSER.includes(`'${ext}'`), `DOC_ACCEPT includes ${ext}`);
  }
  assert.match(
    COMPOSER,
    /ref=\{docRef\}[\s\S]{0,200}type="file"[\s\S]{0,120}accept=\{DOC_ACCEPT\}[\s\S]{0,200}void attachFiles\(e\.target\.files\)/,
    'document input onChange calls the SAME attachFiles as images',
  );
  assert.match(COMPOSER, /onAttachDocument=\{\(\) => docRef\.current\?\.click\(\)\}/,
    'the "+" menu item opens the document picker');
  assert.match(COMPOSER, /composerBridge\.attachFiles = \(files\) => void attachFiles\(files\)/,
    'panel-level drops still share the one attach path');
});

test('2b · non-image files become real @path mentions — no fabricated store channel', () => {
  assert.match(COMPOSER, /if \(f\.type\.startsWith\('image\/'\)\) \{[\s\S]{0,400}mentions\.push\(`@\$\{path \|\| f\.name\}`\)/,
    `Composer.tsx:${lineOf(COMPOSER, 'mentions.push(`@')} :: documents attach as @path mentions (real path on Electron)`);
  assert.match(STORE, /sendMessage: \(text: string, images\?: string\[\], displayAs\?: string\) => Promise<void>/,
    `store.ts:${lineOf(STORE, 'sendMessage: (text')} :: sendMessage still takes text/images only — honest handoff`);
  assert.ok(!/documentContent|attachments\?:|files\?: string\[\]/.test(STORE),
    'no invented document-content store field was added');
});

// ---------------------------------------------------------------------
// 3 · EFFORT uses the model's own stages + a REAL store action
// ---------------------------------------------------------------------
test('3a · exactly the model-owned two stages — no invented levels', () => {
  assert.match(TYPES, /effort\?: 'standard' \| 'deep';/,
    `shared/types.ts:${lineOf(TYPES, "effort?: 'standard'")} :: the model's own effort union`);
  assert.match(EFFORT, /export const EFFORT_LEVELS: readonly EffortLevel\[\] = \['standard', 'deep'\]/,
    'the control mirrors that union verbatim');
  assert.ok(!/'minimal'|'medium'|'high'|'max'|'ultra'/.test(EFFORT), 'no fabricated finer stages');
  assert.match(EFFORT, /export type EffortLevel = 'standard' \| 'deep';/, 'EffortLevel type is the two stages');
});

test('3b · draggable rail is precise and wired', () => {
  assert.match(EFFORT, /<input[\s\S]{0,200}type="range"[\s\S]{0,200}min=\{0\}[\s\S]{0,80}max=\{1\}[\s\S]{0,80}step=\{1\}/,
    'range input has exactly two stops (min 0, max 1, step 1)');
  assert.match(EFFORT, /onChange=\{\(e\) => onChange\(indexToEffort\(Number\(e\.target\.value\)\)\)\}/,
    'slider onChange maps to a real effort stage');
  assert.match(EFFORT, /value=\{idx\}/, 'slider is controlled by the store value');
  assert.match(EFFORT, /aria-valuetext=/, 'slider exposes the precise stage to assistive tech');
  assert.match(EFFORT, /<EffortSlider level=\{level\} onChange=\{setEffort\} \/>/,
    'the popover slider writes through setEffort');
});

test('3c · setEffort performs the SAME real store action as /effort', () => {
  assert.match(EFFORT, /const updateSettings = useStore\(\(s\) => s\.updateSettings\)/,
    'EffortControl subscribes to the real updateSettings action');
  assert.match(EFFORT, /updateSettings\(\{ agent: \{ \.\.\.\(agent \?\? \{\}\), effort: next \} \}\)/,
    `EffortControl.tsx:${lineOf(EFFORT, 'updateSettings({ agent:')} :: writes agent.effort via updateSettings`);
  assert.match(STORE, /updateSettings\(\{ agent: \{ \.\.\.agent, effort: next \} \}\)/,
    `store.ts:${lineOf(STORE, "effort: next } })")} :: /effort uses the identical action`);
  assert.match(ENGINE, /cfg\.effort === 'deep' \? baseIters \* 2 : baseIters/,
    `engine.ts:${lineOf(ENGINE, 'baseIters * 2')} :: deep effort really doubles the step budget`);
  assert.match(ENGINE, /effort: cfg\.effort === 'deep' \? 'deep' : 'standard'/,
    'engine forwards the same stage to the model — the control is not decorative');
});

test('3d · mapping helpers are exact', () => {
  assert.match(EFFORT, /export function effortToIndex\(level: EffortLevel \| undefined\): number \{\s*return level === 'deep' \? 1 : 0;/,
    'standard→0, deep→1');
  assert.match(EFFORT, /export function indexToEffort\(index: number\): EffortLevel \{\s*return index >= 1 \? 'deep' : 'standard';/,
    '0→standard, 1→deep, out-of-range clamps to standard');
});

// ---------------------------------------------------------------------
// 4 · DESIGN LAW + no dead controls
// ---------------------------------------------------------------------
test('4a · hairline popovers, RTL-safe logical insets, larger clear labels', () => {
  for (const cls of ['.cf-attach-pop', '.cf-effort-pop']) {
    const re = new RegExp(`${cls} \\{[\\s\\S]{0,500}?border: 1px solid var\\(--line-soft\\)`);
    assert.match(CSS, re, `${cls} has a single hairline border`);
  }
  assert.match(CSS, /\.cf-attach-pop \{[\s\S]{0,220}inset-block-end: calc\(100% \+ 8px\);[\s\S]{0,80}inset-inline-start: 0;/,
    'attach popover uses logical insets (RTL mirrors)');
  assert.match(CSS, /\.cf-effort-pop \{[\s\S]{0,220}inset-block-end: calc\(100% \+ 8px\);[\s\S]{0,80}inset-inline-start: 0;/,
    'effort popover uses logical insets (RTL mirrors)');
  assert.match(CSS, /\.cf-effort-rail \{[\s\S]{0,120}direction: ltr;/,
    'slider rail pins low→high reading direction even in RTL');
  assert.match(CSS, /\.cf-attach-row \{[\s\S]{0,260}font-size: 13\.5px;/, 'clear 13.5px menu labels (not shrunk)');
  assert.match(CSS, /\.cf-effort-trigger \{[\s\S]{0,260}font-size: 12\.5px;/, 'clear 12.5px effort chip');
  const attachPop = (CSS.match(/\.cf-attach-pop \{[\s\S]*?\}/) || [''])[0];
  const effortPop = (CSS.match(/\.cf-effort-pop \{[\s\S]*?\}/) || [''])[0];
  for (const [name, block] of [['attach', attachPop], ['effort', effortPop]]) {
    assert.match(block, /box-shadow: none/, `${name} popover: no box shadow`);
    assert.match(block, /backdrop-filter: none/, `${name} popover: no blur`);
    assert.ok(!/gradient/.test(block), `${name} popover: no gradient`);
  }
});

test('4b · BOTH reduced-motion signals are honoured', () => {
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,520}?\.cf-attach-row,[\s\S]{0,200}transition: none !important/,
    'OS preference gate settles the new controls');
  assert.match(CSS, /html\.reduce-motion \.chat-panel-root \.cf-attach-x,[\s\S]{0,420}transition: none !important/,
    'app preference gate settles the new controls');
  assert.ok(!/@keyframes cf-attach|@keyframes cf-effort/.test(CSS), 'no new keyframes — motion-free by construction');
});

test('4c · ZERO dead controls in the new/edited JSX', () => {
  const TAG = /<(button|input|select|textarea)\b/gi;
  const HANDLER = /\bon(?:Click|Change|Input|KeyDown|KeyUp|Submit|Focus|Blur|MouseDown)\s*=/i;
  const READONLY = /\breadOnly\b|\bdisabled\b|type\s*=\s*["']hidden["']/i;
  for (const [file, src] of [['AttachMenu.tsx', ATTACH], ['EffortControl.tsx', EFFORT], ['Composer.tsx', COMPOSER]]) {
    let m, n = 0; TAG.lastIndex = 0;
    while ((m = TAG.exec(src))) {
      n++;
      let depth = 0, end = m.index;
      for (let i = m.index; i < src.length; i++) {
        const c = src[i];
        if (c === '{') depth++;
        else if (c === '}') depth = Math.max(0, depth - 1);
        else if (c === '>' && depth === 0) { end = i + 1; break; }
      }
      const tag = src.slice(m.index, end);
      assert.ok(HANDLER.test(tag) || READONLY.test(tag),
        `${file} :: control #${n} has no handler: ${tag.slice(0, 90).replace(/\s+/g, ' ')}`);
    }
  }
});

// ---------------------------------------------------------------------
// SSR · render the real components (open-state panels exported)
// ---------------------------------------------------------------------
let React;
let renderToStaticMarkup;
let mod;

const EXTERNALS = ['electron', 'react', 'react-dom', 'zustand', 'lucide-react', '@xterm/xterm', '@xterm/addon-fit'];
const stubPlugin = {
  name: 'v1137-ssr-stubs',
  setup(build) {
    build.onResolve({ filter: /\?worker$/ }, () => ({ path: 'worker', namespace: 'ssm' }));
    build.onResolve({ filter: /(^|\/)lib\/monaco$/ }, () => ({ path: 'lib-monaco', namespace: 'ssm' }));
    build.onResolve({ filter: /^@monaco-editor\/react$/ }, () => ({ path: 'monaco-react', namespace: 'ssm' }));
    build.onResolve({ filter: /^lottie-web$/ }, () => ({ path: 'lottie', namespace: 'ssm' }));
    build.onResolve({ filter: /^qrcode$/ }, () => ({ path: 'qrcode', namespace: 'ssm' }));
    build.onLoad({ filter: /.*/, namespace: 'ssm' }, (a) => {
      let contents;
      switch (a.path) {
        case 'worker': contents = 'export default class SSMWorker {}'; break;
        case 'lib-monaco':
          contents = 'const monaco = { editor: { defineTheme(){}, createModel(){}, createDiffEditor(){} } };'
            + 'export { monaco }; export const monacoThemeFor = () => "surnia-dark";'
            + 'export const languageForPath = () => "plaintext";';
          break;
        case 'monaco-react':
          contents = 'const Nil = () => null; export const Editor = Nil; export const DiffEditor = Nil;'
            + 'export const loader = { config(){}, init(){ return Promise.resolve({}); } };';
          break;
        case 'lottie': contents = 'export const loadAnimation = () => ({ destroy(){}, play(){}, stop(){}, goToAndStop(){} });'; break;
        case 'qrcode': contents = 'export const toDataURL = () => Promise.resolve(""); export const toString = () => Promise.resolve("");'; break;
        default: contents = 'export default null;';
      }
      return { contents, loader: 'js' };
    });
  },
};

function installStubs() {
  const bridge = new Proxy({}, {
    get(_t, key) {
      if (key === 'then' || key === 'toJSON' || typeof key === 'symbol') return undefined;
      return () => Promise.resolve(undefined);
    },
  });
  const mq = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const el = () => ({
    style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    appendChild() {}, removeChild() {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {}, focus() {}, select() {}, remove() {}, click() {},
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
    querySelector: () => null, querySelectorAll: () => [], insertBefore() {}, scrollTo() {},
  });
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
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, scrollTo() {},
  };
  globalThis.document = {
    documentElement: el(), body: el(), head: el(),
    createElement: el, createElementNS: el, createTextNode: () => ({}),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, hidden: false, visibilityState: 'visible',
  };
  const def = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  def('localStorage', globalThis.window.localStorage);
  def('sessionStorage', globalThis.window.sessionStorage);
  def('matchMedia', mq);
  def('navigator', globalThis.window.navigator);
  def('location', globalThis.window.location);
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
}

before(async () => {
  installStubs();
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;

  const outfile = join(ROOT, 'tests', '.v1137-chat-controls.bundle.cjs');
  await esbuild.build({
    stdin: {
      contents:
        "export { AttachMenu, AttachMenuPanel } from './src/components/AttachMenu';"
        + "export { EffortControl, EffortSlider, EFFORT_LEVELS } from './src/components/EffortControl';"
        + "export { useStore } from './src/store';",
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile,
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
    external: EXTERNALS, plugins: [stubPlugin], logLevel: 'silent',
  });
  mod = require(outfile);
});

const h = (...args) => React.createElement(...args);

test('SSR · "+" trigger renders closed; the panel body renders all four items', () => {
  const closed = renderToStaticMarkup(h(mod.AttachMenu, {
    onAttachImage() {}, onAttachDocument() {}, onPresets() {}, onRewind() {},
  }));
  assert.match(closed, /data-testid="chat-attach-menu"/, 'the one "+" trigger is in the markup');
  assert.match(closed, /aria-expanded="false"/, 'closed by default');
  assert.ok(!closed.includes('role="menu"'), 'no items rendered while closed');

  const open = renderToStaticMarkup(h(mod.AttachMenuPanel, {
    onAttachImage() {}, onAttachDocument() {}, onPresets() {}, onRewind() {},
  }));
  assert.equal(count(open, /role="menuitem"/g), 4, 'four items in the open popover');
  for (const label of ['Attach image', 'Attach document', 'Prompt presets', 'Rewind to a checkpoint']) {
    assert.ok(open.includes(label), `item label present: ${label}`);
  }
});

test('SSR · effort trigger reads the real store value; slider has two real stops', () => {
  mod.useStore.setState({ settings: { ...mod.useStore.getState().settings, language: 'en', agent: { effort: 'deep' } } });
  const chip = renderToStaticMarkup(h(mod.EffortControl));
  assert.match(chip, /data-testid="chat-effort-trigger"/, 'effort control is on the chat');
  assert.ok(chip.includes('Effort') && chip.includes('deep'), 'trigger shows the store-backed stage');

  const rail = renderToStaticMarkup(h(mod.EffortSlider, { level: 'standard', onChange() {} }));
  assert.match(rail, /data-testid="chat-effort-slider"/, 'draggable slider rendered');
  assert.match(rail, /type="range"/, 'it is a real range input');
  assert.match(rail, /min="0"/, 'low stop = 0 (standard)');
  assert.match(rail, /max="1"/, 'high stop = 1 (deep)');
  assert.match(rail, /step="1"/, 'snaps exactly to the two model stages');
  assert.match(rail, /aria-valuetext="standard"/, 'precise stage exposed');
  assert.equal(count(rail, /cf-effort-stop/g), 2, 'two labelled stops');
});

test('SSR · component modules expose exactly the two model stages', () => {
  assert.deepEqual([...mod.EFFORT_LEVELS], ['standard', 'deep'], 'no extra effort stages at runtime');
});
