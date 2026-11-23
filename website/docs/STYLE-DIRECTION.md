# STYLE DIRECTION — Lime on Charcoal
# الاتجاه البصري — ليمون على الفحم

> **النطاق / Scope:** `website/app/globals.css` (رموز وأدوات فقط) + هذا المستند.
> لم يُلمس مصدر تطبيق سطح المكتب، ولم يُلمس `electron-builder.yml`، ولم تُغيّر بنية أي صفحة.
> **Scope:** `website/app/globals.css` (tokens/utilities only) + this document.
> No Electron app source was touched, `electron-builder.yml` was not touched, and no page structure changed.

---

## 0. الحكم بصراحة — Blunt verdict (AR then EN)

**عربي:** توليد الصور بالذكاء الاصطناعي **كان محجوباً خارجياً (بلا رصيد credits)**، لذلك لم أُنتج صورة واحدة. تعويضاً عن ذلك، تولّى وكيل آخر بطلة SVG غنية مصنوعة يدوياً (S1)، وتولّيت أنا — مدير الأسلوب — صياغة **نظام الألوان والأسلوب** نفسه: لوحة «ليمون على فحم، تحرير علمي» موحّدة، مع رموز جديدة للحبيبات والعمق الخالي من التوهج والغسيل الليموني المقيّد، وأدوات إضافية لقسمَي البطل وSEO. **كل السداسيات المعتمدة بقيت كما هي** — أضفتُ ولم أبدّل. هذا المستند هو تسليم «الاتجاه البصري المولّد بالذكاء الاصطناعي» بديلاً عن الصور.

**EN:** AI image generation was **credit-blocked externally** — not a single image was produced. In its place, a sibling subagent built the hand-crafted rich SVG hero (S1); as style director I authored the **colour + style system** itself: one cohesive "lime-on-charcoal, scientific editorial" palette, new tokens for grain / glow-free depth / restrained lime wash, and small additive utilities for the hero and SEO sections. **Every approved hex is unchanged** — I only added. This document is the "AI-generated style direction" deliverable standing in for images.

---

## 1. اللوحة — Palette

### 1.1 القيم المعتمدة (لم تُغيّر) / Approved values (unchanged)

| الرمز / Token | فاتح / Light | داكن / Dark | الدور / Role |
|---|---|---|---|
| `--bg` | `#F2F0E9` | `#0A0C0F` | الخلفية — ورق دافئ / فحم عميق · canvas — warm paper / deep charcoal |
| `--paper` | `#FAF8F2` | `#0D1015` | سطح الورق / الأسطح المرتفعة · paper surface / raised sheet |
| `--ink` | `#15130E` | `#EEF0E9` | الحبر — النص الأساسي · primary text |
| `--dim` / `--faint` | `#5E594E` / `#908A7D` | `#A4A9A0` / `#6E746B` | النص الثانوي والاطلالة · secondary text / annotations |
| `--accent` | `#4C7410` | `#B6F24A` | ليمون نصّي (داكن للورق، ساطع للفحم) · text accent |
| `--accent-fill` | `#98D83B` | `#98D83B` | ليمون التعبئة — الأزرار والتحديد · fill accent (shared) |
| `--line` | `rgba(21,19,14,.15)` | `rgba(238,240,233,.14)` | الشعر الدقيق · hairline |

**المنطق / Rationale (AR):** الليمون `#B6F24A` هو اللون الوحيد «المضيء» في الواجهة، ويظهر فقط على الفحم `#0A0C0F` حيث يبلغ تباينه ذروته؛ على الورق `#FAF8F2` نستخدم قريبه الداكن `#4C7410` للنص، ونحتفظ بـ `#98D83B` للتعبئة فقط (أزرار، تحديد، نقطة القياس). هذا يمنع «النيون» ويحافظ على طابع مجلة علمية مطبوعة.

**Rationale (EN):** Lime `#B6F24A` is the single "luminous" colour, and it appears only on charcoal `#0A0C0F` where its contrast peaks. On warm paper `#FAF8F2` its darker sibling `#4C7410` carries text, while `#98D83B` is reserved for fills (buttons, selection, the measurement dot). That keeps the neon out and preserves the feel of a printed scientific journal.

### 1.2 الرموز المضافة (مشتقة، بلا سداسيات جديدة) / Added tokens (derived, no new hexes)

| الرمز / Token | القيمة المشتقة / Derived value | الغرض / Purpose |
|---|---|---|
| `--lime-wash` | `color-mix(accent-fill 7% → paper)` (9% داكن) | غسيل ليموني مقبض لخلفية البطل/الإطارات · restrained hero/plate wash |
| `--lime-wash-strong` | `13%` (16% داكن) | تنوع «مرتفع» للإطار · lifted plate variant |
| `--lime-veil` | `color-mix(accent 12%, transparent)` (16% داكن) | طبقة لونية فوق الرسم · wash overlay |
| `--accent-hairline` | `color-mix(accent 42%, line)` (48% داكن) | شعر ليموني لأدوات القياس · accent-tinted hairline |
| `--depth-1/2/3` | شفة 1px + ظل محكم مشتق من `--ink`/`--bg` | عمق بلا توهج · glow-free depth |
| `--grain-size` | `180px` | حجم بلاطة الحبيبات المحلية · local grain tile |
| `--sci-grain-opacity` | `calc(--grain-opacity × 1.6)` | مطابقة الحبيبات داخل الإطار · in-frame grain match |
| `--cadence-fast/base/slow/rule` | `.24s / .55s / .85s / 1.15s` | إيقاع الحركة المشترك · shared motion cadence |
| `--sci-grid` | `48px` | خطوط الشبكة الدقيقة · precise graph grid |

الحبيبات العامة (`--grain-opacity`, `--grain-blend`) كانت موجودة أصلاً ويستهلكها العنصر `.ink-grain`؛ أضفتُ رمزي الحجم/الشفافية المحليين فقط.
The global grain tokens (`--grain-opacity`, `--grain-blend`) already existed and are consumed by `.ink-grain`; I added only the local size/opacity tokens.

---

## 2. الخطوط وسلم الأحجام — Type scale

العائلات الأربع ثابتة: **Instrument Serif** (العناوين)، **Inter** (اللاتيني)، **Cairo** (العربي)، **IBM Plex Mono** (القياسات والتسميات). لا خطوط جديدة.

Four families, no additions: **Instrument Serif** (display), **Inter** (Latin UI), **Cairo** (Arabic), **IBM Plex Mono** (instrumentation).

| الصنف / Role | اللاتيني / Latin | العربي / Arabic |
|---|---|---|
| `body` | 16px / 1.75 | 16px / 1.95 |
| `.display` | `clamp(52, 8.5vw, 124)` / .94, −.035em | `clamp(42, 7vw, 92)` / 1.18, 700 |
| `.h2` | `clamp(36, 5.4vw, 72)` / 1.02, −.025em | `clamp(32, 4.8vw, 60)` / 1.3, 700 |
| `.h3` | `clamp(24, 2.6vw, 36)` / 1.15 | `clamp(22, 2.4vw, 30)` / 1.5, 700 |
| `.lead` | `clamp(16, 1.4vw, 19)` / 1.8, max 60ch | نفس السطر، بلا مسافات حرفية |
| `.label` | mono 11px, .18em, uppercase | Cairo 12px, 600, بلا tracking |
| `.stat-num` | `clamp(38, 4.6vw, 64)` / 1 | `clamp(32, 4vw, 52)`, 700 |

**قاعدة عربية / Arabic rule:** لا `letter-spacing`، لا `em` مائل (يُعيَّن `font-style:normal`)، وارتفاع سطر أوسع. كل فئة لها تجاوز `html[lang='ar']` خاص بها.

---

## 3. الأدوات المضافة — Added utilities

كلها اختيارية (opt-in) وقابلة للتركيب، وتستخدم خصائص منطقية (logical properties) لتكون RTL-safe.

All are opt-in and composable, and use logical properties for RTL safety.

| الصنف / Class | الوظيفة / Function |
|---|---|
| `.sci-hero` | غلاف بطل بغسيل ليموني وشعر سفلي؛ المحتوى فوق الطبقة (`z-index:1`) |
| `.sci-frame` / `--lift` / `--flat` | إطار لوحة: حدّ 1px، غسيل، عمق 1/2، وخيار مسطّح بلا ظل |
| `.sci-frame__body` | المحتوى داخل الإطار (فوق الحبيبات والغسيل) |
| `.sci-grain` | حبيبات SVG محلية أحادية اللون، بلا ملف خارجي |
| `.sci-wash` / `--radial` | غسيل ليموني؛ الصيغة الشعاعية توقّف لوني واحد → شفاف، وتنعكس في RTL |
| `.sci-grid` | شبكة شعر دقيقة 1px من `--line-soft`، تتلاشى عند الحواف |
| `.sci-rule`, `.sci-index`, `.sci-readout` | فاصل ليموني، فهرس «FIG. 01» بخط أحادي، قراءة رقمية بتبويب ثابت |
| `.seo-prose`, `.seo-figure` | سطر قراءة 68ch لنصوص SEO، وشكل مع تسمية بالخط الأحادي |
| `.sci-sweep` | شعر ليموني يعبر الإطار مرة واحدة، باتجاه واعٍ لـ `dir` |

**لا تمويه على الأسطح الكبيرة / No blur on large surfaces:** هذه الأدوات لا تستخدم `backdrop-filter` إطلاقاً. التمويه الوحيد في الموقع هو شريط الهيدر الزجاجي الرفيع (`--nav-blur:12px`)، ولم يُوسَّع. الحبيبات SVG وليست تمويهاً.
**No clashing gradients:** `.sci-grid` يستخدم توقّفات `--line-soft` بشعر 1px فقط، و`.sci-wash--radial` لون واحد→شفاف. لا تدرّجات متعددة الألوان.

---

## 4. إيقاع الحركة — Motion cadence

المنحنى المشترك `cubic-bezier(.2,.72,.16,1)` (`--ease-art`). المدد: `.24s` للتفاعلات الدقيقة، `.55s` للظهور، `.85s` للكشف (`--art-dur`)، `1.15s` لرسم الشعر (`--art-rule-dur`)، و`1.4s` للمسحة الواحدة `.sci-sweep`. التأخير المتدرّج 90ms لكل عنصر (ink-reveal) و170ms في مشهد «شاهده يعمل».

Shared curve `cubic-bezier(.2,.72,.16,1)`; durations `.24s` micro, `.55s` reveal, `.85s` art, `1.15s` hairline, `1.4s` one-shot sweep. Stagger: 90ms/child (ink-reveal), 170ms/beat (demo).

**مفاتيح الإيقاف / Kill switches:** `@media (prefers-reduced-motion:reduce)`، و`html.reduce-motion`، و`html[data-art='off']`، و`html[data-cursor='off']`، و`forced-colors:active`. كل حركة جديدة تنتهي بحالة ساكنة مرئية (أو مخفية для `.sci-sweep`)؛ لا تبقى عناصر نصف شفافة أو مزاحة.

---

## 5. RTL وإمكانية القراءة — RTL & readability

- `layout.tsx` يضبط `lang="ar" dir="rtl"` افتراضياً؛ كل الأدوات الجديدة تستخدم `inset-inline`, `margin-inline`, `padding-inline`.
- `.sci-sweep` يقرأ `--sci-from/--sci-to` معكوسين في RTL؛ `.sci-wash--radial` ينعكس إلى `22%`.
- تباين النص يعتمد على سُلّم `--ink/--dim/--faint` المعتمد؛ الغسيل لا يتجاوز 16% من الورق، لذا لا يكسر الفصل بين المستويات.
- `forced-colors` يُخفي الزخارف ويُبقي المحتوى أصلياً.

---

## 6. التطبيق الإلكتروني ونفس الليمون — Electron & the same accent

> توثيق فقط — **لم أعدّل أي ملف من ملفات التطبيق.** / Documentation only — **no app file was edited.**

- `src/styles.css` يعرّف `--acc: #98D83B` (ليمون العلامة «الأعمق، الأقل نيوناً») كاللون المميز الوحيد عبر كل الثيمات، مع `--line-accent: rgba(152,216,59,.42)` و`--ok: #98D83B`.
- مفاتيح الثيمات (`obsidian`, `midnight`, `soft`, `ink`, `light`, `high`) ومفتاحات الليمون (`sage`, `teal`, `clay`, `amber`) **تبقى كما هي** حتى تحفظ إعدادات المستخدم؛ كل remap يعيد تعيين `--acc`/`--acc2` فقط.
- الخلفية الداكنة للتطبيق `#0A0E14` (قريبة جداً من charcoal الموقع `#0A0C0F`)، لذا يقرأ الليمون `#98D83B` في التطبيق كنظير `#B6F24A` في الموقع: **نفس العائلة، درجة أخفّ قليلاً في سطح سطح المكتب**.
- الخلاصة: `#98D83B` هو الجسر بين الموقع والتطبيق — تعبئة في الموقع، ولون مميز في التطبيق؛ و`#B6F24A` هو نسخة النص على الفحم حين يحتاج الموقع سطوعاً أعلى.

---

## 7. التحقق — Verification

- `cd website && npm run build` → نجح / passed.
- توازن الأقواس في `globals.css`: **304 مفتوحة / 304 مغلقة** (كانت 267/267 قبل الإضافة).
- لم تتغيّر أي قيمة سداسية معتمدة؛ كل الإضافات مشتقة عبر `color-mix()`.
- لم يُلمس `electron-builder.yml` ولا مصدر التطبيق ولا بنية الصفحات.

---

*ملاحظة أخيرة / Final note:* بما أن رصيد توليد الصور غير متاح، فهذا المستند + نظام الرموز + بطلة SVG اليدوية (S1) هي المادة البصرية المُسلَّمة؛ لا أدّعي وجود صور مولّدة بالذكاء الاصطناعي.
*Since image-generation credits are unavailable, this document + token system + the hand-crafted SVG hero (S1) are the delivered visual material; I do not claim any AI-generated images exist.*
