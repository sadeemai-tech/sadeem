# v11.38 — المكتبة "فارغة فعليًا" / The Library Is *Actually* Empty

**الحكم الصريح (Blunt verdict — Arabic):** لا. حتى بعد إصلاح v11.36، المكتبة كانت **لا تزال تبدو فارغة** في الحالات الحقيقية التي يستخدمها المؤسس. سبب ذلك ليس "الصور غير موجودة" بل أن فحص v11.36 كان يرى **جزءًا فقط** من الأقراص: كان يعتمد حصرًا على `settings.recentPaths` وقائمة مجلدات ثابتة (`downloads/assets/images/...` بعمق 1). أي تنزيل كُتب في مساحة العمل النشطة قبل حفظ `settings.json`، أو في `public/` أو `static/data/nested/` أو أي مجلد خارج تلك القائمة، كان **غير مرئي تمامًا**. وفوق ذلك، البطاقات لم تكن تعرض أي صورة مصغّرة، وثلاثة أنواع (مستند/تصدير/ملف) كانت تستخدم الأيقونة نفسها — فحتى المكتبة الممتلئة تبدو "ما فيها إشي". بعد هذا الإصلاح: المكتبة تعرض القطع الأثرية الحقيقية من **كل** الآبار عند أول فتح، بصور رمزية مختلفة واضحة لكل نوع، وحالة فراغ صادقة فقط عند الفراغ الحقيقي. لم أشغّل الواجهة المعبّأة يدويًا — التحقق كان باختبارات قرص حقيقية + تصيير SSR (انظر §3).

**Blunt verdict (English):** No — even after D7's v11.36 "fix", the library **still looked empty** in the founder's real conditions. The reason is not missing files: the v11.36 rescan only discovered workspaces from `settings.recentPaths` and only scanned a **fixed subdir allowlist** at depth 1. A download written to the *active* workspace before `settings.json` was persisted, or into `public/`, `static/data/nested/`, or any folder outside that allowlist, was **never seen**. On top of that, no thumbnails were rendered at all and three of five kinds shared the same `FileText` icon — so even a populated gallery read as "nothing in it". After this fix the library lists real artifacts from **every** well on first open, shows a distinct CSP-safe glyph per kind, and only claims "empty" when it truly is. I did not click through the packaged GUI manually — verification was real-disk tests + SSR render (see §3).

---

## 1. لماذا كانت فارغة فعليًا؟ / Why it was really empty (exact file:line)

| # | السبب الجذري / Root cause | الموقع القديم / Old location | الحكم |
|---|---|---|---|
| 1 | اكتشاف مساحات العمل كان من `settings.recentPaths` **فقط**. مساحة العمل المثبّتة عبر `kdx:workspace:set` (أو المفتوحة قبل حفظ الإعدادات) لم تُفحص أبدًا. | `electron/services/libraryService.ts:299-316` (v11.36 `workspaceRoots`) | confirmed |
| 2 | كل مساحة عمل كانت تُفحص عبر قائمة مجلدات ثابتة بعمق 1. تنزيل إلى `public/` أو `static/data/nested/` أو جذر غير مدرج ⇒ غير مرئي. | `libraryService.ts:51` (`SCAN_SUBDIRS`), `:391-396` (v11.36 wells) | confirmed |
| 3 | مجلد التنزيلات كان يُقبل فقط إن كان اسمه حرفيًا `downloads`/`download`. مجلد OneDrive/مُعاد توجيهه يُستبعد. | `libraryService.ts:384` (v11.36 regex) | confirmed |
| 4 | لا توجد صور مصغّرة إطلاقًا، و `document`/`export`/`file` تشترك كلها في `FileText`. البطاقات تبدو متشابهة/فارغة. | `src/components/panels/LibraryPanel.tsx:43-48` (v11.36 `kindIcon`) | confirmed |
| 5 | التحديث كان عند التحميل والـ `tool_result` فقط. اللوحة تُركّب على تبويب Wiki أحيانًا (`registry.tsx:115-116`)؛ العودة إلى Files لا تُحدّث القائمة. | `LibraryPanel.tsx:209-236` (v11.36 effects) | confirmed |
| 6 | تعذّر الفحص كان يُبتلع بصمت (`catch {}`) ⇒ «فارغ» بدل «فشل فحص». | `libraryService.ts:422-424` (v11.36) | confirmed |

> **ما لم يكن سببًا / Not the cause:** ملف `dist-electron/electron/services/libraryService.js` ما زال نسخة v10.2 قديمة، لكن وقت التشغيل يستخدم `dist-electron/electron/main.js` المُجمَّع (يحتوي فحص v11.36). أي أن الملف القديم مضلّل للقراءة فقط — انظر التسليم 1 أدناه لإعادة البناء بعد تعديلاتي.

---

## 2. ما أصلحناه الآن / What I fixed (v11.38)

### `electron/services/libraryService.ts`
- `workspaceRoots():325` — يجمع الآن: `settings.recentPaths` + **جذر confinement النشط** من `fsService.listAllowedRoots()` (`:345-346`) + تلميح `SURNIA_WORKSPACES`. مساحة العمل النشطة تُكتشف حتى لو لم تُحفظ الإعدادات بعد.
- `USERDATA_WELLS:61`, `WORKSPACE_SCAN_DEPTH=4:74` — فحص **الشجرة كاملة** لكل مساحة عمل (`:445-447`) بدل قائمة المجلدات الثابتة. `public/`, `static/**`, `.surnia/prints/` إلخ تصبح مرئية. `.surnia` لم يعد مستبعدًا (كان `:52` في v11.36).
- `scanArtifactWells():417` — يقبل مسار التنزيلات من `app.getPath('downloads')` **أو** `SURNIA_DOWNLOADS_DIR` (`:439`) كلما كان مجلدًا حقيقيًا، ويرفض مجلد temp العام فقط (`:440`). يحفظ الحدود/الأمان: عمق محدود، بلا روابط رمزية، تخطي الأسرار، سقف 600/جذر.
- `libraryScanHealth():98` + `lastScanHealth` — نتيجة الفحص صريحة `{ok, error, wells, found}`؛ تعذّر الفحص لم يعد "فراغًا صادقًا" (`:469-480`).
- `listLibraryItems():469`, `forgetLibraryItem():502`, `clearLibrary():520` — دمج السجل مع حقيقة القرص، مقبرة المسارات، وإزالة حقيقية لعناصر `scan_…` (بدون حذف الملف).

### `src/components/panels/LibraryPanel.tsx`
- `kindIcon():48` — أيقونة **مختلفة** لكل نوع (`Image`, `FileSpreadsheet`, `Download`, `Share2`, `FolderOpen`).
- `KindThumb():63-92` — مقاس 44×44، SVG مضمّن (لا `<img src="file:…">` — CSP يمنع `file:`). وسم `data-kind` + `data-library-kind` لكل بطاقة.
- `:295` — إعادة فحص عند كل فتح لتبويب **Files** (لا فقط عند التركيب).
- `:500` — `opacity:1` مضمّن على البطاقة حتى تظهر لو لم يعمل تأثير CSS (تبويب مخفي / تقليل حركة / تصيير ثابت).
- `libraryLoadError():201` — رسائل **مختلفة** لجسر غير جاهز / ردّ غير متوقع / فشل عام، عربية أو إنجليزية في السلسلة الواحدة.

### `electron/ipc.ts` (معالجات `kdx:library:*` فقط)
- `:839-875` — أخطاء مُسمّاة لكل عملية (`kdx:library:list/forget/clear/open failed: …`) بدل الابتلاع، وقناة `kdx:library:health` جديدة (`:849`) لقراءة نتيجة فحص القرص.

### `tests/v1138-library.test.mjs`
- T1: بذر قطع أثرية في **كل** بئر (userData/artifacts, userData/exports, تنزيلات بمسار OneDrive لا يُسمى `downloads`, جذر مساحة العمل, `downloads/`, `public/`, `static/data/nested/`, `assets/`) — وكلها تظهر في **أول** استدعاء `listLibraryItems`، مع الجذر النشط كإشارة وحيدة (لا `settings.json`).
- T2: كل نوع له رمز مختلف في DOM، ولا يوجد `src="file:"`.
- T3: `forget` يزيل عنصر `scan_…` ويصمد أمام إعادة الفحص.
- T4: `clear` يفرغ المكتبة، وحالة الفراغ تظهر بدون شريط خطأ.
- T5: أخطاء التحميل مختلفة وصادقة (EN+AR).

---

## 3. التحقق / Verification (actual output)

```
npx tsc --noEmit                                   ✅ exit 0
npx tsc -p tsconfig.node.json --noEmit             ✅ exit 0
node --test --test-force-exit \
  tests/v1138-library.test.mjs \
  tests/v1136-library-wiki.test.mjs \
  tests/v1131-full-smoke.test.mjs                  ✅ 97/97 (5 + 10 + 82), 0 fail
```

> ملاحظة: أثناء التحقق ظهرت أخطاء `TS2307` عابرة في `src/components/SignaturePanel.tsx` من تعديل متزامن لعميل آخر؛ اختفت عند إعادة التشغيل. لا علاقة لها بملفاتي.

---

## 4. تسليمات للأب / Parent handoffs (files I may not edit)

1. **إعادة البناء إلزامية / REBUILD REQUIRED:** عدّلت TypeScript فقط. حتى يُعاد تشغيل `npm run build:electron`، التطبيق المعبّأ (`dist-electron/electron/main.js`) لا يحتوي على إصلاح v11.38. **هذا هو السبب الأرجح أن يرى المؤسس "فارغًا" بعد هذا التقرير إن شغّل النسخة القديمة.** (ملف `dist-electron/electron/services/libraryService.js` لا يزال v10.2؛ احذفه أو أعد توليده لتجنّب الالتباس.)
2. **`electron/agent/tools.ts:9906` (`browserDownload`)** — ما زال لا يستدعي `noteLibraryItem`. الفحص يجعل الملف مرئيًا، لكن الخطاف يضيف `sessionId`/`origin` موثوقين. أضف خطافًا بعد الكتابة الناجحة.
3. **`electron/preload.ts:249-252` + `src/lib/api.ts:595-598`** — أضف `libraryThumbnail(id)` (IPC ⇒ data-URL) و`libraryHealth()` إلى الجسر والأنواع إن أُريدت صور مصغّرة **حقيقية** للصور بدل الرموز. CSP يسمح `data:` لا `file:`؛ المعالج `kdx:library:health` جاهز في `ipc.ts:849` لكن الواجهة لا تستطيع استدعاءه بدون تعديل الجسر.
4. **`src/components/panels/library-art.css`** — أضف قاعدة `.lib-thumb` (حدود/خلفية/تخطيط) إن أُريد مظهر أنظف؛ التنسيق المضمن في `KindThumb` يضمن الرؤية بدونها.
5. **`src/i18n.ts`** — مفاتيح `lib.loadError.bridge` / `lib.loadError.reply` اختياريًا؛ الواجهة تمرّر بدائل ثنائية اللغة حقيقية الآن.
6. **`index.html` / `electron/main.ts:183` CSP** — `img-src 'self' surnia: data: blob: https:` (لا `file:`). لا تضف `file:` أبدًا؛ استخدم data-URL عبر التسليم 3.

---

**الخلاصة / Bottom line:** المكتبة لم تعد فارغة في أي بئر حقيقي اختبرناه — لكن **إعادة البناء (rebuild)** يجب أن تحدث قبل أن يراها المؤسس في النسخة المعبّأة. / The library is no longer empty in any real well we tested — **but a rebuild must happen** before the founder sees it in the packaged app.
