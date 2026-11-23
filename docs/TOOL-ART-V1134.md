# TOOL / AGENT ART — V11.34 VERIFICATION GUARD

**Scope:** verification only. This subagent wrote `tests/v1134-art-guard.test.mjs` and this report. **No application source was changed.**

**Run:** `node --test --test-force-exit tests/v1134-art-guard.test.mjs` → **11/11 pass**, **8 dirty findings** reported with exact `file:line`.

---

## ENGLISH

### Blunt verdict

> **Are the tool rows actually elegant now? YES.**
> They are genuine hairline instrument rows: no box, no green button, no dense table — one 1px ink rail, one line-art glyph, one mono caps verb, one status pip, and a one-shot ink draw. This is the cleanest the tool surface has ever looked.
>
> **Are the agent cards elegant too? NO — not yet.**
> The orbit itself is beautiful (exact trigonometry, two 1px rings, real status dots). But the wrapper around it is *still a rounded 10px filled box with a physical 2px left rail*, and the node placement still uses physical `left/top`. That is a leftover of the old "everything in a box" language sitting right on top of the new instrument grammar.
>
> So the honest overall answer is: **tool presentation = yes, elegant. Agent presentation = half-converted.** Do not call the redesign finished until `subagents.css §13` is de-boxed.

### What the test proves (source + CSS, exact hooks)

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1a | No border box around tool rows | **PASS** | `console.css` `.chat-panel-root .tl2-card` = `border:0 !important`, `border-radius:0 !important`, `background:none !important`, `box-shadow:none !important`, `transform:none !important`; hover/focus also `background:none`. `chat-final.css §11` re-locks result rows and the error explainer to no fill. |
| 1b | One 1px baseline | **PASS** | `console.css` `.tl2-card::before` — `width:1px`, `border:0`, token `color-mix`, `inset-inline-start:0`; a second 1px completion rail draws once via `chat-art.css §3`. |
| 1c | Line-art glyph present | **PASS** | `MessageView` renders `<StoryGlyph>`; `tool-story.css §1` draws it as `12px` SVG with `vector-effect:non-scaling-stroke`; `.sc18-tico` is freed from its chip (`border:0/background:none/box-shadow:none`). |
| 1d | Tabular mono labels | **PASS** | `console.css §4` `.sc18-tverb` = `var(--font-mono-x)` + `tabular-nums`; `tool-story.css §10d` puts every receipt in one `tnum` rhythm. |
| 1e | Status pip + one-shot draw | **PASS** | `tool-story.css §10b` 4px verdict pip (`--ok`/`--bad`, never colour alone). Draws use `both` fill and **no `infinite`**: `sc-left-draw 420ms`, `art-calibration 2.2s`, `tsg-glyph-draw 380ms`, `ts-verb-underline 460ms`, `mv-bloom-ink 440ms`. |
| 2 | Agent orbital / 1px grammar | **PARTIAL** | `AgentTeamCard.tsx` solves the orbit exactly (`R ≥ (D+2)/(2·sin(π/n))`, `θ=−π/2+i·2π/n`), `subagents.css` draws a 1px guide ring + 1px dashed sweep + status dots. **But** `.agt-card` is still a rounded, filled box with a physical 2px border-left — see D1/D2. |
| 3a | Animations preserved | **PASS** | Spinning circle `ThinkOrbit` + `animateTransform` (`StreamTimeline`) and `@keyframes art-orbit`; ink flow `art-ink-flow` / `craft-ink-flow`; bloom `mv-bloom-ink` + `<ToolBloom>` mounted only on real `status==='done'`. |
| 3b | Both reduced-motion guards | **PASS** | `@media (prefers-reduced-motion: reduce)` **and** `html.reduce-motion` in all five art sheets (chat-art, tool-story, chat-final, stream-motion, subagents), each with `animation:none !important` + static end states. |
| 3c | RTL-safe | **PARTIAL** | Tool sheets are fully logical (`inset-inline-*`, `border-block-start`, `tsg-glyph-draw-rtl`, no physical side declarations). The agent card is not: physical `left/top/right/bottom` — see D2. |
| 3d | Palette unchanged | **PASS** | **Zero hex literals** in all five art sheets; every hue is a token or `color-mix(in srgb, …)` / `currentColor`. |
| 4 | Dirty patterns reported | **REPORT** | 8 findings below. No per-event green CTA and no ARGUMENTS/PATH/CONTENT table remain in the tool row. |

### Dirty findings (still present — diagnosis only)

| ID | Location | Finding |
|---|---|---|
| **D1** | `src/components/subagents.css:13–27` | The inline agent card still wears `border:1px solid`, `border-radius:10px`, `background:var(--bg3)` and a **physical** `border-left:2px` for running/done/error. This is exactly the boxed language V9 was meant to remove. De-box it down to the same 1px rail as `.tl2-card`, use a logical 1px `border-inline-start`, and drop the radius/fill. |
| **D2** | `src/components/AgentTeamCard.tsx:130–136`, `subagents.css:135` | Node centres are set with physical `left/top`; the status dot uses `right/bottom`. Under RTL the orbit does not mirror. Use `inset-inline-start`/`inset-block-start` (or `translate`) instead. |
| **D3** | `src/components/MessageView.tsx:2038` | `ResultRow` still prints the tool output in a raw `<pre>` — 6 lines by default, expandable. It is clamped, hairline-underlined and error-tinted, but it is still raw text in the default view. The v11.34 image path (`:2034–2035`) is the clean counterexample: bitmaps never hit a `<pre>`. |
| **D4** | `src/components/MessageView.tsx:2149`, `:2212` | Multi-line / object arguments render a mini `<pre>` inside the **opt-in** drawer. Acceptable as a drill-down, not as an instrument row. |
| **D5** | `src/components/AgentTeamCard.tsx:290` | Specialist output drawer still prints raw text in `<pre>` behind a toggle. |
| **D6** | `src/components/chat.css:2220` | `.chat-empty-cta` — one green-ish CTA class survives, but it is a single empty-state control, **not** a per-event button. Audit only if the founder wants zero CTAs anywhere. |
| **D7** | `src/components/chat.css:1028` | Legacy `.tl2-pill.is-ok` 10% green fill still exists in source; neutralized by the `!important` no-box cascade in `console.css`, so it does not render. Dead weight, not a visible violation. |
| **D8** | `src/components/MessageView.tsx:3067` | A localized `Arguments` drawer header remains. It heads a structured key/value **list**, not an ARGUMENTS/PATH/CONTENT table — the old raw-JSON leak is documented dead at `chat.css:857`. |

### Honest summary

The founder's screenshot law ("everything inside a box") is **honoured on the tool rows** and **broken on the agent card wrapper**. The three "dirty" categories called out in the brief resolve as follows: **green CTA per event — gone** (one-shot error link is a 1px underline); **ARGUMENTS/PATH/CONTENT tables — gone** (structured list only); **raw code blocks — reduced but not gone** (clamped `<pre>` in result + opt-in drawers). If the verdict must be one word for the whole surface: **almost**.

---

## العربية

### الحكم بصراحة

> **هل صفوف الأدوات أنيقة الآن؟ نعم.**
> إنها صفوف أدوات حقيقية بخطوط شعرية دقيقة: بلا مربع، بلا زر أخضر، بلا جدول مزدحم — قاعدة حبر واحدة بعرض 1px، ورمز خطّي واحد، وفعل بخط أحادي الحجم، ونقطة حالة، ورسم حبر لمرة واحدة. هذه أنظف صورة وصلت إليها واجهة الأدوات.
>
> **هل بطاقات الوكلاء أنيقة أيضاً؟ لا — بعد.**
> المدار نفسه جميل (هندسة مثلثية دقيقة، حلقتان بعرض 1px، نقاط حالة حقيقية). لكن الغلاف المحيط به **ما زال مربعاً بزوايا 10px وخلفية مصمتة وحافة فيزيائية بعرض 2px من اليسار**، كما أن تموضع العقد ما زال يستخدم `left/top` الفيزيائية. هذا بقايا لغة «كل شيء داخل مربع» جالسة فوق قواعد الأدوات الجديدة.
>
> الخلاصة الصادقة: **عرض الأدوات = نعم، أنيق. عرض الوكلاء = مكتمل نصفه.** لا يُعلَن انتهاء إعادة التصميم قبل إزالة الصندوق من `subagents.css §13`.

### ما يثبته الاختبار (المصدر + CSS)

| # | المطلوب | النتيجة | الدليل |
|---|---|---|---|
| 1أ | لا صندوق حول صف الأداة | **نجح** | `console.css` للعنصر `.tl2-card`: `border:0` و`border-radius:0` و`background:none` و`box-shadow:none` و`transform:none` — وحتى عند التحويم. `chat-final.css §11` يعيد تثبيت صفوف النتائج بلا خلفية. |
| 1ب | خط أساس واحد بعرض 1px | **نجح** | `.tl2-card::before` بعرض `1px` و`border:0` ولون من الرموز، مع خط إكمال ثانٍ بعرض 1px يُرسم مرة واحدة. |
| 1ج | رمز خطّي حاضر | **نجح** | `MessageView` يعرض `<StoryGlyph>` و`tool-story.css §1` يرسمه SVG بضربة `1px` ثابتة، بلا شريحة مربعة. |
| 1د | تسميات أحادية بتباعد جدولي | **نجح** | `.sc18-tverb` يستخدم `var(--font-mono-x)` مع `tabular-nums`، وكل الأرقام في إيقاع `tnum` واحد. |
| 1هـ | نقطة حالة ورسم لمرة واحدة | **نجح** | نقطة `4px` بلون الحكم (`--ok`/`--bad`)؛ كل الرسوم تستخدم `both` **وبلا `infinite`**. |
| 2 | وكلاء بمدار وقواعد 1px | **جزئي** | `AgentTeamCard.tsx` يحسب المدار ضربياً بدقة (`θ=−π/2+i·2π/n`) و`subagents.css` يرسم حلقة إرشادية 1px وحلقة متحركة 1px. **لكن** `.agt-card` ما زال مربعاً مصمتاً بحافة `2px` فيزيائية — انظر D1/D2. |
| 3أ | الرسوم محفوظة | **نجح** | الدائرة الدوّارة `ThinkOrbit`، وتدفّق الحبر `art-ink-flow`/`craft-ink-flow`، والازدهار `mv-bloom-ink` مع `<ToolBloom>` عند اكتمال حقيقي فقط. |
| 3ب | حاجزا تقليل الحركة | **نجح** | `@media (prefers-reduced-motion: reduce)` **و** `html.reduce-motion` في كل ملفات الفن الخمسة، مع حالات سكون نهائية. |
| 3ج | آمن للـ RTL | **جزئي** | ملفات الأدوات تستخدم خصائص منطقية بالكامل (`inset-inline-*`، `border-block-start`) بلا جهات فيزيائية؛ بطاقة الوكلاء تستخدم `left/top/right/bottom` — انظر D2. |
| 3د | اللوحة لم تتغير | **نجح** | **صفر قيم سداسية عشرية** في ملفات الفن؛ كل لون رمز أو `color-mix`/`currentColor`. |
| 4 | الإبلاغ عن الأنماط القذرة | **تقرير** | 8 ملاحظات أدناه. لا زر أخضر لكل حدث ولا جدول ARGUMENTS/PATH/CONTENT في صف الأداة. |

### الملاحظات القذرة (ما زالت موجودة — تشخيص فقط)

| المعرّف | الموقع | الملاحظة |
|---|---|---|
| **D1** | `subagents.css:13–27` | بطاقة الوكلاء ما زالت `border:1px` و`border-radius:10px` و`background:var(--bg3)` مع `border-left:2px` فيزيائي للحالات. المطلوب: تقليلها إلى قاعدة 1px مثل `.tl2-card`، وحافة منطقية `border-inline-start` بعرض 1px، وإزالة الزوايا والخلفية. |
| **D2** | `AgentTeamCard.tsx:130–136`، `subagents.css:135` | مراكز العقد تُضبط بـ `left/top` ونقطة الحالة بـ `right/bottom`؛ المدار لا ينعكس في RTL. استخدم `inset-inline-start`/`inset-block-start`. |
| **D3** | `MessageView.tsx:2038` | نتيجة الأداة ما زالت تظهر في `<pre>` خام — 6 أسطر افتراضياً. مقيّدة ومُخطّطة، لكنها نص خام في العرض الافتراضي. مسار الصور في v11.34 هو المثال النظيف: الصور لا تمرّ على `<pre>`. |
| **D4** | `MessageView.tsx:2149`، `:2212` | الوسائط متعددة الأسطر/الكائنات تظهر في `<pre>` مصغّر داخل الدرج الاختياري — مقبول كتفصيل، لا كصف أدوات. |
| **D5** | `AgentTeamCard.tsx:290` | مخرجات الوكلاء تُطبع كنص خام في `<pre>` خلف زر التبديل. |
| **D6** | `chat.css:2220` | صنف `.chat-empty-cta` ما زال موجوداً، لكنه زر حالة فارغة واحد، **ليس** زراً لكل حدث. يُراجع فقط إن أُريد صفر أزرار. |
| **D7** | `chat.css:1028` | خلفية خضراء 10% قديمة لـ `.tl2-pill.is-ok` ما زالت في المصدر لكنها مُلغاة بـ `!important` في `console.css` — لا تظهر فعلياً. |
| **D8** | `MessageView.tsx:3067` | عنوان درج `Arguments` مترجم ما زال موجوداً، لكنه يعلو **قائمة** مفتاح/قيمة منظّمة لا جدول ARGUMENTS/PATH/CONTENT؛ التسريب القديم مُوثَّق كمنتهٍ في `chat.css:857`. |

### الخلاصة

قانون لقطة الشاشة («كل شيء داخل مربع») **مُحترَم في صفوف الأدوات** و**مُخترَق في غلاف بطاقة الوكلاء**. أما الأنماط الثلاثة التي طُلب فحصها: **الزر الأخضر لكل حدث — اختفى** (رابط الخطأ أصبح تحتها خط رفيع)؛ **جداول ARGUMENTS/PATH/CONTENT — اختفت** (قائمة منظّمة فقط)؛ **كتل الكود الخام — قلّت لكنها لم تختفِ** (`<pre>` مقيّد في النتيجة والأدراج). إن لزم حكم بكلمة واحدة عن الواجهة كلها: **تقريباً**.
