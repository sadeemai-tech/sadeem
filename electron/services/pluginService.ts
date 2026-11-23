// ============================================================
// pluginService — v11.38 SADEEM Plugins (PRO).
//
// A plugin is a JSON manifest (installed under
// <userData>/plugins/<id>/plugin.json, optionally with a bundled
// skills/ folder) that can contribute:
//   · MCP server configs   → merged into every agent run (enabled only)
//   · slash prompts        → REAL /name commands (enabled only)
//   · skills               → copied into the global skills root at install
// Install sources: a local .json file, a https:// URL (2MB cap), or the
// built-in starter catalog. Follows the sessionService self-registration
// pattern (ipc.ts only side-effect imports this module).
//
// v11.38 PRO contract (the founder: "البلوجينز يجب ان تعمل"):
//   1. validate BEFORE touching disk; reject with precise, honest reasons;
//   2. every id used as a path segment is jailed (no traversal / escape);
//   3. manifests are written atomically, so a crash cannot corrupt state;
//   4. enable/disable is a TRANSACTION: the enabled plugin's contributions
//      (MCP servers + slash command files) are reconciled in the same step;
//   5. contribution file names obey slashService's NAME_RE — this was the
//      core bug: `plugin__<id>__<name>.md` contains DOTS and was therefore
//      INVISIBLE to the slash scanner, so plugin prompts never worked;
//   6. ownership of command files is persisted in .command-owners.json, so
//      disable/uninstall removes ONLY our files and survives a restart;
//   7. no silent `.catch(() => undefined)` on installation-critical work.
// ============================================================
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { app, ipcMain } from 'electron';
import type { MCPServerConfig, PluginInfo, PluginManifest } from '../../shared/types';

const PLUGINS_DIRNAME = 'plugins';
const MAX_PLUGIN_BYTES = 2 * 1024 * 1024; // 2MB manifest cap
const MAX_MCP_PER_PLUGIN = 16;
const MAX_PROMPTS_PER_PLUGIN = 32;
const MAX_PROMPT_BYTES = 64 * 1024;
const MAX_PROMPT_NAME = 60;
const ID_RE = /^[a-z0-9][a-z0-9-_.]{1,63}$/;
const PROMPT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,59}$/;
const OWNERS_FILE = '.command-owners.json';

/**
 * Builtin slash names (src/lib/modes.ts SLASH_COMMANDS + SLASH_STORE_EXTRA +
 * the four main-process task modes). A plugin must not ship a prompt that
 * shadows one of these — /changelog was such a collision in the old starter.
 * Keep this set in sync with modes.ts (handoff noted in PLUGINS-PRO-V1138.md).
 */
const RESERVED_COMMANDS = new Set(
  [
    'clear', 'compact', 'rewind', 'undo', 'continue', 'fork', 'export', 'goal', 'schedule', 'handoff',
    'init', 'context', 'cost', 'dna', 'build', 'plan', 'debug', 'review', 'tests', 'diff', 'test',
    'explain', 'commit', 'pr', 'grill', 'changelog', 'flows', 'effort', 'model', 'profile', 'mode',
    'budget', 'settings', 'theme', 'lang', 'plans', 'terminal', 'help', 'git', 'mcp', 'skills',
    'usage', 'library', 'prompts', 'status', 'share', 'plugins',
  ].map((s) => s.toLowerCase()),
);

function pluginsRoot(): string {
  // Test/contract override — same key every other file-backed service honours.
  if (process.env.SADEEM_TEST_USERDATA) return path.join(process.env.SADEEM_TEST_USERDATA, PLUGINS_DIRNAME);
  try {
    if (app?.getPath) return path.join(app.getPath('userData'), PLUGINS_DIRNAME);
  } catch {
    /* headless */
  }
  return path.join(process.env.KODEX_HOME || path.join(process.cwd(), '.surnia-home'), PLUGINS_DIRNAME);
}

/** Every id that reaches the filesystem goes through here. No exceptions. */
function assertPluginId(raw: unknown): string {
  const clean = String(raw ?? '');
  if (!ID_RE.test(clean)) {
    throw new Error('PLUGIN_INVALID_ID: id must match ' + ID_RE.source + ' (no path separators or traversal)');
  }
  return clean;
}

function pluginFile(id: string): string {
  return path.join(pluginsRoot(), assertPluginId(id), 'plugin.json');
}

// ---------- path jail for renderer-supplied manifest paths ----------

function insideRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function pluginAllowedRoots(): string[] {
  const roots = [pluginsRoot(), os.homedir(), os.tmpdir(), process.cwd()];
  try {
    const ud = app?.getPath?.('userData');
    if (ud) roots.push(ud);
  } catch {
    /* headless */
  }
  return Array.from(new Set(roots.filter(Boolean).map((r) => path.resolve(r))));
}

function jailPluginFile(filePath: string): string {
  const raw = String(filePath ?? '').trim();
  if (!raw) throw new Error('PLUGIN_PATH_INVALID: choose a plugin .json manifest file');
  if (raw.includes('\u0000')) throw new Error('PLUGIN_PATH_INVALID: NUL byte in path');
  const slashed = raw.replace(/\\/g, '/');
  if (/^\/\//.test(slashed)) throw new Error('PLUGIN_PATH_BLOCKED: UNC/network and device paths are not allowed');
  if (raw.split(/[\\/]+/).includes('..')) throw new Error('PLUGIN_PATH_BLOCKED: .. traversal is not allowed');
  if (path.extname(raw).toLowerCase() !== '.json') throw new Error('PLUGIN_PATH_INVALID: plugin manifest must be a .json file');

  const abs = path.resolve(raw);
  const roots = pluginAllowedRoots();
  if (!roots.some((r) => insideRoot(r, abs))) {
    throw new Error('PLUGIN_PATH_BLOCKED: file is outside the allowed folders (home, temp, workspace, app data)');
  }
  let real = abs;
  try {
    real = fs.realpathSync(abs); // resolves a symlink to its true target
  } catch {
    throw new Error('PLUGIN_NOT_FOUND: manifest file does not exist');
  }
  if (!roots.some((r) => insideRoot(r, real))) {
    throw new Error('PLUGIN_PATH_BLOCKED: symlink points outside the allowed folders');
  }
  let st: fs.Stats;
  try {
    st = fs.statSync(real);
  } catch {
    throw new Error('PLUGIN_NOT_FOUND: manifest file does not exist');
  }
  if (!st.isFile()) throw new Error('PLUGIN_PATH_INVALID: manifest must be a regular file');
  if (st.size > MAX_PLUGIN_BYTES) throw new Error('PLUGIN_TOO_LARGE: manifest exceeds 2MB');
  return real;
}

/** Same user-commands dir slashService scans: SURNIA_HOME || KODEX_HOME || ~/.surnia. */
function userCommandsDir(): string {
  const home = process.env.SURNIA_HOME || process.env.KODEX_HOME || path.join(process.env.HOME || process.env.USERPROFILE || process.cwd(), '.surnia');
  return path.join(home, 'commands');
}

// ---------- atomic, jailed persistence ----------

async function writeFileAtomic(file: string, data: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmpFile = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await fsp.writeFile(tmpFile, data, { encoding: 'utf8', mode: 0o600 });
  try {
    await fsp.rename(tmpFile, file);
  } catch (err) {
    // Windows cannot rename over an existing file — remove, then retry once.
    if (process.platform === 'win32' && fs.existsSync(file)) {
      await fsp.rm(file, { force: true });
      await fsp.rename(tmpFile, file);
    } else {
      await fsp.rm(tmpFile, { force: true }).catch(() => undefined);
      throw err;
    }
  }
}

function writeManifest(id: string, m: PluginManifest): Promise<void> {
  return writeFileAtomic(pluginFile(id), JSON.stringify(m, null, 2));
}

function readManifest(id: string): PluginManifest | null {
  try {
    const raw = fs.readFileSync(pluginFile(id), 'utf8');
    const j = JSON.parse(raw) as PluginManifest;
    // A manifest whose id does not match its directory is a broken/unsafe install.
    if (!j || typeof j !== 'object' || !ID_RE.test(String(j.id)) || j.id !== id) return null;
    return j;
  } catch {
    return null;
  }
}

function readAllManifests(): PluginManifest[] {
  try {
    const root = pluginsRoot();
    if (!fs.existsSync(root)) return [];
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && ID_RE.test(e.name))
      .map((e) => readManifest(e.name))
      .filter((m): m is PluginManifest => !!m);
  } catch {
    return [];
  }
}

function toInfo(m: PluginManifest): PluginInfo {
  return {
    id: m.id,
    name: m.name || m.id,
    version: m.version || '0.0.0',
    description: m.description,
    author: m.author,
    enabled: m.enabled === true,
    source: m.source ?? 'file',
    installedAt: m.installedAt ?? 0,
    mcpCount: Array.isArray(m.mcpServers) ? m.mcpServers.length : 0,
    promptCount: Array.isArray(m.prompts) ? m.prompts.length : 0,
    dir: path.join(pluginsRoot(), m.id),
  };
}

/** Validate + NORMALIZE a manifest BEFORE it touches disk. Throws precise reasons. */
function validateManifest(raw: unknown): PluginManifest {
  const j = raw as Partial<PluginManifest> & Record<string, unknown>;
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('PLUGIN_INVALID: not a JSON object');
  if (typeof j.id !== 'string' || !ID_RE.test(j.id)) {
    throw new Error('PLUGIN_INVALID: id must match ' + ID_RE.source);
  }
  if (typeof j.name !== 'string' || !j.name.trim() || j.name.length > 120) {
    throw new Error('PLUGIN_INVALID: name must be a non-empty string (max 120 chars)');
  }
  for (const key of ['description', 'author', 'engineVersion'] as const) {
    if (j[key] !== undefined && (typeof j[key] !== 'string' || j[key]!.length > 500)) {
      throw new Error(`PLUGIN_INVALID: ${key} must be a string (max 500 chars)`);
    }
  }
  if (j.enabled !== undefined && typeof j.enabled !== 'boolean') {
    throw new Error('PLUGIN_INVALID: enabled must be a boolean');
  }
  if (j.source !== undefined && !['builtin', 'file', 'url'].includes(String(j.source))) {
    throw new Error('PLUGIN_INVALID: unknown source');
  }
  if (j.mcpServers !== undefined && !Array.isArray(j.mcpServers)) {
    throw new Error('PLUGIN_INVALID: mcpServers must be an array');
  }
  if (j.prompts !== undefined && !Array.isArray(j.prompts)) {
    throw new Error('PLUGIN_INVALID: prompts must be an array');
  }
  if ((j.mcpServers?.length ?? 0) > MAX_MCP_PER_PLUGIN) {
    throw new Error(`PLUGIN_INVALID: too many mcpServers (max ${MAX_MCP_PER_PLUGIN})`);
  }
  if ((j.prompts?.length ?? 0) > MAX_PROMPTS_PER_PLUGIN) {
    throw new Error(`PLUGIN_INVALID: too many prompts (max ${MAX_PROMPTS_PER_PLUGIN})`);
  }

  const mcpServers: MCPServerConfig[] = (j.mcpServers ?? []).map((s, i) => {
    const v = s as Partial<MCPServerConfig> | null;
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      throw new Error(`PLUGIN_INVALID: mcpServers[${i}] must be an object`);
    }
    const name = typeof v.name === 'string' ? v.name.trim() : '';
    const id = typeof v.id === 'string' && v.id.trim() ? v.id.trim() : name;
    if (!name || !id) throw new Error('PLUGIN_INVALID: each mcpServer needs a name and command|url');
    if (id.length > 120 || name.length > 120 || /\u0000/.test(id + name)) {
      throw new Error(`PLUGIN_INVALID: mcpServers[${i}] id/name is too long or contains NUL`);
    }
    const transport = (v.transport ?? 'stdio') as MCPServerConfig['transport'];
    if (!['stdio', 'http', 'sse'].includes(String(transport))) {
      throw new Error(`PLUGIN_INVALID: mcpServers[${i}] transport must be stdio|http|sse`);
    }
    let command = typeof v.command === 'string' ? v.command.trim() : '';
    const url = typeof v.url === 'string' ? v.url.trim() : '';
    if (transport === 'stdio') {
      if (!command) throw new Error('PLUGIN_INVALID: each mcpServer needs a name and command|url');
    } else if (!url) {
      throw new Error('PLUGIN_INVALID: each mcpServer needs a name and command|url');
    } else {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
          throw new Error('bad protocol/credentials');
        }
      } catch {
        throw new Error(`PLUGIN_INVALID: mcpServers[${i}] url must be a plain http(s) URL`);
      }
      command = command || (transport === 'sse' ? 'sse' : 'http');
    }
    if (command.length > 1024 || /\u0000/.test(command)) {
      throw new Error(`PLUGIN_INVALID: mcpServers[${i}] command is invalid`);
    }
    if (v.args !== undefined) {
      if (!Array.isArray(v.args) || v.args.length > 64 || v.args.some((a) => typeof a !== 'string' || a.length > 2048 || /\u0000/.test(a))) {
        throw new Error(`PLUGIN_INVALID: mcpServers[${i}] args must be ≤64 short strings`);
      }
    }
    for (const key of ['env', 'headers'] as const) {
      const obj = v[key];
      if (obj !== undefined) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj as object).length > 64) {
          throw new Error(`PLUGIN_INVALID: mcpServers[${i}] ${key} must be a small object`);
        }
        for (const [k, val] of Object.entries(obj as Record<string, unknown>)) {
          if (typeof val !== 'string' || val.length > 4096 || /\u0000/.test(val)) {
            throw new Error(`PLUGIN_INVALID: mcpServers[${i}] ${key}.${k} must be a string`);
          }
        }
      }
    }
    return {
      ...v,
      id,
      name,
      command,
      url: url || undefined,
      transport,
      args: v.args ? [...(v.args as string[])] : undefined,
      enabled: true, // an enabled plugin's servers are active by definition
    } as MCPServerConfig;
  });

  const promptNames = new Set<string>();
  const prompts: NonNullable<PluginManifest['prompts']> = (j.prompts ?? []).map((p, i) => {
    const v = p as { name?: unknown; description?: unknown; prompt?: unknown };
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`PLUGIN_INVALID: prompts[${i}] must be an object`);
    const name = typeof v.name === 'string' ? v.name.trim().toLowerCase() : '';
    if (!PROMPT_NAME_RE.test(name) || name.length > MAX_PROMPT_NAME) {
      throw new Error(`PLUGIN_INVALID: prompt name must match ${PROMPT_NAME_RE.source} (max ${MAX_PROMPT_NAME})`);
    }
    if (RESERVED_COMMANDS.has(name)) {
      throw new Error(`PLUGIN_INVALID: prompt name "/${name}" is reserved by a builtin command`);
    }
    if (promptNames.has(name)) throw new Error(`PLUGIN_INVALID: duplicate prompt name "/${name}"`);
    promptNames.add(name);
    if (typeof v.prompt !== 'string' || !v.prompt.trim() || Buffer.byteLength(v.prompt, 'utf8') > MAX_PROMPT_BYTES) {
      throw new Error(`PLUGIN_INVALID: prompt "/${name}" needs a non-empty body (max 64KB)`);
    }
    if (v.description !== undefined && (typeof v.description !== 'string' || v.description.length > 200)) {
      throw new Error(`PLUGIN_INVALID: prompt "/${name}" description must be a string (max 200 chars)`);
    }
    return {
      name,
      description: typeof v.description === 'string' ? v.description.replace(/[\r\n]+/g, ' ').trim() : undefined,
      prompt: v.prompt,
    };
  });

  // Checked LAST so a malformed contribution reports its own precise reason
  // (legacy v10.2 test contract) instead of a missing-version warning.
  if (typeof j.version !== 'string' || !j.version.trim() || j.version.length > 40) {
    throw new Error('PLUGIN_INVALID: version must be a non-empty string (max 40 chars)');
  }
  return {
    ...(j as object),
    id: j.id,
    name: j.name.trim(),
    version: j.version.trim(),
    mcpServers,
    prompts,
    // A manifest without an explicit `enabled` installs ACTIVE — plugins must work.
    enabled: j.enabled !== false,
  } as PluginManifest;
}

// ---------- contributed slash commands (the real fix) ----------

interface CommandOwners {
  v: 1;
  /** command file name (e.g. "research.md") → owning plugin id */
  owners: Record<string, string>;
}

function ownersFile(): string {
  return path.join(pluginsRoot(), OWNERS_FILE);
}

function loadCommandOwners(): CommandOwners {
  try {
    const j = JSON.parse(fs.readFileSync(ownersFile(), 'utf8')) as Partial<CommandOwners>;
    if (j && j.v === 1 && j.owners && typeof j.owners === 'object' && !Array.isArray(j.owners)) {
      const owners: Record<string, string> = {};
      for (const [file, id] of Object.entries(j.owners)) {
        if (/^[a-z0-9][a-z0-9_-]*\.md$/.test(file) && typeof id === 'string' && ID_RE.test(id)) owners[file] = id;
      }
      return { v: 1, owners };
    }
  } catch {
    /* missing/corrupt registry — rebuild from scratch */
  }
  return { v: 1, owners: {} };
}

function commandBody(pr: { name: string; description?: string; prompt: string }): string {
  const title = (pr.description || pr.name).replace(/[\r\n]+/g, ' ').slice(0, 100);
  return `# ${title}\n\n${pr.prompt}\n`;
}

/** Old (broken) file naming — kept only so pre-v11.38 installs clean up. */
const LEGACY_COMMAND_RE = /^plugin__([a-z0-9-_.]+)__[a-z0-9_-]+\.md$/;

async function removeLegacyCommands(id: string): Promise<void> {
  const clean = assertPluginId(id);
  try {
    const names = await fsp.readdir(userCommandsDir()).catch(() => [] as string[]);
    for (const f of names) {
      const m = LEGACY_COMMAND_RE.exec(f);
      if (m && m[1] === clean) await fsp.rm(path.join(userCommandsDir(), f), { force: true });
    }
  } catch {
    /* headless — nothing to clean */
  }
}

export interface PluginCommandSyncResult {
  /** Number of live, slash-visible plugin commands. */
  commands: number;
  /** Command names that could not be published (user file collision / plugin conflict). */
  conflicts: string[];
}

/**
 * Reconcile command files with the ENABLED plugin set. This is the single
 * writer of plugin slash commands and is called by install / enable / disable /
 * uninstall. Files are named EXACTLY <slug>.md so slashService's NAME_RE
 * accepts them (the old plugin__<id>__<name>.md names were silently ignored).
 */
export async function syncPluginCommands(): Promise<PluginCommandSyncResult> {
  const enabled = readAllManifests().filter((m) => m.enabled).sort((a, b) => a.id.localeCompare(b.id));
  const desired = new Map<string, { body: string; owner: string }>();
  const conflicts: string[] = [];
  for (const m of enabled) {
    for (const pr of m.prompts ?? []) {
      const slug = PROMPT_NAME_RE.test(pr.name) ? pr.name.toLowerCase() : '';
      if (!slug) continue;
      const file = `${slug}.md`;
      if (desired.has(file)) {
        conflicts.push(slug); // deterministic: first (lowest plugin id) wins
        continue;
      }
      desired.set(file, { body: commandBody(pr), owner: m.id });
    }
  }

  const dir = userCommandsDir();
  await fsp.mkdir(dir, { recursive: true });
  const state = loadCommandOwners();

  // 1. remove files we owned that are no longer desired (disable/uninstall/rename).
  for (const [file, owner] of Object.entries(state.owners)) {
    const entry = desired.get(file);
    if (!entry || entry.owner !== owner) {
      await fsp.rm(path.join(dir, file), { force: true });
      delete state.owners[file];
    }
  }

  // 2. publish enabled prompts. Never clobber a user-owned command file.
  //    Re-scan AFTER step 1 so files we just removed are not mistaken for
  //    user-owned commands on a disable → re-enable cycle.
  const existing = new Set(await fsp.readdir(dir).catch(() => [] as string[]));
  for (const [file, entry] of desired) {
    const previousOwner = state.owners[file];
    if (!previousOwner && existing.has(file)) {
      conflicts.push(file.replace(/\.md$/, '')); // user file wins — honest, no overwrite
      continue;
    }
    try {
      await writeFileAtomic(path.join(dir, file), entry.body);
      state.owners[file] = entry.owner;
    } catch (err) {
      throw new Error(`PLUGIN_COMMAND_WRITE_FAILED: ${file} :: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. legacy files are invisible to slashService but old tests/consumers may
  //    still look for them. Keep them in sync for enabled plugins only.
  const enabledIds = new Set(enabled.map((m) => m.id));
  for (const m of enabled) {
    for (const pr of m.prompts ?? []) {
      if (!PROMPT_NAME_RE.test(pr.name)) continue;
      await fsp.writeFile(path.join(dir, `plugin__${m.id}__${pr.name}.md`), commandBody(pr), 'utf8').catch(() => undefined);
    }
  }
  for (const f of existing) {
    const lm = LEGACY_COMMAND_RE.exec(f);
    if (lm && !enabledIds.has(lm[1])) await fsp.rm(path.join(dir, f), { force: true }).catch(() => undefined);
  }

  await writeFileAtomic(ownersFile(), JSON.stringify(state, null, 2));
  return { commands: desired.size - conflicts.length, conflicts };
}

/** Bundled skills → global skills root. Honest errors when a bundle exists but cannot be copied. */
async function adoptBundledSkills(id: string): Promise<number> {
  const src = path.join(pluginsRoot(), assertPluginId(id), 'skills');
  if (!fs.existsSync(src)) return 0;
  let dest: string;
  try {
    const { globalSkillsRoot } = await import('../agent/skills');
    dest = globalSkillsRoot();
  } catch (err) {
    throw new Error(`PLUGIN_SKILLS_FAILED: skills root unavailable :: ${err instanceof Error ? err.message : String(err)}`);
  }
  let n = 0;
  const walk = async (dir: string, out: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const s = path.join(dir, e.name);
      const d = path.join(out, e.name);
      if (e.isDirectory()) {
        await fsp.mkdir(d, { recursive: true });
        await walk(s, d, depth + 1);
      } else if (e.isFile()) {
        try {
          await fsp.copyFile(s, d);
          if (e.name === 'SKILL.md') n++;
        } catch (err) {
          throw new Error(`PLUGIN_SKILLS_FAILED: ${e.name} :: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  };
  await walk(src, path.join(dest, `plugin-${id}`), 0);
  return n;
}

// ---------- public API ----------

export function listPlugins(): PluginInfo[] {
  return readAllManifests().map(toInfo).sort((a, b) => a.id.localeCompare(b.id));
}

export async function installPluginFromObject(raw: unknown, source: PluginManifest['source']): Promise<PluginInfo> {
  const m = validateManifest(raw);
  const id = m.id;
  const manifest: PluginManifest = {
    ...m,
    enabled: m.enabled === true,
    source,
    installedAt: Date.now(),
  };
  const target = pluginFile(id);
  const previous = await fsp.readFile(target, 'utf8').catch(() => null);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await removeLegacyCommands(id);
  await writeManifest(id, manifest);
  try {
    await adoptBundledSkills(id);
    await syncPluginCommands();
  } catch (err) {
    // Roll back the install so a failed plugin never leaves half a state.
    if (previous !== null) await writeFileAtomic(target, previous).catch(() => undefined);
    else await fsp.rm(path.dirname(target), { recursive: true, force: true }).catch(() => undefined);
    await syncPluginCommands().catch(() => undefined);
    throw err instanceof Error ? err : new Error(String(err));
  }
  return toInfo(manifest);
}

export async function installPluginFromFile(filePath: string): Promise<PluginInfo> {
  const file = jailPluginFile(filePath);
  let raw: string;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch {
    throw new Error('PLUGIN_READ_FAILED: could not read the manifest file');
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_PLUGIN_BYTES) throw new Error('PLUGIN_TOO_LARGE: manifest exceeds 2MB');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('PLUGIN_INVALID: file is not valid JSON');
  }
  return installPluginFromObject(parsed, 'file');
}

/** Refuse loopback/private endpoints — a https: URL is not an SSRF free pass. */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '::1' ||
    h === '0.0.0.0' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h === '169.254.169.254' ||
    /^[a-z0-9-]+\.local$/i.test(h)
  );
}

export async function installPluginFromUrl(url: string): Promise<PluginInfo> {
  let u: URL;
  try {
    u = new URL(String(url ?? '').trim());
  } catch {
    throw new Error('PLUGIN_URL_INVALID: enter a full https:// plugin manifest URL');
  }
  if (u.protocol !== 'https:') throw new Error('PLUGIN_URL_BLOCKED: only https:// plugin URLs are allowed');
  if (isPrivateHost(u.hostname)) throw new Error('PLUGIN_URL_BLOCKED: loopback/private network URLs are not allowed');
  if (typeof fetch !== 'function') throw new Error('NO_FETCH_RUNTIME');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(u.toString(), { signal: ctrl.signal, redirect: 'follow' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(/abort|timeout/i.test(msg) ? 'TIMEOUT: plugin manifest download took too long' : `PLUGIN_FETCH_FAILED: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`PLUGIN_FETCH_FAILED: HTTP ${res.status}${res.statusText ? ` (${res.statusText})` : ''}`);
  // A https URL must not "follow" its way to a file: or loopback endpoint.
  const redirected = (res as { url?: string }).url;
  if (redirected) {
    try {
      const final = new URL(redirected);
      if (final.protocol !== 'https:' || isPrivateHost(final.hostname)) {
        throw new Error('PLUGIN_URL_BLOCKED: manifest redirected to a blocked endpoint');
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('PLUGIN_URL_BLOCKED')) throw err;
      /* a stub without a parseable .url is fine */
    }
  }
  const headers = (res as { headers?: { get?: (name: string) => string | null } }).headers;
  const declared = typeof headers?.get === 'function' ? headers.get('content-length') : null;
  if (declared && Number(declared) > MAX_PLUGIN_BYTES) throw new Error('PLUGIN_TOO_LARGE: manifest exceeds 2MB');
  const text = await res.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_PLUGIN_BYTES) throw new Error('PLUGIN_TOO_LARGE: manifest exceeds 2MB');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('PLUGIN_INVALID: URL did not return JSON');
  }
  return installPluginFromObject(parsed, 'url');
}

export async function uninstallPlugin(rawId: string): Promise<true> {
  const id = assertPluginId(rawId);
  const dir = path.join(pluginsRoot(), id);
  if (fs.existsSync(dir)) await fsp.rm(dir, { recursive: true, force: true });
  await removeLegacyCommands(id);
  // Recompute owners from the remaining plugins: only our files are removed.
  await syncPluginCommands();
  // Bundled skills live under plugin-<id> — remove those too (best-effort).
  try {
    const { globalSkillsRoot } = await import('../agent/skills');
    const skillDir = path.join(globalSkillsRoot(), `plugin-${id}`);
    if (fs.existsSync(skillDir)) await fsp.rm(skillDir, { recursive: true, force: true });
  } catch {
    /* headless */
  }
  return true;
}

export async function setPluginEnabled(rawId: string, enabled: boolean): Promise<PluginInfo> {
  const id = assertPluginId(rawId);
  const m = readManifest(id);
  if (!m) throw new Error('PLUGIN_NOT_FOUND');
  const next: PluginManifest = { ...m, enabled: enabled === true };
  await writeManifest(id, next);
  try {
    await syncPluginCommands(); // MCP servers are read live from manifests on every run.
  } catch (err) {
    // Roll back the flag: never leave "enabled" UI with dead contributions.
    await writeManifest(id, m).catch(() => undefined);
    await syncPluginCommands().catch(() => undefined);
    throw new Error(`PLUGIN_SYNC_FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
  return toInfo(next);
}

/** MCP servers contributed by ENABLED plugins (injected into every agent run). */
export function enabledPluginMcpServers(): MCPServerConfig[] {
  const out: MCPServerConfig[] = [];
  for (const m of readAllManifests()) {
    if (!m.enabled) continue;
    for (const s of m.mcpServers ?? []) {
      if (s && (s.command || s.url))
        out.push({ ...s, id: `plugin__${m.id}__${s.id || s.name}`, name: `plugin__${m.id}__${s.name}`, enabled: true });
    }
  }
  return out;
}

/** Slash prompts contributed by ENABLED plugins: /name → prompt text. */
export function enabledPluginPrompts(): Map<string, { prompt: string; description?: string }> {
  const out = new Map<string, { prompt: string; description?: string }>();
  for (const m of readAllManifests()) {
    if (!m.enabled) continue;
    for (const pr of m.prompts ?? []) {
      if (pr && PROMPT_NAME_RE.test(pr.name) && typeof pr.prompt === 'string') {
        out.set(pr.name.toLowerCase(), { prompt: pr.prompt, description: pr.description });
      }
    }
  }
  return out;
}

// ---------- built-in starter catalog (installable with one click) ----------

interface StarterDef {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  mcpServers?: MCPServerConfig[];
  prompts?: { name: string; description?: string; prompt: string }[];
}

/**
 * Starters are REAL capability packs: filesystem/fetch MCP servers run via
 * npx on demand; the prompts become REAL /slash commands. Nothing auto-installed.
 */
export const STARTER_PLUGINS: StarterDef[] = [
  {
    id: 'sadeem.starter-web',
    name: 'Web Pack',
    version: '1.0.0',
    description: 'Fetch MCP server (npx @modelcontextprotocol/server-fetch) + /research slash prompt for deep web digests.',
    author: 'SADEEM',
    mcpServers: [
      { id: 'fetch', name: 'fetch', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'], enabled: true },
    ],
    prompts: [
      {
        name: 'research',
        description: 'Deep web research digest with sources',
        prompt:
          'Research the topic I give you thoroughly: use web_search for at least 3 distinct queries, web_fetch the 3 most authoritative pages, then produce a structured digest (facts, numbers, disagreements, open questions) and CITE every fact with its source URL.\n\nTopic: $ARGUMENTS',
      },
    ],
  },
  {
    id: 'sadeem.starter-memory',
    name: 'Memory Pack',
    version: '1.0.0',
    description: 'Knowledge-graph memory MCP server (npx @modelcontextprotocol/server-memory) so the agent remembers entities across sessions.',
    author: 'SADEEM',
    mcpServers: [
      { id: 'memory', name: 'memory', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], enabled: true },
    ],
  },
  {
    id: 'sadeem.starter-git',
    name: 'Git Rituals',
    version: '1.0.0',
    description: 'Slash prompts for the daily git rituals: /ship (verify, commit, clean message), /git-changelog (conventional-changelog digest).',
    author: 'SADEEM',
    prompts: [
      {
        name: 'ship',
        description: 'Verify then commit with a clean conventional message',
        prompt:
          'Prepare to ship: 1) run the project verify command (build/test/typecheck) and fix failures, 2) review git diff --stat, 3) craft ONE conventional commit message (type(scope): subject in the user language, body explains why), 4) stage and commit. Do not push.',
      },
      {
        // /changelog is a BUILTIN renderer command (modes.ts) — using that name
        // would be shadowed and silently dead. Prefixed to a real, live slug.
        name: 'git-changelog',
        description: 'Generate a changelog digest from git history',
        prompt:
          'Read git log --oneline -30 and produce a user-facing changelog for the last 30 commits: group under Added / Changed / Fixed / Removed, one line each, no commit hashes.',
      },
    ],
  },
];

export function installStarter(id: string): Promise<PluginInfo> {
  const s = STARTER_PLUGINS.find((x) => x.id === id);
  if (!s) throw new Error('STARTER_NOT_FOUND');
  return installPluginFromObject({ ...s, enabled: true }, 'builtin');
}

// ---------- IPC self-registration (sessionService pattern) ----------

let pluginsIpcRegistered = false;

/**
 * Same origin predicate as ipc.ts::isTrustedRenderer. The plugin channels are
 * self-registered before registerIpc(), so they cannot reuse that helper —
 * but install/reveal are mutating operations and must not be callable from a
 * foreign frame. Read-only list/starters stay open (no side effects).
 */
function isTrustedRenderer(event: unknown): boolean {
  const url = (event as { senderFrame?: { url?: string } } | null)?.senderFrame?.url ?? '';
  if (/^surnia:\/\/bundle\//i.test(url)) return true; // packaged renderer
  if (/^file:/i.test(url)) return true; // packaged fallback
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(url); // loopback dev
}

function trustedHandle(channel: string, fn: (...args: never[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    if (!isTrustedRenderer(event)) throw new Error('UNTRUSTED_SENDER');
    // These handlers keep Electron's `(_e, ...args)` shape — forward the event.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (fn as (...a: any[]) => unknown)(event, ...args);
  });
}

function registerPluginsIpc(): void {
  if (pluginsIpcRegistered) return;
  if (!ipcMain || typeof ipcMain.handle !== 'function') return;
  pluginsIpcRegistered = true;

  ipcMain.handle('kdx:plugins:list', () => listPlugins());
  // v11.38 — starters advertise their real contributions so the Settings UI
  // can show "1 MCP server · 1 slash command" BEFORE the user installs.
  ipcMain.handle('kdx:plugins:starters', () =>
    STARTER_PLUGINS.map((s) => ({
      id: s.id,
      name: s.name,
      version: s.version,
      description: s.description,
      mcpCount: s.mcpServers?.length ?? 0,
      promptCount: s.prompts?.length ?? 0,
      mcpNames: (s.mcpServers ?? []).map((m) => m.name),
      promptNames: (s.prompts ?? []).map((p) => p.name),
    })),
  );
  trustedHandle('kdx:plugins:installFile', (_e, p?: unknown) => installPluginFromFile(String(p ?? '')));
  trustedHandle('kdx:plugins:installUrl', (_e, u?: unknown) => installPluginFromUrl(String(u ?? '')));
  trustedHandle('kdx:plugins:installStarter', (_e, id?: unknown) => installStarter(String(id ?? '')));
  trustedHandle('kdx:plugins:uninstall', (_e, id?: unknown) => uninstallPlugin(String(id ?? '')));
  trustedHandle('kdx:plugins:setEnabled', (_e, id?: unknown, on?: unknown) => setPluginEnabled(String(id ?? ''), on === true));
  trustedHandle('kdx:plugins:reveal', (_e, id?: unknown) => {
    const clean = assertPluginId(id);
    const dir = path.join(pluginsRoot(), clean);
    if (fs.existsSync(dir)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { shell } = require('electron') as typeof import('electron');
        void shell.openPath(dir);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  });
}

registerPluginsIpc();
