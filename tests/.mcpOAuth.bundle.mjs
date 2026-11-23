// electron/agent/mcpOAuth.ts
import * as http from "node:http";
import { promises as fs } from "node:fs";
import * as crypto from "node:crypto";
import * as path from "node:path";
var HTTP_TIMEOUT_MS = 15e3;
var CALLBACK_TIMEOUT_MS = 5 * 6e4;
var cachedStore = null;
function storeFile(userDataDir) {
  return path.join(userDataDir, "mcp-oauth.json");
}
async function loadOAuthStore(userDataDir) {
  if (cachedStore) return cachedStore;
  try {
    const raw = JSON.parse(await fs.readFile(storeFile(userDataDir), "utf8"));
    cachedStore = raw && typeof raw === "object" ? raw : {};
  } catch {
    cachedStore = {};
  }
  return cachedStore;
}
async function saveOAuthStore(userDataDir, store) {
  cachedStore = store;
  const file = storeFile(userDataDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(file, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 384 });
  } catch {
  }
}
async function httpJson(url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: { accept: "application/json", ...init?.headers ?? {} },
      body: init?.body,
      signal: ctrl.signal
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}
function formEncode(obj) {
  return Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}
async function discoverAuthorizationServer(serverUrl) {
  let u;
  try {
    u = new URL(serverUrl);
  } catch {
    return null;
  }
  const candidates = [
    `${u.origin}/.well-known/oauth-authorization-server${u.pathname === "/" ? "" : u.pathname}`,
    `${u.origin}/.well-known/oauth-authorization-server`
  ];
  for (const c of candidates) {
    try {
      const { status, json } = await httpJson(c);
      if (status === 200 && json && typeof json.authorization_endpoint === "string" && typeof json.token_endpoint === "string") {
        return {
          authorizationEndpoint: json.authorization_endpoint,
          tokenEndpoint: json.token_endpoint,
          ...typeof json.registration_endpoint === "string" ? { registrationEndpoint: json.registration_endpoint } : {},
          ...Array.isArray(json.scopes_supported) ? { scopesSupported: json.scopes_supported.map(String) } : {}
        };
      }
    } catch {
    }
  }
  return null;
}
async function registerClient(meta, clientName = "Surnia MCP") {
  if (!meta.registrationEndpoint) return null;
  try {
    const { status, json } = await httpJson(meta.registrationEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: clientName,
        redirect_uris: ["http://127.0.0.1/callback"],
        // port is substituted per-flow (loopback matches any port per RFC 8252)
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        // public client + PKCE (native app)
        application_type: "native"
      })
    });
    if ((status === 200 || status === 201) && json && typeof json.client_id === "string") {
      return {
        clientId: json.client_id,
        ...typeof json.client_secret === "string" ? { clientSecret: json.client_secret } : {}
      };
    }
  } catch {
  }
  return null;
}
function escapeHtml(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function verifyCallbackState(expected, received) {
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function pkce() {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
async function startOAuthFlow(opts) {
  const meta = await discoverAuthorizationServer(opts.serverUrl);
  if (!meta) {
    return { ok: false, error: `no OAuth authorization-server metadata at ${opts.serverUrl} (RFC 8414 discovery failed)` };
  }
  let client = opts.staticClient ?? null;
  if (!client) {
    const dyn = await registerClient(meta);
    if (!dyn) return { ok: false, error: "server offers no dynamic client registration and none is configured", detail: `registration_endpoint: ${meta.registrationEndpoint ?? "absent"}` };
    client = dyn;
  }
  const { verifier, challenge } = pkce();
  const state = crypto.randomBytes(16).toString("base64url");
  const redirect = await listenForCode(state);
  const authUrl = new URL(meta.authorizationEndpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", client.clientId);
  authUrl.searchParams.set("redirect_uri", redirect.redirectUri);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  if (opts.scopes?.length || meta.scopesSupported?.length) {
    authUrl.searchParams.set("scope", (opts.scopes ?? meta.scopesSupported ?? []).slice(0, 12).join(" "));
  }
  opts.openUrl(authUrl.toString());
  let code = null;
  try {
    code = await redirect.waitForCode(CALLBACK_TIMEOUT_MS);
  } catch (err) {
    redirect.close();
    return { ok: false, error: `authorization callback failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  redirect.close();
  if (!code) return { ok: false, error: "no authorization code received" };
  const tokenRes = await httpJson(meta.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...client.clientSecret ? { authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64")}` } : {}
    },
    body: formEncode({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirect.redirectUri,
      client_id: client.clientId,
      code_verifier: verifier
    })
  });
  const tok = tokenRes.json;
  if (tokenRes.status !== 200 || !tok || typeof tok.access_token !== "string") {
    return { ok: false, error: `token exchange failed (HTTP ${tokenRes.status})`, detail: tokenRes.text.slice(0, 200) };
  }
  const tokens = {
    accessToken: tok.access_token,
    ...typeof tok.refresh_token === "string" ? { refreshToken: tok.refresh_token } : {},
    ...typeof tok.expires_in === "number" ? { expiresAt: Date.now() + tok.expires_in * 1e3 } : {},
    ...typeof tok.scope === "string" ? { scope: tok.scope } : {},
    ...typeof tok.token_type === "string" ? { tokenType: tok.token_type } : {},
    clientId: client.clientId,
    ...client.clientSecret ? { clientSecret: client.clientSecret } : {},
    ...opts.serverUrl ? { issuer: new URL(opts.serverUrl).origin } : {}
  };
  const store = await loadOAuthStore(opts.userDataDir);
  store[opts.serverId] = tokens;
  await saveOAuthStore(opts.userDataDir, store);
  return { ok: true, tokens };
}
function listenForCode(expectedState) {
  let resolveCode = () => void 0;
  const codePromise = new Promise((resolve) => {
    resolveCode = resolve;
  });
  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      const code = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      const state = u.searchParams.get("state");
      const stateOk = verifyCallbackState(expectedState, state);
      let page;
      if (state && !stateOk) {
        page = "Authorization state mismatch \u2014 this callback was not initiated by Surnia. Close this window and retry.";
      } else if (err) {
        page = `Authorization failed: ${escapeHtml(err)}`;
      } else if (code && stateOk) {
        page = "Authorization received \u2014 you can close this window.";
      } else {
        page = "Waiting for the authorization server\u2026";
      }
      res.writeHead(state && !stateOk ? 400 : 200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<html><body style="font-family:sans-serif;background:#0d1117;color:#e6edf3;display:grid;place-items:center;height:100vh"><div style="text-align:center"><h1>Surnia</h1><p>${page}</p></div></body></html>`
      );
      resolveCode(code && stateOk ? code : null);
    } catch {
      resolveCode(null);
    }
  });
  server.listen(0, "127.0.0.1");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    redirectUri: `http://127.0.0.1:${port}/callback`,
    waitForCode: (timeoutMs) => Promise.race([
      codePromise,
      new Promise((r) => setTimeout(() => r(null), timeoutMs))
    ]),
    close: () => {
      try {
        server.close();
      } catch {
      }
    }
  };
}
async function authHeadersFor(serverId, userDataDir, serverUrl) {
  const store = await loadOAuthStore(userDataDir);
  const t = store[serverId];
  if (!t?.accessToken) return { headers: {}, status: "none" };
  if (!t.expiresAt || t.expiresAt > Date.now() + 3e4) {
    return { headers: { authorization: `Bearer ${t.accessToken}` }, status: "ok" };
  }
  if (!t.refreshToken || !serverUrl) return { headers: {}, status: "expired", detail: "token expired and no refresh token" };
  const meta = await discoverAuthorizationServer(serverUrl);
  if (!meta) return { headers: {}, status: "refresh-failed", detail: "authorization server unreachable for refresh" };
  let refreshFailure = "refresh returned no access token";
  try {
    const res = await httpJson(meta.tokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...t.clientSecret ? { authorization: `Basic ${Buffer.from(`${t.clientId ?? ""}:${t.clientSecret}`).toString("base64")}` } : {}
      },
      body: formEncode({ grant_type: "refresh_token", refresh_token: t.refreshToken, client_id: t.clientId ?? "" })
    });
    const tok = res.json;
    if (res.status === 200 && tok && typeof tok.access_token === "string") {
      const fresh = {
        ...t,
        accessToken: tok.access_token,
        ...typeof tok.refresh_token === "string" ? { refreshToken: tok.refresh_token } : {},
        ...typeof tok.expires_in === "number" ? { expiresAt: Date.now() + tok.expires_in * 1e3 } : {}
      };
      store[serverId] = fresh;
      await saveOAuthStore(userDataDir, store);
      return { headers: { authorization: `Bearer ${fresh.accessToken}` }, status: "ok" };
    }
    refreshFailure = `refresh returned HTTP ${res.status}: ${res.text.slice(0, 120)}`;
  } catch (err) {
    return { headers: {}, status: "refresh-failed", detail: err instanceof Error ? err.message : String(err) };
  }
  return { headers: {}, status: "refresh-failed", detail: refreshFailure };
}
async function clearOAuth(serverId, userDataDir) {
  const store = await loadOAuthStore(userDataDir);
  delete store[serverId];
  await saveOAuthStore(userDataDir, store);
}
async function hasOAuth(serverId, userDataDir) {
  const store = await loadOAuthStore(userDataDir);
  return !!store[serverId]?.accessToken;
}
async function oauthStatusFor(serverId, userDataDir) {
  const store = await loadOAuthStore(userDataDir);
  const t = store[serverId];
  if (!t) return null;
  return { signedIn: !!t.accessToken, scope: t.scope, expiresAt: t.expiresAt, issuer: t.issuer };
}
export {
  authHeadersFor,
  clearOAuth,
  discoverAuthorizationServer,
  escapeHtml,
  hasOAuth,
  loadOAuthStore,
  oauthStatusFor,
  registerClient,
  startOAuthFlow,
  verifyCallbackState
};
