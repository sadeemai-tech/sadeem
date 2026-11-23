# P0 DIAGNOSIS — Request-Building Path / Latency
# تشخيص P0 — مسار بناء الطلب / البطء الشديد

Date: 2026-11-19 · Scope: `electron/agent/{prompts,tools,tool-defs,engine,providers,memory,dna,playbook}.ts`
Posture: **DIAGNOSIS ONLY — no source file was edited.** Measurements were taken by transpiling the real TS modules with TypeScript and calling the real `buildSystemPrompt()` / `defsForProfile()` functions (temp harness in `D:\ORION\data\cache\tmp\opencode\diag_measure.cjs`). Numbers below are **measured**, not guessed.
المنهج: **تشخيص فقط — لم أعدّل أي ملف مصدر.** القياسات أُخذت بتحويل وحدات TS الحقيقية واستدعاء `buildSystemPrompt()` / `defsForProfile()` الفعليتين. الأرقام أدناه **مقاسة** لا مقدّرة.

---

## 0. HEADLINE / الخلاصة

The mock provider test is fast (local `node:http`, first token ~0.5–2 s) because **localhost uploads 130–180 KB instantly and the mock has no real prefill cost**. The real path sends the **same 130–180 KB to a remote provider every turn**, usually through an OpenAI-compatible endpoint (`custom` / `openrouter` / `ollama`) where **prompt caching is never applied** — see §2. On top of that, a weak model is asked to choose from **119 tool schemas (~70 KB of JSON)** on every call. That is the "يقعد مليون سنة يرد / stopped thinking / full of errors" signature.

اختبار الـ mock سريع لأنه محلي (رفع 130–180 كيلوبايت على localhost فوري، بلا تكلفة prefill حقيقية). المسار الحقيقي يرسل **نفس 130–180 كيلوبايت إلى مزوّد بعيد في كل دورة**، وغالباً عبر نقطة متوافقة مع OpenAI حيث **لا يُفعّل التخزين المؤقت للـ prompt إطلاقاً** (§2). وفوق هذا يُطلب من النموذج الضعيف الاختيار من **119 مخطط أداة (~70 كيلوبايت JSON)** في كل استدعاء. هذا هو بالضبط توقيع الشكوى.

---

## 1. MEASURED PAYLOAD / حجم الحمولة المقاس

### System prompt (`prompts.ts:378` `buildSystemPrompt`)
| Configuration | chars | UTF-8 bytes |
|---|---:|---:|
| Minimal EN static core (no memory/DNA/playbook/skills/MCP/env/taskMode) | 34,168 | **34,512** |
| Minimal AR (bilingual sections) | 40,321 | **45,224** |
| + taskMode `build` | 34,564 | 34,916 |
| + taskMode `debug` / `review` | 34,967 / 34,896 | 35,327 / 35,246 |
| + vibe section (default ON) | +2,650 | ~2,650 |
| + textToolProtocol (custom/openrouter/ollama) | +403 | ~405 |
| + project memory slice 6,000 | +6,031 | ~6,031 |
| + DNA 3,000 | +3,455 | ~3,455 |
| + playbook 3,000 | +3,403 | ~3,403 |
| + envSummary 1,000 | +1,234 | ~1,234 |
| + 20 MCP tools listed | +2,247 | ~2,247 |
| **FULL realistic (AR + all sections above)** | **58,209** | **63,195** |

> The older "34k chars system prompt" vibe report was **exactly the minimal English static core (34,168)**. With the new memory/DNA/playbook/continuity/vibe/cursor sections the real Arabic prompt is **58k chars / ~63 KB** — ~1.8× bigger in bytes.

### Tool schemas (`tool-defs.ts:30` `CORE_DEFS`, filtered by `tool-defs.ts:2081` `defsForProfile`)
| Profile | count | Anthropic JSON bytes | OpenAI JSON bytes |
|---|---:|---:|---:|
| `full` | **145** | 86,784 | 90,989 |
| `balanced` (default) | **119** | **70,209** | 73,660 |
| `essential` | 40 | 24,921 | 26,081 |

Descriptions alone = 34,447 B, JSON schemas = 44,018 B (full). Largest single entries: `desktop_control` 1,603 B, `media_ffmpeg` 1,364 B, `web_download` 1,332 B, `make_document` 1,255 B, `task` 1,244 B.

### Per-request total (system + tools + transcript)
| Scenario | Bytes | ≈ KB |
|---|---:|---:|
| EN minimal system + balanced tools | 34,512 + 70,209 = 104,721 | ~102 KB |
| **AR full system + balanced tools** | **63,195 + 70,209 = 133,404** | **~130 KB** |
| same + 20 KB recent transcript | 153,404 | ~150 KB |
| same + 50 KB recent transcript | 183,404 | ~179 KB |
| worst case: AR full + `full` tools 145 + 20 KB transcript | 149,979 + 20,000 = 169,979 | ~166 KB |

**The tool list is 53% of the entire request.** This is the single biggest avoidable block.

---

## 2. RANKED CAUSES / الأسباب مرتّبة بالخطورة

### P0-1 — No prompt caching on the real (OpenAI-compatible) provider path
`providers.ts:901-930` (`streamAnthropic`) sets `cache_control` on the system block + last tool + rolling message breakpoint. `providers.ts:1269-1319` (`streamOpenAICompat`) — used by `custom`/`openrouter`/`ollama` and every "weak model" route — sets **no caching at all**. Those are exactly the providers the founder is likely on. Every one of the ~130 KB is re-prefilled on every turn.
`providers.ts:901-930` يضع `cache_control` لمزوّد Anthropic فقط؛ `streamOpenAICompat` (المزوّدات المخصّصة/OpenRouter/Ollama) **لا يضع أي تخزين مؤقت** — كل الـ130 كيلوبايت تُعاد معالجتها في كل دورة.
**Minimal fix:** add an OpenAI-compatible prefix-caching strategy where supported (OpenRouter/DeepSeek prompt-cache headers, or at minimum do not re-send the static system block — keep it server-side). Verify with a cache-hit telemetry field.

### P0-2 — 119 tool schemas re-sent on EVERY internal call, not just the main turn
`engine.ts:2051` builds `toolDefs` once, then the **same 119-def array (~70 KB)** is passed to `runLoop` at `engine.ts:2548` (main), `2593` (auto-continue), `2630`, `2677` (UI-fix round), `2785`, `2907` (goal verifier), `2977`, `3262`. Each auto-continue / verification round re-uploads system 63 KB + tools 70 KB. A long task with 3–5 internal rounds = 210–350 KB of tool JSON alone. This directly explains "takes forever" on long tasks.
نفس مصفوفة الـ119 أداة (~70 كيلوبايت) تُرسل في كل جولة داخلية (الرئيسية، المتابعة، التحقق، إصلاح الواجهة، الحكم على الهدف). مهمة طويلة بـ3–5 جولات = 210–350 كيلوبايت مخططات أدوات وحدها.
**Minimal fix:** for verifier/critic/self-critique/gate calls, pass a **restricted tool list** (there is already a precedent at `engine.ts:2833` which filters to `run_command`+`read_file`). Send the 119-def list only to the main agent loop.

### P0-3 — Arabic bilingual prompt doubles the byte cost
`prompts.ts:384,447,500,542,579,869,876` — when `language === 'ar'`, `bi()` emits English **and** Arabic. Measured 34,512 B → 45,224 B (+31%) for the static core, and up to 63 KB full. The founder writes Arabic; this is the default user path. The Arabic sentences are mostly repetitions of the English rule, so they buy little for a model that already understands English technical terms (the file itself says "English technical terms stay verbatim").
عند العربية يُرسل النص الإنجليزي **والعربي** معاً: 34.5 → 45.2 كيلوبايت (+31%) للقسم الثابت، وحتى 63 كيلوبايت كاملاً — مع أن معظم الجمل العربية تكرار للقاعدة الإنجليزية.
**Minimal fix:** emit one language per section (Arabic-only prose, keep English tool/terms), or gate bilingual mode behind a setting. Saves ~10 KB per request.

### P1-4 — Duplicate memory injection (MEMORY.md vs memory-snapshot)
- `engine.ts:1855-1875` builds `memory` from global settings + `AGENTS.md` / `KODEX.md` / `MEMORY.md` (cap `MEMORY_CAP = 6000` at `engine.ts:190`, up to 12 KB total) → injected at `prompts.ts:851-853` as `# Project memory (MEMORY.md)`.
- `playbook.ts:323-365` `renderPlaybookPrompt` **appends** `renderMemoryBlock()` (the `.surnia/memory-snapshot.json` blob, cap `RENDER_CAP = 2600` at `memory.ts:44`) to the playbook section by default (`opts.includeMemory !== false`). Engine calls it with **no options** at `engine.ts:2100`, so this always happens → injected at `prompts.ts:840-848`.
- Net: two memory blobs (up to ~8.6 KB) plus two advisory headers, reconstructing the same "journal + playbook + DNA + compaction summaries" facts from `memory.ts:592`. Exact overlap is data-dependent but structurally duplicated. The comment at `playbook.ts:348-352` even says this exists to make memory "reach EVERY run's system prompt" — which the separate `memory` injection already does.
ذاكرة تُحقن مرتين: ملفات MEMORY.md/AGENTS.md/KODEX.md (حتى 12 كيلوبايت) عبر `prompts.ts:851`، و`.surnia/memory-snapshot.json` (حتى 2.6 كيلوبايت) داخل قسم الـ playbook عبر `playbook.ts:356` ← `engine.ts:2100`. نفس الحقائق مرتين.
**Minimal fix:** call `renderPlaybookPrompt(playbook, { includeMemory: false })` at `engine.ts:2100` — the memory already arrives via `opts.memory`. Saves up to 2.6 KB + wrapper.

### P1-5 — Three copies of the same "advisory — never a rule" boilerplate
`dna.ts:494-498`, `playbook.ts:327-330`, `memory.ts:592-594`, plus the wrappers at `prompts.ts:831,845` — each repeats ~300–500 chars of "ADVISORY, never rules/bans/permissions, current request wins, never mention". Combined ≈ 1.5–2 KB of pure meta-text per request, and it is exactly the kind of repetitive instruction that makes weak models drift/errors.
ثلاث نسخ من نفس التوجيه "استشاري — ليس قاعدة" في DNA والـ playbook والذاكرة، مع أغلفة إضافية في prompts.ts ≈ 1.5–2 كيلوبايت تكرار.
**Minimal fix:** one shared advisory header emitted once above all three data blocks.

### P1-6 — Static prompt rebuilt from scratch every turn (O(n) string work, repeated)
`engine.ts:2104-2135` calls `buildSystemPrompt` on every turn; `prompts.ts:386-916` re-pushes ~40 large string literals (~34–63 KB) and re-joins them. `collectProjectRules` is cached 30 s (`prompts.ts:361-375`) but the rest is not. `getToolDefs` (`tools.ts:676-699`) re-copies all 145 defs (`[...CORE_DEFS]`) + filters on every LLM call, and **again on every tool execution** at `tools.ts:743`, `749`, `712` (the unknown-tool path calls it yet again to build `all`). That is 3 full 145-def rebuilds per tool call. CPU cost is modest (~sub-ms), but it is pure repeated work and it defeats any intent of "build once, reuse".
إعادة بناء قسم الـ34–63 كيلوبايت في كل دورة، وإعادة نسخ/تصفية الـ145 تعريف أداة 3 مرات لكل استدعاء أداة (`tools.ts:712,743,749`).
**Minimal fix:** memoize the static prefix (keyed by language/effort/taskMode/mode + rule signature) and build `getToolDefs` result once per session keyed by `(profile, MCP signature)`.

### P2-7 — Stale count comments / doc drift (not a latency cause, but fix the record)
`tool-defs.ts:1` says 145 (correct); `shared/types.ts:920` says "'full' = all 134" (stale); `prompts.ts:769` says "37% of tools had no prompt guidance" and `tool-defs.ts:2066` reclassified LSP — these comments are the reason the size crept up unnoticed. Not a fix target for latency, but update when touching the files.

### P2-8 — "Stopped thinking" is consistent with reasoning budget = off
`providers.ts:801-805` `wantedThinkingBudget()` returns **0** when `model.reasoning` is absent or `'off'`; `THINKING_BUDGETS` at `providers.ts:800`. There is no `reasoning` default in `storeService.ts`. Combined with a 130 KB prompt and 119 tool schemas, a weak model produces shallow/erratic output. This is a provider-config check outside the strict request-building scope, but it must be verified on the founder's actual model config.
`wantedThinkingBudget` يُرجع 0 إذا لم يكن `reasoning` مفعّلاً — تحقّق من إعداد النموذج الحقيقي.

---

## 3. ANSWERS TO THE 5 EXPLICIT QUESTIONS / إجابات الأسئلة الخمسة

1. **Actual serialized payload size:** ~**130 KB** for the realistic Arabic case (63 KB system + 70 KB balanced tools), ~**150 KB** with a 20 KB transcript, ~**166 KB** in the full-tools worst case. English/minimal is ~102 KB. The tool list is 53% of it. **Measured**, see §1.
2. **Redundant/duplicated sections:** YES — memory is injected twice (`engine.ts:1855-1875` → `prompts.ts:851` AND `playbook.ts:356` → `engine.ts:2100` → `prompts.ts:840`). DNA + playbook + memory also repeat the same advisory header 3× (`dna.ts:494`, `playbook.ts:327`, `memory.ts:592` + `prompts.ts:831,845`).
3. **O(n²)/repeated work:** no true O(n²), but real repeated work — `buildSystemPrompt` rebuilds 34–63 KB every turn (`engine.ts:2104`), `getToolDefs` rebuilds/filters 145 defs on every tool call ~3× (`tools.ts:712,743,749`), and the same 70 KB tool list is re-sent on 8 internal `runLoop` call sites (`engine.ts:2548,2593,2630,2677,2785,2907,2977,3262`).
4. **Tool Profile default:** **YES, balanced is actually applied** — `storeService.ts:46` `agent: { toolProfile: 'balanced' }` → `agentTuning()` `engine.ts:1185-1190` → `cfg` `engine.ts:1452` → `getToolDefs(enabledMcp, cfg.toolProfile ?? 'balanced')` `engine.ts:2051`. So **119 defs** are sent, not all 145. `getToolDefs`'s own default is `'full'` (`tools.ts:678`) but the engine overrides it. (`full` would be 87 KB — still huge.)
5. **Where default is read:** `electron/services/storeService.ts:46` (default value), `electron/agent/engine.ts:1185-1190` (read via `getSettings().agent`), `electron/agent/engine.ts:1182` (type), `shared/types.ts:922` (settings schema), `electron/agent/engine.ts:2051` (applied).

---

## 4. MINIMAL FIX SET (proposals only — NO source was edited)
## الإصلاح الأدنى (مقترحات فقط — لم أعدّل أي مصدر)

Ordered by bytes saved per unit of risk:

1. **Cheap + safe:** `engine.ts:2100` → `renderPlaybookPrompt(playbook, { includeMemory: false })`. Removes the duplicate memory blob (−2.6 KB) with one argument.
2. **Cheap + big:** restrict tools on verifier/critic/continuation `runLoop` calls (`engine.ts:2593,2630,2677,2785,2907,2977,3262`) to a 2–10 tool subset, mirroring `engine.ts:2833`. Saves ~60–70 KB per internal round.
3. **Medium + big:** emit one language in `buildSystemPrompt` (or make bilingual opt-in). −10 KB on the Arabic path.
4. **Medium + big:** implement/verify prompt caching for the OpenAI-compatible path (`providers.ts:1269`), or keep the static system prefix server-side. This is the difference between 2 s and "forever" on a remote weak model.
5. **Medium:** memoize the static prompt prefix and per-session tool defs (§3.6).
6. **Cleanup:** single shared advisory header; update the stale "134 tools" comment at `shared/types.ts:920`.
7. **Verify:** check the founder's actual model has `reasoning` enabled (`providers.ts:801-805`) — otherwise "stopped thinking" is part config, part prompt overload.

**Brutally honest bottom line:** the engine is not hanging; it is drowning its own model. ~130 KB of mostly static text + 119 tool schemas per request, re-sent 3–8× per long turn, with no caching on the most likely provider. The 2 s mock result proves the streaming plumbing is fine — it does not prove the real request is cheap. Fix #2 and #4 first; everything else is polish.
**الخلاصة بصراحة:** المنظومة لا تتجمد؛ النموذج يغرق. ~130 كيلوبايت نص ثابت + 119 مخطط أداة في كل طلب، تُ resent 3–8 مرات في المهمة الطويلة، بلا تخزين مؤقت على المزوّد الأرجح. نتيجة الـ mock (2 ثانية) تثبت أن البثّ سليم، لا أن الطلب خفيف. أصلح #2 و#4 أولاً.
