// Electron preload — bridges the main process to the renderer via contextBridge.
// This file MUST stay in sync with src/lib/api.ts (SurniaAPI) and electron/ipc.ts.
// SECURITY (v11.11 A9): the bridge is a closed allowlist by construction —
// the only renderer-reachable surface is this frozen `api` object; invoke()
// refuses any channel outside the kdx: namespace, and no raw ipcRenderer is
// ever exposed to the page.
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { AgentRunParamsInput } from '../shared/types';

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  // Guardrail: every legitimate bridge channel lives in the kdx: namespace.
  // A typo'd or injected channel fails fast HERE instead of hitting ipcMain.
  if (typeof channel !== 'string' || !channel.startsWith('kdx:')) {
    return Promise.reject(new Error('CHANNEL_FORBIDDEN'));
  }
  return ipcRenderer.invoke(channel, ...args);
}

function subscribe(channel: string, cb: (...args: unknown[]) => void): () => void {
  const handler = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api = {
  // window / dialogs
  win: (action: string) => invoke('kdx:win', action),
  openFolderDialog: () => invoke('kdx:dialog:openFolder'),
  openExternal: (url: string) => invoke('kdx:openExternal', url),

  // filesystem
  readDir: (root: string) => invoke('kdx:fs:readDir', root),
  readFile: (path: string) => invoke('kdx:fs:readFile', path),
  writeFile: (path: string, content: string) => invoke('kdx:fs:writeFile', path, content),
  createFile: (path: string, content?: string) => invoke('kdx:fs:createFile', path, content ?? ''),
  createDir: (path: string) => invoke('kdx:fs:createDir', path),
  deletePath: (path: string) => invoke('kdx:fs:deletePath', path),
  renamePath: (oldPath: string, newPath: string) => invoke('kdx:fs:renamePath', oldPath, newPath),
  searchFiles: (root: string, pattern: string, include?: string) =>
    invoke('kdx:fs:searchFiles', root, pattern, include),

  // terminal
  termCreate: (cwd: string) => invoke('kdx:term:create', cwd),
  termExec: (terminalId: string, cmd: string, cwd?: string) =>
    invoke('kdx:term:exec', terminalId, cmd, cwd),
  termInterrupt: (terminalId: string) => invoke('kdx:term:interrupt', terminalId),
  // v11.10 — raw stdin bridge (keystrokes → the RUNNING child process)
  termWrite: (terminalId: string, data: string) => invoke('kdx:term:write', terminalId, data),
  // v11.13 — one-shot command runner with a real exit code (backs /test).
  cmdRun: (cmd: string, cwd: string, timeoutMs?: number) => invoke('kdx:cmd:run', cmd, cwd, timeoutMs),

  // git
  gitStatus: (root: string) => invoke('kdx:git:status', root),
  gitDiff: (root: string, path?: string) => invoke('kdx:git:diff', root, path),
  gitStage: (root: string, paths: string[]) => invoke('kdx:git:stage', root, paths),
  gitCommit: (root: string, message: string) => invoke('kdx:git:commit', root, message),
  gitInit: (root: string) => invoke('kdx:git:init', root),
  gitLog: (root: string, n?: number) => invoke('kdx:git:log', root, n),
  gitCheckout: (root: string, branch: string) => invoke('kdx:git:checkout', root, branch),
  // v11.38 — branch create/list + identity (all go through gitService in main).
  gitBranchList: (root: string) => invoke('kdx:git:branch:list', root),
  gitBranchCreate: (root: string, name: string, opts?: { checkout?: boolean; startPoint?: string }) =>
    invoke('kdx:git:branch:create', root, name, opts),
  gitIdentity: (root: string) => invoke('kdx:git:identity', root),

  // settings
  getSettings: () => invoke('kdx:settings:get'),
  saveSettings: (s: unknown) => invoke('kdx:settings:save', s),

  // v12 — full profile export / import (settings + DNA + skills + prompts)
  profileExport: (workspace?: string) => invoke('kdx:profile:export', workspace),
  profileImport: (payload: unknown, workspace?: string) => invoke('kdx:profile:import', payload, workspace),

  // v11.4 — diagnostics log (Settings → Logs)
  logsOpenFolder: () => invoke('kdx:logs:openFolder'),
  logsExport: (maxBytes?: number) => invoke('kdx:logs:export', maxBytes),
  logsClear: () => invoke('kdx:logs:clear'),

  // v11.4 — evidence (honest-agent proof artifacts, read-only)
  evidenceList: (limit?: number) => invoke('kdx:evidence:list', limit),
  evidenceOpenFolder: () => invoke('kdx:evidence:openFolder'),

  // sessions
  listSessions: () => invoke('kdx:sessions:list'),
  loadSession: (id: string) => invoke('kdx:sessions:load', id),
  saveSession: (data: unknown) => invoke('kdx:sessions:save', data),
  deleteSession: (id: string) => invoke('kdx:sessions:delete', id),

  // agent
  // v11.22 — LOSSLESS pass-through. This bridge does NOT validate/reject run
  // params: even undefined, a `"provider/model"` string model or a missing
  // messages array must reach the main process unchanged, where
  // `normalizeRunParams` (electron/agent/register.ts) repairs them and emits a
  // precise reason only when nothing can be repaired.
  agentRun: (params: AgentRunParamsInput | undefined) => invoke('kdx:agent:run', params),
  agentAbort: () => invoke('kdx:agent:abort'),
  agentApproval: (d: unknown) => invoke('kdx:agent:approval', d),
  // v2.1 engine: plan approval / steer / task mode / review / recap / skills
  agentPlanApprove: (sessionId: string, choice: 'auto' | 'manual' | 'revise', feedback?: string) =>
    invoke('kdx:agent:plan-approve', sessionId, choice, feedback),
  agentSteer: (sessionId: string, text: string) => invoke('kdx:agent:steer', sessionId, text),
  agentTaskMode: (sessionId: string, taskMode: 'build' | 'plan' | 'debug' | 'review') =>
    invoke('kdx:agent:task-mode', sessionId, taskMode),
  agentReviewRun: (sessionId: string) => invoke('kdx:agent:review-run', sessionId),
  agentRecap: (sessionId: string) => invoke('kdx:agent:recap', sessionId),
  skillsList: (workspace: string) => invoke('kdx:agent:skills-list', workspace),
  skillDelete: (workspace: string, slug: string) => invoke('kdx:agent:skill-delete', workspace, slug),
  // v6.1 — import skills/MCP from other agents installed on this machine
  rivalsSkills: () => invoke('kdx:rivals:skills'),
  rivalsSkillsImport: (ws: string, srcRoot: string, scope: string) =>
    invoke('kdx:rivals:skills-import', ws, srcRoot, scope),
  rivalsMcp: () => invoke('kdx:rivals:mcp'),
  // v6 — Repo Wiki
  wikiGenerate: (workspace: string, language?: 'ar' | 'en') => invoke('kdx:wiki:generate', workspace, language),
  wikiGet: (workspace: string) => invoke('kdx:wiki:get', workspace),
  // v6 — feedback & suggestions
  feedbackSave: (entry: unknown) => invoke('kdx:feedback:save', entry),
  feedbackList: () => invoke('kdx:feedback:list'),
  feedbackPath: () => invoke('kdx:feedback:path'),
  feedbackMarkdown: (entry: unknown) => invoke('kdx:feedback:markdown', entry),

  // checkpoints
  cpCreate: (root: string, label: string) => invoke('kdx:cp:create', root, label),
  cpList: (root: string) => invoke('kdx:cp:list', root),
  cpRestore: (root: string, id: string) => invoke('kdx:cp:restore', root, id),

  // live preview
  previewScan: () => invoke('kdx:preview:scan'),
  previewStaticStart: (dir: string) => invoke('kdx:preview:staticStart', dir),
  previewStaticStop: () => invoke('kdx:preview:staticStop'),
  previewDevStart: (workspace: string, runtime?: 'npm' | 'python' | 'custom') =>
    invoke('kdx:preview:devStart', workspace, runtime),
  previewDevStop: () => invoke('kdx:preview:devStop'),
  previewStatus: () => invoke('kdx:preview:status'),
  previewTargets: (workspace: string) => invoke('kdx:preview:targets', workspace),

  // agent browser (v8 — live visibility for the Browser panel)
  browserState: (sessionId: string) => invoke('kdx:browser:state', sessionId),
  browserClose: (sessionId: string) => invoke('kdx:browser:close', sessionId),
  onBrowserEvent: (cb: (...args: unknown[]) => void) => subscribe('kdx:browser:event', cb),
  // v12 — tab-aware browser panel
  browserTabs: (sessionId: string) => invoke('kdx:browser:tabs', sessionId),
  browserNetwork: (sessionId: string, opts?: unknown) => invoke('kdx:browser:network', sessionId, opts),
  browserTabAction: (sessionId: string, action: string, tabId?: string, url?: string) =>
    invoke('kdx:browser:tabAction', sessionId, action, tabId, url),

  // app performance
  appMetrics: () => invoke('kdx:app:metrics'),
  // v8.1 — published honesty metric (career-long False-Done ledger) +
  // per-model proven-cost rollup; consumed by the status bar + Usage panel.
  metricsHonesty: () => invoke('kdx:metrics:honesty'),

  // mcp + providers
  mcpTest: (server: unknown) => invoke('kdx:mcp:test', server),
  // mcp registry (v1.3)
  mcpServersGet: () => invoke('kdx:mcp:servers'),
  mcpServerSave: (cfg: unknown) => invoke('kdx:mcp:save', cfg),
  mcpServerDelete: (id: string) => invoke('kdx:mcp:delete', id),
  mcpConnect: (id: string) => invoke('kdx:mcp:connect', id),
  mcpResources: (id: string) => invoke('kdx:mcp:resources', id),
  mcpReadResource: (id: string, uri: string) => invoke('kdx:mcp:readResource', id, uri),
  mcpPrompts: (id: string) => invoke('kdx:mcp:prompts', id),
  // v3.1 — prompts/get: render a server prompt template to text (UI only)
  mcpPromptGet: (id: string, name: string, args?: Record<string, string>) =>
    invoke('kdx:mcp:promptGet', id, name, args ?? {}),

  // v5 — skills library (manager API; skillsList above = engine scope list)
  skillsManagerList: (ws: string) => invoke('kdx:skills:list', ws),
  skillsRead: (ws: string, slug: string) => invoke('kdx:skills:read', ws, slug),
  skillsSave: (ws: string, skill: unknown, scope: string) => invoke('kdx:skills:save', ws, skill, scope),
  skillsDelete: (ws: string, slug: string, scope: string) => invoke('kdx:skills:delete', ws, slug, scope),
  skillsImportDir: (ws: string, srcDir: string, scope: string) => invoke('kdx:skills:importDir', ws, srcDir, scope),
  skillsForkBuiltin: (ws: string, slug: string, scope: string) => invoke('kdx:skills:forkBuiltin', ws, slug, scope),
  skillsRoots: (ws: string) => invoke('kdx:skills:roots', ws),
  skillsReadFile: (ws: string, slug: string, rel: string, scope: string) =>
    invoke('kdx:skills:readFile', ws, slug, rel, scope),
  // v12 — skills marketplace
  skillsMarketplaceList: (ws: string) => invoke('kdx:skills:marketplace:list', ws),
  skillsMarketplaceInstall: (ws: string, slug: string) => invoke('kdx:skills:marketplace:install', ws, slug),
  skillsMarketplaceRemove: (ws: string, slug: string) => invoke('kdx:skills:marketplace:remove', ws, slug),

  // billing / subscription (v1.3)
  billingGet: () => invoke('kdx:billing:get'),
  billingSetPaymentLink: (url: string) => invoke('kdx:billing:setPaymentLink', url),
  billingOpenCheckout: (plan: string) => invoke('kdx:billing:openCheckout', plan),
  billingCoupon: (code: string) => invoke('kdx:billing:coupon', code),
  billingRefreshPlan: () => invoke('kdx:billing:refreshPlan'),
  // v11.4 — Stripe checkout stub ({configured:false} until a secret key is set)
  billingCheckout: (plan: string) => invoke('kdx:billing:checkout', plan),
  providerVerify: (provider: string, opts: unknown) => invoke('kdx:provider:verify', provider, opts),
  listModels: (provider: string, opts: unknown) => invoke('kdx:provider:listModels', provider, opts),
  // v11.10 (A8) — provider enable: field-level validation + auto model fetch
  providerEnable: (provider: string, req: unknown) => invoke('kdx:provider:enable', provider, req),
  // A6 — live OpenRouter catalog: main reads the configured openrouter key
  // from settings and returns picker-shaped rows ([] on any failure).
  openrouterLiveModels: () => invoke('kdx:models:openrouter'),

  // app
  homeDir: () => invoke('kdx:app:homeDir'),
  modelInfo: (modelId: string) => invoke('kdx:model:info', modelId),
  // diagnostics (renderer → main.log)
  log: (level: number, message: string) => invoke('kdx:log', level, String(message).slice(0, 4000)),
  // v2.5 — dual form: legacy full-params object (ghost text / inline edit),
  // or (prompt, opts) one-shot text helper that THROWS on provider failure
  // (flows/panels contract). Both resolve through kdx:ai:complete.
  aiComplete: async (paramsOrPrompt: unknown, opts?: { maxTokens?: number; system?: string }) => {
    if (typeof paramsOrPrompt === 'string') {
      const res = await invoke<{ ok: boolean; text?: string; error?: string }>('kdx:ai:complete', {
        prompt: paramsOrPrompt,
        ...(opts ?? {}),
      });
      if (!res || res.ok !== true) throw new Error(res?.error || 'aiComplete failed');
      return typeof res.text === 'string' ? res.text : '';
    }
    return invoke('kdx:ai:complete', paramsOrPrompt);
  },
  slashCommands: (workspace?: string) => invoke('kdx:agent:slashCommands', workspace),

  // ---------- v2: scheduling / goals / queue / worktrees ----------
  scheduleList: () => invoke('kdx:schedule:list'),
  scheduleAdd: (job: unknown) => invoke('kdx:schedule:add', job),
  scheduleRemove: (id: string) => invoke('kdx:schedule:remove', id),
  scheduleToggle: (id: string, enabled: boolean) => invoke('kdx:schedule:toggle', id, enabled),
  scheduleRunNow: (id: string) => invoke('kdx:schedule:runNow', id),
  // v11.12 — webhook endpoint + token for the Schedule dashboard (main registers
  // kdx:schedule:webhook; loopback-only, token-gated listener).
  scheduleWebhook: () => invoke('kdx:schedule:webhook'),
  // v11.38 — live scheduler bridge (status / event log / explicit cancel).
  scheduleStatus: () => invoke('kdx:schedule:status'),
  scheduleEvents: (limit?: number) => invoke('kdx:schedule:events', limit),
  scheduleCancel: (id: string) => invoke('kdx:schedule:cancel', id),
  queueSend: (sessionId: string, text: string) => invoke('kdx:queue:send', sessionId, text),
  goalSet: (sessionId: string, goal: string) => invoke('kdx:goal:set', sessionId, goal),
  goalClear: (sessionId: string) => invoke('kdx:goal:clear', sessionId),
  goalGet: (sessionId: string) => invoke('kdx:goal:get', sessionId),
  sessionFork: (id: string) => invoke('kdx:sessions:fork', id),
  sessionExport: (id: string) => invoke('kdx:sessions:export', id),
  // v2.3 — standalone HTML share export (save dialog in main; self-registered channel)
  sessionExportHtml: (id: string, filePath?: string) => invoke('kdx:session:export', id, filePath),
  // v2.3 — voice input: whisper transcription via the active provider (main-side creds)
  transcribeAudio: (base64Data: string, mime: string) =>
    invoke('kdx:session:transcribe', base64Data, mime),
  // ---------- v10.2 plugins ----------
  pluginsList: () => invoke('kdx:plugins:list'),
  pluginsStarters: () => invoke('kdx:plugins:starters'),
  pluginsInstallFile: (p: string) => invoke('kdx:plugins:installFile', p),
  pluginsInstallUrl: (u: string) => invoke('kdx:plugins:installUrl', u),
  pluginsInstallStarter: (id: string) => invoke('kdx:plugins:installStarter', id),
  pluginsUninstall: (id: string) => invoke('kdx:plugins:uninstall', id),
  pluginsSetEnabled: (id: string, on: boolean) => invoke('kdx:plugins:setEnabled', id, on),
  pluginsReveal: (id: string) => invoke('kdx:plugins:reveal', id),
  // ---------- v10.2 library ----------
  libraryList: () => invoke('kdx:library:list'),
  libraryForget: (id: string) => invoke('kdx:library:forget', id),
  libraryClear: () => invoke('kdx:library:clear'),
  libraryOpen: (id: string) => invoke('kdx:library:open', id),
  worktreeList: (root: string) => invoke('kdx:git:worktreeList', root),
  worktreeResolve: (root: string, name: string) => invoke('kdx:git:worktreeResolve', root, name),
  worktreeCreate: (root: string, name: string) => invoke('kdx:git:worktreeCreate', root, name),
  worktreeRemove: (root: string, name: string, force?: boolean) =>
    invoke('kdx:git:worktreeRemove', root, name, !!force),
  worktreeMerge: (root: string, name: string) => invoke('kdx:git:worktreeMerge', root, name),
  gitCommitMessage: (root: string) => invoke('kdx:git:commitMessage', root),
  gitReview: (root: string, base?: string) => invoke('kdx:git:review', root, base),
  memoryRead: (workspace: string) => invoke('kdx:memory:read', workspace),
  memoryWrite: (workspace: string, content: string) => invoke('kdx:memory:write', workspace, content),
  // licensing
  licenseGet: () => invoke('kdx:license:get'),
  licenseActivate: (key: string) => invoke('kdx:license:activate', key),
  licenseDeactivate: () => invoke('kdx:license:deactivate'),

  // local API server (programmatic control)
  apiServerGet: () => invoke('kdx:apiServer:get'),
  apiServerSet: (patch: unknown) => invoke('kdx:apiServer:set', patch),

  // v11.7 — SADEEM Remote (phone control)
  remoteGet: () => invoke('kdx:remote:get'),
  remoteSet: (patch: unknown) => invoke('kdx:remote:set', patch),

  // auth (local device accounts)
  authCurrent: () => invoke('kdx:auth:current'),
  authHasAccounts: () => invoke('kdx:auth:hasAccounts'),
  authRegister: (name: string, email: string, password: string, plan?: string) =>
    invoke('kdx:auth:register', name, email, password, plan),
  authLogin: (email: string, password: string) => invoke('kdx:auth:login', email, password),
  authLogout: () => invoke('kdx:auth:logout'),
  authStrength: (password: string) => invoke('kdx:auth:strength', password),
  // v11.3 — website-linked accounts (OpenCode-style activation)
  authWebBegin: (mode: 'signup' | 'signin') => invoke('kdx:auth:web-begin', mode),
  authWebOpen: (url: string) => invoke('kdx:auth:web-open', url),
  // v11.6 — guest pass (skip sign-in for a limited device trial window)
  authGuestBegin: () => invoke('kdx:auth:guest-begin'),
  authGuestStatus: () => invoke('kdx:auth:guest-status'),

  // v11.6 — prompt library (device-local reusable prompts)
  promptsList: () => invoke('kdx:prompts:list'),
  promptsSave: (name: string, text: string) => invoke('kdx:prompts:save', name, text),
  promptsDelete: (id: string) => invoke('kdx:prompts:delete', id),

  // v11 — auto-update (generic feed; manual check; user decides to download)
  updateStatus: () => invoke('kdx:update:status'),
  updateFeedUrl: () => invoke('kdx:update:feedUrl'),
  updateSetFeedUrl: (url: string) => invoke('kdx:update:setFeedUrl', url),
  updateCheck: () => invoke('kdx:update:check'),
  updateDownload: () => invoke('kdx:update:download'),
  updateInstall: () => invoke('kdx:update:install'),
  onUpdateStatus: (cb: (s: unknown) => void) => {
    const h = (_e: unknown, st: unknown) => cb(st);
    ipcRenderer.on('kdx:update-status', h as never);
    return () => ipcRenderer.removeListener('kdx:update-status', h as never);
  },

  // clone repository
  gitClone: (opts: unknown) => invoke('kdx:git:clone', opts),

  // events
  onAgentEvent: (cb: (e: unknown) => void) => subscribe('kdx:agent-event', cb as never),
  onTerminal: (cb: (e: unknown) => void) => subscribe('kdx:term:data', cb as never),
  onMenu: (cb: (action: string) => void) => subscribe('kdx:menu', cb as never),
  onCloneProgress: (cb: (p: unknown) => void) =>
    subscribe('kdx:clone:progress', cb as never),
  onPreviewEvent: (cb: (e: unknown) => void) => subscribe('kdx:preview:event', cb as never),
  // v11.3 — website activation landed (deep-link callback)
  onAuthChanged: (cb: (res: unknown) => void) => subscribe('kdx:auth:changed', cb as never),

  // mcp v2 (E3): health monitor, tool inspector, call log, official registry, quarantine
  mcpHealthGet: () => invoke('kdx:mcp:health:get'),
  mcpHealthCheck: (id: string) => invoke('kdx:mcp:healthCheck', id),
  mcpToolsExtended: (id: string) => invoke('kdx:mcp:toolsExtended', id),
  mcpToolEnable: (id: string, tool: string, enabled: boolean) =>
    invoke('kdx:mcp:toolEnable', id, tool, enabled),
  mcpCallLog: () => invoke('kdx:mcp:callLog'),
  mcpCallLogClear: () => invoke('kdx:mcp:callLogClear'),
  mcpRegistrySearch: (query: string, cursor?: string) => invoke('kdx:mcp:registrySearch', query, cursor),
  mcpRegistryAdd: (result: unknown, nameOverride?: string) => invoke('kdx:mcp:registryAdd', result, nameOverride),
  mcpV2SettingsGet: () => invoke('kdx:mcp:settingsGet'),
  mcpV2SettingsSet: (patch: unknown) => invoke('kdx:mcp:settingsSet', patch),
  mcpQuarantineSet: (id: string, quarantined: boolean) => invoke('kdx:mcp:quarantineSet', id, quarantined),
  mcpApprovalSet: (id: string, tool: string, decision: 'always' | 'deny' | null) =>
    invoke('kdx:mcp:approvalSet', id, tool, decision),
  // v7.3 — resolve an MCP elicitation/create request surfaced as an
  // mcp_elicitation approval card (accept/decline/cancel + optional content).
  mcpElicitDecision: (requestId: string, action: 'accept' | 'decline' | 'cancel', content?: unknown) =>
    invoke('kdx:mcp:elicitDecision', requestId, action, content),
  onMcpHealth: (cb: (e: unknown) => void) => subscribe('kdx:mcp:health', cb as never),

  // security & privacy (E4)
  termAllowOnce: (cmd: string) => invoke('kdx:term:allowOnce', cmd),
  // v11.10 — approvals manager (same stores the engine gate writes)
  approvalsList: (workspace?: string) => invoke('kdx:approvals:list', workspace),
  approvalsRevoke: (workspace: string | undefined, key: string) =>
    invoke('kdx:approvals:revoke', workspace, key),
  secStatus: () => invoke('kdx:sec:status'),
  secAuditRecent: (limit?: number) => invoke('kdx:sec:auditRecent', limit),
  secAuditClear: () => invoke('kdx:sec:auditClear'),
  secClearSessions: () => invoke('kdx:sec:clearSessions'),
  secClearMemory: (workspace?: string) => invoke('kdx:sec:clearMemory', workspace),
  secClearMcpApprovals: () => invoke('kdx:sec:clearMcpApprovals'),
  secClearApprovals: () => invoke('kdx:sec:clearApprovals'),
  secExportData: () => invoke('kdx:sec:exportData'),

  // ---------- v2.2 Surnia DNA (the closed learning loop) ----------
  dnaGet: (workspace?: string) => invoke('kdx:dna:get', workspace),
  dnaUpdate: (input: unknown) => invoke('kdx:dna:update', input),
  dnaFeedback: (kind: 'praise' | 'correction' | 'preference', note: string, context?: string) =>
    invoke('kdx:dna:feedback', { kind, note, context }),
  dnaClear: (scope: 'all' | 'workspace', workspace?: string) =>
    invoke('kdx:dna:clear', { scope, workspace }),
  dnaStats: (workspace?: string) => invoke('kdx:dna:stats', workspace),
  dnaDismissSuggestion: (patternId: string) => invoke('kdx:dna:dismissSuggestion', patternId),
  skillsTrust: (workspace: string) => invoke('kdx:skills:trust', workspace),
  // v2.2 — explicit workspace confinement (call when a workspace resolves)
  workspaceSet: (workspace: string) => invoke('kdx:workspace:set', workspace),
  onTermBlocked: (cb: (e: unknown) => void) => subscribe('kdx:term:blocked', cb as never),
  onTermWarn: (cb: (e: unknown) => void) => subscribe('kdx:term:warn', cb as never),
  onFsBlock: (cb: (e: unknown) => void) => subscribe('kdx:sec:fsBlock', cb as never),
  onSecurityEvent: (cb: (e: unknown) => void) => subscribe('kdx:sec:event', cb as never),
  // v2.2 — Surnia DNA push events (updated | refined | suggestion | skills-trust)
  onDnaEvent: (cb: (e: unknown) => void) => subscribe('kdx:dna:event', cb as never),

  // ---------- v11.12 — LIVING PLAYBOOK (signature feature) ----------
  playbookGet: (workspace?: string) => invoke('kdx:playbook:get', workspace),
  playbookHistory: (workspace?: string) => invoke('kdx:playbook:history', workspace),
  playbookMarkdown: (workspace?: string) => invoke('kdx:playbook:markdown', workspace),
  playbookClear: (workspace?: string) => invoke('kdx:playbook:clear', workspace),
  playbookUpdate: (input: unknown) => invoke('kdx:playbook:update', input),
  onPlaybookEvent: (cb: (e: unknown) => void) => subscribe('kdx:playbook:event', cb as never),

  // ---------- v11.12 — SUBAGENT DASHBOARD ----------
  subagentsList: (workspace?: string) => invoke('kdx:subagents:list', workspace),
  subagentsGet: (id: string) => invoke('kdx:subagents:get', id),
  subagentsRetry: (id: string) => invoke('kdx:subagents:retry', id),
  subagentsClear: () => invoke('kdx:subagents:clear'),
  onSubagentsEvent: (cb: (e: unknown) => void) => subscribe('kdx:subagents:event', cb as never),

  // ---------- v2.5 Flows (named reusable prompts) + hit-suggest counter ----------
  flowsList: (ws?: string) => invoke('kdx:flows:list', ws),
  flowsSave: (flow: unknown, ws?: string) => invoke('kdx:flows:save', flow, ws),
  flowsDelete: (id: string, ws?: string) => invoke('kdx:flows:delete', id, ws),
  flowsMarkRun: (id: string, ws?: string) => invoke('kdx:flows:markRun', id, ws),
  flowsHit: (text: string) => invoke('kdx:flows:hit', text),
  flowsInfo: (ws?: string) => invoke('kdx:flows:info', ws),
  flowsSuggestions: () => invoke('kdx:flows:suggestions'),
  flowsValidateByReplay: (id: string) => invoke('kdx:flows:replay', id),

  // ---------- v9 — run journal (crash-resilient progress trail) ----------
  journalList: (limit?: number) => invoke('kdx:journal:list', limit),
  journalRead: (file: string, maxLines?: number) => invoke('kdx:journal:read', file, maxLines),
};

// v2 brand: primary bridge is window.surnia; legacy alias kept for older renderer bundles.
// (v7.0.0 shipped this call duplicated — the second bind threw
// "Cannot bind an API on top of an existing property" on every boot.)
contextBridge.exposeInMainWorld('surnia', Object.freeze(api));
