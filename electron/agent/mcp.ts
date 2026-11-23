// ============================================================
// Surnia — MCP (Model Context Protocol) client layer (v2.0)
// Transports:
//   stdio — local child process; JSON-RPC 2.0 over newline-
//           delimited stdout/stdin (MCP does NOT use Content-Length
//           framing).
//   http  — JSON-RPC 2.0 over HTTP POST (streamable-http style);
//           echoes the mcp-session-id response header back on
//           subsequent requests; also accepts SSE-framed replies.
//   sse   — legacy HTTP+SSE remote servers: GET the URL as
//           text/event-stream for server→client frames, POST
//           JSON-RPC to the endpoint announced by the 'endpoint'
//           event (fallback: the stream URL itself).
// Compatibility contract (agent/tools.ts + agent/engine.ts):
//   mcpListTools(server) / mcpCallTool(server, toolName, args)
// Registry probes (services/mcpRegistryService.ts):
//   mcpListResources / mcpReadResource / mcpListPrompts /
//   mcpProbeServer / createClient / mcpGetPrompt
// Dependency-free transports: node:child_process + the built-in fetch.
//
// v3.1 additions — the persistent client overhaul:
//   • POOLED CLIENTS: one live client per server, reused across tools/list +
//     tools/call (no more npx cold start per call; stateful servers — memory,
//     puppeteer, DB sessions — finally survive between calls). Idle TTL 5 min,
//     LRU cap 8, one fresh spawn attempt per call on failure, closeAllMcpClients()
//     for app shutdown. See getPersistentClient().
//   • PROTOCOL: initialize with '2025-06-18', negotiate down to 2025-03-26 /
//     2024-11-05, record serverInfo + capabilities; streamable-http sends
//     `MCP-Protocol-Version` on every post-init request.
//   • SERVER→CLIENT traffic answered: ping → empty result, notifications/
//     progress → captured per progressToken, notifications/tools/list_changed →
//     annotation cache invalidated + background re-probe.
//   • tools/list cursor pagination (max 10 pages).
//   • prompts/get (mcpGetPrompt) — UI only, never injected into the agent loop.
//   • SINGLE approval gate: the engine already asks for destructive tools;
//     this layer only enforces a remembered DENY from mcp-v2.json.
//   • Health tick pings the live pooled connection (cheap) instead of the old
//     connect+3-lists+kill probe; auto-restart respawns the persistent client.
//
// v2 additions (E3 — deep MCP):
//   • tool annotations (readOnlyHint/destructiveHint/idempotentHint/
//     openWorldHint/title) parsed from tools/list per the MCP spec
//   • description scanner (anti tool-poisoning) → `suspicious` codes
//   • per-destructive-call approval gate (dialog: once / always / deny)
//   • per-server quarantine (auto via scanner setting or manual)
//   • per-tool enable/disable (persisted in userData/mcp-v2.json)
//   • deterministic tools ordering (server+name byte order — cache friendly)
//   • ring-buffer call log (last 100 calls, session only)
//   • health monitor: 60s probes, stdio crash auto-restart w/ backoff,
//     `kdx:mcp:health` events + kdx:mcp:health* IPC (registered below)
// ============================================================
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { app, BrowserWindow, ipcMain } from 'electron';
import type {
  AgentEvent,
  MCPServerConfig,
  MCPToolInfo,
  MCPResourceInfo,
  MCPPromptInfo,
  MCPResourceContent,
} from '../../shared/types';
import { getSettings } from '../services/storeService';

// ---------- constants & small helpers ----------

// v11.31: request the current MCP revision (2025-11-25). Older servers answer
// with their own version (2025-06-18 / 2025-03-26 / 2024-11-05) — all are
// accepted during negotiation. 2025-11-25 also formalizes SSE resumption
// (Last-Event-ID) and cancellation (notifications/cancelled), both implemented
// below.
const PROTOCOL_VERSION = '2025-11-25';
/** Protocol revisions we know how to talk to (initialize negotiation). */
const SUPPORTED_PROTOCOL_VERSIONS: ReadonlySet<string> = new Set([
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
]);
const CLIENT_INFO = { name: 'Surnia', version: '3.1.0' } as const;
/**
 * v11.38 — REAL-WORLD TIMEOUT BUDGET (the "every MCP server errors" fix).
 * A stdio MCP server is frequently launched through `npx -y …` / `uvx …`:
 * the FIRST launch downloads and installs a package (tens of seconds on a
 * cold cache), and Blender's bridge additionally waits for its add-on socket.
 * The old 10s handshake budget killed those children before `initialize`
 * could finish — every server looked broken even though the protocol code was
 * correct. Cold startup now gets a generous budget; health pings stay at 5s.
 */
const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;
/** v11.38: list/read probes are bounded, but no longer 10s — a cold HTTP server can be slow. */
const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
/** v11.38: a Blender render / long tool legitimately runs for minutes. */
const DEFAULT_CALL_TIMEOUT_MS = 300_000;
/** Hard page cap for tools/list cursor pagination (hostile servers can't stall us forever). */
const MAX_LIST_PAGES = 10;
/** stderr bytes kept per stdio server for the panel's diagnostics expander. */
const STDERR_RING_BYTES = 8 * 1024;

function msgOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${message} (after ${ms}ms)`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Human-readable server descriptor used in every error message. */
function describe(server: MCPServerConfig): string {
  return `"${server.name || server.id}" (${server.transport ?? 'stdio'})`;
}

function validTimeout(t: number | undefined, fallback: number): number {
  return typeof t === 'number' && Number.isFinite(t) && t >= 1000 ? t : fallback;
}

/** Timeout applied to handshake + list/read probes. */
function probeTimeoutMs(server: MCPServerConfig): number {
  return validTimeout(server.timeoutMs, DEFAULT_PROBE_TIMEOUT_MS);
}

/**
 * Timeout applied to a COLD spawn + initialize handshake. Exported read-only
 * so the proof suite can assert the real-world budget without waiting 2 min.
 * An explicitly configured `server.timeoutMs` still wins.
 */
export function startupTimeoutMs(server: MCPServerConfig): number {
  return validTimeout(server.timeoutMs, DEFAULT_STARTUP_TIMEOUT_MS);
}

/** Timeout applied to tools/call (long-running by nature). */
function callTimeoutMs(server: MCPServerConfig): number {
  return validTimeout(server.timeoutMs, DEFAULT_CALL_TIMEOUT_MS);
}

/**
 * v11.38 — one short, actionable error per failure. The founder reported an
 * "ايرور ضخم" (huge error): Python/npm stack traces and multi-KB JSON-RPC
 * payloads were relayed verbatim into the chat. Keep the FIRST useful line,
 * cap its length, strip ANSI/colour codes and append a concrete next step.
 * The original diagnostic phrases (timed out / ENOENT / 401 / 404 / …) stay
 * intact so existing callers and tests can still branch on them.
 */
export function mcpFriendlyError(server: MCPServerConfig, err: unknown): string {
  const raw = msgOf(err)
    .replace(/\u001b\[[0-9;]*m/g, '') // ANSI colour codes from npm/uvx
    .replace(/\r/g, '');
  // A stack trace (or a server stderr dump) continues on later lines. The
  // first non-empty line is the actual cause and is all the user can act on.
  const first = raw.split('\n').map((s) => s.trim()).find(Boolean) ?? '';
  const short = first.length > 420 ? `${first.slice(0, 420)}… [truncated]` : first;
  let hint = '';
  const low = raw.toLowerCase();
  if (/timed out|timeout|etimedout/.test(low)) {
    hint = 'the server did not respond in time — first-run npx/uvx downloads are slow; check the command in Settings → MCP, run it manually, or raise its timeoutMs';
  } else if (/enoent|spawn .*einval|not found|no such file|is not recognized/.test(low)) {
    hint = 'the command was not found — install it (or use its full path) in Settings → MCP; on Windows .cmd shims are wrapped automatically';
  } else if (/econnrefused|fetch failed|network|enotfound/.test(low)) {
    hint = 'nothing is listening — start the server and check its URL';
  } else if (/\b401\b|unauthori[sz]ed/.test(low)) {
    hint = 'authentication failed — sign in / check the token in Settings → MCP';
  } else if (/\b403\b|forbidden/.test(low)) {
    hint = 'access denied — check this server’s permissions';
  } else if (/\b404\b|not found/.test(low)) {
    hint = 'the endpoint was not found — check the URL/path in Settings → MCP';
  } else if (/protocol.?version/.test(low)) {
    hint = 'protocol mismatch — the client retried older MCP revisions; update the server if it persists';
  } else if (/quarantin|denied|blocked by the allow/.test(low)) {
    hint = 'open Settings → MCP to review this server/tool’s permissions';
  } else if (/traceback|runtimeerror|exception|error:/.test(low)) {
    hint = 'the server crashed — open Settings → MCP → Test to read its stderr and check its command/args';
  } else if (!short) {
    hint = 'open Settings → MCP → Test to see the server’s stderr';
  }
  const prefix = /^(?:MCP\s|\[mcp\])/.test(short) || short.includes(describe(server))
    ? ''
    : `MCP ${describe(server)}: `;
  return `${prefix}${short || 'the connection failed'}${hint ? ` — ${hint}` : ''}`;
}

/** True when an initialize failure is specifically a protocol-version rejection. */
function isProtocolRejection(err: unknown): boolean {
  const m = msgOf(err).toLowerCase();
  return /protocol.{0,20}version|unsupported.{0,20}version|version.{0,20}not.{0,10}supported|invalid.{0,20}version/.test(m);
}

/** Newest first; servers that reject the newest revision get one bounded downgrade. */
const HANDSHAKE_VERSIONS = [PROTOCOL_VERSION, '2025-06-18', '2024-11-05'] as const;

/**
 * Run `initialize` with the newest revision, downgrading ONLY when the server
 * explicitly rejects the version. Shared by all three transports so a strict
 * server is fixed everywhere, not just on stdio.
 */
async function initializeWithFallback(
  server: MCPServerConfig,
  call: (version: string) => Promise<unknown>,
): Promise<McpSessionInfo> {
  let last: unknown;
  for (let i = 0; i < HANDSHAKE_VERSIONS.length; i++) {
    const version = HANDSHAKE_VERSIONS[i];
    try {
      return parseSessionInfo(await call(version));
    } catch (err) {
      last = err;
      if (!isProtocolRejection(err) || i === HANDSHAKE_VERSIONS.length - 1) break;
      console.warn(`[mcp] ${describe(server)} rejected protocol ${version}; trying ${HANDSHAKE_VERSIONS[i + 1]}`);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/**
 * A failure at the TRANSPORT layer (child gone, socket closed, timeout,
 * write failure, bad HTTP status). Kept distinct from a normal MCP/JSON-RPC
 * error — including a tool that ran and returned `isError` — so callers can
 * retry ONLY genuinely transient connection failures, never a tool that may
 * already have executed (which would double its side effects).
 *
 * `retryable=false` marks failures a retry cannot fix (bad URL, bad auth),
 * so a cold first call does not waste a second spawn on a config error.
 */
class McpTransportError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = true) {
    super(message);
    this.name = 'McpTransportError';
    this.retryable = retryable;
  }
}

/** True when an error is a transient transport failure worth one cold retry. */
function isRetryableTransportError(err: unknown): err is McpTransportError {
  return err instanceof McpTransportError && err.retryable;
}

/**
 * Human-readable, actionable HTTP failure (single language: English).
 * A bare "HTTP 401"/"HTTP 404" tells the user nothing about what to fix, so
 * each common status carries the exact next step. Body is kept as a bounded
 * snippet for servers that explain themselves.
 */
function httpErr(status: number, body: string): string {
  const snippet = body.trim().replace(/\s+/g, ' ').slice(0, 180);
  let hint = '';
  if (status === 401) hint = ' authentication failed — check the OAuth/token settings for this server';
  else if (status === 403) hint = ' access denied — check this server\'s permissions';
  else if (status === 404) hint = ' the URL or session was not found — check the endpoint path in the MCP server settings (an expired streamable-HTTP session is reinitialized automatically)';
  else if (status === 405) hint = ' the server does not accept this MCP method at that URL';
  else if (status === 429) hint = ' the server is rate-limiting requests — retry later';
  else if (status >= 500) hint = ' the server is temporarily unavailable — it will be retried';
  return `HTTP ${status}${hint}${snippet ? ` — ${snippet}` : ''}`;
}

/**
 * v11.26 — merge HTTP headers CASE-INSENSITIVELY, with `override` winning.
 *
 * Two real bugs this fixes for remote MCP servers:
 *  1. `fetch`/Headers treat `Authorization` and `authorization` as the SAME
 *     header and CONCATENATE both values. mcpOAuth returns lowercase
 *     `authorization`, the catalog/config uses `Authorization`, so a server
 *     with a stored OAuth token used to send
 *     `Authorization: Bearer <placeholder>, Bearer <real token>` → 401.
 *  2. A catalog card's unfilled `Bearer <YOUR_TOKEN>` placeholder used to
 *     override the freshly refreshed OAuth token. Now the dynamic credential
 *     wins on the same (case-folded) key while an unrelated static token is
 *     left untouched.
 */
function mergeHeaders(
  base: Record<string, string>,
  override: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const lowerToKey = new Map<string, string>();
  const overrideByLower = new Map<string, string>();
  for (const [k, v] of Object.entries(override)) {
    if (typeof v === 'string' && v.trim()) overrideByLower.set(k.toLowerCase(), v);
  }
  for (const [k, v] of Object.entries(base)) {
    if (typeof v !== 'string') continue;
    const lk = k.toLowerCase();
    if (overrideByLower.has(lk)) continue; // override (OAuth) wins, incl. placeholders
    out[k] = v;
    lowerToKey.set(lk, k);
  }
  for (const [k, v] of Object.entries(override)) {
    if (typeof v !== 'string' || !v.trim()) continue;
    const lk = k.toLowerCase();
    const prior = lowerToKey.get(lk);
    if (prior && prior !== k) delete out[prior];
    out[k] = v;
    lowerToKey.set(lk, k);
  }
  return out;
}

// ---------- JSON-RPC plumbing ----------

interface JsonRpcErrorShape {
  code?: number;
  message?: string;
  data?: unknown;
}

interface JsonRpcMessage {
  jsonrpc?: '2.0';
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcErrorShape;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

function parseJsonRpc(text: string): JsonRpcMessage | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JsonRpcMessage;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * v11.38 — parse ONE stdio line the way real servers actually write it:
 *   • plain JSON object (spec),
 *   • a JSON-RPC batch array (a few Python servers send one),
 *   • a server log prefix before the JSON (`[info] {"jsonrpc":…}`).
 * Previously a batch or a prefixed line was silently dropped, which looks
 * exactly like "the server connects but no tools/call result ever arrives".
 */
function parseRpcLine(text: string): JsonRpcMessage[] {
  const tryParse = (s: string): JsonRpcMessage[] => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch {
      return [];
    }
    if (Array.isArray(parsed)) {
      return parsed.filter((m): m is JsonRpcMessage => !!m && typeof m === 'object');
    }
    return parsed && typeof parsed === 'object' ? [parsed as JsonRpcMessage] : [];
  };
  const direct = tryParse(text);
  if (direct.length) return direct;
  // Salvage a JSON object/array after a non-JSON log prefix (bounded scan).
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start >= 0 && end > start) return tryParse(text.slice(start, end + 1));
  return [];
}

/**
 * All JSON-RPC messages found in an HTTP body (plain JSON or SSE-framed —
 * streamable-http servers may answer a POST with text/event-stream).
 * Notifications and server→client pings ride along with the actual response.
 */
function rpcCandidates(body: string, contentType: string): JsonRpcMessage[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  const candidates: JsonRpcMessage[] = [];
  if (contentType.includes('text/event-stream')) {
    for (const frame of new SseParser().push(`${trimmed}\n\n`)) {
      const msg = parseJsonRpc(frame.data);
      if (msg) candidates.push(msg);
    }
  } else {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const m of parsed) if (m && typeof m === 'object') candidates.push(m as JsonRpcMessage);
      } else if (parsed && typeof parsed === 'object') {
        candidates.push(parsed as JsonRpcMessage);
      }
    } catch {
      /* not JSON — nothing usable */
    }
  }
  return candidates;
}

/**
 * MCP 2025-11-25 — `notifications/cancelled` (client→server). Emitted whenever
 * a request is abandoned (timeout, pool teardown, health eviction) so a
 * long-running server-side tool can stop and release resources instead of
 * becoming an orphan side effect. Best-effort on every transport: a server
 * that ignores it is no worse off than before.
 */
function cancelledNotice(requestId: number | string, reason: string): JsonRpcMessage {
  return {
    jsonrpc: '2.0',
    method: 'notifications/cancelled',
    params: { requestId, reason },
  };
}

// ---------- process launch helpers (v3.1: cwd + Windows shim) ----------

/** Pinned active workspace (set by the app shell) — beats recentPaths[0]. */
let workspaceOverride: string | undefined;

/**
 * The current workspace root, best-effort. mcpRegistryService has no workspace
 * context of its own, so `${workspace}` in cwd/args resolves via the pinned
 * override, then the most recent settings path, then undefined.
 */
function currentWorkspace(): string | undefined {
  try {
    const ws = workspaceOverride ?? getSettings().recentPaths?.[0];
    if (ws && fs.existsSync(ws) && fs.statSync(ws).isDirectory()) return ws;
  } catch {
    /* settings unreadable / path gone — treat as unknown */
  }
  return undefined;
}

/** Main/UI can pin the active workspace so `${workspace}` resolves reliably. */
export function setMcpWorkspace(dir: string | undefined): void {
  workspaceOverride = dir && dir.trim() ? dir.trim() : undefined;
}

/** Replace `${workspace}` placeholders (cwd + preset args) with the live workspace. */
function resolvePlaceholders(value: string): string {
  if (!value.includes('${workspace}')) return value;
  return value.split('${workspace}').join(currentWorkspace() ?? os.homedir());
}

/** cwd for the child process: server.cwd (placeholder-resolved) or inherit. */
function resolveServerCwd(server: MCPServerConfig): string | undefined {
  const raw = (server.cwd ?? '').trim();
  if (!raw) return undefined;
  const p = resolvePlaceholders(raw);
  return path.isAbsolute(p) ? p : path.resolve(currentWorkspace() ?? process.cwd(), p);
}

/**
 * Windows cannot spawn .cmd/.bat shims (npx, uvx, npm, pip…) directly from
 * Node — they are batch files, not executables, and CreateProcess answers
 * EINVAL. Wrap extension-less (or .cmd/.bat) commands in `cmd.exe /d /s /c`
 * — /s makes cmd treat everything after /c as the plain command line, so
 * quoted args survive. POSIX and absolute .exe paths are untouched.
 */
function resolveSpawnTarget(server: MCPServerConfig): { command: string; args: string[] } {
  const command = resolvePlaceholders((server.command ?? '').trim());
  const args = (server.args ?? []).map((a) => resolvePlaceholders(String(a)));
  if (process.platform !== 'win32' || !command) return { command, args };
  const ext = path.extname(command).toLowerCase();
  const alreadyShell = /^(cmd|cmd\.exe)$/i.test(path.basename(command));
  const needsShim = !alreadyShell && (ext === '' || ext === '.cmd' || ext === '.bat');
  if (!needsShim) return { command, args };
  return { command: 'cmd.exe', args: ['/d', '/s', '/c', command, ...args] };
}

// ---------- transport abstraction ----------

/** initialize handshake result — negotiated version + server identity/capabilities. */
export interface McpSessionInfo {
  /** The protocol version the SERVER answered with (may be older than ours). */
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
  capabilities?: Record<string, unknown>;
}

/**
 * Parse + record the server's initialize result. Per the task contract we
 * ACCEPT older revisions (2025-03-26 / 2024-11-05) and even unrecognized ones
 * — a failure is only surfaced if the subsequent tools/list actually fails.
 */
function parseSessionInfo(result: unknown): McpSessionInfo {
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const protocolVersion = typeof r.protocolVersion === 'string' ? r.protocolVersion : undefined;
  if (protocolVersion && !SUPPORTED_PROTOCOL_VERSIONS.has(protocolVersion)) {
    // Keep going optimistically: plenty of servers lie about or omit the
    // version; tools/list is the real compatibility test.
    console.warn(`[mcp] server answered with unrecognized protocolVersion "${protocolVersion}" — continuing`);
  }
  const si = (r.serverInfo && typeof r.serverInfo === 'object' ? r.serverInfo : {}) as Record<string, unknown>;
  const capabilities =
    r.capabilities && typeof r.capabilities === 'object' && !Array.isArray(r.capabilities)
      ? (r.capabilities as Record<string, unknown>)
      : undefined;
  return {
    protocolVersion: protocolVersion ?? '2024-11-05', // pre-versioning servers: assume the legacy rev
    serverInfo: {
      name: typeof si.name === 'string' ? si.name : undefined,
      version: typeof si.version === 'string' ? si.version : undefined,
    },
    capabilities,
  };
}

interface McpTransport {
  /** Connect + run the MCP initialize handshake. */
  start(): Promise<void>;
  /** JSON-RPC request/response with a hard timeout. */
  call(method: string, params: unknown, timeoutMs: number): Promise<unknown>;
  /** Kill the child process / abort sockets. Must be idempotent. */
  kill(): void;
  /** initialize result (negotiated version + serverInfo) once start() resolved. */
  readonly sessionInfo?: McpSessionInfo;
  /** Cheap liveness check for pooled clients (no I/O). */
  alive(): boolean;
  /** Last stderr bytes for stdio servers (diagnostics); absent for remote. */
  stderrTail?(): string;
  /**
   * Pool crash hook — invoked when the connection dies UNEXPECTEDLY (stdio
   * exit / SSE stream drop). kill() by the pool owner never triggers it.
   */
  onClosed?: (reason: Error) => void;
}

// ---------- stdio transport ----------

/**
 * A8 security fix — MINIMAL ENV for MCP stdio children. The old spawn passed
 * `{ ...process.env, ...server.env }`: every MCP server process received the
 * user's ENTIRE environment (AWS/Stripe/OpenAI keys set in the shell, token
 * caches, proxy credentials…) — over-broad trust for third-party servers.
 * The child now gets an allowlist of OS/runtime essentials (PATH, HOME,
 * Windows system vars, XDG dirs…) plus exactly the env the server config
 * declares (user-approved in the MCP panel). NODE_* and *_TOKEN/*_KEY style
 * values never cross unless explicitly configured for that server.
 * Exported pure so the security regression tests can drive it.
 */
const MCP_ENV_ALLOW = new Set([
  'PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMMONPROGRAMFILES',
  'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PROCESSOR_ARCHITECTURE',
  'TEMP', 'TMP', 'TMPDIR', 'USER', 'USERNAME', 'SHELL', 'TERM',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'DISPLAY',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR',
]);

export function mcpChildEnv(serverEnv?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    const key = process.platform === 'win32' ? k.toUpperCase() : k;
    if (MCP_ENV_ALLOW.has(key)) out[k] = v;
  }
  // Server-configured env (user-approved per server) always wins.
  if (serverEnv) {
    for (const [k, v] of Object.entries(serverEnv)) {
      if (typeof v === 'string' && k) out[k] = v;
    }
  }
  return out;
}

class McpStdioClient implements McpTransport {
  private proc: ChildProcess | null = null;
  private buffer = '';
  private pending = new Map<number, Pending>();
  private nextId = 1;
  /** Ring of the last STDERR_RING_BYTES stderr bytes (panel diagnostics). */
  private stderrRing = '';
  private exited = false;
  /** Set by kill() — an exit afterwards is EXPECTED, not a crash (no restart). */
  private killedByOwner = false;

  /** initialize result, recorded by start() (negotiated version + serverInfo). */
  sessionInfo: McpSessionInfo | undefined;
  /** Pool crash hook — unexpected exit of a PERSISTENT client. */
  onClosed?: (reason: Error) => void;

  constructor(private readonly server: MCPServerConfig) {}

  /** Spawn the server and run the MCP initialize handshake. */
  start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Late resolve/reject calls inside a Promise executor are no-ops,
      // so the exit/error handlers can stay attached for the client's life.
      let proc: ChildProcess;
      // v3.1: win32 .cmd shim + `${workspace}`-aware cwd (undefined → inherit).
      const target = resolveSpawnTarget(this.server);
      try {
        proc = spawn(target.command, target.args, {
          env: mcpChildEnv(this.server.env),
          cwd: resolveServerCwd(this.server),
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (err) {
        reject(new Error(`Failed to launch MCP server ${describe(this.server)}: ${msgOf(err)}`));
        return;
      }
      this.proc = proc;

      proc.on('error', (err) => {
        // A spawn failure emits 'error' (and 'close') but NOT 'exit' — without
        // this the client would report alive()==true and be reused as a corpse.
        this.exited = true;
        const reason = new McpTransportError(
          `Failed to launch MCP server ${describe(this.server)}: ${err.message}. Check that the command is installed and on PATH, and that its arguments are valid.`,
          false, // retrying a missing/broken command cannot help
        );
        this.rejectAll(reason);
        reject(reason);
      });
      proc.on('exit', (code) => {
        this.exited = true;
        const tail = this.stderrRing.trim().slice(-300);
        const reason = new McpTransportError(
          `MCP server ${describe(this.server)} stopped unexpectedly (exit code ${code ?? '?'})${
            tail ? `: ${tail}` : ''
          }. It will be restarted automatically; check the command/args and server stderr above if it keeps stopping.`,
        );
        this.rejectAll(reason);
        reject(reason);
        // Only a crash (not our own kill()) may trigger the pool's restart path.
        if (!this.killedByOwner) this.onClosed?.(reason);
      });
      // EPIPE when the server dies mid-write — surfaced via 'exit' instead.
      proc.stdin?.on('error', () => {
        /* ignore */
      });

      proc.stdout?.setEncoding('utf8');
      proc.stdout?.on('data', (chunk: string) => this.onData(chunk));
      proc.stderr?.setEncoding('utf8');
      proc.stderr?.on('data', (chunk: string) => {
        // Keep a bounded ring for error messages + the panel's stderr expander.
        this.stderrRing = (this.stderrRing + chunk).slice(-STDERR_RING_BYTES);
      });

      void this.handshake().then(resolve, reject);
    });
  }

  /**
   * v11.38 — real initialize handshake with a bounded protocol downgrade.
   * Most servers accept the newest revision on the first try (zero extra
   * traffic). A strict server that answers "unsupported protocol version"
   * gets ONE retry with 2025-06-18 and then 2024-11-05 on the same stdio
   * session. Timeouts/spawn failures are never retried here.
   */
  private async handshake(): Promise<void> {
    this.sessionInfo = await initializeWithFallback(this.server, (version) =>
      this.call(
        'initialize',
        { protocolVersion: version, capabilities: {}, clientInfo: CLIENT_INFO },
        startupTimeoutMs(this.server),
      ),
    );
    this.notify('notifications/initialized');
  }

  /** JSON-RPC request/response with timeout. */
  call(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (this.exited) {
        reject(new McpTransportError(`MCP server ${describe(this.server)} is not running; it is being restarted — retry the call.`));
        return;
      }
      if (!this.proc?.stdin || !this.proc.stdin.writable) {
        reject(new McpTransportError(`MCP server ${describe(this.server)} has no writable stdin; the connection is being restarted.`));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // MCP 2025-11-25: let the server know this request was abandoned so it
        // can cancel its work (best-effort, no response expected).
        this.writeRaw(cancelledNotice(id, `timed out after ${timeoutMs}ms`));
        // A timed-out tools/call may already have run (side effects); never
        // cold-retry it. Read-only methods are safe to retry once.
        reject(new McpTransportError(
          `MCP ${method} timed out after ${timeoutMs}ms (${describe(this.server)}) — the server may be slow or stuck; check its stderr.`,
          method !== 'tools/call',
        ));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new McpTransportError(`MCP write failed for ${describe(this.server)}: ${msgOf(err)} — the connection is being restarted.`));
      }
    });
  }

  /** Fire-and-forget notification (no id, no response expected). */
  private notify(method: string, params?: unknown): void {
    this.writeRaw({ jsonrpc: '2.0', method, params });
  }

  private writeRaw(message: unknown): void {
    try {
      this.proc?.stdin?.write(JSON.stringify(message) + '\n');
    } catch {
      /* ignore — process may have exited */
    }
  }

  kill(): void {
    if (this.exited) return;
    this.killedByOwner = true; // expected shutdown — suppress the crash hook
    // MCP 2025-11-25: cancel every in-flight request before the child dies so
    // a server that supports cancellation can stop its work cleanly.
    for (const id of this.pending.keys()) {
      this.writeRaw(cancelledNotice(id, 'client shutting down'));
    }
    const proc = this.proc;
    if (!proc) return;
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
    // Hard-kill stragglers so no zombie MCP processes accumulate. Unref'd so
    // graceful shutdown never hangs for 2s waiting on a timer to fire.
    const hardKill = setTimeout(() => {
      try {
        if (!this.exited && proc.pid) proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, 2000);
    hardKill.unref?.();
  }

  /** Cheap liveness check (no I/O) — used by the pool before reuse. */
  alive(): boolean {
    return !this.exited && !!this.proc;
  }

  stderrTail(): string {
    return this.stderrRing;
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      for (const parsed of parseRpcLine(line)) this.dispatchRpc(parsed);
    }
  }

  /** One parsed JSON-RPC message from a stdio server (notification/request/reply). */
  private dispatchRpc(parsed: JsonRpcMessage): void {
    if (parsed.id === undefined || parsed.id === null) {
      // Server→client NOTIFICATION (progress / tools list changed / …) —
      // these used to be dropped silently.
      if (parsed.method) dispatchServerNotification(this.server.id, parsed.method, parsed.params);
      return;
    }
    if (typeof parsed.id !== 'number') return; // string ids are never ours
    if (parsed.method) {
      // Server→client REQUEST: the MCP spec has servers ping to check
      // liveness — answer with an empty result; `elicitation/create` goes
      // to the approval flow (v7.3); anything else is declined politely.
      if (parsed.method === 'ping') this.writeRaw({ jsonrpc: '2.0', id: parsed.id, result: {} });
      else if (
        !dispatchServerRequest(this.server, parsed.method, parsed.params, (result) =>
          this.writeRaw({ jsonrpc: '2.0', id: parsed.id, result }),
        )
      )
        this.writeRaw({
          jsonrpc: '2.0',
          id: parsed.id,
          error: { code: -32601, message: `Method "${parsed.method}" not supported by the Surnia MCP client.` },
        });
      return;
    }
    const p = this.pending.get(parsed.id);
    if (!p) return; // stale/unknown response — ignore
    this.pending.delete(parsed.id);
    clearTimeout(p.timer);
    if (parsed.error) {
      // JSON-RPC error.message can be an entire Python traceback. Keep the
      // useful first line; the panel's stderr ring keeps the full diagnostic.
      p.reject(new Error(mcpFriendlyError(this.server, parsed.error.message || `request failed`)));
    } else p.resolve(parsed.result);
  }

  private rejectAll(err: Error): void {
    for (const [id, p] of [...this.pending]) {
      this.pending.delete(id);
      clearTimeout(p.timer);
      try {
        p.reject(err);
      } catch {
        /* ignore */
      }
    }
  }
}

// ---------- SSE frame parsing (shared by sse + http transports) ----------

/** One parsed SSE frame. `id`/`retry` power MCP 2025-11-25 stream resumption. */
export interface SseEvent {
  event: string;
  data: string;
  id?: string;
  retry?: number;
}

/** Incremental text/event-stream parser: feed chunks, receive complete events. */
class SseParser {
  private buf = '';

  push(chunk: string): SseEvent[] {
    this.buf = (this.buf + chunk).replace(/\r\n/g, '\n');
    const events: SseEvent[] = [];
    let sep: number;
    while ((sep = this.buf.indexOf('\n\n')) >= 0) {
      const block = this.buf.slice(0, sep);
      this.buf = this.buf.slice(sep + 2);
      let event = 'message';
      let id: string | undefined;
      let retry: number | undefined;
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (!line || line.startsWith(':')) continue; // comments / keep-alive pings
        const idx = line.indexOf(':');
        const field = idx < 0 ? line : line.slice(0, idx);
        let value = idx < 0 ? '' : line.slice(idx + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
        else if (field === 'id') id = value; // empty id resets the cursor (spec)
        else if (field === 'retry') {
          const n = Number(value);
          if (Number.isFinite(n) && n >= 0) retry = n;
        }
      }
      if (data.length) {
        events.push({
          event,
          data: data.join('\n'),
          ...(id !== undefined ? { id } : {}),
          ...(retry !== undefined ? { retry } : {}),
        });
      }
    }
    return events;
  }
}

/**
 * MCP 2025-11-25 SSE resumption state. When a legacy HTTP+SSE stream drops,
 * the pool respawns a fresh client; carrying Last-Event-ID lets the server
 * replay events the dead connection missed. The `retry:` field is honored as
 * the reconnect backoff for SSE servers in healthFail(). State is per-server
 * and in-memory (a process restart starts a new stream anyway).
 */
interface SseResumeState {
  lastEventId?: string;
  retryMs?: number;
}
const sseResumeState = new Map<string, SseResumeState>();

function sseResumeHeaders(serverId: string): Record<string, string> {
  const s = sseResumeState.get(serverId);
  return s?.lastEventId ? { 'Last-Event-ID': s.lastEventId } : {};
}

function recordSseFrame(serverId: string, frame: SseEvent): void {
  if (frame.id === undefined && frame.retry === undefined) return;
  const prev = sseResumeState.get(serverId) ?? {};
  if (frame.id !== undefined) {
    if (frame.id) prev.lastEventId = frame.id;
    else delete prev.lastEventId; // spec: empty id clears the resume cursor
  }
  if (frame.retry !== undefined) prev.retryMs = frame.retry;
  sseResumeState.set(serverId, prev);
}

/** Exposed for tests/diagnostics: the current replay cursor for a server. */
export function sseLastEventId(serverId: string): string | undefined {
  return sseResumeState.get(serverId)?.lastEventId;
}

/** Exposed for tests/diagnostics: the server-advertised reconnect delay. */
export function sseRetryDelayMs(serverId: string): number | undefined {
  return sseResumeState.get(serverId)?.retryMs;
}

// ---------- http transport (streamable-http style POST) ----------

class McpHttpClient implements McpTransport {
  private sessionId: string | null = null;
  private nextId = 1;
  private closed = false;
  /** Shared re-handshake so concurrent 404s cannot spawn competing initializes. */
  private reinitPromise?: Promise<void>;

  /** initialize result, recorded by start() (negotiated version + serverInfo). */
  sessionInfo: McpSessionInfo | undefined;

  constructor(private readonly server: MCPServerConfig) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.server.headers ?? {}),
      ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
    };
    // v3.1 protocol modernization: every post-init request declares the
    // NEGOTIATED version (initialize itself has none to declare yet).
    if (this.sessionInfo?.protocolVersion) {
      h['MCP-Protocol-Version'] = this.sessionInfo.protocolVersion;
    }
    return h;
  }

  /**
   * v7.1 — headers WITH OAuth: stored tokens (dynamic registration / PKCE)
   * are attached as Bearer; expired tokens refresh first. Called per POST so
   * a refresh mid-session is transparent. Errors degrade to no-auth headers
   * (the 401 path still surfaces to the caller).
   */
  private async authHeaders(): Promise<Record<string, string>> {
    return mcpAuthHeaders(this.server);
  }

  /** Best-effort notifications/cancelled for an abandoned request (2025-11-25). */
  private async postCancelled(requestId: number | string, reason: string): Promise<void> {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 2000);
      try {
        await fetch(this.server.url as string, {
          method: 'POST',
          headers: mergeHeaders(this.headers(), await this.authHeaders()),
          body: JSON.stringify(cancelledNotice(requestId, reason)),
          signal: ac.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch {
      /* best-effort */
    }
  }

  private async post(
    message: unknown,
    timeoutMs: number,
    cancelId?: number | string,
  ): Promise<{ status: number; contentType: string; body: string }> {
    if (this.closed) throw new Error(`MCP client for ${describe(this.server)} is closed.`);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(this.server.url as string, {
        method: 'POST',
        // v11.26: OAuth headers win case-insensitively over a catalog card's
        // placeholder/static Authorization header (no duplicate Bearer values).
        headers: mergeHeaders(this.headers(), await this.authHeaders()),
        body: JSON.stringify(message),
        signal: ac.signal,
      });
      // Streamable-HTTP servers issue a session id on initialize — echo it
      // back only on SUCCESS: a 404 error must not "adopt" a bogus session.
      const sid = res.headers.get('mcp-session-id');
      if (sid && res.status >= 200 && res.status < 300) this.sessionId = sid;
      const body = await res.text();
      return { status: res.status, contentType: res.headers.get('content-type') ?? '', body };
    } catch (err) {
      if (ac.signal.aborted) {
        // An abort here is OUR timeout, not an opaque "operation aborted".
        // Name the cause and the fix, and tell the server (2025-11-25).
        if (cancelId !== undefined) void this.postCancelled(cancelId, `timed out after ${timeoutMs}ms`);
        throw new McpTransportError(
          `MCP request to ${describe(this.server)} timed out after ${timeoutMs}ms — the server did not respond. Check its availability and that the endpoint URL is correct.`,
        );
      }
      throw new McpTransportError(`MCP request to ${describe(this.server)} failed: ${msgOf(err)} — check the URL and network connection.`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * v11.31 — the streamable-HTTP spec says a 404 carrying a previously valid
   * session id means the server restarted and forgot the session: re-initialize
   * once and replay the request. Concurrent 404s share ONE handshake.
   */
  private reinitialize(timeoutMs: number): Promise<void> {
    if (!this.reinitPromise) {
      this.sessionId = null;
      this.sessionInfo = undefined;
      this.reinitPromise = (async () => {
        this.sessionInfo = await initializeWithFallback(this.server, (version) =>
          this.call(
            'initialize',
            { protocolVersion: version, capabilities: {}, clientInfo: CLIENT_INFO },
            timeoutMs,
            false, // the re-handshake itself must never recurse into another reinit
          ),
        );
        try {
          await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, timeoutMs);
        } catch {
          /* best-effort */
        }
      })().finally(() => {
        this.reinitPromise = undefined;
      });
    }
    return this.reinitPromise;
  }

  async start(): Promise<void> {
    const pt = startupTimeoutMs(this.server);
    // Record the negotiated protocol version — it rides on every later request
    // (MCP-Protocol-Version header) and survives for the POOLED session.
    this.sessionInfo = await initializeWithFallback(this.server, (version) =>
      this.call(
        'initialize',
        { protocolVersion: version, capabilities: {}, clientInfo: CLIENT_INFO },
        pt,
      ),
    );
    try {
      await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, pt);
    } catch {
      /* the notification is best-effort — some servers 202 it, some ignore it */
    }
  }

  async call(method: string, params: unknown, timeoutMs: number, allowReinit = true): Promise<unknown> {
    const id = this.nextId++;
    const hadSession = !!this.sessionId;
    let postResult: { status: number; contentType: string; body: string };
    try {
      postResult = await this.post({ jsonrpc: '2.0', id, method, params }, timeoutMs, id);
    } catch (err) {
      // A timed-out tools/call may already be running on the server; never let
      // the cold-retry path execute its side effects twice.
      if (method === 'tools/call' && err instanceof McpTransportError) {
        throw new McpTransportError(err.message, false);
      }
      throw err;
    }
    const { status, contentType, body } = postResult;
    if (status === 404 && hadSession && allowReinit) {
      // Server restarted and dropped our session — re-handshake ONCE, then
      // replay. Config URLs that are simply wrong never reach this branch
      // (there is no session id), so v11.23's "404 is not retried" still holds.
      try {
        await this.reinitialize(timeoutMs);
        return await this.call(method, params, timeoutMs, false);
      } catch {
        /* fall through and report the original 404 honestly */
      }
    }
    if (status < 200 || status >= 300) {
      // 4xx is a config/auth/URL problem (retrying cannot fix it); 5xx is
      // transient and worth one cold retry — EXCEPT for tools/call, where a
      // 5xx may mean the tool already ran before the response failed: retrying
      // would repeat its side effects. Surface that failure honestly instead.
      throw new McpTransportError(
        `MCP ${method} failed for ${describe(this.server)}: ${httpErr(status, body)}`,
        status >= 500 && method !== 'tools/call',
      );
    }
    // Process the WHOLE body: progress/list_changed notifications, server
    // pings AND elicitation requests may arrive interleaved with (or instead
    // of) the awaited response.
    const candidates = rpcCandidates(body, contentType);
    for (const msg of candidates) {
      if (msg.id === undefined || msg.id === null) {
        if (msg.method) dispatchServerNotification(this.server.id, msg.method, msg.params);
        continue;
      }
      if (msg.method === 'ping') {
        // Best-effort pong: the POST that carried the ping has already ended,
        // so the reply goes out on its own request.
        void this.post({ jsonrpc: '2.0', id: msg.id, result: {} }, 2000).catch(() => {
          /* best-effort */
        });
      } else if (msg.method && !dispatchServerRequest(this.server, msg.method, msg.params, (result) => {
        // The decision arrives later — the reply POST fires when it does.
        void this.post({ jsonrpc: '2.0', id: msg.id, result }, 2000).catch(() => {
          /* best-effort */
        });
      })) {
        console.warn(`[mcp] ignored server→client request "${msg.method}" (${describe(this.server)})`);
      }
    }
    const msg = candidates.find((m) => m.id === id);
    if (!msg) {
      throw new Error(`MCP ${method}: no JSON-RPC response from ${describe(this.server)}.`);
    }
    if (msg.error) {
      throw new Error(msg.error.message || `MCP ${method} failed (${describe(this.server)}).`);
    }
    return msg.result;
  }

  kill(): void {
    this.closed = true;
    // Drop the session so a pooled reconnect starts clean (no stale id).
    this.sessionId = null;
  }

  /** Cheap liveness check (no I/O) — used by the pool before reuse. */
  alive(): boolean {
    return !this.closed;
  }
}

// ---------- sse transport (legacy HTTP+SSE remote servers) ----------

/**
 * v7.1 — OAuth bearer headers for a remote MCP server (shared by the HTTP
 * and SSE transports). Stored tokens refresh automatically; failures keep
 * the request going without auth so the 401 surfaces to the caller.
 */
async function mcpAuthHeaders(server: MCPServerConfig): Promise<Record<string, string>> {
  try {
    if (server.transport === 'http' || server.transport === 'sse') {
      const { authHeadersFor } = await import('./mcpOAuth');
      // v11.26: use the STATIC `app` import at the top of this module. A
      // dynamic `await import('electron')` is compiled to a __toESM(require())
      // interop shim in the bundled CJS build and yields `app === undefined`
      // there — silently dropping EVERY OAuth token (401 on remote servers).
      const r = await authHeadersFor(server.id, app.getPath('userData'), server.url);
      if (r.status === 'refresh-failed' || r.status === 'expired') {
        console.warn(`[mcp-oauth] ${server.name}: ${r.status}${r.detail ? ` — ${r.detail}` : ''}`);
      }
      return r.headers;
    }
  } catch {
    /* CLI/stub contexts — no oauth */
  }
  return {};
}

class McpSseClient implements McpTransport {
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private ac = new AbortController();
  private endpoint: string | null = null;
  private endpointWaiters: Array<() => void> = [];
  private closed = false;
  private parser = new SseParser();
  private decoder = new TextDecoder();

  /** initialize result, recorded by start() (negotiated version + serverInfo). */
  sessionInfo: McpSessionInfo | undefined;
  /** Pool crash hook — the SSE stream died unexpectedly. */
  onClosed?: (reason: Error) => void;

  constructor(private readonly server: MCPServerConfig) {}

  /** v7.1 — shared OAuth headers (module-level helper, refresh-aware). */
  private async authHeaders(): Promise<Record<string, string>> {
    return mcpAuthHeaders(this.server);
  }

  async start(): Promise<void> {
    const url = (this.server.url ?? '').trim();
    let res: Response;
    try {
      res = await fetch(url, {
        // v11.26: one case-folded header set — the OAuth token must win over
        // a placeholder/static Authorization header from the server config.
        // v11.31: a dropped stream is resumed with Last-Event-ID (2025-11-25).
        headers: mergeHeaders(
          { Accept: 'text/event-stream', ...(this.server.headers ?? {}), ...sseResumeHeaders(this.server.id) },
          await this.authHeaders(),
        ),
        signal: this.ac.signal,
      });
    } catch (err) {
      throw new McpTransportError(`MCP SSE connect failed for ${describe(this.server)}: ${msgOf(err)} — check the URL and network connection.`);
    }
    if (!res.ok || !res.body) {
      // Read the body so a 401/404 explains itself instead of surfacing as a
      // bare status. This is the actionable form of "wrong error" for SSE.
      const detail = res.body ? await res.text().catch(() => '') : '';
      const why = res.ok ? 'the server returned no event stream' : httpErr(res.status, detail);
      throw new McpTransportError(
        `MCP SSE connect failed for ${describe(this.server)}: ${why}`,
        res.ok ? true : res.status >= 500,
      );
    }
    void this.pump(res.body);
    // Legacy MCP servers announce the POST endpoint via an 'endpoint' event
    // right after the stream opens; fall back to the stream URL itself.
    await this.waitForEndpoint(Math.min(5000, probeTimeoutMs(this.server)));
    this.sessionInfo = await initializeWithFallback(this.server, (version) =>
      this.call(
        'initialize',
        { protocolVersion: version, capabilities: {}, clientInfo: CLIENT_INFO },
        startupTimeoutMs(this.server),
      ),
    );
    await this.notify('notifications/initialized');
  }

  async call(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.closed) throw new Error(`MCP client for ${describe(this.server)} is closed.`);
    const id = this.nextId++;
    // A timed-out tools/call may have executed on the server; it must NOT be
    // retried (double side effects). Other reads are safe to cold-retry.
    const timeoutError = new McpTransportError(
      `MCP ${method} timed out after ${timeoutMs}ms (${describe(this.server)}) — the server did not answer; check its availability.`,
      method !== 'tools/call',
    );
    const reply = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(timeoutError);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    reply.catch(() => {
      /* rejections are surfaced by the await below; keep Node quiet if we throw first */
    });
    // v11.31: fetch has NO default timeout — bound the POST too, and tell the
    // server the abandoned request id (notifications/cancelled, 2025-11-25).
    const ac = new AbortController();
    const abortTimer = setTimeout(() => {
      ac.abort();
      void this.postRaw(cancelledNotice(id, `timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const target = this.endpoint ?? (this.server.url as string);
    try {
      const res = await fetch(target, {
        method: 'POST',
        headers: mergeHeaders({ 'Content-Type': 'application/json', ...(this.server.headers ?? {}) }, await this.authHeaders()),
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        throw new McpTransportError(
          `MCP ${method} failed for ${describe(this.server)}: ${httpErr(res.status, bodyText)}`,
          res.status >= 500 && method !== 'tools/call',
        );
      }
      // Some servers answer on the POST body as well as the SSE stream.
      const text = await res.text().catch(() => '');
      if (text) {
        const msg = parseJsonRpc(text);
        if (msg && msg.id === id) this.deliver(msg);
      }
    } catch (err) {
      const p = this.pending.get(id);
      if (p) {
        this.pending.delete(id);
        clearTimeout(p.timer);
        p.reject(ac.signal.aborted ? timeoutError : (err instanceof Error ? err : new Error(String(err))));
      }
      if (ac.signal.aborted) throw timeoutError;
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      clearTimeout(abortTimer);
    }
    return reply;
  }

  kill(): void {
    if (this.closed) return;
    this.closed = true; // expected shutdown — suppress the crash hook below
    // MCP 2025-11-25: cancel in-flight requests before dropping the stream.
    for (const id of this.pending.keys()) {
      void this.postRaw(cancelledNotice(id, 'client shutting down'));
    }
    try {
      this.ac.abort();
    } catch {
      /* ignore */
    }
    this.rejectAll(new Error(`MCP client for ${describe(this.server)} was closed.`));
  }

  /** Cheap liveness check (no I/O) — used by the pool before reuse. */
  alive(): boolean {
    return !this.closed;
  }

  /** Consume the SSE stream in the background; resolves pending calls. */
  private async pump(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.onText(this.decoder.decode(value, { stream: true }));
      }
    } catch {
      /* stream aborted or network dropped — pending calls are rejected below */
    } finally {
      const reason = new Error(`MCP SSE stream closed for ${describe(this.server)}.`);
      this.rejectAll(reason);
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
      // A dropped stream while pooled means the client is DEAD (not merely
      // idle) — let the pool forget it and health schedule a reconnect.
      if (!this.closed) this.onClosed?.(reason);
    }
  }

  private onText(chunk: string): void {
    for (const frame of this.parser.push(chunk)) {
      recordSseFrame(this.server.id, frame); // v11.31: id / retry → resume state
      if (frame.event === 'endpoint') {
        this.endpoint = resolveUrl(this.server.url ?? '', frame.data.trim());
        this.wakeEndpointWaiters();
        continue;
      }
      if (frame.event !== 'message') continue;
      const msg = parseJsonRpc(frame.data);
      if (msg) this.deliver(msg);
    }
  }

  private deliver(msg: JsonRpcMessage): void {
    if (msg.id === undefined || msg.id === null) {
      // Server→client notification (progress / tools list changed / …).
      if (msg.method) dispatchServerNotification(this.server.id, msg.method, msg.params);
      return;
    }
    if (typeof msg.id !== 'number') return;
    const requestId = msg.id; // captured (narrowing does not survive closures)
    if (msg.method) {
      // Server→client request: answer pings with an empty result (spec);
      // `elicitation/create` is routed to the approval flow (v7.3); other
      // methods stay politely ignored (legacy behavior).
      if (msg.method === 'ping') void this.postResult(requestId);
      else if (
        !dispatchServerRequest(this.server, msg.method, msg.params, (result) =>
          void this.postReply(requestId, result),
        )
      )
        console.warn(`[mcp] ignored server→client request "${msg.method}" (${describe(this.server)})`);
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message || `MCP request failed (${describe(this.server)}).`));
    else p.resolve(msg.result);
  }

  /**
   * v11.31 — ONE bounded, best-effort POST for every fire-and-forget frame
   * (replies, notifications, cancellations). The 3s AbortController prevents a
   * hung server from stalling shutdown; OAuth headers win case-insensitively.
   */
  private async postRaw(payload: unknown, timeoutMs = 3000): Promise<void> {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        await fetch(this.endpoint ?? (this.server.url as string), {
          method: 'POST',
          headers: mergeHeaders({ 'Content-Type': 'application/json', ...(this.server.headers ?? {}) }, await this.authHeaders()),
          body: JSON.stringify(payload),
          signal: ac.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch {
      /* best-effort */
    }
  }

  /** Best-effort reply to a server→client request (ping → {}, elicitation → decision). */
  private async postReply(id: number, result: unknown): Promise<void> {
    return this.postRaw({ jsonrpc: '2.0', id, result });
  }

  /** Best-effort empty-result reply to a server→client ping. */
  private async postResult(id: number): Promise<void> {
    return this.postReply(id, {});
  }

  private async notify(method: string): Promise<void> {
    // notifications/initialized is a real POST — it needs the same OAuth
    // credential as every other request or auth-required SSE servers 401.
    return this.postRaw({ jsonrpc: '2.0', method });
  }

  private waitForEndpoint(ms: number): Promise<void> {
    if (this.endpoint) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.endpointWaiters.push(done);
    });
  }

  private wakeEndpointWaiters(): void {
    const waiters = this.endpointWaiters;
    this.endpointWaiters = [];
    for (const w of waiters) w();
  }

  private rejectAll(err: Error): void {
    for (const [id, p] of [...this.pending]) {
      this.pending.delete(id);
      clearTimeout(p.timer);
      try {
        p.reject(err);
      } catch {
        /* ignore */
      }
    }
  }
}

function resolveUrl(base: string, endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  try {
    return new URL(endpoint, base).toString();
  } catch {
    return base;
  }
}

// ---------- client factory ----------

/** Picks the transport for a server config; throws clean, user-facing errors. */
export function createClient(server: MCPServerConfig): McpTransport {
  const transport = server.transport ?? 'stdio';
  if (transport === 'http' || transport === 'sse') {
    const url = (server.url ?? '').trim();
    if (!url) {
      throw new Error(`MCP server ${describe(server)} has no url configured for the ${transport} transport.`);
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new Error(`MCP server ${describe(server)}: url must start with http:// or https://.`);
    }
    return transport === 'http' ? new McpHttpClient(server) : new McpSseClient(server);
  }
  if (!(server.command ?? '').trim()) {
    throw new Error(`MCP server ${describe(server)} has no command configured for the stdio transport.`);
  }
  return new McpStdioClient(server);
}

// ---------- server→client notifications & progress (v3.1) ----------

/** Latest progress notification per tools/call progressToken (best-effort). */
const progressByToken = new Map<
  string,
  { message?: string; progress?: number | string; total?: number; at: number }
>();

/**
 * Fan-out for server→client notifications on every transport:
 *  - notifications/tools/list_changed → annotation cache invalidated NOW
 *    (the 60s TTL is bypassed) + a background re-probe of the tool list;
 *  - notifications/progress → stored under the call's progressToken and
 *    surfaced by mcpCallTool as a `[progress: …]` line in the result.
 * Everything else is ignored. A malformed notification must never break the
 * transport's reader loop, hence the try/catch.
 */
function dispatchServerNotification(serverId: string, method: string, params: unknown): void {
  try {
    if (method === 'notifications/tools/list_changed') {
      onToolsListChanged(serverId);
      return;
    }
    if (method === 'notifications/progress') {
      const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
      const token =
        typeof p.progressToken === 'string' || typeof p.progressToken === 'number'
          ? String(p.progressToken)
          : '';
      if (!token || !progressByToken.has(token)) return; // nobody waiting on this token
      progressByToken.set(token, {
        message: typeof p.message === 'string' ? p.message : undefined,
        progress:
          typeof p.progress === 'number' || typeof p.progress === 'string' ? p.progress : undefined,
        total: typeof p.total === 'number' ? p.total : undefined,
        at: Date.now(),
      });
    }
  } catch {
    /* ignore */
  }
}

/** Pop the latest progress note for a finished call (undefined when silent). */
function takeProgress(token: string): string | undefined {
  const p = progressByToken.get(token);
  if (!p) return undefined;
  const ratio = p.progress != null && p.total != null ? `${p.progress}/${p.total}` : p.progress != null ? String(p.progress) : undefined;
  if (p.message) return ratio ? `${p.message} (${ratio})` : p.message;
  return ratio;
}

// ---------- server→client requests: elicitation → approval flow (v7.3) ----------
//
// Honest note first: Surnia's MCP client is dependency-free hand-rolled
// JSON-RPC (package.json ships NO @modelcontextprotocol/sdk), so there is no
// SDK elicitation API to call into. What the MCP spec DOES define is
// wire-level and fully supported by the transports below:
//   `elicitation/create` is a server→client REQUEST with params
//   { message, requestedSchema }; the client answers with
//   { action: 'accept' | 'decline' | 'cancel', content? }.
//
// The request is surfaced through the SAME approval pipeline the agent uses
// for tool approvals: an `approval_request` AgentEvent (kind 'mcp_elicitation')
// on the 'kdx:agent-event' channel — exactly where register.ts sends tool
// approvals. Decisions come back via the kdx:mcp:elicitDecision IPC channel
// (exposed through preload/api as mcpElicitDecision). If no decision arrives
// within ELICIT_DECISION_TIMEOUT_MS the server gets a conservative decline.
//
// Second path for servers that surface elicitation needs only as a tool-call
// failure: when a tools/call error looks elicitation-related, mcpCallTool
// emits the same approval event with the server's message (informational —
// the call has already failed and the model sees the error text).

/** One elicitation request surfaced to the user. */
interface McpElicitationRequest {
  serverId: string;
  serverName: string;
  message: string;
  requestedSchema?: unknown;
}

interface PendingElicitation {
  request: McpElicitationRequest;
  resolve: (result: { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }) => void;
  timer?: NodeJS.Timeout;
}

/** Decisions wait this long; a lapse answers the server with a decline. */
const ELICIT_DECISION_TIMEOUT_MS = 5 * 60_000;
const pendingElicitations = new Map<string, PendingElicitation>();

/**
 * Same delivery channel tool approvals use (agent/register.ts rawSend →
 * webContents.send('kdx:agent-event')). The renderer store already routes
 * approval_request events to the approval card.
 */
// v11.4 — optional coalescing sink: the agent bridge (register.ts) hands its
// coalescing `send` here at boot. When set, agent events flow through that
// bridge — pending text/think buffers are flushed BEFORE the event lands and
// ordering with the live stream is preserved — instead of being broadcast raw
// (an elicitation approval card could otherwise precede the last <=33ms of
// buffered stream text). Unset (headless CLI / tests) → raw broadcast below.
let agentEventSink: ((event: AgentEvent) => void) | null = null;

/** register.ts wires its coalescing send here (single call at app start). */
export function setAgentEventSink(sink: ((event: AgentEvent) => void) | null): void {
  agentEventSink = sink;
}

function emitAgentEvent(event: AgentEvent): void {
  if (agentEventSink) {
    try {
      agentEventSink(event);
      return;
    } catch {
      /* sink failed — fall through to the raw broadcast */
    }
  }
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('kdx:agent-event', event);
    }
  } catch {
    /* app tearing down / headless CLI — nothing to send to */
  }
}

/** Push an mcp_elicitation approval card to the renderer. */
function emitElicitationApproval(request: McpElicitationRequest, requestId: string, toolName?: string): void {
  emitAgentEvent({
    type: 'approval_request',
    requestId,
    kind: 'mcp_elicitation',
    title: `MCP server "${request.serverName}" needs your input`,
    detail: request.message,
    payload: {
      ...(toolName ? { toolName } : {}),
      serverId: request.serverId,
      elicitationMessage: request.message,
      elicitationSchema: request.requestedSchema,
      allowText: true,
    },
  });
}

/** Resolve one pending elicitation (decision IPC or timeout). False = unknown id. */
function settleElicitation(
  requestId: string,
  result: { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> },
): boolean {
  const p = pendingElicitations.get(requestId);
  if (!p) return false;
  pendingElicitations.delete(requestId);
  if (p.timer) clearTimeout(p.timer);
  try {
    p.resolve(result);
  } catch {
    /* reply-transport failures are best-effort */
  }
  return true;
}

/** Decision path (kdx:mcp:elicitDecision). */
function resolveElicitation(
  requestId: string,
  action: 'accept' | 'decline' | 'cancel',
  content?: Record<string, unknown>,
): boolean {
  return settleElicitation(requestId, { action, ...(content ? { content } : {}) });
}

/**
 * Wire-level server→client request handler shared by all three transports.
 * Owns `elicitation/create` (emits the approval event, waits for the user's
 * decision, then answers over `reply`). Returns false for methods it does
 * not own so transports keep their existing fallback behavior (ping/pong,
 * -32601 or ignore).
 */
function dispatchServerRequest(
  server: MCPServerConfig,
  method: string,
  params: unknown,
  reply: (result: unknown) => void,
): boolean {
  try {
    if (method !== 'elicitation/create') return false;
    const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
    const request: McpElicitationRequest = {
      serverId: server.id,
      serverName: server.name || server.id,
      message:
        typeof p.message === 'string' && p.message.trim()
          ? p.message
          : '(the server did not provide a message)',
      requestedSchema: p.requestedSchema ?? undefined,
    };
    const requestId = randomUUID();
    const timer = setTimeout(() => {
      // No decision in time — answer the server with a conservative decline.
      settleElicitation(requestId, { action: 'decline' });
    }, ELICIT_DECISION_TIMEOUT_MS);
    timer.unref?.();
    pendingElicitations.set(requestId, {
      request,
      resolve: (result) => {
        try {
          reply({ action: result.action, ...(result.content ? { content: result.content } : {}) });
        } catch {
          /* transport may be gone — best-effort */
        }
      },
      timer,
    });
    emitElicitationApproval(request, requestId);
    return true;
  } catch {
    return false;
  }
}

// ---------- persistent client pool (v3.1) ----------
//
// Spawning a fresh process per tools/list AND tools/call paid an npx cold
// start every time and broke stateful servers (memory, puppeteer, DB
// sessions). The pool keeps ONE live client per server, reuses it across
// calls, disposes it after 5 minutes without use, and caps the pool at 8
// live clients (LRU). A config edit (args/env/url/cwd…) invalidates the
// cached client via a fingerprint mismatch. `closeAllMcpClients()` is
// exported for the app-quit path.

const POOL_MAX_LIVE = 8;
const POOL_IDLE_TTL_MS = 5 * 60_000;

interface PoolEntry {
  client: McpTransport;
  /** Config fingerprint — a change forces a respawn on the next call. */
  sig: string;
  lastUsed: number;
  idleTimer?: NodeJS.Timeout;
  /** Shared handshake promise — cleared once resolved so reuse hits the fast path. */
  starting?: Promise<McpTransport>;
  /** Set by the failure path (even before the entry is visible in the pool). */
  failed?: boolean;
  /**
   * Set by disposePersistentClient() BEFORE kill(). Distinguishes an
   * intentional teardown (idle TTL, LRU eviction, app quit, retry) from a real
   * crash, so killing a client during shutdown never schedules a stray
   * auto-restart timer / re-spawns an orphan process.
   */
  disposed?: boolean;
}

const pool = new Map<string, PoolEntry>();

function configSig(server: MCPServerConfig): string {
  return JSON.stringify([
    server.transport ?? 'stdio',
    server.command,
    server.args,
    server.env,
    server.url,
    server.headers,
    server.cwd,
    server.timeoutMs,
  ]);
}

function stopIdleTimer(entry: PoolEntry | undefined): void {
  if (entry?.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
  }
}

/**
 * (Re)arm the idle TTL. Health pings deliberately do NOT go through here —
 * a server nobody talks to still gets disposed after 5 quiet minutes.
 */
function touchEntry(serverId: string, entry: PoolEntry): void {
  entry.lastUsed = Date.now();
  stopIdleTimer(entry);
  entry.idleTimer = setTimeout(() => {
    disposePersistentClient(serverId);
    // Honest dot: the pooled connection is gone. 'starting' makes the next
    // health tick reconnect instead of reporting a stale 'up' forever.
    setHealth(serverId, { status: 'starting', nextRetryAt: undefined, lastError: undefined });
  }, POOL_IDLE_TTL_MS);
  entry.idleTimer.unref?.();
}

/** Drop a pooled client (kills the stdio child / aborts remote sockets). */
export function disposePersistentClient(serverId: string): void {
  const entry = pool.get(serverId);
  if (!entry) return;
  // Mark FIRST: kill() can synchronously reject an in-flight handshake, whose
  // catch handler must not mistake our own teardown for a server crash.
  entry.disposed = true;
  pool.delete(serverId);
  stopIdleTimer(entry);
  try {
    entry.client.kill();
  } catch {
    /* ignore */
  }
}

/** Kill every pooled client — exported for the app-quit path (main.ts). */
export function closeAllMcpClients(): void {
  // Cancel pending auto-restarts FIRST: a crash may have armed a backoff timer
  // whose callback respawns a persistent client seconds after "close all",
  // leaving an orphan process running after the app quit.
  for (const e of healthMap.values()) {
    if (e.retryTimer) {
      clearTimeout(e.retryTimer);
      e.retryTimer = undefined;
    }
  }
  for (const id of [...pool.keys()]) disposePersistentClient(id);
}

/** Pooled entry lookup for the health monitor (undefined when not pooled). */
function pooledEntry(serverId: string): PoolEntry | undefined {
  const entry = pool.get(serverId);
  return entry && !entry.starting && entry.client.alive() ? entry : undefined;
}

/** Keep at most POOL_MAX_LIVE clients — evict the least recently used. */
function evictLru(excludeId: string): void {
  while (pool.size > POOL_MAX_LIVE) {
    let oldestId: string | undefined;
    let oldest = Infinity;
    for (const [id, e] of pool) {
      if (id === excludeId) continue;
      if (e.lastUsed < oldest) {
        oldest = e.lastUsed;
        oldestId = id;
      }
    }
    if (!oldestId) break;
    disposePersistentClient(oldestId);
  }
}

/**
 * Pooled client for a server: connects once, then REUSES the live session.
 * Failure semantics: ONE fresh spawn attempt per call — a broken server is
 * never spawn-looped here; the error is recorded on the health card and the
 * next call may try again. Concurrent callers share the in-flight handshake.
 */
async function getPersistentClient(server: MCPServerConfig): Promise<McpTransport> {
  const entry = pool.get(server.id);
  if (entry) {
    if (entry.failed) {
      // Previous attempt failed — this call is the ONE fresh spawn retry.
      disposePersistentClient(server.id);
    } else if (entry.sig !== configSig(server)) {
      // Config edited (args/env/url/cwd/timeout) — the cached client is stale.
      disposePersistentClient(server.id);
    } else if (entry.starting) {
      return entry.starting; // handshake already in flight — share it
    } else if (entry.client.alive()) {
      touchEntry(server.id, entry);
      return entry.client;
    } else {
      disposePersistentClient(server.id); // dead socket / exited child
    }
  }
  return startPooledClient(server);
}

function startPooledClient(server: MCPServerConfig): Promise<McpTransport> {
  const inflight = pool.get(server.id)?.starting;
  if (inflight) return inflight;
  let client: McpTransport;
  try {
    client = createClient(server);
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
  const entry: PoolEntry = { client, sig: configSig(server), lastUsed: Date.now() };
  let handshakeDone = false;
  // ONE health report per client lifetime — handshake failure OR a later
  // crash, whichever comes first. The old code reused a single `settled`
  // flag and therefore IGNORED every crash that happened after a successful
  // handshake (dead client left pooled, health card stuck on "up").
  let reported = false;

  const evict = (): void => {
    if (pool.get(server.id) === entry) {
      pool.delete(server.id);
      stopIdleTimer(entry);
    }
  };
  const report = (err: Error): void => {
    // A teardown we initiated (idle TTL, LRU, app quit, our own retry) is not
    // a crash: never arm a stray auto-restart for a client we deliberately
    // killed. Genuine failures always get their one report.
    if (reported || entry.disposed) return;
    reported = true;
    entry.failed = true;
    evict();
    // Kill the child only when the handshake never finished — a live client
    // that crashed is already dead, and killing it again would be a no-op.
    if (!handshakeDone) {
      try {
        client.kill();
      } catch {
        /* ignore */
      }
    }
    // Mark unhealthy + arm the auto-restart ladder (which respawns the
    // PERSISTENT client after backoff instead of probing per call).
    healthFail(safeServers().find((m) => m.id === server.id) ?? server, err.message);
  };

  const starting = (async (): Promise<McpTransport> => {
    await withTimeout(
      client.start(),
      startupTimeoutMs(server) + 2000,
      `MCP handshake timed out for ${describe(server)}`,
    ).catch((err: unknown) => {
      // A cold `npx -y …` install legitimately takes a while — but when the
      // generous budget is finally exhausted, say WHAT to fix instead of
      // dumping the raw timeout. Non-retryable: a second 2-minute wait would
      // only make the UI look hung; the health ladder owns reconnection.
      throw new McpTransportError(mcpFriendlyError(server, err), false);
    });
    handshakeDone = true;
    entry.starting = undefined; // resolved — later callers take the fast reuse path
    if (pool.get(server.id) === entry) touchEntry(server.id, entry);
    // A successful handshake means the server is reachable again. Cancel any
    // restart timer armed by an earlier failure so it cannot kill THIS healthy
    // client a few seconds later (orphan process / needless respawn).
    const h = healthMap.get(server.id);
    if (h?.retryTimer) {
      clearTimeout(h.retryTimer);
      h.retryTimer = undefined;
    }
    setHealth(server.id, {
      status: 'up',
      lastError: undefined,
      nextRetryAt: undefined,
      restarts: 0,
      lastCheckedAt: Date.now(),
    });
    return client;
  })();
  entry.starting = starting;
  starting.catch(report);
  client.onClosed = (reason: Error) => {
    if (handshakeDone) {
      // LIVE pooled client died (stdio exit / SSE drop). Report honestly and
      // evict it NOW so no later caller reuses a corpse; the health ladder
      // schedules the reconnect.
      evict();
      report(reason);
    } else {
      report(reason); // crash during handshake → reject the shared promise
    }
  };
  pool.set(server.id, entry);
  evictLru(server.id);
  return starting;
}

/** Run one call attempt with a pooled client, managing the idle timer. */
async function withClientOnce<T>(server: MCPServerConfig, fn: (client: McpTransport) => Promise<T>): Promise<T> {
  const client = await getPersistentClient(server); // may reject with a transport error
  const entry = pool.get(server.id);
  stopIdleTimer(entry);
  try {
    const value = await fn(client);
    if (pool.get(server.id) === entry && entry?.client.alive()) touchEntry(server.id, entry);
    return value;
  } catch (err) {
    if (pool.get(server.id) === entry) disposePersistentClient(server.id);
    throw err;
  }
}

/**
 * Run `fn` with the pooled persistent client. The connection STAYS WARM after
 * fn returns (the whole point) — only errors are propagated. The idle timer
 * is suspended while fn runs so a long tools/call is never killed mid-flight.
 * On a transport-level failure the pooled entry is evicted: the NEXT call then
 * pays one fresh spawn (old always-fresh semantics on failure, warm session
 * on success) instead of hammering a wedged connection forever.
 *
 * COLD-START RETRY: a brand-new client (no warm pooled session) that fails at
 * the TRANSPORT layer — process still warming up, socket not ready, timeout —
 * gets exactly ONE fresh attempt. Tool-level errors (`isError`) and config /
 * auth failures (HTTP 4xx, missing command) are never retried, so a tool that
 * actually ran is never executed twice. A WARM client that dies mid-call is
 * NOT retried here; its crash is reported and the health ladder reconnects it.
 */
async function withClient<T>(server: MCPServerConfig, fn: (client: McpTransport) => Promise<T>): Promise<T> {
  const wasWarm = !!pooledEntry(server.id);
  try {
    return await withClientOnce(server, fn);
  } catch (err) {
    if (wasWarm || !isRetryableTransportError(err)) throw err;
    return withClientOnce(server, fn);
  }
}

// ---------- response mappers ----------

/** MCP tool annotations (tools/list `annotations` object, MCP spec). */
export interface MCPToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** MCPToolInfo + v2 enrichment (annotations, scanner verdicts). */
export interface MCPToolInfoEx extends MCPToolInfo {
  annotations?: MCPToolAnnotations;
  /** Anti-poisoning scanner codes (see SCAN_RULES below). */
  suspicious?: string[];
  /** Convenience: readOnlyHint === false || destructiveHint === true. */
  destructive?: boolean;
  /** Set by toolsExtended — false when the user disabled this tool. */
  enabled?: boolean;
  /** v7.3 — true when the tool is excluded by the server's allow/deny lists. */
  denied?: boolean;
}

function parseAnnotations(raw: unknown): MCPToolAnnotations | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: MCPToolAnnotations = {};
  let any = false;
  if (typeof r.title === 'string' && r.title.trim()) {
    out.title = r.title.trim();
    any = true;
  }
  for (const k of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const) {
    if (typeof r[k] === 'boolean') {
      out[k] = r[k] as boolean;
      any = true;
    }
  }
  return any ? out : undefined;
}

/** A tool is destructive when it explicitly says it writes/destroys. */
function isDestructiveTool(a: MCPToolAnnotations | undefined): boolean {
  return !!a && (a.readOnlyHint === false || a.destructiveHint === true);
}

function mapTool(raw: unknown, serverId: string): MCPToolInfoEx | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name : '';
  if (!name) return null;
  const schema = r.inputSchema ?? r.input_schema;
  const annotations = parseAnnotations(r.annotations);
  const suspicious = scanToolDescription(typeof r.description === 'string' ? r.description : undefined);
  const tool: MCPToolInfoEx = {
    name,
    description: typeof r.description === 'string' ? r.description : undefined,
    inputSchema: schema === undefined ? undefined : schema,
    serverId,
  };
  if (annotations) tool.annotations = annotations;
  if (suspicious.length) tool.suspicious = suspicious;
  if (isDestructiveTool(annotations)) tool.destructive = true;
  return tool;
}

/** Deterministic (prompt-cache friendly) tool order: byte-wise by name. */
function sortTools<T extends MCPToolInfo>(tools: T[]): T[] {
  return [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Mirrors tools.ts `slugMcpName` (kept local to avoid a circular import).
 * agent/tools.ts names an MCP tool `mcp__<serverSlug>__<toolSlug>`, so two
 * tools whose names collapse to the SAME slug become one indistinguishable
 * tool def — the model cannot tell them apart and one is unreachable. Drop
 * later collisions and warn once so discovery stays deterministic and honest.
 */
function slugMcpNameLocal(part: string): string {
  return part.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'mcp';
}

function dedupeToolSlugs<T extends MCPToolInfo>(server: MCPServerConfig, tools: T[]): T[] {
  const seen = new Map<string, string>(); // slug → original name
  const out: T[] = [];
  for (const t of tools) {
    const slug = slugMcpNameLocal(t.name);
    const prior = seen.get(slug);
    if (prior) {
      console.warn(
        `[mcp] server ${describe(server)} advertises tools "${prior}" and "${t.name}" which both map to the agent name "mcp__${slugMcpNameLocal(server.name)}__${slug}"; keeping "${prior}" and skipping "${t.name}". Rename one of the tools on the server to expose both.`,
      );
      continue;
    }
    seen.set(slug, t.name);
    out.push(t);
  }
  return out;
}

// ---------- per-server tool allow/deny (v7.3) ----------
//
// MCPServerConfig.toolAllow / toolDeny gate which tools EVER reach the agent:
//  • patterns are exact tool names or globs (`*` = any run of characters,
//    `?` = exactly one character; matched case-insensitively, trimmed);
//  • an empty/absent toolAllow means "everything allowed";
//  • DENY WINS: a tool matching toolDeny is blocked even when toolAllow
//    also matches it.
// Enforcement points (all in this module):
//  • mcpListTools — the agent-loop discovery path. Filtered tools never
//    reach tools.ts getToolDefs, so the model is never offered them;
//  • mcpCallTool — hard refusal for denied names (defense in depth);
//  • kdx:mcp:toolsExtended — the panel inspector still LISTS everything
//    (the user must see the tools to edit the lists) but marks denied
//    entries with `denied: true`.

/** Compile one allow/deny pattern (exact name or glob) to an anchored RegExp. */
function toolPatternToRegExp(pattern: string): RegExp {
  let out = '';
  for (const ch of pattern) {
    if (ch === '*') out += '[\\s\\S]*';
    else if (ch === '?') out += '[\\s\\S]';
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

interface ToolAccessRules {
  /** null = no allow list configured (everything allowed unless denied). */
  allow: RegExp[] | null;
  deny: RegExp[];
}

const toolAccessCache = new Map<string, { sig: string; rules: ToolAccessRules }>();

function toolAccessRules(server: MCPServerConfig): ToolAccessRules {
  const sig = JSON.stringify([server.toolAllow ?? null, server.toolDeny ?? null]);
  const hit = toolAccessCache.get(server.id);
  if (hit && hit.sig === sig) return hit.rules;
  const cleanList = (v: string[] | undefined): string[] =>
    (Array.isArray(v) ? v : [])
      .map((s) => String(s ?? '').trim())
      .filter((s) => s.length > 0);
  const allowList = cleanList(server.toolAllow);
  const denyList = cleanList(server.toolDeny);
  const rules: ToolAccessRules = {
    allow: allowList.length ? allowList.map(toolPatternToRegExp) : null,
    deny: denyList.map(toolPatternToRegExp),
  };
  toolAccessCache.set(server.id, { sig, rules });
  return rules;
}

/** True when the tool passes the server's allow/deny gate (deny wins). */
export function toolAccessAllowed(server: MCPServerConfig, toolName: string): boolean {
  const rules = toolAccessRules(server);
  if (rules.deny.some((re) => re.test(toolName))) return false;
  if (rules.allow && !rules.allow.some((re) => re.test(toolName))) return false;
  return true;
}

/** Drop tools the server's allow/deny lists exclude (deny wins). */
function filterToolAccess<T extends MCPToolInfo>(server: MCPServerConfig, tools: T[]): T[] {
  const rules = toolAccessRules(server);
  if (!rules.allow && !rules.deny.length) return tools;
  return tools.filter((t) => toolAccessAllowed(server, t.name));
}

function mapResource(raw: unknown, serverId: string): MCPResourceInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const uri = typeof r.uri === 'string' ? r.uri : '';
  if (!uri) return null;
  return {
    serverId,
    uri,
    name: typeof r.name === 'string' ? r.name : undefined,
    description: typeof r.description === 'string' ? r.description : undefined,
    mimeType: typeof r.mimeType === 'string' ? r.mimeType : undefined,
  };
}

function mapPrompt(raw: unknown, serverId: string): MCPPromptInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name : '';
  if (!name) return null;
  const args = Array.isArray(r.arguments)
    ? (r.arguments as unknown[])
        .map((a) => {
          const o = (a ?? {}) as Record<string, unknown>;
          return {
            name: typeof o.name === 'string' ? o.name : '',
            description: typeof o.description === 'string' ? o.description : undefined,
            required: o.required === true,
          };
        })
        .filter((a) => a.name)
    : undefined;
  return {
    serverId,
    name,
    description: typeof r.description === 'string' ? r.description : undefined,
    arguments: args && args.length ? args : undefined,
  };
}

function listOf(result: unknown, key: string): unknown[] {
  const arr = (result as Record<string, unknown> | null)?.[key];
  return Array.isArray(arr) ? arr : [];
}

/** Join resources/read content parts: text parts concatenated, first blob kept. */
function readContent(uri: string, result: unknown): MCPResourceContent {
  const parts = listOf(result, 'contents');
  let mimeType: string | undefined;
  const texts: string[] = [];
  let blob: string | undefined;
  for (const part of parts) {
    const p = (part ?? {}) as Record<string, unknown>;
    if (typeof p.mimeType === 'string' && !mimeType) mimeType = p.mimeType;
    if (typeof p.text === 'string') texts.push(p.text);
    else if (typeof p.blob === 'string' && blob === undefined) blob = p.blob;
  }
  const out: MCPResourceContent = { uri };
  if (mimeType) out.mimeType = mimeType;
  if (texts.length) out.text = texts.join('\n');
  else if (blob !== undefined) out.blob = blob;
  return out;
}

// ---------- public API (compat contract — do not change signatures) ----------

/**
 * tools/list with cursor pagination: follows `nextCursor` and merges pages
 * (max 10 — a hostile server cannot stall discovery forever). Duplicate
 * tool names (a server re-listing a tool across pages) keep the first hit.
 */
async function listAllTools(client: McpTransport, serverId: string, timeoutMs: number): Promise<MCPToolInfoEx[]> {
  const tools: MCPToolInfoEx[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const res = (await client.call('tools/list', cursor ? { cursor } : {}, timeoutMs)) as unknown;
    for (const raw of listOf(res, 'tools')) {
      const mapped = mapTool(raw, serverId);
      if (mapped && !seen.has(mapped.name)) {
        seen.add(mapped.name);
        tools.push(mapped);
      }
    }
    const next = (res as Record<string, unknown> | null)?.nextCursor;
    if (typeof next !== 'string' || !next) break;
    cursor = next;
  }
  return tools;
}

/** Join MCP content parts into model-facing text (text parts verbatim, rest JSON). */
function contentText(parts: unknown[]): string {
  return parts
    .map((part) => {
      if (part && typeof part === 'object' && !Array.isArray(part)) {
        const p = part as { type?: unknown; text?: unknown };
        // Text parts are the model-facing payload — emit them VERBATIM so a
        // tool's answer is never mangled or silently dropped.
        if (p.type === 'text') return String(p.text ?? '');
        // Non-text parts (image/resource/audio) still carry data. Label them
        // so the result is understandable and nothing is lost.
        const label = typeof p.type === 'string' && p.type ? `[${p.type}] ` : '';
        try {
          return label + JSON.stringify(part);
        } catch {
          return label + String(part);
        }
      }
      if (typeof part === 'string') return part;
      try {
        return JSON.stringify(part);
      } catch {
        return String(part);
      }
    })
    .filter((s) => s.length > 0)
    .join('\n');
}

// ---------- last-good tool list (v11.26) ----------
//
// The engine's discovery is deliberately fire-and-forget (engine.ts keeps it
// off the first-token path): `mcpListTools` is called in the background and a
// single transient failure used to make it return {ok:false}, so that server's
// tools were silently absent from the run. Remember the last SUCCESSFUL,
// fully-mapped list per server (fingerprinted by config) and use it ONLY as a
// failure fallback — a known tool is never dropped because a connection blipped.
interface ToolsCacheEntry {
  sig: string;
  at: number;
  tools: MCPToolInfoEx[];
}
const toolsCache = new Map<string, ToolsCacheEntry>();
const TOOLS_CACHE_TTL_MS = 60_000;

function rememberTools(server: MCPServerConfig, tools: MCPToolInfoEx[]): void {
  toolsCache.set(server.id, { sig: configSig(server), at: Date.now(), tools });
  // v11.31: the first successful list is the APPROVED baseline every later
  // re-probe is hash-compared against (anti rug-pull). Never seed the pin from
  // a list we have not actually observed from the server.
  pinToolDefinitions(server, tools);
}

function lastGoodTools(server: MCPServerConfig): MCPToolInfoEx[] | undefined {
  const c = toolsCache.get(server.id);
  if (!c || c.sig !== configSig(server) || Date.now() - c.at > TOOLS_CACHE_TTL_MS) return undefined;
  return c.tools;
}

/**
 * Turn a raw tool list into exactly what the engine's discovery path consumes:
 * deterministic order, disabled/denied tools removed, slug collisions dropped.
 */
function finalizeDiscoveredTools(server: MCPServerConfig, tools: MCPToolInfoEx[]): MCPToolInfo[] {
  const visible = dedupeToolSlugs(
    server,
    filterToolAccess(server, filterDisabledTools(server.id, sortTools(tools))),
  );
  warnCrossServerCollisions(server, visible);
  return visible;
}

// ---------- tool-definition pinning + re-approval (v11.31, anti rug-pull) ----------
//
// `notifications/tools/list_changed` makes the scanner re-probe a server, but
// a hostile server can silently swap a tool's description or inputSchema
// between approvals (prompt injection / changed parameters). Pin a
// deterministic SHA-256 of every tool definition at discovery time. When a
// later re-probe changes an EXISTING tool materially, emit a re-approval card
// through the SAME elicitation plumbing used by elicitation/create and refuse
// calls to that tool until the user accepts the new definition.

/** Deterministic JSON (sorted object keys) — input to the definition hash. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

interface ToolDefSnapshot {
  hash: string;
  description?: string;
  schemaJson?: string;
  annotationsJson?: string;
}

/** SHA-256 of exactly the model-facing parts of a tool definition. */
export function computeToolDefinitionHash(tool: MCPToolInfo): string {
  const extended = tool as MCPToolInfoEx;
  return createHash('sha256')
    .update(
      stableStringify({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: extended.annotations,
      }),
    )
    .digest('hex');
}

function snapshotOf(tool: MCPToolInfo): ToolDefSnapshot {
  const extended = tool as MCPToolInfoEx;
  return {
    hash: computeToolDefinitionHash(tool),
    description: tool.description,
    schemaJson: tool.inputSchema === undefined ? undefined : stableStringify(tool.inputSchema),
    annotationsJson: extended.annotations === undefined ? undefined : stableStringify(extended.annotations),
  };
}

/** serverId → tool name → pinned snapshot (baseline approved by the user). */
const pinnedToolDefs = new Map<string, Map<string, ToolDefSnapshot>>();

function pinToolDefinitions(server: MCPServerConfig, tools: MCPToolInfo[]): void {
  const snapshot = new Map<string, ToolDefSnapshot>();
  for (const t of tools) snapshot.set(t.name, snapshotOf(t));
  pinnedToolDefs.set(server.id, snapshot);
}

interface PendingToolApproval {
  serverId: string;
  toolName: string;
  newHash: string;
  reasons: string[];
}
/** `${serverId}::${toolName}` → materially changed, awaiting re-approval. */
const pendingToolApproval = new Map<string, PendingToolApproval>();

export interface ToolDefinitionChange {
  name: string;
  kind: 'changed' | 'new' | 'removed';
  reasons: string[];
}

/** Surface a material change as a re-approval card (existing elicitation plumbing). */
function emitToolChangeReapproval(server: MCPServerConfig, changed: ToolDefinitionChange[]): void {
  const requestId = randomUUID();
  const serverName = server.name || server.id;
  const names = changed.map((c) => c.name).join(', ');
  const detail =
    `This server changed the definition of tool(s) ${names} after they were approved. ` +
    'A changed description or input schema can alter what the model sees or does. ' +
    'Review the new definition before allowing another call.';
  const timer = setTimeout(() => settleElicitation(requestId, { action: 'decline' }), ELICIT_DECISION_TIMEOUT_MS);
  timer.unref?.();
  pendingElicitations.set(requestId, {
    request: { serverId: server.id, serverName, message: detail },
    resolve: (result) => {
      for (const c of changed) {
        const key = approvalKey(server.id, c.name);
        pendingToolApproval.delete(key);
        const st = v2State();
        if (result.action === 'accept') {
          // Accepted: detectToolDefinitionChanges already re-pinned to the new
          // definition; just lift the gate and any deny recorded for it.
          if (st.approvals[key] === 'deny') delete st.approvals[key];
        } else {
          // Declined/cancelled: treated as a remembered deny (durable gate).
          st.approvals[key] = 'deny';
        }
      }
      saveV2State();
    },
    timer,
  });
  emitAgentEvent({
    type: 'approval_request',
    requestId,
    kind: 'mcp_elicitation',
    title: `MCP server "${serverName}" changed a tool definition — review`,
    detail,
    payload: {
      serverId: server.id,
      toolName: changed[0]?.name,
      allowText: true,
      elicitationMessage: detail,
      elicitationSchema: { changedTools: changed.map((c) => ({ name: c.name, reasons: c.reasons })) },
    },
  });
}

/**
 * Compare a fresh tools/list against the pinned baseline. New/removed tools
 * are informational; a CHANGED existing tool is material (rug-pull) → gate it
 * and emit one re-approval card. Returns the full change list for diagnostics.
 */
export function detectToolDefinitionChanges(server: MCPServerConfig, fresh: MCPToolInfo[]): ToolDefinitionChange[] {
  const prev = pinnedToolDefs.get(server.id) ?? new Map<string, ToolDefSnapshot>();
  const changes: ToolDefinitionChange[] = [];
  const seen = new Set<string>();
  for (const t of fresh) {
    seen.add(t.name);
    const snap = snapshotOf(t);
    const old = prev.get(t.name);
    if (!old) {
      changes.push({ name: t.name, kind: 'new', reasons: ['new tool'] });
      continue;
    }
    if (old.hash === snap.hash) continue;
    const reasons: string[] = [];
    if (old.description !== snap.description) reasons.push('description');
    if (old.schemaJson !== snap.schemaJson) reasons.push('input schema');
    if (old.annotationsJson !== snap.annotationsJson) reasons.push('annotations');
    changes.push({ name: t.name, kind: 'changed', reasons: reasons.length ? reasons : ['definition'] });
  }
  for (const name of prev.keys()) {
    if (!seen.has(name)) changes.push({ name, kind: 'removed', reasons: ['tool removed'] });
  }
  // Re-pin to the freshly observed set: a later unchanged re-probe must not
  // emit the same card twice. The pending gate survives until the user decides.
  pinToolDefinitions(server, fresh);

  const material = changes.filter((c) => c.kind === 'changed');
  const newlyPending: ToolDefinitionChange[] = [];
  for (const c of material) {
    const key = approvalKey(server.id, c.name);
    if (pendingToolApproval.has(key)) continue;
    const freshSnap = pinnedToolDefs.get(server.id)?.get(c.name);
    pendingToolApproval.set(key, {
      serverId: server.id,
      toolName: c.name,
      newHash: freshSnap?.hash ?? '',
      reasons: c.reasons,
    });
    newlyPending.push(c);
  }
  if (newlyPending.length) emitToolChangeReapproval(server, newlyPending);
  return changes;
}

/** Diagnostic/test accessor: tools currently gated awaiting re-approval. */
export function pendingToolChangesFor(serverId: string): string[] {
  return [...pendingToolApproval.values()]
    .filter((p) => p.serverId === serverId)
    .map((p) => p.toolName);
}

/**
 * v11.26 — refresh the cached tool list in the BACKGROUND so the next run's
 * discovery can be synchronous. Best-effort: a failure keeps the last good list.
 */
async function refreshToolsInBackground(server: MCPServerConfig): Promise<void> {
  try {
    const fresh = await withClient(server, (client) =>
      listAllTools(client, server.id, probeTimeoutMs(server)),
    );
    detectToolDefinitionChanges(server, fresh); // v11.31: catch silent rug-pulls
    rememberTools(server, fresh);
    cacheAnnotations(server.id, fresh);
  } catch {
    /* keep the last good list — a transient failure never drops a tool */
  }
}

/**
 * Cross-server collisions cannot be deduped here (tools.ts owns the final
 * `mcp__<server>__<tool>` defs and this hook only sees one server at a time).
 * Warn loudly instead of letting two servers silently shadow each other's tool
 * in the model's tool list. The per-server dedupe (dedupeToolSlugs) still
 * handles collisions WITHIN one server.
 */
const agentNameOwners = new Map<string, string>();
function warnCrossServerCollisions(server: MCPServerConfig, tools: MCPToolInfo[]): void {
  for (const t of tools) {
    const agentName = `mcp__${slugMcpNameLocal(server.name)}__${slugMcpNameLocal(t.name)}`;
    const owner = agentNameOwners.get(agentName);
    if (owner && owner !== server.id) {
      console.warn(
        `[mcp] server ${describe(server)} tool "${t.name}" has agent name "${agentName}", already claimed by server "${owner}". The model cannot tell them apart — rename one server or tool.`,
      );
    } else if (!owner) {
      agentNameOwners.set(agentName, server.id);
    }
  }
}

/**
 * v11.26 — SYNCHRONOUS cached tool reader intended for engine.ts discovery.
 * Returns the last good tool list for a still-warm server with ZERO I/O, so a
 * run can advertise MCP tools discovered during an earlier run without waiting
 * on the fire-and-forget promise. `null` when nothing is cached yet (cold
 * server) — the caller should then keep its existing background discovery.
 * The engine's current fire-and-forget code never awaits discovery before
 * getToolDefs, so without this (or a bounded await) the model never sees MCP
 * tools in its FIRST provider request.
 */
export function cachedToolsForEngine(server: MCPServerConfig): MCPToolInfo[] | null {
  const cached = pooledEntry(server.id) ? lastGoodTools(server) : undefined;
  return cached ? finalizeDiscoveredTools(server, cached) : null;
}

/** Handshake (pooled client) + tools/list with pagination.
 *  v2: annotations parsed, deterministic order, user-disabled tools
 *  filtered out (what the model sees = what the user allows).
 *  v7.3: per-server allow/deny gate applied LAST — filtered tools never
 *  reach tools.ts getToolDefs (this is the engine's discovery path).
 *  v11.26: a transient failure falls back to the last good tool list so a
 *  flaky connection never silently removes a server's tools from a run. */
export async function mcpListTools(
  server: MCPServerConfig,
): Promise<{ ok: boolean; tools?: MCPToolInfo[]; error?: string }> {
  // v11.26 — SYNCHRONOUS (already-resolved-promise) fast path. This is the
  // missing piece of the engine's fire-and-forget discovery: engine.ts starts
  // discovery in the background and builds tool defs LATER IN THE SAME RUN.
  // A tools/list that needs a child-process/HTTP round-trip is a macrotask and
  // therefore always lands AFTER getToolDefs — the model never sees the tool.
  // When a live pooled client and a fresh cached list exist, resolve in a
  // microtask (before the engine's next await) and refresh in the background.
  if (pooledEntry(server.id)) {
    const cached = lastGoodTools(server);
    if (cached) {
      void refreshToolsInBackground(server);
      cacheAnnotations(server.id, cached);
      checkAutoQuarantine(server, cached);
      const visible = finalizeDiscoveredTools(server, cached);
      return { ok: true, tools: visible };
    }
  }
  try {
    let tools: MCPToolInfoEx[];
    try {
      tools = await withClient(server, async (client) =>
        listAllTools(client, server.id, probeTimeoutMs(server)),
      );
      // v11.31: compare EVERY fresh list against the approved baseline. A
      // hostile server need not send list_changed to attempt a rug-pull.
      detectToolDefinitionChanges(server, tools);
      rememberTools(server, tools);
    } catch (err) {
      const cached = lastGoodTools(server);
      if (!cached) throw err;
      console.warn(
        `[mcp] tools/list failed for ${describe(server)} (${msgOf(err)}); using the last good tool list so the model keeps the tool.`,
      );
      tools = cached;
    }
    // cacheAnnotations + auto-quarantine keep the FULL set: the panel
    // inspector must still see denied tools so the user can edit the lists.
    cacheAnnotations(server.id, tools);
    checkAutoQuarantine(server, tools);
    const visible = finalizeDiscoveredTools(server, tools);
    return { ok: true, tools: visible };
  } catch (err) {
    return { ok: false, error: mcpFriendlyError(server, err) };
  }
}

/** tools/call over the PERSISTENT pooled client (stateful servers keep their
 *  session). Joins text content parts.
 *  v2: quarantine block → remembered-deny gate → timed call, every outcome
 *  recorded in the session call log.
 *  v3.1: sends a `_meta.progressToken` (per-call uuid) and appends the latest
 *  `notifications/progress` message as a `[progress: …]` line when present. */
export async function mcpCallTool(
  server: MCPServerConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string; error?: string }> {
  if (isQuarantined(server.id)) {
    const error = `MCP server "${server.name || server.id}" is quarantined by the security scanner. Release it in the MCP panel to allow tool calls.`;
    logToolCall({ serverId: server.id, server: server.name, tool: toolName, ok: false, ms: 0, at: Date.now(), error });
    return { ok: false, output: '', error };
  }
  const gate = gateDestructiveToolCall(server, toolName);
  if (!gate.allowed) {
    logToolCall({ serverId: server.id, server: server.name, tool: toolName, ok: false, ms: 0, at: Date.now(), error: gate.reason });
    return { ok: false, output: '', error: gate.reason };
  }
  // v7.3 — defense in depth: the allow/deny gate ALSO refuses calls here, so
  // a denied tool cannot be invoked even if it somehow stayed advertised.
  if (!toolAccessAllowed(server, toolName)) {
    const error = `MCP tool "${toolName}" is blocked by the allow/deny tool list of "${
      server.name || server.id
    }". Edit the lists in the MCP panel to allow it.`;
    logToolCall({ serverId: server.id, server: server.name, tool: toolName, ok: false, ms: 0, at: Date.now(), error });
    return { ok: false, output: '', error };
  }
  // v11.31 — anti rug-pull: a tool whose definition changed since approval is
  // refused until the user accepts the re-approval card. No side effects run.
  const pendingChange = pendingToolApproval.get(approvalKey(server.id, toolName));
  if (pendingChange) {
    const error = `MCP tool "${toolName}" on "${server.name || server.id}" changed its ${
      pendingChange.reasons.join(' and ')
    } after it was last approved. Open the re-approval card and accept the new definition before calling it again.`;
    logToolCall({ serverId: server.id, server: server.name, tool: toolName, ok: false, ms: 0, at: Date.now(), error });
    return { ok: false, output: '', error };
  }
  const t0 = Date.now();
  const progressToken = randomUUID(); // per-call token for notifications/progress
  try {
    const output = await withClient(server, async (client) => {
      progressByToken.set(progressToken, { at: Date.now() }); // register BEFORE the request
      const raw = await client.call(
        'tools/call',
        { name: toolName, arguments: args, _meta: { progressToken } },
        callTimeoutMs(server),
      );

      // MCP answers with an object carrying `content`, but some servers reply
      // with a bare string. Accept both so a real answer is never lost.
      const res = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { content: raw }) as {
        isError?: boolean;
        content?: unknown;
        structuredContent?: unknown;
      };
      const parts = Array.isArray(res.content)
        ? (res.content as unknown[])
        : typeof res.content === 'string'
          ? [res.content]
          : [];
      let text = contentText(parts);
      if (!text && res.structuredContent !== undefined) {
        try {
          text = JSON.stringify(res.structuredContent, null, 2);
        } catch {
          text = String(res.structuredContent);
        }
      }

      if (res.isError) throw new Error(text || `MCP tool "${toolName}" reported an error (${describe(server)}).`);
      // Empty/missing results are reported honestly — never disguised as a
      // successful "(empty result)" that hides a dropped tool result.
      if (raw == null) {
        throw new Error(`MCP tool "${toolName}" returned no result (${describe(server)}). The server may have dropped it; retry the call.`);
      }
      const progress = takeProgress(progressToken);
      return (text || '(empty result)') + (progress ? `\n[progress: ${progress}]` : '');
    });
    const ms = Date.now() - t0;
    logToolCall({ serverId: server.id, server: server.name, tool: toolName, ok: true, ms, at: Date.now() });
    // v11.10 — awaited (not fire-and-forget): the dynamic import + atomic write
    // cost ~2ms and guarantee the per-server usage counter is consistent the
    // instant the call resolves (the registry UI and Usage tab read it right
    // after). bumpCallCounter catches internally, so this can never fail a call.
    await bumpCallCounter(server.id);
    return { ok: true, output };
  } catch (err) {
    const error = msgOf(err);
    // v7.3 — elicitation-required errors: some servers surface their
    // elicitation needs as a tools/call FAILURE instead of the wire-level
    // `elicitation/create` request. Surface the request through the approval
    // flow too (informational — the call already failed and the model sees
    // the error text either way; a decision has no call to resume).
    if (/\belicit/i.test(error)) {
      emitElicitationApproval(
        {
          serverId: server.id,
          serverName: server.name || server.id,
          message: error,
          requestedSchema: undefined,
        },
        randomUUID(),
        toolName,
      );
    }
    const friendly = mcpFriendlyError(server, err);
    logToolCall({ serverId: server.id, server: server.name, tool: toolName, ok: false, ms: Date.now() - t0, at: Date.now(), error: friendly });
    return { ok: false, output: '', error: friendly };
  } finally {
    progressByToken.delete(progressToken); // no leaks for aborted/timed-out calls
  }
}

// ---------- registry probes (v1.3; pooled clients since v3.1) ----------

/** resources/list over the pooled client. */
export async function mcpListResources(
  server: MCPServerConfig,
): Promise<{ ok: boolean; resources?: MCPResourceInfo[]; error?: string }> {
  try {
    const resources = await withClient(server, async (client) => {
      const res = (await client.call('resources/list', {}, probeTimeoutMs(server))) as unknown;
      return listOf(res, 'resources')
        .map((r) => mapResource(r, server.id))
        .filter((r): r is MCPResourceInfo => r !== null);
    });
    return { ok: true, resources };
  } catch (err) {
    return { ok: false, error: mcpFriendlyError(server, err) };
  }
}

/** resources/read over the pooled client. */
export async function mcpReadResource(
  server: MCPServerConfig,
  uri: string,
): Promise<{ ok: boolean; content?: MCPResourceContent; error?: string }> {
  try {
    const content = await withClient(server, async (client) => {
      const res = await client.call('resources/read', { uri }, probeTimeoutMs(server));
      return readContent(uri, res);
    });
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: mcpFriendlyError(server, err) };
  }
}

/** prompts/list over the pooled client. */
export async function mcpListPrompts(
  server: MCPServerConfig,
): Promise<{ ok: boolean; prompts?: MCPPromptInfo[]; error?: string }> {
  try {
    const prompts = await withClient(server, async (client) => {
      const res = (await client.call('prompts/list', {}, probeTimeoutMs(server))) as unknown;
      return listOf(res, 'prompts')
        .map((p) => mapPrompt(p, server.id))
        .filter((p): p is MCPPromptInfo => p !== null);
    });
    return { ok: true, prompts };
  } catch (err) {
    return { ok: false, error: mcpFriendlyError(server, err) };
  }
}

/** Render a prompts/get result (role-tagged messages) as readable text. */
function renderPromptResult(result: unknown): string {
  const messages = listOf(result, 'messages');
  if (!messages.length) {
    // Defensive: non-conforming result — dump it so the UI still shows something.
    try {
      return JSON.stringify(result, null, 2) || '(empty prompt result)';
    } catch {
      return '(empty prompt result)';
    }
  }
  const lines: string[] = [];
  for (const m of messages) {
    const msg = (m ?? {}) as Record<string, unknown>;
    const role = typeof msg.role === 'string' ? msg.role : 'message';
    const parts = Array.isArray(msg.content) ? msg.content : [];
    const text = parts.length ? contentText(parts) : typeof msg.content === 'string' ? msg.content : '';
    lines.push(`[${role}]\n${text || '(empty)'}`);
  }
  return lines.join('\n\n');
}

/**
 * prompts/get over the pooled client, rendered to plain text. UI-only helper
 * (MCP panel prompt runner) — deliberately NOT injected into the agent loop.
 */
export async function mcpGetPrompt(
  server: MCPServerConfig,
  promptName: string,
  args?: Record<string, string>,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    const text = await withClient(server, async (client) => {
      const res = await client.call(
        'prompts/get',
        { name: promptName, arguments: args ?? {} },
        probeTimeoutMs(server),
      );
      return renderPromptResult(res);
    });
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: mcpFriendlyError(server, err) };
  }
}

export interface McpProbeResult {
  ok: boolean;
  /** Set when the handshake or tools/list failed (resources/prompts are optional capabilities). */
  error?: string;
  tools?: MCPToolInfo[];
  resources?: MCPResourceInfo[];
  prompts?: MCPPromptInfo[];
}

/**
 * Full capability probe over a single connection: tools + resources +
 * prompts in parallel. ok=true only when tools/list succeeds; resource
 * and prompt failures are tolerated (not every server exposes them).
 * Runs over the POOLED client since v3.1 — the connection stays warm.
 */
export async function mcpProbeServer(server: MCPServerConfig): Promise<McpProbeResult> {
  try {
    return await withClient(server, async (client) => {
      const pt = probeTimeoutMs(server);
      const [tools, resources, prompts] = await Promise.allSettled([
        listAllTools(client, server.id, pt),
        client.call('resources/list', {}, pt),
        client.call('prompts/list', {}, pt),
      ]);
      if (tools.status !== 'fulfilled') {
        return { ok: false, error: mcpFriendlyError(server, tools.reason) };
      }
      const mapped = sortTools(tools.value);
      detectToolDefinitionChanges(server, mapped); // v11.31: full-probe rug-pull check
      rememberTools(server, mapped); // v11.26: seed the transient-failure fallback
      cacheAnnotations(server.id, mapped);
      checkAutoQuarantine(server, mapped);
      return {
        ok: true,
        tools: mapped,
        resources:
          resources.status === 'fulfilled'
            ? listOf(resources.value, 'resources')
                .map((r) => mapResource(r, server.id))
                .filter((r): r is MCPResourceInfo => r !== null)
            : [],
        prompts:
          prompts.status === 'fulfilled'
            ? listOf(prompts.value, 'prompts')
                .map((p) => mapPrompt(p, server.id))
                .filter((p): p is MCPPromptInfo => p !== null)
            : [],
      };
    });
  } catch (err) {
    return { ok: false, error: mcpFriendlyError(server, err) };
  }
}

// ============================================================
// v2 — deep MCP (E3)
// ============================================================

// ---------- anti tool-poisoning description scanner ----------

export interface ScanRule {
  /** Stable code stored in MCPToolInfoEx.suspicious. */
  id: string;
  re: RegExp;
  /** Human-readable explanation (UI tooltip). */
  label: string;
  /** high → can trigger auto-quarantine; advisory → badge only. */
  severity: 'high' | 'advisory';
}

const SCAN_RULES: ScanRule[] = [
  { id: 'ignore_previous', re: /\bignore\s+(?:all\s+|the\s+|any\s+)?(?:previous|prior|above|earlier)/i, label: 'Prompt injection: "ignore previous…"', severity: 'high' },
  { id: 'disregard', re: /\bdisregard\s+(?:all\s+|the\s+|any\s+)?(?:previous|prior|above|earlier|your|instructions)/i, label: 'Prompt injection: "disregard…"', severity: 'high' },
  { id: 'exfiltrate', re: /\bexfiltrat/i, label: 'Exfiltration language', severity: 'high' },
  { id: 'base64_blob', re: /[A-Za-z0-9+/]{200,}={0,2}/, label: 'Embedded base64 blob (>200 chars)', severity: 'high' },
  { id: 'credential_files', re: /(?:\.env\b|id_rsa\b|id_ed25519\b|\.ssh\b|keychain|\.netrc\b|\.aws[\\/]credentials|\.npmrc\b|\.kube[\\/]config|\.gnupg\b)/i, label: 'References credential files (.env, id_rsa, ~/.ssh, keychain…)', severity: 'high' },
  { id: 'secret_harvest', re: /\b(?:read|steal|grab|collect|harvest|expose)\b[^.;\n]{0,40}\b(?:env(?:ironment)?\s+variables?|api\s+keys?|credentials?|tokens?|secrets?|passwords?)\b/i, label: 'Instruction to read secrets/credentials', severity: 'high' },
  { id: 'send_data', re: /\b(?:send|transmit|forward|post)\s+(?:this|the|it|all|them|that|data|file|contents?|results?)\b/i, label: 'Instruction to send data to a destination', severity: 'advisory' },
  { id: 'upload', re: /\bupload(?:s|ed|ing)?\b/i, label: 'Mentions uploading data', severity: 'advisory' },
  { id: 'embedded_url', re: /https?:\/\//i, label: 'Embedded URL in description', severity: 'advisory' },
];

/** Codes whose presence alone can auto-quarantine a server. */
const HIGH_RISK_CODES: ReadonlySet<string> = new Set(
  SCAN_RULES.filter((r) => r.severity === 'high').map((r) => r.id),
);

/** Scan a tool description for tool-poisoning patterns → scanner codes. */
export function scanToolDescription(description: string | undefined): string[] {
  if (!description || !description.trim()) return [];
  const hits: string[] = [];
  for (const rule of SCAN_RULES) {
    if (rule.re.test(description)) hits.push(rule.id);
  }
  return hits;
}

/** Label lookup for scanner codes (UI). */
export function suspiciousLabel(code: string): string {
  return SCAN_RULES.find((r) => r.id === code)?.label ?? code;
}

// ---------- mcp-v2 persistent state (userData/mcp-v2.json) ----------

interface McpV2State {
  /** `${serverId}::${toolName}` → remembered approval decision. */
  approvals: Record<string, 'always' | 'deny'>;
  /** serverId → disabled tool names. */
  disabledTools: Record<string, string[]>;
  /** Auto-quarantine servers whose tools carry high-risk scanner flags. */
  autoQuarantine: boolean;
  /** serverId → quarantined (tool execution blocked). */
  quarantined: Record<string, boolean>;
}

let v2Cache: McpV2State | null = null;

function v2FilePath(): string {
  try {
    return path.join(app.getPath('userData'), 'mcp-v2.json');
  } catch {
    return ''; // app not ready yet — memory-only fallback
  }
}

function v2State(): McpV2State {
  if (v2Cache) return v2Cache;
  const file = v2FilePath();
  let parsed: Partial<McpV2State> | null = null;
  if (file) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) parsed = raw as Partial<McpV2State>;
    } catch {
      /* no file / corrupted — start clean */
    }
  }
  v2Cache = {
    approvals: parsed?.approvals && typeof parsed.approvals === 'object' ? { ...parsed.approvals } : {},
    disabledTools: parsed?.disabledTools && typeof parsed.disabledTools === 'object' ? { ...parsed.disabledTools } : {},
    autoQuarantine: parsed?.autoQuarantine === true,
    quarantined: parsed?.quarantined && typeof parsed.quarantined === 'object' ? { ...parsed.quarantined } : {},
  };
  return v2Cache;
}

function saveV2State(): void {
  if (!v2Cache) return;
  const file = v2FilePath();
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(v2Cache, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {
    /* read-only userData — decisions stay session-only */
  }
}

function isQuarantined(serverId: string): boolean {
  return v2State().quarantined[serverId] === true;
}

function disabledToolsOf(serverId: string): Set<string> {
  return new Set(v2State().disabledTools[serverId] ?? []);
}

function filterDisabledTools<T extends MCPToolInfo>(serverId: string, tools: T[]): T[] {
  const disabled = disabledToolsOf(serverId);
  if (!disabled.size) return tools;
  return tools.filter((t) => !disabled.has(t.name));
}

// ---------- annotation cache + auto-quarantine + list_changed ----------

const annCache = new Map<string, { at: number; tools: Map<string, MCPToolInfoEx> }>();

function cacheAnnotations(serverId: string, tools: MCPToolInfoEx[]): void {
  const map = new Map<string, MCPToolInfoEx>();
  for (const t of tools) map.set(t.name, t);
  annCache.set(serverId, { at: Date.now(), tools: map });
}

function checkAutoQuarantine(server: MCPServerConfig, tools: MCPToolInfoEx[]): void {
  const st = v2State();
  if (!st.autoQuarantine || st.quarantined[server.id]) return;
  const hit = tools.some((t) => (t.suspicious ?? []).some((c) => HIGH_RISK_CODES.has(c)));
  if (!hit) return;
  st.quarantined[server.id] = true;
  saveV2State();
  emitHealthFor(server.id);
}

/** Debounce timers for background tool-list refreshes (one per server). */
const toolsRefreshTimers = new Map<string, NodeJS.Timeout>();

/**
 * v3.1 — `notifications/tools/list_changed`: the annotation cache's 60s TTL
 * is bypassed and cleared IMMEDIATELY for that server, then a debounced
 * background re-probe refreshes annotations + toolCount (best-effort).
 */
function onToolsListChanged(serverId: string): void {
  annCache.delete(serverId);
  const prev = toolsRefreshTimers.get(serverId);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    toolsRefreshTimers.delete(serverId);
    void refreshToolsForServer(serverId);
  }, 250);
  timer.unref?.();
  toolsRefreshTimers.set(serverId, timer);
}

/** Background tools/list refresh over the pooled client (best-effort). */
async function refreshToolsForServer(serverId: string): Promise<void> {
  try {
    const cfg = safeServers().find((m) => m.id === serverId);
    if (!cfg || !cfg.enabled || isQuarantined(serverId)) return;
    const client = await getPersistentClient(cfg);
    const tools = sortTools(await listAllTools(client, serverId, probeTimeoutMs(cfg)));
    // v11.31: list_changed is the rug-pull vector — hash-compare against the
    // approved baseline and gate changed tools until re-approved.
    detectToolDefinitionChanges(cfg, tools);
    rememberTools(cfg, tools);
    cacheAnnotations(serverId, tools);
    checkAutoQuarantine(cfg, tools);
    setHealth(serverId, { toolCount: tools.length, lastCheckedAt: Date.now() });
  } catch {
    /* best-effort — the next full probe/list will refresh again */
  }
}

// ---------- destructive-tool approval gate (SINGLE gate, v3.1) ----------

function approvalKey(serverId: string, toolName: string): string {
  return `${serverId}::${toolName}`;
}

/**
 * v3.1 — the engine's approval gate already asks the user for destructive
 * MCP tools (rules `mcp:<toolName>`), so this layer NO LONGER pops a second
 * native dialog (that double-prompted every dangerous call). What remains is
 * the remembered per-tool decision from mcp-v2.json, which the engine cannot
 * see: a remembered DENY is a hard local refusal; 'always' simply doesn't
 * refuse locally (the engine may still ask — its rules own that UX).
 */
function gateDestructiveToolCall(server: MCPServerConfig, toolName: string): { allowed: boolean; reason?: string } {
  const remembered = v2State().approvals[approvalKey(server.id, toolName)];
  if (remembered === 'deny') {
    return {
      allowed: false,
      reason: `You previously chose "Deny" for "${toolName}" on "${server.name}". Re-allow it in the MCP panel (tool switches or "Reset approvals").`,
    };
  }
  return { allowed: true };
}

// ---------- session call log (ring buffer, last 100) ----------

export interface McpToolCallEntry {
  serverId: string;
  server: string;
  tool: string;
  ok: boolean;
  ms: number;
  at: number;
  error?: string;
}

const CALL_LOG_CAP = 100;
const callLog: McpToolCallEntry[] = [];

function logToolCall(entry: McpToolCallEntry): void {
  callLog.push(entry);
  if (callLog.length > CALL_LOG_CAP) callLog.splice(0, callLog.length - CALL_LOG_CAP);
}

/** Bump the persisted per-server calls counter (registry service owns settings). */
async function bumpCallCounter(serverId: string): Promise<void> {
  try {
    const reg = await import('../services/mcpRegistryService');
    reg.recordToolCall(serverId);
  } catch {
    /* counter is cosmetic — never fail a tool call over it */
  }
}

// ---------- health monitor (v3.1: ping over the pooled connection) ----------

export type McpHealthStatus = 'up' | 'down' | 'starting' | 'disabled' | 'quarantined';

export interface McpHealthSnapshot {
  id: string;
  name: string;
  status: McpHealthStatus;
  latencyMs?: number;
  toolCount: number;
  lastError?: string;
  lastCheckedAt?: number;
  /** Consecutive auto-restart attempts (stdio crash backoff). */
  restarts: number;
  /** Epoch ms when the next backoff probe fires ('starting'). */
  nextRetryAt?: number;
  /** v3.1 — last stderr bytes for stdio servers (panel diagnostics expander). */
  stderrTail?: string;
}

interface HealthEntry {
  status: McpHealthStatus;
  latencyMs?: number;
  toolCount: number;
  lastError?: string;
  lastCheckedAt?: number;
  restarts: number;
  nextRetryAt?: number;
  retryTimer?: NodeJS.Timeout;
  /** v3.1 — last stderr bytes from the pooled stdio client. */
  stderrTail?: string;
}

const HEALTH_INTERVAL_MS = 60_000;
const HEALTH_MAX_RESTARTS = 3;
const HEALTH_BACKOFF_MS = [5_000, 15_000, 45_000]; // exponential-ish retry ladder
/** Cheap JSON-RPC ping wait for pooled clients (they answer in ms, not seconds). */
const HEALTH_PING_TIMEOUT_MS = 5_000;

const healthMap = new Map<string, HealthEntry>();
let healthStarted = false;
let healthTimer: NodeJS.Timeout | null = null;

function healthSnapshotOf(id: string): McpHealthSnapshot {
  const e = healthMap.get(id);
  const cfg = safeServers().find((m) => m.id === id);
  return {
    id,
    name: cfg?.name ?? id,
    status: e?.status ?? 'starting',
    latencyMs: e?.latencyMs,
    toolCount: e?.toolCount ?? 0,
    lastError: e?.lastError,
    lastCheckedAt: e?.lastCheckedAt,
    restarts: e?.restarts ?? 0,
    nextRetryAt: e?.nextRetryAt,
    stderrTail: e?.stderrTail,
  };
}

function healthAll(): McpHealthSnapshot[] {
  const ids = new Set<string>([...safeServers().map((m) => m.id), ...healthMap.keys()]);
  return [...ids].map(healthSnapshotOf);
}

function emitHealth(snapshot: McpHealthSnapshot): void {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('kdx:mcp:health', snapshot);
    }
  } catch {
    /* app tearing down */
  }
}

function emitHealthFor(serverId: string): void {
  emitHealth(healthSnapshotOf(serverId));
}

function setHealth(id: string, patch: Partial<HealthEntry>): void {
  const e = healthMap.get(id) ?? { status: 'starting' as McpHealthStatus, toolCount: 0, restarts: 0 };
  healthMap.set(id, { ...e, ...patch });
  emitHealthFor(id);
}

/** Settings servers, defensively (store may be unreadable very early). */
function safeServers(): MCPServerConfig[] {
  try {
    return getSettings().mcpServers ?? [];
  } catch {
    return [];
  }
}

/**
 * Cheap liveness check for a POOLED client: a JSON-RPC `ping` over the live
 * connection (no spawn, no lists, no kill). Deliberately does NOT touch the
 * pool's idle timer — an unused server still gets TTL-disposed.
 */
async function healthPing(cfg: MCPServerConfig, entry: PoolEntry): Promise<void> {
  const t0 = Date.now();
  try {
    await entry.client.call('ping', {}, HEALTH_PING_TIMEOUT_MS);
    setHealth(cfg.id, {
      status: 'up',
      latencyMs: Date.now() - t0,
      lastError: undefined,
      lastCheckedAt: Date.now(),
      toolCount: annCache.get(cfg.id)?.tools.size ?? healthMap.get(cfg.id)?.toolCount ?? 0,
      stderrTail: entry.client.stderrTail?.(),
    });
  } catch (err) {
    // The crash hook may have already evicted the entry (stdio exit) — avoid
    // double-counting the restart ladder in that case.
    const stillPooled = pool.get(cfg.id) === entry;
    disposePersistentClient(cfg.id);
    if (stillPooled) healthFail(cfg, msgOf(err));
  }
}

/** Full capability probe (Test button, first observation, list_changed). */
async function healthProbe(cfg: MCPServerConfig): Promise<void> {
  if (!cfg.enabled || isQuarantined(cfg.id)) return;
  const t0 = Date.now();
  let ok = false;
  let error: string | undefined;
  let toolCount = 0;
  try {
    const probe = await mcpProbeServer(cfg);
    ok = probe.ok;
    error = probe.error;
    toolCount = probe.tools?.length ?? 0;
  } catch (err) {
    error = msgOf(err);
  }
  if (ok) {
    // (re)connected — reset the restart ladder
    const prev = healthMap.get(cfg.id);
    const entry = pooledEntry(cfg.id);
    setHealth(cfg.id, {
      status: 'up',
      latencyMs: Date.now() - t0,
      toolCount,
      lastError: undefined,
      lastCheckedAt: Date.now(),
      restarts: 0,
      nextRetryAt: undefined,
      stderrTail: entry?.client.stderrTail?.(),
    });
    if (prev?.retryTimer) clearTimeout(prev.retryTimer);
    return;
  }
  healthFail(cfg, error ?? 'probe failed');
}

/**
 * Auto-restart a crashed stdio server by respawning its PERSISTENT pooled
 * client (handshake + one tools/list — not the old connect+3-lists+kill).
 */
async function restartPersistentClient(cfg: MCPServerConfig): Promise<void> {
  disposePersistentClient(cfg.id);
  try {
    const client = await getPersistentClient(cfg);
    const tools = sortTools(await listAllTools(client, cfg.id, probeTimeoutMs(cfg)));
    cacheAnnotations(cfg.id, tools);
    checkAutoQuarantine(cfg, tools);
    setHealth(cfg.id, {
      status: 'up',
      toolCount: tools.length,
      lastError: undefined,
      lastCheckedAt: Date.now(),
      restarts: 0,
      nextRetryAt: undefined,
      stderrTail: client.stderrTail?.(),
    });
  } catch (err) {
    healthFail(cfg, msgOf(err));
  }
}

/** Failure path: auto-restart crashed stdio servers with exponential backoff (max 3). */
function healthFail(cfg: MCPServerConfig, error: string): void {
  const prev = healthMap.get(cfg.id);
  const transport = cfg.transport ?? 'stdio';
  const isStdio = transport === 'stdio';
  // v11.31: a dropped legacy SSE stream is a restartable transport failure,
  // not a permanent 'down'. The server's `retry:` field (when sent) sets the
  // reconnect delay; otherwise the same exponential ladder as stdio applies.
  const canRestart = (isStdio || transport === 'sse') && (prev?.restarts ?? 0) < HEALTH_MAX_RESTARTS;
  const restarts = prev?.restarts ?? 0;
  if (canRestart) {
    const n = restarts + 1;
    const sseRetry = transport === 'sse' ? sseResumeState.get(cfg.id)?.retryMs : undefined;
    const delay = sseRetry != null
      ? Math.min(60_000, Math.max(1_000, sseRetry)) // honor `retry:` but bound it
      : HEALTH_BACKOFF_MS[Math.min(n - 1, HEALTH_BACKOFF_MS.length - 1)];
    const nextRetryAt = Date.now() + delay;
    setHealth(cfg.id, { status: 'starting', restarts: n, nextRetryAt, lastError: error, lastCheckedAt: Date.now(), toolCount: prev?.toolCount ?? 0 });
    const timer = setTimeout(() => {
      const e = healthMap.get(cfg.id);
      if (e) e.retryTimer = undefined;
      // v11.26: fall back to the config captured at failure time. The engine
      // passes mcpServers straight into a run without persisting them in
      // settings.json; reading settings alone would silently skip the restart
      // and drop that MCP server from every later run.
      const still = safeServers().find((m) => m.id === cfg.id) ?? cfg;
      if (still && still.enabled && !isQuarantined(still.id)) void restartPersistentClient(still);
    }, delay);
    timer.unref?.();
    if (prev?.retryTimer) clearTimeout(prev.retryTimer);
    healthMap.set(cfg.id, { ...(healthMap.get(cfg.id) as HealthEntry), retryTimer: timer });
  } else {
    setHealth(cfg.id, { status: 'down', lastError: error, lastCheckedAt: Date.now(), nextRetryAt: undefined, toolCount: prev?.toolCount ?? 0 });
  }
}

/** One monitor pass over all configured servers. */
async function healthTick(): Promise<void> {
  const servers = safeServers();
  const ids = new Set(servers.map((m) => m.id));
  for (const id of [...healthMap.keys()]) {
    if (!ids.has(id)) {
      const gone = healthMap.get(id);
      if (gone?.retryTimer) clearTimeout(gone.retryTimer);
      healthMap.delete(id); // server removed — forget it
      disposePersistentClient(id);
    }
  }
  await Promise.allSettled(
    servers.map(async (cfg) => {
      const e = healthMap.get(cfg.id);
      if (!cfg.enabled) {
        if (e?.status !== 'disabled') {
          if (e?.retryTimer) clearTimeout(e.retryTimer);
          disposePersistentClient(cfg.id);
          setHealth(cfg.id, { status: 'disabled', restarts: 0, nextRetryAt: undefined, lastError: undefined });
        }
        return;
      }
      if (isQuarantined(cfg.id)) {
        if (e?.status !== 'quarantined') {
          disposePersistentClient(cfg.id);
          setHealth(cfg.id, { status: 'quarantined', nextRetryAt: undefined });
        }
        return;
      }
      // backoff pending — its own timer owns the next (persistent) restart
      if (e?.status === 'starting' && e.nextRetryAt && Date.now() < e.nextRetryAt) return;
      const entry = pooledEntry(cfg.id);
      if (entry) {
        // Pooled client alive → CHEAP ping over the live connection instead
        // of the old connect+3-lists+kill probe.
        await healthPing(cfg, entry);
        return;
      }
      // No live pooled client (app start / idle TTL / evicted): run the full
      // probe once — it re-pools the client, so warm ticks stay cheap after.
      await healthProbe(cfg);
    }),
  );
}

function startHealthMonitor(): void {
  if (healthStarted) return;
  healthStarted = true;
  const begin = (): void => {
    void healthTick();
    healthTimer = setInterval(() => void healthTick(), HEALTH_INTERVAL_MS);
    // don't keep the process alive just for the monitor
    healthTimer.unref?.();
  };
  try {
    if (app.isReady()) begin();
    else void app.whenReady().then(begin);
  } catch {
    begin(); // non-electron test harness — timers still harmless
  }
}

/** Public: stop the monitor + drop every pooled client (app shutdown). */
export function stopMcpHealthMonitor(): void {
  if (healthTimer) clearInterval(healthTimer);
  healthTimer = null;
  for (const e of healthMap.values()) if (e.retryTimer) clearTimeout(e.retryTimer);
  closeAllMcpClients();
}

// ---------- v2 IPC (registered from this module — ipc.ts is not touched) ----------

let v2IpcRegistered = false;

function registerMcpV2Ipc(): void {
  if (v2IpcRegistered) return;
  // The CLI engine (dist-cli/surnia.cjs) runs under plain Node — `electron`
  // resolves to the path-export stub there and ipcMain is undefined. Guard so
  // the agent engine keeps working headless; v2 IPC only exists in the app.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ipc: any = ipcMain as unknown;
  if (!ipc || typeof ipc.handle !== 'function') return;
  v2IpcRegistered = true;
  const handle = (channel: string, fn: (...args: never[]) => unknown): void => {
    ipc.handle(channel, async (_event: unknown, ...args: unknown[]) => {
      try {
        return await (fn as (...a: unknown[]) => unknown)(...args);
      } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
      }
    });
  };

  // health: full snapshot + on-demand re-probe
  handle('kdx:mcp:health:get', () => healthAll());
  handle('kdx:mcp:healthCheck', async (id?: string) => {
    if (typeof id === 'string' && id) {
      const cfg = safeServers().find((m) => m.id === id);
      if (!cfg) return healthSnapshotOf(id);
      if (!cfg.enabled) {
        setHealth(id, { status: 'disabled' });
        return healthSnapshotOf(id);
      }
      await healthProbe(cfg);
      return healthSnapshotOf(id);
    }
    await healthTick();
    return healthAll();
  });

  // tools (extended): annotations + scanner verdicts + per-tool enabled
  handle('kdx:mcp:toolsExtended', async (id?: string) => {
    const sid = String(id ?? '');
    const cfg = safeServers().find((m) => m.id === sid);
    if (!cfg) return { ok: false, error: `Unknown MCP server: ${sid}`, quarantined: isQuarantined(sid) };
    if (!cfg.enabled) return { ok: false, error: 'Server is disabled.', quarantined: isQuarantined(sid) };
    try {
      const tools = await withClient(cfg, async (client) =>
        listAllTools(client, cfg.id, probeTimeoutMs(cfg)),
      );
      const sorted = sortTools(tools);
      cacheAnnotations(cfg.id, sorted);
      checkAutoQuarantine(cfg, sorted);
      const disabled = disabledToolsOf(cfg.id);
      return {
        ok: true,
        quarantined: isQuarantined(cfg.id),
        tools: sorted.map((t) => ({
          ...t,
          enabled: !disabled.has(t.name),
          // v7.3 — allow/deny verdict for the panel's DENIED badge. The tool
          // is still listed here (management view) but filtered from the
          // agent loop by mcpListTools.
          denied: !toolAccessAllowed(cfg, t.name),
        })),
      };
    } catch (err) {
      return { ok: false, error: msgOf(err), quarantined: isQuarantined(cfg.id) };
    }
  });

  // prompts/get (v3.1): rendered text for the panel's prompt runner. Same v2
  // self-registered pattern as resources/read (ipc.ts is not touched); the
  // renderer reaches it via preload's mcpPromptGet once wired.
  handle('kdx:mcp:promptGet', async (id?: string, promptName?: string, args?: unknown) => {
    const reg = await import('../services/mcpRegistryService');
    const cleanArgs: Record<string, string> = {};
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
        if (typeof k === 'string' && k.trim()) cleanArgs[k] = typeof v === 'string' ? v : String(v ?? '');
      }
    }
    return reg.getPrompt(
      String(id ?? ''),
      String(promptName ?? ''),
      Object.keys(cleanArgs).length ? cleanArgs : undefined,
    );
  });

  // per-tool enable/disable (persisted)
  handle('kdx:mcp:toolEnable', (id?: string, tool?: string, enabled?: boolean) => {
    const sid = String(id ?? '');
    const name = String(tool ?? '');
    if (!sid || !name) return { ok: false, error: 'server id and tool name required' };
    const st = v2State();
    const list = new Set(st.disabledTools[sid] ?? []);
    if (enabled === false) list.add(name);
    else list.delete(name);
    st.disabledTools[sid] = [...list];
    if (!st.disabledTools[sid].length) delete st.disabledTools[sid];
    saveV2State();
    return { ok: true, disabled: st.disabledTools[sid] ?? [] };
  });

  // call log (session ring buffer)
  handle('kdx:mcp:callLog', () => [...callLog]);
  handle('kdx:mcp:callLogClear', () => {
    callLog.length = 0;
    return { ok: true };
  });

  // official registry search (implemented in mcpRegistryService; lazy import avoids a static cycle)
  handle('kdx:mcp:registrySearch', async (query?: string, cursor?: string) => {
    const reg = await import('../services/mcpRegistryService');
    return reg.searchRegistry(String(query ?? '').trim(), typeof cursor === 'string' && cursor ? cursor : undefined);
  });
  // official registry "add server" — UI confirms with the user first
  handle('kdx:mcp:registryAdd', async (result?: unknown, nameOverride?: string) => {
    const reg = await import('../services/mcpRegistryService');
    return reg.addFromRegistry(result as never, typeof nameOverride === 'string' && nameOverride.trim() ? nameOverride.trim() : undefined);
  });

  // v2 settings + quarantine + approvals
  handle('kdx:mcp:settingsGet', () => v2PublicState());
  handle('kdx:mcp:settingsSet', (patch?: { autoQuarantine?: boolean }) => {
    const p = (patch ?? {}) as Partial<McpV2State>;
    if (typeof p.autoQuarantine === 'boolean') v2State().autoQuarantine = p.autoQuarantine;
    saveV2State();
    return v2PublicState();
  });
  handle('kdx:mcp:quarantineSet', (id?: string, quarantined?: boolean) => {
    const sid = String(id ?? '');
    if (!sid) return { ok: false, error: 'server id required' };
    const st = v2State();
    if (quarantined === false) delete st.quarantined[sid];
    else st.quarantined[sid] = true;
    saveV2State();
    if (quarantined === false) {
      // released — probe again right away so the dot turns green/down honestly
      const cfg = safeServers().find((m) => m.id === sid);
      if (cfg?.enabled) void healthProbe(cfg);
    }
    emitHealthFor(sid);
    return { ok: true, quarantined: st.quarantined[sid] === true };
  });
  handle('kdx:mcp:approvalSet', (id?: string, tool?: string, decision?: 'always' | 'deny' | null) => {
    const sid = String(id ?? '');
    const name = String(tool ?? '');
    if (!sid || !name) return { ok: false, error: 'server id and tool name required' };
    const key = approvalKey(sid, name);
    const st = v2State();
    if (decision === 'always' || decision === 'deny') st.approvals[key] = decision;
    else delete st.approvals[key];
    saveV2State();
    return { ok: true };
  });

  // v7.3 — elicitation decisions: resolve a pending `elicitation/create`
  // request surfaced as an mcp_elicitation approval card. content carries
  // the accepted fields (requestedSchema-shaped) when action === 'accept'.
  handle('kdx:mcp:elicitDecision', (requestId?: string, action?: string, content?: unknown) => {
    const id = String(requestId ?? '');
    if (!id) return { ok: false, error: 'requestId required' };
    const a: 'accept' | 'decline' | 'cancel' = action === 'accept' || action === 'cancel' ? action : 'decline';
    const clean: Record<string, unknown> | undefined =
      a === 'accept' && content && typeof content === 'object' && !Array.isArray(content)
        ? (content as Record<string, unknown>)
        : undefined;
    return { ok: resolveElicitation(id, a, clean) };
  });

  startHealthMonitor();
}

/** Renderer-safe view of the v2 store. */
function v2PublicState(): {
  autoQuarantine: boolean;
  quarantined: string[];
  approvals: Record<string, 'always' | 'deny'>;
  disabledTools: Record<string, string[]>;
} {
  const st = v2State();
  return {
    autoQuarantine: st.autoQuarantine,
    quarantined: Object.keys(st.quarantined).filter((k) => st.quarantined[k]),
    approvals: { ...st.approvals },
    disabledTools: Object.fromEntries(Object.entries(st.disabledTools).map(([k, v]) => [k, [...v]])),
  };
}

// Module init: mcp.ts is imported by main.ts at startup, so this runs once
// before app ready (ipcMain handles may be registered pre-ready). Under the
// headless CLI the guard inside makes this a no-op.
registerMcpV2Ipc();
