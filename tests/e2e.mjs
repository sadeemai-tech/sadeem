// ============================================================
// Kodex E2E — REAL end-to-end test of the REAL agent engine.
// Runs the actual engine (same code path as the desktop app)
// against a real GLM model through a local OpenAI-compatible
// bridge, on real tasks, in a real workspace.
//
//   TEST 1  bugfix      : agent must fix calc.js so tests pass
//   TEST 2  plan mode   : agent must plan WITHOUT touching files
//   TEST 3  subagents   : specialist 'explore' agent is used
// ============================================================
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { startBridge } from './glm-bridge.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const ONLY = process.argv[2] ? process.argv[2].split(',').map(Number) : null;
const want = (n) => !ONLY || ONLY.includes(n);
const WORK = fs.mkdtempSync('/tmp/kodex-e2e-');
const startedAt = Date.now();

// ---------- tiny real project with a real bug ----------
const CALC = `// Simple calc module
function add(a, b) {
  return a - b; // BUG: wrong operator
}
function mul(a, b) {
  return a * b;
}
module.exports = { add, mul };
`;
const TEST = `const { test } = require('node:test');
const assert = require('node:assert');
const { add, mul } = require('./calc.js');

test('add', () => assert.equal(add(2, 3), 5));
test('mul', () => assert.equal(mul(2, 3), 6));
`;
const PKG = JSON.stringify({ name: 'e2e-fixture', version: '1.0.0', scripts: { test: 'node --test' } }, null, 2) + '\n';
fs.writeFileSync(path.join(WORK, 'calc.js'), CALC);
fs.writeFileSync(path.join(WORK, 'calc.test.js'), TEST);
fs.writeFileSync(path.join(WORK, 'package.json'), PKG);

// sanity: the fixture really fails before the agent runs
if (want(1)) {
  const pre = await shell('node --test', WORK);
  assert.notEqual(pre.code, 0, 'fixture must fail before the agent');
  console.log('fixture verified: tests FAIL before agent (as intended)');
}

// ---------- engine loader (compiled CLI bundle = real engine) ----------
const { execFileSync } = await import('node:child_process');
execFileSync('npx', ['esbuild', 'electron/agent/cli.ts', '--bundle', '--platform=node', '--format=cjs',
  '--outfile=dist-cli/kodex.cjs', '--external:electron'], { cwd: ROOT, stdio: 'pipe' });
const { runCLI } = await import('./cli-driver.mjs');

// ---------- bridge ----------
const port = await startBridge(0);
console.log(`glm bridge listening on 127.0.0.1:${port}\n`);

function run(task, opts = {}) {
  return runCLI({
    root: ROOT,
    task,
    mode: opts.mode ?? 'fullAccess',
    workspace: opts.workspace ?? WORK,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: 'bridge-local',
    model: 'glm-4.6',
    timeoutMs: opts.timeoutMs ?? 420_000,
  });
}

let pass = 0, fail = 0;
function report(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ================= TEST 1: real bugfix =================
console.log('── TEST 1: real bugfix (fullAccess) ──');
if (want(1)) {
  const r = await run(
    'The test suite in this project fails. Find the bug, fix it, and run the tests to prove they pass. Be brief.',
  );
  const after = fs.readFileSync(path.join(WORK, 'calc.js'), 'utf8');
  const post = await shell('node --test', WORK);
  report('engine exited 0', r.code === 0, `exit=${r.code}${r.code !== 0 ? ' · ' + r.stderr.slice(0, 200) : ''}`);
  report('calc.js actually fixed (no a - b left)', /return a \+ b/.test(after) && !/return a - b/.test(after));
  report('tests actually pass now', post.code === 0, post.stdout.split('\n').filter(l => /pass|fail/.test(l)).join(' | ').slice(0, 120));
  report('agent used tools (real loop)', /▸ (run_command|read_file|edit_file|write_file)/.test(r.stdout));
}

// ================= TEST 2: plan mode is read-only =================
console.log('\n── TEST 2: plan mode (must NOT modify anything) ──');
if (want(2)) {
  const snap = () => Object.fromEntries(fs.readdirSync(WORK).filter((f) => !f.startsWith('node_modules'))
    .map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(WORK, f))).digest('hex')]));
  const before = snap();
  const r = await run(
    'Plan how to add a divide(a,b) function with zero-division error handling. Do not implement — plan only.',
    { mode: 'plan' },
  );
  const after = snap();
  const changed = Object.keys(before).filter((f) => before[f] !== after[f]).concat(
    Object.keys(after).filter((f) => !(f in before)));
  report('engine exited 0', r.code === 0, `exit=${r.code}${r.code !== 0 ? ' · ' + r.stderr.slice(0, 200) : ''}`);
  report('workspace untouched in plan mode', changed.length === 0, changed.length ? 'changed: ' + changed.join(', ') : '');
  report('produced a plan (not code)', r.stdout.length > 200 && /step|step-\s*[1-9]|plan/i.test(r.stdout));
}

// ================= TEST 3: specialist subagent =================
console.log('\n── TEST 3: specialist subagent (explore) ──');
if (want(3)) {
  const r = await run(
    'Delegate to the "explore" specialist agent (via the task tool) to map this project, then report its one-line summary.',
  );
  report('engine exited 0', r.code === 0, `exit=${r.code}${r.code !== 0 ? ' · ' + r.stderr.slice(0, 200) : ''}`);
  report('task tool invoked', /▸ task/.test(r.stdout));
  report('subagent identified itself', /\[Codebase Explorer\]/.test(r.stdout) || /Codebase Explorer/.test(r.stdout) || /explore/.test(r.stdout));
}

console.log(`\n══════ E2E RESULT: ${pass} passed, ${fail} failed · ${((Date.now() - startedAt) / 1000).toFixed(0)}s · workspace: ${WORK} ══════`);
process.exit(fail ? 1 : 0);

// ---------- helper: shell ----------
async function shell(cmd, cwd) {
  const { exec } = await import('node:child_process');
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: 30_000 }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr }));
  });
}
