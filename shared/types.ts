// ============================================================
// Surnia — shared types (single source of truth)
// Used by both the Electron main process and the React renderer.
// ============================================================

// ---------- Providers & models ----------
export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'ollama'
  | 'gemini'
  | 'zai'
  | 'deepseek'
  | 'xai'
  | 'moonshot'
  | 'qwen'
  | 'mistral'
  | 'custom';

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  baseUrl: string;
  protocol: 'anthropic' | 'openai';
  keyless?: boolean;
  /** Curated fallback list shown before a live fetch succeeds. */
  models: string[];
  keyHint?: string;
}

/** Per-provider credentials + cached live model list (persisted in settings.json). */
export interface ProviderEntry {
  apiKey?: string;
  baseUrl?: string;
  /** v11.10 (A8) — user intent: the provider card's Enable toggle. */
  enabled?: boolean;
  /** Live model IDs fetched from the provider's API — newest first. */
  lastModels?: string[];
  /** Epoch ms of the last successful model fetch. */
  fetchedAt?: number;
  /** v11.10 (A8) — honest per-provider warning when the last auto-fetch
   *  failed (MODEL_LIST_UNAVAILABLE). Saved WITH the provider, never a
   *  global validation failure. */
  lastModelWarning?: string;
}

export interface ModelConfig {
  provider: ProviderId;
  model: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * Per-model reasoning effort (v1138) — the model's OWN named stop, NOT a
   * global standard/deep knob. Exact wire values come from shared/effort.ts:
   * GPT `minimal|low|medium|high`, o-series `low|medium|high`,
   * Claude `none|low|medium|high` (→ thinking.budget_tokens), GLM `low|high|max`,
   * generic `off|low|medium|high`. `off`/undefined = no reasoning field on the wire.
   * Kept as `string` so a provider-added stop never needs a type release.
   */
  reasoning?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /**
   * v7 — provider cache split (optional). The providers attach these to their
   * runtime usage (see UsageWithCache in electron/agent/providers.ts) and they
   * ride the IPC JSON into the renderer, which accumulates them on sessionUsage
   * to drive the status-bar context + cache chip.
   */
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /**
   * v11.10 (A5) — honesty marker: true ⇒ these figures are a chars/4 estimate
   * (the provider reported no usage) or an engine-side reconstruction, NOT the
   * provider's exact report. The UI renders an "≈" marker next to every
   * estimated number and never presents a precise-looking fake.
   */
  estimated?: boolean;
  /**
   * v11.10 (A5) — per-ATTEMPT breakdown for the whole user turn (all model
   * calls the run made, including failed/retried/failover attempts that still
   * burned billed tokens). Rides the message_end payload; the Usage tab shows
   * the honest multi-attempt cost instead of only the surviving attempt.
   */
  attempts?: UsageAttempt[];
  /**
   * v11.10 (A5) — cumulative RUN totals (all continuation/fix rounds + all
   * attempts of this user turn). Optional ride-alongs on message_end; the
   * per-message billing rows use these (they are the real money), while the
   * context bar keeps using the per-turn DELTA fields above (the final
   * prompt size is the true window occupancy).
   */
  runInput?: number;
  runOutput?: number;
  runCost?: number;
  runCacheRead?: number;
  runCacheCreation?: number;
}

/** v11.10 (A5) — one model call attempt's honest usage attribution. */
export interface UsageAttempt {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** true ⇒ chars/4 estimate (provider never reported usage for this attempt). */
  estimated?: boolean;
}

// ---------- Chat transcript ----------
export type ChatRole = 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  kind?: 'text' | 'tool_call' | 'tool_result' | 'notice';
  content: string; // text, or JSON-string of tool args for kind==='tool_call'
  toolName?: string;
  toolCallId?: string;
  resultOk?: boolean; // for tool_result
  timestamp: number;
  model?: string;
  usage?: Usage;
  streaming?: boolean;
  /** Image attachments (data URLs or file paths) for vision-capable models. */
  images?: string[];
  /** v11.3 — live reasoning stream (think_delta), rendered in the dedicated
   *  thinking block instead of being interleaved with the answer. */
  thinking?: string;
  /** v11.3 — notice chip class for kind==='notice' rows (verify/critic/...). */
  noticeKind?: string;
}

export type TodoItem = {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
};

// ---------- Agent events (main -> renderer) ----------
// v3.1 — 'question' is the ask_user tool: a structured user question with
// optional choice buttons (payload.choices). The decision arrives as
// { action: 'answer', value: <chosen text or typed answer> }.
/** v7.3 — 'mcp_elicitation' is an MCP elicitation/create request (a server
 *  asking the USER for structured input), surfaced through the same approval
 *  card as tool approvals. */
export type ApprovalKind = 'write' | 'command' | 'mcp' | 'delete' | 'doom_loop' | 'question' | 'mcp_elicitation';

export interface ApprovalPayload {
  path?: string;
  oldText?: string;
  newText?: string;
  command?: string;
  cwd?: string;
  toolName?: string;
  /** v2.2 — set for MCP tools whose annotations mark them destructive. */
  destructive?: boolean;
  /** v3.1 — ask_user: selectable choices rendered as buttons by the UI. */
  choices?: string[];
  /** v3.1 — ask_user: when true the UI also offers a free-text answer field. */
  allowText?: boolean;
  /** v7.3 — mcp_elicitation: owning MCP server id. */
  serverId?: string;
  /** v7.3 — mcp_elicitation: the server's request message (also mirrored in event.detail). */
  elicitationMessage?: string;
  /** v7.3 — mcp_elicitation: requestedSchema — JSON schema of the fields the server expects. */
  elicitationSchema?: unknown;
}

// ---------- v2.2 Surnia DNA — the persistent, self-updating user model ----------

/** One durable learned pattern (command / workflow / style / correction). */
export interface DNAPattern {
  id: string;
  kind: 'command' | 'workflow' | 'style' | 'correction';
  text: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  /** 0-1; repetition bumps it: min(0.95, 0.4 + 0.15 × count). */
  confidence: number;
}

export interface DNAFeedbackEntry {
  ts: number;
  kind: 'praise' | 'correction' | 'preference';
  note: string;
  context?: string;
}

export interface DNAProfile {
  name?: string;
  role?: string;
  expertise: string[];
  languages: string[];
  likes: string[];
  dislikes: string[];
  styleNotes: string[];
}

export interface DNAData {
  version: 1;
  profile: DNAProfile;
  patterns: DNAPattern[];
  feedback: DNAFeedbackEntry[];
  stats: { sessionsObserved: number; factsRecorded: number; updatedAt: number };
}

/** One cross-session recall hit (recall_memory tool). */
export interface DNARecallHit {
  sessionId: string;
  sessionTitle: string;
  timestamp: number;
  /** Best-matching window, ≤300 chars, '…'-ellipsized. */
  excerpt: string;
  score: number;
}

/** Push event on the `kdx:dna:event` channel (UI panels + suggestion chips). */
export interface DNAEvent {
  type: 'updated' | 'refined' | 'suggestion' | 'skills-trust';
  payload?: Record<string, unknown>;
}

// ---------- v11.12 — Living Memory / Adaptive Playbook ----------
export type PlaybookSectionKey = 'worked' | 'failed' | 'preferences' | 'recipes';

export interface PlaybookItem {
  id: string;
  text: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  source?: string;
}

export interface PlaybookData {
  version: number;
  workspace: string;
  updatedAt: number;
  worked: PlaybookItem[];
  failed: PlaybookItem[];
  preferences: PlaybookItem[];
  recipes: PlaybookItem[];
  lastLearned: string;
  sessionsObserved: number;
}

export interface PlaybookChange {
  section: PlaybookSectionKey;
  action: 'added' | 'reinforced' | 'removed';
  text: string;
}

export interface PlaybookRevision {
  version: number;
  ts: number;
  sessionId?: string;
  summary: string;
  changes: PlaybookChange[];
  snapshot: string;
}

/** Structured patch a run distills into the playbook. */
export interface PlaybookUpdate {
  worked?: string[];
  failed?: string[];
  preferences?: string[];
  recipes?: string[];
  learned?: string;
  sessionId?: string;
}

export interface PlaybookEvent {
  type: 'learned' | 'cleared';
  payload?: { version?: number; summary?: string; changes?: number };
}

// ---------- v11.12 — Subagent dashboard ----------
export type SubagentStatus = 'running' | 'done' | 'error' | 'aborted';

/**
 * v11.36 (CHILD-SESSION) — ONE real tool call observed inside a subagent's own
 * session. This is the "جلسة جوا الجلسة" transcript the founder asked for:
 * a step-by-step list of what the child agent ACTUALLY did.
 *
 * HONESTY CONTRACT: every field is populated ONLY from a real engine IPC event
 * (`tool_start` / `tool_result` / `subagent_progress.step`). The renderer NEVER
 * invents a tool name, argument, output or status. Fields that the engine does
 * not stream (e.g. output on an in-flight call) stay absent, never fabricated.
 */
export interface SubagentToolCall {
  /** Stable id that pairs a start with its result and dedupes streamed repeats. */
  toolCallId?: string;
  /** Real tool name from the engine event — never guessed by the UI. */
  name: string;
  /** Verbatim args string from the engine — never synthesised. */
  input?: string;
  /** Verbatim tool output from the engine — never synthesised. */
  output?: string;
  /** Lifecycle from real events: 'running' until the real result arrives. */
  status: 'running' | 'done' | 'error';
  /** Epoch ms carried by the engine event, not a UI-generated timestamp. */
  at: number;
}

export interface SubagentRecord {
  id: string;
  label: string;
  role: string;
  description: string;
  prompt: string;
  status: SubagentStatus;
  done: number;
  total: number;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  workspace: string;
  /** Parent session link — the main session whose `task` tool launched this child. */
  sessionId: string;
  background: boolean;
  attempt: number;
  summary?: string;
  error?: string;
  /**
   * v11.36 — ADDITIVE, real per-agent tool-call transcript. Legacy ledger rows
   * (and older preload IPC) simply omit it; the child-session view then shows
   * an honest empty state instead of inventing a feed. Every entry is written
   * ONLY by the engine's real `subagent_toolcall` event / real progress label.
   */
  toolCalls?: SubagentToolCall[];
}

export interface SubagentEvent {
  type: 'started' | 'progress' | 'finished' | 'failed' | 'aborted' | 'cleared' | 'retried' | 'tool' | 'toolcall';
  record?: SubagentRecord;
  /** v11.36 — for `toolcall`: the owning subagent's ledger id. */
  id?: string;
  /** v11.36 — for `toolcall`: the REAL observed tool call (`call` alias too). */
  toolCall?: SubagentToolCall;
  call?: SubagentToolCall;
}

/**
 * The renderer-facing shape of a real `subagent_progress` engine event.
 * Named (instead of inlined in the AgentEvent union) so the engine, the IPC
 * bridge and the store accumulator all agree on ONE definition.
 */
export interface SubagentProgressEvent {
  type: 'subagent_progress';
  id: string;
  label: string;
  done: number;
  total: number;
  pct?: number;
  /** Real short action label emitted by the engine (e.g. `tool:read_file`). */
  step?: string;
  /** v11.36 — optional REAL tool call carried on the same progress event. */
  toolCall?: SubagentToolCall;
}

// ---------- v2.1 — plans / review / skills / debug task mode ----------

/** A structured implementation plan submitted via the propose_plan tool. */
export interface AgentPlan {
  title: string;
  steps: string[];
  risks?: string[];
}

/** User decision on a submitted plan (kdx:agent:plan-approve). */
export type PlanApprovalChoice = 'auto' | 'manual' | 'revise';

/** Session task mode — shapes the system-prompt protocol (debug/review postures). */
export type TaskMode = 'build' | 'plan' | 'debug' | 'review';

/** v11.12 — advertised tool set. Executors are NEVER removed; only the tools[]
 *  list sent to the model changes. Mirrors electron/agent/tool-defs.ts. */
export type ToolProfile = 'essential' | 'balanced' | 'full';

/** One structured code-review finding (review.ts / review_diff tool). */
export interface ReviewFinding {
  severity: 'critical' | 'major' | 'minor' | 'nit';
  file: string;
  line?: number;
  note: string;
}

/** A reusable workspace skill (.surnia/skills/<slug>/SKILL.md). */
export interface SkillInfo {
  slug: string;
  name: string;
  description: string;
  path: string;
  /** v5 — where the skill lives: workspace overrides global overrides built-in. */
  scope?: 'workspace' | 'global' | 'builtin';
}

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  /** v11.3 — model reasoning streams on its OWN channel: never touches the
   *  answer text, renders inside the dedicated thinking block. */
  | { type: 'think_delta'; text: string }
  /** v11.3 — harness notices (gates, verifiers, compaction, progress) ride a
   *  dedicated run-deduped channel: they NEVER interleave with the answer. */
  | { type: 'sys_notice'; kind: string; text: string }
  /**
   * v12 (CONTINUITY) — a pure liveness pulse emitted during silent engine work
   * (compaction, retry backoff, approval waits). It carries NO text and NEVER
   * touches the transcript; the renderer only uses it to reset its watchdog so
   * a healthy-but-quiet engine is never misreported as a disconnect.
   */
  | { type: 'heartbeat'; phase?: string }
  | { type: 'tool_start'; toolCallId: string; name: string; args: unknown }
  | {
      type: 'tool_result';
      toolCallId: string;
      ok: boolean;
      output: string;
      meta?: Record<string, unknown>;
    }
  | { type: 'message_end'; usage?: Usage; stopReason?: string }
  | { type: 'turn_end' }
  /** v11.22 — `message` is a SINGLE localized string (one language only);
   *  `code` carries the precise machine reason so the renderer can re-localize
   *  or log it without string-matching the human text. */
  | { type: 'error'; message: string; code?: RunErrorCode }
  | {
      type: 'approval_request';
      requestId: string;
      kind: ApprovalKind;
      title: string;
      detail: string;
      payload: ApprovalPayload;
    }
  | { type: 'todo'; todos: TodoItem[] }
  | { type: 'compaction_done'; summary: string }
  | {
      type: 'plan_ready';
      plan: string;
      /** v2.1 — set when the plan came from the propose_plan tool (or a plan-mode run). */
      sessionId?: string;
      title?: string;
      steps?: string[];
      risks?: string[];
    }
  | {
      type: 'preview_open';
      url?: string;
      ws?: string;
      /**
       * v11.11 (A3) — universal live preview: the engine's completion hook
       * describes WHAT to preview (a dev-server runtime, a static dir, or a
       * single artifact file) when a run just wrote runnable files. The
       * renderer turns it into an auto-start preview request. Optional — the
       * existing preview tools emit `preview_open` without it and keep working.
       */
      previewHint?: {
        kind: 'dev' | 'static' | 'artifact';
        dir?: string;
        runtime?: 'npm' | 'python' | 'custom' | 'go';
        label?: string;
      };
    }
  | { type: 'goal_progress'; goal: string; pct: number; note?: string }
  | { type: 'goal_done'; goal: string }
  | { type: 'queued_count'; n: number }
  | { type: 'background_done'; label: string; summary: string }
  | { type: 'aborted' }
  // ---------- v2.1 engine events ----------
  /** A steered user message was injected at a tool boundary (visible note). */
  | { type: 'steer_injected'; text: string }
  /** Same tool call (name+args) fired 3× consecutively — engine paused for a user decision. */
  | { type: 'doom_loop'; tool: string; count: number }
  /** Engine-run project verification after a burst of edits. */
  | { type: 'verify_run'; cmd: string; exitCode: number; outputTail: string }
  /** Structured review findings (review_diff tool / kdx:agent:review-run). */
  | { type: 'review_findings'; findings: ReviewFinding[]; summary?: string }
  /** v11.12 (A4-GUARANTEE) — engine → renderer task-mode sync: a /slash mode
   *  switch updates the strip so the UI always shows the mode that will run. */
  | { type: 'task_mode'; taskMode: TaskMode }
  /** A new reusable skill was extracted and saved to .surnia/skills. */
  | { type: 'skill_created'; name: string; slug?: string }
  /** v2.1 transcript compaction with context-window percentages. */
  | { type: 'compaction'; before: number; after: number }
  /** Live background-subagent progress (progress bar in the UI). */
  | SubagentProgressEvent
  /**
   * v11.36 (CHILD-SESSION) — a REAL tool call observed inside a subagent's own
   * loop, emitted by electron/agent/subagents.ts on `kdx:subagents:event`.
   * `call` carries only values the engine actually observed — no placeholders.
   */
  | { type: 'subagent_toolcall'; id: string; call: SubagentToolCall }
  // ---------- v2.2 Surnia DNA (the closed learning loop) ----------
  /** The persistent user model changed (extraction / feedback / dna_note). */
  | { type: 'dna_updated'; reason?: 'extraction' | 'feedback' | 'note' | 'clear' | 'playbook' }
  /** v11.12 — the Living Playbook learned something after this run (toast + UI). */
  | { type: 'playbook_learned'; summary: string; version: number; sessionId?: string }
  /** A durable workflow pattern matured — the engine suggests turning it into a skill. */
  | { type: 'dna_suggestion'; kind: 'skill'; patternId: string; text: string }
  /** A workspace skill was refined by the skill-writer after a failed/weak run. */
  | { type: 'skill_refined'; name: string; version?: number }
  // ---------- v6 Apex: verifier / critic / receipt ----------
  /** The goal verifier confirmed completion from real evidence (goal not yet cleared here). */
  | { type: 'goal_verified'; goal: string }
  /** Adversarial critic verdict on the working diff (fullAccess runs, ≥3 files). */
  | { type: 'critic_verdict'; findings: number; critical: number; summary?: string }
  /** End-of-run proof-of-work receipt (files, commands + exit status, rounds). */
  | { type: 'run_receipt'; files: string[]; commands: { cmd: string; ok: boolean }[]; rounds: number; verifyFailed: boolean; durationMs: number }
  /** v7 — claim→evidence audit of the final report (unevidenced claims flagged). */
  | { type: 'claim_audit'; summary: string; unsupported: number; claims: { claim: string; kind: string; supported: boolean }[] }
  /** v7 — mutation check verdict: do the agent's tests actually test something? */
  | { type: 'mutation_check'; honest: boolean | null; detail: string }
  // ---------- v7.1 Proven Change: the gates + the package ----------
  /** Mutation gate on the CHANGED lines: kill-rate verdict with survivors. */
  | { type: 'mutation_gate'; verdict: string; inconclusive?: boolean; ran: number; killed: number; killRate: number; detail: string }
  /** Deterministic fake-test detector findings (runs before the critic). */
  | { type: 'fake_tests'; scanned: number; high: number; summary: string; findings: { file: string; line: number; rule: string; severity: string; note: string }[] }
  /** Harness-enforced red→green verdict (from the recorded test ledger). */
  | { type: 'red_green'; compliant: boolean; reason: string }
  /** The signed, re-runnable proof package (PROOF card v2). */
  | { type: 'proof_package'; id: string; file: string; verdict: string; markdown: string }
  /** False-Done Rate stats after a run (the published honesty metric). */
  | { type: 'false_done'; claimed: number; falseDone: number; rate: number }
  /** Verification-budget state (429s refunded — never consumed). */
  | { type: 'budget_state'; label: string }
  /** Taint escalation notice: untrusted sources force a command approval. */
  | { type: 'taint_escalation'; why: string; classes: string[]; sources: string[] }
  | { type: 'role_route'; role: string; agent: string; provider: string; model: string; reason: string }
  /** Poison-scan findings on untrusted content (repo/web/mcp/skill). */
  | { type: 'taint_notice'; origin: string; kind: string; findings: { rule: string; label: string; line: number | null }[] }
  /** v6 — Repo Wiki generation pipeline stage. */
  | { type: 'wiki_stage'; stage: 'scan' | 'catalog' | 'pages' | 'save'; detail?: string }
  // ---------- v11.11 (A4) completion guarantee ----------
  /**
   * Final structured run summary — emitted ONCE on EVERY terminal path
   * (completed / aborted / error, including failover-exhausted and
   * watchdog-recovered runs) right before turn_end. Evidence-driven
   * (files touched, commands executed), with how-to-verify and next steps,
   * so a run can never "end and say nothing".
   */
  | {
      type: 'task_report';
      outcome: 'completed' | 'error' | 'aborted';
      summary: string;
      files: string[];
      commands: { cmd: string; ok: boolean }[];
      /** Detected project verify/test command (when any) — the "how to run". */
      howToRun?: string;
      nextSteps: string[];
      /** v11.12 (A4-REPORT) — per-tool usage: what the run ACTUALLY used. */
      toolsUsed?: { name: string; count: number; ok: number; fail: number }[];
      /** v11.12 (A4-REPORT) — open todos at run end: what was NOT done. */
      notDone?: string[];
      /** v11.12 (A4-REPORT) — run usage totals (input/output/cost). */
      usage?: { inputTokens: number; outputTokens: number; costUsd: number };
      /** v11.12 (A4-REPORT) — true when work happened but the run did not complete. */
      partial?: boolean;
      /** v11.12 (A4-REPORT) — the task mode the run executed in (non-build only). */
      taskMode?: 'plan' | 'debug' | 'review';
      /** Underlying agent-loop stop reason when one exists ('end_turn', 'time_cap', 'error'…). */
      stopReason?: string;
      durationMs: number;
    };

// ---------- v2 scheduling / goals / worktrees ----------

/** One persisted scheduled agent job (cron-style, runs the agent headless). */
export interface ScheduleJob {
  id: string;
  name: string;
  prompt: string;
  workspace: string;
  /** 5-field cron (min hour dom mon dow) or one of @hourly @daily @weekly. */
  cron: string;
  enabled: boolean;
  /**
   * v2.2 — permission ceiling for headless runs of this job. 'read' → review
   * task mode + default permission mode (fully read-only posture); 'autoEdit'
   * (default) → file edits auto-approved, commands ask (headless auto-deny);
   * 'fullAccess' → everything auto-approved. Jobs saved before v2.2 without a
   * mode are MIGRATED to 'autoEdit' on load.
   */
  mode?: 'read' | 'autoEdit' | 'fullAccess';
  model?: ModelConfig;
  createdAt: number;
  lastRun?: number;
  lastStatus?: 'ok' | 'error' | 'running';
  lastMessage?: string;
  /** Session id of the most recent run (for opening the transcript). */
  sessionId?: string;
  /**
   * v7.1 — TRIGGERS beyond the cron clock. 'file-watch' fires when the path
   * changes; 'webhook' fires on POST /trigger/<jobId>?token=… (loopback only);
   * 'ci-failure' polls `gh run list` and fires when the latest run failed.
   * The cron field still acts as the polling cadence / fallback.
   */
  trigger?: {
    kind: 'cron' | 'file-watch' | 'webhook' | 'ci-failure';
    /** file-watch: file or directory to watch. ci-failure: owner/repo. */
    path?: string;
  };
  // v11.38 (F3) — server-exact scheduling telemetry (the panel uses these
  // instead of a second, disagreeing client-side cron matcher).
  nextRun?: number;
  lastFireSlot?: number;
  lastError?: string;
  consecutiveErrors?: number;
  runCount?: number;
  lastDurationMs?: number;
  lastEvent?: { seq?: number; status?: string; at: number; message?: string; type?: string };
}

/** A git worktree created for isolated parallel agent work. */
export interface WorktreeInfo {
  name: string;
  path: string;
  branch: string;
  createdAt: number;
  dirty?: boolean;
}

export interface PermissionDecision {
  requestId: string;
  action:
    | 'allow'
    | 'deny'
    | 'always'
    | 'always_session'
    | 'always_project'
    | 'never'
    | 'never_always'
    | 'answer';
  /** v3.1 — ask_user answer; v6 — also an EDITED rule scope for always/never. */
  value?: string;
}

export type PermissionMode = 'plan' | 'default' | 'autoEdit' | 'fullAccess';

// ---------- v11.10 — approvals manager (Settings → Approvals) ----------
/** One persisted "always allow" / "always reject" rule (approval-rules.json). */
export interface ApprovalRuleEntry {
  /** ruleKey — 'cmd:npm install' | 'write' | 'mcp:toolName' | 'delete' … */
  key: string;
  /** The command (or tool/title) the decision was made on. */
  command: string;
  ts: number;
  /** true = always-allow rule, false = always-reject (deny) rule. */
  allow: boolean;
}

/** All rules recorded for ONE workspace hash. */
export interface ApprovalRuleGroup {
  /** Resolved workspace path when known, else the raw hash. */
  workspace: string;
  workspaceHash: string;
  rules: ApprovalRuleEntry[];
}

export interface ApprovalsListResult {
  groups: ApprovalRuleGroup[];
  total: number;
  /** Store file path (allow rules) — shown in the UI for transparency. */
  file: string;
}

/**
 * v11.36 — these ids select a specialist PERSONALITY / prompt role, NOT a
 * capability tier. Every id receives the FULL tool registry (145 tools + MCP +
 * provider-native) through agents.ts + subagentRunner.ts; there is no
 * "read-only" or tool-restricted specialist any more.
 */
export type SubagentId =
  | 'explore'
  | 'web-research'
  | 'spec'
  | 'architect'
  | 'implement'
  | 'test'
  | 'review'
  | 'refactor'
  | 'security'
  | 'devops'
  | 'docs'
  | 'debugger'
  | 'perf'
  | 'data'
  /** v2.1 — extracts a reusable SKILL.md from a completed session transcript. */
  | 'skill-writer'
  | 'general';

export interface AgentRunParams {
  task: 'chat' | 'compact' | 'init';
  sessionId: string;
  messages: ChatMessage[];
  model: ModelConfig;
  mode: PermissionMode;
  workspace: string;
  memory?: string;
  mcpServers?: MCPServerConfig[];
  /** v2.1 — session task mode ('build' default). IPC kdx:agent:task-mode overrides per session. */
  taskMode?: TaskMode;
  /** Credential injection (main process). Renderer does not send these. */
  apiKey?: string;
  baseUrl?: string;
  providers?: Partial<Record<ProviderId, ProviderEntry>>;
}

/**
 * v11.22 — LOOSE input shape accepted at the `kdx:agent:run` IPC boundary.
 *
 * The renderer, the phone bridge, flows and the local API server do not always
 * build a complete `AgentRunParams`: a scheduled/remote caller may send only a
 * `text`/`prompt`, a model as the string `"provider/model"`, or no `messages`
 * array at all. The bridge must pass ALL of that through untouched; the MAIN
 * process is the single place that validates and REPAIRS it into the strict
 * `AgentRunParams` the engine expects (see `normalizeRunParams` in
 * `electron/agent/register.ts`).
 *
 * Deliberately permissive: unknown extra keys are allowed and `messages` is
 * `unknown` so the main side can inspect/repair malformed arrays itself.
 */
export interface AgentRunParamsInput {
  task?: AgentRunParams['task'];
  sessionId?: string;
  messages?: unknown;
  /** Either a full ModelConfig or a `"provider/model"` string. */
  model?: ModelConfig | string | Partial<ModelConfig> | null;
  mode?: PermissionMode;
  workspace?: string;
  /** Plain-text prompt used to synthesize a user message when messages are absent. */
  text?: string;
  prompt?: string;
  message?: string;
  memory?: string;
  mcpServers?: MCPServerConfig[];
  taskMode?: TaskMode;
  apiKey?: string;
  baseUrl?: string;
  providers?: AgentRunParams['providers'];
  [key: string]: unknown;
}

// ---------- v11.22 — honest, monolingual failure text for the main process ----------
// The main process has no `t()`. These are EXACT copies of the canonical
// [en, ar] strings owned by src/i18n.ts (A9) for the keys the main side emits.
// A caller emits ONLY ONE language per event — never a mixed EN+AR string.
// Keeping them here (shared) means the renderer can also read them by key if
// it later wants to re-localize a structured `code`.
export const RUN_ERROR_TEXT = {
  badParams: {
    en: 'Run not started — the request had no messages or no model selected. Open Settings → AI providers, choose a model, and send your message again.',
    ar: 'لم يبدأ التشغيل — الطلب بلا رسائل أو دون اختيار نموذج. افتح الإعدادات ← مزودو الذكاء الاصطناعي، اختر نموذجاً، ثم أعد إرسال رسالتك.',
    nextEn: 'Open Settings → AI providers, choose a model, and send your message again.',
    nextAr: 'افتح الإعدادات ← مزودو الذكاء الاصطناعي، اختر نموذجاً، ثم أعد إرسال رسالتك.',
  },
  noWorkspace: {
    en: 'No workspace is open. Open a project folder first, then send your message again.',
    ar: 'لا توجد مساحة عمل مفتوحة. افتح مجلد مشروع أولاً، ثم أعد إرسال رسالتك.',
  },
} as const;

/** Machine-readable reason accompanying a localized `error` event message. */
export type RunErrorCode = 'NO_PARAMS' | 'BAD_SHAPE' | 'NO_MODEL' | 'NO_USER_MESSAGE';

/**
 * v11.31 — runtime value sets for the IPC boundary. The main-process bridge
 * (`electron/agent/register.ts`) uses these to CLAMP loose caller input to the
 * only values the engine understands. Keeping them here (next to the types)
 * means the renderer, the main process and the phone/flows/API callers all
 * agree on what a valid permission mode, task mode or decision action is — a
 * bogus value is replaced by a safe default instead of reaching `runAgent`.
 */
export const PERMISSION_MODES: readonly PermissionMode[] = ['plan', 'default', 'autoEdit', 'fullAccess'];
export const TASK_MODES: readonly TaskMode[] = ['build', 'plan', 'debug', 'review'];
export const PERMISSION_DECISION_ACTIONS: readonly PermissionDecision['action'][] = [
  'allow', 'deny', 'always', 'always_session', 'always_project', 'never', 'never_always', 'answer',
];

// ---------- MCP ----------
export type MCPTransport = 'stdio' | 'http' | 'sse';

export interface MCPServerConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  /** v1.3 — transport kind (stdio default). */
  transport?: MCPTransport;
  /** v1.3 — remote URL for http/sse transports. */
  url?: string;
  /** v1.3 — HTTP headers for http/sse transports. */
  headers?: Record<string, string>;
  /** v1.3 — probe/start timeout in ms (default 10000). */
  timeoutMs?: number;
  /** v1.3 — retry the connection automatically after a failure. */
  autoReconnect?: boolean;
  /** v1.3 — tool invocation counter (persisted). */
  calls?: number;
  /**
   * v3.1 — working directory for the stdio spawn (default: inherit).
   * Supports a `${workspace}` placeholder resolved at spawn time.
   */
  cwd?: string;
  /**
   * v7.3 — per-server tool ALLOW list: exact tool names or glob patterns
   * (`*` = any run, `?` = one char; matched case-insensitively). Empty or
   * absent = every tool is allowed. DENY WINS over allow.
   */
  toolAllow?: string[];
  /**
   * v7.3 — per-server tool DENY list (same matching rules as toolAllow).
   * A denied tool is filtered out of mcpListTools (never reaches
   * getToolDefs) and its calls are refused in mcpCallTool.
   */
  toolDeny?: string[];
  /** Optional link to the curated catalog entry this server was added from (UI logo lookup). */
  catalogId?: string;
}

export interface MCPToolInfo {
  name: string;
  description?: string;
  /** v1.3 — JSON schema of the tool input, when the server provides one. */
  inputSchema?: unknown;
  /** v1.3 — owning server id (filled by the registry). */
  serverId?: string;
}

export interface MCPServerStatus {
  id: string;
  name: string;
  state: 'connected' | 'connecting' | 'disconnected' | 'disabled' | 'error';
  error?: string;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  latencyMs?: number;
  lastCheckedAt?: number;
}

export interface MCPResourceInfo {
  serverId: string;
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPromptInfo {
  serverId: string;
  name: string;
  description?: string;
  arguments?: { name: string; description?: string; required?: boolean }[];
}

export interface MCPResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

/** One-click MCP server presets (curated registry, v1.3). */
export interface MCPRegistryPreset {
  id: string;
  name: string;
  description: string;
  category: string;
  transport: MCPTransport;
  command?: string;
  args?: string[];
  url?: string;
  /** Env-var NAMES the user must fill (values left empty). */
  env?: Record<string, string>;
  docsUrl?: string;
}

export interface MCPServersResult {
  servers: MCPServerStatus[];
  presets: MCPRegistryPreset[];
  totalTools: number;
}

// ---------- Filesystem ----------
export interface FileNode {
  name: string;
  path: string; // absolute
  type: 'file' | 'dir';
  children?: FileNode[];
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

// ---------- Git ----------
export interface GitChange {
  path: string; // relative to repo root
  status: string; // M | A | D | ?? | R...
  staged: boolean;
}

export interface GitStatus {
  isRepo: true;
  branch: string;
  changed: GitChange[];
}

export interface GitDiff {
  path: string;
  patch: string;
}

export interface GitLogEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
}

// ---------- Terminal ----------
export interface TerminalOutputEvent {
  terminalId: string;
  data: string;
}

// ---------- v11.13 — one-shot command run (backing /test in the composer) ----------
/**
 * Result of `kdx:cmd:run`: a real child-process execution with a REAL exit
 * code (no heuristics, no invented verdicts). `ok` is true iff the process
 * exited with code 0. Output is capped in the main process; `timedOut` is set
 * when the command exceeded its deadline.
 */
export interface CommandRunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  cmd: string;
  cwd: string;
  ms: number;
  timedOut?: boolean;
  error?: string;
}

// ---------- Settings ----------
export interface UsageLogEntry {
  date: string; // YYYY-MM-DD
  runs: number;
  tokens: number;
  costUsd: number;
}

/**
 * v11.23 (FAILOVER-DEFAULTS) — single source of truth for the automatic
 * cross-provider failover opt-in. The founder's standing demand is
 * "no auto provider switching / failover OFF by default / no noisy 429".
 *
 * This is a *literal* false: consumers MUST treat only `=== true` as an
 * opt-in (a string "true", 1, or any other truthy value is NOT consent).
 * `storeService` uses it for fresh/migrated/imported defaults and `router`
 * uses it as the safe fallback when settings are absent.
 */
export const ALLOW_MODEL_FAILOVER_DEFAULT = false as const;

// ---------- v1142 — subagent concurrency limit (single source of truth) ----------
/**
 * The founder's standing rule: «الوكلاء ما عنده حد معين» — subagents must not
 * feel artificially capped — BUT the user must be able to say HOW MANY agents
 * may run at once from Settings → Agent. v1142 makes that a REAL persisted
 * setting instead of a hardcoded engine constant.
 *
 * HONESTY CONTRACT: this is a bounded ceiling (1…64), NOT "unlimited".
 * The DEFAULT stays at the legacy generous ceiling (64) so existing sessions
 * keep their "no set limit" posture; a user can lower it to any value in 1…64.
 * A corrupt/hand-edited value is clamped — never trusted as-is — so a bad
 * settings.json can never spawn an unbounded number of subagents.
 */
export const MAX_SUBAGENTS_DEFAULT = 64 as const;
export const MAX_SUBAGENTS_MIN = 1 as const;
export const MAX_SUBAGENTS_CEILING = 64 as const;

/** Clamp ANY (possibly corrupt) subagent-limit value into [1, 64].
 *  Non-numeric / NaN / fractional values repair to the sane default. */
export function clampMaxSubagents(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return MAX_SUBAGENTS_DEFAULT;
  return Math.max(MAX_SUBAGENTS_MIN, Math.min(MAX_SUBAGENTS_CEILING, Math.floor(n)));
}

export interface AppSettings {
  language: 'ar' | 'en';
  /** v7.2 — 'follow' resolves via prefers-color-scheme; 'high' = high-contrast.
   *  Legacy ids ('soft'/'obsidian'/'midnight'/'light') stay first-class. */
  theme: 'soft' | 'obsidian' | 'midnight' | 'light' | 'follow' | 'high';
  /** v7.2 — digit rendering for numeric badges/dates in the Arabic UI. */
  numerals?: 'western' | 'arabic';
  permissionMode: PermissionMode;
  model: ModelConfig;
  providers: Partial<Record<ProviderId, ProviderEntry>>;
  fontSize: number;
  terminalFontSize: number;
  autoApproveEdits: boolean;
  checkpointsEnabled: boolean;
  onboardingDone: boolean;
  localOnly?: boolean; // user chose "continue without an account"
  /** v11.6 — last version whose What's-New card the user dismissed. */
  lastSeenVersion?: string;
  onboardingStep?: number;
  recentPaths: string[];
  mcpServers: MCPServerConfig[];
  /** Global user memory — injected into every agent run, combined with workspace MEMORY.md. */
  memory?: string;
  /** Ghost-text inline completions in the editor (Cursor/Copilot-class). */
  inlineSuggestions?: boolean;
  /** Minimize to the system tray instead of closing. */
  closeToTray?: boolean;
  /** OS notification when the agent finishes while the window is unfocused. */
  doneNotifications?: boolean;
  billing: {
    stripePaymentLink?: string;
    licenseEndpoint?: string;
    /** v11.4 — Stripe secret key (sk_test_…/sk_live_…). Stored like provider
     *  keys: encrypted at rest via safeStorage in storeService. */
    stripeSecretKey?: string;
  };
  /** Local HTTP control API (OpenCode-server / Claude-SDK class). */
  apiServer?: { enabled?: boolean; port?: number; token?: string };
  /** v11.7 — SADEEM Remote: control the desktop agent from a real phone over
   *  LAN/hotspot (QR pairing, live transcript, send/steer, approvals, abort).
   *  v11.36 — `host` is an OPTIONAL manual LAN-IPv4 override. Auto-detection can
   *  pick a VirtualBox/WSL/Docker adapter the phone cannot route to; setting
   *  this to the real Wi-Fi IP makes the QR/LAN URL deterministic. Empty/unset
   *  = auto-detect (prefer physical Wi-Fi/Ethernet over virtual adapters). */
  remote?: { enabled?: boolean; port?: number; token?: string; host?: string };
  usageLog: UsageLogEntry[];
  /** v10.2 — voice input (mic) preferences. 'auto' = the active provider's ASR route. */
  voice?: {
    /** 'auto' (active provider) | 'off' | openai | groq | zai | zhipu | <custom provider id> */
    asrProvider?: string;
    /** Explicit ASR model id — overrides the per-family preset (whisper-1 / whisper-large-v3 / glm-asr-2512). */
    asrModel?: string;
    /** v11.4 — BCP-47 language hint for the transcription request (default 'en-US'). */
    language?: string;
    /** v11.4 — send the transcript automatically when dictation finishes. */
    autoSend?: boolean;
    /** v11.4 — preferred microphone (enumerateDevices audioinput id; '' = system default). */
    deviceId?: string;
  };
  /** v11 — auto-update preferences (generic feed, user-owned). */
  updates?: {
    feedUrl?: string;
    autoCheck?: boolean;
  };
  /** v1.3 — live preview defaults. */
  preview?: {
    autoDetect?: boolean;
    deviceFrame?: boolean;
    console?: boolean;
    autoRefresh?: boolean;
    zoom?: number;
    /** v10.3 — custom dev-server command for ANY runtime (Go, Rust, PHP, Rails…)
        run from the workspace root; http(s) URL + port are auto-detected. */
    customCommand?: string;
  };
  /** v1.3 — agent engine tuning. */
  agent?: {
    maxTurns?: number;
    promptCaching?: boolean;
    parallelToolCalls?: boolean;
    maxRetries?: number;
    autoCompact?: boolean;
    compactThreshold?: number;
    /** v1.5 — long-task engine discipline (in-engine, not a separate mode). */
    continueAuto?: boolean;       // keep working across the per-turn step budget
    maxContinueRounds?: number;   // continuation budget (each round = full step budget)
    verifyCommand?: string;       // engine-run verification after edits (build/test/typecheck)
    effort?: 'standard' | 'deep'; // deep = 2× steps + thinking-first directive
    /**
     * v1138 — the ENGINE-side named effort value carried between the chat
     * control / model picker and the request builders. `agent.effort` above is
     * the unrelated step-budget multiplier; this one is the model's own stop
     * (e.g. `minimal`, `high`, `max`). HANDOFF: engine.ts/store.ts must read
     * this when composing the model config (see docs/EFFORT-PER-MODEL-V1138.md).
     */
    reasoningEffort?: string;
    /** v2.1 — engine-run verify after ≥3 consecutive edits in autoEdit/fullAccess (default ON). */
    autoVerify?: boolean;
    /** v2.1 — when true, danger-classified commands skip the ALWAYS-ask gate (default false). */
    allowDangerousCommands?: boolean;
    /** v5 — post-run auto-learning into MEMORY.md + DNA (default ON). */
    autoMemory?: boolean;
    /** v6 — adversarial critic gate on trusted-mode runs with ≥3 files touched (default ON). */
    criticGate?: boolean;
    /** v7 — per-step model roles (multi-provider router). Unset roles fall back to the session model. */
    modelRoles?: Partial<Record<'plan' | 'search' | 'edit' | 'verify' | 'context', { provider: string; model: string }>>;
    /** v7 — verifier posture: 'fail-open' (default, legacy) or 'fail-closed' (high-stakes: verifier failure = NOT verified). */
    verifierMode?: 'fail-open' | 'fail-closed';
    /** v7 — network allowlist for run_command (hostnames; empty = no restriction). */
    networkAllowlist?: string[];
    /** v7.1 — mutation gate on changed lines: threshold (kill rate) and budget. */
    mutationGate?: { enabled?: boolean; threshold?: number; maxMutations?: number };
    /** v7.1 — verification budget: gate verdicts per run + USD cap. 429/5xx attempts are refunded. */
    verificationBudget?: { maxGateCalls?: number; maxGateUsd?: number };
    /** v7.1 — strict per-run spend ceiling, USD (0/absent = unlimited). */
    taskBudgetUsd?: number;
    /** v7.1 — OS-level isolation profile for run_command (fail-closed when unavailable). */
    isolation?: { profile?: 'none' | 'docker' | 'wsl' | 'winsandbox'; networkMode?: 'none' | 'bridge' };
    /** v7.1 — taint-aware approvals (default ON): untrusted content forces explicit approval for dangerous commands. */
    taintAware?: boolean;
    /** v7.1 — impact-driven verification (default ON): run only tests that exercise the changed files. */
    impactVerify?: boolean;
    /** v12 — tool profile advertised to the model. 'essential' ≈ 30 core tools,
     *  'balanced' (default) = most tools, 'full' = all 134. Executors are NEVER
     *  removed — only what is advertised to the model changes. */
    toolProfile?: ToolProfile;
    /** v11.19 — allow automatic cross-provider failover. DEFAULT OFF
     *  (see {@link ALLOW_MODEL_FAILOVER_DEFAULT}): the user's chosen
     *  provider/model is attempted alone; the app never silently switches
     *  providers when one is slow or returns 429/402/401. Opt in ONLY with a
     *  strict boolean `true`; any other value is treated as OFF. Configure
     *  multiple credentialed providers first. Read fresh — never cache this
     *  flag across settings snapshots. */
    allowModelFailover?: boolean;
  };
  /** v1.3 — UI behaviour. */
  ui?: {
    reduceMotion?: boolean;
    compact?: boolean;
    /** v2.3 — Liquid Glass intensity: off / soft / medium (default) / strong. */
    glassLevel?: 'off' | 'soft' | 'medium' | 'strong';
    /** v2.3 — ambient aurora backdrop behind windows (signature depth). */
    ambientGlow?: boolean;
    /** v2.3 — accent color override for the glass tint. */
    accent?: 'sage' | 'teal' | 'clay' | 'amber';
    /** v2.3 — transcript measure: comfortable (default) / wide / full. */
    chatWidth?: 'cozy' | 'wide' | 'full';
    /** v2.3 — animation speed multiplier (0.5 = half, 1 = normal, 1.5 = slow). */
    motionSpeed?: number;
    /** v2.4 — persisted left-sidebar width in px (drag-resizable, 240–520). */
    sidebarWidth?: number;
    /** v2.4 — Liquid Glass v7 specular edge highlights on chrome (default true). */
    specularEdges?: boolean;
    /** v7.2 — global UI zoom factor (0.9–1.25, step .05) applied as --zoom-factor. */
    zoom?: number;
    /** v7.2 — chrome density: 'comfortable' (default) | 'compact' → data-density. */
    density?: 'comfortable' | 'compact';
  };
  /** v2.1 — interactive terminal command guard (E4). Default 'on'. */
  terminalGuard?: 'on' | 'warn-only' | 'off';
  /** v11.4 — editor behaviours persisted for real (EditorArea wires Monaco options). */
  editor?: {
    /** Monaco word wrap. Default 'off' (legacy behaviour). */
    wordWrap?: 'off' | 'on';
    /** Indent width offered by the editor. Default 2. */
    tabSize?: 2 | 4 | 8;
    /** Minimap visibility — the editor toolbar toggle syncs to this field. */
    minimap?: boolean;
    /** Editor font size in px, 10–22 (falls back to the global fontSize). */
    fontSize?: number;
    /** Indent guides render. Default true. */
    indentGuides?: boolean;
  };
  /** v11.4 — interactive terminal spawn preferences (terminalService reads them). */
  terminal?: {
    /** Shell the integrated terminal spawns. 'default' follows the OS
     *  (cmd.exe on Windows, /bin/bash elsewhere). */
    shell?: 'default' | 'powershell' | 'pwsh' | 'cmd' | 'bash' | 'wsl';
    /** Terminal scrollback budget in lines (1000–50000); scales the main-process stream cap. */
    scrollback?: number;
  };
  /** v11.4 — diagnostics log (Settings → Logs): the main-process file logger filters by level. */
  logs?: {
    level?: 'debug' | 'info' | 'warn' | 'error';
  };
  /** v11.4 — rebindable keyboard shortcuts: action id → binding ('Ctrl+Shift+K'). */
  shortcuts?: Record<string, string>;
  /**
   * v12 — OPTIONAL real embeddings for semantic_search (offline hasher by default).
   * When enabled, uses the configured provider's OpenAI-compatible /embeddings.
   */
  embeddings?: {
    enabled?: boolean;
    provider?: ProviderId;
    model?: string;
    dims?: number;
    batchSize?: number;
    timeoutMs?: number;
  };
  /** v1.3 — cached subscription state (written by billingService). */
  planState?: SubscriptionState;
  /** v2.2 — Surnia DNA learning loop master switch (default true). */
  dnaEnabled?: boolean;
  /**
   * v2.2 — workspace skills trust gate. 'ask' (default) → skills in a
   * workspace WITHOUT a .surnia/skills-trusted marker are NOT injected and a
   * consent event is emitted; 'always' → always inject; 'never' → never
   * inject. Same trust model as hooks (hooks-trusted marker).
   */
  trustWorkspaceSkills?: 'ask' | 'always' | 'never';
  /**
   * v1142 — MAX CONCURRENT SUBAGENTS (the founder's "user picks the number"
   * setting). Applies to BACKGROUND / parallel subagents in one session.
   * Default {@link MAX_SUBAGENTS_DEFAULT} = 64, legal range 1…64
   * ({@link MAX_SUBAGENTS_CEILING} is the HARD safety ceiling — never higher).
   * Absent / corrupt values are repaired by {@link clampMaxSubagents}.
   * This is deliberately honest: it is a real ceiling, not "unlimited".
   */
  maxSubagents?: number;
}

// ---------- Local accounts (stored on this device) ----------
export interface AccountInfo {
  id: string;
  email: string;
  name: string;
  plan: 'free' | 'pro' | 'team';
  createdAt: number;
}

export type AuthError =
  | 'name_required'
  | 'email_invalid'
  | 'email_taken'
  | 'password_short'
  | 'password_mismatch'
  | 'no_account'
  | 'wrong_password'
  | 'web_account'
  | 'guest_expired'
  | 'storage_failed';

export interface AuthResult {
  ok: boolean;
  account?: AccountInfo;
  /** v11.6 — guest pass: days remaining when the result is a guest session. */
  daysLeft?: number;
  error?: AuthError;
}

/** v11.6 — GUEST PASS state (device-level trial clock, survives restarts). */
export interface GuestPassStatus {
  /** epoch ms of the FIRST skip — the clock never resets on re-skip. */
  startedAt: number | null;
  /** whole days left (0 when expired). */
  daysLeft: number;
  /** true once the pass window has fully elapsed. */
  expired: boolean;
  /** true when a guest session is currently open on this device. */
  active: boolean;
  /** the configured pass length in days (7). */
  ttlDays: number;
}

// ---------- v11.6 Prompt Library ----------
export interface PromptItem {
  id: string;
  name: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

// ---------- Clone progress ----------
export interface CloneProgress {
  step: 'git' | 'done' | 'error';
  message: string; // raw renderer-side status text
  done: number;
  total: number;
  projectPath?: string;
  error?: string;
}

export interface CloneOptions {
  url: string;
  destDir: string; // absolute path of the parent folder
  name?: string; // optional folder name (defaults to repo name)
  branch?: string;
}

// ---------- Sessions ----------
export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  workspace?: string;
  /** v10.2 — Codex-style: this chat RUNS INSIDE a git worktree (name+path+branch). */
  worktree?: { name: string; path: string; branch: string };
  model?: string;
  messageCount: number;
  totalTokens: number;
  totalCostUsd: number;
}

export interface SessionData extends SessionMeta {
  messages: ChatMessage[];
  todos: TodoItem[];
}

// ---------- Licensing / SaaS ----------
export interface LicenseState {
  plan: 'free' | 'pro' | 'team';
  licensedTo?: string;
  activatedAt?: number;
  mode: 'local';
  /** License expiry (epoch ms). Absent = perpetual. */
  expiresAt?: number;
  /** Team seats included in the license. */
  seats?: number;
  /** Pro-trial end (epoch ms) — set on first launch. */
  trialUntil?: number;
  /** Where this license came from: offline key / remote endpoint / trial. */
  source?: 'local' | 'remote' | 'trial' | 'legacy';
  email?: string;
}

// ---------- Checkpoints ----------
export interface CheckpointInfo {
  id: string;
  label: string;
  at: number;
  fileCount: number;
}

// ---------- Live preview ----------
export interface PreviewDevStatus {
  running: boolean;
  state: 'idle' | 'starting' | 'ready' | 'stopped' | 'error';
  url?: string;
  script?: string;
  lines: string[];
  startedAt?: number;
  agentUrls?: string[];
  /** v8: per-source cwd — the renderer pins the preview to the ACTIVE workspace. */
  agentSources?: Array<{ url: string; cwd: string; id: string; command: string }>;
}

export interface PreviewStaticStatus {
  running: boolean;
  url?: string;
  root?: string;
}

export interface PreviewStartResult {
  ok: boolean;
  url?: string;
  root?: string;
  script?: string;
  error?: string;
}

export interface PreviewStatusResult {
  dev: PreviewDevStatus;
  static: PreviewStaticStatus;
  ports: number[];
}

// ---------- App performance metrics ----------
export interface AppMetrics {
  cpuPercent: number;
  memoryMB: number;
  processes: number;
  pid: number;
  uptimeSec: number;
  platform: string;
  hostMemTotalMB: number;
  hostMemFreeMB: number;
  hostCpuLoad: number;
}

// ---------- UI ----------
export interface OpenTab {
  path: string;
  content: string;
  original: string;
  dirty: boolean;
}

export interface DiffViewRequest {
  title: string;
  path: string;
  oldText: string;
  newText: string;
  patch?: string; // unified patch display mode (e.g. git diff)
  approvalRequestId?: string; // when set, Approve/Deny resolves a pending agent approval
  readOnly?: boolean;
}

// ---------- Editor AI (one-shot completions without the agent loop) ----------
export interface AiCompleteParams {
  prompt: string;
  context?: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  model?: ModelConfig;
  signal?: { aborted: boolean };
}

export interface AiCompleteResult {
  ok: boolean;
  text?: string;
  error?: string;
}

// ---------- Billing & subscription (v1.3) ----------
export type PlanId = 'free' | 'pro' | 'team';

export interface PlanLimits {
  /** Agent runs per day (absent = unlimited). */
  dailyRuns?: number;
  /** Total tokens per month (absent = unlimited). */
  monthlyTokens?: number;
  /** MCP servers connected at once. */
  maxMcpServers?: number;
  /** Device-control tools allowed. */
  deviceTools?: boolean;
  /** Parallel tool calls in the agent loop. */
  parallelToolCalls?: boolean;
  /** Subagent spawning. */
  subagents?: boolean;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceUsd: number;
  blurb: string;
  features: string[];
  limits: PlanLimits;
  highlight?: boolean;
  /** v2.3 — false = purchasable-but-paused (payment gateway offline). UI shows
   *  "not active right now" and checkout is disabled; limits still granted. */
  available?: boolean;
}

/** Global promo state — v2.3 FREE SEASON: everything unlocked, paid checkout paused. */
export interface PromoState {
  freeSeason: boolean;
  message?: string;
}

export interface SubscriptionState {
  plan: PlanId;
  status: 'trialing' | 'active' | 'canceled' | 'past_due';
  trialDaysLeft?: number;
  renewsAt?: number;
  startedAt?: number;
  seats?: number;
  coupon?: string;
}

export interface UsagePoint {
  label: string;
  runs: number;
  tokens: number;
  costUsd: number;
}

export interface BillingOverview {
  subscription: SubscriptionState;
  plans: PlanDefinition[];
  paymentLink?: string;
  usage: UsagePoint[];
  license: LicenseState;
  /** v2.3 — free-season banner data (undefined = no promo). */
  promo?: PromoState;
}

export interface CouponResult {
  ok: boolean;
  message: string;
  percentOff?: number;
}

// ---------- Custom slash commands ----------
export interface SlashCommandInfo {
  name: string;
  description?: string;
  source: 'workspace' | 'user';
  path: string;
}

// ---------- v2.5 Flows (named reusable prompts) ----------

/** One saved Flow — a named, reusable prompt (global or workspace-scoped). */
export interface Flow {
  id: string;
  name: string;
  prompt: string;
  scope: 'global' | 'workspace';
  createdAt: number;
  lastRun?: number;
  runCount: number;
}

/** v2.5 — Flows store summary (kdx:flows:info). */
export interface FlowsInfo {
  globalCount: number;
  workspaceCount: number;
  hitsTracked: number;
}

// ---------- v10.2 Plugins (installable capability packs) ----------

/**
 * One installed plugin. A plugin is a small JSON manifest (plus optional
 * bundled skill folders) that can contribute: MCP server configs, workspace
 * skills, and slash-prompt commands. Installed under
 * <userData>/plugins/<id>/plugin.json — enabled flag lives inside.
 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  /** Sadeem engine version this plugin was validated against (informational). */
  engineVersion?: string;
  enabled: boolean;
  installedAt: number;
  source: 'builtin' | 'file' | 'url';
  /** MCP servers this plugin contributes (merged at run time when enabled). */
  mcpServers?: MCPServerConfig[];
  /** Slash commands: /name expands to prompt text (merged with slashService). */
  prompts?: { name: string; description?: string; prompt: string }[];
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  enabled: boolean;
  source: PluginManifest['source'];
  installedAt: number;
  mcpCount: number;
  promptCount: number;
  /** Directory under userData/plugins (main-side path, for reveal). */
  dir: string;
}

// ---------- v10.2 Library (cross-session artifact gallery) ----------

export type LibraryKind = 'image' | 'document' | 'download' | 'export' | 'file';

/** One indexed artifact produced anywhere in SADEEM (any session, any tool). */
export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  title: string;
  path: string;
  createdAt: number;
  size?: number;
  sessionId?: string;
  /** Where the item came from (tool or service name). */
  origin?: string;
}
