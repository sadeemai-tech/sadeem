# TOOLS V1134 — "all tools usable" verification guard / حارس التحقق من «كل الأدوات قابلة للاستخدام»

- Date: 2026-11-21
- Test: `tests/v1134-tools-guard.test.mjs`
- Machine evidence: `tests/.v1134-tools-guard.results.json`
- Run: `node --test --test-force-exit tests/v1134-tools-guard.test.mjs`
- Scope: DIAGNOSIS + TEST ONLY — no source was modified by this guard.

---

## VERDICT / الحكم

**EN — REAL, NOT PROFILE THEATER — with one bookkeeping defect.**
Profiles do **not** delete, disable or refuse any tool. They change only which
JSON schemas are *advertised* to the model. All **145** registered defs dispatch
to live executors (**145/145**, zero "Unknown tool", zero crashes), and a tool
hidden from `essential` still executes by its exact name (**8/8** probed, zero
profile refusals). `full` really is the complete registry.

**But** the build-time inventory and the live registry disagree:
`gen-tool-inventory` reports **145** while the engine actually advertises **146**.
`preview_open` is injected only into `getToolDefs()` at
`electron/agent/tools.ts:1189`, so the generator — which parses **only**
`electron/agent/tool-defs.ts` (`scripts/gen-tool-inventory.mjs:12,14`) — cannot
see it. The founder's question "can the app REALLY use all the tools?" is
**YES**. The Settings inventory card's number is **wrong by one**.

**AR — حقيقي وليس «تمثيلَ ملفات»، مع عيب واحد في الجرد.**
ملفات الأدوات (profiles) لا تحذف ولا تعطّل ولا ترفض أي أداة؛ هي تقتصر على تغيير
مخططات JSON «المُعرضة» للنموذج فقط. جميع الأدوات الـ145 المسجّلة تصل إلى منفّذ
حقيقي (**145/145**، بلا أي «أداة غير معروفة» وبلا أي انهيار)، والأداة المخفية من
ملف `essential` تعمل عند استدعائها باسمها بالضبط (**8/8**، بلا أي رفض بسبب الملف).
ملف `full` هو السجل الكامل فعلاً.

**لكن** جرد البناء يختلف عن السجل الحي: `gen-tool-inventory` يقول **145** بينما
المحرّك يعرض فعلياً **146**. الأداة `preview_open` تُحقن داخل `getToolDefs()` فقط
في `electron/agent/tools.ts:1189`، لذا لا يراها المولّد الذي يقرأ
`electron/agent/tool-defs.ts` وحده (`scripts/gen-tool-inventory.mjs:12,14`).
الجواب على سؤال المؤسس «هل يستطيع التطبيق فعلاً استخدام كل الأدوات؟» هو **نعم**.
لكن الرقم في بطاقة الجرد بإعدادات التطبيق **خاطئ بواحدة**.

---

## RESULT MATRIX / جدول النتائج

| # | Guard / الحارس | Result / النتيجة | Detail / التفصيل | file:line |
|---|---|---|---|---|
| 1a | gen-tool-inventory output / ناتج المولّد | ✅ PASS | `total=145`, `tools=145` | `scripts/gen-tool-inventory.mjs:14,63` → `src/generated/toolInventory.json` |
| 1b | `defsForProfile('full')` | ✅ PASS | `CORE_DEFS=145`, `full=145`, 145 unique names | `electron/agent/tool-defs.ts:30,2143-2144` |
| 1c | Stable profile tag / وسم ملف مستقر | ✅ PASS | all 145 have `kind ∈ {fs,exec,meta,mcp}` + deterministic, reproducible membership; **no explicit per-def `profile` field** | `electron/agent/providers.ts:21-30`, `tool-defs.ts:2091,2116` |
| 1d | Live executor per def / منفّذ حقيقي لكل أداة | ✅ PASS | **145/145** dispatch, 0 Unknown tool, 0 crashes | `electron/agent/tools.ts:1215,1222,1269` |
| 2 | Excluded tool still callable / الأداة المستبعدة تعمل بالاسم | ✅ PASS | **8/8** probes (`pdf_make`, `debug_start`, `notebook_read`, `media_ffmpeg`, `lsp_hover`, `pptx_make`, `browser_console`, `preview_open`) executed while hidden from `essential`; 0 profile refusals; 106 tools excluded | `electron/agent/tools.ts:1222` (full registry), `tool-defs.ts:2143-2147` |
| 3 | Engine profile respected / المحرّك يحترم الملف | ❌ **FAIL** | engine advertises `essential=40, balanced=121, full=146`; inventory/defs say `full=145`; extra advertised: `["preview_open"]` | `electron/agent/tools.ts:1189`; `scripts/gen-tool-inventory.mjs:12,14`; `engine.ts:2615` |
| 4 | No `tools.slice(0,N)` / لا اقتطاع ثابت | ✅ PASS | none on defs sent to provider; only one-at-a-time `splice(index,1)` on validation error; 3 prompt/hint-only name-list slices verified benign | `electron/agent/providers.ts:1785-1797`, `engine.ts:2615`, `subagentRunner.ts:98`, `engine.ts:609`, `tools.ts:1237` |

Run summary: **5 tests, 4 pass, 1 fail** — `V1134-VERDICT: FAILURES-PRESENT`.

---

## THE ONE FAILURE / الفشل الوحيد

**Registry drift — the inventory is stale by one tool.**
انحراف السجل — الجرد قديم بأداة واحدة.

- `getToolDefs([], 'full')` returns **146** defs. `defsForProfile(CORE_DEFS, 'full')`
  and `src/generated/toolInventory.json` return **145**. The extra name is
  `preview_open`. / تُعيد `getToolDefs([], 'full')` 146 تعريفاً، بينما تُعيد
  `defsForProfile` والجرد 145. الاسم الزائد هو `preview_open`.
- Root cause (`electron/agent/tools.ts:1152-1170,1189`): `PREVIEW_OPEN_DEF` is
  declared in **tools.ts** (next to its executor) and pushed into the fresh copy
  returned by `getToolDefs`, instead of living in `CORE_DEFS` in **tool-defs.ts**.
  / السبب: التعريف مُعلَن في `tools.ts` ويُضاف إلى نسخة `getToolDefs` بدل أن يكون
  داخل `CORE_DEFS` في `tool-defs.ts`.
- Why the generator misses it (`scripts/gen-tool-inventory.mjs:12,14`): it reads
  **only** `electron/agent/tool-defs.ts` and regex-parses `const CORE_DEFS`. It has
  no visibility into `PREVIEW_OPEN_DEF`. / المولّد يقرأ `tool-defs.ts` فقط ولا يرى
  التعريف المضاف في `tools.ts`.
- Impact: real and low severity — the model **does** get `preview_open` (and its
  executor exists at `electron/agent/tools.ts:1499`, so it works). The Settings
  "Tool inventory" card and any 145-based assertion are simply out of date.
  / الأثر حقيقي ومنخفض الخطورة: النموذج يستلم الأداة فعلاً والمنفّذ موجود، لكن
  بطاقة الجرد و أي تحقق يعتمد على الرقم 145 أصبحا قديمين.
- Fix directions for parent (NOT applied — test-only task): move
  `PREVIEW_OPEN_DEF` into `CORE_DEFS` in `tool-defs.ts` and delete the push at
  `tools.ts:1189`, then run `node scripts/gen-tool-inventory.mjs`; OR teach the
  generator to merge executor-local defs. Either way regenerate
  `src/generated/toolInventory.json` and re-run this guard.
  / اتجاهات الإصلاح (لم تُطبَّق): انقل التعريف إلى `CORE_DEFS` واحذف الإضافة في
  `tools.ts:1189`، أو علّم المولّد دمج التعريفات المحلية، ثم أعد توليد الجرد وأعد
  تشغيل الحارس.

---

## WHAT I VERIFIED IS **NOT** BROKEN / ما تحققتُ أنه **ليس** مكسوراً

1. **Profiles are advertising-only.** `executeTool` resolves every call against
   the **full** registry (`electron/agent/tools.ts:1222` calls
   `getToolDefs(ctx.mcpServers)` with no profile argument). There is no code path
   that returns "tool not available in your profile". The prompt even tells
   advanced tools to remain callable (`electron/agent/prompts.ts:769`,
   `subagentRunner.ts:105`).
   / الملفات تُغيّر العرض فقط؛ الاستدعاء يُحلّ دائماً مقابل السجل الكامل، ولا يوجد
   مسار يرفض أداة بسبب الملف.
2. **Profile membership is stable.** `essential ⊆ balanced ⊆ full` verified by
   set containment; repeated `defsForProfile` calls return identical ordered
   lists. MCP tools survive every profile.
   / عضوية الملفات مستقرة ومتطابقة، وأدوات MCP تبقى في كل الملفات.
3. **Engine honors the selection.** `electron/agent/engine.ts:2615` passes
   `cfg.toolProfile ?? 'balanced'` to `getToolDefs`; `subagentRunner.ts:201-207`
   inherits the parent profile and explicitly does not silently upgrade to
   `full`. / المحرّك يمرّر الملف المختار، والوكيل الفرعي يرثه دون ترقية صامتة.
4. **No fixed-size tool truncation.** The only three `tools.slice(0,…)` sites are
   **prompt/hint text** (`engine.ts:609` refusal-recovery nudge,
   `subagentRunner.ts:98` specialist prompt, `tools.ts:1237` unknown-tool hint) —
   none touches the defs sent to the provider. `providers.ts:1791` uses
   `splice(index,1)` to drop exactly **one** provider-rejected tool per validation
   error; no `slice(0,N)` exists in the provider path.
   / لا اقتطاع ثابت؛ مواقع `slice` الثلاثة للنصوص فقط، و `splice` تحذف أداة واحدة
   عند خطأ تحقق من المزوّد.

---

## OBSERVATION (not a failure) / ملاحظة (ليست فشلاً)

`ToolDef` has **no explicit `profile` / tag field**
(`electron/agent/providers.ts:21-30`). "Profile tag" is derived from the two name
sets `ESSENTIAL_TOOL_NAMES` / `ADVANCED_TOOL_NAMES` (`tool-defs.ts:2091,2116`)
plus `kind`. It is deterministic and stable, so behavior is correct — but if V3
was specified as "each def carries a literal profile tag", that literal field
does not exist. Flagging it so the parent can decide.
/ لا يوجد حقل `profile` صريح في `ToolDef`؛ الوسم مشتق من مجموعتي الأسماء Plus
`kind`. السلوك صحيح ومستقر، لكن الحقل الحرفي غير موجود — أُشير إليه ليقرر المؤسس.

---

## BOTTOM LINE / الخلاصة

- **Can the app really use all tools now?** Yes — 145/145 live dispatch, hidden
  tools callable by name, no profile hard-block, no provider truncation.
  / **هل يستطيع التطبيق استخدام كل الأدوات؟** نعم.
- **Is it profile theater?** No — the profiles genuinely reduce what weak models
  see (40 / 121 / 146 advertised) without removing executability.
  / **هل هو تمثيل؟** لا.
- **Is everything consistent?** No — the generator/inventory says 145, the
  engine says 146, because `preview_open` lives outside `CORE_DEFS`. That is the
  single FAIL to fix before calling the count "honest".
  / **هل كل شيء متسق؟** لا — الجرد 145 والمحرّك 146؛ هذا هو الفشل الوحيد المطلوب
  إصلاحه.
