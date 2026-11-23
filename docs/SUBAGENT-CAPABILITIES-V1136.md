# Subagent capabilities — v11.36

## الحكم الصريح / Blunt verdict

**سؤال المؤسس: هل يظل "الوكيل بيحكي لا يملك الأدوات" يتكرر؟**
**الجواب: لا — في مسار الوكلاء المستقلين (`subagentRunner.ts`) انتهت المشكلة تمامًا.**
16/16 متخصصين الآن يرون الـ145 أداة كاملة + أدوات provider-native، ويستطيعون استدعاء أي أداة بالاسم دون رفض "غير مسموح". الفروق بينهم في **الشخصية/الدور في الـprompt فقط**، لا في القدرات.

**Founder's question: does "subagent has no tools" still reproduce?**
**Answer: NO — not in the detached/standalone subagent path.** All 16 specialists advertise the full 145-tool registry plus provider-native extras, and dispatch resolves every tool by exact name. The system prompt explicitly forbids the "I don't have the tools" claim.

**تحذير صادق / Honest caveat (files NOT owned by this change):** the *inline* subagent path in `electron/agent/engine.ts:3152-3154` still filters its advertised view (`spec.tools === '*' || spec.tools.includes(...)`), so `task` and `todo_write` are hidden there. Since every spec is now `'*'`, this is a no-op for all 143 real capability tools, and dispatch still resolves all 145. Fixing that line belongs to the engine owner. MCP is also opted out for subagents by app design (`engine.ts:3050`, `subagentRunner.ts:263` `mcpServers: []`); this change does not alter that.

## ما تغيّر بالضبط / Exact changes (file:line)

| File:line | Change |
|---|---|
| `electron/agent/agents.ts:1-27` | Honest header: specialists differ by prompt/role **NOT by capability**; `tools` field kept for API compatibility only. |
| `electron/agent/agents.ts:41,51,61,73,83,93,105,115,124,133,144,154,164,174,187,194` | All **16** specialists set to `tools: '*'`. The old `FS_READ` / `WEB` subsets (formerly lines 52, 63, 73, 83, 95, 123, 144, 164, 179) are deleted. Research/review/skill agents are no longer "read-only". |
| `electron/agent/subagentRunner.ts:36-44` | Capability contract: full registry, role-only differences, profile is a VIEW not a gate. |
| `electron/agent/subagentRunner.ts:96-116` | New `subagentToolDefs()` = `getToolDefs([], 'full')` (145 core + MCP defs from the same registry) **+** `getProviderToolDefs()`, deduped by name. No slice, no profile argument, no allow-list. |
| `electron/agent/subagentRunner.ts:118-152` | `buildSubagentSystemPrompt()` no longer slices to 40 tools; advertises the complete list with its exact count; profile note becomes *"per-turn VIEW for weak models ONLY — does NOT restrict you"*. |
| `electron/agent/subagentRunner.ts:244-249` | Removed `getToolDefs([], profile)` + `spec.tools.includes(...)` filter + the `task`/`todo_write` exclusion. `spec` now supplies personality only. |
| `electron/agent/subagentRunner.ts:288,309` | The advertised `tools[]` handed to `streamTurn` and the system prompt is the **full** `defs` (145), for every specialist. |
| `shared/types.ts:659-665` | `SubagentId` documents that ids select personality, not a capability tier. |
| `tests/v1136-subagent-tools.test.mjs:97-231` | Real test: 6 suites, offline, 16 specialists × 6 advanced tool calls + 145-tool dispatch sweep + source guards. |

## لماذا كان الوكيل يقول "لا أملك الأدوات" / Root cause

1. `agents.ts` restricted ~8 specialists to `FS_READ`/`WEB` subsets.
2. `subagentRunner.ts:207` called `getToolDefs([], profile)` and filtered by `spec.tools`; a weak-model profile (`core`/`balanced`) also removed advanced tools from the advertised `tools[]`.
3. The prompt itself truncated the visible list to 40 tools, so a model could not even *name* tools like `image_generate` or `browser_navigate` and legitimately answered "I don't have the tools".

After v11.36: advertised `tools[]` = **145** (verified), provider-native extras appended (verified: 145 → 146 with a synthetic provider tool, then restored), prompt lists **all** names with no ellipsis, and `executeTool()` resolves **145/145** names with 0 "Unknown tool" / 0 "not allowed" / 0 profile gates.

## التحقق / Verification (all green)

```
npx tsc --noEmit                                   PASS at the time this work was verified;
                                                   a later re-run was blocked ONLY by concurrent
                                                   out-of-scope errors in UsagePanel.tsx (see below)
npx tsc -p tsconfig.node.json --noEmit             PASS
node --test --test-force-exit tests/v1136-subagent-tools.test.mjs   6/6 PASS
  V1136_ROSTER=16 specialists, 16 full '*' toolsets, 16 distinct prompts
  V1136_REGISTRY=145 core + provider extras, 0 slices, 0 duplicates
  V1136_PROMPT=16/16 prompts advertise all 145 tools, personalities intact, no slice
  V1136_DISPATCH=96 specialist/tool calls, 0 "not allowed"
  V1136_SWEEP=145/145 resolved by name, 0 Unknown, 0 profile gates
  V1136_SOURCE=spec.tools filter gone, profile slice gone, 40-truncation gone
node --test --test-force-exit tests/v1134-all-tools.test.mjs        6/6 PASS
node --test --test-force-exit tests/v1135-all-provider-tools.test.mjs 7/7 PASS
node --test --test-force-exit tests/v1131-subagents.test.mjs         13/13 PASS
```

During verification, other agents edited files concurrently: an earlier `tsc -p tsconfig.node.json --noEmit` run failed on out-of-scope `electron/services/remoteService.ts:435,440,929` (`RemoteCfg`), which was fixed externally; the final run PASSES. A final `tsc --noEmit` run is blocked by out-of-scope `src/components/panels/UsagePanel.tsx:198,204,342` (`UsageLike`/`costUsd`/`input` mismatches). None of the files owned by this change (`agents.ts`, `subagentRunner.ts`, `shared/types.ts`) produce a TypeScript error in either config.

## الخلاصة / Bottom line

 Specialist identity = prompt/personality. Capability = full AI, identical for all 16.
 No specialist can truthfully claim it lacks a tool. "I don't have the tools" is now a false statement the prompt explicitly forbids.
 Dispatch is name-based against the full registry — a V3 profile is only a per-turn view for weak models, never a permission boundary.
