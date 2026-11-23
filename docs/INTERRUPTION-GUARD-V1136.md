# V1136 — Interruption Guard: "AI stops after the verification screenshot, no final summary"

**Date:** 2026-11-21 · **Scope:** DIAGNOSIS + TEST + DOC only (no app source edited by the guard)
**Harness:** `tests/v1136-interruption-guard.test.mjs`
**Engine under test:** `electron/agent/engine.ts` (esbuild-bundled, electron stubbed, isolated `userData`, local scripted OpenAI-compatible provider on `127.0.0.1` — zero external network, zero real model).

---

## 1. BLUNT VERDICT / الحكم الصريح

**EN —** **NO, the bug does not reproduce in the current tree.** The real-engine harness issued 38/38 PASS. After a `preview_screenshot` (+ a genuine ~263 KB image result), after `ui_quality_check`, after a tool call with no final text, and after an empty/bare-marker end-of-turn, the loop **always issued another model request** and **always delivered a final answer with a 2–4 bullet summary and real file paths**. A real time cap emitted a visible `sys_notice` with a reason. Source scan found **no** screenshot/quality/image tool on any `break`/`return` inside the main loop. The v11.36 D5 fix (`EMPTY_FINAL_NUDGE` + `silentStopFallback`) is present and verified — this was the literal root cause of the founder's report.

**AR —** **لا، المشكلة لا تظهر في الشجرة الحالية.** اختبار المحرك الحقيقي نجح 38/38. بعد `preview_screenshot` (مع نتيجة صورة حقيقية بحجم ~263 كيلوبايت)، وبعد `ui_quality_check`، وبعد استدعاء أداة بدون نص نهائي، وبعد نهايةturn فارغة/بعلامة فقط، الحلقة **دائماً أرسلت طلباً جديداً للنموذج** و**دائماً سلّمت إجابة نهائية تحتوي على 2–4 نقاط ومسارات ملفات حقيقية**. حدّ الوقت الحقيقي أصدر `sys_notice` مرئياً مع سبب. فحص المصدر لم يجد أي أداة صورة/جودة على أي `break`/`return` داخل الحلقة الرئيسية. إصلاح D5 في v11.36 (`EMPTY_FINAL_NUDGE` + `silentStopFallback`) موجود ومُتحقّق منه — وهذا هو السبب الجذري لشكوى المؤسس.

> **Nuance / تحفّظ:** when the model stays broken and emits *only* a bare `GOAL_COMPLETE` marker on every turn, the honest fallback is written into `finalText` and surfaced through `task_report.summary` + a visible `sys_notice` — **not** as a streamed `text_delta`. The run is never blank and is never falsely "completed", but a UI that renders *only* the chat text bubble (and ignores the report/notice) could still look quiet. This is documented honestly below, not hidden. / عندما يبقى النموذج معطلاً ويُصدر علامة `GOAL_COMPLETE` فقط في كل دورة، يُكتب النص الصادق في `finalText` ويظهر عبر `task_report.summary` + `sys_notice` مرئي — **ليس** كـ `text_delta` متدفق. التشغيل ليس فارغاً أبداً ولا يُعلن "اكتمل" زوراً، لكن واجهة تعرض فقاعة المحادثة فقط قد تبدو صامتة. موثّق بصدق أدناه.

---

## 2. THE FOUNDER'S REPORT / شكوى المؤسس

> «الذكاء يوقف بعد ما يلتقط صورة التحقق أو لما يطلع نتيجة كبيرة، ويطلع كارِد بدل ما يكتب الملخص الأخير.»

*“The AI stops right after the verification screenshot / after a large result comes back, and just sits there instead of writing the final summary.”*

The guard models this exactly: the scripted provider calls `preview_screenshot` and `read_image` (a real 256×256 PNG → real `data:image/png;base64,…` result through the engine's own `toolResultImages` path at `engine.ts:6311`), then a scripted `end_turn`.

---

## 3. PER-CHECK RESULTS / نتائج الفحوصات

Run: `node --test --test-force-exit tests/v1136-interruption-guard.test.mjs` → **1 test, 0 fail, 38/38 checks PASS** (≈2.1 s).

| # | Check (what it models) | Result | Evidence / location |
|---|---|---|---|
| 1 | `preview_screenshot` + large image result → loop continues, final text emitted | **PASS** | 2 main requests; 291-char final answer; 262,777-char image result; 3 bullets — `engine.ts:6455` |
| 2 | `ui_quality_check` → run continues to a final answer | **PASS** | 2 main requests; 291-char answer, 3 bullets |
| 3 | tool_use + no final text, then a false-done claim → corrective nudge, never a silent stop | **PASS** | false-done notice ×1; 3 requests — `engine.ts:6648` |
| 3b | screenshot + **empty / bare-marker** end_turn → `EMPTY_FINAL_NUDGE` redirects to a real summary | **PASS** | nudge notice ×1; 3 requests; real summary — `engine.ts:6664` |
| 3c | model never writes text → honest visible fallback, never a blank "completed" run | **PASS** | fallback in `task_report.summary` + notice — `engine.ts:6671` |
| 4 | real terminal cap (`SURNIA_MAX_RUN_MS`) → visible `sys_notice` with a reason | **PASS** | `[time cap]` notice ×1 + final answer — `engine.ts:5086` |
| 5 | final answer always a real summary (2–4 bullets / file paths), no pre-end truncation | **PASS** | all 4 canonical runs: 3 bullets, file paths, last bullet present, `task_report` before `turn_end` |
| SRC | source scan: no stop-after-screenshot; caps emit visible reasons; root-cause fix present | **PASS** | see §4 |

 Arabic summary of the table / ملخص الجدول: **كل الفحوصات نجحت (38/38)** — استمرار الحلقة بعد الصورة، ردّ على الادعاء الكاذب بالإنجاز، ردّ على النهاية الفارغة، إشعار مرئي عند حدّ الوقت، وملخص نهائي بثلاث نقاط ومسارات ملفات.

---

## 4. SOURCE SCAN — loop termination, with file:line / فحص المصدر

Line numbers below are from the run on 2026-11-21. The guard resolves them **dynamically** at run time (`lineOf`) so concurrent edits do not break the diagnosis; re-run to refresh.

| Location | What it is | Verdict |
|---|---|---|
| `engine.ts:5068` | `for (; iter < o.maxIters; iter++)` — main model loop | loop is the single driver |
| `engine.ts:6455` | `finalText = ''; // text before tool calls is not the final answer` + `continue` | **KEY:** after any tool (including screenshot/quality/image) the loop **re-requests** — it does not stop |
| `engine.ts:6648` | `FALSE_DONE_NUDGE` prose-claim guard → `continue` | redirects, never ends |
| `engine.ts:6664` | `if (… stopReason === 'end_turn' … && !finalProse)` — `EMPTY_FINAL_NUDGE` guard | **D5 ROOT-CAUSE FIX:** empty/marker-only end is rejected |
| `engine.ts:6671` | `silentStopFallback('the run ended without a written final answer')` | honest visible text after the bounded nudge |
| `engine.ts:5086` / `5094` | `[time cap] … wrapping up now` / `grace period over` notices | visible reason, never silent |
| `engine.ts:5097` | `silentStopFallback('the wall-clock time cap was reached')` | no empty answer at a cap |
| `engine.ts:5895` | `silentStopFallback('the task budget was exhausted …')` | budget stop is visible |
| `engine.ts:5832` | `stopReason: 'error'` return | error path surfaces an `error` event + report |
| `engine.ts:6686` / `6690` | step-budget `silentStopFallback` + final return | maxed-out runs still carry text |
| `engine.ts:714` / `722` / `728` | `EMPTY_FINAL_NUDGE`, `EMPTY_FINAL_NUDGE_MAX = 2`, `silentStopFallback()` | the D5 fix, present and bounded |

**Scan conclusion / خلاصة الفحص:** no `preview_screenshot`, `ui_quality_check` or `read_image` token appears on any `break`/`return` inside the main loop (`engine.ts:5068–6695`). Every terminal path either writes a real `finalText`, a `silentStopFallback`, a visible `sys_notice`, and/or a `task_report` with a reason. There is **no code path that ends the loop right after a screenshot with no answer.**

---

## 5. ROOT CAUSE & FIX DIAGNOSIS / تشخيص السبب والإصلاح

**Cause / السبب:** every pre-D5 end-of-turn guard inspected the *content* of `visibleText` (refusal, unapplied code, bare DONE, false-done claim). A turn that ended with `finish_reason: 'stop'` and **no visible text** — common right after an image-only screenshot result — matched none of them and fell through to `finalText = visibleText` (`engine.ts:6677` pre-fix), producing a run that reported `completed` with `finalText === ''`. The chat looked like it "stopped after the screenshot."

**Fix / الإصلاح (v11.36 D5):**
1. `EMPTY_FINAL_NUDGE` (`engine.ts:714`) — a bounded (max 2, `engine.ts:722`) redirect injected when `end_turn` has no visible prose, telling the model to write the summary.
2. `silentStopFallback()` (`engine.ts:728`) — if the model stays broken, an honest bilingual `[system — interrupted] / [system — انقطاع]` text is written to `finalText` instead of an empty string.
3. The same fallback was back-ported to the time-cap, budget and step-budget exits (`engine.ts:5097`, `5895`, `6686`).

The guard proves all three work against the real engine, and also confirms the older false-done nudge (`engine.ts:6648`) still fires — so there are now **two independent defenses** against a silent stop.

---

## 6. KNOWN NUANCE (honest, not a PASS-hiding footnote) / ملاحظة صادقة

When the model emits *only* `GOAL_COMPLETE` markers forever, the honest fallback text is carried by `task_report.summary` and a `sys_notice`, **not** by a `text_delta` (verified in scenario 3c: chat deltas = `GOAL_COMPLETE` ×3, report summary = 404-char honest fallback). The run is honest and never blank, but a renderer that shows only the chat bubble — discarding the report card / notices — would still appear quiet. If that surface matters, route `silentStopFallback` text through a visible chat line in a follow-up change. This guard reports it as a **PASS with a documented nuance**, because the engine contract ("never a silent, falsely-completed end") is satisfied.

---

## 7. HOW TO RUN / طريقة التشغيل

```powershell
# from the repo root
node --test --test-force-exit tests/v1136-interruption-guard.test.mjs

# with the full event stream (diagnosis aid)
$env:V1136_DEBUG='1'; node --test --test-force-exit tests/v1136-interruption-guard.test.mjs
```

The harness is self-contained: it bundles `engine.ts` with esbuild, stubs `electron`, writes an isolated `userData/settings.json`, and serves the scripted model from a local `node:http` server. No API key, no network, no model.

**Re-run after D5 lands:** D5 edits were observed landing in `engine.ts` while this guard was written (the `EMPTY_FINAL_NUDGE` / `silentStopFallback` code). The guard already runs against that code and passes 38/38. After any further D5 commit, re-run the command above: a green run confirms the fix still holds; a red `PASS`→`FAIL` in §3 names the exact broken behavior with a file:line.
**إعادة التشغيل بعد نزول D5:** لوحظت تعديلات D5 أثناء كتابة هذا الحارس، والحارس يعمل بالفعل ضدها وينجح 38/38. بعد أي دمج إضافي لـ D5، أعد الأمر أعلاه: النجاح يعني أن الإصلاح ما زال قائماً، وأي فشل يحدّد السلوك المكسور مع مسار الملف ورقم السطر.
