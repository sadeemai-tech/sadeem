# HERO-LIGHT v11.42 — أزرار الهيرو + الوضع المنير
# Hero buttons + light-mode colour contrast

> ملاحظة عن أرقام الأسطر: أرقام `page.tsx` أدناه مقيسة في وقت كتابة هذا المستند.
> إذا عدّل عاملٌ آخر منطقة الـ app-mock لاحقاً فقد تتحرك الأرقام؛ المرساة المستقرة
> هي أسماء الدوال/الأقسام المذكورة مع كل رقم.
> Line-number note: the `page.tsx` numbers below were measured when this doc was
> written. Another worker editing the app-mock region can shift them; the stable
> anchor (function/section name) is given beside each number.

---

## 1 — ما اشتكى منه المؤسس / What the founder reported

| # | Arabic | English |
|---|--------|---------|
| 1 | «الأزرار الداونلود فور ويندوز والريد دخلات ببعض» | The "Download for Windows" and "Read docs" buttons cramp / overlap. |
| 2 | «مشكلة بتباين الألوان» | Colour-contrast problem (the primary button's text was overridden to `--ink`, i.e. near-white on lime). |
| 3 | «القسم كامل مع الديسكتوب والإيديتور… لما أشغل الوضع المنير كلياته بيبقى أسود ما بتغير» | The whole hero + mosaic stays black in light mode. |

### السبب الجذري / Root cause

- `website/app/home.css:14-21` (old) painted `.hero{background:#0c1103;color:#e9eef6;…}`
  **and redefined** `--accent`, `--ink`, `--dim`, `--faint`, `--line*` locally. Because
  the mosaic `.hm-*` rules live inside `.hero`, those dark literals won the cascade
  for **both** themes — `html[data-theme='dark']` in
  `website/app/globals.css:32-39` could never reach the hero.
- `.hero-actions` only had `justify-content:center` — no `display:flex`, no `gap`.
  Its two `<Link>`s were inline siblings with zero separation.
- `.hero .btn{color:var(--ink)}` flattened the lime `.btn-solid` so its text became
  the light theme-independent ink → poor contrast on lime.

---

## 2 — الإصلاحات / Fixes (exact locations)

### A — الأزرار / Buttons

| Change | Location |
|--------|----------|
| Read docs is now a real button (`.btn hero-more`), not a bare underlined `.link`; two sibling `<Link>` CTAs in one flex row. Bilingual labels unchanged. | `website/app/page.tsx:1443-1452` — hero JSX, `export default function Home()`, `className="hero-actions hero-enter"` |
| Bilingual CTA data (`cta`, `more`) | `website/app/page.tsx:51-52` — `const HERO = { … }` |
| `.hero-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:12px}` → no overlap, wraps on narrow screens. | `website/app/home.css:43-44` |
| `.hero .btn{min-height:44px;padding-inline:22px}` → proper hit targets. | `website/app/home.css:45` |
| Removed the flattening `.hero .btn{color:var(--ink)}` and the hardcoded `color:#0c1103` hover; primary keeps lime `--accent-fill` + its dark ink from `globals.css:87`; hover ink follows `--bg`. Secondary is a `--line-strong` hairline with `--ink` text. | `website/app/home.css:46-48` (see also `website/app/globals.css:85-88`) |

### B — الوضع المنير / Light mode

| Change | Location |
|--------|----------|
| Hero canvas/text now come from the shared theme tokens: `background:var(--hm-canvas,var(--bg)); color:var(--ink)`. No colour literal. | `website/app/home.css:22-25` — `.hero{…}` |
| Both themes are named explicitly in the hero CSS, token-derived only: `:root .hero{--hm-canvas:var(--bg);--hm-panel:var(--paper)}` and `html[data-theme='dark'] .hero{…color-mix(…)}`. | `website/app/home.css:27-30` |
| Light palette (`--bg:#F2F0E9`, `--ink:#15130E`, `--paper:#FAF8F2`, …) | `website/app/globals.css:19-31` — `:root{…}` |
| Dark palette (`--bg:#0A0C0F`, `--ink:#EEF0E9`, …) | `website/app/globals.css:32-39` — `html[data-theme='dark']{…}` |
| Theme chosen before paint from `localStorage['sadeem-theme']` / `prefers-color-scheme`. | `website/app/layout.tsx:172` — `THEME_INIT` (unmodified) |

**النتيجة:** الوضع المنير = لوحة ورقية فاتحة (`--bg`/`--paper`) مع حروف داكنة
(`--ink`)؛ الوضع الداكن = لوحة سوداء تقريبا. مربع الترس الليموني يبقى
`#9be515` مع ترس أسود في كلا الوضعين —إنه اللون الثابت الوحيد، وهو مرسوم داخل
الـ SVG وليس تنسيق لوحة.

**Result:** light mode = warm-paper canvas with dark ink; dark mode = near-black
canvas. The lime gear square stays `#9be515` with a black gear in **both** themes —
it is the single fixed brand colour, drawn as inline SVG geometry, not a canvas paint.

### C — الفسيفساء والتباين / Mosaic + contrast

| Change | Location |
|--------|----------|
| Panel fill was hardcoded `#0e1405`; now `background:var(--hm-panel,var(--paper))`, hairline stays `1px solid var(--line)`. | `website/app/home.css:73-74` — `.hm-panel{…}` |
| Lime-with-alpha literals (`rgba(155,229,21,…)`) replaced by token-derived `color-mix(in srgb,var(--accent) …)` so light mode does not get an invisible neon tint. | `website/app/home.css:75-76`, `:100`, `:123` |
| Small text that carried meaning moved from low-contrast `--faint` to the adaptive `--dim` (head source, foot, index, figcaption, desktop files, editor status, terminal, schedule, phone state). Decorative dots/notches keep `--faint`. | `website/app/home.css:49`, `:64-68`, `:88-123`, `:139`, `:147` |
| Ink-on-accent on the mini phone mark uses `color:var(--bg)` instead of fixed black — dark ink on bright lime (dark theme), light ink on deep green (light theme). | `website/app/home.css:137-140` — `.hm-phone-letter{…}` |
| New `.hero-figcap` rule gives the mosaic caption readable `--dim` ink in both themes. | `website/app/home.css:68` |
| Identity untouched: `const LIME = '#9be515'`, `const BLACK = '#000000'`, `fill={LIME}`, `fill={BLACK}`. | `website/app/page.tsx:73-74`, `:623-636` — `HeroMosaic()` |

No gradient, shadow, glow, `filter:` or other rejected paint was introduced; the
v11.41 mosaic structure (6 panels, 12-column editorial grid, RTL-safe) is unchanged.

---

## 3 — الحماية / Guards

New source-level guard (source only, no edits): `tests-v1142-hero-light.mjs`
— run with `node tests-v1142-hero-light.mjs` from the repository root.

| Group | Checks | What it proves |
|-------|--------|----------------|
| A | A1–A5 | two separate CTA `<Link>`s, `.hero-actions` flex + nonzero `gap`, ≥40px hit targets, lime solid vs hairline outline (no flattening rule), bilingual `tx()` labels |
| B | B1–B4 | both `:root .hero` and `html[data-theme='dark'] .hero` present; canvas `var(--hm-canvas,var(--bg))`, text `var(--ink)`; globals define `--bg` for both themes; panels use `var(--hm-panel,var(--paper))` |
| C | C1–C3 | zero colour literals / zero old dark hex / zero lime-alpha in hero CSS; no local `--ink`/`--line`/`--accent` override; lime gear mark preserved |
| D | D1–D3 | key small text on `--dim`, no `color:var(--faint)` text in hero CSS, adaptive `--bg` ink for the lime mini-mark and the primary hover |

**Result at time of writing: 15 PASS / 0 FAIL.**

Existing guards re-run and still green:

```
node tests-v1141-hero-visual.mjs   → 19 PASS / 0 FAIL  (19 checks)
node tests-v1141-hero-mosaic.mjs   → 18 PASS / 0 FAIL  (18 checks)
node tests-v1142-hero-light.mjs    → 15 PASS / 0 FAIL  (15 checks)
```

Build verification (from `website/`):

```
npx tsc --noEmit        → clean (no output, exit 0)
npm run build           → ✓ Compiled successfully; 14/14 static pages generated
```

Both commands were run after the edits in this document. The build warnings
(Tailwind `content` missing, `postcss.config.js` module type) are pre-existing
and unrelated to the hero.
