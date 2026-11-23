# v11.38 — Per-model reasoning effort / الجهد حسب النموذج

## الحكم blunt verdict (AR)

**تم التنفيذ جزئياً بصراحة — وليس «جلبنا الأسماء من المزوّد» كما طُلب حرفياً.**

- الحقيقة التقنية: نقطة `openrouter.ai/api/v1/models` **لا تنشر أسماء مستويات الجهد**. هي تُرجع قائمة `supported_parameters` حقيقية (مثل `reasoning` / `reasoning_effort`) فقط. أي ادّعاء بأننا «جلبنا الأسماء من المزوّد» سيكون كذبة. لذلك: **القدرة (هل يوجد حقل تفكير؟) تُجلب فعلاً من المزوّد وتُحفظ في كل صف**، أما **أسماء المستويات فمُنسّقة (curated) من وثائق OpenAI / Anthropic / Google الرسمية**، والواجهة تقول `curated` أو `provider-catalog` بوضوح. هذا هو الصدق المطلوب.
- النتيجة العملية: تغيير المؤشّر يغيّر **حقل الطلب الحقيقي** فعلاً — GPT يرسل `reasoning_effort` بالاسم الصحيح، Claude يرسل `thinking.budget_tokens` برقم حقيقي، OpenRouter يرسل الحقل الذي أعلن المزوّد دعمه. لا يوجد «مؤشّر تجميلي».
- **Gemini المباشر**: بوابة `generativelanguage.googleapis.com/v1beta/openai` لا تحتوي حقل جهد مُسمّى. نعرض مستويين (low/high) بصراحة ونرسل **لا شيء**؛ اخترنا الصدق على تزييف حقل. (عبر OpenRouter يأخذ توجيه الموجّه الحقيقي.)
- حافظنا على عنصر واجهة v11.37 (`agent.effort` = standard/deep لمضاعفة خطوات المحرك) كما هو، وأضفنا محوراً ثانياً مستقلاً (`model.reasoning`) هو الذي يغيّر حقل الإرسال. الخلط بينهما كان سيكسر اختبار v1137 ويضلّل المستخدم.

## Blunt verdict (EN)

**Implemented — with one honest correction to the brief.**

- The OpenRouter catalog does **not** publish named effort levels. It publishes a real `supported_parameters` array. Fetching "the real names from the provider" is impossible; claiming otherwise is dishonest. So: **capability is fetched from the provider** (parsed from every live row), **level names are curated from official provider docs**, and the UI prints `provider-catalog` vs `curated` so nobody is misled.
- Changing the slider **really changes the wire field**, verified by tests: GPT → `reasoning_effort: minimal|low|medium|high`; o-series → `low|medium|high`; GLM → `low|high|max`; Claude → `thinking: {type:'enabled', budget_tokens: 2048|8192|16384}`; OpenRouter → the field its own catalog advertised.
- Gemini direct gateway has no named effort field → two curated stops, **no fake parameter sent**. Honest limitation, documented.
- The v11.37 chat control's `standard/deep` (engine step budget) is preserved untouched; the new per-model reasoning rail is a separate, clearly labelled axis in the same popover and in the model-picker "reasoning depth" tab.

## Files changed / الملفات المعدّلة

| File | Change |
|---|---|
| `shared/effort.ts` **(new)** | Pure descriptor: family detection, per-model levels, budgets, `effortWireFor()`, `effortSignalFromRows()`. Shared by main + renderer + tests. |
| `shared/types.ts` (~53-54, 1050) | `ModelConfig.reasoning` widened to the model's own named stop; `agent.reasoningEffort?: string` added for the engine handoff. `agent.effort` union untouched. |
| `electron/services/openrouterCatalog.ts` | Parse + retain real `supported_parameters`; new exported `openrouterEffortSignalFor()`. Window/price code untouched. |
| `electron/agent/providers.ts` | `wantedThinkingBudget()` now descriptor-driven; `buildOpenAIRequestBody()` applies `effortWireFor()`; new exported `effortDescriptorFor()`. 400-downgrade strip still removes both keys. |
| `src/components/EffortControl.tsx` | New `ReasoningSlider` + descriptor-backed section in the chat popover. v1137 rail/type/store action preserved byte-for-byte. |
| `src/components/ModelPicker.tsx` | Reasoning-depth tab now renders `effortDesc.levels` with bilingual labels + provenance; `pick()` carries the stop across model changes; legacy `REASON_LABEL` kept for i18n guard. |
| `src/components/settings/ModelsSection.tsx` | Model config select and active-model chip use the descriptor. |
| `tests/v1138-effort.test.mjs` **(new)** | 11 tests, one shared esbuild graph (so seeded catalog really affects the request builder). |
| This doc | Verdict + handoffs. |

## Verification / التحقق

```
npx tsc --noEmit                      → 0 errors when run at 11:14
npx tsc -p tsconfig.node.json --noEmit → 0 errors when run at 11:14
node --test --test-force-exit tests/v1138-effort.test.mjs        → 11/11
node --test --test-force-exit tests/v1137-chat-controls.test.mjs → 26/26
node --test --test-force-exit tests/v1116-prompt-cache.test.mjs  → 11/11
node --test --test-force-exit tests/v1131-ui-overlays.test.mjs   → 22/22 (REASON_LABEL guard intact)
```

Both `tsc` runs were fully green with all v1138 files in place. Later in the same
minute, PARALLEL agents (not this task) introduced unrelated errors in files
this task does not own: `src/components/panels/registry.tsx` (`'signature'` not
in `RailView`) and `electron/services/scheduleService.ts` (`ScheduleJobView.lastEvent`).
No error from any v1138-owned file has appeared in either tsconfig at any point.

Other observed parallel/pre-existing failures, NOT caused by this change:
`v1121-i18n-final` reports missing dictionary keys in `flows.* / git.* / sched.*`
(none of the new keys are in that list), and `v1135-token-savings` byte-cap
reports 24433 vs 24425 after another agent edited `prompts.ts`.

## HANDOFFS — ما يجب على الوالد إصلاحه

### P0 — `src/store.ts:5539` (owned by parent)
```ts
setModel: (provider, model) => get().updateSettings({ model: { provider, model } }),
```
This **wipes** `reasoning` (and `maxTokens`/`temperature`) whenever a model is chosen. The picker now has a defensive carry (`normalizeEffortLevel` against the NEW model), but the store must do this centrally:
- preserve per-model tuning on `setModel`;
- normalize the carried stop against `effortLevelsFor(newProvider, newModel)` so `minimal` from GPT never sticks to Claude;
- prefer `agent.reasoningEffort ?? model.reasoning` as the canonical value.

### P1 — `electron/agent/engine.ts` (owned by parent)
The wire value already flows end-to-end today: `settings.model.reasoning` → `store.resolveRunModel()` → `api.agentRun` → `register.normalizeModel():256` → `runAgent(params.model)` → `streamTurn` → `providers.ts`. No engine change is required for the feature to work.
If you want `agent.reasoningEffort` (added at `shared/types.ts:1050`) to be the single source of truth, make the engine compose `{ ...params.model, reasoning: cfg.reasoningEffort ?? params.model.reasoning }` before each `streamTurn` call, and keep the two axes (`effort` = steps, `reasoningEffort` = wire) separate.

### P2 — `src/components/chat-final.css` (not owned)
New markup uses `.cf-effort-permodel`, `.cf-effort-rail--permodel`, `.cf-effort-stops`, `.cf-effort-src`. The existing `.cf-effort-rail { direction: ltr }` and `.cf-effort-stop` rules apply; `.cf-effort-stops` needs `display:flex; gap:4px; justify-content:space-between` so the named stops sit on one line. No behaviour depends on this — purely visual.

### P3 — `src/i18n.ts` (not owned)
Bilingual labels currently live in `shared/effort.ts` (necessary: the renderer must render a provider's stop name that the dictionary cannot predict). If dictionary-driven localization is required, mirror the known stop labels there and keep `shared/effort.ts` as the fallback — do not invent a dictionary key for a level the provider may add tomorrow.

## ما يلاحظه المستخدم فعلياً / What the user actually sees

Open the chat "+" chip → the popover now has a second rail titled **Reasoning depth** whose stops and count belong to the active model. The model picker's **Reasoning depth (extended thinking)** tab and Settings → Models show the same names. Move one stop and the next request carries a different `reasoning_effort` / `budget_tokens` — not a different label only. The provenance line (`curated · thinking.budget_tokens · …`) makes the source honest.
