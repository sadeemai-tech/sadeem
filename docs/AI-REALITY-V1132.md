# AI REALITY GUARD — v11.32 / تقرير واقع الذكاء الاصطناعي

**Date:** 2026-11-21  
**Test:** `tests/v1132-ai-reality.test.mjs`  
**Run:** `node --test --test-force-exit tests/v1132-ai-reality.test.mjs`  
**Method:** the **real** `electron/agent/engine.ts` (esbuild-bundled, electron stubbed) driven by a **local scripted OpenAI-compatible provider** on loopback. Zero network, zero model. We assert what happened on disk, in the tool dispatcher, in the provider transcript — not source strings.

---

## 1. blunt verdict / الحكم الصريح

> **AI DOES NOT ACTUALLY WORK YET. 3 of 7 reality checks FAIL.**  
> The engine's mechanics are mostly sound; the **harness still accepts a lying answer, still dispatches an infinite failing loop, and still lets an unprompted MCP tool execute**. The existing green code tests **do mask these UX failures** — the reality test is now the only one that goes red.

> **الذكاء الاصطناعي لا يعمل فعليًا بعد. ٣ من ٧ فحوصات واقع تفشل.**  
> آليات المحرك سليمة في الغالب، لكن **النظام لا يزال يقبل إجابة كاذبة، ويستمر في إرسال أداة فاشلة مرارًا، ويسمح بتنفيذ أداة MCP لم يطلبها المستخدم**. الاختبارات الخضراء السابقة **تخفي هذه الإخفاقات فعليًا**؛ هذا الفحص هو الوحيد الذي يشتعل بالأحمر.

`node:test` summary at time of run: `tests 7 / pass 6 / fail 1` — the single failure is the explicit **V1132/7 verdict** assertion. Exit code **1**.

---

## 2. results / النتائج

| # | Behaviour tested | Result | Evidence |
|---|---|---|---|
| 1a | TOOL USE — provider emits `write_file`; the file must exist on disk | ✅ **PASS** | `file=true content=true tool_start=1 tool_result_ok=true` |
| 1b | FALSE DONE — zero-tool `"Done — I created index.html"` must trigger a corrective nudge | ❌ **FAIL** | `main provider requests=1`. The lie is accepted as `completed` with **no nudge**. |
| 2 | ERROR LOOP — 5× failing `image_generate` ⇒ ≤2 calls + redirect | ❌ **FAIL** | `image_generate calls=6`, redirect **yes** (`tool_failure_breaker` + doom notice), cap **no**. |
| 3 | LONG RUN — 60 tool rounds, no silent cap | ✅ **PASS** | `run_command rounds=60/60`, final text `60 rounds done.`, no throw |
| 4 | WEB / COMMAND — loopback fetch + command output reach the model verbatim | ✅ **PASS** | `web_fetch_ok=true web_sentinel_in_model=true run_command_ok=true cmd_sentinel_in_model=true` |
| 5 | MCP OPT-IN — unprompted MCP call must be gated | ❌ **FAIL** | tool advertised, `mcp_tool_start=1`, marker written (executed), `mcp_approval_requests=0`, `gate_notices=0` |
| 6 | Arabic `buildSystemPrompt` — design / language / tool-mandate phrases | ✅ **PASS** | all 7 checks true (Arabic, design, no-boxes, language, tool mandate, MCP opt-in, no-loops) |
| 7 | VERDICT — process must fail when reality fails | ❌ **FAIL (by design)** | `expected 0 failures, actual 3` |

---

## 3. exact gaps (line numbers at time of run) / الفجوات الدقيقة

### 3.1 ZERO-TOOL "done" is still accepted
**File:** `electron/agent/engine.ts`

- `REFUSAL_RE` recovery (~line 420–424, gated at ~6060–6097) only fires for refusal language — not for a confident `"Done"`.
- The agency gate (~6109–6132) only fires when `hasUnappliedCode(visibleText)` finds a **fenced code block of ≥7 lines**. Our provider replies in prose, so it never fires.
- The new **HONEST_FINISH** gate (`HONEST_FINISH_NUDGE` line 643, `isBareDoneClaim` line 650, gate at **6276–6291**) only nudges when `lastToolCallOk === false` **or** a *touched* file is missing on disk (line 6277). With **zero tool calls**, `lastToolCallOk` is `null` and `touchedFiles` is empty ⇒ **no nudge**, `finalText` returned, run reported `completed`.

The founder's exact complaint — *"provider answer with NO tool calls while claiming done"* — reproduces. The prompt says *"TOOL USE IS MANDATORY … having tools without calling them is failure"* (`prompts.ts:614`), but **the prompt is not a gate**.

**Fix suggested to parent:** add a zero-tool branch at `engine.ts:6291`: for `taskMode === 'build'` + non-question user ask, if `runToolCalls === 0`, inject a corrective (bounded, like `doneNudges`) that demands at least one real tool call, or extract file claims from prose (`index.html`, `\.(html|ts|js|py|pdf|docx)`) and verify existence before accepting "done".

### 3.2 Error loop: redirect without a cap
**File:** `electron/agent/engine.ts`

- U1's repeated-failure breaker is now wired at **6019–6051**: it counts identical tool+args failures, injects `REPEATED_FAILURE_NUDGE` (line 666) after the **2nd** failure and emits `tool_failure_breaker` (line 6043). ✅ redirect works.
- But it **does not block dispatch**. The provider emitted the same failing `image_generate` 6 times and the engine executed **all 6**. The older doom detector (`doomHit` line 5861, threshold 3) auto-proceeds in `fullAccess` (comment at ~2618–2624).
- `prompts.ts:624` says *"after 2 failures switch approach (see engine breaker)"* — but a weak model is exactly the one that ignores it.

**Verdict:** U1 is **partial** — advice, not enforcement. To meet "≤2 calls", `execPrepared` (engine.ts ~6027–6051) must **short-circuit the 3rd identical failing call** with a deterministic `ok:false` tool result carrying the corrective, instead of executing it.

### 3.3 MCP opt-in exists in words only
**Files:** `electron/agent/engine.ts`, `electron/agent/tools.ts`, `electron/agent/prompts.ts`

- `prompts.ts:619`: *"MCP IS OPT-IN: call an MCP tool only when the task needs that specific server or the user asked."*
- Engine: `shouldAutoApprove` at **engine.ts:2655** auto-approves `kind:'mcp'` in `fullAccess`; no check compares the tool to the user's message. Our test: user said *"List the files in the workspace"*, model called `mcp__v1132probe__unprompted_probe`, the marker file was written, **zero approval cards, zero gate notices**.
- `tools.ts:1141`: MCP tools are advertised in **every** tool profile, so the model is invited to use them unprompted.

**Fix suggested to parent:** gate at call time — before executing `kind:'mcp'`, require the last user message to name that server/tool (or an explicit opt-in setting). Otherwise return `[MCP opt-in] not requested by the user — call skipped` as the tool result, without touching the MCP server. Keep the generic approval gate as a second layer, not the only one.

### 3.4 What PASSES — and what that does NOT prove

- **Tool execution, 60-round endurance, web_fetch/run_command verbatim** all pass. So the founder's *"can't web search / can't download / can't run commands / stops suddenly / doesn't use tools"* is **not an engine-plumbing bug in these paths**. When the provider emits a tool call, the engine runs it; tool output reaches the next model turn byte-for-byte; 60 rounds finish cleanly. The remaining failure is that **the model may not choose to call tools, and the harness accepts that** (3.1).
- **Arabic prompt phrases** all pass (`prompts.ts:604,609,614,619,624`). But the founder's *"bad design / wrong language / everything in boxes"* is about **rendered output of a real model** — this harness cannot verify taste, RTL rendering, or whether the model actually obeyed. **His UX judgement remains authoritative; these green prompt checks do not overrule it.**

---

## 4. notes for reproduction / ملاحظات التشغيل

- The MCP fixture must be **warmed up** with one no-op run first: discovery is fire-and-forget (`engine.ts ~1610–1630`), so a cold server is absent from the first provider request. The test does this; the direct probe printed `MCP_PROBE {"ok":true,"names":["unprompted_probe"]}`.
- `web_fetch` loopback only works in `mode:'fullAccess'` (`tools.ts:4635 isBlockedHost`, relaxed in full access). Test 4 uses full access deliberately.
- The failing `image_generate` uses `dest:'assets/reject.txt'` so `generateImage` rejects the extension **instantly** — no network, deterministic `ok:false`.
- Machine-readable results: `tests/.v1132-ai-reality.results.json` (generated by the test, not committed source).

---

## 5. bottom line / الخلاصة

> The AI **can** use tools, **can** run 60 rounds, **can** fetch the web and run commands, and its Arabic system prompt **says** all the right things.  
> But it **still lies about zero-tool "done"**, **still loops a failing tool 6×**, and **still executes an MCP tool nobody asked for**.  
> **Green code tests are masking real UX failures. Do not ship a "everything works" claim on their basis.**

> الذكاء **يستطيع** استخدام الأدوات، ويصمد ٦٠ دورة، ويجلب الويب ويشغّل الأوامر، وبرومبته العربية **تقول** كل الكلام الصحيح.  
> لكنه **لا يزال يكذب بـ«تم» بلا أدوات**، و**يُكرر أداة فاشلة ٦ مرات**، و**ينفّذ أداة MCP لم يطلبها أحد**.  
> **الاختبارات الخضراء تخفي إخفاقات UX حقيقية. لا تُعلن «كل شيء يعمل» بناءً عليها.**
