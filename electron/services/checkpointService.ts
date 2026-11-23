// ============================================================
// Surnia — workspace checkpoints (v7.1: SHADOW-COMMIT first)
// Git workspaces: the snapshot is a SHADOW COMMIT on a dedicated ref
// (refs/surnia/checkpoints/<id>) created with `git stash create` —
// it NEVER touches the user's index, working tree or stash list, and
// it restores the workspace by checking the commit back out. The
// manifest also records the sessionId so the UI can restore the
// conversation alongside the files (files + chat together).
// Non-git workspaces fall back to file copies under
// userData/checkpoints/<id>/{files/..., manifest.json} (3000-file cap).
// ============================================================
import { promises as fsp } from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { CheckpointInfo } from '../../shared/types';
import { IGNORED_DIRS } from './fsService';
import { execFile } from 'child_process';

const MAX_FILES = 3000;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB per file
const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // 200MB per snapshot
const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface SnapshotManifest {
  id: string;
  label: string;
  at: number;
  root: string;
  fileCount: number;
  files: string[];
  /** v7.1 — 'shadow' = git shadow commit (ref), 'files' = legacy copy. */
  kind?: 'shadow' | 'files';
  /** v7.1 — shadow commit hash (kind==='shadow'). */
  commit?: string;
  /** v7.1 — the ref pinning the shadow commit against gc. */
  ref?: string;
  /** v7.1 — session id so the UI can restore the conversation with the files. */
  sessionId?: string;
}

function gitExec(args: string[], cwd: string, timeout = 30_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0;
      resolve({ code, out: String(stdout ?? '').trim() });
    });
  });
}

async function isGitRepo(root: string): Promise<boolean> {
  const r = await gitExec(['rev-parse', '--is-inside-work-tree'], root, 10_000);
  return r.code === 0 && r.out === 'true';
}

function userDataSafe(): string {
  try {
    return app.getPath('userData');
  } catch {
    return process.cwd(); // headless CLI stub — harmless fallback
  }
}

function checkpointsDir(): string {
  return path.join(userDataSafe(), 'checkpoints');
}

/** v11.31 — atomic 0600 JSON write (no torn manifests on crash). */
async function writeManifest(file: string, manifest: SnapshotManifest): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  try {
    await fsp.writeFile(tmp, JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fsp.rename(tmp, file);
  } catch (err) {
    try {
      await fsp.rm(tmp, { force: true });
    } catch {
      /* best-effort */
    }
    throw err;
  }
}

async function ensureDir(): Promise<string> {
  const dir = checkpointsDir();
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

// ---------- collection ----------
async function collectFiles(
  root: string,
  budget: { files: number; bytes: number },
): Promise<string[]> {
  const rels: string[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 14 || rels.length >= MAX_FILES || budget.bytes >= MAX_TOTAL_BYTES) return;
    let entries: import('fs').Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (rels.length >= MAX_FILES || budget.bytes >= MAX_TOTAL_BYTES) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        try {
          const st = await fsp.stat(full);
          if (st.size > MAX_FILE_BYTES) continue;
          if (budget.bytes + st.size > MAX_TOTAL_BYTES) continue;
          rels.push(path.relative(root, full));
          budget.files++;
          budget.bytes += st.size;
        } catch {
          /* unreadable — skip */
        }
      }
    }
  };

  await walk(root, 0);
  return rels;
}

// ---------- API ----------
export async function create(root: string, label: string, sessionId?: string): Promise<SnapshotManifest> {
  // v11.31 — never snapshot the process CWD because an empty root slipped through.
  const requested = String(root ?? '').trim();
  if (!requested) throw new Error('WORKSPACE_REQUIRED');
  const resolvedRoot = path.resolve(requested);
  try {
    if (!(await fsp.stat(resolvedRoot)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error('WORKSPACE_NOT_FOUND');
  }
  const dir = await ensureDir();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const cleanLabel = String(label ?? '').slice(0, 200) || 'checkpoint';

  // ---------- v7.1 SHADOW COMMIT (git workspaces) ----------
  // `git stash create` builds a commit capturing the working tree WITHOUT
  // touching the index / worktree / stash list. We pin it with a dedicated
  // ref so gc cannot eat it, and record the sessionId for chat+files restore.
  try {
    if (await isGitRepo(resolvedRoot)) {
      const stashSha = await gitExec(['stash', 'create', `surnia-checkpoint: ${cleanLabel}`], resolvedRoot);
      let commit = stashSha.out;
      if (!commit) {
        // clean tree — the checkpoint anchors at HEAD
        const head = await gitExec(['rev-parse', 'HEAD'], resolvedRoot);
        commit = head.out;
      }
      if (commit && /^[0-9a-f]{7,64}$/.test(commit)) {
        const ref = `refs/surnia/checkpoints/${id}`;
        const upd = await gitExec(['update-ref', ref, commit], resolvedRoot);
        if (upd.code === 0) {
          const changed = await gitExec(['diff', '--name-only', `${commit}..HEAD`], resolvedRoot);
          const manifest: SnapshotManifest = {
            id,
            label: cleanLabel,
            at: Date.now(),
            root: resolvedRoot,
            fileCount: changed.out ? changed.out.split('\n').length : 0,
            files: [],
            kind: 'shadow',
            commit,
            ref,
            ...(sessionId ? { sessionId } : {}),
          };
          await writeManifest(path.join(dir, id, 'manifest.json'), manifest);
          await pruneOld(dir);
          return manifest;
        }
      }
    }
  } catch {
    /* fall through to the file-copy path — never fail the checkpoint */
  }

  // ---------- legacy file-copy fallback (non-git / git failure) ----------
  const dest = path.join(dir, id);
  const filesDir = path.join(dest, 'files');
  await fsp.mkdir(filesDir, { recursive: true });

  const budget = { files: 0, bytes: 0 };
  const rels = await collectFiles(resolvedRoot, budget);

  for (const rel of rels) {
    const src = path.join(resolvedRoot, rel);
    const dst = path.join(filesDir, rel);
    try {
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      await fsp.copyFile(src, dst);
    } catch {
      /* file vanished mid-snapshot — skip */
    }
  }

  const manifest: SnapshotManifest = {
    id,
    label: cleanLabel,
    at: Date.now(),
    root: resolvedRoot,
    fileCount: rels.length,
    files: rels,
    kind: 'files',
    ...(sessionId ? { sessionId } : {}),
  };
  await writeManifest(path.join(dest, 'manifest.json'), manifest);

  await pruneOld(dir);
  return manifest;
}

export async function list(root: string): Promise<CheckpointInfo[]> {
  const dir = checkpointsDir();
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return [];
  }

  const wanted = path.resolve(root);
  const out: CheckpointInfo[] = [];
  for (const name of entries) {
    try {
      const raw = await fsp.readFile(path.join(dir, name, 'manifest.json'), 'utf8');
      const m = JSON.parse(raw) as SnapshotManifest;
      if (!m || m.root !== wanted) continue;
      out.push({ id: m.id, label: m.label + (m.kind === 'shadow' ? ' · shadow-commit' : ''), at: m.at, fileCount: m.fileCount });
    } catch {
      /* no/invalid manifest — skip */
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

/**
 * Validate a manifest rel entry as a plain relative file path.
 * Rejects: absolute paths, Windows drive letters, UNC prefixes,
 * '..' segments (traversal) and NUL bytes. Returns the normalized
 * relative path, or null when the entry is unsafe.
 */
function safeRelEntry(rel: unknown): string | null {
  if (typeof rel !== 'string' || !rel.trim() || rel.includes('\u0000')) return null;
  if (path.isAbsolute(rel)) return null; // absolute / drive-letter-rooted
  if (/^[a-zA-Z]:/.test(rel)) return null; // Windows drive letter ("C:...")
  if (/^\\\\/.test(rel) || /^\/\//.test(rel)) return null; // UNC // server forms
  const normalized = path.normalize(rel);
  if (path.isAbsolute(normalized)) return null;
  if (normalized === '..' || normalized.split(/[\\/]+/).includes('..')) return null;
  if (normalized === '.' || normalized === '') return null;
  return normalized;
}

export async function restore(
  root: string,
  id: string,
  force = false,
): Promise<{ id: string; restored: number; skipped: number; kind?: 'shadow' | 'files'; commit?: string; sessionId?: string }> {
  const safe = String(id ?? '').replace(/[^\w-]/g, '');
  if (!safe) throw new Error('CHECKPOINT_NOT_FOUND');
  const requested = String(root ?? '').trim();
  if (!requested) throw new Error('WORKSPACE_REQUIRED');
  const resolvedRoot = path.resolve(requested);
  try {
    if (!(await fsp.stat(resolvedRoot)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error('WORKSPACE_NOT_FOUND');
  }
  const dir = checkpointsDir();

  let manifest: SnapshotManifest;
  try {
    const raw = await fsp.readFile(path.join(dir, safe, 'manifest.json'), 'utf8');
    manifest = JSON.parse(raw) as SnapshotManifest;
  } catch {
    throw new Error('CHECKPOINT_NOT_FOUND');
  }
  if (!manifest || typeof manifest !== 'object' || manifest.id !== safe) {
    throw new Error('CHECKPOINT_NOT_FOUND');
  }
  // v11.31 — a checkpoint belongs to ONE workspace. Refuse to replay its files
  // into a different root (accidental cross-project overwrite); `force` is the
  // explicit escape hatch for a moved/renamed workspace.
  if (!force && manifest.root && path.resolve(manifest.root) !== resolvedRoot) {
    throw new Error('CHECKPOINT_ROOT_MISMATCH');
  }

  // ---------- v7.1 — shadow-commit restore: check the commit back out ----------
  if (manifest.kind === 'shadow' && manifest.commit && /^[0-9a-f]{7,64}$/.test(manifest.commit)) {
    const co = await gitExec(['checkout', manifest.commit, '--', '.'], resolvedRoot, 120_000);
    if (co.code !== 0) throw new Error('SHADOW_RESTORE_FAILED');
    return { id: safe, restored: -1, skipped: 0, kind: 'shadow', commit: manifest.commit, ...(manifest.sessionId ? { sessionId: manifest.sessionId } : {}) };
  }

  const filesDir = path.join(dir, safe, 'files');
  let restored = 0;
  let skipped = 0;

  await fsp.mkdir(resolvedRoot, { recursive: true });
  // v11.31 — a tampered manifest with a non-array `files` must never crash the
  // restore mid-way (leaving a half-restored workspace).
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  for (const rel of files) {
    // SECURITY: manifest.json lives on disk and can be tampered with.
    // Every rel entry must be a plain relative path that resolves
    // STRICTLY inside the destination root — anything else (absolute,
    // drive-letter, UNC or '../' traversal) is skipped and counted.
    const cleanRel = safeRelEntry(rel);
    if (!cleanRel) {
      skipped++;
      continue;
    }
    const dst = path.resolve(resolvedRoot, cleanRel);
    const relCheck = path.relative(resolvedRoot, dst);
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck) || relCheck === '') {
      skipped++;
      continue;
    }
    // v11.31 — defense in depth: the SOURCE must also stay inside the
    // snapshot folder, not just the destination inside the workspace.
    const src = path.resolve(filesDir, cleanRel);
    const srcCheck = path.relative(filesDir, src);
    if (srcCheck.startsWith('..') || path.isAbsolute(srcCheck) || srcCheck === '') {
      skipped++;
      continue;
    }
    try {
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      await fsp.copyFile(src, dst);
      restored++;
    } catch {
      /* missing snapshot file — skip */
      skipped++;
    }
  }
  return { id: safe, restored, skipped, kind: 'files', ...(manifest.sessionId ? { sessionId: manifest.sessionId } : {}) };
}

// ---------- v11.31: undo / rewind (explicit, honest UX) ----------

export type RestoreResult = Awaited<ReturnType<typeof restore>>;

/** Undo = restore the newest checkpoint for this workspace. */
export async function undo(root: string): Promise<RestoreResult> {
  const newest = (await list(root))[0];
  if (!newest) throw new Error('CHECKPOINT_NOT_FOUND');
  return restore(root, newest.id);
}

/**
 * Rewind N checkpoints back (newest = index 0). Clamped to the available
 * history so the caller always gets a real restore or a clear error — never
 * a silent no-op that claims success.
 */
export async function rewind(root: string, steps: number): Promise<RestoreResult & { steps: number }> {
  const history = await list(root);
  if (history.length === 0) throw new Error('CHECKPOINT_NOT_FOUND');
  const n = Math.min(Math.max(1, Math.floor(Number(steps) || 1)), history.length - 1);
  const target = history[n];
  const result = await restore(root, target.id);
  return { ...result, steps: n };
}

// ---------- prune ----------
async function pruneOld(dir: string): Promise<void> {
  const cutoff = Date.now() - PRUNE_AFTER_MS;
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    try {
      const raw = await fsp.readFile(path.join(dir, name, 'manifest.json'), 'utf8');
      const m = JSON.parse(raw) as SnapshotManifest;
      if (m?.at && m.at < cutoff) {
        // v11.31 — a pruned shadow checkpoint must not leave an orphan ref
        // pinning its commit forever. The ref name is validated strictly before
        // it is passed to git (no argument injection from a tampered manifest).
        if (m.kind === 'shadow' && typeof m.ref === 'string' && /^refs\/surnia\/checkpoints\/[A-Za-z0-9_-]+$/.test(m.ref) && m.root) {
          await gitExec(['update-ref', '-d', m.ref], m.root, 10_000);
        }
        await fsp.rm(path.join(dir, name), { recursive: true, force: true });
      }
    } catch {
      /* unreadable manifest — leave it */
    }
  }
}
