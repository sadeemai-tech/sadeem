// ============================================================
// SADEEM v11.34 — TOOLS GUARD (V3 "all tools usable" verification)
// DIAGNOSIS + TEST ONLY. No source is modified.
//
// V3 added per-tool PROFILES so weak models see fewer tool schemas without
// DELETING any tool. This guard verifies the REAL behavior after V3 landed:
//
//   1. gen-tool-inventory output = 145; defsForProfile('full') = 145;
//      every def carries a stable profile tag; every def has a LIVE executor
//      (145/145 dispatch — no "Unknown tool").
//   2. A tool EXCLUDED from 'essential' still executes when called by exact
//      name (no profile-based refusal — the founder's "must use all tools").
//   3. The engine's advertised tool definitions respect the selected profile,
//      but 'full' = all 145.
//   4. No tools.slice(0,N) fixed-size truncation in the provider path.
//
// Run: node --test --test-force-exit tests/v1134-tools-guard.test.mjs
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

process.env.SURNIA_NO_BROWSER = '1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1134-guard-'));
const RESULTS = join(ROOT, 'tests', '.v1134-tools-guard.results.json');
const findings = []; // {id, status, detail, fileLine}
const note = (id, status, detail, fileLine) => {
  findings.push({ id, status, detail, fileLine });
  // Console evidence line carries file:line for the parent's report.
  console.log(`[${status}] ${id} — ${fileLine} — ${detail}`);
};

// ---------- esbuild bundle (established recipe from tools-smoke.test.mjs) ----------
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

// electron stub for plain-Node execution (same posture as the established tests)
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

// Two bundles: tool-defs.ts exports defsForProfile directly; tools.ts exports
// getToolDefs + executeTool (the live dispatch path).
const defsPath = join(tmp, 'tool-defs.cjs');
const toolsPath = join(tmp, 'tools.cjs');
bundle('electron/agent/tool-defs.ts', defsPath);
bundle('electron/agent/tools.ts', toolsPath);
const defsMod = require(defsPath);
const tools = require(toolsPath);

const { CORE_DEFS, defsForProfile, ESSENTIAL_TOOL_NAMES, ADVANCED_TOOL_NAMES } = defsMod;
const PROFILES = ['essential', 'balanced', 'full'];
const fullDefs = defsForProfile(CORE_DEFS, 'full');
const fullNames = fullDefs.map((d) => d.name);

// stub ToolContext — safe, empty workspace; approvals auto-allow.
const WS = join(tmp, 'ws');
mkdirSync(WS, { recursive: true });
function stubCtx() {
  return {
    workspace: WS,
    sessionId: 'v1134-tools-guard',
    mcpServers: [],
    emit: () => {},
    approve: async () => true,
    fullAccess: true,
    approvals: [],
  };
}
const run = (name, args = {}) => tools.executeTool(name, JSON.stringify(args), stubCtx());

// Static source readers (for file:line findings).
const src = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const withLines = (text) => text.split(/\r?\n/).map((line, i) => ({ line, n: i + 1 }));

// ============================================================
// 1. INVENTORY = 145 · FULL PROFILE = 145 · STABLE TAG · LIVE DISPATCH
// ============================================================
test('GUARD-1: gen-tool-inventory = 145, defsForProfile(full) = 145, stable tags, 145/145 live executors', async () => {
  // 1a — the generator's checked-in output (src/generated/toolInventory.json)
  const inv = JSON.parse(src('src/generated/toolInventory.json'));
  assert.equal(inv.total, 145, 'src/generated/toolInventory.json:total must be 145 (gen-tool-inventory output)');
  assert.equal(inv.tools.length, 145, 'src/generated/toolInventory.json:tools must hold 145 rows');
  const genSrc = src('scripts/gen-tool-inventory.mjs');
  assert.match(genSrc, /electron\/agent\/tool-defs\.ts/, 'scripts/gen-tool-inventory.mjs:12 must parse tool-defs.ts');
  assert.ok(genSrc.includes('CORE_DEFS') && genSrc.includes('toolInventory.json'),
    'scripts/gen-tool-inventory.mjs:14,63 must parse CORE_DEFS and write toolInventory.json');
  note('1a-inventory', 'PASS', `gen-tool-inventory output total=${inv.total}, tools=${inv.tools.length}`,
    'scripts/gen-tool-inventory.mjs:14,63 → src/generated/toolInventory.json');

  // 1b — CORE_DEFS and the full profile both equal 145, names match the inventory
  assert.equal(CORE_DEFS.length, 145, 'electron/agent/tool-defs.ts:30 CORE_DEFS must have 145 entries');
  assert.equal(fullDefs.length, 145, 'electron/agent/tool-defs.ts:2144 defsForProfile(full) must return all 145 defs');
  assert.deepEqual(
    [...fullNames].sort(),
    [...inv.tools.map((t) => t.name)].sort(),
    'gen-tool-inventory names must match defsForProfile(full) (no phantom/ghost entries)',
  );
  assert.equal(new Set(fullNames).size, 145, 'duplicate tool names in CORE_DEFS');
  note('1b-full-profile', 'PASS', `CORE_DEFS=${CORE_DEFS.length}, defsForProfile(full)=${fullDefs.length}, unique names=145`,
    'electron/agent/tool-defs.ts:30,2143-2144');

  // 1c — each def has a STABLE profile tag: a valid, fixed `kind` tag AND a
  // deterministic, reproducible profile membership (essential ⊆ balanced ⊆ full).
  const kinds = new Set(['fs', 'exec', 'meta', 'mcp']);
  for (const d of CORE_DEFS) {
    assert.ok(kinds.has(d.kind), `${d.name}: invalid stable kind tag "${d.kind}" (allowed: ${[...kinds].join(', ')})`);
  }
  const membership = (name) => PROFILES.filter((p) => defsForProfile(CORE_DEFS, p).some((d) => d.name === name));
  for (const d of CORE_DEFS) {
    const a = membership(d.name);
    const b = membership(d.name);
    assert.deepEqual(a, b, `${d.name}: profile tag not stable across calls`);
    assert.ok(a.includes('full'), `${d.name}: def belongs to no profile — full must include every def`);
  }
  const E = new Set(defsForProfile(CORE_DEFS, 'essential').map((d) => d.name));
  const B = new Set(defsForProfile(CORE_DEFS, 'balanced').map((d) => d.name));
  const F = new Set(fullNames);
  for (const n of E) assert.ok(B.has(n), `${n}: in essential but not balanced (profiles not monotonic)`);
  for (const n of B) assert.ok(F.has(n), `${n}: in balanced but not full (profiles not monotonic)`);
  // ToolDef has NO explicit `profile` field — membership is derived from name
  // sets + kind. This is an honest observation, not a behavior failure.
  const toolDefSrc = src('electron/agent/providers.ts');
  const hasProfileField = /interface ToolDef[\s\S]*?\bprofile\s*:/.test(toolDefSrc);
  note('1c-stable-tag', 'PASS',
    `all 145 defs have kind∈{fs,exec,meta,mcp} + deterministic membership; explicit per-def "profile" field present: ${hasProfileField}`,
    hasProfileField ? 'electron/agent/providers.ts:21-30' : 'electron/agent/providers.ts:21-30 (no profile field; tag derived from tool-defs.ts:2091,2116)');

  // 1d — every def reaches a REAL executor: "{}" must yield a non-empty,
  // non-"Unknown tool" answer (a missing case would say Unknown tool or crash).
  const broken = [];
  let dispatched = 0;
  for (const d of CORE_DEFS) {
    let res;
    try {
      res = await run(d.name);
    } catch (err) {
      broken.push(`${d.name}: THREW ${err.message} (electron/agent/tools.ts:1215 executeToolImpl)`);
      continue;
    }
    if (!res || typeof res.output !== 'string' || !res.output.length) {
      broken.push(`${d.name}: empty/missing output (electron/agent/tools.ts:1269 switch)`);
      continue;
    }
    if (/^Unknown tool:/.test(res.output)) {
      broken.push(`${d.name}: "${res.output}" (electron/agent/tools.ts:1224)`);
      continue;
    }
    dispatched++;
  }
  assert.equal(dispatched, 145, `only ${dispatched}/145 defs dispatched to a live executor`);
  assert.deepEqual(broken, [], `tools with missing/broken executors:\n${broken.join('\n')}`);
  note('1d-live-dispatch', 'PASS', `145/145 defs dispatched through executeTool — 0 Unknown tool, 0 crashes`,
    'electron/agent/tools.ts:1215,1222,1269');
});

// ============================================================
// 2. EXCLUDED-TOOL STILL EXECUTES BY NAME (no profile refusal)
// ============================================================
test('GUARD-2: a tool hidden from "essential" still executes by exact name — no profile refusal', async () => {
  // Use the ENGINE's advertised sets (getToolDefs), which is what a model sees.
  const engineFull = tools.getToolDefs([], 'full').map((d) => d.name);
  const essential = new Set(tools.getToolDefs([], 'essential').map((d) => d.name));
  const excluded = engineFull.filter((n) => !essential.has(n));
  assert.ok(excluded.length > 0, 'essential must exclude at least one real tool (otherwise the profile is meaningless)');

  // Static proof: executeTool resolves against the FULL registry (default
  // profile), NOT the advertised profile — no second profile argument here.
  const toolsSrc = src('electron/agent/tools.ts');
  assert.match(toolsSrc, /getToolDefs\(ctx\.mcpServers\)\.find\(\(d\) => d\.name === canonical\)/,
    'electron/agent/tools.ts:1222 must resolve calls against the full registry');
  assert.ok(!/getToolDefs\(ctx\.mcpServers,\s*['"]/.test(toolsSrc),
    'electron/agent/tools.ts: executeTool must NOT filter by profile');

  // Representative EXCLUDED tools across families: documents, debugger,
  // notebooks, media, LSP, PDF, office. All are real executors.
  const probes = ['pdf_make', 'debug_start', 'notebook_read', 'media_ffmpeg', 'lsp_hover', 'pptx_make', 'browser_console', 'preview_open']
    .filter((n) => excluded.includes(n) && engineFull.includes(n));
  assert.ok(probes.length >= 3, `need ≥3 excluded real tools to probe, got ${probes.length}`);

  const refusal = /(not available|not permitted|disabled|hidden|switch to|unavailable)[^\n]{0,48}profile|profile[^\n]{0,48}(not available|not permitted|disabled|hidden|switch to|unavailable)/i;
  const refusals = [];
  const dispatched = [];
  for (const name of probes) {
    let res;
    try {
      res = await run(name); // "{}" → live executor's own honest param error
    } catch (err) {
      refusals.push(`${name}: THREW ${err.message}`);
      continue;
    }
    const out = res && typeof res.output === 'string' ? res.output : '';
    if (!out.length) { refusals.push(`${name}: empty output`); continue; }
    if (/^Unknown tool:/.test(out)) { refusals.push(`${name}: ${out}`); continue; }
    if (refusal.test(out)) { refusals.push(`${name}: profile refusal — ${out.slice(0, 160)}`); continue; }
    dispatched.push(`${name} (excluded from essential → dispatched OK: ${out.slice(0, 80).replace(/\s+/g, ' ')})`);
  }
  assert.deepEqual(refusals, [], `profile/refusal regressions:\n${refusals.join('\n')}`);
  note('2-excluded-callable', 'PASS',
    `${dispatched.length}/${probes.length} excluded tools executed by exact name; 0 profile refusals; ${excluded.length} tools excluded from essential`,
    'electron/agent/tools.ts:1222 (full registry), tool-defs.ts:2143-2147');
  for (const d of dispatched) console.log(`        · ${d}`);
});

// ============================================================
// 3. ENGINE RESPECTS PROFILE; FULL = ALL 145 (dynamic + static)
// ============================================================
test('GUARD-3: engine advertises the selected profile; full = all 145; MCP always kept', () => {
  const counts = {};
  const sets = {};
  for (const p of PROFILES) {
    const defs = tools.getToolDefs([], p);
    counts[p] = defs.length;
    sets[p] = new Set(defs.map((d) => d.name));
  }
  findings.push({ id: '3-engine-counts', status: 'INFO', detail: counts, fileLine: 'tools.ts:1183-1210' });
  // Cross-check: the engine's advertised set MUST be exactly the set the
  // generator/defsForProfile report. A def injected only into getToolDefs()
  // (e.g. tools.ts:1189 PREVIEW_OPEN_DEF) is advertised to the model but is
  // invisible to gen-tool-inventory.mjs (it parses only tool-defs.ts:12,14).
  const phantom = [...sets.full].filter((n) => !fullNames.includes(n));
  const dropped = fullNames.filter((n) => !sets.full.has(n));
  if (counts.full !== 145 || phantom.length || dropped.length) {
    note('3-registry-drift', 'FAIL',
      `engine full=${counts.full} vs inventory/defsForProfile(full)=145; extra advertised=${JSON.stringify(phantom)}; missing from advertisement=${JSON.stringify(dropped)}`,
      'electron/agent/tools.ts:1189 (PREVIEW_OPEN_DEF push); scripts/gen-tool-inventory.mjs:12,14 (parses tool-defs.ts only)');
  }
  assert.equal(counts.full, 145,
    `getToolDefs([], "full")=${counts.full} but gen-tool-inventory/defsForProfile(full)=145; extra=${JSON.stringify(phantom)} missing=${JSON.stringify(dropped)} (electron/agent/tools.ts:1189; scripts/gen-tool-inventory.mjs:12,14)`);
  assert.deepEqual(phantom, [], `defs advertised by the engine but absent from the generated inventory: ${JSON.stringify(phantom)}`);
  assert.deepEqual(dropped, [], `inventory defs not advertised by the engine: ${JSON.stringify(dropped)}`);
  // v11.34 — verify the ENGINE actually selects a profile (not a literal
  // variable name). Use a specific model id so advertisedToolProfile() cannot
  // fall through to its default; accept any identifier that carries the value.
  const eng = readFileSync(join(ROOT, 'electron/agent/engine.ts'), 'utf8');
  assert.match(eng, /getToolDefs\(enabledMcp,\s*[A-Za-z_$][\w$]*\)/,
    'engine.ts must pass a computed profile variable to getToolDefs (behaviour, not a literal name)');
  assert.match(eng, /advertisedToolProfile|toolProfile/,
    'engine.ts must derive the advertised profile from the settings/model');
  assert.ok(counts.essential < counts.balanced && counts.balanced < counts.full,
    `profiles must be strictly nested: essential=${counts.essential}, balanced=${counts.balanced}, full=${counts.full}`);
  for (const n of sets.essential) assert.ok(sets.balanced.has(n) && sets.full.has(n), `${n}: not in balanced/full`);
  for (const n of sets.balanced) assert.ok(sets.full.has(n), `${n}: balanced ⊄ full`);

  // MCP tools are advertised in EVERY profile.
  const mcp = [{ server: { name: 'probe' }, tools: [{ name: 'echo', description: 'probe echo', inputSchema: { type: 'object', properties: {}, required: [] } }] }];
  for (const p of PROFILES) {
    const names = tools.getToolDefs(mcp, p).map((d) => d.name);
    assert.ok(names.includes('mcp__probe__echo'), `MCP tool dropped from profile ${p} (tool-defs.ts:2145/2147)`);
  }

  // Static: the engine passes cfg.toolProfile to getToolDefs (never hardcodes
  // 'full' for advertisement), and subagents inherit the parent profile.
  const engineSrc = src('electron/agent/engine.ts');
  // v11.34 — V3 changed the literal `cfg.toolProfile ?? 'balanced'` to a
  // computed `advertisedProfile` (weak-model聚焦). Assert the BEHAVIOUR: a
  // computed profile variable is passed, derived from settings/model.
  assert.match(engineSrc, /getToolDefs\(enabledMcp,\s*[A-Za-z_$][\w$]*\)/,
    'engine.ts must pass a computed profile variable to getToolDefs');
  assert.match(engineSrc, /advertisedToolProfile|toolProfile|advertisedProfile/,
    'engine.ts must derive the advertised profile from settings/model');
  const subSrc = src('electron/agent/subagentRunner.ts');
  // v11.36 (D1) — specialists now advertise the FULL registry via
  // subagentToolDefs() (founder's "I don't have the tools" fix). The old
  // inherited-profile allow-list was intentionally removed.
  assert.match(subSrc, /function subagentToolDefs\(\)/,
    'subagentRunner.ts must build the full tool set via subagentToolDefs()');
  assert.match(subSrc, /getToolDefs\(\[\], 'full'\)/,
    'subagentRunner.ts must use the full registry');

  note('3-engine-profile', 'PASS',
    `advertised counts: essential=${counts.essential}, balanced=${counts.balanced}, full=${counts.full}; MCP kept in all; engine passes cfg.toolProfile`,
    'electron/agent/engine.ts:2615; tools.ts:1183-1210; subagentRunner.ts:201-207');
});

// ============================================================
// 4. NO FIXED-SIZE TOOL TRUNCATION IN THE PROVIDER PATH
// ============================================================
test('GUARD-4: no tools.slice(0,N) truncation in the provider path', () => {
  const providerFiles = [
    'electron/agent/providers.ts',
    'electron/agent/engine.ts',
    'electron/agent/tools.ts',
    'electron/agent/subagentRunner.ts',
    'electron/agent/prompts.ts',
  ];
  const offenders = [];
  for (const f of providerFiles) {
    for (const { line, n } of withLines(src(f))) {
      // Any .slice( applied DIRECTLY to a TOOL-DEFINITION array variable.
      // (We must not flag `fatalErrorText.slice(0,200)` on a line that merely
      // also has a `tools:` property — the sliced expression is what matters.)
      if (/\b(tools|defs|toolDefs|CORE_DEFS)\s*\.\s*slice\s*\(/.test(line)) {
        offenders.push(`${f}:${n}: ${line.trim()}`);
      }
    }
  }
  // Legitimate, NON-truncating slices verified by reading the source. Match by
  // CODE FRAGMENT (line numbers drift as V3 lands), not by fixed line number:
  //  - "Available tools include:" / "Tools available to you:" slice a NAME LIST
  //    for PROMPT TEXT only — the full defs still go to the provider (engine.ts
  //    calls getToolDefs(enabledMcp, profile) with no slice).
  //  - "e.g. ${all.slice(0, 8)" is an unknown-tool error hint only.
  const safeFragments = [
    'Available tools include:',
    'Tools available to you:',
    'o.tools.slice(0, Math.min(40', // subagentRunner buildSubagentSystemPrompt name list
    'e.g. ${all.slice(0, 8)',
  ];
  const real = offenders.filter((o) => !safeFragments.some((frag) => o.includes(frag)));
  for (const o of offenders) {
    if (safeFragments.some((frag) => o.includes(frag))) {
      note('4-display-slice', 'INFO', 'name-list slice is PROMPT/HINT text only, not provider truncation', o.split(':').slice(0, 2).join(':'));
    }
  }
  assert.deepEqual(real, [], `fixed-size tool truncation found in provider path:\n${real.join('\n')}`);

  const provSrc = src('electron/agent/providers.ts');
  assert.match(provSrc, /obj\.tools\.splice\(index,\s*1\)/,
    'providers.ts:1791 must drop only ONE provider-rejected tool, never a fixed-size slice');
  assert.match(provSrc, /ONE tool — never a fixed-size slice/,
    'providers.ts:1791 anti-truncation comment must be intact');
  note('4-no-truncation', 'PASS',
    'no tools.slice(0,N) on any defs sent to the provider; only one-at-a-time splice on validation error',
    'electron/agent/providers.ts:1785-1797; engine.ts (getToolDefs call); engine.ts/subagentRunner.ts (prompt-only name lists)');
});

// ============================================================
// EVIDENCE + CLEANUP
// ============================================================
test('write evidence + cleanup', () => {
  const summary = {
    generatedAt: new Date().toISOString(),
    verdict: findings.every((f) => f.status !== 'FAIL') ? 'ALL-GUARDS-PASS' : 'FAILURES-PRESENT',
    counts: {
      inventory: JSON.parse(src('src/generated/toolInventory.json')).total,
      coreDefs: CORE_DEFS.length,
      fullProfile: fullDefs.length,
      essentialProfile: defsForProfile(CORE_DEFS, 'essential').length,
      balancedProfile: defsForProfile(CORE_DEFS, 'balanced').length,
    },
    findings,
  };
  writeFileSync(RESULTS, JSON.stringify(summary, null, 2));
  console.log(`V1134-VERDICT: ${summary.verdict} inventory=${summary.counts.inventory} full=${summary.counts.fullProfile} essential=${summary.counts.essentialProfile} balanced=${summary.counts.balancedProfile}`);
  rmSync(tmp, { recursive: true, force: true });
  assert.ok(true);
});
