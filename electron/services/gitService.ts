// ============================================================
// Surnia — git service (thin spawn wrapper around the git CLI)
// v2 adds: worktrees (list/create/remove/merge), numstat stats and
// one-shot AI helpers (commit message, code review) — the AI completer
// is injected (aiService.aiComplete) so this module stays electron-free.
//
// v11.31 capability audit:
//   • every failure is actionable + English-only (no raw stderr dumps,
//     no silent `return null` / `return []` / `return true` on git errors);
//   • credentials embedded in remote URLs / error text are redacted before
//     they can reach the renderer, logs or an AI completer;
//   • one controlled timeout budget per operation class, timer always cleared
//     and the timed-out command is identified in the error;
//   • repository paths and worktree paths are validated (no option injection,
//     no '..' escape from the worktree include copier, no symlink escapes).
// ============================================================
import { spawn } from 'child_process';
import { promises as fsp } from 'fs';
import * as path from 'path';
import type {
  AiCompleteParams,
  AiCompleteResult,
  GitChange,
  GitDiff,
  GitLogEntry,
  GitStatus,
  WorktreeInfo,
} from '../../shared/types';

const MAX_CAPTURE = 5 * 1024 * 1024; // 5MB

/** Timeout budgets (ms): local reads are fast; writes/merge get a long budget. */
export const GIT_TIMEOUT_MS = 30_000;
export const GIT_SLOW_TIMEOUT_MS = 120_000;
const DIRTY_CHECK_TIMEOUT_MS = 5_000;

/** Strip credentials from anything that may be shown to the user / an AI. */
export function redactSecrets(text: string): string {
  return String(text ?? '')
    // https://user:token@host/...  →  https://***@host/...
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi, '$1***@')
    // token=abc / Authorization: Bearer abc / password: xyz
    .replace(/\b((?:authorization|token|password|passwd|secret|api[-_]?key)\s*[:=]\s*)([^\s,;]+)/gi, '$1***');
}

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  timeoutMs: number;
}

function git(root: string, args: string[], timeoutMs = GIT_TIMEOUT_MS): Promise<GitResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // `-c core.quotePath=false` keeps UTF-8 / spaced filenames intact in
    // porcelain output and diffs on every OS. `-C` before the subcommand.
    const child = spawn('git', ['-c', 'core.quotePath=false', '-C', root, ...args], {
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    });

    const finish = (code: number, timedOut = false): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        code,
        stdout,
        stderr: redactSecrets(stderr),
        timedOut,
        timeoutMs,
      });
    };

    child.stdout?.on('data', (c: Buffer) => {
      if (stdout.length < MAX_CAPTURE) stdout += c.toString('utf8');
    });
    child.stderr?.on('data', (c: Buffer) => {
      if (stderr.length < MAX_CAPTURE) stderr += c.toString('utf8');
    });
    child.on('close', (code) => finish(code ?? 1));
    child.on('error', (err) => {
      stderr += String(err);
      finish(127);
    });
    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      stderr += `\n[surnia] git command timed out after ${timeoutMs}ms`;
      finish(124, true);
    }, timeoutMs);
  });
}

/** Actionable, English-only error from a failed git invocation (no raw dump). */
function actionError(action: string, res: GitResult, hint: string): Error {
  const firstLine = (res.stderr || res.stdout).split('\n').map((l) => l.trim()).find(Boolean) ?? 'git reported an error';
  const reason = res.timedOut
    ? `timed out after ${res.timeoutMs}ms`
    : firstLine.slice(0, 400);
  return new Error(`${action} failed (${reason}). ${hint}`);
}

const NOT_A_REPO = /not a git repository/i;

/**
 * v11.38 — porcelain XY codes that mean "unmerged / conflict", not a clean
 * staged or unstaged edit. Git emits UU (both modified), AA (both added),
 * DD (both deleted), AU/UA, DU/UD. The UI must say CONFLICT, never "staged".
 */
export function isConflictStatus(status: string): boolean {
  const s = String(status ?? '').trim();
  return s.includes('U') || s === 'AA' || s === 'DD';
}

// ---------- status ----------
export async function status(root: string): Promise<GitStatus | null> {
  const res = await git(root, ['status', '--porcelain=v1', '-b']);
  if (res.code !== 0) {
    // `null` is the documented "this folder is not a repository" signal.
    // Every OTHER failure (corruption, lock, timeout) is surfaced, not swallowed.
    if (NOT_A_REPO.test(res.stderr)) return null;
    throw actionError('git status', res, 'Open a valid git repository or initialize it with git init.');
  }

  let branch = '';
  const changed: GitChange[] = [];
  const lines = res.stdout.split('\n');

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!line) continue;
    if (line.startsWith('## ')) {
      const head = line.slice(3);
      if (head.startsWith('No commits yet on ')) {
        branch = head.slice('No commits yet on '.length).trim();
      } else if (/\(no branch\)/.test(head)) {
        branch = '(detached)';
      } else {
        branch = head.split(' ')[0].split('...')[0];
      }
      continue;
    }
    if (line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    let filePath = line.slice(3).trim();
    const arrow = filePath.indexOf(' -> ');
    if (arrow >= 0) filePath = filePath.slice(arrow + 4); // renames: report destination
    // v11.38 — an unmerged path is NOT cleanly staged. Report a single honest
    // 'U' code (staged=false) so callers can show "conflict — resolve first"
    // instead of mislabelling it as an ordinary staged change.
    const conflict = isConflictStatus(`${x}${y}`);
    const staged = !conflict && x !== ' ' && x !== '?';
    const statusChar = conflict ? 'U' : ((x !== ' ' ? x : y).trim() || '?');
    changed.push({ path: filePath, status: x === '?' && y === '?' ? '??' : statusChar, staged });
  }

  return { isRepo: true, branch: branch || 'HEAD', changed };
}

// ---------- diff ----------
export async function diff(root: string, filePath?: string): Promise<GitDiff[]> {
  const out: GitDiff[] = [];

  const wtArgs = ['diff', '--no-color'];
  const ixArgs = ['diff', '--cached', '--no-color'];
  if (filePath) {
    wtArgs.push('--', filePath);
    ixArgs.push('--', filePath);
  }

  const [wt, ix] = await Promise.all([git(root, wtArgs), git(root, ixArgs)]);
  const failed = [wt, ix].find((r) => r.code !== 0);
  if (failed) {
    if (NOT_A_REPO.test(failed.stderr)) return [];
    throw actionError('git diff', failed, 'Check the repository is healthy and the path exists.');
  }

  if (wt.stdout.trim()) {
    out.push({ path: filePath ?? '(working tree)', patch: wt.stdout });
  }
  if (ix.stdout.trim()) {
    out.push({ path: filePath ? `${filePath} (staged)` : '(index)', patch: ix.stdout });
  }
  return out;
}

// ---------- stage ----------
export async function stage(root: string, paths: string[]): Promise<true> {
  const list = Array.isArray(paths) ? paths : [];
  const failures: string[] = [];
  for (const p of list) {
    if (typeof p !== 'string' || !p.trim()) continue;
    if (p.startsWith('!')) {
      const target = p.slice(1).trim();
      let res = await git(root, ['reset', 'HEAD', '--', target]);
      if (res.code !== 0 && /ambiguous argument 'HEAD'|unknown revision|fatal: bad revision/i.test(res.stderr)) {
        // Repository with no commits yet: unstage directly from the index.
        res = await git(root, ['rm', '--cached', '-r', '--', target]);
      }
      if (res.code !== 0) failures.push(`${target}: ${actionError('git reset', res, '').message}`);
    } else {
      const res = await git(root, ['add', '--', p]);
      if (res.code !== 0) failures.push(`${p}: ${actionError('git add', res, '').message}`);
    }
  }
  if (failures.length) {
    throw new Error(`git stage failed for ${failures.length} path(s): ${failures.join('; ')}. Check the paths and retry.`);
  }
  return true;
}

// ---------- commit ----------
export async function commit(root: string, message: string): Promise<string> {
  const msg = String(message ?? '');
  if (!msg.trim()) {
    throw new Error('git commit failed: the commit message is empty. Provide a message and retry.');
  }
  let res = await git(root, ['commit', '-m', msg]);

  // identity may be unset on fresh machines → set a local one and retry once
  if (res.code !== 0 && /user\.name|user\.email|Please tell me who you are|identity/i.test(res.stderr)) {
    await git(root, ['config', 'user.name', 'Surnia']);
    await git(root, ['config', 'user.email', 'surnia@local']);
    res = await git(root, ['commit', '-m', msg]);
  }

  const combined = res.stdout + res.stderr;
  if (res.code !== 0) {
    if (/nothing to commit|no changes added/i.test(combined)) return '';
    // v11.38 — a conflicted index is not "stage your changes": say so plainly.
    if (/unmerged|conflict|merge in progress|MERGE_HEAD|not concluded your merge|resolve your current index/i.test(combined)) {
      throw new Error(
        'git commit blocked: unresolved merge conflicts (or an in-progress merge). ' +
          'Resolve every conflicted file, stage it, then retry — or run git merge --abort.',
      );
    }
    if (/user\.name|user\.email|Please tell me who you are|identity/i.test(combined)) {
      throw new Error(
        'git commit blocked: no git identity could be configured automatically. ' +
          'Run git config user.name "Your Name" and git config user.email "you@example.com", then retry.',
      );
    }
    throw actionError('git commit', res, 'Stage changes with git add first, then retry.');
  }

  // Authoritative: never fish a hash out of free-form output (it can match a
  // word in the commit message or in a git hint).
  const rp = await git(root, ['rev-parse', '--short', 'HEAD']);
  return rp.code === 0 ? rp.stdout.trim() : (combined.match(/\b[0-9a-f]{7,40}\b/)?.[0] ?? '');
}

// ---------- init ----------
export async function init(root: string): Promise<true> {
  const res = await git(root, ['init']);
  if (res.code !== 0) throw actionError('git init', res, 'Check that the folder exists and is writable.');
  return true;
}

// ---------- log ----------
export async function log(root: string, n = 30): Promise<GitLogEntry[]> {
  const count = Math.max(1, Math.min(200, Number(n) || 30));
  const res = await git(root, [
    'log',
    `-n`,
    String(count),
    '--pretty=format:%h%x09%an%x09%ad%x09%s',
    '--date=short',
  ]);
  if (res.code !== 0) {
    // Empty repository and "not a repo" are normal empty states for the UI.
    if (/does not have any commits|not a git repository/i.test(res.stderr)) return [];
    throw actionError('git log', res, 'Open a repository with at least one commit.');
  }

  return res.stdout
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter(Boolean)
    .map((line) => {
      const [hash = '', author = '', date = '', ...rest] = line.split('\t');
      return { hash, author, date, message: rest.join('\t') };
    });
}

// ---------- checkout ----------
export async function checkout(root: string, branch: string): Promise<true> {
  const ref = safeRef(branch);
  if (!ref) {
    throw new Error('INVALID_REF: use a branch name of 1-120 letters, digits, dots, underscores, dashes or slashes (no leading dash).');
  }
  const res = await git(root, ['checkout', ref]);
  if (res.code !== 0) {
    const msg = `${res.stderr}\n${res.stdout}`;
    // v11.38 — honest, specific refusals. A branch switch that would clobber
    // local work, or one attempted during an unresolved merge, is not a generic
    // "checkout failed": tell the user the real reason and the next step.
    if (/would be overwritten|local changes|uncommitted changes|would overwrite/i.test(msg)) {
      throw new Error(
        `git checkout blocked: switching to "${ref}" would overwrite your local changes. ` +
          'Commit or stash them first, then retry.',
      );
    }
    if (/unmerged|conflict|merge in progress|resolve your current index|index first/i.test(msg)) {
      throw new Error(
        `git checkout blocked: the repository has unresolved conflicts (or an in-progress merge). ` +
          'Resolve them, or run git merge --abort, before switching branches.',
      );
    }
    throw actionError(
      'git checkout',
      res,
      'Use git branch --list to see available branches, or create one first (git checkout -b <name>).',
    );
  }
  return true;
}

// ============================================================
// v11.38 — branch management + identity (real git, no mocks)
// ============================================================

export interface GitBranchInfo {
  name: string;
  hash: string;
  current: boolean;
}

/** List local branches via for-each-ref (portable, no colour/locale parsing). */
export async function listBranches(root: string): Promise<GitBranchInfo[]> {
  const res = await git(root, [
    'for-each-ref',
    '--format=%(refname:short)%09%(objectname:short)%09%(HEAD)',
    'refs/heads',
  ]);
  if (res.code !== 0) {
    if (NOT_A_REPO.test(res.stderr)) return [];
    throw actionError('git branch list', res, 'Open a valid git repository and retry.');
  }
  return res.stdout
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter(Boolean)
    .map((line) => {
      const [name = '', hash = '', head = ''] = line.split('\t');
      return { name: name.trim(), hash: hash.trim(), current: head.trim() === '*' };
    })
    .filter((b) => b.name);
}

/**
 * Create a local branch, optionally switching to it and/or starting from a
 * verified ref. Ref names go through safeRef so no CLI option injection is
 * possible; a missing start point fails early with an actionable message.
 */
export async function createBranch(
  root: string,
  name: string,
  opts?: { checkout?: boolean; startPoint?: string },
): Promise<GitBranchInfo> {
  const ref = safeRef(name);
  if (!ref) {
    throw new Error(
      'INVALID_BRANCH: use 1-120 letters, digits, dots, underscores, dashes or slashes (no leading dash, no "..").',
    );
  }
  let start = '';
  if (opts?.startPoint && String(opts.startPoint).trim()) {
    const sp = safeRef(opts.startPoint);
    if (!sp) throw new Error('INVALID_START_POINT: use a branch, tag or commit ref (letters, digits, dots, dashes, slashes).');
    const verify = await git(root, ['rev-parse', '--verify', `${sp}^{commit}`]);
    if (verify.code !== 0) {
      throw new Error(`BRANCH_START_MISSING: the start point "${sp}" does not exist (unborn HEAD?). Commit first or pass an existing ref.`);
    }
    start = sp;
  }
  const args = opts?.checkout ? ['checkout', '-b', ref] : ['branch', ref];
  if (start) args.push(start);
  const res = await git(root, args);
  if (res.code !== 0) {
    const msg = (res.stderr || res.stdout).trim().slice(0, 400);
    throw new Error(`git branch create failed: ${msg}. Pick a different name or check the start point.`);
  }
  const rp = await git(root, ['rev-parse', '--short', ref]);
  return { name: ref, hash: rp.code === 0 ? rp.stdout.trim() : '', current: !!opts?.checkout };
}

export interface GitIdentityInfo {
  configured: boolean;
  name: string;
  email: string;
}

/** Report the effective local git identity so the UI can be honest about the
 *  author git will record (commit auto-fixes a missing one to Surnia/local). */
export async function identityInfo(root: string): Promise<GitIdentityInfo> {
  const [nameRes, emailRes] = await Promise.all([
    git(root, ['config', 'user.name']),
    git(root, ['config', 'user.email']),
  ]);
  const name = nameRes.code === 0 ? nameRes.stdout.trim() : '';
  const email = emailRes.code === 0 ? emailRes.stdout.trim() : '';
  return { configured: !!(name && email), name, email };
}

// ============================================================
// v2 — diff stats, worktrees, AI commit/review helpers
// ============================================================

export type AiCompleter = (p: AiCompleteParams) => Promise<AiCompleteResult>;

const DIFF_CAP = 12_000; // chars handed to the AI helpers
const MAX_DIRTY_CHECKS = 12; // cap per-worktree status probes

/** Refuse refs that could smuggle extra CLI args (leading dash / whitespace). */
function safeRef(ref: string): string | null {
  const r = String(ref ?? '').trim();
  return /^[A-Za-z0-9._\-/]{1,120}$/.test(r) && !r.startsWith('-') && !r.includes('..') ? r : null;
}

/** Changed-file counters for a tree (staged + unstaged vs HEAD). */
export async function diffNumstat(
  root: string,
  timeoutMs = GIT_TIMEOUT_MS,
): Promise<{ files: number; insertions: number; deletions: number }> {
  let res = await git(root, ['diff', 'HEAD', '--numstat', '--no-color'], timeoutMs);
  if (res.code !== 0) {
    if (res.timedOut) throw actionError('git diff --numstat', res, 'The repository is too large; increase the timeout and retry.');
    if (!/ambiguous argument 'HEAD'|unknown revision|does not have any commits/i.test(res.stderr)) {
      throw actionError('git diff --numstat', res, 'Open a valid git repository and retry.');
    }
    // repo without commits yet → fall back to index+worktree diffs
    const [cached, wt] = await Promise.all([
      git(root, ['diff', '--cached', '--numstat', '--no-color'], timeoutMs),
      git(root, ['diff', '--numstat', '--no-color'], timeoutMs),
    ]);
    if (cached.timedOut || wt.timedOut || cached.code !== 0 || wt.code !== 0) {
      const bad = cached.timedOut || cached.code !== 0 ? cached : wt;
      throw actionError('git diff --numstat', bad, 'Reduce the diff size or increase the timeout and retry.');
    }
    res = { code: 0, stdout: cached.stdout + wt.stdout, stderr: cached.stderr + wt.stderr, timedOut: false, timeoutMs };
  }
  const stat = { files: 0, insertions: 0, deletions: 0 };
  for (const line of res.stdout.split('\n')) {
    const parts = line.replace(/\r$/, '').split('\t');
    if (parts.length < 3 || !parts[2]) continue;
    stat.files++;
    stat.insertions += Number(parts[0]) || 0;
    stat.deletions += Number(parts[1]) || 0;
  }
  return stat;
}

// ---------- worktrees ----------

/** Parse `git worktree list --porcelain` into WorktreeInfo[]. */
export async function listWorktrees(root: string): Promise<WorktreeInfo[]> {
  const res = await git(root, ['worktree', 'list', '--porcelain']);
  if (res.code !== 0) throw actionError('git worktree list', res, 'Open a valid git repository and retry.');

  const out: WorktreeInfo[] = [];
  let wtPath = '';
  let branch = '';
  const flush = (): void => {
    if (!wtPath) return;
    const bare = branch === '(bare)';
    if (!bare) {
      const base = path.basename(wtPath) || wtPath;
      out.push({
        // canonical short name: sadeem-<name> dirs (our siblings) → <name>;
        // legacy surnia-<name> dirs still resolve (v10.1 worktrees keep working)
        name: base.startsWith('sadeem-')
          ? base.slice('sadeem-'.length)
          : base.startsWith('surnia-')
            ? base.slice('surnia-'.length)
            : base,
        // git porcelain prints paths with forward slashes on Windows; the
        // create/remove APIs hand back path.resolve()'d native paths. Normalize
        // here so resolveWorktree()/session hand-off compare equal cross-OS.
        path: path.resolve(wtPath),
        branch: branch || '(detached)',
        createdAt: Date.now(),
      });
    }
    wtPath = '';
    branch = '';
  };

  for (const raw of res.stdout.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      const rawPath = line.slice('worktree '.length).trim();
      // git porcelain may quote a path that contains spaces; core.quotePath=false
      // (set on every git() call) keeps UTF-8 raw, but strip one quote pair anyway.
      wtPath = rawPath.length >= 2 && /^".*"$/.test(rawPath) ? rawPath.slice(1, -1) : rawPath;
    } else if (line.startsWith('branch ')) branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    else if (line === 'detached') branch = '(detached)';
    else if (line === 'bare') branch = '(bare)';
  }
  flush();

  // Dirty flag: a porcelain status probe per worktree (capped, short timeout).
  for (const w of out.slice(0, MAX_DIRTY_CHECKS)) {
    try {
      const st = await git(w.path, ['status', '--porcelain'], DIRTY_CHECK_TIMEOUT_MS);
      w.dirty = st.code === 0 ? st.stdout.trim().length > 0 : undefined;
    } catch {
      /* dirty stays unknown */
    }
  }
  return out;
}

const WORKTREE_NAME_RE = /^[a-z0-9][a-z0-9-_]{0,39}$/;

function worktreeBranch(name: string): string {
  return `sadeem/${name}`;
}

/** Sibling of the repo root: <parent>/sadeem-<name>. */
export function worktreePath(root: string, name: string): string {
  return path.resolve(root, '..', `sadeem-${name}`);
}

function cleanWorktreeName(name: string): string {
  const clean = String(name ?? '').trim().toLowerCase();
  if (!WORKTREE_NAME_RE.test(clean)) {
    throw new Error('INVALID_NAME: use 1-40 characters of a-z, 0-9, dash or underscore, starting with a letter or digit.');
  }
  return clean;
}

/**
 * v11.35 — resolve and VERIFY the base before creating a worktree.
 * A missing base (empty repo, typo, bad ref) used to surface as a raw, cryptic
 * `git worktree add` message. We now fail early with one actionable English
 * error + next step. Checking HEAD separately makes a DETACHED HEAD safe: the
 * new branch is still created at the verified commit instead of relying on an
 * implicit HEAD interpretation.
 */
async function resolveWorktreeBase(root: string, base?: string): Promise<string> {
  const raw = base == null || base === '' ? 'HEAD' : String(base);
  const ref = safeRef(raw);
  if (!ref) {
    throw new Error(
      'INVALID_BASE: the worktree base must be a branch, tag or commit (1-120 letters, digits, dots, dashes or slashes; no ".."). ' +
        'Retry with base omitted (uses HEAD) or pass a ref such as "main".',
    );
  }
  const verify = await git(root, ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (verify.code !== 0) {
    // Distinguish an unborn HEAD (no commits yet) from a typo/dangling ref.
    // A detached HEAD still resolves here, so it is never blamed incorrectly.
    const headCommit = await git(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
    const why = headCommit.code !== 0
      ? 'the repository has no commits yet (unborn HEAD)'
      : `the ref "${ref}" does not exist`;
    throw new Error(
      `WORKTREE_BASE_MISSING: cannot create a worktree because ${why}. ` +
        'Commit your changes first (or pass base=<existing-branch-or-commit>), then retry.',
    );
  }
  return ref;
}

/** Create an isolated worktree + branch sadeem/<name> as a sibling directory. */
export async function createWorktree(root: string, name: string, base?: string): Promise<WorktreeInfo> {
  const clean = cleanWorktreeName(name);
  const target = assertWorktreeTarget(root, clean);
  const ref = await resolveWorktreeBase(root, base);

  // Refuse to clobber a pre-existing directory with an actionable message.
  const existing = await fsp.stat(target).catch(() => null);
  if (existing) {
    throw new Error(
      `WORKTREE_EXISTS: "${target}" already exists. Remove it with worktree_remove (force=true if dirty) or pick a different name.`,
    );
  }

  // Long budget: worktree add checks out a whole tree from scratch. Passing the
  // verified ref explicitly makes detached HEAD deterministic and safe.
  const res = await git(root, ['worktree', 'add', target, '-b', worktreeBranch(clean), ref], GIT_SLOW_TIMEOUT_MS);
  if (res.code !== 0) {
    const msg = (res.stderr.trim() || res.stdout.trim() || 'git worktree add failed').slice(0, 600);
    throw new Error(
      /already exists|already used|already checked out/i.test(msg)
        ? `WORKTREE_EXISTS: a worktree or branch named "${clean}" already exists. Remove it with worktree_remove or pick a different name.`
        : `WORKTREE_ADD_FAILED: ${msg}. Check the workspace path and that the branch sadeem/${clean} is not in use.`,
    );
  }
  // Best-effort .worktreeinclude copy (never fails creation) — see function.
  await copyWorktreeInclude(root, target);
  return {
    name: clean,
    path: target,
    branch: worktreeBranch(clean),
    createdAt: Date.now(),
    dirty: false,
  };
}

/**
 * v10.2 — `.worktreeinclude` lists git-ignored paths (e.g. .env) a fresh
 * worktree NEEDS to build/run. Paths are copied from the main tree when they
 * exist there and are absent in the new worktree. Best-effort by design: a
 * failed copy never fails worktree creation.
 */
async function copyWorktreeInclude(root: string, target: string): Promise<void> {
  try {
    const incPath = path.join(root, '.worktreeinclude');
    const raw = await fsp.readFile(incPath, 'utf8').catch(() => '');
    const patterns = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    if (patterns.length === 0) return;
    for (const rel of patterns.slice(0, 64)) {
      // v11.35 — normalize Windows backslashes to '/' so the same include file
      // works on both OSes, then judge the path with native path.resolve().
      const normalized = rel.replace(/\\/g, '/').replace(/^\.\//, '');
      const segments = normalized.split('/').filter(Boolean);
      // Path jail: refuse NUL bytes, POSIX/WIN absolute paths (incl. drive-
      // relative "C:foo"), and any '..' segment that could escape either tree.
      if (!segments.length || normalized.includes('\u0000')) continue;
      if (path.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) continue;
      if (segments.includes('..')) continue;
      const safeRel = segments.join('/');
      const srcP = path.resolve(root, safeRel);
      const dstP = path.resolve(target, safeRel);
      if (!isInside(root, srcP) || !isInside(target, dstP)) continue;
      const st = await fsp.stat(srcP).catch(() => null);
      if (!st || (!st.isFile() && !st.isDirectory())) continue;
      const already = await fsp.stat(dstP).catch(() => null);
      if (already) continue; // worktree copy wins — never clobber a real file
      await fsp.mkdir(path.dirname(dstP), { recursive: true });
      if (st.isDirectory()) await copyDirFlat(srcP, dstP, 0);
      else await fsp.copyFile(srcP, dstP);
    }
  } catch {
    /* .worktreeinclude is an optimization — never fail creation over it */
  }
}

/** Separator-safe containment test (mirrors fsService.isInside). */
function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * v11.35 — path jail for worktree targets. `cleanWorktreeName()` already
 * rejects traversal in a name; this is defence in depth so a resolved path can
 * never land inside the repo (or anywhere other than the parent/sadeem-<name>
 * sibling), including Windows drive-letter and UNC edge cases.
 * Throws an actionable, English-only error with a next step.
 */
export function assertWorktreeTarget(root: string, name: string): string {
  const clean = cleanWorktreeName(name);
  const base = path.resolve(root);
  const parent = path.dirname(base);
  const expectedName = `sadeem-${clean}`;
  const target = path.resolve(parent, expectedName);
  if (
    target === base ||
    isInside(base, target) || // never create/remove INSIDE the workspace
    path.dirname(target) !== parent ||
    path.basename(target) !== expectedName ||
    !parent // empty/unresolvable parent (pathological root)
  ) {
    throw new Error(
      `UNSAFE_PATH: refused worktree path "${target}" for "${clean}" — it is not a direct sibling of the workspace. ` +
        'Use a short slug of a-z, 0-9, dash or underscore and open the repository from a normal folder.',
    );
  }
  return target;
}

async function copyDirFlat(src: string, dst: string, depth: number): Promise<void> {
  if (depth > 6) return; // shallow copy guard
  await fsp.mkdir(dst, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    if (e.isSymbolicLink()) continue; // never follow links out of the repo
    const s = path.resolve(src, e.name);
    const d = path.resolve(dst, e.name);
    if (!isInside(src, s) || !isInside(dst, d)) continue; // no name-based escape
    if (e.isDirectory()) await copyDirFlat(s, d, depth + 1);
    else if (e.isFile()) await fsp.copyFile(s, d);
  }
}

/** v10.2 — resolve one worktree by short name (composer picker + session hand-off). */
export async function resolveWorktree(root: string, name: string): Promise<WorktreeInfo | null> {
  const clean = String(name ?? '').trim().toLowerCase();
  if (!clean) return null;
  const list = await listWorktrees(root).catch(() => [] as WorktreeInfo[]);
  return list.find((w) => w.name === clean) ?? null;
}

/**
 * Remove a worktree (by name) and delete its sadeem/<name> branch.
 * v11.35 hardening:
 *   • path jail — a registered path that is not the expected sibling is refused;
 *   • dirty guard — we probe status ourselves (language-independent) instead of
 *     relying on parsing localized git stderr, and only force=true can discard;
 *   • stale registrations are pruned instead of failing forever.
 * Every failure is one actionable English error with a next step.
 */
export async function removeWorktree(root: string, name: string, force?: boolean): Promise<true> {
  const clean = cleanWorktreeName(name);
  const expected = assertWorktreeTarget(root, clean);
  const known = await listWorktrees(root).catch(() => [] as WorktreeInfo[]);
  const target = known.find((w) => w.name === clean)?.path ?? expected;

  // Never delete anything outside the expected parent/sadeem-<name> sibling.
  const parent = path.dirname(path.resolve(root));
  if (path.resolve(target) !== expected || path.dirname(path.resolve(target)) !== parent) {
    throw new Error(
      `UNSAFE_PATH: the registered path for "${clean}" ("${target}") is not the expected sibling "${expected}". ` +
        'Remove it manually after inspecting it, then retry.',
    );
  }

  // Proactive dirty check (works regardless of git's UI locale).
  if (!force) {
    const st = await git(target, ['status', '--porcelain'], DIRTY_CHECK_TIMEOUT_MS);
    if (st.code === 0 && st.stdout.trim()) {
      throw new Error(
        `WORKTREE_DIRTY: "${clean}" has uncommitted changes. Commit or stash them in the worktree, ` +
          'or call worktree_remove with force=true to discard them.',
      );
    }
  }

  const res = await git(
    root,
    force ? ['worktree', 'remove', '--force', target] : ['worktree', 'remove', target],
    GIT_SLOW_TIMEOUT_MS,
  );
  if (res.code !== 0) {
    const msg = (res.stderr.trim() || res.stdout.trim() || 'git worktree remove failed').slice(0, 600);
    if (/dirty|modified|untracked/i.test(msg) && !force) {
      throw new Error(
        `WORKTREE_DIRTY: "${clean}" has uncommitted changes. Commit or stash them, or call worktree_remove with force=true to discard them.`,
      );
    }
    if (/not a working tree|does not exist|not a valid|invalid path/i.test(msg)) {
      // Stale admin entry (directory was deleted by hand): prune and continue
      // to branch cleanup so the session never gets stuck on a ghost worktree.
      await git(root, ['worktree', 'prune'], GIT_TIMEOUT_MS);
    } else {
      throw new Error(`WORKTREE_REMOVE_FAILED: ${msg}. Check that the worktree still exists and is not locked.`);
    }
  }

  // Branch cleanup is best-effort (detached HEADs have no sadeem branch).
  await git(root, ['branch', '-D', worktreeBranch(clean)]);
  return true;
}

export interface WorktreeMergeResult {
  ok: boolean;
  merged?: string[];
  error?: string;
}

/** Merge sadeem/<name> into the main tree, then (best-effort) remove the worktree. */
export async function mergeWorktree(root: string, name: string): Promise<WorktreeMergeResult> {
  const clean = cleanWorktreeName(name);
  const branch = worktreeBranch(clean);

  // --no-edit: never let a merge hang on an interactive commit editor.
  const res = await git(root, ['merge', '--no-edit', branch], GIT_SLOW_TIMEOUT_MS);
  if (res.code !== 0) {
    // Leave the repo in a clean state: abort an in-progress conflicted merge.
    await git(root, ['merge', '--abort']).catch(() => undefined);
    const reason = res.timedOut
      ? `merge timed out after ${GIT_SLOW_TIMEOUT_MS}ms`
      : (res.stderr.trim() || res.stdout.trim() || 'git merge failed').slice(0, 1200);
    return {
      ok: false,
      error: `MERGE_FAILED: ${reason}. Resolve the conflict in the main worktree or remove the worktree; the main branch was left unchanged.`,
    };
  }

  // Files brought in by the merge (ORIG_HEAD = pre-merge HEAD, set by git merge).
  let merged: string[] = [];
  const diff = await git(root, ['diff', '--name-only', 'ORIG_HEAD', 'HEAD']);
  if (diff.code === 0) {
    merged = diff.stdout
      .split('\n')
      .map((l) => l.replace(/\r$/, ''))
      .filter(Boolean);
  }

  // Clean up the worktree (best-effort — a dirty worktree just stays).
  try {
    await removeWorktree(root, clean, false);
  } catch {
    /* non-fatal */
  }
  return { ok: true, merged };
}

// ---------- one-shot AI helpers (completer injected from ipc.ts) ----------

const FENCE_LINE_RE = /^[ \t]*```[a-zA-Z0-9_-]*[ \t]*$/gm; // any pure ```/```lang line
const FENCE_TRAILER_RE = /\n?```[a-zA-Z0-9_-]*[ \t]*$/; // trailing ``` without a line break

function stripFences(text: string): string {
  return text.replace(FENCE_LINE_RE, '').replace(FENCE_TRAILER_RE, '').trim();
}

function firstLines(text: string, n: number, maxLineLen = 100): string {
  return text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)
    .slice(0, n)
    .map((l) => l.slice(0, maxLineLen))
    .join('\n');
}

async function collectDiffForAi(root: string): Promise<string> {
  const staged = await git(root, ['diff', '--cached', '--no-color']);
  let diff = staged.stdout.slice(0, DIFF_CAP);
  if (!diff.trim()) {
    const unstaged = await git(root, ['diff', '--no-color']);
    diff = unstaged.stdout.slice(0, DIFF_CAP);
  }
  return diff;
}

/** Conventional-commit message for the staged (or unstaged) diff. */
export async function generateCommitMessage(
  root: string,
  complete: AiCompleter,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    if (typeof complete !== 'function') {
      return { ok: false, error: 'AI commit message unavailable. Configure an AI provider in Settings → AI providers, then retry.' };
    }
    const diff = await collectDiffForAi(root);
    if (!diff.trim()) {
      return { ok: false, error: 'Nothing to commit: stage or edit a file first, then generate the message again.' };
    }

    const r = await complete({
      prompt:
        'Write ONE conventional-commit message (type(scope): subject) + body line for this diff. No backticks.',
      context: diff,
      system:
        'You write git commit messages. Output ONLY the commit message: one conventional-commit subject line plus at most one body line. No markdown, no code fences, no explanations.',
      maxTokens: 200,
      temperature: 0.2,
    });
    if (!r.ok || !r.text?.trim()) {
      return { ok: false, error: `AI provider did not return a commit message${r.error ? `: ${redactSecrets(r.error)}` : ''}. Check the provider/key in Settings → AI providers and retry.` };
    }
    const message = firstLines(stripFences(r.text), 3);
    if (!message) return { ok: false, error: 'AI returned an empty commit message. Retry or write the message manually.' };
    return { ok: true, message };
  } catch (err) {
    return { ok: false, error: `Could not generate a commit message: ${redactSecrets(err instanceof Error ? err.message : String(err))}` };
  }
}

/** Senior-style review of the working tree diff vs a base ref (default HEAD). */
export async function reviewWorkingTree(
  root: string,
  base?: string,
  complete?: AiCompleter,
): Promise<{ ok: boolean; review?: string; error?: string }> {
  try {
    if (typeof complete !== 'function') {
      return { ok: false, error: 'AI review unavailable. Configure an AI provider in Settings → AI providers, then retry.' };
    }
    const baseRef = base == null || base === '' ? 'HEAD' : safeRef(base);
    if (!baseRef) {
      return { ok: false, error: 'INVALID_REF: the review base must be a branch, tag or commit (letters, digits, dots, dashes, slashes).' };
    }

    const diffRes = await git(root, ['diff', baseRef, '--no-color']);
    if (diffRes.code !== 0) {
      return { ok: false, error: `Could not read the diff for review: ${(diffRes.stderr.trim() || diffRes.stdout.trim() || 'git diff failed').slice(0, 400)}. Check the base ref and retry.` };
    }
    const diff = diffRes.stdout.slice(0, DIFF_CAP);
    if (!diff.trim()) return { ok: true, review: 'No changes to review.' };

    const r = await complete({
      prompt:
        'Senior code review. List issues as: [severity] file:line — issue — suggested fix. Max 12 findings. Then 1-line verdict.',
      context: diff,
      system:
        'You are a senior engineer performing a rigorous but pragmatic code review. Be specific and concrete; skip nitpicks that do not matter.',
      maxTokens: 1200,
      temperature: 0.2,
    });
    if (!r.ok || !r.text?.trim()) {
      return { ok: false, error: `AI provider did not return a review${r.error ? `: ${redactSecrets(r.error)}` : ''}. Check the provider/key in Settings → AI providers and retry.` };
    }
    return { ok: true, review: stripFences(r.text) };
  } catch (err) {
    return { ok: false, error: `Could not review the changes: ${redactSecrets(err instanceof Error ? err.message : String(err))}` };
  }
}
