# GRAPHICS-V1138 — Precision Pass / لمسة الدقة النهائية

> **Scope / النطاق:** CSS ONLY. Eight owned sheets in `src/components/` were
> refined; **no TSX**, and `chat-final.css` / `shell.css` / `type-scale.css`
> were **not touched**. Palette tokens unchanged. No versioned CSS selectors
> were introduced — the additions are plain, stable rules.
>
> **EN:** The largest visual-craft uplift of the Electron app: instrument-grade
> precision added on top of the language the founder already loves — spinning
> circle, ink flow, hairlines, Instrument Serif, no boxy cards. Every signature
> animation survives untouched; the work is additive calibration.
>
> **AR:** أكبر ترقية دقيقة لتصميم تطبيق Electron: دقة على مستوى الأجهزة أُضيفت
> فوق اللغة التي يحبها المؤسس — الدائرة الدوّارة، جريان الحبر، الخطوط الشعرية،
> Instrument Serif، بلا بطاقات مربّعة. كل الحركات التوقيعية بقيت كما هي؛
> العمل كان معايرةً إضافية فقط.

---

## 0. Blunt verdict / الحكم الصريح

**EN — PASS.** Braces balance in all 8 sheets (net depth `0`, no negative
depth). Zero hex literals (the four engraving mask stops `src/components/art.css:149,150,170,171`
were converted from `#000` to the `black` keyword — identical mask alpha, no
palette meaning). All three required guards pass **38/38**; `npm run build`
is **green** (3299 modules, CSS bundle emitted, CSP hashes injected).

**AR — نجاح.** الأقواس متوازنة في الملفات الثمانية (العمق الصافي `0`، بلا عمق
سالب). صفر قيم hex (تم تحويل أربع نقاط قناع النقش في
`src/components/art.css:149,150,170,171` من `#000` إلى الكلمة `black` — نفس
الشفافية قاماً، بلا أي دلالة لونية). الحراس الثلاثة المطلوبون نجحوا **38/38**
والبناء **أخضر**.

---

## 1. Exact refinements / التحسينات الدقيقة (file:line)

### 1.1 `src/components/art.css` — shell engraving

| # | Refinement | file:line |
|---|---|---|
| 1 | Crosshair tick shortened 5px→4px and dimmed `.55→.5` — reads as registration, not a plus; coord label inset 14px→13px | `art.css:66-74`, `art.css:80` |
| 2 | Mono coordinate captions gained `tabular-nums` + `'tnum' 1` (crosshair, `FIG. 01` plate, home coordinate stamp) | `art.css:85-86`, `art.css:105-106`, `art.css:122-123` |
| 3 | Engraving masks: `#000` → `black` (zero-hex law, identical mask alpha) | `art.css:149-150`, `art.css:170-171` |
| 4 | `artRise` depth refined to opacity + a whisper of scale (`translateY(6px) scale(0.996)`) — no shadow/fill | `art.css:175-178` |
| 5 | Hero titles gained `font-optical-sizing: auto`, `font-kerning: normal`, `text-wrap: balance` | `art.css:317-320` |
| 6 | **New** single calibrated 1px draw under `.w18-title` / `.hm-title`: 42px rule, `scaleX(0→1)` from inline-start, calm **2.4s**, rests at `0.55` opacity, `margin-block-start: 10px` whitespace | `art.css:332-358` |
| 7 | RTL mirror (`transform-origin: inline-end`), `[data-motion]` scaling, **both** motion gates settle at full ink | `art.css:350-352`, `art.css:359-361`, `art.css:363-376` |

### 1.2 `src/components/display-type.css` — editorial typography

| # | Refinement | file:line |
|---|---|---|
| 1 | `.display-type` / `.display-type-sm` gained precise optical sizing, kerning and balanced wrap | `display-type.css:51-55` |
| 2 | The full scoped headline set (page heroes, empty states, section titles, v11.12c additions) gained the same optical trio | `display-type.css:125-129` |
| 3 | Existing Arabic/Cairo guards left intact — `letter-spacing: 0`, zero fake Latin serif; optical sizing applies to Cairo too. No versioned selectors added | `display-type.css:65-69`, `display-type.css:130-166` |

*This sheet has no motion, so reduced-motion guards do not apply here; every
animated sheet below carries both.*

### 1.3 `src/components/context-orb.css` — exact arc, calm pulse

| # | Refinement | file:line |
|---|---|---|
| 1 | Composer gap `6px→7px` (generous whitespace beside the mic) | `context-orb.css:13` |
| 2 | Arc primitives gained `stroke-linejoin: miter` alongside the existing 1px non-scaling butt-cap geometry | `context-orb.css:53-56` |
| 3 | **New** 1px registration tick at true 12 o'clock, centred with logical `inset-inline: 0; margin-inline: auto` (RTL-safe, pointer-events none) | `context-orb.css:58-71` |
| 4 | Arc keeps the **exact, unrounded** TSX `2πr` percentage; CSS only breathes opacity on a calm **2.6s** cadence (`0.74↔1`) | `context-orb.css:73-82` |
| 5 | `[data-motion]` scales the pulse; value + label gained `tabular-nums` / `'tnum' 1` | `context-orb.css:83-85`, `context-orb.css:94`, `context-orb.css:104` |
| 6 | **Both** reduced-motion signals freeze the pulse at `opacity: 1` | `context-orb.css:110-119`, `context-orb.css:121-128` |

### 1.4 `src/components/dna.css` — growth spark

| # | Refinement | file:line |
|---|---|---|
| 1 | **New** one-shot calibrated growth on `.dna-conf-fill`: `scaleX(0→1)` from `transform-origin: inline-start`, opacity `0.45→1`, calm **2.4s**; the honest `width` transition still carries live data changes | `dna.css:90-108` |
| 2 | Staggered sibling reads: `+80ms / +160ms / +240ms` | `dna.css:109-112` |
| 3 | `[data-motion]` scaling; how-it-works list gap `7px→8px`; step numbers gained tabular numerals | `dna.css:113-115`, `dna.css:159`, `dna.css:175-176` |
| 4 | **Both** gates settle at fully-grown, honest-width state (`transform: none; opacity: 1`) | `dna.css:357-369` |

### 1.5 `src/components/proof.css` — proof ledger

| # | Refinement | file:line |
|---|---|---|
| 1 | **New** one-shot calibrated draw on the ledger's sole hairline `.pr-pop-rule`: 1px, `scaleX(0→1)` from inline-start, calm **2.4s**, rests at full ink — a registration rule, never a boxed header | `proof.css:260-278` |
| 2 | RTL mirror + `[data-motion]` scaling | `proof.css:271-272`, `proof.css:279-281` |
| 3 | Ledger figures (definition, kind counts, tally counts) gained `tabular-nums` / `'tnum' 1` | `proof.css:341-342`, `proof.css:530-531`, `proof.css:557-558` |
| 4 | Ledger rows gained generous whitespace (`padding: 9px→10px`) and a calmer staggered reveal (`220→260ms`, `30/55/80/105→45/90/135/180ms`) | `proof.css:373`, `proof.css:434-438` |
| 5 | **Both** gates settle the ledger hairline fully drawn | `proof.css:461-466`, `proof.css:484-488` |

### 1.6 `src/components/stream-motion.css` — stream ink

| # | Refinement | file:line |
|---|---|---|
| 1 | **New §11 Precision Ink**: settled phase stamps get ONE calibrated 1px rule drawn from the reading start, calm **2.6s**, resting at `0.5` — the live band keeps its signature `phase-flow` hairline, selectors never overlap | `stream-motion.css:631-660` |
| 2 | Stagger `80 / 120 / 160 / 200ms` across neighbouring stamps; RTL mirror via `inline-end` | `stream-motion.css:649-656` |
| 3 | `[data-motion]` scaling + **both** motion gates at full ink | `stream-motion.css:662-676` |
| 4 | All signature keyframes preserved: `art-orbit` (spinning circle), `art-ink-flow`, `art-ink-spread`, `phase-flow`, `art-measure-breathe` | `stream-motion.css:326-420`, `stream-motion.css:613` |

### 1.7 `src/components/tool-story.css` — per-glyph line art

| # | Refinement | file:line |
|---|---|---|
| 1 | Glyph SVGs gained `shape-rendering: geometricPrecision` — hairlines resolve on exact geometry, never a half-pixel | `tool-story.css:39-42` |
| 2 | Every primitive pinned to explicit `stroke-width: 1` + `stroke-miterlimit: 2` (elegant miters), keeping `vector-effect: non-scaling-stroke`, butt caps, token currentColor | `tool-story.css:44-52` |
| 3 | Plan-count figures gained tabular numerals (joining the existing tnum receipt group) | `tool-story.css:200-206` |
| 4 | Signature `tsg-glyph-draw` / `tsg-glyph-draw-rtl`, `craft-ink-flow`, orbit and one-shot draws all preserved | `tool-story.css:54-65`, `tool-story.css:497-500` |

### 1.8 `src/components/chat-art.css` — instrument plate

| # | Refinement | file:line |
|---|---|---|
| 1 | Thinking clock label gained `tabular-nums` / `'tnum' 1` | `chat-art.css:54-61` |
| 2 | **New §13**: the serif empty-state title gets the same single calibrated 1px draw — 36px rule, `scaleX(0→1)` from inline-start, calm **2.6s**, `margin-block-start: 12px`, rests at `0.5` | `chat-art.css:610-636` |
| 3 | RTL mirror + `[data-motion]` scaling + **both** motion gates at full ink | `chat-art.css:629-630`, `chat-art.css:637-651` |
| 4 | Signature `art-ink-flow` gutter ink, engraved orbit and path-growth still intact | `chat-art.css:190-228`, `chat-art.css:359-364` |

---

## 2. Law compliance / الالتزام بالقواعد

| Law | Result | Evidence |
|---|---|---|
| Brace balance | ✅ 8/8 sheets, net `0` | automated scan of all 8 files |
| Zero hex literals | ✅ 0 across all 8 | `#[0-9a-fA-F]{3,8}` scan → 0 |
| Palette tokens unchanged | ✅ | only `var(--…)`, `currentColor`, `color-mix(in srgb, …)` and the `black` mask keyword |
| No gradients/shadows/card fills in new work | ✅ | new rules use only `transform`, `opacity`, 1px `background`/`border` in token hues |
| RTL logical properties | ✅ | `inset-inline-*`, `margin-inline`, `inline-size`, `transform-origin: inline-end` mirrors; zero physical `left/right` sides in `art`, `story`, `final` |
| Both reduced-motion signals | ✅ | `@media (prefers-reduced-motion: reduce)` + `html.reduce-motion` in every animated sheet, with static end states |
| Signature animations preserved | ✅ | spinning circle, ink flow, hairline draws, bloom all retained |
| No versioned CSS selectors | ✅ | version tags remain only in pre-existing header comments |

---

## 3. Verification / التحقق

```
node --test --test-force-exit tests/v1111-toolvisuals.test.mjs \
  tests/v1134-art-guard.test.mjs tests/v1127-ui-guard.test.mjs
  → tests 38 / pass 38 / fail 0

npm run build
  → ✓ 3299 modules transformed, built in 1m 54s
  → post-build: webcraft kit, built-in skills, CSP hashes + boot watchdog OK
```

**EN:** The three named guards above were requested explicitly; all pass. The
build is green. No owned file was left unmodified: all eight CSS sheets carry
at least one intentional refinement.

**AR:** الحراس الثلاثة المذكورون نجحوا جميعاً، والبناء أخضر. لم يبقَ أي ملف
من الملفات الثمانية دون تعديل مقصود.
