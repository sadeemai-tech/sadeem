# DIAG-APPROVAL — why "full access / full approval" still shows approval cards

**Scope (read-only diagnosis; no source file was edited):**
`electron/agent/engine.ts`, `electron/agent/engineGates.ts`, `electron/agent/tools.ts`, `electron/agent/risk.ts`, `electron/agent/register.ts`, `electron/agent/mcp.ts`, `electron/agent/cli.ts`, `electron/services/apiServerService.ts`, `electron/services/scheduleService.ts`, `src/store.ts`, `src/components/ChatPanel.tsx`, `src/components/settings/{ApprovalsSection,GeneralSection,AgentSection,AdvancedSection,presets}.tsx`, `shared/types.ts`, `tests/v1115-longrun.test.mjs`.

**Method:** static code inspection. No runtime repro was performed; where runtime proof is missing this is stated explicitly.

---

## 1. ENGLISH — VERDICT

The parent's fix is **correct but incomplete**. `engine.ts:2213` now calls
`shouldAutoApprove(currentMode(), kind, req)`, and `engineGates.ts:275-284` returns
`true` for `fullAccess` **before** looking at `req.force`. Therefore every tool call
that goes through `gate()` — including the `force:true` escalations from `tools.ts`
(danger commands, taint, network allowlist, unread overwrite, browser_eval,
desktop_control) — is now auto-approved in fullAccess.

But **four emit sites bypass `gate()` entirely** and still call
`ioB.send({ type: 'approval_request', ... })` with no mode check:

| # | Site | Kind | Mode check? | fullAccess bypass? |
|---|------|------|-------------|--------------------|
| 1 | `engine.ts:2185` (branch at `:2183`) | `doom_loop` | only `plan` at `:2151` and task-mode read-only at `:2160` (neither applies to this kind) | **NO — still prompts** |
| 2 | `engine.ts:2370` (`ctx.askUser`, branch at `:2367`) | `question` | none | **NO — still prompts** |
| 3 | `engine.ts:4780` (task-budget continuation) | `question` | none | **NO — still prompts** |
| 4 | `mcp.ts:1142` (`emitElicitationApproval`, declared `:1140`) | `mcp_elicitation` | none | **NO — still prompts** |

Site **#1 is the most likely direct cause of the founder's complaint** if the repeated-tool guard fires: the doom-loop card is emitted *before* the `shouldAutoApprove` block at `:2213`, so fullAccess has no effect on it.

There is also a **configuration trap**: the UI has a toggle named "Auto-approve file edits" (`autoApproveEdits`) that a user can reasonably read as "full approval". It is **not** the engine mode; the engine never reads it (only the headless HTTP API does, at `apiServerService.ts:902`). A user who enables that toggle while `permissionMode` stays `'default'` still gets cards. See §3.

And a **liveness gap**: switching to full access **mid-run does nothing** to the active run (§5).

---

## 2. COMPLETE `approval_request` EMIT MAP

### 2.1 Engine emit sites

| file:line | kind | Producer | Reached through `gate()`? | Check before emit | fullAccess |
|---|---|---|---|---|---|
| `engine.ts:2185` | `doom_loop` | repeated-tool guard (`DOOM_LOOP_THRESHOLD`) | yes, but **early-return branch** at `:2183-2197`, before rule/auto logic | `currentMode()==='plan'` at `:2151` (returns false), task-mode read-only at `:2160` (does not match this kind) | **PROMPTS** |
| `engine.ts:2253` | `write` / `command` / `mcp` / `delete` / `escape` | all `ctx.approve()` calls in `tools.ts` | yes | `denyRules` `:2206`, `ruleAllows` `:2207`, **`shouldAutoApprove` `:2213`** | **AUTO-ALLOWED** (force ignored) |
| `engine.ts:2370` | `question` | `ctx.askUser` → `ask_user` tool (`tools.ts:3810-3824`) | **no** — own branch in `makeCtx` | none | **PROMPTS** |
| `engine.ts:4780` | `question` | task-budget continuation prompt | **no** — inline in `streamTurn` | none | **PROMPTS** |
| `mcp.ts:1142` | `mcp_elicitation` | MCP server elicitation | **no** — separate emit path | none | **PROMPTS** |

Non-emitting matches (for completeness): `cli.ts:256` is a `switch` case label that only prints; `register.ts:140-149` only fires a desktop notification when an event arrives; `store.ts:3325-3351` is the renderer consumer (`pendingApproval`); `ChatPanel.tsx:1296` renders every kind except `write` (writes use the diff view). **The renderer has no mode information in the event and never suppresses a card** — suppression must happen in the engine.

### 2.2 `force:true` producers in `tools.ts` (all go through `gate()` → now bypassed)

| file:line | tool | force reason | Comment still claims |
|---|---|---|---|
| `tools.ts:870` | `browser_eval` | arbitrary page JS — literal `force: true` | "ALWAYS explicit approval" (now false in fullAccess) |
| `tools.ts:1177` | `browser_console_eval` | same | same |
| `tools.ts:1714-1725` | `write_file` | `unreadOverwrite` — overwriting a file never read this session | "requires an EXPLICIT approval even in fullAccess" (now false) |
| `tools.ts:2018-2079` | `run_command` | `forceAskFinal = danger && !allowDangerousCommands \|\| taint \|\| network-allowlist` | "danger → ALWAYS ask, even in fullAccess" (now false) |
| `tools.ts:4951` | `run_background` | danger-risk command | same |
| `tools.ts:6810-6815` | `desktop_control` | `force: taintActive` | "explicit approval even in fullAccess" (now false) |

`risk.ts:27,153-158` and `ApprovalsSection.tsx:142-145` still document "danger ALWAYS asks, even in fullAccess". **That documentation is now wrong.** `shouldAutoApprove('fullAccess', ...)` returns before `force` is examined. Either update the copy (recommended if fullAccess really is a whole-run contract) or reintroduce a narrow `danger` exception — the two goals are mutually exclusive.

### 2.3 Why `fullAccess` works for the main gate

`engineGates.ts:275-284`:
```
if (mode === 'plan' || mode === 'read') return false;   // read-only safety wins
if (mode === 'fullAccess' || req.fullApproval === true) return true;
if (mode === 'autoEdit' && (kind === 'write' || kind === 'edit') && req.force !== true) return true;
return false;
```
`engine.ts:2213` passes `req as ApprovalRequestLike` (the gate's `req` type at `:2143` carries `force?: boolean`), so `force` is present but deliberately ignored for fullAccess. `tests/v1115-longrun.test.mjs:289-293` locks this in for command/write/delete/mcp. **No test covers doom_loop, question, or elicitation** — which is exactly why the remaining prompts survived.

---

## 3. SETTINGS → `params.mode` TRACE (and why it can be `'default'`)

Normal desktop chat path:

1. `src/store.ts:926` — default state `permissionMode: 'default'`.
2. `src/components/settings/GeneralSection.tsx:193-198, 363-368` — mode cards call `setMode(m.id)`.
   `src/components/settings/ApprovalsSection.tsx:50, 125-129` — "Full access master switch" calls `setMode(v ? 'fullAccess' : 'default')`.
3. `src/store.ts:1992` — `setMode: (m) => get().updateSettings({ permissionMode: m })`.
4. `src/store.ts:1949-1982` — `updateSettings` sets renderer state then `void api.saveSettings?.(settings)` (**fire-and-forget**).
5. `src/store.ts:3060-3075` — `api.agentRun({ ..., mode: s.settings.permissionMode, ... })` at **`:3069`**.
6. `electron/agent/register.ts:234` IPC handler → **`:353` `runAgent(params, runIo)`** — passes `params.mode` through untouched (credential injection at `:306-312` only adds `providers`/`memory`).
7. `electron/agent/engine.ts:1361-1367` — reads `getSettings().permissionMode` from the **main-process** store **once**, then `resolvePermissionMode({ paramsMode, settingsMode, sessionOverride })`.
8. `engineGates.ts:254-258` — `explicitFull = paramsMode==='fullAccess' || settingsMode==='fullAccess'`; full wins unless the one-shot override is `'plan'`.
9. `engine.ts:1368` deletes the one-shot override; `:1373` `currentMode()` = `sessionPermissionModes.get(sessionId) ?? mode`.

**Honest assessment:** in the plain desktop chat path, if `settings.permissionMode === 'fullAccess'` then `params.mode` is also `'fullAccess'` (`:3069` reads live state) and `resolvePermissionMode` yields `fullAccess`. I could not find a code path that turns a correctly-saved `fullAccess` into `params.mode='default'` in that flow. The realistic ways the user *thinks* they selected full approval but the engine sees default are:

- **(a) Wrong switch.** `src/components/settings/AgentSection.tsx:531-537` — "Auto-approve file edits" / "موافقة تلقائية على تعديل الملفات" writes `autoApproveEdits`, **not** `permissionMode`. The engine never reads `autoApproveEdits`; only `apiServerService.ts:902` does (headless API, write kind). With `permissionMode='default'` the engine prompts for commands and other writes.
- **(b) A preset/reset overwrote the mode.** `presets.ts:39` (Safe) and `AdvancedSection.tsx:158` ("Reset all") set `permissionMode: 'default'`; `presets.ts:72` sets `'autoEdit'`. Applying one after choosing full access silently downgrades the mode.
- **(c) Headless/API/schedule entry points.** `apiServerService.ts:838-847` uses `s.permissionMode` from the main-process settings snapshot; if `saveSettings` (fire-and-forget, step 4) has not completed, that snapshot can be stale. `scheduleService.ts:497-504, 760` defaults jobs to `'autoEdit'`; `cli.ts:48` defaults to `'fullAccess'` but honours `--mode`. These paths do not read the renderer's `settings.permissionMode` at all.
- **(d) Pre-fix one-shot override.** Before the parent's `resolvePermissionMode` change, `applyPlanApproval('manual')` at `engine.ts:1039` wrote `'default'` into `sessionPermissionModes`, which could win. With the current helper, an explicit fullAccess still wins over `'default'`/`'autoEdit'` overrides (only `'plan'`/`'read'` win) — so this is fixed.

---

## 4. IS `req.fullApproval` EVER SET? — NO

`fullApproval` appears in production code **only** in `engineGates.ts:265` (type field), `:271` (comment) and `:281` (check). It is:

- not a `PermissionMode` (`shared/types.ts:565` = `'plan' | 'default' | 'autoEdit' | 'fullAccess'`);
- not a field of `AgentRunParams` (`shared/types.ts:613-628`);
- not in `ApprovalRequest` (`engine.ts:2143` has only `kind/title/detail/payload/force`);
- not set by any IPC handler, settings UI, remote bridge, or `apiServerService`;
- referenced only by the unit test `tests/v1115-longrun.test.mjs:295`.

**Conclusion:** `fullApproval` is a dead alias. All real behaviour is mode-based. Do not rely on it to fix the founder's complaint; wire `permissionMode` instead.

---

## 5. MID-RUN TOGGLE — DOES NOT TAKE EFFECT

- `engine.ts:1373` `currentMode()` reads only `sessionPermissionModes.get(params.sessionId)` (falling back to the `mode` captured at `:1363` at run start).
- That map is written **only** by `applyPlanApproval()` at `engine.ts:1036` (`'autoEdit'`) and `:1039` (`'default'`), and deleted at `:1043` / `:1368` / `:1043`. **No settings-save path writes to it.**
- `src/store.ts:1981` `api.saveSettings?.(settings)` updates the main-process settings file, but `engine.ts:1362` reads `getSettings()` **once, at run start**, and never re-reads.
- Therefore flipping the full-access switch while a run is active changes the UI strip and the settings file, but the **active run keeps its old mode**. The next run picks it up. This is a real bug, not a perception issue.

---

## 6. MINIMAL COMPLETE FIX (exact edits; not applied)

### 6.1 MUST — kill the doom-loop card in fullAccess

`electron/agent/engine.ts:2183`, insert **before** `const requestId = randomUUID();`:

```ts
if (kind === 'doom_loop') {
  // fullAccess is a whole-run contract: no approval card for the loop guard.
  // plan/read still ask because shouldAutoApprove() returns false for them.
  if (shouldAutoApprove(currentMode(), kind, req as ApprovalRequestLike)) {
    notice('doom_loop', `\n[fullAccess] repeating action (${String(req.title ?? kind).replace(/\s+/g, ' ').slice(0, 120)}) — continuing without approval\n`);
    sessionDoomDecisions.set(params.sessionId, 'proceed');
    return true;                       // or 'stop'/false if runaway loops are preferred
  }
  const requestId = randomUUID();      // existing code, unchanged below
  ioB.send({ type: 'approval_request', requestId, kind, title: req.title, detail: req.detail, payload: req.payload });
  ...
}
```
`notice` is in scope (`engine.ts:1350`). This is the single highest-value edit. Tradeoff (honest): auto-proceeding a detected loop can spin; if that is unacceptable, set `sessionDoomDecisions` to `'stop'` and `return false` with the same `sys_notice` — still zero cards.

### 6.2 If "absolutely zero cards" is the requirement — `ask_user`

`electron/agent/engine.ts:2367`, first line of the `askUser` async:

```ts
if (shouldAutoApprove(currentMode(), 'question', {})) return '';
```
Recommendation: **do not add this by default.** `ask_user` is genuine user input, not a tool permission, and returning `''` degrades the model's answer. Keep unless the founder explicitly wants questions suppressed too.

### 6.3 If budget cards must also disappear — `engine.ts:4778-4812`

Guard the emit with the same helper (auto-raise the ceiling by `limit` and emit a `sys_notice` instead of a card). **Warning:** this auto-commits extra spend; gate it behind an explicit opt-in setting rather than mode alone.

### 6.4 MCP elicitation — `electron/agent/mcp.ts:1140-1155`

`mcp.ts` has no access to engine mode. To suppress, export from `engine.ts` (near `:1049`):

```ts
export function getSessionPermissionMode(sessionId: string): PermissionMode {
  return sessionPermissionModes.get(sessionId) ?? 'default';
}
```
then early-return in `emitElicitationApproval` when `shouldAutoApprove(getSessionPermissionMode(sessionId), 'mcp_elicitation', {})` is true (auto-`decline` via `settleElicitation`). Recommendation: **keep elicitation cards** — a schema-valid answer cannot be invented safely.

### 6.5 Make mid-run toggling work (fix for §5)

Add near `engine.ts:1047`:

```ts
export function setSessionPermissionMode(sessionId: string, mode: PermissionMode): void {
  if (!sessionId) return;
  sessionPermissionModes.set(sessionId, mode);
}
```
Wire a new IPC handler in `electron/agent/register.ts` (near `:441`) that imports and calls it with `(sessionId, m)`, and call that IPC from `src/store.ts:1992` (`setMode`) / `:1981` (`updateSettings`) after a successful `api.saveSettings`. Alternative with fewer files: have `currentMode()` (`engine.ts:1373`) re-read `getSettings().permissionMode` on each call (cheap if cached), but remember `api.saveSettings` is fire-and-forget, so the explicit IPC is more deterministic.

### 6.6 Documentation/UI honesty (not code-critical)

- `ApprovalsSection.tsx:142-145` and `risk.ts:4-6, 27, 153-158` claim high-risk commands still ask in fullAccess — **update the copy** now that `force` is ignored.
- `AgentSection.tsx:531-537` "Auto-approve file edits" is not full access — relabel or connect it to `setMode`.
- Add tests for the four emit sites in `tests/v1115-longrun.test.mjs` (currently only helper tests exist).

---

## 7. الخلاصة بالعربية (Arabic summary)

**الحكم:** إصلاح الوالد في `engine.ts:2213` صحيح لكنه **غير كامل**. الدالة `shouldAutoApprove` تتجاهل `force` في وضع الوصول الكامل، لذلك كل أدوات `ctx.approve()` — بما فيها الأوامر الخطرة وتصعيدات taint والشبكة والكتابة فوق ملف غير مقروء — تُوافق تلقائيًا الآن.

لكن **أربعة مواضع تُصدر بطاقة الموافقة دون المرور على `gate()` أصلاً**، ولا تفحص الوضع:

1. `engine.ts:2185` — حاجز التكرار `doom_loop`. هذا **أرجح سبب شكوى المؤسس**؛ البطاقة تُرسل قبل سطر 2213، فالوصول الكامل لا يؤثر فيها.
2. `engine.ts:2370` — سؤال `ask_user` (بطاقة سؤال).
3. `engine.ts:4780` — سؤال تجاوز ميزانية المهمة.
4. `mcp.ts:1142` — طلب إدخال من خادم MCP.

المواضع ٢-٤ هي تفاعل/projected "سؤال" وليست إذن أداة، لكنها ما تزال تُظهر بطاقة. الواجهة (`ChatPanel.tsx:1296`) تعرض كل الأنواع عدا `write` ولا تعرف شيئًا عن الوضع، لذا يجب المنع في المحرك.

**فخ الإعدادات:** مفتاح "الموافقة التلقائية على تعديل الملفات" (`autoApproveEdits` في `AgentSection.tsx:531-537`) يظنّه المستخدم "موافقة كاملة"، لكن المحرك لا يقرأه إطلاقًا؛ الشريط الحقيقي هو `permissionMode`. كما أن preset "آمن" (`presets.ts:39`) وزر "إعادة الضبط" (`AdvancedSection.tsx:158`) يعيدان الوضع إلى `default` بصمت.

**`req.fullApproval` ميت تمامًا:** لا يُضبط في أي مسار إنتاجي؛ كل القرارات تعتمد على `permissionMode` فقط.

**التبديل أثناء التشغيل لا يعمل:** `currentMode()` (`engine.ts:1373`) يقرأ خريطة `sessionPermissionModes` التي لا يكتبها إلا الموافقة على الخطة (`applyPlanApproval`)، ولا يكتبها حفظ الإعدادات؛ والمحرك يقرأ الإعدادات مرة واحدة فقط عند بدء التشغيل (`engine.ts:1362`). التغيير يسري في التشغيل التالي فقط.

**الإصلاح الأدنى:** إضافة فحص `shouldAutoApprove(currentMode(), kind, req as ApprovalRequestLike)` داخل فرع `doom_loop` في `engine.ts:2183` قبل إرسال البطاقة (مع `sys_notice` بدلًا منها)، ثم — إن طُلب "صفر بطاقات" — فحص مماثل في `askUser` وميزانية المهمة، وتصدير `setSessionPermissionMode` وربطه بـ IPC لكي يسري التبديل فورًا. وتصحيح النصوص التي ما زالت تعد بأن الأوامر الخطرة "تسأل دائمًا" في الوصول الكامل.

---

## 8. Verification checklist for the parent

- [ ] `doom_loop` in fullAccess → `sys_notice` only, no `approval_request` (new test).
- [ ] Danger/taint/network/unread-overwrite commands in fullAccess → no card (existing helper tests cover the helper; add an integration test with `force:true`).
- [ ] `ask_user` / budget / elicitation → decision recorded (keep or suppress explicitly).
- [ ] `permissionMode='fullAccess'` set in Settings → next run's `params.mode==='fullAccess'` and `getSettings().permissionMode==='fullAccess'` (await `saveSettings`).
- [ ] Mid-run toggle → new IPC updates `sessionPermissionModes` and the next tool call in the *same* run is auto-approved.
- [ ] `plan`/`read` and non-build read-only task modes still deny/ask — must not regress.
