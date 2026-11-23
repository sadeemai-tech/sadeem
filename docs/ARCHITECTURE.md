# Kodex — Architecture

Kodex is an Electron desktop application built from three isolated processes. All privileged work (filesystem, shell, git, network to providers) happens in the main process; the renderer is a React application that only talks over typed IPC; the preload script is the single, minimal bridge between them.

## Process Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Electron Main (Node.js)                       │
│                                                                      │
│  electron/ipc.ts        channel registry — routes invoke() calls     │
│  electron/agent/        agentic engine                               │
│    engine.ts            agent loop, event stream, approvals, usage   │
│    providers/*          wire protocols (anthropic | openai), SSE     │
│    tools.ts             tool implementations + tool schemas          │
│    mcp.ts               MCP client (stdio servers, tool discovery)   │
│  electron/services/     fs, git (spawned git), terminal (pty),       │
│                         sessions, checkpoints, settings, licensing   │
└───────────────▲───────────────────────────────────┬──────────────────┘
                │ ipcRenderer.invoke / .on          │
┌───────────────┴───────────────────────────────────▼──────────────────┐
│                    Preload (contextBridge → window.kodex)            │
│  electron/preload.ts — whitelisted channels only, no Node in renderer│
└───────────────▲───────────────────────────────────┬──────────────────┘
                │ window.kodex (typed as KodexAPI)  │
┌───────────────┴───────────────────────────────────▼──────────────────┐
│                       Renderer (React + Vite)                        │
│  src/store.ts     zustand store — single source of truth             │
│  src/lib/api.ts   typed facade over window.kodex                     │
│  src/components/* TitleBar, Rail, Sidebar, EditorArea (Monaco),      │
│                   TerminalView (xterm.js), ChatPanel, DiffModal,     │
│                   CommandPalette, ModelPicker, SettingsModal,        │
│                   PlansScreen, Onboarding, StatusBar                 │
│  src/i18n.ts      AR/EN dictionary + RTL direction handling          │
└──────────────────────────────────────────────────────────────────────┘
```

Key invariant: `electron/preload.ts` must stay in sync with `src/lib/api.ts` (the `KodexAPI` type) and `electron/ipc.ts`. The renderer never accesses Node APIs.

## File Map

| Path | Role |
|---|---|
| `shared/types.ts` | Single source of truth for all cross-process types (settings, agent events, sessions, git, licensing) |
| `electron/preload.ts` | contextBridge exposing the whitelisted `window.kodex` API |
| `electron/ipc.ts` | IPC channel handlers delegating to agent + services |
| `electron/agent/engine.ts` | Agent loop: model turns, tool dispatch, approval gating, usage accounting, event emission |
| `electron/agent/providers/` | Provider presets and wire-protocol clients (anthropic / openai), SSE streaming |
| `electron/agent/tools.ts` | Built-in tools (read, write, edit, search, shell, task) and their JSON schemas |
| `electron/agent/mcp.ts` | MCP stdio client: launch server, list tools, call tools |
| `electron/services/` | fs, git, terminal, sessions, checkpoints, settings (safeStorage encryption), licensing |
| `src/store.ts` | Zustand store: settings, sessions, tabs, agent state, git, terminal, UI state; `sendMessage` → `api.agentRun`, `ingestAgentEvent` |
| `src/lib/api.ts` | `KodexAPI` interface + `window.kodex` access |
| `src/components/*` | All UI; `DiffModal` renders write-approval diffs; `ChatPanel` renders the event stream |
| `src/i18n.ts` | `t(key)` dictionary of `[en, ar]` pairs; drives `dir="rtl"` |

## IPC Channel Table

All channels are `invoke`-style request/response unless marked **event** (main → renderer push).

| Channel | Direction | Purpose |
|---|---|---|
| `kdx:win` | R→M | Window controls: `min` / `max` / `close` |
| `kdx:dialog:openFolder` | R→M | Native folder picker |
| `kdx:openExternal` | R→M | Open a URL in the system browser |
| `kdx:fs:readDir` | R→M | Recursive file tree for the workspace |
| `kdx:fs:readFile` / `writeFile` | R→M | File I/O (editor tabs, agent writes) |
| `kdx:fs:createFile` / `createDir` / `deletePath` / `renamePath` | R→M | Tree mutations (delete goes through approval) |
| `kdx:fs:searchFiles` | R→M | Text search returning `SearchHit[]` |
| `kdx:term:create` | R→M | Spawn a terminal in a cwd, returns `terminalId` |
| `kdx:term:exec` | R→M | Write a command line to the terminal |
| `kdx:term:interrupt` | R→M | Send interrupt (Ctrl+C) to the shell |
| `kdx:term:data` | **event** | Terminal output chunks `{ terminalId, data }` |
| `kdx:git:status` | R→M | Branch + changed files |
| `kdx:git:diff` | R→M | Per-file unified patches |
| `kdx:git:stage` / `commit` / `init` / `log` / `checkout` | R→M | Standard git operations |
| `kdx:settings:get` / `save` | R→M | Settings load/persist (keys encrypted) |
| `kdx:sessions:list` / `load` / `save` / `delete` | R→M | Chat session persistence |
| `kdx:agent:run` | R→M | Start an agent turn (`AgentRunParams`) |
| `kdx:agent:abort` | R→M | Abort the running turn |
| `kdx:agent:approval` | R→M | Resolve a pending approval (`allow` / `deny` / `always`) |
| `kdx:agent-event` | **event** | `AgentEvent` stream (deltas, tool calls, approvals, todos, usage, errors) |
| `kdx:cp:create` / `list` / `restore` | R→M | Checkpoint snapshot/restore |
| `kdx:mcp:test` | R→M | Launch an MCP server, return its tools |
| `kdx:provider:verify` | R→M | Validate a provider key/base URL, optionally list models |
| `kdx:license:get` / `activate` | R→M | Licensing state and offline key activation |
| `kdx:menu` | **event** | Native menu actions forwarded to the renderer |

## Agent Loop

```
 User types in ChatPanel
        │
        ▼
 store.sendMessage(text) ─── slash commands handled locally (/init /compact /model …)
        │  free-plan daily gate (usageLog, 15 runs)
        ▼
 api.agentRun(AgentRunParams)                (renderer → main, kdx:agent:run)
        │
        ▼
┌─ engine loop (main) ────────────────────────────────────────────────┐
│  1. build context: messages + MEMORY.md + tool schemas (+ MCP tools)│
│  2. provider.stream(model, messages)                                │
│        ⇅ SSE: text_delta / tool_use deltas → accumulated            │
│  3. for each tool call:                                             │
│       permission check (mode + rules)                               │
│         ├─ needs approval → approval_request event                  │
│       │      renderer shows DiffModal / command dialog              │
│       │      user → kdx:agent:approval (allow/deny/always)          │
│       └─ execute via tools.ts (or mcp.ts) → tool_result event       │
│  4. append results, loop until model returns no tool calls          │
│  5. emit message_end (usage) and turn_end                           │
└──────────────┬──────────────────────────────────────────────────────┘
               │  kdx:agent-event (AgentEvent union)
               ▼
 store.ingestAgentEvent(e) ── updates messages, todos, usage, approvals
        │
        ├── ChatPanel renders text / tool activity / todos
        └── DiffModal renders write-approval diffs (Approve / Deny)
```

`AgentEvent` variants: `text_delta`, `tool_start`, `tool_result`, `message_end`, `turn_end`, `error`, `approval_request`, `todo`, `compaction_done`, `aborted`.

## Permission Model

| Mode | File writes | Commands (shell) | MCP tools | Delete |
|---|---|---|---|---|
| `default` (Ask) | Approval with visual diff | Approval with full command | Approval | Approval |
| `autoEdit` | Auto-approved, shown as diff | Approval | Approval | Approval |
| `fullAccess` | Auto-approved | Auto-approved | Auto-approved | Auto-approved |

Decisions: `allow` (once), `deny` (once), `always` (remembered for the tool in this workspace). The `delete` class always routes through approval outside `fullAccess`; workspace-wide auto-approve of edits can also be toggled in settings (`autoApproveEdits`). Checkpoints are created before agent edits when `checkpointsEnabled` is set.

## Provider Protocol Notes

Two wire protocols cover all providers (see `docs/RESEARCH.md` for endpoints and pricing):

- **Anthropic protocol** (`anthropic`): `POST /v1/messages` with `x-api-key` and `anthropic-version: 2023-06-01`. Stream events are strongly typed: `message_start`, then `content_block_start` (type `tool_use`), `input_json_delta` fragments accumulated into tool arguments, `message_delta` carrying cumulative usage. Tool results return as a **user** message containing `tool_result` blocks. Implemented in `electron/agent/providers` for Anthropic.
- **OpenAI protocol** (`openai`): `POST /v1/chat/completions` with `Authorization: Bearer`. Streaming `tool_calls` deltas accumulate by `index`; the stream ends with `[DONE]`. Reused for OpenAI, OpenRouter, Gemini (compatibility endpoint), Z.ai, DeepSeek, Ollama, and any custom base URL.

Provider presets (`ProviderPreset`) define id, label, base URL, protocol, default models, and whether the provider is keyless (`ollama`). `kdx:provider:verify` validates credentials before saving.

## Data Storage Locations

All persistent state lives under the Electron `userData` directory (`%APPDATA%/Kodex` on Windows, `~/Library/Application Support/Kodex` on macOS, `~/.config/Kodex` on Linux) plus the open workspace.

| Location | Contents |
|---|---|
| `userData/settings.json` | `AppSettings`: language, theme, permission mode, model, provider keys (**encrypted via safeStorage when available**), font sizes, MCP servers, billing fields, usage log (free-plan counter) |
| `userData/sessions/` | One JSON per chat session: messages, todos, token/cost totals, model, workspace |
| `userData/checkpoints/` (keyed by workspace) | Checkpoint snapshots: changed files + metadata (`CheckpointInfo`), enabling restore |
| `<workspace>/MEMORY.md` | Project memory generated by `/init`, injected into every agent run |
