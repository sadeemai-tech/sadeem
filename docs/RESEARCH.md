# Kodex — Competitive Research Digest

Fact sheet compiled from the public documentation and behavior of the leading agentic coding tools. Facts are listed as documented; no claims beyond them. Kodex-facing conclusions live in the final section.

---

## Claude Code (Anthropic)

| Area | Documented behavior |
|---|---|
| Agentic toolset | `Read`, `Write`, `Edit`, `Bash`, `WebFetch`, `Todo`, and `Task` (spawning subagents) |
| Permission modes | `default` / `acceptEdits` / `plan` / `bypassPermissions`, cycled with `Shift+Tab` |
| Permission rules | Rule syntax `Tool(specifier)`; precedence `deny` > `ask` > `allow` |
| Project memory | `CLAUDE.md` hierarchy (enterprise / user / project) generated and refreshed with `/init` |
| Context management | Auto-compaction, plus manual `/compact` and `/context` inspection |
| Subagents | Run with their own context windows, isolated from the main thread |
| Safety net | Checkpoints with `/rewind` to restore prior states |
| Hooks | Lifecycle events such as `PreToolUse` / `PostToolUse` for user-defined shell reactions |
| Extensibility | MCP client over stdio / HTTP (incl. OAuth); skills and custom slash commands |
| UX details | Queued messages while a turn is running; transcript viewer |
| Sandboxing | Sandbox mode with protected paths |
| Automation | Headless `-p` mode emitting JSON; official GitHub Actions integration |
| IDE | VS Code and JetBrains extensions |
| Pricing | Subscriptions: Pro $20 / Max $100 / Ultra $200; or per-token API billing |

## Codex CLI (OpenAI)

| Area | Documented behavior |
|---|---|
| Surfaces | Rust CLI + IDE extension + cloud tasks + desktop app |
| Sandbox modes | `read-only` / `workspace-write` / `danger-full-access`, enforced by OS-native mechanisms: Seatbelt (macOS), Landlock + seccomp (Linux), Windows restricted token |
| Approval policies | `untrusted` / `on-request` / granular / `never` |
| Project memory | `AGENTS.md` discovery walking root → cwd, with per-directory overrides and a global file |
| Diffs | `/diff` includes untracked files; `codex apply` applies a suggested diff |
| Review | `/review` invokes a review agent |
| Sessions | Resume and fork of prior sessions; automatic `/compact` |
| Extensibility | MCP client |
| Model control | In-session model + reasoning-effort picker |
| Usage meters | `/usage` shows 5-hour and weekly meters |
| Automation | `codex exec --json` headless mode |
| Pricing | ChatGPT plan-based usage, or bring an API key |

## OpenCode + Others

**OpenCode**

- Client/server architecture: local HTTP + SSE stream, with an OpenAPI-generated SDK.
- 75+ providers resolved through models.dev.
- Persistent sessions; themes; per-tool permission rules with wildcard specifiers.
- Plugin system and LSP integration.

**Aider**

- Repo map: a compact, ranked representation of the repository injected into context.
- Automatic git commits per change set; multiple chat modes (e.g. ask vs. code).

**Gemini CLI**

- `GEMINI.md` project memory file; checkpoints for restoration; extension system.

**Crush**

- Mid-session model switching without losing the conversation.

**Cursor CLI**

- ACP (Agent Client Protocol) support; headless operation.

## Common Core Across All Tools

- Agentic loop: model + file read/edit tools + shell execution, iterating until the task completes.
- An approval / permission layer gating writes and commands, with an "auto" escape hatch.
- Context management: compaction commands and/or automatic summarization.
- A project memory file injected into context (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`).
- MCP as the common extensibility protocol.
- A headless / non-interactive mode for automation and CI.
- Usage and cost visibility per session.
- Some form of checkpoint / rewind safety net.
- Git integration as a first-class citizen, not an afterthought.

## Provider Cheat Sheet

| Provider | Base URL | Auth | Protocol notes | Models / pricing (per MTok) |
|---|---|---|---|---|
| Anthropic | `https://api.anthropic.com/v1/messages` | `x-api-key` header + `anthropic-version: 2023-06-01` | SSE events: `message_start`; `content_block_start` with `tool_use`; accumulate `input_json_delta` fragments; `message_delta` carries cumulative usage. Tool results are sent back as a **user** message (`tool_result` blocks). | `claude-sonnet-4-5` $3 / $15; `claude-haiku-4-5` $1 / $5 |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `Authorization: Bearer <key>` | SSE chunks; `tool_calls` deltas accumulate by `index`; stream terminates with `[DONE]`. | `gpt-5.1` $1.25 / $10 |
| OpenRouter | `https://openrouter.ai/api/v1` | Bearer | OpenAI-compatible; model ids as `vendor/model`. | Varies by routed model |
| Ollama | `http://localhost:11434/v1` | None (local) | OpenAI-compatible; model listing at `/api/tags`. | Free, local |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | API key | OpenAI-compatible compatibility layer. | Varies |
| Z.ai | `https://api.z.ai/api/paas/v4` | API key | OpenAI-compatible. | `glm-4.6` $0.6 / $2.2 |
| DeepSeek | `https://api.deepseek.com/v1` | Bearer | OpenAI-compatible. | Varies |

Practical implication for Kodex: two protocol implementations (Anthropic, OpenAI-compatible) cover all seven providers; only the Anthropic stream differs materially (event typing, JSON-delta accumulation, tool_result as a user message).

## How Kodex Answers

| Capability seen in competitors | Kodex implementation | Where |
|---|---|---|
| Agentic tool loop (Read/Write/Edit/Bash/…) | Native tool engine with the same core toolset | `electron/agent/tools.ts` |
| Permission modes | Three modes — Ask (`default`), Auto-edit (`autoEdit`), Full access (`fullAccess`) — with per-request allow/deny/always | `shared/types.ts` (`PermissionMode`), approval flow over IPC |
| Visual diff review | Every proposed edit opens a side-by-side diff with Approve/Deny | `src/components/DiffModal` (`DiffViewRequest`) |
| Project memory (`CLAUDE.md`-style) | `MEMORY.md` generated by `/init`, injected into agent runs | `MEMORY.md` + `AgentRunParams.memory` |
| Context compaction | `/compact` runs a summarization pass and emits `compaction_done` | Compaction task in the engine |
| MCP extensibility | MCP server registry with connection test and tool discovery, surfaced in a dedicated panel | `kdx:mcp:test`, MCP panel (`rail.mcp`) |
| Subagents (`Task`) | Subagent delegation via the task tool inside the engine | `electron/agent/tools.ts` (task tool) |
| Checkpoints / rewind | Automatic checkpoints before agent edits, restorable on demand | `kdx:cp:create/list/restore` services |
| Bilingual + RTL | Full AR/EN interface with RTL, bilingual from onboarding to settings | `src/i18n.ts` |
| Multi-provider | Both wire protocols behind one provider preset layer, including local Ollama and custom base URLs | `electron/agent/providers` + `ProviderPreset` |
