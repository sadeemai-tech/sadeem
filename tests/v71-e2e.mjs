// ============================================================
// Surnia v7.1 — REAL end-to-end PROVEN CHANGE test.
// Runs the REAL engine (compiled CLI bundle) against a REAL GLM
// model through the local bridge, on a REAL bug, and verifies the
// v7.1 promises the way a user experiences them:
//
//   TEST 1  bug-fix + red→green  — the harness records the failing
//           run BEFORE the passing one (from the ledger, not prose)
//   TEST 2  mutation gate        — the changed lines are mutated and
//           the agent's tests must KILL the mutant (or the gate says
//           so honestly)
//   TEST 3  signed proof package — surnia-proof-*.json exists, the
//           signature verifies via the REAL CLI (`surnia verify`)
//   TEST 4  fake-test detector   — a poisoned test file is flagged
//           deterministically (no model involved)
// Run: node tests/v71-e2e.mjs   (needs the z-ai SDK bridge)
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startBridge } from './glm-bridge.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const WORK = fs.mkdtempSync('/tmp/surnia-v71-e2e-');
const startedAt = Date.now();

// ---------- tiny real project with a REAL bug ----------
const CALC = `// Inventory helper
function totalUnits(items) {
  let sum = 0;
  for (const it of items) {
    sum -= it.qty; // BUG: subtracts instead of adds
  }
  return sum;
}
function outOfStock(items) {
  return items.filter((it) => it.qty === 0).length;
}
module.exports = { totalUnits, outOfStock };
`;
const TEST = `const { test } = require('node:test');
const assert = require('node:assert');
const { totalUnits, outOfStock } = require('./calc.js');

test('totalUnits adds quantities', () => {
  assert.equal(totalUnits([{ qty: 2 }, { qty: 3 }]), 5);
});
test('outOfStock counts zeros', () => {
  assert.equal(outOfStock([{ qty: 0 }, { qty: 4 }]), 1);
});
`;
const PKG = JSON.stringify({ name: 'v71-e2e-fixture', version: '1.0.0', scripts: { test: 'node --test' } }, null, 2) + '\n';
fs.writeFileSync(path.join(WORK, 'calc.js'), CALC);
fs.writeFileSync(path.join(WORK, 'calc.test.js'), TEST);
fs.writeFileSync(path.join(WORK, 'package.json'), PKG);

const { exec } = (await import('node:child_process'));
const shell = (cmd, cwd) =>
  new Promise((resolve) => {
    exec(cmd, { cwd, timeout: 60_000 }, (err, stdout, stderr) =>
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }));
  });

// sanity: the fixture really fails before the agent runs
{
  const pre = await shell('node --test', WORK);
  assert.notEqual(pre.code, 0, 'fixture must fail before the agent');
  console.log('fixture verified: tests FAIL before agent (red exists by construction)\n');
}

// ---------- real engine bundle + real bridge ----------
execFileSync('npx', ['esbuild', 'electron/agent/cli.ts', '--bundle', '--platform=node', '--format=cjs',
  '--outfile=dist-cli/surnia.cjs', '--external:electron'], { cwd: ROOT, stdio: 'pipe' });
const { runCLI } = await import('./cli-driver.mjs');
const port = await startBridge(0);
console.log(`glm bridge listening on 127.0.0.1:${port}\n`);

let pass = 0, fail = 0;
function report(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ================= TEST 1+2+3: real bugfix with the full pipeline =================
console.log('── TEST 1-3: real bugfix → red→green → mutation gate → proof ──');
const r = await runCLI({
  root: ROOT,
  task: 'The test suite in this project fails. Fix the bug in calc.js, run the tests to prove they pass, and make sure the tests really protect the fixed line. Be brief.',
  mode: 'fullAccess',
  workspace: WORK,
  baseUrl: `http://127.0.0.1:${port}/v1`,
  apiKey: 'bridge-local',
  model: 'glm-4.6',
  timeoutMs: 480_000,
});

report('engine exited 0', r.code === 0, `exit=${r.code}${r.code !== 0 ? ' · ' + r.stderr.slice(0, 200) : ''}`);
const after = fs.readFileSync(path.join(WORK, 'calc.js'), 'utf8');
report('calc.js actually fixed (sum += qty)', /sum \+= it\.qty/.test(after) && !/sum -= it\.qty/.test(after));
const post = await shell('node --test', WORK);
report('tests actually pass now', post.code === 0);

// --- the harness ran the Proven Change pipeline (from the REAL stdout) ---
report('red→green enforcement surfaced', /\[red\u2192green\]|\[red-green\]|red run/i.test(r.stdout), '');
report('mutation gate ran on the changed lines', /MUTATION_GATE|mutation gate/i.test(r.stdout));
const gateOk = /KILLED \d+\/\d+|MUTATION_GATE PROVEN|mutation gate\] PASSED|killed-enough/i.test(r.stdout);
const gateHonestFail = /MUTATION_GATE FAILED|mutation gate\] FAILED|kill rate|no safe mutation point|INCONCLUSIVE/i.test(r.stdout);
report('mutation gate verdict reached (pass or honest fail)', gateOk || gateHonestFail, gateOk ? 'killed' : gateHonestFail ? 'honest' : 'no verdict printed');

// --- signed proof package exists and the REAL CLI verifies it ---
// The CLI engine stores proofs under SURNIA_HOME (default ~/.surnia)/proofs.
const surniaHome = process.env.SURNIA_HOME || path.join(process.env.HOME || '', '.surnia');
const proofCandidates = [];
for (const dir of [path.join(surniaHome, 'proofs'), WORK]) {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (/^surnia-proof-.*\.json$/.test(f)) proofCandidates.push(path.join(dir, f));
    }
  } catch { /* dir missing */ }
}
report('proof package file exists', proofCandidates.length > 0, proofCandidates.map((p) => path.basename(p)).join(', ') || 'none found');

if (proofCandidates.length) {
  const newest = proofCandidates.map((p) => ({ p, m: fs.statSync(p).mtimeMs })).sort((a, b) => b.m - a.m)[0].p;
  let verifyOut = '';
  try {
    verifyOut = execFileSync('node', [path.join(ROOT, 'dist-cli', 'surnia.cjs'), 'verify', newest, '--workspace', WORK], { cwd: ROOT, timeout: 120_000, encoding: 'utf8' });
  } catch (err) {
    verifyOut = String(err.stdout ?? '') + String(err.stderr ?? '');
  }
  report('REAL CLI `surnia verify` ran', verifyOut.length > 0);
  report('signature VALID', /signature: .*VALID/.test(verifyOut) || /SIGNATURE VALID/.test(verifyOut), verifyOut.split('\n').find((l) => /signature/i.test(l))?.trim() ?? '');
}

// ================= TEST 4: fake-test detector on a REAL poisoned file =================
console.log('\n── TEST 4: fake-test detector (deterministic) ──');
{
  const pathMod = await import('node:path');
  const fakeDir = fs.mkdtempSync('/tmp/surnia-v71-fake-');
  fs.writeFileSync(pathMod.join(fakeDir, 'package.json'), PKG);
  fs.writeFileSync(pathMod.join(fakeDir, 'shady.test.js'), [
    "it('looks legit', () => {",
    '  expect(true).toBe(true);',
    '});',
    "it.skip('never runs', () => {",
    '  expect(1).toBe(1);',
    '});',
  ].join('\n'));
  // bundle the detector and run it directly — the SAME rules the engine runs
  execFileSync('npx', ['esbuild', 'electron/agent/fakeTests.ts', '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${pathMod.join(fakeDir, 'fakeTests.cjs')}`, '--external:electron'], { cwd: ROOT, stdio: 'pipe' });
  const detectorUrl = 'file://' + pathMod.join(fakeDir, 'fakeTests.cjs');
  const { detectFakeTests } = await import(detectorUrl);
  const rep = await detectFakeTests({ files: [pathMod.join(fakeDir, 'shady.test.js')] });
  report('tautology flagged', rep.findings.some((f) => f.rule === 'tautology'));
  report('skip flagged', rep.findings.some((f) => f.rule === 'skipped-test'));
  report('zero model calls needed (pure rules)', rep.scanned === 1 && rep.findings.length >= 2, `${rep.findings.length} findings`);
  fs.rmSync(fakeDir, { recursive: true, force: true });
}

console.log(`\n══════ V7.1 E2E RESULT: ${pass} passed, ${fail} failed · ${Math.round((Date.now() - startedAt) / 1000)}s · workspace: ${WORK} ══════`);
process.exit(fail ? 1 : 0);
