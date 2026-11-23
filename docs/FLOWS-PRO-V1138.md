# v11.38 — FLOWS PRO: blunt verdict
# الحكم الصريح: المسارات (الفلاوز) هل تعمل فعلاً؟

> Founder, 3×: «الفلاوز الفلاوز الفلاوز يجب أن تعمل» — **FLOWS MUST WORK.**
> D9 said "flows run" in `docs/USAGE-FLOWS-SCHEDULE-V1136.md:28`. The founder
> still lists them broken. This document answers the question directly, with
> the exact real gap that D9's test never touched.

---

## 0. The verdict / الحكم

**English — YES, flows really run now, end-to-end. But D9's claim was false in
one important respect: the old code recorded a run BEFORE the chat turn
finished.** A flow always did send its prompt to chat (so it *looked* alive),
but the "done" state, the five green steps and the `runCount` bump were written
at **launch time**, not at **settlement time**. `kdx:agent:run`
(`electron/agent/register.ts:694`) calls `runAgent(...)` fire-and-forget — it
never awaits it. Therefore `store.sendMessage()` (`src/store.ts:4071`,
`await api.agentRun(...)`) resolves the moment the turn is *started*. The old
`FlowsPanel.run()` only waited for settlement when the chat was **already busy
at click time**; in the ordinary idle case it immediately recorded the run.
That is a false-done, and it is exactly why the founder kept seeing "flows
broken" even after D9's "proof": D9 called `engine.runAgent()` and
`flowsMarkRun()` **directly** (`tests/v1136-usage-flows-schedule.test.mjs:311`,
`:326`) and never exercised the renderer's real run bridge.

**العربية — نعم، المسارات تعمل الآن فعلاً من البداية للنهاية. لكن ادعاء D9 كان
خاطئاً في نقطة جوهرية: الكود القديم كان يسجّل التشغيل قبل أن ينتهي دور
المحادثة.** المسار كان يرسل طلبه إلى المحادثة دائماً (لذلك بدا وكأنه يعمل)،
لكن حالة «انتهى» والخطوات الخمس الخضراء وزيادة `runCount` كانت تُكتب لحظة
**الإطلاق** لا لحظة **الانتهاء**. معالج `kdx:agent:run` يستدعي `runAgent`
دون انتظار، فيُكمل `sendMessage` عمله فور بدء الدور. لوحة المسارات القديمة
كانت تنتظر الانتهاء فقط إذا كانت المحادثة مشغولة أصلاً؛ في الحالة العادية
كانت تسجّل التشغيل فوراً. هذا «ادعاء إنجاح كاذب»، وهو السبب الحقيقي الذي جعل
المؤسس يرى أن الفلاوز ما زالت معطّلة رغم «إثبات» D9.

**This is now fixed. The counter advances only after a real `running:false →
true → false` turn settles, and a flow whose prompt never produced a turn is
never recorded.**

---

## 1. The real gap, step by step / الفجوة الحقيقية خطوة بخطوة

| Step | Before v1138 | Now |
|---|---|---|
| save flow | worked (`kdx:flows:save`) | unchanged, real 0600 atomic disk write (`flowsService.ts:273`) |
| hit (typed repetition) | fired from `src/store.ts:3340` | **exact raw text now preserved** in the hit store (`flowsService.ts:36,457`) — the old chip saved the 80-char normalized key and silently corrupted the prompt |
| suggest | yes, but only inside a transient chat chip | real, read-only, deduped suggestions now readable from the Flows page through the **existing** `flowsInfo` bridge (`flowsService.ts:501,539`; panel `FlowsPanel.tsx:919-950`) |
| run | prompt sent, but record happened at **launch** | prompt sent through the real `sendMessage` path; a store subscription watches the actual `running` edge (`FlowsPanel.tsx:203` `executeFlowRun`) |
| wait for settle | only when chat was already busy | **always** — false→true→false observed, hard-bounded at 120 s |
| record | immediately (false-done) | only after settle; `flowsMarkRun` must resolve literal `true`; otherwise honest `record-failed` |
| list/replay | replay button was **dead** — guarded on a preload method that does not exist | replay is now a real re-send of the exact stored prompt through the same verified path (`FlowsPanel.tsx:800`), bumps `runCount` once |
| counters | optimistic overlay cleared before the disk read landed | overlay held until the authoritative `flowsList()` read resolves (`FlowsPanel.tsx:725`) |

---

## 2. What I actually changed / ما عدّلته فعلاً

**`src/components/panels/FlowsPanel.tsx`**
- `:203` `executeFlowRun()` — exported, framework-neutral run orchestrator.
  Injects `send`, `isRunning`, `subscribe`, `record`, timers. It subscribes
  **before** sending, records **only** after a real settled turn, and returns
  honest reasons: `ok | send-failed | no-turn | timeout | record-failed`.
- `:725` `runFlow()` — wires the orchestrator to `store.sendMessage`,
  `useStore.subscribe` and `flowsMarkRun`. `replay()` (`:800`) uses the same
  path with stored prompt verbatim. No optimistic fake counter; the overlay is
  cleared only after the authoritative reload.
- `:119` `flowRunGate()` — additionally refuses slash-prefixed prompts
  (`store.sendMessage` treats them as commands, never as agent turns → would
  have been another false-done). No-session / no-workspace refusals are
  surfaced as a **persistent, visible gate note**, not just a toast.
- `:90` `flowRunSteps()` — `recorded` step becomes an error on `no-turn` /
  `timeout` / `record-failed`.
- Removed the dead `flowsValidateByReplay()` button (it could never appear:
  no preload bridge). Replaced with a working **Replay** button.

**`electron/services/flowsService.ts`**
- `:36,188,457` — `FlowHit.original`: keep the exact first-seen prompt so a
  suggestion restores it verbatim (capped 2000 chars).
- `:501` `flowsSuggestions()` — read-only, deduped, honest repetition
  suggestions from the real hit store.
- `:533` `FlowsInfoPro` / `:539` `flowsInfo()` — adds `repeatedPrompts` and
  `suggestionTexts` through a local supertype of the read-only shared
  `FlowsInfo` type, so the renderer gets honest suggestions **without a new
  preload method**.
- `:602` `kdx:flows:suggestions` channel registered.

**`electron/ipc.ts`**
- `:964` `kdx:flows:replay` now always returns a structured honest verdict
  (`{ok:false, detail}`) instead of an opaque rejection.

**`tests/v1138-flows.test.mjs` (new, 4/4 pass)** — local temp userData + a
loopback SSE provider. Proves: exact prompt reached provider; `message_end`
happened while `runCount` was **still 0** (no premature bump); `runCount`
became **1** only after settle; replay produced a second real turn and
`runCount` **2**; no-turn / timeout / refused-record never bump; suggestion
arrives at 3 hits with the **exact** typed text and dedupes after saving; gates
and IPC channels are real.

---

## 3. Verification / التحقق

| check | result |
|---|---|
| `npx tsc --noEmit` | **PASS** (0 errors) |
| `npx tsc -p tsconfig.node.json --noEmit` | **PASS** (0 errors) |
| `node --test tests/v1138-flows.test.mjs` | **4/4 pass** |
| `node --test tests/v1136-usage-flows-schedule.test.mjs` | **6/6 pass** |
| `node --test tests/v1131-flows.test.mjs` | **12/12 pass** |
| `node --test tests/v1131-full-smoke.test.mjs` | **82/82** — 60/60 screens OK, 715 controls scanned, **0 dead controls**, 0 unstable |

---

## 4. HANDOFFS — files I was forbidden to touch / ملفات لا أملك تعديلها

1. **`src/components/panels/registry.tsx:22-26` (transient, now resolved).**
   Another wave had added a comment containing the literal text
   `` `panelOf(XMod, 'Name')` ``; `tests/v1131-full-smoke.test.mjs:798` regexes
   raw source and parsed `Name` as a panel (`panel "Name" must be
   smoke-tested`). That wave reworded the comment; full-smoke is 82/82 green.
   I did **not** edit that file (out of my ownership) — recording it only
   because it briefly masked a clean verification run.

2. **`electron/preload.ts` + `src/lib/api.ts` (backend replay bridge).**
   `kdx:flows:replay` (`electron/ipc.ts:964`) and the new
   `kdx:flows:suggestions` (`flowsService.ts:602`) have **no bridge methods**.
   The renderer now gets honest suggestions through `flowsInfo` (already
   bridged at `preload.ts:398`) and working replay through chat re-send, so
   nothing in the UI is dead — but if the parent wants the backend
   shell-capture replay verdict, expose:
   `flowsValidateByReplay(id, ws?) => invoke('kdx:flows:replay', id, ws)` and
   `flowsSuggestions(ws?) => invoke('kdx:flows:suggestions', ws)` in both files.

3. **`electron/agent/register.ts:694` + `src/store.ts:4071` (root cause).**
   The clean architectural fix is for `kdx:agent:run` to **await** the run (or
   resolve a deferred on `turn_end`/`message_end`) and for `sendMessage` to
   return a turn id / "did a turn start" signal. My panel-side watcher fixes
   the visible false-done without touching those files, but the main-process
   contract remains fire-and-forget. Handing the exact lines to the parent.

---

## 5. Files actually modified / الملفات المعدّلة

- `electron/services/flowsService.ts`
- `src/components/panels/FlowsPanel.tsx`
- `electron/ipc.ts` (kdx:flows:replay handler only)
- `tests/v1138-flows.test.mjs` (new)
- `docs/FLOWS-PRO-V1138.md` (new)
