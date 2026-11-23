# CONTEXT WINDOW — v1137: «1M shown as 200,000»
# نافذة السياق — v1137: «نموذج مليون يظهر كـ 200,000»

## الحكم بوضوح / Blunt verdict

> **كانت المشكلة حقيقية، وكانت في مسار التشغيل الفعلي لا في الاختبارات.**
> **The bug was real, and it lived in the RUNTIME path — not in the tests.**

**قبل الإصلاح:** نعم، كان يتكرر — نموذج نافذته الحقيقية 1,000,000 يظهر في العدّادة كـ **200,000**.
**After the fix:** **لا — لم يعد يتكرر (NO — no longer reproduces).** نفس النموذج يُظهر الآن **1,000,000** في الكرة وفي نافذة التفاصيل، سواء وُجد كتالوج OpenRouter حيّ أم لا.

السبب أن D13 اختبر **مسار الكتالوج المحقون فقط** (`__seedOpenRouterCatalogForTest`)؛ مهمّا قال «13/13»، فهو لم يختبر ما يحدث عند التشغيل البارد حين لا يوجد كتالوج في الذاكرة. المؤسّس كان على حق («في غلط بالكونتكست، لازم يجيبها من المصدر») — وأصرّ على تصديقه كان صحيحاً.

D13 verified only the **injected-catalog** path. The "13/13" pass never exercised a cold/offline start where the in-module catalog is empty. The founder was right, and the repeated claims that it was "fixed" were wrong.

---

## أين كان الخلل بالضبط / Exact root cause (file:line)

1. **كتالوج OpenRouter لا يُجلب عند التشغيل.** `openrouterLiveModels()` (`electron/services/openrouterCatalog.ts:215`) لا يُستدعى إلا من «فتح قائمة النماذج» (`ipc.ts:667-671`) أو تفعيل مزوّد (`providerService.ts:506`). على بدء بارد / بدون مفتاح / بدون شبكة،ذاكرة الكتالوج فارغة و`openrouterContextFor()` يُعيد `null`.

2. **الجدول المحلي كان يكذب على نماذج المليون.** `electron/agent/costs.ts:355-356` يثبّت:
   - `claude-haiku-4-5` → `200_000`
   - `claude-sonnet-4-5` → `200_000`
   بينما المزوّد نفسه (GET `https://openrouter.ai/api/v1/models`، تحقّقت منه مباشرة 2026-11-22) يُبلغ **1,000,000** لكلا المعرّفين. الافتراض العام `CONTEXT_FALLBACK = 200_000` في `costs.ts:447` كان إذن يظهر لنموذج مليون.

3. **معالج الـ IPC كان يمرّر القيمة الخاطئة كما هي.** `electron/ipc.ts:689-692` (قبل الإصلاح):
   ```ts
   const catalogCtx = openrouterContextFor(id);   // null offline
   const info = contextWindowInfo(id);            // 200_000 (curated)
   const ctx = catalogCtx ?? info.ctx;            // => 200_000
   ```
   والكرت (`ContextLens.tsx` / `StatusBar.tsx`) يقرأ `api.modelInfo()` — أي نفس المعالج — فيطبع `200,000` بثقة، حتى بلا علامة ≈ لأن `estimated` كان `false` لسجل موجود بالجدول.

4. **خلل إضافي:** `openrouterContextFor()` كان يتطابق بالمعرّف الكامل فقط، فمعرّف مجرّد مثل `claude-sonnet-4.5` لا يجد صفّ `anthropic/claude-sonnet-4.5` حتى لو كان الكتالوج موجوداً.

---

## الإصلاح / The fix (ما الذي تغيّر فعلاً)

| الملف | السطر | التغيير |
| --- | --- | --- |
| `electron/services/openrouterCatalog.ts` | `:285-301` | `openrouterContextFor()` يتطابق الآن مع الصف الحيّ بالمعرّف الكامل **أو** بلاحقة فريدة للمعرّف المجرّد (قاعدة «وحيد فقط، بلا تخمين» كما في الأسعار) — بابورة المزوّد تصل حتى لو أُرسل `model.model` مجرّداً. |
| `electron/services/openrouterCatalog.ts` | `:327-374` | جدول **عالي الدقة** `CURATED_ONE_M_WINDOWS` + `curatedOneMWindowFor()` — معرّفات المؤسّس بالضبط (`claude-sonnet-4.5` `:343`, `claude-haiku-4-5` `:344`, `claude-sonnet-5.5`, الهايكو/الأوبس 5.x، جيميني، ديب سيك، كوين…) بقيم 1M / 1,048,576 / 1,050,000 المنشورة. لا تلمس `costs.ts` (ملك وكيل آخر). |
| `electron/services/openrouterCatalog.ts` | `:397-411` | `resolveModelWindow()` — الحلّ المشترك: **حيّ المزوّد أولاً → جدول 1M عالي الدقة ثانياً → الافتراض ≈200k أخيراً**. |
| `electron/ipc.ts` | `:700-704` | معالج `kdx:model:info` يمرّر الآن عبر `resolveModelWindow()`. سطور `:689-692` بقيت سليمة (توافق v1134/v1136). |
| `src/lib/ctx.ts` | `:44-54` | `ONE_M_TOKEN_WINDOW` + `isOneMClassWindow()` — ثابت «لا 200k لنموذج 1M» في طبقة العرض. |
| `src/components/ContextLens.tsx` | `:120-152`, `:494-499` | الكرة تعيد Resolve عند عودة التركيز/الظهور وبعد تأخير قصير إن كانت النافذة مجهولة (التحميل الحيّ المتأخر يرقّي القيمة)، وترفض تخفيض نافذة 1M مؤكّدة إلى ≈200k، وتعرض «1M» صراحةً عندما تكون النافذة مؤكّدة. |

**ترتيب الأولوية بعد الإصلاح:** قيمة المزوّد الحيّة (دقيقة، بلا ≈) ← جدول 1M عالي الدقة (قيمة معروفة، بلا ≈) ← القيمة المحلية إن وُجدت ← `200_000` موسومة `≈` للنماذج المجهولة فقط. **لا يظهر 200,000 أبداً لنموذج معروف أنه 1M.**

---

## التحقق / Verification (actually run)

```
npx tsc --noEmit                          -> OK
npx tsc -p tsconfig.node.json --noEmit    -> OK
node --test tests/v1137-context-window.test.mjs        -> 10/10 PASS
node --test tests-v1136-context-precision.mjs          -> 13/13 PASS
node --test tests/v1134-context.test.mjs               -> 10/10 PASS
node --test tests/v1134-context-guard.test.mjs         -> 18/18 PASS
node --test tests/v1135-token-precision.test.mjs       ->  9/9  PASS
```

`tests/v1137-context-window.test.mjs` يشغّل **معالج `kdx:model:info` الحقيقي** (حزمة esbuild تضم `openrouterCatalog.ts` و`costs.ts` الحقيقيين وتستبدل الخدمات غير ذات الصلة بـ stubs)، ثم يُغذّي الكرة الحقيقية (`ContextLens` عبر SSR) بنتيجته:
• Fixture حيّ 1M → `1,000,000` لا `200,000`؛
• بدون كتالوج (حالة المؤسّس) → `1,000,000` أيضاً؛
• إثبات جذري: `contextWindowInfo('claude-sonnet-4.5')` ما زال **200,000** في `costs.ts`، والجدول الجديد هو الذي أنقذ المسار؛
-معرّف مجهول → `≈200,000` بصراحة (لا 1M مُختلق)؛
-الكرة: 250k في نافذة 1M = **25%** لا 100%، ولا قوس مزيّف حين تتجاوز ≈200k.

---

## تحذيرات صادقة / Honest caveats

1. الوصول للإنترنت يعمل فعلاً من هذه البيئة، لكن التطبيق لا يجلب الكتالوج عند التشغيل؛ لذلك **الحل الحقيقي للمؤسّس هو الجدول عالي الدقة**، لا الاعتماد على الشبكة. أضفنا إعادة المحاولة عند عودة التركيز لرفع القيمة إلى المزوّد إن اكتمل التحميل لاحقاً.
2. إن أبلغ المزوّد الحيّ عن قيمة أصغر (مثلاً 128k) فهي **القيمة المعتمدة** («من المصدر») — الجدول لا يتجاوز المزوّد أبداً.
3. لا يوجد tokenizer حقيقي؛ كل ما قبل تقرير المزوّد عن الاستخدام يبقى موسوماً `≈` (قواعد v1135 لم تُمسّ).

---

## Files / الملفات

| File | Role |
| --- | --- |
| `tests/v1137-context-window.test.mjs` | 10 behaviour + source tests driving the real IPC handler + orb |
| `docs/CONTEXT-WINDOW-V1137.md` | This blunt verdict |
| `electron/services/openrouterCatalog.ts` | window resolution `:285`, curated 1M table `:331`, `resolveModelWindow` `:397` |
| `electron/ipc.ts` | `kdx:model:info` `:681-706` |
| `src/lib/ctx.ts` | 1M invariant `:44-54` |
| `src/components/ContextLens.tsx` | lens re-resolve `:120-152`, confirmed-window label `:494-499` |
