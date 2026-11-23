# CONTEXT-FILL VERIFICATION GUARD — v11.34 / V1134
# حارس تحقّق نافذة السياق — الحكم: هل يمتلئ السياق فورًا؟

> **Diagnosis + test ONLY — no application source was edited by this guard.**
> تشخيص + اختبار فقط — لم يعدّل هذا الحارس أي ملف من ملفات التطبيق.
>
> Guard: `tests/v1134-context-guard.test.mjs` · Workspace `sadeem-v11.12.0` · As-of 2026-11-21 ~20:05 local.
> Method: `esbuild` bundles of the REAL `src/lib/ctx.ts`, `electron/agent/costs.ts`,
> `src/components/ContextLens.tsx` + REAL zustand store, `react-dom/server` SSR,
> plus `new Function(...)` evaluation of the REAL `electron/agent/engine.ts`
> expressions. No re-implementation of the math, no network, no app edits.

---

## 0. THE BLUNT VERDICT — الحكم الصريح

**Does "context fills instantly / compresses constantly on a 1M model" still reproduce?**
**هل ما زال «السياق يمتلئ فورًا / الواجهة تضغط السياق باستمرار على نموذج 1M» يتكرر؟**

| Surface | Verdict |
|---|---|
| **Source tree (after V11 / v11.34 landed)** | **NO — does not reproduce.** 18/18 guard checks pass, twice in a row. 100k on a 1M window reads exactly `10%`; auto-compaction is eligible only at `900k` (90% of the real window); unknown/outgrown windows never print a false `100%`. |
| **Packaged build currently sitting in `dist-electron/` + `dist-cli/`** | **YES / NOT FIXED IN THE ARTIFACT.** The built engine still carries the old `Math.floor(ctxWindowTokens * 0.65)` and catalog-only lookup — see FINDING D1. Until the app is rebuilt, the shipped binary still behaves like the buggy version. This guard tests **source**, not the stale artifact. |
| **Live real-provider session / human-visible pixels** | **UNVERIFIED.** No account, no network, no screenshot; SSR can prove markup and numbers, not what a human sees. |

**Arabic:** في **الكود المصدري** المشكلة **انتهت**—الاختبار 18/18 ناجح، 100 ألف على نافذة مليون تعطي 10٪، والضغط التلقائي لا يعمل إلا عند 900 ألف. أمّا **النسخة المبنيّة الموجودة في `dist`** فما زالت تستخدم الحدّ القديم 65٪ (أي 130 ألفًا على نموذج 1M)؛ لازم إعادة بناء (rebuild) قبل الإصدار. لم أتحقّق من جلسة حقيقية أو من شاشة فعلية.

**Verdict table — جدول الحكم**

| # | Required property | Verdict | Hard evidence |
|---|---|---|---|
| 1 | 1M window + 100k ⇒ ≈10% (not 50/100), no compaction; 900k ⇒ ≈90%, eligible | **PASS** | `src/lib/ctx.ts:101-110` (`contextFillPercent`), `:82-92` (`compactionThresholdTokens` / `isCompactionEligible`); tests CTX-1a/1b/1c, 3e, 4b |
| 2 | No cache double-count; window from provider catalog, not hard-coded 200k | **PASS** | `src/lib/ctx.ts:36-39,129-140`; `electron/agent/costs.ts:204,306,324`; `electron/ipc.ts:681-692`; `src/components/StatusBar.tsx:146`; `src/components/ContextLens.tsx:89-107`; tests CTX-2a/2b/2c/2d |
| 3 | Orb honest ≈ / unknown; no false 100% | **PASS** | `src/components/ContextLens.tsx:119-123,155`; tests CTX-3a…3f (SSR of the real component) |
| 4 | Compaction threshold uses the real window, not a fixed small count | **PASS (source)** | `electron/agent/engine.ts:32,4854-4860,5099`; `src/lib/ctx.ts:76-92`; tests CTX-4a/4b; **caveat D1** for the build |

---

## 1. What the guard really executes — ماذا ينفّذ الحارس فعليًا

`node --test --test-force-exit tests/v1134-context-guard.test.mjs`

- **18 subtests**, 0 fail, 0 skip; ~1–6 s. Two consecutive runs after the final source edits: **18/18, 18/18**.
- Bundles the **real** modules with esbuild (JS API, browser stubs installed before the store loads).
- SSR patch: zustand v5 reads `api.getInitialState()` for the server snapshot; the guard redirects
  `React.useSyncExternalStore`'s third argument to the live `getSnapshot`, so every seeded
  `{fill, ctxWindow, estimated, streaming}` combination actually renders.
- Compaction is checked by **evaluating the exact `const` lines lifted from `engine.ts`** with the
  real `costs.contextWindowInfo()` injected as `contextWindowInfo`, plus a simulated provider report
  injected as `openrouterContextFor`. This proves the gate uses the resolved real window, not a
  re-implementation written in the test.

Tests: `CTX-0` harness sanity · `CTX-1a…1d` math · `CTX-2a…2d` cache/window · `CTX-3a…3f` orb · `CTX-4a…4c` compaction. Every assertion failure message carries `file:line`.

---

## 2. Claim-by-claim — تحقق مطلباً بمطلب

### 2.1 Real math — الحساب الحقيقي

- `ctxFillTokens({inputTokens:100_000}) = 100_000`; `contextFillPercent(100_000, 1_000_000) = 10`.
  The guard asserts the value is **not 50 and not 100** — those were the reported symptom.
- Generated output joins the fill: `95k prompt + 5k output = 100k ⇒ 10%` (no "output missing" undercount).
- `900_000 / 1_000_000 = 90%`; `isCompactionEligible(900_000, 1_000_000) === true`;
  `isCompactionEligible(100_000, 1_000_000) === false`, and `130_000` (the old 65%-of-200k trigger)
  is also **false** on a 1M window.
- The same 100k on a genuine 200k window correctly reads 50% — the number follows the window,
  which is the whole point.
- Keys: `src/lib/ctx.ts:76` (`COMPACT_TRIGGER_RATIO = 0.9`), `:82`, `:88`, `:101`.

### 2.2 Cache & window — الكاش وحجم النافذة

- `ctxFillTokens` is exactly `inputTokens + outputTokens`; it never reads the cache fields
  (`src/lib/ctx.ts:36-39`). With `input 120k` (90k read + 20k write cache inside) `+ 5k output`,
  fill is `125k`, not `235k`. Provider folding lives at `electron/agent/providers.ts:1539,1609`.
- `occupancySegments()` (`src/lib/ctx.ts:129-140`) returns five **disjoint** parts whose sum is
  exactly the shown fill — cache inside prompt, generated as its own part, streamed as its own part.
  The previous bar painted `fill` **and** `generated` on top of it whenever no cache split existed.
- `contextWindowInfo('claude-sonnet-5.5') = {ctx:1_000_000, estimated:false}`. The guard checks a
  dozen 1M and 1M-class ids (Anthropic 5.x, DeepSeek V4, Qwen3-8/7, GLM-5, Kimi-K3, MiniMax-M3,
  GPT-6, Gemini-4). None returns the 200k fallback; unknown ids still get 200k **with** `estimated:true`
  so the UI marks it `≈` (`electron/agent/costs.ts:204,306,324`).
- Resolution chain: `kdx:model:info` prefers the live provider catalog then the table
  (`electron/ipc.ts:681-692`); `StatusBar` seeds `ctxWindow` from it (`src/components/StatusBar.tsx:146`);
  the orb now does the same fetch itself so focus mode / cold catalog cannot leave a stale 200k
  (`src/components/ContextLens.tsx:89-107`). `/context` divides the per-turn delta by that window
  (`src/store.ts:3740`, `:4378`), not by the cumulative session sum.

### 2.3 Orb honesty — صدق الكرة

Real SSR (not a text simulation) of `ContextLens` against the seeded store:

| Seed | Centre | Title / marker | Arc |
|---|---|---|---|
| 100k / 1M known | `10%` | exact `10.0%`, no `≈` | ~10% of 2πr |
| 100k / window unknown (0) | `100.0k` | `window size unknown` | 0 |
| 0 used / 1M | `—` | honest "nothing measured yet" | 0 |
| 50k / 200k `estimated` | `25%` | visible `≈` | 25% of 2πr |
| streaming on 1M | not `100%` | visible `≈` | from live estimate |
| 250k / 200k `estimated` (outgrown) | `250.0k` | `≈` | 0 — `contextFillPercent` returns `null` |

`const centerText = noData ? '—' : unknown ? fmtTokens(fillShown) : \`${ctxPct}%\``
(`src/components/ContextLens.tsx:155`); `unknown = realPct === null` (`:123`).
There is no code path that prints `100%` when there is still room.

### 2.4 Compaction threshold — حدّ الضغط التلقائي

- `engine.ts:4854-4860`: `reportedCtx = openrouterContextFor(model)` → `catalogCtx = contextWindowInfo(model)`
  → `ctxWindowTokens = Math.max(8_000, reportedCtx ?? catalogCtx.ctx)` →
  `compactTokenThreshold = compactionThresholdTokens(ctxWindowTokens)`.
  The guard evaluates those very lines: cold catalog ⇒ `1_000_000`; provider report `983_041` ⇒ `983_041`
  (provider wins). No literal `130_000` / `0.65` remains in source.
- `engine.ts:5099`: `realTokenTrigger = isCompactionEligible(lastRealInputTokens, ctxWindowTokens)`,
  fed by the provider's actual `u.inputTokens` (`engine.ts:5886`). The chars fallback and the
  displayed `pctBefore` both divide by `ctxWindowTokens` (`engine.ts:5103`), not a fixed count.
- `COMPACT_TRIGGER_RATIO = 0.9` ⇒ `compactionThresholdTokens(1_000_000) = 900_000`, `0 ⇒ 0`
  (unknown window never compacts). User-initiated `/compact` is a separate path and is not gated here.

---

## 3. Failures & findings with file:line — الملاحظات

**No failing assertions remain in the guard (18/18 pass).** Two real findings were observed during diagnosis:

1. **FINDING D1 — stale build artifacts (not fixed by the source patch).**
   `dist-electron/electron/agent/engine.js:4156` and `dist-cli/kodex.cjs:39228` still contain
   `const compactTokenThreshold = Math.floor(ctxWindowTokens * 0.65);`, and
   `dist-electron/electron/agent/engine.js:4152` still uses catalog-only
   `contextWindowFor(...) || 200_000`. The renderer bundle under `dist/assets/` is likewise older
   than the v11.34 `ContextLens.tsx`. Consequence: a shipped app without a rebuild **still** compacts
   a 1M model at 130k and can still show a lying meter. **Action: rebuild `dist` / `dist-electron` /
   `dist-cli` before release.** This guard deliberately tests source only; it does not mask D1.

2. **FINDING D2 — moving target during diagnosis.**
   Source files were still being written while this guard was authored:
   `src/components/ContextLens.tsx` (20:00), `src/lib/ctx.ts` (19:59), `electron/agent/engine.ts` (20:01).
   Intermediate snapshots showed `import { isCompactionEligible, … }` present before the call site was
   rewired, and an older `0.65` line coexisting briefly. The reported 18/18 is the **final snapshot**
   after those edits; re-run the guard after any further edit before shipping.

Transient guard-harness mistakes (wrong test expectations for 1.05M/1,048,576 catalog rows, SSR snapshot
defaults, streamed-segment arithmetic) were corrected in the **test file**; they were never app defects.

---

## 4. Epistemic limits — حدود المعرفة

- **SSR is not a screenshot.** The orb tests prove the markup, centre string, tooltip text and 2πr arc
  numbers the real component would produce for a seeded store. They cannot prove colour, layout,
  z-order, or what the founder actually sees.
- **No live provider** was contacted. Real `prompt_tokens` reporting, catalog freshness and the actual
  compaction event stream were not exercised end-to-end; the engine expressions were evaluated with
  the real catalog function and a simulated provider report.
- **The stale `dist` caveat (D1) is decisive for a user-facing verdict.** "Fixed in source" ≠ "fixed in
  the installed app" until the build is refreshed.

---

## 5. Reproduce — إعادة التشغيل

```powershell
cd "D:\New folder (58)\SADEEM-v11.12.0-source\src-pkg-v1112\sadeem-v11.12.0"
node --test --test-force-exit tests/v1134-context-guard.test.mjs
```

Expected after V11: `tests 18 / pass 18 / fail 0`. Any failure prints the exact `file:line` to fix.

## 6. الخلاصة

الشكوى **انتهت في المصدر**: الحساب 10٪ عند 100 ألف على نافذة مليون، لا ضغط تلقائي قبل 900 ألف،
الكاش لا يُحسب مرتين، والنافذة تُجلب من كتالوج المزوّد لا من رقم 200 ألف ثابت، والكرة تعرض
«—» أو عدد التوكنات أو «≈» بدل رقم 100٪ كاذب. لكن **النسخة المبنيّة قديمة** وتحتاج rebuild
وإلا سيبقى السلوك القديم ظاهرًا للمستخدم. لم أرَ شاشة حقيقية ولا جلسة مزوّد حيّة.
