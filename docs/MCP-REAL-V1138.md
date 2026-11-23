# v11.38 — MCP REALLY WORKS / الـ MCP يشتغل فعلياً

## Blunt verdict / الحكم بوضوح

**EN:** Yes — for any MCP server whose command exists and whose own prerequisites are met, the AI can now connect, list every tool, and call it for real. This is no longer a claim about "defs being generated": `tests/v1138-mcp-real.test.mjs` starts a **real child process speaking JSON-RPC over stdin/stdout**, the client performs the real `initialize` handshake, lists 3 tools, calls `create_model`, and the child writes a marker file proving it actually created the 3D-model result. An HTTP server answered with SSE-framed JSON-RPC and was called too. A strict server that rejected the newest protocol revision was retried with an older one and still worked.

**AR:** نعم — أي سيرفر MCP أمره مثبّت ومتطلباته محققة، الذكاء يقدر يتصل فيه ويعرض كل أدواته وينفّذها فعلياً. هذا مش كلام عن "تعريفات وهمية": الاختبار `tests/v1138-mcp-real.test.mjs` يشغّل **عملية حقيقية تتكلم JSON-RPC على stdin/stdout**، العميل يعمل مصافحة `initialize` حقيقية، يعرض 3 أدوات، ينادي `create_model`، والعملية تكتب ملف إثبات إنها أنشأت نتيجة مجسم 3D. كمان اختبرنا سيرفر HTTP رد بـ SSE وتم استدعاؤه، وسيرفر رفض أحدث نسخة بروتوكول وتم الرجوع لنسخة أقدم واشتغل.

**Honest boundary / حدود صادقة:** the client cannot install Blender, install the Blender add-on, or click "Connect" inside Blender. The catalog's Blender entry still requires `uvx mcp-for-blender` + a running Blender with the add-on enabled (`src/data/mcpCatalog.ts:107-113`). If those external prerequisites are missing, you now get **one short, actionable error** instead of a multi-kilobyte stack dump. That is a prerequisite, not an MCP-client bug — Claude Code/Codex need the same Blender add-on running.

## Root cause of "every MCP server gives me a huge error" / السبب

| Cause / السبب | Before / قبل | Fix / الإصلاح |
|---|---|---|
| Cold `npx -y …` / `uvx …` first run needs tens of seconds to download/install; 10s handshake killed every child | `DEFAULT_PROBE_TIMEOUT_MS = 10_000` used for **initialize** | `DEFAULT_STARTUP_TIMEOUT_MS = 120_000` (`electron/agent/mcp.ts:94`), separate probe 30s / call 300s; explicit `server.timeoutMs` still wins (`mcp.ts:143`) |
| Strict servers reject unknown protocol revision `2025-11-25` → initialize fails | newest version only | bounded downgrade `2025-11-25 → 2025-06-18 → 2024-11-05`, only on an explicit version-rejection error (`mcp.ts:198-228`, shared by stdio/HTTP/SSE; stdio `:662`) |
| Server's Python/npm traceback or multi-JSON batch relayed verbatim into chat → "ايرور ضخم" | raw `msgOf(err)` | `mcpFriendlyError()` (`mcp.ts:160-194`): ANSI stripped, first line only, ≤420 chars + one concrete fix hint; applied at every public boundary (`mcp.ts:2555`, `:2610`, probes, handshake `:1896`) |
| Log lines / batch arrays on stdout silently dropped → "connects but no result" | only plain single-object JSON parsed | `parseRpcLine()` handles batches and a non-JSON log prefix (`mcp.ts:356-380`), dispatch refactored at `:769` |
| Vanished MCP server answered `Unknown tool: mcp__…` | cosmetic dead end | `mcpDisconnectedError()` at the single dispatch site `electron/agent/tools.ts:1418-1420` |

## What is proven / ما الذي تم إثباته

`tests/v1138-mcp-real.test.mjs` — 7/7 green:

1. **Startup budget + error shaping** — default cold-start ≥60s; a 200-line traceback becomes one ≤700-char line with no stack frames and a Settings → MCP hint.
2. **REAL stdio Blender bridge** — boots (with a non-JSON stdout log line), `initialize` → `tools/list` (3 tools) → `tools/call create_model`; result `MODEL_3D_CREATED name=cell_mitochondrion format=glb vertices=8 faces=12`; marker file includes `pid`, tool name and args.
3. **Protocol downgrade** — server rejects `2025-11-25`; wire log shows `["2025-11-25","2025-06-18"]`; list + render call succeed.
4. **Streamable HTTP** — real `http.createServer` returns `text/event-stream` JSON-RPC frames + `mcp-session-id`; client lists 3 tools, calls one, sends the negotiated `MCP-Protocol-Version` header.
5. **End to end** — real registry snapshot → 1 connected server / 3 tools / 0 errors → canonical defs → real `executeTool('mcp__blender_e2e__create_model')` → model result + marker.
6. **Disconnected** — one honest short error, 0 connected servers, 0 phantom defs, `not connected` (not `Unknown tool`).
7. Cleanup.

Existing suites stayed green: `v1138-mcp-guard` **22/22**, `v1136-mcp-tools` 4/4, `v1132-mcp-optin` 2/2, plus `v1131-mcp` 7/7, `v1123-mcp-errors` 5/5, `v1121-mcp-truth` 7/7 (32/32 combined). `tsc -p tsconfig.node.json --noEmit` green.

## Files changed / الملفات المعدّلة

- `electron/agent/mcp.ts` — client layer only (timeouts, handshake fallback, framing, friendly errors).
- `electron/agent/tools.ts:1418-1420` — F2 single-site honest disconnect (explicitly authorised follow-up).
- `tests/v1138-mcp-real.test.mjs` — new real-protocol proof.
- `docs/MCP-REAL-V1138.md` — this file.
- `electron/agent/tool-defs.ts` MCP area left unchanged (canonical builder already lossless).
- `electron/agent/mcpOAuth.ts` left unchanged (audited: token refresh is already bounded and case-insensitive header merging is correct).

## Handoff — engine owner (NOT edited here) / تسليم لمالك المحرك

1. **`electron/agent/engine.ts:249`** — `MCP_DISCOVERY_TIMEOUT_MS = 3_000` still caps `connectedServersWithTools()` (`:2080-2084`) and `mcpListTools()` (`:2103-2107`). Under parallel test load this occasionally drops the cold snapshot and the first request advertises 0 MCP tools (observed once: `MCP_UNPROMPTED {"advertised":false}` in a concurrent run; passes in isolation and in the standard 6-file run). Raise this to ~10s **or** await one bounded cold probe before the first `getToolDefs()`; keep the fire-and-forget refresh as the update path. The generous client budget above only helps if the engine actually waits for it.
2. **`electron/agent/engine.ts:1356-1395`** (`mcpNameAliases` / opt-in verdict) — verified still correct: `استخدم بلندر` and `use blender` both opt in; `v1132-mcp-optin` 2/2. Do not regress it.
3. **Blender prerequisites** — catalog note at `src/data/mcpCatalog.ts:111` is accurate; no code change can make a Blender add-on install itself. Consider surfacing that one-line setup hint in the disconnect error UI.
