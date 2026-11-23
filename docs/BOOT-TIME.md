# تقرير زمن إقلاع التطبيق / Application Boot-Time Diagnosis

> diagnosis-only report — لا تعديلات على الكود المصدري. / No source files were edited.
> Date: 2026-11-19 · Build: SADEEM v11.12.0 · Evidence window: 2026-11-12 → 2026-11-19

---

## 0. الخلاصة / TL;DR

**عربي:** التطبيق ليس "بطيئًا بشكل كارثي"، لكنه ليس سريعًا أيضًا. من 49 إقلاعًا حقيقيًا خلال 7 أيام، الزمن من أول سطر تسجيل في العملية الرئيسية (`boot`) حتى اكتمال تحميل الصفحة (`did-finish-load`) **الوسيط 3.15 ثانية** (الربع الأدنى 1.97 ث، الربع الأعلى 4.47 ث، الأقل 0.85 ث، الأعلى 6.38 ث). نافذة التطبيق تظهر (`win.show()`) بعد هذا بقليل (عند أول إطار مرسوم). **المسبّب الأساسي ليس العملية الرئيسية**: أعمال التسجيل/التهيئة المتزامنة في `main.ts` مقيسة بـ 4–6 مللي ثانية لكل مرحلة، أي ~100 مللي ثانية إجمالًا. الزمن الضائع الحقيقي هو في **محرك Chromium + حزمة الواجهة (5.6 ميجابايت JS) + تحميل React/Monaco تحت عرض برمجي (GPU معطّل)**، مع تباين كبير بسبب مكافحة الفيروسات/القرص (نوبات 6.3 ث).

**English:** The app is not catastrophically slow, but it is not fast either. Across 49 real launches over 7 days, the span from the main-process `boot` log line to `did-finish-load` is **median 3.15 s** (p25 1.97 s, p75 4.47 s, min 0.85 s, max 6.38 s); the window is shown shortly after that (first painted frame). **The main process is not the bottleneck**: synchronous registration/init stages are measured at 4–6 ms each (~100 ms total). The dominant cost is **Chromium startup + the 5.6 MB renderer bundle + React/Monaco mount under software rendering**, with large variance from disk/AV. SQLite, MCP probes, plugin registration, and the auto-update check are **not** boot blockers.

---

## 1. مسار الإقلاع / Boot path (file:line)

### 1.1 قبل `app.whenReady()` (وقت تحميل الوحدة / module-evaluation)

| ما يحدث | الموقع | طبيعة العمل |
|---|---|---|
| `pinStableUserData()` — `mkdirSync`, `existsSync`, وربما `cpSync` كامل مجلد الهوية القديمة (أول تشغيل بعد تغيير العلامة فقط) | `electron/main.ts:47-75` | متزامن، نادر |
| `initLog(userData)` | `electron/main.ts:76` | متزامن، خفيف |
| `protocol.registerSchemesAsPrivileged` | `electron/main.ts:91-96` | متزامن، خفيف |
| `rendererScriptSrc()` يقرأ `csp-hashes.json` / `index.html` | `electron/main.ts:141-171` | `readFileSync` متزامن |
| `app.disableHardwareAcceleration()` (افتراضيًا؛ GPU معطّل لأسباب استقرار) | `electron/main.ts:247-249` | **يؤثر على سرعة الرسم لاحقًا** |
| استيراد `./ipc` ⇒ استيراد ~40 خدمة + استيراد side-effect لـ `pluginService` | `electron/main.ts:11`, `electron/ipc.ts:8-73`, `:26` | تحميل وحدة ضخمة (~2.67 MB `main.js`) |

### 1.2 داخل `app.whenReady()` — كل شيء قبل `win.show()`

`win.show()` يحدث في `ready-to-show` عند `electron/main.ts:452-455` (أو قسرًا عبر watchdog بعد 20 ث عند `:456-461`). `createWindow()` itself is the **last** call in the chain (`:912`) — so everything below runs **before** the window even exists:

| # | العمل | السطر | متزامن؟ | تفاصيل |
|---|---|---|---|---|
| 1 | `loadFxMarker()` | `:846` | نعم، `existsSync` | ضئيل |
| 2 | `serveRenderer()` | `:847` | نعم | تسجيل معالج البروتوكول — **ضروري قبل التحميل** |
| 3 | `hardenSessionPerms()` ×2 | `:848-849` | نعم | **ضروري قبل التحميل** (أمان) |
| 4 | `addAllowedRoot(userData)` | `:853` | نعم | **ضروري** (sandbox) |
| 5 | سطر السجل `boot` | `:854` | — | نقطة القياس التي استخدمناها |
| 6 | `setAuditSink` / `setDeviceImpl` / `setProcessLogsDir` | `:856-874` | نعم | تعيين مراجع فقط |
| 7 | `registerIpc()` | `:875` | نعم | `getSettings()` (`ipc.ts:353`) + ~100 `ipcMain.handle` + `initDNA()`/`initPlaybookIpc()`/`initSubagentsIpc()` (`ipc.ts:359-362`)؛ معالجات الإضافات تُسجّل تلقائيًا (`pluginService.ts:355-367`) |
| 8 | `scheduleAutoCheck()` | `:876` | لا | مؤقت 10 دقائق بـ `.unref()` — **مؤجّل أصلًا** |
| 9 | `initApiServer()` | `:877` | جزئيًا | `getSettings()`، كتابة التوكن إن كان مفعّلًا، ثم `startServer()` غير متزامن (`apiServerService.ts:352-374`) |
| 10 | `initRemoteServer()` | `:878` | جزئيًا | `getSettings()`، استماع غير متزامن إن كان مفعّلًا (`remoteService.ts:718-729`) |
| 11 | `initScheduleService()` | `:880-889` | نعم | `loadJobs()` (قراءة ملف)، `setInterval` 30 ث، `startWebhookListener()` يستمع على المنفذ 7681 (`scheduleService.ts:688-706`, `:329-370`) |
| 12 | `initTray()` | `:890` | نعم | `existsSync` ×3 + `nativeImage` + `new Tray()` (`trayService.ts:55-92`) |
| 13 | `registerAgentIpc()` | `:891` | نعم | `initFlows()` + جسر remote + handlers (`agent/register.ts:65-96`) |
| 14 | `registerWindowIpc()` | `:892` | نعم | handlers نافذة/حوار |
| 15 | `globalShortcut.register('Control+Alt+K')` | `:894-909` | نعم | تسجيل اختصار أصيل |
| 16 | `registerMcpIpc()` | `:910` | نعم | معالج `kdx:mcp:test` واحد (لا فحص شبكة) |
| 17 | `Menu.setApplicationMenu(buildMenu())` | `:911` | نعم | قائمة أصلية |
| 18 | `createWindow()` | `:912` | نعم | `loadWindowState()` (`windowStateService.ts:35-69`: `readFileSync` + `screen.getPrimaryDisplay()`)، `new BrowserWindow({show:false})` (`:299-328`)، `fs.existsSync(index.html)` (`:375`)، `loadURL('surnia://bundle/...')` (`:398`)، ثم `ready-to-show ⇒ show()` (`:452-455`) |

**النتيجة / Consequence:** كل أعمال الخدمات الـ 18 أعلاه تقع **قبل** أن تبدأ النافذة بالتحميل، وبالتالي قبل ظهورها. لا يوجد أي تداخل (overlap) بين تهيئة العملية الرئيسية وتحميل الواجهة.

---

## 2. جرد العمل المتزامن / Blocking work inventory

| البند | الحكم | الدليل |
|---|---|---|
| **قراءات الإعدادات (settings reads)** | متزامنة، صغيرة، **مكررة ≥4 مرات** | `getSettings()` = `readFileSync` + `JSON.parse` + `migrateSettings` + فك تشفير `safeStorage` لكل مزوّد (`storeService.ts:162-221`). تُستدعى من `ipc.ts:353`, `updateService.ts:164`, `apiServerService` (`apiCfg`), `remoteService` (`cfg`) |
| **SQLite init** | **غير موجود عند الإقلاع — ليس سببًا** | `node:sqlite` يُطلب ديناميكيًا داخل أدوات الوكيل فقط عند استخدامها: `agent/tools.ts:8472`, `:10504` |
| **تسجيل الإضافات (plugin registration)** | **ليس سببًا** | `ipc.ts:26` يستورد `pluginService` كـ side-effect؛ `pluginService.ts:355-367` يسجّل 8 معالجات `ipcMain.handle` فقط، دون مسح قرص عند الإقلاع |
| **فحوص MCP registry** | **ليس سببًا** | `mcpRegistryService.ts:719` (`fetch`) داخل دالة بحث تُستدعى من IPC فقط؛ `main.ts:686` (`kdx:mcp:test`) عند الطلب. لا فحص شبكة عند الإقلاع |
| **فحص التحديث التلقائي** | **ليس سببًا — مؤجّل أصلًا** | `updateService.ts:163-172`: `setTimeout(..., 10*60*1000)` مع `.unref()`، و`electron-updater` يُستورد كسولًا عند الفحص فقط (`:71-76`) |
| **تهيئة الخدمات (service inits)** | متزامنة لكن صغيرة (~100 مللي ث إجمالًا مقيسة) | انظر القياسات أدناه؛ كل مرحلة تسجيل ~4–6 مللي ث |

---

## 3. القياس / Measurement evidence

### 3.1 إقلاعات v11.12 الحقيقية

المصدر: `%APPDATA%\SADEEM\logs\main.log` (629 سطرًا). حُلّلت كل جلسة من `[boot] starting SADEEM v11.12.0` إلى `[load] did-finish-load`. استُبعدت جلستان كانتا مفتوحتين لساعات (1,489 ث و3,297 ث) — ليست زمن إقلاع.

```
إقلاعات حقيقية: 49   boot -> did-finish-load
min 0.85s | p25 1.97s | median 3.15s | avg 3.36s | p75 4.47s | max 6.38s
<=2s: 13 جلسات | 2–4s: 21 | 4–7s: 15
```

أمثلة (من نفس البناء):

| التاريخ (UTC) | proto→boot | boot→did-finish-load |
|---|---|---|
| 2026-11-14 16:58 | 8 ms | **0.85 s** |
| 2026-11-19 09:48 | 10 ms | 2.02 s |
| 2026-11-19 17:42 | 11 ms | 4.22 s |
| 2026-11-19 12:12 | 8 ms | **6.38 s** |
| 2026-11-19 13:13 | 2,404 ms* | 4.42 s (6.83 s من proto) |

\* فجوة `proto→boot` (نادرًا 0.5–2.4 ث) هي زمن بين `serveRenderer()` وسطر `boot` (تصلب الجلسة + `addAllowedRoot`) — تشير إلى ضغط النظام/مكافحة الفيروسات، لا إلى عمل مكثف في الكود.

**تنبيه منهجي / Caveat:** البناء الحالي لا يسجّل `ready-to-show`، لذلك `did-finish-load` يُستخدم كبديل؛ العرض الفعلي يحدث بعده بزمن الرسم الأول (عادةً أجزاء من الثانية). لم أُجرِ إقلاعًا جديدًا مُتحكمًا به لأن 4 عمليات `SADEEM` كانت تعمل بالفعل (قفل المثيل الوحيد `main.ts:757`) والمهمة تشخيصية فقط.

### 3.2 تفكيك المراحل من بناء سابق مُرصّد (سجلات `stage:`، نوفمبر 4)

سجلات قديمة تحمل نفس سلسلة المراحل تعطي تفكيكًا أدق (9 جلسات):

| المرحلة | الوسيط |
|---|---|
| `main-start` → `app-ready` | 108 ms |
| `session-hardened` | 13 ms |
| `ipc-registered` | 6 ms |
| `agent-ipc-registered` | 5 ms |
| `window-ipc-registered` | 5 ms |
| `mcp-ipc-registered` | 5 ms |
| `menu-created` | 6 ms |
| `window-created` | 48 ms |
| `window-created` → `ready-to-show` | 507 ms |

> هذه المراحل من بناء أقدم (هوية `Surnia`)، لكنها تُثبت أن **تسجيل المعالجات رخيص جدًا**، وأن الزمن الكبير يقع في بدء العملية/المحرك وفي تحميل الواجهة.

### 3.3 أحجام الحزمة / Bundle weights

```
dist/assets/index-*.js       5.63 MB   ← حزمة الدخول (Monaco/React/Lottie…)
dist/assets/ts.worker-*.js   6.02 MB
dist/assets/css.worker-*.js  1.01 MB
dist/assets/index-*.css      0.69 MB
dist-electron/electron/main.js 2.67 MB
إجمالي dist                  17.3 MB  (asar، compression: normal — electron-builder.yml:12-13)
```

مع `disableHardwareAcceleration()` (`main.ts:247-249`) يُرسم كل هذا على المعالج (SwiftShader)، ما يفسّر حساسية الزمن لحمل الجهاز.

### 3.4 ملاحظات جانبية (ليست سبب الإقلاع لكنها تؤثر على "الإحساس بالبطء")

- كل جلسات v11.12 تعمل بـ `?fx=off`: ملف الحاجز `surnia-fx-off` (`main.ts:265-289`, `:846`) مفعّل، أي أن التأثيرات البصرية معطّلة بعد سقوط سابق للـ renderer.
- بعد 17:47 تظهر أخطاء `surface-crash[stage-skills]` / React #300 في السجل — مشكلة استقرار في الواجهة (منفصلة عن زمن الإقلاع) قد تجعل التطبيق يبدو "معلّقًا" بعد الفتح.
- سجلات قديمة كانت تُظهر خطأ CSP للسكربت المضمّن في `index.html:6`؛ ملف `dist/csp-hashes.json` يحوي التجزئة المطلوبة فعلًا، والجلسات الأخيرة (17:42) لم تُسجّل الخطأ — يُرجّح أنها مشكلة بناء قديم لم تعد قائمة.

---

## 4. الأسباب مرتبة + إصلاحات مقترحة (بدون تنفيذ) / Ranked causes & minimal fixes

| الرتبة | السبب | الأثر المقدَّر | الإصلاح المقترح (لم يُنفّذ) |
|---|---|---|---|
| **1** | تحميل حركة الواجهة: 5.6 MB JS + 6 MB ts.worker + Monaco/Lottie + React mount، تحت عرض برمجي | **~2–3 ث من أصل 3.15 ث** | تقسيم الحزمة (code-split): تحميل Monaco وworkers عند فتح المحرر فقط؛ تأجيل لوحات غير مرئية في الشاشة الأولى؛ تقليل حجم `index-*.js` |
| **2** | بدء Chromium + تقييم وحدة `main.js` (~2.67 MB، ~90 ملفًا) قبل `whenReady` | ~0.5–1.5 ث (غير مفكَّك في السجل الحالي) | إضافة سجلات مراحل (4 أسطر) عند `main-start`/`app-ready` لقياس دقيق؛ تحميل كسول للحزم الثقيلة غير المطلوبة عند الإقلاع |
| **3** | تباين القرص/مكافحة الفيروسات/حمل النظام (نوبات 6.3 ث، فجوات `proto→boot` حتى 2.4 ث) | حتى +3 ث | تقليل عمليات القرص المتزامنة عند الإقلاع (توحيد قراءة الإعدادات، تأجيل `loadJobs`)؛ لا يمكن إلغاؤه بالكامل في الكود |
| **4** | تهيئة الخدمات الـ 18 كلها قبل `createWindow()` | ~100–200 ms | نقل `createWindow()` إلى بداية السلسلة، وتأجيل الخدمات غير الضرورية للشاشة الأولى إلى ما بعد `win.show()` — انظر الجدول أدناه |
| **5** | قراءة `getSettings()` عدة مرات + فك تشفير `safeStorage` المتكرر | بضعة مللي ثانية | قراءة واحدة وتخزينها مؤقتًا وتمريرها للخدمات |

**مسببات مستبعدة / Non-causes:** SQLite، فحوص MCP، تسجيل الإضافات، فحص التحديث التلقائي — كلها إمّا عند الطلب أو مؤجّلة أصلًا.

---

## 5. قبل العرض أم بعده؟ / Before vs after `win.show()`

**يجب أن يبقى قبل العرض (مطلوب لتحميل صحيح / آمن):**
`pinStableUserData`، `initLog`، `registerSchemesAsPrivileged`، `disableHardwareAcceleration`، `serveRenderer` (`main.ts:847`)، `hardenSessionPerms` (`:848-849`)، `addAllowedRoot` (`:853`)، `loadWindowState` + `createWindow` (`:301`, `:912`)، `registerWindowIpc` (`:892`)، `registerMcpIpc` (`:910`).

**آمن تأجيله إلى بعد `win.show()` (أو `setImmediate` بعد `createWindow()`):**
- `initApiServer()` (`:877`) — listen غير متزامن أصلًا؛ لا داعي له قبل ظهور النافذة.
- `initRemoteServer()` (`:878`) — كذلك.
- `initScheduleService()` (`:880`) — `loadJobs()` + webhook؛ لا علاقة له بالشاشة الأولى.
- `initTray()` (`:890`) — عمل أصيل، لا حاجة له قبل العرض.
- `registerAgentIpc()` (`:891`) — الواجهة لا تستطيع إرسال طلب وكيل قبل أن تُركّب (mount).
- `globalShortcut.register()` (`:894-909`) — اختصار عالمي، مستقل تمامًا.
- `Menu.setApplicationMenu(buildMenu())` (`:911`) — قائمة أصلية، يمكن تأجيلها.
- `scheduleAutoCheck()` (`:876`) — **مؤجّل أصلًا** (10 دقائق، `.unref()`)؛ لا تغيير مطلوب.

> **تحذير / Caution:** تأجيل `registerIpc()` ككل ممكن تقنيًا (الواجهة لا ترسل IPC قبل الـ mount)، لكنه ذو قيمة ضئيلة (~6 ms مقيسة) ولا يبرّر المخاطرة. الإصلاح ذو الجدوى الحقيقية هو تقليص حزمة الواجهة (الرتبة 1)، ثم نقل `createWindow()` للأمام والخدمات للخلف (الرتبة 4) لكسب ~100–200 ms من "زمن حتى الظهور".

---

## 6. ما لم نفعله / Honesty statement

- لم يُعدّل أي ملف مصدر؛ هذا التقرير تشخيصي فقط (`docs/BOOT-TIME.md` هو الملف الوحيد المكتوب).
- لم يُجرَ إقلاع جديد مُوقَّت لأن التطبيق كان يعمل أصلًا (4 عمليات، قفل المثيل الوحيد) ولأن إضافة سجلات توقيت تتطلب تعديل الكود — وهو ممنوع في هذه المهمة.
- الأرقام مبنية على **49 إقلاعًا حقيقيًا** من سجلات الإصدار الحالي + تفكيك مراحل من بناء سابق مُرصّد. دقة القياس ±عشرات المللي ثانية، والفجوة بين `did-finish-load` وظهور النافذة الفعلي غير مقيسة في البناء الحالي.
- **الحكم الصادق:** الشكوى ("تأخر إطلاق التطبيق") مفهومة — 3 ثوانٍ وسطيًا مع نوبات 6 ث ملحوظة — لكن السبب ليس SQLite ولا MCP ولا التحديث التلقائي، بل حجم الواجهة وبدء المحرك. أسرع مكسب هو تقسيم حزمة `index-*.js`، وليس إعادة ترتيب `main.ts` (مكسبه ~0.1–0.2 ث فقط).
