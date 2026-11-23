import { tmpdir } from 'node:os';
// Electron stub for esbuild-aliased unit tests — every heavy-system module
// must survive a non-Electron environment; anything it needs at module load
// time is a bug, anything lazily required gets a harmless no-op here.
class FakeBrowserWindow {}
export const BrowserWindow = FakeBrowserWindow;
export const Notification = { isSupported: () => false };
export const nativeImage = { createEmpty: () => ({}) };
export const clipboard = { readText: () => '', writeText: () => undefined, readImage: () => ({}), writeImage: () => undefined };
export const powerMonitor = { on: () => undefined };
export const session = { defaultSession: { setProxy: async () => undefined, clearCache: async () => undefined } };
export const screen = { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }), getAllDisplays: () => [] };
export const tray = { };
export const app = {
  // SADEEM_TEST_USERDATA — a test process can isolate userData (library/plugins registries).
  getPath: (name) => (name === 'userData' && process.env.SADEEM_TEST_USERDATA ? process.env.SADEEM_TEST_USERDATA : tmpdir()),
  isReady: () => true,
  whenReady: async () => undefined,
  getName: () => 'surnia-test',
  getVersion: () => '0.0.0-test',
};
export const ipcMain = { handle: () => undefined, on: () => undefined };
export const ipcRenderer = { invoke: async () => ({}), on: () => undefined, send: () => undefined };
export const contextBridge = { exposeInMainWorld: () => undefined };
export const shell = { openExternal: async () => undefined, showItemInFolder: () => undefined, openPath: async () => '' };
export const dialog = { showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => ({ canceled: true }) };
export const safeStorage = { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
export const webContents = { getAllWebContents: () => [] };
export const nativeTheme = { shouldUseDarkColors: true };
export const Menu = { buildFromTemplate: () => ({}), setApplicationMenu: () => undefined };
export const globalShortcut = { register: () => true, unregisterAll: () => undefined };
export default { BrowserWindow, app, ipcMain, ipcRenderer, contextBridge, shell, dialog, safeStorage, webContents, nativeTheme, Menu, globalShortcut };
