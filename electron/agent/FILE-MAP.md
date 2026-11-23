# SADEEM — Agent Architecture Map (v11.12)

خريطة ملاحية سريعة لطبقة الوكيل — للبشر وللنماذج اللغوية التي تقرأ الشجرة.
Quick navigation map for the agent layer — for humans and for LLMs reading the tree.

## The three big modules (post v11.12 split)

| File | Lines (approx) | What lives here |
|---|---|---|
| `electron/agent/tool-defs.ts` | ~1,590 | **The 118 tool DEFINITIONS** (name/description/JSON-schema/kind). Pure data — no logic. `fs` 43 · `exec` 49 · `meta` 26. |
| `electron/agent/tools.ts` | ~9,700 | **Tool EXECUTION**: `executeTool` dispatch switch + every executor + path jail (`resolveInWorkspace`), repair layer call-in, permission gates, executors for fs/exec/web/mcp/media. |
| `electron/agent/engine.ts` | ~5,670 | **The run loop**: `runAgent` entry, streaming turn loop, retry/failover ladder, watchdogs, permission decisions, plan/debug/review mode contracts, `emitTaskReport` (guaranteed end-of-run report), journal, DNA/skill hooks, preview auto-open. |

## Everything else (one line each)

- `providers.ts` — LLM providers: OpenAI-compatible + Anthropic SSE clients, byte watchdog, request builders, usage. **Pure node, no electron.**
- `prompts.ts` — system prompt builder + `TASK_MODE_SPECS` (build/plan/debug/review contracts) + denial hints.
- `register.ts` — the bridge: IPC handlers (kdx:agent:run/abort/…) → `runAgent(params, io)`; event coalescing to the renderer.
- `journal.ts` — crash-resilient JSONL run journal (tool outcomes, task_report, finish line).
- `skills.ts` — SKILL.md library: list/save/use/distill from successful sessions.
- `dna.ts` — the persistent user model (patterns/profile/feedback) + extraction loop.
- `mcp.ts` — MCP servers: stdio/HTTP transports, tool discovery, calls, OAuth.
- `editEngine.ts` — write/edit machinery + `repairToolArgsJson` (tolerant JSON repair: fences, smart quotes, single quotes, trailing commas, truncation).
- `agents.ts` — specialist roster (subagents) + `rosterLine()`.
- `verification.ts` — red→green verify loop, mutation checks, claim audit.
- `review.ts` — structured diff review (findings → ReviewCard in the UI).
- `contextStore.ts` — log shaping + recall vault (long outputs → head/tail + recall id).
- `router.ts` — model roles (plan/search/edit/verify) routing.
- `cli.ts` — the headless CLI (`dist-cli/kodex.cjs`), embeds an electron stub.

## Renderer contract (src/)

- `src/store.ts` — zustand store; `ingestAgentEvent` maps every engine event.
- `src/lib/providerSlice.ts` — canonical provider/model derivation (lastModels → legacy models → curated presets → active model).
- `src/components/MessageView.tsx` — `TaskReportCard` (guaranteed completion report, tools-used chips, NOT-DONE section), tool rows, diffs.
- `src/lib/modes.ts` — canonical mode orders + per-tool approval scope derivation.

## The guarantees (v11.11/v11.12 contract)

1. **Every run terminates with a `task_report`** (engine try/catch/finally + register bridge gaps closed) — completed, error, aborted, all reported.
2. **Plan mode always produces a visible plan card** (model text, or a harness-synthesized trace fallback) + `plan.md` written by the harness when the model didn't.
3. **Debug mode always emits a debug report notice**; review mode emits `review_findings` (ReviewCard).
4. **Tool failures teach**: unknown tool → "did you mean"; malformed JSON → repair + corrective re-emit instruction; dropped fences → visible marker + notice.
5. **The renderer never swallows terminal events** — even with no session loaded, `running` clears and the report lands.
6. **A crashing panel cannot kill the app** — `SurfaceErrorBoundary` wraps chat/editor/preview.
