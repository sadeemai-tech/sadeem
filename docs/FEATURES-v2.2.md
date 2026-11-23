# Surnia v2.2.0 — Capabilities Ledger (this release)

Baseline: v2.1.0 (84 additions) → v2.0.0 (42) → v1.x. Every item below is wired into the engine or an existing surface — no orphan pages. Theme of this release: **the app that grows with you** + Apple-inspired Liquid Glass design + production-grade security.

## A. Surnia DNA — the closed learning loop (18)
1. **DNA core** — persistent self-updating user model (`userData/dna.json` 0600 + per-workspace `.surnia/dna.json` layering)
2. Profile layer — role / expertise / languages / likes / dislikes / styleNotes, auto-extracted
3. Pattern tracker — command / workflow / style / correction patterns with repetition counts
4. Confidence scoring — 0.4 base → +0.15 per repetition (cap 0.95), recency-weighted for ranking
5. Auto-extraction trigger — one no-tools model call after every completed run (JSON-only, deduped merge, fire-and-forget)
6. Feedback capture — every denied write/command is recorded as a correction automatically
7. Explicit feedback — 👍/👎 + optional note on every assistant message → DNA
8. `dna_note` tool — the agent records durable preferences itself when you state them ("من الآن استخدم X")
9. `recall_memory` tool — cross-session search (BM25-lite over the last 200 sessions + DNA patterns, best-window excerpts)
10. DNA prompt injection — "# User DNA" system section (≤2000 chars, high-signal, omitted when empty for prompt-cache stability)
11. Skill usage tracking — uses / lastUsed / version / score in SKILL.md frontmatter
12. **Skill self-improvement** — after a failed/corrected run that used a skill, the skill-writer subagent patches its `## Refinements` section + bumps version
13. Proactive skill suggestion — a workflow pattern seen ≥3 times without a skill → suggestion chip in chat
14. DNA Map panel (Rail **06**) — profile card with removable chips + per-section inline add
15. Patterns list with kind stamps, confidence bars, ×N counts, relative last-seen, per-row forget
16. Feedback timeline + growth strip (sessions observed / facts recorded / patterns) + privacy bar
17. Forget controls — per-workspace / all (wired into Security data-controls too)
18. Live updates — `kdx:dna:event` push (updated / refined / suggestion / skills-trust) → debounced UI reload; `/dna` + `/dna forget` slash commands; DNA chip in StatusBar; Welcome & Workspace quick actions; Command Palette entries; DNA onboarding toggle (`dnaEnabled`, default on)

## B. Security hardening — production readiness (12)
19. Review-mode write wall — mutating commands (`sed -i`, `>`, `git commit/push`, `npm install`…) hard-denied in review posture
20. Plan-mode wall — same denial until the plan is approved ("approve the plan first")
21. MCP destructive wall — destructive-annotated MCP tools blocked in review mode
22. **Alternating doom-loop detection** — period-2/3 call cycles (A,B,A,B…) caught, not just identical consecutive ×3
23. Free-plan gate unified — single source of truth via billing (50 runs/day, old local 15/day removed)
24. Approval notifications — desktop notification when the agent waits for approval (was dead code)
25. Headless job ceilings — scheduled jobs get per-job `mode` (`read`/`autoEdit`/`fullAccess`, default autoEdit; no more silent fullAccess)
26. **Runtime license secret** — HMAC secret generated once, persisted 0600 (`license.secret`); hardcoded secret now legacy-only for old keys
27. Persistent approval rules — `always` decisions saved per workspace (0600 JSON) and reloaded on start (were memory-only)
28. FS confinement explicit — `setConfineRoot` wired from main on workspace open (was auto-adopt-by-accident)
29. API-server token encrypted via safeStorage (`enc:`/`plain:` convention, plaintext migrated)
30. Skills trust gate — workspace skills require one-time consent (`.surnia/skills-trusted`), like hooks; `trustWorkspaceSkills` setting

## C. SURVEYOR v5 — Liquid Glass Edition (14)
31. Glass token system ×3 themes (`--glass-bg/-bg-strong/-chrome-bg/-border/-blur/-saturate/-highlight/-shadow`)
32. Real frosted `.glass` (modals, palette, shortcuts, onboarding — was opaque fake)
33. `.glass-strong` for text-heavy surfaces (settings auto-detect via `:has(.set-rail)`)
34. Glass chrome — TitleBar / Rail / StatusBar translucent with blur 14 + specular top highlight
35. Glass sidebar dock + section header strips
36. Glass composer deck floating over transcript end
37. Glass dropdown menus (slash / @ mentions / tab menus, blur 18) + blurred model-picker scrim
38. Blurred modal scrims (`.scrim-glass`, blur 8 + saturate)
39. Canvas ambience — fixed sage/teal/clay radial depth layer for the glass to refract (≤5% alpha, no purple)
40. Specular system — 1px inset top-light on every glass surface, intensifies on hover
41. Welcome/quick-action tiles frost + hover deepens blur 12→16
42. `prefers-reduced-transparency` full fallback to opaque; `reduce-motion` compatibility kept
43. Radius systems consolidated into one instrument ladder (3/4/5px, both var names aliased)
44. Dead CSS purged (`.rail-pill`, `.aurora`, `.grid-bg`, `.grad-*`, `.kb-user-msg`); doctrine headers rewritten in every stylesheet

## D. UX flows (10)
45. Permission-mode cycle unified — one `PERMISSION_MODES` order (incl. `plan`) across store, TitleBar, StatusBar, Composer
46. Task-mode descriptor tables consolidated (4 copies → 1)
47. Chat width single-sourced in the store (still persisted, debounced, RTL-aware drag kept)
48. Session usage restored on reopen (per-message footers → SessionMeta fallback) — meters no longer reset to 0
49. Suggestion chip — "Surnia noticed you repeat this…" → turn into skill / dismiss
50. Skills-trust consent card in DNA panel + trust action
51. `/dna` chat summaries (patterns count, top 3, sessions observed)
52. DNA toast feedback on every learning action ("Surnia adapts to your feedback")
53. Command palette: Open DNA map / Forget DNA / What has Surnia learned?
54. `/help` updated with `/dna`

## E. Reliability & packaging (5)
55. NSIS builds on Linux **without wine** — patched `NsisTarget.js` (UninstallerReader path), scripted & idempotent (`scripts/patch-nsis.sh`, re-run after any `npm install`)
56. Brand unified — engine identity "You are Surnia, an expert software engineering agent that grows with the user", `SURNIA_HOME || KODEX_HOME` env fixed (duplicated condition removed)
57. DNA failures never break a run — all DNA paths defensive (try/catch, serialized writes, swallowed rejections)
58. DNA recall capped — newest 200 sessions, 15s timeout, graceful empty
59. Renderer & node typechecks clean; 9/9 unit tests pass; full build verified

**Total: 59 new capabilities in v2.2.0** — combined with v2.1.0's 84, v2.0.0's 42 and the v1.x feature set, Surnia ships **300+ user-facing capabilities**, all embedded in the engine or existing surfaces.
