# DIAGNOSIS — Clutter Under a Normal Assistant Answer
# تشخيص — الفوضى أسفل رد المساعد العادي

Date: 2026-11-19 · Scope: `electron/agent/engine.ts`, `src/store.ts`, `src/components/{MessageView,ChatPanel,ProofRibbon}.tsx`, `electron/agent/{vibeFlow,verification}.ts`
Posture: **DIAGNOSIS ONLY — no source file was edited by this agent.** The only file written is this report.
المنهج: **تشخيص فقط — لم أعدّل أي ملف مصدر.** الملف الوحيد المكتوب هو هذا التقرير.

> ⚠️ Line numbers were captured during an active multi-agent fix session and may drift by a few lines. Function/branch names are the stable identifiers. Other agents own `ClaimAuditRow` (A3) and `ProofRibbon` (A2); the engine wiring is owned elsewhere. This report only maps + recommends.

---

## 0. HEADLINE / الخلاصة

**Root cause:** one task kind — `params.task === 'chat'` — serves both a two-word question and a 3-hour agentic run. The entire "Proven Change" completion pipeline (claim audit → self-critique → Run & Show → red/green → fake tests → mutation → signed proof → receipt) sits behind a single condition at `engine.ts:3055` (`if (params.task === 'chat' && !result.aborted && result.finalText.trim())`). There is **no "did this turn do work?" test** in the baseline. So a plain answer produced audit/proof/critique rows under it.

**Baseline (before today's concurrent fixes), for a simple no-tools turn with any non-empty answer:**

| # | Row under the answer | Why it appeared |
|---|---|---|
| 1 | `CLAIM-AUDIT` (`ClaimAuditRow`) | `auditClaims()` turns **every sentence** into a claim → `claims.length > 0` → event sent even with 0 writes / 0 commands. |
| 2 | `[self-critique] …` (`NoticeChip` → SYSTEM) | Block gated only on `cfg.selfCritique !== false` (default ON); always emitted a footer. |
| 3 | `PROOF` (`ProofCard`) | `proof_package` sent unconditionally; verdict forced to `unproven` when no writes and no commands (`engine.ts:3340`). |
| 4 | `[proof] UNPROVEN …` (`NoticeChip`) | A **second**, duplicate PROOF chip emitted next to the card. |
| 5 | `REPORT` (`TaskReportCard`) | `task_report` is a guaranteed terminal event — still present on every turn, including today. |

**Current state at diagnosis time (fixes landed concurrently):** `realWorkThisRun` (`engine.ts:3042`) now guards `claim_audit` (`:3065`), `self_critique` (`:3096`) and the whole proof package (`:3325`); A3 `ClaimAuditRow` self-gates (`MessageView.tsx:2355`) and A2 `ProofRibbon` self-gates (`ProofRibbon.tsx:421`). Items 1–4 are therefore gone from simple turns. **Items still worth fixing: the always-on `REPORT` row and the always-on DNA/Playbook learning toast; plus a duplicate PROOF row+chip on real-work turns.**

السبب الجذري: نفس نوع المهمة (`chat`) يُستخدم للسؤال البسيط ولتشغيل الوكيل الطويل، وأنبوب "الإثبات" الكاملة تعمل لكل رد غير فارغ. في الأساس كان أي رد بسيط يُنتج بطاقات «تدقيق الادعاءات / إثبات / نقد ذاتي» تحته. أُضيفت مؤخراً حواجز `realWorkThisRun` في المحرك وحاجزان في الواجهة، فاختفت تلك البطاقات في الردود البسيطة. المتبقي: بطاقة `REPORT` الدائمة، وإشعار تعلّم DNA/Playbook الدائم، وازدواج بطاقة الإثبات مع شريط الإشعار في أعمال حقيقية.

---

## 1. COMPLETE MAP — every element that can appear under an answer
## 1. الخريطة الكاملة — كل عنصر يمكن أن يظهر أسفل الرد

Legend: **Simple** = plain chat turn, no tools/writes/commands · **Real** = genuine tool work · **Baseline → Now** = before today's fixes → at diagnosis time.

### 1.1 The four original simple-turn culprits

| Emitted by engine | Store → row | Rendered at | Simple (baseline → now) | Real work | Recommendation |
|---|---|---|---|---|---|
| `claim_audit` — `engine.ts:3066` (was `:3052`) | `store.ts:3644` → `model:'claim-audit'` | `MessageView.tsx:3332` → `ClaimAuditRow` `:2340` | **YES → NO** (`engine.ts:3065` guard; A3 guard `:2355`) | YES | **Fixed.** Keep engine guard as single source of truth; renderer guard stays as defence-in-depth. |
| `sys_notice` kind `audit` — `engine.ts:3068` (was `:3054`) | `store.ts:3214` → `kind:'notice'` | `MessageView.tsx:3344` → `NoticeChip` `:857` (`NOTICE_META.audit` `:742`) | Only when `unsupportedCount > 0` → **NO** (nested in the `:3065` guard) | YES (unevidenced claims) | **Fixed.** Keep nested under the audit gate. |
| `sys_notice` kind `self_critique` — `engine.ts:3097` (was `:3080`) | `store.ts:3214` → `kind:'notice'` | `NoticeChip` `:857` (no dedicated meta → falls back to label `SYSTEM`, `:859`) | **YES ALWAYS → NO** (`engine.ts:3096` guard) | YES | **Fixed.** Note: `vibeFlow.selfCritique()`'s own `quietTurn` (`vibeFlow.ts:201`) requires `claimsTotal === 0`, but the engine passes `audit.claims.length` which is **> 0 for any sentence** (`:3092`). The helper alone would NOT have suppressed it — the engine `realWorkThisRun` guard is the effective fix. Do not rely on the helper's `footer === ''` as the gate. |
| `proof_package` — `engine.ts:3387` (was `:3365`) | `store.ts:3669` → `model:'proof'` | `MessageView.tsx:3316` → `ProofCard` `:2303` | **YES → NO** (`engine.ts:3325` guard) | YES | **Fixed.** ProofRibbon (A2, `ProofRibbon.tsx:421`) is separately gated by per-turn `proofVisible` (`store.ts:1517`, requires work **and** a gate verdict) — two independent guards, correct. |
| `sys_notice` kind `proof` — `engine.ts:3388` (was `:3366`) | `store.ts:3214` → `kind:'notice'` | `NoticeChip` (`NOTICE_META.proof` `:747`) | **YES → NO** (inside the `:3325` guard) | **YES — still duplicates `ProofCard`** | **Remove or merge.** On real work the transcript shows BOTH a `PROOF` card and a `PROOF` chip saying the same verdict/file. Drop `notice('proof', …)` (the card is authoritative) or keep the chip and drop the card. This is the last duplicate-proof clutter. |

### 1.2 Always-on today (not yet gated)

| Emitted by engine | Store → row | Rendered at | Simple | Real work | Recommendation |
|---|---|---|---|---|---|
| `task_report` — `engine.ts:3697` (also `:1399`, `:1671`, `:1733`, error/abort paths `:3820`/`:3825`) | `store.ts:3577` → `model:'task-report'` | `MessageView.tsx:3339` → `TaskReportCard` `:2674` | **YES — every answer** (`REPORT · Task finished · ✓0.4s · N tok · $0.00 · DONE`) | YES | **Hide for simple turns.** Minimal: in the store case, only push the transcript row when `files.length || commands.length || toolsUsed.length || outcome !== 'completed'`; keep `set({ lastTaskReport })` intact for the UI/continue logic. Alternatively return `null` from `TaskReportCard` under the same predicate. Do **not** remove the event — the A4-CLOSURE completion guarantee depends on it. |
| `playbook_learned` — `engine.ts:3521` | `store.ts:3761` → toast only (`pushToast`, 5.6s) + `loadPlaybook()` | Toast, not a transcript row | **YES** — the block runs for every `task==='chat'` turn (`engine.ts:3519`, default `dnaEnabledSetting()` ON) | YES | **Gate on `realWorkThisRun`.** A "سalam" answer should not trigger a learning toast or a background model call. Same for `dna_updated` extraction (`engine.ts:3492`) and feedback (`engine.ts:2308`) — state only (no rows), but avoid the needless call on simple turns. |
| `sys_notice` kind `thinking` — `engine.ts:4600` | `store.ts:3214` → notice row | `NoticeChip` quiet line (`MessageView.tsx:873`, `:884`) | Only after ~20s of model silence (`engine.ts:4380` comment) | YES | **Keep.** Liveness marker, never a normal-turn clutter source. |

### 1.3 Real-work-only elements (correctly gated — do not change)

| Event / notice | Engine line | Gate | Renderer |
|---|---|---|---|
| `run_and_show` notices | `:3158`, `:3165`, `:3180`, `:3183` | `writesThisRun` (`:3110`) + not plan/review | `NoticeChip` (`NOTICE_META` has no `run_and_show` → label SYSTEM) |
| `red_green` event / `redgreen` notice | `:3192`, `:3194`, `:3196`, `:3209` | test record present, or prose contains fix/bug | `store.ts:3691` → `RedGreenRow` (`MessageView.tsx:3315`) |
| `regression` notice | `:3202` | harness regressions detected | `NoticeChip` |
| `fake_tests` / `fake` notice | `:3221`, `:3229` | `writesThisRun && criticGate !== false` | `store.ts:3702` → `FakeTestsRow` (`:3318`) |
| `mutation_gate` / `mutation_check` / `mutation` | `:3252`–`:3314` | `writesThisRun` + auto/full access + test command | `MutationGateRow` / `MutationCheckRow` / `NoticeChip` |
| `critic_verdict` / `critic` notice | `:2954`, `:2974`, `:2981`, `:3009` | `writesThisRun` AND (≥3 files OR test file OR gate fix round) | `store.ts:3547` → `CriticRow` |
| `goal_verified` / `goal` notices | `:2913`, `:2914`, `:2917` | active `/goal` session only | `store.ts:3535` → `GoalVerifiedRow` (`:3299`) |
| `verify_run` / `verify` notices | `:442`, `:2636`–`:2688`, `:4113` | auto-verify after edit bursts / debug mode | `store.ts:3497` → `VerifyRow` (`:3290`) |
| `run_receipt` | `:3634` | `writesThisRun \|\| commandsRun.length` | `store.ts:3559` → `ReceiptCard` (`:2590`) |
| `compaction` / `compact` notice | `:4361`, `:4362`, `:4367` | context window threshold / `/compact` task | `store.ts:3750` → compaction row; `NoticeChip` |
| `progress`, `guard`, `budget`, `failover`, `gate`, `continue`, `stop`, `mode`, `sys`, `cmd`, `hook:*`, `plan`, `checkpoint`, `review`, `uiq` notices | `:2608`–`:5371` | exceptional states / explicit modes / approvals / slash commands | `NoticeChip` (`NOTICE_META` `:737`, fallback `SYSTEM` at `:859`) |
| `false_done`, `budget_state` | `:3394`ff, `:3409` | real work | store slices only (`:3735`, `:3739`) — **no transcript row** |
| `skill_created`, `skill_refined`, `dna_suggestion` | `:3572`, `:3776`, `:3799` | skill factory / suggestion conditions | toasts/store only — **no transcript row** |
| Skills strip | `ChatPanel.tsx:899`, rendered `:1611` | `skillsOpen` default **false** (`store.ts:1716`) | Collapsible panel above the transcript, not under an answer — **not a clutter source** |
| `GateVerdictChip` (`MessageView.tsx:2044`) | — | Only for assistant text starting with a known gate tag | Real-work gate announcements; no simple-turn path |

---

## 2. ENGINE CONDITIONS — verified, not guessed

1. **Does `claim_audit` emit with zero claims?** No *literal* zero-claims answer is possible with non-empty text: `splitSentences()` (`verification.ts:432`) splits on `[.!?؛؟\n]` and `classifyClaim()` (`:469`) returns a `{kind:'other', supported:true}` record for every sentence (`:507`). Even `"Hello."` → 1 claim → `claims.length > 0`. The baseline gate `if (audit.claims.length)` was therefore **always true** for any answer. The `audit` *notice* additionally required `unsupportedCount > 0` (`:3067`), so it was rarer. Current fix adds `&& realWorkThisRun` (`:3065`).
2. **Does `proof_package` emit for a plain chat turn?** **Yes in the baseline.** The whole block is inside `if (params.task === 'chat' && !aborted && finalText.trim())` (`:3055`) and had no work guard; `verdict` was explicitly forced to `'unproven'` when `!writesThisRun && commandsRun.length === 0` (`:3340`). `saveProofPackage()` + `ioB.send('proof_package')` + `notice('proof')` all ran. Current fix wraps the block in `if (realWorkThisRun)` (`:3325`), so no proof row/chip on a simple turn.
3. **`selfCritique` footer on a simple turn?** The helper's `quietTurn` (`:201`) needs `!writes && !commands && claimsTotal === 0 && !verificationRan && !claimsDone`. Since the engine passes `claimsTotal: audit.claims.length` (`:3092`) and that is ≥1 for any prose, `quietTurn` is almost never true in production. The engine-side `if (realWorkThisRun)` at `:3096` is what actually suppresses it. Keep both, but test the engine path, not only the helper.
4. **`run_and_show`?** Already gated on `writesThisRun` (`:3110`) — safe for simple turns; no change needed. (For real work with no detected runner it honestly reports "not executed", which is legitimate.)
5. **`run_receipt`?** Gated on `writesThisRun || commandsRun.length` (`:3633`) — safe.
6. **`task_report`?** Unguarded — the guaranteed terminal event. The renderer unconditionally turns it into a `REPORT` row; this is the one row still under a simple answer.
7. **DNA/Playbook?** `learnDNAFacts` and `learnPlaybookFacts` fire for **every** completed chat turn (`:3490`, `:3519`) regardless of work; `playbook_learned` produces a visible toast via `store.ts:3761`.

---

## 3. RECOMMENDATIONS (minimal, ranked)

### Keep / already correct
- `realWorkThisRun` guards in `engine.ts` (`:3065`, `:3096`, `:3325`) — **single source of truth** for "did this turn do work?" (`writesThisRun || commandsRun.length || testRecord.length`). Do not duplicate this decision in more renderers than necessary.
- A3 `ClaimAuditRow` (`MessageView.tsx:2355`) and A2 `ProofRibbon` (`ProofRibbon.tsx:421`) self-gates — good defence-in-depth for stale persisted sessions.
- All §1.3 real-work-only elements.

### Do next (smallest change with most visible benefit)
1. **Suppress the `REPORT` row for no-work turns.** In `store.ts` case `task_report` (`:3577`), wrap the `msgs.push(...)` in `if (e.files?.length || e.commands?.length || e.toolsUsed?.length || e.outcome !== 'completed')`. Keep `set({ lastTaskReport })` and the `continueHint` logic untouched — the A4-CLOSURE contract stays intact. This removes the last row under a "مرحباً / hello" answer without touching the engine.
2. **Drop the duplicate PROOF chip.** Delete the `notice('proof', …)` at `engine.ts:3388` (keep the `proof_package` event → `ProofCard`). On real-work turns the card already shows verdict, gates and re-verify command; the extra `[proof] UNPROVEN — saved … --rerun` chip adds nothing but height.
3. **Gate DNA/Playbook learning on real work.** Change the two `if (params.task === 'chat' && !result.aborted && dnaEnabledSetting())` conditions (`:3490`, `:3519`) to also require `realWorkThisRun`. Removes a needless background model call and the "SADEEM learned" toast after a two-word question. (If product wants learning on every turn, at minimum gate the `playbook_learned` toast in the store on work evidence.)
4. **Optional polish:** keep the `selfCritique()` helper call (tests depend on it) but never use its `footer` alone as the emit decision — the engine guard is authoritative.

### Remove entirely
- Nothing engine-side needs deletion: every event has a legitimate consumer. The only true duplication is the `proof` notice (item 2). `run_and_show`, receipts, gates and reports should remain for real work.

### Verification after fixes (suggested)
- Simple turn: transcript must end with the assistant answer — no `PROOF`, no `CLAIM-AUDIT`, no `[self-critique]`, no `REPORT`, no learning toast.
- Real-work turn (write + test): all of `PROOF`, gates, `REPORT` still appear; ProofRibbon still visible per `proofVisible`.
- Stale session reload: A2/A3 renderer guards must still hide old rows.

---

## 4. ARABIC SUMMARY / ملخص عربي

- **السبب:** نوع المهمة `chat` يُستخدم للدردشة البسيطة وللعمل الحقيقي معاً، وأنبوب الإثبات تعمل لكل رد غير فارغ بلا شرط «هل حدث عمل؟».
- **ما كان يظهر تحت كل رد بسيط:** بطاقة تدقيق الادعاءات (لأن كل جملة تُحسب ادعاءً)، سطر «تقييم ذاتي»، بطاقة إثبات بقرار `UNPROVEN`، وشريط إثبات مكرّر — بالإضافة إلى سطر `REPORT` الذي يظهر دائماً.
- **الحالة الحالية:** أُضيف حاجز `realWorkThisRun` في المحرك لكلّ من التدقيق والتقييم الذاتي والإثبات، وأضافت الواجهة A2/A3 حواجزها الخاصة؛ اختفت البطاقات الأربع من الردود البسيطة.
- **المتبقي:** سطر `REPORT` بعد كل رد، وإشعار «تعلّم سادهيم» بعد كل رد، وازدواج بطاقة/شريط الإثبات في أعمال حقيقية.
- **الإصلاحات المقترحة:** (1) لا تُضف صف `task_report` للردود بلا أدوات/ملفات/أوامر مع الإبقاء على حدث الإكمال؛ (2) احذف إشعار `notice('proof')` واكتفِ ببطاقة الإثبات؛ (3) قيّد تعلّم DNA/Playbook بالعمل الحقيقي. لا حاجة لحذف أي حدث في المحرك.
