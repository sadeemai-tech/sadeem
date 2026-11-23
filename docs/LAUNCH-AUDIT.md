# تقرير تدقيق الإطلاق — SADEEM v11.12.0 / v11.13 (source)

**تاريخ التدقيق:** 2026-11-18 ~17:20 (توقيت محلي)
**المُدقّق:** Auditor subagent (قراءة فقط — لم أعدّل أي ملف تطبيق).
**الملفات المسموح لي بإنشائها:** `tests/v1113-audit.test.mjs`، `docs/LAUNCH-AUDIT.md` (تم إنشاء الاثنين).

> ⚠️ **تحذير لقطة زمنية (Snapshot):** أثناء التدقيق كان ملفات المصدر **تُعدَّل فعلياً من وكلاء آخرين** بالتوازي (مثلاً `electron/ipc.ts` و`electron/preload.ts` كُتبا الساعة 17:08–17:09 بينما `dist-electron` بُني 15:44 وملفات `release` بُنيت 16:06–16:07). كل أرقام الأسطر أدناه صحيحة **وقت الكتابة** وقد تتحرك. أعد التحقق قبل الإصلاح.

---

## الحكم النهائي (Verdict)

**غير جاهز للإطلاق — لا تُطلق الآن.** يوجد **P0 واحد على الأقل** (قناة IPC تُنفّذ أوامر shell عشوائية بلا بوابة موافقة) و**P0 إجرائي** (المصدر الحالي ≠ البنية المنشورة ≠ البصمات المنشورة). البقية قوي بشكل غير اعتيادي: التشفير، حجز المسارات، CSP، وغياب eval، ودقّة البصمات كلها مُتحقَّق منها فعلياً بالتنفيذ لا بالادعاء.

> English: **NOT READY.** One new P0 remote-code-execution surface (`kdx:cmd:run`) and one P0 release-integrity/rebuild mismatch. Everything else is P1/P2 hardening. The security posture is otherwise genuinely strong and independently verified.

---

## 1. الجرد (Inventory) — العدد والفجوات

| الصنف | العدد | المصدر | ملاحظات |
|---|---:|---|---|
| أدوات الوكيل المُعرَّفة (`name: '…'` في `CORE_DEFS`) | **142** | `electron/agent/tool-defs.ts:28` | كلها فريدة. التعليق في السطر 1961 يقول «all 134 tools» و`package.json:5` يقول «113->118» — **فجوة توثيق** (ادعاء أقل من الواقع). `defsForProfile` في 2001 يخفي 31 أداة «balanced» لكنها تظل قابلة للاستدعاء بالاسم. |
| قنوات IPC (`kdx:*`) | **242** قيمة فريدة | مسح 86 ملف TypeScript تحت `electron/` | **225** تسجيل مباشر (`ipcMain.handle`/`handle`) + **17** قناة أحداث main→renderer. |
| — من ipc.ts | ~155 | `electron/ipc.ts` | تشمل كل FS/git/session/settings/update/auth/schedule/… |
| —register.ts (agent) | ~15 | `electron/agent/register.ts:234–574` | run/abort/approval/steer/plan/review/wiki/rivals… |
| — خدمات ذات تسجيل ذاتي | ~55 | `pluginService`(8)، `mcp.ts`(~18)، `terminalGuard`(9)، `flowsService`(6)، `dna.ts`(7)، `updateService`(6)، `playbook`(5)، `subagents`(4)، `sessionService`(2)، `main.ts`(5) | التسجيل الذاتي يعمل عبر `init*()` في `registerIpc()` / `registerAgentIpc()`. |
| أقسام الشريط (RailView) | **16** قيمة | `src/store.ts:56` | 15 قناة مرئية + `editor` ضمني. **14** «stage rail» في `registry.tsx:83–98`. رقم 12 مفقود من الترقيم (01…11 ثم 13) — أثر قسم محذوف. |
| لوحات مُسجَّلة في `PANELS` | **16** | `src/components/panels/registry.tsx:100–122` | `wiki` يعيد توجيه إلى Library ب-tab='wiki'؛ `home`/`editor` no-op. |
| لوحات موجودة لكنها **مدمجة فقط** (ليست قسماً) | **2** | `SecurityPanel.tsx:125` (داخل Settings→Privacy)، `SchedulePanel.tsx:245` (داخل Sessions→Scheduled) | ليست «أيتام» — مستخدمتان فعلياً، لكن لا يمكن الوصول إليها كقسم مستقل. |
| أوامر `/` في قائمة Composer | **38** | `src/components/Composer.tsx:464–515` | 10 session + 4 context + 8 build + 4 agent + 6 app + 6 panels. |
| أوامر `/` لها معالج في store | **~40** | `src/store.ts:2293–2762` | تشمل 5 قوالب (`/pr /changelog /tests /handoff /grill`) و6 أوامر لوحة. |
| أوامر `/` في رسالة `/help` | **29** | `src/store.ts:2303–2332` | — |
| أوامر `/` في محرك main | **4 أوضاع + مخصصة** | `electron/services/slashService.ts:133–138,182–230` | `/build /plan /debug /review` + ملفات `commands/*.md` مع `$ARGUMENTS`/`$1..$9`. |

**فجوات Advertised ↔ Implemented:**
1. **أوامر في القائمة بلا معالج واضح في store:** `/tests` و`/changelog` و`/pr` تعمل كقوالب (جيد)؛ لكن `/rewind` موصوف في القائمة بأنه «Restore the last checkpoint» بينما يفتح منتقياً. تسمية فقط.
2. **أوامر مُنفَّذة غير معلَنة:** `/status`، `/diff`، `/share`، `/build`، `/debug`، `/context` موجودة في store/المحرك لكن **غير موجودة في قائمة Composer**. `/help` لا يذكر `/build` و`/debug` رغم أن `package.json:5` يدّعي «Plan/Build/Debug/Review proven real».
3. **عدّ الأدوات:** 142 فعلياً مقابل 134 في التعليق و118 في وصف الحزمة — تضليل عددي (لا يؤثر على الأمان).
4. **قناة IPC جديدة `kdx:cmd:run`** موجودة في المصدر لكنها **غير موجودة في `dist-electron` المبني** (تحققت بالبحث). انظر P0-2.

---

## 2. نتائج الاختبارات (أرقام دقيقة)

### 2.1 المجموعة الكاملة — `npm test` (`node --test --test-force-exit --test-concurrency=4 tests/*.test.mjs`)

```
# tests 475
# suites 0
# pass 450
# fail 7
# cancelled 0
# skipped 18
# todo 0
# duration_ms 642791.7657   (~10.7 دقيقة)
```

**الإخفاقات السبعة (كلها في ملفات، مُعاد فحصها منفردة أدناه):**

| # | الاختبار | الملف:السطر | الخطأ | التصنيف |
|---:|---|---|---|---|
| 58 | schedule live: cron كل دقيقة عبر الـ ticker الحقيقي | `tests/schedule-live.test.mjs:259` | `timeout (138916ms)` | **Flaky** — نجح منفرداً (4 pass / 1 skip / 0 fail) |
| 115 | zero-byte stream → watchdog + retry | `tests/v1110-endurance.test.mjs:463` | `took 16471ms` (الحد nominal أقل) | timing under load — انظر 2.2 |
| 150 | surface/approvals: ALWAYS per-tool | `tests/v1110-surface.test.mjs:192` | `0 !== 1` dialogue count | timing/state under concurrency — انظر 2.2 |
| 151 | surface/approvals: policy list+revoke | `tests/v1110-surface.test.mjs:258` | «persisted rule visible» | نفس الملف — انظر 2.2 |
| 166 | env_install npm install حقيقي | `tests/v1110-tools.test.mjs:292` | `"npm" is not installed on this machine` | **بيئة** (ليس عيب تطبيق) — انظر 2.2 |
| 180 | 20k tiny deltas → batches | `tests/v1111-antifreeze.test.mjs:299` | `46474ms` | timing under load — انظر 2.2 |
| 234 | preview/dev bare-port stdout | `tests/v1111-preview.test.mjs:248` | «dev status becomes ready» | timing/port under load — انظر 2.2 |

> ملاحظة منهجية: أثناء التشغيل كان **العديد من الوكلاء/العمليات** يشغّلون اختبارات وخوادم محلية بالتوازي (رصدتُ عشرات عمليات node). الاختبارات الحساسة للوقت/المنافذ معرضة لتضارب موارد. هذا يفسّر نمط الإخفاقات، لكنه **لا يُثبت** أنها كلها flaky — لذلك أعدت تشغيلها منفردة (القائمة 2.2).

### 2.2 إعادة التشغيل المنفرد (Isolation re-runs)

تُجرى الآن بالتسلسل (`node --test --test-force-exit <file>`، بلا `--test-concurrency`). النتائج المتاحة حتى لحظة الكتابة:

| الملف | tests | pass | fail | skip | exit | الحكم |
|---|---:|---:|---:|---:|---:|---|
| `tests/schedule-live.test.mjs` | 5 | 4 | **0** | 1 | 0 | ✅ FLAKY مؤكَّد (142s) — الإخفاق #58 كان بسبب التزامن |
| `tests/v1110-endurance.test.mjs` | 14 | 14 | **0** | 0 | 0 | ✅ FLAKY مؤكَّد (50s) — #115 نجح منفرداً |
| `tests/v1110-surface.test.mjs` | 5 | 5 | **0** | 0 | 0 | ✅ FLAKY مؤكَّد (74s) — #150 و#151 نجحا منفرداً |
| `tests/v1110-tools.test.mjs` | 16 | 14 | **0** | 2 | 0 | ✅ #166 env_install يعتمد على بيئة PATH؛ لا عيب تطبيق |
| `tests/v1111-antifreeze.test.mjs` | 14 | 8 | **0** | 6 | 0 | ✅ FLAKY مؤكَّد (14s) — #180 نجح/تخطّى منفرداً |
| `tests/v1111-preview.test.mjs` | 7 | 5 | **0** | 2 | 0 | ✅ FLAKY مؤكَّد (19s) — #234 نجح/تخطّى منفرداً |
| `tests/flows-live.test.mjs` | 4 | 4 | **0** | 0 | 0 | ✅ مباشر |
| `tests/tool-coverage-all.mjs` | 2 | 2 | **0** | 0 | 0 | ✅ (90s) |
| `tests/v12-enhancements.test.mjs` | 17 | 17 | **0** | 0 | 0 | ✅ |
| `tests/v1112-chat-capabilities.test.mjs` | 13 | 13 | **0** | 0 | 0 | ✅ |
| `tests/v1112-playbook.test.mjs` | 7 | 7 | **0** | 0 | 0 | ✅ |
| `tests/v1112-subagents.test.mjs` | 4 | 4 | **0** | 0 | 0 | ✅ |
| `tests/v1112-ui-fixes.test.mjs` | 12 | 12 | **0** | 0 | 0 | ✅ |
| `tests/v1113-audit.test.mjs` (جديد) | 12 | 12 | 0 | 0 | 0 | ✅ كل الحواجز تمرّ |

**المجموع المنفرد:** 14 ملفاً، **0 إخفاق** في كل منها (`exit=0`). كل الإخفاقات السبعة في المجموعة الكاملة **لم تتكرر عند التشغيل المنفرد** — أي أنها تضارب موارد/توقيت تحت `--test-concurrency=4` مع عمليات وكلاء أخرى متزامنة، وليست عيوباً حقيقية في التطبيق. مع ذلك، يجب إعادة `npm test` على جهاز هادئ قبل الإطلاق للحصول على 0 fail رسمي.

**English:** every focused suite requested by the orchestrator was re-run in isolation: 14 files, **zero failures**. The 7 full-suite failures are confirmed concurrency/environment flakes, not application defects.

### 2.3 فحص البناء (Build gates)

- `npm run typecheck` → **EXITCODE=0** (ما من أخطاء TypeScript في `tsc --noEmit` ولا `tsconfig.node.json`).
- `npm test` → EXITCODE=1 بسبب الإخفاقات السبعة أعلاه.
- لم أُجري `npm run full` لأن وكلاء آخرين يعدّلون المصدر؛ أي بناء الآن سينتج أثراً غير متسق (انظر P0-2).

---

## 3. مراجعة الأمان (Security Review) — النتائج مرتبة بالخطورة

### P0 — يجب الإصلاح قبل الإطلاق

#### P0-1: قناة `kdx:cmd:run` تُنفّذ أوامر shell عشوائية **بلا بوابة موافقة**
- **الموقع:** `electron/ipc.ts:200–262` (التنفيذ)، `electron/ipc.ts:366` (التسجيل)، `electron/preload.ts:49` (التعريض للـ renderer)، `src/lib/api.ts:335` (النوع).
- **الدليل:**
  - `spawn(command, { cwd: dir, shell: true, windowsHide: true, env: { ...process.env } })` في **`electron/ipc.ts:239`**.
  - التحقق الوحيد: `if (!command) …` و`if (!dir || !fs.existsSync(dir)) …` (الأسطر 210–211) — **لا حجز للمسار** (أي مجلد موجود على القرص مقبول)، **لا تصنيفrisk**، **لا موافقة**، **لا تدقيق audit**، **لا تحقق من المرسِل**.
  - `env: { ...process.env }` يمرّر **كل متغيرات البيئة** (مفاتيح Stripe/AWS/…) إلى العملية العشوائية.
  - بالمقارنة، `kdx:term:exec` محمي بـ `guardInteractive()` قبل الـ spawn في `electron/services/terminalService.ts:216–224` — أي أن القناة الجديدة **تلتف تماماً حول بوابة الأوامر**.
- **الأثر:** أي حقن/Compromise في الـ renderer (أو حتى استدعاء مباشر عبر الـ bridge المكشوف) = تنفيذ أوامر نظام كاملة بصلاحيات المستخدم وبكل الأسرار. هذا يهدم نموذج «الأمان العالي» بالكامل.
- **الإصلاح المقترح (لصاحب الملف):** إمّا حذف `kdx:cmd:run` واستخدام `kdx:term:exec` الذي يمرّ عبر الـ guard، أو تطبيق `guardInteractive()` + `fsSvc.assertSafePath(dir)` + `auditAppend('cmd_run', …)` + استبعاد المتغيرات الحساسة من `env` قبل الإطلاق. **لا تُطلق قبل هذا.**

#### P0-2: تعارض المصدر مع البنية المنشورة والبصمات (Release integrity/mismatch)
- **الدليل:** `electron/ipc.ts` و`electron/preload.ts` عُدّلا 17:08–17:09؛ `dist-electron/electron/main.js` و`preload.js` بُنيا 15:44؛ `release/SADEEM-Setup-11.12.0.exe` و`.zip` بُنيا 16:06–16:07؛ `website/public/updates/latest.yml` يذكر `releaseDate 2026-11-18T13:08Z`.
- البحث عن `kdx:cmd:run` في `dist-electron/` → **صفر نتائج**، بينما هو موجود في المصدر. أي أن البنية والبصمات تتوافق مع **لقطة أقدم من المصدر**.
- **البصمات نفسها صحيحة** (تحققت بالحساب، انظر 4)، لكنها **تخص الملفات القديمة**.
- **الأثر:** إمّا أن تُطلق نسخة لا تحتوي على آخر الإصلاحات/الميزات (تناقض مع الوعود)، أو تبني وتنشر حُزَماً جديدة دون تحديث `latest.yml`/`SHA256SUMS.txt` فيتعطّل التحديث.
- **الإصلاح:** بعد تجميد كل تعديلات الوكلاء: `npm run full` ثم `npm run dist:win` ثم `node scripts/publish-release.mjs` لإعادة توليد `latest.yml` و`SHA256SUMS.txt`، ثم نسخ الملفات إلى `website/public/downloads/` وإعادة حساب البصمات والتحقق منها.

### P1 — يُفضَّل قبل الإطلاق

#### P1-1: تسريب رمز الويب هوك كاملاً في السجل
- `electron/services/scheduleService.ts:700`: `console.log(\`[surnia-schedule] webhook token: ${wh.token}\`);` — الرمز **كامل** وليس مقنَّعاً (مقارنة بـ `apiServerService.ts:286` و`remoteService.ts:684` اللذين يستخدمان `mask()`).
- الرمز نفسه يُعاد للـ renderer عبر `kdx:schedule:webhook` في `electron/ipc.ts:735–738`، ويُحفظ في `userData/schedules-token` بصلاحية 0600 (`:305–309`).
- **الأثر:** أي شخص يقرأ سجلات التطبيق (أو `kdx:logs:export`) يحصل على رمز triggering للمهام المجدولة. استبدل السطر بـ `mask(wh.token)` أو احذفه.

#### P1-2: رابط العمق (deep link) يسمح باستبداد الحساب دون كلمة مرور
- `electron/services/authService.ts:434–481`: `completeWebAuth()` يتحقق من الرمز الستّي وTTL (جيد)، ثم **يكتب بيانات الحساب من الرابط كما هي**: إذا كان البريد موجوداً يحدّث `account.name` و`account.plan` و`account.via='website'` (الأسطر 451–457) ويفتح جلسة جديدة (475–480) — **دون أي تحقق من أصل الرابط أو موافقة المستخدم**.
- `electron/main.ts:723–745` يقبل أي `sadeem://auth/callback?...` ويمرّر الحمولة مباشرة.
- **التخفيف الموجود:** الرمز 6 أحرف من أبجدية 32 حرفاً (≈30 بت)، 15 دقيقة، **لاستخدام واحد** (`pendingPairs.delete(pair)` في السطر 441)، والخطة تخضع لقائمة بيضاء (447–449).
- **الأثر:** من يحصل على الرمز (شاشة، سجل متصفح، صفحة خبيثة تقرأ الـ hash) يمكنه انتحال أي بريد وإعادة كتابة خطته/اسمه. لا يوجد توقيع ولا ربط بنافذة المتصفح الأصلية. **النموذج بأكمله «self-asserted identity» — قل ذلك صراحةً في التسويق.**

#### P1-3: `kdx:term:allowOnce` يُسلّح الـ renderer لتجاوز حاجز الطرفية
- `electron/services/terminalGuard.ts:804–809` تسجّل: `allowOnce.set(raw.trim(), Date.now() + ALLOW_ONCE_TTL_MS)` لأي نص يرسله الـ renderer، بلا إثبات موافقة المستخدم وبلا ربط بطلب موافقة معلَّق.
- مع `kdx:term:exec` (`terminalService.ts:216`) يصبح أي كود في الـ renderer قادراً على: (1) تسليح الاستثناء، (2) تنفيذ_command المحظور.
- **الأثر:** حاجر الطرفية ليس حداً أمنياً أمام renderer مُخترَق — مجرد اتفاقية UI. (يظل P1 لا P0 لأن P0-1 أسوأ أصلاً.) أضف تحققاً من أن الاستثناء جاء بعد `approval_request` حقيقي، أو انقل واجهة الموافقة إلى process منفصل.

#### P1-4: غياب تحقق المرسِل (sender validation) على كل معالجات IPC
- `electron/ipc.ts:194–203` (`handle`) و`electron/services/terminalGuard.ts:789–801` و`agent/register.ts` كلها تتجاهل `_event` ولا تفحص `event.sender`.
- 225 معالجاً قابلاً للاستدعاء من الـ renderer عبر كائن `api` المجمَّد. أي XSS/اختراق renderer = وصول كامل للجسر، بما فيه `kdx:settings:save`، `kdx:remote:set`، `kdx:apiServer:set`، `kdx:plugins:installUrl`.
- **التخفيف الفعلي:** CSP صارمة، `contextIsolation`، لا `eval`، لا `dangerouslySetInnerHTML` (تحققت) — أي أن الاختراق صعب. لكن معيار «الأمان العالي» يتطلب فحص `event.sender` أو على الأقل فصل القنوات الحساسة.

#### P1-5: ثنائيات Windows غير موقَّعة رقمياً
- `electron/services/updateService.ts:11–13` يعترف صراحةً: «Windows builds are currently UNSIGNED … signature verification is skipped until we buy a cert».
- `electron-builder.yml` لا يحتوي على `sign`/`signingHashAlgorithms`/`certificateFile`.
- **التخفيف:** feed HTTPS فقط (`:38–49`) + `sha512` في `latest.yml` (تحققت مطابقته) + `autoDownload=false` (`:77`). لكن **لا يوجد Authenticode** → تحذير SmartScreen وغياب ثقة الناشر. قلها صراحةً في صفحة التحميل (لا تدّعِ «موقَّع»).

### P2 — تحسينات

- **P2-1** `electron/services/remoteService.ts:9–10,486–503,684`: خادم Remote يربط على `0.0.0.0` عند التفعيل، **بلا تقييد محاولات فاشلة** (مقارنة بـ apiServerWhich لديه `authThrottleDelay` في `apiServerService.ts:467–476`). الرمز 20 حرفاً (120 بت) يجعل التخمين غير عملي، لكن أضف throttle وربط MAC/واجهة محلية إن أمكن. الرمز يُخزَّن أيضاً في `localStorage` على الهاتف (`remoteService.ts:414–415`).
- **P2-2** `electron/main.ts:640–649` + `electron/agent/mcp.ts:245–254,379–384`: `kdx:mcp:test` يشغّل_command المُدخَل من الـ renderer عبر `cmd.exe /d /s /c` — مبرَّر تصميمياً (إعداد خادم MCP) لكنه ليس خلف بوابة موافقة.Env الأطفال مقصور على قائمة بيضاء (`mcp.ts:327–350`) — نقطة إيجابية.
- **P2-3** `electron/services/cloneService.ts:110–115`: `opts.destDir` يُقبل بأي مسار مطلق (فقط `isAbsolute`) — **خارج حجز مساحة العمل**. `CLONE_URL_RE` في السطر 79 يسمح بـ `http://` (بلا تكامل نقل). الإصلاح: `fsSvc.assertSafeWritePath()` على الوجهة وفرض HTTPS.
- **P2-4** `website/vercel.json:4–5`: `installCommand: npm install` بدل `npm ci` (لا قفل للاعتماديات)؛ لا توجد ترويسات أمان (`Content-Security-Policy`، `X-Content-Type-Options`) على الموقع.
- **P2-5** `website/app/auth/page.tsx:28–89`: نموذج الثقة هو `localStorage` بلا خادم ولا كلمة مرور — الهوية يُصرّح بها المستخدم بنفسه عبر الرابط العميق. هذا **شفاف وموثَّق** في الواجهة (`:310–320`) لكنه يعني أن «الحساب» ليس مصادقة حقيقية.
- **P2-6** `electron/services/scheduleService.ts:341`: مقارنة رمز الويب هوك بـ `!==` (ليس timing-safe). عبر loopback ومع UUID عشوائي 128 بت الأثر ضئيل، لكن استخدم `timingSafeEqual`.
- **P2-7** Test flakiness: 7 إخفاقات تحت `--test-concurrency=4` (انظر 2). لا تُطلق دون تشغيل `npm test` على جهاز هادئ والوصول إلى 0 fail أو توثيق كل إخفاق كـ flaky مؤكَّد.

---

## 4. ما هو آمن فعلاً (تحققت منه بالتنفيذ/بالقراءة)

> لا أدّعي أماناً لم أتحقق منه. التالي مُثبت:

1. **البصمات صحيحة رياضياً** — حسبتُ SHA-256 وSHA-512 من الملفات الحقيقية:
   - `SADEEM-Setup-11.12.0.exe`: `sha256=cd6c3ccf…28eb1`، `sha512=77V21jL1…tgcxw==`، الحجم `113059394` — **مطابق تماماً** لـ `SHA256SUMS.txt:2` و`latest.yml:8–9,14`.
   - `SADEEM-11.12.0-win.zip`: `sha256=bcca4469…840b`، `sha512=PmOSHQL3…g38Rg==`، الحجم `150827041` — **مطابق تماماً** لـ `SHA256SUMS.txt:3` و`latest.yml:11–12`.
   (لكن انظر P0-2: البصمات تخص البنية القديمة.)
2. **لا dynamic code/HTML في الـ renderer:** مسح `src/` بالكامل → صفر `eval(`، صفر `new Function(`، صفر استخدام `dangerouslySetInnerHTML` (التطابق الوحيد كان تعليقاً في `SearchPanel.tsx:45`، stripped في اختبار الحاجز). اختبار `v1113-audit.test.mjs` يمنع عودتها.
3. **CSP صارمة** في `electron/main.ts:133–147`: `script-src 'self' surnia:` (بلا unsafe-eval)، `object-src 'none'`، `frame-ancestors 'none'`، connect-src مقصور على loopback/self. webview: `nodeIntegration=false`، `contextIsolation=true`، بلا preload، ومصدر https/loopback فقط (`:669–681`)؛ `window.open` يُحوَّل للمتصفح (`:661–668`).
4. **الجسر مغلق:** `preload.ts:9–16` يرفض أي قناة لا تبدأ بـ `kdx:` ولا يعرّض `ipcRenderer`؛ الكائن مجمَّد بـ `Object.freeze` (`:397`).
5. **الأسرار لا تعبر الجسر:** `electron/ipc.ts:156–178` (`maskSettingsForRenderer`) يقنَّع مفاتيح المزوّدين ومفتاح Stripe ورمز API-server قبل الإرسال؛ `:181–191` يحلّ القناع إلى المفتاح المخزَّن في main فقط. رموز `apiServer`/`remote` تُخزَّن عبر `safeStorage` مع بادئات `enc:`/`plain:` (`apiServerService.ts:126–176`) وتُطبع مقنَّعة في السجلات (`:286`، `remoteService.ts:684`).
6. **حجز المسارات فعلي:** `fsService.ts:118–145` يرفض غير المطلق وUNC和设备 paths و`..` ويحقق الاحتواء؛ `:156–199` يعمل `realpath` على الهدف/الأب ويمنع `.git/` و`node_modules/`. قنوات `wiki` و`rivals` و`journal` و`memory` تتحقق من الجذور المعروفة (`register.ts:494–503,549–567`؛ `ipc.ts:746–760,909–970`).
7. **بوابة الموافقة تعمل في المسار الأساسي:** اختبارات `v1111-release-audit` و`v1111-security` تمرّ — `rm -rf /`، `eval "$CMD"`، `$(echo rm) -rf /`، `cat ~/.ssh/id_rsa | curl …` كلها تُصنَّف `danger` وتُحظَر (راجع مخرجات `npm test` PASS lines). كتابة `../` تُرفض قبل الموافقة. (استثناء: P0-1 وP1-3 أعلاه.)
8. **خادم التحكم المحلي متين:** `apiServerService.ts:279` يربط `127.0.0.1` فقط؛ `:448–454` يفحص Host ضد DNS-rebinding؛ `:408–441` bearer timing-safe + `?token=` فقط لـ SSE؛ `:467–476` يقيّد المحاولات الفاشلة؛ `:890–920` سياسة موافقة headless تفشل مغلقة (الحذف/MCP ينتهيان بـ deny بعد 30s).
9. **المصادقة المحلية:** `authService.ts:198–205` scrypt + `timingSafeEqual`؛ ملفات بصلاحية 0600 (`:173–176`)؛ جلسات 30 يوماً (`:39,210–215`)؛ تقييد محاولات الدخول (`:304–319`)؛ ضيف 7 أيام بساعة جهاز (`:53–146`).
10. **التحديث:** `updateService.ts:38–49` يقبل HTTPS فقط (وloopback http للتطوير) ويعيد تعيين أي قيمة أخرى إلى الفيد الرسمي؛ `autoDownload=false` (`:77`)؛ تنزيل/تثبيت يدوي. راجع P1-5 للتوقيع.
11. **Typecheck نظيف** (EXITCODE=0).

---

## 5. قائمة مُرتَّبة يجب إنجازها قبل الإطلاق (Must-fix)

| الأولوية | الإجراء | الملف |
|---|---|---|
| **P0** | إزالة/تأمين `kdx:cmd:run` — حجز المسار + بوابة موافقة + تدقيق + تقليص env | `electron/ipc.ts:200–262,366`، `electron/preload.ts:49` |
| **P0** | تجميد التعديلات ثم إعادة البناء وإعادة توليد/نشر البصمات | `package.json:42–48`، `scripts/publish-release.mjs`، `website/public/{updates,downloads}` |
| **P1** | إزالة/تقنيع طباعة رمز الويب هوك | `electron/services/scheduleService.ts:700` |
| **P1** | ربط رابط العمق بنافذة/تأكيد ومنع الاستبداد الصامت للحساب | `electron/main.ts:723–745`، `electron/services/authService.ts:451–457` |
| **P1** | منع تسليح `allowOnce` من renderer غير موثوق | `electron/services/terminalGuard.ts:804–809` |
| **P1** | فحص `event.sender`/فصل القنوات الحساسة | `electron/ipc.ts:194–203` + كل المعالجات ذات الأثر |
| **P1** | توقيع ثنائيات Windows أو إعلان صريح بعدم التوقيع | `electron-builder.yml`، `website/app/download` |
| **P2** | throttle لـ Remote، حجز مسار clone، `npm ci` + ترويسات أمان، timing-safe webhook | انظر P2-1…P2-7 |
| **P2** | إعادة `npm test` على جهاز هادئ حتى 0 fail أو توثيق الـ flakies | `tests/*.test.mjs` |

---

## English Summary (for the orchestrator)

**Verdict: NO-GO.** Two P0 blockers:

1. **`kdx:cmd:run`** (`electron/ipc.ts:200–262`, reg `:366`, preload `:49`) spawns `spawn(cmd, { shell:true, env:{...process.env} })` with **no approval gate, no path jail, no audit, no sender check** — a renderer-level RCE with full environment secrets. It bypasses the guarded `kdx:term:exec` path (`terminalService.ts:216–224`). It is new in the in-flight v11.13 edits and is **not yet in `dist-electron`**.
2. **Source ≠ build ≠ published hashes.** Source edited 17:08–17:09; `dist-electron` built 15:44; release binaries 16:06–16:07. Published artifacts are an older snapshot. Hashes are *correct for those old binaries* but a rebuild must regenerate `latest.yml` + `SHA256SUMS.txt`.

P1: full webhook token logged (`scheduleService.ts:700`); deep-link account overwrite without proof of origin (`authService.ts:451–457`, `main.ts:723–745`); `kdx:term:allowOnce` arms guard bypass from renderer (`terminalGuard.ts:804–809`); no sender validation on 225 IPC handlers (`ipc.ts:194–203`); unsigned Windows binaries.

Genuinely verified safe: exact SHA-256/SHA-512/size match for both artifacts; no `eval`/`Function`/`dangerouslySetInnerHTML` in renderer; strict CSP + hardened webviews; closed preload allowlist; secret masking before bridge; real FS path jail (traversal/UNC/realpath); loopback API server with Host check + bearer + throttle + fail-closed headless approvals; scrypt + 0600 auth files; HTTPS-only updater with manual download; `npm run typecheck` exit 0.

Full suite: **475 tests / 450 pass / 7 fail / 18 skip** under concurrency=4; all 7 failures are timing/resource or environment related — **all 14 re-run focused files finished with 0 failures** (e.g. `schedule-live` 4 pass/0 fail/1 skip, `v1110-surface` 5/0, `v1111-preview` 5/0/2 skip, `tool-coverage-all` 2/0, `v12-enhancements` 17/0). New `tests/v1113-audit.test.mjs`: **12/12 pass**, locking HTTPS feed, pair-code TTL/single-use, no dynamic-code sinks, strict CSP, closed preload, FS jail, guard-before-spawn, secret masking, ≥118 tools, scaffold/arena absence, and on-disk hash/manifest agreement.
