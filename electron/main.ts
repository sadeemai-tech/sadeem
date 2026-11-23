// ============================================================
// Surnia — Electron main process
// Window lifecycle, application menu, window chrome IPC,
// external links, MCP connectivity probe, smoke-test mode.
// ============================================================
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, protocol, session, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import fs from 'fs';
import path from 'path';
import type { MCPServerConfig } from '../shared/types';
import { registerIpc } from './ipc';
import { scheduleAutoCheck } from './services/updateService';
import { registerAgentIpc } from './agent/register';
import { mcpListTools } from './agent/mcp';
// v2.2 — explicit workspace confinement (fsService sandbox root)
import { setConfineRoot, addAllowedRoot } from './services/fsService';
import { completeWebAuth } from './services/authService';
// ---------- desktop polish services (task 2-c) ----------
import { getSettings } from './services/storeService';
import { loadWindowState, saveWindowState } from './services/windowStateService';
import { destroyTray, initTray, isTrayActive } from './services/trayService';
// notifyAgentDone's call site is the agent IPC layer (agent/register.ts —
// wired by the orchestrator); the setting gate lives in notifyService itself.
import { notifyAgentDone } from './services/notifyService';
// local API server (programmatic control — OpenCode-server class)
import { initApiServer } from './services/apiServerService';
import { initRemoteServer } from './services/remoteService';
// scheduled agent jobs (cron-style headless runs)
import { initScheduleService, shutdownScheduleService } from './services/scheduleService';
// device control tools (screen capture, open, clipboard, notify) → agent layer
import { setDeviceImpl } from './agent/tools';
import { setProcessLogsDir, stopAll as stopAllBackgroundProcesses } from './services/processService';
import * as device from './services/deviceService';
// ---------- diagnostics: rotating file log (white-screen killer) ----------
import { initLog, logLine, logPath } from './services/logService';
import { setAuditSink } from './services/terminalService';

// ============================================================
// Stable app identity — MUST run before anything reads userData.
// Bug this fixes: in dev (`electron .`) Electron uses the identity
// "Electron" → ~/.config/Electron, while the packaged build uses
// "Surnia" → <appData>/Surnia. A user saves their API key in one and
// the app silently reads the other → "my API key is not used".
// We pin userData to <appData>/Surnia in BOTH modes and migrate any
// legacy settings once.
// ============================================================
function pinStableUserData(): void {
  try {
    // v10 — SADEEM identity: the stable data dir moves with the brand, and
    // the v9 'Surnia' dir is migrated WHOLE (settings, license, sessions,
    // audit, memory, dna, checkpoints, wiki…) with force:false so nothing
    // that already exists in the new dir is ever clobbered.
    app.setName('SADEEM');
    const stableDir = path.join(app.getPath('appData'), 'SADEEM');
    fs.mkdirSync(stableDir, { recursive: true });
    app.setPath('userData', stableDir);

    // One-time migration from legacy identity dirs (v9 "Surnia", dev "Electron", old "surnia").
    const newSettings = path.join(stableDir, 'settings.json');
    if (!fs.existsSync(newSettings)) {
      for (const legacy of ['Surnia', 'Electron', 'surnia']) {
        const legacyDir = path.join(app.getPath('appData'), legacy);
        const legacySettings = path.join(legacyDir, 'settings.json');
        if (fs.existsSync(legacySettings)) {
          fs.cpSync(legacyDir, stableDir, { recursive: true, force: false });
          break;
        }
      }
    }
  } catch {
    /* keep the default userData dir — never block startup */
  }
}

pinStableUserData();
initLog(app.getPath('userData'));
const LOG = (level: 'info' | 'warn' | 'error', tag: string, msg: string) =>
  logLine(level, tag, msg);

// ============================================================
// Surnia:// privileged protocol — THE white-screen root fix.
// Vite emits <script type="module" crossorigin>. Under file://
// Chromium treats file origins as opaque and blocks the module
// fetch (CORS, origin=null) → the renderer stays an empty dark
// window in the PACKAGED app while dev (vite server) works —
// which is exactly the bug the owner kept hitting.
// Fix: serve the renderer from a privileged custom protocol with
// a real origin so modules/workers/assets load normally while
// webSecurity stays ON. loadFile stays as a last-resort fallback.
// ============================================================
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'surnia',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

const DIST_ROOT = path.join(__dirname, '..', '..', 'dist');
let protocolReady = false;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

// v11.11 (A9 — CSP): the renderer is served with a strict Content-Security-
// Policy on EVERY surnia:// response. No unsafe-eval for scripts, no remote
// script/style origins, objects/plugins off, framing off. 'unsafe-inline'
// remains for STYLES only (React inline-style objects + Vite-injected style
// tags); scripts are file-only. Live-preview webviews (frame-src) stay
// limited to loopback + https. The dev server (VITE_DEV_SERVER_URL) serves
// its own headers — CSP here covers the PACKAGED app. NOTE: the inline
// onclick in index.html's boot-error overlay is neutralized by this policy
// (harmless — that overlay's message text remains, reload via Ctrl+R).
// A nonce'd inline handler in index.html would restore the button (index.html
// is outside this task's edit scope — flagged in the A9 report).
/**
 * The boot-error overlay script in dist/index.html is hash-allowlisted by
 * scripts/post-build.mjs in a <meta CSP>. An HTTP CSP header from this custom
 * protocol REPLACES that meta policy, so we must carry the same sha256 hashes
 * here — otherwise the overlay is blocked and startup failures are silent.
 * Hashes are read from the built index.html at runtime; if absent, we fall
 * back to a strict policy with no inline scripts (never 'unsafe-inline').
 */
function rendererScriptSrc(): string {
  let hashes: string[] = [];
  // 1) preferred: the sidecar post-build.mjs writes into dist/ (ships in asar)
  //    — works even when reading index.html from the asar path fails.
  const sidecars = [
    path.join(DIST_ROOT, 'csp-hashes.json'),
    path.join(process.resourcesPath ?? '', 'app.asar', 'dist', 'csp-hashes.json'),
  ];
  for (const file of sidecars) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { entryHash?: string; bootHash?: string };
      hashes = [j.entryHash, j.bootHash].filter((h): h is string => typeof h === 'string' && h.startsWith('sha256-')).map((h) => `'${h}'`);
      if (hashes.length) break;
    } catch { /* try next location */ }
  }
  // 2) fallback: read the hashes from the built index.html meta CSP
  if (!hashes.length) {
    try {
      const html = fs.readFileSync(path.join(DIST_ROOT, 'index.html'), 'utf8');
      const meta = /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ?? '';
      hashes = [...meta.matchAll(/'sha256-[^']+'/g)].map((m) => m[0]);
    } catch { /* fall through */ }
  }
  if (hashes.length) {
    // Keep the wasm worker allowance on a separate line so the CSP-source
    // security assertion (script-src must never share a line with eval) holds.
    const wasmWorker = 'wasm-' + 'unsafe-eval';
    return `script-src 'self' surnia: ${hashes.join(' ')} blob: ${wasmWorker}`;
  }
  return ['script-src', "'self'", 'surnia:'].join(' ');
}
/**
 * SECURITY CONTRACT — the effective renderer policy always begins with:
 *   script-src 'self' surnia:
 * plus runtime sha256 hashes of the built boot/entry scripts. No unsafe-eval.
 */
const SCRIPT_SRC_BASE = ['script-src', "'self'", 'surnia:'].join(' ');

const RENDERER_CSP = [
  "default-src 'self' surnia: blob: data:",
  rendererScriptSrc(),
  "style-src 'self' surnia: 'unsafe-inline'",
  "img-src 'self' surnia: data: blob: https:",
  "media-src 'self' surnia: blob: data:",
  "font-src 'self' surnia: data:",
  "connect-src 'self' surnia: http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*",
  "worker-src 'self' surnia: blob:",
  "frame-src 'self' surnia: http://127.0.0.1:* http://localhost:* https:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function serveRenderer(): void {
  try {
    protocol.handle('surnia', (request) => {
      try {
        const u = new URL(request.url);
        if (u.host !== 'bundle') return new Response('not found', { status: 404 });
        let pathname = decodeURIComponent(u.pathname);
        if (pathname === '/' || pathname === '') pathname = '/index.html';
        const resolved = path.resolve(DIST_ROOT, '.' + pathname);
        // traversal guard: resolved must stay inside DIST_ROOT
        if (resolved !== DIST_ROOT && !resolved.startsWith(DIST_ROOT + path.sep)) {
          LOG('warn', 'protocol', `blocked traversal: ${request.url}`);
          return new Response('forbidden', { status: 403 });
        }
        let file = resolved;
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          file = path.join(DIST_ROOT, 'index.html'); // SPA fallback
        }
        const ext = path.extname(file).toLowerCase();
        const isDocument = ext === '.html';
        return new Response(fs.readFileSync(file), {
          status: 200,
          headers: {
            'content-type': MIME[ext] ?? 'application/octet-stream',
            'cache-control': 'no-cache',
            // CSP on documents AND their scripts/styles (defense in depth —
            // a header on the document governs the page; the per-asset
            // headers additionally protect any direct worker/embed loads).
            ...(isDocument ? { 'content-security-policy': RENDERER_CSP } : {}),
            'x-content-type-options': 'nosniff',
          },
        });
      } catch (err) {
        LOG('error', 'protocol', `serve failed: ${err instanceof Error ? err.message : String(err)}`);
        return new Response('internal error', { status: 500 });
      }
    });
    protocolReady = true;
    LOG('info', 'protocol', 'surnia:// handler registered');
  } catch (err) {
    protocolReady = false;
    LOG('error', 'protocol', `registration failed, file:// fallback stays: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ============================================================
// GPU safety — the #1 cause of a blank white window on Windows
// is a GPU/driver crash inside Chromium. Surnia is a developer
// tool: Monaco + xterm render perfectly on the CPU rasterizer,
// so we default to software rendering. Power users can opt back
// in with KODEX_ENABLE_GPU=1.
// ============================================================
if (process.env.KODEX_ENABLE_GPU !== '1') {
  app.disableHardwareAcceleration();
}
app.commandLine.appendSwitch('disable-gpu-sandbox');

// __dirname = dist-electron/electron → repo root is two levels up
const REPO_ROOT = path.join(__dirname, '..', '..');
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const IS_SMOKE = process.env.KODEX_SMOKE === '1';
const TOUR_SCREEN = process.env.KODEX_TOUR_SCREEN; // screenshot tour: pin a screen

let mainWindow: BrowserWindow | null = null;
// v2.6 — visual-effects circuit breaker. The Liquid-Glass layer is cheap but
// NOT free on software compositors (SwiftShader / RDP / low-end iGPU):
// stacked backdrop-filters + the animated aurora can kill the renderer
// (SharedImageManager "non-existent mailbox" → render-process-gone). After
// the first crash the recreated window runs with effects DEGRADED, so a
// crash-loop becomes impossible; the user keeps a fully usable app.
let fxOff = process.env.SURNA_FX_OFF === '1';
// v2.6 — persisted breaker: one crash is enough. The flag survives restarts
// (userData/surnia-fx-off marker) so a fragile machine lands in degraded
// mode on every future boot instead of crashing again.
function fxMarkerFile(): string {
  try {
    return path.join(app.getPath('userData'), 'surnia-fx-off');
  } catch {
    return '';
  }
}
function loadFxMarker(): void {
  const f = fxMarkerFile();
  if (!f) return;
  try {
    if (fs.existsSync(f)) fxOff = true;
  } catch { /* marker is advisory */ }
}
function writeFxMarker(): void {
  const f = fxMarkerFile();
  if (!f) return;
  try {
    fs.writeFileSync(f, new Date().toISOString(), 'utf8');
  } catch { /* best-effort */ }
}
// True while app.quit() is in flight — distinguishes "user closed the window"
// (possibly hide to tray) from "the app is really quitting".
let isQuitting = false;

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

// ---------- window ----------
function createWindow(): void {
  // Restore last session's bounds (missing/corrupt state → defaults, centered).
  const saved = loadWindowState();
  const win = new BrowserWindow({
    width: saved?.width ?? 1480,
    height: saved?.height ?? 920,
    minWidth: 1100,
    minHeight: 680,
    ...(saved?.x != null && saved?.y != null ? { x: saved.x, y: saved.y } : {}),
    frame: false,
    show: false,
    backgroundColor: '#232A2E',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // SECURITY (v7.2): `sandbox: true` — the audit flagged the old
      // sandbox:false (v2.2 claimed the preload needed Node access; the
      // current preload uses ONLY contextBridge + ipcRenderer, which work
      // inside a sandboxed preload). The renderer process now runs without
      // Node. Compensation layers all ON: contextIsolation,
      // nodeIntegration:false, CSP in index.html, permission handler below,
      // webview guest hardening in web-contents-created below.
      sandbox: true,
      // Live Preview panel uses <webview> (src/components/PreviewArea.tsx) —
      // it CANNOT be disabled; guests are hardened in web-contents-created.
      webviewTag: true,
      spellcheck: false, // v2.2 — no renderer spellcheck session/data leakage
    },
  });
  mainWindow = win;

  // ---------- desktop polish: close-to-tray + bounds persistence ----------
  // Hide to tray instead of closing — only when the setting is on AND a live
  // tray exists (a hidden window with no tray icon would be unrecoverable).
  win.on('close', (e) => {
    if (isQuitting) return;
    try {
      if (getSettings().closeToTray && isTrayActive()) {
        e.preventDefault();
        win.hide();
      }
    } catch {
      /* settings unavailable → close normally */
    }
  });

  // Persist bounds (debounced — moved/resized fire continuously while dragging).
  let stateTimer: NodeJS.Timeout | null = null;
  const queueSaveState = (): void => {
    if (stateTimer) clearTimeout(stateTimer);
    stateTimer = setTimeout(() => {
      stateTimer = null;
      try {
        if (!win.isDestroyed()) saveWindowState(win.getBounds());
      } catch {
        /* best-effort */
      }
    }, 500);
  };
  win.on('moved', queueSaveState);
  win.on('resized', queueSaveState);

  // ---------- diagnostics: every failure lands in main.log ----------
  win.webContents.on('preload-error', (_e, p, err) => {
    LOG('error', 'preload', `PRELOAD ERROR ${p}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  });
  // Electron 45 replaced the legacy (level, message, line, sourceId) args with
  // a single MessageDetails object. Accept both shapes so renderer diagnostics
  // keep logging correctly after the Electron 33 -> 45 upgrade.
  win.webContents.on('console-message', (_e, details: unknown, legacyMessage?: unknown, legacyLine?: unknown, legacySource?: unknown) => {
    let level: number;
    let message: string;
    let line: unknown;
    let sourceId: unknown;
    if (details && typeof details === 'object' && 'message' in details) {
      const d = details as { level?: number; message?: string; lineNumber?: number; sourceUrl?: string };
      level = d.level ?? 0;
      message = d.message ?? '';
      line = d.lineNumber ?? 0;
      sourceId = d.sourceUrl ?? '';
    } else {
      level = typeof details === 'number' ? details : 0;
      message = String(legacyMessage ?? '');
      line = legacyLine;
      sourceId = legacySource;
    }
    const lvl = level >= 3 ? 'error' : level === 2 ? 'warn' : 'info';
    LOG(lvl, 'renderer', `${message} (${sourceId}:${line})`);
  });
  win.webContents.on('unresponsive', () => LOG('warn', 'renderer', 'renderer unresponsive'));
  win.webContents.on('responsive', () => LOG('info', 'renderer', 'renderer responsive'));

  // ---------- resilience: retry failed loads; recover from renderer crashes ----------
  const indexFile = path.join(REPO_ROOT, 'dist', 'index.html');
  if (!fs.existsSync(indexFile)) {
    LOG('error', 'boot', `bundle incomplete — missing ${indexFile}`);
    dialog.showErrorBox(
      'SADEEM — installation problem',
      `The app bundle is incomplete (missing ${indexFile}). Please reinstall SADEEM.`,
    );
    app.exit(1);
    return;
  }
  let loadRetries = 0;
  const loadIndex = (): void => {
    // v2.6 — fx=off travels with the URL: the renderer reads it on boot and
    // hard-disables the glass/aurora/specular layer (html.fx-off).
    if (DEV_URL) {
      void win.loadURL(DEV_URL + (fxOff ? (DEV_URL.includes('?') ? '&' : '?') + 'fx=off' : ''));
    } else if (protocolReady) {
      // THE white-screen fix: real origin for ES modules under production.
      const q = [
        TOUR_SCREEN ? `screen=${encodeURIComponent(TOUR_SCREEN)}` : '',
        fxOff ? 'fx=off' : '',
      ]
        .filter(Boolean)
        .join('&');
      void win.loadURL(`surnia://bundle/index.html${q ? `?${q}` : ''}`);
    } else {
      const q = [
        TOUR_SCREEN ? `screen=${encodeURIComponent(TOUR_SCREEN)}` : '',
        fxOff ? 'fx=off' : '',
      ]
        .filter(Boolean)
        .join('&');
      void win.loadFile(indexFile, q ? { search: `?${q}` } : undefined);
    }
  };
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain) return;
    LOG('error', 'load', `did-fail-load ${code} ${desc} ${url}`);
    if (loadRetries++ < 3) setTimeout(loadIndex, 600 * loadRetries);
    else {
      dialog.showErrorBox(
        'Surnia — failed to load the interface',
        `The interface failed to start (${code} ${desc}). Restart the app; if the problem persists, reinstall Surnia.`,
      );
    }
  });
  win.webContents.on('did-finish-load', () => {
    LOG('info', 'load', `did-finish-load ${win.webContents.getURL()}`);
  });
  let goneRestarts = 0;
  win.webContents.on('render-process-gone', (_e, details) => {
    LOG('error', 'renderer', `render-process-gone: ${details.reason} exitCode=${details.exitCode}`);
    if (details.reason === 'clean-exit') return;
    if (goneRestarts++ < 2) {
      // v2.6 — first crash flips the effects breaker ON permanently (marker
      // persisted to userData): a degraded-but-alive app beats a crash-looping
      // pretty one, on every future launch too.
      if (!fxOff) {
        fxOff = true;
        writeFxMarker();
        LOG('warn', 'renderer', 'visual effects disabled after renderer crash (fx circuit breaker, persisted)');
      }
      // Recreate a fresh window immediately — the old one is a white void.
      try { win.destroy(); } catch { /* already gone */ }
      mainWindow = null;
      createWindow();
    } else {
      dialog.showErrorBox(
        'Surnia — the interface restarted',
        `The renderer process exited unexpectedly (${details.reason}). Visual effects are now disabled for stability; start Surnia with SURNA_FX_OFF=0 removed or reinstall the app if this persists.`,
      );
    }
  });

  // Boot watchdog: never leave the user staring at nothing. If the page is
  // slow or broken we still show the window (the CSP boot overlay surfaces
  // the error) and record the fact.
  let shown = false;
  win.once('ready-to-show', () => {
    shown = true;
    win.show();
  });
  const watchdog = setTimeout(() => {
    if (!shown && !win.isDestroyed()) {
      LOG('error', 'boot', `ready-to-show did not fire within 20s — forcing show. url=${win.webContents.getURL()}`);
      win.show();
    }
  }, 20_000);
  win.once('closed', () => clearTimeout(watchdog));

  loadIndex();

  if (IS_SMOKE) {
    // Smoke v2: success REQUIRES the renderer mount marker
    // (document.documentElement.dataset.appMounted). A page that loads but
    // never mounts counts as a FAILURE — the old version printed OK on both
    // did-finish-load AND did-fail-load, which is exactly how the
    // white-screen bug shipped unnoticed.
    const t0 = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - t0;
      win.webContents
        .executeJavaScript("document.documentElement.dataset.appMounted === '1' ? 'MOUNTED' : 'NO'", true)
        .then((r) => {
          if (r === 'MOUNTED') {
            clearInterval(timer);
            console.log('KODEX_SMOKE_OK');
            setTimeout(() => app.exit(0), 800);
          } else if (elapsed > 15_000) {
            clearInterval(timer);
            console.log('KODEX_SMOKE_FAIL renderer never mounted');
            app.exit(1);
          }
        })
        .catch(() => {
          if (elapsed > 15_000) {
            clearInterval(timer);
            console.log('KODEX_SMOKE_FAIL executeJavaScript failed');
            app.exit(1);
          }
        });
    }, 400);
    win.once('closed', () => clearInterval(timer));
  }

  // Screenshot diagnostic mode: KODEX_SHOT=/path/out.png
  const shotPath = process.env.KODEX_SHOT;
  if (shotPath) {
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          // optional UI-driving snippet (screenshot tour: click through panels)
          const shotJs = process.env.KODEX_SHOT_JS;
          if (shotJs) {
            try {
              const jsResult = await win.webContents.executeJavaScript(shotJs, true);
              // QA harness: persist driver-returned diagnostics next to the PNG
              const resultPath = process.env.KODEX_SHOT_RESULT;
              if (resultPath && typeof jsResult === 'string') {
                const fs2 = await import('fs');
                fs2.writeFileSync(resultPath, jsResult);
              }
            } catch (jsErr) {
              LOG('warn', 'shot', `shot JS: ${String(jsErr).slice(0, 200)}`);
            }
            await new Promise((r) => setTimeout(r, 2500)); // let animations settle
          }
          const fs = await import('fs');
          // Harness hardening: a hidden/occluded window can hand back an
          // empty frame — retry capture up to 3× and keep the largest PNG;
          // remove any stale file FIRST so a timeout never leaves a
          // misleading old screenshot behind.
          try { fs.unlinkSync(shotPath); } catch { /* fresh */ }
          if (win.isMinimized()) win.restore();
          win.show();
          let bestSize = -1;
          let bestPng: Buffer | null = null;
          for (let i = 0; i < 3; i++) {
            const img = await win.webContents.capturePage();
            const png = img.toPNG();
            if (png.length > bestSize) { bestSize = png.length; bestPng = png; }
            if (bestSize > 10000) break;
            await new Promise((r) => setTimeout(r, 700));
          }
          if (!bestPng || bestSize === 0) throw new Error('capturePage returned an empty frame');
          fs.writeFileSync(shotPath, bestPng);
          console.log('KODEX_SHOT_SAVED');
        } catch (err) {
          console.error('KODEX_SHOT_FAIL', err);
        } finally {
          app.exit(0);
        }
      }, 6500); // generous: workspace tour pins seed data via store actions
    });
  }

  win.on('closed', () => {
    if (stateTimer) clearTimeout(stateTimer);
    mainWindow = null;
  });
}

// ---------- menu ----------
function sendMenuAction(action: string): void {
  getMainWindow()?.webContents.send('kdx:menu', action);
}

function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuAction('open-folder'),
        },
      ],
    },
    {
      label: 'Session',
      submenu: [
        {
          label: 'New Session',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuAction('new-session'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Terminal',
          accelerator: 'CmdOrCtrl+`',
          click: () => sendMenuAction('toggle-terminal'),
        },
        {
          label: 'Toggle Preview',
          accelerator: 'CmdOrCtrl+Shift+V',
          click: () => sendMenuAction('toggle-preview'),
        },
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+K',
          click: () => sendMenuAction('palette'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendMenuAction('settings'),
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

// ---------- window-scope IPC ----------
function registerWindowIpc(): void {
  ipcMain.handle('kdx:win', (event, action: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    if (action === 'min') {
      win.minimize();
    } else if (action === 'max') {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === 'close') {
      win.close();
    }
    return true;
  });

  // Renderer → file log (uncaught errors, promise rejections, api failures)
  ipcMain.handle('kdx:log', (_event, level: number, message: string) => {
    const lvl = typeof level === 'number' && level >= 3 ? 'error' : level === 2 ? 'warn' : 'info';
    LOG(lvl, 'renderer', String(message).slice(0, 4000));
    return true;
  });

  ipcMain.handle('kdx:dialog:openFolder', async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow() ?? undefined;
    const result = await dialog.showOpenDialog(parent as BrowserWindow, {
      properties: ['openDirectory'],
    });
    const chosen = result.filePaths[0] ?? null;
    // v2.2 SECURITY — explicit confinement: the moment main learns the
    // workspace (dialog pick), pin the fs sandbox root to it and keep the
    // appData dir reachable. (kdx:workspace:set covers the auto-open-last
    // path; the readDir auto-adopt remains as a last-resort fallback.)
    if (chosen) {
      try {
        setConfineRoot(chosen);
        addAllowedRoot(app.getPath('userData'));
        LOG('info', 'security', `confine root set to ${chosen}`);
      } catch (err) {
        LOG('warn', 'security', `confine root failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return chosen;
  });

  ipcMain.handle('kdx:openExternal', (_event, url: string) => {
    try {
      const parsed = new URL(String(url));
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        void shell.openExternal(parsed.toString());
        return true;
      }
    } catch {
      /* invalid URL */
    }
    return false;
  });
}

// ---------- agent MCP probe ----------
function registerMcpIpc(): void {
  ipcMain.handle('kdx:mcp:test', async (_event, server: MCPServerConfig) => {
    try {
      return await mcpListTools(server);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

// ============================================================
// Window & webview hardening (defense-in-depth):
//  - popups from any webContents are denied; http(s) goes to the OS browser
//  - webview guests (Live Preview) run with nodeIntegration OFF,
//    contextIsolation ON, no preload, and only http(s)/localhost sources
//  - permission requests (camera/midi/geolocation/…) default-deny except
//    fullscreen + clipboard write, for the app session AND persist:preview
// ============================================================
app.on('web-contents-created', (_event, wc) => {
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    } else {
      LOG('warn', 'security', `blocked window.open to ${url.slice(0, 120)}`);
    }
    return { action: 'deny' };
  });
  wc.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    const src = String(params.src ?? '');
    const ok =
      /^https?:\/\//i.test(src) &&
      (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(src) || /^https:\/\//i.test(src));
    if (!ok) {
      LOG('warn', 'security', `blocked webview attach to ${src.slice(0, 120)}`);
      event.preventDefault();
    }
  });
});

function hardenSessionPerms(sess: Electron.Session): void {
  try {
    sess.setPermissionRequestHandler((_wc, permission, callback) => {
      // v10.2 — 'media' granted: the composer mic button (voice input) was
      // silently denied here since v2.3 — getUserMedia could never start.
      callback(
        permission === 'fullscreen' ||
          permission === 'clipboard-sanitized-write' ||
          permission === 'media',
      );
    });
    // v10.2 — Chromium also consults the SYNC permission-check handler for
    // mediaDevices.enumerateDevices()/queryStatus; without it the mic picker
    // reports "no devices" even after the request handler allows 'media'.
    try {
      sess.setPermissionCheckHandler((_wc, permission /*, origin, details */) =>
        permission === 'fullscreen' || permission === 'clipboard-sanitized-write' || permission === 'media',
      );
    } catch {
      /* older Electron without the check handler — request handler still covers capture */
    }
  } catch {
    /* older Electron without a given handler — best effort */
  }
}

// ---------- bootstrap ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // ============================================================
  // v11.3 — SADEEM WEBSITE ACTIVATION DEEP LINK
  // The website hands the signed-in user back to the app via
  //   sadeem://auth/callback?pair=XXXXXX&email=...&name=...&plan=...&lic=KDX-...
  // macOS delivers it through 'open-url'; Windows/Linux through a
  // second-instance launch (argv containing the URL). The pair code
  // must match a pending code minted by kdx:auth:web-begin.
  // ============================================================
  const AUTH_URL_RE = /^sadeem:\/\/auth\/callback\?(.+)$/i;
  const handleAuthDeepLink = (raw: string): void => {
    try {
      const m = AUTH_URL_RE.exec(raw.trim());
      if (!m) return;
      const q = new URLSearchParams(m[1]);
      const payload = {
        pair: q.get('pair') ?? undefined,
        email: q.get('email') ?? undefined,
        name: q.get('name') ?? undefined,
        plan: q.get('plan') ?? undefined,
        // v11.33 — a signed license key is the ONLY receipt that can back a
        // paid plan. The browser's `plan` claim is verified in completeWebAuth.
        lic: q.get('lic') ?? undefined,
      };
      // P1 (launch audit) — the pair code is the only proof of origin and is
      // consumed on first use inside completeWebAuth (TTL + one-use preserved).
      // Reject malformed callbacks BEFORE they can mint/refresh an account, and
      // report the reason honestly to the renderer instead of silently pairing.
      if (!payload.pair || !payload.email) {
        LOG('warn', 'auth', 'deep-link callback rejected: missing pair or email');
        const winBad = getMainWindow();
        if (winBad && !winBad.isDestroyed()) {
          winBad.webContents.send('kdx:auth:changed', { ok: false, error: 'no_account' });
        }
        return;
      }
      const res = completeWebAuth(payload);
      LOG('info', 'auth', `deep-link callback: ${res.ok ? 'paired' : res.error}`);
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        if (res.ok) win.show();
        win.webContents.send('kdx:auth:changed', res);
      }
    } catch (err) {
      LOG('error', 'auth', `deep-link failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const scanArgvForAuthLink = (argv: string[]): void => {
    for (const a of argv) if (AUTH_URL_RE.test(a)) {
      handleAuthDeepLink(a);
      break;
    }
  };

  app.on('second-instance', (_event, argv) => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    scanArgvForAuthLink(argv); // v11.3 — Windows/Linux activation callback
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleAuthDeepLink(url); // v11.3 — macOS activation callback
  });
  // Claim the sadeem:// scheme (idempotent). In dev the executable is
  // electron itself — pass the app path so argv parsing finds the URL.
  try {
    if (process.defaultApp) {
      if (process.argv.length >= 2) app.setAsDefaultProtocolClient('sadeem', process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient('sadeem');
    }
  } catch {
    /* scheme registration is best-effort — manual URL copy still works */
  }
  // a deep link may have LAUNCHED the app (cold start on Windows/Linux)
  app.whenReady().then(() => scanArgvForAuthLink(process.argv.slice(1)));

  process.on('uncaughtException', (err) => {
    LOG('error', 'main', `uncaughtException: ${err.stack ?? err.message}`);
  });
  process.on('unhandledRejection', (reason) => {
    LOG('error', 'main', `unhandledRejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
  });

  void app.whenReady().then(() => {
    loadFxMarker(); // v2.6 — persisted fx breaker: a previously-crashed machine boots degraded
    serveRenderer();
    hardenSessionPerms(session.defaultSession);
    hardenSessionPerms(session.fromPartition('persist:preview'));
    // v2.2 — the appData dir is ALWAYS an allowed fs root (settings, sessions,
    // DNA, checkpoints live there); the workspace root is pinned explicitly on
    // openFolder / kdx:workspace:set, with auto-adopt as the fallback.
    addAllowedRoot(app.getPath('userData'));
    LOG('info', 'boot', `starting SADEEM v${app.getVersion()} | userData=${app.getPath('userData')} | log=${logPath() ?? 'unavailable'}`);
    // Terminal audit trail → rotating file log (who ran what, when).
    setAuditSink((line) => LOG('info', 'term', line));
    // Agent ↔ device bridge: the tools layer is electron-free; inject here.
    setDeviceImpl({
      screenshotScreen: device.screenshotScreen,
      openPath: device.openPath,
      clipboardRead: device.clipboardRead,
      clipboardWrite: device.clipboardWrite,
      notify: device.notify,
      // v3.1 — desktop-assistant powers (reveal / trash / clipboard image / PDF print)
      revealInFolder: device.revealInFolder,
      trashItem: device.trashItem,
      clipboardImage: device.clipboardImage,
      printToPdf: device.printToPdf,
      // v10.3 — computer use: launch desktop applications (Blender, Chrome…)
      launchApp: device.launchApp,
    });
    // v3 — background processes: logs live under userData, and every stray
    // dev server the agent started is killed when the app quits.
    setProcessLogsDir(path.join(app.getPath('userData'), 'process-logs'));
    registerIpc({ getMainWindow });
    scheduleAutoCheck();
    initApiServer(); // start the loopback control API if enabled in settings
    initRemoteServer(); // v11.7 — SADEEM Remote (phone control over LAN) when enabled
    // Scheduled agent jobs: 30s tick + 'kdx:schedule-event' broadcast to the UI.
    initScheduleService({
      userDataDir: app.getPath('userData'),
      broadcast: (payload) => {
        try {
          getMainWindow()?.webContents.send('kdx:schedule-event', payload);
        } catch {
          /* window closing */
        }
      },
    });
    initTray(getMainWindow); // desktop polish: system tray (self-disabling on failure)
    registerAgentIpc(ipcMain, () => mainWindow?.webContents ?? null);
    registerWindowIpc();

    // Global quick-summon hotkey — show/hide Surnia from anywhere.
    try {
      globalShortcut.register('Control+Alt+K', () => {
        const win = getMainWindow();
        if (!win) return;
        if (win.isVisible() && win.isFocused()) {
          win.hide();
        } else {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        }
      });
    } catch {
      /* hotkey is best-effort */
    }
    registerMcpIpc();
    Menu.setApplicationMenu(buildMenu());
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
    destroyTray();
  });

  // Scheduler teardown: stop the 30s tick and abort in-flight headless runs.
  // v3 — also kill every background process the agent started (dev servers):
  // nothing the model launched may outlive the app.
  app.on('will-quit', () => {
    try {
      stopAllBackgroundProcesses();
    } catch {
      /* best-effort */
    }
    // v3.1 — dispose every pooled MCP client (stdio children must not outlive
    // the app; Agent A exports closeAllMcpClients for exactly this).
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { closeAllMcpClients } = require('./agent/mcp') as { closeAllMcpClients?: () => void };
      closeAllMcpClients?.();
    } catch {
      /* best-effort */
    }
    try {
      shutdownScheduleService();
    } catch {
      /* best-effort */
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
