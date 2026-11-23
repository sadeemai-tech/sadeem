// ============================================================
// Surnia — IPC registration (renderer → main handlers)
// Channels kdx:win, kdx:openExternal, kdx:dialog:openFolder and
// kdx:mcp:test are registered in main.ts (window/menu scope).
// Everything else non-agent is registered here; agent channels
// (kdx:agent:*) live in agent/register.ts (C2).
// ============================================================
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { AppSettings, CloneOptions, MCPServerConfig, ProviderId, ScheduleJob } from '../shared/types';
import { maskSecret, isMaskedSecret } from './services/storeService';
import { auditAppend } from './services/terminalGuard';
import * as store from './services/storeService';
// v12 — full profile export/import (settings + DNA + skills + prompts).
import * as profileSvc from './services/profileService';
import * as aiSvc from './services/aiService';
import * as slash from './services/slashService';
import * as fsSvc from './services/fsService';
import * as term from './services/terminalService';
import * as gitSvc from './services/gitService';
import * as sessions from './services/sessionService';
// v10.2 — side-effect import: pluginService self-registers its kdx:plugins:* handlers
import './services/pluginService';
import * as checkpoints from './services/checkpointService';
import * as providers from './services/providerService';
// A6 — live OpenRouter catalog for the model picker (kdx:models:openrouter)
import { openrouterContextFor, openrouterLiveModels, resolveModelWindow } from './services/openrouterCatalog';
import * as licenseSvc from './services/licenseService';
import * as apiServer from './services/apiServerService';
import * as remoteSvc from './services/remoteService';
import * as auth from './services/authService';
// v11.6 — prompt library (device-local reusable prompts)
import * as promptsSvc from './services/promptLibraryService';
import * as cloneSvc from './services/cloneService';
import * as preview from './services/previewService';
import * as approvals from './services/approvalPolicyService';
// v8 — browser visibility for the renderer (live Browser panel)
import * as browserSvc from './services/browserService';
import * as mcpRegistry from './services/mcpRegistryService';
import * as billing from './services/billingService';
import * as updateSvc from './services/updateService';
import * as scheduleSvc from './services/scheduleService';
import * as feedback from './services/feedbackService';
// v11.4 — Settings → Logs (level filter + folder/export/clear over logService)
import * as logs from './services/logService';
// v2.2 — Surnia DNA IPC (kdx:dna:*, kdx:skills:trust) self-registers via dna.ts
import { initDNA } from './agent/dna';
import { initPlaybookIpc } from './agent/playbook';
import { initSubagentsIpc } from './agent/subagents';
// v2 agent-engine surface (message queue + goals) — owned by Agent A (C-2).
import { enqueueUserMessage, setSessionGoal, clearSessionGoal, getSessionGoal } from './agent/engine';
import { contextWindowInfo, priceFor } from './agent/costs';
import { deviceMetrics } from './services/deviceService';
import type { PreviewStatusResult, PlanId } from '../shared/types';
// v5 — skills library (scopes + companion files + import/fork)
import {
  listSkills,
  loadSkill,
  skillFiles,
  saveSkill,
  deleteSkill,
  importSkillDir,
  forkBuiltinSkill,
  globalSkillsRoot,
  scopeRoot,
  listMarketplaceSkills,
  installMarketplaceSkill,
  removeInstalledSkill,
  type SkillScope,
} from './agent/skills';

export interface IpcContext {
  getMainWindow: () => BrowserWindow | null;
}

let skillsIpcRegistered = false;

/** v5 — skills library channels. Skills are user-authored instructions:
 *  read endpoints return file content, save endpoints only write INSIDE a
 *  scope root (workspace/.surnia/skills or userData/skills). */
function registerSkillsIpc(): void {
  if (skillsIpcRegistered) return;
  skillsIpcRegistered = true;

  const guard = (s: unknown): string => String(s ?? '').trim();

  handle('kdx:skills:list', (ws: string) => listSkills(guard(ws)));
  handle('kdx:skills:read', async (ws: string, slug: string) => {
    const w = guard(ws);
    const skill = await loadSkill(w, guard(slug));
    if (!skill) return null;
    const files = await skillFiles(w, skill.slug, skill.scope).catch(() => [] as string[]);
    return { ...skill, files };
  });
  handle('kdx:skills:save', (ws: string, skill: { name: string; description?: string; body: string }, scope: SkillScope) =>
    saveSkill(guard(ws), skill, scope === 'global' ? 'global' : 'workspace'),
  );
  handle('kdx:skills:delete', (ws: string, slug: string, scope: SkillScope) =>
    deleteSkill(guard(ws), guard(slug), scope),
  );
  handle('kdx:skills:importDir', (ws: string, srcDir: string, scope: SkillScope) =>
    importSkillDir(guard(ws), guard(srcDir), scope),
  );
  handle('kdx:skills:forkBuiltin', (ws: string, slug: string, scope: SkillScope) =>
    forkBuiltinSkill(guard(ws), guard(slug), scope),
  );
  handle('kdx:skills:roots', (ws: string) => ({
    global: globalSkillsRoot(),
    workspace: path.join(guard(ws) || '.', '.surnia', 'skills'),
  }));
  // v12 — skills marketplace (bundled catalog, one-click install to global).
  handle('kdx:skills:marketplace:list', (ws: string) => listMarketplaceSkills(guard(ws)));
  handle('kdx:skills:marketplace:install', (ws: string, slug: string) => installMarketplaceSkill(guard(ws), guard(slug)));
  handle('kdx:skills:marketplace:remove', (_ws: string, slug: string) => removeInstalledSkill(guard(slug)));
  // read one companion file (scripts/references/assets) — traversal-guarded
  handle('kdx:skills:readFile', (ws: string, slug: string, rel: string, scope?: SkillScope) => {
    const w = guard(ws);
    const s = guard(slug);
    const r = guard(rel);
    if (!w || !s || !r || s.includes('..') || s.includes('/') || s.includes('\\')) {
      throw new Error('bad skill slug');
    }
    if (r.includes('..') || path.isAbsolute(r)) throw new Error('bad companion path');
    const resolvedScope: SkillScope = scope ?? 'workspace';
    const root = scopeRoot(w, resolvedScope);
    const target = path.join(root, s, r);
    if (!target.startsWith(path.join(root, s))) throw new Error('companion path escapes skill dir');
    return fs.promises.readFile(target, 'utf8');
  });
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(String(err));
}

// ============================================================
// v11.11 (A9) — argument validation + secret masking helpers
// ============================================================

/** Honest type check for string args (renderer-supplied): throws, never coerces. */
function strArg(v: unknown, label: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${label.toUpperCase()}_REQUIRED`);
  return v;
}

/**
 * A9 — the renderer NEVER receives a full secret. Provider API keys, the
 * Stripe secret key and the apiServer token are masked (sk-li…9f4z) before
 * a settings object crosses the bridge. Main-process consumers keep using
 * the decrypted values inside the main process; a mask round-trips back on
 * save and storeService keeps the stored secret (isMaskedSecret).
 */
function maskSettingsForRenderer(s: Record<string, unknown>): Record<string, unknown> {
  try {
    const out = { ...(s as object) } as Record<string, unknown>;
    const providers = { ...((out.providers as Record<string, { apiKey?: string }> | undefined) ?? {}) };
    for (const [id, entry] of Object.entries(providers)) {
      if (entry && typeof entry === 'object' && typeof entry.apiKey === 'string') {
        providers[id] = { ...entry, apiKey: maskSecret(entry.apiKey) };
      }
    }
    out.providers = providers;
    const billing = out.billing as { stripeSecretKey?: string } | undefined;
    if (billing && typeof billing.stripeSecretKey === 'string') {
      out.billing = { ...billing, stripeSecretKey: maskSecret(billing.stripeSecretKey) };
    }
    const apiServerCfg = out.apiServer as { token?: string } | undefined;
    if (apiServerCfg && typeof apiServerCfg.token === 'string') {
      out.apiServer = { ...apiServerCfg, token: maskSecret(apiServerCfg.token) };
    }
    return out;
  } catch {
    return s; // masking must never break the settings read
  }
}

/** A9 — masked apiKey in a verify/enable request → the STORED real key. */
function unwrapMaskedKey(provider: string, apiKey: unknown): string | undefined {
  const k = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!k || !isMaskedSecret(k)) return k || undefined;
  try {
    const entry = store.getSettings().providers?.[provider as ProviderId];
    const stored = (entry as { apiKey?: string } | undefined)?.apiKey;
    return typeof stored === 'string' ? stored : undefined;
  } catch {
    return undefined;
  }
}

/**
 * v11.13 — run ONE command inside a workspace and return its REAL exit code.
 * Backs the composer's `/test` capability: the verdict is the process exit
 * code, never a heuristic. Output is capped and a deadline is enforced so a
 * hanging test script can never freeze the renderer.
 */
const CMD_RUN_ALLOW = new Set([
  'npm', 'pnpm', 'yarn', 'npx', 'node', 'jest', 'vitest',
  'python', 'python3', 'py', 'pytest', 'cargo', 'go', 'dotnet',
]);
/** Shell metacharacters must never reach a spawned process from the renderer. */
const CMD_RUN_META = /[;&|`$<>(){}\[\]!*?~\\"']/;

/**
 * SECURITY (P0 fix) — only a narrow, allow-listed TEST command may run,
 * never arbitrary shell. No `shell:true`, no inherited secrets, cwd jail,
 * and an explicit native approval before anything is spawned.
 */
async function runCommandOnce(
  cmd: string,
  cwd: string,
  timeoutMs?: number,
  approved = false,
): Promise<import('../shared/types').CommandRunResult> {
  const command = String(cmd ?? '').trim();
  const dir = String(cwd ?? '').trim();
  const empty: import('../shared/types').CommandRunResult = {
    ok: false, code: null, stdout: '', stderr: '', cmd: command, cwd: dir, ms: 0,
  };
  if (!command) return { ...empty, error: 'EMPTY_COMMAND' };
  if (CMD_RUN_META.test(command)) return { ...empty, error: 'UNSAFE_CHARACTERS' };
  const argv = command.split(/\s+/).filter(Boolean);
  if (argv.length < 2 || argv.length > 16) return { ...empty, error: 'BAD_COMMAND' };
  const exe = argv[0].toLowerCase();
  if (!CMD_RUN_ALLOW.has(exe)) return { ...empty, error: 'COMMAND_NOT_ALLOWED' };
  if ((exe === 'npm' || exe === 'pnpm' || exe === 'yarn') &&
      !(argv[1] === 'test' || (argv[1] === 'run' && /^test/i.test(argv[2] ?? '')))) {
    return { ...empty, error: 'ONLY_TEST_SCRIPTS' };
  }
  if (exe === 'node' && argv[1] !== '--test') return { ...empty, error: 'ONLY_TEST_SCRIPTS' };
  if (!dir || !fs.existsSync(dir)) return { ...empty, error: 'NO_WORKSPACE' };
  let safeDir: string;
  try { safeDir = fsSvc.assertSafePath(dir, 'test command cwd'); }
  catch { return { ...empty, error: 'CWD_NOT_ALLOWED' }; }
  if (!approved) return { ...empty, error: 'APPROVAL_REQUIRED' };

  // Minimal environment — never hand the whole process.env (API keys, tokens).
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    TEMP: process.env.TEMP ?? '',
    TMP: process.env.TMP ?? '',
    HOME: process.env.HOME ?? '',
    USERPROFILE: process.env.USERPROFILE ?? '',
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    NODE_ENV: 'test',
    CI: '1',
  };
  auditAppend('term_allow', { op: 'cmd_run_test', cwd: safeDir, cmd: command });
  const deadline = Math.max(1000, Math.min(120_000, Number(timeoutMs) || 60_000));
  const CAP = 512 * 1024;
  const startedAt = Date.now();
  return await new Promise<import('../shared/types').CommandRunResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (code: number | null, error?: string): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        ok: !error && code === 0,
        code,
        stdout,
        stderr,
        cmd: command,
        cwd: safeDir,
        ms: Date.now() - startedAt,
        ...(timedOut ? { timedOut: true } : {}),
        ...(error ? { error } : {}),
      });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd: safeDir, shell: false, windowsHide: true, env,
      });
    } catch (err) {
      return finish(null, err instanceof Error ? err.message : String(err));
    }
    child.stdout?.on('data', (c: Buffer) => {
      if (stdout.length < CAP) stdout += c.toString('utf8').slice(0, CAP - stdout.length);
    });
    child.stderr?.on('data', (c: Buffer) => {
      if (stderr.length < CAP) stderr += c.toString('utf8').slice(0, CAP - stderr.length);
    });
    child.on('error', (err) => finish(null, err instanceof Error ? err.message : String(err)));
    child.on('close', (code) => finish(typeof code === 'number' ? code : null));
    timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      stderr += '\n[surnia] command timed out';
      finish(null);
    }, deadline);
  });
}

/** Register a handler with uniform error wrapping (renderer gets a rejecting Promise). */
function handle(channel: string, fn: (...args: never[]) => unknown): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (fn as (...a: any[]) => unknown)(...args);
    } catch (err) {
      throw toError(err);
    }
  });
}

/**
 * v11.13 (launch audit P1) — sender-origin gate for the high-impact channels.
 * The only legitimate caller is the app's own renderer. In the PACKAGED app
 * that renderer is loaded from `surnia://bundle/index.html` (main.ts
 * `serveRenderer()` + `loadIndex()`: a privileged standard scheme that can
 * ONLY serve dist/ assets, registered before window creation). `file:` is the
 * documented last-resort fallback when protocol registration fails, and
 * `http(s)://localhost|127.0.0.1|::1` is Vite's loopback DEV server.
 *
 * BUGFIX: the original predicate allowed only `file:` + loopback http(s), so
 * EVERY wrapped tool call threw UNTRUSTED_SENDER in production (the real
 * senderFrame.url is `surnia://bundle/index.html`), stalling the agent.
 * A foreign/remote frame is still refused: we read senderFrame.url ONLY
 * (never fall back to `event.sender.getURL()`, which would mask a malicious
 * remote subframe behind the main frame's trusted URL).
 */
function isTrustedRenderer(event: unknown): boolean {
  const url = (event as { senderFrame?: { url?: string } } | null)?.senderFrame?.url ?? '';
  if (/^surnia:\/\/bundle\//i.test(url)) return true; // packaged renderer (normal path)
  if (/^file:/i.test(url)) return true; // packaged renderer (fallback path)
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(url); // loopback dev only
}

/** `handle` + sender-origin validation. Minimal, shared by all dangerous channels. */
function handleTrusted(channel: string, fn: (...args: never[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    if (!isTrustedRenderer(event)) throw new Error('UNTRUSTED_SENDER');
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (fn as (...a: any[]) => unknown)(...args);
    } catch (err) {
      throw toError(err);
    }
  });
}

export function registerIpc(ctx: IpcContext): void {
  // v11.4 — apply the persisted log level at boot (Settings → Logs REAL effect)
  logs.setLogLevel(store.getSettings().logs?.level);
  // v11 — auto-update (generic feed, manual check, honest unsigned note)
  updateSvc.setWindowGetter(ctx.getMainWindow);
  updateSvc.registerUpdateIpc();
  // v2.2 — Surnia DNA channels (kdx:dna:get/update/feedback/clear/stats/
  // dismissSuggestion + kdx:skills:trust) self-register here, mcp.ts-style.
  initDNA();
  // v11.12 — signature feature + subagent dashboard (self-registering IPC).
  initPlaybookIpc();
  initSubagentsIpc();

  // ---------- v5 — skills library (kdx:skills:*) ----------
  registerSkillsIpc();

  // ---------- terminal data channel ----------
  term.setOnData((event) => {
    try {
      ctx.getMainWindow()?.webContents.send('kdx:term:data', event);
    } catch {
      /* window closing — ignore */
    }
  });

  // ---------- filesystem ----------
  // v11.13 — FS surface is sender-gated: only the app's own renderer may call it.
  handleTrusted('kdx:fs:readDir', (root: string) => fsSvc.readDirTree(strArg(root, 'root')));
  handleTrusted('kdx:fs:readFile', (p: string) => fsSvc.readFile(strArg(p, 'path')));
  handleTrusted('kdx:fs:writeFile', (p: string, content: string) =>
    fsSvc.writeFile(strArg(p, 'path'), typeof content === 'string' ? content : String(content ?? '')),
  );
  handleTrusted('kdx:fs:createFile', (p: string, content?: string) =>
    fsSvc.createFile(strArg(p, 'path'), typeof content === 'string' ? content : ''),
  );
  handleTrusted('kdx:fs:createDir', (p: string) => fsSvc.createDir(strArg(p, 'path')));
  handleTrusted('kdx:fs:deletePath', (p: string) => fsSvc.deletePath(strArg(p, 'path')));
  handleTrusted('kdx:fs:renamePath', (oldPath: string, newPath: string) =>
    fsSvc.renamePath(strArg(oldPath, 'oldPath'), strArg(newPath, 'newPath')),
  );
  handleTrusted('kdx:fs:searchFiles', (root: string, pattern: string, include?: string) =>
    fsSvc.searchFiles(strArg(root, 'root'), strArg(pattern, 'pattern'),
      typeof include === 'string' ? include : undefined),
  );

  // ---------- v2.2 — explicit workspace confinement ----------
  // The renderer resolves the active workspace (dialog pick OR auto-open of
  // the last path) and reports it here; fsService pins the confine root
  // EXPLICITLY instead of relying on the readDir auto-adopt fallback (which
  // stays active for compatibility).
  handle('kdx:workspace:set', (workspace: string) => {
    const ws = String(workspace ?? '').trim();
    try {
      if (ws && fs.statSync(ws).isDirectory()) {
        fsSvc.setConfineRoot(ws);
        // keep the appData dir reachable (settings/sessions/etc.)
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { app } = require('electron') as { app?: { getPath?: (k: string) => string } };
          const ud = app?.getPath?.('userData');
          if (ud) fsSvc.addAllowedRoot(ud);
        } catch {
          /* non-electron — nothing to add */
        }
        // v3.1 — tell the MCP layer the active workspace so stdio servers with
        // cwd '${workspace}' (registry presets) resolve to the right directory.
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { setMcpWorkspace } = require('./agent/mcp') as { setMcpWorkspace?: (d: string) => void };
          setMcpWorkspace?.(ws);
        } catch {
          /* best-effort */
        }
        return { ok: true, workspace: ws };
      }
    } catch {
      /* not a directory → refuse (auto-adopt fallback stays active) */
    }
    return { ok: false, workspace: ws };
  });

  // ---------- terminal ----------
  // v11.13 — terminal surface is sender-gated (the guard itself is unchanged).
  handleTrusted('kdx:term:create', (cwd?: string) => term.create(cwd));
  handleTrusted('kdx:term:exec', (terminalId: string, cmd: string, cwd?: string) =>
    term.exec(terminalId, cmd, cwd),
  );
  handleTrusted('kdx:term:interrupt', (terminalId: string) => term.interrupt(terminalId));
  // v11.10 — raw stdin bridge: renderer keystrokes reach the RUNNING child
  // (npm init / create-* prompts, REPLs). Inert when no child is live.
  handleTrusted('kdx:term:write', (terminalId: string, data: string) => term.write(terminalId, String(data ?? '')));
  // v11.13 — one-shot TEST runner with a REAL exit code (backs /test).
  // P0-hardened: only trusted renderer frames may ask, and a native dialog is
  // REQUIRED before any process is spawned. Deny by default.
  ipcMain.handle('kdx:cmd:run', async (event, cmd: string, cwd: string, timeoutMs?: number) => {
    // Deny-by-default sender gate — now shared with the 28 wrapped channels so
    // the PACKAGED `surnia://bundle/` renderer is recognized. The native dialog,
    // command allow-list, cwd jail, minimal env and approve-before-spawn logic
    // below are unchanged.
    if (!isTrustedRenderer(event)) return { ok: false, code: null, stdout: '', stderr: '', cmd: '', cwd: '', ms: 0, error: 'UNTRUSTED_SENDER' };
    const command = String(cmd ?? '').trim();
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    if (!win) return { ok: false, code: null, stdout: '', stderr: '', cmd: command, cwd: String(cwd ?? ''), ms: 0, error: 'NO_WINDOW' };
    const answer = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Cancel', 'Run test'],
      defaultId: 0,
      cancelId: 0,
      title: 'Run test command',
      message: 'Allow SADEEM to run this test command?',
      detail: `${command}\n\nin: ${String(cwd ?? '')}\nNo shell is used. Only test runners are allowed.`,
    });
    if (answer !== 1) return { ok: false, code: null, stdout: '', stderr: '', cmd: command, cwd: String(cwd ?? ''), ms: 0, error: 'DECLINED' };
    return runCommandOnce(command, String(cwd ?? ''), timeoutMs, true);
  });

  // ---------- v11.10 — approvals manager (Settings → Approvals) ----------
  // Management surface over the SAME stores the engine gate writes
  // (approval-rules.json / approval-deny-rules.json) — list + per-rule revoke.
  handle('kdx:approvals:list', (workspace?: string) => approvals.list(workspace));
  handle('kdx:approvals:revoke', (workspace: string | undefined, key: string) =>
    approvals.revoke(workspace, String(key ?? '')),
  );

  // ---------- git ----------
  // v11.13 — git surface is sender-gated (writes/checkout included).
  handleTrusted('kdx:git:status', (root: string) => gitSvc.status(root));
  handleTrusted('kdx:git:diff', (root: string, path?: string) => gitSvc.diff(root, path));
  handleTrusted('kdx:git:stage', (root: string, paths: string[]) => gitSvc.stage(root, paths));
  handleTrusted('kdx:git:commit', (root: string, message: string) => gitSvc.commit(root, message));
  handleTrusted('kdx:git:init', (root: string) => gitSvc.init(root));
  handleTrusted('kdx:git:log', (root: string, n?: number) => gitSvc.log(root, n));
  handleTrusted('kdx:git:checkout', (root: string, branch: string) => gitSvc.checkout(root, branch));
  // v11.38 — branch create/list + identity: real git via gitService, gated like
  // every other git write (trusted renderer frames only).
  handleTrusted('kdx:git:branch:list', (root: string) => gitSvc.listBranches(root));
  handleTrusted('kdx:git:branch:create', (root: string, name: string, opts?: { checkout?: boolean; startPoint?: string }) =>
    gitSvc.createBranch(root, name, opts));
  handleTrusted('kdx:git:identity', (root: string) => gitSvc.identityInfo(root));

  // ---------- settings ----------
  handle('kdx:settings:get', () => {
    const s = store.getSettings();
    // v11.4 — keep the main-process log filter in sync with settings.logs.level
    logs.setLogLevel(s.logs?.level);
    // A9 — full secrets never cross the bridge; masks keep Settings editable
    // (storeService preserves the stored key when a mask round-trips back).
    return maskSettingsForRenderer(s as unknown as Record<string, unknown>);
  });
  handle('kdx:settings:save', (settings: AppSettings) => {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new Error('SETTINGS_INVALID');
    }
    const saved = store.saveSettings(settings);
    // v11.4 — REAL effect: the file logger's level filter follows the setting
    logs.setLogLevel(saved.logs?.level);
    // A9 — same masking contract as the read path.
    return maskSettingsForRenderer(saved as unknown as Record<string, unknown>);
  });

  // ---------- v12 — full profile export / import ----------
  // Export returns a portable JSON object (settings + DNA + skills +
  // prompts); the renderer downloads it. Import validates the shape and
  // restores/merges into the main-process stores.
  handle('kdx:profile:export', (workspace?: string) =>
    profileSvc.exportProfile(typeof workspace === 'string' ? workspace : undefined),
  );
  handle('kdx:profile:import', (payload: unknown, workspace?: string) =>
    profileSvc.importProfile(payload, typeof workspace === 'string' ? workspace : undefined),
  );

  // ---------- v11.4 — diagnostics log (Settings → Logs) ----------
  handle('kdx:logs:openFolder', async () => {
    const dir = logs.logsDirPath();
    if (!dir) return { ok: false, error: 'LOG_NOT_INITIALIZED' };
    try {
      await shell.openPath(dir);
      return { ok: true, path: dir };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  // Wires the EXISTING logService.getLogExport() (previously IPC-less):
  // returns the sanitized log tail; the renderer downloads/copies the text.
  // A9 — maxBytes is clamped (1KB–1MB) so a renderer cannot demand the file.
  handle('kdx:logs:export', (maxBytes?: number) =>
    logs.getLogExport(
      typeof maxBytes === 'number' && Number.isFinite(maxBytes)
        ? Math.min(1024 * 1024, Math.max(1024, Math.floor(maxBytes)))
        : undefined,
    ),
  );
  handle('kdx:logs:clear', () => logs.clearLog());

  // ---------- v11.4 — evidence (honest-agent proof artifacts, read-only) ----------
  handle('kdx:evidence:list', (limit?: number) => listEvidence(typeof limit === 'number' ? limit : 10));
  handle('kdx:evidence:openFolder', async () => {
    const dir = await evidenceProofsDir();
    if (!dir) return { ok: false, error: 'NO_USER_DATA' };
    try {
      await shell.openPath(dir); // created on demand so the reveal never fails
      return { ok: true, path: dir };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ---------- sessions ----------
  handle('kdx:sessions:list', () => sessions.list());
  handle('kdx:sessions:load', (id: string) => sessions.load(id));
  handle('kdx:sessions:save', (data: Parameters<typeof sessions.save>[0]) => sessions.save(data));
  handle('kdx:sessions:delete', (id: string) => sessions.remove(id));

  // ---------- checkpoints ----------
  handle('kdx:cp:create', (root: string, label: string) => checkpoints.create(root, label));
  handle('kdx:cp:list', (root: string) => checkpoints.list(root));
  handle('kdx:cp:restore', (root: string, id: string) => checkpoints.restore(root, id));

  // ---------- live preview ----------
  preview.setPreviewEventEmitter((e) => {
    try {
      ctx.getMainWindow()?.webContents.send('kdx:preview:event', e);
    } catch {
      /* window closing */
    }
  });
  handle('kdx:preview:scan', () => preview.scanPorts());
  handle('kdx:preview:staticStart', (dir: string) => preview.staticStart(dir));
  handle('kdx:preview:staticStop', () => {
    preview.staticStop();
    return { ok: true };
  });
  handle('kdx:preview:devStart', (workspace: string, runtime?: 'npm' | 'python' | 'custom' | 'go') =>
    preview.devStart(workspace, runtime ?? 'npm'),
  );
  handle('kdx:preview:devStop', () => {
    preview.devStop();
    return { ok: true };
  });
  handle('kdx:preview:status', async (): Promise<PreviewStatusResult> => {
    const [dev, st, ports] = await Promise.all([
      Promise.resolve(preview.devStatus()),
      Promise.resolve(preview.staticStatus()),
      preview.scanPorts(),
    ]);
    return { dev, static: st, ports };
  });
  handle('kdx:preview:targets', (workspace: string) => preview.detectTargets(workspace));

  // ---------- agent browser (v8: live visibility) ----------
  browserSvc.setBrowserEventEmitter((e) => {
    try {
      ctx.getMainWindow()?.webContents.send('kdx:browser:event', e);
    } catch {
      /* window closing */
    }
  });
  handle('kdx:browser:state', (sessionId: string) => browserSvc.browserStateFor(sessionId || 'default'));
  handle('kdx:browser:close', (sessionId: string) => {
    browserSvc.closeBrowser(sessionId || 'default');
    return { ok: true };
  });
  // v12 — tab-aware browser panel
  handle('kdx:browser:tabs', (sessionId: string) => browserSvc.browserTabsInfo(sessionId || 'default'));
  handle('kdx:browser:network', (sessionId: string, opts?: { url_contains?: string; limit?: number; clear?: boolean }) =>
    browserSvc.browserNetworkInfo(sessionId || 'default', opts ?? {}));
  handle('kdx:browser:tabAction', (sessionId: string, action: 'select' | 'close' | 'new', tabId?: string, url?: string) =>
    browserSvc.browserTabAction(sessionId || 'default', action, tabId, url));

  // ---------- MCP registry (v1.3) ----------
  handle('kdx:mcp:servers', () => mcpRegistry.listServers());
  handle('kdx:mcp:save', (cfg: MCPServerConfig) => mcpRegistry.saveServer(cfg));
  handle('kdx:mcp:delete', (id: string) => mcpRegistry.deleteServer(id));
  handle('kdx:mcp:connect', (id: string) => mcpRegistry.connect(id));
  handle('kdx:mcp:resources', (id: string) => mcpRegistry.listResources(id));
  handle('kdx:mcp:readResource', (id: string, uri: string) => mcpRegistry.readResource(id, uri));
  handle('kdx:mcp:prompts', (id: string) => mcpRegistry.listPrompts(id));

  // ---------- billing / subscription (v1.3) ----------
  handle('kdx:billing:get', () => billing.overview());
  handle('kdx:billing:setPaymentLink', (url: string) => billing.setPaymentLink(url));
  handle('kdx:billing:openCheckout', (plan: PlanId) => billing.openCheckout(plan));
  handle('kdx:billing:coupon', (code: string) => billing.applyCoupon(code));
  handle('kdx:billing:refreshPlan', () => billing.refreshPlan());
  // v11.4 — Stripe checkout stub: INERT until settings.billing.stripeSecretKey
  // is set (returns {configured:false}; the UI shows an honest note). When a
  // key exists the real Checkout Session call runs (see billingCheckout below).
  handle('kdx:billing:checkout', (plan: string) => billingCheckout(String(plan ?? '')));

  // ---------- app performance metrics ----------
  handle('kdx:app:metrics', () => deviceMetrics());

  // ---------- providers ----------
  // A9 — a masked apiKey (settings round-trip) resolves to the STORED key so
  // Verify/Enable keep working without re-typing; real typed keys pass through.
  handle('kdx:provider:verify', (provider: string, opts: providers.VerifyOptions) =>
    providers.verify(strArg(provider, 'provider'), {
      ...((opts ?? {}) as providers.VerifyOptions),
      apiKey: unwrapMaskedKey(String(provider ?? ''), (opts as providers.VerifyOptions | undefined)?.apiKey),
    }),
  );
  // LIVE model discovery: the full, newest-first model list for a provider.
  handle('kdx:provider:listModels', (provider: string, opts: providers.VerifyOptions) =>
    providers.listModels(strArg(provider, 'provider'), {
      ...((opts ?? {}) as providers.VerifyOptions),
      apiKey: unwrapMaskedKey(String(provider ?? ''), (opts as providers.VerifyOptions | undefined)?.apiKey),
    }),
  );
  // v11.10 (A8) — provider ENABLE: field-level credential validation +
  // auto model-list fetch + default-model pick. Catalog failure is an
  // honest per-provider warning, never a global validation failure.
  handle('kdx:provider:enable', (provider: string, req: providers.ProviderEnableRequest) =>
    providers.enableProvider(strArg(provider, 'provider'), {
      ...((req ?? {}) as providers.ProviderEnableRequest),
      apiKey: unwrapMaskedKey(String(provider ?? ''), (req as providers.ProviderEnableRequest | undefined)?.apiKey),
    }),
  );
  // A6 — LIVE OpenRouter catalog for the model picker. The key is read from
  // the same place the Providers settings pane writes it:
  // settings.providers.openrouter.apiKey (storeService decrypts on read),
  // so a key saved in Settings works here without re-entering it. The
  // fetcher caches in-module for 10 minutes and NEVER throws ([] on error).
  handle('kdx:models:openrouter', () => {
    const s = store.getSettings();
    const key = s.providers?.openrouter?.apiKey;
    return openrouterLiveModels(typeof key === 'string' ? key : '');
  });

  // ---------- app ----------
  handle('kdx:app:homeDir', () => os.homedir());

  // ---------- v6 — feedback & suggestions (صندوق الاقتراحات) ----------
  handle('kdx:feedback:save', (entry: unknown) => feedback.saveFeedback(entry as never));
  handle('kdx:feedback:list', () => feedback.listFeedback());
  handle('kdx:feedback:path', () => feedback.feedbackPath());
  handle('kdx:feedback:markdown', (entry: unknown) => feedback.feedbackToMarkdown(entry as never));
  handle('kdx:model:info', (modelId: string) => {
    // context window + pricing for the context meter — v11.11 (A6) RESOLUTION
    // ORDER: 1) the provider-reported EXACT window from the live OpenRouter
    // catalog (cached in main by the picker live-group + provider enable — the
    // founder's rule: provider-reported first), 2) the per-model catalog
    // table, 3) the honest 200k default. `ctxEstimated` true ⇒ neither the
    // catalog nor the table knew the id (UI shows "≈ 200,000").
    const id = String(modelId ?? '').trim();
    const catalogCtx = openrouterContextFor(id);
    const info = contextWindowInfo(id);
    const ctx = catalogCtx ?? info.ctx;
    const estimated = catalogCtx == null ? info.estimated : false;
    // v1137 — the live catalog is only fetched when the picker opens / a
    // provider is enabled. On a cold offline start `ctx` above is costs.ts's
    // generic 200k even for a genuine 1M model (e.g. claude-sonnet-4.5, which
    // the provider reports as 1,000,000 but costs.ts pins to 200k). This is
    // the founder's "1M shown as 200,000" bug. Resolve through the shared
    // high-precision helper: live provider first, curated 1M table second,
    // honest ≈ default last. Never downgrade a known 1M model to 200k.
    const window = resolveModelWindow(id, catalogCtx, { ctx, estimated });
    return {
      contextWindow: window.contextWindow,
      ctxEstimated: window.ctxEstimated,
      price: priceFor(id),
    };
  });
  handle('kdx:ai:complete', (params: import('../shared/types').AiCompleteParams) => aiSvc.aiComplete(params));
  // v11.13 — the only kdx:agent:* channel registered here is sender-gated;
  // the rest (run/abort/approval/…) live in agent/register.ts (not edited here).
  handleTrusted('kdx:agent:slashCommands', (workspace?: string) => slash.listSlashCommands(workspace));

  // ---------- licensing ----------
  handle('kdx:license:get', () => licenseSvc.get());
  handle('kdx:license:activate', (key: string) => licenseSvc.activate(key));
  handle('kdx:license:deactivate', () => licenseSvc.deactivate());

  // ---------- local API server (programmatic control) ----------
  handle('kdx:apiServer:get', () => apiServer.apiServerStatus());
  handle('kdx:apiServer:set', (patch: { enabled?: boolean; port?: number; token?: string }) =>
    apiServer.apiServerConfigure(patch ?? {}),
  );

  // ---------- v11.7 — SADEEM Remote (control the agent from a real phone) ----------
  handle('kdx:remote:get', () => remoteSvc.remoteStatus());
  handle('kdx:remote:set', (patch: { enabled?: boolean; port?: number }) =>
    remoteSvc.remoteConfigure(patch ?? {}),
  );

  // ---------- auth (local device accounts) ----------
  handle('kdx:auth:current', () => auth.currentAccount());
  handle('kdx:auth:hasAccounts', () => auth.hasAccounts());
  handle('kdx:auth:register', (name: string, email: string, password: string, plan?: string) =>
    auth.register(name, email, password, (plan as 'free' | 'pro' | 'team') ?? 'free'),
  );
  handle('kdx:auth:login', (email: string, password: string) => auth.login(email, password));
  handle('kdx:auth:logout', () => {
    auth.logout();
    return { ok: true };
  });
  handle('kdx:auth:strength', (password: string) => auth.passwordStrength(password));
  // v11.6 — GUEST PASS: skip sign-in for a limited device-level trial window.
  handle('kdx:auth:guest-begin', () => auth.guestBegin());
  handle('kdx:auth:guest-status', () => auth.guestStatus());
  // v11.6 — prompt library CRUD
  handle('kdx:prompts:list', () => promptsSvc.listPrompts());
  handle('kdx:prompts:save', (name: string, text: string) => promptsSvc.savePrompt(name, text));
  handle('kdx:prompts:delete', (id: string) => promptsSvc.deletePrompt(id));
  // v11.3 — WEBSITE-LINKED ACCOUNTS: sign-up/sign-in happen on the website;
  // the app mints a pair code and opens the site; the deep link completes it.
  handle('kdx:auth:web-begin', (mode: 'signup' | 'signin') => auth.beginWebAuth(mode === 'signin' ? 'signin' : 'signup'));
  handle('kdx:auth:web-open', (url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      void shell.openExternal(parsed.toString());
    }
    return { ok: true };
  });

  // ---------- clone repository ----------
  handleTrusted('kdx:git:clone', (opts: CloneOptions) =>
    cloneSvc.cloneRepo(opts, (p) => {
      try {
        ctx.getMainWindow()?.webContents.send('kdx:clone:progress', p);
      } catch {
        /* window closing */
      }
    }),
  );

  // ============================================================
  // v2 — scheduler / queue / goals / fork+export / worktrees /
  // AI git helpers / workspace memory
  // ============================================================

  // ---------- scheduled agent jobs ----------
  handle('kdx:schedule:list', () => scheduleSvc.listJobs());
  handle('kdx:schedule:add', (job: Partial<ScheduleJob>) => scheduleSvc.addJob(job ?? {}));
  handle('kdx:schedule:remove', (id: string) => scheduleSvc.removeJob(String(id ?? '')));
  handle('kdx:schedule:toggle', (id: string, enabled: boolean) =>
    scheduleSvc.toggleJob(String(id ?? ''), enabled === true),
  );
  handle('kdx:schedule:runNow', (id: string) => scheduleSvc.runNow(String(id ?? '')));
  // v11.38 — honest scheduler state (ticker installed / webhook actually bound).
  // The renderer bridge for this channel is a HANDOFF (preload/api.ts); the
  // handler is real and tested through schedulerStatus() directly.
  handle('kdx:schedule:status', () => scheduleSvc.schedulerStatus());
  // v11.38 — cancel an in-flight headless run; durable event ledger.
  handle('kdx:schedule:cancel', (id: string) => scheduleSvc.cancelJob(String(id ?? '')));
  handle('kdx:schedule:events', (limit?: number) =>
    scheduleSvc.listEvents(typeof limit === 'number' ? limit : 50),
  );

  // ---------- message queue + session goals (agent engine) ----------
  handle('kdx:queue:send', (sessionId: string, text: string) =>
    enqueueUserMessage(String(sessionId ?? ''), String(text ?? '')),
  );
  handle('kdx:goal:set', (sessionId: string, goal: string) => {
    setSessionGoal(String(sessionId ?? ''), String(goal ?? ''));
    return { ok: true };
  });
  handle('kdx:goal:clear', (sessionId: string) => {
    clearSessionGoal(String(sessionId ?? ''));
    return { ok: true };
  });
  handle('kdx:goal:get', (sessionId: string) => getSessionGoal(String(sessionId ?? '')));

  // ---------- session fork + markdown export ----------
  handle('kdx:sessions:fork', (id: string) => sessions.forkSession(String(id ?? '')));
  handle('kdx:sessions:export', (id: string) => sessions.exportSessionMarkdown(String(id ?? '')));

  // ---------- git worktrees ----------
  handleTrusted('kdx:git:worktreeList', (root: string) => gitSvc.listWorktrees(String(root ?? '')));
  handleTrusted('kdx:git:worktreeCreate', (root: string, name: string) =>
    gitSvc.createWorktree(String(root ?? ''), String(name ?? '')),
  );
  handleTrusted('kdx:git:worktreeRemove', (root: string, name: string, force?: boolean) =>
    gitSvc.removeWorktree(String(root ?? ''), String(name ?? ''), force === true),
  );
  handleTrusted('kdx:git:worktreeMerge', (root: string, name: string) =>
    gitSvc.mergeWorktree(String(root ?? ''), String(name ?? '')),
  );
  // v10.2 — resolve one worktree by name (composer picker / session hand-off)
  handleTrusted('kdx:git:worktreeResolve', (root: string, name: string) =>
    gitSvc.resolveWorktree(String(root ?? ''), String(name ?? '')),
  );

  // ---------- v10.2 library (cross-session artifact gallery) ----------
  // v11.38 — library channels now report DISTINCT, honest failures instead of
  // an unexplained empty gallery. `list` still resolves to a plain array (the
  // renderer contract), but a broken bridge/scan rejects with a named error;
  // a disk-scan problem is also readable from `kdx:library:health`.
  const library = require('./services/libraryService') as typeof import('./services/libraryService');
  const libError = (op: string, err: unknown): Error => new Error(
    `kdx:library:${op} failed: ${err instanceof Error ? err.message : String(err)}`,
  );
  handle('kdx:library:list', async () => {
    try {
      return await library.listLibraryItems();
    } catch (err) {
      throw libError('list', err);
    }
  });
  handle('kdx:library:health', () => {
    try {
      return library.libraryScanHealth();
    } catch (err) {
      throw libError('health', err);
    }
  });
  handle('kdx:library:forget', (id: string) => {
    try {
      return library.forgetLibraryItem(String(id ?? ''));
    } catch (err) {
      throw libError('forget', err);
    }
  });
  handle('kdx:library:clear', () => {
    try {
      return library.clearLibrary();
    } catch (err) {
      throw libError('clear', err);
    }
  });
  handle('kdx:library:open', (id: string) => {
    const item = library.listLibraryItems(4000).then((items) => items.find((x) => x.id === String(id ?? '')));
    return item.then((hit) => {
      if (!hit) return false;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { shell } = require('electron') as typeof import('electron');
        shell.showItemInFolder(hit.path);
        return true;
      } catch (err) {
        throw libError('open', err);
      }
    });
  });

  // ---------- AI git helpers (completer injected from aiService) ----------
  handleTrusted('kdx:git:commitMessage', (root: string) =>
    gitSvc.generateCommitMessage(String(root ?? ''), aiSvc.aiComplete),
  );
  handleTrusted('kdx:git:review', (root: string, base?: string) =>
    gitSvc.reviewWorkingTree(String(root ?? ''), typeof base === 'string' ? base : undefined, aiSvc.aiComplete),
  );

  // ---------- workspace memory (<workspace>/MEMORY.md) ----------
  handle('kdx:memory:read', (workspace: string) => readWorkspaceMemory(String(workspace ?? '')));
  handle('kdx:memory:write', (workspace: string, content: string) =>
    writeWorkspaceMemory(String(workspace ?? ''), typeof content === 'string' ? content : ''),
  );

  // ---------- v7.1 — Proven Change / isolation / oauth / metrics ----------
  // OS isolation: health of the configured profile + settings passthrough.
  handle('kdx:isolation:health', async (cfg?: { profile?: string; networkMode?: string }) => {
    const { health, resolveIsolationConfig } = await import('./services/isolationService');
    return health(resolveIsolationConfig(cfg));
  });
  // MCP OAuth: sign-in (browser flow), status, sign-out per server.
  handle('kdx:mcp:oauth:signin', async (serverId: string, serverUrl: string) => {
    const { startOAuthFlow } = await import('./agent/mcpOAuth');
    const { app } = await import('electron');
    const { shell } = await import('electron');
    return startOAuthFlow({
      serverId: String(serverId ?? ''),
      serverUrl: String(serverUrl ?? ''),
      userDataDir: app.getPath('userData'),
      openUrl: (u) => void shell.openExternal(u),
    });
  });
  handle('kdx:mcp:oauth:status', async (serverId: string) => {
    const { oauthStatusFor } = await import('./agent/mcpOAuth');
    const { app } = await import('electron');
    return oauthStatusFor(String(serverId ?? ''), app.getPath('userData'));
  });
  handle('kdx:mcp:oauth:signout', async (serverId: string) => {
    const { clearOAuth } = await import('./agent/mcpOAuth');
    const { app } = await import('electron');
    await clearOAuth(String(serverId ?? ''), app.getPath('userData'));
    return { ok: true };
  });
  // The published honesty metric + verification-budget totals (Usage panel).
  // v8.1 — point the ledger at its persisted store FIRST, so the dashboard
  // shows the career-long False-Done record, not just this process's runs.
  handle('kdx:metrics:honesty', async () => {
    const { falseDoneStats, setFalseDoneStore } = await import('./agent/testRecord');
    {
      const { app } = await import('electron');
      const pathMod = await import('path');
      await setFalseDoneStore(pathMod.join(app.getPath('userData'), 'metrics'));
    }
    const budget = await import('./agent/budget');
    const { app } = await import('electron');
    const pathMod = await import('path');
    const fsp = await import('fs/promises');
    let entries: import('./agent/budget').ProvenCostEntry[] = [];
    try {
      entries = JSON.parse(await fsp.readFile(pathMod.join(app.getPath('userData'), 'costs', 'proven.json'), 'utf8')) as typeof entries;
      if (!Array.isArray(entries)) entries = [];
    } catch {
      entries = [];
    }
    const fd = falseDoneStats();
    return {
      falseDone: { claimed: fd.claimed, falseDone: fd.falseDone, rate: fd.rate },
      costPerProvenChange: budget.costPerProvenChange(entries).slice(0, 12),
    };
  });
  // Flows corrections (v7.1): suggestions from repeated user rejections.
  handle('kdx:flows:corrections', async () => {
    const { flowsCorrectionSuggestions } = await import('./services/flowsService');
    return flowsCorrectionSuggestions();
  });
  // v11.38 — never reject with an opaque Error: a replay result is a VERDICT,
  // so even a bad id / crashed child must come back as a structured, honest
  // {ok:false, detail}. (The renderer bridge for this channel is still a
  // handoff — see docs/FLOWS-PRO-V1138.md.)
  handle('kdx:flows:replay', async (flowId: string, ws?: string) => {
    const id = String(flowId ?? '').trim();
    if (!id) return { ok: false, exitCode: -1, detail: 'NO_FLOW_ID' };
    try {
      const { flowsValidateByReplay } = await import('./services/flowsService');
      return await flowsValidateByReplay(id, typeof ws === 'string' ? ws : undefined);
    } catch (err) {
      return { ok: false, exitCode: -1, detail: `replay error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });
  // Scheduler webhook info (token + endpoint) for the Schedule panel.
  // v11.38 — HONEST: report the listener's ACTUAL state. Before this the card
  // showed "LISTENER READY" from mere token presence even when port 7681 was
  // taken (EADDRINUSE) — a dead trigger advertised as live.
  handle('kdx:schedule:webhook', () => {
    const svc = require('./services/scheduleService') as {
      webhookToken: () => string;
      webhookState: () => { listening: boolean; port: number | null; error: string | null };
    };
    const state = svc.webhookState();
    const port = state.port ?? 7681;
    return {
      url: `http://127.0.0.1:${port}/trigger/<jobId>`,
      token: svc.webhookToken(),
      listening: state.listening,
      port: state.port,
      error: state.error,
    };
  });

  // ---------- v9 — run journal (crash-resilient progress trail) ----------
  handle('kdx:journal:list', async (limit?: number) => {
    const { listJournals } = await import('./agent/journal');
    const { app } = await import('electron');
    return listJournals(app.getPath('userData'), typeof limit === 'number' ? limit : 20);
  });
  handle('kdx:journal:read', async (file: string, maxLines?: number) => {
    const { readJournal, isJournalFileAllowed } = await import('./agent/journal');
    const { app } = await import('electron');
    const pathMod = await import('path');
    // A8 — PATH JAIL: the renderer supplies a file path that readJournal()
    // reads verbatim. Round-tripped journal paths live under
    // <userData>/journals — anything else (traversal, absolute escape, a
    // non-.jsonl file) is refused before the fs sees it.
    const ud = app.getPath('userData');
    const raw = String(file ?? '');
    if (!isJournalFileAllowed(raw, ud)) {
      throw new Error(`JOURNAL_PATH_FORBIDDEN: ${pathMod.basename(raw).slice(0, 120)} is not a journal under <userData>/journals`);
    }
    return readJournal(pathMod.resolve(raw.trim()), typeof maxLines === 'number' ? maxLines : 200);
  });
}

// ============================================================
// v11.4 — evidence + checkout helpers (ipc-owned: billingService and
// the agent modules are outside this task's edit scope)
// ============================================================

/** One summarized proof package (no payload bloat — metadata only). */
interface EvidenceProofRow {
  file: string;
  id?: string;
  verdict?: string;
  createdAt?: string;
  workspaceName?: string;
  taskKind?: string;
}

/** userData/proofs — where agent/engine.ts saves signed proof packages. */
async function evidenceProofsDir(): Promise<string | null> {
  try {
    const { app } = await import('electron');
    return path.join(app.getPath('userData'), 'proofs');
  } catch {
    return null;
  }
}

/** Recent proofs + the persisted False-Done ledger (paths + counts only). */
async function listEvidence(limit: number): Promise<{
  proofs: { dir: string | null; count: number; recent: EvidenceProofRow[] };
  falseDone: { claimed: number; falseDone: number; rate: number; recent: Array<{ runId: string; at: number; gateVerdict: string; falseDone: boolean }> };
}> {
  const dir = await evidenceProofsDir();
  const recent: EvidenceProofRow[] = [];
  let count = 0;
  if (dir && fs.existsSync(dir)) {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse(); // names embed creation time-ish ids; newest files first
    count = files.length;
    for (const f of files.slice(0, Math.max(1, Math.min(20, limit)))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Record<string, unknown>;
        const task = pkg.task as { kind?: string } | undefined;
        recent.push({
          file: path.join(dir, f),
          id: typeof pkg.id === 'string' ? pkg.id : undefined,
          verdict: typeof pkg.verdict === 'string' ? pkg.verdict : undefined,
          createdAt: typeof pkg.createdAt === 'string' ? pkg.createdAt : undefined,
          workspaceName: typeof pkg.workspaceName === 'string' ? pkg.workspaceName : undefined,
          taskKind: typeof task?.kind === 'string' ? task.kind : undefined,
        });
      } catch {
        recent.push({ file: path.join(dir, f) }); // unreadable — still listed honestly
      }
    }
  }
  // The persisted False-Done ledger (userData/metrics/false-done.json).
  let fd = { claimed: 0, falseDone: 0, rate: 0, recent: [] as Array<{ runId: string; at: number; gateVerdict: string; falseDone: boolean }> };
  try {
    const { falseDoneStats, setFalseDoneStore } = await import('./agent/testRecord');
    if (dir) {
      const { app } = await import('electron');
      await setFalseDoneStore(path.join(app.getPath('userData'), 'metrics'));
    }
    const stats = falseDoneStats();
    fd = {
      claimed: stats.claimed,
      falseDone: stats.falseDone,
      rate: stats.rate,
      recent: stats.recent.slice(-6).map((e) => ({
        runId: e.runId,
        at: e.at,
        gateVerdict: String(e.gateVerdict),
        falseDone: e.falseDone,
      })),
    };
  } catch {
    /* ledger unavailable — zeros are the honest answer */
  }
  return { proofs: { dir, count, recent }, falseDone: fd };
}

// ---------- v11.4 — Stripe checkout stub (kdx:billing:checkout) ----------
const STRIPE_PLANS: Record<string, { name: string; unitAmount: number }> = {
  pro: { name: 'SADEEM Pro', unitAmount: 1200 }, // $12/mo
  team: { name: 'SADEEM Team', unitAmount: 2900 }, // $29/mo
};

/**
 * When no secret key is configured: {configured:false} — the UI shows an
 * honest "Stripe not configured yet" note. When configured: a real Checkout
 * Session request to api.stripe.com with price_data templates and localhost:0
 * placeholder URLs (code path complete; the orchestrator wires real URLs).
 * No fake success states: network/API errors surface verbatim.
 */
async function billingCheckout(planId: string): Promise<{
  configured: boolean;
  ok?: boolean;
  url?: string;
  error?: string;
}> {
  const key = (store.getSettings().billing?.stripeSecretKey ?? '').trim();
  if (!key) return { configured: false };
  const plan = STRIPE_PLANS[planId];
  if (!plan) return { configured: true, ok: false, error: `unknown plan: ${planId}` };
  try {
    const body = new URLSearchParams({
      mode: 'subscription',
      success_url: 'http://localhost:0/?checkout=success',
      cancel_url: 'http://localhost:0/?checkout=cancel',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(plan.unitAmount),
      'line_items[0][price_data][recurring][interval]': 'month',
      'line_items[0][price_data][product_data][name]': plan.name,
    });
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    const json = (await res.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
    if (!res.ok || !json?.url) {
      return {
        configured: true,
        ok: false,
        error: json?.error?.message || `Stripe returned HTTP ${res.status}`,
      };
    }
    return { configured: true, ok: true, url: json.url };
  } catch (err) {
    return { configured: true, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------- workspace MEMORY.md helpers (defensive fs) ----------
// v11.11 release audit — PATH JAIL: the renderer supplies the workspace, so
// the MEMORY.md target must satisfy the SAME confinement rules as every other
// fs channel (absolute, no '..' segments, inside the active confine root /
// allowed roots). An escaping workspace → null → honest WORKSPACE_NOT_FOUND
// instead of an unjailled read/write anywhere on disk.

function memoryFile(workspace: string): string | null {
  const ws = String(workspace ?? '').trim();
  if (!ws) return null;
  try {
    const safeWs = fsSvc.assertSafePath(ws, 'workspace');
    if (!fs.statSync(safeWs).isDirectory()) return null;
    return path.join(safeWs, 'MEMORY.md');
  } catch {
    return null;
  }
}

async function readWorkspaceMemory(workspace: string): Promise<{ ok: boolean; content?: string; error?: string }> {
  try {
    const file = memoryFile(workspace);
    if (!file) return { ok: false, error: 'WORKSPACE_NOT_FOUND' };
    if (!fs.existsSync(file)) return { ok: true, content: '' }; // no memory yet
    const content = await fs.promises.readFile(file, 'utf8');
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function writeWorkspaceMemory(
  workspace: string,
  content: string,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const file = memoryFile(workspace);
    if (!file) {
      // v11.11 release audit — distinguish a confinement refusal from a
      // plain missing directory for the audit trail; the renderer keeps the
      // honest WORKSPACE_NOT_FOUND contract either way.
      try {
        fsSvc.assertSafePath(String(workspace ?? '').trim(), 'workspace');
      } catch (jailErr) {
        auditAppend('fs_block', {
          op: 'memory_write',
          path: String(workspace ?? '').slice(0, 300),
          error: jailErr instanceof Error ? jailErr.message : String(jailErr),
        });
      }
      return { ok: false, error: 'WORKSPACE_NOT_FOUND' };
    }
    // v11.11 release audit — write-side jail: protected dirs (.git/,
    // node_modules/) refused + parent realpath so a planted symlink cannot
    // redirect the write outside the allowed roots (fs_block audited).
    await fsSvc.assertSafeWritePath(file, 'path');
    await fs.promises.writeFile(file, content, 'utf8');
    return { ok: true, path: file };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/_OUTSIDE_WORKSPACE|_TRAVERSAL|_UNC_NOT_ALLOWED|_PROTECTED_DIR/.test(msg)) {
      auditAppend('fs_block', {
        op: 'memory_write',
        path: String(workspace ?? '').slice(0, 300),
        error: msg,
      });
    }
    return { ok: false, error: msg };
  }
}
