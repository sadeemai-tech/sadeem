// ============================================================
// Surnia — MCP registry service (v3.1)
// Server registry CRUD + curated presets + health aggregation +
// resources/prompts browsing (incl. prompts/get) + the OFFICIAL remote
// registry (registry.modelcontextprotocol.io) search & add flow.
// The agent layer (agent/mcp.ts) stays protocol-only; this file
// owns persistence, presets, call counters (mcp-stats.json) and health.
// Owned by: orchestrator (wave 1.3) — MCP agent (E3) enhances.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import type {
  MCPServerConfig,
  MCPServersResult,
  MCPServerStatus,
  MCPRegistryPreset,
  MCPResourceInfo,
  MCPPromptInfo,
  MCPResourceContent,
  MCPTransport,
  MCPToolInfo,
} from '../../shared/types';
import {
  mcpListResources,
  mcpListPrompts,
  mcpGetPrompt,
  mcpReadResource,
  mcpProbeServer,
} from '../agent/mcp';
// Namespace import (not a named one): headless/legacy test bundles stub
// ../agent/mcp with a fixed export set. We guard the optional member below so
// those builds keep bundling AND get an honest error instead of a crash.
import * as mcpClient from '../agent/mcp';
import { buildMcpToolDefs } from '../agent/tool-defs';
import type { ToolDef } from '../agent/providers';
import * as store from './storeService';

/** Preset + v3.1 cwd hint. `${workspace}` in cwd/args resolves at spawn time
 *  (agent/mcp.ts resolvePlaceholders) — presets stay cross-platform: the
 *  Windows npx/uvx .cmd problem is handled by the spawn shim there, NOT by
 *  per-OS command forks here. */
type PresetEx = MCPRegistryPreset & { cwd?: string };

// ---------- curated presets (one-click add) — refreshed for the CURRENT ecosystem ----------
export const PRESETS: PresetEx[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read/write/search files inside your current workspace.',
    category: 'Core',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '${workspace}'],
    cwd: '${workspace}',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent knowledge-graph memory across sessions.',
    category: 'Core',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Structured step-by-step reasoning and plan revision.',
    category: 'Reasoning',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
  },
  {
    id: 'everything',
    name: 'Everything (demo)',
    description: 'Reference server exercising every MCP capability.',
    category: 'Testing',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/everything',
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description: 'Fetch web pages and convert them to markdown.',
    category: 'Web',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    id: 'git',
    name: 'Git',
    description: 'Read and analyze the git repo of the current workspace.',
    category: 'Dev tools',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-git'],
    cwd: '${workspace}',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
  },
  {
    id: 'time',
    name: 'Time',
    description: 'Time and timezone conversion utilities.',
    category: 'Core',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-time'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
  },
  {
    id: 'playwright',
    name: 'Playwright',
    description: 'Drive a real browser: navigate, click, screenshot, scrape.',
    category: 'Web',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    docsUrl: 'https://github.com/microsoft/playwright-mcp',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web and local search via the Brave Search API.',
    category: 'Web',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@brave/brave-search-mcp-server'],
    env: { BRAVE_API_KEY: '' },
    docsUrl: 'https://github.com/brave/brave-search-mcp-server',
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'Query and explore a SQLite database in the workspace.',
    category: 'Data',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-sqlite', '--db-path', './data.db'],
    cwd: '${workspace}',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repos, issues, PRs and code search through the official GitHub MCP server.',
    category: 'Dev',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Read-only exploration of a Postgres database: schemas and safe queries.',
    category: 'Data',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    env: { POSTGRESQL_CONNECTION_STRING: 'postgresql://localhost:5432/postgres' },
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    description: 'Second browser driver: navigate, fill forms, screenshot pages.',
    category: 'Web',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'List channels, read history and post messages in a Slack workspace.',
    category: 'Productivity',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: '' },
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'firebase',
    name: 'Firebase',
    description: 'Firebase project tools: Firestore data, auth users, hosting deploys.',
    category: 'Dev',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@firebase/mcp@latest'],
    docsUrl: 'https://firebase.google.com/docs/cli/mcp-mcp',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Manage Supabase projects: tables, SQL, edge functions, logs.',
    category: 'Data',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@supabase/mcp-server-supabase@latest'],
    env: { SUPABASE_ACCESS_TOKEN: '' },
    docsUrl: 'https://github.com/supabase-community/supabase-mcp',
  },
  {
    id: 'docker',
    name: 'Docker',
    description: 'Containers, images, volumes and compose through the Docker MCP toolkit.',
    category: 'Dev',
    transport: 'stdio',
    command: 'docker',
    args: ['run', '-i', '--rm', 'alpine/socat', 'STDIO', 'TCP:host.docker.internal:2375'],
    docsUrl: 'https://docs.docker.com/ai/mcp-catalog-and-toolkit/',
  },
  {
    id: 'figma',
    name: 'Figma',
    description:
      'Read Figma frames, components and dev-mode metadata for design-to-code handoff. Requires the Figma desktop app or a Figma API token.',
    category: 'Design',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'figma-developer-mcp', '--stdio'],
    env: { FIGMA_API_KEY: '' },
    docsUrl: 'https://github.com/GLips/Figma-Context-MCP',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    description:
      'Manage Vercel projects, deployments, domains and logs through the official hosted MCP server. Auth: OAuth in browser or header "Authorization: Bearer <VERCEL_TOKEN>".',
    category: 'Dev',
    transport: 'http',
    url: 'https://mcp.vercel.com',
    docsUrl: 'https://vercel.com/docs/mcp/vercel-mcp',
  },
  {
    id: 'linear',
    name: 'Linear',
    description:
      'Issues, projects, cycles and teams in Linear through the official hosted MCP server. Auth: OAuth — Linear opens its sign-in on first connect.',
    category: 'Productivity',
    transport: 'http',
    url: 'https://mcp.linear.app/mcp',
    docsUrl: 'https://linear.app/developers/mcp',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Bindings',
    description:
      'Cloudflare Workers platform tools (KV, R2, D1, bindings) — one of the official remote MCP server family; the docs page lists them all. Auth: header "Authorization: Bearer <CLOUDFLARE_API_TOKEN>".',
    category: 'Dev',
    transport: 'http',
    url: 'https://bindings.mcp.cloudflare.com/mcp',
    docsUrl: 'https://docs.mcp.cloudflare.com/',
  },
  {
    id: 'notion',
    name: 'Notion',
    description:
      'Search, read and update Notion pages and databases via the official server. OPENAPI_MCP_HEADERS must be a JSON header blob, e.g. {"Authorization": "Bearer ntn_...", "Notion-Version": "2022-06-28"}. Remote alternative: https://mcp.notion.com/sse.',
    category: 'Productivity',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    env: { OPENAPI_MCP_HEADERS: '' },
    docsUrl: 'https://github.com/makenotion/notion-mcp-server',
  },
  {
    id: 'github-remote',
    name: 'GitHub (remote)',
    description:
      'Official hosted GitHub MCP server: repos, issues, PRs and code search without a local process. Auth: header "Authorization: Bearer <GITHUB_PERSONAL_ACCESS_TOKEN>" (PAT with repo scope).',
    category: 'Dev',
    transport: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    docsUrl: 'https://github.com/github/github-mcp-server',
  },
];

// ---------- persistence ----------
function servers(): MCPServerConfig[] {
  return store.getSettings().mcpServers ?? [];
}

function persist(next: MCPServerConfig[]): void {
  const s = store.getSettings();
  store.saveSettings({ ...s, mcpServers: next });
}

function msgOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------- validation helpers ----------
function isHttpUrl(url: unknown): boolean {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

function plainStringRecord(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  let any = false;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof k !== 'string' || !k.trim()) continue;
    out[k] = typeof val === 'string' ? val : String(val ?? '');
    any = true;
  }
  return any ? out : undefined;
}

function positiveInt(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 1000 ? Math.round(n) : undefined;
}

/** v7.3 — clean a tool allow/deny list: strings, trimmed, non-empty. */
function toolPatternList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .map((s) => String(s ?? '').trim())
    .filter((s) => s.length > 0);
  return out.length ? Array.from(new Set(out)) : undefined;
}

// ---------- CRUD ----------
export function saveServer(cfg: MCPServerConfig): { ok: boolean; error?: string } {
  const list = servers();
  const transport = cfg.transport ?? 'stdio';
  const name = String(cfg.name ?? '').trim() || 'Untitled server';

  // per-transport validation
  if (transport === 'stdio') {
    if (!String(cfg.command ?? '').trim()) {
      return { ok: false, error: `MCP server "${name}" needs a command for the stdio transport.` };
    }
  } else if (!isHttpUrl(cfg.url)) {
    return { ok: false, error: `MCP server "${name}" needs an http(s) URL for the ${transport} transport.` };
  }

  const clean: MCPServerConfig = {
    ...cfg,
    id: cfg.id || `srv-${Date.now().toString(36)}`,
    name,
    command: String(cfg.command ?? '').trim(),
    args: Array.isArray(cfg.args) ? cfg.args.map(String).filter((a) => a.length > 0) : undefined,
    env: plainStringRecord(cfg.env),
    enabled: cfg.enabled !== false,
    transport,
    url: transport === 'stdio' ? undefined : String(cfg.url ?? '').trim(),
    headers: plainStringRecord(cfg.headers),
    timeoutMs: positiveInt(cfg.timeoutMs),
    autoReconnect: cfg.autoReconnect ? true : undefined,
    // v3.1 — working directory for the stdio spawn (`${workspace}` resolves
    // at spawn time in agent/mcp.ts). Empty string clears it on edit.
    cwd: String(cfg.cwd ?? '').trim() || undefined,
  };
  // v7.3 — per-server tool allow/deny lists. Written ONLY when provided so an
  // edit-form save (whose form has no such field) preserves the lists the
  // user maintains on the server card; clearing happens through the card
  // inputs (renderer settings save), which always carry the full config.
  const toolAllow = toolPatternList(cfg.toolAllow);
  if (toolAllow) clean.toolAllow = toolAllow;
  const toolDeny = toolPatternList(cfg.toolDeny);
  if (toolDeny) clean.toolDeny = toolDeny;
  // calls counter: only written when explicitly provided; edits keep the old count
  if (typeof cfg.calls === 'number' && Number.isFinite(cfg.calls)) clean.calls = cfg.calls;
  const i = list.findIndex((m) => m.id === clean.id);
  if (i >= 0) list[i] = { ...list[i], ...clean };
  else list.push({ ...clean, calls: clean.calls ?? 0 });
  persist(list);
  return { ok: true };
}

export function deleteServer(id: string): { ok: boolean } {
  persist(servers().filter((m) => m.id !== id));
  return { ok: true };
}

// ---------- call counters (userData/mcp-stats.json, v3.1) ----------
// recordToolCall used to rewrite the ENTIRE settings.json on every successful
// tool call, racing the renderer's own settings saves (lost edits on both
// sides). Counters now live in their own file with the same 0600 atomic
// (tmp + rename) write pattern. Public behavior is unchanged.

let statsCache: Record<string, number> | null = null;
let statsDirty = false;

function statsFilePath(): string {
  try {
    // Lazy require: under the headless CLI bundle `electron` is a path stub
    // and app is undefined — counters then degrade to session-only.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as { app?: { getPath?: (k: string) => string } };
    const ud = app?.getPath?.('userData');
    if (!ud) throw new Error('no userData');
    return path.join(ud, 'mcp-stats.json');
  } catch {
    return ''; // app not ready / non-electron — memory-only fallback
  }
}

function loadStats(): Record<string, number> {
  if (statsCache) return statsCache;
  const parsed: Record<string, number> = {};
  const file = statsFilePath();
  if (file) {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          const n = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
          if (k) parsed[k] = n;
        }
      }
    } catch {
      /* no file / corrupted — start at zero */
    }
  }
  statsCache = parsed;
  return parsed;
}

/** Atomic 0600 write (tmp file + rename) so a crash never truncates the file. */
function flushStats(): void {
  if (!statsCache || !statsDirty) return;
  const file = statsFilePath();
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(statsCache, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
    statsDirty = false;
  } catch {
    /* read-only userData — counters degrade to session-only */
  }
}

/** Bump the persisted tool-invocation counter for a server (mcp-stats.json). */
export function recordToolCall(serverId: string): void {
  const id = String(serverId ?? '');
  if (!id) return;
  const stats = loadStats();
  stats[id] = (stats[id] ?? 0) + 1;
  statsDirty = true;
  flushStats();
}

/** Read a server's persisted call counter (panel/UI). */
export function serverCalls(serverId: string): number {
  return loadStats()[String(serverId ?? '')] ?? 0;
}

// ---------- status ----------
function statusFor(cfg: MCPServerConfig): MCPServerStatus {
  return {
    id: cfg.id,
    name: cfg.name,
    state: cfg.enabled ? 'disconnected' : 'disabled',
    toolCount: 0,
    resourceCount: 0,
    promptCount: 0,
  };
}

/** Probe one enabled server: tools + resources + prompts counts, latency, state. */
async function probeStatus(cfg: MCPServerConfig): Promise<MCPServerStatus> {
  const t0 = Date.now();
  try {
    const probe = await mcpProbeServer(cfg);
    const latencyMs = Date.now() - t0;
    if (!probe.ok) {
      return {
        ...statusFor(cfg),
        state: 'error',
        error: probe.error,
        latencyMs,
        lastCheckedAt: Date.now(),
      };
    }
    return {
      ...statusFor(cfg),
      state: 'connected',
      toolCount: probe.tools?.length ?? 0,
      resourceCount: probe.resources?.length ?? 0,
      promptCount: probe.prompts?.length ?? 0,
      latencyMs,
      lastCheckedAt: Date.now(),
    };
  } catch (err) {
    return { ...statusFor(cfg), state: 'error', error: msgOf(err), lastCheckedAt: Date.now() };
  }
}

/** List servers + presets. Probes each enabled server (parallel, per-server isolation). */
export async function listServers(): Promise<MCPServersResult> {
  const list = servers();
  const statuses = await Promise.all(
    list.map(async (cfg): Promise<MCPServerStatus> => {
      if (!cfg.enabled) return { ...statusFor(cfg), state: 'disabled' };
      try {
        return await probeStatus(cfg);
      } catch (err) {
        // one dead server must never break the whole list
        return { ...statusFor(cfg), state: 'error', error: msgOf(err), lastCheckedAt: Date.now() };
      }
    }),
  );
  return {
    servers: statuses,
    presets: PRESETS,
    totalTools: statuses.reduce((n, s) => n + s.toolCount, 0),
  };
}

/** Force (re)connect a single server — full probe, returns its fresh status. */
export async function connect(id: string): Promise<MCPServerStatus> {
  const cfg = servers().find((m) => m.id === id);
  if (!cfg) {
    return {
      id,
      name: id,
      state: 'error',
      error: `Unknown MCP server: ${id}`,
      toolCount: 0,
      resourceCount: 0,
      promptCount: 0,
    };
  }
  return probeStatus(cfg);
}

// ============================================================
// v11.36 — LOSSLESS CONNECTED TOOLS FOR THE AGENT LAYER
//
// The panel only ever needed tool COUNTS, so this service used to
// expose no way to hand the agent the ACTUAL tools of a connected
// server. The engine therefore builds `enabledMcp` from settings +
// its own fire-and-forget discovery, which loses cold servers on the
// first turn. These helpers give one honest, lossless source:
//   • EVERY enabled server is probed for its FULL tool list — no
//     slice, no first-N, no "first server only";
//   • a server that fails to connect is reported in `errors` with
//     the real message (never presented as a connected empty one);
//   • `connectedMcpToolDefs` turns that into real defs via the
//     canonical tool-defs.ts builder (exact name + inputSchema).
// Handoff: engine.ts should seed `enabledMcp` from this on a cold
// start so the founder's "use Blender" works on the FIRST request.
// ============================================================

export interface ConnectedMcpServersResult {
  servers: { server: MCPServerConfig; tools: MCPToolInfo[] }[];
  errors: { server: MCPServerConfig; error: string }[];
}

/** Probe enabled servers, return connected ones WITH all their tools. */
export async function connectedServersWithTools(): Promise<ConnectedMcpServersResult> {
  const connected: ConnectedMcpServersResult['servers'] = [];
  const errors: ConnectedMcpServersResult['errors'] = [];
  const enabled = servers().filter((s) => s && s.enabled !== false && Boolean(s.command || s.url));

  type ListTools = (server: MCPServerConfig) => Promise<{
    ok: boolean;
    tools?: MCPToolInfo[];
    error?: string;
  }>;
  const listTools = (mcpClient as unknown as { mcpListTools?: ListTools }).mcpListTools;

  await Promise.all(
    enabled.map(async (cfg) => {
      try {
        if (typeof listTools !== 'function') {
          errors.push({ server: cfg, error: 'MCP tools/list is unavailable in this build.' });
          return;
        }
        const res = await listTools(cfg);
        if (!res.ok || !Array.isArray(res.tools)) {
          errors.push({
            server: cfg,
            error: res.error || `MCP server "${cfg.name}" did not return a tool list.`,
          });
          return;
        }
        connected.push({ server: cfg, tools: res.tools });
      } catch (err) {
        errors.push({ server: cfg, error: msgOf(err) });
      }
    }),
  );
  return { servers: connected, errors };
}

/** Connected servers → EVERY MCP tool def. No truncation, no phantom defs. */
export async function connectedMcpToolDefs(): Promise<ToolDef[]> {
  const { servers: connected } = await connectedServersWithTools();
  return buildMcpToolDefs(connected);
}

// ---------- resources & prompts (probed per-server) ----------
export async function listResources(id: string): Promise<MCPResourceInfo[]> {
  const cfg = servers().find((m) => m.id === id);
  if (!cfg) throw new Error(`Unknown MCP server: ${id}`);
  const res = await mcpListResources(cfg);
  if (!res.ok || !res.resources) {
    throw new Error(res.error || `MCP server "${cfg.name}" does not expose resources.`);
  }
  return res.resources;
}

export async function readResource(id: string, uri: string): Promise<MCPResourceContent> {
  const cfg = servers().find((m) => m.id === id);
  if (!cfg) throw new Error(`Unknown MCP server: ${id}`);
  const res = await mcpReadResource(cfg, uri);
  if (!res.ok || !res.content) {
    throw new Error(res.error || `MCP server "${cfg.name}" failed to read ${uri}.`);
  }
  return res.content;
}

export async function listPrompts(id: string): Promise<MCPPromptInfo[]> {
  const cfg = servers().find((m) => m.id === id);
  if (!cfg) throw new Error(`Unknown MCP server: ${id}`);
  const res = await mcpListPrompts(cfg);
  if (!res.ok || !res.prompts) {
    throw new Error(res.error || `MCP server "${cfg.name}" does not expose prompts.`);
  }
  return res.prompts;
}

/**
 * prompts/get (v3.1): fetch one prompt with simple key=value args and return
 * the messages rendered as text (agent/mcp.ts does the rendering).
 */
export async function getPrompt(
  id: string,
  promptName: string,
  args?: Record<string, string>,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const cfg = servers().find((m) => m.id === id);
  if (!cfg) return { ok: false, error: `Unknown MCP server: ${id}` };
  const res = await mcpGetPrompt(cfg, String(promptName ?? ''), args);
  if (!res.ok || typeof res.text !== 'string') {
    return { ok: false, error: res.error || `MCP server "${cfg.name}" failed to get prompt "${promptName}".` };
  }
  return { ok: true, text: res.text };
}

// ============================================================
// Official MCP registry (v2.0 / E3) — registry.modelcontextprotocol.io
// ============================================================

const REGISTRY_BASE = 'https://registry.modelcontextprotocol.io/v0/servers';
const REGISTRY_TIMEOUT_MS = 8_000;
const REGISTRY_PAGE_SIZE = 20;
/** Fresh results are reused within this window; expired ones stay as the offline fallback. */
const REGISTRY_CACHE_TTL_MS = 5 * 60_000;
const REGISTRY_CACHE_MAX = 50;

interface CachedRegistryPage { at: number; page: MCPRegistrySearchPage }
const registryCache = new Map<string, CachedRegistryPage>();

function registryCacheKey(query: string, cursor?: string): string {
  return `${query.trim().toLowerCase()}\u0000${cursor ?? ''}`;
}

/** Clear the in-process registry cache (manual refresh / isolated tests). */
export function clearRegistryCache(): void {
  registryCache.clear();
}

function rememberPage(key: string, page: MCPRegistrySearchPage): void {
  registryCache.set(key, { at: Date.now(), page });
  while (registryCache.size > REGISTRY_CACHE_MAX) {
    const oldest = registryCache.keys().next().value;
    if (oldest === undefined) break;
    registryCache.delete(oldest);
  }
}

/** Offline/HTTP failures still return usable results when we have seen this query before. */
function failWithCache(key: string, offline: boolean, message: string): MCPRegistrySearchPage {
  const hit = registryCache.get(key);
  if (!hit?.page.results?.length) return { ok: false, offline, error: message };
  return {
    ok: false,
    offline,
    stale: true,
    cached: true,
    cachedAt: hit.at,
    results: hit.page.results,
    ...(hit.page.nextCursor ? { nextCursor: hit.page.nextCursor } : {}),
    error: `${message} Showing ${hit.page.results.length} cached result(s) from ${new Date(hit.at).toLocaleTimeString()}.`,
  };
}

/** One server entry from the official registry, normalized for the add flow. */
export interface MCPRegistrySearchResult {
  /** Registry-qualified name (e.g. io.github.user/server). */
  id: string;
  name: string;
  title?: string;
  description: string;
  version?: string;
  /** Registry lifecycle status (active/deprecated/…). */
  status?: string;
  /** Install transport implied by the entry: local packages → stdio, remote URL → http. */
  transport: MCPTransport;
  /** stdio install hint (e.g. `npx -y pkg`). */
  command?: string;
  args?: string[];
  /** http/sse remote URL, when the entry ships one. */
  url?: string;
  /** Env-var NAMES the package expects (values left empty for the user). */  
  env?: Record<string, string>;
  docsUrl?: string;
}

export interface MCPRegistrySearchPage {
  ok: boolean;
  results?: MCPRegistrySearchResult[];
  /** Registry pagination cursor — pass back to searchRegistry for the next page. */
  nextCursor?: string;
  error?: string;
  offline?: boolean;
  /** True when these results were served from the in-process cache. */
  cached?: boolean;
  /** True when the network failed and cached results are being shown offline. */
  stale?: boolean;
  /** When the cached page was fetched (for an actionable "last synced" hint). */
  cachedAt?: number;
}

/** Substring that looks like a bare package identifier (npm/pypi name). */
function firstString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function registryEnvNames(raw: unknown): Record<string, string> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const name = firstString(o.name);
    if (name) out[name] = '';
  }
  return Object.keys(out).length ? out : undefined;
}

/** Normalize one raw registry entry; tolerates both v0 shapes (nested/flat). */
function mapRegistryEntry(entry: unknown): MCPRegistrySearchResult | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  const s = (e.server && typeof e.server === 'object' ? e.server : e) as Record<string, unknown>;
  const name = firstString(s.name);
  if (!name) return null;
  const meta = (e._meta && typeof e._meta === 'object'
    ? ((e._meta as Record<string, unknown>)['io.modelcontextprotocol.registry/official'] as Record<string, unknown> | undefined)
    : undefined) as Record<string, unknown> | undefined;

  const packages = Array.isArray(s.packages) ? (s.packages as unknown[]) : [];
  const remotes = Array.isArray(s.remotes) ? (s.remotes as unknown[]) : [];
  const remote0 = (remotes[0] ?? null) as Record<string, unknown> | null;
  const pkg0 = (packages[0] ?? null) as Record<string, unknown> | null;

  let transport: MCPTransport = 'stdio';
  let command: string | undefined;
  let args: string[] | undefined;
  let url: string | undefined;
  let env: Record<string, string> | undefined;

  if (remote0 && typeof remote0.url === 'string' && /^https?:\/\//i.test(remote0.url)) {
    transport = 'http';
    url = remote0.url;
    const remoteType = firstString(remote0.type);
    if (remoteType === 'sse') transport = 'sse';
  } else if (pkg0 && typeof pkg0.identifier === 'string') {
    const regType = String(pkg0.registryType ?? 'npm').toLowerCase();
    const ident = String(pkg0.identifier);
    if (regType === 'pypi') {
      command = 'uvx';
      args = [ident];
    } else if (regType === 'oci') {
      command = 'docker';
      args = ['run', '--rm', '-i', ident];
    } else {
      command = 'npx';
      args = ['-y', ident];
    }
    env = registryEnvNames(pkg0.environmentVariables);
  } else if (typeof s.url === 'string' && /^https?:\/\//i.test(s.url)) {
    transport = 'http';
    url = s.url;
  } else {
    return null; // no usable install hint (e.g. meta-only entry)
  }

  const repo = (s.repository ?? null) as Record<string, unknown> | null;
  const shortName = name.includes('/') ? (name.split('/').pop() as string) : name;
  const result: MCPRegistrySearchResult = {
    id: name,
    name: shortName,
    title: firstString(s.title),
    description: typeof s.description === 'string' ? s.description : '',
    version: firstString(pkg0?.version) ?? firstString(s.version) ?? firstString(meta?.version),
    status: firstString(meta?.status),
    transport,
    command,
    args,
    url,
    env,
    docsUrl: firstString(repo?.url) ?? firstString(s.homepage) ?? firstString(s.websiteUrl),
  };
  return result;
}

/**
 * Search the official MCP registry (paginated). Never throws — an offline
 * machine gets `{ ok:false, offline:true, error }` so the UI can degrade.
 */
export async function searchRegistry(query: string, cursor?: string): Promise<MCPRegistrySearchPage> {
  const q = typeof query === 'string' ? query.trim() : '';
  const next = typeof cursor === 'string' && cursor ? cursor : undefined;
  const key = registryCacheKey(q, next);

  // 1) Fresh cache hit — no network, no spinner, identical results.
  const fresh = registryCache.get(key);
  if (fresh && Date.now() - fresh.at < REGISTRY_CACHE_TTL_MS) {
    return {
      ...fresh.page,
      ok: true,
      cached: true,
      error: undefined,
      cachedAt: fresh.at,
    };
  }

  const url = new URL(REGISTRY_BASE);
  url.searchParams.set('limit', String(REGISTRY_PAGE_SIZE));
  if (q) url.searchParams.set('search', q);
  if (next) url.searchParams.set('cursor', next);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REGISTRY_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: ac.signal,
    });
    if (!res.ok) {
      return failWithCache(
        key,
        res.status >= 500,
        `Registry responded HTTP ${res.status}${res.statusText ? ` (${res.statusText})` : ''}. Check the registry status or try again in a moment.`,
      );
    }
    const data: unknown = await res.json();
    const rows = Array.isArray(data)
      ? (data as unknown[])
      : Array.isArray((data as Record<string, unknown> | null)?.servers)
        ? ((data as Record<string, unknown>).servers as unknown[])
        : [];
    const results = rows
      .map(mapRegistryEntry)
      .filter((r): r is MCPRegistrySearchResult => r !== null);
    const meta = (data as Record<string, unknown> | null)?.metadata as Record<string, unknown> | undefined;
    const nextCursor = firstString(meta?.nextCursor);
    const page: MCPRegistrySearchPage = {
      ok: true,
      results,
      ...(nextCursor ? { nextCursor } : {}),
    };
    if (results.length) rememberPage(key, page); // never cache an empty/invalid page
    else return { ok: true, results, error: 'The registry returned no installable entries for this search.' };
    return page;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const offline = /abort|timeout|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|fetch failed|network|offline/i.test(msg);
    return failWithCache(
      key,
      offline,
      offline
        ? 'The MCP registry is unreachable (offline or blocked). Curated presets below still work.'
        : `Registry search failed: ${msg}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build a full server config from a registry result and persist it.
 * The UI confirms with the user BEFORE calling this.
 */
/** Identity of an install, used to refuse silent duplicate one-click adds. */
function installKey(cfg: MCPServerConfig): string {
  const transport = cfg.transport ?? 'stdio';
  if (transport !== 'stdio') {
    return `remote:${String(cfg.url ?? '').trim().replace(/\/+$/, '').toLowerCase()}`;
  }
  const args = (Array.isArray(cfg.args) ? cfg.args : []).map((a) => String(a)).join('\u0000');
  const env = Object.entries(cfg.env ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\u0000');
  return `stdio:${String(cfg.command ?? '').trim().toLowerCase()}\u0000${args}\u0000${env}`;
}

export function addFromRegistry(
  raw: MCPRegistrySearchResult,
  nameOverride?: string,
): { ok: boolean; id?: string; config?: MCPServerConfig; error?: string } {
  // defensive re-normalization — the payload crosses the IPC boundary
  const result: MCPRegistrySearchResult = {
    ...raw,
    id: String(raw?.id ?? ''),
    name: String(raw?.name ?? ''),
    description: String(raw?.description ?? ''),
    transport: raw?.transport === 'http' || raw?.transport === 'sse' ? raw.transport : 'stdio',
    command: typeof raw?.command === 'string' ? raw.command : undefined,
    args: Array.isArray(raw?.args) ? raw.args.map((a) => String(a)).filter((a) => a.trim().length > 0).slice(0, 64) : undefined,
    url: typeof raw?.url === 'string' ? raw.url.trim() : undefined,
    env: raw?.env && typeof raw.env === 'object'
      ? Object.fromEntries(Object.entries(raw.env).map(([k, v]) => [String(k), String(v ?? '')]))
      : undefined,
  };
  const requested = typeof nameOverride === 'string' ? nameOverride.trim().slice(0, 80) : '';
  const name = requested || String(result.title ?? '').trim() || String(result.name ?? '').trim() || 'Registry server';

  if (result.transport === 'stdio' && !result.command) {
    return { ok: false, error: `Registry entry "${name}" ships no installable command — install it manually.` };
  }
  if (result.transport !== 'stdio' && !isHttpUrl(result.url)) {
    return { ok: false, error: `Registry entry "${name}" has no valid http(s) remote URL — install it manually.` };
  }

  const cfg: MCPServerConfig = {
    id: `reg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    command: result.transport === 'stdio' ? String(result.command ?? '').trim() : '',
    args: result.transport === 'stdio' ? result.args : undefined,
    env: result.transport === 'stdio' ? result.env : undefined,
    enabled: true,
    transport: result.transport,
    url: result.transport === 'stdio' ? undefined : result.url,
  };

  // One-click add must be idempotent: clicking twice (or adding a server that
  // is already configured) reports the existing server instead of appending a
  // duplicate that spawns the same process twice.
  const duplicate = servers().find((m) => installKey(m) === installKey(cfg));
  if (duplicate) {
    return { ok: false, id: duplicate.id, error: `Already configured as "${duplicate.name}" — nothing new was added.` };
  }

  const saved = saveServer(cfg);
  if (!saved.ok) return { ok: false, error: saved.error };
  return { ok: true, id: cfg.id, config: cfg };
}
