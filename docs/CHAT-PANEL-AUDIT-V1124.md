# CHAT PANEL STRUCTURAL AUDIT — v11.24
# تدقيق هيكل لوحة المحادثة — v11.24

**Mode / النمط:** diagnosis **only**. This subagent edited **no production source** — only this report.
الوضع: تشخيص **فقط**. لم يعدّل هذا الوكيل أي ملف إنتاجي — فقط هذا التقرير.

**Scope / النطاق:** `src/components/ChatPanel.tsx` (2,367 lines, read end-to-end) and
`src/components/MessageView.tsx` (3,762 lines, read end-to-end), plus the CSS that paints the
decorations (`console.css`, `chat.css`, `chat-art.css`, `chat-final.css`, `stream-motion.css`,
`tool-story.css`).
النطاق: ملفا `ChatPanel.tsx` و`MessageView.tsx` (قُرئا بالكامل) مع ملفات التنسيق التي ترسم الزخارف.

**Method / الطريقة:** static source + CSS read; `npx tsc --noEmit` → **clean, 0 errors**.
There is **no SSR entry** in this repo (Vite + Electron SPA, no `react-dom/server` script), so no
server-render harness was produced — verification is source/CSS only.
الطريقة: قراءة المصدر والتنسيق؛ فحص الأنواع ناجح بلا أخطاء. لا يوجد مسار SSR في المشروع، لذا التحقق مصدرى/تنسيقي فقط.

> ⚠️ **Snapshot warning / تحذير اللقطة.** No `.git` in this checkout, so no diff was possible.
> File mtimes: `MessageView.tsx` 08:37, `ChatPanel.tsx` 09:21, then `console.css` 09:26,
> `chat.css` 09:28, `chat-final.css` 09:33 — **CSS was still being written after the TSX** while
> this audit ran. The line numbers below are exact for the bytes read at that moment; **string
> anchors (class names) are the stable reference.** Re-run this audit after A1–A5 land.
> تحذير: لا يوجد git، وأوقات التعديل تُظهر أن ملفات التنسيق كانت تُكتب بعد ملفات TSX أثناء التدقيق.
> أرقام الأسطر دقيقة للنسخة المقروءة؛ أسماء الأصناف هي المرجع الثابت. أعد التدقيق بعد نزول A1–A5.

---

## 0. Brutal verdict / الخلاصة بصراحة

**The chat panel is NOT clean. Not one of (a)–(d) is actually gone from source; (e) is only half done.**
**لوحة المحادثة ليست نظيفة. لا واحدة من (أ)–(د) اختفت فعلياً من المصدر، و(هـ) أُنجزت نصفاً.**

| Founder item / طلب المؤسس | Status / الحالة | Hard evidence / الدليل القاطع |
|---|---|---|
| (a) ring right after send + strip with ring & wave — remove / حلقة بعد الإرسال + شريط بحلقة وموجة — إزالة | ❌ **STILL PRESENT** | `MessageView.tsx:1631` `LiveNib`; `:1392` orbit + `:1406` `LiveWave` + `:1425` `PhaseBeads` |
| (b) trembling / dancing text — remove / نص يرتجف ويرقص — إزالة | ❌ **STILL PRESENT** | `MessageView.tsx:1171-1181` `revealWords`; `:1453` mount; `:1099-1147` `useSmoothStream`; `stream-motion.css:53-70` |
| (c) big circle with WORKING/time + strip below — merge / دائرة كبيرة مع WORKING/الوقت وشريط تحتها — دمج | ❌ **NOT MERGED** | `ChatPanel.tsx:1918` `LiveThinkingPanel` (SVG `:763-865`) and `:1891` `RunStatusLine` are still **two separate mounts** |
| (d) two circles near THINK — one only / دائرتان بجانب THINK — واحدة فقط | ❌ **TWO (THREE total)** | `MessageView.tsx:3714` `CompactThinkingOrbit` + `:1392` `PrecisionThinkingOrbit`; plus `ChatPanel.tsx:1918` big circle |
| (e) thinking circle in an ugly square — unbox & enlarge / دائرة التفكير داخل مربع قبيح — فك الصندوق وتكبير | ⚠️ **ENLARGED, STILL BOXED** | enlarge: `MessageView.tsx:1389` inline `30×30`; box **still drawn**: `console.css:494-503` + `::after :504-512` (`border-radius:5px`, `reason-node-pulse` `:761-765`) |

**The source comments scream "REMOVED" while the JSX still mounts the element.** That is the single
most dangerous finding: a reader trusting `ChatPanel.tsx:542-545`, `:1710-1715`, `:2029-2032`,
`:2097-2100` or `MessageView.tsx:3710-3713` will conclude the job is done when it is not.
التعليقات في المصدر تقول «أُزيل» بينما JSX ما زال يركّب العنصر — أخطر ما في التدقيق.

**No React #300 (hook-order) defect exists in this snapshot**, and no hook-after-early-return was found.
There *are* heavy duplicates (three spinning-circle implementations, two identical run clocks,
two `useRunActivity` calls, four 1-second intervals) and one dead component (`MessagePhaseLine`).
لا يوجد عيب React #300 حالياً، لكن هناك تكرارات ثقيلة ومكوّن ميت.

---

## 1. Decorative-element inventory — `ChatPanel.tsx`
## 1. جرد العناصر الزخرفية

Legend / الدليل: **KEEP** = real data or beloved animation · **REMOVE** = decor the founder
named · **MOVE** = must be folded into the timeline/run strip · **DEAD** = defined but never mounted.

| # | Element | file:line | Class / hook | Verdict | Why |
|---|---|---|---|---|---|
| C1 | DNA suggestion icon | `ChatPanel.tsx:96` | `Repeat` | KEEP | functional card, real suggestion |
| C2 | Derived-task icons | `:153,160,167,176,193` | `FlaskConical`, `List`, `Repeat`, `ShieldCheck`, `PenLine` | KEEP | actionable prompts |
| C3 | Plan meter + check icon | `:211,218-220` | `ListChecks`, `.todo-meter` | KEEP | real completed/total |
| C4 | **Per-message phase line (dead)** | `:396-445` | `.cf-phase-line`, `.cf-phase-track`, `.cf-pip`, `MSG_PHASES` | **DEAD / REMOVE** | defined, never rendered — the call site was deleted (see `:2029-2032`). If re-mounted it becomes a second "strip" the founder already rejected. |
| C5 | Run strip root | `:531` | `.phase-strip.run-strip-v13` | KEEP | the strip everything else must merge **into** |
| C6 | 3 breathing dots in strip | `:536-538` | `.cp-live-dots` | KEEP (flag) | honest instant liveness — but 2nd of three 3-dot groups (see C18, M11) |
| C7 | Sweeping hairline in strip | `:539` | `.cp-live-sweep` | KEEP (flag) | CSS sweep; a *second* sweep exists inside the live panel at `:890` |
| C8 | Removed small status circle | `:542-545` | comment only | ✅ GONE | no JSX — this particular duplicate really is gone |
| C9 | Gerund label + elapsed clock | `:549-554` | `.sc-status-label`, `.sc-status-clock` | KEEP | real phase/clock, `role=status` at `:549` |
| C10 | Phase dots THINK·WORK·BUILD·RUN·PROVE | `:559-573` | `.phase-strip-steps`, `.ps-dot` | KEEP | derived from real transcript |
| C11 | Tool/token stats + Esc hint | `:575-586` | `.phase-strip-stat`, `.phase-strip-hint` | KEEP | real counts |
| C12 | **Live panel container** | `:677-893`, mounted `:1918` | `.cp-live-panel` | **MOVE** (founder c) | separate block above the stream; must be folded into C5 |
| C13 | **Big 80px spinning circle** | SVG `:763-865` (size `:765-767`); rings `:774-787`, arcs `:790-799`, ticks `:803-818`, node `:821-834`, bars `:836-859`, hub `:863-864` | `.cp-live-glyph` | **MOVE** (founder c) | the "big circle" — not removed, just sitting in its own panel |
| C14 | Panel status / clock / counters | `:868-885` | `.cp-live-status`, `.cp-live-clock`, `.cp-live-count` | **MOVE** (founder c) | duplicates C9 + C11 verbatim (two clocks, two tool counts, two token counts) |
| C15 | Panel sweep hairline | `:890` | `.cp-live-sweep` | **MOVE** (founder c) | duplicate of C7 |
| C16 | Panel visibility hook | `:662-675` | `useLivePanelVisible` | REMOVE with C12 | becomes dead if C12 is merged into the strip |
| C17 | Resume icon | `:908` | `⟳` | KEEP | functional resume chip |
| C18 | Recovery dot | `:946` | `.recovery-dot` | KEEP | real watchdog state |
| C19 | Contract ring frame | `:991` | `.spec-ring` | KEEP | functional plan card; not a live indicator |
| C20 | Review shield | `:1109` | `ShieldCheck` | KEEP | real findings |
| C21 | Header brand square "S" | `:1672` | `.chat-brand-v13` | KEEP | brand mark, not a spinner |
| C22 | Header 3 state dots | `:1707-1709` | `.chat-status-v13` | KEEP (flag) | 3rd 3-dot motif; decorative but honest |
| C23 | Removed header live circle | `:1710-1713` | comment only | ✅ GONE | no JSX |
| C24 | Context ring | `:1714-1715` | comment only | ✅ MOVED | moved to Composer, not in this file |
| C25 | Focus-mode hint icon | `:1861` | `Maximize2` | KEEP | teaches Esc affordance |
| C26 | Empty-state logo | `:1936` | `<Logo size={40}/>` | KEEP | brand only, explicitly never a live indicator (`:49-52`) |
| C27 | Session-load shimmer | `:1921-1928` | `.shimmer` | KEEP | real loading state |
| C28 | Load-earlier glass chip | `:1965-1977` | `.glass` | KEEP | functional |
| C29 | Single PROOF button | `:2095` | `<ProofRibbon/>` | KEEP | exactly one mount, real evidence |
| C30 | Jump-to-latest pill | `:2105-2117` | `.rp-jump` | KEEP | functional |
| C31 | Flow-suggest icon | `:2319-2365` | — | KEEP | functional |

---

## 2. Decorative-element inventory — `MessageView.tsx`
## 2. جرد العناصر الزخرفية

| # | Element | file:line | Class / hook | Verdict | Why |
|---|---|---|---|---|---|
| M1 | 9 tool-family story glyphs | `:171-357` | `.tsg`, `STORY_ART` | KEEP | one precise glyph per real tool family |
| M2 | Settle check / cross overlays | `:352-353` | `.tsg-check`, `.tsg-cross` | KEEP | real tool outcome |
| M3 | Progress ring (done/total) | `:364-398`, used `:685,2439` | `.ts-ring` | KEEP | real data, not invented progress |
| M4 | **Live wave (4 bars)** | `:400-422`, mounted **`:1406`** | `.sc-live-wave` | **REMOVE** (founder a) | the "wave" in the ring+wave strip |
| M5 | **Live nib + orbiting spark** | `:445-473`, mounted **`:1631`** | `.mv-live-nib` | **REMOVE** (founder a) | the "ring right after send" — sits at head of the streaming answer paragraph |
| M6 | delta word counter | `:475-479` | `deltaWordCount` | KEEP only if M5/M7 stay | pure helper feeding M5/M7 |
| M7 | **5 phase beads** | `:481-503`, mounted **`:1425`** | `.mv-phase-beads` | **REMOVE** (founder a) | extra decor in the same named thinking-head strip |
| M8 | Tool completion bloom | `:505-522`, mounted `:3470` | `.mv-tool-bloom` | KEEP | one-shot, mounted only on real `status==='done'` |
| M9 | Plate ornament (crosshair + rule) | `:537-551`, mounted in **user** row `:3596` | `.sc-plate` | KEEP (flag) | the assistant-row copy *is* gone (`:3710-3713`); this one is on the user bubble. If the founder meant it globally, `:3596` is the leftover. |
| M10 | **Compact thinking orbit (40px)** | `:590-649`, mounted **`:3714`** | `.sc-think-orbit`, `.sc-plate` | **REMOVE** (founder d) | the second circle near THINK — keep the head circle (M11) and delete this gutter copy |
| M11 | **Precision thinking orbit (30px)** | `:1209-1256`, mounted **`:1392`** | `.sc-reason-glyph`, `.sc-think-engrave` | **KEEP → unbox + enlarge** (founder e) | the circle the founder wants; currently enlarged inline but still inside the square (see §5e) |
| M12 | 3 pre-token dots | `:1395-1399` | `.sc-reason-dots` | KEEP (flag) | 1st of three 3-dot motifs |
| M13 | Thinking seconds T+ | `:1407-1412` | `.sc-think-clock` | KEEP | real thinking duration |
| M14 | Live pulse dot | `:1420` | `.pulse-dot` | KEEP | live/collapsed state |
| M15 | Write-head caret | `:1454` | `.sc18-dotcaret` | KEEP | honest write head, settle animation |
| M16 | First-paragraph ink spread | `:1564-1567` | `.md-first-ink` | KEEP | one-shot, not per-token |
| M17 | **Per-word reveal (trembling text)** | `:1164-1181`, mounted **`:1453`** | `.sc-reason-word`, `@keyframes reason-word-in` (`stream-motion.css:53-70`) | **REMOVE** (founder b) | every new word span animates opacity/colour/translateY — this is the dancing text |
| M18 | rAF smooth stream | `:1099-1147`, used `:1293` and `:1616` | `useSmoothStream` | KEEP (flag) | beloved continuous growth — but if "trembling" means continuous reflow, **this** is the source; decide with the founder |
| M19 | Done-row check | `:1688` | `.sc-done-row`, `Check` | KEEP | real completion |
| M20 | Feedback stamps / flag | `:1826-1915` | `.dna-fb-stamp`, `.dna-fb-flag` | KEEP | real recorded feedback |
| M21 | Subagent spinner + ring | `:2437-2439` | `Spinner`, `ProgressRing` | KEEP | real subagent progress |
| M22 | Mode / checkpoint stamps | `:958-1032` | `.sc-monogram-stamp`, `STAMP_MARKS` | KEEP | real mode label |
| M23 | 20s thinking liveness dot | `:1076` | `.sc-notice-live-dot` | KEEP | the single quiet marker |
| M24 | Tool run rule / progress / bloom | `:3456,3460,3465,3470` | `.tv-draw-rule`, `.tv-complete-rule`, `.tv-runline`, `ToolBloom` | KEEP | one-shot, real status |
| M25 | Running-tool spinner | `:3080` | `Spinner` inside `StatusPill` | KEEP | real running tool |
| M26 | Agent dot | `:3734` | `.agent-dot.is-live` | KEEP | real streaming state |

**M18 nuance / ملاحظة:** `useSmoothStream` was explicitly built to *cure* an earlier
freeze-then-pop complaint (`:1087-1097`). Do not delete it on a guess — the "trembling" symptom
matches M17 first. If the founder still sees motion after M17 is gone, M18 is the next suspect.
لا تحذف M18 بالتخمين؛ M17 هو المتهم الأول.

---

## 3. React #300 / hook-order risk
## 3. خطر React #300 / ترتيب الـ hooks

**Verdict: no hook-after-early-return in this snapshot. Typecheck is clean.** React #300
("Rendered fewer hooks than expected") is not reachable from the code as read.
الخلاصة: لا يوجد استدعاء hook بعد return مبكر في هذه النسخة.

Audited early returns (all hooks declared **before** them):
أسطر Return المبكرة التي فُحصت (كل الـ hooks قبلها):

- `MessageViewRow` — hooks `:3522-3529` (`useT`, `useDigits`, `useCopyFeedback`, `useMemo`), first early return `:3532`, ~20 returns follow through `:3585`.
- `RunStatusLine` — hooks `:459-514`, early return `:515`.
- `LiveThinkingPanel` — hooks `:680-717`, no early return.
- `RecoveryStatusLine` — hooks `:928-937`, returns `:938`, `:940`.
- `DoneRow` — hooks `:1667-1676`, returns `:1677`, `:1685`.
- `FlowSuggest` — hooks `:2320-2324`, return `:2325`.
- `DnaSuggestionCard` `:85`, `ResumeTaskChip` `:905`, `PlanContract` `:972`, `ReviewCard` `:1103`, `SkillsStrip` `:1168`, `PrettyArgs` `:2157`, `FindingsCard` `:2459`, `FakeTestsRow` `:2737` — all hooks first.
- `ChatPanel` — no component-level early return at all.
- `useRunActivity`'s `if (!running) return null;` at `:306` is **inside a `useMemo` callback**, not a component early return — safe.

**Fragility to re-check after A1–A5 / هشاشة يجب إعادة فحصها:**
`MessageViewRow` has one dense hook block followed by 20+ early returns. Any agent that inserts a
`useState`/`useMemo` below `:3529` (e.g. to drive a new circle) creates an instant React #300 when
the row switches between a meta model and a normal assistant turn. Same pattern in `RunStatusLine`
(the hook block must stay above `:515`). `tsc` will **not** catch this — only runtime or an
`eslint-plugin-react-hooks` run will.
أي hook يُضاف بعد السطر 3529 في `MessageViewRow` يسبب الخطأ فوراً؛ فحص الأنواع لا يكشفه.

---

## 4. Duplicated hooks / duplicated graphics
## 4. hooks مكرّرة / رسوم مكرّرة

| Duplicate | Exact lines | Note |
|---|---|---|
| Run clock captured twice | `ChatPanel.tsx:501-512` and `:699-710` | identical `startRef` / `prevRunningRef` / `setInterval(RUN_TICK_MS)` logic |
| `useRunActivity(now)` called twice | `:514` and `:717` | same derived phase computed in both status surfaces |
| Token/tool counters twice | `:520-522` and `:718-726` | two full loops over `msgs`, two `totalTokens` |
| Two independent sweeps | `:539` and `:890` | same `.cp-live-sweep`, one in strip one in panel |
| Reduced-motion detection twice | `:691-695` (inline `useState`) and `MessageView.tsx:580-588` (`usePrefersReducedMotion`) | same `matchMedia` query |
| Four 1-second intervals | `:507-512`, `:705-710`, `:932-937`, `MessageView.tsx:1320-1327` | four independent clocks can drift visually |
| **Three spinning-circle SVGs** | `ChatPanel.tsx:763-865`, `MessageView.tsx:599-646`, `:1213-1254` | same art grammar, three implementations; two near THINK (founder d) |
| 3-dot motif ×3 | `ChatPanel.tsx:536-538`, `:1707-1709`, `MessageView.tsx:1395-1399` | three breathing dot rows in one panel |
| Dead phase-line component | `ChatPanel.tsx:396-445` | `MessagePhaseLine` + `MSG_PHASES` + AR/EN label maps — never mounted |
| No-op subscription | `ChatPanel.tsx:491-495` | `msgStamp` is read then `void`-ed; intentional re-render trigger but looks dead |

---

## 5. Founder problems — source-level verification
## 5. التحقق من مشاكل المؤسس على مستوى المصدر

### (a) "ring right after send, then a strip with ring + wave — remove" — ❌ NOT DONE
- Ring at the head of the fresh answer: **`MessageView.tsx:1631`** `cursor && <LiveNib tick={nibTick}/>`,
  component at **`:445-473`** (orbit ring r6 + spark, driven by `:1619` `nibTick`).
- The busy strip: **`MessageView.tsx:1374-1427`** — head of `ThinkingBlock` with
  orbit **`:1392`**, wave **`:1406`**, beads **`:1425`**, dots **`:1395-1399`**.
- The comments claiming relief (`:2097-2100` "3-dot working row retired", `:542-545`
  "small spinning circle removed") refer to **different, already-dead** elements. They do not
  touch M4/M5/M7.
- **If** "ring right after send" instead means the top panel circle appearing the instant you
  send, that is also still mounted at **`ChatPanel.tsx:1918`** (overlaps with (c)).

### (b) "trembling / dancing text — remove" — ❌ NOT DONE
- `revealWords()` **`MessageView.tsx:1171-1181`** wraps every word in `.sc-reason-word`;
  mounted at **`:1453`** for live reasoning.
- CSS `@keyframes reason-word-in` **`stream-motion.css:53-70`** animates `opacity`, `color`
  and `transform: translateY(1px)` on each new word — the literal "trembling/dancing".
- `useSmoothStream` **`:1099-1147`** re-renders per animation frame in both the thinking block
  (`:1293`) and the answer markdown (`:1616`) — secondary suspect.
- Reduced-motion guards exist (`stream-motion.css:400-445`), which only proves the tremor is real.

### (c) "big circle with WORKING/time/HI and a strip below it — merge into that strip" — ❌ NOT DONE
- Big circle panel: **`ChatPanel.tsx:677-893`**, rendered at **`:1918`** as first child of
  `.chat-stream`; 80px SVG at **`:763-767`**, status label `Working…` at **`:868-870`**,
  clock **`:872-874`**, `cp-live-sweep` **`:890`**.
- The strip it should merge into: `RunStatusLine` **`:458-589`**, rendered separately at
  **`:1891`** — i.e. **two DOM blocks, not one**. (The source comment at `:1890-1904` even
  argues about where the strip sits, but never merges it.)
- Merge target: fold C13/C14/C15 into C5 (`:531-588`) and delete the C12 panel + C16 hook.

### (d) "two circles near THINK — one only" — ❌ NOT DONE (in fact three)
- `CompactThinkingOrbit` **`MessageView.tsx:590-649`**, mounted **`:3714`** in the assistant
  row's far-left gutter (40px, rings r11/9/5).
- `PrecisionThinkingOrbit` **`MessageView.tsx:1209-1256`**, mounted **`:1392`** in the
  thinking head (30px, rings r14/10/6).
- Plus the top `LiveThinkingPanel` circle **`ChatPanel.tsx:763-865`** = **three** spinning
  circles in one panel. The comments at `:565-566` and `:3712-3713` claim "one primary /
  no third copy" — factually wrong.
- **Recommended single survivor:** keep `PrecisionThinkingOrbit` (M11) because (e) asks to keep
  and enlarge *the thinking circle*; delete `CompactThinkingOrbit` (M10, mount `:3714`,
  component `:590-649`, hook `:580-588`) and delete the top circle per (c). Confirm with the
  founder if he prefers the gutter circle instead — but then (e)'s "unbox and enlarge" has no target.

### (e) "thinking/reasoning circle inside an ugly square — unbox and enlarge" — ⚠️ HALF DONE
- Enlarged: `MessageView.tsx:1387-1393` sets inline `width:30, height:30` on
  `.sc-reason-glyph`; SVG is `30×30` at **`:1215-1216`**. (CSS base was 15px.)
- **Still boxed:** `console.css:494-503` `.sc-reason-glyph` → `border-radius:4px`, and
  **`console.css:504-512`** `.sc-reason-glyph::after` → `content:''`, `inset:-2px`,
  `border:1px solid …`, `border-radius:5px`, animated by `@keyframes reason-node-pulse`
  **`console.css:761-765`** (opacity up to `0.9`). That is the ugly square, still painted.
  The later override at `console.css:820-827` only sets `position`/`z-index` — it does **not**
  remove the square.
- Fix = remove/zero `console.css:504-512` and the `reason-node-pulse` binding at `:512`;
  keep the enlarged circle. (CSS edit — outside this subagent's no-edit mandate.)

---

## 6. Hand-off list for the parent — exact leftovers to fix
## 6. قائمة التسليم للوكيل الأم — البقايا بأرقام دقيقة

1. `MessageView.tsx:1631` + component `:445-473` — remove `LiveNib` (founder a).
2. `MessageView.tsx:1406` + component `:400-422` — remove `LiveWave` (founder a).
3. `MessageView.tsx:1425` + component `:481-503` — remove `PhaseBeads` (founder a).
4. `MessageView.tsx:1171-1181` + mount `:1453` — remove per-word shimmer (founder b);
   with `stream-motion.css:53-70` and its motion guards `:400-445`.
5. `ChatPanel.tsx:677-893` + mount **`:1918`** + hook `:662-675` — merge into `RunStatusLine`
   at `:1891`, then delete (founder c). Do not leave two clocks: reconcile `:520` vs `:726`
   and `:521-522` vs `:718-725`.
6. `MessageView.tsx:590-649` + mount **`:3714`** + hook `:580-588` — delete the duplicate
   circle (founder d); keep `:1209-1256` mounted at `:1392`.
7. `console.css:504-512` + `reason-node-pulse` `:761-765` — remove the square around the
   reasoning circle (founder e); enlargement at `MessageView.tsx:1389` is already correct.
8. `ChatPanel.tsx:396-445` — delete dead `MessagePhaseLine` (not named by the founder, but it
   is a landmine for a future "strip" regression).
9. Re-run hook-order check after every edit: **no new hook below `MessageView.tsx:3529` or
   below `ChatPanel.tsx:515`**. Typecheck alone is insufficient.

**Bottom line / الخلاصة:** as of this snapshot the panel is **busy, duplicated and not clean**.
The comments describe a clean panel; the JSX does not. Do not close (a)–(e) until the nine items
above are verified gone from **source**, then eyeballed in a live run.
حتى لحظة هذا التقرير اللوحة مزدحمة ومكررة وغير نظيفة؛ التعليقات تصف لوحة نظيفة لكن JSX يقول غير ذلك.
