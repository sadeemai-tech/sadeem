# FULL APP SMOKE — v11.24 (دائرة المخطط الزمني · دائرة THINK · الحجم الطبيعي)

**تقرير الفحص الشامل — موجة 11.24**
Diagnosis + Test only. **No application source was edited by this guard.** / **لم يعدّل هذا الفحص أي مصدر للتطبيق.**

| | |
|---|---|
| Run command | `node --test --test-force-exit tests/v1124-full-smoke.test.mjs` |
| Harness | `tests/v1124-full-smoke.test.mjs` (proven `v1123-full-smoke` engine + v1124 checks) |
| Stamped runs | 2026-11-20 — **two consecutive runs, both 81/81 PASS, 0 fail** (see caveat #1) |
| Result | **81 / 81 tests PASS — 0 fail (×2)** |
| Machine results | `%TEMP%\sadeem-v1124-full-smoke\{results.json, engine-results.json, crashes.log}` |

---

## 1. Verdict / الحكم — BLUNT

**EN — GREEN, but read the caveat.** The proven core gates are green: all **60** screens bundle and SSR-render with **0** crashes and **0** React #300 warnings; **642** controls scanned with **0** dead handlers; all **6** `kdx:agent:run` param shapes drive the real handler cleanly with **0** vague errors. This wave's seven demands were re-verified in **comment-stripped source and a real SSR render**: no app Logo in any live/reasoning position; THINK wears exactly one box-free, enlarged, precise, motion-guarded circle; no `cp-live-dots`/`cp-live-sweep` ring+wave decor; no rotating/trembling label; exactly one compact spinning circle **inside** the run/timeline strip with no standalone panel and no gutter copy; focus mode keeps natural size; the composer has one compact orb and no ctx-meter. **Two consecutive stamped runs were identical: 81/81, 0 fail.** No failure to report.

**AR — أخضر، لكن اقرأ التحذير.** بوابات النواة خضراء: الـ**60** شاشة اشتغلت بصفر انهيار وصفر تحذير React #300، وتم فحص **642** عنصر تحكم بصفر عناصر ميتة، وكل أشكال `kdx:agent:run` الستة مرّت بلا خطأ غامض. مطالب الموجة السبعة أُعيد التحقق منها في **المصدر بعد إزالة التعليقات وفي عرض SSR حقيقي**: لا شعار تطبيق في أي موضع تشغيل/تفكير؛ THINK يرتدي دائرة واحدة بلا إطار وبحجم مكبّر وهندسة دقيقة وحماية حركة؛ لا ديكور حلقة/موجة `cp-live-dots`/`cp-live-sweep`؛ لا تسمية دوّارة/مهتزة؛ دائرة دوّارة واحدة **داخل** شريط التشغيل بلا لوحة مستقلة ولا نسخة في الهامش؛ وضع التركيز يحفظ الحجم الطبيعي؛ والمُحرّر فيه كرة حالة واحدة بلا شريط ctx-meter. **تشغيلان متتاليان متطابقان: 81/81، صفر فشل. لا يوجد أي فشل مُوثّق.**

**But do not treat this as a permanent green light.** This verdict is bound to the source state stamped below. During the run the source was a **moving target**: intermediate edits produced real, caught failures (`ChatLiveIndicator`-style leftovers, a dangling `deltaWordCount`, an undefined `StripOrbit`, a still-mounted gutter circle, and a surviving `sc-shimmer ... infinite`). All of them disappeared after the owning agents saved. Re-run this single command after the last save — that is the gate, not this document.

**لكن لا تعتبر هذا ضوءاً أخضر دائماً.** الحكم مرتبط بحالة المصدر المُوثّقة. أثناء التشغيل كان المصدر **هدفاً متحركاً**: تعديلات وسيطة أنتجت فشلاً حقيقياً تم رصده (بقايا، `deltaWordCount` غير معرّف، `StripOrbit` غير معرّف، نسخة هامش ما زالت مركّبة، و`sc-shimmer ... infinite` باقٍ). كلها اختفت بعد حفظ الوكلاء المعنيين. أعد الأمر بعد حفظ آخر وكيل — تلك هي البوابة، لا هذا المستند.

---

## 2. What changed vs v1123 / ما تغيّر عن 11.23

The v1123 guard *required* a standalone `LiveThinkingPanel` (`cp-live-glyph`) plus a `CompactThinkingOrbit` in the message gutter. v1124 reverses that: the founder wanted **one** compact circle shrunk **into** the timeline strip. The v1124 guard therefore asserts those v1123 markers are **gone** (0), and adds the new strip circle, focus-mode and anti-decor checks. The v1123 engine/SSR/dead-control harness is reused verbatim.

كان فحص 11.23 *يشترط* لوحة `LiveThinkingPanel` مستقلة و`CompactThinkingOrbit` في الهامش. موجة 11.24 تعكس ذلك: المؤسس أراد دائرة واحدة مدمجة **داخل** الشريط الزمني. لذلك يؤكد فحص 11.24 أن علامات 11.23those اختفت (صفر)، ويضيف فحص الدائرة في الشريط ووضع التركيز ومنع الديكور.

---

## 3. Counts / الأرقام (exact, both stamped runs)

```
V1124_FULL_SMOKE_COUNTS={"screens":60,"controls_scanned":642,"dead_controls":0,"unstable_screens":0,
 "stream_logo":0,"think_orbit_src":1,"think_orbit_ssr":1,"think_spin_ssr":true,
 "think_stamp_hook_ssr":1,"think_stamp_square_ssr":0,
 "standalone_panel_src":0,"standalone_panel_ssr":0,
 "ring_wave_src":0,"ring_wave_ssr":0,"gerund_src":0,
 "gutter_orbit_src":0,"gutter_orbit_ssr":0,
 "context_lens_src":1,"context_orb_ssr":1,"ctx_meter_screens":[],
 "logo_sig_think_ssr":false,"logo_sig_running_ssr":false,"wave_failures":0}
```

| Metric | Value |
|---|---|
| Node `test` cases | 81 |
| Passed / Failed | **81 / 0** (×2) |
| Screens bundled + SSR-rendered | 60 (54 baseline + 6 wave) |
| Screen crashes / UNTESTABLE | 0 / 0 |
| React #300 / unstable selectors | 0 screens; global sweep over all of `src/`: 0 |
| Controls scanned / dead | 642 / **0** |
| Engine `kdx:agent:run` shapes | 6 / 6 pass |
| Wave failures | **0** |

---

## 4. Wave-specific evidence / أدلة الموجة (file:line)

| # | Demand | Result | Evidence (stamped state) |
|---:|---|---|---|
| 1 | **No app Logo in live positions** | PASS | `StreamTimeline.tsx`: 0 `<Logo`, 0 `ThinkBrand`, 0 `brand: true`; `MessageView.tsx`: 0 `<Logo`; `ChatPanel.tsx`: only empty-state `<Logo size={40} />` at **:1646**. SSR logo signature = **false** in THINK band, thinking row, settled row and running ChatPanel. (Logos in `AuthScreen`, `Welcome`, `TitleBar`, `Onboarding`, `EditorArea`, `PlansScreen` are empty-state/brand surfaces, not live/reasoning positions.) |
| 2 | **ONE THINK circle** | PASS | `StreamTimeline.tsx`: 1 `<ThinkOrbit` (**461**, `size={16}`), hook-only stamp marker `<span data-phase-mark="sc18-phase-mark" />` (**480**), no SVG/monogram in the think stamp branch; node square cleared inline (**:453**); integer rings r5/r2, 12-o'clock tick, equal-angle `to="360 6 6"`, 1px strokes, both reduced-motion guards (**:274–302**). SSR: exactly 1 `sc18-think-orbit`, 4 circle primitives, `width="16"`/`height="16"`, no stamp square, static (no SMIL) when settled or reduced-motion. |
| 3 | **NO ring/wave decor** | PASS | 0 `cp-live-dots` / `cp-live-sweep` / `@keyframes cp-live-sweep` in `ChatPanel.tsx`, `console.css`, `chat.css` (comment-free TSX); SSR running and idle: `ring_wave_ssr = 0`. |
| 4 | **NO trembling label** | PASS | 0 `rotateGerund` / `GERUND_ROTATE_MS` / `key={token}` in `ChatPanel.tsx`; no `sc-shimmer 4s var(--ease-out) 600ms infinite` in `chat.css`. The phase label is one stable `pickGerund()` (**:529**) rendered via i18n (**:572**). |
| 5 | **ONE compact circle inside timeline strip** | PASS | Standalone `LiveThinkingPanel` / `cp-live-glyph` / `cp-live-panel` gone from `ChatPanel.tsx` (SSR: 0); strip anchor `phase-strip run-strip-v13` at **:537**; `RunStatusLine` (**:459**) carries exactly one inline `<svg viewBox="0 0 16 16">` (**:543–547**) with SMIL `<animateTransform>` (**:558**), `formatElapsedClock` (**:575**) and `fmtTokens(totalTokens) tok` (**:600**); SSR running: exactly 1 `<svg>` inside the strip with real clock + `tok` + word; idle: 0; EN/AR both inside the strip; reduced-motion static. `MessageView.tsx`: 0 `CompactThinkingOrbit` / `sc-think-orbit` (SSR gutter orbits: 0). |
| 6 | **Focus mode natural size (source-level)** | PASS | `shell.css`: 2–3 focus rules, only `display:none !important` (work slot, resizer) and `flex:1 1 auto` growth for the chat slot; zero banned declarations (no max-width/padding/border/shadow/backdrop/gradient/centering/transform/contain/--focus-* tokens); chat panel + descendants never re-styled; chat-left (`.chat-slot-v12 order:1 flex:0 0 auto`) / rail-top (`.app-rail-bar-v13 width:100%`) preserved; `type-scale.css` owns no focus rules; `App.tsx` hides rail/work area in focus. |
| 7 | **ONE composer orb + NO ctx-meter** | PASS | `Composer.tsx`: `<VoiceInput` **:1942**, `<ContextLens compact />` **:1977** (orb after mic), exactly 1 `<ContextLens`; no duplicate in `ChatPanel.tsx` / `StatusBar.tsx`; no `<ContextRing>` anywhere; 0 ctx-meter/ctx-track/ctx-fill/ctx-strip in Composer, ContextLens, popover, ChatPanel, StatusBar; SSR: exactly 1 `ctx-orb--compact`, `ctx_meter_screens = []`. |

---

## 5. Failures / الفشل

**Both stamped runs: NONE.** 0 test failures, 0 screen crashes, 0 dead controls, 0 unstable selectors, 0 vague engine errors, 0 wave failures. `crashes.log` is empty in both runs.

**Prior observation (honest, not hand-waved):** while the owning agents were still editing, the guard repeatedly failed on real intermediate states — e.g. `deltaWordCount is not defined` and `StripOrbit is not defined` (dangling references after the strip-circle rewrite), a still-mounted `CompactThinkingOrbit` in `MessageView.tsx`, and `sc-shimmer 4s ... infinite` at `chat.css:832`. Each was caught with `file:line`, and each was subsequently fixed by the owning agents. None recurred in either stamped run. The moving-tree failures are the reason two clean runs were demanded.

**ملاحظة سابقة (صادقة):** أثناء تحرير الوكلاء المعنيين فشل الفحص مراراً على حالات وسيطة حقيقية — مثل `deltaWordCount is not defined` و`StripOrbit is not defined` (مراجع معلّقة بعد إعادة كتابة دائرة الشريط)، و`CompactThinkingOrbit` ما زال مركّباً في `MessageView.tsx`، و`sc-shimmer 4s ... infinite` في `chat.css:832`. كلها رُصدت بـ`file:line`، ثم أصلحها الوكلاء. لم يظهر أي منها في أي من التشغيلين الموثّقين.

---

## 6. Runs / التشغيلات

| Run | Result | Note |
|---|---|---|
| during active editing | multiple transient failures | dangling `deltaWordCount` / `StripOrbit`, gutter circle still mounted, shimmer still infinite — discarded, moving target |
| stabilized run A | 81 / 81 PASS, 0 FAIL | clean |
| stabilized run B | 81 / 81 PASS, 0 FAIL | identical to A — deterministic |

Two consecutive clean runs achieved. The gate remains the single command after the last save.

---

## 7. Engine-level smoke / فحص المحرك

Real `kdx:agent:run` IPC handler, esbuild-bundled from `electron/agent/register.ts`, driven through `normalizeRunParams` with a local mock provider (zero network). Security gate preserved (`gated()` forwards `(e, ...args)`).

| Shape | Input | Result |
|---|---|---|
| normal | full params, model object | PASS — provider called, `turn_end` |
| model-as-string | `model: "custom/m-string"` | PASS — normalized, run starts |
| missing-messages+text | no `messages`, `text` present | PASS — synthesized user row sent |
| empty-messages | `messages: []`, no text | PASS — precise `NO_USER_MESSAGE`, no run |
| raw undefined | `undefined` | PASS — precise `NO_PARAMS` |
| raw non-object | `42` | PASS — precise `BAD_SHAPE` |

Across all shapes: **zero** vague "Invalid run parameters" errors, **zero** "Run crashed before its report", **zero** thrown handler errors.

**Still not perfect:** the user-facing refusal still merges "no messages" and "no model" into one line; only the machine `code` distinguishes them. Flagged, not claimed as ideal.

---

## 8. Screen inventory (60) / جدول الشاشات

- **core (11):** ChatPanel, Home, Onboarding, AuthScreen, Welcome, WhatsNew, CommandPalette, SettingsModal, DiffView, DiffModal, EditorArea
- **rail (17):** WorkspacePanel, SessionsPanel, GitPanel, MCPPanel, UsagePanel, DnaPanel, FlowsPanel, SkillsPanel, ArtifactsPanel, LibraryPanel, WikiPanel(via Library initialTab), PromptsPanel, SearchPanel, SubagentsPanel, WikiPanel(component), SchedulePanel, SecurityPanel
- **settings (26):** General, Appearance, Notifications, Voice, Agent, Privacy, SkillsMemory, Models, Models(providersOnly), Mcp, Plugins, ApiServer, Remote, Preview, Editor, Terminal, GitWorktree, Billing, Shortcuts, Evidence, Logs, Updates, Feedback, Advanced, Approvals, AccountAuthCard
- **wave (6):** StreamBandShell(think·live), ChatPanel(running·circles), MessageView(thinking·circles), MessageView(settled), Composer, ProofRibbon

All 60 = `RENDERS OK`.

---

## 9. Honest limitations / حدود الفحص

1. SSR is server rendering: effects, animation frames, timers and real pointer interaction are not exercised. Dead-handler detection is a conservative static scan (642 controls), not a browser click-through.
2. The spinning circles are checked as rendered markup and comment-free source geometry; smooth animation in a real browser is not measured here.
3. The engine smoke uses a local mock provider — it proves param repair, run start and terminal reporting, not provider-specific streaming quality.
4. The source was a moving target during the run. Two consecutive green runs raise confidence but do not guarantee future state — re-run the single command after the last save.

---

## 10. Bottom line / الخلاصة

**EN:** GREEN on every gate this guard owns: 60/60 screens, 81/81 tests (×2), 0 crashes, 0 React #300, 0 dead controls over 642, 6/6 run-param shapes, no vague error. All seven v1124 demands were re-verified in source **and** SSR: no logo in THINK/live positions, no ring/wave decor, no trembling label, one compact circle inside the timeline strip, one THINK circle, focus mode natural size, one composer orb with no ctx-meter. Re-run after the last agent saves.

**AR:** أخضر على كل بوابة يملكها هذا الفحص: 60/60 شاشة، 81/81 اختباراً (مرتين)، صفر انهيار، صفر React #300، صفر عناصر ميتة من 642، 6/6 أشكال تشغيل، بلا خطأ غامض. أُعيد التحقق من مطالب 11.24 السبعة في المصدر **و** في SSR: لا شعار في مواضع THINK/التشغيل، لا ديكور حلقة/موجة، لا تسمية مهتزة، دائرة مدمجة واحدة داخل الشريط الزمني، دائرة THINK واحدة، وضع تركيز بالحجم الطبيعي، كرة مُحرّر واحدة بلا ctx-meter. أعد التشغيل بعد حفظ آخر وكيل.
