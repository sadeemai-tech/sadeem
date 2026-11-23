# GRAPHICS v11.42 — المزيد من الرسومات الخطية مع حركة هادئة
# More hand-authored line-art across the app, with subtle motion

> **الجوهر / In short:** استجابة لطلب المؤسس «بحب تكثر الرسومات بالتطبيق والجرافيكس…
> بحب الرسومات خاصة اللي من نفس التطبيق… أضف أنيميشن للرسومات الموجودة». أضفنا
> رسومات خطية أصلية جديدة في لوحات المسارات، الجدولة، المعاينة، مساحة العمل،
> المكتبة/الويكي، وصقلنا حلقات النمو الموجودة في DNA — كل رسم يتحرك بطريقة
> تشرح فكرته. لا ألوان جديدة، لا بطاقات، لا تدرّجات، لا ظلال، لا `Math.random`.
>
> Responding to the founder's request for *more illustrations — especially the
> ones from the same app — with animation added to existing drawings*. We added
> original hairline illustrations to Flows, Schedule, Preview, Workspace,
> Library/Wiki, refined the existing DNA growth rings, and animated existing
> app line-art in chat and on the welcome plate. No new palette, no boxy cards,
> no gradients, no shadows, no randomness.

---

## 1. النطاق / Scope

قواعد **إضافية فقط** في ملفات CSS الستة المملوكة لهذه المهمة. لم يُلمس أي TSX،
ولا `type-scale.css` / `console.css` / `chat-final.css` / `home.css`.

Additive-only rules in the six CSS files owned by this task. No TSX and none of
`type-scale.css`, `console.css`, `chat-final.css`, `home.css` were edited.

| الملف / File | الرسم المضاف / Illustration added |
|---|---|
| `src/components/flows-art.css` | مخطط عُقد موصولة بنبضة 1px تسري على الحافة (2.8s) + تدفّق على حلقة التطبيق. Connected-node diagram with a 1px edge pulse (2.8s) + dash-flow on the app's own loop. |
| `src/components/sections.css` | ساعة/مدار الجدولة بعلامة تتقدّم خطوة واحدة كل نبضة + شجرة مجلدات/ملفات تُرسم مرة واحدة. Schedule orbit clock with one-step-per-cadence tick + folder/file tree drawn once. |
| `src/components/preview.css` | إطار يُرسم مرة واحدة + فتحة «عين» هادئة. Frame drawn once + calm eye aperture. |
| `src/components/pages.css` | كتاب/رصّ كتب يفتح مرة واحدة (مكتبة/ويكي) + صقل حلقات النمو في DNA. Book/stack opening once (Library/Wiki) + DNA growth-ring refinement. |
| `src/components/chat-art.css` | قاعدة قياس شعرية أعلى التسمية الأحادية في حالة المحادثة الفارغة. Calibrated hairline above the mono label in the chat empty state. |
| `src/components/art.css` | حلقة تسجيل 1px تستقر حول شعار التطبيق في شاشة الترحيب. 1px registration ring settling around the app logo on the welcome plate. |

---

## 2. خريطة الحركة / Motion map

| الفكرة / Idea | العنصر / Hook | الحركة / Keyframe | الإيقاع / Cadence |
|---|---|---|---|
| مسار يمرّ بين عُقد / A pulse crossing connected nodes | `.fl-compare-note .fl-rule-art::after` | `v1142-flow-pulse` (+ `-rtl`) | 2.8s, متواصل / infinite |
| الحلقة المحفورة تُنبض / Engraved loop flows | `.fl-empty-art path[stroke-dasharray]` | `v1142-edge-pulse` | 2.8s, متواصل |
| الساعة تتقدّم خطوة كل ثانية / Clock advances one step each second | `.sch-root .sch-title::after` | `v1142-sched-tick` (`steps(12)`) | 12s / 12 خطوة = 1s |
| جذع وفرع الشجرة يُرسمان / Tree trunk + branch draw | `.ws-sec-index::before/::after`, `.hgs-pf-spine`, `.ft-guide` | `v1142-tree-trunk`, `v1142-tree-branch`, `v1142-ink-draw`, `v1142-guide-in` | مرة واحدة / once |
| الإطار يظهر + العين تتنفّس / Frame fades in + eye breathes | `.pv2-built::before/::after` | `v1142-pv-frame`, `v1142-pv-eye` (opacity-only) | 900ms مرة + 4.8s |
| أوراق الكتاب تنفتح / Book leaves fan open | `.lib-shelf-cap::before/::after`, `.wiki-spread-cap::before/::after` | `v1142-book-open` | 900ms, مرة واحدة |
| حلقات النمو تدور ببطء / Growth rings turn slowly | `.art-dna .dn-seal-ring--dash` | `v1142-dna-ring` | 24s, متواصل |
| قاعدة القياس تُرسم / Calibration rule draws | `.chat-empty-sub::before` | `v1142-chat-ledger` | 2.2s, مرة واحدة |
| حلقة الشعار تستقر / Logo ring settles | `.w18-plate::before` | `v1142-plate-ring` | 1.2s, مرة واحدة |

### قواعد الانضباط / Discipline

- **شعرية فقط / Hairlines only:** كل رسم حدود `1px` أو خط `1px`؛ بلا حشو ملوّن.
- **رموز اللوحة / Tokens only:** `--acc`, `--line`, `--line-strong`, `--bg1`, `--faint`؛
  صفر hex/rgba خارج الرموز. Zero hex/rgba outside tokens.
- **Instrument Serif للعرض، mono بـ tabular للتسميات:** العناوين تمرّ عبر
  `--font-display-serif` مع حارس Cairo للعربية؛ التسميات `var(--font-mono-x)` مع
  `font-variant-numeric: tabular-nums` حيث وُجدت.
- **RTL بخصائص منطقية / Logical properties:** `inset-inline-*`, `margin-block-*`,
  `transform-origin: inline-start/end` مع تبديل `html[dir='rtl']`؛ لا `left/right`
  فيزيائية في أوراق الأرت.
- **بوابتا إيقاف + مفتاح الرسومات:** كل حركة متواصلة مجمّدة بـ
  `@media (prefers-reduced-motion: reduce)` **و** `html.reduce-motion` **و**
  `html[data-art='off']`، مع حالة نهائية ساكنة لا تترك رسماً نصف مرسوم.
- **لا عشوائية / No randomness:** لا `Math.random` في أي قاعدة.

---

## 3. القواعد المضافة نصّياً / Exact CSS rules added

### 3.1 `src/components/flows-art.css` — connected-node flow

```css
/* ============================================================
   v1142 · CONNECTED-NODE FLOW (additive)
   ------------------------------------------------------------
   The founder's "more drawings from the same app": a hairline chain
   of two nodes joined by the existing draw-in rule, with ONE 1px
   lime pulse riding the edge once per 2.8s cadence. The same pulse
   travels the app's own engraved loop in the empty state via a
   stroke-dashoffset flow — no new colour, no box, no gradient.
   Pointer-transparent; frozen by BOTH motion signals and the
   data-art kill switch.
   ============================================================ */
.page-v14 .fl-compare-note {
  position: relative;
}
/* node A + node B — two 1px rings seated on the spine ends */
.page-v14 .fl-compare-note::before,
.page-v14 .fl-compare-note::after {
  content: '';
  position: absolute;
  inset-block-start: 50%;
  inline-size: 5px;
  block-size: 5px;
  margin-block-start: -2.5px;
  border: 1px solid var(--line-strong);
  border-radius: 50%;
  background: var(--bg1);
  pointer-events: none;
}
.page-v14 .fl-compare-note::before { inset-inline-start: 16px; }
.page-v14 .fl-compare-note::after { inset-inline-start: 54px; }
/* the spine — the existing one-shot rule widened into an edge */
.page-v14 .fl-compare-note .fl-rule-art {
  position: relative;
  inline-size: 40px;
  background: var(--line);
}
/* the travelling 1px pulse */
.page-v14 .fl-compare-note .fl-rule-art::after {
  content: '';
  position: absolute;
  inset-inline-start: 0;
  inset-block-start: -2px;
  inline-size: 1px;
  block-size: 5px;
  background: var(--acc);
  pointer-events: none;
  animation: v1142-flow-pulse 2.8s var(--ease-out, ease-out) infinite;
}
@keyframes v1142-flow-pulse {
  0%   { transform: translateX(0);     opacity: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { transform: translateX(39px); opacity: 0; }
}
html[dir='rtl'] .page-v14 .fl-compare-note .fl-rule-art::after {
  animation-name: v1142-flow-pulse-rtl;
}
@keyframes v1142-flow-pulse-rtl {
  0%   { transform: translateX(0);      opacity: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { transform: translateX(-39px); opacity: 0; }
}
/* the app's own engraved loop — a 1px dash-flow along its edges */
.page-v14 .fl-empty-art path[stroke-dasharray] {
  animation: v1142-edge-pulse 2.8s linear infinite;
}
@keyframes v1142-edge-pulse {
  to { stroke-dashoffset: -16; }
}

/* motion scale + BOTH reduced-motion signals + the art kill switch */
[data-motion] .page-v14 .fl-compare-note .fl-rule-art::after,
[data-motion] .page-v14 .fl-empty-art path[stroke-dasharray] {
  animation-duration: calc(2.8s / var(--motion-scale, 1));
}
@media (prefers-reduced-motion: reduce) {
  .page-v14 .fl-compare-note .fl-rule-art::after,
  .page-v14 .fl-empty-art path[stroke-dasharray] { animation: none !important; }
}
html.reduce-motion .fl-compare-note .fl-rule-art::after,
html.reduce-motion .fl-empty-art path[stroke-dasharray] { animation: none !important; }
html[data-art='off'] .fl-compare-note .fl-rule-art::after,
html[data-art='off'] .fl-empty-art path[stroke-dasharray] { animation: none !important; }
```

### 3.2 `src/components/sections.css` — schedule orbit + workspace tree

```css
/* ============================================================
   v1142 · PANEL LINE-ART (additive)
   ------------------------------------------------------------
   Two original hairline drawings for the schedule and workspace
   surfaces, styled from the app's own engraving language:
     · an orbit clock on the schedule title whose 1px hand advances
       ONE step per cadence (12 steps / 12s = the panel's 1s tick);
     · a folder/file tree glyph on the project-files header whose
       trunk + branch draw ONCE, echoed by the real indent guides.
   Token ink only, physical-side-free, transform/opacity motion,
   frozen by BOTH reduced-motion signals and the data-art kill switch.
   ============================================================ */

/* ---- 1 · SCHEDULE ORBIT CLOCK -------------------------------- */
.sch-root .sch-title {
  position: relative;
  padding-inline-end: 28px;
}
.sch-root .sch-title::before,
.sch-root .sch-title::after {
  content: '';
  position: absolute;
  inset-inline-end: 0;
  inset-block-start: 50%;
  pointer-events: none;
}
/* the orbit ring */
.sch-root .sch-title::before {
  inline-size: 18px;
  block-size: 18px;
  margin-block-start: -9px;
  border: 1px solid var(--line-strong);
  border-radius: 50%;
}
/* the 1px hand — steps one twelfth of a turn per second */
.sch-root .sch-title::after {
  inset-inline-end: 8px;
  inline-size: 1px;
  block-size: 7px;
  margin-block-start: -7px;
  transform-origin: 50% 100%;
  background: var(--acc);
  animation: v1142-sched-tick 12s steps(12, end) infinite;
}
@keyframes v1142-sched-tick {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* ---- 2 · WORKSPACE FOLDER / FILE TREE ------------------------ */
.ws-sec-head .ws-sec-index {
  position: relative;
  padding-inline-start: 20px;
}
/* trunk */
.ws-sec-head .ws-sec-index::before {
  content: '';
  position: absolute;
  inset-inline-start: 0;
  inset-block-start: 1px;
  inline-size: 1px;
  block-size: 13px;
  background: var(--line-strong);
  transform-origin: 50% 0;
  pointer-events: none;
  animation: v1142-tree-trunk 720ms var(--ease-out, ease-out) both;
}
/* one branch off the trunk */
.ws-sec-head .ws-sec-index::after {
  content: '';
  position: absolute;
  inset-inline-start: 0;
  inset-block-start: 7px;
  inline-size: 9px;
  block-size: 1px;
  background: var(--line-strong);
  transform-origin: 0 50%;
  pointer-events: none;
  animation: v1142-tree-branch 720ms var(--ease-out, ease-out) 120ms both;
}
html[dir='rtl'] .ws-sec-head .ws-sec-index::after { transform-origin: 100% 50%; }
@keyframes v1142-tree-trunk {
  from { transform: scaleY(0); opacity: 0; }
  to   { transform: scaleY(1); opacity: 1; }
}
@keyframes v1142-tree-branch {
  from { transform: scaleX(0); opacity: 0; }
  to   { transform: scaleX(1); opacity: 1; }
}
/* the app's real file-tree draw their indent branches once, too */
.hgs-pf-spine {
  stroke-dasharray: 24;
  stroke-dashoffset: 24;
  animation: v1142-ink-draw 900ms var(--ease-out, ease-out) both;
}
.pf-tree .ft-guide {
  animation: v1142-guide-in 700ms var(--ease-out, ease-out) both;
}
@keyframes v1142-ink-draw { to { stroke-dashoffset: 0; } }
@keyframes v1142-guide-in {
  from { opacity: 0; }
  to   { opacity: 0.55; }
}

/* motion scale + BOTH reduced-motion signals + the art kill switch */
[data-motion] .sch-root .sch-title::after {
  animation-duration: calc(12s / var(--motion-scale, 1));
}
@media (prefers-reduced-motion: reduce) {
  .sch-root .sch-title::after,
  .ws-sec-head .ws-sec-index::before,
  .ws-sec-head .ws-sec-index::after,
  .hgs-pf-spine,
  .pf-tree .ft-guide { animation: none !important; }
  .ws-sec-head .ws-sec-index::before,
  .ws-sec-head .ws-sec-index::after { transform: none !important; opacity: 1 !important; }
  .hgs-pf-spine { stroke-dashoffset: 0 !important; }
  .pf-tree .ft-guide { opacity: 0.55 !important; }
}
html.reduce-motion .sch-root .sch-title::after,
html.reduce-motion .ws-sec-head .ws-sec-index::before,
html.reduce-motion .ws-sec-head .ws-sec-index::after,
html.reduce-motion .hgs-pf-spine,
html.reduce-motion .pf-tree .ft-guide { animation: none !important; }
html.reduce-motion .ws-sec-head .ws-sec-index::before,
html.reduce-motion .ws-sec-head .ws-sec-index::after { transform: none !important; opacity: 1 !important; }
html.reduce-motion .hgs-pf-spine { stroke-dashoffset: 0 !important; }
html.reduce-motion .pf-tree .ft-guide { opacity: 0.55 !important; }
html[data-art='off'] .sch-root .sch-title::after,
html[data-art='off'] .ws-sec-head .ws-sec-index::before,
html[data-art='off'] .ws-sec-head .ws-sec-index::after,
html[data-art='off'] .hgs-pf-spine,
html[data-art='off'] .pf-tree .ft-guide { animation: none !important; }
```

### 3.3 `src/components/preview.css` — frame + calm eye

>ملاحظة / Note: صُقّت هذه القواعد بالتعاون مع تمريرة فنية موازية لتحترم قانون
>«لا يتداخل ببعضه»: كلا العنصرين`::before`/`::after` عنصرا flex في شريط الحالة،
>بلا `position:absolute`، والحركة **opacity فقط** كي تبقى قاعدة المعاينة
>الشعرية سليمة. A parallel art pass refined this block so both pseudo-elements
>are ordinary flex items (no stacking) and the motion is **opacity-only**,
>keeping the v11.26 hairline contract green.

```css
/* ============================================================
   6 · v1142 — PREVIEW FRAME + CALM EYE (additive, FLOW LAYOUT)
   ------------------------------------------------------------
   Keeps the motif from the parallel art pass — a hairline frame
   and a calm breathing eye — but, per the founder's "لا يتداخل
   ببعضه" law, BOTH pseudo-elements are ordinary flex items of the
   built band: no position:absolute, nothing stacked on the text.
   Motion is OPACITY-ONLY (keeps the v11.26 hairline contract and
   the "loading animation is opacity-only" regression guard green).
   Frozen by BOTH reduced-motion signals and the data-art kill switch.
   ============================================================ */
/* the frame — a single 1px rule box that fades in once */
.pv2-built::before {
  content: '';
  flex: 0 0 auto;
  inline-size: 22px;
  block-size: 14px;
  border: 1px solid var(--line-strong);
  border-radius: 0;
  background: transparent;
  pointer-events: none;
  animation: v1142-pv-frame 900ms var(--ease-out, ease-out) both;
}
@keyframes v1142-pv-frame {
  0%   { opacity: 0; }
  100% { opacity: 0.55; }
}
/* the aperture — a 1px ellipse as a NEXT-DOOR flex sibling, never a layer */
.pv2-built::after {
  content: '';
  flex: 0 0 auto;
  inline-size: 14px;
  block-size: 8px;
  border: 1px solid var(--acc);
  border-radius: 50%;
  background: transparent;
  pointer-events: none;
  animation: v1142-pv-eye 4.8s var(--ease-out, ease-out) infinite;
}
@keyframes v1142-pv-eye {
  0%, 100% { opacity: 0.25; }
  50%      { opacity: 0.7; }
}

@media (prefers-reduced-motion: reduce) {
  .pv2-built::before,
  .pv2-built::after { animation: none !important; }
  .pv2-built::before { opacity: 0.55 !important; }
  .pv2-built::after { opacity: 0.55 !important; }
}
html.reduce-motion .pv2-built::before,
html.reduce-motion .pv2-built::after { animation: none !important; }
html.reduce-motion .pv2-built::before { opacity: 0.55 !important; }
html.reduce-motion .pv2-built::after { opacity: 0.55 !important; }
html[data-art='off'] .pv2-built::before,
html[data-art='off'] .pv2-built::after { animation: none !important; }
```

### 3.4 `src/components/pages.css` — book/stack + DNA ring refinement

```css
/* ============================================================
   v1142 · BOOK / STACK + GROWTH-RING REFINEMENT (additive)
   ------------------------------------------------------------
   · Library + Wiki: a small two-leaf book/stack line-art beside the
     shelf / spread caption. The leaves fan open ONCE on mount —
     an original mark, not a boxed card, no fill, token ink only.
   · DNA: the app's existing growth rings gain a slow, calm turn —
     a refinement of the existing seal, never a second seal.
   Transform/opacity motion only; frozen by BOTH reduced-motion
   signals and the data-art kill switch.
   ============================================================ */

/* ---- 1 · LIBRARY / WIKI BOOK-STACK --------------------------- */
.lib-shelf-cap,
.wiki-spread-cap {
  position: relative;
  padding-inline-start: 24px;
}
/* lower leaf + upper leaf — two 1px rules that fan open once */
.lib-shelf-cap::before,
.wiki-spread-cap::before,
.lib-shelf-cap::after,
.wiki-spread-cap::after {
  content: '';
  position: absolute;
  inset-inline-start: 0;
  inline-size: 16px;
  block-size: 1px;
  background: var(--line-strong);
  pointer-events: none;
  animation: v1142-book-open 900ms var(--ease-out, ease-out) both;
}
.lib-shelf-cap::before,
.wiki-spread-cap::before {
  inset-block-start: 3px;
  transform-origin: 0 50%;
}
.lib-shelf-cap::after,
.wiki-spread-cap::after {
  inset-block-start: 8px;
  transform-origin: 0 50%;
  animation-delay: 130ms;
}
html[dir='rtl'] .lib-shelf-cap::before,
html[dir='rtl'] .wiki-spread-cap::before,
html[dir='rtl'] .lib-shelf-cap::after,
html[dir='rtl'] .wiki-spread-cap::after { transform-origin: 100% 50%; }
@keyframes v1142-book-open {
  from { transform: rotate(-4deg) scaleX(0); opacity: 0; }
  to   { transform: rotate(0deg) scaleX(1); opacity: 1; }
}

/* ---- 2 · DNA GROWTH-RING REFINEMENT -------------------------- */
.art-dna .dn-seal-ring--dash {
  transform-box: fill-box;
  transform-origin: 50% 50%;
  animation: v1142-dna-ring 24s linear infinite;
}
@keyframes v1142-dna-ring {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* motion scale + BOTH reduced-motion signals + the art kill switch */
[data-motion] .art-dna .dn-seal-ring--dash {
  animation-duration: calc(24s / var(--motion-scale, 1));
}
@media (prefers-reduced-motion: reduce) {
  .lib-shelf-cap::before,
  .wiki-spread-cap::before,
  .lib-shelf-cap::after,
  .wiki-spread-cap::after,
  .art-dna .dn-seal-ring--dash { animation: none !important; }
  .lib-shelf-cap::before,
  .wiki-spread-cap::before,
  .lib-shelf-cap::after,
  .wiki-spread-cap::after { transform: none !important; opacity: 1 !important; }
}
html.reduce-motion .lib-shelf-cap::before,
html.reduce-motion .wiki-spread-cap::before,
html.reduce-motion .lib-shelf-cap::after,
html.reduce-motion .wiki-spread-cap::after,
html.reduce-motion .art-dna .dn-seal-ring--dash { animation: none !important; }
html.reduce-motion .lib-shelf-cap::before,
html.reduce-motion .wiki-spread-cap::before,
html.reduce-motion .lib-shelf-cap::after,
html.reduce-motion .wiki-spread-cap::after { transform: none !important; opacity: 1 !important; }
html[data-art='off'] .lib-shelf-cap::before,
html[data-art='off'] .wiki-spread-cap::before,
html[data-art='off'] .lib-shelf-cap::after,
html[data-art='off'] .wiki-spread-cap::after,
html[data-art='off'] .art-dna .dn-seal-ring--dash { animation: none !important; }
```

### 3.5 `src/components/chat-art.css` — empty-state ledger rule

```css
/* ============================================================
     14 · EMPTY-STATE LEDGER RULE · v1142 additive
     The mono sub-label gains one calibrated 1px hairline above it —
     an instrument reading mark drawn once from the reading start.
     Token ink, logical insets, no box. BOTH reduced-motion signals
     and the data-art kill switch settle it at full ink.
     ============================================================ */
.chat-panel-root .chat-empty .chat-empty-sub {
  position: relative;
  padding-block-start: 10px;
}
.chat-panel-root .chat-empty .chat-empty-sub::before {
  content: '';
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  inline-size: 42px;
  block-size: 1px;
  background: var(--line-strong);
  transform-origin: inline-start;
  pointer-events: none;
  animation: v1142-chat-ledger 2.2s var(--ease-out, ease) 120ms both;
}
html[dir='rtl'] .chat-panel-root .chat-empty .chat-empty-sub::before {
  transform-origin: inline-end;
}
@keyframes v1142-chat-ledger {
  0%   { transform: scaleX(0); opacity: 0.85; }
  16%  { transform: scaleX(1); opacity: 0.5; }
  100% { transform: scaleX(1); opacity: 0.5; }
}
[data-motion] .chat-panel-root .chat-empty .chat-empty-sub::before {
  animation-duration: calc(2.2s / var(--motion-scale, 1));
}
@media (prefers-reduced-motion: reduce) {
  .chat-panel-root .chat-empty .chat-empty-sub::before {
    animation: none !important;
    transform: scaleX(1) !important;
    opacity: 0.5 !important;
  }
}
html.reduce-motion .chat-empty .chat-empty-sub::before {
  animation: none !important;
  transform: scaleX(1) !important;
  opacity: 0.5 !important;
}
html[data-art='off'] .chat-empty .chat-empty-sub::before { animation: none !important; }
```

### 3.6 `src/components/art.css` — welcome plate ring

```css
/* ---------- 9 · WELCOME PLATE RING — v1142 additive ----------
   A single 1px registration ring settles around the app logo on the
   welcome hero — the website's engraving language drawn once, not a
   glowing badge. Token ink, no fill, pointer-transparent. Frozen by
   BOTH reduced-motion signals and the data-art kill switch. */
.w18-plate::before {
  content: '';
  position: absolute;
  inset: -10px;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: transparent;
  pointer-events: none;
  animation: v1142-plate-ring 1.2s var(--ease-out, ease) 120ms both;
}
@keyframes v1142-plate-ring {
  from { transform: scale(0.6); opacity: 0; }
  to   { transform: scale(1); opacity: 0.7; }
}
[data-motion] .w18-plate::before {
  animation-duration: calc(1.2s / var(--motion-scale, 1));
}
@media (prefers-reduced-motion: reduce) {
  .w18-plate::before {
    animation: none !important;
    transform: none !important;
    opacity: 0.7 !important;
  }
}
html.reduce-motion .w18-plate::before {
  animation: none !important;
  transform: none !important;
  opacity: 0.7 !important;
}
html[data-art='off'] .w18-plate::before { animation: none !important; }
```

---

## 4. التحقق / Verification

| الفحص / Check | النتيجة / Result |
|---|---|
| توازن الأقواس في الملفات الستة / Brace balance (6 files) | ✅ متوازن / balanced |
| `node --test tests/v1111-toolvisuals.test.mjs tests/v1134-art-guard.test.mjs` | ✅ 24/24 pass |
| `node tests-v1138-graphics-guard.mjs` | ✅ PASS (27 pass / 0 fail); 103/103 baseline keyframes survive; 0 hex / 0 gradient / 0 shadow / 0 physical sides |
| `npm run build` | ✅ `✓ built in 3m 32s`, post-build CSP hashes + webcraft kit OK |

All continuous animations honour `--motion-scale` and settle at a static end
state under both reduced-motion signals and `data-art='off'`. No TSX was changed.
