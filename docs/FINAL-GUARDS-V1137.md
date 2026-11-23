# FINAL INDEPENDENT GUARDS — v11.37 (M1 tools · M2 loop · M4 context)
# الحراس النهائية المستقلة — v11.37 (M1 الأدوات · M2 الحلقة · M4 السياق)

> **السؤال المباشر: هل الشكاوى الثلاث الحقيقية للمؤسس انحلّت فعلاً في الشجرة الحالية؟**
>
> **الجواب: نعم — PASS 77/77.** ثلاثة حراس مستقلين شغّلوا الكود **الحقيقي**
> (لا فحص نص فقط، لا إعادة تنفيذ مقلّدة): `tools.ts` و`engine.ts` و`ipc.ts`
> + سلسلة `ContextLens`. صفر فشل. التفاصيل والأرقام أدناه.
>
> **EN blunt answer: YES — all three complaints are FIXED in the current tree.**
> 77/77 checks pass, zero failures, real executors driven end-to-end.

---

## EN — blunt verdict per complaint

| # | Founder's complaint | Verdict | Independent proof | Where it lives |
| --- | --- | --- | --- | --- |
| **M1** | Arabic cell-biology PDF with a spaced/parenthesized path loops or fails cryptically; the other builders are fake | **PASS — one honest call, real bytes, dirs created** | `tests-v1137-tools-guard.mjs` — 46/46 | `electron/agent/tools.ts:1965`, `:4893`, `:9137`, `:9373` |
| **M2** | Agent repeats the same failing tool forever, then stops silently with no summary | **PASS — 2 dispatches max, one visible block notice, summarized final answer** | `tests-v1137-loop-guard.mjs` — 15/15 | `electron/agent/engine.ts:6420`, `:6758`, `:859`, `:638` |
| **M4** | Context window shows 200,000 for a 1M model and fills to a fake 100% | **PASS — 1,000,000 through the whole chain; curated 1M also 1M; no false 100%** | `tests-v1137-context-guard.mjs` — 16/16 | `electron/ipc.ts:681`, `src/lib/api.ts:510`, `src/components/ContextLens.tsx:117`, `src/lib/ctx.ts:174` |

**No app source was edited by this work.** These are diagnosis + test + doc only.

---

## AR — الحكم الصريح لكل شكوى

| # | شكوى المؤسس | الحكم | الدليل المستقل | المكان |
| --- | --- | --- | --- | --- |
| **M1** | ملف PDF عربي عن علم الأحياء الخلوية بمسار فيه مسافات وأقواس يعلق أو يفشل بخطأ غامض، وبقية البنّاءين وهميون | **نجح — استدعاء واحد صادق، بايتات عربية حقيقية، المجلدات أُنشئت** | `tests-v1137-tools-guard.mjs` — 46/46 | `electron/agent/tools.ts:1965`, `:4893`, `:9137`, `:9373` |
| **M2** | الوكيل يكرر نفس الأداة الفاشلة إلى الأبد ثم يتوقف بصمت بلا ملخّص | **نجح — تنفيذان كحد أقصى، إشعار حظر مرئي واحد، إجابة نهائية فيها ملخّص** | `tests-v1137-loop-guard.mjs` — 15/15 | `electron/agent/engine.ts:6420`, `:6758`, `:859`, `:638` |
| **M4** | نافذة السياق تُظهر 200,000 لنموذج 1M وتمتلئ إلى 100% مزيّفة | **نجح — 1,000,000 عبر السلسلة كاملة، والاحتياطي المُنسّق لـ1M هو أيضاً 1M، بلا 100% كاذبة** | `tests-v1137-context-guard.mjs` — 16/16 | `electron/ipc.ts:681`, `src/lib/api.ts:510`, `src/components/ContextLens.tsx:117`, `src/lib/ctx.ts:174` |

**لم أعدّل أي ملف من ملفات التطبيق.** هذا العمل تشخيص + اختبار + توثيق فقط.

---

## 1 · M1 — what was actually executed / ما الذي نُفّذ فعلياً

The guard esbuild-bundles the **real** `electron/agent/tools.ts` (electron stubbed,
`SURNIA_NO_BROWSER=1`, local temp dirs, no net) and calls the **real**
`executeTool(name, argsJson, ctx)` with the founder's exact payload shape:

- Arabic cell-biology report (headings, a table of organelles, bullets) —
  `علم الأحياء الخلوية … النواة … الميتوكوندريا … الريبوسوم`;
- a destination with spaces **and parentheses**:
  `…\reports\cell biology (v1)\cell-biology.pdf`;
- **both** variants: `make_document {path, content, format:"pdf"}` **and**
  `pdf_make {path, content, title}`.

The only substituted piece is Electron's hidden-window printer (`printToPdf`),
which does not exist in plain Node; it is injected exactly the way `main.ts`
injects `setDeviceImpl`, and it embeds the rendered Arabic text as UTF-8 bytes
so the pipeline can be checked for corruption.

Results (all measured, not assumed):

- one approval + one print job per call ⇒ **no retry loop**;
- `Created PDF document …` / `PDF created …` with **Arabic UTF-8 bytes present**
  in the file (859 B / 898 B);
- `reports\cell biology (v1)` parent directories **created automatically**
  (`fs.mkdir(..., {recursive:true})` at `tools.ts:5014` / `:9198`);
- native `make_document` **docx** (~2.1 KB) and **xlsx** (~2 KB) also carry
  Arabic bytes — zero Python needed (`tools.ts:4980`, `:4983` as of the final run);
- `docx_make` / `xlsx_make` fail **honestly and once** when `python-docx` /
  `openpyxl` are absent — one actionable `FAILED HONESTLY … Fix: pip install …`
  message, never a cryptic loop (`tools.ts:9455-9470`);
- `pptx_make` succeeded here (python-pptx present): ~29 KB with Arabic bytes.

> AR: الاستدعاء الواحد أنشأ الملف والمجلدات، والبايتات العربية وصلت سليمة.
> عند غياب مكتبة Python تُعرض رسالة إصلاح واحدة واضحة (FAILED HONESTLY + pip install)،
> لا حلقة ولا خطأ غامض. بنّاءو docx/xlsx الأصليون لا يحتاجون Python أصلاً.

---

## 2 · M2 — what was actually executed / ما الذي نُفّذ فعلياً

The guard bundles the **real** `electron/agent/engine.ts` and runs the **real**
`runAgent()` against a local scripted OpenAI-compatible provider (`node:http`
on loopback; no external network, no model). The mock emits **four identical
failing `read_file` calls**; the only thing that can stop it is the engine's own
breaker — the script never tells the model to give up.

- **Dispatch cap:** 4 attempts → **2 real `tool_start` dispatches**
  (`engine.ts:6455`), `tool_start`/`tool_result` stay paired, no orphan cards.
- **Visible notice:** exactly **one** `DISPATCH BLOCKED` notice plus one
  distinct arm notice (`failed 2× … corrective injected`) — bounded, no
  per-attempt spam (`engine.ts:6758`).
- **Corrective reaches the model** on turn 3 (`REPEATED_FAILURE_NUDGE`,
  `engine.ts:755`), so the loop cannot silently restart.
- **No silent stop:** the run emits one `task_report` and one `turn_end` and a
  **221-character final answer containing `Summary:`** — a real written result
  (`engine.ts:1954`).
- **Malformed nested wrapper:** `{"tool":"write_file","args":{…}}` inside a
  ` ```surnia-tool ` fence (plus one broken fence) parses to **exactly one**
  call through the real `parseTextToolCalls` (`engine.ts:537-561`, `:6107`),
  and the live loop dispatches it **once** (`engine.ts:6310`) and still ends with a summary.

> AR: أربعة استدعاءات فاشلة متطابقة نفّذت مرتين فقط، مع إشعار حظر مرئي واحد
> وتصحيح وصل للنموذج، ثم إجابة نهائية فيها ملخّص — لا توقف صامت. الغلاف
> المتداخل `{tool,args}` تحوّل إلى استدعاء واحد حقيقي لا أكثر.

---

## 3 · M4 — what was actually executed / ما الذي نُفّذ فعلياً

One esbuild graph holds the **real** `electron/ipc.ts` (`kdx:model:info` at
`:681`), the renderer bridge `src/lib/api.ts` (`:510`), `src/lib/ctx.ts`,
`openrouterCatalog.ts` and `costs.ts`. Electron is stubbed so `ipcMain.handle`
captures the real handler; `window.surnia.modelInfo` routes through the real
channel name. A 1M model is injected via the real catalog seed hook.

- **Injected 1M id:** catalog = `1,000,000` → handler = `1,000,000`
  (`contextWindow !== 200_000`, `ctxEstimated:false`, `ipc.ts:689-691`) →
  `api.modelInfo` = `1,000,000` → ContextLens state = `1,000,000`
  (`ContextLens.tsx:117-132`).
- **Occupancy:** 100k / 1M = **10 %**; the same 100k on 200k would be 50 %
  (`ctx.ts:174`). `formatContextBreakdown` prints `1000000`, never `200000`.
- **1M stamp:** `isOneMClassWindow(1M)` ⇒ the lens renders the honest `1M`
  label (`ContextLens.tsx:498`, `ctx.ts:52`).
- **Curated fallback:** with the live catalog reset, the known 1M id
  `anthropic/claude-opus-4-8` still resolves to **1,000,000** and `estimated:false`
  (`costs.ts:353`) — no curated row silently downgrades 1M to 200k.
- **No false 100 %:** an unknown model falls back to **≈200k flagged estimated**;
  a 1.2M fill against that estimated window returns **`null` percentage**, and
  the breakdown carries `≈` and no `100 %` (`ctx.ts:181`).
- **No downgrade:** a stale `≈200k` answer cannot overwrite a confirmed 1M
  window (`ContextLens.tsx:128-130`).

> AR: معرّف 1M مرّ من الكتالوج إلى المعالج إلى الجسر إلى حالة العدسة كـ1,000,000،
> والاحتساب 10% لا 50%، والاحتياطي المُنسّق يعطي 1M أيضاً. النموذج المجهول يبقى
> ≈200k بلا نسبة 100% مزيّفة، ونافذة 1M المؤكدة لا تُخفّض إلى 200k.

---

## 4 · Run it yourself / طريقة التشغيل

```bat
node tests-v1137-tools-guard.mjs
node tests-v1137-loop-guard.mjs
node tests-v1137-context-guard.mjs
```

Each script prints `PASS <id>: <detail> @ <file>:<line>` per check and a final
`GUARD X SUMMARY: PASS/FAIL (n failures)`. `file:line` is computed from the
**live tree at run time**, so it stays correct while agents M1/M2/M4 keep
editing. Exit code `0` = all checks passed.

---

## 5 · Honest caveats (reported, not hidden) / تحذيرات صادقة

1. **The Electron printer is a test double.** Plain Node cannot run a hidden
   Chromium window; the guard injects a `printToPdf` that preserves UTF-8
   Arabic bytes. This proves the tool pipeline builds the correct HTML and
   writes the bytes; it does **not** prove font glyph embedding in a real PDF
   viewer. The native docx/xlsx builders need no such double.
2. **Python modules vary by machine.** Here `python-pptx` is installed but
   `python-docx` / `openpyxl` are not. Both outcomes are accepted by design:
   success with real bytes, or ONE honest `pip install` error. The guard never
   calls a missing file a success.
3. **The mock provider is local.** It proves engine control flow (cap, notice,
   continuation, summary), not model quality or provider latency.
4. **The catalog fixture is injected.** "1M from the provider" is proven for a
   provider-shaped payload; with no live catalog the app uses the curated table
   or the flagged `≈200k` default — both verified honest here.
5. **Concurrent edits:** the three guards read the tree at run time; re-run all
   three after the last agent save to confirm the final state.

---

## 6 · Final verdict / الحكم النهائي

**EN:** All three founder complaints are resolved in the current tree. M1
executors are real and honest (46/46); M2's hard breaker caps identical failing
dispatches at two with a visible notice and a summarized finish (15/15); M4
propagates 1,000,000 end-to-end with a curated 1M fallback and no fabricated
100 % (16/16). **77/77 — PASS.**

**AR:** الشكاوى الثلاث محلولة في الشجرة الحالية: الأدوات حقيقية وصادقة (46/46)،
حاجز الحلقة يوقف التكرار عند تنفيذهن مع إشعار مرئي وملخّص (15/15)، ونافذة 1M
تصل كاملة بلا 100% مزيّفة (16/16). **77/77 — نجح.**
