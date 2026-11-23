---
name: Debug protocol
description: A systematic protocol for debugging any failure — evidence before fixes.
---
# Debug protocol

Never patch-and-pray. Work the loop:

1. REPRODUCE — find the smallest reliable reproduction (command, request, input).
2. OBSERVE — capture the real evidence: full error text, stack trace, logs from
   the failing path, version/commit. Read the FIRST error, not the last.
3. HYPOTHESIZE — write down one concrete cause ("X is null because Y never ran")
   and the cheapest observation that would confirm or kill it.
4. TEST the hypothesis with a print/log/breakpoint/minimal script. One change at
   a time; re-run the reproduction after each.
5. FIX at the root (not the symptom), then prove it: reproduction now passes,
   plus a regression test that fails without the fix.
6. RECORD — one paragraph: symptom → root cause → fix → proof.

If two hypotheses tie, test the CHEAPER one first. If evidence contradicts the
hypothesis, discard the hypothesis — never the evidence.
