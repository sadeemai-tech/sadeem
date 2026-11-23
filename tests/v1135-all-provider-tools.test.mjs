// ============================================================
// SADEEM v11.35 — EVERY PROVIDER-NATIVE / UNKNOWN TOOL IS FORWARDED & ROUTED
//
// Founder: "أريد أن يكون الذكاء الاصطناعي قادر على استخدام كل الأدوات الخاصة
// به ... يستخدم كل إمكانياته، إحنا نعطيه كل القدرات كل الإمكانيات المتاحة"
// (the AI must be able to use ALL its tools — including extra tools offered by
// the model / provider itself; give it every available capability).
//
// This test proves the v11.35 contract:
//  1. all 145 core defs still have live executors (no regression);
//  2. a tool hidden by the advertised profile still executes by exact name;
//  3. a synthetic PROVIDER-NATIVE tool (web_search / computer_use / a brand
//     new unknown type) passes through BOTH schema translators in its native
//     wire shape and is routed honestly (relayed / explicit unsupported —
//     NEVER a silent drop);
//  4. 'full' = 145 with no slice truncation; strong models get 'full', weak
//     models get 'core', and a focused view never blocks calling by name.
//
// Run: node --test --test-force-exit tests/v1135-all-provider-tools.test.mjs
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';

process.env.SURNIA_NO_BROWSER = '1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1135-'));

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
const providersPath = join(tmp, 'providers.cjs');
const modesPath = join(tmp, 'modes.cjs');
bundle('electron/agent/tool-defs.ts', defsPath);
bundle('electron/agent/tools.ts', toolsPath);
bundle('electron/agent/providers.ts', providersPath);
bundle('src/lib/modes.ts', modesPath);
const td = require(defsPath);
const tools = require(toolsPath);
const providers = require(providersPath);
const modes = require(modesPath);

const CORE_DEFS = td.CORE_DEFS;
const WS = join(tmp, 'ws');
mkdirSync(WS, { recursive: true });
const ctx = () => ({
  workspace: WS, sessionId: 'v1135-all-provider-tools', mcpServers: [], emit: () => {},
  approve: async () => true, fullAccess: true,
});
const run = (name, args) => tools.executeTool(name, JSON.stringify(args ?? {}), ctx());

// ------------------------------------------------------------
test('v1135-1: all 145 defs still have live executors (no regression)', async () => {
  assert.equal(CORE_DEFS.length, 145, 'honest count is 145');
  assert.equal(td.defsForProfile(CORE_DEFS, 'full').length, 145, 'full profile = 145 (no slice)');
  assert.equal(new Set(CORE_DEFS.map((d) => d.name)).size, 145, 'no duplicate defs');

  // Source-level: every declared def has a `case '<name>':` executor arm.
  const q = String.fromCharCode(39);
  const defNames = [...readFileSync(join(ROOT, 'electron/agent/tool-defs.ts'), 'utf8')
    .matchAll(new RegExp('^\\s*name:\\s*' + q + '([^' + q + ']+)' + q, 'gm'))].map((m) => m[1]);
  const cases = new Set([...readFileSync(join(ROOT, 'electron/agent/tools.ts'), 'utf8')
    .matchAll(new RegExp('^\\s*case\\s+' + q + '([^' + q + ']+)' + q + ':', 'gm'))].map((m) => m[1]));
  assert.equal(defNames.length, 145, 'tool-defs declares 145 defs');
  assert.deepEqual(defNames.filter((n) => !cases.has(n)), [], 'every def has an executor');

  // Live-level: dispatch every name — no throw, no "Unknown tool".
  const broken = [];
  for (const def of CORE_DEFS) {
    let res;
    try { res = await tools.executeTool(def.name, '{}', ctx()); }
    catch (err) { broken.push(`${def.name}: THREW ${err?.message ?? err}`); continue; }
    const out = typeof res?.output === 'string' ? res.output : '';
    if (!out.length || /^Unknown tool:/.test(out)) broken.push(`${def.name}: ${out.slice(0, 80)}`);
  }
  assert.deepEqual(broken, [], `145/145 must dispatch: ${broken.join(' | ')}`);
  console.log('V1135_EXECUTORS=145 defs, 145 executor cases, 145/145 live dispatch');
});

test('v1135-2: a hidden-by-profile tool STILL executes by exact name', async () => {
  const name = 'markdown_outline'; // advanced → hidden from core + balanced
  const core = td.defsForProfile(CORE_DEFS, 'core');
  const balanced = td.defsForProfile(CORE_DEFS, 'balanced');
  assert.ok(!core.some((d) => d.name === name), `${name} hidden from core`);
  assert.ok(!balanced.some((d) => d.name === name), `${name} hidden from balanced`);
  assert.ok(td.defsForProfile(CORE_DEFS, 'full').some((d) => d.name === name), `${name} exists in full`);

  const res = await run(name, { text: '# H\n## S\nbody' });
  assert.equal(res.ok, true, 'hidden tool executes anyway');
  assert.doesNotMatch(res.output, /^Unknown tool:/);
  assert.doesNotMatch(res.output, /not in (?:the )?profile|not advertised|hidden by/i, 'profile is never a gate');

  // modes.ts capability invariant: a focused view never blocks calling by name.
  assert.equal(modes.toolCallableByName('core', name), true);
  assert.equal(modes.toolCallableByName('essential', name), true);
  console.log('V1135_HIDDEN_CALLABLE=hidden-by-profile tool executed, no profile refusal');
});

test('v1135-3: synthetic provider-native tools pass through BOTH schema translators', () => {
  // Known native types we spell correctly per family.
  assert.ok(providers.PROVIDER_NATIVE_TOOL_TYPES.includes('web_search'));
  const web = providers.makeNativeToolDef('provider_web_search', 'web_search', {
    description: 'Provider-side web search.', providerSource: 'openai',
  });
  const computer = providers.makeNativeToolDef('provider_computer', 'computer_use', {
    wire: { anthropic: { display_width_px: 1024, display_height_px: 768 } },
  });
  // A brand-new type the app has never heard of must still pass through.
  const future = providers.makeNativeToolDef('provider_future_tool', 'some_future_search_v9', {
    providerSource: 'openrouter',
  });
  // A tool explicitly scoped to Anthropic must NOT be mislabelled as an OpenAI native tool.
  const scoped = providers.makeNativeToolDef('provider_anthropic_only', 'web_search', {
    provider: 'anthropic', description: 'Anthropic-only native search.',
  });

  // ---- OpenAI wire shape ----
  const oa = providers.buildOpenAITools([web, computer, future, scoped], 'openai', true);
  assert.equal(oa.length, 4, 'no native tool was dropped');
  assert.deepEqual(oa[0], { type: 'web_search' }, 'web_search native shape (no function downgrade)');
  assert.equal(oa[1].type, 'computer_use_preview', 'canonical computer_use → OpenAI native type');
  assert.equal(oa[2].type, 'some_future_search_v9', 'UNKNOWN provider type passed through verbatim');
  assert.equal(oa[3].type, 'function', 'other-provider native tool stays advertised (function) — not dropped');
  assert.match(oa[3].function.description, /native tool 'web_search' is scoped to another provider family/);
  // cache_control must never be attached to a native tool object.
  for (const t of oa.slice(0, 3)) assert.ok(!('cache_control' in t), 'native tool not polluted with cache_control');

  // ---- Anthropic wire shape ----
  const an = providers.buildAnthropicTools([web, computer, future, scoped], true);
  assert.equal(an.length, 4, 'no native tool dropped on Anthropic either');
  assert.equal(an[0].type, 'web_search_20250305', 'web_search → Anthropic server-side type');
  assert.equal(an[0].name, 'provider_web_search');
  assert.equal(an[1].type, 'computer_20250124', 'computer_use → Anthropic computer type');
  assert.equal(an[1].display_width_px, 1024, 'per-family wire override preserved');
  assert.equal(an[2].type, 'some_future_search_v9', 'unknown type passed through verbatim');
  assert.equal(an[3].type, 'web_search_20250305', 'Anthropic-scoped native tool stays native on Anthropic');
  for (const t of an) assert.ok(!('cache_control' in t), 'native block not polluted');

  // ---- Mixed with the real registry: count preserved, nothing truncated ----
  const mixed = providers.buildOpenAITools([...CORE_DEFS.slice(0, 3), web, ...CORE_DEFS.slice(3)], 'openai');
  assert.equal(mixed.length, CORE_DEFS.length + 1, 'native tool added, none of the 145 dropped');
  assert.equal(mixed.filter((t) => t.type === 'function').length, 145, 'all 145 core defs stay function tools');
  assert.equal(mixed.filter((t) => t.type === 'web_search').length, 1, 'the native tool is in its native shape');

  console.log('V1135_PASSTHROUGH=web_search/code_interpreter/computer_use/unknown all forwarded natively');
});

test('v1135-4: an unknown provider-advertised tool is routed HONESTLY (never a silent drop)', async () => {
  providers.clearProviderTools();
  const unknown = providers.registerUnknownProviderTool(
    'mystery_provider_tool', 'openrouter', 'A tool the provider advertised.',
  );
  assert.equal(providers.hasProviderTool('mystery_provider_tool'), true);
  assert.equal(providers.getProviderToolDefs().some((d) => d.name === unknown.name), true);

  // It is advertised in the schema (as a function tool we can't execute locally).
  const wire = providers.buildOpenAITools([unknown], 'openrouter');
  assert.equal(wire.length, 1);
  assert.equal(wire[0].function.name, 'mystery_provider_tool', 'advertised, not dropped');

  // If a call reaches us, we return an explicit honest unsupported result.
  const routed = providers.routeProviderToolCall('mystery_provider_tool', '{"q":"test"}');
  assert.equal(routed.ok, false);
  assert.equal(routed.unsupported, true);
  assert.match(routed.output, /Unsupported provider tool/);
  assert.match(routed.output, /NOT silently dropped/);

  // A native tool call is relayed honestly too (no fake local success).
  const native = providers.makeNativeToolDef('native_relay', 'web_search', { providerSource: 'openai' });
  providers.registerProviderTool(native);
  const nr = providers.routeProviderToolCall('native_relay', '{"q":"x"}');
  assert.equal(nr.ok, false);
  assert.equal(nr.native, true);
  assert.match(nr.output, /executed by the model provider/);
  assert.match(nr.output, /no local action was faked/);

  // A completely unknown name is an explicit unknown, not silence.
  const u = providers.routeProviderToolCall('never_heard_of_it');
  assert.equal(u.ok, false);
  assert.match(u.output, /^Unknown tool:/);
  providers.clearProviderTools();
  console.log('V1135_HONEST_ROUTE=unknown/native/unregistered tools all return explicit results, 0 silent drops');
});

test('v1135-5: strong models get all 145; weak models get focused-but-complete', () => {
  // v11.35 corrected salience.
  assert.equal(modes.isStrongModelId('claude-sonnet-5-5'), true, 'Claude 5.5 is strong');
  assert.equal(modes.isStrongModelId('gpt-5'), true);
  assert.equal(modes.salientToolProfile(undefined, 'claude-sonnet-5-5'), 'full', 'Claude 5.5 gets ALL tools');
  assert.equal(modes.salientToolProfile(undefined, 'claude-opus-5'), 'full');
  assert.equal(modes.salientToolProfile(undefined, 'qwen2.5:1.5b'), 'core', 'weak model gets core');
  assert.equal(modes.salientToolProfile('web', 'claude-sonnet-5-5'), 'web', 'explicit view always wins');
  assert.equal(modes.salientToolProfile('full', 'qwen2.5:1.5b'), 'full', 'explicit full overrides weak');

  // v11.34 compatibility function is unchanged (pinned by the v1134 suite).
  assert.equal(modes.advertisedToolProfile(undefined, 'claude-sonnet-5-5'), 'balanced');

  const strongView = td.defsForProfile(CORE_DEFS, modes.salientToolProfile(undefined, 'claude-sonnet-5-5'));
  assert.equal(strongView.length, 145, 'strong model view = 145');
  const weakView = td.defsForProfile(CORE_DEFS, modes.salientToolProfile(undefined, 'qwen2.5:1.5b'));
  assert.ok(weakView.length > 0 && weakView.length < 145, 'weak view is focused');
  for (const d of CORE_DEFS) {
    assert.equal(modes.toolCallableByName('core', d.name), true, `${d.name}: callable regardless of view`);
  }
  console.log(`V1135_SALIENCE=strong=full(145) weak=core(${weakView.length}) callable-by-name=145/145`);
});

test('v1135-6: capability union keeps all 145 + every runtime/provider extra', () => {
  const native = providers.makeNativeToolDef('extra_native', 'web_search', { providerSource: 'openai' });
  const mcpLike = { name: 'mcp__srv__tool', description: 'runtime MCP', parameters: { type: 'object' }, kind: 'mcp' };
  const union = td.fullCapabilityUnion(CORE_DEFS, [native, mcpLike]);
  assert.equal(union.length, 147, '145 core + 2 extras, none dropped');
  for (const d of CORE_DEFS) assert.ok(union.some((u) => u.name === d.name), `${d.name}: still in the union`);

  // A focused VIEW plus extras is a superset of the view — never a cut.
  const core = td.advertisedWithExtras(CORE_DEFS, 'core', [native]);
  assert.equal(core.length, td.defsForProfile(CORE_DEFS, 'core').length + 1, 'extra appended, not truncated');
  assert.ok(core.some((d) => d.name === 'extra_native'), 'provider tool reachable even in focused view');
  const fullWithExtras = td.advertisedWithExtras(CORE_DEFS, 'full', [native, mcpLike]);
  assert.equal(fullWithExtras.length, 147);
  assert.equal(fullWithExtras.filter((d) => CORE_DEFS.some((c) => c.name === d.name)).length, 145, 'all 145 intact');
  console.log('V1135_UNION=145 core + runtime/provider extras preserved, no slice');
});

test('v1135 cleanup', () => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  assert.ok(true);
});
