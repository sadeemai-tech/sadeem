// ============================================================
// SADEEM v11 — auto-update service (electron-updater wrapper).
// Honest contract:
//   · The feed is GENERIC (any static host — the website serves
//     latest.yml + artifacts at <site>/updates/).
//   · The URL is user-visible and user-editable in Settings →
//     Updates; nothing phones home beyond that feed.
//   · The check is MANUAL by default ("Check now") plus one
//     automatic check 10 min after boot; downloads never start
//     without the user clicking.
//   · Windows builds are currently UNSIGNED — electron-updater
//     still installs NSIS updates, but the UI says plainly that
//     signature verification is skipped until we buy a cert.
//
// v11.31 audit fixes:
//   · DEFAULT FEED no longer points at the undeployed `sadeem.app`
//     domain. It points at the LIVE Vercel deployment declared in
//     website/lib/site.ts (`updateFeed`). Override at runtime with
//     SADEEM_UPDATE_FEED_URL or in Settings → Updates.
//   · STORE/MSIX builds gate electron-updater completely and report
//     an explicit STORE_MANAGED status (no silent no-op).
//   · NO SECRET LEAKS — credentials in a feed URL are rejected, and
//     every error string is scrubbed (userinfo + query + redaction)
//     before it is logged or sent to the renderer.
//   · Rejected feed values are explained instead of silently
//     falling back, and a feed change resets stale "available" state.
// ============================================================
import { app, ipcMain } from 'electron';
import type { AppUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import type { AppSettings } from '../../shared/types';
import { getSettings, saveSettings } from './storeService';
import { logLine, redactText } from './logService';

/** The OFFICIAL update feed on the canonical domain `sadeem-ai.com`
 *  (mirrors website/lib/site.ts `updateFeed`). Older preview URLs and the
 *  undeployed sadeem.app are retired. Override via SADEEM_UPDATE_FEED_URL. */
export const LIVE_UPDATE_FEED = 'https://sadeem-ai.com/updates/';

let windowGetter: (() => import('electron').BrowserWindow | null) | null = null;
let updater: AppUpdater | null = null;
let lastStatus: { state: string; info?: unknown; progress?: unknown; error?: string; since?: number } = {
  state: 'idle',
  since: Date.now(),
};

/** Feed URL — settings.updates.feedUrl when set, else env override, else LIVE. */
export function feedUrl(): string {
  try {
    const s = getSettings() as { updates?: { feedUrl?: string; autoCheck?: boolean } };
    const stored = sanitizeFeedUrl(s.updates?.feedUrl ?? '');
    if (stored) return stored;
  } catch (err) {
    logLine('warn', 'update', `settings read failed: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`);
  }
  const envFeed = sanitizeFeedUrl(process.env.SADEEM_UPDATE_FEED_URL ?? '');
  return envFeed || LIVE_UPDATE_FEED;
}

/**
 * A8 security fix — the feed URL is a downloader of EXECUTABLE updates.
 * Accept ONLY https:// (http would let a network attacker swap installers;
 * Windows builds are unsigned today, so transport security is the only
 * integrity anchor). Loopback http stays allowed for dev/testing feeds.
 * Credentials in the URL are REJECTED (never stored/logged). An invalid
 * stored value (legacy http, ftp:, javascript:, …) resets to '' → live feed.
 */
export function sanitizeFeedUrl(raw: unknown): string {
  const url = String(raw ?? '').trim();
  if (!url) return '';
  try {
    const u = new URL(url);
    // A feed URL must never carry basic-auth credentials — they would leak
    // into settings.json, error messages and the renderer UI.
    if (u.username || u.password) return '';
    if (u.protocol === 'https:') return url;
    if (u.protocol === 'http:' && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname)) return url;
  } catch {
    /* not a URL */
  }
  return '';
}

/** A feed URL safe to print: no userinfo, no query string, no fragment. */
export function safeFeedForLog(raw: string): string {
  try {
    const u = new URL(raw);
    u.username = '';
    u.password = '';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return '<invalid-url>';
  }
}

/** Scrub every error string before it reaches logs or the renderer. */
export function scrubUpdateText(text: unknown): string {
  let s = String(text ?? '');
  try {
    const raw = feedUrl();
    if (raw && s.includes(raw)) s = s.split(raw).join(safeFeedForLog(raw));
  } catch {
    /* feedUrl() is best-effort */
  }
  // Strip URL userinfo from arbitrary upstream messages.
  s = s.replace(/\/\/[^\s/@:]+:[^\s/@]+@/g, '//«redacted»@');
  // Strip sensitive query parameters (?token=… / &api_key=… / ?sig=…).
  s = s.replace(/([?&])(?:token|key|api_key|apikey|password|secret|sig|signature)=[^&\s#]+/gi, '$1«redacted»');
  // Belt & braces: sk- keys, Bearer tokens, password=…, etc.
  return redactText(s).text;
}

/**
 * Microsoft Store / APPX (Desktop Bridge) builds must not self-update —
 * Store policy requires updates through the Store. Several independent
 * signals are checked so a Store build can never accidentally check.
 */
export function isStoreManagedEnvironment(): boolean {
  const proc = process as NodeJS.Process & { windowsStore?: boolean };
  if (proc.windowsStore === true) return true;
  const env = process.env;
  return (
    env.SADEEM_STORE_BUILD === '1' ||
    env.SADEEM_STORE_MANAGED === '1' ||
    Boolean(env.PACKAGE_FAMILY_NAME) ||
    Boolean(env.APPX_PACKAGE_FAMILY_NAME)
  );
}

/** An HONEST status for a build whose updates are handled by the Store. */
export function storeManagedStatus(): {
  state: string;
  error: string;
  since: number;
} {
  return {
    state: 'error',
    error:
      'STORE_MANAGED: updates are delivered by the Microsoft Store; the in-app updater is disabled in this build.',
    since: Date.now(),
  };
}

function push(status: typeof lastStatus): void {
  lastStatus = {
    ...status,
    ...(status.error ? { error: scrubUpdateText(status.error) } : {}),
    since: Date.now(),
  };
  if (lastStatus.state === 'error') logLine('warn', 'update', lastStatus.error ?? 'update failed');
  else logLine('debug', 'update', `state=${lastStatus.state}`);
  // A download/check event can land while the window is being destroyed
  // (quit-and-install, app shutdown). An unguarded send throws from inside
  // an electron-updater event handler — every other IPC sender in this repo
  // wraps its send for exactly this reason. lastStatus still records the
  // truth; the next kdx:update:status read returns it even if no window is up.
  try {
    const wc = windowGetter?.()?.webContents;
    if (wc && !wc.isDestroyed()) wc.send('kdx:update-status', lastStatus);
  } catch (err) {
    logLine('debug', 'update', `status push skipped: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`);
  }
}

/** main.ts hands the window getter in before registration. */
export function setWindowGetter(fn: () => import('electron').BrowserWindow | null): void {
  windowGetter = fn;
}

async function ensureUpdater(): Promise<AppUpdater | null> {
  if (isStoreManagedEnvironment()) {
    // Do not even import electron-updater in a Store build.
    push(storeManagedStatus());
    return null;
  }
  if (updater) return updater;
  try {
    // lazy require: keep startup fast and tolerate a missing module in dev
    const { autoUpdater } = (await import('electron-updater')) as { autoUpdater: AppUpdater };
    updater = autoUpdater;
    autoUpdater.autoDownload = false; // the user decides
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.disableWebInstaller = true;
    try {
      autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl() });
      logLine('info', 'update', `feed = ${safeFeedForLog(feedUrl())}`);
    } catch (e) {
      push({ state: 'error', error: `feed: ${String(e)}` });
      return null;
    }
    autoUpdater.on('checking-for-update', () => push({ state: 'checking' }));
    autoUpdater.on('update-available', (info: UpdateInfo) =>
      push({
        state: 'available',
        info: {
          version: info.version,
          releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes.slice(0, 2000) : '',
        },
      }),
    );
    autoUpdater.on('update-not-available', (info: UpdateInfo) =>
      push({ state: 'none', info: { version: info.version } }),
    );
    autoUpdater.on('download-progress', (p: ProgressInfo) =>
      push({
        state: 'downloading',
        progress: { percent: Math.round(p.percent), transferred: p.transferred, total: p.total },
      }),
    );
    autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
      push({ state: 'downloaded', info: { version: info.version } }),
    );
    autoUpdater.on('error', (err: Error) => push({ state: 'error', error: String(err?.message ?? err) }));
    return autoUpdater;
  } catch (e) {
    push({ state: 'error', error: `module: ${String(e)}` });
    return null;
  }
}

export function registerUpdateIpc(): void {
  ipcMain.handle('kdx:update:status', () => lastStatus);
  ipcMain.handle('kdx:update:feedUrl', () => feedUrl());

  ipcMain.handle('kdx:update:setFeedUrl', (_e, url: string) => {
    const raw = String(url ?? '').trim();
    // A8 — only https (or loopback http for dev) is accepted; anything else is
    // stored as '' which resolves to the LIVE feed. The user is TOLD.
    const clean = sanitizeFeedUrl(raw);
    const rejected = raw.length > 0 && !clean;
    try {
      const cur = getSettings() as AppSettings & { updates?: { feedUrl?: string; autoCheck?: boolean } };
      saveSettings({ ...cur, updates: { ...(cur.updates ?? {}), feedUrl: clean } } as AppSettings);
      try {
        if (updater) updater.setFeedURL({ provider: 'generic', url: feedUrl() });
      } catch (e) {
        // This used to be swallowed. Because ensureUpdater() caches the updater,
        // a failed setFeedURL meant EVERY later check silently used the OLD
        // feed. Surface the failure instead of pretending the change applied.
        push({ state: 'error', error: `feed: ${String(e)}` });
        return feedUrl();
      }
      if (rejected) {
        push({
          state: 'error',
          error: `Feed URL rejected — only https:// (or loopback http for dev) is allowed. Using the official feed: ${safeFeedForLog(feedUrl())}`,
        });
      } else {
        // A result from the OLD feed must not linger as "available · vX".
        lastStatus = { state: 'idle', since: Date.now() };
        logLine('info', 'update', `feed updated → ${safeFeedForLog(feedUrl())}`);
      }
    } catch (e) {
      push({ state: 'error', error: `settings: ${String(e)}` });
    }
    return feedUrl(); // renderer contract: a string (the effective URL)
  });

  ipcMain.handle('kdx:update:check', async () => {
    const u = await ensureUpdater();
    if (!u) return lastStatus; // includes the STORE_MANAGED explanation
    try {
      await u.checkForUpdates();
    } catch (e) {
      push({ state: 'error', error: String((e as Error)?.message ?? e) });
    }
    return lastStatus;
  });

  ipcMain.handle('kdx:update:download', async () => {
    const u = await ensureUpdater();
    if (!u) return lastStatus;
    try {
      await u.downloadUpdate();
    } catch (e) {
      push({ state: 'error', error: String((e as Error)?.message ?? e) });
    }
    return lastStatus;
  });

  ipcMain.handle('kdx:update:install', () => {
    const u = updater;
    if (!u) {
      if (isStoreManagedEnvironment()) push(storeManagedStatus());
      else push({ state: 'error', error: 'No update has been downloaded yet.' });
      return false;
    }
    try {
      u.quitAndInstall();
      return true;
    } catch (e) {
      push({ state: 'error', error: `install: ${String(e)}` });
      return false;
    }
  });
}

/** One quiet automatic check ~10 min after boot (can be disabled). */
export function scheduleAutoCheck(): void {
  if (isStoreManagedEnvironment()) {
    logLine('info', 'update', 'auto-check skipped — Store-managed build');
    return;
  }
  let enabled = true;
  try {
    enabled = (getSettings() as { updates?: { autoCheck?: boolean } }).updates?.autoCheck !== false;
  } catch (err) {
    logLine('warn', 'update', `auto-check settings read failed: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`);
  }
  if (!enabled) {
    logLine('debug', 'update', 'auto-check disabled by settings');
    return;
  }
  const timer = setTimeout(() => {
    void ensureUpdater()
      .then((u) => {
        if (!u) return;
        void u.checkForUpdates().catch((err) => {
          push({ state: 'error', error: String((err as Error)?.message ?? err) });
        });
      })
      .catch((err) => {
        logLine('warn', 'update', `auto-check failed: ${String(err instanceof Error ? err.message : err).slice(0, 240)}`);
      });
  }, 10 * 60 * 1000);
  timer.unref?.();
}

export function currentAppVersion(): string {
  return app.getVersion();
}
