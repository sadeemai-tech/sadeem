# CHAT PANEL — VISUAL TRUTH AUDIT / تشريح الحقيقة البصرية للوحة المحادثة — v11.24

> **Role / الدور:** independent, skeptical visual reviewer. **Diagnosis only — NO source was edited.** I authored exactly one file: this document.
> **Snapshot / اللحظة:** 2026-11-20 ≈ 12:15 local. The 17-agent wave was **still writing files while I read** (`ChatPanel.tsx` mtime 11:58 → 12:15, size 104 271 → 91 320 bytes; `console.css` 12:01; `stream-motion.css` 12:02; `chat-art.css` 12:00). Every `file:line` below is the state **at the moment I read it**. Re-verify before acting — this is a moving target.
> **Method / الطريقة:** source reads only (`src/**/*.tsx`, `src/**/*.css`, `tests/v1124-*.mjs`). **I did not launch the app, take a screenshot, or inspect a computed-style box.** All "would look right" statements are *inferences from declared geometry*, not observations of pixels.

---

## 0. The epistemics — source/SSR tests CANNOT prove pixels / المعرفة: اختبارات المصدر لا تثبت البكسل

**EN — say this out loud to the founder.** Every v11.24 guard (`v1124-think-circle.test.mjs`, `v1124-timeline-guard.test.mjs`, `v1124-focus-guard.test.mjs`, `v1124-focus-mode.test.mjs`, `v1124-composer-orb.test.mjs`, `v1124-full-smoke.test.mjs`) is a **string/markup assertion**. Examples copied verbatim:

- `v1124-think-circle.test.mjs:219` — `assert.ok(html.includes('border:none') && html.includes('background:none'), 'node square neutralised inline')`. This proves the *characters* `border:none` exist in an SSR string. It does **not** prove no painted square: a square drawn by a pseudo-element, by `box-shadow: inset`, by a parent chip, or by an overridden declaration is invisible to this test.
- `v1124-think-circle.test.mjs:206-208` — asserts `count(html, 'sc18-think-orbit')===1` and `count(html,'<circle')===4` **inside the THINK band only**. It never counts the *other* circles mounted in the same viewport by `MessageView.tsx`.
- `v1124-focus-guard` / `v1124-focus-mode` assert class names and `html[data-focus]` wiring — never the resulting width, gutters, or whether the composer still renders at a capped 760px.

SSR is a **string serializer**. It has no layout engine, no cascade, no `getComputedStyle`, no rasterizer. It cannot see: a 16px SVG overflowing an 11px socket; a 40px circle positioned at `inset-inline-start:-24px`; a `linear-gradient` (or its replacement hairline) sweeping over a word; a `box-shadow: inset` ring; a `!important` from a different stylesheet; font metrics; RTL mirroring; or a stacking-context overlap. **"All guards green" and "looks right to him" are independent variables.** Several prior docs in this repo (`GRAPHICS-V1122.md:59`, `GRAPHICS-V1123.md:163-171`) already recorded tests passing on *comments* while the visual defect shipped. That failure mode is not fixed — it is now institutionalised in the v1124 guards.

**AR — قل هذا للمؤسس بوضوح.** كل اختبارات v1124 هي **توكيدات على نصوص/وسوم** (`html.includes(...)`, `count(html, ...)`). SSR لا يحتوي محرّك تخطيط ولا `getComputedStyle` ولا رسّام بكسل. لا يمكنه أن يرى دائرة 16px تخرج من مقبس 11px، ولا دائرة 40px بموضع `inset-inline-start:-24px`، ولا خطًا يمسح كلمة، ولا `box-shadow: inset`، ولا أولوية `!important` من ملف آخر. **«الاختبارات خضراء» و«الشكل يبدو صحيحًا» متغيران مستقلان.** الماضي في هذا المستودع يؤكد ذلك.

---

## 1. Element-by-element audit / تدقيق عنصرًا بعنصر

### E1 — ONE precise spinning circle in the right place / دائرة واحدة دقيقة في مكانها

| Fact | Current source | Honest read |
|---|---|---|
| The big 80px primary circle | **REMOVED** from `ChatPanel.tsx` in the 12:15 rewrite. Evidence: `ChatPanel.tsx:1398-1399` "every decorative header live circle is gone"; `:1601-1603` "the big live circle was REMOVED". No `cp-live-glyph`, no `LiveThinkingPanel` mount anywhere in TSX. | The founder's "one circle" request is now interpreted as "delete the big one". Good — but "one circle in the right place" is not the same as "no circle where I was looking". His eye was trained on the header/top of the stream. That anchor is now **empty** except a 4×4px pulsing dot (`ChatPanel.tsx:1395-1397`, `console.css:247-257`). Risk: he says *"where is it?"*. |
| Dead CSS still shipped | `console.css:1045-1079` (`.cp-live-panel`, `.cp-live-glyph` 80px), `chat-final.css:55`, `chat-art.css:20`, `console.css:1190-1198`, `:1333-1355`. | Harmless visually, but it proves the codebase now carries a **fourth generation** of circle CSS. Nobody can reason about which rule wins by reading one file. |
| What actually spins now | **Four** circle species still mounted: (a) `StreamTimeline.tsx:461` `ThinkOrbit size={16}`; (b) `MessageView.tsx:594-646, 3714` `CompactThinkingOrbit` **40px** per assistant row; (c) `MessageView.tsx:1209-1255, 1392` `PrecisionThinkingOrbit` **30px** in the reasoning head; (d) `ContextLens.tsx:83-86, 182-221` **22px** ctx-orb in the composer. Plus (e) 4px pulsing header dot. | **NOT one.** The v1124 guards count each species in its own surface and all pass. On one screen, in one live THINK turn, (a)+(b)+(c)+(d)+(e) can all be visible simultaneously. A human does not see "one circle per surface" — he sees five animated round things. |

**Geometry of the retained THINK circle (a), precisely:**
- `StreamTimeline.tsx:304-349`: `<svg className="sc18-think-orbit" viewBox="0 0 12 12" width={size} height={size} style={{width:size,height:size,color:'var(--acc)'}}>`; mounted `size=16` at `:461`.
- Rings from `PHASE_MARKS.think`: `r=5` and `r=2` (`:231-232`); tick `d="M6 1v2"` (`:330`); orbiting node ring `r=2` + core `r=1` at `(6,3)` (`:344-345`); SMIL `rotate 0→360 about (6,6)`, `dur=2.2s` (`:335-343`).
- CSS: `console.css:1232-1240` pins `width:12px;height:12px`; inline `width:16px` wins (inline > selector without `!important`). Strokes pinned to **1px screen** via `vector-effect:non-scaling-stroke` (`console.css:1248-1253`).
- **Rendered reality:** 16px SVG on a 12-unit grid → scale 1.333. The r5 ring paints at **6.67px radius** (13.3px diameter), r2 at 2.67px, node orbit 4px. Integer radii in source ≠ integer pixels on screen. The r5 ring is *larger than the 11px socket* (`console.css:371-378`) and *larger than the 14px rail* (`chat.css:2690-2693`). The circle visually **spills outside the timeline rail** it is meant to sit inside.

---

### E2 — No box / لا صندوق

| Wrapper | CSS that paints a square | Current verdict |
|---|---|---|
| THINK node `.sc18-node` | `console.css:371-378` — 11×11px, `border-radius:2px`, `border:1px solid var(--line-strong)`, `background:var(--bg2)`. `chat.css:2704-2716` — 13×13px pill + `box-shadow: inset 0 0 0 1px …`. | **Neutralised for THINK only**, by inline `border:none; background:none; boxShadow:none; borderRadius:0` at `StreamTimeline.tsx:450-457`. Fragile: markup-level patch cannot remove a pseudo-element; any future CSS `::before/::after` on this socket will re-box the circle and no guard will notice. Non-THINK bands keep the square by design. |
| Phase chip `.sc18-phase-stamp.sc-monogram-stamp` | `stream-motion.css:187-198` — `border:1px solid color-mix(…30%)`, `border-radius:4px`, `background:color-mix(…7%)`, `overflow:hidden`. `chat-art.css:116-119` adds `border:1px …; border-radius:2px`. | **STILL A VISIBLE BOX** around the word "THINK". `StreamTimeline.tsx:472` mounts it for every band; `:480` replaced the inner circle with an empty `<span data-phase-mark="sc18-phase-mark">`. The circle came out of the box — the box stayed. If this is the "box" he meant, the fix is incomplete. |
| Composer card `.sc-deck.composer-card` | `chat.css:1577-1585` — `border:1px`, `border-radius:var(--radius-md)`, `background:var(--panel)`, `box-shadow:var(--sh-card)`. | Unchanged by this wave. It is a large rounded rectangle at the bottom of the panel. If "no box" was about the *circle's frame*, irrelevant; if about the panel's overall boxiness, untouched. |
| Context lens popover `.lens-haircard` | `chat-final.css:435-448` — 280px wide, `border:1px`, `border-radius:2px`, `background:var(--panel)`, plus a 0.16s one-shot settle. | New in v11.24 (`chat-final.css` §7). A deliberate card — but it is literally a box with a border that appears on click. Worth flagging if "no box" was a global aesthetic instruction. |

**Verdict:** the *immediate* square around the THINK circle is gone. The **box around the "THINK" label is not.** Two different agents edited markup and CSS respectively; neither removed the other's box.

---

### E3 — No ring / wave decor / لا حلقات ولا موجات زخرفية

**EN.** This is where the wave was edited hardest and where the most decor survives. The big glyph's rings are gone from markup, but the same grammar lives on in four other components:

| Still-rendered decor | Exact source | What the eye sees |
|---|---|---|
| Outer faint ring `r=11` + breathing `r9→10` | `MessageView.tsx:615-619` (40px orbit, 24-unit grid, `values="9;10;9"` dur 2.4s) | A circle that *breathes wider and narrower* — a literal ring/wave. |
| Breathing `r14→15`, `r10→11` | `MessageView.tsx:1226, 1229` (30px reasoning orbit) | Two more breathing rings. |
| Waveform bars | `MessageView.tsx:405-421` (`LiveWave`, 4 `<i>`, heights change with token cadence; mounted `:1406`) + `tool-story.css:131-148` (`tsg-wave-breathe 1s infinite`) | An actual animated **wave** beside the reasoning text. Untouched in this wave (`MessageView.tsx` mtime 08:37 — **never edited by the v11.24 agents**). |
| Sweeping hairline over phase word | `stream-motion.css:206-223` — `::after`, width 45%, height 1px, `transform:translateX(-130%) → 260%`, `animation:phase-flow 2.2s linear infinite`. The gradient was removed at 12:02 but the **motion was kept**. | A thin line repeatedly slides across the "THINK" stamp. This is simultaneously "wave decor" **and** "trembling text". |
| Spark ring + orbiting dot, bloom ring | `chat-final.css:528-561` (`.mv-live-spark::before/::after`), `:563-588` (`.mv-tool-bloom::after` radiating `scale(0.92→1.5)`) | A second ring and a one-shot radiating halo. |
| Circular voice waveform | `Composer.tsx:407-409`, `voice-input.css:60-111` | A ring of radial ticks around the mic. |

**Verdict: FAIL.** "No ring/wave decor" was implemented as *delete one SVG's graduation ring*, not as a design-system decision. The dominant live wave (`LiveWave`) and the per-row breathing rings were never touched. SSRs pass because no guard counts animations across components.

**AR.** الحلقات والموجات **لم تختفِ**؛ نُقلت. الدائرة الكبيرة أُزيلت، لكن حلقة `r11` والتنفّس `r9→10` في `MessageView.tsx:615-619`، والتنفّس `r14→15` في `:1226`، وأعمدة الموجة `:405-421`، والخط اللامسحاب فوق كلمة THINK في `stream-motion.css:206-223` كلها ما زالت تُرسم. الحكم: **فشل**.

---

### E4 — No trembling text / لا نص يرتجف

| Fixed | Remaining |
|---|---|
| `ChatPanel.tsx:526-543` — run strip now renders ONE stable gerund + clock; the rotating/crossfading keyed word is gone. `console.css:309-316` — `.run-strip-v13 .sc-status-label { animation: none !important; -webkit-text-fill-color: currentColor !important; }` kills the old `sc-shimmer` (`chat.css:755, :832`) inside the strip. This is a genuine, well-scoped fix. | `stream-motion.css:206-223` still sweeps a 1px hairline over the phase word **every 2.2s forever**. `ChatPanel.tsx:1604-1613` session-loading skeleton uses `.shimmer` rows (`styles.css:2011`). `chat-status-v13 i:first-child` pulses at 1.3s (`console.css:255-257`). |

**Verdict: MOSTLY fixed, one clear residual.** The founder's "trembling text" is most plausibly the gerund crossfade — that is gone. But if he points at the band header, the sweeping hairline will still read as text shimmer. Note the agents deliberately replaced a `linear-gradient` with a flat line at 12:02 while keeping `infinite` — that is a *test-friendly* change (gradient string disappears) that **does not change the motion he complained about**.

---

### E5 — Natural-size focus mode / وضع التركيز بالحجم الطبيعي

| Rule | Source | Rendered consequence |
|---|---|---|
| Focus slot fills row | `shell.css:59-72` — `html[data-focus='on'] .app-main-row-v12 > .chat-slot-v12 { flex:1 1 auto !important; }`; hide `.chat-resizer` and `.work-slot-v12`. Comment explicitly bans reading measure, centering, frame, border, shadow, margins. | Chat becomes the single full-width flex item. **No zoom, no frame, no shrunken column.** Looks right for "natural size". |
| State mirror | `App.tsx:227` writes `html.dataset.focus`; `:239` `workArea = focusMode ? null : …`; `:345` rail hidden; `:356` status bar hidden. `ChatPanel.tsx:1327` applies `.is-focus`; `chat.css:62-66` sets `width:100%`. | Wiring is coherent; `html[data-focus='on']` selectors will match. |
| Residual caps | `chat.css:83-93` transcript children capped **720px (cozy) / 980px (wide)**; `chat.css:1567-1573` composer children capped **760px, centered** in focus. | Full-width panel, but text/composer stay centered with wide side gutters. This is a deliberate reading measure, not a bug — but if "natural size" to him means "fills the window edge-to-edge", this is the one place that will still look "wrong". **Low risk.** |

**Verdict: PASS with a caveat.** This is the best-executed of the six fixes.

---

### E6 — Small circle inside the timeline strip / دائرة صغيرة داخل شريط الخط الزمني

| Element | Geometry | Inside the strip? |
|---|---|---|
| `ThinkOrbit` — `StreamTimeline.tsx:461` | 16px SVG, 12-unit grid, effective r5→**6.67px** painted radius, 1px strokes, inside `.sc18-node` (11px, box-neutralised) on a 14px rail (`chat.css:2690`). | **Yes** — but the painted circle is wider than both its socket and its rail. |
| `CompactThinkingOrbit` — `MessageView.tsx:594-646`, mounted `:3714` | **40px** SVG, 24-unit grid, r11 outer + r9 breathing + r5 + arc + tick + orbiting node; `position:absolute; insetInlineStart:-24px; insetBlockStart:-2px` (`:608`). | **No.** It hangs 24px out into the row gutter. It is 2.5× the size of the "small" rail circle. |
| `PrecisionThinkingOrbit` — `MessageView.tsx:1209-1255`, mounted `:1392` | 30px, 32-unit grid, r14/r10/r6. | No — it is in the reasoning head. |

`ChatPanel.tsx:1601-1603` claims "A4 mounts the ONE small circle inside the timeline strip (MessageView)". That statement is **factually wrong in this checkout**: the one on the rail is mounted by `StreamTimeline.tsx:461`, and `MessageView.tsx:3714` mounts an additional 40px one inside every assistant row. Two agents believe they each own "the one circle".

**Verdict: FAIL, literally.** There is no single small circle inside the strip — there is a 16px one on the rail and a 40px one leaking out of every row, plus a 30px one in the head.

---

## 2. The single most likely thing STILL wrong / الشيء الأرجح أن يظل خطأً

> **`src/components/MessageView.tsx:594-610` (and its mount at `:3714`) — the 40px `CompactThinkingOrbit` parked at `inset-inline-start: -24px`, coexisting with `src/components/StreamTimeline.tsx:461` (16px `ThinkOrbit`).**

**EN.** This is the highest-probability complaint after this wave, for three independent reasons:

1. **It directly contradicts two of his six asks at once.** He asked for *one* circle, *small*, *inside the timeline strip*. Source now renders a **40px** circle **outside** the strip (offset −24px) on **every assistant row**, while a second 16px circle sits on the rail of the same THINK band. Within one screen-height, the two are ~24px apart and will read as a **clustered pair of spinning discs**, not a single precise mark. The 40px one is the largest circle left anywhere in the chat panel — the big 80px one was deleted on the theory that size was the problem; the size problem simply moved into the gutter.
2. **Neither agent can see the other's circle.** The v1124 "one circle" guard (`v1124-think-circle.test.mjs:206-208`) counts circles *in the THINK band only* and passes with exactly one. The per-row orbit is blessed by a different, older suite (`v1122-graphics-msg`, `v1121-circle`) as "one per assistant row". Every guard is green; the screen is not. This is the exact failure pattern the founder has already complained about twice (`GRAPHICS-V1122.md:59`, `GRAPHICS-V1123.md:163-171`).
3. **It was never touched by the 17-agent wave.** `MessageView.tsx` mtime is **08:37**, while the wave edited files at 11:55–12:15. The agents fixed the big circle in `ChatPanel.tsx` and the rail circle in `StreamTimeline.tsx` and the label in `console.css`; they did not open the file that holds the biggest surviving spinner. A fix that skips the largest instance is not a fix.

** runner-up (same root cause):** `stream-motion.css:206-223` — the infinite 1px sweep across the THINK word. It was edited at 12:02 specifically to remove the word "gradient" while keeping the motion. A source test will call this fixed; his eye will call it shimmer.

**AR.** الأرجح أن يظل خطأً هو **الدائرة 40px في `MessageView.tsx:594-610`** (المُركّبة في `:3714`) بموضع `-24px` خارج الشريط، مع وجود دائرة ثانية 16px على السكة في `StreamTimeline.tsx:461`. المؤسس طلب «واحدة صغيرة داخل الشريط»؛ الموجود اثنتان، إحداهن 40px وتخرج من الصف. الاختبارات ترى «واحدة في كل سطح» فتنجح، والعين ترى قرصين متجاورين. والملف نفسه لم يلمسه وكلاء الموجة إطلاقًا (آخر تعديل 08:37).

---

## 3. Ranked visual risks / المخاطر البصرية مرتبة

| # | Risk | Exact location | Why a green test misses it | Severity |
|---|---|---|---|---|
| **R1** | Two/three spin circles visible at once (16px rail + 40px gutter + 30px head); the biggest leaks outside the strip | `MessageView.tsx:594-610`, `:3714`; `StreamTimeline.tsx:461`; `MessageView.tsx:1209-1255, :1392` | Guards count per-surface, not per-viewport; `/<svg…circle/` scoped to the THINK band | **CRITICAL** |
| **R2** | Header anchor is now empty — the "one circle in the right place" disappeared from where he was looking; only a 4px pulse remains | `ChatPanel.tsx:1395-1399, :1601-1603`; `console.css:247-257` | SSR proves the big glyph string is absent — which the test treats as success | **HIGH** |
| **R3** | Wave/ring decor survives in the transcript: breathing radii, 4-bar LiveWave, spark ring, radiating bloom | `MessageView.tsx:405-421, :615-619, :1226-1229`; `chat-final.css:528-588`; `tool-story.css:131-148` | No guard asserts cross-component absence of `animate`/`animation` on round things; `MessageView.tsx` untouched | **HIGH** |
| **R4** | Infinite hairline sweep over the "THINK" word = residual "trembling text"/wave | `stream-motion.css:206-223` | Gradient string removed → text-based "no gradient" check passes; `infinite` motion retained | **HIGH** |
| **R5** | Bordered 4px-radius chip still boxes the THINK label; the inner circle left but the frame stayed | `StreamTimeline.tsx:472, :480`; `stream-motion.css:187-198`; `chat-art.css:116-119` | `v1124-think-circle.test.mjs:218` only scans for *Tailwind square classes* and `.sc18-phase-mark` — the chip is a semantic class in CSS | **MEDIUM** |
| **R6** | 16px circle on a 12-unit grid paints a 13.3px disc inside an 11px socket on a 14px rail — geometry "precise" in source, overflowing on screen | `StreamTimeline.tsx:304-349, :461`; `console.css:371-378, 1232-1240`; `chat.css:2690-2693` | The test asserts integer *source* radii `[5,2]` and literal `width="16"`; never computes painted radius = 16/12×5 | **MEDIUM** |
| **R7** | Focus mode: full-width but transcript 720/980px and composer 760px capped → wide gutters may read as "not natural size" | `shell.css:59-72`; `chat.css:83-93, :1567-1573` | Guards assert `data-focus` wiring and class names, not rendered gutters | **LOW** |
| **R8** | Four generations of dead circle CSS coexist; a future edit can resurrect an old glyph by cascade accident | `console.css:1045-1079, 1190-1198, 1333-1355`; `chat-final.css:55`; `chat-art.css:20` | Dead CSS isn't parsed by SSR assertions | **LOW (latent)** |

---

## 4. What I did NOT verify / ما لم أتحقق منه — honesty limits

- **No screenshot, no browser, no dev server, no computed styles.** I never saw a pixel. I am ranking *risks inferred from geometry*, not reporting observed rendering.
- I did **not** run the v1124 test suites myself; I read their assertions. They are in-flight artifacts alongside `.v1124-full-smoke-screen-*.cjs` dumps created at 12:03.
- The 17 agents were still writing. `ChatPanel.tsx` changed twice during this audit and lost ~13 KB between reads. Any line number may shift. Re-run this audit against the final tree.
- I did not check `dist/` or `build/` — the founder may be looking at a **stale installed build**. `docs/DIAG-LOGS.md:5` records that an earlier "fix" was never built into the app that produced the user's logs. If the graphics are correct in source and still wrong on his screen, **check the bundle before touching more CSS**.

---

## 5. Recommendation to the parent (no edits made) / توصية للمشرف

1. **Decide, in one sentence, what "the one circle" is and where it lives.** The current source cannot answer: `ChatPanel.tsx:1601` says `MessageView` owns it; `StreamTimeline.tsx:461` mounts another. One owner, one mount.
2. **Then cross-component-grep, not per-file-grep**: count every `<svg>` that draws a circle and every `animateTransform`/`animate attributeName="r"` across `ChatPanel.tsx`, `MessageView.tsx`, `StreamTimeline.tsx`, `ContextLens.tsx`, `Composer.tsx`. The founder counts what he sees, not what a per-file guard scopes.
3. **Remove `inset-inline-start:-24px`** from `MessageView.tsx:608` if the circle is meant to be *inside* the strip — or delete the per-row orbit entirely if the rail circle is the chosen one. Keeping both is the worst outcome.
4. **Kill the `infinite` on `stream-motion.css:217`** if "trembling text" is still on the table; a one-shot settle is not the same as a 2.2s loop.
5. **Add a real visual gate** (screenshot / headless computed-style assertion on bounding boxes and `animation-name`) before declaring victory. String guards have now failed to predict the founder's reaction twice.
6. **Verify the installed build matches source** before the next round of CSS edits.

---

## 6. One-line verdict / الحكم في سطر

**EN:** The wave deleted the obvious defects and replaced them with distributed ones; the single most likely remaining sight-line failure is the **40px gutter orbit at `MessageView.tsx:594-610` (`:3714`) overlapping the 16px rail orbit at `StreamTimeline.tsx:461`** — and every source guard will still be green when he complains.

**AR:** الموجة حذفت العيوب الواضحة ووزّعتها على ملفات أخرى؛ أقرب سبب لشكواه القادمة هو **الدائرة 40px في `MessageView.tsx:594-610` (`:3714`)** وهي تتجاور مع دائرة 16px في `StreamTimeline.tsx:461` — وكل الاختبارات ستظل خضراء وقتما يشتكي.

*Diagnosis only. No application source was modified by this review.*
