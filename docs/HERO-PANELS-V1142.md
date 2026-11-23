# HERO PANELS v11.42 — نسخة مصغّرة من التطبيق الحقيقي
# Hero panels — a faithful miniature of the real app

> طلب المؤسس: «الديسكتوب عند قسم الهيرو… زد تفاصيله والأنيميشن تبعته مثل اللي
> بالشاشة، إنه يكون نسخ لصق زي تطبيق سطح المكتب، مع أنيميشن وحركة للماوس.
> والإيديتور والسي ال آي كمان.»
>
> Founder: *"Make the hero's Desktop panel much more detailed, with the same
> animation as the app-mock — a copy of the desktop app, with mouse movement.
> The Editor and the CLI too."*

---

## 1 — النطاق / Scope

| ملف / File | التغيير / Change |
|---|---|
| `website/app/page.tsx` | `import './hero-panels.css'` (بعد `app-mock.css`)؛ دالة `useHeroPanelGeometry`؛ markup جديد للأقسام Desktop / Editor / CLI داخل `HeroMosaic()` فقط. |
| `website/app/hero-panels.css` | **ملف جديد** — كل التفاصيل والأنيميشن المقصورة على الأقسام الثلاثة. لم يُعدّل `home.css` (Z1 يملكه). |
| `tests-v1142-hero-panels.mjs` | **حارس جديد** — ٢٠ فحصاً للتفاصيل + المؤشر + كواتم الحركة. |
| `docs/HERO-PANELS-V1142.md` | هذا المستند / this document. |

لا تغيير في قسم الـ app-mock، ولا في الـ layout، ولا في الصفحات الأخرى.
The app-mock section, the layout and every other page are untouched. The new
sheet is imported **last** so its hairlines win the cascade without touching
D2's sheet (which Z1 is editing concurrently).

---

## 2 — الخريطة: التطبيق الحقيقي ← النسخة المصغّرة
## Real app → mock mapping

### Desktop (`.hm-desktop`)

| التطبيق الحقيقي / Real source | النسخة في الهيرو / Hero mock |
|---|---|
| `Rail.tsx` — `PRIMARY` 00 Home · 01 Workspace · 02 Sessions · 03 Source control + Files + More، ومجموعة أدوات على اليمين (Search / Preview / Terminal / Settings) | `.hm-app-rail` يعرض `DEMO.nav` بأرقامه الحقيقية عبر `.hpx-rail-no` + زر More + `DEMO.utils` على اليمين، مع `dir="ltr"` ثابت في كلا اللغتين. |
| `ChatPanel.tsx` — `chat-head-v13`: المربع `S`، `01 AGENT CONSOLE`، عنوان الجلسة، ثلاث نقاط حالة | `.hpx-chat-head` بنفس العناصر الأربعة. |
| `MessageView.tsx` — صف الأداة `.tl2-card`: قاعدة 1px، أيقونة، فعل `read_file`، المسار، `OK 512ms` | `.hm-app-tool` + `.hpx-tool-*`، مع خط 1px عمودي (`::before`) و`.hpx-tool-rule`. |
| `Composer.tsx` — `BUILD/PLAN/DEBUG/REVIEW`، الحقل + المؤشر، زر `+`، ميكروفون، `ContextLens`، شريحة الموديل، Send، تلميحات `/` | `.hpx-modes`، `.hpx-compose-input`، `.hpx-plus`، `.hpx-mic`، `.hpx-orb`، `.hpx-model`، `.hpx-send`، `.hpx-quick`. |
| `AttachMenu.tsx` — ترويسة «Add to chat · 4» وأربعة مسارات: image / document / presets / rewind | `.hpx-attach-pop` — كل الأيقونات من `GLYPHS` (لا أشكال مخترعة). |
| `ContextLens.tsx` — قوس `2πr`، علامة 12 o'clock، قيمة `62`،Stroke غير قابل للتحجيم | SVG بداخل `.hpx-orb` بـ `pathLength={100}` و`strokeDasharray="62 100"`. |
| `ProjectFiles.tsx` / مساحة العمل | `.hm-app-files` يعرض مسارات `DEMO.files` الحقيقية (لا أسماء وهمية). |

### Editor (`.hm-editor`)

| التطبيق الحقيقي | النسخة في الهيرو |
|---|---|
| تبويبات ملفات حقيقية +breadcrumb | `.hpx-tabs` (ثلاثة تبويبات، النشط بخط ليموني) و`.hpx-breadcrumb`. |
| أرقام أسطر + diff | `<i>17…21</i>`، سطر `.hpx-code-del` (`−`) وسطر `hm-code-add` (`+`)، `.hpx-diffstat` `+12 −3`. |
| مصغّر الكود + شريط الحالة | `.hpx-minimap` (خانتا ليمون للسطر المضاف) و`.hm-editor-status` (`TSX · UTF-8 · Ln 20, Col 9 · Spaces: 2`). |

### CLI (`.hm-cli`)

| التطبيق الحقيقي | النسخة في الهيرو |
|---|---|
| أوامر `sadeem` + مخرجات الأجهزة | `.hpx-cli-bar` (`agent@workspace · ~/sadeem · zsh`) ثم `$ sadeem run` ← `read_file settings/theme-context.ts` ← `✓ 2 tools · 512ms` ثم `$ sadeem preview` ← `→ http://localhost:5173`. |
| مؤشر الطرفية | `.hpx-cli-caret` with `@keyframes hpx-caret-blink` (مقود بذات الكواتم الثلاثة). |

---

## 3 — المؤشر / The mouse

- **مؤشر واحد فقط** `.hpx-cursor` داخل `.hm-desktop`، و**مفتاح حركة واحد فقط**
  `@keyframes hm-cursor-path` في `hero-panels.css`. لا يوجد `hm-ripple` أو `hm-ring`
  ولا نسخة ثانية من نظام `appmock-cursor-*`.
- `useHeroPanelGeometry` يقيس **`getBoundingClientRect()`** للحقل و زر `+` و Send
  وينشر مراكزها كمتغيرات `--hm-c-input-x/y`، `--hm-c-plus-x/y`، `--hm-c-send-x/y`
  على اللوحة نفسها. كل نقطة في المفتاح تقرأ هذه المتغيرات — لا `cqw` مخمّنة ولا
  `Math.random`. التزحزقات الصغيرة داخل الـ dwell هي `calc()` على نفس المتغير.
- المسار: حقل (كتابة) ← `+` (توقّف) ← حقل (توقّفان) ← Send (توقّف) ← رجوع هادئ
  إلى الحقل. مدة المسار `calc(var(--art-cadence,2.8s) * 2.5)` = ٧ ثوانٍ على نفس
  إيقاع الـ app-mock، بمنحنيات `ease-out` / `cubic-bezier` واضحة.
- **النقرة** `.hpx-click` و**البوب أوفر** `.hpx-attach-pop` يتحركان بـ `transition`
  على نفس السمة `data-hm-in` (بتأخير ١٣٢٠ms / ١٦٠٠ms) — لا مفتاح حركة ثانٍ.
- الخصائص تُضبط مرة واحدة عبر `IntersectionObserver` يكتب `data-hm-in` فقط؛
  لا React state، لا `Date`، لا timers.

كواتم الحركة الثلاثة / The three motion gates:

```
@media (prefers-reduced-motion: reduce)   → المؤشر مخفي، البوب أوفر ثابت، الوميض متوقف
html.reduce-motion                         → نفس النتيجة
html[data-art='off']                       → كل الحركة متوقفة والمؤشر مخفي
```

---

## 4 — اللون والثيم / Palette & themes

الورقة الجديدة تستخدم **نفس رموز الثيم** التي اعتمدها Z1 في `home.css`:
`var(--bg)`، `var(--paper)`، `var(--ink)`، `var(--dim)`، `var(--faint)`،
`var(--line)`، `var(--line-strong)`، `var(--accent)`، و`var(--hm-panel)`.
لا ألوان ثابتة للخلفيات، فالنسخة المصغّرة تبدو صحيحة في الوضع الداكن والمنير.
اللونان الثابتان الوحيدان هما علامة العلامة التجارية `#9be515` / `#000000`
داخل SVG الترس والمؤشر — وهما هوية، لا طلاء لوحة.

No gradients, no shadows, no blur, no glow. Hairlines only; tabular mono
figures; `vector-effect: non-scaling-stroke` on every SVG mark.

---

## 5 — التحقق / Verification

```
cd website && npx tsc --noEmit && npm run build
node tests-v1141-hero-mosaic.mjs      # 18 PASS / 0 FAIL
node tests-v1141-hero-visual.mjs      # 19 PASS / 0 FAIL
node tests-v1142-hero-panels.mjs      # 20 PASS / 0 FAIL
```

The new guard proves: scoped isolation (P1, P18), measured geometry (P2–P3),
rail / tool row / composer / popover fidelity (P4–P8), editor + CLI detail
(P9–P10), exactly one cursor keyframe with no app-mock duplication (P11–P14),
the three motion gates (P15), palette + determinism + RTL safety (P16–P20).
