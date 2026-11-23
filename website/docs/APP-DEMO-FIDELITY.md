# APP-DEMO FIDELITY — diagnosis (EN) / تشخيص مطابقة عرض التطبيق (AR)

> **Scope:** source-level + built-HTML diagnosis only. **المصدر ليس البكسل**: this
> document does **not** claim a screenshot comparison was made. No pixels were
> captured, no browser rendering was measured. A PASS below means "the markup
> carries the right structure and motion contract", not "it looks like the app".

Snapshot: 2026-11-20 · website `sadeem-website@11.12.0` · D1/D2 replica landed in
`app/page.tsx` + `app/home.css` while this audit ran (the first read of the files
showed the old `demo-*` mock; re-read after the build showed `appmock-*`).
D1/D2 were still editing during the audit, so **line numbers are a snapshot** —
re-run `node tests-app-demo.mjs` for live line numbers before acting on a citation.

---

## 1. Verdict / الحكم (blunt / بصراحة)

**EN.** It is **no longer a generic chat mock**. It is a hand-built replica of the
SADEEM *shell*: titlebar, full-width rail, chat-left column, chat head, run strip,
transcript, composer (mic / context orb / send) and a right work area are all
present, with app-like tokens, mono figures, hairlines and a scripted mouse cursor
with a click pulse. **But it is not a faithful copy of the app in pixels or in
grammar.** The copy is invented, the work area is a 4-row prop, the "one spinning
circle" is in the wrong place (two circles where the app has one), and two motion
systems coexist. The worst of the collision was scoped away mid-audit
(`home.css:580-591`), but duplicate keyframe definitions and an in-body `<style>`
remain. The mouse motion is *believable*
(eased waypoints, pauses, click ring) but it is a fixed 8.6 s loop, not something
that reacts to the content. I did not compare rendered pixels; I can only say the
source resembles the app's source. **Call it a convincing illustration of the app,
not a close copy.**

**AR.** لم يَعُد عرضاً دردشةً عاماً؛ إنه نسخة مبنية يدوياً من **هيكل** سديم: شريط
العنوان، الشريط العلوي، عمود المحادثة يساراً، رأس المحادثة، شريط التشغيل، الرسائل،
صندوق الكتابة (ميكروفون / حلقة السياق / إرسال)، ومنطقة عمل يميناً، مع مؤشر فأرة
مُحرَّك ونبضة نقرة. **لكنه ليس نسخة مطابقة للتطبيق لا في البكسل ولا في القواعد.**
النصوص مُختلقة، ومنطقة العمل دعامة من أربعة صفوف، و"الدائرة الواحدة" في المكان
الخطأ (دائرتان حيث للتطبيق دائرة واحدة)، ونظامَا حركة يتعايشان (أُصلح أسوأ تضارب
بينهما في `home.css:580-591`، لكن بقيت تعريفات حركة مكررة و`<style>` داخل الجسم).
حركة الفأرة **مقنعة** (نقاط مسار مع تخميد وتوقّف وحلقة نقرة) لكنها حلقة ثابتة
مدتها ٨٫٦ ثانية لا تتفاعل مع المحتوى. لم أقارن البكسلات؛ أستطيع القول فقط إن المصدر
يشبه مصدر التطبيق. **سمِّه رسماً توضيحياً مقنعاً للتطبيق، لا نسخة قريبة منه.**

---

## 2. Structural checklist — demo vs real app / جدول المطابقة

`page.tsx` = `website/app/page.tsx`, `home.css` = `website/app/home.css`.
Real-app paths are relative to the app package root (`src/...`).

| # | Element | Demo markup (file:line) | Demo style (file:line) | Real app source (file:line) | Status |
|---|---------|--------------------------|-------------------------|------------------------------|--------|
| 1 | Top rail | `page.tsx:585-589` titlebar + `page.tsx:592-628` nav rail | `home.css:323-347` | `src/components/TitleBar.tsx:99-101` (`glass-chrome` header), `src/components/Rail.tsx:234` (`.app-rail-bar-v13`), groups/spacer/dots `:240,:393,:396,:262` | ✅ structurally faithful; class names clearly lifted from `Rail.tsx` (`.rail-bar-group` → `.appmock-rail-group`, etc.) |
| 2 | chat-left | `page.tsx:631-632` `.appmock-main` / `.appmock-chat` | `home.css:350-357` | `src/components/ChatPanel.tsx` console column; work surface `src/App.tsx:295` | ✅ row exists, but chat is a fixed `clamp(360px,58%,560px)` prop (`home.css:355`) |
| 3 | chat head | `page.tsx:634-651` | `home.css:358-373` | `src/components/ChatPanel.tsx:1383` (`.chat-head.chat-head-v13`), brand `:1385`, status dots `:1420` | ✅ close: S brand, console label, session title, 3 status dots, clock |
| 4 | run strip | `page.tsx:654-670` | `home.css:376-394` | `src/components/ChatPanel.tsx:537` (`.phase-strip.run-strip-v13`), phases `:578-579`, clock `:574` | ✅ THINK·WORK·BUILD·RUN·PROVE + clock + hint, but **no orbit glyph in the mock strip** (gap G1) |
| 5 | message rows + left gutter circle | rows `page.tsx:673-679`; gutter orbit `page.tsx:681-691` | `home.css:397-413` | `src/components/MessageView.tsx:3011-3054` (`.msg-in`), gutter `:3036-3042` (`.sc-gutter`); **comment `:3017-3020`: "NO circle in the message-row gutter"** | ⚠️ rows ✅, **circle contradicts the app** — the one circle is in the run strip `ChatPanel.tsx:543-569` (gap G1) |
| 6 | reasoning block | `page.tsx:693-697` (`.appmock-think`, `.appmock-reason`, `reasoning` label) | `home.css:424-436` | `src/components/MessageView.tsx:2992-2999` `<ThinkingBlock>`; label `src/i18n.ts:260` (`chat.phaseThink`) | ✅ |
| 7 | tool card | `page.tsx:699-707` (`read_file`, path, OK, mono result) | `home.css:438-455` | `src/components/MessageView.tsx:3058` tool_call → v2 card; `src/components/console.css:67` `[class*='tool-card']` | ✅ |
| 8 | composer mic / context orb / send | `page.tsx:745-751` mic, `:752-758` orb, `:760-767` send | `home.css:463-486` | `src/components/Composer.tsx:2046` `<VoiceInput>`, `:2081` `<ContextLens compact />`, `:2125` `.composer-send` | ✅ |
| 9 | right work area | `page.tsx:774-795` (4 files + 4 code lines) | `home.css:488-504` | `src/components/RightDock.tsx:32` (`.right-dock-v13`), `src/App.tsx:295` editor surface | ⚠️ present but skeletal — `.appmock-work-line` skeleton CSS (`home.css:500-521`) is never used in markup (gap G4) |
| 10 | moving cursor + click pulse | `page.tsx:799-803` cursor, `page.tsx:766` click ring | `home.css:524-538` cursor/ring, `:541-578` keyframes, `:586-591` scoped pointer finish; inline path `page.tsx:190-211` | **none** — the real app has only a streaming *text* caret (`src/styles.css:2023` `.streaming-cursor::after`) | ⚠️ fabricated motif, not a replica of any app element (gap G3) |
| 11 | honest caption | `page.tsx:118-121` + rendered `page.tsx:805` | `home.css:318-320` | n/a (website ethics requirement) | ✅ "stylised illustration … not a screen recording" / «ليس تسجيل شاشة» |

### Removed-from-app elements — verification / العناصر المحذوفة

| Forbidden item | Demo check | Real-app authority |
|---|---|---|
| Report card in chat | **absent** in `ProductInUse` (`page.tsx:548-809`) | `src/store.ts:1706-1712` "no report card in chat"; `:4555` full slice kept only in `lastTaskReport` |
| TAINT UI row | **absent** | `src/store.ts:4647-4652` v11.27 — events create no transcript message |
| Proof panel | **absent** — no `proof-panel` / card | app still renders a *compact button* `src/components/ChatPanel.tsx:1805` `<ProofRibbon />` / `src/components/ProofRibbon.tsx:314` |
| PROOF micro-chip | **present** `page.tsx:714` (`appmock-proof`) — a label, not a panel | mirrors the app's compact ProofRibbon button; flagged as WARN in the guard, confirm founder intent |

---

## 3. Motion / a11y / i18n audit / تدقيق الحركة وإمكانية الوصول

- **Reduced motion — PASS.** Broad kill switch `[class*='appmock-']{animation:none!important;transition:none!important}` at `home.css:678` (inside `@media (prefers-reduced-motion:reduce)` `:677`) and `:691-692` for `html.reduce-motion` / `html[data-art='off']`. The scripted cursor is **hidden** (`display:none!important`) at `home.css:679`, `:693-694`, not merely frozen. Inline block has its own guards at `page.tsx:212-225`. Every new `appmock-*` animation is covered by the broad selector.
- **Hydration safety — PASS.** No `Date`, `Date.now` or `Math.random` in `page.tsx`. `useStageReplay` (`page.tsx:295-320`) writes a single DOM attribute via `setAttribute('data-in', …)` in `useEffect`; never React state, so a language re-render cannot disturb it. Geometry stays index-derived (`page.tsx:38-43`). Static final frame when IO is unavailable or motion is off (`page.tsx:306-309`).
- **Bilingual — PASS.** All new copy lives in `DEMO` pairs (`page.tsx:92-167`) and is rendered through `tx()`. English-only constants (`reasoning`, `OK`, `PROOF`, clock, token/tool/model ids at `page.tsx:140,148-156`) mirror identifiers the app itself keeps in Latin script.
- **RTL — PASS with a caveat.** `data-dir={dir}` (`page.tsx:552,581`) drives a mirrored typing clip-path (`page.tsx:187-188`); `html[lang='ar']` rules at `home.css:570-571,594-597,630-631`; logical properties throughout (e.g. `home.css:356,362,431,434,656`); `dir="auto"` on text nodes. **Caveat:** `dir="ltr"` is hard-coded on the window (`page.tsx:583`) and `direction:ltr` on the main row (`home.css:350`), with children flipped at `home.css:351`. The chat column therefore stays physically on the left in Arabic — faithful to the app's physical rail, but not a mirrored layout. Confirm this is deliberate (gap G6).
- **Cursor believability — moderate.** `home.css:556-569` gives 10 waypoints with per-keyframe easing (pauses at the prompt, at Send, on the tool card), and `home.css:570-578` a two-pulse click ring. `home.css:586-591` deliberately overrides the in-body scaffold so the cursor travels by `transform`/opacity (cqw) instead of animating `left/top`. Better than a linear sweep, but it is a fixed replay on scroll re-entry (`page.tsx:310-315`), never reacts to what is "typed", and the real app has no mouse cursor to compare against. With motion off it disappears entirely.

---

## 4. Build, typecheck, deploy / البناء والفحص والنشر

| Check | Result |
|---|---|
| `npm run build` (Next 16.4.6, Turbopack) | ✅ PASS — compiled, 10/10 static pages generated; run **after** D1/D2 landed (built HTML contains `appmock-*`). Non-blocking warnings: PostCSS module type, Tailwind `content` empty. |
| `npx tsc --noEmit` / `npm run typecheck` (TS 7.0.2) | ✅ PASS — clean, twice (pre- and post-landing). |
| Source guard `node tests-app-demo.mjs` | see test output; hard checks = structure, subtractions, kill switches, hydration, bilingual/RTL, caption. |
| Built HTML `.next/server/app/index.html` | ✅ contains `appmock-rail`, `appmock-chat-head`, `appmock-gutter`, `appmock-cursor`, `appmock-click`, etc. |
| **Live** `https://sadeem-website-theta.vercel.app/` | ❌ **STALE** — HTTP 200, 0 × `appmock-`, 2 × `demo-msg` (old generic demo). Parent must redeploy, then `node tests-app-demo.mjs --live`. |

---

## 5. Gaps, blunt / الفجوات بصراحة

- **G1 — circle grammar is wrong (high).** `page.tsx:641-649` (head orbit) and `page.tsx:683-691` (gutter orbit) give the mock **two** spinning circles; the app deliberately has **one**, and it lives in the run strip (`src/components/ChatPanel.tsx:543-569`, comment `:530`, `:538-540`). The mock run strip `page.tsx:654-670` has no orbit, while `home.css:382` defines `.appmock-phase-orbit` that nothing uses. The checklist item "message rows with left gutter circle" is itself stale relative to source — a faithful replica should drop the gutter circle and move the orbit into the strip.
- **G2 — two motion systems coexist (medium, partly mitigated mid-audit).** `page.tsx:177-226` (inline `<style>` rendered at `page.tsx:582`) still carries the beat timeline; `home.css:580-591` now deliberately owns only the pointer finish and outranks the scaffold so the cursor travels by `transform` rather than `left/top`. The earlier duplicate *staging* rules were removed, but duplicate `@keyframes` definitions remain: `appmock-rise` (`page.tsx:194` / `home.css:542`), `appmock-type` (`:195` / `:544`), `appmock-type-rtl` (`:196` / `:547`), `appmock-spin` (`:197` / `:550`). Two timelines still state different cursor paths and durations (`page.tsx:190-211` 9 s left/top vs `home.css:556-569` 8.6 s cqw). The guard warns on this; it is fragility, not fidelity. Consolidate to one owner.
- **G3 — the cursor is an invention (medium).** No mouse cursor exists in the app (`src/styles.css:2023` is a text caret). "Believable mouse motion" can only be judged aesthetically, not by comparison to the app. It is a fixed loop and replays from the start whenever the section re-enters the viewport (`page.tsx:310-315`).
- **G4 — the work area is a prop (medium).** `page.tsx:774-795` is four file names plus four code lines; the real work surface is `src/components/RightDock.tsx:32` + `src/App.tsx:295` with tabs/editor/panels. `home.css:500-521` skeleton-line rules are dead code. Do not call this a faithful work area.
- **G5 — invented evidence (low, covered by caption).** `✓ 4 passed · lint clean` (`page.tsx:113`), `(0:07)` (`:140`), `12.4k tok` (`:149`), `claude-3.7-sonnet` (`:156`) are illustrative. The caption (`page.tsx:118-121`, rendered `:805`) honestly says so.
- **G6 — physical LTR under Arabic (low, likely intentional).** `page.tsx:583`, `home.css:350-351`. Good for app fidelity, unusual for a website; verify with a native Arabic reader.
- **G7 — live deploy is stale (public-facing blocker).** Local source and build are correct; the deployed URL still serves the old `demo-*` mock. Until redeploy, no one can see the replica.

**Source ≠ pixels.** I verified markup, CSS, built HTML and the live HTML string. I did **not** take a screenshot or diff rendered output against the running Electron app. Colour tokens (`home.css:288-306`), font fallback (`--am-font` `Inter`/`Cairo`) and the actual app chrome may still look different on screen. Treat the visual claim as unverified.

---

## 6. Reproduce / إعادة التحقق

```powershell
# from website/
node tests-app-demo.mjs                 # source-only diagnosis
node tests-app-demo.mjs --build         # + npm run build && npx tsc --noEmit
node tests-app-demo.mjs --build --live  # + deployed / carries appmock-* markers
```

The live step fails on purpose while the deploy is stale; that is a deployment
issue, not a source regression. / خطوة النشر تفشل عن قصد ما دام النشر قديماً؛ هذه
مشكلة نشر لا تراجع في المصدر.
