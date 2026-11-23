# v1142 — Max Concurrent Subagents / الحد الأقصى للوكلاء الفرعيين

**Status:** implemented and verified. **English** below, **العربية** after it.

---

## English

### What the founder asked for

> «السب ايجنت يعني قدرة إنه السب ايجنت ما له حد معين، بس إنه الشخص بيقدر من الإعدادات من عند الايجنت يحدد كم ايجنت بيقدر يستخدمه. أتوقع أنت ضعيف هاي القدرة إنه يحدد كم ايجنت بيقدر يستخدمه.»

Translation: subagents should not feel artificially capped, **but the user must be able to say how many agents may run at once from the Agent settings**. Before v1142 the only limit was a hardcoded engine constant (`BACKGROUND_SUBAGENT_CAP = 64`) with no UI and no setting — the user genuinely had no control. v1142 turns it into a real, persisted, runtime-honored setting.

### Honest design decisions

| Decision | Value | Why |
|---|---|---|
| Setting | `maxSubagents?: number` (top-level `AppSettings`) | One real settings field, persisted via the existing `updateSettings` action. |
| Range | **1…64** (`MAX_SUBAGENTS_MIN`…`MAX_SUBAGENTS_CEILING`) | A hard ceiling is required so a bad value can never spawn infinitely. It is **not** advertised as "unlimited". |
| Default | **64** (`MAX_SUBAGENTS_DEFAULT`) | The previous shipped behavior was already 64 ("no practical limit" for normal work). Keeping it preserves every existing session and the founder's "no set limit" posture; the user can now *lower* it. A lower default (e.g. 8) would have silently broken existing parallel workflows and the `v1135` cap test. |
| Repair | `clampMaxSubagents()` | `NaN`→64, `0`/negative→1, `>64`→64, fraction→floor. Applied at BOTH write and read. |
| Parallel batch | `runSubagentBatch` bounded by the same setting | The batch previously had no cap; overflow tasks are queued, never dropped. |
| i18n | Inline EN/AR strings in the component | No i18n file was touched (out of scope); the control is still fully bilingual. |

### Exact changes (file:line)

| File:line | Change |
|---|---|
| `shared/types.ts:992` | `MAX_SUBAGENTS_DEFAULT = 64` |
| `shared/types.ts:993` | `MAX_SUBAGENTS_MIN = 1` |
| `shared/types.ts:994` | `MAX_SUBAGENTS_CEILING = 64` (hard safety ceiling) |
| `shared/types.ts:998-1002` | `clampMaxSubagents(v: unknown): number` — single source of truth for clamping |
| `shared/types.ts:1212-1222` | `AppSettings.maxSubagents?: number` with default/range/honesty contract |
| `src/store.ts:37` | value import of `clampMaxSubagents` |
| `src/store.ts:2861-2866` | `updateSettings()` clamps `patch.maxSubagents` before `set()` and `api.saveSettings()` |
| `src/components/settings/AgentSection.tsx:111-112` | defensive read + real `updateSettings` writer |
| `src/components/settings/AgentSection.tsx:270-314` | **Subagents** `GroupCard`: EN/AR label + hint, `Slider` (1–64), `NumberInput` (1–64), honesty note. All handlers wired. |
| `electron/agent/engine.ts:125` | value import of default + clamp |
| `electron/agent/engine.ts:980-997` | `BACKGROUND_SUBAGENT_CAP = 64` remains the HARD ceiling; new `backgroundSubagentCap(settings?)` resolves the effective cap from the setting |
| `electron/agent/engine.ts:7186-7195` | enforcement site uses `const cap = backgroundSubagentCap(fullSettings())`; refusal text names the cap and points at `Settings → Agent → Max parallel subagents` |
| `electron/agent/subagentRunner.ts:46-47, 91-96` | clamp import + `subagentBatchCap()` |
| `electron/agent/subagentRunner.ts:486-491` | `SubagentRunOptions.maxConcurrent?: number` |
| `electron/agent/subagentRunner.ts:694-709` | bounded worker pool in `runSubagentBatch`; every task still returns a real result |
| `tests/v1142-subagent-limit.test.mjs:1-...` | 6 runtime tests (real bundles, mocked settings service) |
| `docs/SUBAGENT-LIMIT-V1142.md` | this report |

### Runtime flow

```
Settings → Agent → Max parallel subagents (slider / number, 1–64)
        │  updateSettings({ maxSubagents })         src/store.ts:2865  (clamped, persisted)
        ▼
settings.json (main process, storeService.getSettings)
        │  fullSettings()                           electron/agent/engine.ts:7187
        ▼
backgroundSubagentCap()  →  clampMaxSubagents()     electron/agent/engine.ts:997
        ▼
if (backgroundRunning >= cap) → honest BACKGROUND_LIMIT refusal with next step
        ▼
runSubagentBatch(..., opts.maxConcurrent ?? subagentBatchCap())  subagentRunner.ts:699
```

A corrupt `settings.json` (`-5`, `0`, `1e9`, `"abc"`) is repaired on both sides — the engine can never be told to spawn an unbounded number of subagents.

### Verification

```
node --test --test-force-exit tests/v1142-subagent-limit.test.mjs  6/6 PASS
node --test --test-force-exit tests/v1136-subagent-tools.test.mjs  6/6 PASS
node --test --test-force-exit tests/v1134-all-tools.test.mjs       6/6 PASS
node --test --test-force-exit tests/v1131-full-smoke.test.mjs     82/82 PASS
node --test --test-force-exit tests/v1135-compaction-root.test.mjs 15/15 PASS
node --test --test-force-exit tests/v1131-subagents.test.mjs (+ v1119 + v1123) 29/29 PASS
node --test --test-force-exit tests/v1131-ui-settings.test.mjs (+ v1131-store) 18/18 PASS
```

Targeted `tsc` on every owned file passed:

```
npx tsc --noEmit ... shared/types.ts src/store.ts src/components/settings/AgentSection.tsx    PASS
npx tsc --noEmit ... shared/types.ts electron/agent/engine.ts electron/agent/subagentRunner.ts PASS
```

The repository-wide `npm run typecheck` also passes in the final state. No file outside this subagent's ownership list was modified. (An unrelated parse error in `src/components/panels/SkillsPanel.tsx:1033-1034` existed transiently during verification and was fixed by its owning workstream; this subagent did not touch it.)

---

## العربية

### ما طلبه المؤسّس

> «السب ايجنت يعني قدرة إنه السب ايجنت ما له حد معين، بس إنه الشخص بيقدر من الإعدادات من عند الايجنت يحدد كم ايجنت بيقدر يستخدمه. أتوقع أنت ضعيف هاي القدرة إنه يحدد كم ايجنت بيقدر يستخدمه.»

بمعنى: الوكلاء الفرعيون ما يجب أن يكونوا مقيّدين بحدّ صناعي، **لكن المستخدم لازم يقدر يحدد من إعدادات الوكيل كم وكيل يشتغل بنفس الوقت**. قبل v1142 كان الحد الوحيد ثابتاً داخل المحرّك (`BACKGROUND_SUBAGENT_CAP = 64`) بدون أي إعداد أو واجهة — أي أن المستخدم فعلياً ما كان عنده تحكّم. v1142 حوّله إلى إعداد حقيقي محفوظ ومُطبَّق وقت التشغيل.

### قرارات تصميم صادقة

| القرار | القيمة | السبب |
|---|---|---|
| الإعداد | `maxSubagents?: number` داخل `AppSettings` | حقل إعداد واحد حقيقي، يُحفظ عبر `updateSettings` الموجود فعلاً. |
| المدى | **1…64** | سقف صارم حتى لا يستطيع أي قيمة فاسدة أن تُطلق عدداً لا نهائياً.لا نُسمّيه «غير محدود». |
| الافتراضي | **64** | السلوك السابق كان 64 أصلاً («لا حد عملي» في العمل الاعتيادي)، فإبقاؤه يحفظ الجلسات القائمة وموقف «بلا حد معين»؛ والمستخدم يستطيع الآن **تخفيضه**. أي افتراضي أقل (مثل 8) كان سيكسر سير العمل المتوازي القائم واختبار `v1135`. |
| الإصلاح | `clampMaxSubagents()` | `NaN`←64، `0`/سالب←1، أكبر من 64←64، كسر←عدد صحيح. يُطبَّق عند الكتابة **و** القراءة. |
| الدفعة المتوازية | `runSubagentBatch` ملتزمة بال same setting | الدفعة كانت بلا سقف؛ الآن الزائد يُوضع في طابور ولا يُسقط أي مهمة. |
| الترجمة | نصوص EN/AR داخل المكوّن | لم يُعدّل ملف i18n (خارج النطاق)، والعنصر بلغتهين كاملتين. |

### المواقع بالضبط (file:line)

| الملف:السطر | التغيير |
|---|---|
| `shared/types.ts:992-994` | الثوابت: الافتراضي 64، الأدنى 1، السقف الصارم 64 |
| `shared/types.ts:998-1002` | `clampMaxSubagents()` — مرجع واحد لإصلاح القيم |
| `shared/types.ts:1212-1222` | حقل `AppSettings.maxSubagents?: number` مع عقد الصدق |
| `src/store.ts:37` | استيراد قيمةً لـ `clampMaxSubagents` |
| `src/store.ts:2861-2866` | `updateSettings()` يقيّد القيمة قبل `set()` و`api.saveSettings()` |
| `src/components/settings/AgentSection.tsx:111-112` | قراءة دفاعية + كاتب حقيقي عبر `updateSettings` |
| `src/components/settings/AgentSection.tsx:270-314` | بطاقة **الوكلاء الفرعيون**: عنوان وشرح عربي/إنجليزي، شريط (1–64)، حقل رقمي دقيق (1–64)، ملاحظة صدق — كلها موصولة |
| `electron/agent/engine.ts:980-997` | `BACKGROUND_SUBAGENT_CAP = 64` يبقى **السقف الصارم**، و`backgroundSubagentCap()` يستخرج الحد الفعلي من الإعداد |
| `electron/agent/engine.ts:7186-7195` | موقع التطبيق يستخدم `backgroundSubagentCap(fullSettings())`، ورسالة الرفض تشير إلى «الإعدادات ← الوكيل ← الحد الأقصى للوكلاء الفرعيين» |
| `electron/agent/subagentRunner.ts:91-96, 486-491, 694-709` | نفس الإعداد يقيد الدفعة المتوازية بدون إسقاط أي مهمة |
| `tests/v1142-subagent-limit.test.mjs` | 6 اختبارات وقت تشغيل على الحزم الحقيقية |
| `docs/SUBAGENT-LIMIT-V1142.md` | هذا التقرير |

### مسار التنفيذ

```
الإعدادات ← الوكيل ← الحد الأقصى للوكلاء الفرعيين (1–64)
        │  updateSettings({ maxSubagents })     src/store.ts:2865  (تقييد + حفظ)
        ▼
settings.json ← storeService.getSettings()
        │  fullSettings()                       engine.ts:7187
        ▼
backgroundSubagentCap() → clampMaxSubagents()   engine.ts:997
        ▼
إذا كان عدد الجاري >= الحد → رفض صادق مع خطوة تالية
        ▼
runSubagentBatch(..., opts.maxConcurrent ?? subagentBatchCap())
```

أي قيمة فاسدة في `settings.json` (`-5`، `0`، `1e9`، `"abc"`) تُصلح من الجهتين — لا يمكن للمحرّك أن يتلقى أمراً بإطلاق عدد غير محدود من الوكلاء.

### التحقق

جميع الاختبارات المطلوبة وأضافاتها خضراء: `v1142` (6/6)، `v1136-subagent-tools` (6/6)، `v1134-all-tools` (6/6)، `v1131-full-smoke` (82/82)، `v1135-compaction-root` (15/15)، اختبارات الوكلاء (29/29)، اختبارات إعدادات الواجهة والمتجر (18/18). فحص `tsc` لكل file مملوك نجح.

فحص `npm run typecheck` العام نجح أيضاً في الحالة النهائية، ولم يُعدّل أي ملف خارج القائمة المملوكة. (ظهر خطأ تحليل عابر وغير مرتبط في `src/components/panels/SkillsPanel.tsx:1033-1034` أثناء التحقق وأصلحه أصحابه؛ لم تلمسه هذه المهمة.)
