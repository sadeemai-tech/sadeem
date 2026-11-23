// ============================================================
// SADEEM v11.36 — EVERY SUBAGENT HAS THE FULL TOOL REGISTRY
//
// Founder's #1 complaint: "الوكيل بيحكي لا يملك الأدوات ... لازم تكون
// قدراته نفس القدرات تبعت الذكاء الاصطناعي العادي ... حرفيا". When a task
// was delegated to a specialist it replied "I don't have the tools" because
// ~8 agents were restricted to FS_READ / WEB subsets and the detached runner
// filtered `getToolDefs([], profile)` by `spec.tools`.
//
// v11.36 contract proven here:
//   1. all 16 specialists exist and EVERY one has tools === '*';
//   2. subagentToolDefs() = the full 145-core registry + provider-native
//      extras, with no slice/truncation and no duplicate names;
//   3. each specialist's system prompt advertises ALL of them (no 40-cut)
//      and keeps its distinct personality/role;
//   4. advanced tools (image_generate / browser_navigate / markdown_outline)
//      dispatch BY NAME for every specialist — never "not allowed",
//      "not in profile" or "Unknown tool";
//   5. source guards: no `spec.tools` filter, no profile slice, no slice(40).
//
// Run: node --test --test-force-exit tests/v1136-subagent-tools.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Honest headless posture: device/browser tools refuse cleanly instead of
// trying to open an Electron window (never an "Unknown tool" refusal).
process.env.SURNIA_NO_BROWSER = '1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1136-'));
const ud = join(tmp, 'ud');
mkdirSync(ud, { recursive: true });
const WS = join(tmp, 'ws');
mkdirSync(WS, { recursive: true });

// Minimal Electron stub so the esbuild graph loads in plain Node.
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `const p = ${JSON.stringify(ud)}; module.exports = {
  app: { getPath: () => p, isReady: () => true, whenReady: async () => {}, on() {}, quit() {} },
  ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
  BrowserWindow: { getAllWindows: () => [] }, Notification: { isSupported: () => false },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder: () => {} },
  clipboard: { readText: () => '', writeText() {}, readImage: () => ({ isEmpty: () => true }) },
};`);

// ONE bundle for all modules so the provider-tool registry is shared between
// subagentToolDefs() and the test's provider registration.
const BUNDLE = join(ROOT, 'tests', '.v1136.bundle.cjs');
esbuild.buildSync({
  stdin: {
    contents: [
      "export { AGENTS, getAgent } from './electron/agent/agents';",
      "export { subagentToolDefs, buildSubagentSystemPrompt, toolProfileOf } from './electron/agent/subagentRunner';",
      "export { executeTool, getToolDefs } from './electron/agent/tools';",
      "export { CORE_DEFS, defsForProfile } from './electron/agent/tool-defs';",
      "export * as providers from './electron/agent/providers';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
    sourcefile: 'v1136-entry.ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: BUNDLE,
  external: ['electron', '@xterm/xterm', '@xterm/addon-fit', 'monaco-editor', '@monaco-editor/react'],
  logLevel: 'silent',
});
const m = require(BUNDLE);

const ADVANCED = ['image_generate', 'browser_navigate', 'markdown_outline', 'web_search', 'run_command', 'write_file'];
const NOT_ALLOWED = /^Unknown tool:|not allowed|not in (?:the )?profile|not advertised|hidden by|tool (?:is )?restricted/i;
const ctx = () => ({
  workspace: WS,
  sessionId: 'v1136-subagent-tools',
  mcpServers: [],
  emit: () => {},
  // Fail closed: no approval-gated action actually executes in the test,
  // but the tool STILL resolves by name and returns an honest refusal.
  approve: async () => false,
  fullAccess: false,
});

// ------------------------------------------------------------
test('v1136-1: all 16 specialists exist and every one has FULL tools', () => {
  assert.equal(m.AGENTS.length, 16, 'the roster has all 16 specialists');
  const expected = [
    'data', 'debugger', 'perf', 'explore', 'web-research', 'spec', 'architect', 'implement',
    'devops', 'docs', 'test', 'review', 'refactor', 'security', 'skill-writer', 'general',
  ];
  assert.deepEqual([...m.AGENTS.map((a) => a.id)].sort(), [...expected].sort(), 'exact 16 ids');
  assert.equal(new Set(m.AGENTS.map((a) => a.name)).size, 16, 'distinct names');
  assert.equal(new Set(m.AGENTS.map((a) => a.prompt)).size, 16, 'distinct personalities/roles preserved');

  for (const a of m.AGENTS) {
    assert.equal(a.tools, '*', `${a.id}: full registry, no FS_READ/WEB subset`);
  }
  assert.equal(m.getAgent('explore').tools, '*', 'research agent is full-capability');
  assert.equal(m.getAgent('review').tools, '*', 'review agent is full-capability');
  assert.equal(m.getAgent('does-not-exist').tools, '*', 'fallback general agent is full-capability');

  // Source guard: the old subset arrays are gone from the roster.
  const agentsSrc = src('electron/agent/agents.ts');
  assert.doesNotMatch(agentsSrc, /const FS_READ\s*=/, 'no FS_READ subset');
  assert.doesNotMatch(agentsSrc, /const WEB\s*=/, 'no WEB subset');
  assert.match(agentsSrc, /NOT by capability/i, 'honest note: role/prompt only');
  console.log(`V1136_ROSTER=16 specialists, 16 full '*' toolsets, 16 distinct prompts`);
});

test('v1136-2: subagentToolDefs = full 145 registry + provider extras, no slice/dupes', () => {
  m.providers.clearProviderTools();
  const defs = m.subagentToolDefs();
  const names = defs.map((d) => d.name);

  assert.equal(defs.length, 145, 'advertised tools[] = full registry (145), no slice');
  assert.equal(new Set(names).size, names.length, 'no duplicate advertised tools');
  for (const d of m.CORE_DEFS) {
    assert.ok(names.includes(d.name), `${d.name}: reachable in the subagent view`);
  }
  for (const n of ADVANCED) {
    assert.ok(names.includes(n), `${n}: advanced tool advertised to every specialist`);
  }
  assert.ok(names.includes('task') && names.includes('todo_write'), 'no capability is silently withheld');

  // Provider-native tools are appended (same union as the main AI in engine.ts).
  const extra = m.providers.registerProviderTool({
    name: 'v1136_provider_native_tool',
    description: 'Synthetic provider-native tool for the v1136 test.',
    parameters: { type: 'object' },
  });
  const withExtra = m.subagentToolDefs();
  assert.equal(withExtra.length, 146, 'provider tool added, none of the 145 dropped');
  assert.ok(withExtra.some((d) => d.name === extra.name), 'provider-native tool advertised to subagents');
  m.providers.clearProviderTools();
  assert.equal(m.subagentToolDefs().length, 145, 'registry restored after cleanup');
  console.log('V1136_REGISTRY=145 core + provider extras, 0 slices, 0 duplicates');
});

test('v1136-3: every specialist prompt advertises ALL tools, no 40-tool truncation', () => {
  const names = m.subagentToolDefs().map((d) => d.name);
  for (const a of m.AGENTS) {
    const sys = m.buildSubagentSystemPrompt({
      name: a.name, prompt: a.prompt, tools: names, profile: 'balanced', workspace: WS,
    });
    assert.match(sys, new RegExp(`Tools available to you \\(${names.length}\\)`), `${a.id}: full count advertised`);
    for (const n of ADVANCED) {
      assert.ok(sys.includes(n), `${a.id}: ${n} visible in system prompt`);
    }
    for (const n of names) {
      assert.ok(sys.includes(n), `${a.id}: ${n} visible (no truncation)`);
    }
    assert.doesNotMatch(sys, /…/, `${a.id}: no truncation ellipsis`);
    assert.doesNotMatch(sys, /\(no tools available to this specialist\)/, `${a.id}: not toolless`);
    assert.ok(sys.includes(a.prompt), `${a.id}: distinct personality preserved verbatim`);
    assert.match(sys, /NEVER say .*don't have the tools/, `${a.id}: capability contract present`);
    assert.match(sys, /per-turn VIEW for weak models ONLY/, `${a.id}: profile is a view, not a gate`);
  }
  const fullSys = m.buildSubagentSystemPrompt({
    name: 'General Agent', prompt: 'x', tools: names, profile: 'full', workspace: WS,
  });
  assert.match(fullSys, /Tool profile: full/, 'full profile note');
  console.log('V1136_PROMPT=16/16 prompts advertise all 145 tools, personalities intact, no slice');
});

test('v1136-4: advanced tools dispatch BY NAME for all 16 specialists', async () => {
  const calls = [];
  for (const a of m.AGENTS) {
    for (const name of ADVANCED) {
      const args = name === 'markdown_outline' ? JSON.stringify({ text: '# H\n## S\nbody' }) : '{}';
      let res;
      try {
        res = await m.executeTool(name, args, ctx());
      } catch (err) {
        calls.push(`${a.id}/${name}: THREW ${err?.message ?? err}`);
        continue;
      }
      const out = typeof res?.output === 'string' ? res.output : '';
      if (typeof res?.ok !== 'boolean' || !out.length || NOT_ALLOWED.test(out)) {
        calls.push(`${a.id}/${name}: ${out.slice(0, 120)}`);
      }
    }
  }
  assert.deepEqual(calls, [], `every specialist can call advanced tools: ${calls.slice(0, 8).join(' | ')}`);

  // Honest examples: a headless browser tool and an unapproved image tool return
  // a REAL blocker/denial — never a fabricated capability restriction.
  const browser = await m.executeTool('browser_navigate', JSON.stringify({ url: 'https://example.com' }), ctx());
  assert.doesNotMatch(browser.output, NOT_ALLOWED, 'headless refusal is honest, not "not allowed"');
  const image = await m.executeTool('image_generate', JSON.stringify({ prompt: 'test', dest: 'assets/t.jpg' }), ctx());
  assert.doesNotMatch(image.output, NOT_ALLOWED, 'denied approval is honest, not "not allowed"');
  console.log(`V1136_DISPATCH=${m.AGENTS.length * ADVANCED.length} specialist/tool calls, 0 "not allowed"`);
});

test('v1136-5: full dispatch sweep — no tool is Unknown or gated by profile', async () => {
  const broken = [];
  for (const def of m.CORE_DEFS) {
    let res;
    try { res = await m.executeTool(def.name, '{}', ctx()); }
    catch (err) { broken.push(`${def.name}: THREW ${err?.message ?? err}`); continue; }
    const out = typeof res?.output === 'string' ? res.output : '';
    if (!out.length || NOT_ALLOWED.test(out)) broken.push(`${def.name}: ${out.slice(0, 100)}`);
  }
  assert.deepEqual(broken, [], `all 145 tools resolve by name: ${broken.slice(0, 8).join(' | ')}`);
  console.log('V1136_SWEEP=145/145 resolved by name, 0 Unknown, 0 profile gates');
});

test('v1136-6: SOURCE guards — the old filters cannot come back silently', () => {
  const runnerSrc = src('electron/agent/subagentRunner.ts');
  assert.match(runnerSrc, /export function subagentToolDefs/, 'full-registry helper exists');
  assert.match(runnerSrc, /getToolDefs\(\[\], 'full'\)/, 'full core registry, not a profile view');
  assert.match(runnerSrc, /getProviderToolDefs\(\)/, 'provider-native tools appended');
  assert.match(runnerSrc, /tools: defs/, 'the loop receives the full defs');
  assert.doesNotMatch(runnerSrc, /spec\.tools\s*===/, 'no specialist allow-list (=== check)');
  assert.doesNotMatch(runnerSrc, /spec\.tools\.includes/, 'no specialist allow-list (.includes check)');
  assert.doesNotMatch(runnerSrc, /getToolDefs\(\[\], profile\)/, 'no profile-based tool slice');
  assert.doesNotMatch(runnerSrc, /slice\(0, Math\.min\(40/, 'no 40-tool prompt truncation');
  assert.doesNotMatch(runnerSrc, /d\.name !== 'task'/, 'no hidden capability');
  assert.match(runnerSrc, /per-turn VIEW for weak models ONLY/, 'profile is documented as a view');
  console.log('V1136_SOURCE=spec.tools filter gone, profile slice gone, 40-truncation gone');
});

after(() => {
  try { rmSync(BUNDLE, { force: true }); } catch { /* best effort */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
});
