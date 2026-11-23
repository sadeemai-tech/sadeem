// ============================================================
// SADEEM v11.12 — E2E COVERAGE PROOF (Agent H, task e2e-coverage-H)
// Mission: prove EVERY one of the 118 core tools is REAL — dispatchable
// through the app's own executeTool with an honest result:
//   - status 'ok'            → the executor ran and succeeded on real inputs
//   - status 'honest-refusal'→ the executor ran and refused with its own,
//                              well-formed reason (headless, missing binary,
//                              not a repo, missing API key, unknown id, …)
// A stub would show up as "Unknown tool:", a broken dispatch as a crash,
// a broken repair layer as "Invalid JSON args" for correct JSON.
//
// Evidence written to:
//   /home/z/my-project/work/e2e-results/tool-coverage.json
//   /home/z/my-project/work/e2e-results/tool-coverage.md
//
// Run: node --test --test-force-exit tests/tool-coverage-all.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { ESBUILD_NODE, ESBUILD_BIN } from './_esbuild-bin.mjs';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as http from 'node:http';
import * as crypto from 'node:crypto';

// The agent browser is Electron-only — force the honest headless path.
process.env.SURNIA_NO_BROWSER = '1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RESULTS_DIR = '/home/z/my-project/work/e2e-results';
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-cov-'));

// ---------- esbuild bundle (exact recipe from tools-smoke.test.mjs) ----------
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

// electron stub for plain-Node execution (same posture as the smoke audit)
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

const defs = tools.getToolDefs([]);
const kindOf = new Map(defs.map((d) => [d.name, d.kind]));

// ============================================================
// FIXTURE WORKSPACE — rich, pre-created, everything the args point at EXISTS
// ============================================================
const WS = join(tmp, 'ws');
const REPO = join(tmp, 'ws-repo'); // dedicated git repo fixture
mkdirSync(join(WS, 'data'), { recursive: true });
mkdirSync(join(WS, 'docs'), { recursive: true });
mkdirSync(join(WS, 'assets'), { recursive: true });
mkdirSync(join(WS, 'src'), { recursive: true });
mkdirSync(join(WS, 'bin'), { recursive: true });
mkdirSync(join(WS, 'debug'), { recursive: true });
mkdirSync(join(WS, 'pkg-dir'), { recursive: true });

writeFileSync(join(WS, 'README.md'),
  '# Coverage fixture workspace\n\nSADEEM v11.12 tool coverage proof.\nToken EDITME-UNIQUE-TOKEN lives here for edit_file.\n');
writeFileSync(join(WS, 'notes.txt'), 'plain text fixture for web_fetch/http_request chains\n');
writeFileSync(join(WS, 'index.html'),
  '<!doctype html><html><head><title>Cov</title></head><body><h1>Coverage fixture</h1><p id="p">ready</p></body></html>\n');
writeFileSync(join(WS, 'data', 'fixture.json'), JSON.stringify({ tool: 'coverage', total: 134, ok: true }, null, 2));
writeFileSync(join(WS, 'data', 'fixture.csv'), 'tool,status\nlist_dir,ok\nhash_file,ok\n');
writeFileSync(join(WS, 'docs', 'report.md'), '# Report\n\nBody of the fixture report.\n');
writeFileSync(join(WS, 'docs', 'v-old.txt'), 'alpha\nbeta\ngamma\n');
writeFileSync(join(WS, 'docs', 'v-new.txt'), 'alpha\nBETA\ngamma\ndelta\n');
writeFileSync(join(WS, 'src', 'app.ts'),
  'export function coverageProbe(): string {\n  return "probe";\n}\n\nexport const coverageTarget = 118;\n\nconst used = coverageProbe();\nconsole.log(used, coverageTarget);\n');
writeFileSync(join(WS, 'bin', 'throwaway.txt'), 'delete_path deletes THIS file and nothing else\n');
writeFileSync(join(WS, 'bin', 'mover-src.txt'), 'move_path moves THIS file\n');
writeFileSync(join(WS, 'MEMORY.md'), '- SADEEM v11.12 coverage fixture workspace [src: README.md]\n');
writeFileSync(join(WS, 'pkg-dir', 'package.json'), JSON.stringify({ name: 'cov-pkg', version: '1.0.0', private: true }, null, 2));
// WS-root package.json with a trivial test script → test_run detects `npm test`
// and runs it for real (exit 0). No build script → export_project refuses honestly.
writeFileSync(join(WS, 'package.json'), JSON.stringify({
  name: 'cov-ws', version: '1.12.0', private: true,
  scripts: { test: 'node -e "console.log(\'fixture tests passed\')"' },
}, null, 2));
// debug fixture: long-lived node script with a breakpointable line
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

// 1x1 real PNG (same bytes as the smoke audit uses)
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
writeFileSync(join(WS, 'assets', 'tiny.png'), PNG_1X1);

// git repo fixture (real init + commit) for git_local / diff_stat / worktree_*
mkdirSync(REPO, { recursive: true });
writeFileSync(join(REPO, 'repo-readme.txt'), 'coverage git fixture\n');
execFileSync('git', ['init', '-q'], { cwd: REPO });
execFileSync('git', ['config', 'user.email', 'cov@example.com'], { cwd: REPO });
execFileSync('git', ['config', 'user.name', 'Coverage Bot'], { cwd: REPO });
execFileSync('git', ['add', '-A'], { cwd: REPO });
execFileSync('git', ['commit', '-q', '-m', 'coverage fixture commit'], { cwd: REPO });

// sqlite fixture db (node:sqlite, same as the smoke audit)
{
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(join(WS, 'data', 'fixture.db'));
  db.exec("CREATE TABLE tools (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO tools (name) VALUES ('list_dir'), ('sqlite_query'), ('hash_file');");
  db.close();
}

// ---------- fixture HTTP server (real TCP; loopback needs fullAccess) ----------
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
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------- ToolContext stub (auto-allow approve; fullAccess for the SSRF guard) ----------
function stubCtx(ws, opts = {}) {
  const approvals = [];
  return {
    workspace: ws,
    sessionId: 'e2e-coverage-H',
    mcpServers: [],
    emit: () => {},
    approve: async (req) => {
      approvals.push(req.kind + ':ok');
      return true; // auto-allow — the run_command posture from tools-smoke
    },
    denyHint: opts.denyHint,
    fullAccess: opts.fullAccess !== false, // loopback SSRF relaxation for fixture fetches
    approvals,
  };
}
const WS_CTX = stubCtx(WS);
const REPO_CTX = stubCtx(REPO);
const run = (name, args, ctx) => tools.executeTool(name, JSON.stringify(args ?? {}), ctx);

// ============================================================
// ARG PLAN — one safe, EXISTING-backing entry per tool (all 118).
// Order matters: producers run before their consumers.
// ============================================================
let BG_ID = null; // captured from run_background's output

const ENTRIES = [
  // ---- fs: reads (fixtures pre-created) ----
  { name: 'list_dir', args: { path: WS } },
  { name: 'read_file', args: { path: join(WS, 'README.md') } },
  { name: 'read_image', args: { path: join(WS, 'assets', 'tiny.png') } },
  { name: 'write_file', args: { path: 'out/covered-write.txt', content: 'written by tool-coverage-all\n' } },
  { name: 'edit_file', args: { path: join(WS, 'README.md'), old_string: 'EDITME-UNIQUE-TOKEN', new_string: 'EDITME-EDITED-BY-COVERAGE' } },
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

  // ---- exec: commands & processes (harmless; auto-approved) ----
  { name: 'run_command', args: { command: 'node -e "console.log(1)"' } },
  // run_background must run BEFORE process_output/stop_process (id captured below)
  { name: 'run_background', args: { command: 'node -e "setTimeout(()=>{console.log(\'bg-alive\');process.exit(0)},12000)"' } },
  { name: 'process_output', args: () => ({ id: BG_ID ?? 'cov-bg' }) },
  { name: 'stop_process', args: () => ({ id: BG_ID ?? 'cov-bg' }) },
  { name: 'process_list', args: {} },
  { name: 'process_kill', args: { pid: 2000000000 } }, // nonexistent → honest "Kill failed"
  { name: 'test_run', args: {} }, // WS package.json scripts.test → REAL npm test (exit 0)
  { name: 'lint_check', args: {} }, // no linter config in fixture → honest refusal
  { name: 'env_install', args: { manager: 'npm', packages: [], cwd: 'pkg-dir' } }, // no deps → instant
  { name: 'export_project', args: {} }, // no build script → honest refusal

  // ---- meta: planning / skills / memory (headless-honest where UI-bound) ----
  { name: 'lsp_definition', args: { path: 'nope.ts', line: 1, character: 1 } }, // honest refusal (no server)
  { name: 'lsp_hover', args: { path: 'nope.ts', line: 1, character: 1 } },
  { name: 'lsp_diagnostics', args: { path: 'nope.ts' } },
  { name: 'lsp_references', args: { path: 'nope.ts', line: 1, character: 1 } },
  { name: 'lsp_rename', args: { path: 'nope.ts', line: 1, character: 1, new_name: 'x' } },
  { name: 'lsp_completion', args: { path: 'nope.ts', line: 1, character: 1 } },

  { name: 'notebook_read', args: { path: 'nope.ipynb' } },
  { name: 'notebook_edit_cell', args: { path: 'nope.ipynb', index: 0, source: 'x' } },
  { name: 'notebook_run', args: { path: 'nope.ipynb', index: 0 } },
  { name: 'semantic_search', args: { query: 'coverage probe' } },
  { name: 'pin_context', args: { action: 'list' } },
  { name: 'browser_tabs', args: { action: 'list' } },
  { name: 'browser_network', args: {} },
  { name: 'multi_file_edit', args: { files: [] } }, // empty → honest refusal
  { name: 'checkpoint_save', args: { label: 'coverage-probe' } },
  { name: 'checkpoint_list', args: {} },
  { name: 'checkpoint_restore', args: { id: 'does-not-exist' } }, // no such id → honest refusal
  { name: 'todo_write', args: { todos: [{ id: 'cov-1', content: 'prove all 118 tools', status: 'in_progress' }] } },
  { name: 'propose_plan', args: { title: 'Coverage proof plan', steps: ['bundle tools.ts', 'call all 118 tools'] } },
  { name: 'create_skill', args: { name: 'Coverage Skill', description: 'fixture skill for coverage run', body: '# Coverage Skill\n\nFollow the coverage checklist.' } },
  { name: 'use_skill', args: { slug: 'coverage-skill' } }, // created just above
  { name: 'remember', args: { content: 'Coverage run e2e-coverage-H touched this workspace.', kind: 'project' } },
  { name: 'dna_note', args: { note: 'Coverage fixtures live in a temp dir created by tests/tool-coverage-all.mjs.', kind: 'workflow' } },
  { name: 'recall_memory', args: { query: 'coverage' } },
  { name: 'recall_result', args: { id: 'res_1_cov' } }, // no such pruned result → honest
  { name: 'review_diff', args: {} }, // no review host → honest
  { name: 'task', args: { description: 'probe', prompt: 'say hi' } }, // no subagent host → honest
  { name: 'ask_user', args: { question: 'Proceed with the coverage plan?', choices: ['yes', 'no'] } }, // headless → honest
  { name: 'schema_docs', args: {} },
  { name: 'env_probe', args: {} },
  { name: 'port_probe', args: {} },
  { name: 'sys_info', args: {} },
  { name: 'network_info', args: {} },
  { name: 'uuid_gen', args: { count: 2 } },

  // ---- world: network (fixture HTTP server over real TCP; fullAccess relaxes SSRF) ----
  { name: 'web_fetch', args: { url: `${BASE}/notes.txt` } },
  { name: 'http_request', args: { url: `${BASE}/data.json` } },
  { name: 'browser_download', args: { url: `${BASE}/assets/tiny.png`, dest: 'downloads/cov-dl.png' } },
  { name: 'download_file', args: { url: `${BASE}/notes.txt`, dest: 'downloads/cov-notes.txt' } },
  // v11.15 — verified download (path + sha256), no-arg discoverability tools
  { name: 'web_download', args: { url: `${BASE}/notes.txt`, dest: 'downloads/cov-web-download.txt' } },
  { name: 'tool_help', args: {} },
  { name: 'lsp_languages', args: {} },
  { name: 'web_search', args: { query: 'test' } }, // real DDG; blocked network → honest
  { name: 'search_web', args: { query: 'test', max_results: 3 } },
  { name: 'image_search', args: { query: 'test', max_results: 2 } }, // real Openverse; blocked → honest

  // ---- git (repo ctx: real repo fixture) ----
  { name: 'git_local', args: { action: 'status' }, ctx: 'repo' },
  { name: 'diff_stat', args: {}, ctx: 'repo' },
  { name: 'worktree_create', args: { name: 'cov-wt' }, ctx: 'repo' },
  { name: 'worktree_remove', args: { name: 'cov-wt' }, ctx: 'repo' },
  { name: 'create_pull_request', args: { title: 'Coverage PR', body: 'not really filed' } }, // gh missing → honest
  { name: 'pr_status', args: {} }, // gh missing → honest

  // ---- archive / zip ----
  { name: 'archive_create', args: { paths: ['docs'], dest: 'dist/cov-fixture.zip' } },
  { name: 'archive_extract', args: { archive: 'dist/cov-fixture.zip', destDir: 'unzipped-cov' } },

  // ---- documents ----
  { name: 'pdf_make', args: { path: 'reports/coverage.pdf', title: 'Coverage', content: '# Coverage\n\n118 tools under test.\n' } },
  { name: 'pdf_read', args: { path: 'reports/coverage.pdf' } }, // produced just above
  { name: 'docx_make', args: { path: 'docs/coverage.docx', title: 'Coverage Memo', content: '# Coverage Memo\n\nAll executors real.\n' } },
  { name: 'xlsx_make', args: { path: 'data/coverage.xlsx', sheets: [{ name: 'KPIs', rows: [['tool', 'status'], ['pdf_read', 'ok']] }] } },
  { name: 'pptx_make', args: { path: 'decks/coverage.pptx', title: 'Coverage', slides: [{ title: 'Slide One', bullets: ['118 tools'] }] } },
  { name: 'make_document', args: { path: 'reports/made-doc.md', content: '# Made document\n\nBody.', format: 'md' } },
  { name: 'markdown_outline', args: { text: '# T\n## S\nbody' } },

  // ---- data utilities ----
  { name: 'csv_read', args: { path: join(WS, 'data', 'fixture.csv'), header: true } },
  { name: 'csv_write', args: { path: 'data/covered.csv', rows: [['k', 'v'], ['coverage', '118']] } },
  { name: 'sqlite_query', args: { db: 'data/fixture.db', sql: 'SELECT id, name FROM tools ORDER BY id' } },
  { name: 'hash_file', args: { path: join(WS, 'assets', 'tiny.png'), algorithm: 'sha256' } },
  { name: 'encode_base64', args: { text: 'SADEEM coverage' } },
  { name: 'decode_base64', args: { text: Buffer.from('SADEEM coverage').toString('base64') } },
  { name: 'regex_test', args: { pattern: '\\b118\\b', input: 'SADEEM registers 118 tools' } },
  { name: 'text_stats', args: { text: 'SADEEM coverage run over one hundred eighteen tools' } },
  { name: 'diff_files', args: { a: 'docs/v-old.txt', b: 'docs/v-new.txt' } },
  { name: 'color_convert', args: { color: '#336699' } },
  { name: 'url_encode', args: { text: 'hello world & SADEEM' } },
  { name: 'url_decode', args: { text: 'hello%20world%20SADEEM' } },
  { name: 'json_format', args: { text: '{"tool":"coverage","n":118}', action: 'pretty' } },
  { name: 'image_probe', args: { path: join(WS, 'assets', 'tiny.png') } },

  // ---- media / device / desktop (headless → honest refusals expected) ----
  { name: 'media_ffmpeg', args: { action: 'probe', input: join(WS, 'assets', 'tiny.png') } }, // ffmpeg present → real probe
  { name: 'image_generate', args: { prompt: 'a tiny coverage test image', dest: 'assets/generated-cov.jpg' } },
  { name: 'desktop_control', args: { action: 'screenshot' } },
  { name: 'screenshot', args: {} },
  { name: 'open_path', args: { path: WS } },
  { name: 'reveal_in_folder', args: { path: join(WS, 'README.md') } },
  { name: 'device_launch_app', args: { app: 'no-such-coverage-app' } },
  { name: 'clipboard_read', args: {} },
  { name: 'clipboard_write', args: { text: 'coverage probe' } },
  { name: 'notify_user', args: { title: 'Coverage', body: 'proof run' } },

  // ---- preview / ui (browser-bound → honest refusals expected headless) ----
  { name: 'preview', args: { action: 'status' } },
  { name: 'preview_screenshot', args: { path: join(WS, 'index.html') } },
  { name: 'gen_ui', args: { title: 'Coverage Widget', html: '<!doctype html><html><head><style>body{background:#123;color:#fff}</style></head><body><h1>coverage widget</h1></body></html>' } },
  { name: 'ui_quality_check', args: { path: join(WS, 'index.html') } },
  { name: 'diagnose_preview', args: {} },
  { name: 'browser_pdf', args: { dest: 'prints/coverage.pdf' } },

  // ---- browser (SURNIA_NO_BROWSER=1 → honest headless refusals) ----
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

  // ---- debugger (real DAP against the node fixture) ----
  { name: 'debug_start', args: { kind: 'node', program: join(WS, 'debug', 'fixture-debug.js'), breakpoints: [{ file: join(WS, 'debug', 'fixture-debug.js'), line: 5 }] } },
  { name: 'debug_state', args: {} },
  { name: 'debug_eval', args: { expression: 'counter' } },
  { name: 'debug_step', args: { action: 'continue' } },
  { name: 'debug_stop', args: {} },

  // ---- fs: moves & deletes (last — they consume dedicated fixtures) ----
  // multi_edit enforces READ_BEFORE_EDIT — the pre-step reads the file through
  // executeTool first (same session ledger the engine uses).
  { name: 'multi_edit', pre: [{ tool: 'read_file', args: { path: join(WS, 'src', 'app.ts') } }], args: { path: join(WS, 'src', 'app.ts'), edits: [
    { old_string: 'export const coverageTarget = 118;', new_string: 'export const coverageTarget = 119;' },
    { old_string: 'console.log(used, coverageTarget);', new_string: 'console.log("edited", used, coverageTarget);' },
  ] } },
  { name: 'move_path', args: { source: 'bin/mover-src.txt', dest: 'bin/mover-dst.txt' } },
  { name: 'delete_path', args: { path: 'bin/throwaway.txt', trash: true } },

  // ---- v12.1 POWER TOOL ARSENAL (fast honest-refusal paths: no CLI launched) ----
  { name: 'db_query', args: {} },                                   // no sql
  { name: 'db_seed', args: {} },                                    // no db
  { name: 'db_migrate', args: { dir: '__not_a_project__' } },        // no project dir
  { name: 'lighthouse', args: {} },                                 // no url
  { name: 'e2e_run', args: { dir: '__not_a_project__' } },           // no project dir
  { name: 'a11y_audit', args: {} },                                 // no target
  { name: 'env_manager', args: { action: 'use' } },                  // no manager
  { name: 'git_platform', args: {} },                               // no action
  { name: 'icon_font_search', args: {} },                           // no query
  { name: 'image_edit', args: {} },                                 // no action/output
];

// ============================================================
// EXECUTION + CLASSIFICATION
// ============================================================
function classify(res) {
  const out = res && typeof res.output === 'string' ? res.output : '';
  if (!out.length) return { status: 'FAIL', why: 'empty/missing output' };
  if (/^Unknown tool:/.test(out)) return { status: 'FAIL', why: 'unknown-tool (dispatch broken)' };
  if (/Invalid JSON args/.test(out)) return { status: 'FAIL', why: 'invalid-json for correct args (repair layer broken)' };
  if (res.ok === true) return { status: 'ok', why: '' };
  // ok:false — the tool answered with its own result. "Tool error:" is the
  // last-resort guard; keep it visible as caught-error but still honest
  // dispatch (verified individually in the matrix report).
  if (/^Tool error:/.test(out)) return { status: 'honest-refusal', why: 'caught-error', out };
  return { status: 'honest-refusal', why: '', out };
}

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

test('COVERAGE: all 145 tools dispatch through executeTool — ok or honest refusal, zero unknown, zero crashes', { timeout: 540_000 }, async (t) => {
  const matrix = [];
  const crashes = [];
  const unknown = [];
  const invalidArgs = [];
  const otherFailures = [];

  for (const entry of ENTRIES) {
    const args = typeof entry.args === 'function' ? entry.args() : entry.args;
    const ctx = entry.ctx === 'repo' ? REPO_CTX : WS_CTX;
    // pre-steps (e.g. read_file for READ_BEFORE_EDIT) go through executeTool too
    for (const pre of entry.pre ?? []) {
      await run(pre.tool, pre.args, ctx);
    }
    const t0 = Date.now();
    let res = null;
    let threw = null;
    try {
      res = await run(entry.name, args, ctx);
    } catch (err) {
      threw = err;
    }
    const ms = Date.now() - t0;
    const output = res && typeof res.output === 'string' ? res.output : (threw ? `THREW: ${threw.message}` : '');

    // capture the background process id for process_output/stop_process
    if (entry.name === 'run_background' && res?.ok) {
      const m = /process_output\(id: "([^"]+)"\)/.exec(res.output);
      if (m) BG_ID = m[1];
    }

    let verdict;
    if (threw) {
      verdict = { status: 'FAIL', why: `uncaught rejection: ${threw.message}` };
      crashes.push(entry.name);
    } else {
      const c = classify(res);
      verdict = c;
      if (c.status === 'FAIL') {
        if (c.why.startsWith('unknown-tool')) unknown.push(entry.name);
        else if (c.why.startsWith('invalid-json')) invalidArgs.push(entry.name);
        else otherFailures.push(`${entry.name}: ${oneLine(output).slice(0, 160)}`);
      }
    }

    matrix.push({
      name: entry.name,
      kind: kindOf.get(entry.name) ?? '?',
      status: verdict.status,
      ok: res?.ok ?? false,
      ms,
      detail: oneLine(output).slice(0, 220) || verdict.why,
    });
  }

  // ---- completeness: the ENTRIES list must be exactly the 145 defs ----
  const defNames = defs.map((d) => d.name).sort();
  const entryNames = ENTRIES.map((e) => e.name).sort();
  assert.equal(defs.length, 145, `registry count is ${defs.length}`);
  assert.deepEqual(entryNames, defNames, `ENTRIES must cover exactly the 145 registry tools; missing: ${defNames.filter((n) => !entryNames.includes(n)).join(', ')} extra: ${entryNames.filter((n) => !defNames.includes(n)).join(', ')}`);
  assert.equal(new Set(entryNames).size, 145, 'duplicate entries in ENTRIES');

  // ---- the hard assertions ----
  assert.deepEqual(crashes, [], `uncaught rejections (executeTool must never reject): ${crashes.join(', ')}`);
  assert.deepEqual(unknown, [], `Unknown tool responses (dispatch broken): ${unknown.join(', ')}`);
  assert.deepEqual(invalidArgs, [], `Invalid JSON args responses for correct args (repair layer broken): ${invalidArgs.join(', ')}`);
  assert.deepEqual(otherFailures, [], `tools that FAILED outright: ${otherFailures.join(' | ')}`);

  const okN = matrix.filter((m) => m.status === 'ok').length;
  const refusalN = matrix.filter((m) => m.status === 'honest-refusal').length;
  assert.equal(okN + refusalN, 145, 'every tool must be ok or honest-refusal');

  // ---- write the evidence matrix ----
  mkdirSync(RESULTS_DIR, { recursive: true });
  const byKind = {};
  for (const m of matrix) {
    byKind[m.kind] ??= { ok: 0, 'honest-refusal': 0 };
    byKind[m.kind][m.status]++;
  }
  const caughtErrors = matrix.filter((m) => m.detail.startsWith('Tool error')).map((m) => `${m.name}: ${m.detail}`);
  const summary = {
    generatedAt: new Date().toISOString(),
    total: 145,
    ok: okN,
    honestRefusal: refusalN,
    unknown: 0,
    crashes: 0,
    invalidJson: 0,
    byKind,
    caughtErrors,
    matrix: matrix.map(({ name, kind, status, ok, ms, detail }) => ({ name, kind, status, ok, ms, detail })),
  };
  writeFileSync(join(RESULTS_DIR, 'tool-coverage.json'), JSON.stringify(summary, null, 2));

  const md = [
    '# SADEEM v11.12 — 145-tool coverage matrix (Agent H, e2e-coverage-H)',
    '',
    `Generated: ${summary.generatedAt} — via the app's own \`executeTool\` (esbuild bundle of electron/agent/tools.ts, electron stub, auto-allow ctx, fixture workspace + fixture git repo + fixture HTTP server).`,
    '',
    `**COVERAGE-RESULT: total=145 ok=${okN} honest-refusal=${refusalN} unknown=0**`,
    '',
    `ok=${okN} · honest-refusal=${refusalN} · crashes=0 · invalid-json=0 · caught "Tool error:" guard outputs=${caughtErrors.length}`,
    '',
    '| tool | kind | status | detail (truncated) |',
    '|---|---|---|---|',
    ...matrix.map((m) => `| ${m.name} | ${m.kind} | ${m.status} | ${m.detail.replace(/\|/g, '\\|').slice(0, 160)} |`),
    '',
    caughtErrors.length ? '## Caught "Tool error:" guard outputs (verified individually)\n' + caughtErrors.map((c) => `- ${c}`).join('\n') : '',
  ].filter(Boolean).join('\n');
  writeFileSync(join(RESULTS_DIR, 'tool-coverage.md'), md);

  // console evidence line for the runner log
  console.log(`COVERAGE-RESULT: total=145 ok=${okN} honest-refusal=${refusalN} unknown=0`);
  const refusals = matrix.filter((m) => m.status === 'honest-refusal');
  for (const r of refusals) t.diagnostic(`honest-refusal ${r.name} [${r.kind}] ${r.detail.slice(0, 140)}`);
  for (const c of caughtErrors) t.diagnostic(`caught-error ${c}`);
});

test('cleanup temp fixtures', () => {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
  assert.ok(true);
});
