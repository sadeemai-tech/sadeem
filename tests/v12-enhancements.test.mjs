// v12 — enhancement contract tests:
//  (1) the two new self-service checkpoint tools are registered + wired to
//      REAL executors (not stubs) and reflected in the generated inventory;
//  (2) the provider SSE layer exposes a heartbeat callback so a keep-alive-warm
//      stream cannot be killed by the engine idle watchdog;
//  (3) the engine marks a budget-exhausted run as PARTIAL (never cleanly done).
// Self-bootstrapping esbuild bundles, same posture as the other harnesses.
import { ESBUILD_BIN, ESBUILD_NODE } from './_esbuild-bin.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v12-'));

// v12.1 — POWER TOOL ARSENAL: database / test-QA / devops / assets.
const POWER_TOOL_NAMES = [
  'db_query', 'db_seed', 'db_migrate',              // database
  'lighthouse', 'e2e_run', 'a11y_audit',            // test / QA
  'env_manager', 'git_platform',                    // devops
  'icon_font_search', 'image_edit',                 // assets
];

function bundle(entry, out) {
  execFileSync(ESBUILD_NODE, [ESBUILD_BIN,
    entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${out}`,
    '--external:electron', '--external:@xterm/xterm', '--external:@xterm/addon-fit',
    '--external:monaco-editor', '--external:@monaco-editor/react',
  ], { cwd: ROOT, stdio: 'pipe' });
}

// stub electron so the tool graph can be required in plain Node
const stubDir = join(tmp, 'node_modules', 'electron');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
writeFileSync(join(stubDir, 'index.js'), `module.exports = {
  app: { getPath: () => ${JSON.stringify(join(tmp, 'ud'))}, whenReady: async () => true, on() {}, quit() {} },
  ipcMain: { handle() {}, on() {} }, BrowserWindow: { getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false }, shell: {}, Notification: { isSupported: () => false },
};`);

const tools = (() => {
  const p = join(tmp, 'tools.cjs');
  bundle('electron/agent/tools.ts', p);
  return require(p);
})();

test('v12 checkpoint tools: registered, schema-valid, dispatch to real executors', async () => {
  const defs = tools.getToolDefs([]);
  const names = new Set(defs.map((d) => d.name));
  for (const name of ['checkpoint_list', 'checkpoint_restore']) {
    assert.ok(names.has(name), `${name} is registered`);
    const d = defs.find((x) => x.name === name);
    assert.ok(d.description && d.description.length > 20, `${name} has a real description`);
    assert.equal(d.parameters.type, 'object', `${name} has an object schema`);
  }
  const ctx = { workspace: tmp, sessionId: 'v12', mcpServers: [], emit: () => {}, approve: async () => true, fullAccess: true };
  const listed = await tools.executeTool('checkpoint_list', '{}', ctx);
  assert.equal(listed.ok, true, 'checkpoint_list executes (empty list is still ok)');
  const bad = await tools.executeTool('checkpoint_restore', JSON.stringify({ id: 'no-such-checkpoint' }), ctx);
  assert.equal(bad.ok, false, 'checkpoint_restore refuses an unknown id honestly (never claims success)');
});

test('v12 inventory artifact includes the new tools and matches the live registry', () => {
  const inv = JSON.parse(readFileSync(join(ROOT, 'src/generated/toolInventory.json'), 'utf8'));
  assert.ok(inv.total >= 121, 'inventory regenerated');
  const names = inv.tools.map((t) => t.name);
  assert.ok(names.includes('checkpoint_list') && names.includes('checkpoint_restore') && names.includes('multi_file_edit'));
  for (const n of ['notebook_read','notebook_edit_cell','notebook_run','semantic_search','pin_context','browser_tabs','browser_network']) assert.ok(names.includes(n), n + ' registered');
  assert.equal(inv.total, 145, 'LSP + v12.1 power tools + v11.15 download/discoverability tools included in inventory');
  for (const n of ['lsp_definition', 'lsp_hover', 'lsp_diagnostics', 'lsp_references', 'lsp_rename', 'lsp_completion']) {
    assert.ok(names.includes(n), `${n} registered`);
  }
  for (const n of POWER_TOOL_NAMES) assert.ok(names.includes(n), `${n} in inventory`);
  assert.equal(new Set(names).size, names.length, 'inventory has no duplicate names');
});

// ---------- v12.1 — POWER TOOL ARSENAL: registered + dispatchable ----------
test('v12.1 power tools: all defs registered and dispatch without "Unknown tool"', async () => {
  const defs = tools.getToolDefs([]);
  const byName = new Map(defs.map((d) => [d.name, d]));
  for (const name of POWER_TOOL_NAMES) {
    assert.ok(byName.has(name), `${name} is registered`);
    const d = byName.get(name);
    assert.ok(d.description && d.description.length > 20, `${name} has a real description`);
    assert.equal(d.parameters.type, 'object', `${name} has an object schema`);
    assert.ok(Array.isArray(d.parameters.required), `${name} has a required[] list`);
    assert.ok(['fs', 'exec', 'meta'].includes(d.kind), `${name} has a valid kind`);
  }

  // Args chosen to take the FASTEST honest-refusal path (no CLI is launched):
  // a broken dispatch shows up as "Unknown tool:", a stub as an empty output.
  const fastRefusalArgs = {
    db_query: {},
    db_seed: {},
    db_migrate: { dir: '__definitely_not_a_project__' },
    lighthouse: {},
    e2e_run: { dir: '__definitely_not_a_project__' },
    a11y_audit: {},
    env_manager: { action: 'use' },
    git_platform: {},
    icon_font_search: {},
    image_edit: {},
  };
  const ctx = { workspace: tmp, sessionId: 'v12-power', mcpServers: [], emit: () => {}, approve: async () => true, fullAccess: true };
  for (const name of POWER_TOOL_NAMES) {
    let result;
    try {
      result = await tools.executeTool(name, JSON.stringify(fastRefusalArgs[name]), ctx);
    } catch (err) {
      assert.fail(`${name} threw during dispatch: ${err.message}`);
    }
    assert.ok(result && typeof result === 'object', `${name} returned a result`);
    assert.equal(typeof result.ok, 'boolean', `${name} returned an ok flag`);
    assert.ok(typeof result.output === 'string' && result.output.length > 10, `${name} returned an honest, non-empty message`);
    assert.doesNotMatch(result.output, /Unknown tool:/, `${name} dispatched (no "Unknown tool")`);
    assert.doesNotMatch(result.output, /Tool error:/, `${name} did not hit the last-resort crash guard`);
  }
});

test('v12 tool profiles: essential ⊂ balanced ⊂ full; MCP tools always advertised', () => {
  const full = tools.getToolDefs([], 'full');
  const balanced = tools.getToolDefs([], 'balanced');
  const essential = tools.getToolDefs([], 'essential');

  // Default (no profile arg) stays the FULL registry — executors/inventory
  // never lose a tool; only the engine advertises a narrowed subset.
  assert.equal(tools.getToolDefs([]).length, full.length, 'default profile = full registry');
  assert.ok(essential.length < balanced.length, 'essential is smaller than balanced');
  assert.ok(balanced.length < full.length, 'balanced is smaller than full');
  assert.ok(essential.length >= 28 && essential.length <= 45, `essential ≈ 30 core tools (got ${essential.length})`);

  const fullNames = new Set(full.map((d) => d.name));
  const balNames = new Set(balanced.map((d) => d.name));
  for (const d of essential) {
    assert.ok(balNames.has(d.name), `essential tool ${d.name} is also in balanced`);
    assert.ok(fullNames.has(d.name), `essential tool ${d.name} is also in full`);
  }
  for (const d of balanced) assert.ok(fullNames.has(d.name), `balanced tool ${d.name} is also in full`);

  // ~40 core families are all in 'essential'.
  for (const n of [
    'read_file', 'write_file', 'edit_file', 'run_command', 'search_files', 'glob_files',
    'todo_write', 'propose_plan', 'checkpoint_save', 'preview', 'web_search', 'web_fetch', 'task',
    // v11.15 — the founder's named families must be visible in the default profile
    'web_download', 'tool_help', 'lsp_languages',
  ]) {
    assert.ok(essential.some((d) => d.name === n), `${n} is in the essential profile`);
  }
  // v11.15 — LSP is NO LONGER hidden from balanced: it is advertised in
  // essential/balanced/full so the model can actually see and use it.
  for (const n of ['lsp_definition', 'lsp_hover', 'lsp_diagnostics', 'lsp_references', 'lsp_rename', 'lsp_completion']) {
    assert.ok(balNames.has(n), `${n} visible in balanced`);
    assert.ok(fullNames.has(n), `${n} present in full`);
  }
  // Deep specialists are still hidden from balanced but present in full.
  for (const n of ['debug_start', 'notebook_run', 'media_ffmpeg']) {
    assert.ok(!balNames.has(n), `${n} hidden from balanced`);
    assert.ok(fullNames.has(n), `${n} present in full`);
  }
  // The web/download family is visible in every profile.
  for (const n of ['web_search', 'web_fetch', 'web_download', 'tool_help', 'lsp_languages']) {
    assert.ok(balNames.has(n), `${n} visible in balanced`);
  }

  // MCP tools are ALWAYS available regardless of profile.
  const mcp = [{ server: { name: 'Demo' }, tools: [{ name: 'do_thing', description: 'x', inputSchema: { type: 'object' } }] }];
  for (const p of ['essential', 'balanced', 'full']) {
    const defs = tools.getToolDefs(mcp, p);
    assert.ok(defs.some((d) => d.name === 'mcp__demo__do_thing' && d.kind === 'mcp'), `MCP tool kept in ${p}`);
  }
});

test('v12 heartbeat: SSE keep-alive bytes invoke onHeartbeat (source contract)', () => {
  // Static-source contract (the mock-stream path is exercised by the streaming
  // suites): the provider must accept + call an onHeartbeat callback on ANY byte.
  const src = readFileSync(join(ROOT, 'electron/agent/providers.ts'), 'utf8');
  assert.match(src, /onHeartbeat\?: \(\) => void/, 'StreamTurnOptions exposes onHeartbeat');
  assert.match(src, /onByte\?: \(\) => void/, 'readSseLines accepts an onByte callback');
  const eng = readFileSync(join(ROOT, 'electron/agent/engine.ts'), 'utf8');
  assert.match(eng, /onHeartbeat: \(\) => bumpActivity\(\)/, 'engine bumps its watchdog on provider heartbeats');
});

test('v12 LSP tools: registered, honest when no server is installed', async () => {
  const defs = tools.getToolDefs([]);
  const names = new Set(defs.map((d) => d.name));
  for (const n of ['lsp_definition', 'lsp_hover', 'lsp_diagnostics', 'lsp_references', 'lsp_rename', 'lsp_completion']) {
    assert.ok(names.has(n), `${n} is registered`);
    const d = defs.find((x) => x.name === n);
    assert.equal(d.parameters.type, 'object', `${n} has an object schema`);
  }
  const ctx = { workspace: tmp, sessionId: 'v12-lsp', mcpServers: [], emit: () => {}, approve: async () => true, fullAccess: true };
  // With no language server installed the tool must HONESTLY refuse — never
  // pretend to have found a definition, and never throw.
  const r = await tools.executeTool('lsp_definition', JSON.stringify({ path: 'nope.ts', line: 1, character: 1 }), ctx);
  assert.equal(r.ok, false, 'lsp_definition refuses a missing file/server honestly');
  assert.ok(r.output.length > 10, 'the refusal explains why');
});

test('v12 notebooks: real .ipynb read/edit works and preserves structure', async () => {
  const nbPath = join(tmp, 'demo.ipynb');
  const nb = {
    cells: [
      { cell_type: 'markdown', source: ['# Demo\n'], metadata: {} },
      { cell_type: 'code', source: ['print("hello")\n'], outputs: [], execution_count: null, metadata: {} },
    ],
    metadata: { kernelspec: { language: 'python', name: 'python3', display_name: 'Python 3' } },
    nbformat: 4, nbformat_minor: 5,
  };
  writeFileSync(nbPath, JSON.stringify(nb));
  const ctx = { workspace: tmp, sessionId: 'v12-nb', mcpServers: [], emit: () => {}, approve: async () => true, fullAccess: true };
  const read = await tools.executeTool('notebook_read', JSON.stringify({ path: 'demo.ipynb' }), ctx);
  assert.equal(read.ok, true, 'notebook_read works');
  assert.match(read.output, /2 cell\(s\)/, 'cell count reported');
  const edit = await tools.executeTool('notebook_edit_cell', JSON.stringify({ path: 'demo.ipynb', index: 1, source: 'print("edited")' }), ctx);
  assert.equal(edit.ok, true, 'notebook_edit_cell works');
  const after = JSON.parse(readFileSync(nbPath, 'utf8'));
  assert.equal(after.nbformat, 4, 'nbformat preserved');
  assert.equal(after.cells[0].source[0], '# Demo\n', 'other cells untouched');
  assert.equal(after.cells[1].source.join(''), 'print("edited")', 'cell edited');
});

test('v12 pin_context: pins are listed and survive as a session-scoped surface', async () => {
  const ctx = { workspace: tmp, sessionId: 'v12-pin', mcpServers: [], emit: () => {}, approve: async () => true, fullAccess: true };
  const add = await tools.executeTool('pin_context', JSON.stringify({ action: 'add', text: 'remember this constraint', label: 'rule' }), ctx);
  assert.equal(add.ok, true, 'pin added');
  assert.match(add.output, /pin_/, 'returns a pin id');
  const list = await tools.executeTool('pin_context', JSON.stringify({ action: 'list' }), ctx);
  assert.equal(list.ok, true);
  assert.match(list.output, /remember this constraint/, 'pin listed');
  const clear = await tools.executeTool('pin_context', JSON.stringify({ action: 'clear' }), ctx);
  assert.equal(clear.ok, true);
  const after = await tools.executeTool('pin_context', JSON.stringify({ action: 'list' }), ctx);
  assert.match(after.output, /No pinned context/, 'pins cleared');
});

test('v12 hooks: full lifecycle config + runner (SessionStart/Stop/PreCompact/...)', async () => {
  const hp = join(tmp, 'hooks.cjs');
  const hmod = (() => {
    const p = join(tmp, 'hooks-bundle.cjs');
    bundle('electron/agent/hooks.ts', p);
    return require(p);
  })();
  const cfg = hmod.sanitize({
    SessionStart: [{ command: 'echo started' }],
    Stop: [{ command: 'echo stopped' }],
    PreCompact: [{ command: 'echo compacting' }],
    UserPromptSubmit: [{ command: 'echo prompt' }],
  });
  assert.ok(cfg.SessionStart && cfg.Stop && cfg.PreCompact && cfg.UserPromptSubmit, 'all lifecycle families parsed');
  // A hook that exits 2 on Stop requests an early stop (honest contract).
  const dir = mkdtempSync(join(tmpdir(), 'v12-hook-'));
  const stopCfg = hmod.sanitize({ Stop: [{ command: 'exit 2' }] });
  const r = await hmod.runStopHooks(stopCfg, dir, 'sess-x');
  assert.equal(r.requestStop, true, 'Stop hook exit 2 requests a stop');
});

test('v12 honesty: a budget-exhausted run is reported as partial', () => {
  const src = readFileSync(join(ROOT, 'electron/agent/engine.ts'), 'utf8');
  assert.match(src, /partial: o\.partial === true/, 'task_report honours explicit partial override');
  assert.match(src, /budgetExhausted/, 'budget-exhaust detection exists');
  assert.match(src, /stopReason === 'max_tokens'/, 'max_tokens truncation is treated as partial');
});

test('v12 competitive upgrades: embeddings / LSP auto-install / marketplace / kernel', () => {
  const emb = readFileSync(join(ROOT, 'electron/agent/embeddingIndex.ts'), 'utf8');
  assert.match(emb, /providerEmbed/, 'provider /embeddings engine implemented');
  assert.match(emb, /engineChanged/, 'index rebuilds when the embedding engine changes');
  assert.match(emb, /never mixed|Never mix/i, 'vector spaces are never mixed');

  const lsp = readFileSync(join(ROOT, 'electron/agent/lsp.ts'), 'utf8');
  assert.match(lsp, /maybeInstall/, 'LSP auto-install implemented');
  assert.match(lsp, /install: \{ exe:/, 'install recipes are declarative');
  assert.match(lsp, /force: true/, 'global install is approval-gated');

  const skills = readFileSync(join(ROOT, 'electron/agent/skills.ts'), 'utf8');
  assert.match(skills, /listMarketplaceSkills/, 'marketplace listing implemented');
  assert.match(skills, /installMarketplaceSkill/, 'marketplace install implemented');

  const nb = readFileSync(join(ROOT, 'electron/agent/notebook.ts'), 'utf8');
  assert.match(nb, /PY_NBCLIENT_RUNNER/, 'real Jupyter kernel runner present');
  assert.match(nb, /realKernel/, 'honest kernel-vs-fallback detection');

  const dock = readFileSync(join(ROOT, 'src/components/BrowserDock.tsx'), 'utf8');
  assert.match(dock, /tabAction/, 'browser tab UI implemented');
  assert.match(dock, /browserNetwork/, 'browser network log UI implemented');

  const market = JSON.parse(readFileSync(join(ROOT, 'electron/assets/skills/marketplace.json'), 'utf8'));
  assert.ok(market.skills.length >= 12, 'marketplace ships a real catalog');
});

test('v12 semantic index: real file search works offline', async () => {
  const p = join(tmp, 'sem.cjs');
  bundle('electron/agent/embeddingIndex.ts', p);
  const { SemanticIndex } = require(p);
  const ws = mkdtempSync(join(tmpdir(), 'v12-sem-'));
  mkdirSync(join(ws, 'src'));
  writeFileSync(join(ws, 'src', 'auth.ts'), 'export function validateToken(token: string) { return token.length > 8; }\n');
  writeFileSync(join(ws, 'src', 'notes.md'), '# Notes\nAuthentication and token validation live in auth.ts.\n');
  const idx = new SemanticIndex(ws);
  const stats = await idx.update();
  assert.ok(stats.chunks >= 2, 'indexed chunks from real files');
  const hits = await idx.search('validate authentication token', 5);
  assert.ok(hits.length >= 1, 'semantic search returns a hit');
  assert.ok(hits.some((h) => h.rel.includes('auth')), 'the auth-related file is among the hits');
});

// ---------- v12 competitive chat-surface upgrades ----------
// (b) prompt presets quick insert — pure filter/preview helper
test('v12 prompt presets: quick filter + preview are deterministic and safe', () => {
  const p = join(tmp, 'prompt-presets.cjs');
  bundle('src/lib/promptPresets.ts', p);
  const { filterPromptPresets, presetPreview } = require(p);
  const items = [
    { id: 'a', name: 'Strict review', text: 'Review the diff', updatedAt: 10 },
    { id: 'b', name: 'Task brief', text: 'Review requirements first', updatedAt: 30 },
    { id: 'c', name: 'Report', text: 'Write a report', updatedAt: 20 },
    { id: 'bad', updatedAt: 99 },
  ];
  assert.deepEqual(
    filterPromptPresets(items, '').map((x) => x.id),
    ['b', 'c', 'a'],
    'newest-updated first, malformed entries ignored',
  );
  assert.deepEqual(
    filterPromptPresets(items, ' REVIEW ').map((x) => x.id),
    ['b', 'a'],
    'case-insensitive match across name AND body',
  );
  assert.equal(filterPromptPresets(null, 'x').length, 0, 'never throws on null');
  assert.deepEqual(filterPromptPresets(items, '', 2).map((x) => x.id), ['b', 'c'], 'cap honored');
  assert.equal(presetPreview('a\n\nb   c'), 'a b c', 'whitespace collapsed for the fixed-height row');
  assert.ok(presetPreview('x'.repeat(200)).endsWith('…'), 'long previews truncated');
});

// (e) Context Lens — remaining budget + plain-text breakdown
test('v12 context lens: remaining budget + copy breakdown are honest and pure', () => {
  const p = join(tmp, 'ctx-v12.cjs');
  bundle('src/lib/ctx.ts', p);
  const { remainingContextTokens, formatContextBreakdown } = require(p);
  assert.equal(remainingContextTokens(12482, 200000), 187518, 'remaining = window - fill');
  assert.equal(remainingContextTokens(300000, 200000), 0, 'never negative');
  assert.equal(remainingContextTokens(10, 0), 0, 'unknown window → 0');
  const exact = formatContextBreakdown({
    model: 'anthropic/claude', fill: 12482, window: 200000,
    cacheRead: 4000, cacheWrite: 1000, generated: 482,
    sessionTotal: 50000, sessionCostUsd: 0.0123,
  });
  assert.match(exact, /claude/, 'model included');
  assert.match(exact, /12482 \/ 200000 tokens/, 'exact fill/window, no invented ≈');
  assert.match(exact, /Remaining: 187518 tokens/, 'remaining reported');
  assert.match(exact, /fresh input 7000/, 'fresh = fill - cache - generated, never double-counted');
  assert.match(exact, /\$0\.0123/, 'cost included');
  assert.doesNotMatch(exact, /≈/, 'no estimate marker for exact figures');
  const approx = formatContextBreakdown({ model: 'x', fill: 100, window: 200, windowEstimated: true });
  assert.match(approx, /≈/, 'estimated window keeps the honesty marker');
  assert.match(approx, /figures are estimates/, 'and explains it');
});

// static-source wiring contract for all four chat-surface affordances
test('v12 chat surface: presets / rewind / context copy / zen focus are wired', () => {
  const composer = readFileSync(join(ROOT, 'src/components/Composer.tsx'), 'utf8');
  assert.match(composer, /filterPromptPresets/, 'composer uses the pure preset filter');
  assert.match(composer, /togglePresets/, 'presets popover toggle wired');
  assert.match(composer, /api\.promptsList\(\)/, 'presets load from the real library service');
  assert.match(composer, /openRewindPicker\(\)/, 'rewind reachable from the composer');

  const store = readFileSync(join(ROOT, 'src/store.ts'), 'utf8');
  assert.match(store, /openRewindPicker: async \(\)/, 'store action lists checkpoints and opens chooser');
  assert.match(store, /api\.cpList\(st\.wsPath\)/, 'uses the real checkpoint list IPC');

  const lens = readFileSync(join(ROOT, 'src/components/ContextLens.tsx'), 'utf8');
  assert.match(lens, /formatContextBreakdown/, 'copy uses the pure breakdown formatter');
  assert.match(lens, /remainingContextTokens/, 'remaining budget row wired');
  assert.match(lens, /Copy breakdown/, 'copy affordance present');

  const chat = readFileSync(join(ROOT, 'src/components/ChatPanel.tsx'), 'utf8');
  assert.match(chat, /setFocusMode\(!focusMode\)/, 'zen focus toggled from the chat header');
  assert.match(chat, /sc-focus-hint/, 'focus hint strip rendered');

  const css = readFileSync(join(ROOT, 'src/components/chat.css'), 'utf8');
  assert.match(css, /\.sc-presets/, 'preset popover styled in the existing chat.css');
  assert.match(css, /\.sc-focus-hint/, 'focus hint styled in the existing chat.css');
  assert.ok(!/v12-presets\.css|v12-focus\.css/.test(css), 'no versioned CSS files introduced');
});

// v12 — full profile export/import: strict shape validation before restore
test('v12 profile: validateProfile accepts only well-formed profile objects', () => {
  const p = join(tmp, 'profile.cjs');
  bundle('electron/services/profileService.ts', p);
  const { validateProfile, PROFILE_FORMAT, PROFILE_VERSION } = require(p);
  const good = {
    format: PROFILE_FORMAT,
    version: PROFILE_VERSION,
    exportedAt: '2026-01-01T00:00:00.000Z',
    appVersion: '11.12.0',
    settings: {},
    dna: {},
    skills: [],
    prompts: [],
  };
  const ok = validateProfile(good);
  assert.equal(ok.ok, true, 'a well-formed profile is accepted');
  assert.equal(ok.profile, good, 'the original object is returned for restore');

  assert.equal(validateProfile(null).ok, false, 'null rejected');
  assert.equal(validateProfile([]).ok, false, 'array rejected');
  assert.equal(validateProfile({ ...good, format: 'nope' }).ok, false, 'bad format rejected');
  assert.equal(validateProfile({ ...good, version: 999 }).ok, false, 'bad version rejected');
  assert.equal(validateProfile({ ...good, settings: undefined }).ok, false, 'missing settings rejected');
  assert.equal(validateProfile({ ...good, dna: undefined }).ok, false, 'missing dna rejected');
  assert.equal(validateProfile({ ...good, skills: 'x' }).ok, false, 'bad skills rejected');
  assert.equal(validateProfile({ ...good, prompts: 'x' }).ok, false, 'bad prompts rejected');
});

// IPC + bridge wiring contract for profile export/import
test('v12 profile: IPC + preload + api are wired', () => {
  const ipc = readFileSync(join(ROOT, 'electron/ipc.ts'), 'utf8');
  assert.match(ipc, /handle\('kdx:profile:export'/, 'export IPC registered');
  assert.match(ipc, /handle\('kdx:profile:import'/, 'import IPC registered');
  const pre = readFileSync(join(ROOT, 'electron/preload.ts'), 'utf8');
  assert.match(pre, /profileExport: \(workspace\?/, 'preload export bridge');
  assert.match(pre, /profileImport: \(payload/, 'preload import bridge');
  const api = readFileSync(join(ROOT, 'src/lib/api.ts'), 'utf8');
  assert.match(api, /profileExport\(workspace\?/, 'typed api export');
  assert.match(api, /profileImport\(payload/, 'typed api import');
});
