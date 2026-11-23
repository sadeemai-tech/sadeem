# Surnia v2.1.0 — New Capabilities Ledger (this release)

Every item is wired into the engine or an existing surface — no orphan pages. Baseline: v2.0.0 (goal loop, queue, background subagents, auto-memory, scheduled jobs, arena, worktrees, checkpoints, plan mode, MCP registry, 12 providers, terminals, git AI commit, preview, local API, Atelier).

## A. Agent engine depth (18)
1. Plan-approval contract — agent proposes a structured plan (`propose_plan`) → numbered contract card in chat
2. Approve & execute auto (edits auto, commands still ask)
3. Approve & ask per step (manual mode switch)
4. Revise plan with feedback loop
5. Keyboard plan approval (1/2/3)
6. STEER semantics — Shift+Enter injects guidance at the next tool boundary (no abort)
7. Queue semantics — Enter during a run queues messages, dismissible chips, FIFO reconciliation
8. Doom-loop detector — 3 identical consecutive calls pause with ALLOW ONCE / ALWAYS / STOP
9. Command risk classifier — static analysis (rm -rf, fork bombs, curl|sh, force-push, sudo, credential dumping, 20+ rules)
10. Danger gate — dangerous commands ask even in Full Access (skippable, default OFF)
11. Warn class — risky commands surface a warning toast before running
12. Verify loop — after ≥3 consecutive edits, engine auto-runs build/test/typecheck and self-repairs (max 2 rounds)
13. Test-command auto-detection — package.json / Makefile / cargo / pytest / go
14. Review task mode — read-only posture, hard-deny writes
15. Debug task mode — hypotheses → instrument → reproduce → fix → remove instrumentation protocol
16. Structured code review — `review_diff` tool + review subagent, severity-ranked findings (CRIT/MAJ/MIN/NIT)
17. Session recap — deterministic Markdown recap (goal, steps, files, decisions, tokens, cost)
18. Subagent progress events — live progress bars for background subagents

## B. Learning & memory (6)
19. Skill factory — after a ≥8-tool-goal completes, a skill-writer subagent extracts a reusable SKILL.md
20. Skill index injection — saved skills enter the system prompt automatically
21. `use_skill` tool — load a full skill on demand mid-run
22. Skill management UI — list/delete strip in the agent console
23. Memory nudge — session end appends a deduped learning line to MEMORY.md ## Learned
24. Compaction+ — 80%-context trigger, focus keywords from recent asks, last 2 tool results preserved verbatim, before/after % event

## C. MCP, real (12)
25. Health monitor — 60s probes, latency, status dots, up/down/starting/disabled/quarantined
26. Auto-restart with backoff (5s/15s/45s, max 3) for crashed stdio servers
27. Tool annotations — readOnly/destructive/idempotent/openWorld chips on every tool
28. Destructive-tool approval gate — allow once / always / deny, remembered per tool
29. Tool-poisoning scanner — 9 pattern rules over descriptions (ignore-previous, exfiltration, credential files, base64 blobs…)
30. Auto-quarantine of poisoned servers + manual quarantine/release
31. Official registry search — registry.modelcontextprotocol.io browse, confirm-then-add, offline-safe
32. Per-tool enable/disable — disabled tools are hidden from the model
33. Tool call log — last 100 calls with latency/errors, clearable
34. Deterministic tool ordering — prompt-cache friendly per MCP 2026-07-28
35. MCP health push events — live UI updates without polling
36. MCP v2 settings — auto-quarantine switch, approvals cache management

## D. Security & privacy (11)
37. Terminal guard — classifies every shell line before execution (ON/WARN-ONLY/OFF)
38. Blocked-command banner — reasons + one-shot ALLOW ONCE whitelist (10-min TTL)
39. Multiline paste protection — worst verdict wins across lines
40. FS symlink walls — realpath verification keeps writes inside workspace + app data
41. `.surniaignore` — gitignore-lite control over indexing/search
42. Secret redaction in logs — sk-/Bearer/AKIA/ghp_/password patterns → «redacted»
43. Redaction of tool results sent to the UI (model transcript keeps fidelity)
44. Audit trail — append-only audit.jsonl (blocks, approvals, redactions, fs walls), live viewer
45. Privacy data controls — clear sessions / auto-memory / MCP approvals, export data as real ZIP (keys stripped)
46. Secret storage status — OS keystore backend + stored-key count
47. Permission decisions audited — every allow/deny/always recorded

## E. Models & cost (7)
48. Nov-2026 catalog — 68 models across 12 provider groups with exact API IDs
49. Claude 5.5 generation + Fable 5.1 (1M ctx)
50. OpenAI GPT-6.1 sol/terra/pro + codex line
51. Gemini 4 Argon + 3.8 Flash · Grok 4.7 + grok-build · DeepSeek V4.1-Flash/V4-Pro
52. Kimi K3.1 Pro · GLM-5.3 + flash · Qwen 3.8 + coder-next · MiniMax M3.1-Flash · Mistral Large 4 + devstral · Meta Muse
53. OpenRouter 18-model surface incl. 4 free models
54. Model picker v2 — badges (Rec/REASON/VISION/FREE), price per 1M in/out, context chips, keyboard navigation
55. Cost rates + context windows refreshed to drive the ctx meter and cost calc

## F. SURVEYOR v4 design system (14)
56. Precision-instrument identity — sharp 3–5px radii, hairline keylines, zero gradient/purple
57. Barlow Condensed display voice (caps headers) with Arabic-aware fallback
58. Numbered section grammar — "01 — WORKSPACE" headers app-wide
59. Status stamps replace colored pills (mono uppercase bordered)
60. Keyrow grammar — hairline list rows instead of floating cards
61. Surveyor corner ticks on hero surfaces
62. Tick-ruler ornaments under display headers
63. Plan-approval contract card (numbered options, dashed steps)
64. Tool-call timeline rows with verb gutters + duration + expandable output
65. Findings list for reviews with severity stamps
66. Definition-row settings grammar + square instrument toggles
67. LED status language (running/idle/error) in status bar
68. Two-pane numbered settings index (14 sections)
69. Full RTL + Arabic typography rules maintained across every new surface

## G. Workspace & UX flows (10)
70. Editorial welcome hub — numbered quick actions, capability stamps
71. Numbered onboarding contract pages with "02 / 05" progress
72. Agent console header with recap / review / skills instruments
73. Review-my-code quick action (workspace → chat bridge)
74. Session recap quick action (workspace/sessions → clipboard/download)
75. Git history tab with ahead/behind stamps
76. Style-match AI commit messages (follows your repo's commit style)
77. Per-session recap export from Sessions panel
78. Schedule next-run computation (cron + @hourly/@daily/@weekly)
79. Usage projections — avg/day + projected monthly + per-model breakdown table

## H. Reliability (5)
80. CSP boot-hash fix — inline watchdog now whitelisted (was silently refused); CSS hash removal restores 'unsafe-inline' semantics
81. Version strings unified (titlebar stamp, boot log) to app.getVersion()
82. 217 new i18n keys (EN/AR) — zero raw fallback leaks
83. Independent git repository for the codebase (crash-resilient history)
84. Long-title hero auto-sizing (no truncation)

**Total: 84 new capabilities in v2.1.0** · Combined with v2.0.0's 42 verified additions and v1.x feature set, Surnia ships 200+ user-facing capabilities.
