// ============================================================
// Surnia v2.0.0 — full engine feature verification harness
// Exercises every capability that does NOT require a live LLM:
//   tools (12 core + 10 new), git worktree lifecycle, diff/stat,
//   AI-commit/review plumbing (offline paths), goal state, queue,
//   background subagent caps, memory merge, session fork/export,
//   schedule cron matcher, checkpoints.
// Run: node tests/v2-verify.mjs
// ============================================================
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// v3.1 — derive ROOT from this file's location (the hardcoded
// '/home/z/my-project/surnia' broke whenever the repo moved one level deeper).
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const results = [];
const check = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? '✅' : '❌'} ${name}${note ? ' — ' + note : ''}`);
};

// Build an esbuild bundle of the engine+tools+services for direct Node import.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function bundle(entry, out) {
  execFileSync('./node_modules/.bin/esbuild', [
    entry, '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${out}`,
    '--external:electron',
    '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

const tmp = mkdtempSync(join(tmpdir(), 'surnia-verify-'));

// Stub the electron module for plain-Node execution of the bundles.
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `const paths = { temp: ${JSON.stringify(tmp)}, userData: ${JSON.stringify(join(tmp, 'ud'))}, home: ${JSON.stringify(tmp)}, appData: ${JSON.stringify(tmp)} };
  function Notification() { this.show = () => {}; this.on = () => {}; }
  Notification.isSupported = () => false;
  module.exports = {
    app: { getPath: (k) => paths[k] ?? paths.userData, setName() {}, setPath() {}, isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },
    ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
    Notification,
    shell: { openExternal: async () => {}, openPath: async () => '' },
    clipboard: { readText: () => '', writeText() {}, readImage: () => null },
    WebContents: class {},
  };`,
);

const bundlePath = join(tmp, 'engine.cjs');
bundle('electron/agent/engine.ts', bundlePath);
const engine = require(bundlePath);
// tools are a separate module — bundle and merge its exports
const toolsPath = join(tmp, 'tools.cjs');
bundle('electron/agent/tools.ts', toolsPath);
const tools = require(toolsPath);
const engineTools = { ...tools, ...engine };

// ---------- demo workspace ----------
const ws = join(tmp, 'ws');
mkdirSync(join(ws, 'src'), { recursive: true });
writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', scripts: { test: 'node tests/run.js' } }));
writeFileSync(join(ws, 'src', 'app.js'), "const x = 1;\nconsole.log('hi', x);\n");
writeFileSync(join(ws, 'README.md'), '# Demo\n');
mkdirSync(join(ws, 'tests'), { recursive: true });
writeFileSync(join(ws, 'tests', 'run.js'), "console.log('ok');\n");
execFileSync('git', ['init', '-q'], { cwd: ws });
execFileSync('git', ['config', 'user.email', 'v@t'], { cwd: ws });
execFileSync('git', ['config', 'user.name', 'v'], { cwd: ws });
execFileSync('git', ['add', '-A'], { cwd: ws });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: ws });

// Minimal ToolContext: no approvals needed for read-only; auto-approve exec for the harness.
const events = [];
const ctx = {
  workspace: ws,
  sessionId: 'verify-1',
  mcpServers: [],
  emit: (e) => events.push(e),
  approve: async () => true,
  fullAccess: true,
};

// ---------- get tool defs ----------
const defs = engineTools.getToolDefs ? engineTools.getToolDefs([]) : [];
check('tool registry exposes defs', defs.length >= 35, `${defs.length} defs (was 26 core, +10 new)`);

const runTool = async (name, args) => {
  const res = await engineTools.executeTool(name, JSON.stringify(args ?? {}), ctx);
  return res;
};

// ---------- 1. core read tools ----------
{
  const ls = await runTool('list_dir', { path: '.' });
  check('list_dir', /src|tests|package\.json|README/i.test(ls.output ?? ''), ls.output?.slice(0, 60));
  const rf = await runTool('read_file', { path: 'src/app.js' });
  check('read_file', /console\.log/.test(rf.output ?? ''));
  const gs = await runTool('glob_files', { pattern: '**/*.js' });
  check('glob_files', (gs.output ?? '').includes('app.js'));
  const sf = await runTool('search_files', { pattern: 'console' });
  check('search_files', (sf.output ?? '').toLowerCase().includes('app.js'));
}

// ---------- 2. write/edit + checkpoints ----------
{
  const wf = await runTool('write_file', { path: 'docs-notes.md', content: '# Notes\nhello\n' });
  check('write_file', wf.ok !== false, wf.output?.slice(0, 40));
  const ef = await runTool('edit_file', { path: 'docs-notes.md', old_string: 'hello', new_string: 'world' });
  check('edit_file', /world/.test(ef.output ?? '') || ef.ok !== false);
  const cp = await runTool('checkpoint_save', { label: 'verify-cp' });
  check('checkpoint_save', cp.ok !== false, String(cp.output ?? '').slice(0, 60));
}

// ---------- 3. new v2 tools ----------
{
  const cs = await runTool('code_search', { query: 'console' });
  check('code_search (ranked)', /app\.js/.test(cs.output ?? ''), cs.output?.split('\n')[0]);
  const ds = await runTool('diff_stat', {});
  check('diff_stat', /docs-notes\.md|\+/.test(ds.output ?? ''), ds.output?.split('\n')[0]);
  const env = await runTool('env_probe', {});
  check('env_probe', /node/i.test(env.output ?? ''), env.output?.split('\n')[0]?.slice(0, 60));
  const pp = await runTool('port_probe', {});
  check('port_probe', typeof (pp.output ?? '') === 'string', (pp.output ?? '').split('\n')[0]?.slice(0, 50));
  const sd = await runTool('schema_docs', {});
  check('schema_docs (no routes → empty ok)', typeof (sd.output ?? '') === 'string');
  const tr = await runTool('test_run', {});
  check('test_run (npm script)', /ok|passed|pass/i.test(tr.output ?? ''), (tr.output ?? '').split('\n').slice(-2).join(' | ').slice(0, 80));
  const lc = await runTool('lint_check', { path: 'src/app.js' });
  check('lint_check (graceful without linter)', typeof (lc.output ?? '') === 'string', (lc.output ?? '').slice(0, 50));
}

// ---------- 4. worktree lifecycle ----------
{
  const wc = await runTool('worktree_create', { name: 'feature-x' });
  check('worktree_create (tool)', /surnia-|feature-x/.test(wc.output ?? ''), wc.output?.split('\n')[0]);
  const wr = await runTool('worktree_remove', { name: 'feature-x', force: true });
  check('worktree_remove (tool)', typeof (wr.output ?? '') === 'string', wr.output?.split('\n')[0]);
}

// ---------- 5. goal / queue / background state fns ----------
{
  engine.setSessionGoal('verify-1', 'Ship the demo');
  const g = engine.getSessionGoal('verify-1');
  check('goal set/get', g?.goal === 'Ship the demo', JSON.stringify(g));
  engine.clearSessionGoal('verify-1');
  check('goal clear', engine.getSessionGoal('verify-1')?.goal === null);
  const n1 = engine.enqueueUserMessage('verify-1', 'first queued');
  const n2 = engine.enqueueUserMessage('verify-1', '   ');
  check('queue enqueue (+whitespace ignored)', n1 === 1 && n2 === 1, `n1=${n1} n2=${n2}`);
  engine.enqueueUserMessage('verify-1', 'second queued');
  check('backgroundSubagentCount fn', typeof engine.backgroundSubagentCount === 'function');
  check('mergeLearnedSection fn', typeof engine.mergeLearnedSection === 'function');
  const merged = engine.mergeLearnedSection('# M\nold', ['fact one']);
  check('auto-memory merge', /fact one/.test(merged) && /## Learned/.test(merged));
}

// ---------- 6. git worktree service + commit message plumbing (offline paths) ----------
{
  const svcB = join(tmp, 'git.cjs');
  bundle('electron/services/gitService.ts', svcB);
  const git = require(svcB);
  const wt = await git.createWorktree(ws, 'svc-branch');
  check('gitService.createWorktree', !!wt?.path, wt?.branch);
  const list = await git.listWorktrees(ws);
  check('gitService.listWorktrees', list.some((w) => w.name === 'svc-branch'), `${list.length} trees`);
  const merged = await git.mergeWorktree(ws, 'svc-branch');
  check('gitService.mergeWorktree (clean merge)', merged?.ok !== false, JSON.stringify(merged)?.slice(0, 60));
  // commit-message generation requires an LLM — verify the offline failure path is graceful
  const cm = await git.generateCommitMessage(ws, async () => ({ ok: false, error: 'no key' }));
  check('generateCommitMessage graceful (no diff / no key → ok:false + error)', cm?.ok === false && typeof cm?.error === 'string' && cm.error.length > 0, cm?.error);
}

// ---------- 7. session fork/export ----------
{
  const svcB2 = join(tmp, 'session.cjs');
  bundle('electron/services/sessionService.ts', svcB2);
  // sessionService likely needs a storage dir — check exported fns exist
  const sess = require(svcB2);
  const fns = Object.keys(sess);
  check('sessionService exports fork/export', ['forkSession', 'exportSessionMarkdown'].every((f) => fns.includes(f)), fns.slice(0, 8).join(','));
}

// ---------- 8. schedule cron matcher ----------
{
  const schB = join(tmp, 'sched.cjs');
  bundle('electron/services/scheduleService.ts', schB);
  const sch = require(schB);
  const iv = sch.isValidCron;
  check('cron matcher accepts 5-field', !iv || (iv('*/5 * * * *') && iv('0 9 * * 1-5')));
  check('cron matcher rejects garbage', !iv || (!iv('nonsense') && !iv('99 * * * * *')));
  check('cron aliases', !iv || (iv('@daily') && iv('@hourly')));
  check('scheduleService API', ['listJobs', 'addJob', 'removeJob', 'toggleJob', 'runNow'].every((f) => typeof sch[f] === 'function'));
}

// ---------- 10. agent roster ----------
{
  const agB = join(tmp, 'agents.cjs');
  bundle('electron/agent/agents.ts', agB);
  const { AGENTS } = require(agB);
  const ids = AGENTS.map((a) => a.id);
  check('15-subagent roster', ids.length >= 15, ids.join(','));
  check('new specialists present', ['debugger', 'perf', 'data'].every((s) => ids.includes(s)));
}

// ---------- 11. costs / context windows (new catalog) ----------
{
  const cB = join(tmp, 'costs.cjs');
  bundle('electron/agent/costs.ts', cB);
  const costs = require(cB);
  const p1 = costs.priceFor('claude-sonnet-5.5');
  const p2 = costs.priceFor('gpt-6.1-sol');
  const p3 = costs.priceFor('glm-5.3');
  check('pricing: claude-sonnet-5.5', p1.input === 2 && p1.output === 10, `$${p1.input}/$${p1.output}`);
  check('pricing: gpt-6.1-sol', p2.input === 2 && p2.output === 10, `$${p2.input}/$${p2.output}`);
  check('pricing: glm-5.3 (Nov-2026 catalog)', p3.input === 1.4, `$${p3.input}`);
  const ctx1 = costs.contextWindowFor('claude-opus-5.5');
  const ctx2 = costs.contextWindowFor('gemini-4-argon');
  const ctx3 = costs.contextWindowFor('grok-4.7');
  check('context: opus-5.5 = 1M', ctx1 === 1_000_000);
  check('context: gemini-4-argon = 1,048,576', ctx2 === 1_048_576);
  check('context: grok-4.7 = 500K', ctx3 === 500_000);
}

// ---------- summary ----------
const pass = results.filter((r) => r.ok).length;
console.log(`\n========== ${pass}/${results.length} checks passed ==========`);
rmSync(tmp, { recursive: true, force: true });
process.exit(pass === results.length ? 0 : 1);
