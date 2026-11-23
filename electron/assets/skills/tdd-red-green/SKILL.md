---
name: TDD red-green
description: Disciplined test-driven development — write the failing test first, then make it pass, then prove no regressions.
---
# TDD red-green

Use for ANY bug fix or new behavior. Never write code before a failing test.

1. RED — write ONE test that captures the exact expected behavior. Run it and show it FAILS for the right reason (assertion, not a syntax/import error). Save the exit code.
2. GREEN — write the MINIMUM code to pass that test. Run it again; show exit 0.
3. REFACTOR — clean up only while tests stay green.
4. REGRESSION — run the FULL relevant suite and report its exit code. A fix that passes its own test but breaks others is NOT done.

Rules:
- Tests assert behavior, not implementation details. No assertTrue(true) or snapshot-of-nothing.
- Name the test after the behavior: "rejects empty email", not "test1".
- If a test can't fail, the test is worthless — delete it.
- Report BOTH runs (red then green) with exit codes in the final message. Never claim green you did not observe.
