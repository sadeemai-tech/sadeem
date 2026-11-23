# v11.16 HEAVY STRESS REPORT — founder mandate: "اختبره بشكل كبير وضخم... ما بدي يطلع شكلنا بخزي"

**Run window:** 2026-11-19, ~11:24 → 12:03 local (UTC+3). **Final cohesive run:** 2026-11-19T09:02:42Z.
**Harness:** `tests/v1116-heavy-stress.test.mjs` (new, black-box: real esbuild-bundled engine/providers/tools/store + local `node:http` OpenAI-compatible mock; electron stubbed; zero network, zero model, no application source edited by this harness).
**Command:** `node --test --test-force-exit tests/v1116-heavy-stress.test.mjs`

---

## 0. Bottom line (brutally honest)

| # | Scenario | Final result | Notes |
|---|----------|--------------|-------|
| 1 | 10 engine turns, injected 401 → 429 → success | **PASS** — TTFT 3,168–3,889 ms (avg 3,585), bound 20,000 ms | Every turn recovered, 2 failover notices, clean `task_report`+`turn_end`, 0 error/abort |
| 2 | 30 tool calls across 2 forced compactions | **PASS** — 30/30 tool_start↔tool_result, 2 compactions, memory facts survived, all deltas landed | Final answer complete, all 15 files on disk |
| 3 | 2,000 malformed events through store ingest | **PASS** — 0 throws in 220 ms | **One real bug FOUND live (fuzz #250), fixed by a concurrent agent mid-campaign; now a permanent regression guard** |
| 4 | All 145 tools with adversarial args | **PASS** — 435 dispatches, 0 uncaught throws, 0 "Unknown tool" | 81 ok / 354 honest refusals |
| 5 | Full `v1115-stress` suite × 3 | **PASS (final campaign 3/3)** | **An earlier campaign had 1/3 FAIL under heavy load + concurrent source edits** — reported below, not hidden |

**Final cohesive run: 5 pass / 0 fail.** But this campaign also surfaced **three real events worth the founder's attention** (§6) — a genuinely broken intermediate source state, a load-correlated stability failure, and a real store-ingest bug (already fixed).

> ⚠️ **Critical context:** 12 other agents were editing application source throughout this window. Verified mtimes during the run: `engine.ts` 11:56, `providers.ts` 11:55, `prompts.ts` 11:49, `store.ts` 11:55 (all local). Line numbers in this report reflect the **final** source state; numbers observed earlier are called out explicitly where they differ.

---

## 1. FAILURE-TTFT — injected provider failures, 10 real turns

**Injection design.** The local mock dispatches by provider/model using an order-stable rule: the session model (`custom` / `fail-401`) always returns **HTTP 401**; the first distinct failover provider always returns **HTTP 429**; the next provider returns a real SSE success stream. 3 providers (`custom`, `zai`, `deepseek`) are configured so the engine's failover chain (`failoverChain(fullSettings(), params.model)`, cap 2 — `electron/agent/engine.ts:4400`) has two fallbacks. Engine-level retry is shrunk to `'8,8,8,8,8,8'` via `SURNIA_TURN_RETRY_DELAYS_MS` — the same posture used by `v1114-live-repro` and `v1115-stress` — so the test measures *hangs*, not deliberate backoff (see §6.3).

**Final full-run numbers (10 turns):**

| Metric | Value |
|---|---|
| Total time-to-first-token (run start → first `think_delta`/`text_delta`) | **min 3,168 ms · max 3,889 ms · avg 3,585 ms** |
| Bound | **< 20,000 ms — PASS on all 10 turns** |
| Observed status chain (final run) | `401 → 429 ×14 → 200` |
| Failover notices per turn | 2 |
| `error` / `aborted` events | 0 / 0 |
| `task_report` + `turn_end` | emitted on every turn |
| Test wall time | ~85 s (10 sequential turns) |

**Earlier campaign numbers (before concurrent engine optimization):** TTFT **6,245–11,973 ms, avg 8,446 ms**, all < 20 s. That campaign showed `401×7 → 429×14 → 200` = 22 real provider round-trips per turn (each failing provider exhausts `retryDelays.length` engine retries before failover — `engine.ts:4398`, loop at `engine.ts:4404+`). Both campaigns pass the bound; the improvement is from other agents' edits, not from this harness.

**Interpretation:** no hang. Failures are recovered through the real failover chain, and the delivered answer streams immediately afterward. The 20 s assertion is never close to tripping under the harness posture.

---

## 2. LONG-RUN-30 — 30 tool calls, 2 forced compactions

Real `runAgent` turn; 30 tool calls (`write_file` on even steps, `run_command` with >4,000-char output on odd steps). Two REAL engine auto-compactions forced by reporting `prompt_tokens: 200_000` at steps 8 and 20 with `compactThreshold: 10_000` (`engine.ts:3971/4335` reset the trigger, enabling a second compaction).

| Metric | Final run | Earlier run |
|---|---|---|
| `tool_start` / `ok tool_result` | 30 / 30 | 30 / 30 |
| Matching toolCallIds (no drops) | exact match | exact match |
| Files written (all verified on disk) | 15 | 15 |
| Real compaction events | **2** | **2** |
| Compacting heartbeats | 2 | 2 |
| Memory facts survived | **YES** — ALPHA token in 23/23 post-compaction requests; BOTH tokens in 11/23 (after compaction 2, `compactSoFar` accumulates) | YES — 23 alpha-visible, 11 both-visible |
| Text deltas | 32 | 32 |
| All 30 `Step N:` markers in final text | present | present |
| Final answer sentinel `ALL-DONE-30.` + both remembered facts | present | present |
| Duration / events | 6,552 ms / 140 | 38,549 ms / 140 |

No `error`, `aborted`, or watchdog/stall notice in any run. `task_report` and `turn_end` emitted.

---

## 3. FUZZ-INGEST — 2,000 malformed events

Reused the `v1114-store-ingest` bridge (`window.surnia` Proxy + `localStorage` stub installed **before** `src/store.ts` is bundled/required). Seeded mulberry32 PRNG (`0x1A5EED`), all values JSON/structured-clone-representable — the actual IPC contract.

**Final run:** 2,000 events ingested in **220 ms, 0 throws**; store state intact (`running` boolean, `ingestAgentEvent` function); a clean stream after the storm still produced the correct assistant bubble (`content: 'answer'`, `thinking: 'reasoning…'`), `task_report`, and `turn_end → running:false`.

### 3.1 REAL BUG FOUND (and fixed concurrently) — `run_receipt` with a null command element

- **Found:** ~11:31 local at seeded event **#250**, `2000`-event fuzz, **1 throw**:
  ```
  { type: 'run_receipt', files: [], commands: [null, [...]], rounds: 1, ... }
  TypeError: Cannot read properties of undefined (reading 'ok')
  ```
  Stack (esbuild bundle) landed in `ingestAgentEvent` → `Array.filter` at the `run_receipt` branch.
- **Root cause (at the time):** `src/store.ts:1636` evaluated `` `${commands.filter((c) => c.ok).length}/...` `` — reading `.ok` on a `null`/primitive element throws. The source comment at the time (`store.ts:1622-1624`) explicitly promised "a receipt with missing arrays must not throw here or the whole event (including the transcript update) is lost" — the hardening covered *missing arrays* but not *malformed array elements*. A throw here drops the entire event → the exact "thinking stops" symptom family the founder complained about.
- **Severity:** real robustness gap on a JSON-representable, plausible payload (e.g. an older/other producer, a partial serialization). Not a hypothetical JS-only input.
- **Resolution observed:** a concurrent agent hardened the branch. Current source (`src/store.ts:1629-1640`):
  ```ts
  // HARDENING: untrusted IPC may send commands:[null] — never read .ok on
  // a null/primitive element (fuzz #250: "thinking stops" symptom family).
  const safeFiles = Array.isArray(files) ? files.filter((f) => !!f && typeof f === 'object') : [];
  const safeCommands = Array.isArray(commands) ? commands.filter((c) => !!c && typeof c === 'object') : [];
  ...
  detail: `${safeFiles.length} files · ${safeCommands.filter((c) => c.ok === true).length}/${safeCommands.length} commands ok ...`
  ```
- **Regression guard added:** `tests/v1116-heavy-stress.test.mjs` now deterministically ingests `{type:'run_receipt', commands:[null]}` and **asserts it does not throw**. The final run logs `REPRO ... → handled (fixed)`. If this regresses, the suite fails permanently.
- I did **not** patch application source; the fix came from another agent. Reporting to parent as required.

### 3.2 Out-of-contract diagnostic (measured, NOT asserted)

A separate 400-sample probe with values that **cannot survive `structuredClone`/JSON IPC** — throwing getters, throwing Proxies, BigInt, Symbol, circular refs — produced **165 throws: 71 `getter-throw`, 94 `proxy-get`** (BigInt/Symbol/circular throws disappeared after concurrent JSON.stringify hardening). These throws originate in the *event's own accessors*, not in app logic, and are unreachable from the engine→renderer IPC path. Reported for honesty; deliberately not a hard assertion. The store remained structurally intact afterwards.

---

## 4. TOOL-STORM — all 145 tools, adversarial args

Live registry count verified: **145 tools** (`tools.getToolDefs([]).length === 145`). Dangerous tools are driven with `{}` (auto-deny/force-empty, as in v1115); all others receive adversarial strings (path traversal + NUL, template injection, SQL-injection text, 5 KB strings, emoji, RTL controls, BOM, `http://127.0.0.1:9/` URLs), adversarial numbers (`-1`, `1e309`, `MAX_SAFE_INTEGER`), nested arrays/objects, and own prototype-pollution keys (`__proto__`, `constructor`, `prototype`, `toString`). 3 rounds: empty/deny, adversarial-minimal/deny, adversarial-max/allow.

| Metric | Final run | Earlier run |
|---|---|---|
| Dispatches | 435 (145 × 3) | 435 |
| `Unknown tool` | **0** | **0** |
| Uncaught throws | **0** | **0** |
| `Invalid JSON args` / empty-output failures | 0 / 0 | 0 / 0 |
| ok / honest refusal | 81 / 354 | 81 / 354 |
| Wall time | 13,438 ms | 159,231 ms |

No tool escaped the harness or hit the real network (mock URLs point to a closed loopback port; browser tools disabled via `SURNIA_NO_BROWSER=1`).

---

## 5. V1115-STABILITY — full stress suite re-run 3×

Each iteration spawns a fresh `node --test --test-force-exit tests/v1115-stress.test.mjs` subprocess (parent test-runner env `NODE_TEST_CONTEXT`/`NODE_OPTIONS` stripped — otherwise the child exits in 1.5 s without running anything). Success = exit 0 **and** all four markers `CONTINUITY-ALL-PASS`, `LONG-RUN-PASS`, `TOOL-STORM-PASS`, `MALFORMED-EVENTS-PASS`.

**Final campaign (settled source):**

| Run | Exit | Duration | Markers | Failed assertions |
|---|---|---|---|---|
| 1 | 0 | 52,313 ms | 4/4 | 0 |
| 2 | 0 | 68,470 ms | 4/4 | 0 |
| 3 | 0 | 70,007 ms | 4/4 | 0 |

`stable: true`. Additionally, **4 standalone direct v1115 runs** during the window all passed 4/4 (one measured at 220,316 ms under load).

**Earlier campaign — NOT green, reported honestly:**

| Run | Exit | Duration | Markers |
|---|---|---|---|
| 1 | 0 | 189,804 ms | 4/4 |
| 2 | 0 | 265,300 ms | 4/4 |
| 3 | **1** | 166,603 ms | **3/4 — 1 failed assertion** |

The exact failing assertion was not captured (full-log saving was added to the harness *after* this run). Correlating evidence: source files were being edited minutes before this campaign (`engine.ts` 11:56, `providers.ts` 11:55, `store.ts` 11:55); a separate bundle failure was observed at ~11:29 from the same cause (§6.1); run durations 166–265 s indicate a heavily loaded host (later settled runs: 52–70 s).

Across all observations: **13 of 14 valid v1115 executions passed; 1 failed** (the run above, under active development/load). Treat the product as stable in a settled build; do not treat the single failure as a green wash. (An earlier 15th attempt was invalidated by a harness bug of my own — the nested child inherited `NODE_TEST_CONTEXT` from the parent test runner and exited in 1.5 s without running tests; fixed by stripping `NODE_TEST_CONTEXT`/`NODE_OPTIONS` before spawning.)

---

## 6. Findings requiring founder/parent attention

### 6.1 Broken intermediate source state — a real "no response at all" class symptom (TRANSIENT, concurrent-edit)
At ~11:29, an early `LONG-RUN-30` invocation failed **before any assertion**:
```
✘ [ERROR] No matching export in "electron/agent/prompts.ts" for import "buildSystemPrompt"
  electron/agent/engine.ts:24:9  →  import { buildSystemPrompt, TASK_MODE_SPECS } from './prompts';
```
esbuild could not bundle the engine → **zero agent turns can start**. Verified at the moment `prompts.ts` exported only `taskModeProtocolSection`/`TASK_MODE_SPECS`; minutes later `buildSystemPrompt` appeared at `prompts.ts:909`. This is a transient artifact of concurrent edits, **not** a shipped defect — but it is precisely the "app produces no response" failure mode, so **the release must be gated on a clean full build** (`npm run full`) after all agents stop editing. No source patch applied.

### 6.2 Real store-ingest bug (FOUND, fixed concurrently) — see §3.1
`run_receipt` with `commands:[null]` threw at `src/store.ts:1636`, dropping the whole event. Fixed to `safeFiles`/`safeCommands` at current `src/store.ts:1629-1640`; regression guard lives in `tests/v1116-heavy-stress.test.mjs`.

### 6.3 Retry/backoff posture — analysis (not a measured failure)
This harness shrinks `SURNIA_TURN_RETRY_DELAYS_MS` to `8,8,8,8,8,8` (the established v1114/v1115 posture) so a deliberately failing provider cannot dominate the wall clock. Production defaults **changed during this campaign**: observed `[600,1800,4000,8000,15000,30000]` (sum 60.4 s) at the first run → currently `[300,800,1500,2500,4000]` (sum 9.1 s) at `electron/agent/engine.ts:131`. Provider-level handling also changed: 429 is no longer in `RETRYABLE_STATUS` (`providers.ts:554` = `[500,502,503,529]`) and has a dedicated branch (`providers.ts:725`). With the current 9.1 s schedule, two failing providers could still put TTFT near/above 20 s on a cold host; the injected-failure test intentionally does not measure that production path. Recommend a separate product decision on the desired worst-case failover latency.

### 6.4 Latency observation — `env_probe` (not an assertion failure)
In the high-load tool-storm run, `env_probe({})` took **44,878 ms**, `env_manager` ~19,400 ms, `process_list` ~8,500 ms, `diff_stat` ~9,200 ms; `env_probe` shelled out `nvm list` in `C:\Users\acer` (outside the workspace). In the settled run the whole 435-call storm took 13.4 s, so this is host-load-driven, but a user-triggered `env_probe` can still block for ~45 s on a cold/loaded host. No throw, no crash — worth a timeout guard in a follow-up.

---

## 7. Reproduce

```powershell
node --test --test-force-exit tests/v1116-heavy-stress.test.mjs
# focused
node --test --test-force-exit --test-name-pattern="FAILURE-TTFT" tests/v1116-heavy-stress.test.mjs
node --test --test-force-exit --test-name-pattern="LONG-RUN-30" tests/v1116-heavy-stress.test.mjs
node --test --test-force-exit --test-name-pattern="FUZZ-INGEST" tests/v1116-heavy-stress.test.mjs
node --test --test-force-exit --test-name-pattern="TOOL-STORM" tests/v1116-heavy-stress.test.mjs
node --test --test-force-exit --test-name-pattern="V1115-STABILITY" tests/v1116-heavy-stress.test.mjs
```

Files owned by this subagent (only): `tests/v1116-heavy-stress.test.mjs`, `docs/HEAVY-STRESS-REPORT.md`. No application source was modified.
