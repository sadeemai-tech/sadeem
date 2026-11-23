# Surnia v6.0.0 "Apex" — Implementation Plan (live doc)

Built ON TOP of v5.0.0 (nothing reverted). Sources of this plan:
- ZCode (Z.ai) reverse engineering — 20 documented features (see chat research, 2026-11-08).
- Google Antigravity deep RE — artifacts, browser, permissions, slash commands, SDK (2026-11-08).
- User mandate: #1 = unbeatable programming power, zero errors; original innovative features;
  complete security hardening; soft ChatGPT+liquid design; direct testing with screenshots;
  suggestions/feedback page LAST.

## A. Programming power (THE headline)
1. **Goal Verifier rounds** (ZCode Goal Mode + Antigravity stop-hook): each continuation round
   ends with an evidence-only verification pass (commands/tests/diffs count, confident prose does
   not). The verifier's "next action" becomes the next round's injected title. Rounds + checklist
   grouping by iteration in the goal chip. Budget guard stays.
2. **Adversarial Critic gate** (Antigravity /teamwork Critic/Challenger): on `fullAccess` runs that
   edited ≥3 files or when `agent.criticGate` is on, after the agent stops, run a read-only
   Critic pass (reviewWorkingDiff machinery) hunting: mocked/faked tests, facade code, unverified
   claims, broken imports. Verdict + evidence appended as a system note; `critical` findings start
   ONE auto-fix round.
3. **Evidence Receipt** at run end: compact card (files touched ±lines, commands run + exit codes,
   verify results) — trust made visible; feeds Artifacts proof-of-work.
4. **5 new scaffold templates** (19→24): vue-vite, svelte-vite, flask-api, php-site, kotlin-cli.
5. **Error Explainer** (original, AR-first): one click on a failed tool result coaches the model to
   explain the error + the fix in the user's language. New: chat action button.
6. **/handoff** (original): session-handoff artifact (done/remaining/how to resume) — solves the
   universal "session died, what now?" problem.

## B. From ZCode
7. **Repo Wiki**: catalog+pages generated per workspace, stored OUTSIDE the repo
   (userData/wiki/<hash>), secret-hygiene filters (token/secret/credential/password names, .git,
   gitignored), auto-refresh only when code actually changed, two-column reader panel (rail 10).
8. **6-way approvals + editable scope** (ZCode Safety Confirmation × Antigravity scope edit):
   Allow / Always Allow / This session / This project / Reject / Always Reject (+ persisted deny).
9. **Import from rival agents**: skills (.claude/skills, .codex, opencode), MCP servers
   (~/.claude/settings.json, ~/.codex/config.toml, ~/.agents/mcp.json), commands.
10. **Automations**: 4 read-only analysis templates + "ask the agent to create one" hint.
11. **Usage streaks**: current streak, longest streak, peak hour.
12. **Memory taxonomy**: User/Feedback/Project/Reference classification on auto-learn +
    `forget_memory` verb in the remember tool.

## C. From Antigravity
13. **gen_ui tool**: single-file interactive HTML widget (sandboxed preview, no external scripts),
    inline ≤500px guidance — /generative_ui equivalent.
14. **Artifact comments → pending chips**: comment on any Artifacts section; comments queue and
    ride along with the next message ("N Comments" chip).
15. **/grill-me + web-verify built-in skills** (interview-first planning; browser-verify loop).
16. **Overview rows** in Artifacts: subagents, goals, modified files ±.

## D. Security (literal completion pass)
17. Prompt-injection firewall: web_fetch/search results are fenced as UNTRUSTED DATA with explicit
    model instructions; html/script stripping for text reads.
18. Full audit: CSP, preload surface, path traversal, shell guards, SSRF walls, approval-bypass,
    secrets in logs. Findings fixed, tests added.

## E. Design (soft + liquid)
19. Screenshot-driven pass after implementation: spacing/typography/alignment fixes, ChatGPT-soft
    surfaces with liquid-glass accents; AR typography re-check.

## F. Delivery
20. Tests green (48 + new), typecheck, full build; source zip, Windows portable + Setup,
    screenshots pack (every corner, EN+AR), SHA256SUMS, README.
21. **Suggestions & contact page in Settings (LAST — user's explicit ordering).**
