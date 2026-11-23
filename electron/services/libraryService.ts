// ============================================================
// libraryService — v10.2 SADEEM Library (+ v11.31 import hardening,
// + v11.36 rescan, + v11.38 REAL-WELL FIX).
// A cross-session gallery of artifacts SADEEM produces:
//   · images from image_generate
//   · documents from make_document (pdf/docx/xlsx/html)
//   · files pulled by download_file / web_download / browser_download
//   · session HTML exports / share pages
//   · files/folders a user explicitly IMPORTS from disk (importLibraryItem)
// Index = a JSON registry in <userData>/library.json, appended by
// a lightweight `noteLibraryItem()` hook the producer services call
// (best-effort: a library failure NEVER fails the producing tool).
// listLibraryItems() merges the registry with a fresh scan of REAL
// artifact wells so nothing is ever lost even when a producer forgot
// to call the hook.
//
// v11.31: the registry is mirrored in-process (survives a read-only
// userData for the session), writes are atomic tmp+rename, and every
// mutating call returns an honest { ok, persisted, error } instead of
// silently doing nothing. Imports go through a path jail.
//
// v11.36: noteLibraryItem is NOT called by every producer — notably
// `browser_download` writes into the workspace without indexing. A
// registry-only library is structurally incomplete, so listLibraryItems()
// began rescanning artifact wells on every call.
//
// v11.38 (LIBRARY STILL EMPTY — founder re-report): the v11.36 rescan
// had two structural holes that made the founder's files invisible:
//   (a) workspace discovery used ONLY settings.recentPaths. A workspace
//       pinned through kdx:workspace:set (or launched before settings.json
//       was persisted) was never scanned at all.
//   (b) each workspace was scanned through a FIXED subdir allowlist
//       (downloads/assets/images/... at depth 1). A download written to
//       public/, static/, a nested assets/img/ or any other real folder
//       was never seen, and the OS Downloads path was accepted only when
//       its basename literally matched "downloads".
// This version scans the WHOLE workspace tree (bounded + secret/symlink
// aware), adds the ACTIVE confine root, the OS Downloads path whenever it
// is a real directory, explicit env hints for headless launches, and keeps
// the registry merge. Empty state is now honest: it means truly no files.
// ============================================================
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import type { LibraryItem, LibraryKind } from '../../shared/types';

const LIB_FILE = 'library.json';
const MAX_ITEMS = 4000;
const KINDS: LibraryKind[] = ['image', 'document', 'download', 'export', 'file'];

/** Extensions that are real artifacts (never source code / config noise). */
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.ico', '.tif', '.tiff', '.avif'];
const DOC_EXT = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.odt', '.rtf', '.txt'];
const EXPORT_EXT = ['.html', '.htm'];
const FILE_EXT = ['.csv', '.zip', '.gz', '.tar', '.7z', '.rar', '.mp3', '.mp4', '.webm', '.mov', '.wav', '.ogg', '.woff', '.woff2', '.ttf', '.otf'];
const SCAN_EXT = new Set([...IMAGE_EXT, ...DOC_EXT, ...EXPORT_EXT, ...FILE_EXT]);
/** userData subdirs that are real artifact wells (all other userData dirs
 *  are either the registry itself or caches/sessions/logs — not galleries). */
const USERDATA_WELLS = ['artifacts', 'exports', 'generated', 'downloads', 'download', 'images', 'output', 'out', 'media'];
const SCAN_SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', '.next', '.nuxt', '.cache', 'coverage',
  // NOTE: '.surnia' is deliberately NOT skipped — SADEEM writes real
  // artifacts there (.surnia/prints/*.pdf, .surnia/artifacts/*, session HTML).
  'vendor', '__pycache__', 'secrets', 'credentials', '.ssh', '.aws', '.gnupg',
]);
/** Never surface credential-named files as gallery cards. */
const SECRET_NAME_SCAN = /(token|secret|credential|password|passwd|api[-_]?key|private[-_]?key|\.pem$|\.key$|\.pfx$|\.jks$|\.p12$|\.env($|\.))/i;
const MAX_SCAN_PER_ROOT = 600;
const MAX_SCAN_ROOTS = 16;
/** Depth of the recursive WHOLE-workspace scan. Deep enough for public/,
 *  static/, assets/img/, .surnia/prints/ — bounded so it can never hang. */
const WORKSPACE_SCAN_DEPTH = 4;

interface RegistryResult { ok: boolean; persisted: boolean; error?: string }
export interface LibraryScanHealth { ok: boolean; error?: string; wells: number; found: number }

function libPath(): string {
  try {
    if (app?.getPath) return path.join(app.getPath('userData'), LIB_FILE);
  } catch {
    /* headless */
  }
  return path.join(process.env.SURNIA_HOME || process.env.KODEX_HOME || path.join(process.cwd(), '.surnia-home'), LIB_FILE);
}

// ---------- in-process mirror + atomic persistence ----------
let cache: LibraryItem[] | null = null;
let dirty = false;
/** v11.36 — paths the user explicitly forgot/cleared. A disk rescan must
 *  not resurrect them; re-producing the file (note/import) clears the mark. */
let forgotten: Set<string> | null = null;
/** v11.38 — last disk-scan outcome. Exported so IPC can surface an honest,
 *  distinct error instead of an unexplained empty gallery. */
let lastScanHealth: LibraryScanHealth = { ok: true, wells: 0, found: 0 };

export function libraryScanHealth(): LibraryScanHealth { return { ...lastScanHealth }; }

function readForgotten(): Set<string> {
  if (forgotten) return forgotten;
  const out = new Set<string>();
  try {
    const j = JSON.parse(fs.readFileSync(libPath(), 'utf8')) as { forgotten?: unknown };
    if (Array.isArray(j.forgotten)) {
      for (const p of j.forgotten) {
        if (typeof p === 'string' && p.trim()) out.add(path.resolve(p));
      }
    }
  } catch {
    /* no file / old schema — nothing forgotten */
  }
  forgotten = out;
  return out;
}

function saneItem(raw: unknown): LibraryItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const it = raw as Partial<LibraryItem>;
  const id = typeof it.id === 'string' ? it.id.trim() : '';
  const p = typeof it.path === 'string' ? it.path.trim() : '';
  if (!id || !p) return null;
  const createdAt = typeof it.createdAt === 'number' && Number.isFinite(it.createdAt) ? it.createdAt : Date.now();
  return {
    id,
    kind: KINDS.includes(it.kind as LibraryKind) ? (it.kind as LibraryKind) : 'file',
    title: typeof it.title === 'string' && it.title.trim() ? it.title.slice(0, 160) : path.basename(p),
    path: p,
    createdAt,
    ...(typeof it.size === 'number' && Number.isFinite(it.size) && it.size >= 0 ? { size: it.size } : {}),
    ...(typeof it.sessionId === 'string' && it.sessionId ? { sessionId: it.sessionId } : {}),
    ...(typeof it.origin === 'string' && it.origin ? { origin: it.origin } : {}),
  };
}

function readRegistry(): LibraryItem[] {
  if (cache) return cache.slice();
  const out: LibraryItem[] = [];
  try {
    const j = JSON.parse(fs.readFileSync(libPath(), 'utf8')) as { items?: unknown };
    if (Array.isArray(j.items)) {
      for (const raw of j.items) {
        const item = saneItem(raw);
        if (item && !out.some((x) => x.path === item.path)) out.push(item);
      }
    }
  } catch {
    /* no file / corrupted — start empty */
  }
  cache = out;
  return out.slice();
}

function flushRegistry(): RegistryResult {
  if (!cache || !dirty) return { ok: true, persisted: true };
  const file = libPath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({
      version: 2,
      items: cache.slice(-MAX_ITEMS),
      forgotten: [...readForgotten()].slice(-MAX_ITEMS),
    }, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
    dirty = false;
    return { ok: true, persisted: true };
  } catch {
    // The in-memory mirror already holds the change; never lose it silently.
    return { ok: true, persisted: false, error: 'Library index could not be written to disk; changes last for this session only.' };
  }
}

function writeRegistry(items: LibraryItem[]): RegistryResult {
  cache = items.slice(-MAX_ITEMS);
  dirty = true;
  return flushRegistry();
}

/** Monotonic timestamp — two artifacts in the same ms must still order deterministically. */
let lastNoteTs = 0;

/** Producer hook — call (fire and forget) whenever SADEEM creates an artifact. */
export function noteLibraryItem(item: {
  kind: LibraryKind;
  title: string;
  path: string;
  size?: number;
  sessionId?: string;
  origin?: string;
}): { ok: boolean; id?: string; error?: string; persisted?: boolean } {
  try {
    if (!item || typeof item.path !== 'string' || !item.path.trim()) {
      return { ok: false, error: 'Library item needs a file path.' };
    }
    if (!KINDS.includes(item.kind)) {
      return { ok: false, error: `Unknown library kind: ${String(item.kind)}.` };
    }
    const items = readRegistry();
    // de-dup by absolute path: a re-download/re-render replaces the entry
    const abs = path.resolve(item.path);
    // Re-producing a file is an explicit re-add: lift any forget tombstone.
    readForgotten().delete(abs);
    const filtered = items.filter((x) => x.path !== abs);
    const ts = Date.now() > lastNoteTs ? Date.now() : lastNoteTs + 1;
    lastNoteTs = ts;
    const id = `lib_${ts.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    filtered.push({
      id,
      kind: item.kind,
      title: String(item.title || path.basename(abs)).slice(0, 160),
      path: abs,
      createdAt: ts,
      size: typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : undefined,
      sessionId: item.sessionId,
      origin: item.origin,
    });
    const res = writeRegistry(filtered);
    return { ok: res.ok, id, ...(res.error ? { error: res.error, persisted: res.persisted } : {}) };
  } catch (err) {
    // never fail the producer — but say WHY this item was not indexed
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------- project/file import (path-jailed) ----------
function insideRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function importRoots(): string[] {
  const roots = [os.homedir(), os.tmpdir(), process.cwd()];
  try {
    if (app?.getPath) roots.push(app.getPath('userData'));
  } catch {
    /* headless */
  }
  return Array.from(new Set(roots.filter(Boolean).map((r) => path.resolve(r))));
}

export interface LibraryImportInput {
  path: string;
  title?: string;
  kind?: LibraryKind;
  sessionId?: string;
  origin?: string;
}
export interface LibraryImportResult {
  ok: boolean;
  item?: LibraryItem;
  alreadyIndexed?: boolean;
  error?: string;
  persisted?: boolean;
}

/**
 * Import an EXISTING file or project folder into the library. The renderer
 * supplies the path, so it is confined to the user's own folders (home,
 * temp, workspace, app data); UNC/device paths, '..' and symlink escapes
 * are refused with an actionable error instead of a silent no-op.
 */
export function importLibraryItem(input: LibraryImportInput): LibraryImportResult {
  const raw = typeof input?.path === 'string' ? input.path.trim() : '';
  if (!raw) return { ok: false, error: 'Choose a file or folder to import.' };
  if (raw.includes('\u0000')) return { ok: false, error: 'Invalid import path.' };
  if (/^\/\//.test(raw.replace(/\\/g, '/'))) return { ok: false, error: 'Network/UNC paths cannot be imported.' };
  if (raw.split(/[\\/]+/).includes('..')) return { ok: false, error: 'Path traversal is not allowed in imports.' };

  const abs = path.resolve(raw);
  const roots = importRoots();
  if (!roots.some((r) => insideRoot(r, abs))) {
    return { ok: false, error: 'Import is limited to your home, temporary, workspace and app folders.' };
  }
  let real = abs;
  let st: fs.Stats;
  try {
    real = fs.realpathSync(abs);
    if (!roots.some((r) => insideRoot(r, real))) return { ok: false, error: 'Symlink points outside the allowed import folders.' };
    st = fs.statSync(real);
  } catch {
    return { ok: false, error: 'That file or folder no longer exists.' };
  }
  if (!st.isFile() && !st.isDirectory()) return { ok: false, error: 'Only regular files and folders can be imported.' };

  const items = readRegistry();
  const existing = items.find((x) => x.path === real);
  if (existing) return { ok: true, item: existing, alreadyIndexed: true };

  const kind: LibraryKind = KINDS.includes(input.kind as LibraryKind)
    ? (input.kind as LibraryKind)
    : st.isDirectory() ? 'file' : kindOf(real);
  const ts = Date.now() > lastNoteTs ? Date.now() : lastNoteTs + 1;
  lastNoteTs = ts;
  const item: LibraryItem = {
    id: `lib_${ts.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    title: String(input.title || path.basename(real)).slice(0, 160),
    path: real,
    createdAt: ts,
    ...(st.isFile() ? { size: st.size } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    origin: input.origin || 'import',
  };
  readForgotten().delete(real);
  items.push(item);
  const res = writeRegistry(items);
  return { ok: true, item, persisted: res.persisted, ...(res.error ? { error: res.error } : {}) };
}

function kindOf(p: string): LibraryKind {
  const ext = path.extname(p).toLowerCase();
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (DOC_EXT.includes(ext)) return 'document';
  if (EXPORT_EXT.includes(ext)) return 'export';
  return 'file';
}

/**
 * Every workspace that can hold artifacts. v11.38 — the ACTIVE confine root
 * (set by kdx:workspace:set on EVERY folder open) is now a first-class source,
 * alongside settings.recentPaths. A library list can no longer be empty just
 * because settings.json had not been persisted yet when the panel opened.
 */
function workspaceRoots(): string[] {
  const out: string[] = [];
  const add = (p: unknown): void => {
    if (typeof p === 'string' && p.trim()) out.push(path.resolve(p.trim()));
  };
  // 1) the persisted open-workspace list (same source the wiki gate uses)
  try {
    // Lazy require: storeService owns settings.json. Lazy keeps this service
    // usable headless and avoids a load-order cycle with the settings store.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const store = require('./storeService') as { getSettings?: () => { recentPaths?: unknown } };
    const recents = store.getSettings?.()?.recentPaths;
    if (Array.isArray(recents)) for (const p of recents) add(p);
  } catch {
    /* settings store unavailable (headless / test stub) — other wells still work */
  }
  // 2) the ACTIVE workspace pinned by kdx:workspace:set (confine root). This
  //    is authoritative even before the renderer round-trips settings.json.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fsSvc = require('./fsService') as { listAllowedRoots?: () => string[] };
    const roots = fsSvc.listAllowedRoots?.() ?? [];
    for (const r of roots) add(r);
  } catch {
    /* fsService unavailable — recentPaths/env still work */
  }
  // 3) explicit hints (headless CLI / tests / a relocated workspace)
  for (const p of String(process.env.SURNIA_WORKSPACES || '').split(/[;|]/)) add(p);

  // userData is an allowed root too, but it is scanned as a userData well —
  // never as a generic workspace tree (which would drown the gallery).
  const userData = path.dirname(libPath());
  return Array.from(new Set(out.filter((p) => p !== userData))).slice(0, MAX_SCAN_ROOTS);
}

interface ScanWell { dir: string; depth: number; downloadWell: boolean }

/** Depth-bounded, symlink-safe, secret-aware scan of one artifact well. */
function walkWell(dir: string, depth: number, maxDepth: number, downloadWell: boolean, byPath: Map<string, LibraryItem>, counter: { n: number }): void {
  if (counter.n >= MAX_SCAN_PER_ROOT) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (counter.n >= MAX_SCAN_PER_ROOT) break;
    if (entry.isSymbolicLink()) continue; // escape / alias vector — never follow
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SCAN_SKIP_DIRS.has(entry.name)) continue;
      if (depth < maxDepth) {
        walkWell(full, depth + 1, maxDepth, downloadWell || /^downloads?$/i.test(entry.name), byPath, counter);
      }
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SCAN_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    if (SECRET_NAME_SCAN.test(entry.name)) continue;
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size === 0) continue;
    const key = path.resolve(full);
    if (byPath.has(key)) continue;
    counter.n++;
    const kind = downloadWell && kindOf(entry.name) === 'file' ? 'download' : kindOf(entry.name);
    byPath.set(key, {
      // Stable id — re-scanning the same file must not remount its card.
      id: `scan_${Buffer.from(key, 'utf8').toString('base64url')}`,
      kind,
      title: entry.name,
      path: key,
      createdAt: st.mtimeMs,
      size: st.size,
      origin: 'scan',
    });
  }
}

/**
 * Rescan the REAL places SADEEM writes artifacts. v11.38 — every workspace is
 * scanned as a WHOLE tree (not a fixed subdir allowlist) so a download into
 * public/, static/, a nested assets/img/ or .surnia/prints/ is visible. The
 * OS Downloads path is accepted whenever it is a real directory (a redirected
 * OneDrive/Documents download folder no longer needs a literal "downloads"
 * basename), and explicit env hints cover headless launches.
 */
export function scanArtifactWells(): LibraryItem[] {
  const byPath = new Map<string, LibraryItem>();
  const wells: ScanWell[] = [];
  const userData = path.dirname(libPath());

  // 1) userData: top-level files + the real artifact subdirs (any depth).
  wells.push({ dir: userData, depth: 0, downloadWell: false });
  for (const sub of USERDATA_WELLS) {
    wells.push({ dir: path.join(userData, sub), depth: 3, downloadWell: /^downloads?$/i.test(sub) });
  }

  // 2) OS/browser Downloads. Accept the real path; refuse the generic temp
  //    dir a sandbox/stub returns so unrelated files never pollute the gallery.
  const downloadDirs: string[] = [];
  try {
    if (app?.getPath) {
      const dl = app.getPath('downloads');
      if (typeof dl === 'string' && dl.trim()) downloadDirs.push(path.resolve(dl));
    }
  } catch {
    /* headless */
  }
  if (process.env.SURNIA_DOWNLOADS_DIR) downloadDirs.push(path.resolve(process.env.SURNIA_DOWNLOADS_DIR));
  for (const dl of Array.from(new Set(downloadDirs))) {
    if (dl === os.tmpdir() || dl === path.dirname(userData) || dl === userData) continue;
    wells.push({ dir: dl, depth: 2, downloadWell: true });
  }

  // 3) REAL workspaces — the whole tree, bounded and safe.
  for (const root of workspaceRoots()) {
    wells.push({ dir: root, depth: WORKSPACE_SCAN_DEPTH, downloadWell: false });
  }

  const seenDirs = new Set<string>();
  let opened = 0;
  for (const well of wells) {
    const dir = path.resolve(well.dir);
    if (seenDirs.has(dir)) continue;
    seenDirs.add(dir);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    opened++;
    walkWell(dir, 0, well.depth, well.downloadWell, byPath, { n: 0 });
  }
  lastScanHealth = { ok: true, wells: opened, found: byPath.size };
  return [...byPath.values()];
}

/** Newest first, registry + REAL filesystem union, deduped by path. */
export async function listLibraryItems(limit = 300): Promise<LibraryItem[]> {
  const byPath = new Map<string, LibraryItem>();
  // 1) fresh filesystem scan — disk truth, independent of producer hooks.
  try {
    for (const it of scanArtifactWells()) {
      const key = path.resolve(it.path);
      if (readForgotten().has(key)) continue; // user forgot this path — do not resurrect
      if (!byPath.has(key)) byPath.set(key, it);
    }
  } catch (err) {
    // A fundamentally broken scan is an ERROR, not an honestly-empty library.
    // Surface it through libraryScanHealth() so IPC can report it distinctly.
    lastScanHealth = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      wells: 0,
      found: 0,
    };
  }
  // 2) registry entries (authoritative metadata). Entries whose file has
  //    vanished from disk are dropped — the registry is an index, not a
  //    mausoleum (bounded to the visible window; deleted files never linger).
  for (const it of readRegistry()) {
    const key = path.resolve(it.path);
    const alive = await fsp.stat(key).then(() => true).catch(() => false);
    if (!alive) continue;
    const scan = byPath.get(key);
    byPath.set(key, scan ? { ...scan, ...it } : { ...it, path: key });
  }
  return [...byPath.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

/** Drop one item from the registry (the file itself is NOT deleted). */
export function forgetLibraryItem(id: string): { ok: boolean; persisted?: boolean; error?: string } {
  const key = String(id ?? '');
  const before = readRegistry();
  // v11.36 — a card may come from the RESCAN (id `scan_…`) and have no
  // registry row. Resolve its path from disk truth too, otherwise "Remove
  // from library" silently does nothing on exactly the downloads the user
  // complained about.
  const scanHit = scanArtifactWells().find((x) => x.id === key);
  const target = before.find((x) => x.id === key)?.path ?? scanHit?.path;
  if (!target) return { ok: false, persisted: true, error: 'No library entry matched that id.' };
  const abs = path.resolve(target);
  readForgotten().add(abs);
  const after = before.filter((x) => path.resolve(x.path) !== abs);
  const res = writeRegistry(after);
  return { ok: res.ok, persisted: res.persisted, ...(res.error ? { error: res.error } : {}) };
}

/** Clear the whole registry (files untouched); tombstone all known paths. */
export function clearLibrary(): { ok: boolean; persisted?: boolean; error?: string } {
  const f = readForgotten();
  for (const it of readRegistry()) f.add(path.resolve(it.path));
  for (const it of scanArtifactWells()) f.add(path.resolve(it.path));
  const res = writeRegistry([]);
  return { ok: res.ok, persisted: res.persisted, ...(res.error ? { error: res.error } : {}) };
}
