# F3 Schedule Guard — v11.38
# فاحص الجدولة F3 — v11.38

- Scope / النطاق: **diagnosis + test + doc only** — no app source was edited by this guard.
  / تشخيص + اختبار + توثيق فقط — لم يعدّل هذا الفاحص أي ملف من ملفات التطبيق.
- Guard / الفاحص: `node tests-v1138-schedule-guard.mjs` → **PASS — 46 passed, 0 failed** (exit 0).
- Date / التاريخ: 2026-11-22
- Subject / الموضوع: **"scheduled jobs work professionally"** / **«المهام المجدولة تعمل باحتراف»**

> Line numbers below are from the verification snapshot of the live source. The
> guard recomputes every `file:line` by needle at runtime, so a concurrent edit
> cannot make the report silently stale.
> / أرقام الأسطر من لقطة المصدر وقت التحقق. الفاحص يعيد حساب كل `file:line`
> وقت التشغيل، فلا يمكن لتعديل متزامن أن يجعل التقرير قديماً بصمت.

---

## 0. Blunt verdict / الحكم الصريح

**EN — PASS, with two shipping caveats. Do scheduled jobs really fire on time?
YES — in the source.** I watched a job created at 10:29 with cron `31 10 * * *`
sit idle on the 10:29 tick, then fire when the clock reached the 10:31 slot via
the *real* 30-second ticker callback, run through the *real* `runAgent` engine
against a local scripted provider, receive its **exact prompt**, write
`SCHEDULED-WORK-HAPPENED` into its workspace, stamp `lastRun`/`lastFireSlot`/
`nextRun`/`runCount`, emit `running → ok` and persist a durable event. A second
tick inside the same minute could not consume the slot twice. This is not "a job
was stored": it is an observed fire with real work and real state.

**But do NOT claim the shipped app has this yet.** `dist-electron/electron/main.js`
and `dist-electron/electron/services/scheduleService.js` are **stale**: they
contain none of `computeNextRun`, `lastFireSlot`, `cancelJob`, `schedules-events.json`
or the `lastEvent` ledger. Until someone rebuilds, the packaged app runs the old
scheduler. Source-level F3 is green; the build artifact is a handoff (§4).

**AR — نجاح، مع تحفظين عند الشحن. هل المهام المجدولة تُطلق في وقتها فعلاً؟
نعم — على مستوى المصدر.** مهمة أُنشئت الساعة 10:29 بكرون `31 10 * * *` بقيت
ساكنة في نبضة 10:29، ثم أُطلقت عندما وصلت الساعة إلى شريط 10:31 عبر **دالة
النبضة الحقيقية** التي يستدعيها المؤقّت كل 30 ثانية، ومرّت عبر محرّك `runAgent`
الحقيقي مقابل مزوّد محلي مكتوب، واستلمت **نصّها الحرفي**، وكتبت
`SCHEDULED-WORK-HAPPENED` في مساحة عملها، وسجّلت `lastRun`/`lastFireSlot`/
`nextRun`/`runCount`، وأرسلت `running → ok` وحفظت حدثاً دائماً. نبضة ثانية في
نفس الدقيقة لم تستهلك الشريط مرتين. هذا ليس «تم حفظ مهمة» — هذا إطلاق مُرصَد
بعمل حقيقي وحالة حقيقية.

**لكن لا تقل إن التطبيق المُشحون حصل على ذلك بعد.** ملفا
`dist-electron/electron/main.js` و`dist-electron/electron/services/scheduleService.js`
**قديمان**: لا يحتويان على `computeNextRun` ولا `lastFireSlot` ولا `cancelJob`
ولا `schedules-events.json` ولا سجل `lastEvent`. إلى أن يُعاد البناء، التطبيق
المُغلَّف يعمل بالجدولة القديمة. المصدر أخضر؛ ناتج البناء تسليم (§4).

---

## 1. How it was verified / كيف تم التحقق

The guard esbuild-bundles `electron/services/scheduleService.ts` unchanged and
runs it with a **temp userData** dir, an isolated Electron stub and F3's **own**
injection points:

/ يجمّع الفاحص الملف `electron/services/scheduleService.ts` كما هو عبر esbuild
ويشغّله مع `userData` مؤقت، وستاب إلكترون معزول، ونقاط الحقن الخاصة بـ F3:

| Injection / الحقن | What it gave the guard / ما وفّره للفاحص |
|---|---|
| `ScheduleClock` (`scheduleService.ts:58`) | fake `now()` + captured the REAL `tick` callback from `clock().setInterval(tick, 30000)` (`:1104`); no 30-second sleeps, no reimplementation of the matcher. / ساعة وهمية + التقاط دالة `tick` الحقيقية، بلا انتظار 30 ثانية وبلا إعادة كتابة المطابق. |
| `runJob` (`:130`, used at `:1002`) | captured the exact `prompt`/`workspace` handed to the run callback, held a run open, and observed abort on cancel/pause/shutdown. / التقاط النص الحرفي، إبقاء تشغيل مفتوح، ومراقبة الإلغاء. |
| `proofGate` (`:132`) | available; default gate path exercised by the real run (no test suite in the temp workspace → `no-suite`, honestly labelled). / متاح؛ مسار البوابة الافتراضي مُختبر في التشغيل الحقيقي. |
| local scripted OpenAI-compatible HTTP server | the ONLY mock: the LLM. The engine, tool dispatch, file write, settings/provider binding and all scheduler code are real. / المُحاكى الوحيد هو نموذج اللغة؛ المحرّك والأدوات والكتابة والجدولة حقيقية. |

`addJob()` / `listJobs()` return **snapshots** in v11.38 (`:1224`, `:1148`), so
every state assertion re-reads live state — a stale snapshot would have faked a
failure. / تُعيد الدالتان نسخاً في v11.38، لذلك أُعيدت قراءة الحالة الحيّة في كل
تحقّق — لولا ذلك لظهر فشل وهمي.

---

## 2. Gates → result (exact file:line) / الفحوصات → النتيجة

### 2.1 Fire on time (real engine) — الإطلاق في وقتها (المحرّك الحقيقي)

| Gate | Result | Evidence |
|---|---|---|
| `F3-0-HARNESS` | PASS | `electron/services/scheduleService.ts:114` — real bundle, all injection points present |
| `F3-1-BAD-CRON` | PASS | `:1198` — `INVALID_CRON` thrown; `isValidCron` rejects `61 * * * *` |
| `F3-1-NO-WORKSPACE` | PASS | `:1278` — `WORKSPACE_REQUIRED` / `WORKSPACE_NOT_FOUND` / `PROMPT_REQUIRED` / `JOB_NOT_FOUND` |
| `F3-1-PRE-STATUS` | PASS | `:1172` — before init: `running:false`, `webhookListening:false`, `observed:false` |
| `F3-2-TICK-CAPTURED` | PASS | `:1104` — the captured callback is the production `tick` |
| `F3-2-CREATED` | PASS | `:1224` — job in memory **and** in `<userData>/schedules.json` |
| `F3-2-NEXTRUN-ARMED` | PASS | `:1222` — `nextRun = 2026-03-10T10:31:00` at creation |
| `F3-2-NOT-EARLY` | PASS | `:463` — 10:29 tick does not fire a 10:31 cron |
| `F3-3-FIRE-STATES` | PASS | `:980` — `running`, `lastRun`, `lastFireSlot=10:31:00` on the slot |
| `F3-3-BROADCAST-RUNNING` | PASS | `:999` — `running` event emitted |
| `F3-3-NEXTRUN-REARMED` | PASS | `:997` — nextRun already 2026-03-11 10:31 mid-run |
| `F3-3-TERMINAL-OK` | PASS | `:1041` — `lastStatus:'ok'`, `runCount:1`, `consecutiveErrors:0` |
| `F3-3-RUN-CALLBACK-PROMPT` | PASS | `:1004` — 2 engine round-trips, **both** carrying the job's exact prompt on its model |
| `F3-3-REAL-WORK` | PASS | `:1002` — real `runAgent` wrote `proof-sched.txt` with the exact bytes |
| `F3-3-BROADCAST-OK` | PASS | `:1053` — `ok` broadcast + `sessionId` + durable event |
| `F3-3-NO-SAME-MINUTE-REFIRE` | PASS | `:468` — `lastFireSlot` gate blocks a second fire in the same minute |

### 2.2 Persistence, honesty, concurrency, UI / الحفظ، الصدق، التزامن، الواجهة

| Gate | Result | Evidence |
|---|---|---|
| `F3-4-PERSISTED` | PASS | `:947` — schedules.json + schedules-events.json hold lastRun/lastFireSlot/nextRun/runCount + ok event |
| `F3-4-STORE-PATH` | PASS | `:215` — store is the injected temp userData, not cwd |
| `F3-4-SURVIVES-RESTART` | PASS | `:1100` — fresh module instance loaded the same job + run record |
| `F3-4-NEXTRUN-RECOMPUTED` | PASS | `:310` — nextRun derived from cron at boot, not trusted from disk |
| `F3-4-RUNNING-NOT-LIES` | PASS | `:305` — a `running` status never survives a restart; `observed:true` comes from the ledger |
| `F3-4-NEXTRUN-UI-MATCH` | PASS | `src/components/panels/SchedulePanel.tsx:161` — panel `cronNextRun` == service `computeNextRun` for 5 expressions |
| `F3-4-CRON-VALIDITY-MIRROR` | PASS | `SchedulePanel.tsx:136` — panel and service agree on valid **and** invalid input |
| `F3-4-NO-CWD-WRITES` | PASS | `scheduleService.ts:215` — no schedule JSON/token/ledger appeared in `process.cwd()` |
| `F3-5-API-HONEST` | PASS | `:1278` — `runNow` → `{ok:false,error:'NO_WORKSPACE'}`, no fake run |
| `F3-5-TICK-DUE` | PASS | `:1261` — the same job is still due on the real tick |
| `F3-5-FIRE-HONEST` | PASS | `:974` — fire stores exactly `no workspace configured` + error broadcast |
| `F3-6-RUN-CALLBACK-INJECTED` | PASS | `:1002` — injected runner received exact prompt + workspace |
| `F3-6-NO-DOUBLE-FIRE` | PASS | `:972` — tick / `runSchedulerTick()` / `runNow()` all refuse a running job (`ALREADY_RUNNING`, 1 running broadcast, `inFlight:1`) |
| `F3-6-FINISH-ONCE` | PASS | `:1068` — one finish, one ok event |
| `F3-6-CANCEL-JOB` / `-ABORTED` | PASS | `:1248`, `:1128` — `cancelJob(id)` aborts by id; ends `run aborted` |
| `F3-6-PAUSE-CANCELS-INFLIGHT` / `-ABORTED` | PASS | `:1242` — `toggleJob(false)` cancels the in-flight run; no fake ok |
| `F3-6-PAUSE-DORMANT` | PASS | `:1083` — paused job stays dormant on a due slot |
| `F3-6-RESUME` | PASS | `:1238` — `toggleJob(true)` re-arms it |
| `F3-6-CANCEL` | PASS | `:1231` — `removeJob` kills it in memory **and** on disk |
| `F3-6-ABORT-ON-SHUTDOWN` | PASS | `:1134` — shutdown aborts in-flight runs, `running:false` |
| `F3-7-UI-POLLS` | PASS | `SchedulePanel.tsx:362` — re-polls real `scheduleList` every 5s |
| `F3-7-UI-EVENTS` | PASS | `SchedulePanel.tsx:380` — consumes the real `lastEvent` ledger, seq-gated flash |
| `F3-7-UI-OBSERVED` | PASS | `SchedulePanel.tsx:397` — state from observed real run/event |
| `F3-7-UI-NO-FAKE-ACTIVE` | PASS | `SchedulePanel.tsx:411` — clock says UNVERIFIED / UNAVAILABLE / OBSERVED, never fake ACTIVE |
| `F3-7-UI-VERIFY-LANDING` | PASS | `SchedulePanel.tsx:546` — create re-reads the list before saying "created" |
| `F3-7-UI-CANCEL-BRIDGE` | PASS | `SchedulePanel.tsx:378` — cancel control only when a real bridge exists |
| `F3-8-WEBHOOK-HONEST` | PASS | `scheduleService.ts:668` — busy port → `webhookListening:false` + `webhookError`, no fake READY |
| `F3-8-NO-CWD-FINAL` | PASS | `scheduleService.ts:602` — still no cwd writes after every test |

**Total / المجموع: 46 PASS / 0 FAIL.**

---

## 3. What is NOT proven here / ما لم يُثبت هنا (blunt limits)

1. **The real 30-second wall-clock interval was captured and invoked directly**,
   not waited on. This is the exact production callback (`:1104`), and the
   pre-existing `tests/schedule-live.test.mjs` separately proves the wall-clock
   route with a backdated job. No minute was slept through in this guard.
   / تم التقاط نبضة الـ30 ثانية الحقيقية واستدعاؤها مباشرة بلا انتظار؛ هذا هو
   رد النداء الإنتاجي ذاته، وهناك اختبار قديم يغطي مسار الساعة الحقيقية.
2. **Webhook firing was not exercised here**: port 7681 was already occupied in
   this environment (`EADDRINUSE`). The guard proved the *honest degradation*
   of that state instead of pretending the listener was ready. The webhook
   trigger path itself is covered by `tests/schedule-live.test.mjs` and skips
   honestly when the port is busy.
   / لم يُختبرإطلاق الويب هوك لأن المنفذ 7681 كان مشغولاً؛ أثبت الفاحص التدهور
   الصادق بدل ادّعاء الجاهزية، ومسار الإطلاق مغطى باختبار قديم.
3. **UI checks are source-level** (as requested), not a browser click-through:
   the panel's real exported `cronNextRun` was executed; rendering was inspected
   in source. I did not see the panel with my own eyes.
   / فحوص الواجهة على مستوى المصدر كما طُلب، لا نقرة متصفح؛ لم أرَ اللوحة بعيني.
4. **LLM was a local scripted mock.** Real API keys, real network and a real
   model were never used; that is a limit on the *agent's answer*, not on the
   scheduler's firing, which is what F3 is about.
   / نموذج اللغة مُحاكى محلياً؛ هذا يحدّ من «جودة الإجابة» لا من إطلاق المهمة.

---

## 4. Handoffs — needed before you say "shipped" / تسليمات قبل القول «تم الشحن»

| # | file:line | Issue / المشكلة | Fix / الإصلاح |
|---|---|---|---|
| H1 | `dist-electron/electron/main.js`, `dist-electron/electron/services/scheduleService.js` | Built artifacts are **stale** — no `computeNextRun`, `lastFireSlot`, `cancelJob`, `schedules-events.json`, `lastEvent`. The packaged app still runs the old scheduler. / ناتج البناء قديم والتطبيق المغلّف يعمل بالجدولة القديمة. | Rebuild the Electron/CLI bundles, then re-run this guard against the built artifact (not only the TS source). |
| H2 | `electron/ipc.ts:792-798` vs `electron/preload.ts:219-228` | Main exposes `kdx:schedule:status`, `kdx:schedule:events`, `kdx:schedule:cancel`, but the preload exposes none of them. / السيرفر يعرض قنوات الحالة والأحداث والإلغاء، لكن الـpreload لا يعرضها. | Add `scheduleStatus`, `scheduleEvents`, `scheduleCancel` to the preload + `src/lib/api.ts` so the panel can show REAL scheduler state instead of the honest "UNVERIFIED" heuristic. |
| H3 | `src/components/panels/SchedulePanel.tsx:377-378` | The cancel button is correctly hidden because there is no bridge. Pause still works through `scheduleToggle`. / زر الإلغاء مخفي بصدق لغياب الجسر؛ الإيقاف يعبر زر التبديل. | Resolved by H2. Do NOT render a dead cancel button before then. |
| H4 | `src/i18n.ts` (panel clock keys) | Check that `sch.clock.liveEvt`, `sch.clock.unverified`, `sch.webhook.*` and any new cancel label exist in **both** EN and AR. / تأكد من مفاتيح الواجهة بالإنجليزية والعربية. | Parent owns i18n; add fallbacks if any key is missing. |

---

## 5. Bottom line / الخلاصة

**EN:** Scheduled jobs really do fire on their cron minute, with the exact
prompt, real workspace work, correct persisted run state, honest errors, no
double-fires, working pause/cancel/abort, and a UI that refuses to claim ACTIVE
without an observed fire. **Source-level verdict: PASS (46/46).** The only thing
standing between this and the user's running app is a rebuild (H1) and an
optional renderer bridge (H2). I will not overstate it beyond that.

**AR:** المهام المجدولة تُطلق فعلاً في دقيقتها المحددة، بالنص الحرفي، وعمل حقيقي
في مساحة العمل، وحالة حفظ صحيحة، وأخطاء صادقة، بلا إطلاق مزدوج، مع إيقاف وإلغاء
يعملان، وواجهة ترفض ادّعاء ACTIVE بلا إطلاق مُرصَد. **حكم المصدر: نجاح (46/46).**
الذي يفصل هذا عن التطبيق الذي يشغّله المستخدم هو إعادة البناء (H1) وجسر اختياري
للواجهة (H2). لن أبالغ في القول بعد ذلك.
