// Surnia v2.1 — self-repair phase: the engine must fix the failing tests
// left by the killed long-task run and reach a green test suite.
import { startBridge } from './glm-bridge.mjs';
import { runCLI } from './cli-driver.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ws = process.argv[2];
if (!ws || !fs.existsSync(ws)) {
  console.error('usage: node tests/repair-task.e2e.mjs <workspace>');
  process.exit(2);
}
const started = Date.now();
console.log('── SELF-REPAIR: make the failing suite green ──');
console.log('   workspace:', ws);

const before = spawnSync('node', ['--test'], { cwd: ws, encoding: 'utf8', timeout: 60_000 });
console.log('   before: status=' + before.status);

const port = await startBridge(0);
const res = await runCLI({
  root,
  task: 'The test suite in this workspace has failing tests. Run "node --test", read the failures carefully, fix the PRODUCT CODE or TEST CODE as appropriate (minimal changes), and re-run until the whole suite passes. Do not add dependencies.',
  mode: 'fullAccess',
  workspace: ws,
  baseUrl: `http://127.0.0.1:${port}/v1`,
  apiKey: 'bridge-local',
  model: 'glm-5.3-flash',
  timeoutMs: 300_000,
});

const dt = Math.round((Date.now() - started) / 1000);
const after = spawnSync('node', ['--test'], { cwd: ws, encoding: 'utf8', timeout: 60_000 });
const out = (after.stdout || '') + (after.stderr || '');
const m = out.match(/ℹ tests\s+(\d+)[\s\S]*?ℹ pass\s+(\d+)[\s\S]*?ℹ fail\s+(\d+)/);
const total = m ? Number(m[1]) : 0, passN = m ? Number(m[2]) : 0, failN = m ? Number(m[3]) : -1;
console.log(`  ${after.status === 0 ? '✅' : '❌'} suite green — status=${after.status} (${passN}/${total} pass, ${failN} fail) · repair run ${dt}s, exit=${res.code}`);
console.log(`══════ SELF-REPAIR RESULT: ${after.status === 0 ? 'PASS' : 'FAIL'} ══════`);
process.exit(after.status === 0 ? 0 : 1);
