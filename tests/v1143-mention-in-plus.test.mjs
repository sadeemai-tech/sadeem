// ============================================================
// v11.43 — FILE MENTIONS MOVED INTO THE "+" POPOVER (source + SSR proof).
//
// The founder's repeat complaint: "كم مرة حكيت لك شايف أوامر السلاش وأوامر
// هذيك الدائرة اللي بنص إيه تبعت المنشن فايل ... تنقلها داخل الزائد ... وجوا
// التبويبة تبعت الاتاتش ايمج والقصة هاي." The '@' file-mention list used to
// float over the middle of the chat panel. It now lives INSIDE the existing
// "+" popover, beside attach-image / commands / prompts / rewind.
//
// This guard proves, with exact file:line on failure:
//   1 · the floating '@' list is GONE from Composer (no popup over chat);
//   2 · the SAME capped tree + the SAME @path insert action are reused —
//       no new IPC, no store channel, no auto-send;
//   3 · the "+" popover owns ONE "Mention file" disclosure + real file rows;
//   4 · hairline / RTL-safe / bilingual / keyboard-reachable / motion-free;
//   5 · ZERO dead controls and a real action on every wired control;
//   6 · SSR: the file list renders inside .cf-attach-pop in BOTH languages,
//       collapsed by default, with no duplicate floating list anywhere.
//
//   node --test --test-force-exit tests/v1143-mention-in-plus.test.mjs
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

const COMPOSER = read('src/components/Composer.tsx');
const ATTACH = read('src/components/AttachMenu.tsx');
const CSS = read('src/components/chat-final.css');
const STORE = read('src/store.ts');

// ---------------------------------------------------------------------
// 1 · the visible '@' menu is GONE from the chat panel
// ---------------------------------------------------------------------
test('1a · Composer no longer renders a floating mention menu', () => {
  assert.ok(!/menu === 'mention'/.test(COMPOSER),
    `Composer.tsx :: no 'mention' menu state (was the popup over chat)`);
  assert.ok(!/mentionItems|applyMention|mentionMatch/.test(COMPOSER),
    'Composer.tsx :: the old floating-list data/action helpers are retired');
  assert.ok(!/glass-menu absolute bottom-full mb-2 inset-x-0 max-h-56/.test(COMPOSER),
    `Composer.tsx :: the absolute '@' glass popup is removed from the card`);
  assert.ok(!/'slash' \| 'mention' \| null/.test(COMPOSER),
    'Composer.tsx :: menu union is slash-only');
  const floating = COMPOSER.slice(COMPOSER.indexOf('composer-card composer-card-v13'), COMPOSER.indexOf('drop highlight overlay'));
  assert.ok(!/mentionItems\.map|applyMention\(|max-h-56|IcFolderOpen/.test(floating),
    `Composer.tsx:${lineOf(COMPOSER, 'composer-card composer-card-v13')} :: no mention list between card open and drop overlay`);
});

test('1b · slash commands STILL live in the "+" (v1142 untouched)', () => {
  assert.match(COMPOSER, /<AttachMenu[\s\S]{0,700}mentionPaths=\{mentionPaths\}/,
    'the same + instance carries the new file props');
  assert.match(ATTACH, /SlashCommandsSubmenu/, 'v1142 slash submenu still in the + popover');
  assert.equal(count(ATTACH, /role="menuitem"/g), 4, 'the original four menuitems are unchanged');
});

// ---------------------------------------------------------------------
// 2 · real list + real insert action reused (no IPC, no new channel)
// ---------------------------------------------------------------------
test('2a · the capped workspace tree is the one true mention source', () => {
  assert.match(COMPOSER, /const MAX_MENTION_FILES = 200;/, 'real cap constant stays in Composer');
  assert.match(COMPOSER, /flattenTree\(fileTree, wsPath, out\)/,
    `Composer.tsx:${lineOf(COMPOSER, 'flattenTree(fileTree, wsPath, out)')} :: same flattened tree as before`);
  assert.match(COMPOSER, /mentionPaths=\{mentionPaths\}/,
    'the capped list is handed to the + popover, not re-derived elsewhere');
  assert.ok(!/const MAX_MENTION_FILES|flattenTree\(|useStore\(\(s\) => s\.fileTree\)/.test(ATTACH),
    'AttachMenu.tsx :: no second file source — it only renders what Composer passes');
});

test('2b · picking a row calls the composer\'s OWN @path insert, never send/IPC', () => {
  assert.match(COMPOSER, /const insertMention = \(rel: string\) => \{/,
    `Composer.tsx:${lineOf(COMPOSER, 'const insertMention')} :: real insert action`);
  assert.ok(COMPOSER.includes('update(`${head}@${rel} `)'),
    'inserts the exact @path token through the existing update() path');
  assert.match(COMPOSER, /onMentionFile=\{insertMention\}/,
    'the + menu is wired to that very action');
  assert.match(ATTACH, /onMentionFile\?\.\(rel\);[\s\S]{0,80}onClose\?\.\(\);/,
    `AttachMenu.tsx:${lineOf(ATTACH, 'onMentionFile?.(rel)')} :: insert then close — review, no auto-send`);
  const mentionSubmenuSrc = ATTACH.slice(
    ATTACH.indexOf('export function MentionFilesSubmenu'),
    ATTACH.indexOf('export function AttachMenuPanel'),
  );
  assert.ok(!/sendMessage|insertIntoComposer|composerInsert/.test(mentionSubmenuSrc),
    'the mention submenu adds no send and no fabricated store insert channel');
  assert.ok(!/window\.surnia|ipcRenderer|\bapi\./.test(ATTACH),
    'AttachMenu.tsx :: no new IPC (the file picker is a Composer concern only)');
  assert.ok(!/documentContent|files\?: string\[\]/.test(STORE), 'no invented store field for mentions');
});

// ---------------------------------------------------------------------
// 3 · ONE disclosure + real wired rows in the + popover
// ---------------------------------------------------------------------
test('3a · a single "Mention file" disclosure owns the file submenu', () => {
  assert.match(ATTACH, /export function MentionFilesSubmenu/, 'submenu exported for SSR');
  assert.equal(count(ATTACH, /className="cf-attach-mentions"/g), 1, 'exactly one mention group');
  assert.match(ATTACH, /className="cf-attach-row cf-attach-mentions-toggle"/, 'hairline disclosure row');
  assert.match(ATTACH, /aria-expanded=\{mentionsOpen\}/, 'expanded state exposed to AT');
  assert.match(ATTACH, /aria-controls="cf-attach-mentions"/, 'disclosure points at the submenu it owns');
  assert.match(ATTACH, /id="cf-attach-mentions"/, 'submenu id matches aria-controls');
  assert.match(ATTACH, /mentionsOpen && \(\s*<MentionFilesSubmenu/, 'submenu renders only while expanded');
  assert.match(ATTACH, /onChange=\{\(e\) => setQuery\(e\.target\.value\)\}/, 'real fuzzy filter input');
  assert.match(ATTACH, /files\.filter\(\(f\) => f\.rel\.toLowerCase\(\)\.includes\(q\)\)/,
    'the old "@query contains" filter is preserved as a local filter');
  assert.match(ATTACH, /onClick=\{\(\) => onPick\(f\.rel\)\}/, 'each file row is a wired button');
  assert.match(ATTACH, /data-testid="chat-mention-file-row"/, 'rows are SSR-detectable');
});

test('3b · bilingual + RTL: one language per render, paths pinned LTR', () => {
  assert.match(ATTACH, /t\('chat\.mention\.file\.v1143', L\('Mention file', 'استشهاد بملف'\)\)/,
    'disclosure label is a single localized fallback (no i18n edit needed)');
  assert.match(ATTACH, /t\('chat\.mention\.files\.v1143', L\('Workspace files', 'ملفات مساحة العمل'\)\)/,
    'submenu aria-label is bilingual');
  assert.match(ATTACH, /dir="ltr"/, 'relative paths are pinned LTR inside RTL rows');
  assert.match(ATTACH, /f\.dir \? \(/, 'folders and files keep their distinct real icons');
});

// ---------------------------------------------------------------------
// 4 · design law + zero dead controls
// ---------------------------------------------------------------------
test('4a · hairline continuation, RTL-safe, no card/blur/motion', () => {
  assert.match(CSS, /\.chat-panel-root \.cf-attach-mentions \{[\s\S]{0,120}border-block-start: 1px solid var\(--line-soft\)/,
    `chat-final.css:${lineOf(CSS, '.cf-attach-mentions {')} :: hairline rule`);
  assert.match(ATTACH, /className="cf-attach-sub cf-attach-mentions-sub"/,
    'the file submenu reuses the RTL-safe hairline submenu geometry from 12c');
  const sub = (CSS.match(/\.chat-panel-root \.cf-attach-sub \{[\s\S]*?\}/) || [''])[0];
  assert.match(sub, /margin-inline-start:/, 'RTL-safe inline margin');
  assert.match(sub, /border-inline-start: 1px solid var\(--line-soft\)/, 'hairline inline rail');
  const mention = (CSS.match(/\.chat-panel-root \.cf-attach-mentions-sub \{[\s\S]*?\}/) || [''])[0];
  assert.ok(!/box-shadow|backdrop-filter|gradient/.test(mention), 'no card, blur or gradient');
  assert.ok(!/@keyframes cf-attach-mention/.test(CSS), 'no new keyframes — motion-free by construction');
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,620}\.chat-panel-root \.cf-attach-mention-row/,
    'OS reduced-motion gate settles the new rows');
  assert.match(CSS, /html\.reduce-motion \.chat-panel-root \.cf-attach-mentions-filter,[\s\S]{0,220}transition: none !important/,
    'app reduced-motion gate settles the new filter/rows');
});

test('4b · ZERO dead controls in the edited source', () => {
  const TAG = /<(button|input|select|textarea)\b/gi;
  const HANDLER = /\bon(?:Click|Change|Input|KeyDown|KeyUp|Submit|Focus|Blur|MouseDown)\s*=/i;
  const READONLY = /\breadOnly\b|\bdisabled\b|type\s*=\s*["']hidden["']/i;
  for (const [file, src] of [['AttachMenu.tsx', ATTACH], ['Composer.tsx', COMPOSER]]) {
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
        `${file}:${lineOf(src, m.index)} :: control #${n} is dead: ${tag.slice(0, 90).replace(/\s+/g, ' ')}`);
    }
    assert.ok(n > 0, `${file} :: controls scanned`);
  }
});

// ---------------------------------------------------------------------
// SSR · render the REAL + components (both languages, open + closed)
// ---------------------------------------------------------------------
let React, renderToStaticMarkup, mod;

const EXTERNALS = ['electron', 'react', 'react-dom', 'zustand', 'lucide-react', '@xterm/xterm', '@xterm/addon-fit'];
const stubPlugin = {
  name: 'v1143-ssr-stubs',
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

const FILES = [
  { rel: 'src/components/Composer.tsx', dir: false },
  { rel: 'src/components/AttachMenu.tsx', dir: false },
  { rel: 'src/components/panels', dir: true },
];

const setLang = (language) => mod.useStore.setState({
  settings: { ...mod.useStore.getState().settings, language },
});

before(async () => {
  installStubs();
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect;
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;

  const outfile = join(ROOT, 'tests', '.v1143-mention-in-plus.bundle.cjs');
  await esbuild.build({
    stdin: {
      contents:
        "export { AttachMenu, AttachMenuPanel, MentionFilesSubmenu } from './src/components/AttachMenu';"
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
const panelProps = () => ({
  onAttachImage() {}, onAttachDocument() {}, onPresets() {}, onRewind() {},
  mentionPaths: FILES, onMentionFile() {},
});

test('SSR · closed + popover has the disclosure but NO expanded file list', () => {
  setLang('en');
  const closed = renderToStaticMarkup(h(mod.AttachMenu, panelProps()));
  assert.match(closed, /data-testid="chat-attach-menu"/, 'single + trigger');
  assert.ok(!closed.includes('role="menu"'), 'no popover while closed');

  const open = renderToStaticMarkup(h(mod.AttachMenuPanel, panelProps()));
  assert.match(open, /class="cf-attach-pop" role="menu"/, 'the file list lives in THIS popover');
  assert.equal(count(open, /role="menuitem"/g), 4, 'four original + items unchanged');
  assert.ok(/Mention (a workspace )?file/i.test(open), 'the mention disclosure is in the + menu');
  assert.match(open, /aria-expanded="false"/, 'collapsed by default');
  assert.match(open, /aria-controls="cf-attach-mentions"/, 'disclosure owns the submenu');
  assert.ok(!open.includes('chat-mention-files'), 'no expanded duplicate list rendered');
  assert.ok(!open.includes('Composer.tsx'), 'no floating file list rendered beside the chat');
});

test('SSR · expanded submenu lists the REAL paths with a live filter (EN)', () => {
  setLang('en');
  const html = renderToStaticMarkup(h(mod.MentionFilesSubmenu, { files: FILES, onPick() {} }));
  assert.match(html, /id="cf-attach-mentions"/, 'submenu id matches aria-controls');
  assert.match(html, /class="[^"]*cf-attach-sub cf-attach-mentions-sub"/, 'hairline submenu container');
  assert.match(html, /type="search"/, 'real filter control');
  for (const f of FILES) assert.ok(html.includes(f.rel), `real path rendered: ${f.rel}`);
  assert.equal(count(html, /data-testid="chat-mention-file-row"/g), FILES.length,
    'one wired row per real file/folder');
  assert.ok(html.includes('Workspace files') && html.includes('Filter files'), 'EN labels');
  assert.ok(html.includes('3 files'), 'EN count');
});

test('SSR · the SAME submenu is fully Arabic in AR (one language per render)', () => {
  setLang('ar');
  const html = renderToStaticMarkup(h(mod.MentionFilesSubmenu, { files: FILES, onPick() {} }));
  assert.ok(html.includes('ملفات مساحة العمل') && html.includes('تصفية الملفات'), 'AR labels');
  assert.ok(html.includes('3 ملف'), 'AR count');
  const root = /<div[^>]*id="cf-attach-mentions"[^>]*>/.exec(html);
  assert.ok(root && /aria-label="[^"]*[\u0600-\u06FF]/.test(root[0]), 'AR submenu aria-label');
  for (const f of FILES) assert.ok(html.includes(f.rel), `AR render keeps path ${f.rel}`);
  setLang('en');
});

test('SSR · empty tree shows an honest empty state, not a dead control', () => {
  setLang('en');
  const html = renderToStaticMarkup(h(mod.MentionFilesSubmenu, { files: [], onPick() {} }));
  assert.ok(html.includes('No matching files'), 'honest empty state');
  assert.equal(count(html, /data-testid="chat-mention-file-row"/g), 0, 'no phantom rows');
  assert.match(html, /type="search"/, 'filter stays wired even when empty');
});
