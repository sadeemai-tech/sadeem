// ============================================================
// Surnia — agent IPC bridge (thin)
// Owns: the single active run, the AbortController, decision
// resolvers and abort semantics. The engine manages everything
// else (approvals UI, "always" rules, checkpoints).
// Text deltas are COALESCED (33ms batch) before hitting 'kdx:agent-event';
// every other event type flushes pending text first and forwards instantly.
// ============================================================
import type { IpcMain, WebContents } from 'electron';
import * as path from 'node:path';
import {
  runAgent,
  applyPlanApproval,
  buildSessionRecap,
  enqueueUserMessage,
  getSessionGoal,
  getSessionTaskMode,
  steer,
  setSessionTaskMode,
  ENGINE_VERSION,
  type AgentIO,
} from './engine';
import { reviewWorkingDiff } from './review';
import { listSkills, deleteSkill, detectRivalSkills, importAllSkillsFrom, detectRivalMcpServers } from './skills';
import { generateWiki, getWiki, isAllowedWikiWorkspace } from '../services/wikiService';
import type {
  AgentEvent,
  AgentRunParams,
  AgentRunParamsInput,
  AppSettings,
  ChatMessage,
  ModelConfig,
  PermissionDecision,
  ProviderId,
  RunErrorCode,
  TaskMode,
} from '../../shared/types';
import {
  RUN_ERROR_TEXT,
  PERMISSION_MODES,
  TASK_MODES,
  PERMISSION_DECISION_ACTIONS,
} from '../../shared/types';
import { setAgentEventSink } from './mcp';
import { getSettings } from '../services/storeService';
import { checkGate } from '../services/billingService';
import { isDoneNotificationsEnabled, notifyAgentDone, notifyApprovalNeeded } from '../services/notifyService';
import * as sessions from '../services/sessionService';
// v2.5 — Flows (kdx:flows:*) self-register via flowsService (dna.ts pattern);
// the boot hook lives here because registerAgentIpc runs at app start.
import { initFlows } from '../services/flowsService';

// v12 (CONTINUITY FIX) — 10 minutes was longer than the renderer's 6-minute
// watchdog, so a lost/unanswered approval card produced exactly the reported
// "hang → fake disconnect → then error" sequence. 45 s is responsive and
// env-tunable; a timed-out approval now resolves promptly instead of hanging.
const DECISION_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.SURNIA_DECISION_TIMEOUT_MS) || 45_000,
); // unanswered approval → deny
const MAX_TRACKED_SIGNAL_CBS = 16; // one per run; drop stale entries
// v11.4 — per-run token: every run captures a monotonically increasing id;
// once a newer run has started, all events from an older (aborted, still
// unwinding) run are silently dropped, so its trailing deltas / aborted /
// turn_end can never leak into the new run's stream.
let runTokenSeq = 0;

/** v11.7 — guarded remote active-session setter (remote layer may be absent). */
function remoteSetActiveSessionSafe(id: string, title: string, workspace: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('../services/remoteService') as typeof import('../services/remoteService')).remoteSetActiveSession(
      id,
      title,
      workspace,
    );
  } catch {
    /* remote layer unavailable */
  }
}

/**
 * v11.21 — sender-origin validation for the agent bridge (P1-3). Mirrors
 * ipc.ts `isTrustedRenderer`: only the packaged renderer (`surnia://bundle/`,
 * `file:`) and loopback dev origins may drive the agent. A hostile remote
 * frame can no longer start runs / abort the active run through these IPC
 * channels. Kept local so no circular dependency with ipc.ts is introduced.
 */
function isTrustedAgentSender(event: unknown): boolean {
  const url = (event as { senderFrame?: { url?: string } } | null)?.senderFrame?.url ?? '';
  if (/^surnia:\/\/bundle\//i.test(url)) return true;
  if (/^file:/i.test(url)) return true;
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(url);
}

// ============================================================
// v11.22 — RUN-PARAM REPAIR (the HARDENED BOUNDARY)
// ============================================================
// The old `kdx:agent:run` handler rejected anything that was not already a
// perfectly formed AgentRunParams and blamed the user with a vague message.
// Real callers (phone
// bridge, flows, local API server, legacy bundles) legitimately send partial
// payloads: a `text`/`prompt` instead of `messages`, a model as the string
// `"provider/model"`, or nothing at all. The main process now REPAIRS these
// deterministically and only reports when there is genuinely nothing to send —
// with a precise, single-language, actionable reason.
//
// Kept pure and exported so a narrow test can exercise it directly as well as
// through the registered IPC handler.
// ------------------------------------------------------------

/** Mirrors the ProviderId union in shared/types (kept here so this module has
 *  no runtime dependency on the type-only shared barrel). */
const KNOWN_PROVIDER_IDS: ReadonlySet<string> = new Set<ProviderId>([
  'anthropic', 'openai', 'openrouter', 'ollama', 'gemini', 'zai',
  'deepseek', 'xai', 'moonshot', 'qwen', 'mistral', 'custom',
]);

export interface RunParamsRepairContext {
  /** settings.model — the honest default used when the caller's model is unusable. */
  defaultModel?: ModelConfig | null;
  /** Async reader for the session store's last real user message. */
  lastUserMessage?: (sessionId: string) => Promise<string | null>;
}

export interface RunParamsRepairResult {
  /** Repaired, engine-ready params — present on the success path. */
  params?: AgentRunParams;
  /** Precise machine reason, carried on the `error` event as `code`. */
  code?: RunErrorCode;
  /** Internal diagnostic detail (single language) — never shown as the user text. */
  reason?: string;
  /** The one concrete next action paired with `reason` (single language). */
  nextStep?: string;
}

/** Pick exactly ONE language from a shared [en, ar] pair. The main process has
 *  no `t()`; this keeps every emitted string monolingual. */
const localize = (pair: { readonly en: string; readonly ar: string }, language: string | undefined): string =>
  language === 'ar' ? pair.ar : pair.en;

/**
 * v11.31 — honest, bounded error text for the user-facing `error` event.
 * Never emit a raw object / JSON blob: a thrown non-Error value used to become
 * "[object Object]" (or an unbounded stringify) which tells the user nothing.
 * Real Error messages are preserved verbatim; only the degenerate cases get a
 * stable, actionable fallback.
 */
const errorText = (err: unknown): string => {
  if (err instanceof Error) return err.message || err.name || 'Unexpected error.';
  if (typeof err === 'string') return err.trim().slice(0, 500) || 'Unexpected error.';
  return 'The operation failed unexpectedly. Retry, or check Settings → Logs for details.';
};

const nonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const makeUserMessage = (text: string): ChatMessage => ({
  id: `usr:repair:${Date.now()}`,
  role: 'user',
  kind: 'text',
  content: text,
  timestamp: Date.now(),
});

/** Last genuine user row from a persisted session (synthetic steer/queue/sys
 *  rows are skipped — they were never typed by the user). */
export function lastRealUserText(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Partial<ChatMessage> | null;
    if (!m || typeof m !== 'object') continue;
    if (m.role !== 'user') continue;
    if (String(m.id ?? '').startsWith('sys:')) continue;
    if (m.model === 'steer' || m.model === 'queued') continue;
    const text = nonEmptyString(m.content);
    if (text) return text;
  }
  return undefined;
}

/** Keep only structurally valid transcript rows; never invent content. */
const normalizeMessages = (raw: unknown): ChatMessage[] => {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Partial<ChatMessage>;
    if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'tool') continue;
    if (typeof m.content !== 'string') continue;
    out.push({ ...m, role: m.role, content: m.content, streaming: false } as ChatMessage);
  }
  return out;
};

const hasUserMessage = (messages: ChatMessage[]): boolean =>
  messages.some((m) => m.role === 'user' && !!nonEmptyString(m.content));

/** v11.31 — clamp a loose `mode` to the engine's PermissionMode union. A
 *  malformed caller can no longer smuggle an unknown permission posture into
 *  runAgent; the safe default is the same one the engine would otherwise use. */
const normalizePermissionMode = (raw: unknown): AgentRunParams['mode'] =>
  typeof raw === 'string' && PERMISSION_MODES.includes(raw as AgentRunParams['mode'])
    ? (raw as AgentRunParams['mode'])
    : 'default';

/** v11.31 — clamp a loose `taskMode`; absent/invalid → omitted (engine default). */
const normalizeTaskMode = (raw: unknown): TaskMode | undefined =>
  typeof raw === 'string' && TASK_MODES.includes(raw as TaskMode) ? (raw as TaskMode) : undefined;

/** Repair a model from a full object, a `"provider/model"` string, or nothing.
 *  A usable settings default always wins over aborting the run. */
export function normalizeModel(
  raw: unknown,
  fallback: ModelConfig | null | undefined,
): ModelConfig | null {
  let provider: unknown;
  let model: unknown;
  let extra: Partial<ModelConfig> = {};
  if (typeof raw === 'string') {
    const s = raw.trim();
    const slash = s.indexOf('/');
    if (slash > 0) {
      provider = s.slice(0, slash).trim();
      model = s.slice(slash + 1).trim();
    } else {
      model = s; // provider comes from the default
    }
  } else if (raw && typeof raw === 'object') {
    const o = raw as Partial<ModelConfig>;
    provider = o.provider;
    model = o.model;
    extra = o;
  }
  const modelId = nonEmptyString(model);
  if (!modelId) {
    return fallback && nonEmptyString(fallback.model) ? { ...fallback } : null;
  }
  let providerId = nonEmptyString(provider) ?? nonEmptyString(fallback?.provider);
  if (!providerId || !KNOWN_PROVIDER_IDS.has(providerId)) {
    // Unknown provider id: prefer a valid configured default, otherwise keep
    // the explicit model id but route it through the generic 'custom' provider.
    if (fallback && nonEmptyString(fallback.model) && KNOWN_PROVIDER_IDS.has(String(fallback.provider))) {
      return { ...fallback };
    }
    providerId = 'custom';
  }
  return {
    provider: providerId as ProviderId,
    model: modelId,
    ...(typeof extra.maxTokens === 'number' ? { maxTokens: extra.maxTokens } : {}),
    ...(typeof extra.temperature === 'number' ? { temperature: extra.temperature } : {}),
    ...(extra.reasoning ? { reasoning: extra.reasoning } : {}),
  };
}

/** The single repair/validation point for `kdx:agent:run`. Never throws. */
export async function normalizeRunParams(
  raw: unknown,
  ctx: RunParamsRepairContext = {},
): Promise<RunParamsRepairResult> {
  // No params at all: there is genuinely nothing to repair from.
  if (raw === null || raw === undefined) {
    return {
      code: 'NO_PARAMS',
      reason: 'Run not started: no run parameters were supplied.',
      nextStep: 'Send your message again from the chat composer; if it keeps happening, reopen the chat.',
    };
  }
  if (typeof raw !== 'object') {
    return {
      code: 'BAD_SHAPE',
      reason: `Run not started: run parameters must be an object (received ${typeof raw}).`,
      nextStep: 'Send your message again from the chat composer.',
    };
  }
  const src = raw as AgentRunParamsInput;

  // 1. Model: object / "provider/model" string / settings default.
  const model = normalizeModel(src.model, ctx.defaultModel);
  if (!model) {
    return {
      code: 'NO_MODEL',
      reason: 'Run not started: no AI model is configured.',
      nextStep: 'Open Settings → AI providers, select a provider and a model, then send again.',
    };
  }

  const task: AgentRunParams['task'] =
    src.task === 'compact' || src.task === 'init' ? src.task : 'chat';
  // compact/init use synthetic engine prompts; only chat needs a real user row.
  const requiresUserMessage = task === 'chat';

  // 2. Messages: repair malformed arrays, then synthesize ONE honest user row
  //    from the caller's explicit text/prompt when messages are absent.
  let messages = normalizeMessages(src.messages);
  if (requiresUserMessage && !hasUserMessage(messages)) {
    const text = nonEmptyString(src.text) ?? nonEmptyString(src.prompt) ?? nonEmptyString(src.message);
    if (text) messages = [...messages, makeUserMessage(text)];
  }

  // 3. Still empty → fall back to the last real user message in the session store.
  if (requiresUserMessage && !hasUserMessage(messages)) {
    const sid = nonEmptyString(src.sessionId);
    let fromSession: string | undefined;
    if (sid && ctx.lastUserMessage) {
      try {
        fromSession = nonEmptyString(await ctx.lastUserMessage(sid));
      } catch {
        fromSession = undefined; // a session error must never crash the run path
      }
    }
    if (fromSession) messages = [...messages, makeUserMessage(fromSession)];
  }

  // 4. Nothing to send: a precise machine code, not a vague user-facing guess.
  if (requiresUserMessage && !hasUserMessage(messages)) {
    return {
      code: 'NO_USER_MESSAGE',
      reason: 'Run not started: there is no user message to send.',
      nextStep: 'Type a message in the composer and send it again.',
    };
  }

  // v11.31 — destructure away the fields that must NEVER be trusted from a
  // caller. `apiKey`/`baseUrl` are main-process-only credentials: the engine's
  // resolveCredentials() prefers DIRECT keys over the injected settings
  // snapshot, so a loose IPC payload carrying them would silently override the
  // key the user saved. `mode`/`taskMode` are re-added below AFTER clamping.
  // Everything else stays loss-less (mcpServers, memory, providers, …) so the
  // phone bridge / flows / legacy bundles keep working.
  const { apiKey: _apiKey, baseUrl: _baseUrl, mode: _mode, taskMode: _taskMode, ...rest } = src;
  const normalizedTaskMode = normalizeTaskMode(src.taskMode);

  return {
    params: {
      ...rest,
      task,
      sessionId: nonEmptyString(src.sessionId) ?? '',
      messages,
      model,
      workspace: nonEmptyString(src.workspace) ?? '',
      mode: normalizePermissionMode(src.mode),
      ...(normalizedTaskMode ? { taskMode: normalizedTaskMode } : {}),
      // Explicitly neutralised → resolveCredentials() falls through to the
      // main-process-injected `providers` snapshot set in the run handler.
      apiKey: undefined,
      baseUrl: undefined,
    } as AgentRunParams,
  };
}

export function registerAgentIpc(ipc: IpcMain, getWebContents: () => WebContents | null): void {
  // v2.5 — Flows channels (kdx:flows:list/save/delete/markRun/hit/info).
  initFlows();

  // v11.21 (P1-3): ONE sender-origin gate for every agent IPC channel. The
  // renderer only ever uses surnia://bundle/ (packaged) or loopback (dev), so
  // legitimate calls are unaffected — a hostile frame is rejected before any
  // run/abort/skill/wiki side effect. Kept local (no ipc.ts import cycle).
  const gated = (channel: string, fn: (...args: never[]) => unknown): void => {
    ipc.handle(channel, (e, ...args: unknown[]) => {
      if (!isTrustedAgentSender(e)) throw new Error('UNTRUSTED_SENDER');
      // v11.22 (ROOT-CAUSE FIX) — pass the event through. Every handler below
      // is declared `(_e, arg1, arg2, …)`; dropping `e` here shifted all args
      // by one, so `kdx:agent:run` received `raw === undefined` no matter what
      // the renderer sent and blamed the parameters on EVERY run.
      // The security gate above is UNCHANGED — only argument forwarding moves.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (fn as (...a: any[]) => unknown)(e, ...args);
    });
  };

  // v11.7 — SADEEM Remote desktop bridge: let the phone resolve pending
  // approvals and abort the desktop run through the SAME decision map the
  // renderer uses (one source of truth; no parallel permission state).
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const remote = require('../services/remoteService') as typeof import('../services/remoteService');
    remote.remoteSetDesktopBridge(
      (d) => {
        const resolve = decisions.get(d.requestId);
        if (!resolve) return false;
        decisions.delete(d.requestId);
        notifiedApprovals.delete(d.requestId);
        resolve(d);
        return true;
      },
      () => {
        aborted = true;
        try {
          controller?.abort();
        } catch {
          /* ignore */
        }
        resolveAllDecisions({ requestId: '', action: 'deny' });
      },
    );
  } catch {
    /* remote service unavailable — desktop approvals keep working via IPC */
  }

  // ---------- module (bridge) state ----------
  let controller: AbortController | null = null;
  let aborted = false;
  let active = false;
  const decisions = new Map<string, (d: PermissionDecision | null) => void>();
  const signalCbs: ((signal: AbortSignal) => void)[] = [];
  // v2.2 — approval notifications: pending requestIds already notified, so a
  // long-pending approval pings the desktop ONCE (never spams per re-send).
  const notifiedApprovals = new Set<string>();

  // ---------- helpers ----------
  // ---------- v3.2 — main-side text-delta coalescing ----------
  // Per-token webContents.send is the #1 main→renderer IPC tax (one serialize
  // + one context switch per model token). Consecutive text_delta events are
  // buffered and flushed AT MOST every DELTA_FLUSH_MS as ONE concatenated
  // text_delta. Every other event type flushes the buffer FIRST, so ordering
  // is preserved (a tool_start must never overtake pending text) and the
  // turn-end / error / abort paths always drain before they forward.
  const DELTA_FLUSH_MS = 16;
  let deltaBuf = '';
  let deltaTimer: ReturnType<typeof setTimeout> | null = null;
  // v11.3 — thinking has its own coalescing buffer: reasoning NEVER mixes
  // into the answer buffer, and both flush before any structural event.
  let thinkBuf = '';
  let thinkTimer: ReturnType<typeof setTimeout> | null = null;

  const rawSend = (event: AgentEvent): void => {
    try {
      getWebContents()?.send('kdx:agent-event', event);
    } catch {
      /* window destroyed — nothing to send to */
    }
    // v11.7 — SADEEM Remote: mirror EVERY agent event to the phone feed so the
    // mobile UI renders exactly what the desktop renders, live. The mirror is
    // inside its own guard — a remote failure can never touch the run.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      (require('../services/remoteService') as typeof import('../services/remoteService')).remoteBroadcast(event);
    } catch {
      /* remote layer unavailable — desktop run is unaffected */
    }
    // v2.2 — wire the (previously dead) approval-needed desktop notification:
    // when an approval_request event is emitted, ping the user once per
    // pending requestId. best-effort; never blocks the run.
    if (event.type === 'approval_request' && !notifiedApprovals.has(event.requestId)) {
      notifiedApprovals.add(event.requestId);
      try {
        notifyApprovalNeeded(event.title || 'Surnia — approval needed');
      } catch {
        /* notifications are best-effort */
      }
    }
  };

  /** Drain the pending text buffer as one text_delta (cancels the timer). */
  const flushDeltas = (): void => {
    if (deltaTimer) {
      clearTimeout(deltaTimer);
      deltaTimer = null;
    }
    if (!deltaBuf) return;
    const text = deltaBuf;
    deltaBuf = '';
    rawSend({ type: 'text_delta', text });
  };

  /** v11.3 — drain the thinking buffer as one think_delta. */
  const flushThink = (): void => {
    if (thinkTimer) {
      clearTimeout(thinkTimer);
      thinkTimer = null;
    }
    if (!thinkBuf) return;
    const text = thinkBuf;
    thinkBuf = '';
    rawSend({ type: 'think_delta', text });
  };

  const send = (event: AgentEvent): void => {
    if (event.type === 'text_delta') {
      deltaBuf += event.text;
      if (!deltaTimer) deltaTimer = setTimeout(flushDeltas, DELTA_FLUSH_MS);
      return;
    }
    if (event.type === 'think_delta') {
      // v11.3 — separate buffer: reasoning and answer never share a channel.
      thinkBuf += event.text;
      if (!thinkTimer) thinkTimer = setTimeout(flushThink, DELTA_FLUSH_MS);
      return;
    }
    flushDeltas(); // pending text always lands before any structural event
    flushThink(); // pending reasoning always lands before any structural event
    rawSend(event);
  };

  // v11.4 — MCP elicitation approvals ride the SAME coalescing bridge as
  // engine events: pending text/think buffers flush BEFORE the approval card
  // lands, so the card can no longer precede the last <=16ms of stream text.
  setAgentEventSink(send);

  const resolveAllDecisions = (decision: PermissionDecision | null): void => {
    for (const [id, resolve] of [...decisions]) {
      decisions.delete(id);
      notifiedApprovals.delete(id); // the pending approval is gone — reset
      try {
        resolve(decision);
      } catch {
        /* ignore */
      }
    }
  };

  const io: AgentIO = {
    send,
    getDecision: (requestId) =>
      new Promise<PermissionDecision | null>((resolve) => {
        const timer = setTimeout(() => {
          decisions.delete(requestId);
          resolve(null); // timeout → deny
        }, DECISION_TIMEOUT_MS);
        decisions.set(requestId, (d) => {
          clearTimeout(timer);
          resolve(d);
        });
      }),
    isAborted: () => aborted,
    onFetchSignal: (cb) => {
      signalCbs.push(cb);
      if (signalCbs.length > MAX_TRACKED_SIGNAL_CBS) signalCbs.splice(0, signalCbs.length - MAX_TRACKED_SIGNAL_CBS);
      // The controller for this run already exists — hand it over immediately.
      if (controller) cb(controller.signal);
    },
  };

  // ---------- kdx:agent:run ----------
  // (handle/invoke pair — the renderer awaits these calls)
  gated('kdx:agent:run', async (_e, raw: unknown) => {
    try {
      // v11.22 — ONE settings snapshot: the honest default model for repair AND
      // the provider credentials injected below. Never reject on this read.
      let settingsSnapshot: AppSettings | undefined;
      try {
        settingsSnapshot = getSettings();
      } catch {
        /* engine has its own settings fallbacks */
      }

      // HARDENED BOUNDARY — repair before judging. `raw` may be undefined, a
      // legacy partial payload, a string model, or an empty messages array.
      const repaired = await normalizeRunParams(raw, {
        defaultModel: settingsSnapshot?.model,
        lastUserMessage: async (sid) => {
          try {
            return lastRealUserText((await sessions.load(sid))?.messages) ?? null;
          } catch {
            return null;
          }
        },
      });

      if (!repaired.params) {
        // v11.22 — canonical i18n key `err.run.badParams` (A9). The main process
        // has no t(): pick ONE language from the shared monolingual pair using
        // the settings language, and carry the precise machine reason on `code`.
        // No vague text and never a mixed EN+AR string.
        const lang = settingsSnapshot?.language;
        const badParams = RUN_ERROR_TEXT.badParams;
        const message = localize(badParams, lang);
        send({ type: 'error', message, code: repaired.code });
        // v11.12 (C1-CLOSURE) — every terminal path reports; a bare error+turn_end
        // left the run with no summary card.
        send({
          type: 'task_report',
          outcome: 'error',
          summary: message,
          files: [],
          commands: [],
          nextSteps: [lang === 'ar' ? badParams.nextAr : badParams.nextEn],
          durationMs: 0,
        } as AgentEvent);
        send({ type: 'turn_end' });
        return;
      }
      const params = repaired.params;

      // ---------- plan gate (billingService.checkGate) — THE single source of
      // truth for plan limits: PLANS.free.limits.dailyRuns (50/day) is enforced
      // here against usageLog. v2.2 removed the old local FREE_DAILY_RUN_LIMIT=15
      // duplicate that contradicted the billing plan catalog.
      // Not allowed → surface the plan reason as an error event and DO NOT run.
      try {
        const runGate = checkGate('run');
        if (!runGate.allowed) {
          send({ type: 'error', message: runGate.reason ?? 'Your plan does not allow this run. Check Plans & Billing.' });
          // v11.12 (C1-CLOSURE) — plan-gate refusals report too.
          send({
            type: 'task_report',
            outcome: 'error',
            summary: `Run not started — plan gate: ${runGate.reason ?? 'plan limit reached'}.`,
            files: [],
            commands: [],
            nextSteps: ['Check Plans & Billing for limits, or upgrade the plan, then send again.'],
            durationMs: 0,
          } as AgentEvent);
          send({ type: 'turn_end' });
          return;
        }
      } catch {
        /* billing unavailable — never block a run over it */
      }

      // ONE active run: abort the previous one first.
      if (active) {
        aborted = true;
        try {
          controller?.abort();
        } catch {
          /* ignore */
        }
        resolveAllDecisions({ requestId: '', action: 'deny' });
      }

      aborted = false;
      active = true;
      controller = new AbortController();
      for (const cb of signalCbs) {
        try {
          cb(controller.signal);
        } catch {
          /* ignore */
        }
      }

      // ---------- credential injection (THE fix for "my API key is not used") ----------
      // The engine's last-resort fallback used a fragile require() path. Instead,
      // the main process — the single owner of settings.json — injects the
      // decrypted provider credentials into the params right here, so the
      // request ALWAYS carries the key the user saved.
      try {
        // v11.22 — reuse the snapshot taken for model repair (no second read).
        const s = settingsSnapshot;
        if (s) {
          params.providers = s.providers;
          if (s.memory && !params.memory) params.memory = s.memory;
        }
      } catch {
        /* settings unavailable — the engine still tries its fallbacks */
      }

      // v10.2 — plugins: MCP servers contributed by ENABLED plugins join the run
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const plugins = require('../services/pluginService') as { enabledPluginMcpServers?: () => unknown[] };
        const extra = (plugins.enabledPluginMcpServers?.() ?? []) as NonNullable<typeof params.mcpServers>;
        if (extra.length) params.mcpServers = [...(params.mcpServers ?? []), ...extra];
      } catch {
        /* plugin layer is an enhancement — never blocks a run */
      }

      // v11.4 — capture this run's token FIRST: from here on, every event the
      // still-unwinding aborted run emits is silently dropped at the gate.
      const myRunToken = ++runTokenSeq;
      const runIo: AgentIO = {
        ...io,
        // Superseded run → drop its events (the drain below already flushed
        // whatever had accumulated up to this point).
        send: (event) => {
          if (myRunToken === runTokenSeq) io.send(event);
        },
      };

      // Drain the PREVIOUS run's coalesced tail — text AND reasoning — before
      // the new run starts; nothing stale is inherited, nothing leaks after.
      flushDeltas();
      flushThink();
      // v11.7 — SADEEM Remote: the phone mirrors THIS session now (title +
      // workspace come from the persisted record; async but ordered by use).
      try {
        const sid = String(params.sessionId ?? '');
        void sessions
          .load(sid)
          .then((sd) =>
            remoteSetActiveSessionSafe(sid, sd?.title ?? '', params.workspace ?? ''),
          )
          .catch(() => remoteSetActiveSessionSafe(sid, '', params.workspace ?? ''));
      } catch {
        /* remote layer unavailable */
      }
      runAgent(params, runIo)
        .catch((err) => {
          // runAgent handles its own errors; this is a last-resort guard.
          runIo.send({ type: 'error', message: errorText(err) });
          // v11.12 (C1-CLOSURE) — the last-resort catch reports as well.
          runIo.send({
            type: 'task_report',
            outcome: 'error',
            summary: `Run crashed before its report: ${(errorText(err)).slice(0, 300)}`,
            files: [],
            commands: [],
            nextSteps: ['Partial state is untouched — send a follow-up message to retry the task.'],
            durationMs: 0,
          } as AgentEvent);
          runIo.send({ type: 'turn_end' });
        })
        .finally(() => {
          // A superseded run's unwinding must not clobber the newer run's
          // bridge state (active flag, controller, pending decisions).
          if (myRunToken !== runTokenSeq) return;
          // Desktop notification when the run ends while the user is elsewhere.
          try {
            notifyAgentDone('Surnia', 'Agent run finished', { enabled: isDoneNotificationsEnabled() });
          } catch {
            /* notifications must never break the run */
          }
          active = false;
          controller = null;
          decisions.clear();
        });
    } catch (err) {
      active = false;
      controller = null;
      send({ type: 'error', message: errorText(err) });
      send({ type: 'turn_end' });
    }
  });

  // ---------- kdx:agent:abort ----------
  gated('kdx:agent:abort', () => {
    aborted = true;
    try {
      controller?.abort();
    } catch {
      /* ignore */
    }
    resolveAllDecisions({ requestId: '', action: 'deny' });
  });

  // ---------- kdx:agent:approval ----------
  gated('kdx:agent:approval', (_e, d: PermissionDecision) => {
    if (!d || typeof d !== 'object' || typeof d.requestId !== 'string') return;
    // v11.31 — validate the ACTION as well as the id. The engine switches on
    // `action`; an unknown value previously resolved a pending approval with
    // garbage (silently treated as deny, with no honest reason). Ignore it so
    // the real approval card can still be answered correctly.
    if (typeof d.action !== 'string' || !PERMISSION_DECISION_ACTIONS.includes(d.action)) return;
    const resolve = decisions.get(d.requestId);
    if (resolve) {
      decisions.delete(d.requestId);
      notifiedApprovals.delete(d.requestId); // resolved — allow future pings
      resolve(d);
    }
  });

  // ============================================================
  // v2.1 — engine surface: plan approval / steer / task mode /
  // review run / recap / skills
  // ============================================================

  // ---------- kdx:agent:plan-approve (plan approval contract) ----------
  gated(
    'kdx:agent:plan-approve',
    (_e, sessionId: string, choice: 'auto' | 'manual' | 'revise', feedback?: string) => {
      const id = String(sessionId ?? '');
      const c = choice === 'auto' || choice === 'manual' || choice === 'revise' ? choice : 'revise';
      applyPlanApproval(id, c, typeof feedback === 'string' ? feedback : undefined);
      return { ok: true, choice: c };
    },
  );

  // ---------- kdx:agent:steer (STEER semantics — inject at next tool boundary) ----------
  gated('kdx:agent:steer', (_e, sessionId: string, text: string) => {
    const n = steer(String(sessionId ?? ''), String(text ?? ''));
    return { ok: true, n };
  });

  // ---------- kdx:agent:queue-send (normal queue kept alongside steer) ----------
  gated('kdx:agent:queue-send', (_e, sessionId: string, text: string) => {
    const n = enqueueUserMessage(String(sessionId ?? ''), String(text ?? ''));
    return { ok: true, n };
  });

  // ---------- kdx:agent:task-mode (build | plan | debug | review) ----------
  gated('kdx:agent:task-mode', (_e, sessionId: string, taskMode: TaskMode) => {
    const id = String(sessionId ?? '');
    setSessionTaskMode(id, taskMode);
    return { ok: true, taskMode: getSessionTaskMode(id) };
  });

  // ---------- kdx:agent:review-run (Agent Review over the working diff) ----------
  gated('kdx:agent:review-run', async (_e, sessionId: string) => {
    const id = String(sessionId ?? '');
    try {
      const data = await sessions.load(id);
      const s = getSettings();
      const ws = data?.workspace || s.recentPaths?.[0] || '';
      if (!ws) {
        // v11.22 — canonical i18n key `err.setup.noWorkspace` (A9), one language.
        return {
          ok: false,
          findings: [],
          error: localize(RUN_ERROR_TEXT.noWorkspace, s.language),
        };
      }
      const model = s.model;
      const entry = s.providers?.[model.provider];
      const res = await reviewWorkingDiff(ws, {
        model,
        apiKey: typeof entry?.apiKey === 'string' ? entry.apiKey : undefined,
        baseUrl: typeof entry?.baseUrl === 'string' ? entry.baseUrl : undefined,
      });
      if (res.ok) send({ type: 'review_findings', findings: res.findings, summary: res.summary });
      return res;
    } catch (err) {
      return { ok: false, findings: [], error: errorText(err) };
    }
  });

  // ---------- kdx:agent:recap (template markdown, no model call) ----------
  gated('kdx:agent:recap', async (_e, sessionId: string) => {
    const id = String(sessionId ?? '');
    try {
      const data = await sessions.load(id);
      if (!data) return { ok: false, error: 'SESSION_NOT_FOUND' };
      const goal = getSessionGoal(id).goal;
      return { ok: true, markdown: buildSessionRecap(data, goal, ENGINE_VERSION) };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  });

  // ---------- kdx:agent:skills-list / kdx:agent:skill-delete (skill factory) ----------
  gated('kdx:agent:skills-list', (_e, workspace: string) => listSkills(String(workspace ?? '')));
  gated('kdx:agent:skill-delete', async (_e, workspace: string, slug: string) => {
    const ok = await deleteSkill(String(workspace ?? ''), String(slug ?? ''));
    return { ok };
  });

  // ---------- v6 — Repo Wiki (generate / get) ----------
  // SECURITY (v6 audit M-1) + v11.38 FIX: the renderer may only wiki a
  // workspace the app actually knows. The OLD gate accepted ONLY recentPaths,
  // but the renderer sets wsPath immediately while recentPaths is persisted
  // asynchronously — a valid open workspace was silently nulled by wiki:get.
  // The shared helper also accepts a real project-looking directory so a
  // stale/failed settings write can no longer blank the panel. Sender trust is
  // enforced by `gated` above; the scanner skips secrets and is bounded.
  const isKnownWorkspace = (ws: string): boolean => {
    try {
      return isAllowedWikiWorkspace(ws, getSettings().recentPaths ?? []);
    } catch {
      return isAllowedWikiWorkspace(ws, []);
    }
  };
  gated('kdx:wiki:generate', async (_e, workspace: string, language?: 'ar' | 'en') => {
    const ws = String(workspace ?? '');
    if (!isKnownWorkspace(ws)) return { ok: false, error: 'Workspace is not open in Surnia.' };
    try {
      const s = getSettings();
      const model = s.model;
      const entry = s.providers?.[model.provider];
      const creds = {
        apiKey: typeof entry?.apiKey === 'string' ? entry.apiKey : undefined,
        baseUrl: typeof entry?.baseUrl === 'string' ? entry.baseUrl : undefined,
      };
      const res = await generateWiki(ws, {
        language: language === 'ar' || language === 'en' ? language : s.language === 'ar' ? 'ar' : 'en',
        model,
        creds,
        onStage: (stage, detail) => {
          try {
            send({ type: 'wiki_stage', stage, detail });
          } catch {
            /* renderer may be gone */
          }
        },
      });
      return res;
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  });
  gated('kdx:wiki:get', (_e, workspace: string) => {
    const ws = String(workspace ?? '');
    if (!isKnownWorkspace(ws)) {
      // Honest failure instead of a silent null the panel cannot explain.
      return { wiki: null, stale: false, generating: false, error: 'This folder is not open in Surnia. Open it first.' };
    }
    return getWiki(ws);
  });

  // ============================================================
  // v6.1 — Import from other agents (ZCode parity): skills and
  // MCP servers found in rival coding tools on THIS machine.
  // ============================================================
  gated('kdx:rivals:skills', async () => {
    try {
      return await detectRivalSkills();
    } catch {
      return [];
    }
  });
  gated('kdx:rivals:skills-import', async (_e, workspace: string, srcRoot: string, scope: string) => {
    // SECURITY (v6 audit M-2): srcRoot must be one of the DETECTED rival roots
    // — a compromised renderer must not be able to bulk-copy arbitrary disk
    // directories into the (trust-exempt) global skills scope.
    try {
      const roots = await detectRivalSkills();
      const wanted = path.resolve(String(srcRoot ?? ''));
      if (!roots.some((r) => path.resolve(r.root) === wanted)) {
        return { imported: 0, failed: 0 };
      }
      return await importAllSkillsFrom(
        String(workspace ?? ''),
        String(srcRoot ?? ''),
        scope === 'global' ? 'global' : 'workspace',
      );
    } catch {
      return { imported: 0, failed: 0 };
    }
  });
  gated('kdx:rivals:mcp', async () => {
    try {
      return await detectRivalMcpServers();
    } catch {
      return [];
    }
  });
}
