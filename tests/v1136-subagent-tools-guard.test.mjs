// ============================================================
// SADEEM v11.36 — SUBAGENT TOOLS GUARD (D1 verification)
// DIAGNOSIS + TEST ONLY. No app source is modified by this file.
//
// The founder's complaint: "the subagent says I don't have the tools".
// D1 removes the cause: every specialist now has the FULL registry
// (145 core + MCP + provider-native tools) with NO allow-list filter
// and NO profile slice; V3 profiles stay a per-turn VIEW for weak
// models only, never a capability/dispatch gate.
//
// This guard bundles the REAL agents.ts + subagentRunner.ts with esbuild
// (same recipe as v1134-tools-guard / v1119-subagents) and verifies:
//   1. All 16 specialists have tools === '*' (or full-equivalent); no
//      [...FS_READ] / [...WEB] subsets remain.
//   2. Each specialist's advertised defs = all 145 registry tools
//      (+ MCP/provider extras), for EVERY agent, not a filtered slice.
//   3. A restricted-former agent (old agents.ts:63 'explore', FS_READ)
//      can call an advanced tool by exact name with no "not allowed"
//      refusal (and the system prompt never claims a missing capability).
//   4. No tools.slice / spec.tools capability cut in the subagent path;
//      V3 profiles remain view-only (hidden tools still dispatch).
//   5. System prompts remain distinct per agent (personality preserved);
//      only the tool restriction was removed.
//
// Run: node --test --test-force-exit tests/v1136-subagent-tools-guard.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESBUILD_NODE, ESBUILD_BIN } from './_esbuild-bin.mjs';

process.env.SURNIA_NO_BROWSER = '1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1136-guard-'));
const RESULTS = join(ROOT, 'tests', '.v1136-subagent-tools-guard.results.json');
const findings = []; // { id, status, detail, fileLine }
const note = (id, status, detail, fileLine) => {
  findings.push({ id, status, detail, fileLine });
  console.log(`[${status}] ${id} — ${fileLine} — ${detail}`);
};

// ---------- source helpers (exact file:line evidence, even if code shifts) ----------
const src = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const live = (rel) => src(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const lineOf = (rel, re) => {
  const i = src(rel).split(/\r?\n/).findIndex((l) => re.test(l));
  return i < 0 ? `${rel}:?` : `${rel}:${i + 1}`;
};

// ---------- electron stub for plain-Node execution ----------
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(
  join(stubDir, 'index.js'),
  `const paths = { temp: ${JSON.stringify(tmp)}, userData: ${JSON.stringify(join(tmp, 'ud'))}, home: ${JSON.stringify(tmp)}, appData: ${JSON.stringify(tmp)} };
   class StubWebContents { on() {} async executeJavaScript() { return []; } }
   class StubBrowserWindow { constructor() { this.webContents = new StubWebContents(); } destroy() {} setBounds() {} getBounds() { return { x: 0, y: 0 }; } }
   StubBrowserWindow.getAllWindows = () => [];
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

// ---------- esbuild bundling recipe (established in this repo) ----------
function bundle(entry, out, external = []) {
  execFileSync(
    ESBUILD_NODE,
    [ESBUILD_BIN, entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
      '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
      '--external:monaco-editor', '--external:@monaco-editor/react',
      ...external.map((e) => `--external:${e}`), '--log-level=error'],
    { cwd: ROOT, timeout: 120000, stdio: 'pipe' },
  );
}

// A provider-natural extra, so we can prove provider tools survive the union.
const PROVIDER_EXTRA = { name: 'provider_native_probe', description: 'probe', parameters: { type: 'object', properties: {} } };

// Stub providers.js — RESOLVED by the externalized `require('./providers')` from
// the runner bundle. Captures the EXACT advertised defs + system prompt the real
// runStandaloneSubagent hands to streamTurn, and can simulate a tool call.
const providerStubPath = join(tmp, 'providers.js');
writeFileSync(providerStubPath, `
exports.__captures = [];
exports.__callAdvanced = false;
exports.getProviderToolDefs = () => [${JSON.stringify(PROVIDER_EXTRA)}];
exports.streamTurn = async (o) => {
  exports.__captures.push({
    system: o.system || '',
    tools: (o.tools || []).map((d) => d.name),
    messages: o.messages || [],
  });
  if (exports.__callAdvanced && o.messages.length === 1) {
    o.onToolUse('adv-probe', 'media_ffmpeg', '{}');
    return { stopReason: 'tool_use' };
  }
  o.onText('OK');
  return { stopReason: 'stop' };
};
`);
const providerStub = require(providerStubPath);

// Bundle the REAL source under test.
const agentsMod = require((() => { const p = join(tmp, 'agents.cjs'); bundle('electron/agent/agents.ts', p); return p; })());
const runner = require((() => {
  const p = join(tmp, 'subagentRunner.cjs');
  bundle('electron/agent/subagentRunner.ts', p, ['./providers']);
  return p;
})());
const defsMod = require((() => { const p = join(tmp, 'tool-defs.cjs'); bundle('electron/agent/tool-defs.ts', p); return p; })());
const toolsMod = require((() => { const p = join(tmp, 'tools.cjs'); bundle('electron/agent/tools.ts', p); return p; })());

const { AGENTS } = agentsMod;
const { CORE_DEFS, defsForProfile, ADVANCED_TOOL_NAMES } = defsMod;
const coreNames = CORE_DEFS.map((d) => d.name);
const coreSet = new Set(coreNames);

// Build a record + hooks for the real standalone loop (settings() resolves the
// app default model from the stubbed storeService; the stub provider no-ops it).
function recordFor(role) {
  return {
    id: `v1136-${role}`, label: role, role, description: 'probe', prompt: 'probe',
    status: 'running', done: 0, total: 12, startedAt: Date.now(),
    workspace: tmp, sessionId: 'v1136', background: false, attempt: 0,
  };
}
const hooksFor = () => ({ progress() {}, emit() {}, timeoutMs: 20000 });
async function runAgent(role) {
  providerStub.__captures.length = 0;
  providerStub.__callAdvanced = false;
  await runner.runStandaloneSubagent(recordFor(role), hooksFor());
  return providerStub.__captures.slice();
}

// ============================================================
// 1. ALL 16 SPECIALISTS: tools === '*' (NO SUBSETS REMAIN)
// ============================================================
test('CHECK-1: all 16 specialists have tools === "*" (or full-equivalent); no FS_READ/WEB subsets', () => {
  assert.equal(AGENTS.length, 16, 'electron/agent/agents.ts must advertise 16 specialists');
  const restricted = AGENTS.filter((a) => a.tools !== '*');
  assert.equal(
    restricted.length, 0,
    `restricted specialists remain: ${restricted.map((a) => `${a.id}=${JSON.stringify(a.tools)}`).join(', ')}`,
  );
  // Source-level: the subset constants and their spreads are gone from live code.
  const liveSrc = live('electron/agent/agents.ts');
  assert.doesNotMatch(liveSrc, /\b(?:FS_READ|WEB)\b/, 'no FS_READ / WEB allow-list constants remain');
  assert.doesNotMatch(liveSrc, /tools\s*:\s*\[/, 'no array-literal tools allow-list remains');
  const starCount = (src('electron/agent/agents.ts').match(/tools:\s*'\*'/g) || []).length;
  assert.equal(starCount, 16, 'exactly 16 tools: "*" declarations');
  note('1-all-specialists-full', 'PASS',
    `16/16 specialists tools='*'; 0 restricted; no FS_READ/WEB subsets`,
    lineOf('electron/agent/agents.ts', /export const AGENTS/));
});

// ============================================================
// 2. ADVERTISED DEFS = FULL 145 + MCP/PROVIDER EXTRAS, PER AGENT
// ============================================================
test('CHECK-2: every specialist advertises the full registry (145 core + provider/MCP extras)', async () => {
  // The shared union helper resolves 145 core + provider extras, deduped.
  const defs = runner.subagentToolDefs();
  const names = defs.map((d) => d.name);
  assert.equal(new Set(names).size, names.length, 'subagentToolDefs has no duplicate names');
  for (const n of coreNames) assert.ok(names.includes(n), `core tool missing from subagentToolDefs: ${n}`);
  assert.ok(names.includes(PROVIDER_EXTRA.name), 'provider-native extra survives the union');
  assert.equal(defs.length, coreNames.length + 1, 'union = 145 core + 1 provider extra');
  note('2a-union-helper', 'PASS',
    `subagentToolDefs()=${defs.length} (145 core + 1 provider extra), advanced=${ADVANCED_TOOL_NAMES.size} available`,
    lineOf('electron/agent/subagentRunner.ts', /export function subagentToolDefs/));

  // Real loop, EVERY specialist: streamTurn must receive the full union.
  for (const a of AGENTS) {
    const caps = await runAgent(a.id);
    assert.ok(caps.length >= 1, `${a.id}: expected at least 1 streamTurn call`);
    const advertised = caps[0].tools;
    assert.equal(advertised.length, defs.length, `${a.id}: advertised ${advertised.length}, expected ${defs.length}`);
    assert.deepEqual([...advertised].sort(), [...names].sort(), `${a.id}: advertised defs are a filtered slice`);
    assert.ok(advertised.includes('media_ffmpeg'), `${a.id}: advanced tool not advertised`);
    assert.ok(advertised.includes(PROVIDER_EXTRA.name), `${a.id}: provider tool not advertised`);
  }
  note('2b-all-agents-advertise-full', 'PASS',
    `all 16 specialists advertise ${defs.length} defs (not a filtered slice)`,
    lineOf('electron/agent/subagentRunner.ts', /tools: defs/));
});

// ============================================================
// 3. FORMERLY-RESTRICTED AGENT CAN CALL AN ADVANCED TOOL BY NAME
// ============================================================
test('CHECK-3: formerly FS_READ-only "explore" calls an advanced tool by name — no "not allowed" refusal', async () => {
  // The old agents.ts:63 agent was `tools: [...FS_READ]`. It is now '*'.
  const explore = AGENTS.find((a) => a.id === 'explore');
  assert.ok(explore, 'explore specialist exists');
  assert.equal(explore.tools, '*', 'explore is no longer restricted to FS_READ');
  assert.doesNotMatch(explore.prompt, /never modify files/i, 'old read-only wording removed from explore prompt');

  providerStub.__captures.length = 0;
  providerStub.__callAdvanced = true;
  const result = await runner.runStandaloneSubagent(recordFor('explore'), hooksFor());
  providerStub.__callAdvanced = false;
  const caps = providerStub.__captures;
  assert.ok(caps.length >= 2, 'runner executed the simulated advanced-tool call then stopped');
  assert.ok(caps[0].tools.includes('media_ffmpeg'), 'advanced tool is advertised to explore');

  const system = caps[0].system;
  assert.match(system, /FULLY CAPABLE/, 'capability contract present');
  assert.match(system, /NEVER say[^\n]*I don't have the tools/, 'prompt forbids "I don\'t have the tools"');
  assert.match(system, /per-turn VIEW for weak models ONLY/, 'profile declared a view, not a gate');
  assert.doesNotMatch(system, /no tools available to this specialist/, 'no empty-toolset claim');
  assert.doesNotMatch(system, /read-only specialist/i, 'no read-only specialist claim');

  // The tool_result that came back from executeTool must NOT be a capability refusal.
  const toolResult = caps.slice(1).flatMap((c) => c.messages).find((m) => m.role === 'tool_result' && m.callId === 'adv-probe');
  assert.ok(toolResult, 'advanced tool produced a real tool_result (it was dispatched by name)');
  assert.doesNotMatch(
    toolResult.content,
    /not allowed|not permitted|don't have|do not have|unknown tool|blocked:|permission denied|not available to this specialist/i,
    'no "not allowed" / capability refusal from the dispatch path',
  );
  assert.equal(result, 'OK', 'subagent completed with the advanced tool call handled');
  note('3-advanced-tool-by-name', 'PASS',
    `explore (ex-FS_READ) advertised + dispatched media_ffmpeg; tool_result="${toolResult.content.slice(0, 60)}…"; no refusal`,
    `${lineOf('electron/agent/agents.ts', /id: 'explore'/)}, ${lineOf('electron/agent/subagentRunner.ts', /tools: defs/)}`);
});

// ============================================================
// 4. NO SLICE / CAPABILITY CUT; V3 PROFILES REMAIN VIEW-ONLY
// ============================================================
test('CHECK-4: no tools.slice / spec.tools cut in subagent path; V3 profiles stay view-only', async () => {
  const liveSrc = live('electron/agent/subagentRunner.ts');
  assert.doesNotMatch(liveSrc, /spec\.tools/, 'no spec.tools allow-list in the live subagent path');
  assert.doesNotMatch(liveSrc, /\b(?:defs|allowed|tools)\s*\.\s*slice\s*\(/, 'no fixed-size tools/defs slice');
  assert.doesNotMatch(liveSrc, /\.filter\s*\([^)]*\.includes\s*\(/, 'no capability filter on the advertised defs');
  assert.match(liveSrc, /getToolDefs\(\[\],\s*'full'\)/, 'full registry is the advertised source');
  assert.match(liveSrc, /getProviderToolDefs\(\)/, 'provider extras are included');
  assert.match(liveSrc, /per-turn VIEW/, 'profile is documented as a view-only hint');
  assert.match(liveSrc, /subagentToolDefs\(\)/, 'shared full-registry helper drives prompt + dispatch');

  // V3 profiles: 'full' = 145, 'balanced' hides advanced tools, and the hidden
  // tool STILL executes by name (a profile is a view, never a dispatch gate).
  assert.equal(defsForProfile(CORE_DEFS, 'full').length, 145, 'full profile = 145 core defs');
  const balancedNames = new Set(defsForProfile(CORE_DEFS, 'balanced').map((d) => d.name));
  assert.ok(ADVANCED_TOOL_NAMES.has('media_ffmpeg'), 'media_ffmpeg is an advanced (hidden-from-balanced) tool');
  assert.ok(!balancedNames.has('media_ffmpeg'), 'balanced view hides the advanced tool');
  const ctx = { workspace: tmp, sessionId: 'v1136', mcpServers: [], emit() {}, approve: async () => true, fullAccess: true };
  const out = await toolsMod.executeTool('media_ffmpeg', '{}', ctx);
  assert.ok(out && typeof out.output === 'string', 'executeTool resolved the hidden tool by exact name');
  assert.doesNotMatch(out.output, /unknown tool|not allowed|not permitted/i, 'profile view never hard-blocks dispatch');
  note('4-no-cut-profiles-view-only', 'PASS',
    `no spec.tools/slice cut; full=145; balanced hides media_ffmpeg yet executeTool('media_ffmpeg') still dispatches`,
    `${lineOf('electron/agent/subagentRunner.ts', /export function subagentToolDefs/)}, ${lineOf('electron/agent/tool-defs.ts', /export function defsForProfile/)}`);
});

// ============================================================
// 5. PERSONALITY PRESERVED — DISTINCT SYSTEM PROMPTS
// ============================================================
test('CHECK-5: system prompts remain distinct per agent (personality preserved)', () => {
  const prompts = [];
  for (const a of AGENTS) {
    const sys = runner.buildSubagentSystemPrompt({
      name: a.name, prompt: a.prompt, tools: coreNames, profile: 'balanced', workspace: tmp,
    });
    assert.ok(a.prompt.length > 40, `${a.id}: role prompt still substantive`);
    assert.ok(sys.includes(a.name), `${a.id}: name present in system prompt`);
    assert.ok(sys.includes(a.prompt), `${a.id}: full role prompt embedded verbatim`);
    assert.match(sys, /FULLY CAPABLE/, `${a.id}: capability contract present`);
    prompts.push(sys);
  }
  assert.equal(new Set(prompts).size, 16, 'all 16 system prompts are pairwise distinct');
  note('5-distinct-personalities', 'PASS',
    `16/16 system prompts distinct, each embeds its verbatim role prompt; only the tool restriction changed`,
    lineOf('electron/agent/agents.ts', /export const AGENTS/));
});

after(() => {
  writeFileSync(RESULTS, JSON.stringify({
    version: 'v11.36', guard: 'subagent-tools', at: new Date().toISOString(),
    summary: {
      pass: findings.filter((f) => f.status === 'PASS').length,
      fail: findings.filter((f) => f.status === 'FAIL').length,
    },
    findings,
  }, null, 2));
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});
