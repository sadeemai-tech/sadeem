# COMPACTION ROOT CAUSE — v11.35 / V1135
# السبب الجذري لضغط السياق — الحكم الصريح

> Owner: `electron/agent/engine.ts` (compaction/context sections only) + `tests/v1135-compaction-root.test.mjs` + this doc.
> Diagnosis was read-only across the whole repo first. No file owned by another agent was edited.

---

## 0. THE BLUNT VERDICT — الحكم الصريح

**Does "compacts after two words" still reproduce in the source path I traced?**

**NO — not after this patch. YES — it DID reproduce before it, and the reason V11's green tests missed it is a second, OR'd trigger.**

| Surface | Verdict |
|---|---|
| **Source before V1135** | **YES, reproducible.** The 90% token gate was correct but was OR'd with a **fixed small char-count trigger** (`legacyCharsCap`, floor 10,000 chars ≈ 2,857 tokens = **0.29%** of a 1M window). Any provider turn with `u.inputTokens === 0` (OpenAI-compatible/local endpoints, early stream failures) left `lastRealInputTokens = 0`, so the fixed cap fired instead. V11's guards only asserted that `isCompactionEligible(...)` is *called*; they never exercised the `|| charsTrigger` branch. |
| **Source after V1135** | **NO.** The fixed cap is removed from the decision. The only chars fallback is derived from the real window (`compactTokenThreshold × 3.5` = 3,150,000 chars for 1M). Compaction now triggers **only** at ≥90% of the model's real window, provider report first, curated catalog second, honest 200k fallback last. |
| **Live human-visible pixels** | **UNVERIFIED** — no provider account, no network, no screenshot. My 15-test suite evaluates the real engine expressions and runs the real engine for the subagent cap, but it cannot observe the founder's screen. |
| **Stale standalone artifact** | `dist-electron/electron/agent/engine.js:4152-4156` STILL has `contextWindowFor(...) || 200_000` and `Math.floor(ctxWindowTokens * 0.65)` (130k on a 1M model). The Electron app actually loads the bundled `dist-electron/electron/main.js` (which has the 90% code), and `dist-cli/*.cjs` also has the new code — so this is a hygiene/rebuild handoff, **not** the live Electron path. |

**Arabic — بصراحة:** المشكلة كانت **موجودة فعلاً** قبل هذا الإصلاح. في11 أضاف بوابة 90٪ بس **ترك دائرة ثانية** تشتغل معها (OR): حدّ حروف ثابت 10,000 حرف ≈ 2,857 توكن = 0.29٪ من نافذة المليون. أي مزوّد ما يرجّع عدد توكنز (`u.inputTokens === 0`) كان العدّاد يبقى صفر ويتفعّل الحدّ الثابت — يعني ضغط بعد كلمتين بالضبط. اختبارات في11 كانت تتحقق إن دالة الـ 90٪ **مستدعاة** فقط، وما جرّبت فرع الـ `||` أبداً، فطلعت خضراء والعميل لسه يشكو. بعد في1135: الحدّ الثابت انشال من القرار، وما عاد في ضغط إلا عند 900 ألف من نافذة المليون. **ما رأيت شاشة حقيقية** — الحكم على المسار البرمجي.

---

## 1. EVERY COMPACTION / CONTEXT-EVENT PATH (enumerate first)

| # | file:line | What it does | Trigger? |
|---|---|---|---|
| 1 | `electron/agent/engine.ts:2550-2584` | User-initiated `/compact` task — one no-tools `streamTurn`, emits `compaction_done` (`:2554`, `:2584`). | **No** — separate user path, never auto-gated. |
| 2 | `electron/agent/engine.ts:4866-4872` | Real-window resolution: `openrouterContextFor` → `contextWindowInfo` → `Math.max(8_000, …)` → `compactionThresholdTokens`. | Resolution only. |
| 3 | `electron/agent/engine.ts:5066-5069` | `pruneOldToolResults()` before the gate — moves old blobs to recall vault. | Not compaction. |
| 4 | **`electron/agent/engine.ts:5116-5125`** | **AUTO-COMPACT GATE** — `realTokenTrigger \|\| charsTrigger`. | **THE decision.** |
| 5 | `electron/agent/engine.ts:5129-5133` | Verbatim-tail size (`tailCapChars`/`tailBudget`) + head/tail split; compaction SKIPPED when `head.length < 2`. | Size only, never a trigger after V1135. |
| 6 | `electron/agent/engine.ts:5177-5215` | The real no-tools summarizer `streamTurn` (heartbeat `phase:'compacting'`). | Effect. |
| 7 | `electron/agent/engine.ts:5285-5287` | Honest `compaction{before,after}` telemetry + `notice('compact', …)`. | Effect. |
| 8 | `electron/agent/engine.ts:5918` | `lastRealInputTokens = u.inputTokens` — feeds the gate (provider INPUT only; cache is inside it — no double count). | Input. |
| 9 | `electron/agent/engine.ts:5009-5030` | Wall-clock cap (wrap-up → `stop_reason:'time_cap'`), **disabled unless `SURNIA_MAX_RUN_MS` set**. | Not compaction. |
| 10 | `electron/agent/engine.ts:5869-5885` | Task-budget wrap-up (`taskBudgetCheck`), only when a budget is set. | Not compaction. |
| 11 | `src/lib/ctx.ts:75-92` | `COMPACT_TRIGGER_RATIO=0.9`, `compactionThresholdTokens()`, `isCompactionEligible()`. | Shared math. |
| 12 | `src/lib/ctx.ts:36-45,101-110` | `ctxFillTokens` (input+output, cache inside), `contextFillPercent` (no false 100%). | Display/telemetry. |
| 13 | `electron/agent/costs.ts:204-330` | `CONTEXT_WINDOWS` (1M rows) + honest 200k fallback (`estimated:true`). | Resolution. |
| 14 | `electron/agent/providers.ts:1539,1609` | Cache folded INTO `inputTokens`. | No double count. |
| 15 | `src/store.ts:3730-3756` | `/context` advisory uses `isCompactionEligible` — **advice only**, never compacts. | No. |
| 16 | `src/store.ts:4721,4794-4814` | Renderer handlers for `compaction` / `compaction_done` rows + toast. | Display only. |
| 17 | `electron/agent/vibeFlow.ts:475-565` | `contextBudget()` 60/80% pressure rule — **pure/advisory, NOT imported by engine.ts**. | No. |

**No "compact every N turns/messages" rule exists.** Search for `iter % … compact`, `messages.length … compact`: none. No second live threshold outside the gate.

---

## 2. WHAT THE FOUNDER ACTUALLY SEES (evidence per option)

| Option | Evidence | Verdict |
|---|---|---|
| (a) Engine truly auto-compacting | `compaction` event at `engine.ts:5285` + `notice('compact')` at `:5287`; the OR'd fixed cap at OLD `:5100-5102` fired when `u.inputTokens === 0`. | **YES — root cause.** |
| (b) False UI "full/compacted" | `src/lib/ctx.ts:101-110` returns `null` for unknown/outgrown windows; `ContextLens` shows tokens/`—`, never fabricated 100% (pinned by v1134-context 28/28). | No — orb is honest. |
| (c) Request-level token cap | `providers.ts:422-433` output budget ≤32k (`max_tokens`), not an input/compaction trigger. | No. |
| (d) System prompt + 145 tool defs counted as input | Measured by my test: 145 defs ≈ 95,118 chars (~27k tok) + system prompt ≈ 24,138 chars (~7k tok) = **~34k tok/turn**, re-sent via `body.tools = …` (`providers.ts:1692,2322`) and folded into provider `inputTokens`. Real and recurring, but only 3.4% of 1M — cannot by itself explain "two words" once the gate is fixed. | Contributing fill, **not the trigger**. |
| (e) Compact every N turns | None found (see §1). | No. |

---

## 3. ROOT CAUSE — exact file:line (before V1135)

```ts
// OLD engine.ts:5098-5105
if (cfg.autoCompact !== false && messages.length > 1) {
  const realTokenTrigger = isCompactionEligible(lastRealInputTokens, ctxWindowTokens); // 90% — CORRECT
  const legacyCharsCap = cfg.compactThreshold ? Math.max(10_000, Math.floor(cfg.compactThreshold)) : Infinity;
  const charsTrigger = lastRealInputTokens === 0 && transcript.chars >= Math.min(legacyCharsCap, …);
  if (realTokenTrigger || charsTrigger) { … }   // ← THE BUG: fixed small count OR'd in
```

- `cfg.compactThreshold` comes from `settings.agent.compactThreshold` via `agentTuning()` (`engine.ts:1455-1464`); UI minimum is 20,000 chars (`AgentSection.tsx:379`), code floor 10,000.
- `u.inputTokens === 0` is common: providers that omit `prompt_tokens`, or a turn whose usage was lost. `if (u.inputTokens > 0) lastRealInputTokens = u.inputTokens` (`:5918`) then never updates → the fallback owns the decision.
- Result: compaction at 10k–120k chars = 0.29–3.4% of a 1M window, i.e. "the AI barely said two words and off to the compressor".

**Why V11's tests stayed green:** `tests/v1134-context-guard.test.mjs:418-424` asserts only that `const realTokenTrigger = isCompactionEligible(lastRealInputTokens, ctxWindowTokens)` and `lastRealInputTokens = u.inputTokens` appear in source. It never asserts that the OR'd branch is absent, and its "real engine" guard (`tests/.v1135-compaction-guard.results.json`, C1) ran only 20 short turns with a provider that DID report usage — so `charsTrigger` was never exercised.

**Second finding:** `dist-electron/electron/agent/engine.js:4152-4156` still carries the pre-V11 `contextWindowFor(...) || 200_000` + `*0.65` (130k trigger). Handoff below.

---

## 4. FIXES APPLIED IN THIS OWNED FILE

### 4.1 Compaction root cause — `electron/agent/engine.ts`
- **`:5116-5125`** — removed `legacyCharsCap` and the fixed-count `charsTrigger`. New gate:
  - `windowCharsCap = Math.floor(compactTokenThreshold * CHARS_PER_TOKEN)` (`:5120`)
  - `charsTrigger = lastRealInputTokens === 0 && windowCharsCap > 0 && transcript.chars >= windowCharsCap` (`:5121`)
  - For 1M that fallback is **3,150,000 chars (900k tok)** — the real ceiling, not a fixed small count.
- **`cfg.compactThreshold` demoted** (`:5129-5131`): now bounds only the **verbatim tail after** the gate fires (`:5132`), so it can never decide *whether* to compact. This keeps `v1115-stress` (which sets `compactThreshold:10_000` to force a head/tail split) green.
- Kept intact: `openrouterContextFor` → `contextWindowInfo` → `Math.max(8_000, …)` (`:4866-4868`), `compactionThresholdTokens` (`:4872`), `realTokenTrigger` (`:5117`), provider input (`:5918`), honest telemetry (`:5285`).

### 4.2 C6 — `dedupeToolResults` wired live
- **`:24`** import from `./prompts`; **`:2573`** (single `/compact` call) and **`:5547`** (main loop) wrap outgoing `messages[]`. Pure/non-mutating: the stored transcript keeps full copies; only the provider payload shrinks; callIds/roles/order/first full copy preserved (test v1135-3b).

### 4.3 A3 — background-agent ceiling raised
- **`:769`** `BACKGROUND_SUBAGENT_CAP = 64` (was 4). Honest: this is a **high runaway-protection ceiling**, not "truly unlimited"; normal parallel work never reaches it. No cap added to the parallel-batch path.
- **`:6666-6672`** refusal summary now includes the number + next step ("Wait for one to finish, or start a new session") instead of the bare `BACKGROUND_LIMIT`.
- **`:1341-1344`** `backgroundSubagentCount()` (pre-check) unchanged.
- Behavioral test `v1135-7b` launches 12 real background agents through the real engine (old cap refused 8) and verifies the 64th is allowed, the 65th refused honestly.

### 4.4 A2 — strong models see all 145 tools
- **`:30` / `:75`** imports: `salientToolProfile` (modes) + `getProviderToolDefs` (providers).
- **`:2636`** `salientToolProfile(cfg.toolProfile, params.model.model)` replaces `advertisedToolProfile` → strong model gets `full` (145), weak default gets `core`, explicit setting wins.
- **`:2637`** `toolDefs = [...getToolDefs(enabledMcp, advertisedProfile), ...getProviderToolDefs()]` → provider-native tools appended to the advertised array.
- **`:5952-5956`** text-tool fallback `known` set now includes the full registry (`getToolDefs([], 'full')`) + provider tools, so a hidden-by-profile tool named in a ```surnia-tool fence is still parsed and dispatched.
- Profiles remain views only; dispatch resolves the full registry — zero capability loss.

---

## 5. VERIFICATION (actual runs, 2026-11-21)

```
npx tsc -p tsconfig.node.json --noEmit                         → PASS (no output)
node --test --test-force-exit --test-concurrency=1 \
  tests/v1134-all-tools.test.mjs \
  tests/v1135-all-provider-tools.test.mjs \
  tests/v1135-token-savings.test.mjs \
  tests/v1115-stress.test.mjs \
  tests/v1135-compaction-root.test.mjs \
  tests/v1134-context.test.mjs \
  tests/v1134-context-guard.test.mjs
  → tests 67 / pass 67 / fail 0
```
`v1135-compaction-root.test.mjs` alone: **15/15**. Re-run of the 7-file set with default concurrency three more times: **67/67 each** (one transient concurrency failure was observed once; `--test-concurrency=1` is deterministic).

---

## 6. HANDOFF TO PARENT — NOT EDITED (outside my ownership)

1. **Rebuild standalone stale artifact** — `dist-electron/electron/agent/engine.js:4152-4156` still contains `const ctxWindowTokens = Math.max(8_000, contextWindowFor(params.model.model) || 200_000)` and `const compactTokenThreshold = Math.floor(ctxWindowTokens * 0.65);`. Run `npm run build:electron` (and `npm run full` before release). Electron's actual entry `dist-electron/electron/main.js:41362-41367` already has the 90% code, and `dist-cli/*.cjs:39648` does too — so this is artifact hygiene, not the live Electron path.
2. **Live UX re-test required** — no account/screenshot here. After a fresh build, ask the founder to confirm the `compaction` row/notice no longer appears after short turns on the 1M model. If it still does, capture `compaction{before,after}` — a `before` near 90 indicates genuine growth; a `before` near 0 would mean an event source outside this traced path.
3. `src/components/settings/AgentSection.tsx:83` still defaults `compactThreshold: 120000` with UI min 20,000; now it only sizes the verbatim tail, never the trigger. Cosmetic label update optional (owner: settings agent).

---

## 7. الخلاصة النهائية

الضغط بعد كلمتين كان **سببه الحقيقي** دائرة ثانية مخفية في `engine.ts` (حدّ حروف ثابت OR'd مع بوابة الـ 90٪)، وليس البوابة نفسها — وهذا ليش اختبارات في11 الخضراء ما كشفت المشكلة. انحذفت الدائرة، وصار الضغط عند 90٪ من نافذة الموديل الحقيقية فقط. كمان وصلت `dedupeToolResults` ورفعت سقف الوكلاء الخلفية إلى 64 وخليت النماذج القوية تشوف كل الأدوات الـ 145. **67/67 اختبار ناجح و TypeScript نظيف.** بقي إعادة بناء النسخة القديمة في `dist-electron/electron/agent/engine.js` وتأكيد عملي من العميل.
