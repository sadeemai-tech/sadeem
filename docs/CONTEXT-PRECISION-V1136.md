# CONTEXT / TOKEN / PRICE PRECISION — v11.36 (final independent verification)
# دقة السياق / التوكن / السعر — المراجعة النهائية المستقلة

> **السؤال المباشر: «هل الكونتكست والسعر دقيقان الآن من المزود؟»**
>
> **الجواب: نعم — PASS (13/13).** عند وجود كتالوج OpenRouter حي، يأتي طول النافذة
> والسعر **من المزود نفسه** لكل نموذج على حدة (1M / 100k / 200k)، مع `fetchedAt`
> و`sourceUrl`، وحساب توكن وسعر BigInt دقيق. لا يوجد مسار يُعامل نموذج 1M كـ 200k،
> ولا سعر مُختلق. التحقق تم بسلوك حقيقي (bundle + fixture) لا بفحص النص فقط.

---

## EN — blunt verdict

**PASS.** I bundled the real `openrouterCatalog.ts` + `costs.ts` + `ctx.ts` with
esbuild into one module, injected a real OpenRouter-shaped `/api/v1/models`
fixture (3 models: `1,000,000` / `100,000` / `200,000` tokens, each with
distinct exact USD-per-token strings) and drove the actual resolvers.

| Claim | Verdict | Hard evidence |
| --- | --- | --- |
| Exact per-model window (1M / 100k / 200k) from the provider payload | **PASS** | `tests-v1136-context-precision.mjs:141`, `:158` |
| Exact distinct price per model, **not** curated/default, with `fetchedAt` + `sourceUrl` | **PASS** | `:158`, `:187` (A/B proof) |
| 1M model never treated as 200k; 100k = 10% no compaction; 900k = 90% eligible | **PASS** | `:210`, `:226` |
| Exact input/output/cache math, BigInt-safe, unknown model honest | **PASS** | `:256`, `:281`, `:296` |
| Script-aware estimator (Arabic ≈2 chars/token), `≈` labelling, no false 100% | **PASS** | `:329`, `:344` |
| No fixed 120k/10k chars **trigger** in `engine.ts`; window resolution catalog-first | **PASS** | `:380`, `:414` |

Run result: `tests 13 / pass 13 / fail 0`. Cross-check: `v1135-price-precision`,
`v1135-token-precision`, `v1135-compaction-root` → `36 / 36 / 0`.

### What was actually proven (not just grepped)

- The 1M fixture reuses the id `anthropic/claude-haiku-4-5`, which the curated
  table pins to **200k and $1/$5**. With the catalog reset, the code indeed
  returns 200k / $1/$5 (`source: 'curated'`); after injecting the provider
  payload the **same id** returns **1,000,000 / $0.777 / $4.321**
  (`source: 'openrouter-live'`, `match: 'exact'`). That is a behavioural A/B
  proof that the provider wins and the curated table cannot fake a 1M model's
  window or price.
- Prices are kept as exact decimal strings (`'0.000000075'`) and billed with
  BigInt fixed-point at 1e-12 USD: 1,234,567 tokens × $0.000000075 =
  **$0.092592525** with no float drift. Input/output/cache-read/cache-write
  are distinct and never swapped or double-counted (disjoint `parts` sum to
  `costUsd`).
- Unknown ids return `null` prices, `costUsd: 0`, `unknown: true`, no timestamp
  and no URL. The legacy `$3/$15` fallback survives **only flagged** so the
  picker never calls an unknown paid model "free" — it is never presented as a
  known price.
- Engine window: `openrouterContextFor()` → curated table → honest default, in
  **both** the engine (`engine.ts:4866-4868`) and the orb
  (`ipc.ts:689-691`). Compaction engages only at 90% of that real window
  (`ctx.ts:140-149`); the removed fixed 10k–120k chars trigger is not in live
  code (`engine.ts:5104-5122`, comments stripped before scanning).

### Honest caveats (non-blocking — reported, not hidden)

1. **"From the provider" requires a successful catalog fetch.**
   `openrouterLiveModels()` needs an OpenRouter key; on network/auth failure it
   returns `[]` and the app falls back to the curated table (vendor price
   pages), or to the `≈200k` default for unknown ids. That fallback is
   **labelled** (`source`, `contextEstimated`, `≈`) — it never pretends to be a
   provider number. The precision promise holds for the live path; the offline
   path is honest, not silently fake.
2. **No real BPE tokenizer is installed.** All pre-report numbers are estimates
   marked `≈`; no vendored tokenizer is claimed. Provider-reported usage
   (`prompt_tokens` / `completion_tokens`) is the only exact source.
3. **Dead constant left behind:** `COMPACT_THRESHOLD_DEFAULT = 120_000`
   (`engine.ts:266`) is declared but consumed **zero** times — verified by the
   occurrence count in `:380`. The surviving `10_000` (`engine.ts:5130`) only
   bounds the verbatim tail *after* a real-window trigger. Neither can compact
   a 1M model early. Cosmetic hygiene only.
4. **Minor cosmetic note:** with an unknown window, `formatContextBreakdown()`
   prints `Remaining: ≈0 tokens` while the Context line correctly says
   `unknown` (`ctx.ts:431`). "≈" here means "context unknown", not a false
   exact zero — not a precision defect.
5. Not modelled: long-prompt `pricing.overrides`, batch `:batch` discounts,
   `input_cache_write_1h`, non-USD components. The provider invoice remains
   authoritative.

---

## عربي — الحكم بوضوح

**نجاح (PASS) — 13 من 13 اختبار.** ربطُّ الملفات الحقيقية
`openrouterCatalog.ts` و`costs.ts` و`ctx.ts` في حزمة واحدة عبر esbuild، وحقنتُ
بيانات OpenRouter بصيغة حقيقية لثلاثة نماذج (مليون / 100 ألف / 200 ألف توكن)
بأسعار عشرية مختلفة ودقيقة لكل نموذج، ثم شغّلت الدوال الحقيقية — ليس مجرد فحص
نصي.

- **طول النافذة والسعر من المزود نفسه لكل نموذج**، مع `fetchedAt` و`sourceUrl`
  — لا قيمة مُجمّلة ولا افتراضية عند توفر الكتالوج الحي.
- **نموذج المليون لا يُعامل كـ 200k في أي مسار** (المحرك، الكرة، الحلّ المشترك).
  100k = 10% بلا ضغط، و900k = 90% جاهز للضغط.
- **الحساب BigInt بدقة 10^-12 دولار**: إدخال/إخراج/قراءة كاش/كتابة كاش منفصلة
  وصحيحة، بلا انزلاق عشري ولا احتساب مزدوج. المجهول يبقى مجهولاً بلا سعر مختلق.
- **المقدّر التقديري واعي للخط**: العربية ≈2 حرف/رمز، وكل رقم تقديري موسوم `≈`،
  ولا تظهر نسبة 100% مزيفة حين تكون النافذة مجهولة.
- **مُحفّز الضغط الثابت 120k/10k لم يعد يعمل**: الثابت 120k ما زال موجوداً كتعريف
  ميت غير مستخدم، ورقم 10k المتبقي يحدد حجم الذيل فقط بعد تفعيل الضغط الحقيقي.

**التحذير الصادق:** «من المزود» يتطلب fetch ناجحاً بمفتاح OpenRouter؛ عند الفشل
يرجع التطبيق للجدول المحلي أو للافتراض `≈200k` **بوضوح وأمانة** (موسوم
`source` / `≈`) — لا يدّعي أنه رقم المزود. ولا يوجد tokenizer حقيقي، لذا كل ما
قبل تقرير المزود تقديري وموسوم. الفاتورة النهائية هي للمزود.

---

## Files / الملفات

| File | Role |
| --- | --- |
| `tests-v1136-context-precision.mjs` | 13 independent behaviour + source tests (root script) |
| `docs/CONTEXT-PRECISION-V1136.md` | This verdict |
| `electron/services/openrouterCatalog.ts` | `parseOpenRouterModels` `:163`, `openrouterContextFor` `:285`, `openrouterPriceFor` `:333`, test hooks `:354-359` |
| `electron/agent/costs.ts` | `contextWindowInfo` `:493`, `resolvePrice` `:552`, `resolveModelInfo` `:624`, `estimateCostExact` `:705` |
| `src/lib/ctx.ts` | `ctxFillTokens` `:93`, `compactionThresholdTokens` `:140`, `contextFillPercent` `:159`, `estimateTokensFromText` `:241`, `formatContextBreakdown` `:413` |
| `electron/agent/engine.ts` | window resolution `:4866-4869`, real-window compaction gate `:5104-5132` |
| `electron/ipc.ts` | `kdx:model:info` catalog-first `:681-698` |

## Reproduce / إعادة التحقق

```powershell
cd "D:\New folder (58)\SADEEM-v11.12.0-source\src-pkg-v1112\sadeem-v11.12.0"
node --test --test-force-exit tests-v1136-context-precision.mjs
# expected: # tests 13 / # pass 13 / # fail 0
```

No source files were modified by this verification; the temporary esbuild
bundle is removed on exit.
