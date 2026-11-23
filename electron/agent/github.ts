// ============================================================
// Surnia — GitHub pull-request tool (gh CLI bridge)
// Thin, defensive wrappers around the GitHub CLI (`gh`) so the
// agent can open and inspect pull requests from a workspace.
// Contract (mirrors agent/editEngine.ts discipline):
//   1. NO shell string concat — every command is an execFile argv
//      array (title/body ride as single args, nothing to inject).
//   2. NEVER throws — every entry point resolves to
//      { ok, ... } and turns failures into actionable text:
//      missing binary → install link, non-repo → init hint,
//      unauthenticated → `gh auth login` hint.
//   3. Output is parsed, not interpolated (PR URL regex from
//      stdout; `pr list` rows defensively mapped).
// Wiring into the tool registry (agent/tools.ts create_pull_request)
// happens in the tool layer; this module stays transport-only.
// ============================================================
import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';

// ---------- small helpers ----------

function msgOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface GhRun {
  ok: boolean; // process exited 0
  missing: boolean; // gh binary not found on PATH at all
  stdout: string;
  stderr: string;
}

/**
 * Run `gh <args>` inside a workspace. Never rejects — every failure
 * (non-zero exit, spawn error, timeout) comes back as data.
 */
function runGh(args: string[], workspace: string, timeoutMs: number): Promise<GhRun> {
  return new Promise((resolve) => {
    execFile(
      'gh',
      args,
      // windowsHide: no console flash on Windows; timeout keeps a hung
      // gh from stalling an agent turn forever.
      { cwd: workspace, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (!err) {
          resolve({ ok: true, missing: false, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
          return;
        }
        // Node reports a missing binary as ENOENT. (A missing cwd looks
        // identical, but every public call here validates the workspace
        // path BEFORE spawning, so ENOENT here means: no gh.)
        const code = (err as NodeJS.ErrnoException).code;
        resolve({
          ok: false,
          missing: code === 'ENOENT',
          stdout: String((err as { stdout?: unknown }).stdout ?? stdout ?? ''),
          stderr: String((err as { stderr?: unknown }).stderr ?? stderr ?? ''),
        });
      },
    );
  });
}

/** Turn a raw gh failure into one clean, actionable error line. */
function ghErrorText(run: GhRun, fallback: string): string {
  if (run.missing) {
    return 'GitHub CLI (gh) is not installed — install from https://cli.github.com/';
  }
  const raw = `${run.stderr}\n${run.stdout}`.replace(/\s+/g, ' ').trim();
  if (/not a git repository/i.test(raw)) {
    return 'Not a git repository — open (or git init) a repository before working with pull requests.';
  }
  if (/gh auth login|to get started with github cli|gh_token|unauthorized|401/i.test(raw)) {
    return 'GitHub CLI is not authenticated — run `gh auth login` (or set GH_TOKEN) and retry.';
  }
  if (/no default remote|does not (point|seem) to (be )?a github|not a github repository/i.test(raw)) {
    return 'No GitHub remote found — push the repo to GitHub (git remote add origin …) and retry.';
  }
  return raw ? raw.slice(0, 400) : fallback;
}

/** Defensive directory probe — a vanished workspace must read as data, not a throw. */
function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// ---------- availability probe ----------

/** True when the GitHub CLI answers `gh --version`. Never throws. */
export async function ghAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('gh', ['--version'], { timeout: 5_000, windowsHide: true }, (err) => {
      resolve(!err);
    });
  });
}

// ---------- create_pull_request ----------

export interface CreatePROptions {
  /** Absolute (or cwd-relative) path to a git repository with a GitHub remote. */
  workspace: string;
  title: string;
  body: string;
  /** Target branch (default: the repo's default branch). */
  base?: string;
  /** Source branch (default: the current branch). */
  head?: string;
  /** Open as a draft PR. */
  draft?: boolean;
}

export interface GhResult {
  ok: boolean;
  /** The https://github.com/…/pull/N URL of the created PR, on success. */
  url?: string;
  error?: string;
}

/** Hard ceiling for one `gh pr create` — network + editor-free run. */
const PR_CREATE_TIMEOUT_MS = 60_000;

export async function createPullRequest(opts: CreatePROptions): Promise<GhResult> {
  const workspace = String(opts?.workspace ?? '').trim();
  const title = String(opts?.title ?? '').trim();
  const body = String(opts?.body ?? '');
  if (!workspace) return { ok: false, error: 'create_pull_request: workspace path is required.' };
  if (!title) return { ok: false, error: 'create_pull_request: a PR title is required.' };
  if (!isDir(workspace)) return { ok: false, error: `Workspace directory not found: ${workspace}` };

  // argv array only — user text rides as whole arguments, never inside a shell string.
  const args = ['pr', 'create', '--title', title, '--body', body];
  if (opts.draft) args.push('--draft');
  if (opts.base) args.push('--base', String(opts.base));
  if (opts.head) args.push('--head', String(opts.head));

  const run = await runGh(args, workspace, PR_CREATE_TIMEOUT_MS);
  if (!run.ok) return { ok: false, error: ghErrorText(run, 'gh pr create failed.') };

  // gh prints the new PR URL on stdout (its last line) — extract, don't trust
  // the whole blob (progress junk may precede it on some versions).
  const url = run.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .reverse()
    .find((l) => /^https:\/\/github\.com\/\S+\/pull\/\d+/.test(l));
  if (!url) {
    return {
      ok: false,
      error: `gh pr create finished but returned no PR URL. Output: ${run.stdout.slice(0, 200) || '(empty)'}`,
    };
  }
  return { ok: true, url };
}

// ---------- pr_status ----------

export interface PrStatusEntry {
  number: number;
  title: string;
  url: string;
  state: string;
}

export interface PrStatusResult {
  ok: boolean;
  prs?: PrStatusEntry[];
  error?: string;
}

const PR_STATUS_TIMEOUT_MS = 30_000;
/** Spec'd cap — the panel/agent only needs the hot list, not the archive. */
const PR_STATUS_LIMIT = 10;

/** List the workspace repo's open PRs (number/title/url/state, newest first). Never throws. */
export async function prStatus(workspace: string): Promise<PrStatusResult> {
  const ws = String(workspace ?? '').trim();
  if (!ws) return { ok: false, error: 'pr_status: workspace path is required.' };
  if (!isDir(ws)) return { ok: false, error: `Workspace directory not found: ${ws}` };

  const run = await runGh(
    ['pr', 'list', '--json', 'number,title,url,state', '--limit', String(PR_STATUS_LIMIT)],
    ws,
    PR_STATUS_TIMEOUT_MS,
  );
  if (!run.ok) return { ok: false, error: ghErrorText(run, 'gh pr list failed.') };

  try {
    const parsed: unknown = JSON.parse(run.stdout || '[]');
    const rows = Array.isArray(parsed) ? parsed : [];
    const prs: PrStatusEntry[] = [];
    for (const row of rows) {
      // Defensive row mapping — one malformed entry must not sink the list.
      const r = (row ?? {}) as Record<string, unknown>;
      const n = typeof r.number === 'number' ? r.number : Number(r.number);
      if (!Number.isFinite(n)) continue;
      prs.push({
        number: n,
        title: typeof r.title === 'string' ? r.title : '',
        url: typeof r.url === 'string' ? r.url : '',
        state: typeof r.state === 'string' ? r.state : '',
      });
    }
    return { ok: true, prs };
  } catch (err) {
    return { ok: false, error: `gh pr list returned unparseable output: ${msgOf(err)}` };
  }
}
