# Homepage Redesign — Diagnosis & Guard / تشخيص إعادة تصميم الصفحة الرئيسية

> Snapshot / لقطة: **2026-11-20T16:21:35Z** (final). Scope / النطاق: `website/app/page.tsx`, `website/app/home.css`.
> Source-only guard: `node website/tests-homepage.mjs` · with deploy check: `node website/tests-homepage.mjs --live`.
> This guard reads **source + built HTML**, not pixels. / يقرأ هذا الحارس **المصدر و HTML المبني**، لا البكسلات.

---

## English — Verdict

**It is a real redesign, not reshuffled clutter. I refuse to call it "polished" — I cannot see pixels.**

That is the blunt answer. At source level H1 deleted the old clutter instead of moving it around:

| Signal | Before | After (final snapshot) |
|---|---|---|
| `app/page.tsx` | 888 lines | **440 lines** |
| `app/home.css` | 404 lines | **225 lines** |
| `<section>` count | 7 | **5** (`page.tsx:244, 329, 373, 402, 421`) |
| `<h1>` count | 1 | **1** (`page.tsx:333`) |
| clutter markers | `hero-metrics`, `eng-plate-notes`, `art-corner`, `hero-chips`, `demo-sec` | all four hard markers gone from **both** markup and CSS; `demo-sec` kept as a WARN |
| orphan CSS classes | ~30 | **0** — every class styled in `home.css` is emitted by `page.tsx` |
| typewriter/IntersectionObserver JS | 4 hooks + rAF loops | one `useReveal` data-attribute hook (`page.tsx:131-159`) |

What was actually removed, not restyled: the 9-row feature grid, the 3-step "ritual", the numbered plate annotations, the floating glass metric chips, the playbook specimen, the reading hairline, the two other engraved diagrams and the manual `reduce-motion` CSS army. The new page has one hero, one product-in-use stage, three benefit plates, one proof strip and one CTA. That is a **structure**, not a reshuffle.

H2's visual is present and wired: `InstrumentDial` imported at `page.tsx:7`, rendered at `page.tsx:353`, exported at `components/visuals/index.ts:13`. `PrecisionGrid` and `OrbitConstellation` were dropped.

Bilingual / RTL / motion all hold at source: 40 `tx()` calls and 48 Arabic lines in `page.tsx`; `lib/i18n.tsx:19-25` syncs `lang`/`dir`; `home.css` uses logical properties (`inset-inline-start:33`, `padding-inline-start:90`, `border-inline-start:184`) with 21 `[lang='ar']`/`[dir='rtl']` overrides and **zero** physical `left/right` declarations. Every new animation has an explicit `prefers-reduced-motion` guard at `home.css:209-225`, plus the global universal kill-switch at `globals.css:146`.

### Gaps — exact, to parent

1. **DEPLOY STALE (hard FAIL).** `https://sadeem-website-theta.vercel.app/` still serves the OLD homepage at every check: `<h1>=1`, `<section>=7`, and all four old markers (`hero-metrics`, `eng-plate-notes`, `art-corner`, `hero-chips`) present in rendered HTML; no `data-section` / `data-homepage` markers. **Pending redeploy.** The guard's only FAIL is this one — source itself is clean, so `node …/tests-homepage.mjs` (without `--live`) exits 0.
2. **`demo-sec` retained** — `page.tsx:244`, `home.css:39`. WARN, allowed only because the demo was deliberately kept and simplified. If the intent was to replace it, this is a leftover marker.
3. **`proof-sec` is an unstyled dead hook** — `page.tsx:402`. No `.proof-sec` rule exists in `home.css`; layout comes from `.section-tight`/`.wrap` in `globals.css`. Harmless visually, but it is still a dangling class.
4. **Source ≠ pixels.** I never rendered the page in a browser and took no screenshot. I cannot confirm spacing, contrast, visual hierarchy, font rendering, the `@media` breakpoints at 880/900/1000px, or whether the RTL *visual* order is actually correct. A clean class list is not a clean layout. This is the honest limit of this report.
5. **No explicit deploy marker.** Built HTML has the new ids (`#see-it`, `#principles`, `#figures`, `#start`) but no `data-section`/`data-homepage` attribute, so live verification relies on counting tags. Add a stable marker if parent wants an unambiguous "new design is live" signal.

### Exit codes (final source)

| Command | Exit | Note |
|---|---|---|
| `npx tsc --noEmit` | **0** | clean |
| `npm run build` | **0** | Next 16.4.6 / Turbopack, 10 static pages |
| `node website/tests-homepage.mjs` | **0** | 13 PASS / 0 FAIL / 2 WARN |
| `node website/tests-homepage.mjs --live` | **1** | 13 PASS / 1 FAIL / 2 WARN — FAIL is the stale deploy only |

Built artifact `.next/server/app/index.html` (43,243 bytes): `<h1>=1`, `<section>=5`, zero old markers, `#see-it` / `#principles` / `#figures` / `#start` present. That is the strongest evidence available short of a screenshot.

### Race observed (important)

The source changed under this guard while it ran: at `16:18:13Z` `page.tsx` was already rebuilt but `home.css` was **still the old 404-line file** (old `.hero-metrics:150`, `.art-corner:25-27`, old animations). At `16:19:18Z` `home.css` was rewritten; at `16:21:35Z` H2's `InstrumentDial` landed and shifted every line number. All numbers above are from the final `16:21:35Z` snapshot. **Re-run the guard after any further edit** — a half-landed state fails hard on checks C1/C4/F4.

---

## العربية — الحكم

**هذه إعادة تصميم حقيقية، ليست فوضى مُعاد ترتيبها. أرفض وصفها بـ"متقنة" — لأنني لا أرى البكسلات.**

هذا هو الحكم بصراحة. على مستوى المصدر حذف H1 الفوضى القديمة بدل أن ينقلها:

| المؤشر | قبل | بعد (اللقطة النهائية) |
|---|---|---|
| `app/page.tsx` | 888 سطراً | **440 سطراً** |
| `app/home.css` | 404 أسطر | **225 سطراً** |
| عدد `<section>` | 7 | **5** (`page.tsx:244, 329, 373, 402, 421`) |
| عدد `<h1>` | 1 | **1** (`page.tsx:333`) |
| علامات الفوضى | `hero-metrics`, `eng-plate-notes`, `art-corner`, `hero-chips`, `demo-sec` | اختفت العلامات الأربع الصلبة من **التركيبة و CSS معاً**؛ `demo-sec` بقي كتحذير |
| أصناف CSS يتيمة | ~30 | **0** — كل صنف في `home.css` يُستخدم في `page.tsx` |
| حركة typewriter / IntersectionObserver | 4 خطافات + حلقات rAF | خطاف واحد `useReveal` (`page.tsx:131-159`) |

ما حُذف فعلاً لا ما أُعيد تنميقه: شبكة الميزات التسع، خطوات "الطريقة" الثلاث، تعليقات اللوحة المرقّمة، شرائح المقاييس الزجاجية، عيّنة الدليل الحيّ، شريط القراءة، الرسمان الإضافيان، وجيش قواعد `reduce-motion` اليدوية. الصفحة الجديدة: بطل واحد، مشهد منتج واحد، ثلاث لوحات مزايا، شريط أرقام واحد، ودعوة أخيرة. هذا **هيكل**، لا ترتيب فوضى.

مرئية H2 موجودة وموصلة: `InstrumentDial` مستورد في `page.tsx:7`، مُظهَر في `page.tsx:353`، ومُصدَّر في `components/visuals/index.ts:13`. أُسقط `PrecisionGrid` و `OrbitConstellation`.

الثنائية و RTL والحركة سليمة في المصدر: 40 استدعاء `tx()` و48 سطراً عربياً في `page.tsx`؛ `lib/i18n.tsx:19-25` يزامن `lang`/`dir`؛ `home.css` يستخدم خصائص منطقية (`inset-inline-start:33`، `padding-inline-start:90`، `border-inline-start:184`) مع 21 تجاوزاً `[lang='ar']`/`[dir='rtl']` و**صفر** تصريحات `left/right` الفيزيائية. كل حركة جديدة لها حاجز `prefers-reduced-motion` صريح في `home.css:209-225`، إضافة إلى المفتاح العام في `globals.css:146`.

### الفجوات — أدق ما أستطيع إبلاغ الأب به

1. **النشر قديم (فشل صلب).** `https://sadeem-website-theta.vercel.app/` ما زال يخدم الصفحة القديمة في كل فحص: `<h1>=1`، `<section>=7`، والعلامات الأربع القديمة موجودة في HTML المُظهَر؛ ولا توجد `data-section`/`data-homepage`. **بانتظار إعادة النشر.** هذا هو الفشل الوحيد في الحارس — المصدر نفسه نظيف، لذا `node …/tests-homepage.mjs` (بدون `--live`) يخرج بـ0.
2. **`demo-sec` ما زال موجوداً** — `page.tsx:244`، `home.css:39`. تحذير مقبول فقط لأن المشهد أُبقي وبُسّط عمداً. إن كان المقصود استبداله فهو أثر متبقٍ.
3. **`proof-sec` صنف ميت بلا تنسيق** — `page.tsx:402`. لا توجد قاعدة `.proof-sec` في `home.css`؛ التخطيط من `.section-tight`/`.wrap` في `globals.css`. غير مؤثر بصرياً، لكنه صنف معلّق.
4. **المصدر ≠ البكسلات.** لم أفتح الصفحة في متصفح ولم ألتقط صورة. لا أستطيع تأكيد المسافات أو التباين أو التسلسل البصري أو خطوط العرض عند 880/900/1000px أو صحة الترتيب البصري في RTL. قائمة أصناف نظيفة ليست تخطيطاً نظيفاً. هذا هو الحد الصادق لهذا التقرير.
5. **لا علامة نشر صريحة.** HTML المبني يحمل المعرّفات الجديدة (`#see-it`, `#principles`, `#figures`, `#start`) لكن بلا `data-section`/`data-homepage`، فيعتمد التحقق على عدّ الوسوم. أضف علامة ثابتة إن أردت إشارة قاطعة إلى أن التصميم الجديد حيّ.

### رموز الخروج (المصدر النهائي)

| الأمر | الرمز | ملاحظة |
|---|---|---|
| `npx tsc --noEmit` | **0** | نظيف |
| `npm run build` | **0** | Next 16.4.6 / Turbopack، 10 صفحات ثابتة |
| `node website/tests-homepage.mjs` | **0** | 13 نجاح / 0 فشل / 2 تحذير |
| `node website/tests-homepage.mjs --live` | **1** | 13 نجاح / 1 فشل / 2 تحذير — الفشل هو النشر القديم فقط |

المُنتَج المبني `.next/server/app/index.html` (43,243 بايت): `<h1>=1`، `<section>=5`، صفر علامات قديمة، و`#see-it` / `#principles` / `#figures` / `#start` موجودة. هذا أقوى دليل متاح قبل صورة شاشة.

### حالة تسابق لوحظت (مهمة)

المصدر تغيّر أثناء عمل الحارس: عند `16:18:13Z` كان `page.tsx` مُعاد بنائه لكن `home.css` كان **ما زال الملف القديم ذا 404 أسطر** (`.hero-metrics:150`، `.art-corner:25-27`، حركات قديمة). عند `16:19:18Z` أُعيد كتابة `home.css`، وعند `16:21:35Z` حطّ H2 مرئية `InstrumentDial` فتغيّرت كل أرقام الأسطر. كل الأرقام أعلاه من اللقطة النهائية `16:21:35Z`. **أعِد تشغيل الحارس بعد أي تعديل إضافي** — الحالة نصف المُنجزة تفشل بقسوة في الفحوص C1/C4/F4.
