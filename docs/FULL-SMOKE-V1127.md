# FULL SMOKE — v11.27 (11.12.7)
## تقرير الدخان الشامل — النسخة 11.27

> **Diagnosis + test ONLY. No application source was edited by this agent.**
> **تشخيص واختبار فقط. لم يعدّل هذا الوكيل أي ملف من ملفات التطبيق.**
> Guard: `tests/v1127-full-smoke.test.mjs` — the agent wrote only this test + this report.

---

## 1. الحكم — VERDICT (Arabic)

**أحمر — وليس أخضر.** شغّلت السموكتين النهائيتين مرتين متطابقتين: **79 اختبار، 78 نجح، 1 فشل**.
الفشل واحد لكنه حقيقي وموجود في المصدر الآن: **F5 — مسار DNA غير محجوز بالعمل الحقيقي**.
أي رد بسيط («سلام») ما زال يُطلق استدعاء نموذج DNA/Playbook داخل الخلفية وإشعار تعلّم،
لأن شرطي `engine.ts:3868` و`engine.ts:3896` لا يحتويان على `realWorkThisRun`.

بقية الموجة سليمة وموصلة: الـ 60 شاشة كلها تُحزَّم وتُrender عبر SSR، 674 عنصر تحكّم
فُحصت بصفر تحكّم ميت، صفر محدِّد غير مستقر (React #300)، و6/6 أشكال `kdx:agent:run`
الحقيقية مرّت. F1–F4 نجحوا بالدليل: لا صفوف TAINT/CLAIM-AUDIT/PROOF، زر PROOF واحد
يعمل بنسخ حقيقي، كرة الكونتيكس تظهر دائماً، ومسار 429 يكمل داخل نفس المزود بلا تحويل.

**كونوا صادقين:** هذا ليس «بعد ما نزلت F1–F5». نزلت F1–F4 فقط؛ F5 لم تنزل وقت التشغيلين،
لذلك الحاجز **يبقى أحمر عن قصد**. لا يقل «تم إنهاء v11.27». أصلح F5 ثم أعد تشغيل السموكتين
ويُتوقع 79/79.

---

## 2. Verdict (English)

**RED — not green.** Two identical final runs: **79 tests, 78 pass, 1 fail**.
The single failure is a real, still-present source defect: **F5 — the DNA path is not
gated on real work.** A plain two-word answer still fires a needless background
DNA/Playbook model call and a learning toast, because the conditions at
`electron/agent/engine.ts:3868` and `:3896` lack `realWorkThisRun`.

The rest of the wave is sound and wired: all 60 screens bundle + SSR-render,
674 controls scanned with **zero dead controls**, **zero unstable selectors
(React #300)**, and **6/6 real `kdx:agent:run` param shapes** pass. F1–F4 pass with
evidence: no TAINT/CLAIM-AUDIT/PROOF rows, one working PROOF button with a real
clipboard write, the context orb always mounted, and a 429 that continues in place
on the same provider with no switch and no error row.

**Blunt caveat:** these two runs are **NOT** "after F1–F5 landed" — only F1–F4 landed;
F5 was still missing. The guard therefore stays **red on purpose**. Do not claim
v11.27 is complete. Land F5, re-run twice, expect 79/79.

---

## 3. Exact counts — both final runs (identical)

| Metric | Run 1 | Run 2 |
|---|---|---|
| Tests total / pass / fail | 79 / 78 / **1** | 79 / 78 / **1** |
| Screens bundled + SSR'd | **60** | **60** |
| Screens RENDERS OK / CRASHES / UNTESTABLE | **60 / 0 / 0** | **60 / 0 / 0** |
| Controls scanned | **674** | **674** |
| Dead controls | **0** | **0** |
| Unstable selectors (React #300) | **0** | **0** |
| `kdx:agent:run` shapes pass / fail | **6 / 0** | **6 / 0** |
| Wave sub-checks pass / fail | **4 / 1** | **4 / 1** |
| Exit code | **1** | **1** |

Machine counts line (both runs, byte-identical):

```
V1127_FULL_SMOKE_COUNTS={"screens":60,"screens_ok":60,"controls_scanned":674,"dead_controls":0,"unstable_screens":0,"taint_rows_ssr":0,"claim_audit_rows_ssr":0,"proof_rows_ssr":0,"proof_toggle_ssr":1,"proof_panel_ssr":0,"context_orb_ssr":1,"ctx_meter_ssr":false,"engine_shapes":0,"engine_pass":0,"wave_failures":1}
```

(`engine_shapes`/`engine_pass` in that line print before the engine tests finish;
the authoritative `after()` report is **6 / 0**.)

Duration: run 1 ≈ 36.3 s, run 2 ≈ 34.6 s.

Command:

```
node --test --test-force-exit tests/v1127-full-smoke.test.mjs
```

Machine artifacts (tmp): `results.json`, `engine-results.json`, `crashes.log` under
`D:\ORION\data\cache\tmp\sadeem-v1127-full-smoke\`.

---

## 4. Failure ledger — every failure with file:line

Both final runs reported exactly one wave failure, byte-identical:

| # | Failure | file:line | Status |
|---|---|---|---|
| **F5** | `learnDNAFacts(` must be gated by `realWorkThisRun`; condition at `engine.ts:3868` is `if (params.task === 'chat' && !result.aborted && dnaEnabledSetting())` | `electron/agent/engine.ts:3870` (and `:3898` for `learnPlaybookFacts(`) | **OPEN — genuine, not a harness artifact** |

Raw ledger line:

```
V1127_FINAL_FAILURES=1
  F5 Source :: electron/agent/engine.ts:3870 :: learnDNAFacts( must be gated by "realWorkThisRun" (found none in preceding 900 chars)
```

**Transient harness issues fixed during this diagnosis (NOT app defects):**
an early run over-scanned the `proof_package` anchor window, expected the old
failover-on-429 behaviour, and asserted a ClaimAuditRow self-gate that a concurrent
agent had replaced with a stronger `PROOF_ONLY_ROWS` drop. These were corrected in the
test; they are recorded here so the green parts are not mistaken for luck.

---

## 5. Wave-by-wave findings (file:line)

### F1 — NO taint / claim-audit / proof rows ✅
- `src/components/MessageView.tsx:3030-3036` — `PROOF_ONLY_ROWS` drops every synthetic
  proof/gates/claim-audit row at the renderer; the old `ClaimAuditRow` / `ProofCard`
  components and their `model === 'claim-audit'` / `model === 'proof'` dispatch
  branches are **deleted**, so stale sessions cannot resurrect them.
- `electron/agent/engine.ts:3423` — `realWorkThisRun` single source of truth;
  `:3446` gates `claim_audit`, `:3706` gates the whole `proof_package` block
  (emission at `:3768`).
- `engine.ts:3826` / `:3838` — the only surviving `notice('proof', …)` calls are
  honest **failure** notices in catch blocks; the duplicate success chip
  (`[proof] UNPROVEN — saved …`) is gone.
- Taint UI fully absent from `MessageView.tsx`; security enforcement intact at
  `electron/agent/taint.ts:151` (`shouldEscalateForTaint`) and in `tools.ts`.
- SSR: plain turn renders the answer and **0** taint / claim-audit / proof rows. ✅

### F2 — ONE working PROOF button ✅
- `src/components/ProofRibbon.tsx:445-463` — exactly one `<button>`:
  `data-testid="proof-toggle"` / `pr-proof-toggle`, no panel/tally/kind/popover.
- `:410-435` — `handleProofCopy()` reads real store gates, writes via
  `navigator.clipboard.writeText` (`:430`) and toasts the actual result (`:426/:431/:433`);
  wired by `onClick={handleProofCopy}` at `:452`. No fake "copied" state.
- `:438` — `if (!proofVisible) return null;` → a plain turn renders zero proof UI.
- SSR work-turn: 1 toggle, 0 panels; idle turn: 0 proof UI. ✅

### F3 — Context orb always visible ✅
- `src/components/ContextLens.tsx:91` — `const noData = !hasData;` replaced the old
  `if (!hasData) return null` hide gate; fresh sessions still mount the orb with an
  honest em-dash centre, zero-length arc and "window size unknown" tip.
- `src/components/Composer.tsx:2081` — one `<ContextLens>` after the mic (`:2046`);
  no ChatPanel/StatusBar duplicate; no `ctx-meter` strip.
- SSR: one compact orb, one svg, one arc, no fake `0%`. ✅

### F4 — 429 continuation path ✅
- `electron/agent/providers.ts:745` — `RATE_LIMIT_BACKOFF_CAP_MS = 1000`.
- `:966-1010` — v11.27 in-place 429 recovery: bounded exponential backoff, the
  **same provider** is retried (`:971` "provider is NEVER switched because of a 429"),
  one consolidated notice at `:986`, no error row. Stream-drop continuation
  (`MAX_STREAM_CONTINUATIONS` / `(conversation continues)`) intact.
- Real `streamTurn` runtime (mock fetch: 429, 429, 200): 3 calls to the same model,
  0 calls to any other provider, 1 `rate_limited` notice, 0 error notices, answer
  `CONTINUED-ANSWER` delivered, `stopReason === 'end_turn'`. ✅

### F5 — DNA path ❌ **OPEN**
- `electron/agent/engine.ts:3868` — DNA extraction condition lacks
  `&& realWorkThisRun`; the call is at `:3870` (`void learnDNAFacts({`) and emits
  `dna_updated` at `:3878`.
- `electron/agent/engine.ts:3896` — Playbook learning condition lacks the same gate;
  the call is at `:3898` and emits `playbook_learned` at `:3907` (the visible toast).
- Required fix (per `docs/DIAG-ANSWER-CLUTTER.md` §3.3): add `&& realWorkThisRun`
  to both conditions so a two-word answer triggers neither the background model call
  nor the "SADEEM learned" toast — while real work keeps the path.
- Store consumers are intact (`src/store.ts` `case 'playbook_learned'` / `dna_updated`),
  so this is a one-condition fix, not a removal.

---

## 6. What this smoke does NOT prove (honest limits)

1. **Not the hours-long continuity proof.** Engine shapes here are short local
   mock-provider turns; disconnect/stall/402/abort/endurance live in the heavy suites.
2. **Not the 145-tool execution sweep.** It proves presence/wiring, not real-data results.
3. **Not a real MCP round-trip or browser click.** F1–F4 use source + SSR + a real
   mocked provider call; dead controls are a static source scan (674 found, 0 flagged).
4. **F5 is a source-level guard.** The failure is a missing condition, verified by
   reading `engine.ts`; no runtime DNA model call was made (dnaEnabled is false in the
   harness settings), so the toast symptom is inferred from the code path, not observed.

**Bottom line / الخلاصة:** البنية سليمة في F1–F4، لكن F5 ناقصة — الحاجز أحمر عن قصد.
The structure is sound for F1–F4, but F5 is missing — the guard is red on purpose.
Fix `electron/agent/engine.ts:3868` and `:3896`, re-run twice, expect 79/79.
