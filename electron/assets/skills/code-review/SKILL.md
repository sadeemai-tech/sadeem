---
name: Code review
description: A disciplined review checklist for correctness, safety, and maintainability.
---
# Code review

Read the diff first, then the diff's blast radius. Review in this order:

1. Correctness — does it do what the change claims? Edge cases: empty, huge,
   negative, concurrent, unicode. Errors handled or surfaced, never swallowed.
2. Safety — injection (SQL/commands/paths), authz checks on every entry point,
   secrets never logged, untrusted input validated at the boundary.
3. Behavior — tests updated and meaningful (assert behavior, not implementation);
   no regressions in adjacent flows.
4. Maintainability — names say what things do; no dead code; migrations
   reversible; public API changes documented.

Rules of output: every finding cites file:line, severity (blocker / should-fix /
nit), and a concrete suggestion. Approve only when zero blockers remain.
