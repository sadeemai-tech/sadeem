# DIAG-WATCHDOG — Timer / Watchdog Audit & "Agent Interrupts Itself" Root Cause
**Scope:** `electron/agent/**`, `src/store.ts`, `shared/types.ts` · **Date:** 2026-11-18 · **Owner:** watchdog/compaction subagent

---

## 0. Executive summary (EN)

The reported symptom — *"delays, then stops thinking, interrupts / appears disconnected"* — is **not** caused by a no-tools LLM call outrunning a watchdog. It is caused by a **600-second synchronous command runner** added in the v11.13 "Run & Show" wave (`engine.ts` `runCaptured(..., 600_000, { signal })`). That `await` blocks the post-run pipeline for up to 600 s — **exactly the renderer's 10-minute hard watchdog** (`store.ts:1146`). No heartbeat is emitted during the post-run pipeline, so the renderer force-closes the run with `outcome:'aborted', stopReason:'renderer_watchdog'` (`store.ts:1185-1196`). The engine never gets to emit `task_report` / `turn_end`. This matches the report word for word.

Status: the engine owner is converting that await to fire-and-forget with a 45 s cap; the current tree already contains that change. **One real, still-unfixed defect remains in compaction** (original task is not preserved — see §3, Finding 2). A canonical helper fix is provided in `electron/agent/compaction.ts` (wiring is a 2-line change owned by the engine.ts owner).

Honesty note: static tests passed the whole time (32/32) because none of them exercise the blocking post-run await or the compaction task-note content. `tsc` briefly failed during an in-flight concurrent edit of `engine.ts` (TS1107/TS2454 at 3110/3122); it now passes.

## 0. الخلاصة (AR)

العَرَض المُبلَّغ — «يتأخر ثم يتوقف عن التفكير، ينقطع، يبدو كأنه انفصل» — **ليس** بسبب استدعاء نموذج بدون أدوات تجاوز نافذة المراقبة (watchdog). السبب هو **أمر تنفيذي متزامن مدته 600 ثانية** أُضيف في موجة v11.13 «Run & Show» (`runCaptured(..., 600_000)` في `engine.ts`). هذا الانتظار يحجب مرحلة ما بعد التشغيل jusqu 600 ثانية — **أي ما يعادل تماماً مؤقت الـ10 دقائق في الواجهة** (`store.ts:1146`). لا تُرسَل نبضة حياة (heartbeat) أثناء تلك المرحلة، فتُجبر الواجهة إنهاء التشغيل بـ `outcome:'aborted', stopReason:'renderer_watchdog'`. هذا يطابق شكوى المستخدم حرفياً.

جارٍ إصلاح السبب عبر جعله غير حاجز بحد 45 ثانية. **لكن بقي عيب حقيقي لم يُصلح في الضغط (compaction)**: المهمة الأصلية لا تُحفظ (§3، Finding 2). الحل في `electron/agent/compaction.ts`.

---

## 1. Complete timer / abort inventory (EN)

### 1.1 Timers that can ABORT a run or fake a disconnect

| # | Location | Timer | Window / trigger | Effect |
|---|----------|-------|------------------|--------|
| T1 | `electron/agent/engine.ts:4437` | `setInterval` `idleTimer` | `engineIdleTimeoutMs()` default **20 s** (`SURNIA_ENGINE_IDLE_MS`, floor 500 ms), poll = `max(50,min(1000,idleMs/4))`; fires on zero engine-visible activity | `attemptAc.abort()` (`:4441`) → streamTurn throws → retry/continue/failover. Armed **only inside the attempt loop** (`:4399+`), i.e. NOT during compaction or the post-run gates pipeline. |
| T2 | `electron/agent/providers.ts:712` | `setTimeout` `watchdog` (SSE byte watchdog) | **75 s** of ZERO bytes (`SSE_IDLE_TIMEOUT_MS`, `SURNIA_SSE_IDLE_MS`, floor 500 ms); any byte — incl. `: ping` / `ping` — resets it (`:720`) | `reader.cancel()`, `stalled=true`, throws retryable "Stream stalled" (`:732/:748`). Applies to **every** streamTurn, including compaction and no-tools distillation calls. `onByte` (`:721`) drives engine heartbeats. |
| T3 | `src/store.ts:1171` (renderer) | `setInterval` `runWatchdog`, 2 s | stall hint at **20 s** (`RUN_STALL_MS`, `:1142`); hard cutoff **10 min** (`RUN_HARD_TIMEOUT_MS`, `:1146`) of no agent event | Sets `running:false`, writes `lastTaskReport{outcome:'aborted', stopReason:'renderer_watchdog'}` (`:1185-1196`). **This is the timer that actually killed the reported run.** Reset by *every* agent event (`:2993`); `heartbeat` is a pure reset (`:3002`). |
| T4 | `electron/agent/engine.ts:4217-4222` | `AbortController` `compactAc` (not a timer) | linked to run `signal`; `signal.abort()` → `compactAc.abort()` | Propagates a user abort into the compaction call. Cleaned up in `.finally` (`:4261-4263`). |
| T5 | `electron/agent/register.ts:214` | `setTimeout` decision timer | **45 s** (`DECISION_TIMEOUT_MS`, `SURNIA_DECISION_TIMEOUT_MS`, floor 5 s) | Unanswered approval → `resolve(null)` = deny. Not itself a run abort, but a hung approval card used to fake "hang → disconnect → error" before this was lowered from 10 min (`:36-43`). |
| T6 | `electron/agent/engine.ts:169,183` | wall-clock cap (checks, not timers) | **5 h** run cap + **10 min** grace | Ends an over-long run; irrelevant to this incident. |

### 1.2 Other timers (do not directly abort the main run)

`engine.ts:311` DeltaBatcher flush 20 ms · `register.ts:118/122` delta/think flush 16 ms · `providers.ts:431` abortable backoff sleep (1.5–8 s, Retry-After ≤15 s) · `providers.ts:129` tool-use emit throttle 300 ms · `subagentRunner.ts:69` 8-min AbortController for subagent calls · `hooks.ts:213` hook timeout (10 s default, 60 s max) · `mcp.ts:96/448/633(abort)/799/957/1209` call timeouts (10 s probe / 60 s call), `mcp.ts:1286` pool idle TTL 5 min, `mcp.ts:2420` health ping 60 s · `dap.ts:110/202/557` 15 s / 20 s / 25 s · `lsp.ts:158` request timeout, `lsp.ts:189` idle TTL 10 min · `mutation.ts:40` 180 s mutation budget · `verification.ts:38` 120 s · `budget.ts:98` gate 10 min · `journal.ts:142` flush 120 ms · `testRecord.ts:271` false-done flush · `dna.ts:761` recall 15 s · `embeddingIndex.ts:135` abort timeout · `mcpOAuth.ts:117/388` 15 s / 5 min · `github.ts:126/176` 60 s / 30 s · `codeintel.ts:1152` 60 s · `review.ts:16` 30 s · `notebook.ts:128` 30 s · `taint.ts:42` 10 min.

---

## 2. Root-cause chain (EN)

```
v11.13 runAndShow enabled (writesThisRun, autoEdit/fullAccess)
  → await runCaptured(detected, workspace, 600_000, { signal })   [engine.ts:3085, old]
  → post-run pipeline blocked ≤600 s; NO heartbeat emitted there
  → renderer runWatchdog quiet > RUN_HARD_TIMEOUT_MS (600 s)       [store.ts:1146/1178]
  → running:false + lastTaskReport{aborted, renderer_watchdog}     [store.ts:1185]
  → engine's task_report / turn_end arrive too late (or are ignored)
  → user: "delays → stops thinking → interrupted / disconnected"
```
A 600 s await versus a 600 s watchdog is a coin flip — brutally bad design. The LLM's own watchdogs (T1 20 s, T2 75 s) are innocent here: the blocking call is a **shell command**, not a model stream.

## 2. سلسلة السبب (AR)

إضافة Run & Show → انتظار的命令 600 ثانية → لا نبضات حياة → مؤقت الواجهة 600 ثانية يُجبر الإنهاء بـ aborted → رسالة «انقطع». نموذج الذكاء نفسه بريء؛ الحاجز هو أمر shell.

---

## 3. Findings per task item (EN)

1. **Timer inventory** — done, §1. Seven run-relevant timers; the only one that fired here is T3.
2. **Regression / no-tools vs watchdog** — **Not a no-tools-call regression.** `selfCritique` (`:3034`) is deterministic; `claim audit` (`:3010`) is synchronous; DNA/playbook/memory distillation (`:3397-3469`) are fire-and-forget `void` calls. The only blocking no-tools call is compaction (§3.4). The real blocker was the 600 s `runCaptured` command — parent is fixing to `void runCaptured(..., 45_000)` (`:3090`), with `.then/.catch` notices. ⚠️ The in-flight edit briefly produced `continue` inside a `try` at `:3110` → `TS1107` + `TS2454` (rs used before assigned); **tsc now passes** after the engine owner corrected it.
3. **Compaction contract**
   - **Tool blocks stripped: PASS.** `:4194-4202` maps `assistant` → text-only, `tool_result`/`tool` → `[tool result] …` user text before `tools:[]` (`:4235`) — the historic Anthropic/OpenAI 400 cause is handled.
   - **Original task preserved: FAIL (real defect).** `:4270` sets `originalTask = String(params.task ?? '')`, but `params.task` is the task **kind** `'chat'|'compact'|'init'` (`shared/types.ts:614`). The injected `[ORIGINAL TASK — still authoritative]` note therefore contains the literal word **`chat`**, not the user's request. The model still forgets what it was building. Fix: `originalTaskText(head, params.messages)` from `electron/agent/compaction.ts`. (Related: `:2029` passes `params.task` as the user-prompt-hook text — same bug class, engine owner's file.)
   - **Heartbeats during compaction: PASS (with caveat).** `pingCompact()` (`:4221-4228`) throttled to 1/s, wired to `onText/onThinking/onHeartbeat/onUsage` (`:4253-4257`). The 20 s engine idle watchdog is **not armed** during compaction (it lives inside the attempt loop at `:4437`, after the compaction block `:4148-4285`), so compaction cannot be killed by T1. The 75 s provider byte watchdog (T2) still applies; a silent summarizer fails best-effort with a `sys_notice` (`:4279-4281`) — no run abort. Caveat: while **zero** provider bytes arrive no heartbeat is emitted, so the renderer shows the 20 s "stalled" hint until bytes arrive or T2 fires. Non-fatal (10-min hard cutoff).
4. **`selfCritique` / `runAndShow` notice channel** — **PASS, not terminal.** Both call `notice(kind, text)` → `ioB.send({type:'sys_notice', kind, text})` (`:1346-1351`). Renderer `case 'sys_notice'` (`store.ts:3061-3077`) appends a notice chip row. Terminal events are only `turn_end`/`error`/`aborted`/`task_report` (`store.ts:2994`). These notices cannot be read as an abort. Cosmetic note: after the fire-and-forget fix, the `run_and_show` notice lands *after* the terminal card (it is emitted from a promise callback); harmless.
5. **Fixes in owned files** — `electron/agent/compaction.ts` created with the canonical, testable implementations of tool-block stripping and original-task recovery. Engine.ts wiring (owner's job): `const flatHead = flattenToolBlocksForCompaction(head);` and `const originalTask = originalTaskText(head, params.messages);`. No changes to providers.ts/register.ts were warranted — their watchdog/heartbeat logic is correct after audit.

## 3. النتائج (AR)

- الضغط يزيل كتل الأدوات: **سليم**. يحفظ المهمة الأصلية: **خطأ حقيقي** — يستخدم `params.task` الذي يساوي `chat` فقط؛ أضفنا الدالة `originalTaskText` في `electron/agent/compaction.ts`.
- النبضات أثناء الضغط تعمل (1/ث) ومؤقت الـ20 ثانية لا يعمل أثناءها. إشعارات selfCritique / Run & Show تمر عبر `sys_notice` وليست حدثاً نهائياً — لا تُفسَّر كإحباط.
- الخلاصة: لا توجد علاقة باستدعاءات النموذج بدون أدوات؛ الحاجز كان أمر الـ600 ثانية.

---

## 4. Verification (as run in this workspace)

```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json   → exit 0  (PASS)
node --test --test-force-exit tests/v1110-endurance.test.mjs tests/v119-engine.test.mjs
                                                                    → 32 pass / 0 fail (PASS, first run)
```
(First `tsc` run hit transient `TS1107`/`TS2454` from the concurrent engine.ts edit; re-run after the owner's correction was clean.)

A later full re-run under heavy parallel load returned **30 pass / 2 fail**:
- `e: zero-byte stream beyond the idle window → watchdog fires and the retry succeeds` — failed only the generous wall-clock cap (`run recovered quickly (took 12727ms)` vs a 12 000 ms cap; all functional assertions — 2 requests, retry <1900 ms, answer delivered, no error — passed).
- `f: first visible delta reaches the IO while the stream is still open` — `textDeltas.length >= 3` failed because the batcher coalesced deltas under load.

Both tests contain explicit load-tolerance comments acknowledging exactly this ("can add seconds on a heavily loaded CI box", "under parallel load the stream batcher can coalesce adjacent parts"). Re-running just these two in isolation gave **2 pass / 0 fail** (10.2 s and 7.9 s). The whole suite went from ~80 s (clean run) to ~236 s (loaded run). Conclusion: **load-induced flakiness, not a regression** — neither failure touches the compaction or watchdog paths, and neither is in an owned file.

## 5. Brutally honest conclusions

- The "last wave" did introduce the regression, but through a **command runner**, not through the LLM watchdogs or the no-tools model calls the report suspected.
- The compaction "original task" fix that was *believed* to exist (engine.ts comment at `:4267-4269`) is **not actually implemented** — it writes the string `chat`. This is a silent correctness bug that tests do not catch.
- All genuine run-abort timers are accounted for. T3 (renderer, 10 min) is the killer; T1/T2 are healthy by design. The new heartbeat plumbing in providers.ts/engine.ts is correct and should be kept.
- I did not edit engine.ts, prompts.ts, tools.ts, ipc.ts, or the renderer. `electron/agent/compaction.ts` is new and inert until the engine owner wires the two calls above.
