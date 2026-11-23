# Independent Code Review — v11.16 wave (12-agent landing)

Reviewer: independent subagent. Date: 2026-11-19.
Scope: every `.ts` / `.tsx` / `.css` file with `LastWriteTime > (Get-Date).AddDays(-2)`,
excluding `dist/`, `node_modules/`, `tests/` and `website/.next/`; deep read of the
17 high-risk files named in the brief.

> **Important caveat — the tree was moving during this review.** At least four files
> (`memory.ts`, `providers.ts`, `lsp.ts`, `playbook.ts`, `engine.ts`) and `store.ts`
> changed while I was reading them: `memory.ts` grew 26.7 KB → 30.5 KB, `providers.ts`
> 68.4 KB → 76.9 KB, and line numbers shifted by up to ~72 lines between two reads.
> Several findings below were fixed by parallel agents **during** the review. Each
> finding carries a **Status** field: `OPEN` (still in the tree when I finished) or
> `FIXED DURING REVIEW` (evidence captured, then the fix landed). Line numbers are
> from the final read; re-check before acting. I did **not** modify application source.

---

## 1. Modified files (last 2 days), grouped by area

**A. Electron agent core / engine (highest risk)**
`agent/engine.ts` (5,920+ lines), `agent/providers.ts` (1,440+), `agent/tools.ts`
(10,224+), `agent/tool-defs.ts` (2,077), `agent/longRun.ts` (353), `agent/memory.ts`
(608+), `agent/playbook.ts` (533+), `agent/compaction.ts` (177), `agent/engineGates.ts`
(250), `agent/budget.ts` (219), `agent/lsp.ts` (416), plus the new
`agent/lspLanguages.ts`, and `agent/{journal,cursorIdeas,hooks,vibeFlow,prompts,subagents,
subagentRunner,register,dap,notebook,embeddingIndex,skills,contextStore}.ts`.

**B. Electron shell / services / IPC**
`electron/main.ts`, `electron/ipc.ts`, `electron/preload.ts`, and
`services/{terminalGuard,authService,scheduleService,updateService,cloneService,
browserService,previewService,terminalService,profileService,isolationService,
gitService,storeService,providerService}.ts`.

**C. Renderer core**
`src/store.ts` (4,805+), `src/App.tsx`, `src/main.tsx`, `src/i18n.ts`, `src/styles.css`,
`src/styles/tokens.css`, and `lib/{api,streamDisplay,toolGrouping,subagentDisplay,ctx,
promptPresets,providerSlice}.ts`, `data/mcpCatalog.ts`.

**D. Renderer components (chat surface = the founder's symptom surface)**
`components/{ChatPanel,MessageView,ProofRibbon,StreamTimeline,Composer,
ClarificationCard,Home,Sidebar,Rail,EditorArea,TitleBar,PreviewArea,GoalBanner,
FileTree,ProjectFiles,TerminalView,CommandPalette,SearchPanel,SettingsModal,
RightDock,BrowserDock,Welcome,Onboarding,CloneDialog,NewProjectWizard,PlansScreen,
AgentTeamCard,SubagentDetailModal,billingShared}.tsx`, the `components/panels/*` and
`components/settings/*` families, and ~40 `components/*.css` files (chat, proof,
stream-motion, console, tool-story, clarification, shell, flows, files …).

**E. Marketing website** — `website/app/*` (layout, page, docs, features, pricing,
download, changelog, auth, sitemap), `website/components/*` (chrome, ui, providers,
download, visuals/*, home/*), `website/lib/{site,i18n}.ts`, plus generated
`website/.next/**` (build output; not reviewed as source).

---

## 2. Verification performed (objective evidence)

| Check | Result at start of review | Result at end |
|---|---|---|
| `tsc --noEmit -p tsconfig.json` (src/shared) | **0 errors** | 0 errors |
| `tsc --noEmit -p tsconfig.node.json` (electron) | **1 error** — `memory.ts(327,30) TS2304: Cannot find name 'MAX_FACTS'` | **0 errors** (fixed by a parallel agent) |
| `node --test tests/v1116-*.test.mjs tests/v12-enhancements.test.mjs` | **70 tests / 67 pass / 3 fail** | several of the failing areas subsequently fixed |
| `node --test tests/v1116-*.test.mjs` (isolated rerun) | **6 failures** with concrete reproductions (see §3) | see per-finding status |

The tests are unusually informative here: four of them reproduce the founder's exact
symptoms (SSR render crash, 28 s time-to-first-token, malformed-event throw, missing
persisted memory).

---

## 3. Top findings

Severity key: **P0** = build/run-breaking or crash on a normal path; **P1** = breaks a
run/stream or a founder-named symptom on a realistic path; **P2** = degraded behaviour
or narrow edge case.

### F1 — `run_receipt.commands` element dereference throws in the IPC ingest choke point — **P1 — OPEN**

- **File:line** `src/store.ts:1636` (inside `ingestProofEvent`, `case 'run_receipt'`).
- **Code** `commands.filter((c) => c.ok).length`
- **Scenario / evidence** `e.commands` is typed from untrusted IPC as an array but its
  *elements* are not validated. The v1116 fuzz test reproduced it exactly:
  `event={"type":"run_receipt","commands":[null, [0.73,"<script>"]],…}` →
  `TypeError: Cannot read properties of undefined (reading 'ok')` at
  `Array.filter → ingestProofEvent → ingestAgentEvent`. 1 throw / 2,000 seeded events.
  The test also logged a standalone `REPRO run_receipt.commands=[null] → THREW … @ src/store.ts:1636`.
- **Impact** `ingestProofEvent(e)` runs at `src/store.ts:3151`, **before** the whole
  transcript switch. A throw therefore drops the entire event's state update — the
  canonical "buffered deltas never flush → thinking stops" failure mode described in
  the file's own header comment — and, because `ingestAgentEvent` has no global
  try/catch (see F2), the exception propagates into the `api.onAgentEvent` listener.
- **Minimal fix** `commands.filter((c) => !!c && typeof c === 'object' && c.ok === true).length`
  (or `c?.ok === true`).

### F2 — `ingestAgentEvent` is not actually exception-proof — **P1 — OPEN (systemic)**

- **File:line** `src/store.ts:3124` (function body through ~3930).
- **Evidence** The comment at 3125–3130 states a throw here "aborts the current event's
  state update (buffered deltas never flush → 'thinking stops') and floods the console
  on every subsequent event". Yet there is **no `try { … } catch` around the function
  body** — the nearest `try` blocks are at 3117 (`runAgent`) and 3986 (next function).
  F1 is one concrete exploitable instance; any future case with an unguarded access has
  the same blast radius.
- **Impact** One malformed forward-compatible event can strand the rAF delta buffer and
  make the UI look frozen while the engine keeps running.
- **Minimal fix** Wrap the body (after the `if (!e || typeof e.type !== 'string') return`
  guard) in `try { … } catch (err) { console.warn('[store] ingest', e.type, err); }`, or
  at minimum wrap `ingestProofEvent(e)` at line 3151. Keep `noteAgentActivity()` and the
  heartbeat early-return outside the try so liveness is never lost.

### F3 — `applyLongRunEnv()` is called without settings → the UI long-run flag is ignored — **P2 — OPEN**

- **File:line** `electron/agent/engine.ts:1381–1382`.
- **Code** `if (mode === 'fullAccess' || resolveLongRunLimits({ settings: … }).enabled) { applyLongRunEnv(); }`
- **Scenario** The condition correctly reads settings, but `applyLongRunEnv()` with no
  argument re-resolves with `settings = undefined`, so `longRunEnabled()` is false for a
  run enabled only through `settings.agent.longRunMode`. It returns `[]` and sets none
  of `SURNIA_MAX_RUN_MS`, `SURNIA_TIME_CAP_GRACE_MS`, `SURNIA_MAX_TOKENS_CONTINUES`,
  `SURNIA_PAUSE_CONTINUES`, `SURNIA_STREAM_CONTINUE_BUDGET`.
- **Impact** A long-run session started from the UI keeps the baseline 5 h wall clock
  and baseline continuation budgets; long tasks stop early ("thinking stops").
- **Minimal fix** Hoist the settings read into a local `settings` and pass it to both:
  `applyLongRunEnv({ settings })`. (`agentTuning()` at 1192–1200 already does exactly
  this — mirror it.)

### F4 — `memory.ts` TS2304 compile error + swallowed runtime ReferenceError — **P0 at review start — FIXED DURING REVIEW**

- **File:line** `electron/agent/memory.ts:327` at review start
  (`return [...found].slice(0, MAX_FACTS);`); constant renamed to `MAX_STORED_FACTS`
  at line 51 but the reference was not updated.
- **Evidence** `tsc -p tsconfig.node.json` → `memory.ts(327,30): error TS2304: Cannot
  find name 'MAX_FACTS'.` `npm run full` starts with `typecheck`, so the release pipeline
  would fail. At runtime the call is reached from `extractPathsSafe()` (now ~line 588),
  whose `try/catch` turns the `ReferenceError` into `[]` — so file paths from model
  compaction summaries were silently never added to cumulative memory.
- **Minimal fix (as landed)** use the renamed constant `MAX_STORED_FACTS`. Verified:
  `tsc -p tsconfig.node.json` now exits 0. **Status: FIXED.**

### F5 — MessageView render crash on a message with `content: undefined` — **P1 at review start — FIXED DURING REVIEW**

- **File:line** `src/components/MessageView.tsx` — `trunc()` (~line 426), reached from
  `MessageViewRow` for the DNA feedback excerpt.
- **Evidence** `v1116-chat-precision.test.mjs` case `a28` = `{ content: undefined }`:
  `a28 crashed while rendering: TypeError: Cannot read properties of undefined
  (reading 'length') at trunc → MessageViewRow`. An IPC row with omitted content
  blanks the transcript — exactly "many errors / no response".
- **Minimal fix (as landed)** `const trunc = (s: string | undefined | null, n) => {
  const v = s ?? ''; return … }`. Verified in the current source. **Status: FIXED.**

### F6 — Provider retry storm on 401/429 → 28 s time-to-first-token — **P1 at review start — FIXED DURING REVIEW**

- **File:line** `electron/agent/providers.ts` — `postJsonWithRetry()` (~line 662) at
  review start.
- **Evidence** `v1116-heavy-stress.test.mjs` FAILURE-TTFT: 10 turns, injected
  `401→429→success`, budget `<20 s`; turn 3 measured **28,031 ms** with **22 HTTP
  requests**: `statuses=401×7 > 429×14 > 200`. Startup alone grew 8.8 s → 12.1 s →
  22.7 s across turns. This is the literal "takes forever" symptom.
- **Minimal fix (as landed)** status-specific bounded policy in `postJsonWithRetry`:
  401/403/404 throw immediately (skip provider), 429 gets one short capped retry,
  5xx one backoff, all inside a shared wall-clock budget (`providerRetryBudgetMs()`).
  Verified present at lines 650–694. **Status: FIXED.**

### F7 — Cumulative memory never reached the final system prompt; shared preference duplicated — **P1/P2 at review start — FIXED DURING REVIEW**

- **File:line** `electron/agent/playbook.ts` `renderPlaybookPrompt()` (~331) and
  `electron/agent/memory.ts` `renderMemoryBlock()`; `engine.ts` calls the playbook body
  from `buildSystemPrompt`.
- **Evidence** `v1116-memory-audit.test.mjs`:
  - A2 — "memory block appended to the playbook body": expected true, actual false.
  - E2 — "shared preference appears exactly once in the combined prompt": expected 1,
    actual 0 (with an `exclude` mechanism absent, the expectation was that memory
    would be *de-duplicated*, not dropped).
- **Impact** After compaction/restart the agent did not actually see the persisted
  decisions/preferences in its final prompt — the "forgets everything" complaint.
- **Minimal fix (as landed)** `renderMemoryBlock(ws, userDataDir, { exclude: injectedTexts })`
  at `playbook.ts:370`. **Status: FIXED.**

### F8 — Long-run tuning clobbered user values and forced `continueAuto: true` — **P1 at review start — FIXED DURING REVIEW**

- **File:line** `electron/agent/engine.ts:1190` (old) —
  `agentTuningOverrides()` called with no `settings`.
- **Impact** `resolveLongRunLimits({})` ignored `settings.agent.maxTurns /
  maxContinueRounds / continueAuto`, so user values were overwritten with defaults and
  `continueAuto` was forced on — the continuation loop could run 30–200 extra rounds
  ("takes forever"). The engine.ts fix comment at 1195–1198 says exactly this.
- **Minimal fix (as landed)** `agentTuningOverrides({ settings })` after
  `const settings = svc.getSettings()` (line 1200). **Status: FIXED.**

### F9 — `decodeHtmlEntities()` throws `RangeError` on out-of-range numeric entities — **P2 — OPEN**

- **File:line** `electron/agent/tools.ts:4756–4761`:
  `String.fromCodePoint(parseInt(h, 16))` / `String.fromCodePoint(Number(d))`.
- **Scenario** `genUiTool` calls `GEN_UI_EXTERNAL.test(decodeHtmlEntities(html))` on
  model-supplied HTML. An entity such as `&#xFFFFFFF;` or `&#999999999;` makes
  `String.fromCodePoint` throw `RangeError: Invalid code point`. It is not a run abort —
  `executeTool`'s last-resort catch at `tools.ts:1261–1264` converts it to
  `{ ok:false, output:"Tool error: …" }` — but it surfaces to the model as a confusing
  tool failure ("many errors") instead of a clean validation message.
- **Minimal fix** clamp/validate before conversion:
  `const cp = parseInt(h,16); return cp >= 0 && cp <= 0x10FFFF && !Number.isNaN(cp) && !(cp >= 0xD800 && cp <= 0xDFFF) ? String.fromCodePoint(cp) : '';`
  (same for the decimal branch).

### F10 — Compaction's cumulative-memory helper is never wired in — **P2 — OPEN (functional gap)**

- **File:line** `electron/agent/engine.ts:4312–4332` (compaction block); helpers live in
  `electron/agent/compaction.ts:165` (`buildCompactionMemory`) and `:188`
  (`currentCompactionMemoryBlock`).
- **Evidence** `grep` over `engine.ts` finds **no** call to `buildCompactionMemory`,
  `currentCompactionMemoryBlock`, or `flattenToolBlocksForCompaction`. The block only
  uses `originalTaskText()` + `gates.continuity.preamble()`. Tool blocks are flattened
  by an equivalent inline copy at 4246–4254, so that part is safe (just duplicated).
- **Impact** Model-produced decisions / files / pending steps from the compaction
  summary are persisted only by the post-run `learnPlaybook → memorySnapshot` path;
  facts learned *during* a long run are not recorded at the compaction boundary that
  created them. Weaker "never forget across compaction" guarantee, not a crash.
- **Minimal fix** call `buildCompactionMemory({ head, rawMessages: params.messages,
  summary: merged, … })` inside the `if (cres.stopReason !== 'error' && merged.trim())`
  branch, and append its `block` to the post-compaction user message (it is advisory).

### F11 — Test-harness-only failure: `V1115-STABILITY` reports 0 of 4 PASS markers — **P2 — NOT an application bug**

- **File:line** `tests/v1116-heavy-stress.test.mjs:785–807`.
- **Evidence** `v1115 run 1 emitted all 4 PASS markers (got )`, `0 !== 4`. This is a
  nested-test-runner output-capture issue (the child run produced no captured markers),
  not source behaviour; the other stress/repro tests in the same file passed. Reported
  for completeness so it is not mistaken for a product regression.

---

## 4. Files reviewed and found sound (no finding)

The following were read closely (small files in full; large files at every risky site)
and I found **no introduced bug** in the named categories:

- `electron/agent/longRun.ts` — all numeric env resolution is clamped via
  `positiveInt`; `boundedUnique` and `mergeContinuity` are null-safe; `source.generations!`
  is guarded by `Number.isFinite`. The `head as never` cast at 311 is only a type bridge
  into the permissive `originalTaskText` signature, harmless at runtime.
- `electron/agent/memory.ts` — every disk read goes through `readJsonSafe`;
  `sanitizeSnapshot`/`sanitizeFact` validate all fields; all writes are in try/catch;
  regex `extractFilePaths` is called through `extractPathsSafe`. (Apart from F4.)
- `electron/agent/playbook.ts` — defensive JSON readers, serialized `mutate()` chain,
  all `BrowserWindow?.getAllWindows?.()` calls guarded, all IPC handlers wrapped.
- `electron/agent/compaction.ts` — `flattenToolBlocksForCompaction` and
  `originalTaskText` are total functions; `buildCompactionMemory` has its own try/catch.
- `electron/agent/engineGates.ts` — `recordTouch` catches disk reads; registry lookups
  are null-safe; permission helpers are pure and total.
- `electron/agent/budget.ts` — `classifyGateError` wraps each `RegExp.test` in try/catch;
  `attempt()` refunds retryable errors; `taskBudgetCheck` validates the limit.
- `electron/agent/lsp.ts` — after the `lspLanguages.ts` refactor, all JSON-RPC parsing,
  process I/O and install/approval paths are try/caught; `withLsp` returns an honest
  `{ok:false}` outcome rather than throwing.
- `electron/agent/engine.ts` streaming core — `DeltaBatcher` (214–356) uses length-
  guarded `shift()!` and wraps `emit` in try/catch; the engine idle watchdog and
  stream-drop auto-continue (4440–4713) correctly distinguish watchdog fire from user
  abort and never lose visible output; approval auto-allow (2195–2344) honors the
  `fullAccess` contract via `shouldAutoApprove`. (Apart from F3/F8.)
- `electron/agent/providers.ts` SSE layer — `readSseLines` watchdog (848–919) correctly
  treats a `reader.cancel()`-induced `{done:true}` as a stall; `toAnthropicMessages`
  drops orphan tool results; keep-alive bytes call `onHeartbeat`. (Apart from F6.)
- `electron/agent/tools.ts` — `executeTool` has a top-level last-resort catch; all 145
  tool defs have a matching executor (0 missing); `new RegExp(rawPattern,'i')` at ~2148
  has an `escapeRegExp` fallback. (Apart from F9.)
- `src/store.ts` streaming path — `flushPendingDelta` / `appendDeltaToMessages` /
  `appendThinkToMessages` / `clearStreamingRows` are index-safe; `heartbeat` is handled
  before any transcript work and resets the watchdog. (Apart from F1/F2.)
- `src/components/{ChatPanel,Composer,ProofRibbon,StreamTimeline}.tsx` — no conditional
  hooks, no hook-order violations, no setState-in-effect loops; every `useEffect` with
  a timer/listener/frame has a matching cleanup; `ProofRibbon` gates all `mv!` uses
  behind truthy checks and degrades unknown gate ids to a neutral label.
- `src/components/MessageView.tsx` — all three `JSON.parse` sites are guarded.
  (Apart from F5.)

---

## 5. Honest verdict

The landing is **not** "مليان أخطاء" in the sense of widespread type breakage: both
TypeScript projects are clean at the end of this review, all 145 tool definitions map
to executors, and the streaming/approval/watchdog core is defensively written. The
small new modules (`longRun`, `budget`, `engineGates`, `compaction`, `memory`, `playbook`,
`lsp`) are, on the whole, the best-hardened part of the wave.

What *is* real:

1. The renderer IPC ingest path is the weak point. `ingestAgentEvent` claims to be a
   no-throw choke point but has no top-level guard, and `ingestProofEvent`'s
   `run_receipt` branch dereferences unvalidated array elements (**F1 + F2**). This is a
   direct, reproducible "thinking stops" mechanism and is **still open — fix first**.
2. The long-run settings plumbing was wired only halfway; the residual
   `applyLongRunEnv()` call is still missing its `settings` argument (**F3**), so the
   founder's "long tasks stop early" can persist even after the tuning fix.
3. The test suite caught four additional genuine regressions (compile error, SSR render
   crash, provider retry storm, memory-not-in-prompt). These were fixed by parallel
   agents during this review, which is why the final typecheck is green — but they are
   evidence that the wave *did* introduce the founder's exact symptoms, not that the
   reviews were over-cautious.
4. Two lower-priority items remain open: a narrow `RangeError` in HTML entity decoding
   (**F9**) and an unwired compaction-memory helper (**F10**).

Recommended order: **F1 → F2 → F3 → F9 → F10**. After F1/F2, re-run
`tests/v1116-heavy-stress.test.mjs` (FUZZ-INGEST must report `throws=0`) and
`npm run typecheck`.
