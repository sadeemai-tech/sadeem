// ============================================================
// v11.34 — IMAGE RESULTS RENDER AS IMAGES (founder's exact complaint):
//   "أحيانا لما يلتقط صورة أو يستخدم صورة بتطلع لي على شكل كود... وأرقام،
//    ما بتطلع لي كصورة"
// A tool image result (read_image / screenshot / browser_screenshot /
// image_generate / tool_result.images) used to be dumped verbatim into a
// <pre> — raw base64/JSON numbers instead of the actual picture. This suite
// proves, with the REAL React component + the REAL tool payload shapes, that:
//   • an image result renders an <img> thumbnail and NO code block,
//   • raw base64 never appears as TEXT (only inside the src attribute),
//   • the caption is real data (filename · WxH · KB) and monolingual,
//   • a failed result / prose path is never turned into a fake image,
//   • the click-to-open handler and lightbox really exist in source.
// Harness posture copied from tests/v1116-chat-precision.test.mjs.
//
//   node --test --test-force-exit tests/v1134-image-display.test.mjs
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
const CSS_PATH = 'src/components/chat-final.css';
const BUNDLE = join(ROOT, 'tests', '.v1134-image-display.bundle.cjs');
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

// A REAL 1×1 PNG payload (base64), exactly the shape read_image/screenshot emit.
const B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const DATA_URL = `data:image/png;base64,${B64}`;

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
      contents: "export { MessageView, imageItemsOf } from './src/components/MessageView';",
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
const resultMsg = (content, extra = {}) => ({
  id: 'r1', role: 'tool', kind: 'tool_result', toolName: 'read_file',
  content, resultOk: true, timestamp: T, ...extra,
});
const render = (msg) => renderToStaticMarkup(h(mod.MessageView, { msg }));
const textOf = (html) => html.replace(/<[^>]*>/g, ''); // strip tags → visible text only

// ------------------------------------------------------------
// 1 · PURE DETECTOR — the real payload shapes from tools.ts
// ------------------------------------------------------------
test('read_image JSON {ok:true,path,mime,dataUrl} → one real data-URL image', () => {
  const payload = JSON.stringify({ ok: true, path: 'assets/shot.png', mime: 'image/png', dataUrl: DATA_URL });
  const items = mod.imageItemsOf(payload);
  assert.equal(items.length, 1, at(MSG_PATH, 'export function imageItemsOf'));
  assert.equal(items[0].isPath, false);
  assert.equal(items[0].filename, 'shot.png');
  assert.equal(items[0].src, DATA_URL);
  assert.ok(items[0].bytes > 0, 'exact byte size derived from the real base64 bytes');
});

test('screenshot JSON (no path) → image.png; browser_screenshot note is ignored', () => {
  const items = mod.imageItemsOf(JSON.stringify({ ok: true, mime: 'image/png', dataUrl: DATA_URL, note: 'screenshot of http://x' }));
  assert.equal(items.length, 1);
  assert.equal(items[0].filename, 'image.png');
  assert.ok(!textOf(JSON.stringify(items)).includes('screenshot of'), 'no prose leaks into the caption');
});

test('tool_result with an `images` array → a real <img> source', () => {
  const items = mod.imageItemsOf('(no output)', [DATA_URL, 'assets/diagram.webp']);
  assert.equal(items.length, 2);
  assert.equal(items[0].src, DATA_URL);
  assert.equal(items[1].src, 'assets/diagram.webp');
  assert.equal(items[1].filename, 'diagram.webp');
});

test('JSON result carrying an `images` array → both pictures, no duplicates', () => {
  const payload = JSON.stringify({ ok: true, images: [DATA_URL, DATA_URL] });
  const items = mod.imageItemsOf(payload);
  assert.equal(items.length, 1, 'dedupe by real source');
  assert.equal(items[0].src, DATA_URL);
});

test('image_generate text "Image generated → <path> (WxH, KB)" → real path + real metadata', () => {
  const payload = 'Image generated → C:\\proj\\assets\\hero.png (1280x720, 148KB, model flux).\nUse read_image on this path if you need to inspect it visually.';
  const items = mod.imageItemsOf(payload);
  assert.equal(items.length, 1);
  assert.equal(items[0].isPath, true);
  assert.equal(items[0].filename, 'hero.png');
  assert.equal(items[0].width, 1280);
  assert.equal(items[0].height, 720);
  assert.equal(items[0].bytes, 148 * 1024);
});

test('LLM-honest: a FAILED result or an error path never becomes a fake image', () => {
  const payload = JSON.stringify({ ok: true, path: 'assets/shot.png', mime: 'image/png', dataUrl: DATA_URL });
  assert.deepEqual(mod.imageItemsOf(payload, undefined, false), [], 'failed result → no image');
  assert.deepEqual(mod.imageItemsOf('read_image: cannot access assets/shot.png: ENOENT', undefined, false), []);
  assert.deepEqual(mod.imageItemsOf('plain text with a path assets/shot.png but no success marker'), []);
});

// ------------------------------------------------------------
// 2 · SSR — an image result renders <img>, NEVER a code block
// ------------------------------------------------------------
test('SSR: read_image result renders <img> and NOT a code block; no raw base64 as text', () => {
  const payload = JSON.stringify({ ok: true, path: 'assets/shot.png', mime: 'image/png', dataUrl: DATA_URL });
  const html = render(resultMsg(payload, { toolName: 'read_image' }));
  assert.match(html, /<img[^>]*class="sc18-imgres-thumb"/, at(MSG_PATH, 'sc18-imgres-thumb'));
  assert.ok(html.includes('data:image/png;base64,'), 'the real pixels are in the src attribute');
  assert.ok(!html.includes('sc18-res-pre'), at(MSG_PATH, 'imageItems.length > 0'), 'no code block for an image result');
  assert.ok(!html.includes('&quot;dataUrl&quot;'), 'the JSON payload is never printed');
  const text = textOf(html);
  assert.ok(!text.includes(B64), 'raw base64 never appears as visible TEXT');
  assert.ok(!text.includes('data:image'), 'no data-URL code in the caption');
  assert.ok(text.includes('shot.png'), 'caption carries the real filename');
  assert.match(text, /\d+B\b/, 'caption carries the real byte size');
});

test('SSR: image_generate path result renders an <img> with a data caption, not code', () => {
  const payload = 'Image generated → C:\\proj\\assets\\hero.png (1280x720, 148KB, model flux).';
  const html = render(resultMsg(payload, { toolName: 'image_generate' }));
  assert.match(html, /<img[^>]*class="sc18-imgres-thumb"/);
  assert.ok(html.includes('hero.png'), 'real path reaches the <img> src');
  assert.ok(!html.includes('sc18-res-pre'), 'no code block');
  const text = textOf(html);
  assert.ok(text.includes('hero.png') && text.includes('1280×720') && text.includes('148KB'),
    'caption = real filename · dimensions · size');
  assert.ok(!/[\u0600-\u06FF]/.test(text), 'caption is monolingual data (no EN+AR mix)');
});

test('SSR: tool_result.images array renders an <img> and NOT a code block', () => {
  const html = render(resultMsg('(no output)', { toolName: 'screenshot', images: [DATA_URL] }));
  assert.match(html, /<img[^>]*class="sc18-imgres-thumb"/);
  assert.ok(!html.includes('sc18-res-pre'));
  assert.ok(!textOf(html).includes(B64), 'base64 stays out of visible text');
});

test('SSR regression: an ordinary text tool result still renders its <pre>', () => {
  const html = render(resultMsg('line1\nline2\n'));
  assert.ok(html.includes('sc18-res-pre'), 'plain text is unchanged');
  assert.ok(!html.includes('sc18-imgres-thumb'), 'no phantom image');
});

test('the lightbox has a REAL click handler and a real, closable overlay', () => {
  const html = render(resultMsg(JSON.stringify({ ok: true, dataUrl: DATA_URL })));
  assert.ok(html.includes('sc18-imgres-item'), 'thumbnail button is in the DOM');
  const btn = captured.find((e) => e.props?.className === 'sc18-imgres-item');
  assert.ok(btn && typeof btn.props.onClick === 'function', at(MSG_PATH, 'onClick={() => setOpen(i)}'),
    'thumbnail click is wired to a real handler');
  btn.props.onClick(); // a real invocation — not a decorative attribute
  const msgSrc = src(MSG_PATH);
  assert.ok(msgSrc.includes('sc18-imgres-lightbox'), at(MSG_PATH, 'sc18-imgres-lightbox'));
  assert.ok(msgSrc.includes('role="dialog"') && msgSrc.includes('aria-modal="true"'), 'real dialog semantics');
  assert.ok(msgSrc.includes("e.key === 'Escape'") && msgSrc.includes("window.addEventListener('keydown', onKey)"),
    'Escape closes the lightbox through a real key listener');
  assert.ok(msgSrc.includes('window.removeEventListener'), 'the key listener is cleaned up');
});

// ------------------------------------------------------------
// 3 · SOURCE — precise geometry, no boxy card, no gradients
// ------------------------------------------------------------
test('CSS: 320px hairline image, no card fill / radius / shadow / gradient', () => {
  const css = src(CSS_PATH);
  const block = css.slice(css.indexOf('.sc18-imgres {'));
  assert.ok(block.includes('max-width: 320px'), at(CSS_PATH, 'max-width: 320px'));
  assert.ok(/\.sc18-imgres-thumb\s*\{[^}]*border:\s*1px solid var\(--line\)/s.test(css),
    at(CSS_PATH, '.sc18-imgres-thumb'), '1px hairline on the pixels');
  const imgStart = css.indexOf('12 · IMAGE RESULTS');
  // v11.37 (M5) added the attach-menu/effort CSS AFTER the image section
  // (also labelled "12 · V1137") — bound the scan to the image part only.
  const nextSection = css.indexOf('12 · V1137', imgStart);
  const imgSection = nextSection > imgStart ? css.slice(imgStart, nextSection) : css.slice(imgStart);
  assert.ok(!/box-shadow\s*:|linear-gradient|radial-gradient|border-radius:\s*[1-9]/.test(imgSection),
    'no boxy card, gradient or glow around the image');
  assert.ok(css.includes('position: fixed') && css.includes('.sc18-imgres-lightbox'), 'real full-screen lightbox');
});
