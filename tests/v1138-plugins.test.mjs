// ============================================================
// v11.38 — PLUGINS PRO: real lifecycle integration test.
//
// Drives the REAL pluginService + REAL slashService (esbuild-bundled,
// electron stubbed) against isolated temp dirs. No source stubbing of the
// plugin logic: if a plugin's MCP server is not injected, its /prompt is
// invisible to slashService, disable leaves stale commands, or state does
// not survive a fresh module load ("restart"), this file FAILS LOUDLY.
//
//   node --test --test-force-exit tests/v1138-plugins.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

// ---------- isolated filesystem (env set BEFORE either module is loaded) ----------
const TMP = mkdtempSync(join(tmpdir(), 'sadeem-v1138-plugins-'));
const USERDATA = join(TMP, 'userdata');
const HOME = join(TMP, 'surnia-home');
mkdirSync(USERDATA, { recursive: true });
mkdirSync(HOME, { recursive: true });
process.env.SADEEM_TEST_USERDATA = USERDATA;
process.env.SURNIA_HOME = HOME;
delete process.env.KODEX_HOME;
globalThis.__V1138_HANDLERS__ = {};

const STUBS = {
  electron: `
    const os = require('os');
    globalThis.__V1138_HANDLERS__ = globalThis.__V1138_HANDLERS__ || {};
    const app = {
      getPath: (n) => (n === 'userData' ? (process.env.SADEEM_TEST_USERDATA || os.tmpdir()) : os.tmpdir()),
      isReady: () => true, whenReady: async () => {}, on() {}, once() {},
      getName: () => 'v1138-test', getVersion: () => '0.0.0',
    };
    module.exports = {
      app,
      ipcMain: { handle: (ch, fn) => { globalThis.__V1138_HANDLERS__[ch] = fn; }, on() {}, removeAllListeners() {} },
      ipcRenderer: { invoke: async () => undefined }, contextBridge: { exposeInMainWorld() {} },
      shell: { openPath: async () => '', showItemInFolder() {}, openExternal: async () => {} },
      BrowserWindow: class {}, Notification: { isSupported: () => false },
      nativeImage: { createEmpty: () => ({}) }, clipboard: { readText: () => '', writeText() {} },
      powerMonitor: { on() {} }, session: { defaultSession: {} },
      screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1, height: 1 } }) },
      safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
      dialog: { showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => ({ canceled: true }) },
    };
  `,
};
const stubPlugin = {
  name: 'v1138-electron-stub',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) =>
      Object.prototype.hasOwnProperty.call(STUBS, args.path) ? { path: args.path, namespace: 'v1138-stub' } : null,
    );
    build.onLoad({ filter: /.*/, namespace: 'v1138-stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }));
  },
};

const bundled = [];
async function bundle(entry, outName) {
  const outfile = join(ROOT, 'tests', outName);
  bundled.push(outfile);
  await esbuild.build({
    entryPoints: [join(ROOT, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [stubPlugin],
    logLevel: 'silent',
  });
  return require(outfile);
}

const plugins = await bundle('electron/services/pluginService.ts', '.v1138-plugins.bundle.cjs');
const slash = await bundle('electron/services/slashService.ts', '.v1138-slash.bundle.cjs');

after(() => {
  for (const f of bundled) { try { require('node:fs').unlinkSync(f); } catch { /* gone */ } }
});
const commandsDir = join(HOME, 'commands');
const commandFiles = () => (existsSync(commandsDir) ? readdirSync(commandsDir) : []);
const TRUSTED = { senderFrame: { url: 'surnia://bundle/index.html' } };
const FOREIGN = { senderFrame: { url: 'https://evil.example/index.html' } };

// ------------------------------------------------------------
// 1 · install a starter → MCP + prompt + REAL slash command.
// ------------------------------------------------------------
test('install starter → MCP server in enabledPluginMcpServers + prompt in enabledPluginPrompts + live /slash', async () => {
  const info = await plugins.installStarter('sadeem.starter-web');
  assert.equal(info.id, 'sadeem.starter-web');
  assert.equal(info.enabled, true);
  assert.equal(info.source, 'builtin');
  assert.equal(info.mcpCount, 1);
  assert.equal(info.promptCount, 1);

  const mcp = plugins.enabledPluginMcpServers();
  assert.equal(mcp.length, 1);
  assert.match(mcp[0].id, /^plugin__sadeem\.starter-web__fetch$/);
  assert.equal(mcp[0].name, 'plugin__sadeem.starter-web__fetch');
  assert.equal(mcp[0].command, 'npx');
  assert.equal(mcp[0].enabled, true);

  const prompts = plugins.enabledPluginPrompts();
  assert.equal(prompts.size, 1);
  assert.ok(prompts.has('research'));
  assert.match(prompts.get('research').prompt, /Research the topic/);

  // THE core regression: the command file must be VISIBLE to slashService.
  // Old name `plugin__sadeem.starter-web__research.md` has dots and was ignored.
  const listed = slash.listSlashCommands();
  const research = listed.find((c) => c.name === 'research');
  assert.ok(research, 'slashService must list the plugin prompt as /research');
  assert.equal(research.source, 'user');
  assert.equal(basename(research.path), 'research.md');
  assert.ok(commandFiles().includes('research.md'));

  const dispatched = await slash.dispatchSlashCommand({ raw: '/research cap llm' });
  assert.equal(dispatched.kind, 'custom');
  assert.equal(dispatched.command, 'research');
  assert.match(dispatched.expanded, /Research the topic/);
  assert.match(dispatched.expanded, /cap llm/); // $ARGUMENTS expansion is real

  // Backward-compatible legacy marker still exists for old consumers.
  assert.ok(commandFiles().includes('plugin__sadeem.starter-web__research.md'));
});

// ------------------------------------------------------------
// 2 · disable / re-enable actually changes BOTH contributions.
// ------------------------------------------------------------
test('disable → MCP + prompt + slash command all gone; re-enable → all back', async () => {
  const off = await plugins.setPluginEnabled('sadeem.starter-web', false);
  assert.equal(off.enabled, false);
  assert.equal(plugins.listPlugins()[0].enabled, false);
  assert.equal(plugins.enabledPluginMcpServers().length, 0);
  assert.equal(plugins.enabledPluginPrompts().size, 0);
  assert.ok(!slash.listSlashCommands().some((c) => c.name === 'research'));
  assert.ok(!commandFiles().includes('research.md'));
  assert.ok(!commandFiles().some((f) => f.startsWith('plugin__sadeem.starter-web__')));
  const unknown = await slash.dispatchSlashCommand({ raw: '/research cap llm' });
  assert.equal(unknown.kind, 'unknown');

  const on = await plugins.setPluginEnabled('sadeem.starter-web', true);
  assert.equal(on.enabled, true);
  assert.equal(plugins.enabledPluginMcpServers().length, 1);
  assert.ok(plugins.enabledPluginPrompts().has('research'));
  assert.ok(slash.listSlashCommands().some((c) => c.name === 'research'));
  assert.ok(commandFiles().includes('research.md'));
});

// ------------------------------------------------------------
// 3 · restart simulation — fresh module load reads persisted state.
// ------------------------------------------------------------
test('restart → enabled flag and contributions persist on disk', async () => {
  await plugins.setPluginEnabled('sadeem.starter-web', false);
  const fresh = await bundle('electron/services/pluginService.ts', '.v1138-plugins-restart.bundle.cjs');
  const listed = fresh.listPlugins();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, 'sadeem.starter-web');
  assert.equal(listed[0].enabled, false, 'disabled state survived a fresh module load');
  assert.equal(fresh.enabledPluginMcpServers().length, 0);
  assert.equal(fresh.enabledPluginPrompts().size, 0);

  await fresh.setPluginEnabled('sadeem.starter-web', true);
  assert.equal(fresh.enabledPluginMcpServers().length, 1);
  assert.ok(fresh.enabledPluginPrompts().has('research'));
  // The already-loaded instance sees the same disk state (no in-memory cache).
  assert.equal(plugins.enabledPluginMcpServers().length, 1);
});

// ------------------------------------------------------------
// 4 · two plugins with the same prompt: deterministic owner, clean removal.
// ------------------------------------------------------------
test('contribution ownership: disabling one plugin never deletes another plugin’s command', async () => {
  const other = await plugins.installPluginFromObject({
    id: 'aaa.conflict', name: 'Conflict', version: '1.0.0', enabled: true,
    prompts: [{ name: 'research', description: 'Other research', prompt: 'Other body $ARGUMENTS' }],
  }, 'file');
  assert.equal(other.enabled, true);
  // lowest plugin id wins deterministically; no crash, no silent double-write
  assert.ok(plugins.enabledPluginPrompts().has('research'));
  assert.ok(commandFiles().includes('research.md'));

  await plugins.setPluginEnabled('sadeem.starter-web', false);
  assert.equal(plugins.enabledPluginMcpServers().length, 0);
  assert.ok(commandFiles().includes('research.md'), 'command still owned by aaa.conflict');
  const body = require('node:fs').readFileSync(join(commandsDir, 'research.md'), 'utf8');
  assert.match(body, /Other body/);

  await plugins.uninstallPlugin('aaa.conflict');
  assert.ok(!commandFiles().includes('research.md'));
  await plugins.setPluginEnabled('sadeem.starter-web', true);
  assert.ok(commandFiles().includes('research.md'), 'original owner re-publishes its command');
});

// ------------------------------------------------------------
// 5 · uninstall is clean.
// ------------------------------------------------------------
test('uninstall → plugin, MCP, prompt and slash command all removed', async () => {
  await plugins.uninstallPlugin('sadeem.starter-web');
  assert.equal(plugins.listPlugins().length, 0);
  assert.equal(plugins.enabledPluginMcpServers().length, 0);
  assert.equal(plugins.enabledPluginPrompts().size, 0);
  assert.ok(!commandFiles().includes('research.md'));
  assert.ok(!commandFiles().some((f) => f.startsWith('plugin__sadeem.starter-web__')));
  assert.equal((await slash.dispatchSlashCommand({ raw: '/research x' })).kind, 'unknown');
});

// ------------------------------------------------------------
// 6 · honest validation, path jail, URL gate, IPC origin gate.
// ------------------------------------------------------------
test('manifest validation is strict and errors are precise (no silent failure)', async () => {
  await assert.rejects(() => plugins.installPluginFromObject({ nope: true }, 'file'), /id must match/);
  await assert.rejects(() => plugins.installPluginFromObject({ id: 'ok id!', name: 'x', version: '1' }, 'file'), /id must match/);
  await assert.rejects(() => plugins.installPluginFromObject({ id: 'good-id', name: 'x', version: '1', mcpServers: [{ bad: true }] }, 'file'), /each mcpServer needs/);
  await assert.rejects(() => plugins.installPluginFromObject({ id: 'good-id', name: 'x', version: '1', mcpServers: [{ name: 's', command: 'npx', transport: 'gopher' }] }, 'file'), /transport/);
  await assert.rejects(() => plugins.installPluginFromObject({ id: 'good-id', name: 'x', version: '1', prompts: [{ name: 'OK NAME', prompt: 'x' }] }, 'file'), /prompt name must match/);
  await assert.rejects(() => plugins.installPluginFromObject({ id: 'good-id', name: 'x', version: '1', prompts: [{ name: 'changelog', prompt: 'x' }] }, 'file'), /reserved/);
  await assert.rejects(() => plugins.installPluginFromObject({ id: 'good-id', name: 'x', version: '1', prompts: [{ name: 'dup', prompt: 'x' }, { name: 'dup', prompt: 'y' }] }, 'file'), /duplicate/);
  await assert.rejects(() => plugins.installPluginFromObject({ id: 'good-id', name: 'x', version: '1', prompts: [{ name: 'ok', prompt: '' }] }, 'file'), /non-empty body/);
});

test('path jail: every id used as a path segment is validated', async () => {
  await assert.rejects(() => plugins.setPluginEnabled('../../escape', true), /PLUGIN_INVALID_ID/);
  await assert.rejects(() => plugins.uninstallPlugin('..\\..\\escape'), /PLUGIN_INVALID_ID/);
  const handlers = globalThis.__V1138_HANDLERS__;
  await assert.rejects(() => handlers['kdx:plugins:reveal'](TRUSTED, '../../escape'), /PLUGIN_INVALID_ID/);
});

test('file install: real file works, traversal / wrong extension / missing file rejected', async () => {
  const manifest = join(TMP, 'manifest.json');
  writeFileSync(manifest, JSON.stringify({
    id: 'v1138.file', name: 'File Pack', version: '2.0.0', enabled: true,
    prompts: [{ name: 'filepack', prompt: 'From a file $ARGUMENTS' }],
  }));
  const info = await plugins.installPluginFromFile(manifest);
  assert.equal(info.id, 'v1138.file');
  assert.equal(info.source, 'file');
  assert.ok(slash.listSlashCommands().some((c) => c.name === 'filepack'));
  await assert.rejects(() => plugins.installPluginFromFile(`${TMP}/../escape.json`), /traversal/i);
  await assert.rejects(() => plugins.installPluginFromFile(join(TMP, 'manifest.txt')), /\.json/i);
  await assert.rejects(() => plugins.installPluginFromFile(join(TMP, 'missing.json')), /does not exist/i);
  await plugins.uninstallPlugin('v1138.file');
});

test('URL install: https only, private hosts blocked', async () => {
  await assert.rejects(() => plugins.installPluginFromUrl('not a url'), /full https/i);
  await assert.rejects(() => plugins.installPluginFromUrl('http://example.com/x.json'), /https/i);
  await assert.rejects(() => plugins.installPluginFromUrl('https://localhost/x.json'), /private network/i);
  await assert.rejects(() => plugins.installPluginFromUrl('https://169.254.169.254/x.json'), /private network/i);
});

test('IPC: starters advertise real contributions; mutating channels reject foreign frames', async () => {
  const handlers = globalThis.__V1138_HANDLERS__;
  for (const ch of [
    'kdx:plugins:list', 'kdx:plugins:starters', 'kdx:plugins:installFile', 'kdx:plugins:installUrl',
    'kdx:plugins:installStarter', 'kdx:plugins:uninstall', 'kdx:plugins:setEnabled', 'kdx:plugins:reveal',
  ]) assert.equal(typeof handlers[ch], 'function', `${ch} registered`);

  const starters = await handlers['kdx:plugins:starters']({});
  assert.ok(starters.length >= 3);
  assert.ok(starters.some((s) => s.id === 'sadeem.starter-web' && s.mcpCount === 1 && s.promptCount === 1));

  await assert.rejects(() => handlers['kdx:plugins:installStarter'](FOREIGN, 'sadeem.starter-web'), /UNTRUSTED_SENDER/);
  await assert.rejects(() => handlers['kdx:plugins:uninstall'](FOREIGN, 'sadeem.starter-web'), /UNTRUSTED_SENDER/);
  await assert.rejects(() => handlers['kdx:plugins:setEnabled'](FOREIGN, 'sadeem.starter-web', false), /UNTRUSTED_SENDER/);
  await assert.rejects(() => handlers['kdx:plugins:reveal'](FOREIGN, 'sadeem.starter-web'), /UNTRUSTED_SENDER/);
  // Trusted frame passes the origin gate, then fails on ordinary validation.
  await assert.rejects(() => handlers['kdx:plugins:installStarter'](TRUSTED, 'no-such-starter'), /STARTER_NOT_FOUND/);
  await assert.rejects(() => handlers['kdx:plugins:setEnabled'](TRUSTED, '../../escape', true), /PLUGIN_INVALID_ID/);
});
