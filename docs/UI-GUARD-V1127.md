# UI GUARD — v11.27 — حارس الواجهة

_test: `tests/v1127-ui-guard.test.mjs` · run: `node --test --test-force-exit tests/v1127-ui-guard.test.mjs`_

---

## الحكم (Arabic)

**فاشل — FAIL.** من أصل 14 فحصاً: 13 نجحوا وواحد فشل. الإصلاحات F3 (زر PROOF) وF4 (دائرة الكونتيكس) نزلت وعملت. إصلاح F1 ناقص: قسم الإثبات ما انحذف من `MessageView.tsx` — بس تم تعطيله بـ `PROOF_ONLY_ROWS` (سطر 3363). الأزرار/البطاقات ميتة لكنها لسه موجودة في الكود. المؤسس قال "شيله بلكامل... لا تترك له أثر" — وهذا ما صار.

الصفوف المرفوضة اللي لسه في المصدر (احذفها كلها، مع مستورداتها وأنماط CSS الخاصة بها):

| الملف:السطر | المطلوب حذفه |
|---|---|
| `src/components/MessageView.tsx:2382` | `function ProofCard` |
| `src/components/MessageView.tsx:2419` | `function ClaimAuditRow` |
| `src/components/MessageView.tsx:2464` | `function MutationCheckRow` |
| `src/components/MessageView.tsx:3394` | فرع التوجيه `model === 'proof'` |
| `src/components/MessageView.tsx:3397` | فرع التوجيه `model === 'mutation-gate'` |
| `src/components/MessageView.tsx:3400` | فرع التوجيه `model === 'red-green'` |
| `src/components/MessageView.tsx:3403` | فرع التوجيه `model === 'fake-tests'` |
| `src/components/MessageView.tsx:3407` | فرع التوجيه `model === 'claim-audit'` |
| `src/components/MessageView.tsx:3410` | فرع التوجيه `model === 'mutation-check'` |

ملاحظة إنصاف: فحوص SSR (A3/A4) نجحت — أي رسالة Synthetic بهذه الموديلات ما بترسم أي صف إثبات؛ التعطيل بالـ early-return شغال بصرياً. بس "لا أثر" يعني حذف الكود الميت، مش تعطيله. الحكم يبقى FAIL لحد ما انحذف.

**إجراء مطلوب من الأب:** أرسل F1 ليمسح الأسطر التسعة أعلاه + `PROOF_ONLY_ROWS` (3363-3369) وأي مستوردات/أنماط ميتة، ثم أعد تشغيل الاختبار. لا تلمس المصدر من هذا الحارس.

---

## Verdict (English)

**FAIL.** 13 of 14 checks pass; 1 fails. F3 (PROOF button) and F4 (context orb) have landed and verify clean. F1 is incomplete: the proof section was NOT deleted from `MessageView.tsx` — it was merely disabled behind the `PROOF_ONLY_ROWS` early-return (`MessageView.tsx:3363`). The rejected components are dead but still present in source. The founder said "remove it completely — leave no trace." That has not happened.

The rejected proof rows still in source — delete **all** of them (plus their imports and any dead CSS):

| File:line | Must be removed |
|---|---|
| `src/components/MessageView.tsx:2382` | `function ProofCard` |
| `src/components/MessageView.tsx:2419` | `function ClaimAuditRow` |
| `src/components/MessageView.tsx:2464` | `function MutationCheckRow` |
| `src/components/MessageView.tsx:3394` | `model === 'proof'` dispatch branch |
| `src/components/MessageView.tsx:3397` | `model === 'mutation-gate'` dispatch branch |
| `src/components/MessageView.tsx:3400` | `model === 'red-green'` dispatch branch |
| `src/components/MessageView.tsx:3403` | `model === 'fake-tests'` dispatch branch |
| `src/components/MessageView.tsx:3407` | `model === 'claim-audit'` dispatch branch |
| `src/components/MessageView.tsx:3410` | `model === 'mutation-check'` dispatch branch |

Fair note: the SSR checks (A3/A4) pass — a synthetic message with any of these models renders no proof row; the early-return suppression works visually. But "leave no trace" means deleting the dead code, not gating it. The verdict stays FAIL until that deletion lands.

**Action for the parent:** dispatch F1 to remove the nine lines above plus the `PROOF_ONLY_ROWS` gate (3363-3369) and any now-dead imports/CSS, then re-run this guard. This guard never edits source.

---

## What passed / ما نجح

| Check | Result |
|---|---|
| A1 — `TaintRow` + taint dispatch deleted from MessageView (source) | PASS |
| A3 — taint synthetic message renders no taint/proof markup (SSR) | PASS |
| A4 — every proof-ish synthetic model renders nothing proof-like (SSR) | PASS |
| B1 — one small `pr-proof-toggle` button, NOT disabled, with `onClick` (source) | PASS |
| B2 — onClick uses real `navigator.clipboard.writeText` + store `notify`; no popover/tally/ledger (source) | PASS |
| B3 — proof evidence renders ONE enabled button, no ledger (SSR) | PASS |
| B4 — plain chat turn renders ZERO proof UI (`return null`) (SSR) | PASS |
| B5 — clicking PROOF actually writes to clipboard and fires `notify` (runtime) | PASS |
| C1 — no `!hasData` visibility gate; `const noData = !hasData` (source) | PASS |
| C2 — zero usage: compact orb mounted, honest `—`, empty exact 2πr arc (SSR) | PASS |
| C3 — real usage: exact unrounded arc at 25% and 50% (SSR) | PASS |
| C4 — one orb beside the mic; no header/status-bar duplicate; no strip (source) | PASS |
| C5 — fixed, viewport-clamped popover; reduced-motion guards (source) | PASS |
| **A2 — rejected proof-ish rows deleted from MessageView (source)** | **FAIL — 9 remnants listed above** |

## Method / الطريقة

The guard bundles the **real** `store`, `MessageView`, `ProofRibbon` and `ContextLens` with esbuild, SSRs them via `renderToStaticMarkup`, and invokes the captured PROOF `onClick` with a mocked clipboard + store `notify` spy (no DOM library needed). Every assertion prints an exact `file:line` of the offending source. No application source was modified.

يحزم الحارس المكوّنات الحقيقية والمتجر بالـ esbuild، ويعرضها بـ SSR، ويستدعي زر PROOF فعلياً بمحاكاة الحافظة — بدون تعديل أي ملف مصدر.

_Re-run after F1 lands: `node --test --test-force-exit tests/v1127-ui-guard.test.mjs` — expect 14/14._
