# DNA Guard — v11.27 — تقرير تحقّق مستقل / Independent verification report

**Run date:** Fri Nov 20 2026
**Scope:** DIAGNOSIS + TEST ONLY. No application source was changed.
**Test:** `tests/v1127-dna-guard.test.mjs`
**Command:** `node --test --test-force-exit tests/v1127-dna-guard.test.mjs`
**Method:** the REAL engine (`electron/agent/engine.ts`, freshly esbuild-bundled from source) driven in-process against a scripted local OpenAI-compatible `node:http` provider, with an isolated `userData` dir (electron stub) and a freshly bundled REAL renderer store (`src/store.ts`). No DNA function is mocked.

---

## الحكم / Verdict

### عربي — حكم صريح

**نعم، DNA يعمل فعلاً في المسار الأساسي — لكن فيه ثغرة حقيقية واحدة.**

أثبتُّ بالأدلة المادية أن سديم يتعلّم فعلاً:

1. تشغيل حقيقي للمحرك أنتج نمطاً قابلاً للتعلّم، والملف `dna.json` **موجود فعلياً على القرص** ويحتوي النص: `Always run typecheck before committing`، مع `sessionsObserved ≥ 1` و `factsRecorded ≥ 1`.
2. حدث `dna_updated` وصل إلى الـ IO، وحدث `kdx:dna:event` بصيغة `{type:"updated"}` وصل إلى قناة الـ renderer. المتجر (store) أعاد التحميل فعلاً، وأمر `/dna` عرض **الأرقام الحقيقية** من الملف لا أرقاماً وهمية.
3. التشغيل **الثاني** بنى system prompt يحتوي قسم `# User DNA` والنمط المُخزّن، **بعد** تقسيم الكاش (v11.16): النمط موجود في الـ dynamic tail غير المُخزّن مؤقتاً، وليس في الـ prefix الثابت. كما نجا من مسار `cache_control` الإحلالي (gateway downgrade).
4. السقوف صادقة: في النطاق الطبيعي لا يُحذف شيء؛ عند السقف (60) تُحفظ الحقائق الجديدة ويُطرد الأقدم/الأضعف؛ التكرار يرفع الثقة بدل إنشاء نسخة مكررة؛ سقف الـ feedback = 40 مُطبّق.

**لكن:** اكتشفتُ ثغرة حقيقية لم يُصلحها F5. أداة `dna_note` تكتب في `dna.json` بنجاح، لكنها **لا تُرسل حدث `kdx:dna:event`**، والمتجر لا يستمع إلا لهذه القناة. النتيجة: إذا كان التعلّم التلقائي معطّلاً (`dnaEnabled=false`) أو فشل استخراج نهاية التشغيل، فإن ما تكتبه الأداة يبقى مخفياً في الواجهة حتى إعادة تشغيل التطبيق. هذا هو أقرب تفسير لشكوى «الـ dna لا يعمل» من ناحية الواجهة.

**الخلاصة:** المحرك والتخزين والكاش والسقوف سليمة من طرف إلى طرف في المسار التلقائي. الثغرة المتبقية هي إشعار الواجهة عند الكتابة عبر الأداة فقط.

### English — blunt verdict

**Yes — DNA really works end-to-end on the main auto-learning path. There is one real hole.**

Verified with physical artifacts:

1. A real engine run produced a learnable pattern; `dna.json` **physically exists on disk** and contains `Always run typecheck before committing`, with `sessionsObserved ≥ 1` and `factsRecorded ≥ 1`.
2. The `dna_updated` stream event reached the IO, and `kdx:dna:event` `{type:"updated"}` reached the renderer channel. The real store bundle reloaded, and `/dna` printed **the real counts and the real pattern text** from the file.
3. A **second** run's built system prompt contains `# User DNA` and the accumulated pattern **after** the v11.16 cache split — it sits in the uncached dynamic tail, never in the byte-stable cached prefix. It also survives the no-`cache_control` downgrade path.
4. Caps are honest: no silent loss in the normal range; at the 60 cap new facts are kept and the weakest/oldest are evicted; repetition raises confidence instead of duplicating; feedback is capped at 40.

**But:** one genuine gap that F5 did not close. The `dna_note` tool writes to `dna.json` successfully but **never emits `kdx:dna:event`**. The store listens only to that channel. So when auto-extraction is disabled (`dnaEnabled=false`) or its model call fails, an agent-recorded fact stays invisible in the UI until restart. This is the closest code-level explanation for the founder's "DNA doesn't work" as observed in the interface.

**Bottom line:** engine → disk → events → store → next-run prompt → caps is SOUND. The only broken link is UI notification for the tool-write path.

---

## اختبارات / Test results

```
# tests 6   pass 5   fail 1   (the 1 failure is the DIAGNOSTIC below)
ok 1  v11.27 DNA guard: real run → dna.json → events → store → second-run prompt
        ok 1.1  dna.json physically contains the learned pattern
        ok 1.2  dna_updated reaches the store and /dna shows real counts
        ok 1.3  second run prompt includes accumulated DNA after cache split
ok 2  v11.27 DNA guard: caps are honest
not ok 3  v11.27 DIAGNOSTIC: dna_note writes dna.json but does not emit kdx:dna:event updated
```

---

## الفشل الوحيد / The one failure — with file:line to parent

| # | Failure | source location | Impact |
|---|---------|-----------------|--------|
| 1 | `recordAgentNote()` persists the pattern but does not call `emitDNAEvent('updated', …)`. The `kdx:dna:event` IPC is never sent, so the store never reloads. The tool-side `ctx.emit({type:'dna_updated', reason:'note'})` goes to the IO stream, which the store ignores. | `electron/agent/dna.ts:453-479` (write + return at 475-477, no emit); `electron/agent/tools.ts:3026` (stream event only); `src/store.ts:2613-2627` (subscribes only to `kdx:dna:event`); `src/store.ts:3930+` (`ingestAgentEvent` has no `dna_updated` case) | UI stays stale after a `dna_note`-only run; `/dna` and the DNA panel show old counts until restart. Masked in normal runs only because auto-extraction also emits `updated`. |

**Suggested fix is NOT applied here** (test-only mandate): emit `kdx:dna:event` `updated` from `recordAgentNote` and/or have the store react to stream `dna_updated` in `ingestAgentEvent`. Parent/F5 owns the source change.

---

## ما الذي تم فحصه بالضبط / What was actually checked

- Fresh bundles from current source (so F5's changes are included), electron stub with an isolated `userData`, a recording `BrowserWindow.webContents.send`, and a scripted local provider that returns the extraction JSON only when it sees the real `DNA_EXTRACT_SYSTEM` header.
- The store was bundled from `src/store.ts` and driven through `init()`, the captured `onDnaEvent` callback, `loadDna()`, and `sendMessage('/dna')` — the same path the app uses.
- The second-run check inspects the **actual outbound request body** (`body.messages`), asserting the DNA text is in a system message without `cache_control` (the dynamic tail), and separately rebuilds the no-cache shape.
- Caps were checked with deterministic timestamps via `dna.mergeExtraction` (the exact function `mergeExtractionInto` calls at `dna.ts:413`).

## الأدلة / Evidence snippets

- `dna.json` on disk: `patterns[0].text === "Always run typecheck before committing"`, kind `workflow`, `confidence 0.4`, `stats.factsRecorded >= 1`.
- Stream events observed: `dna_updated` with `reason:"extraction"`.
- IPC observed: `kdx:dna:event` payload `{type:"updated", payload:{reason:"extraction"}}`.
- `/dna` reply matched `SADEEM DNA — \d+ patterns` and contained the exact pattern text.
- Second-run system messages: cached prefix message (`cache_control:{type:"ephemeral"}`) + uncached dynamic message containing `# User DNA` and the pattern.
- Caps: 20+3 → 23 (none lost); duplicate reinforcement → count 3, `confidence 0.85`, kind hardened to `correction`; 60+5 → 60 with all 5 new facts present; 45 feedback → 40.

## ملاحظات / Notes

- The failing diagnostic is intentional and must stay red until the source gap is fixed; it is the regression guard for the remaining hole.
- No source files were edited. The only new files are this report and `tests/v1127-dna-guard.test.mjs`.
