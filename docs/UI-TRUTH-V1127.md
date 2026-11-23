# UI TRUTH AUDIT — v11.27 — تدقيق حقيقة الواجهة

> **Diagnosis only — no source edits were made by this audit.** / تشخيص فقط — لم يعدّل هذا التدقيق أي ملف مصدر.
>
> **As-of:** 2026-11-20 17:02 (local). Workspace: `sadeem-v11.12.0` (`package.json` still says 11.12.0; the fixes are labelled v11.27 in source comments and test names).
>
> **Stability warning:** F1–F5 kept editing until ~17:00. Most notably, the DNA `realWorkThisRun` gate was added at ~16:54, then **reverted** at ~16:58 because it broke the DNA end-to-end suites (§3.2). This snapshot is the post-revert state. Re-run before shipping.
>
> **Method:** direct source reads + `esbuild` bundling of the REAL components/store/engine + `renderToStaticMarkup` SSR + `node:test`. Every claim was re-checked after the F1–F5 edits landed (source files were still being written up to ~17:00; this is a **snapshot**, not a permanent state).

---

## 0. Epistemic preamble — مقدّمة معرفية (read this first)

**I never saw the founder's screenshot.** I have no pixels, no browser, no real provider account, and no way to verify colour, exact size, z-order, RTL visual flow, clipping, or real mouse hit-testing.

**SSR is not a screenshot.** `renderToStaticMarkup` produces a static HTML string. It can prove *what markup would exist*, *what handlers are wired*, and *what the store contains* — it cannot prove what a human actually sees on screen. A "PASS" below always means "the source/SSR contract holds", never "the founder's visual complaint is visually gone."

Because all five claims came from one screenshot, an explicit **EPISTEMIC LIMIT** is stated under every claim.

**Honesty note on a moving target:** F1–F5 were still editing while I audited. I personally observed the small PROOF button with `disabled` on the real `button` at ~16:30 (then `src/components/ProofRibbon.tsx:410`), and observed the enabled, wired version after F3 landed at ~16:39 (now `:443-465`). This document reports the **final snapshot**, but records that intermediate traps existed — see §2.3.

---

## 1. Verdict table — جدول الحكم

| # | Founder's claim | Verdict | Hard evidence |
|---|---|---|---|
| 1 | TAINT row present and unwanted | **FIXED in the UI layer** (not literally "no trace" globally) | `MessageView.tsx` = 0 `taint` matches; `v1127-no-taint-ui` 9/9; `v1127-ui-guard` A1–A4 pass |
| 2 | Run stopped on 429 with FAIL instead of continuing | **FIXED in source** (default no-failover path); no dedicated screenshot proof | `providers.ts:739-749, 966-1005`; `engine.ts:6336-6345, 6411`; `v1127-429-continue` 5/5; `v1127-429-guard` 11/11 |
| 3 | Small PROOF button disabled/dead | **FIXED** — enabled, real clipboard + notify onClick | `ProofRibbon.tsx:404-435, 443-465`; `v1127-proof-button-works` 7/7 (incl. runtime click) |
| 4 | Context tab invisible | **FIXED** — orb always mounted, honest centre | `ContextLens.tsx:84-91, 110, 158-162, 223-276`; `Composer.tsx:2081`; `v1127-context-visible` 9/9 |
| 5 | DNA not working | **PARTIAL** — core path + cap bug + `dna_note` UI-refresh bug all fixed, **one open source check** | `dna.ts:322-341, 414-421, 498-500`; `v1127-dna-works` 4/4; `v1127-dna-guard` 6/6; **open:** `engine.ts:3868/3870, 3896/3898` (full-smoke 78/79) |

**Bottom line:** four of five claims are fixed at the source/SSR level. The fifth works in its main path but leaves the **only genuinely red check in the whole V1127 suite**.

---

## 2. Claim-by-claim verification — تحقق مطلباً بمطلب

### 2.1 Claim 1 — صفّ TAINT / TAINT row

**Founder:** «هاذا القسم مابدي اياه شيله بلكامل احذفه لاتترك له اثر» — "remove this section completely, leave no trace."

**Current source:**
- `src/components/MessageView.tsx` — a literal grep for `taint` returns **0 matches**. There is no `TaintRow` component, no `model === 'taint'` dispatch branch, and no `chat.taint.*` i18n hook inside the component. The earlier dispatch existed and is gone.
- The separate proof-section cleanup is an early-return, not a render: `PROOF_ONLY_ROWS` at `src/components/MessageView.tsx:3028-3032`. The formerly rejected components (`ProofCard`, `ClaimAuditRow`, `MutationCheckRow` and their `model === 'proof' | 'mutation-gate' | 'red-green' | 'fake-tests' | 'claim-audit' | 'mutation-check'` branches) were **deleted** by F1 — independently verified by `v1127-ui-guard.test.mjs` check A2 (14/14 now pass).

**Test evidence:** `tests/v1127-no-taint-ui.test.mjs` — 9/9 pass:
- source guards at `:158-183` (component deleted, no dispatch, no markup/i18n, no CSS) — including `:264-271` which **deliberately asserts taint DETECTION still exists** in `electron/agent/taint.ts` and `electron/agent/tools.ts`;
- SSR at `:188-259`: a legacy `model:'taint'` message, a mixed transcript with a `noticeKind:'taint'` notice, and a real tool/command result all render with **no** `TAINT`, `FLAGGED`, `sc-taint`, `chat.taint`, etc.

**Verdict:** FIXED in the UI layer.

**Brutal honesty / nuance:** "leave no trace" is **not literally true globally**, and I will not claim it is. The taint *strings* remain at `src/i18n.ts:2396-2397`, and the store still consumes `taint_escalation` / `taint_notice` at `src/store.ts:4569-4570`. This is intentional: security enforcement must survive a UI deletion (the test at `:264-271` locks that in). So: visual row removed = **yes**; every taint character erased from the codebase = **no**.

**EPISTEMIC LIMIT (visual):** I did not see the screenshot. SSR proves no taint markup is produced for the seeded messages; it cannot prove the founder's actual running window no longer shows the row.

---

### 2.2 Claim 2 — 429 أوقف التشغيل / 429 stopped the run with a FAIL report

**Founder:** on HTTP 429 the run stopped and emitted a FAIL report instead of continuing.

**Current source (the fix is real and substantial):**
- `electron/agent/providers.ts:739-749` — bounded exponential 429 backoff, **≤1s per wait** (`RATE_LIMIT_BACKOFF_CAP_MS = 1000`), 8 total attempts by default (`DEFAULT_RATE_LIMIT_MAX_ATTEMPTS = 8`), 60s wall-clock episode budget (`DEFAULT_RATE_LIMIT_BUDGET_MS = 60_000`).
- `electron/agent/providers.ts:766-776` — env-tunable caps (`SURNIA_RATE_LIMIT_MAX_ATTEMPTS`, `SURNIA_RATE_LIMIT_BUDGET_MS`), clamped to 1..50 so a bad config cannot create an unbounded hammer loop.
- `electron/agent/providers.ts:966-1005` — the 429 branch now **retries the same request in place** (no text streamed yet, so nothing is duplicated and no tool can re-execute) and emits the honest notice at `:986`: *"Rate limited (429) — waiting briefly and continuing the same task (no provider switch)."*
- `electron/agent/providers.ts:2473` — when an **explicit failover chain** exists the caller sets `__maxRateLimitRetries: 1`, keeping the legacy "one short retry then failover" contract.
- `electron/agent/engine.ts:6336-6345` — `isFatalProviderError()` covers 401/402/403/404/400, **not** 429; `:6411` gives the canonical 429 wording. Engine retry/failover loop at `:4931-4947` and `:5260-5288`. A terminal failure still makes the report `outcome:'error'` at `:4103-4109` — correct *after* the bounded episode, not an immediate stop.

**Test evidence (all re-run on the final snapshot):**
- `tests/v1127-429-continue.test.mjs` — **5/5 pass**: A1 (429×5 then success → same-provider recovery, real deltas, ONE quiet notice), A2 (429 forever → bounded honest failure, no infinite hammer), A3 (402/401 still fatal on first response), B1 (long task survives 429×5 → real deltas + one honest written report), B2 (429 during a tool chain never re-executes the tool).
- `tests/v1127-429-guard.test.mjs` — **11/11 pass**.
- Legacy suites still green: `tests/v1119-429-quiet.test.mjs` **7/7**, `tests/v1123-provider-errors.test.mjs` **14/14**.

**Verdict:** FIXED in source for the default (no-failover) path, which is what the engine uses — its main `streamTurn` call at `electron/agent/engine.ts:5109` passes no `failover`/`__maxRateLimitRetries`, so the generous 8-attempt policy applies.

**Brutal honesty:** the "continue" policy is **conditional**. With a failover chain configured, `providers.ts:2473` forces one retry then failover — the old behaviour. Also, after the episode is genuinely exhausted a terminal 429 still produces an `error` outcome → the UI can still show FAIL; that is honest bounded failure, not the reported premature stop. The existing v1119/v1123 suites pass *because* they exercise the chain path — they do **not** independently prove the new in-place path; only `v1127-429-continue` does.

**EPISTEMIC LIMIT (not a visual claim):** SSR is irrelevant here. My evidence is source + mocked `fetch`/local `node:http` engine simulations. I cannot confirm the founder's exact production 429 body, `Retry-After`, provider, or whether their settings enabled failover — which would select the legacy path.

---

### 2.3 Claim 3 — زر البروف الصغير ميت / small PROOF button disabled/dead

**Founder:** «زر البروف الصغير الي اخر شيء لا يعمل» — "the small PROOF button at the end does not work."

**Current source:**
- `src/components/ProofRibbon.tsx:443-465` — a single `<button type="button" data-testid="proof-toggle" className="pr-proof-toggle" onClick={handleProofCopy}>` with **no `disabled` attribute** and a real click handler. The old `disabled` (which I personally read at `:410` earlier) is gone.
- `src/components/ProofRibbon.tsx:404-435` — `handleProofCopy` counts real store gates (`proof.gates`: `ok`/`bad`/`warn`), builds a short plain-text bilingual summary, calls `navigator.clipboard.writeText`, and fires store `notify()` on the **actual** outcome (unavailable → failure → success). No faked "copied" state, no raw JSON.
- `src/components/proof.css:60-104` — the 22px, 1px-hairline, mono-caps chip with hover/focus/expanded styling.

**Test evidence:** `tests/v1127-proof-button-works.test.mjs` — **7/7 pass**: source locks at `:106-176` (no `disabled`, real `onClick`, real clipboard + three honest notify paths, real gate counts, one-shot pulse, no panel/tally/ledger), SSR at `:181-208` (enabled button, PROOF wordmark, pip, no panel markup; plain chat renders `''`). The `v1127-ui-guard` suite additionally **invokes the captured `onClick` at runtime** with a mocked clipboard and a `notify` spy — check B5 passes. Full-smoke's "F2/5 · ONE working PROOF button" also passes.

**Verdict:** FIXED.

**Brutal honesty — the greenwashing trap I caught:** the older `tests/v1126-proof-buttons.test.mjs` and `v1126-proof-only.test.mjs` pass **6/6 even while the button was still `disabled`** — they only assert the label, "exactly one button", and absence of the popover. They never check interactivity. A green v1126 suite was fully compatible with the founder's complaint being unfixed. Only the v1127 suite locks the real behaviour. **Do not use v1126 proof tests as evidence for this claim.**

**EPISTEMIC LIMIT (visual):** SSR proves the button is enabled and the handler wired; the mocked click proves the handler writes to a stub clipboard. It cannot prove the chip's perceived size, hover/focus feel, or that a real OS clipboard write succeeds in Electron. I never saw the screenshot.

---

### 2.4 Claim 4 — تبويبة الكونتيكس لا تضهر / context tab invisible

**Founder:** «تبويبة الكونتيكس لا تضهر» — "the context tab does not appear."

**Current source:**
- `src/components/ContextLens.tsx:84-91` — the old visibility gate is gone: `const noData = !hasData;` now only chooses the centre label. No `if (!hasData) return null` remains (source guard at `v1127-context-visible.test.mjs:130-134`).
- `src/components/ContextLens.tsx:158-162` — explicit comment: "NO early return. The compact orb is a permanent fixture beside the mic"; the component returns the real JSX at `:223-276`.
- `src/components/ContextLens.tsx:110` — honest centre: `noData ? '—' : unknown ? fmtTokens(fillShown) : \`${ctxPct}%\`` — em-dash, never a fake "0%".
- `src/components/Composer.tsx:2081` — exactly one `<ContextLens compact />` mount, beside the mic; no header or status-bar duplicate (asserted at `v1127-context-visible.test.mjs:205-217`).

**Test evidence:** `tests/v1127-context-visible.test.mjs` — **9/9 pass**: zero usage mounts anchor + button + one arc + one SVG (`:139-149`), honest `—` and "window size unknown" (`:151-158`), exact empty 2πr arc (`:160-174`), unknown-window token count (`:179-186`), exact unrounded 50% arc (`:191-200`), one mount/no strip (`:205-217`), reduced-motion + fixed viewport-clamped popover intact (`:219-227`).

**Verdict:** FIXED.

**EPISTEMIC LIMIT (visual):** SSR proves the orb markup exists at zero usage. It cannot prove it is actually visible beside the mic, not clipped by the composer's `overflow`, or that its colour/contrast satisfy the founder. The "fixed, viewport-clamped popover" is a **source assertion** (`:219-227`), not a screenshot confirmation. I never saw the screenshot.

---

### 2.5 Claim 5 — الـ DNA لا يعمل / DNA not working

**Founder:** «ال dna لا يعمل» — "the DNA does not work."

**Current source:**
- `electron/agent/dna.ts:322-341` — `capPatternsLossless()`: the old policy sorted by `confidence × recency` and evicted a brand-new low-confidence (0.4) pattern whenever the model was full of reinforced (0.95) ones — the silent "DNA stopped learning after ~60 patterns" bug. The new policy evicts the **oldest most-reinforced** entries and **keeps new facts**. Applied at `electron/agent/dna.ts:414-421`.
- `electron/agent/dna.ts:498-500` — a `dna_note` tool write now calls `emitDNAEvent('updated', { reason: 'note' })`. Without it, the store (`src/store.ts:2614-2617`) never reloaded and the DNA panel stayed stale until restart — arguably the most literal match for "DNA لا يعمل". The v11.27 guard test `v11.27 DIAGNOSTIC: dna_note writes dna.json but does it emit kdx:dna:event updated?` originally **failed** against the pre-fix source and now passes.
- `electron/agent/engine.ts:2414-2442` — learned DNA is rendered into the system prompt; `:3863-3889` — post-run extraction trigger; `:6480+` — `learnDNAFacts()` itself.
- `src/store.ts:2614-2617` — `onDnaEvent` → `loadDna()` (coalesced); `src/store.ts:5077` — `loadDna()`.

**Test evidence (REAL engine, local mock LLM, isolated userData — not a mocked DNA module):**
- `tests/v1127-dna-works.test.mjs` — **4/4 pass**: a real engine run writes the learned pattern into `<userData>/dna.json`; `dna_updated` + `kdx:dna:event` reach the bridge; a fresh module reload reads it from disk; a second run's built system prompt contains the pattern under `# User DNA`; `dnaStats` shows real counts; at the 60-pattern cap a **new** pattern survives and exactly one old reinforced one is evicted.
- `tests/v1127-dna-guard.test.mjs` — **6/6 pass**, independent verification of the same chain (including the `dna_note` → `kdx:dna:event` path at `:478-501`).

**Verdict:** PARTIAL. The core learning loop works, the cap bug and the stale-UI `dna_note` bug are genuinely fixed. **One open source check remains** (§3.1), and the V1127 full-smoke suite is red because of it.

**EPISTEMIC LIMIT (not a visual claim):** these tests drive the real engine against a scripted local provider. I cannot confirm the founder's actual failure mode — empty panel vs stale data vs a missing `dna.json` vs their provider refusing the extraction call — because I never saw their screenshot or their logs.

---

## 3. Remaining defects, ranked by user impact — العيوب المتبقية مرتّبة

### 3.1 P1 — DNA / playbook extraction is not gated on real work (the only red check)

- **Location:** `electron/agent/engine.ts:3868` (`if (params.task === 'chat' && !result.aborted && dnaEnabledSetting())`) wrapping `void learnDNAFacts({` at `:3870`; identical condition at `:3896` wrapping `void learnPlaybookFacts({` at `:3898`.
- **Contract that is violated:** `realWorkThisRun` is defined once at `electron/agent/engine.ts:3423` and is already used to gate claim-audit (`:3446`) and proof-package (`:3706`) rows. `docs/DIAG-ANSWER-CLUTTER.md` §3.3 requires the same gate for post-run learning — a no-op "salam" turn must not spawn learning calls.
- **Evidence:** `tests/v1127-full-smoke.test.mjs:1064-1072` (`gatedNear(..., 'learnDNAFacts(', 'realWorkThisRun', 900)`); suite result **78 pass / 1 fail**, and the failure ledger in `crashes.log` reads:
  `F5 Source :: electron/agent/engine.ts:3870 :: learnDNAFacts( must be gated by "realWorkThisRun" (found none in preceding 900 chars)`
- **User impact:** unnecessary model calls on trivial chat turns (cost + latency + possible toast noise); the whole smoke suite stays red, so a clean release is blocked. This is a **genuine source defect, not a harness artifact** — confirmed independently by `docs/FULL-SMOKE-V1127.md:91`.
- **Owner:** F5. I did **not** edit source.

### 3.2 P2 — The two DNA test suites encode opposite contracts (proven, live)

- `tests/v1127-dna-works.test.mjs:164-179` drives a **plain conversational turn with no tool calls** and **requires** DNA learning to fire.
- `tests/v1127-full-smoke.test.mjs:1064-1072` requires learning **not** to fire without `realWorkThisRun`.
- **I observed both sides of this contradiction during the audit:** when F5 added `&& realWorkThisRun` at ~16:54, `v1127-full-smoke` went **79/79 green**, but `v1127-dna-works` collapsed to **1/4** (`timeout waiting for pattern in dna.json`) and `v1127-dna-guard` to **1/3**. F5 reverted the condition at ~16:58; the DNA suites went green again and full-smoke went back to 78/79.
- **Impact:** this is not hypothetical — the codebase currently satisfies one contract by violating the other. A clean green requires a **product decision** (either make the DNA tests perform real work, or relax the full-smoke gate). Ranked just below P1 because it is the root cause of P1's oscillation.

### 3.3 P3 — "No trace" is not literally true for taint (intentional, low impact)

- `src/i18n.ts:2396-2397` (`chat.taint.origin`, `chat.taint.escalated`) and `src/store.ts:4569-4570` (`taint_escalation`, `taint_notice`) still exist.
- **Impact:** none visually — no taint row renders (`MessageView.tsx` has 0 `taint` matches). Kept deliberately so taint *detection/enforcement* survives (`v1127-no-taint-ui.test.mjs:264-271`). Only matters if the founder's phrase is read as a literal codebase purge.

### 3.4 P4 — Process hazards (not product defects)

- Source was a moving target: F1–F5 edited files until ~17:00, including a fix-then-revert on the DNA gate (§3.2). Re-run the whole V1127 suite immediately before shipping.
- Do not trust the checked-in `tests/*.bundle.mjs` artifacts as evidence: e.g. `tests/.dap.bundle.mjs:28985` still contains the **pre-v11.27** providers code. All results in this document come from fresh esbuild bundles of current source.

---

## 4. Test evidence ledger — سجل الأدلة (final snapshot, 2026-11-20 17:02)

| Suite | Result | Covers |
|---|---|---|
| `tests/v1127-no-taint-ui.test.mjs` | **9 / 9 pass** | Claim 1 (source + SSR + security-preserved) |
| `tests/v1127-ui-guard.test.mjs` | **14 / 14 pass** | Claims 1, 3, 4 + full "no trace" deletion check A2 |
| `tests/v1127-context-visible.test.mjs` | **9 / 9 pass** | Claim 4 (zero-usage SSR orb, exact arc, one mount) |
| `tests/v1127-proof-button-works.test.mjs` | **7 / 7 pass** | Claim 3 (enabled/wired button, runtime clipboard click) |
| `tests/v1127-429-continue.test.mjs` | **5 / 5 pass** | Claim 2 (in-place 429 recovery + long-task + tool safety) |
| `tests/v1127-429-guard.test.mjs` | **11 / 11 pass** | Claim 2 (429 guard) |
| `tests/v1119-429-quiet.test.mjs` | **7 / 7 pass** | Claim 2 legacy contract (chain path) |
| `tests/v1123-provider-errors.test.mjs` | **14 / 14 pass** | Claim 2 legacy contract (classification) |
| `tests/v1127-dna-works.test.mjs` | **4 / 4 pass** | Claim 5 (real engine end-to-end + cap regression) |
| `tests/v1127-dna-guard.test.mjs` | **6 / 6 pass** | Claim 5 (independent verification, incl. `dna_note` event) |
| `tests/v1127-full-smoke.test.mjs` | **78 / 79 — 1 FAIL** | P1: `engine.ts:3870` missing `realWorkThisRun` gate |
| `tests/v1126-proof-buttons.test.mjs`, `v1126-proof-only.test.mjs` | pass, but **not valid evidence** for claim 3 — see §2.3 | — |

**Aggregate V1127 dedicated suites (final run, 17:02):** **143 pass / 1 fail across 144 tests.** The single failure is P1.

---

## 5. What this audit did NOT do — ما لم يفعله هذا التدقيق

1. **No source edits.** Not one line was changed.
2. **No screenshot seen.** Every visual verdict is a source/SSR contract verdict, explicitly limited in §2.
3. **No real provider / no real OS clipboard / no browser.** The clipboard click was invoked with a stub; the engine ran against local mock HTTP.
4. **No claim that the founder is now satisfied.** Four claims are fixed in code; one is red; and only the founder looking at a fresh build can close the visual loop.

> **Final honest sentence:** the screenshot is the ground truth for the founder; this document is only the ground truth for the source. They are not the same thing, and I will not pretend otherwise. / الصورة هي الحقيقة عند المؤسس؛ هذا المستند حقيقة المصدر فقط، وليسا الشيء ذاته.
