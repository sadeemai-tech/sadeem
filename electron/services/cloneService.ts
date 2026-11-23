// SADEEM — git clone service with streamed progress. No project templates.
// Streams real `git clone` progress to the renderer. No project templates.
//
// v11.31 capability audit:
//   • stable, i18n-safe error TOKENS keep working (the renderer maps them to
//     `cl.err.<token>`), while `detail` + progress `message` carry actionable,
//     English-only explanations and never echo embedded credentials;
//   • authentication is non-interactive (no terminal/GUI prompt can hang a
//     clone) and token-bearing URLs are redacted everywhere;
//   • real git progress is forwarded (throttled), not just start/done events;
//   • an optional AbortSignal cancels an in-flight clone and cleans up;
//   • the destination is path-jailed to one existing absolute parent folder;
//   • timeouts always clear their timer and report a distinct token.
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { CloneOptions, CloneProgress } from '../../shared/types';

const MAX_CAPTURE = 5 * 1024 * 1024; // 5MB (matches gitService)
export const CLONE_TIMEOUT_MS = 10 * 60_000;
const PROGRESS_THROTTLE_MS = 250;

/** Strip credentials from any text that can reach the renderer or logs. */
export function redactCloneSecrets(text: string): string {
  return String(text ?? '')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi, '$1***@')
    .replace(/\b((?:authorization|token|password|passwd|secret|api[-_]?key)\s*[:=]\s*)([^\s,;]+)/gi, '$1***');
}

function sendProgress(
  cb: ((p: CloneProgress) => void) | undefined,
  p: CloneProgress,
): void {
  if (cb) {
    try {
      cb(p);
    } catch {
      /* window may be closing */
    }
  }
}

interface RunArgsResult {
  code: number;
  stderr: string;
  aborted: boolean;
  timedOut: boolean;
}

/**
 * SECURITY: run a program with an ARG ARRAY — never a shell string.
 * Mirrors the gitService capture pattern (5MB output caps, SIGKILL on
 * timeout). Used for everything that interpolates user input (git clone).
 * `onStderrLine` streams sanitized real progress; `signal` cancels the child.
 */
function runArgs(
  file: string,
  args: string[],
  cwd: string,
  timeoutMs = CLONE_TIMEOUT_MS,
  onStderrLine?: (line: string) => void,
  signal?: AbortSignal,
): Promise<RunArgsResult> {
  return new Promise((resolve) => {
    let stderr = '';
    let pending = '';
    let settled = false;
    let aborted = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => {};

    const child = spawn(file, args, {
      cwd,
      shell: false, // ← no shell, no interpolation, no injection
      windowsHide: true,
      env: {
        ...process.env,
        // Never hang on credentials (terminal prompt, GUI askpass or Windows
        // Credential Manager pop-up). Tokens may still be supplied in the URL.
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '',
        GCM_INTERACTIVE: 'never',
      },
    });

    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ code, stderr: redactCloneSecrets(stderr), aborted, timedOut });
    };

    // Drain stdout so large clones never block on pipe backpressure.
    child.stdout?.on('data', (c: Buffer) => {
      void c;
    });
    child.stderr?.on('data', (c: Buffer) => {
      const text = c.toString('utf8');
      if (stderr.length < MAX_CAPTURE) stderr += text;
      if (!onStderrLine) return;
      pending += text;
      const parts = pending.split(/[\r\n]+/);
      pending = parts.pop() ?? '';
      for (const part of parts) {
        const clean = redactCloneSecrets(part).trim().slice(0, 200);
        if (clean) onStderrLine(clean);
      }
    });
    child.on('close', (code) => finish(code ?? 1));
    child.on('error', (err) => {
      stderr += String(err);
      finish(127);
    });
    timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      finish(124);
    }, timeoutMs);

    onAbort = () => {
      if (settled) return;
      aborted = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      finish(130);
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export interface CloneResult {
  ok: boolean;
  projectPath?: string;
  /** Stable i18n key (renderer maps it through `cl.err.<token>`). */
  error?: string;
  /** Actionable, English-only explanation (never contains credentials). */
  detail?: string;
}

/** git clone URL allow-list: https(s), ssh:// and git@scp-style — nothing else. */
const CLONE_URL_RE = /^(?:https?:\/\/[^\s<>"'\\]+|git@[\w.-]+:[\w./~-]+|ssh:\/\/[^\s<>"'\\]+)$/i;
/** Branch/ref allow-list: word chars, dots, dashes, slashes; no leading '-' (option injection). */
const BRANCH_RE = /^[A-Za-z0-9._/-]+$/;
/** Destination folder name allow-list: one path segment, no separators, no '.'/'..'. */
const REPO_NAME_RE = /^[^\\/\u0000-\u001f]+$/;

/**
 * Wrap a failure in a stable token (for the translated UI) plus an actionable
 * English `detail`. `step:'error'` progress is emitted so the clone dialog can
 * show the reason immediately instead of silently spinning.
 */
function fail(
  token: string,
  detail: string,
  onProgress?: (p: CloneProgress) => void,
  projectPath?: string,
): CloneResult {
  sendProgress(onProgress, { step: 'error', message: detail, done: 0, total: 1, error: token, projectPath });
  return { ok: false, error: token, detail, ...(projectPath ? { projectPath } : {}) };
}

export async function cloneRepo(
  opts: CloneOptions,
  onProgress?: (p: CloneProgress) => void,
  signal?: AbortSignal,
): Promise<CloneResult> {
  try {
    if (!opts || typeof opts !== 'object') {
      return fail('bad_url', 'No clone options were provided. Enter a repository URL and retry.', onProgress);
    }
    if (signal?.aborted) {
      return fail('cancelled', 'Clone cancelled before it started.', onProgress);
    }

    const rawUrl = String(opts.url ?? '').trim();
    const url = rawUrl.replace(/\/+$/, '');
    // SECURITY: strict allow-list (the old loose /^(https?:\/\/|git@)/ check
    // admitted option strings / crafted values that reached the shell).
    if (!url || /[\u0000-\u001f\u007f]/.test(url) || !CLONE_URL_RE.test(url)) {
      return fail('bad_url', 'Enter an https://, ssh:// or git@host:owner/repo.git URL (no spaces or control characters).', onProgress);
    }

    const branch = String(opts.branch ?? '').trim();
    if (branch && (!BRANCH_RE.test(branch) || branch.startsWith('-') || branch.split('/').includes('..'))) {
      return fail('bad_branch', 'Invalid branch name. Use letters, digits, dots, dashes or slashes, with no leading dash.', onProgress);
    }

    const derived =
      url
        .split('/')
        .pop()
        ?.replace(/\.git$/, '') || 'cloned-repo';
    const repoName = String(opts.name ?? '').trim() || derived;
    if (!REPO_NAME_RE.test(repoName) || repoName === '.' || repoName === '..' || repoName.startsWith('-')) {
      return fail('bad_name', 'Invalid destination folder name. Use a single folder name with no path separators or leading dash.', onProgress);
    }
    if (!opts.destDir || !path.isAbsolute(opts.destDir) || /[\u0000-\u001f]/.test(opts.destDir)) {
      return fail('dest_not_absolute', 'The destination parent folder must be an absolute path.', onProgress);
    }
    const destDir = path.resolve(opts.destDir);
    let destStat: fs.Stats;
    try {
      destStat = fs.statSync(destDir);
    } catch {
      return fail('clone_failed', `The destination parent folder does not exist: ${destDir}. Create it and retry.`, onProgress);
    }
    if (!destStat.isDirectory()) {
      return fail('clone_failed', `The destination parent is not a folder: ${destDir}.`, onProgress);
    }

    // Path jail: the final project path must be a DIRECT child of destDir.
    const projectPath = path.resolve(destDir, repoName);
    const rel = path.relative(destDir, projectPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(/[\\/]+/).length !== 1) {
      return fail('bad_name', 'The destination folder name must stay inside the chosen parent folder.', onProgress);
    }

    if (fs.existsSync(projectPath)) {
      return fail('exists', `A file or folder already exists at ${projectPath}. Choose another name or remove it first.`, onProgress, projectPath);
    }

    // Never print the credential-bearing URL to the renderer; progress text is
    // sanitized and shows only what git itself reports (also redacted).
    sendProgress(onProgress, {
      step: 'git',
      message: `Cloning ${redactCloneSecrets(url)}…`,
      done: 0,
      total: 1,
    });

    let lastProgressAt = 0;
    const onStderrLine = (line: string): void => {
      const now = Date.now();
      // Throttle chatty `\r` updates but always let completion lines through.
      if (now - lastProgressAt < PROGRESS_THROTTLE_MS && !/100%|Receiving objects|Resolving deltas/i.test(line)) return;
      lastProgressAt = now;
      sendProgress(onProgress, { step: 'git', message: line, done: 0, total: 1 });
    };

    // SECURITY: arg-array spawn (shell:false) with a `--` separator. The old
    // implementation interpolated the URL into a shell string where $( ) and
    // backticks still expanded inside double quotes.
    const args = [
      'clone',
      '--progress',
      ...(branch ? ['--branch', branch] : []),
      '--',
      url,
      repoName,
    ];
    const { code, stderr, aborted, timedOut } = await runArgs(
      'git',
      args,
      destDir,
      CLONE_TIMEOUT_MS,
      onStderrLine,
      signal,
    );

    if (code !== 0) {
      // Best-effort cleanup of a partial checkout — never mask the real error.
      try {
        fs.rmSync(projectPath, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      if (aborted) {
        return fail('cancelled', 'Clone cancelled. Any partial checkout was removed.', onProgress);
      }
      if (timedOut) {
        return fail('timeout', `Clone timed out after ${CLONE_TIMEOUT_MS / 1000} seconds. Check your network and retry.`, onProgress);
      }
      const reason = stderr.trim().split('\n').map((l) => l.trim()).find(Boolean) ?? 'git clone exited with an error';
      return fail('clone_failed', `git clone failed: ${redactCloneSecrets(reason).slice(0, 400)}. Check the URL, branch and your network access.`, onProgress);
    }

    if (signal?.aborted) {
      try {
        fs.rmSync(projectPath, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      return fail('cancelled', 'Clone cancelled. Any partial checkout was removed.', onProgress);
    }

    sendProgress(onProgress, { step: 'done', message: `Repository cloned to ${projectPath}`, done: 1, total: 1, projectPath });
    return { ok: true, projectPath };
  } catch (err) {
    return fail(
      'clone_failed',
      `Clone could not be started: ${redactCloneSecrets(err instanceof Error ? err.message : String(err))}`,
      onProgress,
    );
  }
}
