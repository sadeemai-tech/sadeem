# v11.35 — Agent Session Drill-Down / التنقّل داخل جلسة الوكيل

**Owner:** A5 (implementer) · **Status:** implemented + verified · **Language:** EN then AR.

---

## 1. What was built / ما الذي بُني

**EN.** The inline agent-team card in the chat stream is now a *real entry point*, not a
decorative orbit. Clicking (or keyboard-activating) either the mono **Open** rail in the
card head or a named specialist row calls the existing store action
`openSubagentDetail(recordId)`, which opens the focused **Subagent detail** dialog — a
session-within-session, like OpenCode. Nothing in the beautiful Subagents rail page was
touched, and every existing animation (`agt-orbit-spin`, `agt-hub-breathe`, `agt-breathe`,
`agt-node-in`, `agt-card-in`, `sad-pop`, …) is preserved verbatim.

**AR.** بطاقة فريق الوكلاء داخل المحادثة أصبحت مدخلاً حقيقياً، لا مجرد مدار زخرفي. الضغط
(أو التفعيل بلوحة المفاتيح) على شريط **Open** في رأس البطاقة أو على اسم أي وكيل يستدعي
إجراء المتجر الموجود `openSubagentDetail(recordId)` فيفتح نافذة **تفاصيل الوكيل الفرعي**
بتركيز كامل — جلسة داخل الجلسة، على غرار أوبن كود. لم يُلمس شيء من صفحة الوكلاء الجميلة،
وكل الحركات السابقة بقيت كما هي.

### Exact changes / التغييرات الدقيقة

| File:line | Change |
|---|---|
| `src/components/AgentTeamCard.tsx:10` | `ArrowUpRight` glyph for the drill affordance. |
| `src/components/AgentTeamCard.tsx:185-198` | `focus` = running agent, else first registered agent; `openLabel = t('sa.openDetail','Open')`. |
| `src/components/AgentTeamCard.tsx:205-224` | `<button data-testid="agt-open-session">` — labelled, keyboard-accessible, **never disabled**, real `onClick → openSubagentDetail`. Absent only when no ledger row exists yet (nothing to drill into). |
| `src/components/AgentTeamCard.tsx:283-308` | Each named legend row is a `<button data-testid="agt-agent-link">` when it has a real ledger id; plain text otherwise (no dead button). |
| `src/components/SubagentDetailModal.tsx:15-26` | `Step` type carries **optional** `step?: string` — the real engine label. |
| `src/components/SubagentDetailModal.tsx:110-116` | Timeline shows `Step n of total · <real step label>` whenever the field exists — never invents one. |
| `src/components/SubagentDetailModal.tsx:177-181` | `railAt` computed from the **real** `done/total` counters. |
| `src/components/SubagentDetailModal.tsx:187-201` | `<button data-testid="sad-back">` — labelled **Back to AGENT TEAM**, wired to `close()`; Escape + backdrop still work. |
| `src/components/SubagentDetailModal.tsx:229-244` | Hairline **orbital step rail**: one tick per recorded step, one breathing head at the real progress position (reuses `agt-breathe`). |
| `src/components/subagents.css:502-593` | v11.35 hairline grammar: frameless mono drill controls, mirrored arrow, clickable legend rows, orbital rail, **both** reduced-motion gates, zero hex, logical properties only. |
| `tests/v1135-agent-drill.test.mjs` | 8 SSR/source tests (real click, real transcript shape, no fabrication, EN/AR + RTL). |

**No new i18n keys were needed.** All labels reuse existing keys: `sa.team`, `sa.openDetail`,
`sa.outputs`, `sad.step`, `sad.title`, `sad.eyebrow`, `sad.timeline`, `sad.output`, etc.
(verified in `src/i18n.ts:3043-3088`). Screens stay strictly single-language.

---

## 2. Data reality — what is REAL and what is NOT / البيانات الحقيقية

**EN.** The detail view shows only data that actually exists:

- `SubagentRecord.prompt`, `.description`, `.status`, `.role`, `.durationMs`, `.done/.total`,
  `.summary`, `.error` — the verbatim delegated task and its outcome.
- `store.subagentSteps[id]` — the live `{at, done, total}` progress events accumulated from
  `subagent_progress`, rendered as a time-stamped step timeline + the orbital silhouette,
  with a live "waiting for the next step" tail while running.
- No tool names, arguments or outputs are fabricated. There is **no** per-agent tool-call
  transcript in the current data model, so the UI never pretends there is one.

**AR.** تعرض نافذة التفاصيل بيانات حقيقية فقط: التوجيه الأصلي، الحالة، الدور، المدة،
عدادات الخطوات، النتيجة أو الخطأ، والخط الزمني المباشر للأحداث المسجّلة. لا يتم اختراع
أسماء أدوات أو وسائط أو مخرجات — لأن النموذج الحالي لا يحتوي على سجل أدوات لكل وكيل.

---

## 3. HANDOFF TO PARENT — exact missing data fields / ما يحتاج الوالد إضافته

The founder asked for *"what that agent is doing step by step"* like OpenCode. Today the
main process **does** emit a short real action label, but the shared type and the renderer
drop it, and there is no per-subagent tool-call feed at all. Exact locations:

### 3a. The real `step` label is being dropped (highest value, tiny patch)

1. `shared/types.ts:432` — the `subagent_progress` AgentEvent variant declares only
   `{type,id,label,done,total}`; it is missing `step?: string` and `pct?: number`.
   The main-process mirror already has them: `electron/agent/subagents.ts:54-62`.
2. `src/store.ts:60-64` — `SubagentStep` is `{at, done, total}`; add `step?: string`.
3. `src/store.ts:4750` and `src/store.ts:4760` — the `subagent_progress` case stores only
   `{label,done,total}` and `{at,done,total}`; include `step: e.step` in both.
4. `openSubagentDetail` seed at `src/store.ts:5357-5359` can include the record's `step`
   (`electron/agent/subagents.ts:101-103` already stores it on the main-side ledger, but
   `shared/types.ts:282-300` does not expose it).

Once (1)-(3) land, `SubagentDetailModal.tsx:114` immediately renders the real action
(`Step 2 of 5 · read_file src/app.ts`). No UI change needed — the test
`tests/v1135-agent-drill.test.mjs:3d` already proves the consumption path.

### 3b. Full OpenCode-style per-agent tool-call transcript (larger feature)

There is no field for tool calls / outputs scoped to a subagent:

- `shared/types.ts:282-300` — `SubagentRecord` has no `transcript` / `toolCalls` array.
- `shared/types.ts:302-305` — `SubagentEvent` carries only `{type, record?}`.
- `src/lib/api.ts:675-679` — `subagentsList/Get/Retry/Clear/onSubagentsEvent`; `subagentsGet`
  (`electron/agent/subagents.ts:352`, IPC at `electron/agent/subagents.ts:491`,
  preload at `electron/preload.ts:382`) returns a bare record, never a transcript.
- `src/store.ts:820` — `subagentProgress` is only `{label, done, total}`.
- `shared/types.ts:432` and `electron/agent/engine.ts:4994-5006` — progress events carry
  counters (+ the dropped `step`), never `{tool name, args, output, ok}`.

Proposed additive shape (parent owns these files):

```ts
// shared/types.ts
export interface SubagentToolCall {
  at: number;
  name: string;
  args?: string;     // bounded, sanitized JSON
  output?: string;   // bounded, sanitized
  ok: boolean;
}
// SubagentRecord: transcript?: SubagentToolCall[];
// subagent_progress AgentEvent: step?: string; pct?: number;
```

Then have the engine append real tool events to the subagent ledger and expose them via
`subagentsGet`. The detail modal can render `record.transcript` under the existing
"Timeline" section; until then it stays honest and shows no invented feed.

---

## 4. Verification / التحقق

```bash
npx tsc --noEmit                                                   # clean
node --test --test-force-exit tests/v1135-agent-drill.test.mjs      # 8/8 pass
node --test --test-force-exit tests/v1134-art-guard.test.mjs        # pass
node --test --test-force-exit tests/v1111-toolvisuals.test.mjs      # pass
node --test --test-force-exit tests/v1127-ui-guard.test.mjs         # pass
```

All green at hand-off. The subagent rail page (`SubagentsPanel.tsx`) and its orbital plate
were not edited. `v1134-art-guard` still prints its pre-existing *diagnosis* report
(stale notes about the agent card wrapper and raw `<pre>` drawer); those are reporting-only
findings and the suite passes.
