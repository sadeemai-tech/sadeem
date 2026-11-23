// ============================================================
// v11.23 — TOOL EXECUTION ERROR PATH (real tool calls, real bundled modules).
//
// Founder report: "الأدوات لا تعمل" — tools fail silently, report the wrong
// exit code, hide the real error, claim writes that never landed, let writes
// escape the workspace, and turn malformed args into dead ends. This suite
// drives the app's OWN executeTool (esbuild bundle, same posture as
// v1115-longrun / v1121-tool-reliability) with failing commands, bad paths and
// malformed arguments. It is intentionally source-agnostic: a regression that
// only "looks fixed" in the source text but still fails at runtime is caught.
// ============================================================
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as http from 'node:http';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1123-'));
process.env.SURNIA_NO_BROWSER = '1';

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

// Minimal electron stub so the headless bundle can be required in plain Node
// (same posture as tool-coverage-all.mjs).
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `
  class StubWebContents { on() {} async executeJavaScript() { return []; } }
  class StubBrowserWindow { constructor() { this.webContents = new StubWebContents(); } destroy() {} setBounds() {} getBounds() { return { x: 0, y: 0 }; } }
  module.exports = {
    app: { getPath: () => ${JSON.stringify(tmp)}, isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },
    ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
    Notification: { isSupported: () => false },
    shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder() {}, trashItem: async () => {} },
    clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
    WebContents: class {},
    BrowserWindow: StubBrowserWindow,
  };`);

// Bundle tools AND engineGates through one entry so they share the run-gate
// registry (the real engine creates gates at run start) — two separate bundles
// would own two different registries and taint would not flow.
const entryPath = join(tmp, 'entry.mjs');
writeFileSync(entryPath,
  `import * as tools from ${JSON.stringify(join(ROOT, 'electron/agent/tools.ts'))};\n` +
  `import * as gates from ${JSON.stringify(join(ROOT, 'electron/agent/engineGates.ts'))};\n` +
  `export { tools, gates };\n`);
const toolsPath = join(tmp, 'tools.cjs');
bundle(entryPath, toolsPath);
const { tools, gates } = require(toolsPath);

const WS = join(tmp, 'ws');
mkdirSync(WS, { recursive: true });
writeFileSync(join(WS, 'README.md'), '# Fixture\n\nInstall with npm install, then run npm test.\n');

/** Real ToolContext stub; approvals is the observable gate ledger. */
function ctx(opts = {}) {
  const approvals = [];
  return {
    workspace: WS,
    sessionId: 'v1123-' + Math.random().toString(36).slice(2, 10),
    mcpServers: [],
    emit: () => {},
    approve: async (req) => { approvals.push(req); return opts.deny ? false : true; },
    fullAccess: opts.fullAccess === true,
    approvals,
  };
}
const run = (name, args, c) => tools.executeTool(name, typeof args === 'string' ? args : JSON.stringify(args ?? {}), c);
/** Tool failure text must be one language (English) — no mixed Arabic prose. */
const singleLanguage = (s) => !/[\u0600-\u06FF]/.test(s);

// ------------------------------------------------------------
// 1) FAILING COMMANDS — real exit code, real error, real fix
// ------------------------------------------------------------

test('v1123 run_command: a failing command is a FAILED tool_result with the real exit code', async () => {
  const r = await run('run_command', {
    command: `node -e "process.stderr.write('V1123-BOOM\\n');process.exit(7)"`,
  }, ctx());
  assert.equal(r.ok, false);
  assert.match(r.output, /Command FAILED/);
  assert.match(r.output, /exit code 7/);
  assert.match(r.output, /V1123-BOOM/);
  assert.match(r.output, /\[exit code: 7\]/);
  assert.match(r.output, /diagnosis:/);
  assert.match(r.output, /fix:/);
  assert.ok(singleLanguage(r.output));
});

test('v1123 run_command: an unknown binary reports "command not found" with an install fix', async () => {
  const r = await run('run_command', {
    command: 'v1123-definitely-not-a-real-binary --version',
  }, ctx());
  assert.equal(r.ok, false);
  assert.match(r.output, /command not found/i);
  assert.match(r.output, /fix:/i);
  assert.ok(singleLanguage(r.output));
});

test('v1123 run_command: exit code 0 stays a success and carries the marker', async () => {
  const r = await run('run_command', { command: `node -e "console.log('V1123-OK')"` }, ctx());
  assert.equal(r.ok, true);
  assert.match(r.output, /V1123-OK/);
  assert.match(r.output, /\[exit code: 0\]/);
});

test('v1123 run_command: the REAL error at the tail survives a >100KB build log', async () => {
  // Before the fix, runCaptured kept only the HEAD: the SOH exit-code marker
  // and this tail error were cut away, so the tool reported ok=true / exit 0.
  const command =
    `node -e "process.stdout.write('A'.repeat(250000));` +
    `process.stderr.write('V1123-FATAL-TAIL\\n');process.exit(3)"`;
  const r = await run('run_command', { command }, ctx({ fullAccess: true }));
  assert.equal(r.ok, false, 'a non-zero command must never be reported as success');
  assert.match(r.output, /\[exit code: 3\]/, 'the real exit code is preserved verbatim');
  assert.match(r.output, /V1123-FATAL-TAIL/, 'the error at the END of the log reaches the model');
  assert.match(r.output, /truncat/i, 'truncation is disclosed, not silent');
});

// ------------------------------------------------------------
// 2) FILE WRITES — no false success, no silent empty/odd files
// ------------------------------------------------------------

test('v1123 write_file: missing content is rejected, not written as an empty file', async () => {
  const c = ctx();
  const target = join(WS, 'missing-content.txt');
  const r = await run('write_file', { path: target }, c);
  assert.equal(r.ok, false);
  assert.match(r.output, /content/);
  assert.equal(existsSync(target), false, 'no phantom empty file was created');
});

test('v1123 write_file: a numeric path is rejected, not turned into a file named "12345"', async () => {
  const r = await run('write_file', { path: 12345, content: 'x' }, ctx());
  assert.equal(r.ok, false);
  assert.match(r.output, /must be a JSON string/);
  assert.equal(existsSync(join(WS, '12345')), false);
});

test('v1123 write_file: a successful write is verified — the bytes really landed', async () => {
  const target = join(WS, 'verified.txt');
  const r = await run('write_file', { path: target, content: 'v1123-payload' }, ctx());
  assert.equal(r.ok, true);
  assert.match(r.output, /^Wrote /);
  assert.equal(readFileSync(target, 'utf8'), 'v1123-payload');
});

test('v1123 edit_file: missing new_string is rejected before touching the file', async () => {
  const target = join(WS, 'edit-target.txt');
  writeFileSync(target, 'keep:VALUE\n');
  const c = ctx();
  await run('read_file', { path: target }, c); // read-before-edit ledger
  const r = await run('edit_file', { path: target, old_string: 'VALUE' }, c);
  assert.equal(r.ok, false);
  assert.match(r.output, /new_string/);
  assert.equal(readFileSync(target, 'utf8'), 'keep:VALUE\n');
});

test('v1123 edit_file: an applied edit is verified on disk', async () => {
  const target = join(WS, 'edit-ok.txt');
  writeFileSync(target, 'alpha=BETA\n');
  const c = ctx();
  await run('read_file', { path: target }, c);
  const r = await run('edit_file', { path: target, old_string: 'BETA', new_string: 'gamma' }, c);
  assert.equal(r.ok, true);
  assert.match(r.output, /^Edited /);
  assert.equal(readFileSync(target, 'utf8'), 'alpha=gamma\n');
});

// ------------------------------------------------------------
// 3) PATH CONTAINMENT — writes stay inside the workspace
// ------------------------------------------------------------

test('v1123 write_file: a path escaping the workspace is refused with an actionable message', async () => {
  const outside = join(tmp, 'escape-v1123.txt');
  const r = await run('write_file', { path: outside, content: 'nope' }, ctx());
  assert.equal(r.ok, false);
  assert.match(r.output, /outside the workspace/i);
  assert.match(r.output, /Fix:/i);
  assert.ok(singleLanguage(r.output));
  assert.equal(existsSync(outside), false, 'nothing was written outside the workspace');
});

test('v1123 read_image: a RELATIVE path that escapes the workspace is refused', async () => {
  const r = await run('read_image', { path: '../escape.png' }, ctx());
  assert.equal(r.ok, false);
  assert.match(r.output, /escapes the workspace/i);
});

// ------------------------------------------------------------
// 4) MALFORMED ARGS — graceful, actionable, never crash the run
// ------------------------------------------------------------

test('v1123 malformed JSON args never crash and name the tool + the fix', async () => {
  for (const bad of ['{bad json', '{"path":', '[1,2,3]', 'null', '']) {
    const r = await run('write_file', bad, ctx());
    assert.equal(r.ok, false, `input ${JSON.stringify(bad)} must fail cleanly`);
    assert.match(r.output, /write_file|JSON/);
    assert.match(r.output, /Fix:|Re-emit/);
    assert.ok(singleLanguage(r.output));
  }
});

test('v1123 wrong container/type args are rejected before a downstream crash', async () => {
  const cases = [
    ['multi_file_edit', { files: 'not-an-array' }, /must be a JSON array/],
    ['http_request', { url: 99 }, /must be a JSON string/],
    ['todo_write', { todos: { nope: true } }, /must be a JSON array/],
    ['notify_user', { title: 't', body: 42 }, /must be a JSON string/],
  ];
  for (const [name, args, re] of cases) {
    const r = await run(name, args, ctx());
    assert.equal(r.ok, false, `${name} must reject malformed args`);
    assert.match(r.output, re);
  }
});

test('v1123 unknowns give a self-correction hint, never a bare crash', async () => {
  const r = await run('write_filee', { path: 'x', content: 'y' }, ctx());
  assert.equal(r.ok, false);
  assert.match(r.output, /Unknown tool/);
  assert.match(r.output, /did you mean|Re-emit/i);
  assert.ok(singleLanguage(r.output));
});

// ------------------------------------------------------------
// 5) tool_result DELIVERY + taint/gate interactions
// ------------------------------------------------------------

test('v1123 every tool_result is a deliverable, non-empty, single-language outcome', async () => {
  const sample = [
    ['sys_info', {}],
    ['tool_help', { query: 'write_file' }],
    ['lsp_languages', {}],
    ['run_command', { command: 'node -e "process.exit(1)"' }],
    ['write_file', {}],
  ];
  for (const [name, args] of sample) {
    const r = await run(name, args, ctx());
    assert.equal(typeof r.ok, 'boolean', `${name}.ok must be boolean`);
    assert.equal(typeof r.output, 'string', `${name}.output must be a string`);
    assert.ok(r.output.trim().length > 0, `${name} must return a non-empty tool_result`);
    assert.ok(singleLanguage(r.output), `${name} error text must be one language`);
  }
});

test('v1123 a benign local README read does NOT gate the next legitimate command', async () => {
  const c = ctx({ fullAccess: true });
  const read = await run('read_file', { path: join(WS, 'README.md') }, c);
  assert.equal(read.ok, true);
  const r = await run('run_command', { command: `node -e "console.log('legit')"` }, c);
  assert.equal(r.ok, true, 'a benign local read must not deny a later safe command');
  const forced = c.approvals.filter((a) => a.force === true);
  assert.equal(forced.length, 0, 'no TAINT ESCALATION on a clean local read');
});

test('v1123 taint escalates approval but does not silently DENY the tool', async () => {
  // Drive the REAL taint path through web_fetch (the tools bundle owns its own
  // run-gate map; a second bundle's ledger would not be the same instance).
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>External</title><p>Untrusted external page content for v1123.</p>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    const c = ctx({ fullAccess: true });
    gates.createRunGates(c.sessionId); // engine creates these at run start
    const fetched = await run('web_fetch', { url }, c);
    assert.equal(fetched.ok, true, 'loopback fetch with fullAccess must work');
    const r = await run('run_command', { command: `node -e "console.log('still-runs')"` }, c);
    // The gate forces an EXPLICIT approval (force:true) — with an approving
    // host the legitimate tool still runs; it is never silently dropped.
    assert.equal(r.ok, true);
    assert.match(r.output, /still-runs/);
    assert.ok(c.approvals.some((a) => a.force === true), 'taint forced an explicit approval');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ------------------------------------------------------------
// 6) REGISTRY INTEGRITY — all 145 tools remain callable
// ------------------------------------------------------------

test('v1123 all 145 tools remain registered and dispatchable', () => {
  const defs = tools.getToolDefs([]);
  assert.equal(defs.length, 145, 'tool count must not change');
  assert.equal(new Set(defs.map((d) => d.name)).size, 145, 'names stay unique');
});

test('after: clean temp dir', () => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});
