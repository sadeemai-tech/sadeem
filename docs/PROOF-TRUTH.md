# PROOF CENTER — الحقيقة بالأدلة / The truth, with evidence

> **v11.21 — "عندي إحساس إنه ما بيعمل" / "I have a feeling it doesn't work."**
> This document answers that doubt with executable evidence, not adjectives.
> If a claim below has no command or no `file:line`, do not believe it.

---

## ١. الخلاصة / Executive summary (بلا تجميل / brutally honest)

**Arabic:** مركز الإثبات **يعمل فعلاً**، لكنه لا يعمل بالطريقة التي يتوقعها المؤسس أحياناً.
الرسالة العادية ("سلام، كيفك؟") **لا تُظهر أي زر إثبات** — وهذا مقصود، وليس عطلاً.
الزر الصغير "إثبات" يظهر **فقط** عندما يقوم التشغيل بعمل حقيقي (كتابة ملف / أمر / اختبار)
**ويُصدر حكماً حقيقياً واحداً على الأقل**. الأرقام داخل اللوحة **محسوبة من أحكام البوابات**
لا مكتوبة يدوياً. لكن — وبصراحة — لوحة الإثبات **لا تعرض كل ما يحسبه المحرك**: حكم
الـ regressions يُحسب ولا يُعرض أبداً، وعدد الملفات في إيصال التشغيل يظهر دائماً `0`
بسبب خطأ في المتجر. هذه ليست "كل الحقيقة"، بل الحقيقة المتاحة للواجهة.

**English:** The Proof Center **does work** — but not always the way the founder expects.
A plain chat turn **shows no proof button at all** — that is intentional, not a bug.
The small PROOF chip appears **only** when the run did real work (file write / command /
test) **and at least one real gate verdict was recorded**. The tallies are **computed
from the gate verdicts**, not hard-coded. But — brutally — the panel does **not** show
everything the engine computes: the regression verdict is computed and never emitted,
and the receipt's file count always reads `0` because of a store-side filter. This is
the UI's honest subset, not the whole truth.

---

## ٢. الدليل التحليلي / End-to-end proof (the test)

**File:** `tests/v1121-proof-truth.test.mjs`
**Run:** `node --test --test-force-exit tests/v1121-proof-truth.test.mjs`
**Result:** `tests 11 · pass 11 · fail 0`

The test drives the **real** `useStore` (bundled with esbuild, browser bridge stubbed)
and SSR-renders the **real** `ProofRibbon` — the same harness as `v1115-proof`,
`v1116-proof-visible`, `v1117-chat-proof-button`. It adds two *SSR seams* (`defaultOpen`,
`defaultFocusKind`) so it can render the exact DOM a click produces; the click handlers
themselves are asserted in source (`onClick={() => openKind(k)}`). SSR cannot literally
click — that limitation is stated here instead of being hidden.

| # | What was proven | Observed evidence (test diagnostic) |
|---|---|---|
| 1 | Plain chat: text + `proof_package(verdict=unproven)` + `turn_end` → **zero** proof UI | `proofVisible=false, gates=0, DOM proof hooks=0` |
| 1b | Even `defaultOpen=true` cannot force a plain turn to show proof | no `pr-pop`, no `proof-toggle` |
| 2 | `write_file` + `test_run` + `verify_run` + gates → ONE chip, real tallies | `gates=[verify,redGreen,receipt] PASS=3 FAIL=0 WARN=0`, no panel in collapsed DOM |
| 2b | A failing verify moves the tally | `PASS=1 FAIL=1` — recomputed from gate tones |
| 3 | Opening the ledger shows engine's own detail strings | 3 `pr-check` rows; `npm test — exit 0`, `red then green passed`, `0 files · 1/1 commands ok · 1 rounds`; explainer + ARIA in sync |
| 4 | Clicking a chip focuses that family | `pr-pop-focus` + `Showing: tests passed`; `is-focused` on tests rows, `is-dimmed` on cmd/receipt rows; chip gets `is-active` |
| 4b | Clicking the same chip again clears the filter | `open && cur === k ? null : k` |
| 5 | The pip pulses once, never loops | one-shot keyed remount on `proofVisible` rising edge; `animation … 1 both`; no `infinite` in `proof.css` |
| 6 | No mixed EN+AR string | zero mixed literals; AR panel has `ناجح/فاشل`, EN panel has `PASS/FAIL` |
| 7 | Engine emits real verdicts | see table below |
| 7b | One verdict is computed but never emitted | see "Known gaps" below |

**Existing regression suites re-run and green:** `v1115-proof` (4/4), `v1116-proof-visible`
(4/4), `v1117-chat-proof-button` (6/6) — 14/14 total.

---

## ٣. هل المحرك يُصدر أحكاماً حقيقية؟ / Does the engine really emit verdicts?

Read-only audit of `electron/agent/engine.ts` (line numbers from the file on disk; the
test re-checks these strings so the claim cannot silently rot):

| Event | Emitted at | Value comes from | Real? |
|---|---|---|---|
| `verify_run` | `engine.ts:471` (`runEngineVerify`), `engine.ts:4305` (`runAutoVerify`) | `runCaptured()` → `exitCode = r.exitCode` | ✅ real command exit code |
| `red_green` | `engine.ts:3383` | `gates.testRecord.redGreenCompliant(testCmdForGate)` | ✅ harness ledger, not prose |
| `fake_tests` | `engine.ts:3412` | `detectFakeTests()` → `scanned/high/summary` | ✅ deterministic scan |
| `mutation_gate` | `engine.ts:3455` | `await mutationGate({ … })` → `verdict/ran/killed/killRate/detail` | ✅ real mutants executed |
| `critic_verdict` | `engine.ts:3165` | `reviewWorkingDiff()` inside `gates.budget.attempt('critic', …)` | ✅ real reviewer call |
| `proof_package` | `engine.ts:3578` | computed `verdict` (worst vote wins, `engine.ts:3530`) via `buildProofPackage()` | ✅ signed Ed25519 package |
| `run_receipt` | `engine.ts:3825` | `writesThisRun \|\| commandsRun.length` + real counts | ⚠️ partially — see gaps |

The store folds these into `proof.gates` in `src/store.ts:1608-1749` — one `upsertGate`
per event, with `detail` taken **verbatim** from the payload. `proofVisible` is recomputed
on **every** event (`store.ts:1745`) and requires **both** real work **and** ≥1 gate
(`store.ts:1584-1592`). That is why a plain answer renders nothing.

---

## ٤. الثغرات بصراحة / Known gaps — NOT fixed here (engine/store are read-only for this task)

1. **حكم الـ regressions يُحسب ولا يُعرض أبداً.**
   `engine.ts:3391` computes `gateRegressions = regs.unknown ? 'unknown' : …`;
   `engine.ts:3527` folds it into `proof_package.gates.regressions`. There is **no**
   `ioB.send({ type: 'regressions', … })` anywhere, and `src/store.ts` has **no**
   `case 'regressions'` in `ingestProofEvent`. ⇒ The Proof Center can never show a
   regression row. Likewise `claimAudit` (`engine.ts:3571`) only lives inside the signed
   package. **The tallies are real for the six families shown — they are not complete.**

2. **عدد الملفات في الإيصال دائماً صفر (خطأ متجر).**
   The engine sends `files: [...touchedFiles].slice(0, 50)` — **path strings**
   (`engine.ts:3826`). The store filters them with
   `typeof f === 'object'` (`store.ts:1698`), so every string is dropped and the ledger
   honestly prints `0 files · 1/1 commands ok · 1 rounds`. The explainer says "files
   changed" — the evidence row contradicts it. Out of scope: `store.ts` is not ours.

3. **بعض البوابات مشروطة — غيابها ليس فشلاً.**
   `critic_verdict` is sent only when the reviewer call returns `rev.ok` (`engine.ts:3165`);
   `mutation_gate` only for write runs in `autoEdit/fullAccess` **with a test command**
   (`engine.ts:3433-3439`); `fake_tests` only when a scan found files
   (`engine.ts:3405-3412`); `proof_package` only for `realWorkThisRun` (`engine.ts:3516`).
   A run with none of these legitimately shows fewer rows.

4. **الاختبار لا يضغط فعلياً على الزر.**
   The harness has no DOM. It proves the click *handlers* in source and renders the
   post-click state through `defaultOpen` / `defaultFocusKind`. This is SSR evidence,
   not a browser automation run — stated plainly so nobody over-claims it.

5. **البناء (build) تحقّق منفصلاً عن منطق الإثبات.** See the verification section:
   a green test suite does not prove the packaged app was produced from these exact bytes.

---

## ٥. تحسينات الشكل / Button art (what changed in this wave)

- **Border:** exactly `1px solid var(--line-strong, var(--line))`, with
  `box-sizing: border-box` so the control stays honestly 22px tall (`proof.css`).
- **Mono caps:** Latin label uses `var(--font-mono-x)`, `text-transform: uppercase`,
  `letter-spacing: 0.16em`; Arabic switches to the display face with **no fake caps**
  (`html[lang='ar']` rule) — no string ever mixes the two scripts.
- **One-shot pulse:** fires on the **rising edge of `proofVisible`** — one restrained
  560ms ring per new work-run — **not** per gate, never `infinite`. Both reduced-motion
  signals disable it. The old gate-signature trigger (which flickered on every gate and
  on gate clearing) is removed.
- **Honest empty state:** the defensive zero-gate branch now says "No gate verdicts were
  recorded for this run — nothing to prove" / «لا توجد أحكام بوابات مسجّلة لهذا التشغيل —
  لا شيء يُثبت» — it never promises future evidence. In the real app the **only** empty
  state is no chip at all (`if (!proofVisible) return null`).
- **Panel anchor:** `proof.css` neutralises `chat.css`'s conflicting bare `.pr-pop`
  (`inset-inline: 12px; bottom: …`) so the ledger opens cleanly below the chip instead of
  being stretched between two anchors; `polish.css`'s tinted explainer card is overridden
  with a scoped selector.
- **Tally words** are language-selected (`ناجح/فاشل` vs `PASS/FAIL`) — the old AR panel
  leaked English tally words.

---

## ٦. التحقق / Verification

| Check | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit && tsc -p tsconfig.node.json --noEmit`) | ✅ pass |
| `node --test --test-force-exit tests/v1121-proof-truth.test.mjs` | ✅ 11/11 |
| `node --test … v1115-proof v1116-proof-visible v1117-chat-proof-button` | ✅ 14/14 |
| `npm run build` (`vite build && node scripts/post-build.mjs`) | ✅ pass — `✓ built in 2m 33s`, `BUILD_EXIT=0` |

> **Build note (honest):** the workspace was running several concurrent `npm run build`
> / `tsc` processes from other agents during verification. The successful build printed
> `post-build: built-in skills NOT shipped: EBUSY: resource busy or locked, unlink
> …dist-electron/skills/api-design/SKILL.md` — a file-lock from that contention, not a
> Proof Center failure. `webcraft kit shipped`, the CSP sidecar, and the boot watchdog
> all completed, and the process exited 0. Re-run in a quiet workspace to get a clean
> post-build log. A green logic test is **not** proof the build succeeded; both were run.

---

## ٧. الحكم / Verdict

**The founder's feeling is understandable but wrong about the mechanism.** The Proof
Center is silent on plain chat **by design**; when real work happens it shows a single
small chip, and behind that chip are real engine verdicts with real numbers. What is
*not* true is that it shows *everything* — two computed facts (regressions, the file
count) never reach the panel. That is the honest line between "it works" and "it is
complete": **works = yes; complete = no.**
