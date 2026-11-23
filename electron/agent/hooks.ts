// ============================================================
// Surnia — hooks engine (Claude Code-style lifecycle hooks)
// Users declare shell hooks in `.surnia/hooks.json` (workspace,
// falls back to $KODEX_HOME/hooks.json). The agent runs them at
// two points in the tool loop:
//   PreToolUse  — before a tool executes. Exit code 2 BLOCKS the
//                 tool (stderr becomes the reason sent to the
//                 model). stdout (<4KB) is appended as context.
//   PostToolUse — after a tool runs. stdout (<4KB) is appended
//                 as context. Failures never crash the agent.
// The hook receives a JSON payload on stdin:
//   { hook, tool, args, ok?, output?, workspace, sessionId }
// and env vars KODEX_HOOK, KODEX_TOOL, KODEX_WORKSPACE.
//
// TRUST MODEL
//   Hooks are arbitrary shell code. Home-level hooks
//   (~/.surnia/hooks.json) are ALWAYS trusted (the user wrote
//   them on their own machine). WORKSPACE hooks come from
//   whatever repo is open — possibly a clone of someone else's
//   code — so they are IGNORED until the user explicitly opts
//   in by creating the marker file `<workspace>/.surnia/hooks-trusted`
//   (an empty file is fine; contents are ignored). Without the
//   marker, workspace hooks are skipped and a single warning is
//   logged per load. A UI consent prompt may replace the manual
//   marker later — until then the marker IS the consent.
// ============================================================
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface HookRule {
  /** Regex (string form) matched against the tool name; omit to match all tools. */
  matcher?: string;
  /** Shell command to run. Receives the JSON payload on stdin. */
  command: string;
  /** Timeout in ms (default 10_000, hard cap 60_000). */
  timeoutMs?: number;
}

export interface HooksConfig {
  PreToolUse?: HookRule[];
  PostToolUse?: HookRule[];
  // v12 — full lifecycle (Claude Code parity). All are optional and best-effort.
  SessionStart?: HookRule[];
  SessionEnd?: HookRule[];
  UserPromptSubmit?: HookRule[];
  PreCompact?: HookRule[];
  Stop?: HookRule[];
  SubagentStop?: HookRule[];
  Notification?: HookRule[];
}

/** Every hook name the engine supports (single source for sanitize + runner). */
export const HOOK_NAMES = [
  'PreToolUse', 'PostToolUse',
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreCompact',
  'Stop', 'SubagentStop', 'Notification',
] as const;
export type HookName = (typeof HOOK_NAMES)[number];

export interface HookOutcome {
  /** PreToolUse only: true → the tool must NOT run; `reason` explains why. */
  blocked: boolean;
  /** Block reason (stderr of the hook, or a default). */
  reason?: string;
  /** Hook stdout worth surfacing to the model (capped). */
  context?: string;
}

const CONTEXT_CAP = 4000;
const DEFAULT_TIMEOUT = 10_000;
const MAX_TIMEOUT = 60_000;
const CONFIG_MAX_BYTES = 256 * 1024;

let cached: { ws: string; home: string; cfg: HooksConfig } | null = null;

let warnedUntrusted = false; // warn once per process, not once per tool call

function asRuleArray(v: unknown): HookRule[] {
  if (!Array.isArray(v)) return [];
  const out: HookRule[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.command !== 'string' || !r.command.trim()) continue;
    const rule: HookRule = { command: r.command };
    if (typeof r.matcher === 'string' && r.matcher.trim()) rule.matcher = r.matcher;
    if (typeof r.timeoutMs === 'number' && r.timeoutMs > 0) {
      rule.timeoutMs = Math.min(Math.floor(r.timeoutMs), MAX_TIMEOUT);
    }
    out.push(rule);
  }
  return out;
}

export function sanitize(parsed: unknown): HooksConfig {
  if (!parsed || typeof parsed !== 'object') return {};
  const p = parsed as Record<string, unknown>;
  const out: HooksConfig = {};
  for (const name of HOOK_NAMES) {
    const rules = asRuleArray(p[name]);
    if (rules.length) out[name] = rules;
  }
  return out;
}

function surniaHome(): string {
  // v2.2 — fixed duplicated SURNIA_HOME condition: SURNIA_HOME || KODEX_HOME.
  return process.env.SURNIA_HOME || process.env.KODEX_HOME || path.join(os.homedir(), '.surnia');
}

/**
 * Load and cache hooks for a workspace. Home-level hooks are always trusted;
 * workspace hooks (`.surnia/hooks.json`) are only honored when the user has
 * created the trust marker `.surnia/hooks-trusted` in the workspace — cloned
 * repos must not be able to run shell code without explicit consent.
 * Returns an empty config when nothing exists — hooks are always optional.
 */
export async function loadHooks(workspace: string): Promise<HooksConfig> {
  const home = surniaHome();
  if (cached && cached.ws === workspace && cached.home === home) return cached.cfg;
  // Legacy callers assert PreToolUse/PostToolUse are always arrays — keep that
  // contract; the new lifecycle families stay optional.
  const cfg: HooksConfig = { PreToolUse: [], PostToolUse: [] };

  // ---------- workspace hooks (trust-gated) ----------
  const wsFile = path.join(workspace, '.surnia', 'hooks.json');
  try {
    const st = await fs.stat(wsFile);
    if (st.isFile() && st.size <= CONFIG_MAX_BYTES) {
      let trusted = false;
      try {
        const marker = await fs.stat(path.join(workspace, '.surnia', 'hooks-trusted'));
        trusted = marker.isFile();
      } catch {
        trusted = false; // marker missing → not trusted
      }
      if (trusted) {
        const text = await fs.readFile(wsFile, 'utf8');
        const parsed = sanitize(JSON.parse(text));
        for (const name of HOOK_NAMES) {
          const rules = parsed[name];
          if (rules?.length) (cfg[name] ??= []).push(...rules);
        }
      } else if (!warnedUntrusted) {
        warnedUntrusted = true;
        console.warn('[surnia] workspace hooks ignored until you create .surnia/hooks-trusted');
      }
    }
  } catch {
    /* missing/invalid workspace config → ignore silently */
  }

  // ---------- home hooks (always trusted) ----------
  const homeFile = path.join(home, 'hooks.json');
  try {
    const st = await fs.stat(homeFile);
    if (st.isFile() && st.size <= CONFIG_MAX_BYTES) {
      const text = await fs.readFile(homeFile, 'utf8');
      const parsed = sanitize(JSON.parse(text));
      for (const name of HOOK_NAMES) {
        const rules = parsed[name];
        if (rules?.length) (cfg[name] ??= []).push(...rules);
      }
    }
  } catch {
    /* missing/invalid home config → ignore silently */
  }

  cached = { ws: workspace, home, cfg };
  return cfg;
}

/** Test-only: drop the cache so config edits are picked up. */
export function resetHookCache(): void {
  cached = null;
}

function matches(rule: HookRule, toolName: string): boolean {
  if (!rule.matcher) return true;
  try {
    return new RegExp(rule.matcher, 'i').test(toolName);
  } catch {
    return false; // invalid regex matches nothing, never crashes
  }
}

function runShell(
  command: string,
  timeoutMs: number,
  payload: string,
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const shellArgs = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];
    let child;
    try {
      child = spawn(shell, shellArgs, {
        cwd: env.KODEX_WORKSPACE,
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      resolve({ code: 127, stdout: '', stderr: 'hook spawn failed' });
      return;
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        resolve({ code: 124, stdout, stderr: stderr || 'hook timed out' });
      }
    }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < CONTEXT_CAP * 2) stdout += d.toString('utf8');
    });
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < CONTEXT_CAP * 2) stderr += d.toString('utf8');
    });
    child.on('error', () => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve({ code: 127, stdout, stderr: stderr || 'hook failed to start' });
      }
    });
    child.on('close', (code) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve({ code: code ?? 1, stdout: stdout.slice(0, CONTEXT_CAP * 2), stderr: stderr.slice(0, CONTEXT_CAP * 2) });
      }
    });
    try {
      child.stdin?.on('error', () => {
        /* EPIPE: hook exited without reading stdin — env vars still carry the payload */
      });
      child.stdin?.write(payload);
      child.stdin?.end();
    } catch {
      /* stdin closed early — hook still sees env vars */
    }
  });
}

function cap(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  return t.length > CONTEXT_CAP ? t.slice(0, CONTEXT_CAP) + '\n… [hook output truncated]' : t;
}

async function runRules(
  rules: HookRule[],
  hookName: 'PreToolUse' | 'PostToolUse',
  toolName: string,
  argsJson: string,
  extra: { ok?: boolean; output?: string },
  workspace: string,
  sessionId: string,
): Promise<HookOutcome> {
  const payload = JSON.stringify({
    hook: hookName,
    tool: toolName,
    args: safeParse(argsJson),
    ok: extra.ok,
    output: extra.output?.slice(0, 2000),
    workspace,
    sessionId,
  });
  const contexts: string[] = [];
  for (const rule of rules) {
    if (!matches(rule, toolName)) continue;
    const res = await runShell(rule.command, rule.timeoutMs ?? DEFAULT_TIMEOUT, payload, {
      KODEX_HOOK: hookName,
      KODEX_TOOL: toolName,
      KODEX_WORKSPACE: workspace,
      KODEX_SESSION: sessionId,
    });
    if (hookName === 'PreToolUse' && res.code === 2) {
      return { blocked: true, reason: cap(res.stderr) || cap(res.stdout) || `Blocked by hook: ${rule.command}` };
    }
    // Non-zero (non-blocking) results are surfaced as context so the model
    // knows the hook misbehaved; exit 0 stdout is plain context.
    const ctx = res.code === 0 ? cap(res.stdout) : cap(`[hook exit ${res.code}] ${res.stderr || res.stdout}`);
    if (ctx) contexts.push(ctx);
  }
  return { blocked: false, context: contexts.length ? contexts.join('\n') : undefined };
}

/** Run PreToolUse hooks. Exit code 2 from any matching hook blocks the tool. */
export function runPreToolHooks(
  cfg: HooksConfig,
  toolName: string,
  argsJson: string,
  workspace: string,
  sessionId: string,
): Promise<HookOutcome> {
  const rules = cfg.PreToolUse ?? [];
  if (!rules.length) return Promise.resolve({ blocked: false });
  return runRules(rules, 'PreToolUse', toolName, argsJson, {}, workspace, sessionId);
}

/** Run PostToolUse hooks; stdout is returned as model-visible context. */
export function runPostToolHooks(
  cfg: HooksConfig,
  toolName: string,
  argsJson: string,
  ok: boolean,
  output: string,
  workspace: string,
  sessionId: string,
): Promise<HookOutcome> {
  const rules = cfg.PostToolUse ?? [];
  if (!rules.length) return Promise.resolve({ blocked: false });
  return runRules(rules, 'PostToolUse', toolName, argsJson, { ok, output }, workspace, sessionId);
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s.slice(0, 500) };
  }
}

// ============================================================
// v12 — FULL LIFECYCLE HOOKS (Claude Code parity)
// These are OBSERVATION hooks: their stdout is optional context,
// never injected into the model's prompt automatically, and a
// failure NEVER blocks or crashes the run. SessionEnd may use
// exit code 2 to request the run stop early (documented below).
// Payload on stdin: { hook, workspace, sessionId, ...extra }.
// ============================================================

export interface LifecycleHookResult {
  /** Context worth surfacing to the user/model (capped, deduped upstream). */
  context?: string;
  /** SessionEnd/Stop hooks may request an early stop with exit code 2. */
  requestStop?: boolean;
}

/**
 * Run one lifecycle hook family. Never throws. Each rule gets a bounded
 * timeout (default 10s), the JSON payload on stdin + KODEX_* env vars, and a
 * result that is aggregated. `matcher` is matched against `subject` when given
 * (e.g. a notification label or the compaction reason).
 */
export async function runLifecycleHook(
  cfg: HooksConfig,
  hook: Exclude<HookName, 'PreToolUse' | 'PostToolUse'>,
  workspace: string,
  sessionId: string,
  extra: Record<string, unknown> = {},
  subject = '',
): Promise<LifecycleHookResult> {
  const rules = cfg[hook] ?? [];
  if (!rules.length) return {};
  const payload = JSON.stringify({ hook, workspace, sessionId, ...extra });
  const contexts: string[] = [];
  let requestStop = false;
  for (const rule of rules) {
    if (subject && !matches(rule, subject)) continue;
    const res = await runShell(rule.command, rule.timeoutMs ?? DEFAULT_TIMEOUT, payload, {
      KODEX_HOOK: hook,
      KODEX_WORKSPACE: workspace,
      KODEX_SESSION: sessionId,
      KODEX_SUBJECT: subject,
    });
    if ((hook === 'SessionEnd' || hook === 'Stop') && res.code === 2) requestStop = true;
    const ctx = res.code === 0 ? cap(res.stdout) : cap(`[${hook} hook exit ${res.code}] ${res.stderr || res.stdout}`);
    if (ctx) contexts.push(ctx);
  }
  return { context: contexts.length ? contexts.join('\n') : undefined, requestStop };
}

/** Convenience wrappers used by the engine at each lifecycle point. */
export const runSessionStartHooks = (cfg: HooksConfig, ws: string, sid: string, extra?: Record<string, unknown>) =>
  runLifecycleHook(cfg, 'SessionStart', ws, sid, extra);
export const runSessionEndHooks = (cfg: HooksConfig, ws: string, sid: string, extra?: Record<string, unknown>) =>
  runLifecycleHook(cfg, 'SessionEnd', ws, sid, extra);
export const runUserPromptHooks = (cfg: HooksConfig, ws: string, sid: string, prompt: string) =>
  runLifecycleHook(cfg, 'UserPromptSubmit', ws, sid, { prompt: prompt.slice(0, 4000) });
/**
 * v11.15 — PreCompact now also receives the rolling continuity snapshot
 * (original task / decisions / files touched / pending steps) so a user hook
 * can persist it, audit it, or inject extra context. The 5th arg is optional:
 * legacy callers (engine.ts today) keep the exact old payload `{ reason }`.
 */
export const runPreCompactHooks = (
  cfg: HooksConfig,
  ws: string,
  sid: string,
  reason?: string,
  continuity?: Record<string, unknown>,
) =>
  runLifecycleHook(cfg, 'PreCompact', ws, sid, { reason, ...(continuity ? { continuity } : {}) }, reason);
export const runStopHooks = (cfg: HooksConfig, ws: string, sid: string, extra?: Record<string, unknown>) =>
  runLifecycleHook(cfg, 'Stop', ws, sid, extra);
export const runSubagentStopHooks = (cfg: HooksConfig, ws: string, sid: string, label?: string) =>
  runLifecycleHook(cfg, 'SubagentStop', ws, sid, { label }, label);
export const runNotificationHooks = (cfg: HooksConfig, ws: string, sid: string, message: string) =>
  runLifecycleHook(cfg, 'Notification', ws, sid, { message: message.slice(0, 2000) });
