// ============================================================
// v11.42 — SLASH COMMANDS INSIDE THE "+" MENU (source + SSR proof).
//
// The founder's request: "ادمجن هيك علامات كل سلاش إنه جوا الـ add". The
// always-visible mono slash-hint row was visual clutter. ALL advertised slash
// commands now live behind ONE "Commands / الأوامر" disclosure row inside the
// existing "+" popover, rendered from the canonical SLASH_COMMANDS registry.
//
// This guard proves, with exact file:line on failure:
//   1 · the + menu owns ONE commands group built from the REAL registry;
//   2 · every command has a real bilingual description (no blank/invented row);
//   3 · the old always-visible quick-hint row is hidden (no duplicate list),
//       while the CONTEXTUAL '/' typing menu is deliberately kept working;
//   4 · hairline / RTL-safe / bilingual / keyboard-accessible / motion-free;
//   5 · ZERO dead controls and a real composer-insert action on every row.
//
//   node --test --test-force-exit tests/v1142-slash-menu.test.mjs
// ============================================================
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const lineOf = (src, needle) => src.slice(0, Math.max(0, src.indexOf(needle))).split('\n').length;
const count = (src, re) => (src.match(re) || []).length;

const ATTACH = read('src/components/AttachMenu.tsx');
const MODES = read('src/lib/modes.ts');
const CSS = read('src/components/chat-final.css');
const COMPOSER = read('src/components/Composer.tsx');
const STORE = read('src/store.ts');

// ---------------------------------------------------------------------
// 1 · ONE commands group, rendered from the REAL registry
// ---------------------------------------------------------------------
test('1a · the + popover carries ONE "Commands" disclosure, not a second list', () => {
  assert.match(ATTACH, /export function SlashCommandsSubmenu/, 'expanded submenu is exported for SSR');
  assert.match(ATTACH, /SLASH_COMMANDS, SLASH_GROUP_LABELS, SLASH_LABELS/, 'submenu imports the canonical registry');
  assert.match(ATTACH, /SLASH_COMMANDS\.filter\(\(c\) => c\.group === gid\)/,
    `AttachMenu.tsx:${lineOf(ATTACH, 'SLASH_COMMANDS.filter')} :: rows come from the registry, not a copied list`);
  assert.match(ATTACH, /className="cf-attach-row cf-attach-cmds-toggle"/, 'single disclosure row');
  assert.match(ATTACH, /aria-expanded=\{commandsOpen\}/, 'disclosure exposes expanded state to AT');
  assert.match(ATTACH, /aria-controls="cf-attach-commands"/, 'disclosure points at the submenu it owns');
  assert.match(ATTACH, /commandsOpen && \(\s*<SlashCommandsSubmenu/, 'submenu renders only while expanded');
  assert.equal(count(ATTACH, /className="cf-attach-cmds"/g), 1, 'exactly one commands group');
  // v1137 contract: the four original + items keep their menuitem roles.
  assert.equal(count(ATTACH, /role="menuitem"/g), 4, 'the original four + items are unchanged');
});

test('1b · picking a row uses the REAL composer-insert action (review, never auto-send)', () => {
  assert.match(ATTACH, /const insertIntoComposer = useStore\(\(s\) => s\.insertIntoComposer\)/,
    `AttachMenu.tsx:${lineOf(ATTACH, 'insertIntoComposer')} :: real store action subscribed`);
  assert.match(ATTACH, /onClick=\{\(\) => onPick\(insert\)\}/, 'each submenu row is a wired button');
  assert.match(ATTACH, /onPick=\{\(cmd\) => \{\s*insertIntoComposer\(cmd\);\s*onClose\?\.\(\);/,
    'picking inserts the command and closes the popover');
  assert.match(STORE, /insertIntoComposer: \(text\) => \{[\s\S]{0,220}composerInsert: \{ text, seq:/,
    `store.ts:${lineOf(STORE, 'insertIntoComposer: (text)')} :: real, existing insert channel`);
  assert.ok(!/sendMessage\(.*spec\.cmd/.test(ATTACH), 'no accidental auto-send from the menu');
});

// ---------------------------------------------------------------------
// 2 · real bilingual labels for EVERY registered command
// ---------------------------------------------------------------------
test('2a · label registry is 1:1 with SLASH_COMMANDS (no missing/stale rows)', () => {
  const block = (MODES.match(/export const SLASH_COMMANDS: SlashSpec\[\] = \[[\s\S]*?\n\];/) || [''])[0];
  const cmds = [...block.matchAll(/cmd: '(\/[a-z0-9_-]+)'/g)].map((m) => m[1]);
  assert.ok(cmds.length >= 40, `registry has ${cmds.length} advertised commands`);
  const labels = (MODES.match(/export const SLASH_LABELS: Record<string, SlashLabel> = \{[\s\S]*?\n\};/) || [''])[0];
  for (const cmd of cmds) {
    const re = new RegExp(`'${cmd.replace('/', '\\/')}': \\{ en: '[^']+', ar: '[^']+' \\}`);
    assert.match(labels, re, `modes.ts:${lineOf(MODES, `'${cmd}':`)} :: ${cmd} has a real EN+AR description`);
  }
  const labelled = [...labels.matchAll(/'(\/[a-z0-9_-]+)': \{/g)].map((m) => m[1]);
  for (const cmd of labelled) assert.ok(cmds.includes(cmd), `stale label for unregistered ${cmd}`);
});

test('2b · every slash group has an Arabic + English caption', () => {
  const groups = (MODES.match(/export const SLASH_GROUP_LABELS: Record<SlashGroup, SlashLabel> = \{[\s\S]*?\n\};/) || [''])[0];
  for (const g of ['session', 'context', 'build', 'agent', 'app', 'panels', 'custom']) {
    assert.match(groups, new RegExp(`${g}: \\{ en: '[^']+', ar: '[^']+' \\}`), `${g} caption is bilingual`);
  }
  assert.match(ATTACH, /lang === 'ar' \? gl\.ar : gl\.en/, 'one caption language per render');
  // v11.42 final — labels are inline bilingual via L(label.en,label.ar) (the
  // i18n scanner mistook the dynamic key for a call site, so it was removed).
  assert.match(ATTACH, /desc\s*=\s*label\s*\?\s*L\(label\.en,\s*label\.ar\)/,
    'one language per command via inline bilingual label — no mixed sigils');
});

// ---------------------------------------------------------------------
// 3 · no duplicate visible list; contextual '/' typing is KEPT on purpose
// ---------------------------------------------------------------------
test('3a · the cluttered always-on quick-hint row is hidden, not duplicated', () => {
  assert.match(CSS, /\.chat-panel-root \.composer-keys \.sc-slashhint,\s*\.chat-panel-root \.composer-keys \.kbd-hint\[aria-hidden\] \{ display: none; \}/,
    `chat-final.css:${lineOf(CSS, '.sc-slashhint,')} :: the visible mono slash list is retired`);
  assert.match(COMPOSER, /const QUICK_COMMANDS = \[/, 'source constant stays (v1126 registry guard)');
  assert.equal(count(COMPOSER, /sc-slashhint/g), 1, 'the retired row is rendered in exactly one place (now hidden)');
});

test('3b · DECISION: typing "/" still shows contextual suggestions', () => {
  // Kept deliberately: it appears ONLY while the user is typing '/', so it is
  // not visual clutter, and removing it would break the real all-slash path.
  assert.match(COMPOSER, /const isSlash = isSlashMenuQuery\(value\)/, 'typing detection intact');
  assert.match(COMPOSER, /menu === 'slash' && \(/, 'contextual suggestion list intact');
  assert.match(MODES, /export function isSlashMenuQuery/, 'shared parser contract intact');
});

// ---------------------------------------------------------------------
// 4 · design law + no dead controls
// ---------------------------------------------------------------------
test('4a · hairline submenu, RTL-safe logical insets, no boxy card', () => {
  assert.match(CSS, /\.chat-panel-root \.cf-attach-cmds \{[\s\S]{0,120}border-block-start: 1px solid var\(--line-soft\)/,
    'hairline rule separates the commands group');
  const sub = (CSS.match(/\.chat-panel-root \.cf-attach-sub \{[\s\S]*?\}/) || [''])[0];
  assert.match(sub, /margin-inline-start:/, 'RTL-safe inline margin');
  assert.match(sub, /padding-inline-start:/, 'RTL-safe inline padding');
  assert.match(sub, /border-inline-start: 1px solid var\(--line-soft\)/, 'hairline inline rail');
  assert.ok(!/box-shadow|backdrop-filter|gradient|@keyframes cf-attach-sub/.test(sub), 'no card, blur or motion');
  assert.match(CSS, /\.chat-panel-root \.cf-attach-subcmd \{[\s\S]{0,220}direction: ltr;/, 'command tokens pin LTR');
});

test('4b · keyboard reachable; no dead controls in the edited JSX', () => {
  assert.match(ATTACH, /<button[\s\S]{0,400}aria-expanded=\{commandsOpen\}[\s\S]{0,400}onClick=\{\(\) => setCommandsOpen/,
    'disclosure is a real focusable button with a handler');
  assert.match(CSS, /\.cf-attach-subrow:focus-visible/, 'visible focus ring on submenu rows');
  const TAG = /<(button|input|select|textarea)\b/gi;
  const HANDLER = /\bon(?:Click|Change|Input|KeyDown|KeyUp|Submit|Focus|Blur|MouseDown)\s*=/i;
  const READONLY = /\breadOnly\b|\bdisabled\b|type\s*=\s*["']hidden["']/i;
  let m, n = 0; TAG.lastIndex = 0;
  while ((m = TAG.exec(ATTACH))) {
    n++;
    let depth = 0, end = m.index;
    for (let i = m.index; i < ATTACH.length; i++) {
      const c = ATTACH[i];
      if (c === '{') depth++;
      else if (c === '}') depth = Math.max(0, depth - 1);
      else if (c === '>' && depth === 0) { end = i + 1; break; }
    }
    const tag = ATTACH.slice(m.index, end);
    assert.ok(HANDLER.test(tag) || READONLY.test(tag),
      `AttachMenu.tsx:${lineOf(ATTACH, tag)} :: control #${n} is dead: ${tag.slice(0, 90).replace(/\s+/g, ' ')}`);
  }
  assert.ok(n >= 8, `${n} controls scanned (4 items + disclosure + close + submenu rows)`);
});

// ---------------------------------------------------------------------
// SSR · render the REAL components in both languages
// ---------------------------------------------------------------------
let React, renderToStaticMarkup, mod;

const EXTERNALS = ['electron', 'react', 'react-dom', 'zustand', 'lucide-react', '@xterm/xterm', '@xterm/addon-fit'];
const stubPlugin = {
  name: 'v1142-ssr-stubs',
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

  const outfile = join(ROOT, 'tests', '.v1142-slash-menu.bundle.cjs');
  await esbuild.build({
    stdin: {
      contents:
        "export { AttachMenu, AttachMenuPanel, SlashCommandsSubmenu } from './src/components/AttachMenu';"
        + "export { useStore } from './src/store';"
        + "export { SLASH_COMMANDS, SLASH_LABELS, SLASH_GROUP_LABELS } from './src/lib/modes';",
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile,
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
    external: EXTERNALS, plugins: [stubPlugin], logLevel: 'silent',
  });
  mod = require(outfile);
});

const h = (...args) => React.createElement(...args);
const setLang = (language) => mod.useStore.setState({
  settings: { ...mod.useStore.getState().settings, language },
});

test('SSR · + menu has the commands disclosure but no expanded list while closed', () => {
  setLang('en');
  const closed = renderToStaticMarkup(h(mod.AttachMenu, {
    onAttachImage() {}, onAttachDocument() {}, onPresets() {}, onRewind() {},
  }));
  assert.match(closed, /data-testid="chat-attach-menu"/, 'single + trigger');
  assert.ok(!closed.includes('role="menu"'), 'no popover while closed');

  const open = renderToStaticMarkup(h(mod.AttachMenuPanel, {
    onAttachImage() {}, onAttachDocument() {}, onPresets() {}, onRewind() {},
  }));
  assert.equal(count(open, /role="menuitem"/g), 4, 'four original + items');
  assert.ok(open.includes('Commands'), 'the single commands entry is in the + menu');
  assert.match(open, /aria-expanded="false"/, 'collapsed by default');
  assert.match(open, /aria-controls="cf-attach-commands"/, 'disclosure owns the submenu');
  assert.ok(!open.includes('cf-attach-sub'), 'no expanded duplicate list rendered');
  assert.ok(!open.includes('sc-slashhint'), 'no separate slash hint list in the popover');
});

test('SSR · expanded submenu lists EVERY real command with EN labels', () => {
  setLang('en');
  const html = renderToStaticMarkup(h(mod.SlashCommandsSubmenu, { onPick() {} }));
  assert.match(html, /id="cf-attach-commands"/, 'submenu id matches aria-controls');
  for (const spec of mod.SLASH_COMMANDS) {
    assert.ok(html.includes(spec.cmd), `command token rendered: ${spec.cmd}`);
    assert.ok(html.includes(mod.SLASH_LABELS[spec.cmd].en), `EN description rendered: ${spec.cmd}`);
  }
  assert.ok(html.includes('Session') && html.includes('Build &amp; review'), 'real group captions');
  assert.equal(count(html, /class="cf-attach-subrow"/g), mod.SLASH_COMMANDS.length,
    'one wired row per advertised command');
});

test('SSR · the same submenu is fully Arabic in AR (one language per render)', () => {
  setLang('ar');
  const html = renderToStaticMarkup(h(mod.SlashCommandsSubmenu, { onPick() {} }));
  for (const spec of mod.SLASH_COMMANDS) {
    assert.ok(html.includes(mod.SLASH_LABELS[spec.cmd].ar), `AR description rendered: ${spec.cmd}`);
  }
  assert.ok(html.includes('الجلسة') && html.includes('البناء والمراجعة'), 'AR group captions');
  const subRoot = /<div[^>]*id="cf-attach-commands"[^>]*>/.exec(html);
  assert.ok(subRoot && /aria-label="[^"]*[\u0600-\u06FF]/.test(subRoot[0]), 'AR submenu aria-label');
  setLang('en');
});

test('SSR · composer-insert action really exists at runtime', () => {
  assert.equal(typeof mod.useStore.getState().insertIntoComposer, 'function',
    'the action the submenu calls is registered in the real store');
  const before = mod.useStore.getState().composerInsert?.seq ?? 0;
  mod.useStore.getState().insertIntoComposer('/plan');
  const after = mod.useStore.getState().composerInsert?.seq ?? 0;
  assert.equal(after, before + 1, 'inserting bumps the real composerInsert sequence');
  assert.equal(mod.useStore.getState().composerInsert.text, '/plan', 'exact token handed to the composer');
});
