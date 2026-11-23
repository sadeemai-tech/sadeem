// ============================================================
// v11.34 — FOUNDER UI LAYOUT: buttonised plan strip + wide chat + bigger type.
//
// Source + runtime guards for the three complaints:
//   1. "update plan / todo is great but too wide — give me a small button"
//      → the full-width `.todo-card` is replaced by a compact, boxless
//        `.plan-toggle` <button> with a real onClick that expands the FULL
//        todo list. Bilingual (EN/AR), hairline art, tabular count.
//   2. "double-click reset works but I can't widen enough; right dominates"
//      → the chat can now reach ~80% of the window (280px work-area floor),
//        double-click resets to a balanced 55/45, and the separator is
//        keyboard-resizable (arrows / PageUp-Down / Home / End / Enter).
//   3. "increase the font in the left chat panel"
//      → chat body / tool rows / reasoning move one readable step, scoped to
//        .chat-panel-root; display serif + tabular mono numerals untouched.
//
//   node --test --test-force-exit tests/v1134-ui-layout.test.mjs
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const { execFileSync } = require('node:child_process');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, '$1 ');

const P = {
  chat: 'src/components/ChatPanel.tsx',
  app: 'src/App.tsx',
  shell: 'src/components/shell.css',
  type: 'src/components/type-scale.css',
};
const SRC = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, read(v)]));
const CODE = Object.fromEntries(Object.entries(SRC).map(([k, v]) => [k, stripComments(v)]));

// ---------------------------------------------------------------------
// Runtime harness — bundle ChatPanel + the two pure layout helpers.
// ---------------------------------------------------------------------
const BUNDLE = join(ROOT, 'tests', '.v1134-ui-layout.bundle.cjs');
let mod, React, renderToStaticMarkup;

before(() => {
  globalThis.window = {
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    setTimeout: () => 1, clearTimeout() {},
    innerWidth: 1600, innerHeight: 900,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    dispatchEvent() {},
  };
  globalThis.Event = class { constructor(type) { this.type = type; } };
  globalThis.document = {
    documentElement: { classList: { contains: () => false }, dataset: {}, style: {}, removeAttribute() {} },
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {} }),
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN,
    '--bundle', '--platform=node', '--format=cjs',
    '--loader:.css=empty',
    '--external:electron', '--external:react', '--external:react/jsx-runtime',
    '--external:react-dom', '--external:react-dom/server', '--external:zustand',
    '--external:lucide-react', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
    `--outfile=${BUNDLE}`,
  ], {
    cwd: ROOT,
    stdio: 'pipe',
    input:
      "export { ChatPanel, effectiveChatMax, balancedChatWidth } from './src/components/ChatPanel';" +
      "export { useStore } from './src/store';\n",
  });
  mod = require(BUNDLE);
  React = require('react');
  const useSES = React.useSyncExternalStore;
  React.useSyncExternalStore = (subscribe, getSnapshot) => useSES(subscribe, getSnapshot, getSnapshot);
  React.useLayoutEffect = React.useEffect; // SSR silence
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup;
});

after(() => {
  try { unlinkSync(BUNDLE); } catch { /* gone */ }
});

// ============================================================
// 1 · THE PLAN STRIP IS A BUTTON (complaint 1)
// ============================================================
test('1a · PlanCard renders a real <button> with onClick + aria expand state', () => {
  const chat = CODE.chat;
  assert.match(chat, /function PlanCard\(/, 'PlanCard still exists');
  assert.match(chat, /className="plan-toggle"[\s\S]{0,240}onClick=\{\(\) => setOpen\(\(v\) => !v\)\}/,
    'compact toggle is a button with a real onClick');
  assert.match(chat, /<button\s+type="button"\s+className="plan-toggle"/, 'it is a BUTTON element');
  assert.match(chat, /aria-expanded=\{open\}/, 'aria-expanded reflects open state');
  assert.match(chat, /aria-controls="plan-detail"/, 'button controls the detail region');
});

test('1b · no data is lost: full todo list is rendered when expanded', () => {
  const chat = CODE.chat;
  assert.match(chat, /\{open && \(\s*<div id="plan-detail" className="plan-detail" role="status">\s*<TodoRows todos=\{todos\} \/>/,
    'expanded detail renders the complete TodoRows');
  assert.match(chat, /plan-toggle-count tnum[^>]*>\{done\}\/\{todos\.length\}/,
    'collapsed button still exposes done/total as tabular numbers');
  assert.match(chat, /t\('tool\.todo_write'\)/, 'bilingual label uses the existing i18n key');
  assert.match(chat, /langAr\s*\n?\s*\? `إظهار الخطة/, 'Arabic title string is present');
  assert.match(chat, /: `Show plan · \$\{done\}\/\$\{todos\.length\} steps complete`/, 'English title string is present');
  assert.doesNotMatch(chat, /className="todo-card anim-in"/, 'old wide boxed strip is gone');
});

test('1c · hairline art, no box (shell.css)', () => {
  const shell = stripComments(SRC.shell);
  const block = shell.match(/\.plan-toggle \{([\s\S]*?)\}/);
  assert.ok(block, '.plan-toggle is styled in shell.css');
  assert.match(block[1], /border-bottom:\s*1px solid var\(--line\)/, 'single hairline rule');
  assert.match(block[1], /border:\s*0/, 'no enclosing border');
  assert.match(block[1], /background:\s*transparent/, 'no fill box');
  assert.match(block[1], /box-shadow:\s*none/, 'no shadow');
  assert.match(shell, /\.plan-toggle-count \{[\s\S]{0,200}font-variant-numeric:\s*tabular-nums/,
    'tabular numbers retained on the count');
  assert.match(shell, /\.plan-toggle:focus-visible \{ outline:\s*1px solid var\(--acc\)/, 'keyboard focus visible');
});

// ============================================================
// 2 · WIDE CHAT + BALANCED RESET + KEYBOARD HANDLE (complaint 2)
// ============================================================
test('2a · effective max derived from viewport, not the 720px store clamp', () => {
  const chat = CODE.chat;
  assert.match(chat, /CHAT_MAX_FRACTION = 0\.8/, '80% ceiling token');
  assert.match(chat, /WORK_MIN_PX = 280/, 'work-area floor token');
  assert.match(chat, /const cap = Math\.min\(Math\.floor\(vw \* CHAT_MAX_FRACTION\), vw - WORK_MIN_PX\)/,
    'drag cap is window-relative with a work-area floor');
  assert.match(chat, /const next = Math\.min\(effectiveChatMax\(\), Math\.max\(CHAT_MIN, Math\.round\(nextRaw\)\)\)/,
    'applyWidth uses the effective max, not CHAT_MAX');
  assert.doesNotMatch(chat, /Math\.min\(CHAT_MAX, Math\.max\(CHAT_MIN, Math\.round\(startWidth \+ delta\)\)\)/,
    'the old hard 720px drag clamp is gone');
});

test('2b · double-click / Enter reset to a balanced 55/45 split', () => {
  const chat = CODE.chat;
  assert.match(chat, /CHAT_BALANCE_FRACTION = 0\.55/, '55% balance token');
  assert.match(chat, /Math\.round\(vw \* CHAT_BALANCE_FRACTION\)/, 'reset math uses the balance fraction');
  assert.match(chat, /onDoubleClick=\{resetWidth\}/, 'double-click still resets');
  assert.match(chat, /e\.key === 'Enter' \|\| e\.key === ' '\) next = balancedChatWidth\(\)/,
    'Enter / Space also reset from the keyboard');
});

test('2c · resize handle is keyboard-accessible', () => {
  const chat = CODE.chat;
  assert.match(chat, /role="separator"[\s\S]{0,400}aria-valuenow=\{effectiveWidth\}/, 'aria value exposed');
  assert.match(chat, /aria-valuemin=\{CHAT_MIN\}/, 'aria min');
  assert.match(chat, /aria-valuemax=\{effectiveChatMax\(\)\}/, 'aria max');
  assert.match(chat, /tabIndex=\{0\}/, 'separator is focusable');
  assert.match(chat, /onKeyDown=\{onResizeKeyDown\}/, 'keydown handler wired');
  assert.match(chat, /e\.key === 'ArrowRight'/, 'arrow keys resize');
  assert.match(chat, /e\.key === 'End'\) next = effectiveChatMax\(\)/, 'End jumps to max width');
  assert.match(SRC.shell, /\.chat-resizer:focus-visible \{[\s\S]{0,40}outline:\s*1px solid var\(--acc\)/, 'focus style exists');
});

test('2d · App publishes constraints and re-clamps on viewport change', () => {
  const app = CODE.app;
  assert.match(app, /root\.dataset\.chatWorkMin = '280'/, 'work-area floor published');
  assert.match(app, /root\.dataset\.chatMaxPct = '80'/, 'max fraction published');
  assert.match(app, /root\.dataset\.chatBalancePct = '55'/, 'balance fraction published');
  assert.match(app, /dispatchEvent\(new Event\('surnia:chat-reclamp'\)\)/, 'viewport change dispatches reclamp');
  assert.match(CODE.chat, /addEventListener\('surnia:chat-reclamp', reclamp\)/, 'panel listens for reclamp');
});

test('2e · runtime math: wide window ≥80%, 55/45 reset, 280px work floor', () => {
  const maxOf = (w) => {
    window.innerWidth = w;
    return mod.effectiveChatMax();
  };
  const balOf = (w) => {
    window.innerWidth = w;
    return mod.balancedChatWidth();
  };
  assert.equal(maxOf(1600), 1280, '1600px → 80%');
  assert.equal(maxOf(1280), 1000, '1280px → min(80%, work floor) = 1000px (~78%)');
  assert.equal(maxOf(800), 520, '800px → work-area floor keeps 280px');
  assert.ok(maxOf(1600) / 1600 >= 0.78, 'chat can reach at least 78–80%');
  assert.equal(balOf(1600), 880, '55% of 1600');
  assert.equal(balOf(1280), 704, '55% of 1280');
  assert.equal(balOf(800), 440, '55% of 800');
  window.innerWidth = 1600;
});

test('2f · SSR: collapsed button renders; full card does not', () => {
  const T = 1700000000000;
  mod.useStore.setState({
    wsPath: ROOT,
    settings: { language: 'en', numerals: 'western', model: { provider: 'custom', model: 'm' } },
    session: {
      id: 's1', title: 't', workspace: ROOT, messages: [], createdAt: T, updatedAt: T,
      messageCount: 0, totalTokens: 0, totalCostUsd: 0,
    },
    todos: [
      { id: '1', content: 'First step', status: 'completed' },
      { id: '2', content: 'Second step', status: 'in_progress' },
    ],
    pendingApproval: null, running: false, planProposal: null,
  });
  const html = renderToStaticMarkup(React.createElement(mod.ChatPanel));
  assert.match(html, /class="plan-toggle"/, 'compact plan button is in the DOM');
  assert.match(html, /aria-expanded="false"/, 'collapsed by default');
  assert.match(html, /1\/2/, 'tabular done/total count visible while collapsed');
  assert.doesNotMatch(html, /class="todo-card/, 'old wide boxed strip is not rendered');
  assert.match(html, /role="separator"/, 'separator is rendered');
  assert.match(html, /tabindex="0"/, 'separator is focusable in the DOM');
  assert.match(html, /aria-valuemax="1280"/, 'aria max reflects the viewport-derived ceiling');
  assert.match(html, /aria-valuenow="400"/, 'default width exposed to assistive tech');
});

// ============================================================
// 3 · ONE READABLE TYPE STEP, SCOPED (complaint 3)
// ============================================================
test('3a · chat body, tool rows and reasoning all step up', () => {
  const type = stripComments(SRC.type);
  assert.match(type, /--chat-base:\s*15\.5px/, 'message body 14 → 15.5px');
  assert.match(type, /--chat-ui:\s*15px/, 'tool-row / label chrome 14.6 → 15px');
  assert.match(type, /--chat-meta:\s*13\.5px/, 'meta floor 13 → 13.5px');
  assert.match(type, /html \.chat-panel-root \.kb-think-body \{[\s\S]{0,160}font-size:\s*15\.5px/,
    'reasoning stream 14 → 15.5px');
  assert.match(type, /\.sc18-tverb \{[\s\S]{0,120}font-size:\s*10\.5px/, 'tool verb caps 9.5 → 10.5px');
  assert.match(type, /\.sc18-res-pre \{[\s\S]{0,120}font-size:\s*12\.5px/, 'tool result mono 11.5 → 12.5px');
});

test('3b · display serif + tabular mono numerals survive; scope stays in chat', () => {
  const type = stripComments(SRC.type);
  assert.match(type, /font-family:\s*var\(--font-display-serif\)/, 'Instrument Serif display untouched');
  assert.doesNotMatch(type, /font-family:\s*[^;]*mono[^;]*;/, 'no mono family reassignment');
  assert.match(type, /html \.chat-panel-root/, 'every chat override is html-scoped');
  assert.ok(!/\.monaco-editor|\.xterm|\.md table/.test(type), 'editors / tables out of scope');
  // focus-mode contract from v1124 must remain untouched by the type step.
  assert.ok(!type.includes('data-focus'), 'type-scale.css still owns no focus rules');
});
