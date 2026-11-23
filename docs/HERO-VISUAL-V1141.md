# v11.41 — HERO VISUAL + SILK REMOVAL / فن الهيرو وإزالة الشريط الحريري

> **حكم المؤسس (الجولة الأخيرة):** «سيء / قبيح» — الصندوق المربّع الداكن جنب الهيرو ما زال مرفوضاً، والشريط الحريري (`appmock-silk`) تحت الكونسول مرفوض كذلك. المطلوب: Y1 يعيد بناء الهيرو كـ **mosaic** من لوحات مصغّرة تُعبّر عن التطبيق، ويحذف الشريط الحريري **بالكامل** بلا أثر.
>
> **Founder's latest rejection:** the box beside the hero is "سيء / قبيح" (bad / ugly), and the silk ribbon under the console goes with it. Y1 must rebuild the hero as a **mosaic** of miniature product panels and delete the ribbon **completely**, with no orphan CSS left behind.

> **الحكم الحاد / Blunt verdict — baseline run (2026-11-22, Y1 still mid-flight):**
> **FAIL — 11 PASS / 8 FAIL.** **نعم، الصندوق السيء/قبيح لا يزال يتكرر في المصدر.** The ugly box STILL REPRODUCES in source: `<HeroEngraving />` is still mounted at `website/app/page.tsx:1203`, there are **0/6** miniature panel names in the hero, and `website/app/app-mock.css:186-211` still paints the entire silk ribbon (`appmock-silk`, `appmock-silk-arc`, `appmock-silk-node`, reduced-motion guards). `website/app/home.css:185,187` also holds now-orphan `.ink-band` rules after Y1 removed the ribbon wrapper from the markup.
>
> This guard exists to make that answer flip to **PASS**. Re-run it after Y1 lands.

> **تنبيه على أرقام الأسطر / line-number caveat:** Y1 was editing `page.tsx` concurrently while this guard was authored, so the tree shifted between runs (page.tsx grew/shrank by ~3 KB and the hero moved from ~1185 to ~1168). Every check is **string/anchor-based**, not line-number-based, so a re-run is safe. The quoted `file:line` below are from the final baseline run only; locate any string by grepping its quoted text if it moved.

---

## 1. عربي — ماذا يفحص الحارس بالضبط

الحارس `tests-v1141-hero-visual.mjs` في جذر المستودع يقرأ أربعة ملفات فقط:
`website/app/page.tsx`، `website/app/home.css`، `website/app/app-mock.css`، `website/app/globals.css`.
لا يعدّل أي ملف مصدر، ويطبع PASS / FAIL مع `file:line` دقيقة، ويخرج برمز 1 عند أي FAIL.

| المجموعة | المعرّفات | الشرط (FAIL = خرق) |
|---|---|---|
| **A — لا صندوق** | A1, A2, A3 | اختفاء `Code orbit` / `measurement plate` / `he-svg` / تحميل `<HeroEngraving />`؛ غلاف الهيرو (`.hero-mat`, `.hero-art`, `.hero-instrument`) بلا `border` / `background` / `box-shadow`؛ لا SVG مفرد 600×600. |
| **B — الموزائيك** | B1–B4 | ٥ أسماء لوحات على الأقل من `Desktop / Editor / Terminal / CLI / Mobile / Schedule` داخل الهيرو؛ حاوية `grid/flex`؛ ٥ لوحات بإطار `border:1px`؛ تفاصيل UI داخلية (٥ `<svg>` أو ٢٠ عنصراً متداخلاً). |
| **C — الهوية الرسمية** | C1–C5 | الليموني `#9be515` + الترس الأسود (>=٤ أسنان)؛ لا ألوان طلاء خارج البالتّة؛ Instrument Serif للعرض؛ تسميات mono بـ tabular-nums. |
| **D — الشريط الحريري** | D1, D2 | **صفر** تطابق لـ `silk / ribbon / weave / light-line` في الملفات الثلاثة؛ لا قواعد CSS يتيمة (`ink-band`، `appmock-silk*`). |
| **E — تفاصيل المعاينة** | E1 | لوحة `appmock-preview` فيها شريط URL + صفحة مصغّرة + ختم `verified`. |
| **F — الحمايات** | F1–F4 | `prefers-reduced-motion` + `html.reduce-motion` + `html[data-art='off']` في ورقتَي CSS؛ لا `Math.random/Date`؛ سلسلة واحدة لغة؛ حاجز `data-art` في JS. |

**النتيجة الأساسية (الأخيرة):** A1 ✗ · A2 ✓ · A3 ✓ · B1 ✗ · B2 ✗ · B3 ✗ · B4 ✗ · C1–C5 ✓ · D1 ✗ · D2 ✗ · E1 ✗ · F1–F4 ✓.
**= 11 PASS / 8 FAIL → الصندوق السيء ما زال يتكرر.**

---

## 2. English — the contract Y1 must satisfy

### 2.1 The mosaic (the actual fix)

Inside `<section className="hero ...">` in `website/app/page.tsx`:

1. A data array (e.g. `const HERO_PANELS = [...]`) with **≥5** entries whose `name` is one of
   `Desktop`, `Editor`, `Terminal`, `CLI`, `Mobile`, `Schedule` (case-insensitive; all six accepted, five enough). **B1**
2. A container rendered in the hero JSX with a class containing `mosaic`, `hero-tile`,
   `hero-panel`, `mini-app`, `shot-grid` or `hero-shots` — e.g. `<div className="hero-mosaic">`
   mapping into `<figure className="hero-panel">…</figure>` items. **B2/B3**
   Accepted panel-class aliases: `mosaic-panel`, `hero-panel`, `hero-tile`, `hero-shot`, `mini-app`, `mini-panel`, `mini-tile`.
3. Each panel carries a **1px hairline frame** in `home.css` (`.hero-panel{border:1px solid var(--line);…}`)
   and **inner UI detail**: at least 5 inline `<svg>` elements in the hero JSX (one per panel),
   or ≥20 nested `div/span/i/rect/path/line/circle/text/polyline/polygon` tags total. **B3/B4**
4. The container is an **editorial grid/flex** — a CSS rule whose selector contains one of the
   container tokens above and whose body has `display:grid` or `display:flex`. **B2**
5. **Not one rectangle:** the old `<HeroEngraving />` mount, `he-svg`, `Code orbit:` caption,
   `measurement plate` hooks and any `viewBox="0 0 600 600"` instrument must be gone. **A1/A3**
   The wrapper itself paints **no** border/background/shadow — it is positioning only. **A2**

### 2.2 The silk ribbon — delete it everywhere

Zero matches (case-insensitive) for `silk|ribbon|weave|light-line|lightline` across
`page.tsx`, `home.css`, `app-mock.css` — **including comments and keyframes**. **D1**
Concretely remove: `SILK_FAN`, `AppMockSilk`, `appmock-silk`, `appmock-silk-source`,
`appmock-silk-spine`, `appmock-silk-arc`, `appmock-silk-node`, `appmock-silk-origin`,
`appmock-silk-glow`, `am-silk-glow`, the `ink-band appmock-silk-band` wrapper and its JSX,
plus the entire "§ 9 · silk ribbon" block in `app-mock.css:182-211`.

**No orphans:** if the `.ink-band` wrapper is removed from markup, `.ink-band` and
`.ink-band .if` in `home.css:185,187` must be deleted too. **D2** (currently failing).

### 2.3 App-mock preview detail

In the app-mock section add a preview panel with all four source markers **E1**:
- class matching `appmock-preview` / `preview-panel` / `preview-pane` / `live-preview` / `preview-stage` / `preview-window`;
- a URL bar: `appmock-url` / `appmock-address` / `omnibox`, or a literal `http(s)://` / `localhost` / `www.`;
- a mini rendered page: `mini-page` / `rendered-page` / `preview-page` / `appmock-page` / `appmock-viewport` / `appmock-canvas`;
- a verified stamp: `verified` / `مُتحقَّق` / `appmock-stamp` / `appmock-verified`.

### 2.4 Do not regress the rest

Keep the lime square + black gear (`#9be515` + `#000000`, ≥4 tooth paths), Instrument Serif
`@font-face`/`--serif`/`.display`, tabular mono labels, all three motion gates in **both** CSS
sheets, no `Math.random`/`new Date`, one language per string, and the `dataset.art === 'off'`
guard. **C1–C5, F1–F4** are already PASS — do not break them while rebuilding the hero.

---

## 3. التشغيل والدليل / Run + baseline evidence

```
# من جذر المستودع / from the repository root
node tests-v1141-hero-visual.mjs        # FAIL=1, PASS=0
# أعد التشغيل بعد انتهاء Y1 / re-run after Y1 finishes — يجب أن تصبح 19 PASS / 0 FAIL
```

Baseline run captured for this document (Y1 mid-flight):

```
v11.41 HERO VISUAL / SILK-REMOVAL GUARD (source-level)
hero region: page.tsx:1168-1209 | hero CSS: home.css:1-81

FAIL A1 [page.tsx:1168] — old hooks: page.tsx:1203("<HeroEngraving") home.css:44("he-svg")
PASS A2 [home.css:43]     — hero wrappers paint no border / background / shadow
PASS A3 [page.tsx:1168]   — no single 600×600 instrument SVG in the hero
FAIL B1 [page.tsx:1168]   — 0/6 panel names in hero: none
FAIL B2 [home.css:1]      — editorial grid/flex container: markup=false, css rules=0
FAIL B3 [page.tsx:1168]   — panels in markup=0 (need >=5), hairline 1px frame rules=0
FAIL B4 [page.tsx:1168]   — inner UI detail: 0 inline <svg> (need >=5) or 11 nested UI tags (need >=20)
PASS C1 [page.tsx:68]     — official lime #9be515 present (4×)
PASS C2 [page.tsx:69]     — black gear: black fill=true, gear tooth paths=9 (need >=4)
PASS C3 [page.tsx:68]     — hero paint limited to palette tokens
PASS C4 [globals.css:9]   — Instrument Serif + hero <h1 class="display"> present
PASS C5 [app-mock.css:19] — tabular mono labels present
FAIL D1 [app-mock.css:186]— 11 silk/ribbon/weave matches remain (app-mock.css:186-211)
FAIL D2 [home.css:185]    — orphan ink-band CSS: home.css:185,187
FAIL E1 [page.tsx:845]    — preview: preview=false, URL bar=true, mini page=false, verified=true
PASS F1 [home.css:253]    — reduced-motion (OS + class) + data-art='off' in BOTH stylesheets
PASS F2 [page.tsx:33]     — no Math.random / new Date / Date.now
PASS F3 [page.tsx]        — every visible string is one language
PASS F4 [page.tsx:434]    — data-art='off' guarded in JS + CSS

=== RESULT ===
11 PASS / 8 FAIL  (19 checks)
FAILED IDS: A1, B1, B2, B3, B4, D1, D2, E1

=== FOUNDER VERDICT / حكم المؤسس ===
FAIL — نعم، الصندوق السيء/قبيح لا يزال يتكرر: الهيرو القديم + الشريط الحريري ما زالا في المصدر.
FAIL — the ugly "سيء/قبيح" box STILL REPRODUCES: old hero + silk ribbon remain in source.
```

**قراءة سريعة / How to read the failures:** A1/B1–B4 = the mosaic has not landed yet;
D1/D2 = the ribbon deletion is half-done (JSX gone, CSS still there + orphan band);
E1 = the preview panel detail is not in the mock yet. C and F are clean and must stay clean.

**آخر إعادة تشغيل / final re-run (same session, Y1 still editing):**
`11 PASS / 8 FAIL` unchanged, failed IDs `A1, B1, B2, B3, B4, D1, D2, E1` — but the hero
moved to `page.tsx:1236-1277`, `<HeroEngraving />` to `:1271`, `data-art` guard to `:456`,
and E1 advanced to `preview=true, URL=true, verified=true, mini page=false`. The tree is
still in motion; the parent session must re-run once Y1 reports finished.

---

## 4. Caveat / تحذير منهجي

This is a **source-level** guard. It proves what the markup, class names and CSS rules say;
it cannot see rendered pixels. It answers "is the ugly box still assembled in source?", not
"is the new mosaic beautiful?". The founder's eye on a real screenshot remains the final judge.

## 5. Ownership / الملكية

Created only: `tests-v1141-hero-visual.mjs` (repo root) and this document. **No application
source file was edited** — this is a diagnosis + test + doc workstream only.
