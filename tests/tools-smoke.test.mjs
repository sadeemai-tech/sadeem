import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.11 — A5-TOOLS literal smoke audit (founder mandate)
// "the AI could not actually use most of its tools" — this file
// proves the opposite for v11.11, literally:
//   (1) INVENTORY: getToolDefs() holds exactly 118 tools and
//       matches src/generated/toolInventory.json (gen-tool-inventory).
//   (2) WIRING: EVERY one of the 118 names reaches a real executor
//       through executeTool (never "Unknown tool", never a crash).
//   (3) FOUNDER SCENARIOS, fixture-backed, REAL executors:
//       - "go on the internet and bring me an image":
//         image_search (local Openverse fixture server) →
//         browser_download / download_file (real TCP download) →
//         read_image (vision data URL) → image_probe (dimensions).
//       - web_search: DuckDuckGo HTML parser proven against a
//         fixture page (mocked fetch — DDG is blocked in CI),
//         plus honest offline failure.
//       - pdf (make→read round-trip), docx, xlsx, csv (write→read),
//         sqlite, git, zip (archive_create→archive_extract),
//         hash, diff — every one executes on real fixture files.
// Run: node --test --test-force-exit tests/tools-smoke.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-tools-smoke-'));

// ---------- esbuild bundle (same posture as v1110-tools / v1111-tools2) ----------
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

// electron stub for plain-Node execution (mirrors the established test stub)
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

// ---------- stub ToolContext ----------
function stubCtx(ws, opts = {}) {
  const approvals = [];
  return {
    workspace: ws,
    sessionId: 'a5-tools-smoke',
    mcpServers: [],
    emit: () => {},
    approve: async (req) => {
      approvals.push(req.kind + ':' + (opts.approve === false ? 'DENIED' : 'ok'));
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
const defs = tools.getToolDefs([]);
const byName = new Map(defs.map((d) => [d.name, d]));

// 1x1 real PNG (same fixture bytes as v1110-tools)
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

// ============================================================
// 1. INVENTORY — exact count, cross-checked with the generated JSON
// ============================================================
test('INVENTORY: registered tools are unique, fully-schema’d and match gen-tool-inventory.json', () => {
  // v12 — the count is derived from the generated inventory (single source of
  // truth), so adding a tool never requires editing this test's magic number.
  const inv = JSON.parse(readFileSync(join(ROOT, 'src/generated/toolInventory.json'), 'utf8'));
  const EXPECTED = inv.total;
  assert.ok(defs.length >= 117, `registry count ${defs.length} regressed below the 117-tool baseline`);
  assert.equal(defs.length, EXPECTED, `registry count ${defs.length} drifted from generated inventory ${EXPECTED} — run scripts/gen-tool-inventory.mjs`);
  const names = defs.map((d) => d.name);
  assert.equal(new Set(names).size, EXPECTED, 'duplicate tool names in registry');
  assert.equal(inv.total, EXPECTED, 'toolInventory.json total drifted from the live registry');
  assert.deepEqual(
    [...names].sort(),
    [...inv.tools.map((t) => t.name)].sort(),
    'toolInventory.json tool list drifted from getToolDefs()',
  );

  for (const d of defs) {
    assert.ok(d.description && d.description.length > 10, `${d.name}: missing description`);
    assert.ok(d.parameters && typeof d.parameters === 'object', `${d.name}: missing input schema`);
    assert.equal(d.parameters.type, 'object', `${d.name}: schema type must be object`);
    assert.ok(Array.isArray(d.parameters.required), `${d.name}: schema missing required list`);
    assert.ok(['fs', 'exec', 'meta', 'mcp'].includes(d.kind), `${d.name}: unknown kind ${d.kind}`);
  }
});

// ============================================================
// 2. WIRING — every one of the 118 tools reaches a REAL executor
// (empty args → the executor answers with its own honest param
// error; a stub/missing case would answer "Unknown tool" or crash)
// ============================================================
test('WIRING: all 118 tools dispatch to a real executor — no Unknown tool, no crash', async () => {
  const ctx = stubCtx(WS);
  const broken = [];
  for (const d of defs) {
    let res;
    try {
      res = await tools.executeTool(d.name, '{}', ctx);
    } catch (err) {
      broken.push(`${d.name}: THREW ${err.message}`);
      continue;
    }
    if (!res || typeof res.output !== 'string' || !res.output.length) {
      broken.push(`${d.name}: empty/missing output`);
      continue;
    }
    if (/^Unknown tool:/.test(res.output)) broken.push(`${d.name}: ${res.output}`);
  }
  assert.deepEqual(broken, [], `tools with missing/broken executors: ${broken.join('; ')}`);
});

// ============================================================
// 3. FOUNDER SCENARIO — "go on the internet and bring me an image"
// image_search (fixture Openverse server) → browser_download /
// download_file (REAL download over TCP) → read_image (vision) →
// image_probe (verify dimensions)
// ============================================================
async function withImageServer(fn) {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/v1/images/')) {
      const body = JSON.stringify({
        results: [
          {
            title: 'Sunset over the dunes',
            id: 'abc123',
            url: `http://127.0.0.1:${server.address().port}/assets/sunset.png`,
            thumbnail: `http://127.0.0.1:${server.address().port}/assets/sunset_thumb.png`,
            foreign_landing_url: 'https://example.org/photos/sunset',
            license: 'cc0',
            license_version: '1.0',
            creator: 'Test Photographer',
            width: 1,
            height: 1,
          },
        ],
      });
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    if (req.url.startsWith('/assets/sunset.png')) {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG_1X1.length });
      res.end(PNG_1X1);
      return;
    }
    if (req.url.startsWith('/notes.txt')) {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': 11 });
      res.end('hello-asset');
      return;
    }
    res.writeHead(404);
    res.end('nope');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await fn(server.address().port);
  } finally {
    server.close();
  }
}

test('IMAGE CHAIN: image_search → browser_download → read_image → image_probe (the founder scenario, end to end)', async () => {
  await withImageServer(async (port) => {
    process.env.SADEEM_OPENVERSE_BASE = `http://127.0.0.1:${port}`;
    try {
      const ctx = stubCtx(WS, { fullAccess: true });

      // 1) search the (fixture) internet
      const s = await run('image_search', { query: 'sunset dunes', max_results: 3 }, ctx);
      assert.equal(s.ok, true, s.output);
      assert.match(s.output, /Sunset over the dunes/);
      assert.match(s.output, /cc0 1\.0/);
      assert.match(s.output, /url: http:\/\/127\.0\.0\.1:\d+\/assets\/sunset\.png/);
      assert.match(s.output, /NEXT: download your pick/);
      assert.match(s.output, /UNTRUSTED IMAGE SEARCH/); // injection-fence posture

      // 2) bring it home — browser_download writes REAL bytes into the workspace
      const dl = await run(
        'browser_download',
        { url: `http://127.0.0.1:${port}/assets/sunset.png`, dest: 'assets/sunset.png' },
        ctx,
      );
      assert.equal(dl.ok, true, dl.output);
      const onDisk = join(WS, 'assets', 'sunset.png');
      assert.ok(existsSync(onDisk), 'downloaded image missing from workspace');
      assert.ok(PNG_1X1.equals(readFileSync(onDisk)), 'downloaded bytes differ from the served PNG');

      // 3) SEE it — read_image returns the vision data URL
      const rd = await run('read_image', { path: 'assets/sunset.png' }, ctx);
      assert.equal(rd.ok, true, rd.output);
      const payload = JSON.parse(rd.output);
      assert.equal(payload.ok, true);
      assert.equal(payload.mime, 'image/png');
      assert.ok(payload.dataUrl.startsWith('data:image/png;base64,'), 'no vision data URL');
      assert.ok(PNG_1X1.equals(Buffer.from(payload.dataUrl.split(',')[1], 'base64')));

      // 4) VERIFY it — image_probe parses the real header
      const pr = await run('image_probe', { path: 'assets/sunset.png' }, ctx);
      assert.equal(pr.ok, true, pr.output);
      assert.match(pr.output, /PNG/);
      assert.match(pr.output, /1×1px/);

      // 4b) download_file (the arbitrary-binary sibling) also lands real bytes
      const df = await run(
        'download_file',
        { url: `http://127.0.0.1:${port}/notes.txt`, dest: 'downloads/notes.txt' },
        ctx,
      );
      assert.equal(df.ok, true, df.output);
      assert.equal(readFileSync(join(WS, 'downloads', 'notes.txt'), 'utf8'), 'hello-asset');
    } finally {
      delete process.env.SADEEM_OPENVERSE_BASE;
    }
  });
}, { timeout: 60_000 });

test('IMAGE CHAIN honesty: SSRF guard blocks loopback without fullAccess; image_search fails honestly offline; missing query refused', async () => {
  await withImageServer(async (port) => {
    // no fullAccess → loopback is refused by the SSRF guard (both download tools)
    const b1 = await run('browser_download', { url: `http://127.0.0.1:${port}/assets/sunset.png`, dest: 'x.png' }, stubCtx(WS));
    assert.equal(b1.ok, false);
    assert.match(b1.output, /Blocked host \(SSRF guard\)/);
    const b2 = await run('download_file', { url: `http://127.0.0.1:${port}/assets/sunset.png`, dest: 'x.png' }, stubCtx(WS));
    assert.equal(b2.ok, false);
    assert.match(b2.output, /Blocked host \(SSRF guard\)/);
    const b3 = await run('web_fetch', { url: `http://127.0.0.1:${port}/notes.txt` }, stubCtx(WS));
    assert.equal(b3.ok, false);
    assert.match(b3.output, /Blocked host \(SSRF guard\)/);

    // offline → honest network error naming the API and alternatives
    process.env.SADEEM_OPENVERSE_BASE = 'http://127.0.0.1:9'; // discard port, nothing listens
    try {
      const off = await run('image_search', { query: 'cat' }, stubCtx(WS, { fullAccess: true }));
      assert.equal(off.ok, false);
      assert.match(off.output, /image_search failed \(network\)/);
      assert.match(off.output, /Openverse/);
    } finally {
      delete process.env.SADEEM_OPENVERSE_BASE;
    }

    // missing query → honest refusal
    const noq = await run('image_search', {}, stubCtx(WS));
    assert.equal(noq.ok, false);
    assert.match(noq.output, /Missing required parameter: query/);
  });
}, { timeout: 30_000 });

// ============================================================
// 4. web_search — DDG HTML parser proven on a fixture (mocked fetch;
// html.duckduckgo.com is blocked in this sandbox), plus honest failure
// ============================================================
const DDG_FIXTURE_HTML = `<!DOCTYPE html><html><head><title>q at DuckDuckGo</title></head><body>
<div class="result">
<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fsadeem&amp;rut=abc">SADEEM official site</a>
<a class="result__snippet" href="//duckduckgo.com/x">The agent that actually uses its 118 tools.</a>
</div>
<div class="result">
<a rel="nofollow" class="result__a" href="/l/?uddg=https%3A%2F%2Fdocs.example.org%2Fguide&amp;rut=def">Docs &amp; guides</a>
<a class="result__snippet" href="#z">Documentation for builders.</a>
</div>
</body></html>`;

test('web_search: parses REAL DuckDuckGo result HTML (fixture) — uddg-decoded URLs, titles, snippets, injection fence', async () => {
  const noq = await run('web_search', {}, stubCtx(WS));
  assert.equal(noq.ok, false);
  assert.match(noq.output, /Missing required parameter: query/);

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(DDG_FIXTURE_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
  try {
    const res = await run('web_search', { query: 'sadeem tools' }, stubCtx(WS));
    assert.equal(res.ok, true, res.output);
    assert.match(res.output, /1\. SADEEM official site/);
    assert.match(res.output, /https:\/\/example\.com\/sadeem/); // uddg param decoded
    assert.match(res.output, /agent that actually uses its 118 tools/); // snippet kept
    assert.match(res.output, /https:\/\/docs\.example\.org\/guide/);
    assert.match(res.output, /UNTRUSTED SEARCH RESULTS/); // web data is fenced
    // second web_search hit (search_web) shares the parser and adds the taint mark
    const res2 = await run('search_web', { query: 'sadeem tools', max_results: 1 }, stubCtx(WS));
    assert.equal(res2.ok, true, res2.output);
    assert.match(res2.output, /SADEEM official site/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('web_search: honest failure when the network is down', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('getaddrinfo ENOTFOUND html.duckduckgo.com');
  };
  try {
    const res = await run('web_search', { query: 'anything' }, stubCtx(WS));
    assert.equal(res.ok, false);
    assert.match(res.output, /Search failed|Web search is currently unavailable/i);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ============================================================
// 5. pdf — pdf_make → pdf_read round-trip on real bytes
// ============================================================
test('pdf: pdf_make writes a REAL %PDF- file; pdf_read extracts its text back out', async () => {
  const mk = await run('pdf_make', {
    path: 'reports/audit.pdf',
    title: 'Tool Audit',
    content: '# Tool Audit\n\nAll 118 tools are REAL in v11.11.\n\n- image_search works\n- hash_file works',
  }, stubCtx(WS));
  assert.equal(mk.ok, true, mk.output);
  const pdfPath = join(WS, 'reports', 'audit.pdf');
  assert.ok(existsSync(pdfPath));
  const buf = readFileSync(pdfPath);
  assert.ok(buf.slice(0, 5).toString() === '%PDF-', 'not a real PDF header');
  mkdirSync(join(WS, 'docs'), { recursive: true });
  writeFileSync(join(WS, 'docs', 'plain.txt'), 'just text, not a pdf\n');
  const rd = await run('pdf_read', { path: 'reports/audit.pdf' }, stubCtx(WS));
  assert.equal(rd.ok, true, rd.output);
  assert.match(rd.output, /content stream/);
  assert.match(rd.output, /Tool Audit|118 tools/);

  const bad = await run('pdf_read', { path: 'docs/plain.txt' }, stubCtx(WS));
  assert.equal(bad.ok, false);
  assert.match(bad.output, /missing %PDF- header/);
}, { timeout: 60_000 });

// ============================================================
// 6. docx / xlsx — real office containers via python writers
// ============================================================
function pyModuleAvailable(mod) {
  for (const py of ['python', 'python3']) {
    if (spawnSync(py, ['-c', `import ${mod}`], { timeout: 5000, stdio: 'ignore' }).status === 0) return true;
  }
  return false;
}

test('docx + xlsx: real zip-container office files are produced', async (t) => {
  if (!pyModuleAvailable('docx') || !pyModuleAvailable('openpyxl')) {
    return t.skip('python-docx / openpyxl not installed in this environment');
  }
  const doc = await run('docx_make', {
    path: 'docs/word-a5.docx',
    title: 'Audit Memo',
    content: '# Audit Memo\n\nEvery tool executor is real.\n',
  }, stubCtx(WS));
  assert.equal(doc.ok, true, doc.output);
  assert.equal(readFileSync(join(WS, 'docs', 'word-a5.docx')).slice(0, 2).toString(), 'PK');

  const xls = await run('xlsx_make', {
    path: 'data/numbers-a5.xlsx',
    sheets: [{ name: 'KPIs', rows: [['tool', 'status'], ['image_search', 'REAL'], ['hash_file', 'REAL']] }],
  }, stubCtx(WS));
  assert.equal(xls.ok, true, xls.output);
  assert.equal(readFileSync(join(WS, 'data', 'numbers-a5.xlsx')).slice(0, 2).toString(), 'PK');
}, { timeout: 120_000 });

// ============================================================
// 7. csv — csv_write → csv_read round-trip (quoted fields, commas, newlines)
// ============================================================
test('csv: csv_write → csv_read round-trips quoted commas/newlines; denial honored', async () => {
  const rows = [
    ['name', 'note'],
    ['dune, sunset', 'line1\nline2'],
    ['said "hi"', 'plain'],
  ];
  const wr = await run('csv_write', { path: 'data/notes-a5.csv', rows }, stubCtx(WS));
  assert.equal(wr.ok, true, wr.output);

  const rd = await run('csv_read', { path: 'data/notes-a5.csv', header: true }, stubCtx(WS));
  assert.equal(rd.ok, true, rd.output);
  assert.match(rd.output, /2 data rows × 2 cols/);
  const json = JSON.parse(rd.output.split('\n')[1]);
  assert.equal(json[0].name, 'dune, sunset');
  assert.equal(json[0].note, 'line1\nline2');
  assert.equal(json[1].name, 'said "hi"');

  const denied = await run('csv_write', { path: 'data/nope.csv', rows }, stubCtx(WS, { approve: false }));
  assert.equal(denied.ok, false);
  assert.ok(!existsSync(join(WS, 'data', 'nope.csv')), 'denied csv must not exist');
});

// ============================================================
// 8. sqlite — real node:sqlite query against a fixture DB
// ============================================================
test('sqlite: sqlite_query reads REAL rows (node:sqlite); writes refused without write:true', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(join(WS, 'audit.db'));
  db.exec("CREATE TABLE tools (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO tools (name) VALUES ('image_search'), ('hash_file'), ('diff_files');");
  db.close();

  const res = await run('sqlite_query', { db: 'audit.db', sql: 'SELECT id, name FROM tools ORDER BY id' }, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  assert.match(res.output, /node:sqlite/);
  assert.match(res.output, /image_search/);
  assert.match(res.output, /3 row/);

  const refused = await run('sqlite_query', { db: 'audit.db', sql: 'DELETE FROM tools' }, stubCtx(WS));
  assert.equal(refused.ok, false);
  assert.match(refused.output, /WRITE statement|read-only/);

  const missing = await run('sqlite_query', { db: 'ghost.db', sql: 'SELECT 1' }, stubCtx(WS));
  assert.equal(missing.ok, false);
  assert.match(missing.output, /not found/);
});

// ============================================================
// 9. git — real init → add → commit → status flow
// ============================================================
test('git: git_local runs a REAL init→add→commit→status cycle; honest not-a-repo error', async () => {
  const repo = join(WS, 'a5-repo');
  mkdirSync(repo, { recursive: true });
  const ctx = stubCtx(repo);

  const noRepo = await run('git_local', { action: 'status' }, ctx);
  assert.equal(noRepo.ok, false);
  assert.match(noRepo.output, /Not a git repository/);

  writeFileSync(join(repo, 'audit.txt'), 'v11.11 tools are real\n');
  const init = await run('git_local', { action: 'init' }, ctx);
  assert.equal(init.ok, true, init.output);
  const add = await run('git_local', { action: 'add', paths: ['audit.txt'] }, ctx);
  assert.equal(add.ok, true, add.output);
  const commit = await run('git_local', { action: 'commit', message: 'a5 smoke' }, ctx);
  assert.equal(commit.ok, true, commit.output);
  assert.match(commit.output, /Committed [0-9a-f]+/);
  const status = await run('git_local', { action: 'status' }, ctx);
  assert.equal(status.ok, true, status.output);
  assert.match(status.output, /branch:|working tree clean/);
}, { timeout: 60_000 });

// ============================================================
// 10. zip — archive_create (real zip binary) → archive_extract round-trip
// ============================================================
test('zip: archive_create → archive_extract round-trips files through a REAL zip', async () => {
  mkdirSync(join(WS, 'pkg'), { recursive: true });
  writeFileSync(join(WS, 'pkg', 'one.txt'), 'first\n');
  writeFileSync(join(WS, 'pkg', 'two.txt'), 'second\n');

  const mk = await run('archive_create', { paths: ['pkg'], dest: 'dist/pkg.zip' }, stubCtx(WS));
  assert.equal(mk.ok, true, mk.output);
  const zipPath = join(WS, 'dist', 'pkg.zip');
  assert.ok(existsSync(zipPath), 'zip missing');
  assert.equal(readFileSync(zipPath).slice(0, 2).toString(), 'PK', 'not a real zip container');

  const badDest = await run('archive_create', { paths: ['pkg'], dest: 'dist/pkg.tar' }, stubCtx(WS));
  assert.equal(badDest.ok, false);
  assert.match(badDest.output, /dest must end with \.zip/);

  const ex = await run('archive_extract', { archive: 'dist/pkg.zip', destDir: 'unzipped' }, stubCtx(WS));
  assert.equal(ex.ok, true, ex.output);
  assert.equal(readFileSync(join(WS, 'unzipped', 'pkg', 'one.txt'), 'utf8'), 'first\n');
  assert.equal(readFileSync(join(WS, 'unzipped', 'pkg', 'two.txt'), 'utf8'), 'second\n');
}, { timeout: 60_000 });

// ============================================================
// 11. hash — exact sha256/md5 digests vs node:crypto
// ============================================================
test('hash: hash_file matches node:crypto digests exactly; compare + honest bad algo', async () => {
  writeFileSync(join(WS, 'payload.bin'), Buffer.from([1, 2, 3, 4, 5, 250]));
  const sha = crypto.createHash('sha256').update(readFileSync(join(WS, 'payload.bin'))).digest('hex');
  const res = await run('hash_file', { path: 'payload.bin', algorithm: 'sha256', compare: sha }, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  assert.match(res.output, new RegExp(`sha256: ${sha}`));
  assert.match(res.output, /compare: MATCH/);

  const md5 = crypto.createHash('md5').update(readFileSync(join(WS, 'payload.bin'))).digest('hex');
  const md5res = await run('hash_file', { path: 'payload.bin', algorithm: 'md5' }, stubCtx(WS));
  assert.match(md5res.output, new RegExp(`md5: ${md5}`));

  const bad = await run('hash_file', { path: 'payload.bin', algorithm: 'crc32' }, stubCtx(WS));
  assert.equal(bad.ok, false);
  // v11.26 — enum validation now names the bad value + exact allowed list.
assert.match(bad.output, /Unsupported algorithm|must be one of sha256 \| md5 \| sha1 \| sha512/i);
});

// ============================================================
// 12. diff — exact unified diff + honest identical/missing cases
// ============================================================
test('diff: diff_files produces an exact unified diff; identical + missing honest', async () => {
  writeFileSync(join(WS, 'v-old.txt'), 'alpha\nbeta\ngamma\n');
  writeFileSync(join(WS, 'v-new.txt'), 'alpha\nBETA\ngamma\ndelta\n');
  const res = await run('diff_files', { a: 'v-old.txt', b: 'v-new.txt' }, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  assert.match(res.output, /@@ -1,3 \+1,4 @@/);
  assert.match(res.output, /^.*-beta$/m);
  assert.match(res.output, /^.*\+BETA$/m);
  assert.match(res.output, /^.*\+delta$/m);

  const same = await run('diff_files', { a: 'v-old.txt', b: 'v-old.txt' }, stubCtx(WS));
  assert.equal(same.ok, true);
  assert.match(same.output, /\(files are identical\)/);

  const missing = await run('diff_files', { a: 'v-old.txt', b: 'ghost.txt' }, stubCtx(WS));
  assert.equal(missing.ok, false);
  assert.match(missing.output, /not found or not a file/);
});

// ============================================================
// cleanup
// ============================================================
test('cleanup temp workspace', () => {
  rmSync(tmp, { recursive: true, force: true });
  assert.ok(true);
});
