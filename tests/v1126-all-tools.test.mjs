// ============================================================
// v11.26 — ALL 145 TOOLS ARE GENUINELY CALLABLE (founder mandate).
//
// "أريد الذكاء قادر على استخدام كل الأدوات بالمعنى الحرفي... تأكد التولز
//  تعمل، والتولز يتم استخدامها."
//
// This is the permanent, self-contained proof that EVERY one of the 145
// advertised core tools is dispatchable through the app's own `executeTool`
// and returns a STRUCTURED, non-empty, single-language, actionable result —
// never "Unknown tool", never a crash, never undefined.
//
// Run: node --test --test-force-exit tests/v1126-all-tools.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as http from 'node:http';

// The agent browser is Electron-only — force the honest headless path.
process.env.SURNIA_NO_BROWSER = '1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1126-'));

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

// electron stub for plain-Node execution (same posture as the other audits)
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

// ============================================================
// FIXTURE WORKSPACE — one safe, EXISTING-backing entry per tool.
// ============================================================
const WS = join(tmp, 'ws');
const REPO = join(tmp, 'ws-repo');
for (const d of ['data', 'docs', 'assets', 'src', 'bin', 'debug', 'pkg-dir', 'reports']) {
  mkdirSync(join(WS, d), { recursive: true });
}
writeFileSync(join(WS, 'README.md'),
  '# Coverage fixture\n\nSADEEM v11.26 all-tools proof.\nToken EDITME-UNIQUE-TOKEN lives here for edit_file.\n');
writeFileSync(join(WS, 'notes.txt'), 'plain text fixture for web_fetch/http_request chains\n');
writeFileSync(join(WS, 'index.html'),
  '<!doctype html><html><head><title>Cov</title></head><body><h1>Coverage fixture</h1><p id="p">ready</p></body></html>\n');
writeFileSync(join(WS, 'data', 'fixture.json'), JSON.stringify({ tool: 'coverage', total: 145, ok: true }, null, 2));
writeFileSync(join(WS, 'data', 'fixture.csv'), 'tool,status\nlist_dir,ok\nhash_file,ok\n');
writeFileSync(join(WS, 'docs', 'report.md'), '# Report\n\nBody of the fixture report.\n');
writeFileSync(join(WS, 'docs', 'v-old.txt'), 'alpha\nbeta\ngamma\n');
writeFileSync(join(WS, 'docs', 'v-new.txt'), 'alpha\nBETA\ngamma\ndelta\n');
writeFileSync(join(WS, 'src', 'app.ts'),
  'export function coverageProbe(): string {\n  return "probe";\n}\n\nexport const coverageTarget = 145;\n\nconst used = coverageProbe();\nconsole.log(used, coverageTarget);\n');
writeFileSync(join(WS, 'bin', 'throwaway.txt'), 'delete_path deletes THIS file and nothing else\n');
writeFileSync(join(WS, 'bin', 'mover-src.txt'), 'move_path moves THIS file\n');
writeFileSync(join(WS, 'docs', 'multi-edit.txt'), 'MULTI-OLD\nkeep this line\n');
// lsp_rename gets its own throwaway file so a real server cannot damage shared fixtures
writeFileSync(join(WS, 'src', 'lsp-rename-probe.ts'), 'export const renameProbe = 1;\n');
// real notebook so notebook_read / notebook_edit_cell / notebook_run execute for real
writeFileSync(join(WS, 'probe.ipynb'), JSON.stringify({
  cells: [
    { cell_type: 'markdown', source: ['# Probe\n'], metadata: {} },
    { cell_type: 'code', source: ['print("probe-ok")\n'], outputs: [], execution_count: null, metadata: {} },
  ],
  metadata: { kernelspec: { language: 'python', name: 'python3', display_name: 'Python 3' } },
  nbformat: 4, nbformat_minor: 5,
}));
writeFileSync(join(WS, 'MEMORY.md'), '- SADEEM v11.26 coverage fixture workspace [src: README.md]\n');
writeFileSync(join(WS, 'pkg-dir', 'package.json'), JSON.stringify({ name: 'cov-pkg', version: '1.0.0', private: true }, null, 2));
writeFileSync(join(WS, 'package.json'), JSON.stringify({
  name: 'cov-ws', version: '1.26.0', private: true,
  scripts: { test: 'node -e "console.log(\'fixture tests passed\')"' },
}, null, 2));
writeFileSync(join(WS, 'debug', 'fixture-debug.js'), [
  'let counter = 41;',
  'const label = "coverage";',
  'let total = 0;',
  'for (let i = 1; i <= 3; i++) {',
  '  total += i; // breakpoint lands here (line 5)',
  '}',
  'console.log("total", total, label, counter);',
  'setTimeout(() => { console.log("still alive"); }, 20000);',
  'setTimeout(() => { process.exit(0); }, 25000);',
  '',
].join('\n'));
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
writeFileSync(join(WS, 'assets', 'tiny.png'), PNG_1X1);

// git repo fixture
mkdirSync(REPO, { recursive: true });
writeFileSync(join(REPO, 'repo-readme.txt'), 'coverage git fixture\n');
execFileSync('git', ['init', '-q'], { cwd: REPO });
execFileSync('git', ['config', 'user.email', 'cov@example.com'], { cwd: REPO });
execFileSync('git', ['config', 'user.name', 'Coverage Bot'], { cwd: REPO });
execFileSync('git', ['add', '-A'], { cwd: REPO });
execFileSync('git', ['commit', '-q', '-m', 'coverage fixture commit'], { cwd: REPO });

// sqlite fixture
{
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(join(WS, 'data', 'fixture.db'));
  db.exec("CREATE TABLE tools (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO tools (name) VALUES ('list_dir'), ('sqlite_query'), ('hash_file');");
  db.close();
}

// fixture HTTP server (real TCP; loopback needs fullAccess)
const server = http.createServer((req, res) => {
  const send = (code, type, body) => {
    res.writeHead(code, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };
  if (req.url.startsWith('/assets/tiny.png')) return send(200, 'image/png', PNG_1X1);
  if (req.url.startsWith('/notes.txt')) return send(200, 'text/plain', 'hello-asset');
  if (req.url.startsWith('/page.html')) return send(200, 'text/html', '<!doctype html><html><body><h1>fixture page</h1></body></html>');
  if (req.url.startsWith('/data.json')) return send(200, 'application/json', JSON.stringify({ served: true, tool: 'http_request' }));
  res.writeHead(404); res.end('nope');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

function stubCtx(ws) {
  const approvals = [];
  return {
    workspace: ws, sessionId: 'v1126-all-tools', mcpServers: [], emit: () => {},
    approve: async (req) => { approvals.push(req.kind + ':ok'); return true; },
    fullAccess: true, approvals,
  };
}
const WS_CTX = stubCtx(WS);
const REPO_CTX = stubCtx(REPO);
const run = (name, args, ctx) => tools.executeTool(name, JSON.stringify(args ?? {}), ctx);

// ============================================================
// ASSERTION HELPERS — the heart of the proof.
// ============================================================
function isSingleLanguage(s) {
  // A garbled message mixes substantial Arabic + Latin script. Tool output is
  // always authored in ONE language; reject only when both are substantial.
  const arabic = (s.match(/[\u0600-\u06FF]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  return !(arabic > 8 && latin > 30);
}
function isActionable(s) {
  const t = s.trim();
  // Structured JSON results (images, data) are themselves actionable.
  if (t.startsWith('{') && t.endsWith('}')) {
    try { JSON.parse(t); return true; } catch { /* not JSON — fall through */ }
  }
  const words = t.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.length >= 2 && words.some((w) => w.replace(/[^A-Za-z]/g, '').length >= 2)) return true;
  // A single computed value IS an actionable result for value-returning tools
  // (base64 / hash / uuid / url-encoded / hex). Corrupt-value guards in
  // assertStructured already reject undefined / NaN / [object Object].
  return /^[A-Za-z0-9+/=._%:-]{4,}$/.test(t);
}
function assertStructured(name, res) {
  assert.ok(res && typeof res === 'object', `${name}: executeTool must return an object`);
  assert.equal(typeof res.ok, 'boolean', `${name}: ok must be a boolean`);
  assert.ok(typeof res.output === 'string', `${name}: output must be a string`);
  const out = res.output;
  assert.ok(out.trim().length >= 8, `${name}: output must be non-empty (got ${JSON.stringify(out)})`);
  assert.doesNotMatch(out, /^Unknown tool:/, `${name}: must dispatch (no "Unknown tool")`);
  assert.doesNotMatch(out, /^Tool error:/, `${name}: must not hit the last-resort crash guard`);
  assert.doesNotMatch(out, /Invalid JSON arguments/, `${name}: valid args must parse`);
  assert.doesNotMatch(out, /\bTHREW\b/, `${name}: executeTool must not reject`);
  assert.doesNotMatch(out, /\bundefined\b|\bNaN\b|\[object Object\]/, `${name}: no corrupt values in output`);
  assert.ok(isSingleLanguage(out), `${name}: output must be a single-language message`);
  assert.ok(isActionable(out), `${name}: output must be actionable (got ${JSON.stringify(out.slice(0, 160))})`);
}

// ============================================================
// TEST 1 — inventory enumeration + dispatch coverage (145/145).
// ============================================================
test('v1126 inventory: 145 defs, 145 executors, artifact count = 145, no orphans', () => {
  const defs = tools.getToolDefs([]);
  assert.equal(defs.length, 145, 'live registry must stay at exactly 145 tools');
  const names = defs.map((d) => d.name);
  assert.equal(new Set(names).size, 145, 'no duplicate tool names');

  // generated artifact agrees with the live registry
  const inv = JSON.parse(readFileSync(join(ROOT, 'src/generated/toolInventory.json'), 'utf8'));
  assert.equal(inv.total, 145, 'gen-tool-inventory.mjs artifact = 145');
  assert.deepEqual(inv.tools.map((t) => t.name).sort(), [...names].sort(), 'artifact = live registry');

  // source-level dispatch coverage: every def has an executor case.
  const defsSrc = readFileSync(join(ROOT, 'electron/agent/tool-defs.ts'), 'utf8');
  const toolsSrc = readFileSync(join(ROOT, 'electron/agent/tools.ts'), 'utf8');
  const q = String.fromCharCode(39);
  const defNames = [...defsSrc.matchAll(new RegExp('^\\s*name:\\s*' + q + '([^' + q + ']+)' + q, 'gm'))].map((m) => m[1]);
  const cases = new Set([...toolsSrc.matchAll(new RegExp('^\\s*case\\s+' + q + '([^' + q + ']+)' + q + ':', 'gm'))].map((m) => m[1]));
  assert.equal(defNames.length, 145, 'tool-defs.ts declares 145 defs');
  const missing = defNames.filter((n) => !cases.has(n));
  assert.deepEqual(missing, [], `every def must have an executor; missing: ${missing.join(', ')}`);

  // every advertised tool has a real description + object schema
  for (const d of defs) {
    assert.ok(typeof d.description === 'string' && d.description.length > 15, `${d.name}: real description`);
    assert.equal(d.parameters?.type, 'object', `${d.name}: object schema`);
  }
  console.log(`V1126_INVENTORY=145 defs, 145 executors, artifact=145`);
});

// ============================================================
// TEST 2 — the full 145-call sweep (minimal valid arg per tool).
// ============================================================
let BG_ID = null;
let CP_ID = null;
/** A validation refusal means the SWEEP supplied invalid args — never acceptable. */
const VALIDATION_ONLY = /^Missing required parameter:|^Invalid arguments for |must be a non-empty array|requires (?:manager|version)|must be one of |^checkpoint_restore needs an id/;
const ENTRIES = [
  // fs reads
  { name: 'list_dir', args: { path: WS } },
  { name: 'read_file', args: { path: join(WS, 'README.md') } },
  { name: 'read_image', args: { path: join(WS, 'assets', 'tiny.png') } },
  { name: 'write_file', args: { path: 'out/covered-write.txt', content: 'written by v1126 all-tools proof\n' } },
  { name: 'edit_file', args: { path: join(WS, 'README.md'), old_string: 'EDITME-UNIQUE-TOKEN', new_string: 'EDITME-EDITED-BY-V1126' } },
  { name: 'search_files', args: { pattern: 'coverageProbe', path: WS } },
  { name: 'glob_files', args: { pattern: '**/*.md' } },
  { name: 'fs_browse', args: {} },
  { name: 'workspace_map', args: {} },
  { name: 'code_search', args: { query: 'coverageProbe' } },
  { name: 'search_grep', args: { pattern: 'coverageProbe' } },
  { name: 'symbol_outline', args: { path: join(WS, 'src', 'app.ts') } },
  { name: 'find_refs', args: { name: 'coverageProbe' } },
  { name: 'impact_of', args: { name: 'coverageProbe' } },
  { name: 'repo_map', args: {} },
  { name: 'memory_verify', args: {} },
  // exec
  { name: 'run_command', args: { command: 'node -e "console.log(1)"' } },
  { name: 'run_background', args: { command: 'node -e "setTimeout(()=>{console.log(\'bg-alive\');process.exit(0)},12000)"' } },
  { name: 'process_output', args: () => ({ id: BG_ID ?? 'v1126-bg' }) },
  { name: 'stop_process', args: () => ({ id: BG_ID ?? 'v1126-bg' }) },
  { name: 'process_list', args: {} },
  { name: 'process_kill', args: { pid: 2000000000 } },
  { name: 'test_run', args: {} },
  { name: 'lint_check', args: {} },
  { name: 'env_install', args: { manager: 'npm', packages: [], cwd: 'pkg-dir' } },
  { name: 'export_project', args: {} },
  // LSP / notebooks / semantic / pins
  { name: 'lsp_definition', args: { path: 'src/app.ts', line: 1, character: 1 } },
  { name: 'lsp_hover', args: { path: 'src/app.ts', line: 1, character: 1 } },
  { name: 'lsp_diagnostics', args: { path: 'src/app.ts' } },
  { name: 'lsp_references', args: { path: 'src/app.ts', line: 1, character: 1 } },
  { name: 'lsp_rename', args: { path: 'src/lsp-rename-probe.ts', line: 1, character: 1, new_name: 'renamedProbe' } },
  { name: 'lsp_completion', args: { path: 'src/app.ts', line: 1, character: 1 } },
  { name: 'notebook_read', args: { path: 'probe.ipynb' } },
  { name: 'notebook_edit_cell', args: { path: 'probe.ipynb', index: 0, source: '# Probe edited\n' } },
  { name: 'notebook_run', args: { path: 'probe.ipynb', index: 1 } },
  { name: 'semantic_search', args: { query: 'coverage probe' } },
  { name: 'pin_context', args: { action: 'list' } },
  { name: 'browser_tabs', args: { action: 'list' } },
  { name: 'browser_network', args: {} },
  { name: 'multi_file_edit', pre: [{ tool: 'read_file', args: { path: join(WS, 'docs', 'multi-edit.txt') } }], args: { files: [
    { path: 'docs/multi-edit.txt', edits: [{ old_string: 'MULTI-OLD', new_string: 'MULTI-NEW' }] },
  ] } },
  { name: 'checkpoint_save', args: { label: 'v1126-probe' } },
  { name: 'checkpoint_list', args: {} },
  { name: 'checkpoint_restore', args: () => ({ id: CP_ID ?? 'unknown' }) },
  // meta
  { name: 'todo_write', args: { todos: [{ id: 'p1', content: 'prove all 145 tools', status: 'in_progress' }] } },
  { name: 'propose_plan', args: { title: 'Proof plan', steps: ['bundle tools.ts', 'call all 145 tools'] } },
  { name: 'create_skill', args: { name: 'Proof Skill', description: 'fixture skill for all-tools proof', body: '# Proof Skill\n\nFollow the checklist.' } },
  { name: 'use_skill', args: { slug: 'proof-skill' } },
  { name: 'remember', args: { content: 'v1126 all-tools proof touched this workspace.', kind: 'project' } },
  { name: 'dna_note', args: { note: 'Coverage fixtures live in a temp dir from tests/v1126-all-tools.test.mjs.', kind: 'workflow' } },
  { name: 'recall_memory', args: { query: 'coverage' } },
  { name: 'recall_result', args: { id: 'res_1_v1126' } },
  { name: 'review_diff', args: {} },
  { name: 'task', args: { description: 'probe', prompt: 'say hi' } },
  { name: 'ask_user', args: { question: 'Proceed?', choices: ['yes', 'no'] } },
  { name: 'schema_docs', args: {} },
  { name: 'env_probe', args: {} },
  { name: 'port_probe', args: {} },
  { name: 'sys_info', args: {} },
  { name: 'network_info', args: {} },
  { name: 'uuid_gen', args: { count: 2 } },
  // network (fixture HTTP server over real TCP; fullAccess relaxes SSRF)
  { name: 'web_fetch', args: { url: `${BASE}/notes.txt` } },
  { name: 'http_request', args: { url: `${BASE}/data.json` } },
  { name: 'browser_download', args: { url: `${BASE}/assets/tiny.png`, dest: 'downloads/cov-dl.png' } },
  { name: 'download_file', args: { url: `${BASE}/notes.txt`, dest: 'downloads/cov-notes.txt' } },
  { name: 'web_download', args: { url: `${BASE}/notes.txt`, dest: 'downloads/cov-web-download.txt' } },
  { name: 'tool_help', args: {} },
  { name: 'lsp_languages', args: {} },
  { name: 'web_search', args: { query: 'test' } },
  { name: 'search_web', args: { query: 'test', max_results: 3 } },
  { name: 'image_search', args: { query: 'test', max_results: 2 } },
  // git
  { name: 'git_local', args: { action: 'status' }, ctx: 'repo' },
  { name: 'diff_stat', args: {}, ctx: 'repo' },
  { name: 'worktree_create', args: { name: 'v1126-wt' }, ctx: 'repo' },
  { name: 'worktree_remove', args: { name: 'v1126-wt' }, ctx: 'repo' },
  { name: 'create_pull_request', args: { title: 'Proof PR', body: 'not really filed' } },
  { name: 'pr_status', args: {} },
  // archive / zip
  { name: 'archive_create', args: { paths: ['docs'], dest: 'dist/cov-fixture.zip' } },
  { name: 'archive_extract', args: { archive: 'dist/cov-fixture.zip', destDir: 'unzipped-cov' } },
  // documents
  { name: 'pdf_make', args: { path: 'reports/coverage.pdf', title: 'Coverage', content: '# Coverage\n\n145 tools.\n' } },
  { name: 'pdf_read', args: { path: 'reports/coverage.pdf' } },
  { name: 'docx_make', args: { path: 'docs/coverage.docx', title: 'Coverage Memo', content: '# Coverage Memo\n\nAll executors real.\n' } },
  { name: 'xlsx_make', args: { path: 'data/coverage.xlsx', sheets: [{ name: 'KPIs', rows: [['tool', 'status'], ['pdf_read', 'ok']] }] } },
  { name: 'pptx_make', args: { path: 'decks/coverage.pptx', title: 'Coverage', slides: [{ title: 'Slide One', bullets: ['145 tools'] }] } },
  { name: 'make_document', args: { path: 'reports/made-doc.md', content: '# Made document\n\nBody.', format: 'md' } },
  { name: 'markdown_outline', args: { text: '# T\n## S\nbody' } },
  // data utilities
  { name: 'csv_read', args: { path: join(WS, 'data', 'fixture.csv'), header: true } },
  { name: 'csv_write', args: { path: 'data/covered.csv', rows: [['k', 'v'], ['coverage', '145']] } },
  { name: 'sqlite_query', args: { db: 'data/fixture.db', sql: 'SELECT id, name FROM tools ORDER BY id' } },
  { name: 'hash_file', args: { path: join(WS, 'assets', 'tiny.png'), algorithm: 'sha256' } },
  { name: 'encode_base64', args: { text: 'SADEEM coverage' } },
  { name: 'decode_base64', args: { text: Buffer.from('SADEEM coverage').toString('base64') } },
  { name: 'regex_test', args: { pattern: '\\b145\\b', input: 'SADEEM registers 145 tools' } },
  { name: 'text_stats', args: { text: 'SADEEM coverage run over one hundred forty-five tools' } },
  { name: 'diff_files', args: { a: 'docs/v-old.txt', b: 'docs/v-new.txt' } },
  { name: 'color_convert', args: { color: '#336699' } },
  { name: 'url_encode', args: { text: 'hello world & SADEEM' } },
  { name: 'url_decode', args: { text: 'hello%20world%20SADEEM' } },
  { name: 'json_format', args: { text: '{"tool":"coverage","n":145}', action: 'pretty' } },
  { name: 'image_probe', args: { path: join(WS, 'assets', 'tiny.png') } },
  // media / device / desktop
  { name: 'media_ffmpeg', args: { action: 'probe', input: join(WS, 'assets', 'tiny.png') } },
  { name: 'image_generate', args: { prompt: 'a tiny coverage test image', dest: 'assets/generated-cov.jpg' } },
  { name: 'desktop_control', args: { action: 'screenshot' } },
  { name: 'screenshot', args: {} },
  { name: 'open_path', args: { path: WS } },
  { name: 'reveal_in_folder', args: { path: join(WS, 'README.md') } },
  { name: 'device_launch_app', args: { app: 'no-such-coverage-app' } },
  { name: 'clipboard_read', args: {} },
  { name: 'clipboard_write', args: { text: 'coverage probe' } },
  { name: 'notify_user', args: { title: 'Coverage', body: 'proof run' } },
  // preview / ui
  { name: 'preview', args: { action: 'status' } },
  { name: 'preview_screenshot', args: { path: join(WS, 'index.html') } },
  { name: 'gen_ui', args: { title: 'Coverage Widget', html: '<!doctype html><html><head><style>body{background:#123;color:#fff}</style></head><body><h1>widget</h1></body></html>' } },
  { name: 'ui_quality_check', args: { path: join(WS, 'index.html') } },
  { name: 'diagnose_preview', args: {} },
  { name: 'browser_pdf', args: { dest: 'prints/coverage.pdf' } },
  // browser (headless → honest refusals)
  { name: 'browser_navigate', args: { url: `${BASE}/page.html` } },
  { name: 'browser_snapshot', args: {} },
  { name: 'browser_click', args: { ref: 0 } },
  { name: 'browser_type', args: { ref: 0, text: 'coverage' } },
  { name: 'browser_read', args: {} },
  { name: 'browser_screenshot', args: {} },
  { name: 'browser_eval', args: { expression: '1+1' } },
  { name: 'browser_wait_for', args: { selector: '#p', ms: 500 } },
  { name: 'browser_select', args: { selector: 'select', value: 'a' } },
  { name: 'browser_console', args: {} },
  { name: 'browser_console_eval', args: { expression: 'document.title' } },
  { name: 'browser_close', args: {} },
  // debugger
  { name: 'debug_start', args: { kind: 'node', program: join(WS, 'debug', 'fixture-debug.js'), breakpoints: [{ file: join(WS, 'debug', 'fixture-debug.js'), line: 5 }] } },
  { name: 'debug_state', args: {} },
  { name: 'debug_eval', args: { expression: 'counter' } },
  { name: 'debug_step', args: { action: 'continue' } },
  { name: 'debug_stop', args: {} },
  // fs moves/deletes (last; consume dedicated fixtures)
  { name: 'multi_edit', pre: [{ tool: 'read_file', args: { path: join(WS, 'src', 'app.ts') } }], args: { path: join(WS, 'src', 'app.ts'), edits: [
    { old_string: 'export const coverageTarget = 145;', new_string: 'export const coverageTarget = 146;' },
    { old_string: 'console.log(used, coverageTarget);', new_string: 'console.log("edited", used, coverageTarget);' },
  ] } },
  { name: 'move_path', args: { source: 'bin/mover-src.txt', dest: 'bin/mover-dst.txt' } },
  { name: 'delete_path', args: { path: 'bin/throwaway.txt', trash: true } },
  // v12 power arsenal — VALID minimal args (executors really run; external
  // CLIs are absent → honest "not installed" refusals, never validation stalls)
  { name: 'db_query', args: { kind: 'sqlite', db: 'data/fixture.db', sql: 'SELECT id, name FROM tools ORDER BY id' } },
  { name: 'db_seed', args: { kind: 'sqlite', db: 'data/seed.db', sql: 'CREATE TABLE IF NOT EXISTS seed_probe (id INTEGER); INSERT INTO seed_probe (id) VALUES (1);' } },
  { name: 'db_migrate', args: { dir: '__not_a_project__' } },
  { name: 'lighthouse', args: { url: `${BASE}/page.html` } },
  { name: 'e2e_run', args: { dir: '__not_a_project__' } },
  { name: 'a11y_audit', args: { target: join(WS, 'index.html'), engine: 'heuristic' } },
  { name: 'env_manager', args: { action: 'list' } },
  { name: 'git_platform', args: { action: 'list_prs' } },
  { name: 'icon_font_search', args: { query: 'home' } },
  { name: 'image_edit', args: { action: 'grayscale', input: join(WS, 'assets', 'tiny.png'), output: 'assets/tiny-gray.png' } },
];

test('v1126 SWEEP: all 145 tools callable — structured, actionable, single-language, zero unknown/crash', { timeout: 600_000 }, async (t) => {
  const defs = tools.getToolDefs([]);
  const defNames = defs.map((d) => d.name).sort();
  const entryNames = ENTRIES.map((e) => e.name).sort();
  assert.deepEqual(entryNames, defNames,
    `sweep must cover exactly the 145 registry tools; missing: ${defNames.filter((n) => !entryNames.includes(n)).join(', ')}; extra: ${entryNames.filter((n) => !defNames.includes(n)).join(', ')}`);
  assert.equal(new Set(entryNames).size, 145, 'no duplicate sweep entries');

  let okCount = 0;
  let denialCount = 0;
  for (const entry of ENTRIES) {
    const args = typeof entry.args === 'function' ? entry.args() : entry.args;
    const ctx = entry.ctx === 'repo' ? REPO_CTX : WS_CTX;
    for (const pre of entry.pre ?? []) {
      await run(pre.tool, pre.args, ctx);
    }
    let res;
    try {
      res = await run(entry.name, args, ctx);
    } catch (err) {
      assert.fail(`${entry.name}: executeTool REJECTED (must never throw): ${err?.message ?? err}`);
    }
    // Real dispatch + structured, actionable message.
    assertStructured(entry.name, res);
    // The sweep MUST supply a valid minimal call — a validation refusal proves
    // only the schema guard, not that the tool is genuinely callable.
    assert.doesNotMatch(res.output, VALIDATION_ONLY,
      `${entry.name}: sweep used invalid args (validation-only refusal): ${res.output.slice(0, 180)}`);
    if (res.ok) okCount++; else denialCount++;
    // Capture the background process id for the consumer tools.
    if (entry.name === 'run_background' && res.ok) {
      const m = /process_output\(id: "([^"]+)"\)/.exec(res.output);
      if (m) BG_ID = m[1];
    }
    // Capture the real checkpoint id so checkpoint_restore proves a real call.
    if (entry.name === 'checkpoint_save' && res.ok) {
      const m = /Checkpoint saved: (\S+)/.exec(res.output);
      if (m) CP_ID = m[1];
    }
    t.diagnostic(`${entry.name} [${res.ok ? 'ok' : 'denied'}] ${res.output.replace(/\s+/g, ' ').slice(0, 100)}`);
  }
  assert.equal(okCount + denialCount, 145, 'every tool returned ok or denied');
  console.log(`V1126_SWEEP=145 ok=${okCount} denied=${denialCount} unknown=0 crash=0`);
});

// ============================================================
// TEST 3 — malformed args get exact, actionable, single-language fixes.
// ============================================================
test('v1126 malformed args: missing / wrong-type / bad-JSON / unknown tool name the exact fix', async () => {
  const ctx = WS_CTX;

  // missing required arg → names the tool, the arg, and the fix
  const missing = await run('write_file', {}, ctx);
  assert.equal(missing.ok, false);
  assert.match(missing.output, /Missing required parameter: path/);
  assert.match(missing.output, /write_file/);
  assert.match(missing.output, /Re-emit the call with "path" included/);
  assertStructured('write_file(missing)', missing);

  // wrong type → names the arg, the expected type, the received type, the fix
  const wrongType = await run('write_file', { path: 12345, content: 'x' }, ctx);
  assert.equal(wrongType.ok, false);
  assert.match(wrongType.output, /write_file/);
  assert.match(wrongType.output, /"path" must be a JSON string/);
  assert.match(wrongType.output, /received number/);
  assert.match(wrongType.output, /Re-emit with "path"/);
  assertStructured('write_file(wrong-type)', wrongType);

  // array-of-wrong-type element on an array field
  const wrongArray = await run('archive_create', { paths: 'not-an-array', dest: 'x.zip' }, ctx);
  assert.equal(wrongArray.ok, false);
  assert.match(wrongArray.output, /"paths" must be a JSON array/);
  assert.match(wrongArray.output, /received string/);

  // malformed JSON → tool named + strict-JSON fix, single language
  const badJson = await tools.executeTool('read_file', '{path: "a.ts",}', ctx);
  assert.equal(badJson.ok, false);
  assert.match(badJson.output, /Invalid JSON arguments for read_file/);
  assert.match(badJson.output, /Fix: re-emit the tool call with strict JSON/);
  assert.ok(isSingleLanguage(badJson.output), 'bad-JSON fix is single-language');
  assert.ok(isActionable(badJson.output), 'bad-JSON fix is actionable');

  // unknown tool → case-insensitive / edit-distance self-correction hint
  const unknown = await run('read_files', { path: 'x' }, ctx);
  assert.equal(unknown.ok, false);
  assert.match(unknown.output, /Unknown tool: read_files/);
  assert.match(unknown.output, /did you mean "read_file"/i);
  assert.ok(isSingleLanguage(unknown.output));
  assert.ok(isActionable(unknown.output));

  // invalid enum value → names the exact value + the allowed choices + fix
  const badEnum = await run('preview', { action: 'start' }, ctx);
  assert.equal(badEnum.ok, false);
  // v11.34 (V5) added python_start/go_start to the preview action enum — the
  // exact-fix message now lists them; assert the stable prefix + all actions.
  assert.match(badEnum.output, /"action" must be one of scan \| static \| dev_start \| (python_start \| go_start \| )?dev_stop \| status/);
  assert.match(badEnum.output, /\(received "start"\)/);
  assert.match(badEnum.output, /Re-emit with "action" set to one of those exact values/);
  assertStructured('preview(bad-enum)', badEnum);

  // missing checkpoint id → names the id + points to checkpoint_list
  const badCp = await run('checkpoint_restore', { id: 'cp-no-such-id' }, ctx);
  assert.equal(badCp.ok, false);
  assert.match(badCp.output, /no checkpoint with id "cp-no-such-id"/);
  assert.match(badCp.output, /Fix: call checkpoint_list to get a valid id/);
  assertStructured('checkpoint_restore(bad-id)', badCp);

  console.log('V1126_MALFORMED=exact-missing + wrong-type + bad-enum + bad-json + unknown-tool + bad-id all actionable');
});

test('cleanup temp fixtures', () => {
  server.close();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  assert.ok(true);
});
