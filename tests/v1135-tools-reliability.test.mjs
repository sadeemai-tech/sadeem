// ============================================================
// SADEEM v11.35 — CORE TOOL RELIABILITY / NO ERROR CASCADES
//
// Founder: "كل ما يجي يعمل أمر أو يفعل إشي يطلع له ايرور ايرور ايرور...
// مشاكل مزعجة" — core tools must return ONE distinct, actionable,
// single-language error WITH an exact next step, never a raw ENOENT
// stack or a generic "failed", and never throw or retry in a loop.
//
// This is a REAL, local-only test (no network): it bundles the app's own
// electron/agent/tools.ts, drives executeTool with local fixtures and checks
// the return shape of the failing paths we fixed:
//   missing file · wrong argument type · bad JSON · no-match edit
//   (single + multi) · Unicode/Arabic paths · search root · no-abort.
//
// Run: node --test --test-force-exit tests/v1135-tools-reliability.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

process.env.SURNIA_NO_BROWSER = '1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1135-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN,
    entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron',
    '--external:@xterm/xterm',
    '--external:@xterm/addon-fit',
    '--external:monaco-editor',
    '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// Minimal Electron stub so the esbuild graph loads in plain Node.
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `const p = ${JSON.stringify(join(tmp, 'ud'))}; module.exports = {
  app: { getPath: () => p, isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },
  ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
  BrowserWindow: { getAllWindows: () => [] }, Notification: { isSupported: () => false },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder: () => {} },
  clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
};`);

const toolsPath = join(tmp, 'tools.cjs');
bundle('electron/agent/tools.ts', toolsPath);
const tools = require(toolsPath);

// ---------- local fixtures ----------
const WS = join(tmp, 'ws');
mkdirSync(WS, { recursive: true });
const EDIT = join(WS, 'edit.txt');
const MULTI = join(WS, 'multi.txt');
const UNICODE = join(WS, 'caf\u00e9.txt'); // NFC "café"
const ARABIC = join(WS, '\u062a\u0642\u0631\u064a\u0631.txt'); // "تقرير.txt"
writeFileSync(EDIT, '// config values\nconst greeting = "hello";\nconst answer = 42;\nconst token = EDIT_TARGET_TOKEN;\n');
writeFileSync(MULTI, 'first line\nsecond line\nthird line\n');
writeFileSync(UNICODE, 'coffee notes \u2014 \u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645\n');
writeFileSync(ARABIC, '\u062a\u0642\u0631\u064a\u0631 \u0628\u0627\u0644\u0639\u0631\u0628\u064a\u0629\n');

const ctx = () => ({
  workspace: WS, sessionId: 'v1135-reliability', mcpServers: [], emit: () => {},
  approve: async () => true, fullAccess: true,
});
const run = (name, args, c = ctx()) => tools.executeTool(name, JSON.stringify(args ?? {}), c);
const hasFix = (s) => /\bFix:|Re-emit\b/i.test(s);
const singleLanguage = (s) => {
  const arabic = (s.match(/[\u0600-\u06FF]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  return !(arabic > 8 && latin > 30);
};
const noRawStack = (s) =>
  !/Error: ENOENT|\bat\s+\S+\s+\(|\bTHREW\b|\bundefined\b|\[object Object\]/.test(s);

// ============================================================
test('v1135 missing file → distinct actionable error, no raw ENOENT stack, no loop', async () => {
  const c = ctx();
  const r = await run('read_file', { path: 'missing-no-such.txt' }, c);
  assert.equal(r.ok, false);
  assert.match(r.output, /path does not exist: .*missing-no-such\.txt \(ENOENT\)/, 'names the exact missing path + fs cause');
  assert.match(r.output, /Fix:/);
  assert.match(r.output, /list_dir or glob_files/);
  assert.ok(noRawStack(r.output), `no raw stack/ENOENT blob: ${r.output}`);
  assert.ok(singleLanguage(r.output), `single language: ${r.output}`);

  // A second identical call must return the SAME thing (no state drift/loop).
  const again = await run('read_file', { path: 'missing-no-such.txt' }, c);
  assert.deepEqual(again, r, 'deterministic — a weak model cannot be trapped in a changing-error loop');
});

test('v1135 wrong argument type → actionable "must be a JSON string", never coerced', async () => {
  const c = ctx();
  const w = await run('write_file', { path: 12345, content: 'x' }, c);
  assert.equal(w.ok, false);
  assert.match(w.output, /"path" must be a JSON string \(received number\)/);
  assert.ok(hasFix(w.output), `has a concrete fix: ${w.output}`);
  assert.ok(noRawStack(w.output));

  const e = await run('edit_file', { path: EDIT, old_string: 42, new_string: 'x' }, c);
  assert.equal(e.ok, false);
  assert.match(e.output, /must be a JSON string|must be a JSON string \(received number\)/);
  assert.ok(hasFix(e.output), `has a concrete fix: ${e.output}`);
  // No file named "12345" was silently created by String(12345).
  assert.throws(() => readFileSync(join(WS, '12345')), /ENOENT/);
});

test('v1135 bad JSON args → named tool + strict-JSON fix, single language', async () => {
  const c = ctx();
  const bad = await tools.executeTool('read_file', '{"path": }', c);
  assert.equal(bad.ok, false);
  assert.match(bad.output, /Invalid JSON arguments for read_file/);
  assert.match(bad.output, /Fix: re-emit the tool call with strict JSON/);
  assert.ok(singleLanguage(bad.output));
  assert.ok(noRawStack(bad.output));
});

test('v1135 no-match edit_file → closest real line with number, then a working fix', async () => {
  const c = ctx();
  assert.equal((await run('read_file', { path: EDIT }, c)).ok, true, 'read-before-edit');
  const before = readFileSync(EDIT, 'utf8');

  const r = await run('edit_file', {
    path: EDIT, old_string: 'const missingVariable = 999;', new_string: 'const other = 1;',
  }, c);
  assert.equal(r.ok, false);
  assert.match(r.output, /edit_file: old_string not found in /);
  assert.match(r.output, /Closest line/i, 'suggests the closest real line (breaks the retry loop)');
  assert.match(r.output, /line \d+: "[^"]+"/, 'contains copyable exact text with a 1-based line number');
  const quoted = [...r.output.matchAll(/line \d+: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(quoted.some((line) => before.split('\n').includes(line)), 'the suggested line really exists in the file');
  assert.match(r.output, /Fix:/);
  assert.ok(singleLanguage(r.output));
  assert.ok(noRawStack(r.output));
  assert.equal(readFileSync(EDIT, 'utf8'), before, 'a failed edit never touches the file');

  // The suggested next step actually works: copy the exact text and retry once.
  const fixed = await run('edit_file', {
    path: EDIT, old_string: 'const answer = 42;', new_string: 'const answer = 43;',
  }, c);
  assert.equal(fixed.ok, true, `the suggested fix succeeds: ${fixed.output}`);
  assert.match(readFileSync(EDIT, 'utf8'), /const answer = 43;/);
});

test('v1135 no-match multi_edit → names the failing edit + closest line, nothing saved', async () => {
  const c = ctx();
  assert.equal((await run('read_file', { path: MULTI }, c)).ok, true, 'read-before-edit');
  const before = readFileSync(MULTI, 'utf8');

  const r = await run('multi_edit', {
    path: MULTI,
    edits: [{ old_string: 'nonexistent line', new_string: 'SECOND' }, { old_string: 'third line', new_string: 'THIRD' }],
  }, c);
  assert.equal(r.ok, false);
  assert.match(r.output, /multi_edit: edits\[0\]/);
  assert.match(r.output, /Closest line/i);
  assert.match(r.output, /line \d+: "[^"]+"/);
  assert.match(r.output, /nothing was saved/);
  assert.match(r.output, /Fix:/);
  assert.equal(readFileSync(MULTI, 'utf8'), before, 'atomic — no partial write on a no-match');
});

test('v1135 Unicode / Arabic paths → NFC + invisible-mark normalization resolves the same file', async () => {
  const c = ctx();
  // Decomposed "café" (e + combining acute) must find the NFC file on disk.
  const nfd = 'caf\u0065\u0301.txt';
  const r = await run('read_file', { path: nfd }, c);
  assert.equal(r.ok, true, `NFD path resolves to the NFC file: ${r.output}`);
  assert.match(r.output, /\u0645\u0631\u062d\u0628\u0627/, 'Arabic content survives read intact');
  assert.doesNotMatch(r.output, /\uFFFD/, 'no replacement-character garbling');

  // Invisible ZWSP/BOM around an Arabic filename are stripped, not chased.
  const zwsp = '\u200B\u062a\u0642\u0631\u064a\u0631\u200C.txt\uFEFF';
  const a = await run('read_file', { path: zwsp }, c);
  assert.equal(a.ok, true, `invisible marks around an Arabic path are normalized: ${a.output}`);
  assert.match(a.output, /\u0628\u0627\u0644\u0639\u0631\u0628\u064a\u0629/);
  assert.ok(singleLanguage(a.output));
});

test('v1135 search root validation → typo is an actionable error, not silent "No matches."', async () => {
  const c = ctx();
  const r = await run('search_files', { pattern: 'x', path: 'no-such-dir' }, c);
  assert.equal(r.ok, false);
  assert.match(r.output, /path does not exist: .*no-such-dir/);
  assert.match(r.output, /Fix:/);
  assert.ok(noRawStack(r.output));

  const file = await run('search_files', { pattern: 'x', path: 'edit.txt' }, c);
  assert.equal(file.ok, false);
  assert.match(file.output, /search path is a file, not a directory/);
  assert.match(file.output, /read_file/);
});

test('v1135 every failure is DISTINCT and never aborts the turn', async () => {
  const c = ctx();
  const failures = await Promise.all([
    run('read_file', { path: 'missing-no-such.txt' }, c),
    run('write_file', { path: 12345, content: 'x' }, c),
    tools.executeTool('read_file', '{"path": }', c),
    run('edit_file', { path: EDIT, old_string: 'const missingVariable = 999;', new_string: 'z' }, c),
    run('search_files', { pattern: 'x', path: 'no-such-dir' }, c),
  ]);
  for (const r of failures) {
    assert.equal(r.ok, false);
    assert.ok(typeof r.output === 'string' && r.output.trim().length >= 20);
    assert.ok(hasFix(r.output), `each failure carries a next step: ${r.output.slice(0, 160)}`);
    assert.ok(noRawStack(r.output));
    assert.ok(singleLanguage(r.output));
  }
  const outputs = failures.map((r) => r.output);
  assert.equal(new Set(outputs).size, outputs.length, 'no two different problems share the same generic failure text');

  // A failing tool_result does not poison the context: the next good call works.
  const good = await run('read_file', { path: EDIT }, c);
  assert.equal(good.ok, true, 'the turn continues normally after failures');
  assert.match(good.output, /const answer = 43;/);
});

test('v1135 cleanup', () => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  assert.ok(true);
});
