// ============================================================
// Surnia — local HTTP control API server (loopback-only)
// A programmatic control plane in the same class as OpenCode's
// server mode / Claude Code SDK: scripts, CI and other local
// tools can list sessions, run the agent, stream its events and
// call one-shot AI completions.
//
// Design rules enforced here:
//   • Bound to 127.0.0.1 ONLY — never exposed to the network.
//   • Bearer-token auth via the Authorization header on ALL routes;
//     the ?token= query fallback is accepted ONLY on GET /events
//     (EventSource cannot set headers) and only over a loopback Host.
//   • Host-header validation on every request (DNS-rebinding defense).
//   • Failed-auth throttling (≥10 bad tokens / 60s → 750ms stall).
//   • Headless approval policy (see docs/APISERVER.md): 'write' is
//     auto-approved only when settings.autoApproveEdits is on;
//     'command' only in fullAccess permission mode; MCP tools and
//     deletions auto-deny after a 30s expiry; abort denies everything.
//   • node:http + node:crypto only — zero new dependencies.
//   • Never crashes the app: every handler is wrapped; listen
//     errors (EADDRINUSE) are reported through ApiServerStatus.
// ============================================================
import * as http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { realpath, stat } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { app, safeStorage } from 'electron';
import { runAgent, enqueueUserMessage, type AgentIO } from '../agent/engine';
import * as sessions from './sessionService';
import { getSettings, saveSettings } from './storeService';
import { decideApproval, ruleDecision, ruleKeyFor, type ApprovalPolicyAction } from './approvalPolicyService';
import { aiComplete } from './aiService';
import type {
  AgentEvent,
  AgentRunParams,
  ApprovalKind,
  AppSettings,
  ChatMessage,
  ModelConfig,
  PermissionDecision,
  SessionData,
  TodoItem,
} from '../../shared/types';

// ---------- public contract (orchestrator wires these) ----------

export interface ApiServerStatus {
  running: boolean;
  port: number;
  /**
   * SECURITY: the raw token is only exposed while the apiServer is
   * ENABLED (the renderer needs it to show/copy credentials for scripts).
   * When disabled, callers must rely on `tokenMasked`.
   */
  token?: string;
  /** Always-present, display-safe form: first 4 chars + ellipsis. */
  tokenMasked: string;
  baseUrl: string;
  error?: string;
  startedAt?: number;
  requests: number;
}

// ---------- constants ----------

const DEFAULT_PORT = 47777;
const MIN_PORT = 1024;
const MAX_PORT = 65535;
const BODY_LIMIT = 2 * 1024 * 1024; // 2MB JSON body cap
const MAX_EVENTS_PER_RUN = 500; // per-run SSE replay buffer (ring)
const MAX_RUN_HISTORY = 20; // runs kept for replay
const HEADLESS_DENY_TIMEOUT_MS = 30_000; // mcp/delete approvals auto-expire → null (deny)
const SSE_HEARTBEAT_MS = 15_000;
const VERSION = process.env.npm_package_version || '1.1.0';
// v11.31 — request/rate-limit discipline (all sliding-window, in-process):
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 120; // global cap on ALL non-preflight requests
const MAX_FAILED_AUTH_PER_IP = 10; // then the IP is blocked for IP_BLOCK_MS
const IP_BLOCK_MS = 60_000;
const MAX_FAILED_AUTH_TRACKED = 256; // bounded memory under distributed spoofing

// ---------- state ----------

let server: http.Server | null = null;
let startedAt: number | undefined;
let requests = 0;
let lastError: string | undefined;
let heartbeat: NodeJS.Timeout | null = null;
let quitHooked = false;

interface PendingDecision {
  resolve: (d: PermissionDecision | null) => void;
  timer: NodeJS.Timeout;
}

interface ApprovalRequestInfo {
  kind: ApprovalKind;
  subject: string;
}

interface RunRecord {
  id: string;
  sessionId: string;
  title: string;
  workspace: string;
  modelLabel: string;
  startedAt: number;
  endedAt?: number;
  events: AgentEvent[]; // capped ring — most recent MAX_EVENTS_PER_RUN
  truncated: boolean;
  done: boolean;
  aborted: boolean;
  subscribers: Set<ServerResponse>; // live SSE clients
  /** v11.7 — in-process listeners (SADEEM Remote mirrors these events). */
  listeners: Set<(ev: AgentEvent) => void>;
  decisions: Map<string, PendingDecision>;
  kinds: Map<string, ApprovalKind>; // requestId → approval kind (captured from approval_request)
  /** requestId → the subject/command the policy rule key is derived from. */
  requests: Map<string, ApprovalRequestInfo>;
  controller: AbortController;
  messages: ChatMessage[]; // transcript accumulated for session persistence
  todos: TodoItem[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

const runs = new Map<string, RunRecord>(); // insertion order = history (newest last)
let activeRunId: string | null = null;

// Failed-auth timestamps (module scope) — powers the brute-force throttle.
const failedAuths: number[] = [];
/** v11.31 — per-socket failed-auth tracking + temporary ban. */
const failedAuthByIp = new Map<string, { times: number[]; blockedUntil: number }>();
/** v11.31 — sliding window of all non-preflight requests. */
const requestTimes: number[] = [];

// ---------- small helpers ----------

function clampPort(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_PORT;
  return Math.min(MAX_PORT, Math.max(MIN_PORT, n));
}

// ---------- v2.2 token encryption (safeStorage enc:/plain: convention) ----------
// The storeService encrypt/decrypt helpers are private, so we replicate the
// SAME on-disk convention here: `enc:<base64(safeStorage)>` when the OS
// keystore is available, `plain:<token>` when it is not (never silently raw).
// A legacy PLAINTEXT token (no prefix) is migrated to `enc:`/`plain:` on the
// first read after this version.
const TOKEN_ENC_PREFIX = 'enc:';
const TOKEN_PLAIN_PREFIX = 'plain:';

function encryptToken(raw: string): string {
  if (!raw) return '';
  if (raw.startsWith(TOKEN_ENC_PREFIX) || raw.startsWith(TOKEN_PLAIN_PREFIX)) return raw;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return TOKEN_ENC_PREFIX + safeStorage.encryptString(raw).toString('base64');
    }
  } catch {
    /* fall through to the marked-plaintext fallback */
  }
  return TOKEN_PLAIN_PREFIX + raw;
}

function decryptToken(stored: string): string {
  if (!stored) return '';
  if (stored.startsWith(TOKEN_PLAIN_PREFIX)) return stored.slice(TOKEN_PLAIN_PREFIX.length);
  if (stored.startsWith(TOKEN_ENC_PREFIX)) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(TOKEN_ENC_PREFIX.length), 'base64'));
    } catch {
      // Corrupted ciphertext (keystore reset / cross-machine copy) — treat the
      // token as missing; persistCfg generates a fresh one on next write.
      console.warn('[surnia-api] stored API token could not be decrypted — regenerating');
      return '';
    }
  }
  // Legacy PLAINTEXT token (pre-v2.2): pass through AS-IS so auth keeps
  // working; persistCfg re-encrypts it on the first persist (migration).
  return stored;
}

function apiCfg(): { enabled: boolean; port: number; token: string } {
  try {
    const raw = getSettings().apiServer ?? {};
    return {
      enabled: raw.enabled === true,
      port: clampPort(raw.port ?? DEFAULT_PORT),
      token: decryptToken(typeof raw.token === 'string' ? raw.token : ''),
    };
  } catch {
    return { enabled: false, port: DEFAULT_PORT, token: '' };
  }
}

/** Persist an apiServer config patch. Generates + persists a token on first use. */
function persistCfg(patch: { enabled?: boolean; port?: number; token?: string }): void {
  try {
    const s = getSettings();
    const next: NonNullable<AppSettings['apiServer']> = { ...(s.apiServer ?? {}) };
    // Work with the RAW token in memory; encrypt only at the storage boundary.
    let rawToken = decryptToken(typeof next.token === 'string' ? next.token : '');
    let changed = false;
    if (patch.enabled !== undefined && next.enabled !== (patch.enabled === true)) {
      next.enabled = patch.enabled === true;
      changed = true;
    }
    if (patch.port !== undefined) {
      const p = clampPort(patch.port);
      if (next.port !== p) {
        next.port = p;
        changed = true;
      }
    }
    if (patch.token !== undefined && typeof patch.token === 'string' && patch.token.trim()) {
      const t = patch.token.trim();
      // v11.38 — never accept a weak caller-supplied token. Fail closed by
      // ignoring it (an existing strong token survives, otherwise a fresh
      // 24-byte one is generated below) instead of running a 1-char gate.
      if (isStrongToken(t)) {
        if (rawToken !== t) {
          rawToken = t;
          changed = true;
        }
      } else {
        console.warn('[surnia-api] rejected too-short API token (need >= 16 chars)');
      }
    }
    if (!rawToken) {
      rawToken = randomBytes(24).toString('base64url');
      changed = true;
    }
    // v2.2 SECURITY: the token is ALWAYS stored via the safeStorage enc:/plain:
    // convention — a legacy plaintext token is re-encrypted here (migration).
    const storedToken = encryptToken(rawToken);
    if (next.token !== storedToken) {
      next.token = storedToken;
      changed = true;
    }
    if (!changed) return;
    s.apiServer = next;
    saveSettings(s);
  } catch (err) {
    console.log('[surnia-api] config persist failed:', err instanceof Error ? err.message : String(err));
  }
}

function mask(token: string): string {
  return token ? `${token.slice(0, 4)}…` : '(none)';
}

/** v11.38 — a caller-supplied token below this length is brute-forceable. */
const MIN_TOKEN_LENGTH = 16;
export function isStrongToken(token: unknown): boolean {
  return typeof token === 'string' && token.trim().length >= MIN_TOKEN_LENGTH;
}

function short(id: string): string {
  return id.slice(0, 8);
}

// ---------- status / lifecycle ----------

function status(): ApiServerStatus {
  const cfg = apiCfg();
  return {
    running: !!server && startedAt !== undefined,
    port: cfg.port,
    // SECURITY: raw token only while the server is enabled (see ApiServerStatus).
    ...(cfg.enabled && cfg.token ? { token: cfg.token } : {}),
    tokenMasked: mask(cfg.token),
    baseUrl: `http://127.0.0.1:${cfg.port}`,
    ...(lastError ? { error: lastError } : {}),
    ...(startedAt ? { startedAt } : {}),
    requests,
  };
}

export async function apiServerStatus(): Promise<ApiServerStatus> {
  persistCfg({}); // lazily generate + persist the token on first read
  return status();
}

function startServer(): Promise<void> {
  if (server) return Promise.resolve();
  const cfg = apiCfg();
  const port = cfg.port;

  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      handle(req, res).catch((err: unknown) => {
        // last-resort guard — the router already catches per-request
        try {
          sendJson(res, 500, { ok: false, error: redactSecrets(msgOf(err)) }, {});
        } catch {
          /* socket gone */
        }
      });
    });

    srv.on('error', (err: NodeJS.ErrnoException) => {
      server = null;
      startedAt = undefined;
      lastError = err.code === 'EADDRINUSE' ? 'port in use' : err.message;
      console.log('[surnia-api] server error:', lastError);
      resolve();
    });

    srv.listen(port, '127.0.0.1', () => {
      server = srv;
      startedAt = Date.now();
      lastError = undefined;
      if (!heartbeat) {
        heartbeat = setInterval(beat, SSE_HEARTBEAT_MS);
      }
      console.log(`[surnia-api] listening on http://127.0.0.1:${port} (token ${mask(cfg.token)})`);
      resolve();
    });
  });
}

function stopServer(): Promise<void> {
  const srv = server;
  if (!srv) return Promise.resolve();
  server = null;
  startedAt = undefined;
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  for (const run of runs.values()) {
    for (const res of [...run.subscribers]) {
      try {
        res.end();
      } catch {
        /* socket gone */
      }
    }
    run.subscribers.clear();
  }
  console.log('[surnia-api] stopped');
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    try {
      srv.close(() => done());
      setTimeout(done, 500).unref(); // never hang shutdown on keep-alive sockets
    } catch {
      done();
    }
  });
}

export async function apiServerConfigure(
  patch: { enabled?: boolean; port?: number; token?: string },
): Promise<ApiServerStatus> {
  try {
    const prev = apiCfg();
    persistCfg(patch ?? {});
    const next = apiCfg();
    const portChanged = prev.port !== next.port;

    if (next.enabled) {
      if (server && portChanged) await stopServer(); // restart on the new port
      if (!server) await startServer();
    } else {
      await stopServer();
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.log('[surnia-api] configure failed:', lastError);
  }
  return status();
}

/** Called once at app whenReady. Starts the server if settings.apiServer.enabled. */
export function initApiServer(): void {
  try {
    if (!quitHooked) {
      quitHooked = true;
      try {
        app.on('will-quit', () => {
          void stopServer();
        });
      } catch {
        /* app unavailable (tests) — ignore */
      }
    }
    const cfg = apiCfg();
    if (!cfg.enabled) {
      console.log('[surnia-api] disabled');
      return;
    }
    persistCfg({}); // ensure a token exists before first request
    void startServer();
  } catch (err) {
    console.log('[surnia-api] init failed:', err instanceof Error ? err.message : String(err));
  }
}

// ---------- HTTP plumbing ----------

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface ReqCtx {
  method: string;
  path: string;
  cors: Record<string, string>;
}

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  // Reflect ONLY loopback origins — never a broader origin, never the token.
  const origin = req.headers.origin;
  if (typeof origin === 'string' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
  }
  return h;
}

function tokenMatches(provided: string): boolean {
  const expected = apiCfg().token;
  if (!expected || !provided) return false;
  try {
    const a = createHash('sha256').update(provided).digest();
    const b = createHash('sha256').update(expected).digest();
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function extractBearer(req: IncomingMessage): string {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && /^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, '').trim();
  }
  return '';
}

/** Standard routes: Authorization Bearer header ONLY — ?token= is rejected. */
function tokenOk(req: IncomingMessage): boolean {
  return tokenMatches(extractBearer(req));
}

/**
 * GET /events (SSE): EventSource cannot set headers, so the ?token= query
 * parameter is additionally accepted HERE ONLY. The loopback Host check has
 * already run for every request before auth is evaluated.
 */
function tokenOkSse(req: IncomingMessage, url: URL): boolean {
  const provided = extractBearer(req) || url.searchParams.get('token') || '';
  return tokenMatches(provided);
}

/**
 * DNS-rebinding defense: every request (no exceptions) must carry a Host
 * header naming OUR loopback endpoint — 127.0.0.1:<port> or localhost:<port>.
 * A rebound hostname (attacker.evil.com → 127.0.0.1) fails this check.
 *
 * v11.38 — hardened to a strict, pure, testable predicate. Node may hand us a
 * comma-joined duplicate Host, userinfo (`127.0.0.1:port@evil`), a trailing dot
 * (`localhost.:port`) or an IPv6 bracket form; ALL of those are refused rather
 * than being normalized into an apparent loopback match.
 */
export function isAllowedHost(input: unknown, port: number): boolean {
  if (typeof input !== 'string') return false;
  const h = input.trim().toLowerCase();
  if (!h || /[\s,@\[\]]/.test(h)) return false;
  // Reject trailing-dot hostnames and anything with more than one colon.
  if (h.endsWith('.')) return false;
  if ((h.match(/:/g) ?? []).length !== 1) return false;
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}

function hostOk(req: IncomingMessage): boolean {
  return isAllowedHost(req.headers.host, apiCfg().port);
}

// ---------- failed-auth throttle ----------

function pruneFailedAuths(now = Date.now()): void {
  while (failedAuths.length && now - failedAuths[0] > RATE_WINDOW_MS) failedAuths.shift();
}

function clientIp(req: IncomingMessage): string {
  // IPv4-mapped IPv6 addresses collapse to the same bucket.
  return String(req.socket?.remoteAddress ?? 'unknown').replace(/^::ffff:/, '').slice(0, 64);
}

function noteFailedAuth(req: IncomingMessage): void {
  const now = Date.now();
  failedAuths.push(now);
  pruneFailedAuths(now);
  const ip = clientIp(req);
  let rec = failedAuthByIp.get(ip);
  if (!rec) {
    if (failedAuthByIp.size >= MAX_FAILED_AUTH_TRACKED) {
      // Bounded memory — evict the oldest/least-recently-blocked entry.
      const oldest = failedAuthByIp.keys().next().value;
      if (oldest) failedAuthByIp.delete(oldest);
    }
    rec = { times: [], blockedUntil: 0 };
    failedAuthByIp.set(ip, rec);
  }
  rec.times = rec.times.filter((t) => now - t <= RATE_WINDOW_MS);
  rec.times.push(now);
  if (rec.times.length >= MAX_FAILED_AUTH_PER_IP && rec.blockedUntil <= now) {
    rec.blockedUntil = now + IP_BLOCK_MS;
    console.warn(`[surnia-api] ${MAX_FAILED_AUTH_PER_IP} bad tokens from ${ip} — blocking for 60s`);
  }
}

/** Retry-After (seconds) when this socket is temporarily banned, else null. */
function ipBlockSeconds(req: IncomingMessage, now = Date.now()): number | null {
  const rec = failedAuthByIp.get(clientIp(req));
  if (!rec || rec.blockedUntil <= now) return null;
  return Math.max(1, Math.ceil((rec.blockedUntil - now) / 1000));
}

/**
 * Pure sliding-window predicate (exported for the regression suite): true
 * when `times` holds at least `max` timestamps inside the last 60s.
 */
export function rateLimited(times: readonly number[], max = MAX_REQUESTS_PER_WINDOW, now = Date.now()): boolean {
  return times.filter((t) => now - t <= RATE_WINDOW_MS).length >= max;
}

function noteRequest(): void {
  requestTimes.push(Date.now());
  if (requestTimes.length > MAX_REQUESTS_PER_WINDOW * 2) {
    const cutoff = Date.now() - RATE_WINDOW_MS;
    while (requestTimes.length && requestTimes[0] < cutoff) requestTimes.shift();
  }
}

/** Diagnostic snapshot for the settings/ops surface and tests. */
export function apiRateLimitStatus(): {
  windowMs: number;
  maxRequests: number;
  requestsInWindow: number;
  failedAuths: number;
} {
  const now = Date.now();
  return {
    windowMs: RATE_WINDOW_MS,
    maxRequests: MAX_REQUESTS_PER_WINDOW,
    requestsInWindow: requestTimes.filter((t) => now - t <= RATE_WINDOW_MS).length,
    failedAuths: failedAuths.length,
  };
}

/** ≥10 bad tokens from one IP → stall 750ms and escalate; 20 → 1500ms. */
async function authThrottleDelay(req: IncomingMessage): Promise<void> {
  pruneFailedAuths();
  const ip = clientIp(req);
  const n = failedAuthByIp.get(ip)?.times.length ?? failedAuths.length;
  if (n >= 20) {
    console.warn(`[surnia-api] ${n} failed auth attempts from ${ip} — throttling 1500ms`);
    await new Promise((r) => setTimeout(r, 1500));
  } else if (n >= MAX_FAILED_AUTH_PER_IP) {
    console.warn(`[surnia-api] ${n} failed auth attempts from ${ip} — throttling 750ms`);
    await new Promise((r) => setTimeout(r, 750));
  }
}

function sendJson(res: ServerResponse, code: number, payload: unknown, cors: Record<string, string>): void {
  if (res.headersSent || res.writableEnded) {
    try {
      res.end();
    } catch {
      /* socket gone */
    }
    return;
  }
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...cors,
  });
  res.end(body);
}

function respond(res: ServerResponse, ctx: ReqCtx, code: number, payload: unknown): void {
  console.log(`[surnia-api] ${ctx.method} ${ctx.path} → ${code}`);
  sendJson(res, code, payload, ctx.cors);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > BODY_LIMIT) {
        reject(new HttpError(413, 'payload too large (2MB limit)'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => reject(err));
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function msgOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------- v11.31 — token/secret redaction (never echo credentials) ----------

/** Redact the live API token and common provider-key shapes from any text. */
export function redactSecrets(text: string): string {
  let out = String(text ?? '');
  try {
    const token = apiCfg().token;
    if (token && token.length >= 4) out = out.split(token).join(`…${token.slice(-4)}`);
  } catch {
    /* config unavailable — pattern redaction still applies */
  }
  out = out.replace(/\bsk-[A-Za-z0-9_-]{6,}/g, (m) => `sk-…${m.slice(-4)}`);
  out = out.replace(/AIza[A-Za-z0-9_-]{10,}/g, (m) => `AIza…${m.slice(-4)}`);
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]{6,}/gi, 'Bearer «redacted»');
  // v11.38 — widen the net to the other credential shapes the app actually
  // handles. Format-compatible with electron/agent/risk.ts::redactSecrets:
  // a secret must never reach an HTTP error body, a console line or a log.
  out = out.replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{12,}\b/g, '«redacted»');
  out = out.replace(/\bglpat-[A-Za-z0-9_-]{12,}\b/g, '«redacted»');
  out = out.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '«redacted»');
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, '«redacted»');
  out = out.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '«redacted-private-key»');
  out = out.replace(
    /\b((?:api[-_]?key|apikey|access[-_]?token|auth[-_]?token|client[-_]?secret|passwd|password|pwd|secret|token)["']?\s*[:=]\s*)(["']?)[A-Za-z0-9._~+/=-]{6,}\2/gi,
    '$1«redacted»',
  );
  out = out.replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^\s/:@]+):([^\s/@]+)@/gi, '$1$2:«redacted»@');
  return out;
}

// ---------- v11.31 — workspace path jail ----------

/**
 * Resolve a caller-supplied workspace inside an allowed root. Roots are the
 * user's recent paths + cwd + home: an arbitrary remote directory (or UNC /
 * traversal / symlink escape) is refused before any agent run is created.
 */
export function assertJailedWorkspace(input: unknown, s: AppSettings = getSettings()): string {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw || /[\0\r\n]/.test(raw)) throw new HttpError(400, 'workspace path is required');
  if (raw.startsWith('\\\\') || raw.startsWith('//')) throw new HttpError(400, 'UNC paths are not allowed');
  // v11.38 — refuse ambiguous path grammars before resolution. A URL scheme,
  // a Windows drive-RELATIVE path (`C:foo`) and any `..` segment are never a
  // legitimate workspace argument, even when the resolved result would happen
  // to land back inside a root. Error text keeps the historical phrase so the
  // existing regression suite stays valid.
  const OUTSIDE = 'workspace is outside the allowed roots';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) throw new HttpError(400, OUTSIDE);
  if (/^[a-zA-Z]:[^\\/]/.test(raw)) throw new HttpError(400, OUTSIDE);
  if (raw.split(/[\\/]/).includes('..')) throw new HttpError(400, `${OUTSIDE} (path traversal)`);
  const resolved = path.resolve(raw);
  const canon = (p: string): string => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  const roots = [...(s.recentPaths ?? []), process.cwd(), os.homedir()]
    .filter((p): p is string => typeof p === 'string' && !!p.trim())
    .map((p) => canon(p));
  const target = canon(resolved);
  const inside = roots.some((root) => target === root || target.startsWith(root + path.sep));
  if (!inside) throw new HttpError(400, OUTSIDE);
  return resolved;
}

/** Re-check the REAL path after symlink resolution (defense against escapes). */
export async function assertRealWorkspaceJailed(resolved: string, s: AppSettings = getSettings()): Promise<void> {
  const real = await realpath(resolved); // throws if missing → honest 400
  const canon = (p: string): string => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  const roots = [...(s.recentPaths ?? []), process.cwd(), os.homedir()]
    .filter((p): p is string => typeof p === 'string' && !!p.trim())
    .map((p) => canon(p));
  const target = canon(real);
  if (!roots.some((root) => target === root || target.startsWith(root + path.sep))) {
    throw new HttpError(400, 'workspace symlink escapes the allowed roots');
  }
}

// ---------- router ----------

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const method = (req.method ?? 'GET').toUpperCase();
  const ctx: ReqCtx = { method, path: url.pathname, cors: corsHeaders(req) };

  // SECURITY gate 1 — DNS-rebinding defense: loopback Host header on EVERY
  // request, preflights included. Nothing below runs without it.
  if (!hostOk(req)) {
    res.writeHead(403, ctx.cors);
    res.end(JSON.stringify({ ok: false, error: 'forbidden host' }));
    return;
  }

  // Preflights are never counted.
  if (method === 'OPTIONS') {
    res.writeHead(204, ctx.cors);
    res.end();
    return;
  }

  // v11.31 — CSRF/origin check on every state-changing method. A browser page
  // from any non-loopback origin cannot drive the local control plane even if
  // it somehow obtains a token via the network.
  // v11.38 — also honor the browser-supplied Fetch Metadata header: a
  // cross-site navigation/fetch is refused even when the Origin header was
  // stripped by a proxy. Same-site loopback (dev server → API) stays allowed.
  const origin = req.headers.origin;
  const fetchSite = req.headers['sec-fetch-site'];
  // NOTE: 'same-site' is deliberately ALLOWED — a loopback dev page on another
  // port (localhost:5173 → localhost:47777) is same-site and is a supported
  // local caller. Only a genuinely foreign site is refused.
  const crossSite = typeof fetchSite === 'string' && /^cross-site$/i.test(fetchSite);
  if (
    crossSite ||
    (method !== 'GET' && typeof origin === 'string' && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin))
  ) {
    res.writeHead(403, ctx.cors);
    res.end(JSON.stringify({ ok: false, error: 'forbidden origin' }));
    return;
  }

  requests++; // count everything else — 401s and 404s included
  noteRequest();

  // v11.31 — global sliding-window cap (brute-force / runaway-script brake).
  if (rateLimited(requestTimes)) {
    res.writeHead(429, { ...ctx.cors, 'Retry-After': '60' });
    res.end(JSON.stringify({ ok: false, error: 'too many requests — retry in 60s' }));
    return;
  }
  // v11.31 — per-IP auth ban (returned BEFORE token evaluation).
  const blocked = ipBlockSeconds(req);
  if (blocked !== null) {
    res.writeHead(429, { ...ctx.cors, 'Retry-After': String(blocked) });
    res.end(JSON.stringify({ ok: false, error: 'too many failed authentications' }));
    return;
  }

  try {
    // SECURITY gate 2 — token auth. Bearer header only, EXCEPT the SSE
    // endpoint where the ?token= fallback exists for EventSource.
    const isSse = method === 'GET' && url.pathname === '/events';
    const authed = isSse ? tokenOkSse(req, url) : tokenOk(req);
    if (!authed) {
      noteFailedAuth(req);
      await authThrottleDelay(req);
      respond(res, ctx, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    // ---------- GET /health ----------
    if (method === 'GET' && url.pathname === '/health') {
      let workspace: string | null = null;
      try {
        workspace = getSettings().recentPaths?.[0] ?? null;
      } catch {
        workspace = null;
      }
      respond(res, ctx, 200, {
        ok: true,
        name: 'surnia',
        version: VERSION,
        uptimeSec: startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0,
        workspace,
        requests,
      });
      return;
    }

    // ---------- GET /models ----------
    if (method === 'GET' && url.pathname === '/models') {
      respond(res, ctx, 200, { ok: true, ...modelList() });
      return;
    }

    // ---------- GET /sessions ----------
    if (method === 'GET' && url.pathname === '/sessions') {
      const list = await sessions.list();
      respond(res, ctx, 200, { ok: true, sessions: list });
      return;
    }

    // ---------- POST /sessions ----------
    if (method === 'POST' && url.pathname === '/sessions') {
      const body = await readJson(req);
      const s = getSettings();
      const now = Date.now();
      const title =
        typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'API session';
      const meta = await sessions.save({
        id: randomUUID(),
        title,
        createdAt: now,
        updatedAt: now,
        workspace: s.recentPaths?.[0],
        model: `${s.model.provider}/${s.model.model}`,
        messageCount: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        messages: [],
        todos: [],
      });
      respond(res, ctx, 200, { ok: true, session: meta });
      return;
    }

    // ---------- GET /sessions/:id/export (markdown transcript) ----------
    if (method === 'GET' && /^\/sessions\/[^/]+\/export$/.test(url.pathname)) {
      const id = decodeURIComponent(
        url.pathname.slice('/sessions/'.length, url.pathname.length - '/export'.length),
      );
      const r = await sessions.exportSessionMarkdown(id);
      if (!r.ok) {
        respond(res, ctx, 404, { ok: false, error: r.error ?? 'session not found' });
        return;
      }
      respond(res, ctx, 200, { ok: true, path: r.path, markdown: r.markdown });
      return;
    }

    // ---------- POST /channel/:sessionId (queue a user message into a live session) ----------
    if (method === 'POST' && url.pathname.startsWith('/channel/')) {
      const sessionId = decodeURIComponent(url.pathname.slice('/channel/'.length)).trim();
      if (!sessionId) {
        respond(res, ctx, 400, { ok: false, error: 'sessionId is required' });
        return;
      }
      const body = await readJson(req);
      const text = typeof body.text === 'string' ? body.text : '';
      if (!text.trim()) {
        respond(res, ctx, 400, { ok: false, error: 'text is required' });
        return;
      }
      const n = enqueueUserMessage(sessionId, text);
      respond(res, ctx, 200, { ok: true, n });
      return;
    }

    // ---------- POST /run ----------
    if (method === 'POST' && url.pathname === '/run') {
      const active = activeRunId ? runs.get(activeRunId) : undefined;
      if (active && !active.done) {
        respond(res, ctx, 409, { ok: false, error: 'run in progress', runId: active.id });
        return;
      }
      const body = await readJson(req);
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (!prompt) {
        respond(res, ctx, 400, { ok: false, error: 'prompt is required' });
        return;
      }
      if (body.workspace !== undefined && typeof body.workspace !== 'string') {
        respond(res, ctx, 400, { ok: false, error: 'workspace must be a string' });
        return;
      }
      // SECURITY: the workspace is an arbitrary caller-supplied path —
      // jail it to the user's known roots AND verify it exists / is a dir.
      if (typeof body.workspace === 'string' && body.workspace.trim()) {
        try {
          const jailed = assertJailedWorkspace(body.workspace, getSettings());
          await assertRealWorkspaceJailed(jailed, getSettings());
          const wsStat = await stat(jailed);
          if (!wsStat.isDirectory()) {
            respond(res, ctx, 400, { ok: false, error: 'workspace must be a directory' });
            return;
          }
        } catch (err) {
          const code = err instanceof HttpError ? err.status : 400;
          respond(res, ctx, code, { ok: false, error: redactSecrets(msgOf(err)) });
          return;
        }
      }
      const started = startApiRun(prompt, body.workspace);
      respond(res, ctx, 200, { ok: true, runId: started.runId, sessionId: started.sessionId });
      return;
    }

    // ---------- POST /abort ----------
    if (method === 'POST' && url.pathname === '/abort') {
      const body = await readJson(req);
      const runId =
        typeof body.runId === 'string' && body.runId ? body.runId : activeRunId;
      if (!runId) {
        respond(res, ctx, 404, { ok: false, error: 'no active run' });
        return;
      }
      const run = runs.get(runId);
      if (!run) {
        respond(res, ctx, 404, { ok: false, error: 'unknown runId' });
        return;
      }
      if (run.done) {
        respond(res, ctx, 200, { ok: true, runId, aborted: false, done: true });
        return;
      }
      abortRun(run);
      respond(res, ctx, 200, { ok: true, runId, aborted: true });
      return;
    }

    // ---------- GET /events (SSE) ----------
    if (method === 'GET' && url.pathname === '/events') {
      handleEvents(req, res, url, ctx);
      return;
    }

    // ---------- POST /ai ----------
    if (method === 'POST' && url.pathname === '/ai') {
      const body = await readJson(req);
      const prompt = typeof body.prompt === 'string' ? body.prompt : '';
      if (!prompt.trim()) {
        respond(res, ctx, 400, { ok: false, error: 'prompt is required' });
        return;
      }
      const r = await aiComplete({
        prompt,
        system: typeof body.system === 'string' ? body.system : undefined,
        maxTokens: num(body.maxTokens),
        temperature: num(body.temperature),
      });
      respond(res, ctx, 200, r.ok ? { ok: true, text: r.text ?? '' } : { ok: false, error: r.error ?? 'ai failed' });
      return;
    }

    respond(res, ctx, 404, { ok: false, error: 'not found' });
  } catch (err) {
    const code = err instanceof HttpError ? err.status : 500;
    const detail = redactSecrets(msgOf(err));
    console.warn(`[surnia-api] ${ctx.method} ${ctx.path} → ${code}: ${detail}`);
    respond(res, ctx, code, { ok: false, error: detail });
  }
}

// ---------- models (static, from settings — no network calls) ----------

function modelList(): { active: ModelConfig; models: string[]; byProvider: Record<string, string[]> } {
  const s = getSettings();
  const byProvider: Record<string, string[]> = {};
  for (const [id, entry] of Object.entries(s.providers ?? {})) {
    byProvider[id] = Array.isArray(entry?.lastModels) ? entry.lastModels.slice(0, 200) : [];
  }
  const active = s.model;
  const models: string[] = [];
  const push = (m?: string) => {
    if (m && !models.includes(m)) models.push(m);
  };
  push(active?.model);
  for (const m of byProvider[active?.provider] ?? []) push(m);
  for (const list of Object.values(byProvider)) for (const m of list) push(m);
  return { active, models, byProvider };
}

// ---------- agent runs ----------

function startApiRun(prompt: string, workspaceArg?: string): { runId: string; sessionId: string } {
  const s = getSettings();
  const ws =
    workspaceArg && workspaceArg.trim()
      ? workspaceArg.trim()
      : s.recentPaths?.[0] ?? process.cwd();
  const sessionId = randomUUID();
  const now = Date.now();
  const userMsg: ChatMessage = {
    id: randomUUID(),
    role: 'user',
    kind: 'text',
    content: prompt,
    timestamp: now,
  };
  const title = prompt.slice(0, 48) + (prompt.length > 48 ? '…' : '');

  const run: RunRecord = {
    id: randomUUID(),
    sessionId,
    title,
    workspace: ws,
    modelLabel: `${s.model.provider}/${s.model.model}`,
    startedAt: now,
    events: [],
    truncated: false,
    done: false,
    aborted: false,
    subscribers: new Set(),
    listeners: new Set(),
    decisions: new Map(),
    kinds: new Map(),
    requests: new Map(),
    controller: new AbortController(),
    messages: [userMsg],
    todos: [],
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };

  runs.set(run.id, run);
  // history ring: evict the oldest FINISHED runs beyond the cap (never a live one)
  while (runs.size > MAX_RUN_HISTORY) {
    const oldestKey = runs.keys().next().value;
    if (!oldestKey || oldestKey === run.id) break;
    const oldest = runs.get(oldestKey);
    if (oldest && !oldest.done) break;
    runs.delete(oldestKey);
  }
  activeRunId = run.id;

  // Persist the initial transcript immediately so the run is visible in /sessions.
  const initial: SessionData = {
    id: sessionId,
    title,
    createdAt: now,
    updatedAt: now,
    workspace: ws,
    model: run.modelLabel,
    messageCount: 1,
    totalTokens: 0,
    totalCostUsd: 0,
    messages: [userMsg],
    todos: [],
  };
  void sessions.save(initial).catch((err: unknown) => {
    console.warn('[surnia-api] initial transcript save failed:', redactSecrets(msgOf(err)));
  });

  const params: AgentRunParams = {
    task: 'chat',
    sessionId,
    messages: [userMsg],
    model: s.model,
    mode: s.permissionMode,
    workspace: ws,
    memory: s.memory,
    mcpServers: (s.mcpServers ?? []).filter((m) => m && m.enabled),
  };
  // Credential injection — same as agent/register.ts: the main process owns
  // settings.json and attaches decrypted provider credentials to every run.
  try {
    params.providers = s.providers;
  } catch {
    /* engine falls back to env keys */
  }

  console.log(`[surnia-api] run ${short(run.id)} started (prompt ${prompt.length} chars, workspace ${ws})`);
  const io = makeIO(run);
  void runAgent(params, io)
    .catch((err: unknown) => {
      // runAgent handles its own errors; this is a last-resort guard.
      pushEvent(run, { type: 'error', message: err instanceof Error ? err.message : String(err) });
      pushEvent(run, { type: 'turn_end' });
    })
    .finally(() => finishRun(run));

  return { runId: run.id, sessionId };
}

/**
 * Headless AgentIO adapter (mirrors agent/register.ts):
 *  • send(event)     → append to the run's event buffer + fan out to SSE clients
 *  • getDecision(id) → headless approval policy (see docs/APISERVER.md):
 *      kind 'write' | 'command' → auto-approve immediately
 *      kind 'mcp' | 'delete'    → expire after 30s → resolve null → engine denies
 *  • isAborted()     → per-run flag set by POST /abort
 *  • onFetchSignal() → hands the per-run AbortSignal to the engine (same pattern
 *                      as register.ts; engine mirrors it onto its fetches)
 */
function makeIO(run: RunRecord): AgentIO {
  return {
    send: (event: AgentEvent): void => {
      try {
        if (event.type === 'approval_request') {
          run.kinds.set(event.requestId, event.kind);
          const payload = (event.payload ?? {}) as { command?: unknown; toolName?: unknown };
          const subject =
            event.kind === 'command'
              ? String(payload.command ?? event.detail ?? event.title ?? '')
              : event.kind === 'mcp'
                ? String(payload.toolName ?? event.title ?? '')
                : String(event.title ?? '');
          run.requests.set(event.requestId, { kind: event.kind, subject: subject.slice(0, 300) });
        }
        pushEvent(run, event);
        ingestTranscript(run, event);
      } catch (err) {
        console.warn('[surnia-api] event fanout failed:', redactSecrets(msgOf(err)));
      }
    },
    getDecision: (requestId: string): Promise<PermissionDecision | null> =>
      new Promise<PermissionDecision | null>((resolve) => {
        const kind = run.kinds.get(requestId);
        // v11.31 — PERSISTED POLICY FIRST (no silent bypass). A standing deny
        // always wins; a standing allow honors explicit earlier consent.
        // Both are evaluated before any settings-driven auto-approval.
        const info = run.requests.get(requestId);
        const ruleKey = info ? ruleKeyFor(info.kind, info.subject) : (kind ?? 'unknown');
        try {
          const policy = ruleDecision(run.workspace, ruleKey);
          if (policy === 'deny') {
            console.warn(`[surnia-api] run ${short(run.id)} standing DENY blocks ${ruleKey.slice(0, 48)}`);
            resolve(null); // engine denies — no auto-approve may override this
            return;
          }
          if (policy === 'allow') {
            console.log(`[surnia-api] run ${short(run.id)} standing ALLOW for ${ruleKey.slice(0, 48)}`);
            resolve({ requestId, action: 'allow' });
            return;
          }
        } catch (err) {
          console.warn('[surnia-api] approval policy read failed — failing closed:', redactSecrets(msgOf(err)));
          resolve(null);
          return;
        }
        // Headless policy (tightened):
        //   'write'   → auto-approve only when the user enabled
        //               auto-approve-edits (AppSettings.autoApproveEdits).
        //   'command' → auto-approve only in fullAccess permission mode.
        //   'mcp' | 'delete' (and any of the above without their setting) →
        //               expire after 30s → null → engine denies.
        let auto = false;
        try {
          const s = getSettings();
          if (kind === 'write') auto = s.autoApproveEdits === true;
          else if (kind === 'command') auto = s.permissionMode === 'fullAccess';
        } catch {
          auto = false; // settings unavailable → fail closed
        }
        if (auto) {
          console.log(`[surnia-api] run ${short(run.id)} auto-approved ${kind ?? 'unknown'} (${short(requestId)})`);
          resolve({ requestId, action: 'allow' });
          return;
        }
        const timer = setTimeout(() => {
          run.decisions.delete(requestId);
          console.log(
            `[surnia-api] run ${short(run.id)} approval expired → deny (${short(requestId)}, kind ${kind ?? 'unknown'})`,
          );
          resolve(null); // engine treats null as deny
        }, HEADLESS_DENY_TIMEOUT_MS);
        run.decisions.set(requestId, { resolve, timer });
      }),
    isAborted: (): boolean => run.aborted,
    onFetchSignal: (cb: (signal: AbortSignal) => void): void => {
      try {
        cb(run.controller.signal);
      } catch {
        /* ignore */
      }
    },
  };
}

function resolveAll(run: RunRecord, decision: PermissionDecision | null): void {
  for (const [id, p] of [...run.decisions]) {
    clearTimeout(p.timer);
    run.decisions.delete(id);
    try {
      p.resolve(decision);
    } catch {
      /* ignore */
    }
  }
}

function abortRun(run: RunRecord): void {
  if (run.aborted || run.done) return;
  run.aborted = true;
  try {
    run.controller.abort();
  } catch {
    /* ignore */
  }
  resolveAll(run, null); // pending approvals → null → engine denies
  console.log(`[surnia-api] run ${short(run.id)} abort requested`);
}

function finishRun(run: RunRecord): void {
  if (run.done) return;
  run.done = true;
  run.endedAt = Date.now();
  if (activeRunId === run.id) activeRunId = null;
  resolveAll(run, null);
  const doneFrame = sseFrame('done', { ok: true, runId: run.id });
  for (const res of [...run.subscribers]) {
    try {
      res.write(doneFrame);
      res.end();
    } catch {
      /* socket gone */
    }
    run.subscribers.delete(res);
  }
  console.log(
    `[surnia-api] run ${short(run.id)} finished in ${((run.endedAt - run.startedAt) / 1000).toFixed(1)}s ` +
      `(${run.events.length} events${run.truncated ? ', buffer truncated' : ''})`,
  );
  void persistTranscript(run);
}

async function persistTranscript(run: RunRecord): Promise<void> {
  try {
    await sessions.save({
      id: run.sessionId,
      title: run.title,
      createdAt: run.startedAt,
      updatedAt: Date.now(),
      workspace: run.workspace,
      model: run.modelLabel,
      messageCount: run.messages.length,
      totalTokens: run.usage.inputTokens + run.usage.outputTokens,
      totalCostUsd: run.usage.costUsd,
      messages: run.messages,
      todos: run.todos,
    });
  } catch (err) {
    console.warn('[surnia-api] transcript save failed:', redactSecrets(msgOf(err)));
  }
}

// ---------- event buffer + SSE ----------

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function pushEvent(run: RunRecord, event: AgentEvent): void {
  if (run.events.length >= MAX_EVENTS_PER_RUN) {
    run.events.shift(); // drop the oldest — the buffer keeps the most recent 500
    run.truncated = true;
  }
  run.events.push(event);
  // v11.7 — in-process listeners (SADEEM Remote) see the same stream.
  for (const cb of [...run.listeners]) {
    try {
      cb(event);
    } catch {
      run.listeners.delete(cb);
    }
  }
  const frame = sseFrame(event.type, event);
  for (const res of [...run.subscribers]) {
    try {
      res.write(frame);
    } catch {
      run.subscribers.delete(res);
    }
  }
}

function beat(): void {
  for (const run of runs.values()) {
    for (const res of [...run.subscribers]) {
      try {
        res.write(': ping\n\n');
      } catch {
        run.subscribers.delete(res);
      }
    }
  }
}

function handleEvents(req: IncomingMessage, res: ServerResponse, url: URL, ctx: ReqCtx): void {
  const runId = url.searchParams.get('runId');
  const run = runId ? runs.get(runId) : [...runs.values()].pop(); // default: most recent run

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...ctx.cors,
  });
  try {
    req.socket.setKeepAlive(true, 30_000);
  } catch {
    /* socket gone */
  }
  res.write('retry: 3000\n\n');

  if (!run) {
    res.write(sseFrame('done', { ok: true, runId: runId ?? null }));
    res.end();
    return;
  }

  console.log(
    `[surnia-api] SSE attach → run ${short(run.id)} (replay ${run.events.length} events, done=${run.done})`,
  );
  for (const e of run.events) res.write(sseFrame(e.type, e));
  if (run.truncated) {
    res.write(
      sseFrame('notice', {
        ok: true,
        note: `event buffer capped at ${MAX_EVENTS_PER_RUN} — earliest events were dropped`,
      }),
    );
  }
  if (run.done) {
    res.write(sseFrame('done', { ok: true, runId: run.id }));
    res.end();
    return;
  }
  run.subscribers.add(res);
  req.on('close', () => {
    run.subscribers.delete(res);
  });
}

// ---------- transcript ingestion (mirrors the renderer's ingestAgentEvent) ----------

function ingestTranscript(run: RunRecord, e: AgentEvent): void {
  const msgs = run.messages;
  switch (e.type) {
    case 'text_delta': {
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant' && last.kind === 'text' && last.streaming) {
        last.content += e.text;
      } else {
        msgs.push({
          id: randomUUID(),
          role: 'assistant',
          kind: 'text',
          content: e.text,
          timestamp: Date.now(),
          streaming: true,
        });
      }
      break;
    }
    case 'tool_start': {
      const last = msgs[msgs.length - 1];
      if (last && last.streaming) last.streaming = false;
      msgs.push({
        id: randomUUID(),
        role: 'tool',
        kind: 'tool_call',
        toolName: e.name,
        toolCallId: e.toolCallId,
        content: typeof e.args === 'string' ? e.args : JSON.stringify(e.args ?? {}),
        timestamp: Date.now(),
      });
      break;
    }
    case 'tool_result': {
      let idx = -1;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].toolCallId === e.toolCallId && msgs[i].kind === 'tool_call') {
          idx = i;
          break;
        }
      }
      msgs.push({
        id: randomUUID(),
        role: 'tool',
        kind: 'tool_result',
        toolCallId: e.toolCallId,
        toolName: idx >= 0 ? msgs[idx].toolName : undefined,
        content: e.output,
        resultOk: e.ok,
        timestamp: Date.now(),
      });
      break;
    }
    case 'message_end': {
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant' && last.streaming) {
        last.streaming = false;
        if (e.usage) last.usage = e.usage;
      }
      if (e.usage) {
        run.usage.inputTokens += e.usage.inputTokens;
        run.usage.outputTokens += e.usage.outputTokens;
        run.usage.costUsd += e.usage.costUsd;
      }
      break;
    }
    case 'todo':
      run.todos = e.todos;
      break;
    case 'error': {
      const last = msgs[msgs.length - 1];
      if (last && last.streaming) last.streaming = false;
      msgs.push({
        id: randomUUID(),
        role: 'assistant',
        kind: 'text',
        content: e.message,
        model: 'error',
        timestamp: Date.now(),
      });
      break;
    }
    case 'aborted':
    case 'turn_end': {
      const last = msgs[msgs.length - 1];
      if (last && last.streaming) last.streaming = false;
      break;
    }
    default:
      break;
  }
}


// ============================================================
// v11.7 — SADEEM Remote bridge (in-process access to the run
// pipeline; the phone UI reuses this instead of a second engine).
// ============================================================

/** Start a real programmatic agent run (phone "start a task" path). */
export function apiStartRun(prompt: string, workspace?: string): { runId: string; sessionId: string } {
  return startApiRun(prompt, workspace);
}

/** Abort a run (active one when runId omitted). */
export function apiAbortRun(runId?: string): boolean {
  const id = runId ?? activeRunId;
  if (!id) return false;
  const run = runs.get(id);
  if (!run || run.done) return false;
  abortRun(run);
  return true;
}

/** Subscribe to a run's live events (returns an unsubscribe fn). */
export function apiSubscribeRun(runId: string, cb: (ev: AgentEvent) => void): () => void {
  const run = runs.get(runId);
  if (!run) return () => undefined;
  run.listeners.add(cb);
  // replay the recent tail so a late subscriber sees what already happened
  for (const ev of run.events.slice(-80)) {
    try {
      cb(ev);
    } catch {
      /* listener dropped below on the next error */
    }
  }
  return () => run.listeners.delete(cb);
}

/** Resolve a pending approval for the ACTIVE run (phone approve/deny). */
export function apiResolveRunDecision(requestId: string, decision: ApprovalPolicyAction): boolean {
  const run = activeRunId ? runs.get(activeRunId) : undefined;
  if (!run) return false;
  const pending = run.decisions.get(requestId);
  if (!pending) return false;
  const info = run.requests.get(requestId);
  const key = info ? ruleKeyFor(info.kind, info.subject) : '';
  // v11.31 — route through the explicit policy model. Unknown/typoed actions
  // are rejected (no silent "once" fallback), and persistence failures throw
  // instead of reporting a false success.
  const result = decideApproval({
    requestId,
    workspace: run.workspace,
    key,
    command: info?.subject ?? '',
    action: decision,
    actor: 'remote-phone',
  });
  if (!result.ok) {
    console.warn(`[surnia-api] approval rejected: ${result.error}`);
    return false;
  }
  run.decisions.delete(requestId);
  clearTimeout(pending.timer);
  pending.resolve({ requestId, action: result.action });
  return true;
}
