# ALL-PAGES ART & MOTION — v11.45
# كل الصفحات: رسومات وحركة — فيرسون ١١٫٤٥

> Founder brief: «كل الصفحات يجب أن أرى التحسين بعيني... حسن الانيميشن، حسن الحركة تبعت الرسومات، انيميشن احترافي دقيق طويل... حسن الرسومات المستخدمة، زد دقتها في كل الصفحات. لا روح تعمل صفحة وبترك الصفحات الثانية.»
>
> Every one of the six content routes gets **one new, original, exact-geometry line-art illustration** with a **long cinematic animation (8.4–14s)**, plus the same hairline micro-interaction vocabulary. No page is left behind.

---

## 0 — Scope and honest limits / النطاق والحدود

- Edited **only** the CSS files in my ownership. **No `page.tsx` prose was touched.** The art is attached to elements that already exist in the DOM, via `::before`/`::after` alpha-mask layers — so the improvement is live without changing copy or components.
- **Which `docs.css` is wired:** `website/app/docs/page.tsx:9` imports `./docs.css` → the real file is **`website/app/docs/docs.css`** ("field manual v2"). The other file, `website/app/docs.css` ("quick-start hub", `--acc`/`--panel` tokens), is **not imported by any route** and was deliberately left untouched.
- No new React component was needed: every drawing is an **inline SVG data-URI mask** in CSS. Parent does not need to import anything.
- No new CSS custom property was introduced (style guide §6). The lime is the **same `--art-lime:#9be515` token** already declared for `.am-svg`, reused on the six hosts (`website/app/art-motion.css:77`, `:353`). Timing is written inline as `calc(var(--art-cadence) * N)` from the existing 2.8s base.

---

## 1 — One cadence family / إيقاع واحد

`--art-cadence` = **2.8s** (`art-motion.css:32`). Every new duration is a strict multiple or fraction of it:

| Use | Value | Source |
|---|---|---|
| Long film arc (signature loops) | `calc(var(--art-cadence) * 4)` = **11.2s** | `art-motion.css:359–403` + each page sheet |
| Long write-on accent | `calc(var(--art-cadence) * 3)` = **8.4s** | per-page `::after` animation rules |
| Calm mobile breath | `calc(var(--art-cadence) * 5)` = **14s** | `art-motion.css:441–448` |
| Section rule draw (reveal) | `var(--art-cadence)` = **2.8s** | `globals.css:632` |
| Underline draw (hover) | `calc(var(--art-cadence) * .18)` = **.504s** | `globals.css:614, 636` |
| Stagger step | `calc(var(--art-cadence) * .04 * var(--i,0))` | `globals.css:640` |

Shared keyframes (`website/app/art-motion.css`): `v1145-constellation` :359, `v1145-seal-turn` :365, `v1145-handshake` :371, `v1145-arrow-drop` :377, `v1145-node-blink` :384, `v1145-wipe-x` :388, `v1145-wipe-y` :393, `v1145-page-settle` :398, `v1145-calm` :403. All touch only `transform`, `opacity`, `clip-path` — no layout, no paint, no glow.

---

## 2 — Per page: before → after / صفحة بصفحة

### 2.1 FEATURES — tool constellation
- **Before:** the closing plate (`InkReveal.feat-close`) had only prose, two CTAs and the four static `.crosshairs`; no drawing behind the closing line.
- **After:** an original **hexagonal tool constellation** — six nodes (`r=4`) at exact vertices `(120,34) (186,72) (200,152) (120,204) (44,152) (54,70)`, six spokes and an inner hub (`r=9` with a 4-tick cross) — plus a separate **registration reticle** of 8 corner ticks and 4 axis ticks.
- **Motion:** constellation breathes/rotates on the **11.2s** `v1145-constellation` arc once `data-in='true'`; reticle writes left→right on the **8.4s** `v1145-wipe-x`.
- **Files:** `website/app/features/features.css:465` (section), `:474` (shared box), `:485` (constellation mask), `:493` (reticle mask), `:498` (animations), `:500–507` (three gates).

### 2.2 PRICING — one license seal + its single rule
- **Before:** the hero was type-only; the only seal was the FREE-SEASON stamp far below in the status band.
- **After:** an original **octagonal license seal** (`M86 12H114L165 35L188 86V114…`, inner circle `r=62`, four cardinal ticks) plus **one license line** with a centred diamond and two subscript rules.
- **Motion:** seal holds on the **11.2s** `v1145-seal-turn` eased arc; the single line writes on the **8.4s** `v1145-wipe-x`. One lime focal element; the line is quiet ink.
- **Files:** `website/app/pricing/pricing.css:132` (section), `:142` (box), `:151` (seal), `:157` (line), `:161` (animations), `:163–170` (gates).

### 2.3 DOCS — a manual leaf with lines writing
- **Before:** the hero already had the open-book SVG with a `.55s` per-line scale; nothing wrote down the page over a long arc.
- **After:** a **different** original drawing — a single manual leaf with a folded corner (`M18 12H176L206 42V168H18Z`, `M176 12V42H206`) and a margin rule, plus six ruled lines of exact lengths and a small nib chevron at the last line.
- **Motion:** leaf settles on the **11.2s** `v1145-page-settle`; lines + nib write top→bottom on the **11.2s** `v1145-wipe-y`.
- **Files:** `website/app/docs/docs.css:224` (section), `:235` (box), `:243` (leaf), `:249` (writing lines), `:253` (animations), `:255–262` (gates).

### 2.4 DOWNLOAD — verification seal + descending arrow
- **Before:** the hero figure had a slowly spinning artifact seal; the verification instruction below had a static hash-grid mask.
- **After:** an original **check-ring** (`circle r=40` at `100,64`; exact check `M82 64l12 12 24-26`; four cardinal ticks) plus a **measured descending arrow** (`M100 118v78`, head `M88 184l12 12 12-12`, two guide ticks).
- **Motion:** ring turns on the **11.2s** `v1145-seal-turn`; arrow drops and fades at both edges on the **11.2s** `v1145-arrow-drop` loop, so it never snaps.
- **Files:** `website/app/download/download.css:165` (section), `:175` (box), `:183` (ring), `:189` (arrow), `:193` (animations), `:195–202` (gates).

### 2.5 CHANGELOG — a timeline writing itself
- **Before:** the real `.c-rail` existed with scroll progress, and the current node blinked — but the hero had no timeline drawing.
- **After:** an original **chronicle spine**: one 1px rule `M60 12v236`, caps, six nodes at exact `y = 28/72/116/160/204/238`, alternating long/short date ticks, and a separate lime dot aligned to the last node (same viewBox, no guessed offsets).
- **Motion:** spine writes top→bottom on the **11.2s** `v1145-wipe-y`; current dot blinks on the **11.2s** `v1145-node-blink`.
- **Files:** `website/app/changelog/changelog.css:83` (section), `:92` (box), `:98` (spine mask), `:107` (aligned dot), `:112` (animations), `:114–121` (gates).

### 2.6 AUTH — a pairing handshake
- **Before:** the pairing medallion diagram existed; the hero above it was type-only.
- **After:** an original **handshake** — two exact node rings (`r=22` at `x=54` and `x=206`) with inner dots (`r=4`) and two facing half-arcs; a separate **measured bridge** with two inward arrowheads and two parallel guide rules.
- **Motion:** the two nodes approach/retreat via `scaleX` on the **11.2s** `v1145-handshake`; the bridge writes once on the **8.4s** `v1145-wipe-x`. Distinct from the rotating medallion below it.
- **Files:** `website/app/auth/auth.css:133` (section), `:143` (box), `:151` (nodes+arcs), `:157` (bridge), `:161` (animations), `:163–170` (gates).

---

## 3 — Shared micro-interactions / مُدخلات دقيقة مشتركة

`website/app/globals.css:576-651`:

- **Zed benchmark → measuring gutter:** `body::before/::after` (`:584`) are a 1px ruler down both side margins — an exact inline SVG mask (`M0 8h16M0 24h8…M0 88h8`, major tick every 48px) painted by the existing `--line-strong` token. No gradient, no new var. Width `clamp(10px,1.4vw,18px)` is always **smaller than `.wrap` padding**, so it never sits over content. Hides on `data-art='off'` and in forced-colors.
- **Hairline underline that draws on hover:** `.link::after` (`:614`) — 1px accent stroke, `scaleX(0)→(1)` in `.18 × 2.8s`, RTL origin flipped.
- **Section rule that draws once on reveal:** `.rule-art::after` (`:626`) — a lime hairline following the existing `ArtRuntime` `[data-drawn='true']` observer, on the 2.8s base cadence.
- **Precise staggers:** `.v1145-stagger` ladder (`art-motion.css:406–410`) + `.v1145-stagger>*` delay (`:640`) use the existing `--i` index with a `.04 × 2.8s` step.
- All three gates are applied to each utility (`:643–650`).

---

## 4 — Research changes applied (with file:line) / ما تغيّر بعد بحث التصميم

The competitor research (`docs/DESIGN-BENCHMARKS-V1145.md`, `docs/design-refs/OBSERVATIONS.md`) changed the work in these concrete ways:

1. **Zed's measuring grid** → added the gutter ruler as an exact SVG mask in `--line-strong`, in the page margins only, not a gradient and not over content: `website/app/globals.css:576–598`.
2. **"Art frames real content"** → all six drawings are `z-index:-1` behind the hero/closing type, with `pointer-events:none`, `translate:0 -50%`, `inset-inline-*` logical placement and `clamp()` sizes; the download art sits opposite the real artifact figure, the changelog art does not duplicate the real `.c-rail`, the auth art is distinct from the real medallion. See each `:474 / :142 / :235 / :175 / :92 / :143` box rule.
3. **Kilo's one-accent discipline** → each page has exactly **one lime layer** (the primary illustration); the reticle / license line / manual leaf / arrow / spine / node-rings are quiet `--ink`. Single token reuse: `website/app/art-motion.css:353`.
4. **Claude's calm UI motion** → hover/rule micro-motion is a fraction of the base (.18x / 1x) while the 2.8s family is reserved for the long hero accents; short upward rise already provided by the existing `InkReveal` was left intact. `website/app/globals.css:602–650`.
5. **"Restraint must not become boring"** → the long 8.4/11.2/14s cinematic arcs were **kept and strengthened**; no animation was stripped. Every drawing is original SADEEM geometry; no competitor logo, metric or artifact was copied.
6. **Style guide §6 + benchmark §6** → no new CSS vars: reused `--art-lime`, `--art-cadence`, `--ink`, `--line-strong`, `--accent`. No gradient, glow, box-shadow, emoji or off-palette hex was added (the only hex in the diff is the pre-approved `#9be515` inside the existing `--art-lime` token, declared again for the six hosts at `art-motion.css:353`).

---

## 5 — Mobile / الشاشات الصغيرة

- Every art box uses `clamp()` with a small floor (`clamp(90px,15vw,190px)` … `clamp(160px,28vw,340px)`); logical `inset-inline-*` keeps RTL correct.
- `@media (max-width:640px)` in `art-motion.css:441` swaps **every** film arc for `v1145-calm` (opacity-only, **14s**), guarded by `prefers-reduced-motion:no-preference` **and** `html:not(.reduce-motion):not([data-art='off'])` so a kill switch can never be revived.
- The gutter ruler drops to `.34` opacity below 640px (`globals.css:597`).

---

## 6 — Three kill switches على كل حركة / على كل حركة

Master block `website/app/art-motion.css:413–437` plus a local block in every page sheet (`:500`, `:163`, `:255`, `:195`, `:114`, `:163`):

- `@media (prefers-reduced-motion:reduce)` → `animation:none`, static fully-drawn frame.
- `html.reduce-motion` → same static frame.
- `html[data-art='off']` → same static frame **and** `display:none` (decoration is not information).

Nothing animates on a small screen with motion off; no half-written outline is ever left on screen.

---

## 7 — Verification / التحقق

Commands run from `website/`:

```
npx tsc --noEmit                       → 0 errors
npm run build                          → success
node ../tests-v1138-graphics-guard.mjs → PASS (27 pass / 0 fail)
node ../tests-v1142-hero-light.mjs     → PASS (15 pass / 0 fail)
```

The built CSS chunks in `.next/static/chunks/*.css` confirm every new keyframe is shipped: `v1145-constellation`, `v1145-seal-turn`, `v1145-handshake`, `v1145-arrow-drop`, `v1145-wipe-y`, the gutter SVG mask and the `v1145-calm` mobile variant are all present.

Added hex literals outside approved tokens: **0** (the only hex in the diff is the pre-approved `#9be515` already declared as `--art-lime`). Added gradients/glows/box-shadows in the new V1145 blocks: **0**. Page prose edited: **0 lines**. Both `@import './art-motion.css'` and `@import './mobile.css'` remain at the top of `globals.css` in that order (`globals.css:1-2`, preserved after R7 landed `mobile.css`).

### Cleanup note / ملاحظة تنظيف

A nested `website/node_modules/node_modules/` directory (771 MB, created by an isolated build attempt) was removed; the canonical `website/node_modules` tree is intact and `next 16.4.6` resolves correctly. The temporary build copy under `D:\ORION\data\cache\tmp\opencode\v1145-build` was also removed. No application source was affected.

---

*End of document — v11.45 all-pages art & motion.*
