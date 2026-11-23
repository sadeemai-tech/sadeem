// ============================================================
// v11.37 — BUILDERS: the whole class is fixed, not just pdf_make.
//
// Founder repro: pdf_make was emitted 4× with ONE escaped Windows path
// ("C:\Users\acer\Music\New folder (2)\reports\cell-biology.pdf", Arabic
// markdown) and retried with reshaped args because every attempt died on a
// cryptic PathEscapesWorkspace / missing-alias error.
//
// This suite proves, on the real executors:
//   • pdf/docx/pptx/xlsx/make_document accept alias args on CALL #1
//   • outside-workspace paths with spaces+parentheses+Arabic either succeed
//     with auto-created parent dirs OR return ONE actionable error (never a
//     cryptic fail that invites 4 retries)
//   • Arabic content survives into real bytes (ToUnicode CMap / w:bidi in
//     docx / UTF-8 in pptx) — no '?' code dump
//   • every produced file is byte-verified on disk
//
// Run: node --test --test-force-exit tests/v1137-builders.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

process.env.SURNIA_NO_BROWSER = '1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1137-builders-'));
const WS = join(tmp, 'workspace');
// The EXACT shape of the founder's path: outside the workspace, spaces + parens.
const OUTSIDE = join(tmp, 'New folder (2)', 'reports');
mkdirSync(WS, { recursive: true });

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${out}`, '--external:electron', '--external:@xterm/xterm',
    '--external:@xterm/addon-fit', '--external:monaco-editor', '--external:@monaco-editor/react'],
  { cwd: ROOT, stdio: 'pipe' });
}

// Plain-Node electron stub (same posture as v1126/v1134).
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `
class WC { on() {} async executeJavaScript() { return []; } }
class BW { constructor() { this.webContents = new WC(); } destroy() {} setBounds() {} getBounds() { return {x:0,y:0}; } }
module.exports = {
  app: { getPath: () => ${JSON.stringify(tmp)}, isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },
  ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
  Notification: { isSupported: () => false },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder() {}, trashItem: async () => {} },
  clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
  BrowserWindow: BW,
};`);

const toolsPath = join(tmp, 'tools.cjs');
bundle('electron/agent/tools.ts', toolsPath);
const tools = require(toolsPath);

const AR = '# تقرير علم الأحياء الخلوي\n\nهذا تقرير تجريبي باللغة العربية مع **نصوص** وخلايا.\n\n- الخلية الأولى: النواة\n- الخلية الثانية: الميتوكوندريا\n\n| العنصر | الوصف |\n| --- | --- |\n| النواة | مركز الخلية |\n';
const arCode = (s) => [...s].filter((c) => /[\u0600-\u06FF]/.test(c)).map((c) => c.codePointAt(0));

function ctx(fullAccess = true, approve = async () => true) {
  const approvals = [];
  return {
    workspace: WS, sessionId: 'v1137-builders', mcpServers: [], emit: () => {},
    approve: async (req) => { approvals.push(req.kind); return approve(req); },
    fullAccess, approvals,
  };
}
const run = (name, args, c) => tools.executeTool(name, JSON.stringify(args), c);
function bytes(p) {
  assert.ok(existsSync(p), `output must exist on disk: ${p}`);
  const b = readFileSync(p);
  assert.ok(statSync(p).size > 0, `output must be non-empty: ${p}`);
  return b;
}
function assertOneActionableError(res, tool) {
  assert.equal(res.ok, false, `${tool}: expected a single honest refusal`);
  assert.match(res.output, /workspace|approved|fullAccess/i, `${tool}: error must name the real fix`);
  assert.match(res.output, /Fix:/i, `${tool}: error must include an explicit next step`);
  assert.doesNotMatch(res.output, /PathEscapesWorkspace/, `${tool}: no cryptic class name`);
  assert.doesNotMatch(res.output, /^\s*Error:/, `${tool}: no raw error dump`);
}

// ============================================================
test('v1137 pdf_make: Arabic + founder-style escaped path → one call, byte-verified PDF with real glyphs', { timeout: 120_000 }, async () => {
  const c = ctx();
  const dest = join(OUTSIDE, 'cell-biology.pdf'); // parent dirs do NOT exist yet
  const res = await run('pdf_make', {
    path: dest,
    content: AR,
    format: 'pdf',
    title: 'تقرير الخلية',
  }, c);
  assert.equal(res.ok, true, `pdf_make must succeed on call #1: ${res.output}`);
  const b = bytes(dest);
  assert.equal(b.subarray(0, 5).toString('latin1'), '%PDF-', 'real PDF header');
  assert.match(b.toString('latin1'), /\/FontFile2/, 'a real Unicode font is embedded (no missing glyphs)');
  assert.match(b.toString('latin1'), /\/ToUnicode/, 'Arabic text stays extractable');
  // ToUnicode maps embedded glyph ids back to the real Arabic codepoints —
  // proof the glyphs exist in the font, not a "?" replacement.
  const pdfAscii = b.toString('latin1');
  for (const cp of arCode('الخلية')) {
    assert.ok(pdfAscii.includes(cp.toString(16).padStart(4, '0')), `PDF ToUnicode must carry U+${cp.toString(16)}`);
  }
  assert.doesNotMatch(res.output, /Latin-1 only/, 'Arabic must not silently downgrade to the Latin-1 renderer');
  // The app's own reader must still parse the embedded-font PDF (valid xref).
  const readBack = await run('pdf_read', { path: dest }, c);
  assert.equal(readBack.ok, true, `embedded-font PDF must parse: ${readBack.output}`);
});

test('v1137 pdf_make: outside path denied → ONE honest actionable error, no retry bait', { timeout: 120_000 }, async () => {
  const c = ctx(false, async () => false);
  const res = await run('pdf_make', { path: join(OUTSIDE, 'denied.pdf'), content: AR }, c);
  assertOneActionableError(res, 'pdf_make');
  assert.equal(c.approvals.filter((k) => k === 'escape').length, 1, 'exactly one explicit escape decision');
  assert.ok(!existsSync(join(OUTSIDE, 'denied.pdf')), 'denial must not write a file');
});

test('v1137 docx_make / pptx_make / xlsx_make: Arabic bytes + outside path + alias args', { timeout: 240_000 }, async () => {
  const c = ctx();
  const cases = [
    {
      tool: 'docx_make', file: 'الخلية-تقرير.docx',
      args: { dest: join(OUTSIDE, 'الخلية-تقرير.docx'), text: AR, name: 'تقرير الخلية' },
      check: (b) => {
        assert.equal(b.subarray(0, 2).toString('latin1'), 'PK', 'real OOXML zip');
        const xml = inflateMember(b, 'word/document.xml');
        assert.match(xml, /[\u0600-\u06FF]/, 'Arabic present in document.xml');
        assert.match(xml, /<w:bidi\s*\/>/, 'RTL bidi flag present');
      },
    },
    {
      tool: 'pptx_make', file: 'cell-biology.pptx',
      args: {
        output: join(OUTSIDE, 'cell-biology.pptx'),
        name: 'عرض الخلية',
        deck: [{ title: 'الخلية', points: ['النواة', 'الميتوكوندريا'], note: 'ملاحظة' }],
      },
      check: (b) => {
        assert.equal(b.subarray(0, 2).toString('latin1'), 'PK', 'real OOXML zip');
        assert.ok([...b].some((x) => x >= 0xd8), 'Arabic UTF-8 bytes present');
      },
    },
    {
      tool: 'xlsx_make', file: 'data.xlsx',
      args: { savePath: join(OUTSIDE, 'data.xlsx'), text: 'العنصر,الوصف\nالنواة,مركز الخلية\n' },
      check: (b) => {
        assert.equal(b.subarray(0, 2).toString('latin1'), 'PK', 'real OOXML zip');
        assert.ok(inflateMember(b, 'xl/worksheets/sheet1.xml').includes('النواة'), 'Arabic cell preserved');
      },
    },
  ];
  for (const t of cases) {
    const p = join(OUTSIDE, t.file);
    const res = await run(t.tool, t.args, c);
    if (!res.ok) {
      // The only acceptable failure is ONE honest dependency error — never a
      // path/alias failure that would make the model reshape its call.
      assert.match(res.output, /not installed|FAILED HONESTLY|pip|install/i,
        `${t.tool}: only a dependency error is acceptable: ${res.output}`);
      assert.doesNotMatch(res.output, /Missing required parameter|PathEscapesWorkspace/,
        `${t.tool}: path/alias errors are forbidden: ${res.output}`);
      continue;
    }
    t.check(bytes(p));
  }
});

test('v1137 make_document: all aliases (dest/body/fmt/name) + Arabic + spacey path on call #1', { timeout: 120_000 }, async () => {
  const c = ctx();
  const dest = join(OUTSIDE, ' truyền (2)又不', 'docs'); // spaces + unicode + parens
  const p = join(dest, 'خلايا.docx');
  const res = await run('make_document', {
    dest: p,
    body: AR,
    fmt: 'docx',
    name: 'تقرير الخلية',
    contentIsHtml: false,
  }, c);
  assert.equal(res.ok, true, `make_document aliases must work on call #1: ${res.output}`);
  const b = bytes(p);
  assert.equal(b.subarray(0, 2).toString('latin1'), 'PK');
  assert.match(inflateMember(b, 'word/document.xml'), /[\u0600-\u06FF]/, 'Arabic survived');
  assert.match(inflateMember(b, 'word/document.xml'), /<w:bidi\s*\/>|w:rtl/, 'RTL flags present');
});

test('v1137 inside-workspace path with spaces + Arabic name: parent dirs auto-created', { timeout: 120_000 }, async () => {
  const c = ctx();
  const p = join(WS, 'my reports (2026)', ' biology', 'تقرير.pdf');
  const res = await run('pdf_make', { path: p, body: AR }, c); // body alias, no title
  assert.equal(res.ok, true, `expected success: ${res.output}`);
  const b = bytes(p);
  assert.equal(b.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.match(b.toString('latin1'), /\/FontFile2/);
});

test.after(() => rmSync(tmp, { recursive: true, force: true }));

// Minimal stored-deflate member reader (no external zip dependency).
function inflateMember(zip, name) {
  const zlib = require('node:zlib');
  let off = 0;
  while (off + 30 <= zip.length && zip.readUInt32LE(off) === 0x04034b50) {
    const method = zip.readUInt16LE(off + 8);
    const csize = zip.readUInt32LE(off + 18);
    const nameLen = zip.readUInt16LE(off + 26);
    const extraLen = zip.readUInt16LE(off + 28);
    const entry = zip.toString('utf8', off + 30, off + 30 + nameLen);
    const data = zip.subarray(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + csize);
    if (entry === name) {
      return method === 8 ? zlib.inflateRawSync(data).toString('utf8') : data.toString('utf8');
    }
    off += 30 + nameLen + extraLen + csize;
  }
  return '';
}
