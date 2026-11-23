// ============================================================
// Surnia v7.1 — AGENT DEBUG TOOLS (DAP front for the agent).
// One session per run, guarded by debug.ts. Tools:
//   debug_start  — launch (node|python) with breakpoints, PAUSE at first hit
//   debug_state  — current position + live variables (no stepping)
//   debug_eval   — evaluate an expression in the top frame
//   debug_step   — continue | next | stepIn | stepOut (+ optional watches)
//   debug_stop   — end the session, return the ROOT-CAUSE evidence trail
// The evidence trail feeds the proof package as root-cause evidence.
// ============================================================
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  debugStart,
  debugState,
  debugEval,
  debugStep,
  debugStop,
  debugActive,
  rootCauseSummary,
  type DebugAdapterKind,
  type DebugBreakpoint,
} from './dap';
import { getRunGates } from './engineGates';
import type { ToolContext, ToolOutcome } from './tools';

/**
 * v11.12 — local deny text. `denied` lives in tools.ts and importing it here
 * would create a tools ↔ debugTools cycle; the tsc run (now wired into
 * `npm run typecheck` in v11.12) caught this latent bug that esbuild never
 * flagged. Same contract as tools.denied.
 */
function denied(ctx: ToolContext): string {
  return ctx.denyHint ?? 'User denied this action. Ask how to proceed or use an alternative.';
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function resolveDebugPath(p: string, ctx: ToolContext): string {
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(ctx.workspace, p);
}

function userDataDirSafe(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as { app?: { getPath: (k: string) => string } };
    return app?.getPath('userData') ?? '.';
  } catch {
    return '.'; // CLI mode — adapter install goes to CWD/.surnia-dap
  }
}

export async function debugStartTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  if (debugActive()) {
    return { ok: false, output: 'A debug session is already active — call debug_stop first (one session per run).' };
  }
  const kindRaw = asString(args.kind).toLowerCase();
  const kind: DebugAdapterKind = kindRaw === 'python' ? 'python' : 'node';
  const program = asString(args.program).trim();
  if (!program) return { ok: false, output: 'Missing required parameter: program (absolute or workspace-relative path to the script).' };
  const abs = resolveDebugPath(program, ctx);
  if (!fs.existsSync(abs)) return { ok: false, output: `Program not found: ${abs}` };

  const breakpoints: DebugBreakpoint[] = [];
  const rawBps = Array.isArray(args.breakpoints) ? args.breakpoints : [];
  for (const raw of rawBps.slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue;
    const b = raw as Record<string, unknown>;
    const file = asString(b.file).trim();
    const line = Number(b.line);
    if (!file || !Number.isFinite(line) || line < 1) continue;
    const bp: DebugBreakpoint = { file: resolveDebugPath(file, ctx), line: Math.floor(line) };
    if (typeof b.condition === 'string' && b.condition.trim()) bp.condition = b.condition.trim();
    breakpoints.push(bp);
  }

  const argv = Array.isArray(args.args) ? args.args.map((a) => String(a)).slice(0, 20) : [];

  // A8 security fix — APPROVAL GATE. debug_start EXECUTES the program
  // (python/node interpreter on an agent-chosen path). It previously ran with
  // NO approval — a bypass of the run_command gate for arbitrary code.
  // Same posture as run_command for a `python <file>` invocation: kind
  // 'command', normal gate (danger classification does not apply here — the
  // program path is data, not a shell line).
  const launchLine = `${kind === 'python' ? 'python' : 'node'} ${abs}${argv.length ? ' ' + argv.join(' ') : ''}`;
  const allowed = await ctx.approve({
    kind: 'command',
    title: 'Debug program (runs it under a debugger)',
    detail: launchLine,
    payload: { command: `debug_start ${launchLine}`, cwd: ctx.workspace },
  });
  if (!allowed) return { ok: false, output: denied(ctx) };

  const res = await debugStart({
    kind,
    program: abs,
    args: argv,
    breakpoints,
    cwd: ctx.workspace,
    userDataDir: userDataDirSafe(),
  });
  if (!res.ok) return { ok: false, output: `debug_start: ${res.error ?? 'failed'}${res.note ? ` (${res.note})` : ''}` };

  const lines = [
    `Debugger attached (${kind}). PAUSED at:`,
    `  ${res.position?.file}:${res.position?.line} in ${res.position?.frameName}`,
    '',
    'Live variables (top scope):',
    ...(res.variables ?? []).slice(0, 16).map((v) => `  ${v.name} = ${v.value}`),
    '',
    'Use debug_eval to inspect expressions, debug_step to move (continue/next/stepIn/stepOut), debug_stop when done — the full state trail is kept as root-cause evidence.',
  ];
  return { ok: true, output: lines.join('\n') };
}

export async function debugStateTool(_args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolOutcome> {
  const res = await debugState();
  if (!res.ok) return { ok: false, output: `debug_state: ${res.error}` };
  const lines = [
    `PAUSED at ${res.position?.file}:${res.position?.line} in ${res.position?.frameName}`,
    '',
    ...(res.variables ?? []).slice(0, 20).map((v) => `  ${v.name} = ${v.value}`),
  ];
  return { ok: true, output: lines.join('\n') };
}

export async function debugEvalTool(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolOutcome> {
  const expr = asString(args.expression).trim();
  if (!expr) return { ok: false, output: 'Missing required parameter: expression' };
  const res = await debugEval(expr);
  if (!res.ok) return { ok: false, output: `debug_eval: ${res.error ?? 'failed'}` };
  return { ok: true, output: `${expr} → ${res.result}` };
}

export async function debugStepTool(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolOutcome> {
  const actionRaw = asString(args.action).toLowerCase();
  const action = (['continue', 'next', 'stepIn', 'stepOut'] as const).find((a) => a.toLowerCase() === actionRaw);
  if (!action) return { ok: false, output: `action must be one of: continue | next | stepIn | stepOut (got "${actionRaw}")` };
  const watches = Array.isArray(args.evaluate) ? args.evaluate.map((e) => String(e)).slice(0, 8) : undefined;
  const res = await debugStep(action, watches);
  if (!res.ok) return { ok: false, output: `debug_step: ${res.error}` };
  if (res.ended) return { ok: true, output: 'The program ran to completion (no further stops). Session ended — root-cause evidence is retained; call debug_stop for the summary.' };
  const lines = [
    `After ${action}: PAUSED at ${res.position?.file}:${res.position?.line} in ${res.position?.frameName}`,
    '',
    ...(res.variables ?? []).slice(0, 16).map((v) => `  ${v.name} = ${v.value}`),
  ];
  return { ok: true, output: lines.join('\n') };
}

export async function debugStopTool(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const res = await debugStop('agent finished the debug session');
  const gates = getRunGates(ctx.sessionId);
  const evidence = res.evidence;
  if (gates && evidence) {
    for (const stop of evidence.stops.slice(0, 10)) {
      gates.markTaint('repo', `debug:${path.basename(evidence.program)}`, `stopped at ${path.basename(stop.position.file)}:${stop.position.line}`);
    }
  }
  if (!res.stopped || !evidence) {
    return { ok: true, output: 'No active debug session.' + (rootCauseSummary() ? `\n\n${rootCauseSummary()}` : '') };
  }
  const lines = [
    `Debug session ended (${evidence.adapter}, ${evidence.stops.length} stopped state(s) recorded).`,
    '',
    rootCauseSummary() ?? '',
  ];
  return { ok: true, output: lines.filter(Boolean).join('\n') };
}
