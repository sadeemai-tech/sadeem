# TOOL-LOOP / MALFORMED-TOOL-JSON — v11.37 verdict

## الحكم (Arabic — blunt)

**لا، المشكلة ما عادت تتكرر.** الحالة اللي بلّغ عنها المؤسس — `pdf_make` يطلع نفس المسار الفاشل ٤ مرات وبعدين التشغيل يوقف — **انكسرت** في المحرك. النموذج لسه يقدر يحاول؛ المحرك يوقف التكرار بعد محاولتين حقيقيتين، يعطي **إشعار مرئي واحد** فيه **الإصلاح الحرفي** اللي رجّعت الأداة، و**نتيجة أداة صناعية** تقول له غيّر المعطيات أو استخدم أداة ثانية، وبعدين يكمل التشغيل لجواب نهائي. ما فيه توقف صامت، وما فيه حلقة، وما فيه موافقة `doom_loop` تقطع التشغيل.

كمان: القالب المشوّه اللي كان يطلع ايرور كل مرة — `{"tool":"pdf_make","args":{...}}}` بقوس زايد / غلاف `tool`+`args` / نسخ مكررة — صار **يُقرأ كاستدعاء واحد صحيح** ويُنفّذ مرة واحدة.

## Blunt verdict (English)

**No — "tool error → 4 identical retries → run stops" does NOT reproduce anymore.**
The founder's exact repro (same failing `pdf_make` path ×4, then stop) is fixed at the engine level:

- Only **1–2 real dispatches** happen for a failing call with the same tool name + normalized arguments. Attempts 3+ are **never sent to `executeTool`**.
- **Exactly ONE** visible `sys_notice` (`kind: "tool_loop_breaker"`) carries the tool's **own actionable error verbatim** plus `EXACT FIX:` — never a generic “failed”.
- A **synthetic `tool_result`** reaches the model with the same error + the instruction to change the arguments **or use a DIFFERENT tool**.
- The run **continues to a final answer** with one `task_report` + one `turn_end`. There is no `doom_loop` approval and no silent stop.
- The malformed envelope `{"tool":"pdf_make","args":{...}}}` (extra brace, duplicate blocks) is unwrapped/repaired into **one valid call**; a genuinely truncated object is still rejected (v119 E6 contract preserved).

Proof: `tests/v1137-tool-loop.test.mjs` (real engine, scripted local provider, zero external network) — 4/4 green. Existing `v1132-loop`, `v1136-interruption`, `v1136-interruption-guard`, `v119-engine` all stay green; `tsc -p tsconfig.node.json --noEmit` clean.

## Root cause (what was actually broken)

1. `pdf_make` returned an actionable error, but the model re-emitted the **same call** with cosmetic differences (key order / path separators) — the strict `toolCallHash` fingerprint did not match, so the v11.32 breaker never armed.
2. On the 3rd identical call the legacy **doom-loop gate** asked for `approve({kind:'doom_loop'})`; a denied/no-decision path returned `[doom loop stopped]` — that is the “انقطاع / stop” the founder saw.
3. Weak providers emitted a nested `{"tool","args"}` envelope with a trailing brace; `JSON.parse` threw, so every attempt became `MALFORMED_JSON_MSG` and looped forever with **no breaker at all** (the old breaker was guarded by `!p.invalid`).

## Exact locations (file:line — `electron/agent/engine.ts`)

| Change | Line |
|---|---|
| Balanced-object extractor + `parseToolArgs` (unwrap envelope, tolerate trailing braces / duplicates) | `541`, `590` |
| `parseTextToolCalls` now repairs + dedupes to one call | `638` |
| Native `tool_use` args repaired before validation (full registry set) | `6267` |
| `TOOL_LOOP_BREAKER_NUDGE` / `actionableFixFrom` (M1 `Fix:` style supported) | `868`, `877` |
| `normalizedToolCallKey` (name + normalized args) | `919` |
| `MALFORMED_JSON_MSG` now gives the precise envelope/extra-brace fix | `1688` |
| Run-scoped normalized breaker state (`normalizedFailureCounts`, `normalizedBlocked`, `actionableFixByKey`, `loopNoticesSent`) | `5146`–`5151` |
| `emitLoopBreakerNotice` — ONE notice per fingerprint, exact tool error + `EXACT FIX` | `6415` |
| `blockedRetryOutput` — synthetic tool_result, change args / DIFFERENT tool | `6428` |
| Hard cap in `execPrepared` before `tool_start` / `executeTool` (no dispatch on retry) | `6454`–`6471` |
| Doom-gate skipped for a call already known to have failed (no approval-stop) | `6533`–`6534` |
| INVARIANT comment + bookkeeping: arms on `!outcome.ok` + name + normalized args ONLY; stores verbatim error, emits single notice, success clears cap | `6784`, `6792`–`6802` |

Guard rails kept intact: `tool_start`/`tool_result` pairing (`breakerBlockedCallIds`), compaction threshold, tool-def advertisement, subagent transcript calls, `tools.ts`/`tool-defs.ts`/`store.ts`/`prompts.ts` untouched by this change.

### Regression note (M1 `tools.ts` change)

M1 rewrote `pdf_make` to append `.pdf` to a `*.txt` destination, so the original harness fixture (`path:'report.txt'`) **succeeded** — 4 dispatches, no failure, therefore no breaker (and a doom-loop notice). That was a **test-fixture** problem, not an error-text dependency: the breaker has always armed on `!outcome.ok` + name + normalized args (`engine.ts:6792`), never on error wording. The harness now uses `pdf_make` with **no content**, which deterministically fails under the current `tools.ts`; `tests-v1137-loop-guard.mjs` (root) independently uses `read_file` on a missing path and stays green. `actionableFixFrom` (`engine.ts:877`) now also understands M1's `Fix: …` error style so the verbatim fix relay survives error rewrites.

## Repro / verification commands

```bash
npx tsc -p tsconfig.node.json --noEmit
node --test --test-force-exit tests/v1137-tool-loop.test.mjs
node --test --test-force-exit tests/v1132-loop.test.mjs tests/v1136-interruption.test.mjs tests/v1136-interruption-guard.test.mjs tests/v119-engine.test.mjs
```
