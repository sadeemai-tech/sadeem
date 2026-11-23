# Integration / Collision Audit — v11.36 (DIAGNOSIS ONLY)

- **Auditor:** INTEGRATION AUDITOR subagent (no app source edited; only this doc was written)
- **Last run:** 2026-11-21 22:54 local. Siblings were **still writing during every pass** — this is a moving tree.
- **Tree:** `sadeem-v11.12.0` (v11.36 WIP, 13 sibling agents editing concurrently)
- **Status:** ❌ **OPEN BUILD COLLISION** — `tsc --noEmit -p tsconfig.json` fails on the `flowsMarkRun` contract (§2 C3). Two earlier collisions (C1/C1b) were found live and **fixed by the owning agent** during the audit. The D3 child-session guard now **PASSES**.

> **Blunt summary:** Structural hygiene is clean — 0 duplicate i18n keys, 0 duplicate store fields, 0 duplicate type names, 0 import cycles, tool inventory stable at **145**, all new v1136 test files present with resolvable imports. The problems are **cross-file contract drift** between agents, not duplicate declarations. Three contract collisions were observed; one remains open.

---

## 1. Command results (latest pass, 22:54)

| Check | Command | Result |
|---|---|---|
| App typecheck | `npx tsc --noEmit -p tsconfig.json` | ❌ **FAIL** — `TS2367` at `src/components/panels/FlowsPanel.tsx:558` (C3) |
| Node typecheck | `npx tsc -p tsconfig.node.json --noEmit` | ✅ PASS (exit 0) |
| Tool inventory | `node scripts/gen-tool-inventory.mjs` | ✅ **145 tools** `{"fs":55,"exec":60,"meta":30}` — no drift |
| Duplicate i18n keys | analyzer over `src/i18n.ts` | ✅ 2172 keys, **0 duplicates** |
| Duplicate store fields | analyzer over `src/store.ts` state interfaces | ✅ 222 fields, **0 duplicates** |
| Duplicate type declarations | analyzer over `shared/types.ts` | ✅ **0 real** (the 1 duplicate name is an intentional merge, §3) |
| Import resolution | 12 actively-edited TS/TSX modules | ✅ all relative imports resolve |
| Import cycles | actively-edited module graph | ✅ none |
| Conflict markers | `<<<<<<<`/`=======`/`>>>>>>>` in source | ✅ none |
| D3 child-session guard | `node tests-v1136-child-session-guard.mjs` | ✅ **PASS** (was FAIL/13 then FAIL/9 earlier — D3 landed mid-audit) |

---

## 2. COLLISION TABLE

| # | file:line → symptom | Likely agents that collided | Status / suggested owner |
|---|---|---|---|
| **C3 — OPEN** | `src/components/panels/FlowsPanel.tsx:556-558`: `const marked = await flowsApi.flowsMarkRun?.(...); recorded = marked === true;` → `TS2367: types 'void \| undefined' and 'boolean' have no overlap`. Root cause: `src/lib/api.ts:697` declares `flowsMarkRun(id, ws?): Promise<void>`, but `electron/services/flowsService.ts:390` returns `Promise<boolean>` and `electron/preload.ts:391` forwards the real result. | **Flows-panel agent** (new honest "not recorded" consumer) vs **renderer API / IPC agent** (stale `Promise<void>` signature in `api.ts`). | **Owner: whoever owns `src/lib/api.ts`.** Change L697 to `flowsMarkRun(id: string, ws?: string): Promise<boolean>;`. Do NOT downgrade the Flows panel — its comment (`:552-553`) explicitly requires a real bump result instead of a fake counter bump. |
| **C2 — OPEN (non-build, refactor debt)** | Child-session tool-call fact implemented **three ways**: (a) `SubagentEvent` has `toolCall?` **and** `call?`, `type: ... 'tool' \| 'toolcall'` at `shared/types.ts:335-343`; emitter `electron/agent/subagents.ts:277,307-321` uses `emit('toolcall', rec, { id, call })`; consumer `src/store.ts:2758-2769` reads `e.call ?? e.toolCall`. (b) `SubagentProgressEvent.toolCall` `shared/types.ts:360`, emitted `subagents.ts:403`, consumed `src/store.ts:4829-4831`. (c) `AgentEvent.subagent_toolcall` `shared/types.ts:494`, consumed `src/store.ts:4849-4861`. | ≥2 D3/child-session agents each invented a transport name (`call` vs `toolCall`; `toolcall` vs `tool` vs `subagent_toolcall`); a defensive alias was bolted on to make it compile. | **Owner: one D3 owner** to consolidate to the canonical `subagent_toolcall` + `call` path from `subagents.ts:320`; delete the `tool`/`toolCall` aliases and the dead branch at `store.ts:2758`. Build is green for this one — it is duplicated logic, not a type error. |
| **C1 / C1b — RESOLVED ✅** | `src/components/panels/UsagePanel.tsx:198-203` passed an object without `costUsd` to `billedSegments(u: UsageLike)` (`UsageLike = Usage & {...}`, `shared/types.ts:60` makes `costUsd` required) → `TS2345`. And `:109-112` `billedSegments` returned `{ fresh, ... }` while `:130-133` `priceCostUsd` expected `{ input, ... }`; call sites `:204`,`:342` passed `segs` → `TS2345`. | Usage-panel agent vs shared-types / cost-precision agent (`Usage.costUsd` required; `fresh`→`input` rename). | **Fixed by the Usage-panel agent at 22:49:56** (file mtime). `tsc` went 3 errors → 1 → 0 for these. No action needed; listed for the record. |
| **C4 — transient, self-fixed** | `FlowsPanel.tsx:88` (`"recorded"` vs status union) at 22:51, then `FlowsPanel.tsx:545` (`void\|undefined` vs `boolean`) at 22:52 — both appeared and disappeared as the Flows agent edited live. | Flows-panel agent, mid-write. | No action — in-flight churn, not a settled collision. Included so the parent does not re-report it. |

---

## 3. Watch items — checked, NOT defects (do not "fix")

| file:line | Observation | Why it is fine |
|---|---|---|
| `shared/types.ts:307` and `:334` | `SubagentRecord` declared twice. | **Intentional declaration merging** — documented at `:326-332` ("ADDITIVE per-agent transcript"). `tsc` green. Duplicate-name scanners will false-positive here. |
| `console.css:20-23` vs `type-scale.css:67-81` | `--chat-base` 14 vs 16.75px, `--chat-ui` 13 vs 16px, `--chat-meta` 12 vs 14.5px. | Deliberate cascade: console.css baseline on `.chat-panel-root`; type-scale.css overrides on `html .chat-panel-root` (higher specificity). Documented at `type-scale.css:83-84`, `:166-170`. |
| `chat-final.css:750`, `console.css:491`, `chat-art.css:95`, `chat.css:1008` | `.tl2-pill` in 4 sheets. | Cascade layering (base / ::after motion / status); no conflicting property values. |
| `tests-v1136-child-session-guard.mjs` | Exited 1/FAIL (13 → 9 gates) earlier; now **PASS / 0 failures**. | Pre-D3 guard written to fail until D3 landed. It flipped green on its own during the audit — strongest evidence sibling edits integrated correctly. |

---

## 4. New v1136 artifacts — existence & import resolution

All 8 discovered v1136 test files exist; all imports resolve. 7/8 pass; the historically-failing guard now passes too.

| Test file | Result |
|---|---|
| `tests/v1136-chat-font.test.mjs` | ✅ 11/11 |
| `tests/v1136-interruption.test.mjs` | ✅ 2/2 |
| `tests/v1136-interruption-guard.test.mjs` | ✅ 1/1 |
| `tests/v1136-mcp-tools.test.mjs` | ✅ 4/4 |
| `tests/v1136-subagent-tools.test.mjs` | ✅ 6/6 |
| `tests/v1136-subagent-tools-guard.test.mjs` | ✅ 5/5 |
| `tests-v1136-context-precision.mjs` | ✅ 13/13 |
| `tests-v1136-child-session-guard.mjs` | ✅ PASS (0 gates failed) |

New docs observed landing: `CONTEXT-PRECISION-V1136.md`, `MCP-TOOLS-V1136.md`, `INTERRUPTION-GUARD-V1136.md`, `SUBAGENT-CAPABILITIES-V1136.md`, `CHILD-SESSION-GUARD-V1136.md`.

---

## 5. Sign-off gate (final pass after siblings finish)

```powershell
cd "D:\New folder (58)\SADEEM-v11.12.0-source\src-pkg-v1112\sadeem-v11.12.0"
npm run typecheck                                  # must be green (C3 blocks this)
node scripts/gen-tool-inventory.mjs                # must print 145
node --test --test-force-exit tests/v1136-*.test.mjs tests-v1136-context-precision.mjs
node tests-v1136-child-session-guard.mjs           # now PASS
```

**Remaining blocker:** C3 (`src/lib/api.ts:697` → `Promise<boolean>`). Everything else is green or intentional.
