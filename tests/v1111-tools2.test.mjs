import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.11 — wave3-A8: smart utility arsenal + registry sweep
// (1) SWEEP: EVERY registered tool has a schema (object/properties/required),
//     a description, and a dispatch case — no orphans in the registry.
// (2) Every NEW tool dispatch-tested against REAL temp fixtures (honest
//     failures included: offline image_search, malformed base64, bad regex,
//     encrypted PDF, denied writes).
// (3) ui-quality NO-WRITE SKIP: pure Q&A turns (zero successful writes) get
//     an explicit PASS-skip instead of a phantom fix round.
// Run: node --test --test-force-exit tests/v1111-tools2.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as http from 'node:http';
import * as crypto from 'node:crypto';

// The agent browser is Electron-only — force the honest headless path.
process.env.SURNIA_NO_BROWSER = '1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1111-'));

// ---------- esbuild bundle (same posture as v1110-tools) ----------
function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN, 
    entry,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    `--outfile=${out}`,
    '--external:electron',
    '--external:@xterm/xterm',
    '--external:@xterm/addon-fit',
    '--external:monaco-editor',
    '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// electron stub for plain-Node execution (mirrors v1110-tools stub)
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `const paths = { temp: ${JSON.stringify(tmp)}, userData: ${JSON.stringify(join(tmp, 'ud'))}, home: ${JSON.stringify(tmp)}, appData: ${JSON.stringify(tmp)} };
   class StubWebContents { on() {} async executeJavaScript() { return []; } }
   class StubBrowserWindow { constructor() { this.webContents = new StubWebContents(); } destroy() {} setBounds() {} getBounds() { return { x: 0, y: 0 }; } }
   module.exports = {
     app: { getPath: (k) => paths[k] ?? paths.userData, isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },
     ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
     Notification: { isSupported: () => false },
     shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder: () => {}, trashItem: async () => {} },
     clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
     WebContents: class {},
     BrowserWindow: StubBrowserWindow,
   };`,
);

const toolsPath = join(tmp, 'tools.cjs');
bundle('electron/agent/tools.ts', toolsPath);
const tools = require(toolsPath);

function stubCtx(ws, opts = {}) {
  const approvals = [];
  return {
    workspace: ws,
    sessionId: opts.sessionId ?? 'v1111-test',
    mcpServers: [],
    emit: () => {},
    approve: async (req) => {
      approvals.push(req.kind + ':' + req.title);
      return opts.approve === false ? false : true;
    },
    denyHint: opts.denyHint,
    fullAccess: !!opts.fullAccess,
    approvals,
  };
}

const WS = join(tmp, 'ws');
mkdirSync(WS, { recursive: true });
const run = (name, args, ctx) => tools.executeTool(name, JSON.stringify(args ?? {}), ctx);

// ============================================================
// 1. REGISTRY SWEEP — every tool: schema + description + dispatch
// ============================================================
const NEW_TOOLS = [
  'image_search', 'csv_read', 'csv_write', 'pdf_read', 'hash_file', 'uuid_gen',
  'encode_base64', 'decode_base64', 'regex_test', 'text_stats', 'diff_files',
  'color_convert', 'url_encode', 'url_decode', 'markdown_outline', 'json_format',
];

test('SWEEP: registry holds ≥117 tools, every one with schema + description + dispatch case, no duplicates', () => {
  const defs = tools.getToolDefs([]);
  assert.ok(defs.length >= 117, `registry count ${defs.length} < 117`);
  const names = defs.map((d) => d.name);
  assert.equal(new Set(names).size, names.length, 'duplicate tool names in the registry');
  const src = readFileSync(join(ROOT, 'electron', 'agent', 'tools.ts'), 'utf8');
  for (const d of defs) {
    assert.ok(typeof d.name === 'string' && d.name.length > 0, 'tool without name');
    assert.ok(typeof d.description === 'string' && d.description.length > 10, `${d.name}: missing description`);
    assert.ok(d.parameters && typeof d.parameters === 'object' && d.parameters.type === 'object', `${d.name}: no object schema`);
    assert.ok(d.parameters.properties && typeof d.parameters.properties === 'object', `${d.name}: schema has no properties`);
    assert.ok(Array.isArray(d.parameters.required), `${d.name}: schema missing required list`);
    assert.ok(['fs', 'exec', 'meta', 'mcp'].includes(d.kind), `${d.name}: bad kind`);
    assert.ok(src.includes(`case '${d.name}':`), `${d.name}: registered but NO dispatch case (orphan def)`);
  }
  for (const n of NEW_TOOLS) assert.ok(names.includes(n), `${n} missing from registry`);
});

test('SWEEP: executeTool resolves real names and honestly rejects unknown ones', async () => {
  const bad = await run('definitely_not_a_tool_xyz', {}, stubCtx(WS));
  assert.equal(bad.ok, false);
  assert.match(bad.output, /Unknown tool/);
  const known = await run('regex_test', { pattern: 'x', input: 'x' }, stubCtx(WS));
  assert.equal(known.ok, true, known.output);
});

test('prompts.ts carries the tool-strategy block (screenshot-before-done, image_search flow, diagnose_preview, env_probe, edit-over-rewrite, final summary)', () => {
  const src = readFileSync(join(ROOT, 'electron', 'agent', 'prompts.ts'), 'utf8');
  // v11.23 — the wording gained "+ evidence" (accuracy contract); the intent
  // (finish with a summary) is preserved, so match the stable phrase.
  // v11.31 — the prompt agent normalized the slash form to `edit_file/multi_edit`.
// v11.34 — V15 replaced the verbose TOOL STRATEGY block with a compact
// CAPABILITY ROSTER (same tools, better salience for weak models).
for (const needle of ['# CAPABILITY ROSTER', 'browser_screenshot', 'image_search', 'diagnose_preview', 'env_probe', 'edit_file/multi_edit', 'Finish with 2-4 bullets + file paths.']) {
    assert.ok(src.includes(needle), `prompts.ts missing "${needle}"`);
  }
});

// ============================================================
// 2. image_search — the founder's flow: search → pick → download
// ============================================================
test('image_search parses REAL Openverse JSON (local server) and lists title/url/license/thumbnail', async () => {
  const fake = {
    result_count: 2,
    results: [
      {
        title: 'Golden mountain sunrise',
        url: 'http://127.0.0.1:%PORT%/img.png',
        thumbnail: 'http://127.0.0.1:%PORT%/thumb.png',
        license: 'cc0',
        license_version: '1.0',
        creator: 'A. Photographer',
        foreign_landing_url: 'http://127.0.0.1:%PORT%/page',
        width: 1920,
        height: 1080,
      },
      { title: 'Blue lake', url: 'http://127.0.0.1:%PORT%/lake.png', license: 'by', license_version: '4.0' },
    ],
  };
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/img.png')) {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length });
      res.end(png);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(fake).split('%PORT%').join(String(server.address().port)));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    // Route the tool at the local Openverse-shaped server (no live network).
    process.env.SADEEM_OPENVERSE_BASE = `http://127.0.0.1:${port}`;
    const res = await run('image_search', { query: 'mountain sunrise' }, stubCtx(WS, { fullAccess: true }));
    assert.equal(res.ok, true, res.output);
    assert.match(res.output, /Golden mountain sunrise/);
    assert.match(res.output, /license: cc0/);
    assert.match(res.output, /url: http:\/\/127\.0\.0\.1:\d+\/img\.png/);
    assert.match(res.output, /thumbnail: /);
    assert.match(res.output, /NEXT: download/);

    // THE FLOW: pick a result → browser_download it into the workspace → real file
    const pick = fake.results[0].url.split('%PORT%').join(port);
    const dl = await run('browser_download', { url: pick, dest: 'assets/pick.png' }, stubCtx(WS, { fullAccess: true }));
    assert.equal(dl.ok, true, dl.output);
    const file = join(WS, 'assets', 'pick.png');
    assert.ok(existsSync(file), 'downloaded image missing');
    assert.equal(readFileSync(file).slice(0, 4).toString('latin1'), '\x89PNG', 'downloaded image is not a PNG');
  } finally {
    delete process.env.SADEEM_OPENVERSE_BASE;
    server.close();
  }
}, { timeout: 30_000 });

test('image_search fails HONESTLY when the network is down (offline)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('connect ECONNREFUSED — simulated offline');
  };
  try {
    const res = await run('image_search', { query: 'sunset' }, stubCtx(WS, { fullAccess: true }));
    assert.equal(res.ok, false);
    assert.match(res.output, /image_search failed \(network\)/);
    assert.match(res.output, /ECONNREFUSED|unreachable|offline|Openverse/i);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('image_search honestly requires a query', async () => {
  const res = await run('image_search', {}, stubCtx(WS));
  assert.equal(res.ok, false);
  assert.match(res.output, /query/);
});

// ============================================================
// 3. csv_read / csv_write — round-trip with RFC4180 quoting
// ============================================================
test('csv_write → csv_read round-trips quoted fields, commas and embedded newlines', async () => {
  const rows = [
    ['name', 'note', 'value'],
    ['سديم', 'a,b and "quotes"', 42],
    ['row2', 'line1\nline2', 0],
  ];
  const w = await run('csv_write', { path: 'data/round.csv', rows }, stubCtx(WS));
  assert.equal(w.ok, true, w.output);
  assert.ok(existsSync(join(WS, 'data', 'round.csv')));

  const r = await run('csv_read', { path: 'data/round.csv' }, stubCtx(WS));
  assert.equal(r.ok, true, r.output);
  assert.match(r.output, /3 data rows × 3 cols/);
  const parsed = JSON.parse(r.output.split('\n')[1]);
  assert.deepEqual(parsed, [['name', 'note', 'value'], ['سديم', 'a,b and "quotes"', '42'], ['row2', 'line1\nline2', '0']]);

  const rh = await run('csv_read', { path: 'data/round.csv', header: true }, stubCtx(WS));
  assert.equal(rh.ok, true, rh.output);
  const rowsObj = JSON.parse(rh.output.split('\n')[1]);
  assert.equal(rowsObj[0].name, 'سديم');
  assert.equal(rowsObj[1].note, 'line1\nline2');
});

test('csv_write honors denial and csv_read honest errors', async () => {
  const denied = await run('csv_write', { path: 'no.csv', rows: [['a', 1]] }, stubCtx(WS, { approve: false }));
  assert.equal(denied.ok, false);
  assert.ok(!existsSync(join(WS, 'no.csv')), 'denied csv must not exist');

  const empty = await run('csv_write', { path: 'e.csv' }, stubCtx(WS));
  assert.equal(empty.ok, false);
  assert.match(empty.output, /rows/);

  const missing = await run('csv_read', { path: 'ghost.csv' }, stubCtx(WS));
  assert.equal(missing.ok, false);
  assert.match(missing.output, /not found/);
});

// ============================================================
// 4. pdf_read — real PDF from pdf_make + honest failures
// ============================================================
test('pdf_read extracts REAL text from a pdf_make-built PDF', async () => {
  const make = await run('pdf_make', {
    path: 'docs/demo.pdf',
    title: 'Quarterly Report',
    content: '# Heading One\n\nThe quick ZEBRA jumps over the lazy dog.',
  }, stubCtx(WS));
  assert.equal(make.ok, true, make.output);

  const res = await run('pdf_read', { path: 'docs/demo.pdf' }, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  assert.match(res.output, /content stream\(s\) parsed/);
  assert.match(res.output, /Heading One/);
  assert.match(res.output, /ZEBRA/);
}, { timeout: 60_000 });

test('pdf_read fails honestly on non-PDF and encrypted PDFs', async () => {
  writeFileSync(join(WS, 'fake.pdf'), 'this is not a pdf');
  const notPdf = await run('pdf_read', { path: 'fake.pdf' }, stubCtx(WS));
  assert.equal(notPdf.ok, false);
  assert.match(notPdf.output, /not a PDF/);

  const enc = ['%PDF-1.4', '1 0 obj << /Type /Catalog >> endobj', 'trailer << /Root 1 0 R /Encrypt 99 0 R >>', '%%EOF'].join('\n');
  writeFileSync(join(WS, 'enc.pdf'), enc);
  const encRes = await run('pdf_read', { path: 'enc.pdf' }, stubCtx(WS));
  assert.equal(encRes.ok, false);
  assert.match(encRes.output, /ENCRYPTED/);

  const missing = await run('pdf_read', { path: 'nope.pdf' }, stubCtx(WS));
  assert.equal(missing.ok, false);
  assert.match(missing.output, /not found/);
});

// ============================================================
// 5. hash_file / uuid_gen
// ============================================================
test('hash_file computes exact sha256/md5 and verifies a compare digest', async () => {
  const content = 'sadeem-hash-fixture-2025';
  writeFileSync(join(WS, 'data.bin'), content);
  const sha = crypto.createHash('sha256').update(content).digest('hex');
  const res = await run('hash_file', { path: 'data.bin' }, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  assert.match(res.output, new RegExp(`sha256: ${sha}`));

  const md5 = crypto.createHash('md5').update(content).digest('hex');
  const match = await run('hash_file', { path: 'data.bin', algorithm: 'md5', compare: md5 }, stubCtx(WS));
  assert.match(match.output, /compare: MATCH/);

  const mismatch = await run('hash_file', { path: 'data.bin', algorithm: 'md5', compare: 'deadbeef' }, stubCtx(WS));
  assert.match(mismatch.output, /MISMATCH/);

  const badAlgo = await run('hash_file', { path: 'data.bin', algorithm: 'crc32' }, stubCtx(WS));
  assert.equal(badAlgo.ok, false);
  // v11.26 — enum validation now names the bad value + exact allowed list.
assert.match(badAlgo.output, /Unsupported algorithm|must be one of sha256 \| md5 \| sha1 \| sha512/i);
});

test('uuid_gen produces distinct RFC4122 v4 UUIDs (count + uppercase)', async () => {
  const res = await run('uuid_gen', { count: 3 }, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  const ids = res.output.split('\n');
  assert.equal(ids.length, 3);
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  for (const id of ids) assert.match(id, re);
  assert.equal(new Set(ids).size, 3, 'uuids must be distinct');

  const up = await run('uuid_gen', { count: 1, uppercase: true }, stubCtx(WS));
  assert.match(up.output, /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
});

// ============================================================
// 6. encode_base64 / decode_base64
// ============================================================
test('base64: exact text encode → decode round-trip, file path, dest write, honest malformed input', async () => {
  const text = 'SADEEM سديم 42';
  const enc = await run('encode_base64', { text }, stubCtx(WS));
  assert.equal(enc.ok, true, enc.output);
  assert.equal(enc.output, Buffer.from(text, 'utf8').toString('base64'), 'encode output must be the exact base64');

  const dec = await run('decode_base64', { text: enc.output }, stubCtx(WS));
  assert.equal(dec.ok, true, dec.output);
  assert.equal(dec.output, text, 'decode output must be the exact original text');

  writeFileSync(join(WS, 'bin.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const encFile = await run('encode_base64', { path: 'bin.png', dest: 'bin.png.b64' }, stubCtx(WS));
  assert.equal(encFile.ok, true, encFile.output);
  assert.ok(existsSync(join(WS, 'bin.png.b64')));
  const decFile = await run('decode_base64', { path: 'bin.png.b64', dest: 'bin.restored.png' }, stubCtx(WS));
  assert.equal(decFile.ok, true, decFile.output);
  assert.deepEqual(readFileSync(join(WS, 'bin.restored.png')), readFileSync(join(WS, 'bin.png')));

  const bad = await run('decode_base64', { text: 'not!!valid-base64~~' }, stubCtx(WS));
  assert.equal(bad.ok, false);
  assert.match(bad.output, /non-base64|malformed/);
});

// ============================================================
// 7. regex_test
// ============================================================
test('regex_test returns exact matches with groups; honest invalid regex/flags', async () => {
  const res = await run('regex_test', { pattern: '(\\w+)@(\\w+)\\.com', flags: 'g', input: 'mail a@b.com then x@y.org and z@w.com' }, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  assert.match(res.output, /2 match\(es\)/);
  assert.match(res.output, /1\. @5 "a@b\.com" groups:\["a", "b"\]/);
  assert.match(res.output, /2\. @\d+ "z@w\.com" groups:\["z", "w"\]/);

  const named = await run('regex_test', { pattern: '(?<year>\\d{4})-(?<month>\\d{2})', input: 'date 2025-03 ok' }, stubCtx(WS));
  assert.match(named.output, /named:\{year="2025", month="03"\}/);

  const none = await run('regex_test', { pattern: 'zzz', input: 'abc' }, stubCtx(WS));
  assert.equal(none.ok, true);
  assert.match(none.output, /NO MATCH/);

  const invalid = await run('regex_test', { pattern: '([unclosed', input: 'x' }, stubCtx(WS));
  assert.equal(invalid.ok, false);
  assert.match(invalid.output, /Invalid regex/);

  const badFlags = await run('regex_test', { pattern: 'x', flags: 'qz', input: 'x' }, stubCtx(WS));
  assert.equal(badFlags.ok, false);
  assert.match(badFlags.output, /Invalid flags/);
});

// ============================================================
// 8. text_stats
// ============================================================
test('text_stats reports exact char/word/line/sentence/byte counts', async () => {
  const text = 'Hello world.\nSecond line here.';
  const res = await run('text_stats', { text }, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  assert.match(res.output, /chars: 30/);
  assert.match(res.output, /words: 5 \(unique 5\)/);
  assert.match(res.output, /lines: 2/);
  assert.match(res.output, /sentences: 2/);
  assert.match(res.output, /bytes: 30/);
  assert.match(res.output, /reading time: ~2s/);

  writeFileSync(join(WS, 'stats.txt'), text);
  const byFile = await run('text_stats', { path: 'stats.txt' }, stubCtx(WS));
  assert.equal(byFile.ok, true, byFile.output);
  assert.match(byFile.output, /chars: 30/);

  const none = await run('text_stats', {}, stubCtx(WS));
  assert.equal(none.ok, false);
});

// ============================================================
// 9. diff_files
// ============================================================
test('diff_files produces an exact unified diff and honest identical/missing cases', async () => {
  writeFileSync(join(WS, 'a.txt'), 'one\ntwo\nthree\n');
  writeFileSync(join(WS, 'b.txt'), 'one\ntwo\nTHREE\nfour\n');
  const res = await run('diff_files', { a: 'a.txt', b: 'b.txt' }, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  assert.match(res.output, /@@ -1,3 \+1,4 @@/);
  assert.match(res.output, /^ one$/m);
  assert.match(res.output, /^-three$/m);
  assert.match(res.output, /^\+THREE$/m);
  assert.match(res.output, /^\+four$/m);

  writeFileSync(join(WS, 'same.txt'), 'one\ntwo\nthree\n');
  const same = await run('diff_files', { a: 'a.txt', b: 'same.txt' }, stubCtx(WS));
  assert.match(same.output, /\(files are identical\)/);

  const missing = await run('diff_files', { a: 'a.txt', b: 'ghost.txt' }, stubCtx(WS));
  assert.equal(missing.ok, false);
  assert.match(missing.output, /not found/);
});

// ============================================================
// 10. color_convert / url_encode / url_decode
// ============================================================
test('color_convert: exact hex↔rgb↔hsl conversions + honest parse failure', async () => {
  const red = await run('color_convert', { color: '#ff0000' }, stubCtx(WS));
  assert.equal(red.output, 'hex #ff0000 · rgb(255, 0, 0) · hsl(0, 100%, 50%)');

  const green = await run('color_convert', { color: 'hsl(120, 100%, 50%)' }, stubCtx(WS));
  assert.match(green.output, /#00ff00/);
  assert.match(green.output, /rgb\(0, 255, 0\)/);

  const blue = await run('color_convert', { color: 'rgb(0, 0, 255)' }, stubCtx(WS));
  assert.match(blue.output, /#0000ff/);
  assert.match(blue.output, /hsl\(240, 100%, 50%\)/);

  const short = await run('color_convert', { color: '#f00' }, stubCtx(WS));
  assert.match(short.output, /#ff0000/);

  const bad = await run('color_convert', { color: 'definitely-not-a-color' }, stubCtx(WS));
  assert.equal(bad.ok, false);
  assert.match(bad.output, /could not parse/);
});

test('url_encode / url_decode: exact component+uri results and honest malformed input', async () => {
  const enc = await run('url_encode', { text: 'hello world&more' }, stubCtx(WS));
  assert.equal(enc.output, 'hello%20world%26more');
  const encUri = await run('url_encode', { text: 'hello world&more', mode: 'uri' }, stubCtx(WS));
  assert.equal(encUri.output, 'hello%20world&more');
  const dec = await run('url_decode', { text: 'a%2Bb%20c' }, stubCtx(WS));
  assert.equal(dec.output, 'a+b c');
  const bad = await run('url_decode', { text: '%' }, stubCtx(WS));
  assert.equal(bad.ok, false);
  assert.match(bad.output, /failed/);
});

// ============================================================
// 11. markdown_outline
// ============================================================
test('markdown_outline extracts the heading tree with line numbers, skipping code fences', async () => {
  const md = ['# Top\n', '\n', '## Sub section\n', '\n', 'text with # not-a-heading\n', '\n', '```sh\n', '# comment in code\n', '```\n', '### Deep\n'].join('');
  writeFileSync(join(WS, 'doc.md'), md);
  const res = await run('markdown_outline', { path: 'doc.md' }, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  assert.match(res.output, /3 heading\(s\)/);
  assert.match(res.output, /L1 # Top/);
  assert.match(res.output, /L3 ## Sub section/);
  assert.match(res.output, /L10 ### Deep/);
  assert.ok(!res.output.includes('comment in code'), 'code-fence lines must be skipped');

  const inline = await run('markdown_outline', { text: 'plain text, no headings' }, stubCtx(WS));
  assert.match(inline.output, /no ATX/);
});

// ============================================================
// 12. json_format — pretty/sort/validate with the first-error path
// ============================================================
test('json_format: pretty + sort exact, minify exact, invalid JSON reports line/column/path', async () => {
  const pretty = await run('json_format', { text: '{"b":1,"a":{"d":2,"c":3}}' }, stubCtx(WS));
  assert.equal(pretty.ok, true, pretty.output);
  assert.equal(pretty.output, JSON.stringify({ b: 1, a: { d: 2, c: 3 } }, null, 2));

  const sorted = await run('json_format', { text: '{"b":1,"a":{"d":2,"c":3}}', sort: true, action: 'minify' }, stubCtx(WS));
  assert.equal(sorted.output, '{"a":{"c":3,"d":2},"b":1}');

  const valid = await run('json_format', { text: '[1,2,3]', action: 'validate' }, stubCtx(WS));
  assert.equal(valid.ok, true);
  assert.match(valid.output, /VALID JSON — top-level array\[3\]/);

  const invalid = await run('json_format', { text: '{"a": [1, 2,}' }, stubCtx(WS));
  assert.equal(invalid.ok, false);
  assert.match(invalid.output, /INVALID JSON/);
  assert.match(invalid.output, /line 1, column \d+/);
  assert.match(invalid.output, /approximate path: a\[2\]/);

  const missing = await run('json_format', { path: 'ghost.json' }, stubCtx(WS));
  assert.equal(missing.ok, false);
  assert.match(missing.output, /not found/);
});

// ============================================================
// 13. ui-quality NO-WRITE SKIP (the A3 defect fix)
// ============================================================
test('ui_quality_check: zero-write turn + unresolvable target → explicit PASS-skip (no phantom fix round)', async () => {
  // Fresh session, nothing ever written — the engine gate probes a target
  // args-tracked from a DENIED/FAILED write: this must NOT read as a failure.
  const ctx = stubCtx(WS, { sessionId: 'uq-nowrite', approve: false });
  const deniedWrite = await run('write_file', { path: 'ghost-page.html', content: '<h1>x</h1>' }, ctx);
  assert.equal(deniedWrite.ok, false, 'denied write must fail (approval off)');
  const res = await run('ui_quality_check', { path: 'ghost-page.html' }, stubCtx(WS, { sessionId: 'uq-nowrite' }));
  assert.equal(res.ok, true, res.output);
  assert.match(res.output, /RESULT: PASS \(skipped\)/);
  assert.match(res.output, /wrote no files/);
  // The engine gate treats a report as "failed" unless it matches /RESULT: PASS/ —
  // this output MUST match, otherwise a ~60s phantom fix round starts.
  assert.ok(/RESULT: PASS/.test(res.output), 'gate regex would fire a phantom fix round');
});

test('ui_quality_check: real build turns keep the honest probe behavior', async () => {
  const ctx = stubCtx(WS, { sessionId: 'uq-build' });
  const w = await run('write_file', { path: 'page.html', content: '<!doctype html><html><head><title>t</title></head><body><h1>ok</h1></body></html>' }, ctx);
  assert.equal(w.ok, true, w.output);

  // a DIFFERENT unresolvable target after a REAL write → honest error (fix round is correct here)
  const ghost = await run('ui_quality_check', { path: 'ghost.html' }, stubCtx(WS, { sessionId: 'uq-build' }));
  assert.match(ghost.output, /ERROR: could not resolve the target/);
  assert.ok(!/RESULT: PASS/.test(ghost.output), 'a real build turn must NOT get the no-write skip');

  // the WRITTEN page resolves → the real probe pipeline runs (headless → probe-error finding, NOT a skip)
  const probe = await run('ui_quality_check', { path: 'page.html' }, stubCtx(WS, { sessionId: 'uq-build' }));
  assert.match(probe.output, /UI quality report — file:/);
  assert.ok(!/RESULT: PASS \(skipped\)/.test(probe.output));
});

// ============================================================
// 14. housekeeping
// ============================================================
test('cleanup temp workspace', () => {
  rmSync(WS, { recursive: true, force: true });
  assert.ok(true);
});
