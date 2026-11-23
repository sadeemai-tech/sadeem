# ART-MOTION v11.40 — حركة الرسومات الفنية + تدقيق صفحة الاستخدام
# Art motion for the illustrated sections + read-only audit of the Usage panel

> الجوهر: أضفنا حركة دقيقة تعبّر عن فكرة كل رسم — المفتاح يدور، الخط
> يُرسم مرة واحدة، البيانات تتدفّق، والعقدة تتنفّس. لم نلمس الألوان
> المعتمدة، ولم نضف بطاقات، ولم نستخدم `Math.random`.
>
> In short: every decorative drawing now moves in a way that *explains*
> its idea — the key turns, the 1px outline writes itself once, data
> flows, a node breathes. No palette edits, no boxy cards, no randomness.

---

## 1. الملفات المعدّلة / Files changed

| الملف / File | التغيير / Change |
|---|---|
| `website/app/art-motion.css` (جديد / new) | الطبقة المشتركة: ٥ keyframes + ٦ أصناف + ٣ بوابات إيقاف. Shared layer: 5 keyframes, 6 opt-in classes, 3 kill switches. |
| `website/app/globals.css:1` | سطر واحد فقط: `@import './art-motion.css';` — لم يُعدّل أي قاعدة موجودة. One line only; no existing rule touched. |
| `website/app/features/page.tsx` | لوحة مفتاح جديدة + حركة على كل الرسومات الصغيرة. New key plate + motion on every mini diagram and glyph. |
| `website/app/docs/page.tsx` | حركة للكتاب الميداني المفتوح. Motion for the open field manual. |
| `website/app/changelog/changelog.css` | حركة لعُقد الخط الزمني وختم الموجة الحالية. Motion for timeline nodes and the current-wave stamp. |

`website/app/changelog/page.tsx` is a thin server wrapper; its artwork lives in
`website/components/download/ChangelogPage.tsx`, which is outside this task's
ownership. It is animated entirely from `changelog.css` + the shared layer —
the component source was **not** edited.

---

## 2. خريطة الحركة / Motion map

| الفكرة / Idea | العنصر / Element | الحركة / Keyframe | المدة / Cadence |
|---|---|---|---|
| المفتاح لا يغادر جهازك — يدور في القفل | `features/page.tsx:598` `<g className="am-key">` | `am-key-turn` (`art-motion.css:38`) ±12° around the bow — symmetric, RTL-safe | 2.8s |
| الثقة تنتقل محلياً بلا وسيط | `features/page.tsx:607` `.am-flow` + `:608` `.am-node-pulse` | `am-line-flow` / `am-line-flow-rtl` (`:51`, `:55`) + `am-node-pulse` (`:61`) | 2.8s |
| الحدّ يُرسم مرة واحدة | `features/page.tsx:586,591,592` | `am-outline-draw` (`:45`), `pathLength={1}` | 2.8s, once |
| الشبكة / الوكيل / الدليل — عقدة تتنفّس | `features/page.tsx:67,68,69,73,678` | `am-node-pulse` + `am-draw` | 2.8s |
| كل قسم له إطار خطي يكتب نفسه | `features/page.tsx:658,661,677,685` | `am-draw` | 2.8s, once |
| البيانات تتدفّق داخل الشبكة | `features/page.tsx:672` | `am-line-flow` | 2.8s |
| الدليل الميداني يستقر على تجليده | `docs/page.tsx:34` `.am-sway` | `am-sway` (`:67`) ±0.4° | 3.2s |
| غلاف الكتاب وعموده يُرسمان مرة | `docs/page.tsx:40,41,53` | `am-outline-draw` | 2.8s, once |
| ختم الدليل يتنفّس | `docs/page.tsx:52` | `am-node-pulse` | 2.8s |
| كل إصدار يرسم عُقدته مرة | `changelog.css:73` `.c-node-blob` | `am-outline-draw` (`--art-from:52`) | 2.8s, once |
| علامة الإصدار الحالي / الختم | `art-motion.css:122,128`, `changelog.css:74` | `am-outline-draw` + `am-node-pulse` | 2.8s |

### لوحة المفتاح الجديدة / The new key plate

**`features/page.tsx:575–617`** — `KeysDiagram()`, موصولة بالقسم
`privacy` عبر `diagram: 'keys'` (`:257`) وتُعرض كـ **PLATE 05**
(`:635–642`). رسم خطي فقط: حدّ محلي بدائرة رفيعة، قفل بـ1px، مفتاح بعروة
وأسنان، وخط أخضر واحد يتدفّق بينهما داخل حدّ محلي. النص: «YOUR KEYS NEVER LEAVE /
مفاتيحك لا تغادر جهازك».

`KeysDiagram()` at `features/page.tsx:581`, wired to the privacy group at
`:257` and rendered as PLATE 05 at `:638`. Pure line art: a 1px machine
boundary, a lock, a bow-and-teeth key, and one lime hairline. No fill,
no card, no decorative gradient.

---

## 3. الضوابط / Guards

- **بوابتا تقليل الحركة / both reduced-motion gates** — `@media (prefers-reduced-motion: reduce)` at `art-motion.css:139` **and** `html.reduce-motion` / `html[data-art='off']` at `:146–155`. The changelog's two extra selectors are guarded three ways at `changelog.css:75–80`. End states are always static **and fully drawn** (`stroke-dashoffset:0`), never a half-written outline.
- **RTL** — the key rotation is symmetric (±12°), so it reads identically in both directions. The data line flips with `html[dir='rtl'] .am-flow{animation-name:am-line-flow-rtl}` (`art-motion.css:105`). No physical `left/right` offsets were introduced; SVG text keeps `text-anchor` as in the existing plates.
- **اللوحة / Palette + namespace** — the shared layer owns **only `--art-*`** properties: `--art-cadence` on `:root` (`:31`, timing only) and `--art-lime:#9be515` scoped to `.am-svg` (`:76–80`). It defines **no** `--am-*` token and **no** global colour token. Structural strokes still inherit the live theme's `--ink` / `--line` / `--accent`. Hairlines only (`stroke-width .6–1`, no fills, no shadows).
- **لا عشوائية / No randomness** — no `Math.random`, no time-based jitter, no layout-affecting properties. Only `transform`, `opacity`, `stroke-dashoffset` animate.
- **النطاق / Scope** — all classes are opt-in (`am-*`), so no existing rule in `globals.css`, `features.css`, `docs.css` was modified.

**Source-guard checks:** all five concept keyframes present (`art-motion.css:38,45,51,55,61,67`), both gates present (`:139`, `:146–155`), RTL flip present (`:105`), `Math.random` absent from every changed file, **no `--am-*` definition in this layer**.

---

## 4. تدقيق صفحة الاستخدام (قراءة فقط) / Usage page audit — READ-ONLY

`src/components/panels/UsagePanel.tsx` was **read, not edited**. Findings for the founder/parent:

### 4.1 ما هو صحيح / What is correct

- Token counts are provider-exact: `messageUsage()` (`:148–156`) calls `fromProviderUsageReport` (`src/lib/ctx.ts:80–91`) whenever `prompt_tokens`/`completion_tokens` are finite, and `tokenCountSource` (`ctx.ts:96–100`) decides provider vs `≈`. `perMessageRows()` uses `ctxFillTokens(u)` and `tokenCountSource(u)` at `:344–350`.
- Prices come from the real resolver: `priceViewFromModelInfo()` (`:83–109`) normalizes `api.modelInfo(id)`, the main-process bridge to `resolveModelInfo` (documented at `:51–63`). `priceCostUsd()` (`:133–145`) multiplies only resolver rates and returns **0** for unknown. `buildModelBreakdown()` (`:182–225`) uses the same catalog. Honest markers `≈ / — / unknown` at `:159–161, :963–967, :1064–1078`.

### 4.2 تكرار في الواجهة / Duplicated UI

| # | المواقع / Locations | الوصف / Finding |
|---|---|---|
| D1 | `UsagePanel.tsx:452–510` (component `UsageChart`, rendered `:683`) **vs** `:990–1039` ("Last 14 days" panel) | **Two 14-day cost bar charts from the same `days` array** (built once at `:589–607`, `maxCost` at `:608`). The SVG chart has its own axis/ticks; the second panel re-maps `days` into another bar strip (`:995–1009`) and a second date gutter (`:1013–1019`). This is the founder's "أشياء متكررة". |
| D2 | `:920–924` and `:1046–1050` | The **identical column header row** (`Model / Tokens / Cost`) is written twice — once for per-message rows, once for top models. |
| D3 | `:721–725`, `:981–984`, `:1034–1038`, `:1084` | Four near-identical dashed-border `role="status"` empty/unknown blocks. Repeated UI pattern. |
| D4 | `:584–587`, `:589–607`, `:620–627` | Three separate passes over `settings.usageLog` (`find`, per-day `find`, `filter.map.sort`) for today / window / streaks. Data is the same source; consolidation is possible. |
| D5 | `:778–785`, `:863–910`, `:916–985`, `:243–296` (mounted `:988`), `:1041–1086` | Tokens/cost appear in five panels at overlapping scopes. Scopes differ (day / session / per-reply / cache / per-model), so this is arguably intentional — but combined with D1 it reads as repetition. |

### 4.3 أرقام قد تُخترع بدل مصدرها / Numbers that could be invented

| # | الموقع / Location | Finding | Severity |
|---|---|---|---|
| N1 | **`:99–100`** | `cacheRead: num(p.cacheRead) \|\| (input > 0 ? input * 0.1 : 0)` and `cacheWrite: num(p.cacheWrite) \|\| (input > 0 ? input * 1.25 : 0)`. When the resolver omits cache rates, these **hardcode 0.1× / 1.25× fallbacks**, yet `unknown` at `:94` only checks `input`/`output`. This contradicts the file's own "never invents a rate" promise at `:58`. **The rates should stay unknown instead of being synthesized.** | **High** |
| N2 | `:262` | `savedTokens = Math.round(cached * 0.9)` — a hardcoded 0.9 savings ratio. It *is* labelled "billed at 0.1x" in the UI (`:276`), so it is a disclosed assumption, but the provider never reported this number. | Medium |
| N3 | `:608` | `maxCost = Math.max(0.000001, ...)` injects a synthetic 1e-6 floor into the chart axis. With zero real usage the bars/ticks are drawn against a fabricated scale. | Low |
| N4 | `:614–615` | `avgDayCost = windowCost / 14`, `projectedMonth = avgDayCost * 30.4` — a 30.4-day projection. Explicitly labelled `PROJ/MO` at `:1024`, so honest, but derived rather than provider-sourced. | Low / disclosed |
| N5 | `:585` | "Today" fallback `{runs:0, tokens:0, costUsd:0}` when no log row exists; tokens/cost render `unknown` (`:781–782`) but runs render `0` (`:780`) — inconsistent honesty for the same missing record. | Low |
| N6 | `:192–194` | When `u.attempts` is empty, a synthetic single attempt is constructed from session-level fields. Honest fallback, but a constructed row, not a provider attempt. | Low / disclosed |
| N7 | `:87` | `num()` silently clamps any negative/non-finite rate to `0`, which can turn a bad resolver value into a plausible-looking `$0` rate. `unknown` should be preferred. | Low |

### 4.4 الخلاصة / Verdict

البيانات الأساسية (التوكنات والأسعار) **تأتي فعلاً من المزوّد** عبر
`resolveModelInfo` و`fromProviderUsageReport`، والعلامات `≈ / — / unknown`
مستخدمة بصدق. المشكلة الحقيقية ليست في الأرقام الأساسية بل في:
(1) رسمين بيانيين متكرّرين لنفس الـ14 يوماً، و(2) مُعاملات كاش مُخترعة
عند غيابها من المزوّد (`:99–100`).

The core numbers **do** come from the provider resolver, and the honesty
markers are used correctly. The two things to fix are the duplicated 14-day
chart (D1) and the invented cache-rate fallbacks (N1).

---

## 4b. ملاحظة التكامل (X6) / Integration note

**تعارض توكن تم إصلاحه / Token collision fixed.**
- `website/app/art-motion.css:25` (النسخة السابقة) كان يعرّف `--am-ink:#0c1103` على `:root`، بينما `website/app/home.css:303` يعرّف `--am-ink:#E9EEF6` على `[class*='appmock-']` — معنى متعاكس لنفس التوكن.
- الإصلاح: حذفنا `--am-ink` تماماً من الطبقة المشتركة (كان غير مستخدم)، ونقلنا كل خصائص الطبقة إلى نطاق `--art-*`: `--art-cadence` (`art-motion.css:31`) و`--art-lime` المُقصور على `.am-svg` (`:76`). لا يوجد أي تعريف `--am-*` في `art-motion.css` الآن.
- مواضع الاستخدام المحدّثة: `features/page.tsx:607,608,672` (`var(--art-lime)`), `features/page.tsx:598` (`--art-origin`), `changelog.css:73` (`--art-from`).

**SITE.version — for parent, not edited.**
النسخة المعروضة في ترويسة المستند (`ART-MOTION v11.40`) هي اسم المستند فقط؛ لا يوجد أي نص جديد يعرض `SITE.version` كـ v11.40. لوحات `features/page.tsx` ما زالت تستخدم `v{SITE.version}` كما هي (`:284`, `:339`, `:910`) — لم نلمس `lib/site.ts`. إذا كان مطلوباً تحديث رقم الإصدار المعروض، فهو من صلاحية الأب.

The `v11.40` in this document's title is a document label, not rendered UI. No new copy renders `SITE.version` as v11.40; existing plates continue to use `v{SITE.version}` unchanged. `lib/site.ts` was not touched — version copy belongs to the parent.

---

## 5. التحقق / Verification

- `cd website && npx tsc --noEmit` — **passes** (exit 0).
- `cd website && npm run build` — **passes** (exit 0): compiled, type-checked and all 14 static pages prerendered, including `/features`, `/docs` and `/changelog`.
  - Note: two intermediate runs were blocked by *foreign* errors in `website/app/page.tsx` (`PALE`, `RULER`, `TRACES`, `InkFlow` undefined — the hero/app-mock owner was mid-edit). That file is outside this task's ownership; once that owner finished, both commands passed cleanly. No error ever referenced a file changed here.
- Source guards: 6 `@keyframes am-*` in `art-motion.css`; both `prefers-reduced-motion: reduce` and `html.reduce-motion` / `html[data-art='off']` gates present; the RTL flow flip present; no `Math.random` in any changed file; **zero `--am-*` custom-property definitions in `art-motion.css`** (5 `--art-*` definitions instead) — no collision with `home.css:303`.
