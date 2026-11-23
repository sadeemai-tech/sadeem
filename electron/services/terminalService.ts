// ============================================================
// Surnia — terminal service
// Two modes:
//  1. Interactive streaming terminals (renderer gets 'kdx:term:data')
//  2. runCaptured() — single-shot promise exec used by the agent tools
// A sentinel marker (SOH + CWD/EC + SOH) is appended by the shell
// wrapper so we can track persistent cwd + exit code per terminal.
// ============================================================
import { spawn, type ChildProcess } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fsSync from 'fs';
import { randomUUID } from 'crypto';
import type { TerminalOutputEvent } from '../../shared/types';
// E4 security: terminal guard (classification + audit + IPC registration).
// v11.31 — plus the shared hard-deny floor, the shared redactor and the
// sanitized spawn environment.
import {
  assertHardCommandSafe,
  classifyForGuard,
  guardInteractive,
  initTerminalGuard,
  redactForAudit,
  sanitizeSpawnEnv,
} from './terminalGuard';
// v11.31 — the terminal surface is renderer-driven, so its cwd (create/exec)
// must go through the same workspace jail as every fs channel.
import { assertSafePath, confineActive } from './fsService';

// Boot the security layer at import time (terminalService is imported by
// ipc.ts/main.ts at app boot; the call is inert outside Electron — the surnia
// CLI bundle — because terminalGuard loads electron lazily).
initTerminalGuard();

// ---------- marker protocol ----------
const SOH = '\u0001';
// v11.31 — PowerShell can report a NEGATIVE $LASTEXITCODE; the old \d+ shape
// dropped the marker entirely, losing cwd + exit code.
const MARKER_RE = new RegExp(`\\u0001CWD:([^\\u0001]*)\\u0001EC:(-?\\d+)\\u0001`);
const MAX_OUTPUT_CHARS = 100_000;
/** Bounded PTY registry — a leaked renderer id must not grow the map forever. */
const MAX_TERMINALS = 64;

interface TermState {
  cwd: string;
  child: ChildProcess | null;
}

const terminals = new Map<string, TermState>();

let onDataHandler: ((e: TerminalOutputEvent) => void) | null = null;

/** Wire the data channel (called by ipc.ts once). */
export function setOnData(cb: ((e: TerminalOutputEvent) => void) | null): void {
  onDataHandler = cb;
}

// ---------- audit trail ----------
// Lightweight security audit hook: every command execution (interactive AND
// captured) is reported as one line. The sink is injected by the app
// (logService); the default is console.log. E4 adds the terminal GUARD on
// top: interactive input is classified before the shell sees it (see
// terminalGuard.ts) — the audit sink itself stays purely observational.
let auditSink: ((line: string) => void) | null = null;

/** Install the audit sink (called by ipc.ts/logService); null restores the console default. */
export function setAuditSink(fn: ((line: string) => void) | null): void {
  auditSink = fn;
}

function audit(line: string): void {
  try {
    (auditSink ?? ((l: string) => console.log(l)))(line);
  } catch {
    /* an audit failure must never break execution */
  }
}

function auditExec(terminalId: string, cwd: string, cmd: string): void {
  // v11.31 — the command line can carry `sk-…` / Bearer tokens / DB DSNs;
  // route it through the SAME redactor as audit.jsonl before it reaches any
  // sink (console, logService, SIEM). Previously this leaked secrets verbatim.
  audit(`[term] ${terminalId} cwd=${redactForAudit(cwd)} cmd=${redactForAudit(cmd.slice(0, 200))}`);
}

function emit(terminalId: string, data: string): void {
  if (!data) return;
  try {
    onDataHandler?.({ terminalId, data });
  } catch {
    /* renderer gone — ignore */
  }
}

// ---------- shell wrappers ----------
function quoteSingle(s: string): string {
  return `'` + s.replace(/'/g, `'\\''`) + `'`;
}

// ---------- v11.4 — persisted terminal preferences (settings.terminal) ----------
export type TerminalShellChoice = 'default' | 'powershell' | 'pwsh' | 'cmd' | 'bash' | 'wsl';

/**
 * Read settings.terminal lazily — storeService imports electron, and this
 * module is bundled into the surnia CLI (outside Electron), so the require
 * stays function-scoped and any failure falls back to the OS defaults.
 */
function terminalPrefs(): { shell: TerminalShellChoice; scrollback: number } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const store = require('./storeService') as typeof import('./storeService');
    const s = store.getSettings();
    const raw = s.terminal?.shell ?? 'default';
    const shell: TerminalShellChoice =
      raw === 'powershell' || raw === 'pwsh' || raw === 'cmd' || raw === 'bash' || raw === 'wsl'
        ? raw
        : 'default';
    const sb = Math.round(s.terminal?.scrollback ?? 1000);
    return { shell, scrollback: Math.max(1000, Math.min(50_000, Number.isFinite(sb) ? sb : 1000)) };
  } catch {
    return { shell: 'default', scrollback: 1000 };
  }
}

/**
 * v11.4 — the interactive stream cap scales with the user's scrollback budget
 * (lines x ~100 chars/line, floored at the legacy 100k so nothing regresses).
 */
export function interactiveOutputCap(): number {
  return Math.max(MAX_OUTPUT_CHARS, terminalPrefs().scrollback * 100);
}

/**
 * Build the spawn spec for one command line. `shell` — 'default' keeps the
 * legacy behaviour (cmd.exe on Windows, /bin/bash elsewhere); explicit choices
 * are honoured where they exist (powershell/pwsh/cmd/wsl/bash on Windows,
 * bash anywhere, pwsh cross-platform) and honestly fall back to the platform
 * default when the choice is Windows-only and we are not on Windows.
 * Every variant preserves the SOH marker protocol (CWD + exit code).
 * v11.31 — ALL variants spawn with `shell:false`; we invoke the shell binary
 * explicitly and (on Windows cmd) build the command line ourselves.
 */
interface SpawnSpec {
  file: string;
  args: string[];
  /** Only for Windows cmd: pass our hand-built command line through verbatim. */
  windowsVerbatimArguments?: boolean;
}

function buildCommandFor(cmd: string, cwd: string, shell: TerminalShellChoice): SpawnSpec {
  const posixScript =
    `exec 2>&1; ` +
    `cd ${quoteSingle(cwd)} 2>/dev/null; ` +
    `__kdx_ec=0; ${cmd}; __kdx_ec=$?; ` +
    `printf "\\n${SOH}CWD:$(pwd)${SOH}EC:$__kdx_ec${SOH}"`;
  // PowerShell variant of the marker protocol: $LASTEXITCODE for native
  // commands (0 for cmdlets) + the same SOH envelope the renderer parses.
  const psScript =
    `$__kdx_ec=0; ${cmd}; $__kdx_ec=$LASTEXITCODE; if ($null -eq $__kdx_ec) { $__kdx_ec = 0 }; ` +
    `$soh=[string][char]1; Write-Output ("${'{'}soh{'}'}CWD:$((Get-Location).Path)${'{'}soh{'}'}EC:$__kdx_ec${'{'}soh{'}'}")`;

  if (process.platform === 'win32') {
    if (shell === 'powershell') {
      return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', psScript] };
    }
    if (shell === 'pwsh') {
      return { file: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-Command', psScript] };
    }
    if (shell === 'bash') {
      return { file: 'bash.exe', args: ['-c', posixScript] };
    }
    if (shell === 'wsl') {
      // --cd maps the Windows path (or a previous WSL marker cwd) before bash runs.
      return { file: 'wsl.exe', args: ['--cd', cwd, 'bash', '-c', posixScript] };
    }
    // 'default' and explicit 'cmd'. Two Windows quirks are handled here:
    //  1. cmd.exe expands %VAR% when it PARSES the /c line — before `cmd`
    //     runs — so `%ERRORLEVEL%` always reported the *previous* code (0).
    //     Delayed expansion (/v:on + !VAR!) is evaluated at execution time.
    //  2. A plain spawn('cmd.exe', ['/c', line], {shell:false}) makes Node
    //     re-quote the inner `"…"`, so `node -e "…"` receives its script with
    //     stray quotes. We build the EXACT command line ourselves and set
    //     windowsVerbatimArguments:true — shell:false stays mandatory, but
    //     cmd still parses `node -e "…"` the way a developer expects.
    const line = `${cmd} & echo ${SOH}CWD:!CD!${SOH}EC:!ERRORLEVEL!${SOH}`;
    return { file: 'cmd.exe', args: [`/d /s /v:on /c "${line}"`], windowsVerbatimArguments: true };
  }
  // POSIX: bash is the native choice; pwsh is cross-platform and honoured;
  // windows-only picks fall back honestly to /bin/bash.
  if (shell === 'pwsh') {
    return { file: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-Command', psScript] };
  }
  return { file: '/bin/bash', args: ['-c', posixScript] };
}

function buildCommand(cmd: string, cwd: string): SpawnSpec {
  return buildCommandFor(cmd, cwd, 'default');
}

function spawnOpts(cwd: string, spec?: SpawnSpec): import('child_process').SpawnOptions {
  return {
    cwd,
    // v11.31 — never hand the whole process.env (provider keys, tokens, DSNs)
    // to an arbitrary shell command. sanitizeSpawnEnv drops sensitive names
    // and high-confidence secret values, then injects our safe additions.
    env: sanitizeSpawnEnv({ TERM: 'xterm-256color', FORCE_COLOR: '1' }),
    detached: process.platform !== 'win32', // own process group → group kill
    windowsHide: true,
    shell: false, // EXPLICIT: the executable in `spec.file` IS the shell
    ...(spec?.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
  };
}

function spawnProc(spec: SpawnSpec, cwd: string): ChildProcess {
  return spawn(spec.file, spec.args, spawnOpts(cwd, spec));
}

function killTree(child: ChildProcess): void {
  try {
    if (process.platform === 'win32') {
      if (child.pid) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
    } else {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL'); // detached group
      } catch {
        child.kill('SIGKILL');
      }
    }
  } catch {
    /* best effort */
  }
}

function isRunning(child: ChildProcess | null): boolean {
  return !!child && child.exitCode === null && child.signalCode === null;
}

// ---------- interactive terminals ----------
/**
 * v11.31 — renderer-supplied terminal cwd goes through the workspace jail.
 * The canonical (realpath) directory is used for spawn so a symlink cannot
 * silently relocate a shell outside the allowed roots. When no root is pinned
 * yet (headless CLI) the absolute path is accepted unchanged.
 */
function safeTerminalCwd(cwd: string | undefined, label = 'cwd'): string {
  const raw = cwd && cwd.trim() ? cwd : os.homedir();
  const safe = confineActive() ? assertSafePath(raw, label) : path.resolve(raw);
  try {
    const real = fsSync.realpathSync(safe);
    if (confineActive()) assertSafePath(real, label); // realpath re-jail (symlink)
    return real;
  } catch (err) {
    if (err instanceof Error && /_(?:OUTSIDE_WORKSPACE|TRAVERSAL|UNC_NOT_ALLOWED|DEVICE_PATH)$/.test(err.message)) throw err;
    throw new Error(`${label.toUpperCase()}_INVALID: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function create(cwd?: string): string {
  if (terminals.size >= MAX_TERMINALS) throw new Error('TERMINAL_LIMIT_REACHED');
  const id = randomUUID();
  terminals.set(id, { cwd: safeTerminalCwd(cwd), child: null });
  return id;
}

export async function exec(terminalId: string, cmd: string, cwd?: string): Promise<true> {
  const st = terminals.get(terminalId);
  if (!st) throw new Error('UNKNOWN_TERMINAL');
  if (!cmd || !cmd.trim()) return true;

  // v11.31 — hard-deny floor runs BEFORE the guard and even when the guard
  // is off or an allow-once override was armed: these commands are never safe.
  try {
    assertHardCommandSafe(cmd);
  } catch (err) {
    emit(terminalId, `\r\n[surnia] ⛔ ${err instanceof Error ? err.message : String(err)}\r\n`);
    return true;
  }

  // E4 terminal guard: classify BEFORE any shell sees the input (each
  // non-empty line of a multiline paste is classified; worst verdict wins).
  // 'danger' in mode 'on' → nothing is spawned; the user must confirm via
  // kdx:term:allowOnce (one-shot, exact-command override) and re-run.
  const guard = guardInteractive(terminalId, cmd);
  if (guard.blocked) {
    emit(
      terminalId,
      `\r\n[surnia] ⛔ blocked by terminal guard: ${guard.reasons.join(' · ') || 'dangerous command'}\r\n` +
        `[surnia] approve once from the security prompt, then re-run to execute.\r\n`,
    );
    return true; // blocked — no process was started
  }

  const prev = st.child;
  if (prev && isRunning(prev)) killTree(prev);
  st.child = null;
  // v11.31 — a renderer-supplied cwd override is jailed like any fs path.
  if (cwd && cwd.trim()) st.cwd = safeTerminalCwd(cwd);
  // The marker-reported cwd also has to stay in the jail (a command can
  // `cd /` and print a forged-looking marker).
  st.cwd = safeTerminalCwd(st.cwd);

  auditExec(terminalId, st.cwd, cmd);

  // v11.4 — the integrated terminal honours settings.terminal.shell; the
  // agent's runCaptured path keeps the platform default (buildCommand below).
  const spec = buildCommandFor(cmd, st.cwd, terminalPrefs().shell);
  const { file, args } = spec;
  // v11.13 audit contract: the guard above must precede the spawn below.
  const child = spawn(file, args, spawnOpts(st.cwd, spec));
  st.child = child;

  let pending = '';
  // SECURITY/UX cap: the interactive stream is capped at MAX_OUTPUT_CHARS.
  // When the cap is hit we emit a ONE-TIME truncation notice and DROP all
  // further output — the process KEEPS RUNNING in the background (stop it
  // with interrupt()) and the SOH marker protocol is still parsed so cwd
  // and exit-code tracking stay correct. This protects the renderer from
  // runaway output (yes, floods, spinner loops) without killing the job.
  let emitted = 0;
  let truncationSent = false;
  const streamCap = interactiveOutputCap();
  const out = (text: string): void => {
    if (!text || truncationSent) return;
    if (emitted >= streamCap) {
      truncationSent = true;
      emit(
        terminalId,
        `\r\n[surnia] output truncated at ${streamCap} chars — further output is not displayed (process still running)\r\n`,
      );
      return;
    }
    const room = streamCap - emitted;
    if (text.length > room) {
      // v11.31 — must jump to the ACTIVE cap, not the legacy constant:
      // with a large scrollback the old value let `out('!')` emit junk
      // instead of the truncation notice.
      emitted = streamCap;
      emit(terminalId, text.slice(0, room));
      out('!'); // recurse once → hits the cap branch → sends the notice
      return;
    }
    emitted += text.length;
    emit(terminalId, text);
  };

  const handleChunk = (chunk: Buffer | string): void => {
    // v11.31 — a command replaced while an old child was dying used to let
    // the OLD child's data/marker/close handlers mutate the NEW session.
    if (st.child !== child) return;
    pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8');

    const m = pending.match(MARKER_RE);
    if (m && m.index !== undefined) {
      out(pending.slice(0, m.index));
      if (m[1]) {
        try {
          st.cwd = safeTerminalCwd(m[1], 'terminal cwd');
        } catch {
          emit(terminalId, '\r\n[surnia] command left the workspace — cwd kept inside the jail\r\n');
        }
      }
      pending = pending.slice(m.index + m[0].length);
      st.child = null;
      // No newline here — the renderer draws its own prompt when the
      // close-handler's single '\r\n' arrives (see TerminalView).
      return;
    }

    // hold back a possible partial marker at the tail (starts with SOH near the end)
    const idx = pending.lastIndexOf(SOH);
    if (idx >= 0 && pending.length - idx < 64) {
      out(pending.slice(0, idx));
      pending = pending.slice(idx);
    } else {
      out(pending);
      pending = '';
    }
  };

  child.stdout?.on('data', handleChunk);
  // bash merges stderr via `exec 2>&1`; on Windows cmd.exe emits errors on stderr
  child.stderr?.on('data', handleChunk);

  child.on('close', () => {
    if (st.child !== child) return; // stale child — never touch the new session
    if (pending) {
      out(pending);
      pending = '';
    }
    st.child = null;
    out('\r\n');
  });
  child.on('error', (err) => {
    if (st.child !== child) return;
    out(`\r\n[surnia] spawn failed: ${String(err)}\r\n`);
    st.child = null;
  });

  return true;
}

export function interrupt(terminalId: string): true {
  const st = terminals.get(terminalId);
  if (!st) throw new Error('UNKNOWN_TERMINAL');
  const child = st.child;
  if (child && isRunning(child)) {
    killTree(child);
    st.child = null;
  }
  emit(terminalId, '^C\r\n');
  return true;
}

/**
 * v11.10 — raw stdin bridge: forward renderer keystrokes to the RUNNING
 * child's stdin. The pty-less line-mode terminal executes one command at a
 * time; while one is running the old panel silently swallowed typed input —
 * `npm init` / `npx create-*` prompts and REPLs could never be answered
 * (founder complaint: "terminal does not work"). Writing to child.stdin is
 * the honest best without a PTY: programs that read stdin (prompts, `node`,
 * `python`) now receive it; interactive TUIs that need a raw-mode terminal
 * (vim, curses) still cannot run — no pty dep is installed, stated plainly.
 * Returns false when there is no live child (renderer falls back to the
 * local line-editing buffer, so no keystrokes are lost at the prompt).
 */
export function write(terminalId: string, data: string): boolean {
  const st = terminals.get(terminalId);
  if (!st) return false;
  const child = st.child;
  if (!isRunning(child) || !child?.stdin) return false;
  try {
    child.stdin.write(data);
    return true;
  } catch {
    return false;
  }
}

// ---------- captured exec (agent tool) ----------
/** Options for runCaptured — all optional. */
export interface RunCapturedOptions {
  /** AbortSignal (from the agent ToolContext) — aborting kills the process group. */
  signal?: AbortSignal;
  /** Output capture cap in chars (default MAX_OUTPUT_CHARS). */
  maxOutput?: number;
}

/**
 * Single-shot exec with no renderer events. Captures combined output
 * (capped), resolves { output, exitCode } on close or timeout.
 * On timeout the process tree is killed and exitCode is -1.
 * An AbortSignal (opts.signal) kills the same process tree (detached
 * process group → group kill) and resolves early with exitCode -1.
 */
export async function runCaptured(
  command: string,
  cwd: string,
  timeoutMs = 120_000,
  opts?: RunCapturedOptions,
): Promise<{ output: string; exitCode: number }> {
  const workdir = cwd && cwd.trim() ? cwd : os.homedir();
  // v11.31 — the hard-deny floor applies to the AGENT path too. The softer
  // 'danger' verdict stays with the tool layer's approval flow (it already
  // calls assertCommandSafe + approval); these host-destroying shapes are
  // refused regardless of a prior approval.
  try {
    assertHardCommandSafe(command);
  } catch (err) {
    return { output: err instanceof Error ? err.message : String(err), exitCode: -1 };
  }
  const risk = classifyForGuard(command);
  auditExec(`captured-${randomUUID().slice(0, 8)}`, workdir, `${command} [risk=${risk.level}]`);
  // This is the trusted internal agent path: tools.ts passes its own cwd
  // (sometimes os.homedir() for system CLIs), so it is not re-jailed here —
  // create()/exec()/processService.start() are the renderer-driven surfaces.
  const spec = buildCommand(command, workdir);
  const maxOutput = Math.max(1, opts?.maxOutput ?? MAX_OUTPUT_CHARS);
  const signal = opts?.signal;
  const budget = Math.max(1000, Math.min(600_000, Number(timeoutMs) || 120_000));

  return new Promise((resolve) => {
    let out = '';
    let closeCode: number | null = null;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let watchdog: NodeJS.Timeout | undefined;
    let aborted = false;
    let timedOut = false;
    let truncated = false;

    const child = spawnProc(spec, workdir);

    const collect = (chunk: Buffer | string): void => {
      if (out.length >= maxOutput) return;
      out += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (out.length > maxOutput) {
        // v11.31 — report the cap instead of silently discarding output.
        // Re-append the notice on EVERY overflow: later chunks would
        // otherwise slice it off again and leave a fake "clean" tail.
        truncated = true;
        out = (out.slice(0, Math.max(0, maxOutput - 24)) + '\n… [output truncated]').slice(0, maxOutput);
      }
    };

    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (watchdog) clearTimeout(watchdog);
      if (signal) signal.removeEventListener('abort', onAbort);

      const m = out.match(MARKER_RE);
      let exitCode: number;
      if (m && m.index !== undefined) {
        exitCode = parseInt(m[2], 10);
        if (Number.isNaN(exitCode)) exitCode = closeCode ?? -1;
        out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
      } else {
        exitCode = closeCode ?? -1;
      }
      // A killed cmd.exe reports code 1 on Windows; abort/timeout must be
      // distinguishable from a real non-zero exit.
      if ((aborted || timedOut) && exitCode >= 0) exitCode = -1;
      if (truncated && !out.includes('[output truncated]')) out += '\n… [output truncated]';
      resolve({ output: out, exitCode });
    };

    /** Kill the group and guarantee a result even if 'close' never arrives. */
    const killAndSettle = (notice: string): void => {
      if (settled) return;
      out += notice;
      killTree(child); // detached group → group kill
      watchdog = setTimeout(() => {
        if (!settled) {
          closeCode = -1;
          finish(); // no silent hang: an unresponsive child still returns
        }
      }, 1_500);
      watchdog.unref?.();
    };

    // Abort support: reuse the timeout's process-group kill path.
    const onAbort = (): void => {
      if (settled || aborted) return;
      aborted = true;
      killAndSettle('\n[surnia] command aborted');
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('close', (code) => {
      closeCode = code;
      finish();
    });
    child.on('error', (err) => {
      out += `\r\n[surnia] spawn failed: ${String(err)}`;
      closeCode = -1;
      finish();
    });

    timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      killAndSettle(`\n[surnia] command timed out after ${budget}ms`);
    }, budget);
    timer.unref?.();
  });
}

// ---------- cleanup ----------
export function disposeAll(): void {
  for (const st of terminals.values()) {
    const child = st.child;
    if (child && isRunning(child)) killTree(child);
    st.child = null;
  }
  terminals.clear();
}
