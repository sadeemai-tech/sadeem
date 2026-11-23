// ============================================================
// v11.37 — ERROR HONESTY (real SSR test)
//
// The founder: "ارسلت له رسالة بيحكي لي الريت ليميت 429، وتلاقي انه دغري
// الذكاء الاصطناعي رد، بس بطلع لي هذا الغلط، ما بعرف ليه" — he sends a
// message, the AI replies fine, but a WRONG 429 error card still shows.
//
// This suite proves the two halves of the honesty contract with the REAL
// React components + the REAL store (esbuild bundle + react-dom/server):
//   1. a normal assistant reply that merely MENTIONS "429 / rate limit" in
//      prose renders NO app-error card (EN and AR) — it stays markdown;
//   2. a stale / leaked `model:'error'` tag on an answer-shaped row is NOT
//      enough to paint a card either;
//   3. a REAL isError 429 row DOES render the calm card (title, code, next
//      step), in one language, with no raw JSON;
//   4. the pure classifier never labels assistant prose as a rate limit.
//
//   node --test --test-force-exit tests/v1137-error-honesty.test.mjs
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
const BUNDLE = join(ROOT, 'tests', '.v1137-error-honesty.bundle.cjs');

let mod, React, renderToStaticMarkup;
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
        "export { ErrorNotice, classifyError, machineCodeOf, isAssistantProse, isGenuineAppError } from './src/components/ErrorNotice';" +
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
});

after(() => { try { unlinkSync(BUNDLE); } catch { /* already gone */ } });

const h = React?.createElement;
const T = 1700000000000;
const textOf = (html) => html
  .replace(/<[^>]*>/g, '')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
  .replace(/&#x2F;/g, '/').replace(/&amp;/g, '&');

function seed(lang = 'en') {
  const prev = mod.useStore.getState();
  mod.useStore.setState({
    settings: {
      ...(prev.settings ?? {}), language: lang, numerals: 'western',
      model: { provider: 'custom', model: 'm' },
    },
    running: false,
  });
}

/** Render an assistant row exactly as the transcript hands it to MessageView. */
const renderMsg = (msg, extra = {}) =>
  renderToStaticMarkup(h(mod.MessageView, { msg, turnStart: true, ...extra }));

const assistantReply = (content, extra = {}) => ({
  id: 'a1', role: 'assistant', kind: 'text',
  model: 'custom/m', content, timestamp: T, ...extra,
});
const errorRow = (content, extra = {}) => ({
  id: 'e1', role: 'assistant', kind: 'text', model: 'error', isError: true,
  content, timestamp: T, ...extra,
});

// ------------------------------------------------------------
// 1 · PURE — prose never becomes a rate-limit error
// ------------------------------------------------------------
test('classifier does NOT false-positive on assistant prose that mentions 429', () => {
  assert.equal(mod.isAssistantProse('I retried after the 429 rate limit and it worked'), true);
  assert.equal(
    mod.classifyError('I retried after the 429 rate limit and it worked'),
    'generic',
    at(CMP_PATH, 'isAssistantProse(s)'),
  );
  assert.equal(
    mod.classifyError('You can retry once the rate limit (429) resets — I checked.'),
    'generic',
  );
  // A REAL failure sentence is still honestly classified.
  assert.equal(mod.classifyError('Rate limited (429) - retries were exhausted'), 'rateLimit');
  assert.equal(mod.classifyError('The provider is rate-limiting requests right now. (429)'), 'rateLimit');
  // a real machine payload that happens to contain "succeeded" is still an error
  assert.equal(mod.classifyError('No provider succeeded (429) — rate limit exhausted'), 'rateLimit');
});

test('gate: only an explicit/legacy error flag mounts a card — never prose', () => {
  assert.equal(mod.isGenuineAppError(assistantReply('429 rate limit mentioned in prose')), false);
  assert.equal(mod.isGenuineAppError(errorRow('Rate limited (429)')), true);
  // stale / leaked tag on an answer-shaped row is refused
  assert.equal(mod.isGenuineAppError({ ...errorRow('I retried after the 429 and it worked'), isError: undefined }), false);
  // live streaming deltas are assistant output, never an app error
  assert.equal(mod.isGenuineAppError({ ...errorRow('Rate limited (429)'), streaming: true }), false);
});

// ------------------------------------------------------------
// 2 · SSR — a normal 429-mentioning answer renders NO error card
// ------------------------------------------------------------
test('SSR EN: a normal assistant reply mentioning 429 renders NO error card', () => {
  seed('en');
  const html = renderMsg(assistantReply(
    'I hit the 429 rate limit while extracting DNA, but I retried and it worked — here is the result.',
  ));
  assert.ok(!html.includes('app-error-notice'),
    `a normal answer must never paint an error card: ${at(MSG_PATH, 'isGenuineAppError(msg)')}`);
  assert.ok(!html.includes('Rate limit reached'), 'no false "Rate limit reached" title');
  assert.ok(textOf(html).includes('429'), 'the prose itself is still rendered as ordinary markdown');
  assert.ok(!/\p{Script=Arabic}/u.test(textOf(html)), 'single language: no Arabic in EN prose');
});

test('SSR AR: a normal Arabic answer mentioning 429 renders NO error card', () => {
  seed('ar');
  const html = renderMsg(assistantReply(
    'واجهت حد الطلبات 429 أثناء الاستخراج، لكنني أعدت المحاولة ونجح المهمة.',
  ));
  assert.ok(!html.includes('app-error-notice'), 'no error card for an AR normal answer');
  assert.ok(!html.includes('تم بلوغ حد الطلبات'), 'no false Arabic rate-limit title');
  assert.ok(textOf(html).includes('429'), 'the AR prose is still rendered as markdown');
});

test('SSR: a stale/leaked model:error tag on an answer-shaped row is refused', () => {
  seed('en');
  // This is the exact false shape: a leaked/stale row tagged 'error' whose
  // content is really the assistant's successful answer mentioning 429.
  const html = renderMsg({
    id: 'stale', role: 'assistant', kind: 'text', model: 'error',
    content: 'I retried after the 429 rate limit and it worked.', timestamp: T,
  });
  assert.ok(!html.includes('app-error-notice'),
    `a stale error tag must not outlive a successful answer: ${at(CMP_PATH, 'isGenuineAppError')}`);
  assert.ok(textOf(html).includes('429'), 'the answer text is preserved, not hidden');
});

// ------------------------------------------------------------
// 3 · SSR — a REAL 429 still shows clearly, calm + single-language
// ------------------------------------------------------------
test('SSR EN: a real isError 429 row renders the calm card', () => {
  seed('en');
  const html = renderMsg(errorRow('Rate limited (429) - retries were exhausted; wait briefly, then send again.'), {
    canRetry: true, onRetry: () => {},
  });
  assert.match(html, /data-testid="app-error-notice"/);
  assert.match(html, /data-kind="rateLimit"/);
  const text = textOf(html);
  assert.ok(text.includes('Rate limit reached'), 'honest short title');
  assert.ok(text.includes('Wait a moment, then retry'), 'concrete next step');
  assert.ok(html.includes('>429</span>'), 'REAL machine code');
  assert.ok(!/\p{Script=Arabic}/u.test(text), 'single language EN');
  assert.ok(!html.includes('&quot;') && !html.includes('"message"'), 'no raw JSON');
  assert.ok(!html.includes('error-card'), 'calm instrument, not the old box');
});

test('SSR AR: a real isError 429 row renders Arabic only', () => {
  seed('ar');
  const html = renderMsg(errorRow('المزوّد يحدّد الطلبات حالياً (429)'));
  assert.match(html, /data-kind="rateLimit"/);
  const text = textOf(html);
  assert.ok(text.includes('تم بلوغ حد الطلبات'), 'Arabic title');
  assert.ok(text.includes('انتظر قليلاً ثم أعد المحاولة'), 'Arabic next step');
  assert.ok(!/[A-Za-z]{3,}(?:\s+[A-Za-z]{3,}){2,}/.test(text.replace(/\b(?:API|429)\b/g, ' ')),
    'no English prose in the Arabic surface');
});

// ------------------------------------------------------------
// 4 · SOURCE — the gate is wired, image/tool code untouched
// ------------------------------------------------------------
test('source: MessageView gates the card on isGenuineAppError, not the raw tag', () => {
  const msg = src(MSG_PATH);
  assert.ok(msg.includes('isGenuineAppError(msg)'), at(MSG_PATH, 'isGenuineAppError(msg)'));
  assert.ok(!/const isError = msg\.model === ['"]error['"]/.test(msg),
    'the weak tag-only gate is gone');
  // The other agent's image/gallery + tool-row code is untouched.
  assert.ok(msg.includes('sc18-imgres-thumb'), 'image gallery still present');
  assert.ok(msg.includes('sc18-imgres-lightbox'), 'lightbox still present');
  assert.ok(msg.includes("msg.kind === 'tool_result'"), 'tool result row still present');
});
