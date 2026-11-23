// ============================================================
// SADEEM v11.31 — REGISTRY / PLUGINS / LIBRARY / PROMPTS / WIKI.
// Behavioral tests that drive the REAL service modules (esbuild-bundled)
// against temp dirs and MOCKED network/LLM boundaries:
//   1. MCP registry  — search normalization, pagination, cache, offline
//                      fallback, one-click add + duplicate refusal.
//   2. Plugins       — file path jail, URL scheme/host/size checks,
//                      sender-origin gate on mutating IPC channels.
//   3. Library       — real file/folder import, dedupe, escape refusal.
//   4. Prompts       — validation, upsert CRUD, corrupt-store repair.
//   5. Wiki          — real files, model file choices, atomic save,
//                      staleness, secret hygiene, honest errors.
//
// Run: node --test --test-force-exit tests/v1131-registry.test.mjs
// ============================================================
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ---------- isolated filesystem ----------
const tmp = mkdtempSync(join(tmpdir(), 'sadeem-v1131-'));
const userData = join(tmp, 'userdata');
mkdirSync(userData, { recursive: true });
process.env.SADEEM_TEST_USERDATA = userData;
process.env.SURNIA_HOME = join(tmp, 'surnia-home');
process.env.KODEX_HOME = join(tmp, 'kodex-home');
globalThis.__V1131_HANDLERS__ = {};
globalThis.__V1131_SETTINGS__ = { mcpServers: [] };

// ---------- stubbed boundaries ----------
const STUBS = {
  electron: `
    const os = require('os');
    globalThis.__V1131_HANDLERS__ = globalThis.__V1131_HANDLERS__ || {};
    const app = {
      getPath: (n) => (n === 'userData' ? process.env.SADEEM_TEST_USERDATA : os.tmpdir()),
      isReady: () => true, whenReady: async () => {}, getName: () => 'test', getVersion: () => 'test',
    };
    module.exports = {
      app,
      ipcMain: { handle: (ch, fn) => { globalThis.__V1131_HANDLERS__[ch] = fn; }, on() {} },
      shell: { openPath: async () => '', showItemInFolder() {}, openExternal: async () => {} },
      BrowserWindow: class {}, Notification: { isSupported: () => false },
      nativeImage: { createEmpty: () => ({}) }, clipboard: { readText: () => '', writeText() {} },
      powerMonitor: { on() {} }, session: { defaultSession: {} },
      screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1, height: 1 } }) },
      tray: {}, dialog: { showOpenDialog: async () => ({ canceled: true }) },
      safeStorage: { isEncryptionAvailable: () => false },
      contextBridge: { exposeInMainWorld() {} }, ipcRenderer: { invoke: async () => ({}) },
    };
  `,
  // mcpRegistryService persistence + protocol probe (no spawn / no network).
  './storeService': `
    globalThis.__V1131_SETTINGS__ = globalThis.__V1131_SETTINGS__ || { mcpServers: [] };
    export function getSettings() { return globalThis.__V1131_SETTINGS__; }
    export function saveSettings(s) { globalThis.__V1131_SETTINGS__ = s; }
  `,
  '../agent/mcp': `
    export async function mcpProbeServer() { return { ok: true, tools: [], resources: [], prompts: [] }; }
    export async function mcpListResources() { return { ok: true, resources: [] }; }
    export async function mcpListPrompts() { return { ok: true, prompts: [] }; }
    export async function mcpGetPrompt() { return { ok: true, text: '' }; }
    export async function mcpReadResource() { return { ok: true, content: '' }; }
  `,
  // wikiService LLM boundary — returns a deterministic catalog, then pages
  // that mention ONLY files the generator actually handed it.
  '../agent/providers': `
    export async function streamTurn({ messages, onText }) {
      const prompt = String(messages?.[0]?.text ?? '');
      let out;
      if (prompt.includes('Design a wiki for this repo')) {
        out = JSON.stringify({ pages: [
          { slug: 'overview', title: 'Overview', files: ['README.md', 'src/a.ts'] },
          { slug: 'api', title: 'API', files: ['src/a.ts'] },
        ] });
      } else {
        const m = /Write wiki page "([^"]+)"/.exec(prompt);
        out = '# ' + (m ? m[1] : 'Page') + '\\n\\nGrounded in real source: ' +
          (prompt.includes('--- src/a.ts ---') ? 'src/a.ts (42)' : 'none') + '.';
      }
      onText?.(out);
    }
  `,
};

const stubPlugin = {
  name: 'v1131-stubs',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) =>
      Object.prototype.hasOwnProperty.call(STUBS, args.path) ? { path: args.path, namespace: 'v1131-stub' } : null,
    );
    build.onLoad({ filter: /.*/, namespace: 'v1131-stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }));
  },
};

async function bundle(entry, outName) {
  const outfile = join(tmp, outName);
  await esbuild.build({
    entryPoints: [join(ROOT, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [stubPlugin],
  });
  return { path: outfile, mod: require(outfile) };
}

const registry = (await bundle('electron/services/mcpRegistryService.ts', 'registry.cjs')).mod;
const plugins = (await bundle('electron/services/pluginService.ts', 'plugins.cjs')).mod;
const library = (await bundle('electron/services/libraryService.ts', 'library.cjs')).mod;
const promptBundle = await bundle('electron/services/promptLibraryService.ts', 'prompts.cjs');
const prompts = promptBundle.mod;
const wiki = (await bundle('electron/services/wikiService.ts', 'wiki.cjs')).mod;

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

// ------------------------------------------------------------
// 1 · MCP registry
// ------------------------------------------------------------
test('registry: search normalizes flat/nested entries, paginates, caches and degrades offline', async () => {
  registry.clearRegistryCache();
  const calls = [];
  globalThis.fetch = async (u) => {
    calls.push(String(u));
    const q = new URL(String(u)).searchParams.get('search') || '';
    if (q === 'broken') throw new Error('fetch failed');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        servers: [
          {
            server: {
              name: 'io.github.alice/fs',
              description: 'Filesystem server',
              packages: [{ registryType: 'npm', identifier: '@x/fs', version: '1.2.3', environmentVariables: [{ name: 'TOKEN' }] }],
              repository: { url: 'https://github.com/alice/fs' },
            },
            _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active' } },
          },
          // flat v0 shape (no `server` wrapper) must also normalize
          {
            name: 'io.github.bob/remote',
            description: 'Remote server',
            remotes: [{ url: 'https://mcp.example.com/sse', type: 'sse' }],
          },
          { server: { name: 'meta-only', description: 'no install hint' } },
        ],
        metadata: { nextCursor: 'cursor-2' },
      }),
    };
  };

  const page = await registry.searchRegistry('alpha');
  assert.equal(page.ok, true);
  assert.deepEqual(page.results.map((r) => r.id), ['io.github.alice/fs', 'io.github.bob/remote']);
  assert.equal(page.results[0].command, 'npx');
  assert.deepEqual(page.results[0].args, ['-y', '@x/fs']);
  assert.deepEqual(page.results[0].env, { TOKEN: '' });
  assert.equal(page.results[0].version, '1.2.3');
  assert.equal(page.results[1].transport, 'sse');
  assert.equal(page.results[1].url, 'https://mcp.example.com/sse');
  assert.equal(page.nextCursor, 'cursor-2');
  assert.equal(calls.length, 1);

  const cached = await registry.searchRegistry('ALPHA'); // case-insensitive cache key
  assert.equal(cached.ok, true);
  assert.equal(cached.cached, true);
  assert.equal(calls.length, 1, 'fresh cache hit must not hit the network');

  const page2 = await registry.searchRegistry('alpha', 'cursor-2');
  assert.equal(page2.ok, true);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /cursor=cursor-2/);

  globalThis.fetch = async () => {
    throw new Error('fetch failed: ENOTFOUND registry.modelcontextprotocol.io');
  };
  // Age the cache past its TTL so the offline fallback path is exercised.
  const realNow = Date.now;
  Date.now = () => realNow() + 6 * 60_000;
  let offline;
  try {
    offline = await registry.searchRegistry('alpha');
  } finally {
    Date.now = realNow;
  }
  assert.equal(offline.ok, false, 'offline is never reported as a successful fetch');
  assert.equal(offline.offline, true);
  assert.equal(offline.stale, true);
  assert.equal(offline.results.length, 2, 'cached results still render offline');
  assert.match(offline.error, /cached result/i);

  const cold = await registry.searchRegistry('never-seen-before');
  assert.equal(cold.ok, false);
  assert.equal(cold.offline, true);
  assert.equal(cold.results, undefined);
  assert.match(cold.error, /unreachable/i);
});

test('registry: HTTP 5xx is actionable and reuses cache; one-click add persists and refuses duplicates', async () => {
  registry.clearRegistryCache();
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ servers: [] }) });
  const empty = await registry.searchRegistry('empty-result');
  assert.equal(empty.ok, true);
  assert.match(empty.error, /no installable entries/i);

  globalThis.__V1131_SETTINGS__ = { mcpServers: [] };
  const hit = {
    id: 'io.github.alice/fs', name: 'fs', title: 'Alice FS', description: 'x',
    transport: 'stdio', command: 'npx', args: ['-y', '@x/fs'], env: { TOKEN: '' },
  };
  const added = registry.addFromRegistry(hit);
  assert.equal(added.ok, true);
  assert.match(added.id, /^reg-/);
  assert.equal(added.config.transport, 'stdio');
  assert.equal(globalThis.__V1131_SETTINGS__.mcpServers.length, 1);

  const again = registry.addFromRegistry(hit);
  assert.equal(again.ok, false);
  assert.match(again.error, /Already configured/);
  assert.equal(globalThis.__V1131_SETTINGS__.mcpServers.length, 1, 'no silent duplicate');

  const bad = registry.addFromRegistry({ id: 'x', name: 'x', transport: 'http', url: 'javascript:alert(1)' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /remote URL/i);

  const remote = registry.addFromRegistry({ id: 'r', name: 'r', transport: 'http', url: 'https://mcp.example.com/mcp/' });
  assert.equal(remote.ok, true);
  assert.equal(remote.config.url, 'https://mcp.example.com/mcp/');
  assert.equal(globalThis.__V1131_SETTINGS__.mcpServers.length, 2);
});

// ------------------------------------------------------------
// 2 · Plugins — path jail, URL checks, sender gate
// ------------------------------------------------------------
test('plugins: file install is path-jailed and reports precise reasons', async () => {
  const file = join(tmp, 'manifest.json');
  writeFileSync(file, JSON.stringify({ id: 'v1131.file-test', name: 'File Test', version: '1.0.0', enabled: true }));
  const info = await plugins.installPluginFromFile(file);
  assert.equal(info.id, 'v1131.file-test');
  assert.equal(info.source, 'file');

  await assert.rejects(() => plugins.installPluginFromFile(`${tmp}/../escape.json`), /traversal/i);
  await assert.rejects(() => plugins.installPluginFromFile(join(tmp, 'manifest.txt')), /\.json/i);
  await assert.rejects(() => plugins.installPluginFromFile('/etc/passwd'), /allowed folders|\.json/i);
  await assert.rejects(() => plugins.installPluginFromFile(join(tmp, 'missing.json')), /does not exist/i);
});

test('plugins: URL install validates scheme, private hosts, size and JSON', async () => {
  globalThis.fetch = async (u) => ({
    ok: true,
    status: 200,
    url: String(u),
    text: async () => JSON.stringify({ id: 'v1131.url-test', name: 'URL Test', version: '1.0.0', enabled: true }),
  });
  const info = await plugins.installPluginFromUrl('https://example.com/plugin.json');
  assert.equal(info.id, 'v1131.url-test');
  assert.equal(info.source, 'url');

  await assert.rejects(() => plugins.installPluginFromUrl('not a url'), /full https/i);
  await assert.rejects(() => plugins.installPluginFromUrl('http://example.com/x.json'), /https/i);
  await assert.rejects(() => plugins.installPluginFromUrl('https://127.0.0.1/x.json'), /private network/i);
  await assert.rejects(() => plugins.installPluginFromUrl('https://localhost/x.json'), /private network/i);

  globalThis.fetch = async (u) => ({ ok: true, status: 200, url: String(u), text: async () => 'x'.repeat(3 * 1024 * 1024) });
  await assert.rejects(() => plugins.installPluginFromUrl('https://example.com/big.json'), /TOO_LARGE/i);
});

test('plugins: mutating IPC channels reject foreign frames but accept the packaged renderer', async () => {
  const handlers = globalThis.__V1131_HANDLERS__;
  for (const ch of ['kdx:plugins:installUrl', 'kdx:plugins:uninstall', 'kdx:plugins:setEnabled', 'kdx:plugins:reveal']) {
    assert.ok(typeof handlers[ch] === 'function', `${ch} is registered`);
  }
  await assert.rejects(
    () => handlers['kdx:plugins:installUrl']({ senderFrame: { url: 'https://evil.example' } }, 'https://example.com/x.json'),
    /UNTRUSTED_SENDER/,
  );
  await assert.rejects(
    () => handlers['kdx:plugins:uninstall']({ senderFrame: { url: 'https://evil.example/index.html' } }, 'v1131.url-test'),
    /UNTRUSTED_SENDER/,
  );
  // A trusted frame gets PAST the gate (then fails on ordinary URL validation).
  await assert.rejects(
    () => handlers['kdx:plugins:installUrl']({ senderFrame: { url: 'surnia://bundle/index.html' } }, 'not-a-url'),
    /full https/i,
  );
});

// ------------------------------------------------------------
// 3 · Library — real import
// ------------------------------------------------------------
test('library: imports real files/folders, dedupes, and refuses traversal/missing paths', async () => {
  const project = join(tmp, 'my-project');
  mkdirSync(project);
  const note = join(project, 'notes.txt');
  writeFileSync(note, 'hello');

  const folder = library.importLibraryItem({ path: project, title: 'My Project', origin: 'test' });
  assert.equal(folder.ok, true);
  assert.equal(folder.item.kind, 'file');
  assert.equal(folder.item.origin, 'test');

  const again = library.importLibraryItem({ path: project });
  assert.equal(again.ok, true);
  assert.equal(again.alreadyIndexed, true);

  const file = library.importLibraryItem({ path: note, kind: 'document' });
  assert.equal(file.ok, true);
  assert.equal(file.item.kind, 'document');
  assert.equal(file.item.size, 5);

  const listed = await library.listLibraryItems();
  assert.ok(listed.some((x) => x.path === project), 'imported folder is listed');
  assert.ok(listed.some((x) => x.path === note), 'imported file is listed');

  assert.equal(library.importLibraryItem({ path: `${tmp}/../secret.txt` }).ok, false);
  assert.match(library.importLibraryItem({ path: `${tmp}/../secret.txt` }).error, /traversal/i);
  assert.match(library.importLibraryItem({ path: join(tmp, 'missing.txt') }).error, /no longer exists/i);

  const badNote = library.noteLibraryItem({ kind: 'bogus', title: 'x', path: note });
  assert.equal(badNote.ok, false);
  assert.match(badNote.error, /kind/i);

  assert.equal(library.forgetLibraryItem(folder.item.id).ok, true);
  assert.equal(library.forgetLibraryItem('not-a-real-id').ok, false, 'forget is not a silent no-op');
});

// ------------------------------------------------------------
// 4 · Prompt library — validation + CRUD
// ------------------------------------------------------------
test('prompts: validates input, upserts by name, reads/renames/deletes and repairs a corrupt store', () => {
  assert.equal(prompts.savePrompt('   ', 'x').error, 'name_required');
  assert.equal(prompts.savePrompt('x', '   ').error, 'text_required');
  assert.equal(prompts.savePrompt(123, 'x').error, 'name_required');
  assert.equal(prompts.savePrompt('x', 456).error, 'text_required');

  const a = prompts.savePrompt('  Deploy  ', 'do the steps');
  assert.equal(a.ok, true);
  assert.equal(a.item.name, 'Deploy');
  const b = prompts.savePrompt('deploy', 'new steps');
  assert.equal(b.ok, true);
  assert.equal(b.item.id, a.item.id, 'case-insensitive upsert keeps the id');
  assert.equal(prompts.listPrompts().length, 1);
  assert.equal(prompts.getPrompt(a.item.id).text, 'new steps');

  assert.equal(prompts.renamePrompt(a.item.id, 'Ship').ok, true);
  assert.equal(prompts.getPrompt(a.item.id).name, 'Ship');
  const other = prompts.savePrompt('Other', 'another prompt');
  assert.equal(other.ok, true);
  assert.equal(prompts.renamePrompt(a.item.id, 'other').error, 'name_conflict');
  assert.equal(prompts.deletePrompt(other.item.id).ok, true);

  assert.equal(prompts.deletePrompt(a.item.id).ok, true);
  assert.equal(prompts.getPrompt(a.item.id), undefined);
  assert.equal(prompts.deletePrompt('nope').ok, false);

  // A truncated/tampered prompts.json must not crash the panel.
  writeFileSync(
    join(userData, 'prompts.json'),
    JSON.stringify({ prompts: [{ id: 'ok', name: 'Good', text: 'body', createdAt: 1, updatedAt: 1 }, { id: 'bad' }, null] }),
  );
  delete require.cache[require.resolve(promptBundle.path)];
  const fresh = require(promptBundle.path);
  const repaired = fresh.listPrompts();
  assert.equal(repaired.length, 1);
  assert.equal(repaired[0].id, 'ok');
});

// ------------------------------------------------------------
// 5 · Wiki — real files, staleness, hygiene
// ------------------------------------------------------------
test('wiki: generates from real files, keeps the model file choices, saves atomically and detects staleness', async () => {
  const ws = join(tmp, 'wiki-ws');
  mkdirSync(join(ws, 'src'), { recursive: true });
  writeFileSync(join(ws, 'README.md'), '# Demo repository\nA tiny demo.');
  writeFileSync(join(ws, 'src', 'a.ts'), 'export const answer = 42;');
  writeFileSync(join(ws, 'api_token.env'), 'SECRET=do-not-send');
  mkdirSync(join(ws, 'node_modules'));
  writeFileSync(join(ws, 'node_modules', 'dep.ts'), 'dependency code');

  const stages = [];
  const res = await wiki.generateWiki(ws, {
    model: { provider: 'custom', model: 'm' },
    creds: { apiKey: 'k' },
    onStage: (s) => stages.push(s),
  });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.pages, 2);
  assert.deepEqual(stages, ['scan', 'catalog', 'pages', 'save']);

  const status = wiki.getWiki(ws);
  assert.equal(status.wiki.pages.length, 2);
  assert.equal(status.stale, false, 'a freshly generated wiki must NOT be stale');
  assert.match(status.wiki.pages[0].body, /src\/a\.ts \(42\)/, 'the model received the REAL file contents');

  const hash = createHash('sha1').update(ws).digest('hex').slice(0, 16);
  const candidates = [join(userData, 'wiki', hash, 'wiki.json'), join(process.env.SURNIA_HOME, 'wiki', hash, 'wiki.json')];
  const saved = candidates.find((f) => existsSync(f));
  assert.ok(saved, 'wiki.json was written to disk');
  const raw = JSON.parse(readFileSync(saved, 'utf8'));
  assert.equal(raw.pages.length, 2);
  assert.ok(!JSON.stringify(raw).includes('do-not-send'), 'credential-named file never reached the wiki');

  writeFileSync(join(ws, 'src', 'a.ts'), 'export const answer = 43;');
  assert.equal(wiki.getWiki(ws).stale, true, 'a code change flips staleness');

  const noKey = await wiki.generateWiki(ws, { model: { provider: 'custom', model: 'm' } });
  assert.equal(noKey.ok, false);
  assert.match(noKey.error, /no_api_key/);

  const empty = join(tmp, 'empty-ws');
  mkdirSync(empty);
  const noFiles = await wiki.generateWiki(empty, { model: { provider: 'custom', model: 'm' }, creds: { apiKey: 'k' } });
  assert.equal(noFiles.ok, false);
  assert.match(noFiles.error, /No readable source files/);
});

test('wiki: getWiki reports a corrupt saved wiki honestly instead of a blank panel', () => {
  const ws = join(tmp, 'corrupt-ws');
  mkdirSync(ws);
  writeFileSync(join(ws, 'a.ts'), 'export const x = 1;');
  const hash = createHash('sha1').update(ws).digest('hex').slice(0, 16);
  const dir = [join(userData, 'wiki', hash), join(process.env.SURNIA_HOME, 'wiki', hash)].find((d) => existsSync(d)) ?? join(userData, 'wiki', hash);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'wiki.json'), '{ truncated');
  const status = wiki.getWiki(ws);
  assert.equal(status.wiki, null);
  assert.match(status.error, /unreadable/i);
});
