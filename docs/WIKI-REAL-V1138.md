# Repo Wiki — الحكم النهائي / Blunt Verdict (v11.38)

## الحكم / Verdict

**كان معطلاً فعلياً — والآن يعمل فعلاً.** ليس تجميلاً: الويكي تُبنى الآن من ملفات
المستودع الحقيقية بدون أي مفتاح، والبوابة (gate) لم تعد تُلغي ويكي مساحة عمل صالحة
بصمت.

**It was genuinely broken, and it now genuinely works.** This is not cosmetic.
The wiki is built from the repository's real files with no AI key, and the IPC gate
no longer silently nulls a valid workspace.

---

## ماذا كان مكسوراً؟ / What was actually broken? (audit)

1. **لا مفتاح = لا ويكي إطلاقاً.** `generateWiki` كان يرفض فوراً أي طلب بلا
   `apiKey`. في الواقع معظم المستخدمين بلا مفتاح ⇒ لا صفحات مولّدة أبداً.
   كان D7 أضاف fallback يقرأ Markdown فقط (README + `docs/`) — أي **تفريغ خام**
   لنصوص جاهزة، بلا بنية المشروع، بلا `package.json` scripts، والمستودعات التي
   تحتوي كوداً فقط كانت تُظهر لوحة فارغة.

2. **بوابة IPC كانت تُخفي الويكي بصمت.** `kdx:wiki:get` في `register.ts` كان
   يرى `recentPaths` فقط: أي مساحة عمل غير موجودة فيه تُعاد بـ `{ wiki: null }`
   **بلا خطأ**. والواجهة تضبط `wsPath` فور فتح المجلد بينما `recentPaths` تُكتب
   للقرص بشكل غير متزامن — فنافذة زمنية حقيقية كانت تُفرغ اللوحة. هذا بالضبط
   ما أشار إليه D7 عند `register.ts:847-889`.

3. **حالة فارغة بلا مخرج.** اللوحة تعرض زر "Generate" الذي يفشل بدوره بلا مفتاح.
   نتيجة: "الريبو ويكي لا يعمل".

---

## ما أصلحناه / What was fixed

### `electron/services/wikiService.ts`

- **`buildOfflineWiki()`** — ويكي حقيقية من مصادر المستودع نفسها:
  - `README.md` و `docs/*.md` (العناوين من `#` الحقيقية، الأقسام محفوظة)،
  - **خريطة بنية المصدر** (مجلدات + عدد الملفات + ملفات بارزة) من الماسح الموجود،
  - **صفحة الأوامر/الإعداد** من `package.json` scripts،
  - صفحة نظرة عامة مُركّبة من بيانات `package.json` عندما لا يوجد README.
  - كل ذلك بدون نموذج، مع نفس حماية الأسرار والحدود (symlinks/keys/node_modules…).
- **`generateWiki`** مع مفتاح: يكتب دليلاً معمارياً بالذكاء الاصطناعي؛ وإذا تعذّر
  النموذج أو أعاد خطة غير صالحة ⇒ **يحفظ الويكي الحقيقية بدون اتصال** ويعيد
  `offline: true` بدلاً من ترك اللوحة فارغة. بلا مفتاح: يبقى الخطأ الصريح
  (`no_api_key`) كما هو، لكن `getWiki` يعرض الويكي المفيدة فوراً.
- **الصدق في المصدر**: حقل `source` (`generated` | `repo-docs`) يُحفظ في
  `wiki.json` ويُقرأ عند التحميل، فلا يُادّعى أن ويكي غير مولّدة أنها "AI".
- **`isAllowedWikiWorkspace()`** — دالة قابلة للاختبار: تقبل أي مسار ضمن
  `recentPaths` **أو** مجلد حقيقي يحمل علامة مشروع (`README`, `docs`, `src`,
  `package.json`, `.git`, …). ترفض الجذر والمسارات غير الموجودة/العشوائية.
- رسالة صريحة عندما لا توجد ملفات مقروءة إطلاقاً (بدل null صامت).

### `electron/agent/register.ts`

- بوابة `kdx:wiki:get`/`kdx:wiki:generate` تستخدم الدالة المشتركة الجديدة؛
  المسار غير المسموح يُعيد الآن **خطأً مفهوماً** بدل `{ wiki: null }` الصامت.
- التحقق من sender الموثوق (`gated`) لم يمسّه أحد — الأمان كما كان.

### `src/components/panels/WikiPanel.tsx`

- ختم مصدر صادق: `from repo docs · offline` مقابل `AI-generated`، مع tooltip
  يشرح أن ويكي offline مبنية من README/docs/البنية/الأوامر.
- نص الحالة الفارغة يقول صراحة إن الويكي تُبنى تلقائياً من الملفات بدون مفتاح،
  وأن الذكاء الاصطناعي تحسين لاحق فقط.
- ترتيب `useState` لم يتغير (اختبارات SSR تعتمد عليه).

---

## التحقق / Verification

- `npx tsc -p tsconfig.node.json --noEmit` — **أخضر** (يغطي `wikiService.ts` و`register.ts`).
- `npx tsc --noEmit` — ملفاتي (`WikiPanel.tsx`, `wikiService.ts`, `register.ts`)
  **بلا أخطاء**. لكن الفحص الكلي للويب كان أحمر في لحظة الكتابة بسبب تعديلات
  متزامنة من وكلاء آخرين في ملفات لا أملكها (`GitPanel.tsx`,
  `SignaturePanel.tsx`, `src/lib/api.ts`, `shared/types.ts` — رموز
  `GitBranchInfo`/`GitIdentityInfo` ووحدات مفقودة لحظياً). يُسلَّم لأصحابها.
- `node --test --test-force-exit tests/v1138-wiki.test.mjs` — **8/8 أخضر**:
  README+docs ⇒ صفح بأقسام حقيقية؛ كود+scripts ⇒ صفحا بنية وأوامر؛ بلا مفتاح
  ⇒ محتوى مفيد؛ عطل النموذج ⇒ fallback صادق؛ تلف ⇒ خطأ؛ البوابة تقبل مساحة
  عمل صالحة؛ اللوحة تُظهر المحتوى والخطأ فعلياً عبر SSR.
- `node --test --test-force-exit tests/v1136-library-wiki.test.mjs` — **10/10 أخضر**
  عند تشغيله بعد تعديلاتي مباشرة، ثم **أصبح 9/10** لاحقاً بسبب تعديل متزامن من
  وكيل آخر في `LibraryPanel.tsx` غيّر نص `libraryLoadError` الإنجليزي من
  "Could not read the library…" إلى "The app bridge is not ready…"، بينما لا يزال
  اختبار P2 يتوقع النص القديم. **ليس ملفاً أملكه** — يُسلَّم لصاحبه (ويكي
  نفسها سليمة: اختباراتها الثمانية + أسئلة الويكي في v1136 كلها خضراء).

## تسليم / Hand-off (لم ألمسها)

`store.ts`، `engine.ts`، `i18n.ts` لم تُعدَّل. تحسين اختياري لاحق: إضافة `source`
و`error` إلى نوع `wikiGet` في `src/lib/api.ts` (اللوحة تقرأهما عبر cast، فلا أثر
تشغيلي اليوم).
