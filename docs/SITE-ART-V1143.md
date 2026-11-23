# SITE-ART v11.43 — لمسات فنية ذكية / Refined line-art instruments

## CRITICAL — لا يلزم تعديل `layout.tsx` / NO IMPORT LINE NEEDED

All new CSS lives in `website/app/art-motion.css`, which is **already imported** at
`website/app/globals.css:1` (`@import './art-motion.css';`). Page-scoped rules live in
sheets already imported by their own pages (`features.css:22` in `features/page.tsx`,
`pricing.css:9` in `pricing/page.tsx`). The parent does **not** need to add an import.
No `site-art.css` was created. `public/art/*.svg` are served directly by Next.js from
`/art/...` — no bundler config needed.

كل CSS الجديد موجود في `art-motion.css` المستورد أصلاً في `globals.css:1`.
لا يوجد استيراد جديد مطلوب، ولم يُنشأ `site-art.css`.

---

## WHAT WAS ADDED / ما أُضيف

Four **new** original line-art instruments plus **two refinements** of art that already
existed. Every mark is a deterministic alpha mask (`/art/*.svg`, black hairlines on
transparent) painted with a live theme token (`--ink` / `--accent`). This is why the
same 1px mark stays legible in warm-paper and charcoal themes without a single hardcoded
paint colour in the CSS. Geometry is computed from fixed loops — **no `Math.random`**.

أربعة رسوم خطية أصلية جديدة + تحسينان لرسوم موجودة. كل رسم قناع alpha يلوّنه
token حي، فيعمل في الوضعين الفاتح والداكن دون أي لون ثابت في CSS.

### A — 145-tools calibration dial
- **Art:** `website/public/art/sa-dial-145.svg` — outer hairline circle + inner ring + **exactly 145** radial graduations (every 5th is a major tick). Fixed `i` loop.
- **CSS:** `website/app/features/features.css:360-400` (mask + arrival, shared baseline slot at `:377-384`), `:403-412` (one lime needle), `:370` (scoped `--sa-lime:#9be515`).
- **VERDICT — أصلي ومفيد، ليس حشواً.** ORIGINAL + PURPOSEFUL. The page claims *“145 real tools”*; the dial contains exactly 145 ticks. It makes a checkable claim visible instead of adding a generic badge. The one-shot "settle" is `sa-settle` (`art-motion.css:179-182`, 2.8s). Honest note: it is a **one-shot arrival**, not a literal `stroke-dashoffset` stroke draw — a CSS mask cannot animate internal strokes. All ticks exist at rest.

### B — Local-first "home" orbit
- **Art:** `website/public/art/sa-local-orbit.svg` — laptop in 1px, a tiny house roof on the screen, a dashed hairline orbit and one node.
- **CSS:** `website/app/features/features.css:360-400` (mask), `:414-424` (single lime node), `:372-373` (relative anchor).
- **VERDICT — أصلي ومفيد، ليس حشواً.** ORIGINAL + PURPOSEFUL. Anchors the *“100% LOCAL”* stat — the strongest privacy claim on the site — with a precise object. It does **not** duplicate the BYOK key/lock plate (which already exists and is good).

### C — Schedule clock with one advancing tick
- **Art:** `website/public/art/sa-clock.svg` — 1px face, 12 graduations, two hands read at 03:00.
- **CSS:** `website/app/art-motion.css:193-207` (scoped to `.docs-main #schedules .sec-index::after`), keyframe `sa-tick` at `:183-187`.
- **VERDICT — أصلي ومفيد، ليس حشواً.** ORIGINAL + PURPOSEFUL. `/docs` section 08 is the only place the site promises a cron; a 20px hairline face before the syntax tells the reader *“this is about time”* without a wordy icon. One tick advances once, then rests.

### D — Checksum fingerprint
- **Art:** `website/public/art/sa-hash-grid.svg` — 2×8 hairline cells, three inked; a deterministic fingerprint matrix.
- **CSS:** `website/app/art-motion.css:209-224` (scoped to `.dl-inst-foot .mono:first-child::before`), keyframe `sa-fingerprint` at `:188-191`.
- **VERDICT — أصلي ومفيد، ليس حشواً.** ORIGINAL + PURPOSEFUL. The release instrument already prints the real SHA-256 figures; this 44px matrix gives the instruction *“verify before running”* a precise anchor. It is not the existing four-square platform glyph — different grammar, different job.

### E — Concentric growth-ring arrival (REFINE, do not duplicate)
- **CSS:** `website/app/features/features.css:427-437`.
- **VERDICT — تحسين، لا رسم جديد.** REFINEMENT, NOT NEW ART. The anatomy core already had concentric rings (`features/page.tsx:385`). They now write themselves once, in sequence (2.8s, staggered `.12s/.24s`). Same strokes, same geometry; only the arrival changed. No duplicate rings were added.

### F — FREE SEASON stamp edge (REFINE, do not duplicate)
- **CSS:** `website/app/pricing/pricing.css:112-129`; reduced-motion guard added at `:108`.
- **VERDICT — تحسين، لا رسم جديد.** REFINEMENT, NOT NEW ART. The perforated stamp already existed (`pricing.css:69-76`). Its edge now arrives once instead of being simply there — one quiet gesture on the page's only seal. No second seal, no badge.

---

## DELIBERATELY NOT ADDED / ما لم أضفه عن قصد

The founder said *“If a page already has good art, leave it”* and hates hollow cliché.
These pages already carry excellent signature art — adding more would be **filler**, so I did not:

- `/features` — anatomy centerpiece, tool bloom, thinking circle, memory playbook, **BYOK key+lock** (turns on `am-key-turn`), mini diagrams, glyphs.
- `/docs` — the open field manual (`OpenBook`), code reveals, scroll-tested ink rules.
- `/auth` — the two-orbit pairing diagram, counter-rotating medallion, wax seal.
- `/download` — the release instrument orbit + platform glyph.
- `/changelog` — the version timeline; node outlines write once and the current wave already pulses via the shared layer.
- `/pricing` — the ledger rules + season stamp.

حكمي: هذه الصفحات فيها فن أصلي جيد أصلاً. الزيادة عليها كانت ستكون حشواً رخيصاً، فلم أفعلها.

---

## CONSTRAINT CHECK / الالتزامات

- **Hairlines only** — 0.4–1.1px strokes, no fills except 2–3px identity dots. No gradients, no shadows, no glows, no box cards.
- **Palette** — lime `#9be515` scoped locally (`features.css:370`, `--sa-lime`); everything else inherits `--ink` / `--accent`. No new `:root` palette token, no `--am-*` collision.
- **Type** — marks carry no text; surrounding labels already use Instrument Serif display + tabular mono (`globals.css:97-99`, `:539-542`).
- **RTL-safe** — `inset-inline-start/end` and `margin-inline-start/end` for the only positioned accents (`features.css:407,410,418,421`, `art-motion.css:202,218`); radial marks are direction-neutral.
- **Motion** — transform + opacity only, one 2.8s cadence (`--art-cadence`). No layout-affecting properties, no `Math.random`.
- **Three kill switches** — OS `@media (prefers-reduced-motion:reduce)`, manual `html.reduce-motion`, and `data-art='off'`:
  - `art-motion.css:226-242`
  - `features.css:439-462`
  - `pricing.css:105-109, 126-129`
  Under reduced-motion everything lands on the static, fully-drawn end state; under `data-art='off'` the decoration is removed entirely.
- **Hero isolation** — selectors are scoped to `/features` stats, `/docs#schedules`, `/download` release footer and `/pricing` stamp. No selector matches anything in the home hero. `tests-v1142-hero-light` + `tests-v1142-hero-panels` stay green.

---

## VERIFICATION / التحقق

Run from the repo root:

```
cd website && npx tsc --noEmit        # PASS — no output
cd website && npm run build           # PASS — Next 16.4.6, 14 static pages, ✓ Compiled successfully
node tests-v1138-graphics-guard.mjs   # PASS — 27 pass / 0 fail
node tests-v1142-hero-light.mjs       # PASS — 15 PASS / 0 FAIL
node tests-v1142-hero-panels.mjs      # PASS — 20 PASS / 0 FAIL — no hero pollution
```

`site-art` changed only: `website/app/art-motion.css`, `website/app/features/features.css`,
`website/app/pricing/pricing.css`, four new files in `website/public/art/`, and this document.
No `page.tsx`, `layout.tsx`, `home.css`, `app-mock.css`, `hero-panels.css` or `site.ts` was touched.

> **Side note:** the older `tests-v1128-site-guard.mjs` still reports 5 pre-existing FAILs
> (missing `eng-*` keyframes in `home.css`, stale `#watch`/`OrbitConstellation` wiring in
> `page.tsx`, `Date.now()` in the auth handler). It was already stale before this task —
> later v11.38/v11.42 work replaced those surfaces — and none of its checks touch any file
> I edited. The v1138 graphics guard and both v1142 hero guards are the current ones and
> are fully green.
