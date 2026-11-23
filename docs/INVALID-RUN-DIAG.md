# `Invalid run parameters (missing messages or model)` — Diagnosis
# تشخيص خطأ «معاملات تشغيل غير صالحة (رسائل أو نموذج مفقود)»

**Mode / النمط:** diagnosis-only (read-only). No production file was edited by this subagent.
Only this report was written.

**Time / الوقت:** 2026-11-20 ~08:25. **IMPORTANT — concurrent edits:** while this
diagnosis ran, other agents were actively patching the tree. Observed mtimes:
`src/store.ts` 08:23:49, `shared/types.ts` 08:23:31, `electron/agent/register.ts`
08:24:43. Early reads showed pre-patch line numbers (the task's facts:
`register.ts:263`, `store.ts:3199`); the current tree has the **v11.22 RUN-PARAM
REPAIR** already applied (`register.ts:479-522`, `store.ts:3313`). Both states are
cited below. Line numbers are from the current tree unless marked *pre-fix*.

---

## 0. Executive verdict / الخلاصة

1. **The exact message can only come from one place in this source tree:** the
   `kdx:agent:run` IPC handler. Pre-fix that was `electron/agent/register.ts:262-263`;
   today the handler is `electron/agent/register.ts:479-522`. Nothing else in
   `electron/`, `src/` or `tests/` contains that string (verified by grep; the only
   other hit is the compiled copy `dist-electron/electron/main.js:66262`).
2. **There is exactly one renderer caller of that IPC channel:** the single
   `api.agentRun({...})` call in `src/store.ts` (*pre-fix* `:3199`, current
   **`:3313-3324`**). Every chat / slash / flows / review / steer / compact / init
   path funnels through that one builder via `get().runAgent(...)`.
3. **The four other `engine.runAgent` callers never touch this guard** — they call
   the engine function directly and bypass `register.ts`: `cli.ts:308`,
   `apiServerService.ts:858`, `scheduleService.ts:565`, `register.ts:627`.
   They therefore cannot print this message. (Headless additionally refuses a bad
   model at `scheduleService.ts:470-482`.)
4. **Most likely root cause (rank 1): a half-written `settings.model` object —
   `{ provider, /* no model id */ }`, `model:''`, or `model:null` — reached the
   bridge.** This is stated explicitly in the code that fixed it
   (`src/store.ts:3204-3208`). The guard only checks `!params.model?.model`, which
   is exactly what such an object trips.
5. The error was surfaced **twice, raw English, no toast, no translation** —
   as a `model:'error'` transcript row and as a `task_report` card. Honest but
   unhelpful and not localized. See §4.

---

## 1. Complete caller map / خريطة كل المسارات

### 1.1 The IPC channel itself (`kdx:agent:run`)
| Where | Current line | Note |
|---|---|---|
| Declared/bridged | `electron/preload.ts:84` | `agentRun: (params: unknown) => invoke('kdx:agent:run', params)`; unchanged, plain `ipcRenderer.invoke` (`preload.ts:9-16`) |
| Typed | `src/lib/api.ts:364` | `agentRun(params: AgentRunParams): Promise<void>` |
| Handler | `electron/agent/register.ts:479-522` | pre-fix `:260-277`, with the strict guard at `:262-263` |
| Engine call from handler | `electron/agent/register.ts:627` | `runAgent(params, runIo)` |

Grep for the literal `kdx:agent:run` in `electron/` and `src/` returns only
`preload.ts:84`, `register.ts:258/479`, and the comment in `electron/agent/FILE-MAP.md:18`.
**No other module sends this channel.**

### 1.2 Renderer callers of the channel
Grep for `.agentRun(` in `src/` returns **one** match: `src/store.ts:3313`
(pre-fix `:3199`). It is reached from exactly three store actions:

| Trigger | Current line | Origin |
|---|---|---|
| `runAgent('init')` | `src/store.ts:2998` | slash `/init`; also `WorkspacePanel.tsx:499`, `CommandPalette.tsx:358` via `sendMessage('/init')` |
| `runAgent('chat')` | `src/store.ts:3148` | `sendMessage` after appending the user row (append at `:3116`; pre-fix `:3085`, call `:3095`) |
| `runAgent('compact')` | `src/store.ts:3194` | `compact()`; also `ChatPanel.tsx:1882`, `ContextLens.tsx:395`, `CommandPalette.tsx:366` |

Everything else that can start a run **re-enters `sendMessage`**, therefore the
same builder: flows replay `FlowsPanel.tsx:400`; review `WorkspacePanel.tsx:506`
and `store.ts:4919`; continuation/steer/queue `store.ts:2583`, `store.ts:4306`;
slash templates `store.ts:2782`; composer `Composer.tsx:781/797/1209`;
`ChatPanel.tsx:87/1433`; `MessageView.tsx:1957`.

### 1.3 Direct `engine.runAgent` callers (bypass the IPC guard entirely)
| Caller | Line | Shape check |
|---|---|---|
| CLI | `electron/agent/cli.ts:308-327` | builds full params: `messages:[...]`, `model:{provider,model}` at `:321` |
| Local API server / remote bridge | `electron/services/apiServerService.ts:838-864` | `messages:[userMsg]`, `model: s.model` from `getSettings()` (`:753`, `:842`) |
| Scheduled / headless | `electron/services/scheduleService.ts:497-565` | `messages:[userMsg]`, `model` validated at `:470-482` → returns `'no model configured'`, never calls runAgent with a bad model |
| IPC handler | `electron/agent/register.ts:627` | the only one that had the strict guard |

Engine entry itself: `electron/agent/engine.ts:1396`; its **only** validation is
`if (!params || !io) return;` at `engine.ts:1400` — it does **not** check
`messages` or `model`. So a bad model from a direct caller fails later inside the
engine, not with this message.

**Subagents:** `electron/agent/subagentRunner.ts` / `subagents.ts` contain no
`runAgent` call (grep confirmed); they read settings via `storeService` at
`subagentRunner.ts:52-53` and are driven from inside the engine. No IPC path.

---

## 2. Guard anatomy / تشريح الشرط

Pre-fix (`register.ts:262-263`, per the report):
```ts
if (!params || !Array.isArray(params.messages) || !params.model?.model) {
  send({ type: 'error', message: 'Invalid run parameters (missing messages or model).' });
```
Three ways to fail: no params, `messages` not an array, or `model.model` falsy.

Current (`register.ts:479-522`) replaces the rejection with `normalizeRunParams`
(`register.ts:222-296`), which repairs:
- `raw === null/undefined` → precise reason (`:227-232`)
- non-object raw → precise reason (`:233-238`)
- model object / `"provider/model"` string / settings default (`:177-219`, `:241-248`)
- `text` / `prompt` / `message` instead of `messages` (`:255-261`)
- last real user message from the session store (`:263-275`, helper `:144-156`)
- synthesized honest user row for compact/init (store side: `store.ts:3299-3311`)

---

## 3. Root causes, ranked / الأسباب مرتبةً بالاحتمال

### #1 — Half-written `settings.model` reaches the bridge (HIGHEST, proven by fix comment)
**Evidence**
- `src/store.ts:3204-3208` (current, in-code fix rationale): *"A half-written
  `settings.model` (`{ provider }` with no `model` id) was sent to the bridge as
  'Invalid run parameters (missing messages or model)'."*
- The renderer hydrate is a **shallow** merge with no model normalization:
  `src/store.ts:1951` `const loaded = { ...DEFAULT_SETTINGS, ...(settings || {}) };`
  (only `theme` is migrated, `:1953`). A persisted `model:{provider:'x',model:''}`
  overwrites the valid default at `store.ts:1018`.
- `updateSettings` is also shallow for `model`: `src/store.ts:2119-2125`
  (`{...prev, ...patch}`; only `providers` gets an entry-level merge at `:2126-2140`).
  Any patch that writes `model:{provider, model: undefined|''}` poisons the store.
- Main-process `getSettings()` merges model defensively but **spread includes
  `undefined`/`''`**: `electron/services/storeService.ts:204-208`
  `model: { ...DEFAULT_SETTINGS.model, ...((migrated.model as object) ?? {}) }`.
  `saveSettings` writes it back verbatim at `storeService.ts:264-277`.
- Profile import accepts arbitrary settings and calls `saveSettings(p.settings)`
  at `electron/services/profileService.ts:106`, `:130` with no model validation.
- `resolveRunModel` (`src/store.ts:1209-1235`) and `isValidModelConfig`
  (`src/store.ts:1198-1207`) now exist specifically to reject this shape, and
  `runAgent` calls it at `src/store.ts:3209` before any visible state change.

**Why it trips the old guard:** `!params.model?.model` is true for `''`, `null`,
`undefined`, or a missing key. `provider` can still be valid, so the earlier
checks at old `store.ts:3152-3154` did not bail out first — the bad value flowed
straight to `api.agentRun`.

**Minimal fix:** validate/normalize `model` at the renderer boundary **and** at
the IPC boundary; fall back to a valid configured model instead of rejecting.
Already implemented at `src/store.ts:1209-1235`, `:3209`, `:3277` and
`electron/agent/register.ts:177-219`, `:242-248`. Additionally, deep-merge
`model` in `getSettings()` (`storeService.ts:207`) and in `init()`
(`store.ts:1951`) so an explicit empty id cannot override the default.

### #2 — Partial payload from a non-canonical caller (`text`/`prompt`, string model, or no params)
**Evidence:** `electron/agent/register.ts:92-99` — *"Real callers (phone bridge,
flows, local API server, legacy bundles) legitimately send partial payloads: a
`text`/`prompt` instead of `messages`, a model as the string `"provider/model"`,
or nothing at all."* Repair branches: `register.ts:227-238` (no params / non-object),
`:255-261` (`text`/`prompt`/`message`).

**Honest caveat:** I could **not** find an in-repo source caller that sends such a
payload to `kdx:agent:run`. The in-repo phone/API-server/flows/schedule paths call
`engine.runAgent` directly (§1.3) and are well-formed. So this is a plausible
**deployment/legacy-bundle** explanation, not a reproducible one from this tree.
Do not claim it as proven.

**Minimal fix:** keep the boundary repair (`register.ts:222-296`) and add a test
for each branch — **there is currently no test** (grep for `normalizeRunParams`
in `tests/` → no matches).

### #3 — `params.model` as a string (`"provider/model"`) — hypothesis (f)
**Evidence:** `normalizeModel` handles `typeof raw === 'string'` at
`electron/agent/register.ts:184-192`; the old guard's `params.model?.model` is
`undefined` for a string (strings have no `.model`), so it rejected it.
In-repo, `s.settings.model` is always an object (`setModel` at `src/store.ts:4578`,
`updateSettings({model:{...}})` spreads), so this
is only reachable from an external/legacy sender — same caveat as #2.

**Minimal fix:** already present at `register.ts:177-219`.

### #4 — "Empty messages after the filter" — hypothesis (e): real bug, WRONG diagnosis for this message
**Finding:** an empty array **passes** `Array.isArray(params.messages)`. It cannot
produce this guard message. It is nevertheless a genuine bug that the v11.22
patch fixes at `src/store.ts:3281-3312` (filter `:3282`, last-real-user recovery
`:3284-3298`, synthetic compact/init row `:3299-3311`) and at
`register.ts:255-283` (no user message → precise reason).

**Minimal fix:** keep `store.ts:3284-3312`. Rank low *for this specific message*.

### #5 — "Stale `s` snapshot after async gaps" — hypothesis (a): NOT a real cause here
**Finding — be brutally honest:** in the pre-fix `runAgent`
(`const s = get()` at old `:3146`), there was **no `await`** between that capture
and `await api.agentRun({...})` at old `:3199`. The intervening statements
(`updateSettings` old `:3171`, `set({running:true})` old `:3178`,
`resetProofForTurn()` old `:3191`, `writeResumeMarker` old `:3192`,
`startRunWatchdog()` old `:3197`) are all synchronous and none mutate
`settings.model` or `session.messages`. JS is single-threaded, so no concurrent
model switch could land in that gap. The v11.22 rationale at
`src/store.ts:3263-3267` ("every set() … leaves it stale") is **defensive
hardening, not a demonstrated cause of this error**. Keep the fresh read
(`store.ts:3268-3277`) — it is harmless and more robust — but do not list it as
the founder's root cause without a repro.

### #6 — structured clone dropping fields — hypothesis (d): RULED OUT
`electron/preload.ts:9-16` uses plain `ipcRenderer.invoke` (Electron structured
clone). A non-cloneable value (e.g. a `File`/function in a message) **throws**
`DataCloneError` in the renderer; it is caught by `runAgent`'s catch
(`src/store.ts:3325+`, pre-fix `:3215`) and shown as a notification. It does not
silently delete `model` or `messages`, so it cannot manufacture this guard failure.

### #7 — headless/subagent caller omitting fields — hypothesis (c): RULED OUT for this message
Direct callers bypass the guard (§1.3). `scheduleService.ts:470-482` refuses a
bad model with `'no model configured'`; `cli.ts:308-327` and
`apiServerService.ts:838-847` build complete params; no subagent calls
`engine.runAgent`. They can fail differently, but not with this text.

---

## 4. Honesty of the message itself / أمانة الرسالة

**Pre-fix render path:**
1. `register.ts:263` sent `{type:'error', message:'Invalid run parameters (missing messages or model).'}`.
   Renderer `case 'error'` at `src/store.ts:4082-4106` pushes an **assistant row**
   with `model:'error'` and `content: e.message` (`:4091-4098`). It is **not a
   toast** — `noCreditsToast` (`src/store.ts:173-178`) only matches
   `Insufficient credits|no_credits|402`, which this text does not.
2. `register.ts:266-275` also sent a `task_report` with `outcome:'error'` and
   summary *"Run not started — invalid parameters (missing messages or model)."*
   Renderer `case 'task_report'` at `src/store.ts:3819+` creates a **second**
   `model:'task-report'` row plus `lastTaskReport` (status card).
3. `turn_end` follows. `running` is cleared by the `error` case (`:4105`).

**Verdict:** the user saw the **same raw English sentence twice** (error row +
report card), with **no translation in Arabic mode** and **no actionable
toast**. It says *what* failed but not *which field* or *how to fix it*, and it
blames the user for what is usually a corrupted settings object. That is
unhelpful even though it is not factually false — the previous turn's user
message was silently dropped.

**Current state:** `register.ts:503-520` emits precise, single-language reasons
(`'no run parameters were supplied.'` `:229`, `'run parameters must be an object'`
`:235`, `'no AI model is configured.'` `:245`, `'there is no user message to
send.'` `:280`) plus a concrete `nextStep` (`:230/236/246/281`) and the same
`task_report`+`turn_end` closure. Better, but **still English-only** and still
**not a toast**; `store.ts:4089-4101` will still push the raw reason as a
`model:'error'` row. Recommended: translate in `ingestAgentEvent` via the
existing `tt`/`slashT` pattern (`store.ts:173-178` shows the intended design) and
use a single bilingual toast for the "no model / no message" cases, with the
transcript row carrying only the short localized summary.

---

## 5. Ownership / المسؤولية

- **A6 — renderer / UI:** `src/store.ts` (model resolution `:1209-1235`, `:3209`,
  `:3268-3312`; error rendering `:4082-4106`), `src/components/settings/ModelsSection.tsx`
  (model writes `:58`, `:377`, `:456`), `src/components/ModelPicker.tsx`
  (`A6` tag at `:219`; `:224-230`), `src/lib/api.ts:364`.
  Evidence for the A6 label: `src/store.ts:3204` *"v11.22 (A6)"*,
  `ModelPicker.tsx:219` *"A6 — live OpenRouter catalog"*.
- **A7 — main process / engine + bridge:** `electron/agent/register.ts`
  (`normalizeRunParams` `:222-296`, handler `:479-522`), `electron/agent/engine.ts`
  (`:1396-1400`), `electron/services/storeService.ts` (`getSettings` `:197-221`,
  `saveSettings` `:231-279`). Evidence: `docs/SIMPLE-TURN-CLEAN-REPORT.md:86`
  labels `electron/agent/engine.ts` as **(A7)**.

Shared contract owner: `shared/types.ts:613-628` (`AgentRunParams`),
`shared/types.ts:48-55` (`ModelConfig`). No change needed there — the types were
already correct; the bug was a runtime value, not a type.

---

## 6. What I could NOT prove / ما لم أستطع إثباته

- No repro script in `tests/` produces this message through `kdx:agent:run`
  (`grep 'Invalid run parameters' tests/` → none; `agent:run` → none).
- No in-repo caller sends a string model / `text`-only payload to the IPC
  channel; #2/#3 rely on the repair function's own comment about external callers.
- I did not run the app or a test suite (diagnosis-only). All conclusions are
  static evidence from file:line, listed above.
- Because other agents edited `store.ts` and `register.ts` during this run, a
  line number may drift by a few lines. The function names and quoted strings are
  the stable anchors.
