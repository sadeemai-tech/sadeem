# TIMELINE CIRCLE MERGE — v11.24 Guard Report / تقرير حارس دمج الدائرة في الشريط الزمني

**Mode / النمط:** DIAGNOSIS + TEST ONLY — no app source was touched by this agent.
**Files owned by this agent:** `tests/v1124-timeline-guard.test.mjs`, this document.
**Snapshot time:** 2026-11-20 ~12:18 (local). A3 settled at 12:01:50; A4 landed its **first half** at 12:15:03 and was still editing CSS at 12:15:34.

---

## blunt verdict / الحكم بلا مجاملة

**FAIL — HALF DONE. Do not sign off.** / **فاشل — نصف منجز. لا تُوقّع.**

The founder asked for ONE small spinning circle, shrunk and placed **inside** the timeline/run strip, replacing the indicators there — with **no big standalone circle next to WORKING** and no second copy in the message gutter.

What actually landed:

| Demand / الطلب | Status / الحالة |
|---|---|
| Remove the big standalone 80px `LiveThinkingPanel` circle | ✅ **DONE** — 0 source hooks, 0 SSR glyphs |
| Remove `cp-live-dots` / `cp-live-sweep` ring + wave (A3) | ✅ **DONE** — 0 in TSX, 0 in CSS, 0 in SSR DOM |
| Kill the rotating/trembling gerund (A3) | ✅ **DONE** — one stable `pickGerund` label remains |
| Put exactly ONE compact spinning circle **inside** the run/timeline strip | ❌ **NOT DONE** — the strip still contains **0 SVG circles** |
| Keep phase + elapsed time + mono token count **inside** that strip | ❌ **NOT DONE** — clock + phase label still vanish while text streams (`streamTailLive`) |
| Remove the second copy in the message-row gutter | ❌ **NOT DONE** — `CompactThinkingOrbit` still mounted at `MessageView.tsx:3450` |
| Reduced-motion static end state + bilingual labels | ❌ **CANNOT PASS** — there is no circle to freeze or localise yet |

A4 removed the thing the founder hated first, then stopped before adding the replacement. The user is currently left with **no live circle at all in the strip** and **one stale circle still sitting in the message gutter** — the exact opposite of "exactly one, inside the strip".

> طلب المؤسس: دائرة واحدة صغيرة، تُصغَّر وتوضع **داخل** شريط الخط الزمني/التشغيل، مع إزالة الدائرة الكبيرة المستقلة بجانب WORKING وبدون نسخة ثانية في هامش الرسالة.
> الذي نزل فعليًا: أُزيلت الدائرة الكبيرة المستقلة ✅، وأُزيلت الحلقة والموجة والكلمة الدوّارة ✅، لكن **لم تُضَف أي دائرة داخل الشريط** ❌، وما زالت نسخة الهامش القديمة موجودة ❌. النتيجة الحالية: صفر دوائر في الشريط وواحدة في الهامش — عكس المطلوب تمامًا.

---

## exact counts / الأرقام الدقيقة

`node --test --test-force-exit --test-reporter=spec tests/v1124-timeline-guard.test.mjs`

```
V1124_COUNTS={"stripSourceAnchor":"phase-strip run-strip-v13","bigPanelSourceHits":0,"gutterSourceHits":3,"ringWaveTsxHits":0,"ringWaveCssHits":0,"gerundTsxHits":0,"stripSvgSource":0,"ssrStripSvgs":0,"ssrStripSpinners":0,"ssrStandalonePanel":0,"ssrGutterOrbits":2,"ssrRingWave":0,"ssrStripHasClock":false,"ssrStripHasTok":true}
```

This guard: **12 tests · 6 pass · 6 fail**.

| Metric / القياس | Found / الموجود | Required / المطلوب |
|---|---:|---:|
| Big-panel hooks in `ChatPanel.tsx` | 0 ✅ | 0 |
| Standalone panel glyphs in SSR DOM | 0 ✅ | 0 |
| `cp-live-dots` / `cp-live-sweep` (TSX + CSS + SSR) | 0 ✅ | 0 |
| Rotating gerund (`rotateGerund`, `key={token}`) | 0 ✅ | 0 |
| Gutter-circle hooks in `MessageView.tsx` | 3 | 0 |
| Gutter orbits in SSR DOM (`sc-think-orbit`) | 2 | 0 |
| `<svg>` circles inside the run strip (SSR, running + streaming) | **0** | **1** |
| Spinning animation inside the strip | **0** | ≥1 |
| Real elapsed clock inside strip while streaming | **no** | yes |
| Mono `tok` count inside strip | yes ✅ | yes |
| Reduced-motion static circle | **absent** | present, frozen |
| Bilingual circle in EN + AR | **absent** | 1 circle in each |

---

## exact leftover locations / مواقع البقايا بالضبط

### A4 — partial / جزئي

* `src/components/ChatPanel.tsx:533` — `RunStatusLine` renders `<div className="phase-strip run-strip-v13 anim-in shrink-0">` **with no `<svg>` at all**. This is where the one compact circle must go.
* `src/components/ChatPanel.tsx:534-549` — the `streamTailLive` gate still hides the phase label (`:541-543`) and elapsed clock (`:544-546`) the moment answer text streams. The founder's "time" must stay visible **inside** the strip.
* `src/components/MessageView.tsx:3450` — `<CompactThinkingOrbit streaming={!!msg.streaming} />` is **still mounted in the assistant-row gutter**. Its wrapper is at `:524` (`className="sc-plate sc-think-orbit"`), its SVG at `:529` (`sc-think-orbit-svg`) and its absolute gutter offset at `:537` (`insetInlineStart: -24`). This is the "second copy" — it must be removed or relocated into the strip, not left where it is.
* `src/components/ChatPanel.tsx:1398-1399` and `:1601-1603` — new comments claim "the ONE small circle now lives in the timeline strip (MessageView)". **The code does not match the claim** — no such mount exists anywhere in `MessageView.tsx` (last write 08:37). Comments are not an implementation.

### A3 — done, one latent CSS remnant / منجز، بقايا CSS واحدة

* `src/components/chat.css:832` — `.sc-status-label` still declares `animation: rp-xfade …, sc-shimmer 4s var(--ease-out) 600ms infinite`. `console.css` overrides it visually for the run strip, but the infinite tremble declaration is still in the tree. This is the only A3 item still red.
* `cp-live-dots` / `cp-live-sweep`: **0 hits** in TSX, CSS and SSR DOM — fully removed. Good.
* `rotateGerund` / `GERUND_ROTATE_MS` / `key={token}`: **0 hits**. Good.

---

## all chat-graphics suites — exact run counts / نتائج كل مجموعات الرسوم

| Suite / المجموعة | tests | pass | fail |
|---|---:|---:|---:|
| `v1124-timeline-guard.test.mjs` (this guard) | 12 | 6 | **6** |
| `v1121-circle.test.mjs` | 9 | 5 | **4** |
| `v1121-context-orb.test.mjs` | 10 | 10 | 0 |
| `v1122-graphics-guard.test.mjs` | 1 | 0 | **1** (top-level crash) |
| `v1122-graphics-msg.test.mjs` | 9 | 9 | 0 |
| `v1122-graphics-panel.test.mjs` | 13 | 2 | **11** |
| `v1123-circle-dedupe.test.mjs` | 8 | 4 | **4** |
| `v1123-graphics-guard.test.mjs` | 13 | 11 | **2** |
| `v1123-think-icon.test.mjs` | 8 | 8 | 0 |
| **TOTAL / الإجمالي** | **83** | **55** | **28** |

`v1122-graphics-guard.test.mjs` does not even load: `tests/v1122-graphics-guard.test.mjs:71` throws `SVG block carrying "cp-live-glyph" exists` — entire suite is dead because the glyph was removed.

**These are expected collateral, not new regressions.** The legacy suites assert the OLD end state (one 80px `LiveThinkingPanel` + one gutter orbit). They must be rewritten by their owning agents once A4 finishes.

---

## what the guard locks / ما الذي يثبّته الحارس

1. **Source (comment-stripped):** zero big-panel hooks; zero *gutter* mounts; exactly one compact `<svg>` inside `RunStatusLine` with a spin hook; real `formatElapsedClock` + mono token count + i18n phase label inside that strip; zero `cp-live-dots`/`cp-live-sweep`, zero timer-driven gerund, zero dead shimmer CSS.
2. **SSR (real `renderToStaticMarkup` of the real `ChatPanel`):** while running and streaming — exactly one `<svg>` inside the live strip (the stable `.run-strip-v13` anchor is preferred, but any strip-like element carrying circle + clock + `tok` is accepted), clock and `tok` text inside it, no `cp-live-glyph`, no `width="80"`, no ring/wave, and no `sc-think-orbit` outside that one strip; while idle — no circle at all.
3. **Reduced motion:** circle still present (static end state), zero `<animateTransform>` and zero `<animate >` inside the strip, instruments still real.
4. **Bilingual:** EN and AR strip text differ, Arabic glyphs present, one circle in each.

All source scans strip JSX/block/line comments first — parking a banned token inside a comment will not satisfy this guard.

---

## conflicts with legacy suites (warning to parent) / تحذير للوالد

These existing suites assert the **old** end state and are now failing en masse. They must be updated by the owning agents — this agent did not touch them:

* `tests/v1121-circle.test.mjs:88-111` — requires `LiveThinkingPanel` + `CompactThinkingOrbit` mounts.
* `tests/v1122-graphics-panel.test.mjs:95-105,209,272` — requires one 80px `cp-live-glyph` and `cp-live-sweep`.
* `tests/v1122-graphics-msg.test.mjs:135-136` — requires the gutter orbit mount (still passes only because A4 has not removed it yet; it will break when A4 does).
* `tests/v1122-graphics-guard.test.mjs:71,117` — hard top-level assertion on `cp-live-glyph`; suite cannot load.
* `tests/v1123-circle-dedupe.test.mjs:79-103,178-208` — requires the 80px panel in SSR.
* `tests/v1123-graphics-guard.test.mjs:272-283,303,313-314` — requires exactly one big panel + one gutter orbit.
* `tests/v1123-full-smoke.test.mjs:812-827` and `tests/v1122-full-smoke.test.mjs:746-754` — require `width="80"` glyph + gutter orbit.

---

## re-run / إعادة التشغيل

```powershell
cd "D:\New folder (58)\SADEEM-v11.12.0-source\src-pkg-v1112\sadeem-v11.12.0"
node --test --test-force-exit --test-reporter=spec tests/v1124-timeline-guard.test.mjs
```

**Do not sign off until this file is green and `V1124_COUNTS` shows `ssrStripSvgs: 1`, `ssrStripSpinners: ≥1`, `ssrStandalonePanel: 0`, `ssrGutterOrbits: 0`, `ssrStripHasClock: true`.**
**لا تُوقّع قبل أن يصبح هذا الاختبار أخضر ويُظهر العدّاد `ssrStripSvgs: 1` و`ssrStripSpinners: ≥1` و`ssrStandalonePanel: 0` و`ssrGutterOrbits: 0` و`ssrStripHasClock: true`.**
