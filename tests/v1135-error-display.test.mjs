// ============================================================
// v11.35 — CALM APP-ERROR DISPLAY (SSR + classification + source guards)
//
// Founder: "أريدك أن تحسن طريقة عرض أخطاء الذكاء الاصطناعي، إنه مثلا مش
// الأخطاء الذكاء الاصطناعي، أخطاء التطبيق، مثلا البروفايدر أو الريت
// ليميتنج، إنه يتم عرضه بطريقة أوضح وأجمل وأفضل."
//
// This suite proves, with the REAL React components and the REAL store:
//   • a 429 / quota / 503 / network / auth payload renders ErrorNotice with
//     a real reason + a concrete next step, NOT the old boxy .error-card;
//   • raw provider JSON never reaches the DOM (not even in "Details");
//   • one language per locale (EN output has no Arabic, AR output no Latin
//     prose) — even before the parent adds the new i18n keys;
//   • the retry button has a REAL onClick and is absent without a handler;
//   • the CSS is hairline-only: no fill / shadow / gradient / boxy card,
//     RTL-safe logical properties, tabular mono, both reduced-motion gates.
//
// Harness posture copied from tests/v1134-image-display.test.mjs.
//
//   node --test --test-force-exit tests/v1135-error-display.test.mjs
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
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

const MSG_PATH = 'src/components/MessageView.tsx';
const CMP_PATH = 'src/components/ErrorNotice.tsx';
const CSS_PATH = 'src/components/error-display.css';
const BUNDLE = join(ROOT, 'tests', '.v1135-error-display.bundle.cjs');

let mod, React, renderToStaticMarkup, origJsx, origJsxs;
const captured = [];

const lineOf = (text, needle) => {
  const i = text.indexOf(needle);
  if (i < 0) return 0;
  let line = 1;
  for (let k = 0; k < i; k++) if (text.charCodeAt(k) === 10) line++;
  return line;
};
const at = (p, needle) => `${p}:${lineOf(src(p), needle) || '?'}`;

before(() => {
  globalThis.window = {
    surnia: new Proxy({}, { get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : () => Promise.resolve(undefined)) }),
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false }),
    setTimeout: () => 1, clearTimeout() {},
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
    value: { clipboard: { writeText: async () => {} } }, configurable: true, writable: true,
  });

  esbuild.buildSync({
    stdin: {
      contents:
        "export { ErrorNotice, classifyError, machineCodeOf, detailTextOf } from './src/components/ErrorNotice';" +
        "export { MessageView } from './src/components/MessageView';" +
        "export { useStore } from './src/store';",
      resolveDir: ROOT,
      loader: 'tsx',
    },
    bundle: true, platform: 'node', format: 'cjs', outfile: BUNDLE,
    loader: { '.css': 'empty', '.svg': 'dataurl' },
    external: ['electron', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/server', 'zustand', 'lucide-react'],
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
const T = 1700000000000;
const textOf = (html) => html
  .replace(/<[^>]*>/g, '')
  .replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&#x2F;/g, '/')
  .replace(/&amp;/g, '&');
const hasLatinProse = (s) => /[A-Za-z]{3,}(?:\s+[A-Za-z]{3,}){2,}/.test(s.replace(/\b(?:API|429|503|402)\b/g, ' '));

function seed(lang = 'en', extra = {}) {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    settings: {
      ...(prev.settings ?? {}), language: lang, numerals: 'western',
      model: { provider: 'custom', model: 'm' },
    },
    running: false, ...extra,
  });
}
const errorMsg = (content, extra = {}) => ({
  id: 'e1', role: 'assistant', kind: 'text', model: 'error', content, timestamp: T, ...extra,
});
const render = (content, extra = {}) => {
  const { msg = errorMsg(content), ...props } = extra;
  return renderToStaticMarkup(h(mod.MessageView, { msg, turnStart: true, ...props }));
};

// ------------------------------------------------------------
// 1 · PURE DETECTOR — classification + machine reason + sanitizer
// ------------------------------------------------------------
test('classifier reads the REAL cause: 429 / quota / 503 / network / auth / unknown', () => {
  assert.equal(mod.classifyError('429 rate limit exceeded'), 'rateLimit', at(CMP_PATH, 'rateLimit:'));
  assert.equal(mod.classifyError('Insufficient credits (402)'), 'quota', at(CMP_PATH, 'quota:'));
  assert.equal(mod.classifyError('provider 503 unavailable'), 'provider', at(CMP_PATH, 'provider:'));
  assert.equal(mod.classifyError('fetch failed ECONNRESET'), 'network', at(CMP_PATH, 'network:'));
  assert.equal(mod.classifyError('invalid api key 401'), 'auth', at(CMP_PATH, 'auth:'));
  assert.equal(mod.classifyError('something unusual happened'), 'generic');
});

test('machine code is a neutral token or nothing — never prose', () => {
  assert.equal(mod.machineCodeOf('Provider returned 429 — too many requests'), '429');
  assert.equal(mod.machineCodeOf('fetch failed: ENOTFOUND api.example.test'), 'ENOTFOUND');
  assert.equal(mod.machineCodeOf('plain English sentence'), '');
  assert.equal(mod.machineCodeOf(undefined), '');
});

test('detail sanitizer never leaks raw JSON or a wrong-language sentence', () => {
  assert.equal(mod.detailTextOf('{"message":"Rate limit exceeded"}', false), 'Rate limit exceeded');
  assert.equal(mod.detailTextOf('{ not json at all', false), '', 'broken JSON is dropped, not printed');
  assert.equal(mod.detailTextOf('Rate limit exceeded, please retry', true), '', 'EN prose refused in an AR UI');
  assert.equal(mod.detailTextOf('المزوّد يحدّد الطلبات حالياً', false), '', 'AR prose refused in an EN UI');
});

// ------------------------------------------------------------
// 2 · SSR — a 429 is a calm instrument, not a raw red card
// ------------------------------------------------------------
test('SSR: a 429 provider error renders the calm component, next step and code', () => {
  seed('en');
  const content = 'The provider is rate-limiting requests right now. (429)';
  const html = render(content, { canRetry: true, onRetry: () => {} });
  assert.match(html, /data-testid="app-error-notice"/, at(CMP_PATH, 'data-testid="app-error-notice"'));
  assert.match(html, /data-kind="rateLimit"/, at(CMP_PATH, "data-kind={kind}"));
  assert.ok(html.includes('class="ed anim-in msg-in"'), 'the hairline instrument is mounted');
  assert.ok(html.includes('Rate limit reached'), 'short human title is visible');
  assert.ok(html.includes('Wait a moment, then retry'), 'concrete next step is visible');
  assert.ok(html.includes('>429</span>'), 'the REAL machine code is a tabular-mono token');
  const text = textOf(html);
  assert.ok(!text.includes('The provider is rate-limiting'), 'the raw provider sentence is NOT dumped as the body');
  assert.ok(!/\p{Script=Arabic}/u.test(text), 'single language: no Arabic in the EN surface');
  assert.ok(!html.includes('error-card') && !html.includes('<pre'), 'no boxy card and no code block');
});

test('SSR: raw provider JSON is never printed (not even in Details)', () => {
  seed('en');
  const content = '{"error":{"message":"Rate limit exceeded","code":429}}';
  const html = render(content, { canRetry: true, onRetry: () => {} });
  assert.match(html, /data-kind="rateLimit"/, 'JSON 429 is still classified as a rate limit');
  assert.ok(html.includes('Rate limit reached') && html.includes('Wait a moment, then retry'));
  assert.ok(!html.includes('&quot;'), 'no JSON quotes anywhere in the markup');
  assert.ok(!html.includes('"error"') && !html.includes('"message"'), 'no raw JSON keys');
  assert.ok(!html.includes('ed-detail'), 'no Details disclosure is mounted for a JSON payload');
  assert.ok(!/\p{Script=Arabic}/u.test(textOf(html)), 'single language');
});

test('SSR: each known cause gets its own honest title + next step', () => {
  seed('en');
  const cases = [
    ['Insufficient credits — no_credits (402)', 'quota', 'Credits exhausted', 'Add credits'],
    ['provider returned 503 unavailable', 'provider', 'Provider unavailable', 'switch provider'],
    ['fetch failed — network offline', 'network', 'Connection lost', 'Check your connection'],
    ['401 unauthorized — no api key', 'auth', 'API key needs attention', 'Check your API key'],
    ['an unexpected halt', 'generic', "Couldn't complete the request", 'Retry'],
  ];
  for (const [content, kind, title, next] of cases) {
    const html = render(content);
    const text = textOf(html);
    assert.match(html, new RegExp(`data-kind="${kind}"`), `${content} → ${kind}`);
    assert.ok(text.includes(title), `${kind}: title "${title}"`);
    assert.ok(text.includes(next), `${kind}: next step "${next}"`);
    assert.ok(!html.includes('error-card'), `${kind}: no boxy card`);
    assert.ok(!/\p{Script=Arabic}/u.test(textOf(html)), `${kind}: single language`);
  }
});

test('SSR: an Arabic locale renders Arabic only, even before i18n keys land', () => {
  seed('ar');
  const html = render('المزوّد يحدّد الطلبات حالياً (429)');
  const text = textOf(html);
  assert.match(html, /data-kind="rateLimit"/);
  assert.ok(text.includes('تم بلوغ حد الطلبات'), 'Arabic title');
  assert.ok(text.includes('انتظر قليلاً ثم أعد المحاولة'), 'Arabic next step');
  assert.ok(!hasLatinProse(text), 'no English prose in the Arabic surface');
});

// ------------------------------------------------------------
// 3 · REAL ACTION — the retry button is wired, and only when real
// ------------------------------------------------------------
test('retry action has a REAL onClick and invokes the caller handler', () => {
  seed('en');
  let calls = 0;
  captured.length = 0;
  render('429 rate limit', { canRetry: true, onRetry: () => { calls++; } });
  const btn = captured.find((e) => e.props?.className === 'ed-retry');
  assert.ok(btn, at(CMP_PATH, 'className="ed-retry"'));
  assert.equal(typeof btn.props.onClick, 'function', at(CMP_PATH, 'onClick={onRetry}'));
  btn.props.onClick();
  assert.equal(calls, 1, 'the handler really ran — not a decorative button');
  assert.equal(btn.props.type, 'button', 'real button semantics');
});

test('no handler ⇒ no retry affordance at all', () => {
  seed('en');
  const without = render('429 rate limit');
  assert.ok(!without.includes('ed-retry'), 'no phantom retry when ChatPanel passed no handler');
  assert.ok(without.includes('Rate limit reached'), 'the calm explanation still renders');
});

test('Details is a real toggle and never mounts raw text in the first paint', () => {
  seed('en');
  captured.length = 0;
  const first = render('The provider is rate-limiting right now. Extra detail 429.');
  assert.ok(!first.includes('class="ed-detail"'), 'details collapsed on first paint');
  assert.ok(!first.includes('Extra detail'), 'the raw detail bytes are absent from first paint');
  const toggle = captured.find((e) => e.props?.className === 'ed-detail-toggle');
  assert.ok(toggle && typeof toggle.props.onClick === 'function', at(CMP_PATH, 'onClick={() => setShowDetail'));
  const cmp = src(CMP_PATH);
  assert.ok(cmp.includes('setShowDetail((v) => !v)') && cmp.includes('{showDetail && detail &&'),
    at(CMP_PATH, 'the Details disclosure is a real state toggle'));
  const standalone = renderToStaticMarkup(h(mod.ErrorNotice, { content: '429 rate limit' }));
  assert.ok(standalone.includes('data-testid="app-error-notice"'), 'component renders standalone too');
});

// ------------------------------------------------------------
// 4 · SOURCE — MessageView wiring + hairline-only CSS contract
// ------------------------------------------------------------
test('MessageView delegates only the error branch; image/gallery code untouched', () => {
  const msg = src(MSG_PATH);
  assert.ok(msg.includes('<ErrorNotice content={msg.content}'), at(MSG_PATH, '<ErrorNotice content='));
  assert.ok(!msg.includes('className="w-full error-card'), at(MSG_PATH, 'old .error-card text dump removed'));
  assert.ok(msg.includes('sc18-imgres-thumb'), 'the other agent’s image result code is still present');
  assert.ok(msg.includes('sc18-imgres-lightbox'), 'the lightbox is still present');
});

test('CSS: one hairline, no fill / shadow / gradient / boxy card', () => {
  const css = src(CSS_PATH);
  assert.ok(css.includes('.ed-rule {') && /\.ed-rule \{[\s\S]*?background: var\(--line-strong\)/s.test(css),
    at(CSS_PATH, '.ed-rule'), 'one 1px hairline rail, no card frame');
  const root = css.slice(css.indexOf('.ed {'), css.indexOf('.ed-rule {'));
  assert.ok(!/background\s*:|box-shadow|border\s*:|linear-gradient|radial-gradient|border-radius/.test(root),
    at(CSS_PATH, '.ed {'), 'the instrument itself has no fill, shadow, border or radius');
  assert.ok(!/box-shadow|linear-gradient|radial-gradient/.test(css), 'no elevation or gradient anywhere in the file');
  assert.ok(!/\bborder-radius:\s*[1-9]/.test(css), 'no rounded card corners');
});

test('CSS: RTL-safe logical properties, tabular mono, Instrument Serif', () => {
  const css = src(CSS_PATH);
  for (const prop of ['padding-inline-start', 'inset-inline-start', 'margin-inline-start', 'border-inline-start']) {
    assert.ok(css.includes(prop), at(CSS_PATH, prop), `${prop} keeps the layout mirror-safe`);
  }
  assert.ok(!/\b(?:border|margin|padding|inset)-left\s*:/.test(css), 'no physical left properties');
  assert.ok(css.includes('font-variant-numeric: tabular-nums'), at(CSS_PATH, 'tabular-nums'));
  assert.ok(css.includes("font-family: var(--font-display-serif, Georgia, serif)"), at(CSS_PATH, 'font-display-serif'));
  assert.ok(css.includes("html[dir='rtl'] .ed-title"), at(CSS_PATH, "html[dir='rtl'] .ed-title"));
});

test('CSS: BOTH reduced-motion signals guard the only animation', () => {
  const css = src(CSS_PATH);
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), at(CSS_PATH, '@media (prefers-reduced-motion: reduce)'));
  assert.ok(css.includes('html.reduce-motion .ed-rule'), at(CSS_PATH, 'html.reduce-motion .ed-rule'));
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation: none[\s\S]*?\}/,
    'OS preference freezes the rail');
  assert.match(css, /html\.reduce-motion \.ed-rule \{[\s\S]*?animation: none !important/,
    'in-app switch freezes the rail too');
});

test('glyph is a 1px currentColor hairline instrument, not an icon badge', () => {
  const cmp = src(CMP_PATH);
  assert.ok(cmp.includes('viewBox="0 0 24 24"') && cmp.includes('strokeWidth="1"'), at(CMP_PATH, 'viewBox="0 0 24 24"'));
  assert.ok(cmp.includes('stroke="currentColor"'), at(CMP_PATH, 'stroke="currentColor"'));
  assert.ok(!/fill="var\(--bad\)/.test(cmp), 'no loud fill — only the centre dot uses currentColor');
});
