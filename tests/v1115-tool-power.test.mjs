// ============================================================
// SADEEM v11.15 — TOOL POWER (founder audit) contract tests
//
// The founder complained the agent "cannot download from the internet,
// cannot use the device/folders, cannot do LSP across languages". This
// suite proves the newly added tools are REAL and HONEST:
//   • registered + dispatch through the app's own executeTool
//   • web_download refuses unsafe URLs (scheme, SSRF, size cap, content-type)
//   • web_download really writes a file and reports its real path + sha256
//   • tool_help / lsp_languages are discoverable and honest about gaps
//   • LSP tool defs NAME the major languages (not just TS/JS)
//   • profiles advertise the web/download/LSP families in balanced
//
// Run: node --test --test-force-exit tests/v1115-tool-power.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { ESBUILD_NODE, ESBUILD_BIN } from './_esbuild-bin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1115-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN,
    entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// Electron stub so the graph can load in plain Node (same posture as siblings).
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `module.exports = {
  app: { getPath: () => ${JSON.stringify(join(tmp, 'ud'))}, whenReady: async () => true, on() {}, quit() {} },
  ipcMain: { handle() {}, on() {} }, BrowserWindow: { getAllWindows: () => [] },
  shell: {}, clipboard: { readText: () => '', writeText() {} }, Notification: { isSupported: () => false },
};`);

const toolsPath = join(tmp, 'tools.cjs');
bundle('electron/agent/tools.ts', toolsPath);
const tools = require(toolsPath);

const defs = tools.getToolDefs([]);
const byName = new Map(defs.map((d) => [d.name, d]));
const NEW_TOOLS = ['web_download', 'tool_help', 'lsp_languages'];

const WS = join(tmp, 'ws');
mkdirSync(WS, { recursive: true });

function ctx(fullAccess = true) {
  return {
    workspace: WS,
    sessionId: 'v1115-tool-power',
    mcpServers: [],
    emit: () => {},
    approve: async () => true,
    fullAccess,
  };
}
const run = (name, args, c = ctx()) => tools.executeTool(name, JSON.stringify(args ?? {}), c);

// Fixture HTTP server — loopback (needs fullAccess for the SSRF guard).
const BODY = 'a-real-download-body-0123456789';
const BIG_BODY = 'x'.repeat(4096);
const server = http.createServer((req, res) => {
  if (req.url === '/file.txt') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(BODY) });
    return res.end(BODY);
  }
  if (req.url === '/stream') {
    // No content-length → exercises the mid-stream cap branch.
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' });
    return res.end(BIG_BODY);
  }
  if (req.url === '/script') {
    res.writeHead(200, { 'content-type': 'application/javascript' });
    return res.end('console.log(1)');
  }
  res.writeHead(404); res.end('nope');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ------------------------------------------------------------
test('v11.15 new tools are registered, schema-valid, and dispatch without "Unknown tool"', async () => {
  for (const name of NEW_TOOLS) {
    assert.ok(byName.has(name), `${name} is registered`);
    const d = byName.get(name);
    assert.ok(d.description && d.description.length > 40, `${name} has a real description`);
    assert.equal(d.parameters.type, 'object', `${name} has an object schema`);
  }

  // Fast, offline args: dispatch is verified without external I/O.
  const cases = [
    ['web_download', {}],                       // missing url → honest refusal
    ['http_download', {}],                      // alias of web_download
    ['tool_help', {}],
    ['lsp_languages', {}],
  ];
  for (const [name, args] of cases) {
    let res;
    try {
      res = await run(name, args);
    } catch (err) {
      assert.fail(`${name} threw during dispatch: ${err.message}`);
    }
    assert.ok(res && typeof res === 'object', `${name} returned a result`);
    assert.equal(typeof res.ok, 'boolean', `${name} returned an ok flag`);
    assert.ok(typeof res.output === 'string' && res.output.length > 10, `${name} returned an honest message`);
    assert.doesNotMatch(res.output, /Unknown tool:/, `${name} dispatched (no "Unknown tool")`);
    assert.doesNotMatch(res.output, /Tool error:/, `${name} did not hit the last-resort crash guard`);
  }
});

test('web_download refuses unsafe URLs: non-http(s), localhost SSRF, over-cap, bad Content-Type', async () => {
  const refused = [
    // (args, fullAccess, expected substring, label)
    [{ url: 'file:///C:/Windows/win.ini', dest: 'downloads/x.txt' }, true, /only http and https are supported/i, 'non-http scheme'],
    [{ url: 'data:text/plain,hello', dest: 'downloads/x.txt' }, true, /only http and https are supported/i, 'data: scheme'],
    [{ url: `${BASE}/file.txt`, dest: 'downloads/ssrf.txt' }, false, /Blocked host \(SSRF guard\)/, 'localhost SSRF'],
    [{ url: `${BASE}/file.txt`, dest: 'downloads/cap.txt', max_bytes: 4 }, true, /File too larger|File too large/i, 'content-length over cap'],
    [{ url: `${BASE}/stream`, dest: 'downloads/cap-stream.bin', max_bytes: 16 }, true, /exceeded the 16-byte cap/i, 'mid-stream over cap'],
    [{ url: `${BASE}/file.txt`, dest: 'downloads/wrong-type.pdf', accept: 'application/pdf' }, true, /Content-Type refused/i, 'content-type mismatch'],
  ];
  for (const [args, fullAccess, pattern, label] of refused) {
    const res = await run('web_download', args, ctx(fullAccess));
    assert.equal(res.ok, false, `${label}: refused`);
    assert.match(res.output, pattern, `${label}: honest reason (${res.output.slice(0, 120)})`);
    // The guard must fire before a write: nothing was saved.
    assert.doesNotMatch(res.output, /^Downloaded /, `${label}: never claims a download`);
  }
  // Executable/script MIME types are refused by default.
  const scriptRes = await run('web_download', { url: `${BASE}/script`, dest: 'downloads/x.js' }, ctx(true));
  assert.equal(scriptRes.ok, false, 'script content-type refused by default');
  assert.match(scriptRes.output, /executable\/script type/i);
});

test('web_download really streams to disk and returns the real path + sha256', async () => {
  const dest = 'downloads/verified.txt';
  const res = await run('web_download', { url: `${BASE}/file.txt`, dest }, ctx(true));
  assert.equal(res.ok, true, `download succeeded: ${res.output}`);
  assert.match(res.output, /Downloaded \d+ bytes → /);
  assert.match(res.output, /content-type: text\/plain/);
  assert.match(res.output, /sha256: [0-9a-f]{64}/);

  const abs = join(WS, 'downloads', 'verified.txt');
  assert.ok(existsSync(abs), 'the real file exists on disk');
  assert.equal(readFileSync(abs, 'utf8'), BODY, 'the bytes on disk match the response body');
  const expected = crypto.createHash('sha256').update(BODY, 'utf8').digest('hex');
  assert.match(res.output, new RegExp(`sha256: ${expected}\\b`), 'the reported hash is the real file hash');
  assert.ok(res.output.includes(abs), 'the reported path is the real absolute path');
});

test('tool_help lists tool families, searches by keyword, and refuses bad categories', async () => {
  const all = await run('tool_help', {});
  assert.equal(all.ok, true);
  assert.ok(all.output.includes('TOOL ROSTER'), 'roster header');
  assert.ok(all.output.includes('INTERNET / DOWNLOAD'), 'web/download family');
  assert.ok(all.output.includes('LSP & CODE INTELLIGENCE'), 'LSP family');
  assert.ok(all.output.includes('web_download') && all.output.includes('tool_help') && all.output.includes('lsp_languages'), 'new tools listed');
  assert.ok(all.output.includes('WHICH TOOL WHEN'), 'cheat sheet present');

  const search = await run('tool_help', { query: 'download' });
  assert.equal(search.ok, true);
  assert.match(search.output, /web_download/);
  const bad = await run('tool_help', { category: 'nope' });
  assert.equal(bad.ok, false, 'unknown category refused honestly');
});

test('tool_help categorises by family', async () => {
  const search = await run('tool_help', { query: 'download' });
  assert.equal(search.ok, true);
  assert.match(search.output, /web_download/);
  const lsp = await run('tool_help', { category: 'lsp' });
  assert.equal(lsp.ok, true);
  assert.match(lsp.output, /lsp_definition/);
  assert.match(lsp.output, /lsp_languages/);
});

test('lsp_languages names major languages and is honest about gaps', async () => {
  const matrix = await run('lsp_languages', {});
  assert.equal(matrix.ok, true);
  for (const lang of ['TypeScript', 'Python', 'Go', 'Rust', 'Java', 'PHP', 'Ruby', 'C#', 'C++', 'Kotlin', 'Swift']) {
    assert.ok(matrix.output.includes(lang), `matrix mentions ${lang}`);
  }
  assert.match(matrix.output, /NOT WIRED/, 'gaps are explicit');

  const py = await run('lsp_languages', { language: 'python' });
  assert.equal(py.ok, true);
  assert.match(py.output, /IS wired to a real language server/i);
  assert.match(py.output, /pyright/i, 'honest install hint');

  const php = await run('lsp_languages', { language: 'php' });
  assert.equal(php.ok, true);
  assert.match(php.output, /NOT backed by a real LSP server/i);
  assert.match(php.output, /find_refs/i, 'heuristic fallback named');
});

test('LSP tool definitions name the major languages (not just TS/JS)', () => {
  const named = ['lsp_definition', 'lsp_hover', 'lsp_languages'].map((n) => byName.get(n).description).join('\n');
  for (const lang of ['Python', 'Go', 'Rust', 'Java', 'PHP', 'Ruby']) {
    assert.match(named, new RegExp(lang, 'i'), `LSP defs mention ${lang}`);
  }
});

test('inventory count is honest: 145 tools, includes the new ones, no duplicates', () => {
  const inv = JSON.parse(readFileSync(join(ROOT, 'src/generated/toolInventory.json'), 'utf8'));
  assert.equal(inv.total, defs.length, 'inventory matches live registry');
  assert.equal(inv.total, 145, 'count regenerated after adding 3 tools');
  const names = inv.tools.map((t) => t.name);
  for (const n of NEW_TOOLS) assert.ok(names.includes(n), `${n} in inventory`);
  assert.equal(new Set(names).size, names.length, 'no duplicate names');
});

test('profiles advertise web/download + LSP in balanced (and essential)', () => {
  const full = tools.getToolDefs([], 'full');
  const balanced = tools.getToolDefs([], 'balanced');
  const essential = tools.getToolDefs([], 'essential');
  const bn = new Set(balanced.map((d) => d.name));
  const en = new Set(essential.map((d) => d.name));
  assert.ok(balanced.length < full.length && essential.length < balanced.length, 'profiles are ordered');
  for (const n of ['web_search', 'web_fetch', 'web_download', 'tool_help', 'lsp_languages', 'lsp_definition']) {
    assert.ok(bn.has(n), `${n} visible in balanced`);
  }
  for (const n of ['web_download', 'tool_help', 'lsp_languages']) {
    assert.ok(en.has(n), `${n} visible in essential`);
  }
});

test('cleanup', () => {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
  assert.ok(true);
});
