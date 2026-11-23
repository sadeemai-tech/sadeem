# AI-DEPTH GUARD — v11.38 / G1 verification / حكم «أعمق أم مجرد كلمات أكثر»
**Files / الملفان:** `tests-v1138-ai-depth-guard.mjs` · `docs/AI-DEPTH-GUARD-V1138.md`
**Snapshot run / لحظة القياس:** 2026-11-22T08:04:17Z · **Result / النتيجة: 20 PASS / 0 FAIL** (exit 0)
**Raw data / البيانات الخام:** `tests/.v1138-ai-depth-guard.results.json`
**Scope / النطاق:** DIAGNOSIS + TEST + DOC ONLY — **no app source was edited by this guard** / لم يُعدَّل أي كود تطبيق بهذا الفحص.

---

## 1. Blunt verdict / الحكم بوضوح

**EN — All four checks PASS, but name the change honestly: this is an instruction upgrade, not a new intelligence.**
G1 did **not** add new engine machinery. The self-correction path, the preview-before-final order and the honest-final answer were already in the engine — this guard proves they actually run. What G1 changed is a **5-line, word-stable `DEEP WORK` directive placed in the UNCACHED dynamic tail**, so it is re-sent on **every** turn (including to weak models) without ever invalidating the byte-stable cached prefix. It names the four behaviours the founder asked for: intent-matched tool choice, read-the-fix → self-correct → never loop, verify-before-done, and an honest-evidence final summary.

So: *"just more words"* is **literally false** — the rendered EN prompt is **24,422 B vs the 24,425 B pre-G1 baseline, i.e. three bytes SHORTER** (G1 compacted the static `FINISHING LOOP` line to pay for the new tail block). *"Genuinely deeper"* is true only in the narrow, honest sense: the model now receives an always-present operating contract with four concrete behaviours instead of scattered advice. It is **not** a smarter model, and this guard cannot prove a real provider obeys the directive — the provider here is scripted.

**AR — كل الفحوصات الأربعة نجحت، لكن سمِّ التغيير باسمه الصحيح: ترقية تعليمات، لا ذكاء جديد.**
G1 لم يضف آلية محرك جديدة. مسار التصحيح الذاتي، وترتيب المعاينة قبل النهاية، والإجابة النهائية الصادقة كانت موجودة أصلاً في المحرك — وهذا الفحص يثبت أنها تعمل فعلاً. ما غيّره G1 هو **توجيه `DEEP WORK` من خمسة أسطر، ثابت الكلمات، موضوع في الـ dynamic tail غير المُخزّن**، فيُعاد إرساله في **كل** دور (حتى للنماذج الضعيفة) دون أن يُبطل بادئة الـ cache الثابتة. ويسمّي السلوكيات الأربعة التي طلبها المؤسس: اختيار الأداة بحسب النية، قراءة الإصلاح ← تصحيح ذاتي ← بلا حلقات، تحقّق قبل الإنهاء، وملخص نهائي بأدلة صادقة.

إذن: «مجرد كلمات أكثر» **كاذبة حرفياً** — البرومبت الإنجليزي المُخرَج **24,422 بايت مقابل 24,425 بايت قبل G1، أي أقصر بثلاثة بايتات** (ضغط G1 سطر `FINISHING LOOP` الثابت ليدفع ثمن الكتلة الجديدة في الـ tail). و«أعمق فعلاً» صحيحة بالمعنى الضيق والصادق فقط: النموذج يستلم الآن عقد تشغيل دائم الحضور بأربعة سلوكيات محددة بدل نصائح متفرقة. **ليس** نموذجاً أذكى، وهذا الفحص لا يستطيع إثبات أن مزوّداً حقيقياً يطيع التوجيه — المزوّد هنا مُبرمج مسبقاً.

---

## 2. Method — what is real, what is fake / المنهجية

| Component / العنصر | Status / الحالة |
|---|---|
| `prompts.ts` + `engine.ts` | **REAL**, esbuild-bundled (Electron stubbed); no source edited |
| `buildSystemPrompt()` byte measurement | **REAL** output of the bundled module |
| Tool dispatch (`read_file`, `list_dir`, `write_file`, `preview_screenshot`) | **REAL** engine loop + real `executeTool` |
| Provider | **FAKE but local**: scripted OpenAI-compatible SSE server (`node:http`, `127.0.0.1`) — **zero external net**, no model |
| Failure fixture | **REAL** missing path → real `read_file` `ENOENT` with a `Fix:` line (`tools.ts:424`) |

Run / التشغيل:
```
node tests-v1138-ai-depth-guard.mjs          # exit 0 = all PASS
type tests\.v1138-ai-depth-guard.results.json
```

---

## 3. Results per check — exact file:line / النتائج مع مواضع الأسطر

### Check 1 — SOURCE SCAN: directive in the dynamic tail / فحص المصدر: التوجيه في الـ tail الديناميكي

| ID | Result | Evidence / الدليل | file:line |
|---|---|---|---|
| `B0-PROMPTS-BUNDLE` | **PASS** | real `prompts.ts` bundled | test script |
| `1-SOURCE-HEADING` | **PASS** | `# DEEP WORK` heading found **inside `buildSystemPrompt()`**, not in `buildStaticSystemPrefix()` | `electron/agent/prompts.ts:952` |
| `1-SOURCE-FOUR-BEHAVIOURS` | **PASS** | all four behaviour predicates true (details below) | `electron/agent/prompts.ts:952-957` |
| `1-RENDER-TAIL-NOT-PREFIX` | **PASS** | cache split present; directive in tail=`true`, in cached prefix=`false` | `electron/agent/prompts.ts:83`, `prompts.ts:90` |

The four behaviour predicates (worded to accept the landed phrasing OR equivalent tokens):
/محددات السلوكيات الأربعة (تقبل الصياغة المُنزَّلة أو مرادفاتها):

| Behaviour | Landed line / السطر المُنزَّل | Predicate / المُحدِّد |
|---|---|---|
| tool-selection-by-intent | `1. INTENT: grasp the real goal first` + `2. RIGHT TOOL: explore=read/search/map, change=edit, verify=run` | INTENT/goal **AND** RIGHT TOOL/choose tool |
| read-fix-relay-not-loop | `4. FAIL: read the error's EXACT FIX, self-correct ONCE, then switch — never loop` | read + FIX + self-correct/switch + never loop |
| verify-before-done | `3. VERIFY: run the check, READ output — never claim done from memory` | verify + never claim done / READ output |
| honest evidence final summary | `5. FINISH: honest evidence — paths + command/result + gaps` | FINISH + honest + evidence |

### Check 2 — BYTE DELTA vs the frozen caps / حدود البايت

| Metric / المقياس | Cap / الحد | Measured / المقاس | Result |
|---|---|---|---|
| v11.16 EN prompt | `< 24,576 B` | **24,422 B** | **PASS** |
| v11.21 `size − 23,754` | `≤ 700` | **+668** (32 B headroom) | **PASS** |
| v11.23 `size − 24,381` | `0 ≤ … < 400` | **+41** | **PASS** |
| vs 24,425 B pre-G1 baseline | reported, not asserted | **−3 B** (shorter) | **PASS** |

`2-DIRECTIVE-HAS-BYTES` **PASS** — the directive is genuinely rendered; the net byte count is down 3 B because the static `FINISHING LOOP` line was compacted (`prompts.ts:737`). Full EN prompt: `electron/agent/prompts.ts:926` (`buildSystemPrompt`).

> **Byte-band warning / تحذير نطاق البايت:** only **32 B** of headroom remains on the v11.21 cap. Any future addition to the rendered prompt breaks it. / لم يتبقَّ سوى **32 بايت** في حد v11.21؛ أي إضافة مستقبلية للبرومبت تكسره.

### Check 3 — REAL ENGINE (scripted provider, zero net) / المحرك الحقيقي بمزوّد مُبرمج

| ID | Result | Evidence / الدليل | file:line |
|---|---|---|---|
| `B0-RUN-AGENT` | **PASS** | real `runAgent` bundled | `electron/agent/engine.ts:1935` |
| `3A-SYSTEM-PROMPT-HAS-DIRECTIVE` | **PASS** | built system prompt (25,280 chars, reconstructed from `body.system` **and** the two `role:'system'` messages) contains `# DEEP WORK` | `electron/agent/engine.ts:3024` |
| `3B-ACTIONABLE-FAILURE` | **PASS** | real `read_file` on missing path → `path does not exist … (ENOENT)` + concrete `Fix:` | `electron/agent/tools.ts:424` |
| `3B-SELF-CORRECT-FOLLOWUP` | **PASS** | engine dispatched `read_file` **→** a different `list_dir`, with paired `tool_result`s — no silent stop | `electron/agent/engine.ts:6322` |
| `3B-NOT-A-LOOP` | **PASS** | 0 `DISPATCH BLOCKED` breaker notices for the single actionable failure | `electron/agent/engine.ts:6421` |
| `3B-HONEST-FINAL` | **PASS** | 255-char final with `Summary:`, `turn_end` and `task_report` emitted | engine loop |
| `3C-PREVIEW-BEFORE-FINAL` | **PASS** | build task emitted a `preview_screenshot` step **before** the first final text (`write_file → preview_screenshot`) | `electron/agent/engine.ts:6667` |
| `3C-BUILD-PROMPT-FINISHING-LOOP` | **PASS** | build system prompt orders `preview → preview_screenshot → final summary → "Unseen UI is not done"` | `electron/agent/prompts.ts:737` |

> **Reading the 3B result honestly / قراءة نتيجة 3B بصدق:** the follow-up call is **scripted by the test provider**. What this proves is that the **engine dispatches a legitimate differing follow-up instead of blocking it as a loop or stopping** — not that an unscripted real model will always generate one. / الاستدعاء اللاحق مُبرمج من قِبل المزوّد في الاختبار؛ ما يُثبته هو أن **المحرك يُرسل استدعاءً مختلفاً مشروعاً بدل حظره كحلقة أو التوقف**، لا أن نموذجاً حقيقياً غير مُبرمج سيولّده دائماً.

### Check 4 — HYGIENE: no EN+AR mixing, word-stable / النظافة: بلا خلط لغوي، ثبات الكلمات

| ID | Result | Evidence / الدليل | file:line |
|---|---|---|---|
| `4-WORD-STABLE` | **PASS** | directive block has **no `${}`**, no `opts.`/`new Date`/`process.`/`lang ===`/`bi(` reads | `electron/agent/prompts.ts:952` |
| `4-NO-EN-AR-MIX` | **PASS** | no Arabic script in the EN directive, none in the AR directive; em dash used only as punctuation, never as `bi()` prose | `electron/agent/prompts.ts:236` |
| `4-BLOCK-BYTE-IDENTICAL-EN-AR` | **PASS** | directive renders byte-identically in EN and AR (single language-neutral block) | `electron/agent/prompts.ts:926` |

---

## 4. Re-run after any further G1 edits / إعادة التشغيل

1. This guard touched **no** app source. Land/patch the source, then re-run.
2. `node tests-v1138-ai-depth-guard.mjs` → require **20 PASS / 0 FAIL**, exit 0.
3. Compare `tests/.v1138-ai-depth-guard.results.json` with the tables above.
4. **Do not weaken a predicate to erase a FAIL** — the four behaviour checks are the contract. If a reworded directive is semantically equivalent, update the *predicate* in the guard and the table in this doc together, and say so explicitly.

---

## 5. Honesty notes / ملاحظات الصدق

- This is a **behaviour-plumbing guard**, not a model-quality benchmark. It proves the directive reaches the provider and the engine's self-correction / preview / honest-final paths execute. It does **not** measure whether a real LLM follows the directive more often.
- The system prompt is reconstructed from both wire formats (OpenAI `messages` and Anthropic `body.system`); a future provider that hides the prompt from the request body would need a new capture path.
- Byte caps are measured with a fixed BASE option set (EN, win32, no DNA/playbook/MCP/rules). Conditional tail sections (e.g. MCP tools) add bytes on top — the 32 B v11.21 headroom is for that exact BASE configuration.
- `preview_screenshot` returns a headless-context error here; the check proves the **step is dispatched before the final answer**, not that a screenshot image was captured. / `preview_screenshot` يُعيد خطأ «بيئة بلا واجهة» هنا؛ الفحص يثبت أن **الخطوة تُرسل قبل الإجابة النهائية**، لا أن صورةً التُقطت فعلاً.
- A past PASS is a snapshot, not a guarantee: re-run after every prompt/engine edit.
