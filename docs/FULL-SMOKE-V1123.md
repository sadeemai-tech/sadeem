# FULL APP SMOKE — v11.23 (الدائرة الحقيقية · شعار THINK · الحلقة المكررة)

**تقرير الفحص الشامل — موجة 11.23**
Diagnosis + Test only. **No application source was edited by this guard.**

| | |
|---|---|
| Run command | `node --test --test-force-exit tests/v1123-full-smoke.test.mjs` |
| Harness | `tests/v1123-full-smoke.test.mjs` (proven `v1122-full-smoke` harness + v1123 checks) |
| Stamped runs | 2026-11-20 — **two consecutive runs, both 80/80 PASS, 0 fail** (see caveat #1) |
| Result | **80 / 80 tests PASS — 0 fail (×2)** |
| Machine results | `%TEMP%\sadeem-v1123-full-smoke\{results.json, engine-results.json, crashes.log}` |

---

## 1. Verdict / الحكم — BLUNT

**EN — GREEN, and this time the old claim was actually re-verified.** The v11.22 report
*claimed* the circles and logo problem was fixed. It was not. This guard re-checked the
exact three complaints in **both comment-stripped source and a real SSR render**: the
THINK band now spins a circle (no app logo), the duplicate `ChatLiveIndicator` ring is
gone, and exactly one primary circle + one context orb remain. All 60 screens render,
0 React #300, 0 dead controls over 642 scanned, and all 6 `kdx:agent:run` param shapes
drive the real handler cleanly. **Two consecutive stamped runs were identical: 80/80,
0 fail.** No failure to report.

**AR — أخضر، وهذه المرة تم التحقق الفعلي من الادعاء القديم.** تقرير 11.22 *ادعى* أن
مشكلة الدوائر والشعار اُصلحت، لكنها لم تكن كذلك. أعاد هذا الفحص التحقق من الشكاوى
الثلاث بالضبط في **المصدر بعد إزالة التعليقات وفي عرض SSR حقيقي**: شريط THINK يدوّر
دائرة الآن (بلا شعار تطبيق)، حلقة `ChatLiveIndicator` المكررة اختفت، وبقيت دائرة
أولية واحدة وكرة حالة واحدة فقط. كل الشاشات الـ60 اشتغلت، صفر React #300، صفر
عناصر ميتة من 642 تم فحصها، وكل أشكال الاستدعاء الستة لـ`kdx:agent:run` مرّت عبر
المعالج الحقيقي بلا خطأ. **تشغيلان متتاليان: 80/80، صفر فشل في كليهما. لا يوجد أي فشل مُوثّق.**

**But do not treat this as a permanent green light.** This verdict is bound to the
source state stamped below. The source was a moving target: an earlier baseline run of
the *same proven engine harness* (v11.22) **failed** `ENGINE SHAPE 1/4 (normal)` while
agents were still editing; the stamped v11.23 run passed 6/6. Re-run this single command
after the last agent saves — that is the gate, not this document.

**لكن لا تعتبر هذا ضوءاً أخضر دائماً.** الحكم مرتبط بحالة المصدر المُوثّقة أدناه.
المصدر كان هدفاً متحركاً: تشغيل أساس سابق لنفس منظومة المحرك (11.22) **فشل** في
`ENGINE SHAPE 1/4 (normal)` أثناء تحرير الوكلاء؛ تشغيل 11.23 الموثّق نجح 6/6.
أعد الأمر بعد حفظ آخر وكيل — تلك هي البوابة، لا هذا المستند.

---

## 2. What changed vs the false v1122 pass / ما تغيّر عن ادعاء 11.22

| Founder complaint | v1122 claimed | v1123 reality (source + SSR) |
|---|---|---|
| App logo beside THINK | "fixed" | **Was still there**: `ThinkBrand = () => <Logo>` + `brand: true`. Now removed; THINK renders a spinning circle. |
| Duplicate working ring | "fixed" | **Was still there**: `ChatLiveIndicator` / `chat-live-ring`. Now deleted — not hidden. |
| One primary circle | "fixed" | Now counted in source *and* SSR: exactly 1 `LiveThinkingPanel` / `cp-live-glyph`. |

---

## 3. Counts / الأرقام (exact)

```
WAVE_COUNTS={"stream_logo":0,"think_brand":0,"think_spin_ssr":true,
 "chat_live_indicator":0,"chat_live_ring_src":0,"chat_live_ring_ssr":0,
 "primary_glyph_src":1,"primary_glyph_ssr":1,
 "live_panel_mounts_all_tsx":1,"compact_orbit_mounts_all_tsx":1,
 "msg_logo":0,"chat_logo":1,"context_lens_src":1,"context_orb_ssr":1,
 "ctx_meter_screens":[],"logo_sig_think_ssr":false,
 "logo_sig_running_ssr":false,"screens":60,"controls_scanned":642,
 "dead_controls":0,"unstable_screens":0}
```

| Metric | Value |
|---|---|
| Node `test` cases | 80 |
| Passed / Failed | **80 / 0** |
| Screens bundled + SSR-rendered | 60 (54 baseline + 6 wave) |
| Screen crashes / UNTESTABLE | 0 / 0 |
| React #300 / unstable selectors | 0 screens; global sweep over all of `src/`: 0 |
| Controls scanned / dead | 642 / **0** |
| Engine `kdx:agent:run` shapes | 6 / 6 pass (5 test cases; one drives undefined + number) |

---

## 4. Wave-specific evidence / أدلة الموجة (file:line)

| # | Demand | Result | Evidence (stamped state) |
|---:|---|---|---|
| 1 | **No app Logo in THINK / live positions** | PASS | `src/components/StreamTimeline.tsx`: 0 `<Logo`, 0 `ThinkBrand`, 0 `brand: true`; THINK = `ThinkOrbit()` at **:293**, `sc18-think-orbit` **:302**, `animateTransform to="360 6 6"` **:320–324**, motion gated by `thinkMotionAllowed()` **:263**. `MessageView.tsx`: 0 `<Logo`. `ChatPanel.tsx`: only the empty-state `<Logo size={40} />` at **:1936** (allowed). SSR logo signature = **false** in THINK band, thinking row, settled row and running ChatPanel. |
| 2 | **No ChatLiveIndicator duplicate circle** | PASS | `ChatPanel.tsx`: 0 `ChatLiveIndicator`, 0 `chat-live-ring/dot/label/clock/tok`, 0 `className="chat-live"` (comment-free). SSR running panel: `chat-live-ring` = 0, `chat-live-dot` = 0, chip = absent. |
| 3 | **One primary circle** | PASS | `ChatPanel.tsx`: 1 `function LiveThinkingPanel` **:677**, 1 mount **:1918**, 1 `cp-live-glyph` **:764**; across **all** `src/**/*.tsx` = 1 mount. SSR running: exactly 1 `cp-live-glyph`, and it is the enlarged 80px glyph. No second panel in `MessageView.tsx`. |
| 4 | **One context orb beside the mic** | PASS | `Composer.tsx`: `<VoiceInput` **:1942**, `<ContextLens compact />` **:1977** (orb after mic), exactly 1 `<ContextLens`. SSR: exactly 1 `ctx-orb--compact`. No duplicate in `ChatPanel.tsx` / `StatusBar.tsx`; no `<ContextRing>` anywhere. |
| 5 | **No ctx-meter** | PASS | 0 `ctx-meter/ctx-track/ctx-fill` in `Composer.tsx`, `ChatPanel.tsx`, `StatusBar.tsx`; `ctx_meter_screens = []` across all 60 rendered snapshots. |
| — | Per-row orbit still present | PASS | `MessageView.tsx`: 1 `CompactThinkingOrbit` mount **:3714**, `sc-think-orbit-svg` **:600**, 32-grid precision orbit + 24-grid row orbit in SSR. |

**Honest note / ملاحظة صادقة:** the one surviving `<Logo size={40} />` in `ChatPanel.tsx:1936`
is the **empty-chat brand mark**, not a live/reasoning position — deliberately allowed by
this guard. `ContextLens` early-returns `null` when there is no token data, so in a brand-new
session the compact orb is intentionally hidden; the harness seeded `lastTurnUsage` to
prove it mounts.

---

## 5. Engine-level smoke / فحص المحرك

Real `kdx:agent:run` IPC handler, esbuild-bundled from `electron/agent/register.ts`,
driven through `normalizeRunParams` (**`register.ts:231`**) with a local mock
OpenAI-compatible provider (zero network). Security gate preserved: `gated()` forwards
the event at **`register.ts:328`** — `(e, ...args)`.

| Shape | Input | Expected | Result |
|---|---|---|---|
| normal | full params, model object | run starts, provider called, `turn_end` | PASS — 1 provider request, 9–10 events (run variance) |
| model as string | `model: "custom/m-string"` | normalized, run starts | PASS — 1 request with `m-string`, 8 events |
| missing messages | no `messages`, `text` present | honest synthesized user row reaches engine | PASS — 1 request, 7 events |
| empty messages | `messages: []`, no text | precise refusal, **no run** | PASS — code `NO_USER_MESSAGE` (`register.ts:292`), 3 events |
| raw `undefined` | `undefined` | precise refusal, no crash | PASS — code `NO_PARAMS` (`register.ts:238`) |
| raw non-object | `42` | precise type refusal, no crash | PASS — code `BAD_SHAPE` (`register.ts:245`) |

Across all shapes: **zero** events matching `/invalid run parameters|missing messages or model/i`,
**zero** "Run crashed before its report", **zero** thrown handler errors.

**Still not perfect / ليس كاملاً:** the user-facing refusal sentence still merges
"no messages" and "no model" into one line; only the machine `code` distinguishes them.
Actionable, but not surgically specific. Flagged, not claimed as ideal.

---

## 6. Failures / الفشل

**Both stamped runs: NONE.** 0 test failures, 0 crashes, 0 dead controls, 0 unstable
selectors, 0 vague engine errors. `crashes.log` is empty in both runs.

**Prior observation (honest):** during concurrent editing, a baseline run of the proven
v11.22 harness failed `ENGINE SHAPE 1/4 (normal)` — no terminal `turn_end`/provider call.
The filtered log did not retain the exact assertion text. It did **not** recur in either
stamped v11.23 run. Cause is attributed to the moving source tree, not proven.

---

## 7. Screen inventory (60) / جدول الشاشات

`RENDERS OK` = esbuild bundle + `renderToStaticMarkup` succeeded, no console.error `#300`,
no static unstable selector. All 60 = `RENDERS OK`.

- **core (11):** ChatPanel, Home, Onboarding, AuthScreen, Welcome, WhatsNew, CommandPalette, SettingsModal, DiffView, DiffModal, EditorArea
- **rail (17):** WorkspacePanel, SessionsPanel, GitPanel, MCPPanel, UsagePanel, DnaPanel, FlowsPanel, SkillsPanel, ArtifactsPanel, LibraryPanel, WikiPanel(via Library initialTab), PromptsPanel, SearchPanel, SubagentsPanel, WikiPanel(component), SchedulePanel, SecurityPanel
- **settings (26):** General, Appearance, Notifications, Voice, Agent, Privacy, SkillsMemory, Models, Models(providersOnly), Mcp, Plugins, ApiServer, Remote, Preview, Editor, Terminal, GitWorktree, Billing, Shortcuts, Evidence, Logs, Updates, Feedback, Advanced, Approvals, AccountAuthCard
- **wave (6):** StreamBandShell(think·live), ChatPanel(running·circles), MessageView(thinking·circles), MessageView(settled), Composer, ProofRibbon

---

## 8. Honest limitations / حدود الفحص

1. SSR is server rendering: effects, animation frames, timers and real pointer interaction are **not** exercised. Dead-handler detection is a conservative static scan (642 controls), not a browser click-through.
2. The spinning circle is checked as rendered markup (`type="rotate"`, `to="360 "`, `sc18-think-orbit`) and as comment-free source geometry; animation smoothness in a real browser is not measured here.
3. The engine smoke uses a local mock provider — it proves param repair, run start and terminal reporting, not provider-specific streaming quality.
4. The source was a moving target (see §6). Two consecutive green runs raise confidence but do not guarantee future state — re-run the single command after the last save.

---

## 9. Bottom line / الخلاصة

**EN:** GREEN on every gate this guard owns: 60/60 screens, 80/80 tests, 0 crashes, 0 React #300, 0 dead controls over 642, 6/6 run-param shapes, no vague error. This time the three founder complaints were re-verified in source **and** SSR: no logo in THINK/live positions, no duplicate working ring, one primary circle, one context orb beside the mic, no ctx-meter. Re-run after the last agent saves.

**AR:** أخضر على كل بوابة يملكها هذا الفحص: 60/60 شاشة، 80/80 اختبار، صفر انهيار، صفر React #300، صفر عناصر ميتة من 642، 6/6 أشكال تشغيل، بلا خطأ غامض. هذه المرة أُعيد التحقق من شكاوى المؤسس الثلاث في المصدر **و** في SSR: لا شعار في مواضع THINK/التشغيل، لا حلقةworking مكررة، دائرة أولية واحدة، كرة حالة واحدة بجانب المايك، ولا شريط ctx-meter. أعد التشغيل بعد حفظ آخر وكيل.
