# v11.36 — المكتبة وويكي المستودع / Library & Repo Wiki

**الحكم الصريح (Blunt verdict):** لا، الشكوى **لم تعد تتكرر** في الحالات التي اختبرناها على قرص حقيقي. التنزيلات التي تكتبها الأدوات في مساحة العمل (بما فيها `browser_download` للصور) تظهر الآن في المكتبة حتى لو لم تستدعِ أي خطاف تسجيل، وويكي المستودع يعرض مستندات المستودع الحقيقية (`README.md`, `docs/*.md`) حتى من غير مفتاح مزوّد. أي فشل يظهر رسالة واضحة — لا لوحة فارغة بلا سبب.
**No, the reported failure does not reproduce anymore** under real-disk conditions: net downloads land in the library even without a producer hook, and the wiki renders the repo's real Markdown docs even with no AI key. Every failure path shows an actionable message.

---

## 1. لماذا لم تعمل؟ / Why it failed

| # | السبب الجذري / Root cause | الموقع / Location |
|---|---|---|
| 1 | `browser_download` — وهي الأداة المستخدمة لتنزيل الصور من النت — تكتب الملف في مساحة العمل **دون** استدعاء `noteLibraryItem`. بقية الأدوات (`download_file`, `web_download`, `make_document`, `pdf_make`, office) تستدعي الخطاف. | `electron/agent/tools.ts:9246-9330` (لا خطاف) مقابل `:5338`, `:5511`, `:4519`, `:8700`, `:8948` |
| 2 | `listLibraryItems()` كان يفحص مجلدًا واحدًا فقط (`<userData>/artifacts`)، بينما التنزيلات تذهب إلى `<workspace>/downloads`, `assets`, جذر مساحة العمل، وإلى `userData/exports`. سجل `library.json` وحده لا يكفي إذا فشل الخطاف أو ضاعت كتابة السجل. | `electron/services/libraryService.ts` (النسخة القديمة `:242-283`) |
| 3 | اللوحة كانت تبلع أخطاء `libraryList()` وتحوّلها إلى قائمة فارغة — «فارغ» بدل «فشل القراءة». ولا يوجد تحديث بعد انتهاء الدورة، فالملفات المنتَجة أثناء فتح اللوحة لا تظهر. | `src/components/panels/LibraryPanel.tsx` (القديم `:169-180`) |
| 4 | «إزالة من المكتبة» على عنصر قادم من الفحص (`scan_…`) كانت تفشل بصمت: المعرّف غير موجود في السجل، ومع ذلك كانت اللوحة تُخبر المستخدم بالنجاح. | `electron/services/libraryService.ts:439` (قديم) + `LibraryPanel.tsx` (قديم `:212-224`) |
| 5 | الويكي يعتمد حصرًا على توليد نموذجي يتطلب مفتاح مزوّد؛ بدونه لا توجد صفحات إطلاقًا، فتبدو اللوحة معطوبة رغم أن المستودع يحوي مستندات حقيقية. | `electron/services/wikiService.ts:291-382`, `:297` |
| 6 | بوابة IPC للويكي تُخفي الويكي الحقيقية إذا لم تكن مساحة العمل في `recentPaths` — تعيد `{wiki:null}` بلا خطأ. | `electron/agent/register.ts:847-889` |
| 7 | أنواع bridge في الواجهة لا تطابق الاستجابة الحقيقية (`error`, `source`, `{ok,error}`)، فكانت الأخطاء تُقرأ بشكل غير موثوق. | `src/lib/api.ts:409-410`, `:588-591` |

**الأيقونات/الصور المصغّرة:** لم تكن مكسورة — ببساطة غير موجودة. CSP يسمح `img-src 'self' data: blob:` فقط (لا `file:`)، واللوحة تستخدم رموزًا حسب النوع. إضافة صور مصغّرة حقيقية تحتاج IPC يقرأ البايتات ويعيد data-URL (تسليم للأب أدناه).

---

## 2. ما أصلحناه / What was fixed

### المكتبة — `electron/services/libraryService.ts`
- `scanArtifactWells():373` — فحص حقيقي ومحدود لكل مواضع القطع الأثرية: `userData/artifacts`, `userData/exports`, مجلد `Downloads` الحقيقي، وجذر كل مساحة عمل مفتوحة + `downloads`, `assets`, `images`, `generated`, `exports`, `output`, `out`, `media`.
- `workspaceRoots():299` — يقرأ `settings.recentPaths` (نفس مصدر بوابة الويكي) عبر `require` كسول.
- `walkWell():321` — عمق محدود، بلا روابط رمزية، يتخطى `node_modules/.git/...` وملفات `token/secret/api-key/...`، ويصنّف حسب الامتداد (`kindOf():290` توسّعت).
- `listLibraryItems():413` — يدمج **حقيقة القرص** مع السجل؛ بيانات السجل (العنوان/Nشأة) تفوز عند التطابق.
- `readForgotten():79` + `forgetLibraryItem():439` + `clearLibrary():457` — مقبرة مسارات حتى لا يعيد الفحص إحياء عنصر حذفه المستخدم؛ إعادة إنتاج الملف (`noteLibraryItem():182`, `importLibraryItem():284`) ترفع المقبرة. `forgetLibraryItem` يحلّ الآن معرّفات `scan_…` أيضًا.
- التنسيق الجديد `library.json` = `{ version: 2, items, forgotten }` (متوافق مع القراءة القديمة).

### المكتبة — `src/components/panels/LibraryPanel.tsx`
- `libraryLoadError():159` — رسالة عربية/إنجليزية واحدة واضحة مع سبب العملية.
- `mutationError():169` — لا يُعلَن نجاح «إزالة/تفريغ» إذا أعادت الـ IPC `{ok:false}`.
- `reload():196` — خطأ التحميل يظهر في شريط `role="alert"` (:384) مع زر إعادة محاولة؛ القائمة الأخيرة تُحفظ بدل ادّعاء الفراغ.
- اشتراك `onAgentEvent():219` — تحديث مُجمَّع بعد `tool_result`/`turn_end`، فيلتقط الملف المكتوب للتو عبر فحص القرص.
- حالات فراغ صادقة (:397): «لا عناصر بعد» مقابل «لا نتائج للتصفية/البحث» مع زر إزالة التصفية.

### الويكي — `electron/services/wikiService.ts`
- `readRepoDocs():448` + `walkDocs():405` — يقرأ `README*.md` أولًا ثم `docs/**/*.md` ثم بقيةMarkdown (بحدود وأمان)، ويبني صفحات حقيقية بعناوين من `# heading`.
- `getWiki():495` — عند غياب ويكي مولّدة يعيد صفحات المستودع الحقيقية بـ `source:'repo-docs'` (:504)؛ الويكي المولّدة تُوسم `source:'generated'` (:518)؛ ملف تالف ⇒ خطأ صريح (`:500`)؛ لا شيء ⇒ حالة فارغة صادقة.
- `generateWiki():300` — رسالة `no_api_key` الآن تقول السبب **وتخبر** أن مستندات Markdown مقروءة بدون مفتاح.

### الويكي — `src/components/panels/WikiPanel.tsx`
- `WikiState.source:34`، قراءة الحقل من الاستجابة `:170`، ختم صادق «من ملفات المستودع / from repo docs» `:313`.
- نص الحالة الفارغة `:288` يذكر `README.md`/`docs/` ومتطلب مفتاح المزوّد.
- رسالة فشل التوليد `:253` تضيف مسار المستندات المتاحة في الحال.

---

## 3. التحقق / Verification

```
npx tsc --noEmit                                   ✅ (after a concurrent, unrelated FlowsPanel.tsx fix landed)
npx tsc -p tsconfig.node.json --noEmit             ✅
node --test --test-force-exit tests/v1136-library-wiki.test.mjs   ✅ 10/10
node --test --test-force-exit tests/v1131-ui-knowledge.test.mjs tests/v1131-full-smoke.test.mjs tests/v102-core.test.mjs
                                                   ✅ 116/116 (60/60 screens rendered, 0 dead controls)
```

يختبر `tests/v1136-library-wiki.test.mjs` على ملفات حقيقية في مجلد مؤقت:
1. قطعة أثرية في `userData/artifacts` ⇒ تظهر في المكتبة (`image`, `scan`).
2. تحميل داخل مساحة عمل مفتوحة **بدون أي `noteLibraryItem`** ⇒ يظهر (`PDF`⇒`document`, `jpg`⇒`image`)، وملف `api-key.txt` لا يظهر.
3. `forget`/`clear` يمنعان إحياء العنصر، وإعادة التنزيل تُعيده.
4. مستودع حقيقي فيه `README.md` + `docs/architecture.md` ⇒ الويكي تعيد صفحتين بعناوينها ومحتواها الحقيقي، `source='repo-docs'`.
5. `wiki.json` تالف ⇒ `{wiki:null, error:'...unreadable...'}`.
6. لوحة المكتبة تعرض شريط خطأ مرئيًا، ولوحة الويكي تعرض نص الصفحة الحقيقي (`UniqueMarkerText 7331`) والخطأ الحقيقي.

---

## 4. تسليمات للأب / Parent handoffs (files I may not edit)

1. **`electron/agent/tools.ts:9246-9330`** — أضف `noteLibraryItem({kind:'download'|'image'...})` بعد الكتابة الناجحة في `browserDownload()`. الفحص الجديد يجعل الملف مرئيًا بدون هذا، لكن الخطاف يضيف بيانات `sessionId` و`origin` موثوقة.
2. **`electron/agent/register.ts:847-889`** — بوابة `isKnownWorkspace` تُعيد `{wiki:null}` بلا `error` لمساحة عمل غير مدرجة في `recentPaths`؛ أعد خطأً قابلاً للعرض أو اقبل مساحة العمل النشطة صراحةً. (الحل الحالي في اللوحة يعتمد على وصف دقيق للحالة الفارغة.)
3. **`src/lib/api.ts:409-410`, `:588-591`** — أضف `error?`/`source?` إلى نوع `wikiGet`، وغيّر `libraryForget/libraryClear` من `Promise<true>` إلى `{ok,error?}` حتى تختفي التحويلات (`as`) في اللوحتين.
4. **`index.html` CSP (`img-src 'self' data: blob:`)** — لا توجد صور مصغّرة حقيقية لأن `file:` محظور؛ يلزم IPC «اقرأ بايتات الصورة ⇒ data URL» إن أُريدت. الرموز الحالية سليمة.
5. **`src/i18n.ts`** — مفاتيح جديدة تُستخدم مع بدائل ثنائية اللغة حقيقية (لا تعتمد على القاموس): `lib.noMatch`, `lib.filter.clear`, `wiki.source.docs`, `wiki.source.docs.title`. أضفها للقاموس عند الرغبة؛ الواجهة الآن بلغة واحدة في كل سلسلة.
6. **`electron/ipc.ts:812`** — `kdx:library:list` لا ينقل أخطاء الفحص من العملية الرئيسية؛ اللوحة تعرض أخطاء الـ bridge/الرفض عبر `libraryLoadError`. إن أُريد نقل سبب فحص القرص، غيّر عقد الاستجابة.
7. **تحقق متزامن / concurrent verification:** أثناء التحقق النهائي ظهرت أخطاء `TS2339` في `src/components/settings/RemoteSection.tsx:321-332` (`lanCandidates` معرَّف كـ `string[]` ويُستخدم ككائنات). ملف خارج نطاقي — تعديل قادم من عميل آخر. ملفاتي تمرّ وحدها: `tsc -p tsconfig.node.json --noEmit` نظيف، و`tsc --noEmit` كان نظيفًا قبل هذا التعديل؛ أعد التشغيل بعد استقرار التعديل الآخر. / At final verification, `tsc --noEmit` was transiently blocked by another agent's in-progress `RemoteSection.tsx` change (not mine); my own files were clean under both configs.
