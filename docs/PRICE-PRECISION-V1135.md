# PRICE PRECISION — v11.35 (PRICE-1) / دقة الأسعار

> "لكل نموذج ذكاء اصطناعي انا لاحظت الكونتكست لينس غير دقيقة، لا في احتساب التوكن
> ولا باحتساب السعر. هذه المعلومات يجب أن تكون دقيقة جدا، جايبها من المصدر،
> دقة حرفية دقيقة جدا، عشان ما تصير في مشاكل، ودقيقة هيك ومتتابعة."

## EN — what changed

Per-model price and context window are now resolved **once**, from the **same
source**, for both the engine (cost metering / compaction) and the orb
(`kdx:model:info`). The old hardcoded-only lookup is now the **fallback**, not
the authority.

### Source priority (per id)

1. **LIVE OpenRouter catalog** — `GET https://openrouter.ai/api/v1/models`
   - API docs: <https://openrouter.ai/docs/api-reference/list-available-models>
   - Prices are **USD-per-token strings**: `pricing.prompt`,
     `pricing.completion`, `pricing.input_cache_read`,
     `pricing.input_cache_write` (the last two are reported by the router for
     cache-capable models; verified on the live catalog 2026-11-21).
   - Fetched with a 12s timeout and a 10-minute module cache
     (`openrouterCatalog.ts:86`, `:89`).
   - Lookup is **exact full router id** (case / `.` / `:` normalized; vendor
     prefix KEPT). A bare id is accepted only when exactly one live row has
     that suffix — no coin-flip between vendors. **No prefix matching** is
     done on live prices: `anthropic/claude-sonnet-5.5-fast` cannot inherit
     `anthropic/claude-sonnet-5.5`'s rate.
2. **Curated table** (`RATES`, `CONTEXT_WINDOWS` in `costs.ts`) — offline
   fallback, pinned to vendor price pages:
   - <https://www.anthropic.com/pricing>, <https://openai.com/api/pricing>,
     <https://ai.google.dev/pricing>, <https://api-docs.deepseek.com/quick_start/pricing>,
     <https://docs.x.ai/>.
   - Prefix matching is **boundary-safe**: the remaining id must start with
     `-` (so `o3mini` is NOT `o3`, `gpt-6-1-terra-x` is NOT `gpt-6-1-terra`).
3. **UNKNOWN** — `resolvePrice()` returns `unknown: true` with **null** rates
   and no timestamp. No number is invented (§ Honesty).

### Traceability

`resolvePrice()` / `resolveModelInfo()` return `source` (`openrouter-live` |
`curated` | `unknown`), `matchedId`, `sourceUrl`, and `fetchedAt` — an ISO
timestamp of the catalog fetch that supplied that exact number. The legacy
`priceFor()` carries the same fields as optional properties, so the orb can
display provenance without changing its contract.

### Exact formula / الصيغة بالضبط

Let `P`, `C`, `R`, `W` = USD-per-**token** rates for prompt, completion,
cache-read, cache-write. Let `f` = fresh input tokens (input **excluding**
cache reads and cache creations — they are a subset of the prompt, not extra
tokens), `r` = cache-read tokens, `w` = cache-write tokens, `o` = output tokens:

```
costUsd = f×P + r×R + w×W + o×C          // per-token form
        = (f/1e6)×pM + (r/1e6)×rM + (w/1e6)×wM + (o/1e6)×cM   // per-1M form
```

- No float multiplication of rates: every rate is parsed from its exact
  decimal string into `n / 10^scale` and accumulated as a **BigInt** in
  `1e-12 USD` units (`costs.ts:255`, `:283`, `:316`). Conversion to a JS
  number happens **once**, after the sum, with half-up rounding at 1e-12.
- Input and output rates are always taken from the same row/version; a
  partial live row (only `prompt`) is **discarded**, never patched with a
  curated completion rate.
- If the router reports no cache rates, they are derived **from that same
  row** (`read = 10% × P`, `write = 125% × P`) and flagged
  `cacheRatesDerived: true`.
- The four segments in `estimateCostExact().parts` are disjoint and sum to
  `costUsd` — cache tokens are never billed at the full input rate as well.

Example (live fixture, `anthropic/claude-sonnet-5.5`):
`P=0.000002`, `C=0.00001`, `R=0.0000001`, `W=0.0000025`.
`f=500,000, r=200,000, w=50,000, o=100,000` →
`1.00 + 0.02 + 0.125 + 1.00 = $2.145` exactly (not `2.525` — the input rate
was not used for cache reads).

### Honesty / الأمانة

- Unknown id → `source: 'unknown'`, `unknown: true`, all `perToken` /
  `perMillion` rates `null`, `estimateCostExact()` cost `0`.
- `-1` (OpenRouter dynamic-router sentinel, e.g. `openrouter/auto`) is
  **unknown**, not `$0 / free`. `:free` with reported `0/0` is genuinely free.
- **Legacy compatibility:** `priceFor()` still returns the historical
  conservative `$3/$15` for an unknown id, but flagged `unknown: true`,
  `source: 'unknown'`, `estimated: true`. It exists only so the picker never
  mislabels an unknown **paid** model as "free" and so the engine's
  `costUsd === 0 ⇒ "no provider usage"` heuristic keeps working. It is
  **not** presented as a known price; precision-critical code must use
  `resolvePrice()` / `estimateCostExact()`.
- Not modelled: long-prompt `pricing.overrides`, batch `:batch` discounts,
  `input_cache_write_1h`, non-USD components (`image`, `audio`, `request`,
  `web_search`), and tax. This is an **estimate**; the provider invoice wins.

## عربي — ملخص

- السعر وطول النافذة يُحلّان **مرة واحدة** من **نفس المصدر** — كتالوج
  OpenRouter الحي أولاً (نص عشري حرفي لكل رمز)، ثم الجدول المحلي، ثم
  «غير معروف» بلا رقم مختلق.
- المعادلة: `تكلفة = جديد×سعر_إدخال + قراءة_كاش×سعر_قراءة +
  كتابة_كاش×سعر_كتابة + إخراج×سعر_إخراج`. كل الحساب BigInt بدقة `10^-12`
  دولار — لا ضرب عشري عائم، ولا خلط بين سعر الإدخال والإخراج، ولا احتساب
  الكاش مرتين.
- تطابق المعرّف **تام** مع بقاء بائع النموذج (vendor prefix)، ومطابقة
  الجدول المحلي تحترم حدود `-` — نموذج مليون لا يأخذ سعر نموذج آخر.
- كل رقم يحمل ` fetchedAt` و`sourceUrl` و`matchedId` — قابل للتتبع.
- المجهول يبقى مجهولاً (`null`)؛ القيمة الاحتياطية القديمة موسومة
  `unknown: true` ولا تُقدَّم كسعر معروف.

## Files / الملفات

| File | Key symbols |
| --- | --- |
| `electron/services/openrouterCatalog.ts` | `OpenRouterPrice` `:30`, `parseOpenRouterModels` `:163`, `openrouterPriceFor` `:333`, test hooks `:354`–`:359` |
| `electron/agent/costs.ts` | decimal helpers `:255`–`:330`, `curatedMatch` `:471`, `contextWindowInfo` `:493`, `resolvePrice` `:552`, `resolveModelInfo` `:624`, `priceFor` `:646`, `estimateCostExact` `:705`, `estimateCostDetailed` `:739` |
| `tests/v1135-price-precision.test.mjs` | 12 tests over a real-shaped payload (fixture parsed by the real parser) |

## Verification / التحقق

```
npx tsc -p tsconfig.node.json --noEmit                     # clean
node --test --test-force-exit tests/v1135-price-precision.test.mjs \
  tests/v1134-context.test.mjs tests/v1134-context-guard.test.mjs \
  tests/v1110-usage.test.mjs tests/v1111-providers-context.test.mjs \
  tests/v1131-provider-services.test.mjs                   # 77/77 pass
```

`v1131-costs` does not exist in this tree. `v2-verify.mjs` fails in this
Windows sandbox for an unrelated pre-existing reason (it spawns
`./node_modules/.bin/esbuild` via `spawnSync`, which is a POSIX shim); the
same esbuild version is used successfully via `require('esbuild')` by every
other suite, including v1135.
