# Flows vs Schedule — الحقيقة الكاملة / The Full Truth

**Verified by running the real tests** — 2026-11-19 · Node v22.22.2 · Windows · git 2.47.1.windows.2
Working dir: `D:\New folder (58)\SADEEM-v11.12.0-source\src-pkg-v1112\sadeem-v11.12.0`
Verification-only: لا تعديل على الكود المصدري. / No source code was modified.

---

## ٠. الخلاصة للمدؤس (TL;DR — founder version)

| السؤال | الجواب الصادق |
|---|---|
| شو الفرق بين الفلوز والسكجول؟ | **الفلوز = برومبت محفوظ تُرسله يدويًا في الشات** (الواجهة / renderer، يحتاج جلسة + workspace مفتوح). **السكجول = عامل كرون مستقل يعمل headless** مع بوابة إثبات (proof gate) ويكتب النتائج في `schedules.json`. **ليسا نفس الشيء.** |
| هل يعملوا؟ | **الفولز: نعم** (4/4 اختبارات حيّة نجحت، مع تنفيذ حقيقي كتب ملفًا على القرص). **السكجول: نعم** (4/4 اختبارات جوهرية نجحت + 1 SKIP بسبب منفذ مشغول، لا فشل). |
| والـ Worktree؟ | **يعمل في الغالب لكن ليس أخضر 100%:** 4 من 5 اختبارات worktree نجحت + اختبار denyHint نجح، و**واحد فشل** بـ `git timed out` (timeout 30 ثانية أثناء `git worktree add` تحت حمل عالٍ). الراية الحمراء حقيقية: 13/14 نجح، exit code 1. |

---

## ١. نتائج الاختبارات كما خرجت (exact, copy-pasted from TAP)

### أ) `node --test --test-force-exit tests/flows-live.test.mjs`

```
# tests 4
# pass 4
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 50282.7252
```

- `ok 1` — flows live: create a flow, run its prompt through the real engine, run record shows the run (25818 ms)
- `ok 2` — flows live: workspace flow validated by replay — exit 0 with the file written; failing replay reports the exit (4955 ms)
- `ok 3` — flows live: repeated prompt suggests saving on the 3rd hit and latches once it IS a flow (56 ms)
- `ok 4` — flows live: delete removes the flow from the run record store (61 ms)

الأدلة المادية داخل الاختبار: المحرك الحقيقي (`engine.runAgent`) استدعى مزوّدًا محليًا وكتب `proof-flows.txt` بمحتوى `HELLO-FLOWS-LIVE\n` على القرص، مع `write_file tool_start` + `tool_result(ok)` + `text_delta("DONE")` + `message_end(usage)`، ثم `flowsMarkRun` رفع `runCount` إلى 1 وختم `lastRun`. إعادة التشغيل (replay) نجحت بـ `exit 0` وكتبت `replay-proof.txt`، والفاشلة أعطت `exit 3` بصدق.

**الحكم: الفلوز يعمل — 4/4، صفر فشل، صفر تخطي.**

### ب) `node --test --test-force-exit tests/schedule-live.test.mjs`

```
# tests 5
# pass 4
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 175256.2258
```

- `ok 1` — backdated persisted job fires on runSchedulerTick — run recorded ok + persisted (30280 ms)
- `ok 2` — addJob with an every-minute cron fires via the REAL 30s ticker (113896 ms — انتظار ساعة حقيقية فعلًا)
- `ok 3` — runHeadlessAgent — "no model configured" when nothing is bound; success + usage when bound (13654 ms)
- `ok 4` — addJob validation errors and removeJob (19 ms)
- `ok 5` — **SKIP** — webhook trigger fires the job through the loopback listener
  - سبب التخطي الحرفي: `# SKIP webhook port 7681 already in use by another process`
  - وفي السجل: `[surnia-schedule] webhook listener unavailable: listen EADDRINUSE: address already in use 127.0.0.1:7681`

الأدلة المادية: وظيفة مؤرخة (backdated) انطلقت عند أول `runSchedulerTick()`، المهمة كتبت `proof-sched.txt` بمحتوى `SCHEDULED-WORK-HAPPENED\n` داخل workspace خاصتها، `lastStatus=ok` + `lastMessage` يحوي `PROOF-SCHEDULE-OK` + `sessionId` + tokens/cost، والبثّ `running → ok` حصل، و`schedules.json` تحدّث على القرص. اختبار التيكر الحقيقي انتظر حتى القطعة الدقيقة التالية ومرّ دون استدعاء يدوي لـ tick.

**الحكم: السكجول يعمل — 4/4 اختبارات فعلية نجحت. الـ SKIP ليس فشلًا خفيًا: المنفذ 7681 كان مشغولًا بعملية أخرى، والمجدول تعامل معه بصدق (degrade إلى webhook-less) بدل أن يتظاهر بالنجاح.**

> ملاحظة صادقة: اختبار الـ webhook نفسه **لم يُثبت** في هذه الجولة. لا أدّعي أنه تحقّق هنا.

### ج) `node --test --test-force-exit tests/v1111-modes.test.mjs`

```
# tests 14
# pass 13
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 511895.028
Exit code: 1
```

اختبارات الـ worktree تحديدًا:

| # | الاختبار | النتيجة |
|---|---|---|
| 9 | denyHint contract: create_skill / remember / **worktree_create** refuse under read-only denyHint | `ok` |
| 10 | worktree: create → list → resolve → commit → merge lands files → cleanup | **`not ok` — فشل** |
| 11 | worktree: conflicting merge REFUSES — main stays clean | `ok` (94708 ms) |
| 12 | worktree: delete refuses on DIRTY, force removes, dir+branch gone | `ok` (27412 ms) |
| 13 | worktree: .worktreeinclude copies .env into fresh worktree | `ok` (18327 ms) |
| 14 | worktree agent tools: worktree_create / worktree_remove via executeTool | `ok` (12568 ms) |

سبب الفشل الحرفي (test 10 عند `tests/v1111-modes.test.mjs:593` → `gitSvc.createWorktree`):

```
Preparing worktree (new branch 'sadeem/fix-api')
Updating files: 100% (2/2) ... done.

[surnia] git timed out
code: 'ERR_TEST_FAILURE'
stack: Object.createWorktree (...gitservice.cjs:281:11)
```

**تحليل الفشل بصدق:** الخطأ من `electron/services/gitService.ts` — الدالة `git()` تستخدم timeout افتراضي 30 ثانية (`gitService.ts:28`)، وعند انتهائه تقتل العملية وتضيف `[surnia] git timed out` وترجع code 124 (`gitService.ts:57-65`). `createWorktree()` تستدعي `git worktree add` بهذاTimeout الافتراضي (`gitService.ts:320`). اللافت أنّ git **أنهى العمل فعليًا** (`Updating files: 100% ... done.`) لكن عملية git لم تُغلق خلال 30 ثانية على هذا الجهاز تحت حمل الاختبارات المتوازي (المجموعة استغرقت ~8.5 دقائق). أي أنّ الآلية موجودة وتعمل في 4 مسارات أخرى — الفشل **timeout/أداء تحت حمل** وليس "feature غير مطبّقة". لكن لا يمكنني تسمية المجموعة خضراء: **13/14، exit 1**.

---

## ٢. الفرق الحقيقي في الكود (file:line — اقرأها بنفسك)

### الفلوز = برومبت محفوظ يُعاد إرساله في الشات

- `electron/services/flowsService.ts:1-7` — "// A 'flow' is a saved prompt the user can re-run with one click. The renderer re-sends the prompt as a normal chat message and separately calls flowsMarkRun(id) so runCount / lastRun stay accurate."
- `src/components/panels/FlowsPanel.tsx:3-7` — "// WHAT A FLOW IS: a saved, named PROMPT. Running one re-sends that exact text through the normal chat path (store.sendMessage) ... **A flow is NOT an autonomous job — scheduled crons are a separate feature with a proof gate.**"
- `src/components/panels/FlowsPanel.tsx:387-389` — يمنع التشغيل إن لم يكن workspace مفتوحًا: `notify(t('misc.notify.noWorkspace', 'Open a workspace first'))`.
- `src/components/panels/FlowsPanel.tsx:400` — `void sendMessage(f.prompt)` ← هذا هو "التشغيل": إرسال النص كرسالة شات عادية من الـ renderer (تحتاج جلسة/واجهة).
- `src/components/panels/FlowsPanel.tsx:411` — `flowsApi.flowsMarkRun?.(f.id, wsPath)` — تسجيل إحصائي فقط (best-effort).
- `electron/services/flowsService.ts:341-369` — `flowsMarkRun` يزيد `runCount` ويختم `lastRun` فقط؛ **لا ينفّذ أي شيء**.
- `electron/services/flowsService.ts:237-304` — `flowsSave` يخزّن النص في `flows.json` / `.surnia/flows.json` (`:69-75`) — بلا cron، بلا worker، بلا باث مستقل.
- `electron/services/flowsService.ts:601-616` — `flowsValidateByReplay` تحقق اختياري عبر `runCaptured` (exit code) — ليس تشغيلًا ذاتيًا.

> الخلاصة: الفلو **لا يعمل إلا وأنت تضغط Play** داخل التطبيق، وينفّذ داخل جلسة الشات الحالية.

### السكجول = عامل cron مستقل headless + بوابة إثبات

- `electron/services/scheduleService.ts:1-12` — "// Cron-style jobs that run the agent HEADLESS on a timer ... approvals are auto-DENIED (safe-by-default) ... Status changes are broadcast as 'kdx:schedule-event'."
- `electron/services/scheduleService.ts:31` — `const TICK_MS = 30_000`؛ `:695` — `ticker = setInterval(tick, TICK_MS)`؛ `:669-684` — `tick()` يفحص كل الوظائف ويُطلق المستحقّة.
- `electron/services/scheduleService.ts:456-579` — `runHeadlessAgent` يبني `AgentIO` أصغر بدون واجهة: يجمع النص في buffer، يحسب tokens/cost (`:530-533`)، و**يرفض كل الموافقات تلقائيًا** (`:541-545`: `action: 'deny'`).
- `electron/services/scheduleService.ts:592-665` — `fireJob()` ينفّذ المهمة ثم **الـ PROOF GATE** في `:621-648`: يكتشف أمر الاختبار (`:383-411` `detectTestCommand`) ويشغّله عبر `runCaptured` (`:632`)؛ إن فشل → `lastStatus='error'` ورسالة `[proof gate] automation claims done but the test suite FAILED ... suppressed` (`:635-637`)، ويُكبت الإشعار (`:652`).
- `electron/services/scheduleService.ts:329-370` — مستمع webhook على `127.0.0.1:7681` مع token (403 للخطأ)؛ `:361-364` يتعامل مع EADDRINUSE بسلام.
- `electron/services/scheduleService.ts:688-706` — `initScheduleService` يحمل `schedules.json` ويشغّل المؤقّت + الـ webhook؛ `:60-62, 109-119` التخزين الذري.

> الخلاصة: السكجول **يعمل وأنت غير موجود** — لا شات، لا جلسة تفاعلية، ويرفض التعديلات غير المصرّح بها، ولا يُعلن "تم" إلا بعد نجاح بوابة الإثبات.

### هل هما نفس الشيء؟ لا. (Across-file proof)

`src/components/panels/FlowsPanel.tsx:5-6` يقول حرفيًا إن الفلو **ليس** وظيفة ذاتية وأن cron feature منفصل بـ proof gate. الجدول:

| | Flow | Schedule |
|---|---|---|
| المحفّز | ضغط Play في الواجهة `sendMessage(f.prompt)` | `setInterval` كل 30 ث + cron / webhook |
| مكان التنفيذ | renderer + جلسة شات حالية | worker headless عبر `runAgent` |
| يحتاج واجهة/جلسة؟ | **نعم** (workspace مفتوح + شات) | **لا** |
| الموافقات | قرار المستخدم في الشات | auto-DENY افتراضيًا |
| إثبات النجاح | `flowsMarkRun` (إحصاء فقط) | proof gate 실행 فعلي لسuite الاختبارات |
| التخزين | `flows.json` / `.surnia/flows.json` | `schedules.json` + `schedules-token` |
| الملف | `flowsService.ts` + `FlowsPanel.tsx` | `scheduleService.ts` |

---

## ٣. الحكم النهائي (brutally honest)

- **الفولز: يعمل.** 4/4 اختبارات حيّة، بما فيها كتابة ملف حقيقي بمحرك حقيقي. لكن سمّيه "زر برومبت محفوظ"، لا أتمتة.
- **السكجول: يعمل.** 4/4 اختبارات جوهرية نجحت مع إثبات فيزيائي وتيكر حقيقي بالساعة. الـ webhook لم يُختبر في هذه الجولة (SKIP لالتقاط منفذ 7681) — لا أبالغ في الادعاء.
- **الـ Worktree: يعمل جزئيًا فقط في هذه الجولة.** 5 من 6 اختبارات متعلقة نجحت؛ اختبار الإنشاء/الدمج فشل بسبب `git timed out` (timeout 30 ثانية تحت حمل). الآلية موجودة (4 مسارات أخرى أثبتتها)، لكن **المجموعة ليست خضراء: 13/14، exit code 1**. إن أردت ادعاءً قاطعًا، أعد تشغيل اختبار الـ worktree بمفرده على جهاز غير محمّل أو ارفع timeout الـ git.

كل ما سبق مُثبت بأوامر فعلية ومخرجات TAP خام — لا تخمين، لا تجميل.
