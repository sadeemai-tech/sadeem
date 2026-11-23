# INTEGRATION STATUS — FINAL INTEGRATION GUARD

**Verdict: 🔴 RED** — the tree is **buildable** (`npm run build` passes and typecheck is clean at
final check), but the test suite is **failing (24 failures)**. Do not claim green.

- Monitor/diagnosis-only pass. No source files were edited by the guard.
- Checked at 2026-11-19 11:23 → 11:47 local time, 3 poll rounds while 19 agents edited in parallel.

---

## 1. Commands run and exact results

### TypeScript — `tsconfig.json`
```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```
- **Poll 1 (11:26):** exit 2 — 1 error:
  `src/store.ts(1793,7): error TS2741: Property 'mutation' is missing in type '{ status: "unproven"; gates: never[]; updatedAt: number; }' but required in type 'ProofState'.`
- **Poll 3 (11:37):** exit 2 — 4 errors, all in `src/components/CapabilityGuide.tsx(149,5) (157,5) (165,5) (173,5): TS2322` — Lucide `ForwardRefExoticComponent` not assignable to the local icon `ComponentType` (size prop `string|number` vs `number`).
- **Final re-check (11:42):** **exit 0 — clean.**
- **Both error sets are classified TRANSIENT** (files being actively edited): `src/store.ts` mtime 11:29:39 (the flagged block already had `mutation: null` on re-read); `src/components/CapabilityGuide.tsx` mtime 11:36:57 (agent was writing it during poll 3). No residual typecheck errors.

### TypeScript — `tsconfig.node.json`
```
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json
```
- Poll 1: **exit 0, no output — clean** (all 3 rounds consistent).

### Build
```
npm run build        # vite build && node scripts/post-build.mjs
```
- **PASS — exit 0.** `✓ 3288 modules transformed`, `✓ built in 2m 33s`; post-build shipped webcraft kit, 15 built-in skills, CSP+boot watchdog injected. Only non-fatal warnings (Vite CJS API deprecation, `postcss.config.js` module type, lottie-web `eval`).

### Tool inventory
```
node scripts/gen-tool-inventory.mjs
```
- **exit 0:** `gen-tool-inventory: 145 tools written ({"fs":55,"exec":60,"meta":30})`.

### Tests
```
npm test             # node --test --test-force-exit --test-concurrency=4 tests/*.test.mjs
```
- **FAIL — exit 1.** Final TAP summary:
  ```
  1..645
  # tests 645
  # suites 0
  # pass 605
  # fail 24
  # cancelled 0
  # skipped 16
  # todo 0
  # duration_ms 809163.5357
  ```
- Every `not ok` line is listed in section 2.

### Merge artifacts / broken imports
- Scanned `src/`, `electron/`, `tests/`, `shared/`, `scripts/` for `<<<<<<<`, `>>>>>>>`: **none found**. (The many `=======` hits are decorative comment separators, not conflict markers.) No duplicate-identifier/duplicate-export errors from tsc at final check.

### Scope — files modified in last 3 hours (source dirs only, no git available)
Active editors touched (mtimes 11:23–11:37): `electron/agent/engine.ts` (11:33:02), `electron/agent/prompts.ts` (11:36:52), `electron/agent/playbook.ts` (11:35:50), `electron/agent/memory.ts` (11:27:42), `electron/agent/providers.ts`, `electron/agent/codeintel.ts`, `electron/agent/lsp.ts`, `electron/agent/lspLanguages.ts`, `electron/agent/tool-defs.ts`, `electron/agent/engineGates.ts`, `src/store.ts` (11:29:39), `src/components/CapabilityGuide.tsx` (11:36:57), `src/components/MessageView.tsx`, `src/components/ProofRibbon.tsx`, `src/components/StreamTimeline.tsx`, plus many `tests/v1116-*` and `docs/DIAG-*`/`docs/SECURITY-AUDIT-v1116.md`. This is the parallel-edit wave.

---

## 2. All 24 test failures (file:line) + likely owner

Failures are grouped by root cause / owning module area. **The guard did not fix any of these** — this is a report to the parent for routing.

### A. Playbook module — `electron/agent/playbook.ts` (mtime 11:35:50, 11:23:56) — REAL, deterministic
- `tests/v1112-playbook.test.mjs:49:1` — #348 `applyPlaybookUpdate writes REAL files on disk` (false !== true)
- `tests/v1112-playbook.test.mjs:70:1` — #349 `version history records an evolution diff per revision` (history.length >= 1 false)
- `tests/v1112-playbook.test.mjs:85:1` — #350 `repeated lesson is reinforced (count++) not duplicated`
- `tests/v1112-playbook.test.mjs:110:1` — #352 `renderPlaybookPrompt is advisory and includes learned lessons` (body.length > 0 false)
- `tests/v1112-playbook.test.mjs:121:1` — #353 `buildSystemPrompt injects the playbook section when provided` ("playbook section injected")
- `tests/v1112-playbook.test.mjs:137:1` — #354 `clearPlaybook removes all playbook files`
- `tests/v1115-memory.test.mjs:97:1` — #460 `setup: real playbook lessons are written to disk`
- `tests/v1115-memory.test.mjs:285:1` — #465 `v11.15: cumulative memory is injected into the NEXT run system prompt` ("memory block reaches prompt via playbook injection")
- `tests/v1115-memory.test.mjs:311:1` — #467 `v11.15: the post-run learnPlaybook hook auto-writes memory` ("snapshot written by learnPlaybook")
- `tests/v1116-memory-audit.test.mjs:105:1` — #507 `A2: a persisted memory block reaches the FINAL system prompt` ("memory block appended to the playbook body")
- `tests/v1116-memory-audit.test.mjs:305:1` — #513 `E2: playbook + memory injection does not duplicate a shared preference` (shared preference appears 0 times, expected 1)

### B. Prompt/capability contract — `electron/agent/prompts.ts` (mtime 11:36:52) — REAL, deterministic
- `tests/v1111-cognition.test.mjs:183:1` — #198 `prompts: SKILLS index + SKILLS-FIRST rule + User DNA + plan read-only note ...` ("the prompt teaches the use_skill-first behavior")
- `tests/v1111-tools2.test.mjs:127:1` — #301 `prompts.ts carries the tool-strategy block ...` ("prompts.ts missing \"edit_file / multi_edit\"")
- `tests/v3-harness.test.mjs:155:1` — #578 `Stack-Matching protocol: the one-file-HTML default is gone` ("capability contract upgraded")
- `tests/v31-harness.test.mjs:310:1` — #589 `capability contract v3.1: universal sections + machine capabilities injection` ("universal programming claim")

### C. Engine — `electron/agent/engine.ts` (mtime 11:33:02) — likely REAL (timing/config regressions)
- `tests/v1110-endurance.test.mjs:428:1` — #114 `d: slow thinking deltas keep the stream alive — watchdog never fires` ("single request — no watchdog-triggered retry", 27 !== 1)
- `tests/v1110-endurance.test.mjs:463:1` — #115 `e: zero-byte stream beyond the idle window → watchdog fires and the retry succeeds` ("retry fired by the WATCHDOG (600ms window), not the 2.5s socket cleanup")
- `tests/v1110-modes.test.mjs:254:1` — #121 `plan mode: plan.md is the ONE sanctioned write (passes the gate)` (plan.md contains 'Plan saved to plan.md.' instead of '# Plan\n1. do it\n')
- `tests/v1110-subsystems.test.mjs:352:1` — #144 `A7 mcp: full engine run — model calls the discovered MCP tool` ("MCP tool result reached the engine")

### D. Store proof ingest — `src/store.ts:1636` `ingestProofEvent` (mtime 11:29:39) — REAL null-safety bug
- `tests/v1116-heavy-stress.test.mjs:467:1` — #495 `FUZZ-INGEST: 2000 seeded malformed events ... zero throws` — `TypeError: Cannot read properties of undefined (reading 'ok')` when `run_receipt.commands` contains `null` (stack: store.cjs ingestProofEvent → Array.filter). 1 throw out of 2000.

### E. Likely flaky / environment-dependent (still counted as failures; re-run in isolation was NOT done for these four)
- `tests/schedule-live.test.mjs:259:1` — #58 `addJob with an every-minute cron fires via the REAL 30s ticker` — `timeout (152974ms) waiting for job2 terminal status`; same run logged `EADDRINUSE 127.0.0.1:7681` and skipped the webhook test. Timing/port contention.
- `tests/v1110-tools.test.mjs:292:1` — #166 `env_install runs npm install for real; honest failure for unknown manager` — "npm is not installed on this machine" (environment/PATH under the spawned shell).
- `tests/v1116-heavy-stress.test.mjs:313:1` — #493 `FAILURE-TTFT: 10 real turns ... total time-to-first-token < 20s each` — turn 2 got 23693ms (load-sensitive).
- `tests/v1116-heavy-stress.test.mjs:785:1` — #497 `V1115-STABILITY: full v1115 stress suite re-run 3 times` — `0 !== 4` PASS markers; run logged `node:test run() is being called recursively ... skipping running files` (test-harness/concurrency artifact).

---

## 3. Transient vs real — summary

| Check | Status | Note |
|---|---|---|
| `tsc -p tsconfig.json` | GREEN at final check | 2 transient error clusters during active edits (store.ts, CapabilityGuide.tsx) — both resolved |
| `tsc -p tsconfig.node.json` | GREEN | clean in all rounds |
| `npm run build` | GREEN | exit 0 |
| `gen-tool-inventory.mjs` | GREEN | 145 tools |
| `npm test` | **RED** | 605 pass / **24 fail** / 16 skip |
| Merge artifacts | GREEN | none in source dirs |

**Isolation re-run (confirmation):** re-running the fast deterministic suites
`v1112-playbook`, `v1111-cognition`, `v1111-tools2`, `v1116-memory-audit`, `v3-harness`, `v31-harness`
gave **62 tests / 50 pass / 12 fail** — the same 12 playbook/prompts/capability failures reproduce with
no load from other suites. These 12 are definitively real regressions, not flakes.

**Bottom line:** Build is safe. Tests are RED. Primary blockers are the `playbook.ts` and `prompts.ts`
contract regressions (12 reproduced failures), plus `engine.ts` (4), `store.ts` (1), and 4 likely-flaky
environment/timing tests. Route fixes to the owning agents; do not merge on a green claim.
