# v11.36 — USAGE / FLOWS / SCHEDULE: blunt verdict
# الحكم الصريح: الاستخدام / المسارات / المهام المجدولة

> Founder order: «page Usage must be ACCURATE … million times I told you accuracy.
> Make flows work. Make scheduled jobs work.»
> Request from: "صفحة اليوزج يجب أن يكون دقيق... مليون مرة حكيت لك الدقة. تأكد بأنها تعمل الفلوز. سكجول جوب أرجوك."

---

## 1. USAGE — ✅ ACCURATE NOW (with one honest boundary)

**English — verdict:** FIXED. The page no longer prints stale session-metadata numbers as if they were a per-model bill. It now reads the **same resolver** as the orb: `api.modelInfo(id)` → `kdx:model:info` → `priceFor` → `resolvePrice` / `resolveModelInfo` (`electron/agent/costs.ts`). Full provenance already rides on that IPC response (`source`, `match`, `matchedId`, `fetchedAt`, `sourceUrl`, `unknown`); the typed bridge was just narrower, so it is widened locally. Token honesty comes from `src/lib/ctx.ts` (`fromProviderUsageReport`, `tokenCountSource`, `ctxFillTokens`, `occupancySegments`) — read-only, unchanged.

- Pure resolver-backed helpers: `src/components/panels/UsagePanel.tsx:83` `priceViewFromModelInfo`, `:133` `priceCostUsd`, `:148` `messageUsage`, `:159` `usageMark`, `:182` `buildModelBreakdown`, `:228` `priceSourceLabel`.
- Per-message provider mapping: `UsagePanel.tsx:330` `perMessageRows` (via `ctx.ts`).
- Model ids resolved and cached through the IPC: `UsagePanel.tsx:530` `modelIdsKey` + effect; per-model breakdown from the **real attempt ledger** (not `sessions[].totalCostUsd`): `UsagePanel.tsx:631`.
- Provenance strip (source / match / matched catalog row / fetch date): `UsagePanel.tsx:689`.
- Exact tokens show no marker; estimates show `≈`; no data shows `—`/`unknown` (`:159`, session block `:869`, per-message block `:967`, per-model block `:1076`).
- A **free tier ($0/$0) is a KNOWN price, not unknown** — caught by the new test and fixed at `UsagePanel.tsx:91`. The old draft mislabeled free models.
- Engine cost (itself produced by the same resolver at run time) is displayed as authoritative; `catalogCostUsd` is recomputed from the live catalog and shown as a cross-check in each row's tooltip. If the resolver reports `unknown`, the page prints `unknown` — never the legacy invented $3/$15.

**العربية — الحكم:** أُصلحت. صفحة الاستخدام لم تعد تعرض أرقاماً قديمة من بيانات الجلسة وكأنها فاتورة لكل نموذج. تقرأ الآن **نفس الحلّ** الذي يستخدمه المدار: `api.modelInfo` → `resolveModelInfo`، مع المصدر/السجل المطابق/تاريخ الجلب ظاهرين. التوكنات من المزوّد بلا علامة، والتقديرات عليها `≈`، وغياب البيانات `—`/«غير معروف». النموذج المجاني ($0/$0) سعر معلوم وليس مجهولاً.

**Boundary / الحدود**: renderer has no BigInt catalog module, so `priceCostUsd` multiplies the resolver's already-exact USD/1M rates and rounds to the micro-dollar. Test proves equality with `estimateCostExact` for curated, prefix-specific, vendor-qualified, free and unknown ids — to 1e-6 USD (`tests/v1136-usage-flows-schedule.test.mjs:181`).

---

## 2. FLOWS — ✅ RUNS (steps are real, not a dead list)

**English — verdict:** FIXED. A flow is still exactly what the product says it is: a saved prompt sent through the normal chat path — not an autonomous job. But the old UI lied in three ways: it bumped `runCount` before the run finished, it called a queued chat turn "queued" forever with no completion listener, and it blocked global flows when no workspace was open. Now:

- Pure, testable gate and step tracker: `src/components/panels/FlowsPanel.tsx:75` `flowRunSteps`, `:99` `flowRunGate`. Five real steps (gate → sent → running/queued → recorded → finished) rendered at `:284` and `:891`.
- Real run path: `FlowsPanel.tsx:511` `run()` awaits `sendMessage`, waits for an actually-busy chat turn to settle (`:583` `waitForChatRunSettled`, bounded 120s), records the run **only after success** (`:558`), and marks the `recorded` step as an error when the bridge refuses (`:562`). No optimistic fake counter (`:342`).
- Global flows no longer need a workspace to be recorded; workspace flows still do (`flowRunGate`).
- Service fix: `electron/services/flowsService.ts:132` `stableFlowId` — a legacy id invalidated by the v11.31 strict-id guard used to get a **new random UUID on every read**, so `markRun`/`delete` could never find it. It is now deterministic (`lg-<sha1[16]>`) across reads.

**العربية — الحكم:** المسار يعمل الآن. الأزرار تُرسل الطلب الحقيقي، وتنتظر انتهاء دور المحادثة قبل تسجيل التشغيل، وتعرض الخطوات الخمس بصراحة. المسار العام لا يحتاج مساحة عمل للتسجيل. أُصلح خطأ قديم كان يغيّر معرّف المسار القديم في كل قراءة فيمنع تسجيل التشغيل.

**Proof:** the saved flow's **exact prompt** was driven through the real `runAgent` against a loopback SSE provider, reached `message_end` with provider-exact tokens, then `flowsMarkRun` advanced `runCount` to 1 (`tests/v1136-usage-flows-schedule.test.mjs:267`). Step states and gate refusals are asserted in the same test.

---

## 3. SCHEDULE — ✅ PERSISTS + FIRES (honest clock state)

**English — verdict:** FIXED. Jobs persist and fire; the display no longer claims an ACTIVE clock it cannot prove.

- **Next-run was wrong** (a lying countdown): the panel parsed the month field 0-based, used dom/dow OR while the service uses AND, and rejected `@monthly`/`@yearly`. Rewritten to mirror `scheduleService.cronMatches` exactly — same aliases, ranges, `getMonth()+1`, AND conjunction, 7→0 dow: `src/components/panels/SchedulePanel.tsx:55` region, `:138` `cronNextRun`, `:113` `cronIsValid`.
- Honest scheduler state: `SchedulePanel.tsx:343` `bridgeOk`, `:351` `clockState` = `unavailable | observed | unverified`, banner at `:601`. It never says "ACTIVE" without an observed fire.
- Jobs are re-polled every 5s (`:331`) so a real `lastRun`/`lastStatus` shows without manual refresh.
- Actions are honestly disabled when the bridge is absent or the job has no workspace (`:888`, New job `:574`); submit pre-validates workspace + cron (`:461`, `:469`).
- Service: `electron/services/scheduleService.ts:122` `storePath()` no longer writes `schedules.json` to `process.cwd()` before init; `:179` `persistJobs` uses the injected dir; `:897` `schedulerStatus()` is the single honest source of ticker/listener state.

**العربية — الحكم:** المهام تُحفظ وتُنفّذ. العدّاد كان يكذب (شهر ناقص واحد، ومنطق يوم مختلف عن الخادم) — أُصلح ليطابق خادم الجدولة تماماً. لا تُعرض حالة «نشط» إلا بعد رؤية تشغيل حقيقي، والأزرار تُعطّل بصراحة عند غياب الجسر.

**Proof:** addJob → `schedules.json` on disk → real `runNow` → terminal status + `lastRun` → survives a fresh `initScheduleService` (`tests/v1136-usage-flows-schedule.test.mjs:367`). The displayed `cronNextRun('30 4 23 11 1')` was frozen and the service fired exactly at that minute, not one minute before, with honest `no workspace configured` error and no double-fire (`:407`).

---

## Verification (all green)

| check | result |
|---|---|
| `npx tsc --noEmit` | PASS (0 errors) |
| `node --test tests/v1136-usage-flows-schedule.test.mjs` | 6/6 pass |
| `node --test tests/v1110-usage.test.mjs` | 6/6 pass |
| `node --test tests/v1131-full-smoke.test.mjs` | 82/82 pass — 60 screens OK, 706 controls scanned, 0 dead, 0 unstable |
| `node --test tests/v1131-flows.test.mjs` (regression) | 12/12 pass |

---

## HANDOFFS — things I could NOT do inside my owned files (read-only owners please act)

1. **`src/lib/api.ts` / `electron/preload.ts`** — `modelInfo()`'s TypeScript surface declares only `{input, output, cacheRead, estimated}`. I widened it locally in UsagePanel; please widen the shared type to include `source/match/matchedId/fetchedAt/sourceUrl/unknown/cacheWrite` so every consumer gets provenance for free.
2. **`electron/preload.ts`** — `kdx:flows:replay` exists in `electron/ipc.ts:905` but has **no bridge method**; the FlowsPanel "validate by replay" button can therefore never appear. Either expose `flowsValidateByReplay` or remove that dead guarded code (I left it harmless).
3. **`electron/preload.ts` + `src/lib/api.ts`** — there is **no `kdx:schedule-event` subscription and no scheduler-status channel**. `schedulerStatus()` (`scheduleService.ts:897`) is ready; expose `scheduleStatus()` and `onScheduleEvent()` so SchedulePanel can replace "CLOCK UNVERIFIED" with a live ticker/LED. Until then the page deliberately says UNVERIFIED.
4. **`electron/ipc.ts:910`** — `kdx:schedule:webhook` returns `{url, token}` unconditionally, even when the listener failed to bind. The webhook card's "LISTENER READY" therefore trusts presence, not `webhookListening`. Return `webhookPort()`/`webhookError` from that handler for an honest badge.
5. **`src/components/schedule.css` / `src/components/flows.css`** (not owned) — the new clock-state note reuses existing `.sch-hist-note`; the run-step list uses existing utility classes, so no CSS file was touched. Optional polish: dedicated `.fl-runstep` styles.
6. **`src/components/panels/WorkspacePanel.tsx`** imports `cronNextRun` from SchedulePanel; it automatically inherits the corrected month/AND/alias math — no change needed there.

## Files actually modified

- `src/components/panels/UsagePanel.tsx`
- `src/components/panels/FlowsPanel.tsx`
- `src/components/panels/SchedulePanel.tsx`
- `electron/services/flowsService.ts`
- `electron/services/scheduleService.ts`
- `tests/v1136-usage-flows-schedule.test.mjs` (new)
- `docs/USAGE-FLOWS-SCHEDULE-V1136.md` (new)
