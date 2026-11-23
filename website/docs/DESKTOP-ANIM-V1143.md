# v11.43 — DESKTOP PANEL: ONE COMPLETE RUN / لوحة سطح المكتب: تجربة كاملة

> **Founder brief / طلب المؤسس:** «شايف قصة الديسكتوب تحت قسم الهيرو… أريدك أن تحسن أنيميشن الديسكتوب وتزيد تفاصيله تفاصيل التفاصيل، إنه نسخ لصق من التطبيق الإلكتروني… اكتب امر مثل بناء موقع الكتروني، ولما يبني الملفات بعدين يشغل المعاينة، إنه اعتبرها تجربة حقيقية للتطبيق بالكامل.»
>
> **Answer / الجواب:** The Desktop miniature now plays one honest, scripted app run: a user types `build a website`, the agent writes `index.html` and `styles.css` (each tool row shows path + OK + duration), an editor sliver shows the written lines with real line numbers, and the work area opens a live preview (`localhost:5173`, nav / headline / cards, `verified · 200 OK`).
> لوحة سطح المكتب تعمل الآن كتجربة واحدة صادقة: المستخدم يكتب «ابنِ موقعاً»، الوكيل يكتب `index.html` و`styles.css` (كل صف أداة يعرض المسار + تم + المدة)، شريط محرر صغير يعرض الأسطر المكتوبة بأرقام حقيقية، ثم تنفتح معاينة حية (`localhost:5173`، تنقل / عنوان / بطاقات، `verified · 200 OK`).

---

## 1 · Ownership / الملكية

| File | Scope |
|---|---|
| `website/app/page.tsx` | **Only** `HeroMosaic()` — its local `hb()` beat helper, the Desktop panel markup and the `data-hm-dir` attribute. No other panel, no `DEMO` data, no layout, no other page. |
| `website/app/hero-panels.css` | **Only** the Desktop panel, its cursor, its new reveal keyframes and the three motion kill switches. `.hm-code i` remains owned by `home.css` (untouched). |
| `tests-v1141-hero-mosaic.mjs`, `tests-v1141-hero-visual.mjs` | Only the **stale preview / old `beat(19)` guards** — see §6. No other guard changed. |

`home.css`, `app-mock.css`, `globals.css`, the Editor / CLI / Terminal / Mobile / Schedule panels and all other routes were **not edited**.

لم يُلمس `home.css` ولا `app-mock.css` ولا باقي اللوحات ولا أي صفحة أخرى. `.hm-code i` ما زال مملوكاً لـ `home.css`.

---

## 2 · One cadence / إيقاع واحد

`website/app/page.tsx:362` — `hb(u)` publishes `--hb` as `(u × 2800) / 7` ms. One unit = **400 ms** = `--art-cadence (2.8s) / 7`, the same family the rest of the page uses. No `Math.random`, no `Date`, no free-running clock.

`website/app/hero-panels.css:366` — the cursor still runs the **single** `hm-cursor-path` keyframe (`calc(var(--art-cadence,2.8s) * 2.5)` = 7 s) and is still driven by `data-hm-in`. No second cursor system was added; the Send click is a CSS **transition** on that same attribute (`hero-panels.css:244`), exactly like the existing `+` ripple.

### Timeline / الجدول الزمني

| Beat | ms | Event / الحدث | Markup / CSS |
|---|---:|---|---|
| 1 | 400 | composer prompt types `build a website` | `page.tsx:501`, `hero-panels.css:325` |
| 10 | 4000 | plan hairline fills + pips light | `page.tsx:449`, `hero-panels.css:332-336` |
| 11 | 4400 | user turn, reasoning, `read_file` probe row | `page.tsx:456-469` |
| 12 | 4800 | `write_file index.html` · OK · 214ms | `page.tsx:471-476` |
| 13 | 5200 | editor sliver (01/02/03 line numbers) | `page.tsx:484-488`, `hero-panels.css:223-231` |
| 14 | 5600 | `write_file styles.css` · OK · 96ms | `page.tsx:477-482` |
| 16 | 6400 | preview opens: URL → page → stamp | `page.tsx:549-585`, `hero-panels.css:329-331` |

The cursor typing ticks (0–48 %), Send landing (58–65 %) and quiet park (82–100 %) remain the authoritative `hm-cursor-path` waypoints (`hero-panels.css:371-388`); the two write rows, sliver and preview simply inherit the same cadence.

---

## 3 · What is new in the panel / التفاصيل الجديدة

**Chat / المحادثة**
- plan/progress hairline — one 1px track that fills + three status pips (`page.tsx:449-453`, `hero-panels.css:202-212`)
- typed user turn and a typed composer prompt, RTL-aware via `data-hm-dir` (`page.tsx:398`, `page.tsx:457`, `page.tsx:501`; `hero-panels.css:328`, `hero-panels.css:350`)
- two `write_file` rows with LTR paths, `+` accent prefix, OK chip and honest duration stamps (`page.tsx:471-482`, `hero-panels.css:219-221`)
- editor sliver with `01 / 02 / 03` line numbers and an added-line accent (`page.tsx:484-488`, `hero-panels.css:223-231`)
- context orb keeps its real `62` value and exact 62/100 arc (`page.tsx:524-525`) — unchanged
- Send click ripple as a transition (`page.tsx:533`, `hero-panels.css:237-248`)

**Work area / مساحة العمل**
- breadcrumb `sadeem-demo › index.html` + `+2` written-files stamp (`page.tsx:545-547`, `hero-panels.css:250-260`)
- `LIVE PREVIEW` bar with a READY pip, `localhost:5173` URL field with LED, nav / kicker / Instrument Serif headline / lead / two cards (`page.tsx:549-574`, `hero-panels.css:262-311`)
- `verified · 200 OK` hairline stamp with a drawn check (`page.tsx:577-584`, `hero-panels.css:312-319`)

No gradients, shadows, blur, glow, `Math.random` or `Date`: every paint is a theme token, every figure is tabular mono, every instrument string is physically LTR and every inset is logical (`inset-inline-start`, `margin-inline-start`, `border-inline-start`).

---

## 4 · Motion kill switches / مفاتيح إيقاف الحركة

All new moving pieces join the **same three gates** already in the sheet:

- OS `prefers-reduced-motion: reduce` — `hero-panels.css:442-447`
- in-app `html.reduce-motion` — `hero-panels.css:456-460`
- `html[data-art='off']` — `hero-panels.css:469-473`

With any gate on, the base state is the **final readable frame**: prompt, both write rows, sliver and preview all stay visible; only the cursor and ripples are suppressed.

---

## 5 · Verification / التحقق

```
cd website && npx tsc --noEmit          → PASS (no output)
cd website && npm run build             → PASS (Next.js 16.4.6, 14/14 static pages)

node tests-v1141-hero-mosaic.mjs        → 18 PASS / 0 FAIL
node tests-v1142-hero-panels.mjs        → 20 PASS / 0 FAIL
node tests-v1142-hero-light.mjs         → 15 PASS / 0 FAIL
node tests-v1141-hero-visual.mjs        → 19 PASS / 0 FAIL
```

---

## 6 · Guards updated (old beat count / stale preview) / الفحوصات المُحدَّثة

A concurrent v11.43 founder-requested change removed the standalone illustrative console section from `page.tsx`; its preview experience is now entirely inside the Desktop panel. Three source guards were stale and were updated to follow the new location — **no other guard was touched**:

1. **`tests-v1141-hero-mosaic.mjs:160` — `M17`**: was `appmock-preview … preview_screenshot`; now asserts `hpx-preview`, `hpx-pv-url`, `hpx-pv-canvas`, `hpx-pv-page`, `hpx-pv-stamp`, `localhost:5173` and `200 OK` (`:157-166`).
2. **`tests-v1141-hero-mosaic.mjs:167` — `M18` — this is the guard that asserted the OLD beat count**: was `beat(19)` + `appmock-pv-stamp`; now asserts `hb(16)` (the one 400 ms unit) + `hpx-pv-h1` + the `.hpx-pv-stamp{}` hairline rule in `hero-panels.css` (`:167-172`). The added `HP` read is at `:42`.
3. **`tests-v1141-hero-visual.mjs:269` / `:271` — `E1`**: the four preview signals now also match `hpx-preview` and `hpx-pv-page` / `hpx-pv-canvas` (`:267-271`).

Guard `tests-v1142-hero-panels.mjs:138` (`P14`) still asserts the authoritative cursor string `animation:hm-cursor-path calc(var(--art-cadence,2.8s) * 2.5)` and was intentionally **left unchanged** — it is the one-cursor contract, not an old beat count.
