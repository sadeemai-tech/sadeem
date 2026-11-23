// ============================================================
// SADEEM v11.16 — TOOLS AUDIT (founder: "the AI cannot use the
// tools it needs — download from internet, use my device/folders").
//
// This is the acceptance harness for the tool-surface audit. It proves,
// against the app's OWN esbuild-bundled executeTool + live CORE_DEFS:
//   1. Every one of the 145 registered tools dispatches — no "Unknown tool",
//      no last-resort crash, no invalid-JSON for valid arguments.
//   2. The 3 founder-named tools (web_download / tool_help / lsp_languages)
//      are in the DEFAULT-advertised profiles (essential + balanced), so a
//      model actually SEES them (a tool hidden from the default profile is a
//      tool the model can never call).
//   3. web_download really streams to disk and reports the REAL path+sha256,
//      refuses unsafe URLs (file:/ftp:/localhost-SSRF) BEFORE any byte, and
//      does NOT over-block the .zip/.pdf documents users need.
//   4. tool_help is generated from the LIVE registry and returns the RIGHT
//      tool names for real queries (download / LSP / pdf / clipboard / screen).
//   5. The DEVICE tools return honest, non-crashing results: fs_browse (no
//      args → drives), read_file (ANY absolute path), open_path,
//      reveal_in_folder, clipboard, screenshot, desktop_control.
//   6. Every core tool input schema is valid JSON Schema (type:'object' with
//      a properties map) so providers don't reject the tools[] array.
//
// Run: node --test --test-force-exit tests/v1116-tools-audit.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { ESBUILD_NODE, ESBUILD_BIN } from './_esbuild-bin.mjs';

// Force the honest headless posture for browser/device bridges.
process.env.SURNIA_NO_BROWSER = '1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1116-audit-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN,
    entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// Electron stub (same posture as the sibling harnesses) so the graph loads in
// plain Node. Device calls honestly report "desktop app only" / headless.
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `module.exports = {
  app: { getPath: () => ${JSON.stringify(join(tmp, 'ud'))}, whenReady: async () => true, on() {}, quit() {}, isReady: () => true },
  ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder: () => {} },
  clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
  Notification: { isSupported: () => false },
};`);

const toolsPath = join(tmp, 'tools.cjs');
bundle('electron/agent/tools.ts', toolsPath);
const tools = require(toolsPath);

const defs = tools.getToolDefs([]); // default profile = FULL registry (145)
const byName = new Map(defs.map((d) => [d.name, d]));

const WS = join(tmp, 'ws');
mkdirSync(WS, { recursive: true });

function ctx(fullAccess = true) {
  return {
    workspace: WS,
    sessionId: 'v1116-tools-audit',
    mcpServers: [],
    emit: () => {},
    approve: async () => true,
    fullAccess,
  };
}
const run = (name, args, c = ctx()) => tools.executeTool(name, JSON.stringify(args ?? {}), c);

// Fixture HTTP server on loopback (fullAccess relaxes the SSRF guard for the
// happy path; fullAccess:false is used deliberately for the SSRF refusal).
const BODY = 'v1116-real-download-body-0123456789';
const server = http.createServer((req, res) => {
  if (req.url === '/file.txt') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(BODY) });
    return res.end(BODY);
  }
  if (req.url === '/doc.zip') {
    // A document/binary MIME users legitimately need — must NOT be blocked.
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': 4 });
    return res.end('ZIP!');
  }
  if (req.url === '/doc.pdf') {
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': 4 });
    return res.end('%PDF');
  }
  res.writeHead(404); res.end('nope');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ------------------------------------------------------------
test('A1 — all 145 registered tools dispatch: no Unknown tool, no crash, no invalid-JSON', async () => {
  assert.equal(defs.length, 145, 'registry has 145 tools');
  const bad = [];
  for (const d of defs) {
    let res;
    try {
      // Empty args are valid JSON; tools needing args must refuse honestly,
      // no-arg tools may succeed — but nothing may be "Unknown tool"/crash.
      res = await run(d.name, {});
    } catch (err) {
      bad.push(`${d.name}: THREW ${err.message}`);
      continue;
    }
    const out = typeof res?.output === 'string' ? res.output : '';
    if (!res || typeof res.ok !== 'boolean') bad.push(`${d.name}: no ok flag`);
    if (/^Unknown tool:/.test(out)) bad.push(`${d.name}: Unknown tool`);
    if (/^Tool error:/.test(out)) bad.push(`${d.name}: crash guard`);
    if (/^Invalid JSON args/.test(out)) bad.push(`${d.name}: invalid JSON for valid args`);
    if (!out.length) bad.push(`${d.name}: empty output`);
  }
  assert.deepEqual(bad, [], `dispatch failures: ${bad.join(' | ')}`);
});

test('A6 — every core tool schema is valid JSON Schema (object + properties)', () => {
  const bad = [];
  for (const d of defs) {
    const p = d.parameters;
    if (!p || typeof p !== 'object' || Array.isArray(p)) { bad.push(`${d.name}: no schema object`); continue; }
    if (p.type !== 'object') bad.push(`${d.name}: type != object (${p.type})`);
    if (!p.properties || typeof p.properties !== 'object' || Array.isArray(p.properties)) {
      bad.push(`${d.name}: missing properties map`);
    }
    if (p.required !== undefined && !Array.isArray(p.required)) bad.push(`${d.name}: required not an array`);
  }
  assert.deepEqual(bad, [], `invalid input schemas: ${bad.join(' | ')}`);
});

test('A2 — the 3 founder-named tools are advertised by the DEFAULT profiles', () => {
  const full = tools.getToolDefs([], 'full');
  const balanced = tools.getToolDefs([], 'balanced');
  const essential = tools.getToolDefs([], 'essential');
  const bn = new Set(balanced.map((d) => d.name));
  const en = new Set(essential.map((d) => d.name));

  assert.ok(essential.length < balanced.length && balanced.length < full.length, 'essential ⊂ balanced ⊂ full');
  for (const n of ['web_download', 'tool_help', 'lsp_languages']) {
    assert.ok(en.has(n), `${n} visible in ESSENTIAL`);
    assert.ok(bn.has(n), `${n} visible in BALANCED (the default)`);
  }
  // The LSP family must be reachable by the default profile too.
  for (const n of ['lsp_definition', 'lsp_hover', 'lsp_diagnostics', 'lsp_references', 'lsp_rename', 'lsp_completion']) {
    assert.ok(bn.has(n), `${n} visible in BALANCED`);
  }
  // v11.16 fix: the DEVICE control tool must be visible in the default
  // profile — a tool only in ADVANCED is invisible to a balanced model.
  assert.ok(bn.has('desktop_control'), 'desktop_control visible in BALANCED (device use)');
  assert.ok(bn.has('fs_browse') && bn.has('screenshot'), 'device discovery tools visible in BALANCED');
});

test('A3a — web_download really streams to disk and returns the REAL path + sha256', async () => {
  const dest = 'downloads/v1116-verified.txt';
  const res = await run('web_download', { url: `${BASE}/file.txt`, dest }, ctx(true));
  assert.equal(res.ok, true, `download succeeded: ${res.output}`);
  assert.match(res.output, /Downloaded \d+ bytes → /);
  assert.match(res.output, /content-type: text\/plain/);
  assert.match(res.output, /sha256: [0-9a-f]{64}/);

  const abs = join(WS, 'downloads', 'v1116-verified.txt');
  assert.ok(existsSync(abs), 'the real file exists on disk');
  const expected = crypto.createHash('sha256').update(BODY, 'utf8').digest('hex');
  assert.match(res.output, new RegExp(`sha256: ${expected}\\b`), 'reported hash == real file hash');
  assert.ok(res.output.includes(abs), 'reported path is the real absolute path');
  assert.match(require('node:fs').readFileSync(abs, 'utf8'), new RegExp(BODY));
});

test('A3b — web_download refuses unsafe URLs (file:, ftp:, localhost SSRF) BEFORE any byte', async () => {
  const cases = [
    [{ url: 'file:///C:/Windows/win.ini', dest: 'downloads/refuse-file.txt' }, true, /only http and https are supported/i, 'file: scheme'],
    [{ url: 'ftp://example.com/x.bin', dest: 'downloads/refuse-ftp.txt' }, true, /only http and https are supported/i, 'ftp: scheme'],
    [{ url: `${BASE}/file.txt`, dest: 'downloads/refuse-ssrf.txt' }, false, /Blocked host \(SSRF guard\)/, 'localhost SSRF'],
  ];
  for (const [args, fullAccess, pattern, label] of cases) {
    const res = await run('web_download', args, ctx(fullAccess));
    assert.equal(res.ok, false, `${label}: refused`);
    assert.match(res.output, pattern, `${label}: honest reason (${res.output.slice(0, 120)})`);
    assert.doesNotMatch(res.output, /^Downloaded /, `${label}: never claims a download`);
    assert.equal(existsSync(join(WS, args.dest)), false, `${label}: nothing was written`);
  }
  // Content-type mismatch and over-cap are also refused before a write.
  const ct = await run('web_download', { url: `${BASE}/file.txt`, dest: 'downloads/refuse-ct.pdf', accept: 'application/pdf' }, ctx(true));
  assert.equal(ct.ok, false);
  assert.match(ct.output, /Content-Type refused/i);
  assert.equal(existsSync(join(WS, 'downloads', 'refuse-ct.pdf')), false, 'CT refusal wrote nothing');

  const cap = await run('web_download', { url: `${BASE}/file.txt`, dest: 'downloads/refuse-cap.txt', max_bytes: 4 }, ctx(true));
  assert.equal(cap.ok, false);
  assert.match(cap.output, /File too large/i);
  assert.equal(existsSync(join(WS, 'downloads', 'refuse-cap.txt')), false, 'cap refusal wrote nothing');
});

test('A3c — web_download does NOT over-block .zip/.pdf documents users need', async () => {
  for (const [path, dest, ct] of [
    ['/doc.zip', 'downloads/ok.zip', /content-type: application\/zip/],
    ['/doc.pdf', 'downloads/ok.pdf', /content-type: application\/pdf/],
  ]) {
    const res = await run('web_download', { url: `${BASE}${path}`, dest }, ctx(true));
    assert.equal(res.ok, true, `${path} downloads: ${res.output}`);
    assert.match(res.output, ct, `${path} content-type reported`);
    assert.ok(existsSync(join(WS, dest)), `${path} file exists`);
  }
});

test('A4a — tool_help is generated from the live registry (not a stale roster)', async () => {
  const res = await run('tool_help', {});
  assert.equal(res.ok, true);
  assert.match(res.output, /TOOL ROSTER/);
  assert.match(res.output, new RegExp(`${defs.length} registered tools`), 'roster count == live registry');
  for (const n of ['web_download', 'tool_help', 'lsp_languages', 'desktop_control', 'read_file']) {
    assert.ok(res.output.includes(n), `roster lists ${n}`);
  }
  assert.match(res.output, /INTERNET \/ DOWNLOAD/);
  assert.match(res.output, /LSP & CODE INTELLIGENCE/);
  assert.match(res.output, /DEVICE \/ MEDIA \/ DESKTOP/);
});

test('A4b — tool_help returns the RIGHT tools for 5 real queries', async () => {
  const expectations = [
    ['download', ['web_download', 'download_file', 'browser_download']],
    ['LSP', ['lsp_languages', 'lsp_definition', 'lsp_hover', 'lsp_diagnostics']],
    ['pdf', ['pdf_make', 'browser_pdf']],
    ['clipboard', ['clipboard_read', 'clipboard_write']],
    ['screen', ['screenshot', 'desktop_control', 'preview_screenshot']],
  ];
  for (const [query, expected] of expectations) {
    const res = await run('tool_help', { query });
    assert.equal(res.ok, true, `query "${query}" ok`);
    assert.match(res.output, /TOOLS MATCHING/i, `query "${query}" searched`);
    for (const name of expected) {
      assert.ok(res.output.includes(name), `query "${query}" → ${name}`);
    }
  }
});

test('A5 — DEVICE tools return honest, non-crashing results', async () => {
  const c = ctx(true);
  // fs_browse with NO args → machine overview (drives + home folders).
  const browse = await run('fs_browse', {}, c);
  assert.equal(browse.ok, true, 'fs_browse no-arg succeeds');
  assert.match(browse.output, /HOME:/);
  assert.match(browse.output, /DRIVES:|ROOT:/);

  // read_file reads ANY absolute path, including outside the workspace.
  const outside = join(tmp, 'outside-workspace.txt');
  writeFileSync(outside, 'DEVICE-FILE-OUTSIDE-WS-42');
  const read = await run('read_file', { path: outside }, c);
  assert.equal(read.ok, true, `read_file any path: ${read.output}`);
  assert.match(read.output, /DEVICE-FILE-OUTSIDE-WS-42/, 'read_file returned the real bytes');

  // open_path / reveal_in_folder / clipboard / screenshot / desktop_control:
  // headless stubs must give honest results, never crash or "Unknown tool".
  const deviceCalls = [
    ['open_path', { path: outside }],
    ['reveal_in_folder', { path: outside }],
    ['clipboard_read', {}],
    ['clipboard_write', { text: 'v1116-audit' }],
    ['screenshot', {}],
    ['desktop_control', {}],
  ];
  for (const [name, args] of deviceCalls) {
    let res;
    try {
      res = await run(name, args, c);
    } catch (err) {
      assert.fail(`${name} threw during dispatch: ${err.message}`);
    }
    assert.ok(res && typeof res.ok === 'boolean', `${name} returned an ok flag`);
    assert.ok(typeof res.output === 'string' && res.output.length > 5, `${name} returned an honest message`);
    assert.doesNotMatch(res.output, /^Unknown tool:/, `${name} dispatched`);
    assert.doesNotMatch(res.output, /^Tool error:/, `${name} did not crash`);
  }
});

test('cleanup', () => {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
  assert.ok(true);
});
