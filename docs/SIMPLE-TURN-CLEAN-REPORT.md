# v11.18 — Simple Turn Clean / Evidence Collapsed — Verification Report

**Test:** `tests/v1118-simple-turn-clean.test.mjs`
**Command:** `node --test --test-force-exit tests/v1118-simple-turn-clean.test.mjs`
**Mode:** TEST/VERIFICATION ONLY. No application source was patched by this agent.

## Founder's complaint under test

After a *plain conversational* reply the chat was plastered with proof-of-work
chrome (PROOF strips, CLAIM AUDIT, "Every claim is backed by evidence",
"Run & Show", "self-critique", "claim-audit", "receipt", "mutation") even though
no tool ran and no gate fired. On a *real work* turn the evidence must still be
present, but behind a small PROOF toggle / button, not a big inline block.

## Harness

Follows `tests/v1116-chat-precision.test.mjs` and
`tests/v1116-proof-visible.test.mjs`:

- esbuild bundles the **real** store (`src/store.ts`), `MessageView`,
  `ProofRibbon`, and the pure engine emission gate `shouldEmitClaimAudit`
  (`electron/agent/vibeFlow.ts`).
- Browser globals are stubbed before the store loads; `useSyncExternalStore`
  is patched to use `getSnapshot` as `getServerSnapshot` so SSR observes the
  live seeded state; `useLayoutEffect` → `useEffect` for SSR.
- `renderChat()` SSR-renders the chat subtree exactly as `ChatPanel` mounts it:
  every message via `MessageView` plus the single tail-mounted `ProofRibbon`.
- Events are fed through the **real** `ingestAgentEvent` path.

## Assertions

### (a) Simple conversational turn — must render ZERO clutter
Seed one user `السلام عليكم` + one assistant `وعليكم السلام، كيف أقدر أساعدك اليوم؟`,
no tool events, no proof events. `proofVisible === false`, `proof.gates.length === 0`.
The rendered HTML must NOT contain any of the founder's literal strings:

| Needle | Meaning |
| --- | --- |
| `PROOF` | the old always-on PROOF strip |
| `CLAIM AUDIT` | audit banner |
| `Every claim is backed by evidence` | audit ok-banner |
| `Run & Show` | engine notice |
| `self-critique` | engine notice |
| `claim-audit` | notice kind / card |
| `receipt` | proof-of-work receipt |
| `mutation` | mutation-gate row |

Plus structural hooks: no `data-testid="proof-ribbon"`, no `pr-tag`, no
`sc-proof-details`.

### (a-defensive) stale `claim_audit` still renders clean
Simulates the old engine emitting `claim_audit` after every turn: a single
trivially-supported claim with summary "Every claim is backed by evidence".
A3's `ClaimAuditRow` must return `null`, so all eight strings remain absent.

### Engine gate (A5/A7)
`shouldEmitClaimAudit()` must be `false` for a claim-bearing chat with
`writes=0, commands=0` and for zero claims; `true` only when a real write or
command exists. Malformed (NaN) input coerces to `false`.

### (b) Real work turn — evidence present, but COLLAPSED
User asks to build something; assistant text + `tool_start(write_file)` +
`tool_result` + `verify_run` + `claim_audit` with 1 unsupported claim.
The payload's `unsupported` is deliberately set to a lying `99` to test honesty.

- **Present:** PROOF toggle (`data-testid="proof-ribbon"` wrapper,
  `data-testid="proof-toggle"` button, `pr-tag`), `CLAIM-AUDIT` row, the honest
  count `1 claims without evidence` (derived from `claims`, not the payload
  `99`), total-claims stamp `2 C`, the unsupported claim text, and the real
  PASS/FAIL tally (`1 PASS` / `0 FAIL`).
- **Collapsed / by-button:** PROOF is a real `<button>` (`pr-proof-toggle`);
  the tally is a real button; the evidence popover (`pr-pop`) is NOT in the
  initial markup; no inline gate/claim rows (`class="pr-check`) and no expanded
  receipt detail (`sc-tl-out`) spill into the transcript.

## Results — ALL PASS (no clutter found)

Final source state at verification time (all edits from the other agents had
landed; timestamps stable across the run window):

| File | Last write |
| --- | --- |
| `src/components/MessageView.tsx` (A3) | 11/19/2026 2:09:53 PM |
| `src/components/ProofRibbon.tsx` (A2) | 11/19/2026 2:11:13 PM |
| `src/components/ChatPanel.tsx` (A8) | 11/19/2026 2:10:38 PM |
| `electron/agent/engine.ts` (A7) | 11/19/2026 2:11:44 PM |
| `electron/agent/vibeFlow.ts` (A5) | 11/19/2026 2:10:27 PM |

| # | Test | Result |
| --- | --- | --- |
| 1 | (a) simple turn → zero clutter | **PASS** |
| 2 | (a-defensive) trivial `claim_audit` still clean | **PASS** |
| 3 | engine `shouldEmitClaimAudit` gate | **PASS** |
| 4 | (b) work turn → evidence present but collapsed | **PASS** |

**`node --test --test-force-exit tests/v1118-simple-turn-clean.test.mjs`
→ 4 tests, 4 pass, 0 fail (exit 0).**

No exact `file:line` failure to report — the founder's clutter is **not**
present in the rendered chat subtree for a simple turn, and the evidence for a
work turn is honest and behind buttons.

Notes on A2's final code (checked, as the brief required): the PROOF toggle is
now a real `<button data-testid="proof-toggle" class="pr-proof-toggle">`
with the visible `pr-tag` reading `PROOF`, mounted inside a wrapper carrying
`data-testid="proof-ribbon"`; the rest of the hooks (`pr-tally`, evidence chips,
gate rows) live in an `sr-only pr-hooks` span or an open-on-click popover
(`pr-pop`, absent from initial SSR). The test asserts against this final shape.

## Stability — 3/3 identical runs

| Run | Pass | Fail | Duration | Exit |
| --- | --- | --- | --- | --- |
| 1 | 4 | 0 | 1630.9 ms | 0 |
| 2 | 4 | 0 | 1525.7 ms | 0 |
| 3 | 4 | 0 | 1474.1 ms | 0 |

Result stable across all three runs: no flakes, no order dependence (each run
re-seeds the real store from scratch).

## Sensitivity check (test really can detect the clutter)

A throwaway script (outside the repo, not application source) rendered a
deliberately re-cluttered turn — write + verify + receipt + mutation_check +
proof_package + a supported claim_audit plus `self_critique` / `run_and_show`
`sys_notice`s — and probed the same needles:

```
FOUND   "PROOF"
FOUND   "CLAIM-AUDIT"
FOUND   "Every claim is backed by evidence"
FOUND   "receipt"
MISSING "Run & Show"
MISSING "self-critique"
MISSING "claim-audit"
MISSING "mutation"
```

Interpretation:

- The render-layer needles that the founder actually sees as cards (PROOF,
  CLAIM-AUDIT, the ok-banner, receipt) **are detectable** — so scenario (a)'s
  absence assertions are meaningful, not vacuous.
- `self-critique` / `Run & Show` are additionally stripped by
  `NoticeChip` (`MessageView.tsx:876-879`): the leading `[tag]` is removed and
  replaced by the notice's own label, so those literal bracket strings cannot
  reach the transcript even if the engine emits the notices. The engine-side
  fix is still covered by the `shouldEmitClaimAudit` gate test and the
  real-work gating in `engine.ts`.
- Uppercase card labels (`CLAIM-AUDIT`, `MUTATION-CHECK`) are why scenario (a)
  checks the needles **case-insensitively**.

## Verdict

The founder's exact complaint is **fixed** in the current source: a plain
greeting exchange renders a clean transcript with no proof/claim/receipt/
mutation chrome, and a genuine work turn still shows an honest, collapsed PROOF
toggle + claim row. This agent did not modify any application source.
