// ============================================================
// Surnia — Live Preview service (node-only, CLI-safe)
// 1. staticStart(dirOrFile) → serve a static site (root, dist,
//    build, out, public) OR a single file. index.html is opened
//    directly; ANY other previewable artifact (pdf, image, audio/
//    video, markdown, text/json/... and common code files) gets a
//    generated full-screen viewer page: GET /__surnia/view?src=<rel>
//    fetches the bytes via GET /__surnia/raw/<rel> (loopback-only,
//    realpath-contained, nosniff). Preferred port with automatic
//    free-port fallback.
// 2. devStart(ws)     → run the project's dev script, auto-detect
//    framework (vite/next/nuxt/angular/svelte-kit/astro/expo/cra),
//    parse --port/-p flags, read the URL from output AND poll the
//    expected framework port as a fallback. devStatus() also carries
//    `agentUrls`: localhost URLs harvested from agent-started
//    background processes (processService), so the panel can offer
//    servers it did not start itself.
// 3. scan()           → probe common dev ports for running servers
// 4. detectTargets(ws)→ candidate preview sources for the renderer
//    (dev / static / file / artifact — see PreviewTarget)
// 5. File watcher     → while serving, watches the served root
//    (debounced, node_modules/.git ignored) and emits {kind:'watch'}
//    so the renderer reloads the webview. Retries once (non-recursive)
//    if the recursive watcher fails; never crashes.
// The renderer gets push updates through the event emitter wired by ipc.ts.
// ============================================================
import { createServer, request as httpRequest, type Server, type ServerResponse } from 'node:http';
import { createConnection } from 'node:net';
import { promises as fs } from 'node:fs';
import { watch as fsWatch, type FSWatcher } from 'node:fs';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as path from 'node:path';
import type { PreviewStartResult } from '../../shared/types';
import { getSettings } from './storeService';
// Agent-started servers: the background process service harvests localhost
// URLs from long-lived processes ("npm run dev" via run_background). Imported
// here ONLY so preview status can surface them to the panel — the service is
// Electron-free and CLI-safe, same as this one.
import { list as listBackgroundProcesses, tail as readBackgroundTail } from './processService';

// ---------- shared types (from shared/types.ts) ----------
export type { PreviewStartResult };
export interface PreviewDevStatus {
  running: boolean;
  state: 'idle' | 'starting' | 'ready' | 'stopped' | 'error';
  url?: string;
  script?: string;
  lines: string[];
  startedAt?: number;
  /**
   * Up to 6 localhost URLs harvested from agent-started background processes
   * (run_background). Passed through verbatim by the ipc status composer —
   * purely additive, every existing consumer keeps working.
   */
  agentUrls?: string[];
  /** v8: per-source cwd — lets the renderer keep the preview pinned to the ACTIVE workspace (fix: preview stuck on the oldest session). */
  agentSources?: Array<{ url: string; cwd: string; id: string; command: string }>;
}
export interface PreviewEvent {
  kind: 'static' | 'dev' | 'watch' | 'log';
  state?: 'starting' | 'ready' | 'stopped' | 'error';
  url?: string;
  error?: string;
  lines?: string[];
  path?: string;
  level?: string;
  text?: string;
  /** v8: workspace this event belongs to — the renderer ignores previews of other sessions. */
  ws?: string;
}
/**
 * Candidate preview source reported by detectTargets().
 * `artifact` = a single non-HTML file (pdf/image/media/md/text/code) that the
 * static server can present through its generated viewer page. `dir` holds the
 * absolute FILE path for artifacts and single-file entries, the directory for
 * dev/static targets (unchanged shape — consumers only switch on kind).
 */
export interface PreviewTarget {
  kind: 'dev' | 'static' | 'file' | 'artifact';
  label: string;
  dir?: string;
  /** v10.3 — which runtime starts this dev target (drives the launcher). */
  runtime?: 'python' | 'custom' | 'go';
}

// ---------- event emitter (wired by ipc.ts) ----------
let emitEvent: ((e: PreviewEvent) => void) | null = null;
export function setPreviewEventEmitter(cb: ((e: PreviewEvent) => void) | null): void {
  emitEvent = cb;
}
function emit(e: PreviewEvent): void {
  try {
    emitEvent?.(e);
  } catch {
    /* renderer gone */
  }
}

// ---------- free port ----------
/**
 * Bind the REAL server directly, retrying upward on EADDRINUSE (40 ports).
 * The old getFreePort() bound a throwaway socket, closed it, then rebound the
 * real one — a textbook TOCTOU race that could fail right after reporting the
 * chosen port. This also removes one needless socket per preview start.
 */
function listenOnPreferred(server: Server, preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = Number.isInteger(preferred) && preferred > 0 && preferred <= 65535 ? preferred : 4173;
    const ceiling = Math.min(65535, port + 40);
    const attempt = (): void => {
      const onError = (err: NodeJS.ErrnoException): void => {
        server.removeListener('listening', onListening);
        if (err.code === 'EADDRINUSE' && port < ceiling) {
          port += 1;
          attempt();
          return;
        }
        reject(err);
      };
      const onListening = (): void => {
        server.removeListener('error', onError);
        resolve((server.address() as { port: number }).port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    };
    attempt();
  });
}

// ============================================================
// 1. Static site / single-file server
// ============================================================
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.bmp': 'image/bmp',
  '.csv': 'text/csv; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
};

/**
 * MIME for the /__surnia/raw/<rel> route (the viewer's file fetcher).
 * Everything not listed here — md/text/code — is served as text/plain so
 * `X-Content-Type-Options: nosniff` keeps it inert even if a file contains
 * markup or script (the viewer renders it as text itself).
 */
const RAW_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

// ============================================================
// 1b. Universal artifact viewer — ANY single file can be a target
// ============================================================
export type ArtifactKind = 'pdf' | 'image' | 'video' | 'audio' | 'markdown' | 'text' | 'code';

/** Every extension the static server can present through its viewer page. */
const ARTIFACT_TYPES: Record<string, { kind: ArtifactKind; label: string }> = {
  '.pdf': { kind: 'pdf', label: 'PDF' },
  '.png': { kind: 'image', label: 'IMAGE' },
  '.jpg': { kind: 'image', label: 'IMAGE' },
  '.jpeg': { kind: 'image', label: 'IMAGE' },
  '.gif': { kind: 'image', label: 'IMAGE' },
  '.webp': { kind: 'image', label: 'IMAGE' },
  '.svg': { kind: 'image', label: 'IMAGE' },
  '.bmp': { kind: 'image', label: 'IMAGE' },
  '.ico': { kind: 'image', label: 'IMAGE' },
  '.mp4': { kind: 'video', label: 'VIDEO' },
  '.webm': { kind: 'video', label: 'VIDEO' },
  '.mp3': { kind: 'audio', label: 'AUDIO' },
  '.wav': { kind: 'audio', label: 'AUDIO' },
  '.ogg': { kind: 'audio', label: 'AUDIO' },
  '.md': { kind: 'markdown', label: 'MARKDOWN' },
  '.markdown': { kind: 'markdown', label: 'MARKDOWN' },
  '.txt': { kind: 'text', label: 'TEXT' },
  '.json': { kind: 'text', label: 'TEXT' },
  '.xml': { kind: 'text', label: 'TEXT' },
  '.csv': { kind: 'text', label: 'TEXT' },
  '.log': { kind: 'text', label: 'TEXT' },
  '.js': { kind: 'code', label: 'CODE' },
  '.ts': { kind: 'code', label: 'CODE' },
  '.tsx': { kind: 'code', label: 'CODE' },
  '.jsx': { kind: 'code', label: 'CODE' },
  '.py': { kind: 'code', label: 'CODE' },
  '.rs': { kind: 'code', label: 'CODE' },
  '.go': { kind: 'code', label: 'CODE' },
  '.java': { kind: 'code', label: 'CODE' },
  '.c': { kind: 'code', label: 'CODE' },
  '.cpp': { kind: 'code', label: 'CODE' },
  '.h': { kind: 'code', label: 'CODE' },
  '.css': { kind: 'code', label: 'CODE' },
};

/** Synthetic routes served alongside the static site. */
const VIEWER_ROUTE = '/__surnia/view'; // GET /__surnia/view?src=<relative path>
const RAW_ROUTE = '/__surnia/raw/'; // GET /__surnia/raw/<relative path>

/** Directories scanned by detectTargets() for previewable artifacts. */
const ARTIFACT_DIRS = ['reports', 'docs', 'dist', 'out', 'assets', 'exports'];

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

/** Embed a value into a <script> block safely (`</` can never appear). */
function jsJson(v: unknown): string {
  return (JSON.stringify(v ?? null) ?? 'null')
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function humanSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '?';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${units[u]}`;
}

function isPreviewableArtifact(name: string): boolean {
  return ARTIFACT_TYPES[path.extname(name).toLowerCase()] !== undefined;
}

/**
 * Resolve `rel` (a request path or query param) to a real file strictly inside
 * `root`. Same containment policy as the main static path: normalize + strip
 * leading .., path.relative containment, then realpath containment so a
 * planted symlink cannot escape. Returns null for anything questionable.
 */
async function resolveContained(rootDir: string, rel: string): Promise<string | null> {
  try {
    let p = path.normalize(rel).replace(/^([.][.][/\\])+/, '');
    if (p === '/' || p === '\\' || p === '') return null;
    const file = path.join(rootDir, p);
    if (!containsPath(rootDir, file)) return null;
    const st = await fs.stat(file);
    if (!st.isFile()) return null;
    const real = await fs.realpath(file);
    if (!containsPath(rootDir, real)) return null;
    return real;
  } catch {
    return null;
  }
}

/** Serve the raw bytes of a workspace file with a correct, sniff-proof MIME. */
async function serveRawFile(res: ServerResponse, rootDir: string, rel: string): Promise<void> {
  try {
    const file = await resolveContained(rootDir, rel);
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' });
      res.end('not found');
      return;
    }
    const buf = await fs.readFile(file);
    res.writeHead(200, {
      'content-type': RAW_MIME[path.extname(file).toLowerCase()] ?? 'text/plain; charset=utf-8',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(buf);
  } catch {
    try {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' });
      res.end('not found');
    } catch {
      /* socket already gone */
    }
  }
}

/**
 * Serve the generated VIEWER page for one workspace file. Non-artifact files
 * (e.g. an .html referenced here) fall through to the raw bytes, so the route
 * is always "something sensible or a 404", never a hang.
 */
async function serveViewer(res: ServerResponse, rootDir: string, srcParam: string): Promise<void> {
  try {
    const file = await resolveContained(rootDir, srcParam);
    if (!file) {
      res.writeHead(404, {
        'content-type': 'text/html; charset=utf-8',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      });
      res.end('<!doctype html><meta charset="utf-8"><body style="background:#141414;color:#9a9a9a;font:13px sans-serif;display:grid;place-items:center;height:100vh;margin:0">File not found in the preview workspace.</body>');
      return;
    }
    const st = await fs.stat(file);
    if (!ARTIFACT_TYPES[path.extname(file).toLowerCase()]) {
      await serveRawFile(res, rootDir, srcParam);
      return;
    }
    // Raw URL for the viewer's fetcher: each path segment percent-encoded.
    const relFromRoot = path.relative(rootDir, file).split(path.sep).map(encodeURIComponent).join('/');
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(buildViewerHtml(file, st.size, `${RAW_ROUTE}${relFromRoot}`));
  } catch {
    try {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' });
      res.end('viewer error');
    } catch {
      /* socket already gone */
    }
  }
}

/* ---------- viewer page chrome (all CSS inlined here on purpose) ---------- */
const VIEWER_CSS = `
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

/* ---------- viewer client script (vanilla JS, no dependencies) ---------- */
const VIEWER_JS = String.raw`(function () {
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

/**
 * Build the full-screen viewer page for a single artifact file.
 * Every file-derived string is escaped or JSON-embedded — the page chrome can
 * never be injected from the file system.
 */
function buildViewerHtml(file: string, size: number, rawUrl: string): string {
  const ext = path.extname(file).toLowerCase();
  const art = ARTIFACT_TYPES[ext] ?? { kind: 'text' as ArtifactKind, label: 'FILE' };
  const name = path.basename(file);
  const nameEsc = escapeHtml(name);
  const rawEsc = escapeHtml(rawUrl);
  const cfg = { kind: art.kind, ext: ext.slice(1), raw: rawUrl, name, base: rawUrl.slice(0, rawUrl.lastIndexOf('/') + 1) };
  let stage: string;
  switch (art.kind) {
    case 'pdf':
      // Chromium (and the preview webview) renders PDFs natively.
      stage = `<iframe class="fill" src="${rawEsc}" title="${nameEsc}"></iframe>`;
      break;
    case 'image':
      stage = `<div class="checker"><img src="${rawEsc}" alt="${nameEsc}" /></div>`;
      break;
    case 'video':
      stage = `<div class="media"><video controls playsinline preload="metadata" src="${rawEsc}"></video></div>`;
      break;
    case 'audio':
      stage = `<div class="media"><div class="audio-box"><div class="audio-name">${nameEsc}</div><audio controls preload="metadata" src="${rawEsc}"></audio></div></div>`;
      break;
    default:
      // markdown / text / code are fetched + rendered client-side
      stage = '';
      break;
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${nameEsc} — preview</title>
<style>${VIEWER_CSS}</style>
</head>
<body>
<header class="vbar"><span class="vname">${nameEsc}</span><span class="vmeta">${art.label} · ${humanSize(size)}</span></header>
<main id="stage">${stage}</main>
<script>window.__SUR__ = ${jsJson(cfg)};</script>
<script>${VIEWER_JS}</script>
</body>
</html>`;
}

let staticServer: Server | null = null;
let staticRoot = '';
let staticUrl = '';
/**
 * Containment test used by the static file server: `target` must resolve
 * strictly inside `root`. Uses path.relative (NOT startsWith — the prefix
 * check wrongly accepted siblings: root /srv/app matched /srv/app2/...).
 */
export function containsPath(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Find the best directory to serve: dir itself, dist/, build/, out/ or public/. */
async function pickStaticRoot(dir: string): Promise<string | null> {
  const candidates = [
    dir,
    path.join(dir, 'dist'),
    path.join(dir, 'build'),
    path.join(dir, 'out'),
    path.join(dir, 'public'),
  ];
  for (const c of candidates) {
    try {
      const st = await fs.stat(path.join(c, 'index.html'));
      if (st.isFile()) return c;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * Serve a static site. Accepts a directory (root / dist / build / out / public
 * with an index.html) or a SINGLE FILE:
 *  · .html/.htm → served and opened directly (parent dir is the root);
 *  · any other previewable artifact (pdf, image, audio/video, md,
 *    txt/json/xml/csv/log, common code files) → the parent directory is
 *    served and the entry URL is the generated viewer page
 *    (`/__surnia/view?src=<file>`).
 * `preferredPort` is honored with an automatic upward scan when busy;
 * 0/undefined uses the default 4173.
 */
/**
 * v11.11 (A3) — generated directory listing for folders without an index.html:
 * the universal “any language previews something” guarantee (python scripts
 * that only wrote files, go binaries, raw exports…). Subdirectories are listed
 * too (a trailing-slash URL = listing request). HTML files and previewable
 * artifacts link directly; everything else opens through the safe viewer route.
 */
async function serveDirListing(res: ServerResponse, rootDir: string, urlPath: string): Promise<void> {
  try {
    const rel = urlPath.replace(/^\/+/, '').replace(/\/+$/, '');
    const absDir = rel ? path.join(rootDir, rel) : rootDir;
    if (!containsPath(rootDir, absDir)) throw new Error('outside root');
    // A symlinked subdirectory inside the root must not leak names from outside
    // the served tree — re-check containment on the real path before listing.
    const realDir = await fs.realpath(absDir);
    if (!containsPath(rootDir, realDir)) throw new Error('outside root');
    const names = (await fs.readdir(absDir)).filter((n) => n !== '.DS_Store').sort((a, b) => a.localeCompare(b));
    const rows: string[] = [];
    for (const n of names) {
      let isDir = false;
      let size = '';
      try {
        const st = await fs.stat(path.join(absDir, n));
        isDir = st.isDirectory();
        if (!isDir) size = humanSize(st.size);
      } catch {
        /* vanished between readdir and stat */
      }
      const relN = rel ? `${rel}/${n}` : n;
      const enc = relN.split('/').map(encodeURIComponent).join('/');
      const href = isDir
        ? `/${enc}/`
        : /\.html?$/i.test(n) || isPreviewableArtifact(n)
          ? `/${enc}`
          : `${VIEWER_ROUTE}?src=${encodeURIComponent(relN)}`;
      rows.push(
        `<tr><td><a href="${escapeHtml(href)}">${isDir ? '[dir] ' : ''}${escapeHtml(n)}</a></td>` +
          `<td class="sz">${isDir ? 'DIR' : escapeHtml(size)}</td></tr>`,
      );
    }
    const title = `Index of /${escapeHtml(rel)}`;
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(
      `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${title}</title>` +
        `<style>*{box-sizing:border-box}body{background:#141414;color:#d4d4d4;font:13px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin:0;padding:32px}h1{font-size:14px;color:#f0f0f0;margin:0 0 14px;font-weight:600}table{border-collapse:collapse;width:100%;max-width:900px}td{padding:5px 10px;border-bottom:1px solid #2a2a2a}a{color:#6cb2ff;text-decoration:none}a:hover{text-decoration:underline}.sz{color:#8a8a8a;font-size:11px;text-align:right;width:80px;text-transform:uppercase}</style>` +
        `</head><body><h1>${title}</h1><table>${rows.join('') || '<tr><td class="sz">empty folder</td><td class="sz"></td></tr>'}</table>` +
        `<p style="color:#8a8a8a;font-size:11px;margin-top:18px">Sadeem live preview — built-in static server (no index.html found; showing the folder contents).</p></body></html>`,
    );
  } catch {
    try {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' });
      res.end('not found');
    } catch {
      /* socket already gone */
    }
  }
}

export async function staticStart(rawDir: string, preferredPort?: number): Promise<PreviewStartResult> {
  const target = path.resolve(rawDir.trim());
  let st;
  try {
    st = await fs.stat(target);
  } catch {
    return { ok: false, error: `Directory not found: ${target}` };
  }

  let root: string | null = null;
  let entry = 'index.html';
  let isArtifact = false; // single non-HTML file → served through the viewer page
  let listDir = false; // v11.11 (A3) — folder without index.html → directory listing
  if (st.isFile()) {
    const ext = path.extname(target).toLowerCase();
    if (/^\.html?$/i.test(ext)) {
      // Plain web page: served and opened directly (unchanged behavior).
      root = path.dirname(target);
      entry = path.basename(target);
    } else if (ARTIFACT_TYPES[ext]) {
      // ANY other previewable file (pdf/image/media/md/text/code): its parent
      // directory is served and the entry URL is the generated viewer page.
      root = path.dirname(target);
      entry = path.basename(target);
      isArtifact = true;
    } else {
      return {
        ok: false,
        error:
          `Not a previewable file: ${target} — supported: .html, pdf, images, ` +
          'audio/video, .md, .txt/.json/.xml/.csv/.log and common code files.',
      };
    }
  } else if (st.isDirectory()) {
    root = await pickStaticRoot(target);
    if (!root) {
      // v11.11 (A3) — universal fallback: serve ANY folder even without an
      // index.html (python/go scripts that generate files, raw exports,
      // datasets…). '/' gets a generated directory listing so EVERY workspace
      // previews something — the founder's any-language guarantee.
      root = target;
      entry = '';
      listDir = true;
    }
  } else {
    return { ok: false, error: `Not a file or directory: ${target}` };
  }

  // Replace any previous static server.
  staticStop();

  const entryFile = entry;
  const preferred = preferredPort && preferredPort > 0 ? preferredPort : 4173;
  const servedRoot = root as string;
  const server = createServer((req, res) => {
    try {
      const rawUrl = req.url ?? '/';
      const qIdx = rawUrl.indexOf('?');
      let urlPath: string;
      try {
        urlPath = decodeURIComponent(qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl);
      } catch {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' });
        res.end('bad request');
        return;
      }

      // --- universal artifact viewer + its raw file fetcher ---
      if (urlPath === VIEWER_ROUTE) {
        let srcParam: string | null = null;
        if (qIdx >= 0) {
          try {
            srcParam = new URLSearchParams(rawUrl.slice(qIdx + 1)).get('src');
          } catch {
            srcParam = null;
          }
        }
        void serveViewer(res, servedRoot, srcParam ?? '');
        return;
      }
      if (urlPath === RAW_ROUTE.slice(0, -1) || urlPath.startsWith(RAW_ROUTE)) {
        void serveRawFile(res, servedRoot, urlPath.slice(RAW_ROUTE.length - 1));
        return;
      }

      // v11.11 (A3) — folder without index.html: generated directory listing
      // (root and subdirectories; a trailing-slash URL is a listing request).
      if (listDir && (urlPath === '/' || urlPath === '' || urlPath.endsWith('/'))) {
        void serveDirListing(res, servedRoot, urlPath);
        return;
      }

      // --- plain static site serving (unchanged semantics) ---
      let rel = path.normalize(urlPath).replace(/^([.][.][/\\])+/, '');
      if (rel === '/' || rel === '\\') rel = entryFile;
      let file = path.join(servedRoot, rel);
      // Escape guard: containment via path.relative (sibling-prefix safe).
      // On escape → serve the entry file (same UX as before).
      if (!containsPath(servedRoot, file)) file = path.join(servedRoot, entryFile);

      fs.stat(file)
        .then(async (fst) => {
          if (fst.isDirectory()) file = path.join(file, 'index.html');
          // SECURITY: resolve symlinks and re-run containment on the REAL path
          // so a link planted inside the served root cannot leak outside files.
          try {
            const real = await fs.realpath(file);
            if (!containsPath(servedRoot, real)) throw new Error('not found');
            file = real;
          } catch (err) {
            if ((err as Error).message === 'not found') throw err;
            /* realpath unavailable (file vanished) — fall through to read */
          }
          return fs.readFile(file);
        })
        .catch(async () => {
          // SPA fallback: unknown extension-less routes → the entry file
          // (never in listDir mode — the listing page owns extension-less URLs)
          if (!path.extname(rel) && !listDir) return fs.readFile(path.join(servedRoot, entryFile));
          throw new Error('not found');
        })
        .then((buf) => {
          const mime = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
          // html is rebuilt on every save during development — never cache it
          const isHtml = /\.html?$/i.test(file);
          res.writeHead(200, { 'content-type': mime, 'cache-control': isHtml ? 'no-store' : 'no-cache' });
          res.end(buf);
        })
        .catch(() => {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Surnia preview: 404 — ' + rel);
        });
    } catch {
      try {
        res.writeHead(500);
        res.end('preview error');
      } catch {
        /* socket gone */
      }
    }
  });

  return await new Promise<PreviewStartResult>((resolve) => {
    void listenOnPreferred(server, preferred).then((addrPort) => {
      staticServer = server;
      staticRoot = root as string;
      staticUrl =
        `http://127.0.0.1:${addrPort}` +
        (isArtifact
          ? `${VIEWER_ROUTE}?src=${encodeURIComponent(entryFile)}` // artifact → viewer page
          : entryFile !== 'index.html'
            ? `/${entryFile}`
            : '');
      syncWatcher(); // watch the freshly served root
      emit({ kind: 'static', state: 'ready', url: staticUrl, ws: staticRoot });
      resolve({ ok: true, url: staticUrl, root: staticRoot });
    }).catch((err: Error) => {
      staticServer = null;
      syncWatcher();
      resolve({ ok: false, error: `Preview server failed: ${err.message}` });
    });
  });
}

export function staticStop(): void {
  if (staticServer) {
    try {
      // v11.11 (A3) — drop keep-alive sockets so the port frees IMMEDIATELY on
      // stop (same EADDRINUSE discipline the jobs runner got in v11.10).
      (staticServer as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
      staticServer.close();
    } catch {
      /* already closed */
    }
    staticServer = null;
    emit({ kind: 'static', state: 'stopped' });
  }
  staticRoot = '';
  staticUrl = '';
  syncWatcher(); // fall back to watching the dev workspace, or stop entirely
}

export function staticStatus(): { running: boolean; url?: string; root?: string } {
  return staticServer ? { running: true, url: staticUrl, root: staticRoot } : { running: false };
}

// ============================================================
// 1c. AUTO-PREVIEW (v11.38) — the founder's #1 demand, done honestly.
// ------------------------------------------------------------
// One call answers "the agent just built a page — SHOW IT TO ME":
//   find the real web entry → start a REAL loopback server → make a
//   REAL HTTP GET → only then return the URL and emit `ready`.
// A server that binds but whose entry does not answer 200 is a FAILURE,
// never a fabricated "ready". This is exported so the tool layer can
// start + verify in one step and emit `preview_open` with a real URL.
// ============================================================
export interface PreviewVerifyResult {
  ok: boolean;
  status: number | null;
  error?: string;
}

/**
 * Real HTTP verification of a preview URL. `require200=false` is for dev
 * servers where any HTTP answer proves a server owns the port (a 404 still is
 * a live server); static entries must answer 2xx or they are not "ready".
 * Never throws, never guesses — a network error returns ok:false.
 */
export async function verifyPreviewUrl(
  rawUrl: string,
  timeoutMs = 1500,
  require200 = true,
): Promise<PreviewVerifyResult> {
  let url: string;
  try {
    url = new URL(rawUrl).toString();
  } catch {
    return { ok: false, status: null, error: `invalid preview URL: ${rawUrl}` };
  }
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(Math.max(100, Math.min(10_000, timeoutMs))),
    });
    const status = res.status;
    try { await res.body?.cancel(); } catch { /* socket already gone */ }
    const ok = require200 ? status >= 200 && status < 300 : true;
    return ok ? { ok: true, status } : { ok: false, status, error: `HTTP ${status}` };
  } catch (err) {
    return { ok: false, status: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** A bounded, actionable web-entry description returned by findPreviewEntry(). */
export interface PreviewEntry {
  kind: 'static' | 'dev';
  /** Absolute directory to serve (static) or workspace for dev. */
  dir: string;
  /** Absolute path passed to staticStart() (a dir or a single .html file). */
  startPath: string;
  runtime?: 'npm' | 'python' | 'custom' | 'go';
  label: string;
}

/** Folders that can never hold the built page the user wants to see. */
const AUTO_SKIP_DIRS = new Set([
  'node_modules', '.git', '.surnia', '.cache', 'coverage', '.vscode', '.idea', 'vendor', '__pycache__',
]);

/**
 * Shallowest index.html under `root` (max 3 levels). BFS by depth so a site
 * at the workspace root or in dist/build/out wins over a nested demo; skipped
 * directories keep us out of dependencies. Also returns a single root .html.
 */
async function findIndexHtml(root: string): Promise<string | null> {
  try {
    const rootEntries = await fs.readdir(root, { withFileTypes: true });
    const rootHtml = rootEntries.find((e) => e.isFile() && /\.html?$/i.test(e.name));
    if (rootHtml) return path.join(root, rootHtml.name);
  } catch {
    return null;
  }
  let level = [root];
  for (let depth = 0; depth < 3; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isDirectory() || AUTO_SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        const sub = path.join(dir, e.name);
        try {
          if ((await fs.stat(path.join(sub, 'index.html'))).isFile()) return path.join(sub, 'index.html');
        } catch {
          /* keep looking */
        }
        next.push(sub);
      }
    }
    if (!next.length) break;
    level = next;
  }
  return null;
}

/**
 * Pick what to auto-preview for a workspace that just got written:
 *   1. an index.html (root, dist/build/out/public, or ≤3 levels deep) → static;
 *   2. a package.json with a dev/start/serve script → npm dev server;
 *   3. manage.py/app.py/main.py/server.py → python; go.mod → go.
 * Returns null for a pure Q&A / docs workspace (never fabricates a target).
 */
export async function findPreviewEntry(ws: string): Promise<PreviewEntry | null> {
  const root = path.resolve(ws);
  let st;
  try {
    st = await fs.stat(root);
  } catch {
    return null;
  }
  if (st.isFile() && /\.html?$/i.test(root)) {
    return { kind: 'static', dir: path.dirname(root), startPath: root, label: path.basename(root) };
  }
  if (!st.isDirectory()) return null;

  const index = await findIndexHtml(root);
  if (index) {
    const dir = path.dirname(index);
    return {
      kind: 'static',
      dir,
      startPath: dir,
      label: dir === root ? path.basename(index) : path.relative(root, dir).split(path.sep).join('/') + '/' + path.basename(index),
    };
  }

  // No HTML — fall back to a real dev runtime, but ONLY when a real entry exists.
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const script = ['dev', 'start', 'serve'].find((k) => typeof pkg.scripts?.[k] === 'string' && pkg.scripts[k]);
    if (script) return { kind: 'dev', dir: root, startPath: root, runtime: 'npm', label: `npm run ${script}` };
  } catch { /* no package.json */ }

  for (const name of ['manage.py', 'app.py', 'main.py', 'server.py', 'run.py']) {
    try {
      if ((await fs.stat(path.join(root, name))).isFile()) {
        return { kind: 'dev', dir: root, startPath: root, runtime: 'python', label: `python ${name}` };
      }
    } catch { /* keep looking */ }
  }
  try {
    if ((await fs.stat(path.join(root, 'go.mod'))).isFile()) {
      return { kind: 'dev', dir: root, startPath: root, runtime: 'go', label: 'go run .' };
    }
  } catch { /* no go.mod */ }
  return null;
}

export interface AutoPreviewResult extends PreviewStartResult {
  kind?: 'static' | 'dev';
  label?: string;
  runtime?: 'npm' | 'python' | 'custom' | 'go';
  /** TRUE only after a real HTTP GET answered (200 for static, any HTTP for dev). */
  verified?: boolean;
  status?: number | null;
}

/**
 * The one-call auto-preview used by the `preview_open` tool: start a real
 * server for the built web entry, verify it over real loopback HTTP, and
 * return the REAL URL. Returns ok:false (never a guessed URL) when there is
 * no web entry, the server cannot start, or the entry does not answer 200.
 */
export async function autoPreview(ws: string, preferredPort?: number): Promise<AutoPreviewResult> {
  const root = path.resolve(ws);
  const entry = await findPreviewEntry(root);
  if (!entry) {
    return {
      ok: false,
      error: `No web entry found in ${root} — build an index.html (or add a package.json dev script) before asking for a preview.`,
    };
  }

  if (entry.kind === 'dev') {
    const start = await devStart(root, entry.runtime ?? 'npm');
    if (!start.ok) return { ok: false, kind: 'dev', label: entry.label, error: start.error };
    const wait = await waitForDevUrl(8_000);
    if (!wait.ok || !wait.url) {
      return { ok: false, kind: 'dev', label: entry.label, error: wait.error ?? 'dev server announced no URL' };
    }
    const v = await verifyPreviewUrl(wait.url, 1500, false);
    if (!v.ok) {
      return { ok: false, kind: 'dev', label: entry.label, url: wait.url, error: `dev server did not answer HTTP: ${v.error}` };
    }
    return {
      ok: true, url: wait.url, root, kind: 'dev', label: entry.label,
      runtime: entry.runtime, verified: true, status: v.status,
    };
  }

  const res = await staticStart(entry.startPath, preferredPort);
  if (!res.ok || !res.url) {
    return { ok: false, kind: 'static', label: entry.label, error: res.error ?? 'preview server returned no URL' };
  }
  const v = await verifyPreviewUrl(res.url, 1500, true);
  if (!v.ok) {
    // Bind succeeded but the page did not answer 200 — stop it, do NOT claim ready.
    staticStop();
    return {
      ok: false, kind: 'static', label: entry.label, url: res.url,
      error: `preview server started but the entry did not answer HTTP 200 (${v.error ?? v.status}); no preview was claimed.`,
    };
  }
  return {
    ok: true, url: res.url, root: res.root ?? entry.dir, kind: 'static', label: entry.label,
    verified: true, status: v.status,
  };
}

// ============================================================
// 2. Dev-server manager (framework-aware)
// ============================================================
const DEV_LOG_LINES = 240;

/**
 * ANSI escape sequences (CSI / OSC / two-char Fe escapes) emitted by nearly
 * every dev server. They used to reach the renderer verbatim and paint garbage
 * into the log drawer — and, worse, could hide a real URL from detectUrl().
 */
const ANSI_RE =
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[()#][0-9A-Za-z]?|[=>]|[M-Z])/g;

/** Strip ANSI + non-printing control chars from one dev-server log line. */
export function sanitizeLogLine(raw: string): string {
  return String(raw ?? '')
    .replace(ANSI_RE, '')
    // keep \t (0x09) and newlines; blank every other C0/C1 control + DEL
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+$/g, '');
}

/**
 * stdout/stderr are byte streams with NO line-boundary guarantee: a URL can be
 * split across two chunks ("http://127." + "0.0.1:3000") and was silently
 * missed. This tiny buffer re-assembles complete lines and exposes a final
 * flush() so a last line without a trailing newline is still processed.
 */
export class LineBuffer {
  private rest = '';

  push(chunk: string): string[] {
    this.rest += String(chunk ?? '');
    const parts = this.rest.split(/\r\n|\n|\r/);
    this.rest = parts.pop() ?? '';
    return parts;
  }

  flush(): string[] {
    if (!this.rest) return [];
    const out = [this.rest];
    this.rest = '';
    return out;
  }
}

interface DevState {
  child: ChildProcess | null;
  script: string;
  workspace: string;
  url: string | null;
  state: PreviewDevStatus['state'];
  lines: string[];
  startedAt: number;
}
let dev: DevState | null = null;

function pushLine(lines: string[], line: string): void {
  lines.push(line);
  if (lines.length > DEV_LOG_LINES) lines.splice(0, lines.length - DEV_LOG_LINES);
}

// A line that announces a bind must carry a POSITIVE signal; a bare ":3000" in
// an unrelated line used to be enough to flip the UI to a fabricated "ready".
const POSITIVE_URL_SIGNAL =
  /\b(listen(?:ing)?|ready|start(?:ed|ing)?|serv(?:ing|er)|running|local|network|open(?:ed)?|accepting|available|live|up)\b/i;
const NEGATIVE_URL_SIGNAL =
  /\b(error|fail(?:ed|ure)?|refused|eaddrinuse|in use|already in use|occupied|cannot|could not|unable|exited|crash(?:ed)?|fatal|denied|invalid|stopped)\b/i;

/**
 * First usable localhost URL in one dev-server log line. Never fabricates a
 * "ready" from an error line: negative signals veto the whole line, and the
 * bare-port fallbacks additionally require a positive bind announcement.
 */
export function detectUrl(text: string): string | null {
  const clean = sanitizeLogLine(text);
  if (!clean.trim() || NEGATIVE_URL_SIGNAL.test(clean)) return null;

  // 1. Full URL (the common case). Normalize every host to canonical loopback
  //    so the panel always hands the webview a reachable, same-origin URL.
  const re = /https?:\/\/(?:(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])|[\w.-]+):(\d{2,5})[^\s"'<>\]]*/gi;
  let m: RegExpExecArray | null;
  let fallback: string | null = null;
  while ((m = re.exec(clean))) {
    const port = Number(m[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    const raw = m[0]
      .replace('//0.0.0.0:', '//127.0.0.1:')
      .replace('//[::1]:', '//127.0.0.1:')
      .replace('//localhost:', '//127.0.0.1:')
      .replace(/\/\/[\w.-]+:/, '//127.0.0.1:');
    if (!fallback) fallback = raw;
    if (/^https?:\/\/127\.0\.0\.1:/.test(raw)) return raw;
  }
  if (fallback) return fallback;

  // 2. Bare-port fallbacks — only with a positive signal (or a line that is
  //    nothing but a bind address). "Port 3000 is in use" is a failure, not a
  //    server we can open.
  const bareBind =
    /(?:^|\s)(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])?:(\d{2,5})\s*$/i.test(clean) || /^:(\d{2,5})\s*$/.test(clean);
  if (!POSITIVE_URL_SIGNAL.test(clean) && !bareBind) return null;
  const portPats: RegExp[] = [
    /(?:listening|serving|running|started|reachable|ready)[^\r\n]{0,40}?:\s*(\d{2,5})\b/i,
    /\b(?:listening|serving|running|started|ready)\s+(?:on\s+)?(?:port\s+)?:?\s*(\d{2,5})\b/i,
    /\bport\s+(\d{2,5})\b/i,
    bareBind ? /(\d{2,5})\s*$/ : /$^/,
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

function pickDevScript(pkg: { scripts?: Record<string, string> }): string | null {
  const s = pkg.scripts ?? {};
  for (const name of ['dev', 'start', 'serve']) {
    if (typeof s[name] === 'string' && s[name].length) return name;
  }
  return null;
}

// ---------- framework detection ----------
interface FrameworkDef {
  id: string;
  /** marker files in the workspace root (most reliable signal) */
  configs: string[];
  /** dependency names (dependencies / devDependencies / peerDependencies) */
  deps: string[];
  /** well-known default dev port */
  port: number;
}
const FRAMEWORKS: FrameworkDef[] = [
  { id: 'angular', configs: ['angular.json'], deps: ['@angular/core', '@angular/cli'], port: 4200 },
  { id: 'astro', configs: ['astro.config.mjs', 'astro.config.js', 'astro.config.ts'], deps: ['astro'], port: 4321 },
  { id: 'next', configs: ['next.config.js', 'next.config.mjs', 'next.config.ts'], deps: ['next'], port: 3000 },
  { id: 'nuxt', configs: ['nuxt.config.ts', 'nuxt.config.js'], deps: ['nuxt', 'nuxt3', 'nuxt-nightly'], port: 3000 },
  {
    id: 'svelte-kit',
    configs: ['svelte.config.js', 'svelte.config.ts'],
    deps: ['@sveltejs/kit', '@sveltejs/vite-plugin-svelte'],
    port: 5173,
  },
  {
    id: 'expo',
    configs: ['app.json', 'app.config.js', 'app.config.ts'],
    deps: ['expo', 'expo-status-bar'],
    port: 8081,
  },
  { id: 'vite', configs: ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.mts'], deps: ['vite'], port: 5173 },
  { id: 'cra', configs: [], deps: ['react-scripts'], port: 3000 },
];

interface Deps {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

async function detectFramework(ws: string, pkg: Deps): Promise<FrameworkDef | null> {
  for (const fw of FRAMEWORKS) {
    for (const cfg of fw.configs) {
      try {
        const st = await fs.stat(path.join(ws, cfg));
        if (st.isFile()) return fw;
      } catch {
        /* keep looking */
      }
    }
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  for (const fw of FRAMEWORKS) {
    if (fw.deps.some((d) => deps[d] !== undefined)) return fw;
  }
  return null;
}

/**
 * Parse an explicit dev port from a script command. Covers `--port N`,
 * `--port=N`, `--port:N`, `-p N`, `-p=N`, `-pN`, `PORT=N` and quoted values,
 * across tabs/quotes — the old patterns missed `-p808`, tabs and quoted ports
 * and silently fell back to a framework default (pointing the preview at the
 * wrong server). Exported for the regression suite.
 */
export function parsePortFlag(cmd: string): number | null {
  const text = String(cmd ?? '');
  const patterns: RegExp[] = [
    /(?:^|\s)--?port\s*[:=]\s*["']?(\d{1,5})\b/i,
    /(?:^|\s)--?port\s+["']?(\d{1,5})\b/i,
    /(?:^|\s)-p\s*[:=]?\s*["']?(\d{1,5})\b/i,
    /(?:^|\s)PORT\s*=\s*["']?(\d{1,5})\b/i,
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

/** Expected dev port: explicit flag in the script wins, else framework default. */
function expectedPort(cmd: string, fw: FrameworkDef | null): number | null {
  return parsePortFlag(cmd) ?? fw?.port ?? null;
}

// ---------- v10.3 — multi-runtime detection (Python / custom command) ----------
/** First existing regular file among `names` in `ws`, else null. */
async function firstExisting(ws: string, names: string[]): Promise<string | null> {
  for (const n of names) {
    try {
      const st = await fs.stat(path.join(ws, n));
      if (st.isFile()) return n;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

export interface PythonRun {
  cmd: string;
  args: string[];
  port: number;
  label: string;
}

// v11.11 (A3) — prefer python3 on POSIX (most sandboxes/macOS ship no `python`).
// Probed once per process, cached; falls back to `python` when python3 is absent.
let pythonBinCache: string | undefined;
function pythonBin(): string {
  if (pythonBinCache) return pythonBinCache;
  let found = process.platform === 'win32' ? 'python' : '';
  if (process.platform !== 'win32') {
    for (const c of ['python3', 'python']) {
      try {
        const r = spawnSync(c, ['--version'], { timeout: 4000 });
        if (r.status === 0) {
          found = c;
          break;
        }
      } catch {
        /* keep trying */
      }
    }
  }
  pythonBinCache = found || 'python';
  return pythonBinCache;
}

/**
 * v10.3 — detect a runnable Python dev server for this workspace. Covers the
 * runtimes users actually ship: Django (manage.py), FastAPI/uvicorn
 * (requirements hint + main/app/server module), Flask and generic entry
 * scripts (app.py / main.py / server.py / run.py). Returns null when nothing
 * Python-shaped exists — the caller falls back to node/static targets.
 */
export async function detectPythonRun(ws: string): Promise<PythonRun | null> {
  // Django — manage.py is the canonical entry.
  if (await firstExisting(ws, ['manage.py'])) {
    const py = pythonBin();
    return { cmd: py, args: ['-u', 'manage.py', 'runserver', '8000'], port: 8000, label: `${py} manage.py runserver` };
  }
  // Dependency hints from requirements.txt / pyproject.toml (best effort).
  let reqs = '';
  for (const f of ['requirements.txt', 'pyproject.toml']) {
    try {
      reqs += '\n' + (await fs.readFile(path.join(ws, f), 'utf8'));
    } catch {
      /* optional */
    }
  }
  const has = (p: string): boolean => new RegExp(`(^|[^\\w-])${p}([^\\w-]|$)`, 'i').test(reqs);
  // FastAPI/uvicorn — serve the ASGI app module directly.
  if (has('uvicorn') || has('fastapi')) {
    const entry = await firstExisting(ws, ['main.py', 'app.py', 'server.py']);
    if (entry) {
      const mod = entry.replace(/\.py$/, '');
      const py = pythonBin();
      return {
        cmd: py,
        args: ['-u', '-m', 'uvicorn', `${mod}:app`, '--port', '8000'],
        port: 8000,
        label: `${py} -m uvicorn ${mod}:app`,
      };
    }
  }
  // Flask / generic entry script — executed directly (app.run() / uvicorn.run()).
  const entry = await firstExisting(ws, ['app.py', 'main.py', 'server.py', 'run.py']);
  if (entry) {
    const py = pythonBin();
    // -u (unbuffered stdout) is essential: when stdout is a pipe, Python
    // block-buffers print(), so the "Running on http://…" URL never reaches
    // the URL detector and the dev server stays stuck in "starting".
    return { cmd: py, args: ['-u', entry], port: has('flask') ? 5000 : 8000, label: `${py} ${entry}` };
  }
  // v11.11 (A3) — plain-Python workspace (requirements.txt and/or *.py files
  // but no runnable app entry): fall back to http.server so the folder still
  // previews SOMETHING (the agent's generated index.html, artifacts, listing)
  // instead of “nothing to preview” — the founder's any-language guarantee.
  let anyPy = false;
  try {
    anyPy = (await fs.readdir(ws)).some((n) => /\.(py|pyw)$/i.test(n));
  } catch {
    /* unreadable dir */
  }
  if (reqs.trim() || anyPy) {
    const py = pythonBin();
    return {
      cmd: py,
      args: ['-m', 'http.server', '8000', '--bind', '127.0.0.1'],
      port: 8000,
      label: `${py} -m http.server 8000`,
    };
  }
  return null;
}

/** Extract the first explicit localhost URL/port from a custom command string. */
function customPort(cmd: string): number | null {
  return parsePortFlag(cmd) ?? (() => {
    const m = /(?:localhost|127\.0\.0\.1):(\d{2,5})/.exec(cmd);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
  })();
}

interface DevLaunch {
  cmd: string;
  args: string[];
  shell: boolean;
  label: string;
  expected: number | null;
  script?: string;
  runtime: 'npm' | 'python' | 'custom' | 'go';
}

// ---------- expected-port polling fallback ----------
let portPoll: ReturnType<typeof setInterval> | null = null;
function stopPortPoll(): void {
  if (portPoll) {
    clearInterval(portPoll);
    portPoll = null;
  }
}

// v11.11 (A3) — honest hard cap for the “starting” phase: if the dev server
// never announces a usable URL/port within 20s, surface a CLEAR error (never
// hang the UI on “starting…”). The child process itself stays alive — it may
// still come up later; the dev log drawer and the ports scan keep working.
let startCap: ReturnType<typeof setTimeout> | null = null;
function stopStartCap(): void {
  if (startCap) {
    clearTimeout(startCap);
    startCap = null;
  }
}

export async function devStart(
  workspace: string,
  runtime: 'npm' | 'python' | 'custom' | 'go' = 'npm',
): Promise<PreviewStartResult> {
  const ws = path.resolve(workspace.trim());
  let launch: DevLaunch;

  if (runtime === 'custom') {
    // v10.3 — ANY runtime: the user's own dev command (Go, Rust, PHP, Rails…).
    const s = getSettings() as { preview?: { customCommand?: string } };
    const c = (s.preview?.customCommand ?? '').trim();
    if (!c) {
      return { ok: false, error: 'No custom preview command — set one in Settings → Preview.' };
    }
    launch = { cmd: c, args: [], shell: true, label: c, expected: customPort(c), script: c, runtime: 'custom' };
  } else if (runtime === 'python') {
    // v10.3 — Python runtimes: Django / FastAPI / Flask / plain entry scripts.
    const py = await detectPythonRun(ws);
    if (!py) {
      return {
        ok: false,
        error: 'No Python entry found (manage.py / app.py / main.py / server.py) — use static preview for plain HTML.',
      };
    }
    launch = { cmd: py.cmd, args: py.args, shell: true, label: py.label, expected: py.port, script: py.label, runtime: 'python' };
  } else if (runtime === 'go') {
    // v11.11 (A3) — Go modules: `go run .` from the workspace root; the URL is
    // parsed from stdout ("listening on :3000", "127.0.0.1:8080"…) with the
    // expected-port poll and the 20s honest cap as fallbacks.
    let hasGoMod = false;
    try {
      hasGoMod = (await fs.stat(path.join(ws, 'go.mod'))).isFile();
    } catch {
      /* not a go module */
    }
    if (!hasGoMod) {
      return { ok: false, error: 'No go.mod in this workspace — the Go preview target needs the module root.' };
    }
    launch = { cmd: 'go', args: ['run', '.'], shell: false, label: 'go run .', expected: null, script: 'go run .', runtime: 'go' };
  } else {
    let pkgRaw: string;
    try {
      pkgRaw = await fs.readFile(path.join(ws, 'package.json'), 'utf8');
    } catch {
      return { ok: false, error: 'No package.json in this workspace — try a Python or static preview target.' };
    }
    let pkg: Deps & { scripts?: Record<string, string> };
    try {
      pkg = JSON.parse(pkgRaw);
    } catch {
      return { ok: false, error: 'package.json is not valid JSON.' };
    }
    const script = pickDevScript(pkg);
    if (!script) return { ok: false, error: 'No dev/start/serve script in package.json.' };

    const fw = await detectFramework(ws, pkg);
    const expected = expectedPort(pkg.scripts?.[script] ?? '', fw);
    const isWin = process.platform === 'win32';
    const npmCmd = isWin ? 'npm.cmd' : 'npm';
    launch = { cmd: npmCmd, args: ['run', script], shell: false, label: `npm run ${script}`, expected, script, runtime: 'npm' };
  }

  devStop(); // one dev server at a time

  // If the expected port was ALREADY open before we spawned (a stale server
  // from a previous run, or an unrelated app), the port-poll fallback must not
  // claim it as ours — that was a fabricated "ready" pointed at the wrong app.
  const portWasOpenBefore = launch.expected ? await probePort(launch.expected, 200) : false;

  const isWin2 = process.platform === 'win32';
  // Node ≥18 refuses to spawn a Windows .cmd/.bat shim with shell:false
  // (spawn EINVAL) — npm.cmd is exactly that. Without this, every dev-server
  // launch failed on Windows while working on POSIX. shell:true is the
  // documented way to run batch shims; POSIX launches keep their original mode.
  const needsCmdShell = isWin2 && /\.(cmd|bat)$/i.test(launch.cmd);
  const child = spawn(launch.cmd, launch.args, {
    cwd: ws,
    env: { ...process.env, FORCE_COLOR: '0', BROWSER: 'none' },
    detached: !isWin2, // own process group on POSIX → clean tree kill
    windowsHide: true,
    shell: launch.shell || needsCmdShell,
  });

  const state: DevState = {
    child,
    script: launch.script ?? launch.label,
    workspace: ws,
    url: null,
    state: 'starting',
    lines: [`$ ${launch.label}${launch.runtime !== 'npm' ? '  [' + launch.runtime + ']' : ''}`],
    startedAt: Date.now(),
  };
  dev = state;
  stopStartCap(); // fresh run → fresh 20s honest cap
  startCap = setTimeout(() => {
    if (!dev || dev.child !== child || state.state !== 'starting') return;
    state.state = 'error';
    const msg =
      `No server URL/port detected within 20s (${launch.label}). The process is still running — ` +
      'check its output in the dev log drawer (or a terminal); if it serves on a fixed port, open it from the ports row, ' +
      'or set a custom preview command in Settings → Preview.';
    pushLine(state.lines, `[surnia] ${msg}`);
    emit({ kind: 'log', level: 'warn', text: `[surnia] ${msg}` });
    emit({ kind: 'dev', state: 'error', error: msg, ws: state.workspace });
  }, 20_000);

  const lineBuffers: Record<'stdout' | 'stderr', LineBuffer> = { stdout: new LineBuffer(), stderr: new LineBuffer() };
  const handleLine = (src: 'stdout' | 'stderr', line: string): void => {
    const text = sanitizeLogLine(line).slice(0, 400);
    if (!text.trim()) return;
    pushLine(state.lines, text);
    // stream dev-server output to the renderer console drawer (already clean)
    emit({ kind: 'log', level: src === 'stderr' ? 'warn' : 'info', text });
    const found = detectUrl(text);
    if (found && state.state !== 'ready') {
      state.url = found;
      state.state = 'ready';
      stopPortPoll();
      stopStartCap();
      emit({ kind: 'dev', state: 'ready', url: found, ws: state.workspace });
    }
  };
  const drain = (src: 'stdout' | 'stderr'): void => {
    for (const line of lineBuffers[src].flush()) handleLine(src, line);
  };
  const feed = (src: 'stdout' | 'stderr') => (chunk: Buffer | string): void => {
    if (!dev || dev.child !== child) return;
    for (const line of lineBuffers[src].push(String(chunk))) handleLine(src, line);
  };
  child.stdout?.on('data', feed('stdout'));
  child.stderr?.on('data', feed('stderr'));

  child.on('exit', (code) => {
    if (!dev || dev.child !== child) return;
    // A final line without a trailing newline can carry the URL — process it
    // before flipping away from "starting".
    drain('stdout');
    drain('stderr');
    const wasReady = state.state === 'ready';
    pushLine(state.lines, `[process exited with code ${code ?? 'null'}]`);
    state.state = code === 0 || wasReady ? 'stopped' : 'error';
    dev.child = null;
    stopPortPoll();
    stopStartCap();
    syncWatcher();
    emit({ kind: 'dev', state: state.state, url: state.url ?? undefined, lines: state.lines.slice(-3), ws: state.workspace });
  });
  child.on('error', (err) => {
    if (!dev || dev.child !== child) return;
    pushLine(state.lines, `[spawn error: ${err.message}]`);
    state.state = 'error';
    dev.child = null;
    stopPortPoll();
    stopStartCap();
    syncWatcher();
    emit({ kind: 'dev', state: 'error', error: err.message, ws: state.workspace });
  });

  // Fallback URL detection: poll the expected framework port in case the
  // server never prints a URL (or prints it in a format we miss).
  if (launch.expected && !portWasOpenBefore) {
    const expected = launch.expected;
    const startedAt = Date.now();
    portPoll = setInterval(() => {
      if (!dev || dev.child !== child || state.state === 'ready') {
        stopPortPoll();
        return;
      }
      if (Date.now() - startedAt > 45000) {
        stopPortPoll();
        return;
      }
      // v11.34 — verify it is an HTTP server on loopback, not just any TCP
      // listener; a bare socket no longer fabricates a "ready" preview URL.
      void probeHttpPort(expected, 400).then((open) => {
        if (!open || !dev || dev.child !== child || state.state === 'ready') return;
        state.url = `http://127.0.0.1:${expected}`;
        state.state = 'ready';
        pushLine(state.lines, `[surnia] dev server answered on port ${expected}`);
        emit({ kind: 'dev', state: 'ready', url: state.url, ws: state.workspace });
        stopPortPoll();
        stopStartCap();
      });
    }, 600);
  }

  syncWatcher(); // watch the workspace while the dev server runs
  return { ok: true, script: launch.script };
}

export function devStop(): void {
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
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      } else {
        try {
          process.kill(-child.pid, 'SIGTERM'); // process group
        } catch {
          child.kill('SIGTERM');
        }
        setTimeout(() => {
          try {
            if (child.pid) process.kill(-child.pid, 'SIGKILL');
          } catch {
            /* already gone */
          }
        }, 1500);
      }
    } catch {
      /* best effort */
    }
  }
  syncWatcher();
  emit({ kind: 'dev', state: 'stopped', url: d.url ?? undefined, ws: d.workspace });
}

// ---------- agent-started servers (background processes) ----------
const AGENT_URLS_CAP = 6;
const AGENT_URL_SCAN_CHARS = 8_000;

/**
 * Localhost URLs printed by agent-started background processes (run_background
 * "npm run dev", "python -m http.server", …). The panel renders them as
 * "Agent: <url>" chips so the user can jump to a server previewService never
 * started itself. Best-effort: never throws, caps at 6, loopback only.
 */
function collectAgentServerUrls(): Array<{ url: string; cwd: string; id: string; command: string }> {
  const out: Array<{ url: string; cwd: string; id: string; command: string }> = [];
  try {
    for (const p of listBackgroundProcesses()) {
      const t = readBackgroundTail(p.id, AGENT_URL_SCAN_CHARS);
      if (!t) continue;
      for (const u of t.urls) {
        if (!/^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/i.test(u)) continue;
        const norm = (s: string): string => s.replace(/\/+$/, '');
        if (staticUrl && norm(u) === norm(staticUrl)) continue;
        if (!out.some((o) => norm(o.url) === norm(u))) out.push({ url: u, cwd: p.cwd, id: p.id, command: p.command });
        if (out.length >= AGENT_URLS_CAP) return out;
      }
    }
  } catch {
    /* background service unavailable (CLI headless tests) — fine */
  }
  return out;
}

export function devStatus(): PreviewDevStatus {
  const agentSources = collectAgentServerUrls();
  const agentUrls = agentSources.map((s) => s.url);
  if (!dev) return { running: false, state: 'idle', lines: [], agentUrls, agentSources };
  return {
    running: !!dev.child,
    state: dev.state,
    url: dev.url ?? undefined,
    script: dev.script,
    lines: dev.lines.slice(-80),
    startedAt: dev.startedAt,
    agentUrls,
    agentSources,
  };
}

/**
 * v11.34 — wait for a REAL announced dev URL. A URL is returned ONLY when the
 * service actually observed a bind announcement in the dev log or a confirmed
 * HTTP answer on the expected port; otherwise this returns an honest error
 * with the tail of the dev log. It never constructs a guessed "ready" URL.
 * Bounded by `timeoutMs` (clamped to 120 s) so callers can't hang.
 */
export async function waitForDevUrl(timeoutMs = 8_000): Promise<{ ok: boolean; url?: string; error?: string }> {
  const startedAt = Date.now();
  const budget = Math.max(0, Math.min(120_000, timeoutMs));
  for (;;) {
    const s = devStatus();
    if (s.url) return { ok: true, url: s.url };
    if (s.state === 'error' || s.state === 'stopped' || s.state === 'idle' || !s.running) {
      const tail = s.lines.slice(-3).join(' ').trim();
      return {
        ok: false,
        error: tail
          ? `dev server is ${s.state} without a URL — ${tail}`
          : `dev server is ${s.state} and announced no preview URL`,
      };
    }
    if (Date.now() - startedAt >= budget) {
      const tail = s.lines.slice(-3).join(' ').trim();
      return {
        ok: false,
        error: `no preview URL announced within ${budget} ms${tail ? ` — last log: ${tail}` : ''}`,
      };
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

// ============================================================
// 3. Port scanner — find dev servers already running on this machine
// ============================================================
const SCAN_PORTS = [
  3000, 3001, 3002, 4200, 4321, 5000, 5173, 5174, 5175, 8000, 8080, 8081, 8888, 1420, 19000, 19006, 1234, 7000, 9000,
];

function probePort(port: number, timeoutMs = 220): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: '127.0.0.1' });
    const done = (open: boolean): void => {
      sock.destroy();
      resolve(open);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/**
 * v11.34 — a bare TCP connect is NOT proof a dev server is up. Any process
 * listening on the expected port (a stale server, a database, a debugger)
 * used to flip the panel to a FABRICATED "ready" URL. Confirm the port really
 * speaks HTTP on loopback before handing a URL to the model. Any HTTP response
 * counts — a 404 still proves an HTTP server owns the port; we never claim
 * the page itself rendered, only that the server answered.
 */
function probeHttpPort(port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let req: ReturnType<typeof httpRequest> | undefined;
    const finish = (open: boolean): void => {
      if (settled) return;
      settled = true;
      try { req?.destroy(); } catch { /* socket already gone */ }
      resolve(open);
    };
    req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'GET',
        timeout: timeoutMs,
        headers: { 'user-agent': 'Sadeem-Preview-Probe/1.0' },
      },
      (res) => {
        res.resume();
        finish(true);
      },
    );
    req.once('timeout', () => finish(false));
    req.once('error', () => finish(false));
    req.end();
  });
}

export async function scanPorts(): Promise<number[]> {
  const results = await Promise.all(SCAN_PORTS.map(probePort));
  const open = SCAN_PORTS.filter((_, i) => results[i]);
  // static preview's own port is no news to the user
  const own = staticServer ? (staticServer.address() as { port: number } | null)?.port : null;
  return open.filter((p) => p !== own).slice(0, 8);
}

// ============================================================
// 4. File watcher — auto-refresh events while serving
// ============================================================
const WATCH_DEBOUNCE_MS = 400;
const WATCH_IGNORE = /(^|[\\/])(node_modules|\.git)([\\/]|$)/;

let watcher: FSWatcher | null = null;
let watchRoot = '';
let watcherGen = 0;
let watchTimer: ReturnType<typeof setTimeout> | null = null;

function stopWatcher(): void {
  watcherGen += 1; // invalidate stale callbacks/listeners
  if (watchTimer) {
    clearTimeout(watchTimer);
    watchTimer = null;
  }
  if (watcher) {
    try {
      watcher.close();
    } catch {
      /* already closed */
    }
    watcher = null;
  }
  watchRoot = '';
}

function scheduleWatchEmit(rel: string): void {
  if (watchTimer) clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    watchTimer = null;
    emit({ kind: 'watch', path: rel, ws: staticRoot });
  }, WATCH_DEBOUNCE_MS);
}

/**
 * Watch `root` for changes (recursive when the platform supports it, with a
 * single non-recursive retry) and emit debounced {kind:'watch'} events.
 * Never throws — watcher failures degrade to "no auto-refresh".
 */
function startWatcher(root: string): void {
  if (watcher && watchRoot === root) return;
  stopWatcher();
  watchRoot = root;
  const gen = watcherGen;
  let retried = false;

  const attach = (recursive: boolean): void => {
    if (gen !== watcherGen) return; // superseded by a newer start/stop
    try {
      const w = fsWatch(root, { recursive }, (_event, file) => {
        if (gen !== watcherGen) return;
        const rel = typeof file === 'string' ? file : '';
        if (!rel || WATCH_IGNORE.test(rel) || /(^|[\\/])\.DS_Store$/.test(rel) || rel.endsWith('~')) return;
        scheduleWatchEmit(rel);
      });
      w.on('error', () => {
        if (gen !== watcherGen) return;
        try {
          w.close();
        } catch {
          /* gone */
        }
        if (watcher === w) watcher = null;
        if (!retried) {
          retried = true; // one retry: non-recursive (recursive may be unsupported)
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

/** Keep exactly one watcher alive, pointed at whatever is currently served. */
function syncWatcher(): void {
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

// ============================================================
// 5. detectTargets — candidate preview sources for the renderer
// ============================================================
/**
 * Probe a workspace for things the preview can show:
 *  - a dev-server candidate when package.json has a dev/start/serve script
 *  - built output dirs (dist/, build/, out/, public/) containing index.html
 *  - a root-level index.html file
 *  - ARTIFACTS: the most recently modified previewable single files in the
 *    workspace root + common artifact dirs (reports/, docs/, dist/, out/,
 *    assets/, exports/) — pdf/image/media/md/text/code — most-recent-first
 *    until the shared cap of 6 targets.
 */
export async function detectTargets(workspace: string): Promise<PreviewTarget[]> {
  const ws = path.resolve(workspace.trim());
  const out: PreviewTarget[] = [];

  // dev candidate (node)
  try {
    const raw = await fs.readFile(path.join(ws, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    const script = pickDevScript(pkg);
    if (script) out.push({ kind: 'dev', label: `npm run ${script}`, dir: ws });
  } catch {
    /* not a node project — other runtimes may still apply */
  }

  // v10.3 — Python dev candidate (Django / FastAPI / Flask / entry script)
  try {
    const py = await detectPythonRun(ws);
    if (py) out.push({ kind: 'dev', label: py.label, dir: ws, runtime: 'python' });
  } catch {
    /* no python runtime — fine */
  }

  // v11.11 (A3) — Go module candidate: `go run .` (URL parsed from stdout)
  try {
    const st = await fs.stat(path.join(ws, 'go.mod'));
    if (st.isFile()) out.push({ kind: 'dev', label: 'go run .', dir: ws, runtime: 'go' });
  } catch {
    /* not a go module — fine */
  }

  // v10.3 — user's custom dev-server command (any runtime)
  try {
    const s = getSettings() as { preview?: { customCommand?: string } };
    const cc = (s.preview?.customCommand ?? '').trim();
    if (cc) out.push({ kind: 'dev', label: cc, dir: ws, runtime: 'custom' });
  } catch {
    /* settings unavailable — fine */
  }

  // built output directories
  for (const name of ['dist', 'build', 'out', 'public']) {
    try {
      const st = await fs.stat(path.join(ws, name, 'index.html'));
      if (st.isFile()) out.push({ kind: 'static', label: `${name}/`, dir: path.join(ws, name) });
    } catch {
      /* not present */
    }
  }

  // root-level entry file (served via the single-file path of staticStart)
  try {
    const st = await fs.stat(path.join(ws, 'index.html'));
    if (st.isFile()) out.push({ kind: 'file', label: 'index.html', dir: path.join(ws, 'index.html') });
  } catch {
    /* not present */
  }

  // v11.11 (A3) — universal fallback: the built-in static server is ALWAYS a
  // candidate for the workspace folder (with the new directory-listing mode it
  // previews something for ANY language — generated files, artifacts, listing).
  if (out.length === 0) {
    out.push({ kind: 'static', label: 'folder — built-in static server', dir: ws });
  }

  // single-file artifacts, most recently modified first (root + artifact dirs)
  const artifacts: { file: string; mtimeMs: number }[] = [];
  const scanDirs = [ws, ...ARTIFACT_DIRS.map((d) => path.join(ws, d))];
  for (const dir of scanDirs) {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue; // dir missing — fine
    }
    for (const name of names) {
      if (!isPreviewableArtifact(name)) continue;
      const full = path.join(dir, name);
      try {
        // lstat (not stat): a symlink is only previewable if its realpath stays
        // inside the workspace — the server re-checks containment anyway, but
        // don't even advertise an escape hatch in the target list.
        const st = await fs.lstat(full);
        if (st.isFile()) artifacts.push({ file: full, mtimeMs: st.mtimeMs });
      } catch {
        /* vanished between readdir and stat */
      }
    }
  }
  artifacts.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const a of artifacts) {
    if (out.length >= 6) break;
    const info = ARTIFACT_TYPES[path.extname(a.file).toLowerCase()];
    out.push({
      kind: 'artifact',
      label: `${path.basename(a.file)} — ${info?.label ?? 'FILE'}`,
      dir: a.file,
    });
  }

  return out.slice(0, 6);
}

// ============================================================
// 6. Teardown — never leave a detached dev server or a bound port behind
// ============================================================
/**
 * Stop everything this service owns. `main.ts` already stops the background
 * process pool on quit; this covers the preview-owned child (detached on POSIX,
 * so it would otherwise outlive the app) and the static listener. Safe to call
 * repeatedly and safe in CLI/headless mode.
 */
export function shutdownAll(): void {
  try {
    devStop();
  } catch {
    /* best effort */
  }
  try {
    staticStop();
  } catch {
    /* best effort */
  }
}

// Last-resort guard: a detached POSIX process group is NOT killed by the
// parent's death. 'exit' is synchronous, so kill directly instead of via the
// async helpers above.
process.once('exit', () => {
  try {
    const child = dev?.child;
    if (child?.pid) {
      if (process.platform === 'win32') {
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        } catch {
          /* best effort */
        }
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          try {
            child.kill('SIGKILL');
          } catch {
            /* already gone */
          }
        }
      }
    }
  } catch {
    /* best effort */
  }
  try {
    staticServer?.close();
  } catch {
    /* already closed */
  }
});
