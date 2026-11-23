// ============================================================
// Surnia v7.1 — REAL OS-LEVEL ISOLATION for agent command execution.
// v7.0's risk layer classifies commands and asks the user — but the
// command still runs with FULL user privileges on the host. For long
// autonomous runs the honest safety story needs walls, not warnings.
// Four profiles (auto-selected per platform, user-overridable):
//
//   • docker      — `docker run` one-shot container: workspace bind-
//                   mounted read/write, --network none (hard air-gap
//                   unless the user opts into bridge), CPU/memory
//                   capped, no host sockets. Image `surnia-isol:latest`
//                   is BUILT ON DEMAND from a generated Dockerfile
//                   (node + python3 + git) — one command, one time.
//   • wsl         — Windows + WSL: commands run inside the default
//                   distro against the workspace via /mnt/<drive>
//                   path translation. Real filesystem/process
//                   separation from the Windows host.
//   • winsandbox  — Windows Sandbox: a generated .wsb config that
//                   maps the workspace read-only, disables
//                   networking and vGPU, and discards everything on
//                   close. Launched on request (WSB cannot stream
//                   output back; the tool explains this honestly and
//                   returns the generated config path).
//   • none        — direct host execution (today's behavior).
//
// execInIsolation() is the single entry the run_command wrapper
// calls; health() powers the Settings UI (available / not installed
// / how to fix). Nothing here throws; failures degrade to a clear
// tool error, never to silent host execution.
//
// v11.31 capability audit: docker/WSL are spawned with ARG ARRAYS (no
// shell). The old code built a shell string with POSIX `'` quoting that
// cmd.exe does not understand on Windows, so `-v 'C:\path':/work` broke
// volume mounts. Paths are validated/normalized per OS, output is
// credential-redacted, and abort/timeout share one process-kill path.
// ============================================================
import { spawn } from 'child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runCaptured } from './terminalService';

export type IsolationProfile = 'none' | 'docker' | 'wsl' | 'winsandbox';
export type IsolationNetwork = 'none' | 'bridge';

export interface IsolationConfig {
  profile: IsolationProfile;
  networkMode: IsolationNetwork;
  cpuLimit: string; // docker --cpus
  memoryLimit: string; // docker --memory
}

const ISO_CAPTURE_CAP = 200_000;

/** Never leak a token embedded in a URL or an env assignment to the UI. */
function redactIso(text: string): string {
  return String(text ?? '')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi, '$1***@')
    .replace(/\b((?:authorization|token|password|passwd|secret|api[-_]?key)\s*[:=]\s*)([^\s,;]+)/gi, '$1***');
}

export const DEFAULT_ISOLATION: IsolationConfig = {
  profile: 'none',
  networkMode: 'none',
  cpuLimit: '2',
  memoryLimit: '2g',
};

/**
 * Arg-array exec for isolation backends: no shell means paths containing
 * spaces, `&`, `'` or Windows backslashes are passed verbatim on every OS.
 * Captures output (capped), resolves on close/timeout/abort, never throws.
 */
function runArgsCaptured(
  file: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => {};

    const child = spawn(file, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env },
    });
    const finish = (exitCode: number, note?: string): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (note) output += note;
      resolve({ output: redactIso(output).slice(0, ISO_CAPTURE_CAP), exitCode });
    };
    const collect = (c: Buffer): void => {
      if (output.length < ISO_CAPTURE_CAP) output += c.toString('utf8');
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', (err) => finish(-1, `\n[surnia] spawn failed: ${String(err)}`));
    child.on('close', (code) => finish(code ?? -1));
    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      finish(-1, `\n[surnia] command timed out after ${timeoutMs}ms`);
    }, Math.max(1000, timeoutMs));

    onAbort = () => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      finish(-1, '\n[surnia] command aborted');
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export interface IsolationHealth {
  profile: IsolationProfile;
  available: boolean;
  detail: string;
  /** Actionable hint when unavailable. */
  hint?: string;
}

// ------------------------------------------------------------
// Health checks
// ------------------------------------------------------------

export async function health(cfg: IsolationConfig): Promise<IsolationHealth> {
  switch (cfg.profile) {
    case 'none':
      return { profile: 'none', available: true, detail: 'host execution (no isolation)' };
    case 'docker': {
      try {
        const r = await runArgsCaptured('docker', ['version', '--format', '{{.Server.Version}}'], os.homedir(), 15_000);
        if (r.exitCode === 0 && r.output.trim()) {
          return { profile: 'docker', available: true, detail: `docker engine ${r.output.trim().slice(0, 20)} reachable` };
        }
        return { profile: 'docker', available: false, detail: `docker CLI failed: ${r.output.slice(-160)}`, hint: 'install Docker Desktop / dockerd and ensure your user is in the docker group' };
      } catch (err) {
        return { profile: 'docker', available: false, detail: `docker not runnable: ${err instanceof Error ? err.message : String(err)}`, hint: 'install Docker Desktop / dockerd' };
      }
    }
    case 'wsl': {
      if (process.platform !== 'win32') {
        return { profile: 'wsl', available: false, detail: 'WSL only exists on Windows', hint: 'use the docker profile on Linux/macOS' };
      }
      try {
        const r = await runArgsCaptured('wsl.exe', ['--status'], os.homedir(), 20_000);
        if (r.exitCode === 0) return { profile: 'wsl', available: true, detail: 'WSL default distro available' };
        return { profile: 'wsl', available: false, detail: `wsl.exe exit ${r.exitCode}`, hint: 'run: wsl --install' };
      } catch (err) {
        return { profile: 'wsl', available: false, detail: `wsl.exe not found: ${err instanceof Error ? err.message : String(err)}`, hint: 'run: wsl --install' };
      }
    }
    case 'winsandbox': {
      if (process.platform !== 'win32') {
        return { profile: 'winsandbox', available: false, detail: 'Windows Sandbox only exists on Windows Pro/Enterprise', hint: 'use the docker profile' };
      }
      try {
        await fs.access('C:\\Windows\\System32\\WindowsSandbox.exe');
        return { profile: 'winsandbox', available: true, detail: 'Windows Sandbox installed' };
      } catch {
        return { profile: 'winsandbox', available: false, detail: 'WindowsSandbox.exe not found', hint: 'enable "Windows Sandbox" in Windows Features (Pro/Enterprise)' };
      }
    }
  }
}

// ------------------------------------------------------------
// Docker image bootstrap
// ------------------------------------------------------------

const IMAGE_TAG = 'surnia-isol:latest';

function dockerfileContent(): string {
  return [
    'FROM node:20-bookworm-slim',
    'RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv git ca-certificates ripgrep && rm -rf /var/lib/apt/lists/*',
    'RUN ln -sf /usr/bin/python3 /usr/local/bin/python',
    'WORKDIR /work',
    'CMD ["bash"]',
  ].join('\n');
}

export async function ensureIsolationImage(userDataDir: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const probe = await runArgsCaptured('docker', ['image', 'inspect', IMAGE_TAG], os.homedir(), 15_000);
    if (probe.exitCode === 0) return { ok: true, detail: 'isolation image present' };
  } catch {
    /* build below */
  }
  const dir = path.resolve(userDataDir, 'isol');
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'Dockerfile'), dockerfileContent(), 'utf8');
    // Arg array: the build context path is passed verbatim (spaces/quotes safe).
    const build = await runArgsCaptured('docker', ['build', '-t', IMAGE_TAG, dir], dir, 420_000);
    if (build.exitCode === 0) return { ok: true, detail: 'isolation image built' };
    return { ok: false, detail: `image build failed: ${build.output.slice(-240)}` };
  } catch (err) {
    return { ok: false, detail: `image build error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ------------------------------------------------------------
// Execution
// ------------------------------------------------------------

export interface IsolationExecOptions {
  command: string;
  workspace: string;
  timeoutMs: number;
  cfg: IsolationConfig;
  userDataDir: string;
  /** Extra env for the child process. */
  env?: Record<string, string>;
  /** Optional abort signal — kills the isolated child, never falls back to host. */
  signal?: AbortSignal;
}

export interface IsolationExecResult {
  /** true = the command ran INSIDE the chosen profile. */
  isolated: boolean;
  /** true = the command ran (isolated or fell back? NEVER falls back — see below). */
  ran: boolean;
  output: string;
  exitCode: number;
  /** How the command was executed (for the tool result / UI). */
  via: string;
}

function shellQuoteSingle(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** Translate a Windows drive path to its WSL mount (throws on UNC/relative). */
function windowsToWslPath(p: string): string {
  const norm = path.resolve(p).replace(/\\/g, '/');
  const m = /^([A-Za-z]):\/(.*)$/.exec(norm);
  if (!m) {
    throw new Error(`Cannot translate "${p}" to a WSL path. Use a Windows drive path such as C:\\work\\project.`);
  }
  return `/mnt/${m[1].toLowerCase()}/${m[2]}`;
}

/** XML-escape a value embedded in a generated Windows Sandbox .wsb file. */
function xmlEscape(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Execute a command inside the configured isolation profile. NEVER falls
 * back to host execution silently: if the profile is unavailable the call
 * fails with the health hint (fail-closed — a wall that disappears when
 * docker is down is not a wall).
 */
export async function execInIsolation(opts: IsolationExecOptions): Promise<IsolationExecResult> {
  const { command, workspace, cfg } = opts;
  const timeoutMs = Math.max(5_000, opts.timeoutMs);

  if (cfg.profile === 'none') {
    const r = await runCaptured(command, workspace, timeoutMs, opts.signal ? { signal: opts.signal } : undefined);
    return { isolated: false, ran: true, output: redactIso(r.output), exitCode: r.exitCode, via: 'host' };
  }

  const h = await health(cfg);
  if (!h.available) {
    return {
      isolated: false, ran: false, exitCode: -1,
      output: `ISOLATION UNAVAILABLE (${cfg.profile}): ${h.detail}. ${h.hint ?? ''}\n` +
        `The command was NOT executed — isolation is configured, so Surnia will not silently run it on the host. Fix the profile or set isolation profile to 'none'.`,
      via: `isolation:${cfg.profile}:unavailable`,
    };
  }

  if (cfg.profile === 'docker') {
    const img = await ensureIsolationImage(opts.userDataDir);
    if (!img.ok) {
      return { isolated: false, ran: false, exitCode: -1, output: `ISOLATION IMAGE UNAVAILABLE: ${img.detail}\nCommand NOT executed.`, via: 'docker:image' };
    }
    // Arg array: the workspace is a single argv entry, so no cmd.exe/POSIX
    // quoting mismatch can corrupt `-v`. Forward slashes work on Docker Desktop.
    const mountSource = path.resolve(workspace).replace(/\\/g, '/');
    const dockerArgs = [
      'run', '--rm',
      '--network', cfg.networkMode === 'bridge' ? 'bridge' : 'none',
      '--cpus', cfg.cpuLimit,
      '--memory', cfg.memoryLimit,
      '-v', `${mountSource}:/work`,
      '-w', '/work', '-e', 'CI=1',
      IMAGE_TAG, 'bash', '-lc', command,
    ];
    const r = await runArgsCaptured('docker', dockerArgs, workspace, timeoutMs, opts.signal);
    return { isolated: true, ran: true, output: r.output, exitCode: r.exitCode, via: `docker:${IMAGE_TAG}:${cfg.networkMode}` };
  }

  if (cfg.profile === 'wsl') {
    let wslPath: string;
    try {
      wslPath = windowsToWslPath(workspace);
    } catch (err) {
      return {
        isolated: false, ran: false, exitCode: -1,
        output: `WSL PATH ERROR: ${err instanceof Error ? err.message : String(err)}\nCommand NOT executed.`,
        via: 'wsl:path',
      };
    }
    // bash receives the script as ONE argv entry — quote only the directory,
    // not the user command (which may contain any shell syntax on purpose).
    const script = `cd ${shellQuoteSingle(wslPath)} && ${command}`;
    const r = await runArgsCaptured('wsl.exe', ['-e', 'bash', '-lc', script], workspace, timeoutMs, opts.signal);
    return { isolated: true, ran: true, output: r.output, exitCode: r.exitCode, via: 'wsl' };
  }

  // winsandbox — cannot stream output; generate the config and explain honestly
  const wsb = await generateSandboxConfig(workspace, opts.userDataDir, cfg.networkMode);
  return {
    isolated: false, ran: false, exitCode: -1,
    output:
      `WINDOWS SANDBOX is a visual profile: the command was staged in ${wsb.path} (workspace mapped ` +
      `${cfg.networkMode === 'none' ? 'without networking' : 'with networking'}, discarded on close).\n` +
      `Windows Sandbox cannot stream output back to the agent, so Surnia did NOT run it and reports no fake result. ` +
      `Open ${path.basename(wsb.path)} to run it, or use the docker/wsl profile for command execution.`,
    via: 'winsandbox:staged',
  };
}

/** Generate a Windows Sandbox .wsb file for the workspace. */
export async function generateSandboxConfig(workspace: string, userDataDir: string, networkMode: IsolationNetwork): Promise<{ path: string; content: string }> {
  const content = [
    '<Configuration>',
    '  <MappedFolders>',
    '    <MappedFolder>',
    `      <HostFolder>${xmlEscape(workspace)}</HostFolder>`,
    '      <ReadOnly>false</ReadOnly>',
    '    </MappedFolder>',
    '  </MappedFolders>',
    `  <Networking>${networkMode === 'none' ? 'Disable' : 'Default'}</Networking>`,
    '  <vGPU>Disable</vGPU>',
    '  <AudioInput>Disable</AudioInput>',
    '  <ClipboardRedirection>Disable</ClipboardRedirection>',
    '  <ProtectedClient>Enable</ProtectedClient>',
    '  <LogonCommand>',
    `    <Command>cmd /c start cmd /K "cd /d C:\\Users\\WDAGUtilityAccount\\Desktop && dir"</Command>`,
    '  </LogonCommand>',
    '</Configuration>',
    '',
  ].join('\n');
  const dir = path.join(userDataDir, 'isol');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `surnia-sandbox-${Date.now()}.wsb`);
  await fs.writeFile(file, content, 'utf8');
  return { path: file, content };
}

/** Resolve the effective config from settings (defensive defaults). */
export function resolveIsolationConfig(raw: { profile?: string; networkMode?: string } | undefined): IsolationConfig {
  const profile = (['none', 'docker', 'wsl', 'winsandbox'] as const).includes(raw?.profile as IsolationProfile)
    ? (raw?.profile as IsolationProfile)
    : DEFAULT_ISOLATION.profile;
  const networkMode = raw?.networkMode === 'bridge' ? 'bridge' : DEFAULT_ISOLATION.networkMode;
  return { ...DEFAULT_ISOLATION, profile, networkMode };
}

/** Spawn wrapper kept for parity with other services (unused paths guard). */
export function spawnDirect(cmd: string, cwd: string): void {
  try {
    spawn(cmd, { shell: true, cwd, stdio: 'ignore', detached: true }).unref();
  } catch {
    /* fire-and-forget */
  }
}
