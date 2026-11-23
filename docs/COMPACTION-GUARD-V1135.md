# COMPACTION VERIFICATION GUARD — v11.35 / V1135
# حارس تحقّق ضغط السياق — الحكم: هل ما زال يضغط بعد كلمتين؟

> **Diagnosis + test ONLY — no application source was edited by this guard.**
> تشخيص + اختبار فقط — لم يعدّل هذا الحارس أي ملف من ملفات التطبيق.
>
> Guard: `tests/v1135-compaction-guard.test.mjs` · Evidence: `tests/.v1135-compaction-guard.results.json`
> Workspace `sadeem-v11.12.0` · Run date 2026-11-21 · Final run **9/9 PASS**.
> Method: fresh `esbuild` bundle of the **REAL** `electron/agent/engine.ts`, isolated
> userData + electron stub, local scripted OpenAI-compatible provider, **zero external
> network**, ~20 short user turns re-sent with **full history** exactly like
> `src/store.ts:3976-4019` does, and the **full system prompt + all 120 tool
> definitions re-sent every request** (`electron/agent/providers.ts:1994-2034`).

---

## 0. THE BLUNT VERDICT — الحكم الصريح

**Does "barely two words → context compressor / it compacts every little while" still reproduce?**

| Surface | Verdict |
|---|---|
| **CURRENT SOURCE TREE** | **NO — does not reproduce.** 20 short turns: 0 compaction events, 40,000 / 1,000,000 tokens = **4.0% fill**. The only auto-compact gate is 90% of the resolved real window (900k). The old fixed 120,000-char fallback and the 200k/65% path are gone from live code. |
| **Built artifact in `dist-electron/`** | **YES / STILL BUGGY UNTIL REBUILT.** `dist-electron/electron/agent/engine.js:4156` still contains `Math.floor(ctxWindowTokens * 0.65)`, and `:4392` still contains the `legacyCharsCap = Math.max(10_000, ...)` path. A user running the packaged binary **still sees** the founder's bug. This guard tests **source**, not the stale artifact. |
| **Live real-provider session / human-visible pixels** | **UNVERIFIED.** No account, no network, no screenshot. A local scripted provider can prove engine behavior, not what a human sees with a real vendor. |

**العربية (بصراحة):** في **الكود المصدري الحالي** المشكلة **ما عادت تتكرر** — 20 رسالة قصيرة، صفر عملية ضغط، والاستخدام 4٪ فقط من نافذة المليون. الضغط التلقائي صار لا يعمل إلا عند 900 ألف (90٪). لكن **النسخة المبنيّة في `dist-electron` ما زالت تستخدم الحدّ القديم 65٪** (`engine.js:4156`) ومسار الـ120 ألف حرف القديم (`:4392`) — يعني المستخدم اللي يشغّل البرنامج المبني **لسه يعاني** لحد ما يُعاد البناء (rebuild). لم أتحقّق من جلسة حقيقية أو شاشة فعلية.

**One-line answer:** Source: **FIXED**. Shipped binary: **NOT FIXED** (needs rebuild). Real session: **unverified**.

---

## 1. What the guard actually executes — ماذا ينفّذ الحارس فعليًا

`node --test --test-force-exit tests/v1135-compaction-guard.test.mjs` → 9 subtests, 0 fail.

- Fresh esbuild bundles of `engine.ts`, `costs.ts`, `src/lib/ctx.ts` from the current tree.
- Isolated `SURNIA_HOME` + electron stub (`app.getPath('userData')` → temp dir).
- Local HTTP server that speaks OpenAI-compatible SSE; it **reports `usage.prompt_tokens`**
  so the engine's real token-driven gate is exercised (not bypassed by a zero-usage stub).
- Model id `claude-sonnet-5.5` — a row the **real** catalog reports as **1,000,000**.
- Each "turn" is a separate `engine.runAgent(...)` call with the **accumulated history**,
  matching how the renderer actually invokes the engine every time the user sends a message.
- Each turn's first model call is a harmless `sys_info` tool call that reports the full
  system+tools token cost; the second call returns the short answer. This is deliberate:
  it forces a **second loop iteration**, which is where the auto-compact gate is evaluated.
  Without that, a tiny transcript would never exercise the token trigger (an important
  harness detail that makes this guard real rather than math-only).

Debug: `V1135_DEBUG=1 node --test --test-force-exit tests/v1135-compaction-guard.test.mjs`
(instruments the **bundle** only — never app source — to print the actual gate values).

---

## 2. PASS / FAIL per check with exact file:line — النتائج مطلباً بمطلب

| Check | Status | Evidence (file:line) | What it proves |
|---|---|---|---|
| **C0** harness sanity | **PASS** | `electron/agent/engine.ts:4866-4872`, `electron/agent/costs.ts:204-330` | Real engine + local provider complete a turn; catalog `claude-sonnet-5.5` = 1,000,000, `estimated:false`. |
| **C1** 20 short turns, no compaction | **PASS** | `electron/agent/engine.ts:5116-5122,5911`, `src/lib/ctx.ts:88-92` | 0 `compact` / `compaction` / `compaction_done` / `context_compacted` events in 20 turns; max fill 40,000/1,000,000 = **4.0%** (<10%). No compaction notice leaked. |
| **C2** resolved window ≈1M, not 200k | **PASS** | `electron/agent/engine.ts:4866-4872`, `src/lib/ctx.ts:75-92`, `electron/agent/costs.ts:204-330` | **Source-level eval** of the engine's real window-resolution lines with the real catalog → `1,000,000`; real threshold line → `900,000`. Provider-reported window wins over catalog. No live 65%/130k constant. |
| **C3** 90% fill triggers compaction | **PASS** | `electron/agent/engine.ts:5116-5122,5194-5279`, `src/lib/ctx.ts:82-92` | 905,000 token report on a 1M model triggers 1 honest `compaction` event (`before=91% → after=32%`) + a **real no-tools compaction call**. Below 90% → ineligible; unknown window → never eligible. |
| **C4** honest user-facing percentage | **PASS** | `src/lib/ctx.ts:36-64,101-110,129-140`, `electron/agent/engine.ts:5123,5278-5279`, `src/store.ts:3740-3755` | 40,200 tokens on 1M reads **4.02%**, never a false 100%; cache segments sum to ONE fill (no double count); unknown window → `null`, not a fake percent. |
| **C5** system+tools cost seeded | **PASS** | `electron/agent/providers.ts:1994-2034`, `electron/agent/engine.ts:4866-4872,5116-5122`, `electron/agent/costs.ts:306` | 6 turns × **180,000 tokens/request** of system+full tool defs (**120 tool defs re-sent each turn**) → 0 compaction. 180k on the **old** 200k/65%=130k trigger WOULD have compacted; on real 1M/90% it does not. |
| **C6** the exact founder failure mode | **PASS** | `electron/agent/engine.ts:5104-5122`, `src/components/settings/AgentSection.tsx:83` | Provider returns **NO usage**, default `compactThreshold=120,000` chars, transcript ~160k chars → **0 compaction** on a 1M model. This is the path C1 removed; the source no longer wires `legacyCharsCap` / `Math.min(cfg.compactThreshold, …)` into the trigger. |
| **S1** source scan | **PASS** | full list in §3 | 16 trigger sites enumerated; **0 live fixed-small thresholds or double-counts**. |

**Regression proof (one-off, not part of the committed guard):** reintroducing the old
fixed `120000`-char trigger **in a throwaway bundle patch only** made the guard fail
(C0/C3/C5 → FAIL). This guard is therefore a real detector, not a paper assertion.

---

## 3. Read-only source scan — every compaction trigger site (file:line)

.engine.ts / ctx.ts / store.ts + the catalog, prompt, and artifact evidence:

| # | File:line | Role | Flag |
|---|---|---|---|
| 1 | `electron/agent/engine.ts:2541-2572` | User-initiated `/compact` — single no-tools call | Separate path; never auto-gated. OK. |
| 2 | `electron/agent/engine.ts:4863-4872` | Real-window resolution (provider → catalog → 200k) + `compactTokenThreshold` | CTX-1 fix; eval-proven 1M. OK. |
| 3 | `electron/agent/engine.ts:5075-5078` | Context hygiene: old tool results pruned **before** the gate | OK. |
| 4 | **`electron/agent/engine.ts:5116-5122`** | **AUTO-COMPACT GATE** — `isCompactionEligible(lastRealInputTokens, ctxWindowTokens)` OR the window-derived chars fallback | C1 v11.35 fix removed the fixed 10k–120k `legacyCharsCap` path. OK. |
| 5 | `electron/agent/engine.ts:5124-5147` | Honest `pctBefore`; verbatim tail = 35% of the **real-window** threshold; `head.length >= 2` guard | OK. (Note: a tiny transcript leaves no head, so no call is made — correct.) |
| 6 | `electron/agent/engine.ts:5194-5279` | Real no-tools compaction call + `compaction{before,after}` event + visible notice | OK. |
| 7 | `electron/agent/engine.ts:5911` | `lastRealInputTokens = u.inputTokens` — feeds the gate; **provider INPUT only**, not input+output | No double count. OK. |
| 8 | `src/lib/ctx.ts:75-92` | `COMPACT_TRIGGER_RATIO = 0.9`, `compactionThresholdTokens`, `isCompactionEligible` | OK. |
| 9 | `src/lib/ctx.ts:101-110` | `contextFillPercent` — `null` for unknown/outgrown window | No false 100%. OK. |
| 10 | `src/lib/ctx.ts:129-140` | `occupancySegments` — disjoint parts sum to one fill | Fixes historic cache+generated double count. OK. |
| 11 | `electron/agent/costs.ts:204-330` | `CONTEXT_WINDOWS` (1M rows) + `CONTEXT_FALLBACK = 200_000` for **unknown ids only** | OK. |
| 12 | `electron/agent/providers.ts:1994-2034` | System prompt + full tool definitions re-sent on **every** request | The "cost" seed — benign at 1M/90%. OK. |
| 13 | `src/store.ts:3720-3758` | `/context` readout: last-turn fill ÷ real window + `isCompactionEligible` advisory | OK. |
| 14 | `src/store.ts:4721,4794` | `compaction` / `compaction_done` renderer handlers | OK. |
| 15 | `electron/agent/vibeFlow.ts:475-565` | Advisory `contextBudget` (pure, no trigger) | OK. |
| 16 | `src/components/settings/AgentSection.tsx:77-92` | Default `compactThreshold: 120000` chars | Setting still exists, but C1's gate no longer uses it as a fixed trigger. OK. |

**Flagged findings**
- **F1 (source): none live.** No `0.65`, `130_000`, `legacyCharsCap`, or `Math.min(cfg.compactThreshold, …)`
  remains in live code (`engine.ts`, `ctx.ts`, `store.ts`). Historic occurrences are comments only.
- **F2 (double-count): none.** `lastRealInputTokens` uses provider **input** tokens only;
  cache is inside `inputTokens` and segments are disjoint (`src/lib/ctx.ts:36-39,129-140`).
- **F3 (artifact — IMPORTANT):** `dist-electron/electron/agent/engine.js:4156` still has
  `Math.floor(ctxWindowTokens * 0.65)` and `:4392` still has `legacyCharsCap`. The packaged
  app still compacts a 1M model at ~130k tokens (13% of its window). **Rebuild required.**

---

## 4. Concurrency note — ملاحظة التزامن

C1 (the parent's other agent) edited `electron/agent/engine.ts` while this guard was being
developed, adding the **v11.35 "COMPACTION ROOT FIX"** at `engine.ts:5104-5122` (removal of
the fixed 120k-char chars-trigger). The guard was re-run against the final tree after that
edit landed: **9/9 PASS**. All line numbers in this document reflect the post-C1 tree.

---

## 5. Bottom line — الخلاصة

- **Source tree:** "compacts after two words" **does NOT reproduce** — the real engine, with
  the real 1M catalog and the founder's system+tools payload, completes 20 short turns
  without a single compaction and at 4% fill. Auto-compaction is honest and only eligible
  at ~90% of the real window.
- **Shipped binary:** the bug **DOES still reproduce** in `dist-electron` until rebuilt.
- **Not verified:** a live vendor session and the human-visible UI.
