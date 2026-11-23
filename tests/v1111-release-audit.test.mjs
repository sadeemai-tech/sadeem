import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// SADEEM v11.11 — RELEASE-DAY SECURITY AUDIT REGRESSIONS
// (SEC-AUDIT; complements tests/v1111-security.test.mjs)
//
// Proves, with REAL executions through the bundled services:
//   1. AGENT WRITE WALL (tools.ts): write_file with '../' traversal
//      or an absolute path outside the workspace fails with
//      PathEscapesWorkspace BEFORE any approval is sought; an
//      in-workspace write still works through the normal gate.
//   2. DESTRUCTIVE-COMMAND APPROVAL TRIGGER (tools.ts + risk.ts):
//      `rm -rf /` is hard-blocked (BLOCKED_DANGEROUS_COMMAND, no
//      approval at all); a danger-classified command (git push
//      --force to main) REACHES the approval gate with force:true
//      even though the mode would auto-approve; a benign command
//      goes through the normal (non-forced) gate.
//   3. MEMORY PATH JAIL (ipc.ts, release-audit fix): the renderer-
//      supplied workspace for kdx:memory:read/write is validated
//      through fsService — a traversal/outside workspace is refused
//      (WORKSPACE_NOT_FOUND) and NOTHING is written outside.
// Run: node --test --test-force-exit tests/v1111-release-audit.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-release-audit-'));

// Isolated userData for every service under test.
process.env.SADEEM_TEST_USERDATA = join(tmp, 'ud');
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

// ---------- recording electron stub ----------
// ipcMain.handle() calls land in a process-global map so the tests can
// invoke the REAL registered handlers black-box style. The rest mirrors
// tests/electron-stub.mjs (stub keychain, no windows).
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `const UD = ${JSON.stringify(join(tmp, 'ud'))};
   class StubWebContents { on() {} send() {} }
   class StubBrowserWindow { constructor() { this.webContents = new StubWebContents(); } }
   StubBrowserWindow.getAllWindows = () => [];
   module.exports = {
     app: { getPath: (k) => (k === 'userData' ? (process.env.SADEEM_TEST_USERDATA || UD) : UD), isReady: () => true, whenReady: async () => {}, on() {}, quit() {}, setName() {}, setPath() {} },
     ipcMain: {
       handle(ch, fn) { (globalThis.__KDX_HANDLERS ||= {})[ch] = fn; },
       on() {},
       removeAllListeners() {},
     },
     safeStorage: {
       isEncryptionAvailable: () => true,
       encryptString: (s) => Buffer.from(Buffer.from(String(s), 'utf8').toString('base64'), 'utf8'),
       decryptString: (b) => Buffer.from(b.toString(), 'base64').toString('utf8'),
       getSelectedStorageBackend: () => 'stub-keychain',
     },
     BrowserWindow: StubBrowserWindow,
     WebContents: StubWebContents,
     shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder() {}, trashItem: async () => {} },
     Notification: { isSupported: () => false },
     clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
     dialog: { showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => ({ canceled: true }) },
   };`,
);

// ---------- bundles ----------
bundle('electron/agent/tools.ts', join(tmp, 'tools.cjs'));
bundle('electron/ipc.ts', join(tmp, 'ipc.cjs'));

const tools = require(join(tmp, 'tools.cjs'));

// ---------- shared fixtures ----------
const ws = join(tmp, 'workspace');
mkdirSync(join(ws, 'sub'), { recursive: true });
const outsideDir = join(tmp, 'outside');
mkdirSync(outsideDir, { recursive: true });

function makeCtx(approvals, opts = {}) {
  return {
    workspace: ws,
    sessionId: 'release-audit-session',
    mcpServers: [],
    emit: () => {},
    approve: async (req) => {
      approvals.push(req);
      return opts.allow === true;
    },
    fullAccess: false,
  };
}

// ============================================================
// 1 · AGENT WRITE WALL — path traversal / absolute escape rejected
// ============================================================
test('write wall: ../ traversal is rejected BEFORE any approval is sought', async () => {
  const approvals = [];
  const ctx = makeCtx(approvals);
  const res = await tools.executeTool('write_file', JSON.stringify({ path: join(ws, '..', 'escape.txt'), content: 'nope' }), ctx);
  assert.equal(res.ok, false, 'traversal write must fail');
  assert.match(res.output, /PathEscapesWorkspace/, 'honest escape error');
  assert.equal(approvals.length, 0, 'no approval may be requested for an escaping path');
  assert.ok(!existsSync(join(tmp, 'escape.txt')), 'nothing written outside the workspace');
});

test('write wall: absolute path outside the workspace is rejected', async () => {
  const approvals = [];
  const ctx = makeCtx(approvals);
  const outsideTarget = join(outsideDir, 'planted.txt');
  const res = await tools.executeTool('write_file', JSON.stringify({ path: outsideTarget, content: 'nope' }), ctx);
  assert.equal(res.ok, false);
  assert.match(res.output, /PathEscapesWorkspace/);
  assert.equal(approvals.length, 0, 'no approval for an escaping path');
  assert.ok(!existsSync(outsideTarget), 'nothing written outside the workspace');
});

test('write wall: a normal in-workspace write still goes through the write gate', async () => {
  const approvals = [];
  const ctx = makeCtx(approvals, { allow: true });
  const res = await tools.executeTool('write_file', JSON.stringify({ path: join(ws, 'sub', 'ok.txt'), content: 'fine' }), ctx);
  assert.equal(res.ok, true, 'in-workspace create must succeed');
  assert.equal(readFileSync(join(ws, 'sub', 'ok.txt'), 'utf8'), 'fine');
  assert.equal(approvals.length, 1, 'exactly one write approval');
  assert.equal(approvals[0].kind, 'write');
});

// ============================================================
// 2 · DESTRUCTIVE-COMMAND APPROVAL TRIGGER
// ============================================================
test('run_command: rm -rf / is HARD-BLOCKED before any approval flow', async () => {
  const approvals = [];
  const ctx = makeCtx(approvals, { allow: true }); // even an auto-approving gate must not help
  const res = await tools.executeTool('run_command', JSON.stringify({ command: 'rm -rf /' }), ctx);
  assert.equal(res.ok, false);
  assert.match(res.output, /BLOCKED_DANGEROUS_COMMAND/, 'destructive guard fires on the raw string');
  assert.equal(approvals.length, 0, 'a hard-blocked command never reaches the approval gate');
});

test('run_command: danger-classified command triggers a FORCED approval even in fullAccess', async () => {
  const approvals = [];
  const ctx = makeCtx(approvals, { allow: true });
  ctx.fullAccess = true; // the whole point: force:true must survive fullAccess
  const res = await tools.executeTool('run_command', JSON.stringify({ command: 'git push --force origin main' }), ctx);
  assert.equal(approvals.length, 1, 'the approval gate MUST be consulted');
  assert.equal(approvals[0].kind, 'command');
  assert.equal(approvals[0].force, true, 'risk-classifier danger forces the approval');
  assert.match(approvals[0].title, /DANGEROUS/i);
  assert.match(approvals[0].payload.command, /git push --force/);
  // The APPROVED command is allowed to reach the shell runner (here it runs
  // and honestly reports a non-zero exit — there is no repo in the temp ws).
  assert.match(res.output, /\[exit code:/, 'an approved command reaches the runner');
});

test('run_command: denial at the gate stops a dangerous command', async () => {
  const approvals = [];
  const ctx = makeCtx(approvals, { allow: false });
  const res = await tools.executeTool('run_command', JSON.stringify({ command: 'git push --force origin main' }), ctx);
  assert.equal(res.ok, false, 'denied command must not run');
  assert.match(res.output, /denied/i);
  assert.equal(approvals.length, 1);
});

test('run_command: benign command takes the normal (non-forced) gate', async () => {
  const approvals = [];
  const ctx = makeCtx(approvals, { allow: false });
  const res = await tools.executeTool('run_command', JSON.stringify({ command: 'echo release-audit-ok' }), ctx);
  assert.equal(res.ok, false, 'denied benign command does not run');
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].kind, 'command');
  assert.notEqual(approvals[0].force, true, 'a safe command must NOT force the dialog');
});

// ============================================================
// 3 · MEMORY PATH JAIL — kdx:memory:read/write through fsService
// (regression for the release-audit fix: the renderer-supplied
// workspace must satisfy the same confinement as every fs channel)
// ============================================================
const handlers = globalThis.__KDX_HANDLERS ?? {};
test('setup: ipc handlers registered', () => {
  // registerIpc() registers the whole kdx:* surface into the recording stub
  const ipc = require(join(tmp, 'ipc.cjs'));
  ipc.registerIpc({ getMainWindow: () => null });
  assert.equal(typeof handlers['kdx:memory:write'], 'function', 'kdx:memory:write registered');
  assert.equal(typeof handlers['kdx:memory:read'], 'function', 'kdx:memory:read registered');
  assert.equal(typeof handlers['kdx:workspace:set'], 'function', 'kdx:workspace:set registered');
});

test('memory jail: the active workspace accepts a normal MEMORY.md write', async () => {
  const set = await handlers['kdx:workspace:set'](null, ws);
  assert.equal(set.ok, true, 'workspace confinement pinned via the real channel');
  const res = await handlers['kdx:memory:write'](null, ws, '# Memory\nhello');
  assert.equal(res.ok, true, 'in-workspace MEMORY.md write works');
  assert.equal(readFileSync(join(ws, 'MEMORY.md'), 'utf8'), '# Memory\nhello');
  const read = await handlers['kdx:memory:read'](null, ws);
  assert.equal(read.ok, true);
  assert.equal(read.content, '# Memory\nhello');
});

test('memory jail: a workspace outside the confine root is refused (nothing written)', async () => {
  const res = await handlers['kdx:memory:write'](null, outsideDir, 'evil');
  assert.equal(res.ok, false, 'outside-workspace memory write refused');
  assert.equal(res.error, 'WORKSPACE_NOT_FOUND');
  assert.ok(!existsSync(join(outsideDir, 'MEMORY.md')), 'NO file was created outside the jail');
  const read = await handlers['kdx:memory:read'](null, outsideDir);
  assert.equal(read.ok, false);
  assert.equal(read.error, 'WORKSPACE_NOT_FOUND');
});

test('memory jail: ../ traversal from the workspace is refused (nothing written)', async () => {
  const escapeWs = join(ws, '..', 'escape-ws');
  const res = await handlers['kdx:memory:write'](null, escapeWs, 'evil');
  assert.equal(res.ok, false);
  assert.equal(res.error, 'WORKSPACE_NOT_FOUND');
  assert.ok(!existsSync(join(escapeWs, 'MEMORY.md')), 'traversal must not plant MEMORY.md outside');
});

test('memory jail: confinement rejection is audited as fs_block', async () => {
  await handlers['kdx:memory:write'](null, outsideDir, 'evil again');
  const recent = handlers['kdx:sec:auditRecent'];
  if (typeof recent !== 'function') return; // guard channel registered by terminalService import
  const entries = await recent(50); // the handler is async (ipcMain.handle contract)
  assert.ok(Array.isArray(entries), 'auditRecent returns an entries array');
  const hit = entries.find(
    (e) => e.kind === 'fs_block' && String(e.detail?.op) === 'memory_write' && String(e.detail?.path).includes('outside'),
  );
  assert.ok(hit, 'fs_block audit entry present for the refused memory write');
});
