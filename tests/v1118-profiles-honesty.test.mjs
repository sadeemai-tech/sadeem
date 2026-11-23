// ============================================================
// SADEEM v11.18 — TOOL PROFILE HONESTY PROOF
//
// The founder is (rightly) angry that we "reduced tools from ~170/145 to 40".
// This harness proves, against the app's OWN bundled source, that NOTHING was
// deleted. A Tool Profile only decides which defs are ADVERTISED to the model;
// it never touches the registry and never disables an executor.
//
//   (a) executeTool() dispatches EVERY one of the 145 tool names.
//       A well-formed "honest refusal" (ok:false with a reason) counts as
//       REACHABLE. Only "Unknown tool:" / an uncaught throw count as broken.
//   (b) defsForProfile(CORE_DEFS, 'full').length === 145.
//   (c) essential  ⊂  balanced  ⊂  full  (strict subsets, by advertised name).
//   (d) providers.ts has NO ad-hoc `.slice(0, N)` applied to a tools/defs array
//       — the 422 gateway fallback drops exactly ONE offending tool instead.
//
// Run: node --test --test-force-exit tests/v1118-profiles-honesty.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ESBUILD_NODE, ESBUILD_BIN } from './_esbuild-bin.mjs';

// Force the honest headless posture so browser/device tools refuse cleanly
// instead of trying to open an Electron window.
process.env.SURNIA_NO_BROWSER = '1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1118-profiles-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN,
    entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// Minimal electron stub so the esbuild graph loads in plain Node (same posture
// as v1116-tools-audit.test.mjs / tool-coverage-all.mjs).
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `module.exports = {
  app: { getPath: () => ${JSON.stringify(join(tmp, 'ud'))}, whenReady: async () => true, on() {}, quit() {}, isReady: () => true },
  ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder: () => {} },
  clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
  Notification: { isSupported: () => false },
};`);

// Two bundles: tools.ts (for executeTool + getToolDefs) and tool-defs.ts
// (for the raw defsForProfile / CORE_DEFS / profile name sets).
const toolsPath = join(tmp, 'tools.cjs');
const defsPath = join(tmp, 'tool-defs.cjs');
bundle('electron/agent/tools.ts', toolsPath);
bundle('electron/agent/tool-defs.ts', defsPath);
const tools = require(toolsPath);
const td = require(defsPath);

const CORE_DEFS = td.CORE_DEFS;
const fullDefs = td.defsForProfile(CORE_DEFS, 'full');
const balancedDefs = td.defsForProfile(CORE_DEFS, 'balanced');
const essentialDefs = td.defsForProfile(CORE_DEFS, 'essential');

const WS = join(tmp, 'ws');
mkdirSync(WS, { recursive: true });
const ctx = () => ({
  workspace: WS,
  sessionId: 'v1118-profiles-honesty',
  mcpServers: [],
  emit: () => {},
  approve: async () => true,
  fullAccess: true,
});

// ------------------------------------------------------------
test('B — defsForProfile("full") exposes every core tool (145)', () => {
  assert.equal(Array.isArray(CORE_DEFS), true, 'CORE_DEFS is exported');
  assert.equal(CORE_DEFS.length, 145, `CORE_DEFS has 145 defs (got ${CORE_DEFS.length})`);
  assert.equal(fullDefs.length, 145, `defsForProfile(full).length === 145 (got ${fullDefs.length})`);
  assert.equal(typeof td.defsForProfile, 'function', 'defsForProfile is exported from tool-defs.ts');
  // Cross-check: the public getToolDefs([], 'full') wrapper must agree.
  assert.equal(tools.getToolDefs([], 'full').length, 145, 'getToolDefs([], "full") also returns 145');
  console.log(`PROFILE-COUNTS: essential=${essentialDefs.length} balanced=${balancedDefs.length} full=${fullDefs.length}`);
});

test('C — advertised profiles are strict subsets: essential ⊂ balanced ⊂ full', () => {
  const names = (arr) => new Set(arr.map((d) => d.name));
  const e = names(essentialDefs);
  const b = names(balancedDefs);
  const f = names(fullDefs);

  assert.ok(e.size < b.size && b.size < f.size,
    `strict size ordering essential(${e.size}) < balanced(${b.size}) < full(${f.size})`);

  const missingInBalanced = [...e].filter((n) => !b.has(n));
  const missingInFull = [...b].filter((n) => !f.has(n));
  assert.deepEqual(missingInBalanced, [],
    `every ESSENTIAL tool is also in BALANCED; missing: ${missingInBalanced.join(', ')}`);
  assert.deepEqual(missingInFull, [],
    `every BALANCED tool is also in FULL; missing: ${missingInFull.join(', ')}`);

  // No duplicates inside a profile — the sets are honest, not padded.
  assert.equal(essentialDefs.length, e.size, 'essential has no duplicate names');
  assert.equal(balancedDefs.length, b.size, 'balanced has no duplicate names');
  assert.equal(fullDefs.length, f.size, 'full has no duplicate names');
});

test('A — executeTool dispatches every one of the 145 tool names (honest refusals count)', async () => {
  const unreachable = [];
  const threw = [];
  const malformed = [];
  let okCount = 0;
  let refusalCount = 0;

  for (const def of fullDefs) {
    let res;
    try {
      // Empty args are valid JSON. A tool that needs args must refuse with its
      // own honest reason; a no-arg tool may succeed. Either way it is REACHABLE.
      res = await tools.executeTool(def.name, '{}', ctx());
    } catch (err) {
      threw.push(`${def.name}: THREW ${err?.message ?? String(err)}`);
      continue;
    }
    const out = typeof res?.output === 'string' ? res.output : '';
    if (typeof res?.ok !== 'boolean' || !out.length) {
      malformed.push(`${def.name}: missing ok flag or empty output`);
      continue;
    }
    // "Unknown tool:" is the ONLY real "this tool is not reachable" signal:
    // it comes from executeTool's default branch (tools.ts:1259) when no switch
    // case / MCP route exists for a registered name. The v11.12 "did you mean"
    // hints share this prefix, so they are caught here too.
    if (/^Unknown tool:/.test(out)) {
      unreachable.push(def.name);
      continue;
    }
    if (res.ok === true) okCount++;
    else refusalCount++; // ok:false + non-"Unknown tool" reason = honest refusal
  }

  assert.deepEqual(threw, [], `executeTool must never reject: ${threw.join(' | ')}`);
  assert.deepEqual(malformed, [], `malformed outcomes: ${malformed.join(' | ')}`);
  assert.deepEqual(unreachable, [],
    `UNREACHABLE tools (registered but not dispatchable): ${unreachable.join(', ')}`);
  assert.equal(okCount + refusalCount, 145, 'all 145 names produced ok or honest refusal');
  console.log(`DISPATCH-RESULT: total=145 ok=${okCount} honest-refusal=${refusalCount} unreachable=0 threw=0`);
});

test('D — providers.ts contains NO ad-hoc .slice(0, N) on a tools/defs array', () => {
  const src = readFileSync(join(ROOT, 'electron', 'agent', 'providers.ts'), 'utf8');
  const lines = src.split(/\r?\n/);
  // A fixed-size tool cap would look like `tools.slice(0, 40)` /
  // `toolDefs.slice(0, 119)` / `defs.slice(0, N)`. Legit string slices in this
  // file (e.g. `res.text()).slice(0, 400)`) are NOT matched: their receiver is
  // not a tools/defs collection.
  const toolCollection = '(?:tools?|toolDefs?|defs|toolList|tool_list|allTools|availableTools|advertisedTools)';
  const badToolSlice = new RegExp(`\\b${toolCollection}\\s*\\.\\s*slice\\s*\\(\\s*0\\s*,`, 'i');
  const offenders = [];
  lines.forEach((line, i) => {
    if (badToolSlice.test(line)) offenders.push(`L${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(offenders, [],
    `fixed-size tool slicing found in providers.ts: ${offenders.join(' | ')}`);

  // Positive proof of the honest alternative: the 422 handler drops ONE tool
  // via splice(index, 1), and it is driven by the validation error's `loc`.
  assert.match(src, /obj\.tools\.splice\(index,\s*1\)/,
    '422 fallback removes exactly ONE tool (providers.ts:1469)');
  assert.match(src, /toolIndexFromValidationError\(errText\)/,
    '422 fallback derives the single index from the error loc (providers.ts:1758)');
});

test('cleanup', () => {
  rmSync(tmp, { recursive: true, force: true });
  assert.ok(true);
});
