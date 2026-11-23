# Homepage WOW + SEO Guard — Diagnosis & Verdict / تشخيص وحكم الوميض والـ SEO للصفحة الرئيسية

> Snapshot / لقطة: **2026-11-20T17:07:17Z** (final source read after S1/S2/S3 landed). Scope / النطاق: `website/`.
> All `file:line` references below are from this snapshot. S1 was still refining `page.tsx` during the audit (last write 20:05:58Z, +1 line), so earlier snapshots differ by one line. Re-run the guard after any further edit. / كل مراجع `file:line` أدناه من هذه اللقطة؛ كان S1 لا يزال يعدّل `page.tsx` أثناء التدقيق، فأي لقطة أسبق تختلف بسطر واحد.
> Guard / الحارس: `node website/tests-homepage-seo.mjs` · deploy check: `node website/tests-homepage-seo.mjs --live`.
> This report reads **source + built HTML + live HTML — never pixels.** / يقرأ هذا التقرير **المصدر و HTML المبني والحي — لا البكسلات أبداً.**

---

## English — Blunt verdict

**There is a real artistic attempt here and real SEO content. This is not "just more code" — but one hard thing is still broken: the live site does not serve any of it.**

I will not soften that. Source-level, S1/S2/S3 did substantive work:

- **The hero is a hand-authored engraving, not an image placeholder.** `app/page.tsx:297-436` builds a 600×600 SVG from index-derived geometry: **42 literal `<circle>`, 16 `<path>`, 6 `<rect>`**, plus generators that emit **120 graduation ticks** (`page.tsx:55-66, 362-371`), **54 ruler ticks** (`:69-73, 339-344`), **18 stepped circuit traces** (`:76-86, 384-390`), 12 satellites, 3+5 orbital nodes, a luminous core (`:410-420`), concentric rings, crosshairs, gradients and one `feTurbulence` grain pass (`:324-328, 424-425`). All coordinates come from `Array.from({length:n}, (_,i)=>…)` and `toFixed(2)` — deterministic, so hydration is safe (`tests-homepage-seo.mjs` check S5). It has a bilingual `role="img"` label (`:299-302, 308-313`). The AI-image credit block was worked around with geometry, not with a stolen asset.
- **The entrance is a real choreography, not a single fade.** `app/home.css:53-71` defines **8 named keyframes** (`hero-rise`, `hero-rule`, `hero-art-in-ltr`, `hero-art-in-rtl`, `hero-bloom`, `he-drift`, `he-spin`, `he-pulse`) and staggers 8 elements by `--d` = 0 → 80 → 160 → 250 → 340 → 420 → 440 → 460 → 520 ms (`page.tsx:535-565`; CSS `home.css:67-71`). "Variants" here means **named keyframe variants + an RTL-specific art variant**, not Framer Motion variants — worth saying plainly. Reduced-motion coverage is complete: all 8 hero animation classes appear in both the OS `@media (prefers-reduced-motion)` block (`home.css:246-259`) and the `.reduce-motion` / `[data-art='off']` `:is()` guards (`home.css:260-273`), on top of the universal kill-switch (`globals.css:146`).
- **SEOContent is genuinely mounted and genuinely substantive.** Imported at `page.tsx:8`, rendered at `page.tsx:632` before the final CTA. `components/home/SEOContent.tsx:192-243` renders a full editorial section: 3 long bilingual subsections (`:47-90`) answering real queries (local-first AI coding agent, BYOK, privacy-first MCP, Arabic AI coding assistant), plus 4 native `<details>/<summary>` FAQs (`:95-136, 228-239`). It is ~16 KB of authored prose, not a keyword-stuffed stub. Its classes are actually styled (`globals.css:109-133`). No new motion is introduced there, so the global kill-switch covers it.
- **FAQ structured data exists and mirrors the rendered copy.** `app/layout.tsx:52-80` declares 4 `FAQ_ENTRIES`, maps them into a `FAQPage` `mainEntity` with `Question`/`acceptedAnswer`, and emits it as a second `application/ld+json` block (`:169-174`) next to the enhanced `SoftwareApplication` block (`:20-47, 163-168`). Metadata gained EN+AR keywords and `isAccessibleForFree`/`featureList` (`:13-15, 31-39, 87-110`).

### The verdict, without hedging

- **Artistic wow: probable, unproven.** The geometry and choreography are real and unusually detailed for a hero — more than "just more code." But I did **not** open a browser or take a screenshot. I cannot say whether lime-on-charcoal at `home.css:38-42` reads as premium or as a gadget diagram, whether the ~1.36 s entrance (`home.css:57`) feels confident or sluggish, whether the `feTurbulence` grain (`page.tsx:324-328, 424-425`) is tasteful or just expensive paint, or whether the mat staying dark in the light theme (`home.css:31-42`) is intentional contrast or a theme break. **Source ≠ pixels. I am not claiming the pixels are beautiful.**
- **SEO: real content, with structural caveats.** The copy is honest and query-targeted, and the JSON-LD is present in the built HTML. But the deployed site does not serve it, the FAQ JSON-LD is English while the default render is Arabic, there is no `hreflang`, and the canonical points at a different domain. Those are real gaps, listed below.

### Exact gaps — to parent

1. **LIVE DEPLOY IS STALE (the only hard blocker).** `https://sadeem-website-theta.vercel.app/` returns HTTP 200 with the **previous round's** homepage: `<title>SADEEM — The agent that grows with you</title>`, 1 `<h1>`, 5 `<section>`, **0 `<details>`**, **1** JSON-LD block (`SoftwareApplication` only). Absent from live HTML: `he-svg`, `NEURAL CORE`, `hero-enter`, `id="guide"`, `FAQPage`, `acceptedAnswer`, `THE HONEST GUIDE`/`الدليل الصادق`, the FAQ question text. This is the H1/H2 redesign that the earlier `HOMEPAGE-REDESIGN.md` called stale — it has since been deployed, but this round's WOW+SEO has **not**. **Parent must redeploy.** Evidence is strong that the build is correct: `.next/server/app/index.html` (77,230 bytes) contains `he-svg`, `NEURAL CORE`, `hero-enter`, `--d:`, `id="guide"`, `seo-title`, `FAQPage`, `acceptedAnswer`, the FAQ question text, the Arabic strings `الدليل الصادق`/`كيف يعمل فعلاً`, **6** `<section>`, **4** `<details>`, **1** `<h1>`, **2** ld+json scripts. Source and build are done; only the deploy is missing.
2. **FAQ JSON-LD language ≠ default visible language.** `app/layout.tsx:52-69` stores English Q&As; `app/layout.tsx:159` renders `lang="ar" dir="rtl"` and `SEOContent.tsx:30-37, 56-135` shows Arabic by default. The English answer text is in the DOM only inside a `<script type="application/ld+json">`, not in visible copy until a client-side toggle. Google's "structured data must match visible content" guidance is at risk here. Fix: emit an Arabic `FAQPage` (or both, with matching visible text).
3. **No `hreflang` despite a bilingual site.** `app/layout.tsx:82-151` sets `openGraph.locale: 'ar_SA'` and `alternateLocale: ['en_US']` but has no `alternates.languages`. Both languages live on one URL behind a client toggle (`lib/i18n.tsx`), so crawlers index the Arabic default only — the English-target keywords at `layout.tsx:91-105` may be underweighted.
4. **Canonical points off-domain.** `app/layout.tsx:83` `metadataBase: new URL(SITE.siteUrl)` and `:115` `alternates: { canonical: '/' }` resolve to `https://sadeem-ai.com/` (`lib/site.ts:8`), while the live host is `sadeem-website-theta.vercel.app`. If the canonical domain is not yet serving this content, that is a mis-signal.
5. **Out-of-scope hydration-unsafe calls (WARN, not this contract).** `app/auth/page.tsx:66` `Date.now()` and `app/sitemap.ts:24` `new Date()`. Neither is on the homepage path; homepage render code is clean (`page.tsx` and `SEOContent.tsx` have zero `Math.random`/`Date.now`/`new Date`/`performance.now`).
6. **Carried-over leftovers from the previous round (WARN).** `demo-sec` still at `app/page.tsx:448` / `app/home.css:76`; `proof-sec` is still an unstyled dead hook at `app/page.tsx:614`. Not regressions from S1/S2/S3.
7. **Source ≠ pixels (the honest limit).** No screenshot, no browser session, no contrast audit, no low-end-device paint check. The preceding three paragraphs are claims about **code**, not about how it looks. Verify visually before calling it "wow."

### Exit codes (this snapshot)

| Command | Exit | Result |
|---|---|---|
| `node tests-homepage-seo.mjs` | **0** | 8 PASS / 0 FAIL / 1 WARN |
| `node tests-homepage-seo.mjs --live` | **0** | 8 PASS / 0 FAIL / 2 WARN — the stale deploy is deliberately a WARN; the guard does not fail the run on a deploy lag |
| `npx tsc --noEmit` | **0** | clean |
| `npm run build` | **0** | Next 16.4.6 / Turbopack, 10 static pages, TypeScript step clean |
| `node tests-homepage.mjs` (regression) | **0** | 13 PASS / 0 FAIL / 2 WARN |

After the parent redeploys, re-run `node tests-homepage-seo.mjs --live` and expect `LIVE-1` to flip to PASS with `FAQ-LD=true FAQtext=true #guide=true engraving=true`.

---

## العربية — الحكم بصراحة

**يوجد هنا محاولة فنية حقيقية ومحتوى SEO حقيقي. ليس هذا «مزيداً من الكود» فحسب — لكن هناك عائقاً صلباً واحداً ما زال قائماً: الموقع الحيّ لا يقدّم أياً من هذا.**

لن ألطّف العبارة. على مستوى المصدر أنجز S1/S2/S3 عملاً جوهرياً:

- **البطل نقش مرسوم يدوياً، لا صورة بديلة.** `app/page.tsx:297-436` يبني SVG بمقاس 600×600 من هندسة مشتقة من الفهارس: **42 دائرة `<circle>` و16 مسار `<path>` و6 مستطيلات `<rect>`** صريحة، مضافاً إليها مولّدات تُخرج **120 علامة تدرّج** (`:55-66, 362-371`) و**54 علامة مسطرة** (`:69-73, 339-344`) و**18 أثراً كهربائياً متدرّجاً** (`:76-86, 384-390`) و12 قمراً صناعياً و8 عُقد مدارية ونواة مضيئة (`:410-420`) وحلقات متحدة المركز ومحاور وتدرّجات لونية وطبقة حبيبية `feTurbulence` (`:324-328, 424-425`). كل الإحداثيات من `Array.from(...)` و`toFixed(2)` — حتمية، لذا الترطيب (hydration) آمن (الفحص S5). حظر رصيد توليد الصور.ai جرى تجاوزه بالهندسة لا بأصل مسروق.
- **الدخول (entrance) كوريوغرافيا حقيقية، لا تلاشٍ واحد.** `app/home.css:53-71` يعرّف **8 حركات مفتاحية مُسمّاة** (`hero-rise`، `hero-rule`، `hero-art-in-ltr`، `hero-art-in-rtl`، `hero-bloom`، `he-drift`، `he-spin`، `he-pulse`) ويُتابع 8 عناصر عبر `--d` من 0 إلى 520 مللي ثانية (`page.tsx:535-565`؛ CSS `home.css:67-71`). كلمة «variants» هنا تعني **حركات مفتاحية مُسمّاة + نسخة خاصة بـ RTL**، لا متغيّرات Framer Motion — وهذا يستحق التصريح. تغطية تقليل الحركة كاملة: أصناف البطل الثمانية موجودة في `@media (prefers-reduced-motion)` (`home.css:246-259`) **و** في حواجز `.reduce-motion` / `[data-art='off']` (`:260-273`)، إضافة إلى المفتاح العام (`globals.css:146`).
- **محتوى SEO موصول وجوهري فعلاً.** مُستورد في `page.tsx:8` ومُظهَر في `page.tsx:632` قبل الدعوة الأخيرة. `components/home/SEOContent.tsx:192-243` يعرض قسماً تحريرياً كاملاً: 3 فصول ثنائية اللغة طويلة (`:47-90`) تجيب عن استفسارات حقيقية (وكيل برمجة محلي أولاً، BYOK، الخصوصية مع MCP، مساعد برمجة عربي)، إضافة إلى 4 أسئلة `<details>/<summary>` أصلية (`:95-136, 228-239`). نحو 16 كيلوبايت نثر مؤلّف، ليس حشو كلمات. أصنافه مُنسّقة فعلاً (`globals.css:109-133`). لا يُدخل حركة جديدة، لذا يغطيه المفتاح العام.
- **البيانات المهيكلة للأسئلة موجودة وتطابق النص المعروض.** `app/layout.tsx:52-80` يعرّف 4 `FAQ_ENTRIES` ويحوّلها إلى `FAQPage` بـ `mainEntity` و`Question`/`acceptedAnswer`، ويُصدرها ككتلة `application/ld+json` ثانية (`:169-174`) بجوار كتلة `SoftwareApplication` المُحسّنة (`:20-47, 163-168`). البيانات الوصفية نالت كلمات مفتاحية إنجليزية وعربية و`isAccessibleForFree`/`featureList` (`:13-15, 31-39, 87-110`).

### الحكم بلا مواربة

- **الوميض الفني: محتمل، غير مُثبت.** الهندسة والكوريوغرافيا حقيقية ومفصّلة أكثر من المعتاد لبطل صفحة — أي أنها **أكثر من مجرد كود**. لكنني **لم أفتح متصفحاً ولم ألتقط صورة**. لا أستطيع الجزم بأن الأخضر الليموني على الفحمي في `home.css:38-42` يبدو فاخراً أم كرسم جهاز، ولا أن الدخول الذي يستغرق ~1.36 ثانية (`home.css:57`) يبدو واثقاً أم بطيئاً، ولا أن طبقة `feTurbulence` (`page.tsx:324-328, 424-425`) أنيقة أم مجرد تكلفة رسم، ولا أن بقاء اللوحة داكنة في الوضع الفاتح (`home.css:31-42`) قصد تباين أم كسر للثيم. **المصدر ≠ البكسلات. لا أدّعي أن البكسلات جميلة.**
- **SEO: محتوى حقيقي، مع تحفّظات بنيوية.** النص صادق وموجّه للاستفسارات، وJSON-LD موجود في HTML المبني. لكن الموقع المنشور لا يقدّمه، وJSON-LD بالإنجليزية بينما العرض الافتراضي عربي، ولا يوجد `hreflang`، والـ canonical يشير إلى نطاق آخر. هذه فجوات حقيقية، مفصّلة أدناه.

### الفجوات الدقيقة — للأب

1. **النشر الحيّ قديم (العائق الصلب الوحيد).** `https://sadeem-website-theta.vercel.app/` يعيد HTTP 200 بصفحة **الجولة السابقة**: `<title>SADEEM — The agent that grows with you</title>`، `<h1>` واحد، 5 `<section>`، **صفر `<details>`**، وكتلة JSON-LD واحدة (`SoftwareApplication` فقط). الغائب من HTML الحيّ: `he-svg` و`NEURAL CORE` و`hero-enter` و`id="guide"` و`FAQPage` و`acceptedAnswer` ونص السؤال و`الدليل الصادق`. هذه هي إعادة التصميم التي وصفها `HOMEPAGE-REDESIGN.md` السابق بأنها قديمة — جرى نشرها منذئذ، لكن جولة الوميض+SEO هذه **لم تُنشر بعد**. **على الأب إعادة النشر.** الدليل قوي على أن البناء سليم: `.next/server/app/index.html` (77,230 بايت) يحوي `he-svg` و`NEURAL CORE` و`hero-enter` و`--d:` و`id="guide"` و`seo-title` و`FAQPage` و`acceptedAnswer` ونص السؤال والنصوص العربية `الدليل الصادق`/`كيف يعمل فعلاً` و**6** `<section>` و**4** `<details>` و`<h1>` واحد وكتلتي ld+json. المصدر والبناء انتهيا؛ ينقص النشر فقط.
2. **لغة JSON-LD ≠ لغة العرض الافتراضية.** `app/layout.tsx:52-69` يخزّن أسئلة إنجليزية؛ `app/layout.tsx:159` يعرض `lang="ar" dir="rtl"` و`SEOContent.tsx:30-37, 56-135` يُظهر العربية افتراضياً. النص الإنجليزي موجود في DOM داخل `<script type="application/ld+json">` فقط، لا في نسخة مرئية قبل تبديل اللغة عميلاً. قاعدة Google «البيانات المهيكلة يجب أن تطابق المحتوى المرئي» مهددة. الحل: أصدر `FAQPage` عربياً (أو الاثنين مع نص مرئي مطابق).
3. **لا `hreflang` رغم ثنائية اللغة.** `app/layout.tsx:82-151` يضبط `openGraph.locale: 'ar_SA'` و`alternateLocale: ['en_US']` لكن بلا `alternates.languages`. اللغتان على عنوان واحد خلف مفتاح عميل (`lib/i18n.tsx`)، لذا يفهرس الزاحف العربية الافتراضية فقط — وقد تُهمَل الكلمات الإنجليزية في `layout.tsx:91-105`.
4. **الـ canonical يشير إلى نطاق آخر.** `app/layout.tsx:83` `metadataBase` و`:115` `alternates: { canonical: '/' }` يُحلّان إلى `https://sadeem-ai.com/` (`lib/site.ts:8`) بينما المضيف الحيّ `sadeem-website-theta.vercel.app`. إن لم يكن نطاق الـ canonical يخدم هذا المحتوى بعد، فهذه إشارة مضلّلة.
5. **استدعاءات غير آمنة للترطيب خارج نطاق الصفحة (تحذير، لا علاقة له بالعقد).** `app/auth/page.tsx:66` `Date.now()` و`app/sitemap.ts:24` `new Date()`. لا يقعان في مسار الصفحة الرئيسية؛ كود عرض الصفحة نظيف (`page.tsx` و`SEOContent.tsx` بلا أي `Math.random`/`Date.now`/`new Date`/`performance.now`).
6. **بقايا من الجولة السابقة (تحذير).** `demo-sec` ما زال في `app/page.tsx:448` / `app/home.css:76`؛ `proof-sec` ما زال صنفاً ميتاً بلا تنسيق في `app/page.tsx:614`. ليست تراجعات من S1/S2/S3.
7. **المصدر ≠ البكسلات (الحد الصادق).** لا صورة، لا جلسة متصفح، لا تدقيق تباين، لا فحص أداء رسم على جهاز ضعيف. الفقرات السابقة أقوال عن **الكود**، لا عن الشكل. تحقّق بصرياً قبل أن تسمّيه «وميضاً».

### رموز الخروج (هذه اللقطة)

| الأمر | الرمز | النتيجة |
|---|---|---|
| `node tests-homepage-seo.mjs` | **0** | 8 نجاح / 0 فشل / 1 تحذير |
| `node tests-homepage-seo.mjs --live` | **0** | 8 نجاح / 0 فشل / 2 تحذير — النشر القديم تحذير بالتصميم؛ الحارس لا يُفشل التشغيل بسبب تأخر النشر |
| `npx tsc --noEmit` | **0** | نظيف |
| `npm run build` | **0** | Next 16.4.6 / Turbopack، 10 صفحات ثابتة، خطوة TypeScript نظيفة |
| `node tests-homepage.mjs` (انحدار) | **0** | 13 نجاح / 0 فشل / 2 تحذير |

بعد إعادة النشر من قِبل الأب، أعد تشغيل `node tests-homepage-seo.mjs --live` وتوقّع أن يتحوّل `LIVE-1` إلى PASS مع `FAQ-LD=true FAQtext=true #guide=true engraving=true`.
