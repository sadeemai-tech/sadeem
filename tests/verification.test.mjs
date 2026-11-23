// verification unit tests — mutation probe (tests-honesty), claim-evidence
// auditor, red→green discipline.
// Self-bootstrapping: bundles electron/agent/verification.ts with esbuild into
// tests/.verification.bundle.mjs when the bundle is missing or older than the
// source, then dynamic-imports it. No checked-in build artifacts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, statSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const SRC = path.join(projectRoot, 'electron', 'agent', 'verification.ts');
const BUNDLE = path.join(here, '.verification.bundle.mjs');

// ---------- prelude: rebuild the bundle when stale ----------
// NOTE: terminalGuard lazily require()s engine/sessionService/storeService/…
// Those calls live inside functions the runCaptured path never invokes, so we
// mark them external: the bundle stays tiny, side-effect-free and does not
// drag the whole engine graph (whose modules statically import electron) in.
function ensureBundle() {
  const stale = !existsSync(BUNDLE) || statSync(BUNDLE).mtimeMs < statSync(SRC).mtimeMs;
  if (!stale) return;
  const cmd =
    `npx esbuild ${JSON.stringify(SRC)} ` +
    `--bundle --platform=node --format=esm --external:electron ` +
    `--external:../agent/risk --external:./storeService --external:./logService ` +
    `--external:./sessionService --external:../agent/dna --external:../agent/engine ` +
    `--external:./fsService ` +
    `--outfile=${JSON.stringify(BUNDLE)}`;
  try {
    execSync(cmd, { cwd: projectRoot, stdio: 'pipe' });
  } catch (err) {
    throw new Error(`verification bundle build failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
ensureBundle();

const v = await import(pathToFileURL(BUNDLE).href);

// ---------- fixture repo builder ----------
const MATH_SRC = [
  '// tiny math module used by run-tests.mjs',
  'const VERSION = 1;',
  'function add(a, b) {',
  "  if (typeof a === 'number' && typeof b === 'number') return a + b;",
  "  throw new TypeError('numbers only');",
  '}',
  'module.exports = { add };',
  '',
].join('\n');

const HONEST_TEST = [
  "import { createRequire } from 'node:module';",
  'const require = createRequire(import.meta.url);',
  "const { add } = require('./src/math.js');",
  'if (add(1, 1) !== 2) {',
  "  console.error('FAIL: add(1,1) did not return 2');",
  '  process.exit(1);',
  '}',
  "console.log('PASS: add(1,1) === 2');",
  '',
].join('\n');

const DISHONEST_TEST = "console.log('PASS: everything is fine');\n";
const ALWAYS_FAIL_TEST = "console.error('FAIL: boom');\nprocess.exit(1);\n";

function makeRepo(runTestsContent) {
  const ws = mkdtempSync(path.join(tmpdir(), 'surnia-mutation-'));
  mkdirSync(path.join(ws, 'src'), { recursive: true });
  writeFileSync(path.join(ws, 'run-tests.mjs'), runTestsContent, 'utf8');
  writeFileSync(path.join(ws, 'src', 'math.js'), MATH_SRC, 'utf8');
  return ws;
}

function snapshot(ws) {
  return {
    runner: readFileSync(path.join(ws, 'run-tests.mjs'), 'utf8'),
    math: readFileSync(path.join(ws, 'src', 'math.js'), 'utf8'),
  };
}

// ---------- 1. auditClaims (English + Arabic) ----------
test('auditClaims: unevidenced edit claim detected, evidenced edit + command supported', () => {
  const evidence = {
    filesTouched: ['/repo/src/auth.service.ts', '/repo/src/util.ts'],
    commands: [
      { command: 'npm test', exitCode: 0 },
      { command: 'npx tsc --noEmit', exitCode: 0 },
    ],
    testsRun: true,
  };
  const text = [
    'I edited auth.service.ts to clear the stale token.',
    'I also wrote README.md with usage notes.',
    'Ran npm test and npx tsc --noEmit.',
    'Ran cargo build for the rust layer.',
    'All tests pass.',
    'عدّلت util.ts لإصلاح الخطأ.',
  ].join('\n');
  const audit = v.auditClaims(text, evidence);
  assert.equal(audit.claims.length, 6);
  const byClaim = (frag) => audit.claims.find((c) => c.claim.includes(frag));

  const goodEdit = byClaim('auth.service.ts');
  assert.equal(goodEdit.kind, 'file-edit');
  assert.equal(goodEdit.supported, true);

  const badEdit = byClaim('README.md');
  assert.equal(badEdit.kind, 'file-edit');
  assert.equal(badEdit.supported, false);
  assert.match(badEdit.note, /unevidenced/i);

  const goodCmd = byClaim('npm test');
  assert.equal(goodCmd.kind, 'command');
  assert.equal(goodCmd.supported, true);
  assert.match(goodCmd.note, /evidenced/i);

  const badCmd = byClaim('cargo build');
  assert.equal(badCmd.kind, 'command');
  assert.equal(badCmd.supported, false);

  const passClaim = byClaim('All tests pass');
  assert.equal(passClaim.kind, 'test');
  assert.equal(passClaim.supported, true);

  const arClaim = byClaim('util.ts');
  assert.equal(arClaim.kind, 'file-edit');
  assert.equal(arClaim.supported, true);

  assert.equal(audit.unsupportedCount, 2);
  assert.equal(audit.summary, '6 claims, 2 unevidenced');
});

test('auditClaims: pass claim without a recorded test run is flagged; other sentences are neutral', () => {
  const audit = v.auditClaims('All tests pass.\nThe refactor improves clarity.', {
    filesTouched: [],
    commands: [],
    testsRun: false,
  });
  assert.equal(audit.claims[0].kind, 'test');
  assert.equal(audit.claims[0].supported, false);
  assert.equal(audit.claims[1].kind, 'other');
  assert.equal(audit.claims[1].supported, true);
  assert.equal(audit.unsupportedCount, 1);
});

test('auditClaims: file names with dots are never split by the sentence splitter', () => {
  const audit = v.auditClaims('I edited src/app.ts. Then ran npm install.', {
    filesTouched: ['/w/src/app.ts'],
    commands: [{ command: 'npm install', exitCode: 0 }],
    testsRun: false,
  });
  assert.equal(audit.claims.length, 2);
  assert.ok(audit.claims[0].claim.includes('src/app.ts'), audit.claims[0].claim);
  assert.equal(audit.claims[0].kind, 'file-edit');
  assert.equal(audit.claims[0].supported, true);
  assert.equal(audit.claims[1].kind, 'command');
  assert.equal(audit.claims[1].supported, true);
});

// ---------- 2. red→green discipline ----------
test('redGreenDirective requires failing-test-first and embeds the bug description', () => {
  const d = v.redGreenDirective('login button throws on click');
  assert.match(d, /FAILING TEST/i);
  assert.match(d, /login button throws on click/);
  assert.match(d, /exit code/i);
  assert.match(d, /final message/i);
});

test('parseRedGreen: compliant fixture (fail before pass, order-sensitive)', () => {
  const good = [
    'RED: wrote tests/add.test.mjs',
    '$ node run-tests.mjs',
    'FAIL add(1,1): expected 2, got 3',
    'exit code 1',
    'GREEN: fixed src/math.js',
    '$ node run-tests.mjs',
    'PASS add tests',
    'exit code 0',
  ].join('\n');
  const r = v.parseRedGreen(good);
  assert.equal(r.hasFailingFirst, true);
  assert.equal(r.hasPassAfter, true);
  assert.equal(r.compliant, true);
});

test('parseRedGreen: green-only and pass-then-fail fixtures are non-compliant', () => {
  const greenOnly = v.parseRedGreen('Everything works. All tests pass, exit code 0.');
  assert.equal(greenOnly.hasFailingFirst, false);
  assert.equal(greenOnly.compliant, false);

  const reversed = v.parseRedGreen('PASS add — exit code 0. (The very first run FAILED with exit code 1 before the fix.)');
  assert.equal(reversed.hasFailingFirst, false);
  assert.equal(reversed.hasPassAfter, false);
  assert.equal(reversed.compliant, false);
});

// ---------- 3. pickMutationTarget ----------
test('pickMutationTarget: prefers src/, skips node_modules/tests/migrations/binaries/oversized', async () => {
  const ws = mkdtempSync(path.join(tmpdir(), 'surnia-pick-'));
  mkdirSync(path.join(ws, 'node_modules'), { recursive: true });
  mkdirSync(path.join(ws, 'test'), { recursive: true });
  mkdirSync(path.join(ws, 'migrations'), { recursive: true });
  writeFileSync(path.join(ws, 'node_modules', 'dep.js'), "module.exports = 1 === 1;\n", 'utf8');
  writeFileSync(path.join(ws, 'test', 'app.test.js'), "assert.equal(1, 1);\n", 'utf8');
  writeFileSync(path.join(ws, 'migrations', '0001_init.js'), 'const x = 1 === 2;\n', 'utf8');
  writeFileSync(path.join(ws, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  writeFileSync(path.join(ws, 'util.js'), 'export function util() { return 1; }\n', 'utf8');
  writeFileSync(path.join(ws, 'run-tests.mjs'), HONEST_TEST, 'utf8');
  mkdirSync(path.join(ws, 'src'), { recursive: true });
  writeFileSync(path.join(ws, 'src', 'math.js'), MATH_SRC, 'utf8');
  writeFileSync(path.join(ws, 'src', 'big.js'), Array.from({ length: 500 }, (_, i) => `const v${i} = ${i};`).join('\n') + '\n', 'utf8');

  const t = await v.pickMutationTarget(ws);
  assert.ok(t, 'expected a target');
  assert.ok(t.endsWith(path.join('src', 'math.js')), `got ${t}`);

  const empty = mkdtempSync(path.join(tmpdir(), 'surnia-pick-empty-'));
  assert.equal(await v.pickMutationTarget(empty), null);
});

// ---------- 4. mutationCheck — honest suite ----------
test('mutationCheck: honest fixture — mutation flip makes tests fail, content restored byte-exact', async () => {
  const ws = makeRepo(HONEST_TEST);
  const before = snapshot(ws);
  const rep = await v.mutationCheck({ workspace: ws, testCommand: 'node run-tests.mjs' });
  assert.equal(rep.ok, true, rep.detail);
  assert.equal(rep.testsHonest, true, rep.detail);
  assert.ok(rep.mutatedFile && rep.mutatedFile.endsWith(path.join('src', 'math.js')), rep.mutatedFile);
  assert.match(rep.detail, /HONEST/);
  const after = snapshot(ws);
  assert.equal(after.math, before.math, 'math.js must be restored byte-exact');
  assert.equal(after.math, MATH_SRC);
  assert.equal(after.runner, before.runner, 'run-tests.mjs must be untouched');
});

// ---------- 5. mutationCheck — dishonest suite ----------
test('mutationCheck: dishonest fixture — tests still pass after the mutation', async () => {
  const ws = makeRepo(DISHONEST_TEST);
  const before = snapshot(ws);
  const rep = await v.mutationCheck({ workspace: ws, testCommand: 'node run-tests.mjs' });
  assert.equal(rep.ok, true, rep.detail);
  assert.equal(rep.testsHonest, false, rep.detail);
  assert.match(rep.detail, /DISHONEST/);
  const after = snapshot(ws);
  assert.equal(after.math, before.math, 'restore must be byte-exact on the dishonest path too');
});

// ---------- 6. mutationCheck — failing baseline is inconclusive ----------
test('mutationCheck: baseline failure → testsHonest null, nothing mutated', async () => {
  const ws = makeRepo(ALWAYS_FAIL_TEST);
  const before = snapshot(ws);
  const rep = await v.mutationCheck({ workspace: ws, testCommand: 'node run-tests.mjs' });
  assert.equal(rep.ok, false);
  assert.equal(rep.testsHonest, null);
  assert.match(rep.detail, /baseline/i);
  assert.equal(rep.mutatedFile, undefined);
  const after = snapshot(ws);
  assert.equal(after.math, before.math);
});
