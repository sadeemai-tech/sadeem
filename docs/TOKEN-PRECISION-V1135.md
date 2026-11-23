# TOKEN PRECISION — v11.35
# دقّة احتساب التوكن — v11.35

> Founder's requirement / مطلب المؤسّس:
> «لكل نموذج ذكاء اصطناعي انا لاحظت الكونتكست لينس غير دقيقة، لا في احتساب التوكن
> ولا باحتساب السعر. هذه المعلومات يجب أن تكون دقيقة جدا، جايبها من المصدر،
> دقة حرفية دقيقة جدا»
>
> Scope: `src/lib/ctx.ts`, `src/components/ContextLens.tsx`,
> `tests/v1135-token-precision.test.mjs`, this document. No engine/cost/catalog/store file was edited.
> النطاق: ملفّان فقط + اختبار + هذا المستند؛ لم يُعدَّل محرّك ولا جدول أسعار ولا متجر.

---

## 1. BLUNT VERDICT — الحكم الصريح

| Claim | Verdict | Evidence |
|---|---|---|
| Token counts shown from a real BPE tokenizer | **NO — impossible in this build.** There is no `tiktoken` / `js-tiktoken` / `gpt-tokenizer` dependency in `package.json`, `package-lock.json` or `node_modules` (only unrelated `js-tokens`, `*-separated-tokens`). Every pre-report number is an **estimate** and is labelled `≈`. | `package.json:13-34`, `package.json:53-68`; guard `tests/v1135-token-precision.test.mjs:69-81` |
| Token counts from provider `usage` are exact and unlabelled | **YES.** Raw `prompt_tokens` / `completion_tokens` / `cache_read` / `cache_write` map verbatim onto `inputTokens` / `outputTokens` / cache segments; cache stays **inside** the prompt (no double count). | `src/lib/ctx.ts:65-76`, `src/lib/ctx.ts:93-95` |
| Estimated figures are never presented as exact | **YES after this change.** The old formatter marked only fill/window and printed `Remaining`, `Cache`, `Session total` as exact; now **every** estimated figure carries its own `≈`. | `src/lib/ctx.ts:413-454`; `src/components/ContextLens.tsx:149-155, 528-529, 543-544` |
| Arabic / CJK are measured honestly | **YES for estimates.** Arabic ≈2 chars/token, CJK ≈1.5, Latin ≈4; same Arabic text that `chars/4` called 4 tokens is now 7. | `src/lib/ctx.ts:210-249`; guard `tests/v1135-token-precision.test.mjs:139-155` |
| Price is exact | **Exact tokens × catalog price only.** No provider invoice exists in the renderer. If the catalog price is stale, the cost is stale — out of scope for this agent (costs.ts / openrouterCatalog.ts are owned elsewhere). When tokens are estimated the cost row gets `≈`. | `src/components/ContextLens.tsx:543-544`; `src/lib/ctx.ts:359-360, 428-435` |
| Never a false 100% / honest "window unknown" | **YES.** Unknown or outgrown `≈` window ⇒ token count + `NO WINDOW`, empty arc; no catalog entry gets an explicit "window unknown" row. | `src/components/ContextLens.tsx:146-150, 189, 278-285, 462-466` |

**Arabic:** لا يوجد مُرمّز BPE حقيقي في هذه النسخة، لذلك أي رقم قبل تقرير المزوّد هو **تقدير** ويُوسَم بـ `≈`، ولا يُعرض كرقم دقيق. الأرقام الدقيقة تأتي حصرًا من `usage` الذي يرسله المزوّد (`prompt_tokens` / `completion_tokens` / `cache_read` / `cache_write`)؛ الكاش يُحتسب **داخل** الرمز ولا يُضاف مرّة ثانية. التقدير صار مراعيًا لنوع الحروف: العربي ≈2 حرف/رمز، والصيني الياباني الكوري ≈1.5، واللاتيني ≈4. السعر = توكن دقيق × سعر الكتالوج؛ لا توجد فاتورة من المزوّد، وإذا كان سعر الكتالوج قديمًا فالتكلفة قديمة، وهذا خارج نطاق هذا الملف.

---

## 2. SOURCE CHAIN — سلسلة المصدر

### 2.1 Context window (النافذة) — read-only audit
`electron/ipc.ts:681-698` (`kdx:model:info`) resolves, in order:
1. `openrouterContextFor(id)` — provider-reported live catalog;
2. `contextWindowInfo(id)` — curated per-model table;
3. honest 200k default with `ctxEstimated: true`.

→ `electron/preload.ts:195` → `src/components/ContextLens.tsx:109-127` (`api.modelInfo(model.model)`) → `ctxWindow` / `ctxWindowEstimated` → `contextFillPercent()` at `src/lib/ctx.ts:159-172`.
An id matching no catalog row keeps `ctxEstimated: true`: the lens shows `≈ 200,000` and the popover says **"Window unknown for this model — 200k default"**. When no window number exists at all (`ctxWindow <= 0`) the lens shows tokens + **"NO WINDOW"** and an explicit "window unknown — no catalog entry" row (`ContextLens.tsx:462-466`). A percentage is never clamped to a fabricated 100% (`src/lib/ctx.ts:159-172`).

### 2.2 Token counts (التوكن) — read-only audit
- Anthropic family: `electron/agent/providers.ts:1531-1544, 1603-1609` — `input_tokens` plus `cache_read_input_tokens` + `cache_creation_input_tokens`, cache folded into input.
- OpenAI-compatible family: `electron/agent/providers.ts:2155-2164` — `prompt_tokens` / `completion_tokens`, with `prompt_tokens_details.cached_tokens` inside the prompt.
- Engine finalizes the turn: `electron/agent/engine.ts:4390-4391` (`message_end` carries the per-turn delta).
- Store keeps it: `src/store.ts:4378` (`lastTurnUsage: { ...usage }`).
- Lens consumes it: `src/lib/ctx.ts:93-95` (`ctxFillTokens = inputTokens + outputTokens`) — cache never added again; `occupancySegments()` at `src/lib/ctx.ts:187-198` splits ONE fill into disjoint parts.

`fromProviderUsageReport()` (`src/lib/ctx.ts:65-76`) is the explicit adapter for the raw provider names; `tokenCountSource()` (`src/lib/ctx.ts:81-84`) classifies the result as `provider` / `estimated` / `none` and drives the `≈` decision.

---

## 3. ACCURACY TABLE — جدول الدقّة

### English

| Displayed value | Source | Exact? | Marker | Why |
|---|---|---|---|---|
| Fill tokens (`used`) after a completed turn | provider `prompt_tokens` + `completion_tokens` | **Exact** | none | Provider counted them with its own tokenizer; `inputTokens` already contains cache. `ctx.ts:65-76, 93-95` |
| Cache read / cache write | provider `cache_read` / `cache_creation` | **Exact** | none | Segments of the prompt, not additions. `ctx.ts:187-198` |
| Fill percentage (orb arc + centre) | exact fill ÷ catalog/provider window | **Exact** (unrounded for arc) | none | `contextFillPercent()` never clamps an outgrown estimate into 100%. `ctx.ts:159-172`; `ContextLens.tsx:146-189` |
| Context window | provider live catalog → curated table | **Exact** when a row exists | none | `kdx:model:info`; `ipc.ts:681-698` |
| Context window for unknown model | honest 200k default | **Estimated** | `≈` | No catalog entry; flagged `ctxEstimated: true` |
| Live streaming tail | `liveStreamChars` counter × script rate | **Estimated** | `≈` | No provider number exists mid-stream; renderer receives a char count, not text. `ctx.ts:258-276`; `ContextLens.tsx:137-140` |
| Engine fallback usage (`estimated: true`) | chars-per-token heuristic in engine | **Estimated** | `≈` | Provider reported no usage; `tokenCountSource()` classifies it. `ctx.ts:81-84` |
| Remaining budget | window − shown fill | **Exact only if both inputs are exact** | `≈` when either is estimated | `ctx.ts:336-339`; breakdown `ctx.ts:425` |
| Session total / session cost | cumulative runs × catalog price | **Exact tokens; catalog-price bound** | `≈` when any turn was estimated | No provider invoice in renderer. `ContextLens.tsx:153, 529, 543-544` |
| Copy breakdown | same numbers as the lens | **Same** | per-field `≈` | `formatContextBreakdown()` marks every estimated figure and prints its source. `ctx.ts:413-454` |

### العربية

| القيمة المعروضة | المصدر | دقيقة؟ | العلامة | السبب |
|---|---|---|---|---|
| التوكن المستخدَم بعد اكتمال الدورة | `prompt_tokens` + `completion_tokens` من المزوّد | **دقيقة** | لا شيء | المزوّد عدّها بمُرمّزه الخاص، والكاش داخل الإدخال أصلًا. |
| قراءة/كتابة الكاش | `cache_read` / `cache_creation` من المزوّد | **دقيقة** | لا شيء | أجزاء من الإدخال وليست إضافةً له. |
| نسبة السياق (القوس والرقم) | التوكن الدقيق ÷ نافذة الكتالوج | **دقيقة** (غير مُقرَّبة للرسم) | لا شيء | لا يُجبر الرقم على 100٪ كذبًا عند تجاوز نافذة تقديرية. |
| حجم النافذة | كتالوج المزوّد المباشر ← الجدول المُعدّ | **دقيقة** عند وجود سجل | لا شيء | `kdx:model:info`. |
| نافذة نموذج غير معروف | الافتراضي 200 ألف | **تقديرية** | `≈` | لا يوجد سجل؛ العلامة `ctxEstimated: true`. |
| الذيل أثناء البثّ | عدّاد الحروف × معامل نوع الخط | **تقديرية** | `≈` | لا يوجد رقم من المزوّد قبل الاكتمال، والمتجر يرسل عدد حروف لا النص. |
| استخدام المحرّك الاحتياطي | تقدير الحروف | **تقديرية** | `≈` | المزوّد لم يُبلغ عن استخدام؛ يُصنَّف `estimated`. |
| المتبقي | النافذة − المستخدم | **دقيقة فقط إذا كان المدخلان دقيقين** | `≈` عند التقدير | نفس منطق الحساب. |
| إجمالي الجلسة / التكلفة | المجاميع × سعر الكتالوج | **توكن دقيق؛ السعر من الكتالوج** | `≈` عند أي تقدير | لا توجد فاتورة من المزوّد في الواجهة. |
| النسخة النصية | نفس أرقام العدسة | **نفسها** | `≈` لكل رقم تقديري | تُوسم كل قيمة على حدة ويُذكر مصدرها. |

---

## 4. AUDIT — every approximation that was presented as exact

| # | Before (approximate but unlabelled) | After (this change) |
|---|---|---|
| 1 | `estimateTokensFromChars()` used `chars/4` for every language; Arabic/CJK badly undercounted. | Script-aware `estimateTokensFromText()` + `estimateTokensFromChars(chars, script)`; rates 4 / 2 / 1.5 (`src/lib/ctx.ts:210-264`). |
| 2 | Lens passed `liveStreamChars` with no language context. | `rtl ? 'arabic' : 'latin'` profile from the UI language (`src/components/ContextLens.tsx:140`). |
| 3 | Popover printed `pctExact.toFixed(1)` with no `≈` even when the fill was estimated. | `≈` prefix on both the stats small-print and the Context row percentage (`ContextLens.tsx:420-434`). |
| 4 | `formatContextBreakdown()` marked only fill/window; `Remaining`, `Cache`, `Session total` looked exact. | Per-figure `mark()` + explicit `Source:` line (`src/lib/ctx.ts:413-454`). |
| 5 | Streaming note said "chars/4" though the estimate is now script-aware. | Replaced with a bilingual script-aware note (`ContextLens.tsx:52-64, 448-452`). |
| 6 | No state distinguished provider-reported numbers from engine estimates in the lens. | `tokenCountSource()` + `sourceKey` row ("Exact — provider reported usage" / "Estimated — …") (`ContextLens.tsx:137, 155-157, 431-436`). |
| 7 | Session total and cost printed exact even when a turn was an estimate. | `≈` on both (`ContextLens.tsx:153, 528-529, 543-544`). |
| 8 | No explicit row when a model had no catalog window. | "Window unknown — no catalog entry" row (`ContextLens.tsx:462-466`). |

---

## 5. HONEST LIMITATIONS — الحدود الصريحة

1. **No real tokenizer.** A byte-pair encoding cannot be reproduced by character heuristics. The `≈` marker is not cosmetic: it is the only truthful label available. When a tokenizer dependency is added, `estimateTokensFromText()` is the single seam to replace (`src/lib/ctx.ts:241-249`).
2. **Script-blind live counter.** `src/store.ts:4191,4201` exposes only `liveStreamChars` (owned by another agent, not edited). The lens uses the UI language as a proxy for the streamed language; a mixed-language answer may still be off. It stays `≈`.
3. **Catalog price, not invoice.** Cost = tokens × catalog price. Price freshness belongs to `costs.ts` / `openrouterCatalog.ts` (other agents' files).
4. **Window default.** Unknown models get `≈ 200,000`; the popover says "window unknown" and will not print a clamped 100% if that default is outgrown.
5. **Bilingual rule.** Every UI label emits one language only — `[en, ar]` tuples in `ContextLens.tsx:52-64`, and a `lang` switch in `src/lib/ctx.ts:375-411`. No Arabic+English prose is mixed inside one string.

---

## 6. VERIFICATION — التحقّق

Commands run from the workspace root:

```
npx tsc --noEmit                                    # exit 0
node --test --test-force-exit tests/v1135-token-precision.test.mjs          # 9/9 pass
node --test --test-force-exit tests/v1134-context.test.mjs \
  tests/v1134-context-guard.test.mjs tests/v1121-context-orb.test.mjs \
  tests/v12-enhancements.test.mjs tests/v1111-providers-context.test.mjs \
  tests/a6-accuracy.test.mjs tests/v1110-usage.test.mjs                     # 84/84 pass
```

The new suite bundles the **real** `ctx.ts` and the **real** `ContextLens.tsx` + zustand store with esbuild and asserts the numbers above; it does not re-implement the math.

### Key file:line map

- `src/lib/ctx.ts:65-76` — `fromProviderUsageReport()` (raw provider names → exact usage).
- `src/lib/ctx.ts:79-84` — `TokenCountSource`, `tokenCountSource()`.
- `src/lib/ctx.ts:93-95` — `ctxFillTokens()` (prompt + generated, cache inside).
- `src/lib/ctx.ts:159-172` — `contextFillPercent()` (no false 100%).
- `src/lib/ctx.ts:210-249` — script rates, `detectTokenScript()`, `estimateTokensFromText()`.
- `src/lib/ctx.ts:258-276` — `estimateTokensFromChars(chars, script)`, `liveFillEstimate(..., script)`.
- `src/lib/ctx.ts:336-339` — `remainingContextTokens()`.
- `src/lib/ctx.ts:375-454` — bilingual breakdown text + per-figure `≈` markers + `Source:` line.
- `src/components/ContextLens.tsx:52-69` — bilingual `[en, ar]` label pairs + `lensText` export.
- `src/components/ContextLens.tsx:137-157` — source classification, script-aware live estimate, session `≈` state.
- `src/components/ContextLens.tsx:290-305` — copy breakdown receives `lang`, `sessionEstimated`, `source`.
- `src/components/ContextLens.tsx:431-466` — source row + streaming note + "window unknown" row.
- `src/components/ContextLens.tsx:528-544` — `≈` on session total and cost.
- `tests/v1135-token-precision.test.mjs:1-240` — 9 verification tests.
