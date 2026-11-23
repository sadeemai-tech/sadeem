# REPLY-LATENCY — V1124
## قياس مستقل لتأخر رد الذكاء الاصطناعي / Independent latency measurement (diagnosis only)

> **Scope:** measurement + diagnosis only. No application source was modified by this
> subagent. The only file created is this report. All four named suites were run
> against the real, esbuild-bundled engine, with a local `node:http` scripted
> OpenAI-compatible provider (zero network, zero real model).
> **التاريخ / Date:** 2026-11-20, 11:56–12:16 (+03:00). **Node** v22.22.2, Windows.

---

## 0. الحكم المختصر / TL;DR verdict (no sugar-coating)

| السؤال | الجواب الصريح |
|---|---|
| هل كانت شكوى المؤسس صحيحة؟ | **نعم.** Before A5's 12:16 edit, a synchronous cold probe blocked the event loop for **2.2–7.3 s before the provider request was even issued**. That is app-side, not the model. |
| هل أصلح A5 المشكلة؟ | **جزئياً.** The first cold turn is now fast (`run_start` 4–8 ms, provider request 91–120 ms, first delta 44–473 ms warm). |
| هل اختفى التأخير تماماً؟ | **في النسخة المقاسة: لا** — the 5 s cost was *moved*, not removed: the 12:16 build deferred the same synchronous probe with `setImmediate` after `turn_end`, so it blocked the **next** turn (120 ms → **4,546 ms** measured). **تحديث 12:18:49:** A5 removed that deferred kick entirely (§5) — source-verified, not re-measured. |
| هل تأخير النموذج نفسه من أخطاء التطبيق؟ | **لا.** Model→firstToken is external: 44–473 ms healthy, 784–3,205 ms under injected 429s. The app can only mask it with heartbeats/watchdogs, not eliminate it. |
| هل فيه retry صامت قبل أول token؟ | **لا — محكوم.** 402 fatal, 429 one bounded retry (≤1 s) + bounded engine delays, **no auto-switch**. All v1123 error scenarios PASS. |
| الحكم النهائي | **App-side first-token overhead is low when warm, but NOT reliably minimal.** One more fix is required: make `probeMachineCapability` genuinely async (or prewarm its cache at app startup) instead of `setImmediate` + synchronous `require('node:sqlite')`. Until then a user sending two messages in quick succession will still hit a multi-second freeze. |

**Arabic:** المؤسس كان محقاً. قبل تعديل A5 في 12:16 كان هناك فحص متزامن (`require('node:sqlite')` + 21 عملية فرعية) يحجب حلقة الأحداث 2.2–7.3 ثانية **قبل إرسال الطلب للنموذج**. بعد التعديل أصدر A5 أول إجابة سريعة، لكنه نقل نفس الفحص الثقيل إلى ما بعد نهاية الدور — فيحجب الدور التالي (قِسنا 120ms ثم 4546ms في نفس العملية). تأخير النموذج نفسه خارجي ولا يمكن إصلاحه في التطبيق. لا توجد إعادة محاولة صامتة خطيرة. **ما زال هناك خلل واحد مطلوب إصلاحه: جعل فحص قدرات الجهاز غير متزامن فعلياً.**

---

## 1. القياسات / Measured evidence

### 1.1 Run ledger (exact wall-clock, from shell stopwatch + `Get-Date -Format o`)

| Suite | RUN_START (+03:00) | RUN_END (+03:00) | Wall clock | engine.ts mtime used |
|---|---|---|---|---|
| `tests/v1114-live-repro.test.mjs` | 11:56:35.286 | 11:56:53.086 | **17,783 ms** | 11:03:10 (pre-12:16 A5) |
| `tests/v1121-perf.test.mjs` | 11:57:10.850 | 11:57:14.719 | **3,856 ms** | 11:03:10 |
| `tests/v1123-ai-e2e.test.mjs` | 11:57:27.136 | 11:58:31.194 | **64,044 ms** | 11:03:10 |
| `tests/v1116-heavy-stress.test.mjs` | 11:58:43.569 | 12:14:09.312 | **925,741 ms** (15m26s) | 11:03:10 at bundle time |
| v1121 re-run (`V1121_DEBUG=1`) | ~12:1x | — | ~3,700 ms | **12:16:00** (post-A5 P0 fix) |
| v1114 re-run | 12:16:13+ | — | — | **12:16:00** (post-A5 P0 fix) |

**mtime archaeology (the "before/after A5" you asked for):**
- at session start: `electron/agent/engine.ts` **11:03:10**, `providers.ts` **09:35:52**, `StreamTimeline.tsx` **11:56:03**, `ChatPanel.tsx` 09:21:46, `MessageView.tsx` 08:37:08.
- during the 15-minute v1116 run, A5 edited `engine.ts` → **12:16:00** and A4 edited `ChatPanel.tsx` → **12:15:03**. v1116's bundles were built at 11:58 from the 11:03 engine, so its numbers are **before** A5's 12:16 P0 edit; the two re-runs are **after**.
- A5's 12:16 edit is identifiable in source: `engine.ts:2132-2143` (v11.24 FIRST-TOKEN LATENCY — P0), `engine.ts:4226` (deferred probe), `engine.ts:1539` (parallel hooks load), `engine.ts:1275-1289` (settings diagnostics).

### 1.2 `v1114-live-repro` — first-token + delta delivery (BEFORE A5's 12:16 fix, engine @ 11:03)

| Variant | engineStartup | model→firstToken | total→firstToken | max token gap | post-stream `task_report`/`turn_end` lag | full duration |
|---|---|---|---|---|---|---|
| FAST (~120 ms/token) | **2,917 ms** | 473 ms | **3,390 ms** | 120 ms | +341 / +341 ms | 4,435 ms |
| SLOW (~700 ms/token) | **2,559 ms** | 453 ms | **3,012 ms** | 702 ms | +901 / +902 ms | 7,922 ms |

Both PASS. `run_start`→first token is dominated by **engineStartup (2.5–2.9 s)**, not the model.

### 1.3 `v1114` re-run — AFTER A5's 12:16 fix (engine @ 12:16)

| Variant | engineStartup | model→firstToken | total→firstToken | max gap | post-stream lag |
|---|---|---|---|---|---|
| FAST | **120 ms** | 44 ms | **164 ms** | 143 ms | +602 / +603 ms |
| SLOW | **4,546 ms** ⚠ | 937 ms | **5,483 ms** (load factor 1.14) | 723 ms | +1,380 / +1,382 ms |

**Why SLOW regressed to 4.5 s in the same process:** FAST emits `turn_end`, then A5's new `setImmediate(() => machineCapabilitySummaryNow(workspace))` (`engine.ts:4226`) runs the old heavy probe synchronously; SLOW's startup overlaps that probe. **The cold cost was relocated, not removed.**

### 1.4 `v1121-perf` — where the time goes before the provider call

| Run | time-to-first-visible-event (`run_start`) | provider request issued | first delta | preparing heartbeats |
|---|---|---|---|---|
| First run (engine @ 11:03, cold OS cache) | **4 ms** | **2,166 ms** | 2,576 ms | pulse ran through the whole 2.1 s gap |
| Re-run (engine @ 12:16, warm) | **8 ms** | **91 ms** | 447 ms | 93/173/253/333/413 ms, stopped at 446 ms |

The 4 ms `run_start` proves the renderer is fed instantly. The **2,162 ms gap between `run_start` and the provider request** in the cold run is pure local setup — and A5's 12:16 fix collapses it to ~83 ms when warm. Debug timeline of the warm run:

```
     8ms  sys_notice/run_start
     8ms  heartbeat/preparing
    93ms  heartbeat/preparing
   173ms  heartbeat/preparing  ... (pre-token window, no text)
   446ms  heartbeat/streaming
   447ms  text_delta
   463ms  task_report
   463ms  turn_end
```

### 1.5 `v1116-heavy-stress` — failure-chain TTFT (10 turns; engine @ 11:03, cold)

`[v1116] FAILURE-TTFT-SUMMARY {"turns":10,"ttftMinMs":5863,"ttftMaxMs":9546,"ttftAvgMs":7663,"allUnder20s":true,"statuses":"429>429>200"}`

| metric | min | max | avg |
|---|---|---|---|
| startup (local) | 4,611 ms | 7,254 ms | ~5,900 ms |
| model→firstToken (external + retry) | 784 ms | 3,205 ms | ~1,550 ms |
| **TOTAL-TTFT (user-visible)** | **5,863 ms** | **9,546 ms** | **7,663 ms** |

All 10 turns < 20 s, **failovers = 0** (no auto-switch), statuses `429>429>200`.

Honesty note: despite the test name "401→429→success", the mock actually injects **429 twice then 200** (`v1116-heavy-stress.test.mjs:218-222`); no 401 is produced. The 402/401-fatal behaviour is verified separately by v1123 S2 and by source inspection (§3).

Other v1116 results: `LONG-RUN-30` 30 tools / 2 compactions / 142 events / 14,976 ms — all deltas landed; `FUZZ-INGEST` 2,000 events / 41 ms / 0 throws; `TOOL-STORM` 145 tools / 435 calls / 0 throws / 0 "Unknown tool" / 39,117 ms (slow tools `env_probe` 17,047 ms, `process_list` 8,248 ms — tool execution, not AI).
**Stability caveat:** `V1115-STABILITY` FAILED — replay 1 exit 0 / 103,646 ms / 4-of-4 markers; replay 2 **exit -1 / 685,144 ms / 2-of-4 markers** (killed during TOOL-STORM under concurrent host load). That is a stress-harness/host-load artefact, not a first-token signal, but it is reported as-is.

### 1.6 `v1123-ai-e2e` — 11 nasty cases (engine @ 11:03)

`TOTAL FAILURES: 0  (scenarios: 0/11 failing)` — S1 cross-session, **S2 402 mid-run**, **S3 429→success**, S4 malformed JSON, S5 bad tool args, S6 tool fail→success, S7 abort, S8 Unicode/Arabic stream, S9 compaction, S10 subagent failure, **S11 slow provider (no auto-switch)** — all PASS. Suite wall 64,044 ms (11 scenarios, each paying its own cold setup).

---

## 2. Code path & top-3 dominant contributors

**Path:** `api.agentRun` (`electron/preload.ts:90`, `kdx:agent:run`) → IPC handler `electron/agent/register.ts:497` (`normalizeRunParams` → billing gate → credential injection → `runAgent`) → `electron/agent/engine.ts:1399` `runAgent` → setup (`:1510` settings, `:1539` hooks, `:2005-2154` memory/transcript/tools) → `streamTurn` (`engine.ts:2203`, implemented `providers.ts`) → first `text_delta` → engine `DeltaBatcher` (`engine.ts:1427`, ≤35 ms) → IPC coalescer (`register.ts:379-454`, 16 ms) → `kdx:agent-event` → `src/store.ts:1709` rAF flush (≤16 ms) → renderer (`MessageView.tsx`, `StreamTimeline.tsx`).

The renderer chain is ≤~67 ms total and is **not exercised by these four tests** (they use an IO recorder). That is a measurement limitation, not a claim that the renderer is fast.

### 🥇 #1 — Cold synchronous machine-capability probe (LOCAL, app bug — fixed, then *moved*)
- **Before:** `engine.ts:2132-2140` called `machineCapabilitySummaryNow()` on the first-token path. A5's own comment states it "blocked the event loop for **4.8 s on EVERY cold run**, before the provider request was even issued — the 'AI takes forever to reply' complaint."
- Mechanism: `tools.ts:6428-6436` `require('node:sqlite')` (native module, ~5 s cold on Windows) runs **synchronously before the first await**; `tools.ts:6438` then launches 21 `versionOf` child processes.
- **After (12:16):** `engine.ts:2141-2143` ships a static hint; the probe is deferred to `engine.ts:4226` `setImmediate(...)`. Measured first-turn startup 2,917 ms → **120 ms**.
- **Still wrong:** the deferred call is still the same synchronous function. v1114 re-run SLOW startup **4,546 ms** immediately after FAST's 120 ms in the same process. The event-loop block now lands on the *next* user turn.

### 🥈 #2 — External provider time-to-first-token (EXTERNAL, not app-side)
- `providers.ts` `streamTurn` / `postJsonWithRetry` → the model's own latency. Measured 44–473 ms healthy (mock), 784–3,205 ms with two 429 retries, and — in the engineer's own words — "the model's own latency is external."
- The app's only levers are masking: liveness heartbeat `engine.ts:1615` (≤1.5 s, 4 ms after entry), watchdogs `providers.ts:1069` (75 s cold / keep-alive aware), and the 20 s "still reasoning" marker. None of these make the model faster.

### 🥉 #3 — Post-first-token completion pipeline (LOCAL, modest)
- `engine.ts:1849` `emitTaskReport` + gates/claim_audit/self_critique/run_and_show, then `engine.ts:4142` `stopLiveness`, batcher flush. Measured `task_report`/`turn_end` lag **+341–902 ms** (v1114), **+46–2,189 ms** (v1115 T05, 2 s/token case).
- The historical P0 — a 600 s `await runCaptured()` keeping `running:true` and killing the session — is **gone** (v1114 asserts report/end within 5 s of the last token).
- Downstream IPC/renderer coalescing (`register.ts:379`, `engine.ts:1427`, `store.ts:1709`) adds ≤~67 ms.

**Honourable mention (not top-3, but bounded):** engine turn-retry delays `engine.ts:138` = `[200,400,600,800,1000,1200]` ms (**4.2 s total**, 6 retries). ⚠ The comment in `v1116-heavy-stress.test.mjs:191` claiming production uses `600,1800,4000,8000,15000,30000` ms is **stale/incorrect** — actual code is better than the test claims.

---

## 3. Silent retries / backoff before first token (item 3)

| Case | Source | Behaviour | Measured |
|---|---|---|---|
| **402 / no credits** | `providers.ts:489-497`, `:590-597` | classified `no_credits`, **fatal**, actionable bilingual message, no retry, no failover | v1123 S2 PASS |
| **401 / invalid key** | `providers.ts:488`, `:584-588`, `:836` | fatal for the provider — skip immediately, no backoff | code inspection (v1116 did not inject 401 despite its name) |
| **429 / rate limit** | `providers.ts:608-616`, `:838-852` | **ONE** short backoff ≤1 s (`RATE_LIMIT_BACKOFF_CAP_MS`), `Retry-After` capped, **silent per attempt**; second 429 goes to orchestrator; one consolidated notice for the whole chain (`:2185-2232`) | v1123 S3 PASS; v1116 `429>429>200`, failovers=0 |
| **5xx / network** | `providers.ts:645-668`, `:856-865`, `:762-809` | one 5xx retry (≤8 s backoff), network retries within 10 s shared budget | bounded |
| **No auto-switch** | `engine.ts:5078`, `:5126`, `:6191`; settings `allowModelFailover:false` | slow / stalled / network failure **never** triggers provider auto-switch | v1123 S11 PASS; v1116 failovers=0 |
| **No silent mid-answer re-request** | `engine.ts:4971/4976` (`SURNIA_STREAM_CONTINUE_BUDGET=0`) | any auto-continue MUST emit a visible notice | v1123 check G PASS across all 11 cases |

**Verdict on item 3:** there are **no unbounded silent retries before first token**. The 429 path is deliberately quiet for one ≤1 s attempt, then bounded; the user sees at most one consolidated notice. Nothing here explains a "minute of nothing."

---

## 4. الحكم النهائي / Final honest verdict

1. **The founder was right before 12:16.** The measured 2.2–7.3 s of local pre-provider blocking matches "الذكاء الاصطناعي بيتاخر بالرد... مليون مرة حكيت لك حلها" exactly. It was app-side, and it is now identified with file:line (`engine.ts:2132` → `tools.ts:6428`).
2. **A5 fixed the *first* cold turn, not the underlying defect.** Warm first-token path is now 164–447 ms end-to-end (app ~83–120 ms + external 44–356 ms). But the deferred probe still synchronously loads a native module and spawns 21 processes, so back-to-back turns still stall (4,546 ms measured). This is the single thing still wrong on the app side and it must be fixed — e.g. move the probe into a real worker / truly async `import('node:sqlite')` with non-blocking spawns, or prewarm the cache once during app startup before the first user message.
3. **The model's own latency is external and is now the dominant *remaining* term** in warm runs. Report it as such; do not promise to "fix" it in app code.
4. **No silent-retry pathology** was found; 402/401 are fatal, 429 is bounded and quiet, no auto-switch.
5. **Caveats, stated plainly:** these four suites are engine+store harnesses with a scripted local provider — they do **not** measure real network latency or real React paint time; `v1116`'s V1115 replay 2 was killed after 685 s under load (2/4 markers); and `engine.ts`/`ChatPanel.tsx` were still being edited by A5/A4 during the session, so any number above may shift on the next commit.

**One-line Arabic خلاصة:** التطبيق صار سريعاً في الدور البارد الأول، لكن "الفحص الثقيل" نُقل لما بعد الدور وما زال يجمّد الدور التالي 4.5 ثانية — المطلوب إصلاحه الآن هو جعله غير متزامن حقيقياً. بقية التأخير هو تأخير النموذج نفسه (خارجي).

---

## 5. Addendum — A5's 12:18:49 edit (source-verified, NOT re-measured)

While this report was being finalised, `electron/agent/engine.ts` was modified again
(mtime **12:18:49**, after the report's first write at 12:18:39). The deferred
`setImmediate(() => machineCapabilitySummaryNow(workspace))` at old `engine.ts:4226`
**no longer exists**. In the current source, `engine.ts:4219-4224` reads:

> "v11.24 — the full machine-capability probe is deliberately **NEVER kicked from
> the run path**. Its cold call synchronously loads node:sqlite (~5 s) and spawns
> 21 version probes; **even a deferred kick starved the event loop long enough to
> trip a short engine-idle watchdog on the NEXT back-to-back run**. The advisory
> summary is available on demand through the `env_probe` tool, so the first-token
> path (and the run boundary) stays completely free of it."

**Impact on this report:** the 4,546 ms SLOW-startup measurement in §1.3 was taken
against the intermediate 12:16 build that still contained the `setImmediate` kick.
The 12:18:49 build removes that kick altogether, so the "cost moved to the next
turn" defect is **addressed in source**. The static hint remains at `engine.ts:2141-2143`.

**Honesty limits:** I did **not** re-run the four suites after 12:18:49, so the
removal is verified by reading the code only — there is no fresh timing number for
it. The external model latency and the post-stream completion lag (§2 #2/#3) are
unchanged by this edit. `engine.ts` was still moving during the session; re-run
`v1114` + `v1121` once more against the final build to confirm before signing off.

**Arabic:** بعد كتابة التقرير بدقيقة عدّل A5 الملف مجدداً (12:18:49) وحذف الإطلاق المؤجّل
للفحص الثقيل تماماً، مشيراً إلى أنه كان يُجوع حلقة الأحداث في الدور التالي. هذا
يُعالج الخلل **في الكود**، لكنني لم أعد قياسه بعد — لا يوجد رقم زمني جديد لهذا
التعديل المحدد؛ يلزم إعادة تشغيل v1114 وv1121 على البناء النهائي للتأكيد.
