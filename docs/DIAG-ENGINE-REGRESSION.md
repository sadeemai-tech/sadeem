# DIAG — engine.ts regression after longRun + memory + permission integration

**Scope:** diagnosis only. No source file was modified.
**Files read:** `electron/agent/engine.ts` (all relevant paths, incl. every cited edit site and its call sites), `electron/agent/longRun.ts`, `electron/agent/engineGates.ts`, `electron/agent/budget.ts`, `shared/types.ts`, plus `engine.ts` watchdog/retry/compaction paths.
**Verdict:** None of the six edits creates a literal infinite loop, and none adds an `await` on the first-token path. **But two of them are real regressions that can produce exactly the reported "takes forever / never stops":**
1. **`engine.ts:1190` passes no settings into `agentTuningOverrides()`** → the helper's user-respecting logic is dead code, so `continueAuto:false`, `maxTurns`, `maxContinueRounds` and `verificationBudget` from the user's settings are clobbered. `continueAuto` is forced to `true` for every run. This is the #1 suspect.
2. **`engineGates.ts:254-258` `resolvePermissionMode()` can silently turn an explicit `plan` run into `fullAccess`.** Safety regression, not a stall.
Everything else is safe or cosmetic. Details below.

---

## The six edits, one by one

### 1. Imports — `engine.ts:46-47` — **SAFE**
```ts
import { agentTuningOverrides, applyLongRunEnv, resolveLongRunLimits } from './longRun';
import { resolvePermissionMode, shouldAutoApprove, type ApprovalRequestLike, type PermissionModeLike } from './engineGates';
```
Both modules are side-effect-free on import (verified: `longRun.ts` has no top-level work; `engineGates.ts` only builds a registry Map). No import-time delay, no circular import back into engine. Nothing suspicious.

### 2. `agentTuning()` — `engine.ts:1185-1194` — **SUSPICIOUS (root cause of "takes forever")**
```ts
return { ...(svc.getSettings().agent ?? {}), ...agentTuningOverrides() };
```
`agentTuningOverrides()` is called **with no argument**, so inside `longRun.ts:157-171`:
- `agentOf(input)` returns `{}` (empty object).
- `limits = resolveLongRunLimits({})` → `enabled` is read **only from `process.env.SURNIA_LONG_RUN`**, never from `settings.agent.longRunMode`.
- `continueAuto: agent.continueAuto === false && !limits.enabled ? false : true`
  → `undefined === false` is `false` → **always `true`**, for every user, in every mode, long-run or not.
- `maxTurns` → `positiveInt(undefined, BASELINE_LIMITS.maxTurns)` = **120** (clobbers user's value).
- `maxContinueRounds` → **30** (clobbers user's value).
- `verificationBudget` → forced to `VERIFICATION_BUDGET_DEFAULTS` `{24, 1.5}` (`budget.ts:36-41`), clobbering any user override.

Because this spread is **last**, it overwrites the freshly read settings. The helper's own doc comment (`longRun.ts:151-156`) claims "User-set values win" — that is **false for the way engine.ts calls it.** The implementation is correct; the call site is wrong.

Concrete effect: a user who set `continueAuto:false` to make the agent stop after one round now gets `maxRounds = 30` at `engine.ts:2530` (not computed from their setting), so whenever a round burns its step budget the agent keeps going for up to 30 more rounds. With `fullAccess` this is `effRounds = max(30, 60) = 60` (`engine.ts:2535-2539`). With long-run on it is 200. That is "takes forever" without any infinite loop.
Secondary effect: user's custom `maxTurns` / `verificationBudget` silently ignored (behaviour change, not a stall).

**Minimal fix (one line, engine.ts:1190):**
```ts
return { ...(svc.getSettings().agent ?? {}), ...agentTuningOverrides({ settings: svc.getSettings() }) };
```
Passing settings activates the helper's existing `agent.continueAuto === false` check and its `positiveInt(agent.maxTurns, …)` / `explicitVb` reads. Do **not** reorder the spread — the helper is meant to be the final floor/override; feeding it the settings is the fix.

### 3. Mode resolution + `applyLongRunEnv()` — `engine.ts:1361-1371` — **MIXED**
```ts
const mode = resolvePermissionMode({ paramsMode, settingsMode, sessionOverride }) as PermissionMode;
sessionPermissionModes.delete(params.sessionId);
if (mode === 'fullAccess' || resolveLongRunLimits().enabled) applyLongRunEnv();
```
Sync `require` at 1362 — **fine, no new await** (checking off item #5).

**(a) `applyLongRunEnv()` env keys (item #1): SAFE re first-run speed and retry backoff.**
`longRun.ts:179-200` sets exactly five keys, and only when `enabled`:
`SURNIA_MAX_RUN_MS` (8h), `SURNIA_TIME_CAP_GRACE_MS` (15min), `SURNIA_MAX_TOKENS_CONTINUES` (60), `SURNIA_PAUSE_CONTINUES` (120), `SURNIA_STREAM_CONTINUE_BUDGET` (16). It skips any key the operator already set (`longRun.ts:194`). It does **not** touch `SURNIA_TURN_RETRY_DELAYS_MS`, which is the only source of retry backoff (`engine.ts:127-138`, read at 4377 and used at 4636). So retry backoffs are unchanged. The first run is not slowed: `runWallClockCapMs()` (`engine.ts:182-184`) is only a ceiling — changing 5h→8h just delays the *wrap-up notice*, it adds no wait. **Suspicion #1 is unfounded.**

Real caveats worth fixing:
- **Global leakage:** `applyLongRunEnv()` mutates `process.env` and is never undone. Once set (only possible when `SURNIA_LONG_RUN` is in env), every later run in the same process inherits 8h/60/120/16 — normal runs then continue truncated answers 60× instead of 25× and paused turns 120× instead of 50×. That can make unrelated later runs "take forever". Minimal fix: scope the knobs (pass an env map / restore in `finally`), or stop using `process.env` as the config channel.
- **Settings flag is dead here too:** `resolveLongRunLimits()` at 1371 is called with no input, so it checks only `process.env.SURNIA_LONG_RUN`. A user who enables long-run through `settings.agent.longRunMode` never triggers `applyLongRunEnv()` (unless mode is `fullAccess`, in which case the call happens but `applyLongRunEnv()` immediately returns `[]` because its own `enabled` check also sees no settings). `SURNIA_LONG_RUN` is not set anywhere in the codebase (grep confirms), so in practice this whole path is inert unless an operator sets the env var. Minimal fix: `resolveLongRunLimits({ settings: svc.getSettings() })` and `applyLongRunEnv({ settings: svc.getSettings() })`.

**(b) `resolvePermissionMode()` — SUSPICIOUS (safety, not stall).**
`engineGates.ts:255-257`:
```ts
const explicitFull = input.paramsMode === 'fullAccess' || input.settingsMode === 'fullAccess';
if (explicitFull && input.sessionOverride !== 'plan') return 'fullAccess';
return input.sessionOverride ?? input.paramsMode ?? input.settingsMode ?? 'default';
```
It protects against a `plan` **sessionOverride** but not against an explicit `paramsMode === 'plan'`. If persisted settings say `fullAccess` and the run is launched with `params.mode === 'plan'` and no session override, this returns `fullAccess` — the agent edits files in a run the user asked to be plan-only. The actual `PermissionMode` type (`shared/types.ts:565`) is `'plan'|'default'|'autoEdit'|'fullAccess'` (no `'read'`), so `'plan'` is the only read-only mode and it is the one that leaks.
Minimal fix:
```ts
const planWins = input.sessionOverride === 'plan' || input.paramsMode === 'plan';
if (explicitFull && !planWins) return 'fullAccess';
```
(The `sessionPermissionModes.delete()` at 1368 still happens *after* resolution — correct, per the helper's contract.)

### 4. `shouldAutoApprove` — `engine.ts:2213` vs old inline check — **SAFE (intentional), with one safety note**
Old (per `engineGates.ts:217-234`): `req.force !== true && (mode==='fullAccess' || (mode==='autoEdit' && kind==='write'))`.
New: `shouldAutoApprove(currentMode(), kind, req)` → `engineGates.ts:275-284`.

Differences and their impact:
- `fullAccess` now auto-approves **even when `force===true`** — this is the intended fix (full-access is a whole-run contract). It means `force` requests from `tools.ts:870,1177,1724`, `lsp.ts:232`, danger/taint escalations no longer show approval cards in fullAccess. Intended; no engine-level retry loop is introduced — a failing tool just returns an error to the model, and repeated identical calls are caught by the pre-existing doom-loop detector (`engine.ts:~5000`). **Suspicion #3 ("auto-approve → validation failure → endless retry") is unfounded at the engine level.**
- `req.fullApproval === true` is a new bypass, but **no producer sets it** (grep: only declared in `engineGates.ts`). Dead alias; harmless today, worth remembering if a remote/headless surface starts setting it.
- `autoEdit` now also matches `kind === 'edit'`, but `ApprovalKind` (`shared/types.ts:147`) has no `'edit'` member, so this is dead code and autoEdit behaviour is unchanged.
- `plan`/`read` still always ask. `doom_loop` is still handled earlier at `engine.ts:2183-2197`, before the new check. DENY rules and persisted ALLOW rules still win at 2206-2207. **No tool-loop breakage.**

### 5. `continuityNote` at compaction — `engine.ts:4294-4307` — **SAFE, minor noise**
```ts
let continuityNote = '';
try {
  const cont = gates.continuity?.preamble?.();
  if (cont) continuityNote = `${cont}\n\n`;
} catch { /* best-effort advisory */ }
```
- `gates` is a real `RunGates` created at `engine.ts:1497`; `continuity` is always a `ContinuityLedger` (`engineGates.ts:43`). `preamble()` (`longRun.ts:353-388`) is bounded: `maxChars` default 6000, items capped/sliced/truncated (`MAX_DECISIONS=80`, `MAX_PENDING=60`, `MAX_FILES=300`, `MAX_COMMANDS=30`, `MAX_ITEM_CHARS=400`, original task sliced to 1200). It cannot be huge and the try/catch cannot throw out. **Suspicion #4 ("huge/undefined → prompt bloat or throw") is unfounded.**
- Minor real issue: it is **not gated on long-run**. With an empty ledger, `preamble()` still returns the literal header `[LONG-RUN CONTINUITY — carried across compaction]\n`, so *every* compaction — even in normal mode — injects that header (~51 chars, up to 6000 when populated). Cosmetic prompt noise / slight compaction latency only.
- `originalTaskText(head, params.messages)` at 4292 is pre-existing (v12), not part of these edits.

### 6. Thinking notice → one marker after 20s — `engine.ts:4341`, `4550-4557` — **SAFE**
- `thinkQuietMarkerSent` is declared at 4341, **before** the failover loop at 4384 and inside the `for (; iter < o.maxIters; iter++)` loop (4110). So it resets per turn: at most one `[thinking Ns — still reasoning…]` marker after 20s **per turn**, exactly as described. No stall.
- Liveness does **not** depend on these notices: think deltas still stream at 4559, the engine heartbeat still fires every 1s at 4477, and the engine idle watchdog is independent at 4480-4489. Removing the old 2s spam cannot make the renderer declare a disconnect. **Suspicion #5 (new await) is unfounded here too.**
- Cosmetic: `lastThinkNoticeAt` (4340) is now write-only (set at 4554, never read) — the old 2s throttle was removed. Harmless dead variable; the 2-space indentation at 4341 is also cosmetic.

---

## Ranked suspects for the P0

| # | Location | Impact | Verdict |
|---|----------|--------|---------|
| 1 | `engine.ts:1190` — no settings passed to `agentTuningOverrides()` | `continueAuto:false` and user tuning ignored → up to 30/60/200 extra continuation rounds | **ROOT CAUSE, fix first** |
| 2 | `engine.ts:1371` + `longRun.ts:179-200` — process.env leakage / settings flag ignored | Later runs inherit 8h cap and raised continue budgets | **Real, fix second** |
| 3 | `engineGates.ts:255-257` — explicit `plan` overridden by settings `fullAccess` | Runs execute in fullAccess when user asked for plan | **Real safety bug** |
| 4 | `engine.ts:4298` — continuity header injected unconditionally | ≤6k prompt noise on every compaction | Cosmetic |
| 5 | `engine.ts:4341/4552` — one thinking marker | none | Safe |
| 6 | `engine.ts:2213` — `shouldAutoApprove` | intended fullAccess fix; no engine loop | Safe |

## Minimal fixes (in order)
1. `engine.ts:1190` → `agentTuningOverrides({ settings: svc.getSettings() })`.
2. `engine.ts:1371` → `resolveLongRunLimits({ settings: svc.getSettings() })` and `applyLongRunEnv({ settings: svc.getSettings() })`; and stop leaking `process.env` across runs (restore/scoped env).
3. `engineGates.ts:256` → make `paramsMode === 'plan'` win just like `sessionOverride === 'plan'`.
4. Optional: gate the continuity preamble on long-run being enabled; delete dead `lastThinkNoticeAt`.

**Not bugs (do not "fix"):** `applyLongRunEnv()`'s env keys do not affect retry backoff or first-run latency; the continuation while-loop is bounded and gated by `result.maxedOut`, so `continueAuto:true` alone cannot continue after a normal answer; `continuityNote` is bounded and caught; there is no new await before the first token.
