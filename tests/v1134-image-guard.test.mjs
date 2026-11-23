// ============================================================================
// v1134 — IMAGE-DISPLAY VERIFICATION GUARD  (diagnosis + test ONLY)
// ----------------------------------------------------------------------------
// The founder's complaint (Arabic): "يطلع كود وأرقام بدل الصورة" — an image /
// screenshot shows up as code and numbers instead of a picture.
//
// V1 fixes this in src/components/MessageView.tsx + chat-final.css. This file
// does NOT fix anything. It is the guard the parent runs AFTER V1 lands:
//
//   1. REAL SSR of the ACTUAL bundled MessageView (esbuild bundle of the real
//      .tsx, react-dom/server, REAL zustand store seeded with the message):
//      tool result carrying images:[{dataUrl:'data:image/png;base64,...'}]
//      → <img src=that dataUrl>, no base64 in VISIBLE text, no <pre> code block.
//   2. Path text result "Image generated → C:\\...\\foo.png (1024x1024, 83KB)"
//      → an image thumbnail/glyph + a REAL caption, not a raw text dump.
//   3. Source-level click-to-open handler; bilingual caption that renders in
//      exactly ONE language per locale; no raw JSON in the visible caption.
//   4. CSS: hairline-only image surface (no boxy border/shadow) and the image
//      motion is guarded by BOTH prefers-reduced-motion AND html.reduce-motion.
//
// Harness posture: identical to tests/v1111-providers-context.test.mjs —
// esbuild bundles + electron stub + tmp-only zustand SSR patch + react-dom/server.
// No app source is modified by this test. No network. No assertion at module load.
// ============================================================================
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync,
  cpSync, existsSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

const MSG_FILE = 'src/components/MessageView.tsx';
const CSS_FILE = 'src/components/chat-final.css';
const TYPE_FILE = 'shared/types.ts';
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const MSG = read(MSG_FILE);
const CSS = read(CSS_FILE);

/** 1-based line number of the first `needle`, for parent-facing failure reports. */
function lineOf(src, needle) {
  const i = typeof needle === 'string' ? src.indexOf(needle) : src.search(needle);
  if (i < 0) return '?';
  return src.slice(0, i).split('\n').length;
}
const at = (file, needle) => `${file}:${lineOf(read(file), needle)}`;

/** Visible text only — strip tags and decode the handful of entities React emits. */
function visible(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&#x2F;/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// esbuild harness (same flags as v1111-providers-context)
// ---------------------------------------------------------------------------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [
    ESBUILD_BIN, entry,
    '--bundle', '--platform=node', '--format=cjs', '--jsx=automatic',
    '--define:process.env.NODE_ENV="test"',
    `--outfile=${out}`,
    '--external:electron',
    '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--loader:.svg=dataurl',
    '--external:monaco-editor', '--external:@monaco-editor/react',
    // ONE React/zustand copy across bundle + test (hook dispatcher sanity).
    '--external:react', '--external:react-dom', '--external:zustand',
  ], { cwd: ROOT, stdio: 'pipe' });
}

const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1134-image-'));

// electron stub (isolated userData dir)
{
  const userDataDir = join(tmp, 'userdata');
  mkdirSync(userDataDir, { recursive: true });
  const stubDir = join(tmp, 'node_modules', 'electron');
  mkdirSync(stubDir, { recursive: true });
  writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
  writeFileSync(join(stubDir, 'index.js'), `module.exports = {
    app: { getPath: () => ${JSON.stringify(userDataDir)}, whenReady: async () => true, on() {}, quit() {} },
    ipcMain: { handle() {}, on() {} },
    ipcRenderer: { invoke: async () => undefined, on() {}, send() {} },
    BrowserWindow: { getAllWindows: () => [] },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: async () => {}, openPath: async () => '' },
    Notification: { isSupported: () => false },
    nativeImage: { createEmpty: () => ({}) },
    Menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} },
    dialog: { showOpenDialog: async () => ({ canceled: true }) },
    powerMonitor: { on() {} },
  };`);
}

// react/react-dom external → link the project's packages into the tmp tree.
{
  const nmDir = join(tmp, 'node_modules');
  mkdirSync(nmDir, { recursive: true });
  for (const pkg of ['react', 'react-dom', 'scheduler', 'loose-envify', 'js-tokens']) {
    const src = join(ROOT, 'node_modules', pkg);
    const dst = join(nmDir, pkg);
    if (existsSync(dst)) continue;
    try {
      symlinkSync(src, dst, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      cpSync(src, dst, { recursive: true });
    }
  }
}

// zustand v5 SSR snapshot is api.getInitialState(); point it at the live state
// so a seeded store is what the server renderer sees (tmp copy only).
{
  const zSrc = join(ROOT, 'node_modules', 'zustand');
  const zDst = join(tmp, 'node_modules', 'zustand');
  cpSync(zSrc, zDst, { recursive: true });
  const reactJs = join(zDst, 'react.js');
  let code = readFileSync(reactJs, 'utf8');
  code = code.replace(
    '() => selector(api.getInitialState())',
    '() => selector(api.__getInitialState ? api.__getInitialState() : api.getInitialState())',
  );
  code = code.replace(
    '  Object.assign(useBoundStore, api);\n  return useBoundStore;',
    '  Object.assign(useBoundStore, api);\n  useBoundStore.setServerInitialState = (fn) => { api.__getInitialState = fn; };\n  return useBoundStore;',
  );
  writeFileSync(reactJs, code);
}

const bundlePath = join(tmp, 'v1134-render.cjs');
bundle('tests/fixtures/v1134-render-entry.ts', bundlePath);
const ui = require(bundlePath);
const React = require(join(ROOT, 'node_modules', 'react'));
const { renderToStaticMarkup } = require(join(ROOT, 'node_modules', 'react-dom', 'server'));

// ---------------------------------------------------------------------------
// Seed + render helpers — the store is seeded with the assistant/tool message
// and its tool result exactly as the engine writes them (see
// electron/services/apiServerService.ts tool_start / tool_result).
// ---------------------------------------------------------------------------
const B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' +
  'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=';
const DATA_URL = `data:image/png;base64,${B64}`;
const PATH = 'C:\\sadeem\\out\\foo.png';
const PATH_TEXT = `Image generated → ${PATH} (1024x1024, 83KB)`;

const toolCall = {
  id: 'v1134-call', role: 'tool', kind: 'tool_call',
  toolName: 'image_generate', toolCallId: 'v1134-c1',
  content: JSON.stringify({ path: PATH }),
  timestamp: 1_700_000_000_000,
};
const imageResult = {
  id: 'v1134-res', role: 'tool', kind: 'tool_result',
  toolCallId: 'v1134-c1', toolName: 'image_generate',
  content: PATH_TEXT, resultOk: true, timestamp: 1_700_000_000_100,
  images: [{ dataUrl: DATA_URL }],
};
const textOnlyResult = {
  ...imageResult, id: 'v1134-text', images: undefined,
  content: 'Image generated → C:\\sadeem\\out\\bar.png (512x512, 41KB)',
};

function seed(lang, messages) {
  ui.useStore.setState({
    settings: {
      ...(ui.useStore.getState().settings ?? {}),
      language: lang, numerals: 'western',
    },
    messages,
    running: false,
  });
  ui.useStore.setServerInitialState?.(() => ui.useStore.getState());
}

/** Real SSR of the bundled MessageView, store seeded with msg + result. */
function render(props, lang = 'en', messages = [toolCall, imageResult]) {
  seed(lang, messages);
  return renderToStaticMarkup(React.createElement(ui.MessageView, props));
}
/** Paired tool_call + its image-bearing tool_result (the chat transcript path). */
const renderImage = (lang = 'en') =>
  render({ msg: toolCall, result: imageResult, turnStart: true }, lang) +
  render({ msg: imageResult }, lang, [toolCall, imageResult]);
/** Path-only text result (no images array) — must still yield a thumbnail/glyph. */
const renderText = (lang = 'en') =>
  render({ msg: textOnlyResult }, lang, [toolCall, textOnlyResult]);

// ===========================================================================
// HARNESS SANITY — proves we really bundled + SSR'd the app sources.
// ===========================================================================
test('V1134-0 · harness: real esbuild bundle + seeded store + react-dom/server', () => {
  // MessageView is memo()'d → React.memo returns an object with $$typeof, not a function.
  assert.ok(
    ui.MessageView && typeof ui.MessageView === 'object',
    'bundled MessageView must be the real memoized component',
  );
  assert.equal(typeof ui.useStore?.setState, 'function', 'bundled store must be seeded-able');
  const html = renderImage('en');
  assert.ok(html.length > 80, 'MessageView SSR produced no markup');
  assert.ok(html.includes('v1134') || html.includes('sc18') || html.includes('tl2'),
    'SSR markup does not look like the real MessageView transcript');
});

// ===========================================================================
// 1 · images:[{dataUrl}] → <img>, no base64 in visible text, no code block
// ===========================================================================
test('V1134-1 · image dataUrl renders as <img>; no base64 text; no <pre> code block', () => {
  const html = renderImage('en');
  const vis = visible(html);
  if (process.env.V1134_DEBUG) {
    console.log('DEBUG_IMG_TAGS', JSON.stringify([...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0])));
    console.log('DEBUG_VISIBLE', JSON.stringify(vis.slice(0, 400)));
  }
  assert.match(
    html,
    /<img\b[^>]*\bsrc="data:image\/png;base64,/i,
    `no <img> carries the tool-result dataUrl for images:[{dataUrl}]. imageItemsOf ignores non-string image entries: ${at(MSG_FILE, "typeof s !== 'string'")} (type declared at ${at(TYPE_FILE, 'images?:')})`,
  );
  assert.ok(
    !vis.includes('base64,'),
    `base64 string leaked into VISIBLE text (founder's "كود وأرقام"): ${at(MSG_FILE, 'function ResultRow')}`,
  );
  assert.ok(
    !/<pre\b/i.test(html),
    `a <pre> code block still renders the result as code: ${at(MSG_FILE, 'sc18-res-pre')}`,
  );
});

// ===========================================================================
// 2 · path text result → thumbnail/glyph + real caption, not a text dump
// ===========================================================================
test('V1134-2 · "Image generated → path (WxH,KB)" → thumbnail/glyph + caption, not text dump', () => {
  const html = renderText('en');
  const vis = visible(html);
  // a real caption names the file (basename) — not the whole path/arrow line.
  assert.ok(
    /bar\.png/i.test(vis),
    `no real caption naming the generated file. ResultRow text dump at ${at(MSG_FILE, 'function ResultRow')}`,
  );
  // some image affordance: an <img>, a glyph/caption hook, or an image data attr.
  const affordance =
    /<img\b/i.test(html) ||
    /(data-image|data-glyph="image"|figcaption|img-thumb|image-thumb|mv-image|sc-image|caption)/i.test(html);
  assert.ok(
    affordance,
    `neither a thumbnail nor an image glyph/caption was rendered for the path result: ${at(MSG_FILE, 'function ResultRow')}`,
  );
  // the raw line must not survive as a contiguous code block / visible text.
  assert.ok(
    !/<pre\b[^>]*>[\s\S]*?Image generated →/i.test(html),
    `raw "Image generated → …" line is still dumped into <pre>: ${at(MSG_FILE, 'sc18-res-pre')}`,
  );
  assert.ok(
    !vis.includes('→'),
    `arrow/path receipt is still visible text rather than a caption: ${at(MSG_FILE, 'function ResultRow')}`,
  );
});

// ===========================================================================
// 3 · click-to-open handler (source), bilingual + single-language caption,
//     no raw JSON in visible caption.
// ===========================================================================
test('V1134-3a · source: a click handler on the image result opens it (lightbox or native)', () => {
  // Scope to the image-result renderer, not every click handler in the file.
  const anchor = /ImageResultGallery/.exec(MSG) ?? /imageItemsOf/.exec(MSG);
  const imgRegion = anchor ? MSG.slice(anchor.index, anchor.index + 4200) : MSG;
  assert.ok(
    /on(?:Click|DoubleClick)\s*=/.test(imgRegion),
    `no click handler on the image result: ${at(MSG_FILE, 'ImageResultGallery')}`,
  );
  const opens =
    /setOpen|window\.open|api\.openExternal|api\.openPath|shell\.openPath|revealInFolder|openImage|lightbox/i;
  assert.ok(
    opens.test(imgRegion),
    `the image click handler does not open/preview the image: ${at(MSG_FILE, 'ImageResultGallery')}`,
  );
});

test('V1134-3b · caption is bilingual + single-language, no raw JSON', () => {
  const enHtml = renderImage('en');
  const arHtml = renderImage('ar');
  const AR = /[\u0600-\u06FF]/;

  // Caption text = content of any caption-bearing element, never unrelated
  // card chrome (the tool status pill in Arabic is NOT an image caption).
  const capText = (html) =>
    [...html.matchAll(/<[^>]*class="[^"]*(?:cap|caption)[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi)]
      .map((m) => visible(m[1]))
      .filter(Boolean)
      .join(' ');
  const enCap = capText(enHtml) || visible(enHtml);
  const arCap = capText(arHtml) || visible(arHtml);

  assert.ok(/foo\.png/.test(enCap) && /foo\.png/.test(arCap), 'caption must name the real file, not dump the path');
  assert.ok(
    !/"dataUrl"|base64,|\{[^{}]*"[A-Za-z]+"\s*:/.test(`${enCap} ${arCap}`),
    `raw JSON/base64 leaked into the caption (founder's "كود وأرقام"): ${at(MSG_FILE, 'function imageCaption')}`,
  );
  assert.ok(!AR.test(enCap), 'English UI caption must not mix Arabic — caption must be single-language');

  // Bilingual: the image affordance's label must have a real Arabic variant in
  // the ar locale — an inline English-only fallback (t(key,'Open full size'))
  // leaves Arabic users with English chrome and fails here.
  // Labels of the IMAGE element only — a localized copy/retry button elsewhere
  // in the card must not count as a translated image caption.
  const imgTags = (html) =>
    [...html.matchAll(/<[^>]+class="[^"]*(?:imgres|image-result|img-result|mv-img|sc-img)[^"]*"[^>]*>/gi)].map((m) => m[0]);
  const arImgLabels = imgTags(arHtml).flatMap((tag) =>
    [...tag.matchAll(/(?:title|aria-label)="([^"]*)"/gi)].map((m) => m[1]),
  );
  assert.ok(
    arImgLabels.length > 0 && arImgLabels.some((l) => AR.test(l)),
    `image affordance has NO Arabic (bilingual) label in ar locale — check the t() fallback at ${at(MSG_FILE, "t('mv.img.open'")} and its i18n dictionary entry`,
  );
});

// ===========================================================================
// 4 · hairline-only CSS, reduced-motion guarded
// ===========================================================================
test('V1134-4 · image surface is hairline-only and reduced-motion guarded', () => {
  const blocks = CSS.match(/[^{}]+\{[^}]*\}/g) ?? [];
  const imgBlocks = blocks.filter((b) => /(image|thumb|figcaption|caption|mv-img|sc-img|preview-img)/i.test(b));
  assert.ok(
    imgBlocks.length > 0,
    `no image-surface CSS rule found in ${CSS_FILE}`,
  );
  const imgCss = imgBlocks.join('\n');

  assert.ok(
    !/box-shadow\s*:/i.test(imgCss),
    `boxy shadow on the image surface: ${at(CSS_FILE, 'box-shadow')}`,
  );
  for (const m of imgCss.matchAll(/border(?:-[\w-]+)?\s*:\s*([^;}]+);/gi)) {
    const val = m[1].trim();
    const px = val.match(/(\d+(?:\.\d+)?)\s*px/);
    assert.ok(
      !px || Number(px[1]) <= 1,
      `non-hairline border "${val}" on the image surface: ${at(CSS_FILE, val.slice(0, 16))}`,
    );
  }

  assert.ok(
    /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/.test(CSS),
    `no prefers-reduced-motion guard in ${CSS_FILE}`,
  );
  assert.ok(
    /html\.reduce-motion/.test(CSS),
    `no html.reduce-motion guard in ${CSS_FILE}`,
  );
  const guarded =
    /(image|thumb|caption|mv-img|sc-img)[\s\S]{0,600}(prefers-reduced-motion|reduce-motion)/i.test(CSS) ||
    /(prefers-reduced-motion|reduce-motion)[\s\S]{0,600}(image|thumb|caption|mv-img|sc-img)/i.test(CSS);
  assert.ok(
    guarded,
    `image motion is not covered by a reduced-motion guard in ${CSS_FILE} (see ${at(CSS_FILE, '@media')})`,
  );
});
