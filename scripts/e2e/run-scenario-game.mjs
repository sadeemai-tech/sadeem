#!/usr/bin/env node
// E2E harness (Task e2e-harness-A) — thin CLI wrapper for Scenario A.
// Runs tests/e2e-scenario-game.mjs (the REAL-engine game-build scenario)
// outside of a bare `node --test` invocation, forwarding the exit code.
//
//   node scripts/e2e/run-scenario-game.mjs
//
// Environment overrides: E2E_RESULTS_DIR (default /home/z/my-project/work/e2e-results)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEST_FILE = join(ROOT, 'tests', 'e2e-scenario-game.mjs');

console.log(`[e2e] running scenario: node --test --test-force-exit ${TEST_FILE}`);
const res = spawnSync(
  process.execPath,
  ['--test', '--test-force-exit', TEST_FILE],
  { cwd: ROOT, stdio: 'inherit' },
);

if (res.error) {
  console.error(`[e2e] failed to spawn the scenario: ${res.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = res.status ?? 1;
}
