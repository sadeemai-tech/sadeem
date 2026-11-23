# V1121 — FINAL INTEGRATION STATUS / حالة الدمج النهائية

> **Verdict / الحكم: 🔴 RED — NOT READY TO PACKAGE / غير جاهز للتغليف**
>
> Everything is green **except** `npm test`: one REAL failing test remains and the
> suite exits 1. Do not package until it is fixed or explicitly signed off as an
> accepted known gap.
>
> كل شيء أخضر **إلا** `npm test`: هناك اختبار واحد حقيقي فاشل والمجموعة تخرج
> برمز 1. لا تُغلّف النسخة قبل إصلاحه أو اعتماده صراحةً كثغرة معروفة مقبولة.

Verification performed after all parallel agents' edits stabilized (last source
edit `2026-11-19T18:53:17Z`; no further edits for 15+ minutes). An earlier full
run (`966 / 944 pass / 6 fail`) was **discarded** because agents edited
`src/i18n.ts` and `src/components/panels/SkillsPanel.tsx` *during* that run. All
numbers below are from the clean re-run on stable code.

تم التحقق بعد استقرار تعديلات جميع الوكلاء المتوازيين (آخر تعديل للمصدر
`2026-11-19T18:53:17Z`؛ لا تعديلات لاحقة لأكثر من 15 دقيقة). تم **إلغاء** تشغيل
كامل سابق (`966 / 944 ناجح / 6 فاشل`) لأن الوكلاء عدّلوا `src/i18n.ts` و
`src/components/panels/SkillsPanel.tsx` *أثناء* ذلك التشغيل. كل الأرقام أدناه
من إعادة التشغيل النظيفة على كود مستقر.

---

## 1. Results / النتائج

| Gate / البوابة | Result / النتيجة | Detail / التفاصيل |
|---|---|---|
| `tsc --noEmit -p tsconfig.json` | ✅ PASS | exit 0 |
| `tsc --noEmit -p tsconfig.node.json` | ✅ PASS | exit 0 |
| `node scripts/gen-tool-inventory.mjs` | ✅ PASS | **145** tools (`fs:55, exec:60, meta:30`); `src/generated/toolInventory.json.total = 145` |
| `npm run build:electron` | ✅ PASS | exit 0 (main.js 2.6 mb, preload.js 19.9 kb) |
| `npm run build:cli` | ✅ PASS | exit 0 (kodex.cjs 1.6 mb) |
| `npm test` | 🔴 **FAIL** | **966 tests · 947 pass · 3 fail · 16 skipped · exit 1** (744,041 ms) |
| `npm run build` | ✅ PASS | exit 0; `✓ built in 1m 13s`; post-build: webcraft kit (37,818 B), 15 built-in skills, CSP hashes + boot watchdog injected |
| Live site `/`, `/docs`, `/download` | ✅ PASS | all HTTP 200, Arabic RTL, v11.12.0 content served |

---

## 2. Every `not ok` in the final `npm test` / كل حالات الفشل

| # | Test / file:line | Error | Classification / التصنيف |
|---|---|---|---|
| 1 | `tests/v1110-subsystems.test.mjs:358` — *A7 mcp: full engine run — model calls the discovered MCP tool* | `MCP tool result reached the engine` | ⚪ **FLAKY** — passed 2/2 in isolation (`--test-name-pattern`) |
| 2 | `tests/v1111-antifreeze.test.mjs:299` — *a: 20k tiny deltas flush as coalesced batches — final text complete and ordered* | `run finished fast (30229ms)` | ⚪ **FLAKY** — passed 2/2 in isolation; timing threshold under 4-way concurrency |
| 3 | `tests/v1121-proof-truth.test.mjs:241` — *3. opening the panel renders the real gate ledger (names + verbatim engine detail)* | `ledger shows verbatim engine detail: 0 files · 1/1 commands ok · 1 rounds` | 🔴 **REAL** — failed 2/2 in isolation |

Each failure was re-run **twice in isolation** (per gate requirement). Only #3 is
reproducible and therefore blocks packaging.

تمت إعادة كل حالة فشل **مرتين بمعزل**؛ الحالة رقم 3 فقط قابلة للتكرار وهي التي
تمنع التغليف.

### Additional failures seen only in the discarded first run / فشل ظهر في التشغيل الأول الملغى فقط
* `tests/v1110-endurance.test.mjs:475` — *zero-byte stream beyond the idle window → watchdog fires and the retry succeeds* — `retry fired by the WATCHDOG (600ms window), not the 2.5s socket cleanup` — ⚪ FLAKY (2/2 pass in isolation).
* `tests/v1110-subsystems.test.mjs:233` — *A7 skills: REAL engine run — model invokes use_skill…* — `engine injected the skill index into the REAL system prompt` — ⚪ FLAKY (2/2 pass in isolation).
* `tests/v1118-i18n-clean.test.mjs:149` — *every EN value … free of Arabic letters* — `onboard.caps.arabic` — fixed by a mid-run agent edit to `src/i18n.ts` (18:42:23Z); 2/2 pass afterwards. No longer present.
* `tests/v1118-i18n-clean.test.mjs:156` — *every AR value … free of English prose* — `onboard.caps.latin` — same as above; fixed, 2/2 pass afterwards. No longer present.

---

## 3. Known issue that blocks the gate / الثغرة المعروفة التي تمنع البوابة

**Proof Center ledger — verbatim engine detail missing** (`tests/v1121-proof-truth.test.mjs:241`).
Opening the Proof Center renders gate names and tone correctly (`>passed<`,
"Proof Center in one line"), but the exact engine-emitted detail string
`0 files · 1/1 commands ok · 1 rounds` is **not present** in the rendered ledger.
This test is new in the v11.21 campaign and fails consistently on stable code.

Context already documented in the test itself (lines 259–262): the engine emits
receipt files as **path strings** (`electron/agent/engine.ts:3826`,
`[...touchedFiles]`) while `src/store.ts:1698` filters them to **objects**, which
is why the real detail reads `0 files`. That store-side mismatch is a separate
documented gap (`PROOF-TRUTH.md`); the immediate blocker is the missing verbatim
detail row in `ProofRibbon`/its ledger state.

**الحكم:** يوجد سطر تفصيل ناقص في سجل مركز الإثبات؛ الاختبار جديد ويفشل بثبات.
سبب جانبي موثّق: المحرك يرسل أسماء ملفات كنصوص (`engine.ts:3826`) بينما
`store.ts:1698` يفلترها ككائنات، لذلك تظهر `0 files`.

---

## 4. Static acceptance checks / فحوص القبول الساكنة

| Check / الفحص | Result | Evidence / الدليل |
|---|---|---|
| `arena` / `scaffold` in **app source** | ✅ **0** | No hits in `src/`, `electron/`, `shared/`. The only 4 hits are *inside test guards* that assert absence: `tests/v1113-audit.test.mjs:163,168` and `tests/v1116-capability-guide.test.mjs:18,181` — expected, not violations. |
| No versioned CSS | ⚠️ **1 pre-existing file** | `src/assets/glass-v7.css` (mtime 2026-11-18, imported by `src/styles.css:2`). It is legacy art, **not introduced by this campaign**; no new versioned CSS was added. `voice-input.css` is unversioned as required. |
| No `tools.slice(0, N)` | ✅ in the guarded path | `electron/agent/providers.ts` has **zero** `tools.slice(0,…)` — the `v1118-no-tool-slicing` test passes (loc-based single-tool removal intact). Two *unrelated* caps remain outside that path: `electron/agent/subagentRunner.ts:77` (`o.tools.slice(0, Math.min(40, …))`, subagent budget) and `electron/agent/engine.ts:566` (`tools.slice(0, Math.min(14, …))`, prompt name sample ending in "… and more"). Neither narrows the main agent's advertised tool set. |
| Focus-mode CSS present | ✅ | `src/components/shell.css:71–133` — 15 `html[data-focus='on'] …` rules; `src/App.tsx:227` mirrors `focusMode` onto `<html data-focus>`. |
| Circle present in ChatPanel | ✅ | `src/components/ChatPanel.tsx:820–857` — precise `<circle>` rings `r="26"/"18"/"10"`, integer breathing extremes, 12-o'clock tick, calibration arc, orbiting node; compact `CompactThinkingOrbit` at `src/components/MessageView.tsx:590` and mounted at `:3685`. `v1121-circle.test.mjs` passes. |
| Skills React `#300` fix (B1) | ✅ | `src/components/panels/SkillsPanel.tsx:398` — `loadRivals` `useCallback` is now **above** the early returns at `:403` (`if (openSlug)`) and `:406` (`if (creating)`). Both `v1121-panels-smoke.test.mjs` tests (unstable selector + hook-after-return) and the v11.21 "ALL hooks are above the conditional early returns" test pass. |

---

## 5. Website / الموقع

Checked via webfetch on `https://sadeem-website-theta.vercel.app`:

* `/` → 200, Arabic RTL landing page, "v11.12.0", "حمّل الآن", BYOK / PLAYBOOK / MCP / WORKTREES sections.
* `/docs` → 200, "الدليل الميداني / 11.12", 11 sections, all Arabic RTL.
* `/download` → 200, Windows x64 v11.12.0, NSIS + portable ZIP, real SHA-256 values displayed.

⚠️ **Content mismatch:** the live homepage renders **"142 أدوات حقيقية"** (also "142 أدوات") while the source-of-truth generator emits **145** tools. The `/docs` tool-profile section says "~١٣٤" for the full profile. These are static site copy values, not a runtime tool defect, but they contradict the shipped inventory and should be corrected before publication.

⚠️ **عدم تطابق في المحتوى:** الموقع يعرض «١٤٢ أداة حقيقية» بينما المولّد في المصدر يُنتج ١٤٥ أداة، وصفحة الدليل تقول «~١٣٤». قيم نصية ثابتة تحتاج تصحيحاً.

---

## 6. Bottom line / الخلاصة

* **GREEN:** both typechecks, tool inventory = 145, bundle rebuilds, production build, live website (3 pages), arena/scaffold = 0, focus-mode CSS, circle, Skills #300 fix.
* **RED:** `npm test` → 947/966 with 1 reproducible REAL failure (`v1121-proof-truth.test.mjs:241`). Three other observed failures were FLAKY (pass 2/2 in isolation) and two i18n failures were caused by a mid-run edit and are gone.
* **Decision:** 🔴 **DO NOT PACKAGE** until the Proof Center ledger failure is resolved or formally accepted. Two website copy numbers (142 / 134 vs 145) should also be fixed.

**أخضر:** الفحوص الساكنة والبناء والموقع. **أحمر:** اختبار واحد حقيقي فاشل في
`v1121-proof-truth.test.mjs:241`. **القرار: لا تُغلّف النسخة** قبل حله أو اعتماده.
