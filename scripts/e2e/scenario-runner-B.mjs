// Scenario runner B (Task e2e-scenarios-B) — shared helpers + CLI wrapper for
// the three REAL-engine scenario suites:
//   tests/e2e-scenario-hospital.mjs  (Scenario B — hospital management system)
//   tests/e2e-scenario-bacteria.mjs  (Scenario C — bacteria deck + real web_fetch)
//   tests/e2e-scenario-rare.mjs      (Scenario D — awk/perl rare runtimes)
//
// It does NOT re-implement the harness: it reuses scripts/e2e/run-engine.mjs
// (Task e2e-harness-A: esbuild + electron stub + scripted fake SSE provider)
// and only adds the per-scenario plumbing this task owns:
//   - fresh workspace lifecycle under <RESULTS>/.workspaces/<scenario>-<stamp>
//   - full-tree artifact copy to <RESULTS>/<scenario>/ when the run passes
//   - scenario-<b|c|d>-summary.json next to the artifacts
//   - a CLI: node scripts/e2e/scenario-runner-B.mjs [hospital|bacteria|rare|all]
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScenario } from './run-engine.mjs';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const RESULTS = process.env.E2E_RESULTS_DIR || '/home/z/my-project/work/e2e-results';

export const SCENARIOS = {
  hospital: { letter: 'b', file: 'tests/e2e-scenario-hospital.mjs' },
  bacteria: { letter: 'c', file: 'tests/e2e-scenario-bacteria.mjs' },
  rare: { letter: 'd', file: 'tests/e2e-scenario-rare.mjs' },
};

/** Fresh isolated workspace for one scenario run (never reuses leftovers). */
export function freshWorkspace(name) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ws = join(RESULTS, '.workspaces', `${name}-${stamp}`);
  rmSync(ws, { recursive: true, force: true });
  mkdirSync(ws, { recursive: true });
  return ws;
}

/** Extract command evidence ({cmd, ok, outputPreview}) from run results. */
export function commandsRunOf(results) {
  return results.toolCalls
    .filter((c) => c.name === 'run_command')
    .map((c) => ({
      cmd: String(c.args?.command ?? ''),
      ok: c.ok === true,
      outputPreview: String(c.output ?? '').slice(0, 500),
    }));
}

/** Write scenario-<letter>-summary.json next to the artifact trees. */
export function writeSummary(letter, payload) {
  mkdirSync(RESULTS, { recursive: true });
  const file = join(RESULTS, `scenario-${letter}-summary.json`);
  writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

/** Copy the full workspace tree into the artifacts folder (idempotent). */
export function copyArtifacts(name, workspace) {
  const dest = join(RESULTS, name);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(workspace, dest, { recursive: true });
  return dest;
}

/** Drive one scripted scenario through the REAL engine (thin wrapper). */
export function drive(opts) {
  return runScenario(opts);
}

// ---------- CLI wrapper ----------
function isMain() {
  try {
    return resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

function main() {
  const arg = process.argv[2] ?? 'all';
  const names = arg === 'all' ? Object.keys(SCENARIOS) : [arg];
  if (!names.every((n) => SCENARIOS[n])) {
    console.error(`unknown scenario "${arg}" — expected one of: ${Object.keys(SCENARIOS).join(', ')}, all`);
    process.exit(2);
  }
  let failed = 0;
  for (const n of names) {
    const { file, letter } = SCENARIOS[n];
    console.log(`\n=== scenario ${n.toUpperCase()} (${file}) ===`);
    const r = spawnSync(process.execPath, ['--test', '--test-force-exit', file], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    if (r.status !== 0) failed++;
    let pass = false;
    try {
      pass = JSON.parse(readFileSync(join(RESULTS, `scenario-${letter}-summary.json`), 'utf8')).pass === true;
    } catch {
      pass = false;
    }
    console.log(`scenario ${n}: exit=${r.status} summaryPass=${pass} artifacts=${join(RESULTS, n)}`);
  }
  process.exit(failed ? 1 : 0);
}

if (isMain()) main();
