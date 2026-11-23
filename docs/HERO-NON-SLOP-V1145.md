# HERO NON-SLOP v11.45
## الهيرو غير مبتذل — توثيق التعديلات البصرية

> نطاق الملكية (ownership): `website/app/home.css`, `website/app/hero-panels.css`,
> وبنية JSX/الـ CSS class داخل `HeroMosaic()` فقط في `website/app/page.tsx`.
> لم ألمس النصوص (ال-copywriters يملكونها)، ولم ألمس `art-motion.css` (ملك R5)،
> ولم أستورد مكوّنات R3. كل الأرقام أدناه هي `file:line` وقت الكتابة؛
> الـ anchors النصية مذكورة أيضاً حتى لا تنكسر الإحالة إذا تغيّرت الأسطر.

Scope: only the three owned visual files. No prose was written or changed;
`art-motion.css` (R5) and R3's interactive components were not touched or imported.

---

## 1 — ما تغيّر / What changed

### أ. هرم طباعي واحد، لا قالب مركّز عادي / one typographic hierarchy
- `website/app/home.css:22-27` — `.hero` يضيف `overflow:hidden` حتى يظلّ قرص القياس
  داخل القسم بلا شريط تمرير أفقي. الخلفية/النص ما زالا `var(--hm-canvas,var(--bg))`
  و `var(--ink)` (عقد الوضعين اللامع/الداكن محفوظ).
- `website/app/home.css:34` — `.hero-copy{position:relative;z-index:2;…text-align:center}`
  النص يبقى فوق القرص في ترتيب الرسم (stacking).
- `website/app/home.css:42-51` — `.hero-title`: `clamp(52px,8.4vw,124px)`،
  `line-height:.9`، `letter-spacing:-.042em`، `font-optical-sizing:auto`،
  `font-variation-settings:'opsz' 96`، `font-feature-settings:'kern' 1,'liga' 1`،
  `text-wrap:balance`. ضبط بصري دقيق للخط، لا مظهر الخط الافتراضي على الويب.
- `website/app/home.css:69` — `.hero-art{position:relative;z-index:0}` يخلق طبقة
  القرص خلف النص؛ `website/app/home.css:71` — `.hero-mat` يحصل على
  `padding-inline:clamp(28px,4vw,58px)` ليوجد هوامش حقيقية للبيانات الوصفية.

### ب. نظام مساطر 1px يرسم مرة واحدة / a 1px rule system that draws once
- `website/app/home.css:91-96` — `.hm-rule`, `.hm-rule--head/--foot`,
  `@keyframes hm45-rule-draw` (scaleX من اليسار). الحالة النهائية هي الافتراضية؛
  `html[data-js='1']` فقط يعيد تشغيل الرسم، فلا JS = خطوط كاملة.
- `website/app/page.tsx:423-425` و `website/app/page.tsx:789-790` — المسطرة
  العلوية والسفلية داخل `HeroMosaic()`، مع `--rule-at` مشتق من نفس الإيقاع.

### ج. قرص المعايرة — العنصر التوقيعي / the signature calibration dial
- `website/app/page.tsx:392-411` — SVG نقي: حلقتان + **145 خطّاً**، واحد لكل أداة
  حقيقية في SADEEM. `145 = 5 × 29`، لذلك كل 29 خطّاً تقسيم رئيسي وكل 5 تقسيم
  فرعي؛ الإحداثيات مشتقة من `i` ( لا `Math.random` / `Date` ) فالـ hydration آمن.
- `website/app/home.css:103-124` — `.hm-dial` بموضع
  `inset-block-start:-604px` خلف عنوان السيرف والموسايك، بعرض `min(1080px,108vw)`،
  `stroke:currentColor` عبر `var(--line-strong)`، والخطوط الرئيسية بلون `var(--accent)`.
  `hm45-dial-draw` + `hm45-tick-draw` يرسمان مرة، ثم `hm45-dial-breath` يتنفّس
  ببطء على `calc(var(--art-cadence,2.8s) * 9)`. لا صورة، لا gradient، لا glow، لا filter.
- `website/app/page.tsx:414-420` + `website/app/home.css:144-152` — مسطرة Mono
  رأسية في كل هامش (`145`, `1:1`, `01—06`, `400ms`) بنمط الرسم التقني السويسري،
  `writing-mode:vertical-rl`، أرقام `tabular-nums`، بلا كلمات دعائية.

### د. مسار الإشارة / signal path
- `website/app/page.tsx:428-441` — SVG بمسار واحد دقيق يمرّ عبر أربع عُقد:
  prompt → tools → output، بـ `pathLength={1000}` و `vector-effect:non-scaling-stroke`.
- `website/app/home.css:127-141` — `.hm-signal-live` يرسم بمقطوعة `34 966` في
  `hm45-signal-trace` مرة واحدة، ثم العُقد تضيء تباعاً بـ `--n` (مشتق من index).

### هـ. موسايك بلا شبكة بطاقات / mosaic, not a card grid
- `website/app/home.css:154-158` — `.hm-scene`: شبكة 12 عموداً + **ثلاثة صفوف
  بأحجام مختلفة** (`258px / 176px / 56px`)، gap 12px، `direction:ltr`.
- `website/app/home.css:176-181` — Desktop يحتلّ 6 أعمدة × صفّين، المحرر/الطرفية
  4 أعمدة، CLI/الهاتف 3 أعمدة، الجدولة نصف الصف الأخير. تدرّج واضح في الحجم،
  لا شبكة متطابقة، بلا زوايا دائرية على اللوحات، بلا خلفيات ملوّنة، بلا صف أزرار أخضر.
- `website/app/page.tsx:783-787` + `website/app/home.css:160-166` — الخلية السابعة
  `hm-gauge`: فراغ مقصود بمقياس 29 شعبة (5 × 29 = 145) بدمج بطاقة إضافية.
- `website/app/home.css:262-279` — انهيار منسّق: 6 أعمدة عند 900px، عمود واحد
  عند 560px، مع تصغير القرص وإخفاء المساطر على الشاشات الصغيرة.

### و. زر الزائد — هندسة دقيقة، بلا تراكب / the `+` button, precisely
- **السبب الجذري:** `.hpx-attach-pop` و `.hpx-click` كانا `position:absolute` داخل
  `.hpx-plus` غير الموضّع، فكان أقرب سلف موضعّ هو `.hpx-composer-card`: القائمة
  تفتح فوق كامل الكومبوزر و"النقرة" تحدث في منتصف الكارد لا على الزر.
- `website/app/hero-panels.css:132-136` — `.hpx-plus,.hpx-send{position:relative}`
  يجعل الـ 13×13px box هو المرجع لكليهما (نفس الـ box الذي تقيسه الدالة).
- `website/app/hero-panels.css:164-167` — القائمة تفتح `calc(100% + 5px)` فوق الزر،
  بمحاذاة `inset-inline-start:-1px`، فلا تغطي الزر ولا ترتجف.
- `website/app/hero-panels.css:194-206` — توقيت واحد على ساعة الـ 7s:
  الوصول 18% (1260ms) → سكون حقيقي حتى 30% (2100ms) → حلقة النقر 1720ms →
  القائمة 25.7→29.4% (1800→2062ms) **بينما المؤشّر ما زال واقفاً على +**.
  المؤشّر يغادر نحو الحقل بعد 30% فقط، أي بعد إغلاق القائمة: صفر تراكب بصري.
- `website/app/hero-panels.css:375-379` — تصحيح بصري `-1px` لموضع طرف المؤشّر
  (الطرف عند 1.2/1.4 في viewBox 20×24 ≈ 0.72/0.88px بعد التحجيم).
- `website/app/hero-panels.css:391-407` — مسار المؤشّر الوحيد: اقتراب، سكون،
  نقر، عودة للحقل، نقرتا كتابة، ثم Send وركن هادئ. keyframe واحد فقط (P11).

#### التحقق الحسابي لمساحة الإحداثيات / source-math verification
`website/app/page.tsx:320-349`:

```
الابن position:absolute داخل .hm-desktop{position:relative}
أصل التموضع = padding box        = (rect.left + clientLeft, rect.top + clientTop)
getBoundingClientRect()          = border box (viewport px)
clientLeft / clientTop           = 1px  (حدّ الـ hairline في .hm-panel)
⇒ --hm-c-<name>-x = round(target.left + target.width/2 − ox)
⇒ --hm-c-<name>-y = round(target.top  + target.height/2 − oy)
```
الهدف `${name}` هو `.hpx-compose-input`, `.hpx-plus`, `.hpx-send`. بما أنّ
اللوحة والأهداف يشتركان في نفس تحويلات الأسلاف، الفروق تلغي أي translate
مؤقت. `website/app/page.tsx:351-353` يعيد القياس على أول إطار وبعد استقرار
الخطوط (`document.fonts.ready`)؛ بلا عشوائية وبلا Date.

---

## 2 — ما اقتبسناه من بحث المنافسين / applied design research
(من `docs/DESIGN-BENCHMARKS-V1145.md` و `docs/design-refs/OBSERVATIONS.md`)

| المرجع | ما التقطناه | أين ظهر في ملفاتي |
|---|---|---|
| Zed | شبكة قياس 1px بعلامات على الهوامش | قرص 145 تيك + مساطر `home.css:103-152` |
| Cursor / Claude | واجهة المنتج الحقيقية هي العمل الفني؛ حركة قليلة وخط سيري واحد | الموسايك كما هو + تكبير السيرف `home.css:42-51`، بلا ظلال ملوّنة (ممنوعة بالـ guards أصلاً) |
| OpenCode | شريط تنقّل مُرقّم بلا أيقونات زائدة | `DEMO.nav` في Desktop كما هو، لم أستبدله |
| Kilo | طباعة شبحية للعلامة نفسها فقط | لم أنسخها؛ `hm-gauge` فراغ مقاس بدل نص شبحي |
| الجميع | قالب "هيرو مركّز + 3 بطاقات" مرفوض | حافظنا على التراتب الطباعي + الموسايك غير المتماثل + القرص |

القرص أصلي لسديم: 145 تساوي عدد الأدوات الحقيقية، لا رقم تسويقي، ولا مقياسًا
مقلّدًا من OpenCode، ولا لافتة وعود من Kilo.

---

## 3 — الحركة وإيقافها / motion & kill switches
- كل الحركات الجديدة تحمل البادئة `hm45-` (لا تضارب أسماء keyframes مع 13 ورقة CSS).
- `website/app/home.css:453-472` — `@media (prefers-reduced-motion:reduce)`،
  `html.reduce-motion` و `html[data-art='off']` توقف المساطر/القرص/المسار وتجعل
  حالتها النهائية مرئية (`stroke-dashoffset:0`, `transform:none`, `opacity:1`).
- `website/app/hero-panels.css:458-488` — نفس المفاتيح الثلاثة تخفي المؤشّر وتُبقي
  القائمة مقروءة؛ `hpx-cursor{display:none!important}` محفوظ حرفياً (P15).

---

## 4 — التحقق / Verification

```
cd website && npx tsc --noEmit          → PASS (no output)
cd website && npm run build             → PASS (Next 16.4.6, 14 static routes)
node tests-v1141-hero-mosaic.mjs        → 18 PASS / 0 FAIL
node tests-v1142-hero-panels.mjs        → 20 PASS / 0 FAIL
node tests-v1142-hero-light.mjs         → 15 PASS / 0 FAIL
node tests-v1141-hero-visual.mjs        → 18 PASS / 1 FAIL  (F3 — outside my scope)
```

> **ملاحظة تنسيقية / coordination note:** الفحص `F3` في `tests-v1141-hero-visual.mjs`
> يفشل على `website/app/page.tsx:170` (نص قسم المزايا، كلمة `Markdown` داخل جملة
> عربية). هذا سطر نثر يملكه الـ copywriters، وقد ظهر أثناء عمل متوازٍ بعد أن كان
> الفحص أخضر في خط الأساس؛ لم أعدّله احتراماً للنطاق. التصحيح المطلوب من مالك النص:
> استبدل `Markdown` بـ `md` (أو أضف `markdown` إلى WHITELIST في الفحص إن رُئي ذلك).
> كل فحوص الهيرو البصرية الأخرى (A1–F2, F4) خضراء، وحكم المؤسس في ذلك الفحص PASS.

> Coordination note (EN): the only red check is F3's single-language rule on a
> prose string in the BENEFITS section (`page.tsx:170`, `Markdown` inside Arabic).
> It is owned by the copywriters and appeared via a concurrent edit after the
> baseline run — I deliberately did not touch it. All 18 hero visual checks
> (A1–F2, F4) pass, and the guard's founder verdict is PASS.
