// ============================================================
// SADEEM v11.34 — ALL 145 TOOLS, PER-TOOL PROFILES, ZERO CAPABILITY LOSS
//
// Founder: "لا تقلل التولز لكن اعمل بروفايل تولز لكل أداة؟ ويجعله قادر على
// استخدام كل الأدوات." Honest fact: the registry has **145** tools (not 147;
// scripts/gen-tool-inventory.mjs is the source of truth).
//
// A "profile" is a PER-TURN VIEW over the tools[] array, never a deletion:
//   • every one of the 145 defs carries a stable profile tag
//     (core/workflow/advanced/desktop/web); MCP defs get 'mcp';
//   • 'full' advertises ALL 145; focused views show a human-sized subset;
//   • a weak model on the default gets 'core' (src/lib/modes.ts);
//   • executeTool() ALWAYS resolves the full registry, so a tool hidden by a
//     profile still executes the moment the model names it.
//
// Run: node --test --test-force-exit tests/v1134-all-tools.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

// Honest headless posture — device/browser tools refuse cleanly instead of
// trying to open an Electron window.
process.env.SURNIA_NO_BROWSER = '1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1134-'));

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN,
    entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// Minimal electron stub so the esbuild graph loads in plain Node.
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `const p = ${JSON.stringify(join(tmp, 'ud'))}; module.exports = {
  app: { getPath: () => p, isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },
  ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
  BrowserWindow: { getAllWindows: () => [] }, Notification: { isSupported: () => false },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder: () => {} },
  clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
};`);

const defsPath = join(tmp, 'tool-defs.cjs');
const toolsPath = join(tmp, 'tools.cjs');
const modesPath = join(tmp, 'modes.cjs');
bundle('electron/agent/tool-defs.ts', defsPath);
bundle('electron/agent/tools.ts', toolsPath);
bundle('src/lib/modes.ts', modesPath);
const td = require(defsPath);
const tools = require(toolsPath);
const modes = require(modesPath);

const CORE_DEFS = td.CORE_DEFS;
const CATEGORIES = td.TOOL_CATEGORIES;
const WS = join(tmp, 'ws');
mkdirSync(WS, { recursive: true });
const ctx = () => ({
  workspace: WS, sessionId: 'v1134-all-tools', mcpServers: [], emit: () => {},
  approve: async () => true, fullAccess: true,
});
const run = (name, args) => tools.executeTool(name, JSON.stringify(args ?? {}), ctx());

// ------------------------------------------------------------
test('v1134 inventory: 145 defs, every def has a stable profile tag, every def has an executor', () => {
  assert.equal(CORE_DEFS.length, 145, 'honest count is 145 — not 147');
  assert.equal(new Set(CORE_DEFS.map((d) => d.name)).size, 145, 'no duplicate names');

  const allowed = new Set(CATEGORIES);
  const untagged = [];
  const badTag = [];
  for (const d of CORE_DEFS) {
    if (typeof d.profile !== 'string' || !d.profile) untagged.push(d.name);
    else if (!allowed.has(d.profile)) badTag.push(`${d.name}:${d.profile}`);
    assert.ok(typeof d.description === 'string' && d.description.length > 15, `${d.name}: real description`);
    assert.equal(d.parameters?.type, 'object', `${d.name}: object schema`);
  }
  assert.deepEqual(untagged, [], `every tool needs a profile tag; missing: ${untagged.join(', ')}`);
  assert.deepEqual(badTag, [], `unknown profile tag: ${badTag.join(', ')}`);

  // source-level proof: every declared def has an executor case in tools.ts
  const q = String.fromCharCode(39);
  const defsSrc = readFileSync(join(ROOT, 'electron/agent/tool-defs.ts'), 'utf8');
  const toolsSrc = readFileSync(join(ROOT, 'electron/agent/tools.ts'), 'utf8');
  const defNames = [...defsSrc.matchAll(new RegExp('^\\s*name:\\s*' + q + '([^' + q + ']+)' + q, 'gm'))].map((m) => m[1]);
  const cases = new Set([...toolsSrc.matchAll(new RegExp('^\\s*case\\s+' + q + '([^' + q + ']+)' + q + ':', 'gm'))].map((m) => m[1]));
  assert.equal(defNames.length, 145, 'tool-defs.ts declares 145 defs');
  const missingExecutors = defNames.filter((n) => !cases.has(n));
  assert.deepEqual(missingExecutors, [], `no orphan tool without an executor; missing: ${missingExecutors.join(', ')}`);

  console.log(`V1134_INVENTORY=145 tagged defs, 145 executors, categories=${CATEGORIES.join('/')}`);
});

test('v1134 profiles: full=145, category views partition the registry, legacy subsets intact', () => {
  const full = td.defsForProfile(CORE_DEFS, 'full');
  assert.equal(full.length, 145, 'the canonical full profile exposes ALL 145 declared tools');
  assert.equal(new Set(full.map((d) => d.name)).size, 145, 'full has no duplicates');

  // The canonical registry is the 145 defs in tool-defs.ts (the source of
  // truth for scripts/gen-tool-inventory.mjs). getToolDefs() may additionally
  // surface runtime-registered defs from tools.ts (e.g. preview_open, added by
  // another agent in the v11.34 batch) — those are a SUPERSET, never a cut.
  const runtimeFull = tools.getToolDefs([], 'full');
  for (const d of CORE_DEFS) {
    assert.ok(runtimeFull.some((r) => r.name === d.name), `${d.name}: still present in the runtime full view`);
  }
  assert.ok(runtimeFull.length >= 145, 'runtime full view never drops a declared tool');
  const runtimeExtras = runtimeFull.filter((r) => !CORE_DEFS.some((d) => d.name === r.name)).map((r) => r.name);
  console.log(`RUNTIME_EXTRAS=${runtimeExtras.length ? runtimeExtras.join(', ') : 'none'} (runtime total=${runtimeFull.length})`);

  // Per-tool views are a partition of the 145 core tools (MCP is runtime-only).
  const coreTools = CORE_DEFS.filter((d) => d.profile !== 'mcp');
  const byCat = new Map(CATEGORIES.map((c) => [c, td.defsForProfile(CORE_DEFS, c)]));
  const seen = [];
  for (const c of CATEGORIES) {
    for (const d of byCat.get(c)) {
      if (d.kind === 'mcp') continue; // runtime MCP defs, not core registry
      seen.push(d.name);
      assert.equal(td.profileOf(d), c, `${d.name}: category view matches its tag`);
    }
  }
  assert.equal(seen.length, 145, 'category views cover every core tool exactly once');
  assert.equal(new Set(seen).size, 145, 'no tool appears in two category views');
  assert.deepEqual([...seen].sort(), coreTools.map((d) => d.name).sort(), 'union of views = full registry');
  assert.equal(byCat.get('mcp').length, 0, 'no core tool is tagged mcp (MCP defs arrive at runtime)');

  // A focused view is strictly smaller than full — that is the whole point.
  for (const c of ['core', 'workflow', 'advanced', 'desktop', 'web']) {
    assert.ok(byCat.get(c).length < 145, `${c} is a focused subset, not the full list`);
  }

  // Legacy scopes are unchanged (v1118 honesty proof): essential ⊂ balanced ⊂ full.
  const names = (arr) => new Set(arr.map((d) => d.name));
  const e = names(td.defsForProfile(CORE_DEFS, 'essential'));
  const b = names(td.defsForProfile(CORE_DEFS, 'balanced'));
  const f = names(full);
  assert.ok(e.size < b.size && b.size < f.size, `essential(${e.size}) < balanced(${b.size}) < full(${f.size})`);
  assert.deepEqual([...e].filter((n) => !b.has(n)), [], 'every essential tool stays in balanced');
  assert.deepEqual([...b].filter((n) => !f.has(n)), [], 'every balanced tool stays in full');

  console.log(`V1134_PROFILES=full=145 core=${byCat.get('core').length} workflow=${byCat.get('workflow').length} advanced=${byCat.get('advanced').length} desktop=${byCat.get('desktop').length} web=${byCat.get('web').length}`);
});

test('v1134 weak models get a focused default view; explicit choice always wins', () => {
  assert.equal(modes.DEFAULT_TOOL_PROFILE, 'balanced', 'the app default stays balanced');
  assert.equal(modes.advertisedToolProfile(undefined, 'claude-sonnet-5-5'), 'balanced', 'strong model keeps balanced');
  assert.equal(modes.advertisedToolProfile(undefined, 'gpt-5'), 'balanced', 'strong model keeps balanced');
  assert.equal(modes.advertisedToolProfile(undefined, 'qwen2.5:1.5b'), 'core', 'weak model gets the focused core view');
  assert.equal(modes.advertisedToolProfile(undefined, 'llama-3.2-3b'), 'core', 'small local model gets core');
  assert.equal(modes.advertisedToolProfile('full', 'qwen2.5:1.5b'), 'full', 'explicit full overrides weak detection');
  assert.equal(modes.advertisedToolProfile('web', 'qwen2.5:1.5b'), 'web', 'explicit category view is honored');

  // Focusing the VIEW never shrinks the registry the executor resolves against.
  const focused = td.defsForProfile(CORE_DEFS, modes.advertisedToolProfile(undefined, 'qwen2.5:1.5b'));
  assert.ok(focused.length < 145 && focused.length > 0, 'focused view is smaller but non-empty');
  assert.ok(tools.getToolDefs([], 'full').length >= 145, 'full registry intact after focusing');
});

test('v1134 dispatch sweep: all 145 names execute — no "Unknown tool", no throw', async () => {
  const unreachable = [];
  const malformed = [];
  let ok = 0;
  let refusal = 0;
  for (const def of CORE_DEFS) {
    let res;
    try {
      res = await tools.executeTool(def.name, '{}', ctx());
    } catch (err) {
      unreachable.push(`${def.name}: THREW ${err?.message ?? err}`);
      continue;
    }
    const out = typeof res?.output === 'string' ? res.output : '';
    if (typeof res?.ok !== 'boolean' || !out.length) {
      malformed.push(`${def.name}: missing ok or empty output`);
      continue;
    }
    if (/^Unknown tool:/.test(out)) {
      unreachable.push(`${def.name}: Unknown tool`);
      continue;
    }
    if (res.ok) ok++; else refusal++;
  }
  assert.deepEqual(unreachable, [], `every registered tool must dispatch: ${unreachable.join(' | ')}`);
  assert.deepEqual(malformed, [], `malformed outcomes: ${malformed.join(' | ')}`);
  assert.equal(ok + refusal, 145, 'all 145 names returned ok or an honest refusal');
  console.log(`V1134_DISPATCH=145 ok=${ok} honest-refusal=${refusal} unknown=0 threw=0`);
});

test('v1134 GATE: a tool excluded from the advertised profile still executes when named', async () => {
  // markdown_outline is tagged 'advanced' and lives in ADVANCED_TOOL_NAMES —
  // hidden from BOTH 'balanced' (the default) and the weak-model 'core' view.
  const name = 'markdown_outline';
  const coreView = td.defsForProfile(CORE_DEFS, 'core');
  const balancedView = td.defsForProfile(CORE_DEFS, 'balanced');
  assert.ok(!coreView.some((d) => d.name === name), `${name} is excluded from the core view`);
  assert.ok(!balancedView.some((d) => d.name === name), `${name} is excluded from the balanced view`);
  assert.ok(td.defsForProfile(CORE_DEFS, 'full').some((d) => d.name === name), `${name} exists in full`);

  // The router must NOT refuse it with "not in profile"/"Unknown tool".
  const res = await run(name, { text: '# Heading\n## Section\nbody' });
  assert.equal(res.ok, true, `${name} executes even though the view hid it`);
  assert.doesNotMatch(res.output, /^Unknown tool:/, 'no "not in profile" refusal');
  assert.doesNotMatch(res.output, /not in (?:the )?profile|not advertised|hidden by/i, 'profile must never be a gate');
  assert.ok(res.output.trim().length >= 8, 'actionable output');

  // A desktop tool hidden from 'core' also dispatches (headless → clean refusal,
  // never an "Unknown tool" / profile refusal).
  const desk = 'desktop_control';
  assert.ok(!coreView.some((d) => d.name === desk), `${desk} is excluded from the core view`);
  const deskRes = await run(desk, { action: 'screenshot' });
  assert.doesNotMatch(deskRes.output, /^Unknown tool:/, `${desk} still routes through the full registry`);
  assert.doesNotMatch(deskRes.output, /not in (?:the )?profile|not advertised|hidden by/i);

  // Switching back to 'full' only changes what is ADVERTISED, never the registry.
  assert.ok(td.defsForProfile(CORE_DEFS, 'full').length === 145, 'full view still exposes all 145 declared tools');
  assert.ok(tools.getToolDefs([], 'full').length >= 145, 'runtime registry intact after the gate test');

  console.log('V1134_GATE=excluded-profile tools executed, no profile refusal, registry=145');
});

test('v1134 cleanup', () => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  assert.ok(true);
});
