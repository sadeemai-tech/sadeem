# v11.26 — AI Continuity Verdict / حكم اختبار استمرارية الذكاء الاصطناعي

> Harness: `tests/v1126-ai-continuity.test.mjs` — drives the **REAL**
> `electron/agent/engine.ts` `runAgent()` (esbuild-bundled, electron stubbed) against a
> **local scripted OpenAI-compatible provider** (`node:http`, loopback only), then replays
> every engine event into the **REAL** `src/store.ts` `ingestAgentEvent`.
> **No application source was edited by this agent.** Zero network, zero model, reproducible.

```
node --test --test-force-exit tests/v1126-ai-continuity.test.mjs
# debug timelines: V1126_DEBUG=1 node --test --test-force-exit tests/v1126-ai-continuity.test.mjs
```

---

## 1. Final run result / نتيجة التشغيل النهائي

| | |
|---|---|
| Command | `node --test --test-force-exit tests/v1126-ai-continuity.test.mjs` |
| Tests | 1 suite — **9 scenarios: 8 PASS / 1 FAIL** |
| Wall time | ≈8–11 s total (scaled clocks) |
| Open failure | **S1 — (a) mid-answer stream drop recovers SILENTLY** (impact **I1**) |
| Failure count | **1** |
| Exit code | **1** (harness deliberately fails on any defect — no silent pass) |
| Stability | Final result confirmed on **3 consecutive runs** after source edits settled |
| Finding fixed mid-session | S2 (garbage SSE) was red at first run, then went green after A1/A2/A3 shipped the v11.26 stream-continuity fix (§3.2) |

Every failed check is printed as `[V1126 FAIL] <scenario> :: [I#] <check> :: <detail> :: @<file>:<line>`
plus a ranked report. A green run is the only "AI never disconnects" signal.

---

## 2. The scenario matrix / مصفوفة الحالات

| # | Case | What was driven | Result |
|---|------|-----------------|--------|
| S1 | **(a)** stream drops mid-answer then recovers | socket destroyed after 2 answer deltas; `SURNIA_STREAM_CONTINUE_BUDGET=2` | ❌ **FAIL (I1)** — recovery works, but **no visible notice** reaches the user (§3.1) |
| S2 | **(b)** garbage SSE | non-SSE bytes + unparseable `data:` frame + `event:` frame, no `finish_reason`, no `[DONE]` | ✅ **PASS** after fix — 7 bounded attempts, one visible `slow_provider` notice, honest `outcome:'error'` (§3.2) |
| S3 | **(c)** long stream, periodic deltas | 320 deltas, 2 ms apart (scaled-clock "hours"), 1 request | ✅ **PASS** — byte-for-byte, incremental (not buffered), text spread across ~950 ms, no idle-gap kill |
| S4 | **(d)** tool throws | real `run_command` `mkfs.ext4 /dev/sda` → `assertCommandSafe()` throws | ✅ **PASS** — `tool_result ok:false` with `BLOCKED_DANGEROUS_COMMAND`, no global error row, run continues to a written answer |
| S5 | **(e)** user abort mid-thinking | abort fired on 3rd `reasoning_content` delta | ✅ **PASS** — `aborted` + `task_report outcome:'aborted'`, no error row, `turn_end` last |
| S6 | **(f)** post-processing throws | one-shot IO failure injected on `message_end` (completion pipeline) | ✅ **PASS** — one `error`, one `task_report` repeating it verbatim, `turn_end` last, `running:false` |
| S7 | **(g)** provider returns 402 | mid-run 402 with raw JSON gateway body | ✅ **PASS** — exactly **2** requests (no silent retry), one classified credits error, `outcome:'error'` |
| S8 | **(h)** 429 then success | 429 + `retry-after:0`, then valid stream | ✅ **PASS** — exactly **2** requests (one bounded same-provider retry), no error row, `outcome:'completed'` |
| S9 | **Hours-long simulation** | **240 tool rounds** (above the default 120-step budget), scaled clocks, ended only by user abort | ✅ **PASS** — §4 |

### Per-case contract — checked on EVERY scenario (the task's "FOR EACH assert")

1. **No silent stop** — visible activity exists; no `max_tokens`/`time_cap` stop; no unbounded mid-run gap; non-empty written answer on success paths.
2. **Exactly one terminal `task_report` with an honest written outcome** — exactly 1; `outcome` derived from the run's own evidence (`aborted` event → `aborted`, `error` event → `error`, else `completed`); non-placeholder written `summary`; error reports repeat the one error verbatim.
3. **`turn_end` last** — exactly 1, after the report, with no user-visible event after it (only `dna_updated` is tolerated, per `engine.ts` sink guard).
4. **`running` clears** — asserted after replaying all events into the real store.
5. **No duplicate error rows** — at most one `error` event and one `error` transcript row.
6. **All real tool calls reported** — exact `tool_start` count, one `tool_result` per start, ids paired, honest `ok:boolean`.
7. **Local overhead bounded** — last activity → report ≤4 s (10 s for the hours-long run), report → `turn_end` ≤1 s, whole run ≤90 s (180 s long run).
8. **No raw JSON user-visible** — checked in answer text, thinking text, error messages, report summary/next steps and error rows (machine tool output excluded).

All eight pass on S2–S9. S1 passes 1–8 but fails the **dedicated interruption-visibility assertion**: the stream resumes correctly and the answer is complete, yet the user is never told the connection dropped.

---

## 3. Findings / الإخفاقات

### 3.1 OPEN — I1 — S1 (a): mid-answer recovery is SILENT

**Observed (V1126_DEBUG, final verified run, 267 ms, 2 provider requests):**

```
     7ms  sys_notice/run_start  Starting…
     7ms  heartbeat
   156ms  heartbeat
   215ms  text_delta  Partial answer that the provider will drop mid-sentence
   239ms  text_delta  — resumed on the SAME task. Recovery complete. Written report follows.
   263ms  message_end
   263ms  task_report  Partial answer … — resumed on the SAME task. Recovery complete. …
   264ms  turn_end
```

There is **no `sys_notice` about the drop**. The provider re-requested the same task and the
answer is correct — but from the user's seat the answer paused and then continued with no
explanation. This is the founder's exact class of complaint: "اتقطع الذكاء الاصطناعي" / "a
minute of nothing, then it starts." With a real network the 24 ms scaled gap can be seconds,
and a silent resume is indistinguishable from a freeze.

**Root cause (exact anchors — search by expression; lines drift as A1/A2/A3 edit):**

| File:line | Expression | Role |
|---|---|---|
| `electron/agent/providers.ts:2235-2240` (grep `stream_recovered`) | `a.onNotice?.({ kind: 'stream_recovered', text: '… connection dropped mid-answer — resuming from the last streamed token …' })` | v11.26 provider-level resume correctly CREATES a user-visible notice |
| `electron/agent/engine.ts:5092-5165` (grep `const r = await streamTurn({`) | the main run's `streamTurn({...})` call passes `onText/onThinking/onToolUse/onUsage/onHeartbeat` — **but no `onNotice`** | the notice is silently discarded — `grep onNotice electron/agent/engine.ts` returns **zero matches** |
| `electron/agent/engine.ts:5231` (grep `stream interrupted mid-answer`) | `notice('sys', '\n[stream interrupted mid-answer — auto-continuing the same task]\n')` | the OLD engine-level notice is now **bypassed**: `routeStream()` in providers.ts resumes the drop internally before the engine ever sees a failed attempt |
| `electron/agent/providers.ts:2227-2232` (grep `stream_incomplete`) | `a.onNotice?.({ kind: 'stream_incomplete', … })` | terminal drop notice is dropped by the same missing wiring |

**Fix direction — NOT applied by this agent (engine owner):** wire `onNotice` into the main
`runAgent` `streamTurn` call and forward provider notices through the existing deduped
`notice()` channel, e.g. `onNotice: (n) => notice(n.kind, n.text)` (mapped to a `sys_notice`
event). Then `stream_recovered` / `stream_incomplete` become visible and this test goes green.
Alternatively emit the notice from the engine when a `StreamDroppedError` is caught. Do **not**
fix by deleting or weakening this assertion — the user has a right to see the interruption.

### 3.2 FIXED mid-session — S2 (b): garbage SSE used to be a silent clean `completed`

**Before the fix (first verified run, 73 ms, 1 request):**

```
     0ms  sys_notice/run_start  Starting…
    65ms  heartbeat
    71ms  message_end
    71ms  task_report        Nothing was changed on disk in this run.
    71ms  turn_end
```

No `text_delta`, no `think_delta`, no `tool_start`, no `error`, no notice. `outcome:'completed'`,
`partial:false` — a perfectly ordered terminal spine wrapped around a lie. The old anchors
were `providers.ts:1883` (`let stop: StopReason = 'end_turn'`), `providers.ts:1894-1917`
(`catch { return; }` swallowing unparseable frames), `engine.ts:4092-4101`
(`outcome: errorEventSent … ? 'error' : 'completed'`) and `engine.ts:1922-1928`
(`'Nothing was changed on disk in this run.'`).

**After the v11.26 fix (final verified run, 217 ms, 7 bounded attempts):**

```
    70ms  sys_notice/slow_provider  custom is slow or stalled — retrying briefly …
   216ms  error        Network error — check connection/proxy. (provider: custom)
   216ms  message_end
   216ms  task_report  Network error — check connection/proxy. (provider: custom) Nothing was changed on disk in this run.
   216ms  turn_end
```

Now `outcome:'error'`, one error event, one report, `turn_end` last — honest. The new
`StreamDroppedError` / `ctx.terminal` machinery in `providers.ts` (grep `StreamDroppedError`,
`ctx.terminal`, `semanticError`) closes the hole. **Verified fixed — S2 is green.**

---

## 4. Hours-long simulation / محاكاة العمل لساعات

Driven under the real engine with **scaled clocks** (loopback mock, tiny tools):

| Evidence | Value (final verified run) |
|---|---|
| Provider requests | **241** (240 tool turns + the abort request) |
| `tool_start` / `tool_result` | **240 / 240** — every round reported, all `ok:true` |
| Wall time | **7,736 ms** for 240 rounds |
| Step budget crossed | **twice** — `[auto-continue · round 1]` at 3,372 ms, `[auto-continue · round 2]` at 7,708 ms |
| Other notices | `[stagnation guard]` strategy-change notices (run kept going — not a cap) |
| Ending | user abort at 7,734 ms → `aborted` → `task_report: "Run aborted. Work stopped mid-task — 1 file(s) changed."` → `turn_end` |
| `stopReason` / `maxedOut` | neither `time_cap` nor `max_tokens`; `maxedOut` not the end cause |

**Verdict:** the engine did **not** stop at the default 120-step budget; it auto-continued
twice and kept executing until the user stopped it. No artificial cap ended the run, and
the written report honestly says the work was stopped mid-task. This is the founder's
"مهام طويلة جدا لساعات ... حتى أوقفه أنا" contract, proven at 240 rounds.

---

## 5. Blunt verdict / الحكم الصريح

**EN —** Not fully green — **8 of 9**. The big things are proven: the hours-long run executed
**240 tool rounds**, crossed the 120-step budget twice via visible auto-continue, and ended
**only** when the user stopped it; garbage SSE, tool exceptions, mid-thinking aborts,
post-processing throws, 402 and 429 all terminate honestly with one written report, one
last `turn_end`, cleared `running`, no duplicate error rows, every tool call reported, bounded
overhead and no raw JSON.

But the founder's first demand — *"لا ينقطع الذكاء الاصطناعي أبداً"* — still has one hole:
when the v11.26 provider layer resumes a mid-answer stream drop, the notice it creates is
**thrown away** because the engine never wires `onNotice` into `streamTurn`. The recovery
itself works; the **silence around it does not**. That is a real I1 (silent-stop-class)
defect with an exact one-line integration fix (§3.1). The suite stays red until it is fixed.

**AR —** لم يكتمل النجاح — **٨ من ٩**. الأشياء الكبرى أُثبتت: المهمة الطويلة نفّذت **٢٤٠ دورة
أداة**، وتجاوزت حد ١٢٠ خطوة مرتين عبر متابعة تلقائية مرئية، ولم تنتهِ إلا بإيقاف المستخدم؛
والـ SSE التالف، واستثناءات الأدوات، والإلغاء أثناء التفكير، وانهيار المعالجة اللاحقة، و402،
و429 كلها انتهت بصدق مع تقرير كتابي واحد، و`turn_end` أخيراً، و`running` مُفرَّغ، ولا صفوف
أخطاء مكررة، وكل استدعاءات الأدوات مُبلَّغ عنها، وزمن محدود، ولا JSON خام.

لكن الطلب الأول للمؤسس — *«تأكد لا ينقطع الذكاء الاصطناعي أبداً»* — ما زال فيه ثقب واحد: عندما
تستأنف طبقة المزوّد في v11.26 انقطاع البث في منتصف الإجابة، فإن الإشعار الذي تُنشئه **يُرمى**
لأن المحرك لا يوصل `onNotice` بـ `streamTurn`. الاستعادة نفسها تعمل؛ لكن **الصمت حولها لا يعمل**.
هذا عيب حقيقي من درجة I1 وإصلاحه سطر واحد (§3.1). الاختبار سيبقى أحمر حتى يُصلَح.

---

## 6. Scope honesty / حدود الحكم

This harness tests the **engine ↔ store contract with a local mock provider**. It does not
exercise real provider endpoints, the Electron IPC bridge, or the renderer UI. The verdict is
therefore "the engine contract is healthy except for the silent mid-answer recovery notice";
it is **not** a claim that every user-visible path of the desktop app is covered. The
injected post-processing fault is an IO-boundary one-shot failure on `message_end` — the
closest external simulation of a post-stream throw available without editing app source.

Line numbers in this report are from the final verified run; A1/A2/A3 were editing the same
files during the test window, so search by the quoted expressions if they have drifted. No
source was modified by this agent. Two files were created: this report and the test harness.

---

## 7. How to read a future run / كيف تقرأ التشغيل القادم

- `[V1126] Sxx …: PASS (0 failures)` → case clean.
- `[V1126 FAIL] Sxx … :: [I#] <check> :: <detail> :: @<file>:<line>` → real, reproducible defect.
- `I1` = silent stop / dishonest report / no terminal event / **invisible recovery**;
  `I2` = raw JSON or overhead stall; `I3` = duplicate row / dishonest tool reporting.
- The final `TOTAL FAILURES: n` block is authoritative — nothing is suppressed. A red line
  must be triaged by the owning agent; **do not mark the suite green by weakening an assertion**.
- When the `onNotice` wiring lands, re-run: S1 should flip to PASS and the suite should be
  fully green without any test edit.
