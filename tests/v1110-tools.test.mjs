import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.10 — builder-arsenal tests (A3 wave 2)
// Honest-tooling contract: every NEW tool must (a) be registered,
// (b) really execute on its success path, and (c) fail HONESTLY
// (missing dependency / denied approval / bad input) — never fake
// success. Registry must hold ≥ 100 real tools.
// Run: node --test tests/v1110-tools.test.mjs   (requires `npm i`)
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

// The agent browser is Electron-only — force the honest headless path.
process.env.SURNIA_NO_BROWSER = '1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1110-'));

// ---------- esbuild bundle (same posture as v31-harness) ----------
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

// electron stub for plain-Node execution
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
    sessionId: 'v1110-test',
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

// ---------- 1. registry ----------
test('v11.10 registry holds ≥100 real tools with the new arsenal registered', () => {
  const defs = tools.getToolDefs([]);
  assert.ok(defs.length >= 100, `registry count ${defs.length} < 100`);
  const names = new Set(defs.map((d) => d.name));
  const expected = [
    'pdf_make', 'pptx_make', 'docx_make', 'xlsx_make', 'export_project', 'diagnose_preview',
    'browser_download', 'browser_console', 'browser_console_eval', 'browser_pdf',
    'sqlite_query', 'env_install', 'search_grep', 'git_local', 'image_probe',
  ];
  for (const name of expected) {
    assert.ok(names.has(name), `${name} missing from registry`);
    const def = defs.find((d) => d.name === name);
    assert.ok(def.parameters && typeof def.parameters === 'object', `${name} has no input schema`);
    assert.ok(Array.isArray(def.parameters.required), `${name} schema missing required list`);
  }
  // every core def has a dispatch handler (smoke-checked by the per-tool tests below)
});

// ---------- 2. pdf_make ----------
test('pdf_make builds a REAL PDF in the workspace (offline renderer), honors approval denial', async () => {
  const res = await run('pdf_make', {
    path: 'reports/demo.pdf',
    title: 'Quarterly Report',
    content: '# Q3 Report\n\nRevenue **grew** 12%.\n\n- item one\n- item two\n\n```js\nconsole.log("hi");\n```\n\n| KPI | value |\n|---|---|\n| MRR | 42k |',
  }, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  const file = join(WS, 'reports', 'demo.pdf');
  assert.ok(existsSync(file), 'pdf file missing');
  const buf = readFileSync(file);
  assert.ok(buf.slice(0, 5).toString() === '%PDF-', 'not a real PDF header');
  assert.ok(buf.length > 400, 'pdf suspiciously small');
  assert.match(res.output, /PDF created/);

  // honest-failure path: denial refuses the write
  const denied = await run('pdf_make', { path: 'no.pdf', content: 'x' }, stubCtx(WS, { approve: false }));
  assert.equal(denied.ok, false);
  assert.ok(existsSync(join(WS, 'no.pdf')) === false, 'denied pdf must not exist');
});

// ---------- 3-5. pptx/docx/xlsx makers ----------
test('pptx_make builds a REAL .pptx (zip container) via python-pptx', async () => {
  const res = await run('pptx_make', {
    path: 'decks/launch.pptx',
    title: 'Launch Deck',
    slides: [
      { title: 'Why now', bullets: ['market growing', 'tech ready'], notes: 'speak slowly' },
      { title: 'Roadmap', bullets: ['Q1 alpha', 'Q2 beta'] },
    ],
  }, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  const file = join(WS, 'decks', 'launch.pptx');
  assert.ok(existsSync(file));
  assert.equal(readFileSync(file).slice(0, 2).toString(), 'PK', 'pptx is not a zip container');
}, { timeout: 60_000 });

test('pptx_make fails honestly without slides and on escaping paths', async () => {
  const noSlides = await run('pptx_make', { path: 'a.pptx' }, stubCtx(WS));
  assert.equal(noSlides.ok, false);
  assert.match(noSlides.output, /slides/);
  const esc = await run('pptx_make', { path: '../outside.pptx', slides: [{ title: 'x' }] }, stubCtx(WS, { approve: false }));
  // v11.37 (M1) — outside-workspace is an honest refusal OR an explicit
  // approval escalation, never a silent external write.
  if (!esc.ok) {
    assert.match(esc.output, /outside|workspace|escap|approv|fix/i);
  } else {
    assert.match(esc.output, /approv|escape|confirm|fullAccess/i, 'external write must be an explicit escalation');
  }
});

function pyModuleAvailable(mod) {
  for (const py of ['python', 'python3']) {
    if (spawnSync(py, ['-c', `import ${mod}`], { timeout: 5000, stdio: 'ignore' }).status === 0) return true;
  }
  return false;
}

test('docx_make builds a REAL .docx via python-docx (headings+table)', async (t) => {
  if (!pyModuleAvailable('docx')) return t.skip('python-docx not installed in this environment');
  const res = await run('docx_make', {
    path: 'docs/word.docx',
    title: 'Contract',
    content: '# Contract\n\n| Term | value |\n|---|---|\n| fee | 100 |\n\n- bullet one\n',
  }, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  const file = join(WS, 'docs', 'word.docx');
  assert.ok(existsSync(file));
  assert.equal(readFileSync(file).slice(0, 2).toString(), 'PK');
}, { timeout: 60_000 });

test('xlsx_make builds a REAL .xlsx via openpyxl (sheets grid + csv)', async (t) => {
  if (!pyModuleAvailable('openpyxl')) return t.skip('openpyxl not installed in this environment');
  const res = await run('xlsx_make', {
    path: 'data/numbers.xlsx',
    sheets: [{ name: 'KPIs', rows: [['name', 'value'], ['mrr', 4200]] }],
  }, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  const file = join(WS, 'data', 'numbers.xlsx');
  assert.ok(existsSync(file));
  assert.equal(readFileSync(file).slice(0, 2).toString(), 'PK');
}, { timeout: 60_000 });

// ---------- 6. export_project ----------
test('export_project runs the real build and zips the output; honest failure without package.json', async () => {
  const proj = join(WS, 'tiny-app');
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, 'package.json'), JSON.stringify({
    name: 'tiny-app',
    scripts: { build: 'node -e "require(\'fs\').mkdirSync(\'dist\',{recursive:true}); require(\'fs\').writeFileSync(\'dist/index.html\',\'<h1>hi</h1>\'); require(\'fs\').writeFileSync(\'dist/app.js\',\'console.log(1)\')" ' },
  }, null, 2));
  const res = await run('export_project', { dir: 'tiny-app' }, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  const zipPath = join(WS, 'tiny-app-export.zip');
  assert.ok(existsSync(zipPath), 'zip missing');
  const zipBuf = readFileSync(zipPath);
  assert.equal(zipBuf.slice(0, 2).toString(), 'PK');
  assert.match(res.output, /Export ready/);
  assert.match(res.output, /2 files/);

  const empty = mkdtempSync(join(tmpdir(), 'v1110-nopkg-'));
  const bad = await run('export_project', {}, stubCtx(empty));
  assert.equal(bad.ok, false);
  assert.match(bad.output, /no package\.json/);
  rmSync(empty, { recursive: true, force: true });
}, { timeout: 120_000 });

// ---------- 7. diagnose_preview ----------
test('diagnose_preview returns a structured read-only report', async () => {
  const res = await run('diagnose_preview', {}, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  assert.match(res.output, /PREVIEW DIAGNOSIS/);
  assert.match(res.output, /dev server:/);
  assert.match(res.output, /package\.json/);
});

// ---------- 8. browser_download ----------
test('browser_download honors SSRF guard, allowlist refusal, and really downloads assets', async () => {
  // honest failure 1: loopback blocked without fullAccess
  const blocked = await run('browser_download', { url: 'http://127.0.0.1:9/x', dest: 'x.txt' }, stubCtx(WS));
  assert.equal(blocked.ok, false);
  assert.match(blocked.output, /Blocked host|failed/);

  const server = http.createServer((req, res) => {
    if (req.url === '/evil') { res.writeHead(200, { 'content-type': 'text/vbscript' }); res.end('WScript.Shell'); return; }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': 11 });
    res.end('hello-asset');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    // honest failure 2: content-type not on the allowlist (fullAccess ctx so the fetch itself proceeds)
    const refused = await run('browser_download', { url: `http://127.0.0.1:${port}/evil`, dest: 'evil.txt' }, stubCtx(WS, { fullAccess: true }));
    assert.equal(refused.ok, false);
    assert.match(refused.output, /refused|allowlist|Blocked host/);

    const res = await run('browser_download', { url: `http://127.0.0.1:${port}/asset.txt`, dest: 'assets/asset.txt' }, stubCtx(WS, { fullAccess: true }));
    assert.equal(res.ok, true, res.output);
    const file = join(WS, 'assets', 'asset.txt');
    assert.ok(existsSync(file));
    assert.equal(readFileSync(file, 'utf8'), 'hello-asset');
  } finally {
    server.close();
  }
}, { timeout: 30_000 });

// ---------- 9. browser console/pdf honest headless errors ----------
test('browser_console / browser_console_eval / browser_pdf fail honestly in headless contexts', async () => {
  const a = await run('browser_console', {}, stubCtx(WS));
  assert.equal(a.ok, false);
  assert.match(a.output, /unavailable in this headless context/);
  const b = await run('browser_console_eval', { expression: '1+1' }, stubCtx(WS));
  assert.equal(b.ok, false);
  assert.match(b.output, /unavailable in this headless context/);
  const c = await run('browser_pdf', { dest: 'p.pdf' }, stubCtx(WS));
  assert.equal(c.ok, false);
  assert.match(c.output, /unavailable in this headless context/);
});

// ---------- 10. sqlite_query ----------
test('sqlite_query reads REAL data (node:sqlite), refuses writes in read-only mode, honest missing-db error', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const dbPath = join(WS, 'app.db');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users (name) VALUES (\'سلمى\'), (\'Omar\');');
  db.close();

  const res = await run('sqlite_query', { db: 'app.db', sql: 'SELECT id, name FROM users ORDER BY id' }, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  assert.match(res.output, /node:sqlite/);
  assert.match(res.output, /سلمى/);
  assert.match(res.output, /2 row/);

  const refused = await run('sqlite_query', { db: 'app.db', sql: "DELETE FROM users" }, stubCtx(WS));
  assert.equal(refused.ok, false);
  assert.match(refused.output, /WRITE statement|read-only/);

  const missing = await run('sqlite_query', { db: 'ghost.db', sql: 'SELECT 1' }, stubCtx(WS));
  assert.equal(missing.ok, false);
  assert.match(missing.output, /not found/);

  // approved write path really mutates
  const write = await run('sqlite_query', { db: 'app.db', sql: "INSERT INTO users (name) VALUES ('Lina')", write: true }, stubCtx(WS));
  assert.equal(write.ok, true, write.output);
  const check = await run('sqlite_query', { db: 'app.db', sql: 'SELECT count(*) AS n FROM users' }, stubCtx(WS));
  assert.match(check.output, /\|\s*3\s*\|/); // count(*) = 3 after the approved insert
});

// ---------- 11. env_install ----------
test('env_install runs npm install for real; honest failure for unknown manager', async () => {
  const proj = join(WS, 'zero-deps');
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'zero-deps', version: '0.0.0', private: true }));
  const res = await run('env_install', { manager: 'npm', cwd: 'zero-deps' }, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  assert.ok(existsSync(join(proj, 'package-lock.json')), 'npm install produced no lockfile');

  const bad = await run('env_install', { manager: 'cocoa' }, stubCtx(WS));
  assert.equal(bad.ok, false);
  // v11.26 — enum validation now names the bad value + the exact fix (better
  // than the old bare "Unknown manager"); accept either honest wording.
  assert.match(bad.output, /Unknown manager|must be one of npm \| pnpm \| yarn \| bun \| pip/i);
}, { timeout: 120_000 });

// ---------- 12. search_grep ----------
test('search_grep returns file:line:match with a labeled engine', async () => {
  writeFileSync(join(WS, 'haystack.md'), 'line one NEEDLE here\nline two\n');
  mkdirSync(join(WS, 'sub'), { recursive: true });
  writeFileSync(join(WS, 'sub', 'other.txt'), 'another NEEDLE\n');
  const res = await run('search_grep', { pattern: 'needle', glob: '*.{md,txt}' }, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  assert.match(res.output, /haystack\.md:1:/);
  assert.match(res.output, /sub[\\/]other\.txt:1:/);
  assert.match(res.output, /\[engine: (ripgrep|js-walker)\]/);
});

// ---------- 13. git_local ----------
test('git_local does a REAL init→add→commit flow and reports honest not-a-repo errors', async () => {
  const repo = join(WS, 'repo');
  mkdirSync(repo, { recursive: true });
  const repoCtx = stubCtx(repo);

  const noRepo = await run('git_local', { action: 'status' }, repoCtx);
  assert.equal(noRepo.ok, false);
  assert.match(noRepo.output, /Not a git repository/);

  writeFileSync(join(repo, 'file.txt'), 'content\n');
  const init = await run('git_local', { action: 'init' }, repoCtx);
  assert.equal(init.ok, true, init.output);
  const add = await run('git_local', { action: 'add', paths: ['file.txt'] }, repoCtx);
  assert.equal(add.ok, true, add.output);
  const commit = await run('git_local', { action: 'commit', message: 'first commit' }, repoCtx);
  assert.equal(commit.ok, true, commit.output);
  assert.match(commit.output, /Committed [0-9a-f]+/);
  const status = await run('git_local', { action: 'status' }, repoCtx);
  assert.match(status.output, /working tree clean|branch:/);
  const escaped = await run('git_local', { action: 'add', paths: ['../outside.txt'] }, repoCtx);
  assert.equal(escaped.ok, false);
  assert.match(escaped.output, /outside the workspace/);
});

// ---------- 14. image_probe ----------
test('image_probe parses REAL PNG dimensions and fails honestly on unknown bytes', async () => {
  const png1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  writeFileSync(join(WS, 'pixel.png'), png1x1);
  const res = await run('image_probe', { path: 'pixel.png' }, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  assert.match(res.output, /PNG/);
  assert.match(res.output, /1×1px/);

  writeFileSync(join(WS, 'mystery.bin'), Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x11, 0x22, 0x33, 0x44]));
  const unknown = await run('image_probe', { path: 'mystery.bin' }, stubCtx(WS));
  assert.equal(unknown.ok, false);
  assert.match(unknown.output, /format not recognized/);
});

// ---------- 15. env_probe reports the new optional deps ----------
test('env_probe reports rg + python modules + node:sqlite so the model knows what will work', async () => {
  const res = await run('env_probe', {}, stubCtx(WS));
  assert.equal(res.ok, true, res.output);
  assert.match(res.output, /rg: (yes|no)/);
  assert.match(res.output, /python modules: python-pptx (yes|no)\s+python-docx (yes|no)\s+openpyxl (yes|no)/);
  assert.match(res.output, /sqlite: node:sqlite (yes|no)/);
}, { timeout: 60_000 });

