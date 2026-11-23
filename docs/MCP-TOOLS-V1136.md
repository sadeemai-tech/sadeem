# MCP tools — v11.36 audit, fix & handoff / تدقيق وتصحيح وتسليم

## Blunt verdict / الحكم بوضوح

**The MCP def/dispatch layer is NOT the main bug. The ENGINE is.**
طبقة تعريف الأدوات والإرسال ليست هي المشكلة الأساسية. المشكلة في المحرّك (engine).

The founder said: *"I once told it to use Blender (an MCP server) and it couldn't. Not every MCP works."*
قال المؤسس: *"مرة حكيت له يستخدم بلندر (خادم MCP) وما استطاع. مش كل MCP يستخدمون."*

Verified facts (not guesses) / حقائق مُتحقّق منها:

| Path / المسار | Status | Evidence / الدليل |
|---|---|---|
| Def creation `mcp__<server>__<tool>` | ✅ **already lossless** | `electron/agent/tools.ts:1317-1364` `getToolDefs()` loops **all** servers × **all** tools, no `slice`/first-N; emits `name`, `[MCP · server] description`, `parameters = t.inputSchema`, `kind:'mcp'`, `mcpServerName`, `mcpToolName`. |
| Exact-name dispatch | ✅ **correct** | `tools.ts:1407-1447` resolves `getToolDefs(ctx.mcpServers).find(d => d.name === canonical)` + raw-name fallback; `tools.ts:1942-1946` routes MCP defs to `mcpTool()`; `tools.ts:7829-7865` calls `mcpCallTool()` with the raw tool name. The `mcp__` prefix is **not** dropped. |
| Honest disconnect | ✅ **honest** | `tools.ts:7835` → `MCP server "X" is not connected.` |
| No "only first N tools" | ✅ **no truncation found** | `mcp.ts:2079-2085` paginates up to 10 pages; within-server slug collisions are warned (`mcp.ts:1919-1935`), cross-server collisions warned (`mcp.ts:2371-2384`). |
| **Cold server on first run** | ❌ **REAL BUG** | `engine.ts:1784-1818`: `enabledMcp` is seeded **only** from `cachedToolsForEngine(s)` (a sync last-good cache). A configured + genuinely connected server with no cache in this process contributes **zero** defs to the first `getToolDefs()` at `engine.ts:2637`. Fire-and-forget discovery (`engine.ts:1807`) lands after the first provider request. The model cannot call a tool it was never shown → exactly the founder's symptom. |
| **Explicit Arabic request not honored by gate** | ❌ **REAL BUG** | `engine.ts:1152-1177` `mcpOptInVerdict()` only recognizes an explicit name when the string appears literally in the user text (`lower.includes(s)` / `lower.includes(t)`) or when the text contains the literal word `mcp` / `سيرفر` / `خادم`. Measured: `استخدم بلندر لرسم مشهد` with server `Blender` → `{optedIn:false, reason:'not-requested'}`, while `use blender to render a scene` → `{optedIn:true, reason:'explicit-name'}`. The founder speaks Arabic and named a Latin-named server — the gate does **not** count that as opt-in, so it still forces a per-call card (or looks like a refusal). |
| **Disconnected def → "Unknown tool"** | ⚠️ **handoff** | If a server vanishes after its def was advertised, `getToolDefs(ctx.mcpServers)` no longer contains it and `tools.ts:1427` answers `Unknown tool:` instead of the honest `mcpDisconnectedError()` added below. |

**Root cause of the founder's report = cold-start discovery + gate wording, both in `engine.ts` (owned by another agent). Defs and dispatch were already correct.**

السبب الجذري = اكتشاف بارد عند أول تشغيل + صياغة بوابة الموافقة، كلاهما في `engine.ts` (ملف يملكه وكيل آخر). التعريفات والإرسال كانا صحيحين أصلاً.

## What I changed / ما الذي غيّرته

1. **`electron/agent/tool-defs.ts:2415-2514`** — canonical, dependency-light MCP def layer:
   - `slugMcpToolName()` — same slug as `tools.ts:1297` / `mcp.ts:1915`.
   - `buildMcpToolDefs()` (`:2476`) — **every** tool of **every** connected server → real def (`name`, `[MCP · server] description`, `parameters = inputSchema`, `mcpServerName`, `mcpToolName`); zero truncation; collisions produce a loud `console.warn`, never a silent drop.
   - `mcpDisconnectedError()` (`:2512`) — honest "not connected, reconnect in Settings → MCP" string.
   - Uses template literals for names on purpose so the v1134 inventory regex keeps counting exactly **145** core defs (runtime MCP defs are not core defs).
2. **`electron/services/mcpRegistryService.ts:544-607`** — lossless connected-tools API for the agent layer:
   - `connectedServersWithTools()` (`:567`) probes every enabled server for its **full** tool list; failures land in `errors[]` with the real message — a dead server is never presented as a connected empty one. The `../agent/mcp` import is namespace-based + guarded so legacy test bundles that stub this module keep working.
   - `connectedMcpToolDefs()` (`:604`) turns that into real defs via `buildMcpToolDefs()` — no phantom defs for a disconnected server.
3. **`tests/v1136-mcp-tools.test.mjs`** — real stdio fake server with **3** tools: all 3 defs present (canonical = runtime), all 3 executed **by exact name** with markers proving `tools/call` arrived; 40 tools → 40 defs (no truncation); dead server → honest error + zero phantom defs + visible failure.
4. **`docs/MCP-TOOLS-V1136.md`** — this file.

`mcpService.ts` does not exist in this tree — nothing to patch there.

## Handoff — engine.ts owner (do NOT let this rot)

- **`engine.ts:1784-1818`**: seed `enabledMcp` synchronously from the registry's new `connectedServersWithTools()` (or `connectedMcpToolDefs()`) in addition to `cachedToolsForEngine`, so a server connected on a cold start advertises its tools in the **first** provider request. Keep the existing fire-and-forget refresh as the update path.
- **`engine.ts:1152-1177`**: treat an explicit user request as opt-in when the user names the server/tool in **any** language, including Arabic transliteration (`بلندر` ↔ `Blender`, `فيغما` ↔ `Figma`, …). Add alias/normalized matching (strip punctuation, case-fold, map common Arabic transliterations) instead of only `lower.includes(s)`; the "use … MCP" regex must also accept `استخدم بلندر` without requiring the literal word `mcp`. **The founder explicitly naming "Blender" is opt-in** — do not make him repeat it with the word "MCP".
- **`tools.ts:1427`** (tools.ts owner): for names matching `^mcp__`, answer with `mcpDisconnectedError(serverSlug)` rather than `Unknown tool:` when the server is absent, so a mid-run disconnect is honest.

## Handoff — tools.ts owner (optional one-line adoption)

`tools.ts:1346-1362` can delegate to `buildMcpToolDefs(enabledMcp)` from `tool-defs.ts` instead of its local loop — identical output (the parity test asserts schema equality), one canonical definition. Not required for correctness today; the runtime builder is already lossless.

## Verification / التحقق

```
npx tsc -p tsconfig.node.json --noEmit                       # green
node --test --test-force-exit tests/v1136-mcp-tools.test.mjs # 4/4 pass
node --test --test-force-exit tests/v1132-mcp-optin.test.mjs \
  tests/v1134-all-tools.test.mjs tests/v1131-mcp.test.mjs   # 15/15 pass
node --test --test-force-exit tests/v1131-registry.test.mjs # green (legacy stub compatible)
# combined v1131-registry + v1136 + v1132-mcp-optin + v1134 + v1131-mcp: 28/28 pass
```

Observed gate probe (engine bundle, `mcpOptInVerdict`):
- `use blender to render a scene` → `optedIn:true (explicit-name)`
- `Use the blender MCP server to render` → `optedIn:true (explicit-name)`
- `استخدم بلندر لرسم مشهد` → **`optedIn:false (not-requested)`** ← the gap to fix
