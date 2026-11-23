# v11.40 — Usage Panel Precision & De-duplication
# v11.40 — دقة صفحة الاستخدام وإزالة التكرار

---

## 1. The blunt verdict / الحكم الصريح

**EN:** Yes — for every figure this panel renders, there is now **one** authoritative place and **one** source chain. No figure is shown twice. Every **price** comes from the same resolver the orb uses (`api.modelInfo` → `resolveModelInfo`/`priceFor`), and unknown prices say `unknown` with **no invented $3/$15**. Every **per-message / per-model token count** comes from raw provider fields through `fromProviderUsageReport` → `ctxFillTokens`. A session total that is **not** backed by reconciled provider rows is now marked `≈` instead of being presented as exact. The two remaining *derived* figures are labelled: monthly projection `≈` and cache-saving `≈`.

One honest caveat remains **upstream, outside my file** (see §6): the store's stale-metadata fallback does not set an `estimated` flag. The panel now compensates locally, but the underlying flag should be fixed by the parent in `src/store.ts`.

**AR:** نعم — كل رقم تعرضه هذه الصفحة له الآن **مكان واحد** و**سلسلة مصدر واحدة**. لا يوجد رقم مكرر. كل **سعر** يأتي من نفس المحلّل الذي يستخدمه المدار (`api.modelInfo` → `resolveModelInfo`/`priceFor`)، والسعر غير المعروف يُعرض `unknown` **بدون أي $3/$15 مُختلَق**. كل **عدد توكن لكل رسالة/نموذج** يأتي من حقول المزوّد الخام عبر `fromProviderUsageReport` → `ctxFillTokens`. وإجمالي الجلسة غير المدعوم بصفوف مزوّد متطابقة يُوسَم الآن بـ `≈` بدل أن يُقال إنه دقيق. الرقمان المشتقّان المتبقيان موسومان: التوقع الشهري `≈` ووفр الكاش `≈`.

هناك تحفّظ صادق واحد **خارج ملفي** (انظر §6): المسار الاحتياطي في المتجر لا يضيف علم `estimated`. الصفحة تعوّض ذلك محلياً، لكن العلم نفسه يجب إصلاحه من الأب في `src/store.ts`.

---

## 2. De-duplication — what was removed / إزالة التكرار

| Before | After | Exact location |
|---|---|---|
| The 14-day cost data was drawn **twice**: the beautiful `UsageChart` (FIG. 02) **and** a second `usage-bar` strip with the same tooltips. | The second strip is deleted. The lower card is a single authoritative summary ribbon that points to the one chart. | `src/components/panels/UsagePanel.tsx:698` (kept chart), `:1014`–`:1045` (new single summary) |
| Cache-read tokens shown **twice**: `CACHE n` stamp in "This session" **and** "Cache-read tokens" in TokenEconomyCard. | One figure, in TokenEconomyCard. | `src/components/panels/UsagePanel.tsx:911` (stamp removed), `:282` (authoritative row) |
| Today's runs printed **twice**: the StatRow and the meter caption `{today.runs} · avg …`. | Caption shows only `avg …`. | `src/components/panels/UsagePanel.tsx:835`–`:838` |

The kept chart was not touched (`:461`, `:698`) — FIG. 02 is intact. No data was invented to fill the lower card; all four stamps reuse `avgDayCost`, `projectedMonth`, `windowRuns`, `windowTokens` already computed from the same `usageLog` rows the chart plots (`:611`–`:617`), and the honest empty state is preserved.

---

## 3. Precision chain — every figure's source / سلسلة الدقة

| Figure | Source (exact file:line) | Honesty |
|---|---|---|
| Active-model input/output/cache rates | `UsagePanel.tsx:560` `priceViewFromModelInfo(await api.modelInfo(id))`; widened from the runtime payload at `:90`–`:116`; rendered at `:720`–`:731` | Resolver rates only; hidden entirely when `unknown` |
| Per-message tokens & cost | `:155` `messageUsage` → `:159` `fromProviderUsageReport`; `:339`–`:365` `perMessageRows`; rendered `:988`–`:995` | `≈` from `usageMark(src)` at `:166`, driven by `tokenCountSource` |
| Per-model tokens & cost | `:189`–`:234` `buildModelBreakdown` from the real attempt ledger; catalog cross-check via `:140` `priceCostUsd`; rendered `:1059`–`:1090` | `unpriced → unknown`; `estimated → ≈` |
| Session tokens / cost | `:581`–`:597` (`rowsReconcile`, `sessionEstimated`); rendered `:893`–`:910` | `≈` when an estimate is anywhere in the chain **or** the total is not backed by reconciled rows |
| Today / 14-day window | `usageLog` (device-recorded real usage), source label at `:810`, derived stamps at `:611`–`:617`, `:1014`–`:1045` | Log source stated; `≈ PROJ/MO` because it is an extrapolation |
| Cache hit rate / saved tokens | `:264`–`:286`, from provider-reported cache split | `savedTokens` is `cached × 0.9` → marked `≈` (`:286`); no cache → `—` |

No literal rate is hardcoded in the panel. `priceCostUsd` (`:140`–`:153`) returns `0` for an unknown price instead of substituting a fallback rate; `priceViewFromModelInfo` treats a real free tier (`$0/$0`) as *known*, never as unknown.

---

## 4. Honesty markers actually tested / علامات الصدق المُختبرة

- `≈` — estimated or derived figure (per-message, session, cache saving, monthly projection).
- `—` — no data (`usageMark('none')`), e.g. empty input/output or zero cache.
- `unknown` / `غير معروف` — unknown model price/count; explicit banner at `:746`–`:750`.

Test: `tests/v1140-usage-precision.test.mjs` — real esbuild bundle + real store + SSR:
1. provider-exact fixture (`12,482 / 700`, 3,000 cache) → exact tokens, resolver rates, resolver cost to the micro-dollar;
2. duplicated rows gone (one `<UsageChart>`, zero `usage-bar`, one cache figure, one runs figure);
3. estimates carry `≈` (including unbacked session total and `≈ 2,700` cache saving);
4. unknown model → honest `unknown`, **no** fabricated rate row.

---

## 5. Verification — all green / التحقق — كلها ناجحة

```
npm run typecheck                                   # tsc --noEmit + tsconfig.node → PASS
node --test --test-force-exit tests/v1140-usage-precision.test.mjs        # 4/4 PASS
node --test --test-force-exit tests/v1110-usage.test.mjs                  # 6/6 PASS
node --test --test-force-exit tests/v1136-usage-flows-schedule.test.mjs   # 6/6 PASS
node --test --test-force-exit tests/v1131-ui-run.test.mjs                 # 18/18 PASS (extra SSR guard)
```

---

## 6. Hand-off to parent — one upstream gap / تسليم للأب — ثغرة أصلية واحدة

**`src/store.ts:3148–3149`** — in `loadSession`, when no per-message usage footer exists but the saved session has `totalTokens`/`totalCostUsd`, the store falls back to:

```ts
sessionUsage = { inputTokens: metaTokens, outputTokens: 0, costUsd: metaCost };
```

That object has **no `estimated: true`** and loses the cache split and output split, so any downstream consumer other than this panel will treat stale metadata as exact. I could not edit `store.ts` (ownership boundary). The panel now compensates at `UsagePanel.tsx:589–597` by marking the total `≈` whenever it is not reconciled by real rows, but the correct fix belongs to the store: set `estimated: true` on that fallback object (and ideally preserve the split as unknown rather than `0`).

No engine, cost, catalog, api, i18n, or other-panel file was modified.

---

## 7. Files touched / الملفات المعدّلة

- `src/components/panels/UsagePanel.tsx` (modified — de-dup + precision)
- `tests/v1140-usage-precision.test.mjs` (new)
- `docs/USAGE-PRECISION-V1140.md` (new — this file)
