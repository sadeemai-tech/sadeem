# v11.35 — كل أدوات المزوّد / ALL PROVIDER TOOLS

> Founder: «أريد أن يكون الذكاء الاصطناعي قادر على استخدام كل الأدوات الخاصة به، إنه مثلا ممكن عنده أدوات زيادة بالذكاء الاصطناعي نفسه أو بالمزود نفسه يستخدمها، ما في مانع، يستخدم كل إمكانياته، إحنا نعطيه كل القدرات كل الإمكانيات المتاحة.»
>
> Translation: the AI must be able to use **all** of its tools — including extra tools offered by the model or the provider itself. Give it every available capability. Never silently drop a tool.

---

## 1. الخلاصة / Summary (honest)

| سؤال / Question | الإجابة / Answer |
|---|---|
| هل أدوات المزوّد الأصلية كانت تُمرَّر؟ / Were provider-native tools passed through? | **لا قبل v11.35.** كان كل شيء يُحوَّل إلى `type:'function'` (OpenAI) أو `{name,input_schema}` (Anthropic). أداة مثل `web_search` تُرسل كدالة عادية فيُرفضها المزوّد أو لا ينفّذها فعليًا. / **No before v11.35.** Everything was downgraded to a generic function; native tools were effectively unavailable. |
| ماذا تغيّر؟ / What changed? | أضفنا وصفًا أصليًا `native` على `ToolDef`، ومُ translators يُرسلان كل أداة بشكلها الصحيح، وسجلّ ديناميكي لأدوات المزوّد غير المعروفة، وتوجيهًا صادقًا لنداءاتها. / Native descriptor + two wire builders + a provider-tool registry + honest routing. |
| هل انخفض عدد الأدوات؟ / Did the tool count drop? | **لا. 145 بالضبط** (`full`) + أي MCP وقت التشغيل + أي أدوات يعلن عنها المزوّد. لا يوجد `slice` على مصفوفة الأدوات. / **No. Exactly 145** (`full`) + runtime MCP + provider-advertised tools. No fixed-size `slice`. |
| هل البروفايل يمنع أداة؟ / Is a profile a gate? | **لا.** البروفايل = عرض لمرة واحدة فقط (`VIEW`). التنفيذ ي resolving السجل الكامل، فأي أداة تُستدعى بالاسم تعمل. / **No.** A profile is a per-turn view; dispatch resolves the full registry, so any tool called by exact name executes. |
| هل النماذج القوية ترى كل الأدوات؟ / Do strong models see all tools? | الدالة الجديدة `salientToolProfile()` تُعطي Claude 5.5/GPT-5 **'full' = 145**. لكن `engine.ts:2624` ما زال يستدعي دالة v11.34 (`advertisedToolProfile` → 'balanced' للقوي) — انقل الاستدعال بسطر واحد. / The new `salientToolProfile()` gives strong models **'full' = 145**, but `engine.ts:2624` still calls the pinned v11.34 function — a one-line engine-owner swap is pending (see §6). |

---

## 2. ما الذي يُمرَّر فعليًا / What is actually passed through

### 2.1 أدوات أصلية بأشكالها الأصلية / Native tools in their native wire shape

المُعرِّف الوسيط `NativeToolSpec` (`electron/agent/providers.ts:39`) يحمل `type` كانوني + عائلة مزوّد + تعديلات لكل عائلة. الترجمة في `toOpenAINativeTool()` (`:288`) و`toAnthropicNativeTool()` (`:304`).

Canonical type | OpenAI-compatible wire | Anthropic wire | ملاحظة / Note
---|---|---|---
`web_search` | `{type:'web_search'}` | `{type:'web_search_20250305', name}` | بحث المزوّد نفسه / provider-side search
`code_interpreter` | `{type:'code_interpreter'}` | `{type:'code_execution_20250825', name}` | تنفيذ كود على الخادم / server-side code
`code_execution` | `{type:'code_interpreter'}` | `{type:'code_execution_20250825', name}` | مرادف Anthropic
`computer_use`, `computer` | `{type:'computer_use_preview'}` | `{type:'computer_20250124', name}` | تحكم بالحاسوب / computer use
`image_generation` | `{type:'image_generation'}` | `{type:'image_generation_20251119', name}` | توليد صور
`file_search` | `{type:'file_search'}` | `{type:'file_search_20260209', name}` | بحث في الملفات
`url_context` | `{type:'url_context'}` | `{type:'url_context_20250812', name}` | سياق URL
**أي نوع غير معروف** / **any unknown type** | يُمرَّر حرفيًا / verbatim | يُمرَّر حرفيًا / verbatim | لا رفض ولا تخمين / no refusal, no guessing |

- `wire.openai` / `wire.anthropic` / `wire.openrouter` تُدمج بعد `type`، فيمكنها تعديله (مثلاً لغِ dated type مختلف) أو إضافة `max_uses` / `display_width_px`. / Per-family overrides are spread **after** `type`, so they can override the date suffix or add display/max-use fields.
- المزوّدات المتوافقة مع OpenAI (ollama/gemini/zai/deepseek/xai/moonshot/qwen/mistral/custom) تأخذ الشكل OpenAI-compat؛ OpenRouter يأخذ `wire.openrouter` أيضًا. / OpenAI-compatible gateways use the OpenAI shape; OpenRouter additionally merges `wire.openrouter`.
- أداة `native` موجَّهة لعائلة أخرى تُرسل كدالة عادية **مع وصف صادق** يوضح أن المزوّد الحالي قد لا ينفّذها — لا تُحذف ولا تُدّعى مدعومة. / A native tool scoped to a different family is still advertised as a function with an honest description — never dropped, never falsely claimed.

### 2.2 أدوات يعلن عنها المزوّد ولا نعرفها / Provider-advertised unknown tools

- `registerProviderTool(def)` (`providers.ts:325`) و`registerUnknownProviderTool(name, provider, …)` (`:331`) يسجّلان الأداة في سجل وقت التشغيل.
- `getProviderToolDefs()` (`:351`) يُعيدها، و`advertisedWithExtras()` في `tool-defs.ts:2405` يدمجها في العرض دون حذف أي أداة من الـ145.
- إن أعطيت `nativeType` تُرسل بشكلها الأصلي؛ وإلا تُرسل كدالة عادية (**مُعلَنة، لا محذوفة**). / With `nativeType` → native shape; otherwise → ordinary function tool (**advertised, not dropped**).

### 2.3 التوجيه الصادق / Honest routing

`routeProviderToolCall(name, argsJson)` (`providers.ts:379`):

| الحالة / Case | النتيجة / Result |
|---|---|
| أداة أصلية / native tool | `ok:false, native:true` + رسالة: «تنفَّذ بواسطة المزوّد… لم يُختلق أي إجراء محلي». / explicit relay message, no faked local success |
| أداة مزوّد مسجّلة بلا منفّذ / registered, no executor | `ok:false, unsupported:true` + «Unsupported provider tool … NOT silently dropped». |
| اسم غير مسجّل إطلاقًا / never registered | `ok:false` + `Unknown tool: …` صريحة. |

---

## 3. ما الذي **لا** نفعله (بصراحة) / What we honestly do NOT do

1. **لا ننفّذ أدوات المزوّد محليًا.** / We do not execute provider-native tools locally. المزوّد ينفّذها على خادمه ويحقن النتيجة في سياق النموذج. إن وصلنا نداء عرضي نُجيب برسالة unsupported صريحة (لا نكذب بنجاح).
2. **لا نقرأ أحداث البثّ الأصلية كبطاقات أدوات.** / Native stream events (`web_search_call`, `server_tool_use`, `web_search_tool_result`, `code_interpreter_call`) لا تُعرَض كبطاقات tool في الواجهة؛ النتيجة تصل للنموذج عبر المزوّد. تحليل أحداث البثّ خارج نطاق ملفاتي (providers.ts SSE parser يقرأ `delta.tool_calls` و`tool_use` فقط).
3. **لا يوجد استكشاف تلقائي عبر الشبكة لاكتشاف قدرات المزوّد.** / No automatic capability-discovery HTTP call. التسجيل صريح عبر الدوال أعلاه؛ نقطة الربط في `engine.ts:2624-2625`.
4. **أدوات المزوّد ليست ضمن الـ145.** / Provider tools are a runtime **superset**, not counted by `scripts/gen-tool-inventory.mjs` (which parses only the 145 `CORE_DEFS`). العدد 145 يبقى صادقًا.
5. **مسار النص الاحتياطي (text-tool protocol) في `engine.ts:5916`** يبني `known` من الأدوات المُعلَنة فقط؛ أداة مخفية بالبروفايل ومُستدعاة عبر ```surnia-tool قد تُسقط في هذا المسار تحديدًا (نداءات الوظيفة الأصلية لا تتأثر). / The text-fallback path derives `known` from the advertised set, so a profile-hidden tool named in a ```surnia-tool block can be dropped **on that path only** — native function calls are unaffected. الإصلاح من نصيب صاحب `engine.ts`.
6. **`engine.ts:2624` لم يُعدَّل** (ليس من ملفاتي). / Not edited (owned by another agent). see §6.

---

## 4. الملفات المعدَّلة / Modified files (exact lines)

| الملف / File | السطر / Line | التغيير / Change |
|---|---|---|
| `electron/agent/providers.ts` | 22–74 | `NativeToolFamily`, `NativeToolSpec`, حقول `native?` / `passthrough?` / `providerSource?` على `ToolDef` |
| `electron/agent/providers.ts` | 204–400 | سجل الأدوات الأصلية، `makeNativeToolDef`, `toOpenAINativeTool`, `toAnthropicNativeTool`, `registerProviderTool`, `registerUnknownProviderTool`, `getProviderToolDefs`, `hasProviderTool`, `clearProviderTools`, `routeProviderToolCall` |
| `electron/agent/providers.ts` | 1689–1692 | `streamAnthropic` يستدعي `buildAnthropicTools` (بدل تحويل إجباري) |
| `electron/agent/providers.ts` | 2221–2274 | `buildOpenAITools` / `buildAnthropicTools` pure + محمية من cache_control على الأدوات الأصلية |
| `electron/agent/providers.ts` | 2316–2331 | `buildOpenAIRequestBody` يمرّر كل الأشكال، `tool_choice` فقط عند وجود دالة عادية |
| `src/lib/modes.ts` | 285–339 | `isStrongModelId`, `salientToolProfile`, `toolCallableByName`. دالة v11.34 `advertisedToolProfile` بقيت كما هي (اختبارات v1134 تثبّتها). |
| `electron/agent/tool-defs.ts` | 2375–2412 | `fullCapabilityUnion`, `advertisedWithExtras` — اتحاد السجلات بلا `slice` |
| `tests/v1135-all-provider-tools.test.mjs` | 80–252 | 7 اختبارات: 145 منفّذ، أداة مخفية تُنفَّذ، تمرير أصلي/غير معروف، توجيه صادق، salience، الاتحاد |

### الملفات التي **لم** أعدّلها (يملكها وكلاء آخرون)
`engine.ts`، `tools.ts`، `prompts.ts`، `store.ts`.

---

## 5. التحقق / Verification (كلها خضراء)

```text
npx tsc --noEmit                                   -> OK
npx tsc -p tsconfig.node.json --noEmit             -> OK
node scripts/gen-tool-inventory.mjs                -> 145 tools written
node --test --test-force-exit \
  tests/v1135-all-provider-tools.test.mjs \
  tests/v1134-all-tools.test.mjs \
  tests/v1134-tools-guard.test.mjs                 -> pass 18, fail 0
  V1134-VERDICT: ALL-GUARDS-PASS inventory=145 full=145 essential=40 balanced=120
  V1135_EXECUTORS=145 ... V1135_PASSTHROUGH ... V1135_HONEST_ROUTE ...
  V1135_SALIENCE=strong=full(145) weak=core(43) callable-by-name=145/145
  V1135_UNION=145 core + runtime/provider extras preserved, no slice
```

---

## 6. نقطة الربط المتبقية / Remaining integration (one line, engine owner)

`electron/agent/engine.ts:2624` اليوم:

```ts
const advertisedProfile: ToolProfileId = advertisedToolProfile(cfg.toolProfile, params.model.model);
```

لإعطاء النماذج القوية (Claude 5.5) الـ145 كاملة، يستبدل صاحب الملف الاستدعال بـ:

```ts
import { salientToolProfile, type ToolProfileId } from '../../src/lib/modes';
const advertisedProfile: ToolProfileId = salientToolProfile(cfg.toolProfile, params.model.model);
```

ثم يمرّر `providerTools = getProviderToolDefs()` إلى `getToolDefs`/`advertisedWithExtras` في `:2625`. لم ألمس الملف احترامًا لحدود الملكية؛ الدوال جاهزة ومُختبرة في `modes.ts` و`tool-defs.ts` و`providers.ts`.

> ملاحظة صادقة: حتى قبل هذا التبديل، النموذج القوي **يستطيع** استدعاء أي أداة من الـ145 بالاسم لأن `executeTool` ي resolving السجل الكامل — الفرق الوحيد هو ما يراه في `tools[]` لكل دورة (salience).
