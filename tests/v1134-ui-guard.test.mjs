// ============================================================
// SADEEM v11.34 — UI LAYOUT GUARD (V7 verification)
// DIAGNOSIS + TEST ONLY. This file NEVER edits application source.
//
// V7 is three founder UI changes. This guard encodes the contract that must
// hold AFTER V7 lands, and prints an exact `file:line` for every failure:
//
//   (a) The wide "update plan / todo" strip is collapsed into a SMALL
//       CLICKABLE BUTTON with a real onClick handler — not a wide always-on
//       row of TodoRows + meter.
//       1. SOURCE: a button + real handler, wide-row content gated.
//       2. SSR: the plan component renders ONE button, no todo-meter / rows.
//
//   (b) The resizer max lets chat reach ~75-80% of the window (>=75%),
//       double-click resets to a BALANCED width, and the handle is keyboard
//       accessible (tabIndex + onKeyDown + ARIA value + bilingual hint).
//
//   (c) Chat font sizes are INCREASED vs the documented baseline
//       (--chat-base 14px / --chat-ui 13px / --chat-meta 12px, source px),
//       while the DISPLAY face stays Instrument Serif.
//
//   (d) Non-regression: chat-LEFT / rail-TOP geometry, focus-mode natural
//       size, bilingual EN/AR strings, and BOTH reduced-motion gates survive.
//
// Harness posture copied from tests/v1127-ui-guard.test.mjs: bundle the REAL
// store + ChatPanel with esbuild, SSR with renderToStaticMarkup, capture JSX
// elements so a real onClick can be inspected without a DOM library.
//
//   node --test --test-force-exit tests/v1134-ui-guard.test.mjs
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

// ---------- source paths ----------
const P = {
  chat: 'src/components/ChatPanel.tsx',
  msg: 'src/components/MessageView.tsx',
  store: 'src/store.ts',
  consoleCss: 'src/components/console.css',
  typeScale: 'src/components/type-scale.css',
  chatFinal: 'src/components/chat-final.css',
  shell: 'src/components/shell.css',
  app: 'src/App.tsx',
  i18n: 'src/i18n.ts',
  tokens: 'src/styles/tokens.css',
  styles: 'src/styles.css',
  glass: 'src/assets/glass-v7.css',
};
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const RAW = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, read(v)]));

/** Comment bodies -> spaces, preserving bytes+newlines so indices map to
 *  exact file:line in the RAW file (posture of v1124-focus-guard). */
const strip = (s) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\r\n]/g, ' '))
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\r\n]/g, ' '))
  .replace(/(^|[\s;{(])\/\/[^\n]*/g, (m) => m.replace(/[^\r\n]/g, ' '));
const C = Object.fromEntries(Object.entries(RAW).map(([k, v]) => [k, strip(v)]));

function lineAt(src, index) {
  let line = 1;
  const end = Math.max(0, Math.min(index, src.length));
  for (let i = 0; i < end; i++) if (src[i] === '\n') line++;
  return line;
}
function lineOf(src, needle) {
  const i = src.indexOf(needle);
  return i < 0 ? 0 : lineAt(src, i);
}
const at = (key, needle) => `${P[key]}:${lineOf(C[key], needle) || lineOf(RAW[key], needle) || '?'}`;
const atRe = (key, re) => {
  const m = re.exec(C[key]);
  return `${P[key]}:${m ? lineAt(C[key], m.index) : '?'}`;
};

// ---------- esbuild bundle of the REAL plan component + store ----------
const BUNDLE = join(ROOT, 'tests', '.v1134-ui-guard.bundle.cjs');
let mod, React, renderToStaticMarkup, origJsx, origJsxs;
const captured = [];
const TODOS = [
  { id: 't1', content: 'PLAN_GUARD_STEP_ALPHA', status: 'completed' },
  { id: 't2', content: 'PLAN_GUARD_STEP_BETA', status: 'in_progress' },
  { id: 't3', content: 'PLAN_GUARD_STEP_GAMMA', status: 'pending' },
];

/** Append named exports for the plan/todo UI component(s) to the IN-MEMORY
 *  ChatPanel source only (real file untouched) so SSR can reach it even when
 *  the component is module-private. Matches `function X({ todos …` and
 *  `const X = ({ todos …`, plus any /plan|todo/i-named component. */
function planExportPlugin() {
  return {
    name: 'v1134-plan-export',
    setup(build) {
      build.onLoad({ filter: /[\\/]ChatPanel\.tsx$/ }, (args) => {
        let src = readFileSync(args.path, 'utf8');
        const names = new Set();
        for (const m of src.matchAll(/\bfunction\s+([A-Z]\w*)\s*\([^)]*\btodos\b/g)) names.add(m[1]);
        for (const m of src.matchAll(/\b(?:const|let)\s+([A-Z]\w*)\s*=\s*\([^)]*\btodos\b/g)) names.add(m[1]);
        for (const m of src.matchAll(/\b(?:function|const)\s+([A-Z][A-Za-z0-9]*(?:Plan|Todo)[A-Za-z0-9]*)\b/g)) names.add(m[1]);
        // Remove names already exported so we never duplicate a binding.
        const exported = new Set();
        for (const m of src.matchAll(/\bexport\s+(?:default\s+)?(?:function|const|class)\s+([A-Za-z_$]\w*)/g)) exported.add(m[1]);
        for (const m of src.matchAll(/\bexport\s*\{([^}]*)\}/g))
          for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/)[0]; if (n) exported.add(n); }
        const add = [...names].filter((n) => n && !exported.has(n));
        if (add.length) src += `\nexport { ${add.join(', ')} };\n`;
        return { contents: src, loader: 'tsx' };
      });
    },
  };
}

before(async () => {
  // Minimal DOM so the real store + components import cleanly under Node.
  const bridge = new Proxy({}, {
    get(_t, k) {
      if (k === 'then' || k === 'toJSON' || typeof k === 'symbol') return undefined;
      return () => Promise.resolve(undefined);
    },
  });
  globalThis.window = {
    surnia: bridge,
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    setTimeout: () => 1, clearTimeout() {},
    innerWidth: 1280, innerHeight: 800,
    location: { search: '' },
  };
  globalThis.document = {
    documentElement: { classList: { contains: () => false, add() {} }, dataset: {}, style: { setProperty() {} } },
    body: { appendChild() {}, removeChild() {} },
    createElement: () => ({ style: {}, select() {}, remove() {} }),
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => {} } }, configurable: true, writable: true,
  });

  await esbuild.build({
    stdin: {
      contents:
        "export { useStore, CHAT_MIN, CHAT_MAX, CHAT_DEFAULT } from './src/store';" +
        "export * from './src/components/ChatPanel';",
      resolveDir: ROOT, loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLE,
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.woff': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
    external: [
      'electron', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/server', 'zustand',
      'lucide-react', '@xterm/xterm', '@xterm/addon-fit', 'monaco-editor', '@monaco-editor/react',
    ],
    plugins: [planExportPlugin()], logLevel: 'silent',
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

const h = (...a) => React.createElement(...a);

/** Pick the plan-strip component from the bundle (prefer exact/canonical names). */
function planComponent() {
  const exact = ['PlanCard', 'PlanToggle', 'PlanStrip', 'PlanButton', 'TodoCard', 'TodoStrip', 'PlanToggleButton'];
  for (const n of exact) if (typeof mod[n] === 'function') return { name: n, Comp: mod[n] };
  const cand = Object.keys(mod).filter((k) => /plan|todo/i.test(k) && typeof mod[k] === 'function');
  return cand.length ? { name: cand[0], Comp: mod[cand[0]] } : null;
}

function seedPlan() {
  mod.useStore.setState({
    settings: { ...(mod.useStore.getState().settings ?? {}), language: 'en', numerals: 'western' },
    todos: TODOS,
  });
}
function renderPlan() {
  seedPlan();
  captured.length = 0;
  const found = planComponent();
  assert.ok(found, `${P.chat}: no plan/todo UI component is exported or discoverable — cannot SSR the strip`);
  let html;
  const oldErr = console.error; console.error = () => {};
  try { html = renderToStaticMarkup(h(found.Comp, { todos: TODOS })); }
  finally { console.error = oldErr; }
  return { html, name: found.name };
}

// ============================================================
// A — PLAN STRIP -> SMALL BUTTON (source + SSR)
// ============================================================
const PLAN_CODE = C.chat;

test('A1 source: the plan/todo UI renders a <button> with a REAL click handler', () => {
  // Find the plan UI block: PlanCard body, or any `{ todos ...` component body.
  const start = PLAN_CODE.search(/\bfunction\s+PlanCard\b|\b(?:function|const)\s+\w*(?:Plan|Todo)\w*\s*[=(]/i);
  assert.ok(start >= 0, `${at(P.chat && 'chat', 'function PlanCard')}: no plan/todo component found in ChatPanel`);
  const block = PLAN_CODE.slice(start, start + 2600);
  assert.match(block, /<button\b/,
    `${atRe('chat', /<button\b/g)}: V7 must collapse the strip into a <button>`);
  assert.match(block, /\bonClick\s*=|\bonToggle\s*=/,
    `${atRe('chat', /<button\b/g)}: that button needs a REAL onClick / onToggle handler`);
});

test('A2 source: the WIDE row content (TodoRows list + meter) is gated, not always-on', () => {
  assert.ok(/useState\s*\(|useReducer\s*\(/.test(PLAN_CODE),
    `${P.chat}: plan UI needs local open/closed state to collapse the strip`);
  const todoRowsAt = lineOf(PLAN_CODE, '<TodoRows');
  const meterAt = lineOf(PLAN_CODE, 'todo-meter');
  assert.ok(todoRowsAt > 0 || meterAt > 0,
    `${P.chat}: no plan/todo strip markup found to collapse`);
  // At least one of the wide-row markers must sit behind a conditional
  // ({open && ...} / {open ? ... : ...}), i.e. not rendered unconditionally.
  const gated = /\{[A-Za-z_$][\w$]*\s*(?:&&|\?)\s*[\s\S]{0,600}?<TodoRows/
    .test(PLAN_CODE) || /\{[A-Za-z_$][\w$]*\s*(?:&&|\?)\s*[\s\S]{0,600}?todo-meter/
    .test(PLAN_CODE) || /\{[A-Za-z_$][\w$]*\s*(?:&&|\?)\s*<div[^>]{0,200}todo-card/
    .test(PLAN_CODE);
  assert.ok(gated,
    `${P.chat}:${todoRowsAt || meterAt}: TodoRows/todo-meter must be rendered behind an open/closed condition, not always`);
});

test('A3 SSR: the plan component paints ONE small button, not the wide strip', () => {
  const { html } = renderPlan();
  assert.equal((html.match(/<button\b/g) || []).length, 1,
    `SSR of the plan UI must show exactly ONE small button (got ${(html.match(/<button\b/g) || []).length}); strip=${html.slice(0, 160)}`);
  assert.doesNotMatch(html, /todo-meter|ts-plan-progress|ts-plan-count/,
    'collapsed plan UI must NOT paint the wide meter / progress ring of the old strip');
  assert.doesNotMatch(html, /PLAN_GUARD_STEP_ALPHA|PLAN_GUARD_STEP_BETA|PLAN_GUARD_STEP_GAMMA/,
    'collapsed plan UI must NOT list the todo rows (they belong in the expanded drawer)');
});

test('A4 SSR: the plan button carries a real onClick handler (captured, not dead)', () => {
  renderPlan();
  const btn = captured.find((e) => e.type === 'button');
  assert.ok(btn, `${P.chat}: the plan <button> produced no JSX element during SSR`);
  assert.equal(typeof btn.props.onClick, 'function',
    `${P.chat}: the plan button has a real onClick handler`);
});

// ============================================================
// B — RESIZER: >=75% window, balanced reset, keyboard accessible
// ============================================================
const STORE = C.store;
const CHAT = C.chat;

test('B1 source: the resize max permits chat to reach >=75% of the window', () => {
  // Dynamic max: either an inline `innerWidth * 0.7x|0.8x`, or a named
  // fraction constant (e.g. CHAT_MAX_FRACTION = 0.8) multiplied by the
  // viewport width. Both satisfy ">=75% of window".
  let dynamic = false;
  if (/(?:window\.)?innerWidth\s*\*\s*0\.(?:7[5-9]|8|9)\d*/.test(STORE + CHAT)) dynamic = true;
  for (const m of (STORE + CHAT).matchAll(/\b([A-Z_]*FRACTION)\s*=\s*(0\.\d+)/g)) {
    if (Number(m[2]) >= 0.75) dynamic = true;
  }
  const m = /CHAT_MAX\s*=\s*(\d+(?:\.\d+)?)/.exec(STORE);
  const numeric = m ? Number(m[1]) : 0;
  // 75% of a 1280px reference window = 960px (fallback for a fixed px cap).
  assert.ok(dynamic || numeric >= 960,
    `${at('store', 'CHAT_MAX =')}: CHAT_MAX=${numeric || 'n/a'}px is below 75% of a 1280px window (960px), and no innerWidth-fraction max found — raise the cap to ~75-80%`);
  assert.match(CHAT, /Math\.min\(\s*(?:effectiveChatMax\(\)|CHAT_MAX\b)/,
    `${atRe('chat', /Math\.min\(\s*(?:effectiveChatMax|CHAT_MAX)/g)}: the drag clamp must use the effective max`);
});

test('B2 source: double-click reset restores a BALANCED width (not min/max)', () => {
  assert.match(CHAT, /onDoubleClick\s*=\s*\{\s*\w*[Rr]eset\w*/,
    `${atRe('chat', /onDoubleClick\s*=/g)}: the resizer needs a double-click reset handler`);
  // The reset handler must actually call a "balanced" helper (not snap to the
  // max or the min). Locate its body from the reset function declaration.
  const rm = /(\w*[Rr]eset\w*)\s*=\s*useCallback|\bfunction\s+(\w*[Rr]eset\w*)/.exec(CHAT);
  assert.ok(rm, `${atRe('chat', /resetWidth/g)}: reset handler body not found`);
  const name = rm[1] || rm[2];
  const body = CHAT.slice(rm.index, rm.index + 500);
  assert.match(body, /\bbalanced\w*\(/i,
    `${at('chat', name)}: double-click reset must call a balanced-width helper, not jump to an extreme`);
  assert.doesNotMatch(body, /\bCHAT_MAX\b/,
    `${at('chat', name)}: reset must not snap chat to the maximum width`);
});

test('B3 source: the resizer is keyboard accessible (tabIndex + key handler + ARIA + bilingual hint)', () => {
  const resAt = CHAT.indexOf('className={`chat-resizer');
  assert.ok(resAt >= 0, `${P.chat}: chat-resizer element not found`);
  const block = CHAT.slice(Math.max(0, resAt - 400), resAt + 800);
  assert.match(block, /\btabIndex\s*=/,
    `${at('chat', 'chat-resizer')}: resizer must be focusable (tabIndex=0)`);
  assert.match(block, /\bonKeyDown\s*=/,
    `${at('chat', 'chat-resizer')}: resizer needs an onKeyDown handler (arrow keys)`);
  assert.match(block, /aria-valuenow|aria-valuetext/,
    `${at('chat', 'chat-resizer')}: resizer must expose its value to AT (aria-valuenow / aria-valuetext)`);
  assert.match(block, /aria-label=\{t\('chat\.resizePanel'/,
    `${at('chat', 'chat-resizer')}: resizer keeps its translated aria-label`);
  const hint = /'chat\.resizeHint'\s*:\s*\['([^']*)',\s*'([^']*)'\]/.exec(C.i18n);
  assert.ok(hint, `${at('i18n', 'chat.resizeHint')}: resize hint must be an EN/AR tuple`);
  assert.match(hint[2], /[^\x00-\x7F]/,
    `${at('i18n', 'chat.resizeHint')}: resize hint must carry an Arabic translation`);
});

// ============================================================
// C — CHAT FONT SIZES UP; DISPLAY FONT STILL INSTRUMENT SERIF
// ============================================================
test('C1 source: chat font-size tokens raised above their console.css baselines (source px)', () => {
  // Baselines are the values authored in console.css (message body / chrome /
  // meta). V7 must lift each one at the source pixel level.
  const table = [
    ['--chat-base', 14],   // console.css:21 message body
    ['--chat-ui', 13],     // console.css:22 chrome
    ['--chat-meta', 12],   // console.css:23 meta floor
  ];
  const files = ['consoleCss', 'typeScale', 'chatFinal'];
  for (const [token, baseline] of table) {
    const decls = [];
    for (const k of files) {
      const re = new RegExp(`${token}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, 'g');
      for (const m of C[k].matchAll(re))
        decls.push({ file: P[k], line: lineAt(C[k], m.index), px: Number(m[1]) });
    }
    assert.ok(decls.length, `${P.consoleCss}: ${token} declaration missing`);
    const raised = decls.filter((d) => d.px > baseline);
    assert.ok(raised.length > 0,
      `${token} baseline is ${baseline}px; V7 must raise it. Found: ${decls.map((d) => `${d.file}:${d.line}=${d.px}px`).join(', ')}`);
  }
});

test('C2 source: message body still consumes --chat-base (font increase actually applies)', () => {
  assert.match(C.consoleCss, /font-size\s*:\s*var\(--chat-base\)/,
    `${at('consoleCss', 'font-size: var(--chat-base)')}: the message body must use the enlarged token`);
});

test('C3 source: DISPLAY face is still Instrument Serif (not swapped while resizing type)', () => {
  assert.match(C.tokens, /--font-display-serif\s*:\s*'Instrument Serif'/,
    `${at('tokens', "--font-display-serif: 'Instrument Serif'")}: display serif must stay Instrument Serif`);
  assert.match(RAW.glass, /@font-face\s*\{[\s\S]*?font-family\s*:\s*'Instrument Serif'/,
    `${P.glass}: the Instrument Serif @font-face must survive`);
  assert.match(C.styles, /--font-display\s*:\s*var\(--font-display-serif\)/,
    `${at('styles', '--font-display:')}: --font-display must still resolve to the serif face`);
});

// ============================================================
// D — NON-REGRESSION: layout / focus / bilingual / reduced-motion
// ============================================================
test('D1 source: chat-LEFT / rail-TOP geometry intact', () => {
  assert.match(C.shell, /\.app-main-row-v12\s*>\s*\.chat-slot-v12\s*\{[^}]*order:\s*1\s*;[^}]*flex:\s*0\s+0\s+auto/s,
    `${atRe('shell', /\.app-main-row-v12\s*>\s*\.chat-slot-v12/g)}: chat stays first/left (order:1, flex:0 0 auto)`);
  assert.match(C.shell, /\.app-main-row-v12\s*>\s*\.work-slot-v12\s*\{[^}]*order:\s*2\s*;[^}]*flex:\s*1\s+1\s+auto/s,
    `${atRe('shell', /\.app-main-row-v12\s*>\s*\.work-slot-v12/g)}: work area stays second/right`);
  assert.match(C.shell, /\.app-rail-bar-v13\s*\{[^}]*width:\s*100%/s,
    `${atRe('shell', /\.app-rail-bar-v13/g)}: rail stays full-width on TOP`);
  assert.ok(C.app.includes('{!focusMode && <Rail />}'),
    `${at('app', '{!focusMode && <Rail />}')}: rail still mounts at top, hidden only in focus`);
  const chatIdx = C.app.indexOf('className="chat-slot-v12');
  const workIdx = C.app.indexOf('{workArea}');
  assert.ok(chatIdx > -1 && workIdx > chatIdx,
    `${P.app}: chat slot must precede the work area in the DOM (chat LEFT)`);
});

test('D2 source: focus mode still NATURAL size (no frame/measure/gutter rules)', () => {
  const focusRules = [...C.shell.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1].includes("[data-focus='on']"));
  assert.ok(focusRules.length >= 2 && focusRules.length <= 3,
    `${P.shell}: expected 2-3 focus rules, found ${focusRules.length}`);
  const BANNED = [
    ['max-width', /\bmax-width\s*:/i], ['min-width', /\bmin-width\s*:/i],
    ['width', /(?<![-a-z])width\s*:/i], ['height', /(?<![-a-z])(?:max-)?height\s*:/i],
    ['padding', /\bpadding(?:-[a-z-]+)?\s*:/i], ['margin', /\bmargin(?:-[a-z-]+)?\s*:/i],
    ['border', /\bborder(?:-[a-z-]+)?\s*:/i], ['box-shadow', /\bbox-shadow\s*:/i],
    ['centering', /\b(?:justify-content|align-items|place-content)\s*:/i],
    ['transform', /\btransform\s*:/i], ['background', /\bbackground(?:-[a-z-]+)?\s*:/i],
    ['--focus-* token', /--focus-[a-z-]*/i],
  ];
  for (const r of focusRules) {
    for (const [label, re] of BANNED) {
      assert.ok(!re.test(r[2]),
        `${atRe('shell', new RegExp((r[1].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).slice(0, 20), 'g'))} [${label}]: focus mode must not restyle the chat (${r[1].trim()})`);
    }
    for (const decl of r[2].split(';').map((d) => d.trim()).filter(Boolean)) {
      assert.match(decl, /^(?:display\s*:\s*none|flex\s*:\s*1\s+1\s+auto)/i,
        `${P.shell}: focus rule ${r[1].trim()} may only declare display:none / flex:1 1 auto (got "${decl}")`);
    }
  }
  assert.ok(C.app.includes("document.documentElement.dataset.focus = focusMode ? 'on' : ''"),
    `${at('app', 'dataset.focus')}: focus flag must be mirrored onto <html>`);
});

test('D3 source: bilingual EN/AR strings survive (new UI strings are translated)', () => {
  for (const key of ['chat.resizePanel', 'chat.resizeHint', 'tool.todo_write']) {
    const m = new RegExp(`'${key.replace('.', '\\.')}'\\s*:\\s*\\['([^']*)'\\s*,\\s*'([^']*)'\\]`).exec(C.i18n);
    assert.ok(m, `${at('i18n', key)}: "${key}" must be an [English, العربية] tuple`);
    assert.match(m[2], /[^\x00-\x7F]/, `${at('i18n', key)}: Arabic translation missing`);
  }
  assert.match(PLAN_CODE, /\bt\s*\(/,
    `${P.chat}: the plan button label must go through t() — no hardcoded English-only label`);
});

test('D4 source: BOTH reduced-motion gates remain in the chat CSS layer', () => {
  const os = /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(C.chatFinal) || /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(C.typeScale);
  const app = /html\.reduce-motion\s/.test(C.chatFinal) || /html\.reduce-motion\s/.test(C.typeScale);
  assert.ok(os,
    `${P.chatFinal}: OS prefers-reduced-motion gate missing`);
  assert.ok(app,
    `${P.chatFinal}: in-app html.reduce-motion gate missing`);
});
