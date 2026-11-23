# AI Depth v11.38 — أكبر موجة تحسين للذكاء الاصطناعي / Biggest AI Capability Uplift

**Scope:** `electron/agent/prompts.ts` (MAIN system-prompt sections ONLY) · `tests/v1138-ai-depth.test.mjs` · this doc.
**Ownership:** touched ONLY `MODE_NOTES`, `TASK_MODE_SPECS`, the verification/finishing-loop directive, and ONE new directive in the DYNAMIC tail. Did NOT touch SKILLS-FIRST (F11), CAPABILITY ROSTER, DNA, token-economy, engine.ts, tools.ts, store.ts, providers.ts.

---

## 1. What changed / ما الذي تغيّر

### 1.1 DEEP WORK directive — DYNAMIC tail, NOT the cached prefix
**File:** `electron/agent/prompts.ts:946-959` (heading at `:952`, five steps `:953-957`).

One compact, word-stable directive — **368 bytes net** (366 B block + 2 B separator), well under the ≤600 B budget. It lives in `buildSystemPrompt()`'s `tail`, after `SYSTEM_CACHE_SPLIT`, so it reaches every turn's system prompt without invalidating the provider-cached static prefix.

| Step | Directive | الهدف |
|---|---|---|
| 1. INTENT | grasp the real goal first; cover ALL parts | افهم النية الحقيقية قبل التنفيذ؛ غطّ كل أجزاء الطلب |
| 2. RIGHT TOOL | explore=read/search/map, change=edit, verify=run | اختر الأداة الصحيحة حسب النية: قراءة/بحث/خريطة للاستكشاف، تعديل للتغيير، تشغيل للتحقق |
| 3. VERIFY | run the check, READ output — never claim done from memory | شغّل الفحص واقرأ النتيجة قبل إعلان الإنجاز |
| 4. FAIL | read the error's EXACT FIX, self-correct ONCE, then switch — never loop, never "I can't" | عند الفشل اقرأ الإصلاح الدقيق، صحّح مرة ثم غيّر المقاربة — بلا حلقات ولا «لا أستطيع» |
| 5. FINISH | honest evidence — paths + command/result + gaps | اختم بأدلة صادقة: المسارات + الأمر/النتيجة + ما تبقّى |

### 1.2 MODE_NOTES / TASK_MODE_SPECS — crisp tool sequences (weak-model salience)
- `prompts.ts:128-130` — `MODE_NOTES.plan`: `repo_map/list_dir → read_file/search_files → propose_plan → STOP`.
- `prompts.ts:180` — plan `EXPLORE`: `repo_map → symbol_outline → read_file/search_files → diff`.
- `prompts.ts:191` — debug: `read_file/search_files → debug_start → test_run/run_command (REPRODUCE red) → edit_file → test_run green`.
- `prompts.ts:208` — review: `git_local status/diff → review_diff → read_file/search_files → report` (NON-MUTATING).

### 1.3 Verification / finishing-loop directive
- `prompts.ts:707-715` — `# Long-task discipline` + `# Verify before done` compacted but headings + `never repeat a failing call unchanged` preserved.
- `prompts.ts:737` — FINISHING LOOP now explicit: **preview → ui_quality_check → FIX till PASS → preview_screenshot → LOOK → fix & re-shoot → final summary with file paths**. This directly targets the founder's repeated "stops before the final word" concern at the prompt-salience level (the engine-side stall guard is owned by another agent).

---

## 2. Prompt bytes — before / after / بعد / قبل

Measured with the repo's esbuild harness, `BASE = { mode:'default', language:'en', platform:'win32' }` (the exact config the v11.16/21/23/31/32 byte-cap tests use):

| Metric | Before | After | Cap | Status |
|---|---|---|---|---|
| EN total | 24,425 B | **24,422 B** | < 24,576 B (24 KB) | ✅ |
| EN static prefix | 24,292 B | 23,921 B | cached | ✅ |
| EN dynamic tail | 105 B | 473 B | — | ✅ |
| AR total | 35,895 B | 35,892 B | — | ✅ |
| Δ vs 23,754 (v11.21) | +671 | **+668** | ≤ +700 | ✅ |
| Net vs 24,381 (v11.23) | +44 | **+41** | 0 … +399 | ✅ |
| DEEP WORK directive | — | **368 B net** | ≤ 600 B | ✅ |

**Net change: −3 bytes on the EN prompt.** The DEEP WORK directive is byte-funded by compacting the verification/finishing directives it reinforces. All byte caps stayed green — no cap was relaxed, no test skipped.

---

## 3. Tests / الاختبارات

- `tests/v1138-ai-depth.test.mjs` — **8/8 pass**. Covers: source-level tail-vs-prefix placement; ≤600 B + all byte caps; EN/AR render on tail side only; **scripted provider run** proving the directive reaches the actual system message with cache ON (dynamic message) and cache OFF (single message); plan/debug/review tool sequences; finishing-loop ordering with final file paths; memo stability.
- Existing regressions: `v1116-prompt-cache` + `v1121-ai-quality` + `v1132-prompt-real` + `v1131-prompts` — **32/32 pass**.
- `npx tsc -p tsconfig.node.json --noEmit` → **exit 0, clean** on the final run. `electron/agent/prompts.ts` also compiles clean in isolation. (Mid-task, transient errors appeared in concurrently-edited files owned by other agents — `providers.ts` `wantedThinkingBudget`, then `signatureFeatures.ts` `ToolDefLike` — and resolved as those agents finished; none originated in this file.)

---

## 4. Blunt verdict / الحكم الصريح

**EN:** This is a real uplift in *prompt salience*, not a new feature and not a magic intelligence upgrade. The model now gets one short, unambiguous operating contract on every turn — intent → right tool → verify → self-correct-once → honest evidence — plus literal tool sequences for plan/debug/review and a finishing loop that ends with file paths. A strong model will behave measurably more deliberately; a weak model finally has a 5-line script it can follow. But **a system prompt can only steer**: it cannot force a weak model to reason, cannot make a tool call by itself, and cannot fix the engine-side "stops before final word" stall (that guard is another agent's file). Delivered within every byte cap (−3 B net) and with the cached prefix untouched.

**AR:** هذه تحسين حقيقي في *وضوح التوجيه* (salience)، لا ميزة جديدة ولا ترقية سحرية للذكاء. النموذج يحصل الآن على عقد تشغيل قصير وواضح في كل دورة: نية → أداة صحيحة → تحقق → تصحيح once → دليل صادق، إضافة إلى تسلسلات أدوات حرفية لأنماط plan/debug/review و(end finishing loop) ينتهي بمسارات الملفات. النموذج القوي سيتصرف بعناية أكبر، والضعيف صار لديه سكربت من ٥ أسطر يتبعه. لكن **الـ system prompt يوجّه فقط**: لا يستطيع إجبار نموذج ضعيف على التفكير، ولا استدعاء أداة بنفسه، ولا إصلاح توقف المحرك قبل الكلمة الأخيرة (تلك بوابة ملف يملكه وكيل آخر). تم التسليم داخل كل حدود البايتات (صافي −3 بايت) دون المساس بالـ prefix المخزّن مؤقتًا.
