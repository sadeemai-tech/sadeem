---
name: Performance profiling
description: Find and fix real performance bottlenecks with measurement, not guesswork.
---
# Performance profiling

1. REPRODUCE — define the slow path with a concrete input and a measurable baseline (wall time, allocations, or a profiler trace). No number = no problem statement.
2. MEASURE — profile before changing anything. Use the platform profiler (Chrome DevTools for renderer, `--prof`/clinic for Node). Identify the top 3 hotspots with numbers.
3. HYPOTHESIZE — for each hotspot, state WHY it is slow and what change would help. Rank by (impact / effort).
4. FIX ONE — change only the top item; re-measure with the SAME input. If the number did not move by ≥20%, revert and reconsider — do not accumulate unproven changes.
5. GUARD — add a perf regression check (benchmark threshold or assertion) so the fix does not silently regress.
6. REPORT — before/after numbers, the exact command, and what remains slow.

Anti-patterns: premature micro-optimization, caching without invalidation, "it feels faster", adding indexes without measuring write cost, optimizing code that is not on the hot path.
