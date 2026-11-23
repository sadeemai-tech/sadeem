# DIAG-ENGINE — v11.13 runtime regression (diagnosis only, NO code changes)

**Scope:** `electron/agent/engine.ts`, `electron/agent/vibeFlow.ts`, `electron/agent/prompts.ts:683-690`, `shared/types.ts`, renderer `src/store.ts` / `src/components/MessageView.tsx`, reference tests.
**Mode:** READ-ONLY. No file was edited. All findings are from static code inspection; where runtime proof is missing, it is stated explicitly.

---

## ENGLISH SUMMARY

The reported symptom ("AI does not respond at all", massive delays, thinking stops, work interrupted/disconnected) is **most plausibly caused by a new blocking `await` inserted into the post-run pipeline by v11.13 Run & Show**, combined with the fact that **the engine emits no heartbeat anywhere in that post-run window** and the renderer watchdog's hard timeout is **exactly the same 600,000 ms** as the blocking call.

The final answer *text* is still streamed to the renderer during `streamTurn`, but every **terminal event** (`message_end`, `task_report`, `turn_end`) is delayed until the Run & Show command finishes. The UI therefore stays `running: true`. The renderer watchdog shows "stalled" at 20 s, "recovering" at 40 s, and force-closes the run with an honesty report at 600 s — which the user sees as "disconnected / interrupted". While `running` is true, `runAgent` silently ignores every new user send, which is exactly "the agent does not respond at all".

Static tests pass because the v11.13 tests only unit-test **pure helpers** (`selfCritique`, `runAndShowSummary`) and assert prompt-section lengths; no test exercises a real engine run with the new post-run `await`.

### Ranked root causes

| # | Cause | Exact location | Confidence |
|---|-------|----------------|------------|
| **1** | **New blocking `await runCaptured(..., 600_000)` in the post-run pipeline, BEFORE all terminal events** | `electron/agent/engine.ts:3055-3114`, specifically **`:3085`**; terminal events at `:3576`, `:3626`, `:3639` | **HIGH — proven by code reading + exact timeout/watchdog alignment; runtime confirmation still needed** |
| **2** | **No heartbeat/liveness event during the post-run pipeline (including Run & Show, fake-test/mutation/proof gates, critic model call). Renderer watchdog fires at 600 s** | engine heartbeat only at `:4226` and `:4434`; renderer watchdog `src/store.ts:1142-1146`, activity reset `:2993`, watchdog loop `:1177-1204` | **HIGH (mechanism fully traced in code)** |
| **3** | **New "self-critique before final answer" prompt directive (plus ~1k tokens of new static prompt) can increase time-to-first-token past the 20 s engine idle watchdog on cold cache / slow providers → false "Stream idle watchdog" abort → retries/failover** | `electron/agent/vibeFlow.ts:127-142`, injected at `electron/agent/prompts.ts:688-690`; watchdog `engine.ts:4413-4446`, default `engineIdleTimeoutMs()` `:250-254`, error text `:4550-4551` | **MEDIUM / UNPROVEN — physically plausible, no runtime evidence yet** |

---

## ARABIC SUMMARY (ملخص عربي)

**الخلاصة:** العَرَض المبلغ عنه ("الوكيل لا يرد إطلاقًا"، تأخير هائل، توقف التفكير، انقطاع العمل) سببه الأرجح **`await` جديد حاجز أضافه v11.13 في مسار ما بعد التشغيل (Run & Show)**، مع أن **المحرك لا يرسل أي نبضة حياة (heartbeat) خلال تلك النافذة**، وأن **مؤقت المراقبة في الواجهة يساوي تمامًا 600 ثانية** — وهي نفس مدة انتظار أمر Run & Show.

نص الإجابة النهائية يصل للواجهة أثناء البث، لكن **أحداث الإنهاء** (`message_end` / `task_report` / `turn_end`) تتأخر حتى ينتهي الأمر. تبقى الواجهة في حالة `running: true`، فيظهر "متوقف stalled" بعد 20 ثانية ثم "قيد الاسترداد" ثم إغلاق قسري بعد 600 ثانية = "انقطع/توقف العمل". وطالما `running == true` فإن `runAgent` يتجاهل أي رسالة جديدة بصمت (`src/store.ts:2932`) = "لا يرد إطلاقًا".

الاختبارات الساكنة تمر لأن اختبارات v11.13 تختبر دوال نقية فقط ولا تشغّل محركًا حقيقيًا بالمسار الجديد.

**الأسباب مرتبة:**
1. `electron/agent/engine.ts:3085` — `await runCaptured(detected, workspace, 600_000, { signal })` داخل كتلة Run & Show (`:3055-3114`) **قبل** أحداث الإنهاء (`:3576`, `:3626`, `:3639`).
2. لا توجد نبضة حياة في مسار ما بعد التشغيل؛ نبضتا المحرك فقط في `:4226` و`:4434`، ومؤقت الواجهة `src/store.ts:1142-1146`.
3. توجيه "التدقيق الذاتي قبل الإجابة النهائية" (`vibeFlow.ts:127-142` → `prompts.ts:688-690`) قد يزيد زمن أول رمز (TTFT) عن نافذة مراقبة الخمول 20 ثانية (`engine.ts:4413-4446`) فيُجهض المحاولة خطأً — **غير مُثبت زمنيًا**.

**تم استبعاده:** رموز `sys_notice` الجديدة (`self_critique`, `run_and_show`) لا تُسقط الواجهة: المعالج العام في `src/store.ts:3061-3077` والبديل الافتراضي في `MessageView.tsx:585` يتعاملان مع أي `kind` دون استثناء.

---

## Cause #1 — Blocking Run & Show placed before terminal events (TOP)

### Evidence (exact lines)

- `engine.ts:3055-3062` — the new guard: `cfg.runAndShow !== false && writesThisRun && mode !== 'plan' && taskMode !== 'plan' && taskMode !== 'review' && !signal.aborted`.
  - `cfg` comes from `agentTuning()` at `engine.ts:1439` → `getSettings().agent ?? {}`. `runAndShow` is **undefined by default**, and `undefined !== false` → **the block is ON for every normal coding run that wrote a file**.
- `engine.ts:3069` — `(await detectProjectTestCommand(workspace).catch(() => null))?.command` — first await (usually fast; reads manifests).
- `engine.ts:3071-3073` — reuses an already-recorded harness test run if present. **When no test was recorded during the agent loop, reuse is empty.**
- **`engine.ts:3085` — `const r = await runCaptured(detected, workspace, 600_000, { signal });`** — a synchronous, blocking 10-minute wait in the main-process engine.
- `engine.ts:3109` — only AFTER that await does `notice('run_and_show', ...)` emit anything.
- Terminal events are much later: **`message_end` at `engine.ts:3576`**, **`emitTaskReport` at `engine.ts:3626`**, **`sendTurnEnd()` at `engine.ts:3639`**.
- `runCaptured` (`electron/services/terminalService.ts:368-444`) resolves only on child `close`/`error` or its own 600 s timer (`:438-442` → `killTree` → relies on `close` at `:428-431`). There is **no shorter upper bound and no progress event**.

### Why this reproduces every reported symptom

1. `src/store.ts:2989-2993`: `ingestAgentEvent` calls `noteAgentActivity()` on **every** agent event.
2. `src/store.ts:1142` `RUN_STALL_MS = 20_000`, `src/store.ts:1146` `RUN_HARD_TIMEOUT_MS = 10 * 60_000` (= 600,000 ms).
3. During the `await` at `engine.ts:3085` **zero events are emitted** (see Cause #2), so `lastAgentActivityAt` freezes.
4. Watchdog loop `src/store.ts:1171-1204`: at >20 s → `runRecovery.phase = 'stalled'`; at >40 s → `'recovering'`; at >600 s → force `running:false` with `stopReason:'renderer_watchdog'` and the message "The session stopped after a long silence from the agent…" → **"work interrupted / disconnected"**.
5. Until then `running` stays true, and `src/store.ts:2930-2932` `runAgent: ... if (!s.session || s.running) return;` **silently drops new user messages** → **"AI agent does not respond at all"**.

### What pre-v11.13 did differently

- The same 600 s `runCaptured` already existed, but **only in DEBUG mode**: `engine.ts:406-434` (`runEngineVerify`) called from `engine.ts:2642-2650`, and in the agentLoop verify path (`engine.ts:4023`). Normal `chat` runs never hit it.
- v11.13 extended that blocking pathway to **all chat runs with writes** (`engine.ts:3055-3085`). That is the regression boundary.
- The reliable documented flow (tests) is: streamed deltas → `message_end` → `task_report` → `turn_end`, with heartbeats during streaming:
  - `tests/v1110-endurance.test.mjs:16-21` — "slow THINKING deltas … watchdog NEVER fires", "first visible delta reaches the IO while the stream is still open".
  - `tests/v119-engine.test.mjs:202` — source-level assert for `message_end … turn_end` ordering.
  - `tests/v1112-playbook.test.mjs` — offline pure-module tests (playbook/prompts only); no engine run at all.

### Minimal fix (DESIGN ONLY — not applied)

1. **Move the entire Run & Show block (`engine.ts:3055-3114`) to AFTER `sendTurnEnd()` at `engine.ts:3639`**, or make it non-blocking (`void` + independent heartbeat), so terminal events are never gated by a command. Keep `task_report` immediately before `turn_end` (journal ordering contract at `:2982-2986`, `:3757-3787`).
   - Simplest kill-switch if a code change is not acceptable in this wave: set `runAndShow: false` / `vibeCoder: false` in agent settings — this disables `engine.ts:3055` and the prompt layer.
2. If it must stay inline: pulse `ioB.send({ type: 'heartbeat' } as AgentEvent)` from a `setInterval(..., ≤5000)` for the duration of the await, and cap the command at e.g. 30 s instead of 600 s (600 s == renderer hard timeout, so it can never finish before the UI declares disconnection).

---

## Cause #2 — No liveness pulse in the post-run pipeline (HIGH, mechanism proven)

- The **only two** heartbeat emissions in the entire engine are `engine.ts:4226` (`phase:'compacting'`) and `engine.ts:4434` (`phase:'streaming'`). Both are inside `agentLoop`, before the post-run pipeline begins at `engine.ts:2988`.
- The post-run pipeline contains multiple long awaits even before v11.13 — `engine.ts:2929-2933` model critic call, `:3146` `detectFakeTests`, `:3192+` mutation gate, `:3312+` proof package — but v11.13 adds the **longest one** (`:3085`, 600 s).
- `shared/types.ts:358` defines `{ type: 'heartbeat'; phase?: string }`, and `src/store.ts:2999-3002` treats it as a pure watchdog reset — the protocol already exists; it is simply not used in this window.
- `electron/agent/register.ts` does not emit an independent periodic heartbeat (no `setInterval` heartbeat found), so main→renderer silence is real, not just a missing event name.

**Minimal fix (DESIGN ONLY):** a generic "post-run keepalive" around the whole gate pipeline (`engine.ts:2995` → `:3639`) that pulses `heartbeat` every ≤5 s and is cleared in the `finally` at `:3756-3791`. This also protects future gates.

---

## Cause #3 — Larger prompt + "no-tools checkpoint" directive vs. the 20 s idle watchdog (MEDIUM, UNPROVEN)

- `vibeFlow.ts:127-142` `selfCritiqueSection` instructs the model: "Before your final reply, do ONE no-tools checkpoint… Do not add an extra user-visible round-trip."
- Injected word-stably at `prompts.ts:688-690` via `buildVibeFlowSections` (`vibeFlow.ts:145-152`): ~4 sections, bilingual, roughly 1k+ extra tokens on first cache miss.
- Engine idle watchdog: `engine.ts:4413-4446` — `lastActivity = Date.now()` at attempt start (`:4416`); aborts `attemptAc` after `engineIdleTimeoutMs()` (`:250-254`, **default 20 s**) of no onText/onThinking/onToolUse/onUsage/onHeartbeat activity. On fire, `:4544-4553` converts it to `new Error('Stream idle watchdog — no model activity for 20s …')`.
- A provider that (a) has no `message_start` usage snapshot, (b) emits no keep-alive ping during prefill, and (c) now pauses for an internal "no-tools checkpoint" before the first answer delta, can exceed 20 s on a cold prompt cache. Result: transparent retry/failover churn, visible as "thinking stops / work interrupted".

**Honesty:** this is **not proven**. Nothing in the repository records time-to-first-token or watchdog-fire telemetry, and the v11.10 endurance tests (`tests/v1110-endurance.test.mjs:425-456` slow-thinking, `:462-488` zero-byte watchdog) were written before this prompt existed and explicitly assert the *old* contract. To confirm, check logs for the exact string `Stream idle watchdog` and compare with run timestamps. If absent, discard this cause.

**Minimal fix (DESIGN ONLY):** arm the idle watchdog only **after the first sign of model life** (first onText/onThinking/onUsage/onHeartbeat), i.e. add a "first-token grace" window sized for prompt prefill, or raise `SURNIA_ENGINE_IDLE_MS` for cold-cache runs. Keep the renderer heartbeat behaviour unchanged.

---

## Question 4 — Does the engine emit a terminal event when the NEW blocks error?

- `selfCritique` (`engine.ts:3030-3048`): `try { … notice('self_critique', …) } catch { /* advisory */ }` — errors are swallowed with **no** event at all (`:3045-3047`).
- Run & Show (`engine.ts:3063-3113`): `try { … } catch (err) { notice('run_and_show', 'runner failed to start…') }` — a **notice**, not a terminal event; `:3110-3113`.
- Both are advisory, so swallowing is acceptable **only because the normal terminal path follows**. The real defect is that neither block has a timeout/heartbeat: if `runCaptured` at `:3085` never settles (its timer at `terminalService.ts:438-442` kills the child but `finish()` depends on `close` at `:428-431`), the `finally` at `engine.ts:3756-3791` **cannot run**, and `message_end`/`task_report`/`turn_end` are never emitted. The renderer's 600 s watchdog then becomes the *only* terminator.

## Question 2 — Do the new notice kinds break the renderer? (RULED OUT)

- `notice('self_critique', …)` at `engine.ts:3044` and `notice('run_and_show', …)` at `engine.ts:3109/3112` use the existing `sys_notice` channel (`engine.ts:1346-1351`, typed at `shared/types.ts:351`).
- Renderer `src/store.ts:3061-3077` handles `sys_notice` generically for **any** `kind` (dedup by `kind::text`, pushes a notice row). No `switch` on known kinds, no throw.
- `src/components/MessageView.tsx:583-585` uses `NOTICE_META[kind ?? 'sys'] ?? NOTICE_META.sys` — unknown kinds fall back safely.
- All other new/adopted events (`claim_audit`, `red_green`, `fake_tests`, `proof_package`, `mutation_check`) are already typed (`shared/types.ts:445-458`) and handled (`src/store.ts:3455-3522`).
- **Conclusion: the "unknown event throws in renderer" theory is disproven by code.**

## Question 1 — Any `await` before the final-answer event that blocks think/delta delivery?

- No **new** await blocks delta delivery *during* the model turn. `prompts.ts:688-690` is synchronous string building; `selfCritique` (`vibeFlow.ts:186-238`) is synchronous and deterministic.
- Text/thinking deltas are emitted live in `engine.ts:4477-4511`, coalesced by `DeltaBatcher` (`engine.ts:268-353`) and flushed every ~20 ms / 200 chars and on every structural event (`:283-294`, `:4528-4531`). That mechanism is intact.
- The blocking await is **after** the answer has streamed but **before** the terminal events — which is still enough to produce every reported symptom (see Cause #1). The only pre-answer await newly added is the *prompt content* itself (Cause #3), not a code-level await.

---

## Confidence / what is NOT proven

- ✅ **Proven by code:** the new blocking call at `engine.ts:3085` sits before `message_end`/`task_report`/`turn_end`; no heartbeat exists in the post-run window; renderer watchdog = 600 s; `running` guard drops sends.
- ⚠️ **Strong inference, not runtime-proven:** that this is the actual production incident. It requires a run where (a) a file was written, (b) no test run was already recorded in the harness ledger, (c) a command was detected, and (d) permission mode is `autoEdit`/`fullAccess` — otherwise `:3098-3105` takes the "skippedReason" branch with **no** runCaptured. Under those conditions the 600 s block occurs; without runtime logs we cannot assert the user's session met them.
- ❌ **Unproven:** that the new prompt causes watchdog-triggered retries (Cause #3). Needs telemetry.
- ❌ **Disproven:** renderer throwing on new notice kinds.

**Fastest confirmation:** reproduce a chat run that writes a file without running tests, and timestamp the arrivals of `sys_notice:run_and_show`, `message_end`, `task_report`, `turn_end` plus `runRecovery.phase` in the UI. A >20 s gap between the Run & Show notice and `message_end`, with a `stalled` phase, confirms Cause #1+#2 definitively.
