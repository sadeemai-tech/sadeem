# EFFORT / REASONING DEPTH — v11.42
## الجهد / عمق التفكير — الإصدار 11.42

> Founder request / طلب المؤسّس:
> «موضوع الايفورت والريزونينج ديبث اكستاندر ثينكينج... في مشاكل فيها انه بسحب الهاي والشو اسمه... الايفورت يجب ان يكون بمقياس المزود والموديل نفسه، ممكن في اكثر من ستاندارد وممكن اشياء بمسميات مختلفة، يجب جلبه من نفسه للمزود نفسه... وحسن شكل شو اسمه، حسنها تصميما ايضا.»

---

## 1. Diagnosis — التشخيص (the actual root causes)

| # | Bug (EN) | العرض (AR) | Root cause / السبب |
|---|----------|-----------|--------------------|
| A | The two axes were rendered as **two identical hairline rails** in one popover: `agent.effort` (`standard`/`deep` = engine step-budget multiplier) and `model.reasoning` (the model's OWN named stop). Dragging the engine rail looked like the named rail "jumped"; the chip showed `deep` while the rail showed `high`. | شريطان متطابقان في نافذة واحدة: جهد المحرك (قياسي/عميق) وجهد النموذج (مرتفع…)؛ سحب أحدهما يبدو كأن الآخر «يقفز». | `EffortSlider` and `ReasoningSlider` shared `cf-effort-rail` / `cf-effort-range` styling and had no labels distinguishing them. `EffortControl.tsx:59`, `EffortControl.tsx:112`. |
| B | The **first stop of the per-model rail was dead**: while `settings.model.reasoning` was unset, the displayed value was the normalized default, so clicking that stop was treated as a no-op and nothing was persisted. | أول مرحلة في شريط النموذج لم تكن تعمل؛ الضغط عليها لا يحفظ شيئًا. | `setModelReasoning` compared the click to the *normalized* value (`next === reasoningLevel`) instead of the real stored value. Fixed at `EffortControl.tsx:252`. |
| C | **Switching models dropped the chosen stop** — the slider snapped back and the wire field disappeared. | عند تبديل النموذج يضيع الجهد ويعود المؤشر للبداية. | `src/store.ts:5543` — `setModel` replaces the entire `model` object, dropping `reasoning`. The picker only re-wrote the value when it differed from the new default; the `/model` path wrote nothing at all. Fixed in `ModelPicker.tsx:252` and `EffortControl.tsx:221` (the file we own; `store.ts` was deliberately NOT edited). |
| D | Re-scaling looked like corruption: the same name is a **different index** on a model with a different number of stops (GPT `medium` = 2/3; o-series `medium` = 1/2). | نفس الاسم في موضع مختلف عند نموذج بعدد مراحل مختلف. | Not a bug to remove — the model's own scale is required. The fix is to **persist the NAME, never an index**, and say so in the UI (`data-effort-count`, `data-effort-name`). `shared/effort.ts:262`, `EffortControl.tsx:112`. |
| E | `off`/`none` was not universal: carrying Claude's `none` onto GPT could silently become GPT's `minimal`, i.e. turn reasoning ON. | نقل «إيقاف» من Claude إلى GPT قد يُشغّل التفكير. | `normalizeEffortLevel` family-defaulted unknown off-like names. Fixed by the universal sentinel in `isOffEffort` (`shared/effort.ts:237`) and `effortWireFor` (`shared/effort.ts:292`). |
| F | GLM's three stops were **decorative on the wire**: the safety gate was a model-id regex that forgot `glm-*`/`gpt-6-*` on their native providers. | مراحل GLM لا تغيّر الطلب فعليًا. | `electron/agent/providers.ts:2336` now derives the gate from the descriptor (`trustedFamily`), keeping generic gateways honest while really sending the field for known families. |

---

## 2. Source of truth — مصدر الحقيقة

One pure module is shared by the Electron main process, the React renderer and the tests: `shared/effort.ts:172` (`effortLevelsFor`).

| Provider / family | Real stops (never invented) | Wire field | Where |
|-------------------|-----------------------------|-----------|-------|
| OpenAI GPT-5/6 | `minimal · low · medium · high` (4) | `reasoning_effort` | `shared/effort.ts:130` (`levelsForFamily`) |
| OpenAI o-series | `low · medium · high` (3) — **no fabricated `minimal`** | `reasoning_effort` | `shared/effort.ts:130` |
| Anthropic Claude | `none · low · medium · high` (4) with **real token budgets** `0 / 2,048 / 8,192 / 16,384` | `thinking: { type:'enabled', budget_tokens }` | `shared/effort.ts:159` (budgets), `shared/effort.ts:278` (`effortLevelDetail`) |
| Gemini (direct compat) | `low · high` (2) | **none** — honestly reported, `{}` on the wire | `shared/effort.ts:199` |
| GLM | `low · high · max` (3) | `reasoning_effort` | `shared/effort.ts:130`, `electron/agent/providers.ts:2336` |
| OpenRouter | `reasoning_effort` or `reasoning.effort` **only when the live `/api/v1/models` row advertises `supported_parameters`**; otherwise curated fallback | advertised field, else no invented one | `shared/effort.ts:323` (`effortSignalFromRows`), `electron/services/openrouterCatalog.ts:504` |
| Unknown / custom | `off · low · medium · high`, explicitly labelled `curated` | no field for a generic gateway | `shared/effort.ts:191`, `shared/effort.ts:128` (honest note) |

**Honesty rule / قاعدة الصدق:** the router publishes the *capability* (`supported_parameters`), not the *level names*. The descriptor records `source: 'provider-catalog'` for the capability and says in the note that the names stay curated (`shared/effort.ts:128`). No level is ever invented; a stale name from another model is dropped rather than clamped to a default (`shared/effort.ts:262`).

---

## 3. Redesign — التصميم الجديد

- **One primary rail** — the model's OWN named stops, exactly `desc.levels.length` dots, `min=0 / max=last / step=1`; the thumb is derived from the stored NAME. `EffortControl.tsx:112` (`ReasoningSlider`), CSS `effort.css:18`.
- **Real budgets visible** — each Claude stop shows `2,048 tok`, `8,192 tok`, `16,384 tok` (`effort.css` `.effort-stop-detail`, `shared/effort.ts:278`).
- **Two axes, clearly separated** — the engine `standard/deep` rail remains (v1137 contract) but is a quiet, explicitly-labelled *secondary* section: "Engine step budget" vs "Reasoning depth". `EffortControl.tsx:296` and `EffortControl.tsx:325`.
- **Calm hairline, no card** — single top hairline, no shadow, no blur, no gradient, no keyframes, no rounded card. `src/components/effort.css:18`.
- **Instrument Serif title** — `--font-display-serif` for Latin, `:root[lang=ar]` / `[dir=rtl]` override to Cairo. `effort.css:45`.
- **Tabular mono value** — `--font-mono-x` + `font-variant-numeric: tabular-nums`, `dir="ltr"` + `unicode-bidi: isolate`. `effort.css` `.effort-value`; rail pinned LTR so low→high never flips in RTL.
- **Both reduced-motion guards** — `@media (prefers-reduced-motion: reduce)` at `effort.css:216` and `html.reduce-motion` at `effort.css:225` (plus the untouched v1137 gates in `chat-final.css`).
- **Persistence** — `updateSettings({ model: { ...modelCfg, reasoning: next } })` on an explicit click (`EffortControl.tsx:252`) and carry-on-switch in both the picker (`ModelPicker.tsx:266`) and the chat control (`EffortControl.tsx:221`). The wire is changed in `electron/agent/providers.ts:2341` and, for Anthropic budgets, `electron/agent/providers.ts:1569`.

---

## 4. Verification — التحقق

```
npm run typecheck                                   # both tsc targets
node --test --test-force-exit tests/v1142-effort.test.mjs \
      tests/v1138-effort.test.mjs tests/v1137-chat-controls.test.mjs
```

`tests/v1142-effort.test.mjs` asserts:
- **1a–1c** GPT 4 names → `reasoning_effort`; o-series 3; Claude `thinking.budget_tokens` values; GLM 3 (and now a real GLM wire field); Gemini 2 + `{}`; unknown = curated.
- **2a** a real-shaped catalog fixture: advertised parameter → `provider-catalog` + exact wire; missing row/parameter → `curated`.
- **3a–3b** the chosen name survives GPT→o-series while the index re-scales (2/3 → 1/3) and the wire stays `medium`; off-like stops stay off across families; stale names are dropped; **3c** one stop step changes the actual request.
- **4a–4b** no dead-stop compare, carry in both choosers, two separated rails, hairline/serif/tabular/RTL/both motion guards.
- **5a–5c** SSR of the real `ReasoningSlider`: 4 dots + `max=3` for GPT, 3 dots + `max=2` for o-series with no invented `minimal`, Claude budgets `16,384 tok` / `2,048 tok`, and a closed chip that still exposes the engine stage (v1137 contract).

Result: **38/38 green** across v1142 + v1138 + v1137.

### Files changed / الملفات المعدّلة
- `shared/effort.ts` — universal off sentinel, `carryEffortLevel`, `effortLevelDetail`, honest catalog notes
- `src/components/EffortControl.tsx` — two separated rails, live-stop persistence, cross-model carry, new markup
- `src/components/ModelPicker.tsx` — always carry + normalize the chosen stop; real budgets + source caption
- `electron/agent/providers.ts` — descriptor-driven wire gate (effort mapping area only)
- `src/components/effort.css` — new hairline stylesheet
- `tests/v1142-effort.test.mjs` — new verification suite

`engine.ts`, `store.ts`, `chat-final.css`, `i18n.ts` and other panels were deliberately NOT edited.
