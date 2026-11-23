// ============================================================
// Surnia — filesystem service: tree listing, read/write, search
// SECURITY: every path handler goes through assertSafePath(). When
// a confine root is installed the guard rejects anything outside it,
// Windows UNC/device paths, and '..' segments; write/delete/rename
// additionally realpath the parent directory so a symlink planted
// inside the workspace cannot smuggle writes outside it.
// E4 additions:
//   • allowed roots = workspace + appData dir (addAllowedRoot);
//     the workspace root is auto-adopted from the first tree/search
//     listing (main.ts never wires setConfineRoot itself), so the
//     symlink-escape guards are ACTIVE by default, not dormant.
//   • .surniaignore (workspace root, gitignore-lite globs) hides
//     paths from tree listing + content search; isIgnoredPath() is
//     exported for other indexers.
//   • blocked writes/creates/deletes outside the roots are audited
//     (audit.jsonl 'fs_block') and broadcast as kdx:sec:fsBlock.
// ============================================================
import { promises as fsp } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import type { FileNode, SearchHit } from '../../shared/types';
import { auditAppend, sendSecurityEvent } from './terminalGuard';

// ---------- workspace confinement ----------
let confineRoot: string | null = null; // resolved when set
let explicitRoot = false; // true once setConfineRoot() was called by main
const extraRoots = new Set<string>(); // e.g. the appData dir

/** Install (root) or disable (null) workspace confinement for all fs handlers. */
export function setConfineRoot(root: string | null): void {
  if (root === null || !String(root).trim()) {
    confineRoot = null;
    explicitRoot = true; // an explicit "no root" is a decision, not an absence
    return;
  }
  confineRoot = path.resolve(String(root));
  explicitRoot = true;
}

/** True when a confine root is active (read-only introspection). */
export function confineActive(): boolean {
  return confineRoot !== null;
}

/** Internal: the active, resolved root (null = unconstrained). */
function activeRoot(): string | null {
  return confineRoot;
}

/** E4: register an extra always-allowed root (absolute path). */
export function addAllowedRoot(root: string): void {
  const r = String(root ?? '').trim();
  if (r && path.isAbsolute(r)) extraRoots.add(path.resolve(r));
}

/** E4: current allowed roots (workspace first, then extras) — for status UI. */
export function listAllowedRoots(): string[] {
  return [...(confineRoot ? [confineRoot] : []), ...extraRoots];
}

let appDataRootAdded = false;
/** E4: make sure the appData dir is always in the allowed set (lazy — app must be ready). */
function ensureAppDataRoot(): void {
  if (appDataRootAdded) return;
  appDataRootAdded = true;
  try {
    // Lazy require keeps fsService electron-free for non-Electron bundling.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const app = (require('electron') as { app?: { getPath?: (k: string) => string } }).app;
    const dir = app?.getPath?.('userData');
    if (dir) addAllowedRoot(dir);
  } catch {
    /* non-electron context — nothing to add */
  }
}

/**
 * E4: auto-adopt the workspace root from tree/search listings. The renderer
 // only ever calls readDir/searchFiles with the active workspace, so the
 // first listing activates confinement (explicit setConfineRoot wins).
 */
function noteWorkspaceRoot(root: string): void {
  ensureAppDataRoot();
  if (explicitRoot) return;
  try {
    const resolved = path.resolve(root);
    if (confineRoot !== resolved) confineRoot = resolved;
  } catch {
    /* ignore */
  }
}

/** Containment test: is `target` inside `root` (path.relative based, separator-safe)? */
function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** E4: containment against the confine root OR any registered extra root. */
function isInsideAnyRoot(target: string): boolean {
  const root = activeRoot();
  if (root && isInside(root, target)) return true;
  for (const extra of extraRoots) if (isInside(extra, target)) return true;
  return false;
}

/**
 * v11.31 — listing/search roots are realpath-checked too. Without this a
 * symlink planted as the workspace root let readDirTree/searchFiles walk
 * (and print the contents of) a directory OUTSIDE the jail even though every
 * read/write handler was guarded. Missing paths fall through to the caller's
 * stat(), which reports an honest ENOENT.
 */
async function assertSafeExistingRoot(root: string, label: string): Promise<string> {
  const safe = assertSafePath(root, label);
  try {
    const real = await fsp.realpath(safe);
    if (!isInsideAnyRoot(real)) throw new Error(`${label.toUpperCase()}_OUTSIDE_WORKSPACE`);
    return real;
  } catch (err) {
    if (err instanceof Error && err.message.endsWith('_OUTSIDE_WORKSPACE')) throw err;
    return safe;
  }
}

/**
 * Validate a renderer-supplied absolute path. Throws on:
 *  (a) non-absolute / empty paths,
 *  (b) Windows UNC (\\\\server\\share) and device (\\\\.\\, \\\\?\\) paths,
 *  (c) any '..' segment surviving normalization,
 *  (d) — when a confine root is set — paths resolving outside that root.
 * Returns the normalized absolute path. SYNC containment only; for
 * writes/deletes/renames use assertSafeWritePath() which also verifies
 * the (realpath'd) parent directory to defeat symlink escapes.
 */
export function assertSafePath(p: string, label = 'path'): string {
  const file = assertAbs(p, label);
  if (file.includes('\u0000')) throw new Error(`${label.toUpperCase()}_INVALID`);

  // (b) Windows UNC (\\\\server\\share), device namespaces (\\\\.\\, \\\\?\\) and
  // their forward-slash forms — all start with a doubled separator.
  if (/^\\\\/.test(file) || /^\/\//.test(file)) {
    throw new Error(`${label.toUpperCase()}_UNC_NOT_ALLOWED`);
  }

  // Windows treats CON/PRN/AUX/NUL/COM1-9/LPT1-9 (with any extension) as
  // DEVICE names even inside a directory — writing "C:\\ws\\NUL" is a write to
  // the device, not to a file in the jail. Reject them explicitly (win32 only;
  // on POSIX these are ordinary filenames).
  if (process.platform === 'win32') {
    const deviceSeg = /(?:^|[\\/])(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.[^\\/]*)?(?=$|[\\/])/i;
    if (deviceSeg.test(file)) throw new Error(`${label.toUpperCase()}_DEVICE_PATH`);
  }

  // (e) '..' segments must be gone after normalization.
  const normalized = path.normalize(file);
  const hasDotDot = (s: string): boolean => s.split(/[\\/]+/).includes('..');
  if (hasDotDot(normalized)) throw new Error(`${label.toUpperCase()}_TRAVERSAL`);
  // With confinement active, ALSO reject raw '..' traversal intent even when
  // normalize would collapse it (normalize('/a/../../etc') === '/etc').
  if (activeRoot() && hasDotDot(file)) throw new Error(`${label.toUpperCase()}_TRAVERSAL`);

  // (d) confine-root containment (extras like the appData dir count too).
  const root = activeRoot();
  if (root) {
    const resolved = path.resolve(normalized);
    if (!isInsideAnyRoot(resolved)) {
      throw new Error(`${label.toUpperCase()}_OUTSIDE_WORKSPACE`);
    }
  }
  return normalized;
}

/**
 * Write/delete/rename variant of assertSafePath: additionally resolves the
 * path through fsp.realpath (best-effort — a nonexistent target/parent is
 * allowed, mkdir -p creates it later) and re-checks containment so a symlink
 * planted inside the workspace cannot redirect the operation outside.
 * checkTarget=false (delete / rename-source) verifies the PARENT only, so
 * removing a symlink that points outside stays possible (only the link is
 * removed) while a symlinked PARENT leading outside is still refused.
 */
export async function assertSafeWritePath(
  p: string,
  label = 'path',
  opts?: { checkTarget?: boolean },
): Promise<string> {
  const file = assertSafePath(p, label);
  const root = activeRoot();
  if (!root) return file;
  // v11.11 — refuse writes into .git/ or node_modules/ under ANY allowed root
  // (audited refusal; explicit env opt-out exists for repair-style tools).
  for (const r of [...(root ? [root] : []), ...extraRoots]) {
    if (isProtectedPath(r, file)) {
      throw new Error(`${label.toUpperCase()}_PROTECTED_DIR`);
    }
  }
  const checkTarget = opts?.checkTarget !== false;
  const probe = checkTarget ? file : path.dirname(file);
  try {
    // Resolve the target itself (write destinations / existing paths); when
    // it doesn't exist yet, resolve its PARENT — a symlinked parent must not
    // redirect the write outside the root either (best-effort: a target that
    // is not on disk yet is allowed, mkdir -p creates it below).
    let real: string | null = null;
    try {
      real = await fsp.realpath(probe);
    } catch {
      real = null;
    }
    if (real === null && checkTarget) {
      try {
        real = await fsp.realpath(path.dirname(file));
      } catch {
        real = null;
      }
    }
    if (real !== null && !isInsideAnyRoot(real)) {
      throw new Error(`${label.toUpperCase()}_OUTSIDE_WORKSPACE`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.endsWith('_OUTSIDE_WORKSPACE')) throw err;
    /* target/parent not on disk yet — best-effort, mkdir creates it below */
  }
  return file;
}

// ---------- config ----------
export const IGNORED_DIRS = new Set<string>([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', '__pycache__',
  '.venv', 'venv', '.next', '.nuxt', '.cache', 'coverage', '.surnia', '.surnia',
  '.idea', '.vscode', 'vendor', 'bin', 'obj',
]);

/**
 * v11.11 (A9) — WRITE-PROTECTED directories. Listing already hides these;
 * writes/creates/deletes/renames INTO them (anywhere under an allowed root)
 * are now refused too: .git hook planting and node_modules poisoning are
 * classic agent-mistake / supply-chain vectors. Explicit opt-out for power
 * users: SURNA_ALLOW_PROTECTED_WRITES=1 (documented, audited choice).
 */
const WRITE_PROTECT_DIRS = new Set<string>(['.git', 'node_modules']);

function protectedWritesAllowed(): boolean {
  return process.env.SURNA_ALLOW_PROTECTED_WRITES === '1';
}

/** True when any path segment from `root` down to `target` is write-protected. */
function isProtectedPath(root: string, target: string): boolean {
  if (protectedWritesAllowed()) return false;
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return rel.split(path.sep).some((seg) => WRITE_PROTECT_DIRS.has(seg));
}

const MAX_DEPTH = 14;
const MAX_ENTRIES = 6000;
const MAX_SEARCH_FILES = 4000;
const MAX_SEARCH_HITS = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB

// ---------- helpers ----------
function assertAbs(p: unknown, label = 'path'): string {
  if (typeof p !== 'string' || !p.trim()) throw new Error(`${label.toUpperCase()}_REQUIRED`);
  if (!path.isAbsolute(p)) throw new Error(`${label.toUpperCase()}_MUST_BE_ABSOLUTE`);
  return p;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * v11.31 — turn raw OS errors into actionable, namespaced errors. Explicit
 * service codes (FILE_TOO_LARGE, PATH_OUTSIDE_WORKSPACE, …) are passed through
 * verbatim so callers can branch on them; everything else gains an operation
 * prefix instead of surfacing a bare "ENOENT: …".
 */
function opError(op: string, err: unknown): Error {
  if (err instanceof Error) {
    const m = err.message;
    if (/^[A-Z][A-Z0-9_]*$/.test(m) || /_[A-Z0-9_]+(?::|$)/.test(m)) return err;
    return new Error(`${op}_FAILED: ${m}`);
  }
  return new Error(`${op}_FAILED: ${String(err)}`);
}

/** Heuristic binary sniff on a buffer prefix. */
export function isBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 512);
  if (len === 0) return false;
  let nonPrintable = 0;
  for (let i = 0; i < len; i++) {
    const b = buf[i];
    if (b === 0) return true;
    const isWhitespace = b === 9 || b === 10 || b === 13 || b === 12;
    if ((b < 32 && !isWhitespace) || b === 127) nonPrintable++;
  }
  return nonPrintable / len > 0.3;
}

function includeMatcher(include?: string): (name: string) => boolean {
  if (!include) return () => true;
  const re = new RegExp('^' + escapeRegExp(include).replace(/\\\*/g, '.*') + '$', 'i');
  return (name: string) => re.test(name);
}

// ---------- .surniaignore (workspace root, gitignore-lite) ----------
interface IgnoreRule {
  negate: boolean;
  regex: RegExp; // matches the '/'-separated path relative to the workspace root
}

let ignoreCache: { root: string; mtimeMs: number; rules: IgnoreRule[] } | null = null;

/** Translate one gitignore-lite glob into a RegExp over relative POSIX paths. */
function ignoreRuleRegex(rawPattern: string): RegExp | null {
  let p = rawPattern.trim();
  if (!p || p.startsWith('#')) return null;
  p = p.replace(/^\.\//, '');
  // Escapes every regex char, then re-arms our glob tokens.
  let body = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  if (p.includes('/')) {
    // Anchored to the workspace root; a dir pattern also hides its contents.
    return new RegExp(`^${body}(?:/.*)?$`);
  }
  // Bare name → matches at any depth (basename rule).
  return new RegExp(`(?:^|/)${body}(?:/.*)?$`);
}

function loadSurniaIgnore(root: string): IgnoreRule[] {
  const file = path.join(root, '.surniaignore');
  try {
    const st = fsSync.statSync(file);
    if (ignoreCache && ignoreCache.root === root && ignoreCache.mtimeMs === st.mtimeMs) {
      return ignoreCache.rules;
    }
    const rules: IgnoreRule[] = [];
    for (const line of fsSync.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const raw = line.trim();
      const negate = raw.startsWith('!');
      const re = ignoreRuleRegex(negate ? raw.slice(1) : raw);
      if (re) rules.push({ negate, regex: re });
    }
    ignoreCache = { root, mtimeMs: st.mtimeMs, rules }; // cache keyed on mtime
    return rules;
  } catch {
    ignoreCache = null; // no (or unreadable) .surniaignore
    return [];
  }
}

/**
 * E4: True when `absPath` is excluded by `<workspaceRoot>/.surniaignore`.
 * Exported for any indexer/search outside fsService to integrate against.
 * `isDir` sharpens directory-only trailing-slash rules.
 */
export function isIgnoredPath(absPath: string, workspaceRoot: string, isDir = false): boolean {
  const rules = loadSurniaIgnore(workspaceRoot);
  if (!rules.length) return false;
  let rel: string;
  try {
    rel = path.relative(workspaceRoot, absPath).split(path.sep).join('/');
  } catch {
    return false;
  }
  if (!rel || rel.startsWith('..')) return false;
  const target = isDir ? `${rel}/` : rel; // dir candidates also test the trailing-slash form
  let ignored = false;
  for (const rule of rules) {
    // Last matching rule wins (gitignore semantics).
    if (rule.regex.test(rel) || rule.regex.test(target)) ignored = !rule.negate;
  }
  return ignored;
}

// ---------- tree ----------
export async function readDirTree(root: string): Promise<FileNode | null> {
  if (!root || !path.isAbsolute(root)) return null;
  // v11.31 — once a root is pinned, a renderer asking to list a DIFFERENT
  // absolute directory must be refused (previously readDirTree skipped the
  // jail entirely and could enumerate any path on disk). The first listing
  // still auto-adopts the workspace below.
  const guarded = confineActive() ? await assertSafeExistingRoot(root, 'root') : root;
  noteWorkspaceRoot(root); // E4: auto-confine to the listed workspace
  try {
    const st = await fsp.stat(guarded);
    if (!st.isDirectory()) return null;
    const counter = { count: 0 };
    const children = await walkDir(guarded, 0, counter, guarded);
    return { name: path.basename(guarded) || guarded, path: guarded, type: 'dir', children };
  } catch (err) {
    // v11.31 — do not silently swallow a real IO failure. Security refusals
    // are thrown above; only the documented "not a directory / gone" case
    // still returns null.
    throw new Error(`READ_DIR_FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function walkDir(dir: string, depth: number, counter: { count: number }, ignoreRoot: string | null): Promise<FileNode[]> {
  const out: FileNode[] = [];
  if (depth > MAX_DEPTH || counter.count >= MAX_ENTRIES) return out;

  let entries: import('fs').Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  const visible = entries
    .filter((e) => e.name && !IGNORED_DIRS.has(e.name) && !e.name.startsWith('._'))
    .filter((e) => !ignoreRoot || !isIgnoredPath(path.join(dir, e.name), ignoreRoot, e.isDirectory()))
    .sort((a, b) => {
      const ad = a.isDirectory() ? 0 : 1;
      const bd = b.isDirectory() ? 0 : 1;
      if (ad !== bd) return ad - bd; // dirs first
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

  for (const entry of visible) {
    if (counter.count >= MAX_ENTRIES) break;
    counter.count++;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push({
        name: entry.name,
        path: full,
        type: 'dir',
        children: await walkDir(full, depth + 1, counter, ignoreRoot),
      });
    } else {
      out.push({ name: entry.name, path: full, type: 'file' });
    }
  }
  return out;
}

// ---------- read / write ----------
export async function readFile(p: string): Promise<string> {
  const file = assertSafePath(p);
  try {
    if (activeRoot()) {
      // v11.11 — symlink-escape guard for READS: a link planted inside the
      // workspace must not redirect file content from outside the roots.
      const real = await fsp.realpath(file).catch(() => null);
      if (real !== null && !isInsideAnyRoot(real)) throw new Error('READ_OUTSIDE_WORKSPACE');
      // realpath failed (file gone) → the stat() below reports honest ENOENT.
    }
    const st = await fsp.stat(file);
    if (st.isDirectory()) throw new Error('IS_A_DIRECTORY');
    if (st.size > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');
    const buf = await fsp.readFile(file);
    if (isBinary(buf.subarray(0, 512))) throw new Error('BINARY_FILE');
    return buf.toString('utf8');
  } catch (err) {
    throw opError('READ', err);
  }
}

async function writeGuarded(p: string, content: string): Promise<void> {
  const file = await assertSafeWritePath(p);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content, 'utf8');
}

/**
 * E4: wrap a mutating fs op so a refusal (outside allowed roots, symlink
 * escape, traversal, UNC) is audited (`fs_block`) AND broadcast to the
 * renderer (`kdx:sec:fsBlock`) before the error propagates.
 */
async function guardWriteOp<T>(op: string, target: string, fn: () => Promise<T>): Promise<T> {
  try {
    ensureAppDataRoot();
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // v11.31 — EVERY policy refusal is audited, not just jail escapes:
    // protected .git/node_modules writes and root deletion are security
    // decisions too and must show up in audit.jsonl + the SecurityPanel.
    if (/_OUTSIDE_WORKSPACE|_TRAVERSAL|_UNC_NOT_ALLOWED|_DEVICE_PATH|_PROTECTED_DIR|REFUSING_TO_DELETE_ROOT/.test(msg)) {
      try {
        auditAppend('fs_block', { op, path: String(target).slice(0, 300), error: msg });
      } catch {
        /* audit is best-effort */
      }
      sendSecurityEvent('kdx:sec:fsBlock', { op, path: target, error: msg });
    }
    throw err;
  }
}

export async function writeFile(p: string, content: string): Promise<true> {
  try {
    await guardWriteOp('write', p, () => writeGuarded(p, content ?? ''));
  } catch (err) {
    throw opError('WRITE', err);
  }
  return true;
}

export async function createFile(p: string, content?: string): Promise<true> {
  try {
    await guardWriteOp('createFile', p, () => writeGuarded(p, content ?? ''));
  } catch (err) {
    throw opError('CREATE', err);
  }
  return true;
}

export async function createDir(p: string): Promise<true> {
  try {
    await guardWriteOp('mkdir', p, async () => {
      const dir = await assertSafeWritePath(p);
      await fsp.mkdir(dir, { recursive: true });
      return true;
    });
  } catch (err) {
    throw opError('MKDIR', err);
  }
  return true;
}

export async function deletePath(p: string): Promise<true> {
  try {
    await guardWriteOp('delete', p, async () => {
      const target = assertAbs(p);
      // safety: never allow deleting a filesystem root
      if (path.resolve(target) === path.parse(target).root) throw new Error('REFUSING_TO_DELETE_ROOT');
      await assertSafeWritePath(target, 'path', { checkTarget: false }); // containment + parent-symlink-escape guard
      await fsp.rm(target, { recursive: true, force: true });
      return true;
    });
  } catch (err) {
    throw opError('DELETE', err);
  }
  return true;
}

export async function renamePath(oldPath: string, newPath: string): Promise<true> {
  try {
    await guardWriteOp('rename', newPath, async () => {
      const from = await assertSafeWritePath(oldPath, 'oldPath', { checkTarget: false });
      const to = await assertSafeWritePath(newPath, 'newPath');
      if (path.resolve(from) === path.resolve(to)) throw new Error('RENAME_SAME_PATH');
      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.rename(from, to);
      return true;
    });
  } catch (err) {
    throw opError('RENAME', err);
  }
  return true;
}

// ---------- content search ----------
export async function searchFiles(
  root: string,
  pattern: string,
  include?: string,
): Promise<SearchHit[]> {
  const safeRoot = confineActive() ? await assertSafeExistingRoot(root, 'root') : assertSafePath(root, 'root');
  if (!pattern) return [];
  // v11.11 — renderer-supplied regex is capped: pathological patterns
  // (nested quantifiers) cannot be compiled at any length, and the walk
  // below carries a wall-clock budget so a ReDoS pattern cannot pin the
  // main process. Honest error, not a hang.
  if (typeof pattern !== 'string' || pattern.length > 300) {
    throw new Error('PATTERN_TOO_LONG');
  }
  // v11.31 — length alone is not a ReDoS brake: `^(a+)+$` is 7 chars but
  // exponential. Refuse nested quantifiers with an HONEST error instead of
  // letting one line pin the main process (the deadline below is the 2nd brake).
  if (/(\([^)]*[+*][^)]*\))[+*{]/.test(pattern)) throw new Error('PATTERN_TOO_COMPLEX');
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'i');
  } catch {
    re = new RegExp(escapeRegExp(pattern), 'i');
  }
  const deadline = Date.now() + 4_000;
  const matches = includeMatcher(include);
  const hits: SearchHit[] = [];
  const counter = { files: 0 };
  noteWorkspaceRoot(safeRoot); // E4: auto-confine + enable .surniaignore
  const ignoreRulesRoot = safeRoot;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || hits.length >= MAX_SEARCH_HITS || counter.files >= MAX_SEARCH_FILES) return;
    if (Date.now() > deadline) return; // v11.11 — 4s search budget
    let entries: import('fs').Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hits.length >= MAX_SEARCH_HITS || counter.files >= MAX_SEARCH_FILES) return;
      const full = path.join(dir, entry.name);
      if (isIgnoredPath(full, ignoreRulesRoot, entry.isDirectory())) continue; // E4: honor .surniaignore
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        if (!matches(entry.name)) continue;
        counter.files++;
        try {
          const st = await fsp.stat(full);
          if (st.size > MAX_FILE_BYTES) continue;
          const buf = await fsp.readFile(full);
          if (isBinary(buf.subarray(0, 512))) continue;
          const lines = buf.toString('utf8').split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            // v11.31 — bound the regex input per line (minified files carry
            // 100k-char single lines) AND re-check the wall-clock inside the
            // loop; the outer check only runs between files.
            if ((i & 15) === 0 && Date.now() > deadline) return;
            const line = lines[i];
            if (re.test(line.length > 2000 ? line.slice(0, 2000) : line)) {
              hits.push({ path: full, line: i + 1, text: line.trim().slice(0, 200) });
              if (hits.length >= MAX_SEARCH_HITS) return;
            }
          }
        } catch {
          /* unreadable file — skip */
        }
      }
    }
  };

  try {
    const st = await fsp.stat(safeRoot);
    if (!st.isDirectory()) throw new Error('NOT_A_DIRECTORY');
    await walk(safeRoot, 0);
  } catch (err) {
    // v11.31 — an unreadable/missing search root is an error, not an empty
    // result the agent would report as "no matches".
    throw new Error(`SEARCH_ROOT_UNREADABLE: ${err instanceof Error ? err.message : String(err)}`);
  }
  return hits;
}
