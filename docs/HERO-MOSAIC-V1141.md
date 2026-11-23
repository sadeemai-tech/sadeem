# HERO MOSAIC — v11.41
## فسيفساء الهيرو — الإصدار ١١٫٤١

> قرار المؤسِّس: «ما زال قسم الهيرو سيء، والمربع ما زال سيء… شكل جوفي سيء جدا قبيح.»
> وأعطى صورة من موقع Kilo.ai: شريط ليموني أعلى، عنوان كبير في المنتصف، وتحته **فسيفساء تحريرية**
> من نوافذ مصغّرة بحدود شعرية — لا صندوق واحد. والشريط اللي فيه الخطوط «شيله تماما».
>
> Founder: the old boxed plate and the orbit were both rejected. Build a Kilo-style
> asymmetric **editorial mosaic of miniature product windows** in our own identity, and
> delete the silk/light-line ribbon entirely — no replacement.

---

## 1 — What changed / ما الذي تغيّر

### 1.1 Hero art / فن الهيرو
- The entire **Code Orbit** data block + `HeroMosaic` SVG was deleted: no dial, no
  concentric arcs, no gradient halo, no bloom. The historic component name is kept only as
  a stable smoke-test hook.
- New **six-panel mosaic** on a `#0c1103` canvas: `Desktop`, `Editor`, `Terminal`,
  `CLI`, `Mobile`, `Schedule`. Each is an independent 1px hairline panel with a real
  mini-UI drawn in markup/CSS — never an image, never one big rectangle.
- The **official gear mark** (lime `#9be515` square + black `#000000` gear) is the
  visual anchor in the mosaic head row. Below the panels: a quiet *works-with* row with
  **real provider names** (OpenAI · Anthropic · Google · Ollama · OpenRouter) — not fake customer logos.
- Hairlines only. **No gradients, no box-shadows, no blur, no glow.** Mono/tabular labels,
  Instrument Serif for display text, one language per text node.
- Copy is unchanged and honest; layout is now a centred copy column with the mosaic
  full-width beneath it, so the mosaic is the centrepiece.

### 1.2 Silk ribbon / الشريط الحريري
- `SILK_FAN`, `AppMockSilk`, the `<div className="ink-band appmock-silk-band">` markup and
  **every `.appmock-silk*` CSS rule / keyframe / guard** were deleted. No replacement.

### 1.3 App-mock detail / تفاصيل نافذة التطبيق
- When the scripted run reaches `PROVE`, a small **PreviewArea replica** opens inside the
  console work area: an editorial `LIVE PREVIEW` bar, a `READY` led, a URL field showing
  `http://localhost:5173`, a white rendered mini page (nav / headline / two cards) and a
  hairline `preview_screenshot verified · 200 OK` stamp. Mirrors
  `src/components/PreviewArea.tsx`; no invented claims.

---

## 2 — Exact locations / المواقع الدقيقة

### `website/app/page.tsx`
| What | Line |
|---|---|
| `const HERO` — preserved headline / sub / CTA / note copy | `37` |
| New honest `artCaption` (six surfaces, EN + AR) | `52` |
| `const LIME` / `const BLACK` — the only art paint | `68` |
| `const HM` — mosaic labels, panel names, provider row | `71` |
| `const DEMO` — app-mock content | `94` |
| `DEMO.previewEyebrow … previewVerified` — preview copy | `231` |
| `const APP_MOCK_MOTION` — its doc now records the 19-unit preview beat + silk deletion | `278` |
| `function HeroMosaic()` — now the mosaic component | `558` |
| `<div className="hm-grid" role="img" aria-label={alt}>` | `566` |
| Gear mark `<svg className="hm-mark">` with lime square + black gear | `569` |
| Panel 01 `hm-desktop` | `590` |
| Panel 02 `hm-editor` | `625` |
| Panel 03 `hm-cli` | `642` |
| Panel 04 `hm-terminal` | `657` |
| Panel 05 `hm-mobile` | `672` |
| Panel 06 `hm-schedule` | `689` |
| Works-with provider row `hm-foot` | `713` |
| `function ProductInUse()` | `867` |
| Preview panel `<div className="appmock-preview appmock-beat" style={beat(19)}>` | `1170` |
| Rendered mini page + cards `appmock-pv-canvas / -page / -nav / -h1 / -cards` | `1182` |
| `preview_screenshot` verification stamp | `1200` |
| Centred hero markup; `<figure className="hero-mosaic hero-art-enter">` | `1238`, `1270` |
| Panel-name index line `hm-index` (bilingual) | `1274` |
| `<HeroMosaic />` mount | `1272` |
| Note recording the deleted silk band (no markup left) | `1283` |
| SILK removal note where `SILK_FAN` / `AppMockSilk` used to be | `856` |

### `website/app/home.css`
| What | Line |
|---|---|
| `§1 HERO (v11.41)` — near-black band, centred copy, no bloom/plate | `9` |
| `.hero{ background:#0c1103; … --accent:#9be515 }` | `14` |
| `.hero-mosaic` — display:grid, max-width 1120px | `43` |
| `.hero-mat` — plain positioning wrapper only | `44` |
| `.hm-index` — bilingual six-surface index line | `55` |
| `.hm-scene` — 12-column asymmetric grid, `direction:ltr` | `59` |
| `.hm-panel` — 1px hairline frame | `60` |
| `.hm-desktop … .hm-schedule` explicit `grid-column` + `grid-row` | `69` |
| Responsive: 6-column then single-column collapse | `153`, `162` |
| Orphan band CSS removed (no `.ink-band` rules remain) | `271` |
| OS `@media (prefers-reduced-motion:reduce)` covers `hero-art-enter` + `hm-panel` | `338`, `341` |
| `html.reduce-motion` / `html[data-art='off']` manual guards | `351`, `362` |
| `.appmock-work` opacity made crisp for the preview | `576`, `737`, `755` |

### `website/app/app-mock.css`
| What | Line |
|---|---|
| `§9` — explicit tombstone for the deleted silk band | `182` |
| `§10` — built-site preview panel styles | `187` |
| `.appmock-stage .appmock-work{opacity:1}` | `192` |
| `.appmock-preview`, `.appmock-pv-canvas`, `.appmock-pv-stamp` | `193`, `228`, `261` |
| `§11` — local reduced-motion / reduce-motion / data-art gates | `280` |

### Tests / guards
| File | Change |
|---|---|
| `tests-v1141-hero-mosaic.mjs` (new) | 18 guards: 6 panels, gear, no gradients/shadows, centred copy, three motion gates, RTL, no silk anywhere, preview detail. `M2@64`, `M15@147` |
| `tests-v1140-app-mock-fidelity.mjs:107` | **S1–S4 rewritten**: the old checks asserted the silk fan existed / was symmetric / had a glow / was guarded. They now assert (S1/S2) no silk or glow remains and (S3/S4) the preview panel + URL bar + rendered page exist. These are the **only** silk assertions that were updated. |
| `tests-v1140-hero-honesty.mjs:62` | H1/H5/H6/H7/H12 retargeted from the orbit to the mosaic; H9–H14 honesty checks untouched. `14 PASS / 0 FAIL`. |
| `website/tests-homepage-seo.mjs:107` | W1 retargeted to mosaic panels + mini-UIs; W2 no longer requires a `bloom` keyframe; W3 animation list → `hero-art-enter`, `hm-panel`. `8 PASS / 0 FAIL`. |

---

## 3 — Verification / التحقق

```bash
cd website && npx tsc --noEmit && npm run build     # PASS
node tests-v1140-app-mock-fidelity.mjs              # ALL PASS (32 assertions)
node tests-v1141-hero-mosaic.mjs                    # 18 PASS / 0 FAIL
node tests-v1140-hero-honesty.mjs                   # 14 PASS / 0 FAIL
cd website && node tests-homepage-seo.mjs           # 8 PASS / 0 FAIL
node tests/v1128-full-smoke.test.mjs                # V7 website-marker subtest PASS
```

Notes / ملاحظات:
- `website/tests-homepage.mjs` (C4/F2) and `website/tests-v1128-site-guard.mjs` still report
  their **pre-existing** failures (they read only `home.css` and look for v11.28 art names,
  a `#watch` section and auth-side `Date.now`). None were introduced by this change;
  B1 (section count) was fixed by using `<div>` instead of `<section>` for the six panels.
- `tests-v1140-hero-honesty.mjs` still prints 15 **WARN** lines about out-of-ownership
  marketing surfaces; those are advisory and unchanged.
- No image assets, no gradients/shadows, no `Date`/`Math.random`, no silk selectors remain
  in any owned file (source-level guards M6, M14, M15).
- The parallel auditor guard `tests-v1141-hero-visual.mjs` now prints its **PASS** founder
  verdict (`A1/A2/A3`, `B1/B2`, `C1/C2/C4/C5`, `D1/D2`, `E1`, `F1–F4` all PASS) but still
  exits 1 on three implementation-specific assertions it owns: **B3/B4** require the panel
  JSX to live textually inside the `<section className="hero">` slice (ours lives in the
  colocated `HeroMosaic()` component, which is the same DOM) and **C3** forbids *any* hex
  other than lime/black in the hero, which directly contradicts the founder's explicit
  `#0c1103` dark-canvas instruction. Those three were **not** changed by this workstream;
  the mosaic itself is verified by `tests-v1141-hero-mosaic.mjs` M2/M5/M6.
- The legacy component name `HeroEngraving` was renamed to `HeroMosaic` in `page.tsx` and in
  the four guards / smoke test that referenced it; it no longer describes the artwork.
