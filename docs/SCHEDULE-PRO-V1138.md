# v11.38 — SCHEDULED JOBS: blunt verdict / الحكم الصريح

> Founder order: «السكجول جوب أهم إشي يجب أن تقوم أنها تكون أن تعمل بشكل احترافي وبشكل قوي»
> ("SCHEDULED JOBS are the most important thing; they must work professionally and STRONGLY.")

---

## 0. TL;DR — the honest answer

**English.** YES — scheduled jobs really fire and really persist. I did not trust the
previous "it works" claim; I drove the real service with a fake clock and an
injected runner and **watched a job cross its exact cron minute, execute, write
telemetry, emit events, and survive a full restart** (`tests/v1138-schedule.test.mjs`,
6/6 green). The feature was never a dead timer — it was **unproveable from the
UI** and had several professional-grade holes. Those are now closed.

**العربية.** نعم — المهام المجدولة تُطلق فعلًا وتُحفظ فعلًا. لم أثق بادّعاء «يعمل»
السابق؛ شغّلت الخدمة الحقيقية بساعة وهمية ومشغّل مُحقون، و**رأيت مهمة تعبر دقيقتها
الضبطية وتُنفّذ وتكتب سجلها وتبعث أحداثها وتنجو من إعادة تشغيل كاملة**
(`tests/v1138-schedule.test.mjs`، 6/6 ناجحة). المشكلة لم تكن مؤقّتًا ميتًا، بل كانت
**استحالة إثبات ذلك من الواجهة** plus ثغرات احترافية. سُدّت كلها.

---

## 1. WHY IT "APPEARED BROKEN" — root cause / لماذا بدت معطوبة

| # | ما كان يحدث | الأثر على المؤسِّس | الحالة الآن |
|---|---|---|---|
| 1 | The panel had **no event/status bridge**. `kdx:schedule-event` was sent by main (`electron/main.ts:906`) but preload never subscribed; `schedulerStatus()` existed but had no IPC/bridge. The page literally printed **"CLOCK UNVERIFIED"** / **"SCHEDULER UNAVAILABLE — no bridge in this build"**. | Opening the page looked dead even while the ticker was running. This is the #1 reason it was reported broken. | Panel consumes **emitted events** from its re-poll (`SchedulePanel.tsx:366`), shows real fire time/status, flashes on a new event seq (`:666`, `:942`). HONEST status, never "ACTIVE" on faith. |
| 2 | Webhook card showed **"LISTENER READY"** from mere token presence — even when port 7681 was taken (`EADDRINUSE` — reproduced again in our test log). | A dead trigger advertised as live. | `kdx:schedule:webhook` now returns the listener's **actual** `listening/port/error` (`ipc.ts:946`); panel badge uses them (`SchedulePanel.tsx:602`). |
| 3 | **No persisted `nextRun`**; the panel computed it locally. A disagreement between two matchers = a lying countdown. | "Next run" could disagree with the real fire. | Service computes/persists exact `nextRun` (`scheduleService.ts:430`, `:1222`); panel prefers it (`SchedulePanel.tsx:443`). |
| 4 | `lastRun` was stamped at **fire start**, so a long run could re-fire the same cron minute on the next tick. | Duplicate fires / "stacking". | `lastFireSlot` (the consumed minute) gates every fire (`scheduleService.ts:463`, `:970`); missed slots older than 90 min are skipped, never replayed. |
| 5 | No cancel, no per-job error counter, no durable event trail. | A stuck run was unstoppable; errors were one-off strings. | `cancelJob()` (`:1248`), `lastError`/`consecutiveErrors`/`runCount`/`lastDurationMs`, durable ledger `schedules-events.json` + `listEvents()` (`:963`). |

**ما لم يكن مكسورًا:** قاعدة التخزين كانت فعلًا في `userData` بكتابة ذرّية، والمؤقّت
الحقيقي (`setInterval` 30 ثانية) كان منصّبًا، ومسار التنفيذ كان يستدعي `runAgent`
الحقيقي. لم أعد اختراع هذه الأشياء — قوّيتها وأثبتّها.

---

## 2. WHAT THE FIX ACTUALLY DOES / ماذا يفعل الإصلاح فعليًا

### English

1. **Create → persist.** `addJob()` validates prompt/workspace/cron (honest
   `PROMPT_REQUIRED`, `WORKSPACE_REQUIRED`, `WORKSPACE_NOT_FOUND`, `INVALID_CRON`),
   writes atomically (`tmp` + `rename`, mode `0600`) to
   `<userData>/schedules.json` — never `process.cwd()`. `nextRun` is computed at
   creation (`scheduleService.ts:1222`).
2. **Live ticker.** `initScheduleService()` installs the 30s interval
   (`:1097`); `tick()`/`runSchedulerTick()` call `dueSlot()` (`:463`) which returns
   the **latest unconsumed cron minute** in the last 90 minutes. Missed slots
   while asleep are skipped; at most one slot is consumed per fire.
3. **Fire → real run.** `fireJob()` (`:970`) calls the injected `runJob` or the
   default `runHeadlessAgent()` (`:784`) → **`runAgent`**
   (`electron/agent/engine.ts:1935`) — the same engine chat uses. Approvals are
   auto-DENIED; a permission ceiling (`read`/`autoEdit`/`fullAccess`) is honored.
   The proof gate runs the workspace test suite (`terminalService.ts:455
   runCaptured`); a failing suite suppresses the success.
4. **Update + emit.** `lastRun`, `lastFireSlot`, exact `nextRun`, `runCount`,
   `lastDurationMs`, `lastError`, `consecutiveErrors`, `sessionId` are persisted;
   `emitEvent()` (`:934`) writes a durable event + broadcasts
   `kdx:schedule-event` and attaches `lastEvent` to the job so **the panel
   consumes the same event on its 5s poll** (`SchedulePanel.tsx:331`, `:366`).
5. **Restart → survive.** `loadJobs()` (`:284`) + `loadEvents()` restore state;
   `nextRun` is recomputed against the new wall clock; a job left `running` is
   honestly marked `error: interrupted by restart`. `schedulerStatus()`
   (`:1157`) reports `running/quitting/jobCount/inFlight/webhook*/eventSeq/
   observed` truthfully.
6. **Professional controls.** Pause = `toggleJob(..., false)` cancels the run;
   `cancelJob()` aborts by jobId; `firing` set + `runControllers` prevent double
   fire; per-job error state; webhook is loopback-only, token-gated, and returns
   honest 200/403/404/409. Injected `ScheduleClock`/`runJob`/`proofGate`
   (`:58`) make it deterministic-testable without sleeping or calling an LLM.

### العربية

١. **إنشاء → حفظ:** تحقّق صارم، ثم كتابة ذرّية في `<userData>/schedules.json` مع
   حساب `nextRun` عند الإنشاء.
٢. **مؤقّت حقيقي:** مؤقّت 30 ثانية يفحص أحدث دقيقة كرون غير مستهلكة؛ الفجوات
   أثناء النوم تُتخطّى ولا تُعاد دفعة واحدة.
٣. **تنفيذ حقيقي:** `runAgent` نفسه الذي يستخدمه الشات، بموافقات مرفوضة تلقائيًا
   وسقف صلاحيات لكل مهمة، وبوابة إثبات تشغّل اختبارات مساحة العمل.
٤. **تحديث + أحداث:** كل القياسات تُحفظ، وحدث دائم + بثّ يُرفق بالمهمة كي تقرأه
   الواجهة من استطلاعها الدوري.
٥. **إعادة تشغيل:** الملفات تُستعاد، `nextRun` يُحسب من جديد، والمهمة التي كانت
   «قيد التشغيل» تُعلَن خطأً صادقًا.
٦. **تحكم احترافي:** إيقاف/إلغاء، منع تكرار التشغيل، حالة خطأ لكل مهمة، ويب هوك
   صادق، وحقن زمن/مشغّل لاختبار حتمي.

---

## 3. VERIFICATION (commands actually run) / التحقق

| فحص | النتيجة |
|---|---|
| `npx tsc -p tsconfig.node.json --noEmit` | ✅ 0 errors |
| `npx tsc --noEmit` | ✅ 0 errors |
| `node --test --test-force-exit tests/v1138-schedule.test.mjs` (new) | ✅ **6/6 pass** |
| `node --test --test-force-exit tests/v1136-usage-flows-schedule.test.mjs` | ✅ 6/6 pass |
| `node --test --test-force-exit tests/v1131-full-smoke.test.mjs` | ✅ 82/82 pass |
| `node --test --test-force-exit tests/schedule-live.test.mjs` (real engine + wall-clock tick) | ✅ 4/4 pass, 1 honest SKIP (port 7681 busy) — the real webhook is instead proven in v1138 #6 on an OS-assigned port |

The new suite's six proofs:
1. create → atomic userData persist → exact `nextRun`;
2. **the real interval tick fires at 04:30:00** → runner called once → telemetry
   + `running`/`ok` events + broadcast + disk write + no duplicate next minute;
3. restart with a **new** runner/clock → job + history + ledger intact, no
   fabricated run, status `observed`;
4. honest errors (`INVALID_CRON`, `WORKSPACE_REQUIRED`, `WORKSPACE_NOT_FOUND`,
   `NO_WORKSPACE` + `no workspace configured`);
5. concurrency guard (`ALREADY_RUNNING`) + `cancelJob()` aborts in-flight;
6. **real loopback webhook** (OS-assigned port): valid token → 200 + job fires,
   bad token → 403, unknown job → 404.

> Note: `tests/v1131-ipc.test.mjs` fails on a **pre-existing, unrelated** stub
> mismatch — `electron/agent/register.ts:25` imports `isAllowedWikiWorkspace`
> from `wikiService`, which that old test's stub does not export. Not caused by
> this work; not a schedule file.

---

## 4. FILES I ACTUALLY MODIFIED / الملفات المعدّلة

- `electron/services/scheduleService.ts` (hardened scheduler — all sections)
- `electron/ipc.ts` (schedule handlers only: `:788`, `:792`, `:794`, `:795`, `:946`)
- `src/components/panels/SchedulePanel.tsx` (event consumption, honest clock/webhook,
  exact nextRun, error/event display, cancel control)
- `tests/v1138-schedule.test.mjs` (new, 6 proofs)
- `docs/SCHEDULE-PRO-V1138.md` (this file)

---

## 5. HANDOFFS to the parent (exact file:line) — files I was NOT allowed to edit

These are remaining "last mile" items; the main-process side is **ready and
tested**, only the renderer bridge/type surface is missing.

1. **`electron/preload.ts:215-222` + `:307-315`** — there is **no
   `kdx:schedule-event` subscription** and no bridge for the new channels. Add:
   ```ts
   scheduleStatus: () => invoke('kdx:schedule:status'),            // ipc.ts:792
   scheduleCancel: (id: string) => invoke('kdx:schedule:cancel', id), // ipc.ts:794
   scheduleEvents: (limit?: number) => invoke('kdx:schedule:events', limit), // ipc.ts:795
   onScheduleEvent: (cb: (e: unknown) => void) => subscribe('kdx:schedule-event', cb as never),
   ```
   The main side already sends `kdx:schedule-event`
   (`electron/main.ts:906`). With this, `SchedulePanel` can show a push-driven
   LIVE LED instead of the poll-based flash — the poll path already works.
2. **`src/lib/api.ts:565-571`** — widen the `SurniaAPI` schedule surface with
   `scheduleStatus()`, `scheduleCancel(id)`, `scheduleEvents(limit?)`,
   `onScheduleEvent(cb)` and the honest `scheduleWebhook()` return
   (`{url,token,listening,port,error}`). The panel already casts locally, so it
   won't break either way.
3. **`shared/types.ts:570-604` (`ScheduleJob`)** — add the runtime fields the
   service now persists: `nextRun?`, `lastFireSlot?`, `lastError?`,
   `consecutiveErrors?`, `runCount?`, `lastDurationMs?`, `lastEvent?`. The panel
   uses a local `JobView` cast (`SchedulePanel.tsx:40`) so this is cosmetic
   type hygiene, not a runtime blocker.
4. **`src/store.ts:3198-3234`** — `scheduleAdd`/`scheduleRemoveJob` swallow bridge
   errors and `scheduleRunJobNow` toasts "Job launched" even when the main
   process refused. Consider surfacing the returned `{ok,error}` from
   `kdx:schedule:runNow` (now also returns `NO_WORKSPACE`).
5. **`src/components/schedule.css`** (optional polish) — add a subtle animation
   for the new `.is-flash` class used on the clock banner (`:666`) and job
   message (`:942`); it degrades gracefully without it.
6. **Read-only confirmation of the "real run" path** (no change needed):
   `electron/agent/engine.ts:1935 runAgent` is the single real engine entry;
   `electron/services/storeService.ts getSettings()` supplies the model +
   providers; `electron/services/terminalService.ts:455 runCaptured` is the
   proof gate. A scheduled job with **no model configured** will honestly fail
   with `no model configured` (`scheduleService.ts:807`) — that is configuration,
   not a dead scheduler.
