# OpenCode "Session within a Session" — Reverse Engineering & SADEEM Drill Guard
# هندسة عكسية لميزة "جلسة داخل جلسة" في أوبن كود + فحص التنقّل لسادة

- Version / الإصدار: v11.35 (verifier + reverse-engineer, diagnosis/test/doc only)
- Date / التاريخ: 2026-11-21
- Scope / النطاق: read-only comparison + static guard. **No app source was changed by this task.**
- Guard / الفاحص: `node tests-v1135-agent-drill-guard.mjs`

---

## 0. Blunt verdict / الحكم الصريح

**EN:** **NO — you still cannot drill into an agent's real session like OpenCode.** What SADEEM
opens today is a *ledger detail modal* (`SubagentDetailModal.tsx`) fed by a *counter timeline*
(`subagentSteps`), not a child session with its own message list, tool-call parts and lineage.
The card is no longer dead (a real `onClick` exists) and the chrome is polished, but the thing
you land on is a summary, not a session.

**AR:** **لا — لا يمكنك بعد التنقّل إلى الجلسة الحقيقية للوكيل كما في أوبن كود.** ما تفتحه سادة
اليوم هو *نافذة تفاصيل في سجل الوكلاء* (`SubagentDetailModal.tsx`) تغذّيها خط زمني من عدّادات
(`subagentSteps`)، وليس جلسة فرعية لها سجل رسائل وأجزاء استدعاء أدوات وسلسلة سلف/خلف. البطاقة
لم تعد ميتة (يوجد `onClick` حقيقي) والواجهة مصقولة، لكن ما تصل إليه هو ملخّص لا جلسة.

Severity / الخطورة: **PARTIAL / جزئي** — cosmetic + interaction gates PASS; the core
"per-tool-call transcript" gate FAILS (see `C2-TOOL-CALLS`).

---

## 1. Real sources used / المصادر الحقيقية المستخدمة

All facts below come from official documentation or first-party source. No feature is invented.

| # | Source (real URL) | What it establishes |
|---|-------------------|---------------------|
| 1 | https://opencode.ai/docs/agents/ | Subagents run in **their own child sessions** with fresh context; modes `primary`/`subagent`/`all`; the `subagent` tool; parent receives a report each time a child goes idle. |
| 2 | https://opencode.ai/docs/tui/ | TUI sessions, `/sessions`, tabs, leader key `Ctrl+X` — the shell around session navigation. |
| 3 | https://github.com/sst/opencode (now redirects to `anomalyco/opencode`) | First-party monorepo — canonical source of the schemas below. |
| 4 | https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/schema/src/session.ts | `Session.Info` schema incl. `parentID`, `fork`, `time`, `cost`, `tokens`. |
| 5 | https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/core/src/tool/plugin/subagent.ts | The `subagent` tool: creates a child session with `parentID: context.sessionID`, returns `sessionID`, follow-ups validated against parent. |
| 6 | https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/schema/src/session-message.ts | Message union: `user`, `assistant`, `tool`, `system`, `shell`, `compaction`, `idle`; `AssistantTool` state + time; stored/replayed. |
| 7 | https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/tui/src/routes/session/composer/subagents-tab.tsx | TUI "Subagents" tab: `composer.subagent.select` → `navigate({ type: "session", sessionID: entry.sessionID })`. |
| 8 | https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/tui/test/session-subagent-navigation.test.tsx | A child session (`parentID: "ses_parent"`) opened by `sessionID`, its own message list, Home/End transcript navigation. |
| 9 | https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/app/e2e/regression/subagent-child-navigation.spec.ts | Web/UI child drill: task card is an `<a href="/session/:childID">`, parent breadcrumb, Escape returns to parent, nested ancestors, RTL-safe. |
| 10 | https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/tui/src/ui/session-link.ts | Session IDs in prose render as links and `route.navigate({ type: "session", sessionID })` on click. |
| 11 | https://raw.githubusercontent.com/anomalyco/opencode/dev/specs/v2/session.md | Event-sourced durable session: `sessions.log({sessionID, after?, follow?})`, replay, tool calls carry `assistantMessageID`. |

---

## 2. How OpenCode represents a "session within a session" / كيف يمثل أوبن كود الجلسة داخل الجلسة

### 2.1 Parent / child IDs

`Session.Info` (source 4) is the first-class session shape. It carries a **nullable parent link**:

```ts
export const Info = Schema.Struct({
  id: ID,
  parentID: ID.pipe(optional),          // <— the "session within a session" edge
  fork: Schema.Struct({ sessionID, boundary }).pipe(optional),
  projectID: Project.ID,
  agent: Agent.ID.pipe(optional),
  model: Model.Ref.pipe(optional),
  cost: Money.USD,
  tokens: TokenUsage.Info,
  time: Schema.Struct({ created, updated, busy?, idle?, viewed?, archived? }),
  title: Schema.String.pipe(optional),
  ...
})
```

`ListFilter` even exposes `parentID` as a query parameter, with the literal string `"null"`
meaning "only root sessions" — proof that parent/child is a durable, queryable relation, not a UI
decoration.

The `subagent` tool (source 5) materialises the edge:

```ts
const child = existing ?? (yield* sessions.create({
  parentID: context.sessionID,   // parent = the session that called the tool
  title: input.description,
  agent: agent.id,
  model,
}));
```

- The call returns immediately with `{ sessionID: child.id, status: "running", output }`.
- A follow-up passes `sessionID`; OpenCode rejects it unless `existing.parentID === context.sessionID`
  (`"Session … is not a child of the current session"`).
- A recovery record keeps `{ kind: "subagent", parentSessionID, childSessionID, agent, description }`.

**EN takeaway:** a subagent *is* a normal session whose `parentID` points at its caller. There is no
separate "subagent" data shape for the conversation itself.
**AR:** الوكيل الفرعي *هو* جلسة عادية حقل `parentID` فيها يشير إلى الجلسة المستدعية؛ لا يوجد شكل
بيانات منفصل لمحادثة الوكيل الفرعي.

### 2.2 How messages are stored and replayed

`SessionMessage.Info` (source 6) is a tagged union. Each message has `id` (`msg_…`), `metadata?`
and `time.created`. Assistant messages hold an ordered content array:

```ts
AssistantTool = {
  type: "tool", id, name, state,
  state: streaming | running | completed | error,  // input / content / metadata
  time: { created, ran?, completed? }
}
Assistant = { type: "assistant", agent, model, content: AssistantContent[], ... time: {created, firstToken?, streamed?, completed?} }
```

So a real session replays **text + reasoning + tool calls**, each tool call with its `name`,
`input`, result `content`, error and timestamps. `specs/v2/session.md` (source 11) adds the
durability layer: `sessions.log({ sessionID, after?, follow? })` replays public durable events,
and "Tool calls belong to their assistant message … durable tool events also carry
`assistantMessageID`."

**EN:** replay is message-by-message and tool-call-by-tool-call, with time and attribution.
**AR:** إعادة العرض تتم رسالة برسالة واستدعاء أداة باستدعاء أداة، مع الوقت ونسبة الاستدعاء لرسالته.

### 2.3 How the TUI / UI lets you drill into a child session

- **TUI** (source 7): the *Subagents* composer tab lists the session family. `up`/`down` move,
  and `composer.subagent.select` runs `navigate({ type: "session", sessionID: entry.sessionID })`;
  a mouse click on a row navigates the same way. Source 8 opens a child directly by
  `args: { sessionID: session.id }` and verifies its own 20-message transcript (Home/End jump).
- **Web/UI** (source 9): the `subagent` task card is an anchor `a[href="/session/:childID"]`.
  Clicking it navigates to the full child session page. A breadcrumb
  `[data-slot="session-title-parent"]` shows the parent title; **Escape returns to the parent**;
  nested subagents render the full ancestor path; the drill is RTL-safe (the e2e test flips
  `document.documentElement.dir = "rtl"`). Source 10 makes `ses_…` IDs in agent prose clickable.

**EN:** drilling = real navigation to another session route, with a parent breadcrumb and a
full transcript — not an in-place modal summary.
**AR:** التنقّل = انتقال حقيقي إلى مسار جلسة آخر مع خبز سلف وسجل كامل، لا نافذة ملخّصة مكانية.

### 2.4 What a "session" really contains

| Contains | OpenCode session (`Session.Info` + messages) |
|----------|----------------------------------------------|
| Identity | `id`, `parentID`, `fork`, `title` |
| Messages | ordered `user`/`assistant`/`tool`/`system`/`shell`/`compaction`/`idle` |
| Tool calls | `AssistantTool` parts: `name`, `state` (streaming/running/completed/error), `input`, `content`, `time` |
| Time | per-session `created/updated/busy/idle/viewed/archived`; per-message `created/firstToken/streamed/completed`; per-tool `created/ran/completed` |
| Execution | `agent`, `model`, `cost`, `tokens`, `permissions`, `revert`, `outcome` |
| Location | `location`, `subpath`, `directory` |

---

## 3. Honest comparison — what SADEEM has vs what OpenCode has / مقارنة صادقة

All SADEEM lines are read-only observations of the current tree at verification time.

| Capability | OpenCode (real) | SADEEM (current tree) | Verdict |
|-----------|-----------------|-----------------------|---------|
| Parent/child session edge | `parentID` on `Session.Info` + `sessions.create({parentID})` (source 4,5) | `SubagentRecord.sessionId` exists at `shared/types.ts:295` but **no UI uses it for navigation** | MISSING |
| Child session as first-class session | child has own `/message` list (source 8) | no child session object; only a ledger row | MISSING |
| Real tool-call transcript | `AssistantTool{name,state,input,content,time}` (source 6) | modal timeline is generic `Step {n} of {total}` from `subagentSteps` — `SubagentDetailModal.tsx:105`, `:168` (explicit "never a per-agent tool-call transcript" note) | MISSING |
| Real delegated task text | `prompt` in subagent input | `record.prompt` rendered — `SubagentDetailModal.tsx:260` (description `:258`) | HAVE |
| Open detail from a chip | task card is a link (source 9) | real `onClick` → `openSubagentDetail(m.recordId)` — `AgentTeamCard.tsx:262` | HAVE |
| Keyboard activation | TUI key layer (source 7) | native `<button type="button">` — `AgentTeamCard.tsx:249-263` (Enter/Space) | HAVE |
| Parent breadcrumb / Escape back | `[data-slot="session-title-parent"]`, Escape (source 9) | labelled "back to team" button calls `close()` only (`SubagentDetailModal.tsx:184`); footer is id + Retry (`:300-313`). No parent-session navigation. | PARTIAL |
| Nested/ancestor lineage | full ancestor path (source 9) | none | MISSING |
| Time at each step | per-tool `created/ran/completed` (source 6) | per-step `at` from progress events — `SubagentDetailModal.tsx:31,105` | PARTIAL |
| Bilingual labels | n/a (TUI) | `t('key','English fallback')` throughout both components | HAVE |
| RTL logical properties | RTL-safe drill (source 9) | logical insets in `subagents.css:31-40,195-218` + `dir="auto"`/`dir="ltr"` in TSX | HAVE |
| Reduced motion | n/a | `@media (prefers-reduced-motion)` + `html.reduce-motion` — `subagents.css:473-500` | HAVE |
| Frame-free card | n/a | `.agt-card` border/radius/bg/shadow all off — `subagents.css:16-29` | HAVE |
| Retry / lifecycle | interrupt via job API | retry reuses store action — `SubagentDetailModal.tsx:149-163,261-272` | HAVE (different mechanism) |

**Parity is explicitly NOT claimed.** SADEEM's design is a presentation layer over an in-memory ledger;
OpenCode's is a durable, event-sourced session store. They are not the same subsystem.

---

## 4. Guard results on the current tree / نتيجة الفاحص على الشجرة الحالية

Run: `node tests-v1135-agent-drill-guard.mjs`. Per-check PASS/FAIL lines come from the script
stdout. Summary of what the gate enforces:

1. `C1-CLICK` / `C1-BUTTON` / `C1-A11Y` / `C1-LIVE-JOIN` — the agent node is a real, live,
   keyboard-operable `<button>` calling `openSubagentDetail` (`AgentTeamCard.tsx:262`).
2. `C2-REAL-TASK` — the modal shows the real prompt/description (`SubagentDetailModal.tsx:266-269`).
3. `C2-TOOL-CALLS` — **the honest failure point**: no tool name/input/state is rendered; the
   timeline is `Step n of total` (`SubagentDetailModal.tsx:110`, `:278-287`) and the source itself
   states "never a per-agent tool-call transcript" (`:177`).
4. `C2-NO-FABRICATION` — no fabricated assistant transcript is present.
5. `C3-*` — bilingual `t()` labels, logical CSS properties, reduced-motion guards, frame-free card.
6. `C4-*` — handoff field list below. `C5-BACK-CONTROL` / `C5-COUNTER-RAIL` — A5's v11.35 adds a
   labelled back control and a counter-only orbital rail.
7. The guard also prints **LIVE HANDOFF LINES** recomputed from the current tree each run, because
   A5 is actively editing and line numbers drift.

> If `C2-TOOL-CALLS` is the only red line, the guard's overall result is **FAIL** — which is the
> intended, honest outcome for "can you drill into an agent session like OpenCode now?" → **NO**.

---

## 5. Handoff — missing data fields with exact file:line / تسليم الحقول الناقصة

> Line numbers below are the verification snapshot; the guard prints current live lines on every run.

1. **Missing per-agent transcript — tool calls (primary blocker).** `SubagentRecord` at
   `shared/types.ts:282-300` has `done/total`, `startedAt/endedAt`, `summary`, `error` — but **no**
   `messages`, `toolCalls` or per-step parts field. The modal therefore can only render counter
   events (`SubagentDetailModal.tsx:110`, `:177`, `:278-287`). To reach OpenCode parity, emit a per-step
   `{ name, input, content, state, time }` from the engine and render it in the timeline
   (`SubagentDetailModal.tsx:278-287`).
2. **The cheapest real-data win is already half-wired: the per-step ACTION LABEL is dropped.**
   The engine emits a real short label on each progress event (`electron/agent/subagents.ts:61`,
   `step?: string`), the modal is ready to render it (`SubagentDetailModal.tsx:25`, `:114`:
   `"Step n of total · {s.step}"`, no fabrication), but it never arrives: the IPC union
   `subagent_progress` omits `step` at `shared/types.ts:432`, and the store accumulator drops it at
   `store.ts:4760`. Wire `step` through those two lines and the timeline immediately shows the real
   action instead of a bare counter. Guard: `C6-ENGINE-EMITS-STEP` / `C6-IPC-DROPS-STEP` /
   `C6-STORE-DROPS-STEP` / `C6-MODAL-READY`.
3. **Parent session link not used.** `SubagentRecord.sessionId` exists at `shared/types.ts:295`
   but the card opens `m.recordId` (`AgentTeamCard.tsx:262`). A5 added a labelled "back to team"
   button (`SubagentDetailModal.tsx:193`) but it only calls `close()`; the footer
   (`SubagentDetailModal.tsx:309-322`) is still id + Retry. There is no `openSubagentSession(sessionId)`
   / parent breadcrumb / session-route navigation. This is the single highest-leverage wiring change
   to make the drill feel like OpenCode.
4. **No nested lineage.** No `parentID` chain is stored or rendered anywhere in the subagent
   surfaces (contrast source 9). Needed only if nested subagents are in scope.
5. **Keyboard note (non-blocker).** The opener is a native `<button>` so Enter/Space work; there
   is no explicit `onKeyDown` handler (`AgentTeamCard.tsx:249-263`). If the requirement is a
   literal JS keydown handler, add one — but native button semantics already satisfy activation.
6. **Container note (non-blocker).** `.agt-card` itself is a `<div>` with no click handler
   (`AgentTeamCard.tsx:187`); only the agent nodes are clickable. This is intentional (the header
   and output toggle are independent controls), but it means "click the card" is not a gesture.

---

## 6. Closing statement / كلمة أخيرة

**EN:** The polish work is real and verified: live chips, bilingual labels, RTL-safe geometry,
reduced-motion guards, no boxy grid, no fabricated transcript. But the *substance* of an OpenCode
session drill — a child session you navigate into, containing real tool calls with inputs,
outputs and timestamps, with a parent breadcrumb — is **not present**. Until `C2-TOOL-CALLS` and
the `sessionId` wiring land, the answer stays **NO**.

**AR:** العمل على الصقل حقيقي ومُتحقَّق منه: شرائح حيّة، تسميات ثنائية اللغة، هندسة آمنة لـ RTL،
حماية لتقليل الحركة، لا شبكة بطاقات مربّعة، ولا نص محادثة مختلَق. لكن *جوهر* التنقّل إلى جلسة
أوبن كود — جلسة فرعية تدخلها وتجد فيها استدعاءات أدوات حقيقية بمدخلات ومخرجات وأوقات، مع خبز
سلف — **غير موجود**. إلى أن يُنجز `C2-TOOL-CALLS` وتوصيل `sessionId`، يبقى الجواب **لا**.
