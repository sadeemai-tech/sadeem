// Renderer-side typed bridge to the Electron main process (window.surnia).
import type {
  AgentEvent,
  AgentRunParams,
  AgentRunParamsInput,
  AiCompleteParams,
  AiCompleteResult,
  AppMetrics,
  SlashCommandInfo,
  PlanApprovalChoice,
  TaskMode,
  ReviewFinding,
  SkillInfo,
  MCPRegistryPreset,
  AppSettings,
  ApprovalKind,
  AccountInfo,
  AuthError,
  AuthResult,
  CheckpointInfo,
  CloneOptions,
  DNAData,
  DNAEvent,
  DNARecallHit,
  PlaybookData,
  PlaybookEvent,
  PlaybookRevision,
  PlaybookUpdate,
  SubagentEvent,
  SubagentRecord,
  FileNode,
  Flow,
  FlowsInfo,
  GitDiff,
  GitLogEntry,
  GitStatus,
  LicenseState,
  MCPServerConfig,
  MCPToolInfo,
  MCPServerStatus,
  MCPResourceInfo,
  MCPPromptInfo,
  MCPResourceContent,
  MCPServersResult,
  PlanId,
  PlanDefinition,
  BillingOverview,
  CouponResult,
  SubscriptionState,
  ModelConfig,
  PermissionDecision,
  ApprovalsListResult,
  PreviewStartResult,
  PreviewStatusResult,
  ProviderId,
  CloneProgress,
  SearchHit,
  SessionData,
  SessionMeta,
  TerminalOutputEvent,
  CommandRunResult,
} from '../../shared/types';

// ---------- v2.1 / E4 shared bridge types (mirrors electron/preload.ts) ----------

/** One MCP server health entry (v2 health monitor). */
export interface McpHealthEntry {
  id: string;
  name?: string;
  state?: 'connected' | 'connecting' | 'disconnected' | 'disabled' | 'error';
  toolCount?: number;
  latencyMs?: number;
  error?: string;
  lastCheckedAt?: number;
}

/** One recorded MCP tool invocation (v2 call log). */
export interface McpCallLogEntry {
  id: string;
  serverId?: string;
  serverName?: string;
  tool: string;
  ok: boolean;
  ms?: number;
  at: number;
  error?: string;
  argsSummary?: string;
}

/** Security/privacy subsystem status (E4). */
export interface SecStatusInfo {
  terminalGuard?: 'on' | 'warn-only' | 'off';
  blockedCommands?: number;
  auditCount?: number;
  [key: string]: unknown;
}

/** One security audit-log row (E4). */
export interface SecAuditEntry {
  at: number;
  kind: string;
  detail?: string;
  [key: string]: unknown;
}

/** Terminal command blocked by the interactive guard (E4). */
export interface TermBlockedEvent {
  cmd: string;
  reasons: string[];
  terminalId?: string;
}

/** Terminal command flagged (warn-only mode) by the guard (E4). */
export interface TermWarnEvent {
  cmd: string;
  reasons?: string[];
  terminalId?: string;
}

/** Filesystem write blocked by the workspace sandbox (E4). */
export interface FsBlockEvent {
  path: string;
  op?: string;
  reason?: string;
}

/** Generic security audit event (E4). */
export interface SecurityEvent {
  kind: string;
  detail?: string;
  at?: number;
  [key: string]: unknown;
}

/** Status reported by the local API server service (main process). */
export interface RemoteStatus {
  running: boolean;
  enabled: boolean;
  port: number;
  url?: string;
  tokenMasked: string;
  qrDataUrl?: string;
  lanAddress?: string;
  error?: string;
  // v11.36 (D11) — phone pairing health, surfaced by RemoteSection.
  pairingExpiresAt?: number;
  /** Each LAN adapter with reachability metadata (matches remoteService.LanCandidate). */
  lanCandidates?: { address: string; iface: string; kind: 'wifi' | 'wired' | 'other' | 'virtual'; usable: boolean }[];
  reachable?: boolean;
  errorCode?: string;
}

export interface ApiServerStatus {
  running: boolean;
  port: number;
  token: string;
  baseUrl: string;
  error?: string;
  startedAt?: number;
  requests: number;
}

/** v2.2 — Surnia DNA stats payload (kdx:dna:stats). */
export interface DnaStatsInfo {
  sessionsObserved: number;
  patterns: number;
  feedback: number;
  growth: { date: string; count: number }[];
  /** v11.35 — cumulative facts learned (the real "never stops" number). */
  factsRecorded?: number;
  /** Active-window ceiling; patterns shown are the ACTIVE, not total, set. */
  patternCap?: number;
  atCap?: boolean;
}

/** v2.2 — DNA pattern/feedback edit request (kdx:dna:update). */
export interface DnaUpdateRequest {
  section: 'profile' | 'patterns' | 'feedback';
  /** pattern id, or the feedback ts/note when section === 'feedback'. */
  id?: string;
  /** Profile patch / pattern patch / {kind, note} — omit to REMOVE an entry by id. */
  patch?: Record<string, unknown>;
  workspace?: string;
}

/** v12 — one portable profile: settings + DNA + authored skills + prompts. */
export interface SadeemProfile {
  format: 'sadeem-profile';
  version: number;
  exportedAt: string;
  appVersion: string;
  settings: AppSettings;
  dna: DNAData;
  skills: { slug: string; name: string; description: string; body: string; scope: 'global' | 'workspace' }[];
  prompts: import('../../shared/types').PromptItem[];
}

/** v12 — result of restoring a profile. */
export interface ProfileImportResult {
  ok: boolean;
  error?: string;
  settings?: boolean;
  dna?: boolean;
  skills?: number;
  prompts?: number;
}

/** v2.3 — result of the standalone HTML session export (kdx:session:export). */
export interface SessionExportHtmlResult {
  ok: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

/** v2.3 — whisper transcription result (kdx:session:transcribe). */
export interface TranscribeResult {
  ok: boolean;
  text?: string;
  error?: string;
}

/** v12 — one entry in the bundled skills marketplace. */
export interface MarketplaceSkill {
  slug: string;
  name: string;
  description: string;
  category?: string;
  bundled?: boolean;
  installed?: boolean;
}

/** v6.1 — one rival-agent skill library detected on this machine (kdx:rivals:skills). */
export interface RivalSkillSource {
  id: string;
  label: string;
  root: string;
  count: number;
}

/** v6.1 — MCP servers found in one rival agent's config files (kdx:rivals:mcp). */
export interface RivalMcpSource {
  source: string;
  servers: MCPServerConfig[];
}

/** v8.1 — published honesty metric (kdx:metrics:honesty): the career-long,
 *  persisted False-Done ledger plus a per-model proven-cost rollup. */
export interface HonestyMetrics {
  falseDone: {
    /** Runs that claimed success. */
    claimed: number;
    /** Of those, the runs the proof gates overruled. */
    falseDone: number;
    /** falseDone / claimed — 0 when claimed === 0. */
    rate: number;
  };
  costPerProvenChange?: Array<{
    key: string;
    provenChanges: number;
    totalUsd: number;
    perProvenUsd: number;
  }>;
}

/** v9 — one run-journal summary row (kdx:journal:list, newest first). */
export interface JournalSummary {
  file: string;
  sessionId: string;
  task: string;
  at: number;
  /** 'completed' | 'aborted' | … when a finish line exists; crashed/killed runs have none. */
  outcome?: string;
  /** Line count after the header (lower bound for files above the 64KB read cap). */
  events: number;
}

/** v9 — one parsed JSONL line of a run journal (kdx:journal:read). */
export interface JournalEvent {
  at?: number;
  type?: string;
  [key: string]: unknown;
}

/** v11.4 — sanitized log export (kdx:logs:export, logService.getLogExport). */
export interface LogExportInfo {
  path: string | null;
  content: string | null;
  sanitized: true;
  sessionRedactions: number;
}

/** v11.4 — one summarized proof package (kdx:evidence:list). */
export interface EvidenceProofRow {
  file: string;
  id?: string;
  verdict?: string;
  createdAt?: string;
  workspaceName?: string;
  taskKind?: string;
}

/** v11.4 — honest-agent evidence summary (kdx:evidence:list). Read-only. */
export interface EvidenceSummary {
  proofs: { dir: string | null; count: number; recent: EvidenceProofRow[] };
  falseDone: {
    claimed: number;
    falseDone: number;
    rate: number;
    recent: Array<{ runId: string; at: number; gateVerdict: string; falseDone: boolean }>;
  };
}

/** v11.4 — result of the Stripe checkout stub (kdx:billing:checkout). */
export interface BillingCheckoutResult {
  configured: boolean;
  ok?: boolean;
  url?: string;
  error?: string;
}

/** v11.38 — renderer mirrors of gitService's branch/identity results. Kept
 *  here (not in shared/types) so the web tsconfig never pulls electron files. */
export interface GitBranchInfo {
  name: string;
  hash: string;
  current: boolean;
}
export interface GitIdentityInfo {
  configured: boolean;
  name: string;
  email: string;
}

export interface SurniaAPI {
  // window / dialogs
  win(action: 'min' | 'max' | 'close'): Promise<void>;
  openFolderDialog(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  // filesystem
  readDir(root: string): Promise<FileNode | null>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  createFile(path: string, content?: string): Promise<void>;
  createDir(path: string): Promise<void>;
  deletePath(path: string): Promise<void>;
  renamePath(oldPath: string, newPath: string): Promise<void>;
  searchFiles(root: string, pattern: string, include?: string): Promise<SearchHit[]>;
  // terminal
  termCreate(cwd: string): Promise<string>;
  termExec(terminalId: string, cmd: string, cwd?: string): Promise<void>;
  termInterrupt(terminalId: string): Promise<void>;
  /** v11.10 — raw stdin bridge to the RUNNING child (prompts / REPLs). */
  termWrite(terminalId: string, data: string): Promise<boolean>;
  /**
   * v11.13 — run ONE shell command in a workspace and return its REAL exit
   * code + captured output. Backs the composer's `/test` capability. The main
   * process caps output and enforces a timeout; no verdict is fabricated here.
   */
  cmdRun(cmd: string, cwd: string, timeoutMs?: number): Promise<CommandRunResult>;
  // git
  gitStatus(root: string): Promise<GitStatus | null>;
  gitDiff(root: string, path?: string): Promise<GitDiff[]>;
  gitStage(root: string, paths: string[]): Promise<void>;
  gitCommit(root: string, message: string): Promise<string>;
  gitInit(root: string): Promise<void>;
  gitLog(root: string, n?: number): Promise<GitLogEntry[]>;
  gitCheckout(root: string, branch: string): Promise<void>;
  /** v11.38 — local branches (name / short hash / current flag) from real git. */
  gitBranchList(root: string): Promise<GitBranchInfo[]>;
  gitBranchCreate(root: string, name: string, opts?: { checkout?: boolean; startPoint?: string }): Promise<GitBranchInfo>;
  /** v11.38 — effective local author identity, for honest commit UI. */
  gitIdentity(root: string): Promise<GitIdentityInfo>;
  // settings
  getSettings(): Promise<AppSettings>;
  saveSettings(s: AppSettings): Promise<void>;
  /** v12 — export the full profile (settings + DNA + skills + prompts). */
  profileExport(workspace?: string): Promise<SadeemProfile>;
  /** v12 — import/restore a full profile. */
  profileImport(payload: unknown, workspace?: string): Promise<ProfileImportResult>;
  // v11.4 — diagnostics log (Settings → Logs)
  logsOpenFolder(): Promise<{ ok: boolean; path?: string; error?: string }>;
  logsExport(maxBytes?: number): Promise<LogExportInfo>;
  logsClear(): Promise<{ ok: boolean; path?: string; error?: string }>;
  // v11.4 — evidence (honest-agent proof artifacts, read-only)
  evidenceList(limit?: number): Promise<EvidenceSummary>;
  evidenceOpenFolder(): Promise<{ ok: boolean; path?: string; error?: string }>;
  // sessions
  listSessions(): Promise<SessionMeta[]>;
  loadSession(id: string): Promise<SessionData | null>;
  saveSession(data: SessionData): Promise<void>;
  deleteSession(id: string): Promise<void>;
  // agent
  /**
   * v11.22 — accepts the full renderer params OR a partial/legacy payload
   * (phone bridge, flows, local API server). No validation happens here — the
   * main process owns the single repair/validation point (`normalizeRunParams`)
   * so a malformed caller can never surface the old vague
   * "Invalid run parameters (missing messages or model)" message.
   */
  agentRun(params: AgentRunParams | AgentRunParamsInput): Promise<void>;
  agentAbort(): Promise<void>;
  agentApproval(d: PermissionDecision): Promise<void>;
  // v11.10 — approvals manager (Settings → Approvals; same stores the gate writes)
  approvalsList(workspace?: string): Promise<ApprovalsListResult>;
  approvalsRevoke(workspace: string | undefined, key: string): Promise<{ revoked: number }>;
  // v2.1 engine: plan approval / steer / task mode / review / recap / skills
  agentPlanApprove(sessionId: string, choice: PlanApprovalChoice, feedback?: string): Promise<{ ok: boolean }>;
  agentSteer(sessionId: string, text: string): Promise<{ ok: boolean }>;
  agentTaskMode(sessionId: string, taskMode: TaskMode): Promise<{ ok: boolean }>;
  agentReviewRun(sessionId: string): Promise<{ findings: ReviewFinding[]; summary?: string; clean?: boolean }>;
  agentRecap(sessionId: string): Promise<{ markdown: string }>;
  skillsList(workspace: string): Promise<SkillInfo[]>;
  skillDelete(workspace: string, slug: string): Promise<{ ok: boolean }>;
  // v5 — skills manager (scopes + companion files + import/fork)
  skillsManagerList(ws: string): Promise<SkillInfo[]>;
  skillsRead(ws: string, slug: string): Promise<{ slug: string; name: string; description: string; body: string; path: string; scope?: string; files?: string[] } | null>;
  skillsSave(ws: string, skill: { name: string; description?: string; body: string }, scope: string): Promise<string>;
  skillsDelete(ws: string, slug: string, scope: string): Promise<boolean>;
  skillsImportDir(ws: string, srcDir: string, scope: string): Promise<string | null>;
  skillsForkBuiltin(ws: string, slug: string, scope: string): Promise<string | null>;
  skillsRoots(ws: string): Promise<{ global: string; workspace: string }>;
  skillsReadFile(ws: string, slug: string, rel: string, scope: string): Promise<string>;
  // v12 — skills marketplace
  skillsMarketplaceList(ws: string): Promise<MarketplaceSkill[]>;
  skillsMarketplaceInstall(ws: string, slug: string): Promise<{ ok: boolean; output: string }>;
  skillsMarketplaceRemove(ws: string, slug: string): Promise<{ ok: boolean; output: string }>;
  // v6.1 — import skills/MCP from other agents installed on this machine
  rivalsSkills(): Promise<RivalSkillSource[]>;
  rivalsSkillsImport(ws: string, srcRoot: string, scope: 'workspace' | 'global'): Promise<{ imported: number; failed: number }>;
  rivalsMcp(): Promise<RivalMcpSource[]>;
  // v6 — Repo Wiki
  wikiGenerate(ws: string, language?: 'ar' | 'en'): Promise<{ ok: boolean; error?: string; pages?: number }>;
  wikiGet(ws: string): Promise<{ wiki: { generatedAt: number; language: string; catalog: { slug: string; title: string }[]; pages: { slug: string; title: string; body: string }[] } | null; stale: boolean; generating: boolean }>;
  // v6 — feedback & suggestions (صندوق الاقتراحات)
  feedbackSave(entry: {
    kind: 'bug' | 'improvement' | 'feature' | 'other';
    message: string;
    contact?: string;
    diagnostics?: { appVersion: string; platform: string; language: string; workspacesOpened: number; sessions: number };
  }): Promise<{ ok: boolean; entry?: { id: string }; error?: string }>;
  feedbackList(): Promise<{ id: string; at: number; kind: string; message: string; contact?: string }[]>;
  feedbackPath(): Promise<string>;
  feedbackMarkdown(entry: unknown): Promise<string>;
  // checkpoints
  cpCreate(root: string, label: string): Promise<CheckpointInfo>;
  cpList(root: string): Promise<CheckpointInfo[]>;
  cpRestore(root: string, id: string): Promise<void>;
  // live preview
  previewScan(): Promise<number[]>;
  previewStaticStart(dir: string): Promise<PreviewStartResult>;
  previewStaticStop(): Promise<{ ok: boolean }>;
  previewDevStart(workspace: string, runtime?: 'npm' | 'python' | 'custom' | 'go'): Promise<PreviewStartResult>;
  previewDevStop(): Promise<{ ok: boolean }>;
  previewStatus(): Promise<PreviewStatusResult>;
  previewTargets(workspace: string): Promise<{ kind: 'dev' | 'static' | 'file' | 'artifact'; label: string; dir?: string; runtime?: 'python' | 'custom' | 'go' }[]>;
  // agent browser (v8 — live visibility for the Browser panel)
  browserState(sessionId: string): Promise<{ open: boolean; url: string; title: string; lastShot?: string }>;
  browserClose(sessionId: string): Promise<{ ok: boolean }>;
  onBrowserEvent(cb: (e: { kind: 'navigated' | 'shot' | 'closed'; sessionId: string; url?: string; title?: string; tabId?: string }) => void): () => void;
  // v12 — tab-aware browser panel
  browserTabs(sessionId: string): Promise<Array<{ id: string; url: string; title: string; active: boolean }>>;
  browserNetwork(sessionId: string, opts?: { url_contains?: string; limit?: number; clear?: boolean }): Promise<{ url: string; entries: Array<{ method: string; status: string; type?: string; ms?: number; kb?: number; url: string; errorText?: string }> }>;
  browserTabAction(sessionId: string, action: 'select' | 'close' | 'new', tabId?: string, url?: string): Promise<string>;
  // app performance
  appMetrics(): Promise<AppMetrics>;
  /** v8.1 — published honesty metric (career-long False-Done Rate) + proven-cost rollup. */
  metricsHonesty(): Promise<HonestyMetrics>;
  // mcp + providers
  mcpTest(server: MCPServerConfig): Promise<{ ok: boolean; tools?: MCPToolInfo[]; error?: string }>;
  // mcp registry (v1.3)
  mcpServersGet(): Promise<MCPServersResult>;
  mcpServerSave(cfg: MCPServerConfig): Promise<{ ok: boolean; error?: string }>;
  mcpServerDelete(id: string): Promise<{ ok: boolean }>;
  mcpConnect(id: string): Promise<MCPServerStatus>;
  mcpResources(id: string): Promise<MCPResourceInfo[]>;
  mcpReadResource(id: string, uri: string): Promise<MCPResourceContent>;
  mcpPrompts(id: string): Promise<MCPPromptInfo[]>;
  /** v3.1 — render an MCP server prompt template to text (MCPPanel prompt runner).
   *  v11.31 — this method EXISTED in the preload bridge and the main process
   *  (`kdx:mcp:promptGet`) but was missing from the typed surface, forcing the
   *  renderer to call it dynamically through a "preload not updated" fallback. */
  mcpPromptGet(id: string, name: string, args?: Record<string, string>): Promise<{ ok: boolean; text?: string; error?: string }>;
  // billing / subscription (v1.3)
  billingGet(): Promise<BillingOverview>;
  billingSetPaymentLink(url: string): Promise<{ ok: boolean }>;
  billingOpenCheckout(plan: PlanId): Promise<{ ok: boolean; url?: string; error?: string }>;
  billingCoupon(code: string): Promise<CouponResult>;
  billingRefreshPlan(): Promise<SubscriptionState>;
  /** v11.4 — Stripe checkout stub: {configured:false} until a secret key is set. */
  billingCheckout(plan: string): Promise<BillingCheckoutResult>;
  providerVerify(
    provider: ProviderId,
    opts: { apiKey?: string; baseUrl?: string }
  ): Promise<{ ok: boolean; models?: string[]; error?: string }>;
  /** Live model discovery — full newest-first list from the provider's API. */
  listModels(
    provider: ProviderId,
    opts: { apiKey?: string; baseUrl?: string }
  ): Promise<{
    ok: boolean;
    models: { id: string; label?: string; context?: number; created?: number }[];
    error?: string;
  }>;
  /** A6 — live OpenRouter catalog: fetched in main with the configured key
   *  (10-min module cache) and mapped into picker rows; [] on any failure. */
  openrouterLiveModels(): Promise<
    { id: string; name: string; ctx: number; free: boolean; vision?: boolean }[]
  >;
  /** v11.10 (A8) — provider ENABLE: field-level credential errors only;
   *  catalog fetch failure comes back as an honest per-provider warning. */
  providerEnable(
    provider: ProviderId,
    req: { apiKey?: string; baseUrl?: string; active?: { provider: string; model: string; hasKey?: boolean }; curatedModels?: string[] },
  ): Promise<{
    ok: boolean;
    models: string[];
    defaultModel?: string;
    adopt: boolean;
    warning?: string;
    fieldErrors?: { apiKey?: string; baseUrl?: string };
    error?: string;
  }>;
  homeDir(): Promise<string>;
  /** Context window + price for a model id (catalog lookup, powers the context meter).
   *  v11.10 (A5): `ctxEstimated` true ⇒ unknown model — the window is the honest
   *  200k default and every display must carry an "≈" marker. */
  modelInfo(modelId: string): Promise<{
    contextWindow: number;
    ctxEstimated?: boolean;
    price: { input: number; output: number; cacheRead: number; estimated: boolean };
  }>;
  // diagnostics (renderer → main.log)
  log(level: number, message: string): Promise<boolean>;
  /** Legacy full-params one-shot completion (ghost text / inline edit). */
  aiComplete(params: AiCompleteParams): Promise<AiCompleteResult>;
  /** v2.5 — one-shot text completion for flows/panels; THROWS Error on failure. */
  aiComplete(prompt: string, opts?: { maxTokens?: number; system?: string }): Promise<string>;
  slashCommands(workspace?: string): Promise<SlashCommandInfo[]>;
  // licensing
  licenseGet(): Promise<LicenseState>;
  licenseActivate(key: string): Promise<LicenseState>;
  licenseDeactivate(): Promise<LicenseState>;
  // local API server (programmatic control)
  apiServerGet(): Promise<ApiServerStatus>;
  apiServerSet(patch: {
    enabled?: boolean;
    port?: number;
    token?: string;
  }): Promise<ApiServerStatus>;
  // v11.7 — SADEEM Remote (control the agent from a real phone over LAN)
  remoteGet(): Promise<RemoteStatus>;
  // v11.36 (D11) — host override when auto LAN detection picks an unreachable adapter.
  remoteSet(patch: { enabled?: boolean; port?: number; host?: string }): Promise<RemoteStatus>;
  // auth (local device accounts)
  authCurrent(): Promise<AccountInfo | null>;
  authHasAccounts(): Promise<boolean>;
  authRegister(name: string, email: string, password: string, plan?: string): Promise<AuthResult>;
  authLogin(email: string, password: string): Promise<AuthResult>;
  authLogout(): Promise<{ ok: boolean }>;
  authStrength(password: string): Promise<number>;
  // v11.3 — website-linked accounts (OpenCode-style activation)
  authWebBegin(mode: 'signup' | 'signin'): Promise<{ pair: string; url: string }>;
  authWebOpen(url: string): Promise<{ ok: boolean }>;
  // v11.6 — guest pass (skip sign-in for a limited device trial window)
  authGuestBegin(): Promise<AuthResult>;
  authGuestStatus(): Promise<import('../../shared/types').GuestPassStatus>;
  // v11.6 — prompt library
  promptsList(): Promise<import('../../shared/types').PromptItem[]>;
  promptsSave(name: string, text: string): Promise<{ ok: boolean; item?: import('../../shared/types').PromptItem; error?: string }>;
  promptsDelete(id: string): Promise<{ ok: boolean }>;
  // v11 — auto-update
  updateStatus(): Promise<{ state: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'downloaded' | 'error'; info?: { version?: string; releaseNotes?: string }; progress?: { percent?: number }; error?: string }>;
  updateFeedUrl(): Promise<string>;
  updateSetFeedUrl(url: string): Promise<string>;
  updateCheck(): Promise<{ state: string }>;
  updateDownload(): Promise<{ state: string }>;
  updateInstall(): Promise<boolean>;
  onUpdateStatus(cb: (s: unknown) => void): () => void;
  // clone repository
  gitClone(opts: CloneOptions): Promise<{ ok: boolean; projectPath?: string; error?: string }>;
  // ---------- v2: scheduling / goals / queue / worktrees ----------
  scheduleList(): Promise<import('../../shared/types').ScheduleJob[]>;
  scheduleAdd(job: Partial<import('../../shared/types').ScheduleJob>): Promise<import('../../shared/types').ScheduleJob>;
  scheduleRemove(id: string): Promise<{ ok: boolean }>;
  scheduleToggle(id: string, enabled: boolean): Promise<{ ok: boolean }>;
  scheduleRunNow(id: string): Promise<{ ok: boolean; sessionId?: string; error?: string }>;
  /** v11.12 — loopback webhook endpoint + install token (from kdx:schedule:webhook). */
  scheduleWebhook(): Promise<{ url: string; token: string }>;
  /** v11.38 — live scheduler status / event log / explicit cancel. */
  scheduleStatus(): Promise<{ available: boolean; running: boolean; state: string; [k: string]: unknown }>;
  scheduleEvents(limit?: number): Promise<unknown[]>;
  scheduleCancel(id: string): Promise<boolean>;
  /** v11.31 — the main handler `kdx:queue:send` returns the number of queued
   *  rows from `enqueueUserMessage()` directly (a bare `number`, not an
   *  `{ok,n}` envelope). The old type was dishonest; callers ignore the value. */
  queueSend(sessionId: string, text: string): Promise<number>;
  goalSet(sessionId: string, goal: string): Promise<{ ok: boolean }>;
  goalClear(sessionId: string): Promise<{ ok: boolean }>;
  goalGet(sessionId: string): Promise<{ goal: string | null; pct?: number }>;
  sessionFork(id: string): Promise<{ ok: boolean; sessionId?: string; error?: string }>;
  sessionExport(id: string): Promise<{ ok: boolean; path?: string; markdown?: string; error?: string }>;
  /** v2.3 — standalone HTML share export; no filePath → main shows a save dialog. */
  sessionExportHtml(id: string, filePath?: string): Promise<SessionExportHtmlResult>;
  /** v2.3 — voice input: transcribe base64 audio via the active provider (whisper). */
  transcribeAudio(base64Data: string, mime: string): Promise<TranscribeResult>;
  // ---------- v10.2 plugins ----------
  pluginsList(): Promise<import('../../shared/types').PluginInfo[]>;
  pluginsStarters(): Promise<{ id: string; name: string; version: string; description: string }[]>;
  pluginsInstallFile(p: string): Promise<import('../../shared/types').PluginInfo>;
  pluginsInstallUrl(u: string): Promise<import('../../shared/types').PluginInfo>;
  pluginsInstallStarter(id: string): Promise<import('../../shared/types').PluginInfo>;
  pluginsUninstall(id: string): Promise<true>;
  pluginsSetEnabled(id: string, on: boolean): Promise<import('../../shared/types').PluginInfo>;
  pluginsReveal(id: string): Promise<boolean>;
  // ---------- v10.2 library ----------
  libraryList(): Promise<import('../../shared/types').LibraryItem[]>;
  libraryForget(id: string): Promise<true>;
  libraryClear(): Promise<true>;
  libraryOpen(id: string): Promise<boolean>;
  worktreeList(root: string): Promise<import('../../shared/types').WorktreeInfo[]>;
  worktreeResolve(root: string, name: string): Promise<import('../../shared/types').WorktreeInfo | null>;
  worktreeCreate(root: string, name: string): Promise<import('../../shared/types').WorktreeInfo>;
  worktreeRemove(root: string, name: string, force?: boolean): Promise<{ ok: boolean; error?: string }>;
  worktreeMerge(root: string, name: string): Promise<{ ok: boolean; error?: string; merged?: string[] }>;
  gitCommitMessage(root: string): Promise<{ ok: boolean; message?: string; error?: string }>;
  gitReview(root: string, base?: string): Promise<{ ok: boolean; review?: string; error?: string }>;
  memoryRead(workspace: string): Promise<string>;
  memoryWrite(workspace: string, content: string): Promise<void>;
  // events (returns unsubscribe fn)
  onAgentEvent(cb: (e: AgentEvent) => void): () => void;
  onTerminal(cb: (e: TerminalOutputEvent) => void): () => void;
  onMenu(cb: (action: string) => void): () => void;
  onCloneProgress(cb: (p: CloneProgress) => void): () => void;
  onPreviewEvent(cb: (e: { kind: 'static' | 'dev' | 'watch' | 'log'; state?: string; url?: string; error?: string; lines?: string[]; path?: string; level?: string; text?: string }) => void): () => void;
  // v11.3 — website activation landed (deep-link callback)
  onAuthChanged(cb: (res: { ok: boolean; account?: AccountInfo; error?: string }) => void): () => void;

  // ---------- mcp v2 (E3): health monitor / tool inspector / call log / registry / quarantine ----------
  mcpHealthGet(): Promise<McpHealthEntry[]>;
  mcpHealthCheck(id: string): Promise<McpHealthEntry>;
  mcpToolsExtended(id: string): Promise<MCPToolInfo[]>;
  mcpToolEnable(id: string, tool: string, enabled: boolean): Promise<{ ok: boolean }>;
  mcpCallLog(): Promise<McpCallLogEntry[]>;
  mcpCallLogClear(): Promise<{ ok: boolean }>;
  mcpRegistrySearch(query: string, cursor?: string): Promise<{ servers: MCPRegistryPreset[]; nextCursor?: string }>;
  mcpRegistryAdd(result: MCPRegistryPreset, nameOverride?: string): Promise<{ ok: boolean; id?: string; error?: string }>;
  mcpV2SettingsGet(): Promise<Record<string, unknown>>;
  mcpV2SettingsSet(patch: Record<string, unknown>): Promise<Record<string, unknown>>;
  mcpQuarantineSet(id: string, quarantined: boolean): Promise<{ ok: boolean }>;
  mcpApprovalSet(id: string, tool: string, decision: 'always' | 'deny' | null): Promise<{ ok: boolean }>;
  /**
   * v7.3 — resolve an MCP elicitation/create request surfaced as an
   * mcp_elicitation approval card. content carries the accepted fields
   * (requestedSchema-shaped) when action === 'accept'.
   */
  mcpElicitDecision(
    requestId: string,
    action: 'accept' | 'decline' | 'cancel',
    content?: Record<string, unknown>,
  ): Promise<{ ok: boolean }>;
  onMcpHealth(cb: (e: McpHealthEntry) => void): () => void;

  // ---------- security & privacy (E4) ----------
  termAllowOnce(cmd: string): Promise<{ ok: boolean }>;
  secStatus(): Promise<SecStatusInfo>;
  secAuditRecent(limit?: number): Promise<SecAuditEntry[]>;
  secAuditClear(): Promise<{ ok: boolean }>;
  secClearSessions(): Promise<{ ok: boolean }>;
  secClearMemory(workspace?: string): Promise<{ ok: boolean }>;
  secClearMcpApprovals(): Promise<{ ok: boolean }>;
  /** v2.2 — wipe session + persistent "always allow" approval rules. */
  secClearApprovals(): Promise<{ ok: boolean; cleared?: number }>;
  secExportData(): Promise<{ ok: boolean; path?: string; error?: string }>;
  onTermBlocked(cb: (e: TermBlockedEvent) => void): () => void;
  onTermWarn(cb: (e: TermWarnEvent) => void): () => void;
  onFsBlock(cb: (e: FsBlockEvent) => void): () => void;
  onSecurityEvent(cb: (e: SecurityEvent) => void): () => void;

  // ---------- v2.2 Surnia DNA (the closed learning loop) ----------
  /** Merged DNA (global + workspace layer). */
  dnaGet(workspace?: string): Promise<DNAData>;
  /** Edit/remove an entry by id: {section, id?, patch}. */
  dnaUpdate(req: DnaUpdateRequest): Promise<{ ok: boolean }>;
  /** Explicit UI feedback (praise / correction / preference). */
  dnaFeedback(kind: 'praise' | 'correction' | 'preference', note: string, context?: string): Promise<{ ok: boolean }>;
  /** Clear the model ('all' = global file, 'workspace' = workspace layer only). */
  dnaClear(scope: 'all' | 'workspace', workspace?: string): Promise<{ cleared: boolean }>;
  /** Stats + 14-day growth series. */
  dnaStats(workspace?: string): Promise<DnaStatsInfo>;
  /** Dismiss a proactive skill suggestion chip. */
  dnaDismissSuggestion(patternId: string): Promise<{ ok: boolean }>;
  /** Trust a workspace's skills (creates .surnia/skills-trusted). */
  skillsTrust(workspace: string): Promise<{ ok: boolean }>;
  /** Explicit workspace confinement — call whenever a workspace resolves. */
  workspaceSet(workspace: string): Promise<{ ok: boolean; workspace?: string }>;
  /** Push events: updated | refined | suggestion | skills-trust. */
  onDnaEvent(cb: (e: DNAEvent) => void): () => void;

  // ---------- v11.12 Living Playbook (signature feature) ----------
  playbookGet(workspace?: string): Promise<PlaybookData>;
  playbookHistory(workspace?: string): Promise<PlaybookRevision[]>;
  playbookMarkdown(workspace?: string): Promise<string>;
  playbookClear(workspace?: string): Promise<{ cleared: boolean }>;
  playbookUpdate(input: { workspace?: string; update?: PlaybookUpdate }): Promise<{ changed: boolean; version: number; revision: PlaybookRevision }>;
  onPlaybookEvent(cb: (e: PlaybookEvent) => void): () => void;

  // ---------- v11.12 Subagent dashboard ----------
  subagentsList(workspace?: string): Promise<SubagentRecord[]>;
  subagentsGet(id: string): Promise<SubagentRecord | null>;
  subagentsRetry(id: string): Promise<{ ok: boolean; id?: string; error?: string }>;
  subagentsClear(): Promise<{ ok: boolean }>;
  onSubagentsEvent(cb: (e: SubagentEvent) => void): () => void;

  // ---------- v2.5 Flows (named reusable prompts) ----------
  /** Global flows; with ws → merged list including that workspace's flows. */
  flowsList(ws?: string): Promise<Flow[]>;
  /** Create/update a flow (duplicate name in scope → Error('duplicate')). Returns the merged list. */
  flowsSave(
    flow: { id?: string; name: string; prompt: string; scope: 'global' | 'workspace' },
    ws?: string,
  ): Promise<Flow[]>;
  /** Delete by id (workspace store first, then global). Returns the merged list. */
  flowsDelete(id: string, ws?: string): Promise<Flow[]>;
  /** The renderer runs a flow by re-sending the prompt; call this to bump runCount/lastRun.
   *  v11.36 — returns whether the mark succeeded (flowsService.flowsMarkRun is boolean). */
  flowsMarkRun(id: string, ws?: string): Promise<boolean>;
  /** Count a typed prompt repetition; {suggest:true} = offer to save it as a flow. */
  flowsHit(text: string): Promise<{ count: number; suggest: boolean; text: string }>;
  /** Flows store summary (counts + tracked hit entries). */
  flowsInfo(ws?: string): Promise<FlowsInfo>;
  /** v11.38 (F5) — real repetition suggestions + structured replay verdict. */
  flowsSuggestions?(): Promise<{ text: string; count: number }[]>;
  flowsValidateByReplay?(id: string): Promise<{ ok: boolean; reason?: string }>;

  // ---------- v9 — run journal (crash-resilient progress trail) ----------
  /** Newest-first list of recent run journals (userData/journals). */
  journalList(limit?: number): Promise<JournalSummary[]>;
  /** Last N (default 200) JSONL events of one journal file. */
  journalRead(file: string, maxLines?: number): Promise<JournalEvent[]>;
}

declare global {
  interface Window {
    surnia: SurniaAPI;
    /** Legacy alias — old renderer bundles only. */
    kodex?: SurniaAPI;
  }
}

interface BridgeWindow { surnia?: SurniaAPI; kodex?: SurniaAPI }
export const api: SurniaAPI =
  typeof window !== 'undefined'
    ? (window as unknown as BridgeWindow).surnia ??
      (window as unknown as BridgeWindow).kodex ?? ({} as SurniaAPI)
    : ({} as SurniaAPI);

// Convenience helper so UI code never imports ApprovalKind from two places.
export type { ApprovalKind };
export type { ModelConfig };
export type { PlanApprovalChoice, TaskMode, ReviewFinding, SkillInfo };
export type { MCPServerStatus, MCPResourceInfo, MCPPromptInfo, MCPResourceContent, MCPServersResult };
export type { PlanId, BillingOverview, CouponResult, SubscriptionState, PlanDefinition };
export type { AccountInfo, AuthError, AuthResult, CloneProgress };
export type { DNAData, DNAEvent, DNARecallHit };
export type { PlaybookData, PlaybookEvent, PlaybookRevision, PlaybookUpdate, SubagentEvent, SubagentRecord };
export type { Flow, FlowsInfo };
