# v11.36 — حارس أدوات الوكلاء الفرعيين / SUBAGENT TOOLS GUARD (D1)

> Founder complaint: **«الوكيل الفرعي يقول ما عندي الأدوات»** — a subagent claims it does not have the tools.
>
> This doc is **DIAGNOSIS + TEST + DOC ONLY**. No app source was edited here (D1 patch owner owns `agents.ts` / `subagentRunner.ts`).
> Guard: `tests/v1136-subagent-tools-guard.test.mjs` · Results: `tests/.v1136-subagent-tools-guard.results.json`
> Run: `node --test --test-force-exit tests/v1136-subagent-tools-guard.test.mjs`

---

## 0. الحكم الصريح / BLUNT VERDICT

| السؤال / Question | الإجابة / Answer |
|---|---|
| هل ما زال يتكرّر «الوكيل الفرعي يقول ما عندي الأدوات»؟ / Does "subagent says I don't have the tools" still reproduce? | **لا — بعد D1. / NO — after D1.** قبل D1 كان يتكرّر فعليًا (9 من 16 وكيلًا مقيّدين). / Before D1 it genuinely reproduced (9 of 16 specialists were restricted). |
| هل كل الوكلاء الـ16 عندهم السجل الكامل؟ / Do all 16 specialists have the full registry? | **نعم. 16/16 `tools: '*'`.** / **Yes. 16/16 `tools: '*'`.** |
| كم أداة تُعلَن لكل وكيل؟ / How many tools are advertised per agent? | **145 أساسية + MCP + أدوات المزوّد** (في الاختبار: 145 + 1 مزوّد = 146، بلا تكرار). / **145 core + MCP + provider-native** (probe: 145 + 1 provider = 146, deduped). |
| هل البروفايل يمنع أداة بالاسم؟ / Is a profile a name-based gate? | **لا.** عرض لمرة واحدة للنماذج الضعيفة فقط. / **No.** Per-turn view for weak models only; dispatch always resolves the full registry. |
| هل بقيت شخصية كل وكيل مميزة؟ / Are personalities still distinct? | **نعم — 16/16 برومبتات نظام مختلفة.** / **Yes — 16/16 distinct system prompts.** |
| نتيجة الحارس / Guard result | **5/5 PASS** (6 findings, 0 fail) — final re-run `2026-11-21T19:44:59Z`. |

> **الخلاصة / Bottom line:** السبب الجذري أُزيل. الوكيل الفرعي الذي يقول «ما عندي الأدوات» بعد v11.36 **كاذب فعليًا** — والبرومبت يقول له ذلك صراحةً (`subagentRunner.ts:142`). الوكلاء يختلفون بالشخصية/الدور فقط، لا بالقدرة. / The root cause is gone. A post-v11.36 subagent claiming "I don't have the tools" is **factually wrong** — and the system prompt says so explicitly. Specialists differ by personality/role only, never by capability.

---

## 1. التشخيص / DIAGNOSIS — أين كان الخلل / where the bug lived

Before D1, three independent cuts stacked up in the subagent path:

| # | القطع / Cut | الموقع القديم / Old location | الأثر / Effect |
|---|---|---|---|
| 1 | **`spec.tools` allow-list** | `electron/agent/agents.ts:19,20` (`FS_READ`, `WEB`) + 9 restricted agents: `perf:52`, `explore:63`, `web-research:73`, `spec:83`, `architect:95`, `docs:123`, `review:144`, `security:164`, `skill-writer:179` | 9 of 16 specialists advertised a tiny subset (e.g. `explore` = 4 read tools). The model literally could not see the tool it needed → "I don't have the tools." |
| 2 | **profile slice in the runner** | old `subagentRunner.ts:207` `getToolDefs([], profile)` + `:208-211` filter `spec.tools === '*' || spec.tools.includes(d.name)` | Even a `'*'` agent was narrowed to the `balanced` view (~118 defs); advanced tools were filtered out of the advertised array. |
| 3 | **40-tool display truncation** | old `subagentRunner.ts:98` `o.tools.slice(0, Math.min(40, o.tools.length))` | The prompt listed only 40 tool names — reinforcing the model's belief that the rest did not exist. |
| 4 | **read-only wording** | old `agents.ts:62` "You never modify files." (explore/web-research/spec) | Explicit role text told research agents they were read-only. |

All four are gone in the landed D1 patch. The deepest cut was #2: the capability filter sat in the **advertised defs** handed to `streamTurn`, so even a model told "you are FULLY CAPABLE" saw a shorter tool list and reasonably concluded it lacked the tool.

---

## 2. ما الذي تغيّر / WHAT D1 CHANGED (exact lines)

### 2.1 `electron/agent/agents.ts`
- `:4-13` — new v11.36 header: "every specialist has the FULL tool registry … a subagent that says 'I don't have the tools' is simply wrong."
- `:23-28` — `tools` field kept for API/source compatibility but documented as **not a filter**: "EVERY specialist is `'*'` … `subagentRunner.ts` advertises and dispatches the full registry regardless."
- `:41,51,61,73,83,93,105,115,124,133,144,154,164,174,187,194` — all **16** agents now `tools: '*'` (0 `FS_READ`/`WEB` constants, 0 array literals remain).
- `:69-72, 80-82, 90-92` — research prompts updated: "Default to read-only analysis; **if the task explicitly requires a change, make it — you are fully capable.**" The old "You never modify files" is gone.
- `:198-200` — `getAgent()` unchanged (falls back to `general`).

### 2.2 `electron/agent/subagentRunner.ts`
- `:36-44` — v11.36 capability contract comment: full registry for every specialist, "The old `spec.tools` subset and the profile-based slice are gone."
- `:96-116` — **new exported `subagentToolDefs()`**: union of `getToolDefs([], 'full')` (all 145 core) + `getProviderToolDefs()` (provider-native), deduped by name, first def wins. This is the single full-registry source for both prompt and dispatch.
- `:118-152` — `buildSubagentSystemPrompt`: **no `slice(0,40)` any more**; `toolLine` lists every tool (`:132`); `:136-138` viewNote states the profile is "a per-turn VIEW for weak models ONLY. It does NOT restrict you"; `:142` explicitly forbids "I don't have the tools."
- `:244-249` — `runStandaloneSubagent`: `const defs = subagentToolDefs();` — no `spec.tools` allow-list, no profile filter.
- `:288` — system prompt receives all def names; `:309` — `streamTurn({ tools: defs })` receives the full union.
- `:272-282` — approval gate unchanged: `approve` delegates to parent, fail-closed, `fullAccess: false`, no `denyHint` (so approval-free capability tools keep working).

### 2.3 Supporting (unchanged, verified not broken)
- `electron/agent/tool-defs.ts:2253-2278` — V3 profile contract: profiles change what the model **sees**, never what executes; `:2366-2372` `defsForProfile()`; `:2393-2411` `fullCapabilityUnion()` / `advertisedWithExtras()`.
- `electron/agent/tools.ts:1317-1364` — `getToolDefs()` default `'full'`; `executeTool()` resolves against the full registry by exact name (`:1408`, `:1418`).
- `electron/agent/providers.ts:351` — `getProviderToolDefs()` supplies provider-native extras.

---

## 3. التحقق / VERIFICATION — 5 checks, exact file:line

The guard bundles the **real** `agents.ts` + `subagentRunner.ts` with esbuild (`_esbuild-bin.mjs` recipe), externalizes `./providers` with a capture stub, and drives the real `runStandaloneSubagent` loop offline. A synthetic provider extra makes the MCP/provider-union observable.

| # | Check | Status | Evidence (file:line) |
|---|---|---|---|
| 1 | All 16 specialists `tools === '*'`; no `[...FS_READ]`/`[...WEB]` | **PASS** | `agents.ts:31` (roster), `agents.ts:41…194` (16 stars), 0 restricted, 0 subset constants |
| 2 | Each specialist advertises full 145 + provider/MCP extras (not a slice) | **PASS** | `subagentRunner.ts:107` union = 146 (145 core + 1 provider), no dups; `subagentRunner.ts:288,309` — all 16 agents advertise 146 defs |
| 3 | Ex‑FS_READ `explore` calls an advanced tool by name, no refusal | **PASS** | `agents.ts:65` (`explore`), `subagentRunner.ts:288` — `media_ffmpeg` advertised + dispatched; real `tool_result` returned ("Missing required parameter: action…" — an honest arg error, **not** "not allowed"/"Unknown tool"); system prompt has `FULLY CAPABLE` + "NEVER say … I don't have the tools" + "per-turn VIEW for weak models ONLY" |
| 4 | No `tools.slice` / capability cut; V3 profiles view-only | **PASS** | `subagentRunner.ts:107` (`getToolDefs([], 'full')` + `getProviderToolDefs()`), no live `spec.tools`/`.slice`/allow-list filter; `tool-defs.ts:2367` `defsForProfile` — `full`=145, `balanced` hides `media_ffmpeg`, yet `executeTool('media_ffmpeg')` still dispatches by name |
| 5 | Distinct system prompts (personality preserved) | **PASS** | `agents.ts:31` — 16/16 prompts pairwise distinct, each embeds its verbatim role prompt + `FULLY CAPABLE` contract |

Runtime transcript (from the passing run):
```
[PASS] 1-all-specialists-full — agents.ts:31 — 16/16 specialists tools='*'; 0 restricted; no FS_READ/WEB subsets
[PASS] 2a-union-helper — subagentRunner.ts:107 — subagentToolDefs()=146 (145 core + 1 provider extra), advanced=25 available
[PASS] 2b-all-agents-advertise-full — subagentRunner.ts:288 — all 16 specialists advertise 146 defs (not a filtered slice)
[PASS] 3-advanced-tool-by-name — agents.ts:65, subagentRunner.ts:288 — explore (ex-FS_READ) advertised + dispatched media_ffmpeg; no refusal
[PASS] 4-no-cut-profiles-view-only — subagentRunner.ts:107, tool-defs.ts:2367 — full=145; balanced hides media_ffmpeg yet executeTool still dispatches
[PASS] 5-distinct-personalities — agents.ts:31 — 16/16 system prompts distinct
# tests 5 · pass 5 · fail 0
```

### Negative control (why this is a real guard, not a rubber stamp)
The assertions are written to **fail on the pre‑D1 tree**: `tools: '*'` for all 16 fails on the 9 restricted agents; the union/advertise checks fail on `getToolDefs([], profile)` + `spec.tools.includes`; the `no spec.tools / no slice` source checks fail on old `subagentRunner.ts:98,208-211`; the advanced-tool check fails when `media_ffmpeg` is absent from `explore`'s advertised set. A reverting patch is therefore caught with a concrete file:line, not silently passed.

---

## 4. بصراحة / HONEST LIMITATIONS (not changed by D1)

1. **Provider-native tools are a runtime superset, not part of the 145.** / أدوات المزوّد الأصلية زيادة وقت التشغيل وليست ضمن الـ145؛ العدد 145 يبقى صادقًا (`scripts/gen-tool-inventory.mjs` parses only core defs).
2. **MCP servers still must be enabled to appear.** The subagent builds its union with `mcpServers: []` (`:263`) — discovered MCP tools join via the registry, but a cold/off server contributes none. This guard injects one synthetic provider extra, not a live MCP server.
3. **Approval gate still applies.** A subagent can *call* any tool by name, but actions requiring approval go to the parent gate and fail closed when absent (`:272-282`). "Has the tool" ≠ "auto-approved". This is by design and unrelated to the complaint.
4. **What a real LLM chooses to say is not mechanically controllable.** The guard proves the capability is present, advertised and dispatchable, and that the prompt explicitly forbids the false claim. It cannot force a hallucinating weak model to tell the truth — but the model can no longer blame a missing tool, because none is missing.
5. **DIAGNOSIS+TEST+DOC only.** No app source was modified by this subagent; the D1 patch is owned by another session. If D1 is reverted after this run, re-run the guard — it will fail loudly.

---

## 5. الملفات / FILES WRITTEN BY THIS SUBAGENT

- `tests/v1136-subagent-tools-guard.test.mjs` — the guard (5 checks, esbuild bundles real source, offline stub provider).
- `tests/.v1136-subagent-tools-guard.results.json` — machine-readable PASS/FAIL findings with exact file:line.
- `docs/SUBAGENT-TOOLS-GUARD-V1136.md` — this bilingual diagnosis + verdict doc.
