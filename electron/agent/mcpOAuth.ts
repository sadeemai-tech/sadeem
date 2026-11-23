// ============================================================
// Surnia v7.1 — MCP OAUTH: real OAuth2 for remote MCP servers.
// v7.0 could only talk to remote MCP servers that carried a static
// bearer token in their headers. The MCP spec (2025-03-26+) defines
// HTTP servers that REQUIRE OAuth — today those servers are simply
// unreachable. This module implements the full client flow:
//
//   • RFC 8414  — authorization-server metadata discovery at
//                 {server}/.well-known/oauth-authorization-server
//                 (plus the path-suffix form the spec allows).
//   • RFC 7591  — dynamic client registration when the server offers
//                 registration_endpoint (no manual client ids).
//   • PKCE S256 — code_verifier + S256 challenge on the auth code.
//   • Local loopback — a one-shot http server on 127.0.0.1:<ephemeral>
//                 to receive ?code=…; redirect_uri is exactly that.
//   • Tokens    — stored per server id in userData/mcp-oauth.json:
//                 encrypted with Electron safeStorage when it is
//                 available, otherwise a 0600 file. Refreshed on
//                 expiry; access tokens never logged.
//   • `authHeadersFor(serverId)` — the single call mcp.ts makes per
//                 HTTP/SSE request: returns {} or a fresh Bearer.
// ============================================================
import * as http from 'node:http';
import { promises as fs } from 'node:fs';
import * as crypto from 'node:crypto';
import * as path from 'node:path';

// v11.9.0 — the first literal carried a U+200B zero-width space ("/\u200B.well-known/…"),
// which could never match a real URL. The probe paths now live in
// discoverAuthorizationServer() below (canonical + RFC-8414 path-suffix form);
// this constant keeps the canonical path for reference only.
const DISCOVERY_PATHS = ['/.well-known/oauth-authorization-server'];
const HTTP_TIMEOUT_MS = 15_000;
const CALLBACK_TIMEOUT_MS = 5 * 60_000;

// ------------------------------------------------------------
// v11.13.1 SECURITY — outbound URL / SSRF guards.
// The RFC 8414 metadata is published by the MCP server itself, i.e. it is
// attacker-controlled. Nothing from it may reach shell.openExternal (a
// javascript:/file: URL there is XSS -> RCE) or be fetched blindly (SSRF to
// cloud metadata / internal services). These helpers are pure and exported
// so the security test can exercise them directly.
// ------------------------------------------------------------

/** Loopback hosts allowed for native-app OAuth (RFC 8252) and local dev. */
export function isLoopbackHost(host: string): boolean {
  const h = String(host ?? '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  return /^127(?:\.|$)/.test(h);
}

/**
 * True for private / link-local / CGNAT / unspecified addresses that must
 * never be used as a metadata, registration or token endpoint (SSRF).
 * Loopback is deliberately NOT private here — local dev MCP servers need it.
 */
export function isPrivateAddress(host: string): boolean {
  const h = String(host ?? '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10) return true; // "this network" / private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local (cloud metadata)
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false; // includes 127.x loopback (allowed)
  }
  if (isLoopbackHost(h)) return false;
  if (h === '::' || h === '0.0.0.0') return true; // unspecified
  if (/^f[cd]/.test(h)) return true; // IPv6 unique-local
  if (/^fe[89ab]/.test(h)) return true; // IPv6 link-local
  if (/^::ffff:/.test(h)) return isPrivateAddress(h.slice(7)); // IPv4-mapped
  return false;
}

/** Parse + SSRF-check any endpoint URL we are about to fetch. */
export function assertSafeFetchTarget(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('OAuth endpoint URL is not a valid URL');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('Blocked unsafe OAuth endpoint: only http and https URLs are allowed.');
  }
  if (isPrivateAddress(u.hostname)) {
    throw new Error('Blocked unsafe OAuth endpoint: private and link-local network addresses are not allowed.');
  }
  return u;
}

/**
 * The authorization endpoint is handed to shell.openExternal — a real browser
 * navigation. Allow https anywhere, http ONLY on loopback (local dev).
 * javascript:, file:, data:, custom schemes and public http are all rejected.
 */
export function assertSafeExternalUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('OAuth authorization URL is not a valid URL');
  }
  if (u.protocol === 'https:') return u;
  if (u.protocol === 'http:' && isLoopbackHost(u.hostname)) return u;
  throw new Error(
    u.protocol === 'http:'
      ? 'Blocked unsafe OAuth authorization URL: http:// is only allowed on localhost/127.0.0.1.'
      : 'Blocked unsafe OAuth authorization URL: only https:// and http:// (localhost) are allowed.',
  );
}

// ------------------------------------------------------------
// Token store (safeStorage when available)
// ------------------------------------------------------------

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
  scope?: string;
  tokenType?: string;
  /** RFC 7591 client credentials from dynamic registration. */
  clientId?: string;
  clientSecret?: string;
  issuer?: string;
}

interface OAuthStore {
  [serverId: string]: OAuthTokens;
}

let cachedStore: OAuthStore | null = null;

function storeFile(userDataDir: string): string {
  return path.join(userDataDir, 'mcp-oauth.json');
}

function safeStorageAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { safeStorage } = require('electron') as { safeStorage?: { isEncryptionAvailable?: () => boolean } };
    return !!safeStorage?.isEncryptionAvailable?.();
  } catch {
    return false;
  }
}

function encryptToken(plain: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { safeStorage } = require('electron') as { safeStorage: { encryptString: (s: string) => Buffer } };
    return `enc:${safeStorage.encryptString(plain).toString('base64')}`;
  } catch {
    return plain; // 0600 file fallback — file perms enforced at write
  }
}

function decryptToken(stored: string): string {
  if (!stored.startsWith('enc:')) return stored;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { safeStorage } = require('electron') as { safeStorage: { decryptString: (b: Buffer) => string } };
  return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
}

export async function loadOAuthStore(userDataDir: string): Promise<OAuthStore> {
  if (cachedStore) return cachedStore;
  try {
    const raw = JSON.parse(await fs.readFile(storeFile(userDataDir), 'utf8')) as OAuthStore;
    cachedStore = raw && typeof raw === 'object' ? raw : {};
  } catch {
    cachedStore = {};
  }
  return cachedStore;
}

async function saveOAuthStore(userDataDir: string, store: OAuthStore): Promise<void> {
  cachedStore = store;
  const file = storeFile(userDataDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(file, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
  } catch {
    /* best-effort persistence */
  }
}

// ------------------------------------------------------------
// HTTP helpers
// ------------------------------------------------------------

async function httpJson(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  // v11.13.1 SSRF guard: never fetch a server-controlled URL that points at a
  // private/link-local network (cloud metadata APIs, internal admin panels).
  const target = assertSafeFetchTarget(url);
  // DNS rebinding bypass of the literal-IP check above: best-effort resolve
  // and reject hostnames that land in a private range. A lookup failure is
  // left to fetch() itself so offline behaviour is unchanged.
  if (!isLoopbackHost(target.hostname) && !isPrivateAddress(target.hostname)) {
    try {
      const { lookup } = await import('node:dns/promises');
      const addrs = await lookup(target.hostname, { all: true });
      if (addrs.some((a) => isPrivateAddress(a.address))) {
        throw new Error('Blocked unsafe OAuth endpoint: hostname resolves to a private network address.');
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('private network address')) throw err;
      /* DNS failure: fetch will fail on its own */
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(target.toString(), {
      method: init?.method ?? 'GET',
      headers: { accept: 'application/json', ...(init?.headers ?? {}) },
      body: init?.body,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = null;
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

function formEncode(obj: Record<string, string>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

// ------------------------------------------------------------
// Discovery + registration
// ------------------------------------------------------------

export interface AuthServerMeta {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported?: string[];
  issuer?: string;
}

/**
 * RFC 8414 discovery. Tries {url}/.well-known/oauth-authorization-server and
 * the path-suffix form {origin}/.well-known/oauth-authorization-server{path}.
 */
export async function discoverAuthorizationServer(serverUrl: string): Promise<AuthServerMeta | null> {
  let u: URL;
  try {
    u = new URL(serverUrl);
  } catch {
    return null;
  }
  // A serverUrl that itself targets a private/link-local host is rejected
  // before any metadata request is made (basic SSRF guard).
  try {
    assertSafeFetchTarget(u.toString());
  } catch {
    return null;
  }
  const candidates = [
    `${u.origin}/.well-known/oauth-authorization-server${u.pathname === '/' ? '' : u.pathname}`,
    `${u.origin}/.well-known/oauth-authorization-server`,
  ];
  for (const c of candidates) {
    try {
      const { status, json } = await httpJson(c);
      if (status === 200 && json && typeof json.authorization_endpoint === 'string' && typeof json.token_endpoint === 'string') {
        // Every URL in the metadata is attacker-controlled. Validate them all.
        // A throw here skips this candidate (treated as malicious/malformed).
        const authorization = assertSafeExternalUrl(json.authorization_endpoint);
        const token = assertSafeFetchTarget(json.token_endpoint);
        const issuerRaw = typeof json.issuer === 'string' ? json.issuer : u.origin;
        const issuer = new URL(issuerRaw);
        // RFC 8414: the authorization endpoint MUST share protocol + host with
        // the issuer. Without this a malicious server could make us hand a
        // user-controlled browser navigation (shell.openExternal) to evil.com.
        if (issuer.protocol !== authorization.protocol || issuer.host !== authorization.host) {
          continue;
        }
        if (typeof json.registration_endpoint === 'string') {
          assertSafeFetchTarget(json.registration_endpoint);
        }
        return {
          authorizationEndpoint: authorization.toString(),
          tokenEndpoint: token.toString(),
          ...(typeof json.issuer === 'string' ? { issuer: json.issuer } : {}),
          ...(typeof json.registration_endpoint === 'string' ? { registrationEndpoint: json.registration_endpoint } : {}),
          ...(Array.isArray(json.scopes_supported) ? { scopesSupported: json.scopes_supported.map(String) } : {}),
        };
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

/** RFC 7591 dynamic client registration. */
export async function registerClient(meta: AuthServerMeta, clientName = 'Surnia MCP'): Promise<{ clientId: string; clientSecret?: string } | null> {
  if (!meta.registrationEndpoint) return null;
  try {
    const { status, json } = await httpJson(meta.registrationEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: clientName,
        redirect_uris: ['http://127.0.0.1/callback'], // port is substituted per-flow (loopback matches any port per RFC 8252)
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none', // public client + PKCE (native app)
        application_type: 'native',
      }),
    });
    if ((status === 200 || status === 201) && json && typeof json.client_id === 'string') {
      return {
        clientId: json.client_id,
        ...(typeof json.client_secret === 'string' ? { clientSecret: json.client_secret } : {}),
      };
    }
  } catch {
    /* fall through */
  }
  return null;
}

// ------------------------------------------------------------
// PKCE + local callback flow
// ------------------------------------------------------------

/** RFC 8252 hygiene: ANY value echoed into the loopback HTML page is escaped.
 *  The authorization server controls the `error` param — reflecting it raw
 *  was an XSS hole in v7.1 (fixed in v8.1). */
export function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Constant-time state comparison (RFC 6749 §4.1.2 — CSRF defense).
 *  v7.1 generated and sent `state` but never compared it on the callback. */
export function verifyCallbackState(expected: string, received: string | null): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export interface OAuthFlowResult {
  ok: boolean;
  tokens?: OAuthTokens;
  error?: string;
  detail?: string;
}

/**
 * Full browser flow: discover → (dynamic registration) → local callback →
 * authorize in the system browser → exchange → store. `openUrl` is injected
 * (shell.openExternal) so this stays testable.
 */
export async function startOAuthFlow(opts: {
  serverId: string;
  serverUrl: string;
  userDataDir: string;
  openUrl: (url: string) => void;
  scopes?: string[];
  /** Static client credentials from server config (when registration is not offered). */
  staticClient?: { clientId: string; clientSecret?: string };
}): Promise<OAuthFlowResult> {
  const meta = await discoverAuthorizationServer(opts.serverUrl);
  if (!meta) {
    return { ok: false, error: `no OAuth authorization-server metadata at ${opts.serverUrl} (RFC 8414 discovery failed)` };
  }
  let client = opts.staticClient ?? null;
  if (!client) {
    const dyn = await registerClient(meta);
    if (!dyn) return { ok: false, error: 'server offers no dynamic client registration and none is configured', detail: `registration_endpoint: ${meta.registrationEndpoint ?? 'absent'}` };
    client = dyn;
  }

  const { verifier, challenge } = pkce();
  // v8.1 — state is generated ONCE, sent to the AS, and VERIFIED on the
  // callback (RFC 6749 §4.1.2 / RFC 8252 §7.3 — CSRF protection).
  const state = crypto.randomBytes(16).toString('base64url');
  const redirect = await listenForCode(state);

  // Defense in depth: re-validate immediately before openExternal, even if
  // `meta` came from a caller other than discoverAuthorizationServer. A bad
  // scheme (javascript:/file:/data:) is the XSS -> RCE we must never allow.
  const authUrl = assertSafeExternalUrl(meta.authorizationEndpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', client.clientId);
  authUrl.searchParams.set('redirect_uri', redirect.redirectUri);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  if (opts.scopes?.length || meta.scopesSupported?.length) {
    authUrl.searchParams.set('scope', (opts.scopes ?? meta.scopesSupported ?? []).slice(0, 12).join(' '));
  }

  opts.openUrl(authUrl.toString());

  let code: string | null = null;
  try {
    code = await redirect.waitForCode(CALLBACK_TIMEOUT_MS);
  } catch (err) {
    redirect.close();
    return { ok: false, error: `authorization callback failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  redirect.close();
  if (!code) return { ok: false, error: 'no authorization code received' };

  const tokenRes = await httpJson(meta.tokenEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(client.clientSecret
        ? { authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64')}` }
        : {}),
    },
    body: formEncode({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect.redirectUri,
      client_id: client.clientId,
      code_verifier: verifier,
    }),
  });
  const tok = tokenRes.json;
  if (tokenRes.status !== 200 || !tok || typeof tok.access_token !== 'string') {
    return { ok: false, error: `token exchange failed (HTTP ${tokenRes.status})`, detail: tokenRes.text.slice(0, 200) };
  }
  const tokens: OAuthTokens = {
    accessToken: tok.access_token,
    ...(typeof tok.refresh_token === 'string' ? { refreshToken: tok.refresh_token } : {}),
    ...(typeof tok.expires_in === 'number' ? { expiresAt: Date.now() + tok.expires_in * 1000 } : {}),
    ...(typeof tok.scope === 'string' ? { scope: tok.scope } : {}),
    ...(typeof tok.token_type === 'string' ? { tokenType: tok.token_type } : {}),
    clientId: client.clientId,
    ...(client.clientSecret ? { clientSecret: client.clientSecret } : {}),
    ...(opts.serverUrl ? { issuer: new URL(opts.serverUrl).origin } : {}),
  };
  const store = await loadOAuthStore(opts.userDataDir);
  store[opts.serverId] = tokens;
  await saveOAuthStore(opts.userDataDir, store);
  return { ok: true, tokens };
}

/** One-shot loopback listener. Port chosen by the OS; 127.0.0.1 only.
 *  v8.1: carries the expected `state` and rejects callbacks whose state does
 *  not match (CSRF, RFC 6749 §4.1.2), and HTML-escapes everything reflected
 *  into the page (the AS controls the `error` param — v7.1 reflected it raw). */
function listenForCode(expectedState: string): { redirectUri: string; waitForCode: (timeoutMs: number) => Promise<string | null>; close: () => void } {
  let resolveCode: (c: string | null) => void = () => undefined;
  const codePromise = new Promise<string | null>((resolve) => {
    resolveCode = resolve;
  });
  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      const code = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      const state = u.searchParams.get('state');
      const stateOk = verifyCallbackState(expectedState, state);
      let page: string;
      if (state && !stateOk) {
        page = 'Authorization state mismatch — this callback was not initiated by Surnia. Close this window and retry.';
      } else if (err) {
        page = `Authorization failed: ${escapeHtml(err)}`;
      } else if (code && stateOk) {
        page = 'Authorization received — you can close this window.';
      } else {
        page = 'Waiting for the authorization server…';
      }
      res.writeHead(state && !stateOk ? 400 : 200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<html><body style="font-family:sans-serif;background:#0d1117;color:#e6edf3;display:grid;place-items:center;height:100vh"><div style="text-align:center"><h1>Surnia</h1><p>${page}</p></div></body></html>`,
      );
      resolveCode(code && stateOk ? code : null);
    } catch {
      resolveCode(null);
    }
  });
  server.listen(0, '127.0.0.1');
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    redirectUri: `http://127.0.0.1:${port}/callback`,
    waitForCode: (timeoutMs: number) =>
      Promise.race([
        codePromise,
        new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
      ]),
    close: () => {
      try {
        server.close();
      } catch {
        /* already closed */
      }
    },
  };
}

// ------------------------------------------------------------
// Token use + refresh
// ------------------------------------------------------------

export interface AuthHeadersResult {
  headers: Record<string, string>;
  status: 'ok' | 'none' | 'expired' | 'refresh-failed';
  detail?: string;
}

/**
 * The single call the MCP transport makes before each HTTP/SSE request.
 * No stored token → {}. Valid token → Bearer. Expired + refresh token →
 * one refresh attempt (stored on success).
 */
export async function authHeadersFor(serverId: string, userDataDir: string, serverUrl?: string): Promise<AuthHeadersResult> {
  const store = await loadOAuthStore(userDataDir);
  const t = store[serverId];
  if (!t?.accessToken) return { headers: {}, status: 'none' };
  if (!t.expiresAt || t.expiresAt > Date.now() + 30_000) {
    return { headers: { authorization: `Bearer ${t.accessToken}` }, status: 'ok' };
  }
  if (!t.refreshToken || !serverUrl) return { headers: {}, status: 'expired', detail: 'token expired and no refresh token' };
  const meta = await discoverAuthorizationServer(serverUrl);
  if (!meta) return { headers: {}, status: 'refresh-failed', detail: 'authorization server unreachable for refresh' };
  let refreshFailure = 'refresh returned no access token';
  try {
    const res = await httpJson(meta.tokenEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(t.clientSecret ? { authorization: `Basic ${Buffer.from(`${t.clientId ?? ''}:${t.clientSecret}`).toString('base64')}` } : {}),
      },
      body: formEncode({ grant_type: 'refresh_token', refresh_token: t.refreshToken, client_id: t.clientId ?? '' }),
    });
    const tok = res.json;
    if (res.status === 200 && tok && typeof tok.access_token === 'string') {
      const fresh: OAuthTokens = {
        ...t,
        accessToken: tok.access_token,
        ...(typeof tok.refresh_token === 'string' ? { refreshToken: tok.refresh_token } : {}),
        ...(typeof tok.expires_in === 'number' ? { expiresAt: Date.now() + tok.expires_in * 1000 } : {}),
      };
      store[serverId] = fresh;
      await saveOAuthStore(userDataDir, store);
      return { headers: { authorization: `Bearer ${fresh.accessToken}` }, status: 'ok' };
    }
    refreshFailure = `refresh returned HTTP ${res.status}: ${res.text.slice(0, 120)}`;
  } catch (err) {
    return { headers: {}, status: 'refresh-failed', detail: err instanceof Error ? err.message : String(err) };
  }
  return { headers: {}, status: 'refresh-failed', detail: refreshFailure };
}

/** Remove stored credentials for a server (Sign out). */
export async function clearOAuth(serverId: string, userDataDir: string): Promise<void> {
  const store = await loadOAuthStore(userDataDir);
  delete store[serverId];
  await saveOAuthStore(userDataDir, store);
}

/** Does this server have stored OAuth credentials? (Settings UI.) */
export async function hasOAuth(serverId: string, userDataDir: string): Promise<boolean> {
  const store = await loadOAuthStore(userDataDir);
  return !!store[serverId]?.accessToken;
}

/** Decrypt-and-peek for the Settings UI: masked scope + expiry only. */
export async function oauthStatusFor(serverId: string, userDataDir: string): Promise<{ signedIn: boolean; scope?: string; expiresAt?: number; issuer?: string } | null> {
  const store = await loadOAuthStore(userDataDir);
  const t = store[serverId];
  if (!t) return null;
  return { signedIn: !!t.accessToken, scope: t.scope, expiresAt: t.expiresAt, issuer: t.issuer };
}

/** Ensure DISCOVERY_PATHS constant is referenced (linter keeps it honest). */
void DISCOVERY_PATHS;
