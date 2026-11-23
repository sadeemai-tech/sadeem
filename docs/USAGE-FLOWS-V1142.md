# v11.42 — Usage & Flows verification + fix / تحقق وإصلاح الاستخدام والمسارات

**Scope / النطاق:** `src/components/panels/UsagePanel.tsx`, `src/components/panels/FlowsPanel.tsx`,
new test `tests/v1142-usage-flows.test.mjs`. Read-only verification of worktree + scheduler suites.
No other source file was edited.

---

## 1. Verdict — blunt / الحكم بصراحة

**AR:** الاستخدام بعد v1140 نظيف في جوهره: كل الأسعار تأتي من محلّل المزوّد (`api.modelInfo` →
`priceFor`/`resolvePrice`)، وكل عدد توكنات يمرّ عبر `ctx.ts`، ولا يوجد رسم بياني مكرّر ولا رقم كاش
مكرّر. لكن كان فيه **ثلاثة أخطاء عرض حقيقية** أصلحتها الآن: عمود النموذج كان يظهر كـ «—اسم النموذج»
عند غياب بيانات الاستخدام، تكلفة `$0` المعروفة (نموذج مجاني) كانت تُعرض «غير معروف»، وأرقام اليوم
المبنيّة على طلبات تقديرية كانت تُعرض كأرقام دقيقة بلا علامة `≈`. المسار كان «مش هبل» في المنطق
(يحفظ طلباً، يقترحه بعد تكرار، يرسله حرفياً، ويسجّل بعد انتهاء الدور فعلاً)، لكن الواجهة كانت فيها
زر «Replay» مكرّر لا يفعل شيئاً مختلفاً، وتلميح `⌘K` كاذب، وغرض غير واضح. أزلت الميت، ووضعت
غرض المسار في ثلاث خطوات صريحة، وتركت **زر Run واحد**primary. ورشة العمل والجدولة سليمتان: كل
الاختبارات نجحت. الملفات اللي ما أملكها فيها ملاحظات في القسم 5.

**EN:** Usage is fundamentally sound after v1140 — every rate is resolver-sourced, every token
count comes through `ctx.ts`, and the duplicate chart/cache figures are really gone. Three
*genuine display bugs* remained and are fixed here: a no-usage row printed a broken `—model`
label, a known `$0` (free model) was labelled "unknown", and today's aggregate could include
estimated turns while looking exact. The flow engine was already genuinely useful (save →
suggest → run a real settled turn → record), but the UI carried a dead duplicate "Replay"
button, a fake `⌘/Ctrl+K` hint, and an unclear purpose. The dead control is gone, the purpose is
now stated in three honest steps, and there is exactly **one primary Run action**. Worktree and
scheduler are healthy: all their suites pass. Upstream notes are in §5.

---

## 2. USAGE — re-audit of the real runtime path / تدقيق المسار الفعلي

Read path (verified, not assumed):

- `src/lib/api.ts:528` → `electron/preload.ts:200` → `electron/ipc.ts:687-712` →
  `electron/agent/costs.ts:646` (`priceFor` → `resolvePrice`) — the panel resolves each model id
  through `priceViewFromModelInfo(await api.modelInfo(id))` at `UsagePanel.tsx:576`.
- Provider token fields are mapped **once** by `fromProviderUsageReport` (`src/lib/ctx.ts:80`) and
  consumed through `ctxFillTokens` / `occupancySegments`; no local token formula was found.
- Engine → store → panel: `electron/agent/engine.ts:4725-4752` emits `message_end` with run totals
  + attempts → `src/store.ts:4382-4445` stores the run view and accumulates `sessionUsage` →
  `UsagePanel.tsx` renders per-message rows and the by-model table from those same attempts.
- Cost recomputation (`priceCostUsd`) uses the resolver's per-million rates and matches
  `costs.estimateCostExact` to the micro-dollar (proven by `v1140-usage-precision` test 1).

**De-dup confirmed:** one `UsageChart`, no `usage-bar` strip, one "Cache-read tokens" figure,
today's runs printed once, one 14-day token total (`tok / 14d`).

### Fixes applied (all in `UsagePanel.tsx`)

| # | Bug | Fix | Line |
|---|-----|-----|------|
| U1 | `usageMark(r.source)` prepended `—` for `source:'none'`, rendering `—model-name`, and an `≈` in front of a model id | model label now shows `≈` only when the row is an estimate, else the plain id | `UsagePanel.tsx:1000` |
| U2 | Known `$0` cost (free model) shown as "unknown" because the test was `costUsd > 0` | show the real cost whenever `tokens > 0`; `$0.00` is a price, not unknown | `UsagePanel.tsx:826` |
| U3 | Daily log carries no provenance; estimated turns were accumulated and displayed as exact | detect estimated turns landing today (+ stored metadata estimate) and prefix the aggregate with `≈` plus an honest note | `UsagePanel.tsx:609`, `:819`, `:826`, `:831` |
| U4 | Reconcile stamp claimed "sum to the session total" (tokens **and** cost implied) | precise "session **token** total" via a new key (i18n.ts is not owned) | `UsagePanel.tsx:949` |

`≈` rules verified: derived cache saving `≈`, monthly projection `≈`, unbacked session total `≈`,
estimated per-message rows `≈`; exact provider figures carry no marker.

---

## 3. FLOWS — is it genuinely useful? / هل المسار مفيد فعلاً?

**Yes, the path is real** (proved end-to-end in `v1142` test 5):
`flowsHit('…')` ×3 → `flowsSuggestions()` returns the **exact typed text** → `flowsSave()` persists it
verbatim and stops the suggestion → `executeFlowRun()` flips the real `running` edge false→true→false,
sends the exact stored prompt, and calls `flowsMarkRun()` **only after the turn settles** →
`runCount` advances exactly once (2nd press = same path, honest replay). No fake-done; `no-turn`,
`timeout`, `record-failed` stay honest (`v1138-flows` tests 1–2).

### Fixes applied (all in `FlowsPanel.tsx`)

| # | Problem | Fix | Line |
|---|---------|-----|------|
| F1 | "Replay" icon button was a **dead duplicate** of Run (only the toast differed) | removed the button and its `RotateCcw`/`replayed` plumbing; re-pressing Run *is* replay | `FlowsPanel.tsx:725`, `:1147` |
| F2 | Purpose was buried in prose | added an explicit **HOW A FLOW WORKS** 3-step strip: repeat → save → press Run (recorded after settle) | `FlowsPanel.tsx:924` |
| F3 | One primary action was not obvious; Run label was just "Run" | single `fl-btn-run` per row, labelled "Run flow" with an honest tooltip | `FlowsPanel.tsx:1147` |
| F4 | Empty-state `<kbd>⌘/Ctrl K</kbd>` was a **fake control** (App.tsx:83 maps it to the global command palette, not a new flow) | replaced with the true next step: "type the same prompt 3 times…" | `FlowsPanel.tsx:1210` |
| F5 | Toast said "Flow started" **after** the turn had finished | honest "Flow finished — run recorded" | `FlowsPanel.tsx:787` |

---

## 4. Read-only verification — worktree + scheduler / تحقق بدون تعديل

**AR:** كل الاختبارات نجحت على الشجرة الحالية. لم أعدّل أي ملف من ملفاتها. أسطر `EADDRINUSE`
في الناتج ضوضاء متوقّعة من المنفذ 7681 عند التشغيل المتوازي، وليست فشلاً (اختبار الـ webhook
يتحقّق من سلوك المنفذ المشغول صراحةً).

**EN:** All suites pass on the current tree; none of these files were edited. The `EADDRINUSE`
lines are expected port-7681 noise from parallel execution, not failures (the webhook test
explicitly verifies busy-port honesty).

| Suite (read-only) | Result | Anchor (file:line) |
|---|---|---|
| `tests/v1135-worktree.test.mjs` | **PASS 6/6** | `electron/services/gitService.ts` create/list/remove `:69`, base-ref guard `:97`, detached HEAD `:115`, path jail `:131`, dirty guard `:148`, `.worktreeinclude` `:169` |
| `tests-v1138-schedule-guard.mjs` | **PASS 46/46** | `electron/services/scheduleService.ts` tick `:1104`, fire `:980`, persist `:947`, re-arm `:997`, concurrency `:972`, cancel `:1253`, panel parity `src/components/panels/SchedulePanel.tsx:161` |
| `tests/v1138-schedule.test.mjs` | **PASS 6/6** | `electron/services/scheduleService.ts` persist `:141`, live ticker `:168`, restart `:220`, errors `:259`, concurrency/cancel `:287`, webhook `:314` |

**Founder's "worktree should have a scheduler job that checks it"** — verified from the read-only
side: the scheduler service and its panel are present and their proof-gate/observed-clock guards
pass. The worktree guard is a standalone verification script (`v1135-worktree.test.mjs`) that can
be invoked by a cron/webhook job; no source change was needed here.

---

## 5. Test results / نتائج الاختبارات

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** (exit 0) |
| `node --test tests/v1142-usage-flows.test.mjs` | **PASS 6/6** |
| `node --test tests/v1140-usage-precision.test.mjs` | **PASS 4/4** |
| `node --test tests/v1138-flows.test.mjs` | **PASS 4/4** |
| `node --test tests/v1131-flows.test.mjs` | **PASS 12/12** |
| `node --test tests/v1135-worktree.test.mjs` | **PASS 6/6** (read-only) |
| `node tests-v1138-schedule-guard.mjs` | **PASS 46/46** (read-only) |
| `node --test tests/v1138-schedule.test.mjs` | **PASS 6/6** (read-only) |

---

## 6. Hand-off — issues I did NOT edit / تسليم للجهات المختصة

1. `electron/agent/engine.ts:6156` — `turnIsEstimate = !(u.costUsd > 0) && tokens > 0` marks a
   **known free model** with real provider usage as an estimate. Should use the resolver's
   `unknown`/`estimated` flag, not `costUsd > 0`. (Panel conservatively shows `≈` — safe but noisy.)
2. `src/lib/api.ts:528-532` — typed `modelInfo().price` omits `source/match/matchedId/fetchedAt/sourceUrl`;
   the panel widens the payload locally. Widen the interface so no cast is needed.
3. `electron/agent/costs.ts:646-661` — `priceFor()` returns fabricated fallback `$3/$15` for an
   unknown id (flagged `unknown:true`). The Usage panel suppresses it; any other consumer must too.
4. `src/store.ts:3991-3997` vs `:4449-4457` — `usageLog.runs` increments at **send** time,
   tokens/cost at **message_end**; a turn that dies before `message_end` leaves a run with zero
   tokens that the panel cannot distinguish from a real free turn.
5. `src/i18n.ts:3075` (`usage.reconciled`) and `:2152` (`flows.ranToast = "Flow started"`) hold
   inaccurate strings. The panels now use new keys with honest fallbacks (`usage.reconciledTokens`,
   `flows.run.finished`); please update the dictionary when i18n ownership is free.
6. `electron/services/flowsService.ts` exposes `flowsValidateByReplay` (real exit-code proof) but
   no panel control invokes it. Product note: a "Verify" action would make the flow feature even
   more useful; not added here (must not fabricate a fake pass).
