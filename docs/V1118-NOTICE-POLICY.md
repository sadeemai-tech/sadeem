# v11.18 — Notice Policy (audit / proof / critique only for REAL work)

Founder requirement: **audit, proof and critique notices are emitted only for
real work**, never for a simple chat turn (no file writes, no commands, no
tools). This document records the analysis, the changes made inside
`electron/agent/vibeFlow.ts`, and the exact `engine.ts` wiring the parent agent
must apply (engine.ts is owned by another agent and was NOT edited here).

## 1. Analysis — what a SIMPLE chat turn emits today

Read-only analysis of `electron/agent/engine.ts`, the completion path around
lines 3031–3167. A "simple chat turn" = `params.task === 'chat'` (or equivalent),
`finalText.trim()` non-empty, `touchedFiles.size === 0`, `commandsRun.length === 0`,
no test records, no gates run.

| Notice | Code location | Emits on a simple turn? | Why |
|---|---|---|---|
| `claim_audit` (`ioB.send`) | **line 3051–3056**, guard `if (audit.claims.length) {` | **YES** | `auditClaims()` classifies *every sentence* of `finalText` as a claim. A plain answer such as "Paris is the capital of France" yields `claims.length > 0`, so the `claim_audit` event is sent even with zero writes and zero commands. (`audit.unsupportedCount > 0` additionally emits the `audit` sys_notice at line 3054.) |
| `self_critique` (sys_notice) | **line 3066–3084**, `notice('self_critique', \`\n[self-critique] ${critique.footer}\n\`)` at **line 3080** | **YES** | The block is gated only on `cfg.selfCritique !== false`. It always calls `selfCritique(...)` and always sends the notice; with the old helper the footer was a full advisory line even for a no-work turn. |
| `run_and_show` (sys_notice) | **line 3091–3167**, final send at **line 3162** | **NO** | The whole block is already gated on `writesThisRun` (line 3093). With no writes it is skipped entirely — no card of any kind. (If a *real-work* turn has writes but no detected runner, line 3160 sets `rs = { command: null }` and line 3162 sends the honest "no runner detected" card — that is honest and legitimate, not a simple-turn notice.) |

Conclusion: two notices need fixing (`claim_audit`, `self_critique`);
`run_and_show` is already correctly gated for simple turns.

## 2. Changes made in `electron/agent/vibeFlow.ts` (only file edited)

1. **`selfCritique()`** — added a *quiet turn* guard:

   ```ts
   const quietTurn =
     !input.writesThisRun &&
     input.commandsRun === 0 &&
     claimsTotal === 0 &&
     !input.verificationRan &&
     !claimsDone;
   ```

   When `quietTurn` is true, `footer` is `''` (both EN and AR paths); every
   other field stays well-formed. **Exception:** `claimsDone` (the existing
   completion-claim detector) keeps the full footer. A hollow false-done claim
   with no work ("تم إنهاء المهمة" / "Done — task finished") is *not* a simple
   chat turn — it is exactly the dishonesty the critique exists to catch, and
   the existing `tests/v1113-ai-internals.test.mjs` asserts its bilingual
   footer.

2. **`runAndShowSummary()` / `RunShowResult`** — added an opt-in `quiet?: boolean`
   field. When `result.command == null && result.quiet === true`, the function
   returns exactly `''`, so a policy-driven caller emits no empty "Run & Show"
   card. The default (`quiet` unset) is unchanged, preserving the honest
   no-runner line asserted by `tests/v1113-ai-internals.test.mjs` (lines
   206–218). The engine currently never calls the no-command branch for a
   simple turn anyway (it is gated on `writesThisRun`), so no engine change is
   required for the founder's goal; `quiet` is available if the parent wants
   to suppress the no-runner card on real-work-no-runner turns too.

3. **New exported helper `shouldEmitClaimAudit({ claimsTotal, writes, commands }): boolean`**
   — pure/deterministic; returns `true` only when there is real work
   (`writes > 0 || commands > 0`) **and** at least one claim to audit
   (`claimsTotal > 0`). This is the gate for the engine's `claim_audit` send.

## 3. Exact engine.ts line the parent MUST wire

> `engine.ts` was NOT edited. These are the changes for the owning agent.

**a) Import the helper** — extend the existing import block at **line 49–55**:

```ts
import {
  selfCritique,
  unverifiedFromAudit,
  runAndShowSummary,
  shouldEmitClaimAudit, // v11.18 — notice policy  <-- ADD
  type FlowLang,
  type RunShowResult,
} from './vibeFlow'; // v11.13 — Vibe Coder internals
```

**b) THE ONE REQUIRED LINE — engine.ts line 3051.** Replace:

```ts
        if (audit.claims.length) {
```

with:

```ts
        if (shouldEmitClaimAudit({ claimsTotal: audit.claims.length, writes: touchedFiles.size, commands: commandsRun.length })) {
```

This is the single line that stops `claim_audit` (and the nested line-3054
`audit` sys_notice) from firing on a simple chat turn. `touchedFiles` is a
`Set<string>` (`.size`) and `commandsRun` is an array (`.length`).

**c) Recommended (full no-op for `self_critique`) — engine.ts line 3080.**
With the new helper the footer is `''` on a simple turn, but the engine still
wraps it as `'\n[self-critique] \n'`. To make it a complete no-op, guard the
send:

```ts
        if (critique.footer) notice('self_critique', `\n[self-critique] ${critique.footer}\n`);
```

**d) Optional (`run_and_show` no-runner card) — engine.ts line 3160.** Change
`rs = { command: null };` to `rs = { command: null, quiet: true };` to suppress
the empty card on real-work-no-runner turns.

## 4. Verification performed here

- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json` — pass
- `node --test --test-force-exit tests/v1118-vibe-quiet.test.mjs tests/v1113-ai-internals.test.mjs` — green

`tests/v1118-vibe-quiet.test.mjs` asserts: simple-turn helpers return empty,
real-work helpers return the advisory footer, the false-done exception is kept,
and no mixed-language / stray text appears in quiet or EN output.
