# APP-MOCK-V1139 — دقّة أعلى، حركة مؤشّر أهدأ، نسخة أقرب من التطبيق الحقيقي
# APP-MOCK-V1139 — Higher fidelity, calmer pointer motion, closer to the real app

**Version / الإصدار:** v11.39 · **Date / التاريخ:** 2026-11-22
**Owner / المالك:** website demo agent (D1) — `website/app/page.tsx` + `website/app/app-mock.css` only.
**Untouched / لم يُلمس:** SEO metadata, hero, benefits, proof, closing, `layout.tsx`, all Electron source, `home.css` (D2 owns it).

---

## 1 — What was read (read-only) / ما الذي قرأته

The mock's chrome was mirrored from the **real** renderer, not invented:

| Real file / الملف الحقيقي | What was captured / ما التقُط |
|---|---|
| `src/components/ChatPanel.tsx` | `RunStatusLine` phase strip (THINK·WORK·BUILD·RUN·PROVE), one 16px live circle, `MessagePhaseLine` (thinking→tools→answering→verified) |
| `src/components/Composer.tsx` | v11.37 single **"+"** attach trigger, task-mode stamps, compact context orb, square `.tnum` chips |
| `src/components/chat-final.css` | flat fills, 1px hairlines, **no boxy cards** (§11), per-message phase line (§2), lens card (§7) |
| `src/components/type-scale.css` | Instrument Serif / Cairo display families, `--chat-*` scale, mono tool chips |
| `src/components/shell.css` | physical LTR main row: full-width **top** rail → chat **left** → work area right; 44px rail, boxless plan hairline |
| `src/components/context-orb.css` | exact-arc donut, 1px `non-scaling-stroke`, 12-o'clock tick, tabular mono value, no label |

> Note / ملاحظة: the real app's rail is a **full-width horizontal bar above the main row** (`shell.css:30`, `:132`), not a left sidebar. The chat column is the physical left column. The mock keeps that exact physical order — correcting a brief that said "rail on the left".
> التطبيق الحقيقي يستخدم شريطاً أفقياً كاملاً **فوق** الصف الرئيسي، وعميل المحادثة هو العمود الأيسر. حافظ النموذج على هذا الترتيب الفيزيائي.

---

## 2 — Before / After

### 2.1 Fidelity / الدقّة والشكل

| # | Before / قبل | After / بعد |
|---|---|---|
| 1 | Tool result sat in a **bordered rounded card** (`border:1px` + `radius:4px` + lime top bar). | **Frame-free hairline row**: no box, one 1px top rule + one 1px lime rail, mono result inset 13px — matches `chat-final.css §11`. |
| 2 | Run strip had only ONE active phase; the rest were undifferentiated ghosts. | THINK·WORK done (ink-dim), BUILD active (lime), RUN·PROVE pending — an honest in-program run ledger. |
| 3 | No per-message phase line. | Added the real **THINKING → TOOLS → ANSWERING → VERIFIED** hairline line, drawn to ANSWERING (3/4), localized EN/AR. |
| 4 | Composer had a loose **image icon** button. | Replaced by the real v11.37 collapsed **"+"** attach trigger (no fabricated popover). |
| 5 | Context "orb" was a 3-circle approximation with `strokeDasharray="42 57"` and a filled centre dot. | Real ContextLens geometry: `pathLength={100}`, exact `62 100` arc, butt caps, `non-scaling-stroke`, **12-o'clock registration tick**, tabular mono `62` at centre. |
| 6 | Narrative showed `read_file` but a result of "4 tests passed" + "Done — tests green" (incoherent). | Coherent, honest scenario: `read_file settings/theme-context.ts` → `1 // theme context — persisted local state` → "found it, reusing it in the new Toggle" (AR mirrors exactly). |
| 7 | Stamps `reasoning` / `OK` / `PROOF` were hardcoded English even in the Arabic UI. | Localized pairs: `reasoning/تفكير`, `OK/تم`, `STEP/خطوة`; every rendered string is **single-language**. |
| 8 | Mixed mono sizes, some proportional digits. | One tabular mono rhythm on every figure (clock, stats, tool rows, code, files, orb, phase line). |
| 9 | SVG strokes scaled with the mock width; blurry at some DPRs. | `vector-effect:non-scaling-stroke` + `shape-rendering:geometricPrecision` on every mock SVG primitive → one screen pixel per stroke. |
| 10 | Rounded composer / send / avatar edges. | 2px/0px radii only — hairline instrument, not a card. Cairo locked for Arabic; Instrument-Serif-ready stack is untouched elsewhere. |

### 2.2 Mouse motion / حركة المؤشّر

| # | Before / قبل | After / بعد |
|---|---|---|
| 1 | Two competing paths: page.tsx animated `left/top` % (`appmock-cursor-move`), home.css animated `transform` (`appmock-cursor-path`). | **One authoritative path**: `appmock-mouse-glide` only; the legacy `left/top` keyframe was deleted and the transform rule is outranked by one extra `.appmock-window` class. |
| 2 | Straight-line jumps between percentage waypoints; no arc between targets, and the old "Send" waypoint (78cqw) actually landed in the **work area**, not on the button. | **15 keyed waypoints** with `translate3d(cqw, cqw, 0)` and per-keyframe `cubic-bezier` pairs — accelerate, bend, decelerate. Waypoints were re-derived from the real CSS: chat = 58% of the window, Send centre ≈ 53cqw (58 − dock 14 − card 12 − ½ send 16), tool-row centre ≈ 30cqw. No teleport, and no pre-exit drift out of the chat column. |
| 3 | Cursor appeared then immediately wandered; no dwell before the action. | Fade-in dwell (0–28%), **typing jitter** along the prompt line (9–24%), an arced glide to Send (28–38%), a **click dwell** (38–44%). |
| 4 | A 620ms pulse fired at 3400ms, disconnected from the pointer; home.css also rang a second cursor ring on its own clock. | `appmock-ripple` (Send button) and `appmock-ring` (cursor) share the **same 9200ms clock** and fire only at 38–48%, exactly on the dwell. |
| 5 | After the tool hover the cursor jumped to `top:16%` and vanished. | Soft two-beat hover at the tool row (58–70%), then a long, slow drift to the corner with a fade to `.25` opacity (100%). |
| 6 | Reduced-motion hid the cursor but left the caret invisible (opacity 0) in the static frame. | Static end state keeps all beats visible, unclips typed text, **pins the caret visible**, and hides cursor + ripple under both `prefers-reduced-motion` and `html.reduce-motion` (plus `data-art='off'`). |

---

## 3 — Exact locations / المواقع الدقيقة

All paths relative to repo root; line numbers are post-change.

### `website/app/page.tsx`

| Lines / الأسطر | Content / المحتوى |
|---|---|
| `:13` | `import './app-mock.css'` — imported **after** `./home.css` so the precision layer wins the cascade. |
| `:96` | `const DEMO` — bilingual data, all strings single-language. |
| `:117–120` | `result` — coherent `read_file` preview (EN/AR). |
| `:121–124` | `answer` — localized, no invented test verdict. |
| `:158–172` | localized stamps, `attachPlus`, `ctxLabel`/`ctxValue`, `msgPhase` four-stage tuple. |
| `:187–295` | `APP_MOCK_MOTION` — the single timing owner. |
| `:198–236` | base state, reveal timings, and the **three** cursor/ripple animation bindings (9200ms, synchronous). |
| `:238–258` | `@keyframes appmock-mouse-glide` — 14 arced, eased, dwelled waypoints. |
| `:260–269` | `@keyframes appmock-ripple` + `@keyframes appmock-ring`. |
| `:273–295` | reduced-motion media gate, `html.reduce-motion` gate, `data-art='off'` gate. |
| `:733` | phase ledger `is-done` / `is-active` classes. |
| `:762, :771, :781–782` | localized `reasoning` / `OK` / `STEP` stamps. |
| `:788–798` | new per-message phase line markup. |
| `:826–834` | collapsed "+" attach trigger. |
| `:845–855` | precise context orb (pathLength arc, tick, mono value). |
| `:897–904` | crisp arrow cursor SVG (1px non-scaling stroke). |
| `:907` | unchanged honest caption — "stylised illustration, not a screen recording" / «رسم توضيحي … ليس تسجيل شاشة». |

### `website/app/app-mock.css` (new / جديد)

| Lines | Content |
|---|---|
| `:14–21` | tabular mono numerals on every mock figure. |
| `:23–34` | `non-scaling-stroke` + `geometricPrecision` + orb value typography. |
| `:37–66` | frame-free tool row, hairline accents, de-rounded chrome. |
| `:68–73` | done/active phase ink. |
| `:75–126` | per-message phase line (logical insets, 1px track, 66.66% fill). |
| `:128–136` | "+" glyph. |
| `:138–141` | Cairo locking for Arabic. |

---

## 4 — Motion contract / عقد الحركة

- Duration **9200ms**, one-shot, replayed by `useStageReplay` on viewport re-entry (`page.tsx:365+`, unchanged).
- Pointer uses `transform` + `opacity` only — no layout reads/writes per frame.
- All coordinates are `cqw`, so the path scales with the mock container at any viewport.
- Ripple + cursor ring are keyed to the pointer clock: click lands on the dwell, not before it.
- `prefers-reduced-motion: reduce`, `html.reduce-motion`, and `html[data-art='off']` all park a **static, fully readable end frame**.
- No `Date`, no `Math.random`, no client-only state in the mock — SSR and hydration markup are identical.

---

## 5 — Verification / التحقق

Run from `website/`:

```
npx tsc --noEmit                 # PASS (no output)
npm run build                    # PASS — 14/14 static pages, 0 type errors
node sourcecheck.mjs             # PASS 27/27 (both locales, one keyframe path, 3 motion gates, no Date/random)
SSR fetch of / (port 3212)       # PASS 200 — Arabic default locale renders result/caption/plus/msgphase/orb tick
```

SSR defaults to Arabic (`website/lib/i18n.tsx:11`, `useState<Lang>('ar')`); English is selected client-side from `localStorage` / `navigator.language`. Both language pairs were asserted at source level. The 27 `undefined` substrings in the SSR HTML are Next.js RSC script placeholders (`crossOrigin:"$undefined"`, `nonce:"$undefined"`), not mock data.

**Honesty / الصدق:** the mock remains a stylised motion illustration. Its caption still says so in both languages. No fabricated product claim, no screen recording, no real telemetry or model call.
