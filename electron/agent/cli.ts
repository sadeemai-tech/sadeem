#!/usr/bin/env node
// ============================================================
// SADEEM — FULL terminal agent (the same engine as the desktop app).
//   sadeem run "fix the flaky test"   one complete agent turn, then exit
//   sadeem                            interactive REPL (multi-turn, memory)
//   sadeem help | version | config | models
//   sadeem verify <proof.json> | journals | journal <id|latest>
//   sadeem "task"                     legacy bare-task form (still supported)
//
// This is NOT a wrapper around a chat endpoint: `run`/REPL call the REAL
// runAgent() from ./engine — the same 145-tool registry, approval gates,
// DNA/playbook, subagents, compaction, checkpoints and honest completion
// report the desktop app uses. Credentials are local-first: flags > env >
// ~/.surnia/settings.json (BYOK); nothing is sent anywhere except the chosen
// provider. No Electron binary is required (the 'electron' module is stubbed).
// ============================================================
import * as path from 'node:path';
import * as os from 'node:os';
import Module from 'node:module';
import * as readline from 'node:readline';
import type { AgentIO } from './engine';
import type {
  AgentEvent,
  AgentRunParams,
  ApprovalKind,
  ApprovalPayload,
  ChatMessage,
  PermissionDecision,
  PermissionMode,
} from '../../shared/types';

/** Engine also accepts forward-compatible credential overrides on params. */
type AgentRunParamsEx = AgentRunParams & { apiKey?: string; baseUrl?: string };

const VERSION = process.env.SADEEM_VERSION || '11.12.0';

// ---------- electron stub (before any engine import) ----------
// SURNIA_HOME || KODEX_HOME || default (~/.surnia) — mirrors slashService.ts:15.
const SURNIA_HOME = process.env.SURNIA_HOME || process.env.KODEX_HOME || path.join(os.homedir(), '.surnia');
const electronStub = {
  app: { getPath: () => SURNIA_HOME, whenReady: async () => true, getName: () => 'SADEEM', isReady: () => true, on() {}, quit() {} },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
  shell: { openExternal: async () => {}, openPath: async () => '', showItemInFolder() {} },
  ipcMain: { handle() {}, on() {}, removeAllListeners() {} },
};
const origLoad = (Module as unknown as { _load: Function })._load;
(Module as unknown as { _load: Function })._load = function (request: string, ...rest: unknown[]) {
  if (request === 'electron') return electronStub;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (origLoad as any).call(this, request, ...rest);
};

// ---------- args ----------
interface Args {
  task: string;
  mode: PermissionMode;
  workspace: string;
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  maxPrint: number;
  images: string[];
  /** --yes: never prompt for an approval (CI / one-shot automation). */
  yes: boolean;
  /** --quiet: suppress notices, tool cards and usage lines (answer text only). */
  quiet: boolean;
}
const MODES: readonly PermissionMode[] = ['plan', 'default', 'autoEdit', 'fullAccess'];
function parseArgs(argv: string[]): Args {
  // LOCAL-FIRST: with no flag/env override, use the provider+model configured
  // in ~/.surnia/settings.json (the same one the desktop app uses). Only then
  // fall back to the generic custom/gpt-4o default.
  const configured = readSettings().model;
  const out: Args = {
    task: '',
    mode: (process.env.KODEX_MODE as PermissionMode) || 'fullAccess',
    workspace: process.cwd(),
    provider: process.env.KODEX_PROVIDER || configured?.provider || 'custom',
    model: process.env.KODEX_MODEL || configured?.model || 'gpt-4o',
    baseUrl: process.env.KODEX_BASE_URL,
    apiKey: process.env.KODEX_API_KEY,
    maxPrint: 400,
    images: [],
    yes: process.env.SADEEM_CLI_YES === '1',
    quiet: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') out.mode = (argv[++i] as PermissionMode) || out.mode;
    else if (a === '--workspace') out.workspace = path.resolve(argv[++i] || '.');
    else if (a === '--provider') out.provider = argv[++i] || out.provider;
    else if (a === '--model') out.model = argv[++i] || out.model;
    else if (a === '--base-url') out.baseUrl = argv[++i] || out.baseUrl;
    else if (a === '--api-key') out.apiKey = argv[++i] || out.apiKey;
    else if (a === '--print-cap') out.maxPrint = Number(argv[++i]) || out.maxPrint;
    else if (a === '--image') { const v = argv[++i]; if (v) out.images.push(path.resolve(v)); }
    else if (a === '--yes' || a === '-y') out.yes = true;
    else if (a === '--quiet' || a === '-q') out.quiet = true;
    else rest.push(a);
  }
  if (!MODES.includes(out.mode)) out.mode = 'fullAccess';
  out.task = rest.join(' ').trim();
  return out;
}

// ---------- colors ----------
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const okc = (s: string) => `\x1b[32m${s}\x1b[0m`;
const errc = (s: string) => `\x1b[31m${s}\x1b[0m`;
const ambc = (s: string) => `\x1b[33m${s}\x1b[0m`;
const out = (s = '') => process.stdout.write(s);
const errout = (s = '') => process.stderr.write(s);

function printVersion(): void {
  out(`sadeem ${VERSION}\n`);
}

function printHelp(): void {
  out(
    [
      `sadeem ${VERSION} — the full SADEEM coding agent, in your terminal`,
      '',
      'Usage:',
      '  sadeem run "<task>" [flags]      run ONE complete agent turn (tools, approvals, report), then exit',
      '  sadeem [flags]                   interactive REPL — multi-turn, remembers the conversation',
      '  sadeem "<task>" [flags]          legacy form, same as `run`',
      '  sadeem help | version | config | models',
      '  sadeem verify <proof.json> [--rerun] [--workspace dir]',
      '  sadeem journals | journal <sessionId|latest>',
      '',
      'Flags:',
      '  --workspace DIR     project directory (default: cwd)',
      '  --mode MODE         plan | default | autoEdit | fullAccess (default: fullAccess)',
      '  --provider ID       anthropic | openai | openrouter | ollama | gemini | zai | deepseek | xai |',
      '                      moonshot | qwen | mistral | custom (default: settings.json, else custom)',
      '  --model NAME        model id (default: settings.json, else gpt-4o)',
      '  --base-url URL      OpenAI/Anthropic-compatible endpoint',
      '  --api-key KEY       BYOK credential (prefer env or settings.json — see config)',
      '  --image FILE        attach a screenshot (repeatable)',
      '  --yes, -y           auto-approve every terminal prompt (for CI / one-shot runs)',
      '  --quiet, -q         print only the final answer text',
      '  --print-cap N       max chars of tool output to show (default 400)',
      '',
      'REPL commands: /help, /mode <mode>, /clear, /config, /models, exit',
      '',
      'Credentials (local-first, first match wins): --api-key/--base-url > env > settings.json.',
      'Env: KODEX_API_KEY, KODEX_BASE_URL, KODEX_MODEL, KODEX_PROVIDER, KODEX_MODE,',
      '     SURNIA_HOME (settings dir, default ~/.surnia), SADEEM_CLI_YES=1, SADEEM_VERSION.',
      '',
      'Examples:',
      '  npm i -g sadeem && sadeem run "fix the flaky test"',
      '  sadeem run "add a /health endpoint and test it" --workspace ./my-app --mode default',
      '  sadeem --provider ollama --model qwen2.5-coder   # local, no key needed',
      '',
      dim('Arabic: يعمل الوكيل كاملاً من الترمينال — نفس محرك تطبيق سطح المكتب، بكل الأدوات والموافقات.'),
    ].join('\n') + '\n',
  );
}

type SettingsLite = {
  language?: string;
  permissionMode?: string;
  model?: { provider?: string; model?: string };
  providers?: Record<string, { apiKey?: string; baseUrl?: string; enabled?: boolean; lastModels?: string[] }>;
  mcpServers?: unknown[];
  agent?: Record<string, unknown>;
};
function readSettings(): SettingsLite {
  try {
    const svc = require('../services/storeService') as { getSettings(): SettingsLite };
    return svc.getSettings() || {};
  } catch {
    return {};
  }
}
const maskKey = (v?: string): string => {
  if (!v) return errc('(none)');
  const s = String(v);
  return `${s.slice(0, 5)}…${s.slice(-4)}`;
};

async function printConfig(_rest: string[]): Promise<void> {
  const s = readSettings();
  const a = parseArgs([]);
  const provider = a.provider;
  const entry = s.providers?.[provider] ?? s.providers?.[s.model?.provider ?? ''];
  out(
    [
      `sadeem config ${VERSION}`,
      '',
      `  settings dir : ${SURNIA_HOME}`,
      `  settings file: ${path.join(SURNIA_HOME, 'settings.json')}`,
      `  workspace    : ${a.workspace}`,
      `  provider     : ${a.provider}${entry?.enabled === false ? ' (DISABLED in settings)' : ''}`,
      `  model        : ${a.model}`,
      `  mode         : ${a.mode}`,
      `  api key      : ${a.apiKey ? maskKey(a.apiKey) + dim(' (from --api-key/env)') : maskKey(entry?.apiKey) + dim(' (from settings.json)')}`,
      `  base url     : ${a.baseUrl || entry?.baseUrl || dim('(provider default)')}`,
      `  MCP servers  : ${Array.isArray(s.mcpServers) ? s.mcpServers.length : 0}`,
      `  language     : ${s.language || 'en'}`,
      '',
      dim('Keys are never printed. Override with flags or KODEX_* env vars; nothing is uploaded except to your chosen provider.'),
    ].join('\n') + '\n',
  );
}

async function printModels(): Promise<void> {
  const { MODEL_CATALOG } = await import('./providers') as typeof import('./providers');
  const s = readSettings();
  out(`Configured: ${s.model?.provider || 'custom'}/${s.model?.model || '(none)'} — override with --provider/--model\n\n`);
  for (const cat of MODEL_CATALOG) {
    out(`${cat.label} ${dim(`(${cat.provider})`)}\n`);
    for (const m of cat.models.slice(0, 8)) {
      out(`  ${m.recommended ? okc('★') : ' '} ${m.id.padEnd(30)} ${dim(m.name)}\n`);
    }
    const configured = s.providers?.[cat.provider]?.lastModels ?? [];
    if (configured.length) out(dim(`  live (cached): ${configured.slice(0, 8).join(', ')}\n`));
  }
  out('\n' + dim('`sadeem models` shows the built-in catalog; live models are cached from the desktop app / config.\n'));
}

// ---------- terminal stdin: one queue shared by the REPL and approval prompts ----------
class TerminalInput {
  private queue: string[] = [];
  private waiters: Array<(line: string | null) => void> = [];
  private closed = false;
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    this.rl.on('line', (line) => {
      const w = this.waiters.shift();
      if (w) w(line);
      else this.queue.push(line);
    });
    this.rl.on('close', () => {
      this.closed = true;
      while (this.waiters.length) {
        const w = this.waiters.shift();
        if (w) w(null);
      }
    });
  }

  next(): Promise<string | null> {
    if (this.queue.length) return Promise.resolve(this.queue.shift() ?? null);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  ask(prompt: string): Promise<string> {
    out(prompt);
    return this.next().then((line) => line ?? '');
  }

  close(): void {
    try { this.rl.close(); } catch { /* already closed */ }
  }
}

interface PendingApproval {
  kind: ApprovalKind;
  title: string;
  detail: string;
  payload: ApprovalPayload;
}
interface ApprovalCtx {
  /** --yes or fullAccess: no terminal prompt, auto-allow. */
  auto: boolean;
  pending: Map<string, PendingApproval>;
  input: TerminalInput | null;
  ensureInput(): TerminalInput;
  close(): void;
}
function makeApprovalCtx(args: Args): ApprovalCtx {
  let input: TerminalInput | null = null;
  return {
    auto: args.yes || args.mode === 'fullAccess',
    pending: new Map(),
    get input() { return input; },
    ensureInput() {
      if (!input) input = new TerminalInput();
      return input;
    },
    close() { if (input) { input.close(); input = null; } },
  };
}

function decisionFromAnswer(requestId: string, ans: string): PermissionDecision {
  const a = ans.trim().toLowerCase();
  if (a === 'y' || a === 'yes' || a === 'allow') return { requestId, action: 'allow' };
  if (a === 'a' || a === 'always') return { requestId, action: 'always' };
  if (a === 's' || a === 'session') return { requestId, action: 'always_session' };
  if (a === 'p' || a === 'project') return { requestId, action: 'always_project' };
  if (a === 'never') return { requestId, action: 'never_always' };
  return { requestId, action: 'deny' }; // empty/EOF/unknown = safe deny
}

async function getDecision(ctx: ApprovalCtx, requestId: string): Promise<PermissionDecision> {
  if (ctx.auto) return { requestId, action: 'allow' };
  const req = ctx.pending.get(requestId);
  ctx.pending.delete(requestId);
  if (!req) return { requestId, action: 'deny' };

  if (req.kind === 'question' || req.kind === 'mcp_elicitation') {
    out('\n' + ambc(`❓ ${req.title}`) + '\n');
    if (req.detail) out(dim(`   ${req.detail.slice(0, 500)}`) + '\n');
    (req.payload.choices ?? []).forEach((c, i) => out(`   ${i + 1}. ${c}\n`));
    const answer = await ctx.ensureInput().ask(ambc('answer (or Enter to decline): '));
    if (!answer.trim()) return { requestId, action: 'deny' };
    return { requestId, action: 'answer', value: answer.trim() };
  }

  out('\n' + ambc(`⏳ APPROVAL (${req.kind}): ${req.title}`) + '\n');
  if (req.detail) out(dim(`   ${req.detail.slice(0, 800).replace(/\n/g, '\n   ')}`) + '\n');
  if (req.payload.command) out(`   $ ${req.payload.command}\n`);
  if (req.payload.path) out(`   file: ${req.payload.path}\n`);
  const ans = await ctx.ensureInput().ask(ambc('   [y]es / [n]o / [a]lways / [s]ession / [N]ever: '));
  return decisionFromAnswer(requestId, ans);
}

// ---------- one real engine turn, rendered into the terminal ----------
interface RunState {
  failed: boolean;
  finalText: string;
  outcome: 'completed' | 'error' | 'aborted' | null;
  toolFailures: number;
}
function createTerminalIO(args: Args, ctx: ApprovalCtx): { io: AgentIO; state: RunState } {
  const started = Date.now();
  const state: RunState = { failed: false, finalText: '', outcome: null, toolFailures: 0 };
  const debug = process.env.SADEEM_CLI_DEBUG === '1';

  const send = (e: AgentEvent): void => {
    switch (e.type) {
      case 'text_delta':
        state.finalText += e.text;
        out(e.text);
        break;
      case 'think_delta':
        if (!args.quiet) errout(dim(e.text));
        break;
      case 'sys_notice':
        if (!args.quiet) errout(dim(`[${e.kind}] ${e.text}\n`));
        break;
      case 'heartbeat':
        break;
      case 'tool_start':
        if (!args.quiet) out('\n' + dim(`▸ ${e.name} ${JSON.stringify(e.args).slice(0, 160)}`) + '\n');
        break;
      case 'tool_result': {
        if (!e.ok) state.toolFailures++;
        if (!args.quiet) {
          if (!e.ok) out(errc(`  ✗ ${e.output.slice(0, args.maxPrint)}`) + '\n');
          else out(dim(`  ✓ ${e.output.slice(0, 140).replace(/\n/g, ' ⏎ ')}`) + '\n');
        }
        break;
      }
      case 'message_end':
        if (!args.quiet && e.usage) {
          errout(dim(`\n— ${e.usage.inputTokens} in / ${e.usage.outputTokens} out · $${e.usage.costUsd.toFixed(4)} · ${((Date.now() - started) / 1000).toFixed(1)}s\n`));
        }
        break;
      case 'turn_end':
        out('\n');
        break;
      case 'error':
        state.failed = true;
        out('\n' + errc(`ERROR: ${e.message}`) + '\n');
        break;
      case 'aborted':
        state.failed = true;
        out(ambc('\nRun aborted.\n'));
        break;
      case 'approval_request':
        ctx.pending.set(e.requestId, { kind: e.kind, title: e.title, detail: e.detail, payload: e.payload });
        if (ctx.auto && !args.quiet) out(ambc(`  ⏳ auto-approved (${e.kind}): ${e.title}\n`));
        break;
      case 'plan_ready':
        if (!args.quiet) {
          out('\n' + ambc('═══ PLAN ═══') + '\n');
          if (e.title) out(`${e.title}\n`);
          if (e.steps?.length) e.steps.forEach((s, i) => out(`  ${i + 1}. ${s}\n`));
          if (e.plan) out(`${e.plan}\n`);
          out(ambc('═══════════') + '\n');
        }
        break;
      case 'task_report': {
        state.outcome = e.outcome;
        if (e.outcome !== 'completed') state.failed = true;
        const label = e.outcome === 'completed' ? okc(e.outcome.toUpperCase()) : e.outcome === 'aborted' ? ambc(e.outcome.toUpperCase()) : errc(e.outcome.toUpperCase());
        out(`\n${dim('─── REPORT')} ${label} ${dim(`${((Date.now() - started) / 1000).toFixed(1)}s`)}\n`);
        if (e.summary) out(`${e.summary}\n`);
        if (e.files.length) out(dim(`files: `) + e.files.slice(0, 20).join(', ') + (e.files.length > 20 ? ` (+${e.files.length - 20})` : '') + '\n');
        for (const c of e.commands.slice(0, 10)) out(dim(`  $ ${c.cmd}`) + `  ${c.ok ? okc('ok') : errc('failed')}\n`);
        if (e.howToRun) out(dim('verify: ') + e.howToRun + '\n');
        if (e.notDone?.length) out(ambc(`not done: ${e.notDone.slice(0, 8).join('; ')}\n`));
        if (e.nextSteps?.length) e.nextSteps.slice(0, 6).forEach((n) => out(`  → ${n}\n`));
        break;
      }
      // ---- proven-change gates / honesty telemetry ----
      case 'red_green':
        out(e.compliant ? okc(`\n[red→green] ${e.reason}\n`) : ambc(`\n[red→green ENFORCED] ${e.reason}\n`));
        break;
      case 'mutation_gate':
        if (e.verdict === 'killed-enough') out(okc(`\n[mutation gate] KILLED ${e.killed}/${e.ran} (${Math.round(e.killRate * 100)}%)\n`));
        else if (e.verdict === 'survivors') out(errc(`\n[mutation gate] FAILED — killed ${e.killed}/${e.ran}\n${e.detail.slice(0, 400)}\n`));
        else out(dim(`\n[mutation gate] ${e.verdict} — killed ${e.killed}/${e.ran}\n`));
        break;
      case 'fake_tests':
        if (e.high > 0) out(errc(`\n[fake-test gate] ${e.summary}\n`));
        else if (e.scanned > 0) out(dim(`\n[fake-test gate] ${e.summary}\n`));
        break;
      case 'proof_package':
        out(`\n${e.markdown}\n`);
        break;
      case 'false_done':
        out(dim(`\n[false-done rate] ${e.falseDone}/${e.claimed} overruled (${Math.round(e.rate * 100)}%)\n`));
        break;
      case 'taint_escalation':
        out(ambc(`\n[TAINT] ${e.why} — explicit approval required\n${e.sources.join('\n')}\n`));
        break;
      case 'taint_notice':
        out(ambc(`\n[poison scan] ${e.origin}: ${e.findings.map((f) => f.label).slice(0, 3).join('; ')}\n`));
        break;
      case 'budget_state':
        out(dim(`\n[${e.label}]\n`));
        break;
      case 'doom_loop':
        out(ambc(`\n[doom loop] ${e.tool} fired ${e.count}× — the engine is asking for a decision.\n`));
        break;
      case 'goal_progress':
        if (!args.quiet) out(dim(`\n[goal] ${e.goal} ${e.pct}%${e.note ? ' — ' + e.note : ''}\n`));
        break;
      case 'goal_done':
        out(okc(`\n[goal done] ${e.goal}\n`));
        break;
      case 'review_findings':
        out(ambc(`\n[review] ${e.findings.length} findings${e.summary ? ' — ' + e.summary : ''}\n`));
        break;
      case 'claim_audit':
        out(dim(`\n[claim audit] ${e.unsupported} unsupported of ${e.claims.length}\n`));
        break;
      default:
        if (debug) errout(dim(`[event:${(e as { type: string }).type}] ${JSON.stringify(e).slice(0, 300)}\n`));
        break;
    }
  };

  const io: AgentIO = {
    send,
    getDecision: (requestId) => getDecision(ctx, requestId),
    isAborted: () => false,
    onFetchSignal: () => {},
  };
  return { io, state };
}

interface TurnResult {
  ok: boolean;
  finalText: string;
  outcome: RunState['outcome'];
  toolFailures: number;
}
/** Mirrors engine.ts KEY_REQUIRED_PROVIDERS — but the CLI error must tell the
 *  user how to fix it FROM A TERMINAL, not "open Settings" in a UI they lack. */
const KEY_REQUIRED = new Set([
  'anthropic', 'openai', 'openrouter', 'gemini', 'zai', 'deepseek',
  'xai', 'moonshot', 'qwen', 'mistral',
]);

async function executeTurn(args: Args, history: ChatMessage[], ctx: ApprovalCtx): Promise<TurnResult> {
  if (KEY_REQUIRED.has(args.provider) && !args.apiKey && !readSettings().providers?.[args.provider]?.apiKey) {
    out(
      errc(`No API key for "${args.provider}".\n`) +
      '  Terminal fixes (pick one):\n' +
      '    export KODEX_API_KEY=sk-...        # or pass --api-key\n' +
      '    sadeem config                       # shows where settings.json lives\n' +
      '    sadeem --provider ollama --model qwen2.5-coder   # local, no key\n' +
      dim('  You can also save the key once in the desktop app (Settings → AI providers);\n') +
      dim('  the CLI reads the same ~/.surnia/settings.json.\n'),
    );
    return { ok: false, finalText: '', outcome: 'error', toolFailures: 0 };
  }

  const { runAgent } = await import('./engine');
  const { randomUUID } = await import('node:crypto');
  const { io, state } = createTerminalIO(args, ctx);
  const userMessage: ChatMessage = {
    id: randomUUID(),
    role: 'user',
    kind: 'text',
    timestamp: Date.now(),
    content: args.task,
    ...(args.images.length ? { images: args.images } : {}),
  };
  const messages = [...history, userMessage];
  if (!args.quiet) errout(dim(`sadeem · ${args.provider}/${args.model} · mode=${args.mode} · ${args.workspace}\n`));

  try {
    await runAgent(
      {
        task: 'chat',
        sessionId: 'cli-' + randomUUID(),
        messages,
        model: { provider: args.provider as never, model: args.model },
        mode: args.mode,
        workspace: args.workspace,
        apiKey: args.apiKey,
        baseUrl: args.baseUrl,
      } as AgentRunParamsEx,
      io,
    );
  } catch (err) {
    state.failed = true;
    out('\n' + errc(`fatal: ${err instanceof Error ? err.message : String(err)}`) + '\n');
  }

  if (state.finalText.trim()) {
    history.push({
      id: randomUUID(),
      role: 'assistant',
      kind: 'text',
      content: state.finalText,
      timestamp: Date.now(),
      model: `${args.provider}/${args.model}`,
    });
    if (history.length > 40) history.splice(0, history.length - 40);
  }
  return { ok: !state.failed, finalText: state.finalText, outcome: state.outcome, toolFailures: state.toolFailures };
}

// ---------- interactive REPL ----------
async function repl(args: Args): Promise<void> {
  const ctx = makeApprovalCtx(args);
  const input = ctx.ensureInput();
  const history: ChatMessage[] = [];
  let mode = args.mode;
  out(`sadeem ${VERSION} ${dim('— interactive agent · /help for commands · exit to quit')}\n`);
  out(dim(`  ${args.provider}/${args.model} · ${mode} · ${args.workspace}\n\n`));

  try {
    for (;;) {
      const line = await input.next();
      if (line === null) { out('\n'); break; }
      const text = line.trim();
      if (!text) continue;
      const lower = text.toLowerCase();
      if (lower === 'exit' || lower === 'quit' || lower === ':q' || lower === '/exit' || lower === '/quit') break;
      if (lower === 'help' || lower === '/help') { printHelp(); continue; }
      if (lower === '/clear' || lower === '/reset') { history.length = 0; out(dim('conversation cleared.\n')); continue; }
      if (lower === '/config') { await printConfig([]); continue; }
      if (lower === '/models') { await printModels(); continue; }
      if (lower.startsWith('/mode')) {
        const m = lower.split(/\s+/)[1] as PermissionMode;
        if (MODES.includes(m)) { mode = m; out(`mode → ${okc(m)}\n`); }
        else out(errc(`unknown mode "${m || ''}" — use ${MODES.join(', ')}\n`));
        continue;
      }
      const turnArgs: Args = { ...args, task: text, mode, quiet: false };
      const res = await executeTurn(turnArgs, history, ctx);
      if (res.ok) out(dim(`[turn ok${res.toolFailures ? ` · ${res.toolFailures} tool failure(s)` : ''}]\n`));
      else out(errc(`[turn ${res.outcome ?? 'error'}]\n`));
    }
  } finally {
    ctx.close();
  }
}

// ---------- verify / journals (headless proof + crash journal tooling) ----------
async function runVerify(rest: string[]): Promise<void> {
  const fileArg = rest.find((a) => !a.startsWith('--'));
  const rerun = rest.includes('--rerun');
  let ws = process.cwd();
  const wsIdx = rest.indexOf('--workspace');
  if (wsIdx !== -1 && rest[wsIdx + 1]) ws = path.resolve(rest[wsIdx + 1]);
  const legacyIdx = rest.indexOf('--legacy-key');
  if (!fileArg) {
    errout(
      [
        'Usage: sadeem verify <surnia-proof-*.json> [--rerun] [--workspace dir] [--legacy-key hex]',
        '',
        '  Verifies a proof package: Ed25519 signature (public key embedded in the',
        '  package — verification works on ANY machine with NO key material),',
        '  authenticity grading, sha256 fingerprints against the CURRENT tree, and —',
        '  with --rerun — a clean re-run of the recorded test command (exit must match).',
      ].join('\n') + '\n',
    );
    process.exitCode = 2;
    return;
  }
  const { promises: fsx } = await import('node:fs');
  const { verifyProofPackage } = await import('./proof');
  let pkg: { format?: string; id?: string; verdict?: string; tests?: { runs?: { command?: string }[] } };
  try {
    pkg = JSON.parse(await fsx.readFile(path.resolve(fileArg), 'utf8'));
  } catch (err) {
    errout(errc(`cannot read proof file: ${err instanceof Error ? err.message : String(err)}`) + '\n');
    process.exitCode = 1;
    return;
  }
  if (pkg?.format !== 'surnia-proof') {
    errout(errc('not a Surnia proof package (format !== "surnia-proof")') + '\n');
    process.exitCode = 1;
    return;
  }
  const report = await verifyProofPackage(pkg as never, {
    workspace: ws,
    rerunTestCommand: rerun ? pkg?.tests?.runs?.at(-1)?.command ?? null : null,
    ...(legacyIdx !== -1 && rest[legacyIdx + 1] ? { legacyHmacKey: rest[legacyIdx + 1] } : {}),
  });
  out(`proof: ${path.basename(String(fileArg))} (id ${pkg.id})\n`);
  out(`verdict at run time: ${pkg.verdict}\n`);
  out(`signature: ${report.signatureValid ? okc('VALID') : errc('INVALID')}${report.signatureValid ? ` (${report.authenticity}, key ${report.keyId})` : ''}\n`);
  if (report.filesChecked) {
    out(`fingerprints: ${report.filesMatching}/${report.filesChecked} match the current tree\n`);
    for (const d of report.drift.slice(0, 5)) out(`  ${ambc('~')} ${d.path} — tree moved on after the run\n`);
  }
  if (report.rerun) {
    out(`re-run "${report.rerun.command}": exit ${report.rerun.exitCode} — ${report.rerun.matchesRecorded ? okc('reproducible') : errc('NOT reproducible')}\n`);
  }
  out(`\n${report.detail}\n`);
  process.exitCode = report.verdict === 'valid' ? 0 : 1;
}

async function runJournals(argv: string[], cmd: string): Promise<void> {
  const { listJournals, readJournal } = await import('./journal');
  if (cmd === 'journals') {
    const list = listJournals(SURNIA_HOME, 20);
    if (!list.length) {
      out(dim('no run journals yet — runs record to ' + path.join(SURNIA_HOME, 'journals')) + '\n');
      return;
    }
    out(dim('recent run journals (newest first) — ' + path.join(SURNIA_HOME, 'journals')) + '\n');
    const row = (time: string, session: string, task: string, events: string, outcome: string): string =>
      `  ${time.padEnd(17)} ${session.padEnd(14)} ${events.padStart(6)}  ${outcome.padEnd(10)} ${task.slice(0, 52)}`;
    out(row('started', 'session', 'task', 'events', 'outcome') + '\n');
    for (const j of list) {
      const d = j.at ? new Date(j.at) : null;
      const time = d ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '?';
      const outcome = j.outcome === 'completed' ? okc('completed') : j.outcome === 'aborted' ? ambc('aborted') : errc(j.outcome ?? 'UNFINISHED');
      out(row(time, j.sessionId.slice(0, 13), j.task, String(j.events), outcome) + '\n');
    }
    return;
  }
  const rest = argv.slice(1);
  const idArg = rest.find((a) => a && !a.startsWith('--')) || 'latest';
  const list = listJournals(SURNIA_HOME, 200);
  const entry = idArg === 'latest' ? list[0] : list.find((j) => j.sessionId === idArg);
  if (!entry) {
    errout(errc(`no journal found for ${idArg === 'latest' ? 'any run' : `session "${idArg}"`} — run \`sadeem journals\` to list`) + '\n');
    process.exitCode = 1;
    return;
  }
  out(`journal: ${entry.file}\n`);
  out(dim(`session ${entry.sessionId} · started ${entry.at ? new Date(entry.at).toLocaleString() : '?'} · task: ${entry.task.slice(0, 160)}`) + '\n');
  const events = readJournal(entry.file, 80);
  const hhmmss = (at: unknown): string => {
    const d = typeof at === 'number' ? new Date(at) : null;
    return d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}` : '--:--:--';
  };
  for (const ev of events) {
    const t = hhmmss(ev.at);
    const type = String(ev.type ?? 'event');
    if (type === 'run') out(dim(`${t}  ▶ run · ${String(ev.workspace ?? '')}`) + '\n');
    else if (type === 'tool') {
      const mark = ev.ok ? okc('✓') : errc('✗');
      out(`${t}  ${mark} ${String(ev.name ?? '?').padEnd(22)} ${String(ev.ms ?? '?')}ms\n`);
    } else if (type === 'continue') out(ambc(`${t}  ⟳ auto-continue · round ${String(ev.round ?? '?')}`) + '\n');
    else if (type === 'finish') {
      const o = String(ev.outcome ?? '?');
      const colored = o === 'completed' ? okc(o) : o === 'aborted' ? ambc(o) : errc(o);
      out(`${t}  ■ finish · ${colored}${ev.summary ? ` — ${String(ev.summary).slice(0, 200)}` : ''}\n`);
    } else out(dim(`${t}  · ${type} ${JSON.stringify({ ...ev, at: undefined }).slice(0, 140)}`) + '\n');
  }
  if (!events.some((e) => e.type === 'finish')) out(errc('  (no finish line — the run was killed or crashed)') + '\n');
}

// ---------- dispatch ----------
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') { printHelp(); return; }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') { printVersion(); return; }
  if (cmd === 'config') { await printConfig(argv.slice(1)); return; }
  if (cmd === 'models') { await printModels(); return; }
  if (cmd === 'verify') { await runVerify(argv.slice(1)); return; }
  if (cmd === 'journals' || cmd === 'journal') { await runJournals(argv, cmd); return; }

  // `run` strips its subcommand; everything else (bare task or flag-first
  // invocation like `sadeem --workspace X "task"`) is parsed as-is.
  const rest = cmd === 'run' ? argv.slice(1) : argv;
  const args = parseArgs(rest);

  // No task → interactive REPL. This covers `sadeem`, `sadeem run`,
  // `sadeem --workspace X`, `sadeem --model m` — flags still apply to the REPL.
  if (!args.task) {
    await repl(args);
    return;
  }

  // One-shot turn: `sadeem run "<task>"` and legacy `sadeem "<task>"`.
  const ctx = makeApprovalCtx(args);
  try {
    const res = await executeTurn(args, [], ctx);
    process.exitCode = res.ok ? 0 : 1;
  } finally {
    ctx.close();
  }
}

main().catch((err) => {
  errout(errc('fatal: ' + (err instanceof Error ? err.stack || err.message : String(err))) + '\n');
  process.exitCode = 1;
});
