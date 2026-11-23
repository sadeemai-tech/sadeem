// ============================================================
// Surnia — window state persistence (<userData>/window-state.json)
// Restores last window bounds on startup. Validation + work-area
// intersection guarantee the window can never come back fully
// off-screen (corrupt/garbage state degrades to centered).
// Every function is best-effort: never throws; failures are LOGGED.
//
// v11.31 audit fixes:
//   · position is validated against ANY display's work area (a window
//     restored on a secondary monitor is no longer thrown away);
//   · x/y are bounded to a sane range before use;
//   · the atomic tmp+rename write has a documented fallback if the
//     platform refuses to replace an existing target;
//   · corrupt/unreadable state produces a DEBUG reason, not silence.
// ============================================================
import { app, screen } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { logLine } from './logService';

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

const SIZE_MIN = 400;
const SIZE_MAX = 16000;
const COORD_MAX = 100000;

function errText(err: unknown): string {
  return String(err instanceof Error ? err.message : err ?? '').slice(0, 240);
}

function statePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function clampSize(n: unknown, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(n)));
}

function clampCoord(n: number): number {
  return Math.min(COORD_MAX, Math.max(-COORD_MAX, Math.round(n)));
}

/** Does the (clamped) rect overlap ANY connected display's work area? */
function overlapsAnyDisplay(x: number, y: number, width: number, height: number): boolean {
  try {
    const displays = screen.getAllDisplays?.() ?? [];
    const areas = displays.length
      ? displays.map((d) => d.workArea)
      : [screen.getPrimaryDisplay().workArea];
    return areas.some(
      (wa) =>
        x + width > wa.x &&
        y + height > wa.y &&
        x < wa.x + wa.width &&
        y < wa.y + wa.height,
    );
  } catch (err) {
    logLine('debug', 'window-state', `display check failed: ${errText(err)}`);
    return false; // safest: let the OS center the window
  }
}

/**
 * Read the persisted window state, or null when absent/corrupt
 * (caller falls back to defaults and lets Electron center it).
 */
export function loadWindowState(): WindowState | null {
  try {
    const raw = fs.readFileSync(statePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<WindowState> | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      logLine('debug', 'window-state', 'ignored non-object state file');
      return null;
    }

    const state: WindowState = {
      width: clampSize(parsed.width, 1480),
      height: clampSize(parsed.height, 920),
    };

    // x/y must be finite numbers; anything else → centered.
    const x = typeof parsed.x === 'number' && Number.isFinite(parsed.x) ? clampCoord(parsed.x) : null;
    const y = typeof parsed.y === 'number' && Number.isFinite(parsed.y) ? clampCoord(parsed.y) : null;

    if (x !== null && y !== null) {
      // Fully off-screen (e.g. monitor unplugged since last run)?
      // Drop the position and let the OS center the window instead.
      if (overlapsAnyDisplay(x, y, state.width, state.height)) {
        state.x = x;
        state.y = y;
      } else {
        logLine('debug', 'window-state', 'saved position is off-screen — centering');
      }
    }

    return state;
  } catch (err) {
    logLine('debug', 'window-state', `load failed (using defaults): ${errText(err)}`);
    return null; // missing / corrupt / unreadable — centered defaults
  }
}

/**
 * Persist window bounds atomically (write tmp + rename) so a crash
 * mid-write can never leave a half-written state file behind.
 * The bytecode is tiny; a rename failure is retried after removing
 * the target, then (last resort) a direct write is attempted. Every
 * outcome is reported — no silent give-up.
 */
export function saveWindowState(bounds: { x?: number; y?: number; width: number; height: number }): void {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    const state: WindowState = {
      x: typeof bounds.x === 'number' && Number.isFinite(bounds.x) ? clampCoord(bounds.x) : undefined,
      y: typeof bounds.y === 'number' && Number.isFinite(bounds.y) ? clampCoord(bounds.y) : undefined,
      width: clampSize(bounds.width, 1480),
      height: clampSize(bounds.height, 920),
    };
    const target = statePath();
    const tmp = `${target}.tmp`;
    const payload = JSON.stringify(state, null, 2);
    fs.writeFileSync(tmp, payload, 'utf8');
    try {
      fs.renameSync(tmp, target);
    } catch (renameErr) {
      // Some Windows filesystems / AV scanners refuse an in-place replace.
      try {
        fs.rmSync(target, { force: true });
        fs.renameSync(tmp, target);
        logLine('debug', 'window-state', `rename needed target replacement: ${errText(renameErr)}`);
      } catch (retryErr) {
        // Last resort: direct write. Less atomic, but the state is saved.
        fs.writeFileSync(target, payload, 'utf8');
        try {
          fs.rmSync(tmp, { force: true });
        } catch {
          /* temp cleanup is cosmetic */
        }
        logLine('warn', 'window-state', `atomic rename failed, wrote directly: ${errText(retryErr)}`);
      }
    }
  } catch (err) {
    // A failed state save must never break the app — but it must be visible.
    logLine('warn', 'window-state', `save failed: ${errText(err)}`);
  }
}
