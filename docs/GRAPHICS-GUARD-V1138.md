# GRAPHICS GUARD V1138 — G3 overhaul verification / حارس الرسوم G3

> **Scope / النطاق:** diagnosis + test only. This guard authored **two files** —
> `tests-v1138-graphics-guard.mjs` (root script) and this document. **No
> application source was changed.** A temporary self-test mutation was restored
> byte-for-byte (`RESTORED=true`) before the final green run.
>
> **Run / التشغيل:** `node tests-v1138-graphics-guard.mjs`
> → **27/27 PASS, 0 FAIL**, exit 0. Results:
> `tests/.v1138-graphics-guard.results.json`.

---

## 0. Blunt verdict / الحكم بصراحة

**EN — CRAFTED, NOT NOISE.** The graphics overhaul did not spend its budget on
decoration-for-its-own-sake. All six signature animations survived intact, and
so did all **103** baseline keyframes — nothing was silently deleted to make the
sheet "cleaner". The paint surface is genuinely disciplined: zero hex paint, zero
soft gradient boxes, zero shadowed cards, one 1px hairline grammar, tabular mono
for every figure, Instrument Serif with an explicit Cairo fallback, logical RTL
geometry, both reduced-motion kill-switches in every animated sheet, and perfect
brace balance. This is an instrument panel, not a slot machine.

It is **not spotless**, and I won't pretend otherwise: three pre-existing
patterns are consciously *allowed* (§4) — two hex tokens that are alpha masks
(not paint), one geometric 50% orbit centre, one 2px background-coloured
separation ring on an agent node. Ambient orbits still loop infinitely, but every
one of them is frozen by both motion guards. So: **crafted, with three
documented, harmless leftovers — not noise.**

**AR — حِرَفِيّة، لا ضجيج.** لم تُنفق إعادة تصميم الرسوم ميزتها على زخرفة بلا
غرض. حيّت الرسوم الستة المميزة كاملة، وكذلك **103** إطار مفتاحي أساسي — لم يُحذف
شيء بصمت ليبدو الملف «أنظف». سطح اللون منضبط فعلاً: صفر قيم سداسية للطلاء، صفر
تدرّجات مربّعة، صفر بطاقات بظلال، قاعدة شعرية واحدة بعرض 1px، أرقام أحادية
بتباعد جدولي، و«إكسترومنت سيريف» مع بديل صريح «كايرو»، وهندسة منطقية للـRTL،
وحاجزا إيقاف للحركة في كل ملف متحرك، وتوازن أقواس كامل. هذه لوحة أجهزة، لا آلة
قمار.

لكنها **ليست بلا عيوب** ولن أدّعي ذلك: ثلاثة أنماط قديمة مسموح بها قصداً (§4) —
قيمتا hex داخلتان في قناع شفافية (ليستا طلاءً)، ومركز مدار هندسي عند 50%، وحلقة
فصل بعرض 2px بلون الخلفية حول عقدة وكيل. المدارات المحيطة ما زالت تدور بلا نهاية،
لكن كلّها تُجمَّد بحاجزي الحركة. الخلاصة: **حِرَفِيّة، مع ثلاث بواقٍ موثّقة
وغير مؤذية — ليست ضجيجاً.**

---

## 1. Method / المنهج

Pure **source assertions** — no esbuild, no SSR, no stubs; runs in milliseconds.
Every scan runs on **comment-stripped** code so a parked "removed" note cannot
game a guard, while every reported line number comes from the **raw file** so it
matches the editor exactly.

- **Owned CSS (12 sheets):** chat-art, tool-story, chat-final, stream-motion,
  subagents, voice-input, panels/dna-art, art, console, chat, dna, display-type.
- **Strict art sheets (8):** the first eight — they own the 1px hairline paint
  grammar. `console.css` / `chat.css` / `dna.css` are chrome/support sheets
  (checked for hex, RTL, motion, braces — not banned for chrome shadows).
- **Source-of-truth probes:** `styles/tokens.css` (font stacks),
  `assets/glass-v7.css` (@font-face), `StreamTimeline.tsx` (SMIL orbit),
  `MessageView.tsx` (bloom mount).

---

## 2. Signature animations — all present / الرسوم المميزة موجودة كلها

| # | Signature | Exact hook → file:line | Status |
|---|---|---|---|
| 1a | spinning circle | `@keyframes art-orbit` — `src/components/stream-motion.css:343` | ✅ PASS |
| 1b | spinning circle | `@keyframes cp-orbit` — `src/components/console.css:1128` | ✅ PASS |
| 1c | spinning circle | `<animateTransform>` in `ThinkOrbit` — `src/components/StreamTimeline.tsx:325` | ✅ PASS |
| 2a | ink flow | `@keyframes art-ink-flow` — `src/components/chat-art.css:363` | ✅ PASS |
| 2b | ink flow | `@keyframes craft-ink-flow` — `src/components/tool-story.css:503` | ✅ PASS |
| 3a | tool bloom | `@keyframes mv-bloom-in` — `src/components/chat-final.css:527` | ✅ PASS |
| 3b | tool bloom | `@keyframes mv-bloom-ink` — `src/components/chat-final.css:642` | ✅ PASS |
| 3c | tool bloom | `status === 'done' && <ToolBloom />` — `src/components/MessageView.tsx:3076` | ✅ PASS |
| 4 | orb pulse | `@keyframes vi-orb-pulse` — `src/components/voice-input.css:228` | ✅ PASS |
| 5 | DNA growth | `@keyframes dn-rule-draw` — `src/components/panels/dna-art.css:39` | ✅ PASS |
| 6 | sheen | `@keyframes tv-sheen` — `src/components/chat.css:2918` | ✅ PASS |

**No removed keyframes:** all **103/103** baseline `@keyframes` survive, and none
is a gutted stub (`1-KF-COUNT`, `1-KF-ALIVE`). The bloom is mounted **only** on a
real `status === 'done'` — it is not fired on every streaming tick.

---

## 3. Quality invariants / الثوابت النوعية

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | no hex paint in owned CSS | **PASS** | `2-HEX`: 0 paint literals |
| 2 | no soft/boxing gradient | **PASS** | `2-GRADIENT`: only hard-stop 1px engravings |
| 3 | no paint box-shadow in art sheets | **PASS** | `2-SHADOW`: only `none` locks + one documented ring |
| 4 | no boxy (rounded + filled + shadowed) card | **PASS** | `2-BOX`: 0 |
| 5 | no-box lock on tool row | **PASS** | `console.css:421` — `border:0 / radius:0 / background:none / shadow:none !important` |
| 6 | agent card de-boxed | **PASS** | `subagents.css:16` — same frame-free lock |
| 7 | tabular mono | **PASS** | `3-TABULAR`: 5/8 sheets carry `tabular-nums`, `'tnum'` feature present |
| 8 | Instrument Serif + Cairo fallback | **PASS** | `tokens.css:63` serif stack ends `…, 'Cairo', serif`; ar stack = Cairo; @font-face at `glass-v7.css:60` |
| 9 | RTL display guard | **PASS** | `display-type.css:70` resolves every serif title to Cairo under `ar`/`rtl` |
| 10 | RTL logical properties | **PASS** | `4-RTL`: 0 physical side declarations in art sheets |
| 11 | both reduced-motion guards | **PASS** | `5-REDUCED-MOTION`: both `prefers-reduced-motion: reduce` and `html.reduce-motion` in all 11 animated sheets; 1 motionless sheet exempt |
| 12 | brace balance 0 | **PASS** | `5-BRACES`: 0 across all 12 owned sheets |

---

## 4. Allow-listed, documented patterns — NOT regressions / أنماط مسموحة

| ID | file:line | Why it is allowed |
|---|---|---|
| `2-MASK-HEX` | `src/components/chat.css:1232`, `:1233` | `#000` / `rgba(0,0,0,…)` live **only** inside `mask-image` — alpha masks, not palette paint. They fade the clamped `<pre>`, they don't colour it. |
| `2-HAIRLINE` | 11 sites (e.g. `chat-art.css:215`, `stream-motion.css:606`, `art.css:144`) | `repeating-linear-gradient(currentColor 0 1px, transparent 1px 26px)` and hard-stop `radial-gradient(… 0 2px, transparent 2.5px)` are the engraving texture — flat 1px ink, explicitly *not* a colour ramp or glow. |
| `4-GEOMETRIC-CENTER` | `src/components/subagents.css:207` | `left:50%; top:50%` anchors a node's connector to the **geometric centre of a circle** — identical in LTR and RTL; only the rotation mirrors. Not a linguistic edge. |
| ring (silent allow) | `src/components/subagents.css:165` | `box-shadow: 0 0 0 2px var(--bg3)` is a background-coloured separation ring on the agent node, not an elevated card or a glow. |

These are reported as `NOTE` lines (3 notes), never counted as failures. If G3
later removes them, no test breaks; if a **new** one of these patterns appears
anywhere else, it fails immediately with its exact `file:line`.

---

## 5. Regression reporting — proof / إثبات الإبلاغ عن التراجع

Every finding carries an exact `file:line`. A **self-test** temporarily mutated
`chat-art.css` (removed `art-ink-flow`, injected `color: #ff8800;`) and the guard
failed with:

```
FAIL S2-INK-A [src/components/chat-art.css:363 (MISSING)]: ink flow (art-ink-flow): REMOVED
FAIL 1-KF-COUNT: 102/103 baseline keyframes survive — REMOVED: art-ink-flow@src/components/chat-art.css:363
FAIL 2-HEX: no hardcoded hex paint in owned CSS — src/components/chat-art.css:194 :: color: #ff8800;
```

The file was restored byte-for-byte (`RESTORED=true`) and the final run is
green. So the guard is not a rubber stamp: a removed keyframe, a gutted keyframe,
a new hex literal, a soft gradient, a paint shadow, a boxy card, a physical RTL
edge, a missing motion guard, or an unbalanced brace all produce a precise
location a fixing agent can act on.

---

## 6. Honest caveats / تحفّظات صادقة

- This is a **source-level** guard. It does not render the UI in a browser;
  animation smoothness and perceived elegance are judged structurally, not
  visually. `TOOL-ART-V1134` remains the visual companion report.
- Ambient orbits (`art-orbit`, `cp-orbit`, `vi-orb-pulse`) still loop with
  `infinite`. That is intentional "alive" motion, and all of it is killed by
  both reduced-motion signals — verify that end state in a real browser if the
  founder wants zero perpetual motion.
- The owned sheet list is explicit at the top of the script. If G3 adds a new
  CSS sheet, add it to `OWNED` (and `ART_SHEETS` if it owns the paint grammar)
  so the guard covers it.

---

## 7. Verdict in one line / الحكم في سطر

**EN:** More crafted, not noise — the craft is in what was *kept* (103 keyframes,
six signatures) and what was *refused* (hex paint, gradient boxes, shadowed
cards, unguarded motion); the only blemishes are three documented, harmless
leftovers. **AR:** أكثر حِرَفِيّة لا ضجيج — الحِرَفِيّة في ما **أُبقي** (103 إطار
مفتاحي، ست رسوم مميزة) وفي ما **رُفض** (طلاء hex، تدرّجات مربّعة، بطاقات بظلال،
حركة بلا حاجز)؛ العيوب الوحيدة ثلاث بواقٍ موثّقة غير مؤذية.
