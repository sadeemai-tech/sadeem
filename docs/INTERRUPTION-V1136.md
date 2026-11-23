# v11.36 — INTERRUPTION / SILENT STOP (Blunt Verdict)
# الحكم الصريح: الانقطاع بعد لقطة التحقق

---

## TL;DR (English)

**Why the interruptions happened:** the engine accepted an `end_turn` with
**no visible text** as a completed answer. After a verification screenshot the
provider can finish with `finish_reason:'stop'` while emitting only reasoning
(or only the image the engine just fed it) — `visibleText === ''`. Every
existing end_turn guard (bare DONE, refusal, unapplied code, false-done prose)
inspected the **content** of `visibleText`; none checked that it existed. The
loop fell through to `finalText = visibleText` (empty) and returned
`stopReason:'end_turn'` → `task_report: completed` with **no summary**. That is
the founder's «قرب ينتهي فجأة بنقطع، ما بكتب الكلام الأخير».

A second silent stop lived in the **task-budget wrap-up** branch: after the
user denied continuation, the model got one wrap-up turn, then the engine did
`finalText = ''` + `stopReason:'end_turn'` — blank card, no notice of the cap.

**Does "stops after screenshot / no final summary" still reproduce?** **NO.**
The real engine is now driven in `tests/v1136-interruption.test.mjs` and
`tests/v1136-interruption-guard.test.mjs` (real `read_image` / `preview_screenshot`
/ `ui_quality_check` results, large base64 images, empty end_turns, false-done,
exhausted nudges, time cap). The loop **redirects** the empty end_turn with a
bounded corrective until the model writes the answer, and every cap stop emits
a `sys_notice` **and** a visible honest text. Both suites are green.

---

## الحكم (العربية)

**ليش صارت الانقطاعات؟** المحرك كان يقبل أي `end_turn` **بدون نص مرئي** كأنه
جواب نهائي. بعد لقطة التحقق (سكرين شوت) قد ينهي مزوّد الذكاء الاصطناعي الدورة
بـ `finish_reason:'stop'` وهو أصدر **تفكير فقط أو الصورة فقط** — فيصير
`visibleText === ''`. كل حواجز `end_turn` القديمة (DONE مجرّد، رفض، كود غير
مطبّق، ادعاء إنجاز كاذب) كانت تفحص **محتوى** النص، ولا واحدة فحصت أنه موجود أصلاً.
فكان المحرك يمرّر `finalText = visibleText` (فاضي) ويرجع `end_turn` → تقرير
`completed` **بدون أي ملخص**. هذا بالضبط «قرب ينتهي فجأة بنقطع، ما بكتب الكلام
الأخير».

انقطاع صامت ثاني كان في **ميزانية المهمة**: بعد رفض المستخدم للاستمرار، كان
المحرك يفرّغ `finalText` ويرجع `end_turn` — بطاقة فاضية بدون حتى إشعار أن الحد
انتهى.

**هل المشكلة ما زالت تتكرر؟** **لا.** المحرك الحقيقي يُختبر الآن في
`tests/v1136-interruption.test.mjs` و `v1136-interruption-guard` مع نتائج
سكرين شوت حقيقية وصور base64 كبيرة و`end_turn` فارغ وتجاوز الحدود. الحلقة
**تُعيد التوجيه** عند النص الفارغ بعدد محدود حتى يكتب النموذج الجواب، وكل حد
قاسٍ يُصدر `sys_notice` **و** نصاً صادقاً مرئياً. الاختبارات كلها خضراء.

---

## Exact root cause & fix (engine.ts ONLY)

| # | Premature stop | Exact old line | Fix (current file:line) |
|---|---|---|---|
| 1 | Empty/marker-only `end_turn` after an image result returned `finalText = ''` as `completed` | `finalText = visibleText` (was ~6611) | Guard + bounded redirect at **`engine.ts:6764-6778`**; counter `engine.ts:1858`; nudge `engine.ts:721`, cap `engine.ts:729`, notice `engine.ts:6769` |
| 2 | Budget wrap-up blanked the final text | `finalText = ''` in `if (budgetWrapUp)` (was ~5854) | Honest fallback + notice at **`engine.ts:5995-6007`** |
| 3 | Wall-clock cap could end with empty text | was ~5060 | Fallback at **`engine.ts:5198`** |
| 4 | Step-budget exit could end with empty text | was ~6618 | Fallback at **`engine.ts:6786-6789`** |
| 5 | Honest terminal writer (bilingual, never empty) | — | `silentStopFallback()` at **`engine.ts:735`** |

The loop **never stops after a tool**: tool dispatch still ends with
`finalText = ''; continue` (`engine.ts:6556`), so the screenshot result is
always followed by another provider turn. Compaction thresholds
(~5100-5135) and tool-def advertisement were deliberately left untouched.

---

## Follow-up 2 & 3 — MCP capability cuts fixed in the same file

| Bug | Old behavior | Fix (exact file:line) |
|---|---|---|
| Cold connected server → 0 MCP tools in the first request | `enabledMcp` seeded only from the sync last-good cache; fire-and-forget probe landed after `getToolDefs` | Import D8's registry snapshot **`engine.ts:89`**; awaited bounded cold seed **`engine.ts:1898-1921`** (async probe kept for freshness, can only upgrade) |
| Arabic opt-in rejected an explicit request | `استخدم بلندر لرسم مشهد` → `optedIn:false` (only Latin name matched) | `mcpNameAliases()` Latin↔Arabic transliteration **`engine.ts:1196`**; verdict uses all aliases **`engine.ts:1255-1261`** — `use blender` and `استخدم بلندر` both opt in |
| Inline subagent hid `task`/`todo_write` | `toolDefs.filter(d => d.name !== 'task' && d.name !== 'todo_write')` | Filter removed **`engine.ts:3243-3256`**; full 145-core + MCP + provider defs at **`engine.ts:3252`**, used at **`engine.ts:3299`** |
| Subagents could not execute MCP tools | `mcpServers: subagent ? [] : enabledMcp` | **`engine.ts:3146`** — subagents get the same MCP context; the shared opt-in gate (`engine.ts:2878`) still applies |

---

## Verification (all green)

```
npx tsc -p tsconfig.node.json --noEmit        -> EXIT 0
node --test tests/v1136-interruption.test.mjs        (2/2)
node --test tests/v1136-interruption-guard.test.mjs  (1/1, all scenarios PASS)
node --test tests/v1136-mcp-followup.test.mjs        (3/3)
node --test tests/v1136-mcp-tools.test.mjs           (4/4)
node --test tests/v1132-mcp-optin.test.mjs           (2/2)
node --test tests/v1136-subagent-tools.test.mjs      (6/6)
node --test tests/v1131-subagents.test.mjs           (13/13)
node --test tests/v1132-loop.test.mjs                (2/2)
node --test tests/v1132-ai-reality.test.mjs          (7/7)
node --test tests/v1135-compaction-root.test.mjs     (15/15)
```
