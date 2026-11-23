# FULL SMOKE — v11.28 (11.12.8)
## تقرير الدخان الشامل — النسخة 11.28

> **Diagnosis + test ONLY. No application source was edited by this agent.**
> **تشخيص واختبار فقط. لم يعدّل هذا الوكيل أي ملف من ملفات التطبيق.**
> Guard: `tests/v1128-full-smoke.test.mjs` — the agent wrote only this test + this report.
> Reuses the proven v1127 harness (60-screen SSR, React #300 scan, control scan,
> real `kdx:agent:run` IPC shapes) and adds seven wave checks V1–V7.

---

## 1. الحكم — VERDICT (Arabic)

**أخضر — بصراحة، مع تحفّظات تُقال كاملة.** شغّلت السموكتين النهائيتين مرتين على الملف النهائي:
**81 اختبار، 81 نجح، 0 فشل**، بعدّات متطابقة بايت-ببايت، وexit code = 0 في المرتين.

الذي نزل فعلاً: **V1** — بطاقة REPORT/`TaskReportCard` اختفت من المحادثة؛ التقرير المكتوب
أصبح إشعاراً واحداً محلياً (`rrEmitReportToast`) مع بيانات `lastTaskReport` في المتجر.
و**V7** — الموقع حصل على ثلاثة أقسام جديدة مرئية: `OrbitConstellation` في الهيرو،
`InkFlow` في شريط الإحصاء، و`PrecisionGrid` في قسم الدليل الحيّ.

بقية الموجة سليمة وموصلة: الـ 60 شاشة كلها تُحزَّم وتُrender عبر SSR، 674 عنصر تحكّم
فُحصت بصفر تحكّم ميت، صفر محدِّد غير مستقر (React #300)، و6/6 أشكال `kdx:agent:run`
الحقيقية مرّت. لا صفوف TAINT/CLAIM-AUDIT/PROOF/REPORT في ردّ بسيط، زر PROOF واحد يعمل
بنصّ حقيقي، كرة الكونتيكس تظهر دائماً، ومسار 429 يكمل داخل نفس المزوّد.

**كونوا صادقين — ثلاث نقاط لا تُجمَّل:**
1. المهمة وصفت الواجهة بـ «W1–W5» (خمسة إصلاحات موقع). مصدر `website/app/page.tsx`
   يُظهر **ثلاثة** أقسام جديدة مُركّبة فقط، لا خمسة عناصر `<section>` جديدة. الحاجز يتحقق
   من الثلاثة الموجودة بالاسم؛ لا يدّعي وجود خمسة.
2. **مسار DNA ليس محجوزاً بالعمل الحقيقي.** شرطا `engine.ts:3868` و`:3896` ما زالا بلا
   `realWorkThisRun` — وهذا قرار منتج من v1127 (التعلّم من المحادثة نفسها). حاجز V6 يتحقق
   من التوصيل والأحداث والمستهلكين، **لا** من منع إشعار تعلّم في ردّ «سلام». شكوى «الـ DNA
   يعمل» أُجيب عنها؛ شكوى «إشعار تعلّم بلا عمل» ما زالت مفتوحة بنيوياً.
3. الفحص مصدر + SSR + مزوّد وهمي؛ ليس نقرة متصفح حقيقية ولا بناءً للموقع.

النتيجة: **أخضر للبنية التي فُحصت، وليس تفويضاً بأي شيء لم يُفحص.**

---

## 2. Verdict (English)

**GREEN — bluntly, with the caveats stated in full.** I ran the two final smoke runs twice
against the final file: **81 tests, 81 pass, 0 fail**, byte-identical count lines, exit 0
both times.

What actually landed: **V1** — the REPORT card / `TaskReportCard` is gone from the
transcript; the written report is now ONE localized toast (`rrEmitReportToast`) backed by
the `lastTaskReport` slice. And **V7** — the website gained three mounted instrument
sections: `OrbitConstellation` (hero), `InkFlow` (stats band), `PrecisionGrid` (signature).

The rest of the wave is sound and wired: all 60 screens bundle + SSR-render, 674 controls
scanned with **zero dead controls**, **zero unstable selectors (React #300)**, and **6/6
real `kdx:agent:run` param shapes** pass. No TAINT / CLAIM-AUDIT / PROOF / REPORT rows on a
plain turn; one working PROOF button with a real clipboard write; the context orb always
mounted; a 429 that continues in place on the same provider.

**Blunt caveats — three things not glossed over:**
1. The brief described the website work as **W1–W5** (five fixes). The source of
   `website/app/page.tsx` shows **three** new mounted sections, not five new `<section>`
   elements. The guard checks the three that exist by name; it does not claim five.
2. **The DNA path is not gated on real work.** The conditions at `engine.ts:3868` and
   `:3896` still lack `realWorkThisRun` — a deliberate v1127 product decision (learn from
   conversation too). V6 verifies wiring, events and store consumers; it does **not** assert
   that a two-word "salam" is free of a learning toast. The "DNA doesn't work" complaint is
   answered; the "learning toast with no work" complaint remains structurally open.
3. This is source + SSR + mocked-provider evidence — not a real browser click, not a
   website build.

Bottom line: **green for what was checked, not a licence for what was not.**

---

## 3. Exact counts — both final runs (byte-identical)

| Metric | Run 1 | Run 2 |
|---|---|---|
| Tests total / pass / fail | 81 / 81 / **0** | 81 / 81 / **0** |
| Exit code | **0** | **0** |
| Screens bundled + SSR'd | **60** | **60** |
| Screens RENDERS OK / CRASHES / UNTESTABLE | **60 / 0 / 0** | **60 / 0 / 0** |
| Controls scanned | **674** | **674** |
| Dead controls | **0** | **0** |
| Unstable selectors (React #300) | **0** | **0** |
| `kdx:agent:run` shapes pass / fail | **6 / 0** | **6 / 0** |
| Wave sub-check failures (V1–V7) | **0** | **0** |
| Duration | 40.8 s | 36.4 s |

Machine counts line (both final runs, byte-identical):

```
V1128_FULL_SMOKE_COUNTS={"screens":60,"screens_ok":60,"controls_scanned":674,"dead_controls":0,"unstable_screens":0,"taint_rows_ssr":0,"claim_audit_rows_ssr":0,"report_rows_ssr":0,"proof_rows_ssr":0,"proof_toggle_ssr":1,"proof_panel_ssr":0,"context_orb_ssr":1,"ctx_meter_ssr":false,"website_sections":7,"website_new_ids":3,"website_tx_calls":77,"engine_shapes":0,"engine_pass":0,"wave_failures":0}
V1128_FINAL_FAILURES=0
```

`engine_shapes`/`engine_pass` print as 0 in that line because test `99 · WAVE COUNTS`
runs before the engine tests; the authoritative `after()` report is **6 / 0**.

Command:

```
node --test --test-force-exit tests/v1128-full-smoke.test.mjs
```

Machine artifacts (tmp): `results.json`, `engine-results.json`, `crashes.log` under
`D:\ORION\data\cache\tmp\sadeem-v1128-full-smoke\`.
Run logs: `v1128-smoke-FINAL1.log`, `v1128-smoke-FINAL2.log` under
`D:\ORION\data\cache\tmp\opencode\`.

---

## 4. Failure ledger — every failure with file:line

**Final runs: ZERO failures.** Both `V1128_FINAL_FAILURES=0` and
`100 · FINAL FAILURE LEDGER` passed.

**Transient harness defects found and fixed during this diagnosis (NOT app defects).**
Recorded here so the green is not mistaken for luck:

| # | Where in the TEST | Symptom | Root cause | Resolution |
|---|---|---|---|---|
| 1 | `tests/v1128-full-smoke.test.mjs` — V1 Source (`between()`) | `V1 Source :: src/store.ts:1657 :: task_report publishes slice + toast, never a chat card` | `between()` matched the **first** `case 'task_report':` (evidence collector at `store.ts:1657`) instead of the transcript handler at `store.ts:4552` | Target the **last** occurrence; assert `rrCommitInto` + one localized toast at the transcript case |
| 2 | `tests/v1128-full-smoke.test.mjs` — V1 SSR fixture | `V1 SSR :: SSR plain turn :: no REPORT card / TaskReportCard / raw report JSON` | The fixture text itself contained the word “report” (`… no report.`), which the `\bREPORT\b` regex correctly flagged | Renamed the fixture to `… nothing more.`; the app was never at fault |

No application file was changed to make either failure disappear.

---

## 5. Wave-by-wave findings (file:line)

### V1 — NO REPORT card / TaskReportCard ✅
- `src/components/MessageView.tsx:2866` — `PROOF_ONLY_ROWS` now includes `'task-report'`
  at `:2869`; a stale persisted report row renders **nothing** (`:2871`). The
  `TaskReportCard` component and its `model === 'task-report'` dispatch branch are deleted.
- `src/store.ts:4552` — the transcript `case 'task_report':` calls `rrCommitInto` and
  publishes the slice + ONE localized toast; it never pushes a chat card. `reportCard()`
  is no longer called anywhere (only its definition remains).
- `src/store.ts:1739` — `rrEmitReportToast()` is the single user-facing surface;
  `:1777`, `:4091`, `:4112`, `:4873`, `:4930` are its call sites.
- SSR: a plain turn renders 0 REPORT cards; a synthetic `task-report` message renders
  an empty string. ✅

### V2 — NO taint / claim-audit / proof rows ✅
- `electron/agent/engine.ts:3423` — `realWorkThisRun` single source of truth;
  `:3447` gates `claim_audit`, `:3768` emits `proof_package` under the work gate.
- `src/components/MessageView.tsx:2866` — `PROOF_ONLY_ROWS` drops synthetic
  proof/gates/claim-audit rows at the renderer; taint UI is fully absent while
  detection (`taint.ts` / `tools.ts`) stays intact.
- SSR: 0 taint, 0 claim-audit, 0 PROOF rows on a plain turn. ✅

### V3 — ONE working PROOF button ✅
- `src/components/ProofRibbon.tsx:447` — `data-testid="proof-toggle"` /
  `pr-proof-toggle`; exactly one `<button>`, no popover/tally/panel.
- `:425–:430` — real `navigator.clipboard.writeText(summary)`; `:452` wires
  `onClick={handleProofCopy}`; `:438` — `if (!proofVisible) return null;`.
- SSR work turn: 1 toggle, 0 panels; idle turn: 0 proof UI. ✅

### V4 — Context orb ALWAYS visible ✅
- `src/components/ContextLens.tsx:91` — `const noData = !hasData;` replaced the old
  fresh-session hide gate; `:235` mounts the compact orb with an honest em-dash centre
  and "window size unknown" tip (`:179`).
- `src/components/Composer.tsx:2081` — one `<ContextLens compact />` beside the mic;
  no ChatPanel / StatusBar duplicate. ✅

### V5 — 429 continuation path ✅
- `electron/agent/providers.ts:745` — `RATE_LIMIT_BACKOFF_CAP_MS = 1000`;
  `:971` — "the user's provider is NEVER switched because of a 429"; `:986` — one
  consolidated notice; `:181` — `MAX_STREAM_CONTINUATIONS = 1` for stream-drop recovery.
- Real `streamTurn` runtime (mock 429, 429, 200): same provider retried, one
  `rate_limited` notice, zero error rows, answer continues, `stopReason === 'end_turn'`. ✅

### V6 — DNA path ✅ (with the caveat in §1/§2)
- `electron/agent/engine.ts:3870` (`learnDNAFacts`) and `:3898`
  (`learnPlaybookFacts`) are wired; `:3878` emits `dna_updated`, `:3907` emits
  `playbook_learned`; `src/store.ts` has both consumers plus the report/toast path.
- **Not asserted:** the `realWorkThisRun` gate at the two learner conditions
  (`:3868`, `:3896`). See §6. ✅ for wiring, ⚠️ for the plain-turn toast.

### V7 — Website new section markers ✅
- `website/app/page.tsx:776` — `<OrbitConstellation … className="hero-constellation" />`;
  `:787–:788` — `<div className="inkflow-band"><InkFlow … /></div>`;
  `:810` — `<PrecisionGrid className="sig-grid" … />`.
- Baseline anchors `id="watch"`, `id="playbook"`, `id="features-list"` survive;
  `tx()` bilingual copy count = **77**; `useReducedMotion` and `prefers-reduced-motion`
  guards intact. ✅
- **Blunt note:** three mounted section hooks, not five new `<section>` elements. The
  extra new visual primitives in `website/components/visuals/` (`InkReveal`,
  `CursorHalo`, `GlassLayer` update) exist but are not mounted on the homepage, so they
  were recorded as evidence, not counted as homepage section markers.

---

## 6. What this smoke does NOT prove (honest limits)

1. **Not a browser or website build.** V7 is a source-level read of `page.tsx`; no Next.js
   build, no rendered DOM, no click test.
2. **Not five website sections.** Only the three mounted homepage markers are asserted.
3. **Not the DNA real-work gate.** A plain turn may still fire a background DNA/Playbook
   call and a learning toast by product decision. The guard does not fail on it; §1/§2
   state this openly so nobody reads V6 green as "no DNA toast on 'salam'".
4. **Not the hours-long continuity / 145-tool sweep / real MCP round-trip.** Engine shapes
   are short local mock-provider turns; dead controls are a static source scan.
5. **The 429 event here is a mocked fetch**, not a live provider rate limit.

**Bottom line / الخلاصة:** البنية المفحوصة خضراء، ومرّت مرتين بـ 81/81؛ لكن «خمسة أقسام موقع» و«منع إشعار DNA بلا عمل» لم يُثبتا — لا تدّعيا ذلك.
The checked structure is green, twice, 81/81 — but "five website sections" and "no DNA
toast without work" are **not** proven here. Do not claim them.
