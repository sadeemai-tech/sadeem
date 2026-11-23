# PREVIEW-PRO v11.38 — الحكم الصريح / Blunt verdict

**التاريخ / Date:** 2026-11-22
**النطاق / Scope:** auto-preview + professional preview panel + honest failure.

---

## 1. الحكم / Verdict

**EN — Does it auto-preview now? PARTLY YES, with one hard blocker outside my files.**

- **YES:** the *tool path* is now fully automatic and honest. The moment the model calls
  `preview_open` with no arguments (or `preview {action:"static"}` / `preview {action:"dev_start"}`),
  the app finds the real web entry, **starts a real loopback server**, makes a **real HTTP GET**,
  requires **HTTP 200**, and emits `preview_open` **carrying the real URL + a hint**. The panel
  adopts that URL, opens itself, switches to the Preview tab and **focuses the guest webview** —
  the founder does not have to ask and does not have to click.
- **YES — no fake "ready":** a dead URL, a server whose entry does not answer 200, or a workspace
  with no web entry returns `ok:false` and emits **no** URL-bearing event and **no** ready event.

**NO — not 100 % "zero-touch after every build" yet.** The engine's own completion hook still
emits `preview_open` with only a `previewHint` (no URL) and the renderer **store** hard-gates it
behind `previewUserClosed`. The flag is reset at run start (`store.ts:2617`) but flipped back to
`true` by ordinary UI navigation **during** the run (`setPreviewOpen(false)` in `Rail.tsx`,
`RightDock.tsx`, `StatusBar.tsx`, `TitleBar.tsx`, `CommandPalette.tsx`, `App.tsx`). When that
happens, the engine's completion event is ignored at `store.ts:4977` and nothing opens until the
founder asks. **This is a handoff — see §5.**

**AR — هل صار المعاينة تفتح لحالها؟ نصف نعم، وفيه عائق واحد برّه ملفاتي.**

- **نعم:** مسار الأدوات صار تلقائي وصادق فعليًا. أول ما النموذج يستدعي `preview_open` بدون
  وسائط (أو `preview {action:"static"}`)، التطبيق يلاقي صفحة الويب الحقيقية، **يشغّل سيرفر
  loopback حقيقي**، يعمل **طلب HTTP حقيقي**، يشترط **HTTP 200**، ويطلق حدث `preview_open`
  **فيه الرابط الحقيقي**. اللوحة تستوعب الرابط، تفتح لحالها، تتحول لتبويب المعاينة و**تعطي
  التركيز للصفحة** — المؤسس ما يحتاج يطلب ولا يضغط.
- **نعم — ما في "جاهز" مزيف:** رابط ميت، أو سيرفر ما ردّ 200، أو مساحة عمل بدون صفحة ويب،
  كلها ترجع `ok:false` وما يطلق أي حدث فيه رابط ولا حدث جاهزية.
- **لا — مو ١٠٠٪ "بدون لمسة بعد كل بناء" لسه.** خطاف نهاية البناء في الـ engine يطلق
  `preview_open` فيه `previewHint` بس (بدون رابط)، ومتجر الـ renderer يحجزه خلف
  `previewUserClosed`. هذا العلم يصير `true` من تنقلات عادية في الواجهة، وما يُعاد ضبطه بعد
  بناء ناجح. النتيجة: بعد بعض الضغطات يتم تجاهل الحدث ولا شي يفتح لحد ما المؤسس يطلب.
  **هذا تسليم لصاحب الملف — انظر §5.**

---

## 2. ما تغيّر فعليًا / What actually changed (exact file:line)

### `electron/services/previewService.ts`
- `:914` — قسم **AUTO-PREVIEW v11.38** (ملخص العقد: entry → سيرفر حقيقي → HTTP 200 → رابط).
- `:935` — `verifyPreviewUrl(url, timeout, require200)` — تحقّق HTTP حقيقي، ما يكذب أبدًا.
- `:1024` — `findPreviewEntry(ws)` — يجد `index.html` (جذر / dist / build / out / حتى عمق ٣)
  أو سكربت `dev` أو Python/Go؛ يرجع `null` بصدق لمساحة Q&A.
- `:1087` — `autoPreview(ws)` — ينشئ السيرفر الحقيقي، يتحقّق منه، ويرجع `{ok, url, verified,
  status, kind, hint...}`؛ لو ما ردّ 200 يوقف السيرفر ويرجع `ok:false`.

### `electron/agent/tools.ts` — **مشفّذات المعاينة فقط** (لا doc builders)
- `:6475` — `emitVerifiedPreviewOpen()` — حدث `preview_open` يحمل رابطًا حقيقيًا + hint.
- `:6483` — `startDevPreview()` — ينتظر رابطًا حقيقيًا ثم يتحقّق منه عبر HTTP قبل أي ادّعاء.
- `:6530` — `previewOpenTool()` — بدون وسائط ⇒ `autoPreview()`؛ بالمسار ⇒ سيرفر + تحقّق
  200؛ بالرابط ⇒ تحقّق قبل الادّعاء. أي فشل = `ok:false` بدون رابط مزيف.
- `:6715` — `preview {action:'static'}` — تحقّق 200 + hint قبل إطلاق الحدث.
- `:6720` — `case 'auto'` كاسم بديل دفاعي.

### `src/components/PreviewArea.tsx` — اللوحة المهنية (الاسم الصحيح، ما فيه PreviewPanel)
- `:325` — `focusPreview()` — يجلب اللوحة للأمام ويعطي التركيز للـ webview فور وصول
  `preview_open`.
- `:425` — مستمع `onPreviewEvent`: أحداث `ready` الحقيقية من السيرفر تُستوعَب كرابط فعلي
  (بدل ما تتجاهل)، مع فتح اللوحة والتركيز.
- `:620` — حارس ضد تشغيل سيرفر ثاني فوق رابط حقيقي وصل أصلًا.
- `:758` — حاوية اللوحة قابلة للتركيز (`tabIndex=-1`).
- **موجود أصلًا:** شريط رابط حقيقي، إعادة تحميل، فتح في متصفح خارجي، أحجام متجاوبة
  (كامل / لوحي 820 / جوال 400)، بطاقة خطأ صادقة — ما اخترعت واجهة جديدة.

### `tests/v1138-preview.test.mjs`
يكتب `index.html` حقيقي → `preview_open {}` عبر `executeTool` الحقيقي → سيرفر على منفذ
حقيقي → الرابط الحقيقي يردّ **200** بـ `fetch` حقيقي → حدث `preview_open` فيه الرابط +
hint → حدث `ready` حقيقي → مساحة فارغة تفشل بصدق بدون أي رابط/جاهزية مزيفين.

---

## 3. التحقق / Verification (actual runs)

| Command | Result |
|---|---|
| `npx tsc -p tsconfig.node.json --noEmit` | ✅ pass |
| `npx tsc --noEmit` | ⚠️ 4 **pre-existing** errors in `GitPanel.tsx` / `api.ts` — see §5 (my files: 0 errors) |
| `node --test --test-force-exit --test-concurrency=4 tests/v1138-preview.test.mjs tests/v1131-preview.test.mjs tests/v1134-internet.test.mjs` | ✅ **36/36 pass** |
| `node --test --test-force-exit --test-concurrency=4 tests/v1111-preview.test.mjs tests/v1111-preview-universal.test.mjs tests/v1126-preview-ui.test.mjs` | ✅ **20 pass, 1 skip (go toolchain), 0 fail** |

> ملاحظة: `tests/v1134-internet.test.mjs` كان فيه تأكيد قديم يتوقّع الجواب القديم
> «No live preview is running yet — اطلب من المستخدم». حدّثته (سطر ~412) ليؤكد السلوك
> الجديد الصحيح + حالة الفشل الصادق. هذا تغيير اختبار فقط، ما مسّ منطق الإنتاج خارج نطاقي.

---

## 4. لماذا كان يفشل abusive / Root cause found

1. `preview_open` القديم بدون وسائط كان يكتفي بإطلاق حدث **بدون رابط** ويقول «اطلب من المستخدم»
   — بالضبط شكوى المؤسس. صار يشغّل سيرفر حقيقي ويعطي الرابط.
2. اللوحة كانت تتجاهل أحداث `ready` القادمة من السيرفر (`onPreviewEvent` تعامل `watch` و`log`
   فقط) — فحتى لما السيرفر يشتغل، الواجهة تضل «IDLE». صارت تستوعب الرابط.
3. **خارج نطاقي:** `previewUserClosed` في `src/store.ts:1544` يُعاد ضبطه عند بدء الـ run
   (`:2617`) لكن أي `setPreviewOpen(false)` من تنقل الواجهة **أثناء** الـ run يعيده لـ `true`،
   فيُسكَت حدث الـ engine النهائي (`store.ts:4977`).

---

## 5. تسليمات / Handoffs (للوالد/أصحاب الملفات)

1. **[P0 — auto-preview بعد كل بناء بدون استدعاء أداة] `src/store.ts`:**
   - `:1542` `enginePreviewRequested` و`:1544` `previewUserClosed` يحجزان `rrFlushAutoPreview()`
     (`:1833`) وحدث `preview_open` (`:4977`). `setPreviewOpen(false)` في `Rail.tsx:205`,
     `RightDock.tsx:31/35`, `StatusBar.tsx:113`, `TitleBar.tsx:87`, `CommandPalette.tsx:209`,
     `App.tsx:154` يضبط `previewUserClosed = true` أثناء الـ run. (العلم يُعاد ضبطه عند بدء
     run جديد في `:2617`، لكن الضرر يقع بين بدء الـ run وحدث الإكمال.) **المطلوب:** لا تعتبر
     إغلاق اللوحة من تنقل الواجهة «رفضًا صريحًا من المستخدم»، واسمح للحدث الحامل `url` حقيقي
     بالمرور دائمًا. (هذا هو السبب المتبقي لـ «ما بعاين لي»).
2. **[P1 — جعل النموذج يطلب المعاينة تلقائيًا] `electron/agent/tool-defs.ts:628` + `prompts.ts`:**
   وصف أداة `preview` يقول «Call dev_start/static after building» لكن ما يذكر `preview_open {}`
   كخيار تلقائي. أضف سطرًا: «بعد أي بناء ويب، استدعِ `preview_open` بدون وسائط فورًا لعرض
   النتيجة — لا تنتظر طلب المستخدم.» (هذا يكمّل المسار حتى لو تأخر إصلاح الـ store).
3. **[P1 — ت_compile] `shared/types.ts` + `src/components/panels/GitPanel.tsx:11` + `src/lib/api.ts:35`:**
   `GitBranchInfo` / `GitIdentityInfo` معرّفة في `electron/services/gitService.ts:320/385` بس
   غير مُصدَّرة من `shared/types.ts` ⇒ 4 أخطاء `tsc --noEmit` **سابقة لتغييراتي**. صاحب ملف
   git/shared يصلحها (تصدير الأنواع أو تحريك الاستيراد).
4. **[info] `electron/agent/tool-defs.ts:635`:** `action` ما زال enum بدون `'auto'`؛ أضفته كحالة
   دفاعية في المنفّذ (`tools.ts:6720`)، لكن الاستدعاء الموثوق هو `preview_open {}`.

---

## 6. الخلاصة / Bottom line

> **المعاينة الاحترافية صارت حقيقية ومُتحقَّق منها على مستوى الأدوات واللوحة:
> سيرفر حقيقي + 200 حقيقي + رابط حقيقي + تركيز تلقائي، بدون كذب.**
> **تبقّى إصلاح واحد في `src/store.ts` (previewUserClosed) لضمان «بدون ما المؤسس يطلب»
> بعد كل بناء — مُسلَّم أعلاه برقم السطر.**

*No fabricated ready. No "I can't preview". The page that was just written is the page that opens.*
