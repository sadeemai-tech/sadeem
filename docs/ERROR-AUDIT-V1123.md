# ERROR MESSAGE AUDIT — v11.23
# تدقيق رسائل الأخطاء — v11.23

**Mode / النمط:** diagnosis + test **only**. No production source was edited by this subagent.
الوضع: تشخيص + اختبار **فقط**. لم يعدّل هذا الوكيل أي ملف إنتاجي.

**Artifacts / المخرجات:** `tests/v1123-error-audit.test.mjs` (12/12 passing) + this report.
**Scope / النطاق:** `electron/agent/{engine,providers,tools,register,mcp,subagents}.ts`, `src/store.ts`,
`src/components/**/*.tsx`, `src/i18n.ts`, `shared/types.ts` (+ `src/main.tsx` for the boot boundary).

> ⚠️ **Snapshot warning / تحذير اللقطة:** other agents were patching the same tree while this
> audit ran (v11.22 run-param repair + v11.23 error-row/localization work). Line numbers below
> are from the last read during this run; **string anchors are the stable reference**. Re-run the
> test — it resolves every anchor dynamically with `t.diagnostic()` and fails if one vanishes.

---

## 0. Brutal verdict / الخلاصة بصراحة

1. **The errors are not "random".** They are ~20 distinct English strings, emitted from a handful
   of paths, shown on **two or three surfaces at once**, with no language switch and often no next
   step. That combination *feels* random to the user ("كل شوي بيطلع لي غلط").
   الأخطاء ليست عشوائية: هي نحو 20 رسالة إنجليزية مكررة على عدة أسطح بلا ترجمة وغالباً بلا خطوة تالية.
2. **Good news:** the founder's exact leak `Invalid run parameters (missing messages or model)` is
   **gone from code** (only the classifier at `src/store.ts:197` and history comments still mention
   it). 402 credits now gets **one** translated toast, never a raw JSON transcript row
   (`src/store.ts:4317-4320`). `sanitizeErrorText()` (`providers.ts:532`) keeps gateway JSON out of
   4xx/5xx messages. `friendlyError`, however, **bypasses** that sanitizer — see P0-1.
3. **The renderer now has a real localization layer** (`runErrorKey` `store.ts:193`,
   `localizeRunError` `store.ts:235`, wired at `:4317`, `:3609`, `:1959`) that rewrites recognized
   engine English into canonical `err.*` keys before render. **It is pattern-based (7 branches)**:
   anything unrecognized is rewritten to ONE generic `err.run.providerUnavailable` key in AR — so
   the user no longer sees English, **but the actual reason and its next step are destroyed**. That
   is a silent honesty regression, not a fix.
4. **Remainder bypasses the localizer entirely:** preview toasts, tool-result JSON, MCP tool
   failures, subagent notices, error boundaries. These still render raw English / raw `err.message`
   / raw `{"ok":false,...}` in an Arabic UI.
5. **No mixed EN+AR literal was found in an emission site** (test #2 passes) — the bilingual
   branches (`engine.ts:2016-2017`) select one language, they don't blend. This is the one place the
   codebase is already clean.
6. **This subagent fixed nothing in source.** §6 ranks the work; owners are named there.

---

## 1. Surface map / خريطة الأسطح

| Surface | Produced at | Rendered at | Notes |
|---|---|---|---|
| **toast** | `store.ts:5285` `notify()` → `Toasts.tsx:144-165` bridge | `Toasts.tsx:91-141` | `severityFor()` (`:80`) guesses severity from English keywords; a raw EN "Open a workspace first" is **misclassified as info**, not error |
| **transcript row** | `store.ts` `case 'error'` (`:4297+`) | `MessageView.tsx:3668-3674` (`error-card`) | the v11.23 path now replaces the raw `model:'error'` row with ONE report card (`:4325-4339`) |
| **task_report** | `engine.ts:1789-1854` `emitTaskReport`; `register.ts:532-540`, `:556-564` | `store.ts:3832+` → `MessageView.tsx:2901+` `TaskReportCard` | `note` becomes `summary` (`engine.ts:1826-1832`) — this is where the EN-only duplicates land |
| **chip** | `MessageView.tsx:3356+` tool card, gate verdict, `JsonMetaChip` | same | raw tool JSON is collapsed to a chip, not dumped — good safety net |
| **popover / card** | `store.ts:4916-4956` preview state | `PreviewArea.tsx:1044-1073` | i18n reason text is correct; **raw `shownError.detail` is printed verbatim** at `:1060-1063` |
| **boundary** | `SurfaceErrorBoundary.tsx:26-36`, `main.tsx:59-64` | same files | localized headline + **raw `error.message`** under it |

---

## 2. Full inventory / الجرد الكامل

Legend: 🌐 raw English in AR · 🧾 raw JSON/payload leak · 🔁 duplicated surface · 🎯 vague / no next step · 👤 blames user · 🕸 stale/brand.

### 2.1 `electron/agent/engine.ts`

| # | Message (literal) | line | Surface | Flags |
|---|---|---|---|---|
| E1 | `No model configured. Check Settings → AI providers.` | 1535 (`sendError`) + 1541 (`task_report.summary`) | report card ×2 | 🌐🔁 (renderer maps `/no model/` → `err.setup.noModel`, so mitigated downstream) |
| E2 | `No API key for "{provider}". Open Settings → AI providers, paste your {provider} key, then retry.` | 2016 (EN branch, AR branch on 2017) | error row | bilingual branch ✅ |
| E3 | `No API key for provider "{provider}".` | **2019** (`task_report.note`) | report card | 🌐🔁 — **same failure, EN-only second surface** |
| E4 | `Run failed: {friendlyError(...)}` | 4095 (`error`) + **4096** (`note`) + 5044 `[stream interrupted — …]` | report card + sys notice | 🌐🔁🧾 |
| E5 | `Run aborted.` | 4038, 4061, 4063-ish | report card | 🌐🎯 no next step |
| E6 | `Run failed unexpectedly — no detailed summary was produced.` | ~4063 (finally fallthrough) | report card | 🌐🎯 vague |
| E7 | `Network error — check connection/proxy. (provider: X)` | 6072 (`friendlyError`) | error/report | 🌐 |
| E8 | `The provider safety filter blocked this response (content_filter). Rephrase the request or try another model.` | 6076 | error/report | 🌐 (has next step) |
| E9 | `Invalid API key (401/403). Check Settings → AI providers.` | 6078 | error/report | 🌐 |
| E10 | `Rate limited (429) — retry shortly.` | **6079** | error/report | 🌐🎯 — **conflicts with providers.ts:604** ("trying the next configured model") = two strings, one failure |
| E11 | `Model not found (404): {model}. Check the model name in Settings.` | 6080 | error/report | 🌐 |
| E12 | `Bad request (400): {msg}` | **6099** | error/report | 🌐🧾 **raw provider body forwarded** |
| E13 | `return msg` (fall-through) | **6101** | error/report | 🌐🧾 **unknown raw provider text forwarded** |
| E14 | `Nothing was changed on disk in this run.` / `Work stopped mid-task — N file(s) changed…` | 1830-1832 | report card | 🌐 informational |

### 2.2 `electron/agent/providers.ts`

| # | Message | line | Surface | Flags |
|---|---|---|---|---|
| P1 | `Invalid API key (401). Check Settings → AI providers.` | 576 | → friendlyError → report | 🌐 (next step ✅) |
| P2 | `Insufficient credits (402): this provider account has no balance. Add credits … or switch … in Settings → Providers.` | 586 | **toast only** via `noCreditsToast` | 🌐 but single-surface ✅ |
| P3 | `Access forbidden (403): ${sanitizeErrorText(text) …}` | 594 | report | 🌐 ✅ JSON-sanitized |
| P4 | `Rate limited (429) — trying the next configured model.` | 604 | report/notice | 🌐 + **contradicts E10** |
| P5 | `Model not found (404): ${sanitizeErrorText(…)}` | 612 | report | 🌐 ✅ sanitized |
| P6 | `Provider error ${status}: ${sanitizeErrorText(…)}` | 621 | report | 🌐 ✅ sanitized |
| P7 | `Provider retry budget (${budget}ms) exhausted — moving to the next provider.` | 776, 782 | notice + report | 🌐🔁 same text twice |
| P8 | `Network error.` | 560 (`networkErrorMessage` fallback) | report | 🌐🎯 vague |
| P9 | `Unknown provider error` | 621 fallback | report | 🌐🎯 vague |

**Positive:** `sanitizeErrorText()` (532-548) strips JSON to one reason field, clamps to printable
ASCII, 160 chars. The v11.23 comments are accurate — 403/404/5xx no longer leak gateway JSON.
`friendlyError()` must be brought under the same helper (P0-1).

### 2.3 `electron/agent/tools.ts`

| # | Message | line (approx, tree shifting) | Surface | Flags |
|---|---|---|---|---|
| T1 | `output: JSON.stringify({ ok:false, error: 'Missing required parameter: path' })` | 1967 | tool-result drawer / chip | 🧾🌐 raw JSON string |
| T2 | `Path escapes the workspace: ${asGiven}` / `Cannot read ${abs}: ${msgOf(err)}` / `Not a file: ${abs}` | 1983, 2004, 2007, 2022 | tool result | 🧾🌐 internal paths + raw error |
| T3 | `browser_navigate failed: ${msgOf(err)}` (+ snapshot/click/type/eval/tabs/console variants) | 1035-1126, 1381-1391 | tool result | 🌐🧾 raw error appended |
| T4 | `arguments must be a JSON object`, `Unsupported image type "…"`, `Image too large (…)` | 969, 1860, 1879 | tool result | 🌐 valid but untranslated |
| T5 | `ZIP_SLIP_DETECTED: …` | ~5000 | tool result | 🌐 code-like, acceptable as diagnostic |

The `JsonMetaChip` safety net (`MessageView.tsx:3640-3642`) prevents a **meta** JSON row from dumping
raw text, but a genuine tool failure is a **tool result**, not a meta row — it renders its `output`
in the drawer. That is the "random raw text" seen after a failed tool call.

### 2.4 `electron/agent/register.ts`

| # | Message | line | Surface | Flags |
|---|---|---|---|---|
| R1 | `Run not started: no run parameters were supplied.` / `…must be an object (received X).` / `…no AI model is configured.` / `…no user message to send.` | 239, 246, 257, 293 | error row + report summary (`:529`, `:535`) | 🌐🔁 but precise + `nextStep` ✅; localized via `RUN_ERROR_TEXT` |
| R2 | `Your plan does not allow this run. Check Plans & Billing.` | **554** | error row | 🌐👤 blames the user's plan; never localized |
| R3 | `Run not started — plan gate: ${runGate.reason ?? 'plan limit reached'}.` | 559 | report card | 🌐🔁 duplicate of R2 |
| R4 | `err instanceof Error ? err.message : String(err)` | 652, 682 | error row + report note | 🧾🌐 raw thrown payload |
| R5 | `Workspace is not open in Surnia.` | 809 | toast/IPC result | 🌐🕸 stale brand ("Surnia") |
| R6 | `nextStep: 'Send your message again from the chat composer.'` | 240, 247, 258, 294 | report nextSteps | 🌐 English-only, but actionable ✅ |

### 2.5 `electron/agent/mcp.ts`

| # | Message | line | Surface | Flags |
|---|---|---|---|---|
| C1 | `MCP tool "${toolName}" reported an error (${describe(server)}).` | 1949 | tool result | 🌐 untranslated |
| C2 | `MCP tool "${toolName}" returned no result (…). The server may have dropped it; retry the call.` | 1953 | tool result | 🌐 (next step ✅) |
| C3 | `MCP tool "${toolName}" is blocked by the allow/deny tool list of "…"` | 1911 | tool result | 🌐 |
| C4 | `Unknown MCP server: ${sid}` / `Server is disabled.` | 2680, 2681 | toast/panel | 🌐🎯 vague, no next step |
| C5 | `You previously chose "Deny" for "${toolName}" on "${server.name}". Re-allow it in the MCP panel …` | ~2129 | notice | 🌐 (actionable ✅) |
| C6 | `Method "${method}" not supported by the Surnia MCP client.` | 534 | JSON-RPC error | 🌐🕸 stale brand |

### 2.6 `electron/agent/subagents.ts`

| # | Message | line | Surface | Flags |
|---|---|---|---|---|
| S1 | `[subagent ${label}] FAILED — ${reason}. ${RETRY_HINT}` | **301** | notice / transcript chip | 🌐 English-only, kind:'error' |
| S2 | `RETRY_HINT = 'Retry: open the Subagents panel → "Retry failed" … re-delegate …'` | 31-32 | appended to every failure | 🌐 actionable but unlocalized |
| S3 | `subagent was aborted` | 298, 324 | notice + ledger | 🌐🎯 no next step |

### 2.7 `src/store.ts`

| # | Message | line | Surface | Flags |
|---|---|---|---|---|
| ST1 | `s.notify(String(err))` | **2573** | toast | 🧾🌐 raw thrown error |
| ST2 | `get().notify('Open a workspace first')` | **4916, 4937** | toast | 🌐 raw EN in AR (canonical key `misc.notify.noWorkspace` exists!) |
| ST3 | `get().notify(res.error ?? 'Preview failed')` / `…err.message…` | 4926, 4930 | toast | 🧾🌐 raw payload + vague fallback |
| ST4 | `get().notify(res.error ?? 'Dev server failed to start')` / `get().notify(detail)` | **4951, 4956** | toast | 🧾🌐 raw payload |
| ST5 | `previewError.detail = e.error \|\| lines.slice(-3)` | 2010-2012 → `PreviewArea.tsx:1060` | popover | 🧾🌐 raw server output |
| ST6 | `get().notify(res.error ?? (ar ? 'تعذّر التشعيب' : 'Fork failed'))` | 3030 | toast | 🧾 raw payload in EN branch |
| ST7 | `runErrorKey` / `localizeRunError` / `noCreditsToast` | 193 / **235** / 174 | all ingest paths | ✅ the good layer — but see verdict §0.3 |
| ST8 | canonical 402 → one toast (`if (key === 'err.setup.noCredits' …)`) | 4320 | toast | ✅ single owner |

### 2.8 Components / i18n / shared

| # | Message | line | Surface | Flags |
|---|---|---|---|---|
| U1 | localized headline + `{this.state.error.message}` | `SurfaceErrorBoundary.tsx:62-65` | inline boundary | 🌐🧾 raw stack text under AR headline |
| U2 | localized headline + `{this.state.error.message}` | `main.tsx:59-64` | full-screen boundary | 🌐🧾 same |
| U3 | `t('chat.report.error', 'Run failed — summary below')` | `MessageView.tsx:2935` | report card header | 🔁 repeats E4; generic headLine ✅ |
| U4 | `severityFor()` keyword regex | `Toasts.tsx:80` | toast | 🎯 raw EN errors without matchwords render as **info**, not error |
| U5 | `t('misc.error', 'Something went wrong')` ×6 | `panels/FlowsPanel.tsx:313,345,347,359,361,377,404` | toast | 🎯 vague fallback — **dead code**: `misc.error` = `['Error','خطأ']` (`i18n.ts:415`) |
| U6 | `RUN_ERROR_TEXT` EN/AR + `nextEn`/`nextAr` | `shared/types.ts:674-685` | main-process errors | ✅ canonical, monolingual |
| U7 | `err.setup.*` / `err.run.*` keys | `i18n.ts` (8 keys) | all | ✅ resolve in both languages (test #4) |

---

## 3. Flag roll-up / ملخص التحذيرات

| Flag | Where (representative anchors) |
|---|---|
| 🌐 Raw English in Arabic UI | `engine.ts:1535,2019,4038,4063`; `register.ts:554,559,652,682,809`; `mcp.ts:1949,1953,2680`; `subagents.ts:301`; `store.ts:4916,4937`; `SurfaceErrorBoundary.tsx:65` |
| 🧾 Raw JSON / payload leak | `engine.ts:6099,6101`; `tools.ts:1967+`; `store.ts:2573,4926,4930,4956`; `register.ts:652,682`; `PreviewArea.tsx:1060`; boundaries |
| 🔀 Mixed EN+AR in one literal | **NONE** in emission sites — clean (test #2). Bilingual pairs select one language. |
| 🎯 Vague / no next step | `engine.ts:4038,4063,6079`; `providers.ts:560,621`; `mcp.ts:2681`; `subagents.ts:298,324`; `store.ts:4926`; `FlowsPanel.tsx` fallbacks |
| 👤 Blames user | `register.ts:554` ("Your plan does not allow…"); stale `Invalid run parameters` is **gone** ✅ |
| 🔁 One failure → many surfaces | `register.ts:529+535`; `engine.ts:1535+1541`, `2016+2019`, `4095+4096`; `providers.ts:776+782` |
| 🕸 Stale strings | `Invalid run parameters` gone from code ✅; **"Surnia" brand** at `mcp.ts:534`, `register.ts:809` |

---

## 4. Ownership matrix / مصفوفة الملكية — one owner per failure

| Failure | Surfaces TODAY | Desired single owner |
|---|---|---|
| bad run params | error row (`register.ts:529`) + report summary (`:535`) | **report card** (structured code + nextSteps); drop the mirrored error row |
| no model | error row + summary (`engine.ts:1535,1541`) | **report card**, localized via `err.setup.noModel` |
| no API key | EN/AR row + **EN-only report note** (`engine.ts:2016,2019`) | **one localized report card**, provider name as a param |
| plan gate | error row + report summary (`register.ts:554,559`) | **toast** (user action required), report card carries structured reason only |
| generic run crash | error row + report note + sys notice (`engine.ts:4095,4096,5044`) | **report card** (with sanitized reason + next step); notice only for live progress |
| 402 credits | **one toast** (`store.ts:4320`) | ✅ already correct — keep it |
| preview failure | toast (`store.ts:4916/4951/4956`) + popover detail (`PreviewArea.tsx:1060`) | **popover only**, localized reason; raw log lines stay in the collapsible log drawer |

---

## 5. Ranked fix list / القائمة مرتبةً بالأولوية

### P0 — fix before the next release / قبل الإصدار القادم

- **P0-1 — JSON/raw provider text leak.** `electron/agent/engine.ts:6099` (`Bad request (400): ${msg}`)
  and `:6101` (`return msg`) forward raw provider bodies; `friendlyError()` never calls
  `sanitizeErrorText()` (`providers.ts:532`). This is the same class as the founder's
  "402 Insufficient credits {json}" screenshots. Route **all** fall-through text through
  `sanitizeErrorText()` and then the renderer's `localizeRunError()`.
- **P0-2 — Arabic UI shows an English second line.** `electron/agent/engine.ts:2019`
  (`No API key for provider "…".` in `task_report.note`) is EN-only while `:2016-2017` is bilingual.
  Same pattern at `:1541` (`No model configured…` in the report). Make the report carry a
  `code`/`key` and let the renderer localize; never hardcode note text in EN.
- **P0-3 — Preview errors are raw English + raw payload.** `src/store.ts:4916,4937`
  (`'Open a workspace first'`), `:4926,4930,4951,4956` (`res.error ?? …`, `detail`) and
  `PreviewArea.tsx:1060-1063` (raw `shownError.detail`). This is the most likely source of the
  "random error" the founder sees while clicking around the preview. Use existing
  `preview.err.*` / `misc.notify.noWorkspace` keys; put raw server output only in the log drawer.

### P1 — fix this sprint / هذا السبرنت

1. `register.ts:554,559` — plan-gate refusal: raw EN + blames user + duplicated. Use a canonical
   `err.billing.planGate` key and one translated toast.
2. `register.ts:529,535` + `engine.ts:1535,1541,4095,4096` — duplicated error row + report card;
   pick one owner per §4.
3. `engine.ts:6079` vs `providers.ts:604` — two contradictory 429 strings; consolidate to one key.
4. `store.ts:2573` — `s.notify(String(err))`; `store.ts:3030,4926,4930` — raw `res.error` toasts.
5. `tools.ts:1967+` (8 `JSON.stringify({ok:false,…})` sites) and `mcp.ts:1949,1953` — tool-result
   rows show raw JSON/EN; route through a localized tool-error chip.
6. `subagents.ts:301,31-32` — `[subagent …] FAILED — …` + `RETRY_HINT` are English-only; use i18n
   keys with `{label}` / `{reason}` params.
7. `providers.ts:560,621` — `Network error.` / `Unknown provider error` are vague; at minimum name
   the next step (Settings → Providers).
8. `store.ts:235-245` (`runErrorKey`) — only 7 patterns; unknown reasons collapse into one generic
   key. Log the classified reason (redacted) and surface a short "see log" next step so the user
   can act instead of guessing.
9. `Toasts.tsx:80` — severity regex is English-centric; an Arabic error toast without a matching
   keyword renders as **info**. Drive severity from an explicit field, not text sniffing.

### P2 — hygiene / تحسينات

- `SurfaceErrorBoundary.tsx:65` and `main.tsx:64` — localized headline but raw `error.message`
  printed; show a generic localized line, keep the detail in the log (`log(3, …)` already exists).
- `FlowsPanel.tsx:313,345,347,359,361,377,404` — `'Something went wrong'` fallbacks are dead
  code behind `misc.error`; delete the vague literal so it can't resurface on a missing-key build.
- `engine.ts:4038,4063`, `subagents.ts:298,324`, `mcp.ts:2681` — `Run aborted.`,
  `Run failed unexpectedly…`, `subagent was aborted`, `Server isDisabled.` have no next step.
- `mcp.ts:534`, `register.ts:809` — stale **"Surnia"** brand in user-facing text; use SADEEM/سديم.
- `i18n.ts:415` `misc.error` is a good short localized word — keep; stop re-inventing fallbacks.

---

## 6. Test evidence / دليل الاختبار

```
node --test --test-force-exit tests/v1123-error-audit.test.mjs
# tests 12 · pass 12 · fail 0
```

| # | Test | What it proves |
|---|---|---|
| 1 | stale string gone from code | `Invalid run parameters` only survives as a classifier (`store.ts:197`) / comments |
| 2 | no mixed-language emission literal | AR + ≥3 Latin prose words in one emitted string → none |
| 3 | no raw JSON literal in emission | no `{"key":…}` literal assigned to message/summary/note/toast |
| 4 | canonical keys monolingual | 8 `err.*` keys resolve EN/AR via the **real** `makeT()` |
| 5 | 402 single surface | one toast, no raw `e.message` row (accepts both shipped shapes) |
| 6 | defect inventory | all 14 open defects reported with live file:line; count pinned |
| 7 | renderer localizer | `runErrorKey` has 7 patterns (diagnostic: unknown → generic key) |
| 8 | SSR raw EN in AR | real `MessageView` error card renders the raw engine string verbatim |
| 9 | SSR localized AR | canonical AR error renders monolingual |
| 10 | SSR report chip | task-report meta JSON never dumped as raw attributes |
| 11 | SSR boundary | localized headline + raw `error.message` leak (P2 repro) |

The test **reports, does not fix**: it prints the ranked inventory with `t.diagnostic()` and pins the
anchor count, so a future fix that removes a finding forces this audit doc to be updated rather than
silently going stale.

---

## 7. Ownership handoff / تسليم المسؤولية

- **A7 (main process / engine bridge):** P0-1, P0-2, P1-1/2/3/7 — `engine.ts`, `providers.ts`,
  `register.ts`, `mcp.ts`, `subagents.ts`, `tools.ts`, `shared/types.ts`.
- **A6 (renderer / UI):** P0-3, P1-4/8/9, all P2 — `store.ts`, `components/*`, `i18n.ts`.
- **Not touched by this subagent:** every source file. Only `tests/v1123-error-audit.test.mjs`
  and `docs/ERROR-AUDIT-V1123.md` were created.
