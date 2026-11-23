var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};

// tests/electron-stub.mjs
import { tmpdir } from "node:os";
var app, safeStorage;
var init_electron_stub = __esm({
  "tests/electron-stub.mjs"() {
    "use strict";
    app = {
      // SADEEM_TEST_USERDATA — a test process can isolate userData (library/plugins registries).
      getPath: (name) => name === "userData" && process.env.SADEEM_TEST_USERDATA ? process.env.SADEEM_TEST_USERDATA : tmpdir(),
      isReady: () => true,
      whenReady: async () => void 0,
      getName: () => "surnia-test",
      getVersion: () => "0.0.0-test"
    };
    safeStorage = { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
  }
});

// shared/types.ts
var ALLOW_MODEL_FAILOVER_DEFAULT;
var init_types = __esm({
  "shared/types.ts"() {
    "use strict";
    ALLOW_MODEL_FAILOVER_DEFAULT = false;
  }
});

// electron/services/storeService.ts
import * as fs from "fs";
import * as path from "path";
function normalizeAllowModelFailover(value) {
  return value === true ? true : ALLOW_MODEL_FAILOVER_DEFAULT;
}
function isMaskedSecret(value) {
  return typeof value === "string" && value.includes(MASK_ELLIPSIS);
}
function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}
function decryptSecret(value) {
  if (typeof value !== "string" || !value) return value;
  if (value.startsWith(PLAIN_PREFIX)) return value.slice(PLAIN_PREFIX.length);
  if (!value.startsWith(ENC_PREFIX)) return value;
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), "base64"));
  } catch {
    console.warn("[surnia] settings: a stored secret could not be decrypted \u2014 treating it as missing.");
    return "";
  }
}
function migrateSettings(parsed) {
  const from = typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 2;
  if (from >= CURRENT_SCHEMA_VERSION) return parsed;
  let migrated = parsed;
  migrated = { ...migrated, schemaVersion: CURRENT_SCHEMA_VERSION };
  try {
    const m = migrated.model;
    if (!migrated.modelRefreshedTo2026 && m?.model === "claude-sonnet-4-5") {
      migrated.model = { provider: m.provider ?? "anthropic", model: "claude-sonnet-5.5" };
      migrated.modelRefreshedTo2026 = true;
    } else if (!migrated.modelRefreshedTo2026) {
      migrated.modelRefreshedTo2026 = true;
    }
  } catch {
  }
  try {
    const agent = migrated.agent && typeof migrated.agent === "object" ? migrated.agent : {};
    agent.allowModelFailover = normalizeAllowModelFailover(agent.allowModelFailover);
    migrated.agent = agent;
  } catch {
  }
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(migrated, null, 2), { encoding: "utf8", mode: 384 });
  } catch {
  }
  return migrated;
}
function readJson(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn(
        `[surnia] settings: ${path.basename(file)} could not be read/parsed \u2014 using safe defaults:`,
        err instanceof Error ? err.message : String(err)
      );
    }
    return null;
  }
}
function decryptProviders(raw) {
  const providers = {};
  for (const [id, entry] of Object.entries(raw.providers ?? {})) {
    if (!entry || typeof entry !== "object") continue;
    providers[id] = {
      ...entry,
      apiKey: entry.apiKey ? decryptSecret(entry.apiKey) : void 0
    };
  }
  return { ...raw, providers };
}
function decryptRemote(raw) {
  const r = raw.remote;
  if (!r || typeof r !== "object") return raw;
  return { ...raw, remote: { ...r, token: r.token ? decryptSecret(r.token) : void 0 } };
}
function decryptBilling(raw) {
  const b = raw.billing;
  if (!b || typeof b !== "object") return raw;
  return {
    ...raw,
    billing: {
      ...b,
      stripeSecretKey: b.stripeSecretKey ? decryptSecret(b.stripeSecretKey) : void 0
    }
  };
}
function getSettings() {
  settingsCalls++;
  const file = settingsPath();
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
  }
  if (settingsCache && settingsCache.mtimeMs === mtimeMs) return settingsCache.value;
  settingsDiskReads++;
  const parsed = readJson(file);
  if (!parsed) return { ...DEFAULT_SETTINGS };
  const migrated = migrateSettings(parsed);
  unmaskSettings(migrated);
  const merged = {
    ...DEFAULT_SETTINGS,
    ...migrated,
    model: { ...DEFAULT_SETTINGS.model, ...migrated.model ?? {} },
    providers: { ...migrated.providers ?? {} },
    billing: { ...DEFAULT_SETTINGS.billing, ...migrated.billing ?? {} },
    apiServer: { ...DEFAULT_SETTINGS.apiServer, ...migrated.apiServer ?? {} },
    // v11.4 — nested group defaults (a missing group on disk still gets its defaults)
    editor: { ...DEFAULT_SETTINGS.editor, ...migrated.editor ?? {} },
    terminal: { ...DEFAULT_SETTINGS.terminal, ...migrated.terminal ?? {} },
    logs: { ...DEFAULT_SETTINGS.logs, ...migrated.logs ?? {} },
    voice: { ...DEFAULT_SETTINGS.voice, ...migrated.voice ?? {} },
    shortcuts: { ...migrated.shortcuts ?? {} },
    embeddings: { ...DEFAULT_SETTINGS.embeddings, ...migrated.embeddings ?? {} },
    agent: { ...DEFAULT_SETTINGS.agent, ...migrated.agent ?? {} }
  };
  merged.agent.allowModelFailover = normalizeAllowModelFailover(merged.agent.allowModelFailover);
  const value = decryptRemote(decryptBilling(decryptProviders(merged)));
  settingsCache = { mtimeMs, value };
  return value;
}
function unmaskSettings(parsed) {
  try {
    const providers = parsed.providers;
    if (providers && typeof providers === "object") {
      for (const entry of Object.values(providers)) {
        if (entry && isMaskedSecret(entry.apiKey)) entry.apiKey = void 0;
      }
    }
    const billing = parsed.billing;
    if (billing && isMaskedSecret(billing.stripeSecretKey)) billing.stripeSecretKey = void 0;
    const apiServerCfg = parsed.apiServer;
    if (apiServerCfg && isMaskedSecret(apiServerCfg.token)) apiServerCfg.token = void 0;
    const remoteCfg = parsed.remote;
    if (remoteCfg && isMaskedSecret(remoteCfg.token)) remoteCfg.token = void 0;
  } catch {
  }
}
var CURRENT_SCHEMA_VERSION, DEFAULT_SETTINGS, ENC_PREFIX, PLAIN_PREFIX, MASK_ELLIPSIS, settingsCache, settingsCalls, settingsDiskReads;
var init_storeService = __esm({
  "electron/services/storeService.ts"() {
    "use strict";
    init_electron_stub();
    init_types();
    CURRENT_SCHEMA_VERSION = 4;
    DEFAULT_SETTINGS = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      language: "en",
      theme: "obsidian",
      permissionMode: "default",
      model: { provider: "anthropic", model: "claude-sonnet-5.5" },
      providers: {},
      fontSize: 13,
      terminalFontSize: 12,
      autoApproveEdits: false,
      checkpointsEnabled: true,
      onboardingDone: false,
      localOnly: false,
      recentPaths: [],
      mcpServers: [],
      billing: {},
      apiServer: {},
      usageLog: [],
      // v11.4 — additive group defaults (getSettings deep-merges these with disk)
      editor: { wordWrap: "off", tabSize: 2, minimap: false, fontSize: 13, indentGuides: true },
      terminal: { shell: "default", scrollback: 1e3 },
      logs: { level: "info" },
      voice: { asrProvider: "auto", language: "en-US", autoSend: false, deviceId: "" },
      shortcuts: {},
      // v12 — optional real embeddings for semantic search (offline hasher by default).
      embeddings: { enabled: false, model: "text-embedding-3-small", batchSize: 64 },
      // v12 — tool profile: 'balanced' is the default so nothing breaks on upgrade.
      // v11.23 — failover is ALWAYS off on a fresh install (single source of truth).
      agent: { toolProfile: "balanced", allowModelFailover: ALLOW_MODEL_FAILOVER_DEFAULT }
    };
    ENC_PREFIX = "enc:";
    PLAIN_PREFIX = "plain:";
    MASK_ELLIPSIS = "\u2026";
    settingsCache = null;
    settingsCalls = 0;
    settingsDiskReads = 0;
  }
});

// electron/agent/riskTypes.ts
var init_riskTypes = __esm({
  "electron/agent/riskTypes.ts"() {
    "use strict";
  }
});

// electron/services/terminalGuard.ts
var ALLOW_ONCE_TTL_MS, AUDIT_MAX_BYTES, CRC_TABLE;
var init_terminalGuard = __esm({
  "electron/services/terminalGuard.ts"() {
    "use strict";
    init_riskTypes();
    ALLOW_ONCE_TTL_MS = 10 * 6e4;
    AUDIT_MAX_BYTES = 2 * 1024 * 1024;
    CRC_TABLE = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })();
  }
});

// electron/services/fsService.ts
var MAX_FILE_BYTES;
var init_fsService = __esm({
  "electron/services/fsService.ts"() {
    "use strict";
    init_terminalGuard();
    MAX_FILE_BYTES = 2 * 1024 * 1024;
  }
});

// electron/services/processService.ts
import { spawn } from "child_process";
import * as fs2 from "node:fs";
import * as os from "node:os";
import * as path2 from "node:path";
function killTree(child) {
  try {
    if (process.platform === "win32") {
      if (child.pid) spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
    } else {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
  } catch {
  }
}
function isRunning(child) {
  return !!child && child.exitCode === null && child.signalCode === null;
}
function reap() {
  const finished = [...procs.values()].filter((r) => !isRunning(r.child)).sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
  let excess = finished.length - HISTORY_CAP;
  for (const rec of finished) {
    if (excess <= 0) break;
    closeLog(rec);
    procs.delete(rec.id);
    excess--;
  }
  const now = Date.now();
  for (const rec of procs.values()) {
    if (now - rec.startedAt > PROC_TTL_MS && isRunning(rec.child)) {
      if (rec.child) killTree(rec.child);
    }
  }
}
function closeLog(rec) {
  try {
    if (rec.logFd !== null) fs2.closeSync(rec.logFd);
  } catch {
  }
  rec.logFd = null;
}
function statusOf(rec) {
  return {
    id: rec.id,
    command: rec.command,
    cwd: rec.cwd,
    pid: rec.child?.pid ?? null,
    running: isRunning(rec.child),
    exitCode: rec.exitCode,
    startedAt: rec.startedAt,
    endedAt: rec.endedAt,
    outputChars: rec.ring.length
  };
}
function harvestUrls(rec) {
  const tail2 = rec.ring.slice(-URL_SCAN_CHARS);
  const out = [];
  for (const m of tail2.matchAll(URL_RE)) {
    const u = m[0].replace(/[)\].,;'"]}+$/, "");
    if (!out.includes(u)) out.push(u);
    if (out.length >= 6) break;
  }
  return out;
}
function tail(id, tailChars = 3e3) {
  const rec = procs.get(id);
  if (!rec) return null;
  const cap = Math.max(200, Math.min(4e4, tailChars));
  const slice = rec.ring.length > cap ? rec.ring.slice(rec.ring.length - cap) : rec.ring;
  return {
    ...statusOf(rec),
    output: slice,
    urls: harvestUrls(rec),
    truncated: rec.ringTruncated || rec.ring.length > cap
  };
}
function list() {
  reap();
  return [...procs.values()].sort((a, b) => b.startedAt - a.startedAt).map(statusOf);
}
var HISTORY_CAP, PROC_TTL_MS, URL_RE, URL_SCAN_CHARS, procs, logsDir;
var init_processService = __esm({
  "electron/services/processService.ts"() {
    "use strict";
    init_terminalGuard();
    init_fsService();
    HISTORY_CAP = 32;
    PROC_TTL_MS = 6 * 60 * 6e4;
    URL_RE = /https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/[^\s"']*)?/gi;
    URL_SCAN_CHARS = 8e3;
    procs = /* @__PURE__ */ new Map();
    logsDir = path2.join(os.tmpdir(), "surnia-process-logs");
  }
});

// electron/services/previewService.ts
import { createServer, request as httpRequest } from "node:http";
import { createConnection } from "node:net";
import { promises as fs3 } from "node:fs";
import { watch as fsWatch } from "node:fs";
import { spawn as spawn2, spawnSync } from "child_process";
import * as path3 from "node:path";
function setPreviewEventEmitter(cb) {
  emitEvent = cb;
}
function emit(e) {
  try {
    emitEvent?.(e);
  } catch {
  }
}
function listenOnPreferred(server, preferred) {
  return new Promise((resolve3, reject) => {
    let port = Number.isInteger(preferred) && preferred > 0 && preferred <= 65535 ? preferred : 4173;
    const ceiling = Math.min(65535, port + 40);
    const attempt = () => {
      const onError = (err) => {
        server.removeListener("listening", onListening);
        if (err.code === "EADDRINUSE" && port < ceiling) {
          port += 1;
          attempt();
          return;
        }
        reject(err);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        resolve3(server.address().port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    };
    attempt();
  });
}
function escapeHtml(s) {
  return s.replace(
    /[&<>"']/g,
    (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
  );
}
function jsJson(v) {
  return (JSON.stringify(v ?? null) ?? "null").replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function humanSize(n) {
  if (!Number.isFinite(n) || n < 0) return "?";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${units[u]}`;
}
function isPreviewableArtifact(name) {
  return ARTIFACT_TYPES[path3.extname(name).toLowerCase()] !== void 0;
}
async function resolveContained(rootDir, rel) {
  try {
    let p = path3.normalize(rel).replace(/^([.][.][/\\])+/, "");
    if (p === "/" || p === "\\" || p === "") return null;
    const file = path3.join(rootDir, p);
    if (!containsPath(rootDir, file)) return null;
    const st = await fs3.stat(file);
    if (!st.isFile()) return null;
    const real = await fs3.realpath(file);
    if (!containsPath(rootDir, real)) return null;
    return real;
  } catch {
    return null;
  }
}
async function serveRawFile(res, rootDir, rel) {
  try {
    const file = await resolveContained(rootDir, rel);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
      res.end("not found");
      return;
    }
    const buf = await fs3.readFile(file);
    res.writeHead(200, {
      "content-type": RAW_MIME[path3.extname(file).toLowerCase()] ?? "text/plain; charset=utf-8",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff"
    });
    res.end(buf);
  } catch {
    try {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
      res.end("not found");
    } catch {
    }
  }
}
async function serveViewer(res, rootDir, srcParam) {
  try {
    const file = await resolveContained(rootDir, srcParam);
    if (!file) {
      res.writeHead(404, {
        "content-type": "text/html; charset=utf-8",
        "x-content-type-options": "nosniff",
        "cache-control": "no-store"
      });
      res.end('<!doctype html><meta charset="utf-8"><body style="background:#141414;color:#9a9a9a;font:13px sans-serif;display:grid;place-items:center;height:100vh;margin:0">File not found in the preview workspace.</body>');
      return;
    }
    const st = await fs3.stat(file);
    if (!ARTIFACT_TYPES[path3.extname(file).toLowerCase()]) {
      await serveRawFile(res, rootDir, srcParam);
      return;
    }
    const relFromRoot = path3.relative(rootDir, file).split(path3.sep).map(encodeURIComponent).join("/");
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    res.end(buildViewerHtml(file, st.size, `${RAW_ROUTE}${relFromRoot}`));
  } catch {
    try {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
      res.end("viewer error");
    } catch {
    }
  }
}
function buildViewerHtml(file, size, rawUrl) {
  const ext = path3.extname(file).toLowerCase();
  const art = ARTIFACT_TYPES[ext] ?? { kind: "text", label: "FILE" };
  const name = path3.basename(file);
  const nameEsc = escapeHtml(name);
  const rawEsc = escapeHtml(rawUrl);
  const cfg = { kind: art.kind, ext: ext.slice(1), raw: rawUrl, name, base: rawUrl.slice(0, rawUrl.lastIndexOf("/") + 1) };
  let stage;
  switch (art.kind) {
    case "pdf":
      stage = `<iframe class="fill" src="${rawEsc}" title="${nameEsc}"></iframe>`;
      break;
    case "image":
      stage = `<div class="checker"><img src="${rawEsc}" alt="${nameEsc}" /></div>`;
      break;
    case "video":
      stage = `<div class="media"><video controls playsinline preload="metadata" src="${rawEsc}"></video></div>`;
      break;
    case "audio":
      stage = `<div class="media"><div class="audio-box"><div class="audio-name">${nameEsc}</div><audio controls preload="metadata" src="${rawEsc}"></audio></div></div>`;
      break;
    default:
      stage = "";
      break;
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${nameEsc} \u2014 preview</title>
<style>${VIEWER_CSS}</style>
</head>
<body>
<header class="vbar"><span class="vname">${nameEsc}</span><span class="vmeta">${art.label} \xB7 ${humanSize(size)}</span></header>
<main id="stage">${stage}</main>
<script>window.__SUR__ = ${jsJson(cfg)};</script>
<script>${VIEWER_JS}</script>
</body>
</html>`;
}
function containsPath(root, target) {
  const rel = path3.relative(path3.resolve(root), path3.resolve(target));
  return rel === "" || !rel.startsWith("..") && !path3.isAbsolute(rel);
}
async function pickStaticRoot(dir) {
  const candidates = [
    dir,
    path3.join(dir, "dist"),
    path3.join(dir, "build"),
    path3.join(dir, "out"),
    path3.join(dir, "public")
  ];
  for (const c of candidates) {
    try {
      const st = await fs3.stat(path3.join(c, "index.html"));
      if (st.isFile()) return c;
    } catch {
    }
  }
  return null;
}
async function serveDirListing(res, rootDir, urlPath) {
  try {
    const rel = urlPath.replace(/^\/+/, "").replace(/\/+$/, "");
    const absDir = rel ? path3.join(rootDir, rel) : rootDir;
    if (!containsPath(rootDir, absDir)) throw new Error("outside root");
    const realDir = await fs3.realpath(absDir);
    if (!containsPath(rootDir, realDir)) throw new Error("outside root");
    const names = (await fs3.readdir(absDir)).filter((n) => n !== ".DS_Store").sort((a, b) => a.localeCompare(b));
    const rows = [];
    for (const n of names) {
      let isDir = false;
      let size = "";
      try {
        const st = await fs3.stat(path3.join(absDir, n));
        isDir = st.isDirectory();
        if (!isDir) size = humanSize(st.size);
      } catch {
      }
      const relN = rel ? `${rel}/${n}` : n;
      const enc = relN.split("/").map(encodeURIComponent).join("/");
      const href = isDir ? `/${enc}/` : /\.html?$/i.test(n) || isPreviewableArtifact(n) ? `/${enc}` : `${VIEWER_ROUTE}?src=${encodeURIComponent(relN)}`;
      rows.push(
        `<tr><td><a href="${escapeHtml(href)}">${isDir ? "[dir] " : ""}${escapeHtml(n)}</a></td><td class="sz">${isDir ? "DIR" : escapeHtml(size)}</td></tr>`
      );
    }
    const title = `Index of /${escapeHtml(rel)}`;
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    res.end(
      `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${title}</title><style>*{box-sizing:border-box}body{background:#141414;color:#d4d4d4;font:13px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin:0;padding:32px}h1{font-size:14px;color:#f0f0f0;margin:0 0 14px;font-weight:600}table{border-collapse:collapse;width:100%;max-width:900px}td{padding:5px 10px;border-bottom:1px solid #2a2a2a}a{color:#6cb2ff;text-decoration:none}a:hover{text-decoration:underline}.sz{color:#8a8a8a;font-size:11px;text-align:right;width:80px;text-transform:uppercase}</style></head><body><h1>${title}</h1><table>${rows.join("") || '<tr><td class="sz">empty folder</td><td class="sz"></td></tr>'}</table><p style="color:#8a8a8a;font-size:11px;margin-top:18px">Sadeem live preview \u2014 built-in static server (no index.html found; showing the folder contents).</p></body></html>`
    );
  } catch {
    try {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
      res.end("not found");
    } catch {
    }
  }
}
async function staticStart(rawDir, preferredPort) {
  const target = path3.resolve(rawDir.trim());
  let st;
  try {
    st = await fs3.stat(target);
  } catch {
    return { ok: false, error: `Directory not found: ${target}` };
  }
  let root = null;
  let entry = "index.html";
  let isArtifact = false;
  let listDir = false;
  if (st.isFile()) {
    const ext = path3.extname(target).toLowerCase();
    if (/^\.html?$/i.test(ext)) {
      root = path3.dirname(target);
      entry = path3.basename(target);
    } else if (ARTIFACT_TYPES[ext]) {
      root = path3.dirname(target);
      entry = path3.basename(target);
      isArtifact = true;
    } else {
      return {
        ok: false,
        error: `Not a previewable file: ${target} \u2014 supported: .html, pdf, images, audio/video, .md, .txt/.json/.xml/.csv/.log and common code files.`
      };
    }
  } else if (st.isDirectory()) {
    root = await pickStaticRoot(target);
    if (!root) {
      root = target;
      entry = "";
      listDir = true;
    }
  } else {
    return { ok: false, error: `Not a file or directory: ${target}` };
  }
  staticStop();
  const entryFile = entry;
  const preferred = preferredPort && preferredPort > 0 ? preferredPort : 4173;
  const servedRoot = root;
  const server = createServer((req, res) => {
    try {
      const rawUrl = req.url ?? "/";
      const qIdx = rawUrl.indexOf("?");
      let urlPath;
      try {
        urlPath = decodeURIComponent(qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl);
      } catch {
        res.writeHead(400, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
        res.end("bad request");
        return;
      }
      if (urlPath === VIEWER_ROUTE) {
        let srcParam = null;
        if (qIdx >= 0) {
          try {
            srcParam = new URLSearchParams(rawUrl.slice(qIdx + 1)).get("src");
          } catch {
            srcParam = null;
          }
        }
        void serveViewer(res, servedRoot, srcParam ?? "");
        return;
      }
      if (urlPath === RAW_ROUTE.slice(0, -1) || urlPath.startsWith(RAW_ROUTE)) {
        void serveRawFile(res, servedRoot, urlPath.slice(RAW_ROUTE.length - 1));
        return;
      }
      if (listDir && (urlPath === "/" || urlPath === "" || urlPath.endsWith("/"))) {
        void serveDirListing(res, servedRoot, urlPath);
        return;
      }
      let rel = path3.normalize(urlPath).replace(/^([.][.][/\\])+/, "");
      if (rel === "/" || rel === "\\") rel = entryFile;
      let file = path3.join(servedRoot, rel);
      if (!containsPath(servedRoot, file)) file = path3.join(servedRoot, entryFile);
      fs3.stat(file).then(async (fst) => {
        if (fst.isDirectory()) file = path3.join(file, "index.html");
        try {
          const real = await fs3.realpath(file);
          if (!containsPath(servedRoot, real)) throw new Error("not found");
          file = real;
        } catch (err) {
          if (err.message === "not found") throw err;
        }
        return fs3.readFile(file);
      }).catch(async () => {
        if (!path3.extname(rel) && !listDir) return fs3.readFile(path3.join(servedRoot, entryFile));
        throw new Error("not found");
      }).then((buf) => {
        const mime = MIME[path3.extname(file).toLowerCase()] ?? "application/octet-stream";
        const isHtml = /\.html?$/i.test(file);
        res.writeHead(200, { "content-type": mime, "cache-control": isHtml ? "no-store" : "no-cache" });
        res.end(buf);
      }).catch(() => {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Surnia preview: 404 \u2014 " + rel);
      });
    } catch {
      try {
        res.writeHead(500);
        res.end("preview error");
      } catch {
      }
    }
  });
  return await new Promise((resolve3) => {
    void listenOnPreferred(server, preferred).then((addrPort) => {
      staticServer = server;
      staticRoot = root;
      staticUrl = `http://127.0.0.1:${addrPort}` + (isArtifact ? `${VIEWER_ROUTE}?src=${encodeURIComponent(entryFile)}` : entryFile !== "index.html" ? `/${entryFile}` : "");
      syncWatcher();
      emit({ kind: "static", state: "ready", url: staticUrl, ws: staticRoot });
      resolve3({ ok: true, url: staticUrl, root: staticRoot });
    }).catch((err) => {
      staticServer = null;
      syncWatcher();
      resolve3({ ok: false, error: `Preview server failed: ${err.message}` });
    });
  });
}
function staticStop() {
  if (staticServer) {
    try {
      staticServer.closeAllConnections?.();
      staticServer.close();
    } catch {
    }
    staticServer = null;
    emit({ kind: "static", state: "stopped" });
  }
  staticRoot = "";
  staticUrl = "";
  syncWatcher();
}
function staticStatus() {
  return staticServer ? { running: true, url: staticUrl, root: staticRoot } : { running: false };
}
async function verifyPreviewUrl(rawUrl, timeoutMs = 1500, require200 = true) {
  let url;
  try {
    url = new URL(rawUrl).toString();
  } catch {
    return { ok: false, status: null, error: `invalid preview URL: ${rawUrl}` };
  }
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(Math.max(100, Math.min(1e4, timeoutMs)))
    });
    const status = res.status;
    try {
      await res.body?.cancel();
    } catch {
    }
    const ok = require200 ? status >= 200 && status < 300 : true;
    return ok ? { ok: true, status } : { ok: false, status, error: `HTTP ${status}` };
  } catch (err) {
    return { ok: false, status: null, error: err instanceof Error ? err.message : String(err) };
  }
}
async function findIndexHtml(root) {
  try {
    const rootEntries = await fs3.readdir(root, { withFileTypes: true });
    const rootHtml = rootEntries.find((e) => e.isFile() && /\.html?$/i.test(e.name));
    if (rootHtml) return path3.join(root, rootHtml.name);
  } catch {
    return null;
  }
  let level = [root];
  for (let depth = 0; depth < 3; depth++) {
    const next = [];
    for (const dir of level) {
      let entries;
      try {
        entries = await fs3.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isDirectory() || AUTO_SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        const sub = path3.join(dir, e.name);
        try {
          if ((await fs3.stat(path3.join(sub, "index.html"))).isFile()) return path3.join(sub, "index.html");
        } catch {
        }
        next.push(sub);
      }
    }
    if (!next.length) break;
    level = next;
  }
  return null;
}
async function findPreviewEntry(ws) {
  const root = path3.resolve(ws);
  let st;
  try {
    st = await fs3.stat(root);
  } catch {
    return null;
  }
  if (st.isFile() && /\.html?$/i.test(root)) {
    return { kind: "static", dir: path3.dirname(root), startPath: root, label: path3.basename(root) };
  }
  if (!st.isDirectory()) return null;
  const index = await findIndexHtml(root);
  if (index) {
    const dir = path3.dirname(index);
    return {
      kind: "static",
      dir,
      startPath: dir,
      label: dir === root ? path3.basename(index) : path3.relative(root, dir).split(path3.sep).join("/") + "/" + path3.basename(index)
    };
  }
  try {
    const pkg = JSON.parse(await fs3.readFile(path3.join(root, "package.json"), "utf8"));
    const script = ["dev", "start", "serve"].find((k) => typeof pkg.scripts?.[k] === "string" && pkg.scripts[k]);
    if (script) return { kind: "dev", dir: root, startPath: root, runtime: "npm", label: `npm run ${script}` };
  } catch {
  }
  for (const name of ["manage.py", "app.py", "main.py", "server.py", "run.py"]) {
    try {
      if ((await fs3.stat(path3.join(root, name))).isFile()) {
        return { kind: "dev", dir: root, startPath: root, runtime: "python", label: `python ${name}` };
      }
    } catch {
    }
  }
  try {
    if ((await fs3.stat(path3.join(root, "go.mod"))).isFile()) {
      return { kind: "dev", dir: root, startPath: root, runtime: "go", label: "go run ." };
    }
  } catch {
  }
  return null;
}
async function autoPreview(ws, preferredPort) {
  const root = path3.resolve(ws);
  const entry = await findPreviewEntry(root);
  if (!entry) {
    return {
      ok: false,
      error: `No web entry found in ${root} \u2014 build an index.html (or add a package.json dev script) before asking for a preview.`
    };
  }
  if (entry.kind === "dev") {
    const start = await devStart(root, entry.runtime ?? "npm");
    if (!start.ok) return { ok: false, kind: "dev", label: entry.label, error: start.error };
    const wait = await waitForDevUrl(8e3);
    if (!wait.ok || !wait.url) {
      return { ok: false, kind: "dev", label: entry.label, error: wait.error ?? "dev server announced no URL" };
    }
    const v2 = await verifyPreviewUrl(wait.url, 1500, false);
    if (!v2.ok) {
      return { ok: false, kind: "dev", label: entry.label, url: wait.url, error: `dev server did not answer HTTP: ${v2.error}` };
    }
    return {
      ok: true,
      url: wait.url,
      root,
      kind: "dev",
      label: entry.label,
      runtime: entry.runtime,
      verified: true,
      status: v2.status
    };
  }
  const res = await staticStart(entry.startPath, preferredPort);
  if (!res.ok || !res.url) {
    return { ok: false, kind: "static", label: entry.label, error: res.error ?? "preview server returned no URL" };
  }
  const v = await verifyPreviewUrl(res.url, 1500, true);
  if (!v.ok) {
    staticStop();
    return {
      ok: false,
      kind: "static",
      label: entry.label,
      url: res.url,
      error: `preview server started but the entry did not answer HTTP 200 (${v.error ?? v.status}); no preview was claimed.`
    };
  }
  return {
    ok: true,
    url: res.url,
    root: res.root ?? entry.dir,
    kind: "static",
    label: entry.label,
    verified: true,
    status: v.status
  };
}
function sanitizeLogLine(raw) {
  return String(raw ?? "").replace(ANSI_RE, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, " ").replace(/\s+$/g, "");
}
function pushLine(lines, line) {
  lines.push(line);
  if (lines.length > DEV_LOG_LINES) lines.splice(0, lines.length - DEV_LOG_LINES);
}
function detectUrl(text) {
  const clean = sanitizeLogLine(text);
  if (!clean.trim() || NEGATIVE_URL_SIGNAL.test(clean)) return null;
  const re = /https?:\/\/(?:(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])|[\w.-]+):(\d{2,5})[^\s"'<>\]]*/gi;
  let m;
  let fallback = null;
  while (m = re.exec(clean)) {
    const port = Number(m[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    const raw = m[0].replace("//0.0.0.0:", "//127.0.0.1:").replace("//[::1]:", "//127.0.0.1:").replace("//localhost:", "//127.0.0.1:").replace(/\/\/[\w.-]+:/, "//127.0.0.1:");
    if (!fallback) fallback = raw;
    if (/^https?:\/\/127\.0\.0\.1:/.test(raw)) return raw;
  }
  if (fallback) return fallback;
  const bareBind = /(?:^|\s)(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])?:(\d{2,5})\s*$/i.test(clean) || /^:(\d{2,5})\s*$/.test(clean);
  if (!POSITIVE_URL_SIGNAL.test(clean) && !bareBind) return null;
  const portPats = [
    /(?:listening|serving|running|started|reachable|ready)[^\r\n]{0,40}?:\s*(\d{2,5})\b/i,
    /\b(?:listening|serving|running|started|ready)\s+(?:on\s+)?(?:port\s+)?:?\s*(\d{2,5})\b/i,
    /\bport\s+(\d{2,5})\b/i,
    bareBind ? /(\d{2,5})\s*$/ : /$^/
  ];
  for (const p of portPats) {
    const pm = p.exec(clean);
    if (pm) {
      const n = Number(pm[1]);
      if (Number.isInteger(n) && n > 0 && n < 65536) return `http://127.0.0.1:${n}`;
    }
  }
  return null;
}
function pickDevScript(pkg) {
  const s = pkg.scripts ?? {};
  for (const name of ["dev", "start", "serve"]) {
    if (typeof s[name] === "string" && s[name].length) return name;
  }
  return null;
}
async function detectFramework(ws, pkg) {
  for (const fw of FRAMEWORKS) {
    for (const cfg of fw.configs) {
      try {
        const st = await fs3.stat(path3.join(ws, cfg));
        if (st.isFile()) return fw;
      } catch {
      }
    }
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  for (const fw of FRAMEWORKS) {
    if (fw.deps.some((d) => deps[d] !== void 0)) return fw;
  }
  return null;
}
function parsePortFlag(cmd) {
  const text = String(cmd ?? "");
  const patterns = [
    /(?:^|\s)--?port\s*[:=]\s*["']?(\d{1,5})\b/i,
    /(?:^|\s)--?port\s+["']?(\d{1,5})\b/i,
    /(?:^|\s)-p\s*[:=]?\s*["']?(\d{1,5})\b/i,
    /(?:^|\s)PORT\s*=\s*["']?(\d{1,5})\b/i
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > 0 && n <= 65535) return n;
    }
  }
  return null;
}
function expectedPort(cmd, fw) {
  return parsePortFlag(cmd) ?? fw?.port ?? null;
}
async function firstExisting(ws, names) {
  for (const n of names) {
    try {
      const st = await fs3.stat(path3.join(ws, n));
      if (st.isFile()) return n;
    } catch {
    }
  }
  return null;
}
function pythonBin() {
  if (pythonBinCache) return pythonBinCache;
  let found = process.platform === "win32" ? "python" : "";
  if (process.platform !== "win32") {
    for (const c of ["python3", "python"]) {
      try {
        const r = spawnSync(c, ["--version"], { timeout: 4e3 });
        if (r.status === 0) {
          found = c;
          break;
        }
      } catch {
      }
    }
  }
  pythonBinCache = found || "python";
  return pythonBinCache;
}
async function detectPythonRun(ws) {
  if (await firstExisting(ws, ["manage.py"])) {
    const py = pythonBin();
    return { cmd: py, args: ["-u", "manage.py", "runserver", "8000"], port: 8e3, label: `${py} manage.py runserver` };
  }
  let reqs = "";
  for (const f of ["requirements.txt", "pyproject.toml"]) {
    try {
      reqs += "\n" + await fs3.readFile(path3.join(ws, f), "utf8");
    } catch {
    }
  }
  const has = (p) => new RegExp(`(^|[^\\w-])${p}([^\\w-]|$)`, "i").test(reqs);
  if (has("uvicorn") || has("fastapi")) {
    const entry2 = await firstExisting(ws, ["main.py", "app.py", "server.py"]);
    if (entry2) {
      const mod = entry2.replace(/\.py$/, "");
      const py = pythonBin();
      return {
        cmd: py,
        args: ["-u", "-m", "uvicorn", `${mod}:app`, "--port", "8000"],
        port: 8e3,
        label: `${py} -m uvicorn ${mod}:app`
      };
    }
  }
  const entry = await firstExisting(ws, ["app.py", "main.py", "server.py", "run.py"]);
  if (entry) {
    const py = pythonBin();
    return { cmd: py, args: ["-u", entry], port: has("flask") ? 5e3 : 8e3, label: `${py} ${entry}` };
  }
  let anyPy = false;
  try {
    anyPy = (await fs3.readdir(ws)).some((n) => /\.(py|pyw)$/i.test(n));
  } catch {
  }
  if (reqs.trim() || anyPy) {
    const py = pythonBin();
    return {
      cmd: py,
      args: ["-m", "http.server", "8000", "--bind", "127.0.0.1"],
      port: 8e3,
      label: `${py} -m http.server 8000`
    };
  }
  return null;
}
function customPort(cmd) {
  return parsePortFlag(cmd) ?? (() => {
    const m = /(?:localhost|127\.0\.0\.1):(\d{2,5})/.exec(cmd);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
  })();
}
function stopPortPoll() {
  if (portPoll) {
    clearInterval(portPoll);
    portPoll = null;
  }
}
function stopStartCap() {
  if (startCap) {
    clearTimeout(startCap);
    startCap = null;
  }
}
async function devStart(workspace, runtime = "npm") {
  const ws = path3.resolve(workspace.trim());
  let launch;
  if (runtime === "custom") {
    const s = getSettings();
    const c = (s.preview?.customCommand ?? "").trim();
    if (!c) {
      return { ok: false, error: "No custom preview command \u2014 set one in Settings \u2192 Preview." };
    }
    launch = { cmd: c, args: [], shell: true, label: c, expected: customPort(c), script: c, runtime: "custom" };
  } else if (runtime === "python") {
    const py = await detectPythonRun(ws);
    if (!py) {
      return {
        ok: false,
        error: "No Python entry found (manage.py / app.py / main.py / server.py) \u2014 use static preview for plain HTML."
      };
    }
    launch = { cmd: py.cmd, args: py.args, shell: true, label: py.label, expected: py.port, script: py.label, runtime: "python" };
  } else if (runtime === "go") {
    let hasGoMod = false;
    try {
      hasGoMod = (await fs3.stat(path3.join(ws, "go.mod"))).isFile();
    } catch {
    }
    if (!hasGoMod) {
      return { ok: false, error: "No go.mod in this workspace \u2014 the Go preview target needs the module root." };
    }
    launch = { cmd: "go", args: ["run", "."], shell: false, label: "go run .", expected: null, script: "go run .", runtime: "go" };
  } else {
    let pkgRaw;
    try {
      pkgRaw = await fs3.readFile(path3.join(ws, "package.json"), "utf8");
    } catch {
      return { ok: false, error: "No package.json in this workspace \u2014 try a Python or static preview target." };
    }
    let pkg;
    try {
      pkg = JSON.parse(pkgRaw);
    } catch {
      return { ok: false, error: "package.json is not valid JSON." };
    }
    const script = pickDevScript(pkg);
    if (!script) return { ok: false, error: "No dev/start/serve script in package.json." };
    const fw = await detectFramework(ws, pkg);
    const expected = expectedPort(pkg.scripts?.[script] ?? "", fw);
    const isWin = process.platform === "win32";
    const npmCmd = isWin ? "npm.cmd" : "npm";
    launch = { cmd: npmCmd, args: ["run", script], shell: false, label: `npm run ${script}`, expected, script, runtime: "npm" };
  }
  devStop();
  const portWasOpenBefore = launch.expected ? await probePort(launch.expected, 200) : false;
  const isWin2 = process.platform === "win32";
  const needsCmdShell = isWin2 && /\.(cmd|bat)$/i.test(launch.cmd);
  const child = spawn2(launch.cmd, launch.args, {
    cwd: ws,
    env: { ...process.env, FORCE_COLOR: "0", BROWSER: "none" },
    detached: !isWin2,
    // own process group on POSIX → clean tree kill
    windowsHide: true,
    shell: launch.shell || needsCmdShell
  });
  const state = {
    child,
    script: launch.script ?? launch.label,
    workspace: ws,
    url: null,
    state: "starting",
    lines: [`$ ${launch.label}${launch.runtime !== "npm" ? "  [" + launch.runtime + "]" : ""}`],
    startedAt: Date.now()
  };
  dev = state;
  stopStartCap();
  startCap = setTimeout(() => {
    if (!dev || dev.child !== child || state.state !== "starting") return;
    state.state = "error";
    const msg = `No server URL/port detected within 20s (${launch.label}). The process is still running \u2014 check its output in the dev log drawer (or a terminal); if it serves on a fixed port, open it from the ports row, or set a custom preview command in Settings \u2192 Preview.`;
    pushLine(state.lines, `[surnia] ${msg}`);
    emit({ kind: "log", level: "warn", text: `[surnia] ${msg}` });
    emit({ kind: "dev", state: "error", error: msg, ws: state.workspace });
  }, 2e4);
  const lineBuffers = { stdout: new LineBuffer(), stderr: new LineBuffer() };
  const handleLine = (src, line) => {
    const text = sanitizeLogLine(line).slice(0, 400);
    if (!text.trim()) return;
    pushLine(state.lines, text);
    emit({ kind: "log", level: src === "stderr" ? "warn" : "info", text });
    const found = detectUrl(text);
    if (found && state.state !== "ready") {
      state.url = found;
      state.state = "ready";
      stopPortPoll();
      stopStartCap();
      emit({ kind: "dev", state: "ready", url: found, ws: state.workspace });
    }
  };
  const drain = (src) => {
    for (const line of lineBuffers[src].flush()) handleLine(src, line);
  };
  const feed = (src) => (chunk) => {
    if (!dev || dev.child !== child) return;
    for (const line of lineBuffers[src].push(String(chunk))) handleLine(src, line);
  };
  child.stdout?.on("data", feed("stdout"));
  child.stderr?.on("data", feed("stderr"));
  child.on("exit", (code) => {
    if (!dev || dev.child !== child) return;
    drain("stdout");
    drain("stderr");
    const wasReady = state.state === "ready";
    pushLine(state.lines, `[process exited with code ${code ?? "null"}]`);
    state.state = code === 0 || wasReady ? "stopped" : "error";
    dev.child = null;
    stopPortPoll();
    stopStartCap();
    syncWatcher();
    emit({ kind: "dev", state: state.state, url: state.url ?? void 0, lines: state.lines.slice(-3), ws: state.workspace });
  });
  child.on("error", (err) => {
    if (!dev || dev.child !== child) return;
    pushLine(state.lines, `[spawn error: ${err.message}]`);
    state.state = "error";
    dev.child = null;
    stopPortPoll();
    stopStartCap();
    syncWatcher();
    emit({ kind: "dev", state: "error", error: err.message, ws: state.workspace });
  });
  if (launch.expected && !portWasOpenBefore) {
    const expected = launch.expected;
    const startedAt = Date.now();
    portPoll = setInterval(() => {
      if (!dev || dev.child !== child || state.state === "ready") {
        stopPortPoll();
        return;
      }
      if (Date.now() - startedAt > 45e3) {
        stopPortPoll();
        return;
      }
      void probeHttpPort(expected, 400).then((open) => {
        if (!open || !dev || dev.child !== child || state.state === "ready") return;
        state.url = `http://127.0.0.1:${expected}`;
        state.state = "ready";
        pushLine(state.lines, `[surnia] dev server answered on port ${expected}`);
        emit({ kind: "dev", state: "ready", url: state.url, ws: state.workspace });
        stopPortPoll();
        stopStartCap();
      });
    }, 600);
  }
  syncWatcher();
  return { ok: true, script: launch.script };
}
function devStop() {
  stopPortPoll();
  stopStartCap();
  const d = dev;
  if (!d) {
    syncWatcher();
    return;
  }
  const child = d.child;
  dev = null;
  if (child && child.pid) {
    try {
      if (process.platform === "win32") {
        spawn2("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
        setTimeout(() => {
          try {
            if (child.pid) process.kill(-child.pid, "SIGKILL");
          } catch {
          }
        }, 1500);
      }
    } catch {
    }
  }
  syncWatcher();
  emit({ kind: "dev", state: "stopped", url: d.url ?? void 0, ws: d.workspace });
}
function collectAgentServerUrls() {
  const out = [];
  try {
    for (const p of list()) {
      const t = tail(p.id, AGENT_URL_SCAN_CHARS);
      if (!t) continue;
      for (const u of t.urls) {
        if (!/^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/i.test(u)) continue;
        const norm = (s) => s.replace(/\/+$/, "");
        if (staticUrl && norm(u) === norm(staticUrl)) continue;
        if (!out.some((o) => norm(o.url) === norm(u))) out.push({ url: u, cwd: p.cwd, id: p.id, command: p.command });
        if (out.length >= AGENT_URLS_CAP) return out;
      }
    }
  } catch {
  }
  return out;
}
function devStatus() {
  const agentSources = collectAgentServerUrls();
  const agentUrls = agentSources.map((s) => s.url);
  if (!dev) return { running: false, state: "idle", lines: [], agentUrls, agentSources };
  return {
    running: !!dev.child,
    state: dev.state,
    url: dev.url ?? void 0,
    script: dev.script,
    lines: dev.lines.slice(-80),
    startedAt: dev.startedAt,
    agentUrls,
    agentSources
  };
}
async function waitForDevUrl(timeoutMs = 8e3) {
  const startedAt = Date.now();
  const budget = Math.max(0, Math.min(12e4, timeoutMs));
  for (; ; ) {
    const s = devStatus();
    if (s.url) return { ok: true, url: s.url };
    if (s.state === "error" || s.state === "stopped" || s.state === "idle" || !s.running) {
      const tail2 = s.lines.slice(-3).join(" ").trim();
      return {
        ok: false,
        error: tail2 ? `dev server is ${s.state} without a URL \u2014 ${tail2}` : `dev server is ${s.state} and announced no preview URL`
      };
    }
    if (Date.now() - startedAt >= budget) {
      const tail2 = s.lines.slice(-3).join(" ").trim();
      return {
        ok: false,
        error: `no preview URL announced within ${budget} ms${tail2 ? ` \u2014 last log: ${tail2}` : ""}`
      };
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}
function probePort(port, timeoutMs = 220) {
  return new Promise((resolve3) => {
    const sock = createConnection({ port, host: "127.0.0.1" });
    const done = (open) => {
      sock.destroy();
      resolve3(open);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}
function probeHttpPort(port, timeoutMs = 400) {
  return new Promise((resolve3) => {
    let settled = false;
    let req;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      try {
        req?.destroy();
      } catch {
      }
      resolve3(open);
    };
    req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/",
        method: "GET",
        timeout: timeoutMs,
        headers: { "user-agent": "Sadeem-Preview-Probe/1.0" }
      },
      (res) => {
        res.resume();
        finish(true);
      }
    );
    req.once("timeout", () => finish(false));
    req.once("error", () => finish(false));
    req.end();
  });
}
async function scanPorts() {
  const results = await Promise.all(SCAN_PORTS.map(probePort));
  const open = SCAN_PORTS.filter((_, i) => results[i]);
  const own = staticServer ? staticServer.address()?.port : null;
  return open.filter((p) => p !== own).slice(0, 8);
}
function stopWatcher() {
  watcherGen += 1;
  if (watchTimer) {
    clearTimeout(watchTimer);
    watchTimer = null;
  }
  if (watcher) {
    try {
      watcher.close();
    } catch {
    }
    watcher = null;
  }
  watchRoot = "";
}
function scheduleWatchEmit(rel) {
  if (watchTimer) clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    watchTimer = null;
    emit({ kind: "watch", path: rel, ws: staticRoot });
  }, WATCH_DEBOUNCE_MS);
}
function startWatcher(root) {
  if (watcher && watchRoot === root) return;
  stopWatcher();
  watchRoot = root;
  const gen = watcherGen;
  let retried = false;
  const attach = (recursive) => {
    if (gen !== watcherGen) return;
    try {
      const w = fsWatch(root, { recursive }, (_event, file) => {
        if (gen !== watcherGen) return;
        const rel = typeof file === "string" ? file : "";
        if (!rel || WATCH_IGNORE.test(rel) || /(^|[\\/])\.DS_Store$/.test(rel) || rel.endsWith("~")) return;
        scheduleWatchEmit(rel);
      });
      w.on("error", () => {
        if (gen !== watcherGen) return;
        try {
          w.close();
        } catch {
        }
        if (watcher === w) watcher = null;
        if (!retried) {
          retried = true;
          attach(false);
        }
      });
      watcher = w;
    } catch {
      if (!retried) {
        retried = true;
        attach(false);
      }
    }
  };
  attach(true);
}
function syncWatcher() {
  if (staticServer && staticRoot) {
    startWatcher(staticRoot);
    return;
  }
  if (dev && dev.child && dev.workspace) {
    startWatcher(dev.workspace);
    return;
  }
  stopWatcher();
}
async function detectTargets(workspace) {
  const ws = path3.resolve(workspace.trim());
  const out = [];
  try {
    const raw = await fs3.readFile(path3.join(ws, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    const script = pickDevScript(pkg);
    if (script) out.push({ kind: "dev", label: `npm run ${script}`, dir: ws });
  } catch {
  }
  try {
    const py = await detectPythonRun(ws);
    if (py) out.push({ kind: "dev", label: py.label, dir: ws, runtime: "python" });
  } catch {
  }
  try {
    const st = await fs3.stat(path3.join(ws, "go.mod"));
    if (st.isFile()) out.push({ kind: "dev", label: "go run .", dir: ws, runtime: "go" });
  } catch {
  }
  try {
    const s = getSettings();
    const cc = (s.preview?.customCommand ?? "").trim();
    if (cc) out.push({ kind: "dev", label: cc, dir: ws, runtime: "custom" });
  } catch {
  }
  for (const name of ["dist", "build", "out", "public"]) {
    try {
      const st = await fs3.stat(path3.join(ws, name, "index.html"));
      if (st.isFile()) out.push({ kind: "static", label: `${name}/`, dir: path3.join(ws, name) });
    } catch {
    }
  }
  try {
    const st = await fs3.stat(path3.join(ws, "index.html"));
    if (st.isFile()) out.push({ kind: "file", label: "index.html", dir: path3.join(ws, "index.html") });
  } catch {
  }
  if (out.length === 0) {
    out.push({ kind: "static", label: "folder \u2014 built-in static server", dir: ws });
  }
  const artifacts = [];
  const scanDirs = [ws, ...ARTIFACT_DIRS.map((d) => path3.join(ws, d))];
  for (const dir of scanDirs) {
    let names;
    try {
      names = await fs3.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!isPreviewableArtifact(name)) continue;
      const full = path3.join(dir, name);
      try {
        const st = await fs3.lstat(full);
        if (st.isFile()) artifacts.push({ file: full, mtimeMs: st.mtimeMs });
      } catch {
      }
    }
  }
  artifacts.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const a of artifacts) {
    if (out.length >= 6) break;
    const info = ARTIFACT_TYPES[path3.extname(a.file).toLowerCase()];
    out.push({
      kind: "artifact",
      label: `${path3.basename(a.file)} \u2014 ${info?.label ?? "FILE"}`,
      dir: a.file
    });
  }
  return out.slice(0, 6);
}
function shutdownAll() {
  try {
    devStop();
  } catch {
  }
  try {
    staticStop();
  } catch {
  }
}
var emitEvent, MIME, RAW_MIME, ARTIFACT_TYPES, VIEWER_ROUTE, RAW_ROUTE, ARTIFACT_DIRS, VIEWER_CSS, VIEWER_JS, staticServer, staticRoot, staticUrl, AUTO_SKIP_DIRS, DEV_LOG_LINES, ANSI_RE, LineBuffer, dev, POSITIVE_URL_SIGNAL, NEGATIVE_URL_SIGNAL, FRAMEWORKS, pythonBinCache, portPoll, startCap, AGENT_URLS_CAP, AGENT_URL_SCAN_CHARS, SCAN_PORTS, WATCH_DEBOUNCE_MS, WATCH_IGNORE, watcher, watchRoot, watcherGen, watchTimer;
var init_previewService = __esm({
  "electron/services/previewService.ts"() {
    init_storeService();
    init_processService();
    emitEvent = null;
    MIME = {
      ".html": "text/html; charset=utf-8",
      ".htm": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".mjs": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".map": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".avif": "image/avif",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".otf": "font/otf",
      ".txt": "text/plain; charset=utf-8",
      ".md": "text/plain; charset=utf-8",
      ".xml": "application/xml; charset=utf-8",
      ".pdf": "application/pdf",
      ".wasm": "application/wasm",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
      ".bmp": "image/bmp",
      ".csv": "text/csv; charset=utf-8",
      ".log": "text/plain; charset=utf-8",
      ".markdown": "text/markdown; charset=utf-8"
    };
    RAW_MIME = {
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".bmp": "image/bmp",
      ".ico": "image/x-icon",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
      ".json": "application/json; charset=utf-8",
      ".xml": "application/xml; charset=utf-8",
      ".csv": "text/csv; charset=utf-8"
    };
    ARTIFACT_TYPES = {
      ".pdf": { kind: "pdf", label: "PDF" },
      ".png": { kind: "image", label: "IMAGE" },
      ".jpg": { kind: "image", label: "IMAGE" },
      ".jpeg": { kind: "image", label: "IMAGE" },
      ".gif": { kind: "image", label: "IMAGE" },
      ".webp": { kind: "image", label: "IMAGE" },
      ".svg": { kind: "image", label: "IMAGE" },
      ".bmp": { kind: "image", label: "IMAGE" },
      ".ico": { kind: "image", label: "IMAGE" },
      ".mp4": { kind: "video", label: "VIDEO" },
      ".webm": { kind: "video", label: "VIDEO" },
      ".mp3": { kind: "audio", label: "AUDIO" },
      ".wav": { kind: "audio", label: "AUDIO" },
      ".ogg": { kind: "audio", label: "AUDIO" },
      ".md": { kind: "markdown", label: "MARKDOWN" },
      ".markdown": { kind: "markdown", label: "MARKDOWN" },
      ".txt": { kind: "text", label: "TEXT" },
      ".json": { kind: "text", label: "TEXT" },
      ".xml": { kind: "text", label: "TEXT" },
      ".csv": { kind: "text", label: "TEXT" },
      ".log": { kind: "text", label: "TEXT" },
      ".js": { kind: "code", label: "CODE" },
      ".ts": { kind: "code", label: "CODE" },
      ".tsx": { kind: "code", label: "CODE" },
      ".jsx": { kind: "code", label: "CODE" },
      ".py": { kind: "code", label: "CODE" },
      ".rs": { kind: "code", label: "CODE" },
      ".go": { kind: "code", label: "CODE" },
      ".java": { kind: "code", label: "CODE" },
      ".c": { kind: "code", label: "CODE" },
      ".cpp": { kind: "code", label: "CODE" },
      ".h": { kind: "code", label: "CODE" },
      ".css": { kind: "code", label: "CODE" }
    };
    VIEWER_ROUTE = "/__surnia/view";
    RAW_ROUTE = "/__surnia/raw/";
    ARTIFACT_DIRS = ["reports", "docs", "dist", "out", "assets", "exports"];
    VIEWER_CSS = `
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:#141414;color:#d4d4d4;font:13px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;display:flex;flex-direction:column;height:100vh;overflow:hidden}
.vbar{flex:0 0 auto;display:flex;align-items:center;gap:10px;height:34px;padding:0 12px;background:#1c1c1c;border-bottom:1px solid #2a2a2a;color:#8a8a8a;font-size:12px}
.vname{color:#e8e8e8;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vmeta{margin-left:auto;flex:0 0 auto;text-transform:uppercase;letter-spacing:.06em;font-size:10px}
#stage{flex:1;min-height:0;position:relative;overflow:auto}
.fill{width:100%;height:100%;border:0;display:block}
iframe.fill{background:#fafafa}
.checker{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px;background-color:#181818;background-image:linear-gradient(45deg,#222 25%,transparent 25%,transparent 75%,#222 75%),linear-gradient(45deg,#222 25%,transparent 25%,transparent 75%,#222 75%);background-size:24px 24px;background-position:0 0,12px 12px}
.checker img{max-width:100%;max-height:calc(100vh - 82px);object-fit:contain;box-shadow:0 4px 24px rgba(0,0,0,.5);background:#fff}
.media{height:100%;display:flex;align-items:center;justify-content:center;padding:16px}
.media video{max-width:100%;max-height:100%;outline:none}
.audio-box{display:flex;flex-direction:column;align-items:center;gap:12px;padding:28px 34px;background:#1c1c1c;border:1px solid #2a2a2a;border-radius:8px}
.audio-name{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#bdbdbd;max-width:60ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prewrap{height:100%;overflow:auto}
pre.vpre{margin:0;padding:16px 20px;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#d6d6d6;white-space:pre-wrap;word-break:break-word;tab-size:4}
.clipnote{padding:10px 20px;color:#8a8a8a;font-size:11px;border-top:1px solid #2a2a2a}
.vfail{padding:40px;color:#9a9a9a;font-size:13px}
/* markdown (GitHub-ish, dark) */
.md{max-width:800px;margin:0 auto;padding:30px 28px 64px;color:#d6d6d6;font-size:15px;line-height:1.65;overflow-wrap:break-word}
.md h1,.md h2,.md h3,.md h4,.md h5,.md h6{color:#f0f0f0;line-height:1.3;margin:1.4em 0 .5em;font-weight:600}
.md h1{font-size:1.9em;border-bottom:1px solid #2e2e2e;padding-bottom:.3em;margin-top:.2em}
.md h2{font-size:1.45em;border-bottom:1px solid #2e2e2e;padding-bottom:.25em}
.md h3{font-size:1.2em}.md h4{font-size:1.05em}.md h5{font-size:.95em}.md h6{font-size:.88em;color:#a8a8a8}
.md p{margin:.85em 0}
.md a,.md .md-link{color:#6cb2ff;text-decoration:underline;cursor:pointer}
.md code{background:#242424;border:1px solid #333;border-radius:3px;padding:1px 5px;font:12.5px ui-monospace,Menlo,Consolas,monospace}
.md pre{background:#1b1b1b;border:1px solid #2e2e2e;border-radius:6px;padding:12px 14px;overflow:auto}
.md pre code{background:none;border:0;padding:0;font-size:12.5px}
.md blockquote{border-left:3px solid #3a3a3a;margin:12px 0;padding:2px 14px;color:#9a9a9a}
.md ul,.md ol{margin:.7em 0;padding-left:1.6em}
.md li{margin:.25em 0}
.md table{border-collapse:collapse;margin:14px 0;max-width:100%}
.md th,.md td{border:1px solid #333;padding:5px 10px;text-align:left}
.md th{background:#1c1c1c}
.md hr{border:0;border-top:1px solid #2e2e2e;margin:22px 0}
.md img{max-width:100%;border-radius:4px}
/* code tokens */
.tok-c{color:#6a9955;font-style:italic}
.tok-s{color:#ce9178}
.tok-k{color:#569cd6}
.tok-n{color:#b5cea8}
`.trim();
    VIEWER_JS = String.raw`(function () {
  'use strict';
  var cfg = window.__SUR__ || {};
  var stage = document.getElementById('stage');
  if (!stage) return;
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;';
    });
  }
  function fail(msg) { stage.innerHTML = '<div class="vfail">' + esc(msg) + '</div>'; }
  var MAX_TEXT = 2 * 1024 * 1024; // do not build a 50MB <pre>

  // ---------- tiny markdown renderer (escape FIRST — file HTML never runs) ----------
  function mdInline(text) {
    var s = esc(text);
    var codeSpans = [];
    s = s.replace(/\x60([^\x60\n]+)\x60/g, function (m, code) {
      codeSpans.push('<code>' + code + '</code>');
      return '\x00' + (codeSpans.length - 1) + '\x00';
    });
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, alt, url) {
      // un-escape the attribute text, resolve relative URLs against the raw
      // route (the page lives under /__surnia/view), then re-escape for src
      var u = url.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      if (!/^(https?:|data:|\/\/)/i.test(u)) u = (cfg.base || '/') + u.replace(/^\.\//, '');
      return '<img alt="' + alt + '" src="' + esc(u) + '" loading="lazy" />';
    });
    // links are NON-NAVIGATING by design: no href, target kept as a tooltip
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, txt, url) {
      return '<a class="md-link" title="' + url + '">' + txt + '</a>';
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
    s = s.replace(/\x00(\d+)\x00/g, function (m, i) { return codeSpans[+i] || m; });
    return s;
  }
  function renderMarkdown(src) {
    var lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    var out = [], para = [], i = 0;
    function flushPara() { if (para.length) { out.push('<p>' + mdInline(para.join(' ')) + '</p>'); para = []; } }
    function splitRow(row) {
      return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return mdInline(c.trim()); });
    }
    while (i < lines.length) {
      var line = lines[i];
      var fence = line.match(/^\s{0,3}(\x60\x60\x60+|~~~+)\s*\S*\s*$/);
      if (fence) {
        flushPara();
        var closer = fence[1].charAt(0) === '~' ? '~~~' : '\x60\x60\x60';
        var buf = [];
        i++;
        while (i < lines.length && !(new RegExp('^\\s{0,3}' + closer + '+\\s*$')).test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // skip the closing fence (or run off the end)
        out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }
      if (!line.trim()) { flushPara(); i++; continue; }
      var h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (h) { flushPara(); var lvl = h[1].length; out.push('<h' + lvl + '>' + mdInline(h[2]) + '</h' + lvl + '>'); i++; continue; }
      if (/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/.test(line)) { flushPara(); out.push('<hr />'); i++; continue; }
      if (/^\s{0,3}>/.test(line)) {
        flushPara();
        var q = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) { q.push(lines[i].replace(/^\s{0,3}>\s?/, '')); i++; }
        out.push('<blockquote>' + renderMarkdown(q.join('\n')) + '</blockquote>');
        continue;
      }
      if (line.indexOf('|') >= 0 && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].indexOf('|') >= 0) {
        flushPara();
        var head = splitRow(line);
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim()) { rows.push(splitRow(lines[i])); i++; }
        var t = '<table><thead><tr>' + head.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead>';
        if (rows.length) t += '<tbody>' + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody>';
        out.push(t + '</table>');
        continue;
      }
      if (/^\s{0,3}[-*+]\s+/.test(line)) {
        flushPara();
        var items = [];
        while (i < lines.length && /^\s{0,3}[-*+]\s+/.test(lines[i])) { items.push('<li>' + mdInline(lines[i].replace(/^\s{0,3}[-*+]\s+/, '')) + '</li>'); i++; }
        out.push('<ul>' + items.join('') + '</ul>');
        continue;
      }
      if (/^\s{0,3}\d+[.)]\s+/.test(line)) {
        flushPara();
        var oitems = [];
        while (i < lines.length && /^\s{0,3}\d+[.)]\s+/.test(lines[i])) { oitems.push('<li>' + mdInline(lines[i].replace(/^\s{0,3}\d+[.)]\s+/, '')) + '</li>'); i++; }
        out.push('<ol>' + oitems.join('') + '</ol>');
        continue;
      }
      para.push(line.trim());
      i++;
    }
    flushPara();
    return out.join('\n');
  }

  // ---------- tiny code highlighter (regex-safe, never throws on odd input) ----------
  var KEYWORDS = {
    js: 'var let const function return if else for while do class new import export from default async await try catch finally throw typeof instanceof extends super switch case break continue this null undefined true false delete void yield static get set of in interface type enum implements public private protected readonly as namespace declare keyof abstract satisfies',
    py: 'def return if elif else for while class import from as with try except finally raise lambda None True False async await yield global nonlocal pass break continue in is not and or assert del match case self',
    rs: 'fn let mut pub use mod struct enum impl trait const static if else match loop while for return crate self Self where async move ref dyn unsafe as in break continue type',
    go: 'func package import var const type struct interface map chan go defer if else for range return switch case default break continue select fallthrough nil true false make new len cap',
    c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while class public private protected virtual override namespace using template typename new delete this nullptr bool true false catch throw try final abstract implements extends',
    css: 'media import keyframes font-face supports page root from to and not only print screen hover focus before after'
  };
  var RE_SLASH = /(\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*)|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|\x60(?:\\.|[^\x60\\])*\x60?)|\b(0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?)\b|\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
  var RE_HASH = /(\/\*[\s\S]*?(?:\*\/|$)|#[^\n]*)|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|\x60(?:\\.|[^\x60\\])*\x60?)|\b(0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?)\b|\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
  var FAMILY = { ts: 'js', tsx: 'js', jsx: 'js', mjs: 'js', java: 'c', cpp: 'c', h: 'c' };
  function highlight(src, ext) {
    try {
      var family = FAMILY[ext] || ext;
      var kwText = KEYWORDS[family] || '';
      var kw = new Set(kwText ? kwText.split(' ') : []);
      var re = ext === 'py' ? RE_HASH : RE_SLASH;
      re.lastIndex = 0;
      var out = '', last = 0, m;
      while ((m = re.exec(src)) !== null) {
        if (m.index > last) out += esc(src.slice(last, m.index));
        if (m[1] !== undefined) out += '<span class="tok-c">' + esc(m[0]) + '</span>';
        else if (m[2] !== undefined) out += '<span class="tok-s">' + esc(m[0]) + '</span>';
        else if (m[3] !== undefined) out += '<span class="tok-n">' + esc(m[0]) + '</span>';
        else out += kw.has(m[4]) ? '<span class="tok-k">' + esc(m[0]) + '</span>' : esc(m[0]);
        last = m.index + m[0].length;
        if (m[0].length === 0) { re.lastIndex++; if (re.lastIndex > src.length) break; } // zero-width guard
      }
      out += esc(src.slice(last));
      return out;
    } catch (e) { return esc(src); } // weird input → plain escaped text
  }

  // ---------- boot per artifact kind ----------
  var TEXT_KINDS = { markdown: 1, text: 1, code: 1 };
  if (!TEXT_KINDS[cfg.kind]) return; // pdf/image/media markup is already in the page
  fetch(cfg.raw, { credentials: 'omit' }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }).then(function (text) {
    var clipped = text.length > MAX_TEXT;
    if (clipped) text = text.slice(0, MAX_TEXT);
    if (cfg.kind === 'markdown') {
      stage.innerHTML = '<article class="md">' + renderMarkdown(text) + '</article>';
    } else if (cfg.kind === 'code') {
      stage.innerHTML = '<div class="prewrap"><pre class="vpre"><code>' + highlight(text, cfg.ext) + '</code></pre></div>';
    } else {
      var body = esc(text);
      if (cfg.ext === 'json') {
        try { body = esc(JSON.stringify(JSON.parse(text), null, 2)); } catch (e) { /* keep raw text */ }
      }
      stage.innerHTML = '<div class="prewrap"><pre class="vpre">' + body + '</pre></div>';
    }
    if (clipped) stage.insertAdjacentHTML('beforeend', '<div class="clipnote">— file truncated for preview (first 2 MB) —</div>');
  }).catch(function (err) {
    fail('Could not load the file: ' + (err && err.message ? err.message : err));
  });
})();`;
    staticServer = null;
    staticRoot = "";
    staticUrl = "";
    AUTO_SKIP_DIRS = /* @__PURE__ */ new Set([
      "node_modules",
      ".git",
      ".surnia",
      ".cache",
      "coverage",
      ".vscode",
      ".idea",
      "vendor",
      "__pycache__"
    ]);
    DEV_LOG_LINES = 240;
    ANSI_RE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[()#][0-9A-Za-z]?|[=>]|[M-Z])/g;
    LineBuffer = class {
      rest = "";
      push(chunk) {
        this.rest += String(chunk ?? "");
        const parts = this.rest.split(/\r\n|\n|\r/);
        this.rest = parts.pop() ?? "";
        return parts;
      }
      flush() {
        if (!this.rest) return [];
        const out = [this.rest];
        this.rest = "";
        return out;
      }
    };
    dev = null;
    POSITIVE_URL_SIGNAL = /\b(listen(?:ing)?|ready|start(?:ed|ing)?|serv(?:ing|er)|running|local|network|open(?:ed)?|accepting|available|live|up)\b/i;
    NEGATIVE_URL_SIGNAL = /\b(error|fail(?:ed|ure)?|refused|eaddrinuse|in use|already in use|occupied|cannot|could not|unable|exited|crash(?:ed)?|fatal|denied|invalid|stopped)\b/i;
    FRAMEWORKS = [
      { id: "angular", configs: ["angular.json"], deps: ["@angular/core", "@angular/cli"], port: 4200 },
      { id: "astro", configs: ["astro.config.mjs", "astro.config.js", "astro.config.ts"], deps: ["astro"], port: 4321 },
      { id: "next", configs: ["next.config.js", "next.config.mjs", "next.config.ts"], deps: ["next"], port: 3e3 },
      { id: "nuxt", configs: ["nuxt.config.ts", "nuxt.config.js"], deps: ["nuxt", "nuxt3", "nuxt-nightly"], port: 3e3 },
      {
        id: "svelte-kit",
        configs: ["svelte.config.js", "svelte.config.ts"],
        deps: ["@sveltejs/kit", "@sveltejs/vite-plugin-svelte"],
        port: 5173
      },
      {
        id: "expo",
        configs: ["app.json", "app.config.js", "app.config.ts"],
        deps: ["expo", "expo-status-bar"],
        port: 8081
      },
      { id: "vite", configs: ["vite.config.js", "vite.config.ts", "vite.config.mjs", "vite.config.mts"], deps: ["vite"], port: 5173 },
      { id: "cra", configs: [], deps: ["react-scripts"], port: 3e3 }
    ];
    portPoll = null;
    startCap = null;
    AGENT_URLS_CAP = 6;
    AGENT_URL_SCAN_CHARS = 8e3;
    SCAN_PORTS = [
      3e3,
      3001,
      3002,
      4200,
      4321,
      5e3,
      5173,
      5174,
      5175,
      8e3,
      8080,
      8081,
      8888,
      1420,
      19e3,
      19006,
      1234,
      7e3,
      9e3
    ];
    WATCH_DEBOUNCE_MS = 400;
    WATCH_IGNORE = /(^|[\\/])(node_modules|\.git)([\\/]|$)/;
    watcher = null;
    watchRoot = "";
    watcherGen = 0;
    watchTimer = null;
    process.once("exit", () => {
      try {
        const child = dev?.child;
        if (child?.pid) {
          if (process.platform === "win32") {
            try {
              spawn2("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
            } catch {
            }
          } else {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              try {
                child.kill("SIGKILL");
              } catch {
              }
            }
          }
        }
      } catch {
      }
      try {
        staticServer?.close();
      } catch {
      }
    });
  }
});
init_previewService();
export {
  LineBuffer,
  autoPreview,
  containsPath,
  detectPythonRun,
  detectTargets,
  detectUrl,
  devStart,
  devStatus,
  devStop,
  findPreviewEntry,
  parsePortFlag,
  sanitizeLogLine,
  scanPorts,
  setPreviewEventEmitter,
  shutdownAll,
  staticStart,
  staticStatus,
  staticStop,
  verifyPreviewUrl,
  waitForDevUrl
};
