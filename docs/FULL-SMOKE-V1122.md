# FULL APP SMOKE — v11.22 (الدائرة + خطأ "Invalid run parameters")

**تقرير الفحص الشامل — موجة 11.22**
Diagnosis + Test only. No application source was edited by this guard.

| | |
|---|---|
| Run command | `node --test --test-force-exit tests/v1122-full-smoke.test.mjs` |
| Harness | `tests/v1122-full-smoke.test.mjs` (based on the proven `v1121-full-smoke` pattern) |
| Last green run | 2026-11-20 08:43 +03:00 |
| Source state | `electron/agent/register.ts` gated-forward fix present; `RUN_ERROR_TEXT` defined in `shared/types.ts:674` |
| Result | **76 / 76 tests PASS — 0 fail** |

---

## 1. Verdict / الحكم

**EN — GREEN, with one caveat.** Every one of the 59 SSR screens rendered without a crash, without a React #300 unstable-selector warning, and with zero dead controls across 642 scanned controls. All six `kdx:agent:run` param shapes drove the real main-process handler with no vague error and no crash; valid shapes started a real (mock-provider) run, invalid shapes emitted precise machine codes. The root cause of the founder's bug was identified and is fixed in the current source: `gated()` dropped the Electron event, shifting every argument by one, so `raw` was **always `undefined`** — every run was rejected with "Invalid run parameters (missing messages or model)".

**AR — أخضر، مع تحفّط واحد.** كل الشاشات الـ59 اشتغلت بلا انهيار، بلا تحذير React #300، وبلا أي عنصر تحكّم ميت من أصل 642 تم فحصها. كل أشكال الاستدعاء الستة لـ`kdx:agent:run` مرّت عبر المعالج الحقيقي بلا خطأ غامض وبلا انهيار. السبب الجذري لخطأ المؤسس وُجد وأُصلح في المصدر الحالي: دالة `gated()` كانت تُسقط حدث Electron، فينزلق كل وسيط بموضع ويصبح `raw` دائماً `undefined` — فكان كل تشغيل يُرفض برسالة "Invalid run parameters".

**Caveat / التحفّط:** the source was a **moving target** while this guard ran (12 agents editing concurrently). A `RUN_ERROR_TEXT is not defined` regression was observed transiently in a sibling suite mid-edit, then disappeared. This verdict is valid for the source state stamped above only — re-run after the last agent saves.

---

## 2. Screen inventory / جدول الشاشات

`RENDERS OK` = esbuild bundle + `renderToStaticMarkup` succeeded, no console.error `#300`, no static unstable selector.

| # | Screen | Group | Status |
|---:|---|---|---|
| 1 | ChatPanel | core | RENDERS OK |
| 2 | Home | core | RENDERS OK |
| 3 | Onboarding | core | RENDERS OK |
| 4 | AuthScreen | core | RENDERS OK |
| 5 | Welcome | core | RENDERS OK |
| 6 | WhatsNew | core | RENDERS OK (SSR no-op: visibility set in useEffect) |
| 7 | CommandPalette | core | RENDERS OK |
| 8 | SettingsModal | core | RENDERS OK |
| 9 | DiffView | core | RENDERS OK |
| 10 | DiffModal | core | RENDERS OK |
| 11 | EditorArea | core | RENDERS OK |
| 12 | WorkspacePanel | rail | RENDERS OK |
| 13 | SessionsPanel | rail | RENDERS OK |
| 14 | GitPanel | rail | RENDERS OK |
| 15 | MCPPanel | rail | RENDERS OK |
| 16 | UsagePanel | rail | RENDERS OK |
| 17 | DnaPanel | rail | RENDERS OK |
| 18 | FlowsPanel | rail | RENDERS OK |
| 19 | SkillsPanel | rail | RENDERS OK (former React #300 crash site) |
| 20 | ArtifactsPanel | rail | RENDERS OK |
| 21 | LibraryPanel | rail | RENDERS OK |
| 22 | WikiPanel (via Library initialTab) | rail | RENDERS OK |
| 23 | PromptsPanel | rail | RENDERS OK |
| 24 | SearchPanel | rail | RENDERS OK |
| 25 | SubagentsPanel | rail | RENDERS OK |
| 26 | WikiPanel (component) | rail | RENDERS OK |
| 27 | SchedulePanel | rail | RENDERS OK |
| 28 | SecurityPanel | rail | RENDERS OK |
| 29 | GeneralSection | settings | RENDERS OK |
| 30 | AppearanceSection | settings | RENDERS OK |
| 31 | NotificationsSection | settings | RENDERS OK |
| 32 | VoiceSection | settings | RENDERS OK |
| 33 | AgentSection | settings | RENDERS OK |
| 34 | PrivacySection | settings | RENDERS OK |
| 35 | SkillsMemorySection | settings | RENDERS OK |
| 36 | ModelsSection | settings | RENDERS OK |
| 37 | ModelsSection (providersOnly) | settings | RENDERS OK |
| 38 | McpSection | settings | RENDERS OK |
| 39 | PluginsSection | settings | RENDERS OK |
| 40 | ApiServerSection | settings | RENDERS OK |
| 41 | RemoteSection | settings | RENDERS OK |
| 42 | PreviewSection | settings | RENDERS OK |
| 43 | EditorSection | settings | RENDERS OK |
| 44 | TerminalSection | settings | RENDERS OK |
| 45 | GitWorktreeSection | settings | RENDERS OK |
| 46 | BillingSection | settings | RENDERS OK |
| 47 | ShortcutsSection | settings | RENDERS OK |
| 48 | EvidenceSection | settings | RENDERS OK |
| 49 | LogsSection | settings | RENDERS OK |
| 50 | UpdatesSection | settings | RENDERS OK |
| 51 | FeedbackSection | settings | RENDERS OK |
| 52 | AdvancedSection | settings | RENDERS OK |
| 53 | ApprovalsSection | settings | RENDERS OK |
| 54 | AccountAuthCard | settings | RENDERS OK |
| 55 | ChatPanel (running · circles) | wave | RENDERS OK |
| 56 | MessageView (thinking · circles) | wave | RENDERS OK |
| 57 | MessageView (settled) | wave | RENDERS OK |
| 58 | Composer | wave | RENDERS OK |
| 59 | ProofRibbon | wave | RENDERS OK |

**Baseline = 54 (v1121) + 5 wave-specific = 59.** The task brief said "54"; the 54-screen proven inventory did not include `Composer`, `ProofRibbon` or `MessageView`, so this guard added them plus a running `ChatPanel` variant — more coverage, not less. Counts are exact.

---

## 3. Counts / الأرقام

| Metric | Value |
|---|---|
| Node `test` cases | 76 |
| Passed | 76 |
| Failed | 0 |
| Screens rendered | 59 |
| Screen crashes | 0 |
| UNTESTABLE screens | 0 |
| React #300 / unstable selectors | 0 screens (plus global sweep over all of `src/`: 0) |
| Controls scanned | 642 |
| Dead / unwired controls | 0 |
| Engine `kdx:agent:run` shapes | 6 / 6 pass |

---

## 4. Wave-specific evidence / أدلة الموجة

| Check | Result | Evidence |
|---|---|---|
| ChatPanel renders the enlarged circle | PASS | `cp-live-glyph` at `width="80"`, `viewBox="0 0 64 64"` — `src/components/ChatPanel.tsx` `LiveThinkingPanel` |
| MessageView thinking head renders new precision orbit | PASS | `sc-reason-orbit-svg` + `viewBox="0 0 32 32"` — `src/components/MessageView.tsx` `PrecisionThinkingOrbit` |
| MessageView assistant row renders compact orbit | PASS | `sc-think-orbit` + `viewBox="0 0 24 24"` — `CompactThinkingOrbit` |
| No `ThinkEngraving` / `<Logo` in reasoning positions | PASS | Source scan (comments stripped) of `MessageView.tsx` and the `LiveThinkingPanel` region of `ChatPanel.tsx` — zero hits |
| Composer mounts exactly one `ContextLens compact` | PASS | `src/components/Composer.tsx:1977` — 1 occurrence; SSR emitted 1 `ctx-orb--compact` |
| No `ctx-meter` strip | PASS | No `ctx-meter/ctx-track/ctx-fill` in any of the 59 rendered snapshots |

**Honest note / ملاحظة صادقة:** `ContextLens` now early-returns `null` when there is no token data (`src/components/ContextLens.tsx:117`, `if (!hasData) return null`). The guard seeded a real `lastTurnUsage` on the Composer screen to prove the mount. In a brand-new session with zero tokens the compact orb is intentionally hidden — this is current app behavior, not a test artifact.

---

## 5. Engine-level smoke / فحص المحرك

Real `kdx:agent:run` IPC handler, esbuild-bundled from `electron/agent/register.ts`, driven through `normalizeRunParams`, with a local mock OpenAI-compatible provider (zero network). Structural events captured from the real webContents bridge.

| Shape | Input | Expected | Result |
|---|---|---|---|
| normal | full `AgentRunParams`, model object | run starts, provider called with `m-normal`, `turn_end` | PASS — 1 provider request, 8 events |
| model as string | `model: "custom/m-string"` | normalized to `{provider:'custom',model:'m-string'}`, run starts | PASS — 1 provider request with `m-string` |
| missing messages | no `messages`, `text: "Repaired hello…"` | honest synthesized user row reaches engine | PASS — 1 provider request, user row present |
| empty messages | `messages: []`, no text/session | precise refusal, **no run**, no vague error | PASS — code `NO_USER_MESSAGE`, 0 provider requests |
| raw `undefined` | `undefined` | precise refusal, no crash | PASS — code `NO_PARAMS` |
| raw non-object | `42` | precise type refusal, no crash | PASS — code `BAD_SHAPE` |

Across all shapes: **zero** events matching `/invalid run parameters|missing messages or model/i`, **zero** "Run crashed before its report", **zero** thrown handler errors.

### Root cause / السبب الجذري

`electron/agent/register.ts` `gated()`:

```ts
// BEFORE (bug): dropped the Electron event → every handler arg shifted by one
return (fn as (...a: any[]) => unknown)(...args);
// AFTER (fix): forward the event so (_e, raw) receives raw correctly
return (fn as (...a: any[]) => unknown)(e, ...args);
```

With the old code the renderer's single payload became `_e`, leaving `raw === undefined` on **every** run — which is exactly why the app showed "Invalid run parameters" instead of running. The fix preserves the `isTrustedAgentSender(e)` security gate unchanged.

### Current user-facing refusal text

The vague string is gone from the live path. The canonical message ( bilingual pair chosen by settings language, precise `code` on the event ) is:

> Run not started — the request had no messages or no model selected. Open Settings → AI providers, choose a model, and send your message again.

This is actionable and no longer the old vague phrase, but it still collapses "no messages" and "no model" into one sentence for the user; the distinction lives in the machine `code`. Flagged here for honesty — not claimed as perfect specificity.

---

## 6. Honest limitations / حدود الفحص

1. SSR = server render. Effects, animation frames, timers and real pointer interaction are not exercised by `renderToStaticMarkup`. Dead-handler detection is a conservative static scan (642 controls), not a browser click-through.
2. The engine smoke uses a local mock provider. It proves param repair, run start and terminal reporting — not provider-specific streaming quality.
3. Concurrent agents were still editing during this run. A later save can invalidate this verdict; re-run the single command above as the final gate.
4. One transient `RUN_ERROR_TEXT is not defined` regression was observed in a sibling suite while `shared/types.ts` / `register.ts` were mid-edit; it is **not** present in the stamped source state or in this suite's green run.

---

## 7. Bottom line / الخلاصة

**EN:** This wave is GREEN on every gate this guard owns: 59/59 screens, 76/76 tests, 0 crashes, 0 React #300, 0 dead controls, 6/6 run-param shapes, no vague error. The founder's two complaints — the spinning circles and the bogus "Invalid run parameters" — are both addressed in the current source. Re-run once after the last agent saves.

**AR:** الموجة خضراء على كل بوابات هذا الفحص: 59/59 شاشة، 76/76 اختبار، صفر انهيار، صفر React #300، صفر عناصر ميتة، 6/6 أشكال تشغيل، بلا خطأ غامض. شكوا المؤسس — الدوائر الدوّارة وخطأ "Invalid run parameters" — تمت معالجتهما في المصدر الحالي. أعد التشغيل بعد حفظ آخر وكيل.
