# Tool Profiles — Explained (English) / شرح ملفات الأدوات (العربية)

> **The one-sentence answer:** We did **not** delete tools. All **145 core tools still exist and are still executable by their exact name**. A *Tool Profile* only changes **which tool definitions we *show* (advertise) to the model** — it never removes a tool from the registry and never disables an executor.
>
> **الإجابة في جملة واحدة:** لم نحذف أي أداة. جميع الأدوات الـ **145** ما زالت موجودة ويمكن تنفيذها باسمها الدقيق. *ملف الأدوات (Tool Profile)* يغيّر فقط **أي تعريفات نُظهرها (نُعلنها) للنموذج** — ولا يحذف أداة من السجل ولا يعطّل أي مُنفّذ.

This document exists because the founder was (rightly) angry that the visible tool count appeared to drop from "~170/145" to "40". The short version: **40 is the size of the *smallest advertising profile*, not the size of the tool registry.** The registry is still 145.

---

## 1. The verified numbers

Measured directly from the app's own bundled source by `tests/v1118-profiles-honesty.test.mjs` (not guessed):

| Profile | Tool defs advertised to the model | Tools that still exist & are executable |
|---------|-----------------------------------|------------------------------------------|
| `essential` | **40** | 145 |
| `balanced`  | **120** (the app default) | 145 |
| `full`      | **145** | 145 |

Honest reachability measurement from the same harness:

```
PROFILE-COUNTS:   essential=40 balanced=120 full=145
DISPATCH-RESULT:  total=145 ok=20 honest-refusal=125 unreachable=0 threw=0
```

- `ok=20` — tools that succeeded on empty arguments in the headless test context.
- `honest-refusal=125` — tools that ran their **real executor** and returned a well-formed refusal (`ok:false` with a reason such as "missing parameter", "headless", "not a repo", "no API key"). **A refusal is proof the tool was reached.**
- `unreachable=0`, `threw=0` — **no registered tool returned "Unknown tool:" and no tool threw out of `executeTool`.**

**Conclusion: 0 tools are unreachable. Every one of the 145 names dispatches to a real handler.**

---

## 2. What a Tool Profile actually is

A profile is a **filter on the `ToolDef[]` array that is *presented* to the model in the prompt** — nothing more. Think of it as a *menu*, not a *kitchen*. Hiding an item from the menu does not remove it from the kitchen; if the customer asks for it by name, the kitchen can still make it.

### Where the profile is applied

- `electron/agent/tool-defs.ts:2038` — `export type ToolProfile = 'essential' | 'balanced' | 'full';`
- `electron/agent/tool-defs.ts:2087-2092` — `defsForProfile(defs, profile)` is the **only** filtering logic:

  ```ts
  export function defsForProfile(defs: ToolDef[], profile: ToolProfile): ToolDef[] {
    if (profile === 'full') return defs;                                    // ← all 145
    if (profile === 'essential') return defs.filter(d =>
      d.kind === 'mcp' || ESSENTIAL_TOOL_NAMES.has(d.name));                // ← 40 (+ MCP)
    return defs.filter(d =>
      d.kind === 'mcp' || !ADVANCED_TOOL_NAMES.has(d.name));                // ← 120 (+ MCP)
  }
  ```

  Note `d.kind === 'mcp' || …` in both branches: **MCP tools are never filtered out, in any profile.**

- `electron/agent/tool-defs.ts:2041-2059` — `ESSENTIAL_TOOL_NAMES` (the ~40 core tools: files, run, search, todo, plan, checkpoint, preview, web/download, `tool_help`, LSP matrix, `task`, documents).
- `electron/agent/tool-defs.ts:2066-2084` — `ADVANCED_TOOL_NAMES` (deep specialists hidden from `balanced` only: debugger, notebooks, office/pdf builders, advanced browser, a few data utilities). These are **hidden from the default menu but still fully executable** — and `full` advertises them again.

### Where the profile is *not* applied (the crucial part)

- `electron/agent/tools.ts:650-652` — `tools.ts` imports and **re-exports** `CORE_DEFS`, `ESSENTIAL_TOOL_NAMES`, `ADVANCED_TOOL_NAMES`. The full registry is always present.
- `electron/agent/tools.ts:676-699` — `getToolDefs(enabledMcp, profile = 'full')`. The **default is `'full'`**. It builds `[...CORE_DEFS]` + all discovered MCP tools, then calls `defsForProfile(defs, profile)`.
- `electron/agent/tools.ts:743` — `executeTool` resolves the def with `getToolDefs(ctx.mcpServers)` — **no profile argument → `'full'` → all 145 defs**. This is why a model can call any tool by exact name even if that tool was not advertised to it.
- `electron/agent/tools.ts:784-1254` — the big `switch (canonical)` with one case per tool. `electron/agent/tools.ts:1255-1259` — the `default` branch hands off to the MCP executor for MCP tools, otherwise returns `Unknown tool:` (this is the line the test watches — it fired **0** times for all 145 registered names).
- `electron/agent/engine.ts:2064` — `const toolDefs = getToolDefs(enabledMcp, cfg.toolProfile ?? 'balanced');` — **this is the one place the configured profile filters what the model sees.** The comment at `engine.ts:2058-2063` states explicitly: "NO executor is removed … executeTool always resolves against the FULL registry".
- `electron/services/storeService.ts:46` — `agent: { toolProfile: 'balanced' }` — the app default. That default is why most users see ~120 tools in the menu, not 145. It is a *display* default, not a capability limit.

---

## 3. Why profiles exist at all (the honest rationale)

1. **Weak models get distracted by too many choices.** Faced with ~145 near-identical tool schemas, a weak model often picks the wrong tool, emits malformed calls, or stalls. Given ~40 crisp, high-value choices (the `essential` profile) it behaves far more reliably. This is a well-known agent-design tradeoff: *advertising budget* competes with *decision quality*.
2. **No capability is sacrificed.** Because `executeTool` always resolves against the full registry, a capable model can still invoke any of the 145 tools by exact name — even tools that were not in its menu. Profiles are a **prompt-side nudge**, not a permissions system.
3. **MCP tools are always kept.** `defsForProfile` preserves every `kind === 'mcp'` def in all three profiles (the `d.kind === 'mcp' || …` clauses). Connecting an MCP server never silently hides its tools.
4. **The founder's safety tools are deliberately visible.** `web_download`, `tool_help`, `lsp_languages`, the six `lsp_*` executors, and `desktop_control` are all present in the default `balanced` profile (verified in `tests/v1116-tools-audit.test.mjs`), so the model actually sees them and can call them.

---

## 4. The 422 gateway fallback drops ONE tool, not forty

Some strict OpenAI-compatible gateways reject a request with **HTTP 422** when a single tool schema is malformed. The old behaviour risked narrowing the tool list; the current behaviour is surgical:

- `electron/agent/providers.ts:1431` — `toolIndexFromValidationError(errText)` parses the **one** tool index from the validation error's `loc` (e.g. `["body","tools",147,"WebSearchTool","type"]`). If no `loc` can be parsed it returns `-1` and **nothing is dropped** — the honest 422 surfaces unchanged.
- `electron/agent/providers.ts:1463-1475` — `dropSingleRejectedTool(reqBody, index, endpoint)`:
  ```ts
  obj.tools.splice(index, 1); // ONE tool — never a fixed-size slice
  ```
  It removes **exactly one** entry and remembers its name per endpoint (`skippedToolsByEndpoint`) so it is never re-sent. Every other tool stays live.
- `electron/agent/providers.ts:1758-1760` — the 422 downgrade handler wires it up:
  ```ts
  const badToolIndex = toolIndexFromValidationError(errText);
  if (badToolIndex >= 0) {
    const replacement = dropSingleRejectedTool(reqBody, badToolIndex, cacheEndpointKey(a));
    if (replacement != null) return replacement;
  }
  ```
- `tests/v1118-profiles-honesty.test.mjs` (test D) scans `providers.ts` at source level and asserts there is **no `.slice(0, N)` applied to a tools/defs array**, and that the single-tool `splice(index, 1)` path is present. The only `.slice(0, N)` calls in `providers.ts` are on **strings** (error text / parse input), never on tools.

---

## 5. Honest findings / caveats

We report these rather than hide them:

1. **Six names in `ADVANCED_TOOL_NAMES` are inert** (no matching registered def): `csv_tool`, `base64_tool`, `regex_tool`, `diff_tool`, `color_tool`, `url_codec`. The real tool names are `csv_read`/`csv_write`, `encode_base64`/`decode_base64`, `regex_test`, `diff_files`, `color_convert`, `url_encode`/`url_decode`. Consequence: those six tools are **not** hidden from `balanced` — which is *more* capability, not less. This is why the measured `balanced` count is **120**, not `145 − 31 = 114`. (This does not affect the subset guarantee: `essential ⊂ balanced ⊂ full` still holds — verified.)
2. **`balanced` is 120, not ~119.** The "~119" figure in older comments is approximate; the authoritative number is whatever `defsForProfile(CORE_DEFS, 'balanced')` returns at runtime: **120** in this build.
3. **Reachability ≠ success.** With empty arguments in a headless context, 125 tools return an honest refusal rather than a success. That is expected and healthy — it is the tool's own guard, not a broken dispatch. The founder's concern is about *reachability*, and reachability is **145/145**.
4. **The "~170" number** appears to count historical/alias/MCP-inclusive totals. The canonical, count-checked core registry is **145** (`tool-defs.ts:1-3`, `tests/v1118-profiles-honesty.test.mjs` test B). No core def was deleted in the profile work.

---

## 6. How to verify yourself

```bash
cd "D:\New folder (58)\SADEEM-v11.12.0-source\src-pkg-v1112\sadeem-v11.12.0"
node --test --test-force-exit tests/v1118-profiles-honesty.test.mjs
```

Expected: `pass 5 / fail 0`, with the `PROFILE-COUNTS` and `DISPATCH-RESULT` lines above.

Companion harnesses: `tests/v1116-tools-audit.test.mjs` (founder-named tools visible in default profiles), `tests/tool-coverage-all.mjs` (full 145-tool coverage matrix with real fixtures), `tests/v1117-422-downgrade.test.mjs` (422 downgrade behaviour).

---
---

# شرح ملفات الأدوات (العربية)

> **الخلاصة:** لم نحذف أي أداة. جميع الأدوات الأساسية الـ **145** ما زالت موجودة ويمكن تنفيذها باسمها الدقيق. *ملف الأدوات (Tool Profile)* يغيّر فقط **ما نُظهره للنموذج من تعريفات أدوات** — ولا يحذف أداة من السجل، ولا يوقف أي مُنفّذ (executor).

الغضب كان مبررًا: بدا أن عدد الأدوات انخفض من «~170/145» إلى «40». الحقيقة: **الـ 40 هي حجم أصغر «قائمة عرض» (advertising profile)، وليست حجم سجل الأدوات.** السجل ما زال 145 أداة.

## الأرقام الموثّقة (من مصدر التطبيق نفسه)

| الملف الشخصي | الأدوات المعروضة للنموذج | الأدوات الموجودة والقابلة للتنفيذ |
|--------------|--------------------------|-------------------------------------|
| `essential` | **40** | 145 |
| `balanced` (الافتراضي) | **120** | 145 |
| `full` | **145** | 145 |

قياس القابلية للوصول: `total=145`، `unreachable=0`، `threw=0`. أي أن **كل اسم من الأسماء الـ 145 يُرسَل إلى مُنفّذ حقيقي**، ولا أداة أعادت «Unknown tool:». الرفض المهذّب (honest refusal) يُعدّ وصولًا ناجحًا، لأنه صدر عن المُنفّذ الحقيقي للأداة.

## ما هو ملف الأدوات فعليًا؟

مرشّح على مصفوفة تعريفات الأدوات **التي تُعرض في الإrompt** فقط — كـ«قائمة طعام» لا «مطبخ». إخفاء صنف من القائمة لا يزيله من المطبخ؛ لو طلبه الزبون بالاسم، المطبخ يستطيع تحضيره.

- `tool-defs.ts:2087` — الدالة `defsForProfile` هي المنطق الوحيد للترشيح: `full` تُعيد كل التعريفات (145)، و`essential` تُبقي ~40، و`balanced` تُخفي المتخصصين العميقين فقط. في كلا الفرعين يظهر الشرط `d.kind === 'mcp' || …`، أي أن **أدوات MCP لا تُستبعد أبدًا في أي ملف شخصي**.
- `tools.ts:676` — `getToolDefs` يبني `[...CORE_DEFS]` + أدوات MCP، ثم يستدعي `defsForProfile`. الافتراضي فيه `'full'`.
- `tools.ts:743` — `executeTool` يستدعي `getToolDefs(ctx.mcpServers)` **بدون تمرير ملف شخصي** → `'full'` → كل الـ 145 تعريفًا. لهذا يستطيع النموذج استدعاء أي أداة بالاسم حتى لو لم تكن معروضة له.
- `engine.ts:2064` — المكان الوحيد الذي يطبّق الملف الشخصي على **ما يراه النموذج**: `getToolDefs(enabledMcp, cfg.toolProfile ?? 'balanced')`. التعليق عند `engine.ts:2058-2063` يقول صراحة: لا يُحذف أي مُنفّذ.
- `storeService.ts:46` — الافتراضي `agent.toolProfile: 'balanced'`، وهو سبب رؤية المستخدم ~120 أداة بدل 145. هذا افتراضي **عرض** لا حدّ قدرة.

## لماذا ملفات الأدوات؟

1. **النماذج الضعيفة تشتّت بكثرة الخيارات.** أمام ~145 مخططًا متشابهًا، كثيرًا ما يختار النموذج الأداة الخاطئة أو يتجمد. مع ~40 خيارًا واضحًا يتصرّف بشكل أفضل بكثير.
2. **لا تُضحّى بأي قدرة.** بما أن `executeTool` يستند دائمًا إلى السجل الكامل، يستطيع النموذج القوي استدعاء أي أداة من الـ 145 بالاسم، حتى المخفية من قائمته. الملفات الشخصية «توجيه للـ prompt» لا نظام صلاحيات.
3. **أدوات MCP تُبقى دائمًا** في كل الملفات الشخصية.
4. **أدوات المؤسّس المهمة ظاهرة في الافتراضي** (`web_download`, `tool_help`, `lsp_languages`, عائلة `lsp_*`, `desktop_control`) —تحقّق من ذلك `v1116-tools-audit.test.mjs`.

## معالجة 422: تُحذف أداة واحدة لا أربعون

عندما ترفض بوابة صارمة الطلب برمز 422 بسبب مخطط أداة واحد، الكود يتصرّف جراحيًا:

- `providers.ts:1431` — `toolIndexFromValidationError` يستخرج **فهرس أداة واحدة** من حقل `loc` في خطأ التحقق؛ وإن لم يجده تُعرض رسالة 422 كما هي ولا يُحذف شيء.
- `providers.ts:1469` — `obj.tools.splice(index, 1); // ONE tool — never a fixed-size slice` — تُحذف أداة واحدة فقط، ويُتذكّر اسمها لعدم إرسالها مجددًا.
- `providers.ts:1758-1760` — معالج 422 يربط الخطوتين.
- الاختبار D في `v1118-profiles-honesty.test.mjs` يفحص `providers.ts` على مستوى المصدر ويؤكد **عدم وجود `.slice(0, N)` على مصفوفة أدوات**، ووجود مسار `splice(index, 1)`.

## ملاحظات صادقة

1. ستة أسماء في `ADVANCED_TOOL_NAMES` غير مطابقة لأي أداة مسجّلة (`csv_tool`, `base64_tool`, `regex_tool`, `diff_tool`, `color_tool`, `url_codec`)؛ الأسماء الحقيقية هي `csv_read/csv_write` و`encode_base64/decode_base64` و`regex_test` و`diff_files` و`color_convert` و`url_encode/url_decode`. النتيجة: هذه الأدوات **لا تُخفى** من `balanced` — أي قدرة أكبر لا أقل. ولهذا عدد `balanced` المقاس هو **120** لا 114. علاقة الاحتواء `essential ⊂ balanced ⊂ full` ما زالت صحيحة ومُختبَرة.
2. `balanced` = **120** لا ~119؛ الرقم الموثوق هو ما تُعيده الدالة وقت التشغيل.
3. «الوصول» لا يعني «النجاح»: 125 أداة أعادت رفضًا مهذبًا مع معاملات فارغة في بيئة بدون واجهة — هذا سلوك صحي ومتوقّع، وليس خللًا. القلق كان حول الوصول، والوصول **145/145**.
4. رقم «~170» يبدو أنه يحسب مجاميع تاريخية/أسماء مستعارة/أدوات MCP. السجل الأساسي الموثوق بالعدد هو **145**. لم تُحذف أي أداة أساسية أثناء عمل ملفات الأدوات.

## كيف تتحقّق بنفسك

```bash
node --test --test-force-exit tests/v1118-profiles-honesty.test.mjs
```

المتوقع: `pass 5 / fail 0` مع سطري `PROFILE-COUNTS` و`DISPATCH-RESULT` المذكورين أعلاه.
