// ============================================================
// Surnia — device service (main-process only, Electron APIs)
// Gives the agent real device control: screen capture (vision),
// open files/folders/URLs, clipboard, OS notifications — plus
// app performance metrics for the Usage panel.
// Injected into the agent tool layer via setDeviceImpl() so the
// CLI bundle (pure node) stays electron-free.
// ============================================================
import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  Notification,
  screen,
  shell,
} from 'electron';
import * as os from 'os';
import { spawn, execFile } from 'child_process';
import { promises as fsp } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';

/**
 * Electron 45 moved clipboard image/text reads to an async `read()` API, while
 * older builds (and the CLI/test stubs) still expose the synchronous
 * `readImage()` / `readText()` pair that the agent tool contract relies on.
 * This adapter keeps the SYNC contract honest: use the sync methods when they
 * exist; otherwise report the limitation explicitly instead of returning a
 * Promise stringified as clipboard content (a silent failure).
 */
interface LegacyNativeImageLike {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(o: { width: number; height: number }): LegacyNativeImageLike;
  toPNG(): Buffer;
}
interface ClipboardCompat {
  readImage?: () => LegacyNativeImageLike;
  readText?: () => string | Promise<string>;
  writeText?: (text: string) => void | Promise<void>;
}
function clipboardCompat(): ClipboardCompat {
  return clipboard as unknown as ClipboardCompat;
}
let warnedAsyncClipboard = false;
function warnAsyncClipboard(): void {
  if (warnedAsyncClipboard) return;
  warnedAsyncClipboard = true;
  console.warn(
    '[surnia-device] clipboard image/text reads require the legacy sync API on this Electron build — reporting unavailable instead of returning a promise',
  );
}

function execFileAsync(cmd: string, args: string[], timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout ?? ''));
    });
  });
}

/**
 * v10.3 — launch a desktop application by name or path (Codex "computer use"
 * parity: open Blender, Chrome, VS Code… so the agent can drive real apps).
 * Cross-platform: macOS `open -a`, Windows `start` (resolves PATH + App Paths
 * registry), Linux PATH lookup → gtk-launch → xdg-open. Detached: the app
 * outlives SADEEM. Never throws — returns an honest error instead.
 */
export async function launchApp(input: string): Promise<{ ok: boolean; error?: string; how?: string }> {
  const name = String(input ?? '').trim();
  if (!name) return { ok: false, error: 'missing app name or path' };

  try {
    if (process.platform === 'darwin') {
      await execFileAsync('open', ['-a', name]);
      return { ok: true, how: `open -a ${name}` };
    }

    if (process.platform === 'win32') {
      // A direct path / .lnk: verify it exists, then start it.
      const looksLikePath = /[\\/]/.test(name) || /\.(exe|lnk|bat|cmd)$/i.test(name);
      if (looksLikePath) {
        const p = name.replace(/%([^%]+)%/g, (_, v: string) => process.env[v] ?? `%${v}%`);
        try {
          await fsp.access(path.resolve(p));
          const child = spawn('cmd.exe', ['/c', 'start', '', path.resolve(p)], {
            windowsHide: true,
            detached: true,
            stdio: 'ignore',
          });
          child.unref();
          return { ok: true, how: `start ${path.resolve(p)}` };
        } catch {
          return { ok: false, error: `file not found: ${name}` };
        }
      }
      // Bare name: `where` proves it resolves before we spawn (honest errors).
      const whereOut = await execFileAsync('where', [name]).catch(() => '');
      if (!whereOut.trim()) {
        return { ok: false, error: `"${name}" not found on PATH — pass the full path to the .exe or shortcut.` };
      }
      const child = spawn('cmd.exe', ['/c', 'start', '', name], { windowsHide: true, detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true, how: `start ${name}` };
    }

    // Linux: PATH lookup first.
    const whichOut = await execFileAsync('which', [name]).catch(() => '');
    if (whichOut.trim()) {
      const bin = whichOut.trim().split('\n')[0].trim();
      const child = spawn(bin, [], { detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true, how: bin };
    }
    // .desktop entries (Blender, GIMP…) via gtk-launch, then xdg-open.
    try {
      await execFileAsync('gtk-launch', [name], 4000);
      return { ok: true, how: `gtk-launch ${name}` };
    } catch {
      /* try xdg-open */
    }
    try {
      await execFileAsync('xdg-open', [name], 4000);
      return { ok: true, how: `xdg-open ${name}` };
    } catch {
      return { ok: false, error: `could not launch "${name}" — not on PATH and no .desktop entry` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface DeviceMetrics {
  cpuPercent: number;
  memoryMB: number;
  processes: number;
  pid: number;
  uptimeSec: number;
  platform: string;
  hostMemTotalMB: number;
  hostMemFreeMB: number;
  hostCpuLoad: number; // 0..1 (1-min load avg normalized by cores, or best-effort)
}

/** Capture the primary screen (or the window's display) as a PNG data URL. */
export async function screenshotScreen(): Promise<{ ok: boolean; mime?: string; dataUrl?: string; error?: string; note?: string }> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1600, height: 1000 },
    });
    if (!sources.length) return { ok: false, error: 'No screen found to capture.' };
    // Prefer the display showing the Surnia window when available.
    let src = sources[0];
    try {
      const win = BrowserWindow.getAllWindows().find((w) => w.isVisible());
      const display = screen.getDisplayMatching(
        win?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 },
      );
      const match = sources.find((s) => s.display_id === String(display.id));
      if (match) src = match;
    } catch {
      /* fall back to first screen */
    }
    const png = src.thumbnail.toPNG();
    if (!png.length) return { ok: false, error: 'Screen capture produced an empty image.' };
    return {
      ok: true,
      mime: 'image/png',
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      note: `captured ${src.name || 'screen'} ${src.thumbnail.getSize().width}x${src.thumbnail.getSize().height}`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Open a path (file/folder) with the OS default handler, or a URL in the browser. */
export async function openPath(input: string): Promise<{ ok: boolean; error?: string }> {
  const value = input.trim();
  if (!value) return { ok: false, error: 'Empty path/URL.' };
  if (/^https?:\/\//i.test(value)) {
    await shell.openExternal(value);
    return { ok: true };
  }
  const err = await shell.openPath(value);
  return err ? { ok: false, error: err } : { ok: true };
}

/** v3.1 — show a file/folder in the OS file manager with it selected. */
export function revealInFolder(p: string): { ok: boolean; error?: string } {
  try {
    shell.showItemInFolder(p);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** v3.1 — move a file/folder to the OS trash (safe, recoverable delete). */
export async function trashItem(p: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await shell.trashItem(p);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function clipboardRead(): string {
  try {
    const cb = clipboardCompat();
    if (typeof cb.readImage === 'function' && !cb.readImage().isEmpty()) {
      return '[clipboard contains an image]';
    }
    if (typeof cb.readText === 'function') {
      const value = cb.readText();
      if (typeof value === 'string') return value;
      // Electron 45 returns a Promise here — it cannot satisfy a sync caller.
      void Promise.resolve(value).catch(() => undefined);
      warnAsyncClipboard();
      return '[clipboard text is available only via the async clipboard API on this Electron build]';
    }
    warnAsyncClipboard();
    return '[clipboard unavailable on this Electron build]';
  } catch (err) {
    return `[clipboard error: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

/**
 * v3.1 — read an IMAGE from the clipboard as a data URL (agent vision).
 * Returns null when the clipboard holds no image. Downscales huge captures
 * to keep the payload under the 6MB tool-image budget.
 */
export function clipboardImage(): { mime: string; dataUrl: string } | null {
  try {
    const cb = clipboardCompat();
    if (typeof cb.readImage !== 'function') {
      warnAsyncClipboard();
      return null;
    }
    const img = cb.readImage();
    if (img.isEmpty()) return null;
    let png = img;
    const size = img.getSize();
    const MAX_DIM = 1600;
    if (size.width > MAX_DIM || size.height > MAX_DIM) {
      const scale = MAX_DIM / Math.max(size.width, size.height);
      png = img.resize({
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale),
      });
    }
    const buf = png.toPNG();
    if (!buf.length || buf.length > 6 * 1024 * 1024) return null;
    return { mime: 'image/png', dataUrl: `data:image/png;base64,${buf.toString('base64')}` };
  } catch (err) {
    console.warn('[surnia-device] clipboard image read failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * v3.1 — render HTML to PDF via a hidden window (make_document pdf path).
 * Full CSS, unicode + Arabic rendering — far beyond the offline fallback.
 * offscreen + sandboxed; navigation disabled; always destroyed.
 */
export async function printToPdf(html: string): Promise<{ ok: boolean; data?: Buffer; error?: string }> {
  let win: BrowserWindow | null = null;
  try {
    win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        offscreen: true,
        javascript: false,
        images: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    // Give the renderer one paint pass for webfonts/images.
    await new Promise((r) => setTimeout(r, 250));
    const data = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.55, right: 0.55 },
    });
    if (!data.length) return { ok: false, error: 'printToPDF produced an empty file.' };
    return { ok: true, data: Buffer.from(data) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      win?.destroy();
    } catch {
      /* ignore */
    }
  }
}

export function clipboardWrite(text: string): void {
  const cb = clipboardCompat();
  if (typeof cb.writeText !== 'function') {
    console.warn('[surnia-device] clipboard write unavailable on this Electron build');
    return;
  }
  try {
    const r = cb.writeText(text);
    // Electron 45 returns a Promise — surface failures instead of floating them.
    if (r && typeof (r as Promise<void>).catch === 'function') {
      void (r as Promise<void>).catch((err: unknown) =>
        console.warn('[surnia-device] clipboard write failed:', err instanceof Error ? err.message : String(err)),
      );
    }
  } catch (err) {
    console.warn('[surnia-device] clipboard write failed:', err instanceof Error ? err.message : String(err));
  }
}

export function notify(title: string, body: string): { ok: boolean; error?: string } {
  try {
    if (!Notification.isSupported()) return { ok: false, error: 'Notifications are not supported on this system.' };
    new Notification({ title: title.slice(0, 80) || 'Surnia', body: body.slice(0, 240), silent: false }).show();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** App + host performance metrics for the Usage panel. */
export function deviceMetrics(): DeviceMetrics {
  let cpuPercent = 0;
  let memoryMB = 0;
  let processes = 0;
  try {
    const metrics = app.getAppMetrics();
    processes = metrics.length;
    for (const m of metrics) {
      cpuPercent += m.cpu?.percentCPUUsage ?? 0;
      memoryMB += (m.memory?.workingSetSize ?? 0) / 1024; // KB → MB
    }
  } catch {
    /* keep zeros */
  }
  const total = os.totalmem() / 1024 / 1024;
  const free = os.freemem() / 1024 / 1024;
  let load = 0;
  try {
    load = Math.min(1, (os.loadavg()[0] || 0) / Math.max(1, os.cpus().length));
  } catch {
    /* non-posix */
  }
  return {
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memoryMB: Math.round(memoryMB),
    processes,
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    platform: `${os.platform()} ${os.arch()}`,
    hostMemTotalMB: Math.round(total),
    hostMemFreeMB: Math.round(free),
    hostCpuLoad: Math.round(load * 100) / 100,
  };
}

// ============================================================
// v11.31 — DEVICE REGISTRATION / LOCAL-ACCOUNT GUARD
// ------------------------------------------------------------
// Remote pairing must not be a bearer token alone: a paired phone is a
// *registered device* bound to the OS account that created the pairing.
// A token copied to a second machine/account cannot re-register silently.
// Registry lives in <userData>/registered-devices.json (mode 0600), the
// same file discipline as settings/license. All writes throw on failure —
// no silent "registered" success that did not persist.
// ============================================================

export interface RegisteredDevice {
  id: string;
  name: string;
  platform: string;
  /** Hash of the OS account that registered this device. */
  account: string;
  registeredAt: number;
  lastSeenAt?: number;
  revokedAt?: number;
}

function deviceUserDataDir(): string {
  try {
    const dir = app?.getPath?.('userData');
    if (dir) return dir;
  } catch {
    /* non-electron — fall through */
  }
  if (process.env.SADEEM_TEST_USERDATA) return process.env.SADEEM_TEST_USERDATA;
  return path.join(os.tmpdir(), `sadeem-devices-${process.pid}`);
}

function deviceRegistryPath(): string {
  return path.join(deviceUserDataDir(), 'registered-devices.json');
}
function localDeviceIdPath(): string {
  return path.join(deviceUserDataDir(), 'device-id.json');
}

/**
 * Stable fingerprint of the LOCAL OS account. Derived fresh on every call so
 * a profile copied from another machine cannot smuggle an account identity.
 */
export function localAccountFingerprint(): string {
  let who = 'unknown';
  let host = 'unknown';
  try {
    who = os.userInfo().username || 'unknown';
  } catch {
    /* restricted environments */
  }
  try {
    host = os.hostname() || 'unknown';
  } catch {
    /* restricted environments */
  }
  return createHash('sha256').update(`${who}@${host}`).digest('hex').slice(0, 16);
}

/** Stable per-install device id (persisted, 0600). */
export function getLocalDeviceId(): string {
  const file = localDeviceIdPath();
  try {
    const parsed = JSON.parse(fsSync.readFileSync(file, 'utf8')) as { id?: unknown };
    if (typeof parsed.id === 'string' && parsed.id.length >= 8) return parsed.id;
  } catch {
    /* missing/corrupt — regenerate below (honest warning) */
    console.warn('[surnia-device] device-id.json missing or corrupt — generating a fresh local device id');
  }
  const id = randomUUID();
  fsSync.mkdirSync(path.dirname(file), { recursive: true });
  fsSync.writeFileSync(file, JSON.stringify({ id }, null, 2), { encoding: 'utf8', mode: 0o600 });
  return id;
}

function readRegistry(): RegisteredDevice[] {
  try {
    const parsed = JSON.parse(fsSync.readFileSync(deviceRegistryPath(), 'utf8')) as unknown;
    if (!Array.isArray(parsed)) throw new Error('registry is not an array');
    return parsed.filter(
      (d): d is RegisteredDevice =>
        !!d && typeof d === 'object' && typeof (d as RegisteredDevice).id === 'string',
    );
  } catch (err) {
    // Fail CLOSED: a corrupt/unreadable registry means no device is trusted.
    console.warn(
      '[surnia-device] registered-devices.json unreadable — treating NO device as registered:',
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

function writeRegistry(devices: RegisteredDevice[]): void {
  const file = deviceRegistryPath();
  fsSync.mkdirSync(path.dirname(file), { recursive: true });
  fsSync.writeFileSync(file, JSON.stringify(devices, null, 2), { encoding: 'utf8', mode: 0o600 });
}

export interface RegisterDeviceInput {
  name: string;
  platform?: string;
  /** Account fingerprint presented at pairing time — must match the local account. */
  account?: string;
}

/**
 * Register (or refresh) a paired device. Idempotent by identity hash so a
 * re-pair upserts instead of spawning duplicates. An account mismatch is a
 * hard rejection — never a silent downgrade to the local account.
 */
export function registerDevice(input: RegisterDeviceInput): RegisteredDevice {
  const name = String(input?.name ?? '').trim().slice(0, 80);
  if (!name) throw new Error('DEVICE_NAME_REQUIRED');
  const account = String(input?.account ?? localAccountFingerprint());
  const local = localAccountFingerprint();
  if (account !== local) {
    throw new Error('DEVICE_ACCOUNT_MISMATCH');
  }
  const platform = String(input?.platform ?? 'unknown').trim().slice(0, 80) || 'unknown';
  const id = createHash('sha256').update(`${account}|${platform}|${name.toLowerCase()}`).digest('hex').slice(0, 16);
  const devices = readRegistry();
  const now = Date.now();
  const existing = devices.find((d) => d.id === id);
  const record: RegisteredDevice = {
    id,
    name,
    platform,
    account,
    registeredAt: existing?.registeredAt ?? now,
    lastSeenAt: now,
    ...(existing?.revokedAt ? { revokedAt: existing.revokedAt } : {}),
  };
  const next = devices.filter((d) => d.id !== id).concat(record);
  writeRegistry(next); // throws on failure — no silent success
  return record;
}

export function listRegisteredDevices(): RegisteredDevice[] {
  return readRegistry();
}

/** True only for an explicitly registered, non-revoked device. */
export function isDeviceRegistered(id: unknown): boolean {
  if (typeof id !== 'string' || !id) return false;
  return readRegistry().some((d) => d.id === id && !d.revokedAt);
}

export function touchDevice(id: string): boolean {
  const devices = readRegistry();
  const hit = devices.find((d) => d.id === id && !d.revokedAt);
  if (!hit) return false;
  hit.lastSeenAt = Date.now();
  writeRegistry(devices);
  return true;
}

/** Revoke a device — subsequent sender checks fail closed. */
export function revokeDevice(id: string): number {
  const devices = readRegistry();
  let n = 0;
  const now = Date.now();
  for (const d of devices) {
    if (d.id === id && !d.revokedAt) {
      d.revokedAt = now;
      n++;
    }
  }
  if (n) writeRegistry(devices);
  return n;
}

/** Wipe the whole registry (Privacy → revoke all paired phones). */
export function clearRegisteredDevices(): number {
  const n = readRegistry().filter((d) => !d.revokedAt).length;
  writeRegistry([]);
  return n;
}
