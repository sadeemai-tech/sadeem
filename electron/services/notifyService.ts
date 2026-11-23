// ============================================================
// Surnia — desktop notification service
// Fires an OS notification when an agent run finishes while the
// user is elsewhere (no focused Surnia window). Clicking the
// notification refocuses a LIVE Surnia window. Strictly
// best-effort: a failure is LOGGED (never silent) but must never
// crash a run.
//
// v11.31 audit fixes:
//   · DEDUP — identical title+body inside DEDUP_WINDOW_MS is shown
//     once; a global cooldown stops a burst of different toasts.
//   · PERMISSION — isSupported() plus any platform `permission`
//     signal is checked before constructing a Notification.
//   · CLICK — picks the first NON-DESTROYED window (not blindly [0]),
//     restores/show/focuses it, and logs failures.
// ============================================================
import { BrowserWindow, Notification } from 'electron';
import { getSettings } from './storeService';
import { logLine } from './logService';

/** Identical notifications inside this window are suppressed. */
export const DEDUP_WINDOW_MS = 15_000;
/** Even different notifications cannot fire faster than this. */
export const GLOBAL_COOLDOWN_MS = 750;
/** Bound the dedup map (oldest entries are pruned). */
const MAX_DEDUP_KEYS = 256;

const lastShown = new Map<string, number>();
let lastAnyShownAt = 0;

/** Test/lifecycle hook — clears dedup + cooldown state. */
export function resetNotifyState(): void {
  lastShown.clear();
  lastAnyShownAt = 0;
}

function errText(err: unknown): string {
  return String(err instanceof Error ? err.message : err ?? '').slice(0, 240);
}

/**
 * Settings gate for "agent finished" notifications.
 * Default ON (`doneNotifications !== false`); any settings error → enabled.
 */
export function isDoneNotificationsEnabled(): boolean {
  try {
    return getSettings().doneNotifications !== false;
  } catch {
    return true;
  }
}

export type NotificationPermission = 'granted' | 'denied' | 'unsupported';

/**
 * A notification can only be shown when the platform supports it AND has not
 * explicitly denied permission. Electron exposes no web-style permission
 * prompt; when a platform/stub surfaces `permission === 'denied'` we honour it.
 */
export function notificationPermission(): NotificationPermission {
  try {
    if (!Notification.isSupported()) return 'unsupported';
    const perm = (Notification as unknown as { permission?: string }).permission;
    if (perm === 'denied') return 'denied';
    return 'granted';
  } catch {
    return 'unsupported';
  }
}

/**
 * Notify that an agent run finished. Skipped when:
 *  - the caller explicitly passes { enabled: false }, or
 *  - the user turned notifications off in settings, or
 *  - a Surnia window currently has focus (the user is already here), or
 *  - the same notification fired recently (dedup) — no silent duplicate.
 */
export function notifyAgentDone(title: string, body: string, opts?: { enabled?: boolean }): void {
  try {
    if (opts?.enabled === false) return;
    if (!isDoneNotificationsEnabled()) return;

    // Only notify when the user is elsewhere — never nag a focused app.
    const focused = BrowserWindow.getAllWindows().some((w) => w.isFocused?.() === true);
    if (focused) return;

    showNotification(title, body);
  } catch (err) {
    logLine('warn', 'notify', `notifyAgentDone failed: ${errText(err)}`);
  }
}

// ---------- shared plumbing ----------

/** Bring a LIVE window to the front. Never blindly takes getAllWindows()[0]. */
function focusMainWindow(): void {
  try {
    const windows = BrowserWindow.getAllWindows().filter((w) => w.isDestroyed?.() !== true);
    // Prefer a window the user can actually see; fall back to any live one.
    const win =
      windows.find((w) => w.isVisible?.() === true && w.isMinimized?.() !== true) ?? windows[0];
    if (!win) {
      logLine('debug', 'notify', 'click: no live window to focus');
      return;
    }
    if (win.isMinimized?.()) win.restore();
    win.show();
    win.focus();
  } catch (err) {
    logLine('warn', 'notify', `click focus failed: ${errText(err)}`);
  }
}

/**
 * Fire one OS notification. Returns true only when it was really shown.
 * Dedup + permission + cooldown are enforced here so EVERY entry point
 * (done / approval / error / schedule) is protected.
 */
function showNotification(title: string, body: string): boolean {
  try {
    const key = `${title}\u0000${body}`;
    const now = Date.now();

    const seenAt = lastShown.get(key) ?? 0;
    if (now - seenAt < DEDUP_WINDOW_MS) {
      logLine('debug', 'notify', `dedup: identical notification suppressed (${title})`);
      return false;
    }
    if (now - lastAnyShownAt < GLOBAL_COOLDOWN_MS) {
      logLine('debug', 'notify', 'cooldown: notification burst suppressed');
      return false;
    }

    const permission = notificationPermission();
    if (permission !== 'granted') {
      // No silent failure: the UI/log says WHY no toast appeared.
      logLine('warn', 'notify', `notification unavailable (permission=${permission})`);
      return false;
    }

    const notification = new Notification({ title, body, silent: false });
    notification.on('click', () => focusMainWindow());
    notification.show();

    lastShown.set(key, now);
    lastAnyShownAt = now;
    if (lastShown.size > MAX_DEDUP_KEYS) {
      for (const [k, t] of lastShown) {
        if (now - t > DEDUP_WINDOW_MS) lastShown.delete(k);
      }
    }
    return true;
  } catch (err) {
    logLine('warn', 'notify', `show failed: ${errText(err)}`);
    return false;
  }
}

/** Same gate as notifyAgentDone (the single notification settings flag). */
function gated(title: string, body: string): void {
  try {
    if (!isDoneNotificationsEnabled()) return;
    const focused = BrowserWindow.getAllWindows().some((w) => w.isFocused?.() === true);
    if (focused) return; // an in-app banner is already visible when focused
    showNotification(title, body);
  } catch (err) {
    logLine('warn', 'notify', `gated notification failed: ${errText(err)}`);
  }
}

/** An agent run is waiting for an approval decision (user is likely away). */
export function notifyApprovalNeeded(title: string): void {
  gated('Surnia — approval needed', title);
}

/** A headless/scheduled run failed — surface it even without a focused window. */
export function notifyError(title: string, body: string): void {
  gated(title || 'Surnia', body || title || 'Surnia');
}

/** A scheduled job finished (ok or failed). Called by scheduleService. */
export function notifyScheduleDone(jobName: string, ok: boolean): void {
  gated(
    'Surnia — schedule',
    ok ? `Job “${jobName}” finished successfully` : `Job “${jobName}” failed — open the session for details`,
  );
}
