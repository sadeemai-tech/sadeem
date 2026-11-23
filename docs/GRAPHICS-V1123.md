# GRAPHICS-V1123 — Graphics Guard Diagnosis / تشخيص حارس الرسوم

> **Scope / النطاق:** diagnosis + test only. This guard edited NO application
> source. Only two files were authored: `tests/v1123-graphics-guard.test.mjs`
> and this document. C1 / C2 / C3 made the code changes; this is the independent
> verification of their final state.

---

## 0. Blunt verdict / الحكم الصريح

**EN — YES, with one caveat.** The app logo is genuinely, provably GONE from
`StreamTimeline.tsx` (no import, no `ThinkBrand`, no brand SVG signature in the
SSR THINK band). There is exactly ONE primary live circle
(`LiveThinkingPanel` / `cp-live-glyph`) in the transcript, and the duplicate
`ChatLiveIndicator` / `chat-live-ring` "working" ring is gone from source and
from the SSR DOM. The THINK band now renders a real spinning circle with integer
radii, 1px strokes, a 12-o'clock tick, an equal-angle orbit and a reduced-motion
guard. **All 13 v1123 guards pass (13/13).**

**Caveat (NOT a graphics defect):** 5 *stale* assertions in the OLD
`tests/v1122-graphics-panel.test.mjs` still fail because they demand the
`sc-status-glyph` / `sc-status-orbit` mini-circle that C2 intentionally removed
as the duplicate. Those are obsolete tests, not broken graphics — they must be
updated by their owner (see §5). I did not touch them: out of scope.

**AR — نعم، مع تحفّظ واحد.** شعار التطبيق اختفى فعليًا ويمكن إثبات ذلك من
`StreamTimeline.tsx` (لا استيراد، لا `ThinkBrand`، ولا توقيع شعار SVG في شريط
THINK عند العرض). توجد دائرة واحدة رئيسية (`LiveThinkingPanel` /
`cp-live-glyph`) داخل المحادثة، وحلقة «قيد العمل» المكرّرة
`ChatLiveIndicator` / `chat-live-ring` اختفت من المصدر ومن الـDOM. شريط THINK
يعرض الآن دائرة دوّارة حقيقية بأنصاف أقطار صحيحة وحدود 1px وعلامة الساعة 12
ودوران بزوايا متساوية وحاجز لحركة تقليل الحركة. **كل اختبارات v1123 نجحت
(13/13).**

**التحفّظ (ليس عيبًا في الرسوم):** 5 تأكيدات قديمة في
`tests/v1122-graphics-panel.test.mjs` ما زالت تفشل لأنها تطلب الدائرة الصغيرة
`sc-status-glyph` / `sc-status-orbit` التي أزالها C2 عمدًا بصفتها المكرّرة.
هذه اختبارات عتيقة، لا رسوم مكسورة — يجب على صاحبها تحديثها (انظر §5). لم ألمسها:
خارج نطاقي.

---

## 1. Exact counts / الأعداد الدقيقة

Every source scan runs on **comment-stripped** code. A previous agent parked
banned tokens inside comments to game the guards; this guard refuses to be gamed
(test `0` proves the stripper works).

| Symbol | Count | Required | Status |
|---|---:|---:|---|
| `<Logo` in `StreamTimeline.tsx` | **0** | 0 | ✅ PASS |
| `ThinkBrand` in `StreamTimeline.tsx` | **0** | 0 | ✅ PASS |
| rotating circle in `StreamTimeline.tsx` | **1** (`sc18-think-orbit`) | ≥1 | ✅ PASS |
| `ChatLiveIndicator` in `ChatPanel.tsx` | **0** | 0 | ✅ PASS |
| `chat-live-ring` in `ChatPanel.tsx` | **0** | 0 | ✅ PASS |
| `chat-live-ring` in SSR DOM (running) | **0** | 0 | ✅ PASS |
| `<LiveThinkingPanel` mounts (all TSX) | **1** | 1 | ✅ PASS |
| `<CompactThinkingOrbit` mounts (all TSX) | **1** | 1 | ✅ PASS |
| `<ContextLens` mounts (all TSX) | **1** | 1 | ✅ PASS |
| logo signature in SSR THINK band | **absent** | absent | ✅ PASS |

`V1123_COUNTS={"stream_logo":0,"think_brand":0,"chat_live_indicator":0,"chat_live_ring":0,"live_thinking_panel_mounts":1,"compact_orbit_mounts":1,"context_lens_mounts":1}`

---

## 2. Before / after evidence / الأدلة قبل وبعد

### Defect A — app logo on THINK (`StreamTimeline.tsx`) → FIXED

**BEFORE (found by this guard, 2026-11-20):**
- `StreamTimeline.tsx:34` — `import { Logo } from './Logo';`
- `StreamTimeline.tsx:198` — `const ThinkBrand: BandIcon = ({ size = 12 }) => <Logo size={size} />;`
- `StreamTimeline.tsx:201` — `think: { icon: ThinkBrand, brand: true, ... }`
- `StreamTimeline.tsx:347` — `<meta.icon size={9} .../>` rendered that `<Logo>` into the node.
- SSR proof: `<svg width="9" height="9" viewBox="0 0 1024 1024" aria-label="SADEEM">` + `<rect ... fill="#A3E635">`.
- Old stamp rings were fractional `r="4.2"` / `r="1.7"`; no `animateTransform`, no tick, no reduced-motion guard.

**AFTER (verified in final source):**
- No `Logo` import, no `ThinkBrand`, no `brand` flag.
- `StreamTimeline.tsx:199` — `think: { icon: ThinkOrbit, ... }`
- `StreamTimeline.tsx:293-327` — `function ThinkOrbit`: `<svg className="sc18-think-orbit" viewBox="0 0 12 12">`, rings from `PHASE_MARKS.think` snapped to integers `r="5"` / `r="2"` (`:220-221`), all `strokeWidth="1"`, 12-o'clock tick `d="M6 1v2"` (`:315`), node ring `r="2"` + core `r="1"` parked at 12 o'clock, equal-angle `animateTransform type="rotate" from="0 6 6" to="360 6 6"` (`:320-324`).
- `StreamTimeline.tsx:263-284` — `thinkMotionAllowed()` / `useThinkMotion()`: `prefers-reduced-motion: reduce` OR `html.reduce-motion` removes rotation; `const animate = live && motionAllowed` gates the SMIL; `:433` mounts `<ThinkOrbit size={12} live={live} />` so it spins only while the band streams.
- SSR proof: THINK band renders no `1024` grid, no `#A3E635`, no `aria-label="SADEEM"`. Under reduced motion the circle is drawn but has zero `animateTransform`.

### Defect B — duplicate "working" ring (`ChatPanel.tsx`) → FIXED

**BEFORE:**
- `ChatPanel.tsx:211` — `function ChatLiveIndicator() {`
- `ChatPanel.tsx:235` — `<span className="chat-live-ring" ...><i className="chat-live-dot" /></span>`
- `ChatPanel.tsx:1799` — `<ChatLiveIndicator />` in the header.
- A second mini-circle `sc-status-orbit` also lived in the run strip.
- SSR proof: running render emitted 1 `chat-live-ring` — a duplicate live ring beside "LIVE".

**AFTER (verified):**
- No `ChatLiveIndicator`, `chat-live-ring`, `chat-live-dot`, `chat-live-label`, `chat-live-clock`, `chat-live-tok` anywhere (source or DOM).
- `ChatPanel.tsx:542-545` — explicit removal note where the run-strip mini-circle used to be; the gerund/clock/phase steps stay.
- The one authorised live circle is `LiveThinkingPanel` (`ChatPanel.tsx:677` def, `:1918` mount, `cp-live-glyph` at `:764`). Verified exactly one across all TSX and one in the SSR DOM.

### Already-correct invariants (verified, leave alone)

- `MessageView.tsx:3714` — one `<CompactThinkingOrbit>` per assistant row (`sc-plate sc-think-orbit`, `sc-think-orbit-svg`).
- `MessageView.tsx:1214` — `sc-reason-orbit-svg` precision thinking circle; no `<Logo>`, no `ThinkEngraving`.
- `Composer.tsx:1977` — one `<ContextLens compact />`, mounted after `<VoiceInput>` (`:1942`); no `ctx-meter`/`ctx-track`/`ctx-fill`.
- `ChatPanel.tsx:1936` — `<Logo size={40} />` is the **empty-state** brand mark: the one permitted logo, not a live/reasoning position.

---

## 3. Test result / نتيجة الاختبار

```
node --test --test-force-exit tests/v1123-graphics-guard.test.mjs
# tests 13 · pass 13 · fail 0
```

Run with the inherited graphics suites:

```
node --test --test-force-exit --test-concurrency=4 \
  tests/v1123-graphics-guard.test.mjs \
  tests/v1122-graphics-guard.test.mjs \
  tests/v1122-graphics-panel.test.mjs \
  tests/v1122-graphics-msg.test.mjs \
  tests/v1121-circle.test.mjs \
  tests/v1121-context-orb.test.mjs
# tests 70 · pass 65 · fail 5   <- 5 = the stale panel assertions (§5)
```

**Pass criterion for v1123:** `0 fail`, `V1123_COUNTS` with all four banned
counts at `0` and all three mount counts at `1`. ✅ MET.

---

## 4. Transient condition observed (not a final defect)

While C1/C2/C3 were still writing, `src/store.ts` was read mid-edit and esbuild
reported `Expected "finally" but found ","`. It resolved on re-run once the
write completed; `store.ts` is valid in the final state. Noted for honesty — no
action needed.

---

## 5. Stale inherited tests — needs the parent's decision / اختبارات قديمة

`tests/v1122-graphics-panel.test.mjs` still asserts the now-removed
`sc-status-glyph` / `sc-status-orbit` mini-circle (the duplicate C2 deleted):

| Line | Failing assertion |
|---|---|
| `:187` | `between(chatSrc, '<span className="sc-status-glyph"', '</span>')` — marker gone |
| `:213-214` | hooks list requires `'sc-status-glyph'` and `'sc-status-orbit'` |
| `:234` | `between(chatSrc, '...sc-status-glyph', ...)` in "reduced motion keeps BOTH circles" |
| `:274-275` | SSR expects `count(html,'sc-status-glyph')===1` and `sc-status-orbit===1` |
| `:295` | `between(html, 'class="sc-status-glyph"', '</span>')` — marker gone |

These 5 failures are **expected** after a deliberate duplicate removal. Update
those assertions to expect zero `sc-status-glyph` / `sc-status-orbit` (and keep
the no-logo check). I did NOT edit that file — my scope is only the v1123 test
and this doc.

---

## 6. Honest note to the founder / ملاحظة صريحة للمؤسس

The v11.22 pass declared the logo "gone" but only guarded MessageView and the
ChatPanel live strip. The real brand mark was still mounted on the THINK band
via `ThinkBrand`, and the header still carried a second "live" ring. **The
missing guard is why it shipped.** `tests/v1123-graphics-guard.test.mjs` is that
guard. It now goes green: the logo is truly gone and there is exactly one
correctly placed primary spinning circle (plus the required THINK-band circle
and the per-row compact orbits — none of which are duplicates).
