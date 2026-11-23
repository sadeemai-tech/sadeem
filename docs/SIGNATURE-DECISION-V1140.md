# SIGNATURE DECISION V1140 — what the 3 instruments do, and the merge call
# قرار الساينكتشر — ماذا تفعل الأدوات الثلاثة، وقرار الدمج

> Decision-support subagent, 2026-11-22. **Read-only research**:
> `electron/agent/signatureFeatures.ts`, `src/components/SignaturePanel.tsx`,
> `electron/agent/dna.ts`, `src/components/panels/DnaPanel.tsx`,
> `src/components/panels/registry.tsx`, `docs/SIGNATURE-FEATURES-V1138.md`.
> **No source file was edited by this wave.** The parent decides + implements.
> وكيل بحث فقط؛ لم أعدّل أي ملف كود. الأب يقرّر وينفّذ.

---

## 0. القرار باختصار / Decision in one line

**AR:** أؤكد قرار الأب: **دَمج DNA Autopsy داخل صفحة الحمض النووي**
كقسم «DNA Insights / رؤى الحمض»، و**الإبقاء على الساينكتشر للأداتين
الحقيقيتين الفريدتين**: Trajectory Replay و Capability Compass.
السبب: Autopsy لا يضيف «ميزة»، بل يضيف **تفسيرًا + إثبات ظهور في الموجّه**
فوق نفس بيانات `dna.json` التي تعرضها صفحة DNA أصلًا. تكرار عرض نفس
الحقائق في مكانين هو بالضبط ما أربك المؤسس («هل تشبه الـ DNA؟»).

**EN:** I confirm the parent's decision: **merge DNA Autopsy into the DNA rail
page** as a "DNA Insights / رؤى الحمض" section, and **keep Signature for the
two genuinely unique instruments** — Trajectory Replay and Capability Compass.
Autopsy adds explanation + prompt-visibility proof, not new data; showing the
same learned facts in two rails is exactly what caused the founder's
confusion. One refinement is proposed in §4.

---

## 1. ماذا تفعل الأدوات الثلاثة فعلًا؟ / What they actually do (plain language)

All three are **pure functions**: no LLM call, no file write, no new IPC.
They only transform data SADEEM already persists. Empty stores return explicit
codes (`NO_LEDGER_DATA` / `NO_DNA_LEARNED` / `EMPTY_INTENT`), never sample rows
(`signatureFeatures.ts:4-29`, `:361`, `:616`, `:817`).

### 1.1 Trajectory Replay — «شغّل الفيديو من دفاتر سديم الثلاثة»
**AR:** يعيد بناء أي تشغيل (session) خطوة بخطوة من ثلاثة سجلات حقيقية:
رسائل الجلسة (`sessions/*.json`) تعطي **مدخلات الأدوات** (وسائط JSON حقيقية)
و**مخرجاتها** (نصوص حقيقية)؛ وسجل التشغيل JSONL يعطي **المدد الزمنية**
الحقيقية (`ms`) وأحداثًا مثل `task_report`/`finish`؛ والتتبّع (`traces`)
يعطي **حجم النتيجة** (`chars`). كل خطوة تُسمّي مصدرها (`session|journal|trace`).
إن وُجدت نتيجة بلا استدعاء مطابق يُقال ذلك صراحة (`unpairedResult`) بدل لصقها
باستدعاء عشوائي. الحد الأقصى ١٦٠ خطوة / ١٢٠٠ حرف، ويُعلَن القطع.
**EN:** Rebuilds a run step-by-step from three real ledgers: session messages
(real tool args + real outputs), the crash-resilient journal (real durations +
milestones), and the trace (real output sizes). Each step names its own source;
an unpaired result is flagged, never silently attached. No invented timestamp
for trace-only runs (`TraceStep.t` is relative). Engine:
`signatureFeatures.ts:197-374`; UI: `SignaturePanel.tsx:283-326`.

### 1.2 DNA Autopsy — «كيف تعلّمنا، ومن أين، وهل سيراه النموذج؟»
**AR:** لكل نمط محفوظ في `dna.json` يعرض: الثقة **المحفوظة**، عدد التكرار،
القاعدة التي جاءت منها (`min(0.95, 0.4 + 0.15 × count)` من `dna.ts:478`)،
أول/آخر ظهور، والأدلة الحقيقية (ملاحظاتك، تغييرات الدليل الحي، حقائق السجل)
التي تتقاسم كلمات مع النمط. ويحسب علامة `promptVisible` بـ**نفس قاعدة الاختيار**
التي يستخدمها باني الموجّه (`dna.ts:623-646`) — أحدث ٤ ثم الأعلى درجة
`confidence × exp(-age/21d)` حتى ٨ مقاعد. القيمة المحفوظة غير المطابقة للقاعدة
تُوسم `LEGACY_CONFIDENCE` ولا تُصحَّح صامتة. كل التفسيرات توجيهية
(`ADVISORY_DERIVED_FROM_STORED_FIELDS`) وليست ادعاءً من الذكاء عن نفسه.
**EN:** Explains each **stored** pattern: stored confidence, repetition count,
the exact rule behind it, sightings, and real evidence linked by token overlap.
Its unique addition is `promptVisibleIds()` (`signatureFeatures.ts:472-500`):
it mirrors the real prompt-builder rule so you can see whether a learned fact
will be injected into the next system prompt. Engine:
`signatureFeatures.ts:516-628`; UI: `SignaturePanel.tsx:329-355`.

> **هذه هي النقطة التي أربكت المؤسس:** Autopsy يقرأ **نفس** `dna` الذي تعرضه
> صفحة DNA؛ لا يعلّم شيئًا جديدًا ولا يكتب شيئًا. هو «عدسة تفسير»، لا «ميزة
> تعلّم» مستقلة. / This is the source of the confusion: Autopsy reads **the
> same** `dna` object the DNA page shows; it neither learns nor writes.

### 1.3 Capability Compass — «أي أداة حقيقية تناسب نيّتك، وأي أداة لم تستخدمها؟
**AR:** يقيّم **مخزون `CORE_DEFS` الحقيقي (١٤٥ أداة)** مقابل ما تكتبه:
كلمات الاسم والوصف وجمل «Use when…». ويستخرج من أوصاف الأدوات نفسها جمل
«لا تستخدم X — استخدم Y» ليصنع رسم توجيه قابل للتدقيق
(`list_dir → search_files`)، فيرفع أداة ويخصم الأخرى. ثم يقارن بأسماء
الاستدعاءات الحقيقية من السجل ليعطي `called/inventory/percent`، ويسمّي
الأدوات خارج المخزون `unknownNames`، ويعرض «قدرات لم تُستخدم» مع تلميح
منقول حرفيًا من وصف الأداة. هذا هو التجسيد العملي لمطلب «الذكاء يستخدم كل
الأدوات»: لا يمكنك استخدام أداة لا تراها.
**EN:** Scores the **real 145-tool inventory** against a typed intent, mines
the descriptions' own "Do NOT use X — use Y" sentences into an auditable
routing graph, and joins it with real ledger call counts to expose unused
capabilities with verbatim hints. Nothing is recommended outside `CORE_DEFS`.
Engine: `signatureFeatures.ts:642-828`; UI: `SignaturePanel.tsx:357-442`.

---

## 2. هل DNA Autopsy يكرّر الـ DNA؟ نعم — بالأدلة / Does it duplicate DNA? Evidence

| Fact | DNA rail page | DNA Autopsy (Signature tab) |
|---|---|---|
| Same store | `useStore(s => s.dna)` — `DnaPanel.tsx:226`, loaded via `api.dnaGet` (`store.ts:5353-5361`, `api.ts:682`) | `useStore(s => s.dna)` — `SignaturePanel.tsx:180`, passed to `autopsyDNA({dna})` at `:242` |
| Same patterns rendered | patterns table with kind, text, confidence meter, ×count, lastSeen — `DnaPanel.tsx:513-567` | identical fields + `confidenceBasis`, firstSeen, evidence — `signatureFeatures.ts:526-586` |
| Same profile | profile chips/add/remove — `DnaPanel.tsx:469-511` | profile values as `profile:<field>` findings with `confidence: null` — `signatureFeatures.ts:588-610` |
| Same feedback | feedback timeline — `DnaPanel.tsx:569-629` | feedback notes used as `evidence` — `signatureFeatures.ts:532-541` |
| Same stats | sessions/facts/patterns tiles — `DnaPanel.tsx:435-457` | `summary.factsRecorded/sessionsObserved/activePatterns` — `signatureFeatures.ts:617-625` |
| Management | edit profile, remove pattern, forget feedback, clear all, skills-trust, playbook — `DnaPanel.tsx:270-292,362-392,552-561,611-623` | **none — read-only** |
| Real added value | — | provenance per fact + **prompt-visibility proof** — `signatureFeatures.ts:471-500,568-569,626` |

**Verdict / الحكم:** This is a **different view of the same data**, not a new
instrument. The DNA rail is the *write/manage* surface; Autopsy is a *read/
explain* surface. Two rails showing the same learned patterns is genuinely
confusing (the founder literally asked "هل هي تماماً تشبه الDNA؟"). The
distinct value — "from what evidence, and will the model see it next time" —
belongs **inside** the DNA page, next to the patterns it explains.

**Important honesty:** Autopsy is **not** byte-for-byte identical to the DNA
panel: it adds `confidenceBasis`, `LEGACY_CONFIDENCE`, evidence links, and the
prompt-visibility mark. Do **not** delete that value. **Move it**, do not drop
it. Also do not claim the other two tools are "the only signature features in
the industry" — session timelines exist elsewhere; our specific three-ledger
provenance join and the real-inventory coverage compass are what is ours.

---

## 3. التوصية / Recommendation (parent to implement)

### CONFIRMED: MERGE + REBRAND, with one refinement

1. **Move the Autopsy UI, keep the engine.**
   Port `FindingRow` (`SignaturePanel.tsx:122-167`) and the Autopsy section
   (`:329-355`) into `DnaPanel.tsx` as a collapsible **"DNA Insights /
   رؤى الحمض"** section — ideally right after the learned-patterns section
   (`DnaPanel.tsx:513-567`) so the explanation sits beside the fact it explains.
   Keep `autopsyDNA()` and `promptVisibleIds()` untouched in
   `signatureFeatures.ts`; they are already data-honest and guarded against
   drift by `tests/v1138-signature.test.mjs` (mirror of `dna.ts:53-68,623-646`).
2. **No new IPC, no second load.** Both panels read the same `useStore(s=>s.dna)`
   (`DnaPanel.tsx:226`, `SignaturePanel.tsx:180`); `autopsyDNA({dna})` is pure.
   Reuse the store value; do not add another `api.dnaGet` call.
3. **Refinement to the parent's call:** after the move, keep `SIGNATURE_FEATURES`
   (`signatureFeatures.ts:831-835`) as the honest *engine* manifest — all three
   APIs still exist — but update the docs UI map so it no longer says all three
   live on rail 16. If you want the manifest to describe UI homes, add a `ui`
   field rather than deleting the autopsy row; the tests read this manifest.
4. **Signature now has two tabs.** Rebuild `SignaturePanel.tsx` with only
   `REPLAY` and `COMPASS`; rename the rail title from vague "Signature /
   بصمة سديم" to something self-explanatory, e.g. **"Run Intelligence /
   استخبارات التشغيل"**, and update the i18n key accordingly
   (`registry.tsx:88`, `docs/SIGNATURE-FEATURES-V1138.md:136-156` handoff).
5. **Do not claim a new feature was invented.** The merge is a UX correction:
   it removes a duplicate home for the same facts and puts the explanation
   where the user already looks. The two remaining instruments are genuinely
   unusual in this exact form (three-ledger provenance join; routing graph
   mined from the model's own tool descriptions + real coverage).

### Why NOT the alternatives
- **Keep separate:** two rails show the same DNA facts → the exact confusion
  the founder reported. Reject.
- **Rebrand Autopsy as a new feature without moving it:** cosmetic; the data
  duplication remains. Reject.
- **Delete Autopsy entirely:** throws away the only prompt-visibility proof we
  have (`promptVisibleIds`) and the drift guard. Reject.
- **Merge everything (all three) into DNA:** nonsense — replay and compass do
  not read `dna.json`. Reject.

---

## 4. What this wave did NOT do

No source file was changed. No rail was promoted, no tab removed, no doc from
v11.38 was rewritten. This document is a decision record for the parent; the
parent implements and verifies (`tsc`, `tests/v1138-signature.test.mjs`,
`tests/v1131-ui-shell.test.mjs`, `tests/v1131-registry.test.mjs`).
لم أعدّل أي كود؛ هذا سجل قرار فقط، والتنفيذ والتحقق من مسؤولية الأب.
