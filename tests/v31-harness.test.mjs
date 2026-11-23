import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
// ============================================================
// Surnia v3.1.0 — universal-builder + assistant capability tests
// Covers the v3.1 powers (offline, no LLM):
//   - new tool defs: make_document / multi_edit / move_path /
//     delete_path / reveal_in_folder / ask_user (+ run_command cwd)
//   - make_document end-to-end: md / html / csv / docx / xlsx /
//     pdf (offline fallback renderer) inside the workspace jail
//   - multi_edit atomic multi-hunk editing + failure semantics
//   - move_path / delete_path happy paths + protected-path refusals
//   - ziplite produces a valid ZIP (docx container sanity)
//   - minipdf produces a valid PDF header/xref
//   - capability contract v3.1 prompt sections + machine capabilities
//   - refusal/mid-task/max-tokens recovery constants present
// Run: node --test tests/v31-harness.test.mjs   (requires `npm i` first)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'surnia-v31-'));

// ---------- esbuild bundle (same posture as v3-harness) ----------
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
   function Notification() { this.show = () => {}; this.on = () => {}; }
   Notification.isSupported = () => false;
   class StubWebContents {
     on() {}
     setWindowOpenHandler() {}
     async loadURL() {}
     async executeJavaScript() { return []; }
     async capturePage() { return { toPNG: () => Buffer.alloc(10), getSize: () => ({ width: 1, height: 1 }) }; }
     async printToPDF() { return Buffer.from('%PDF-1.4 stub'); }
   }
   class StubBrowserWindow {
     constructor() { this.webContents = new StubWebContents(); }
     destroy() {}
     setBounds() {}
     getBounds() { return { x: 0, y: 0 }; }
   }
   module.exports = {
     app: { getPath: (k) => paths[k] ?? paths.userData, setName() {}, setPath() {}, isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },
     ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
     Notification,
     shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder: () => {}, trashItem: async () => {} },
     clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }), toPNG: () => Buffer.alloc(0) }) },
     WebContents: class {},
     BrowserWindow: StubBrowserWindow,
   };`,
);

const toolsPath = join(tmp, 'tools.cjs');
bundle('electron/agent/tools.ts', toolsPath);
const tools = require(toolsPath);

const promptsPath = join(tmp, 'prompts.cjs');
bundle('electron/agent/prompts.ts', promptsPath);
const { buildSystemPrompt } = require(promptsPath);

// ---------- stub ToolContext (approve always; records kinds) ----------
function stubCtx(ws, opts = {}) {
  const approvals = [];
  return {
    workspace: ws,
    sessionId: 'test-session',
    mcpServers: [],
    emit: () => {},
    approve: async (req) => {
      approvals.push(req.kind);
      return opts.approve === false ? false : true;
    },
    ...(opts.askUser !== undefined ? { askUser: opts.askUser } : {}),
    denyHint: opts.denyHint,
    fullAccess: !!opts.fullAccess,
    approvals,
  };
}

const WS = join(tmp, 'ws');
mkdirSync(WS, { recursive: true });

// ---------- 1. v3.1 tool defs ----------
test('v3.1 tool defs are registered with the right required params', () => {
  const defs = tools.getToolDefs([]);
  const byName = Object.fromEntries(defs.map((d) => [d.name, d]));
  for (const name of ['make_document', 'multi_edit', 'move_path', 'delete_path', 'reveal_in_folder', 'ask_user']) {
    assert.ok(byName[name], `${name} def missing`);
  }
  // v11.37 (M1) — make_document now accepts alias args (path/content variants)
  // so required:[] and the executor validates + resolves them; this stopped the
  // 4× retry loop on alias-shaped calls.
  assert.ok(Array.isArray(byName.make_document.parameters.required), 'make_document has a required array');
  assert.ok(byName.make_document.parameters.properties?.path, 'path property declared');
  assert.ok(byName.make_document.parameters.properties?.content, 'content property declared');
  assert.deepEqual(byName.multi_edit.parameters.required, ['path', 'edits']);
  assert.deepEqual(byName.move_path.parameters.required, ['source', 'dest']);
  assert.deepEqual(byName.delete_path.parameters.required, ['path']);
  assert.deepEqual(byName.ask_user.parameters.required, ['question']);
  // run_command gained cwd
  assert.ok(byName.run_command.parameters.properties.cwd, 'run_command.cwd param present');
  // tool inventory grew past 55
  assert.ok(defs.length >= 55, `expected ≥55 core tools, got ${defs.length}`);
});

// ---------- 2. make_document ----------
test('make_document: md / csv / html written inside the workspace', async () => {
  const ctx = stubCtx(WS);
  const md = await tools.executeTool(
    'make_document',
    JSON.stringify({ path: 'reports/notes.md', content: '# Notes\n\nHello world', format: 'md', title: 'Notes' }),
    ctx,
  );
  assert.equal(md.ok, true, md.output);
  assert.ok(existsSync(join(WS, 'reports', 'notes.md')));

  const csv = await tools.executeTool(
    'make_document',
    JSON.stringify({ path: 'reports/data.csv', content: 'a,b\n1,2' }),
    ctx,
  );
  assert.equal(csv.ok, true, csv.output);

  const html = await tools.executeTool(
    'make_document',
    JSON.stringify({ path: 'reports/page.html', content: '# T\n\nBody text', format: 'html', title: 'T' }),
    ctx,
  );
  assert.equal(html.ok, true, html.output);
  const htmlText = readFileSync(join(WS, 'reports', 'page.html'), 'utf8');
  assert.ok(htmlText.includes('<h2>'), 'markdown rendered to heading');
  assert.ok(htmlText.includes('<!doctype html>'), 'html document shell present');
});

test('make_document: docx and xlsx are valid OOXML zip containers', async () => {
  const ctx = stubCtx(WS);
  const docx = await tools.executeTool(
    'make_document',
    JSON.stringify({ path: 'docs/report.docx', content: '# Report\n\nIntro paragraph.\n\n- one\n- two', title: 'Report' }),
    ctx,
  );
  assert.equal(docx.ok, true, docx.output);
  const docxBuf = readFileSync(join(WS, 'docs', 'report.docx'));
  assert.equal(docxBuf.readUInt32LE(0), 0x04034b50, 'docx starts with ZIP local header');
  assert.ok(docxBuf.length > 500, 'docx has real content');

  const xlsx = await tools.executeTool(
    'make_document',
    JSON.stringify({ path: 'docs/table.xlsx', content: 'name,qty\nwidget,3\ngear,10' }),
    ctx,
  );
  assert.equal(xlsx.ok, true, xlsx.output);
  const xlsxBuf = readFileSync(join(WS, 'docs', 'table.xlsx'));
  assert.equal(xlsxBuf.readUInt32LE(0), 0x04034b50, 'xlsx starts with ZIP local header');
});

test('make_document: pdf via offline fallback renderer is a valid PDF', async () => {
  const ctx = stubCtx(WS);
  const pdf = await tools.executeTool(
    'make_document',
    JSON.stringify({
      path: 'docs/summary.pdf',
      content: '# Summary\n\nFirst paragraph with plenty of words to wrap around the line nicely.\n\n- bullet one\n- bullet two',
      title: 'Summary',
    }),
    ctx,
  );
  assert.equal(pdf.ok, true, pdf.output);
  const buf = readFileSync(join(WS, 'docs', 'summary.pdf'));
  assert.ok(buf.subarray(0, 5).toString('latin1').startsWith('%PDF-'), 'PDF magic header');
  assert.ok(buf.toString('latin1').includes('%%EOF'), 'PDF EOF marker');
  assert.ok(buf.toString('latin1').includes('/Type /Catalog'), 'PDF catalog object');
});

test('make_document: outside-workspace path throws containment; empty content refused', async () => {
  const ctx = stubCtx(WS);
  const esc = await tools.executeTool(
    'make_document',
    JSON.stringify({ path: join(tmp, 'outside.md'), content: 'x', format: 'md' }),
    stubCtx(WS, { approve: false }), // v11.37 — refuse the escape, expect honest error
  );
  // v11.37 (M1) — an outside-workspace path is either an honest refusal OR a
  // single escalation (approval token / explicit escape note); never a silent
  // write outside the workspace. Assert no silent success.
  if (esc.ok) {
    assert.ok(/approv|escape|confirm|fullAccess/i.test(esc.output ?? ''), 'external write must be an explicit escalation');
  } else {
    assert.ok(/outside|workspace|escap|approv|fix/i.test(esc.output ?? ''), 'honest actionable refusal');
  }
  const empty = await tools.executeTool('make_document', JSON.stringify({ path: 'a.md', content: '  ' }), ctx);
  assert.equal(empty.ok, false);
});

// ---------- 3. multi_edit ----------
test('multi_edit: atomic multi-hunk edit, one approval, failure semantics', async () => {
  const ctx = stubCtx(WS);
  const file = join(WS, 'app.js');
  writeFileSync(file, 'const a = 1;\nconst b = 2;\nconst c = 3;\n', 'utf8');

  // v7 contract: read-before-edit is HARNESS-ENFORCED — the fixture reads
  // through the real tool so the ledger records the file.
  const pre = await tools.executeTool('read_file', JSON.stringify({ path: 'app.js' }), ctx);
  assert.equal(pre.ok, true, 'read_file before multi_edit');

  const res = await tools.executeTool(
    'multi_edit',
    JSON.stringify({
      path: 'app.js',
      edits: [
        { old_string: 'const a = 1;', new_string: 'const a = 10;' },
        { old_string: 'const c = 3;', new_string: 'const c = 30;\nconst d = 40;' },
      ],
    }),
    ctx,
  );
  assert.equal(res.ok, true, res.output);
  const text = readFileSync(file, 'utf8');
  assert.ok(text.includes('const a = 10;'), 'edit 1 applied');
  assert.ok(text.includes('const d = 40;'), 'edit 2 applied');
  assert.equal(ctx.approvals.filter((k) => k === 'write').length, 1, 'exactly ONE write approval');

  // missing old_string → failure, file untouched
  const before = readFileSync(file, 'utf8');
  const bad = await tools.executeTool(
    'multi_edit',
    JSON.stringify({ path: 'app.js', edits: [{ old_string: 'NOT PRESENT', new_string: 'x' }] }),
    ctx,
  );
  assert.equal(bad.ok, false);
  assert.match(bad.output, /not found/);
  assert.equal(readFileSync(file, 'utf8'), before, 'file unchanged after failed batch');
});

// ---------- 4. move_path / delete_path ----------
test('move_path renames within the workspace; delete_path refuses protected paths', async () => {
  const ctx = stubCtx(WS);
  const src = join(WS, 'old-name.txt');
  writeFileSync(src, 'payload', 'utf8');
  const mv = await tools.executeTool(
    'move_path',
    JSON.stringify({ source: 'old-name.txt', dest: 'renamed/notes/new-name.txt' }),
    ctx,
  );
  assert.equal(mv.ok, true, mv.output);
  assert.ok(existsSync(join(WS, 'renamed', 'notes', 'new-name.txt')));
  assert.ok(!existsSync(src), 'source gone after move');

  // destination collision refusal
  writeFileSync(join(WS, 'collision.txt'), 'x', 'utf8');
  const coll = await tools.executeTool(
    'move_path',
    JSON.stringify({ source: 'collision.txt', dest: 'renamed/notes/new-name.txt' }),
    ctx,
  );
  assert.equal(coll.ok, false);
  assert.match(coll.output, /already exists/);

  // delete_path: trash default; protected-path refusal for the workspace root
  const del = await tools.executeTool('delete_path', JSON.stringify({ path: 'collision.txt' }), ctx);
  assert.equal(del.ok, true, del.output);
  assert.ok(!existsSync(join(WS, 'collision.txt')), 'file deleted');
  assert.ok(ctx.approvals.includes('delete'), 'delete approval kind used');

  const rootDel = await tools.executeTool('delete_path', JSON.stringify({ path: '.' }), ctx);
  assert.equal(rootDel.ok, false, 'workspace root refused');
  const rootDel2 = await tools.executeTool('delete_path', JSON.stringify({ path: '/' }), ctx);
  assert.equal(rootDel2.ok, false, 'filesystem root refused');
  const usrDel = await tools.executeTool('delete_path', JSON.stringify({ path: '/usr' }), ctx);
  assert.equal(usrDel.ok, false, 'system directory refused');
});

// ---------- 5. ask_user ----------
test('ask_user returns the user answer and handles dismissal', async () => {
  const ctxAnswer = stubCtx(WS, { askUser: async () => 'React + Vite' });
  const ans = await tools.executeTool(
    'ask_user',
    JSON.stringify({ question: 'Which stack?', choices: ['React + Vite', 'Next.js'] }),
    ctxAnswer,
  );
  assert.equal(ans.ok, true);
  assert.match(ans.output, /React \+ Vite/);

  const ctxDismiss = stubCtx(WS, { askUser: async () => '' });
  const dismissed = await tools.executeTool('ask_user', JSON.stringify({ question: 'Which?' }), ctxDismiss);
  assert.equal(dismissed.ok, true);
  assert.match(dismissed.output, /best judgment|dismissed/i);

  const ctxNone = stubCtx(WS); // no askUser → headless guidance
  const headless = await tools.executeTool('ask_user', JSON.stringify({ question: 'Which?' }), ctxNone);
  assert.equal(headless.ok, false);
  assert.match(headless.output, /assumption|unavailable/i);
});

// ---------- 6. prompt: v3.1 sections ----------
test('capability contract v3.1: universal sections + machine capabilities injection', () => {
  const prompt = buildSystemPrompt({
    workspace: WS,
    mode: 'default',
    platform: 'linux',
    envSummary: 'os: linux\nnode: v24.0.0\npython: no',
  });
  assert.ok(prompt.includes('# Capability contract (read this first)'), 'v3.1 contract section');
  assert.ok(prompt.includes('LITERALLY ANYTHING'), 'universal programming claim');
  assert.ok(prompt.includes('make_document'), 'document tool surfaced');
  assert.ok(prompt.includes('ask_user'), 'ask_user surfaced');
  assert.ok(prompt.includes('multi_edit'), 'multi_edit surfaced');
  assert.ok(prompt.includes('move_path') && prompt.includes('reveal_in_folder'), 'file-management tools surfaced');
  assert.ok(prompt.includes('# Machine capabilities'), 'env probe section present');
  assert.ok(prompt.includes('node: v24.0.0'), 'env summary injected');
  assert.ok(prompt.includes('make_document (PDF renders full CSS'), 'stack table mentions make_document');
});

// ---------- 7. engine constants (recovery mechanisms present) ----------
test('engine v3.1: recovery mechanisms are wired in source', () => {
  const src = readFileSync(join(ROOT, 'electron', 'agent', 'engine.ts'), 'utf8');
  assert.ok(src.includes("ENGINE_VERSION = 'v3.1.0-engine'"), 'engine version bumped');
  assert.ok(src.includes('maxTokensContinues'), 'max_tokens auto-continue present');
  assert.ok(src.includes('MID-TASK refusal recovery'), 'mid-task refusal recovery present');
  assert.ok(src.includes('s.command || s.url'), 'remote MCP servers included in discovery');
  assert.ok(src.includes('slugMcpName(server.name)'), 'MCP prompt names slugged');
  assert.ok(src.includes('machineCapabilitySummary'), 'machine capability summary injected');
});

test('cleanup', () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
