// ============================================================
// Surnia — system tray service
// Tray icon with a Show/Quit context menu; left click toggles
// window visibility. Tray is optional polish: if the icon can't be
// resolved or the Tray cannot be created, the feature disables
// itself — but the reason is now LOGGED, never silent, and a
// partially-created Tray is destroyed instead of leaking.
//
// v11.31 audit fixes:
//   · menu actions operate on a LIVE window (isDestroyed guard);
//   · every failure is logged with a reason;
//   · initTray publishes `tray` only after full setup succeeds, so
//     isTrayActive() can never lie about a half-built tray.
// ============================================================
import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import type { NativeImage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { logLine } from './logService';

let tray: Tray | null = null;

// This file compiles to dist-electron/electron/services/, so the
// repo root is three levels up (services → electron → dist-electron → root).
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

function errText(err: unknown): string {
  return String(err instanceof Error ? err.message : err ?? '').slice(0, 240);
}

function resolveTrayIcon(): NativeImage {
  const candidates: string[] = [
    // Packaged app resources (electron-builder "extraResources"/build dir).
    process.resourcesPath ? path.join(process.resourcesPath, 'icon.png') : '',
    // Dev / unpacked repo checkout.
    path.join(REPO_ROOT, 'build', 'icon.png'),
    path.join(REPO_ROOT, 'build', 'icon.ico'),
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return nativeImage.createFromPath(p);
    } catch (err) {
      logLine('debug', 'tray', `icon candidate failed (${p}): ${errText(err)}`);
    }
  }
  // No icon anywhere → empty 16x16-class placeholder; the tray still works.
  logLine('debug', 'tray', 'no tray icon file found — using empty placeholder');
  return nativeImage.createEmpty();
}

function liveWindow(getWindow: () => BrowserWindow | null): BrowserWindow | null {
  const win = getWindow();
  if (!win || win.isDestroyed?.() === true) return null;
  return win;
}

function showAndFocus(getWindow: () => BrowserWindow | null): void {
  const win = liveWindow(getWindow);
  if (!win) {
    logLine('debug', 'tray', 'Show: no live window');
    return;
  }
  try {
    if (win.isMinimized?.()) win.restore();
    win.show();
    win.focus();
  } catch (err) {
    logLine('warn', 'tray', `Show failed: ${errText(err)}`);
  }
}

/** Whether a live tray exists (main.ts refuses close-to-tray without it). */
export function isTrayActive(): boolean {
  return tray !== null;
}

export function initTray(getWindow: () => BrowserWindow | null): void {
  if (tray) return; // already initialised
  let created: Tray | null = null;
  try {
    const icon = resolveTrayIcon();
    created = new Tray(icon);

    created.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Show Surnia',
          click: () => {
            logLine('debug', 'tray', 'menu: Show Surnia');
            showAndFocus(getWindow);
          },
        },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            logLine('info', 'tray', 'menu: Quit');
            app.quit();
          },
        },
      ]),
    );
    created.setToolTip('Surnia');

    // Left click: toggle window visibility.
    created.on('click', () => {
      try {
        const win = liveWindow(getWindow);
        if (!win) {
          logLine('debug', 'tray', 'click: no live window');
          return;
        }
        if (win.isVisible?.() === true && win.isMinimized?.() !== true) win.hide();
        else showAndFocus(getWindow);
      } catch (err) {
        logLine('warn', 'tray', `click toggle failed: ${errText(err)}`);
      }
    });

    // Only publish after every step succeeded — isTrayActive() is now honest.
    tray = created;
    logLine('info', 'tray', 'initialised');
  } catch (err) {
    // Tray is optional polish — never let it crash startup, but DO log why.
    try {
      created?.destroy();
    } catch {
      /* partial tray already gone */
    }
    logLine('warn', 'tray', `disabled: ${errText(err)}`);
    tray = null;
  }
}

export function destroyTray(): void {
  try {
    tray?.destroy();
  } catch (err) {
    logLine('debug', 'tray', `destroy failed: ${errText(err)}`);
  }
  tray = null;
}

/** Test hook — drop the singleton so a fresh initTray can be exercised. */
export function resetTrayForTests(): void {
  destroyTray();
}
