# Token Savings — v11.35 / توفير التوكنز — في 11.35

**Founder's request / طلب المؤسّس:** «أريد أن يكون هيك في طريقة جوا إنه يوفر التوكن… مشكلة توفير التوكنز» — a built-in way to save tokens, **without reducing capability** («ما في مانع، إحنا نعطيه كل القدرات»).

**Answer / الجواب:** five capability-neutral savings. Two were already built (v11.16 cache, v3/v11.34 profiles) and are now **verified and preserved**; one is **new** (tool-result dedupe helper). The rendered system prompt does not grow by a single byte.

---

## 1. Audit — what actually burns tokens per turn / أين تذهب التوكنز فعلًا

Measured with the repo's own esbuild harness (`tests/v1135-token-savings.test.mjs`, line 79). Token numbers are the standard **~4 UTF-8 bytes/token** heuristic (`econ.estimateTokens`); real counts vary by tokenizer.

| Surface / السطح | Bytes | ≈Tokens | Notes |
|---|---:|---:|---|
| EN system prompt (no tail) | **24,425 B** | ~6,107 | stable prefix 24,292 B + sentinel |
| EN byte-stable prefix (cached) | **24,292 B** | ~6,073 | identical on every turn → cache READ |
| AR system prompt | 35,895 B | ~8,974 | bilingual sections, EN terms kept |
| Dynamic tail (example: 6,000-char memory) | 6,558 B | ~1,640 | clock/workspace/memory — never cached |
| **145 tool schemas (`full`)** | **94,962 B** | **~23,741** | **largest per-turn input cost** |
| `core` profile (43 tools) | 27,662 B | ~6,916 | weak-model default |
| `balanced` profile (120 tools) | 79,103 B | ~19,776 | strong-model default |

**Finding:** with the `full` profile, the tool-schema wall (~92 KB) is **~3.9× larger than the entire system prompt**. It is re-sent every turn. That is the #1 token burn; the system prompt is second.

**النتيجة:** مع بروفايل `full`، جدار تعريفات الأدوات (~92 كيلوبايت) أكبر من كامل الـ system prompt بـ 3.9 مرة، ويُرسَل كل دورة — هذا أكبر حرق للتوكنز.

---

## 2. Numbered savings / التوفيرات بالأرقام

### ① Static-prefix prompt caching — verified, preserved
`electron/agent/prompts.ts:918` splits the prompt at `SYSTEM_CACHE_SPLIT` (`:83`); `memoStaticPrefix` (`:887`) builds the stable part once per (lang, taskMode, profile, mode, effort, vibe, protocol, platform). `providers.ts:1839` puts `cache_control: ephemeral` on the stable system message only; `providers.ts:1990` also marks the last tool definition and the top-level directive.

- 5 turns with different dynamic tails → **1 cache write + 4 cache reads** (test line 114).
- Static prefix ≈6,073 tok/turn: 5×6,073 = **30,365** token-equivalents without cache → **6,073 + 4×607 = 8,501** with cache ⇒ **~72% cheaper** on that block.
- The dynamic tail is deliberately **not** cached, so clock/memory changes cannot invalidate the prefix.

### ② Per-profile tool definitions — verified, preserved (capability-neutral)
`tool-defs.ts:2366 defsForProfile` and `src/lib/modes.ts advertisedToolProfile` (wired in `engine.ts:2624`) show a **per-turn view**, never a deletion:

- `full` = 145 defs / 94,962 B. `core` = 43 defs / 27,662 B → **−67,300 B ≈ −16,825 tokens per turn** for a weak model.
- **All 145 tools still execute.** `engine.ts:2621` resolves `executeTool()` against the full registry; `tests/v1134-all-tools.test.mjs:203` proves a tool hidden from both focused views (`markdown_outline`) still runs with no "not in profile" refusal. `tests/v1135-token-savings.test.mjs:228` re-proves 145 defs / 145 executors.

### ③ Compact capability roster — preserved verbatim
`prompts.ts:799-812` (`# CAPABILITY ROSTER — intent → exact names (tool_help for args)`) is the V15 short list of real tool names grouped by intent. Weak models no longer need the 145-name wall, and `prompts.ts:769` still tells them hidden-by-profile tools «still WORK — call them by exact name». Byte delta of this block is unchanged (V15 replaced the old prose byte-for-byte).

### ④ NEW — tool-result deduplication helper (pure, capability-neutral)
`electron/agent/tokenEconomy.ts:185 dedupeToolResults()` collapses **byte-identical** tool-result bodies (≥256 chars, default) in the conversation history to a short reference. The marker keeps the first copy's `callId`, the exact byte/token saving and a 48-char escaped preview:

```
[token-economy: identical tool output omitted (3263 chars, ~816 tokens saved).
 Full UNCHANGED output is in the earlier tool result c1; preview: "LOG LINE — …".]
```

Measured on the test history (test line 143): **12,186 B → 6,048 B = −6,138 B ≈ −1,535 tokens (50.4%)**.

**Why this cannot break tools:** no message is removed; roles, order, `callId`s and `isError` flags are untouched (OpenAI tool_call/tool_result pairing stays legal); the FIRST occurrence of every distinct output stays verbatim; only an *identical* later copy is shortened and it points to the surviving full text. Tests at lines 170 and 209 assert exactly that. The helper is pure and never touches tool names, profile views or the dispatcher.

### ⑤ Zero rendered-prompt growth
The new section `prompts.ts:1020-1074` is **additive code outside** `buildStaticSystemPrefix`/`buildSystemPrompt`. Rendered EN prompt = **24,425 B before and after v11.35 (net 0)**. It re-exports the helpers (`:1058`) so the engine can import `dedupeToolResults` from its existing `'./prompts'` import.

---

## 3. Byte caps — measured before/after / الحدود بايتية

| Cap / الحد | Requirement | Measured | Status |
|---|---|---|---|
| v11.16 EN < 24 KB | < 24,576 B | **24,425 B** | ✅ (−151 B headroom) |
| v11.21 +671 ≤ 700 | size − 23,754 ≤ 700 | **+671** | ✅ (29 B headroom) |
| v11.23 +44 | 0 ≤ size − 24,381 < 400 | **+44** | ✅ |
| v1134 roster | 145 defs, roster markers present | intact | ✅ |

Net rendered byte change from v11.35: **0 B**. Tests `v1132-prompt-real` and `v1116-prompt-cache` remain green.

---

## 4. Verification / التحقق

```
npx tsc -p tsconfig.node.json --noEmit                              → clean (0 errors)
node --test --test-force-exit tests/v1135-token-savings.test.mjs    → 7/7 pass
node --test --test-force-exit tests/v1116-prompt-cache.test.mjs     → 11/11 pass
node --test --test-force-exit tests/v1134-all-tools.test.mjs        → 6/6 pass
node --test --test-force-exit tests/v1111-tools2.test.mjs           → 23/23 pass
node --test --test-force-exit tests/v1132-prompt-real.test.mjs      → 7/7 pass  (byte caps)
```

**Exact file:line of my changes / مواضع التعديل بدقة:**
- `electron/agent/prompts.ts:1020-1074` — token-economy section (additive; `:1044` descriptor, `:1058` helper re-exports). No edit inside `buildStaticSystemPrefix` / `buildSystemPrompt`.
- `electron/agent/tokenEconomy.ts:30-234` — new pure module (`:77 utf8Bytes`, `:95 estimateTokens`, `:124 stableFingerprint`, `:129 savingsReport`, `:185 dedupeToolResults`, `:223 dedupeWithReport`).
- `tests/v1135-token-savings.test.mjs:79,100,114,143,170,209,228` — audit, caps, cache, dedupe savings, capability-neutrality, edge cases, all-tools.
- `docs/TOKEN-SAVINGS-V1135.md` — this file.

---

## 5. Honest caveats / تحذيرات صادقة — what STILL costs tokens

1. **The dedupe helper is pure and is not yet wired into the runtime.** `engine.ts` is owned by another agent; the savings above are **proven on representative histories by the test**, but become live only when the engine owner wraps the `messages[]` passed to `streamTurn()` (`engine.ts:5505` / `:2555`) with `dedupeToolResults`. No behaviour changes until then. / مساعد الإزالة جاهز ومُختبر لكنه ليس موصولًا بعد بمحرك التشغيل؛ يصبح فعّالًا عند ربطه من قِبل صاحب ملف engine.
2. **Caching needs provider support.** Gateways that reject `cache_control` with 400/422 are auto-downgraded to a plain request (sticky per endpoint, `providers.ts:1799-1826`) and then bill **full price**. Ollama/local models usually have no prompt cache. OpenRouter prefix caching depends on sticky routing. Only real cache READs cost 10% (cache WRITE costs 125%).
3. **OpenAI-compatible tool placement.** On the OpenAI wire the `tools[]` array is a separate field that follows the conversation in JSON order; the "last tool" breakpoint mainly helps Anthropic-style endpoints. The **guaranteed** tool-schema saving is therefore the profile view (②), not cache reads on tools.
4. **The dedupe estimator is a heuristic** (~4 bytes/token). Arabic, emoji and dense code tokenize differently — actual savings may be larger or smaller; the byte figures are exact.
5. **Dedupe is byte-identical only.** Two outputs that are merely similar are NOT folded — deliberately, so no information can be lost. If compaction later prunes the first full copy, a reference can dangle; the marker's preview and callId exist to reduce that risk, and `recall_result` may still restore the original.
6. **Output tokens are unchanged.** None of these savings cap or shorten the model's reply — capability and answer length are fully preserved. Savings are on **input** (and cache price), mostly from turn 2 onward.
7. **Byte band is tight:** EN prompt must stay within [24,381 ; 24,454] B for the v11.32/v11.23 caps. Adding any economy prose to the static prefix would break it — which is why v11.35 adds zero rendered bytes.
